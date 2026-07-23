import { createHash } from "node:crypto";
import {
  exactRestaurantDistanceKilometers,
  validRestaurantCoordinates,
  type RestaurantCoordinates,
} from "./restaurant_geo_helpers.js";

export const defaultRestaurantGeocodingTimeoutMilliseconds = 5_000;
export const maximumRestaurantGeocodingTimeoutMilliseconds = 15_000;

const googleGeocodingEndpoint =
  "https://maps.googleapis.com/maps/api/geocode/json";
const maximumStreetAddressLength = 200;
const maximumCityLength = 100;
const maximumProviderFormattedAddressLength = 500;
const unsupportedControlCharacterPattern = /[\p{Cc}\p{Cf}]/u;

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

const structuredAddressFields = [
  "streetAddress",
  "city",
  "state",
  "zipCode",
] as const;

const strictRestaurantResultTypes = new Set([
  "street_address",
  "premise",
  "subpremise",
  "establishment",
]);

// Mailing-city policy: trust only city-like components returned for the
// selected result. Comparison removes punctuation/diacritics and applies only
// conservative Saint/St, Fort/Ft, Mount/Mt, and direction aliases—never fuzzy
// or substring matching.
const cityComponentTypes = new Set([
  "locality",
  "postal_town",
  "sublocality",
  "sublocality_level_1",
  "administrative_area_level_3",
]);

export type StructuredUsRestaurantAddress = {
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
};

export type StrictRestaurantGeocodingResult =
  StructuredUsRestaurantAddress &
    RestaurantCoordinates & {
      formattedAddress: string;
      addressFingerprint: string;
    };

export type RestaurantGeocodingResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

export type RestaurantGeocodingFetch = (
  url: string,
  init: { method: "GET"; signal: AbortSignal },
) => Promise<RestaurantGeocodingResponse>;

export type RestaurantGeocodingDependencies = {
  getGeocodingApiKey: () => string;
  fetchGeocoding: RestaurantGeocodingFetch;
  timeoutMilliseconds?: number;
};

export type RestaurantGeocodingErrorKind =
  | "invalid-input"
  | "missing-configuration"
  | "timeout"
  | "provider-unavailable"
  | "no-result"
  | "malformed-response"
  | "untrustworthy-result"
  | "ambiguous-result";

export type RestaurantGeocodingErrorCode =
  | "invalid-argument"
  | "failed-precondition"
  | "deadline-exceeded"
  | "unavailable"
  | "not-found"
  | "internal";

const errorDefinitions: Record<
  RestaurantGeocodingErrorKind,
  { code: RestaurantGeocodingErrorCode; message: string }
> = {
  "invalid-input": {
    code: "invalid-argument",
    message: "A complete United States restaurant address is required.",
  },
  "missing-configuration": {
    code: "failed-precondition",
    message: "Restaurant address lookup is not configured.",
  },
  timeout: {
    code: "deadline-exceeded",
    message: "Restaurant address lookup timed out. Please try again.",
  },
  "provider-unavailable": {
    code: "unavailable",
    message: "Restaurant address lookup is temporarily unavailable.",
  },
  "no-result": {
    code: "not-found",
    message: "No matching United States restaurant address was found.",
  },
  "malformed-response": {
    code: "internal",
    message: "Restaurant address lookup returned an invalid response.",
  },
  "untrustworthy-result": {
    code: "failed-precondition",
    message:
      "The address could not be verified as a precise United States street address.",
  },
  "ambiguous-result": {
    code: "failed-precondition",
    message:
      "Multiple matching addresses were found. Please enter a more specific address.",
  },
};

export class RestaurantGeocodingError extends Error {
  readonly code: RestaurantGeocodingErrorCode;
  readonly kind: RestaurantGeocodingErrorKind;

  constructor(kind: RestaurantGeocodingErrorKind, message?: string) {
    const definition = errorDefinitions[kind];
    super(message ?? definition.message);
    this.name = "RestaurantGeocodingError";
    this.code = definition.code;
    this.kind = kind;
  }
}

