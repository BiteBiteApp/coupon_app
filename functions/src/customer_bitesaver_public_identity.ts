import { createHmac } from "node:crypto";
import { CustomerBiteSaverContractError } from
  "./customer_bitesaver_search_contract.js";

/**
 * Long-lived identity-domain version. This must not track the transient search
 * protocol version: changing it changes every durable public BiteSaver ID and
 * therefore requires a separately planned identity transition.
 */
export const customerBiteSaverPublicIdentityVersion =
  "bitestar.customer-bitesaver-public-identity.v1" as const;

export const customerBiteSaverIdentitySecretNameV1 =
  "BITESAVER_CUSTOMER_IDENTITY_KEY_V1" as const;

declare const customerBiteSaverIdentityKeyV1Brand: unique symbol;

/** A purpose-specific key that cannot be supplied by a generic Uint8Array. */
export type CustomerBiteSaverIdentityKeyV1 = Uint8Array & Readonly<{
  [customerBiteSaverIdentityKeyV1Brand]: true;
}>;

function identityNotConfigured(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "BiteSaver customer identity is not configured.",
  );
}

function invalidAuthoritativeIdentity(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "The BiteSaver customer identity source is invalid.",
  );
}

function requireIdentityKey(
  value: CustomerBiteSaverIdentityKeyV1,
): Buffer {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    return identityNotConfigured();
  }
  return Buffer.from(value);
}

function hasWellFormedUtf16(value: string): boolean {
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

function requireAuthoritativeIdentity(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    /^__.*__$/u.test(value) ||
    value.includes("/") ||
    !hasWellFormedUtf16(value) ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    return invalidAuthoritativeIdentity();
  }
  return value;
}

function identityHmac(
  key: CustomerBiteSaverIdentityKeyV1,
  domain: "restaurantPublicId" | "offerPublicId",
  values: readonly string[],
): Buffer {
  const hmac = createHmac("sha256", requireIdentityKey(key));
  hmac.update(customerBiteSaverPublicIdentityVersion, "utf8");
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

export function decodeCustomerBiteSaverIdentityKeyV1(
  value: unknown,
): CustomerBiteSaverIdentityKeyV1 {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    return identityNotConfigured();
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    return identityNotConfigured();
  }
  return bytes as unknown as CustomerBiteSaverIdentityKeyV1;
}

export function customerBiteSaverOpaqueRestaurantId(
  identityKeyV1: CustomerBiteSaverIdentityKeyV1,
  authoritativeAccountId: string,
): string {
  const accountId = requireAuthoritativeIdentity(authoritativeAccountId);
  return `bsr_${identityHmac(
    identityKeyV1,
    "restaurantPublicId",
    [accountId],
  ).toString("base64url")}`;
}

export function customerBiteSaverOpaqueOfferId(
  identityKeyV1: CustomerBiteSaverIdentityKeyV1,
  authoritativeAccountId: string,
  offerType: "coupon" | "dailySpecial",
  sourceOfferId: string,
): string {
  const accountId = requireAuthoritativeIdentity(authoritativeAccountId);
  const offerId = requireAuthoritativeIdentity(sourceOfferId);
  if (offerType !== "coupon" && offerType !== "dailySpecial") {
    return invalidAuthoritativeIdentity();
  }
  return `bso_${identityHmac(
    identityKeyV1,
    "offerPublicId",
    [accountId, offerType, offerId],
  ).toString("base64url")}`;
}
