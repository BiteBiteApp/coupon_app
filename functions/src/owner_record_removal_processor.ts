import {
  nextRestaurantWriteRevision,
  readRestaurantWriteRevision,
} from "./restaurant_write_revision.js";
import {
  parseRatingRestaurantOperationLockDocument,
  ratingRestaurantOperationLockPath,
} from "./rating_destructive_job_contract.js";
import {
  listSubscriptionReturnEvents,
  subscriptionReturnLedgerCollection,
} from "./subscription_return_ledger.js";
import {
  nextOwnerRecordRemovalPhase,
  ownerRecordRemovalJobPath,
  parseOwnerRecordRemovalJobDocument,
  rebuildOwnerRecordRemovalJobDocument,
  requireOwnerRecordRemovalJobId,
  type OwnerRecordRemovalCounterField,
  type OwnerRecordRemovalFailureCategory,
  type OwnerRecordRemovalJobDocument,
  type OwnerRecordRemovalPhase,
} from "./owner_record_removal_contract.js";
import {
  ownerRecordStateCollection,
  parseOwnerRecordStateDocument,
  buildOwnerRecordStateDocument,
  type OwnerRecordStateDocument,
} from "./owner_record_state_contract.js";
import {
  type OwnerRecordRemovalPrivateDatabase,
  type OwnerRecordRemovalPrivateTransaction,
  type OwnerRecordRemovalStoredDocument,
} from "./owner_record_removal_store.js";
import {
  ownerRecordRemovalStorageDeleteFailureCode,
  ownerRecordRemovalStoragePageLimit,
  ownerRecordRemovalStorageRemnantLimit,
  validateOwnerRecordRemovalStorageDeleteResult,
  validateOwnerRecordRemovalStorageFirstPage,
  type OwnerRecordRemovalStorageBoundary,
  type OwnerRecordRemovalStorageKind,
} from "./owner_record_removal_storage.js";

export const ownerRecordRemovalRatingPageLimit = 50 as const;
export const ownerRecordRemovalChildPageLimit = 100 as const;
export const ownerRecordRemovalDirectDocumentLimit = 1 as const;
export const ownerRecordRemovalRemnantLimit = 1 as const;

export const ownerRecordRemovalRatingRestaurantCollection =
  "bitescore_restaurants" as const;
export const ownerRecordRemovalAccountCollection =
  "restaurant_accounts" as const;

type ChildPhaseDefinition = Readonly<{
  phase: OwnerRecordRemovalPhase;
  collection: string;
  counter: OwnerRecordRemovalCounterField;
}>;

/** The complete and only account-local Firestore deletion allowlist. */
export const ownerRecordRemovalChildPhases: readonly ChildPhaseDefinition[] =
  Object.freeze([
    Object.freeze({
      phase: "delete_coupons",
      collection: "coupons",
      counter: "couponsDeleted",
    }),
    Object.freeze({
      phase: "delete_daily_specials",
      collection: "daily_specials",
      counter: "dailySpecialsDeleted",
    }),
    Object.freeze({
      phase: "delete_coupon_number_reservations",
      collection: "coupon_number_reservations",
      counter: "couponNumberReservationsDeleted",
    }),
    Object.freeze({
      phase: "delete_coupon_code_reservations",
      collection: "coupon_code_reservations",
      counter: "couponCodeReservationsDeleted",
    }),
    Object.freeze({
      phase: "delete_account_menu_images",
      collection: "menu_images",
      counter: "accountMenuImagesDeleted",
    }),
    Object.freeze({
      phase: "delete_account_menu_items",
      collection: "menu_items",
      counter: "accountMenuItemsDeleted",
    }),
    Object.freeze({
      phase: "delete_account_menu_sections",
      collection: "menu_sections",
      counter: "accountMenuSectionsDeleted",
    }),
  ]);

type StoragePhaseDefinition = Readonly<{
  phase: OwnerRecordRemovalPhase;
  kind: OwnerRecordRemovalStorageKind;
  counter: OwnerRecordRemovalCounterField;
}>;

