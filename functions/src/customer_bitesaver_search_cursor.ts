import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  customerBiteSaverAbsoluteExpiryMilliseconds,
  customerBiteSaverCursorLifetimeMilliseconds,
  customerBiteSaverMaximumIndexedOrderKeyBytes,
  customerBiteSaverPageSize,
  customerBiteSaverSearchProtocolVersion,
  CustomerBiteSaverContractError,
} from "./customer_bitesaver_search_contract.js";
import {
  hasWellFormedCustomerBiteSaverUtf16,
  parseDartUtf16FirestoreBytesCursorValue,
} from "./customer_bitesaver_search_matcher.js";
import { isCustomerBiteSaverTimestampOrderKey } from
  "./search_index_builders.js";

export const customerBiteSaverCursorPrefix = "bsc1." as const;
export const customerBiteSaverOfferOccurrencePrefix = "bsoc1." as const;
export type CustomerBiteSaverCursorPurpose =
  | "restaurantPage"
  | "offerPage";
export type CustomerBiteSaverCursorSortValue = string | number | boolean | null;

export type CustomerBiteSaverCursorPayload = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  purpose: CustomerBiteSaverCursorPurpose;
  sessionId: string;
  attemptGeneration: number;
  queryFingerprint: string;
  pageGenerationFingerprint: string;
  callerCapabilityBinding: string;
  pageSize: typeof customerBiteSaverPageSize;
  sortTuple: readonly CustomerBiteSaverCursorSortValue[];
  restaurantPublicId: string | null;
  matchingMode: "parent" | "offer" | null;
  availabilityAtMs: number;
  timeZone: string;
  utcOffsetMinutes: number;
  guestStateFingerprint: string;
  usageGeneration: string;
  offerCatalogFingerprint: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
}>;

export type CustomerBiteSaverCursorInput = Omit<
  CustomerBiteSaverCursorPayload,
  "protocolVersion" | "pageSize" | "issuedAtMs" | "expiresAtMs"
> & Readonly<{lifetimeMilliseconds?: number}>;

export type CustomerBiteSaverCursorBinding = Readonly<{
  purpose: CustomerBiteSaverCursorPurpose;
  sessionId: string;
  attemptGeneration: number;
  queryFingerprint: string;
  pageGenerationFingerprint: string;
  callerCapabilityBinding: string;
  restaurantPublicId?: string | null;
  matchingMode?: "parent" | "offer" | null;
  availabilityAtMs: number;
  timeZone: string;
  utcOffsetMinutes: number;
  guestStateFingerprint: string;
  usageGeneration: string;
  offerCatalogFingerprint: string | null;
}>;

export type CustomerBiteSaverCursorCodecOptions = Readonly<{
  key: Uint8Array;
  now?: () => number;
  nonceSource?: (size: number) => Uint8Array;
  nonceMode?: "random" | "deterministicAuthenticated";
}>;

function invalidCursor(): never {
  throw new CustomerBiteSaverContractError(
    "invalid-argument",
    "The BiteSaver page cursor is invalid or expired.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireString(
  value: unknown,
  maximumLength: number,
  pattern?: RegExp,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    return invalidCursor();
  }
  return value;
}

function requireSafeInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidCursor();
  }
  return value;
}

function requireFingerprint(value: unknown): string {
  return requireString(value, 64, /^[0-9a-f]{64}$/u);
}

function requireSortTuple(
  value: unknown,
  purpose: unknown,
): readonly CustomerBiteSaverCursorSortValue[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    return invalidCursor();
  }
  return Object.freeze(value.map((entry, index) => {
    const binaryRestaurantAccountOrderKey =
      purpose === "restaurantPage" && index === 3 &&
      parseDartUtf16FirestoreBytesCursorValue(
        entry,
        customerBiteSaverMaximumIndexedOrderKeyBytes,
      ) !== null;
    if (
      entry === null ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry)) ||
      binaryRestaurantAccountOrderKey ||
      (typeof entry === "string" && index !== 3 &&
        entry.length <= 1_500 &&
        hasWellFormedCustomerBiteSaverUtf16(entry))
    ) {
      return entry as CustomerBiteSaverCursorSortValue;
    }
    return invalidCursor();
  }));
}

