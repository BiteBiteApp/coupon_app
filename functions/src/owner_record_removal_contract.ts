import {createHash} from "node:crypto";

import {
  requireOwnerRecordGeneration,
  requireOwnerRecordUid,
} from "./owner_record_state_contract.js";

export const ownerRecordRemovalJobCollection =
  "private_owner_record_removal_jobs" as const;
export const ownerRecordRemovalJobVersion =
  "bitestar.owner-record-removal-job.v1" as const;
export const ownerRecordRemovalOperation = "ownerRecordRemoval" as const;

export const ownerRecordRemovalStatuses = Object.freeze([
  "active",
  "retryable",
  "manual_review_required",
  "complete",
] as const);
export type OwnerRecordRemovalStatus =
  typeof ownerRecordRemovalStatuses[number];

export const ownerRecordRemovalPhases = Object.freeze([
  "billing_gate",
  "unclaim_rating_restaurants",
  "delete_coupons",
  "delete_daily_specials",
  "delete_coupon_number_reservations",
  "delete_coupon_code_reservations",
  "delete_account_menu_images",
  "delete_account_menu_items",
  "delete_account_menu_sections",
  "delete_storage_restaurant_images",
  "delete_storage_coupon_images",
  "delete_storage_menu_images",
  "delete_subscription_return_state",
  "delete_account_root",
  "verify_remnants",
  "finalize_owner_state",
  "complete",
] as const);
export type OwnerRecordRemovalPhase =
  typeof ownerRecordRemovalPhases[number];

export const ownerRecordRemovalFailureCategories = Object.freeze([
  "billing_resolution_required",
  "billing_state_unknown",
  "temporary_dependency",
  "operation_conflict",
  "malformed_private_state",
  "self_target_forbidden",
  "target_admin_forbidden",
  "generation_mismatch",
  "generation_exhausted",
  "restaurant_lock_conflict",
  "newer_generation_record_found",
  "record_generation_missing",
  "storage_generation_mismatch",
  "unsupported_partial_state",
] as const);
export type OwnerRecordRemovalFailureCategory =
  typeof ownerRecordRemovalFailureCategories[number];

export type OwnerRecordRemovalBillingGateCategory =
  | "inactive"
  | "blocking"
  | "unknown";

export const ownerRecordRemovalCounterFields = Object.freeze([
  "ratingRestaurantsUnclaimed",
  "couponsDeleted",
  "dailySpecialsDeleted",
  "couponNumberReservationsDeleted",
  "couponCodeReservationsDeleted",
  "accountMenuImagesDeleted",
  "accountMenuItemsDeleted",
  "accountMenuSectionsDeleted",
  "storageRestaurantImagesDeleted",
  "storageCouponImagesDeleted",
  "storageMenuImagesDeleted",
  "subscriptionReturnDocumentsDeleted",
  "accountRootsDeleted",
] as const);
export type OwnerRecordRemovalCounterField =
  typeof ownerRecordRemovalCounterFields[number];

export type OwnerRecordRemovalCounters = Readonly<{
  ratingRestaurantsUnclaimed: number;
  couponsDeleted: number;
  dailySpecialsDeleted: number;
  couponNumberReservationsDeleted: number;
  couponCodeReservationsDeleted: number;
  accountMenuImagesDeleted: number;
  accountMenuItemsDeleted: number;
  accountMenuSectionsDeleted: number;
  storageRestaurantImagesDeleted: number;
  storageCouponImagesDeleted: number;
  storageMenuImagesDeleted: number;
  subscriptionReturnDocumentsDeleted: number;
  accountRootsDeleted: number;
}>;

export type OwnerRecordRemovalJobDocument = OwnerRecordRemovalCounters &
Readonly<{
  version: typeof ownerRecordRemovalJobVersion;
  operation: typeof ownerRecordRemovalOperation;
  jobId: string;
  requestId: string;
  callerFingerprint: string;
  targetUid: string;
  status: OwnerRecordRemovalStatus;
  phase: OwnerRecordRemovalPhase;
  sourceGeneration: number;
  completionGeneration: number | null;
  cutoverApplied: boolean;
  billingGateCategory: OwnerRecordRemovalBillingGateCategory;
  failureCategory: OwnerRecordRemovalFailureCategory | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  fingerprint: string;
}>;

export type OwnerRecordRemovalJobStoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type OwnerRecordRemovalJobCore = Omit<
  OwnerRecordRemovalJobDocument,
  "version" | "fingerprint"
>;

export type OwnerRecordRemovalClaimRequest = Readonly<{
  contractVersion: typeof ownerRecordRemovalJobVersion;
  operation: typeof ownerRecordRemovalOperation;
  requestId: string;
  callerUid: string;
  targetUid: string;
}>;

export type OwnerRecordRemovalResumeRequest =
  OwnerRecordRemovalClaimRequest & Readonly<{jobId: string}>;

export class OwnerRecordRemovalContractError extends Error {
  public readonly code: "invalid-request" | "invalid-state";

  public constructor(code: "invalid-request" | "invalid-state") {
    super(code === "invalid-state"
      ? "Stored owner-record-removal state is invalid."
      : "Owner-record-removal request is invalid.");
    this.name = "OwnerRecordRemovalContractError";
    this.code = code;
  }
}

const coreKeys = Object.freeze([
  "operation",
  "jobId",
  "requestId",
  "callerFingerprint",
  "targetUid",
  "status",
  "phase",
  "sourceGeneration",
  "completionGeneration",
  "cutoverApplied",
  "billingGateCategory",
  "failureCategory",
  ...ownerRecordRemovalCounterFields,
  "createdAt",
  "updatedAt",
  "completedAt",
] as const);

const mutableJobKeys = Object.freeze([
  "status",
  "phase",
  "completionGeneration",
  "cutoverApplied",
  "billingGateCategory",
  "failureCategory",
  ...ownerRecordRemovalCounterFields,
  "completedAt",
  "now",
] as const);

const statusSet: ReadonlySet<string> = new Set(ownerRecordRemovalStatuses);
const phaseSet: ReadonlySet<string> = new Set(ownerRecordRemovalPhases);
const failureSet: ReadonlySet<string> =
  new Set(ownerRecordRemovalFailureCategories);
const billingGateSet: ReadonlySet<string> =
  new Set(["inactive", "blocking", "unknown"]);
const fingerprintPattern = /^[a-f0-9]{64}$/u;
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function fail(code: "invalid-request" | "invalid-state"): never {
  throw new OwnerRecordRemovalContractError(code);
}

