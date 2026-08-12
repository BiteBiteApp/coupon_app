import type { Firestore } from "firebase-admin/firestore";
import {
  awardApprovedDishProposalContributionPointsForResolutionCycle,
  type DishProposalResolutionPointAwardResult,
} from "./contribution_points_helpers.js";
import {
  accumulateDishReviewAggregateWinnerPage,
  buildDishReviewAggregateWinnerDocument,
  chooseDishReviewAggregateWinnerDocument,
  createDishReviewAggregateAccumulator,
  dishReviewAggregateWinnerCollectionPath,
  finalizeDishReviewAggregate,
  parseDishReviewAggregateCandidate,
  parseDishReviewAggregateWinnerDocument,
  restoreDishReviewAggregateAccumulator,
  type DishReviewAggregateRole,
  type DishReviewAggregateWinnerDocument,
} from "./dish_review_aggregate_accumulator.js";
import {
  buildDishProposalMembership,
  createDishProposalJobId,
  dishMergeReviewLockPath,
  dishMergeReviewLockVersion,
  dishProposalAggregateScanBatchSize,
  dishProposalDocumentFingerprint,
  dishProposalFinalizationBatchSize,
  dishProposalGroupPath,
  dishProposalGroupVersion,
  dishProposalJobCollection,
  dishProposalJobPath,
  dishProposalJobVersion,
  dishProposalMemberCollection,
  dishProposalReviewMigrationBatchSize,
  normalizeDishNameForSave,
  readDishProposalDate,
  type DishMergeReviewLockDocument,
  type DishProposalGroupDocument,
  type DishProposalJobDocument,
  type DishProposalJobPhase,
  type DishProposalResolutionType,
} from "./dish_proposal_private_contract.js";
import {
  applyDishProposalMemberChange,
  parseDishProposalGroupDocument,
  parseDishProposalMemberDocument,
} from "./dish_proposal_private_maintenance.js";
import {
  createFirestoreDishProposalPrivateDatabase,
  type DishProposalPrivateDatabase,
  type DishProposalPrivateTransaction,
  type DishProposalStoredDocument,
} from "./dish_proposal_private_store.js";

export type DishProposalPointAwardRequest = Readonly<{
  proposalDocumentId: string;
  oldValue: string | null;
  newValue: string | null;
  groupId: string;
  supporterUid: string;
  membershipGeneration: number;
  cycleCutoffGeneration: number;
  activeJobId: string;
  trustedServerCreateTimeMillis: number;
}>;

export type DishProposalResolutionDependencies = Readonly<{
  database: DishProposalPrivateDatabase;
  awardApprovedProposalPoints(
    request: DishProposalPointAwardRequest,
  ): Promise<DishProposalResolutionPointAwardResult>;
}>;

export type DishProposalClaimResult = Readonly<{
  claimed: boolean;
  jobId: string | null;
  reason: "claimed" | "missing-group" | "already-active" | "dish-locked";
}>;

export type DishProposalJobStepResult = Readonly<{
  jobId: string;
  phase: DishProposalJobPhase;
  status: DishProposalJobDocument["status"];
  processedDocuments: number;
}>;

type ParsedDish = Readonly<{
  documentId: string;
  restaurantId: string;
  name: string;
  normalizedName: string;
  isActive: boolean;
  mergedIntoDishId: string | null;
  aggregateWriteGeneration: number;
}>;

const ratingRestaurantOperationLockCollection =
  "private_rating_restaurant_operation_locks" as const;
const ratingDishOperationLockCollection =
  "private_rating_dish_operation_locks" as const;

async function hasBlockingRatingDestructiveOperationLock(
  transaction: DishProposalPrivateTransaction,
  group: DishProposalGroupDocument,
): Promise<boolean> {
  const paths = new Set<string>([
    `${ratingRestaurantOperationLockCollection}/${group.restaurantId}`,
    `${ratingDishOperationLockCollection}/${group.sourceDishId}`,
  ]);
  if (group.mergeTargetDishId !== null) {
    paths.add(
      `${ratingDishOperationLockCollection}/${group.mergeTargetDishId}`,
    );
  }
  const documents = await Promise.all(
    [...paths].map((path) => transaction.getDocument(path)),
  );
  // Presence is deliberately fail-closed. A malformed private lock must never
  // let a new proposal job race destructive work, and no lock payload is
  // needed to make this claim decision.
  return documents.some((document) => document !== null);
}

const dishProposalJobKeys = Object.freeze([
  "version",
  "jobId",
  "groupId",
  "resolutionType",
  "proposalType",
  "status",
  "phase",
  "restaurantId",
  "sourceDishId",
  "mergeTargetDishId",
  "normalizedProposedName",
  "resolutionSequence",
  "cycleCutoffGeneration",
  "cycleCutoffAt",
  "reviewMigrationCursorId",
  "aggregateState",
  "aggregateCursorDocumentId",
  "aggregateWinnerCursorId",
  "sourceActiveAggregateWriteGeneration",
  "sourceCompletionAggregateWriteGeneration",
  "targetActiveAggregateWriteGeneration",
  "targetCompletionAggregateWriteGeneration",
  "pointsCursorGeneration",
  "pointsCursorMemberId",
  "renameOldValue",
  "renameNewValue",
  "shouldAwardPoints",
  "failureCode",
  "fingerprint",
  "createdAt",
  "updatedAt",
  "completedAt",
] as const);

const dishMergeReviewLockKeys = Object.freeze([
  "version",
  "dishId",
  "jobId",
  "groupId",
  "role",
  "state",
  "blocksClientReviews",
  "blocksClientAggregates",
  "targetDishId",
  "activeAggregateWriteGeneration",
  "completionAggregateWriteGeneration",
  "fingerprint",
  "createdAt",
  "indexedAt",
] as const);

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readExactDocumentSegment(value: unknown): string | null {
  return typeof value === "string" &&
      value.length > 0 &&
      value !== "." &&
      value !== ".." &&
      Buffer.byteLength(value, "utf8") <= 1_500 &&
      !value.includes("/")
    ? value
    : null;
}

function readCanonicalPrivateString(value: unknown): string | null {
  return typeof value === "string" &&
      value.length > 0 &&
      value === value.trim()
    ? value
    : null;
}

function readCanonicalDishId(value: unknown): string | null {
  const parsed = readCanonicalPrivateString(value);
  return parsed !== null &&
      !parsed.includes("/") &&
      parsed !== "." &&
      parsed !== ".." &&
      Buffer.byteLength(parsed, "utf8") <= 1_500 &&
      !/[\u0000-\u001f\u007f]/u.test(parsed)
    ? parsed
    : null;
}

function strictNullableCanonicalString(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }
  const parsed = readCanonicalPrivateString(value);
  if (parsed === null) {
    throw new Error(`Private job ${field} is malformed.`);
  }
  return parsed;
}

function strictNullableDocumentSegment(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }
  const parsed = readExactDocumentSegment(value);
  if (parsed === null) {
    throw new Error(`Private job ${field} is malformed.`);
  }
  return parsed;
}

function strictNullableInteger(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  const parsed = readInteger(value);
  if (parsed === null) {
    throw new Error(`Private job ${field} is malformed.`);
  }
  return parsed;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : null;
}

export function readEffectiveDishAggregateWriteGeneration(
  data: Readonly<Record<string, unknown>>,
): number {
  if (!Object.prototype.hasOwnProperty.call(data, "aggregateWriteGeneration")) {
    return 0;
  }
  const generation = readInteger(data.aggregateWriteGeneration);
  if (generation === null) {
    throw new Error("Dish aggregate write generation is malformed.");
  }
  return generation;
}

