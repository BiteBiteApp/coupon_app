import {requireAccountWritableInStore} from "./account_deletion_guard.js";
import { randomBytes } from "node:crypto";
import {
  buildCustomerBiteSaverCouponRedemption,
  customerBiteSaverCouponRedemptionPath,
  parseCustomerBiteSaverCouponRedemption,
  type CustomerBiteSaverCanonicalCouponRedemption,
} from "./customer_bitesaver_customer_data_contract.js";
import {
  customerBiteSaverRedemptionTimerMilliseconds,
  customerBiteSaverUsageEvaluationCalendar,
  evaluateCustomerBiteSaverOfferAvailability,
  type CustomerBiteSaverNormalizedUsagePolicy,
  type CustomerBiteSaverUsageState,
} from "./customer_bitesaver_offer_availability.js";
import {
  customerBiteSaverDeterministicId,
} from "./customer_bitesaver_search_cursor.js";
import type {
  CustomerBiteSaverIdentityKeyV1,
} from "./customer_bitesaver_public_identity.js";
import {
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  CustomerBiteSaverContractError,
  privateCustomerBiteSaverActiveSessionCollection,
} from "./customer_bitesaver_search_contract.js";
import type {
  CustomerBiteSaverSearchDatabase,
  CustomerBiteSaverStoredDocument,
  CustomerBiteSaverTransaction,
} from "./customer_bitesaver_search_store.js";
import { createQueryFingerprint } from "./query_fingerprint.js";
import {
  validRestaurantCoordinates,
  type RestaurantCoordinates,
} from "./restaurant_geo_helpers.js";

export const privateCustomerBiteSaverDeviceCouponUsageCollection =
  "private_bitesaver_device_coupon_usage" as const;
export const customerBiteSaverDeviceUsageSchemaVersion = 1 as const;
export const customerBiteSaverDeviceUsePurpose =
  "combinedCouponUse" as const;

const publicRestaurantPattern = /^bsr_[A-Za-z0-9_-]{43}$/u;
const publicOfferPattern = /^bso_[A-Za-z0-9_-]{43}$/u;
const redemptionIdPattern = /^bsrd_[A-Za-z0-9_-]{43}$/u;
const deviceBindingPattern = /^bsdvb_[A-Za-z0-9_-]{43}$/u;
const accountBindingPattern = /^bsab_[A-Za-z0-9_-]{43}$/u;
const outcomeReceiptIdPattern = /^bsduo_[A-Za-z0-9_-]{43}$/u;
const deviceUsageIdPattern = /^bsdu_[A-Za-z0-9_-]{43}$/u;
const logicalRequestIdPattern = /^[A-Za-z0-9_-]{16,128}$/u;
const fingerprintPattern = /^[0-9a-f]{64}$/u;
const deviceUseReasons = new Set<CustomerBiteSaverDeviceUseReason>([
  "available",
  "offerUnavailable",
  "parentUnavailable",
  "inactive",
  "notStarted",
  "expired",
  "wrongDay",
  "outsideTimeWindow",
  "invalidSchedule",
  "typedLocation",
  "outsideProximity",
  "missingFreshLocation",
  "used",
  "usageUnknown",
]);

export type CustomerBiteSaverDeviceUseOrigin = "discovery" | "saved";
export type CustomerBiteSaverDeviceUseReason =
  | "available"
  | "offerUnavailable"
  | "parentUnavailable"
  | "inactive"
  | "notStarted"
  | "expired"
  | "wrongDay"
  | "outsideTimeWindow"
  | "invalidSchedule"
  | "typedLocation"
  | "outsideProximity"
  | "missingFreshLocation"
  | "used"
  | "usageUnknown";

export type CustomerBiteSaverCombinedUseRequest = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  logicalRequestId: string;
  restaurantId: string;
  offerId: string;
  timeZone: string;
  utcOffsetMinutes: number;
  currentCoordinates: Readonly<{
    latitude: number;
    longitude: number;
    capturedAtMillis: number;
  }> | null;
  origin:
    | Readonly<{
        kind: "discovery";
        clientInstanceId: string;
        sessionId: string;
        capability: string;
        criteriaFingerprint: string;
        offerOccurrence: string;
        guestStateRevision: number | null;
      }>
    | Readonly<{
        kind: "saved";
        accessToken: string;
      }>;
}>;

export type CustomerBiteSaverVerifiedDeviceEvidence = Readonly<{
  state: "verified";
  /** Stable, private, app-scoped subject returned only by a trusted verifier. */
  deviceSubject: string;
  requestFingerprint: string;
  authenticatedUserId: string | null;
  validFromMillis: number;
  validUntilMillis: number;
}>;

export type CustomerBiteSaverDeviceEvidenceDecision =
  | CustomerBiteSaverVerifiedDeviceEvidence
  | Readonly<{state: "unavailable" | "invalid"}>;

/**
 * This is the intentionally unfinished platform boundary. A future callable
 * must construct it around Android/iOS credential and attestation evidence.
 * There is deliberately no default implementation in production wiring.
 */
export interface CustomerBiteSaverDeviceEvidenceVerifier {
  verify(input: Readonly<{
    purpose: typeof customerBiteSaverDeviceUsePurpose;
    requestFingerprint: string;
    authenticatedUserId: string | null;
    origin: CustomerBiteSaverDeviceUseOrigin;
    nowMillis: number;
  }>): Promise<CustomerBiteSaverDeviceEvidenceDecision>;
}

export type CustomerBiteSaverDeviceUseResult = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  restaurantId: string;
  offerId: string;
  status: "started" | "active" | "unlimited" | "denied";
  reason: CustomerBiteSaverDeviceUseReason;
  redemptionId: string | null;
  timerStartedAtMillis: number | null;
  timerExpiresAtMillis: number | null;
  evaluatedAtMillis: number;
}>;

export type CustomerBiteSaverFreshUseSource = Readonly<{
  offer: Readonly<Record<string, unknown>>;
  usagePolicy: CustomerBiteSaverNormalizedUsagePolicy;
  timeZone: string;
  utcOffsetMinutes: number;
  locationMode: "current" | "typed";
  restaurantCoordinates: RestaurantCoordinates;
  currentCoordinates: CustomerBiteSaverCombinedUseRequest["currentCoordinates"];
}>;

