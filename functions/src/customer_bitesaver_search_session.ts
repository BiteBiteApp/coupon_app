import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  canonicalCustomerBiteSaverCriteria,
  createCustomerBiteSaverCriteriaFingerprint,
  createCustomerBiteSaverMembershipFingerprint,
  customerBiteSaverAbsoluteExpiryMilliseconds,
  customerBiteSaverCatalogGenerationShardCount,
  customerBiteSaverCursorLifetimeMilliseconds,
  customerBiteSaverGenerationShardId,
  customerBiteSaverExactLocationPreference,
  customerBiteSaverFavoriteLimit,
  customerBiteSaverGuestCheckLifetimeMilliseconds,
  customerBiteSaverGuestCheckMaximumCandidateIds,
  customerBiteSaverIdleExpiryMilliseconds,
  customerBiteSaverMaximumUnfinishedSessions,
  customerBiteSaverMaximumIndexedOrderKeyBytes,
  customerBiteSaverOfferProjectionVersion,
  customerBiteSaverPageConsumeLimit,
  customerBiteSaverPageLookahead,
  customerBiteSaverPageSize,
  customerBiteSaverPreviewCandidateRetentionLimit,
  customerBiteSaverRestaurantProjectionVersion,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  customerBiteSaverStartRateLimit,
  customerBiteSaverStartRateWindowMilliseconds,
  CustomerBiteSaverContractError,
  parseCustomerBiteSaverStartRequest,
  privateCustomerBiteSaverActiveSessionCollection,
  privateCustomerBiteSaverCandidateCollection,
  privateCustomerBiteSaverCatalogGenerationCollection,
  privateCustomerBiteSaverGuestOfferCheckCollection,
  privateCustomerBiteSaverJobCollection,
  privateCustomerBiteSaverResultCollection,
  privateCustomerBiteSaverSearchSessionCollection,
  requireCustomerBiteSaverCapability,
  requireCustomerBiteSaverPublicId,
  requireCustomerBiteSaverSessionId,
  type CustomerBiteSaverCallerScope,
  type CustomerBiteSaverCanonicalCriteria,
  type CustomerBiteSaverPreparationPhase,
  type CustomerBiteSaverSessionState,
} from "./customer_bitesaver_search_contract.js";
import {
  customerBiteSaverCallerBinding,
  customerBiteSaverCapabilityForSession,
  customerBiteSaverCapabilityHash,
  customerBiteSaverConstantTimeHexEqual,
  customerBiteSaverDeterministicId,
  customerBiteSaverCallerCapabilityBinding,
  CustomerBiteSaverCursorCodec,
  CustomerBiteSaverOfferOccurrenceCodec,
  customerBiteSaverOpaqueOfferId,
  customerBiteSaverOpaqueRestaurantId,
  customerBiteSaverRandomSessionId,
  type CustomerBiteSaverCursorPayload,
  type CustomerBiteSaverCursorSortValue,
  type CustomerBiteSaverOfferOccurrencePayload,
} from "./customer_bitesaver_search_cursor.js";
import {
  customerBiteSaverFreshLocationMaximumAgeMilliseconds,
  evaluateCustomerBiteSaverOfferAvailability,
  type CustomerBiteSaverAvailabilityDecision,
  type CustomerBiteSaverUsageState,
} from "./customer_bitesaver_offer_availability.js";
import {
  customerBiteSaverMatchValuesContain,
  customerBiteSaverSearchMatchValues,
  compareCustomerBiteSaverFirestoreUtf8,
  dartUtf16FirestoreBytesCursorValue,
  dartUtf16FirestoreBytesOrderKey,
  decodeDartUtf16FirestoreBytesOrderKey,
  hasWellFormedCustomerBiteSaverUtf16,
  lowercaseDisplayNameOrderKey,
  parseDartUtf16FirestoreBytesCursorValue,
  parseDartUtf16FirestoreBytesOrderKey,
} from "./customer_bitesaver_search_matcher.js";
import { createQueryFingerprint } from "./query_fingerprint.js";
import {
  biteSaverOfferCatalogUpdatedAtField,
  biteSaverOfferCatalogUpdatedAtOrderKeyField,
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverDailySpecialOfferIndex,
  buildBiteSaverRestaurantIndex,
  customerBiteSaverOfferSourceCreatedAtOrderKeyField,
  customerBiteSaverTimestampOrderKey,
  isCustomerBiteSaverTimestampOrderKey,
} from "./search_index_builders.js";
import {
  exactCustomerBiteSaverDistanceMiles,
  mergedRestaurantGeographicQueryBounds,
  validRestaurantCoordinates,
} from "./restaurant_geo_helpers.js";
import type {
  CustomerBiteSaverSearchDatabase,
  CustomerBiteSaverStoredDocument,
  CustomerBiteSaverTransaction,
  CustomerBiteSaverWrite,
} from "./customer_bitesaver_search_store.js";
import {
  biteSaverOfferIndexCollection,
  readCustomerBiteSaverCatalogGeneration,
} from "./search_index_contract.js";
import {
  bindCustomerBiteSaverRequestReplayDeadlineInTransaction,
  reserveCustomerBiteSaverLogicalRedemptionReplay,
  reserveCustomerBiteSaverRequestReplay,
  reserveCustomerBiteSaverRequestReplayInTransaction,
  type CustomerBiteSaverRequestReplayInput,
} from "./customer_bitesaver_request_replay.js";
import {
  assertCustomerBiteSaverGuestOfferCheckContinuationMatchesToken,
  createCustomerBiteSaverGuestOfferCheckCandidateDigest,
  createCustomerBiteSaverGuestOfferCheckOperationRef,
  CustomerBiteSaverGuestOfferCheckCodec,
  parseCustomerBiteSaverGuestOfferCheckContinuationRequest,
  type CustomerBiteSaverGuestOfferCheckContinuationRequest,
  type CustomerBiteSaverGuestOfferCheckTokenPayload,
} from "./customer_bitesaver_guest_offer_checks.js";

export type CustomerBiteSaverCallableIdentity = Readonly<{
  authUid: string | null;
  authIsAnonymous: boolean;
}>;

export type CustomerBiteSaverSessionContext = Readonly<{
  database: CustomerBiteSaverSearchDatabase;
  secretKey: Uint8Array;
  identity: CustomerBiteSaverCallableIdentity;
  now?: () => number;
  randomSource?: (size: number) => Uint8Array;
}>;

export type CustomerBiteSaverGeohashRangeState = Readonly<{
  start: string;
  end: string;
  afterGeohash: string | null;
  afterDocumentId: string | null;
  exhausted: boolean;
}>;

export type CustomerBiteSaverSessionDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  sessionId: string;
  state: CustomerBiteSaverSessionState;
  failureCode: string | null;
  callerScope: CustomerBiteSaverCallerScope;
  callerBindingHash: string;
  authenticatedUidHash: string | null;
  capabilityHash: string;
  criteria: CustomerBiteSaverCanonicalCriteria;
  criteriaFingerprint: string;
  queryFingerprint: string;
  attemptGeneration: number;
  catalogRestartCount: number;
  catalogGenerationVector: readonly number[];
  phase: CustomerBiteSaverPreparationPhase;
  restaurantRanges: readonly CustomerBiteSaverGeohashRangeState[];
  offerRanges: readonly CustomerBiteSaverGeohashRangeState[];
  finalizeAfterCandidateDocumentId: string | null;
  currentJobId: string;
  workerLeaseId: string | null;
  workerLeaseExpiresAt: Date | null;
  progress: Readonly<{
    processedSourceDocuments: number;
    completedRestaurantRanges: number;
    completedOfferRanges: number;
    finalizedCandidates: number;
  }>;
  createdAt: Date;
  lastAccessAt: Date;
  logicalExpiresAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}>;

type RecentStartRequest = Readonly<{
  clientRequestBinding: string;
  criteriaFingerprint: string;
  sessionId: string;
  createdAtMs: number;
}>;

type ActiveControlDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  role: "callerControl";
  callerBindingHash: string;
  attemptGeneration: number;
  state: "active";
  unfinishedSessionIds: readonly string[];
  recentStartsAtMs: readonly number[];
  recentRequests: readonly RecentStartRequest[];
  createdAt: Date;
  logicalExpiresAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}>;

type ActivePointerDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  role: "criteriaPointer";
  callerBindingHash: string;
  criteriaFingerprint: string;
  sessionId: string;
  attemptGeneration: number;
  state: "active";
  createdAt: Date;
  logicalExpiresAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}>;

type StartRequestReplayDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  role: "startRequestReplay";
  state: "active";
  callerBindingHash: string;
  clientRequestBinding: string;
  requestFingerprint: string;
  sessionId: string;
  attemptGeneration: number;
  createdAt: Date;
  logicalExpiresAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}>;

const startRequestReplayKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "callerBindingHash",
  "clientRequestBinding",
  "createdAt",
  "expiresAt",
  "logicalExpiresAt",
  "protocolVersion",
  "requestFingerprint",
  "role",
  "schemaVersion",
  "sessionId",
  "state",
].sort());

export type CustomerBiteSaverSearchJobDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  jobKind: "customerBiteSaverPreparation";
  sessionId: string;
  attemptGeneration: number;
  occurrenceId: string;
  phase: CustomerBiteSaverPreparationPhase;
  state: "pending" | "processing" | "completed" | "invalid" | "expired";
  callerBindingHash: string;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  logicalExpiresAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}>;

export type CustomerBiteSaverStartResponse = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  sessionId: string;
  capability: string;
  state: "preparing" | "ready";
  attemptGeneration: number;
  criteriaFingerprint: string;
  queryFingerprint: string;
  logicalExpiresAtMillis: number;
}>;

function path(collection: string, documentId: string): string {
  return `${collection}/${documentId}`;
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(value.getTime());
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as {toDate?: () => unknown};
    try {
      return typeof candidate.toDate === "function"
        ? dateValue(candidate.toDate())
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function exactString(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function sessionPath(sessionId: string): string {
  return path(privateCustomerBiteSaverSearchSessionCollection, sessionId);
}

export function customerBiteSaverCandidatePrefix(
  sessionId: string,
  attemptGeneration: number,
): string {
  return `${sessionId}_${attemptGeneration.toString(36)}_`;
}

export function customerBiteSaverResultDocumentId(
  key: Uint8Array,
  sessionId: string,
  attemptGeneration: number,
  publicRestaurantId: string,
): string {
  return customerBiteSaverDeterministicId(key, "bsrrow", "result", [
    sessionId,
    attemptGeneration.toString(10),
    publicRestaurantId,
  ]);
}

export function customerBiteSaverJobId(
  key: Uint8Array,
  sessionId: string,
  attemptGeneration: number,
  phase: CustomerBiteSaverPreparationPhase,
  occurrence: string,
): string {
  return customerBiteSaverDeterministicId(key, "bsj", "preparationJob", [
    sessionId,
    attemptGeneration.toString(10),
    phase,
    occurrence,
  ]);
}

export function buildCustomerBiteSaverJobDocument(value: {
  jobId: string;
  session: CustomerBiteSaverSessionDocument;
  now: Date;
}): CustomerBiteSaverSearchJobDocument {
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    jobKind: "customerBiteSaverPreparation",
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    occurrenceId: createHash("sha256")
      .update(`${value.jobId}\0${value.session.queryFingerprint}`, "utf8")
      .digest("hex"),
    phase: value.session.phase,
    state: "pending",
    callerBindingHash: value.session.callerBindingHash,
    leaseId: null,
    leaseExpiresAt: null,
    createdAt: new Date(value.now.getTime()),
    logicalExpiresAt: new Date(value.session.logicalExpiresAt.getTime()),
    absoluteExpiresAt: new Date(value.session.absoluteExpiresAt.getTime()),
    expiresAt: new Date(value.session.absoluteExpiresAt.getTime()),
  });
}

function callerScope(
  identity: CustomerBiteSaverCallableIdentity,
): CustomerBiteSaverCallerScope {
  return identity.authUid !== null && !identity.authIsAnonymous
    ? "authenticated"
    : "guest";
}

function requireAuthUid(identity: CustomerBiteSaverCallableIdentity): string | null {
  if (identity.authUid === null || identity.authIsAnonymous) {
    return null;
  }
  if (
    identity.authUid.length === 0 ||
    identity.authUid.length > 1_500 ||
    identity.authUid.includes("/")
  ) {
    throw new CustomerBiteSaverContractError("permission-denied");
  }
  return identity.authUid;
}

function authenticatedUidHash(key: Uint8Array, uid: string | null): string | null {
  return uid === null
    ? null
    : customerBiteSaverDeterministicId(key, "uid", "authenticatedUid", [uid])
        .slice(4);
}

function pointerDocumentId(
  key: Uint8Array,
  callerBindingHash: string,
  criteriaFingerprint: string,
): string {
  return customerBiteSaverDeterministicId(key, "bsp", "activePointer", [
    callerBindingHash,
    criteriaFingerprint,
  ]);
}

function controlDocumentId(
  key: Uint8Array,
  callerBindingHash: string,
): string {
  return customerBiteSaverDeterministicId(key, "bsc", "activeControl", [
    callerBindingHash,
  ]);
}

function startRequestReplayDocumentId(
  key: Uint8Array,
  callerBindingHash: string,
  clientRequestId: string,
): string {
  return customerBiteSaverDeterministicId(
    key,
    "bssrr",
    "startRequestReplayDocument",
    [
      customerBiteSaverSearchProtocolVersion,
      callerBindingHash,
      clientRequestId,
    ],
  );
}

function startRequestClientBinding(
  key: Uint8Array,
  callerBindingHash: string,
  clientRequestId: string,
): string {
  return customerBiteSaverDeterministicId(
    key,
    "bssrb",
    "startRequestClientBinding",
    [callerBindingHash, clientRequestId],
  );
}

function parseStartRequestReplay(
  document: CustomerBiteSaverStoredDocument | null,
): StartRequestReplayDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  const keys = Object.keys(data).sort();
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  if (
    keys.length !== startRequestReplayKeys.length ||
    keys.some((key, index) => key !== startRequestReplayKeys[index]) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    data.role !== "startRequestReplay" ||
    data.state !== "active" ||
    typeof data.callerBindingHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.callerBindingHash) ||
    typeof data.clientRequestBinding !== "string" ||
    !/^bssrb_[A-Za-z0-9_-]{43}$/u.test(data.clientRequestBinding) ||
    typeof data.requestFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.requestFingerprint) ||
    typeof data.sessionId !== "string" ||
    !/^bss_[A-Za-z0-9_-]{43}$/u.test(data.sessionId) ||
    !Number.isSafeInteger(data.attemptGeneration) ||
    (data.attemptGeneration as number) < 0 ||
    createdAt === null ||
    logicalExpiresAt === null ||
    absoluteExpiresAt === null ||
    expiresAt === null ||
    createdAt.getTime() >= absoluteExpiresAt.getTime() ||
    logicalExpiresAt.getTime() !== absoluteExpiresAt.getTime() ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime()
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver start replay state is invalid.",
    );
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: "startRequestReplay",
    state: "active",
    callerBindingHash: data.callerBindingHash,
    clientRequestBinding: data.clientRequestBinding,
    requestFingerprint: data.requestFingerprint,
    sessionId: data.sessionId,
    attemptGeneration: data.attemptGeneration as number,
    createdAt,
    logicalExpiresAt,
    absoluteExpiresAt,
    expiresAt,
  });
}

function buildStartRequestReplay(value: {
  callerBindingHash: string;
  clientRequestBinding: string;
  requestFingerprint: string;
  session: CustomerBiteSaverSessionDocument;
  now: Date;
}): StartRequestReplayDocument {
  const absoluteExpiresAt = new Date(
    value.session.absoluteExpiresAt.getTime(),
  );
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: "startRequestReplay",
    state: "active",
    callerBindingHash: value.callerBindingHash,
    clientRequestBinding: value.clientRequestBinding,
    requestFingerprint: value.requestFingerprint,
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    createdAt: new Date(value.now.getTime()),
    logicalExpiresAt: absoluteExpiresAt,
    absoluteExpiresAt,
    expiresAt: absoluteExpiresAt,
  });
}

function parseGenerationShard(
  document: CustomerBiteSaverStoredDocument | null,
  index: number,
): number | null {
  if (document === null) {
    return 0;
  }
  try {
    return readCustomerBiteSaverCatalogGeneration(document.data, index);
  } catch {
    return null;
  }
}

const customerBiteSaverSessionDocumentKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "authenticatedUidHash",
  "callerBindingHash",
  "callerScope",
  "capabilityHash",
  "catalogGenerationVector",
  "catalogRestartCount",
  "createdAt",
  "criteria",
  "criteriaFingerprint",
  "currentJobId",
  "expiresAt",
  "failureCode",
  "finalizeAfterCandidateDocumentId",
  "lastAccessAt",
  "logicalExpiresAt",
  "offerRanges",
  "phase",
  "progress",
  "protocolVersion",
  "queryFingerprint",
  "restaurantRanges",
  "schemaVersion",
  "sessionId",
  "state",
  "workerLeaseExpiresAt",
  "workerLeaseId",
].sort());

const customerBiteSaverCriteriaKeys = Object.freeze([
  "distanceRankingVersion",
  "eligibilityPolicyVersion",
  "latitude",
  "latitudeBinary64",
  "locationMode",
  "longitude",
  "longitudeBinary64",
  "matcherVersion",
  "nameOrderVersion",
  "normalizedSearchQuery",
  "normalizerVersion",
  "offerOrderVersion",
  "offerProjectionVersion",
  "radiusMiles",
  "restaurantProjectionVersion",
  "searchProtocolVersion",
  "staticFilters",
  "timeZone",
  "typedLocation",
  "utcOffsetMinutes",
].sort());

function hasExactRecordKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function validStoredCriteria(
  value: unknown,
): value is CustomerBiteSaverCanonicalCriteria {
  if (!hasExactRecordKeys(value, customerBiteSaverCriteriaKeys)) {
    return false;
  }
  const coordinates = validRestaurantCoordinates(
    value.latitude,
    value.longitude,
  );
  const staticFiltersValid = hasExactRecordKeys(value.staticFilters, [
    "customerDiscoverable",
    "publicVisible",
    "source",
  ]) && value.staticFilters.source === "biteSaver" &&
    value.staticFilters.publicVisible === true &&
    value.staticFilters.customerDiscoverable === true;
  const typed = value.typedLocation;
  const typedValid = value.locationMode === "current"
    ? typed === null
    : value.locationMode === "typed" &&
      ((hasExactRecordKeys(typed, ["kind", "zip"]) &&
        typed.kind === "zip" && typeof typed.zip === "string") ||
       (hasExactRecordKeys(typed, ["city", "kind", "state"]) &&
        typed.kind === "city" && typeof typed.city === "string" &&
        (typed.state === null || typeof typed.state === "string")));
  const shapeValid = coordinates !== null &&
    typeof value.latitudeBinary64 === "string" &&
    /^[0-9a-f]{16}$/u.test(value.latitudeBinary64) &&
    typeof value.longitudeBinary64 === "string" &&
    /^[0-9a-f]{16}$/u.test(value.longitudeBinary64) &&
    typeof value.radiusMiles === "number" &&
    [1, 3, 5, 10, 15, 20, 30].includes(value.radiusMiles) &&
    typeof value.normalizedSearchQuery === "string" &&
    typeof value.timeZone === "string" && value.timeZone.length > 0 &&
    typeof value.utcOffsetMinutes === "number" &&
    Number.isSafeInteger(value.utcOffsetMinutes) &&
    value.utcOffsetMinutes >= -840 && value.utcOffsetMinutes <= 840 &&
    staticFiltersValid && typedValid;
  if (!shapeValid) {
    return false;
  }
  try {
    // Re-run the public canonicalizer and require a byte-stable canonical
    // representation. This simultaneously fences every protocol/policy
    // version, binary64 coordinate spelling, normalized query, IANA zone, and
    // mode-specific typed-location invariant stored in the private session.
    const canonical = canonicalCustomerBiteSaverCriteria(
      parseCustomerBiteSaverStartRequest({
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        clientRequestId: "stored-criteria-check-0001",
        clientInstanceId: "stored-criteria-check-0001",
        latitude: value.latitude,
        longitude: value.longitude,
        radiusMiles: value.radiusMiles,
        locationMode: value.locationMode,
        typedLocation: value.typedLocation,
        searchText: value.normalizedSearchQuery,
        timeZone: value.timeZone,
        utcOffsetMinutes: value.utcOffsetMinutes,
        freshSearch: false,
      }),
    );
    return createCustomerBiteSaverCriteriaFingerprint(
      value as unknown as CustomerBiteSaverCanonicalCriteria,
    ) === createCustomerBiteSaverCriteriaFingerprint(canonical);
  } catch {
    return false;
  }
}

function validStoredRange(value: unknown): value is CustomerBiteSaverGeohashRangeState {
  if (!hasExactRecordKeys(value, [
    "afterDocumentId",
    "afterGeohash",
    "end",
    "exhausted",
    "start",
  ])) {
    return false;
  }
  return typeof value.start === "string" && value.start.length > 0 &&
    typeof value.end === "string" && value.end.length > 0 &&
    typeof value.exhausted === "boolean" &&
    ((value.afterGeohash === null && value.afterDocumentId === null) ||
      (typeof value.afterGeohash === "string" &&
        typeof value.afterDocumentId === "string"));
}

function parseSession(
  document: CustomerBiteSaverStoredDocument | null,
): CustomerBiteSaverSessionDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  const createdAt = dateValue(data.createdAt);
  const lastAccessAt = dateValue(data.lastAccessAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  const workerLeaseExpiresAt = data.workerLeaseExpiresAt === null
    ? null
    : dateValue(data.workerLeaseExpiresAt);
  const sessionKeys = Object.keys(data).sort();
  const progressValid = hasExactRecordKeys(data.progress, [
    "completedOfferRanges",
    "completedRestaurantRanges",
    "finalizedCandidates",
    "processedSourceDocuments",
  ]) && Object.values(data.progress).every((entry) =>
    typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0);
  if (
    document.id !== data.sessionId ||
    document.path !== sessionPath(String(data.sessionId)) ||
    sessionKeys.length !== customerBiteSaverSessionDocumentKeys.length ||
    sessionKeys.some((key, index) =>
      key !== customerBiteSaverSessionDocumentKeys[index]) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    exactString(data.sessionId, /^bss_[A-Za-z0-9_-]{43}$/u) === null ||
    (data.state !== "preparing" && data.state !== "ready" &&
      data.state !== "failed" && data.state !== "expired") ||
    (data.callerScope !== "guest" && data.callerScope !== "authenticated") ||
    exactString(data.callerBindingHash, /^[0-9a-f]{64}$/u) === null ||
    exactString(data.capabilityHash, /^[0-9a-f]{64}$/u) === null ||
    exactString(data.criteriaFingerprint, /^[0-9a-f]{64}$/u) === null ||
    exactString(data.queryFingerprint, /^[0-9a-f]{64}$/u) === null ||
    safeInteger(data.attemptGeneration) === null ||
    safeInteger(data.catalogRestartCount) === null ||
    !Array.isArray(data.catalogGenerationVector) ||
    data.catalogGenerationVector.length !==
      customerBiteSaverCatalogGenerationShardCount ||
    data.catalogGenerationVector.some((entry) => safeInteger(entry) === null) ||
    (data.phase !== "restaurantRanges" && data.phase !== "offerRanges" &&
      data.phase !== "finalizeCandidates" &&
      data.phase !== "verifyCatalogGeneration" && data.phase !== "ready") ||
    !Array.isArray(data.restaurantRanges) ||
    !Array.isArray(data.offerRanges) ||
    data.restaurantRanges.length > 9 || data.offerRanges.length > 9 ||
    data.restaurantRanges.some((entry) => !validStoredRange(entry)) ||
    data.offerRanges.some((entry) => !validStoredRange(entry)) ||
    !progressValid ||
    createdAt === null ||
    lastAccessAt === null ||
    logicalExpiresAt === null ||
    absoluteExpiresAt === null ||
    expiresAt === null ||
    (data.workerLeaseExpiresAt !== null && workerLeaseExpiresAt === null) ||
    !validStoredCriteria(data.criteria) ||
    (data.failureCode !== null &&
      data.failureCode !== "catalog_changed_repeatedly" &&
      data.failureCode !== "invalid_private_state" &&
      data.failureCode !== "preparation_failed") ||
    (data.authenticatedUidHash !== null &&
      (typeof data.authenticatedUidHash !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(data.authenticatedUidHash))) ||
    (data.callerScope === "guest" && data.authenticatedUidHash !== null) ||
    (data.callerScope === "authenticated" &&
      data.authenticatedUidHash === null) ||
    typeof data.currentJobId !== "string" ||
    !/^bsj_[A-Za-z0-9_-]{43}$/u.test(data.currentJobId) ||
    (data.finalizeAfterCandidateDocumentId !== null &&
      exactString(data.finalizeAfterCandidateDocumentId, /^[^/]{1,1500}$/u) ===
        null) ||
    (data.workerLeaseId !== null &&
      (typeof data.workerLeaseId !== "string" ||
        !/^lease_[A-Za-z0-9_-]{22}$/u.test(data.workerLeaseId))) ||
    ((data.workerLeaseId === null) !== (workerLeaseExpiresAt === null)) ||
    logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime() ||
    (data.state === "ready" && data.phase !== "ready") ||
    (data.state === "preparing" && data.phase === "ready")
  ) {
    return null;
  }
  try {
    if (
      createCustomerBiteSaverCriteriaFingerprint(data.criteria) !==
        data.criteriaFingerprint ||
      createCustomerBiteSaverMembershipFingerprint({
        criteria: data.criteria,
        attemptGeneration: data.attemptGeneration as number,
        catalogGenerationVector: data.catalogGenerationVector as number[],
      }) !== data.queryFingerprint
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    ...(data as unknown as CustomerBiteSaverSessionDocument),
    createdAt,
    lastAccessAt,
    logicalExpiresAt,
    absoluteExpiresAt,
    expiresAt,
    workerLeaseExpiresAt,
  };
}

const activeControlKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "callerBindingHash",
  "createdAt",
  "expiresAt",
  "logicalExpiresAt",
  "protocolVersion",
  "recentRequests",
  "recentStartsAtMs",
  "role",
  "state",
  "unfinishedSessionIds",
].sort());

const recentStartRequestKeys = Object.freeze([
  "clientRequestBinding",
  "createdAtMs",
  "criteriaFingerprint",
  "sessionId",
].sort());

const activePointerKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "callerBindingHash",
  "createdAt",
  "criteriaFingerprint",
  "expiresAt",
  "logicalExpiresAt",
  "protocolVersion",
  "role",
  "sessionId",
  "state",
].sort());

function invalidActiveSessionState(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "The BiteSaver active-session state is invalid.",
  );
}

function parseActiveControl(
  document: CustomerBiteSaverStoredDocument | null,
  expected: Readonly<{
    documentId: string;
    callerBindingHash: string;
  }>,
): {
  unfinishedSessionIds: string[];
  recentStartsAtMs: number[];
  recentRequests: RecentStartRequest[];
  createdAt: Date | null;
} {
  if (document === null) {
    return {
      unfinishedSessionIds: [],
      recentStartsAtMs: [],
      recentRequests: [],
      createdAt: null,
    };
  }
  const data = document.data;
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  if (
    document.id !== expected.documentId ||
    document.path !== path(
      privateCustomerBiteSaverActiveSessionCollection,
      expected.documentId,
    ) ||
    !hasExactRecordKeys(data, activeControlKeys) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.role !== "callerControl" ||
    data.state !== "active" ||
    data.callerBindingHash !== expected.callerBindingHash ||
    safeInteger(data.attemptGeneration) === null ||
    !Array.isArray(data.unfinishedSessionIds) ||
    data.unfinishedSessionIds.length >
      customerBiteSaverMaximumUnfinishedSessions ||
    !Array.isArray(data.recentStartsAtMs) ||
    data.recentStartsAtMs.length > customerBiteSaverStartRateLimit ||
    !Array.isArray(data.recentRequests) ||
    data.recentRequests.length > customerBiteSaverStartRateLimit ||
    createdAt === null || logicalExpiresAt === null ||
    absoluteExpiresAt === null || expiresAt === null ||
    createdAt.getTime() >= absoluteExpiresAt.getTime() ||
    logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime()
  ) {
    return invalidActiveSessionState();
  }
  const unfinishedSessionIds = data.unfinishedSessionIds.map((entry) => {
    if (exactString(entry, /^bss_[A-Za-z0-9_-]{43}$/u) === null) {
      return invalidActiveSessionState();
    }
    return entry as string;
  });
  if (new Set(unfinishedSessionIds).size !== unfinishedSessionIds.length) {
    return invalidActiveSessionState();
  }
  const recentStartsAtMs = data.recentStartsAtMs.map((entry, index, entries) => {
    const timestamp = safeInteger(entry);
    if (
      timestamp === null ||
      timestamp < createdAt.getTime() ||
      timestamp >= absoluteExpiresAt.getTime() ||
      (index > 0 && timestamp < (entries[index - 1] as number))
    ) {
      return invalidActiveSessionState();
    }
    return timestamp;
  });
  const recentRequests = data.recentRequests.map((entry) => {
    if (
      !hasExactRecordKeys(entry, recentStartRequestKeys) ||
      exactString(entry.clientRequestBinding, /^bssrb_[A-Za-z0-9_-]{43}$/u) ===
        null ||
      exactString(entry.criteriaFingerprint, /^[0-9a-f]{64}$/u) === null ||
      exactString(entry.sessionId, /^bss_[A-Za-z0-9_-]{43}$/u) === null ||
      safeInteger(entry.createdAtMs) === null ||
      (entry.createdAtMs as number) < createdAt.getTime() ||
      (entry.createdAtMs as number) >= absoluteExpiresAt.getTime()
    ) {
      return invalidActiveSessionState();
    }
    return Object.freeze({
      clientRequestBinding: entry.clientRequestBinding as string,
      criteriaFingerprint: entry.criteriaFingerprint as string,
      sessionId: entry.sessionId as string,
      createdAtMs: entry.createdAtMs as number,
    });
  });
  if (
    new Set(recentRequests.map((entry) => entry.clientRequestBinding)).size !==
      recentRequests.length
  ) {
    return invalidActiveSessionState();
  }
  return {
    unfinishedSessionIds,
    recentStartsAtMs,
    recentRequests,
    createdAt,
  };
}

function parseActivePointer(
  document: CustomerBiteSaverStoredDocument | null,
  expected: Readonly<{
    documentId: string;
    callerBindingHash: string;
    criteriaFingerprint: string;
  }>,
): ActivePointerDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  if (
    document.id !== expected.documentId ||
    document.path !== path(
      privateCustomerBiteSaverActiveSessionCollection,
      expected.documentId,
    ) ||
    !hasExactRecordKeys(data, activePointerKeys) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.role !== "criteriaPointer" ||
    data.state !== "active" ||
    data.callerBindingHash !== expected.callerBindingHash ||
    data.criteriaFingerprint !== expected.criteriaFingerprint ||
    exactString(data.sessionId, /^bss_[A-Za-z0-9_-]{43}$/u) === null ||
    safeInteger(data.attemptGeneration) === null ||
    createdAt === null || logicalExpiresAt === null ||
    absoluteExpiresAt === null || expiresAt === null ||
    createdAt.getTime() >= absoluteExpiresAt.getTime() ||
    logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime()
  ) {
    return invalidActiveSessionState();
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    role: "criteriaPointer",
    callerBindingHash: expected.callerBindingHash,
    criteriaFingerprint: expected.criteriaFingerprint,
    sessionId: data.sessionId as string,
    attemptGeneration: data.attemptGeneration as number,
    state: "active",
    createdAt,
    logicalExpiresAt,
    absoluteExpiresAt,
    expiresAt,
  });
}

function isLiveSession(
  session: CustomerBiteSaverSessionDocument | null,
  nowMs: number,
): session is CustomerBiteSaverSessionDocument {
  return session !== null &&
    session.state !== "failed" &&
    session.state !== "expired" &&
    nowMs < session.logicalExpiresAt.getTime() &&
    nowMs < session.absoluteExpiresAt.getTime();
}

function sessionAfterActivity(
  session: CustomerBiteSaverSessionDocument,
  nowMs: number,
): CustomerBiteSaverSessionDocument {
  const nextLogicalExpiresAtMs = Math.min(
    session.absoluteExpiresAt.getTime(),
    nowMs + customerBiteSaverIdleExpiryMilliseconds,
  );
  if (
    nowMs <= session.lastAccessAt.getTime() &&
    nextLogicalExpiresAtMs <= session.logicalExpiresAt.getTime()
  ) {
    return session;
  }
  return Object.freeze({
    ...session,
    lastAccessAt: new Date(Math.max(nowMs, session.lastAccessAt.getTime())),
    logicalExpiresAt: new Date(Math.max(
      nextLogicalExpiresAtMs,
      session.logicalExpiresAt.getTime(),
    )),
  });
}

async function touchSessionInTransaction(
  transaction: CustomerBiteSaverTransaction,
  session: CustomerBiteSaverSessionDocument,
  nowMs: number,
): Promise<CustomerBiteSaverSessionDocument> {
  const touched = sessionAfterActivity(session, nowMs);
  if (touched === session) {
    return session;
  }
  const jobSnapshot = session.state === "preparing"
    ? await transaction.getDocument(path(
        privateCustomerBiteSaverJobCollection,
        session.currentJobId,
      ))
    : null;
  transaction.setDocument(sessionPath(session.sessionId), touched);
  if (
    jobSnapshot !== null &&
    jobSnapshot.data.protocolVersion === customerBiteSaverSearchProtocolVersion &&
    jobSnapshot.data.jobKind === "customerBiteSaverPreparation" &&
    jobSnapshot.data.sessionId === session.sessionId &&
    jobSnapshot.data.attemptGeneration === session.attemptGeneration &&
    jobSnapshot.data.state !== "completed" &&
    jobSnapshot.data.state !== "invalid" &&
    jobSnapshot.data.state !== "expired"
  ) {
    transaction.setDocument(jobSnapshot.path, {
      ...jobSnapshot.data,
      logicalExpiresAt: touched.logicalExpiresAt,
    });
  }
  return touched;
}

function startResponse(
  session: CustomerBiteSaverSessionDocument,
  key: Uint8Array,
): CustomerBiteSaverStartResponse {
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    sessionId: session.sessionId,
    capability: customerBiteSaverCapabilityForSession(
      key,
      session.sessionId,
      session.callerBindingHash,
    ),
    state: session.state === "ready" ? "ready" : "preparing",
    attemptGeneration: session.attemptGeneration,
    criteriaFingerprint: session.criteriaFingerprint,
    queryFingerprint: session.queryFingerprint,
    logicalExpiresAtMillis: session.logicalExpiresAt.getTime(),
  });
}

function rangeStates(
  criteria: CustomerBiteSaverCanonicalCriteria,
): readonly CustomerBiteSaverGeohashRangeState[] {
  return Object.freeze(mergedRestaurantGeographicQueryBounds({
    latitude: criteria.latitude,
    longitude: criteria.longitude,
  }, criteria.radiusMiles).map(([start, end]) => Object.freeze({
    start,
    end,
    afterGeohash: null,
    afterDocumentId: null,
    exhausted: false,
  })));
}

export async function startCustomerBiteSaverSearchHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverStartResponse> {
  // All request and caller validation intentionally precedes Firestore access.
  const nowMs = context.now?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const request = parseCustomerBiteSaverStartRequest(rawRequest);
  const uid = requireAuthUid(context.identity);
  const scope = callerScope(context.identity);
  const callerBindingHash = customerBiteSaverCallerBinding(context.secretKey, {
    scope,
    clientInstanceId: request.clientInstanceId,
    uid,
  });
  const criteria = canonicalCustomerBiteSaverCriteria(request);
  const criteriaFingerprint = createCustomerBiteSaverCriteriaFingerprint(criteria);
  const now = new Date(nowMs);
  const proposedSessionId = customerBiteSaverRandomSessionId(
    context.randomSource ?? randomBytes,
  );
  const controlId = controlDocumentId(context.secretKey, callerBindingHash);
  const pointerId = pointerDocumentId(
    context.secretKey,
    callerBindingHash,
    criteriaFingerprint,
  );
  const startReplayId = startRequestReplayDocumentId(
    context.secretKey,
    callerBindingHash,
    request.clientRequestId,
  );
  const startReplayPath = path(
    privateCustomerBiteSaverActiveSessionCollection,
    startReplayId,
  );
  const clientRequestBinding = startRequestClientBinding(
    context.secretKey,
    callerBindingHash,
    request.clientRequestId,
  );
  const startRequestFingerprint = createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    criteriaFingerprint,
    freshSearch: request.freshSearch,
    timeZone: criteria.timeZone,
    utcOffsetMinutes: criteria.utcOffsetMinutes,
  });
  return context.database.runTransaction(async (transaction) => {
    const shardPaths = Array.from(
      {length: customerBiteSaverCatalogGenerationShardCount},
      (_, index) => path(
        privateCustomerBiteSaverCatalogGenerationCollection,
        customerBiteSaverGenerationShardId(index),
      ),
    );
    const [
      shards,
      controlSnapshot,
      pointerSnapshot,
      startReplaySnapshot,
    ] = await Promise.all([
      transaction.getDocuments(shardPaths),
      transaction.getDocument(path(
        privateCustomerBiteSaverActiveSessionCollection,
        controlId,
      )),
      transaction.getDocument(path(
        privateCustomerBiteSaverActiveSessionCollection,
        pointerId,
      )),
      transaction.getDocument(startReplayPath),
    ]);
    const vector = shards.map((document, index) => {
      const generation = parseGenerationShard(document, index);
      if (generation === null) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "BiteSaver discovery catalog state is invalid.",
        );
      }
      return generation;
    });
    const control = parseActiveControl(controlSnapshot, {
      documentId: controlId,
      callerBindingHash,
    });
    const parsedPointer = parseActivePointer(pointerSnapshot, {
      documentId: pointerId,
      callerBindingHash,
      criteriaFingerprint,
    });
    const startReplay = parseStartRequestReplay(startReplaySnapshot);
    const pointerSessionId = parsedPointer?.sessionId;
    const candidateSessionIds = [...new Set([
      ...(startReplay === null ? [] : [startReplay.sessionId]),
      ...control.unfinishedSessionIds,
      ...(typeof pointerSessionId === "string" ? [pointerSessionId] : []),
    ])].slice(0, customerBiteSaverMaximumUnfinishedSessions + 3);
    const candidateSessions = await transaction.getDocuments(
      candidateSessionIds.map(sessionPath),
    );
    const sessionsById = new Map<string, CustomerBiteSaverSessionDocument>();
    for (const candidate of candidateSessions) {
      const session = parseSession(candidate);
      if (candidate !== null && session === null) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver active-session state is invalid.",
        );
      }
      if (session !== null) {
        sessionsById.set(session.sessionId, session);
      }
    }

    if (startReplay !== null) {
      if (
        startReplaySnapshot?.id !== startReplayId ||
        startReplaySnapshot.path !== startReplayPath ||
        startReplay.callerBindingHash !== callerBindingHash ||
        startReplay.clientRequestBinding !== clientRequestBinding ||
        startReplay.requestFingerprint !== startRequestFingerprint
      ) {
        throw new CustomerBiteSaverContractError(
          "invalid-argument",
          "The client request ID was already used for a different request.",
        );
      }
      const prior = sessionsById.get(startReplay.sessionId) ?? null;
      if (
        !isLiveSession(prior, nowMs) ||
        prior.attemptGeneration < startReplay.attemptGeneration ||
        prior.callerBindingHash !== callerBindingHash ||
        prior.criteriaFingerprint !== criteriaFingerprint ||
        prior.absoluteExpiresAt.getTime() !==
          startReplay.absoluteExpiresAt.getTime()
      ) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The original BiteSaver start request is no longer active.",
        );
      }
      const touched = await touchSessionInTransaction(
        transaction,
        prior,
        nowMs,
      );
      return startResponse(touched, context.secretKey);
    }

    const repeatedRequest = control.recentRequests.find((entry) =>
      entry.clientRequestBinding === clientRequestBinding);
    if (repeatedRequest !== undefined) {
      if (repeatedRequest.criteriaFingerprint !== criteriaFingerprint) {
        throw new CustomerBiteSaverContractError(
          "invalid-argument",
          "The client request ID was already used for different criteria.",
        );
      }
      const prior = sessionsById.get(repeatedRequest.sessionId) ?? null;
      if (isLiveSession(prior, nowMs)) {
        if (
          prior.criteria.timeZone !== criteria.timeZone ||
          prior.criteria.utcOffsetMinutes !== criteria.utcOffsetMinutes
        ) {
          throw new CustomerBiteSaverContractError(
            "invalid-argument",
            "The client request ID was already used for different criteria.",
          );
        }
        const touched = await touchSessionInTransaction(
          transaction,
          prior,
          nowMs,
        );
        return startResponse(touched, context.secretKey);
      }
    }

    const pointed = typeof pointerSessionId === "string"
      ? sessionsById.get(pointerSessionId) ?? null
      : null;
    if (
      pointed !== null && parsedPointer !== null &&
      pointed.attemptGeneration < parsedPointer.attemptGeneration
    ) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver active-session state is invalid.",
      );
    }
    if (
      !request.freshSearch &&
      isLiveSession(pointed, nowMs) &&
      pointed.criteriaFingerprint === criteriaFingerprint &&
      pointed.callerBindingHash === callerBindingHash &&
      pointed.criteria.timeZone === criteria.timeZone &&
      pointed.criteria.utcOffsetMinutes === criteria.utcOffsetMinutes
    ) {
      const touched = await touchSessionInTransaction(
        transaction,
        pointed,
        nowMs,
      );
      transaction.createDocument(startReplayPath, buildStartRequestReplay({
        callerBindingHash,
        clientRequestBinding,
        requestFingerprint: startRequestFingerprint,
        session: touched,
        now,
      }));
      return startResponse(touched, context.secretKey);
    }

    const unfinished = [...sessionsById.values()].filter((session) =>
      session.state === "preparing" && isLiveSession(session, nowMs));
    if (unfinished.length >= customerBiteSaverMaximumUnfinishedSessions) {
      throw new CustomerBiteSaverContractError(
        "resource-exhausted",
        "Too many BiteSaver searches are already preparing.",
      );
    }
    const recentStartsAtMs = control.recentStartsAtMs.filter((timestamp) =>
      timestamp > nowMs - customerBiteSaverStartRateWindowMilliseconds);
    if (recentStartsAtMs.length >= customerBiteSaverStartRateLimit) {
      throw new CustomerBiteSaverContractError(
        "resource-exhausted",
        "Please wait before starting another BiteSaver search.",
      );
    }

    const attemptGeneration = 0;
    const queryFingerprint = createCustomerBiteSaverMembershipFingerprint({
      criteria,
      attemptGeneration,
      catalogGenerationVector: vector,
    });
    const absoluteExpiresAt = new Date(
      nowMs + customerBiteSaverAbsoluteExpiryMilliseconds,
    );
    const logicalExpiresAt = new Date(
      Math.min(
        absoluteExpiresAt.getTime(),
        nowMs + customerBiteSaverIdleExpiryMilliseconds,
      ),
    );
    const ranges = rangeStates(criteria);
    const initialJobId = customerBiteSaverJobId(
      context.secretKey,
      proposedSessionId,
      attemptGeneration,
      "restaurantRanges",
      "initial",
    );
    const capability = customerBiteSaverCapabilityForSession(
      context.secretKey,
      proposedSessionId,
      callerBindingHash,
    );
    const session: CustomerBiteSaverSessionDocument = Object.freeze({
      protocolVersion: customerBiteSaverSearchProtocolVersion,
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      sessionId: proposedSessionId,
      state: "preparing",
      failureCode: null,
      callerScope: scope,
      callerBindingHash,
      authenticatedUidHash: authenticatedUidHash(context.secretKey, uid),
      capabilityHash: customerBiteSaverCapabilityHash(
        context.secretKey,
        capability,
      ),
      criteria,
      criteriaFingerprint,
      queryFingerprint,
      attemptGeneration,
      catalogRestartCount: 0,
      catalogGenerationVector: Object.freeze([...vector]),
      phase: "restaurantRanges",
      restaurantRanges: ranges,
      offerRanges: ranges.map((range) => Object.freeze({...range})),
      finalizeAfterCandidateDocumentId: null,
      currentJobId: initialJobId,
      workerLeaseId: null,
      workerLeaseExpiresAt: null,
      progress: Object.freeze({
        processedSourceDocuments: 0,
        completedRestaurantRanges: 0,
        completedOfferRanges: 0,
        finalizedCandidates: 0,
      }),
      createdAt: now,
      lastAccessAt: now,
      logicalExpiresAt,
      absoluteExpiresAt,
      expiresAt: absoluteExpiresAt,
    });
    const job = buildCustomerBiteSaverJobDocument({
      jobId: initialJobId,
      session,
      now,
    });
    const nextControl: ActiveControlDocument = Object.freeze({
      protocolVersion: customerBiteSaverSearchProtocolVersion,
      role: "callerControl",
      callerBindingHash,
      attemptGeneration,
      state: "active",
      unfinishedSessionIds: Object.freeze([
        ...unfinished.map((entry) => entry.sessionId),
        proposedSessionId,
      ]),
      recentStartsAtMs: Object.freeze([...recentStartsAtMs, nowMs]),
      recentRequests: Object.freeze([
        ...control.recentRequests.filter((entry) =>
          entry.createdAtMs > nowMs - customerBiteSaverAbsoluteExpiryMilliseconds),
        Object.freeze({
          clientRequestBinding,
          criteriaFingerprint,
          sessionId: proposedSessionId,
          createdAtMs: nowMs,
        }),
      ].slice(-customerBiteSaverStartRateLimit)),
      createdAt: control.createdAt ?? now,
      logicalExpiresAt,
      absoluteExpiresAt,
      expiresAt: absoluteExpiresAt,
    });
    const pointer: ActivePointerDocument = Object.freeze({
      protocolVersion: customerBiteSaverSearchProtocolVersion,
      role: "criteriaPointer",
      callerBindingHash,
      criteriaFingerprint,
      sessionId: proposedSessionId,
      attemptGeneration,
      state: "active",
      createdAt: now,
      logicalExpiresAt,
      absoluteExpiresAt,
      expiresAt: absoluteExpiresAt,
    });

    for (let index = 0; index < shards.length; index += 1) {
      if (shards[index] === null) {
        transaction.createDocument(shardPaths[index], {
          protocolVersion: customerBiteSaverSearchProtocolVersion,
          shardIndex: index,
          generation: 0,
          updatedAt: now,
        });
      }
    }
    transaction.createDocument(sessionPath(proposedSessionId), session);
    transaction.createDocument(path(
      privateCustomerBiteSaverJobCollection,
      initialJobId,
    ), job);
    transaction.setDocument(path(
      privateCustomerBiteSaverActiveSessionCollection,
      controlId,
    ), nextControl);
    transaction.setDocument(path(
      privateCustomerBiteSaverActiveSessionCollection,
      pointerId,
    ), pointer);
    transaction.createDocument(startReplayPath, buildStartRequestReplay({
      callerBindingHash,
      clientRequestBinding,
      requestFingerprint: startRequestFingerprint,
      session,
      now,
    }));
    return startResponse(session, context.secretKey);
  });
}

type BoundSessionRequest = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  clientRequestId: string;
  clientInstanceId: string;
  sessionId: string;
  capability: string;
  criteriaFingerprint: string;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseBoundSessionRequest(value: unknown): BoundSessionRequest {
  if (!isPlainRecord(value)) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const expected = [
    "schemaVersion",
    "clientRequestId",
    "clientInstanceId",
    "sessionId",
    "capability",
    "criteriaFingerprint",
  ].sort();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    value.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    typeof value.clientRequestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.clientRequestId) ||
    typeof value.clientInstanceId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.clientInstanceId) ||
    typeof value.criteriaFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.criteriaFingerprint)
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: value.clientRequestId,
    clientInstanceId: value.clientInstanceId,
    sessionId: requireCustomerBiteSaverSessionId(value.sessionId),
    capability: requireCustomerBiteSaverCapability(value.capability),
    criteriaFingerprint: value.criteriaFingerprint,
  });
}

export function authorizeCustomerBiteSaverSession(value: {
  request: BoundSessionRequest;
  session: CustomerBiteSaverSessionDocument | null;
  context: CustomerBiteSaverSessionContext;
  nowMs: number;
  allowExpired?: boolean;
}): CustomerBiteSaverSessionDocument {
  const session = value.session;
  if (session === null) {
    throw new CustomerBiteSaverContractError("not-found", "Search unavailable.");
  }
  const uid = requireAuthUid(value.context.identity);
  const scope = callerScope(value.context.identity);
  const binding = customerBiteSaverCallerBinding(value.context.secretKey, {
    scope,
    clientInstanceId: value.request.clientInstanceId,
    uid,
  });
  const capabilityHash = customerBiteSaverCapabilityHash(
    value.context.secretKey,
    value.request.capability,
  );
  if (
    session.sessionId !== value.request.sessionId ||
    session.criteriaFingerprint !== value.request.criteriaFingerprint ||
    session.callerScope !== scope ||
    session.callerBindingHash !== binding ||
    session.authenticatedUidHash !== authenticatedUidHash(
      value.context.secretKey,
      uid,
    ) ||
    !customerBiteSaverConstantTimeHexEqual(
      session.capabilityHash,
      capabilityHash,
    )
  ) {
    throw new CustomerBiteSaverContractError(
      "permission-denied",
      "Search unavailable.",
    );
  }
  if (
    value.nowMs >= session.logicalExpiresAt.getTime() ||
    value.nowMs >= session.absoluteExpiresAt.getTime() ||
    session.state === "expired"
  ) {
    if (value.allowExpired === true) {
      return session;
    }
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The search expired. Start a fresh search.",
    );
  }
  return session;
}

export type CustomerBiteSaverStatusResponse = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  state: CustomerBiteSaverSessionState;
  progress: Readonly<{
    phase: CustomerBiteSaverPreparationPhase;
    completedRanges: number;
    totalRanges: number;
  }>;
  failureCode: string | null;
  retriable: boolean;
  attemptGeneration: number;
  queryFingerprint: string;
  logicalExpiresAtMillis: number;
}>;

export async function getCustomerBiteSaverSearchStatusHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverStatusResponse> {
  const request = parseBoundSessionRequest(rawRequest);
  const nowMs = context.now?.() ?? Date.now();
  let session = await readAuthorizedSession(request, context, nowMs, {
    allowExpired: true,
  });
  const response = (): CustomerBiteSaverStatusResponse => {
    const completedRanges = session.progress.completedRestaurantRanges +
      session.progress.completedOfferRanges;
    const totalRanges = session.restaurantRanges.length +
      session.offerRanges.length;
    return Object.freeze({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      state: session.state,
      progress: Object.freeze({
        phase: session.phase,
        completedRanges,
        totalRanges,
      }),
      failureCode: session.failureCode,
      retriable: session.failureCode === "catalog_changed_repeatedly" ||
        session.failureCode === "preparation_failed",
      attemptGeneration: session.attemptGeneration,
      queryFingerprint: session.queryFingerprint,
      logicalExpiresAtMillis: session.logicalExpiresAt.getTime(),
    });
  };
  if (
    session.state === "expired" ||
    nowMs >= session.logicalExpiresAt.getTime() ||
    nowMs >= session.absoluteExpiresAt.getTime()
  ) {
    // Expiry remains an immediate status result and does not contend for the
    // live continuation gate. Materialize the terminal state only after the
    // read-only authorization has proved that this session is already dead.
    session = await loadAuthorizedSession(request, context, nowMs, {
      allowExpired: true,
    });
    return response();
  }
  return withCustomerBiteSaverRequestGate({
    context,
    session,
    clientRequestId: request.clientRequestId,
    endpoint: "status",
    nowMs,
    operation: async () => {
      session = await touchPreauthorizedSession(
        request,
        context,
        session,
        nowMs,
      );
      if (session.state === "preparing") {
        const jobSnapshot = await context.database.getDocument(path(
          privateCustomerBiteSaverJobCollection,
          session.currentJobId,
        ));
        if (jobSnapshot === null) {
          // A missing trigger work item can be recreated from immutable current
          // session state. `create` keeps later nudges idempotent.
          try {
            await context.database.commitWrites([{
              type: "create",
              path: path(
                privateCustomerBiteSaverJobCollection,
                session.currentJobId,
              ),
              data: buildCustomerBiteSaverJobDocument({
                jobId: session.currentJobId,
                session,
                now: new Date(nowMs),
              }),
            }]);
          } catch {
            // A prior request may have recreated the deterministic item.
          }
        }
      }
      return response();
    },
  });
}

export const customerBiteSaverSessionInternals = Object.freeze({
  parseBoundSessionRequest,
  parseSession,
  parsePrivatePreviewCandidate,
  parsePrivateSafeRestaurantSnapshot,
  validStoredCriteria,
  sessionPath,
  dateValue,
  parentCatalogGenerationFingerprint,
  projectedParentCatalogGenerationFingerprint,
  legacyFavoriteSaverRestaurantDocumentId,
  requestGateDocumentId,
});

type CustomerBiteSaverPageRequest = BoundSessionRequest & Readonly<{
  cursor: string | null;
  guestStateRevision: number | null;
}>;

type CustomerBiteSaverOfferPageRequest = CustomerBiteSaverPageRequest &
  Readonly<{restaurantId: string}>;

type CustomerBiteSaverResultDocument = Readonly<{
  id: string;
  authoritativeAccountId: string;
  publicRestaurantId: string;
  parentProjectionFingerprint: string;
  parentOfferCatalogFingerprint: string | null;
  exactPreferenceRank: number;
  distanceSortMiles: number;
  distanceMiles: number;
  lowercaseDisplayNameOrderKey: string;
  authoritativeAccountIdOrderKey: Buffer;
  parentMatches: boolean;
  offerMatches: boolean;
  usableOfferCountAtPreparation: number;
  safeRestaurantSnapshot: Readonly<Record<string, unknown>>;
  previewDailyCandidates: readonly Readonly<Record<string, unknown>>[];
  previewCouponCandidates: readonly Readonly<Record<string, unknown>>[];
  offerCatalogFingerprint: string;
}>;

const privateSafeRestaurantSnapshotKeys = Object.freeze([
  "bio",
  "biteSaverCatalogBindingId",
  "biteScoreCatalogRestaurantId",
  "businessHours",
  "city",
  "displayName",
  "formattedAddress",
  "phone",
  "primaryImageUrl",
  "state",
  "streetAddress",
  "website",
  "zipCode",
].sort());

const privateBusinessHoursKeys = Object.freeze([
  "closed",
  "closesAt",
  "day",
  "opensAt",
].sort());

const privateBusinessDayNames = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]);

const privatePreviewCandidateKeys = Object.freeze([
  "indexDocumentId",
  "offerType",
  "sourceCreatedAtMs",
  "sourceCreatedAtOrderKey",
  "sourceDocumentId",
  "sourceFingerprint",
].sort());

const privateResultDocumentKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "authoritativeAccountId",
  "authoritativeAccountIdOrderKey",
  "callerBindingHash",
  "createdAt",
  "criteriaFingerprint",
  "distanceMiles",
  "distanceSortMiles",
  "eligibleAtPreparation",
  "exactPreferenceRank",
  "expiresAt",
  "logicalExpiresAt",
  "lowercaseDisplayNameOrderKey",
  "offerCatalogFingerprint",
  "offerMatches",
  "parentMatches",
  "parentOfferCatalogFingerprint",
  "parentProjectionDocumentId",
  "parentProjectionFingerprint",
  "previewCouponCandidates",
  "previewDailyCandidates",
  "protocolVersion",
  "publicRestaurantId",
  "queryFingerprint",
  "safeRestaurantSnapshot",
  "sessionId",
  "state",
  "usableOfferCountAtPreparation",
].sort());

export type CustomerBiteSaverPublicOfferDto = Readonly<{
  offerId: string;
  offerOccurrence: string;
  offerType: "coupon" | "dailySpecial";
  title: string;
  details: string | null;
  couponCode: string | null;
  couponNumber: string | null;
  usageRule: string | null;
  availabilityMode: string | null;
  daysOfWeek: readonly number[];
  allDay: boolean | null;
  startTime: string | null;
  endTime: string | null;
  startAtMillis: number | null;
  endAtMillis: number | null;
  expiresAtMillis: number | null;
  expiresText: string | null;
  isProximityOnly: boolean;
  proximityRadiusMiles: number | null;
  imageUrl: string | null;
  sourceCreatedAtMillis: number;
  available: boolean;
  availabilityReason: string;
  redemptionPolicyLabel: string | null;
  activeTimerExpiresAtMillis: number | null;
  nextAvailableAtMillis: number | null;
  usageState: "available" | "unavailable" | "unknown";
}>;

export type CustomerBiteSaverPublicRestaurantDto = Readonly<{
  restaurantId: string;
  displayName: string;
  streetAddress: string | null;
  city: string;
  state: string;
  zipCode: string;
  formattedAddress: string | null;
  imageUrl: string | null;
  phone: string | null;
  website: string | null;
  businessHours: readonly unknown[];
  bio: string | null;
  distanceMiles: number;
  isLocal: boolean;
  catalogBindingAvailable: boolean;
  offers: readonly CustomerBiteSaverPublicOfferDto[];
  hasMoreOffers: boolean;
  usableOfferCount: number | null;
  offerCountState: "current" | "unknown";
  favoriteState: "unknown";
}>;

function parsePageRequest(
  value: unknown,
  offerPage: boolean,
): CustomerBiteSaverPageRequest | CustomerBiteSaverOfferPageRequest {
  if (!isPlainRecord(value)) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const required = [
    "schemaVersion",
    "clientRequestId",
    "clientInstanceId",
    "sessionId",
    "capability",
    "criteriaFingerprint",
    "cursor",
    "guestStateRevision",
    ...(offerPage ? ["restaurantId"] : []),
  ].sort();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== required.length ||
    keys.some((key, index) => key !== required[index]) ||
    (value.cursor !== null &&
      (typeof value.cursor !== "string" || value.cursor.length > 32_768)) ||
    (value.guestStateRevision !== null &&
      (typeof value.guestStateRevision !== "number" ||
        !Number.isSafeInteger(value.guestStateRevision) ||
        value.guestStateRevision < 0))
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const base = parseBoundSessionRequest({
    schemaVersion: value.schemaVersion,
    clientRequestId: value.clientRequestId,
    clientInstanceId: value.clientInstanceId,
    sessionId: value.sessionId,
    capability: value.capability,
    criteriaFingerprint: value.criteriaFingerprint,
  });
  const parsed = Object.freeze({
    ...base,
    cursor: value.cursor as string | null,
    guestStateRevision: value.guestStateRevision as number | null,
  });
  if (!offerPage) {
    return parsed;
  }
  if (
    typeof value.restaurantId !== "string" ||
    !/^bsr_[A-Za-z0-9_-]{43}$/u.test(value.restaurantId)
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  return Object.freeze({...parsed, restaurantId: value.restaurantId});
}

function requireGuestStateRevisionForCaller(
  revision: number | null,
  context: CustomerBiteSaverSessionContext,
): number | null {
  const guest = requireAuthUid(context.identity) === null;
  if ((guest && revision === null) || (!guest && revision !== null)) {
    throw new CustomerBiteSaverContractError(
      "invalid-argument",
      guest
        ? "A guest-state revision is required."
        : "Signed-in availability is server-authoritative.",
    );
  }
  return revision;
}

function privateStringWithinLimit(
  value: unknown,
  maximumCodePoints: number,
  allowEmpty = true,
): value is string {
  if (
    typeof value !== "string" ||
    !hasWellFormedCustomerBiteSaverUtf16(value) ||
    Buffer.byteLength(value, "utf8") > maximumCodePoints * 4
  ) {
    return false;
  }
  return (allowEmpty || value.length > 0) &&
    Array.from(value).length <= maximumCodePoints;
}

function privateNullableStringWithinLimit(
  value: unknown,
  maximumCodePoints: number,
): value is string | null {
  return value === null || privateStringWithinLimit(value, maximumCodePoints);
}

function privateIndexedUtf16OrderKey(value: unknown): value is string {
  return typeof value === "string" &&
    /^(?:[0-9a-f]{4})+$/u.test(value) &&
    Buffer.byteLength(value, "utf8") <= 1_500;
}

function privateIndexedUtf16BytesOrderKey(value: unknown): Buffer | null {
  return parseDartUtf16FirestoreBytesOrderKey(
    value,
    customerBiteSaverMaximumIndexedOrderKeyBytes,
  );
}

function accountIdOrderKeyCursorValue(value: unknown): string | null {
  return value instanceof Uint8Array
    ? dartUtf16FirestoreBytesCursorValue(
        value,
        customerBiteSaverMaximumIndexedOrderKeyBytes,
      )
    : null;
}

function parsePrivateSafeRestaurantSnapshot(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (!hasExactRecordKeys(value, privateSafeRestaurantSnapshotKeys)) {
    return null;
  }
  if (
    !privateStringWithinLimit(value.displayName, 200, false) ||
    !privateNullableStringWithinLimit(value.streetAddress, 200) ||
    !privateStringWithinLimit(value.city, 100) ||
    !privateStringWithinLimit(value.state, 100) ||
    !privateStringWithinLimit(value.zipCode, 20) ||
    !privateNullableStringWithinLimit(value.formattedAddress, 500) ||
    !privateNullableStringWithinLimit(value.primaryImageUrl, 2_000) ||
    !privateNullableStringWithinLimit(value.phone, 50) ||
    !privateNullableStringWithinLimit(value.website, 500) ||
    !privateNullableStringWithinLimit(value.bio, 2_000) ||
    !privateNullableStringWithinLimit(
      value.biteScoreCatalogRestaurantId,
      1_500,
    ) ||
    !privateNullableStringWithinLimit(value.biteSaverCatalogBindingId, 1_500) ||
    !Array.isArray(value.businessHours) ||
    (value.businessHours.length !== 0 && value.businessHours.length !== 7)
  ) {
    return null;
  }
  const seenDays = new Set<string>();
  const businessHours = value.businessHours.map((entry) => {
    if (
      !hasExactRecordKeys(entry, privateBusinessHoursKeys) ||
      typeof entry.day !== "string" ||
      !privateBusinessDayNames.includes(entry.day) ||
      seenDays.has(entry.day) ||
      !privateStringWithinLimit(entry.opensAt, 40, false) ||
      !privateStringWithinLimit(entry.closesAt, 40, false) ||
      typeof entry.closed !== "boolean"
    ) {
      return null;
    }
    seenDays.add(entry.day);
    return Object.freeze({
      day: entry.day,
      opensAt: entry.opensAt,
      closesAt: entry.closesAt,
      closed: entry.closed,
    });
  });
  if (
    businessHours.some((entry) => entry === null) ||
    (businessHours.length === 7 &&
      privateBusinessDayNames.some((day) => !seenDays.has(day)))
  ) {
    return null;
  }
  return Object.freeze({
    displayName: value.displayName,
    streetAddress: value.streetAddress,
    city: value.city,
    state: value.state,
    zipCode: value.zipCode,
    formattedAddress: value.formattedAddress,
    primaryImageUrl: value.primaryImageUrl,
    phone: value.phone,
    website: value.website,
    businessHours: Object.freeze(businessHours),
    bio: value.bio,
    biteScoreCatalogRestaurantId: value.biteScoreCatalogRestaurantId,
    biteSaverCatalogBindingId: value.biteSaverCatalogBindingId,
  });
}

function parsePrivatePreviewCandidate(
  value: unknown,
  expectedOfferType?: "coupon" | "dailySpecial",
): ParsedPreviewCandidate | null {
  if (!hasExactRecordKeys(value, privatePreviewCandidateKeys)) {
    return null;
  }
  const offerType = value.offerType;
  const sourceDocumentId = exactInternalId(value.sourceDocumentId);
  const indexDocumentId = exactString(value.indexDocumentId, /^si_[0-9a-f]{64}$/u);
  const sourceCreatedAtOrderKey = value.sourceCreatedAtOrderKey;
  if (
    (offerType !== "coupon" && offerType !== "dailySpecial") ||
    (expectedOfferType !== undefined && offerType !== expectedOfferType) ||
    sourceDocumentId === null ||
    indexDocumentId === null ||
    safeInteger(value.sourceCreatedAtMs) === null ||
    !isCustomerBiteSaverTimestampOrderKey(sourceCreatedAtOrderKey) ||
    exactString(value.sourceFingerprint, /^[0-9a-f]{64}$/u) === null
  ) {
    return null;
  }
  return Object.freeze({
    offerType,
    sourceDocumentId,
    indexDocumentId,
    sourceCreatedAtMs: value.sourceCreatedAtMs as number,
    sourceCreatedAtOrderKey,
    sourceFingerprint: value.sourceFingerprint as string,
  });
}

function invalidPrivateResultState(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "The BiteSaver result state is invalid.",
  );
}

function parseResultDocument(
  document: CustomerBiteSaverStoredDocument | null,
  session: CustomerBiteSaverSessionDocument,
  secretKey: Uint8Array,
): CustomerBiteSaverResultDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  const safeRestaurantSnapshot = parsePrivateSafeRestaurantSnapshot(
    data.safeRestaurantSnapshot,
  );
  const authoritativeAccountIdOrderKey = privateIndexedUtf16BytesOrderKey(
    data.authoritativeAccountIdOrderKey,
  );
  const previewDailyCandidates =
    Array.isArray(data.previewDailyCandidates) &&
      data.previewDailyCandidates.length <=
        customerBiteSaverPreviewCandidateRetentionLimit
      ? data.previewDailyCandidates.map((entry) =>
          parsePrivatePreviewCandidate(entry, "dailySpecial"))
      : null;
  const previewCouponCandidates =
    Array.isArray(data.previewCouponCandidates) &&
      data.previewCouponCandidates.length <=
        customerBiteSaverPreviewCandidateRetentionLimit
      ? data.previewCouponCandidates.map((entry) =>
          parsePrivatePreviewCandidate(entry, "coupon"))
      : null;
  if (
    document.path !== path(privateCustomerBiteSaverResultCollection, document.id) ||
    exactString(document.id, /^bsrrow_[A-Za-z0-9_-]{43}$/u) === null ||
    !hasExactRecordKeys(data, privateResultDocumentKeys) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.sessionId !== session.sessionId ||
    data.attemptGeneration !== session.attemptGeneration ||
    data.criteriaFingerprint !== session.criteriaFingerprint ||
    data.queryFingerprint !== session.queryFingerprint ||
    data.callerBindingHash !== session.callerBindingHash ||
    data.state !== "result" ||
    data.eligibleAtPreparation !== true ||
    exactInternalId(data.authoritativeAccountId) === null ||
    exactString(data.publicRestaurantId, /^bsr_[A-Za-z0-9_-]{43}$/u) === null ||
    data.publicRestaurantId !== customerBiteSaverOpaqueRestaurantId(
      secretKey,
      data.authoritativeAccountId as string,
    ) ||
    document.id !== customerBiteSaverResultDocumentId(
      secretKey,
      session.sessionId,
      session.attemptGeneration,
      data.publicRestaurantId as string,
    ) ||
    exactString(data.parentProjectionDocumentId, /^si_[0-9a-f]{64}$/u) === null ||
    exactString(data.parentProjectionFingerprint, /^[0-9a-f]{64}$/u) === null ||
    exactString(data.parentOfferCatalogFingerprint, /^[0-9a-f]{64}$/u) ===
      null ||
    (data.exactPreferenceRank !== 0 && data.exactPreferenceRank !== 1) ||
    typeof data.distanceSortMiles !== "number" ||
    !Number.isFinite(data.distanceSortMiles) ||
    data.distanceSortMiles < 0 ||
    typeof data.distanceMiles !== "number" ||
    !Number.isFinite(data.distanceMiles) ||
    data.distanceMiles < 0 ||
    data.distanceMiles > session.criteria.radiusMiles ||
    (data.exactPreferenceRank === 0
      ? data.distanceSortMiles !== 0
      : data.distanceSortMiles !== data.distanceMiles) ||
    !privateIndexedUtf16OrderKey(data.lowercaseDisplayNameOrderKey) ||
    authoritativeAccountIdOrderKey === null ||
    typeof data.parentMatches !== "boolean" ||
    typeof data.offerMatches !== "boolean" ||
    typeof data.usableOfferCountAtPreparation !== "number" ||
    !Number.isSafeInteger(data.usableOfferCountAtPreparation) ||
    data.usableOfferCountAtPreparation < 1 ||
    safeRestaurantSnapshot === null ||
    previewDailyCandidates === null ||
    previewDailyCandidates.some((entry) => entry === null) ||
    previewCouponCandidates === null ||
    previewCouponCandidates.some((entry) => entry === null) ||
    exactString(data.offerCatalogFingerprint, /^[0-9a-f]{64}$/u) === null ||
    createdAt === null || logicalExpiresAt === null ||
    absoluteExpiresAt === null || expiresAt === null ||
    createdAt.getTime() < session.createdAt.getTime() ||
    createdAt.getTime() >= session.absoluteExpiresAt.getTime() ||
    logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    absoluteExpiresAt.getTime() !== session.absoluteExpiresAt.getTime() ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime()
  ) {
    return invalidPrivateResultState();
  }
  try {
    if (
      !authoritativeAccountIdOrderKey.equals(
        dartUtf16FirestoreBytesOrderKey(
          data.authoritativeAccountId as string,
        ),
      ) ||
      data.lowercaseDisplayNameOrderKey !== lowercaseDisplayNameOrderKey(
        safeRestaurantSnapshot.displayName as string,
      )
    ) {
      return invalidPrivateResultState();
    }
  } catch {
    return invalidPrivateResultState();
  }
  const parsedDaily = previewDailyCandidates as readonly ParsedPreviewCandidate[];
  const parsedCoupons = previewCouponCandidates as readonly ParsedPreviewCandidate[];
  const previewIdentities = [...parsedDaily, ...parsedCoupons].map((entry) =>
    `${entry.offerType}\0${entry.sourceDocumentId}\0${entry.indexDocumentId}`);
  if (new Set(previewIdentities).size !== previewIdentities.length) {
    return invalidPrivateResultState();
  }
  return Object.freeze({
    id: document.id,
    authoritativeAccountId: data.authoritativeAccountId as string,
    publicRestaurantId: data.publicRestaurantId as string,
    parentProjectionFingerprint: data.parentProjectionFingerprint as string,
    parentOfferCatalogFingerprint: data.parentOfferCatalogFingerprint as string,
    exactPreferenceRank: data.exactPreferenceRank,
    distanceSortMiles: data.distanceSortMiles,
    distanceMiles: data.distanceMiles,
    lowercaseDisplayNameOrderKey: data.lowercaseDisplayNameOrderKey as string,
    authoritativeAccountIdOrderKey,
    parentMatches: data.parentMatches as boolean,
    offerMatches: data.offerMatches as boolean,
    usableOfferCountAtPreparation: data.usableOfferCountAtPreparation as number,
    safeRestaurantSnapshot,
    previewDailyCandidates: Object.freeze(parsedDaily),
    previewCouponCandidates: Object.freeze(parsedCoupons),
    offerCatalogFingerprint: data.offerCatalogFingerprint as string,
  });
}

export function customerBiteSaverOrderedResultQuery(value: {
  session: CustomerBiteSaverSessionDocument;
  startAfter?: readonly unknown[];
  limit?: number;
}): Parameters<CustomerBiteSaverSearchDatabase["queryDocuments"]>[0] {
  const filters: Parameters<
    CustomerBiteSaverSearchDatabase["queryDocuments"]
  >[0]["filters"] = Object.freeze([
    {field: "sessionId", operation: "==", value: value.session.sessionId},
    {
      field: "attemptGeneration",
      operation: "==",
      value: value.session.attemptGeneration,
    },
    {field: "eligibleAtPreparation", operation: "==", value: true},
  ]);
  const orders: Parameters<
    CustomerBiteSaverSearchDatabase["queryDocuments"]
  >[0]["orders"] = Object.freeze([
    {field: "exactPreferenceRank", direction: "asc"},
    {field: "distanceSortMiles", direction: "asc"},
    {field: "lowercaseDisplayNameOrderKey", direction: "asc"},
    {field: "authoritativeAccountIdOrderKey", direction: "asc"},
  ]);
  const limit = value.limit ?? customerBiteSaverPageLookahead;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit >
      customerBiteSaverPageLookahead) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  let startAfter: readonly unknown[] | undefined;
  if (value.startAfter !== undefined) {
    const parsed = parseRestaurantResultSortTuple(value.startAfter);
    const accountIdOrderKey = parsed === null
      ? null
      : parseDartUtf16FirestoreBytesCursorValue(
          parsed[3],
          customerBiteSaverMaximumIndexedOrderKeyBytes,
        );
    if (parsed === null || accountIdOrderKey === null) {
      throw new CustomerBiteSaverContractError(
        "invalid-argument",
        "The BiteSaver restaurant cursor is invalid.",
      );
    }
    startAfter = Object.freeze([
      parsed[0],
      parsed[1],
      parsed[2],
      accountIdOrderKey,
    ]);
  }
  return Object.freeze({
    collectionPath: privateCustomerBiteSaverResultCollection,
    filters,
    orders,
    ...(startAfter === undefined ? {} : {startAfter}),
    limit,
  });
}

function guestStateFingerprint(revision: number | null): string {
  return createQueryFingerprint({guestStateRevision: revision});
}

function pageRequestFingerprint(value: {
  purpose: "restaurantPage" | "offerPage";
  cursor: string | null;
  guestStateRevision: number | null;
  restaurantPublicId: string | null;
}): string {
  return createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    purpose: value.purpose,
    cursor: value.cursor,
    guestStateRevision: value.guestStateRevision,
    restaurantPublicId: value.restaurantPublicId,
  });
}

function callerCapabilityBindingFor(
  context: CustomerBiteSaverSessionContext,
  session: CustomerBiteSaverSessionDocument,
): string {
  return customerBiteSaverCallerCapabilityBinding(
    context.secretKey,
    session.callerBindingHash,
    session.capabilityHash,
  );
}

function requestCallerCapabilityBindingFor(
  context: CustomerBiteSaverSessionContext,
  request: BoundSessionRequest,
): string {
  const uid = requireAuthUid(context.identity);
  return customerBiteSaverCallerCapabilityBinding(
    context.secretKey,
    customerBiteSaverCallerBinding(context.secretKey, {
      scope: callerScope(context.identity),
      clientInstanceId: request.clientInstanceId,
      uid,
    }),
    customerBiteSaverCapabilityHash(context.secretKey, request.capability),
  );
}

function preflightPageCursorForRequest(value: {
  payload: CustomerBiteSaverCursorPayload;
  request: BoundSessionRequest;
  context: CustomerBiteSaverSessionContext;
  purpose: "restaurantPage" | "offerPage";
  restaurantPublicId: string | null;
  guestStateFingerprint: string;
}): void {
  if (
    value.payload.purpose !== value.purpose ||
    value.payload.sessionId !== value.request.sessionId ||
    value.payload.restaurantPublicId !== value.restaurantPublicId ||
    value.payload.guestStateFingerprint !==
      value.guestStateFingerprint ||
    !customerBiteSaverConstantTimeHexEqual(
      value.payload.callerCapabilityBinding,
      requestCallerCapabilityBindingFor(value.context, value.request),
    )
  ) {
    throw new CustomerBiteSaverContractError(
      "invalid-argument",
      "The BiteSaver page cursor is invalid or expired.",
    );
  }
}

function preflightOfferOccurrenceForRequest(value: {
  payload: CustomerBiteSaverOfferOccurrencePayload;
  request: CustomerBiteSaverRedemptionRequest;
  context: CustomerBiteSaverSessionContext;
}): void {
  if (
    value.payload.sessionId !== value.request.sessionId ||
    value.payload.restaurantPublicId !== value.request.restaurantId ||
    value.payload.offerPublicId !== value.request.offerId ||
    value.payload.guestStateFingerprint !== guestStateFingerprint(
      value.request.guestStateRevision,
    ) ||
    !customerBiteSaverConstantTimeHexEqual(
      value.payload.callerCapabilityBinding,
      requestCallerCapabilityBindingFor(value.context, value.request),
    )
  ) {
    throw new CustomerBiteSaverContractError(
      "invalid-argument",
      "The BiteSaver offer occurrence is invalid or expired.",
    );
  }
}

async function loadAuthorizedSession(
  request: BoundSessionRequest,
  context: CustomerBiteSaverSessionContext,
  nowMs: number,
  options: Readonly<{allowExpired?: boolean}> = {},
): Promise<CustomerBiteSaverSessionDocument> {
  return context.database.runTransaction(async (transaction) => {
    const snapshot = await transaction.getDocument(sessionPath(request.sessionId));
    const session = authorizeCustomerBiteSaverSession({
      request,
      session: parseSession(snapshot),
      context,
      nowMs,
      allowExpired: options.allowExpired,
    });
    const expired = session.state === "expired" ||
      nowMs >= session.logicalExpiresAt.getTime() ||
      nowMs >= session.absoluteExpiresAt.getTime();
    if (expired) {
      const jobSnapshot = session.state === "preparing"
        ? await transaction.getDocument(path(
            privateCustomerBiteSaverJobCollection,
            session.currentJobId,
          ))
        : null;
      const expiredSession: CustomerBiteSaverSessionDocument = Object.freeze({
        ...session,
        state: "expired",
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      });
      if (snapshot !== null && session.state !== "expired") {
        transaction.setDocument(snapshot.path, expiredSession);
      }
      if (
        jobSnapshot !== null &&
        jobSnapshot.data.sessionId === session.sessionId &&
        jobSnapshot.data.attemptGeneration === session.attemptGeneration &&
        jobSnapshot.data.state !== "completed" &&
        jobSnapshot.data.state !== "invalid" &&
        jobSnapshot.data.state !== "expired"
      ) {
        transaction.setDocument(jobSnapshot.path, {
          ...jobSnapshot.data,
          state: "expired",
          completedAt: new Date(nowMs),
          leaseId: null,
          leaseExpiresAt: null,
        });
      }
      return expiredSession;
    }
    return touchSessionInTransaction(transaction, session, nowMs);
  });
}

async function readAuthorizedSession(
  request: BoundSessionRequest,
  context: CustomerBiteSaverSessionContext,
  nowMs: number,
  options: Readonly<{allowExpired?: boolean}> = {},
): Promise<CustomerBiteSaverSessionDocument> {
  const snapshot = await context.database.getDocument(
    sessionPath(request.sessionId),
  );
  const parsed = parseSession(snapshot);
  if (snapshot !== null && parsed === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver session state is invalid.",
    );
  }
  return authorizeCustomerBiteSaverSession({
    request,
    session: parsed,
    context,
    nowMs,
    allowExpired: options.allowExpired,
  });
}

async function touchPreauthorizedSession(
  request: BoundSessionRequest,
  context: CustomerBiteSaverSessionContext,
  preauthorized: CustomerBiteSaverSessionDocument,
  nowMs: number,
): Promise<CustomerBiteSaverSessionDocument> {
  return context.database.runTransaction(async (transaction) => {
    const snapshot = await transaction.getDocument(
      sessionPath(request.sessionId),
    );
    const parsed = parseSession(snapshot);
    if (snapshot !== null && parsed === null) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver session state is invalid.",
      );
    }
    const current = authorizeCustomerBiteSaverSession({
      request,
      session: parsed,
      context,
      nowMs,
    });
    if (
      current.sessionId !== preauthorized.sessionId ||
      current.attemptGeneration !== preauthorized.attemptGeneration ||
      current.queryFingerprint !== preauthorized.queryFingerprint ||
      current.criteriaFingerprint !== preauthorized.criteriaFingerprint ||
      current.callerBindingHash !== preauthorized.callerBindingHash ||
      current.capabilityHash !== preauthorized.capabilityHash ||
      current.state !== preauthorized.state ||
      current.phase !== preauthorized.phase ||
      current.absoluteExpiresAt.getTime() !==
        preauthorized.absoluteExpiresAt.getTime()
    ) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver session changed. Retry with current state.",
      );
    }
    return touchSessionInTransaction(transaction, current, nowMs);
  });
}

// Cloud Functions forcibly terminates every BiteSaver callable before this
// lease can be taken over, so an earlier invocation cannot remain alive and
// commit after a successor acquires the per-session gate.
export const customerBiteSaverCallableTimeoutSeconds = 120;
export const customerBiteSaverRequestGateLeaseMilliseconds = 180_000;
const customerBiteSaverRequestGateKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "callerCapabilityBinding",
  "createdAt",
  "expiresAt",
  "leaseBinding",
  "leaseExpiresAt",
  "logicalExpiresAt",
  "protocolVersion",
  "requestBinding",
  "role",
  "schemaVersion",
  "sessionId",
  "state",
].sort());

function requestGateDocumentId(
  key: Uint8Array,
  session: CustomerBiteSaverSessionDocument,
): string {
  return customerBiteSaverDeterministicId(
    key,
    "bsgate",
    "sessionContinuationGate",
    [
      session.sessionId,
      session.attemptGeneration.toString(10),
      session.callerBindingHash,
      session.capabilityHash,
    ],
  );
}

async function withCustomerBiteSaverRequestGate<T>(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  clientRequestId: string;
  endpoint: "status" | "restaurantPage" | "offerPage" |
    "redemptionStart" | "guestOfferCheckAnswer";
  nowMs: number;
  operation: () => Promise<T>;
}): Promise<T> {
  const gateId = requestGateDocumentId(
    value.context.secretKey,
    value.session,
  );
  const gatePath = path(
    privateCustomerBiteSaverActiveSessionCollection,
    gateId,
  );
  const requestBinding = customerBiteSaverDeterministicId(
    value.context.secretKey,
    "bsgrq",
    "sessionContinuationRequest",
    [value.endpoint, value.clientRequestId],
  );
  const entropy = (value.context.randomSource ?? randomBytes)(32);
  if (!(entropy instanceof Uint8Array) || entropy.length !== 32) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const leaseBinding = customerBiteSaverDeterministicId(
    value.context.secretKey,
    "bsgls",
    "sessionContinuationLease",
    [requestBinding, Buffer.from(entropy).toString("base64url")],
  );
  const leaseExpiresAtMs = Math.min(
    value.session.absoluteExpiresAt.getTime(),
    value.nowMs + customerBiteSaverRequestGateLeaseMilliseconds,
  );
  await value.context.database.runTransaction(async (transaction) => {
    const existing = await transaction.getDocument(gatePath);
    if (existing !== null) {
      const existingKeys = Object.keys(existing.data).sort();
      const existingCreatedAt = dateValue(existing.data.createdAt);
      const existingLeaseExpiresAt = dateValue(existing.data.leaseExpiresAt);
      const existingLogicalExpiresAt = dateValue(
        existing.data.logicalExpiresAt,
      );
      const existingAbsoluteExpiresAt = dateValue(
        existing.data.absoluteExpiresAt,
      );
      const existingExpiresAt = dateValue(existing.data.expiresAt);
      if (
        existing.id !== gateId ||
        existing.path !== gatePath ||
        existingKeys.length !== customerBiteSaverRequestGateKeys.length ||
        existingKeys.some((key, index) =>
          key !== customerBiteSaverRequestGateKeys[index]) ||
        existing.data.protocolVersion !==
          customerBiteSaverSearchProtocolVersion ||
        existing.data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
        existing.data.role !== "sessionContinuationGate" ||
        existing.data.state !== "processing" ||
        existing.data.sessionId !== value.session.sessionId ||
        existing.data.attemptGeneration !==
          value.session.attemptGeneration ||
        existing.data.callerCapabilityBinding !==
          callerCapabilityBindingFor(value.context, value.session) ||
        typeof existing.data.requestBinding !== "string" ||
        !/^bsgrq_[A-Za-z0-9_-]{43}$/u.test(existing.data.requestBinding) ||
        typeof existing.data.leaseBinding !== "string" ||
        !/^bsgls_[A-Za-z0-9_-]{43}$/u.test(existing.data.leaseBinding) ||
        existingCreatedAt === null ||
        existingLeaseExpiresAt === null ||
        existingLogicalExpiresAt === null ||
        existingAbsoluteExpiresAt === null ||
        existingExpiresAt === null ||
        existingLeaseExpiresAt.getTime() <= existingCreatedAt.getTime() ||
        existingLeaseExpiresAt.getTime() >
          existingAbsoluteExpiresAt.getTime() ||
        existingLogicalExpiresAt.getTime() !==
          existingAbsoluteExpiresAt.getTime() ||
        existingExpiresAt.getTime() !== existingAbsoluteExpiresAt.getTime()
      ) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver request gate state is invalid.",
        );
      }
      if (existingLeaseExpiresAt.getTime() > value.nowMs) {
        throw new CustomerBiteSaverContractError(
          "resource-exhausted",
          "Another BiteSaver continuation is already in progress.",
        );
      }
    }
    const absoluteExpiresAt = new Date(
      value.session.absoluteExpiresAt.getTime(),
    );
    transaction.setDocument(gatePath, Object.freeze({
      protocolVersion: customerBiteSaverSearchProtocolVersion,
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      role: "sessionContinuationGate",
      state: "processing",
      sessionId: value.session.sessionId,
      attemptGeneration: value.session.attemptGeneration,
      callerCapabilityBinding: callerCapabilityBindingFor(
        value.context,
        value.session,
      ),
      requestBinding,
      leaseBinding,
      leaseExpiresAt: new Date(leaseExpiresAtMs),
      createdAt: new Date(value.nowMs),
      logicalExpiresAt: absoluteExpiresAt,
      absoluteExpiresAt,
      expiresAt: absoluteExpiresAt,
    }));
  });
  try {
    return await value.operation();
  } finally {
    try {
      await value.context.database.runTransaction(async (transaction) => {
        const current = await transaction.getDocument(gatePath);
        if (current?.data.leaseBinding === leaseBinding) {
          transaction.deleteDocument(gatePath);
        }
      });
    } catch {
      // A stale gate expires after the short source-level lease. Never mask the
      // endpoint result with cleanup transport details.
    }
  }
}

type CurrentParent = Readonly<{
  result: CustomerBiteSaverResultDocument;
  raw: Readonly<Record<string, unknown>>;
  projection: Readonly<Record<string, unknown>>;
  safeSnapshot: Readonly<Record<string, unknown>>;
  coordinates: Readonly<{latitude: number; longitude: number}>;
  offerCatalogFingerprint: string;
  catalogGenerationUnchanged: boolean;
}>;

type ParsedPreviewCandidate = Readonly<{
  offerType: "coupon" | "dailySpecial";
  sourceDocumentId: string;
  indexDocumentId: string;
  sourceCreatedAtMs: number;
  sourceCreatedAtOrderKey: string;
  sourceFingerprint: string;
}>;

type CurrentOffer = Readonly<{
  authoritativeAccountId: string;
  offerType: "coupon" | "dailySpecial";
  sourceDocumentId: string;
  publicOfferId: string;
  raw: Readonly<Record<string, unknown>>;
  projection: Readonly<Record<string, unknown>>;
  decision: CustomerBiteSaverAvailabilityDecision;
  usageGeneration: string;
}>;

function signedPageLogicalExpiresAtMs(value: {
  session: CustomerBiteSaverSessionDocument;
  evaluationAtMs: number;
  supportingOffers: readonly CurrentOffer[];
}): number {
  let logicalExpiresAtMs = Math.min(
    value.evaluationAtMs + customerBiteSaverCursorLifetimeMilliseconds,
    value.session.logicalExpiresAt.getTime(),
    value.session.absoluteExpiresAt.getTime(),
  );
  if (
    !Number.isSafeInteger(logicalExpiresAtMs) ||
    logicalExpiresAtMs <= value.evaluationAtMs
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver page request replay has expired.",
    );
  }
  for (const offer of value.supportingOffers) {
    const deadline = offer.decision.eligibilityExpiresAtMs;
    if (deadline === null) {
      continue;
    }
    if (!Number.isSafeInteger(deadline) || deadline <= value.evaluationAtMs) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver offer availability state is invalid.",
      );
    }
    logicalExpiresAtMs = Math.min(logicalExpiresAtMs, deadline);
  }
  return logicalExpiresAtMs;
}

function expiredSignedPageReplay(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "The BiteSaver page request replay has expired.",
  );
}

async function commitSignedPageResponse(value: {
  context: CustomerBiteSaverSessionContext;
  replayInput: CustomerBiteSaverRequestReplayInput & Readonly<{
    purpose: "restaurantPage" | "offerPage";
  }>;
  evaluationAtMs: number;
  logicalExpiresAtMs: number;
  writes: readonly CustomerBiteSaverWrite[];
}): Promise<void> {
  const live = await value.context.database.runTransaction(
    async (transaction) => {
      // Read and monotonically bind the replay tombstone before queuing any
      // successful page-issuance evidence. Calling the actual clock inside the
      // callback makes a Firestore retry recheck the deadline rather than
      // inheriting the request-entry time.
      const bindingStartedAtMs = contextNow(value.context);
      const binding =
        await bindCustomerBiteSaverRequestReplayDeadlineInTransaction({
          secretKey: value.replayInput.secretKey,
          sessionId: value.replayInput.sessionId,
          attemptGeneration: value.replayInput.attemptGeneration,
          callerCapabilityBinding:
            value.replayInput.callerCapabilityBinding,
          purpose: value.replayInput.purpose,
          clientRequestId: value.replayInput.clientRequestId,
          requestFingerprint: value.replayInput.requestFingerprint,
          evaluationAtMs: value.evaluationAtMs,
          logicalExpiresAtMs: value.logicalExpiresAtMs,
          absoluteSessionExpiresAt:
            value.replayInput.absoluteSessionExpiresAt,
          nowMs: bindingStartedAtMs,
        }, transaction);
      // The replay read itself is awaited. Re-read the clock afterwards so a
      // cutoff crossed during that read, or during a retried callback, cannot
      // authorize the evidence writes below.
      if (
        !binding.live ||
        contextNow(value.context) >= binding.logicalExpiresAtMs
      ) {
        return false;
      }
      for (const write of value.writes) {
        if (write.type === "create") {
          transaction.createDocument(write.path, write.data);
        } else if (write.type === "set") {
          transaction.setDocument(write.path, write.data);
        } else {
          transaction.deleteDocument(write.path);
        }
      }
      return true;
    });
  if (!live) {
    return expiredSignedPageReplay();
  }
}

function exactInternalId(value: unknown): string | null {
  return typeof value === "string" &&
      value.length > 0 && value.length <= 1_500 && !value.includes("/")
    ? value
    : null;
}

function exactIndexedInternalId(value: unknown): string | null {
  const parsed = exactInternalId(value);
  return parsed !== null &&
      hasWellFormedCustomerBiteSaverUtf16(parsed) &&
      Buffer.byteLength(parsed, "utf8") <=
        customerBiteSaverMaximumIndexedOrderKeyBytes
    ? parsed
    : null;
}

function offerProjectionRestaurantAccountId(value: unknown): string | null {
  const decoded = decodeDartUtf16FirestoreBytesOrderKey(
    value,
    customerBiteSaverMaximumIndexedOrderKeyBytes,
  );
  return decoded !== null && exactIndexedInternalId(decoded) === decoded
    ? decoded
    : null;
}

function boundedString(value: unknown, maximumLength = 2_000): string | null {
  return typeof value === "string" && value.length <= maximumLength
    ? value
    : null;
}

function projectionSafeRestaurantSnapshot(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  const displayName = boundedString(data.displayName, 200);
  if (displayName === null || displayName.length === 0) {
    return null;
  }
  const value = (field: string, limit: number): string | null =>
    boundedString(data[field], limit);
  const businessHours = Array.isArray(data.businessHours) &&
      data.businessHours.length <= 7
    ? Object.freeze([...data.businessHours])
    : Object.freeze([] as unknown[]);
  return Object.freeze({
    displayName,
    streetAddress: value("streetAddress", 500),
    city: value("city", 200) ?? "",
    state: value("state", 100) ?? "",
    zipCode: value("zipCode", 20) ?? "",
    formattedAddress: value("formattedAddress", 700),
    primaryImageUrl: value("primaryImageUrl", 2_000),
    phone: value("phone", 100),
    website: value("website", 2_000),
    businessHours,
    bio: value("bio", 4_000),
    biteScoreCatalogRestaurantId:
      value("biteScoreCatalogRestaurantId", 1_500),
    biteSaverCatalogBindingId: value("biteSaverCatalogBindingId", 1_500),
  });
}

function parentCatalogGenerationFingerprint(
  raw: Readonly<Record<string, unknown>>,
): string {
  const hasMarker = Object.prototype.hasOwnProperty.call(
    raw,
    biteSaverOfferCatalogUpdatedAtField,
  );
  const markerKey = hasMarker
    ? customerBiteSaverTimestampOrderKey(
        raw[biteSaverOfferCatalogUpdatedAtField],
      )
    : null;
  const canonicalMarker = !hasMarker
    ? "missing"
    : markerKey ?? "invalid_raw_marker";
  return createHash("sha256")
    .update(JSON.stringify(canonicalMarker), "utf8")
    .digest("hex");
}

function projectedParentCatalogGenerationFingerprint(
  projection: Readonly<Record<string, unknown>>,
): string {
  const hasStoredKey = Object.prototype.hasOwnProperty.call(
    projection,
    biteSaverOfferCatalogUpdatedAtOrderKeyField,
  );
  const hasLegacyMarker = Object.prototype.hasOwnProperty.call(
    projection,
    biteSaverOfferCatalogUpdatedAtField,
  );
  const storedKey =
    projection[biteSaverOfferCatalogUpdatedAtOrderKeyField];
  const canonicalMarker = !hasStoredKey && !hasLegacyMarker
    ? "missing"
    : isCustomerBiteSaverTimestampOrderKey(storedKey)
      ? storedKey
      : "invalid_projection_marker";
  return createHash("sha256")
    .update(JSON.stringify(canonicalMarker), "utf8")
    .digest("hex");
}

function currentParentFromRaw(value: {
  result: CustomerBiteSaverResultDocument;
  rawDocument: CustomerBiteSaverStoredDocument | null;
  session: CustomerBiteSaverSessionDocument;
  secretKey: Uint8Array;
  now: Date;
}): CurrentParent | null {
  if (value.rawDocument === null) {
    return null;
  }
  const projection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: value.result.authoritativeAccountId,
    source: value.rawDocument.data,
    now: value.now,
  });
  if (
    projection === null ||
    projection.publicVisible !== true ||
    projection.publicProjectionVersion !==
      customerBiteSaverRestaurantProjectionVersion ||
    projection.sourceDocumentId !== value.result.authoritativeAccountId ||
    customerBiteSaverOpaqueRestaurantId(
      value.secretKey,
      value.result.authoritativeAccountId,
    ) !== value.result.publicRestaurantId
  ) {
    return null;
  }
  const coordinates = validRestaurantCoordinates(
    projection.latitude,
    projection.longitude,
  );
  const snapshot = projectionSafeRestaurantSnapshot(projection);
  if (coordinates === null || snapshot === null) {
    return null;
  }
  const distanceMiles = exactCustomerBiteSaverDistanceMiles({
    latitude: value.session.criteria.latitude,
    longitude: value.session.criteria.longitude,
  }, coordinates);
  const exactPreference = customerBiteSaverExactLocationPreference({
    typedLocation: value.session.criteria.typedLocation,
    restaurantCity: projection.city,
    restaurantState: projection.state,
    restaurantZipCode: projection.zipCode,
  });
  const parentMatches = customerBiteSaverMatchValuesContain(
    value.session.criteria.normalizedSearchQuery,
    customerBiteSaverSearchMatchValues([
      projection.displayName,
      projection.city,
      projection.zipCode,
      projection.bio,
    ]),
  );
  if (
    distanceMiles > value.session.criteria.radiusMiles ||
    distanceMiles !== value.result.distanceMiles ||
    (exactPreference ? 0 : 1) !== value.result.exactPreferenceRank ||
    lowercaseDisplayNameOrderKey(snapshot.displayName as string) !==
      value.result.lowercaseDisplayNameOrderKey ||
    parentMatches !== value.result.parentMatches
  ) {
    return null;
  }
  const preparedCatalog = value.result.parentOfferCatalogFingerprint;
  const offerCatalogFingerprint = parentCatalogGenerationFingerprint(
    value.rawDocument.data,
  );
  if (
    !value.result.parentMatches &&
    preparedCatalog !== offerCatalogFingerprint
  ) {
    // Offer-only membership was earned by the prepared catalog. A different
    // catalog may contain a newly matching offer, which must not be inserted
    // into this immutable session in place of a withdrawn prepared match.
    return null;
  }
  return Object.freeze({
    result: value.result,
    raw: value.rawDocument.data,
    projection,
    safeSnapshot: snapshot,
    coordinates,
    offerCatalogFingerprint,
    catalogGenerationUnchanged: preparedCatalog !== null &&
      preparedCatalog === offerCatalogFingerprint,
  });
}

function parsePreviewCandidate(value: unknown): ParsedPreviewCandidate | null {
  return parsePrivatePreviewCandidate(value);
}

function sortedPreparedCandidates(
  result: CustomerBiteSaverResultDocument,
  offerType: "coupon" | "dailySpecial",
): readonly ParsedPreviewCandidate[] {
  const values = offerType === "coupon"
    ? result.previewCouponCandidates
    : result.previewDailyCandidates;
  return Object.freeze(values.map(parsePreviewCandidate)
    .filter((entry): entry is ParsedPreviewCandidate => entry !== null)
    .sort((left, right) =>
      compareCustomerBiteSaverFirestoreUtf8(
        right.sourceCreatedAtOrderKey,
        left.sourceCreatedAtOrderKey,
      ) ||
      compareCustomerBiteSaverFirestoreUtf8(
        right.sourceDocumentId,
        left.sourceDocumentId,
      )));
}

function rawOfferPath(
  authoritativeAccountId: string,
  offerType: "coupon" | "dailySpecial",
  sourceDocumentId: string,
): string {
  const collection = offerType === "coupon" ? "coupons" : "daily_specials";
  return "restaurant_accounts/" + authoritativeAccountId + "/" +
    collection + "/" + sourceDocumentId;
}

function freshOfferProjection(value: {
  parent: CurrentParent;
  candidate: ParsedPreviewCandidate;
  raw: Readonly<Record<string, unknown>>;
  now: Date;
}): Readonly<Record<string, unknown>> | null {
  const projection = value.candidate.offerType === "coupon"
    ? buildBiteSaverCouponOfferIndex({
        restaurantAccountId: value.parent.result.authoritativeAccountId,
        sourceDocumentId: value.candidate.sourceDocumentId,
        offer: value.raw,
        restaurant: value.parent.raw,
        now: value.now,
      })
    : buildBiteSaverDailySpecialOfferIndex({
        restaurantAccountId: value.parent.result.authoritativeAccountId,
        sourceDocumentId: value.candidate.sourceDocumentId,
        offer: value.raw,
        restaurant: value.parent.raw,
        now: value.now,
      });
  if (
    projection === null ||
    projection.customerOfferProjectionVersion !==
      customerBiteSaverOfferProjectionVersion ||
    projection.customerDiscoverable !== true ||
    offerProjectionRestaurantAccountId(projection.restaurantAccountId) !==
      value.parent.result.authoritativeAccountId ||
    projection.sourceDocumentId !== value.candidate.sourceDocumentId ||
    projection.indexDocumentId !== value.candidate.indexDocumentId ||
    projection.catalogGenerationContribution !==
      value.candidate.sourceFingerprint
  ) {
    return null;
  }
  return projection;
}

function currentOfferMatches(value: {
  session: CustomerBiteSaverSessionDocument;
  parentMatches: boolean;
  projection: Readonly<Record<string, unknown>>;
  raw: Readonly<Record<string, unknown>>;
  offerType: "coupon" | "dailySpecial";
}): boolean {
  if (
    value.parentMatches ||
    value.session.criteria.normalizedSearchQuery.length === 0
  ) {
    return true;
  }
  const corpus = value.projection.searchMatchComplete === true &&
      Array.isArray(value.projection.searchMatchValues)
    ? value.projection.searchMatchValues
    : value.offerType === "coupon"
      ? customerBiteSaverSearchMatchValues([
          value.projection.restaurantDisplayName,
          value.projection.city,
          value.projection.zipCode,
          value.projection.restaurantBio,
          value.raw.title,
          value.raw.restaurant,
          value.projection.usageRule,
          value.raw.couponCode,
        ])
      : customerBiteSaverSearchMatchValues([
          value.projection.restaurantDisplayName,
          value.projection.city,
          value.projection.zipCode,
          value.projection.restaurantBio,
          value.raw.title,
          value.raw.details,
        ]);
  return customerBiteSaverMatchValuesContain(
    value.session.criteria.normalizedSearchQuery,
    corpus,
  );
}

function offerIdentityKey(value: {
  authoritativeAccountId: string;
  offerType: "coupon" | "dailySpecial";
  sourceDocumentId: string;
}): string {
  return JSON.stringify([
    value.authoritativeAccountId,
    value.offerType,
    value.sourceDocumentId,
  ]);
}

function usageStateFromDocument(value: {
  document: CustomerBiteSaverStoredDocument | null;
  authoritativeAccountId: string;
  offerType: "coupon" | "dailySpecial";
  sourceDocumentId: string;
}): CustomerBiteSaverUsageState {
  if (value.document === null) {
    return Object.freeze({
      known: true,
      lastRedeemedAt: null,
      timerStartedAt: null,
      generation: createQueryFingerprint({
        identity: offerIdentityKey(value),
        state: "missing",
      }),
    });
  }
  const data = value.document.data;
  const storedParent = exactInternalId(data.restaurantAccountId);
  const storedOfferId = exactInternalId(data.couponId);
  const storedOfferType = data.offerType === undefined
    ? null
    : data.offerType;
  if (
    storedParent !== value.authoritativeAccountId ||
    (storedOfferId !== null && storedOfferId !== value.sourceDocumentId) ||
    (storedOfferType !== null && storedOfferType !== value.offerType) ||
    (storedOfferType === null && value.offerType !== "coupon")
  ) {
    return Object.freeze({
      known: false,
      lastRedeemedAt: null,
      timerStartedAt: null,
      generation: createQueryFingerprint({
        identity: offerIdentityKey(value),
        state: "identityMismatch",
      }),
    });
  }
  const lastRedeemedAt = data.lastRedeemedAt === undefined ||
      data.lastRedeemedAt === null
    ? null
    : dateValue(data.lastRedeemedAt);
  const timerStartedAt = data.timerStartedAt === undefined ||
      data.timerStartedAt === null
    ? null
    : dateValue(data.timerStartedAt);
  if (
    (data.lastRedeemedAt !== undefined && data.lastRedeemedAt !== null &&
      lastRedeemedAt === null) ||
    (data.timerStartedAt !== undefined && data.timerStartedAt !== null &&
      timerStartedAt === null)
  ) {
    return Object.freeze({
      known: false,
      lastRedeemedAt: null,
      timerStartedAt: null,
      generation: createQueryFingerprint({
        identity: offerIdentityKey(value),
        state: "malformed",
      }),
    });
  }
  return Object.freeze({
    known: true,
    lastRedeemedAt,
    timerStartedAt,
    generation: createQueryFingerprint({
      identity: offerIdentityKey(value),
      lastRedeemedAtMillis: lastRedeemedAt?.getTime() ?? null,
      timerStartedAtMillis: timerStartedAt?.getTime() ?? null,
    }),
  });
}

type OfferSeed = Readonly<{
  parent: CurrentParent;
  candidate: ParsedPreviewCandidate;
  raw: Readonly<Record<string, unknown>>;
  projection: Readonly<Record<string, unknown>>;
  publicOfferId: string;
}>;

function availabilityOfferFromFreshProjection(
  seed: OfferSeed,
): Readonly<Record<string, unknown>> {
  const fields = seed.candidate.offerType === "coupon"
    ? [
        "startTime",
        "endTime",
        "usageRule",
        "isProximityOnly",
        "proximityRadiusMiles",
      ] as const
    : [
        "createdAt",
        "availabilityMode",
        "daysOfWeek",
        "allDay",
        "startTime",
        "endTime",
        "hideWhenUnavailable",
        "expiresAt",
      ] as const;
  const offer: Record<string, unknown> = {...seed.raw};
  // These values came from a just-rebuilt projection whose exact raw-source
  // contribution was checked above. Overlay only availability fields that the
  // builder canonicalizes to the current Dart reader contract.
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(seed.projection, field)) {
      offer[field] = seed.projection[field];
    }
  }
  return Object.freeze(offer);
}

async function evaluateOfferSeeds(value: {
  seeds: readonly Readonly<{
    parent: CurrentParent;
    candidate: ParsedPreviewCandidate;
  }>[];
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  now: Date;
  guestUnavailableOfferIds: ReadonlySet<string>;
  freshCoordinates?: Readonly<{
    latitude: number;
    longitude: number;
    capturedAt: Date;
  }> | null;
  reader?: Pick<CustomerBiteSaverSearchDatabase, "getDocuments">;
}): Promise<Readonly<{
  offers: ReadonlyMap<string, CurrentOffer>;
  usageGenerationParts: readonly string[];
}>> {
  if (value.seeds.length === 0) {
    return Object.freeze({
      offers: new Map<string, CurrentOffer>(),
      usageGenerationParts: Object.freeze([] as string[]),
    });
  }
  if (value.seeds.length > 100) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const reader = value.reader ?? value.context.database;
  const rawDocuments = await reader.getDocuments(
    value.seeds.map((seed) => rawOfferPath(
      seed.parent.result.authoritativeAccountId,
      seed.candidate.offerType,
      seed.candidate.sourceDocumentId,
    )),
  );
  const prepared: OfferSeed[] = [];
  rawDocuments.forEach((document, index) => {
    const seed = value.seeds[index];
    if (document === null) {
      return;
    }
    const projection = freshOfferProjection({
      parent: seed.parent,
      candidate: seed.candidate,
      raw: document.data,
      now: value.now,
    });
    if (
      projection === null ||
      !currentOfferMatches({
        session: value.session,
        parentMatches: seed.parent.result.parentMatches,
        projection,
        raw: document.data,
        offerType: seed.candidate.offerType,
      })
    ) {
      return;
    }
    prepared.push(Object.freeze({
      ...seed,
      raw: document.data,
      projection,
      publicOfferId: customerBiteSaverOpaqueOfferId(
        value.context.secretKey,
        seed.parent.result.authoritativeAccountId,
        seed.candidate.offerType,
        seed.candidate.sourceDocumentId,
      ),
    }));
  });

  const uid = requireAuthUid(value.context.identity);
  let usageByIdentity = new Map<string, CustomerBiteSaverUsageState>();
  if (uid !== null) {
    try {
      const usageDocuments = await reader.getDocuments(
        prepared.map((seed) =>
          "customer_redemptions/" + uid + "/coupon_redemptions/" +
          seed.candidate.sourceDocumentId),
      );
      usageByIdentity = new Map(prepared.map((seed, index) => {
        const identity = offerIdentityKey({
          authoritativeAccountId: seed.parent.result.authoritativeAccountId,
          offerType: seed.candidate.offerType,
          sourceDocumentId: seed.candidate.sourceDocumentId,
        });
        return [identity, usageStateFromDocument({
          document: usageDocuments[index],
          authoritativeAccountId:
            seed.parent.result.authoritativeAccountId,
          offerType: seed.candidate.offerType,
          sourceDocumentId: seed.candidate.sourceDocumentId,
        })];
      }));
    } catch {
      usageByIdentity = new Map(prepared.map((seed) => {
        const identity = offerIdentityKey({
          authoritativeAccountId: seed.parent.result.authoritativeAccountId,
          offerType: seed.candidate.offerType,
          sourceDocumentId: seed.candidate.sourceDocumentId,
        });
        return [identity, Object.freeze({
          known: false,
          lastRedeemedAt: null,
          timerStartedAt: null,
          generation: createQueryFingerprint({identity, state: "readFailure"}),
        })];
      }));
    }
  }

  const offers = new Map<string, CurrentOffer>();
  const generationParts: string[] = [];
  for (const seed of prepared) {
    const identity = offerIdentityKey({
      authoritativeAccountId: seed.parent.result.authoritativeAccountId,
      offerType: seed.candidate.offerType,
      sourceDocumentId: seed.candidate.sourceDocumentId,
    });
    const guestSuppressed = uid === null &&
      value.guestUnavailableOfferIds.has(seed.publicOfferId);
    const usage = uid === null
      ? Object.freeze({
          known: true,
          lastRedeemedAt: guestSuppressed ? value.now : null,
          timerStartedAt: null,
          generation: createQueryFingerprint({
            identity,
            guestSuppressed,
          }),
        })
      : usageByIdentity.get(identity) ?? Object.freeze({
          known: false,
          lastRedeemedAt: null,
          timerStartedAt: null,
          generation: createQueryFingerprint({identity, state: "missingRead"}),
        });
    generationParts.push(usage.generation);
    if (guestSuppressed) {
      offers.set(identity, Object.freeze({
        authoritativeAccountId: seed.parent.result.authoritativeAccountId,
        offerType: seed.candidate.offerType,
        sourceDocumentId: seed.candidate.sourceDocumentId,
        publicOfferId: seed.publicOfferId,
        raw: seed.raw,
        projection: seed.projection,
        decision: Object.freeze({
          visible: false,
          redeemable: false,
          reason: "used",
          usageState: "unavailable",
          activeTimerExpiresAtMs: null,
          nextAvailableAtMs: null,
          proximityDistanceMiles: null,
          eligibilityExpiresAtMs: null,
        }),
        usageGeneration: usage.generation,
      }));
      continue;
    }
    const decision = evaluateCustomerBiteSaverOfferAvailability({
      offerType: seed.candidate.offerType,
      offer: availabilityOfferFromFreshProjection(seed),
      parentEligible: true,
      now: value.now,
      timeZone: value.session.criteria.timeZone,
      locationMode: value.session.criteria.locationMode,
      restaurantCoordinates: seed.parent.coordinates,
      currentCoordinates: value.freshCoordinates === undefined
        ? value.session.criteria.locationMode === "current"
          ? {
              latitude: value.session.criteria.latitude,
              longitude: value.session.criteria.longitude,
            }
          : null
        : value.freshCoordinates,
      currentCoordinatesCapturedAt: value.freshCoordinates?.capturedAt ?? null,
      usage,
      requireFreshLocation: value.freshCoordinates !== undefined,
    });
    offers.set(identity, Object.freeze({
      authoritativeAccountId: seed.parent.result.authoritativeAccountId,
      offerType: seed.candidate.offerType,
      sourceDocumentId: seed.candidate.sourceDocumentId,
      publicOfferId: seed.publicOfferId,
      raw: seed.raw,
      projection: seed.projection,
      decision,
      usageGeneration: usage.generation,
    }));
  }
  return Object.freeze({
    offers,
    usageGenerationParts: Object.freeze(generationParts.sort()),
  });
}

async function evaluateOfferSeedsAtCoherentSnapshot(value: {
  seeds: readonly Readonly<{
    parent: CurrentParent;
    candidate: ParsedPreviewCandidate;
  }>[];
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  now: Date;
  guestUnavailableOfferIds: ReadonlySet<string>;
  freshCoordinates?: Readonly<{
    latitude: number;
    longitude: number;
    capturedAt: Date;
  }> | null;
}): ReturnType<typeof evaluateOfferSeeds> {
  if (value.seeds.length === 0) {
    return evaluateOfferSeeds(value);
  }
  return value.context.database.runTransaction(async (transaction) => {
    const originals = new Map<string, CurrentParent>();
    for (const seed of value.seeds) {
      originals.set(seed.parent.result.authoritativeAccountId, seed.parent);
    }
    const parentIds = [...originals.keys()];
    const rawParents = await transaction.getDocuments(parentIds.map((id) =>
      "restaurant_accounts/" + id));
    const currentByAccountId = new Map<string, CurrentParent>();
    parentIds.forEach((accountId, index) => {
      const original = originals.get(accountId) as CurrentParent;
      const current = currentParentFromRaw({
        result: original.result,
        rawDocument: rawParents[index] ?? null,
        session: value.session,
        secretKey: value.context.secretKey,
        now: value.now,
      });
      if (
        current === null ||
        current.offerCatalogFingerprint !== original.offerCatalogFingerprint ||
        current.projection.sourceFingerprint !==
          original.projection.sourceFingerprint
      ) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver source changed; retry this page.",
        );
      }
      currentByAccountId.set(accountId, current);
    });
    return evaluateOfferSeeds({
      ...value,
      seeds: value.seeds.map((seed) => Object.freeze({
        parent: currentByAccountId.get(
          seed.parent.result.authoritativeAccountId,
        ) as CurrentParent,
        candidate: seed.candidate,
      })),
      reader: transaction,
    });
  });
}

async function assertDeliveredOffersCurrentAtCoherentSnapshot(value: {
  delivered: readonly Readonly<{
    parent: CurrentParent;
    offer: CurrentOffer;
  }>[];
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  now: Date;
  guestUnavailableOfferIds: ReadonlySet<string>;
}): Promise<void> {
  if (value.delivered.length === 0) {
    return;
  }
  const distinct = new Map<string, Readonly<{
    parent: CurrentParent;
    offer: CurrentOffer;
  }>>();
  for (const entry of value.delivered) {
    distinct.set(offerIdentityKey(entry.offer), entry);
  }
  const delivered = [...distinct.values()];
  if (delivered.length > customerBiteSaverPageConsumeLimit) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const evaluated = await evaluateOfferSeedsAtCoherentSnapshot({
    seeds: delivered.map(({parent, offer}) => Object.freeze({
      parent,
      candidate: previewCandidateFromCurrentOffer(offer),
    })),
    session: value.session,
    context: value.context,
    now: value.now,
    guestUnavailableOfferIds: value.guestUnavailableOfferIds,
  });
  for (const {offer} of delivered) {
    const current = evaluated.offers.get(offerIdentityKey(offer));
    if (
      current === undefined ||
      !current.decision.visible ||
      current.usageGeneration !== offer.usageGeneration
    ) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver source changed; retry this page.",
      );
    }
  }
}

function dateMilliseconds(value: unknown): number | null {
  return dateValue(value)?.getTime() ?? null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function safeDays(value: unknown): readonly number[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(value.filter((entry): entry is number =>
    typeof entry === "number" && Number.isInteger(entry) &&
    entry >= 1 && entry <= 7).slice(0, 7));
}

function publicOfferDto(
  offer: CurrentOffer,
  offerOccurrence: string,
): CustomerBiteSaverPublicOfferDto {
  const projection = offer.projection;
  const sourceCreatedAt = dateMilliseconds(projection.sourceCreatedAt);
  if (sourceCreatedAt === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver offer is unavailable.",
    );
  }
  return Object.freeze({
    offerId: offer.publicOfferId,
    offerOccurrence,
    offerType: offer.offerType,
    title: boundedString(projection.displayTitle, 200) ?? "",
    details: boundedString(projection.details, 4_000),
    couponCode: boundedString(projection.couponCode, 500),
    couponNumber: boundedString(projection.couponNumber, 500),
    usageRule: boundedString(projection.usageRule, 200),
    availabilityMode: boundedString(projection.availabilityMode, 50),
    daysOfWeek: safeDays(projection.daysOfWeek),
    allDay: booleanOrNull(projection.allDay),
    startTime: boundedString(
      typeof projection.startTime === "string"
        ? projection.startTime
        : null,
      50,
    ),
    endTime: boundedString(
      typeof projection.endTime === "string"
        ? projection.endTime
        : null,
      50,
    ),
    startAtMillis: dateMilliseconds(projection.startAt),
    endAtMillis: dateMilliseconds(projection.endAt),
    expiresAtMillis: dateMilliseconds(projection.expiresAt),
    expiresText: boundedString(projection.expiresText, 500),
    isProximityOnly: projection.isProximityOnly === true,
    proximityRadiusMiles: numberOrNull(projection.proximityRadiusMiles),
    imageUrl: boundedString(projection.primaryImageUrl, 2_000),
    sourceCreatedAtMillis: sourceCreatedAt,
    available: offer.decision.redeemable,
    availabilityReason: offer.decision.reason,
    redemptionPolicyLabel: boundedString(projection.usageRule, 200),
    activeTimerExpiresAtMillis: offer.decision.activeTimerExpiresAtMs,
    nextAvailableAtMillis: offer.decision.nextAvailableAtMs,
    usageState: offer.decision.usageState,
  });
}

function publicRestaurantDto(value: {
  parent: CurrentParent;
  offers: readonly CustomerBiteSaverPublicOfferDto[];
  hasMoreOffers: boolean;
  usableOfferCount: number | null;
  offerCountState: "current" | "unknown";
}): CustomerBiteSaverPublicRestaurantDto {
  const snapshot = value.parent.safeSnapshot;
  return Object.freeze({
    restaurantId: value.parent.result.publicRestaurantId,
    displayName: snapshot.displayName as string,
    streetAddress: snapshot.streetAddress as string | null,
    city: snapshot.city as string,
    state: snapshot.state as string,
    zipCode: snapshot.zipCode as string,
    formattedAddress: snapshot.formattedAddress as string | null,
    imageUrl: snapshot.primaryImageUrl as string | null,
    phone: snapshot.phone as string | null,
    website: snapshot.website as string | null,
    businessHours: snapshot.businessHours as readonly unknown[],
    bio: snapshot.bio as string | null,
    distanceMiles: value.parent.result.distanceMiles,
    isLocal: value.parent.result.exactPreferenceRank === 0,
    catalogBindingAvailable:
      typeof snapshot.biteSaverCatalogBindingId === "string",
    offers: Object.freeze([...value.offers]),
    hasMoreOffers: value.hasMoreOffers,
    usableOfferCount: value.usableOfferCount,
    offerCountState: value.offerCountState,
    favoriteState: "unknown",
  });
}

function pageGenerationFingerprint(value: {
  session: CustomerBiteSaverSessionDocument;
  purpose: "restaurantPage" | "offerPage";
  availabilityAtMs: number;
  callerCapabilityBinding: string;
  guestStateFingerprint: string;
  usageGeneration: string;
  offerCatalogFingerprint: string | null;
  restaurantPublicId: string | null;
  matchingMode: "parent" | "offer" | null;
}): string {
  return createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: value.purpose,
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    queryFingerprint: value.session.queryFingerprint,
    availabilityAtMs: value.availabilityAtMs,
    timeZone: value.session.criteria.timeZone,
    utcOffsetMinutes: value.session.criteria.utcOffsetMinutes,
    callerScope: value.session.callerScope,
    authenticatedUidHash: value.session.authenticatedUidHash,
    callerCapabilityBinding: value.callerCapabilityBinding,
    guestStateFingerprint: value.guestStateFingerprint,
    usageGeneration: value.usageGeneration,
    offerCatalogFingerprint: value.offerCatalogFingerprint,
    pageSize: customerBiteSaverPageSize,
    restaurantPublicId: value.restaurantPublicId,
    matchingMode: value.matchingMode,
  });
}

function offerOccurrenceForDelivery(value: {
  offer: CurrentOffer;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  pagePurpose: "restaurantPage" | "offerPage";
  pageGenerationFingerprint: string;
  availabilityAtMs: number;
  guestStateFingerprint: string;
  usageGeneration: string;
  offerCatalogFingerprint: string | null;
  matchingMode: "parent" | "offer" | null;
}): string {
  const indexDocumentId = exactInternalId(value.offer.projection.indexDocumentId);
  const sourceFingerprint = boundedString(
    value.offer.projection.catalogGenerationContribution,
    64,
  );
  if (
    indexDocumentId === null ||
    sourceFingerprint === null ||
    !/^[0-9a-f]{64}$/u.test(sourceFingerprint)
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver offer is unavailable.",
    );
  }
  const issuedAtMs = value.availabilityAtMs;
  return new CustomerBiteSaverOfferOccurrenceCodec({
    key: value.context.secretKey,
    now: () => issuedAtMs,
  }).encode({
    pagePurpose: value.pagePurpose,
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    queryFingerprint: value.session.queryFingerprint,
    pageGenerationFingerprint: value.pageGenerationFingerprint,
    callerCapabilityBinding: callerCapabilityBindingFor(
      value.context,
      value.session,
    ),
    restaurantPublicId: customerBiteSaverOpaqueRestaurantId(
      value.context.secretKey,
      value.offer.authoritativeAccountId,
    ),
    offerPublicId: value.offer.publicOfferId,
    authoritativeAccountId: value.offer.authoritativeAccountId,
    offerType: value.offer.offerType,
    sourceDocumentId: value.offer.sourceDocumentId,
    indexDocumentId,
    sourceCreatedAtMs: offerCreatedAtMillis(value.offer),
    sourceCreatedAtOrderKey: offerCreatedAtOrderKey(value.offer),
    sourceFingerprint,
    matchingMode: value.matchingMode,
    availabilityAtMs: value.availabilityAtMs,
    guestStateFingerprint: value.guestStateFingerprint,
    usageGeneration: value.usageGeneration,
    offerCatalogFingerprint: value.offerCatalogFingerprint,
    expiresAtMs: value.session.absoluteExpiresAt.getTime(),
  });
}

type PageCursorState = Readonly<{
  availabilityAtMs: number;
  startAfter: readonly CustomerBiteSaverCursorSortValue[] | undefined;
  usageGeneration: string | null;
}>;

function pageCursorState(value: {
  cursor: string | null;
  purpose: "restaurantPage" | "offerPage";
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  nowMs: number;
  initialAvailabilityAtMs: number;
  guestStateFingerprint: string;
  offerCatalogFingerprint: string | null;
  restaurantPublicId: string | null;
  matchingMode: "parent" | "offer" | null;
}): PageCursorState {
  if (value.cursor === null) {
    return Object.freeze({
      availabilityAtMs: value.initialAvailabilityAtMs,
      startAfter: undefined,
      usageGeneration: null,
    });
  }
  const codec = new CustomerBiteSaverCursorCodec({
    key: value.context.secretKey,
    now: () => value.nowMs,
    nonceMode: "deterministicAuthenticated",
  });
  const opened = codec.open(value.cursor);
  const callerBinding = callerCapabilityBindingFor(
    value.context,
    value.session,
  );
  const expectedPageGeneration = pageGenerationFingerprint({
    session: value.session,
    purpose: value.purpose,
    availabilityAtMs: opened.availabilityAtMs,
    callerCapabilityBinding: callerBinding,
    guestStateFingerprint: value.guestStateFingerprint,
    usageGeneration: opened.usageGeneration,
    offerCatalogFingerprint: value.offerCatalogFingerprint,
    restaurantPublicId: value.restaurantPublicId,
    matchingMode: value.matchingMode,
  });
  const payload = codec.decode(value.cursor, {
    purpose: value.purpose,
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    queryFingerprint: value.session.queryFingerprint,
    pageGenerationFingerprint: expectedPageGeneration,
    callerCapabilityBinding: callerBinding,
    restaurantPublicId: value.restaurantPublicId,
    matchingMode: value.matchingMode,
    availabilityAtMs: opened.availabilityAtMs,
    timeZone: value.session.criteria.timeZone,
    utcOffsetMinutes: value.session.criteria.utcOffsetMinutes,
    guestStateFingerprint: value.guestStateFingerprint,
    usageGeneration: opened.usageGeneration,
    offerCatalogFingerprint: value.offerCatalogFingerprint,
  });
  return Object.freeze({
    availabilityAtMs: payload.availabilityAtMs,
    startAfter: payload.sortTuple,
    usageGeneration: payload.usageGeneration,
  });
}

function encodePageCursor(value: {
  purpose: "restaurantPage" | "offerPage";
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  availabilityAtMs: number;
  guestStateFingerprint: string;
  usageGeneration: string;
  offerCatalogFingerprint: string | null;
  sortTuple: readonly CustomerBiteSaverCursorSortValue[];
  restaurantPublicId: string | null;
  matchingMode: "parent" | "offer" | null;
}): string {
  const callerBinding = callerCapabilityBindingFor(
    value.context,
    value.session,
  );
  const generation = pageGenerationFingerprint({
    session: value.session,
    purpose: value.purpose,
    availabilityAtMs: value.availabilityAtMs,
    callerCapabilityBinding: callerBinding,
    guestStateFingerprint: value.guestStateFingerprint,
    usageGeneration: value.usageGeneration,
    offerCatalogFingerprint: value.offerCatalogFingerprint,
    restaurantPublicId: value.restaurantPublicId,
    matchingMode: value.matchingMode,
  });
  return new CustomerBiteSaverCursorCodec({
    key: value.context.secretKey,
    now: () => value.availabilityAtMs,
    nonceMode: "deterministicAuthenticated",
  }).encode({
    purpose: value.purpose,
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    queryFingerprint: value.session.queryFingerprint,
    pageGenerationFingerprint: generation,
    callerCapabilityBinding: callerBinding,
    sortTuple: value.sortTuple,
    restaurantPublicId: value.restaurantPublicId,
    matchingMode: value.matchingMode,
    availabilityAtMs: value.availabilityAtMs,
    timeZone: value.session.criteria.timeZone,
    utcOffsetMinutes: value.session.criteria.utcOffsetMinutes,
    guestStateFingerprint: value.guestStateFingerprint,
    usageGeneration: value.usageGeneration,
    offerCatalogFingerprint: value.offerCatalogFingerprint,
  });
}

function initialPreviewSeedsForParent(
  parent: CurrentParent,
): readonly Readonly<{
  parent: CurrentParent;
  candidate: ParsedPreviewCandidate;
}>[] {
  const daily = sortedPreparedCandidates(parent.result, "dailySpecial");
  const coupons = sortedPreparedCandidates(parent.result, "coupon");
  const candidates = daily.length > 0 && coupons.length > 0
    ? [
        daily[0],
        coupons[0],
        ...(daily[1] === undefined
          ? coupons.slice(1, 2)
          : [daily[1]]),
      ]
    : (daily.length > 0 ? daily : coupons).slice(0, 3);
  return Object.freeze(candidates.map((candidate) => Object.freeze({
    parent,
    candidate,
  })));
}

function currentOffersForParent(
  offers: ReadonlyMap<string, CurrentOffer>,
  parent: CurrentParent,
): CurrentOffer[] {
  const result: CurrentOffer[] = [];
  for (const offer of offers.values()) {
    if (
      offer.authoritativeAccountId ===
        parent.result.authoritativeAccountId
    ) {
      if (offer.decision.visible) {
        result.push(offer);
      }
    }
  }
  return result;
}

function offerCreatedAtMillis(offer: CurrentOffer): number {
  return dateMilliseconds(offer.projection.sourceCreatedAt) ?? 0;
}

function offerCreatedAtOrderKey(offer: CurrentOffer): string {
  const orderKey =
    offer.projection[customerBiteSaverOfferSourceCreatedAtOrderKeyField];
  if (!isCustomerBiteSaverTimestampOrderKey(orderKey)) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver offer state is invalid.",
    );
  }
  return orderKey;
}

function orderedCurrentOffers(
  values: readonly CurrentOffer[],
  type: "coupon" | "dailySpecial",
): CurrentOffer[] {
  return values.filter((offer) => offer.offerType === type)
    .sort((left, right) =>
      compareCustomerBiteSaverFirestoreUtf8(
        offerCreatedAtOrderKey(right),
        offerCreatedAtOrderKey(left),
      ) ||
      compareCustomerBiteSaverFirestoreUtf8(
        right.sourceDocumentId,
        left.sourceDocumentId,
      ));
}

function selectPreviewOffers(
  values: readonly CurrentOffer[],
): readonly CurrentOffer[] {
  const daily = orderedCurrentOffers(values, "dailySpecial");
  const coupons = orderedCurrentOffers(values, "coupon");
  if (daily.length > 0 && coupons.length > 0) {
    return Object.freeze([daily[0], coupons[0]]);
  }
  return Object.freeze((daily.length > 0 ? daily : coupons).slice(0, 2));
}

function previewMetadataWitnesses(
  current: readonly CurrentOffer[],
  selected: readonly CurrentOffer[],
  countKnown: boolean,
): readonly CurrentOffer[] {
  const selectedIdentities = new Set(selected.map(offerIdentityKey));
  const remaining = current.filter((offer) =>
    !selectedIdentities.has(offerIdentityKey(offer)));
  return Object.freeze(countKnown ? remaining : remaining.slice(0, 1));
}

function retainedPreviewOffers(
  values: readonly CurrentOffer[],
): readonly CurrentOffer[] {
  return Object.freeze([
    ...orderedCurrentOffers(values, "dailySpecial").slice(0, 2),
    ...orderedCurrentOffers(values, "coupon").slice(0, 2),
  ]);
}

function previewCandidateFromCurrentOffer(
  offer: CurrentOffer,
): ParsedPreviewCandidate {
  const candidate = parsePreviewCandidate({
    offerType: offer.offerType,
    sourceDocumentId: offer.sourceDocumentId,
    indexDocumentId: offer.projection.indexDocumentId,
    sourceCreatedAtMs: offerCreatedAtMillis(offer),
    sourceCreatedAtOrderKey: offerCreatedAtOrderKey(offer),
    sourceFingerprint: offer.projection.catalogGenerationContribution,
  });
  if (candidate === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver preview continuation state is invalid.",
    );
  }
  return candidate;
}

type PreviewResolutionContinuation = Readonly<{
  restaurantId: string;
  liveStartAfter: readonly [number, string, string] | undefined;
  retainedCandidates: readonly ParsedPreviewCandidate[];
  visibleOfferCount: number;
  countKnown: boolean;
}>;

async function resolvePreviewOffers(value: {
  parents: readonly CurrentParent[];
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  now: Date;
  guestUnavailableOfferIds: ReadonlySet<string>;
  maximumCandidates: number;
  continuation?: PreviewResolutionContinuation;
}): Promise<Readonly<{
  byRestaurantId: ReadonlyMap<string, Readonly<{
    offers: readonly CurrentOffer[];
    metadataWitnesses: readonly CurrentOffer[];
    hasMoreOffers: boolean;
    usableOfferCount: number | null;
    offerCountState: "current" | "unknown";
  }>>;
  usageGenerationParts: readonly string[];
  candidatesConsumed: number;
  coherentSnapshotCount: number;
  unresolved: Readonly<{
    restaurantId: string;
    liveStartAfter: readonly [number, string, string] | undefined;
    currentOffers: readonly CurrentOffer[];
    retainedCandidates: readonly ParsedPreviewCandidate[];
    visibleOfferCount: number;
    countKnown: boolean;
  }> | null;
}>> {
  if (
    !Number.isSafeInteger(value.maximumCandidates) ||
    value.maximumCandidates < 0 ||
    value.maximumCandidates > customerBiteSaverPageConsumeLimit
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  if (
    value.continuation !== undefined &&
    (value.parents.length !== 1 ||
      value.parents[0].result.publicRestaurantId !==
        value.continuation.restaurantId)
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver preview continuation state is invalid.",
    );
  }
  const byRestaurantId = new Map<string, Readonly<{
    offers: readonly CurrentOffer[];
    metadataWitnesses: readonly CurrentOffer[];
    hasMoreOffers: boolean;
    usableOfferCount: number | null;
    offerCountState: "current" | "unknown";
  }>>();
  const usageGenerationParts: string[] = [];
  let candidatesConsumed = 0;
  let coherentSnapshotCount = 0;
  const initialGroups = value.parents.map((parent, index) =>
    index === 0 && value.continuation !== undefined
      ? value.continuation.retainedCandidates.map((candidate) =>
          Object.freeze({parent, candidate}))
      : initialPreviewSeedsForParent(parent));
  const initialSeeds: Array<Readonly<{
    parent: CurrentParent;
    candidate: ParsedPreviewCandidate;
  }>> = [];
  let includedParents = 0;
  for (const group of initialGroups) {
    if (initialSeeds.length + group.length > value.maximumCandidates) {
      break;
    }
    initialSeeds.push(...group);
    includedParents += 1;
  }
  const initial = await evaluateOfferSeedsAtCoherentSnapshot({
    seeds: initialSeeds,
    session: value.session,
    context: value.context,
    now: value.now,
    guestUnavailableOfferIds: value.guestUnavailableOfferIds,
  });
  if (initialSeeds.length > 0) {
    coherentSnapshotCount += 1;
  }
  candidatesConsumed += initialSeeds.length;
  usageGenerationParts.push(...initial.usageGenerationParts);
  const initiallySeen = new Map<string, Set<string>>();
  for (const seed of initialSeeds) {
    const publicRestaurantId = seed.parent.result.publicRestaurantId;
    const seen = initiallySeen.get(publicRestaurantId) ?? new Set<string>();
    seen.add(offerIdentityKey({
      authoritativeAccountId: seed.parent.result.authoritativeAccountId,
      offerType: seed.candidate.offerType,
      sourceDocumentId: seed.candidate.sourceDocumentId,
    }));
    initiallySeen.set(publicRestaurantId, seen);
  }
  for (let parentIndex = 0; parentIndex < includedParents; parentIndex += 1) {
    const parent = value.parents[parentIndex];
    const continuation = parentIndex === 0 ? value.continuation : undefined;
    const currentByIdentity = new Map<string, CurrentOffer>();
    for (const [identity, offer] of initial.offers) {
      if (
        offer.authoritativeAccountId ===
          parent.result.authoritativeAccountId
      ) {
        currentByIdentity.set(identity, offer);
      }
    }
    const initialCurrent = currentOffersForParent(currentByIdentity, parent);
    if (
      continuation === undefined &&
      parent.catalogGenerationUnchanged &&
      initialCurrent.length >= 3
    ) {
      const selected = selectPreviewOffers(initialCurrent);
      byRestaurantId.set(parent.result.publicRestaurantId, Object.freeze({
        offers: selected,
        metadataWitnesses: previewMetadataWitnesses(
          initialCurrent,
          selected,
          false,
        ),
        hasMoreOffers: initialCurrent.length > 2,
        usableOfferCount: null,
        offerCountState: "unknown",
      }));
      continue;
    }
    let visibleOfferCount = initialCurrent.length;
    let countKnown = continuation === undefined &&
      [...initial.offers.values()].filter((offer) =>
        offer.authoritativeAccountId ===
          parent.result.authoritativeAccountId).every((offer) =>
        offer.decision.usageState !== "unknown");
    const seen = initiallySeen.get(parent.result.publicRestaurantId) ??
      new Set<string>();
    const retainedInvalidated = continuation !== undefined &&
      continuation.retainedCandidates.some((candidate) => {
        const offer = currentByIdentity.get(offerIdentityKey({
          authoritativeAccountId: parent.result.authoritativeAccountId,
          offerType: candidate.offerType,
          sourceDocumentId: candidate.sourceDocumentId,
        }));
        return offer === undefined || !offer.decision.visible;
      });
    // If a retained candidate disappeared, the prior boundary is no longer a
    // safe replacement boundary: another traversed candidate before it may be
    // the next usable offer. Restart this one card's bounded scan. Stable
    // retained candidates continue from the persisted boundary.
    let liveStartAfter = retainedInvalidated
      ? undefined
      : continuation?.liveStartAfter;
    let exhausted = false;
    while (candidatesConsumed < value.maximumCandidates) {
      const remaining = value.maximumCandidates - candidatesConsumed;
      const queryLimit = Math.min(customerBiteSaverPageLookahead, remaining);
      const documents = await value.context.database.queryDocuments(
        customerBiteSaverPerParentOfferQuery({
          authoritativeAccountId: parent.result.authoritativeAccountId,
          ...(liveStartAfter === undefined ? {} : {
            startAfter: liveStartAfter,
          }),
          limit: queryLimit,
        }),
      );
      if (documents.length > queryLimit) {
        throw new CustomerBiteSaverContractError("failed-precondition");
      }
      if (documents.length === 0) {
        exhausted = true;
        break;
      }
      const candidates = documents.map((document) =>
        offerCandidateFromProjection(
          document,
          parent.result.authoritativeAccountId,
        ));
      let newlyConsumed = 0;
      const evaluationSeeds = candidates.flatMap((candidate) => {
          if (candidate === null) {
            newlyConsumed += 1;
            return [];
          }
          const identity = offerIdentityKey({
            authoritativeAccountId: parent.result.authoritativeAccountId,
            offerType: candidate.offerType,
            sourceDocumentId: candidate.sourceDocumentId,
          });
          if (seen.has(identity)) {
            return [];
          }
          seen.add(identity);
          newlyConsumed += 1;
          return [{parent, candidate}];
        });
      candidatesConsumed += newlyConsumed;
      const evaluated = await evaluateOfferSeedsAtCoherentSnapshot({
        seeds: evaluationSeeds,
        session: value.session,
        context: value.context,
        now: value.now,
        guestUnavailableOfferIds: value.guestUnavailableOfferIds,
      });
      if (evaluationSeeds.length > 0) {
        coherentSnapshotCount += 1;
      }
      for (const [identity, offer] of evaluated.offers) {
        currentByIdentity.set(identity, offer);
      }
      const newlyVisible = currentOffersForParent(evaluated.offers, parent);
      if (
        visibleOfferCount + newlyVisible.length >
          customerBiteSaverPageConsumeLimit
      ) {
        visibleOfferCount = customerBiteSaverPageConsumeLimit;
        countKnown = false;
      } else {
        visibleOfferCount += newlyVisible.length;
      }
      if ([...evaluated.offers.values()].some((offer) =>
        offer.decision.usageState === "unknown")) {
        countKnown = false;
      }
      usageGenerationParts.push(...evaluated.usageGenerationParts);
      liveStartAfter = offerSortTupleFromStored(
        documents[documents.length - 1],
      );
      if (documents.length < queryLimit) {
        exhausted = true;
        break;
      }
    }
    const current = currentOffersForParent(currentByIdentity, parent);
    if (
      !exhausted &&
      candidatesConsumed >= value.maximumCandidates &&
      liveStartAfter !== undefined
    ) {
      const probe = await value.context.database.queryDocuments(
        customerBiteSaverPerParentOfferQuery({
          authoritativeAccountId: parent.result.authoritativeAccountId,
          startAfter: liveStartAfter,
          limit: 1,
        }),
      );
      exhausted = probe.length === 0;
    }
    if (!exhausted) {
      if (current.length >= 3) {
        const selected = selectPreviewOffers(current);
        byRestaurantId.set(parent.result.publicRestaurantId, Object.freeze({
          offers: selected,
          metadataWitnesses: previewMetadataWitnesses(
            current,
            selected,
            false,
          ),
          hasMoreOffers: true,
          usableOfferCount: null,
          offerCountState: "unknown",
        }));
        continue;
      }
      const retained = retainedPreviewOffers(current);
      return Object.freeze({
        byRestaurantId,
        usageGenerationParts: Object.freeze(usageGenerationParts.sort()),
        candidatesConsumed,
        coherentSnapshotCount,
        unresolved: Object.freeze({
          restaurantId: parent.result.publicRestaurantId,
          liveStartAfter,
          currentOffers: retained,
          retainedCandidates: Object.freeze(
            retained.map(previewCandidateFromCurrentOffer),
          ),
          visibleOfferCount,
          countKnown,
        }),
      });
    }
    const selected = selectPreviewOffers(current);
    byRestaurantId.set(parent.result.publicRestaurantId, Object.freeze({
      offers: selected,
      metadataWitnesses: previewMetadataWitnesses(
        current,
        selected,
        countKnown,
      ),
      hasMoreOffers: current.length > 2,
      usableOfferCount: countKnown ? visibleOfferCount : null,
      offerCountState: countKnown ? "current" : "unknown",
    }));
  }
  if (includedParents < value.parents.length) {
    return Object.freeze({
      byRestaurantId,
      usageGenerationParts: Object.freeze(usageGenerationParts.sort()),
      candidatesConsumed,
      coherentSnapshotCount,
      unresolved: Object.freeze({
        restaurantId:
          value.parents[includedParents].result.publicRestaurantId,
        liveStartAfter: undefined,
        currentOffers: Object.freeze([] as CurrentOffer[]),
        retainedCandidates:
          Object.freeze([] as ParsedPreviewCandidate[]),
        visibleOfferCount: 0,
        countKnown: true,
      }),
    });
  }
  return Object.freeze({
    byRestaurantId,
    usageGenerationParts: Object.freeze(usageGenerationParts.sort()),
    candidatesConsumed,
    coherentSnapshotCount,
    unresolved: null,
  });
}

function resultSortTupleFromStored(
  document: CustomerBiteSaverStoredDocument,
): RestaurantResultSortTuple {
  const data = document.data;
  const accountIdOrderKey = privateIndexedUtf16BytesOrderKey(
    data.authoritativeAccountIdOrderKey,
  );
  const accountIdOrderCursorValue = accountIdOrderKey === null
    ? null
    : accountIdOrderKeyCursorValue(accountIdOrderKey);
  if (
    (data.exactPreferenceRank !== 0 && data.exactPreferenceRank !== 1) ||
    typeof data.distanceSortMiles !== "number" ||
    !Number.isFinite(data.distanceSortMiles) ||
    typeof data.lowercaseDisplayNameOrderKey !== "string" ||
    accountIdOrderCursorValue === null
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver search result state is invalid.",
    );
  }
  return Object.freeze([
    data.exactPreferenceRank,
    data.distanceSortMiles,
    data.lowercaseDisplayNameOrderKey,
    accountIdOrderCursorValue,
  ]);
}

type RestaurantResultSortTuple = readonly [0 | 1, number, string, string];

type PreviewContinuationDocument = Readonly<{
  documentId: string;
  pendingResultId: string;
  pendingRestaurantId: string;
  pendingSortTuple: RestaurantResultSortTuple;
  liveStartAfter: readonly [number, string, string] | undefined;
  retainedCandidates: readonly ParsedPreviewCandidate[];
  visibleOfferCount: number;
  countKnown: boolean;
  parentCatalogFingerprint: string;
  parentProjectionFingerprint: string;
  usageGeneration: string;
}>;

const previewContinuationKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "callerCapabilityBinding",
  "countKnown",
  "createdAt",
  "evaluationAt",
  "expiresAt",
  "guestStateFingerprint",
  "liveOfferSortTuple",
  "logicalExpiresAt",
  "parentCatalogFingerprint",
  "parentProjectionFingerprint",
  "pendingRestaurantId",
  "pendingResultId",
  "pendingSortTuple",
  "protocolVersion",
  "queryFingerprint",
  "retainedCandidates",
  "role",
  "schemaVersion",
  "sessionId",
  "state",
  "usageGeneration",
  "visibleOfferCount",
].sort());

const previewCandidateKeys = Object.freeze([
  "indexDocumentId",
  "offerType",
  "sourceCreatedAtMs",
  "sourceCreatedAtOrderKey",
  "sourceDocumentId",
  "sourceFingerprint",
].sort());

function parseRestaurantResultSortTuple(
  value: unknown,
): RestaurantResultSortTuple | null {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    (value[0] !== 0 && value[0] !== 1) ||
    typeof value[1] !== "number" ||
    !Number.isFinite(value[1]) ||
    typeof value[2] !== "string" ||
    value[2].length > 1_500 ||
    !hasWellFormedCustomerBiteSaverUtf16(value[2]) ||
    typeof value[3] !== "string" ||
    parseDartUtf16FirestoreBytesCursorValue(
      value[3],
      customerBiteSaverMaximumIndexedOrderKeyBytes,
    ) === null
  ) {
    return null;
  }
  return Object.freeze([value[0], value[1], value[2], value[3]]);
}

function parseLiveOfferSortTuple(
  value: unknown,
): readonly [number, string, string] | undefined | null {
  if (value === null) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    (value[0] !== 0 && value[0] !== 1) ||
    !isCustomerBiteSaverTimestampOrderKey(value[1]) ||
    exactInternalId(value[2]) === null ||
    !hasWellFormedCustomerBiteSaverUtf16(value[2] as string)
  ) {
    return null;
  }
  return Object.freeze([value[0], value[1], value[2] as string]);
}

function sameSortTuple(
  left: readonly CustomerBiteSaverCursorSortValue[],
  right: readonly CustomerBiteSaverCursorSortValue[],
): boolean {
  return left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}

function parseContinuationCandidates(
  value: unknown,
): readonly ParsedPreviewCandidate[] | null {
  if (!Array.isArray(value) || value.length > 4) {
    return null;
  }
  const candidates: ParsedPreviewCandidate[] = [];
  for (const rawCandidate of value) {
    if (!isPlainRecord(rawCandidate)) {
      return null;
    }
    const keys = Object.keys(rawCandidate).sort();
    if (
      keys.length !== previewCandidateKeys.length ||
      keys.some((key, index) => key !== previewCandidateKeys[index])
    ) {
      return null;
    }
    const candidate = parsePreviewCandidate(rawCandidate);
    if (candidate === null) {
      return null;
    }
    candidates.push(candidate);
  }
  if (
    candidates.filter((candidate) =>
      candidate.offerType === "dailySpecial").length > 2 ||
    candidates.filter((candidate) => candidate.offerType === "coupon").length > 2 ||
    new Set(candidates.map((candidate) =>
      `${candidate.offerType}\u0000${candidate.sourceDocumentId}`)).size !==
      candidates.length
  ) {
    return null;
  }
  return Object.freeze(candidates);
}

function previewContinuationDocumentId(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  clientRequestId: string;
}): string {
  return customerBiteSaverDeterministicId(
    value.context.secretKey,
    "bspc",
    "restaurantPreviewContinuation",
    [
      customerBiteSaverSearchProtocolVersion,
      value.session.sessionId,
      value.session.attemptGeneration.toString(10),
      callerCapabilityBindingFor(value.context, value.session),
      value.clientRequestId,
    ],
  );
}

function restaurantCursorBoundary(
  startAfter: readonly CustomerBiteSaverCursorSortValue[] | undefined,
): Readonly<{
  membershipBoundary: RestaurantResultSortTuple | undefined;
  continuationId: string | null;
}> {
  if (startAfter === undefined) {
    return Object.freeze({
      membershipBoundary: undefined,
      continuationId: null,
    });
  }
  const tuple = parseRestaurantResultSortTuple(startAfter.slice(0, 4));
  const continuationId = startAfter.length === 5 &&
      typeof startAfter[4] === "string" &&
      /^bspc_[A-Za-z0-9_-]{43}$/u.test(startAfter[4])
    ? startAfter[4]
    : null;
  if (
    tuple === null ||
    (startAfter.length !== 4 && continuationId === null)
  ) {
    throw new CustomerBiteSaverContractError(
      "invalid-argument",
      "The BiteSaver restaurant cursor is invalid.",
    );
  }
  return Object.freeze({
    membershipBoundary: tuple,
    continuationId,
  });
}

async function loadPreviewContinuation(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  continuationId: string;
  pendingSortTuple: RestaurantResultSortTuple;
  availabilityAtMs: number;
  guestStateFingerprint: string;
  usageGeneration: string | null;
  nowMs: number;
}): Promise<PreviewContinuationDocument> {
  const documentPath = path(
    privateCustomerBiteSaverActiveSessionCollection,
    value.continuationId,
  );
  const document = await value.context.database.getDocument(documentPath);
  const data = document?.data;
  const keys = data === undefined ? [] : Object.keys(data).sort();
  const pendingSortTuple = data === undefined
    ? null
    : parseRestaurantResultSortTuple(data.pendingSortTuple);
  const liveStartAfter = data === undefined
    ? null
    : parseLiveOfferSortTuple(data.liveOfferSortTuple);
  const retainedCandidates = data === undefined
    ? null
    : parseContinuationCandidates(data.retainedCandidates);
  const createdAt = dateValue(data?.createdAt);
  const evaluationAt = dateValue(data?.evaluationAt);
  const logicalExpiresAt = dateValue(data?.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data?.absoluteExpiresAt);
  const expiresAt = dateValue(data?.expiresAt);
  if (
    document === null ||
    document.id !== value.continuationId ||
    document.path !== documentPath ||
    data === undefined ||
    keys.length !== previewContinuationKeys.length ||
    keys.some((key, index) => key !== previewContinuationKeys[index]) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    data.role !== "previewContinuation" ||
    data.state !== "active" ||
    data.sessionId !== value.session.sessionId ||
    data.attemptGeneration !== value.session.attemptGeneration ||
    data.queryFingerprint !== value.session.queryFingerprint ||
    data.callerCapabilityBinding !==
      callerCapabilityBindingFor(value.context, value.session) ||
    data.guestStateFingerprint !==
      value.guestStateFingerprint ||
    value.usageGeneration === null ||
    data.usageGeneration !== value.usageGeneration ||
    typeof data.pendingResultId !== "string" ||
    !/^bsrrow_[A-Za-z0-9_-]{43}$/u.test(data.pendingResultId) ||
    typeof data.pendingRestaurantId !== "string" ||
    !/^bsr_[A-Za-z0-9_-]{43}$/u.test(data.pendingRestaurantId) ||
    data.pendingResultId !== customerBiteSaverResultDocumentId(
      value.context.secretKey,
      value.session.sessionId,
      value.session.attemptGeneration,
      data.pendingRestaurantId,
    ) ||
    pendingSortTuple === null ||
    !sameSortTuple(pendingSortTuple, value.pendingSortTuple) ||
    liveStartAfter === null ||
    retainedCandidates === null ||
    !Number.isSafeInteger(data.visibleOfferCount) ||
    (data.visibleOfferCount as number) < 0 ||
    (data.visibleOfferCount as number) > customerBiteSaverPageConsumeLimit ||
    (data.visibleOfferCount as number) < retainedCandidates.length ||
    typeof data.countKnown !== "boolean" ||
    typeof data.parentCatalogFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.parentCatalogFingerprint) ||
    typeof data.parentProjectionFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.parentProjectionFingerprint) ||
    typeof data.usageGeneration !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.usageGeneration) ||
    createdAt === null ||
    evaluationAt === null ||
    logicalExpiresAt === null ||
    absoluteExpiresAt === null ||
    expiresAt === null ||
    evaluationAt.getTime() !== value.availabilityAtMs ||
    createdAt.getTime() !== value.availabilityAtMs ||
    absoluteExpiresAt.getTime() !== value.session.absoluteExpiresAt.getTime() ||
    logicalExpiresAt.getTime() !== expiresAt.getTime() ||
    expiresAt.getTime() > absoluteExpiresAt.getTime() ||
    expiresAt.getTime() <= value.nowMs
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver preview continuation is invalid or expired.",
    );
  }
  return Object.freeze({
    documentId: value.continuationId,
    pendingResultId: data.pendingResultId as string,
    pendingRestaurantId: data.pendingRestaurantId as string,
    pendingSortTuple,
    liveStartAfter,
    retainedCandidates,
    visibleOfferCount: data.visibleOfferCount as number,
    countKnown: data.countKnown as boolean,
    parentCatalogFingerprint: data.parentCatalogFingerprint as string,
    parentProjectionFingerprint: data.parentProjectionFingerprint as string,
    usageGeneration: data.usageGeneration as string,
  });
}

function previewContinuationWrite(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  clientRequestId: string;
  availabilityAtMs: number;
  guestStateFingerprint: string;
  usageGeneration: string;
  pendingParent: CurrentParent;
  pendingSortTuple: RestaurantResultSortTuple;
  unresolved: NonNullable<Awaited<ReturnType<
    typeof resolvePreviewOffers
  >>["unresolved"]>;
}): Readonly<{
  documentId: string;
  write: Readonly<{
    type: "set";
    path: string;
    data: Readonly<Record<string, unknown>>;
  }>;
}> {
  const documentId = previewContinuationDocumentId(value);
  const expiresAtMs = Math.min(
    value.session.absoluteExpiresAt.getTime(),
    value.availabilityAtMs + customerBiteSaverCursorLifetimeMilliseconds,
  );
  const projectionFingerprint = value.pendingParent.projection.sourceFingerprint;
  if (
    typeof projectionFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(projectionFingerprint)
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver preview continuation state is invalid.",
    );
  }
  const absoluteExpiresAt = new Date(
    value.session.absoluteExpiresAt.getTime(),
  );
  const expiresAt = new Date(expiresAtMs);
  return Object.freeze({
    documentId,
    write: Object.freeze({
      type: "set" as const,
      path: path(privateCustomerBiteSaverActiveSessionCollection, documentId),
      data: Object.freeze({
        protocolVersion: customerBiteSaverSearchProtocolVersion,
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        role: "previewContinuation",
        state: "active",
        sessionId: value.session.sessionId,
        attemptGeneration: value.session.attemptGeneration,
        queryFingerprint: value.session.queryFingerprint,
        callerCapabilityBinding: callerCapabilityBindingFor(
          value.context,
          value.session,
        ),
        guestStateFingerprint: value.guestStateFingerprint,
        pendingResultId: value.pendingParent.result.id,
        pendingRestaurantId:
          value.pendingParent.result.publicRestaurantId,
        pendingSortTuple: Object.freeze([...value.pendingSortTuple]),
        liveOfferSortTuple: value.unresolved.liveStartAfter === undefined
          ? null
          : Object.freeze([...value.unresolved.liveStartAfter]),
        retainedCandidates: Object.freeze(
          value.unresolved.retainedCandidates.map((candidate) =>
            Object.freeze({...candidate})),
        ),
        visibleOfferCount: value.unresolved.visibleOfferCount,
        countKnown: value.unresolved.countKnown,
        parentCatalogFingerprint:
          value.pendingParent.offerCatalogFingerprint,
        parentProjectionFingerprint: projectionFingerprint,
        usageGeneration: value.usageGeneration,
        evaluationAt: new Date(value.availabilityAtMs),
        createdAt: new Date(value.availabilityAtMs),
        logicalExpiresAt: expiresAt,
        absoluteExpiresAt,
        expiresAt,
      }),
    }),
  });
}

const deliveredOfferIdentityKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "authoritativeAccountId",
  "availabilityAt",
  "callerCapabilityBinding",
  "createdAt",
  "expiresAt",
  "logicalExpiresAt",
  "offerType",
  "pageGenerationFingerprint",
  "protocolVersion",
  "publicOfferId",
  "publicRestaurantId",
  "queryFingerprint",
  "role",
  "schemaVersion",
  "sessionId",
  "sourceDocumentId",
  "state",
].sort());

function deliveredOfferIdentityDocumentId(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  publicOfferId: string;
}): string {
  return customerBiteSaverDeterministicId(
    value.context.secretKey,
    "bsdoi",
    "deliveredOfferIdentity",
    [
      customerBiteSaverSearchProtocolVersion,
      value.session.sessionId,
      value.session.attemptGeneration.toString(10),
      value.publicOfferId,
    ],
  );
}

function deliveredOfferIdentityWrites(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  offers: readonly CurrentOffer[];
  pageGenerationFingerprint: string;
  availabilityAtMs: number;
}): readonly Readonly<{
  type: "set";
  path: string;
  data: Readonly<Record<string, unknown>>;
}>[] {
  if (value.offers.length > customerBiteSaverPageSize * 2) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const absoluteExpiresAt = new Date(
    value.session.absoluteExpiresAt.getTime(),
  );
  const expiresAt = new Date(absoluteExpiresAt.getTime());
  return Object.freeze(value.offers.map((offer) => {
    const publicRestaurantId = customerBiteSaverOpaqueRestaurantId(
      value.context.secretKey,
      offer.authoritativeAccountId,
    );
    const documentId = deliveredOfferIdentityDocumentId({
      context: value.context,
      session: value.session,
      publicOfferId: offer.publicOfferId,
    });
    return Object.freeze({
      type: "set" as const,
      path: path(privateCustomerBiteSaverCandidateCollection, documentId),
      data: Object.freeze({
        protocolVersion: customerBiteSaverSearchProtocolVersion,
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        role: "deliveredOfferIdentity",
        state: "active",
        sessionId: value.session.sessionId,
        attemptGeneration: value.session.attemptGeneration,
        queryFingerprint: value.session.queryFingerprint,
        callerCapabilityBinding: callerCapabilityBindingFor(
          value.context,
          value.session,
        ),
        publicRestaurantId,
        publicOfferId: offer.publicOfferId,
        authoritativeAccountId: offer.authoritativeAccountId,
        offerType: offer.offerType,
        sourceDocumentId: offer.sourceDocumentId,
        pageGenerationFingerprint: value.pageGenerationFingerprint,
        availabilityAt: new Date(value.availabilityAtMs),
        createdAt: new Date(value.availabilityAtMs),
        logicalExpiresAt: expiresAt,
        absoluteExpiresAt,
        expiresAt,
      }),
    });
  }));
}

const deliveredRestaurantIdentityKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "authoritativeAccountId",
  "availabilityAt",
  "callerCapabilityBinding",
  "createdAt",
  "expiresAt",
  "logicalExpiresAt",
  "pageGenerationFingerprint",
  "protocolVersion",
  "publicRestaurantId",
  "queryFingerprint",
  "role",
  "schemaVersion",
  "sessionId",
  "state",
].sort());

function deliveredRestaurantIdentityDocumentId(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  publicRestaurantId: string;
}): string {
  return customerBiteSaverDeterministicId(
    value.context.secretKey,
    "bsdri",
    "deliveredRestaurantIdentity",
    [
      customerBiteSaverSearchProtocolVersion,
      value.session.sessionId,
      value.session.attemptGeneration.toString(10),
      value.publicRestaurantId,
    ],
  );
}

function deliveredRestaurantIdentityWrites(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  parents: readonly CurrentParent[];
  pageGenerationFingerprint: string;
  availabilityAtMs: number;
}): readonly Readonly<{
  type: "set";
  path: string;
  data: Readonly<Record<string, unknown>>;
}>[] {
  if (value.parents.length > customerBiteSaverPageSize) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const absoluteExpiresAt = new Date(
    value.session.absoluteExpiresAt.getTime(),
  );
  const expiresAt = new Date(absoluteExpiresAt.getTime());
  return Object.freeze(value.parents.map((parent) => {
    const publicRestaurantId = parent.result.publicRestaurantId;
    const documentId = deliveredRestaurantIdentityDocumentId({
      context: value.context,
      session: value.session,
      publicRestaurantId,
    });
    return Object.freeze({
      type: "set" as const,
      path: path(privateCustomerBiteSaverCandidateCollection, documentId),
      data: Object.freeze({
        protocolVersion: customerBiteSaverSearchProtocolVersion,
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        role: "deliveredRestaurantIdentity",
        state: "active",
        sessionId: value.session.sessionId,
        attemptGeneration: value.session.attemptGeneration,
        queryFingerprint: value.session.queryFingerprint,
        callerCapabilityBinding: callerCapabilityBindingFor(
          value.context,
          value.session,
        ),
        publicRestaurantId,
        authoritativeAccountId: parent.result.authoritativeAccountId,
        pageGenerationFingerprint: value.pageGenerationFingerprint,
        availabilityAt: new Date(value.availabilityAtMs),
        createdAt: new Date(value.availabilityAtMs),
        logicalExpiresAt: expiresAt,
        absoluteExpiresAt,
        expiresAt,
      }),
    });
  }));
}

export type CustomerBiteSaverRestaurantPageResult = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  state: "ready";
  attemptGeneration: number;
  queryFingerprint: string;
  restaurants: readonly CustomerBiteSaverPublicRestaurantDto[];
  nextCursor: string | null;
  hasMore: boolean;
  partial: boolean;
}>;

export type CustomerBiteSaverGuestOperation =
  | "restaurantPage"
  | "offerPage"
  | "redemptionStart";

export type CustomerBiteSaverGuestCheckCandidateDto = Readonly<{
  offerId: string;
  usagePolicy: "oncePerCustomer" | "oncePerDay";
}>;

export type CustomerBiteSaverGuestCheckRequiredResponse = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  outcome: "guestCheckRequired";
  operation: CustomerBiteSaverGuestOperation;
  operationRef: string;
  checkToken: string;
  batchSequence: number;
  guestStateRevision: number;
  evaluationContext: Readonly<{
    evaluationAtMillis: number;
    timeZone: string;
    utcOffsetMinutes: number;
    availabilityGeneration: string;
  }>;
  logicalExpiresAtMillis: number;
  candidates: readonly CustomerBiteSaverGuestCheckCandidateDto[];
}>;

export type CustomerBiteSaverGuestRetryRequiredResponse = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  outcome: "retryRequired";
  operation: CustomerBiteSaverGuestOperation;
  guestStateRevision: number;
  reason:
    | "guestStateChanged"
    | "sourceChanged"
    | "sessionChanged"
    | "checkExpired"
    | "workBudget";
  restartFrom: "originalOperation" | "search";
  logicalExpiresAtMillis: number;
}>;

export type CustomerBiteSaverGuestCompleteResponse<Result> = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  outcome: "complete";
  operation: CustomerBiteSaverGuestOperation;
  guestStateRevision: number | null;
  attemptGeneration: number;
  queryFingerprint: string;
  evaluationContext: Readonly<{
    evaluationAtMillis: number;
    timeZone: string;
    utcOffsetMinutes: number;
    availabilityGeneration: string;
  }>;
  result: Result;
}>;

type CustomerBiteSaverGuestCompletedOperationResponse =
  | (CustomerBiteSaverGuestCompleteResponse<
      CustomerBiteSaverRestaurantPageResult
    > & Readonly<{operation: "restaurantPage"}>)
  | (CustomerBiteSaverGuestCompleteResponse<
      CustomerBiteSaverOfferPageResult
    > & Readonly<{operation: "offerPage"}>)
  | (CustomerBiteSaverGuestCompleteResponse<
      CustomerBiteSaverRedemptionValidationResult
    > & Readonly<{operation: "redemptionStart"}>);

export type CustomerBiteSaverGuestOperationResponse =
  | CustomerBiteSaverGuestCheckRequiredResponse
  | CustomerBiteSaverGuestRetryRequiredResponse
  | CustomerBiteSaverGuestCompletedOperationResponse;

async function getCustomerBiteSaverSearchPageCompletedHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverRestaurantPageResult> {
  const request = parsePageRequest(rawRequest, false) as
    CustomerBiteSaverPageRequest;
  requireGuestStateRevisionForCaller(request.guestStateRevision, context);
  const nowMs = context.now?.() ?? Date.now();
  const suppressionFingerprint = guestStateFingerprint(
    request.guestStateRevision,
  );
  const openedCursor = request.cursor === null
    ? null
    : new CustomerBiteSaverCursorCodec({
      key: context.secretKey,
      now: () => nowMs,
      nonceMode: "deterministicAuthenticated",
      }).open(request.cursor);
  if (openedCursor !== null) {
    preflightPageCursorForRequest({
      payload: openedCursor,
      request,
      context,
      purpose: "restaurantPage",
      restaurantPublicId: null,
      guestStateFingerprint: suppressionFingerprint,
    });
  }
  let session = await readAuthorizedSession(request, context, nowMs);
  if (session.state !== "ready" || session.phase !== "ready") {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      session.state === "failed"
        ? "The BiteSaver search failed."
        : "The BiteSaver search is still preparing.",
    );
  }
  const prevalidatedCursorState = request.cursor === null
    ? null
    : pageCursorState({
      cursor: request.cursor,
      purpose: "restaurantPage",
      session,
      context,
      nowMs,
      initialAvailabilityAtMs: nowMs,
      guestStateFingerprint: suppressionFingerprint,
      offerCatalogFingerprint: null,
      restaurantPublicId: null,
      matchingMode: null,
    });
  return withCustomerBiteSaverRequestGate({
    context,
    session,
    clientRequestId: request.clientRequestId,
    endpoint: "restaurantPage",
    nowMs,
    operation: async () => {
      session = await touchPreauthorizedSession(
        request,
        context,
        session,
        nowMs,
      );
      const replayInput = Object.freeze({
        database: context.database,
        secretKey: context.secretKey,
        sessionId: session.sessionId,
        attemptGeneration: session.attemptGeneration,
        callerCapabilityBinding: callerCapabilityBindingFor(context, session),
        purpose: "restaurantPage",
        clientRequestId: request.clientRequestId,
        requestFingerprint: pageRequestFingerprint({
          purpose: "restaurantPage",
          cursor: request.cursor,
          guestStateRevision: request.guestStateRevision,
          restaurantPublicId: null,
        }),
        nowMs,
        absoluteSessionExpiresAt: session.absoluteExpiresAt,
      });
      const replay = await reserveCustomerBiteSaverRequestReplay(replayInput);
      if (
        nowMs >= Math.min(
          replay.logicalExpiresAtMs,
          replay.evaluationAtMs + customerBiteSaverCursorLifetimeMilliseconds,
          session.logicalExpiresAt.getTime(),
          session.absoluteExpiresAt.getTime(),
        )
      ) {
        return expiredSignedPageReplay();
      }
      const inboundCursorState = prevalidatedCursorState ?? pageCursorState({
        cursor: null,
        purpose: "restaurantPage",
        session,
        context,
        nowMs,
        initialAvailabilityAtMs: replay.evaluationAtMs,
        guestStateFingerprint: suppressionFingerprint,
        offerCatalogFingerprint: null,
        restaurantPublicId: null,
        matchingMode: null,
      });
      const cursorState = Object.freeze({
        ...inboundCursorState,
        // Each distinct continuation request gets a fresh replay-frozen
        // evaluation instant. Only its immutable membership boundary comes
        // from the preceding cursor.
        availabilityAtMs: replay.evaluationAtMs,
      });
  const evaluationInstant = new Date(cursorState.availabilityAtMs);
  const cursorBoundary = restaurantCursorBoundary(cursorState.startAfter);
  const suppression = new Set<string>();
  const deliveredRestaurants: Array<Readonly<{
    parent: CurrentParent;
    offers: readonly CurrentOffer[];
    metadataWitnesses: readonly CurrentOffer[];
    hasMoreOffers: boolean;
    usableOfferCount: number | null;
    offerCountState: "current" | "unknown";
  }>> = [];
  const usageGenerationParts: string[] = [];
  let consumed = 0;
  let previewCandidatesConsumed = 0;
  let coherentOfferSnapshotCount = 0;
  let boundary = cursorBoundary.membershipBoundary;
  let hasMore = false;
  let continuationUnresolved = false;
  let usableRestaurantWitness: (typeof deliveredRestaurants)[number] | null =
    null;
  let pendingPreview: Readonly<{
    parent: CurrentParent;
    sortTuple: RestaurantResultSortTuple;
    unresolved: NonNullable<Awaited<ReturnType<
      typeof resolvePreviewOffers
    >>["unresolved"]>;
  }> | null = null;

  if (cursorBoundary.continuationId !== null) {
    if (boundary === undefined) {
      throw new CustomerBiteSaverContractError(
        "invalid-argument",
        "The BiteSaver restaurant cursor is invalid.",
      );
    }
    const continuation = await loadPreviewContinuation({
      context,
      session,
      continuationId: cursorBoundary.continuationId,
      pendingSortTuple: boundary,
      availabilityAtMs: inboundCursorState.availabilityAtMs,
      guestStateFingerprint: suppressionFingerprint,
      usageGeneration: cursorState.usageGeneration,
      nowMs,
    });
    usageGenerationParts.push(continuation.usageGeneration);
    const resultDocument = await context.database.getDocument(
      path(privateCustomerBiteSaverResultCollection,
        continuation.pendingResultId),
    );
    const result = parseResultDocument(resultDocument, session, context.secretKey);
    if (resultDocument !== null && result === null) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver preview continuation state is invalid.",
      );
    }
    if (result !== null) {
      if (
        result.id !== continuation.pendingResultId ||
        result.publicRestaurantId !== continuation.pendingRestaurantId ||
        !sameSortTuple(
          resultSortTupleFromStored(resultDocument as
            CustomerBiteSaverStoredDocument),
          continuation.pendingSortTuple,
        )
      ) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver preview continuation state is invalid.",
        );
      }
      const parent = currentParentFromRaw({
        result,
        rawDocument: await context.database.getDocument(
          "restaurant_accounts/" + result.authoritativeAccountId,
        ),
        session,
        secretKey: context.secretKey,
        now: evaluationInstant,
      });
      if (parent !== null) {
        if (
          parent.offerCatalogFingerprint !==
            continuation.parentCatalogFingerprint ||
          parent.projection.sourceFingerprint !==
            continuation.parentProjectionFingerprint
        ) {
          throw new CustomerBiteSaverContractError(
            "failed-precondition",
            "The BiteSaver restaurant catalog changed; restart this page.",
          );
        }
        const previews = await resolvePreviewOffers({
          parents: [parent],
          session,
          context,
          now: evaluationInstant,
          guestUnavailableOfferIds: suppression,
          maximumCandidates: customerBiteSaverPageConsumeLimit,
          continuation: Object.freeze({
            restaurantId: continuation.pendingRestaurantId,
            liveStartAfter: continuation.liveStartAfter,
            retainedCandidates: continuation.retainedCandidates,
            visibleOfferCount: continuation.visibleOfferCount,
            countKnown: continuation.countKnown,
          }),
        });
        previewCandidatesConsumed += previews.candidatesConsumed;
        coherentOfferSnapshotCount += previews.coherentSnapshotCount;
        usageGenerationParts.push(...previews.usageGenerationParts);
        if (previews.unresolved !== null) {
          pendingPreview = Object.freeze({
            parent,
            sortTuple: boundary,
            unresolved: previews.unresolved,
          });
          hasMore = true;
        } else {
          const preview = previews.byRestaurantId.get(
            parent.result.publicRestaurantId,
          );
          if (preview !== undefined && preview.offers.length > 0) {
            deliveredRestaurants.push(Object.freeze({
              parent,
              offers: preview.offers,
              metadataWitnesses: preview.metadataWitnesses,
              hasMoreOffers: preview.hasMoreOffers,
              usableOfferCount: preview.usableOfferCount,
              offerCountState: preview.offerCountState,
            }));
          }
        }
      }
    }
    if (pendingPreview === null) {
      consumed += 1;
    }
  }

  while (
    pendingPreview === null &&
    usableRestaurantWitness === null &&
    consumed < customerBiteSaverPageConsumeLimit
  ) {
    const queryLimit = deliveredRestaurants.length >= customerBiteSaverPageSize
      ? 1
      : Math.min(
          customerBiteSaverPageLookahead,
          customerBiteSaverPageConsumeLimit - consumed,
        );
    const documents = await context.database.queryDocuments(
      customerBiteSaverOrderedResultQuery({
        session,
        ...(boundary === undefined ? {} : {startAfter: boundary}),
        limit: queryLimit,
      }),
    );
    if (documents.length === 0) {
      hasMore = false;
      break;
    }
    const maximumRows = Math.min(
      documents.length,
      customerBiteSaverPageConsumeLimit - consumed,
    );
    const boundedDocuments = documents.slice(0, maximumRows);
    const parsedAll = boundedDocuments.map((document) =>
      parseResultDocument(document, session, context.secretKey));
    const validResults = parsedAll.filter(
      (entry): entry is CustomerBiteSaverResultDocument => entry !== null,
    );
    const rawParents = await context.database.getDocuments(
      validResults.map((result) =>
        "restaurant_accounts/" + result.authoritativeAccountId),
    );
    const rawByResultId = new Map<string, CustomerBiteSaverStoredDocument | null>();
    validResults.forEach((result, index) => {
      rawByResultId.set(result.id, rawParents[index]);
    });
    const currentParents = validResults.map((result) => currentParentFromRaw({
      result,
      rawDocument: rawByResultId.get(result.id) ?? null,
      session,
      secretKey: context.secretKey,
      now: evaluationInstant,
    })).filter((entry): entry is CurrentParent => entry !== null);
    const currentParentByResultId = new Map(
      currentParents.map((parent) => [parent.result.id, parent]),
    );
    const processingDocuments = boundedDocuments;
    const parsed = parsedAll;
    const parents = parsed.map((result) =>
      result === null ? null : currentParentByResultId.get(result.id) ?? null)
      .filter((entry): entry is CurrentParent => entry !== null);
    const parentByResultId = new Map(
      parents.map((parent) => [parent.result.id, parent]),
    );
    const previews = await resolvePreviewOffers({
      parents,
      session,
      context,
      now: evaluationInstant,
      guestUnavailableOfferIds: suppression,
      maximumCandidates: customerBiteSaverPageConsumeLimit -
        previewCandidatesConsumed,
    });
    previewCandidatesConsumed += previews.candidatesConsumed;
    coherentOfferSnapshotCount += previews.coherentSnapshotCount;
    usageGenerationParts.push(...previews.usageGenerationParts);

    for (let index = 0; index < processingDocuments.length; index += 1) {
      if (consumed >= customerBiteSaverPageConsumeLimit) {
        break;
      }
      const document = processingDocuments[index];
      const result = parsed[index];
      const parent = result === null
        ? null
        : parentByResultId.get(result.id) ?? null;
      if (
        parent !== null &&
        previews.unresolved?.restaurantId ===
          parent.result.publicRestaurantId
      ) {
        pendingPreview = Object.freeze({
          parent,
          sortTuple: resultSortTupleFromStored(document),
          unresolved: previews.unresolved,
        });
        break;
      }
      const preview = parent === null
        ? undefined
        : previews.byRestaurantId.get(parent.result.publicRestaurantId);
      if (
        deliveredRestaurants.length >= customerBiteSaverPageSize &&
        parent !== null &&
        preview !== undefined &&
        preview.offers.length > 0
      ) {
        // This row proves continuation, but it belongs to the next page. Keep
        // the cursor immediately before it so the witness is not skipped.
        usableRestaurantWitness = Object.freeze({
          parent,
          offers: preview.offers,
          metadataWitnesses: preview.metadataWitnesses,
          hasMoreOffers: preview.hasMoreOffers,
          usableOfferCount: preview.usableOfferCount,
          offerCountState: preview.offerCountState,
        });
        break;
      }
      boundary = resultSortTupleFromStored(document);
      consumed += 1;
      if (
        parent === null ||
        preview === undefined ||
        preview.offers.length === 0
      ) {
        continue;
      }
      deliveredRestaurants.push(Object.freeze({
        parent,
        offers: preview.offers,
        metadataWitnesses: preview.metadataWitnesses,
        hasMoreOffers: preview.hasMoreOffers,
        usableOfferCount: preview.usableOfferCount,
        offerCountState: preview.offerCountState,
      }));
    }
    hasMore = pendingPreview !== null || usableRestaurantWitness !== null ||
      documents.length === queryLimit;
    if (
      !hasMore ||
      consumed >= customerBiteSaverPageConsumeLimit ||
      pendingPreview !== null ||
      usableRestaurantWitness !== null
    ) {
      break;
    }
  }

  if (
    pendingPreview === null &&
    consumed >= customerBiteSaverPageConsumeLimit &&
    hasMore &&
    boundary !== undefined
  ) {
    const probe = await context.database.queryDocuments(
      customerBiteSaverOrderedResultQuery({
        session,
        startAfter: boundary,
        limit: 1,
      }),
    );
    hasMore = probe.length > 0;
    continuationUnresolved = hasMore;
  }

  const parentsToFence = new Map<string, CurrentParent>();
  for (const {parent} of deliveredRestaurants) {
    parentsToFence.set(parent.result.authoritativeAccountId, parent);
  }
  if (pendingPreview !== null) {
    parentsToFence.set(
      pendingPreview.parent.result.authoritativeAccountId,
      pendingPreview.parent,
    );
  }
  if (usableRestaurantWitness !== null) {
    parentsToFence.set(
      usableRestaurantWitness.parent.result.authoritativeAccountId,
      usableRestaurantWitness.parent,
    );
  }
  if (parentsToFence.size > 0) {
    const originalParents = [...parentsToFence.values()];
    const finalRawParents = await context.database.getDocuments(
      originalParents.map((parent) =>
        "restaurant_accounts/" +
          parent.result.authoritativeAccountId),
    );
    for (let index = 0; index < originalParents.length; index += 1) {
      const originalParent = originalParents[index];
      const finalParent = currentParentFromRaw({
        result: originalParent.result,
        rawDocument: finalRawParents[index] ?? null,
        session,
        secretKey: context.secretKey,
        now: evaluationInstant,
      });
      if (
        finalParent === null ||
        finalParent.offerCatalogFingerprint !==
          originalParent.offerCatalogFingerprint ||
        finalParent.projection.sourceFingerprint !==
          originalParent.projection.sourceFingerprint
      ) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver restaurant catalog changed; restart this page.",
        );
      }
    }
  }

  // A one-batch page is already evaluated from one transactionally coherent
  // parent + raw-offer + signed-usage snapshot. Backfill/continuation work can
  // require more than one such transaction, so fence every delivered identity
  // together once more to give the whole response one bounded linearization
  // point without doubling the normal-path offer-read budget.
  if (coherentOfferSnapshotCount > 1) {
    await assertDeliveredOffersCurrentAtCoherentSnapshot({
      delivered: [
        ...deliveredRestaurants,
        ...(usableRestaurantWitness === null
          ? []
          : [usableRestaurantWitness]),
      ].flatMap(({
        parent,
        offers,
        metadataWitnesses,
      }) => [...offers, ...metadataWitnesses].map((offer) =>
        Object.freeze({parent, offer}))),
      session,
      context,
      now: evaluationInstant,
      guestUnavailableOfferIds: suppression,
    });
  }

  const usageGeneration = createQueryFingerprint({
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    parts: usageGenerationParts.sort(),
  });
  const responseLogicalExpiresAtMs = signedPageLogicalExpiresAtMs({
    session,
    evaluationAtMs: cursorState.availabilityAtMs,
    supportingOffers: [
      ...deliveredRestaurants,
      ...(usableRestaurantWitness === null
        ? []
        : [usableRestaurantWitness]),
    ].flatMap(({offers, metadataWitnesses}) => [
      ...offers,
      ...metadataWitnesses,
    ]).concat(pendingPreview?.unresolved.currentOffers ?? []),
  });
  let continuationId: string | null = null;
  let continuationWrite: CustomerBiteSaverWrite | null = null;
  if (pendingPreview !== null) {
    const continuation = previewContinuationWrite({
      context,
      session,
      clientRequestId: request.clientRequestId,
      availabilityAtMs: cursorState.availabilityAtMs,
      guestStateFingerprint: suppressionFingerprint,
      usageGeneration,
      pendingParent: pendingPreview.parent,
      pendingSortTuple: pendingPreview.sortTuple,
      unresolved: pendingPreview.unresolved,
    });
    continuationId = continuation.documentId;
    continuationWrite = continuation.write;
  }
  const deliveryPageGeneration = pageGenerationFingerprint({
    session,
    purpose: "restaurantPage",
    availabilityAtMs: cursorState.availabilityAtMs,
    callerCapabilityBinding: callerCapabilityBindingFor(context, session),
    guestStateFingerprint: suppressionFingerprint,
    usageGeneration,
    offerCatalogFingerprint: null,
    restaurantPublicId: null,
    matchingMode: null,
  });
  const restaurants = deliveredRestaurants.map(({
    parent,
    offers,
    hasMoreOffers,
    usableOfferCount,
    offerCountState,
  }) =>
    publicRestaurantDto({
      parent,
      hasMoreOffers,
      usableOfferCount,
      offerCountState,
      offers: offers.map((offer) => publicOfferDto(
        offer,
        offerOccurrenceForDelivery({
          offer,
          session,
          context,
          pagePurpose: "restaurantPage",
          pageGenerationFingerprint: deliveryPageGeneration,
          availabilityAtMs: cursorState.availabilityAtMs,
          guestStateFingerprint: suppressionFingerprint,
          usageGeneration,
          offerCatalogFingerprint: null,
          matchingMode: null,
        }),
      )),
    }));
  const nextCursor = continuationId !== null && pendingPreview !== null
    ? encodePageCursor({
        purpose: "restaurantPage",
        session,
        context,
        availabilityAtMs: cursorState.availabilityAtMs,
        guestStateFingerprint: suppressionFingerprint,
        usageGeneration,
        offerCatalogFingerprint: null,
        sortTuple: Object.freeze([
          ...pendingPreview.sortTuple,
          continuationId,
        ]),
        restaurantPublicId: null,
        matchingMode: null,
      })
    : hasMore && boundary !== undefined
    ? encodePageCursor({
        purpose: "restaurantPage",
        session,
        context,
        availabilityAtMs: cursorState.availabilityAtMs,
        guestStateFingerprint: suppressionFingerprint,
        usageGeneration,
        offerCatalogFingerprint: null,
        sortTuple: boundary,
        restaurantPublicId: null,
        matchingMode: null,
      })
    : null;
  const deliveryEvidenceWrites = [
    ...deliveredRestaurantIdentityWrites({
      context,
      session,
      parents: deliveredRestaurants.map(({parent}) => parent),
      pageGenerationFingerprint: deliveryPageGeneration,
      availabilityAtMs: cursorState.availabilityAtMs,
    }),
    ...deliveredOfferIdentityWrites({
      context,
      session,
      offers: deliveredRestaurants.flatMap(({offers}) => [...offers]),
      pageGenerationFingerprint: deliveryPageGeneration,
      availabilityAtMs: cursorState.availabilityAtMs,
    }),
  ];
  const response = Object.freeze({
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        state: "ready",
        attemptGeneration: session.attemptGeneration,
        queryFingerprint: session.queryFingerprint,
        restaurants: Object.freeze(restaurants),
        nextCursor,
        hasMore: nextCursor !== null,
        partial: nextCursor !== null && (
          continuationUnresolved ||
          pendingPreview !== null ||
          deliveredRestaurants.length < customerBiteSaverPageSize
        ),
      });
  await commitSignedPageResponse({
    context,
    replayInput,
    evaluationAtMs: cursorState.availabilityAtMs,
    logicalExpiresAtMs: responseLogicalExpiresAtMs,
    writes: [
      ...(continuationWrite === null ? [] : [continuationWrite]),
      ...deliveryEvidenceWrites,
    ],
  });
      return response;
    },
  });
}

export function customerBiteSaverPerParentOfferQuery(value: {
  authoritativeAccountId: string;
  startAfter?: readonly CustomerBiteSaverCursorSortValue[];
  limit?: number;
}): Parameters<CustomerBiteSaverSearchDatabase["queryDocuments"]>[0] {
  const authoritativeAccountId = exactIndexedInternalId(
    value.authoritativeAccountId,
  );
  if (authoritativeAccountId === null) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const filters: Parameters<
    CustomerBiteSaverSearchDatabase["queryDocuments"]
  >[0]["filters"] = Object.freeze([
    {field: "source", operation: "==", value: "biteSaver"},
    {
      field: "customerOfferProjectionVersion",
      operation: "==",
      value: customerBiteSaverOfferProjectionVersion,
    },
    {field: "customerDiscoverable", operation: "==", value: true},
    {
      field: "restaurantAccountId",
      operation: "==",
      value: dartUtf16FirestoreBytesOrderKey(authoritativeAccountId),
    },
  ]);
  const orders: Parameters<
    CustomerBiteSaverSearchDatabase["queryDocuments"]
  >[0]["orders"] = Object.freeze([
    {field: "presentationTypeRank", direction: "asc"},
    {
      field: customerBiteSaverOfferSourceCreatedAtOrderKeyField,
      direction: "desc",
    },
    {field: "sourceDocumentId", direction: "desc"},
  ]);
  let startAfter: readonly unknown[] | undefined;
  if (value.startAfter !== undefined) {
    if (
      value.startAfter.length !== 3 ||
      (value.startAfter[0] !== 0 && value.startAfter[0] !== 1) ||
      !isCustomerBiteSaverTimestampOrderKey(value.startAfter[1]) ||
      exactInternalId(value.startAfter[2]) === null ||
      !hasWellFormedCustomerBiteSaverUtf16(value.startAfter[2] as string)
    ) {
      throw new CustomerBiteSaverContractError("invalid-argument");
    }
    startAfter = Object.freeze([
      value.startAfter[0],
      value.startAfter[1],
      value.startAfter[2],
    ]);
  }
  const limit = value.limit ?? customerBiteSaverPageLookahead;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > customerBiteSaverPageLookahead
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  return Object.freeze({
    collectionPath: biteSaverOfferIndexCollection,
    filters,
    orders,
    ...(startAfter === undefined ? {} : {startAfter}),
    limit,
  });
}

function offerCandidateFromProjection(
  document: CustomerBiteSaverStoredDocument,
  authoritativeAccountId: string,
): ParsedPreviewCandidate | null {
  const data = document.data;
  const sourceCreatedAt = dateMilliseconds(data.sourceCreatedAt);
  const sourceCreatedAtOrderKey =
    data[customerBiteSaverOfferSourceCreatedAtOrderKeyField];
  const candidate = parsePreviewCandidate({
    offerType: data.offerType,
    sourceDocumentId: data.sourceDocumentId,
    indexDocumentId: data.indexDocumentId,
    sourceCreatedAtMs: sourceCreatedAt,
    sourceCreatedAtOrderKey,
    sourceFingerprint: data.catalogGenerationContribution,
  });
  return candidate !== null &&
      candidate.indexDocumentId === document.id &&
      offerProjectionRestaurantAccountId(data.restaurantAccountId) ===
        authoritativeAccountId &&
      data.customerOfferProjectionVersion ===
        customerBiteSaverOfferProjectionVersion &&
      data.customerDiscoverable === true
    ? candidate
    : null;
}

function offerSortTupleFromStored(
  document: CustomerBiteSaverStoredDocument,
): readonly [number, string, string] {
  const rank = document.data.presentationTypeRank;
  const sourceCreatedAtOrderKey =
    document.data[customerBiteSaverOfferSourceCreatedAtOrderKeyField];
  const sourceDocumentId = exactInternalId(document.data.sourceDocumentId);
  if (
    (rank !== 0 && rank !== 1) ||
    !isCustomerBiteSaverTimestampOrderKey(sourceCreatedAtOrderKey) ||
    sourceDocumentId === null ||
    !hasWellFormedCustomerBiteSaverUtf16(sourceDocumentId)
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver offer state is invalid.",
    );
  }
  return Object.freeze([rank, sourceCreatedAtOrderKey, sourceDocumentId]);
}

export type CustomerBiteSaverOfferPageResult = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  restaurantId: string;
  offers: readonly CustomerBiteSaverPublicOfferDto[];
  nextCursor: string | null;
  hasMore: boolean;
  partial: boolean;
}>;

async function getCustomerBiteSaverOfferPageCompletedHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverOfferPageResult> {
  const request = parsePageRequest(rawRequest, true) as
    CustomerBiteSaverOfferPageRequest;
  requireGuestStateRevisionForCaller(request.guestStateRevision, context);
  const nowMs = context.now?.() ?? Date.now();
  const suppressionFingerprint = guestStateFingerprint(
    request.guestStateRevision,
  );
  const openedCursor = request.cursor === null
    ? null
    : new CustomerBiteSaverCursorCodec({
      key: context.secretKey,
      now: () => nowMs,
      nonceMode: "deterministicAuthenticated",
      }).open(request.cursor);
  if (openedCursor !== null) {
    preflightPageCursorForRequest({
      payload: openedCursor,
      request,
      context,
      purpose: "offerPage",
      restaurantPublicId: request.restaurantId,
      guestStateFingerprint: suppressionFingerprint,
    });
  }
  let session = await readAuthorizedSession(request, context, nowMs);
  if (session.state !== "ready" || session.phase !== "ready") {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver search is not ready.",
    );
  }
  const resultId = customerBiteSaverResultDocumentId(
    context.secretKey,
    session.sessionId,
    session.attemptGeneration,
    request.restaurantId,
  );
  const result = parseResultDocument(
    await context.database.getDocument(
      privateCustomerBiteSaverResultCollection + "/" + resultId,
    ),
    session,
    context.secretKey,
  );
  if (
    result === null ||
    result.publicRestaurantId !== request.restaurantId
  ) {
    throw new CustomerBiteSaverContractError(
      "not-found",
      "The BiteSaver restaurant is unavailable.",
    );
  }
  const matchingMode: "parent" | "offer" = result.parentMatches
    ? "parent"
    : "offer";
  const cursorPreflight = openedCursor === null
    ? null
    : await (async () => {
      const evaluationInstant = new Date(openedCursor.availabilityAtMs);
      const currentParent = currentParentFromRaw({
        result,
        rawDocument: await context.database.getDocument(
          "restaurant_accounts/" + result.authoritativeAccountId,
        ),
        session,
        secretKey: context.secretKey,
        now: evaluationInstant,
      });
      if (currentParent === null) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver restaurant is unavailable.",
        );
      }
      const cursorState = pageCursorState({
        cursor: request.cursor,
        purpose: "offerPage",
        session,
        context,
        nowMs,
        initialAvailabilityAtMs: openedCursor.availabilityAtMs,
        guestStateFingerprint: suppressionFingerprint,
        offerCatalogFingerprint: currentParent.offerCatalogFingerprint,
        restaurantPublicId: request.restaurantId,
        matchingMode,
      });
      return Object.freeze({currentParent, cursorState});
    })();
  return withCustomerBiteSaverRequestGate({
    context,
    session,
    clientRequestId: request.clientRequestId,
    endpoint: "offerPage",
    nowMs,
    operation: async () => {
  session = await touchPreauthorizedSession(
    request,
    context,
    session,
    nowMs,
  );
  const replayInput = Object.freeze({
    database: context.database,
    secretKey: context.secretKey,
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    callerCapabilityBinding: callerCapabilityBindingFor(context, session),
    purpose: "offerPage",
    clientRequestId: request.clientRequestId,
    requestFingerprint: pageRequestFingerprint({
      purpose: "offerPage",
      cursor: request.cursor,
      guestStateRevision: request.guestStateRevision,
      restaurantPublicId: request.restaurantId,
    }),
    nowMs,
    absoluteSessionExpiresAt: session.absoluteExpiresAt,
  });
  const replay = await reserveCustomerBiteSaverRequestReplay(replayInput);
  if (
    nowMs >= Math.min(
      replay.logicalExpiresAtMs,
      replay.evaluationAtMs + customerBiteSaverCursorLifetimeMilliseconds,
      session.logicalExpiresAt.getTime(),
      session.absoluteExpiresAt.getTime(),
    )
  ) {
    return expiredSignedPageReplay();
  }
  const evaluationAtMs = replay.evaluationAtMs;
  const evaluationInstant = new Date(evaluationAtMs);
  const currentParent = currentParentFromRaw({
      result,
      rawDocument: await context.database.getDocument(
        "restaurant_accounts/" + result.authoritativeAccountId,
      ),
      session,
      secretKey: context.secretKey,
      now: evaluationInstant,
    });
  if (currentParent === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver restaurant is unavailable.",
    );
  }
  const inboundCursorState = cursorPreflight?.cursorState ?? pageCursorState({
    cursor: null,
    purpose: "offerPage",
    session,
    context,
    nowMs,
    initialAvailabilityAtMs: replay.evaluationAtMs,
    guestStateFingerprint: suppressionFingerprint,
    offerCatalogFingerprint: currentParent.offerCatalogFingerprint,
    restaurantPublicId: request.restaurantId,
    matchingMode,
  });
  const cursorState = Object.freeze({
    ...inboundCursorState,
    availabilityAtMs: replay.evaluationAtMs,
  });
  const deliveredOffers: CurrentOffer[] = [];
  const usageGenerationParts: string[] = [];
  const suppression = new Set<string>();
  let coherentOfferSnapshotCount = 0;
  let consumed = 0;
  let boundary = cursorState.startAfter;
  let hasMore = false;
  let continuationUnresolved = false;
  let usableOfferWitness: CurrentOffer | null = null;
  while (
    usableOfferWitness === null &&
    consumed < customerBiteSaverPageConsumeLimit
  ) {
    const queryLimit = deliveredOffers.length >= customerBiteSaverPageSize
      ? 1
      : Math.min(
          customerBiteSaverPageLookahead,
          customerBiteSaverPageConsumeLimit - consumed,
        );
    const documents = await context.database.queryDocuments(
      customerBiteSaverPerParentOfferQuery({
        authoritativeAccountId: result.authoritativeAccountId,
        ...(boundary === undefined ? {} : {startAfter: boundary}),
        limit: queryLimit,
      }),
    );
    if (documents.length === 0) {
      hasMore = false;
      break;
    }
    const candidates = documents.map((document) =>
      offerCandidateFromProjection(
        document,
        result.authoritativeAccountId,
      ));
    const evaluated = await evaluateOfferSeedsAtCoherentSnapshot({
      seeds: candidates.map((candidate) =>
        candidate === null ? null : {parent: currentParent, candidate})
        .filter((entry): entry is {
          parent: CurrentParent;
          candidate: ParsedPreviewCandidate;
        } => entry !== null),
      session,
      context,
      now: evaluationInstant,
      guestUnavailableOfferIds: suppression,
    });
    if (candidates.some((candidate) => candidate !== null)) {
      coherentOfferSnapshotCount += 1;
    }
    usageGenerationParts.push(...evaluated.usageGenerationParts);
    for (let index = 0; index < documents.length; index += 1) {
      if (consumed >= customerBiteSaverPageConsumeLimit) {
        break;
      }
      const candidate = candidates[index];
      const current = candidate === null
        ? undefined
        : evaluated.offers.get(offerIdentityKey({
            authoritativeAccountId: result.authoritativeAccountId,
            offerType: candidate.offerType,
            sourceDocumentId: candidate.sourceDocumentId,
          }));
      if (
        deliveredOffers.length >= customerBiteSaverPageSize &&
        current !== undefined &&
        current.decision.visible
      ) {
        // Preserve the first usable continuation row for the next page.
        usableOfferWitness = current;
        break;
      }
      boundary = offerSortTupleFromStored(documents[index]);
      consumed += 1;
      if (current !== undefined && current.decision.visible) {
        deliveredOffers.push(current);
      }
    }
    hasMore = usableOfferWitness !== null || documents.length === queryLimit;
    if (
      !hasMore ||
      consumed >= customerBiteSaverPageConsumeLimit ||
      usableOfferWitness !== null
    ) {
      break;
    }
  }
  if (
    consumed >= customerBiteSaverPageConsumeLimit &&
    hasMore &&
    boundary !== undefined
  ) {
    const probe = await context.database.queryDocuments(
      customerBiteSaverPerParentOfferQuery({
        authoritativeAccountId: result.authoritativeAccountId,
        startAfter: boundary,
        limit: 1,
      }),
    );
    hasMore = probe.length > 0;
    continuationUnresolved = hasMore;
  }
  const usageGeneration = createQueryFingerprint({
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    restaurantId: request.restaurantId,
    parts: usageGenerationParts.sort(),
  });
  const deliveryPageGeneration = pageGenerationFingerprint({
    session,
    purpose: "offerPage",
    availabilityAtMs: cursorState.availabilityAtMs,
    callerCapabilityBinding: callerCapabilityBindingFor(context, session),
    guestStateFingerprint: suppressionFingerprint,
    usageGeneration,
    offerCatalogFingerprint: currentParent.offerCatalogFingerprint,
    restaurantPublicId: request.restaurantId,
    matchingMode,
  });
  const offers = deliveredOffers.map((offer) => publicOfferDto(
    offer,
    offerOccurrenceForDelivery({
      offer,
      session,
      context,
      pagePurpose: "offerPage",
      pageGenerationFingerprint: deliveryPageGeneration,
      availabilityAtMs: cursorState.availabilityAtMs,
      guestStateFingerprint: suppressionFingerprint,
      usageGeneration,
      offerCatalogFingerprint: currentParent.offerCatalogFingerprint,
      matchingMode,
    }),
  ));
  const nextCursor = hasMore && boundary !== undefined
    ? encodePageCursor({
        purpose: "offerPage",
        session,
        context,
        availabilityAtMs: cursorState.availabilityAtMs,
        guestStateFingerprint: suppressionFingerprint,
        usageGeneration,
        offerCatalogFingerprint: currentParent.offerCatalogFingerprint,
        sortTuple: boundary,
        restaurantPublicId: request.restaurantId,
        matchingMode,
      })
    : null;
  const finalParent = currentParentFromRaw({
    result,
    rawDocument: await context.database.getDocument(
      "restaurant_accounts/" + result.authoritativeAccountId,
    ),
    session,
    secretKey: context.secretKey,
    now: evaluationInstant,
  });
  if (
    finalParent === null ||
    finalParent.offerCatalogFingerprint !==
      currentParent.offerCatalogFingerprint ||
    finalParent.projection.sourceFingerprint !==
      currentParent.projection.sourceFingerprint
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver offer catalog changed; restart this offer page.",
    );
  }
  if (coherentOfferSnapshotCount > 1) {
    await assertDeliveredOffersCurrentAtCoherentSnapshot({
      delivered: [
        ...deliveredOffers,
        ...(usableOfferWitness === null ? [] : [usableOfferWitness]),
      ].map((offer) => Object.freeze({
        parent: currentParent,
        offer,
      })),
      session,
      context,
      now: evaluationInstant,
      guestUnavailableOfferIds: suppression,
    });
  }
  const responseLogicalExpiresAtMs = signedPageLogicalExpiresAtMs({
    session,
    evaluationAtMs: cursorState.availabilityAtMs,
    supportingOffers: [
      ...deliveredOffers,
      ...(usableOfferWitness === null ? [] : [usableOfferWitness]),
    ],
  });
  const deliveredOfferWrites = deliveredOfferIdentityWrites({
    context,
    session,
    offers: deliveredOffers,
    pageGenerationFingerprint: deliveryPageGeneration,
    availabilityAtMs: cursorState.availabilityAtMs,
  });
  const response = Object.freeze({
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        restaurantId: request.restaurantId,
        offers: Object.freeze(offers),
        nextCursor,
        hasMore: nextCursor !== null,
        partial: nextCursor !== null && (
          continuationUnresolved ||
          deliveredOffers.length < customerBiteSaverPageSize
        ),
      });
  await commitSignedPageResponse({
    context,
    replayInput,
    evaluationAtMs: cursorState.availabilityAtMs,
    logicalExpiresAtMs: responseLogicalExpiresAtMs,
    writes: deliveredOfferWrites,
  });
      return response;
    },
  });
}

type CustomerBiteSaverFavoriteRequest = BoundSessionRequest & Readonly<{
  restaurantIds: readonly string[];
  offerIds: readonly string[];
}>;

function parseFavoriteRequest(
  value: unknown,
): CustomerBiteSaverFavoriteRequest {
  if (!isPlainRecord(value)) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const expected = [
    "schemaVersion",
    "clientRequestId",
    "clientInstanceId",
    "sessionId",
    "capability",
    "criteriaFingerprint",
    "restaurantIds",
    "offerIds",
  ].sort();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    !Array.isArray(value.restaurantIds) ||
    !Array.isArray(value.offerIds) ||
    value.restaurantIds.length > customerBiteSaverPageSize ||
    value.offerIds.length > customerBiteSaverPageSize * 2 ||
    value.restaurantIds.length + value.offerIds.length >
      customerBiteSaverFavoriteLimit
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const restaurantIds = value.restaurantIds.map((entry) =>
    requireCustomerBiteSaverPublicId(entry, "bsr"));
  const offerIds = value.offerIds.map((entry) =>
    requireCustomerBiteSaverPublicId(entry, "bso"));
  if (
    new Set(restaurantIds).size !== restaurantIds.length ||
    new Set(offerIds).size !== offerIds.length
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const base = parseBoundSessionRequest({
    schemaVersion: value.schemaVersion,
    clientRequestId: value.clientRequestId,
    clientInstanceId: value.clientInstanceId,
    sessionId: value.sessionId,
    capability: value.capability,
    criteriaFingerprint: value.criteriaFingerprint,
  });
  return Object.freeze({
    ...base,
    restaurantIds: Object.freeze(restaurantIds),
    offerIds: Object.freeze(offerIds),
  });
}

type FavoriteResolvedOffer = Readonly<{
  publicOfferId: string;
  authoritativeAccountId: string;
  offerType: "coupon" | "dailySpecial";
  sourceDocumentId: string;
}>;

type FavoriteResolvedRestaurant = Readonly<{
  publicRestaurantId: string;
  authoritativeAccountId: string;
}>;

function parseDeliveredRestaurantIdentity(value: {
  document: CustomerBiteSaverStoredDocument | null;
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  publicRestaurantId: string;
  nowMs: number;
}): FavoriteResolvedRestaurant | null {
  if (value.document === null) {
    return null;
  }
  const data = value.document.data;
  const keys = Object.keys(data).sort();
  const authoritativeAccountId = exactInternalId(data.authoritativeAccountId);
  const availabilityAt = dateValue(data.availabilityAt);
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  const expectedDocumentId = deliveredRestaurantIdentityDocumentId({
    context: value.context,
    session: value.session,
    publicRestaurantId: value.publicRestaurantId,
  });
  if (
    value.document.id !== expectedDocumentId ||
    value.document.path !== path(
      privateCustomerBiteSaverCandidateCollection,
      expectedDocumentId,
    ) ||
    keys.length !== deliveredRestaurantIdentityKeys.length ||
    keys.some((key, index) => key !== deliveredRestaurantIdentityKeys[index]) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    data.role !== "deliveredRestaurantIdentity" ||
    data.state !== "active" ||
    data.sessionId !== value.session.sessionId ||
    data.attemptGeneration !== value.session.attemptGeneration ||
    data.queryFingerprint !== value.session.queryFingerprint ||
    data.callerCapabilityBinding !==
      callerCapabilityBindingFor(value.context, value.session) ||
    data.publicRestaurantId !== value.publicRestaurantId ||
    authoritativeAccountId === null ||
    typeof data.pageGenerationFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.pageGenerationFingerprint) ||
    availabilityAt === null ||
    createdAt === null ||
    logicalExpiresAt === null ||
    absoluteExpiresAt === null ||
    expiresAt === null ||
    availabilityAt.getTime() !== createdAt.getTime() ||
    expiresAt.getTime() !== logicalExpiresAt.getTime() ||
    absoluteExpiresAt.getTime() !== value.session.absoluteExpiresAt.getTime() ||
    expiresAt.getTime() > absoluteExpiresAt.getTime() ||
    expiresAt.getTime() <= value.nowMs ||
    customerBiteSaverOpaqueRestaurantId(
      value.context.secretKey,
      authoritativeAccountId,
    ) !== value.publicRestaurantId
  ) {
    return null;
  }
  return Object.freeze({
    publicRestaurantId: value.publicRestaurantId,
    authoritativeAccountId,
  });
}

function parseDeliveredOfferIdentity(value: {
  document: CustomerBiteSaverStoredDocument | null;
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  publicOfferId: string;
  nowMs: number;
}): FavoriteResolvedOffer | null {
  if (value.document === null) {
    return null;
  }
  const data = value.document.data;
  const keys = Object.keys(data).sort();
  const authoritativeAccountId = exactInternalId(data.authoritativeAccountId);
  const sourceDocumentId = exactInternalId(data.sourceDocumentId);
  const availabilityAt = dateValue(data.availabilityAt);
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  const expectedDocumentId = deliveredOfferIdentityDocumentId({
    context: value.context,
    session: value.session,
    publicOfferId: value.publicOfferId,
  });
  if (
    value.document.id !== expectedDocumentId ||
    value.document.path !== path(
      privateCustomerBiteSaverCandidateCollection,
      expectedDocumentId,
    ) ||
    keys.length !== deliveredOfferIdentityKeys.length ||
    keys.some((key, index) => key !== deliveredOfferIdentityKeys[index]) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    data.role !== "deliveredOfferIdentity" ||
    data.state !== "active" ||
    data.sessionId !== value.session.sessionId ||
    data.attemptGeneration !== value.session.attemptGeneration ||
    data.queryFingerprint !== value.session.queryFingerprint ||
    data.callerCapabilityBinding !==
      callerCapabilityBindingFor(value.context, value.session) ||
    data.publicOfferId !== value.publicOfferId ||
    typeof data.publicRestaurantId !== "string" ||
    authoritativeAccountId === null ||
    sourceDocumentId === null ||
    (data.offerType !== "coupon" && data.offerType !== "dailySpecial") ||
    typeof data.pageGenerationFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.pageGenerationFingerprint) ||
    availabilityAt === null ||
    createdAt === null ||
    logicalExpiresAt === null ||
    absoluteExpiresAt === null ||
    expiresAt === null ||
    availabilityAt.getTime() !== createdAt.getTime() ||
    expiresAt.getTime() !== logicalExpiresAt.getTime() ||
    absoluteExpiresAt.getTime() !== value.session.absoluteExpiresAt.getTime() ||
    expiresAt.getTime() > absoluteExpiresAt.getTime() ||
    expiresAt.getTime() <= value.nowMs ||
    customerBiteSaverOpaqueRestaurantId(
      value.context.secretKey,
      authoritativeAccountId,
    ) !== data.publicRestaurantId ||
    customerBiteSaverOpaqueOfferId(
      value.context.secretKey,
      authoritativeAccountId,
      data.offerType,
      sourceDocumentId,
    ) !== value.publicOfferId
  ) {
    return null;
  }
  return Object.freeze({
    publicOfferId: value.publicOfferId,
    authoritativeAccountId,
    offerType: data.offerType,
    sourceDocumentId,
  });
}

function legacyFavoriteSaverRestaurantDocumentId(
  result: CustomerBiteSaverResultDocument,
): string {
  const snapshot = result.safeRestaurantSnapshot;
  const value = [
    boundedString(snapshot.displayName, 200) ?? "",
    boundedString(snapshot.city, 200) ?? "",
    boundedString(snapshot.zipCode, 20) ?? "",
    boundedString(snapshot.streetAddress, 500) ?? "",
  ].join("_").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return value.length === 0
    ? "bitesaver_restaurant"
    : `bitesaver_${value}`;
}

export type CustomerBiteSaverFavoriteStatesResponse = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  states: readonly Readonly<{
    id: string;
    state: "favorite" | "notFavorite" | "unknown";
  }>[];
}>;

export async function getCustomerBiteSaverFavoriteStatesHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverFavoriteStatesResponse> {
  const request = parseFavoriteRequest(rawRequest);
  const nowMs = context.now?.() ?? Date.now();
  const uid = requireAuthUid(context.identity);
  if (uid === null) {
    throw new CustomerBiteSaverContractError(
      "permission-denied",
      "Sign in to load favorite states.",
    );
  }
  const session = await loadAuthorizedSession(request, context, nowMs);
  if (session.state !== "ready" || session.phase !== "ready") {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver search is not ready.",
    );
  }
  const requestedIds = [...request.restaurantIds, ...request.offerIds];
  try {
    const deliveredRestaurantIdentityPaths = request.restaurantIds.map(
      (publicRestaurantId) => path(
        privateCustomerBiteSaverCandidateCollection,
        deliveredRestaurantIdentityDocumentId({
          context,
          session,
          publicRestaurantId,
        }),
      ),
    );
    const deliveredOfferIdentityPaths = request.offerIds.map((publicOfferId) =>
      path(
        privateCustomerBiteSaverCandidateCollection,
        deliveredOfferIdentityDocumentId({
          context,
          session,
          publicOfferId,
        }),
      ));
    const deliveredIdentityDocuments = await context.database.getDocuments([
      ...deliveredRestaurantIdentityPaths,
      ...deliveredOfferIdentityPaths,
    ]);
    const deliveredRestaurantIdentityDocuments =
      deliveredIdentityDocuments.slice(0, deliveredRestaurantIdentityPaths.length);
    const deliveredOfferIdentityDocuments = deliveredIdentityDocuments.slice(
      deliveredRestaurantIdentityPaths.length,
    );
    const resolvedRestaurants = new Map<string, FavoriteResolvedRestaurant>();
    deliveredRestaurantIdentityDocuments.forEach((document, index) => {
      const publicRestaurantId = request.restaurantIds[index];
      const resolved = parseDeliveredRestaurantIdentity({
        document,
        context,
        session,
        publicRestaurantId,
        nowMs,
      });
      if (resolved !== null) {
        resolvedRestaurants.set(publicRestaurantId, resolved);
      }
    });
    const resolvedOffers = new Map<string, FavoriteResolvedOffer>();
    deliveredOfferIdentityDocuments.forEach((document, index) => {
      const publicOfferId = request.offerIds[index];
      const resolved = parseDeliveredOfferIdentity({
        document,
        context,
        session,
        publicOfferId,
        nowMs,
      });
      if (resolved !== null) {
        resolvedOffers.set(publicOfferId, resolved);
      }
    });
    if (
      resolvedRestaurants.size !== request.restaurantIds.length ||
      resolvedOffers.size !== request.offerIds.length
    ) {
      // A prepared result, preview seed, lookahead row, or marker from another
      // session is not authorization to inspect a customer's favorites.
      return Object.freeze({
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        states: Object.freeze(requestedIds.map((id) =>
          Object.freeze({id, state: "unknown" as const}))),
      });
    }
    const resultPaths = request.restaurantIds.map((publicId) =>
      privateCustomerBiteSaverResultCollection + "/" +
      customerBiteSaverResultDocumentId(
        context.secretKey,
        session.sessionId,
        session.attemptGeneration,
        publicId,
      ));
    const resultDocuments = await context.database.getDocuments(resultPaths);
    const resultByPublicId = new Map<string, CustomerBiteSaverResultDocument>();
    resultDocuments.forEach((document, index) => {
      if (document === null) {
        return;
      }
      const result = parseResultDocument(document, session, context.secretKey);
      if (result === null) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver favorite identity state is invalid.",
        );
      }
      const resolved = resolvedRestaurants.get(request.restaurantIds[index]);
      if (
        resolved === undefined ||
        result.publicRestaurantId !== request.restaurantIds[index] ||
        result.authoritativeAccountId !== resolved.authoritativeAccountId
      ) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver favorite identity state is invalid.",
        );
      }
      resultByPublicId.set(result.publicRestaurantId, result);
    });
    const favoritePaths: string[] = [];
    const canonicalPathByPublicId = new Map<string, string>();
    for (const publicId of request.restaurantIds) {
      const result = resultByPublicId.get(publicId);
      if (result === undefined) {
        continue;
      }
      const favoritePath = "user_profiles/" + uid +
        "/favorite_restaurants/bitesaver_account_" +
        result.authoritativeAccountId;
      favoritePaths.push(favoritePath);
      canonicalPathByPublicId.set(publicId, favoritePath);
    }
    for (const publicId of request.offerIds) {
      const offer = resolvedOffers.get(publicId);
      if (offer === undefined) {
        continue;
      }
      const favoritePath = "user_profiles/" + uid +
        "/favorite_coupons/" + offer.sourceDocumentId;
      favoritePaths.push(favoritePath);
      canonicalPathByPublicId.set(publicId, favoritePath);
    }
    const favoriteDocuments = await context.database.getDocuments(favoritePaths);
    const favoriteByPath = new Map(
      favoritePaths.map((favoritePath, index) => [
        favoritePath,
        favoriteDocuments[index],
      ]),
    );
    const legacyPathByPublicId = new Map<string, string>();
    const legacyPaths: string[] = [];
    for (const publicId of request.restaurantIds) {
      const result = resultByPublicId.get(publicId);
      const canonicalPath = canonicalPathByPublicId.get(publicId);
      if (
        result === undefined ||
        canonicalPath === undefined ||
        favoriteByPath.get(canonicalPath) !== null
      ) {
        continue;
      }
      const legacyPath = "user_profiles/" + uid +
        "/favorite_restaurants/" +
        legacyFavoriteSaverRestaurantDocumentId(result);
      legacyPathByPublicId.set(publicId, legacyPath);
      legacyPaths.push(legacyPath);
    }
    const legacyDocuments = legacyPaths.length === 0
      ? []
      : await context.database.getDocuments(legacyPaths);
    const legacyByPath = new Map(
      legacyPaths.map((legacyPath, index) => [
        legacyPath,
        legacyDocuments[index],
      ]),
    );
    return Object.freeze({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      states: Object.freeze(requestedIds.map((publicId) => {
        const favoritePath = canonicalPathByPublicId.get(publicId);
        if (favoritePath === undefined) {
          return Object.freeze({id: publicId, state: "unknown" as const});
        }
        const favorite = favoriteByPath.get(favoritePath) ?? null;
        const offer = resolvedOffers.get(publicId);
        if (offer !== undefined) {
          if (favorite === null) {
            return Object.freeze({id: publicId, state: "notFavorite" as const});
          }
          const storedParent = exactInternalId(
            favorite.data.restaurantAccountId,
          );
          const storedOfferId = exactInternalId(favorite.data.couponId);
          const storedOfferType = favorite.data.offerType === undefined
            ? null
            : favorite.data.offerType;
          if (
            storedParent !== offer.authoritativeAccountId ||
            (storedOfferId !== null &&
              storedOfferId !== offer.sourceDocumentId) ||
            (storedOfferType !== null &&
              storedOfferType !== offer.offerType) ||
            (storedOfferType === null && offer.offerType !== "coupon")
          ) {
            return Object.freeze({id: publicId, state: "unknown" as const});
          }
          return Object.freeze({id: publicId, state: "favorite" as const});
        }
        const result = resultByPublicId.get(publicId);
        if (result === undefined) {
          return Object.freeze({id: publicId, state: "unknown" as const});
        }
        if (favorite !== null) {
          const storedParent = exactInternalId(
            favorite.data.restaurantAccountId,
          );
          return Object.freeze({
            id: publicId,
            state: storedParent === null ||
                storedParent === result.authoritativeAccountId
              ? "favorite" as const
              : "unknown" as const,
          });
        }
        const legacyPath = legacyPathByPublicId.get(publicId);
        const legacy = legacyPath === undefined
          ? null
          : legacyByPath.get(legacyPath) ?? null;
        if (legacy === null) {
          return Object.freeze({id: publicId, state: "notFavorite" as const});
        }
        return Object.freeze({
          id: publicId,
          state: exactInternalId(legacy.data.restaurantAccountId) ===
              result.authoritativeAccountId
            ? "favorite" as const
            : "unknown" as const,
        });
      })),
    });
  } catch (error) {
    if (error instanceof CustomerBiteSaverContractError) {
      throw error;
    }
    return Object.freeze({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      states: Object.freeze(requestedIds.map((id) =>
        Object.freeze({id, state: "unknown" as const}))),
    });
  }
}

type CustomerBiteSaverRedemptionRequest = BoundSessionRequest & Readonly<{
  restaurantId: string;
  offerId: string;
  offerOccurrence: string;
  redemptionRequestId: string;
  currentCoordinates: Readonly<{
    latitude: number;
    longitude: number;
    capturedAtMillis: number;
  }> | null;
  guestStateRevision: number | null;
}>;

function parseRedemptionRequest(
  value: unknown,
): CustomerBiteSaverRedemptionRequest {
  if (!isPlainRecord(value)) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const expected = [
    "schemaVersion",
    "clientRequestId",
    "clientInstanceId",
    "sessionId",
    "capability",
    "criteriaFingerprint",
    "restaurantId",
    "offerId",
    "offerOccurrence",
    "redemptionRequestId",
    "currentCoordinates",
    "guestStateRevision",
  ].sort();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    typeof value.offerOccurrence !== "string" ||
    value.offerOccurrence.length > 32_768 ||
    typeof value.redemptionRequestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.redemptionRequestId) ||
    (value.guestStateRevision !== null &&
      (typeof value.guestStateRevision !== "number" ||
        !Number.isSafeInteger(value.guestStateRevision) ||
        value.guestStateRevision < 0))
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  let currentCoordinates: CustomerBiteSaverRedemptionRequest[
    "currentCoordinates"
  ] = null;
  if (value.currentCoordinates !== null) {
    if (!isPlainRecord(value.currentCoordinates)) {
      throw new CustomerBiteSaverContractError("invalid-argument");
    }
    const coordinateKeys = Object.keys(value.currentCoordinates).sort();
    const expectedCoordinateKeys = [
      "latitude",
      "longitude",
      "capturedAtMillis",
    ].sort();
    const coordinates = validRestaurantCoordinates(
      value.currentCoordinates.latitude,
      value.currentCoordinates.longitude,
    );
    if (
      coordinateKeys.length !== expectedCoordinateKeys.length ||
      coordinateKeys.some((key, index) =>
        key !== expectedCoordinateKeys[index]) ||
      coordinates === null ||
      typeof value.currentCoordinates.capturedAtMillis !== "number" ||
      !Number.isSafeInteger(value.currentCoordinates.capturedAtMillis) ||
      value.currentCoordinates.capturedAtMillis < 0
    ) {
      throw new CustomerBiteSaverContractError("invalid-argument");
    }
    currentCoordinates = Object.freeze({
      ...coordinates,
      capturedAtMillis: value.currentCoordinates.capturedAtMillis,
    });
  }
  const base = parseBoundSessionRequest({
    schemaVersion: value.schemaVersion,
    clientRequestId: value.clientRequestId,
    clientInstanceId: value.clientInstanceId,
    sessionId: value.sessionId,
    capability: value.capability,
    criteriaFingerprint: value.criteriaFingerprint,
  });
  return Object.freeze({
    ...base,
    restaurantId: requireCustomerBiteSaverPublicId(
      value.restaurantId,
      "bsr",
    ),
    offerId: requireCustomerBiteSaverPublicId(value.offerId, "bso"),
    offerOccurrence: value.offerOccurrence,
    redemptionRequestId: value.redemptionRequestId,
    currentCoordinates,
    guestStateRevision: value.guestStateRevision as number | null,
  });
}

export type CustomerBiteSaverRedemptionValidationResult = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  restaurantId: string;
  offerId: string;
  allowed: boolean;
  reason: string;
  evaluatedAtMillis: number;
  activeTimerExpiresAtMillis: number | null;
  nextAvailableAtMillis: number | null;
  validationId: string | null;
  validationExpiresAtMillis: number | null;
}>;

function unavailableRedemptionResponse(value: {
  request: CustomerBiteSaverRedemptionRequest;
  nowMs: number;
  reason: string;
  decision?: CustomerBiteSaverAvailabilityDecision;
}): CustomerBiteSaverRedemptionValidationResult {
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
    allowed: false,
    reason: value.reason,
    evaluatedAtMillis: value.nowMs,
    activeTimerExpiresAtMillis:
      value.decision?.activeTimerExpiresAtMs ?? null,
    nextAvailableAtMillis: value.decision?.nextAvailableAtMs ?? null,
    validationId: null,
    validationExpiresAtMillis: null,
  });
}

function assertLogicalRedemptionFenceLive(
  context: CustomerBiteSaverSessionContext,
  logicalExpiresAtMs: number,
): void {
  if (contextNow(context) >= logicalExpiresAtMs) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver redemption validation request has expired.",
    );
  }
}

async function validateCustomerBiteSaverOfferRedemptionStartCompletedHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverRedemptionValidationResult> {
  const request = parseRedemptionRequest(rawRequest);
  requireGuestStateRevisionForCaller(request.guestStateRevision, context);
  const nowMs = context.now?.() ?? Date.now();
  const occurrenceCodec = new CustomerBiteSaverOfferOccurrenceCodec({
    key: context.secretKey,
    now: () => nowMs,
  });
  // Authenticate the opaque locator before any database work. Acceptance is
  // completed only after the independently authorized session is loaded.
  const openedOccurrence = occurrenceCodec.open(request.offerOccurrence);
  preflightOfferOccurrenceForRequest({
    payload: openedOccurrence,
    request,
    context,
  });
  let session = await readAuthorizedSession(request, context, nowMs);
  if (session.state !== "ready" || session.phase !== "ready") {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver search is not ready.",
    );
  }
  const occurrencePageGeneration = pageGenerationFingerprint({
    session,
    purpose: openedOccurrence.pagePurpose,
    availabilityAtMs: openedOccurrence.availabilityAtMs,
    callerCapabilityBinding: callerCapabilityBindingFor(context, session),
    guestStateFingerprint:
      openedOccurrence.guestStateFingerprint,
    usageGeneration: openedOccurrence.usageGeneration,
    offerCatalogFingerprint: openedOccurrence.offerCatalogFingerprint,
    restaurantPublicId: openedOccurrence.pagePurpose === "offerPage"
      ? request.restaurantId
      : null,
    matchingMode: openedOccurrence.pagePurpose === "offerPage"
      ? openedOccurrence.matchingMode
      : null,
  });
  const occurrence = occurrenceCodec.decode(request.offerOccurrence, {
    pagePurpose: openedOccurrence.pagePurpose,
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    queryFingerprint: session.queryFingerprint,
    pageGenerationFingerprint: occurrencePageGeneration,
    callerCapabilityBinding: callerCapabilityBindingFor(context, session),
    restaurantPublicId: request.restaurantId,
    offerPublicId: request.offerId,
    matchingMode: openedOccurrence.pagePurpose === "offerPage"
      ? openedOccurrence.matchingMode
      : null,
    availabilityAtMs: openedOccurrence.availabilityAtMs,
    guestStateFingerprint:
      openedOccurrence.guestStateFingerprint,
    usageGeneration: openedOccurrence.usageGeneration,
    offerCatalogFingerprint: openedOccurrence.offerCatalogFingerprint,
  });
  const requestFingerprint = createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    purpose: "redemptionStart",
    restaurantId: request.restaurantId,
    offerId: request.offerId,
    offerOccurrence: request.offerOccurrence,
    redemptionRequestId: request.redemptionRequestId,
    currentCoordinates: request.currentCoordinates === null
      ? null
      : {
          latitude: String(request.currentCoordinates.latitude),
          longitude: String(request.currentCoordinates.longitude),
          capturedAtMillis: request.currentCoordinates.capturedAtMillis,
        },
    guestStateRevision: request.guestStateRevision,
  });
  session = await touchPreauthorizedSession(
    request,
    context,
    session,
    nowMs,
  );
  await reserveCustomerBiteSaverRequestReplay({
    database: context.database,
    secretKey: context.secretKey,
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    callerCapabilityBinding: callerCapabilityBindingFor(context, session),
    purpose: "redemptionStart",
    clientRequestId: request.clientRequestId,
    requestFingerprint,
    nowMs,
    absoluteSessionExpiresAt: session.absoluteExpiresAt,
  });
  const logicalReplay = await reserveCustomerBiteSaverLogicalRedemptionReplay({
    database: context.database,
    secretKey: context.secretKey,
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    callerCapabilityBinding: callerCapabilityBindingFor(context, session),
    redemptionRequestId: request.redemptionRequestId,
    requestFingerprint,
    nowMs,
    logicalSessionExpiresAt: session.logicalExpiresAt,
    absoluteSessionExpiresAt: session.absoluteExpiresAt,
  });
  const replayExpiresAtMs = logicalReplay.logicalExpiresAtMs;
  if (nowMs >= replayExpiresAtMs) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver redemption validation request has expired.",
    );
  }
  // The logical request fixes the public evaluation/result anchor. Current
  // authorization is evaluated separately below before an allow is returned.
  const evaluationAtMs = logicalReplay.evaluationAtMs;
  const resultId = customerBiteSaverResultDocumentId(
    context.secretKey,
    session.sessionId,
    session.attemptGeneration,
    request.restaurantId,
  );
  const result = parseResultDocument(
    await context.database.getDocument(
      privateCustomerBiteSaverResultCollection + "/" + resultId,
    ),
    session,
    context.secretKey,
  );
  if (
    result === null ||
    result.publicRestaurantId !== request.restaurantId
  ) {
    assertLogicalRedemptionFenceLive(context, replayExpiresAtMs);
    return unavailableRedemptionResponse({
      request,
      nowMs: evaluationAtMs,
      reason: "restaurantUnavailable",
    });
  }
  const expectedMatchingMode: "parent" | "offer" = result.parentMatches
    ? "parent"
    : "offer";
  const candidate = parsePreviewCandidate({
    offerType: occurrence.offerType,
    sourceDocumentId: occurrence.sourceDocumentId,
    indexDocumentId: occurrence.indexDocumentId,
    sourceCreatedAtMs: occurrence.sourceCreatedAtMs,
    sourceCreatedAtOrderKey: occurrence.sourceCreatedAtOrderKey,
    sourceFingerprint: occurrence.sourceFingerprint,
  });
  if (
    candidate === null ||
    occurrence.authoritativeAccountId !== result.authoritativeAccountId ||
    (occurrence.pagePurpose === "offerPage" &&
      occurrence.matchingMode !== expectedMatchingMode) ||
    customerBiteSaverOpaqueRestaurantId(
      context.secretKey,
      occurrence.authoritativeAccountId,
    ) !== request.restaurantId ||
    customerBiteSaverOpaqueOfferId(
      context.secretKey,
      occurrence.authoritativeAccountId,
      occurrence.offerType,
      occurrence.sourceDocumentId,
    ) !== request.offerId
  ) {
    assertLogicalRedemptionFenceLive(context, replayExpiresAtMs);
    return unavailableRedemptionResponse({
      request,
      nowMs: evaluationAtMs,
      reason: "offerUnavailable",
    });
  }
  const freshCoordinates = request.currentCoordinates === null
    ? null
    : Object.freeze({
        latitude: request.currentCoordinates.latitude,
        longitude: request.currentCoordinates.longitude,
        capturedAt: new Date(request.currentCoordinates.capturedAtMillis),
      });
  // Parent, exact raw offer, and signed usage are read through one Firestore
  // transaction. That transaction is the validation response's linearization
  // point, so none of those sources can be mixed across snapshots.
  const evaluatedSnapshot = await context.database.runTransaction(
    async (transaction) => {
      const rawParent = await transaction.getDocument(
        "restaurant_accounts/" + result.authoritativeAccountId,
      );
      const evaluateAt = async (atMs: number) => {
        const parent = currentParentFromRaw({
          result,
          rawDocument: rawParent,
          session,
          secretKey: context.secretKey,
          now: new Date(atMs),
        });
        if (parent === null) {
          return null;
        }
        const evaluated = await evaluateOfferSeeds({
          seeds: [Object.freeze({parent, candidate})],
          session,
          context,
          now: new Date(atMs),
          guestUnavailableOfferIds: new Set<string>(),
          freshCoordinates,
          reader: transaction,
        });
        return Object.freeze({parent, evaluated});
      };
      const anchored = await evaluateAt(evaluationAtMs);
      const current = evaluationAtMs === nowMs
        ? anchored
        : await evaluateAt(nowMs);
      return Object.freeze({anchored, current});
    },
  );
  if (evaluatedSnapshot.anchored === null) {
    assertLogicalRedemptionFenceLive(context, replayExpiresAtMs);
    return unavailableRedemptionResponse({
      request,
      nowMs: evaluationAtMs,
      reason: "restaurantUnavailable",
    });
  }
  const {parent, evaluated} = evaluatedSnapshot.anchored;
  const identity = offerIdentityKey({
    authoritativeAccountId: result.authoritativeAccountId,
    offerType: candidate.offerType,
    sourceDocumentId: candidate.sourceDocumentId,
  });
  const current = evaluated.offers.get(identity);
  if (current === undefined) {
    assertLogicalRedemptionFenceLive(context, replayExpiresAtMs);
    return unavailableRedemptionResponse({
      request,
      nowMs: evaluationAtMs,
      reason: "offerUnavailable",
    });
  }
  if (!current.decision.visible || !current.decision.redeemable) {
    assertLogicalRedemptionFenceLive(context, replayExpiresAtMs);
    return unavailableRedemptionResponse({
      request,
      nowMs: evaluationAtMs,
      reason: current.decision.reason,
      decision: current.decision,
    });
  }
  const currentlyAuthorized = evaluatedSnapshot.current?.evaluated.offers.get(
    identity,
  );
  if (
    currentlyAuthorized === undefined ||
    !currentlyAuthorized.decision.visible ||
    !currentlyAuthorized.decision.redeemable
  ) {
    assertLogicalRedemptionFenceLive(context, replayExpiresAtMs);
    return unavailableRedemptionResponse({
      request,
      nowMs: evaluationAtMs,
      reason: currentlyAuthorized?.decision.reason ?? "offerUnavailable",
      ...(currentlyAuthorized === undefined
        ? {}
        : {decision: currentlyAuthorized.decision}),
    });
  }
  const validationExpiresAtMillis = Math.min(
    evaluationAtMs + 60_000,
    replayExpiresAtMs,
    session.absoluteExpiresAt.getTime(),
    current.decision.eligibilityExpiresAtMs ?? Number.MAX_SAFE_INTEGER,
  );
  const usageGeneration = createQueryFingerprint({
    purpose: "redemptionStartUsageGeneration",
    parts: evaluated.usageGenerationParts,
  });
  const validationId = customerBiteSaverDeterministicId(
    context.secretKey,
    "bsv",
    "redemptionStartValidation",
    [
      session.sessionId,
      String(session.attemptGeneration),
      session.callerBindingHash,
      session.capabilityHash,
      request.restaurantId,
      request.offerId,
      request.redemptionRequestId,
      occurrence.pageGenerationFingerprint,
      occurrence.indexDocumentId,
      occurrence.sourceCreatedAtOrderKey,
      occurrence.sourceFingerprint,
      parent.offerCatalogFingerprint,
      current.usageGeneration,
      usageGeneration,
      request.currentCoordinates === null
        ? "noCurrentCoordinates"
        : createQueryFingerprint({
            latitude: String(request.currentCoordinates.latitude),
            longitude: String(request.currentCoordinates.longitude),
            capturedAtMillis: request.currentCoordinates.capturedAtMillis,
          }),
      String(evaluationAtMs),
      String(validationExpiresAtMillis),
    ],
  );
  assertLogicalRedemptionFenceLive(context, replayExpiresAtMs);
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    restaurantId: request.restaurantId,
    offerId: request.offerId,
    allowed: true,
    reason: "available",
    evaluatedAtMillis: evaluationAtMs,
    activeTimerExpiresAtMillis:
      current.decision.activeTimerExpiresAtMs,
    nextAvailableAtMillis: current.decision.nextAvailableAtMs,
    validationId,
    validationExpiresAtMillis,
  });
}

type CustomerBiteSaverGuestUsagePolicy =
  | "oncePerCustomer"
  | "oncePerDay";

type CustomerBiteSaverGuestStoredOffer = Readonly<{
  offerId: string;
  offerType: "coupon" | "dailySpecial";
  sourceDocumentId: string;
  indexDocumentId: string;
  sourceCreatedAtMs: number;
  sourceCreatedAtOrderKey: string;
  sourceFingerprint: string;
  usagePolicy: CustomerBiteSaverGuestUsagePolicy | null;
  eligibilityExpiresAtMs: number | null;
}>;

type CustomerBiteSaverGuestStoredRestaurant = Readonly<{
  resultId: string;
  restaurantId: string;
  sortTuple: RestaurantResultSortTuple;
  authoritativeAccountId: string;
  parentCatalogFingerprint: string;
  parentProjectionFingerprint: string;
  selectedOffers: readonly CustomerBiteSaverGuestStoredOffer[];
  metadataWitnesses: readonly CustomerBiteSaverGuestStoredOffer[];
  hasMoreOffers: boolean;
  usableOfferCount: number | null;
  offerCountState: "current" | "unknown";
}>;

type CustomerBiteSaverGuestRestaurantProgress = Readonly<{
  kind: "restaurantPage";
  outerBoundary: RestaurantResultSortTuple | null;
  readyRestaurants: readonly CustomerBiteSaverGuestStoredRestaurant[];
  currentRestaurant: Readonly<{
    resultId: string;
    restaurantId: string;
    sortTuple: RestaurantResultSortTuple;
    authoritativeAccountId: string;
    parentCatalogFingerprint: string;
    parentProjectionFingerprint: string;
    liveBoundary: readonly [number, string, string] | null;
    retainedOffers: readonly CustomerBiteSaverGuestStoredOffer[];
    visibleOfferCount: number;
    countKnown: boolean;
  }> | null;
  resultSourceExhausted: boolean;
}>;

type CustomerBiteSaverGuestOfferProgress = Readonly<{
  kind: "offerPage";
  resultId: string;
  restaurantId: string;
  authoritativeAccountId: string;
  matchingMode: "parent" | "offer";
  parentCatalogFingerprint: string;
  parentProjectionFingerprint: string;
  scanBoundary: readonly [number, string, string] | null;
  readyOffers: readonly CustomerBiteSaverGuestStoredOffer[];
  sourceExhausted: boolean;
}>;

type CustomerBiteSaverGuestRedemptionProgress = Readonly<{
  kind: "redemptionStart";
  resultId: string;
  restaurantId: string;
  offerId: string;
  authoritativeAccountId: string;
  parentCatalogFingerprint: string;
  parentProjectionFingerprint: string;
  offer: CustomerBiteSaverGuestStoredOffer;
  locallyUnavailable: boolean | null;
}>;

type CustomerBiteSaverGuestProgress =
  | CustomerBiteSaverGuestRestaurantProgress
  | CustomerBiteSaverGuestOfferProgress
  | CustomerBiteSaverGuestRedemptionProgress;

type CustomerBiteSaverGuestOriginalRequest =
  | Readonly<{
      kind: "restaurantPage";
      cursor: string | null;
    }>
  | Readonly<{
      kind: "offerPage";
      cursor: string | null;
      restaurantId: string;
    }>
  | Readonly<{
      kind: "redemptionStart";
      restaurantId: string;
      offerId: string;
      offerOccurrence: string;
      redemptionRequestId: string;
      currentCoordinates: CustomerBiteSaverRedemptionRequest[
        "currentCoordinates"
      ];
    }>;

type CustomerBiteSaverGuestCheckBatch = Readonly<{
  kind: "restaurantLive" | "offerScan" | "redemptionTarget";
  sequence: number;
  token: string;
  candidateDigest: string;
  availabilityGeneration: string;
  consumedBoundaryFingerprint: string;
  candidates: readonly CustomerBiteSaverGuestStoredOffer[];
  nextOfferBoundary: readonly [number, string, string] | null;
  sourceExhausted: boolean;
  issuedAtMillis: number;
  expiresAtMillis: number;
}>;

type CustomerBiteSaverGuestAcceptedAnswer = Readonly<{
  batchSequence: number;
  clientRequestId: string;
  requestFingerprint: string;
  unavailableOfferIds: readonly string[];
}>;

type CustomerBiteSaverGuestLastAcceptedAnswer = Readonly<{
  batchSequence: number;
  clientRequestId: string;
  requestFingerprint: string;
}>;

type CustomerBiteSaverGuestCheckState =
  | "awaitingAnswer"
  | "answerAccepted"
  | "completed"
  | "retryRequired";

type CustomerBiteSaverGuestCheckDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  role: "guestOfferCheck";
  state: CustomerBiteSaverGuestCheckState;
  operation: CustomerBiteSaverGuestOperation;
  operationRef: string;
  sessionId: string;
  attemptGeneration: number;
  criteriaFingerprint: string;
  queryFingerprint: string;
  callerCapabilityBinding: string;
  operationFingerprint: string;
  stateBinding: string;
  originalClientRequestId: string;
  originalRequest: CustomerBiteSaverGuestOriginalRequest;
  guestStateRevision: number;
  evaluationAt: Date;
  timeZone: string;
  utcOffsetMinutes: number;
  batchSequence: number;
  activeBatch: CustomerBiteSaverGuestCheckBatch | null;
  acceptedAnswer: CustomerBiteSaverGuestAcceptedAnswer | null;
  lastAcceptedAnswer: CustomerBiteSaverGuestLastAcceptedAnswer | null;
  progress: CustomerBiteSaverGuestProgress;
  retryReason: CustomerBiteSaverGuestRetryRequiredResponse["reason"] | null;
  restartFrom: CustomerBiteSaverGuestRetryRequiredResponse[
    "restartFrom"
  ] | null;
  createdAt: Date;
  logicalExpiresAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}>;

const customerBiteSaverGuestCheckDocumentMaximumBytes = 768 * 1_024;
const customerBiteSaverGuestReadyOfferLimit =
  customerBiteSaverPageSize + 1;

function guestCheckPath(operationRef: string): string {
  return path(privateCustomerBiteSaverGuestOfferCheckCollection, operationRef);
}

function guestUsagePolicy(
  offer: CurrentOffer,
): CustomerBiteSaverGuestUsagePolicy | null {
  if (offer.offerType !== "coupon") {
    return null;
  }
  const normalized = typeof offer.projection.usageRule === "string"
    ? offer.projection.usageRule.trim().toLowerCase()
    : "";
  if (normalized.length === 0 || normalized === "once per customer") {
    return "oncePerCustomer";
  }
  return normalized === "once per day" ? "oncePerDay" : null;
}

function guestStoredOffer(
  offer: CurrentOffer,
): CustomerBiteSaverGuestStoredOffer {
  const candidate = previewCandidateFromCurrentOffer(offer);
  return Object.freeze({
    offerId: offer.publicOfferId,
    offerType: candidate.offerType,
    sourceDocumentId: candidate.sourceDocumentId,
    indexDocumentId: candidate.indexDocumentId,
    sourceCreatedAtMs: candidate.sourceCreatedAtMs,
    sourceCreatedAtOrderKey: candidate.sourceCreatedAtOrderKey,
    sourceFingerprint: candidate.sourceFingerprint,
    usagePolicy: guestUsagePolicy(offer),
    eligibilityExpiresAtMs: offer.decision.eligibilityExpiresAtMs,
  });
}

function candidateFromGuestStoredOffer(
  offer: CustomerBiteSaverGuestStoredOffer,
): ParsedPreviewCandidate {
  const parsed = parsePreviewCandidate({
    offerType: offer.offerType,
    sourceDocumentId: offer.sourceDocumentId,
    indexDocumentId: offer.indexDocumentId,
    sourceCreatedAtMs: offer.sourceCreatedAtMs,
    sourceCreatedAtOrderKey: offer.sourceCreatedAtOrderKey,
    sourceFingerprint: offer.sourceFingerprint,
  });
  if (
    parsed === null ||
    offer.offerId.length !== 47 ||
    !/^bso_[A-Za-z0-9_-]{43}$/u.test(offer.offerId) ||
    (offer.usagePolicy !== null &&
      offer.usagePolicy !== "oncePerCustomer" &&
      offer.usagePolicy !== "oncePerDay") ||
    Buffer.byteLength(offer.sourceDocumentId, "utf8") > 1_500 ||
    (offer.eligibilityExpiresAtMs !== null &&
      (!Number.isSafeInteger(offer.eligibilityExpiresAtMs) ||
        offer.eligibilityExpiresAtMs < 0))
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest offer-check state is invalid.",
    );
  }
  return parsed;
}

function guestStoredOfferIdentity(
  offer: CustomerBiteSaverGuestStoredOffer,
): string {
  return `${offer.offerType}\0${offer.sourceDocumentId}`;
}

function sameGuestStoredOffer(
  left: CustomerBiteSaverGuestStoredOffer,
  right: CustomerBiteSaverGuestStoredOffer,
): boolean {
  return left.offerId === right.offerId &&
    left.offerType === right.offerType &&
    left.sourceDocumentId === right.sourceDocumentId &&
    left.indexDocumentId === right.indexDocumentId &&
    left.sourceCreatedAtMs === right.sourceCreatedAtMs &&
    left.sourceCreatedAtOrderKey === right.sourceCreatedAtOrderKey &&
    left.sourceFingerprint === right.sourceFingerprint &&
    left.usagePolicy === right.usagePolicy &&
    left.eligibilityExpiresAtMs === right.eligibilityExpiresAtMs;
}

function orderedGuestStoredOffers(
  offers: readonly CustomerBiteSaverGuestStoredOffer[],
): CustomerBiteSaverGuestStoredOffer[] {
  return [...offers].sort((left, right) =>
    (left.offerType === "dailySpecial" ? 0 : 1) -
      (right.offerType === "dailySpecial" ? 0 : 1) ||
    compareCustomerBiteSaverFirestoreUtf8(
      right.sourceCreatedAtOrderKey,
      left.sourceCreatedAtOrderKey,
    ) ||
    compareCustomerBiteSaverFirestoreUtf8(
      right.sourceDocumentId,
      left.sourceDocumentId,
    ));
}

function guestStoredOfferSortTuple(
  offer: CustomerBiteSaverGuestStoredOffer,
): readonly [number, string, string] {
  return Object.freeze([
    offer.offerType === "dailySpecial" ? 0 : 1,
    offer.sourceCreatedAtOrderKey,
    offer.sourceDocumentId,
  ]);
}

function retainGuestPreviewOffers(
  offers: readonly CustomerBiteSaverGuestStoredOffer[],
): readonly CustomerBiteSaverGuestStoredOffer[] {
  const ordered = orderedGuestStoredOffers(offers);
  return Object.freeze([
    ...ordered.filter((offer) => offer.offerType === "dailySpecial").slice(0, 3),
    ...ordered.filter((offer) => offer.offerType === "coupon").slice(0, 3),
  ]);
}

function selectGuestPreviewOffers(
  offers: readonly CustomerBiteSaverGuestStoredOffer[],
): readonly CustomerBiteSaverGuestStoredOffer[] {
  const ordered = orderedGuestStoredOffers(offers);
  const daily = ordered.filter((offer) => offer.offerType === "dailySpecial");
  const coupons = ordered.filter((offer) => offer.offerType === "coupon");
  return Object.freeze(
    daily.length > 0 && coupons.length > 0
      ? [daily[0], coupons[0]]
      : (daily.length > 0 ? daily : coupons).slice(0, 2),
  );
}

function guestCheckSerializedBytes(
  document: CustomerBiteSaverGuestCheckDocument,
): number {
  return Buffer.byteLength(JSON.stringify(document), "utf8");
}

function assertBoundedGuestCheckDocument(
  document: CustomerBiteSaverGuestCheckDocument,
): CustomerBiteSaverGuestCheckDocument {
  const activeCandidates = document.activeBatch?.candidates ?? [];
  const readyOffers = document.progress.kind === "offerPage"
    ? document.progress.readyOffers.length
    : document.progress.kind === "restaurantPage"
      ? document.progress.readyRestaurants.reduce(
          (total, restaurant) => total + restaurant.selectedOffers.length +
            restaurant.metadataWitnesses.length,
          0,
        )
      : 1;
  if (
    activeCandidates.length > customerBiteSaverGuestCheckMaximumCandidateIds ||
    new Set(activeCandidates.map((offer) => offer.offerId)).size !==
      activeCandidates.length ||
    (document.activeBatch !== null && activeCandidates.length === 0) ||
    (document.acceptedAnswer?.unavailableOfferIds.length ?? 0) >
      customerBiteSaverGuestCheckMaximumCandidateIds ||
    readyOffers > customerBiteSaverPageSize * 3 + 3 ||
    guestCheckSerializedBytes(document) >
      customerBiteSaverGuestCheckDocumentMaximumBytes
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest offer-check state exceeded its bounds.",
    );
  }
  return document;
}

const guestCheckDocumentKeys = Object.freeze([
  "absoluteExpiresAt",
  "acceptedAnswer",
  "activeBatch",
  "attemptGeneration",
  "batchSequence",
  "callerCapabilityBinding",
  "createdAt",
  "criteriaFingerprint",
  "evaluationAt",
  "expiresAt",
  "guestStateRevision",
  "lastAcceptedAnswer",
  "logicalExpiresAt",
  "operation",
  "operationFingerprint",
  "operationRef",
  "originalClientRequestId",
  "originalRequest",
  "progress",
  "protocolVersion",
  "queryFingerprint",
  "restartFrom",
  "retryReason",
  "role",
  "schemaVersion",
  "sessionId",
  "state",
  "stateBinding",
  "timeZone",
  "utcOffsetMinutes",
].sort());

function invalidGuestCheckDocumentState(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "The BiteSaver guest offer-check state is invalid.",
  );
}

function canonicalGuestCheckStateValue(value: unknown): unknown {
  if (value === null || typeof value === "string" ||
      typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return invalidGuestCheckDocumentState();
    }
    return Object.freeze({number: Object.is(value, -0) ? "-0" : String(value)});
  }
  if (value instanceof Date) {
    if (!Number.isSafeInteger(value.getTime())) {
      return invalidGuestCheckDocumentState();
    }
    return Object.freeze({dateMillis: String(value.getTime())});
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(canonicalGuestCheckStateValue));
  }
  if (isPlainRecord(value)) {
    return Object.freeze(Object.fromEntries(Object.keys(value).sort().map((key) =>
      Object.freeze([key, canonicalGuestCheckStateValue(value[key])]))));
  }
  return invalidGuestCheckDocumentState();
}

function guestCheckStateBinding(
  context: CustomerBiteSaverSessionContext,
  document: CustomerBiteSaverGuestCheckDocument,
): string {
  const {stateBinding: _stateBinding, ...state} = document;
  return customerBiteSaverDeterministicId(
    context.secretKey,
    "bsgcs",
    "guestOfferCheckState",
    [JSON.stringify(canonicalGuestCheckStateValue(state))],
  );
}

function sealGuestCheckDocument(
  context: CustomerBiteSaverSessionContext,
  document: CustomerBiteSaverGuestCheckDocument,
): CustomerBiteSaverGuestCheckDocument {
  const unsealed = Object.freeze({...document, stateBinding: ""});
  return assertBoundedGuestCheckDocument(Object.freeze({
    ...unsealed,
    stateBinding: guestCheckStateBinding(context, unsealed),
  }));
}

function guestCheckFingerprint(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)
    ? value
    : null;
}

function guestCheckInternalId(value: unknown): string | null {
  const parsed = exactInternalId(value);
  return parsed !== null && Buffer.byteLength(parsed, "utf8") <= 1_500 &&
      hasWellFormedCustomerBiteSaverUtf16(parsed)
    ? parsed
    : null;
}

function guestCheckPublicId(
  value: unknown,
  prefix: "bsr" | "bso",
): string | null {
  return typeof value === "string" &&
      new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`, "u").test(value)
    ? value
    : null;
}

function guestCheckOpaqueString(
  value: unknown,
  maximumLength: number,
): string | null {
  return typeof value === "string" && value.length > 0 &&
      value.length <= maximumLength &&
      Buffer.byteLength(value, "utf8") <= maximumLength &&
      hasWellFormedCustomerBiteSaverUtf16(value)
    ? value
    : null;
}

function sameGuestStoredOfferOrder(
  left: readonly CustomerBiteSaverGuestStoredOffer[],
  right: readonly CustomerBiteSaverGuestStoredOffer[],
): boolean {
  return left.length === right.length && left.every((offer, index) =>
    guestStoredOfferIdentity(offer) === guestStoredOfferIdentity(right[index]));
}

function parseGuestStoredOffer(value: {
  raw: unknown;
  authoritativeAccountId: string;
  context: CustomerBiteSaverSessionContext;
  evaluationAtMs: number;
}): CustomerBiteSaverGuestStoredOffer {
  if (!hasExactRecordKeys(value.raw, [
    "eligibilityExpiresAtMs",
    "indexDocumentId",
    "offerId",
    "offerType",
    "sourceCreatedAtMs",
    "sourceCreatedAtOrderKey",
    "sourceDocumentId",
    "sourceFingerprint",
    "usagePolicy",
  ].sort())) {
    return invalidGuestCheckDocumentState();
  }
  const candidate = parsePrivatePreviewCandidate({
    indexDocumentId: value.raw.indexDocumentId,
    offerType: value.raw.offerType,
    sourceCreatedAtMs: value.raw.sourceCreatedAtMs,
    sourceCreatedAtOrderKey: value.raw.sourceCreatedAtOrderKey,
    sourceDocumentId: value.raw.sourceDocumentId,
    sourceFingerprint: value.raw.sourceFingerprint,
  });
  const offerId = guestCheckPublicId(value.raw.offerId, "bso");
  const eligibilityExpiresAtMs = value.raw.eligibilityExpiresAtMs;
  if (
    candidate === null ||
    offerId === null ||
    (value.raw.usagePolicy !== null &&
      value.raw.usagePolicy !== "oncePerCustomer" &&
      value.raw.usagePolicy !== "oncePerDay") ||
    (candidate.offerType === "dailySpecial" && value.raw.usagePolicy !== null) ||
    (eligibilityExpiresAtMs !== null &&
      (!Number.isSafeInteger(eligibilityExpiresAtMs) ||
        (eligibilityExpiresAtMs as number) <= value.evaluationAtMs)) ||
    Buffer.byteLength(candidate.sourceDocumentId, "utf8") > 1_500 ||
    customerBiteSaverOpaqueOfferId(
      value.context.secretKey,
      value.authoritativeAccountId,
      candidate.offerType,
      candidate.sourceDocumentId,
    ) !== offerId
  ) {
    return invalidGuestCheckDocumentState();
  }
  return Object.freeze({
    offerId,
    offerType: candidate.offerType,
    sourceDocumentId: candidate.sourceDocumentId,
    indexDocumentId: candidate.indexDocumentId,
    sourceCreatedAtMs: candidate.sourceCreatedAtMs,
    sourceCreatedAtOrderKey: candidate.sourceCreatedAtOrderKey,
    sourceFingerprint: candidate.sourceFingerprint,
    usagePolicy: value.raw.usagePolicy,
    eligibilityExpiresAtMs: eligibilityExpiresAtMs as number | null,
  });
}

function parseGuestStoredOfferList(value: {
  raw: unknown;
  authoritativeAccountId: string;
  context: CustomerBiteSaverSessionContext;
  evaluationAtMs: number;
  maximumLength: number;
  requireCheckable?: boolean;
}): readonly CustomerBiteSaverGuestStoredOffer[] {
  if (!Array.isArray(value.raw) || value.raw.length > value.maximumLength) {
    return invalidGuestCheckDocumentState();
  }
  const offers = value.raw.map((raw) => parseGuestStoredOffer({
    raw,
    authoritativeAccountId: value.authoritativeAccountId,
    context: value.context,
    evaluationAtMs: value.evaluationAtMs,
  }));
  if (
    (value.requireCheckable === true &&
      offers.some((offer) => offer.usagePolicy === null)) ||
    new Set(offers.map((offer) => offer.offerId)).size !== offers.length ||
    new Set(offers.map(guestStoredOfferIdentity)).size !== offers.length ||
    !sameGuestStoredOfferOrder(offers, orderedGuestStoredOffers(offers))
  ) {
    return invalidGuestCheckDocumentState();
  }
  return Object.freeze(offers);
}

function parseGuestOriginalRequest(
  raw: unknown,
  operation: CustomerBiteSaverGuestOperation,
): CustomerBiteSaverGuestOriginalRequest {
  const validCursor = (cursor: unknown): cursor is string | null =>
    cursor === null || guestCheckOpaqueString(cursor, 32_768) !== null;
  if (operation === "restaurantPage") {
    if (!hasExactRecordKeys(raw, ["cursor", "kind"].sort()) ||
        raw.kind !== operation || !validCursor(raw.cursor)) {
      return invalidGuestCheckDocumentState();
    }
    return Object.freeze({kind: operation, cursor: raw.cursor});
  }
  if (operation === "offerPage") {
    if (!hasExactRecordKeys(raw, ["cursor", "kind", "restaurantId"].sort()) ||
        raw.kind !== operation || !validCursor(raw.cursor)) {
      return invalidGuestCheckDocumentState();
    }
    const restaurantId = guestCheckPublicId(raw.restaurantId, "bsr");
    if (restaurantId === null) {
      return invalidGuestCheckDocumentState();
    }
    return Object.freeze({kind: operation, cursor: raw.cursor, restaurantId});
  }
  if (!hasExactRecordKeys(raw, [
    "currentCoordinates",
    "kind",
    "offerId",
    "offerOccurrence",
    "redemptionRequestId",
    "restaurantId",
  ].sort()) || raw.kind !== operation) {
    return invalidGuestCheckDocumentState();
  }
  const restaurantId = guestCheckPublicId(raw.restaurantId, "bsr");
  const offerId = guestCheckPublicId(raw.offerId, "bso");
  const offerOccurrence = guestCheckOpaqueString(raw.offerOccurrence, 32_768);
  const redemptionRequestId = guestCheckOpaqueString(
    raw.redemptionRequestId,
    128,
  );
  if (
    restaurantId === null || offerId === null || offerOccurrence === null ||
    redemptionRequestId === null ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(redemptionRequestId)
  ) {
    return invalidGuestCheckDocumentState();
  }
  let currentCoordinates: CustomerBiteSaverRedemptionRequest[
    "currentCoordinates"
  ] = null;
  if (raw.currentCoordinates !== null) {
    if (!hasExactRecordKeys(raw.currentCoordinates, [
      "capturedAtMillis",
      "latitude",
      "longitude",
    ].sort())) {
      return invalidGuestCheckDocumentState();
    }
    const coordinates = validRestaurantCoordinates(
      raw.currentCoordinates.latitude,
      raw.currentCoordinates.longitude,
    );
    if (
      coordinates === null ||
      safeInteger(raw.currentCoordinates.capturedAtMillis) === null
    ) {
      return invalidGuestCheckDocumentState();
    }
    currentCoordinates = Object.freeze({
      ...coordinates,
      capturedAtMillis: raw.currentCoordinates.capturedAtMillis as number,
    });
  }
  return Object.freeze({
    kind: operation,
    restaurantId,
    offerId,
    offerOccurrence,
    redemptionRequestId,
    currentCoordinates,
  });
}

function compareGuestRestaurantSortTuples(
  left: RestaurantResultSortTuple,
  right: RestaurantResultSortTuple,
): number {
  const leftAccountKey = parseDartUtf16FirestoreBytesCursorValue(
    left[3],
    customerBiteSaverMaximumIndexedOrderKeyBytes,
  );
  const rightAccountKey = parseDartUtf16FirestoreBytesCursorValue(
    right[3],
    customerBiteSaverMaximumIndexedOrderKeyBytes,
  );
  if (leftAccountKey === null || rightAccountKey === null) {
    return invalidGuestCheckDocumentState();
  }
  return left[0] - right[0] || left[1] - right[1] ||
    compareCustomerBiteSaverFirestoreUtf8(left[2], right[2]) ||
    Buffer.compare(leftAccountKey, rightAccountKey);
}

function parseGuestStoredRestaurant(value: {
  raw: unknown;
  documentIdentity: Readonly<{
    sessionId: string;
    attemptGeneration: number;
    evaluationAtMs: number;
  }>;
  context: CustomerBiteSaverSessionContext;
}): CustomerBiteSaverGuestStoredRestaurant {
  if (!hasExactRecordKeys(value.raw, [
    "authoritativeAccountId",
    "hasMoreOffers",
    "metadataWitnesses",
    "offerCountState",
    "parentCatalogFingerprint",
    "parentProjectionFingerprint",
    "restaurantId",
    "resultId",
    "selectedOffers",
    "sortTuple",
    "usableOfferCount",
  ].sort())) {
    return invalidGuestCheckDocumentState();
  }
  const authoritativeAccountId = guestCheckInternalId(
    value.raw.authoritativeAccountId,
  );
  const restaurantId = guestCheckPublicId(value.raw.restaurantId, "bsr");
  const sortTuple = parseRestaurantResultSortTuple(value.raw.sortTuple);
  const parentCatalogFingerprint = guestCheckFingerprint(
    value.raw.parentCatalogFingerprint,
  );
  const parentProjectionFingerprint = guestCheckFingerprint(
    value.raw.parentProjectionFingerprint,
  );
  if (
    authoritativeAccountId === null || restaurantId === null ||
    sortTuple === null || parentCatalogFingerprint === null ||
    parentProjectionFingerprint === null ||
    typeof value.raw.hasMoreOffers !== "boolean" ||
    (value.raw.offerCountState !== "current" &&
      value.raw.offerCountState !== "unknown") ||
    value.raw.resultId !== customerBiteSaverResultDocumentId(
      value.context.secretKey,
      value.documentIdentity.sessionId,
      value.documentIdentity.attemptGeneration,
      restaurantId,
    ) ||
    customerBiteSaverOpaqueRestaurantId(
      value.context.secretKey,
      authoritativeAccountId,
    ) !== restaurantId
  ) {
    return invalidGuestCheckDocumentState();
  }
  const selectedOffers = parseGuestStoredOfferList({
    raw: value.raw.selectedOffers,
    authoritativeAccountId,
    context: value.context,
    evaluationAtMs: value.documentIdentity.evaluationAtMs,
    maximumLength: 2,
  });
  const metadataWitnesses = parseGuestStoredOfferList({
    raw: value.raw.metadataWitnesses,
    authoritativeAccountId,
    context: value.context,
    evaluationAtMs: value.documentIdentity.evaluationAtMs,
    maximumLength: 1,
  });
  const combined = [...selectedOffers, ...metadataWitnesses];
  const selectedExpected = selectGuestPreviewOffers(combined);
  const usableOfferCount = value.raw.usableOfferCount;
  if (
    selectedOffers.length === 0 ||
    new Set(combined.map((offer) => offer.offerId)).size !== combined.length ||
    !sameGuestStoredOfferOrder(selectedOffers, selectedExpected) ||
    (value.raw.offerCountState === "unknown" &&
      (usableOfferCount !== null || value.raw.hasMoreOffers !== true ||
        selectedOffers.length !== 2 || metadataWitnesses.length !== 1)) ||
    (value.raw.offerCountState === "current" &&
      (!Number.isSafeInteger(usableOfferCount) ||
        (usableOfferCount as number) < selectedOffers.length ||
        usableOfferCount !== combined.length ||
        metadataWitnesses.length !== (value.raw.hasMoreOffers ? 1 : 0) ||
        value.raw.hasMoreOffers !==
          ((usableOfferCount as number) > selectedOffers.length)))
  ) {
    return invalidGuestCheckDocumentState();
  }
  return Object.freeze({
    resultId: value.raw.resultId as string,
    restaurantId,
    sortTuple,
    authoritativeAccountId,
    parentCatalogFingerprint,
    parentProjectionFingerprint,
    selectedOffers,
    metadataWitnesses,
    hasMoreOffers: value.raw.hasMoreOffers,
    usableOfferCount: usableOfferCount as number | null,
    offerCountState: value.raw.offerCountState,
  });
}

function parseGuestProgress(value: {
  raw: unknown;
  operation: CustomerBiteSaverGuestOperation;
  originalRequest: CustomerBiteSaverGuestOriginalRequest;
  sessionId: string;
  attemptGeneration: number;
  evaluationAtMs: number;
  context: CustomerBiteSaverSessionContext;
}): CustomerBiteSaverGuestProgress {
  if (value.operation === "restaurantPage") {
    if (!hasExactRecordKeys(value.raw, [
      "currentRestaurant",
      "kind",
      "outerBoundary",
      "readyRestaurants",
      "resultSourceExhausted",
    ].sort()) || value.raw.kind !== value.operation ||
      typeof value.raw.resultSourceExhausted !== "boolean" ||
      !Array.isArray(value.raw.readyRestaurants) ||
      value.raw.readyRestaurants.length > customerBiteSaverPageSize + 1) {
      return invalidGuestCheckDocumentState();
    }
    const outerBoundary = value.raw.outerBoundary === null
      ? null
      : parseRestaurantResultSortTuple(value.raw.outerBoundary);
    if (outerBoundary === null && value.raw.outerBoundary !== null) {
      return invalidGuestCheckDocumentState();
    }
    const identity = Object.freeze({
      sessionId: value.sessionId,
      attemptGeneration: value.attemptGeneration,
      evaluationAtMs: value.evaluationAtMs,
    });
    const readyRestaurants = value.raw.readyRestaurants.map((raw) =>
      parseGuestStoredRestaurant({
        raw,
        documentIdentity: identity,
        context: value.context,
      }));
    if (
      new Set(readyRestaurants.map((entry) => entry.restaurantId)).size !==
        readyRestaurants.length ||
      readyRestaurants.some((entry, index) => index > 0 &&
        compareGuestRestaurantSortTuples(
          readyRestaurants[index - 1].sortTuple,
          entry.sortTuple,
        ) >= 0)
    ) {
      return invalidGuestCheckDocumentState();
    }
    let currentRestaurant: CustomerBiteSaverGuestRestaurantProgress[
      "currentRestaurant"
    ] = null;
    if (value.raw.currentRestaurant !== null) {
      if (!hasExactRecordKeys(value.raw.currentRestaurant, [
        "authoritativeAccountId",
        "countKnown",
        "liveBoundary",
        "parentCatalogFingerprint",
        "parentProjectionFingerprint",
        "restaurantId",
        "resultId",
        "retainedOffers",
        "sortTuple",
        "visibleOfferCount",
      ].sort())) {
        return invalidGuestCheckDocumentState();
      }
      const raw = value.raw.currentRestaurant;
      const authoritativeAccountId = guestCheckInternalId(
        raw.authoritativeAccountId,
      );
      const restaurantId = guestCheckPublicId(raw.restaurantId, "bsr");
      const sortTuple = parseRestaurantResultSortTuple(raw.sortTuple);
      const liveBoundary = raw.liveBoundary === null
        ? null
        : parseLiveOfferSortTuple(raw.liveBoundary);
      const parentCatalogFingerprint = guestCheckFingerprint(
        raw.parentCatalogFingerprint,
      );
      const parentProjectionFingerprint = guestCheckFingerprint(
        raw.parentProjectionFingerprint,
      );
      if (
        authoritativeAccountId === null || restaurantId === null ||
        sortTuple === null ||
        (liveBoundary === null && raw.liveBoundary !== null) ||
        liveBoundary === undefined || parentCatalogFingerprint === null ||
        parentProjectionFingerprint === null ||
        !Number.isSafeInteger(raw.visibleOfferCount) ||
        (raw.visibleOfferCount as number) < 0 ||
        typeof raw.countKnown !== "boolean" ||
        raw.resultId !== customerBiteSaverResultDocumentId(
          value.context.secretKey,
          value.sessionId,
          value.attemptGeneration,
          restaurantId,
        ) ||
        customerBiteSaverOpaqueRestaurantId(
          value.context.secretKey,
          authoritativeAccountId,
        ) !== restaurantId ||
        readyRestaurants.some((entry) => entry.restaurantId === restaurantId)
      ) {
        return invalidGuestCheckDocumentState();
      }
      const retainedOffers = parseGuestStoredOfferList({
        raw: raw.retainedOffers,
        authoritativeAccountId,
        context: value.context,
        evaluationAtMs: value.evaluationAtMs,
        maximumLength: 6,
      });
      if ((raw.visibleOfferCount as number) < retainedOffers.length) {
        return invalidGuestCheckDocumentState();
      }
      currentRestaurant = Object.freeze({
        resultId: raw.resultId as string,
        restaurantId,
        sortTuple,
        authoritativeAccountId,
        parentCatalogFingerprint,
        parentProjectionFingerprint,
        liveBoundary: liveBoundary as readonly [number, string, string] | null,
        retainedOffers,
        visibleOfferCount: raw.visibleOfferCount as number,
        countKnown: raw.countKnown,
      });
    }
    return Object.freeze({
      kind: value.operation,
      outerBoundary: outerBoundary as RestaurantResultSortTuple | null,
      readyRestaurants: Object.freeze(readyRestaurants),
      currentRestaurant,
      resultSourceExhausted: value.raw.resultSourceExhausted,
    });
  }
  if (value.operation === "offerPage") {
    if (!hasExactRecordKeys(value.raw, [
      "authoritativeAccountId",
      "kind",
      "matchingMode",
      "parentCatalogFingerprint",
      "parentProjectionFingerprint",
      "readyOffers",
      "restaurantId",
      "resultId",
      "scanBoundary",
      "sourceExhausted",
    ].sort()) || value.raw.kind !== value.operation ||
      typeof value.raw.sourceExhausted !== "boolean") {
      return invalidGuestCheckDocumentState();
    }
    const authoritativeAccountId = guestCheckInternalId(
      value.raw.authoritativeAccountId,
    );
    const restaurantId = guestCheckPublicId(value.raw.restaurantId, "bsr");
    const scanBoundary = value.raw.scanBoundary === null
      ? null
      : parseLiveOfferSortTuple(value.raw.scanBoundary);
    const parentCatalogFingerprint = guestCheckFingerprint(
      value.raw.parentCatalogFingerprint,
    );
    const parentProjectionFingerprint = guestCheckFingerprint(
      value.raw.parentProjectionFingerprint,
    );
    if (
      authoritativeAccountId === null || restaurantId === null ||
      (scanBoundary === null && value.raw.scanBoundary !== null) ||
      scanBoundary === undefined || parentCatalogFingerprint === null ||
      parentProjectionFingerprint === null ||
      (value.raw.matchingMode !== "parent" &&
        value.raw.matchingMode !== "offer") ||
      value.raw.resultId !== customerBiteSaverResultDocumentId(
        value.context.secretKey,
        value.sessionId,
        value.attemptGeneration,
        restaurantId,
      ) ||
      customerBiteSaverOpaqueRestaurantId(
        value.context.secretKey,
        authoritativeAccountId,
      ) !== restaurantId ||
      value.originalRequest.kind !== value.operation ||
      value.originalRequest.restaurantId !== restaurantId
    ) {
      return invalidGuestCheckDocumentState();
    }
    const readyOffers = parseGuestStoredOfferList({
      raw: value.raw.readyOffers,
      authoritativeAccountId,
      context: value.context,
      evaluationAtMs: value.evaluationAtMs,
      maximumLength: customerBiteSaverGuestReadyOfferLimit,
    });
    return Object.freeze({
      kind: value.operation,
      resultId: value.raw.resultId as string,
      restaurantId,
      authoritativeAccountId,
      matchingMode: value.raw.matchingMode,
      parentCatalogFingerprint,
      parentProjectionFingerprint,
      scanBoundary: scanBoundary as readonly [number, string, string] | null,
      readyOffers,
      sourceExhausted: value.raw.sourceExhausted,
    });
  }
  if (!hasExactRecordKeys(value.raw, [
    "authoritativeAccountId",
    "kind",
    "locallyUnavailable",
    "offer",
    "offerId",
    "parentCatalogFingerprint",
    "parentProjectionFingerprint",
    "restaurantId",
    "resultId",
  ].sort()) || value.raw.kind !== value.operation ||
    (value.raw.locallyUnavailable !== null &&
      typeof value.raw.locallyUnavailable !== "boolean")) {
    return invalidGuestCheckDocumentState();
  }
  const authoritativeAccountId = guestCheckInternalId(
    value.raw.authoritativeAccountId,
  );
  const restaurantId = guestCheckPublicId(value.raw.restaurantId, "bsr");
  const offerId = guestCheckPublicId(value.raw.offerId, "bso");
  const parentCatalogFingerprint = guestCheckFingerprint(
    value.raw.parentCatalogFingerprint,
  );
  const parentProjectionFingerprint = guestCheckFingerprint(
    value.raw.parentProjectionFingerprint,
  );
  if (
    authoritativeAccountId === null || restaurantId === null || offerId === null ||
    parentCatalogFingerprint === null || parentProjectionFingerprint === null ||
    value.raw.resultId !== customerBiteSaverResultDocumentId(
      value.context.secretKey,
      value.sessionId,
      value.attemptGeneration,
      restaurantId,
    ) ||
    customerBiteSaverOpaqueRestaurantId(
      value.context.secretKey,
      authoritativeAccountId,
    ) !== restaurantId ||
    value.originalRequest.kind !== value.operation ||
    value.originalRequest.restaurantId !== restaurantId ||
    value.originalRequest.offerId !== offerId
  ) {
    return invalidGuestCheckDocumentState();
  }
  const offer = parseGuestStoredOffer({
    raw: value.raw.offer,
    authoritativeAccountId,
    context: value.context,
    evaluationAtMs: value.evaluationAtMs,
  });
  if (offer.offerId !== offerId) {
    return invalidGuestCheckDocumentState();
  }
  return Object.freeze({
    kind: value.operation,
    resultId: value.raw.resultId as string,
    restaurantId,
    offerId,
    authoritativeAccountId,
    parentCatalogFingerprint,
    parentProjectionFingerprint,
    offer,
    locallyUnavailable: value.raw.locallyUnavailable,
  });
}

function parseGuestCheckBatch(value: {
  raw: unknown;
  document: Omit<CustomerBiteSaverGuestCheckDocument,
    "activeBatch" | "acceptedAnswer" | "lastAcceptedAnswer">;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): CustomerBiteSaverGuestCheckBatch | null {
  if (value.raw === null) {
    return null;
  }
  if (!hasExactRecordKeys(value.raw, [
    "availabilityGeneration",
    "candidateDigest",
    "candidates",
    "consumedBoundaryFingerprint",
    "expiresAtMillis",
    "issuedAtMillis",
    "kind",
    "nextOfferBoundary",
    "sequence",
    "sourceExhausted",
    "token",
  ].sort())) {
    return invalidGuestCheckDocumentState();
  }
  const expectedKind = value.document.operation === "restaurantPage"
    ? "restaurantLive"
    : value.document.operation === "offerPage"
      ? "offerScan"
      : "redemptionTarget";
  const authoritativeAccountId = value.document.progress.kind ===
      "restaurantPage"
    ? value.document.progress.currentRestaurant?.authoritativeAccountId ?? null
    : value.document.progress.authoritativeAccountId;
  const nextOfferBoundary = value.raw.nextOfferBoundary === null
    ? null
    : parseLiveOfferSortTuple(value.raw.nextOfferBoundary);
  if (
    value.raw.kind !== expectedKind || authoritativeAccountId === null ||
    !Number.isSafeInteger(value.raw.sequence) ||
    value.raw.sequence !== value.document.batchSequence ||
    guestCheckFingerprint(value.raw.candidateDigest) === null ||
    guestCheckFingerprint(value.raw.availabilityGeneration) === null ||
    guestCheckFingerprint(value.raw.consumedBoundaryFingerprint) === null ||
    guestCheckOpaqueString(value.raw.token, 32_768) === null ||
    typeof value.raw.sourceExhausted !== "boolean" ||
    !Number.isSafeInteger(value.raw.issuedAtMillis) ||
    !Number.isSafeInteger(value.raw.expiresAtMillis) ||
    (value.raw.issuedAtMillis as number) < value.document.evaluationAt.getTime() ||
    (value.raw.expiresAtMillis as number) <=
      (value.raw.issuedAtMillis as number) ||
    (value.raw.expiresAtMillis as number) >
      value.document.logicalExpiresAt.getTime() ||
    (value.raw.expiresAtMillis as number) >
      value.session.logicalExpiresAt.getTime() ||
    (value.raw.expiresAtMillis as number) >
      (value.raw.issuedAtMillis as number) +
        customerBiteSaverGuestCheckLifetimeMilliseconds ||
    (nextOfferBoundary === null && value.raw.nextOfferBoundary !== null) ||
    nextOfferBoundary === undefined ||
    (expectedKind === "redemptionTarget" &&
      (nextOfferBoundary !== null || value.raw.sourceExhausted !== true)) ||
    (expectedKind !== "redemptionTarget" && nextOfferBoundary === null)
  ) {
    return invalidGuestCheckDocumentState();
  }
  const candidates = parseGuestStoredOfferList({
    raw: value.raw.candidates,
    authoritativeAccountId,
    context: value.context,
    evaluationAtMs: value.document.evaluationAt.getTime(),
    maximumLength: customerBiteSaverGuestCheckMaximumCandidateIds,
    requireCheckable: true,
  });
  if (
    candidates.length === 0 ||
    value.raw.candidateDigest !==
      createCustomerBiteSaverGuestOfferCheckCandidateDigest(
        candidates.map((candidate) => candidate.offerId),
      ) ||
    value.raw.availabilityGeneration !== guestCheckAvailabilityGeneration({
      session: value.session,
      evaluationAtMs: value.document.evaluationAt.getTime(),
      candidates,
    }) ||
    value.raw.consumedBoundaryFingerprint !==
      guestCheckBoundaryFingerprint(value.document.progress) ||
    (expectedKind === "redemptionTarget" &&
      (candidates.length !== 1 ||
        value.document.progress.kind !== "redemptionStart" ||
        candidates[0].offerId !== value.document.progress.offerId))
  ) {
    return invalidGuestCheckDocumentState();
  }
  return Object.freeze({
    kind: expectedKind,
    sequence: value.raw.sequence as number,
    token: value.raw.token as string,
    candidateDigest: value.raw.candidateDigest as string,
    availabilityGeneration: value.raw.availabilityGeneration as string,
    consumedBoundaryFingerprint: value.raw.consumedBoundaryFingerprint as string,
    candidates,
    nextOfferBoundary:
      nextOfferBoundary as readonly [number, string, string] | null,
    sourceExhausted: value.raw.sourceExhausted,
    issuedAtMillis: value.raw.issuedAtMillis as number,
    expiresAtMillis: value.raw.expiresAtMillis as number,
  });
}

function parseGuestAcceptedAnswer(value: {
  raw: unknown;
  document: Omit<CustomerBiteSaverGuestCheckDocument,
    "acceptedAnswer" | "lastAcceptedAnswer">;
}): CustomerBiteSaverGuestAcceptedAnswer | null {
  if (value.raw === null) {
    return null;
  }
  if (!hasExactRecordKeys(value.raw, [
    "batchSequence",
    "clientRequestId",
    "requestFingerprint",
    "unavailableOfferIds",
  ].sort()) || value.document.activeBatch === null ||
    !Number.isSafeInteger(value.raw.batchSequence) ||
    value.raw.batchSequence !== value.document.activeBatch.sequence ||
    guestCheckOpaqueString(value.raw.clientRequestId, 128) === null ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.raw.clientRequestId as string) ||
    guestCheckFingerprint(value.raw.requestFingerprint) === null ||
    !Array.isArray(value.raw.unavailableOfferIds) ||
    value.raw.unavailableOfferIds.length >
      customerBiteSaverGuestCheckMaximumCandidateIds) {
    return invalidGuestCheckDocumentState();
  }
  const unavailableOfferIds = value.raw.unavailableOfferIds.map((entry) =>
    guestCheckPublicId(entry, "bso"));
  const candidateIds = new Set(value.document.activeBatch.candidates.map(
    (candidate) => candidate.offerId,
  ));
  if (
    unavailableOfferIds.some((entry) => entry === null) ||
    new Set(unavailableOfferIds).size !== unavailableOfferIds.length ||
    unavailableOfferIds.some((entry) => !candidateIds.has(entry as string)) ||
    unavailableOfferIds.some((entry, index) => index > 0 &&
      compareCustomerBiteSaverFirestoreUtf8(
        unavailableOfferIds[index - 1] as string,
        entry as string,
      ) >= 0)
  ) {
    return invalidGuestCheckDocumentState();
  }
  const ids = Object.freeze(unavailableOfferIds as string[]);
  const expectedFingerprint = createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    purpose: "guestOfferCheckAnswer",
    sessionId: value.document.sessionId,
    operationRef: value.document.operationRef,
    checkToken: value.document.activeBatch.token,
    batchSequence: value.raw.batchSequence,
    guestStateRevision: value.document.guestStateRevision,
    entireBatchEvaluated: true,
    unavailableOfferIds: ids,
  });
  if (value.raw.requestFingerprint !== expectedFingerprint) {
    return invalidGuestCheckDocumentState();
  }
  return Object.freeze({
    batchSequence: value.raw.batchSequence as number,
    clientRequestId: value.raw.clientRequestId as string,
    requestFingerprint: value.raw.requestFingerprint as string,
    unavailableOfferIds: ids,
  });
}

function parseGuestLastAcceptedAnswer(
  raw: unknown,
): CustomerBiteSaverGuestLastAcceptedAnswer | null {
  if (raw === null) {
    return null;
  }
  if (!hasExactRecordKeys(raw, [
    "batchSequence",
    "clientRequestId",
    "requestFingerprint",
  ].sort()) || !Number.isSafeInteger(raw.batchSequence) ||
    (raw.batchSequence as number) < 0 ||
    guestCheckOpaqueString(raw.clientRequestId, 128) === null ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(raw.clientRequestId as string) ||
    guestCheckFingerprint(raw.requestFingerprint) === null) {
    return invalidGuestCheckDocumentState();
  }
  return Object.freeze({
    batchSequence: raw.batchSequence as number,
    clientRequestId: raw.clientRequestId as string,
    requestFingerprint: raw.requestFingerprint as string,
  });
}

function guestProgressStoredOffers(
  progress: CustomerBiteSaverGuestProgress,
): readonly CustomerBiteSaverGuestStoredOffer[] {
  if (progress.kind === "offerPage") {
    return progress.readyOffers;
  }
  if (progress.kind === "redemptionStart") {
    return Object.freeze([progress.offer]);
  }
  return Object.freeze([
    ...progress.readyRestaurants.flatMap((restaurant) => [
      ...restaurant.selectedOffers,
      ...restaurant.metadataWitnesses,
    ]),
    ...(progress.currentRestaurant?.retainedOffers ?? []),
  ]);
}

function parseGuestCheckDocument(
  stored: CustomerBiteSaverStoredDocument | null,
  context: CustomerBiteSaverSessionContext,
  session: CustomerBiteSaverSessionDocument,
): CustomerBiteSaverGuestCheckDocument | null {
  if (stored === null) {
    return null;
  }
  const data = stored.data;
  const evaluationAt = dateValue(data.evaluationAt);
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  let timeZoneValid = false;
  if (typeof data.timeZone === "string") {
    try {
      new Intl.DateTimeFormat("en-US", {timeZone: data.timeZone}).format(
        new Date(0),
      );
      timeZoneValid = true;
    } catch {
      timeZoneValid = false;
    }
  }
  if (
    !hasExactRecordKeys(data, guestCheckDocumentKeys) ||
    stored.id !== stored.path.slice(stored.path.lastIndexOf("/") + 1) ||
    stored.path !== guestCheckPath(stored.id) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    data.role !== "guestOfferCheck" ||
    (data.state !== "awaitingAnswer" && data.state !== "answerAccepted" &&
      data.state !== "completed" && data.state !== "retryRequired") ||
    (data.operation !== "restaurantPage" && data.operation !== "offerPage" &&
      data.operation !== "redemptionStart") ||
    data.operationRef !== stored.id ||
    typeof data.operationRef !== "string" ||
    !/^bsgc_[A-Za-z0-9_-]{43}$/u.test(data.operationRef) ||
    typeof data.sessionId !== "string" ||
    !/^bss_[A-Za-z0-9_-]{43}$/u.test(data.sessionId) ||
    !Number.isSafeInteger(data.attemptGeneration) ||
    (data.attemptGeneration as number) < 0 ||
    typeof data.criteriaFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.criteriaFingerprint) ||
    typeof data.queryFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.queryFingerprint) ||
    typeof data.callerCapabilityBinding !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.callerCapabilityBinding) ||
    typeof data.operationFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.operationFingerprint) ||
    typeof data.stateBinding !== "string" ||
    !/^bsgcs_[A-Za-z0-9_-]{43}$/u.test(data.stateBinding) ||
    typeof data.originalClientRequestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(data.originalClientRequestId) ||
    !Number.isSafeInteger(data.guestStateRevision) ||
    (data.guestStateRevision as number) < 0 ||
    !Number.isSafeInteger(data.batchSequence) ||
    (data.batchSequence as number) < 0 ||
    typeof data.timeZone !== "string" || data.timeZone.length === 0 ||
    data.timeZone.length > 100 || !timeZoneValid ||
    typeof data.utcOffsetMinutes !== "number" ||
    !Number.isSafeInteger(data.utcOffsetMinutes) ||
    data.utcOffsetMinutes < -840 || data.utcOffsetMinutes > 840 ||
    evaluationAt === null || createdAt === null ||
    logicalExpiresAt === null || absoluteExpiresAt === null ||
    expiresAt === null ||
    createdAt.getTime() > evaluationAt.getTime() ||
    logicalExpiresAt.getTime() <= evaluationAt.getTime() ||
    logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime() ||
    data.originalRequest === undefined || data.progress === undefined ||
    data.activeBatch === undefined || data.acceptedAnswer === undefined ||
    data.lastAcceptedAnswer === undefined || data.retryReason === undefined ||
    data.restartFrom === undefined ||
    data.sessionId !== session.sessionId ||
    data.attemptGeneration !== session.attemptGeneration ||
    data.criteriaFingerprint !== session.criteriaFingerprint ||
    data.queryFingerprint !== session.queryFingerprint ||
    data.timeZone !== session.criteria.timeZone ||
    data.utcOffsetMinutes !== session.criteria.utcOffsetMinutes ||
    absoluteExpiresAt.getTime() !== session.absoluteExpiresAt.getTime()
  ) {
    return invalidGuestCheckDocumentState();
  }
  if (!customerBiteSaverConstantTimeHexEqual(
    data.callerCapabilityBinding as string,
    callerCapabilityBindingFor(context, session),
  )) {
    throw new CustomerBiteSaverContractError(
      "permission-denied",
      "The BiteSaver guest offer check is unavailable.",
    );
  }
  const operation = data.operation as CustomerBiteSaverGuestOperation;
  const originalRequest = parseGuestOriginalRequest(data.originalRequest, operation);
  const progress = parseGuestProgress({
    raw: data.progress,
    operation,
    originalRequest,
    sessionId: data.sessionId as string,
    attemptGeneration: data.attemptGeneration as number,
    evaluationAtMs: evaluationAt.getTime(),
    context,
  });
  const partial = Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: "guestOfferCheck" as const,
    state: data.state as CustomerBiteSaverGuestCheckState,
    operation,
    operationRef: data.operationRef as string,
    sessionId: data.sessionId as string,
    attemptGeneration: data.attemptGeneration as number,
    criteriaFingerprint: data.criteriaFingerprint as string,
    queryFingerprint: data.queryFingerprint as string,
    callerCapabilityBinding: data.callerCapabilityBinding as string,
    operationFingerprint: data.operationFingerprint as string,
    stateBinding: data.stateBinding as string,
    originalClientRequestId: data.originalClientRequestId as string,
    originalRequest,
    guestStateRevision: data.guestStateRevision as number,
    evaluationAt,
    timeZone: data.timeZone as string,
    utcOffsetMinutes: data.utcOffsetMinutes as number,
    batchSequence: data.batchSequence as number,
    progress,
    retryReason: data.retryReason as CustomerBiteSaverGuestRetryRequiredResponse[
      "reason"
    ] | null,
    restartFrom: data.restartFrom as CustomerBiteSaverGuestRetryRequiredResponse[
      "restartFrom"
    ] | null,
    createdAt,
    logicalExpiresAt,
    absoluteExpiresAt,
    expiresAt,
  });
  const activeBatch = parseGuestCheckBatch({
    raw: data.activeBatch,
    document: partial,
    session,
    context,
  });
  const withBatch = Object.freeze({...partial, activeBatch});
  const acceptedAnswer = parseGuestAcceptedAnswer({
    raw: data.acceptedAnswer,
    document: withBatch,
  });
  const lastAcceptedAnswer = parseGuestLastAcceptedAnswer(
    data.lastAcceptedAnswer,
  );
  const document = Object.freeze({
    ...withBatch,
    acceptedAnswer,
    lastAcceptedAnswer,
  }) as CustomerBiteSaverGuestCheckDocument;
  const expectedOperationFingerprint = guestCheckOperationFingerprint(
    originalRequest,
    document.guestStateRevision,
  );
  const expectedOperationRef = createCustomerBiteSaverGuestOfferCheckOperationRef(
    context.secretKey,
    {
      operationPurpose: operation,
      sessionId: document.sessionId,
      attemptGeneration: document.attemptGeneration,
      criteriaFingerprint: document.criteriaFingerprint,
      queryFingerprint: document.queryFingerprint,
      callerCapabilityBinding: document.callerCapabilityBinding,
      operationFingerprint: expectedOperationFingerprint,
      restaurantPublicId: originalRequest.kind === "restaurantPage"
        ? null
        : originalRequest.restaurantId,
    },
  );
  const awaiting = document.state === "awaitingAnswer";
  const answerAccepted = document.state === "answerAccepted";
  const retryRequired = document.state === "retryRequired";
  const validRetryReason = document.retryReason === "guestStateChanged" ||
    document.retryReason === "sourceChanged" ||
    document.retryReason === "sessionChanged" ||
    document.retryReason === "checkExpired" ||
    document.retryReason === "workBudget";
  const validRestart = document.restartFrom === "originalOperation" ||
    document.restartFrom === "search";
  const storedOffers = [
    ...guestProgressStoredOffers(document.progress),
    ...(document.activeBatch?.candidates ?? []),
  ];
  const crossesStoredOfferBoundary = document.operation === "redemptionStart" &&
    storedOffers.some((offer) =>
      offer.eligibilityExpiresAtMs !== null &&
      document.logicalExpiresAt.getTime() > offer.eligibilityExpiresAtMs);
  const completedProgressIsTerminal = document.state !== "completed" ||
    (document.progress.kind === "restaurantPage"
      ? document.progress.currentRestaurant === null &&
        (document.progress.resultSourceExhausted ||
          document.progress.readyRestaurants.length >=
            customerBiteSaverPageSize + 1)
      : document.progress.kind === "offerPage"
        ? document.progress.sourceExhausted ||
          document.progress.readyOffers.length >=
            customerBiteSaverGuestReadyOfferLimit
        : document.progress.locallyUnavailable !== null);
  const expectedStateBinding = guestCheckStateBinding(context, document);
  if (
    !timingSafeEqual(
      Buffer.from(document.stateBinding, "utf8"),
      Buffer.from(expectedStateBinding, "utf8"),
    ) ||
    !customerBiteSaverConstantTimeHexEqual(
      document.operationFingerprint,
      expectedOperationFingerprint,
    ) ||
    document.operationRef !== expectedOperationRef ||
    (document.operation === "redemptionStart" &&
      document.logicalExpiresAt.getTime() >
        session.logicalExpiresAt.getTime()) ||
    crossesStoredOfferBoundary ||
    (document.progress.kind === "restaurantPage" &&
      document.progress.resultSourceExhausted &&
      document.progress.currentRestaurant !== null) ||
    (document.progress.kind === "restaurantPage" &&
      document.progress.readyRestaurants.length >=
        customerBiteSaverPageSize + 1 &&
      document.progress.currentRestaurant !== null) ||
    !completedProgressIsTerminal ||
    ((awaiting || answerAccepted) !== (document.activeBatch !== null)) ||
    (awaiting && document.acceptedAnswer !== null) ||
    (answerAccepted && document.acceptedAnswer === null) ||
    ((!awaiting && !answerAccepted) && document.acceptedAnswer !== null) ||
    ((awaiting || answerAccepted) &&
      (document.retryReason !== null || document.restartFrom !== null)) ||
    (document.state === "completed" &&
      (document.retryReason !== null || document.restartFrom !== null)) ||
    (retryRequired && (!validRetryReason || !validRestart)) ||
    (!retryRequired && (validRetryReason || validRestart)) ||
    (document.lastAcceptedAnswer !== null &&
      document.lastAcceptedAnswer.batchSequence >= document.batchSequence) ||
    (document.activeBatch !== null &&
      document.activeBatch.expiresAtMillis >
        document.logicalExpiresAt.getTime())
  ) {
    return invalidGuestCheckDocumentState();
  }
  if (document.activeBatch !== null) {
    try {
      const codec = new CustomerBiteSaverGuestOfferCheckCodec({
        key: context.secretKey,
        now: () => document.activeBatch?.issuedAtMillis ?? 0,
      });
      const payload = codec.open(document.activeBatch.token, {allowExpired: true});
      codec.decode(
        document.activeBatch.token,
        guestCheckTokenBinding(document, payload),
      );
    } catch {
      return invalidGuestCheckDocumentState();
    }
  }
  try {
    return assertBoundedGuestCheckDocument(document);
  } catch {
    return invalidGuestCheckDocumentState();
  }
}

function guestCheckOperationFingerprint(
  request: CustomerBiteSaverGuestOriginalRequest,
  guestStateRevision: number,
): string {
  const canonicalRequest = request.kind !== "redemptionStart" ||
      request.currentCoordinates === null
    ? request
    : Object.freeze({
        ...request,
        currentCoordinates: Object.freeze({
          latitude: String(request.currentCoordinates.latitude),
          longitude: String(request.currentCoordinates.longitude),
          capturedAtMillis: request.currentCoordinates.capturedAtMillis,
        }),
      });
  return createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "guestOfferCheckOperation",
    guestStateRevision,
    request: canonicalRequest,
  });
}

function guestCheckBoundaryFingerprint(
  progress: CustomerBiteSaverGuestProgress,
): string {
  return createQueryFingerprint({
    kind: progress.kind,
    progress,
  });
}

function guestCheckAvailabilityGeneration(value: {
  session: CustomerBiteSaverSessionDocument;
  evaluationAtMs: number;
  candidates: readonly CustomerBiteSaverGuestStoredOffer[];
}): string {
  return createQueryFingerprint({
    purpose: "guestOfferCheckAvailabilityGeneration",
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    queryFingerprint: value.session.queryFingerprint,
    evaluationAtMillis: value.evaluationAtMs,
    timeZone: value.session.criteria.timeZone,
    utcOffsetMinutes: value.session.criteria.utcOffsetMinutes,
    candidates: value.candidates.map((candidate) => ({
      offerId: candidate.offerId,
      usagePolicy: candidate.usagePolicy,
      sourceFingerprint: candidate.sourceFingerprint,
      eligibilityExpiresAtMs: candidate.eligibilityExpiresAtMs,
    })),
  });
}

function capGuestDocumentToStoredOfferBoundaries(
  document: CustomerBiteSaverGuestCheckDocument,
  offers: readonly CustomerBiteSaverGuestStoredOffer[],
): CustomerBiteSaverGuestCheckDocument {
  let expiresAtMs = document.logicalExpiresAt.getTime();
  for (const offer of offers) {
    if (offer.eligibilityExpiresAtMs !== null) {
      expiresAtMs = Math.min(expiresAtMs, offer.eligibilityExpiresAtMs);
    }
    if (offer.usagePolicy === "oncePerDay") {
      expiresAtMs = Math.min(
        expiresAtMs,
        nextGuestDailyResetBoundary(
          document.evaluationAt.getTime(),
          document.timeZone,
        ),
      );
    }
  }
  if (expiresAtMs === document.logicalExpiresAt.getTime()) {
    return document;
  }
  return assertBoundedGuestCheckDocument(Object.freeze({
    ...document,
    logicalExpiresAt: new Date(expiresAtMs),
    expiresAt: new Date(document.absoluteExpiresAt.getTime()),
  }));
}

function guestCheckResponse(
  document: CustomerBiteSaverGuestCheckDocument,
): CustomerBiteSaverGuestCheckRequiredResponse {
  const batch = document.activeBatch;
  if (document.state !== "awaitingAnswer" || batch === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest offer check is not awaiting an answer.",
    );
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    outcome: "guestCheckRequired",
    operation: document.operation,
    operationRef: document.operationRef,
    checkToken: batch.token,
    batchSequence: batch.sequence,
    guestStateRevision: document.guestStateRevision,
    evaluationContext: Object.freeze({
      evaluationAtMillis: document.evaluationAt.getTime(),
      timeZone: document.timeZone,
      utcOffsetMinutes: document.utcOffsetMinutes,
      availabilityGeneration: batch.availabilityGeneration,
    }),
    logicalExpiresAtMillis: batch.expiresAtMillis,
    candidates: Object.freeze(batch.candidates.map((candidate) =>
      Object.freeze({
        offerId: candidate.offerId,
        usagePolicy: candidate.usagePolicy as CustomerBiteSaverGuestUsagePolicy,
      }))),
  });
}

function guestRetryResponse(
  document: CustomerBiteSaverGuestCheckDocument,
  reason: CustomerBiteSaverGuestRetryRequiredResponse["reason"] =
    document.retryReason ?? "sessionChanged",
  restartFrom: CustomerBiteSaverGuestRetryRequiredResponse["restartFrom"] =
    document.restartFrom ?? "originalOperation",
): CustomerBiteSaverGuestRetryRequiredResponse {
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    outcome: "retryRequired",
    operation: document.operation,
    guestStateRevision: document.guestStateRevision,
    reason,
    restartFrom,
    logicalExpiresAtMillis: document.logicalExpiresAt.getTime(),
  });
}

function guestOperationLogicalExpiry(value: {
  nowMs: number;
  session: CustomerBiteSaverSessionDocument;
  externalExpiresAtMs?: number;
}): number {
  const expiresAtMs = Math.min(
    value.nowMs + customerBiteSaverGuestCheckLifetimeMilliseconds,
    value.session.logicalExpiresAt.getTime(),
    value.session.absoluteExpiresAt.getTime(),
    value.externalExpiresAtMs ?? Number.MAX_SAFE_INTEGER,
  );
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= value.nowMs) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest offer check expired.",
    );
  }
  return expiresAtMs;
}

function nextGuestDailyResetBoundary(
  fromMs: number,
  timeZone: string,
): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let candidate = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  const maximum = candidate + 27 * 60 * 60_000;
  for (; candidate <= maximum; candidate += 60_000) {
    const parts = new Map(formatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]));
    if (parts.get("hour") === "00" && parts.get("minute") === "01") {
      return candidate;
    }
  }
  return fromMs + customerBiteSaverGuestCheckLifetimeMilliseconds;
}

function guestBatchExpiry(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  candidates: readonly CurrentOffer[];
  nowMs: number;
}): number {
  let expiresAtMs = Math.min(
    value.nowMs + customerBiteSaverGuestCheckLifetimeMilliseconds,
    value.session.logicalExpiresAt.getTime(),
    value.session.absoluteExpiresAt.getTime(),
    value.document.logicalExpiresAt.getTime(),
  );
  for (const candidate of value.candidates) {
    const boundary = candidate.decision.eligibilityExpiresAtMs;
    if (
      boundary !== null &&
      boundary > value.nowMs
    ) {
      expiresAtMs = Math.min(expiresAtMs, boundary);
    }
    if (guestUsagePolicy(candidate) === "oncePerDay") {
      expiresAtMs = Math.min(
        expiresAtMs,
        nextGuestDailyResetBoundary(
          value.nowMs,
          value.document.timeZone,
        ),
      );
    }
  }
  return expiresAtMs;
}

function createGuestCheckBatch(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  kind: CustomerBiteSaverGuestCheckBatch["kind"];
  candidates: readonly CurrentOffer[];
  nextOfferBoundary: readonly [number, string, string] | null;
  sourceExhausted: boolean;
  nowMs: number;
}): CustomerBiteSaverGuestCheckDocument {
  const checkable = value.candidates.filter((candidate) =>
    candidate.decision.visible && guestUsagePolicy(candidate) !== null);
  if (
    checkable.length === 0 ||
    checkable.length > customerBiteSaverGuestCheckMaximumCandidateIds
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const candidates = Object.freeze(checkable.map(guestStoredOffer));
  const boundedDocument = capGuestDocumentToStoredOfferBoundaries(
    value.document,
    candidates,
  );
  const candidateOfferIds = Object.freeze(candidates.map(({offerId}) => offerId));
  if (new Set(candidateOfferIds).size !== candidateOfferIds.length) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest candidate set is invalid.",
    );
  }
  const candidateDigest =
    createCustomerBiteSaverGuestOfferCheckCandidateDigest(candidateOfferIds);
  const availabilityGeneration = guestCheckAvailabilityGeneration({
    session: value.session,
    evaluationAtMs: boundedDocument.evaluationAt.getTime(),
    candidates,
  });
  const consumedBoundaryFingerprint = guestCheckBoundaryFingerprint(
    boundedDocument.progress,
  );
  const expiresAtMillis = guestBatchExpiry({
    document: boundedDocument,
    session: value.session,
    candidates: checkable,
    nowMs: value.nowMs,
  });
  if (expiresAtMillis <= value.nowMs) {
    return assertBoundedGuestCheckDocument(Object.freeze({
      ...boundedDocument,
      state: "retryRequired",
      activeBatch: null,
      retryReason: "checkExpired",
      restartFrom: "originalOperation",
      expiresAt: new Date(value.document.absoluteExpiresAt.getTime()),
    }));
  }
  const token = new CustomerBiteSaverGuestOfferCheckCodec({
    key: value.context.secretKey,
    now: () => value.nowMs,
    nonceSource: value.context.randomSource,
  }).encode({
    operationPurpose: boundedDocument.operation,
    operationRef: boundedDocument.operationRef,
    sessionId: boundedDocument.sessionId,
    attemptGeneration: boundedDocument.attemptGeneration,
    criteriaFingerprint: boundedDocument.criteriaFingerprint,
    queryFingerprint: boundedDocument.queryFingerprint,
    callerCapabilityBinding: boundedDocument.callerCapabilityBinding,
    operationFingerprint: boundedDocument.operationFingerprint,
    restaurantPublicId: boundedDocument.originalRequest.kind === "restaurantPage"
      ? null
      : boundedDocument.originalRequest.restaurantId,
    consumedBoundaryFingerprint,
    batchSequence: boundedDocument.batchSequence,
    candidateOfferIds,
    availabilityGeneration,
    guestStateRevision: boundedDocument.guestStateRevision,
    evaluationAtMillis: boundedDocument.evaluationAt.getTime(),
    timeZone: boundedDocument.timeZone,
    utcOffsetMinutes: boundedDocument.utcOffsetMinutes,
    expiresAtMillis,
  });
  return assertBoundedGuestCheckDocument(Object.freeze({
    ...boundedDocument,
    state: "awaitingAnswer",
    activeBatch: Object.freeze({
      kind: value.kind,
      sequence: boundedDocument.batchSequence,
      token,
      candidateDigest,
      availabilityGeneration,
      consumedBoundaryFingerprint,
      candidates,
      nextOfferBoundary: value.nextOfferBoundary,
      sourceExhausted: value.sourceExhausted,
      issuedAtMillis: value.nowMs,
      expiresAtMillis,
    }),
    acceptedAnswer: null,
    retryReason: null,
    restartFrom: null,
    expiresAt: new Date(boundedDocument.absoluteExpiresAt.getTime()),
  }));
}

async function persistGuestCheckDocument(
  context: CustomerBiteSaverSessionContext,
  document: CustomerBiteSaverGuestCheckDocument,
): Promise<void> {
  const bounded = sealGuestCheckDocument(context, document);
  await context.database.commitWrites([Object.freeze({
    type: "set" as const,
    path: guestCheckPath(document.operationRef),
    data: bounded,
  })]);
}

async function currentParentForGuestProgress(value: {
  context: CustomerBiteSaverSessionContext;
  session: CustomerBiteSaverSessionDocument;
  resultId: string;
  evaluationAt: Date;
  expectedRestaurantId?: string;
  expectedAccountId?: string;
  expectedCatalogFingerprint?: string;
  expectedProjectionFingerprint?: string;
  expectedSortTuple?: RestaurantResultSortTuple;
}): Promise<Readonly<{
  result: CustomerBiteSaverResultDocument;
  parent: CurrentParent;
}>> {
  const resultDocument = await value.context.database.getDocument(path(
    privateCustomerBiteSaverResultCollection,
    value.resultId,
  ));
  const result = parseResultDocument(
    resultDocument,
    value.session,
    value.context.secretKey,
  );
  if (
    result === null ||
    (value.expectedRestaurantId !== undefined &&
      result.publicRestaurantId !== value.expectedRestaurantId) ||
    (value.expectedAccountId !== undefined &&
      result.authoritativeAccountId !== value.expectedAccountId) ||
    (value.expectedSortTuple !== undefined &&
      !sameSortTuple(value.expectedSortTuple, Object.freeze([
        result.exactPreferenceRank,
        result.distanceSortMiles,
        result.lowercaseDisplayNameOrderKey,
        accountIdOrderKeyCursorValue(
          result.authoritativeAccountIdOrderKey,
        ),
      ])))
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest operation source changed.",
    );
  }
  const parent = currentParentFromRaw({
    result,
    rawDocument: await value.context.database.getDocument(
      `restaurant_accounts/${result.authoritativeAccountId}`,
    ),
    session: value.session,
    secretKey: value.context.secretKey,
    now: value.evaluationAt,
  });
  if (
    parent === null ||
    (value.expectedCatalogFingerprint !== undefined &&
      parent.offerCatalogFingerprint !== value.expectedCatalogFingerprint) ||
    (value.expectedProjectionFingerprint !== undefined &&
      parent.projection.sourceFingerprint !==
        value.expectedProjectionFingerprint)
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest operation source changed.",
    );
  }
  return Object.freeze({result, parent});
}

async function evaluateGuestStoredOffers(value: {
  offers: readonly CustomerBiteSaverGuestStoredOffer[];
  parent: CurrentParent;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  evaluationAt: Date;
  freshCoordinates?: Readonly<{
    latitude: number;
    longitude: number;
    capturedAt: Date;
  }> | null;
}): Promise<readonly CurrentOffer[]> {
  const evaluated = await evaluateOfferSeedsAtCoherentSnapshot({
    seeds: value.offers.map((offer) => Object.freeze({
      parent: value.parent,
      candidate: candidateFromGuestStoredOffer(offer),
    })),
    session: value.session,
    context: value.context,
    now: value.evaluationAt,
    guestUnavailableOfferIds: new Set<string>(),
    ...(value.freshCoordinates === undefined
      ? {}
      : {freshCoordinates: value.freshCoordinates}),
  });
  return Object.freeze(value.offers.map((stored) =>
    corroborateGuestStoredOffer({
      stored,
      parent: value.parent,
      currentOffers: evaluated.offers,
    })));
}

function corroborateGuestStoredOffer(value: {
  stored: CustomerBiteSaverGuestStoredOffer;
  parent: CurrentParent;
  currentOffers: ReadonlyMap<string, CurrentOffer>;
}): CurrentOffer {
  const current = value.currentOffers.get(offerIdentityKey({
    authoritativeAccountId: value.parent.result.authoritativeAccountId,
    offerType: value.stored.offerType,
    sourceDocumentId: value.stored.sourceDocumentId,
  }));
  if (
    current === undefined ||
    current.publicOfferId !== value.stored.offerId ||
    guestUsagePolicy(current) !== value.stored.usagePolicy ||
    current.decision.eligibilityExpiresAtMs !==
      value.stored.eligibilityExpiresAtMs
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest operation source changed.",
    );
  }
  return current;
}

function guestCompleteResponse<Result>(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  availabilityGeneration: string;
  result: Result;
}): CustomerBiteSaverGuestCompleteResponse<Result> {
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    outcome: "complete",
    operation: value.document.operation,
    guestStateRevision: value.document.guestStateRevision,
    attemptGeneration: value.document.attemptGeneration,
    queryFingerprint: value.document.queryFingerprint,
    evaluationContext: Object.freeze({
      evaluationAtMillis: value.document.evaluationAt.getTime(),
      timeZone: value.document.timeZone,
      utcOffsetMinutes: value.document.utcOffsetMinutes,
      availabilityGeneration: value.availabilityGeneration,
    }),
    result: value.result,
  });
}

function guestOperationDocumentIdentity(value: {
  operation: CustomerBiteSaverGuestOperation;
  originalClientRequestId: string;
  originalRequest: CustomerBiteSaverGuestOriginalRequest;
  guestStateRevision: number;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Readonly<{operationFingerprint: string; operationRef: string}> {
  const callerCapabilityBinding = callerCapabilityBindingFor(
    value.context,
    value.session,
  );
  const operationFingerprint = guestCheckOperationFingerprint(
    value.originalRequest,
    value.guestStateRevision,
  );
  return Object.freeze({
    operationFingerprint,
    operationRef: createCustomerBiteSaverGuestOfferCheckOperationRef(
      value.context.secretKey,
      {
        operationPurpose: value.operation,
        sessionId: value.session.sessionId,
        attemptGeneration: value.session.attemptGeneration,
        criteriaFingerprint: value.session.criteriaFingerprint,
        queryFingerprint: value.session.queryFingerprint,
        callerCapabilityBinding,
        operationFingerprint,
        restaurantPublicId: value.originalRequest.kind === "restaurantPage"
          ? null
          : value.originalRequest.restaurantId,
      },
    ),
  });
}

function guestDocumentForOperation(value: {
  operation: CustomerBiteSaverGuestOperation;
  originalClientRequestId: string;
  originalRequest: CustomerBiteSaverGuestOriginalRequest;
  progress: CustomerBiteSaverGuestProgress;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  evaluationAtMs: number;
  guestStateRevision: number;
  externalExpiresAtMs?: number;
}): CustomerBiteSaverGuestCheckDocument {
  const callerCapabilityBinding = callerCapabilityBindingFor(
    value.context,
    value.session,
  );
  const {operationFingerprint, operationRef} = guestOperationDocumentIdentity(
    value,
  );
  const logicalExpiresAtMs = value.operation === "redemptionStart"
    ? guestOperationLogicalExpiry({
        nowMs: value.evaluationAtMs,
        session: value.session,
        ...(value.externalExpiresAtMs === undefined
          ? {}
          : {externalExpiresAtMs: value.externalExpiresAtMs}),
      })
    : value.session.absoluteExpiresAt.getTime();
  const evaluationAt = new Date(value.evaluationAtMs);
  const logicalExpiresAt = new Date(logicalExpiresAtMs);
  return sealGuestCheckDocument(value.context, Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: "guestOfferCheck",
    state: "retryRequired",
    operation: value.operation,
    operationRef,
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    criteriaFingerprint: value.session.criteriaFingerprint,
    queryFingerprint: value.session.queryFingerprint,
    callerCapabilityBinding,
    operationFingerprint,
    stateBinding: "",
    originalClientRequestId: value.originalClientRequestId,
    originalRequest: value.originalRequest,
    guestStateRevision: value.guestStateRevision,
    evaluationAt,
    timeZone: value.session.criteria.timeZone,
    utcOffsetMinutes: value.session.criteria.utcOffsetMinutes,
    batchSequence: 0,
    activeBatch: null,
    acceptedAnswer: null,
    lastAcceptedAnswer: null,
    progress: value.progress,
    retryReason: "workBudget",
    restartFrom: "originalOperation",
    createdAt: evaluationAt,
    logicalExpiresAt,
    absoluteExpiresAt: new Date(value.session.absoluteExpiresAt.getTime()),
    expiresAt: new Date(value.session.absoluteExpiresAt.getTime()),
  }));
}

function assertGuestDocumentOperation(
  document: CustomerBiteSaverGuestCheckDocument,
  value: {
    operation: CustomerBiteSaverGuestOperation;
    originalClientRequestId: string;
    originalRequest: CustomerBiteSaverGuestOriginalRequest;
    session: CustomerBiteSaverSessionDocument;
    context: CustomerBiteSaverSessionContext;
    guestStateRevision: number;
  },
): void {
  const operationFingerprint = guestCheckOperationFingerprint(
    value.originalRequest,
    value.guestStateRevision,
  );
  const expectedRef = createCustomerBiteSaverGuestOfferCheckOperationRef(
    value.context.secretKey,
    {
      operationPurpose: value.operation,
      sessionId: value.session.sessionId,
      attemptGeneration: value.session.attemptGeneration,
      criteriaFingerprint: value.session.criteriaFingerprint,
      queryFingerprint: value.session.queryFingerprint,
      callerCapabilityBinding: callerCapabilityBindingFor(
        value.context,
        value.session,
      ),
      operationFingerprint,
      restaurantPublicId: value.originalRequest.kind === "restaurantPage"
        ? null
        : value.originalRequest.restaurantId,
    },
  );
  if (
    document.operation !== value.operation ||
    document.operationRef !== expectedRef ||
    document.operationFingerprint !== operationFingerprint ||
    document.guestStateRevision !== value.guestStateRevision
  ) {
    throw new CustomerBiteSaverContractError(
      "invalid-argument",
      "The BiteSaver guest operation binding is invalid.",
    );
  }
}

function guestWorkBudgetDocument(
  document: CustomerBiteSaverGuestCheckDocument,
  progress: CustomerBiteSaverGuestProgress,
): CustomerBiteSaverGuestCheckDocument {
  return assertBoundedGuestCheckDocument(Object.freeze({
    ...document,
    state: "retryRequired",
    activeBatch: null,
    acceptedAnswer: null,
    progress,
    retryReason: "workBudget",
    restartFrom: "originalOperation",
  }));
}

function guestCompletedDocument(
  document: CustomerBiteSaverGuestCheckDocument,
  progress: CustomerBiteSaverGuestProgress,
): CustomerBiteSaverGuestCheckDocument {
  return assertBoundedGuestCheckDocument(Object.freeze({
    ...document,
    state: "completed",
    activeBatch: null,
    acceptedAnswer: null,
    progress,
    retryReason: null,
    restartFrom: null,
  }));
}

function guestRetryDocument(
  document: CustomerBiteSaverGuestCheckDocument,
  reason: CustomerBiteSaverGuestRetryRequiredResponse["reason"],
  restartFrom: CustomerBiteSaverGuestRetryRequiredResponse["restartFrom"],
): CustomerBiteSaverGuestCheckDocument {
  const accepted = document.state === "answerAccepted"
    ? document.acceptedAnswer
    : null;
  return assertBoundedGuestCheckDocument(Object.freeze({
    ...document,
    state: "retryRequired",
    activeBatch: null,
    acceptedAnswer: null,
    lastAcceptedAnswer: accepted === null
      ? document.lastAcceptedAnswer
      : Object.freeze({
          batchSequence: accepted.batchSequence,
          clientRequestId: accepted.clientRequestId,
          requestFingerprint: accepted.requestFingerprint,
        }),
    batchSequence: accepted === null
      ? document.batchSequence
      : document.batchSequence + 1,
    retryReason: reason,
    restartFrom,
  }));
}

function currentOfferForCandidate(
  offers: ReadonlyMap<string, CurrentOffer>,
  parent: CurrentParent,
  candidate: ParsedPreviewCandidate | null,
): CurrentOffer | null {
  if (candidate === null) {
    return null;
  }
  return offers.get(offerIdentityKey({
    authoritativeAccountId: parent.result.authoritativeAccountId,
    offerType: candidate.offerType,
    sourceDocumentId: candidate.sourceDocumentId,
  })) ?? null;
}

async function evaluateGuestOfferDocuments(value: {
  documents: readonly CustomerBiteSaverStoredDocument[];
  parent: CurrentParent;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  evaluationAt: Date;
}): Promise<Readonly<{
  candidates: readonly (ParsedPreviewCandidate | null)[];
  offers: ReadonlyMap<string, CurrentOffer>;
}>> {
  const candidates = value.documents.map((document) =>
    offerCandidateFromProjection(
      document,
      value.parent.result.authoritativeAccountId,
    ));
  const evaluated = await evaluateOfferSeedsAtCoherentSnapshot({
    seeds: candidates.flatMap((candidate) => candidate === null
      ? []
      : [Object.freeze({parent: value.parent, candidate})]),
    session: value.session,
    context: value.context,
    now: value.evaluationAt,
    guestUnavailableOfferIds: new Set<string>(),
  });
  return Object.freeze({
    candidates: Object.freeze(candidates),
    offers: evaluated.offers,
  });
}

function guestAvailabilityGenerationForCurrentOffers(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  offers: readonly CurrentOffer[];
}): string {
  return createQueryFingerprint({
    purpose: "guestOperationCompletedAvailability",
    operationRef: value.document.operationRef,
    guestStateRevision: value.document.guestStateRevision,
    evaluationAtMillis: value.document.evaluationAt.getTime(),
    timeZone: value.document.timeZone,
    utcOffsetMinutes: value.document.utcOffsetMinutes,
    offers: value.offers.map((offer) => ({
      offerId: offer.publicOfferId,
      sourceFingerprint: offer.projection.catalogGenerationContribution,
      usagePolicy: guestUsagePolicy(offer),
      usageGeneration: offer.usageGeneration,
      decision: {
        ...offer.decision,
        proximityDistanceMiles: offer.decision.proximityDistanceMiles === null
          ? null
          : String(offer.decision.proximityDistanceMiles),
      },
    })),
  });
}

async function applyGuestAcceptedAnswer(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<CustomerBiteSaverGuestCheckDocument> {
  const {document} = value;
  const answer = document.acceptedAnswer;
  const batch = document.activeBatch;
  if (document.state !== "answerAccepted" || answer === null || batch === null) {
    return document;
  }
  if (
    answer.batchSequence !== batch.sequence ||
    batch.sequence !== document.batchSequence
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest answer is out of order.",
    );
  }
  const unavailable = new Set(answer.unavailableOfferIds);
  let progress = document.progress;
  if (progress.kind === "offerPage") {
    const {parent} = await currentParentForGuestProgress({
      context: value.context,
      session: value.session,
      resultId: progress.resultId,
      evaluationAt: document.evaluationAt,
      expectedRestaurantId: progress.restaurantId,
      expectedAccountId: progress.authoritativeAccountId,
      expectedCatalogFingerprint: progress.parentCatalogFingerprint,
      expectedProjectionFingerprint: progress.parentProjectionFingerprint,
    });
    const current = await evaluateGuestStoredOffers({
      offers: batch.candidates,
      parent,
      session: value.session,
      context: value.context,
      evaluationAt: document.evaluationAt,
    });
    const accepted = current.filter((offer) =>
      offer.decision.visible && !unavailable.has(offer.publicOfferId));
    progress = Object.freeze({
      ...progress,
      scanBoundary: batch.nextOfferBoundary,
      readyOffers: Object.freeze(orderedGuestStoredOffers([
        ...progress.readyOffers,
        ...accepted.map(guestStoredOffer),
      ]).slice(0, customerBiteSaverGuestReadyOfferLimit)),
      sourceExhausted: batch.sourceExhausted,
    });
  } else if (progress.kind === "restaurantPage") {
    const currentRestaurant = progress.currentRestaurant;
    if (currentRestaurant === null) {
      throw new CustomerBiteSaverContractError("failed-precondition");
    }
    const {parent} = await currentParentForGuestProgress({
      context: value.context,
      session: value.session,
      resultId: currentRestaurant.resultId,
      evaluationAt: document.evaluationAt,
      expectedRestaurantId: currentRestaurant.restaurantId,
      expectedAccountId: currentRestaurant.authoritativeAccountId,
      expectedCatalogFingerprint: currentRestaurant.parentCatalogFingerprint,
      expectedProjectionFingerprint:
        currentRestaurant.parentProjectionFingerprint,
      expectedSortTuple: currentRestaurant.sortTuple,
    });
    const current = await evaluateGuestStoredOffers({
      offers: batch.candidates,
      parent,
      session: value.session,
      context: value.context,
      evaluationAt: document.evaluationAt,
    });
    const accepted = current.filter((offer) =>
      offer.decision.visible && !unavailable.has(offer.publicOfferId));
    const retained = retainGuestPreviewOffers([
      ...currentRestaurant.retainedOffers,
      ...accepted.map(guestStoredOffer),
    ]);
    progress = Object.freeze({
      ...progress,
      currentRestaurant: Object.freeze({
        ...currentRestaurant,
        liveBoundary: batch.nextOfferBoundary,
        retainedOffers: retained,
        visibleOfferCount:
          currentRestaurant.visibleOfferCount + accepted.length,
        countKnown: batch.sourceExhausted,
      }),
    });
  } else {
    const {parent} = await currentParentForGuestProgress({
      context: value.context,
      session: value.session,
      resultId: progress.resultId,
      evaluationAt: new Date(contextNow(value.context)),
      expectedRestaurantId: progress.restaurantId,
      expectedAccountId: progress.authoritativeAccountId,
      expectedCatalogFingerprint: progress.parentCatalogFingerprint,
      expectedProjectionFingerprint: progress.parentProjectionFingerprint,
    });
    const freshCoordinates = document.originalRequest.kind === "redemptionStart"
      && document.originalRequest.currentCoordinates !== null
      ? Object.freeze({
          latitude: document.originalRequest.currentCoordinates.latitude,
          longitude: document.originalRequest.currentCoordinates.longitude,
          capturedAt: new Date(
            document.originalRequest.currentCoordinates.capturedAtMillis,
          ),
        })
      : null;
    const current = await evaluateGuestStoredOffers({
      offers: batch.candidates,
      parent,
      session: value.session,
      context: value.context,
      evaluationAt: new Date(contextNow(value.context)),
      freshCoordinates,
    });
    if (current.length !== 1 || current[0].publicOfferId !== progress.offerId) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver guest operation source changed.",
      );
    }
    progress = Object.freeze({
      ...progress,
      locallyUnavailable: unavailable.has(progress.offerId),
    });
  }
  return assertBoundedGuestCheckDocument(Object.freeze({
    ...document,
    state: "retryRequired",
    activeBatch: null,
    acceptedAnswer: null,
    lastAcceptedAnswer: Object.freeze({
      batchSequence: answer.batchSequence,
      clientRequestId: answer.clientRequestId,
      requestFingerprint: answer.requestFingerprint,
    }),
    batchSequence: document.batchSequence + 1,
    progress,
    retryReason: "workBudget",
    restartFrom: "originalOperation",
  }));
}

function contextNow(context: CustomerBiteSaverSessionContext): number {
  const nowMs = context.now?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  return nowMs;
}

function guestPageCheckpointInvalidation(
  document: CustomerBiteSaverGuestCheckDocument,
  reason: "sourceChanged" | "sessionChanged",
): CustomerBiteSaverGuestCheckDocument {
  return guestRetryDocument(
    document,
    reason,
    document.operation === "restaurantPage" ? "search" : "originalOperation",
  );
}

async function currentOffersForExpiredGuestBatch(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  evaluationAt: Date;
}): Promise<readonly CurrentOffer[]> {
  const batch = value.document.activeBatch;
  const progress = value.document.progress;
  if (batch === null || progress.kind === "redemptionStart") {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  if (progress.kind === "offerPage") {
    const {parent} = await currentParentForGuestProgress({
      context: value.context,
      session: value.session,
      resultId: progress.resultId,
      evaluationAt: value.evaluationAt,
      expectedRestaurantId: progress.restaurantId,
      expectedAccountId: progress.authoritativeAccountId,
      expectedCatalogFingerprint: progress.parentCatalogFingerprint,
      expectedProjectionFingerprint: progress.parentProjectionFingerprint,
    });
    return evaluateGuestStoredOffers({
      offers: batch.candidates,
      parent,
      session: value.session,
      context: value.context,
      evaluationAt: value.evaluationAt,
    });
  }
  const currentRestaurant = progress.currentRestaurant;
  if (currentRestaurant === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest operation source changed.",
    );
  }
  const {parent} = await currentParentForGuestProgress({
    context: value.context,
    session: value.session,
    resultId: currentRestaurant.resultId,
    evaluationAt: value.evaluationAt,
    expectedRestaurantId: currentRestaurant.restaurantId,
    expectedAccountId: currentRestaurant.authoritativeAccountId,
    expectedCatalogFingerprint: currentRestaurant.parentCatalogFingerprint,
    expectedProjectionFingerprint:
      currentRestaurant.parentProjectionFingerprint,
    expectedSortTuple: currentRestaurant.sortTuple,
  });
  return evaluateGuestStoredOffers({
    offers: batch.candidates,
    parent,
    session: value.session,
    context: value.context,
    evaluationAt: value.evaluationAt,
  });
}

async function refreshGuestPageCheckpointForRequest(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  nowMs: number;
}): Promise<CustomerBiteSaverGuestCheckDocument> {
  if (value.document.operation === "redemptionStart") {
    return value.document;
  }
  if (
    value.nowMs >= value.session.logicalExpiresAt.getTime() ||
    value.nowMs >= value.session.absoluteExpiresAt.getTime()
  ) {
    return guestPageCheckpointInvalidation(value.document, "sessionChanged");
  }
  if (value.nowMs >= value.document.logicalExpiresAt.getTime()) {
    return guestPageCheckpointInvalidation(value.document, "sourceChanged");
  }
  if (
    value.document.state === "awaitingAnswer" &&
    value.document.activeBatch !== null &&
    value.nowMs < value.document.activeBatch.expiresAtMillis
  ) {
    return value.document;
  }
  if (
    value.document.state === "retryRequired" &&
    value.document.retryReason !== "workBudget" &&
    value.document.retryReason !== "checkExpired"
  ) {
    return value.document;
  }
  const refreshed = assertBoundedGuestCheckDocument(Object.freeze({
    ...value.document,
    ...(value.document.state === "retryRequired" &&
        value.document.retryReason === "checkExpired"
      ? {
          retryReason: "workBudget" as const,
          restartFrom: "originalOperation" as const,
        }
      : {}),
    expiresAt: new Date(value.document.absoluteExpiresAt.getTime()),
  }));
  try {
    if (refreshed.state !== "awaitingAnswer") {
      return refreshed;
    }
    const priorBatch = refreshed.activeBatch;
    if (priorBatch === null) {
      throw new CustomerBiteSaverContractError("failed-precondition");
    }
    const currentOffers = await currentOffersForExpiredGuestBatch({
      document: refreshed,
      session: value.session,
      context: value.context,
      evaluationAt: refreshed.evaluationAt,
    });
    if (currentOffers.some((offer) => !offer.decision.visible)) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver guest operation source changed.",
      );
    }
    const reissuable = assertBoundedGuestCheckDocument(Object.freeze({
      ...refreshed,
      state: "retryRequired" as const,
      activeBatch: null,
      acceptedAnswer: null,
      batchSequence: refreshed.batchSequence + 1,
      retryReason: "workBudget" as const,
      restartFrom: "originalOperation" as const,
    }));
    return createGuestCheckBatch({
      document: reissuable,
      session: value.session,
      context: value.context,
      kind: priorBatch.kind,
      candidates: currentOffers,
      nextOfferBoundary: priorBatch.nextOfferBoundary,
      sourceExhausted: priorBatch.sourceExhausted,
      nowMs: value.nowMs,
    });
  } catch (error) {
    if (!isGuestSourceChange(error)) {
      throw error;
    }
    return guestPageCheckpointInvalidation(value.document, "sourceChanged");
  }
}

async function finalizeGuestOfferPage(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<Readonly<{
  document: CustomerBiteSaverGuestCheckDocument;
  response: CustomerBiteSaverGuestOperationResponse;
}>> {
  const progress = value.document.progress;
  if (progress.kind !== "offerPage") {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const {parent} = await currentParentForGuestProgress({
    context: value.context,
    session: value.session,
    resultId: progress.resultId,
    evaluationAt: value.document.evaluationAt,
    expectedRestaurantId: progress.restaurantId,
    expectedAccountId: progress.authoritativeAccountId,
    expectedCatalogFingerprint: progress.parentCatalogFingerprint,
    expectedProjectionFingerprint: progress.parentProjectionFingerprint,
  });
  const current = await evaluateGuestStoredOffers({
    offers: progress.readyOffers,
    parent,
    session: value.session,
    context: value.context,
    evaluationAt: value.document.evaluationAt,
  });
  if (current.some((offer) => !offer.decision.visible)) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest operation source changed.",
    );
  }
  if (contextNow(value.context) >= value.document.logicalExpiresAt.getTime()) {
    const document = guestRetryDocument(
      value.document,
      "checkExpired",
      "originalOperation",
    );
    return Object.freeze({document, response: guestRetryResponse(document)});
  }
  const byId = new Map(current.map((offer) => [offer.publicOfferId, offer]));
  const ordered = orderedGuestStoredOffers(progress.readyOffers).map((offer) => {
    const resolved = byId.get(offer.offerId);
    if (resolved === undefined) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver guest operation source changed.",
      );
    }
    return resolved;
  });
  if (ordered.length < customerBiteSaverPageSize && !progress.sourceExhausted) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const delivered = ordered.slice(0, customerBiteSaverPageSize);
  const hasMore = ordered.length > customerBiteSaverPageSize;
  const usageGeneration = guestAvailabilityGenerationForCurrentOffers({
    document: value.document,
    offers: ordered,
  });
  const guestFingerprint = guestStateFingerprint(
    value.document.guestStateRevision,
  );
  const deliveryPageGeneration = pageGenerationFingerprint({
    session: value.session,
    purpose: "offerPage",
    availabilityAtMs: value.document.evaluationAt.getTime(),
    callerCapabilityBinding: value.document.callerCapabilityBinding,
    guestStateFingerprint: guestFingerprint,
    usageGeneration,
    offerCatalogFingerprint: parent.offerCatalogFingerprint,
    restaurantPublicId: progress.restaurantId,
    matchingMode: progress.matchingMode,
  });
  const publicOffers = delivered.map((offer) => publicOfferDto(
    offer,
    offerOccurrenceForDelivery({
      offer,
      session: value.session,
      context: value.context,
      pagePurpose: "offerPage",
      pageGenerationFingerprint: deliveryPageGeneration,
      availabilityAtMs: value.document.evaluationAt.getTime(),
      guestStateFingerprint: guestFingerprint,
      usageGeneration,
      offerCatalogFingerprint: parent.offerCatalogFingerprint,
      matchingMode: progress.matchingMode,
    }),
  ));
  const cursorBoundary = delivered.length === customerBiteSaverPageSize
    ? guestStoredOfferSortTuple(
        guestStoredOffer(delivered[customerBiteSaverPageSize - 1]),
      )
    : null;
  const nextCursor = hasMore && cursorBoundary !== null
    ? encodePageCursor({
        purpose: "offerPage",
        session: value.session,
        context: value.context,
        availabilityAtMs: value.document.evaluationAt.getTime(),
        guestStateFingerprint: guestFingerprint,
        usageGeneration,
        offerCatalogFingerprint: parent.offerCatalogFingerprint,
        sortTuple: cursorBoundary,
        restaurantPublicId: progress.restaurantId,
        matchingMode: progress.matchingMode,
      })
    : null;
  const result: CustomerBiteSaverOfferPageResult = Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    restaurantId: progress.restaurantId,
    offers: Object.freeze(publicOffers),
    nextCursor,
    hasMore,
    partial: false,
  });
  const writes = deliveredOfferIdentityWrites({
    context: value.context,
    session: value.session,
    offers: delivered,
    pageGenerationFingerprint: deliveryPageGeneration,
    availabilityAtMs: value.document.evaluationAt.getTime(),
  });
  if (writes.length > 0) {
    await value.context.database.commitWrites(writes);
  }
  const document = guestCompletedDocument(value.document, progress);
  return Object.freeze({
    document,
    response: guestCompleteResponse({
      document,
      availabilityGeneration: usageGeneration,
      result,
    }) as CustomerBiteSaverGuestOperationResponse,
  });
}

async function processGuestOfferPage(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<Readonly<{
  document: CustomerBiteSaverGuestCheckDocument;
  response: CustomerBiteSaverGuestOperationResponse;
}>> {
  let document = await applyGuestAcceptedAnswer(value);
  let progress = document.progress;
  if (progress.kind !== "offerPage") {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  if (document.state === "awaitingAnswer") {
    return Object.freeze({document, response: guestCheckResponse(document)});
  }
  if (
    progress.readyOffers.length >= customerBiteSaverGuestReadyOfferLimit ||
    progress.sourceExhausted
  ) {
    return finalizeGuestOfferPage({
      document,
      session: value.session,
      context: value.context,
    });
  }
  const {parent} = await currentParentForGuestProgress({
    context: value.context,
    session: value.session,
    resultId: progress.resultId,
    evaluationAt: document.evaluationAt,
    expectedRestaurantId: progress.restaurantId,
    expectedAccountId: progress.authoritativeAccountId,
    expectedCatalogFingerprint: progress.parentCatalogFingerprint,
    expectedProjectionFingerprint: progress.parentProjectionFingerprint,
  });
  let work = 0;
  while (
    progress.readyOffers.length < customerBiteSaverGuestReadyOfferLimit &&
    !progress.sourceExhausted &&
    work < customerBiteSaverPageConsumeLimit
  ) {
    const queryLimit = Math.min(
      customerBiteSaverPageLookahead,
      customerBiteSaverPageConsumeLimit - work,
    );
    const documents = await value.context.database.queryDocuments(
      customerBiteSaverPerParentOfferQuery({
        authoritativeAccountId: progress.authoritativeAccountId,
        ...(progress.scanBoundary === null
          ? {}
          : {startAfter: progress.scanBoundary}),
        limit: queryLimit,
      }),
    );
    if (documents.length === 0) {
      progress = Object.freeze({...progress, sourceExhausted: true});
      document = Object.freeze({...document, progress});
      break;
    }
    const evaluated = await evaluateGuestOfferDocuments({
      documents,
      parent,
      session: value.session,
      context: value.context,
      evaluationAt: document.evaluationAt,
    });
    const ready: CustomerBiteSaverGuestStoredOffer[] = [
      ...progress.readyOffers,
    ];
    const checkable: CurrentOffer[] = [];
    let nextBoundary: readonly [number, string, string] | null =
      progress.scanBoundary;
    let processed = 0;
    for (let index = 0; index < documents.length; index += 1) {
      nextBoundary = offerSortTupleFromStored(documents[index]);
      processed += 1;
      work += 1;
      const offer = currentOfferForCandidate(
        evaluated.offers,
        parent,
        evaluated.candidates[index],
      );
      if (offer !== null && offer.decision.visible) {
        if (guestUsagePolicy(offer) === null) {
          ready.push(guestStoredOffer(offer));
        } else {
          checkable.push(offer);
        }
      }
      if (
        ready.length + checkable.length >=
          customerBiteSaverGuestReadyOfferLimit ||
        checkable.length >= customerBiteSaverGuestCheckMaximumCandidateIds ||
        work >= customerBiteSaverPageConsumeLimit
      ) {
        break;
      }
    }
    const sourceExhausted = processed === documents.length &&
      documents.length < queryLimit;
    progress = Object.freeze({
      ...progress,
      readyOffers: Object.freeze(orderedGuestStoredOffers(ready).slice(
        0,
        customerBiteSaverGuestReadyOfferLimit,
      )),
      sourceExhausted,
    });
    document = Object.freeze({...document, progress});
    document = capGuestDocumentToStoredOfferBoundaries(
      document,
      progress.readyOffers,
    );
    if (checkable.length > 0) {
      document = createGuestCheckBatch({
        document,
        session: value.session,
        context: value.context,
        kind: "offerScan",
        candidates: checkable,
        nextOfferBoundary: nextBoundary,
        sourceExhausted,
        nowMs: contextNow(value.context),
      });
      return Object.freeze({
        document,
        response: document.state === "awaitingAnswer"
          ? guestCheckResponse(document)
          : guestRetryResponse(document),
      });
    }
    progress = Object.freeze({...progress, scanBoundary: nextBoundary});
    document = Object.freeze({...document, progress});
  }
  if (
    progress.readyOffers.length >= customerBiteSaverGuestReadyOfferLimit ||
    progress.sourceExhausted
  ) {
    return finalizeGuestOfferPage({
      document,
      session: value.session,
      context: value.context,
    });
  }
  document = guestWorkBudgetDocument(document, progress);
  return Object.freeze({document, response: guestRetryResponse(document)});
}

function guestRestaurantFromProgress(value: {
  current: NonNullable<CustomerBiteSaverGuestRestaurantProgress[
    "currentRestaurant"
  ]>;
}): CustomerBiteSaverGuestStoredRestaurant | null {
  if (value.current.visibleOfferCount === 0) {
    return null;
  }
  const retained = orderedGuestStoredOffers(value.current.retainedOffers);
  const selected = selectGuestPreviewOffers(retained);
  if (selected.length === 0) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const selectedIds = new Set(selected.map(guestStoredOfferIdentity));
  const remaining = retained.filter((offer) =>
    !selectedIds.has(guestStoredOfferIdentity(offer)));
  const countKnown = value.current.countKnown &&
    value.current.visibleOfferCount <= 3 &&
    value.current.visibleOfferCount === retained.length;
  return Object.freeze({
    resultId: value.current.resultId,
    restaurantId: value.current.restaurantId,
    sortTuple: value.current.sortTuple,
    authoritativeAccountId: value.current.authoritativeAccountId,
    parentCatalogFingerprint: value.current.parentCatalogFingerprint,
    parentProjectionFingerprint: value.current.parentProjectionFingerprint,
    selectedOffers: selected,
    metadataWitnesses: Object.freeze(
      remaining.slice(0, 1),
    ),
    hasMoreOffers: countKnown
      ? value.current.visibleOfferCount > selected.length
      : true,
    usableOfferCount: countKnown ? value.current.visibleOfferCount : null,
    offerCountState: countKnown ? "current" : "unknown",
  });
}

function guestRestaurantEligibilityResolved(
  current: NonNullable<CustomerBiteSaverGuestRestaurantProgress[
    "currentRestaurant"
  ]>,
): boolean {
  return current.countKnown ||
    (current.visibleOfferCount >= 3 &&
      current.retainedOffers.some((offer) => offer.offerType === "coupon"));
}

async function resolveGuestCurrentRestaurant(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  workRemaining: number;
}): Promise<Readonly<{
  document: CustomerBiteSaverGuestCheckDocument;
  workUsed: number;
  paused: boolean;
}>> {
  let document = value.document;
  let progress = document.progress;
  if (progress.kind !== "restaurantPage" || progress.currentRestaurant === null) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  let currentRestaurant = progress.currentRestaurant;
  const {parent} = await currentParentForGuestProgress({
    context: value.context,
    session: value.session,
    resultId: currentRestaurant.resultId,
    evaluationAt: document.evaluationAt,
    expectedRestaurantId: currentRestaurant.restaurantId,
    expectedAccountId: currentRestaurant.authoritativeAccountId,
    expectedCatalogFingerprint: currentRestaurant.parentCatalogFingerprint,
    expectedProjectionFingerprint: currentRestaurant.parentProjectionFingerprint,
    expectedSortTuple: currentRestaurant.sortTuple,
  });
  let workUsed = 0;
  while (
    !guestRestaurantEligibilityResolved(currentRestaurant) &&
    workUsed < value.workRemaining
  ) {
    const queryLimit = Math.min(
      customerBiteSaverPageLookahead,
      value.workRemaining - workUsed,
    );
    const documents = await value.context.database.queryDocuments(
      customerBiteSaverPerParentOfferQuery({
        authoritativeAccountId: currentRestaurant.authoritativeAccountId,
        ...(currentRestaurant.liveBoundary === null
          ? {}
          : {startAfter: currentRestaurant.liveBoundary}),
        limit: queryLimit,
      }),
    );
    if (documents.length === 0) {
      currentRestaurant = Object.freeze({
        ...currentRestaurant,
        countKnown: true,
      });
      break;
    }
    const evaluated = await evaluateGuestOfferDocuments({
      documents,
      parent,
      session: value.session,
      context: value.context,
      evaluationAt: document.evaluationAt,
    });
    const retained = [...currentRestaurant.retainedOffers];
    const checkable: CurrentOffer[] = [];
    let acceptedWithoutCheck = 0;
    let nextBoundary = currentRestaurant.liveBoundary;
    let processed = 0;
    for (let index = 0; index < documents.length; index += 1) {
      nextBoundary = offerSortTupleFromStored(documents[index]);
      processed += 1;
      workUsed += 1;
      const offer = currentOfferForCandidate(
        evaluated.offers,
        parent,
        evaluated.candidates[index],
      );
      if (offer !== null && offer.decision.visible) {
        if (guestUsagePolicy(offer) === null) {
          retained.push(guestStoredOffer(offer));
          acceptedWithoutCheck += 1;
        } else {
          checkable.push(offer);
        }
      }
      if (
        (currentRestaurant.visibleOfferCount + acceptedWithoutCheck +
            checkable.length >= 3 &&
          (retained.some((candidate) => candidate.offerType === "coupon") ||
            checkable.some((candidate) => candidate.offerType === "coupon"))) ||
        checkable.length >= customerBiteSaverGuestCheckMaximumCandidateIds ||
        workUsed >= value.workRemaining
      ) {
        break;
      }
    }
    const sourceExhausted = processed === documents.length &&
      documents.length < queryLimit;
    currentRestaurant = Object.freeze({
      ...currentRestaurant,
      retainedOffers: retainGuestPreviewOffers(retained),
      visibleOfferCount:
        currentRestaurant.visibleOfferCount + acceptedWithoutCheck,
      countKnown: sourceExhausted,
    });
    progress = Object.freeze({...progress, currentRestaurant});
    document = Object.freeze({...document, progress});
    document = capGuestDocumentToStoredOfferBoundaries(
      document,
      currentRestaurant.retainedOffers,
    );
    if (checkable.length > 0) {
      document = createGuestCheckBatch({
        document,
        session: value.session,
        context: value.context,
        kind: "restaurantLive",
        candidates: checkable,
        nextOfferBoundary: nextBoundary,
        sourceExhausted,
        nowMs: contextNow(value.context),
      });
      return Object.freeze({document, workUsed, paused: true});
    }
    currentRestaurant = Object.freeze({
      ...currentRestaurant,
      liveBoundary: nextBoundary,
    });
    progress = Object.freeze({...progress, currentRestaurant});
    document = Object.freeze({...document, progress});
  }
  if (guestRestaurantEligibilityResolved(currentRestaurant)) {
    const stored = guestRestaurantFromProgress({current: currentRestaurant});
    const readyRestaurants = stored === null
      ? progress.readyRestaurants
      : Object.freeze([...progress.readyRestaurants, stored]);
    progress = Object.freeze({
      ...progress,
      outerBoundary: currentRestaurant.sortTuple,
      readyRestaurants,
      currentRestaurant: null,
    });
    document = Object.freeze({...document, progress});
  }
  return Object.freeze({document, workUsed, paused: false});
}

async function finalizeGuestRestaurantPage(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<Readonly<{
  document: CustomerBiteSaverGuestCheckDocument;
  response: CustomerBiteSaverGuestOperationResponse;
}>> {
  const progress = value.document.progress;
  if (progress.kind !== "restaurantPage") {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  if (
    progress.readyRestaurants.length < customerBiteSaverPageSize &&
    !progress.resultSourceExhausted
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const checkedStored = progress.readyRestaurants.slice(
    0,
    customerBiteSaverPageSize + 1,
  );
  const prepared: Array<Readonly<{
    stored: CustomerBiteSaverGuestStoredRestaurant;
    parent: CurrentParent;
  }>> = [];
  for (const stored of checkedStored) {
    const {parent} = await currentParentForGuestProgress({
      context: value.context,
      session: value.session,
      resultId: stored.resultId,
      evaluationAt: value.document.evaluationAt,
      expectedRestaurantId: stored.restaurantId,
      expectedAccountId: stored.authoritativeAccountId,
      expectedCatalogFingerprint: stored.parentCatalogFingerprint,
      expectedProjectionFingerprint: stored.parentProjectionFingerprint,
      expectedSortTuple: stored.sortTuple,
    });
    prepared.push(Object.freeze({stored, parent}));
  }
  const flattened = prepared.flatMap(({stored, parent}) => [
    ...stored.selectedOffers.map((offer) => Object.freeze({stored: offer, parent})),
    ...stored.metadataWitnesses.map((offer) =>
      Object.freeze({stored: offer, parent})),
  ]);
  if (flattened.length > customerBiteSaverPageConsumeLimit) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const evaluated = await evaluateOfferSeedsAtCoherentSnapshot({
    seeds: flattened.map(({stored, parent}) => Object.freeze({
      parent,
      candidate: candidateFromGuestStoredOffer(stored),
    })),
    session: value.session,
    context: value.context,
    now: value.document.evaluationAt,
    guestUnavailableOfferIds: new Set<string>(),
  });
  const delivered = prepared.map(({stored, parent}) => {
    const resolve = (offers: readonly CustomerBiteSaverGuestStoredOffer[]) =>
      Object.freeze(offers.map((offer) => corroborateGuestStoredOffer({
        stored: offer,
        parent,
        currentOffers: evaluated.offers,
      })));
    const selected = resolve(stored.selectedOffers);
    const witnesses = resolve(stored.metadataWitnesses);
    if ([...selected, ...witnesses].some((offer) => !offer.decision.visible)) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver guest operation source changed.",
      );
    }
    return Object.freeze({stored, parent, selected, witnesses});
  });
  const allCurrentOffers = delivered.flatMap(({selected, witnesses}) => [
    ...selected,
    ...witnesses,
  ]);
  if (contextNow(value.context) >= value.document.logicalExpiresAt.getTime()) {
    const document = guestRetryDocument(
      value.document,
      "checkExpired",
      "originalOperation",
    );
    return Object.freeze({document, response: guestRetryResponse(document)});
  }
  const usageGeneration = guestAvailabilityGenerationForCurrentOffers({
    document: value.document,
    offers: allCurrentOffers,
  });
  const guestFingerprint = guestStateFingerprint(
    value.document.guestStateRevision,
  );
  const pageGeneration = pageGenerationFingerprint({
    session: value.session,
    purpose: "restaurantPage",
    availabilityAtMs: value.document.evaluationAt.getTime(),
    callerCapabilityBinding: value.document.callerCapabilityBinding,
    guestStateFingerprint: guestFingerprint,
    usageGeneration,
    offerCatalogFingerprint: null,
    restaurantPublicId: null,
    matchingMode: null,
  });
  const deliveredForResponse = delivered.slice(0, customerBiteSaverPageSize);
  const deliveredStored = checkedStored.slice(0, customerBiteSaverPageSize);
  const restaurants = deliveredForResponse.map(({stored, parent, selected}) =>
    publicRestaurantDto({
      parent,
      hasMoreOffers: stored.hasMoreOffers,
      usableOfferCount: stored.usableOfferCount,
      offerCountState: stored.offerCountState,
      offers: selected.map((offer) => publicOfferDto(
        offer,
        offerOccurrenceForDelivery({
          offer,
          session: value.session,
          context: value.context,
          pagePurpose: "restaurantPage",
          pageGenerationFingerprint: pageGeneration,
          availabilityAtMs: value.document.evaluationAt.getTime(),
          guestStateFingerprint: guestFingerprint,
          usageGeneration,
          offerCatalogFingerprint: null,
          matchingMode: null,
        }),
      )),
    }));
  const hasMore = progress.readyRestaurants.length > customerBiteSaverPageSize;
  const cursorBoundary = deliveredStored.length === customerBiteSaverPageSize
    ? deliveredStored[customerBiteSaverPageSize - 1].sortTuple
    : null;
  const nextCursor = hasMore && cursorBoundary !== null
    ? encodePageCursor({
        purpose: "restaurantPage",
        session: value.session,
        context: value.context,
        availabilityAtMs: value.document.evaluationAt.getTime(),
        guestStateFingerprint: guestFingerprint,
        usageGeneration,
        offerCatalogFingerprint: null,
        sortTuple: cursorBoundary,
        restaurantPublicId: null,
        matchingMode: null,
      })
    : null;
  const result: CustomerBiteSaverRestaurantPageResult = Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    state: "ready",
    attemptGeneration: value.session.attemptGeneration,
    queryFingerprint: value.session.queryFingerprint,
    restaurants: Object.freeze(restaurants),
    nextCursor,
    hasMore,
    partial: false,
  });
  const writes = [
    ...deliveredRestaurantIdentityWrites({
      context: value.context,
      session: value.session,
      parents: deliveredForResponse.map(({parent}) => parent),
      pageGenerationFingerprint: pageGeneration,
      availabilityAtMs: value.document.evaluationAt.getTime(),
    }),
    ...deliveredOfferIdentityWrites({
      context: value.context,
      session: value.session,
      offers: deliveredForResponse.flatMap(({selected}) => [...selected]),
      pageGenerationFingerprint: pageGeneration,
      availabilityAtMs: value.document.evaluationAt.getTime(),
    }),
  ];
  if (writes.length > 0) {
    await value.context.database.commitWrites(writes);
  }
  const document = guestCompletedDocument(value.document, progress);
  return Object.freeze({
    document,
    response: guestCompleteResponse({
      document,
      availabilityGeneration: usageGeneration,
      result,
    }) as CustomerBiteSaverGuestOperationResponse,
  });
}

async function processGuestRestaurantPage(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<Readonly<{
  document: CustomerBiteSaverGuestCheckDocument;
  response: CustomerBiteSaverGuestOperationResponse;
}>> {
  let document = await applyGuestAcceptedAnswer(value);
  if (document.progress.kind !== "restaurantPage") {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  let progress: CustomerBiteSaverGuestRestaurantProgress = document.progress;
  if (document.state === "awaitingAnswer") {
    return Object.freeze({document, response: guestCheckResponse(document)});
  }
  let work = 0;
  while (
    progress.readyRestaurants.length < customerBiteSaverPageSize + 1 &&
    !progress.resultSourceExhausted &&
    work < customerBiteSaverPageConsumeLimit
  ) {
    if (progress.currentRestaurant !== null) {
      const resolved = await resolveGuestCurrentRestaurant({
        document,
        session: value.session,
        context: value.context,
        workRemaining: customerBiteSaverPageConsumeLimit - work,
      });
      document = resolved.document;
      work += resolved.workUsed;
      progress = document.progress as CustomerBiteSaverGuestRestaurantProgress;
      if (resolved.paused) {
        return Object.freeze({
          document,
          response: document.state === "awaitingAnswer"
            ? guestCheckResponse(document)
            : guestRetryResponse(document),
        });
      }
      if (progress.currentRestaurant !== null) {
        break;
      }
      continue;
    }
    const resultDocuments = await value.context.database.queryDocuments(
      customerBiteSaverOrderedResultQuery({
        session: value.session,
        ...(progress.outerBoundary === null
          ? {}
          : {startAfter: progress.outerBoundary}),
        limit: 1,
      }),
    );
    work += 1;
    if (resultDocuments.length === 0) {
      progress = Object.freeze({...progress, resultSourceExhausted: true});
      document = Object.freeze({...document, progress});
      break;
    }
    const resultDocument = resultDocuments[0];
    const sortTuple = resultSortTupleFromStored(resultDocument);
    const result = parseResultDocument(
      resultDocument,
      value.session,
      value.context.secretKey,
    );
    if (result === null) {
      progress = Object.freeze({...progress, outerBoundary: sortTuple});
      document = Object.freeze({...document, progress});
      continue;
    }
    const parent = currentParentFromRaw({
      result,
      rawDocument: await value.context.database.getDocument(
        `restaurant_accounts/${result.authoritativeAccountId}`,
      ),
      session: value.session,
      secretKey: value.context.secretKey,
      now: document.evaluationAt,
    });
    if (parent === null) {
      progress = Object.freeze({...progress, outerBoundary: sortTuple});
      document = Object.freeze({...document, progress});
      continue;
    }
    progress = Object.freeze({
      ...progress,
      currentRestaurant: Object.freeze({
        resultId: result.id,
        restaurantId: result.publicRestaurantId,
        sortTuple,
        authoritativeAccountId: result.authoritativeAccountId,
        parentCatalogFingerprint: parent.offerCatalogFingerprint,
        parentProjectionFingerprint: result.parentProjectionFingerprint,
        liveBoundary: null,
        retainedOffers: Object.freeze([] as
          CustomerBiteSaverGuestStoredOffer[]),
        visibleOfferCount: 0,
        countKnown: false,
      }),
    });
    document = Object.freeze({...document, progress});
  }
  progress = document.progress as CustomerBiteSaverGuestRestaurantProgress;
  if (
    progress.readyRestaurants.length >= customerBiteSaverPageSize + 1 ||
    progress.resultSourceExhausted
  ) {
    return finalizeGuestRestaurantPage({
      document,
      session: value.session,
      context: value.context,
    });
  }
  document = guestWorkBudgetDocument(document, progress);
  return Object.freeze({document, response: guestRetryResponse(document)});
}

type GuestRedemptionResolution =
  | Readonly<{
      kind: "unavailable";
      result: CustomerBiteSaverRedemptionValidationResult;
    }>
  | Readonly<{
      kind: "available";
      result: CustomerBiteSaverResultDocument;
      parent: CurrentParent;
      offer: CurrentOffer;
      occurrence: CustomerBiteSaverOfferOccurrencePayload;
    }>;

async function resolveGuestRedemptionTarget(value: {
  request: CustomerBiteSaverRedemptionRequest;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  nowMs: number;
  callerCapabilityBinding?: string;
}): Promise<GuestRedemptionResolution> {
  const codec = new CustomerBiteSaverOfferOccurrenceCodec({
    key: value.context.secretKey,
    now: () => value.nowMs,
  });
  const opened = codec.open(value.request.offerOccurrence);
  const expectedCallerCapabilityBinding = value.callerCapabilityBinding ??
    requestCallerCapabilityBindingFor(value.context, value.request);
  if (
    opened.sessionId !== value.request.sessionId ||
    opened.restaurantPublicId !== value.request.restaurantId ||
    opened.offerPublicId !== value.request.offerId ||
    opened.guestStateFingerprint !== guestStateFingerprint(
      value.request.guestStateRevision,
    ) ||
    !customerBiteSaverConstantTimeHexEqual(
      opened.callerCapabilityBinding,
      expectedCallerCapabilityBinding,
    )
  ) {
    throw new CustomerBiteSaverContractError(
      "invalid-argument",
      "The BiteSaver offer occurrence is invalid or expired.",
    );
  }
  const expectedPageGeneration = pageGenerationFingerprint({
    session: value.session,
    purpose: opened.pagePurpose,
    availabilityAtMs: opened.availabilityAtMs,
    callerCapabilityBinding: callerCapabilityBindingFor(
      value.context,
      value.session,
    ),
    guestStateFingerprint: opened.guestStateFingerprint,
    usageGeneration: opened.usageGeneration,
    offerCatalogFingerprint: opened.offerCatalogFingerprint,
    restaurantPublicId: opened.pagePurpose === "offerPage"
      ? value.request.restaurantId
      : null,
    matchingMode: opened.pagePurpose === "offerPage"
      ? opened.matchingMode
      : null,
  });
  const occurrence = codec.decode(value.request.offerOccurrence, {
    pagePurpose: opened.pagePurpose,
    sessionId: value.session.sessionId,
    attemptGeneration: value.session.attemptGeneration,
    queryFingerprint: value.session.queryFingerprint,
    pageGenerationFingerprint: expectedPageGeneration,
    callerCapabilityBinding: callerCapabilityBindingFor(
      value.context,
      value.session,
    ),
    restaurantPublicId: value.request.restaurantId,
    offerPublicId: value.request.offerId,
    matchingMode: opened.pagePurpose === "offerPage"
      ? opened.matchingMode
      : null,
    availabilityAtMs: opened.availabilityAtMs,
    guestStateFingerprint: opened.guestStateFingerprint,
    usageGeneration: opened.usageGeneration,
    offerCatalogFingerprint: opened.offerCatalogFingerprint,
  });
  const resultId = customerBiteSaverResultDocumentId(
    value.context.secretKey,
    value.session.sessionId,
    value.session.attemptGeneration,
    value.request.restaurantId,
  );
  const result = parseResultDocument(
    await value.context.database.getDocument(path(
      privateCustomerBiteSaverResultCollection,
      resultId,
    )),
    value.session,
    value.context.secretKey,
  );
  if (result === null || result.publicRestaurantId !== value.request.restaurantId) {
    return Object.freeze({
      kind: "unavailable",
      result: unavailableRedemptionResponse({
        request: value.request,
        nowMs: value.nowMs,
        reason: "restaurantUnavailable",
      }),
    });
  }
  const candidate = parsePreviewCandidate({
    offerType: occurrence.offerType,
    sourceDocumentId: occurrence.sourceDocumentId,
    indexDocumentId: occurrence.indexDocumentId,
    sourceCreatedAtMs: occurrence.sourceCreatedAtMs,
    sourceCreatedAtOrderKey: occurrence.sourceCreatedAtOrderKey,
    sourceFingerprint: occurrence.sourceFingerprint,
  });
  const expectedMatchingMode: "parent" | "offer" = result.parentMatches
    ? "parent"
    : "offer";
  if (
    candidate === null ||
    occurrence.authoritativeAccountId !== result.authoritativeAccountId ||
    (occurrence.pagePurpose === "offerPage" &&
      occurrence.matchingMode !== expectedMatchingMode) ||
    customerBiteSaverOpaqueRestaurantId(
      value.context.secretKey,
      occurrence.authoritativeAccountId,
    ) !== value.request.restaurantId ||
    customerBiteSaverOpaqueOfferId(
      value.context.secretKey,
      occurrence.authoritativeAccountId,
      occurrence.offerType,
      occurrence.sourceDocumentId,
    ) !== value.request.offerId
  ) {
    return Object.freeze({
      kind: "unavailable",
      result: unavailableRedemptionResponse({
        request: value.request,
        nowMs: value.nowMs,
        reason: "offerUnavailable",
      }),
    });
  }
  const freshCoordinates = value.request.currentCoordinates === null
    ? null
    : Object.freeze({
        latitude: value.request.currentCoordinates.latitude,
        longitude: value.request.currentCoordinates.longitude,
        capturedAt: new Date(value.request.currentCoordinates.capturedAtMillis),
      });
  const snapshot = await value.context.database.runTransaction(
    async (transaction) => {
      const parent = currentParentFromRaw({
        result,
        rawDocument: await transaction.getDocument(
          `restaurant_accounts/${result.authoritativeAccountId}`,
        ),
        session: value.session,
        secretKey: value.context.secretKey,
        now: new Date(value.nowMs),
      });
      if (parent === null) {
        return null;
      }
      const evaluated = await evaluateOfferSeeds({
        seeds: [Object.freeze({parent, candidate})],
        session: value.session,
        context: value.context,
        now: new Date(value.nowMs),
        guestUnavailableOfferIds: new Set<string>(),
        freshCoordinates,
        reader: transaction,
      });
      return Object.freeze({parent, evaluated});
    },
  );
  if (snapshot === null) {
    return Object.freeze({
      kind: "unavailable",
      result: unavailableRedemptionResponse({
        request: value.request,
        nowMs: value.nowMs,
        reason: "restaurantUnavailable",
      }),
    });
  }
  const current = snapshot.evaluated.offers.get(offerIdentityKey({
    authoritativeAccountId: result.authoritativeAccountId,
    offerType: candidate.offerType,
    sourceDocumentId: candidate.sourceDocumentId,
  }));
  if (current === undefined) {
    return Object.freeze({
      kind: "unavailable",
      result: unavailableRedemptionResponse({
        request: value.request,
        nowMs: value.nowMs,
        reason: "offerUnavailable",
      }),
    });
  }
  if (!current.decision.visible || !current.decision.redeemable) {
    return Object.freeze({
      kind: "unavailable",
      result: unavailableRedemptionResponse({
        request: value.request,
        nowMs: value.nowMs,
        reason: current.decision.reason,
        decision: current.decision,
      }),
    });
  }
  return Object.freeze({
    kind: "available",
    result,
    parent: snapshot.parent,
    offer: current,
    occurrence,
  });
}

function allowedGuestRedemptionResult(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  request: CustomerBiteSaverRedemptionRequest;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  resolution: Extract<GuestRedemptionResolution, {kind: "available"}>;
}): CustomerBiteSaverRedemptionValidationResult {
  const evaluationAtMs = value.document.evaluationAt.getTime();
  const expiresAt = Math.min(
    evaluationAtMs + 60_000,
    value.document.logicalExpiresAt.getTime(),
    value.session.absoluteExpiresAt.getTime(),
    value.resolution.offer.decision.eligibilityExpiresAtMs ??
      Number.MAX_SAFE_INTEGER,
  );
  const validationId = customerBiteSaverDeterministicId(
    value.context.secretKey,
    "bsv",
    "redemptionStartValidation",
    [
      value.session.sessionId,
      String(value.session.attemptGeneration),
      value.document.callerCapabilityBinding,
      value.request.restaurantId,
      value.request.offerId,
      value.request.redemptionRequestId,
      value.resolution.occurrence.pageGenerationFingerprint,
      value.resolution.occurrence.indexDocumentId,
      value.resolution.occurrence.sourceCreatedAtOrderKey,
      value.resolution.occurrence.sourceFingerprint,
      value.resolution.parent.offerCatalogFingerprint,
      value.resolution.offer.usageGeneration,
      value.document.operationFingerprint,
      String(evaluationAtMs),
      String(expiresAt),
    ],
  );
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
    allowed: true,
    reason: "available",
    evaluatedAtMillis: evaluationAtMs,
    activeTimerExpiresAtMillis:
      value.resolution.offer.decision.activeTimerExpiresAtMs,
    nextAvailableAtMillis: value.resolution.offer.decision.nextAvailableAtMs,
    validationId,
    validationExpiresAtMillis: expiresAt,
  });
}

async function processGuestRedemptionStart(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<Readonly<{
  document: CustomerBiteSaverGuestCheckDocument;
  response: CustomerBiteSaverGuestOperationResponse;
}>> {
  let document = await applyGuestAcceptedAnswer(value);
  const progress = document.progress;
  if (
    progress.kind !== "redemptionStart" ||
    document.originalRequest.kind !== "redemptionStart"
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  if (document.state === "awaitingAnswer") {
    return Object.freeze({document, response: guestCheckResponse(document)});
  }
  if (progress.locallyUnavailable === null) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const request: CustomerBiteSaverRedemptionRequest = Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: document.originalClientRequestId,
    clientInstanceId: "not-retained-in-private-progress",
    sessionId: document.sessionId,
    capability: "not-retained-in-private-progress",
    criteriaFingerprint: document.criteriaFingerprint,
    restaurantId: document.originalRequest.restaurantId,
    offerId: document.originalRequest.offerId,
    offerOccurrence: document.originalRequest.offerOccurrence,
    redemptionRequestId: document.originalRequest.redemptionRequestId,
    currentCoordinates: document.originalRequest.currentCoordinates,
    guestStateRevision: document.guestStateRevision,
  });
  if (progress.locallyUnavailable) {
    const result = unavailableRedemptionResponse({
      request,
      nowMs: document.evaluationAt.getTime(),
      reason: "used",
    });
    document = guestCompletedDocument(document, progress);
    return Object.freeze({
      document,
      response: guestCompleteResponse({
        document,
        availabilityGeneration: createQueryFingerprint({
          operationRef: document.operationRef,
          guestStateRevision: document.guestStateRevision,
          result,
        }),
        result,
      }) as CustomerBiteSaverGuestOperationResponse,
    });
  }
  const nowMs = contextNow(value.context);
  const resolution = await resolveGuestRedemptionTarget({
    request,
    session: value.session,
    context: value.context,
    nowMs,
    callerCapabilityBinding: document.callerCapabilityBinding,
  });
  const result = resolution.kind === "available"
    ? allowedGuestRedemptionResult({
        document,
        request,
        session: value.session,
        context: value.context,
        resolution,
      })
    : Object.freeze({
        ...resolution.result,
        evaluatedAtMillis: document.evaluationAt.getTime(),
      });
  const availabilityGeneration = resolution.kind === "available"
    ? guestAvailabilityGenerationForCurrentOffers({
        document,
        offers: [resolution.offer],
      })
    : createQueryFingerprint({
        operationRef: document.operationRef,
        guestStateRevision: document.guestStateRevision,
        result,
      });
  document = guestCompletedDocument(document, progress);
  return Object.freeze({
    document,
    response: guestCompleteResponse({
      document,
      availabilityGeneration,
      result,
    }) as CustomerBiteSaverGuestOperationResponse,
  });
}

function directGuestComplete<Result>(value: {
  operation: CustomerBiteSaverGuestOperation;
  session: CustomerBiteSaverSessionDocument;
  guestStateRevision: number | null;
  evaluationAtMs: number;
  availabilityGeneration: string;
  result: Result;
}): CustomerBiteSaverGuestCompleteResponse<Result> {
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    outcome: "complete",
    operation: value.operation,
    guestStateRevision: value.guestStateRevision,
    attemptGeneration: value.session.attemptGeneration,
    queryFingerprint: value.session.queryFingerprint,
    evaluationContext: Object.freeze({
      evaluationAtMillis: value.evaluationAtMs,
      timeZone: value.session.criteria.timeZone,
      utcOffsetMinutes: value.session.criteria.utcOffsetMinutes,
      availabilityGeneration: value.availabilityGeneration,
    }),
    result: value.result,
  });
}

function isGuestSourceChange(error: unknown): boolean {
  return error instanceof CustomerBiteSaverContractError &&
    error.code === "failed-precondition" &&
    /(?:source|catalog|restaurant|offer occurrence).*changed|unavailable/iu.test(
      error.message,
    );
}

async function processAndPersistGuestOperation(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<CustomerBiteSaverGuestOperationResponse> {
  if (contextNow(value.context) >= value.document.logicalExpiresAt.getTime()) {
    const expired = guestRetryDocument(
      value.document,
      "checkExpired",
      "originalOperation",
    );
    await persistGuestCheckDocument(value.context, expired);
    return guestRetryResponse(expired);
  }
  try {
    const processed = value.document.operation === "restaurantPage"
      ? await processGuestRestaurantPage(value)
      : value.document.operation === "offerPage"
        ? await processGuestOfferPage(value)
        : await processGuestRedemptionStart(value);
    if (
      processed.response.outcome === "complete" &&
      contextNow(value.context) >= processed.document.logicalExpiresAt.getTime()
    ) {
      const expired = guestRetryDocument(
        processed.document,
        "checkExpired",
        "originalOperation",
      );
      await persistGuestCheckDocument(value.context, expired);
      return guestRetryResponse(expired);
    }
    await persistGuestCheckDocument(value.context, processed.document);
    return processed.response;
  } catch (error) {
    if (!isGuestSourceChange(error)) {
      throw error;
    }
    const retry = guestRetryDocument(
      value.document,
      "sourceChanged",
      value.document.operation === "restaurantPage" ? "search" :
        "originalOperation",
    );
    await persistGuestCheckDocument(value.context, retry);
    return guestRetryResponse(retry);
  }
}

function guestCheckTokenBinding(
  document: CustomerBiteSaverGuestCheckDocument,
  payload: CustomerBiteSaverGuestOfferCheckTokenPayload,
): Parameters<CustomerBiteSaverGuestOfferCheckCodec["decode"]>[1] {
  const batch = document.activeBatch;
  if (batch === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver guest offer check is no longer active.",
    );
  }
  return Object.freeze({
    operationPurpose: document.operation,
    operationRef: document.operationRef,
    sessionId: document.sessionId,
    attemptGeneration: document.attemptGeneration,
    criteriaFingerprint: document.criteriaFingerprint,
    queryFingerprint: document.queryFingerprint,
    callerCapabilityBinding: document.callerCapabilityBinding,
    operationFingerprint: document.operationFingerprint,
    restaurantPublicId: document.originalRequest.kind === "restaurantPage"
      ? null
      : document.originalRequest.restaurantId,
    consumedBoundaryFingerprint: batch.consumedBoundaryFingerprint,
    batchSequence: batch.sequence,
    candidateOfferIds: Object.freeze(
      batch.candidates.map((candidate) => candidate.offerId),
    ),
    candidateDigest: batch.candidateDigest,
    availabilityGeneration: batch.availabilityGeneration,
    timeZone: document.timeZone,
    utcOffsetMinutes: document.utcOffsetMinutes,
    guestStateRevision: document.guestStateRevision,
    evaluationAtMillis: document.evaluationAt.getTime(),
    issuedAtMillis: batch.issuedAtMillis,
    expiresAtMillis: batch.expiresAtMillis,
  });
}

function guestAnswerRequestFingerprint(
  request: CustomerBiteSaverGuestOfferCheckContinuationRequest,
): string {
  const unavailableOfferIds = [...request.unavailableOfferIds].sort(
    compareCustomerBiteSaverFirestoreUtf8,
  );
  return createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    purpose: "guestOfferCheckAnswer",
    sessionId: request.sessionId,
    operationRef: request.operationRef,
    checkToken: request.checkToken,
    batchSequence: request.batchSequence,
    guestStateRevision: request.guestStateRevision,
    entireBatchEvaluated: request.entireBatchEvaluated,
    unavailableOfferIds,
  });
}

function guestAnswerMatchesLastAccepted(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  request: CustomerBiteSaverGuestOfferCheckContinuationRequest;
  requestFingerprint: string;
}): boolean {
  return value.document.lastAcceptedAnswer?.batchSequence ===
      value.request.batchSequence &&
    value.document.lastAcceptedAnswer.clientRequestId ===
      value.request.clientRequestId &&
    value.document.lastAcceptedAnswer.requestFingerprint ===
      value.requestFingerprint;
}

function guestAnswerMatchesAccepted(value: {
  document: CustomerBiteSaverGuestCheckDocument;
  request: CustomerBiteSaverGuestOfferCheckContinuationRequest;
  requestFingerprint: string;
}): boolean {
  return value.document.state === "answerAccepted" &&
    value.document.activeBatch?.sequence === value.request.batchSequence &&
    value.document.activeBatch.token === value.request.checkToken &&
    value.document.acceptedAnswer?.batchSequence ===
      value.request.batchSequence &&
    value.document.acceptedAnswer.clientRequestId ===
      value.request.clientRequestId &&
    value.document.acceptedAnswer.requestFingerprint ===
      value.requestFingerprint;
}

async function loadInitialGuestDocument(value: {
  base: CustomerBiteSaverGuestCheckDocument;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<CustomerBiteSaverGuestCheckDocument> {
  const stored = await value.context.database.getDocument(
    guestCheckPath(value.base.operationRef),
  );
  if (stored === null) {
    await persistGuestCheckDocument(value.context, value.base);
    return value.base;
  }
  const document = parseGuestCheckDocument(stored, value.context, value.session);
  if (document === null) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  assertGuestDocumentOperation(document, {
    operation: value.base.operation,
    originalClientRequestId: value.base.originalClientRequestId,
    originalRequest: value.base.originalRequest,
    session: value.session,
    context: value.context,
    guestStateRevision: value.base.guestStateRevision,
  });
  return document;
}

async function loadExistingGuestDocument(value: {
  operation: CustomerBiteSaverGuestOperation;
  originalClientRequestId: string;
  originalRequest: CustomerBiteSaverGuestOriginalRequest;
  guestStateRevision: number;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
}): Promise<CustomerBiteSaverGuestCheckDocument | null> {
  const {operationRef} = guestOperationDocumentIdentity(value);
  const stored = await value.context.database.getDocument(
    guestCheckPath(operationRef),
  );
  if (stored === null) {
    return null;
  }
  const document = parseGuestCheckDocument(stored, value.context, value.session);
  if (document === null) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  assertGuestDocumentOperation(document, value);
  return document;
}

async function startGuestRestaurantPage(value: {
  request: CustomerBiteSaverPageRequest;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  openedCursor: CustomerBiteSaverCursorPayload | null;
  nowMs: number;
}): Promise<CustomerBiteSaverGuestOperationResponse> {
  return withCustomerBiteSaverRequestGate({
    context: value.context,
    session: value.session,
    clientRequestId: value.request.clientRequestId,
    endpoint: "restaurantPage",
    nowMs: value.nowMs,
    operation: async () => {
      const session = await touchPreauthorizedSession(
        value.request,
        value.context,
        value.session,
        value.nowMs,
      );
      const replay = await reserveCustomerBiteSaverRequestReplay({
        database: value.context.database,
        secretKey: value.context.secretKey,
        sessionId: session.sessionId,
        attemptGeneration: session.attemptGeneration,
        callerCapabilityBinding: callerCapabilityBindingFor(
          value.context,
          session,
        ),
        purpose: "restaurantPage",
        clientRequestId: value.request.clientRequestId,
        requestFingerprint: pageRequestFingerprint({
          purpose: "restaurantPage",
          cursor: value.request.cursor,
          guestStateRevision: value.request.guestStateRevision,
          restaurantPublicId: null,
        }),
        nowMs: value.nowMs,
        absoluteSessionExpiresAt: session.absoluteExpiresAt,
      });
      const originalRequest: CustomerBiteSaverGuestOriginalRequest =
        Object.freeze({kind: "restaurantPage", cursor: value.request.cursor});
      const existing = await loadExistingGuestDocument({
        operation: "restaurantPage",
        originalClientRequestId: value.request.clientRequestId,
        originalRequest,
        guestStateRevision: value.request.guestStateRevision as number,
        session,
        context: value.context,
      });
      if (existing !== null) {
        const document = await refreshGuestPageCheckpointForRequest({
          document: existing,
          session,
          context: value.context,
          nowMs: contextNow(value.context),
        });
        if (
          document !== existing &&
          (document.state === "awaitingAnswer" ||
            (document.state === "retryRequired" &&
              document.retryReason !== "workBudget"))
        ) {
          await persistGuestCheckDocument(value.context, document);
        }
        if (document.state === "awaitingAnswer") {
          return guestCheckResponse(document);
        }
        if (
          document.state === "retryRequired" &&
          document.retryReason !== "workBudget"
        ) {
          return guestRetryResponse(document);
        }
        return processAndPersistGuestOperation({
          document,
          session,
          context: value.context,
        });
      }
      if (
        value.openedCursor !== null &&
        value.nowMs >= value.openedCursor.expiresAtMs
      ) {
        throw new CustomerBiteSaverContractError(
          "invalid-argument",
          "The BiteSaver page cursor is invalid or expired.",
        );
      }
      const cursorState = pageCursorState({
        cursor: value.request.cursor,
        purpose: "restaurantPage",
        session,
        context: value.context,
        nowMs: value.nowMs,
        initialAvailabilityAtMs: replay.evaluationAtMs,
        guestStateFingerprint: guestStateFingerprint(
          value.request.guestStateRevision,
        ),
        offerCatalogFingerprint: null,
        restaurantPublicId: null,
        matchingMode: null,
      });
      if (
        cursorState.startAfter !== undefined &&
        cursorState.startAfter.length !== 4
      ) {
        throw new CustomerBiteSaverContractError(
          "invalid-argument",
          "The BiteSaver restaurant cursor is invalid.",
        );
      }
      const outerBoundary = cursorState.startAfter === undefined
        ? null
        : parseRestaurantResultSortTuple(cursorState.startAfter);
      if (cursorState.startAfter !== undefined && outerBoundary === null) {
        throw new CustomerBiteSaverContractError("invalid-argument");
      }
      const progress: CustomerBiteSaverGuestRestaurantProgress = Object.freeze({
        kind: "restaurantPage",
        outerBoundary,
        readyRestaurants: Object.freeze([]),
        currentRestaurant: null,
        resultSourceExhausted: false,
      });
      const base = guestDocumentForOperation({
        operation: "restaurantPage",
        originalClientRequestId: value.request.clientRequestId,
        originalRequest,
        progress,
        session,
        context: value.context,
        evaluationAtMs: replay.evaluationAtMs,
        guestStateRevision: value.request.guestStateRevision as number,
        ...(value.openedCursor === null
          ? {}
          : {externalExpiresAtMs: value.openedCursor.expiresAtMs}),
      });
      let document = await loadInitialGuestDocument({
        base,
        session,
        context: value.context,
      });
      const loaded = document;
      document = await refreshGuestPageCheckpointForRequest({
        document,
        session,
        context: value.context,
        nowMs: contextNow(value.context),
      });
      if (
        document !== loaded &&
        (document.state === "awaitingAnswer" ||
          (document.state === "retryRequired" &&
            document.retryReason !== "workBudget"))
      ) {
        await persistGuestCheckDocument(value.context, document);
      }
      if (document.state === "awaitingAnswer") {
        return guestCheckResponse(document);
      }
      if (document.state === "retryRequired" &&
          document.retryReason !== "workBudget") {
        return guestRetryResponse(document);
      }
      return processAndPersistGuestOperation({
        document,
        session,
        context: value.context,
      });
    },
  });
}

async function startGuestOfferPage(value: {
  request: CustomerBiteSaverOfferPageRequest;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  openedCursor: CustomerBiteSaverCursorPayload | null;
  nowMs: number;
}): Promise<CustomerBiteSaverGuestOperationResponse> {
  const originalRequest: CustomerBiteSaverGuestOriginalRequest =
    Object.freeze({
      kind: "offerPage",
      cursor: value.request.cursor,
      restaurantId: value.request.restaurantId,
    });
  return withCustomerBiteSaverRequestGate({
    context: value.context,
    session: value.session,
    clientRequestId: value.request.clientRequestId,
    endpoint: "offerPage",
    nowMs: value.nowMs,
    operation: async () => {
      const session = await touchPreauthorizedSession(
        value.request,
        value.context,
        value.session,
        value.nowMs,
      );
      const replay = await reserveCustomerBiteSaverRequestReplay({
        database: value.context.database,
        secretKey: value.context.secretKey,
        sessionId: session.sessionId,
        attemptGeneration: session.attemptGeneration,
        callerCapabilityBinding: callerCapabilityBindingFor(
          value.context,
          session,
        ),
        purpose: "offerPage",
        clientRequestId: value.request.clientRequestId,
        requestFingerprint: pageRequestFingerprint({
          purpose: "offerPage",
          cursor: value.request.cursor,
          guestStateRevision: value.request.guestStateRevision,
          restaurantPublicId: value.request.restaurantId,
        }),
        nowMs: value.nowMs,
        absoluteSessionExpiresAt: session.absoluteExpiresAt,
      });
      const existing = await loadExistingGuestDocument({
        operation: "offerPage",
        originalClientRequestId: value.request.clientRequestId,
        originalRequest,
        guestStateRevision: value.request.guestStateRevision as number,
        session,
        context: value.context,
      });
      if (existing !== null) {
        const document = await refreshGuestPageCheckpointForRequest({
          document: existing,
          session,
          context: value.context,
          nowMs: contextNow(value.context),
        });
        if (
          document !== existing &&
          (document.state === "awaitingAnswer" ||
            (document.state === "retryRequired" &&
              document.retryReason !== "workBudget"))
        ) {
          await persistGuestCheckDocument(value.context, document);
        }
        if (document.state === "awaitingAnswer") {
          return guestCheckResponse(document);
        }
        if (
          document.state === "retryRequired" &&
          document.retryReason !== "workBudget"
        ) {
          return guestRetryResponse(document);
        }
        return processAndPersistGuestOperation({
          document,
          session,
          context: value.context,
        });
      }
      if (
        value.openedCursor !== null &&
        value.nowMs >= value.openedCursor.expiresAtMs
      ) {
        throw new CustomerBiteSaverContractError(
          "invalid-argument",
          "The BiteSaver page cursor is invalid or expired.",
        );
      }
      const resultId = customerBiteSaverResultDocumentId(
        value.context.secretKey,
        session.sessionId,
        session.attemptGeneration,
        value.request.restaurantId,
      );
      const result = parseResultDocument(
        await value.context.database.getDocument(path(
          privateCustomerBiteSaverResultCollection,
          resultId,
        )),
        session,
        value.context.secretKey,
      );
      if (
        result === null ||
        result.publicRestaurantId !== value.request.restaurantId
      ) {
        throw new CustomerBiteSaverContractError(
          "not-found",
          "The BiteSaver restaurant is unavailable.",
        );
      }
      const evaluationAt = new Date(replay.evaluationAtMs);
      const parent = currentParentFromRaw({
        result,
        rawDocument: await value.context.database.getDocument(
          `restaurant_accounts/${result.authoritativeAccountId}`,
        ),
        session,
        secretKey: value.context.secretKey,
        now: evaluationAt,
      });
      if (parent === null) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver restaurant is unavailable.",
        );
      }
      const matchingMode: "parent" | "offer" = result.parentMatches
        ? "parent"
        : "offer";
      const cursorState = pageCursorState({
        cursor: value.request.cursor,
        purpose: "offerPage",
        session,
        context: value.context,
        nowMs: value.nowMs,
        initialAvailabilityAtMs: replay.evaluationAtMs,
        guestStateFingerprint: guestStateFingerprint(
          value.request.guestStateRevision,
        ),
        offerCatalogFingerprint: parent.offerCatalogFingerprint,
        restaurantPublicId: value.request.restaurantId,
        matchingMode,
      });
      const parsedBoundaryValue = cursorState.startAfter === undefined
        ? null
        : parseLiveOfferSortTuple(cursorState.startAfter);
      if (
        cursorState.startAfter !== undefined &&
        (parsedBoundaryValue === null || parsedBoundaryValue === undefined)
      ) {
        throw new CustomerBiteSaverContractError("invalid-argument");
      }
      const parsedBoundary = parsedBoundaryValue as
        readonly [number, string, string] | null;
      const progress: CustomerBiteSaverGuestOfferProgress = Object.freeze({
        kind: "offerPage",
        resultId,
        restaurantId: value.request.restaurantId,
        authoritativeAccountId: result.authoritativeAccountId,
        matchingMode,
        parentCatalogFingerprint: parent.offerCatalogFingerprint,
        parentProjectionFingerprint: result.parentProjectionFingerprint,
        scanBoundary: parsedBoundary,
        readyOffers: Object.freeze([]),
        sourceExhausted: false,
      });
      const base = guestDocumentForOperation({
        operation: "offerPage",
        originalClientRequestId: value.request.clientRequestId,
        originalRequest,
        progress,
        session,
        context: value.context,
        evaluationAtMs: replay.evaluationAtMs,
        guestStateRevision: value.request.guestStateRevision as number,
        ...(value.openedCursor === null
          ? {}
          : {externalExpiresAtMs: value.openedCursor.expiresAtMs}),
      });
      let document = await loadInitialGuestDocument({
        base,
        session,
        context: value.context,
      });
      const loaded = document;
      document = await refreshGuestPageCheckpointForRequest({
        document,
        session,
        context: value.context,
        nowMs: contextNow(value.context),
      });
      if (
        document !== loaded &&
        (document.state === "awaitingAnswer" ||
          (document.state === "retryRequired" &&
            document.retryReason !== "workBudget"))
      ) {
        await persistGuestCheckDocument(value.context, document);
      }
      if (document.state === "awaitingAnswer") {
        return guestCheckResponse(document);
      }
      if (document.state === "retryRequired" &&
          document.retryReason !== "workBudget") {
        return guestRetryResponse(document);
      }
      return processAndPersistGuestOperation({
        document,
        session,
        context: value.context,
      });
    },
  });
}

async function startGuestRedemption(value: {
  request: CustomerBiteSaverRedemptionRequest;
  session: CustomerBiteSaverSessionDocument;
  context: CustomerBiteSaverSessionContext;
  openedOccurrence: CustomerBiteSaverOfferOccurrencePayload;
  nowMs: number;
}): Promise<CustomerBiteSaverGuestOperationResponse> {
  const originalRequest: CustomerBiteSaverGuestOriginalRequest =
    Object.freeze({
      kind: "redemptionStart",
      restaurantId: value.request.restaurantId,
      offerId: value.request.offerId,
      offerOccurrence: value.request.offerOccurrence,
      redemptionRequestId: value.request.redemptionRequestId,
      currentCoordinates: value.request.currentCoordinates,
    });
  return withCustomerBiteSaverRequestGate({
    context: value.context,
    session: value.session,
    clientRequestId: value.request.clientRequestId,
    endpoint: "redemptionStart",
    nowMs: value.nowMs,
    operation: async () => {
      const session = await touchPreauthorizedSession(
        value.request,
        value.context,
        value.session,
        value.nowMs,
      );
      const requestFingerprint = createQueryFingerprint({
        protocolVersion: customerBiteSaverSearchProtocolVersion,
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        purpose: "redemptionStart",
        restaurantId: value.request.restaurantId,
        offerId: value.request.offerId,
        offerOccurrence: value.request.offerOccurrence,
        redemptionRequestId: value.request.redemptionRequestId,
        currentCoordinates: value.request.currentCoordinates === null
          ? null
          : {
              latitude: String(value.request.currentCoordinates.latitude),
              longitude: String(value.request.currentCoordinates.longitude),
              capturedAtMillis:
                value.request.currentCoordinates.capturedAtMillis,
            },
        guestStateRevision: value.request.guestStateRevision,
      });
      await reserveCustomerBiteSaverRequestReplay({
        database: value.context.database,
        secretKey: value.context.secretKey,
        sessionId: session.sessionId,
        attemptGeneration: session.attemptGeneration,
        callerCapabilityBinding: callerCapabilityBindingFor(
          value.context,
          session,
        ),
        purpose: "redemptionStart",
        clientRequestId: value.request.clientRequestId,
        requestFingerprint,
        nowMs: value.nowMs,
        absoluteSessionExpiresAt: session.absoluteExpiresAt,
      });
      const logicalReplay =
        await reserveCustomerBiteSaverLogicalRedemptionReplay({
          database: value.context.database,
          secretKey: value.context.secretKey,
          sessionId: session.sessionId,
          attemptGeneration: session.attemptGeneration,
          callerCapabilityBinding: callerCapabilityBindingFor(
            value.context,
            session,
          ),
          redemptionRequestId: value.request.redemptionRequestId,
          requestFingerprint,
          nowMs: value.nowMs,
          logicalSessionExpiresAt: session.logicalExpiresAt,
          absoluteSessionExpiresAt: session.absoluteExpiresAt,
        });
      const nowMs = contextNow(value.context);
      const replayExpiresAtMs = logicalReplay.logicalExpiresAtMs;
      if (nowMs >= replayExpiresAtMs) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "The BiteSaver redemption validation request has expired.",
        );
      }
      const existing = await loadExistingGuestDocument({
        operation: "redemptionStart",
        originalClientRequestId: value.request.clientRequestId,
        originalRequest,
        guestStateRevision: value.request.guestStateRevision as number,
        session,
        context: value.context,
      });
      if (existing !== null) {
        if (nowMs >= existing.logicalExpiresAt.getTime()) {
          return guestRetryResponse(existing, "checkExpired");
        }
        if (
          existing.state === "retryRequired" &&
          existing.retryReason !== "workBudget"
        ) {
          return guestRetryResponse(existing);
        }
        if (
          existing.state === "completed" ||
          existing.state === "answerAccepted"
        ) {
          return processAndPersistGuestOperation({
            document: existing,
            session,
            context: value.context,
          });
        }
      }
      const resolution = await resolveGuestRedemptionTarget({
        request: value.request,
        session,
        context: value.context,
        nowMs: logicalReplay.evaluationAtMs,
      });
      const currentResolution = logicalReplay.evaluationAtMs === nowMs
        ? resolution
        : await resolveGuestRedemptionTarget({
            request: value.request,
            session,
            context: value.context,
            nowMs,
          });
      if (resolution.kind === "unavailable") {
        if (existing !== null) {
          const retry = guestRetryDocument(
            existing,
            "sourceChanged",
            "originalOperation",
          );
          await persistGuestCheckDocument(value.context, retry);
          return guestRetryResponse(retry);
        }
        const result = Object.freeze({
          ...resolution.result,
          evaluatedAtMillis: logicalReplay.evaluationAtMs,
        });
        assertLogicalRedemptionFenceLive(value.context, replayExpiresAtMs);
        return directGuestComplete({
          operation: "redemptionStart",
          session,
          guestStateRevision: value.request.guestStateRevision,
          evaluationAtMs: logicalReplay.evaluationAtMs,
          availabilityGeneration: createQueryFingerprint({
            purpose: "guestRedemptionUnavailable",
            requestFingerprint,
            result,
          }),
          result,
        }) as CustomerBiteSaverGuestOperationResponse;
      }
      if (currentResolution.kind === "unavailable") {
        if (existing !== null) {
          const retry = guestRetryDocument(
            existing,
            "sourceChanged",
            "originalOperation",
          );
          await persistGuestCheckDocument(value.context, retry);
          return guestRetryResponse(retry);
        }
        const result = Object.freeze({
          ...currentResolution.result,
          evaluatedAtMillis: logicalReplay.evaluationAtMs,
        });
        assertLogicalRedemptionFenceLive(value.context, replayExpiresAtMs);
        return directGuestComplete({
          operation: "redemptionStart",
          session,
          guestStateRevision: value.request.guestStateRevision,
          evaluationAtMs: logicalReplay.evaluationAtMs,
          availabilityGeneration: createQueryFingerprint({
            purpose: "guestRedemptionCurrentlyUnavailable",
            requestFingerprint,
            result,
          }),
          result,
        }) as CustomerBiteSaverGuestOperationResponse;
      }
      if (
        resolution.result.id !== currentResolution.result.id ||
        resolution.parent.offerCatalogFingerprint !==
          currentResolution.parent.offerCatalogFingerprint ||
        resolution.result.parentProjectionFingerprint !==
          currentResolution.result.parentProjectionFingerprint ||
        !sameGuestStoredOffer(
          guestStoredOffer(resolution.offer),
          guestStoredOffer(currentResolution.offer),
        )
      ) {
        if (existing !== null) {
          const retry = guestRetryDocument(
            existing,
            "sourceChanged",
            "originalOperation",
          );
          await persistGuestCheckDocument(value.context, retry);
          return guestRetryResponse(retry);
        }
        const result = unavailableRedemptionResponse({
          request: value.request,
          nowMs: logicalReplay.evaluationAtMs,
          reason: "offerUnavailable",
        });
        assertLogicalRedemptionFenceLive(value.context, replayExpiresAtMs);
        return directGuestComplete({
          operation: "redemptionStart",
          session,
          guestStateRevision: value.request.guestStateRevision,
          evaluationAtMs: logicalReplay.evaluationAtMs,
          availabilityGeneration: createQueryFingerprint({
            purpose: "guestRedemptionSourceChanged",
            requestFingerprint,
            result,
          }),
          result,
        }) as CustomerBiteSaverGuestOperationResponse;
      }
      if (existing !== null) {
        const existingProgress = existing.progress;
        const currentStoredOffer = guestStoredOffer(resolution.offer);
        if (
          existingProgress.kind !== "redemptionStart" ||
          existingProgress.resultId !== resolution.result.id ||
          existingProgress.restaurantId !== value.request.restaurantId ||
          existingProgress.offerId !== value.request.offerId ||
          existingProgress.authoritativeAccountId !==
            resolution.result.authoritativeAccountId ||
          existingProgress.parentCatalogFingerprint !==
            resolution.parent.offerCatalogFingerprint ||
          existingProgress.parentProjectionFingerprint !==
            resolution.result.parentProjectionFingerprint ||
          !sameGuestStoredOffer(existingProgress.offer, currentStoredOffer)
        ) {
          const retry = guestRetryDocument(
            existing,
            "sourceChanged",
            "originalOperation",
          );
          await persistGuestCheckDocument(value.context, retry);
          return guestRetryResponse(retry);
        }
        if (existing.state === "awaitingAnswer") {
          assertLogicalRedemptionFenceLive(value.context, replayExpiresAtMs);
          return guestCheckResponse(existing);
        }
      }
      const progress: CustomerBiteSaverGuestRedemptionProgress = Object.freeze({
        kind: "redemptionStart",
        resultId: resolution.result.id,
        restaurantId: value.request.restaurantId,
        offerId: value.request.offerId,
        authoritativeAccountId: resolution.result.authoritativeAccountId,
        parentCatalogFingerprint: resolution.parent.offerCatalogFingerprint,
        parentProjectionFingerprint: resolution.result.parentProjectionFingerprint,
        offer: guestStoredOffer(resolution.offer),
        locallyUnavailable: null,
      });
      const coordinateExpiry = resolution.offer.projection.isProximityOnly === true &&
          value.request.currentCoordinates !== null
        ? value.request.currentCoordinates.capturedAtMillis +
          customerBiteSaverFreshLocationMaximumAgeMilliseconds + 1
        : Number.MAX_SAFE_INTEGER;
      const base = guestDocumentForOperation({
        operation: "redemptionStart",
        originalClientRequestId: value.request.clientRequestId,
        originalRequest,
        progress,
        session,
        context: value.context,
        evaluationAtMs: logicalReplay.evaluationAtMs,
        guestStateRevision: value.request.guestStateRevision as number,
        externalExpiresAtMs: Math.min(
          value.openedOccurrence.expiresAtMs,
          coordinateExpiry,
          logicalReplay.logicalExpiresAtMs,
        ),
      });
      if (guestUsagePolicy(resolution.offer) === null) {
        if (existing !== null) {
          const retry = guestRetryDocument(
            existing,
            "sourceChanged",
            "originalOperation",
          );
          await persistGuestCheckDocument(value.context, retry);
          return guestRetryResponse(retry);
        }
        const result = allowedGuestRedemptionResult({
          document: base,
          request: value.request,
          session,
          context: value.context,
          resolution,
        });
        assertLogicalRedemptionFenceLive(value.context, replayExpiresAtMs);
        return directGuestComplete({
          operation: "redemptionStart",
          session,
          guestStateRevision: value.request.guestStateRevision,
          evaluationAtMs: logicalReplay.evaluationAtMs,
          availabilityGeneration: guestAvailabilityGenerationForCurrentOffers({
            document: base,
            offers: [resolution.offer],
          }),
          result,
        }) as CustomerBiteSaverGuestOperationResponse;
      }
      let document = existing ?? await loadInitialGuestDocument({
          base,
          session,
          context: value.context,
        });
      if (contextNow(value.context) >= document.logicalExpiresAt.getTime()) {
        return guestRetryResponse(document, "checkExpired");
      }
      if (document.state === "awaitingAnswer") {
        return guestCheckResponse(document);
      }
      if (document.state === "completed") {
        return processAndPersistGuestOperation({
          document,
          session,
          context: value.context,
        });
      }
      const redemptionProgress = document.progress;
      if (
        redemptionProgress.kind === "redemptionStart" &&
        redemptionProgress.locallyUnavailable === null &&
        document.activeBatch === null
      ) {
        document = createGuestCheckBatch({
          document,
          session,
          context: value.context,
          kind: "redemptionTarget",
          candidates: [resolution.offer],
          nextOfferBoundary: null,
          sourceExhausted: true,
          nowMs,
        });
        await persistGuestCheckDocument(value.context, document);
        assertLogicalRedemptionFenceLive(value.context, replayExpiresAtMs);
        return document.state === "awaitingAnswer"
          ? guestCheckResponse(document)
          : guestRetryResponse(document);
      }
      if (
        document.state === "retryRequired" &&
        document.retryReason !== "workBudget"
      ) {
        return guestRetryResponse(document);
      }
      return processAndPersistGuestOperation({
        document,
        session,
        context: value.context,
      });
    },
  });
}

export async function getCustomerBiteSaverSearchPageHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverRestaurantPageResult |
  CustomerBiteSaverGuestOperationResponse> {
  const request = parsePageRequest(rawRequest, false) as
    CustomerBiteSaverPageRequest;
  requireGuestStateRevisionForCaller(request.guestStateRevision, context);
  if (requireAuthUid(context.identity) !== null) {
    return getCustomerBiteSaverSearchPageCompletedHandler(rawRequest, context);
  }
  const nowMs = contextNow(context);
  const openedCursor = request.cursor === null
    ? null
    : new CustomerBiteSaverCursorCodec({
        key: context.secretKey,
        now: () => nowMs,
        nonceMode: "deterministicAuthenticated",
      }).open(request.cursor, {allowExpired: true});
  if (openedCursor !== null) {
    preflightPageCursorForRequest({
      payload: openedCursor,
      request,
      context,
      purpose: "restaurantPage",
      restaurantPublicId: null,
      guestStateFingerprint: guestStateFingerprint(
        request.guestStateRevision,
      ),
    });
  }
  const session = await readAuthorizedSession(request, context, nowMs);
  if (session.state !== "ready" || session.phase !== "ready") {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver search is not ready.",
    );
  }
  return startGuestRestaurantPage({
    request,
    session,
    context,
    openedCursor,
    nowMs,
  });
}

export async function getCustomerBiteSaverOfferPageHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverOfferPageResult |
  CustomerBiteSaverGuestOperationResponse> {
  const request = parsePageRequest(rawRequest, true) as
    CustomerBiteSaverOfferPageRequest;
  requireGuestStateRevisionForCaller(request.guestStateRevision, context);
  if (requireAuthUid(context.identity) !== null) {
    return getCustomerBiteSaverOfferPageCompletedHandler(rawRequest, context);
  }
  const nowMs = contextNow(context);
  const openedCursor = request.cursor === null
    ? null
    : new CustomerBiteSaverCursorCodec({
        key: context.secretKey,
        now: () => nowMs,
        nonceMode: "deterministicAuthenticated",
      }).open(request.cursor, {allowExpired: true});
  if (openedCursor !== null) {
    preflightPageCursorForRequest({
      payload: openedCursor,
      request,
      context,
      purpose: "offerPage",
      restaurantPublicId: request.restaurantId,
      guestStateFingerprint: guestStateFingerprint(
        request.guestStateRevision,
      ),
    });
  }
  const session = await readAuthorizedSession(request, context, nowMs);
  if (session.state !== "ready" || session.phase !== "ready") {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver search is not ready.",
    );
  }
  return startGuestOfferPage({
    request,
    session,
    context,
    openedCursor,
    nowMs,
  });
}

export async function validateCustomerBiteSaverOfferRedemptionStartHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverRedemptionValidationResult |
  CustomerBiteSaverGuestOperationResponse> {
  const request = parseRedemptionRequest(rawRequest);
  requireGuestStateRevisionForCaller(request.guestStateRevision, context);
  if (requireAuthUid(context.identity) !== null) {
    return validateCustomerBiteSaverOfferRedemptionStartCompletedHandler(
      rawRequest,
      context,
    );
  }
  const nowMs = contextNow(context);
  const openedOccurrence = new CustomerBiteSaverOfferOccurrenceCodec({
    key: context.secretKey,
    now: () => nowMs,
  }).open(request.offerOccurrence);
  preflightOfferOccurrenceForRequest({
    payload: openedOccurrence,
    request,
    context,
  });
  const session = await readAuthorizedSession(request, context, nowMs);
  if (session.state !== "ready" || session.phase !== "ready") {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver search is not ready.",
    );
  }
  return startGuestRedemption({
    request,
    session,
    context,
    openedOccurrence,
    nowMs,
  });
}

export async function continueCustomerBiteSaverGuestOfferCheckHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverGuestOperationResponse> {
  const request = parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
    rawRequest,
  );
  if (requireAuthUid(context.identity) !== null) {
    throw new CustomerBiteSaverContractError(
      "permission-denied",
      "The BiteSaver guest offer check is unavailable.",
    );
  }
  const nowMs = contextNow(context);
  const codec = new CustomerBiteSaverGuestOfferCheckCodec({
    key: context.secretKey,
    now: () => nowMs,
  });
  const payload = codec.open(request.checkToken, {allowExpired: true});
  const requestCallerBinding = requestCallerCapabilityBindingFor(
    context,
    request,
  );
  assertCustomerBiteSaverGuestOfferCheckContinuationMatchesToken(
    request,
    payload,
    {callerCapabilityBinding: requestCallerBinding},
  );
  const session = await readAuthorizedSession(
    request,
    context,
    nowMs,
    {allowExpired: true},
  );
  const stored = await context.database.getDocument(
    guestCheckPath(request.operationRef),
  );
  const document = parseGuestCheckDocument(stored, context, session);
  if (document === null) {
    throw new CustomerBiteSaverContractError(
      "not-found",
      "The BiteSaver guest offer check is unavailable.",
    );
  }
  if (
    document.sessionId !== session.sessionId ||
    !customerBiteSaverConstantTimeHexEqual(
      document.callerCapabilityBinding,
      requestCallerBinding,
    )
  ) {
    throw new CustomerBiteSaverContractError(
      "permission-denied",
      "The BiteSaver guest offer check is unavailable.",
    );
  }
  if (
    document.attemptGeneration !== session.attemptGeneration ||
    document.criteriaFingerprint !== session.criteriaFingerprint ||
    document.queryFingerprint !== session.queryFingerprint ||
    document.timeZone !== session.criteria.timeZone ||
    document.utcOffsetMinutes !== session.criteria.utcOffsetMinutes ||
    session.state !== "ready" || session.phase !== "ready" ||
    nowMs >= session.logicalExpiresAt.getTime() ||
    nowMs >= session.absoluteExpiresAt.getTime()
  ) {
    return guestRetryResponse(document, "sessionChanged",
      document.operation === "restaurantPage" ? "search" :
        "originalOperation");
  }
  const requestFingerprint = guestAnswerRequestFingerprint(request);
  const matchingProcessedAnswer = guestAnswerMatchesLastAccepted({
      document,
      request,
      requestFingerprint,
    });
  const matchingCommittedAnswer = guestAnswerMatchesAccepted({
    document,
    request,
    requestFingerprint,
  });
  if (!matchingProcessedAnswer && !matchingCommittedAnswer) {
    if (
      document.activeBatch === null ||
      document.activeBatch.sequence !== request.batchSequence ||
      document.activeBatch.token !== request.checkToken ||
      document.batchSequence !== request.batchSequence
    ) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The BiteSaver guest answer is stale or out of order.",
      );
    }
  }
  if (
    nowMs >= document.logicalExpiresAt.getTime() ||
    nowMs >= document.expiresAt.getTime()
  ) {
    return guestRetryResponse(document, "checkExpired");
  }
  if (
    nowMs >= payload.expiresAtMillis &&
    !matchingProcessedAnswer &&
    !matchingCommittedAnswer
  ) {
    return guestRetryResponse(document, "checkExpired");
  }
  if (!matchingProcessedAnswer && !matchingCommittedAnswer) {
    codec.decode(request.checkToken, guestCheckTokenBinding(document, payload));
  }
  return withCustomerBiteSaverRequestGate({
    context,
    session,
    clientRequestId: request.clientRequestId,
    endpoint: "guestOfferCheckAnswer",
    nowMs,
    operation: async () => {
      const accepted = await context.database.runTransaction(
        async (transaction) => {
          const currentSessionSnapshot = await transaction.getDocument(
            sessionPath(request.sessionId),
          );
          const currentSession = authorizeCustomerBiteSaverSession({
            request,
            session: parseSession(currentSessionSnapshot),
            context,
            nowMs,
          });
          if (
            currentSession.attemptGeneration !==
              session.attemptGeneration ||
            currentSession.queryFingerprint !== session.queryFingerprint ||
            currentSession.state !== "ready" ||
            currentSession.phase !== "ready"
          ) {
            throw new CustomerBiteSaverContractError(
              "failed-precondition",
              "The BiteSaver session changed.",
            );
          }
          const current = parseGuestCheckDocument(
            await transaction.getDocument(guestCheckPath(request.operationRef)),
            context,
            currentSession,
          );
          if (current === null) {
            throw new CustomerBiteSaverContractError(
              "not-found",
              "The BiteSaver guest offer check is unavailable.",
            );
          }
          const replayInput = {
            database: context.database,
            secretKey: context.secretKey,
            sessionId: currentSession.sessionId,
            attemptGeneration: currentSession.attemptGeneration,
            callerCapabilityBinding: current.callerCapabilityBinding,
            purpose: "guestOfferCheckAnswer" as const,
            clientRequestId: request.clientRequestId,
            requestFingerprint,
            nowMs,
            absoluteSessionExpiresAt: currentSession.absoluteExpiresAt,
          };
          if (
            nowMs >= current.logicalExpiresAt.getTime() ||
            nowMs >= current.expiresAt.getTime()
          ) {
            return Object.freeze({
              document: current,
              session: currentSession,
              answerExpired: true,
            });
          }
          if (guestAnswerMatchesLastAccepted({
            document: current,
            request,
            requestFingerprint,
          })) {
            await reserveCustomerBiteSaverRequestReplayInTransaction(
              replayInput,
              transaction,
            );
            return Object.freeze({
              document: current,
              session: await touchSessionInTransaction(
                transaction,
                currentSession,
                nowMs,
              ),
              answerExpired: false,
            });
          }
          if (current.state === "awaitingAnswer") {
            if (
              current.batchSequence !== request.batchSequence ||
              current.activeBatch?.sequence !== request.batchSequence ||
              current.activeBatch.token !== request.checkToken
            ) {
              throw new CustomerBiteSaverContractError(
                "failed-precondition",
                "The BiteSaver guest answer is stale or out of order.",
              );
            }
            if (nowMs >= current.activeBatch.expiresAtMillis) {
              return Object.freeze({
                document: current,
                session: currentSession,
                answerExpired: true,
              });
            }
            await reserveCustomerBiteSaverRequestReplayInTransaction(
              replayInput,
              transaction,
            );
            const next = sealGuestCheckDocument(context, Object.freeze({
              ...current,
              state: "answerAccepted" as const,
              acceptedAnswer: Object.freeze({
                batchSequence: request.batchSequence,
                clientRequestId: request.clientRequestId,
                requestFingerprint,
                unavailableOfferIds: Object.freeze(
                  [...request.unavailableOfferIds].sort(
                    compareCustomerBiteSaverFirestoreUtf8,
                  ),
                ),
              }),
              retryReason: null,
              restartFrom: null,
            }));
            transaction.setDocument(guestCheckPath(current.operationRef), next);
            return Object.freeze({
              document: next,
              session: await touchSessionInTransaction(
                transaction,
                currentSession,
                nowMs,
              ),
              answerExpired: false,
            });
          }
          if (current.state === "answerAccepted") {
            if (
              current.acceptedAnswer?.batchSequence !== request.batchSequence ||
              current.acceptedAnswer.clientRequestId !== request.clientRequestId ||
              current.acceptedAnswer.requestFingerprint !== requestFingerprint
            ) {
              throw new CustomerBiteSaverContractError(
                "failed-precondition",
                "A conflicting BiteSaver guest answer was already accepted.",
              );
            }
            await reserveCustomerBiteSaverRequestReplayInTransaction(
              replayInput,
              transaction,
            );
            return Object.freeze({
              document: current,
              session: await touchSessionInTransaction(
                transaction,
                currentSession,
                nowMs,
              ),
              answerExpired: false,
            });
          }
          if (!guestAnswerMatchesLastAccepted({
            document: current,
            request,
            requestFingerprint,
          })) {
            throw new CustomerBiteSaverContractError(
              "failed-precondition",
              "The BiteSaver guest answer was already completed or superseded.",
            );
          }
          await reserveCustomerBiteSaverRequestReplayInTransaction(
            replayInput,
            transaction,
          );
          return Object.freeze({
            document: current,
            session: await touchSessionInTransaction(
              transaction,
              currentSession,
              nowMs,
            ),
            answerExpired: false,
          });
        },
      );
      if (accepted.answerExpired) {
        return guestRetryResponse(accepted.document, "checkExpired");
      }
      if (
        accepted.document.state === "retryRequired" &&
        accepted.document.retryReason !== "workBudget"
      ) {
        return guestRetryResponse(accepted.document);
      }
      const refreshed = await refreshGuestPageCheckpointForRequest({
        document: accepted.document,
        session: accepted.session,
        context,
        nowMs: contextNow(context),
      });
      if (
        refreshed.state === "retryRequired" &&
        refreshed.retryReason !== "workBudget"
      ) {
        if (refreshed !== accepted.document) {
          await persistGuestCheckDocument(context, refreshed);
        }
        return guestRetryResponse(refreshed);
      }
      return processAndPersistGuestOperation({
        document: refreshed,
        session: accepted.session,
        context,
      });
    },
  });
}