export function nextDishAggregateWriteGenerations(current: number): Readonly<{
  active: number;
  completion: number;
}> {
  const active = current + 1;
  const completion = current + 2;
  if (!Number.isSafeInteger(active) || !Number.isSafeInteger(completion)) {
    throw new Error("Dish aggregate write generation is exhausted.");
  }
  return {active, completion};
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function parseDish(document: DishProposalStoredDocument | null): ParsedDish | null {
  if (document === null) {
    return null;
  }
  const documentId = readCanonicalDishId(document.id);
  const storedId = readCanonicalDishId(document.data.id);
  const restaurantId = readString(document.data.restaurantId);
  const restaurantName = readString(document.data.restaurantName);
  const name = readString(document.data.name);
  const normalizedName = readString(document.data.normalizedName) ??
    name?.toLowerCase() ?? null;
  if (
    documentId === null ||
    storedId !== documentId ||
    restaurantId === null ||
    restaurantName === null ||
    name === null ||
    normalizedName === null
  ) {
    return null;
  }
  return {
    documentId,
    restaurantId,
    name,
    normalizedName,
    isActive: typeof document.data.isActive === "boolean"
      ? document.data.isActive
      : true,
    mergedIntoDishId: readString(document.data.mergedIntoDishId),
    aggregateWriteGeneration: readEffectiveDishAggregateWriteGeneration(
      document.data,
    ),
  };
}

export function parseDishProposalJobDocument(
  document: DishProposalStoredDocument | null,
): DishProposalJobDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  if (!hasExactKeys(data, dishProposalJobKeys)) {
    throw new Error("Stored dish-proposal job has an invalid field set.");
  }
  const proposalType = data.proposalType === "rename" ||
      data.proposalType === "merge"
    ? data.proposalType
    : null;
  const resolutionType = data.resolutionType === "apply" ||
      data.resolutionType === "reject"
    ? data.resolutionType
    : null;
  const statuses = new Set([
    "active",
    "retryable",
    "manual_review_required",
    "complete",
  ]);
  const phases = new Set<DishProposalJobPhase>([
    "validate_target",
    "validate_targets",
    "move_reviews",
    "rebuild_target_aggregate",
    "rebuild_source_aggregate",
    "fold_target_aggregate",
    "fold_source_aggregate",
    "finalize_dishes",
    "award_points",
    "finalize_proposals",
    "finalize_rejections",
    "complete",
  ]);
  const status = typeof data.status === "string" && statuses.has(data.status)
    ? data.status as DishProposalJobDocument["status"]
    : null;
  const phase = typeof data.phase === "string" &&
      phases.has(data.phase as DishProposalJobPhase)
    ? data.phase as DishProposalJobPhase
    : null;
  const jobId = readExactDocumentSegment(data.jobId);
  const groupId = readCanonicalPrivateString(data.groupId);
  const restaurantId = readCanonicalPrivateString(data.restaurantId);
  const sourceDishId = readCanonicalDishId(data.sourceDishId);
  const resolutionSequence = readInteger(data.resolutionSequence);
  const cycleCutoffGeneration = readInteger(data.cycleCutoffGeneration);
  const cycleCutoffAt = readDishProposalDate(data.cycleCutoffAt);
  const createdAt = readDishProposalDate(data.createdAt);
  const updatedAt = readDishProposalDate(data.updatedAt);
  const completedAt = readDishProposalDate(data.completedAt);
  const fingerprint = readCanonicalPrivateString(data.fingerprint);
  if (
    data.version !== dishProposalJobVersion ||
    proposalType === null ||
    resolutionType === null ||
    status === null ||
    phase === null ||
    jobId === null ||
    groupId === null ||
    restaurantId === null ||
    sourceDishId === null ||
    resolutionSequence === null ||
    cycleCutoffGeneration === null ||
    cycleCutoffAt === null ||
    createdAt === null ||
    updatedAt === null ||
    (data.completedAt !== null && completedAt === null) ||
    typeof data.shouldAwardPoints !== "boolean" ||
    fingerprint === null
  ) {
    throw new Error("Stored dish-proposal job has an invalid schema.");
  }
  const aggregateState = data.aggregateState === null
    ? null
    : readRecord(data.aggregateState);
  if (data.aggregateState !== null && aggregateState === null) {
    throw new Error("Stored dish-proposal job has an invalid accumulator.");
  }
  if (aggregateState !== null) {
    restoreDishReviewAggregateAccumulator(aggregateState);
  }
  const normalizedProposedName = data.normalizedProposedName === null
    ? null
    : typeof data.normalizedProposedName === "string" &&
        data.normalizedProposedName ===
          data.normalizedProposedName.trim().toLowerCase()
    ? data.normalizedProposedName
    : (() => {
        throw new Error("Private job normalizedProposedName is malformed.");
      })();
  const parsed: DishProposalJobDocument = {
    version: dishProposalJobVersion,
    jobId,
    groupId,
    resolutionType,
    proposalType,
    status,
    phase,
    restaurantId,
    sourceDishId,
    mergeTargetDishId: data.mergeTargetDishId === null
      ? null
      : readCanonicalDishId(data.mergeTargetDishId) ?? (() => {
        throw new Error("Private job mergeTargetDishId is malformed.");
      })(),
    normalizedProposedName,
    resolutionSequence,
    cycleCutoffGeneration,
    cycleCutoffAt,
    reviewMigrationCursorId: strictNullableDocumentSegment(
      data.reviewMigrationCursorId,
      "reviewMigrationCursorId",
    ),
    aggregateState,
    aggregateCursorDocumentId: strictNullableDocumentSegment(
      data.aggregateCursorDocumentId,
      "aggregateCursorDocumentId",
    ),
    aggregateWinnerCursorId: strictNullableDocumentSegment(
      data.aggregateWinnerCursorId,
      "aggregateWinnerCursorId",
    ),
    sourceActiveAggregateWriteGeneration: strictNullableInteger(
      data.sourceActiveAggregateWriteGeneration,
      "sourceActiveAggregateWriteGeneration",
    ),
    sourceCompletionAggregateWriteGeneration: strictNullableInteger(
      data.sourceCompletionAggregateWriteGeneration,
      "sourceCompletionAggregateWriteGeneration",
    ),
    targetActiveAggregateWriteGeneration: strictNullableInteger(
      data.targetActiveAggregateWriteGeneration,
      "targetActiveAggregateWriteGeneration",
    ),
    targetCompletionAggregateWriteGeneration: strictNullableInteger(
      data.targetCompletionAggregateWriteGeneration,
      "targetCompletionAggregateWriteGeneration",
    ),
    pointsCursorGeneration: strictNullableInteger(
      data.pointsCursorGeneration,
      "pointsCursorGeneration",
    ),
    pointsCursorMemberId: strictNullableDocumentSegment(
      data.pointsCursorMemberId,
      "pointsCursorMemberId",
    ),
    renameOldValue: strictNullableCanonicalString(
      data.renameOldValue,
      "renameOldValue",
    ),
    renameNewValue: strictNullableCanonicalString(
      data.renameNewValue,
      "renameNewValue",
    ),
    shouldAwardPoints: data.shouldAwardPoints,
    failureCode: strictNullableCanonicalString(data.failureCode, "failureCode"),
    fingerprint,
    createdAt,
    updatedAt,
    completedAt,
  };
  const {fingerprint: _fingerprint, ...withoutFingerprint} = parsed;
  const expectedJobId = createDishProposalJobId({
    groupId: parsed.groupId,
    resolutionSequence: parsed.resolutionSequence,
    resolutionType: parsed.resolutionType,
  });
  if (
    document.id !== parsed.jobId ||
    parsed.jobId !== expectedJobId ||
    jobFingerprint(withoutFingerprint) !== parsed.fingerprint ||
    (parsed.pointsCursorGeneration === null) !==
      (parsed.pointsCursorMemberId === null) ||
    (parsed.status === "complete") !== (parsed.phase === "complete") ||
    (parsed.completedAt !== null) !== (parsed.status === "complete") ||
    (parsed.aggregateState !== null) !==
      (parsed.phase === "fold_target_aggregate" ||
        parsed.phase === "fold_source_aggregate") ||
    (parsed.aggregateCursorDocumentId !== null &&
      parsed.phase !== "rebuild_target_aggregate" &&
      parsed.phase !== "rebuild_source_aggregate") ||
    (parsed.aggregateWinnerCursorId !== null &&
      parsed.phase !== "fold_target_aggregate" &&
      parsed.phase !== "fold_source_aggregate") ||
    !aggregateGenerationFieldsAreConsistent(parsed)
  ) {
    throw new Error("Stored dish-proposal job has an invalid identity or state.");
  }
  return parsed;
}

function aggregateGenerationFieldsAreConsistent(
  job: DishProposalJobDocument,
): boolean {
  const values = [
    job.sourceActiveAggregateWriteGeneration,
    job.sourceCompletionAggregateWriteGeneration,
    job.targetActiveAggregateWriteGeneration,
    job.targetCompletionAggregateWriteGeneration,
  ];
  const allNull = values.every((value) => value === null);
  const allPresent = values.every((value) => value !== null);
  if (!allNull && !allPresent) {
    return false;
  }
  if (allNull) {
    const validPreclaimFailure = job.status === "manual_review_required" &&
      job.phase === "validate_targets" &&
      job.failureCode === "merge_targets_invalid";
    return job.resolutionType !== "apply" ||
      job.proposalType !== "merge" ||
      job.mergeTargetDishId === null ||
      job.mergeTargetDishId === job.sourceDishId ||
      validPreclaimFailure;
  }
  return job.resolutionType === "apply" &&
    job.proposalType === "merge" &&
    job.mergeTargetDishId !== null &&
    job.mergeTargetDishId !== job.sourceDishId &&
    job.sourceCompletionAggregateWriteGeneration! ===
      job.sourceActiveAggregateWriteGeneration! + 1 &&
    job.targetCompletionAggregateWriteGeneration! ===
      job.targetActiveAggregateWriteGeneration! + 1;
}

function jobFingerprint(
  job: Omit<DishProposalJobDocument, "fingerprint">,
): string {
  return dishProposalDocumentFingerprint(dishProposalJobVersion, [
    job.jobId,
    job.groupId,
    job.resolutionType,
    job.proposalType,
    job.status,
    job.phase,
    job.restaurantId,
    job.sourceDishId,
    job.mergeTargetDishId,
    job.normalizedProposedName,
    job.resolutionSequence,
    job.cycleCutoffGeneration,
    job.cycleCutoffAt.toISOString(),
    job.reviewMigrationCursorId,
    job.aggregateState,
    job.aggregateCursorDocumentId,
    job.aggregateWinnerCursorId,
    job.sourceActiveAggregateWriteGeneration,
    job.sourceCompletionAggregateWriteGeneration,
    job.targetActiveAggregateWriteGeneration,
    job.targetCompletionAggregateWriteGeneration,
    job.pointsCursorGeneration,
    job.pointsCursorMemberId,
    job.renameOldValue,
    job.renameNewValue,
    job.shouldAwardPoints,
    job.failureCode,
    job.createdAt.toISOString(),
    job.updatedAt.toISOString(),
    job.completedAt?.toISOString() ?? null,
  ]);
}