export const ownerRecordRemovalStoragePhases:
readonly StoragePhaseDefinition[] = Object.freeze([
  Object.freeze({
    phase: "delete_storage_restaurant_images",
    kind: "restaurant_images",
    counter: "storageRestaurantImagesDeleted",
  }),
  Object.freeze({
    phase: "delete_storage_coupon_images",
    kind: "coupon_images",
    counter: "storageCouponImagesDeleted",
  }),
  Object.freeze({
    phase: "delete_storage_menu_images",
    kind: "menu_images",
    counter: "storageMenuImagesDeleted",
  }),
]);

export type OwnerRecordRemovalProcessContext = Readonly<{
  database: OwnerRecordRemovalPrivateDatabase;
  storage: OwnerRecordRemovalStorageBoundary;
  clock?: () => Date;
}>;

export type OwnerRecordRemovalFailureDisposition = "retryable" | "manual";

export class OwnerRecordRemovalProcessError extends Error {
  public readonly code: OwnerRecordRemovalFailureCategory;
  public readonly disposition: OwnerRecordRemovalFailureDisposition;

  public constructor(
    code: OwnerRecordRemovalFailureCategory,
    disposition: OwnerRecordRemovalFailureDisposition,
  ) {
    super("Owner-record removal work could not advance safely.");
    this.name = "OwnerRecordRemovalProcessError";
    this.code = code;
    this.disposition = disposition;
  }
}

class StaleOwnerRecordRemovalWorkerError extends Error {
  public constructor() {
    super("Owner-record removal worker snapshot is stale.");
    this.name = "StaleOwnerRecordRemovalWorkerError";
  }
}

function processFailure(
  code: OwnerRecordRemovalFailureCategory,
  disposition: OwnerRecordRemovalFailureDisposition = "manual",
): never {
  throw new OwnerRecordRemovalProcessError(code, disposition);
}

function staleWorker(): never {
  throw new StaleOwnerRecordRemovalWorkerError();
}

function nowFrom(clock: (() => Date) | undefined): Date {
  const value = clock?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return processFailure("temporary_dependency", "retryable");
  }
  return new Date(value.getTime());
}

function ownerStatePath(targetUid: string): string {
  return `${ownerRecordStateCollection}/${targetUid}`;
}

function accountRootPath(targetUid: string): string {
  return `${ownerRecordRemovalAccountCollection}/${targetUid}`;
}

function childCollectionPath(
  targetUid: string,
  collection: string,
): string {
  return `${accountRootPath(targetUid)}/${collection}`;
}

function childDocumentPath(
  targetUid: string,
  collection: string,
  documentId: string,
): string {
  return `${childCollectionPath(targetUid, collection)}/${documentId}`;
}

function ratingRestaurantPath(restaurantId: string): string {
  return `${ownerRecordRemovalRatingRestaurantCollection}/${restaurantId}`;
}

function subscriptionReturnPath(targetUid: string): string {
  return `${subscriptionReturnLedgerCollection}/${targetUid}`;
}

function exactDocumentId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    return processFailure("malformed_private_state");
  }
  return value;
}

function strictPage(
  value: readonly OwnerRecordRemovalStoredDocument[],
  limit: number,
): readonly OwnerRecordRemovalStoredDocument[] {
  if (!Array.isArray(value) || value.length > limit) {
    return processFailure("unsupported_partial_state");
  }
  const ids = new Set<string>();
  for (const document of value) {
    const id = exactDocumentId(document?.id);
    if (
      ids.has(id) ||
      document === null ||
      typeof document !== "object" ||
      document.data === null ||
      typeof document.data !== "object" ||
      Array.isArray(document.data)
    ) {
      return processFailure("malformed_private_state");
    }
    ids.add(id);
  }
  return value;
}

function sourceGeneration(
  data: Readonly<Record<string, unknown>>,
  expected: number,
): number {
  if (!Object.prototype.hasOwnProperty.call(data, "ownerRecordGeneration")) {
    return processFailure("record_generation_missing");
  }
  const value = data.ownerRecordGeneration;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return processFailure("record_generation_missing");
  }
  if (value > expected) {
    return processFailure("newer_generation_record_found");
  }
  if (value < expected) {
    return processFailure("generation_mismatch");
  }
  return value;
}

