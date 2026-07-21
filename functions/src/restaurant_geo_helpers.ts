import { GeoPoint } from "firebase-admin/firestore";
import {
  distanceBetween,
  geohashForLocation,
  geohashQueryBounds,
  GeohashRange,
} from "geofire-common";

export const restaurantGeohashField = "geohash";

// GeoFire's canonical default is 10 Base32 characters. Keeping the precision
// explicit prevents Functions and future import tools from silently drifting.
export const restaurantGeohashPrecision = 10;
export const KILOMETERS_PER_MILE = 1.609344;
export const MAX_RESTAURANT_SEARCH_RADIUS_KM =
  50 * KILOMETERS_PER_MILE;

export type RestaurantCoordinates = {
  latitude: number;
  longitude: number;
};

export type RestaurantDocumentData = Record<string, unknown>;

export type RestaurantGeohashDecision =
  | { type: "none" }
  | { type: "set"; geohash: string }
  | { type: "delete" };

export type RestaurantCoordinateExtractor = (
  data: RestaurantDocumentData,
) => RestaurantCoordinates | null;

export function validRestaurantCoordinates(
  latitude: unknown,
  longitude: unknown,
): RestaurantCoordinates | null {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    return null;
  }

  return { latitude, longitude };
}

type CompatibleGeoPoint = {
  latitude: number;
  longitude: number;
  isEqual: (other: unknown) => boolean;
};

function isCompatibleGeoPoint(value: unknown): value is CompatibleGeoPoint {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<CompatibleGeoPoint>;
  return (
    (value instanceof GeoPoint || typeof candidate.isEqual === "function") &&
    validRestaurantCoordinates(candidate.latitude, candidate.longitude) !== null
  );
}

function coordinatesFromGeoPoint(value: unknown): RestaurantCoordinates | null {
  if (!isCompatibleGeoPoint(value)) {
    return null;
  }
  return validRestaurantCoordinates(value.latitude, value.longitude);
}

export function extractBiteScoreRestaurantCoordinates(
  data: RestaurantDocumentData,
): RestaurantCoordinates | null {
  return (
    coordinatesFromGeoPoint(data.location) ??
    coordinatesFromGeoPoint(data.geoPoint) ??
    validRestaurantCoordinates(data.latitude, data.longitude) ??
    validRestaurantCoordinates(data.lat, data.lng)
  );
}

export function extractBiteSaverRestaurantCoordinates(
  data: RestaurantDocumentData,
): RestaurantCoordinates | null {
  return validRestaurantCoordinates(data.latitude, data.longitude);
}

export function canonicalRestaurantGeohash(
  coordinates: RestaurantCoordinates,
): string {
  const valid = validRestaurantCoordinates(
    coordinates.latitude,
    coordinates.longitude,
  );
  if (!valid) {
    throw new RangeError("Valid restaurant coordinates are required.");
  }

  return geohashForLocation(
    [valid.latitude, valid.longitude],
    restaurantGeohashPrecision,
  ).toLowerCase();
}

export function decideRestaurantGeohashWrite(
  data: RestaurantDocumentData | null | undefined,
  extractCoordinates: RestaurantCoordinateExtractor,
): RestaurantGeohashDecision {
  if (!data) {
    return { type: "none" };
  }

  const coordinates = extractCoordinates(data);
  if (coordinates) {
    const geohash = canonicalRestaurantGeohash(coordinates);
    return data[restaurantGeohashField] === geohash
      ? { type: "none" }
      : { type: "set", geohash };
  }

  return Object.prototype.hasOwnProperty.call(data, restaurantGeohashField)
    ? { type: "delete" }
    : { type: "none" };
}

export function restaurantGeographicQueryBounds(
  center: RestaurantCoordinates,
  radiusKilometers: unknown,
): GeohashRange[] {
  const validCenter = validRestaurantCoordinates(
    center.latitude,
    center.longitude,
  );
  if (!validCenter) {
    throw new RangeError("Valid restaurant search coordinates are required.");
  }
  if (
    typeof radiusKilometers !== "number" ||
    !Number.isFinite(radiusKilometers) ||
    radiusKilometers <= 0 ||
    radiusKilometers > MAX_RESTAURANT_SEARCH_RADIUS_KM
  ) {
    throw new RangeError(
      `Restaurant search radius must be positive and no greater than ${MAX_RESTAURANT_SEARCH_RADIUS_KM} kilometers.`,
    );
  }

  // Cap queries at 50 miles to bound Firestore reads and keep future search
  // callables predictable. Broader searches must refine their geography.
  return geohashQueryBounds(
    [validCenter.latitude, validCenter.longitude],
    radiusKilometers * 1000,
  );
}

export function exactRestaurantDistanceKilometers(
  first: RestaurantCoordinates,
  second: RestaurantCoordinates,
): number {
  const validFirst = validRestaurantCoordinates(
    first.latitude,
    first.longitude,
  );
  const validSecond = validRestaurantCoordinates(
    second.latitude,
    second.longitude,
  );
  if (!validFirst || !validSecond) {
    throw new RangeError("Valid restaurant coordinates are required.");
  }

  return distanceBetween(
    [validFirst.latitude, validFirst.longitude],
    [validSecond.latitude, validSecond.longitude],
  );
}

export function restaurantSourceDocumentKey(
  source: string,
  documentId: string,
): string {
  const normalizedSource = source.trim();
  const normalizedDocumentId = documentId.trim();
  if (!normalizedSource || !normalizedDocumentId) {
    throw new Error("Restaurant source and document ID are required.");
  }
  return `${normalizedSource}:${normalizedDocumentId}`;
}
