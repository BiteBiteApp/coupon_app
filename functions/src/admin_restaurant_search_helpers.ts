import { HttpsError } from "firebase-functions/v2/https";
import {
  exactRestaurantDistanceKilometers,
  extractBiteSaverRestaurantCoordinates,
  extractBiteScoreRestaurantCoordinates,
  KILOMETERS_PER_MILE,
  MAX_RESTAURANT_SEARCH_RADIUS_KM,
  RestaurantCoordinates,
  RestaurantDocumentData,
  restaurantGeographicQueryBounds,
  restaurantSourceDocumentKey,
} from "./restaurant_geo_helpers.js";
import {
  defaultRestaurantGeocodingTimeoutMilliseconds,
  geocodeGoogleUsSearchCenter,
  RestaurantGeocodingError,
  type RestaurantGeocodingFetch,
  type RestaurantGeocodingResponse,
} from "./restaurant_geocoding.js";
import {
  biteSaverCatalogBindingAdminState,
  biteScoreRestaurantClaimProjection,
  type BiteSaverCatalogBindingAdminState,
} from "./search_index_builders.js";
import {
  biteSaverAccountCatalogBindingState,
  biteScoreCatalogBindingState,
  biteScoreCatalogRestaurantIdField,
  readBiteScoreCatalogRestaurantId,
} from "./restaurant_invite_helpers.js";
import {
  type AdminRestaurantQrPreparationStoredDocument,
  type AdminRestaurantQrPreparationProjection,
  parseAdminRestaurantQrPreparationDocument,
  projectAdminRestaurantQrPreparation,
  unavailableAdminRestaurantQrPreparationProjection,
  validateAdminRestaurantQrPreparedClaimAssociation,
  validateAdminRestaurantQrPreparedOwnerAssociation,
} from "./admin_restaurant_qr_preparation.js";

export type AdminRestaurantSource = "biteScore" | "biteSaver";
export type AdminBiteScoreStatus = "active" | "inactive" | "all";

export const adminRestaurantSources: readonly AdminRestaurantSource[] = [
  "biteScore",
  "biteSaver",
];
export const adminRestaurantPerBoundCandidateLimit = 15;
export const defaultAdminRestaurantResultLimit = 50;
export const maximumAdminRestaurantResultLimit = 100;
export const maximumAdminRestaurantRadiusMiles =
  MAX_RESTAURANT_SEARCH_RADIUS_KM / KILOMETERS_PER_MILE;
export const adminGeocodingTimeoutMilliseconds =
  defaultRestaurantGeocodingTimeoutMilliseconds;
const adminRestaurantPreparationInvitationBatchSize = 100;

const maximumLocationQueryLength = 100;
export const maximumAdminRestaurantNameFilterLength = 100;
const usStateCodes = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

type TypedAdminRestaurantSearchCenter = {
  mode: "typed";
  locationQuery: string;
};

type CoordinateAdminRestaurantSearchCenter = {
  mode: "coordinates";
  coordinates: RestaurantCoordinates;
};

export type AdminRestaurantSearchCenterInput =
  | TypedAdminRestaurantSearchCenter
  | CoordinateAdminRestaurantSearchCenter;

export type ValidatedAdminRestaurantSearchRequest = {
  center: AdminRestaurantSearchCenterInput;
  radiusMiles: number;
  restaurantName: string | null;
  normalizedRestaurantName: string | null;
  sources: AdminRestaurantSource[];
  biteScoreStatus: AdminBiteScoreStatus;
  resultLimit: number;
};

export type ResolvedAdminRestaurantSearchCenter = RestaurantCoordinates & {
  displayName: string;
};

export type AdminRestaurantQueryPlan = {
  source: AdminRestaurantSource;
  collectionName: "bitescore_restaurants" | "restaurant_accounts";
  geohashStart: string;
  geohashEnd: string;
  biteScoreIsActive: boolean | null;
  candidateLimit: number;
};

export type AdminRestaurantQueryDocument = {
  documentId: string;
  data: RestaurantDocumentData;
};

export type AdminRestaurantSearchCandidate = AdminRestaurantQueryDocument & {
  source: AdminRestaurantSource;
};

export type AdminCatalogBindingVerificationRequest = Readonly<{
  catalogRestaurantId: string;
  biteSaverCatalogBindingId: string | null;
}>;

