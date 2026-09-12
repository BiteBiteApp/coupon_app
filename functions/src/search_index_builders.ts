import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII, domainToUnicode } from "node:url";
import { GeoPoint } from "firebase-admin/firestore";
import {
  canonicalCustomerBiteSaverState,
  customerBiteSaverMaximumIndexedOrderKeyBytes,
  customerBiteSaverOfferProjectionVersion,
} from "./customer_bitesaver_search_contract.js";
import {
  customerBiteSaverMatcherVersion,
  customerBiteSaverNormalizerVersion,
  customerBiteSaverSearchMatchValues,
  dartUtf16FirestoreBytesOrderKey,
  hasWellFormedCustomerBiteSaverUtf16,
} from "./customer_bitesaver_search_matcher.js";
import {
  customerBiteSaverDailySpecialAvailabilityMode,
  normalizeCustomerBiteSaverDailySpecialDays,
  parseCustomerBiteSaverLegacyDateTimeString,
  readCustomerBiteSaverCouponBoolean,
  readCustomerBiteSaverDailySpecialBoolean,
  readCustomerBiteSaverFiniteDouble,
  type CustomerBiteSaverLegacyDateTimeStringResult,
} from "./customer_bitesaver_offer_availability.js";
import {
  canonicalRestaurantGeohash,
  extractBiteSaverRestaurantCoordinates,
  extractBiteScoreRestaurantCoordinates,
  type RestaurantCoordinateExtractor,
} from "./restaurant_geo_helpers.js";
import {
  buildCityStateKey,
  buildWordPrefixTokens,
  maximumSearchNameLength,
  maximumWordPrefixTokenCount,
  normalizeCityName,
  normalizeSearchName,
  normalizeZip5,
} from "./search_normalization.js";
import {
  biteScoreDishCustomerPublicProjectionVersion,
  biteScoreRestaurantCustomerPublicProjectionVersion,
  customerBiteSaverCatalogGenerationContributionField,
  createCustomerBiteSaverCatalogGenerationContribution,
  createSearchIndexDocumentId,
  createSourceFingerprint,
  maximumSearchIndexDocumentBytes,
  requireSearchIndexDocumentSize,
  searchIndexVersion,
  serializedSearchIndexDocumentBytes,
} from "./search_index_contract.js";
import {
  biteSaverAccountCatalogBindingState,
  biteScoreCatalogBindingState,
  readBiteScoreCatalogRestaurantId,
} from "./restaurant_invite_helpers.js";
import {
  maximumRestaurantWriteRevision,
  readRestaurantWriteRevision,
} from "./restaurant_write_revision.js";

export type SearchIndexSourceData = Readonly<Record<string, unknown>>;
export type SearchIndexDocument = Readonly<Record<string, unknown>>;

export type BiteScoreRestaurantClaimProjection = Readonly<{
  isClaimed: boolean;
  claimAvailable: boolean;
  claimStateValid: boolean;
}>;

export type BiteSaverCatalogBindingAdminState =
  "unbound" | "bound" | "unavailable";

export type BiteScoreBiteSaverCatalogProfile = Readonly<{
  restaurantName: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string | null;
  website: string | null;
  latitude: number;
  longitude: number;
}>;

export function biteScoreRestaurantIsActive(
  data: SearchIndexSourceData,
): boolean {
  const hasCanonical = Object.prototype.hasOwnProperty.call(data, "isActive");
  const hasLegacy = Object.prototype.hasOwnProperty.call(data, "active");
  return (!hasCanonical || data.isActive === true) &&
    (!hasLegacy || data.active === true);
}

export function biteScoreRestaurantClaimProjection(
  data: SearchIndexSourceData,
): BiteScoreRestaurantClaimProjection {
  const hasIsClaimed = Object.prototype.hasOwnProperty.call(data, "isClaimed");
  const hasOwnerUserId = Object.prototype.hasOwnProperty.call(
    data,
    "ownerUserId",
  );
  const isStrictlyUnclaimed =
    (!hasIsClaimed || data.isClaimed === false) &&
    (!hasOwnerUserId ||
      data.ownerUserId === null ||
      data.ownerUserId === "");
  const isValidlyClaimed =
    data.isClaimed === true &&
    typeof data.ownerUserId === "string" &&
    data.ownerUserId.trim().length > 0;
  const isActive = biteScoreRestaurantIsActive(data);

  return Object.freeze({
    isClaimed: isValidlyClaimed,
    claimAvailable: isActive && isStrictlyUnclaimed,
    claimStateValid: isActive && (isStrictlyUnclaimed || isValidlyClaimed),
  });
}

export function biteSaverCatalogBindingAdminState(
  restaurantDocumentId: string,
  data: SearchIndexSourceData,
  reciprocalBindingVerified = false,
): BiteSaverCatalogBindingAdminState {
  const restaurantWriteRevision = readRestaurantWriteRevision(data);
  const optionalIdentityIsValid = (fieldName: string): boolean =>
    !Object.prototype.hasOwnProperty.call(data, fieldName) ||
    data[fieldName] === null ||
    data[fieldName] === "" ||
    readBiteScoreCatalogRestaurantId(data[fieldName]) !== null;
  if (
    readBiteScoreCatalogRestaurantId(restaurantDocumentId) !==
      restaurantDocumentId ||
    data.id !== restaurantDocumentId ||
    !biteScoreRestaurantIsActive(data) ||
    biteScoreBiteSaverCatalogProfile(data) === null ||
    restaurantWriteRevision === null ||
    restaurantWriteRevision >= maximumRestaurantWriteRevision ||
    !optionalIdentityIsValid("ownerUserId") ||
    !optionalIdentityIsValid("linkedBiteSaverUid")
  ) {
    return "unavailable";
  }

  const binding = biteScoreCatalogBindingState(data);
  if (binding.type === "invalid") {
    return "unavailable";
  }
  if (binding.type === "bound") {
    return reciprocalBindingVerified ? "bound" : "unavailable";
  }
  return reciprocalBindingVerified &&
      biteScoreRestaurantClaimProjection(data).claimStateValid
    ? "unbound"
    : "unavailable";
}

export const maximumOfferDescriptionLength = 500;
export const maximumCustomerOfferSingleLineLength = 2_000;
export const maximumCustomerOfferMultilineLength =
  maximumSearchIndexDocumentBytes;
export const maximumPublicUrlLength = 2_048;
export const maximumDishCategorySourceCount = 32;
export const maximumDishCategoryInputCount = 128;
export const maximumDishCategoryManualKeywordBytes = 4_096;
export const maximumDishCategoryCombinedSourceBytes = 8_192;
export const maximumSearchLocationTextLength = 100;
export const biteSaverRestaurantPublicProjectionVersion =
  "bitestar.bitesaver-public-restaurant.v1" as const;
export const biteSaverOfferCatalogUpdatedAtField =
  "offerCatalogUpdatedAt" as const;
export const biteSaverOfferCatalogUpdatedAtOrderKeyField =
  "offerCatalogUpdatedAtOrderKey" as const;
export const customerBiteSaverOfferSourceCreatedAtOrderKeyField =
  "sourceCreatedAtOrderKey" as const;

const firestoreTimestampMinimumSeconds = -62_135_596_800;
const firestoreTimestampMaximumSeconds = 253_402_300_799;
const firestoreTimestampEpochOffsetSeconds =
  -firestoreTimestampMinimumSeconds;
const firestoreTimestampShiftedSecondsWidth = 12;
const firestoreTimestampNanosecondsWidth = 9;
const customerBiteSaverTimestampOrderKeyPattern =
  /^v1:(\d{12}):(\d{9})$/u;

const maximumPublicStreetAddressLength = 200;
const maximumPublicCityLength = 100;
const maximumPublicStateLength = maximumSearchLocationTextLength;
const maximumPublicZipCodeLength = 20;
const maximumPublicPhoneLength = 50;
const maximumPublicWebsiteLength = 500;
const maximumPublicBioLength = 2_000;

export function biteScoreBiteSaverCatalogProfile(
  data: SearchIndexSourceData,
): BiteScoreBiteSaverCatalogProfile | null {
  const restaurantName = firstBoundedPublicString(
    data,
    ["name", "restaurantName", "restaurant_name"],
    maximumSearchNameLength,
  );
  const streetAddress = boundedPublicSingleLineString(
    data.streetAddress,
    maximumPublicStreetAddressLength,
  );
  const city = firstBoundedPublicString(
    data,
    ["city", "locality", "municipality", "town"],
    maximumPublicCityLength,
  );
  const state = firstBoundedPublicString(
    data,
    ["state", "stateCode", "state_name", "region", "province"],
    maximumPublicStateLength,
  );
  const zipCode = firstBoundedPublicString(
    data,
    ["zipCode", "zip", "zip_code", "postalCode", "postcode"],
    maximumPublicZipCodeLength,
  );
  const coordinates = extractBiteScoreRestaurantCoordinates(data);
  if (
    restaurantName === null ||
    streetAddress === null ||
    city === null ||
    state === null ||
    zipCode === null ||
    coordinates === null
  ) {
    return null;
  }

  return Object.freeze({
    restaurantName,
    streetAddress,
    city,
    state,
    zipCode,
    phone: firstBoundedPublicString(
      data,
      ["phone", "phoneNumber"],
      maximumPublicPhoneLength,
    ),
    website: firstPublicProfileUrl(
      data,
      ["website", "websiteUrl", "url"],
      maximumPublicWebsiteLength,
    ),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });
}
const maximumPublicImageUrlLength = 2_000;
const maximumPublicFormattedAddressLength = 500;
const maximumPublicMenuRestaurantIdLength = 1_500;
const maximumPublicBusinessHoursTimeLength = 40;
const unsupportedPublicSingleLineCharacterPattern =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const unsupportedPublicMultilineCharacterPattern =
  /[\p{Cf}\p{Zl}\p{Zp}\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const businessDayNames = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]);
const businessDayNameSet = new Set<string>(businessDayNames);
const publicBusinessHoursKeys = Object.freeze([
  "day",
  "opensAt",
  "closesAt",
  "closed",
]);

type GeographyProjection = Readonly<Record<string, unknown>>;

type CustomerGeographyProjection = Readonly<{
  zip5: string;
  normalizedCity: string;
  normalizedState: string;
  cityStateKey: string;
  latitude: number;
  longitude: number;
  geohash: string;
}>;

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized || null;
}

function hasWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const trailingCodeUnit = value.charCodeAt(index + 1);
      if (trailingCodeUnit < 0xdc00 || trailingCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximumLength * 4
  ) {
    return null;
  }
  const text = readString(value);
  return text !== null && Array.from(text).length <= maximumLength ? text : null;
}

function boundedPublicSingleLineString(
  value: unknown,
  maximumLength: number,
): string | null {
  if (
    typeof value !== "string" ||
    !hasWellFormedUtf16(value) ||
    unsupportedPublicSingleLineCharacterPattern.test(value)
  ) {
    return null;
  }
  return boundedString(value, maximumLength);
}

function boundedPublicMultilineString(
  value: unknown,
  maximumLength: number,
): string | null {
  if (
    typeof value !== "string" ||
    !hasWellFormedUtf16(value) ||
    Buffer.byteLength(value, "utf8") > maximumLength * 4 ||
    unsupportedPublicMultilineCharacterPattern.test(value)
  ) {
    return null;
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[^\S\n]+/gu, " "))
    .join("\n")
    .trim();
  return normalized && Array.from(normalized).length <= maximumLength
    ? normalized
    : null;
}

