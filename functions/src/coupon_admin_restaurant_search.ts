import {
  createCouponAdminParsedRestaurantContext,
  searchCouponAdminExactRestaurantsPage,
  type CouponAdminHandlerContext,
} from "./coupon_admin_paging.js";
import {
  searchCouponAdminRadiusRestaurantsPage,
  type CouponAdminRadiusHandlerContext,
} from "./coupon_admin_radius_sessions.js";

function requestMode(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const criteria = (value as Record<string, unknown>).criteria;
  if (criteria === null || typeof criteria !== "object" || Array.isArray(criteria)) {
    return undefined;
  }
  return (criteria as Record<string, unknown>).mode;
}

export async function searchCouponAdminRestaurantsPageHandler(
  rawRequest: unknown,
  context: CouponAdminHandlerContext | CouponAdminRadiusHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  if (requestMode(rawRequest) === "nearbyRadius") {
    if (!("radiusStore" in context) || !("geocodeLocation" in context)) {
      throw new Error("Coupon Admin radius dependencies are missing.");
    }
    return searchCouponAdminRadiusRestaurantsPage(rawRequest, context);
  }
  const parsed = createCouponAdminParsedRestaurantContext(rawRequest, context);
  return searchCouponAdminExactRestaurantsPage(parsed, context);
}
