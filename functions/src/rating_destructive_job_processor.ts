import type {Firestore} from "firebase-admin/firestore";

import {
  buildRatingDestructiveJobDocument,
  buildRatingDishOperationLockDocument,
  buildRatingRestaurantOperationLockDocument,
  createRatingDestructiveJobItemId,
  createRatingDestructiveJobId,
  parseRatingDestructiveJobDocument,
  ratingDestructiveJobItemPath,
  ratingDestructiveJobPath,
  ratingDestructiveJobVersion,
  ratingDishOperationLockPath,
  ratingRestaurantOperationLockPath,
  RatingDestructiveContractError,
  type RatingDestructiveFailureCode,
  type RatingDestructiveJobDocument,
} from "./rating_destructive_job_contract.js";
import {
  dishMergeReviewLockPath,
  dishMergeReviewLockVersion,
} from "./dish_proposal_private_contract.js";
import {
  buildDishMergeReviewLockDocument,
  nextDishAggregateWriteGenerations,
  parseDishMergeReviewLockDocument,
} from "./dish_proposal_resolution_jobs.js";
import {
  createFirestoreRatingDestructiveExternalSteps,
} from "./rating_destructive_external_steps.js";
import {
  createFirestoreRatingDestructivePrivateDatabase,
  type RatingDestructivePrivateTransaction,
} from "./rating_destructive_job_store.js";
import {
  findActiveDishLockForRestaurant,
  hasBlockingDishProposalJobForDish,
  loadDishOperationLock,
  loadRatingDestructiveJob,
  loadRestaurantOperationLock,
  parseRatingDish,
  parseRatingRestaurant,
  readExactProductIdentity,
  RatingDestructiveProcessError,
  type RatingDestructiveDependencies,
  updateRatingDestructiveJob,
} from "./rating_destructive_job_runtime.js";
import {
  buildInitialDishDeletionItem,
  processStandaloneDishDeleteStep,
} from "./rating_dish_delete_job.js";
import {processDishMergeStep} from "./rating_dish_merge_job.js";
import {processRestaurantDeleteStep} from "./rating_restaurant_delete_job.js";
import {processRestaurantMergeStep} from "./rating_restaurant_merge_job.js";
import {
  nextRestaurantWriteRevision,
} from "./restaurant_write_revision.js";
import {
  ReviewMilestoneReconciliationLockError,
} from "./review_milestone_reconciliation_lock.js";

export type RatingDestructiveClaimRequest =
  | Readonly<{
    contractVersion: typeof ratingDestructiveJobVersion;
    requestId: string;
    operation: "restaurantMerge";
    sourceRestaurantId: string;
    targetRestaurantId: string;
    expectedSourceRestaurantRevision: number;
    expectedTargetRestaurantRevision: number;
  }>
  | Readonly<{
    contractVersion: typeof ratingDestructiveJobVersion;
    requestId: string;
    operation: "restaurantDelete";
    sourceRestaurantId: string;
    expectedSourceRestaurantRevision: number;
  }>
  | Readonly<{
    contractVersion: typeof ratingDestructiveJobVersion;
    requestId: string;
    operation: "dishMerge";
    sourceDishId: string;
    targetDishId: string;
    restaurantId: string;
  }>
  | Readonly<{
    contractVersion: typeof ratingDestructiveJobVersion;
    requestId: string;
    operation: "dishDelete";
    sourceDishId: string;
  }>;

export type RatingDestructiveClaimResult = Readonly<{
  job: RatingDestructiveJobDocument;
  claimed: boolean;
}>;

export class RatingDestructiveClaimError extends Error {
  public readonly code:
    | "invalid-request"
    | "operation-conflict"
    | "entity-not-found"
    | "entity-state-incompatible"
    | "stale-revision"
    | "revision-exhausted"
    | "generation-exhausted"
    | "malformed-private-state";

  public constructor(code: RatingDestructiveClaimError["code"]) {
    super("Rating destructive-operation claim could not be accepted.");
    this.name = "RatingDestructiveClaimError";
    this.code = code;
  }
}

function claimFailure(code: RatingDestructiveClaimError["code"]): never {
  throw new RatingDestructiveClaimError(code);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function exactDocumentId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    claimFailure("invalid-request");
  }
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    claimFailure("invalid-request");
  }
  return value;
}

