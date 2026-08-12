import type {CallableRequest} from "firebase-functions/v2/https";
import {HttpsError} from "firebase-functions/v2/https";

import {
  requireAdminInviteAccess,
  requireAuthenticatedRestaurantAccountActor,
} from "./admin_authorization.js";
import {
  buildRatingDestructiveOperationSummary,
  parseRatingDestructiveStatusRequest,
  parseRatingDishDeleteStartRequest,
  parseRatingDishMergeStartRequest,
  parseRatingRestaurantDeleteStartRequest,
  parseRatingRestaurantMergeStartRequest,
  type RatingDestructiveOperationSummary,
} from "./rating_destructive_callable_contract.js";
import {
  createRatingDestructiveCallerBindingFingerprint,
  parseRatingDestructiveJobDocument,
  ratingDestructiveJobPath,
  ratingDestructiveJobVersion,
  RatingDestructiveContractError,
  type RatingDestructiveAuthorizedCallerKind,
  type RatingDestructiveJobDocument,
} from "./rating_destructive_job_contract.js";
import {
  claimRatingDestructiveOperation,
  processRatingDestructiveJobStep,
  RatingDestructiveClaimError,
  type RatingDestructiveClaimResult,
} from "./rating_destructive_job_processor.js";
import {
  parseRatingDish,
  parseRatingRestaurant,
  RatingDestructiveProcessError,
  type RatingDestructiveDependencies,
} from "./rating_destructive_job_runtime.js";
import type {
  RatingDestructivePrivateDatabase,
  RatingDestructiveStoredDocument,
} from "./rating_destructive_job_store.js";

export type RatingDestructiveCallableActor = Readonly<{
  uid: string;
  authorizedCallerKind: RatingDestructiveAuthorizedCallerKind;
}>;

export type RatingDestructiveCallableRequest = Readonly<{
  auth?: unknown;
  data: unknown;
}>;

export type RatingDestructiveAuthenticate = (
  request: RatingDestructiveCallableRequest,
) => RatingDestructiveCallableActor;

type ClaimFunction = typeof claimRatingDestructiveOperation;
type ProcessStepFunction = typeof processRatingDestructiveJobStep;

export type RatingDestructiveStatusHandlerContext = Readonly<{
  privateDatabase: RatingDestructivePrivateDatabase;
  authenticate?: RatingDestructiveAuthenticate;
}>;

export type RatingDestructiveStartHandlerContext =
  RatingDestructiveStatusHandlerContext & Readonly<{
    processingDependencies: RatingDestructiveDependencies;
    now?: () => Date;
    claim?: ClaimFunction;
    processStep?: ProcessStepFunction;
  }>;

function validActor(actor: RatingDestructiveCallableActor): boolean {
  return typeof actor.uid === "string" &&
    actor.uid.length > 0 &&
    Buffer.byteLength(actor.uid, "utf8") <= 128 &&
    (actor.authorizedCallerKind === "admin" ||
      actor.authorizedCallerKind === "owner");
}

/** Uses the current Rating Admin allowlist and nonanonymous actor parser. */
export function authenticateRatingDestructiveCallableActor(
  request: RatingDestructiveCallableRequest,
): RatingDestructiveCallableActor {
  const callableRequest = request as CallableRequest<unknown>;
  const authenticated = requireAuthenticatedRestaurantAccountActor(
    callableRequest,
  );
  try {
    requireAdminInviteAccess(callableRequest);
    return Object.freeze({
      uid: authenticated.uid,
      authorizedCallerKind: "admin" as const,
    });
  } catch (error) {
    if (!(error instanceof HttpsError) || error.code !== "permission-denied") {
      throw error;
    }
  }
  return Object.freeze({
    uid: authenticated.uid,
    authorizedCallerKind: "owner" as const,
  });
}

