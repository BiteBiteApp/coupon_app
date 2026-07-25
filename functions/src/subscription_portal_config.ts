export const canonicalSubscriptionPortalReturnUrl =
  "https://app.bitestar.app/subscription/portal-return";

export class SubscriptionPortalConfigurationError extends Error {
  readonly code = "subscription_portal_configuration_error";

  constructor() {
    super("Stripe Customer Portal return URL configuration is invalid.");
    this.name = "SubscriptionPortalConfigurationError";
  }
}

export function requireCanonicalSubscriptionPortalReturnUrl(
  configuredValue: unknown,
): string {
  if (typeof configuredValue !== "string") {
    throw new SubscriptionPortalConfigurationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredValue);
  } catch {
    throw new SubscriptionPortalConfigurationError();
  }

  if (
    configuredValue !== canonicalSubscriptionPortalReturnUrl ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "app.bitestar.app" ||
    parsed.port !== "" ||
    parsed.pathname !== "/subscription/portal-return" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new SubscriptionPortalConfigurationError();
  }

  return canonicalSubscriptionPortalReturnUrl;
}