type ProviderSecondaryUnitComponentKind = "floor" | "room" | "subpremise";

type ParsedProviderSecondaryUnitComponent = {
  kind: ProviderSecondaryUnitComponentKind;
  values: string[];
};

type ParsedAddressComponents = {
  firstCountryCode: string | null;
  countryCodes: string[];
  stateCodes: string[];
  zipCodes: string[];
  cityNames: string[];
  streetNumbers: string[];
  routes: string[];
  routeComponentCount: number;
  secondaryUnits: ParsedProviderSecondaryUnitComponent[];
};

type ParsedGoogleGeocodingCandidate = {
  malformed: boolean;
  formattedAddress: string;
  formattedAddressHadControlCharacters: boolean;
  partialMatch: boolean;
  partialMatchMalformed: boolean;
  resultTypes: string[];
  locationType: string | null;
  coordinates: RestaurantCoordinates | null;
  components: ParsedAddressComponents | null;
};

type ValidatedStrictCandidate = {
  candidate: ParsedGoogleGeocodingCandidate;
  coordinates: RestaurantCoordinates;
  baseStreetKey: string;
  unitKey: string | null;
  qualityRank: number;
};

type StrictCandidateDecision =
  | { type: "valid"; value: ValidatedStrictCandidate }
  | { type: "non-us" }
  | { type: "malformed" }
  | { type: "untrustworthy" };