function authenticate(
  request: RatingDestructiveCallableRequest,
  context: RatingDestructiveStatusHandlerContext,
): RatingDestructiveCallableActor {
  const actor = (context.authenticate ??
    authenticateRatingDestructiveCallableActor)(request);
  if (!validActor(actor)) {
    throw new HttpsError(
      "unauthenticated",
      "Authentication is required for this Rating operation.",
    );
  }
  return actor;
}

function requireAdmin(actor: RatingDestructiveCallableActor): void {
  if (actor.authorizedCallerKind !== "admin") {
    throw new HttpsError(
      "permission-denied",
      "Rating administrator access is required for this operation.",
    );
  }
}

function currentTime(clock: (() => Date) | undefined): Date {
  const value = clock?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Rating destructive-operation clock is invalid.");
  }
  return new Date(value.getTime());
}

function contractDocument(
  document: RatingDestructiveStoredDocument | null,
): Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}> | null {
  return document === null ? null : {id: document.id, data: document.data};
}

function entityNotFound(): never {
  throw new HttpsError(
    "not-found",
    "The requested Rating entity is unavailable.",
  );
}

function staleEntity(): never {
  throw new HttpsError(
    "aborted",
    "Rating data changed. Refresh and try again.",
  );
}

function incompatibleEntity(): never {
  throw new HttpsError(
    "failed-precondition",
    "The requested Rating operation is not currently available.",
  );
}

async function inspectRestaurantMerge(
  database: RatingDestructivePrivateDatabase,
  sourceRestaurantId: string,
  targetRestaurantId: string,
  expectedSourceRevision: number,
  expectedTargetRevision: number,
): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const [sourceDocument, targetDocument] = await Promise.all([
      transaction.getDocument(`bitescore_restaurants/${sourceRestaurantId}`),
      transaction.getDocument(`bitescore_restaurants/${targetRestaurantId}`),
    ]);
    const source = parseRatingRestaurant(sourceDocument);
    const target = parseRatingRestaurant(targetDocument);
    if (source === null || target === null) {
      entityNotFound();
    }
    if (
      source.revision !== expectedSourceRevision ||
      target.revision !== expectedTargetRevision
    ) {
      staleEntity();
    }
    if (!target.isActive) {
      incompatibleEntity();
    }
  });
}

async function inspectRestaurantDelete(
  database: RatingDestructivePrivateDatabase,
  restaurantId: string,
  expectedRevision: number,
): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const restaurant = parseRatingRestaurant(await transaction.getDocument(
      `bitescore_restaurants/${restaurantId}`,
    ));
    if (restaurant === null) {
      entityNotFound();
    }
    if (restaurant.revision !== expectedRevision) {
      staleEntity();
    }
  });
}

async function inspectDishMerge(
  database: RatingDestructivePrivateDatabase,
  sourceDishId: string,
  targetDishId: string,
  actor: RatingDestructiveCallableActor,
): Promise<string> {
  return database.runTransaction(async (transaction) => {
    const [sourceDocument, targetDocument] = await Promise.all([
      transaction.getDocument(`bitescore_dishes/${sourceDishId}`),
      transaction.getDocument(`bitescore_dishes/${targetDishId}`),
    ]);
    const source = parseRatingDish(sourceDocument);
    const target = parseRatingDish(targetDocument);
    if (source === null || target === null) {
      entityNotFound();
    }
    if (
      source.restaurantId !== target.restaurantId ||
      !source.isActive ||
      !target.isActive ||
      source.mergedIntoDishId !== null ||
      target.mergedIntoDishId !== null
    ) {
      incompatibleEntity();
    }
    const restaurant = parseRatingRestaurant(await transaction.getDocument(
      `bitescore_restaurants/${source.restaurantId}`,
    ));
    if (restaurant === null) {
      entityNotFound();
    }
    if (
      actor.authorizedCallerKind === "owner" &&
      (
        restaurant.data.isClaimed !== true ||
        restaurant.data.ownerUserId !== actor.uid
      )
    ) {
      throw new HttpsError(
        "permission-denied",
        "This restaurant owner cannot start the requested operation.",
      );
    }
    return source.restaurantId;
  });
}