export type CustomerBiteSaverFreshUseAuthorityDecision =
  | Readonly<{
      kind: "authorized";
      origin: CustomerBiteSaverDeviceUseOrigin;
      signedUserId: string | null;
      restaurantId: string;
      offerId: string;
      freshUseExpiresAtMillis: number;
      recoveryExpiresAtMillis: number;
      source: CustomerBiteSaverFreshUseSource;
      applyAfterReads?: (
        transaction: CustomerBiteSaverTransaction,
        nowMillis: number,
      ) => void;
    }>
  | Readonly<{
      kind: "denied";
      origin: CustomerBiteSaverDeviceUseOrigin;
      signedUserId: string | null;
      restaurantId: string;
      offerId: string;
      freshUseExpiresAtMillis: number;
      recoveryExpiresAtMillis: number;
      reason: CustomerBiteSaverDeviceUseReason;
      applyAfterReads?: (
        transaction: CustomerBiteSaverTransaction,
        nowMillis: number,
      ) => void;
    }>;

export type CustomerBiteSaverPreparedFreshUseAuthority = Readonly<{
  origin: CustomerBiteSaverDeviceUseOrigin;
  signedUserId: string | null;
  readInTransaction(
    transaction: CustomerBiteSaverTransaction,
    nowMillis: number,
  ): Promise<CustomerBiteSaverFreshUseAuthorityDecision>;
}>;

export type CustomerBiteSaverFreshUseAuthorityPreparer = (
  request: CustomerBiteSaverCombinedUseRequest,
  context: CustomerBiteSaverDeviceUseContext,
  nowMillis: number,
) => Promise<CustomerBiteSaverPreparedFreshUseAuthority>;

export type CustomerBiteSaverDeviceUseContext = Readonly<{
  database: CustomerBiteSaverSearchDatabase;
  discoveryKey: Uint8Array;
  identityKeyV1?: CustomerBiteSaverIdentityKeyV1;
  identity: Readonly<{
    authUid: string | null;
    authIsAnonymous: boolean;
  }>;
  deviceEvidenceVerifier?: CustomerBiteSaverDeviceEvidenceVerifier;
  now?: () => number;
  randomSource?: (size: number) => Uint8Array;
}>;

type CustomerBiteSaverDeviceCouponUsage = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverDeviceUsageSchemaVersion;
  role: "deviceCouponUsage";
  state: "limited";
  deviceBinding: string;
  restaurantId: string;
  offerId: string;
  redemptionId: string;
  timerStartedAt: Date;
  timerExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}>;

type CustomerBiteSaverDeviceUseOutcomeReceipt = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverDeviceUsageSchemaVersion;
  role: "deviceUseOutcomeReceipt";
  state: "complete";
  purpose: typeof customerBiteSaverDeviceUsePurpose;
  origin: CustomerBiteSaverDeviceUseOrigin;
  deviceBinding: string;
  accountBinding: string | null;
  logicalRequestId: string;
  requestFingerprint: string;
  restaurantId: string;
  offerId: string;
  response: CustomerBiteSaverDeviceUseResult;
  responseFingerprint: string;
  createdAt: Date;
  logicalExpiresAt: Date;
  expiresAt: Date;
}>;

const deviceUsageKeys = Object.freeze([
  "createdAt",
  "deviceBinding",
  "offerId",
  "protocolVersion",
  "redemptionId",
  "restaurantId",
  "role",
  "schemaVersion",
  "state",
  "timerExpiresAt",
  "timerStartedAt",
  "updatedAt",
].sort());

const outcomeReceiptKeys = Object.freeze([
  "accountBinding",
  "createdAt",
  "deviceBinding",
  "expiresAt",
  "logicalExpiresAt",
  "logicalRequestId",
  "offerId",
  "origin",
  "protocolVersion",
  "purpose",
  "requestFingerprint",
  "response",
  "responseFingerprint",
  "restaurantId",
  "role",
  "schemaVersion",
  "state",
].sort());

const resultKeys = Object.freeze([
  "evaluatedAtMillis",
  "offerId",
  "reason",
  "redemptionId",
  "restaurantId",
  "schemaVersion",
  "status",
  "timerExpiresAtMillis",
  "timerStartedAtMillis",
].sort());

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function validUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function dateValue(value: unknown): Date | null {
  let candidate: unknown = value;
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const toDate = (value as {toDate?: unknown}).toDate;
    if (typeof toDate !== "function") return null;
    try {
      candidate = toDate.call(value);
    } catch {
      return null;
    }
  }
  if (!(candidate instanceof Date)) return null;
  const millis = candidate.getTime();
  return Number.isSafeInteger(millis) && millis >= 0
    ? new Date(millis)
    : null;
}

function invalidRequest(message = "The BiteSaver use request is invalid."): never {
  throw new CustomerBiteSaverContractError("invalid-argument", message);
}

function validSignedUserId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value !== "." && value !== ".." && !/^__.*__$/u.test(value) &&
    !value.includes("/") && validUtf16(value) &&
    Buffer.byteLength(value, "utf8") <= 1_500;
}

export function customerBiteSaverSignedUserId(
  identity: CustomerBiteSaverDeviceUseContext["identity"],
): string | null {
  if (identity.authUid === null || identity.authIsAnonymous) return null;
  if (!validSignedUserId(identity.authUid)) {
    throw new CustomerBiteSaverContractError("permission-denied");
  }
  return identity.authUid;
}

function requireSecretKey(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "BiteSaver device usage is not configured.",
    );
  }
}

function parseCoordinates(
  value: unknown,
): CustomerBiteSaverCombinedUseRequest["currentCoordinates"] {
  if (value === null) return null;
  if (!isPlainRecord(value) || !exactKeys(value, [
    "capturedAtMillis",
    "latitude",
    "longitude",
  ])) {
    return invalidRequest("The BiteSaver use location is invalid.");
  }
  const coordinates = validRestaurantCoordinates(
    value.latitude,
    value.longitude,
  );
  if (
    coordinates === null ||
    typeof value.capturedAtMillis !== "number" ||
    !Number.isSafeInteger(value.capturedAtMillis) ||
    value.capturedAtMillis < 0
  ) {
    return invalidRequest("The BiteSaver use location is invalid.");
  }
  return Object.freeze({
    ...coordinates,
    capturedAtMillis: value.capturedAtMillis,
  });
}