function publicProfileUrl(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const url = boundedPublicSingleLineString(value, maximumLength);
  if (url === null) {
    return null;
  }
  // NFKC can change URL delimiters, path segments, and query semantics.
  // Validate both forms and require them to resolve to the same absolute URL.
  const rawHref = strictPublicHttpUrlSourceHref(value);
  const normalizedHref = strictPublicHttpUrlSourceHref(url);
  if (
    publicUrlStructuralCharacters(value) !== publicUrlStructuralCharacters(url) ||
    rawHref === null ||
    normalizedHref === null ||
    rawHref !== normalizedHref
  ) {
    return null;
  }
  return url;
}

function publicUrlStructuralCharacters(value: string): string {
  return value.replace(/[^:/?#@[\]\\%]/gu, "");
}

type StrictPublicUrlAuthority = Readonly<{
  rawHostname: string;
  asciiHostname: string;
}>;

const idnaMappedHostnameSeparatorPattern = /[\u3002\uff0e\uff61]/u;

function readStrictPublicUrlAuthority(
  value: string,
): StrictPublicUrlAuthority | null {
  if (
    /\s/u.test(value) ||
    value.includes("\\") ||
    !/^https?:\/\//iu.test(value)
  ) {
    return null;
  }
  const authorityStart = value.indexOf("://") + 3;
  const authorityEndOffset = value.slice(authorityStart).search(/[/?#]/u);
  const authority = authorityEndOffset < 0
    ? value.slice(authorityStart)
    : value.slice(authorityStart, authorityStart + authorityEndOffset);
  if (
    authority.length === 0 ||
    authority.includes("@") ||
    authority.includes("%")
  ) {
    return null;
  }
  let rawHostname = authority;
  let rawPort: string | null = null;
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket < 0) {
      return null;
    }
    rawHostname = authority.slice(0, closingBracket + 1);
    const remainder = authority.slice(closingBracket + 1);
    if (remainder.length > 0) {
      if (!remainder.startsWith(":")) {
        return null;
      }
      rawPort = remainder.slice(1);
    }
  } else {
    const portSeparator = authority.lastIndexOf(":");
    if (portSeparator >= 0) {
      rawHostname = authority.slice(0, portSeparator);
      rawPort = authority.slice(portSeparator + 1);
    }
    if (rawHostname.includes(":")) {
      return null;
    }
  }
  if (
    rawHostname.length === 0 ||
    (rawPort !== null &&
      (!/^[0-9]+$/u.test(rawPort) || Number(rawPort) > 65_535)) ||
    idnaMappedHostnameSeparatorPattern.test(rawHostname) ||
    rawHostname.normalize("NFKC") !== rawHostname
  ) {
    return null;
  }
  const asciiHostname = domainToASCII(rawHostname).toLowerCase();
  if (
    asciiHostname.length === 0 ||
    !publicUnicodeHostnameRoundTrips(rawHostname, asciiHostname)
  ) {
    return null;
  }
  return Object.freeze({rawHostname, asciiHostname});
}

function publicUnicodeHostnameRoundTrips(
  rawHostname: string,
  asciiHostname: string,
): boolean {
  // ASCII and punycode spellings are already checked without an IDNA rewrite.
  // For each raw Unicode label, require IDNA decoding to preserve every code
  // point other than the ordinary case-insensitivity of DNS names. Comparing
  // label-wise preserves a mixed host that intentionally spells one label as
  // ASCII punycode and another as Unicode, as well as a trailing root dot.
  if (/^[\x00-\x7f]+$/u.test(rawHostname)) {
    return true;
  }
  const rawLabels = rawHostname.split(".");
  const asciiLabels = asciiHostname.split(".");
  return rawLabels.length === asciiLabels.length &&
    rawLabels.every((rawLabel, index) => {
      const asciiLabel = asciiLabels[index];
      if (/^[\x00-\x7f]*$/u.test(rawLabel)) {
        return rawLabel.toLowerCase() === asciiLabel.toLowerCase();
      }
      return domainToUnicode(asciiLabel).toLowerCase().normalize("NFC") ===
        rawLabel.toLowerCase().normalize("NFC");
    });
}

function strictPublicHttpUrlSourceHref(value: string): string | null {
  const authority = readStrictPublicUrlAuthority(value);
  if (authority === null) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.hostname.length > 0 &&
        parsed.username.length === 0 &&
        parsed.password.length === 0 &&
        authority.asciiHostname === parsed.hostname.toLowerCase() &&
        (isIP(parsed.hostname) !== 4 ||
          authority.rawHostname === parsed.hostname) &&
        publicHostnameIsValid(parsed.hostname)
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function publicHostnameIsValid(hostname: string): boolean {
  if (
    hostname.startsWith("[") &&
    hostname.endsWith("]") &&
    isIP(hostname.slice(1, -1)) === 6
  ) {
    return true;
  }
  if (isIP(hostname) === 4) {
    return true;
  }
  const domain = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (domain.length === 0 || Buffer.byteLength(domain, "ascii") > 253) {
    return false;
  }
  return domain.split(".").every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label));
}

function firstPublicProfileUrl(
  data: SearchIndexSourceData,
  fields: readonly string[],
  maximumLength: number,
): string | null {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      return publicProfileUrl(data[field], maximumLength);
    }
  }
  return null;
}

