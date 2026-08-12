import {createHash} from "node:crypto";

import type {
  ContributionPointDishReverseCursor,
  ReviewMilestoneAccumulatorResetCursor,
  ReviewMilestoneReconcileCursor,
  ReviewMilestoneReviewCursor,
} from "./contribution_points_helpers.js";
import type {
  DishReviewAggregateAccumulator,
} from "./dish_review_aggregate_accumulator.js";

export const ratingDestructiveJobCollection =
  "private_rating_destructive_jobs" as const;
export const ratingDestructiveJobItemCollection =
  "private_rating_destructive_job_items" as const;
export const ratingRestaurantOperationLockCollection =
  "private_rating_restaurant_operation_locks" as const;
export const ratingDishOperationLockCollection =
  "private_rating_dish_operation_locks" as const;

export const ratingDestructiveJobVersion =
  "bitestar.rating-destructive-job.v1" as const;
export const ratingDestructiveItemVersion =
  "bitestar.rating-destructive-item.v1" as const;
export const ratingRestaurantOperationLockVersion =
  "bitestar.rating-restaurant-operation-lock.v1" as const;
export const ratingDishOperationLockVersion =
  "bitestar.rating-dish-operation-lock.v1" as const;
export const ratingDestructiveCallerBindingDomain =
  "bitestar.rating-destructive-caller-binding.v1" as const;

export const ratingDestructiveDirectBatchLimit = 100;
export const ratingDestructiveTrustBatchLimit = 50;
export const ratingDestructivePointReversalBatchLimit = 50;
export const ratingDestructiveMilestoneReviewBatchLimit = 100;
export const ratingDestructiveMilestoneReconciliationBatchLimit = 50;
export const ratingDestructiveAggregateBatchLimit = 100;
export const ratingDestructiveItemMaterializationBatchLimit = 100;

export type RatingDestructiveOperation =
  | "restaurantMerge"
  | "restaurantDelete"
  | "dishMerge"
  | "dishDelete";

export type RatingDestructiveStatus =
  | "active"
  | "retryable"
  | "manual_review_required"
  | "complete";

export type RatingDestructiveAuthorizedCallerKind = "admin" | "owner";

export type RatingDestructiveJobPhase =
  | "claimed"
  | "move_dishes"
  | "move_reviews"
  | "rebuild_moved_dish_aggregates"
  | "move_claim_requests"
  | "move_dish_proposals"
  | "move_restaurant_reports"
  | "move_dish_reports"
  | "move_review_reports"
  | "move_review_feedback_votes"
  | "resolve_duplicate_reports"
  | "finalize_restaurants"
  | "process_dishes"
  | "process_orphan_reviews"
  | "delete_restaurant_reports"
  | "delete_duplicate_reports"
  | "reconcile_milestone_users"
  | "finalize_restaurant"
  | "validate"
  | "rebuild_target_aggregate"
  | "fold_target_aggregate"
  | "rebuild_source_aggregate"
  | "fold_source_aggregate"
  | "finalize_dishes"
  | "process_reviews"
  | "reverse_contribution_points"
  | "delete_dish_reports"
  | "delete_aggregate"
  | "delete_dish"
  | "complete";

export type RatingDestructiveFailureCode =
  | "temporary_dependency"
  | "operation_conflict"
  | "preexisting_job_active"
  | "malformed_private_state"
  | "entity_state_incompatible"
  | "lock_missing"
  | "revision_exhausted"
  | "generation_exhausted"
  | "unsupported_partial_state";

export type RatingDestructiveAggregateState =
  DishReviewAggregateAccumulator;

export type RatingDestructiveJobDocument = Readonly<{
  version: typeof ratingDestructiveJobVersion;
  jobId: string;
  requestId: string;
  operation: RatingDestructiveOperation;
  authorizedCallerKind: RatingDestructiveAuthorizedCallerKind;
  callerBindingFingerprint: string;
  status: RatingDestructiveStatus;
  phase: RatingDestructiveJobPhase;
  sourceRestaurantId: string | null;
  targetRestaurantId: string | null;
  sourceDishId: string | null;
  targetDishId: string | null;
  restaurantId: string | null;
  expectedSourceRestaurantRevision: number | null;
  sourceActiveRestaurantRevision: number | null;
  sourceCompletionRestaurantRevision: number | null;
  expectedTargetRestaurantRevision: number | null;
  targetActiveRestaurantRevision: number | null;
  targetCompletionRestaurantRevision: number | null;
  expectedSourceAggregateGeneration: number | null;
  sourceActiveAggregateGeneration: number | null;
  sourceCompletionAggregateGeneration: number | null;
  expectedTargetAggregateGeneration: number | null;
  targetActiveAggregateGeneration: number | null;
  targetCompletionAggregateGeneration: number | null;
  cursorDocumentId: string | null;
  itemCursorId: string | null;
  aggregateCursorDocumentId: string | null;
  aggregateWinnerCursorId: string | null;
  aggregateState: RatingDestructiveAggregateState | null;
  processedCount: number;
  phaseProcessedCount: number;
  failureCode: RatingDestructiveFailureCode | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  fingerprint: string;
}>;

export type RatingDestructiveItemKind =
  | "movedDish"
  | "dishDeletion"
  | "milestoneUser";

export type RatingDestructiveItemSubphase =
  | "pending"
  | "rebuild_aggregate"
  | "fold_aggregate"
  | "claimed_or_attached"
  | "process_reviews"
  | "reverse_contribution_points"
  | "delete_dish_reports"
  | "delete_aggregate"
  | "delete_dish"
  | "reconcile_milestone_users"
  | "claim_lock"
  | "reset_count_accumulator"
  | "count_reviews"
  | "reconcile_milestones"
  | "record_terminal"
  | "release_lock"
  | "complete";

export type RatingDestructiveJobItemDocument = Readonly<{
  version: typeof ratingDestructiveItemVersion;
  itemId: string;
  jobId: string;
  operation: RatingDestructiveOperation;
  kind: RatingDestructiveItemKind;
  status: RatingDestructiveStatus;
  subphase: RatingDestructiveItemSubphase;
  restaurantId: string | null;
  dishId: string | null;
  userId: string | null;
  currentReviewId: string | null;
  cursorDocumentId: string | null;
  secondaryCursorDocumentId: string | null;
  aggregateCursorDocumentId: string | null;
  aggregateWinnerCursorId: string | null;
  aggregateState: RatingDestructiveAggregateState | null;
  pointReversalCursor: ContributionPointDishReverseCursor | null;
  milestoneResetCursor: ReviewMilestoneAccumulatorResetCursor | null;
  milestoneReviewCursor: ReviewMilestoneReviewCursor | null;
  milestoneReconcileCursor: ReviewMilestoneReconcileCursor | null;
  milestoneLockToken: string | null;
  milestoneScanId: string | null;
  validReviewCount: number | null;
  processedCount: number;
  failureCode: RatingDestructiveFailureCode | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  fingerprint: string;
}>;

export type RatingRestaurantOperationLockDocument = Readonly<{
  version: typeof ratingRestaurantOperationLockVersion;
  restaurantId: string;
  jobId: string;
  operation: "restaurantMerge" | "restaurantDelete";
  role: "source" | "target";
  state: "active_source" | "active_target" | "merged_source" |
    "deleted_source";
  active: boolean;
  permanent: boolean;
  targetRestaurantId: string | null;
  createdAt: Date;
  updatedAt: Date;
  fingerprint: string;
}>;

export type RatingDishOperationLockDocument = Readonly<{
  version: typeof ratingDishOperationLockVersion;
  dishId: string;
  jobId: string;
  operation: RatingDestructiveOperation;
  role: "source" | "target" | "child";
  state: "active_source" | "active_target" | "merged_source" |
    "deleted_source";
  active: boolean;
  permanent: boolean;
  restaurantId: string | null;
  targetDishId: string | null;
  createdAt: Date;
  updatedAt: Date;
  fingerprint: string;
}>;

export type RatingDestructiveStoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export class RatingDestructiveContractError extends Error {
  public readonly code: "invalid-request" | "invalid-state";

  public constructor(code: "invalid-request" | "invalid-state") {
    super(code === "invalid-state"
      ? "Stored rating destructive state is invalid."
      : "Rating destructive contract input is invalid.");
    this.name = "RatingDestructiveContractError";
    this.code = code;
  }
}

