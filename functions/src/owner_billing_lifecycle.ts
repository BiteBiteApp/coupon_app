import {createHash, randomBytes} from "node:crypto";

import {
  buildOwnerBillingStateDocument,
  requireOwnerBillingUid,
  type OwnerBillingStateDocument,
} from "./owner_billing_state_contract.js";
import {requireSubscriptionReturnToken} from "./subscription_return_token.js";

export const ownerBillingCheckoutAttemptByteLength = 32;
export const ownerBillingCheckoutIdempotencyMaximumAgeMilliseconds =
  23 * 60 * 60 * 1000;

export type OwnerBillingCheckoutVariant = "primary" | "compatibility";

export type OwnerBillingCheckoutDescriptor = Readonly<{
  variant: OwnerBillingCheckoutVariant;
  priceId: string;
  successBaseUrl: string;
  cancelBaseUrl: string;
  trialPeriodDays: number | null;
  metadataContractVersion: string;
  stripeCustomerId: string | null;
}>;

export class OwnerBillingLifecycleError extends Error {
  readonly code:
    | "invalid_input"
    | "checkout_conflict"
    | "checkout_retry_expired"
    | "billing_unavailable"
    | "customer_mismatch";

  constructor(code: OwnerBillingLifecycleError["code"]) {
    super("Owner billing lifecycle state is unavailable.");
    this.name = "OwnerBillingLifecycleError";
    this.code = code;
  }
}

function invalidInput(): never {
  throw new OwnerBillingLifecycleError("invalid_input");
}

function sha256(parts: readonly unknown[]): Buffer {
  return createHash("sha256")
    .update(JSON.stringify(parts), "utf8")
    .digest();
}

function requireExactIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f/]/u.test(value)
  ) {
    invalidInput();
  }
  return value;
}

function requireCanonicalHttpsUrl(value: unknown): string {
  if (typeof value !== "string") {
    invalidInput();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidInput();
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
    invalidInput();
  }
  return value;
}

function requireCheckoutCustomerId(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const customerId = requireExactIdentifier(value);
  if (!/^cus_[A-Za-z0-9]+$/u.test(customerId)) {
    invalidInput();
  }
  return customerId;
}

function validBillingState(value: OwnerBillingStateDocument):
  OwnerBillingStateDocument {
  try {
    const rebuilt = buildOwnerBillingStateDocument({
      ownerUid: value.ownerUid,
      lifecycleState: value.lifecycleState,
      rawStripeStatus: value.rawStripeStatus,
      billingPosture: value.billingPosture,
      stripeCustomerId: value.stripeCustomerId,
      stripeSubscriptionId: value.stripeSubscriptionId,
      checkoutAttemptId: value.checkoutAttemptId,
      checkoutRequestFingerprint: value.checkoutRequestFingerprint,
      checkoutAttemptCreatedAt: value.checkoutAttemptCreatedAt,
      checkoutSessionId: value.checkoutSessionId,
      lastStripeEventCreated: value.lastStripeEventCreated,
      lastStripeEventId: value.lastStripeEventId,
      lastStripeEventPayloadFingerprint:
        value.lastStripeEventPayloadFingerprint,
      stripeEventConflictKind: value.stripeEventConflictKind,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    });
    if (rebuilt.fingerprint !== value.fingerprint) {
      invalidInput();
    }
    return rebuilt;
  } catch {
    return invalidInput();
  }
}

export function generateOwnerBillingCheckoutAttemptId(
  randomSource: (size: number) => Uint8Array = randomBytes,
): string {
  let bytes: Uint8Array;
  try {
    bytes = randomSource(ownerBillingCheckoutAttemptByteLength);
  } catch {
    return invalidInput();
  }
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== ownerBillingCheckoutAttemptByteLength
  ) {
    invalidInput();
  }
  return `attempt_${Buffer.from(bytes).toString("base64url")}`;
}

