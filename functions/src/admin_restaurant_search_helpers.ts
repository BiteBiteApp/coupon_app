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

export type AdminRestaurantSource = "biteScore" | "biteSaver";

export const adminRestaurantSources: readonly AdminRestaurantSource[] = [
  "biteScore",
  "biteSaver",
];
export const adminRestaurantPerBoundCandidateLimit = 15;
export const defaultAdminRestaurantResultLimit = 50;
export const maximumAdminRestaurantResultLimit = 100;
export const maximumAdminRestaurantRadiusMiles =
  MAX_RESTAURANT_SEARCH_RADIUS_KM / KILOMETERS_PER_MILE;
export const adminGeocodingTimeoutMilliseconds = 5_000;

const maximumLocationQueryLength = 100;
const maximumRestaurantNameLength = 100;
const googleGeocodingEndpoint =
  "https://maps.googleapis.com/maps/api/geocode/json";
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
  requiresActiveRestaurant: boolean;
  candidateLimit: number;
};

export type AdminRestaurantQueryDocument = {
  documentId: string;
  data: RestaurantDocumentData;
};

export type AdminRestaurantSearchCandidate = AdminRestaurantQueryDocument & {
  source: AdminRestaurantSource;
};

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
  ownerUserId?: string | null;
  linkedBiteSaverUid?: string | null;
  approvalStatus?: string;
  couponApplicationSubmitted?: boolean;
  uid?: string | null;
  linkedBiteScoreRestaurantId?: string | null;
};

export type AdminRestaurantSearchResponse = {
  searchCenter: ResolvedAdminRestaurantSearchCenter;
  radiusMiles: number;
  results: AdminRestaurantSearchResult[];
  resultsMayBeTruncated: boolean;
  returnedCount: number;
  queriedSources: AdminRestaurantSource[];
};

export type AdminGeocodingResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

export type AdminGeocodingFetch = (
  url: string,
  init: { method: "GET"; signal: AbortSignal },
) => Promise<AdminGeocodingResponse>;

