import {
  assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction,
  ReviewMilestoneReconciliationLockError,
} from "./review_milestone_reconciliation_lock.js";
import {
  buildRatingDestructiveJobDocument,
  buildRatingDestructiveJobItemDocument,
  parseRatingDestructiveJobDocument,
  parseRatingDestructiveJobItemDocument,
  parseRatingDishOperationLockDocument,
  parseRatingRestaurantOperationLockDocument,
  ratingDestructiveJobItemCollection,
  ratingDestructiveJobItemPath,
  ratingDestructiveJobPath,
  ratingDishOperationLockCollection,
  ratingDishOperationLockPath,
  ratingRestaurantOperationLockPath,
  type RatingDestructiveFailureCode,
  type RatingDestructiveJobDocument,
  type RatingDestructiveJobItemDocument,
  type RatingDestructiveJobPhase,
  type RatingDestructiveOperation,
  type RatingDestructiveStoredDocument,
  type RatingDishOperationLockDocument,
  type RatingRestaurantOperationLockDocument,
} from "./rating_destructive_job_contract.js";
import type {
  RatingDestructivePrivateDatabase,
  RatingDestructivePrivateTransaction,
  RatingDestructiveStoredDocument as StoreDocument,
} from "./rating_destructive_job_store.js";
import type {RatingDestructiveExternalSteps} from "./rating_destructive_external_steps.js";
import {
  readRestaurantWriteRevision,
} from "./restaurant_write_revision.js";
import {
  dishProposalJobCollection,
} from "./dish_proposal_private_contract.js";
import {
  parseDishProposalJobDocument,
  readEffectiveDishAggregateWriteGeneration,
} from "./dish_proposal_resolution_jobs.js";

export const ratingDestructiveDirectBatchSize = 100;
export const ratingDestructiveTrustBatchSize = 50;

export type RatingDestructiveDependencies = Readonly<{
  database: RatingDestructivePrivateDatabase;
  external: RatingDestructiveExternalSteps;
}>;

export type RatingDestructiveRetryableFailureCode = Extract<
  RatingDestructiveFailureCode,
  "temporary_dependency" | "preexisting_job_active"
>;

export type RatingDestructiveManualFailureCode = Exclude<
  RatingDestructiveFailureCode,
  RatingDestructiveRetryableFailureCode
>;

export class RatingDestructiveProcessError extends Error {
  readonly code: RatingDestructiveFailureCode;

  constructor(code: RatingDestructiveFailureCode) {
    super("Rating destructive-operation work could not advance safely.");
    this.name = "RatingDestructiveProcessError";
    this.code = code;
  }
}

export function retryableFailure(
  code: RatingDestructiveRetryableFailureCode,
): never {
  throw new RatingDestructiveProcessError(code);
}

export function manualFailure(code: RatingDestructiveManualFailureCode): never {
  throw new RatingDestructiveProcessError(code);
}

function contractDocument(
  document: StoreDocument | null,
): RatingDestructiveStoredDocument | null {
  return document === null ? null : {id: document.id, data: document.data};
}

export async function loadRatingDestructiveJob(
  transaction: RatingDestructivePrivateTransaction,
  jobId: string,
): Promise<RatingDestructiveJobDocument> {
  const job = parseRatingDestructiveJobDocument(contractDocument(
    await transaction.getDocument(ratingDestructiveJobPath(jobId)),
  ));
  if (job === null) {
    manualFailure("malformed_private_state");
  }
  return job;
}

export async function loadRatingDestructiveItem(
  transaction: RatingDestructivePrivateTransaction,
  itemId: string,
): Promise<RatingDestructiveJobItemDocument> {
  const item = parseRatingDestructiveJobItemDocument(contractDocument(
    await transaction.getDocument(ratingDestructiveJobItemPath(itemId)),
  ));
  if (item === null) {
    manualFailure("malformed_private_state");
  }
  return item;
}

/**
 * A runner may advance work only when the job read inside its current
 * transaction is the exact active snapshot that selected the work. Comparing
 * the contract fingerprint also binds every operation identity and progress
 * field, so a transaction retry cannot silently continue from newer state.
 */
export function isFreshActiveRatingDestructiveJob(
  current: RatingDestructiveJobDocument,
  expected: RatingDestructiveJobDocument,
  operation: RatingDestructiveOperation,
  phase: RatingDestructiveJobPhase,
): boolean {
  return expected.status === "active" &&
    current.status === "active" &&
    expected.jobId === current.jobId &&
    expected.operation === operation &&
    current.operation === operation &&
    expected.phase === phase &&
    current.phase === phase &&
    expected.fingerprint === current.fingerprint;
}

