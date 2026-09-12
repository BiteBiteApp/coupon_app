export const customerBiteSaverNormalizerVersion =
  "bitestar.bitesaver-home-search-normalizer.v1" as const;
export const customerBiteSaverMatcherVersion =
  "bitestar.bitesaver-home-search-matcher.v1" as const;
export const customerBiteSaverNameOrderVersion =
  "bitestar.dart-utf16-order.v1" as const;
export const maximumCustomerBiteSaverSearchScalars = 200;
export const maximumCustomerBiteSaverSearchUtf8Bytes =
  maximumCustomerBiteSaverSearchScalars * 4;

const supportedApostrophePattern = /[\u2018\u2019\u201b\u2032']/gu;
const unsupportedSearchCharacterPattern = /[^a-z0-9]+/gu;

export class CustomerBiteSaverSearchTextError extends Error {
  readonly code = "invalid_search_text";

  constructor() {
    super("The search text is invalid.");
    this.name = "CustomerBiteSaverSearchTextError";
  }
}

export function hasWellFormedCustomerBiteSaverUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function requireCustomerBiteSaverSearchText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !hasWellFormedCustomerBiteSaverUtf16(value) ||
    Array.from(value).length > maximumCustomerBiteSaverSearchScalars ||
    Buffer.byteLength(value, "utf8") > maximumCustomerBiteSaverSearchUtf8Bytes
  ) {
    throw new CustomerBiteSaverSearchTextError();
  }
  return value;
}

/**
 * Compatibility normalizer for the existing BiteSaver Home implementation.
 * It deliberately does not use NFKD, transliteration, token-prefix matching,
 * cuisine/category data, or locale-sensitive collation.
 */
export function normalizeCustomerBiteSaverSearchText(value: string): string {
  if (!hasWellFormedCustomerBiteSaverUtf16(value)) {
    throw new CustomerBiteSaverSearchTextError();
  }
  return value
    .trim()
    .toLowerCase()
    .replace(supportedApostrophePattern, "")
    .replace(unsupportedSearchCharacterPattern, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function customerBiteSaverSearchValueMatches(
  normalizedQuery: string,
  value: unknown,
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }
  return typeof value === "string" &&
    normalizeCustomerBiteSaverSearchText(value).includes(normalizedQuery);
}

export type CustomerBiteSaverRestaurantMatchSource = Readonly<{
  displayName?: unknown;
  city?: unknown;
  zipCode?: unknown;
  bio?: unknown;
}>;

export type CustomerBiteSaverCouponMatchSource = Readonly<{
  title?: unknown;
  restaurant?: unknown;
  usageRule?: unknown;
  couponCode?: unknown;
}>;

export type CustomerBiteSaverDailySpecialMatchSource = Readonly<{
  title?: unknown;
  details?: unknown;
}>;

function anyValueMatches(
  normalizedQuery: string,
  values: readonly unknown[],
): boolean {
  return values.some((value) =>
    customerBiteSaverSearchValueMatches(normalizedQuery, value));
}

export function customerBiteSaverRestaurantMatches(
  normalizedQuery: string,
  restaurant: CustomerBiteSaverRestaurantMatchSource,
): boolean {
  return anyValueMatches(normalizedQuery, [
    restaurant.displayName,
    restaurant.city,
    restaurant.zipCode,
    restaurant.bio,
  ]);
}

export function customerBiteSaverCouponMatches(
  normalizedQuery: string,
  restaurant: CustomerBiteSaverRestaurantMatchSource,
  coupon: CustomerBiteSaverCouponMatchSource,
): boolean {
  return customerBiteSaverRestaurantMatches(normalizedQuery, restaurant) ||
    anyValueMatches(normalizedQuery, [
      coupon.title,
      coupon.restaurant,
      coupon.usageRule,
      coupon.couponCode,
    ]);
}

export function customerBiteSaverDailySpecialMatches(
  normalizedQuery: string,
  restaurant: CustomerBiteSaverRestaurantMatchSource,
  special: CustomerBiteSaverDailySpecialMatchSource,
): boolean {
  return customerBiteSaverRestaurantMatches(normalizedQuery, restaurant) ||
    anyValueMatches(normalizedQuery, [special.title, special.details]);
}

export function customerBiteSaverSearchMatchValues(
  values: readonly unknown[],
): readonly string[] {
  const normalized = values.map((value) => {
    if (typeof value !== "string") {
      return "";
    }
    return normalizeCustomerBiteSaverSearchText(value);
  });
  return Object.freeze(normalized);
}

export function customerBiteSaverMatchValuesContain(
  normalizedQuery: string,
  values: readonly unknown[],
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }
  return values.some((value) =>
    typeof value === "string" && value.includes(normalizedQuery));
}