function withJobFingerprint(
  job: Omit<DishProposalJobDocument, "fingerprint">,
): DishProposalJobDocument {
  return {...job, fingerprint: jobFingerprint(job)};
}

function groupFingerprint(
  group: Omit<DishProposalGroupDocument, "fingerprint">,
): string {
  return dishProposalDocumentFingerprint(dishProposalGroupVersion, [
    group.groupId,
    group.proposalType,
    group.restaurantId,
    group.sourceDishId,
    group.mergeTargetDishId,
    group.normalizedProposedName,
    group.resolutionIdentitiesValid,
    group.hasPendingMembers,
    group.oldestTrustedServerCreateTime?.toISOString() ?? null,
    group.dueAt?.toISOString() ?? null,
    group.enoughSupporters,
    group.autoEligible,
    group.lastMembershipGeneration,
    group.resolutionSequence,
    group.activeJobId,
    group.activeResolutionType,
    group.cycleCutoffGeneration,
    group.cycleCutoffAt?.toISOString() ?? null,
  ]);
}

function withGroupFingerprint(
  group: Omit<DishProposalGroupDocument, "fingerprint">,
): DishProposalGroupDocument {
  return {...group, fingerprint: groupFingerprint(group)};
}

function lockFingerprint(
  lock: Omit<DishMergeReviewLockDocument, "fingerprint">,
): string {
  return dishProposalDocumentFingerprint(dishMergeReviewLockVersion, [
    lock.dishId,
    lock.jobId,
    lock.groupId,
    lock.role,
    lock.state,
    lock.blocksClientReviews,
    lock.blocksClientAggregates,
    lock.activeAggregateWriteGeneration,
    lock.completionAggregateWriteGeneration,
    lock.targetDishId,
    lock.createdAt.toISOString(),
  ]);
}

export function buildDishMergeReviewLockDocument(
  value: Omit<DishMergeReviewLockDocument, "fingerprint">,
): DishMergeReviewLockDocument {
  return {...value, fingerprint: lockFingerprint(value)};
}

export function parseDishMergeReviewLockDocument(
  document: DishProposalStoredDocument | null,
): DishMergeReviewLockDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  if (!hasExactKeys(data, dishMergeReviewLockKeys)) {
    throw new Error("Stored merge lock has an invalid field set.");
  }
  const dishId = readExactDocumentSegment(data.dishId);
  const jobId = readExactDocumentSegment(data.jobId);
  const groupId = readCanonicalPrivateString(data.groupId);
  const role = data.role === "source" || data.role === "target"
    ? data.role
    : null;
  const state = data.state === "active" || data.state === "merged_source"
    ? data.state
    : null;
  const createdAt = readDishProposalDate(data.createdAt);
  const indexedAt = readDishProposalDate(data.indexedAt);
  const fingerprint = readCanonicalPrivateString(data.fingerprint);
  const activeAggregateWriteGeneration = readInteger(
    data.activeAggregateWriteGeneration,
  );
  const completionAggregateWriteGeneration = readInteger(
    data.completionAggregateWriteGeneration,
  );
  if (
    data.version !== dishMergeReviewLockVersion ||
    dishId === null ||
    jobId === null ||
    groupId === null ||
    role === null ||
    state === null ||
    data.blocksClientReviews !== true ||
    data.blocksClientAggregates !== true ||
    activeAggregateWriteGeneration === null ||
    completionAggregateWriteGeneration === null ||
    completionAggregateWriteGeneration !==
      activeAggregateWriteGeneration + (state === "active" ? 1 : 0) ||
    createdAt === null ||
    indexedAt === null ||
    fingerprint === null
  ) {
    throw new Error("Stored merge lock has an invalid schema.");
  }
  const targetDishId = data.targetDishId === null
    ? null
    : readExactDocumentSegment(data.targetDishId);
  if (data.targetDishId !== null && targetDishId === null) {
    throw new Error("Stored merge lock targetDishId is malformed.");
  }
  const parsed: DishMergeReviewLockDocument = {
    version: dishMergeReviewLockVersion,
    dishId,
    jobId,
    groupId,
    role,
    state,
    blocksClientReviews: true,
    blocksClientAggregates: true,
    activeAggregateWriteGeneration,
    completionAggregateWriteGeneration,
    targetDishId,
    fingerprint,
    createdAt,
    indexedAt,
  };
  const {fingerprint: _fingerprint, ...withoutFingerprint} = parsed;
  if (
    document.id !== parsed.dishId ||
    lockFingerprint(withoutFingerprint) !== parsed.fingerprint ||
    (parsed.role === "target" && parsed.targetDishId !== null) ||
    (parsed.role === "source" && parsed.targetDishId === null)
  ) {
    throw new Error("Stored merge lock has an invalid identity or state.");
  }
  return parsed;
}

export function createFirestoreDishProposalResolutionDependencies(
  firestore: Firestore,
): DishProposalResolutionDependencies {
  return {
    database: createFirestoreDishProposalPrivateDatabase(firestore),
    async awardApprovedProposalPoints(request) {
      return await awardApprovedDishProposalContributionPointsForResolutionCycle(
        firestore,
        request,
      );
    },
  };
}