export function parseCustomerBiteSaverCombinedUseRequest(
  value: unknown,
): CustomerBiteSaverCombinedUseRequest {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "currentCoordinates",
    "logicalRequestId",
    "offerId",
    "origin",
    "restaurantId",
    "schemaVersion",
    "timeZone",
    "utcOffsetMinutes",
  ]) || value.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    typeof value.logicalRequestId !== "string" ||
    !logicalRequestIdPattern.test(value.logicalRequestId) ||
    typeof value.restaurantId !== "string" ||
    !publicRestaurantPattern.test(value.restaurantId) ||
    typeof value.offerId !== "string" ||
    !publicOfferPattern.test(value.offerId) ||
    typeof value.timeZone !== "string" || value.timeZone.length === 0 ||
    value.timeZone.length > 100 || value.timeZone.trim() !== value.timeZone ||
    typeof value.utcOffsetMinutes !== "number" ||
    !Number.isSafeInteger(value.utcOffsetMinutes) ||
    value.utcOffsetMinutes < -840 || value.utcOffsetMinutes > 840 ||
    !isPlainRecord(value.origin)
  ) {
    return invalidRequest();
  }
  let origin: CustomerBiteSaverCombinedUseRequest["origin"];
  if (value.origin.kind === "discovery") {
    if (!exactKeys(value.origin, [
      "capability",
      "clientInstanceId",
      "criteriaFingerprint",
      "guestStateRevision",
      "kind",
      "offerOccurrence",
      "sessionId",
    ]) || typeof value.origin.clientInstanceId !== "string" ||
      !logicalRequestIdPattern.test(value.origin.clientInstanceId) ||
      typeof value.origin.sessionId !== "string" ||
      !/^bss_[A-Za-z0-9_-]{43}$/u.test(value.origin.sessionId) ||
      typeof value.origin.capability !== "string" ||
      value.origin.capability.length > 32_768 ||
      typeof value.origin.criteriaFingerprint !== "string" ||
      !fingerprintPattern.test(value.origin.criteriaFingerprint) ||
      typeof value.origin.offerOccurrence !== "string" ||
      value.origin.offerOccurrence.length > 32_768 ||
      (value.origin.guestStateRevision !== null &&
        (typeof value.origin.guestStateRevision !== "number" ||
          !Number.isSafeInteger(value.origin.guestStateRevision) ||
          value.origin.guestStateRevision < 0))
    ) {
      return invalidRequest("The BiteSaver discovery authority is invalid.");
    }
    origin = Object.freeze({
      kind: "discovery",
      clientInstanceId: value.origin.clientInstanceId,
      sessionId: value.origin.sessionId,
      capability: value.origin.capability,
      criteriaFingerprint: value.origin.criteriaFingerprint,
      offerOccurrence: value.origin.offerOccurrence,
      guestStateRevision: value.origin.guestStateRevision as number | null,
    });
  } else if (value.origin.kind === "saved") {
    if (!exactKeys(value.origin, ["accessToken", "kind"]) ||
      typeof value.origin.accessToken !== "string" ||
      value.origin.accessToken.length === 0 ||
      value.origin.accessToken.length > 32_768
    ) {
      return invalidRequest("The BiteSaver Saved authority is invalid.");
    }
    origin = Object.freeze({
      kind: "saved",
      accessToken: value.origin.accessToken,
    });
  } else {
    return invalidRequest("The BiteSaver use origin is invalid.");
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    logicalRequestId: value.logicalRequestId,
    restaurantId: value.restaurantId,
    offerId: value.offerId,
    timeZone: value.timeZone,
    utcOffsetMinutes: value.utcOffsetMinutes,
    currentCoordinates: parseCoordinates(value.currentCoordinates),
    origin,
  });
}

export function customerBiteSaverCombinedUseRequestFingerprint(
  request: CustomerBiteSaverCombinedUseRequest,
): string {
  return createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    purpose: customerBiteSaverDeviceUsePurpose,
    logicalRequestId: request.logicalRequestId,
    restaurantId: request.restaurantId,
    offerId: request.offerId,
    timeZone: request.timeZone,
    utcOffsetMinutes: request.utcOffsetMinutes,
    currentCoordinates: request.currentCoordinates === null
      ? null
      : {
          latitude: String(request.currentCoordinates.latitude),
          longitude: String(request.currentCoordinates.longitude),
          capturedAtMillis: request.currentCoordinates.capturedAtMillis,
        },
    origin: request.origin,
  });
}

function deviceBinding(key: Uint8Array, subject: string): string {
  return customerBiteSaverDeterministicId(
    key,
    "bsdvb",
    "verifiedDeviceSubject",
    [subject],
  );
}

function accountBinding(key: Uint8Array, userId: string | null): string | null {
  return userId === null
    ? null
    : customerBiteSaverDeterministicId(
        key,
        "bsab",
        "deviceUseAccount",
        [userId],
      );
}

export function customerBiteSaverDeviceCouponUsageDocumentId(value: {
  secretKey: Uint8Array;
  deviceBinding: string;
  offerId: string;
}): string {
  requireSecretKey(value.secretKey);
  if (!deviceBindingPattern.test(value.deviceBinding) ||
    !publicOfferPattern.test(value.offerId)
  ) {
    return invalidRequest();
  }
  return customerBiteSaverDeterministicId(
    value.secretKey,
    "bsdu",
    "deviceCouponUsage",
    [value.deviceBinding, value.offerId],
  );
}

export function customerBiteSaverDeviceCouponUsagePath(value: {
  secretKey: Uint8Array;
  deviceBinding: string;
  offerId: string;
}): string {
  return `${privateCustomerBiteSaverDeviceCouponUsageCollection}/` +
    customerBiteSaverDeviceCouponUsageDocumentId(value);
}

export function customerBiteSaverDeviceUseOutcomeReceiptId(value: {
  secretKey: Uint8Array;
  deviceBinding: string;
  logicalRequestId: string;
}): string {
  requireSecretKey(value.secretKey);
  if (!deviceBindingPattern.test(value.deviceBinding) ||
    !logicalRequestIdPattern.test(value.logicalRequestId)
  ) {
    return invalidRequest();
  }
  return customerBiteSaverDeterministicId(
    value.secretKey,
    "bsduo",
    "deviceUseOutcomeReceipt",
    [value.deviceBinding, value.logicalRequestId],
  );
}