const payloadKeys = Object.freeze([
  "protocolVersion",
  "purpose",
  "sessionId",
  "attemptGeneration",
  "queryFingerprint",
  "pageGenerationFingerprint",
  "callerCapabilityBinding",
  "pageSize",
  "sortTuple",
  "restaurantPublicId",
  "matchingMode",
  "availabilityAtMs",
  "timeZone",
  "utcOffsetMinutes",
  "guestStateFingerprint",
  "usageGeneration",
  "offerCatalogFingerprint",
  "issuedAtMs",
  "expiresAtMs",
]);

function parsePayload(value: unknown): CustomerBiteSaverCursorPayload {
  if (!isRecord(value)) {
    return invalidCursor();
  }
  const keys = Object.keys(value).sort();
  const expected = [...payloadKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    return invalidCursor();
  }
  if (
    value.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    (value.purpose !== "restaurantPage" && value.purpose !== "offerPage") ||
    value.pageSize !== customerBiteSaverPageSize ||
    (value.matchingMode !== null &&
      value.matchingMode !== "parent" &&
      value.matchingMode !== "offer")
  ) {
    return invalidCursor();
  }
  const issuedAtMs = requireSafeInteger(value.issuedAtMs, 0);
  const expiresAtMs = requireSafeInteger(value.expiresAtMs, 0);
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > customerBiteSaverCursorLifetimeMilliseconds
  ) {
    return invalidCursor();
  }
  const restaurantPublicId = value.restaurantPublicId === null
    ? null
    : requireString(value.restaurantPublicId, 47, /^bsr_[A-Za-z0-9_-]{43}$/u);
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: value.purpose,
    sessionId: requireString(value.sessionId, 47, /^bss_[A-Za-z0-9_-]{43}$/u),
    attemptGeneration: requireSafeInteger(value.attemptGeneration, 0),
    queryFingerprint: requireFingerprint(value.queryFingerprint),
    pageGenerationFingerprint: requireFingerprint(
      value.pageGenerationFingerprint,
    ),
    callerCapabilityBinding: requireFingerprint(value.callerCapabilityBinding),
    pageSize: customerBiteSaverPageSize,
    sortTuple: requireSortTuple(value.sortTuple, value.purpose),
    restaurantPublicId,
    matchingMode: value.matchingMode,
    availabilityAtMs: requireSafeInteger(value.availabilityAtMs, 0),
    timeZone: requireString(value.timeZone, 100),
    utcOffsetMinutes: requireSafeInteger(value.utcOffsetMinutes, -840, 840),
    guestStateFingerprint: requireFingerprint(
      value.guestStateFingerprint,
    ),
    usageGeneration: requireFingerprint(value.usageGeneration),
    offerCatalogFingerprint: value.offerCatalogFingerprint === null
      ? null
      : requireFingerprint(value.offerCatalogFingerprint),
    issuedAtMs,
    expiresAtMs,
  });
}

export function decodeCustomerBiteSaverSecret(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "BiteSaver discovery is not configured.",
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "BiteSaver discovery is not configured.",
    );
  }
  return bytes;
}

function domainHmac(
  key: Uint8Array,
  domain: string,
  values: readonly string[],
): Buffer {
  const hmac = createHmac("sha256", key);
  hmac.update(customerBiteSaverSearchProtocolVersion, "utf8");
  hmac.update("\0", "utf8");
  hmac.update(domain, "utf8");
  for (const value of values) {
    hmac.update("\0", "utf8");
    hmac.update(String(value.length), "ascii");
    hmac.update(":", "ascii");
    hmac.update(value, "utf16le");
  }
  return hmac.digest();
}

export function customerBiteSaverOpaqueRestaurantId(
  key: Uint8Array,
  authoritativeAccountId: string,
): string {
  return `bsr_${domainHmac(key, "restaurantPublicId", [
    authoritativeAccountId,
  ]).toString("base64url")}`;
}