function incrementCounter(current: number, delta: number): number {
  if (
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(delta) ||
    current < 0 ||
    delta < 0 ||
    current > Number.MAX_SAFE_INTEGER - delta
  ) {
    return processFailure("unsupported_partial_state");
  }
  return current + delta;
}

function parseJobDocument(
  document: OwnerRecordRemovalStoredDocument | null,
): OwnerRecordRemovalJobDocument {
  try {
    const job = parseOwnerRecordRemovalJobDocument(document);
    if (job === null) {
      return processFailure("malformed_private_state");
    }
    return job;
  } catch {
    return processFailure("malformed_private_state");
  }
}

function parseOwnerDocument(
  document: OwnerRecordRemovalStoredDocument | null,
): OwnerRecordStateDocument {
  try {
    const owner = parseOwnerRecordStateDocument(document);
    if (owner === null) {
      return processFailure("malformed_private_state");
    }
    return owner;
  } catch {
    return processFailure("malformed_private_state");
  }
}

function requireExpectedJob(
  current: OwnerRecordRemovalJobDocument,
  expected: OwnerRecordRemovalJobDocument,
): void {
  if (
    current.jobId !== expected.jobId ||
    current.fingerprint !== expected.fingerprint ||
    current.phase !== expected.phase ||
    current.status !== expected.status ||
    (current.status !== "active" && current.status !== "retryable")
  ) {
    staleWorker();
  }
}

function requireExpectedOwner(
  owner: OwnerRecordStateDocument,
  job: OwnerRecordRemovalJobDocument,
): void {
  if (
    owner.ownerUid !== job.targetUid ||
    owner.state !== "removing" ||
    owner.activeJobId !== job.jobId ||
    job.completionGeneration === null ||
    owner.generation !== job.completionGeneration
  ) {
    processFailure("generation_mismatch");
  }
}

async function requireFreshWorker(
  transaction: OwnerRecordRemovalPrivateTransaction,
  expected: OwnerRecordRemovalJobDocument,
): Promise<Readonly<{
  job: OwnerRecordRemovalJobDocument;
  owner: OwnerRecordStateDocument;
}>> {
  const job = parseJobDocument(await transaction.getDocument(
    ownerRecordRemovalJobPath(expected.jobId),
  ));
  requireExpectedJob(job, expected);
  const owner = parseOwnerDocument(await transaction.getDocument(
    ownerStatePath(job.targetUid),
  ));
  requireExpectedOwner(owner, job);
  return Object.freeze({job, owner});
}

function rebuildActiveJob(
  transaction: OwnerRecordRemovalPrivateTransaction,
  job: OwnerRecordRemovalJobDocument,
  now: Date,
  updates: Readonly<Record<string, unknown>>,
): OwnerRecordRemovalJobDocument {
  const next = rebuildOwnerRecordRemovalJobDocument(job, {
    ...updates,
    status: "active",
    failureCategory: null,
    now,
  });
  transaction.setDocument(ownerRecordRemovalJobPath(job.jobId), next);
  return next;
}

function advancePhase(
  transaction: OwnerRecordRemovalPrivateTransaction,
  job: OwnerRecordRemovalJobDocument,
  now: Date,
): OwnerRecordRemovalJobDocument {
  const nextPhase = nextOwnerRecordRemovalPhase(job.phase);
  if (nextPhase === null) {
    return processFailure("unsupported_partial_state");
  }
  return rebuildActiveJob(transaction, job, now, {phase: nextPhase});
}

function routePhase(
  transaction: OwnerRecordRemovalPrivateTransaction,
  job: OwnerRecordRemovalJobDocument,
  phase: OwnerRecordRemovalPhase,
  now: Date,
): OwnerRecordRemovalJobDocument {
  return rebuildActiveJob(transaction, job, now, {phase});
}