const jobPhases = Object.freeze({
  restaurantMerge: Object.freeze([
    "claimed", "move_dishes", "move_reviews",
    "rebuild_moved_dish_aggregates", "move_claim_requests",
    "move_dish_proposals", "move_restaurant_reports", "move_dish_reports",
    "move_review_reports", "move_review_feedback_votes",
    "resolve_duplicate_reports", "finalize_restaurants", "complete",
  ] as const),
  restaurantDelete: Object.freeze([
    "claimed", "process_dishes", "process_orphan_reviews",
    "delete_restaurant_reports", "delete_duplicate_reports",
    "reconcile_milestone_users", "finalize_restaurant", "complete",
  ] as const),
  dishMerge: Object.freeze([
    "validate", "move_reviews", "rebuild_target_aggregate",
    "fold_target_aggregate", "rebuild_source_aggregate",
    "fold_source_aggregate", "finalize_dishes", "complete",
  ] as const),
  dishDelete: Object.freeze([
    "process_reviews", "reverse_contribution_points", "delete_dish_reports",
    "delete_aggregate", "delete_dish", "reconcile_milestone_users",
    "complete",
  ] as const),
});

const itemSubphases = Object.freeze({
  movedDish: Object.freeze([
    "pending", "rebuild_aggregate", "fold_aggregate", "complete",
  ] as const),
  dishDeletion: Object.freeze([
    "claimed_or_attached", "process_reviews", "reverse_contribution_points",
    "delete_dish_reports", "delete_aggregate", "delete_dish",
    "reconcile_milestone_users", "complete",
  ] as const),
  milestoneUser: Object.freeze([
    "claim_lock", "reset_count_accumulator", "count_reviews",
    "reconcile_milestones", "record_terminal", "release_lock", "complete",
  ] as const),
});

type CursorOwnership = "null" | "nullable" | "required";
type PairedCursorOwnership = "null" | "paired";

type JobContinuationOwnership = Readonly<{
  cursorDocumentId: CursorOwnership;
  itemCursorId: CursorOwnership;
  aggregateCursorDocumentId: CursorOwnership;
  aggregateWinnerCursorId: PairedCursorOwnership;
  aggregateState: PairedCursorOwnership;
  aggregateDishRole: "source" | "target" | null;
}>;

type JobContinuationOwnershipMatrix = {
  readonly [Operation in keyof typeof jobPhases]: Readonly<{
    [Phase in (typeof jobPhases)[Operation][number]]:
      JobContinuationOwnership;
  }>;
};

const noJobContinuation = Object.freeze({
  cursorDocumentId: "null",
  itemCursorId: "null",
  aggregateCursorDocumentId: "null",
  aggregateWinnerCursorId: "null",
  aggregateState: "null",
  aggregateDishRole: null,
} as const satisfies JobContinuationOwnership);

const reviewPageJobContinuation = Object.freeze({
  ...noJobContinuation,
  cursorDocumentId: "nullable",
} as const satisfies JobContinuationOwnership);

const optionalItemJobContinuation = Object.freeze({
  ...noJobContinuation,
  itemCursorId: "nullable",
} as const satisfies JobContinuationOwnership);

const requiredItemJobContinuation = Object.freeze({
  ...noJobContinuation,
  itemCursorId: "required",
} as const satisfies JobContinuationOwnership);

function aggregateRebuildJobContinuation(): JobContinuationOwnership {
  return Object.freeze({
    ...noJobContinuation,
    aggregateCursorDocumentId: "nullable",
  });
}

function aggregateFoldJobContinuation(
  role: "source" | "target",
): JobContinuationOwnership {
  return Object.freeze({
    ...noJobContinuation,
    aggregateWinnerCursorId: "paired",
    aggregateState: "paired",
    aggregateDishRole: role,
  });
}

const jobContinuationOwnership = Object.freeze({
  restaurantMerge: Object.freeze({
    claimed: noJobContinuation,
    move_dishes: noJobContinuation,
    move_reviews: noJobContinuation,
    rebuild_moved_dish_aggregates: noJobContinuation,
    move_claim_requests: noJobContinuation,
    move_dish_proposals: noJobContinuation,
    move_restaurant_reports: noJobContinuation,
    move_dish_reports: noJobContinuation,
    move_review_reports: noJobContinuation,
    move_review_feedback_votes: noJobContinuation,
    resolve_duplicate_reports: noJobContinuation,
    finalize_restaurants: noJobContinuation,
    complete: noJobContinuation,
  }),
  restaurantDelete: Object.freeze({
    claimed: noJobContinuation,
    process_dishes: optionalItemJobContinuation,
    process_orphan_reviews: noJobContinuation,
    delete_restaurant_reports: noJobContinuation,
    delete_duplicate_reports: noJobContinuation,
    reconcile_milestone_users: noJobContinuation,
    finalize_restaurant: noJobContinuation,
    complete: noJobContinuation,
  }),
  dishMerge: Object.freeze({
    validate: noJobContinuation,
    move_reviews: reviewPageJobContinuation,
    rebuild_target_aggregate: aggregateRebuildJobContinuation(),
    fold_target_aggregate: aggregateFoldJobContinuation("target"),
    rebuild_source_aggregate: aggregateRebuildJobContinuation(),
    fold_source_aggregate: aggregateFoldJobContinuation("source"),
    finalize_dishes: noJobContinuation,
    complete: noJobContinuation,
  }),
  dishDelete: Object.freeze({
    process_reviews: requiredItemJobContinuation,
    reverse_contribution_points: requiredItemJobContinuation,
    delete_dish_reports: requiredItemJobContinuation,
    delete_aggregate: requiredItemJobContinuation,
    delete_dish: requiredItemJobContinuation,
    reconcile_milestone_users: requiredItemJobContinuation,
    complete: noJobContinuation,
  }),
} as const satisfies JobContinuationOwnershipMatrix);

type ItemContinuationOwnership = Readonly<{
  currentReviewId: CursorOwnership;
  cursorDocumentId: CursorOwnership;
  secondaryCursorDocumentId: CursorOwnership;
  aggregateCursorDocumentId: CursorOwnership;
  aggregateWinnerCursorId: PairedCursorOwnership;
  aggregateState: PairedCursorOwnership;
  pointReversalCursor: CursorOwnership;
  milestoneResetCursor: CursorOwnership;
  milestoneReviewCursor: CursorOwnership;
  milestoneReconcileCursor: CursorOwnership;
  milestoneLockToken: CursorOwnership;
  milestoneScanId: CursorOwnership;
  validReviewCount: CursorOwnership;
}>;

type ItemContinuationOwnershipMatrix = {
  readonly [Kind in keyof typeof itemSubphases]: Readonly<{
    [Subphase in (typeof itemSubphases)[Kind][number]]:
      ItemContinuationOwnership;
  }>;
};

const noItemContinuation = Object.freeze({
  currentReviewId: "null",
  cursorDocumentId: "null",
  secondaryCursorDocumentId: "null",
  aggregateCursorDocumentId: "null",
  aggregateWinnerCursorId: "null",
  aggregateState: "null",
  pointReversalCursor: "null",
  milestoneResetCursor: "null",
  milestoneReviewCursor: "null",
  milestoneReconcileCursor: "null",
  milestoneLockToken: "null",
  milestoneScanId: "null",
  validReviewCount: "null",
} as const satisfies ItemContinuationOwnership);

const movedDishRebuildContinuation = Object.freeze({
  ...noItemContinuation,
  aggregateCursorDocumentId: "nullable",
} as const satisfies ItemContinuationOwnership);

const movedDishFoldContinuation = Object.freeze({
  ...noItemContinuation,
  aggregateWinnerCursorId: "paired",
  aggregateState: "paired",
} as const satisfies ItemContinuationOwnership);

const dishReversalContinuation = Object.freeze({
  ...noItemContinuation,
  pointReversalCursor: "nullable",
} as const satisfies ItemContinuationOwnership);

function milestoneContinuation(
  cursor: "none" | "reset" | "review" | "reconcile",
  validReviewCount: "null" | "required",
): ItemContinuationOwnership {
  return Object.freeze({
    ...noItemContinuation,
    milestoneResetCursor: cursor === "reset" ? "nullable" : "null",
    milestoneReviewCursor: cursor === "review" ? "nullable" : "null",
    milestoneReconcileCursor:
      cursor === "reconcile" ? "nullable" : "null",
    milestoneLockToken: "required",
    milestoneScanId: "required",
    validReviewCount,
  });
}

const milestoneBoundContinuation = milestoneContinuation("none", "null");
const milestoneResetContinuation = milestoneContinuation("reset", "null");
const milestoneReviewContinuation = milestoneContinuation("review", "null");
const milestoneReconcileContinuation =
  milestoneContinuation("reconcile", "required");
const milestoneCountContinuation = milestoneContinuation("none", "required");

