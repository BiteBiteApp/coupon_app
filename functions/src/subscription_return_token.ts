import { randomBytes } from "node:crypto";

export const subscriptionReturnProtocolVersion = 2 as const;
export const subscriptionReturnTokenParameter = "return_token";
export const subscriptionReturnTokenByteLength = 32;
export const subscriptionReturnTokenLength = 43;
export const subscriptionReturnUpdateRequiredMessage =
  "This version of BiteStar must be updated before managing a subscription.";

const subscriptionReturnTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export type SubscriptionReturnRandomBytes = (
  size: number,
) => Uint8Array;

export class SubscriptionReturnProtocolRequestError extends Error {
  readonly code = "subscription_return_protocol_request_error";

  constructor() {
    super(subscriptionReturnUpdateRequiredMessage);
    this.name = "SubscriptionReturnProtocolRequestError";
  }
}

export class SubscriptionReturnTokenError extends Error {
  readonly code = "subscription_return_token_error";

  constructor() {
    super("Subscription return correlation could not be created.");
    this.name = "SubscriptionReturnTokenError";
  }
}

function isPlainRecord(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requireSubscriptionReturnProtocolVersion(
  data: unknown,
): typeof subscriptionReturnProtocolVersion {
  try {
    if (!isPlainRecord(data)) {
      throw new SubscriptionReturnProtocolRequestError();
    }
    const keys = Reflect.ownKeys(data);
    if (
      keys.length !== 1 ||
      keys[0] !== "returnProtocolVersion" ||
      !Number.isInteger(data.returnProtocolVersion) ||
      data.returnProtocolVersion !== subscriptionReturnProtocolVersion
    ) {
      throw new SubscriptionReturnProtocolRequestError();
    }
  } catch (error) {
    if (error instanceof SubscriptionReturnProtocolRequestError) {
      throw error;
    }
    throw new SubscriptionReturnProtocolRequestError();
  }
  return subscriptionReturnProtocolVersion;
}

export function isValidSubscriptionReturnToken(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length === subscriptionReturnTokenLength &&
    subscriptionReturnTokenPattern.test(value)
  );
}

export function requireSubscriptionReturnToken(
  value: unknown,
): string {
  if (!isValidSubscriptionReturnToken(value)) {
    throw new SubscriptionReturnTokenError();
  }
  return value;
}

export function generateSubscriptionReturnToken(
  randomBytesSource: SubscriptionReturnRandomBytes = randomBytes,
): string {
  let bytes: Uint8Array;
  try {
    bytes = randomBytesSource(subscriptionReturnTokenByteLength);
  } catch {
    throw new SubscriptionReturnTokenError();
  }
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== subscriptionReturnTokenByteLength
  ) {
    throw new SubscriptionReturnTokenError();
  }
  const token = Buffer.from(bytes).toString("base64url");
  return requireSubscriptionReturnToken(token);
}

function requireCanonicalReturnBaseUrl(value: unknown): URL {
  if (typeof value !== "string") {
    throw new SubscriptionReturnTokenError();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SubscriptionReturnTokenError();
  }
  if (
    parsed.href !== value ||
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new SubscriptionReturnTokenError();
  }
  return parsed;
}

export function buildSubscriptionReturnUrl(
  baseUrl: unknown,
  tokenValue: unknown,
): string {
  const token = requireSubscriptionReturnToken(tokenValue);
  const parsed = requireCanonicalReturnBaseUrl(baseUrl);
  parsed.searchParams.append(subscriptionReturnTokenParameter, token);
  return parsed.href;
}

export function buildSubscriptionCheckoutReturnUrls(params: {
  successBaseUrl: unknown;
  cancelBaseUrl: unknown;
  returnToken: unknown;
}): Readonly<{
  successUrl: string;
  cancelUrl: string;
}> {
  const token = requireSubscriptionReturnToken(params.returnToken);
  return Object.freeze({
    successUrl: buildSubscriptionReturnUrl(
      params.successBaseUrl,
      token,
    ),
    cancelUrl: buildSubscriptionReturnUrl(
      params.cancelBaseUrl,
      token,
    ),
  });
}