/** Exact item binding used when work crosses more than one transaction. */
export function isFreshRatingDestructiveItem(
  current: RatingDestructiveJobItemDocument,
  expected: RatingDestructiveJobItemDocument,
  job: RatingDestructiveJobDocument,
  kind: RatingDestructiveJobItemDocument["kind"],
): boolean {
  return current.itemId === expected.itemId &&
    current.jobId === job.jobId &&
    expected.jobId === job.jobId &&
    current.operation === job.operation &&
    expected.operation === job.operation &&
    current.kind === kind &&
    expected.kind === kind &&
    current.status === expected.status &&
    current.subphase === expected.subphase &&
    current.fingerprint === expected.fingerprint;
}

export function updateRatingDestructiveJob(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  changes: Partial<Omit<
    RatingDestructiveJobDocument,
    "version" | "jobId" | "fingerprint"
  >>,
  now: Date,
): RatingDestructiveJobDocument {
  const {
    version: _version,
    fingerprint: _fingerprint,
    ...withoutContractFields
  } = job;
  const next = buildRatingDestructiveJobDocument({
    ...withoutContractFields,
    ...changes,
    updatedAt: now,
  });
  transaction.setDocument(ratingDestructiveJobPath(job.jobId), next);
  return next;
}

export function updateRatingDestructiveItem(
  transaction: RatingDestructivePrivateTransaction,
  item: RatingDestructiveJobItemDocument,
  changes: Partial<Omit<
    RatingDestructiveJobItemDocument,
    "version" | "itemId" | "fingerprint"
  >>,
  now: Date,
): RatingDestructiveJobItemDocument {
  const {
    version: _version,
    fingerprint: _fingerprint,
    ...withoutContractFields
  } = item;
  const next = buildRatingDestructiveJobItemDocument({
    ...withoutContractFields,
    ...changes,
    updatedAt: now,
  });
  transaction.setDocument(ratingDestructiveJobItemPath(item.itemId), next);
  return next;
}

export async function loadRestaurantOperationLock(
  transaction: RatingDestructivePrivateTransaction,
  restaurantId: string,
): Promise<RatingRestaurantOperationLockDocument | null> {
  return parseRatingRestaurantOperationLockDocument(contractDocument(
    await transaction.getDocument(ratingRestaurantOperationLockPath(restaurantId)),
  ));
}

export async function loadDishOperationLock(
  transaction: RatingDestructivePrivateTransaction,
  dishId: string,
): Promise<RatingDishOperationLockDocument | null> {
  return parseRatingDishOperationLockDocument(contractDocument(
    await transaction.getDocument(ratingDishOperationLockPath(dishId)),
  ));
}

export async function requireOwnedRestaurantLock(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  restaurantId: string,
  role: "source" | "target",
): Promise<RatingRestaurantOperationLockDocument> {
  const lock = await loadRestaurantOperationLock(transaction, restaurantId);
  if (
    lock === null ||
    lock.jobId !== job.jobId ||
    lock.operation !== job.operation ||
    lock.role !== role ||
    !lock.active ||
    lock.permanent
  ) {
    manualFailure("lock_missing");
  }
  return lock;
}

export async function requireOwnedDishLock(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  dishId: string,
): Promise<RatingDishOperationLockDocument> {
  const lock = await loadDishOperationLock(transaction, dishId);
  if (
    lock === null ||
    lock.jobId !== job.jobId ||
    lock.operation !== job.operation ||
    !lock.active ||
    lock.permanent
  ) {
    manualFailure("lock_missing");
  }
  return lock;
}

export async function findActiveDishLockForRestaurant(
  transaction: RatingDestructivePrivateTransaction,
  restaurantId: string,
): Promise<RatingDishOperationLockDocument | null> {
  const documents = await transaction.queryDocuments({
    collectionPath: ratingDishOperationLockCollection,
    where: Object.freeze([
      {field: "restaurantId", operator: "==", value: restaurantId},
      {field: "active", operator: "==", value: true},
    ]),
    orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
    limit: 1,
  });
  if (documents.length === 0) {
    return null;
  }
  return parseRatingDishOperationLockDocument(contractDocument(documents[0]));
}

