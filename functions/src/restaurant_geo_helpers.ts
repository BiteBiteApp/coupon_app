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
export const CUSTOMER_BITESAVER_EARTH_RADIUS_METERS = 6_378_137;
export const METERS_PER_MILE = 1_609.344;
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

export function mergedRestaurantGeographicQueryBounds(
  center: RestaurantCoordinates,
  radiusMiles: number,
): readonly GeohashRange[] {
  if (
    !Number.isFinite(radiusMiles) ||
    radiusMiles <= 0 ||
    radiusMiles > 30
  ) {
    throw new RangeError("Customer radius is invalid.");
  }
  const sorted = restaurantGeographicQueryBounds(
    center,
    radiusMiles * KILOMETERS_PER_MILE,
  )
    .map(([start, end]): GeohashRange => [start, end])
    .sort((left, right) =>
      left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
  const merged: GeohashRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || range[0] > previous[1]) {
      merged.push(range);
      continue;
    }
    if (range[1] > previous[1]) {
      merged[merged.length - 1] = [previous[0], range[1]];
    }
  }
  if (merged.length > 9) {
    throw new Error("Customer geographic range count exceeds its bound.");
  }
  return Object.freeze(merged);
}

function degreesToRadians(value: number): number {
  return value * (Math.PI / 180);
}

export function exactCustomerBiteSaverDistanceMeters(
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

  const firstLatitude = degreesToRadians(validFirst.latitude);
  const secondLatitude = degreesToRadians(validSecond.latitude);
  const latitudeDelta = secondLatitude - firstLatitude;
  const longitudeDelta = degreesToRadians(
    validSecond.longitude - validFirst.longitude,
  );
  const latitudeSine = Math.sin(latitudeDelta / 2);
  const longitudeSine = Math.sin(longitudeDelta / 2);
  const haversine = latitudeSine * latitudeSine +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) *
      longitudeSine * longitudeSine;
  const centralAngle = 2 * Math.atan2(
    Math.sqrt(Math.max(0, Math.min(1, haversine))),
    Math.sqrt(Math.max(0, 1 - haversine)),
  );
  return CUSTOMER_BITESAVER_EARTH_RADIUS_METERS * centralAngle;
}

export function exactCustomerBiteSaverDistanceMiles(
  first: RestaurantCoordinates,
  second: RestaurantCoordinates,
): number {
  return exactCustomerBiteSaverDistanceMeters(first, second) / METERS_PER_MILE;
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