export function customerBiteSaverOpaqueOfferId(
  key: Uint8Array,
  authoritativeAccountId: string,
  offerType: "coupon" | "dailySpecial",
  sourceOfferId: string,
): string {
  return `bso_${domainHmac(key, "offerPublicId", [
    authoritativeAccountId,
    offerType,
    sourceOfferId,
  ]).toString("base64url")}`;
}

export function customerBiteSaverCallerBinding(
  key: Uint8Array,
  value: {
    scope: "guest" | "authenticated";
    clientInstanceId: string;
    uid?: string | null;
  },
): string {
  return domainHmac(key, "callerBinding", [
    value.scope,
    value.uid ?? "",
    value.clientInstanceId,
  ]).toString("hex");
}

export function customerBiteSaverCapabilityForSession(
  key: Uint8Array,
  sessionId: string,
  callerBinding: string,
): string {
  return domainHmac(key, "bearerCapability", [
    sessionId,
    callerBinding,
  ]).toString("base64url");
}

export function customerBiteSaverCapabilityHash(
  key: Uint8Array,
  capability: string,
): string {
  return domainHmac(key, "capabilityHash", [capability]).toString("hex");
}

export function customerBiteSaverCallerCapabilityBinding(
  key: Uint8Array,
  callerBinding: string,
  capabilityHash: string,
): string {
  return domainHmac(key, "callerCapabilityBinding", [
    callerBinding,
    capabilityHash,
  ]).toString("hex");
}

export function customerBiteSaverDeterministicId(
  key: Uint8Array,
  prefix: string,
  domain: string,
  values: readonly string[],
): string {
  return `${prefix}_${domainHmac(key, domain, values).toString("base64url")}`;
}

export function customerBiteSaverRandomSessionId(
  randomSource: (size: number) => Uint8Array = randomBytes,
): string {
  const entropy = randomSource(32);
  if (!(entropy instanceof Uint8Array) || entropy.length !== 32) {
    throw new Error("Session entropy source is invalid.");
  }
  return `bss_${Buffer.from(entropy).toString("base64url")}`;
}