async function inspectDishDelete(
  database: RatingDestructivePrivateDatabase,
  dishId: string,
): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const dishDocument = await transaction.getDocument(
      `bitescore_dishes/${dishId}`,
    );
    if (dishDocument === null) {
      return;
    }
    const dish = parseRatingDish(dishDocument);
    if (dish === null) {
      incompatibleEntity();
    }
    const restaurantDocument = await transaction.getDocument(
      `bitescore_restaurants/${dish.restaurantId}`,
    );
    if (restaurantDocument !== null) {
      parseRatingRestaurant(restaurantDocument);
    }
  });
}

function internalCaller(actor: RatingDestructiveCallableActor) {
  return Object.freeze({
    authorizedCallerKind: actor.authorizedCallerKind,
    callerBindingFingerprint:
      createRatingDestructiveCallerBindingFingerprint(actor.uid),
    authorizedCallerUid: actor.uid,
  });
}

async function claimAndProcessOneStep(
  context: RatingDestructiveStartHandlerContext,
  claimRequest: unknown,
): Promise<RatingDestructiveOperationSummary> {
  const now = currentTime(context.now);
  const claim = context.claim ?? claimRatingDestructiveOperation;
  const claimResult: RatingDestructiveClaimResult = await claim(
    context.processingDependencies,
    claimRequest,
    now,
  );
  let job = claimResult.job;
  if (claimResult.claimed) {
    const processStep = context.processStep ?? processRatingDestructiveJobStep;
    job = (await processStep(
      context.processingDependencies,
      job.jobId,
      now,
    )).job;
  }
  return buildRatingDestructiveOperationSummary(job, {
    accepted: claimResult.claimed,
    mode: "start",
  });
}

function claimHttpsError(error: RatingDestructiveClaimError): never {
  switch (error.code) {
    case "invalid-request":
      throw new HttpsError(
        "invalid-argument",
        "The Rating destructive-operation request is invalid.",
      );
    case "permission-denied":
      throw new HttpsError(
        "permission-denied",
        "The caller cannot start this Rating operation.",
      );
    case "entity-not-found":
      entityNotFound();
    case "stale-revision":
      staleEntity();
    case "operation-conflict":
      throw new HttpsError(
        "failed-precondition",
        "A conflicting Rating operation is already in progress.",
      );
    case "entity-state-incompatible":
    case "revision-exhausted":
    case "generation-exhausted":
    case "malformed-private-state":
      incompatibleEntity();
  }
}

async function fixedErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    if (error instanceof RatingDestructiveClaimError) {
      claimHttpsError(error);
    }
    if (
      error instanceof RatingDestructiveContractError ||
      error instanceof RatingDestructiveProcessError
    ) {
      incompatibleEntity();
    }
    throw new HttpsError(
      "internal",
      "Rating destructive-operation state is unavailable.",
    );
  }
}

export function startRatingRestaurantMergeHandler(
  request: RatingDestructiveCallableRequest,
  context: RatingDestructiveStartHandlerContext,
): Promise<RatingDestructiveOperationSummary> {
  return fixedErrors(async () => {
    const actor = authenticate(request, context);
    requireAdmin(actor);
    const data = parseRatingRestaurantMergeStartRequest(request.data);
    await inspectRestaurantMerge(
      context.privateDatabase,
      data.sourceRestaurantId,
      data.targetRestaurantId,
      data.expectedSourceRestaurantRevision,
      data.expectedTargetRestaurantRevision,
    );
    return claimAndProcessOneStep(context, {
      contractVersion: ratingDestructiveJobVersion,
      requestId: data.clientRequestId,
      operation: "restaurantMerge",
      sourceRestaurantId: data.sourceRestaurantId,
      targetRestaurantId: data.targetRestaurantId,
      expectedSourceRestaurantRevision:
        data.expectedSourceRestaurantRevision,
      expectedTargetRestaurantRevision:
        data.expectedTargetRestaurantRevision,
      ...internalCaller(actor),
    });
  });
}