const itemContinuationOwnership = Object.freeze({
  movedDish: Object.freeze({
    pending: noItemContinuation,
    rebuild_aggregate: movedDishRebuildContinuation,
    fold_aggregate: movedDishFoldContinuation,
    complete: noItemContinuation,
  }),
  dishDeletion: Object.freeze({
    claimed_or_attached: noItemContinuation,
    process_reviews: noItemContinuation,
    reverse_contribution_points: dishReversalContinuation,
    delete_dish_reports: noItemContinuation,
    delete_aggregate: noItemContinuation,
    delete_dish: noItemContinuation,
    reconcile_milestone_users: noItemContinuation,
    complete: noItemContinuation,
  }),
  milestoneUser: Object.freeze({
    claim_lock: milestoneBoundContinuation,
    reset_count_accumulator: milestoneResetContinuation,
    count_reviews: milestoneReviewContinuation,
    reconcile_milestones: milestoneReconcileContinuation,
    record_terminal: milestoneCountContinuation,
    release_lock: milestoneCountContinuation,
    complete: noItemContinuation,
  }),
} as const satisfies ItemContinuationOwnershipMatrix);

const failureCodes = Object.freeze([
  "temporary_dependency", "operation_conflict", "preexisting_job_active",
  "malformed_private_state", "entity_state_incompatible", "lock_missing",
  "revision_exhausted", "generation_exhausted",
  "unsupported_partial_state",
] as const);

const jobCoreKeys = Object.freeze([
  "jobId", "requestId", "operation", "authorizedCallerKind",
  "callerBindingFingerprint", "status", "phase",
  "sourceRestaurantId", "targetRestaurantId", "sourceDishId", "targetDishId",
  "restaurantId", "expectedSourceRestaurantRevision",
  "sourceActiveRestaurantRevision", "sourceCompletionRestaurantRevision",
  "expectedTargetRestaurantRevision", "targetActiveRestaurantRevision",
  "targetCompletionRestaurantRevision", "expectedSourceAggregateGeneration",
  "sourceActiveAggregateGeneration", "sourceCompletionAggregateGeneration",
  "expectedTargetAggregateGeneration", "targetActiveAggregateGeneration",
  "targetCompletionAggregateGeneration", "cursorDocumentId", "itemCursorId",
  "aggregateCursorDocumentId", "aggregateWinnerCursorId", "aggregateState",
  "processedCount", "phaseProcessedCount", "failureCode", "createdAt",
  "updatedAt", "completedAt",
] as const);

const itemCoreKeys = Object.freeze([
  "itemId", "jobId", "operation", "kind", "status", "subphase",
  "restaurantId", "dishId", "userId", "currentReviewId",
  "cursorDocumentId", "secondaryCursorDocumentId",
  "aggregateCursorDocumentId", "aggregateWinnerCursorId", "aggregateState",
  "pointReversalCursor", "milestoneResetCursor", "milestoneReviewCursor",
  "milestoneReconcileCursor", "milestoneLockToken", "milestoneScanId",
  "validReviewCount", "processedCount", "failureCode", "createdAt",
  "updatedAt", "completedAt",
] as const);

const restaurantLockCoreKeys = Object.freeze([
  "restaurantId", "jobId", "operation", "role", "state", "active",
  "permanent", "targetRestaurantId", "createdAt", "updatedAt",
] as const);

const dishLockCoreKeys = Object.freeze([
  "dishId", "jobId", "operation", "role", "state", "active", "permanent",
  "restaurantId", "targetDishId", "createdAt", "updatedAt",
] as const);

function fail(code: "invalid-request" | "invalid-state"): never {
  throw new RatingDestructiveContractError(code);
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

function exactDocumentId(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    return fail(code);
  }
  return value;
}

function nullableDocumentId(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string | null {
  return value === null ? null : exactDocumentId(value, code);
}

function nonnegativeInteger(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(code);
  }
  return value;
}

function nullableNonnegativeInteger(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number | null {
  return value === null ? null : nonnegativeInteger(value, code);
}

function timestamp(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): Date {
  let result: unknown = value;
  if (!(result instanceof Date)) {
    const timestampLike = record(result);
    if (timestampLike === null || typeof timestampLike.toDate !== "function") {
      return fail(code);
    }
    try {
      result = (timestampLike.toDate as () => unknown)();
    } catch {
      return fail(code);
    }
  }
  if (!(result instanceof Date) || !Number.isFinite(result.getTime())) {
    return fail(code);
  }
  return new Date(result.getTime());
}

function nullableTimestamp(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): Date | null {
  return value === null ? null : timestamp(value, code);
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return {"$date": value.toISOString()};
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const data = record(value);
  if (data !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(data).sort()) {
      result[key] = canonicalize(data[key]);
    }
    return result;
  }
  return value;
}

function fingerprint(version: string, core: unknown): string {
  return sha256({version, core});
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function callerKind(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): RatingDestructiveAuthorizedCallerKind {
  if (value !== "admin" && value !== "owner") {
    return fail(code);
  }
  return value;
}

function exactCallerUid(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 128
  ) {
    return fail(code);
  }
  return value;
}

/** Nonreversible, domain-separated binding for private caller authorization. */
export function createRatingDestructiveCallerBindingFingerprint(
  uid: string,
): string {
  return sha256({
    domain: ratingDestructiveCallerBindingDomain,
    uid: exactCallerUid(uid, "invalid-request"),
  });
}

function operation(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): RatingDestructiveOperation {
  if (
    value !== "restaurantMerge" && value !== "restaurantDelete" &&
    value !== "dishMerge" && value !== "dishDelete"
  ) {
    return fail(code);
  }
  return value;
}

function status(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): RatingDestructiveStatus {
  if (
    value !== "active" && value !== "retryable" &&
    value !== "manual_review_required" && value !== "complete"
  ) {
    return fail(code);
  }
  return value;
}

function failureCode(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): RatingDestructiveFailureCode | null {
  if (value === null) {
    return null;
  }
  if (!failureCodes.includes(value as RatingDestructiveFailureCode)) {
    return fail(code);
  }
  return value as RatingDestructiveFailureCode;
}

function assertStatusConsistency(
  value: Readonly<{
    status: RatingDestructiveStatus;
    terminalPhase: boolean;
    failureCode: RatingDestructiveFailureCode | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }>,
  code: "invalid-request" | "invalid-state",
): void {
  if (
    (value.status === "complete") !== value.terminalPhase ||
    (value.status === "complete") !== (value.completedAt !== null) ||
    ((value.status === "active" || value.status === "complete") &&
      value.failureCode !== null) ||
    ((value.status === "retryable" ||
      value.status === "manual_review_required") &&
      value.failureCode === null) ||
    value.updatedAt.getTime() < value.createdAt.getTime() ||
    (value.completedAt !== null &&
      value.completedAt.getTime() < value.updatedAt.getTime())
  ) {
    fail(code);
  }
}

function nullableRevisionTriplet(
  expected: number | null,
  active: number | null,
  completion: number | null,
  completionRequired: boolean,
  code: "invalid-request" | "invalid-state",
): boolean {
  if (expected === null || active === null) {
    return false;
  }
  if (expected === Number.MAX_SAFE_INTEGER || active !== expected + 1) {
    fail(code);
  }
  if (completionRequired) {
    if (active === Number.MAX_SAFE_INTEGER || completion !== active + 1) {
      fail(code);
    }
  } else if (completion !== null) {
    fail(code);
  }
  return true;
}

function allNull(values: readonly unknown[]): boolean {
  return values.every((value) => value === null);
}

function assertCursorOwnership(
  value: unknown,
  ownership: CursorOwnership,
  code: "invalid-request" | "invalid-state",
): void {
  if (
    (ownership === "null" && value !== null) ||
    (ownership === "required" && value === null)
  ) {
    fail(code);
  }
}

function jobContinuationFor(
  value: JobCore,
  code: "invalid-request" | "invalid-state",
): JobContinuationOwnership {
  const byPhase = jobContinuationOwnership[value.operation] as
    Readonly<Record<string, JobContinuationOwnership>>;
  const ownership = byPhase[value.phase];
  return ownership ?? fail(code);
}

function assertJobContinuationOwnership(
  value: JobCore,
  code: "invalid-request" | "invalid-state",
): void {
  const ownership = jobContinuationFor(value, code);
  assertCursorOwnership(
    value.cursorDocumentId,
    ownership.cursorDocumentId,
    code,
  );
  assertCursorOwnership(value.itemCursorId, ownership.itemCursorId, code);
  assertCursorOwnership(
    value.aggregateCursorDocumentId,
    ownership.aggregateCursorDocumentId,
    code,
  );
  const aggregatePairPresent = value.aggregateWinnerCursorId !== null &&
    value.aggregateState !== null;
  if (
    ownership.aggregateWinnerCursorId === "null" ||
    ownership.aggregateState === "null"
  ) {
    if (
      value.aggregateWinnerCursorId !== null ||
      value.aggregateState !== null
    ) {
      fail(code);
    }
  } else if (
    (value.aggregateWinnerCursorId === null) !==
      (value.aggregateState === null)
  ) {
    fail(code);
  }
  if (aggregatePairPresent) {
    const expectedDishId = ownership.aggregateDishRole === "source"
      ? value.sourceDishId
      : ownership.aggregateDishRole === "target"
        ? value.targetDishId
        : null;
    if (
      expectedDishId === null ||
      value.aggregateState?.dishId !== expectedDishId
    ) {
      fail(code);
    }
  }
}

