import { createHash } from "node:crypto";
import { createQueryFingerprint } from "./query_fingerprint.js";
import {
  customerBiteSaverMatcherVersion,
  customerBiteSaverNameOrderVersion,
  customerBiteSaverNormalizerVersion,
  hasWellFormedCustomerBiteSaverUtf16,
  normalizeCustomerBiteSaverSearchText,
  requireCustomerBiteSaverSearchText,
} from "./customer_bitesaver_search_matcher.js";
import { validRestaurantCoordinates } from "./restaurant_geo_helpers.js";

export const customerBiteSaverSearchProtocolVersion =
  "bitestar.customer-bitesaver-search.v1" as const;
export const customerBiteSaverSearchSchemaVersion = 1 as const;
export const customerBiteSaverRestaurantProjectionVersion =
  "bitestar.bitesaver-public-restaurant.v1" as const;
export const customerBiteSaverOfferProjectionVersion =
  "bitestar.bitesaver-customer-offer.v2" as const;
export const customerBiteSaverEligibilityPolicyVersion =
  "bitestar.bitesaver-eligibility.v1" as const;
export const customerBiteSaverDistanceRankingVersion =
  "bitestar.haversine-wgs84-radius.v1" as const;
export const customerBiteSaverOfferOrderVersion =
  "bitestar.bitesaver-offer-order.v1" as const;
export const customerBiteSaverPageSize = 25 as const;
export const customerBiteSaverPageLookahead = 26 as const;
export const customerBiteSaverPageConsumeLimit = 100 as const;
export const customerBiteSaverPreviewCandidateRetentionLimit = 25 as const;
export const customerBiteSaverFavoriteLimit = 75 as const;
export const customerBiteSaverGuestCheckMaximumCandidateIds = 75 as const;
export const customerBiteSaverWorkerSourceLimit = 100 as const;
export const customerBiteSaverRangeFetchLimit = 25 as const;
export const customerBiteSaverRangesPerWorker = 2 as const;
export const customerBiteSaverMaximumRanges = 9 as const;
export const customerBiteSaverMaximumConcurrentOperations = 10 as const;
export const customerBiteSaverMaximumWritesPerCommit = 199 as const;
export const customerBiteSaverMaximumIndexedOrderKeyBytes = 1_500 as const;
export const customerBiteSaverCatalogGenerationShardCount = 16 as const;
export const customerBiteSaverMaximumCatalogRestarts = 2 as const;
export const customerBiteSaverWorkerLeaseMilliseconds = 30_000;
export const customerBiteSaverIdleExpiryMilliseconds = 15 * 60_000;
export const customerBiteSaverAbsoluteExpiryMilliseconds = 60 * 60_000;
export const customerBiteSaverCursorLifetimeMilliseconds = 15 * 60_000;
export const customerBiteSaverGuestCheckLifetimeMilliseconds = 300_000;
export const customerBiteSaverStartRateLimit = 6;
export const customerBiteSaverStartRateWindowMilliseconds = 60_000;
export const customerBiteSaverMaximumUnfinishedSessions = 2;

export const privateCustomerBiteSaverSearchSessionCollection =
  "private_bitesaver_search_sessions" as const;
export const privateCustomerBiteSaverActiveSessionCollection =
  "private_bitesaver_search_active_sessions" as const;
export const privateCustomerBiteSaverCandidateCollection =
  "private_bitesaver_search_candidates" as const;
export const privateCustomerBiteSaverResultCollection =
  "private_bitesaver_search_results" as const;
export const privateCustomerBiteSaverJobCollection =
  "private_bitesaver_search_jobs" as const;
export const privateCustomerBiteSaverCatalogGenerationCollection =
  "private_bitesaver_catalog_generation_shards" as const;
export const privateCustomerBiteSaverGuestOfferCheckCollection =
  "private_bitesaver_guest_offer_checks" as const;

export const customerBiteSaverSecretName =
  "BITESAVER_CUSTOMER_DISCOVERY_KEY" as const;

export const supportedCustomerBiteSaverRadii = Object.freeze([
  1,
  3,
  5,
  10,
  15,
  20,
  30,
] as const);