function isPlainRecord(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<PropertyKey, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length &&
    expected.every((key) => actual.includes(key));
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

function exactRequestId(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (
    typeof value !== "string" ||
    !requestIdPattern.test(value) ||
    Buffer.byteLength(value, "utf8") > 128
  ) {
    return fail(code);
  }
  return value;
}

function exactJobId(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (typeof value !== "string" || !fingerprintPattern.test(value)) {
    return fail(code);
  }
  return value;
}

function exactFingerprint(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (typeof value !== "string" || !fingerprintPattern.test(value)) {
    return fail(code);
  }
  return value;
}

function status(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordRemovalStatus {
  if (typeof value !== "string" || !statusSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordRemovalStatus;
}

function phase(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordRemovalPhase {
  if (typeof value !== "string" || !phaseSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordRemovalPhase;
}

function billingGateCategory(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordRemovalBillingGateCategory {
  if (typeof value !== "string" || !billingGateSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordRemovalBillingGateCategory;
}

function nullableFailureCategory(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordRemovalFailureCategory | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !failureSet.has(value)) {
    return fail(code);
  }
  return value as OwnerRecordRemovalFailureCategory;
}

function nonnegativeCounter(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(code);
  }
  return value;
}

function timestamp(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): Date {
  let parsed: unknown = value;
  if (!(parsed instanceof Date)) {
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as {toDate?: unknown}).toDate !== "function"
    ) {
      return fail(code);
    }
    try {
      parsed = ((parsed as {toDate(): unknown}).toDate)();
    } catch {
      return fail(code);
    }
  }
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) {
    return fail(code);
  }
  return new Date(parsed.getTime());
}

function nullableTimestamp(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): Date | null {
  return value === null ? null : timestamp(value, code);
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return {"$date": value.toISOString()};
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function jobFingerprint(core: OwnerRecordRemovalJobCore): string {
  return sha256({
    version: ownerRecordRemovalJobVersion,
    core,
  });
}

function readCounters(
  data: Record<PropertyKey, unknown>,
  code: "invalid-request" | "invalid-state",
): OwnerRecordRemovalCounters {
  return Object.freeze({
    ratingRestaurantsUnclaimed: nonnegativeCounter(
      data.ratingRestaurantsUnclaimed,
      code,
    ),
    couponsDeleted: nonnegativeCounter(data.couponsDeleted, code),
    dailySpecialsDeleted: nonnegativeCounter(data.dailySpecialsDeleted, code),
    couponNumberReservationsDeleted: nonnegativeCounter(
      data.couponNumberReservationsDeleted,
      code,
    ),
    couponCodeReservationsDeleted: nonnegativeCounter(
      data.couponCodeReservationsDeleted,
      code,
    ),
    accountMenuImagesDeleted: nonnegativeCounter(
      data.accountMenuImagesDeleted,
      code,
    ),
    accountMenuItemsDeleted: nonnegativeCounter(
      data.accountMenuItemsDeleted,
      code,
    ),
    accountMenuSectionsDeleted: nonnegativeCounter(
      data.accountMenuSectionsDeleted,
      code,
    ),
    storageRestaurantImagesDeleted: nonnegativeCounter(
      data.storageRestaurantImagesDeleted,
      code,
    ),
    storageCouponImagesDeleted: nonnegativeCounter(
      data.storageCouponImagesDeleted,
      code,
    ),
    storageMenuImagesDeleted: nonnegativeCounter(
      data.storageMenuImagesDeleted,
      code,
    ),
    subscriptionReturnDocumentsDeleted: nonnegativeCounter(
      data.subscriptionReturnDocumentsDeleted,
      code,
    ),
    accountRootsDeleted: nonnegativeCounter(data.accountRootsDeleted, code),
  });
}

function allCountersZero(counters: OwnerRecordRemovalCounters): boolean {
  return ownerRecordRemovalCounterFields.every((key) => counters[key] === 0);
}

function validateCore(
  value: OwnerRecordRemovalJobCore,
  code: "invalid-request" | "invalid-state",
): void {
  const expectedJobId = createOwnerRecordRemovalJobId({
    targetUid: value.targetUid,
    sourceGeneration: value.sourceGeneration,
  });
  if (
    value.jobId !== expectedJobId ||
    value.updatedAt.getTime() < value.createdAt.getTime()
  ) {
    fail(code);
  }

  const isBillingGate = value.phase === "billing_gate";
  const isComplete = value.phase === "complete";
  if (
    (value.status === "complete") !== isComplete ||
    (value.completedAt !== null) !== isComplete
  ) {
    fail(code);
  }
  if (
    value.completedAt !== null &&
    (value.completedAt.getTime() < value.createdAt.getTime() ||
      value.completedAt.getTime() > value.updatedAt.getTime())
  ) {
    fail(code);
  }

  if (isBillingGate) {
    const expectedFailure = value.billingGateCategory === "blocking"
      ? "billing_resolution_required"
      : value.billingGateCategory === "unknown"
        ? "billing_state_unknown"
        : null;
    if (
      value.status !== "manual_review_required" ||
      value.cutoverApplied !== false ||
      value.completionGeneration !== null ||
      expectedFailure === null ||
      value.failureCategory !== expectedFailure ||
      !allCountersZero(value)
    ) {
      fail(code);
    }
    return;
  }

  if (
    value.cutoverApplied !== true ||
    value.billingGateCategory !== "inactive" ||
    value.sourceGeneration === Number.MAX_SAFE_INTEGER ||
    value.completionGeneration !== value.sourceGeneration + 1 ||
    value.failureCategory === "billing_resolution_required" ||
    value.failureCategory === "billing_state_unknown"
  ) {
    fail(code);
  }
  if (isComplete) {
    if (value.failureCategory !== null) {
      fail(code);
    }
    return;
  }
  if (value.status === "active") {
    if (value.failureCategory !== null) {
      fail(code);
    }
  } else if (
    (value.status !== "retryable" &&
      value.status !== "manual_review_required") ||
    value.failureCategory === null
  ) {
    fail(code);
  }
}

function readCore(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordRemovalJobCore {
  if (!isPlainRecord(value) || !hasExactKeys(value, coreKeys)) {
    return fail(code);
  }
  const createdAt = timestamp(value.createdAt, code);
  const updatedAt = timestamp(value.updatedAt, code);
  const core: OwnerRecordRemovalJobCore = Object.freeze({
    operation: value.operation === ownerRecordRemovalOperation
      ? ownerRecordRemovalOperation
      : fail(code),
    jobId: exactJobId(value.jobId, code),
    requestId: exactRequestId(value.requestId, code),
    callerFingerprint: exactFingerprint(value.callerFingerprint, code),
    targetUid: exactUid(value.targetUid, code),
    status: status(value.status, code),
    phase: phase(value.phase, code),
    sourceGeneration: generation(value.sourceGeneration, code),
    completionGeneration: nullableGeneration(
      value.completionGeneration,
      code,
    ),
    cutoverApplied: typeof value.cutoverApplied === "boolean"
      ? value.cutoverApplied
      : fail(code),
    billingGateCategory: billingGateCategory(
      value.billingGateCategory,
      code,
    ),
    failureCategory: nullableFailureCategory(value.failureCategory, code),
    ...readCounters(value, code),
    createdAt,
    updatedAt,
    completedAt: nullableTimestamp(value.completedAt, code),
  });
  validateCore(core, code);
  return core;
}

export function requireOwnerRecordRemovalRequestId(value: unknown): string {
  return exactRequestId(value, "invalid-request");
}

export function requireOwnerRecordRemovalJobId(value: unknown): string {
  return exactJobId(value, "invalid-request");
}

export function createOwnerRecordRemovalJobId(params: {
  targetUid: unknown;
  sourceGeneration: unknown;
}): string {
  return sha256([
    "bitestar.owner-record-removal-job-id.v1",
    ownerRecordRemovalJobVersion,
    ownerRecordRemovalOperation,
    exactUid(params.targetUid, "invalid-request"),
    generation(params.sourceGeneration, "invalid-request"),
  ]);
}

export function createOwnerRecordRemovalCallerFingerprint(
  callerUid: unknown,
): string {
  return sha256([
    "bitestar.owner-record-removal-caller-fingerprint.v1",
    exactUid(callerUid, "invalid-request"),
  ]);
}

export function ownerRecordRemovalJobPath(jobId: unknown): string {
  return `${ownerRecordRemovalJobCollection}/${
    exactJobId(jobId, "invalid-request")}`;
}

export function createEmptyOwnerRecordRemovalCounters():
OwnerRecordRemovalCounters {
  return Object.freeze({
    ratingRestaurantsUnclaimed: 0,
    couponsDeleted: 0,
    dailySpecialsDeleted: 0,
    couponNumberReservationsDeleted: 0,
    couponCodeReservationsDeleted: 0,
    accountMenuImagesDeleted: 0,
    accountMenuItemsDeleted: 0,
    accountMenuSectionsDeleted: 0,
    storageRestaurantImagesDeleted: 0,
    storageCouponImagesDeleted: 0,
    storageMenuImagesDeleted: 0,
    subscriptionReturnDocumentsDeleted: 0,
    accountRootsDeleted: 0,
  });
}

export function parseOwnerRecordRemovalClaimRequest(
  value: unknown,
): OwnerRecordRemovalClaimRequest {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "contractVersion",
    "operation",
    "requestId",
    "callerUid",
    "targetUid",
  ])) {
    return fail("invalid-request");
  }
  if (
    value.contractVersion !== ownerRecordRemovalJobVersion ||
    value.operation !== ownerRecordRemovalOperation
  ) {
    return fail("invalid-request");
  }
  return Object.freeze({
    contractVersion: ownerRecordRemovalJobVersion,
    operation: ownerRecordRemovalOperation,
    requestId: exactRequestId(value.requestId, "invalid-request"),
    callerUid: exactUid(value.callerUid, "invalid-request"),
    targetUid: exactUid(value.targetUid, "invalid-request"),
  });
}

export function parseOwnerRecordRemovalResumeRequest(
  value: unknown,
): OwnerRecordRemovalResumeRequest {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "contractVersion",
    "operation",
    "requestId",
    "callerUid",
    "targetUid",
    "jobId",
  ])) {
    return fail("invalid-request");
  }
  const common = parseOwnerRecordRemovalClaimRequest({
    contractVersion: value.contractVersion,
    operation: value.operation,
    requestId: value.requestId,
    callerUid: value.callerUid,
    targetUid: value.targetUid,
  });
  return Object.freeze({
    ...common,
    jobId: exactJobId(value.jobId, "invalid-request"),
  });
}

