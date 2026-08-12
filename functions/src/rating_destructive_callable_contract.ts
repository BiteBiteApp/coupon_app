import {HttpsError} from "firebase-functions/v2/https";

import type {
  RatingDestructiveJobDocument,
  RatingDestructiveJobPhase,
  RatingDestructiveOperation,
  RatingDestructiveStatus,
} from "./rating_destructive_job_contract.js";

export const ratingDestructiveCallableContractVersion =
  "bitestar.rating-destructive-callable.v1" as const;
export const ratingDestructiveSummaryContractVersion =
  "bitestar.rating-destructive-summary.v1" as const;

export type RatingDestructiveProgressCategory =
  | "starting"
  | "moving_data"
  | "rebuilding"
  | "cleaning_up"
  | "finalizing"
  | "waiting_retry"
  | "needs_attention"
  | "complete";

export type RatingDestructiveMessageCategory =
  | "accepted_processing"
  | "already_processing"
  | "accepted_complete"
  | "retryable_processing"
  | "manual_review_required"
  | "current_status";

export type RatingRestaurantMergeStartRequest = Readonly<{
  contractVersion: typeof ratingDestructiveCallableContractVersion;
  sourceRestaurantId: string;
  targetRestaurantId: string;
  expectedSourceRestaurantRevision: number;
  expectedTargetRestaurantRevision: number;
  clientRequestId: string;
}>;

export type RatingRestaurantDeleteStartRequest = Readonly<{
  contractVersion: typeof ratingDestructiveCallableContractVersion;
  restaurantId: string;
  expectedRestaurantRevision: number;
  clientRequestId: string;
}>;

export type RatingDishMergeStartRequest = Readonly<{
  contractVersion: typeof ratingDestructiveCallableContractVersion;
  sourceDishId: string;
  targetDishId: string;
  clientRequestId: string;
}>;

export type RatingDishDeleteStartRequest = Readonly<{
  contractVersion: typeof ratingDestructiveCallableContractVersion;
  dishId: string;
  clientRequestId: string;
}>;

export type RatingDestructiveStatusRequest = Readonly<{
  contractVersion: typeof ratingDestructiveCallableContractVersion;
  operationId: string;
  clientRequestId: string;
}>;

export type RatingDestructiveOperationSummary = Readonly<{
  contractVersion: typeof ratingDestructiveSummaryContractVersion;
  accepted: boolean;
  operationId: string;
  operation: RatingDestructiveOperation;
  status: RatingDestructiveStatus;
  progressCategory: RatingDestructiveProgressCategory;
  processing: boolean;
  complete: boolean;
  retryable: boolean;
  manualReviewRequired: boolean;
  messageCategory: RatingDestructiveMessageCategory;
  processedCount: number;
  phaseProcessedCount: number;
  createdAtMs: number;
  updatedAtMs: number;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function invalidRequest(): never {
  throw new HttpsError(
    "invalid-argument",
    "The Rating destructive-operation request is invalid.",
  );
}

function requestRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.contractVersion !== ratingDestructiveCallableContractVersion
  ) {
    invalidRequest();
  }
  return value;
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
    invalidRequest();
  }
  return value;
}

function exactOperationId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    invalidRequest();
  }
  return value;
}

function clientRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  ) {
    invalidRequest();
  }
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidRequest();
  }
  return value;
}

export function parseRatingRestaurantMergeStartRequest(
  value: unknown,
): RatingRestaurantMergeStartRequest {
  const data = requestRecord(value, [
    "contractVersion", "sourceRestaurantId", "targetRestaurantId",
    "expectedSourceRestaurantRevision", "expectedTargetRestaurantRevision",
    "clientRequestId",
  ]);
  const sourceRestaurantId = exactDocumentId(data.sourceRestaurantId);
  const targetRestaurantId = exactDocumentId(data.targetRestaurantId);
  if (sourceRestaurantId === targetRestaurantId) {
    invalidRequest();
  }
  return Object.freeze({
    contractVersion: ratingDestructiveCallableContractVersion,
    sourceRestaurantId,
    targetRestaurantId,
    expectedSourceRestaurantRevision: revision(
      data.expectedSourceRestaurantRevision,
    ),
    expectedTargetRestaurantRevision: revision(
      data.expectedTargetRestaurantRevision,
    ),
    clientRequestId: clientRequestId(data.clientRequestId),
  });
}

export function parseRatingRestaurantDeleteStartRequest(
  value: unknown,
): RatingRestaurantDeleteStartRequest {
  const data = requestRecord(value, [
    "contractVersion", "restaurantId", "expectedRestaurantRevision",
    "clientRequestId",
  ]);
  return Object.freeze({
    contractVersion: ratingDestructiveCallableContractVersion,
    restaurantId: exactDocumentId(data.restaurantId),
    expectedRestaurantRevision: revision(data.expectedRestaurantRevision),
    clientRequestId: clientRequestId(data.clientRequestId),
  });
}

