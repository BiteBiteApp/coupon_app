export const maximumSearchNameLength = 100;
export const minimumWordPrefixLength = 2;
export const maximumWordPrefixLength = 32;
export const maximumWordPrefixTokenCount = 128;

// This matches the state/DC contract already enforced by the restaurant
// geocoding and Admin restaurant-search modules. Those lists are private to
// their modules, so the shared search foundation exposes its own immutable
// copy without changing either production path in this checkpoint.
export const supportedUsStateCodes = Object.freeze([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const);

const supportedUsStateCodeSet = new Set<string>(supportedUsStateCodes);
const combiningMarkPattern = /\p{M}+/gu;
const apostrophePattern = /['\u2018\u2019\u02bc\uff07]/gu;
const nonLetterOrNumberPattern = /[^\p{L}\p{N}]+/gu;

export class SearchNormalizationError extends Error {
  readonly code = "search_normalization_error";

  constructor(message: string) {
    super(message);
    this.name = "SearchNormalizationError";
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new SearchNormalizationError(`${label} must be a string.`);
  }
  return value;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function normalizeWords(value: string, removeApostrophes: boolean): string {
  const decomposed = value.normalize("NFKD").replace(combiningMarkPattern, "");
  const apostropheNormalized = removeApostrophes
    ? decomposed.replace(apostrophePattern, "")
    : decomposed.replace(apostrophePattern, " ");
  return apostropheNormalized
    .toLowerCase()
    .replace(nonLetterOrNumberPattern, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizeZip5(value: unknown): string {
  const zip = requireString(value, "ZIP code").trim();
  const match = /^(\d{5})(?:-\d{4})?$/u.exec(zip);
  if (match === null) {
    throw new SearchNormalizationError(
      "ZIP code must be five digits or a valid ZIP+4.",
    );
  }
  return match[1];
}

export function normalizeStateCode(value: unknown): string {
  const state = requireString(value, "State").trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(state) || !supportedUsStateCodeSet.has(state)) {
    throw new SearchNormalizationError(
      "State must be a supported two-letter US or DC code.",
    );
  }
  return state;
}

export function normalizeCityName(value: unknown): string {
  const city = normalizeWords(requireString(value, "City"), false);
  if (city.length === 0) {
    throw new SearchNormalizationError("City must not be blank.");
  }
  return city;
}

export function buildCityStateKey(
  cityValue: unknown,
  stateValue: unknown,
): string {
  const city = normalizeCityName(cityValue);
  const state = normalizeStateCode(stateValue);
  return `${state}|${city}`;
}

export function normalizeSearchName(value: unknown): string {
  const source = requireString(value, "Search name");
  if (unicodeLength(source) > maximumSearchNameLength) {
    throw new SearchNormalizationError(
      `Search name must be no more than ${maximumSearchNameLength} characters.`,
    );
  }
  const normalized = normalizeWords(source, true);
  if (normalized.length === 0) {
    throw new SearchNormalizationError("Search name must not be blank.");
  }
  return normalized;
}

export function buildWordPrefixTokens(value: unknown): readonly string[] {
  const normalized = normalizeSearchName(value);
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const word of normalized.split(" ")) {
    const characters = Array.from(word);
    const upperBound = Math.min(characters.length, maximumWordPrefixLength);
    for (
      let length = minimumWordPrefixLength;
      length <= upperBound;
      length += 1
    ) {
      const token = characters.slice(0, length).join("");
      if (!seen.has(token)) {
        seen.add(token);
        tokens.push(token);
        if (tokens.length === maximumWordPrefixTokenCount) {
          return Object.freeze(tokens);
        }
      }
    }
  }

  return Object.freeze(tokens);
}