function firstBoundedPublicString(
  data: SearchIndexSourceData,
  fields: readonly string[],
  maximumLength: number,
): string | null {
  for (const field of fields) {
    const value = boundedPublicSingleLineString(data[field], maximumLength);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function firstBoundedString(
  data: SearchIndexSourceData,
  fields: readonly string[],
  maximumLength: number,
): string | null {
  for (const field of fields) {
    const value = boundedString(data[field], maximumLength);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicBusinessHours(
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] | null {
  if (
    !Array.isArray(value) ||
    (value.length !== 0 && value.length !== businessDayNames.length)
  ) {
    return null;
  }

  const result: Readonly<Record<string, unknown>>[] = [];
  const seenDays = new Set<string>();
  for (const rawEntry of value) {
    if (!isRecord(rawEntry)) {
      return null;
    }
    const keys = Object.keys(rawEntry);
    if (
      keys.length !== publicBusinessHoursKeys.length ||
      publicBusinessHoursKeys.some(
        (key) => !Object.prototype.hasOwnProperty.call(rawEntry, key),
      ) ||
      keys.some((key) => !publicBusinessHoursKeys.includes(key))
    ) {
      return null;
    }
    const day = boundedPublicSingleLineString(rawEntry.day, 16);
    const opensAt = boundedPublicSingleLineString(
      rawEntry.opensAt,
      maximumPublicBusinessHoursTimeLength,
    );
    const closesAt = boundedPublicSingleLineString(
      rawEntry.closesAt,
      maximumPublicBusinessHoursTimeLength,
    );
    if (
      day === null ||
      !businessDayNameSet.has(day) ||
      seenDays.has(day) ||
      opensAt === null ||
      closesAt === null ||
      typeof rawEntry.closed !== "boolean"
    ) {
      return null;
    }
    seenDays.add(day);
    result.push(Object.freeze({
      day,
      opensAt,
      closesAt,
      closed: rawEntry.closed,
    }));
  }
  if (
    result.length === businessDayNames.length &&
    businessDayNames.some((day) => !seenDays.has(day))
  ) {
    return null;
  }
  return Object.freeze(result);
}

function publicMenuRoutingProjection(
  data: SearchIndexSourceData,
): Readonly<Record<string, unknown>> {
  if (data.menuSourceSide === "biteSaver") {
    return Object.freeze({ menuSourceSide: "biteSaver" });
  }
  if (data.menuSourceSide !== "biteScore") {
    return Object.freeze({});
  }
  const linkedRestaurantId = boundedPublicSingleLineString(
    data.linkedBiteScoreRestaurantId,
    maximumPublicMenuRestaurantIdLength,
  );
  return Object.freeze({
    menuSourceSide: "biteScore",
    ...(linkedRestaurantId === null ||
      linkedRestaurantId.includes("/") ||
      Buffer.byteLength(linkedRestaurantId, "utf8") >
        maximumPublicMenuRestaurantIdLength
      ? {}
      : { linkedBiteScoreRestaurantId: linkedRestaurantId }),
  });
}

function biteSaverPublicProfileProjection(
  data: SearchIndexSourceData,
): Readonly<Record<string, unknown>> {
  const streetAddress = firstBoundedPublicString(
    data,
    ["streetAddress", "address"],
    maximumPublicStreetAddressLength,
  );
  const city = boundedPublicSingleLineString(data.city, maximumPublicCityLength);
  const state = boundedPublicSingleLineString(data.state, maximumPublicStateLength);
  const zipCode = firstBoundedPublicString(
    data,
    ["zipCode", "postalCode", "zip"],
    maximumPublicZipCodeLength,
  );
  const phone = boundedPublicSingleLineString(data.phone, maximumPublicPhoneLength);
  const website = publicProfileUrl(
    data.website,
    maximumPublicWebsiteLength,
  );
  const bio = boundedPublicMultilineString(data.bio, maximumPublicBioLength);
  const primaryImageUrl = biteSaverRestaurantPrimaryImageUrl(data);
  const formattedAddress = boundedPublicSingleLineString(
    data.formattedAddress,
    maximumPublicFormattedAddressLength,
  );
  const businessHours = Object.prototype.hasOwnProperty.call(
      data,
      "businessHours",
    )
    ? publicBusinessHours(data.businessHours)
    : null;

  return Object.freeze({
    ...(streetAddress === null ? {} : { streetAddress }),
    ...(city === null ? {} : { city }),
    ...(state === null ? {} : { state }),
    ...(zipCode === null ? {} : { zipCode }),
    ...(phone === null ? {} : { phone }),
    ...(website === null ? {} : { website }),
    ...(bio === null ? {} : { bio }),
    ...(primaryImageUrl === null ? {} : { primaryImageUrl }),
    ...(businessHours === null ? {} : { businessHours }),
    ...(formattedAddress === null ? {} : { formattedAddress }),
    ...publicMenuRoutingProjection(data),
  });
}

function biteSaverRestaurantPrimaryImageUrl(
  data: SearchIndexSourceData,
): string | null {
  return publicProfileUrl(
    Object.prototype.hasOwnProperty.call(data, "mainImageUrl")
      ? data.mainImageUrl
      : data.imageUrl,
    maximumPublicImageUrlLength,
  );
}

function biteSaverOfferCatalogProjection(
  data: SearchIndexSourceData,
): Readonly<Record<string, unknown>> {
  const rawMarker = data[biteSaverOfferCatalogUpdatedAtField];
  const offerCatalogUpdatedAtOrderKey =
    customerBiteSaverTimestampOrderKey(rawMarker);
  if (offerCatalogUpdatedAtOrderKey === null) {
    return Object.freeze({});
  }
  const offerCatalogUpdatedAt = readDate(rawMarker);
  return Object.freeze({
    ...(offerCatalogUpdatedAt === null
      ? {}
      : { [biteSaverOfferCatalogUpdatedAtField]: offerCatalogUpdatedAt }),
    [biteSaverOfferCatalogUpdatedAtOrderKeyField]:
      offerCatalogUpdatedAtOrderKey,
  });
}

function biteSaverCatalogBindingProjection(
  data: SearchIndexSourceData,
): Readonly<Record<string, unknown>> {
  const binding = biteSaverAccountCatalogBindingState(data);
  if (binding.type !== "bound") {
    return Object.freeze({});
  }
  return Object.freeze({
    biteScoreCatalogRestaurantId: binding.biteScoreCatalogRestaurantId,
    biteSaverCatalogBindingId: binding.biteSaverCatalogBindingId,
  });
}

export function boundedDescriptionSummary(value: unknown): string | null {
  const text = readString(value);
  if (text === null) {
    return null;
  }
  return Array.from(text).slice(0, maximumOfferDescriptionLength).join("");
}

function publicUrl(value: unknown): string | null {
  return publicProfileUrl(value, maximumPublicUrlLength);
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as { toDate?: () => unknown };
    if (typeof candidate.toDate === "function") {
      try {
        const converted = candidate.toDate();
        return converted instanceof Date && Number.isFinite(converted.getTime())
          ? new Date(converted.getTime())
          : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function customerBiteSaverTimestampParts(
  value: unknown,
): Readonly<{seconds: number; nanoseconds: number}> | null {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) {
      return null;
    }
    const seconds = Math.floor(milliseconds / 1_000);
    const nanoseconds = (milliseconds - seconds * 1_000) * 1_000_000;
    return seconds < firestoreTimestampMinimumSeconds ||
        seconds > firestoreTimestampMaximumSeconds
      ? null
      : Object.freeze({seconds, nanoseconds});
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    const candidate = value as {
      seconds?: unknown;
      nanoseconds?: unknown;
      _seconds?: unknown;
      _nanoseconds?: unknown;
      toDate?: () => unknown;
    };
    const hasSeconds = candidate.seconds !== undefined;
    const hasNanoseconds = candidate.nanoseconds !== undefined;
    if (hasSeconds || hasNanoseconds) {
      return typeof candidate.seconds === "number" &&
          Number.isSafeInteger(candidate.seconds) &&
          candidate.seconds >= firestoreTimestampMinimumSeconds &&
          candidate.seconds <= firestoreTimestampMaximumSeconds &&
          typeof candidate.nanoseconds === "number" &&
          Number.isSafeInteger(candidate.nanoseconds) &&
          candidate.nanoseconds >= 0 &&
          candidate.nanoseconds < 1_000_000_000
        ? Object.freeze({
            seconds: candidate.seconds,
            nanoseconds: candidate.nanoseconds,
          })
        : null;
    }
    const hasPrivateSeconds = candidate._seconds !== undefined;
    const hasPrivateNanoseconds = candidate._nanoseconds !== undefined;
    if (hasPrivateSeconds || hasPrivateNanoseconds) {
      return typeof candidate._seconds === "number" &&
          Number.isSafeInteger(candidate._seconds) &&
          candidate._seconds >= firestoreTimestampMinimumSeconds &&
          candidate._seconds <= firestoreTimestampMaximumSeconds &&
          typeof candidate._nanoseconds === "number" &&
          Number.isSafeInteger(candidate._nanoseconds) &&
          candidate._nanoseconds >= 0 &&
          candidate._nanoseconds < 1_000_000_000
        ? Object.freeze({
            seconds: candidate._seconds,
            nanoseconds: candidate._nanoseconds,
          })
        : null;
    }
    if (typeof candidate.toDate !== "function") {
      return null;
    }
    const converted = candidate.toDate();
    return converted instanceof Date
      ? customerBiteSaverTimestampParts(converted)
      : null;
  } catch {
    return null;
  }
}

/**
 * Produces one fixed-width, byte-safe key whose lexical order is the exact
 * Firestore Timestamp order. Dates retain millisecond precision while native
 * Firestore Timestamps retain their full nanosecond component.
 */
export function customerBiteSaverTimestampOrderKey(
  value: unknown,
): string | null {
  const timestamp = customerBiteSaverTimestampParts(value);
  if (timestamp === null) {
    return null;
  }
  const shiftedSeconds =
    timestamp.seconds + firestoreTimestampEpochOffsetSeconds;
  return "v1:" +
    shiftedSeconds.toString().padStart(
      firestoreTimestampShiftedSecondsWidth,
      "0",
    ) +
    ":" +
    timestamp.nanoseconds.toString().padStart(
      firestoreTimestampNanosecondsWidth,
      "0",
    );
}

export function isCustomerBiteSaverTimestampOrderKey(
  value: unknown,
): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = customerBiteSaverTimestampOrderKeyPattern.exec(value);
  if (match === null) {
    return false;
  }
  const shiftedSeconds = Number(match[1]);
  const nanoseconds = Number(match[2]);
  return shiftedSeconds <=
      firestoreTimestampMaximumSeconds + firestoreTimestampEpochOffsetSeconds &&
    nanoseconds < 1_000_000_000;
}

function readCustomerOfferDate(
  value: unknown,
  submillisecondRounding: "floor" | "ceil" = "floor",
): CustomerBiteSaverLegacyDateTimeStringResult {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as {toDate?: unknown}).toDate === "function"
  ) {
    const parts = customerBiteSaverTimestampParts(value);
    if (parts !== null) {
      const microseconds = Math.floor(parts.nanoseconds / 1_000);
      const millis = parts.seconds * 1_000 +
        Math.floor(microseconds / 1_000) +
        (submillisecondRounding === "ceil" && microseconds % 1_000 !== 0
          ? 1
          : 0);
      const rounded = new Date(millis);
      if (Number.isFinite(rounded.getTime())) {
        return Object.freeze({kind: "parsed", date: rounded});
      }
    }
  }
  const timestamp = readDate(value);
  if (timestamp !== null) {
    return Object.freeze({kind: "parsed", date: timestamp});
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    const result = new Date(value);
    return Number.isFinite(result.getTime())
      ? Object.freeze({kind: "parsed", date: result})
      : Object.freeze({kind: "invalid", date: null});
  }
  if (
    typeof value === "string" &&
    value.length <= 100 &&
    hasWellFormedCustomerBiteSaverUtf16(value)
  ) {
    return parseCustomerBiteSaverLegacyDateTimeString(
      value,
      undefined,
      submillisecondRounding,
    );
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as {toDate?: () => unknown; toMillis?: () => unknown};
    if (
      typeof candidate.toDate !== "function" &&
      typeof candidate.toMillis !== "function"
    ) {
      return Object.freeze({kind: "invalid", date: null});
    }
    try {
      const converted = typeof candidate.toDate === "function"
        ? candidate.toDate()
        : candidate.toMillis?.();
      return converted instanceof Date ||
          typeof converted === "number" ||
          typeof converted === "string"
        ? readCustomerOfferDate(converted, submillisecondRounding)
        : Object.freeze({kind: "invalid", date: null});
    } catch {
      return Object.freeze({kind: "invalid", date: null});
    }
  }
  return Object.freeze({kind: "invalid", date: null});
}

function unresolvedCustomerOfferLocalDateString(
  value: unknown,
  parsed: CustomerBiteSaverLegacyDateTimeStringResult,
): string | null {
  return parsed.kind === "timeZoneRequired" && typeof value === "string"
    ? value.trim()
    : null;
}

function sourceTimestamps(data: SearchIndexSourceData): Record<string, unknown> {
  const createdAt = readDate(data.createdAt);
  const updatedAt = readDate(data.updatedAt);
  return {
    ...(createdAt === null ? {} : { sourceCreatedAt: createdAt }),
    ...(updatedAt === null ? {} : { sourceUpdatedAt: updatedAt }),
  };
}

type NormalizedNameProjection = Readonly<{
  displayName: string;
  normalizedName: string;
  namePrefixTokens: readonly string[];
}>;

function normalizedNameProjection(
  value: unknown,
): NormalizedNameProjection | null {
  const displayName = boundedString(value, maximumSearchNameLength);
  if (displayName === null) {
    return null;
  }
  try {
    return {
      displayName,
      normalizedName: normalizeSearchName(displayName),
      namePrefixTokens: buildWordPrefixTokens(displayName),
    };
  } catch {
    return null;
  }
}

function biteSaverRestaurantPublicName(
  data: SearchIndexSourceData,
): NormalizedNameProjection | null {
  return normalizedNameProjection(firstBoundedPublicString(
    data,
    ["restaurantName", "name"],
    maximumSearchNameLength,
  ));
}

function geographyProjection(
  data: SearchIndexSourceData,
  options: {
    zipFields: readonly string[];
    cityFields: readonly string[];
    stateFields: readonly string[];
    extractCoordinates: RestaurantCoordinateExtractor;
  },
): GeographyProjection {
  const result: Record<string, unknown> = {};
  const zip = firstBoundedPublicString(
    data,
    options.zipFields,
    maximumPublicZipCodeLength,
  );
  if (zip !== null) {
    try {
      result.zip5 = normalizeZip5(zip);
    } catch {
      // Invalid ZIP does not invalidate other search modes.
    }
  }

  const cityValue = firstBoundedPublicString(
    data,
    options.cityFields,
    maximumSearchLocationTextLength,
  );
  const stateValue = firstBoundedPublicString(
    data,
    options.stateFields,
    maximumSearchLocationTextLength,
  );
  const city = cityValue !== null &&
    Array.from(cityValue).length <= maximumSearchLocationTextLength
    ? cityValue
    : null;
  const state = stateValue !== null &&
      Array.from(stateValue).length <= maximumSearchLocationTextLength
    ? stateValue
    : null;
  if (city !== null && state !== null) {
    const canonicalState = canonicalCustomerBiteSaverState(state);
    if (canonicalState !== null) {
      try {
        result.normalizedCity = normalizeCityName(city);
        result.normalizedState = canonicalState;
        result.cityStateKey = buildCityStateKey(city, canonicalState);
      } catch {
        // City/state search requires both fields to be canonical.
      }
    }
  }

  const coordinates = options.extractCoordinates(data);
  const storedGeohash = boundedPublicSingleLineString(data.geohash, 12)
    ?.toLowerCase() ?? null;
  if (coordinates !== null && storedGeohash !== null) {
    const expectedGeohash = canonicalRestaurantGeohash(coordinates);
    if (storedGeohash === expectedGeohash) {
      result.latitude = coordinates.latitude;
      result.longitude = coordinates.longitude;
      result.location = new GeoPoint(
        coordinates.latitude,
        coordinates.longitude,
      );
      result.geohash = expectedGeohash;
    }
  }
  return Object.freeze(result);
}

function biteSaverGeography(data: SearchIndexSourceData): GeographyProjection {
  return geographyProjection(data, {
    zipFields: ["zipCode", "postalCode", "zip"],
    cityFields: ["city"],
    stateFields: ["state"],
    extractCoordinates: extractBiteSaverRestaurantCoordinates,
  });
}

function biteScoreGeography(data: SearchIndexSourceData): GeographyProjection {
  return geographyProjection(data, {
    zipFields: ["zipCode", "zip", "postalCode", "postcode"],
    cityFields: ["city", "locality", "municipality", "town"],
    stateFields: ["state", "stateCode", "region", "province"],
    extractCoordinates: extractBiteScoreRestaurantCoordinates,
  });
}

function customerGeography(
  geography: GeographyProjection,
): CustomerGeographyProjection | null {
  if (
    typeof geography.zip5 !== "string" ||
    typeof geography.normalizedCity !== "string" ||
    typeof geography.normalizedState !== "string" ||
    typeof geography.cityStateKey !== "string" ||
    typeof geography.latitude !== "number" ||
    typeof geography.longitude !== "number" ||
    typeof geography.geohash !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    zip5: geography.zip5,
    normalizedCity: geography.normalizedCity,
    normalizedState: geography.normalizedState,
    cityStateKey: geography.cityStateKey,
    latitude: geography.latitude,
    longitude: geography.longitude,
    geohash: geography.geohash,
  });
}

type BoundedPublicStringListResult = Readonly<{
  values: readonly string[];
  withinLimits: boolean;
}>;

function boundedPublicStringList(
  value: unknown,
  maximumCount: number,
  maximumItemLength: number,
): BoundedPublicStringListResult {
  if (value === undefined || value === null) {
    return Object.freeze({
      values: Object.freeze([] as string[]),
      withinLimits: true,
    });
  }
  if (!Array.isArray(value) || value.length > maximumCount) {
    return Object.freeze({
      values: Object.freeze([] as string[]),
      withinLimits: false,
    });
  }
  // Validate the complete raw list before byte accounting, normalization, or
  // token work. Buffer.byteLength replaces unpaired surrogates with U+FFFD;
  // allowing that replacement would make a partial public list appear
  // authoritative after the malformed entry is later rejected.
  for (const item of value) {
    if (typeof item !== "string" || !hasWellFormedUtf16(item)) {
      return Object.freeze({
        values: Object.freeze([] as string[]),
        withinLimits: false,
      });
    }
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      (Buffer.byteLength(item, "utf8") > maximumItemLength * 4 ||
        Array.from(item).length > maximumItemLength)
    ) {
      return Object.freeze({
        values: Object.freeze([] as string[]),
        withinLimits: false,
      });
    }
    const text = boundedPublicSingleLineString(item, maximumItemLength);
    if (text === null || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return Object.freeze({
    values: Object.freeze(result),
    withinLimits: true,
  });
}

function normalizedCategoryTokens(values: readonly string[]): readonly string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    try {
      tokens.add(normalizeSearchName(value));
    } catch {
      // Invalid public category text is omitted.
    }
  }
  return Object.freeze(
    [...tokens].sort().slice(0, maximumDishCategorySourceCount),
  );
}