function outcomeReceiptPath(receiptId: string): string {
  return `${privateCustomerBiteSaverActiveSessionCollection}/${receiptId}`;
}

function parseResult(value: unknown): CustomerBiteSaverDeviceUseResult | null {
  if (!isPlainRecord(value) || !exactKeys(value, resultKeys) ||
    value.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    typeof value.restaurantId !== "string" ||
    !publicRestaurantPattern.test(value.restaurantId) ||
    typeof value.offerId !== "string" ||
    !publicOfferPattern.test(value.offerId) ||
    (value.status !== "started" && value.status !== "active" &&
      value.status !== "unlimited" && value.status !== "denied") ||
    typeof value.reason !== "string" ||
    !deviceUseReasons.has(value.reason as CustomerBiteSaverDeviceUseReason) ||
    typeof value.evaluatedAtMillis !== "number" ||
    !Number.isSafeInteger(value.evaluatedAtMillis) ||
    value.evaluatedAtMillis < 0
  ) {
    return null;
  }
  const timed = value.status === "started" || value.status === "active";
  if (timed) {
    if (typeof value.redemptionId !== "string" ||
      !redemptionIdPattern.test(value.redemptionId) ||
      typeof value.timerStartedAtMillis !== "number" ||
      !Number.isSafeInteger(value.timerStartedAtMillis) ||
      value.timerStartedAtMillis < 0 ||
      typeof value.timerExpiresAtMillis !== "number" ||
      !Number.isSafeInteger(value.timerExpiresAtMillis) ||
      value.timerExpiresAtMillis !== value.timerStartedAtMillis +
        customerBiteSaverRedemptionTimerMilliseconds
    ) {
      return null;
    }
  } else if (value.redemptionId !== null ||
    value.timerStartedAtMillis !== null ||
    value.timerExpiresAtMillis !== null
  ) {
    return null;
  }
  return Object.freeze({...value}) as CustomerBiteSaverDeviceUseResult;
}

function parseOutcomeReceipt(value: {
  document: CustomerBiteSaverStoredDocument | null;
  receiptId: string;
  deviceBinding: string;
  accountBinding: string | null;
  request: CustomerBiteSaverCombinedUseRequest;
  requestFingerprint: string;
  nowMillis: number;
}): CustomerBiteSaverDeviceUseOutcomeReceipt | null {
  const {document} = value;
  if (document === null) return null;
  const data = document.data;
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  const response = parseResult(data.response);
  if (document.id !== value.receiptId ||
    !outcomeReceiptIdPattern.test(document.id) ||
    document.path !== outcomeReceiptPath(value.receiptId) ||
    !exactKeys(data, outcomeReceiptKeys) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverDeviceUsageSchemaVersion ||
    data.role !== "deviceUseOutcomeReceipt" || data.state !== "complete" ||
    data.purpose !== customerBiteSaverDeviceUsePurpose ||
    data.origin !== value.request.origin.kind ||
    data.deviceBinding !== value.deviceBinding ||
    data.accountBinding !== value.accountBinding ||
    (data.accountBinding !== null &&
      (typeof data.accountBinding !== "string" ||
        !accountBindingPattern.test(data.accountBinding))) ||
    data.logicalRequestId !== value.request.logicalRequestId ||
    data.requestFingerprint !== value.requestFingerprint ||
    data.restaurantId !== value.request.restaurantId ||
    data.offerId !== value.request.offerId ||
    typeof data.responseFingerprint !== "string" ||
    !fingerprintPattern.test(data.responseFingerprint) ||
    response === null ||
    data.responseFingerprint !== createQueryFingerprint(response) ||
    response.restaurantId !== value.request.restaurantId ||
    response.offerId !== value.request.offerId ||
    createdAt === null || logicalExpiresAt === null || expiresAt === null ||
    logicalExpiresAt.getTime() <= createdAt.getTime() ||
    expiresAt.getTime() !== logicalExpiresAt.getTime() ||
    value.nowMillis >= logicalExpiresAt.getTime()
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver device-use outcome is invalid or expired.",
    );
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverDeviceUsageSchemaVersion,
    role: "deviceUseOutcomeReceipt",
    state: "complete",
    purpose: customerBiteSaverDeviceUsePurpose,
    origin: value.request.origin.kind,
    deviceBinding: value.deviceBinding,
    accountBinding: value.accountBinding,
    logicalRequestId: value.request.logicalRequestId,
    requestFingerprint: value.requestFingerprint,
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
    response,
    responseFingerprint: data.responseFingerprint as string,
    createdAt,
    logicalExpiresAt,
    expiresAt,
  });
}

function parseDeviceUsage(value: {
  document: CustomerBiteSaverStoredDocument | null;
  expectedPath: string;
  deviceBinding: string;
  restaurantId: string;
  offerId: string;
}): CustomerBiteSaverDeviceCouponUsage | null {
  const {document} = value;
  if (document === null) return null;
  const data = document.data;
  const timerStartedAt = dateValue(data.timerStartedAt);
  const timerExpiresAt = dateValue(data.timerExpiresAt);
  const createdAt = dateValue(data.createdAt);
  const updatedAt = dateValue(data.updatedAt);
  if (document.path !== value.expectedPath ||
    document.id !== value.expectedPath.slice(value.expectedPath.lastIndexOf("/") + 1) ||
    !deviceUsageIdPattern.test(document.id) ||
    !exactKeys(data, deviceUsageKeys) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverDeviceUsageSchemaVersion ||
    data.role !== "deviceCouponUsage" || data.state !== "limited" ||
    data.deviceBinding !== value.deviceBinding ||
    data.restaurantId !== value.restaurantId || data.offerId !== value.offerId ||
    typeof data.redemptionId !== "string" ||
    !redemptionIdPattern.test(data.redemptionId) ||
    timerStartedAt === null || timerExpiresAt === null ||
    createdAt === null || updatedAt === null ||
    timerExpiresAt.getTime() !== timerStartedAt.getTime() +
      customerBiteSaverRedemptionTimerMilliseconds ||
    createdAt.getTime() > timerStartedAt.getTime() ||
    updatedAt.getTime() !== timerStartedAt.getTime()
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver device usage state is invalid.",
    );
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverDeviceUsageSchemaVersion,
    role: "deviceCouponUsage",
    state: "limited",
    deviceBinding: value.deviceBinding,
    restaurantId: value.restaurantId,
    offerId: value.offerId,
    redemptionId: data.redemptionId,
    timerStartedAt,
    timerExpiresAt,
    createdAt,
    updatedAt,
  });
}