function itemContinuationFor(
  value: ItemCore,
  code: "invalid-request" | "invalid-state",
): ItemContinuationOwnership {
  const bySubphase = itemContinuationOwnership[value.kind] as
    Readonly<Record<string, ItemContinuationOwnership>>;
  const ownership = bySubphase[value.subphase];
  return ownership ?? fail(code);
}

function assertItemContinuationOwnership(
  value: ItemCore,
  code: "invalid-request" | "invalid-state",
): void {
  const ownership = itemContinuationFor(value, code);
  assertCursorOwnership(value.currentReviewId, ownership.currentReviewId, code);
  assertCursorOwnership(
    value.cursorDocumentId,
    ownership.cursorDocumentId,
    code,
  );
  assertCursorOwnership(
    value.secondaryCursorDocumentId,
    ownership.secondaryCursorDocumentId,
    code,
  );
  assertCursorOwnership(
    value.aggregateCursorDocumentId,
    ownership.aggregateCursorDocumentId,
    code,
  );
  if (
    ownership.aggregateWinnerCursorId === "null" ||
    ownership.aggregateState === "null"
  ) {
    if (
      value.aggregateWinnerCursorId !== null ||
      value.aggregateState !== null
    ) {
      fail(code);
    }
  } else if (
    (value.aggregateWinnerCursorId === null) !==
      (value.aggregateState === null)
  ) {
    fail(code);
  }
  if (
    value.aggregateState !== null &&
    (value.kind !== "movedDish" || value.aggregateState.dishId !== value.dishId)
  ) {
    fail(code);
  }
  assertCursorOwnership(
    value.pointReversalCursor,
    ownership.pointReversalCursor,
    code,
  );
  assertCursorOwnership(
    value.milestoneResetCursor,
    ownership.milestoneResetCursor,
    code,
  );
  assertCursorOwnership(
    value.milestoneReviewCursor,
    ownership.milestoneReviewCursor,
    code,
  );
  assertCursorOwnership(
    value.milestoneReconcileCursor,
    ownership.milestoneReconcileCursor,
    code,
  );
  assertCursorOwnership(
    value.milestoneLockToken,
    ownership.milestoneLockToken,
    code,
  );
  assertCursorOwnership(
    value.milestoneScanId,
    ownership.milestoneScanId,
    code,
  );
  assertCursorOwnership(
    value.validReviewCount,
    ownership.validReviewCount,
    code,
  );
}

function finiteNonnegativeNumber(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fail(code);
  }
  return value;
}

function aggregateState(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): RatingDestructiveAggregateState | null {
  if (value === null) {
    return null;
  }
  const data = record(value);
  const keys = [
    "accumulatorVersion", "dishId", "committedRatingCount",
    "overallBiteScoreSum", "overallImpressionSum", "tastinessScoreSum",
    "tastinessScoreCount", "qualityScoreSum", "qualityScoreCount",
    "valueScoreSum", "valueScoreCount",
  ] as const;
  if (
    data === null || !hasExactKeys(data, keys) ||
    data.accumulatorVersion !==
      "bitestar.dish-review-aggregate-accumulator.v1"
  ) {
    return fail(code);
  }
  return Object.freeze({
    accumulatorVersion: "bitestar.dish-review-aggregate-accumulator.v1",
    dishId: exactDocumentId(data.dishId, code),
    committedRatingCount: nonnegativeInteger(data.committedRatingCount, code),
    overallBiteScoreSum: finiteNonnegativeNumber(
      data.overallBiteScoreSum,
      code,
    ),
    overallImpressionSum: finiteNonnegativeNumber(
      data.overallImpressionSum,
      code,
    ),
    tastinessScoreSum: finiteNonnegativeNumber(data.tastinessScoreSum, code),
    tastinessScoreCount: nonnegativeInteger(data.tastinessScoreCount, code),
    qualityScoreSum: finiteNonnegativeNumber(data.qualityScoreSum, code),
    qualityScoreCount: nonnegativeInteger(data.qualityScoreCount, code),
    valueScoreSum: finiteNonnegativeNumber(data.valueScoreSum, code),
    valueScoreCount: nonnegativeInteger(data.valueScoreCount, code),
  });
}

export function createRatingDestructiveJobId(value: Readonly<{
  requestId: string;
  operation: RatingDestructiveOperation;
  sourceRestaurantId: string | null;
  targetRestaurantId: string | null;
  sourceDishId: string | null;
  targetDishId: string | null;
  restaurantId: string | null;
}>): string {
  const code = "invalid-request" as const;
  const identity = {
    requestId: exactDocumentId(value.requestId, code),
    operation: operation(value.operation, code),
    sourceRestaurantId: nullableDocumentId(value.sourceRestaurantId, code),
    targetRestaurantId: nullableDocumentId(value.targetRestaurantId, code),
    sourceDishId: nullableDocumentId(value.sourceDishId, code),
    targetDishId: nullableDocumentId(value.targetDishId, code),
    restaurantId: nullableDocumentId(value.restaurantId, code),
  };
  assertOperationIdentity(identity, code);
  return sha256({version: ratingDestructiveJobVersion, identity});
}

export function createRatingDestructiveJobItemId(value: Readonly<{
  jobId: string;
  operation: RatingDestructiveOperation;
  kind: RatingDestructiveItemKind;
  restaurantId: string | null;
  dishId: string | null;
  userId: string | null;
}>): string {
  const code = "invalid-request" as const;
  const identity = {
    jobId: exactDocumentId(value.jobId, code),
    operation: operation(value.operation, code),
    kind: itemKind(value.kind, code),
    restaurantId: nullableDocumentId(value.restaurantId, code),
    dishId: nullableDocumentId(value.dishId, code),
    userId: nullableDocumentId(value.userId, code),
  };
  assertItemIdentity(identity, code);
  return sha256({version: ratingDestructiveItemVersion, identity});
}

export function createRatingRestaurantOperationLockId(
  restaurantId: string,
): string {
  return exactDocumentId(restaurantId, "invalid-request");
}

export function createRatingDishOperationLockId(dishId: string): string {
  return exactDocumentId(dishId, "invalid-request");
}

export function ratingDestructiveJobPath(jobId: string): string {
  return `${ratingDestructiveJobCollection}/${exactDocumentId(
    jobId,
    "invalid-request",
  )}`;
}

export function ratingDestructiveJobItemPath(itemId: string): string {
  return `${ratingDestructiveJobItemCollection}/${exactDocumentId(
    itemId,
    "invalid-request",
  )}`;
}

export function ratingRestaurantOperationLockPath(
  restaurantId: string,
): string {
  return `${ratingRestaurantOperationLockCollection}/${
    createRatingRestaurantOperationLockId(restaurantId)}`;
}

export function ratingDishOperationLockPath(dishId: string): string {
  return `${ratingDishOperationLockCollection}/${
    createRatingDishOperationLockId(dishId)}`;
}

type JobCore = Omit<
  RatingDestructiveJobDocument,
  "version" | "fingerprint"
>;

function assertOperationIdentity(
  value: Readonly<{
    operation: RatingDestructiveOperation;
    sourceRestaurantId: string | null;
    targetRestaurantId: string | null;
    sourceDishId: string | null;
    targetDishId: string | null;
    restaurantId: string | null;
  }>,
  code: "invalid-request" | "invalid-state",
): void {
  const valid = value.operation === "restaurantMerge"
    ? value.sourceRestaurantId !== null &&
      value.targetRestaurantId !== null &&
      value.sourceRestaurantId !== value.targetRestaurantId &&
      allNull([value.sourceDishId, value.targetDishId, value.restaurantId])
    : value.operation === "restaurantDelete"
      ? value.sourceRestaurantId !== null &&
        allNull([
          value.targetRestaurantId, value.sourceDishId, value.targetDishId,
          value.restaurantId,
        ])
      : value.operation === "dishMerge"
        ? value.sourceDishId !== null && value.targetDishId !== null &&
          value.sourceDishId !== value.targetDishId &&
          value.restaurantId !== null &&
          allNull([value.sourceRestaurantId, value.targetRestaurantId])
        : value.sourceDishId !== null && value.targetDishId === null &&
          allNull([
            value.sourceRestaurantId,
            value.targetRestaurantId,
            value.restaurantId,
          ]);
  if (!valid) {
    fail(code);
  }
}