export function buildOwnerRecordRemovalJobDocument(
  value: OwnerRecordRemovalJobCore,
): OwnerRecordRemovalJobDocument {
  const core = readCore(value, "invalid-request");
  return Object.freeze({
    version: ownerRecordRemovalJobVersion,
    ...core,
    fingerprint: jobFingerprint(core),
  });
}

export function parseOwnerRecordRemovalJobDocument(
  document: OwnerRecordRemovalJobStoredDocument | null,
): OwnerRecordRemovalJobDocument | null {
  if (document === null) {
    return null;
  }
  try {
    if (
      !isPlainRecord(document.data) ||
      !hasExactKeys(document.data, ["version", ...coreKeys, "fingerprint"]) ||
      document.data.version !== ownerRecordRemovalJobVersion
    ) {
      return fail("invalid-state");
    }
    const fingerprint = exactFingerprint(
      document.data.fingerprint,
      "invalid-state",
    );
    const coreData: Record<string, unknown> = {...document.data};
    delete coreData.version;
    delete coreData.fingerprint;
    const core = readCore(coreData, "invalid-state");
    if (
      exactJobId(document.id, "invalid-state") !== core.jobId ||
      fingerprint !== jobFingerprint(core)
    ) {
      return fail("invalid-state");
    }
    return Object.freeze({
      version: ownerRecordRemovalJobVersion,
      ...core,
      fingerprint,
    });
  } catch {
    return fail("invalid-state");
  }
}