function authoritativePublicNameProjection(
  data: SearchIndexSourceData,
  fields: readonly string[],
): NormalizedNameProjection | null {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      continue;
    }
    const displayName = boundedPublicSingleLineString(
      data[field],
      maximumSearchNameLength,
    );
    return displayName === null ? null : normalizedNameProjection(displayName);
  }
  return null;
}

function boundedCustomerPublicProjection(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  try {
    return serializedSearchIndexDocumentBytes(value) <=
        maximumSearchIndexDocumentBytes
      ? value
      : null;
  } catch {
    return null;
  }
}

function biteScoreRestaurantCustomerPublicProjection(value: {
  sourceDocumentId: string;
  source: SearchIndexSourceData;
  name: NormalizedNameProjection;
  geography: CustomerGeographyProjection;
  publicVisible: boolean;
  isClaimed: boolean;
}): Readonly<Record<string, unknown>> | null {
  const streetAddress = boundedPublicSingleLineString(
    value.source.streetAddress,
    maximumPublicStreetAddressLength,
  );
  const city = boundedPublicSingleLineString(
    value.source.city,
    maximumPublicCityLength,
  );
  const state = boundedPublicSingleLineString(
    value.source.state,
    maximumPublicStateLength,
  );
  const zipCode = boundedPublicSingleLineString(
    value.source.zipCode,
    maximumPublicZipCodeLength,
  );
  if (
    streetAddress === null ||
    city === null ||
    state === null ||
    zipCode === null
  ) {
    return null;
  }

  const phone = boundedPublicSingleLineString(
    value.source.phone,
    maximumPublicPhoneLength,
  );
  const website = publicProfileUrl(
    value.source.website,
    maximumPublicWebsiteLength,
  );
  const bio = boundedPublicMultilineString(
    value.source.bio,
    maximumPublicBioLength,
  );
  const primaryImageUrl = publicProfileUrl(
    Object.prototype.hasOwnProperty.call(value.source, "primaryImageUrl")
      ? value.source.primaryImageUrl
      : value.source.mainImageUrl,
    maximumPublicImageUrlLength,
  );
  const businessHours = Object.prototype.hasOwnProperty.call(
      value.source,
      "businessHours",
    )
    ? publicBusinessHours(value.source.businessHours)
    : null;
  const cuisineTagResult = boundedPublicStringList(
    value.source.cuisineTags,
    maximumDishCategorySourceCount,
    maximumSearchNameLength,
  );
  if (!cuisineTagResult.withinLimits) {
    return null;
  }
  const cuisineTags = cuisineTagResult.values;

  return boundedCustomerPublicProjection(Object.freeze({
    customerPublicProjectionVersion:
      biteScoreRestaurantCustomerPublicProjectionVersion,
    source: "biteScore",
    entityType: "restaurant",
    sourceDocumentId: value.sourceDocumentId,
    publicVisible: value.publicVisible,
    displayName: value.name.displayName,
    normalizedName: value.name.normalizedName,
    namePrefixTokens: value.name.namePrefixTokens,
    streetAddress,
    city,
    state,
    zipCode,
    ...value.geography,
    isClaimed: value.isClaimed,
    cuisineTags,
    categoryTokens: normalizedCategoryTokens(cuisineTags),
    ...(phone === null ? {} : { phone }),
    ...(website === null ? {} : { website }),
    ...(bio === null ? {} : { bio }),
    ...(primaryImageUrl === null ? {} : { primaryImageUrl }),
    ...(businessHours === null ? {} : { businessHours }),
  }));
}

function finalizeIndexDocument(
  draft: Record<string, unknown>,
  now: Date,
): SearchIndexDocument {
  const sourceFingerprint = createSourceFingerprint([draft]);
  const document = {
    ...draft,
    sourceFingerprint,
    indexedAt: new Date(now.getTime()),
  };
  requireSearchIndexDocumentSize(document);
  return Object.freeze(document);
}

function finalizeIndexDocumentWithCustomerFallback(
  draft: Record<string, unknown>,
  now: Date,
): SearchIndexDocument {
  try {
    return finalizeIndexDocument(draft, now);
  } catch {
    if (draft.customerPublicProjection === null) {
      throw new Error("Search index document is invalid or oversized.");
    }
    return finalizeIndexDocument({
      ...draft,
      customerPublicProjection: null,
    }, now);
  }
}

function biteSaverApprovalIsApproved(data: SearchIndexSourceData): boolean {
  return data.approvalStatus === "approved";
}

function biteSaverAdminHiddenAllowsPublic(
  data: SearchIndexSourceData,
): boolean {
  return !Object.prototype.hasOwnProperty.call(data, "adminHidden") ||
    data.adminHidden === false;
}

function parentSubscriptionAllowsOffers(
  data: SearchIndexSourceData,
): boolean {
  return biteSaverApprovalIsApproved(data) &&
    data.couponPostingEnabled === true &&
    biteSaverAdminHiddenAllowsPublic(data);
}

type CustomerBiteSaverSearchMatchProjection = Readonly<{
  values: readonly string[];
  complete: boolean;
}>;

function customerBiteSaverSearchMatchProjection(
  values: readonly unknown[],
): CustomerBiteSaverSearchMatchProjection {
  for (const value of values) {
    if (
      typeof value === "string" &&
      !hasWellFormedCustomerBiteSaverUtf16(value)
    ) {
      return Object.freeze({
        values: Object.freeze([] as string[]),
        complete: false,
      });
    }
  }
  return Object.freeze({
    // Use the compatibility matcher helper itself so missing optional fields
    // retain the same empty-string behavior as the current Flutter models.
    values: customerBiteSaverSearchMatchValues(values),
    complete: true,
  });
}

function customerOfferSingleLine(value: unknown): string | null {
  return boundedPublicSingleLineString(
    value,
    maximumCustomerOfferSingleLineLength,
  );
}

function customerOfferDetails(value: unknown): string | null {
  return boundedPublicMultilineString(
    value,
    maximumCustomerOfferMultilineLength,
  );
}

function couponNumber(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value)
    ? value.toString()
    : typeof value === "string"
      ? value.trim()
      : "";
  if (!/^\d+$/u.test(text)) {
    return null;
  }
  const significantDigits = text.replace(/^0+(?=\d)/u, "");
  if (significantDigits.length > 4) {
    return null;
  }
  const number = Number(significantDigits);
  return number <= 9_999 ? number.toString().padStart(4, "0") : null;
}

type BiteSaverOfferParentDescriptor = Readonly<{
  restaurantName: NormalizedNameProjection | null;
  restaurantCity: string | null;
  restaurantZipCode: string | null;
  geography: GeographyProjection;
  restaurantPrimaryImageUrl: string | null;
  restaurantBio: string | null;
  catalogBindingType: "unbound" | "bound" | "invalid";
  publicOffersAllowed: boolean;
  customerOffersAllowed: boolean;
}>;

/**
 * The complete bounded BiteSaver-parent input consumed by offer projections.
 *
 * Keep the fingerprint and both offer builders on this shared interpretation:
 * aliases are resolved once, public strings/geography are validated once, and
 * only effective projection values leave this boundary.
 */
function biteSaverOfferParentDescriptor(
  data: SearchIndexSourceData,
): BiteSaverOfferParentDescriptor {
  const geography = biteSaverGeography(data);
  const catalogBinding = biteSaverAccountCatalogBindingState(data);
  return Object.freeze({
    restaurantName: biteSaverRestaurantPublicName(data),
    restaurantCity: boundedPublicSingleLineString(
      data.city,
      maximumPublicCityLength,
    ),
    restaurantZipCode: firstBoundedPublicString(
      data,
      ["zipCode", "postalCode", "zip"],
      maximumPublicZipCodeLength,
    ),
    geography,
    restaurantPrimaryImageUrl: biteSaverRestaurantPrimaryImageUrl(data),
    restaurantBio: boundedPublicMultilineString(data.bio, maximumPublicBioLength),
    catalogBindingType: catalogBinding.type,
    publicOffersAllowed: parentSubscriptionAllowsOffers(data),
    customerOffersAllowed:
      parentSubscriptionAllowsOffers(data) && catalogBinding.type !== "invalid",
  });
}

export function biteSaverOfferParentFingerprint(
  data: SearchIndexSourceData | null,
): string {
  if (data === null) {
    return createSourceFingerprint(["biteSaverOfferParent", "missing"]);
  }
  const descriptor = biteSaverOfferParentDescriptor(data);
  if (descriptor.restaurantName === null) {
    return createSourceFingerprint([
      "biteSaverOfferParent",
      "present",
      "invalidRestaurantName",
    ]);
  }
  const geography = descriptor.geography;
  const parentSearchMatch = customerBiteSaverSearchMatchProjection([
    descriptor.restaurantName.displayName,
    descriptor.restaurantCity,
    descriptor.restaurantZipCode,
    descriptor.restaurantBio,
  ]);
  return createSourceFingerprint([
    "biteSaverOfferParent",
    "present",
    [
      "restaurantName",
      fingerprintScalar(descriptor.restaurantName.displayName),
    ],
    ["publicOffersAllowed", descriptor.publicOffersAllowed],
    ["customerOffersAllowed", descriptor.customerOffersAllowed],
    ["catalogBindingType", descriptor.catalogBindingType],
    ["zip5", fingerprintScalar(geography.zip5 ?? null)],
    ["normalizedCity", fingerprintScalar(geography.normalizedCity ?? null)],
    ["normalizedState", fingerprintScalar(geography.normalizedState ?? null)],
    ["cityStateKey", fingerprintScalar(geography.cityStateKey ?? null)],
    ["latitude", fingerprintScalar(geography.latitude ?? null)],
    ["longitude", fingerprintScalar(geography.longitude ?? null)],
    ["geohash", fingerprintScalar(geography.geohash ?? null)],
    [
      "restaurantPrimaryImageUrl",
      fingerprintScalar(descriptor.restaurantPrimaryImageUrl),
    ],
    ["restaurantBio", fingerprintScalar(descriptor.restaurantBio)],
    ["searchMatchComplete", parentSearchMatch.complete],
    ["searchMatchValues", parentSearchMatch.values],
  ]);
}