export function customerBiteSaverConstantTimeHexEqual(
  left: string,
  right: string,
): boolean {
  if (!/^[0-9a-f]{64}$/u.test(left) || !/^[0-9a-f]{64}$/u.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export class CustomerBiteSaverCursorCodec {
  readonly #key: Buffer;
  readonly #now: () => number;
  readonly #nonceSource: (size: number) => Uint8Array;
  readonly #nonceMode: "random" | "deterministicAuthenticated";
  readonly #deterministicNonceKey: Buffer;

  constructor(options: CustomerBiteSaverCursorCodecOptions) {
    if (!(options.key instanceof Uint8Array) || options.key.length !== 32) {
      throw new CustomerBiteSaverContractError("failed-precondition");
    }
    const nonceMode = options.nonceMode ?? "random";
    if (
      (nonceMode !== "random" && nonceMode !== "deterministicAuthenticated") ||
      (nonceMode === "deterministicAuthenticated" &&
        options.nonceSource !== undefined)
    ) {
      throw new CustomerBiteSaverContractError("failed-precondition");
    }
    this.#key = Buffer.from(options.key);
    this.#now = options.now ?? Date.now;
    this.#nonceSource = options.nonceSource ?? randomBytes;
    this.#nonceMode = nonceMode;
    this.#deterministicNonceKey = domainHmac(
      options.key,
      "cursorDeterministicAuthenticatedNonceKey",
      [],
    );
  }

  #nonceForPlaintext(plaintext: Uint8Array): Buffer {
    return createHmac("sha256", this.#deterministicNonceKey)
      .update(customerBiteSaverCursorPrefix, "ascii")
      .update(plaintext)
      .digest()
      .subarray(0, 12);
  }

  encode(input: CustomerBiteSaverCursorInput): string {
    try {
      const issuedAtMs = requireSafeInteger(this.#now(), 0);
      const lifetime = input.lifetimeMilliseconds ??
        customerBiteSaverCursorLifetimeMilliseconds;
      if (
        !Number.isSafeInteger(lifetime) ||
        lifetime <= 0 ||
        lifetime > customerBiteSaverCursorLifetimeMilliseconds
      ) {
        return invalidCursor();
      }
      const payload = parsePayload({
        protocolVersion: customerBiteSaverSearchProtocolVersion,
        purpose: input.purpose,
        sessionId: input.sessionId,
        attemptGeneration: input.attemptGeneration,
        queryFingerprint: input.queryFingerprint,
        pageGenerationFingerprint: input.pageGenerationFingerprint,
        callerCapabilityBinding: input.callerCapabilityBinding,
        pageSize: customerBiteSaverPageSize,
        sortTuple: input.sortTuple,
        restaurantPublicId: input.restaurantPublicId,
        matchingMode: input.matchingMode,
        availabilityAtMs: input.availabilityAtMs,
        timeZone: input.timeZone,
        utcOffsetMinutes: input.utcOffsetMinutes,
        guestStateFingerprint: input.guestStateFingerprint,
        usageGeneration: input.usageGeneration,
        offerCatalogFingerprint: input.offerCatalogFingerprint,
        issuedAtMs,
        expiresAtMs: issuedAtMs + lifetime,
      });
      const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
      const nonceBytes = this.#nonceMode === "deterministicAuthenticated"
        ? this.#nonceForPlaintext(plaintext)
        : this.#nonceSource(12);
      if (!(nonceBytes instanceof Uint8Array) || nonceBytes.length !== 12) {
        return invalidCursor();
      }
      const nonce = Buffer.from(nonceBytes);
      const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
      cipher.setAAD(Buffer.from(customerBiteSaverCursorPrefix, "ascii"));
      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      return customerBiteSaverCursorPrefix + Buffer.concat([
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]).toString("base64url");
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) {
        throw error;
      }
      return invalidCursor();
    }
  }

  /**
   * Authenticates and opens a cursor without accepting it for any request.
   * Callers must immediately pass the returned generation fields back through
   * `decode` with the independently authorized session/caller binding.
   */
  open(
    token: unknown,
    options: Readonly<{allowExpired?: boolean}> = {},
  ): CustomerBiteSaverCursorPayload {
    try {
      if (
        typeof token !== "string" ||
        !token.startsWith(customerBiteSaverCursorPrefix)
      ) {
        return invalidCursor();
      }
      const encoded = token.slice(customerBiteSaverCursorPrefix.length);
      if (
        encoded.length === 0 ||
        encoded.length > 32_768 ||
        !/^[A-Za-z0-9_-]+$/u.test(encoded)
      ) {
        return invalidCursor();
      }
      const packed = Buffer.from(encoded, "base64url");
      if (packed.toString("base64url") !== encoded || packed.length <= 28) {
        return invalidCursor();
      }
      const nonce = packed.subarray(0, 12);
      const authenticationTag = packed.subarray(12, 28);
      const encrypted = packed.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
      decipher.setAAD(Buffer.from(customerBiteSaverCursorPrefix, "ascii"));
      decipher.setAuthTag(authenticationTag);
      const plaintext = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      if (
        this.#nonceMode === "deterministicAuthenticated" &&
        !timingSafeEqual(nonce, this.#nonceForPlaintext(plaintext))
      ) {
        return invalidCursor();
      }
      const payload = parsePayload(
        JSON.parse(plaintext.toString("utf8")) as unknown,
      );
      if (options.allowExpired !== true && this.#now() >= payload.expiresAtMs) {
        return invalidCursor();
      }
      return payload;
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) {
        throw error;
      }
      return invalidCursor();
    }
  }

  decode(
    token: unknown,
    binding: CustomerBiteSaverCursorBinding,
  ): CustomerBiteSaverCursorPayload {
    try {
      const payload = this.open(token);
      if (
        payload.purpose !== binding.purpose ||
        payload.sessionId !== binding.sessionId ||
        payload.attemptGeneration !== binding.attemptGeneration ||
        payload.queryFingerprint !== binding.queryFingerprint ||
        payload.pageGenerationFingerprint !==
          binding.pageGenerationFingerprint ||
        payload.callerCapabilityBinding !== binding.callerCapabilityBinding ||
        payload.guestStateFingerprint !==
          binding.guestStateFingerprint ||
        payload.restaurantPublicId !== (binding.restaurantPublicId ?? null) ||
        payload.matchingMode !== (binding.matchingMode ?? null) ||
        payload.availabilityAtMs !== binding.availabilityAtMs ||
        payload.timeZone !== binding.timeZone ||
        payload.utcOffsetMinutes !== binding.utcOffsetMinutes ||
        payload.usageGeneration !== binding.usageGeneration ||
        payload.offerCatalogFingerprint !== binding.offerCatalogFingerprint
      ) {
        return invalidCursor();
      }
      return payload;
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) {
        throw error;
      }
      return invalidCursor();
    }
  }
}