export function verifiedAdminBiteSaverCatalogIdsFromDocuments(params: {
  requests: readonly AdminCatalogBindingVerificationRequest[];
  accountDocuments: readonly Readonly<Record<string, unknown>>[];
  saturatedCatalogRestaurantIds?: ReadonlySet<string>;
}): ReadonlySet<string> {
  const expectedBindings = new Map<string, string | null>();
  const contradictoryRequests = new Set<string>();
  for (const request of params.requests) {
    const hasExisting = expectedBindings.has(request.catalogRestaurantId);
    const existing = expectedBindings.get(request.catalogRestaurantId);
    if (
      hasExisting &&
      existing !== request.biteSaverCatalogBindingId
    ) {
      contradictoryRequests.add(request.catalogRestaurantId);
    } else {
      expectedBindings.set(
        request.catalogRestaurantId,
        request.biteSaverCatalogBindingId,
      );
    }
  }

  const accountDocumentsByCatalogId = new Map<
    string,
    Readonly<Record<string, unknown>>[]
  >();
  for (const data of params.accountDocuments) {
    const catalogRestaurantId = readBiteScoreCatalogRestaurantId(
      data[biteScoreCatalogRestaurantIdField],
    );
    if (
      catalogRestaurantId === null ||
      !expectedBindings.has(catalogRestaurantId)
    ) {
      continue;
    }
    const matches = accountDocumentsByCatalogId.get(catalogRestaurantId) ?? [];
    accountDocumentsByCatalogId.set(catalogRestaurantId, [...matches, data]);
  }

  const verifiedCatalogRestaurantIds = new Set<string>();
  for (const [catalogRestaurantId, expectedBindingId] of expectedBindings) {
    if (
      contradictoryRequests.has(catalogRestaurantId) ||
      params.saturatedCatalogRestaurantIds?.has(catalogRestaurantId)
    ) {
      continue;
    }
    const matches = accountDocumentsByCatalogId.get(catalogRestaurantId) ?? [];
    if (expectedBindingId === null) {
      if (matches.length === 0) {
        verifiedCatalogRestaurantIds.add(catalogRestaurantId);
      }
      continue;
    }
    if (matches.length !== 1) {
      continue;
    }
    const binding = biteSaverAccountCatalogBindingState(matches[0]);
    if (
      binding.type === "bound" &&
      binding.biteScoreCatalogRestaurantId === catalogRestaurantId &&
      binding.biteSaverCatalogBindingId === expectedBindingId
    ) {
      verifiedCatalogRestaurantIds.add(catalogRestaurantId);
    }
  }
  return verifiedCatalogRestaurantIds;
}

export type AdminRestaurantSearchResult = {
  source: AdminRestaurantSource;
  documentId: string;
  actionId: string;
  restaurantName: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  website: string;
  latitude: number;
  longitude: number;
  distanceMiles: number;
  isActive?: boolean;
  isClaimed?: boolean;
  claimAvailable?: boolean;
  claimStateValid?: boolean;
  biteSaverCatalogBindingState?: BiteSaverCatalogBindingAdminState;
  ownerUserId?: string | null;
  linkedBiteSaverUid?: string | null;
  approvalStatus?: string;
  couponApplicationSubmitted?: boolean;
  uid?: string | null;
  linkedBiteScoreRestaurantId?: string | null;
  preparation?: AdminRestaurantQrPreparationProjection;
};

export type AdminRestaurantSearchResponse = {
  searchCenter: ResolvedAdminRestaurantSearchCenter;
  radiusMiles: number;
  results: AdminRestaurantSearchResult[];
  resultsMayBeTruncated: boolean;
  returnedCount: number;
  queriedSources: AdminRestaurantSource[];
};

export type AdminGeocodingResponse = RestaurantGeocodingResponse;
export type AdminGeocodingFetch = RestaurantGeocodingFetch;

export type AdminRestaurantSearchDependencies = {
  getGeocodingApiKey: () => string;
  fetchGeocoding: AdminGeocodingFetch;
  executeQueryPlan: (
    plan: AdminRestaurantQueryPlan,
  ) => Promise<AdminRestaurantQueryDocument[]>;
  verifyBiteSaverCatalogBindings?: (
    requests: readonly AdminCatalogBindingVerificationRequest[],
  ) => Promise<ReadonlySet<string>>;
  loadQrPreparationDocuments?: (
    catalogRestaurantIds: readonly string[],
  ) => Promise<
    ReadonlyMap<string, Readonly<Record<string, unknown>>>
  >;
  loadQrPreparationInvitationDocuments?: (
    invitationIds: readonly string[],
  ) => Promise<
    ReadonlyMap<string, Readonly<Record<string, unknown>>>
  >;
  geocodingTimeoutMilliseconds?: number;
};

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeAdminRestaurantName(value: string): string {
  return normalizedDisplayText(value).normalize("NFKC").toLowerCase();
}

function titleCaseCity(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s.'-])([a-z])/g, (_match, prefix: string, letter: string) =>
      `${prefix}${letter.toUpperCase()}`,
    );
}