export type CustomerBiteSaverRadius =
  typeof supportedCustomerBiteSaverRadii[number];
export type CustomerBiteSaverLocationMode = "current" | "typed";
export type CustomerBiteSaverCallerScope = "guest" | "authenticated";
export type CustomerBiteSaverSessionState =
  | "preparing"
  | "ready"
  | "failed"
  | "expired";
export type CustomerBiteSaverPreparationPhase =
  | "restaurantRanges"
  | "offerRanges"
  | "finalizeCandidates"
  | "verifyCatalogGeneration"
  | "ready";
export type CustomerBiteSaverFailureCode =
  | "catalog_changed_repeatedly"
  | "invalid_private_state"
  | "preparation_failed";

export type CustomerBiteSaverTypedLocation =
  | Readonly<{kind: "zip"; zip: string}>
  | Readonly<{kind: "city"; city: string; state: string | null}>;

export type CustomerBiteSaverStartRequest = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  clientRequestId: string;
  clientInstanceId: string;
  latitude: number;
  longitude: number;
  radiusMiles: CustomerBiteSaverRadius;
  locationMode: CustomerBiteSaverLocationMode;
  typedLocation: CustomerBiteSaverTypedLocation | null;
  searchText: string;
  timeZone: string;
  utcOffsetMinutes: number;
  freshSearch: boolean;
}>;

export type CustomerBiteSaverCanonicalCriteria = Readonly<{
  searchProtocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  restaurantProjectionVersion:
    typeof customerBiteSaverRestaurantProjectionVersion;
  offerProjectionVersion: typeof customerBiteSaverOfferProjectionVersion;
  matcherVersion: typeof customerBiteSaverMatcherVersion;
  normalizerVersion: typeof customerBiteSaverNormalizerVersion;
  eligibilityPolicyVersion: typeof customerBiteSaverEligibilityPolicyVersion;
  distanceRankingVersion: typeof customerBiteSaverDistanceRankingVersion;
  nameOrderVersion: typeof customerBiteSaverNameOrderVersion;
  offerOrderVersion: typeof customerBiteSaverOfferOrderVersion;
  latitudeBinary64: string;
  longitudeBinary64: string;
  latitude: number;
  longitude: number;
  radiusMiles: CustomerBiteSaverRadius;
  locationMode: CustomerBiteSaverLocationMode;
  typedLocation: CustomerBiteSaverTypedLocation | null;
  normalizedSearchQuery: string;
  staticFilters: Readonly<{
    source: "biteSaver";
    publicVisible: true;
    customerDiscoverable: true;
  }>;
  timeZone: string;
  utcOffsetMinutes: number;
}>;

export class CustomerBiteSaverContractError extends Error {
  readonly code:
    | "invalid-argument"
    | "permission-denied"
    | "failed-precondition"
    | "resource-exhausted"
    | "not-found";

  constructor(
    code: CustomerBiteSaverContractError["code"],
    message = "The BiteSaver search request is invalid.",
  ) {
    super(message);
    this.name = "CustomerBiteSaverContractError";
    this.code = code;
  }
}

const stateEntries = Object.freeze([
  ["Alabama", "AL"], ["Alaska", "AK"], ["Arizona", "AZ"],
  ["Arkansas", "AR"], ["California", "CA"], ["Colorado", "CO"],
  ["Connecticut", "CT"], ["Delaware", "DE"], ["Florida", "FL"],
  ["Georgia", "GA"], ["Hawaii", "HI"], ["Idaho", "ID"],
  ["Illinois", "IL"], ["Indiana", "IN"], ["Iowa", "IA"],
  ["Kansas", "KS"], ["Kentucky", "KY"], ["Louisiana", "LA"],
  ["Maine", "ME"], ["Maryland", "MD"], ["Massachusetts", "MA"],
  ["Michigan", "MI"], ["Minnesota", "MN"], ["Mississippi", "MS"],
  ["Missouri", "MO"], ["Montana", "MT"], ["Nebraska", "NE"],
  ["Nevada", "NV"], ["New Hampshire", "NH"], ["New Jersey", "NJ"],
  ["New Mexico", "NM"], ["New York", "NY"],
  ["North Carolina", "NC"], ["North Dakota", "ND"], ["Ohio", "OH"],
  ["Oklahoma", "OK"], ["Oregon", "OR"], ["Pennsylvania", "PA"],
  ["Rhode Island", "RI"], ["South Carolina", "SC"],
  ["South Dakota", "SD"], ["Tennessee", "TN"], ["Texas", "TX"],
  ["Utah", "UT"], ["Vermont", "VT"], ["Virginia", "VA"],
  ["Washington", "WA"], ["West Virginia", "WV"], ["Wisconsin", "WI"],
  ["Wyoming", "WY"], ["District of Columbia", "DC"],
] as const);