export type CustomerBiteSaverOfferOccurrencePayload = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  purpose: "redemptionOfferOccurrence";
  pagePurpose: CustomerBiteSaverCursorPurpose;
  sessionId: string;
  attemptGeneration: number;
  queryFingerprint: string;
  pageGenerationFingerprint: string;
  callerCapabilityBinding: string;
  restaurantPublicId: string;
  offerPublicId: string;
  authoritativeAccountId: string;
  offerType: "coupon" | "dailySpecial";
  sourceDocumentId: string;
  indexDocumentId: string;
  sourceCreatedAtMs: number;
  sourceCreatedAtOrderKey: string;
  sourceFingerprint: string;
  matchingMode: "parent" | "offer" | null;
  availabilityAtMs: number;
  guestStateFingerprint: string;
  usageGeneration: string;
  offerCatalogFingerprint: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
}>;

export type CustomerBiteSaverOfferOccurrenceInput = Omit<
  CustomerBiteSaverOfferOccurrencePayload,
  "protocolVersion" | "purpose" | "issuedAtMs"
>;

export type CustomerBiteSaverOfferOccurrenceBinding = Readonly<{
  pagePurpose: CustomerBiteSaverCursorPurpose;
  sessionId: string;
  attemptGeneration: number;
  queryFingerprint: string;
  pageGenerationFingerprint: string;
  callerCapabilityBinding: string;
  restaurantPublicId: string;
  offerPublicId: string;
  matchingMode: "parent" | "offer" | null;
  availabilityAtMs: number;
  guestStateFingerprint: string;
  usageGeneration: string;
  offerCatalogFingerprint: string | null;
}>;

function invalidOfferOccurrence(): never {
  throw new CustomerBiteSaverContractError(
    "invalid-argument",
    "The BiteSaver offer occurrence is invalid or expired.",
  );
}

const offerOccurrencePayloadKeys = Object.freeze([
  "protocolVersion",
  "purpose",
  "pagePurpose",
  "sessionId",
  "attemptGeneration",
  "queryFingerprint",
  "pageGenerationFingerprint",
  "callerCapabilityBinding",
  "restaurantPublicId",
  "offerPublicId",
  "authoritativeAccountId",
  "offerType",
  "sourceDocumentId",
  "indexDocumentId",
  "sourceCreatedAtMs",
  "sourceCreatedAtOrderKey",
  "sourceFingerprint",
  "matchingMode",
  "availabilityAtMs",
  "guestStateFingerprint",
  "usageGeneration",
  "offerCatalogFingerprint",
  "issuedAtMs",
  "expiresAtMs",
]);

function occurrenceString(
  value: unknown,
  maximumLength: number,
  pattern?: RegExp,
): string {
  try {
    const result = requireString(value, maximumLength, pattern);
    if (!hasWellFormedCustomerBiteSaverUtf16(result)) {
      return invalidOfferOccurrence();
    }
    return result;
  } catch {
    return invalidOfferOccurrence();
  }
}

function occurrenceFingerprint(value: unknown): string {
  return occurrenceString(value, 64, /^[0-9a-f]{64}$/u);
}

function occurrenceTimestampOrderKey(value: unknown): string {
  return isCustomerBiteSaverTimestampOrderKey(value)
    ? value
    : invalidOfferOccurrence();
}

function occurrenceInteger(value: unknown): number {
  try {
    return requireSafeInteger(value, 0);
  } catch {
    return invalidOfferOccurrence();
  }
}