function readJobCore(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): JobCore {
  const data = record(value);
  if (data === null || !hasExactKeys(data, jobCoreKeys)) {
    return fail(code);
  }
  const parsedOperation = operation(data.operation, code);
  const phases = jobPhases[parsedOperation];
  if (!phases.includes(data.phase as never)) {
    return fail(code);
  }
  const parsedStatus = status(data.status, code);
  const createdAt = timestamp(data.createdAt, code);
  const updatedAt = timestamp(data.updatedAt, code);
  const completedAt = nullableTimestamp(data.completedAt, code);
  const parsedFailureCode = failureCode(data.failureCode, code);
  const parsed: JobCore = {
    jobId: exactDocumentId(data.jobId, code),
    requestId: exactDocumentId(data.requestId, code),
    operation: parsedOperation,
    authorizedCallerKind: callerKind(data.authorizedCallerKind, code),
    callerBindingFingerprint: isFingerprint(data.callerBindingFingerprint)
      ? data.callerBindingFingerprint
      : fail(code),
    status: parsedStatus,
    phase: data.phase as RatingDestructiveJobPhase,
    sourceRestaurantId: nullableDocumentId(data.sourceRestaurantId, code),
    targetRestaurantId: nullableDocumentId(data.targetRestaurantId, code),
    sourceDishId: nullableDocumentId(data.sourceDishId, code),
    targetDishId: nullableDocumentId(data.targetDishId, code),
    restaurantId: nullableDocumentId(data.restaurantId, code),
    expectedSourceRestaurantRevision: nullableNonnegativeInteger(
      data.expectedSourceRestaurantRevision,
      code,
    ),
    sourceActiveRestaurantRevision: nullableNonnegativeInteger(
      data.sourceActiveRestaurantRevision,
      code,
    ),
    sourceCompletionRestaurantRevision: nullableNonnegativeInteger(
      data.sourceCompletionRestaurantRevision,
      code,
    ),
    expectedTargetRestaurantRevision: nullableNonnegativeInteger(
      data.expectedTargetRestaurantRevision,
      code,
    ),
    targetActiveRestaurantRevision: nullableNonnegativeInteger(
      data.targetActiveRestaurantRevision,
      code,
    ),
    targetCompletionRestaurantRevision: nullableNonnegativeInteger(
      data.targetCompletionRestaurantRevision,
      code,
    ),
    expectedSourceAggregateGeneration: nullableNonnegativeInteger(
      data.expectedSourceAggregateGeneration,
      code,
    ),
    sourceActiveAggregateGeneration: nullableNonnegativeInteger(
      data.sourceActiveAggregateGeneration,
      code,
    ),
    sourceCompletionAggregateGeneration: nullableNonnegativeInteger(
      data.sourceCompletionAggregateGeneration,
      code,
    ),
    expectedTargetAggregateGeneration: nullableNonnegativeInteger(
      data.expectedTargetAggregateGeneration,
      code,
    ),
    targetActiveAggregateGeneration: nullableNonnegativeInteger(
      data.targetActiveAggregateGeneration,
      code,
    ),
    targetCompletionAggregateGeneration: nullableNonnegativeInteger(
      data.targetCompletionAggregateGeneration,
      code,
    ),
    cursorDocumentId: nullableDocumentId(data.cursorDocumentId, code),
    itemCursorId: nullableDocumentId(data.itemCursorId, code),
    aggregateCursorDocumentId: nullableDocumentId(
      data.aggregateCursorDocumentId,
      code,
    ),
    aggregateWinnerCursorId: nullableDocumentId(
      data.aggregateWinnerCursorId,
      code,
    ),
    aggregateState: aggregateState(data.aggregateState, code),
    processedCount: nonnegativeInteger(data.processedCount, code),
    phaseProcessedCount: nonnegativeInteger(data.phaseProcessedCount, code),
    failureCode: parsedFailureCode,
    createdAt,
    updatedAt,
    completedAt,
  };
  validateJobCore(parsed, code);
  return Object.freeze(parsed);
}

function validateJobCore(
  value: JobCore,
  code: "invalid-request" | "invalid-state",
): void {
  assertOperationIdentity(value, code);
  if (
    value.authorizedCallerKind === "owner" &&
    value.operation !== "dishMerge"
  ) {
    fail(code);
  }
  const expectedJobId = createRatingDestructiveJobId({
    requestId: value.requestId,
    operation: value.operation,
    sourceRestaurantId: value.sourceRestaurantId,
    targetRestaurantId: value.targetRestaurantId,
    sourceDishId: value.sourceDishId,
    targetDishId: value.targetDishId,
    restaurantId: value.restaurantId,
  });
  if (value.jobId !== expectedJobId) {
    fail(code);
  }

  const restaurantRevisions = [
    value.expectedSourceRestaurantRevision,
    value.sourceActiveRestaurantRevision,
    value.sourceCompletionRestaurantRevision,
    value.expectedTargetRestaurantRevision,
    value.targetActiveRestaurantRevision,
    value.targetCompletionRestaurantRevision,
  ];
  const aggregateGenerations = [
    value.expectedSourceAggregateGeneration,
    value.sourceActiveAggregateGeneration,
    value.sourceCompletionAggregateGeneration,
    value.expectedTargetAggregateGeneration,
    value.targetActiveAggregateGeneration,
    value.targetCompletionAggregateGeneration,
  ];
  if (value.operation === "restaurantMerge") {
    if (
      !nullableRevisionTriplet(
        value.expectedSourceRestaurantRevision,
        value.sourceActiveRestaurantRevision,
        value.sourceCompletionRestaurantRevision,
        true,
        code,
      ) ||
      !nullableRevisionTriplet(
        value.expectedTargetRestaurantRevision,
        value.targetActiveRestaurantRevision,
        value.targetCompletionRestaurantRevision,
        true,
        code,
      ) ||
      !allNull(aggregateGenerations)
    ) {
      fail(code);
    }
  } else if (value.operation === "restaurantDelete") {
    if (
      !nullableRevisionTriplet(
        value.expectedSourceRestaurantRevision,
        value.sourceActiveRestaurantRevision,
        value.sourceCompletionRestaurantRevision,
        false,
        code,
      ) ||
      !allNull(restaurantRevisions.slice(3)) ||
      !allNull(aggregateGenerations)
    ) {
      fail(code);
    }
  } else if (value.operation === "dishMerge") {
    if (
      !allNull(restaurantRevisions) ||
      !nullableRevisionTriplet(
        value.expectedSourceAggregateGeneration,
        value.sourceActiveAggregateGeneration,
        value.sourceCompletionAggregateGeneration,
        true,
        code,
      ) ||
      !nullableRevisionTriplet(
        value.expectedTargetAggregateGeneration,
        value.targetActiveAggregateGeneration,
        value.targetCompletionAggregateGeneration,
        true,
        code,
      )
    ) {
      fail(code);
    }
  } else if (!allNull([...restaurantRevisions, ...aggregateGenerations])) {
    fail(code);
  }
  assertJobContinuationOwnership(value, code);
  assertStatusConsistency({
    status: value.status,
    terminalPhase: value.phase === "complete",
    failureCode: value.failureCode,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
  }, code);
  if (value.phase === "complete" && value.phaseProcessedCount !== 0) {
    fail(code);
  }
  if (
    value.status === "complete" &&
    !allNull([
      value.cursorDocumentId, value.itemCursorId,
      value.aggregateCursorDocumentId, value.aggregateWinnerCursorId,
      value.aggregateState,
    ])
  ) {
    fail(code);
  }
}

export function buildRatingDestructiveJobDocument(
  value: JobCore,
): RatingDestructiveJobDocument {
  const core = readJobCore(value, "invalid-request");
  return Object.freeze({
    version: ratingDestructiveJobVersion,
    ...core,
    fingerprint: fingerprint(ratingDestructiveJobVersion, core),
  });
}

export function parseRatingDestructiveJobDocument(
  document: RatingDestructiveStoredDocument | null,
): RatingDestructiveJobDocument | null {
  if (document === null) {
    return null;
  }
  try {
    const data = record(document.data);
    if (
      data === null ||
      !hasExactKeys(data, ["version", ...jobCoreKeys, "fingerprint"]) ||
      data.version !== ratingDestructiveJobVersion ||
      !isFingerprint(data.fingerprint)
    ) {
      return fail("invalid-state");
    }
    const coreData = {...data};
    delete coreData.version;
    delete coreData.fingerprint;
    const core = readJobCore(coreData, "invalid-state");
    if (
      exactDocumentId(document.id, "invalid-state") !== core.jobId ||
      data.fingerprint !== fingerprint(ratingDestructiveJobVersion, core)
    ) {
      return fail("invalid-state");
    }
    return Object.freeze({
      version: ratingDestructiveJobVersion,
      ...core,
      fingerprint: data.fingerprint,
    });
  } catch {
    return fail("invalid-state");
  }
}