export type OwnerRecordRemovalJobUpdates = Readonly<Partial<Pick<
  OwnerRecordRemovalJobCore,
  | "status"
  | "phase"
  | "completionGeneration"
  | "cutoverApplied"
  | "billingGateCategory"
  | "failureCategory"
  | OwnerRecordRemovalCounterField
  | "completedAt"
>> & {now: Date}>;

export function rebuildOwnerRecordRemovalJobDocument(
  current: OwnerRecordRemovalJobDocument,
  updates: OwnerRecordRemovalJobUpdates,
): OwnerRecordRemovalJobDocument {
  const validCurrent = parseOwnerRecordRemovalJobDocument({
    id: current.jobId,
    data: current,
  });
  if (
    validCurrent === null ||
    validCurrent.status === "complete" ||
    !isPlainRecord(updates) ||
    !Reflect.ownKeys(updates).every(
      (key) => typeof key === "string" && mutableJobKeys.includes(
        key as typeof mutableJobKeys[number],
      ),
    ) ||
    !Reflect.ownKeys(updates).includes("now")
  ) {
    return fail("invalid-request");
  }
  const now = timestamp(updates.now, "invalid-request");
  if (now.getTime() < validCurrent.updatedAt.getTime()) {
    return fail("invalid-request");
  }
  for (const key of ownerRecordRemovalCounterFields) {
    const updated = updates[key];
    if (
      updated !== undefined &&
      nonnegativeCounter(updated, "invalid-request") < validCurrent[key]
    ) {
      return fail("invalid-request");
    }
  }
  if (
    validCurrent.cutoverApplied && updates.cutoverApplied === false ||
    (validCurrent.completionGeneration !== null &&
      updates.completionGeneration !== undefined &&
      updates.completionGeneration !== validCurrent.completionGeneration)
  ) {
    return fail("invalid-request");
  }
  if (
    updates.cutoverApplied === true && !validCurrent.cutoverApplied &&
    (validCurrent.phase !== "billing_gate" ||
      validCurrent.status !== "manual_review_required" ||
      updates.phase !== "unclaim_rating_restaurants" ||
      updates.status !== "active" ||
      updates.billingGateCategory !== "inactive" ||
      updates.failureCategory !== null ||
      updates.completionGeneration !== validCurrent.sourceGeneration + 1)
  ) {
    return fail("invalid-request");
  }
  if (
    updates.phase === "complete" || updates.status === "complete" ||
    updates.completedAt !== undefined && updates.completedAt !== null
  ) {
    if (
      validCurrent.phase !== "finalize_owner_state" ||
      !(
        validCurrent.status === "active" &&
        validCurrent.failureCategory === null ||
        validCurrent.status === "retryable" &&
        validCurrent.failureCategory === "temporary_dependency"
      ) ||
      updates.phase !== "complete" ||
      updates.status !== "complete" ||
      updates.failureCategory !== undefined && updates.failureCategory !== null ||
      updates.completedAt === undefined || updates.completedAt === null ||
      ownerRecordRemovalCounterFields.some(
        (key) => updates[key] !== undefined && updates[key] !== validCurrent[key],
      )
    ) {
      return fail("invalid-request");
    }
  }
  const currentCore: Record<string, unknown> = {...validCurrent};
  delete currentCore.version;
  delete currentCore.fingerprint;
  const mutableUpdates: Record<string, unknown> = {...updates};
  delete mutableUpdates.now;
  return buildOwnerRecordRemovalJobDocument({
    ...currentCore,
    ...mutableUpdates,
    updatedAt: now,
  } as OwnerRecordRemovalJobCore);
}