/** Strict runtime parser for the future internal Admin claim boundary. */
export function parseRatingDestructiveClaimRequest(
  value: unknown,
): RatingDestructiveClaimRequest {
  const data = record(value);
  if (
    data === null ||
    data.contractVersion !== ratingDestructiveJobVersion ||
    typeof data.operation !== "string"
  ) {
    claimFailure("invalid-request");
  }
  const common = {
    contractVersion: ratingDestructiveJobVersion,
    requestId: exactDocumentId(data.requestId),
  } as const;
  switch (data.operation) {
    case "restaurantMerge":
      if (!hasExactKeys(data, [
        "contractVersion", "requestId", "operation", "sourceRestaurantId",
        "targetRestaurantId", "expectedSourceRestaurantRevision",
        "expectedTargetRestaurantRevision",
      ])) {
        claimFailure("invalid-request");
      }
      return Object.freeze({
        ...common,
        operation: "restaurantMerge" as const,
        sourceRestaurantId: exactDocumentId(data.sourceRestaurantId),
        targetRestaurantId: exactDocumentId(data.targetRestaurantId),
        expectedSourceRestaurantRevision: revision(
          data.expectedSourceRestaurantRevision,
        ),
        expectedTargetRestaurantRevision: revision(
          data.expectedTargetRestaurantRevision,
        ),
      });
    case "restaurantDelete":
      if (!hasExactKeys(data, [
        "contractVersion", "requestId", "operation", "sourceRestaurantId",
        "expectedSourceRestaurantRevision",
      ])) {
        claimFailure("invalid-request");
      }
      return Object.freeze({
        ...common,
        operation: "restaurantDelete" as const,
        sourceRestaurantId: exactDocumentId(data.sourceRestaurantId),
        expectedSourceRestaurantRevision: revision(
          data.expectedSourceRestaurantRevision,
        ),
      });
    case "dishMerge":
      if (!hasExactKeys(data, [
        "contractVersion", "requestId", "operation", "sourceDishId",
        "targetDishId", "restaurantId",
      ])) {
        claimFailure("invalid-request");
      }
      return Object.freeze({
        ...common,
        operation: "dishMerge" as const,
        sourceDishId: exactDocumentId(data.sourceDishId),
        targetDishId: exactDocumentId(data.targetDishId),
        restaurantId: exactDocumentId(data.restaurantId),
      });
    case "dishDelete":
      if (!hasExactKeys(data, [
        "contractVersion", "requestId", "operation", "sourceDishId",
      ])) {
        claimFailure("invalid-request");
      }
      return Object.freeze({
        ...common,
        operation: "dishDelete" as const,
        sourceDishId: exactDocumentId(data.sourceDishId),
      });
    default:
      claimFailure("invalid-request");
  }
}

function requireNow(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    claimFailure("invalid-request");
  }
  return new Date(value.getTime());
}

function emptyJobProgress(now: Date) {
  return {
    cursorDocumentId: null,
    itemCursorId: null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
    processedCount: 0,
    phaseProcessedCount: 0,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  } as const;
}

function jobIdForRequest(request: RatingDestructiveClaimRequest): string {
  return createRatingDestructiveJobId({
    requestId: request.requestId,
    operation: request.operation,
    sourceRestaurantId: request.operation === "restaurantMerge" ||
        request.operation === "restaurantDelete"
      ? request.sourceRestaurantId
      : null,
    targetRestaurantId: request.operation === "restaurantMerge"
      ? request.targetRestaurantId
      : null,
    sourceDishId: request.operation === "dishMerge" ||
        request.operation === "dishDelete"
      ? request.sourceDishId
      : null,
    targetDishId: request.operation === "dishMerge"
      ? request.targetDishId
      : null,
    restaurantId: request.operation === "dishMerge"
      ? request.restaurantId
      : null,
  });
}

async function existingJobForRetry(
  transaction: RatingDestructivePrivateTransaction,
  jobId: string,
): Promise<RatingDestructiveJobDocument | null> {
  const document = await transaction.getDocument(ratingDestructiveJobPath(jobId));
  if (document === null) {
    return null;
  }
  try {
    return parseRatingDestructiveJobDocument({
      id: document.id,
      data: document.data,
    });
  } catch {
    claimFailure("malformed-private-state");
  }
}