export const customerBiteSaverStateCodes = Object.freeze(
  stateEntries.map(([, code]) => code),
);

const normalizedStateMap = new Map<string, string>();
for (const [name, code] of stateEntries) {
  normalizedStateMap.set(name.toLowerCase(), code);
  normalizedStateMap.set(code.toLowerCase(), code);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): void {
  const allowed = new Set(required);
  if (
    required.some((key) => !hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
}

function requireOpaqueRequestId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value)
  ) {
    throw new CustomerBiteSaverContractError(
      "invalid-argument",
      `${label} is invalid.`,
    );
  }
  return value;
}

function normalizeLocationText(value: unknown, maximumScalars: number): string {
  if (
    typeof value !== "string" ||
    !hasWellFormedCustomerBiteSaverUtf16(value)
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const result = value.trim().replace(/\s+/gu, " ");
  if (
    result.length === 0 ||
    Array.from(result).length > maximumScalars ||
    Buffer.byteLength(result, "utf8") > maximumScalars * 4
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  return result;
}

export function canonicalCustomerBiteSaverState(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/gu, " ").toLowerCase();
  return normalizedStateMap.get(normalized) ?? null;
}

export function normalizeCustomerBiteSaverCity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function parseTypedLocation(
  value: unknown,
  mode: CustomerBiteSaverLocationMode,
): CustomerBiteSaverTypedLocation | null {
  if (mode === "current") {
    if (value !== null) {
      throw new CustomerBiteSaverContractError("invalid-argument");
    }
    return null;
  }
  if (!isPlainRecord(value) || value.kind === undefined) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  if (value.kind === "zip") {
    requireExactKeys(value, ["kind", "zip"]);
    if (typeof value.zip !== "string" || !/^\d{5}(?:-\d{4})?$/u.test(value.zip)) {
      throw new CustomerBiteSaverContractError("invalid-argument");
    }
    return Object.freeze({kind: "zip", zip: value.zip});
  }
  if (value.kind === "city") {
    requireExactKeys(value, ["kind", "city", "state"]);
    const city = normalizeCustomerBiteSaverCity(
      normalizeLocationText(value.city, 100),
    );
    const state = value.state === null
      ? null
      : canonicalCustomerBiteSaverState(value.state);
    if (value.state !== null && state === null) {
      throw new CustomerBiteSaverContractError("invalid-argument");
    }
    return Object.freeze({kind: "city", city, state});
  }
  throw new CustomerBiteSaverContractError("invalid-argument");
}

function requireIanaTimeZone(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 100
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  try {
    const canonical = new Intl.DateTimeFormat("en-US", {timeZone: value})
      .resolvedOptions().timeZone;
    if (canonical.length === 0) {
      throw new Error("invalid");
    }
    return canonical;
  } catch {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
}

function timeZoneUtcOffsetMinutes(timeZone: string, instantMs: number): number {
  if (!Number.isSafeInteger(instantMs) || instantMs < 0) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  const parts = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instantMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const civilAsUtc = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month")) - 1,
    Number(parts.get("day")),
    Number(parts.get("hour")),
    Number(parts.get("minute")),
  );
  const offset = (civilAsUtc - Math.floor(instantMs / 60_000) * 60_000) /
    60_000;
  if (!Number.isSafeInteger(offset) || offset < -840 || offset > 840) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  return offset;
}

const supportedOffsetsByTimeZone = new Map<string, ReadonlySet<number>>();

function timeZoneSupportsUtcOffset(
  timeZone: string,
  offsetMinutes: number,
): boolean {
  let supported = supportedOffsetsByTimeZone.get(timeZone);
  if (supported === undefined) {
    const values = new Set<number>();
    // `utcOffsetMinutes` is corroborative metadata; IANA `timeZone` is the
    // authoritative availability clock. Sample a fixed broad window so both
    // seasonal offsets validate without making an identical replay depend on
    // the server date at which it happens to arrive.
    for (let year = 2000; year <= 2040; year += 1) {
      for (let month = 0; month < 12; month += 1) {
        values.add(timeZoneUtcOffsetMinutes(
          timeZone,
          Date.UTC(year, month, 15, 12),
        ));
      }
    }
    supported = values;
    supportedOffsetsByTimeZone.set(timeZone, supported);
  }
  return supported.has(offsetMinutes);
}

export function parseCustomerBiteSaverStartRequest(
  value: unknown,
): CustomerBiteSaverStartRequest {
  if (!isPlainRecord(value)) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  requireExactKeys(value, [
    "schemaVersion",
    "clientRequestId",
    "clientInstanceId",
    "latitude",
    "longitude",
    "radiusMiles",
    "locationMode",
    "typedLocation",
    "searchText",
    "timeZone",
    "utcOffsetMinutes",
    "freshSearch",
  ]);
  if (value.schemaVersion !== customerBiteSaverSearchSchemaVersion) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  if (
    typeof value.latitude !== "number" ||
    typeof value.longitude !== "number" ||
    validRestaurantCoordinates(value.latitude, value.longitude) === null
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  if (
    typeof value.radiusMiles !== "number" ||
    !Number.isInteger(value.radiusMiles) ||
    !(supportedCustomerBiteSaverRadii as readonly number[]).includes(
      value.radiusMiles,
    )
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  if (value.locationMode !== "current" && value.locationMode !== "typed") {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  let searchText: string;
  try {
    searchText = requireCustomerBiteSaverSearchText(value.searchText);
  } catch {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  if (
    typeof value.utcOffsetMinutes !== "number" ||
    !Number.isInteger(value.utcOffsetMinutes) ||
    value.utcOffsetMinutes < -840 ||
    value.utcOffsetMinutes > 840 ||
    typeof value.freshSearch !== "boolean"
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const timeZone = requireIanaTimeZone(value.timeZone);
  if (!timeZoneSupportsUtcOffset(timeZone, value.utcOffsetMinutes as number)) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: requireOpaqueRequestId(
      value.clientRequestId,
      "Client request ID",
    ),
    clientInstanceId: requireOpaqueRequestId(
      value.clientInstanceId,
      "Client instance ID",
    ),
    latitude: value.latitude,
    longitude: value.longitude,
    radiusMiles: value.radiusMiles as CustomerBiteSaverRadius,
    locationMode: value.locationMode,
    typedLocation: parseTypedLocation(value.typedLocation, value.locationMode),
    searchText,
    timeZone,
    utcOffsetMinutes: value.utcOffsetMinutes,
    freshSearch: value.freshSearch,
  });
}

/** Lossless, deterministic binary64 spelling, including the sign of zero. */
export function customerBiteSaverBinary64(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeDoubleBE(value, 0);
  return buffer.toString("hex");
}

export function canonicalCustomerBiteSaverCriteria(
  request: CustomerBiteSaverStartRequest,
): CustomerBiteSaverCanonicalCriteria {
  return Object.freeze({
    searchProtocolVersion: customerBiteSaverSearchProtocolVersion,
    restaurantProjectionVersion: customerBiteSaverRestaurantProjectionVersion,
    offerProjectionVersion: customerBiteSaverOfferProjectionVersion,
    matcherVersion: customerBiteSaverMatcherVersion,
    normalizerVersion: customerBiteSaverNormalizerVersion,
    eligibilityPolicyVersion: customerBiteSaverEligibilityPolicyVersion,
    distanceRankingVersion: customerBiteSaverDistanceRankingVersion,
    nameOrderVersion: customerBiteSaverNameOrderVersion,
    offerOrderVersion: customerBiteSaverOfferOrderVersion,
    latitudeBinary64: customerBiteSaverBinary64(request.latitude),
    longitudeBinary64: customerBiteSaverBinary64(request.longitude),
    latitude: request.latitude,
    longitude: request.longitude,
    radiusMiles: request.radiusMiles,
    locationMode: request.locationMode,
    typedLocation: request.typedLocation,
    normalizedSearchQuery: normalizeCustomerBiteSaverSearchText(
      request.searchText,
    ),
    staticFilters: Object.freeze({
      source: "biteSaver",
      publicVisible: true,
      customerDiscoverable: true,
    }),
    timeZone: request.timeZone,
    utcOffsetMinutes: request.utcOffsetMinutes,
  });
}

function fingerprintCriteria(
  criteria: CustomerBiteSaverCanonicalCriteria,
): Readonly<Record<string, unknown>> {
  const {
    latitude,
    longitude,
    ...fingerprinted
  } = criteria;
  void latitude;
  void longitude;
  return fingerprinted;
}

export function createCustomerBiteSaverCriteriaFingerprint(
  criteria: CustomerBiteSaverCanonicalCriteria,
): string {
  return createQueryFingerprint(fingerprintCriteria(criteria));
}

export function createCustomerBiteSaverMembershipFingerprint(value: {
  criteria: CustomerBiteSaverCanonicalCriteria;
  attemptGeneration: number;
  catalogGenerationVector: readonly number[];
}): string {
  if (
    !Number.isSafeInteger(value.attemptGeneration) ||
    value.attemptGeneration < 0 ||
    value.catalogGenerationVector.length !==
      customerBiteSaverCatalogGenerationShardCount ||
    value.catalogGenerationVector.some((entry) =>
      !Number.isSafeInteger(entry) || entry < 0)
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  return createQueryFingerprint({
    ...fingerprintCriteria(value.criteria),
    attemptGeneration: value.attemptGeneration,
    catalogGenerationVector: value.catalogGenerationVector,
  });
}

export function customerBiteSaverGenerationShardId(index: number): string {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= customerBiteSaverCatalogGenerationShardCount
  ) {
    throw new RangeError("Catalog generation shard is invalid.");
  }
  return `shard_${index.toString(16).padStart(2, "0")}`;
}

export function customerBiteSaverGenerationShardForIdentity(
  canonicalInternalIdentity: string,
): number {
  if (canonicalInternalIdentity.length === 0) {
    throw new Error("Catalog identity is invalid.");
  }
  const digest = createHash("sha256")
    .update(`${customerBiteSaverSearchProtocolVersion}\0catalogShard\0`, "utf8")
    .update(canonicalInternalIdentity, "utf16le")
    .digest();
  return digest[0] & 0x0f;
}

export function customerBiteSaverExactLocationPreference(value: {
  typedLocation: CustomerBiteSaverTypedLocation | null;
  restaurantCity: unknown;
  restaurantState: unknown;
  restaurantZipCode: unknown;
}): boolean {
  const typed = value.typedLocation;
  if (typed === null) {
    return false;
  }
  if (typed.kind === "zip") {
    return typeof value.restaurantZipCode === "string" &&
      value.restaurantZipCode.trim() === typed.zip;
  }
  if (
    typeof value.restaurantCity !== "string" ||
    normalizeCustomerBiteSaverCity(value.restaurantCity) !==
      normalizeCustomerBiteSaverCity(typed.city)
  ) {
    return false;
  }
  if (typed.state === null) {
    return true;
  }
  return canonicalCustomerBiteSaverState(value.restaurantState) === typed.state;
}

export function requireCustomerBiteSaverCapability(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new CustomerBiteSaverContractError("permission-denied");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    throw new CustomerBiteSaverContractError("permission-denied");
  }
  return value;
}

export function requireCustomerBiteSaverSessionId(value: unknown): string {
  if (typeof value !== "string" || !/^bss_[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new CustomerBiteSaverContractError("not-found");
  }
  return value;
}

export function requireCustomerBiteSaverPublicId(
  value: unknown,
  prefix: "bsr" | "bso",
): string {
  if (
    typeof value !== "string" ||
    !new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`, "u").test(value)
  ) {
    throw new CustomerBiteSaverContractError("invalid-argument");
  }
  return value;
}
