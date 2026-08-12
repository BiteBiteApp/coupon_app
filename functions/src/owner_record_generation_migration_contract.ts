import {createHash} from "node:crypto";

import {
  ownerRecordStateCollection,
  requireOwnerRecordGeneration,
  requireOwnerRecordUid,
} from "./owner_record_state_contract.js";

/**
 * Private, source-only contract for a future dry-run owner-generation planner.
 * Nothing in this module reads or writes Firebase and a plan is not authority
 * to apply its descriptive operations.
 */
export const ownerRecordGenerationMigrationPlanVersion =
  "bitestar.owner-record-generation-migration-plan.v1" as const;
export const ownerRecordGenerationMigrationSummaryVersion =
  "bitestar.owner-record-generation-migration-summary.v1" as const;
export const ownerRecordGenerationMigrationPlannerVersion =
  "bitestar.owner-record-generation-migration-planner.v1" as const;
export const ownerRecordGenerationMigrationMaximumPagesPerScope = 100 as const;
export const ownerRecordGenerationMigrationFirestorePageLimit = 100 as const;
export const ownerRecordGenerationMigrationStoragePageLimit = 25 as const;
export const ownerRecordGenerationMigrationSourceCheckpointCommit =
  "e84efab59abd04a26aae5447fe7a57eb06b27e81" as const;
export const canonicalInitialOwnerRecordGeneration = 0 as const;
export const ownerRecordGenerationStorageMetadataKey =
  "ownerRecordGeneration" as const;

export const ownerRecordGenerationMigrationClassifications = Object.freeze([
  "already_initialized",
  "legacy_safe_candidate",
  "manual_review_required",
  "blocked_active_removal",
  "no_owner_data",
] as const);
export type OwnerRecordGenerationMigrationClassification =
  typeof ownerRecordGenerationMigrationClassifications[number];

export const ownerRecordGenerationMigrationReasonCodes = Object.freeze([
  "owner_state_malformed",
  "owner_state_not_open",
  "owner_state_generation_conflict",
  "active_removal_job",
  "retryable_removal_job",
  "manual_review_removal_job",
  "historical_removal_job",
  "removal_job_malformed",
  "prior_generation_lifecycle_evidence",
  "account_root_missing_with_owner_state",
  "account_root_missing_with_child",
  "account_root_missing_with_rating_claim",
  "account_root_missing_with_storage",
  "account_root_owner_conflict",
  "orphan_owner_local_record",
  "record_owner_conflict",
  "record_generation_missing_after_initialization",
  "record_generation_malformed",
  "record_generation_older",
  "record_generation_newer",
  "mixed_record_generations",
  "record_shape_unrecognized",
  "rating_claim_owner_conflict",
  "rating_claim_status_conflict",
  "multiple_rating_claims",
  "rating_claim_generation_malformed",
  "rating_claim_generation_older",
  "rating_claim_generation_newer",
  "storage_prefix_conflict",
  "storage_generation_malformed",
  "storage_generation_older",
  "storage_generation_newer",
  "storage_provider_generation_missing",
  "storage_metageneration_missing",
  "billing_state_malformed",
  "billing_generation_conflict",
  "subscription_return_state_malformed",
  "subscription_return_generation_conflict",
  "unsafe_timestamp",
  "duplicate_document_path",
  "duplicate_storage_object_name",
  "inventory_incomplete",
  "inventory_bounds_exceeded",
  "pagination_cursor_invalid",
] as const);
export type OwnerRecordGenerationMigrationReasonCode =
  typeof ownerRecordGenerationMigrationReasonCodes[number];

export const ownerRecordGenerationMigrationAccountChildCollections =
  Object.freeze([
    "coupons",
    "daily_specials",
    "coupon_number_reservations",
    "coupon_code_reservations",
    "menu_images",
    "menu_items",
    "menu_sections",
  ] as const);
export type OwnerRecordGenerationMigrationAccountChildCollection =
  typeof ownerRecordGenerationMigrationAccountChildCollections[number];

export const ownerRecordGenerationMigrationFirestoreScopes = Object.freeze([
  "account_root",
  ...ownerRecordGenerationMigrationAccountChildCollections,
  "rating_claim",
] as const);
export type OwnerRecordGenerationMigrationFirestoreScope =
  typeof ownerRecordGenerationMigrationFirestoreScopes[number];

export const ownerRecordGenerationMigrationStorageKinds = Object.freeze([
  "restaurant_images",
  "coupon_images",
  "menu_images",
] as const);
export type OwnerRecordGenerationMigrationStorageKind =
  typeof ownerRecordGenerationMigrationStorageKinds[number];