type ItemCore = Omit<
  RatingDestructiveJobItemDocument,
  "version" | "fingerprint"
>;

function itemKind(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): RatingDestructiveItemKind {
  if (
    value !== "movedDish" && value !== "dishDeletion" &&
    value !== "milestoneUser"
  ) {
    return fail(code);
  }
  return value;
}

function assertItemIdentity(
  value: Readonly<{
    operation: RatingDestructiveOperation;
    kind: RatingDestructiveItemKind;
    restaurantId: string | null;
    dishId: string | null;
    userId: string | null;
  }>,
  code: "invalid-request" | "invalid-state",
): void {
  const valid = value.kind === "movedDish"
    ? value.operation === "restaurantMerge" && value.restaurantId !== null &&
      value.dishId !== null && value.userId === null
    : value.kind === "dishDeletion"
      ? (value.operation === "restaurantDelete" ||
        value.operation === "dishDelete") &&
        value.dishId !== null && value.userId === null &&
        (value.operation === "dishDelete" || value.restaurantId !== null)
      : (value.operation === "restaurantDelete" ||
        value.operation === "dishDelete") &&
        value.restaurantId === null && value.dishId === null &&
        value.userId !== null;
  if (!valid) {
    fail(code);
  }
}

function contractSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function requireFingerprint(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (!isFingerprint(value)) {
    return fail(code);
  }
  return value;
}

function contributionPointCursor(
  value: unknown,
  dishId: string,
  code: "invalid-request" | "invalid-state",
): ContributionPointDishReverseCursor | null {
  if (value === null) {
    return null;
  }
  const data = record(value);
  if (
    data === null || !hasExactKeys(data, [
      "version", "phase", "operationFingerprint", "dishFingerprint",
      "afterLedgerDocumentId", "fingerprint",
    ]) ||
    data.version !== "bitestar.contribution-dish-reverse-cursor.v2" ||
    data.phase !== "dish-ledger"
  ) {
    return fail(code);
  }
  const operationFingerprint = requireFingerprint(
    data.operationFingerprint,
    code,
  );
  const dishFingerprint = requireFingerprint(data.dishFingerprint, code);
  const afterLedgerDocumentId = exactDocumentId(
    data.afterLedgerDocumentId,
    code,
  );
  const expectedDishFingerprint = contractSha256([
    "bitestar.contribution-dish-reverse-cursor.v2",
    ["dishId", dishId],
  ]);
  const expectedFingerprint = contractSha256([
    "bitestar.contribution-dish-reverse-cursor.v2",
    ["phase", "dish-ledger"],
    ["operationFingerprint", operationFingerprint],
    ["dishFingerprint", dishFingerprint],
    ["afterLedgerDocumentId", afterLedgerDocumentId],
  ]);
  if (
    dishFingerprint !== expectedDishFingerprint ||
    data.fingerprint !== expectedFingerprint
  ) {
    return fail(code);
  }
  return Object.freeze({
    version: "bitestar.contribution-dish-reverse-cursor.v2",
    phase: "dish-ledger",
    operationFingerprint,
    dishFingerprint,
    afterLedgerDocumentId,
    fingerprint: expectedFingerprint,
  });
}

type MilestoneBinding = Readonly<{
  itemId: string;
  jobId: string;
  userId: string;
  lockToken: string | null;
  scanId: string | null;
}>;

function expectedMilestoneBinding(
  binding: MilestoneBinding,
  code: "invalid-request" | "invalid-state",
): Readonly<{
  userFingerprint: string;
  operationFingerprint: string;
  lockFingerprint: string;
  scanFingerprint: string;
}> {
  if (binding.lockToken === null || binding.scanId === null) {
    return fail(code);
  }
  const userFingerprint = contractSha256([
    "bitestar.review-milestone-accumulator.v2",
    ["userId", binding.userId],
  ]);
  const operationFingerprint = contractSha256([
    "bitestar.review-milestone-operation.v1",
    ["operationId", binding.jobId],
  ]);
  const lockFingerprint = contractSha256([
    "bitestar.review-milestone-lock-binding.v1",
    ["userId", binding.userId],
    ["operationId", binding.jobId],
    ["lockToken", binding.lockToken],
  ]);
  const scanFingerprint = contractSha256([
    "bitestar.review-milestone-accumulator.v2",
    ["namespaceId", binding.itemId],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["scanId", binding.scanId],
  ]);
  return {userFingerprint, operationFingerprint, lockFingerprint,
    scanFingerprint};
}

function milestoneResetCursor(
  value: unknown,
  binding: MilestoneBinding,
  code: "invalid-request" | "invalid-state",
): ReviewMilestoneAccumulatorResetCursor | null {
  if (value === null) {
    return null;
  }
  const data = record(value);
  if (
    data === null || !hasExactKeys(data, [
      "version", "phase", "userFingerprint", "operationFingerprint",
      "lockFingerprint", "scanFingerprint", "afterWinnerDocumentId",
      "fingerprint",
    ]) ||
    data.version !==
      "bitestar.review-milestone-accumulator-reset-cursor.v2" ||
    data.phase !== "accumulator-reset"
  ) {
    return fail(code);
  }
  const expected = expectedMilestoneBinding(binding, code);
  const userFingerprint = requireFingerprint(data.userFingerprint, code);
  const operationFingerprint = requireFingerprint(
    data.operationFingerprint,
    code,
  );
  const lockFingerprint = requireFingerprint(data.lockFingerprint, code);
  const scanFingerprint = requireFingerprint(data.scanFingerprint, code);
  const afterWinnerDocumentId = exactDocumentId(
    data.afterWinnerDocumentId,
    code,
  );
  const expectedFingerprint = contractSha256([
    "bitestar.review-milestone-accumulator-reset-cursor.v2",
    ["phase", "accumulator-reset"],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["scanFingerprint", scanFingerprint],
    ["afterWinnerDocumentId", afterWinnerDocumentId],
  ]);
  if (
    userFingerprint !== expected.userFingerprint ||
    operationFingerprint !== expected.operationFingerprint ||
    lockFingerprint !== expected.lockFingerprint ||
    scanFingerprint !== expected.scanFingerprint ||
    data.fingerprint !== expectedFingerprint
  ) {
    return fail(code);
  }
  return Object.freeze({
    version: "bitestar.review-milestone-accumulator-reset-cursor.v2",
    phase: "accumulator-reset",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    scanFingerprint,
    afterWinnerDocumentId,
    fingerprint: expectedFingerprint,
  });
}

function milestoneReviewCursor(
  value: unknown,
  binding: MilestoneBinding,
  code: "invalid-request" | "invalid-state",
): ReviewMilestoneReviewCursor | null {
  if (value === null) {
    return null;
  }
  const data = record(value);
  if (
    data === null || !hasExactKeys(data, [
      "version", "phase", "userFingerprint", "operationFingerprint",
      "lockFingerprint", "scanFingerprint", "sequence",
      "afterReviewDocumentId", "fingerprint",
    ]) || data.version !== "bitestar.review-milestone-review-cursor.v3" ||
    data.phase !== "review-scan"
  ) {
    return fail(code);
  }
  const expected = expectedMilestoneBinding(binding, code);
  const userFingerprint = requireFingerprint(data.userFingerprint, code);
  const operationFingerprint = requireFingerprint(
    data.operationFingerprint,
    code,
  );
  const lockFingerprint = requireFingerprint(data.lockFingerprint, code);
  const scanFingerprint = requireFingerprint(data.scanFingerprint, code);
  const sequence = nonnegativeInteger(data.sequence, code);
  const afterReviewDocumentId = exactDocumentId(
    data.afterReviewDocumentId,
    code,
  );
  const expectedFingerprint = contractSha256([
    "bitestar.review-milestone-review-cursor.v3",
    ["phase", "review-scan"],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["scanFingerprint", scanFingerprint],
    ["sequence", sequence],
    ["afterReviewDocumentId", afterReviewDocumentId],
  ]);
  if (
    sequence < 1 || userFingerprint !== expected.userFingerprint ||
    operationFingerprint !== expected.operationFingerprint ||
    lockFingerprint !== expected.lockFingerprint ||
    scanFingerprint !== expected.scanFingerprint ||
    data.fingerprint !== expectedFingerprint
  ) {
    return fail(code);
  }
  return Object.freeze({
    version: "bitestar.review-milestone-review-cursor.v3",
    phase: "review-scan",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    scanFingerprint,
    sequence,
    afterReviewDocumentId,
    fingerprint: expectedFingerprint,
  });
}