function isSourceCompatibleRetryable(
  job: OwnerRecordRemovalJobDocument,
): boolean {
  if (job.status !== "retryable") {
    return true;
  }
  if (
    job.phase === "finalize_owner_state" &&
    job.failureCategory === "temporary_dependency"
  ) {
    return true;
  }
  if (job.failureCategory === "temporary_dependency") {
    return job.phase !== "finalize_owner_state";
  }
  if (
    job.failureCategory === "restaurant_lock_conflict" &&
    job.phase === "unclaim_rating_restaurants"
  ) {
    return true;
  }
  return job.failureCategory === "storage_generation_mismatch" &&
    ownerRecordRemovalStoragePhases.some(
      (definition) => definition.phase === job.phase,
    );
}

async function loadCurrentJob(
  database: OwnerRecordRemovalPrivateDatabase,
  jobId: string,
): Promise<OwnerRecordRemovalJobDocument> {
  return database.runTransaction(async (transaction) => parseJobDocument(
    await transaction.getDocument(ownerRecordRemovalJobPath(jobId)),
  ));
}

async function assertFreshOutsideMutation(
  database: OwnerRecordRemovalPrivateDatabase,
  expected: OwnerRecordRemovalJobDocument,
): Promise<void> {
  await database.runTransaction(async (transaction) => {
    await requireFreshWorker(transaction, expected);
  });
}

async function reactivateFinalizationRetry(
  database: OwnerRecordRemovalPrivateDatabase,
  expected: OwnerRecordRemovalJobDocument,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  return database.runTransaction(async (transaction) => {
    const {job} = await requireFreshWorker(transaction, expected);
    if (
      job.status !== "retryable" ||
      job.phase !== "finalize_owner_state" ||
      job.failureCategory !== "temporary_dependency"
    ) {
      return processFailure("unsupported_partial_state");
    }
    return rebuildActiveJob(transaction, job, now, {});
  });
}

async function processRatingPage(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  return context.database.runTransaction(async (transaction) => {
    const {job} = await requireFreshWorker(transaction, expected);
    const selected = strictPage(await transaction.queryDocuments({
      collectionPath: ownerRecordRemovalRatingRestaurantCollection,
      where: Object.freeze([{
        field: "ownerUserId",
        operator: "==",
        value: job.targetUid,
      }]),
      orderByDocumentId: "asc",
      limit: ownerRecordRemovalRatingPageLimit,
    }), ownerRecordRemovalRatingPageLimit);

    if (selected.length === 0) {
      const remnant = strictPage(await transaction.queryDocuments({
        collectionPath: ownerRecordRemovalRatingRestaurantCollection,
        where: Object.freeze([{
          field: "ownerUserId",
          operator: "==",
          value: job.targetUid,
        }]),
        orderByDocumentId: "asc",
        limit: ownerRecordRemovalRemnantLimit,
      }), ownerRecordRemovalRemnantLimit);
      if (remnant.length !== 0) {
        return processFailure("temporary_dependency", "retryable");
      }
      return advancePhase(transaction, job, now);
    }

    const patches: Readonly<{
      path: string;
      data: Readonly<Record<string, unknown>>;
    }>[] = [];
    const mutablePatches: {
      path: string;
      data: Readonly<Record<string, unknown>>;
    }[] = [];
    for (const selectedDocument of selected) {
      const restaurantId = exactDocumentId(selectedDocument.id);
      const path = ratingRestaurantPath(restaurantId);
      const current = await transaction.getDocument(path);
      if (current === null || current.data.ownerUserId !== job.targetUid) {
        continue;
      }
      sourceGeneration(current.data, job.sourceGeneration);
      const revision = readRestaurantWriteRevision(current.data);
      const nextRevision = revision === null
        ? null
        : nextRestaurantWriteRevision(revision);
      if (nextRevision === null) {
        return processFailure("unsupported_partial_state");
      }
      let lock;
      try {
        lock = parseRatingRestaurantOperationLockDocument(
          await transaction.getDocument(
            ratingRestaurantOperationLockPath(restaurantId),
          ),
        );
      } catch {
        return processFailure("malformed_private_state");
      }
      if (lock !== null) {
        return processFailure(
          "restaurant_lock_conflict",
          lock.active ? "retryable" : "manual",
        );
      }
      mutablePatches.push(Object.freeze({
        path,
        data: Object.freeze({
          ownerUserId: null,
          isClaimed: false,
          ownerRecordGeneration: null,
          restaurantWriteRevision: nextRevision,
          updatedAt: now,
        }),
      }));
    }
    patches.push(...mutablePatches);
    for (const patch of patches) {
      transaction.setDocument(patch.path, patch.data, {merge: true});
    }
    const count = incrementCounter(
      job.ratingRestaurantsUnclaimed,
      patches.length,
    );
    return rebuildActiveJob(transaction, job, now, {
      ratingRestaurantsUnclaimed: count,
    });
  });
}

