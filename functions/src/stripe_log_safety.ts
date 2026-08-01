const STRIPE_LOG_STAGES = Object.freeze([
  "webhook_signature_verification",
  "webhook_event_processing",
  "webhook_subscription_sync",
  "checkout_session_creation",
  "customer_portal_session_creation",
] as const);

export type StripeLogStage = (typeof STRIPE_LOG_STAGES)[number];

export const stripeLogStages: readonly StripeLogStage[] =
  STRIPE_LOG_STAGES;

const stripeLogStageSet: ReadonlySet<string> =
  new Set<string>(STRIPE_LOG_STAGES);

export type StripeErrorCategory =
  | "invalid_signature"
  | "stripe_api_error"
  | "firestore_error"
  | "configuration_error"
  | "unknown_error";

export type StripeLogMetadata = Readonly<{
  stage: StripeLogStage;
  errorCategory: StripeErrorCategory;
}>;

const stripeErrorNames = new Set([
  "StripeAPIError",
  "StripeAuthenticationError",
  "StripeCardError",
  "StripeConnectionError",
  "StripeError",
  "StripeIdempotencyError",
  "StripeInvalidGrantError",
  "StripeInvalidRequestError",
  "StripePermissionError",
  "StripeRateLimitError",
  "StripeSignatureVerificationError",
]);

const stripeErrorTypes = new Set([
  "StripeAPIError",
  "StripeAuthenticationError",
  "StripeCardError",
  "StripeConnectionError",
  "StripeIdempotencyError",
  "StripeInvalidGrantError",
  "StripeInvalidRequestError",
  "StripePermissionError",
  "StripeRateLimitError",
  "StripeSignatureVerificationError",
]);

const firestoreErrorCodes = new Set([
  "aborted",
  "already-exists",
  "cancelled",
  "data-loss",
  "deadline-exceeded",
  "failed-precondition",
  "internal",
  "invalid-argument",
  "not-found",
  "out-of-range",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated",
  "unavailable",
  "unimplemented",
  "unknown",
]);

function safeStringProperty(
  input: unknown,
  property: "code" | "name" | "type",
): string | null {
  if (
    input === null ||
    (typeof input !== "object" && typeof input !== "function")
  ) {
    return null;
  }

  try {
    const value = (input as Record<string, unknown>)[property];
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 80
    ) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function classifyStripeError(
  stage: StripeLogStage,
  error: unknown,
): StripeErrorCategory {
  if (stage === "webhook_signature_verification") {
    return "invalid_signature";
  }

  const name = safeStringProperty(error, "name");
  const code = safeStringProperty(error, "code");
  const type = safeStringProperty(error, "type");

  if (
    name === "SubscriptionPortalConfigurationError" ||
    code === "subscription_portal_configuration_error"
  ) {
    return "configuration_error";
  }
  if (
    (name !== null && stripeErrorNames.has(name)) ||
    (type !== null && stripeErrorTypes.has(type))
  ) {
    return "stripe_api_error";
  }
  if (
    (name === "FirestoreError" &&
      (code === null || firestoreErrorCodes.has(code))) ||
    (name === "FirebaseError" &&
      code !== null &&
      code.startsWith("firestore/") &&
      firestoreErrorCodes.has(code.slice("firestore/".length)))
  ) {
    return "firestore_error";
  }
  return "unknown_error";
}

export function stripeLogMetadata(
  stage: StripeLogStage,
  error: unknown,
): StripeLogMetadata {
  if (!stripeLogStageSet.has(stage)) {
    throw new Error("Unsupported Stripe log stage.");
  }

  return Object.freeze({
    stage,
    errorCategory: classifyStripeError(stage, error),
  });
}