function existingJobMatchesClaimRequest(
  job: RatingDestructiveJobDocument,
  request: RatingDestructiveClaimRequest,
  jobId: string,
): boolean {
  if (
    job.version !== ratingDestructiveJobVersion ||
    job.jobId !== jobId ||
    job.requestId !== request.requestId ||
    job.operation !== request.operation
  ) {
    return false;
  }
  switch (request.operation) {
    case "restaurantMerge":
      return job.sourceRestaurantId === request.sourceRestaurantId &&
        job.targetRestaurantId === request.targetRestaurantId &&
        job.sourceDishId === null &&
        job.targetDishId === null &&
        job.restaurantId === null &&
        job.expectedSourceRestaurantRevision ===
          request.expectedSourceRestaurantRevision &&
        job.expectedTargetRestaurantRevision ===
          request.expectedTargetRestaurantRevision &&
        job.expectedSourceAggregateGeneration === null &&
        job.expectedTargetAggregateGeneration === null;
    case "restaurantDelete":
      return job.sourceRestaurantId === request.sourceRestaurantId &&
        job.targetRestaurantId === null &&
        job.sourceDishId === null &&
        job.targetDishId === null &&
        job.restaurantId === null &&
        job.expectedSourceRestaurantRevision ===
          request.expectedSourceRestaurantRevision &&
        job.expectedTargetRestaurantRevision === null &&
        job.expectedSourceAggregateGeneration === null &&
        job.expectedTargetAggregateGeneration === null;
    case "dishMerge":
      return job.sourceRestaurantId === null &&
        job.targetRestaurantId === null &&
        job.sourceDishId === request.sourceDishId &&
        job.targetDishId === request.targetDishId &&
        job.restaurantId === request.restaurantId &&
        job.expectedSourceRestaurantRevision === null &&
        job.expectedTargetRestaurantRevision === null;
    case "dishDelete":
      return job.sourceRestaurantId === null &&
        job.targetRestaurantId === null &&
        job.sourceDishId === request.sourceDishId &&
        job.targetDishId === null &&
        job.restaurantId === null &&
        job.expectedSourceRestaurantRevision === null &&
        job.expectedTargetRestaurantRevision === null &&
        job.expectedSourceAggregateGeneration === null &&
        job.expectedTargetAggregateGeneration === null;
  }
}

function revisionPair(current: number): Readonly<{
  active: number;
  completion: number;
}> {
  const active = nextRestaurantWriteRevision(current);
  const completion = active === null
    ? null
    : nextRestaurantWriteRevision(active);
  if (active === null || completion === null) {
    claimFailure("revision-exhausted");
  }
  return {active, completion};
}

async function requireNoRestaurantLock(
  transaction: RatingDestructivePrivateTransaction,
  restaurantId: string,
): Promise<void> {
  let lock;
  try {
    lock = await loadRestaurantOperationLock(transaction, restaurantId);
  } catch {
    claimFailure("malformed-private-state");
  }
  if (lock !== null) {
    claimFailure("operation-conflict");
  }
}

async function requireNoDishLock(
  transaction: RatingDestructivePrivateTransaction,
  dishId: string,
): Promise<void> {
  let lock;
  try {
    lock = await loadDishOperationLock(transaction, dishId);
  } catch {
    claimFailure("malformed-private-state");
  }
  if (lock !== null) {
    claimFailure("operation-conflict");
  }
}

async function requireNoActiveDishWorkForRestaurant(
  transaction: RatingDestructivePrivateTransaction,
  restaurantId: string,
): Promise<void> {
  let lock;
  try {
    lock = await findActiveDishLockForRestaurant(transaction, restaurantId);
  } catch {
    claimFailure("malformed-private-state");
  }
  if (lock !== null) {
    claimFailure("operation-conflict");
  }
}

function parseReviewLock(
  document: Awaited<ReturnType<RatingDestructivePrivateTransaction["getDocument"]>>,
) {
  try {
    return parseDishMergeReviewLockDocument(document);
  } catch {
    claimFailure("malformed-private-state");
  }
}