function fingerprintScalar(value: unknown): readonly unknown[] {
  if (value === null) {
    return Object.freeze(["null"]);
  }
  if (typeof value === "string") {
    // UTF-8 replaces every unpaired surrogate with U+FFFD. Hash the exact
    // UTF-16 code units instead so malformed public input cannot collide with
    // a distinct, well-formed string that has different eligibility.
    const digest = createHash("sha256")
      .update(Buffer.from(value, "utf16le"))
      .digest("hex");
    return Object.freeze([
      "string",
      "utf16le",
      value.length,
      Buffer.byteLength(value, "utf8"),
      digest,
    ]);
  }
  if (typeof value === "number") {
    return Object.freeze([
      "number",
      Number.isNaN(value)
        ? "NaN"
        : value === Number.POSITIVE_INFINITY
          ? "+Infinity"
          : value === Number.NEGATIVE_INFINITY
            ? "-Infinity"
            : Object.is(value, -0)
              ? "-0"
              : value,
    ]);
  }
  if (typeof value === "boolean") {
    return Object.freeze(["boolean", value]);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown> & {isEqual?: unknown};
    // The coordinate extractor accepts only Firestore GeoPoints (and the
    // compatible server-test shape with an isEqual function). A plain map with
    // the same numeric members is ineligible, so that distinction belongs in
    // the parent fingerprint.
    const coordinateObjectKind = value instanceof GeoPoint ||
        typeof candidate.isEqual === "function"
      ? "compatibleGeoPoint"
      : "plainObject";
    return Object.freeze([
      "object",
      coordinateObjectKind,
      fingerprintScalar(candidate.latitude),
      fingerprintScalar(candidate.longitude),
    ]);
  }
  return Object.freeze([Array.isArray(value) ? "array" : typeof value]);
}

function fingerprintField(
  data: SearchIndexSourceData,
  field: string,
): readonly unknown[] {
  return Object.prototype.hasOwnProperty.call(data, field)
    ? Object.freeze(["present", fingerprintScalar(data[field])])
    : Object.freeze(["absent"]);
}

const biteScoreDishParentFingerprintFields = Object.freeze([
  "name",
  "restaurantName",
  "restaurant_name",
  "isActive",
  "active",
  "isClaimed",
  "city",
  "locality",
  "municipality",
  "town",
  "state",
  "stateCode",
  "region",
  "province",
  "zipCode",
  "zip",
  "postalCode",
  "postcode",
  "location",
  "geoPoint",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "geohash",
]);

export function biteScoreDishParentFingerprint(
  data: SearchIndexSourceData | null,
  parentSourceDocumentId: string | null = null,
): string {
  if (data === null) {
    return createSourceFingerprint([
      "biteScoreDishParent",
      parentSourceDocumentId,
      "missing",
    ]);
  }
  return createSourceFingerprint([
    "biteScoreDishParent",
    parentSourceDocumentId,
    ...biteScoreDishParentFingerprintFields.map((field) =>
      fingerprintField(data, field)),
  ]);
}

function customerBiteSaverRadiusGeographyIsValid(
  projection: Readonly<Record<string, unknown>>,
): boolean {
  return typeof projection.latitude === "number" &&
    Number.isFinite(projection.latitude) &&
    typeof projection.longitude === "number" &&
    Number.isFinite(projection.longitude) &&
    typeof projection.geohash === "string" &&
    projection.geohash.length > 0;
}

const biteSaverRestaurantCatalogContributionFields = Object.freeze([
  "publicProjectionVersion",
  "source",
  "entityType",
  "sourceDocumentId",
  "indexDocumentId",
  "displayName",
  "normalizedName",
  "namePrefixTokens",
  "zip5",
  "normalizedCity",
  "normalizedState",
  "cityStateKey",
  "latitude",
  "longitude",
  "geohash",
  "publicVisible",
  "customerParentEligibilityFingerprint",
  "streetAddress",
  "city",
  "state",
  "zipCode",
  "phone",
  "website",
  "bio",
  "primaryImageUrl",
  "businessHours",
  "formattedAddress",
  "menuSourceSide",
  "linkedBiteScoreRestaurantId",
  "biteScoreCatalogRestaurantId",
  "biteSaverCatalogBindingId",
] as const);

function selectedProjectionFields(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  const projection: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      projection[key] = source[key];
    }
  }
  return Object.freeze(projection);
}

function biteSaverRestaurantCatalogGenerationContribution(
  draft: Readonly<Record<string, unknown>>,
): string | null {
  const discoverable = draft.publicVisible === true &&
    customerBiteSaverRadiusGeographyIsValid(draft);
  return discoverable
    ? createCustomerBiteSaverCatalogGenerationContribution(Object.freeze({
        customerDiscoverable: true,
        ...selectedProjectionFields(
          draft,
          biteSaverRestaurantCatalogContributionFields,
        ),
      }))
    : null;
}

export function buildBiteSaverRestaurantIndex(value: {
  sourceDocumentId: string;
  source: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (value.source === null) {
    return null;
  }
  const name = biteSaverRestaurantPublicName(value.source);
  if (name === null) {
    return null;
  }
  const approvalIsApproved = biteSaverApprovalIsApproved(value.source);
  const catalogBinding = biteSaverAccountCatalogBindingState(value.source);
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteSaverRestaurant",
    sourceDocumentId: value.sourceDocumentId,
  });
  const draft = {
    publicProjectionVersion: biteSaverRestaurantPublicProjectionVersion,
    searchIndexVersion,
    entityType: "restaurant",
    source: "biteSaver",
    sourceDocumentId: value.sourceDocumentId,
    indexDocumentId,
    ...name,
    ...biteSaverGeography(value.source),
    publicVisible:
      parentSubscriptionAllowsOffers(value.source) &&
      catalogBinding.type !== "invalid",
    adminDirectoryVisible: approvalIsApproved,
    ...biteSaverPublicProfileProjection(value.source),
    ...biteSaverOfferCatalogProjection(value.source),
    ...biteSaverCatalogBindingProjection(value.source),
  };
  const customerParentEligibilityFingerprint =
    draft.publicVisible === true &&
      customerBiteSaverRadiusGeographyIsValid(draft)
      ? biteSaverOfferParentFingerprint(value.source)
      : null;
  const customerDraft = {
    ...draft,
    ...(customerParentEligibilityFingerprint === null
      ? {}
      : {customerParentEligibilityFingerprint}),
  };
  const catalogGenerationContribution =
    biteSaverRestaurantCatalogGenerationContribution(customerDraft);
  return finalizeIndexDocument({
    ...customerDraft,
    ...(catalogGenerationContribution === null
      ? {}
      : {
          [customerBiteSaverCatalogGenerationContributionField]:
            catalogGenerationContribution,
        }),
  }, value.now);
}

export function buildBiteScoreRestaurantIndex(value: {
  sourceDocumentId: string;
  source: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (
    value.source === null ||
    readBiteScoreCatalogRestaurantId(value.sourceDocumentId) !==
      value.sourceDocumentId
  ) {
    return null;
  }
  const name = normalizedNameProjection(
    firstBoundedString(
      value.source,
      ["name", "restaurantName", "restaurant_name"],
      maximumSearchNameLength,
    ),
  );
  if (name === null) {
    return null;
  }
  const isActive = biteScoreRestaurantIsActive(value.source);
  const claim = biteScoreRestaurantClaimProjection(value.source);
  const geography = biteScoreGeography(value.source);
  const publicGeography = customerGeography(geography);
  const customerName = authoritativePublicNameProjection(
    value.source,
    ["name", "restaurantName", "restaurant_name"],
  );
  const customerPublicProjection = !isActive ||
      publicGeography === null ||
      customerName === null
    ? null
    : biteScoreRestaurantCustomerPublicProjection({
        sourceDocumentId: value.sourceDocumentId,
        source: value.source,
        name: customerName,
        geography: publicGeography,
        publicVisible: true,
        isClaimed: claim.isClaimed,
      });
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: value.sourceDocumentId,
  });
  return finalizeIndexDocumentWithCustomerFallback({
    searchIndexVersion,
    entityType: "restaurant",
    source: "biteScore",
    sourceDocumentId: value.sourceDocumentId,
    indexDocumentId,
    ...name,
    ...geography,
    publicVisible: isActive,
    customerPublicProjectionVersion:
      biteScoreRestaurantCustomerPublicProjectionVersion,
    customerPublicProjection,
    adminDirectoryVisible: true,
    isActive,
    ...claim,
    ...sourceTimestamps(value.source),
  }, value.now);
}

type DishCategoryProjection = Readonly<{
  customerEligible: boolean;
  tokens: readonly string[];
  categoryPrefixTokens: readonly string[];
  normalizedCategory: string | null;
  category: string | null;
  subcategory: string | null;
  categoryManualKeywords: string | null;
  categoryTags: readonly string[];
}>;

type RawCommaSeparatedInputAccounting = Readonly<{
  bytes: number;
  entryCount: number;
}>;

function rawCommaSeparatedInputAccounting(
  value: unknown,
  maximumCount: number,
  maximumBytes: number,
): RawCommaSeparatedInputAccounting | null {
  if (typeof value === "string") {
    if (!hasWellFormedUtf16(value)) {
      return null;
    }
    const bytes = Buffer.byteLength(value, "utf8");
    return bytes <= maximumBytes
      ? Object.freeze({ bytes, entryCount: 1 })
      : null;
  }
  if (!Array.isArray(value) || value.length > maximumCount) {
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "string" || !hasWellFormedUtf16(entry)) {
      return null;
    }
  }
  // Count the exact comma-joined raw representation without allocating it.
  let bytes = value.length === 0 ? 0 : value.length - 1;
  if (bytes > maximumBytes) {
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index] as string;
    bytes += Buffer.byteLength(entry, "utf8");
    if (bytes > maximumBytes) {
      return null;
    }
  }
  return Object.freeze({ bytes, entryCount: value.length });
}