export function normalizeAdminLocationQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "Location must be a five-digit ZIP code or City, ST.",
    );
  }

  const normalized = normalizedDisplayText(value).replace(/\s*,\s*/g, ", ");
  if (!normalized || normalized.length > maximumLocationQueryLength) {
    throw new HttpsError(
      "invalid-argument",
      "Location must be a five-digit ZIP code or City, ST.",
    );
  }
  if (/^\d{5}$/.test(normalized)) {
    return normalized;
  }

  const cityStateMatch = normalized.match(
    /^([A-Za-z](?:[A-Za-z .'-]*[A-Za-z.])?),\s*([A-Za-z]{2})$/,
  );
  if (!cityStateMatch) {
    throw new HttpsError(
      "invalid-argument",
      "Location must be a five-digit ZIP code or City, ST.",
    );
  }

  const state = cityStateMatch[2].toUpperCase();
  if (!usStateCodes.has(state)) {
    throw new HttpsError(
      "invalid-argument",
      "Location must use a valid two-letter US state abbreviation.",
    );
  }
  return `${titleCaseCity(cityStateMatch[1])}, ${state}`;
}

function validateSources(value: unknown): AdminRestaurantSource[] {
  if (value === undefined) {
    return [...adminRestaurantSources];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "Sources must include biteScore, biteSaver, or both.",
    );
  }

  const selected = new Set<AdminRestaurantSource>();
  for (const entry of value) {
    if (entry !== "biteScore" && entry !== "biteSaver") {
      throw new HttpsError(
        "invalid-argument",
        "Sources may contain only biteScore and biteSaver.",
      );
    }
    selected.add(entry);
  }
  return adminRestaurantSources.filter((source) => selected.has(source));
}

function validateBiteScoreStatus(
  value: unknown,
  sources: readonly AdminRestaurantSource[],
): AdminBiteScoreStatus {
  if (value === undefined) {
    return "active";
  }
  if (value !== "active" && value !== "inactive" && value !== "all") {
    throw new HttpsError(
      "invalid-argument",
      "BiteScore status must be active, inactive, or all.",
    );
  }
  if (!sources.includes("biteScore")) {
    throw new HttpsError(
      "invalid-argument",
      "BiteScore status may be supplied only when BiteScore is requested.",
    );
  }
  return value;
}

export function validateAdminRestaurantNameFilter(value: unknown): {
  restaurantName: string | null;
  normalizedRestaurantName: string | null;
} {
  if (value === undefined || value === null) {
    return { restaurantName: null, normalizedRestaurantName: null };
  }
  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "Restaurant name must be text when provided.",
    );
  }

  const restaurantName = normalizedDisplayText(value);
  if (!restaurantName) {
    return { restaurantName: null, normalizedRestaurantName: null };
  }
  const normalizedRestaurantName = normalizeAdminRestaurantName(
    restaurantName,
  );
  if (
    !normalizedRestaurantName ||
    normalizedRestaurantName.length > maximumAdminRestaurantNameFilterLength
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Restaurant name must be no more than 100 characters.",
    );
  }
  // Persisted session criteria must reparse to the identical filter value.
  if (
    normalizeAdminRestaurantName(normalizedRestaurantName) !==
      normalizedRestaurantName
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Restaurant name contains unsupported text.",
    );
  }
  return {
    restaurantName,
    normalizedRestaurantName,
  };
}

export function readNormalizedAdminRestaurantNameFilter(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const validated = validateAdminRestaurantNameFilter(value);
    return validated.restaurantName === value &&
        validated.normalizedRestaurantName === value
      ? value
      : null;
  } catch (_error) {
    return null;
  }
}

export function validateAdminRestaurantSearchRequest(
  value: unknown,
): ValidatedAdminRestaurantSearchRequest {
  const data = readRecord(value) ?? {};
  const hasLocationQuery = hasOwn(data, "locationQuery");
  const hasLatitude = hasOwn(data, "latitude");
  const hasLongitude = hasOwn(data, "longitude");
  const hasCoordinateInput = hasLatitude || hasLongitude;

  if (hasLocationQuery === hasCoordinateInput) {
    throw new HttpsError(
      "invalid-argument",
      "Provide exactly one search center: locationQuery or latitude and longitude.",
    );
  }

  let center: AdminRestaurantSearchCenterInput;
  if (hasLocationQuery) {
    center = {
      mode: "typed",
      locationQuery: normalizeAdminLocationQuery(data.locationQuery),
    };
  } else {
    if (!hasLatitude || !hasLongitude) {
      throw new HttpsError(
        "invalid-argument",
        "Both latitude and longitude are required for coordinate search.",
      );
    }
    const coordinates = validCoordinateInput(data.latitude, data.longitude);
    center = { mode: "coordinates", coordinates };
  }

  const radiusMiles = data.radiusMiles;
  if (
    typeof radiusMiles !== "number" ||
    !Number.isFinite(radiusMiles) ||
    radiusMiles <= 0 ||
    radiusMiles > maximumAdminRestaurantRadiusMiles
  ) {
    throw new HttpsError(
      "invalid-argument",
      `Radius must be a finite number greater than zero and no greater than ${maximumAdminRestaurantRadiusMiles} miles.`,
    );
  }

  const resultLimitValue = data.resultLimit;
  const resultLimit =
    resultLimitValue === undefined
      ? defaultAdminRestaurantResultLimit
      : resultLimitValue;
  if (
    typeof resultLimit !== "number" ||
    !Number.isInteger(resultLimit) ||
    resultLimit < 1 ||
    resultLimit > maximumAdminRestaurantResultLimit
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Result limit must be an integer from 1 through 100.",
    );
  }

  const name = validateAdminRestaurantNameFilter(data.restaurantName);
  const sources = validateSources(data.sources);
  return {
    center,
    radiusMiles,
    restaurantName: name.restaurantName,
    normalizedRestaurantName: name.normalizedRestaurantName,
    sources,
    biteScoreStatus: validateBiteScoreStatus(data.biteScoreStatus, sources),
    resultLimit,
  };
}