async function processChildPage(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  definition: ChildPhaseDefinition,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  return context.database.runTransaction(async (transaction) => {
    const {job} = await requireFreshWorker(transaction, expected);
    const collectionPath = childCollectionPath(
      job.targetUid,
      definition.collection,
    );
    const selected = strictPage(await transaction.queryDocuments({
      collectionPath,
      orderByDocumentId: "asc",
      limit: ownerRecordRemovalChildPageLimit,
    }), ownerRecordRemovalChildPageLimit);
    if (selected.length === 0) {
      const remnant = strictPage(await transaction.queryDocuments({
        collectionPath,
        orderByDocumentId: "asc",
        limit: ownerRecordRemovalRemnantLimit,
      }), ownerRecordRemovalRemnantLimit);
      if (remnant.length !== 0) {
        return processFailure("temporary_dependency", "retryable");
      }
      return advancePhase(transaction, job, now);
    }

    const deletePaths: string[] = [];
    for (const selectedDocument of selected) {
      const path = childDocumentPath(
        job.targetUid,
        definition.collection,
        exactDocumentId(selectedDocument.id),
      );
      const current = await transaction.getDocument(path);
      if (current === null) {
        continue;
      }
      sourceGeneration(current.data, job.sourceGeneration);
      deletePaths.push(path);
    }
    for (const path of deletePaths) {
      transaction.deleteDocument(path);
    }
    const nextCount = incrementCounter(job[definition.counter],
      deletePaths.length);
    return rebuildActiveJob(transaction, job, now, {
      [definition.counter]: nextCount,
    });
  });
}

function storageFailure(error: unknown): never {
  if (
    error instanceof OwnerRecordRemovalProcessError ||
    error instanceof StaleOwnerRecordRemovalWorkerError
  ) {
    throw error;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "OwnerRecordRemovalStorageError" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const allowed: readonly OwnerRecordRemovalFailureCategory[] = [
      "storage_generation_mismatch",
      "record_generation_missing",
      "newer_generation_record_found",
      "generation_mismatch",
      "unsupported_partial_state",
    ];
    if (allowed.includes(error.code as OwnerRecordRemovalFailureCategory)) {
      return processFailure(error.code as OwnerRecordRemovalFailureCategory);
    }
  }
  return processFailure("temporary_dependency", "retryable");
}

async function listStorage(
  context: OwnerRecordRemovalProcessContext,
  job: OwnerRecordRemovalJobDocument,
  definition: StoragePhaseDefinition,
  limit: 1 | 25,
) {
  try {
    const raw = await context.storage.listFirstObjects({
      targetUid: job.targetUid,
      kind: definition.kind,
      limit,
    });
    return validateOwnerRecordRemovalStorageFirstPage({
      targetUid: job.targetUid,
      kind: definition.kind,
      limit,
      sourceGeneration: job.sourceGeneration,
      objects: raw,
    });
  } catch (error) {
    return storageFailure(error);
  }
}