function buildDeviceUsage(value: {
  deviceBinding: string;
  restaurantId: string;
  offerId: string;
  redemptionId: string;
  timerStartedAt: Date;
  createdAt: Date;
}): CustomerBiteSaverDeviceCouponUsage {
  const startedAtMillis = value.timerStartedAt.getTime();
  const createdAtMillis = value.createdAt.getTime();
  if (!deviceBindingPattern.test(value.deviceBinding) ||
    !publicRestaurantPattern.test(value.restaurantId) ||
    !publicOfferPattern.test(value.offerId) ||
    !redemptionIdPattern.test(value.redemptionId) ||
    !Number.isSafeInteger(startedAtMillis) || startedAtMillis < 0 ||
    !Number.isSafeInteger(createdAtMillis) || createdAtMillis < 0 ||
    createdAtMillis > startedAtMillis
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const timerStartedAt = new Date(startedAtMillis);
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverDeviceUsageSchemaVersion,
    role: "deviceCouponUsage",
    state: "limited",
    deviceBinding: value.deviceBinding,
    restaurantId: value.restaurantId,
    offerId: value.offerId,
    redemptionId: value.redemptionId,
    timerStartedAt,
    timerExpiresAt: new Date(
      startedAtMillis + customerBiteSaverRedemptionTimerMilliseconds,
    ),
    createdAt: new Date(createdAtMillis),
    updatedAt: new Date(startedAtMillis),
  });
}

function usageState(
  usage: Pick<CustomerBiteSaverDeviceCouponUsage, "redemptionId" |
    "timerStartedAt" | "timerExpiresAt" | "createdAt" | "updatedAt"> | null,
  scope: "device" | "account",
  offerId: string,
): CustomerBiteSaverUsageState {
  return usage === null
    ? Object.freeze({
        known: true,
        lastRedeemedAt: null,
        timerStartedAt: null,
        generation: createQueryFingerprint({scope, offerId, state: "missing"}),
      })
    : Object.freeze({
        known: true,
        lastRedeemedAt: null,
        timerStartedAt: usage.timerStartedAt,
        generation: createQueryFingerprint({
          scope,
          offerId,
          redemptionId: usage.redemptionId,
          timerStartedAtMillis: usage.timerStartedAt.getTime(),
          timerExpiresAtMillis: usage.timerExpiresAt.getTime(),
          createdAtMillis: usage.createdAt.getTime(),
          updatedAtMillis: usage.updatedAt.getTime(),
        }),
      });
}

function sourceDecision(value: {
  source: CustomerBiteSaverFreshUseSource;
  usage: CustomerBiteSaverUsageState;
  nowMillis: number;
}) {
  return evaluateCustomerBiteSaverOfferAvailability({
    offerType: "coupon",
    offer: value.source.offer,
    parentEligible: true,
    now: new Date(value.nowMillis),
    timeZone: value.source.timeZone,
    locationMode: value.source.locationMode,
    restaurantCoordinates: value.source.restaurantCoordinates,
    currentCoordinates: value.source.currentCoordinates,
    currentCoordinatesCapturedAt: value.source.currentCoordinates === null
      ? null
      : new Date(value.source.currentCoordinates.capturedAtMillis),
    usage: value.usage,
    requireFreshLocation: true,
  });
}

function deniedResult(value: {
  request: CustomerBiteSaverCombinedUseRequest;
  reason: CustomerBiteSaverDeviceUseReason;
  evaluatedAtMillis: number;
}): CustomerBiteSaverDeviceUseResult {
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
    status: "denied",
    reason: value.reason,
    redemptionId: null,
    timerStartedAtMillis: null,
    timerExpiresAtMillis: null,
    evaluatedAtMillis: value.evaluatedAtMillis,
  });
}

function timedResult(value: {
  request: CustomerBiteSaverCombinedUseRequest;
  status: "started" | "active";
  usage: Pick<CustomerBiteSaverDeviceCouponUsage, "redemptionId" |
    "timerStartedAt" | "timerExpiresAt">;
  evaluatedAtMillis: number;
}): CustomerBiteSaverDeviceUseResult {
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
    status: value.status,
    reason: "available",
    redemptionId: value.usage.redemptionId,
    timerStartedAtMillis: value.usage.timerStartedAt.getTime(),
    timerExpiresAtMillis: value.usage.timerExpiresAt.getTime(),
    evaluatedAtMillis: value.evaluatedAtMillis,
  });
}

function matchingUsageAnchors(
  left: Pick<CustomerBiteSaverDeviceCouponUsage, "redemptionId" |
    "timerStartedAt" | "timerExpiresAt">,
  right: Pick<CustomerBiteSaverDeviceCouponUsage, "redemptionId" |
    "timerStartedAt" | "timerExpiresAt">,
): boolean {
  return left.redemptionId === right.redemptionId &&
    left.timerStartedAt.getTime() === right.timerStartedAt.getTime() &&
    left.timerExpiresAt.getTime() === right.timerExpiresAt.getTime();
}

async function verifiedEvidence(value: {
  context: CustomerBiteSaverDeviceUseContext;
  request: CustomerBiteSaverCombinedUseRequest;
  requestFingerprint: string;
  signedUserId: string | null;
  nowMillis: number;
}): Promise<CustomerBiteSaverVerifiedDeviceEvidence> {
  const verifier = value.context.deviceEvidenceVerifier;
  if (verifier === undefined) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "Verified BiteSaver device evidence is unavailable.",
    );
  }
  const evidence = await verifier.verify({
    purpose: customerBiteSaverDeviceUsePurpose,
    requestFingerprint: value.requestFingerprint,
    authenticatedUserId: value.signedUserId,
    origin: value.request.origin.kind,
    nowMillis: value.nowMillis,
  });
  if (evidence.state === "unavailable") {
    throw new CustomerBiteSaverContractError(
      "unavailable",
      "Verified BiteSaver device evidence is temporarily unavailable.",
    );
  }
  if (evidence.state !== "verified" ||
    typeof evidence.deviceSubject !== "string" ||
    evidence.deviceSubject.length === 0 ||
    !validUtf16(evidence.deviceSubject) ||
    Buffer.byteLength(evidence.deviceSubject, "utf8") > 512 ||
    evidence.requestFingerprint !== value.requestFingerprint ||
    evidence.authenticatedUserId !== value.signedUserId ||
    !Number.isSafeInteger(evidence.validFromMillis) ||
    !Number.isSafeInteger(evidence.validUntilMillis) ||
    evidence.validFromMillis > value.nowMillis ||
    value.nowMillis >= evidence.validUntilMillis
  ) {
    throw new CustomerBiteSaverContractError(
      "permission-denied",
      "Verified BiteSaver device evidence is invalid.",
    );
  }
  return evidence;
}