function validCoordinateInput(
  latitude: unknown,
  longitude: unknown,
): RestaurantCoordinates {
  const coordinates = extractValidatedCoordinates(latitude, longitude);
  if (!coordinates) {
    throw new HttpsError(
      "invalid-argument",
      "Valid latitude and longitude are required for coordinate search.",
    );
  }
  return coordinates;
}

function extractValidatedCoordinates(
  latitude: unknown,
  longitude: unknown,
): RestaurantCoordinates | null {
  return extractBiteSaverRestaurantCoordinates({ latitude, longitude });
}

function safeGeocodingError(
  code: "deadline-exceeded" | "failed-precondition" | "internal" | "not-found" | "unavailable",
  message: string,
): HttpsError {
  return new HttpsError(code, message);
}

function adminSearchGeocodingError(error: unknown): HttpsError {
  if (!(error instanceof RestaurantGeocodingError)) {
    return safeGeocodingError(
      "unavailable",
      "Location lookup is temporarily unavailable.",
    );
  }
  switch (error.kind) {
    case "missing-configuration":
      return safeGeocodingError(
        "failed-precondition",
        "Typed location search is not configured.",
      );
    case "timeout":
      return safeGeocodingError(
        "deadline-exceeded",
        "Location lookup timed out. Please try again.",
      );
    case "provider-unavailable":
      return safeGeocodingError(
        "unavailable",
        "Location lookup is temporarily unavailable.",
      );
    case "no-result":
      return safeGeocodingError(
        "not-found",
        "No matching United States location was found.",
      );
    case "malformed-response":
      return safeGeocodingError(
        "internal",
        "Location lookup returned an invalid response.",
      );
    default:
      return safeGeocodingError(
        "unavailable",
        "Location lookup is temporarily unavailable.",
      );
  }
}

export async function geocodeAdminLocationQuery(
  locationQuery: string,
  apiKey: string,
  fetchGeocoding: AdminGeocodingFetch,
  timeoutMilliseconds = adminGeocodingTimeoutMilliseconds,
): Promise<ResolvedAdminRestaurantSearchCenter> {
  try {
    const resolved = await geocodeGoogleUsSearchCenter(
      locationQuery,
      apiKey,
      fetchGeocoding,
      timeoutMilliseconds,
    );
    const displayName = resolved.formattedAddress ?? locationQuery;
    return {
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      displayName: displayName.includes(apiKey) ? locationQuery : displayName,
    };
  } catch (error) {
    throw adminSearchGeocodingError(error);
  }
}

export async function resolveAdminRestaurantSearchCenter(
  center: AdminRestaurantSearchCenterInput,
  dependencies: Pick<
    AdminRestaurantSearchDependencies,
    | "fetchGeocoding"
    | "getGeocodingApiKey"
    | "geocodingTimeoutMilliseconds"
  >,
): Promise<ResolvedAdminRestaurantSearchCenter> {
  if (center.mode === "coordinates") {
    return {
      ...center.coordinates,
      displayName:
        `${center.coordinates.latitude.toFixed(6)}, ` +
        center.coordinates.longitude.toFixed(6),
    };
  }

  let apiKey: string;
  try {
    apiKey = dependencies.getGeocodingApiKey();
  } catch (_error) {
    throw safeGeocodingError(
      "failed-precondition",
      "Typed location search is not configured.",
    );
  }
  return geocodeAdminLocationQuery(
    center.locationQuery,
    apiKey,
    dependencies.fetchGeocoding,
    dependencies.geocodingTimeoutMilliseconds,
  );
}

export function buildAdminRestaurantQueryPlans(
  center: RestaurantCoordinates,
  radiusMiles: number,
  sources: readonly AdminRestaurantSource[],
  biteScoreStatus: AdminBiteScoreStatus = "active",
): AdminRestaurantQueryPlan[] {
  const bounds = restaurantGeographicQueryBounds(
    center,
    radiusMiles * KILOMETERS_PER_MILE,
  );
  const plans: AdminRestaurantQueryPlan[] = [];
  for (const source of sources) {
    for (const [geohashStart, geohashEnd] of bounds) {
      plans.push({
        source,
        collectionName:
          source === "biteScore"
            ? "bitescore_restaurants"
            : "restaurant_accounts",
        geohashStart,
        geohashEnd,
        biteScoreIsActive:
          source !== "biteScore" || biteScoreStatus === "all"
            ? null
            : biteScoreStatus === "active",
        // Every individual range is capped so the maximum read fan-out is
        // predictable even when GeoFire returns overlapping query bounds.
        candidateLimit: adminRestaurantPerBoundCandidateLimit,
      });
    }
  }
  return plans;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && normalizedDisplayText(value)
    ? normalizedDisplayText(value)
    : null;
}