async function processStoragePage(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  definition: StoragePhaseDefinition,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  await assertFreshOutsideMutation(context.database, expected);
  const objects = await listStorage(
    context,
    expected,
    definition,
    ownerRecordRemovalStoragePageLimit,
  );
  await assertFreshOutsideMutation(context.database, expected);

  if (objects.length === 0) {
    const remnant = await listStorage(
      context,
      expected,
      definition,
      ownerRecordRemovalStorageRemnantLimit,
    );
    if (remnant.length !== 0) {
      return processFailure("temporary_dependency", "retryable");
    }
    return context.database.runTransaction(async (transaction) => {
      const {job} = await requireFreshWorker(transaction, expected);
      return advancePhase(transaction, job, now);
    });
  }

  let deleted = 0;
  for (const object of objects) {
    await assertFreshOutsideMutation(context.database, expected);
    let result;
    try {
      result = validateOwnerRecordRemovalStorageDeleteResult(
        await context.storage.deleteExactObject({
          targetUid: expected.targetUid,
          kind: definition.kind,
          name: object.name,
          providerGeneration: object.providerGeneration,
        }),
      );
    } catch (error) {
      return storageFailure(error);
    }
    const failure = ownerRecordRemovalStorageDeleteFailureCode(result);
    if (failure !== null) {
      return processFailure(failure, "retryable");
    }
    if (result === "deleted") {
      deleted += 1;
    }
  }
  return context.database.runTransaction(async (transaction) => {
    const {job} = await requireFreshWorker(transaction, expected);
    return rebuildActiveJob(transaction, job, now, {
      [definition.counter]: incrementCounter(job[definition.counter], deleted),
    });
  });
}

function validateSubscriptionReturnDocument(
  document: OwnerRecordRemovalStoredDocument,
  job: OwnerRecordRemovalJobDocument,
  now: Date,
): void {
  if (document.id !== job.targetUid) {
    processFailure("malformed_private_state");
  }
  sourceGeneration(document.data, job.sourceGeneration);
  try {
    listSubscriptionReturnEvents({
      rawState: document.data,
      ownerUid: job.targetUid,
      restaurantAccountDocumentId: job.targetUid,
      ownerRecordGeneration: job.sourceGeneration,
      nowEpochMs: now.getTime(),
    });
  } catch {
    processFailure("malformed_private_state");
  }
}

async function processSubscriptionReturnDocument(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  return context.database.runTransaction(async (transaction) => {
    const {job} = await requireFreshWorker(transaction, expected);
    const path = subscriptionReturnPath(job.targetUid);
    const document = await transaction.getDocument(path);
    let deleted = 0;
    if (document !== null) {
      validateSubscriptionReturnDocument(document, job, now);
      transaction.deleteDocument(path);
      deleted = 1;
    }
    const counter = incrementCounter(
      job.subscriptionReturnDocumentsDeleted,
      deleted,
    );
    return rebuildActiveJob(transaction, job, now, {
      phase: "delete_account_root",
      subscriptionReturnDocumentsDeleted: counter,
    });
  });
}

type Remnant = Readonly<{phase: OwnerRecordRemovalPhase}>;

async function findDatabaseRemnant(
  transaction: OwnerRecordRemovalPrivateTransaction,
  job: OwnerRecordRemovalJobDocument,
  now: Date,
): Promise<Remnant | null> {
  const rating = strictPage(await transaction.queryDocuments({
    collectionPath: ownerRecordRemovalRatingRestaurantCollection,
    where: Object.freeze([{
      field: "ownerUserId",
      operator: "==",
      value: job.targetUid,
    }]),
    orderByDocumentId: "asc",
    limit: ownerRecordRemovalRemnantLimit,
  }), ownerRecordRemovalRemnantLimit);
  if (rating.length !== 0) {
    const restaurantId = exactDocumentId(rating[0].id);
    const current = await transaction.getDocument(
      ratingRestaurantPath(restaurantId),
    );
    if (current !== null && current.data.ownerUserId === job.targetUid) {
      sourceGeneration(current.data, job.sourceGeneration);
      return Object.freeze({phase: "unclaim_rating_restaurants"});
    }
  }

  for (const definition of ownerRecordRemovalChildPhases) {
    const collectionPath = childCollectionPath(
      job.targetUid,
      definition.collection,
    );
    const documents = strictPage(await transaction.queryDocuments({
      collectionPath,
      orderByDocumentId: "asc",
      limit: ownerRecordRemovalRemnantLimit,
    }), ownerRecordRemovalRemnantLimit);
    if (documents.length === 0) {
      continue;
    }
    const current = await transaction.getDocument(childDocumentPath(
      job.targetUid,
      definition.collection,
      exactDocumentId(documents[0].id),
    ));
    if (current !== null) {
      sourceGeneration(current.data, job.sourceGeneration);
      return Object.freeze({phase: definition.phase});
    }
  }

  const returnDocument = await transaction.getDocument(
    subscriptionReturnPath(job.targetUid),
  );
  if (returnDocument !== null) {
    validateSubscriptionReturnDocument(returnDocument, job, now);
    return Object.freeze({phase: "delete_subscription_return_state"});
  }
  const root = await transaction.getDocument(accountRootPath(job.targetUid));
  if (root !== null) {
    sourceGeneration(root.data, job.sourceGeneration);
    return Object.freeze({phase: "delete_account_root"});
  }
  return null;
}