async function claimDishProposalGroup(
  database: DishProposalPrivateDatabase,
  groupId: string,
  resolutionType: DishProposalResolutionType,
  now: Date,
): Promise<DishProposalClaimResult> {
  return database.runTransaction(async (transaction) => {
    const group = parseDishProposalGroupDocument(
      await transaction.getDocument(dishProposalGroupPath(groupId)),
    );
    if (group === null || !group.hasPendingMembers) {
      return {claimed: false, jobId: null, reason: "missing-group"};
    }
    if (group.activeJobId !== null) {
      return {
        claimed: false,
        jobId: group.activeJobId,
        reason: "already-active",
      };
    }
    if (await hasBlockingRatingDestructiveOperationLock(transaction, group)) {
      return {claimed: false, jobId: null, reason: "dish-locked"};
    }
    const resolutionSequence = group.resolutionSequence + 1;
    if (!Number.isSafeInteger(resolutionSequence)) {
      throw new Error("Dish-proposal resolution sequence is exhausted.");
    }
    const jobId = createDishProposalJobId({
      groupId,
      resolutionSequence,
      resolutionType,
    });
    const isMergeApply = resolutionType === "apply" &&
      group.proposalType === "merge";
    const mergeTargetDishId = group.mergeTargetDishId;
    const hasDistinctMergeTarget = mergeTargetDishId !== null &&
      mergeTargetDishId !== group.sourceDishId;
    let sourceActiveAggregateWriteGeneration: number | null = null;
    let sourceCompletionAggregateWriteGeneration: number | null = null;
    let targetActiveAggregateWriteGeneration: number | null = null;
    let targetCompletionAggregateWriteGeneration: number | null = null;
    let mergeClaimFailureCode: string | null = null;
    if (isMergeApply && hasDistinctMergeTarget) {
      const [
        sourceLockDocument,
        targetLockDocument,
        sourceDocument,
        targetDocument,
      ] = await Promise.all([
        transaction.getDocument(
          dishMergeReviewLockPath(group.sourceDishId),
        ),
        transaction.getDocument(
          dishMergeReviewLockPath(mergeTargetDishId),
        ),
        transaction.getDocument(`bitescore_dishes/${group.sourceDishId}`),
        transaction.getDocument(`bitescore_dishes/${mergeTargetDishId}`),
      ]);
      if (sourceLockDocument !== null || targetLockDocument !== null) {
        return {claimed: false, jobId: null, reason: "dish-locked"};
      }
      const source = parseDish(sourceDocument);
      const target = parseDish(targetDocument);
      const valid = source !== null &&
        target !== null &&
        source.restaurantId === target.restaurantId &&
        source.restaurantId === group.restaurantId &&
        source.isActive &&
        source.mergedIntoDishId === null &&
        target.isActive &&
        target.mergedIntoDishId === null &&
        source.documentId !== target.documentId;
      if (!valid) {
        mergeClaimFailureCode = "merge_targets_invalid";
      } else {
        const sourceGenerations = nextDishAggregateWriteGenerations(
          source.aggregateWriteGeneration,
        );
        const targetGenerations = nextDishAggregateWriteGenerations(
          target.aggregateWriteGeneration,
        );
        sourceActiveAggregateWriteGeneration = sourceGenerations.active;
        sourceCompletionAggregateWriteGeneration = sourceGenerations.completion;
        targetActiveAggregateWriteGeneration = targetGenerations.active;
        targetCompletionAggregateWriteGeneration = targetGenerations.completion;
      }
    }

    const phase: DishProposalJobPhase = resolutionType === "reject"
      ? "finalize_rejections"
      : group.proposalType === "merge"
      ? "validate_targets"
      : "validate_target";
    const jobWithoutFingerprint: Omit<
      DishProposalJobDocument,
      "fingerprint"
    > = {
      version: dishProposalJobVersion,
      jobId,
      groupId,
      resolutionType,
      proposalType: group.proposalType,
      status: mergeClaimFailureCode === null
        ? "active"
        : "manual_review_required",
      phase,
      restaurantId: group.restaurantId,
      sourceDishId: group.sourceDishId,
      mergeTargetDishId,
      normalizedProposedName: group.normalizedProposedName,
      resolutionSequence,
      cycleCutoffGeneration: group.lastMembershipGeneration,
      cycleCutoffAt: now,
      reviewMigrationCursorId: null,
      aggregateState: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      sourceActiveAggregateWriteGeneration,
      sourceCompletionAggregateWriteGeneration,
      targetActiveAggregateWriteGeneration,
      targetCompletionAggregateWriteGeneration,
      pointsCursorGeneration: null,
      pointsCursorMemberId: null,
      renameOldValue: null,
      renameNewValue: null,
      shouldAwardPoints: isMergeApply && mergeClaimFailureCode === null,
      failureCode: mergeClaimFailureCode,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const claimedGroupWithoutFingerprint: Omit<
      DishProposalGroupDocument,
      "fingerprint"
    > = {
      ...group,
      resolutionSequence,
      activeJobId: jobId,
      activeResolutionType: resolutionType,
      cycleCutoffGeneration: group.lastMembershipGeneration,
      cycleCutoffAt: now,
      autoEligible: false,
      indexedAt: now,
    };
    transaction.setDocument(
      dishProposalJobPath(jobId),
      withJobFingerprint(jobWithoutFingerprint),
    );
    transaction.setDocument(
      dishProposalGroupPath(groupId),
      withGroupFingerprint(claimedGroupWithoutFingerprint),
    );
    if (
      isMergeApply &&
      hasDistinctMergeTarget &&
      mergeTargetDishId !== null &&
      mergeClaimFailureCode === null &&
      sourceActiveAggregateWriteGeneration !== null &&
      sourceCompletionAggregateWriteGeneration !== null &&
      targetActiveAggregateWriteGeneration !== null &&
      targetCompletionAggregateWriteGeneration !== null
    ) {
      transaction.setDocument(`bitescore_dishes/${group.sourceDishId}`, {
        aggregateWriteGeneration: sourceActiveAggregateWriteGeneration,
        updatedAt: now,
      }, {merge: true});
      transaction.setDocument(`bitescore_dishes/${mergeTargetDishId}`, {
        aggregateWriteGeneration: targetActiveAggregateWriteGeneration,
        updatedAt: now,
      }, {merge: true});
      transaction.setDocument(
        dishMergeReviewLockPath(group.sourceDishId),
        buildDishMergeReviewLockDocument({
          version: dishMergeReviewLockVersion,
          dishId: group.sourceDishId,
          jobId,
          groupId,
          role: "source",
          state: "active",
          blocksClientReviews: true,
          blocksClientAggregates: true,
          activeAggregateWriteGeneration:
            sourceActiveAggregateWriteGeneration,
          completionAggregateWriteGeneration:
            sourceCompletionAggregateWriteGeneration,
          targetDishId: mergeTargetDishId,
          createdAt: now,
          indexedAt: now,
        }),
      );
      transaction.setDocument(
        dishMergeReviewLockPath(mergeTargetDishId),
        buildDishMergeReviewLockDocument({
          version: dishMergeReviewLockVersion,
          dishId: mergeTargetDishId,
          jobId,
          groupId,
          role: "target",
          state: "active",
          blocksClientReviews: true,
          blocksClientAggregates: true,
          activeAggregateWriteGeneration:
            targetActiveAggregateWriteGeneration,
          completionAggregateWriteGeneration:
            targetCompletionAggregateWriteGeneration,
          targetDishId: null,
          createdAt: now,
          indexedAt: now,
        }),
      );
    }
    return {claimed: true, jobId, reason: "claimed"};
  });
}

export function claimDishProposalGroupForApply(
  database: DishProposalPrivateDatabase,
  groupId: string,
  now: Date,
): Promise<DishProposalClaimResult> {
  return claimDishProposalGroup(database, groupId, "apply", now);
}

export function claimDishProposalGroupForReject(
  database: DishProposalPrivateDatabase,
  groupId: string,
  now: Date,
): Promise<DishProposalClaimResult> {
  return claimDishProposalGroup(database, groupId, "reject", now);
}

function updateJob(
  transaction: DishProposalPrivateTransaction,
  job: DishProposalJobDocument,
  changes: Partial<Omit<DishProposalJobDocument, "version" | "jobId" | "fingerprint">>,
  now: Date,
): DishProposalJobDocument {
  const {fingerprint: _fingerprint, ...withoutFingerprint} = job;
  const next = withJobFingerprint({
    ...withoutFingerprint,
    ...changes,
    updatedAt: now,
  });
  transaction.setDocument(dishProposalJobPath(job.jobId), next);
  return next;
}

async function loadJob(
  transaction: DishProposalPrivateTransaction,
  jobId: string,
): Promise<DishProposalJobDocument> {
  const job = parseDishProposalJobDocument(
    await transaction.getDocument(dishProposalJobPath(jobId)),
  );
  if (job === null) {
    throw new Error("Dish-proposal application job is missing or invalid.");
  }
  return job;
}

export function dishMergeReviewLocksBelongToJob(
  job: Pick<
    DishProposalJobDocument,
    | "jobId"
    | "groupId"
    | "sourceDishId"
    | "mergeTargetDishId"
    | "sourceActiveAggregateWriteGeneration"
    | "sourceCompletionAggregateWriteGeneration"
    | "targetActiveAggregateWriteGeneration"
    | "targetCompletionAggregateWriteGeneration"
  >,
  sourceLock: DishMergeReviewLockDocument | null,
  targetLock: DishMergeReviewLockDocument | null,
): boolean {
  const targetId = job.mergeTargetDishId;
  if (targetId === null) {
    return false;
  }
  return sourceLock?.jobId === job.jobId &&
    sourceLock.groupId === job.groupId &&
    sourceLock.dishId === job.sourceDishId &&
    sourceLock.targetDishId === targetId &&
    sourceLock.state === "active" &&
    sourceLock.role === "source" &&
    sourceLock.activeAggregateWriteGeneration ===
      job.sourceActiveAggregateWriteGeneration &&
    sourceLock.completionAggregateWriteGeneration ===
      job.sourceCompletionAggregateWriteGeneration &&
    targetLock?.jobId === job.jobId &&
    targetLock.groupId === job.groupId &&
    targetLock.dishId === targetId &&
    targetLock.targetDishId === null &&
    targetLock.state === "active" &&
    targetLock.role === "target" &&
    targetLock.activeAggregateWriteGeneration ===
      job.targetActiveAggregateWriteGeneration &&
    targetLock.completionAggregateWriteGeneration ===
      job.targetCompletionAggregateWriteGeneration;
}

function aggregateRoleForPhase(
  phase: DishProposalJobPhase,
): DishReviewAggregateRole {
  if (
    phase === "rebuild_target_aggregate" ||
    phase === "fold_target_aggregate"
  ) {
    return "target";
  }
  if (
    phase === "rebuild_source_aggregate" ||
    phase === "fold_source_aggregate"
  ) {
    return "source";
  }
  throw new Error("Job phase has no aggregate role.");
}

function aggregateDishIdForRole(
  job: DishProposalJobDocument,
  role: DishReviewAggregateRole,
): string {
  if (role === "source") {
    return job.sourceDishId;
  }
  if (job.mergeTargetDishId === null) {
    throw new Error("Merge job has no target aggregate dish ID.");
  }
  return job.mergeTargetDishId;
}

function activeAggregateWriteGenerationForRole(
  job: DishProposalJobDocument,
  role: DishReviewAggregateRole,
): number {
  const generation = role === "source"
    ? job.sourceActiveAggregateWriteGeneration
    : job.targetActiveAggregateWriteGeneration;
  if (generation === null) {
    throw new Error("Merge job has no active aggregate write generation.");
  }
  return generation;
}

export function dishMergeAggregateIsReady(
  document: DishProposalStoredDocument | null,
  dishId: string,
  restaurantId: string,
  generation: number,
): boolean {
  if (document === null || document.id !== dishId) {
    return false;
  }
  const data = document.data;
  return data.dishId === dishId &&
    data.restaurantId === restaurantId &&
    readInteger(data.aggregateWriteGeneration) === generation &&
    readInteger(data.ratingCount) !== null &&
    typeof data.overallBiteScore === "number" &&
    Number.isFinite(data.overallBiteScore);
}

export function dishMergeAggregateCanBeAdvancedAfterSafeAbort(
  document: DishProposalStoredDocument | null,
  dishId: string,
  restaurantId: string,
  activeGeneration: number,
): boolean {
  if (document === null) {
    return true;
  }
  if (
    document.id !== dishId ||
    document.data.dishId !== dishId ||
    document.data.restaurantId !== restaurantId
  ) {
    return false;
  }
  const existingGeneration = Object.prototype.hasOwnProperty.call(
    document.data,
    "aggregateWriteGeneration",
  )
    ? readInteger(document.data.aggregateWriteGeneration)
    : 0;
  return existingGeneration !== null &&
    (existingGeneration === activeGeneration - 1 ||
      existingGeneration === activeGeneration);
}

async function validateRenameStep(
  database: DishProposalPrivateDatabase,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  return database.runTransaction(async (transaction) => {
    const job = await loadJob(transaction, jobId);
    if (job.phase !== "validate_target") {
      return resultFor(job, 0);
    }
    const dish = parseDish(
      await transaction.getDocument(`bitescore_dishes/${job.sourceDishId}`),
    );
    const proposedName = normalizeDishNameForSave(
      job.normalizedProposedName ?? "",
    );
    if (
      dish === null ||
      dish.restaurantId !== job.restaurantId ||
      !dish.isActive ||
      dish.mergedIntoDishId !== null ||
      proposedName.length === 0
    ) {
      const failed = updateJob(transaction, job, {
        status: "manual_review_required",
        failureCode: "rename_target_invalid",
      }, now);
      return resultFor(failed, 0);
    }
    const proposedNormalizedName = proposedName.trim().toLowerCase();
    const meaningful = dish.name.trim() !== proposedName.trim() ||
      dish.normalizedName.trim() !== proposedNormalizedName.trim();
    if (meaningful) {
      transaction.setDocument(`bitescore_dishes/${job.sourceDishId}`, {
        name: proposedName,
        normalizedName: proposedNormalizedName,
        updatedAt: now,
      }, {merge: true});
    }
    const next = updateJob(transaction, job, {
      phase: meaningful ? "award_points" : "finalize_proposals",
      status: "active",
      failureCode: null,
      renameOldValue: dish.name,
      renameNewValue: proposedName,
      shouldAwardPoints: meaningful,
    }, now);
    return resultFor(next, meaningful ? 1 : 0);
  });
}

async function validateMergeStep(
  database: DishProposalPrivateDatabase,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  return database.runTransaction(async (transaction) => {
    const job = await loadJob(transaction, jobId);
    if (job.phase !== "validate_targets") {
      return resultFor(job, 0);
    }
    const targetId = job.mergeTargetDishId;
    if (targetId === null || targetId === job.sourceDishId) {
      const failed = updateJob(transaction, job, {
        status: "manual_review_required",
        failureCode: "merge_targets_invalid",
      }, now);
      return resultFor(failed, 0);
    }
    const [
      sourceDocument,
      targetDocument,
      sourceLockDocument,
      targetLockDocument,
      sourceAggregateDocument,
      targetAggregateDocument,
    ] =
      await Promise.all([
        transaction.getDocument(`bitescore_dishes/${job.sourceDishId}`),
        transaction.getDocument(`bitescore_dishes/${targetId}`),
        transaction.getDocument(dishMergeReviewLockPath(job.sourceDishId)),
        transaction.getDocument(dishMergeReviewLockPath(targetId)),
        transaction.getDocument(
          `dish_rating_aggregates/${job.sourceDishId}`,
        ),
        transaction.getDocument(`dish_rating_aggregates/${targetId}`),
      ]);
    const source = parseDish(sourceDocument);
    const target = parseDish(targetDocument);
    const sourceLock = parseDishMergeReviewLockDocument(sourceLockDocument);
    const targetLock = parseDishMergeReviewLockDocument(targetLockDocument);
    if (!dishMergeReviewLocksBelongToJob(job, sourceLock, targetLock)) {
      const retryable = updateJob(transaction, job, {
        status: "retryable",
        failureCode: "merge_lock_missing",
      }, now);
      return resultFor(retryable, 0);
    }
    const invalid = source === null ||
      target === null ||
      source.restaurantId !== target.restaurantId ||
      source.restaurantId !== job.restaurantId ||
      !source.isActive ||
      source.mergedIntoDishId !== null ||
      !target.isActive ||
      target.mergedIntoDishId !== null ||
      source.documentId === target.documentId;
    if (invalid) {
      const sourceActiveGeneration =
        job.sourceActiveAggregateWriteGeneration;
      const sourceCompletionGeneration =
        job.sourceCompletionAggregateWriteGeneration;
      const targetActiveGeneration =
        job.targetActiveAggregateWriteGeneration;
      const targetCompletionGeneration =
        job.targetCompletionAggregateWriteGeneration;
      const canSafelyUnlock = source !== null &&
        target !== null &&
        sourceActiveGeneration !== null &&
        sourceCompletionGeneration !== null &&
        targetActiveGeneration !== null &&
        targetCompletionGeneration !== null &&
        source.aggregateWriteGeneration === sourceActiveGeneration &&
        target.aggregateWriteGeneration === targetActiveGeneration &&
        dishMergeAggregateCanBeAdvancedAfterSafeAbort(
          sourceAggregateDocument,
          job.sourceDishId,
          job.restaurantId,
          sourceActiveGeneration,
        ) &&
        dishMergeAggregateCanBeAdvancedAfterSafeAbort(
          targetAggregateDocument,
          targetId,
          job.restaurantId,
          targetActiveGeneration,
        );
      if (!canSafelyUnlock) {
        const retained = updateJob(transaction, job, {
          status: "manual_review_required",
          failureCode: "merge_targets_invalid_locks_retained",
        }, now);
        return resultFor(retained, 0);
      }
      transaction.setDocument(`bitescore_dishes/${job.sourceDishId}`, {
        aggregateWriteGeneration: sourceCompletionGeneration,
        updatedAt: now,
      }, {merge: true});
      transaction.setDocument(`bitescore_dishes/${targetId}`, {
        aggregateWriteGeneration: targetCompletionGeneration,
        updatedAt: now,
      }, {merge: true});
      if (sourceAggregateDocument !== null) {
        transaction.setDocument(
          `dish_rating_aggregates/${job.sourceDishId}`,
          {aggregateWriteGeneration: sourceCompletionGeneration, updatedAt: now},
          {merge: true},
        );
      }
      if (targetAggregateDocument !== null) {
        transaction.setDocument(
          `dish_rating_aggregates/${targetId}`,
          {aggregateWriteGeneration: targetCompletionGeneration, updatedAt: now},
          {merge: true},
        );
      }
      transaction.deleteDocument(dishMergeReviewLockPath(job.sourceDishId));
      transaction.deleteDocument(dishMergeReviewLockPath(targetId));
      const failed = updateJob(transaction, job, {
        status: "manual_review_required",
        failureCode: "merge_targets_invalid",
      }, now);
      return resultFor(failed, 0);
    }
    const next = updateJob(transaction, job, {
      phase: "move_reviews",
      status: "active",
      failureCode: null,
      renameOldValue: source.name,
      renameNewValue: target.name,
      shouldAwardPoints: true,
    }, now);
    return resultFor(next, 0);
  });
}

async function moveReviewsStep(
  database: DishProposalPrivateDatabase,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  return database.runTransaction(async (transaction) => {
    const job = await loadJob(transaction, jobId);
    if (job.phase !== "move_reviews") {
      return resultFor(job, 0);
    }
    const targetId = job.mergeTargetDishId;
    if (targetId === null) {
      throw new Error("Merge job has no target dish ID.");
    }
    const [sourceLockDocument, targetLockDocument] = await Promise.all([
      transaction.getDocument(dishMergeReviewLockPath(job.sourceDishId)),
      transaction.getDocument(dishMergeReviewLockPath(targetId)),
    ]);
    if (!dishMergeReviewLocksBelongToJob(
      job,
      parseDishMergeReviewLockDocument(sourceLockDocument),
      parseDishMergeReviewLockDocument(targetLockDocument),
    )) {
      const retryable = updateJob(transaction, job, {
        status: "retryable",
        failureCode: "merge_lock_missing",
      }, now);
      return resultFor(retryable, 0);
    }
    const documents = await transaction.queryDocuments({
      collectionPath: "dish_reviews",
      where: Object.freeze([
        {field: "dishId", operator: "==", value: job.sourceDishId},
      ]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      startAfter: job.reviewMigrationCursorId === null
        ? null
        : Object.freeze([job.reviewMigrationCursorId]),
      limit: dishProposalReviewMigrationBatchSize,
    });
    for (const document of documents) {
      transaction.setDocument(`dish_reviews/${document.id}`, {
        dishId: targetId,
        restaurantId: job.restaurantId,
        updatedAt: now,
      }, {merge: true});
    }
    const exhausted = documents.length < dishProposalReviewMigrationBatchSize;
    const lastDocument = documents.length === 0
      ? null
      : documents[documents.length - 1];
    const next = updateJob(transaction, job, exhausted
      ? {
          phase: "rebuild_target_aggregate",
          status: "active",
          failureCode: null,
          reviewMigrationCursorId:
            lastDocument?.id ?? job.reviewMigrationCursorId,
          aggregateState: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
        }
      : {
          status: "active",
          failureCode: null,
          reviewMigrationCursorId: lastDocument?.id ?? null,
        }, now);
    return resultFor(next, documents.length);
  });
}

async function rebuildAggregateStep(
  database: DishProposalPrivateDatabase,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  return database.runTransaction(async (transaction) => {
    const job = await loadJob(transaction, jobId);
    if (
      job.phase !== "rebuild_target_aggregate" &&
      job.phase !== "rebuild_source_aggregate"
    ) {
      return resultFor(job, 0);
    }
    const targetId = job.mergeTargetDishId;
    if (targetId === null) {
      throw new Error("Merge job has no target dish ID.");
    }
    const [sourceLockDocument, targetLockDocument] = await Promise.all([
      transaction.getDocument(dishMergeReviewLockPath(job.sourceDishId)),
      transaction.getDocument(dishMergeReviewLockPath(targetId)),
    ]);
    if (!dishMergeReviewLocksBelongToJob(
      job,
      parseDishMergeReviewLockDocument(sourceLockDocument),
      parseDishMergeReviewLockDocument(targetLockDocument),
    )) {
      const retryable = updateJob(transaction, job, {
        status: "retryable",
        failureCode: "merge_lock_missing",
      }, now);
      return resultFor(retryable, 0);
    }
    const role = aggregateRoleForPhase(job.phase);
    const dishId = aggregateDishIdForRole(job, role);
    const documents = await transaction.queryDocuments({
      collectionPath: "dish_reviews",
      where: Object.freeze([
        {field: "dishId", operator: "==", value: dishId},
      ]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      startAfter: job.aggregateCursorDocumentId === null
        ? null
        : Object.freeze([job.aggregateCursorDocumentId]),
      limit: dishProposalAggregateScanBatchSize,
    });
    const pageWinners = new Map<string, DishReviewAggregateWinnerDocument>();
    for (const document of documents) {
      const candidate = parseDishReviewAggregateCandidate({
        id: document.id,
        data: document.data,
      });
      if (candidate === null || candidate.dishId !== dishId) {
        continue;
      }
      const candidateWinner = buildDishReviewAggregateWinnerDocument({
        jobId: job.jobId,
        aggregateRole: role,
        candidate,
        indexedAt: now,
      });
      const pageWinner = pageWinners.get(candidateWinner.winnerId);
      pageWinners.set(
        candidateWinner.winnerId,
        pageWinner === undefined
          ? candidateWinner
          : chooseDishReviewAggregateWinnerDocument(
              pageWinner,
              candidateWinner,
            ),
      );
    }
    const winnerCollection = dishReviewAggregateWinnerCollectionPath(job.jobId);
    const candidateWinners = [...pageWinners.values()];
    const existingWinnerDocuments = await Promise.all(
      candidateWinners.map((winner) =>
        transaction.getDocument(`${winnerCollection}/${winner.winnerId}`)
      ),
    );
    for (let index = 0; index < candidateWinners.length; index += 1) {
      const candidateWinner = candidateWinners[index];
      const existingWinner = parseDishReviewAggregateWinnerDocument(
        existingWinnerDocuments[index],
      );
      if (
        existingWinner !== null &&
        (existingWinner.jobId !== job.jobId ||
          existingWinner.aggregateRole !== role ||
          existingWinner.dishId !== dishId)
      ) {
        throw new Error("Aggregate winner belongs to another job or role.");
      }
      const winner = existingWinner === null
        ? candidateWinner
        : chooseDishReviewAggregateWinnerDocument(
            existingWinner,
            candidateWinner,
          );
      if (existingWinner === null || winner.fingerprint !== existingWinner.fingerprint) {
        transaction.setDocument(
          `${winnerCollection}/${winner.winnerId}`,
          winner,
        );
      }
    }
    const lastDocument = documents.length === 0
      ? null
      : documents[documents.length - 1];
    const exhausted = documents.length < dishProposalAggregateScanBatchSize;
    if (!exhausted) {
      const next = updateJob(transaction, job, {
        status: "active",
        failureCode: null,
        aggregateCursorDocumentId: lastDocument?.id ?? null,
      }, now);
      return resultFor(next, documents.length);
    }
    const next = updateJob(transaction, job, {
      phase: role === "target"
        ? "fold_target_aggregate"
        : "fold_source_aggregate",
      status: "active",
      failureCode: null,
      aggregateState: createDishReviewAggregateAccumulator(dishId),
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
    }, now);
    return resultFor(next, documents.length);
  });
}

async function foldAggregateWinnersStep(
  database: DishProposalPrivateDatabase,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  return database.runTransaction(async (transaction) => {
    const job = await loadJob(transaction, jobId);
    if (
      job.phase !== "fold_target_aggregate" &&
      job.phase !== "fold_source_aggregate"
    ) {
      return resultFor(job, 0);
    }
    const targetId = job.mergeTargetDishId;
    if (targetId === null) {
      throw new Error("Merge job has no target dish ID.");
    }
    const [sourceLockDocument, targetLockDocument] = await Promise.all([
      transaction.getDocument(dishMergeReviewLockPath(job.sourceDishId)),
      transaction.getDocument(dishMergeReviewLockPath(targetId)),
    ]);
    if (!dishMergeReviewLocksBelongToJob(
      job,
      parseDishMergeReviewLockDocument(sourceLockDocument),
      parseDishMergeReviewLockDocument(targetLockDocument),
    )) {
      const retryable = updateJob(transaction, job, {
        status: "retryable",
        failureCode: "merge_lock_missing",
      }, now);
      return resultFor(retryable, 0);
    }
    const role = aggregateRoleForPhase(job.phase);
    const dishId = aggregateDishIdForRole(job, role);
    if (job.aggregateState === null) {
      throw new Error("Aggregate fold has no accumulator.");
    }
    const winnerCollection = dishReviewAggregateWinnerCollectionPath(job.jobId);
    const documents = await transaction.queryDocuments({
      collectionPath: winnerCollection,
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      startAfter: job.aggregateWinnerCursorId === null
        ? null
        : Object.freeze([job.aggregateWinnerCursorId]),
      limit: dishProposalAggregateScanBatchSize,
    });
    const winners = documents.map((document) => {
      const winner = parseDishReviewAggregateWinnerDocument(document);
      if (
        winner === null ||
        winner.jobId !== job.jobId ||
        winner.aggregateRole !== role ||
        winner.dishId !== dishId
      ) {
        throw new Error("Aggregate winner belongs to another job or role.");
      }
      return winner;
    });
    const nextAccumulator = accumulateDishReviewAggregateWinnerPage(
      restoreDishReviewAggregateAccumulator(job.aggregateState),
      winners,
    );
    for (const winner of winners) {
      transaction.deleteDocument(`${winnerCollection}/${winner.winnerId}`);
    }
    const lastDocument = documents.length === 0
      ? null
      : documents[documents.length - 1];
    const exhausted = documents.length < dishProposalAggregateScanBatchSize;
    if (!exhausted) {
      const next = updateJob(transaction, job, {
        status: "active",
        failureCode: null,
        aggregateState: nextAccumulator,
        aggregateWinnerCursorId: lastDocument?.id ?? null,
      }, now);
      return resultFor(next, documents.length);
    }
    const aggregate = finalizeDishReviewAggregate(
      nextAccumulator,
      job.restaurantId,
    );
    transaction.setDocument(`dish_rating_aggregates/${dishId}`, {
      ...aggregate,
      aggregateWriteGeneration: activeAggregateWriteGenerationForRole(
        job,
        role,
      ),
      updatedAt: now,
    });
    const next = updateJob(transaction, job, role === "target"
      ? {
          phase: "rebuild_source_aggregate",
          status: "active",
          failureCode: null,
          aggregateState: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
        }
      : {
          phase: "finalize_dishes",
          status: "active",
          failureCode: null,
          aggregateState: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
        }, now);
    return resultFor(next, documents.length);
  });
}

async function finalizeDishesStep(
  database: DishProposalPrivateDatabase,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  return database.runTransaction(async (transaction) => {
    const job = await loadJob(transaction, jobId);
    if (job.phase !== "finalize_dishes") {
      return resultFor(job, 0);
    }
    const targetId = job.mergeTargetDishId;
    if (targetId === null) {
      throw new Error("Merge job has no target dish ID.");
    }
    const [
      sourceDocument,
      targetDocument,
      sourceLockDocument,
      targetLockDocument,
      sourceAggregateDocument,
      targetAggregateDocument,
    ] =
      await Promise.all([
        transaction.getDocument(`bitescore_dishes/${job.sourceDishId}`),
        transaction.getDocument(`bitescore_dishes/${targetId}`),
        transaction.getDocument(dishMergeReviewLockPath(job.sourceDishId)),
        transaction.getDocument(dishMergeReviewLockPath(targetId)),
        transaction.getDocument(
          `dish_rating_aggregates/${job.sourceDishId}`,
        ),
        transaction.getDocument(`dish_rating_aggregates/${targetId}`),
      ]);
    const source = parseDish(sourceDocument);
    const target = parseDish(targetDocument);
    if (!dishMergeReviewLocksBelongToJob(
      job,
      parseDishMergeReviewLockDocument(sourceLockDocument),
      parseDishMergeReviewLockDocument(targetLockDocument),
    )) {
      const retryable = updateJob(transaction, job, {
        status: "retryable",
        failureCode: "merge_lock_missing",
      }, now);
      return resultFor(retryable, 0);
    }
    const alreadyFinalized = source !== null &&
      !source.isActive &&
      source.mergedIntoDishId === targetId;
    const aggregateGenerationsReady =
      job.sourceActiveAggregateWriteGeneration !== null &&
      job.targetActiveAggregateWriteGeneration !== null &&
      source !== null &&
      target !== null &&
      source.aggregateWriteGeneration ===
        job.sourceActiveAggregateWriteGeneration &&
      target.aggregateWriteGeneration ===
        job.targetActiveAggregateWriteGeneration &&
      dishMergeAggregateIsReady(
        sourceAggregateDocument,
        job.sourceDishId,
        job.restaurantId,
        job.sourceActiveAggregateWriteGeneration,
      ) &&
      dishMergeAggregateIsReady(
        targetAggregateDocument,
        targetId,
        job.restaurantId,
        job.targetActiveAggregateWriteGeneration,
      );
    const valid = target !== null &&
      target.restaurantId === job.restaurantId &&
      target.isActive &&
      target.mergedIntoDishId === null &&
      source !== null &&
      source.restaurantId === target.restaurantId &&
      (alreadyFinalized ||
        (source.isActive && source.mergedIntoDishId === null)) &&
      aggregateGenerationsReady;
    if (!valid) {
      const failed = updateJob(transaction, job, {
        status: "retryable",
        failureCode: aggregateGenerationsReady
          ? "merge_finalization_invalid"
          : "merge_aggregate_not_ready",
      }, now);
      return resultFor(failed, 0);
    }
    if (!alreadyFinalized) {
      transaction.setDocument(`bitescore_dishes/${job.sourceDishId}`, {
        isActive: false,
        mergedIntoDishId: targetId,
        updatedAt: now,
      }, {merge: true});
    }
    const next = updateJob(transaction, job, {
      phase: job.shouldAwardPoints ? "award_points" : "finalize_proposals",
      status: "active",
      failureCode: null,
      renameOldValue: source!.name,
      renameNewValue: target!.name,
    }, now);
    return resultFor(next, alreadyFinalized ? 0 : 1);
  });
}

function cycleMemberQuery(job: DishProposalJobDocument, limit: number) {
  const startAfter = job.pointsCursorGeneration === null ||
      job.pointsCursorMemberId === null
    ? null
    : Object.freeze([
        job.pointsCursorGeneration,
        job.pointsCursorMemberId,
      ]);
  return {
    collectionPath: dishProposalMemberCollection,
    where: Object.freeze([
      {field: "groupId", operator: "==" as const, value: job.groupId},
      {field: "currentPending", operator: "==" as const, value: true},
      {
        field: "membershipGeneration",
        operator: "<=" as const,
        value: job.cycleCutoffGeneration,
      },
    ]),
    orderBy: Object.freeze([
      {field: "membershipGeneration", direction: "asc" as const},
      {field: "__name__", direction: "asc" as const},
    ]),
    startAfter,
    limit,
  };
}

async function awardPointsStep(
  dependencies: DishProposalResolutionDependencies,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  const selected = await dependencies.database.runTransaction(
    async (transaction) => {
      const job = await loadJob(transaction, jobId);
      if (job.phase !== "award_points") {
        return {job, member: null};
      }
      if (!job.shouldAwardPoints) {
        const next = updateJob(transaction, job, {
          phase: "finalize_proposals",
          status: "active",
          failureCode: null,
        }, now);
        return {job: next, member: null};
      }
      const documents = await transaction.queryDocuments(cycleMemberQuery(job, 1));
      const member = parseDishProposalMemberDocument(documents[0] ?? null);
      if (member === null) {
        const next = updateJob(transaction, job, {
          phase: "finalize_proposals",
          status: "active",
          failureCode: null,
        }, now);
        return {job: next, member: null};
      }
      const proposalDocument = await transaction.getDocument(
        `dish_edit_proposals/${member.proposalDocumentId}`,
      );
      const currentMembership = proposalDocument === null
        ? null
        : buildDishProposalMembership({
            proposalDocumentId: member.proposalDocumentId,
            source: proposalDocument.data,
            trustedServerCreateTime: proposalDocument.createTime,
          });
      const stillBelongs = currentMembership?.groupId === job.groupId &&
        currentMembership.proposalDocumentId === member.proposalDocumentId &&
        currentMembership.supporterUid === member.supporterUid &&
        currentMembership.trustedServerCreateTime.getTime() ===
          member.trustedServerCreateTime.getTime();
      if (!stillBelongs) {
        await applyDishProposalMemberChange(
          transaction,
          {
            memberDocumentId: documents[0].id,
            existingMember: member,
            nextMembership: currentMembership,
          },
          now,
        );
        return {job, member: null};
      }
      return {job, member, memberDocumentId: documents[0].id};
    },
  );
  if (selected.member === null || selected.job.phase !== "award_points") {
    return resultFor(selected.job, 0);
  }
  const award = await dependencies.awardApprovedProposalPoints({
    proposalDocumentId: selected.member.proposalDocumentId,
    oldValue: selected.job.renameOldValue,
    newValue: selected.job.renameNewValue,
    groupId: selected.job.groupId,
    supporterUid: selected.member.supporterUid,
    membershipGeneration: selected.member.membershipGeneration,
    cycleCutoffGeneration: selected.job.cycleCutoffGeneration,
    activeJobId: selected.job.jobId,
    trustedServerCreateTimeMillis:
      selected.member.trustedServerCreateTime.getTime(),
  });
  if (award.outcome === "notEligible") {
    return dependencies.database.runTransaction(async (transaction) => {
      const current = await loadJob(transaction, jobId);
      if (
        current.phase !== "award_points" ||
        current.pointsCursorGeneration !== selected.job.pointsCursorGeneration ||
        current.pointsCursorMemberId !== selected.job.pointsCursorMemberId
      ) {
        return resultFor(current, 0);
      }
      const memberDocumentId = selected.memberDocumentId;
      if (memberDocumentId === undefined) {
        throw new Error("Selected point member has no document identity.");
      }
      const memberDocument = await transaction.getDocument(
        `${dishProposalMemberCollection}/${memberDocumentId}`,
      );
      const member = parseDishProposalMemberDocument(memberDocument);
      if (member === null) {
        return resultFor(current, 0);
      }
      const proposalDocument = await transaction.getDocument(
        `dish_edit_proposals/${member.proposalDocumentId}`,
      );
      const currentMembership = proposalDocument === null
        ? null
        : buildDishProposalMembership({
            proposalDocumentId: member.proposalDocumentId,
            source: proposalDocument.data,
            trustedServerCreateTime: proposalDocument.createTime,
          });
      const membershipChanged = currentMembership === null ||
        currentMembership.groupId !== member.groupId ||
        currentMembership.supporterUid !== member.supporterUid ||
        currentMembership.trustedServerCreateTime.getTime() !==
          member.trustedServerCreateTime.getTime();
      if (membershipChanged) {
        await applyDishProposalMemberChange(
          transaction,
          {
            memberDocumentId,
            existingMember: member,
            nextMembership: currentMembership,
          },
          now,
        );
        return resultFor(current, 1);
      }
      const retryable = updateJob(transaction, current, {
        status: "retryable",
        failureCode: "point_award_not_eligible",
      }, now);
      return resultFor(retryable, 0);
    });
  }
  if (
    award.outcome !== "awarded" &&
    award.outcome !== "alreadyAwarded" &&
    award.outcome !== "noAwardForNoOp"
  ) {
    throw new Error("Point helper returned an unrecognized outcome.");
  }
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadJob(transaction, jobId);
    if (
      current.phase !== "award_points" ||
      current.pointsCursorGeneration !== selected.job.pointsCursorGeneration ||
      current.pointsCursorMemberId !== selected.job.pointsCursorMemberId
    ) {
      return resultFor(current, 0);
    }
    const next = updateJob(transaction, current, {
      status: "active",
      failureCode: null,
      pointsCursorGeneration: selected.member!.membershipGeneration,
      pointsCursorMemberId: selected.memberDocumentId ?? null,
    }, now);
    return resultFor(next, 1);
  });
}

async function completeJobWithinTransaction(
  transaction: DishProposalPrivateTransaction,
  job: DishProposalJobDocument,
  now: Date,
): Promise<DishProposalJobDocument> {
  const [groupDocument, currentMembers] = await Promise.all([
    transaction.getDocument(dishProposalGroupPath(job.groupId)),
    transaction.queryDocuments({
      collectionPath: dishProposalMemberCollection,
      where: Object.freeze([
        {field: "groupId", operator: "==", value: job.groupId},
        {field: "currentPending", operator: "==", value: true},
      ]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: 1,
    }),
  ]);
  const group = parseDishProposalGroupDocument(groupDocument);
  if (currentMembers.length > 0) {
    parseDishProposalMemberDocument(currentMembers[0]);
  }
  if (
    group === null ||
    group.activeJobId !== job.jobId ||
    group.activeResolutionType !== job.resolutionType ||
    group.cycleCutoffGeneration !== job.cycleCutoffGeneration ||
    group.cycleCutoffAt?.getTime() !== job.cycleCutoffAt.getTime()
  ) {
    throw new Error("Dish-proposal group lost its active job gate.");
  }
  let sourceLock: DishMergeReviewLockDocument | null = null;
  let targetLock: DishMergeReviewLockDocument | null = null;
  let source: ParsedDish | null = null;
  let target: ParsedDish | null = null;
  let sourceAggregateDocument: DishProposalStoredDocument | null = null;
  let targetAggregateDocument: DishProposalStoredDocument | null = null;
  if (
    job.resolutionType === "apply" &&
    job.proposalType === "merge" &&
    job.mergeTargetDishId !== null
  ) {
    const [
      sourceLockDocument,
      targetLockDocument,
      sourceDocument,
      targetDocument,
      loadedSourceAggregateDocument,
      loadedTargetAggregateDocument,
      remainingWinners,
    ] = await Promise.all([
      transaction.getDocument(dishMergeReviewLockPath(job.sourceDishId)),
      transaction.getDocument(dishMergeReviewLockPath(job.mergeTargetDishId)),
      transaction.getDocument(`bitescore_dishes/${job.sourceDishId}`),
      transaction.getDocument(`bitescore_dishes/${job.mergeTargetDishId}`),
      transaction.getDocument(
        `dish_rating_aggregates/${job.sourceDishId}`,
      ),
      transaction.getDocument(
        `dish_rating_aggregates/${job.mergeTargetDishId}`,
      ),
      transaction.queryDocuments({
        collectionPath: dishReviewAggregateWinnerCollectionPath(job.jobId),
        orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
        limit: 1,
      }),
    ]);
    sourceLock = parseDishMergeReviewLockDocument(sourceLockDocument);
    targetLock = parseDishMergeReviewLockDocument(targetLockDocument);
    source = parseDish(sourceDocument);
    target = parseDish(targetDocument);
    sourceAggregateDocument = loadedSourceAggregateDocument;
    targetAggregateDocument = loadedTargetAggregateDocument;
    if (!dishMergeReviewLocksBelongToJob(job, sourceLock, targetLock)) {
      throw new Error("Merge locks were lost before job completion.");
    }
    if (
      source === null ||
      target === null ||
      job.sourceActiveAggregateWriteGeneration === null ||
      job.sourceCompletionAggregateWriteGeneration === null ||
      job.targetActiveAggregateWriteGeneration === null ||
      job.targetCompletionAggregateWriteGeneration === null ||
      source.restaurantId !== job.restaurantId ||
      target.restaurantId !== job.restaurantId ||
      source.isActive ||
      source.mergedIntoDishId !== job.mergeTargetDishId ||
      !target.isActive ||
      target.mergedIntoDishId !== null ||
      source.aggregateWriteGeneration !==
        job.sourceActiveAggregateWriteGeneration ||
      target.aggregateWriteGeneration !==
        job.targetActiveAggregateWriteGeneration ||
      !dishMergeAggregateIsReady(
        sourceAggregateDocument,
        job.sourceDishId,
        job.restaurantId,
        job.sourceActiveAggregateWriteGeneration,
      ) ||
      !dishMergeAggregateIsReady(
        targetAggregateDocument,
        job.mergeTargetDishId,
        job.restaurantId,
        job.targetActiveAggregateWriteGeneration,
      ) ||
      remainingWinners.length !== 0
    ) {
      throw new Error("Merge aggregate state is not ready for safe unlock.");
    }
  }

  const completed = updateJob(transaction, job, {
    phase: "complete",
    status: "complete",
    failureCode: null,
    completedAt: now,
  }, now);
  if (currentMembers.length === 0) {
    transaction.deleteDocument(dishProposalGroupPath(job.groupId));
  } else {
    const {fingerprint: _fingerprint, ...withoutFingerprint} = group;
    transaction.setDocument(
      dishProposalGroupPath(job.groupId),
      withGroupFingerprint({
        ...withoutFingerprint,
        activeJobId: null,
        activeResolutionType: null,
        cycleCutoffGeneration: null,
        cycleCutoffAt: null,
        autoEligible: group.enoughSupporters,
        indexedAt: now,
      }),
    );
  }
  if (
    sourceLock !== null &&
    targetLock !== null &&
    source !== null &&
    target !== null &&
    sourceAggregateDocument !== null &&
    targetAggregateDocument !== null &&
    job.mergeTargetDishId !== null &&
    job.sourceCompletionAggregateWriteGeneration !== null &&
    job.targetCompletionAggregateWriteGeneration !== null
  ) {
    transaction.setDocument(`bitescore_dishes/${job.sourceDishId}`, {
      aggregateWriteGeneration:
        job.sourceCompletionAggregateWriteGeneration,
      updatedAt: now,
    }, {merge: true});
    transaction.setDocument(`bitescore_dishes/${job.mergeTargetDishId}`, {
      aggregateWriteGeneration:
        job.targetCompletionAggregateWriteGeneration,
      updatedAt: now,
    }, {merge: true});
    transaction.setDocument(
      `dish_rating_aggregates/${job.sourceDishId}`,
      {
        aggregateWriteGeneration:
          job.sourceCompletionAggregateWriteGeneration,
        updatedAt: now,
      },
      {merge: true},
    );
    transaction.setDocument(
      `dish_rating_aggregates/${job.mergeTargetDishId}`,
      {
        aggregateWriteGeneration:
          job.targetCompletionAggregateWriteGeneration,
        updatedAt: now,
      },
      {merge: true},
    );
    transaction.setDocument(
      dishMergeReviewLockPath(job.sourceDishId),
      buildDishMergeReviewLockDocument({
        version: dishMergeReviewLockVersion,
        dishId: job.sourceDishId,
        jobId: job.jobId,
        groupId: job.groupId,
        role: "source",
        state: "merged_source",
        blocksClientReviews: true,
        blocksClientAggregates: true,
        activeAggregateWriteGeneration:
          job.sourceCompletionAggregateWriteGeneration,
        completionAggregateWriteGeneration:
          job.sourceCompletionAggregateWriteGeneration,
        targetDishId: job.mergeTargetDishId,
        createdAt: sourceLock.createdAt,
        indexedAt: now,
      }),
    );
    transaction.deleteDocument(
      dishMergeReviewLockPath(job.mergeTargetDishId),
    );
  }
  return completed;
}

async function finalizeProposalStep(
  database: DishProposalPrivateDatabase,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  return database.runTransaction(async (transaction) => {
    const job = await loadJob(transaction, jobId);
    if (
      job.phase !== "finalize_proposals" &&
      job.phase !== "finalize_rejections"
    ) {
      return resultFor(job, 0);
    }
    const documents = await transaction.queryDocuments(
      cycleMemberQuery({...job, pointsCursorGeneration: null, pointsCursorMemberId: null},
        dishProposalFinalizationBatchSize),
    );
    const memberDocument = documents[0] ?? null;
    const member = parseDishProposalMemberDocument(memberDocument);
    if (member === null || memberDocument === null) {
      const completed = await completeJobWithinTransaction(
        transaction,
        job,
        now,
      );
      return resultFor(completed, 0);
    }
    const proposalDocument = await transaction.getDocument(
      `dish_edit_proposals/${member.proposalDocumentId}`,
    );
    const currentMembership = proposalDocument === null
      ? null
      : buildDishProposalMembership({
          proposalDocumentId: member.proposalDocumentId,
          source: proposalDocument.data,
          trustedServerCreateTime: proposalDocument.createTime,
        });
    const stillBelongs = currentMembership?.groupId === job.groupId &&
      currentMembership.proposalDocumentId === member.proposalDocumentId &&
      currentMembership.supporterUid === member.supporterUid &&
      currentMembership.trustedServerCreateTime.getTime() ===
        member.trustedServerCreateTime.getTime();
    await applyDishProposalMemberChange(
      transaction,
      {
        memberDocumentId: memberDocument.id,
        existingMember: member,
        nextMembership: stillBelongs ? null : currentMembership,
      },
      now,
    );
    if (stillBelongs) {
      transaction.setDocument(
        `dish_edit_proposals/${member.proposalDocumentId}`,
        {
          status: job.phase === "finalize_rejections"
            ? "rejected"
            : "approved",
          updatedAt: now,
        },
        {merge: true},
      );
    }
    return resultFor(job, 1);
  });
}

function resultFor(
  job: DishProposalJobDocument,
  processedDocuments: number,
): DishProposalJobStepResult {
  return {
    jobId: job.jobId,
    phase: job.phase,
    status: job.status,
    processedDocuments,
  };
}

async function markJobRetryable(
  database: DishProposalPrivateDatabase,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  return database.runTransaction(async (transaction) => {
    const job = await loadJob(transaction, jobId);
    if (job.status === "complete" || job.status === "manual_review_required") {
      return resultFor(job, 0);
    }
    return resultFor(updateJob(transaction, job, {
      status: "retryable",
      failureCode: "retryable_step_failure",
    }, now), 0);
  });
}

export async function processDishProposalJobStep(
  dependencies: DishProposalResolutionDependencies,
  jobId: string,
  now: Date,
): Promise<DishProposalJobStepResult> {
  try {
    const snapshot = await dependencies.database.runTransaction(
      async (transaction) => loadJob(transaction, jobId),
    );
    if (snapshot.status === "complete" ||
        snapshot.status === "manual_review_required") {
      return resultFor(snapshot, 0);
    }
    switch (snapshot.phase) {
      case "validate_target":
        return await validateRenameStep(dependencies.database, jobId, now);
      case "validate_targets":
        return await validateMergeStep(dependencies.database, jobId, now);
      case "move_reviews":
        return await moveReviewsStep(dependencies.database, jobId, now);
      case "rebuild_target_aggregate":
      case "rebuild_source_aggregate":
        return await rebuildAggregateStep(dependencies.database, jobId, now);
      case "fold_target_aggregate":
      case "fold_source_aggregate":
        return await foldAggregateWinnersStep(
          dependencies.database,
          jobId,
          now,
        );
      case "finalize_dishes":
        return await finalizeDishesStep(dependencies.database, jobId, now);
      case "award_points":
        return await awardPointsStep(dependencies, jobId, now);
      case "finalize_proposals":
      case "finalize_rejections":
        return await finalizeProposalStep(dependencies.database, jobId, now);
      case "complete":
        return resultFor(snapshot, 0);
    }
    throw new Error("Dish-proposal application job has an unknown phase.");
  } catch {
    return await markJobRetryable(dependencies.database, jobId, now);
  }
}

export const dishProposalResolutionJobCollections = Object.freeze({
  jobs: dishProposalJobCollection,
  members: dishProposalMemberCollection,
});