export const ownerRecordGenerationMigrationPaginationScopes = Object.freeze([
  "removal_jobs",
  ...ownerRecordGenerationMigrationAccountChildCollections,
  "rating_claims",
  "storage_restaurant_images",
  "storage_coupon_images",
  "storage_menu_images",
] as const);
export type OwnerRecordGenerationMigrationPaginationScope =
  typeof ownerRecordGenerationMigrationPaginationScopes[number];

export type OwnerRecordGenerationObservation =
  | Readonly<{kind: "missing"}>
  | Readonly<{kind: "value"; value: number}>;

export type OwnerRecordGenerationStorageObservation =
  | Readonly<{kind: "missing"}>
  | Readonly<{kind: "value"; value: string}>;

export type OwnerRecordGenerationMigrationFirestoreUpdateTime = Readonly<{
  seconds: string;
  nanoseconds: number;
}>;

export type OwnerRecordGenerationMigrationCreateOwnerStateOperation = Readonly<{
  operation: "create_owner_state";
  documentPath: string;
  ownerRecordGeneration: typeof canonicalInitialOwnerRecordGeneration;
  existingGeneration: null;
  precondition: Readonly<{kind: "must_not_exist"}>;
}>;

export type OwnerRecordGenerationMigrationStampFirestoreOperation = Readonly<{
  operation: "stamp_firestore_document";
  scope: OwnerRecordGenerationMigrationFirestoreScope;
  documentPath: string;
  ownerRecordGeneration: number;
  existingGeneration: number | null;
  precondition: Readonly<{
    kind: "update_time";
    updateTime: OwnerRecordGenerationMigrationFirestoreUpdateTime;
  }>;
}>;

export type OwnerRecordGenerationMigrationStampStorageOperation = Readonly<{
  operation: "stamp_storage_object_metadata";
  storageKind: OwnerRecordGenerationMigrationStorageKind;
  objectName: string;
  ownerRecordGeneration: string;
  existingGeneration: string | null;
  providerGeneration: string;
  metageneration: string;
}>;

export type OwnerRecordGenerationMigrationOperation =
  | OwnerRecordGenerationMigrationCreateOwnerStateOperation
  | OwnerRecordGenerationMigrationStampFirestoreOperation
  | OwnerRecordGenerationMigrationStampStorageOperation;

export type OwnerRecordGenerationMigrationManualReviewReason = Readonly<{
  code: OwnerRecordGenerationMigrationReasonCode;
  documentPath: string | null;
  storageObjectName: string | null;
  existingGeneration: number | string | null;
}>;

export type OwnerRecordGenerationMigrationPaginationState = Readonly<{
  scope: OwnerRecordGenerationMigrationPaginationScope;
  complete: boolean;
  nextCursor: string | null;
  pagesRead: number;
  recordsRead: number;
}>;

export type OwnerRecordGenerationMigrationPlan = Readonly<{
  schemaVersion: typeof ownerRecordGenerationMigrationPlanVersion;
  projectId: string;
  generatedAt: string;
  plannerVersion: typeof ownerRecordGenerationMigrationPlannerVersion;
  sourceCheckpointCommit:
    typeof ownerRecordGenerationMigrationSourceCheckpointCommit;
  planId: string;
  planHash: string;
  ownerUid: string;
  canonicalAccountPath: string;
  classification: OwnerRecordGenerationMigrationClassification;
  proposedGeneration: number | null;
  operations: readonly OwnerRecordGenerationMigrationOperation[];
  manualReviewReasons:
    readonly OwnerRecordGenerationMigrationManualReviewReason[];
  pagination: readonly OwnerRecordGenerationMigrationPaginationState[];
}>;

export type OwnerRecordGenerationMigrationPlanInput = Omit<
  OwnerRecordGenerationMigrationPlan,
  "planId" | "planHash"
>;

export type OwnerRecordGenerationMigrationRedactedSummary = Readonly<{
  schemaVersion: typeof ownerRecordGenerationMigrationSummaryVersion;
  planCount: number;
  classificationCounts: Readonly<Record<
    OwnerRecordGenerationMigrationClassification,
    number
  >>;
  operationCounts: Readonly<{
    createOwnerStates: number;
    firestoreDocuments: number;
    storageObjects: number;
  }>;
  manualReviewReasonCounts: readonly Readonly<{
    code: OwnerRecordGenerationMigrationReasonCode;
    count: number;
  }>[];
  incompletePaginationScopeCount: number;
}>;

export class OwnerRecordGenerationMigrationContractError extends Error {
  public readonly code: "invalid-request" | "invalid-state";

  public constructor(code: "invalid-request" | "invalid-state") {
    super(code === "invalid-state"
      ? "Stored owner-generation migration plan is invalid."
      : "Owner-generation migration plan request is invalid.");
    this.name = "OwnerRecordGenerationMigrationContractError";
    this.code = code;
  }
}