function dishCategoryProjection(
  data: SearchIndexSourceData,
): DishCategoryProjection {
  const normalized = new Set<string>();
  const publicTags: string[] = [];
  const publicTagSet = new Set<string>();
  let combinedSourceBytes = 0;
  let combinedSourceEntries = 0;
  let withinLimits = true;

  const accountRawSource = (
    source: unknown,
    maximumCount: number,
    maximumBytes = maximumDishCategoryCombinedSourceBytes,
  ): void => {
    if (source === undefined || source === null) {
      return;
    }
    const accounting = rawCommaSeparatedInputAccounting(
      source,
      maximumCount,
      maximumBytes,
    );
    if (accounting === null) {
      withinLimits = false;
      return;
    }
    const separatorBytes = combinedSourceEntries > 0 &&
        accounting.entryCount > 0
      ? 1
      : 0;
    combinedSourceBytes += separatorBytes + accounting.bytes;
    combinedSourceEntries += accounting.entryCount;
    if (combinedSourceBytes > maximumDishCategoryCombinedSourceBytes) {
      withinLimits = false;
    }
  };

  accountRawSource(data.category, 1);
  accountRawSource(data.subcategory, 1);
  const manualValue = data.categoryManualKeywords;
  accountRawSource(
    manualValue,
    maximumDishCategoryInputCount,
    maximumDishCategoryManualKeywordBytes,
  );
  const categoryTags = data.categoryTags;
  accountRawSource(categoryTags, maximumDishCategoryInputCount);

  const addSource = (source: unknown, publicTag = false): string | null => {
    if (source === undefined || source === null) {
      return null;
    }
    if (typeof source !== "string") {
      withinLimits = false;
      return null;
    }
    if (
      !hasWellFormedUtf16(source) ||
      Buffer.byteLength(source, "utf8") > maximumSearchNameLength * 4 ||
      Array.from(source).length > maximumSearchNameLength ||
      combinedSourceBytes > maximumDishCategoryCombinedSourceBytes
    ) {
      withinLimits = false;
      return null;
    }
    const text = boundedPublicSingleLineString(source, maximumSearchNameLength);
    if (text === null) {
      return null;
    }
    try {
      const token = normalizeSearchName(text);
      if (!normalized.has(token)) {
        if (normalized.size >= maximumDishCategorySourceCount) {
          withinLimits = false;
          return text;
        }
        normalized.add(token);
      }
      if (publicTag && !publicTagSet.has(text)) {
        if (publicTags.length >= maximumDishCategorySourceCount) {
          withinLimits = false;
          return text;
        }
        publicTagSet.add(text);
        publicTags.push(text);
      }
    } catch {
      // Unsafe or non-searchable optional category text is omitted.
    }
    return text;
  };

  const category = addSource(data.category);
  const subcategory = addSource(data.subcategory);
  if (manualValue !== undefined && manualValue !== null) {
    if (typeof manualValue === "string") {
      if (!hasWellFormedUtf16(manualValue)) {
        withinLimits = false;
      } else {
        const manualBytes = Buffer.byteLength(manualValue, "utf8");
        if (manualBytes > maximumDishCategoryManualKeywordBytes) {
          withinLimits = false;
        } else {
          let entryStart = 0;
          let entryCount = 0;
          for (let index = 0; index <= manualValue.length; index += 1) {
            if (index !== manualValue.length && manualValue[index] !== ",") {
              continue;
            }
            entryCount += 1;
            if (entryCount > maximumDishCategoryInputCount) {
              withinLimits = false;
              break;
            }
            addSource(manualValue.slice(entryStart, index));
            entryStart = index + 1;
          }
        }
      }
    } else if (Array.isArray(manualValue)) {
      if (
        manualValue.length > maximumDishCategoryInputCount ||
        rawCommaSeparatedInputAccounting(
          manualValue,
          maximumDishCategoryInputCount,
          maximumDishCategoryManualKeywordBytes,
        ) === null
      ) {
        withinLimits = false;
      } else {
        for (const entry of manualValue) {
          addSource(entry);
        }
      }
    } else {
      withinLimits = false;
    }
  }

  if (categoryTags !== undefined && categoryTags !== null) {
    if (
      !Array.isArray(categoryTags) ||
      categoryTags.length > maximumDishCategoryInputCount
    ) {
      withinLimits = false;
    } else {
      for (const tag of categoryTags) {
        addSource(tag, true);
      }
    }
  }

  let normalizedCategory: string | null = null;
  if (category !== null) {
    try {
      normalizedCategory = normalizeSearchName(category);
    } catch {
      normalizedCategory = null;
    }
  }
  const categoryPrefixTokens = normalizedCategory === null
    ? Object.freeze([] as string[])
    : buildWordPrefixTokens(normalizedCategory).slice(
        0,
        maximumWordPrefixTokenCount,
      );
  const categoryManualKeywords = typeof manualValue === "string"
    ? boundedPublicSingleLineString(manualValue, maximumSearchNameLength)
    : null;

  return Object.freeze({
    customerEligible: withinLimits,
    tokens: withinLimits
      ? Object.freeze([...normalized].sort())
      : Object.freeze([] as string[]),
    categoryPrefixTokens,
    normalizedCategory,
    category,
    subcategory,
    categoryManualKeywords,
    categoryTags: Object.freeze(publicTags),
  });
}

function optionalComponentScore(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10
    ? value
    : null;
}

function optionalOverallBiteScore(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

function biteScoreDishCustomerPublicProjection(value: {
  sourceDocumentId: string;
  restaurantDocumentId: string;
  dish: SearchIndexSourceData;
  restaurant: SearchIndexSourceData;
  name: NormalizedNameProjection;
  restaurantName: NormalizedNameProjection;
  geography: CustomerGeographyProjection;
  publicVisible: boolean;
  categoryProjection: DishCategoryProjection;
  overallBiteScore: number;
  ratingCount: number;
  aggregate: SearchIndexSourceData;
  primaryImageUrl: string | null;
}): Readonly<Record<string, unknown>> | null {
  const restaurantCity = boundedPublicSingleLineString(
    value.restaurant.city,
    maximumPublicCityLength,
  );
  const restaurantState = boundedPublicSingleLineString(
    value.restaurant.state,
    maximumPublicStateLength,
  );
  const restaurantZipCode = boundedPublicSingleLineString(
    value.restaurant.zipCode,
    maximumPublicZipCodeLength,
  );
  if (
    restaurantCity === null ||
    restaurantState === null ||
    restaurantZipCode === null
  ) {
    return null;
  }
  const priceLabel = boundedPublicSingleLineString(
    value.dish.priceLabel,
    maximumSearchNameLength,
  );
  const overallImpressionAverage = optionalComponentScore(
    value.aggregate.overallImpressionAverage,
  );
  const tastinessScoreAverage = optionalComponentScore(
    value.aggregate.tastinessScoreAverage,
  );
  const qualityScoreAverage = optionalComponentScore(
    value.aggregate.qualityScoreAverage,
  );
  const valueScoreAverage = optionalComponentScore(
    value.aggregate.valueScoreAverage,
  );

  return boundedCustomerPublicProjection(Object.freeze({
    customerPublicProjectionVersion:
      biteScoreDishCustomerPublicProjectionVersion,
    source: "biteScore",
    entityType: "dish",
    sourceDocumentId: value.sourceDocumentId,
    restaurantSourceDocumentId: value.restaurantDocumentId,
    publicVisible: value.publicVisible,
    displayName: value.name.displayName,
    normalizedName: value.name.normalizedName,
    namePrefixTokens: value.name.namePrefixTokens,
    restaurantDisplayName: value.restaurantName.displayName,
    restaurantNormalizedName: value.restaurantName.normalizedName,
    restaurantNamePrefixTokens: value.restaurantName.namePrefixTokens,
    restaurantCity,
    restaurantState,
    restaurantZipCode,
    ...value.geography,
    categoryTokens: value.categoryProjection.tokens,
    categoryPrefixTokens: value.categoryProjection.categoryPrefixTokens,
    ...(value.categoryProjection.normalizedCategory === null
      ? {}
      : { normalizedCategory: value.categoryProjection.normalizedCategory }),
    ...(value.categoryProjection.category === null
      ? {}
      : { category: value.categoryProjection.category }),
    ...(value.categoryProjection.subcategory === null
      ? {}
      : { subcategory: value.categoryProjection.subcategory }),
    ...(value.categoryProjection.categoryManualKeywords === null
      ? {}
      : {
          categoryManualKeywords:
            value.categoryProjection.categoryManualKeywords,
        }),
    categoryTags: value.categoryProjection.categoryTags,
    ...(priceLabel === null ? {} : { priceLabel }),
    overallBiteScore: value.overallBiteScore,
    ratingCount: value.ratingCount,
    ...(overallImpressionAverage === null ? {} : { overallImpressionAverage }),
    ...(tastinessScoreAverage === null ? {} : { tastinessScoreAverage }),
    ...(qualityScoreAverage === null ? {} : { qualityScoreAverage }),
    ...(valueScoreAverage === null ? {} : { valueScoreAverage }),
    ...(value.primaryImageUrl === null
      ? {}
      : { primaryImageUrl: value.primaryImageUrl }),
  }));
}

export function buildBiteScoreDishIndex(value: {
  sourceDocumentId: string;
  dish: SearchIndexSourceData | null;
  restaurantDocumentId: string | null;
  restaurant: SearchIndexSourceData | null;
  aggregate: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (
    value.dish === null ||
    value.restaurant === null ||
    value.restaurantDocumentId === null ||
    readBiteScoreCatalogRestaurantId(value.sourceDocumentId) !==
      value.sourceDocumentId ||
    readBiteScoreCatalogRestaurantId(value.restaurantDocumentId) !==
      value.restaurantDocumentId ||
    readBiteScoreCatalogRestaurantId(value.dish.restaurantId) !==
      value.restaurantDocumentId
  ) {
    return null;
  }
  const name = normalizedNameProjection(value.dish.name);
  const restaurantName = normalizedNameProjection(
    firstBoundedString(
      value.restaurant,
      ["name", "restaurantName", "restaurant_name"],
      maximumSearchNameLength,
    ),
  );
  if (name === null || restaurantName === null) {
    return null;
  }
  const mergedIntoDishId = value.dish.mergedIntoDishId;
  const dishActive = value.dish.isActive !== false &&
    (mergedIntoDishId === undefined ||
      mergedIntoDishId === null ||
      mergedIntoDishId === "");
  const restaurantActive = biteScoreRestaurantIsActive(value.restaurant);
  const categoryProjection = dishCategoryProjection(value.dish);
  const tokens = categoryProjection.tokens;
  const normalizedCategory = categoryProjection.normalizedCategory;
  const categoryPrefixTokens = categoryProjection.categoryPrefixTokens;
  const primaryImageUrl = publicUrl(value.dish.primaryImageUrl);
  const customerPrimaryImageUrl = publicProfileUrl(
    value.dish.primaryImageUrl,
    maximumPublicImageUrlLength,
  );
  const primaryImageId = boundedString(value.dish.primaryImageId, 1_500);
  const aggregateDishId = value.aggregate === null
    ? null
    : readBiteScoreCatalogRestaurantId(value.aggregate.dishId);
  const aggregateRestaurantId = value.aggregate === null
    ? null
    : readBiteScoreCatalogRestaurantId(value.aggregate.restaurantId);
  const aggregate = value.aggregate !== null &&
    (aggregateDishId === null || aggregateDishId === value.sourceDocumentId) &&
    (aggregateRestaurantId === null ||
      aggregateRestaurantId === value.restaurantDocumentId)
    ? value.aggregate
    : {};
  const overallBiteScore =
    optionalOverallBiteScore(aggregate.overallBiteScore) ?? 0;
  const ratingCount = typeof aggregate.ratingCount === "number" &&
    Number.isSafeInteger(aggregate.ratingCount) &&
    aggregate.ratingCount >= 0
    ? aggregate.ratingCount
    : 0;
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: value.sourceDocumentId,
  });
  const geography = biteScoreGeography(value.restaurant);
  const publicGeography = customerGeography(geography);
  const publicVisible = dishActive && restaurantActive;
  const customerName = authoritativePublicNameProjection(
    value.dish,
    ["name"],
  );
  const customerRestaurantName = authoritativePublicNameProjection(
    value.restaurant,
    ["name", "restaurantName", "restaurant_name"],
  );
  const customerPublicProjection = !publicVisible ||
      publicGeography === null ||
      customerName === null ||
      customerRestaurantName === null ||
      !categoryProjection.customerEligible
    ? null
    : biteScoreDishCustomerPublicProjection({
        sourceDocumentId: value.sourceDocumentId,
        restaurantDocumentId: value.restaurantDocumentId,
        dish: value.dish,
        restaurant: value.restaurant,
        name: customerName,
        restaurantName: customerRestaurantName,
        geography: publicGeography,
        publicVisible: true,
        categoryProjection,
        overallBiteScore,
        ratingCount,
        aggregate,
        primaryImageUrl: customerPrimaryImageUrl,
      });
  return finalizeIndexDocumentWithCustomerFallback({
    searchIndexVersion,
    entityType: "dish",
    source: "biteScore",
    sourceDocumentId: value.sourceDocumentId,
    restaurantSourceDocumentId: value.restaurantDocumentId,
    indexDocumentId,
    ...name,
    categoryTokens: tokens,
    ...(normalizedCategory === null ? {} : { normalizedCategory }),
    categoryPrefixTokens,
    restaurantDisplayName: restaurantName.displayName,
    restaurantNormalizedName: restaurantName.normalizedName,
    restaurantNamePrefixTokens: restaurantName.namePrefixTokens,
    ...geography,
    dishActive,
    restaurantActive,
    restaurantClaimed: value.restaurant.isClaimed === true,
    publicVisible,
    customerPublicProjectionVersion:
      biteScoreDishCustomerPublicProjectionVersion,
    customerPublicProjection,
    adminVisible: true,
    overallBiteScore,
    ratingCount,
    ...(optionalComponentScore(aggregate.overallImpressionAverage) === null
      ? {}
      : { overallImpressionAverage: aggregate.overallImpressionAverage }),
    ...(optionalComponentScore(aggregate.tastinessScoreAverage) === null
      ? {}
      : { tastinessScoreAverage: aggregate.tastinessScoreAverage }),
    ...(optionalComponentScore(aggregate.qualityScoreAverage) === null
      ? {}
      : { qualityScoreAverage: aggregate.qualityScoreAverage }),
    ...(optionalComponentScore(aggregate.valueScoreAverage) === null
      ? {}
      : { valueScoreAverage: aggregate.valueScoreAverage }),
    ...(primaryImageUrl === null ? {} : { primaryImageUrl }),
    ...(primaryImageId === null ? {} : { primaryImageId }),
    ...sourceTimestamps(value.dish),
    ...(readDate(aggregate.updatedAt) === null
      ? {}
      : { aggregateUpdatedAt: readDate(aggregate.updatedAt) }),
  }, value.now);
}