function geocodingError(
  kind: RestaurantGeocodingErrorKind,
  message?: string,
): RestaurantGeocodingError {
  return new RestaurantGeocodingError(kind, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collapsedDisplayText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizedInputText(value: string): string {
  return collapsedDisplayText(value.normalize("NFKC"));
}

function normalizeInputField(params: {
  value: unknown;
  label: string;
  maximumLength: number;
  maximumRawLength: number;
}): string {
  if (typeof params.value !== "string") {
    throw geocodingError("invalid-input", `${params.label} is required.`);
  }
  if (params.value.length > params.maximumRawLength) {
    throw geocodingError(
      "invalid-input",
      `${params.label} must be no more than ${params.maximumLength} characters.`,
    );
  }
  if (unsupportedControlCharacterPattern.test(params.value)) {
    throw geocodingError(
      "invalid-input",
      `${params.label} contains unsupported control characters.`,
    );
  }
  const normalized = normalizedInputText(params.value);
  if (!normalized) {
    throw geocodingError("invalid-input", `${params.label} is required.`);
  }
  if (normalized.length > params.maximumLength) {
    throw geocodingError(
      "invalid-input",
      `${params.label} must be no more than ${params.maximumLength} characters.`,
    );
  }
  return normalized;
}

export function normalizeStructuredUsRestaurantAddress(
  value: unknown,
): StructuredUsRestaurantAddress {
  if (!isRecord(value)) {
    throw geocodingError("invalid-input");
  }

  const keys = Object.keys(value);
  if (
    keys.length !== structuredAddressFields.length ||
    keys.some(
      (key) =>
        !structuredAddressFields.includes(
          key as (typeof structuredAddressFields)[number],
        ),
    )
  ) {
    throw geocodingError(
      "invalid-input",
      "Restaurant address contains unsupported or missing fields.",
    );
  }

  const streetAddress = normalizeInputField({
    value: value.streetAddress,
    label: "Street address",
    maximumLength: maximumStreetAddressLength,
    maximumRawLength: maximumStreetAddressLength * 4,
  });
  const city = normalizeInputField({
    value: value.city,
    label: "City",
    maximumLength: maximumCityLength,
    maximumRawLength: maximumCityLength * 4,
  });
  const state = normalizeInputField({
    value: value.state,
    label: "State",
    maximumLength: 2,
    maximumRawLength: 16,
  }).toUpperCase();
  const zipCode = normalizeInputField({
    value: value.zipCode,
    label: "ZIP code",
    maximumLength: 5,
    maximumRawLength: 20,
  });

  if (!/^[A-Z]{2}$/u.test(state) || !usStateCodes.has(state)) {
    throw geocodingError(
      "invalid-input",
      "State must be a valid two-letter US abbreviation.",
    );
  }
  if (!/^\d{5}$/u.test(zipCode)) {
    throw geocodingError(
      "invalid-input",
      "ZIP code must be exactly five digits.",
    );
  }

  return { streetAddress, city, state, zipCode };
}

function fingerprintText(value: string): string {
  return normalizedInputText(value).toLowerCase();
}

function lengthPrefixed(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function fingerprintNormalizedAddress(
  address: StructuredUsRestaurantAddress,
): string {
  const canonical = [
    "v1",
    lengthPrefixed(fingerprintText(address.streetAddress)),
    lengthPrefixed(fingerprintText(address.city)),
    lengthPrefixed(address.state),
    lengthPrefixed(address.zipCode),
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createRestaurantAddressFingerprint(value: unknown): string {
  return fingerprintNormalizedAddress(
    normalizeStructuredUsRestaurantAddress(value),
  );
}

function readProviderString(value: unknown, apiKey: string): string {
  if (typeof value !== "string") {
    return "";
  }
  // Keep provider display text byte-for-byte compatible with the pre-existing
  // admin search policy: trim and collapse whitespace, but do not apply NFKC.
  const normalized = collapsedDisplayText(value);
  return normalized.includes(apiKey) ? "" : normalized;
}

function addUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function providerZipCode(value: string): string {
  const match = value.match(/^(\d{5})(?:-\d{4})?$/u);
  return match?.[1] ?? value;
}

function parseAddressComponents(
  value: unknown,
  apiKey: string,
): ParsedAddressComponents | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: ParsedAddressComponents = {
    firstCountryCode: null,
    countryCodes: [],
    stateCodes: [],
    zipCodes: [],
    cityNames: [],
    streetNumbers: [],
    routes: [],
    routeComponentCount: 0,
    secondaryUnits: [],
  };
  let sawCountryComponent = false;

  for (const rawComponent of value) {
    if (!isRecord(rawComponent) || !Array.isArray(rawComponent.types)) {
      continue;
    }
    const types = rawComponent.types.filter(
      (entry): entry is string => typeof entry === "string",
    );
    const longName = readProviderString(rawComponent.long_name, apiKey);
    const shortName = readProviderString(rawComponent.short_name, apiKey);

    if (types.includes("country")) {
      if (!sawCountryComponent) {
        parsed.firstCountryCode = shortName
          ? shortName.toUpperCase()
          : null;
        sawCountryComponent = true;
      }
      addUnique(parsed.countryCodes, (shortName || longName).toUpperCase());
    }
    if (types.includes("administrative_area_level_1")) {
      addUnique(parsed.stateCodes, (shortName || longName).toUpperCase());
    }
    if (types.includes("postal_code")) {
      const zipCode = providerZipCode(longName || shortName);
      addUnique(parsed.zipCodes, zipCode);
    }
    if (types.includes("street_number")) {
      addUnique(parsed.streetNumbers, longName || shortName);
    }
    if (types.includes("route")) {
      parsed.routeComponentCount += 1;
      addUnique(parsed.routes, longName);
      addUnique(parsed.routes, shortName);
    }
    for (const kind of [
      "subpremise",
      "floor",
      "room",
    ] as const satisfies readonly ProviderSecondaryUnitComponentKind[]) {
      if (types.includes(kind)) {
        const values: string[] = [];
        addUnique(values, longName);
        addUnique(values, shortName);
        parsed.secondaryUnits.push({ kind, values });
      }
    }
    if (types.some((type) => cityComponentTypes.has(type))) {
      addUnique(parsed.cityNames, longName);
      addUnique(parsed.cityNames, shortName);
    }
  }

  return parsed;
}

function parseCandidate(
  value: unknown,
  apiKey: string,
): ParsedGoogleGeocodingCandidate {
  if (!isRecord(value)) {
    return {
      malformed: true,
      formattedAddress: "",
      formattedAddressHadControlCharacters: false,
      partialMatch: false,
      partialMatchMalformed: false,
      resultTypes: [],
      locationType: null,
      coordinates: null,
      components: null,
    };
  }

  const rawFormattedAddress = value.formatted_address;
  const formattedAddressHadControlCharacters =
    typeof rawFormattedAddress === "string" &&
    unsupportedControlCharacterPattern.test(rawFormattedAddress);
  const formattedAddress = readProviderString(rawFormattedAddress, apiKey);
  const resultTypes = Array.isArray(value.types)
    ? value.types
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => readProviderString(entry, apiKey).toLowerCase())
        .filter((entry) => entry.length > 0)
    : [];
  const geometry = isRecord(value.geometry) ? value.geometry : null;
  const location = isRecord(geometry?.location) ? geometry.location : null;
  const coordinates = validRestaurantCoordinates(
    location?.lat,
    location?.lng,
  );
  const rawLocationType = readProviderString(
    geometry?.location_type,
    apiKey,
  );

  return {
    malformed: false,
    formattedAddress,
    formattedAddressHadControlCharacters,
    partialMatch: value.partial_match === true,
    partialMatchMalformed:
      value.partial_match !== undefined &&
      typeof value.partial_match !== "boolean",
    resultTypes,
    locationType: rawLocationType ? rawLocationType.toUpperCase() : null,
    coordinates,
    components: parseAddressComponents(value.address_components, apiKey),
  };
}

function boundedTimeoutMilliseconds(value: number | undefined): number {
  if (value === undefined || typeof value !== "number" || Number.isNaN(value)) {
    return defaultRestaurantGeocodingTimeoutMilliseconds;
  }
  return Math.min(
    Math.max(1, value),
    maximumRestaurantGeocodingTimeoutMilliseconds,
  );
}

async function requestGoogleGeocodingCandidates(
  addressQuery: string,
  dependencies: RestaurantGeocodingDependencies,
): Promise<ParsedGoogleGeocodingCandidate[]> {
  if (
    typeof addressQuery !== "string" ||
    !addressQuery.trim() ||
    addressQuery.length > 500
  ) {
    throw geocodingError("invalid-input");
  }

  let apiKey: string;
  try {
    apiKey = dependencies.getGeocodingApiKey();
  } catch (_error) {
    throw geocodingError("missing-configuration");
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw geocodingError("missing-configuration");
  }

  const url = new URL(googleGeocodingEndpoint);
  url.searchParams.set("address", addressQuery);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("region", "us");
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeoutMilliseconds = boundedTimeoutMilliseconds(
    dependencies.timeoutMilliseconds,
  );
  let didTimeout = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(geocodingError("timeout"));
    }, timeoutMilliseconds);
  });
  const clearRequestTimeout = () => {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };

  let response: RestaurantGeocodingResponse;
  try {
    response = await Promise.race([
      dependencies.fetchGeocoding(url.toString(), {
        method: "GET",
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
  } catch (_error) {
    clearRequestTimeout();
    throw geocodingError(didTimeout ? "timeout" : "provider-unavailable");
  }

  let responseOk: boolean;
  let readResponseJson: () => Promise<unknown>;
  try {
    const ok = response?.ok;
    const json = response?.json;
    if (typeof ok !== "boolean" || typeof json !== "function") {
      throw geocodingError("malformed-response");
    }
    responseOk = ok;
    readResponseJson = () => json.call(response);
  } catch (_error) {
    clearRequestTimeout();
    throw geocodingError("malformed-response");
  }
  if (!responseOk) {
    clearRequestTimeout();
    throw geocodingError("provider-unavailable");
  }

  let payload: unknown;
  try {
    payload = await Promise.race([readResponseJson(), timeoutPromise]);
  } catch (_error) {
    throw geocodingError(didTimeout ? "timeout" : "malformed-response");
  } finally {
    clearRequestTimeout();
  }

  if (!isRecord(payload) || typeof payload.status !== "string") {
    throw geocodingError("malformed-response");
  }
  if (payload.status === "ZERO_RESULTS") {
    throw geocodingError("no-result");
  }
  if (payload.status !== "OK") {
    throw geocodingError("provider-unavailable");
  }
  if (!Array.isArray(payload.results)) {
    throw geocodingError("malformed-response");
  }
  if (payload.results.length === 0) {
    throw geocodingError("no-result");
  }

  return payload.results.map((result) => parseCandidate(result, apiKey));
}

export async function geocodeGoogleUsSearchCenter(
  locationQuery: string,
  apiKey: string,
  fetchGeocoding: RestaurantGeocodingFetch,
  timeoutMilliseconds = defaultRestaurantGeocodingTimeoutMilliseconds,
): Promise<RestaurantCoordinates & { formattedAddress: string | null }> {
  const candidates = await requestGoogleGeocodingCandidates(locationQuery, {
    getGeocodingApiKey: () => apiKey,
    fetchGeocoding,
    timeoutMilliseconds,
  });

  let sawNonUsResult = false;
  let sawMalformedResult = false;
  let sawInvalidUsCoordinates = false;
  for (const candidate of candidates) {
    if (candidate.malformed || !candidate.components) {
      sawMalformedResult = true;
      continue;
    }
    const countryCode = candidate.components.firstCountryCode;
    if (!countryCode) {
      sawMalformedResult = true;
      continue;
    }
    if (countryCode !== "US") {
      sawNonUsResult = true;
      continue;
    }
    if (!candidate.coordinates) {
      sawInvalidUsCoordinates = true;
      continue;
    }
    return {
      ...candidate.coordinates,
      formattedAddress: candidate.formattedAddress || null,
    };
  }

  if (sawInvalidUsCoordinates || sawMalformedResult) {
    throw geocodingError("malformed-response");
  }
  if (sawNonUsResult) {
    throw geocodingError("no-result");
  }
  throw geocodingError("malformed-response");
}

function normalizedComparisonTokens(
  value: string,
  aliases: Readonly<Record<string, string>>,
): string[] {
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/#/gu, " unit ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\s+/u)
    .map((token) => aliases[token] ?? token);
}

const streetTokenAliases: Readonly<Record<string, string>> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  circle: "cir",
  court: "ct",
  drive: "dr",
  highway: "hwy",
  lane: "ln",
  parkway: "pkwy",
  place: "pl",
  road: "rd",
  route: "rte",
  terrace: "ter",
  trail: "trl",
};

const cityTokenAliases: Readonly<Record<string, string>> = {
  saint: "st",
  fort: "ft",
  mount: "mt",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
};

type SecondaryUnitKind =
  | "apartment"
  | "building"
  | "floor"
  | "room"
  | "subpremise"
  | "suite"
  | "unit";

const unitDesignatorKinds: Readonly<Record<string, SecondaryUnitKind>> = {
  apartment: "apartment",
  apt: "apartment",
  building: "building",
  bldg: "building",
  floor: "floor",
  fl: "floor",
  room: "room",
  rm: "room",
  subpremise: "subpremise",
  suite: "suite",
  ste: "suite",
  unit: "unit",
};
const unitDesignators = new Set(Object.keys(unitDesignatorKinds));
const subpremiseResultUnitKinds = new Set<SecondaryUnitKind>([
  "apartment",
  "subpremise",
  "suite",
  "unit",
]);

type SecondaryUnitIdentity = {
  kind: SecondaryUnitKind;
  valueKey: string;
};

type StreetIdentity = {
  baseStreetKey: string;
  unitKey: string | null;
};

function normalizedStreetComparisonTokens(value: string): string[] {
  return normalizedComparisonTokens(
    value.replace(/#/gu, " subpremise "),
    streetTokenAliases,
  );
}

function unitDesignatorKind(token: string): SecondaryUnitKind | null {
  return unitDesignators.has(token) ? unitDesignatorKinds[token] : null;
}

function requestedSecondaryUnitIdentity(
  tokens: string[],
): SecondaryUnitIdentity | null | undefined {
  if (tokens.length === 0) {
    return null;
  }

  const kind = unitDesignatorKind(tokens[0]);
  const valueTokens = tokens.slice(1);
  if (
    !kind ||
    kind === "building" ||
    valueTokens.length === 0 ||
    valueTokens.some((token) => unitDesignators.has(token))
  ) {
    return undefined;
  }
  return { kind, valueKey: valueTokens.join(" ") };
}

function providerSecondaryUnitAlias(
  value: string,
  componentKind: ProviderSecondaryUnitComponentKind,
): SecondaryUnitIdentity | null {
  const tokens = normalizedStreetComparisonTokens(value);
  if (tokens.length === 0) {
    return null;
  }

  const explicitKind = unitDesignatorKind(tokens[0]);
  const valueTokens = explicitKind ? tokens.slice(1) : tokens;
  if (
    explicitKind === "building" ||
    valueTokens.length === 0 ||
    valueTokens.some((token) => unitDesignators.has(token))
  ) {
    return null;
  }

  if (
    componentKind !== "subpremise" &&
    explicitKind !== null &&
    explicitKind !== componentKind
  ) {
    return null;
  }

  return {
    kind: componentKind === "subpremise"
      ? (explicitKind ?? "subpremise")
      : componentKind,
    valueKey: valueTokens.join(" "),
  };
}

function providerSecondaryUnitIdentity(
  components: ParsedAddressComponents,
): SecondaryUnitIdentity | null | undefined {
  if (components.secondaryUnits.length === 0) {
    return null;
  }
  // A single strict address identity cannot safely represent compound
  // subpremise/floor/room components.
  if (components.secondaryUnits.length !== 1) {
    return undefined;
  }

  const component = components.secondaryUnits[0];
  const aliases = component.values.map((value) =>
    providerSecondaryUnitAlias(value, component.kind),
  );
  if (aliases.length === 0 || aliases.some((alias) => alias === null)) {
    return undefined;
  }

  const parsedAliases = aliases as SecondaryUnitIdentity[];
  const valueKeys = new Set(parsedAliases.map((alias) => alias.valueKey));
  if (valueKeys.size !== 1) {
    return undefined;
  }

  const explicitKinds = [
    ...new Set(
      parsedAliases
        .map((alias) => alias.kind)
        .filter((kind) => kind !== "subpremise"),
    ),
  ];
  if (explicitKinds.length > 1) {
    return undefined;
  }
  return {
    kind: explicitKinds[0] ?? "subpremise",
    valueKey: parsedAliases[0].valueKey,
  };
}

function compatibleSecondaryUnitIdentity(
  requested: SecondaryUnitIdentity | null,
  provider: SecondaryUnitIdentity | null,
): SecondaryUnitIdentity | null | undefined {
  if (requested === null || provider === null) {
    return requested === provider ? null : undefined;
  }
  if (requested.valueKey !== provider.valueKey) {
    return undefined;
  }
  if (requested.kind === provider.kind) {
    return requested;
  }

  // A genuinely bare/# generic subpremise may inherit one explicit
  // suite/unit/apartment kind. Explicit kinds never alias each other, and
  // generic evidence never stands in for a floor or room.
  const genericCompatibleKinds = new Set<SecondaryUnitKind>([
    "apartment",
    "subpremise",
    "suite",
    "unit",
  ]);
  if (
    genericCompatibleKinds.has(requested.kind) &&
    genericCompatibleKinds.has(provider.kind) &&
    (requested.kind === "subpremise" || provider.kind === "subpremise")
  ) {
    return requested.kind === "subpremise" ? provider : requested;
  }
  return undefined;
}

function secondaryUnitKey(identity: SecondaryUnitIdentity | null): string | null {
  return identity ? `${identity.kind}:${identity.valueKey}` : null;
}

function secondaryUnitKindFromKey(
  unitKey: string | null,
): SecondaryUnitKind | null {
  if (unitKey === null) {
    return null;
  }
  const separatorIndex = unitKey.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  const kind = unitKey.slice(0, separatorIndex);
  return unitDesignatorKind(kind);
}

function providerStreetIdentity(
  components: ParsedAddressComponents,
  requestedStreetAddress: string,
): StreetIdentity | null {
  if (
    components.streetNumbers.length !== 1 ||
    components.routeComponentCount !== 1 ||
    components.routes.length === 0
  ) {
    return null;
  }

  const requestedTokens = normalizedStreetComparisonTokens(
    requestedStreetAddress,
  );
  const streetNumberTokens = normalizedStreetComparisonTokens(
    components.streetNumbers[0],
  );
  if (requestedTokens.length === 0 || streetNumberTokens.length === 0) {
    return null;
  }

  const matchedBaseLengths = components.routes
    .map((route) => normalizedStreetComparisonTokens(route))
    .filter((routeTokens) => routeTokens.length > 0)
    .map((routeTokens) => [...streetNumberTokens, ...routeTokens])
    .filter(
      (baseTokens) =>
        baseTokens.length <= requestedTokens.length &&
        baseTokens.every(
          (token, index) => requestedTokens[index] === token,
        ),
    )
    .map((baseTokens) => baseTokens.length);
  if (matchedBaseLengths.length === 0) {
    return null;
  }

  // A longer provider route alias is stronger evidence than interpreting its
  // trailing route tokens as a secondary unit.
  const matchedBaseLength = Math.max(...matchedBaseLengths);
  const requestedUnit = requestedSecondaryUnitIdentity(
    requestedTokens.slice(matchedBaseLength),
  );
  const providerUnit = providerSecondaryUnitIdentity(components);
  if (requestedUnit === undefined || providerUnit === undefined) {
    return null;
  }
  const resolvedUnit = compatibleSecondaryUnitIdentity(
    requestedUnit,
    providerUnit,
  );
  if (resolvedUnit === undefined) {
    return null;
  }

  return {
    baseStreetKey: requestedTokens.slice(0, matchedBaseLength).join(" "),
    unitKey: secondaryUnitKey(resolvedUnit),
  };
}

function comparableCity(value: string): string {
  return normalizedComparisonTokens(value, cityTokenAliases).join(" ");
}

function strictCandidateDecision(
  candidate: ParsedGoogleGeocodingCandidate,
  address: StructuredUsRestaurantAddress,
): StrictCandidateDecision {
  if (candidate.malformed || !candidate.components) {
    return { type: "malformed" };
  }
  const components = candidate.components;
  if (components.countryCodes.length === 0) {
    return { type: "malformed" };
  }
  if (
    components.countryCodes.length === 1 &&
    components.countryCodes[0] !== "US"
  ) {
    return { type: "non-us" };
  }
  if (
    components.countryCodes.length !== 1 ||
    components.countryCodes[0] !== "US" ||
    candidate.partialMatch ||
    candidate.partialMatchMalformed ||
    !candidate.coordinates ||
    components.stateCodes.length !== 1 ||
    components.stateCodes[0] !== address.state ||
    components.zipCodes.length !== 1 ||
    components.zipCodes[0] !== address.zipCode
  ) {
    return { type: "untrustworthy" };
  }

  const requestedCity = comparableCity(address.city);
  const providerCities = components.cityNames.map(comparableCity);
  if (!requestedCity || !providerCities.includes(requestedCity)) {
    return { type: "untrustworthy" };
  }

  const providerStreet = providerStreetIdentity(
    components,
    address.streetAddress,
  );
  if (!providerStreet) {
    return { type: "untrustworthy" };
  }

  const preciseResultTypes = candidate.resultTypes.filter((type) =>
    strictRestaurantResultTypes.has(type),
  );
  if (preciseResultTypes.length === 0) {
    return { type: "untrustworthy" };
  }
  const providerUnitKind = secondaryUnitKindFromKey(providerStreet.unitKey);
  if (
    preciseResultTypes.includes("subpremise") &&
    (providerUnitKind === null ||
      !subpremiseResultUnitKinds.has(providerUnitKind))
  ) {
    return { type: "untrustworthy" };
  }

  let qualityRank: number;
  if (candidate.locationType === "ROOFTOP") {
    qualityRank = 0;
  } else if (candidate.locationType === "RANGE_INTERPOLATED") {
    qualityRank = 1;
  } else if (
    candidate.locationType === "GEOMETRIC_CENTER" &&
    preciseResultTypes.some((type) =>
      ["premise", "subpremise", "establishment"].includes(type),
    )
  ) {
    qualityRank = 2;
  } else {
    return { type: "untrustworthy" };
  }

  if (
    !candidate.formattedAddress ||
    candidate.formattedAddressHadControlCharacters ||
    candidate.formattedAddress.length > maximumProviderFormattedAddressLength
  ) {
    return { type: "untrustworthy" };
  }

  return {
    type: "valid",
    value: {
      candidate,
      coordinates: candidate.coordinates,
      baseStreetKey: providerStreet.baseStreetKey,
      unitKey: providerStreet.unitKey,
      qualityRank,
    },
  };
}

function equivalentStrictCandidates(
  first: ValidatedStrictCandidate,
  second: ValidatedStrictCandidate,
): boolean {
  return (
    first.baseStreetKey === second.baseStreetKey &&
    first.unitKey === second.unitKey &&
    exactRestaurantDistanceKilometers(
      first.coordinates,
      second.coordinates,
    ) <= 0.05
  );
}

function selectStrictCandidate(
  candidates: ParsedGoogleGeocodingCandidate[],
  address: StructuredUsRestaurantAddress,
): ValidatedStrictCandidate {
  const validCandidates: ValidatedStrictCandidate[] = [];
  let sawNonUsResult = false;
  let sawMalformedResult = false;
  let sawUntrustworthyResult = false;

  for (const candidate of candidates) {
    const decision = strictCandidateDecision(candidate, address);
    switch (decision.type) {
      case "valid":
        validCandidates.push(decision.value);
        break;
      case "non-us":
        sawNonUsResult = true;
        break;
      case "malformed":
        sawMalformedResult = true;
        break;
      case "untrustworthy":
        sawUntrustworthyResult = true;
        break;
    }
  }

  if (validCandidates.length === 0) {
    if (sawUntrustworthyResult) {
      throw geocodingError("untrustworthy-result");
    }
    if (sawMalformedResult) {
      throw geocodingError("malformed-response");
    }
    if (sawNonUsResult) {
      throw geocodingError("no-result");
    }
    throw geocodingError("no-result");
  }

  for (let first = 0; first < validCandidates.length; first += 1) {
    for (
      let second = first + 1;
      second < validCandidates.length;
      second += 1
    ) {
      if (
        !equivalentStrictCandidates(
          validCandidates[first],
          validCandidates[second],
        )
      ) {
        throw geocodingError("ambiguous-result");
      }
    }
  }

  return [...validCandidates].sort((first, second) => {
    const qualityDifference = first.qualityRank - second.qualityRank;
    if (qualityDifference !== 0) {
      return qualityDifference;
    }
    if (first.candidate.formattedAddress < second.candidate.formattedAddress) {
      return -1;
    }
    if (first.candidate.formattedAddress > second.candidate.formattedAddress) {
      return 1;
    }
    const latitudeDifference =
      first.coordinates.latitude - second.coordinates.latitude;
    return latitudeDifference !== 0
      ? latitudeDifference
      : first.coordinates.longitude - second.coordinates.longitude;
  })[0];
}

export async function geocodeStructuredUsRestaurantAddress(
  value: unknown,
  dependencies: RestaurantGeocodingDependencies,
): Promise<StrictRestaurantGeocodingResult> {
  const address = normalizeStructuredUsRestaurantAddress(value);
  const addressFingerprint = fingerprintNormalizedAddress(address);
  const query =
    `${address.streetAddress}, ${address.city}, ` +
    `${address.state} ${address.zipCode}`;

  let candidates: ParsedGoogleGeocodingCandidate[];
  try {
    candidates = await requestGoogleGeocodingCandidates(query, dependencies);
  } catch (error) {
    if (error instanceof RestaurantGeocodingError) {
      throw error;
    }
    throw geocodingError("provider-unavailable");
  }

  const selected = selectStrictCandidate(candidates, address);
  return {
    ...address,
    formattedAddress: selected.candidate.formattedAddress,
    ...selected.coordinates,
    addressFingerprint,
  };
}