export function nextOwnerRecordRemovalPhase(
  current: OwnerRecordRemovalPhase,
): OwnerRecordRemovalPhase | null {
  const parsed = phase(current, "invalid-request");
  const index = ownerRecordRemovalPhases.indexOf(parsed);
  return index === ownerRecordRemovalPhases.length - 1
    ? null
    : ownerRecordRemovalPhases[index + 1];
}

export function ownerRecordRemovalCounterForPhase(
  current: OwnerRecordRemovalPhase,
): OwnerRecordRemovalCounterField | null {
  const parsed = phase(current, "invalid-request");
  const counters: Readonly<Partial<Record<
    OwnerRecordRemovalPhase,
    OwnerRecordRemovalCounterField
  >>> = Object.freeze({
    unclaim_rating_restaurants: "ratingRestaurantsUnclaimed",
    delete_coupons: "couponsDeleted",
    delete_daily_specials: "dailySpecialsDeleted",
    delete_coupon_number_reservations: "couponNumberReservationsDeleted",
    delete_coupon_code_reservations: "couponCodeReservationsDeleted",
    delete_account_menu_images: "accountMenuImagesDeleted",
    delete_account_menu_items: "accountMenuItemsDeleted",
    delete_account_menu_sections: "accountMenuSectionsDeleted",
    delete_storage_restaurant_images: "storageRestaurantImagesDeleted",
    delete_storage_coupon_images: "storageCouponImagesDeleted",
    delete_storage_menu_images: "storageMenuImagesDeleted",
    delete_subscription_return_state: "subscriptionReturnDocumentsDeleted",
    delete_account_root: "accountRootsDeleted",
  });
  return counters[parsed] ?? null;
}