function parseOfferOccurrencePayload(
  value: unknown,
): CustomerBiteSaverOfferOccurrencePayload {
  if (!isRecord(value)) {
    return invalidOfferOccurrence();
  }
  const keys = Object.keys(value).sort();
  const expected = [...offerOccurrencePayloadKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    value.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    value.purpose !== "redemptionOfferOccurrence" ||
    (value.pagePurpose !== "restaurantPage" &&
      value.pagePurpose !== "offerPage") ||
    (value.offerType !== "coupon" && value.offerType !== "dailySpecial") ||
    (value.matchingMode !== null && value.matchingMode !== "parent" &&
      value.matchingMode !== "offer") ||
    (value.pagePurpose === "restaurantPage" && value.matchingMode !== null) ||
    (value.pagePurpose === "offerPage" && value.matchingMode === null) ||
    (value.pagePurpose === "restaurantPage" &&
      value.offerCatalogFingerprint !== null) ||
    (value.pagePurpose === "offerPage" &&
      typeof value.offerCatalogFingerprint !== "string")
  ) {
    return invalidOfferOccurrence();
  }
  const issuedAtMs = occurrenceInteger(value.issuedAtMs);
  const expiresAtMs = occurrenceInteger(value.expiresAtMs);
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > customerBiteSaverAbsoluteExpiryMilliseconds
  ) {
    return invalidOfferOccurrence();
  }
  const internalId = (entry: unknown): string => {
    const parsed = occurrenceString(entry, 1_500);
    return parsed.includes("/") ? invalidOfferOccurrence() : parsed;
  };
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "redemptionOfferOccurrence",
    pagePurpose: value.pagePurpose,
    sessionId: occurrenceString(
      value.sessionId,
      47,
      /^bss_[A-Za-z0-9_-]{43}$/u,
    ),
    attemptGeneration: occurrenceInteger(value.attemptGeneration),
    queryFingerprint: occurrenceFingerprint(value.queryFingerprint),
    pageGenerationFingerprint: occurrenceFingerprint(
      value.pageGenerationFingerprint,
    ),
    callerCapabilityBinding: occurrenceFingerprint(
      value.callerCapabilityBinding,
    ),
    restaurantPublicId: occurrenceString(
      value.restaurantPublicId,
      47,
      /^bsr_[A-Za-z0-9_-]{43}$/u,
    ),
    offerPublicId: occurrenceString(
      value.offerPublicId,
      47,
      /^bso_[A-Za-z0-9_-]{43}$/u,
    ),
    authoritativeAccountId: internalId(value.authoritativeAccountId),
    offerType: value.offerType,
    sourceDocumentId: internalId(value.sourceDocumentId),
    indexDocumentId: internalId(value.indexDocumentId),
    sourceCreatedAtMs: occurrenceInteger(value.sourceCreatedAtMs),
    sourceCreatedAtOrderKey: occurrenceTimestampOrderKey(
      value.sourceCreatedAtOrderKey,
    ),
    sourceFingerprint: occurrenceFingerprint(value.sourceFingerprint),
    matchingMode: value.matchingMode,
    availabilityAtMs: occurrenceInteger(value.availabilityAtMs),
    guestStateFingerprint: occurrenceFingerprint(
      value.guestStateFingerprint,
    ),
    usageGeneration: occurrenceFingerprint(value.usageGeneration),
    offerCatalogFingerprint: value.offerCatalogFingerprint === null
      ? null
      : occurrenceFingerprint(value.offerCatalogFingerprint),
    issuedAtMs,
    expiresAtMs,
  });
}

/**
 * Authenticated, encrypted locator for one offer occurrence actually delivered
 * by a customer page. The stable public `bso_` identity remains separate; this
 * session-scoped token only lets redemption validation perform bounded point reads.
 */
export class CustomerBiteSaverOfferOccurrenceCodec {
  readonly #key: Buffer;
  readonly #nonceKey: Buffer;
  readonly #now: () => number;