function milestoneReconcileCursor(
  value: unknown,
  binding: MilestoneBinding,
  code: "invalid-request" | "invalid-state",
): ReviewMilestoneReconcileCursor | null {
  if (value === null) {
    return null;
  }
  const data = record(value);
  if (data === null) {
    return fail(code);
  }
  const expected = expectedMilestoneBinding(binding, code);
  const commonKeys = [
    "version", "phase", "userFingerprint", "operationFingerprint",
    "lockFingerprint", "countStateFingerprint", "fingerprint",
  ];
  const phase = data.phase;
  if (
    data.version !== "bitestar.review-milestone-reconcile-cursor.v2" ||
    (phase !== "awards" && phase !== "ledger") ||
    !hasExactKeys(data, phase === "awards"
      ? [...commonKeys, "afterMilestone"]
      : [...commonKeys, "afterLedgerDocumentId"])
  ) {
    return fail(code);
  }
  const userFingerprint = requireFingerprint(data.userFingerprint, code);
  const operationFingerprint = requireFingerprint(
    data.operationFingerprint,
    code,
  );
  const lockFingerprint = requireFingerprint(data.lockFingerprint, code);
  const countStateFingerprint = requireFingerprint(
    data.countStateFingerprint,
    code,
  );
  if (
    userFingerprint !== expected.userFingerprint ||
    operationFingerprint !== expected.operationFingerprint ||
    lockFingerprint !== expected.lockFingerprint
  ) {
    return fail(code);
  }
  if (phase === "awards") {
    const afterMilestone = nonnegativeInteger(data.afterMilestone, code);
    const expectedFingerprint = contractSha256([
      "bitestar.review-milestone-reconcile-cursor.v2",
      ["phase", "awards"],
      ["userFingerprint", userFingerprint],
      ["operationFingerprint", operationFingerprint],
      ["lockFingerprint", lockFingerprint],
      ["countStateFingerprint", countStateFingerprint],
      ["afterMilestone", afterMilestone],
    ]);
    if (afterMilestone % 5 !== 0 || data.fingerprint !== expectedFingerprint) {
      return fail(code);
    }
    return Object.freeze({
      version: "bitestar.review-milestone-reconcile-cursor.v2",
      phase: "awards",
      userFingerprint,
      operationFingerprint,
      lockFingerprint,
      countStateFingerprint,
      afterMilestone,
      fingerprint: expectedFingerprint,
    });
  }
  const afterLedgerDocumentId = data.afterLedgerDocumentId === null
    ? null
    : exactDocumentId(data.afterLedgerDocumentId, code);
  const expectedFingerprint = contractSha256([
    "bitestar.review-milestone-reconcile-cursor.v2",
    ["phase", "ledger"],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["countStateFingerprint", countStateFingerprint],
    ["afterLedgerDocumentId", afterLedgerDocumentId],
  ]);
  if (data.fingerprint !== expectedFingerprint) {
    return fail(code);
  }
  return Object.freeze({
    version: "bitestar.review-milestone-reconcile-cursor.v2",
    phase: "ledger",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    countStateFingerprint,
    afterLedgerDocumentId,
    fingerprint: expectedFingerprint,
  });
}

function readItemCore(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): ItemCore {
  const data = record(value);
  if (data === null || !hasExactKeys(data, itemCoreKeys)) {
    return fail(code);
  }
  const parsedOperation = operation(data.operation, code);
  const parsedKind = itemKind(data.kind, code);
  if (!itemSubphases[parsedKind].includes(data.subphase as never)) {
    return fail(code);
  }
  const parsedStatus = status(data.status, code);
  const itemId = exactDocumentId(data.itemId, code);
  const jobId = exactDocumentId(data.jobId, code);
  const restaurantId = nullableDocumentId(data.restaurantId, code);
  const dishId = nullableDocumentId(data.dishId, code);
  const userId = nullableDocumentId(data.userId, code);
  const milestoneLockToken = data.milestoneLockToken === null
    ? null
    : requireFingerprint(data.milestoneLockToken, code);
  const milestoneScanId = nullableDocumentId(data.milestoneScanId, code);
  const binding = userId === null ? null : {
    itemId,
    jobId,
    userId,
    lockToken: milestoneLockToken,
    scanId: milestoneScanId,
  };
  const pointCursor = dishId === null
    ? (data.pointReversalCursor === null
      ? null
      : fail(code))
    : contributionPointCursor(data.pointReversalCursor, dishId, code);
  const resetCursor = binding === null
    ? (data.milestoneResetCursor === null ? null : fail(code))
    : milestoneResetCursor(data.milestoneResetCursor, binding, code);
  const reviewCursor = binding === null
    ? (data.milestoneReviewCursor === null ? null : fail(code))
    : milestoneReviewCursor(data.milestoneReviewCursor, binding, code);
  const reconcileCursor = binding === null
    ? (data.milestoneReconcileCursor === null ? null : fail(code))
    : milestoneReconcileCursor(data.milestoneReconcileCursor, binding, code);
  const createdAt = timestamp(data.createdAt, code);
  const updatedAt = timestamp(data.updatedAt, code);
  const completedAt = nullableTimestamp(data.completedAt, code);
  const parsedFailureCode = failureCode(data.failureCode, code);
  const parsed: ItemCore = {
    itemId,
    jobId,
    operation: parsedOperation,
    kind: parsedKind,
    status: parsedStatus,
    subphase: data.subphase as RatingDestructiveItemSubphase,
    restaurantId,
    dishId,
    userId,
    currentReviewId: nullableDocumentId(data.currentReviewId, code),
    cursorDocumentId: nullableDocumentId(data.cursorDocumentId, code),
    secondaryCursorDocumentId: nullableDocumentId(
      data.secondaryCursorDocumentId,
      code,
    ),
    aggregateCursorDocumentId: nullableDocumentId(
      data.aggregateCursorDocumentId,
      code,
    ),
    aggregateWinnerCursorId: nullableDocumentId(
      data.aggregateWinnerCursorId,
      code,
    ),
    aggregateState: aggregateState(data.aggregateState, code),
    pointReversalCursor: pointCursor,
    milestoneResetCursor: resetCursor,
    milestoneReviewCursor: reviewCursor,
    milestoneReconcileCursor: reconcileCursor,
    milestoneLockToken,
    milestoneScanId,
    validReviewCount: nullableNonnegativeInteger(data.validReviewCount, code),
    processedCount: nonnegativeInteger(data.processedCount, code),
    failureCode: parsedFailureCode,
    createdAt,
    updatedAt,
    completedAt,
  };
  validateItemCore(parsed, code);
  return Object.freeze(parsed);
}

function validateItemCore(
  value: ItemCore,
  code: "invalid-request" | "invalid-state",
): void {
  assertItemIdentity(value, code);
  const expectedItemId = createRatingDestructiveJobItemId({
    jobId: value.jobId,
    operation: value.operation,
    kind: value.kind,
    restaurantId: value.restaurantId,
    dishId: value.dishId,
    userId: value.userId,
  });
  if (value.itemId !== expectedItemId) {
    fail(code);
  }
  assertItemContinuationOwnership(value, code);
  if (value.pointReversalCursor !== null) {
    const expectedOperationFingerprint = contractSha256([
      "bitestar.review-milestone-operation.v1",
      ["operationId", value.jobId],
    ]);
    if (
      value.pointReversalCursor.operationFingerprint !==
        expectedOperationFingerprint
    ) {
      fail(code);
    }
  }
  assertStatusConsistency({
    status: value.status,
    terminalPhase: value.subphase === "complete",
    failureCode: value.failureCode,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
  }, code);
  if (
    value.status === "complete" &&
    !allNull([
      value.currentReviewId, value.cursorDocumentId,
      value.secondaryCursorDocumentId, value.aggregateCursorDocumentId,
      value.aggregateWinnerCursorId, value.aggregateState,
      value.pointReversalCursor, value.milestoneResetCursor,
      value.milestoneReviewCursor, value.milestoneReconcileCursor,
      value.milestoneLockToken, value.milestoneScanId,
      value.validReviewCount,
    ])
  ) {
    fail(code);
  }
}

export function buildRatingDestructiveJobItemDocument(
  value: ItemCore,
): RatingDestructiveJobItemDocument {
  const core = readItemCore(value, "invalid-request");
  return Object.freeze({
    version: ratingDestructiveItemVersion,
    ...core,
    fingerprint: fingerprint(ratingDestructiveItemVersion, core),
  });
}