const classificationSet: ReadonlySet<string> =
  new Set(ownerRecordGenerationMigrationClassifications);
const reasonCodeSet: ReadonlySet<string> =
  new Set(ownerRecordGenerationMigrationReasonCodes);
const childCollectionSet: ReadonlySet<string> =
  new Set(ownerRecordGenerationMigrationAccountChildCollections);
const firestoreScopeSet: ReadonlySet<string> =
  new Set(ownerRecordGenerationMigrationFirestoreScopes);
const storageKindSet: ReadonlySet<string> =
  new Set(ownerRecordGenerationMigrationStorageKinds);
const paginationScopeSet: ReadonlySet<string> =
  new Set(ownerRecordGenerationMigrationPaginationScopes);

function fail(code: "invalid-request" | "invalid-state"): never {
  throw new OwnerRecordGenerationMigrationContractError(code);
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<PropertyKey, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    return false;
  }
  const actual = (keys as string[]).sort();
  const required = [...expected].sort();
  return actual.length === required.length &&
    actual.every((key, index) => key === required[index]);
}

function record(
  value: unknown,
  keys: readonly string[],
  code: "invalid-request" | "invalid-state",
): Record<PropertyKey, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) {
    return fail(code);
  }
  return value;
}

function exactString(
  value: unknown,
  maximumUtf8Bytes: number,
  code: "invalid-request" | "invalid-state",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maximumUtf8Bytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return fail(code);
  }
  return value;
}

function exactDocumentId(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  const parsed = exactString(value, 1_500, code);
  if (parsed === "." || parsed === ".." || parsed.includes("/")) {
    return fail(code);
  }
  return parsed;
}

function exactUid(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  try {
    return requireOwnerRecordUid(value);
  } catch {
    return fail(code);
  }
}

function generation(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number {
  try {
    return requireOwnerRecordGeneration(value);
  } catch {
    return fail(code);
  }
}

function nullableGeneration(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number | null {
  return value === null ? null : generation(value, code);
}

/** Requires a canonical positive decimal provider concurrency value. */
export function requireOwnerRecordGenerationMigrationProviderDecimal(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,39}$/u.test(value)
  ) {
    return fail("invalid-request");
  }
  return value;
}

function providerDecimal(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  try {
    return requireOwnerRecordGenerationMigrationProviderDecimal(value);
  } catch {
    return fail(code);
  }
}

/** Requires a canonical decimal string for a safe owner generation. */
export function requireOwnerRecordGenerationMigrationStorageGeneration(
  value: unknown,
): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return fail("invalid-request");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    return fail("invalid-request");
  }
  return value;
}

function storageGeneration(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  try {
    return requireOwnerRecordGenerationMigrationStorageGeneration(value);
  } catch {
    return fail(code);
  }
}

/** Requires a lower-case Firebase/Google project ID, never a default. */
export function requireOwnerRecordGenerationMigrationProjectId(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(value)
  ) {
    return fail("invalid-request");
  }
  return value;
}

function projectId(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  try {
    return requireOwnerRecordGenerationMigrationProjectId(value);
  } catch {
    return fail(code);
  }
}

/** Requires a canonical UTC ISO timestamp with millisecond precision. */
export function requireOwnerRecordGenerationMigrationTimestamp(
  value: unknown,
): string {
  if (typeof value !== "string") {
    return fail("invalid-request");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return fail("invalid-request");
  }
  return value;
}

function timestamp(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  try {
    return requireOwnerRecordGenerationMigrationTimestamp(value);
  } catch {
    return fail(code);
  }
}

function fingerprint(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    return fail(code);
  }
  return value;
}