function newRedemptionId(context: CustomerBiteSaverDeviceUseContext): string {
  const entropy = (context.randomSource ?? randomBytes)(32);
  if (!(entropy instanceof Uint8Array) || entropy.length !== 32) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  return `bsrd_${Buffer.from(entropy).toString("base64url")}`;
}

function outcomeReceipt(value: {
  request: CustomerBiteSaverCombinedUseRequest;
  requestFingerprint: string;
  deviceBinding: string;
  accountBinding: string | null;
  result: CustomerBiteSaverDeviceUseResult;
  nowMillis: number;
  recoveryExpiresAtMillis: number;
}): CustomerBiteSaverDeviceUseOutcomeReceipt {
  if (value.recoveryExpiresAtMillis <= value.nowMillis) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver use authority expired.",
    );
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverDeviceUsageSchemaVersion,
    role: "deviceUseOutcomeReceipt",
    state: "complete",
    purpose: customerBiteSaverDeviceUsePurpose,
    origin: value.request.origin.kind,
    deviceBinding: value.deviceBinding,
    accountBinding: value.accountBinding,
    logicalRequestId: value.request.logicalRequestId,
    requestFingerprint: value.requestFingerprint,
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
    response: value.result,
    responseFingerprint: createQueryFingerprint(value.result),
    createdAt: new Date(value.nowMillis),
    logicalExpiresAt: new Date(value.recoveryExpiresAtMillis),
    expiresAt: new Date(value.recoveryExpiresAtMillis),
  });
}

function validateAuthority(value: {
  authority: CustomerBiteSaverFreshUseAuthorityDecision;
  request: CustomerBiteSaverCombinedUseRequest;
  signedUserId: string | null;
  nowMillis: number;
}): void {
  const {authority, request} = value;
  if (authority.origin !== request.origin.kind ||
    authority.signedUserId !== value.signedUserId ||
    authority.restaurantId !== request.restaurantId ||
    authority.offerId !== request.offerId ||
    !Number.isSafeInteger(authority.freshUseExpiresAtMillis) ||
    value.nowMillis >= authority.freshUseExpiresAtMillis ||
    !Number.isSafeInteger(authority.recoveryExpiresAtMillis) ||
    value.nowMillis >= authority.recoveryExpiresAtMillis
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver fresh-use authority is invalid or expired.",
    );
  }
  if (authority.kind === "authorized") {
    if (authority.source.timeZone !== request.timeZone ||
      authority.source.utcOffsetMinutes !== request.utcOffsetMinutes ||
      authority.source.currentCoordinates !== request.currentCoordinates
    ) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver fresh-use authority does not match the request.",
      );
    }
  }
}

function assertFinalFences(value: {
  nowMillis: number;
  evidence: CustomerBiteSaverVerifiedDeviceEvidence;
  authority: CustomerBiteSaverFreshUseAuthorityDecision;
}): void {
  if (value.nowMillis >= value.evidence.validUntilMillis) {
    throw new CustomerBiteSaverContractError(
      "unavailable",
      "Verified BiteSaver device evidence expired before the decision.",
    );
  }
  if (value.nowMillis >= value.authority.freshUseExpiresAtMillis) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver fresh-use decision expired before commit.",
    );
  }
  if (value.nowMillis >= value.authority.recoveryExpiresAtMillis) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver use authority expired before the decision.",
    );
  }
}