/** Reconstructs byte-identical private return material without storing a token. */
export function deriveOwnerBillingReturnToken(params: {
  ownerUid: unknown;
  checkoutAttemptId: unknown;
}): string {
  const token = sha256([
    "bitestar.owner-billing.return-token.v2",
    requireOwnerBillingUid(params.ownerUid),
    requireExactIdentifier(params.checkoutAttemptId),
  ]).toString("base64url");
  return requireSubscriptionReturnToken(token);
}

export function ownerBillingCheckoutRequestFingerprint(
  descriptor: OwnerBillingCheckoutDescriptor,
): string {
  if (
    (descriptor.variant !== "primary" &&
      descriptor.variant !== "compatibility") ||
    !Number.isSafeInteger(descriptor.trialPeriodDays ?? 0) ||
    (descriptor.trialPeriodDays !== null && descriptor.trialPeriodDays < 1)
  ) {
    invalidInput();
  }
  return sha256([
    "bitestar.owner-billing.checkout-request.v1",
    descriptor.variant,
    requireExactIdentifier(descriptor.priceId),
    requireCanonicalHttpsUrl(descriptor.successBaseUrl),
    requireCanonicalHttpsUrl(descriptor.cancelBaseUrl),
    descriptor.trialPeriodDays,
    requireExactIdentifier(descriptor.metadataContractVersion),
    requireCheckoutCustomerId(descriptor.stripeCustomerId),
  ]).toString("hex");
}

export function ownerBillingStripeIdempotencyKey(params: {
  ownerUid: unknown;
  checkoutAttemptId: unknown;
}): string {
  return `bsco_${sha256([
    "bitestar.owner-billing.stripe-idempotency.v2",
    requireOwnerBillingUid(params.ownerUid),
    requireExactIdentifier(params.checkoutAttemptId),
  ]).toString("hex")}`;
}

export function requireReusableOwnerBillingCheckoutAttempt(params: {
  billingState: OwnerBillingStateDocument;
  checkoutRequestFingerprint: string;
  now: Date;
}): OwnerBillingStateDocument {
  const billing = validBillingState(params.billingState);
  const nowMs = params.now.getTime();
  if (!Number.isFinite(nowMs)) {
    invalidInput();
  }
  if (
    (billing.lifecycleState !== "checkout_pending" &&
      billing.lifecycleState !== "unknown") ||
    billing.checkoutAttemptId === null ||
    billing.checkoutRequestFingerprint !==
      requireExactIdentifier(params.checkoutRequestFingerprint) ||
    billing.checkoutAttemptCreatedAt === null
  ) {
    throw new OwnerBillingLifecycleError("checkout_conflict");
  }
  if (
    billing.lifecycleState === "unknown" &&
    (billing.rawStripeStatus !== null ||
      billing.stripeSubscriptionId !== null ||
      billing.lastStripeEventCreated !== null ||
      billing.lastStripeEventId !== null ||
      billing.lastStripeEventPayloadFingerprint !== null ||
      billing.stripeEventConflictKind !== null)
  ) {
    throw new OwnerBillingLifecycleError("checkout_conflict");
  }
  const age = nowMs - billing.checkoutAttemptCreatedAt.getTime();
  if (
    age < 0 ||
    age > ownerBillingCheckoutIdempotencyMaximumAgeMilliseconds
  ) {
    throw new OwnerBillingLifecycleError("checkout_retry_expired");
  }
  return billing;
}

export function requireOwnerBillingPortalGate(params: {
  ownerUid: unknown;
  billingState: OwnerBillingStateDocument;
  stripeCustomerId: unknown;
}): string {
  const ownerUid = requireOwnerBillingUid(params.ownerUid);
  const billing = validBillingState(params.billingState);
  if (
    ownerUid !== billing.ownerUid ||
    billing.lifecycleState !== "subscription_known" ||
    billing.stripeCustomerId === null
  ) {
    throw new OwnerBillingLifecycleError("billing_unavailable");
  }
  const customer = requireExactIdentifier(params.stripeCustomerId);
  if (customer !== billing.stripeCustomerId) {
    throw new OwnerBillingLifecycleError("customer_mismatch");
  }
  return customer;
}