function classification(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationClassification {
  if (typeof value !== "string" || !classificationSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordGenerationMigrationClassification;
}

function reasonCode(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationReasonCode {
  if (typeof value !== "string" || !reasonCodeSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordGenerationMigrationReasonCode;
}

function firestoreScope(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationFirestoreScope {
  if (typeof value !== "string" || !firestoreScopeSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordGenerationMigrationFirestoreScope;
}

function storageKind(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationStorageKind {
  if (typeof value !== "string" || !storageKindSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordGenerationMigrationStorageKind;
}

function paginationScope(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationPaginationScope {
  if (typeof value !== "string" || !paginationScopeSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordGenerationMigrationPaginationScope;
}

function counter(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(code);
  }
  return value;
}

export function canonicalOwnerRecordGenerationMigrationAccountPath(
  ownerUid: unknown,
): string {
  return "restaurant_accounts/" + exactUid(ownerUid, "invalid-request");
}

export function canonicalOwnerRecordGenerationMigrationOwnerStatePath(
  ownerUid: unknown,
): string {
  return ownerRecordStateCollection + "/" +
    exactUid(ownerUid, "invalid-request");
}

export function buildOwnerRecordGenerationMigrationAccountChildPath(params: {
  ownerUid: unknown;
  collection: unknown;
  documentId: unknown;
}): string {
  const ownerUid = exactUid(params.ownerUid, "invalid-request");
  if (
    typeof params.collection !== "string" ||
    !childCollectionSet.has(params.collection)
  ) {
    return fail("invalid-request");
  }
  return "restaurant_accounts/" + ownerUid + "/" + params.collection + "/" +
    exactDocumentId(params.documentId, "invalid-request");
}

export function buildOwnerRecordGenerationMigrationRatingPath(
  restaurantId: unknown,
): string {
  return "bitescore_restaurants/" +
    exactDocumentId(restaurantId, "invalid-request");
}

export function buildOwnerRecordGenerationMigrationStoragePrefix(params: {
  ownerUid: unknown;
  storageKind: unknown;
}): string {
  const ownerUid = exactUid(params.ownerUid, "invalid-request");
  const kind = storageKind(params.storageKind, "invalid-request");
  return "bitesaver_restaurants/" + ownerUid + "/" + kind + "/";
}

function exactStorageObjectName(
  value: unknown,
  ownerUid: string,
  kind: OwnerRecordGenerationMigrationStorageKind,
  code: "invalid-request" | "invalid-state",
): string {
  const name = exactString(value, 1_024, code);
  const prefix = "bitesaver_restaurants/" + ownerUid + "/" + kind + "/";
  if (!name.startsWith(prefix) || name.length <= prefix.length) {
    return fail(code);
  }
  return name;
}

function exactAnyStorageObjectName(
  value: unknown,
  ownerUid: string,
  code: "invalid-request" | "invalid-state",
): string {
  const name = exactString(value, 1_024, code);
  const matches = ownerRecordGenerationMigrationStorageKinds.some(
    (kind) => {
      const prefix = "bitesaver_restaurants/" + ownerUid + "/" + kind + "/";
      return name.startsWith(prefix) && name.length > prefix.length;
    },
  );
  return matches ? name : fail(code);
}

export function requireOwnerRecordGenerationMigrationStorageObjectName(params: {
  ownerUid: unknown;
  storageKind: unknown;
  objectName: unknown;
}): string {
  const ownerUid = exactUid(params.ownerUid, "invalid-request");
  const kind = storageKind(params.storageKind, "invalid-request");
  return exactStorageObjectName(
    params.objectName,
    ownerUid,
    kind,
    "invalid-request",
  );
}

function validDocumentId(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." &&
    !value.includes("/") && !/[\u0000-\u001f\u007f]/u.test(value) &&
    Buffer.byteLength(value, "utf8") <= 1_500;
}

function pathMatchesScope(
  path: string,
  ownerUid: string,
  scope: OwnerRecordGenerationMigrationFirestoreScope,
): boolean {
  if (scope === "account_root") {
    return path === "restaurant_accounts/" + ownerUid;
  }
  const parts = path.split("/");
  if (scope === "rating_claim") {
    return parts.length === 2 && parts[0] === "bitescore_restaurants" &&
      validDocumentId(parts[1]);
  }
  return parts.length === 4 && parts[0] === "restaurant_accounts" &&
    parts[1] === ownerUid && parts[2] === scope && validDocumentId(parts[3]);
}

function exactAllowlistedFirestorePath(
  value: unknown,
  ownerUid: string,
  code: "invalid-request" | "invalid-state",
): string {
  const path = exactString(value, 6_144, code);
  const parts = path.split("/");
  if (
    path === "restaurant_accounts/" + ownerUid ||
    path === ownerRecordStateCollection + "/" + ownerUid ||
    path === "private_owner_billing_states/" + ownerUid ||
    path === "private_subscription_return_state/" + ownerUid ||
    (parts.length === 2 &&
      parts[0] === "private_owner_record_removal_jobs" &&
      validDocumentId(parts[1])) ||
    (parts.length === 2 &&
      parts[0] === "bitescore_restaurants" &&
      validDocumentId(parts[1])) ||
    (parts.length === 4 &&
      parts[0] === "restaurant_accounts" &&
      parts[1] === ownerUid &&
      childCollectionSet.has(parts[2]) &&
      validDocumentId(parts[3]))
  ) {
    return path;
  }
  return fail(code);
}

export function requireOwnerRecordGenerationMigrationFirestorePath(params: {
  ownerUid: unknown;
  documentPath: unknown;
}): string {
  return exactAllowlistedFirestorePath(
    params.documentPath,
    exactUid(params.ownerUid, "invalid-request"),
    "invalid-request",
  );
}

function firestoreUpdateTime(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationFirestoreUpdateTime {
  const data = record(value, ["seconds", "nanoseconds"], code);
  const seconds = data.seconds;
  if (
    typeof seconds !== "string" ||
    !/^(?:0|[1-9][0-9]{0,11})$/u.test(seconds)
  ) {
    return fail(code);
  }
  const nanoseconds = data.nanoseconds;
  if (
    typeof nanoseconds !== "number" ||
    !Number.isInteger(nanoseconds) ||
    nanoseconds < 0 ||
    nanoseconds > 999_999_999
  ) {
    return fail(code);
  }
  return Object.freeze({seconds, nanoseconds});
}

function parseOperation(
  value: unknown,
  ownerUid: string,
  proposedGeneration: number,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationOperation {
  if (!isPlainRecord(value) || typeof value.operation !== "string") {
    return fail(code);
  }
  if (value.operation === "create_owner_state") {
    const data = record(value, [
      "operation",
      "documentPath",
      "ownerRecordGeneration",
      "existingGeneration",
      "precondition",
    ], code);
    const precondition = record(data.precondition, ["kind"], code);
    if (
      data.documentPath !== ownerRecordStateCollection + "/" + ownerUid ||
      data.ownerRecordGeneration !== canonicalInitialOwnerRecordGeneration ||
      proposedGeneration !== canonicalInitialOwnerRecordGeneration ||
      data.existingGeneration !== null ||
      precondition.kind !== "must_not_exist"
    ) {
      return fail(code);
    }
    return Object.freeze({
      operation: "create_owner_state",
      documentPath: data.documentPath,
      ownerRecordGeneration: canonicalInitialOwnerRecordGeneration,
      existingGeneration: null,
      precondition: Object.freeze({kind: "must_not_exist"}),
    });
  }
  if (value.operation === "stamp_firestore_document") {
    const data = record(value, [
      "operation",
      "scope",
      "documentPath",
      "ownerRecordGeneration",
      "existingGeneration",
      "precondition",
    ], code);
    const scope = firestoreScope(data.scope, code);
    const documentPath = exactAllowlistedFirestorePath(
      data.documentPath,
      ownerUid,
      code,
    );
    const ownerRecordGeneration = generation(data.ownerRecordGeneration, code);
    const existingGeneration = nullableGeneration(data.existingGeneration, code);
    const preconditionData = record(
      data.precondition,
      ["kind", "updateTime"],
      code,
    );
    if (
      !pathMatchesScope(documentPath, ownerUid, scope) ||
      ownerRecordGeneration !== proposedGeneration ||
      existingGeneration !== null ||
      preconditionData.kind !== "update_time"
    ) {
      return fail(code);
    }
    return Object.freeze({
      operation: "stamp_firestore_document",
      scope,
      documentPath,
      ownerRecordGeneration,
      existingGeneration,
      precondition: Object.freeze({
        kind: "update_time",
        updateTime: firestoreUpdateTime(preconditionData.updateTime, code),
      }),
    });
  }
  if (value.operation === "stamp_storage_object_metadata") {
    const data = record(value, [
      "operation",
      "storageKind",
      "objectName",
      "ownerRecordGeneration",
      "existingGeneration",
      "providerGeneration",
      "metageneration",
    ], code);
    const kind = storageKind(data.storageKind, code);
    const objectName = exactStorageObjectName(
      data.objectName,
      ownerUid,
      kind,
      code,
    );
    const ownerRecordGeneration = storageGeneration(
      data.ownerRecordGeneration,
      code,
    );
    const existingGeneration = data.existingGeneration === null
      ? null
      : storageGeneration(data.existingGeneration, code);
    if (
      ownerRecordGeneration !== String(proposedGeneration) ||
      existingGeneration !== null
    ) {
      return fail(code);
    }
    return Object.freeze({
      operation: "stamp_storage_object_metadata",
      storageKind: kind,
      objectName,
      ownerRecordGeneration,
      existingGeneration,
      providerGeneration: providerDecimal(data.providerGeneration, code),
      metageneration: providerDecimal(data.metageneration, code),
    });
  }
  return fail(code);
}

function parseManualReviewReason(
  value: unknown,
  ownerUid: string,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationManualReviewReason {
  const data = record(value, [
    "code",
    "documentPath",
    "storageObjectName",
    "existingGeneration",
  ], code);
  const documentPath = data.documentPath === null
    ? null
    : exactAllowlistedFirestorePath(data.documentPath, ownerUid, code);
  const storageObjectName = data.storageObjectName === null
    ? null
    : exactAnyStorageObjectName(data.storageObjectName, ownerUid, code);
  if (documentPath !== null && storageObjectName !== null) {
    return fail(code);
  }
  const rawGeneration = data.existingGeneration;
  let existingGeneration: number | string | null;
  if (rawGeneration === null) {
    existingGeneration = null;
  } else if (typeof rawGeneration === "number") {
    existingGeneration = generation(rawGeneration, code);
  } else {
    existingGeneration = storageGeneration(rawGeneration, code);
  }
  return Object.freeze({
    code: reasonCode(data.code, code),
    documentPath,
    storageObjectName,
    existingGeneration,
  });
}

function parsePaginationState(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordGenerationMigrationPaginationState {
  const data = record(value, [
    "scope",
    "complete",
    "nextCursor",
    "pagesRead",
    "recordsRead",
  ], code);
  if (typeof data.complete !== "boolean") {
    return fail(code);
  }
  const nextCursor = data.nextCursor === null
    ? null
    : exactString(data.nextCursor, 4_096, code);
  if (
    (data.complete && nextCursor !== null) ||
    (!data.complete && nextCursor === null)
  ) {
    return fail(code);
  }
  const pagesRead = counter(data.pagesRead, code);
  const recordsRead = counter(data.recordsRead, code);
  const scope = paginationScope(data.scope, code);
  const perPageLimit = scope.startsWith("storage_")
    ? ownerRecordGenerationMigrationStoragePageLimit
    : ownerRecordGenerationMigrationFirestorePageLimit;
  const minimumRecords = scope.startsWith("storage_")
    ? pagesRead - 1
    : (pagesRead - 1) * perPageLimit;
  const impossibleCompleteFirestorePage =
    !scope.startsWith("storage_") && data.complete &&
    recordsRead === pagesRead * perPageLimit;
  if (
    pagesRead === 0 ||
    pagesRead > ownerRecordGenerationMigrationMaximumPagesPerScope ||
    recordsRead < minimumRecords ||
    recordsRead > pagesRead * perPageLimit ||
    impossibleCompleteFirestorePage
  ) {
    return fail(code);
  }
  return Object.freeze({
    scope,
    complete: data.complete,
    nextCursor,
    pagesRead,
    recordsRead,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of (Reflect.ownKeys(value) as string[]).sort()) {
      normalized[key] = canonicalize(value[key]);
    }
    return normalized;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(Object.freeze({domain, value})), "utf8")
    .digest("hex");
}

function lexicalCompare(left: unknown, right: unknown): number {
  const a = canonicalJson(left);
  const b = canonicalJson(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizedUnique<T>(
  values: readonly T[],
  code: "invalid-request" | "invalid-state",
): readonly T[] {
  const sorted = [...values].sort(lexicalCompare);
  for (let index = 1; index < sorted.length; index += 1) {
    if (canonicalJson(sorted[index - 1]) === canonicalJson(sorted[index])) {
      return fail(code);
    }
  }
  return Object.freeze(sorted);
}

function validateClassificationInvariants(params: {
  classification: OwnerRecordGenerationMigrationClassification;
  proposedGeneration: number | null;
  operations: readonly OwnerRecordGenerationMigrationOperation[];
  reasons: readonly OwnerRecordGenerationMigrationManualReviewReason[];
  pagination: readonly OwnerRecordGenerationMigrationPaginationState[];
  code: "invalid-request" | "invalid-state";
}): void {
  const incomplete = params.pagination.some((entry) => !entry.complete);
  const fullInventoryCoverage = params.pagination.length ===
      ownerRecordGenerationMigrationPaginationScopes.length &&
    ownerRecordGenerationMigrationPaginationScopes.every((scope) =>
      params.pagination.some((entry) => entry.scope === scope));
  const completeInventory = fullInventoryCoverage && !incomplete;
  if (!fullInventoryCoverage) {
    fail(params.code);
  }
  if (params.classification === "legacy_safe_candidate") {
    const createCount = params.operations.filter(
      (entry) => entry.operation === "create_owner_state",
    ).length;
    if (
      params.proposedGeneration !== canonicalInitialOwnerRecordGeneration ||
      params.operations.length === 0 ||
      createCount !== 1 ||
      params.reasons.length !== 0 ||
      !completeInventory
    ) {
      fail(params.code);
    }
    return;
  }
  if (params.classification === "already_initialized") {
    if (
      params.proposedGeneration === null ||
      params.operations.length !== 0 ||
      params.reasons.length !== 0 ||
      !completeInventory
    ) {
      fail(params.code);
    }
    return;
  }
  if (params.classification === "manual_review_required") {
    if (
      params.proposedGeneration !== null ||
      params.operations.length !== 0 ||
      params.reasons.length === 0
    ) {
      fail(params.code);
    }
    if (
      incomplete &&
      !params.reasons.some((reason) => reason.code === "inventory_incomplete")
    ) {
      fail(params.code);
    }
    return;
  }
  if (params.classification === "blocked_active_removal") {
    const active = params.reasons[0];
    const activePath = active?.documentPath?.split("/") ?? [];
    if (
      params.proposedGeneration !== null ||
      params.operations.length !== 0 ||
      params.reasons.length !== 1 ||
      active?.code !== "active_removal_job" ||
      active.storageObjectName !== null ||
      typeof active.existingGeneration !== "number" ||
      activePath.length !== 2 ||
      activePath[0] !== "private_owner_record_removal_jobs" ||
      !validDocumentId(activePath[1] ?? "") ||
      !completeInventory
    ) {
      fail(params.code);
    }
    return;
  }
  if (
    params.proposedGeneration !== null ||
    params.operations.length !== 0 ||
    params.reasons.length !== 0 ||
    !completeInventory
  ) {
    fail(params.code);
  }
}

type ValidatedPlanCore = Omit<OwnerRecordGenerationMigrationPlan, "planHash">;

function parsePlanCore(
  value: unknown,
  includesPlanId: boolean,
  code: "invalid-request" | "invalid-state",
): ValidatedPlanCore {
  const keys = [
    "schemaVersion",
    "projectId",
    "generatedAt",
    "plannerVersion",
    "sourceCheckpointCommit",
    ...(includesPlanId ? ["planId"] : []),
    "ownerUid",
    "canonicalAccountPath",
    "classification",
    "proposedGeneration",
    "operations",
    "manualReviewReasons",
    "pagination",
  ];
  const data = record(value, keys, code);
  if (
    data.schemaVersion !== ownerRecordGenerationMigrationPlanVersion ||
    data.plannerVersion !== ownerRecordGenerationMigrationPlannerVersion ||
    data.sourceCheckpointCommit !==
      ownerRecordGenerationMigrationSourceCheckpointCommit
  ) {
    return fail(code);
  }
  const ownerUid = exactUid(data.ownerUid, code);
  const canonicalAccountPath = exactAllowlistedFirestorePath(
    data.canonicalAccountPath,
    ownerUid,
    code,
  );
  if (canonicalAccountPath !== "restaurant_accounts/" + ownerUid) {
    return fail(code);
  }
  const parsedClassification = classification(data.classification, code);
  const proposedGeneration = nullableGeneration(data.proposedGeneration, code);
  if (
    !Array.isArray(data.operations) ||
    !Array.isArray(data.manualReviewReasons) ||
    !Array.isArray(data.pagination)
  ) {
    return fail(code);
  }
  const operationGeneration = proposedGeneration ??
    canonicalInitialOwnerRecordGeneration;
  const operations = normalizedUnique(
    data.operations.map((entry) => parseOperation(
      entry,
      ownerUid,
      operationGeneration,
      code,
    )),
    code,
  );
  const operationTargets = operations.map((operation) =>
    operation.operation === "stamp_storage_object_metadata"
      ? `storage:${operation.objectName}`
      : `firestore:${operation.documentPath}`);
  if (new Set(operationTargets).size !== operationTargets.length) {
    return fail(code);
  }
  const reasons = normalizedUnique(
    data.manualReviewReasons.map((entry) => parseManualReviewReason(
      entry,
      ownerUid,
      code,
    )),
    code,
  );
  const pagination = normalizedUnique(
    data.pagination.map((entry) => parsePaginationState(entry, code)),
    code,
  );
  if (new Set(pagination.map((entry) => entry.scope)).size !== pagination.length) {
    return fail(code);
  }
  validateClassificationInvariants({
    classification: parsedClassification,
    proposedGeneration,
    operations,
    reasons,
    pagination,
    code,
  });
  const coreWithoutPlanId = Object.freeze({
    schemaVersion: ownerRecordGenerationMigrationPlanVersion,
    projectId: projectId(data.projectId, code),
    generatedAt: timestamp(data.generatedAt, code),
    plannerVersion: ownerRecordGenerationMigrationPlannerVersion,
    sourceCheckpointCommit:
      ownerRecordGenerationMigrationSourceCheckpointCommit,
    ownerUid,
    canonicalAccountPath,
    classification: parsedClassification,
    proposedGeneration,
    operations,
    manualReviewReasons: reasons,
    pagination,
  });
  const planId = includesPlanId
    ? fingerprint(data.planId, code)
    : semanticPlanId(coreWithoutPlanId);
  return Object.freeze({...coreWithoutPlanId, planId});
}

function semanticPlanId(
  input: OwnerRecordGenerationMigrationPlanInput,
): string {
  return sha256("bitestar.owner-record-generation-migration-plan-id.v1", {
    schemaVersion: input.schemaVersion,
    projectId: input.projectId,
    plannerVersion: input.plannerVersion,
    sourceCheckpointCommit: input.sourceCheckpointCommit,
    ownerUid: input.ownerUid,
    canonicalAccountPath: input.canonicalAccountPath,
    classification: input.classification,
    proposedGeneration: input.proposedGeneration,
    operations: input.operations,
    manualReviewReasons: input.manualReviewReasons,
  });
}

/**
 * Stable semantic identity. generatedAt and scan bookkeeping are deliberately
 * excluded; every proposed operation and concurrency precondition is bound.
 */
export function createOwnerRecordGenerationMigrationPlanId(
  input: OwnerRecordGenerationMigrationPlanInput,
): string {
  const core = parsePlanCore(input, false, "invalid-request");
  return core.planId;
}

export function createOwnerRecordGenerationMigrationPlanHash(
  plan: Omit<OwnerRecordGenerationMigrationPlan, "planHash">,
): string {
  return sha256("bitestar.owner-record-generation-migration-plan-hash.v1", plan);
}

/** Builds a canonical frozen plan. It performs no I/O and grants no authority. */
export function buildOwnerRecordGenerationMigrationPlan(
  input: OwnerRecordGenerationMigrationPlanInput,
): OwnerRecordGenerationMigrationPlan {
  const core = parsePlanCore(input, false, "invalid-request");
  const planHash = createOwnerRecordGenerationMigrationPlanHash(core);
  return Object.freeze({...core, planHash});
}

/** Strict parser for a machine-readable plan with exact-key and hash checks. */
export function parseOwnerRecordGenerationMigrationPlan(
  value: unknown,
): OwnerRecordGenerationMigrationPlan {
  const data = record(value, [
    "schemaVersion",
    "projectId",
    "generatedAt",
    "plannerVersion",
    "sourceCheckpointCommit",
    "planId",
    "planHash",
    "ownerUid",
    "canonicalAccountPath",
    "classification",
    "proposedGeneration",
    "operations",
    "manualReviewReasons",
    "pagination",
  ], "invalid-state");
  const coreInput = {...data};
  delete coreInput.planHash;
  const core = parsePlanCore(coreInput, true, "invalid-state");
  const expectedPlanId = semanticPlanId(core);
  const expectedPlanHash = createOwnerRecordGenerationMigrationPlanHash(core);
  if (
    core.planId !== expectedPlanId ||
    fingerprint(data.planHash, "invalid-state") !== expectedPlanHash
  ) {
    return fail("invalid-state");
  }
  return Object.freeze({...core, planHash: expectedPlanHash});
}

/** Builds an aggregate-only summary containing no owner or path identifiers. */
export function buildOwnerRecordGenerationMigrationRedactedSummary(
  rawPlans: readonly unknown[],
): OwnerRecordGenerationMigrationRedactedSummary {
  if (!Array.isArray(rawPlans)) {
    return fail("invalid-request");
  }
  let plans: OwnerRecordGenerationMigrationPlan[];
  try {
    plans = rawPlans.map(parseOwnerRecordGenerationMigrationPlan);
  } catch {
    return fail("invalid-request");
  }
  const planIds = new Set(plans.map((plan) => plan.planId));
  if (planIds.size !== plans.length) {
    return fail("invalid-request");
  }
  const classificationCounts = Object.fromEntries(
    ownerRecordGenerationMigrationClassifications.map((entry) => [entry, 0]),
  ) as Record<OwnerRecordGenerationMigrationClassification, number>;
  const reasonCounts =
    new Map<OwnerRecordGenerationMigrationReasonCode, number>();
  let createOwnerStates = 0;
  let firestoreDocuments = 0;
  let storageObjects = 0;
  let incompletePaginationScopeCount = 0;
  for (const plan of plans) {
    classificationCounts[plan.classification] += 1;
    for (const operation of plan.operations) {
      if (operation.operation === "create_owner_state") {
        createOwnerStates += 1;
      } else if (operation.operation === "stamp_firestore_document") {
        firestoreDocuments += 1;
      } else {
        storageObjects += 1;
      }
    }
    for (const reason of plan.manualReviewReasons) {
      reasonCounts.set(reason.code, (reasonCounts.get(reason.code) ?? 0) + 1);
    }
    incompletePaginationScopeCount += plan.pagination.filter(
      (entry) => !entry.complete,
    ).length;
  }
  const manualReviewReasonCounts = [...reasonCounts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([code, count]) => Object.freeze({code, count}));
  return Object.freeze({
    schemaVersion: ownerRecordGenerationMigrationSummaryVersion,
    planCount: plans.length,
    classificationCounts: Object.freeze(classificationCounts),
    operationCounts: Object.freeze({
      createOwnerStates,
      firestoreDocuments,
      storageObjects,
    }),
    manualReviewReasonCounts: Object.freeze(manualReviewReasonCounts),
    incompletePaginationScopeCount,
  });
}