function readOptionalExactIdentity(
  data: RestaurantDocumentData,
  fieldName: string,
): string | null | undefined {
  if (
    !Object.prototype.hasOwnProperty.call(data, fieldName) ||
    data[fieldName] === null ||
    data[fieldName] === ""
  ) {
    return null;
  }
  return readBiteScoreCatalogRestaurantId(data[fieldName]) ?? undefined;
}

function firstString(
  data: RestaurantDocumentData,
  fieldNames: readonly string[],
): string {
  for (const fieldName of fieldNames) {
    const value = readString(data[fieldName]);
    if (value) {
      return value;
    }
  }
  return "";
}

function compareText(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  if (first > second) {
    return 1;
  }
  return 0;
}

function mapCandidate(
  candidate: AdminRestaurantSearchCandidate,
  center: RestaurantCoordinates,
  biteScoreStatus: AdminBiteScoreStatus,
  verifiedBiteSaverCatalogIds: ReadonlySet<string>,
): AdminRestaurantSearchResult | null {
  const documentId = readBiteScoreCatalogRestaurantId(candidate.documentId);
  if (documentId === null) {
    return null;
  }
  const data = candidate.data;
  const storedIsActive = data.isActive;
  if (candidate.source === "biteScore") {
    if (typeof storedIsActive !== "boolean") {
      return null;
    }
    if (biteScoreStatus === "active" && storedIsActive !== true) {
      return null;
    }
    if (biteScoreStatus === "inactive" && storedIsActive !== false) {
      return null;
    }
  }
  const coordinates =
    candidate.source === "biteScore"
      ? extractBiteScoreRestaurantCoordinates(data)
      : extractBiteSaverRestaurantCoordinates(data);
  if (!coordinates) {
    return null;
  }

  const distanceMiles =
    exactRestaurantDistanceKilometers(center, coordinates) /
    KILOMETERS_PER_MILE;
  const restaurantName =
    candidate.source === "biteScore"
      ? firstString(data, ["name", "restaurantName", "restaurant_name"])
      : firstString(data, ["restaurantName", "name"]);
  const common = {
    source: candidate.source,
    documentId,
    restaurantName,
    streetAddress:
      candidate.source === "biteScore"
        ? firstString(data, [
            "streetAddress",
            "address",
            "formattedAddress",
            "fullAddress",
          ])
        : firstString(data, ["streetAddress", "address"]),
    city:
      candidate.source === "biteScore"
        ? firstString(data, ["city", "locality", "municipality", "town"])
        : firstString(data, ["city"]),
    state:
      candidate.source === "biteScore"
        ? firstString(data, [
            "state",
            "stateCode",
            "state_name",
            "region",
            "province",
          ])
        : firstString(data, ["state"]),
    zipCode:
      candidate.source === "biteScore"
        ? firstString(data, [
            "zipCode",
            "zip",
            "zip_code",
            "postalCode",
            "postcode",
          ])
        : firstString(data, ["zipCode", "zip"]),
    phone:
      candidate.source === "biteScore"
        ? firstString(data, ["phone", "phoneNumber"])
        : firstString(data, ["phone"]),
    website:
      candidate.source === "biteScore"
        ? firstString(data, ["website", "websiteUrl", "url"])
        : firstString(data, ["website"]),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    distanceMiles,
  };

  if (candidate.source === "biteScore") {
    const claim = biteScoreRestaurantClaimProjection(data);
    const ownerUserId = readOptionalExactIdentity(data, "ownerUserId");
    const linkedBiteSaverUid = readOptionalExactIdentity(
      data,
      "linkedBiteSaverUid",
    );
    if (ownerUserId === undefined || linkedBiteSaverUid === undefined) {
      return null;
    }
    return {
      ...common,
      source: "biteScore",
      // The stored compatibility `id` is deliberately ignored. Admin actions
      // must route to the actual Firestore document that produced this row.
      actionId: documentId,
      isActive: storedIsActive as boolean,
      ...claim,
      biteSaverCatalogBindingState: biteSaverCatalogBindingAdminState(
        documentId,
        data,
        verifiedBiteSaverCatalogIds.has(documentId),
      ),
      ownerUserId,
      linkedBiteSaverUid,
    };
  }

  const uid = readOptionalExactIdentity(data, "uid");
  const linkedBiteScoreRestaurantId = readOptionalExactIdentity(
    data,
    "linkedBiteScoreRestaurantId",
  );
  if (uid === undefined || linkedBiteScoreRestaurantId === undefined) {
    return null;
  }
  return {
    ...common,
    source: "biteSaver",
    actionId: uid ?? documentId,
    approvalStatus: readString(data.approvalStatus) ?? "",
    couponApplicationSubmitted: data.couponApplicationSubmitted === true,
    uid,
    linkedBiteScoreRestaurantId,
  };
}