async function claimRestaurantMerge(
  transaction: RatingDestructivePrivateTransaction,
  request: Extract<
    RatingDestructiveClaimRequest,
    {operation: "restaurantMerge"}
  >,
  jobId: string,
  now: Date,
): Promise<RatingDestructiveJobDocument> {
  if (request.sourceRestaurantId === request.targetRestaurantId) {
    claimFailure("invalid-request");
  }
  await requireNoRestaurantLock(transaction, request.sourceRestaurantId);
  await requireNoRestaurantLock(transaction, request.targetRestaurantId);
  await requireNoActiveDishWorkForRestaurant(
    transaction,
    request.sourceRestaurantId,
  );
  await requireNoActiveDishWorkForRestaurant(
    transaction,
    request.targetRestaurantId,
  );
  const [sourceDocument, targetDocument] = await Promise.all([
    transaction.getDocument(
      `bitescore_restaurants/${request.sourceRestaurantId}`,
    ),
    transaction.getDocument(
      `bitescore_restaurants/${request.targetRestaurantId}`,
    ),
  ]);
  const source = parseRatingRestaurant(sourceDocument);
  const target = parseRatingRestaurant(targetDocument);
  if (source === null || target === null) {
    claimFailure("entity-not-found");
  }
  if (
    source.revision !== request.expectedSourceRestaurantRevision ||
    target.revision !== request.expectedTargetRestaurantRevision
  ) {
    claimFailure("stale-revision");
  }
  if (!target.isActive) {
    claimFailure("entity-state-incompatible");
  }
  const sourceRevisions = revisionPair(source.revision);
  const targetRevisions = revisionPair(target.revision);
  const job = buildRatingDestructiveJobDocument({
    ...emptyJobProgress(now),
    jobId,
    requestId: request.requestId,
    operation: "restaurantMerge",
    status: "active",
    phase: "claimed",
    sourceRestaurantId: request.sourceRestaurantId,
    targetRestaurantId: request.targetRestaurantId,
    sourceDishId: null,
    targetDishId: null,
    restaurantId: null,
    expectedSourceRestaurantRevision: source.revision,
    sourceActiveRestaurantRevision: sourceRevisions.active,
    sourceCompletionRestaurantRevision: sourceRevisions.completion,
    expectedTargetRestaurantRevision: target.revision,
    targetActiveRestaurantRevision: targetRevisions.active,
    targetCompletionRestaurantRevision: targetRevisions.completion,
    expectedSourceAggregateGeneration: null,
    sourceActiveAggregateGeneration: null,
    sourceCompletionAggregateGeneration: null,
    expectedTargetAggregateGeneration: null,
    targetActiveAggregateGeneration: null,
    targetCompletionAggregateGeneration: null,
  });
  transaction.setDocument(
    `bitescore_restaurants/${request.sourceRestaurantId}`,
    {restaurantWriteRevision: sourceRevisions.active, updatedAt: now},
    {merge: true},
  );
  transaction.setDocument(
    `bitescore_restaurants/${request.targetRestaurantId}`,
    {restaurantWriteRevision: targetRevisions.active, updatedAt: now},
    {merge: true},
  );
  transaction.setDocument(
    ratingRestaurantOperationLockPath(request.sourceRestaurantId),
    buildRatingRestaurantOperationLockDocument({
      restaurantId: request.sourceRestaurantId,
      jobId,
      operation: "restaurantMerge",
      role: "source",
      state: "active_source",
      active: true,
      permanent: false,
      targetRestaurantId: request.targetRestaurantId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  transaction.setDocument(
    ratingRestaurantOperationLockPath(request.targetRestaurantId),
    buildRatingRestaurantOperationLockDocument({
      restaurantId: request.targetRestaurantId,
      jobId,
      operation: "restaurantMerge",
      role: "target",
      state: "active_target",
      active: true,
      permanent: false,
      targetRestaurantId: null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  transaction.setDocument(ratingDestructiveJobPath(jobId), job);
  return job;
}

async function claimRestaurantDelete(
  transaction: RatingDestructivePrivateTransaction,
  request: Extract<
    RatingDestructiveClaimRequest,
    {operation: "restaurantDelete"}
  >,
  jobId: string,
  now: Date,
): Promise<RatingDestructiveJobDocument> {
  await requireNoRestaurantLock(transaction, request.sourceRestaurantId);
  await requireNoActiveDishWorkForRestaurant(
    transaction,
    request.sourceRestaurantId,
  );
  const source = parseRatingRestaurant(await transaction.getDocument(
    `bitescore_restaurants/${request.sourceRestaurantId}`,
  ));
  if (source === null) {
    claimFailure("entity-not-found");
  }
  if (source.revision !== request.expectedSourceRestaurantRevision) {
    claimFailure("stale-revision");
  }
  const activeRevision = nextRestaurantWriteRevision(source.revision);
  if (activeRevision === null) {
    claimFailure("revision-exhausted");
  }
  const job = buildRatingDestructiveJobDocument({
    ...emptyJobProgress(now),
    jobId,
    requestId: request.requestId,
    operation: "restaurantDelete",
    status: "active",
    phase: "claimed",
    sourceRestaurantId: request.sourceRestaurantId,
    targetRestaurantId: null,
    sourceDishId: null,
    targetDishId: null,
    restaurantId: null,
    expectedSourceRestaurantRevision: source.revision,
    sourceActiveRestaurantRevision: activeRevision,
    sourceCompletionRestaurantRevision: null,
    expectedTargetRestaurantRevision: null,
    targetActiveRestaurantRevision: null,
    targetCompletionRestaurantRevision: null,
    expectedSourceAggregateGeneration: null,
    sourceActiveAggregateGeneration: null,
    sourceCompletionAggregateGeneration: null,
    expectedTargetAggregateGeneration: null,
    targetActiveAggregateGeneration: null,
    targetCompletionAggregateGeneration: null,
  });
  transaction.setDocument(
    `bitescore_restaurants/${request.sourceRestaurantId}`,
    {restaurantWriteRevision: activeRevision, updatedAt: now},
    {merge: true},
  );
  transaction.setDocument(
    ratingRestaurantOperationLockPath(request.sourceRestaurantId),
    buildRatingRestaurantOperationLockDocument({
      restaurantId: request.sourceRestaurantId,
      jobId,
      operation: "restaurantDelete",
      role: "source",
      state: "active_source",
      active: true,
      permanent: false,
      targetRestaurantId: null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  transaction.setDocument(ratingDestructiveJobPath(jobId), job);
  return job;
}

async function claimDishMerge(
  transaction: RatingDestructivePrivateTransaction,
  request: Extract<RatingDestructiveClaimRequest, {operation: "dishMerge"}>,
  jobId: string,
  now: Date,
): Promise<RatingDestructiveJobDocument> {
  if (request.sourceDishId === request.targetDishId) {
    claimFailure("invalid-request");
  }
  await requireNoRestaurantLock(transaction, request.restaurantId);
  await requireNoDishLock(transaction, request.sourceDishId);
  await requireNoDishLock(transaction, request.targetDishId);
  const [
    sourceDocument,
    targetDocument,
    sourceReviewLockDocument,
    targetReviewLockDocument,
    sourceProposalWork,
    targetProposalWork,
  ] = await Promise.all([
    transaction.getDocument(`bitescore_dishes/${request.sourceDishId}`),
    transaction.getDocument(`bitescore_dishes/${request.targetDishId}`),
    transaction.getDocument(dishMergeReviewLockPath(request.sourceDishId)),
    transaction.getDocument(dishMergeReviewLockPath(request.targetDishId)),
    hasBlockingDishProposalJobForDish(transaction, request.sourceDishId),
    hasBlockingDishProposalJobForDish(transaction, request.targetDishId),
  ]);
  const source = parseRatingDish(sourceDocument);
  const target = parseRatingDish(targetDocument);
  if (source === null || target === null) {
    claimFailure("entity-not-found");
  }
  if (
    source.restaurantId !== request.restaurantId ||
    target.restaurantId !== request.restaurantId ||
    !source.isActive ||
    !target.isActive ||
    source.mergedIntoDishId !== null ||
    target.mergedIntoDishId !== null
  ) {
    claimFailure("entity-state-incompatible");
  }
  if (
    parseReviewLock(sourceReviewLockDocument) !== null ||
    parseReviewLock(targetReviewLockDocument) !== null ||
    sourceProposalWork ||
    targetProposalWork
  ) {
    claimFailure("operation-conflict");
  }
  let sourceGenerations;
  let targetGenerations;
  try {
    sourceGenerations = nextDishAggregateWriteGenerations(
      source.aggregateWriteGeneration,
    );
    targetGenerations = nextDishAggregateWriteGenerations(
      target.aggregateWriteGeneration,
    );
  } catch {
    claimFailure("generation-exhausted");
  }
  const job = buildRatingDestructiveJobDocument({
    ...emptyJobProgress(now),
    jobId,
    requestId: request.requestId,
    operation: "dishMerge",
    status: "active",
    phase: "validate",
    sourceRestaurantId: null,
    targetRestaurantId: null,
    sourceDishId: request.sourceDishId,
    targetDishId: request.targetDishId,
    restaurantId: request.restaurantId,
    expectedSourceRestaurantRevision: null,
    sourceActiveRestaurantRevision: null,
    sourceCompletionRestaurantRevision: null,
    expectedTargetRestaurantRevision: null,
    targetActiveRestaurantRevision: null,
    targetCompletionRestaurantRevision: null,
    expectedSourceAggregateGeneration: source.aggregateWriteGeneration,
    sourceActiveAggregateGeneration: sourceGenerations.active,
    sourceCompletionAggregateGeneration: sourceGenerations.completion,
    expectedTargetAggregateGeneration: target.aggregateWriteGeneration,
    targetActiveAggregateGeneration: targetGenerations.active,
    targetCompletionAggregateGeneration: targetGenerations.completion,
  });
  transaction.setDocument(`bitescore_dishes/${request.sourceDishId}`, {
    aggregateWriteGeneration: sourceGenerations.active,
    updatedAt: now,
  }, {merge: true});
  transaction.setDocument(`bitescore_dishes/${request.targetDishId}`, {
    aggregateWriteGeneration: targetGenerations.active,
    updatedAt: now,
  }, {merge: true});
  transaction.setDocument(
    ratingDishOperationLockPath(request.sourceDishId),
    buildRatingDishOperationLockDocument({
      dishId: request.sourceDishId,
      jobId,
      operation: "dishMerge",
      role: "source",
      state: "active_source",
      active: true,
      permanent: false,
      restaurantId: request.restaurantId,
      targetDishId: request.targetDishId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  transaction.setDocument(
    ratingDishOperationLockPath(request.targetDishId),
    buildRatingDishOperationLockDocument({
      dishId: request.targetDishId,
      jobId,
      operation: "dishMerge",
      role: "target",
      state: "active_target",
      active: true,
      permanent: false,
      restaurantId: request.restaurantId,
      targetDishId: null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  transaction.setDocument(
    dishMergeReviewLockPath(request.sourceDishId),
    buildDishMergeReviewLockDocument({
      version: dishMergeReviewLockVersion,
      dishId: request.sourceDishId,
      jobId,
      groupId: jobId,
      role: "source",
      state: "active",
      blocksClientReviews: true,
      blocksClientAggregates: true,
      activeAggregateWriteGeneration: sourceGenerations.active,
      completionAggregateWriteGeneration: sourceGenerations.completion,
      targetDishId: request.targetDishId,
      createdAt: now,
      indexedAt: now,
    }),
  );
  transaction.setDocument(
    dishMergeReviewLockPath(request.targetDishId),
    buildDishMergeReviewLockDocument({
      version: dishMergeReviewLockVersion,
      dishId: request.targetDishId,
      jobId,
      groupId: jobId,
      role: "target",
      state: "active",
      blocksClientReviews: true,
      blocksClientAggregates: true,
      activeAggregateWriteGeneration: targetGenerations.active,
      completionAggregateWriteGeneration: targetGenerations.completion,
      targetDishId: null,
      createdAt: now,
      indexedAt: now,
    }),
  );
  transaction.setDocument(ratingDestructiveJobPath(jobId), job);
  return job;
}

async function claimDishDelete(
  transaction: RatingDestructivePrivateTransaction,
  request: Extract<RatingDestructiveClaimRequest, {operation: "dishDelete"}>,
  jobId: string,
  now: Date,
): Promise<RatingDestructiveJobDocument> {
  const dishDocument = await transaction.getDocument(
    `bitescore_dishes/${request.sourceDishId}`,
  );
  const restaurantId = dishDocument === null
    ? null
    : readExactProductIdentity(dishDocument.data.restaurantId);
  if (dishDocument !== null && restaurantId === null) {
    claimFailure("entity-state-incompatible");
  }
  if (restaurantId !== null) {
    await requireNoRestaurantLock(transaction, restaurantId);
  }
  let existingDishLock;
  try {
    existingDishLock = await loadDishOperationLock(
      transaction,
      request.sourceDishId,
    );
  } catch {
    claimFailure("malformed-private-state");
  }
  if (
    existingDishLock !== null &&
    !(
      !existingDishLock.active &&
      existingDishLock.permanent &&
      existingDishLock.state === "merged_source"
    )
  ) {
    claimFailure("operation-conflict");
  }
  const reviewLock = parseReviewLock(await transaction.getDocument(
    dishMergeReviewLockPath(request.sourceDishId),
  ));
  if (reviewLock?.state === "active") {
    claimFailure("operation-conflict");
  }
  if (await hasBlockingDishProposalJobForDish(
    transaction,
    request.sourceDishId,
  )) {
    claimFailure("operation-conflict");
  }
  const itemId = createRatingDestructiveJobItemId({
    jobId,
    operation: "dishDelete",
    kind: "dishDeletion",
    restaurantId,
    dishId: request.sourceDishId,
    userId: null,
  });
  const job = buildRatingDestructiveJobDocument({
    ...emptyJobProgress(now),
    jobId,
    requestId: request.requestId,
    operation: "dishDelete",
    status: "active",
    phase: "process_reviews",
    sourceRestaurantId: null,
    targetRestaurantId: null,
    sourceDishId: request.sourceDishId,
    targetDishId: null,
    restaurantId: null,
    expectedSourceRestaurantRevision: null,
    sourceActiveRestaurantRevision: null,
    sourceCompletionRestaurantRevision: null,
    expectedTargetRestaurantRevision: null,
    targetActiveRestaurantRevision: null,
    targetCompletionRestaurantRevision: null,
    expectedSourceAggregateGeneration: null,
    sourceActiveAggregateGeneration: null,
    sourceCompletionAggregateGeneration: null,
    expectedTargetAggregateGeneration: null,
    targetActiveAggregateGeneration: null,
    targetCompletionAggregateGeneration: null,
    itemCursorId: itemId,
  });
  const item = buildInitialDishDeletionItem(job, {
    dishId: request.sourceDishId,
    restaurantId,
    now,
  });
  if (item.itemId !== itemId) {
    claimFailure("malformed-private-state");
  }
  transaction.setDocument(
    ratingDishOperationLockPath(request.sourceDishId),
    buildRatingDishOperationLockDocument({
      dishId: request.sourceDishId,
      jobId,
      operation: "dishDelete",
      role: "source",
      state: "active_source",
      active: true,
      permanent: false,
      restaurantId,
      targetDishId: null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  transaction.setDocument(
    ratingDestructiveJobItemPath(item.itemId),
    item,
  );
  transaction.setDocument(ratingDestructiveJobPath(jobId), job);
  return job;
}

/**
 * Transactionally claims exactly one of the four allowlisted operations.
 * This is intentionally not exported from the deployed Functions index.
 */
export async function claimRatingDestructiveOperation(
  dependencies: RatingDestructiveDependencies,
  requestValue: unknown,
  nowValue: Date,
): Promise<RatingDestructiveClaimResult> {
  const request = parseRatingDestructiveClaimRequest(requestValue);
  const now = requireNow(nowValue);
  let jobId: string;
  try {
    jobId = jobIdForRequest(request);
  } catch (error) {
    if (error instanceof RatingDestructiveContractError) {
      claimFailure("invalid-request");
    }
    throw error;
  }
  return dependencies.database.runTransaction(async (transaction) => {
    const existing = await existingJobForRetry(transaction, jobId);
    if (existing !== null) {
      if (!existingJobMatchesClaimRequest(existing, request, jobId)) {
        claimFailure("operation-conflict");
      }
      return {job: existing, claimed: false};
    }
    let job: RatingDestructiveJobDocument;
    switch (request.operation) {
      case "restaurantMerge":
        job = await claimRestaurantMerge(
          transaction,
          request,
          jobId,
          now,
        );
        break;
      case "restaurantDelete":
        job = await claimRestaurantDelete(
          transaction,
          request,
          jobId,
          now,
        );
        break;
      case "dishMerge":
        job = await claimDishMerge(transaction, request, jobId, now);
        break;
      case "dishDelete":
        job = await claimDishDelete(transaction, request, jobId, now);
        break;
    }
    return {job, claimed: true};
  });
}

function transientFirestoreFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as {code?: unknown}).code;
  return code === "aborted" || code === 10 ||
    code === "unavailable" || code === 14 ||
    code === "deadline-exceeded" || code === 4 ||
    code === "resource-exhausted" || code === 8;
}

function failureStateForCode(
  failureCode: RatingDestructiveFailureCode,
): Readonly<{
  status: "retryable" | "manual_review_required";
  failureCode: RatingDestructiveFailureCode;
}> {
  switch (failureCode) {
    case "temporary_dependency":
    case "preexisting_job_active":
      return {status: "retryable", failureCode};
    case "operation_conflict":
    case "malformed_private_state":
    case "entity_state_incompatible":
    case "lock_missing":
    case "revision_exhausted":
    case "generation_exhausted":
    case "unsupported_partial_state":
      return {status: "manual_review_required", failureCode};
  }
  const exhaustiveFailureCode: never = failureCode;
  return exhaustiveFailureCode;
}

function failureState(error: unknown): ReturnType<typeof failureStateForCode> {
  if (error instanceof RatingDestructiveProcessError) {
    return failureStateForCode(error.code);
  }
  if (error instanceof ReviewMilestoneReconciliationLockError) {
    return failureStateForCode(error.code === "conflict"
      ? "preexisting_job_active"
      : "malformed_private_state");
  }
  if (error instanceof RatingDestructiveContractError) {
    return failureStateForCode("malformed_private_state");
  }
  if (transientFirestoreFailure(error)) {
    return failureStateForCode("temporary_dependency");
  }
  return failureStateForCode("temporary_dependency");
}

/** Advances at most one bounded work unit and never auto-runs manual jobs. */
export async function processRatingDestructiveJobStep(
  dependencies: RatingDestructiveDependencies,
  jobId: string,
  nowValue: Date,
): Promise<Readonly<{
  job: RatingDestructiveJobDocument;
  processedDocuments: number;
}>> {
  exactDocumentId(jobId);
  const now = requireNow(nowValue);
  let job = await dependencies.database.runTransaction(async (transaction) =>
    loadRatingDestructiveJob(transaction, jobId)
  );
  if (
    job.status === "complete" ||
    job.status === "manual_review_required"
  ) {
    return {job, processedDocuments: 0};
  }
  if (job.status === "retryable") {
    job = await dependencies.database.runTransaction(async (transaction) => {
      const current = await loadRatingDestructiveJob(transaction, jobId);
      if (current.status !== "retryable") {
        return current;
      }
      return updateRatingDestructiveJob(transaction, current, {
        status: "active",
        failureCode: null,
      }, now);
    });
  }
  try {
    switch (job.operation) {
      case "restaurantMerge":
        return await processRestaurantMergeStep(dependencies, job, now);
      case "restaurantDelete":
        return await processRestaurantDeleteStep(dependencies, job, now);
      case "dishMerge":
        return await processDishMergeStep(dependencies, job, now);
      case "dishDelete":
        return await processStandaloneDishDeleteStep(dependencies, job, now);
    }
  } catch (error) {
    const failure = failureState(error);
    try {
      const failed = await dependencies.database.runTransaction(
        async (transaction) => {
          const current = await loadRatingDestructiveJob(transaction, jobId);
          if (
            current.status !== "active" ||
            current.phase !== job.phase ||
            current.fingerprint !== job.fingerprint
          ) {
            return current;
          }
          return updateRatingDestructiveJob(transaction, current, failure, now);
        },
      );
      return {job: failed, processedDocuments: 0};
    } catch {
      throw error;
    }
  }
}

/** Production dependency factory; no callable/scheduler is registered here. */
export function createFirestoreRatingDestructiveDependencies(
  firestore: Firestore,
): RatingDestructiveDependencies {
  return Object.freeze({
    database: createFirestoreRatingDestructivePrivateDatabase(firestore),
    external: createFirestoreRatingDestructiveExternalSteps(firestore),
  });
}