const customerBiteSaverOfferContributionFields = Object.freeze([
  "customerOfferProjectionVersion",
  "source",
  "entityType",
  "offerType",
  "restaurantAccountId",
  "sourceDocumentId",
  "indexDocumentId",
  "displayTitle",
  "restaurantDisplayName",
  "city",
  "zipCode",
  "restaurantBio",
  "zip5",
  "normalizedCity",
  "normalizedState",
  "cityStateKey",
  "latitude",
  "longitude",
  "geohash",
  "primaryImageUrl",
  "restaurantPrimaryImageUrl",
  "sourceCreatedAt",
  "sourceCreatedAtOrderKey",
  "createdAt",
  "customerDiscoverable",
  "presentationTypeRank",
  "customerParentEligibilityFingerprint",
  "customerSearchNormalizerVersion",
  "customerSearchMatcherVersion",
  "searchMatchValues",
  "searchMatchComplete",
  "details",
  "couponRestaurantName",
  "usageRule",
  "couponCode",
  "couponNumber",
  "explicitActive",
  "startAt",
  "endAt",
  "startTime",
  "endTime",
  "expiresText",
  "isProximityOnly",
  "proximityRadiusMiles",
  "availabilityMode",
  "daysOfWeek",
  "allDay",
  "hideWhenUnavailable",
  "expiresAt",
] as const);

function customerBiteSaverOfferCatalogContribution(value: {
  mergedProjection: Readonly<Record<string, unknown>>;
  rawDisplayInputs: readonly unknown[];
}): string | null {
  const discoverable = value.mergedProjection.customerDiscoverable === true;
  return discoverable
    ? createCustomerBiteSaverCatalogGenerationContribution(Object.freeze({
        ...selectedProjectionFields(
          value.mergedProjection,
          customerBiteSaverOfferContributionFields,
        ),
        rawDisplayInputFingerprints: Object.freeze(
          value.rawDisplayInputs.map(fingerprintScalar),
        ),
      }))
    : null;
}

function finalizeBiteSaverOfferIndex(value: {
  base: Readonly<Record<string, unknown>>;
  customerProjection: Readonly<Record<string, unknown>>;
  rawDisplayInputs: readonly unknown[];
  now: Date;
}): SearchIndexDocument {
  const mergedProjection = {
    ...value.base,
    ...value.customerProjection,
  };
  const catalogGenerationContribution =
    customerBiteSaverOfferCatalogContribution({
      mergedProjection,
      rawDisplayInputs: value.rawDisplayInputs,
    });
  const completeDraft: Record<string, unknown> = {
    ...mergedProjection,
    ...(catalogGenerationContribution === null
      ? {}
      : {
          [customerBiteSaverCatalogGenerationContributionField]:
            catalogGenerationContribution,
        }),
  };
  try {
    return finalizeIndexDocument(completeDraft, value.now);
  } catch {
    if (mergedProjection.customerDiscoverable !== true) {
      throw new Error("BiteSaver offer index document is invalid or oversized.");
    }
  }

  const withoutLargeDisplay = {...completeDraft};
  delete withoutLargeDisplay.details;
  try {
    return finalizeIndexDocument(withoutLargeDisplay, value.now);
  } catch {
    // The exhaustive normalized corpus can itself exceed the private ceiling.
  }

  const boundedFallback = {
    ...withoutLargeDisplay,
    searchMatchValues: Object.freeze([] as string[]),
    searchMatchComplete: false,
  };
  return finalizeIndexDocument(boundedFallback, value.now);
}

function offerBase(value: {
  offerType: "coupon" | "dailySpecial";
  sourceKind: "biteSaverCoupon" | "biteSaverDailySpecial";
  restaurantAccountId: string;
  sourceDocumentId: string;
  offer: SearchIndexSourceData;
  parent: BiteSaverOfferParentDescriptor;
}): Record<string, unknown> | null {
  const title = normalizedNameProjection(value.offer.title);
  const restaurantName = value.parent.restaurantName;
  if (title === null || restaurantName === null) {
    return null;
  }
  const descriptionSummary = boundedDescriptionSummary(value.offer.details);
  const imageUrl = publicUrl(value.offer.imageUrl);
  const restaurantAccountIdOrderKey =
    dartUtf16FirestoreBytesOrderKey(value.restaurantAccountId);
  if (
    restaurantAccountIdOrderKey.byteLength >
      customerBiteSaverMaximumIndexedOrderKeyBytes
  ) {
    throw new Error("BiteSaver restaurant account ID is too large.");
  }
  return {
    searchIndexVersion,
    entityType: "offer",
    offerType: value.offerType,
    source: "biteSaver",
    // Firestore rejects a 1,500-byte string as an equality-filter value. The
    // reversible same-length Bytes key remains queryable at the source-ID
    // ceiling and preserves the authoritative account identity exactly.
    restaurantAccountId: restaurantAccountIdOrderKey,
    sourceDocumentId: value.sourceDocumentId,
    indexDocumentId: createSearchIndexDocumentId({
      entityKind: "offer",
      sourceKind: value.sourceKind,
      sourceDocumentId: value.sourceDocumentId,
      parentSourceDocumentId: value.restaurantAccountId,
    }),
    displayTitle: title.displayName,
    normalizedTitle: title.normalizedName,
    titlePrefixTokens: title.namePrefixTokens,
    restaurantDisplayName: restaurantName.displayName,
    restaurantNormalizedName: restaurantName.normalizedName,
    restaurantNamePrefixTokens: restaurantName.namePrefixTokens,
    ...value.parent.geography,
    ...(descriptionSummary === null ? {} : { descriptionSummary }),
    ...(imageUrl === null ? {} : { primaryImageUrl: imageUrl }),
    ...(value.parent.restaurantPrimaryImageUrl === null
      ? {}
      : {
          restaurantPrimaryImageUrl:
            value.parent.restaurantPrimaryImageUrl,
        }),
    ...sourceTimestamps(value.offer),
  };
}