export function parseRatingDestructiveJobItemDocument(
  document: RatingDestructiveStoredDocument | null,
): RatingDestructiveJobItemDocument | null {
  if (document === null) {
    return null;
  }
  try {
    const data = record(document.data);
    if (
      data === null ||
      !hasExactKeys(data, ["version", ...itemCoreKeys, "fingerprint"]) ||
      data.version !== ratingDestructiveItemVersion ||
      !isFingerprint(data.fingerprint)
    ) {
      return fail("invalid-state");
    }
    const coreData = {...data};
    delete coreData.version;
    delete coreData.fingerprint;
    const core = readItemCore(coreData, "invalid-state");
    if (
      exactDocumentId(document.id, "invalid-state") !== core.itemId ||
      data.fingerprint !== fingerprint(ratingDestructiveItemVersion, core)
    ) {
      return fail("invalid-state");
    }
    return Object.freeze({
      version: ratingDestructiveItemVersion,
      ...core,
      fingerprint: data.fingerprint,
    });
  } catch {
    return fail("invalid-state");
  }
}

type RestaurantLockCore = Omit<
  RatingRestaurantOperationLockDocument,
  "version" | "fingerprint"
>;

type DishLockCore = Omit<
  RatingDishOperationLockDocument,
  "version" | "fingerprint"
>;

function lockBooleans(
  state: "active_source" | "active_target" | "merged_source" |
    "deleted_source",
  active: unknown,
  permanent: unknown,
  code: "invalid-request" | "invalid-state",
): Readonly<{active: boolean; permanent: boolean}> {
  if (typeof active !== "boolean" || typeof permanent !== "boolean") {
    return fail(code);
  }
  const activeState = state === "active_source" || state === "active_target";
  if (active !== activeState || permanent === activeState) {
    return fail(code);
  }
  return {active, permanent};
}

function readRestaurantLockCore(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): RestaurantLockCore {
  const data = record(value);
  if (data === null || !hasExactKeys(data, restaurantLockCoreKeys)) {
    return fail(code);
  }
  const parsedOperation = operation(data.operation, code);
  if (
    parsedOperation !== "restaurantMerge" &&
    parsedOperation !== "restaurantDelete"
  ) {
    return fail(code);
  }
  if (data.role !== "source" && data.role !== "target") {
    return fail(code);
  }
  if (
    data.state !== "active_source" && data.state !== "active_target" &&
    data.state !== "merged_source" && data.state !== "deleted_source"
  ) {
    return fail(code);
  }
  const booleans = lockBooleans(
    data.state,
    data.active,
    data.permanent,
    code,
  );
  const createdAt = timestamp(data.createdAt, code);
  const updatedAt = timestamp(data.updatedAt, code);
  const parsed: RestaurantLockCore = {
    restaurantId: exactDocumentId(data.restaurantId, code),
    jobId: exactDocumentId(data.jobId, code),
    operation: parsedOperation,
    role: data.role,
    state: data.state,
    active: booleans.active,
    permanent: booleans.permanent,
    targetRestaurantId: nullableDocumentId(data.targetRestaurantId, code),
    createdAt,
    updatedAt,
  };
  validateRestaurantLockCore(parsed, code);
  return Object.freeze(parsed);
}

function validateRestaurantLockCore(
  value: RestaurantLockCore,
  code: "invalid-request" | "invalid-state",
): void {
  const valid = value.operation === "restaurantMerge"
    ? value.role === "source"
      ? (value.state === "active_source" || value.state === "merged_source") &&
        value.targetRestaurantId !== null &&
        value.targetRestaurantId !== value.restaurantId
      : value.state === "active_target" && value.targetRestaurantId === null
    : value.role === "source" &&
      (value.state === "active_source" || value.state === "deleted_source") &&
      value.targetRestaurantId === null;
  if (!valid || value.updatedAt.getTime() < value.createdAt.getTime()) {
    fail(code);
  }
}

export function buildRatingRestaurantOperationLockDocument(
  value: RestaurantLockCore,
): RatingRestaurantOperationLockDocument {
  const core = readRestaurantLockCore(value, "invalid-request");
  return Object.freeze({
    version: ratingRestaurantOperationLockVersion,
    ...core,
    fingerprint: fingerprint(ratingRestaurantOperationLockVersion, core),
  });
}

export function parseRatingRestaurantOperationLockDocument(
  document: RatingDestructiveStoredDocument | null,
): RatingRestaurantOperationLockDocument | null {
  if (document === null) {
    return null;
  }
  try {
    const data = record(document.data);
    if (
      data === null ||
      !hasExactKeys(data, [
        "version", ...restaurantLockCoreKeys, "fingerprint",
      ]) ||
      data.version !== ratingRestaurantOperationLockVersion ||
      !isFingerprint(data.fingerprint)
    ) {
      return fail("invalid-state");
    }
    const coreData = {...data};
    delete coreData.version;
    delete coreData.fingerprint;
    const core = readRestaurantLockCore(coreData, "invalid-state");
    if (
      exactDocumentId(document.id, "invalid-state") !== core.restaurantId ||
      data.fingerprint !== fingerprint(
        ratingRestaurantOperationLockVersion,
        core,
      )
    ) {
      return fail("invalid-state");
    }
    return Object.freeze({
      version: ratingRestaurantOperationLockVersion,
      ...core,
      fingerprint: data.fingerprint,
    });
  } catch {
    return fail("invalid-state");
  }
}

function readDishLockCore(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): DishLockCore {
  const data = record(value);
  if (data === null || !hasExactKeys(data, dishLockCoreKeys)) {
    return fail(code);
  }
  const parsedOperation = operation(data.operation, code);
  if (
    data.role !== "source" && data.role !== "target" && data.role !== "child"
  ) {
    return fail(code);
  }
  if (
    data.state !== "active_source" && data.state !== "active_target" &&
    data.state !== "merged_source" && data.state !== "deleted_source"
  ) {
    return fail(code);
  }
  const booleans = lockBooleans(
    data.state,
    data.active,
    data.permanent,
    code,
  );
  const createdAt = timestamp(data.createdAt, code);
  const updatedAt = timestamp(data.updatedAt, code);
  const parsed: DishLockCore = {
    dishId: exactDocumentId(data.dishId, code),
    jobId: exactDocumentId(data.jobId, code),
    operation: parsedOperation,
    role: data.role,
    state: data.state,
    active: booleans.active,
    permanent: booleans.permanent,
    restaurantId: nullableDocumentId(data.restaurantId, code),
    targetDishId: nullableDocumentId(data.targetDishId, code),
    createdAt,
    updatedAt,
  };
  validateDishLockCore(parsed, code);
  return Object.freeze(parsed);
}

function validateDishLockCore(
  value: DishLockCore,
  code: "invalid-request" | "invalid-state",
): void {
  let valid = false;
  if (value.operation === "dishMerge") {
    valid = value.restaurantId !== null &&
      (value.role === "source"
        ? (value.state === "active_source" ||
          value.state === "merged_source") &&
          value.targetDishId !== null && value.targetDishId !== value.dishId
        : value.role === "target" && value.state === "active_target" &&
          value.targetDishId === null);
  } else if (value.operation === "dishDelete") {
    valid = value.role === "source" &&
      (value.state === "active_source" || value.state === "deleted_source") &&
      value.targetDishId === null;
  } else if (value.operation === "restaurantMerge") {
    valid = value.role === "child" && value.state === "active_source" &&
      value.restaurantId !== null && value.targetDishId === null;
  } else {
    valid = value.role === "child" && value.restaurantId !== null &&
      (value.state === "active_source" || value.state === "deleted_source") &&
      value.targetDishId === null;
  }
  if (!valid || value.updatedAt.getTime() < value.createdAt.getTime()) {
    fail(code);
  }
}

export function buildRatingDishOperationLockDocument(
  value: DishLockCore,
): RatingDishOperationLockDocument {
  const core = readDishLockCore(value, "invalid-request");
  return Object.freeze({
    version: ratingDishOperationLockVersion,
    ...core,
    fingerprint: fingerprint(ratingDishOperationLockVersion, core),
  });
}

export function parseRatingDishOperationLockDocument(
  document: RatingDestructiveStoredDocument | null,
): RatingDishOperationLockDocument | null {
  if (document === null) {
    return null;
  }
  try {
    const data = record(document.data);
    if (
      data === null ||
      !hasExactKeys(data, ["version", ...dishLockCoreKeys, "fingerprint"]) ||
      data.version !== ratingDishOperationLockVersion ||
      !isFingerprint(data.fingerprint)
    ) {
      return fail("invalid-state");
    }
    const coreData = {...data};
    delete coreData.version;
    delete coreData.fingerprint;
    const core = readDishLockCore(coreData, "invalid-state");
    if (
      exactDocumentId(document.id, "invalid-state") !== core.dishId ||
      data.fingerprint !== fingerprint(ratingDishOperationLockVersion, core)
    ) {
      return fail("invalid-state");
    }
    return Object.freeze({
      version: ratingDishOperationLockVersion,
      ...core,
      fingerprint: data.fingerprint,
    });
  } catch {
    return fail("invalid-state");
  }
}