function exactCandidatesByKey(
  candidates: readonly AdminRestaurantSearchCandidate[],
): ReadonlyMap<string, AdminRestaurantSearchCandidate> {
  const candidatesByKey = new Map<string, AdminRestaurantSearchCandidate>();
  for (const candidate of candidates) {
    const documentId = readBiteScoreCatalogRestaurantId(candidate.documentId);
    if (documentId === null) {
      continue;
    }
    const key = restaurantSourceDocumentKey(candidate.source, documentId);
    if (!candidatesByKey.has(key)) {
      candidatesByKey.set(key, { ...candidate, documentId });
    }
  }
  return candidatesByKey;
}

export function processAdminRestaurantSearchCandidates(params: {
  request: ValidatedAdminRestaurantSearchRequest;
  searchCenter: ResolvedAdminRestaurantSearchCenter;
  candidates: readonly AdminRestaurantSearchCandidate[];
  anyQueryReachedCandidateLimit: boolean;
  verifiedBiteSaverCatalogIds?: ReadonlySet<string>;
}): AdminRestaurantSearchResponse {
  const verifiedBiteSaverCatalogIds =
    params.verifiedBiteSaverCatalogIds ?? new Set<string>();
  const deduplicated = exactCandidatesByKey(params.candidates);

  const exactMatches: AdminRestaurantSearchResult[] = [];
  for (const candidate of deduplicated.values()) {
    const mapped = mapCandidate(
      candidate,
      params.searchCenter,
      params.request.biteScoreStatus,
      verifiedBiteSaverCatalogIds,
    );
    if (!mapped || mapped.distanceMiles > params.request.radiusMiles) {
      continue;
    }
    if (
      params.request.normalizedRestaurantName &&
      !normalizeAdminRestaurantName(mapped.restaurantName).includes(
        params.request.normalizedRestaurantName,
      )
    ) {
      continue;
    }
    exactMatches.push(mapped);
  }

  exactMatches.sort((first, second) => {
    const byDistance = first.distanceMiles - second.distanceMiles;
    if (byDistance !== 0) {
      return byDistance;
    }
    const byName = compareText(
      normalizeAdminRestaurantName(first.restaurantName),
      normalizeAdminRestaurantName(second.restaurantName),
    );
    if (byName !== 0) {
      return byName;
    }
    const byDocumentId = compareText(first.documentId, second.documentId);
    return byDocumentId !== 0
      ? byDocumentId
      : compareText(first.source, second.source);
  });

  const resultLimitTruncated = exactMatches.length > params.request.resultLimit;
  const results = exactMatches.slice(0, params.request.resultLimit);
  return {
    searchCenter: params.searchCenter,
    radiusMiles: params.request.radiusMiles,
    results,
    resultsMayBeTruncated:
      params.anyQueryReachedCandidateLimit || resultLimitTruncated,
    returnedCount: results.length,
    queriedSources: [...params.request.sources],
  };
}