async function findStorageRemnant(
  context: OwnerRecordRemovalProcessContext,
  job: OwnerRecordRemovalJobDocument,
): Promise<StoragePhaseDefinition | null> {
  for (const definition of ownerRecordRemovalStoragePhases) {
    const objects = await listStorage(
      context,
      job,
      definition,
      ownerRecordRemovalStorageRemnantLimit,
    );
    if (objects.length !== 0) {
      return definition;
    }
  }
  return null;
}

async function processAccountRoot(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  await assertFreshOutsideMutation(context.database, expected);
  const storageRemnant = await findStorageRemnant(context, expected);
  if (storageRemnant !== null) {
    return context.database.runTransaction(async (transaction) => {
      const {job} = await requireFreshWorker(transaction, expected);
      return routePhase(transaction, job, storageRemnant.phase, now);
    });
  }
  return context.database.runTransaction(async (transaction) => {
    const {job} = await requireFreshWorker(transaction, expected);
    const remnant = await findDatabaseRemnant(transaction, job, now);
    if (remnant !== null && remnant.phase !== "delete_account_root") {
      return routePhase(transaction, job, remnant.phase, now);
    }
    const path = accountRootPath(job.targetUid);
    const root = await transaction.getDocument(path);
    let deleted = 0;
    if (root !== null) {
      sourceGeneration(root.data, job.sourceGeneration);
      transaction.deleteDocument(path);
      deleted = 1;
    }
    return rebuildActiveJob(transaction, job, now, {
      phase: "verify_remnants",
      accountRootsDeleted: incrementCounter(job.accountRootsDeleted, deleted),
    });
  });
}

async function processRemnantVerification(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  await assertFreshOutsideMutation(context.database, expected);
  const storageRemnant = await findStorageRemnant(context, expected);
  if (storageRemnant !== null) {
    return context.database.runTransaction(async (transaction) => {
      const {job} = await requireFreshWorker(transaction, expected);
      return routePhase(transaction, job, storageRemnant.phase, now);
    });
  }
  return context.database.runTransaction(async (transaction) => {
    const {job} = await requireFreshWorker(transaction, expected);
    const remnant = await findDatabaseRemnant(transaction, job, now);
    return remnant === null
      ? routePhase(transaction, job, "finalize_owner_state", now)
      : routePhase(transaction, job, remnant.phase, now);
  });
}

async function finalizeOwnerState(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  await assertFreshOutsideMutation(context.database, expected);
  const storageRemnant = await findStorageRemnant(context, expected);
  if (storageRemnant !== null) {
    return context.database.runTransaction(async (transaction) => {
      const {job} = await requireFreshWorker(transaction, expected);
      if (job.status !== "active" || job.phase !== "finalize_owner_state") {
        staleWorker();
      }
      return routePhase(transaction, job, storageRemnant.phase, now);
    });
  }
  return context.database.runTransaction(async (transaction) => {
    const {job, owner} = await requireFreshWorker(transaction, expected);
    if (job.status !== "active" || job.phase !== "finalize_owner_state") {
      staleWorker();
    }
    const remnant = await findDatabaseRemnant(transaction, job, now);
    if (remnant !== null) {
      return routePhase(transaction, job, remnant.phase, now);
    }
    const removed = buildOwnerRecordStateDocument({
      ownerUid: owner.ownerUid,
      generation: owner.generation,
      state: "removed",
      activeJobId: null,
      createdAt: owner.createdAt,
      updatedAt: now,
    });
    const complete = rebuildOwnerRecordRemovalJobDocument(job, {
      status: "complete",
      phase: "complete",
      failureCategory: null,
      completedAt: now,
      now,
    });
    transaction.setDocument(ownerStatePath(job.targetUid), removed);
    transaction.setDocument(ownerRecordRemovalJobPath(job.jobId), complete);
    return complete;
  });
}