export type AdminRestaurantSearchDependencies = {
  getGeocodingApiKey: () => string;
  fetchGeocoding: AdminGeocodingFetch;
  executeQueryPlan: (
    plan: AdminRestaurantQueryPlan,
  ) => Promise<AdminRestaurantQueryDocument[]>;
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

function validateRestaurantName(value: unknown): {
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
  if (restaurantName.length > maximumRestaurantNameLength) {
    throw new HttpsError(
      "invalid-argument",
      "Restaurant name must be no more than 100 characters.",
    );
  }
  return {
    restaurantName,
    normalizedRestaurantName: normalizeAdminRestaurantName(restaurantName),
  };
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

  const name = validateRestaurantName(data.restaurantName);
  return {
    center,
    radiusMiles,
    restaurantName: name.restaurantName,
    normalizedRestaurantName: name.normalizedRestaurantName,
    sources: validateSources(data.sources),
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

function countryCodeFromGeocodingResult(
  result: Record<string, unknown>,
): string | null {
  if (!Array.isArray(result.address_components)) {
    return null;
  }
  for (const rawComponent of result.address_components) {
    const component = readRecord(rawComponent);
    if (!component || !Array.isArray(component.types)) {
      continue;
    }
    if (!component.types.includes("country")) {
      continue;
    }
    return typeof component.short_name === "string"
      ? component.short_name.trim().toUpperCase()
      : null;
  }
  return null;
}

function parseGeocodingPayload(
  payload: unknown,
  fallbackDisplayName: string,
): ResolvedAdminRestaurantSearchCenter {
  const record = readRecord(payload);
  const status = record?.status;
  if (!record || typeof status !== "string") {
    throw safeGeocodingError(
      "internal",
      "Location lookup returned an invalid response.",
    );
  }
  if (status === "ZERO_RESULTS") {
    throw safeGeocodingError(
      "not-found",
      "No matching United States location was found.",
    );
  }
  if (status !== "OK") {
    throw safeGeocodingError(
      "unavailable",
      "Location lookup is temporarily unavailable.",
    );
  }
  if (!Array.isArray(record.results)) {
    throw safeGeocodingError(
      "internal",
      "Location lookup returned an invalid response.",
    );
  }
  if (record.results.length === 0) {
    throw safeGeocodingError(
      "not-found",
      "No matching United States location was found.",
    );
  }

  let sawNonUsResult = false;
  let sawMalformedResult = false;
  let sawInvalidUsCoordinates = false;
  for (const rawResult of record.results) {
    const result = readRecord(rawResult);
    if (!result) {
      sawMalformedResult = true;
      continue;
    }
    const countryCode = countryCodeFromGeocodingResult(result);
    if (!countryCode) {
      sawMalformedResult = true;
      continue;
    }
    if (countryCode !== "US") {
      sawNonUsResult = true;
      continue;
    }

    const geometry = readRecord(result.geometry);
    const location = readRecord(geometry?.location);
    const coordinates = extractValidatedCoordinates(
      location?.lat,
      location?.lng,
    );
    if (!coordinates) {
      sawInvalidUsCoordinates = true;
      continue;
    }
    const formattedAddress =
      typeof result.formatted_address === "string"
        ? normalizedDisplayText(result.formatted_address)
        : "";
    return {
      ...coordinates,
      displayName: formattedAddress || fallbackDisplayName,
    };
  }

  if (sawInvalidUsCoordinates || sawMalformedResult) {
    throw safeGeocodingError(
      "internal",
      "Location lookup returned an invalid response.",
    );
  }
  if (sawNonUsResult) {
    throw safeGeocodingError(
      "not-found",
      "No matching United States location was found.",
    );
  }
  throw safeGeocodingError(
    "internal",
    "Location lookup returned an invalid response.",
  );
}

export async function geocodeAdminLocationQuery(
  locationQuery: string,
  apiKey: string,
  fetchGeocoding: AdminGeocodingFetch,
  timeoutMilliseconds = adminGeocodingTimeoutMilliseconds,
): Promise<ResolvedAdminRestaurantSearchCenter> {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw safeGeocodingError(
      "failed-precondition",
      "Typed location search is not configured.",
    );
  }

  const url = new URL(googleGeocodingEndpoint);
  url.searchParams.set("address", locationQuery);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("region", "us");
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  let didTimeout = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(new Error("geocoding-timeout"));
    }, Math.max(1, timeoutMilliseconds));
  });
  const clearRequestTimeout = () => {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };

  let response: AdminGeocodingResponse;
  try {
    response = await Promise.race([
      fetchGeocoding(url.toString(), {
        method: "GET",
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
  } catch (_error) {
    clearRequestTimeout();
    throw safeGeocodingError(
      didTimeout ? "deadline-exceeded" : "unavailable",
      didTimeout
        ? "Location lookup timed out. Please try again."
        : "Location lookup is temporarily unavailable.",
    );
  }

  if (!response.ok) {
    clearRequestTimeout();
    throw safeGeocodingError(
      "unavailable",
      "Location lookup is temporarily unavailable.",
    );
  }

  let payload: unknown;
  try {
    payload = await Promise.race([response.json(), timeoutPromise]);
  } catch (_error) {
    throw safeGeocodingError(
      didTimeout ? "deadline-exceeded" : "internal",
      didTimeout
        ? "Location lookup timed out. Please try again."
        : "Location lookup returned an invalid response.",
    );
  } finally {
    clearRequestTimeout();
  }
  const resolved = parseGeocodingPayload(payload, locationQuery);
  return resolved.displayName.includes(apiKey)
    ? { ...resolved, displayName: locationQuery }
    : resolved;
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
        requiresActiveRestaurant: source === "biteScore",
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
): AdminRestaurantSearchResult | null {
  const documentId = candidate.documentId.trim();
  if (!documentId) {
    return null;
  }
  const data = candidate.data;
  if (candidate.source === "biteScore" && data.isActive !== true) {
    return null;
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
    return {
      ...common,
      source: "biteScore",
      // The stored compatibility `id` is deliberately ignored. Admin actions
      // must route to the actual Firestore document that produced this row.
      actionId: documentId,
      isActive: true,
      isClaimed: data.isClaimed === true,
      ownerUserId: readString(data.ownerUserId),
      linkedBiteSaverUid: readString(data.linkedBiteSaverUid),
    };
  }

  const uid = readString(data.uid);
  return {
    ...common,
    source: "biteSaver",
    actionId: uid ?? documentId,
    approvalStatus: readString(data.approvalStatus) ?? "",
    couponApplicationSubmitted: data.couponApplicationSubmitted === true,
    uid,
    linkedBiteScoreRestaurantId: readString(
      data.linkedBiteScoreRestaurantId,
    ),
  };
}

export function processAdminRestaurantSearchCandidates(params: {
  request: ValidatedAdminRestaurantSearchRequest;
  searchCenter: ResolvedAdminRestaurantSearchCenter;
  candidates: readonly AdminRestaurantSearchCandidate[];
  anyQueryReachedCandidateLimit: boolean;
}): AdminRestaurantSearchResponse {
  const deduplicated = new Map<string, AdminRestaurantSearchCandidate>();
  for (const candidate of params.candidates) {
    const documentId = candidate.documentId.trim();
    if (!documentId) {
      continue;
    }
    const key = restaurantSourceDocumentKey(candidate.source, documentId);
    if (!deduplicated.has(key)) {
      deduplicated.set(key, { ...candidate, documentId });
    }
  }

  const exactMatches: AdminRestaurantSearchResult[] = [];
  for (const candidate of deduplicated.values()) {
    const mapped = mapCandidate(candidate, params.searchCenter);
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

  return processAdminRestaurantSearchCandidates({
    request,
    searchCenter,
    candidates,
    anyQueryReachedCandidateLimit,
  });
}