export function parseRatingDishMergeStartRequest(
  value: unknown,
): RatingDishMergeStartRequest {
  const data = requestRecord(value, [
    "contractVersion", "sourceDishId", "targetDishId", "clientRequestId",
  ]);
  const sourceDishId = exactDocumentId(data.sourceDishId);
  const targetDishId = exactDocumentId(data.targetDishId);
  if (sourceDishId === targetDishId) {
    invalidRequest();
  }
  return Object.freeze({
    contractVersion: ratingDestructiveCallableContractVersion,
    sourceDishId,
    targetDishId,
    clientRequestId: clientRequestId(data.clientRequestId),
  });
}

export function parseRatingDishDeleteStartRequest(
  value: unknown,
): RatingDishDeleteStartRequest {
  const data = requestRecord(value, [
    "contractVersion", "dishId", "clientRequestId",
  ]);
  return Object.freeze({
    contractVersion: ratingDestructiveCallableContractVersion,
    dishId: exactDocumentId(data.dishId),
    clientRequestId: clientRequestId(data.clientRequestId),
  });
}

export function parseRatingDestructiveStatusRequest(
  value: unknown,
): RatingDestructiveStatusRequest {
  const data = requestRecord(value, [
    "contractVersion", "operationId", "clientRequestId",
  ]);
  return Object.freeze({
    contractVersion: ratingDestructiveCallableContractVersion,
    operationId: exactOperationId(data.operationId),
    clientRequestId: clientRequestId(data.clientRequestId),
  });
}

function activeProgressCategory(
  phase: RatingDestructiveJobPhase,
): RatingDestructiveProgressCategory {
  switch (phase) {
    case "claimed":
    case "validate":
      return "starting";
    case "move_dishes":
    case "move_reviews":
    case "move_claim_requests":
    case "move_dish_proposals":
    case "move_restaurant_reports":
    case "move_dish_reports":
    case "move_review_reports":
    case "move_review_feedback_votes":
    case "process_dishes":
    case "process_orphan_reviews":
    case "process_reviews":
    case "reverse_contribution_points":
      return "moving_data";
    case "rebuild_moved_dish_aggregates":
    case "rebuild_target_aggregate":
    case "fold_target_aggregate":
    case "rebuild_source_aggregate":
    case "fold_source_aggregate":
    case "reconcile_milestone_users":
      return "rebuilding";
    case "resolve_duplicate_reports":
    case "delete_restaurant_reports":
    case "delete_duplicate_reports":
    case "delete_dish_reports":
    case "delete_aggregate":
    case "delete_dish":
      return "cleaning_up";
    case "finalize_restaurants":
    case "finalize_restaurant":
    case "finalize_dishes":
      return "finalizing";
    case "complete":
      return "complete";
  }
}

export function ratingDestructiveProgressCategoryForJob(
  job: RatingDestructiveJobDocument,
): RatingDestructiveProgressCategory {
  if (job.status === "complete") {
    return "complete";
  }
  if (job.status === "manual_review_required") {
    return "needs_attention";
  }
  if (job.status === "retryable") {
    return "waiting_retry";
  }
  return activeProgressCategory(job.phase);
}

function messageCategoryForJob(
  job: RatingDestructiveJobDocument,
  accepted: boolean,
  mode: "start" | "status",
): RatingDestructiveMessageCategory {
  if (mode === "status") {
    return "current_status";
  }
  if (job.status === "complete") {
    return "accepted_complete";
  }
  if (job.status === "manual_review_required") {
    return "manual_review_required";
  }
  if (job.status === "retryable") {
    return "retryable_processing";
  }
  return accepted ? "accepted_processing" : "already_processing";
}

export function buildRatingDestructiveOperationSummary(
  job: RatingDestructiveJobDocument,
  options: Readonly<{
    accepted: boolean;
    mode: "start" | "status";
  }>,
): RatingDestructiveOperationSummary {
  return Object.freeze({
    contractVersion: ratingDestructiveSummaryContractVersion,
    accepted: options.accepted,
    operationId: job.jobId,
    operation: job.operation,
    status: job.status,
    progressCategory: ratingDestructiveProgressCategoryForJob(job),
    processing: job.status === "active" || job.status === "retryable",
    complete: job.status === "complete",
    retryable: job.status === "retryable",
    manualReviewRequired: job.status === "manual_review_required",
    messageCategory: messageCategoryForJob(
      job,
      options.accepted,
      options.mode,
    ),
    processedCount: job.processedCount,
    phaseProcessedCount: job.phaseProcessedCount,
    createdAtMs: job.createdAt.getTime(),
    updatedAtMs: job.updatedAt.getTime(),
  });
}