  constructor(options: Pick<CustomerBiteSaverCursorCodecOptions, "key" | "now">) {
    if (!(options.key instanceof Uint8Array) || options.key.length !== 32) {
      throw new CustomerBiteSaverContractError("failed-precondition");
    }
    this.#key = domainHmac(
      options.key,
      "offerOccurrenceEncryptionKey",
      [],
    );
    this.#nonceKey = domainHmac(
      options.key,
      "offerOccurrenceNonceKey",
      [],
    );
    this.#now = options.now ?? Date.now;
  }

  encode(input: CustomerBiteSaverOfferOccurrenceInput): string {
    try {
      const payload = parseOfferOccurrencePayload({
        ...input,
        protocolVersion: customerBiteSaverSearchProtocolVersion,
        purpose: "redemptionOfferOccurrence",
        issuedAtMs: occurrenceInteger(this.#now()),
      });
      const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
      const nonce = createHmac("sha256", this.#nonceKey)
        .update(customerBiteSaverOfferOccurrencePrefix, "ascii")
        .update(plaintext)
        .digest()
        .subarray(0, 12);
      const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
      cipher.setAAD(Buffer.from(
        customerBiteSaverOfferOccurrencePrefix,
        "ascii",
      ));
      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      return customerBiteSaverOfferOccurrencePrefix + Buffer.concat([
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]).toString("base64url");
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) {
        throw error;
      }
      return invalidOfferOccurrence();
    }
  }

  open(token: unknown): CustomerBiteSaverOfferOccurrencePayload {
    try {
      if (
        typeof token !== "string" ||
        !token.startsWith(customerBiteSaverOfferOccurrencePrefix)
      ) {
        return invalidOfferOccurrence();
      }
      const encoded = token.slice(customerBiteSaverOfferOccurrencePrefix.length);
      if (
        encoded.length === 0 || encoded.length > 32_768 ||
        !/^[A-Za-z0-9_-]+$/u.test(encoded)
      ) {
        return invalidOfferOccurrence();
      }
      const packed = Buffer.from(encoded, "base64url");
      if (packed.toString("base64url") !== encoded || packed.length <= 28) {
        return invalidOfferOccurrence();
      }
      const nonce = packed.subarray(0, 12);
      const authenticationTag = packed.subarray(12, 28);
      const encrypted = packed.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
      decipher.setAAD(Buffer.from(
        customerBiteSaverOfferOccurrencePrefix,
        "ascii",
      ));
      decipher.setAuthTag(authenticationTag);
      const plaintext = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      const expectedNonce = createHmac("sha256", this.#nonceKey)
        .update(customerBiteSaverOfferOccurrencePrefix, "ascii")
        .update(plaintext)
        .digest()
        .subarray(0, 12);
      if (!timingSafeEqual(nonce, expectedNonce)) {
        return invalidOfferOccurrence();
      }
      const payload = parseOfferOccurrencePayload(
        JSON.parse(plaintext.toString("utf8")) as unknown,
      );
      if (this.#now() >= payload.expiresAtMs) {
        return invalidOfferOccurrence();
      }
      return payload;
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) {
        throw error;
      }
      return invalidOfferOccurrence();
    }
  }

  decode(
    token: unknown,
    binding: CustomerBiteSaverOfferOccurrenceBinding,
  ): CustomerBiteSaverOfferOccurrencePayload {
    const payload = this.open(token);
    if (
      payload.pagePurpose !== binding.pagePurpose ||
      payload.sessionId !== binding.sessionId ||
      payload.attemptGeneration !== binding.attemptGeneration ||
      payload.queryFingerprint !== binding.queryFingerprint ||
      payload.pageGenerationFingerprint !==
        binding.pageGenerationFingerprint ||
      payload.callerCapabilityBinding !== binding.callerCapabilityBinding ||
      payload.restaurantPublicId !== binding.restaurantPublicId ||
      payload.offerPublicId !== binding.offerPublicId ||
      payload.matchingMode !== binding.matchingMode ||
      payload.availabilityAtMs !== binding.availabilityAtMs ||
      payload.guestStateFingerprint !==
        binding.guestStateFingerprint ||
      payload.usageGeneration !== binding.usageGeneration ||
      payload.offerCatalogFingerprint !==
        binding.offerCatalogFingerprint
    ) {
      return invalidOfferOccurrence();
    }
    return payload;
  }
}