/**
 * Firestore orders strings by UTF-8. Encoding every UTF-16 code unit as four
 * lowercase hexadecimal digits gives the same lexicographic order as Dart's
 * String.compareTo, including unpaired ordering around supplementary values.
 */
export function dartUtf16OrderKey(value: string): string {
  if (!hasWellFormedCustomerBiteSaverUtf16(value)) {
    throw new CustomerBiteSaverSearchTextError();
  }
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    result += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return result;
}

/**
 * Firestore Bytes key with Dart String.compareTo ordering.
 *
 * Well-formed UTF-8 already has the same order as UTF-16 through U+D7FF. The
 * only differing blocks are supplementary scalars (UTF-8 F0..F4, UTF-16
 * surrogate pairs) and BMP scalars U+E000..U+FFFF (UTF-8 EE..EF). Moving the
 * former lead bytes to EE..F2 and the latter to F3..F4 puts those blocks in
 * UTF-16 order without changing any key's byte length.
 */
export function dartUtf16FirestoreBytesOrderKey(value: string): Buffer {
  if (!hasWellFormedCustomerBiteSaverUtf16(value)) {
    throw new CustomerBiteSaverSearchTextError();
  }
  const result = Buffer.from(value, "utf8");
  for (let index = 0; index < result.length; index += 1) {
    const byte = result[index];
    if (byte >= 0xf0 && byte <= 0xf4) {
      result[index] = byte - 2;
    } else if (byte >= 0xee && byte <= 0xef) {
      result[index] = byte + 5;
    }
  }
  return result;
}

/** Returns the original string, or null for malformed/noncanonical data. */
export function decodeDartUtf16FirestoreBytesOrderKey(
  value: unknown,
  maximumBytes: number,
): string | null {
  if (
    !(value instanceof Uint8Array) ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    value.byteLength < 1 ||
    value.byteLength > maximumBytes
  ) {
    return null;
  }
  const stored = Buffer.from(value);
  const utf8 = Buffer.from(stored);
  for (let index = 0; index < utf8.length; index += 1) {
    const byte = utf8[index];
    if (byte >= 0xee && byte <= 0xf2) {
      utf8[index] = byte + 2;
    } else if (byte >= 0xf3 && byte <= 0xf4) {
      utf8[index] = byte - 5;
    }
  }
  const decoded = utf8.toString("utf8");
  if (
    !hasWellFormedCustomerBiteSaverUtf16(decoded) ||
    !Buffer.from(decoded, "utf8").equals(utf8) ||
    !dartUtf16FirestoreBytesOrderKey(decoded).equals(stored)
  ) {
    return null;
  }
  return decoded;
}

/** Returns a detached canonical key, or null for malformed/noncanonical data. */
export function parseDartUtf16FirestoreBytesOrderKey(
  value: unknown,
  maximumBytes: number,
): Buffer | null {
  return decodeDartUtf16FirestoreBytesOrderKey(value, maximumBytes) === null
    ? null
    : Buffer.from(value as Uint8Array);
}

export function dartUtf16FirestoreBytesCursorValue(
  value: Uint8Array,
  maximumBytes: number,
): string | null {
  const parsed = parseDartUtf16FirestoreBytesOrderKey(value, maximumBytes);
  return parsed === null ? null : parsed.toString("base64url");
}

export function parseDartUtf16FirestoreBytesCursorValue(
  value: unknown,
  maximumBytes: number,
): Buffer | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > Math.ceil(maximumBytes * 4 / 3) ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    return null;
  }
  return parseDartUtf16FirestoreBytesOrderKey(decoded, maximumBytes);
}

export function lowercaseDisplayNameOrderKey(value: string): string {
  return dartUtf16OrderKey(value.toLowerCase());
}

export function compareCustomerBiteSaverUtf16(
  left: string,
  right: string,
): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Matches Firestore's ordering for a stored string field. This differs from
 * JavaScript/Dart UTF-16 ordering when one value contains supplementary code
 * points and the other contains BMP code points above the surrogate range.
 */
export function compareCustomerBiteSaverFirestoreUtf8(
  left: string,
  right: string,
): number {
  if (
    !hasWellFormedCustomerBiteSaverUtf16(left) ||
    !hasWellFormedCustomerBiteSaverUtf16(right)
  ) {
    throw new CustomerBiteSaverSearchTextError();
  }
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