function customerBiteSaverOfferCore(value: {
  parent: BiteSaverOfferParentDescriptor;
  parentSource: SearchIndexSourceData;
  offer: SearchIndexSourceData;
  presentationTypeRank: 0 | 1;
  explicitActive: boolean;
  structurallyValid: boolean;
  offerSearchValues: readonly unknown[];
  customerFields: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const parentSearchValues = [
    value.parent.restaurantName?.displayName,
    value.parent.restaurantCity,
    value.parent.restaurantZipCode,
    value.parent.restaurantBio,
  ];
  const searchMatch = customerBiteSaverSearchMatchProjection([
    ...parentSearchValues,
    ...value.offerSearchValues,
  ]);
  const sourceCreatedAt = readDate(value.offer.createdAt);
  const sourceCreatedAtOrderKey = customerBiteSaverTimestampOrderKey(
    value.offer.createdAt,
  );
  const customerDiscoverable = value.parent.customerOffersAllowed &&
    customerBiteSaverRadiusGeographyIsValid(value.parent.geography) &&
    sourceCreatedAt !== null &&
    sourceCreatedAtOrderKey !== null &&
    value.explicitActive &&
    value.structurallyValid &&
    searchMatch.complete;
  if (!customerDiscoverable) {
    return Object.freeze({
      customerOfferProjectionVersion: customerBiteSaverOfferProjectionVersion,
      customerDiscoverable: false,
    });
  }
  return Object.freeze({
    customerOfferProjectionVersion: customerBiteSaverOfferProjectionVersion,
    customerDiscoverable: true,
    presentationTypeRank: value.presentationTypeRank,
    customerParentEligibilityFingerprint:
      biteSaverOfferParentFingerprint(value.parentSource),
    customerSearchNormalizerVersion: customerBiteSaverNormalizerVersion,
    customerSearchMatcherVersion: customerBiteSaverMatcherVersion,
    searchMatchValues: searchMatch.values,
    searchMatchComplete: true,
    sourceCreatedAt,
    [customerBiteSaverOfferSourceCreatedAtOrderKeyField]:
      sourceCreatedAtOrderKey,
    // The centralized availability evaluator also consumes raw-source-shaped
    // records. Preserve this safe alias for its today-only fallback while the
    // explicit sourceCreatedAt field remains authoritative for ordering.
    createdAt: sourceCreatedAt,
    explicitActive: true,
    ...(value.parent.restaurantCity === null
      ? {}
      : {city: value.parent.restaurantCity}),
    ...(value.parent.restaurantZipCode === null
      ? {}
      : {zipCode: value.parent.restaurantZipCode}),
    ...(value.parent.restaurantBio === null
      ? {}
      : {restaurantBio: value.parent.restaurantBio}),
    ...value.customerFields,
  });
}

export function buildBiteSaverCouponOfferIndex(value: {
  restaurantAccountId: string;
  sourceDocumentId: string;
  offer: SearchIndexSourceData | null;
  restaurant: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (value.offer === null || value.restaurant === null) {
    return null;
  }
  const parent = biteSaverOfferParentDescriptor(value.restaurant);
  const base = offerBase({
    offerType: "coupon",
    sourceKind: "biteSaverCoupon",
    restaurantAccountId: value.restaurantAccountId,
    sourceDocumentId: value.sourceDocumentId,
    offer: value.offer,
    parent,
  });
  if (base === null) {
    return null;
  }
  const parsedStartAt = readCustomerOfferDate(value.offer.startTime, "ceil");
  const parsedStructuredEndAt = readCustomerOfferDate(value.offer.endTime);
  // Match Coupon.tryFromFirestore: only an invalid structured end falls back to
  // the legacy expires value. A valid local date still owns the field even
  // though projection has no customer IANA zone with which to resolve it.
  const parsedEndAt = parsedStructuredEndAt.kind === "invalid"
    ? readCustomerOfferDate(value.offer.expires)
    : parsedStructuredEndAt;
  const endSource = parsedStructuredEndAt.kind === "invalid"
    ? value.offer.expires
    : value.offer.endTime;
  const startAt = parsedStartAt.kind === "parsed" ? parsedStartAt.date : null;
  const endAt = parsedEndAt.kind === "parsed" ? parsedEndAt.date : null;
  const projectedStartTime = startAt ??
    unresolvedCustomerOfferLocalDateString(
      value.offer.startTime,
      parsedStartAt,
    );
  const projectedEndTime = endAt ??
    unresolvedCustomerOfferLocalDateString(endSource, parsedEndAt);
  const scheduleNeedsTimeZone =
    parsedStartAt.kind === "timeZoneRequired" ||
    parsedEndAt.kind === "timeZoneRequired";
  const explicitActive = value.offer.isActive !== false && value.offer.active !== false;
  // Projection cannot safely interpret a Dart local timestamp without the
  // request's IANA zone. Keep it discoverable for live evaluation but do not
  // mark it public-visible using the Functions host timezone.
  const scheduleActive = !scheduleNeedsTimeZone &&
    (startAt === null || value.now >= startAt) &&
    (endAt === null || value.now <= endAt);
  const offerActive = explicitActive && scheduleActive;
  const rawUsageRule = typeof value.offer.usageRule === "string" &&
      value.offer.usageRule.trim().length > 0
    ? value.offer.usageRule
    : "Once per customer";
  const usageRule = customerOfferSingleLine(rawUsageRule);
  const details = customerOfferDetails(value.offer.details);
  const couponRestaurantName = customerOfferSingleLine(value.offer.restaurant);
  const safeCouponCode = customerOfferSingleLine(value.offer.couponCode);
  const safeCouponNumber = couponNumber(value.offer.couponNumber);
  const expiresText = typeof value.offer.expires === "string"
    ? customerOfferSingleLine(value.offer.expires)
    : null;
  const proximityRadiusMiles = readCustomerBiteSaverFiniteDouble(
    value.offer.proximityRadiusMiles,
  );
  const isProximityOnly =
    readCustomerBiteSaverCouponBoolean(value.offer.isProximityOnly) ?? false;
  const baseDocument = {
    ...base,
    publicVisible:
      parent.publicOffersAllowed && offerActive,
    adminVisible: true,
    offerActive,
    ...(startAt === null ? {} : { startAt }),
    ...(endAt === null ? {} : { endAt }),
    isProximityOnly,
  };
  const customerProjection = customerBiteSaverOfferCore({
    parent,
    parentSource: value.restaurant,
    offer: value.offer,
    presentationTypeRank: 1,
    explicitActive,
    structurallyValid: usageRule !== null,
    offerSearchValues: [
      value.offer.title,
      value.offer.restaurant,
      rawUsageRule,
      value.offer.couponCode,
    ],
    customerFields: Object.freeze({
      ...(details === null ? {} : {details}),
      ...(couponRestaurantName === null ? {} : {couponRestaurantName}),
      ...(usageRule === null ? {} : {usageRule}),
      ...(safeCouponCode === null ? {} : {couponCode: safeCouponCode}),
      ...(safeCouponNumber === null ? {} : {couponNumber: safeCouponNumber}),
      ...(startAt === null ? {} : {startAt}),
      ...(endAt === null ? {} : {endAt}),
      // Keep the v1 aliases above and expose the raw-source-shaped names used
      // by the shared current-offer evaluator.
      ...(projectedStartTime === null
        ? {}
        : {startTime: projectedStartTime}),
      ...(projectedEndTime === null ? {} : {endTime: projectedEndTime}),
      ...(expiresText === null ? {} : {expiresText}),
      isProximityOnly,
      ...(proximityRadiusMiles === null ? {} : {proximityRadiusMiles}),
    }),
  });
  return finalizeBiteSaverOfferIndex({
    base: baseDocument,
    customerProjection,
    rawDisplayInputs: [
      value.offer.title,
      value.offer.restaurant,
      rawUsageRule,
      value.offer.couponCode,
      value.offer.couponNumber,
      value.offer.details,
      value.offer.expires,
      value.offer.isProximityOnly,
      value.offer.proximityRadiusMiles,
    ],
    now: value.now,
  });
}

function normalizedDays(value: unknown): readonly number[] {
  return normalizeCustomerBiteSaverDailySpecialDays(value);
}

function normalizedTime(value: unknown): string | null {
  const text = readString(value);
  if (text === null) {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})$/u.exec(text);
  if (match === null) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : null;
}

function minutesSinceMidnight(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function dailySpecialSchedule(value: {
  offer: SearchIndexSourceData;
  now: Date;
}): {
  availabilityMode: "todayOnly" | "specificDays";
  daysOfWeek: readonly number[];
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  hideWhenUnavailable: boolean;
  expiresAt: Date | string | null;
  offerActive: boolean;
} {
  const availabilityMode = customerBiteSaverDailySpecialAvailabilityMode(
    value.offer.availabilityMode,
  );
  const daysOfWeek = normalizedDays(value.offer.daysOfWeek);
  const allDay =
    readCustomerBiteSaverDailySpecialBoolean(value.offer.allDay) ?? true;
  const startTime = allDay ? null : normalizedTime(value.offer.startTime);
  const endTime = allDay ? null : normalizedTime(value.offer.endTime);
  const hideWhenUnavailable =
    readCustomerBiteSaverDailySpecialBoolean(
      value.offer.hideWhenUnavailable,
    ) ?? true;
  const parsedExpiresAt = readCustomerOfferDate(value.offer.expiresAt, "ceil");
  const expiresAt = parsedExpiresAt.kind === "parsed"
    ? parsedExpiresAt.date
    : null;
  const projectedExpiresAt = expiresAt ??
    unresolvedCustomerOfferLocalDateString(
      value.offer.expiresAt,
      parsedExpiresAt,
    );
  let effectiveExpiresAt = expiresAt;
  if (
    availabilityMode === "todayOnly" &&
    effectiveExpiresAt === null &&
    parsedExpiresAt.kind === "invalid"
  ) {
    const basis = readDate(value.offer.createdAt) ?? readDate(value.offer.updatedAt);
    if (basis !== null) {
      effectiveExpiresAt = new Date(
        basis.getFullYear(),
        basis.getMonth(),
        basis.getDate() + 1,
      );
    }
  }
  const active =
    readCustomerBiteSaverDailySpecialBoolean(value.offer.isActive) ?? true;
  const notExpired = parsedExpiresAt.kind !== "timeZoneRequired" &&
    (availabilityMode !== "todayOnly" ||
    effectiveExpiresAt === null ||
    value.now < effectiveExpiresAt);
  const weekday = value.now.getDay() === 0 ? 7 : value.now.getDay();
  const scheduledToday = availabilityMode === "todayOnly" ||
    daysOfWeek.includes(weekday);
  const currentMinutes = value.now.getHours() * 60 + value.now.getMinutes();
  const startMinutes = minutesSinceMidnight(startTime);
  const endMinutes = minutesSinceMidnight(endTime);
  const availableNow = allDay ||
    (startMinutes !== null &&
      endMinutes !== null &&
      currentMinutes >= startMinutes &&
      currentMinutes <= endMinutes);
  const offerActive = active &&
    notExpired &&
    scheduledToday &&
    (!hideWhenUnavailable || availableNow);
  return {
    availabilityMode,
    daysOfWeek,
    allDay,
    startTime,
    endTime,
    hideWhenUnavailable,
    expiresAt: projectedExpiresAt,
    offerActive,
  };
}

export function buildBiteSaverDailySpecialOfferIndex(value: {
  restaurantAccountId: string;
  sourceDocumentId: string;
  offer: SearchIndexSourceData | null;
  restaurant: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (value.offer === null || value.restaurant === null) {
    return null;
  }
  const parent = biteSaverOfferParentDescriptor(value.restaurant);
  const storedRestaurantId = readString(value.offer.restaurantId);
  const storedOwnerUid = readString(value.offer.ownerUid);
  if (
    (storedRestaurantId !== null &&
      storedRestaurantId !== value.restaurantAccountId) ||
    (storedOwnerUid !== null && storedOwnerUid !== value.restaurantAccountId)
  ) {
    return null;
  }
  const base = offerBase({
    offerType: "dailySpecial",
    sourceKind: "biteSaverDailySpecial",
    restaurantAccountId: value.restaurantAccountId,
    sourceDocumentId: value.sourceDocumentId,
    offer: value.offer,
    parent,
  });
  if (base === null) {
    return null;
  }
  const schedule = dailySpecialSchedule({ offer: value.offer, now: value.now });
  const explicitActive =
    readCustomerBiteSaverDailySpecialBoolean(value.offer.isActive) ?? true;
  const details = customerOfferDetails(value.offer.details);
  const baseDocument = {
    ...base,
    publicVisible:
      parent.publicOffersAllowed &&
      schedule.offerActive,
    adminVisible: true,
    offerActive: schedule.offerActive,
    availabilityMode: schedule.availabilityMode,
    daysOfWeek: schedule.daysOfWeek,
    allDay: schedule.allDay,
    ...(schedule.startTime === null ? {} : { startTime: schedule.startTime }),
    ...(schedule.endTime === null ? {} : { endTime: schedule.endTime }),
    hideWhenUnavailable: schedule.hideWhenUnavailable,
    ...(schedule.expiresAt === null ? {} : { expiresAt: schedule.expiresAt }),
  };
  const customerProjection = customerBiteSaverOfferCore({
    parent,
    parentSource: value.restaurant,
    offer: value.offer,
    presentationTypeRank: 0,
    explicitActive,
    structurallyValid: true,
    offerSearchValues: [value.offer.title, value.offer.details],
    customerFields: Object.freeze({
      ...(details === null ? {} : {details}),
      availabilityMode: schedule.availabilityMode,
      daysOfWeek: schedule.daysOfWeek,
      allDay: schedule.allDay,
      ...(schedule.startTime === null ? {} : {startTime: schedule.startTime}),
      ...(schedule.endTime === null ? {} : {endTime: schedule.endTime}),
      hideWhenUnavailable: schedule.hideWhenUnavailable,
      ...(schedule.expiresAt === null ? {} : {expiresAt: schedule.expiresAt}),
    }),
  });
  return finalizeBiteSaverOfferIndex({
    base: baseDocument,
    customerProjection,
    rawDisplayInputs: [
      value.offer.title,
      value.offer.details,
      value.offer.availabilityMode,
      value.offer.daysOfWeek,
      value.offer.allDay,
      value.offer.startTime,
      value.offer.endTime,
      value.offer.hideWhenUnavailable,
      value.offer.expiresAt,
    ],
    now: value.now,
  });
}