export async function attachAdminRestaurantQrPreparation(
  response: AdminRestaurantSearchResponse,
  dependencies: Pick<
    AdminRestaurantSearchDependencies,
    "loadQrPreparationDocuments" | "loadQrPreparationInvitationDocuments"
  >,
  candidatesByKey: ReadonlyMap<string, AdminRestaurantSearchCandidate>,
): Promise<AdminRestaurantSearchResponse> {
  if (dependencies.loadQrPreparationDocuments === undefined) {
    return response;
  }
  const canonicalIds = [
    ...new Set(
      response.results
        .filter((result) => result.source === "biteScore")
        .map((result) => result.documentId),
    ),
  ];
  let documents: ReadonlyMap<
    string,
    Readonly<Record<string, unknown>>
  >;
  try {
    documents = await dependencies.loadQrPreparationDocuments(canonicalIds);
  } catch (_error) {
    throw new HttpsError(
      "unavailable",
      "Restaurant preparation state is temporarily unavailable.",
    );
  }
  const nowMillis = Date.now();
  const preparedInviteIds = [
    ...new Set(
      response.results
        .filter((result) => result.source === "biteScore")
        .map((result) => documents.get(result.documentId) ?? null)
        .flatMap((rawPreparation) => {
          const parsed = parseAdminRestaurantQrPreparationDocument(
            rawPreparation,
          );
          return [parsed?.iPrepared?.id, parsed?.cPrepared?.id];
        })
        .filter((inviteId): inviteId is string => typeof inviteId === "string"),
    ),
  ];
  if (
    preparedInviteIds.length > maximumAdminRestaurantResultLimit * 2
  ) {
    throw new HttpsError(
      "unavailable",
      "Restaurant preparation state is temporarily unavailable.",
    );
  }
  let invitationDocuments = new Map<
    string,
    Readonly<Record<string, unknown>>
  >();
  if (
    preparedInviteIds.length > 0 &&
    dependencies.loadQrPreparationInvitationDocuments !== undefined
  ) {
    try {
      invitationDocuments = new Map();
      for (
        let offset = 0;
        offset < preparedInviteIds.length;
        offset += adminRestaurantPreparationInvitationBatchSize
      ) {
        const batch = preparedInviteIds.slice(
          offset,
          offset + adminRestaurantPreparationInvitationBatchSize,
        );
        const loaded = await dependencies
          .loadQrPreparationInvitationDocuments(batch);
        for (const [invitationId, invitation] of loaded) {
          invitationDocuments.set(invitationId, invitation);
        }
      }
    } catch (_error) {
      throw new HttpsError(
        "unavailable",
        "Restaurant preparation state is temporarily unavailable.",
      );
    }
  }
  return {
    ...response,
    results: response.results.map((result) => {
      if (result.source !== "biteScore") {
        return {
          ...result,
          preparation: unavailableAdminRestaurantQrPreparationProjection(),
        };
      }
      const biteSaverParticipation =
        result.biteSaverCatalogBindingState === "bound"
          ? "bound" as const
          : result.biteSaverCatalogBindingState === "unbound"
          ? "unbound" as const
          : "unavailable" as const;
      const biteScoreClaim =
        result.isActive === true &&
          result.claimStateValid === true &&
          result.isClaimed === true &&
          result.claimAvailable === false
          ? "claimed" as const
          : result.isActive === true &&
            result.claimStateValid === true &&
            result.isClaimed === false &&
            result.claimAvailable === true
          ? "available" as const
          : "unavailable" as const;
      const rawPreparation = documents.get(result.documentId) ?? null;
      const parsedPreparation =
        parseAdminRestaurantQrPreparationDocument(rawPreparation);
      const preparedOwnerInviteId = parsedPreparation?.iPrepared?.id ?? null;
      const preparedClaimInviteId = parsedPreparation?.cPrepared?.id ?? null;
      const ownerInvitationData = preparedOwnerInviteId === null
        ? undefined
        : invitationDocuments.get(preparedOwnerInviteId);
      const ownerInvitation: AdminRestaurantQrPreparationStoredDocument | null =
        preparedOwnerInviteId !== null && ownerInvitationData !== undefined
          ? Object.freeze({
              id: preparedOwnerInviteId,
              data: ownerInvitationData,
            })
          : null;
      const invitationData = preparedClaimInviteId === null
        ? undefined
        : invitationDocuments.get(preparedClaimInviteId);
      const invitation: AdminRestaurantQrPreparationStoredDocument | null =
        preparedClaimInviteId !== null && invitationData !== undefined
          ? Object.freeze({
              id: preparedClaimInviteId,
              data: invitationData,
            })
          : null;
      const candidate = candidatesByKey.get(
        restaurantSourceDocumentKey(result.source, result.documentId),
      );
      const claimPreparedValidation = candidate === undefined
        ? Object.freeze({ state: "unavailable" as const, inviteId: null })
        : validateAdminRestaurantQrPreparedClaimAssociation({
            catalogRestaurantId: result.documentId,
            rawPreparation,
            restaurantData: candidate.data,
            invitation,
            nowMillis,
          });
      const ownerPreparedValidation = candidate === undefined
        ? Object.freeze({ state: "unavailable" as const, inviteId: null })
        : validateAdminRestaurantQrPreparedOwnerAssociation({
            catalogRestaurantId: result.documentId,
            rawPreparation,
            restaurantData: candidate.data,
            invitation: ownerInvitation,
            nowMillis,
          });
      return {
        ...result,
        preparation: projectAdminRestaurantQrPreparation({
          catalogRestaurantId: result.documentId,
          rawPreparation,
          biteSaverParticipation,
          biteScoreClaim,
          ownerPreparedValidation,
          claimPreparedValidation,
          nowMillis,
        }),
      };
    }),
  };
}

