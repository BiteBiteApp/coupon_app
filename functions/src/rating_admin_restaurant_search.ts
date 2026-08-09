import {
  createRatingAdminParsedRestaurantContext,
  searchRatingAdminExactRestaurantsPage,
  type RatingAdminHandlerContext,
} from "./rating_admin_paging.js";
import {
  searchRatingAdminRadiusRestaurantsPage,
  type RatingAdminRadiusHandlerContext,
} from "./rating_admin_radius_sessions.js";

function requestMode(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const criteria = (value as Record<string, unknown>).criteria;
  if (
    criteria === null ||
    typeof criteria !== "object" ||
    Array.isArray(criteria)
  ) {
    return undefined;
  }
  return (criteria as Record<string, unknown>).mode;
}

export async function searchRatingAdminRestaurantsPageHandler(
  rawRequest: unknown,
  context: RatingAdminHandlerContext | RatingAdminRadiusHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  if (requestMode(rawRequest) === "nearbyRadius") {
    if (!("radiusStore" in context) || !("geocodeLocation" in context)) {
      throw new Error("Rating Admin radius dependencies are missing.");
    }
    return searchRatingAdminRadiusRestaurantsPage(rawRequest, context);
  }
  const parsed = createRatingAdminParsedRestaurantContext(rawRequest, context);
  return searchRatingAdminExactRestaurantsPage(parsed, context);
}