/** Finds an already-claimed Dish Suggestions cycle for one exact dish. */
export async function hasBlockingDishProposalJobForDish(
  transaction: RatingDestructivePrivateTransaction,
  dishId: string,
): Promise<boolean> {
  const statuses = [
    "active",
    "retryable",
    "manual_review_required",
  ] as const;
  const pages = await Promise.all(statuses.map((status) =>
    transaction.queryDocuments({
      collectionPath: dishProposalJobCollection,
      where: Object.freeze([
        {field: "sourceDishId", operator: "==", value: dishId},
        {field: "status", operator: "==", value: status},
      ]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: 1,
    })
  ));
  for (const document of pages.flat()) {
    let proposalJob;
    try {
      proposalJob = parseDishProposalJobDocument(document);
    } catch {
      manualFailure("malformed_private_state");
    }
    if (
      proposalJob === null ||
      proposalJob.sourceDishId !== dishId ||
      proposalJob.status === "complete"
    ) {
      manualFailure("malformed_private_state");
    }
    return true;
  }
  return false;
}

export type ParsedRatingRestaurant = Readonly<{
  documentId: string;
  data: Readonly<Record<string, unknown>>;
  revision: number;
  name: string;
  isActive: boolean;
  isClaimed: boolean;
  ownerUserId: string | null;
  phone: string | null;
  bio: string | null;
  cuisineTags: readonly string[];
}>;

export type ParsedRatingDish = Readonly<{
  documentId: string;
  data: Readonly<Record<string, unknown>>;
  restaurantId: string;
  restaurantName: string;
  isActive: boolean;
  mergedIntoDishId: string | null;
  aggregateWriteGeneration: number;
}>;

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function exactString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readExactProductIdentity(value: unknown): string | null {
  const identity = exactString(value);
  return identity !== null &&
      identity !== "." &&
      identity !== ".." &&
      !identity.includes("/") &&
      Buffer.byteLength(identity, "utf8") <= 1_500
    ? identity
    : null;
}

export function parseRatingRestaurant(
  document: StoreDocument | null,
): ParsedRatingRestaurant | null {
  if (document === null) {
    return null;
  }
  const revision = readRestaurantWriteRevision(document.data);
  const name = trimmedString(document.data.name);
  if (
    readExactProductIdentity(document.id) === null ||
    revision === null ||
    name === null ||
    typeof document.data.isActive !== "boolean" ||
    typeof document.data.isClaimed !== "boolean"
  ) {
    manualFailure("entity_state_incompatible");
  }
  const cuisineTags = Array.isArray(document.data.cuisineTags)
    ? document.data.cuisineTags
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    : [];
  return {
    documentId: document.id,
    data: document.data,
    revision,
    name,
    isActive: document.data.isActive,
    isClaimed: document.data.isClaimed,
    ownerUserId: trimmedString(document.data.ownerUserId),
    phone: trimmedString(document.data.phone),
    bio: trimmedString(document.data.bio),
    cuisineTags,
  };
}

export function parseRatingDish(
  document: StoreDocument | null,
): ParsedRatingDish | null {
  if (document === null) {
    return null;
  }
  const restaurantId = readExactProductIdentity(document.data.restaurantId);
  const restaurantName = trimmedString(document.data.restaurantName);
  const mergedIntoDishId = document.data.mergedIntoDishId === null ||
      document.data.mergedIntoDishId === undefined
    ? null
    : readExactProductIdentity(document.data.mergedIntoDishId);
  if (
    readExactProductIdentity(document.id) === null ||
    restaurantId === null ||
    restaurantName === null ||
    typeof document.data.isActive !== "boolean" ||
    (document.data.mergedIntoDishId !== null &&
      document.data.mergedIntoDishId !== undefined &&
      mergedIntoDishId === null)
  ) {
    manualFailure("entity_state_incompatible");
  }
  let aggregateWriteGeneration: number;
  try {
    aggregateWriteGeneration = readEffectiveDishAggregateWriteGeneration(
      document.data,
    );
  } catch {
    manualFailure("entity_state_incompatible");
  }
  return {
    documentId: document.id,
    data: document.data,
    restaurantId,
    restaurantName,
    isActive: document.data.isActive,
    mergedIntoDishId,
    aggregateWriteGeneration,
  };
}

export function exactReviewUserId(
  document: StoreDocument,
): string | null {
  return readExactProductIdentity(document.data.userId);
}

export async function assertReviewAuthorUnlocked(
  transaction: RatingDestructivePrivateTransaction,
  document: StoreDocument,
): Promise<void> {
  const userId = exactReviewUserId(document);
  if (userId === null) {
    return;
  }
  try {
    await assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction(
      transaction,
      userId,
    );
  } catch (error) {
    if (
      error instanceof ReviewMilestoneReconciliationLockError &&
      error.code === "conflict"
    ) {
      retryableFailure("preexisting_job_active");
    }
    manualFailure("malformed_private_state");
  }
}

export async function nextActiveItem(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  kind: RatingDestructiveJobItemDocument["kind"],
): Promise<RatingDestructiveJobItemDocument | null> {
  const statuses = [
    "active",
    "retryable",
    "manual_review_required",
  ] as const;
  const documents = (await Promise.all(statuses.map((status) =>
    transaction.queryDocuments({
      collectionPath: ratingDestructiveJobItemCollection,
      where: Object.freeze([
        {field: "jobId", operator: "==", value: job.jobId},
        {field: "kind", operator: "==", value: kind},
        {field: "status", operator: "==", value: status},
      ]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: 1,
    })
  ))).flat().sort((left, right) => left.id.localeCompare(right.id));
  if (documents.length === 0) {
    return null;
  }
  const item = parseRatingDestructiveJobItemDocument(contractDocument(
    documents[0],
  ));
  if (item === null || item.jobId !== job.jobId || item.kind !== kind) {
    manualFailure("malformed_private_state");
  }
  if (item.status === "manual_review_required") {
    manualFailure("unsupported_partial_state");
  }
  return item;
}