export async function rehydrateAdminRestaurantSearchPage(params: Readonly<{
  request: ValidatedAdminRestaurantSearchRequest;
  searchCenter: ResolvedAdminRestaurantSearchCenter;
  candidates: readonly AdminRestaurantSearchCandidate[];
  dependencies: Pick<
    AdminRestaurantSearchDependencies,
    | "verifyBiteSaverCatalogBindings"
    | "loadQrPreparationDocuments"
    | "loadQrPreparationInvitationDocuments"
  >;
}>): Promise<AdminRestaurantSearchResponse> {
  const candidatesByKey = exactCandidatesByKey(params.candidates);
  let response = processAdminRestaurantSearchCandidates({
    request: params.request,
    searchCenter: params.searchCenter,
    candidates: params.candidates,
    anyQueryReachedCandidateLimit: false,
  });
  if (params.dependencies.verifyBiteSaverCatalogBindings !== undefined) {
    const verificationRequests: AdminCatalogBindingVerificationRequest[] = [];
    for (const result of response.results) {
      if (result.source !== "biteScore") {
        continue;
      }
      const candidate = candidatesByKey.get(
        restaurantSourceDocumentKey(result.source, result.documentId),
      );
      if (candidate === undefined) {
        continue;
      }
      const binding = biteScoreCatalogBindingState(candidate.data);
      const locallyConsistentState = biteSaverCatalogBindingAdminState(
        result.documentId,
        candidate.data,
        true,
      );
      if (locallyConsistentState !== "unavailable") {
        verificationRequests.push(Object.freeze({
          catalogRestaurantId: result.documentId,
          biteSaverCatalogBindingId: binding.type === "bound"
            ? binding.biteSaverCatalogBindingId
            : null,
        }));
      }
    }
    if (verificationRequests.length > 0) {
      try {
        const verifiedBiteSaverCatalogIds =
          await params.dependencies.verifyBiteSaverCatalogBindings(
            verificationRequests,
          );
        response = processAdminRestaurantSearchCandidates({
          request: params.request,
          searchCenter: params.searchCenter,
          candidates: params.candidates,
          anyQueryReachedCandidateLimit: false,
          verifiedBiteSaverCatalogIds,
        });
      } catch (_error) {
        // Binding-dependent actions fail closed in the unverified projection.
      }
    }
  }

  const projectedByKey = new Map(
    response.results.map((result) => [
      restaurantSourceDocumentKey(result.source, result.documentId),
      result,
    ]),
  );
  const orderedResults = params.candidates.flatMap((candidate) => {
    const result = projectedByKey.get(
      restaurantSourceDocumentKey(candidate.source, candidate.documentId),
    );
    return result === undefined ? [] : [result];
  });
  return attachAdminRestaurantQrPreparation(
    {
      ...response,
      results: orderedResults,
      returnedCount: orderedResults.length,
      resultsMayBeTruncated: false,
    },
    params.dependencies,
    candidatesByKey,
  );
}

export async function executeAdminRestaurantSearch(
  rawRequest: unknown,
  dependencies: AdminRestaurantSearchDependencies,
): Promise<AdminRestaurantSearchResponse> {
  const request = validateAdminRestaurantSearchRequest(rawRequest);
  const searchCenter = await resolveAdminRestaurantSearchCenter(
    request.center,
    dependencies,
  );
  const plans = buildAdminRestaurantQueryPlans(
    searchCenter,
    request.radiusMiles,
    request.sources,
    request.biteScoreStatus,
  );

  let queryDocuments: AdminRestaurantQueryDocument[][];
  try {
    queryDocuments = await Promise.all(
      plans.map((plan) => dependencies.executeQueryPlan(plan)),
    );
  } catch (_error) {
    throw new HttpsError(
      "unavailable",
      "Restaurant search is temporarily unavailable.",
    );
  }

  let anyQueryReachedCandidateLimit = false;
  const candidates: AdminRestaurantSearchCandidate[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const documents = queryDocuments[index];
    if (documents.length >= plan.candidateLimit) {
      anyQueryReachedCandidateLimit = true;
    }
    for (const document of documents.slice(0, plan.candidateLimit)) {
      candidates.push({ ...document, source: plan.source });
    }
  }

  const baseResponse = processAdminRestaurantSearchCandidates({
    request,
    searchCenter,
    candidates,
    anyQueryReachedCandidateLimit,
  });
  const candidatesByKey = exactCandidatesByKey(candidates);
  if (dependencies.verifyBiteSaverCatalogBindings === undefined) {
    return attachAdminRestaurantQrPreparation(
      baseResponse,
      dependencies,
      candidatesByKey,
    );
  }

  const verificationRequests: AdminCatalogBindingVerificationRequest[] = [];
  for (const result of baseResponse.results) {
    if (result.source !== "biteScore") {
      continue;
    }
    const candidate = candidatesByKey.get(
      restaurantSourceDocumentKey(result.source, result.documentId),
    );
    if (candidate === undefined) {
      continue;
    }
    const binding = biteScoreCatalogBindingState(candidate.data);
    const locallyConsistentState = biteSaverCatalogBindingAdminState(
      result.documentId,
      candidate.data,
      true,
    );
    if (locallyConsistentState !== "unavailable") {
      verificationRequests.push(Object.freeze({
        catalogRestaurantId: result.documentId,
        biteSaverCatalogBindingId: binding.type === "bound"
          ? binding.biteSaverCatalogBindingId
          : null,
      }));
    }
  }
  if (verificationRequests.length === 0) {
    return attachAdminRestaurantQrPreparation(
      baseResponse,
      dependencies,
      candidatesByKey,
    );
  }

  let verifiedBiteSaverCatalogIds: ReadonlySet<string>;
  try {
    verifiedBiteSaverCatalogIds =
      await dependencies.verifyBiteSaverCatalogBindings(verificationRequests);
  } catch (_error) {
    return attachAdminRestaurantQrPreparation(
      baseResponse,
      dependencies,
      candidatesByKey,
    );
  }
  const verifiedResponse = processAdminRestaurantSearchCandidates({
    request,
    searchCenter,
    candidates,
    anyQueryReachedCandidateLimit,
    verifiedBiteSaverCatalogIds,
  });
  return attachAdminRestaurantQrPreparation(
    verifiedResponse,
    dependencies,
    candidatesByKey,
  );
}