export async function executeCustomerBiteSaverDeviceBoundUse(
  request: CustomerBiteSaverCombinedUseRequest,
  context: CustomerBiteSaverDeviceUseContext,
  prepareAuthority: CustomerBiteSaverFreshUseAuthorityPreparer,
): Promise<CustomerBiteSaverDeviceUseResult> {
  requireSecretKey(context.discoveryKey);
  const signedUserId = customerBiteSaverSignedUserId(context.identity);
  if (request.origin.kind === "saved" && signedUserId === null) {
    throw new CustomerBiteSaverContractError(
      "permission-denied",
      "Sign in to use a Saved BiteSaver coupon.",
    );
  }
  const requestFingerprint =
    customerBiteSaverCombinedUseRequestFingerprint(request);
  const initialNowMillis = context.now?.() ?? Date.now();
  const evidence = await verifiedEvidence({
    context,
    request,
    requestFingerprint,
    signedUserId,
    nowMillis: initialNowMillis,
  });
  const verifiedDeviceBinding = deviceBinding(
    context.discoveryKey,
    evidence.deviceSubject,
  );
  const verifiedAccountBinding = accountBinding(
    context.discoveryKey,
    signedUserId,
  );
  const receiptId = customerBiteSaverDeviceUseOutcomeReceiptId({
    secretKey: context.discoveryKey,
    deviceBinding: verifiedDeviceBinding,
    logicalRequestId: request.logicalRequestId,
  });
  const receiptPath = outcomeReceiptPath(receiptId);
  const earlyReceipt = parseOutcomeReceipt({
    document: await context.database.getDocument(receiptPath),
    receiptId,
    deviceBinding: verifiedDeviceBinding,
    accountBinding: verifiedAccountBinding,
    request,
    requestFingerprint,
    nowMillis: context.now?.() ?? Date.now(),
  });
  if (earlyReceipt !== null) return earlyReceipt.response;

  // Origin-specific token/session/projection preparation starts only after an
  // outcome miss, so committed recovery is independent of later withdrawal.
  const prepared = await prepareAuthority(request, context, initialNowMillis);
  if (prepared.origin !== request.origin.kind ||
    prepared.signedUserId !== signedUserId
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const proposedRedemptionId = newRedemptionId(context);
  const deviceUsagePath = customerBiteSaverDeviceCouponUsagePath({
    secretKey: context.discoveryKey,
    deviceBinding: verifiedDeviceBinding,
    offerId: request.offerId,
  });
  const signedUsagePath = signedUserId === null
    ? null
    : customerBiteSaverCouponRedemptionPath(signedUserId, request.offerId);

  return context.database.runTransaction(async (transaction) => {
    if (signedUserId !== null) await requireAccountWritableInStore(transaction, signedUserId);
    const receiptDocument = await transaction.getDocument(receiptPath);
    const replayNowMillis = context.now?.() ?? Date.now();
    const replay = parseOutcomeReceipt({
      document: receiptDocument,
      receiptId,
      deviceBinding: verifiedDeviceBinding,
      accountBinding: verifiedAccountBinding,
      request,
      requestFingerprint,
      nowMillis: replayNowMillis,
    });
    if (replay !== null) return replay.response;

    const authorityReadAtMillis = context.now?.() ?? Date.now();
    const authority = await prepared.readInTransaction(
      transaction,
      authorityReadAtMillis,
    );
    validateAuthority({
      authority,
      request,
      signedUserId,
      nowMillis: authorityReadAtMillis,
    });

    if (authority.kind === "denied") {
      const writeNowMillis = context.now?.() ?? Date.now();
      assertFinalFences({nowMillis: writeNowMillis, evidence, authority});
      const result = deniedResult({
        request,
        reason: authority.reason,
        evaluatedAtMillis: writeNowMillis,
      });
      authority.applyAfterReads?.(transaction, writeNowMillis);
      transaction.createDocument(receiptPath, outcomeReceipt({
        request,
        requestFingerprint,
        deviceBinding: verifiedDeviceBinding,
        accountBinding: verifiedAccountBinding,
        result,
        nowMillis: writeNowMillis,
        recoveryExpiresAtMillis: authority.recoveryExpiresAtMillis,
      }));
      return result;
    }

    if (authority.source.usagePolicy === "unlimited") {
      const writeNowMillis = context.now?.() ?? Date.now();
      assertFinalFences({nowMillis: writeNowMillis, evidence, authority});
      let calendar;
      try {
        calendar = customerBiteSaverUsageEvaluationCalendar({
          evaluationAtMillis: writeNowMillis,
          timeZone: authority.source.timeZone,
        });
      } catch {
        return invalidRequest("The customer time context is invalid.");
      }
      if (calendar.utcOffsetMinutes !== authority.source.utcOffsetMinutes) {
        return invalidRequest("The customer time context is stale.");
      }
      const decision = sourceDecision({
        source: authority.source,
        usage: usageState(null, "device", request.offerId),
        nowMillis: writeNowMillis,
      });
      const result = decision.visible && decision.redeemable &&
          (decision.eligibilityExpiresAtMs === null ||
            writeNowMillis < decision.eligibilityExpiresAtMs)
        ? Object.freeze({
            schemaVersion: customerBiteSaverSearchSchemaVersion,
            restaurantId: request.restaurantId,
            offerId: request.offerId,
            status: "unlimited" as const,
            reason: "available",
            redemptionId: null,
            timerStartedAtMillis: null,
            timerExpiresAtMillis: null,
            evaluatedAtMillis: writeNowMillis,
          })
        : deniedResult({
            request,
            reason: decision.reason,
            evaluatedAtMillis: writeNowMillis,
          });
      authority.applyAfterReads?.(transaction, writeNowMillis);
      transaction.createDocument(receiptPath, outcomeReceipt({
        request,
        requestFingerprint,
        deviceBinding: verifiedDeviceBinding,
        accountBinding: verifiedAccountBinding,
        result,
        nowMillis: writeNowMillis,
        recoveryExpiresAtMillis: authority.recoveryExpiresAtMillis,
      }));
      return result;
    }

    const usageDocuments = await transaction.getDocuments([
      deviceUsagePath,
      ...(signedUsagePath === null ? [] : [signedUsagePath]),
    ]);
    const deviceUsage = parseDeviceUsage({
      document: usageDocuments[0],
      expectedPath: deviceUsagePath,
      deviceBinding: verifiedDeviceBinding,
      restaurantId: request.restaurantId,
      offerId: request.offerId,
    });
    let accountUsage: CustomerBiteSaverCanonicalCouponRedemption | null = null;
    if (signedUserId !== null) {
      const accountDocument = usageDocuments[1];
      if (accountDocument !== null) {
        accountUsage = parseCustomerBiteSaverCouponRedemption(
          accountDocument as CustomerBiteSaverStoredDocument,
          {
            userId: signedUserId,
            restaurantId: request.restaurantId,
            offerId: request.offerId,
          },
        );
        if (accountUsage === null) {
          throw new CustomerBiteSaverContractError(
            "failed-precondition",
            "The BiteSaver account usage state is invalid.",
          );
        }
      }
    }

    // This is the transaction's authoritative decision sample. Every source,
    // device, and applicable account read above precedes every write below.
    const writeNowMillis = context.now?.() ?? Date.now();
    assertFinalFences({nowMillis: writeNowMillis, evidence, authority});
    let calendar;
    try {
      calendar = customerBiteSaverUsageEvaluationCalendar({
        evaluationAtMillis: writeNowMillis,
        timeZone: authority.source.timeZone,
      });
    } catch {
      return invalidRequest("The customer time context is invalid.");
    }
    if (calendar.utcOffsetMinutes !== authority.source.utcOffsetMinutes) {
      return invalidRequest("The customer time context is stale.");
    }
    const deviceDecision = sourceDecision({
      source: authority.source,
      usage: usageState(deviceUsage, "device", request.offerId),
      nowMillis: writeNowMillis,
    });
    const accountDecision = signedUserId === null
      ? null
      : sourceDecision({
          source: authority.source,
          usage: usageState(accountUsage, "account", request.offerId),
          nowMillis: writeNowMillis,
        });
    if (deviceDecision.usageState === "unknown" ||
      accountDecision?.usageState === "unknown"
    ) {
      throw new CustomerBiteSaverContractError(
        "unavailable",
        "BiteSaver usage could not be decided.",
      );
    }
    const decisions = accountDecision === null
      ? [deviceDecision]
      : [deviceDecision, accountDecision];
    const sourceDenied = decisions.find((decision) =>
      decision.reason !== "used" &&
      (!decision.visible || !decision.redeemable));
    const eligibilityExpired = decisions.some((decision) =>
      decision.eligibilityExpiresAtMs !== null &&
      writeNowMillis >= decision.eligibilityExpiresAtMs!);
    let result: CustomerBiteSaverDeviceUseResult;
    let deviceWrite: CustomerBiteSaverDeviceCouponUsage | null = null;
    let accountWrite: CustomerBiteSaverCanonicalCouponRedemption | null = null;

    if (sourceDenied !== undefined || eligibilityExpired) {
      result = deniedResult({
        request,
        reason: sourceDenied?.reason ?? "offerUnavailable",
        evaluatedAtMillis: writeNowMillis,
      });
    } else {
      const deviceActive = deviceUsage !== null &&
        deviceUsage.timerExpiresAt.getTime() > writeNowMillis
        ? deviceUsage
        : null;
      const accountActive = accountUsage !== null &&
        accountUsage.timerExpiresAt.getTime() > writeNowMillis
        ? accountUsage
        : null;
      if (deviceActive !== null && accountActive !== null &&
        !matchingUsageAnchors(deviceActive, accountActive)
      ) {
        // Both records remain independently restrictive. A combined response
        // must not invent one synthetic timer from conflicting real anchors.
        result = deniedResult({
          request,
          reason: "used",
          evaluatedAtMillis: writeNowMillis,
        });
      } else if (deviceActive !== null) {
        // Signing in must not discard a timer already active on this verified
        // device, even when the account has an older used restriction. Both
        // present histories stay unchanged; only a missing account is
        // reconciled to the device's original anchors.
        if (signedUserId !== null && accountUsage === null) {
          accountWrite = buildCustomerBiteSaverCouponRedemption({
            userId: signedUserId,
            restaurantId: request.restaurantId,
            offerId: request.offerId,
            redemptionId: deviceActive.redemptionId,
            timerStartedAt: deviceActive.timerStartedAt,
            createdAt: deviceActive.createdAt,
          });
        }
        result = timedResult({
          request,
          status: "active",
          usage: deviceActive,
          evaluatedAtMillis: writeNowMillis,
        });
      } else if (accountActive !== null && !deviceDecision.redeemable) {
        // An active timer belonging only to the account cannot override an
        // applicable used restriction on the current verified device.
        result = deniedResult({
          request,
          reason: deviceDecision.reason,
          evaluatedAtMillis: writeNowMillis,
        });
      } else if (accountActive !== null) {
        if (deviceUsage === null) {
          deviceWrite = buildDeviceUsage({
            deviceBinding: verifiedDeviceBinding,
            restaurantId: request.restaurantId,
            offerId: request.offerId,
            redemptionId: accountActive.redemptionId,
            timerStartedAt: accountActive.timerStartedAt,
            createdAt: accountActive.createdAt,
          });
        }
        result = timedResult({
          request,
          status: "active",
          usage: accountActive,
          evaluatedAtMillis: writeNowMillis,
        });
      } else {
        const blocked = decisions.find((decision) => !decision.redeemable);
        if (blocked !== undefined) {
          const restrictingUsage = !deviceDecision.redeemable
            ? deviceUsage
            : accountUsage;
          if (restrictingUsage === null) {
            throw new CustomerBiteSaverContractError("failed-precondition");
          }
          if (deviceUsage === null) {
            deviceWrite = buildDeviceUsage({
              deviceBinding: verifiedDeviceBinding,
              restaurantId: request.restaurantId,
              offerId: request.offerId,
              redemptionId: restrictingUsage.redemptionId,
              timerStartedAt: restrictingUsage.timerStartedAt,
              createdAt: restrictingUsage.createdAt,
            });
          }
          if (signedUserId !== null && accountUsage === null) {
            accountWrite = buildCustomerBiteSaverCouponRedemption({
              userId: signedUserId,
              restaurantId: request.restaurantId,
              offerId: request.offerId,
              redemptionId: restrictingUsage.redemptionId,
              timerStartedAt: restrictingUsage.timerStartedAt,
              createdAt: restrictingUsage.createdAt,
            });
          }
          result = deniedResult({
            request,
            reason: blocked.reason,
            evaluatedAtMillis: writeNowMillis,
          });
        } else {
          deviceWrite = buildDeviceUsage({
            deviceBinding: verifiedDeviceBinding,
            restaurantId: request.restaurantId,
            offerId: request.offerId,
            redemptionId: proposedRedemptionId,
            timerStartedAt: new Date(writeNowMillis),
            createdAt: deviceUsage?.createdAt ?? new Date(writeNowMillis),
          });
          if (signedUserId !== null) {
            accountWrite = buildCustomerBiteSaverCouponRedemption({
              userId: signedUserId,
              restaurantId: request.restaurantId,
              offerId: request.offerId,
              redemptionId: proposedRedemptionId,
              timerStartedAt: new Date(writeNowMillis),
              createdAt: accountUsage?.createdAt ?? new Date(writeNowMillis),
            });
          }
          result = timedResult({
            request,
            status: "started",
            usage: deviceWrite,
            evaluatedAtMillis: writeNowMillis,
          });
        }
      }
    }

    authority.applyAfterReads?.(transaction, writeNowMillis);
    if (deviceWrite !== null) {
      transaction.setDocument(deviceUsagePath, deviceWrite);
    }
    if (accountWrite !== null && signedUsagePath !== null) {
      transaction.setDocument(signedUsagePath, accountWrite);
    }
    transaction.createDocument(receiptPath, outcomeReceipt({
      request,
      requestFingerprint,
      deviceBinding: verifiedDeviceBinding,
      accountBinding: verifiedAccountBinding,
      result,
      nowMillis: writeNowMillis,
      recoveryExpiresAtMillis: authority.recoveryExpiresAtMillis,
    }));
    return result;
  });
}

export const customerBiteSaverDeviceUsageCoreInternals = Object.freeze({
  accountBinding,
  buildDeviceUsage,
  deviceBinding,
  deviceUsageKeys,
  outcomeReceiptKeys,
  parseDeviceUsage,
  parseOutcomeReceipt,
  resultKeys,
});