export function startRatingRestaurantDeleteHandler(
  request: RatingDestructiveCallableRequest,
  context: RatingDestructiveStartHandlerContext,
): Promise<RatingDestructiveOperationSummary> {
  return fixedErrors(async () => {
    const actor = authenticate(request, context);
    requireAdmin(actor);
    const data = parseRatingRestaurantDeleteStartRequest(request.data);
    await inspectRestaurantDelete(
      context.privateDatabase,
      data.restaurantId,
      data.expectedRestaurantRevision,
    );
    return claimAndProcessOneStep(context, {
      contractVersion: ratingDestructiveJobVersion,
      requestId: data.clientRequestId,
      operation: "restaurantDelete",
      sourceRestaurantId: data.restaurantId,
      expectedSourceRestaurantRevision: data.expectedRestaurantRevision,
      ...internalCaller(actor),
    });
  });
}

export function startRatingDishMergeHandler(
  request: RatingDestructiveCallableRequest,
  context: RatingDestructiveStartHandlerContext,
): Promise<RatingDestructiveOperationSummary> {
  return fixedErrors(async () => {
    const actor = authenticate(request, context);
    const data = parseRatingDishMergeStartRequest(request.data);
    const restaurantId = await inspectDishMerge(
      context.privateDatabase,
      data.sourceDishId,
      data.targetDishId,
      actor,
    );
    return claimAndProcessOneStep(context, {
      contractVersion: ratingDestructiveJobVersion,
      requestId: data.clientRequestId,
      operation: "dishMerge",
      sourceDishId: data.sourceDishId,
      targetDishId: data.targetDishId,
      restaurantId,
      ...internalCaller(actor),
    });
  });
}

export function startRatingDishDeleteHandler(
  request: RatingDestructiveCallableRequest,
  context: RatingDestructiveStartHandlerContext,
): Promise<RatingDestructiveOperationSummary> {
  return fixedErrors(async () => {
    const actor = authenticate(request, context);
    requireAdmin(actor);
    const data = parseRatingDishDeleteStartRequest(request.data);
    await inspectDishDelete(context.privateDatabase, data.dishId);
    return claimAndProcessOneStep(context, {
      contractVersion: ratingDestructiveJobVersion,
      requestId: data.clientRequestId,
      operation: "dishDelete",
      sourceDishId: data.dishId,
      ...internalCaller(actor),
    });
  });
}

function statusUnavailable(): never {
  throw new HttpsError(
    "not-found",
    "Rating operation status is unavailable.",
  );
}

async function readExactJob(
  database: RatingDestructivePrivateDatabase,
  jobId: string,
): Promise<RatingDestructiveJobDocument | null> {
  return database.runTransaction(async (transaction) =>
    parseRatingDestructiveJobDocument(contractDocument(
      await transaction.getDocument(ratingDestructiveJobPath(jobId)),
    ))
  );
}

export function getRatingDestructiveOperationStatusHandler(
  request: RatingDestructiveCallableRequest,
  context: RatingDestructiveStatusHandlerContext,
): Promise<RatingDestructiveOperationSummary> {
  return fixedErrors(async () => {
    const actor = authenticate(request, context);
    const data = parseRatingDestructiveStatusRequest(request.data);
    const job = await readExactJob(context.privateDatabase, data.operationId);
    if (job === null) {
      statusUnavailable();
    }
    if (actor.authorizedCallerKind !== "admin") {
      const fingerprint = createRatingDestructiveCallerBindingFingerprint(
        actor.uid,
      );
      if (
        job.authorizedCallerKind !== "owner" ||
        job.callerBindingFingerprint !== fingerprint
      ) {
        statusUnavailable();
      }
    }
    return buildRatingDestructiveOperationSummary(job, {
      accepted: false,
      mode: "status",
    });
  });
}