async function recordFailure(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  error: OwnerRecordRemovalProcessError,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument | null> {
  try {
    return await context.database.runTransaction(async (transaction) => {
      const {job} = await requireFreshWorker(transaction, expected);
      const failed = rebuildOwnerRecordRemovalJobDocument(job, {
        status: error.disposition === "retryable"
          ? "retryable"
          : "manual_review_required",
        failureCategory: error.code,
        now,
      });
      transaction.setDocument(ownerRecordRemovalJobPath(job.jobId), failed);
      return failed;
    });
  } catch (recordError) {
    if (recordError instanceof StaleOwnerRecordRemovalWorkerError) {
      return null;
    }
    throw error;
  }
}

async function runExpectedPhase(
  context: OwnerRecordRemovalProcessContext,
  expected: OwnerRecordRemovalJobDocument,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  if (!isSourceCompatibleRetryable(expected)) {
    return processFailure("unsupported_partial_state");
  }
  if (expected.phase === "unclaim_rating_restaurants") {
    return processRatingPage(context, expected, now);
  }
  const child = ownerRecordRemovalChildPhases.find(
    (definition) => definition.phase === expected.phase,
  );
  if (child !== undefined) {
    return processChildPage(context, expected, child, now);
  }
  const storage = ownerRecordRemovalStoragePhases.find(
    (definition) => definition.phase === expected.phase,
  );
  if (storage !== undefined) {
    return processStoragePage(context, expected, storage, now);
  }
  switch (expected.phase) {
  case "delete_subscription_return_state":
    return processSubscriptionReturnDocument(context, expected, now);
  case "delete_account_root":
    return processAccountRoot(context, expected, now);
  case "verify_remnants":
    return processRemnantVerification(context, expected, now);
  case "finalize_owner_state":
    return finalizeOwnerState(context, expected, now);
  case "billing_gate":
  case "complete":
    return expected;
  default:
    return processFailure("unsupported_partial_state");
  }
}

/**
 * Runs at most one bounded phase/page. This is an internal testable helper;
 * no callable, HTTP function, scheduler, or production Storage adapter binds
 * it in this checkpoint.
 */
export async function processOwnerRecordRemovalStep(
  context: OwnerRecordRemovalProcessContext,
  rawJobId: unknown,
): Promise<OwnerRecordRemovalJobDocument> {
  let jobId: string;
  try {
    jobId = requireOwnerRecordRemovalJobId(rawJobId);
  } catch {
    return processFailure("malformed_private_state");
  }
  const expected = await loadCurrentJob(context.database, jobId);
  if (
    expected.status === "complete" ||
    expected.status === "manual_review_required"
  ) {
    return expected;
  }
  const now = nowFrom(context.clock);
  let runnable = expected;
  try {
    if (
      runnable.status === "retryable" &&
      runnable.phase === "finalize_owner_state"
    ) {
      runnable = await reactivateFinalizationRetry(
        context.database,
        runnable,
        now,
      );
    }
    return await runExpectedPhase(context, runnable, now);
  } catch (error) {
    if (error instanceof StaleOwnerRecordRemovalWorkerError) {
      return loadCurrentJob(context.database, jobId);
    }
    const failure = error instanceof OwnerRecordRemovalProcessError
      ? error
      : new OwnerRecordRemovalProcessError(
        "temporary_dependency",
        "retryable",
      );
    const recorded = await recordFailure(context, runnable, failure, now);
    if (recorded !== null) {
      return recorded;
    }
    return loadCurrentJob(context.database, jobId);
  }
}
