import { GeoPoint } from "firebase-admin/firestore";
import {
  canonicalRestaurantGeohash,
  extractBiteSaverRestaurantCoordinates,
  extractBiteScoreRestaurantCoordinates,
  type RestaurantCoordinateExtractor,
} from "./restaurant_geo_helpers.js";
import {
  buildCityStateKey,
  buildWordPrefixTokens,
  maximumWordPrefixTokenCount,
  normalizeCityName,
  normalizeSearchName,
  normalizeStateCode,
  normalizeZip5,
} from "./search_normalization.js";
import {
  createSearchIndexDocumentId,
  createSourceFingerprint,
  requireSearchIndexDocumentSize,
  searchIndexVersion,
} from "./search_index_contract.js";

export type SearchIndexSourceData = Readonly<Record<string, unknown>>;
export type SearchIndexDocument = Readonly<Record<string, unknown>>;

export type BiteScoreRestaurantClaimProjection = Readonly<{
  isClaimed: boolean;
  claimAvailable: boolean;
  claimStateValid: boolean;
}>;

export function biteScoreRestaurantIsActive(
  data: SearchIndexSourceData,
): boolean {
  const hasCanonical = Object.prototype.hasOwnProperty.call(data, "isActive");
  const hasLegacy = Object.prototype.hasOwnProperty.call(data, "active");
  return (!hasCanonical || data.isActive === true) &&
    (!hasLegacy || data.active === true);
}

export function biteScoreRestaurantClaimProjection(
  data: SearchIndexSourceData,
): BiteScoreRestaurantClaimProjection {
  const hasIsClaimed = Object.prototype.hasOwnProperty.call(data, "isClaimed");
  const hasOwnerUserId = Object.prototype.hasOwnProperty.call(
    data,
    "ownerUserId",
  );
  const isStrictlyUnclaimed =
    (!hasIsClaimed || data.isClaimed === false) &&
    (!hasOwnerUserId ||
      data.ownerUserId === null ||
      data.ownerUserId === "");
  const isValidlyClaimed =
    data.isClaimed === true &&
    typeof data.ownerUserId === "string" &&
    data.ownerUserId.trim().length > 0;
  const isActive = biteScoreRestaurantIsActive(data);

  return Object.freeze({
    isClaimed: isValidlyClaimed,
    claimAvailable: isActive && isStrictlyUnclaimed,
    claimStateValid: isActive && (isStrictlyUnclaimed || isValidlyClaimed),
  });
}

export const maximumOfferDescriptionLength = 500;
export const maximumPublicUrlLength = 2_048;
export const maximumDishCategorySourceCount = 32;
export const maximumDishCategoryInputCount = 128;
export const maximumSearchLocationTextLength = 100;

type GeographyProjection = Readonly<Record<string, unknown>>;

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized || null;
}

function firstString(
  data: SearchIndexSourceData,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = readString(data[field]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function boundedString(value: unknown, maximumLength: number): string | null {
  const text = readString(value);
  return text !== null && Array.from(text).length <= maximumLength ? text : null;
}

export function boundedDescriptionSummary(value: unknown): string | null {
  const text = readString(value);
  if (text === null) {
    return null;
  }
  return Array.from(text).slice(0, maximumOfferDescriptionLength).join("");
}

function publicUrl(value: unknown): string | null {
  const url = boundedString(value, maximumPublicUrlLength);
  return url !== null && /^https?:\/\//iu.test(url) ? url : null;
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as { toDate?: () => unknown };
    if (typeof candidate.toDate === "function") {
      const converted = candidate.toDate();
      return converted instanceof Date && Number.isFinite(converted.getTime())
        ? new Date(converted.getTime())
        : null;
    }
  }
  return null;
}

function sourceTimestamps(data: SearchIndexSourceData): Record<string, unknown> {
  const createdAt = readDate(data.createdAt);
  const updatedAt = readDate(data.updatedAt);
  return {
    ...(createdAt === null ? {} : { sourceCreatedAt: createdAt }),
    ...(updatedAt === null ? {} : { sourceUpdatedAt: updatedAt }),
  };
}

function normalizedNameProjection(value: unknown): {
  displayName: string;
  normalizedName: string;
  namePrefixTokens: readonly string[];
} | null {
  const displayName = readString(value);
  if (displayName === null) {
    return null;
  }
  try {
    return {
      displayName,
      normalizedName: normalizeSearchName(displayName),
      namePrefixTokens: buildWordPrefixTokens(displayName),
    };
  } catch {
    return null;
  }
}

function geographyProjection(
  data: SearchIndexSourceData,
  options: {
    zipFields: readonly string[];
    cityFields: readonly string[];
    stateFields: readonly string[];
    extractCoordinates: RestaurantCoordinateExtractor;
  },
): GeographyProjection {
  const result: Record<string, unknown> = {};
  const zip = firstString(data, options.zipFields);
  if (zip !== null) {
    try {
      result.zip5 = normalizeZip5(zip);
    } catch {
      // Invalid ZIP does not invalidate other search modes.
    }
  }

  const cityValue = firstString(data, options.cityFields);
  const stateValue = firstString(data, options.stateFields);
  const city = cityValue !== null &&
    Array.from(cityValue).length <= maximumSearchLocationTextLength
    ? cityValue
    : null;
  const state = stateValue !== null && Array.from(stateValue).length <= 10
    ? stateValue
    : null;
  if (city !== null && state !== null) {
    try {
      result.normalizedCity = normalizeCityName(city);
      result.normalizedState = normalizeStateCode(state);
      result.cityStateKey = buildCityStateKey(city, state);
    } catch {
      // City/state search requires both fields to be canonical.
    }
  }

  const coordinates = options.extractCoordinates(data);
  const storedGeohash = readString(data.geohash)?.toLowerCase() ?? null;
  if (coordinates !== null && storedGeohash !== null) {
    const expectedGeohash = canonicalRestaurantGeohash(coordinates);
    if (storedGeohash === expectedGeohash) {
      result.latitude = coordinates.latitude;
      result.longitude = coordinates.longitude;
      result.location = new GeoPoint(
        coordinates.latitude,
        coordinates.longitude,
      );
      result.geohash = expectedGeohash;
    }
  }
  return Object.freeze(result);
}

function biteSaverGeography(data: SearchIndexSourceData): GeographyProjection {
  return geographyProjection(data, {
    zipFields: ["zipCode", "postalCode", "zip"],
    cityFields: ["city"],
    stateFields: ["state"],
    extractCoordinates: extractBiteSaverRestaurantCoordinates,
  });
}

function biteScoreGeography(data: SearchIndexSourceData): GeographyProjection {
  return geographyProjection(data, {
    zipFields: ["zipCode", "zip", "postalCode", "postcode"],
    cityFields: ["city", "locality", "municipality", "town"],
    stateFields: ["state", "stateCode", "region", "province"],
    extractCoordinates: extractBiteScoreRestaurantCoordinates,
  });
}

function finalizeIndexDocument(
  draft: Record<string, unknown>,
  now: Date,
): SearchIndexDocument {
  const sourceFingerprint = createSourceFingerprint([draft]);
  const document = {
    ...draft,
    sourceFingerprint,
    indexedAt: new Date(now.getTime()),
  };
  requireSearchIndexDocumentSize(document);
  return Object.freeze(document);
}

function lowerStatus(value: unknown, fallback: string): string {
  return boundedString(value, 64)?.toLowerCase() ?? fallback;
}

function parentSubscriptionAllowsOffers(
  data: SearchIndexSourceData,
): boolean {
  return lowerStatus(data.approvalStatus, "pending") === "approved" &&
    data.couponPostingEnabled === true;
}

export function biteSaverOfferParentFingerprint(
  data: SearchIndexSourceData | null,
): string {
  if (data === null) {
    return createSourceFingerprint(["biteSaverOfferParent", "missing"]);
  }
  return createSourceFingerprint([
    "biteSaverOfferParent",
    firstString(data, ["restaurantName", "name"]),
    lowerStatus(data.approvalStatus, "pending"),
    data.couponPostingEnabled === true,
    firstString(data, ["zipCode", "postalCode", "zip"]),
    firstString(data, ["city"]),
    firstString(data, ["state"]),
    data.latitude ?? null,
    data.longitude ?? null,
    readString(data.geohash),
    publicUrl(data.mainImageUrl),
  ]);
}

export function biteScoreDishParentFingerprint(
  data: SearchIndexSourceData | null,
): string {
  if (data === null) {
    return createSourceFingerprint(["biteScoreDishParent", "missing"]);
  }
  const coordinates = extractBiteScoreRestaurantCoordinates(data);
  return createSourceFingerprint([
    "biteScoreDishParent",
    firstString(data, ["name", "restaurantName", "restaurant_name"]),
    biteScoreRestaurantIsActive(data),
    data.isClaimed === true,
    firstString(data, ["zipCode", "zip", "postalCode", "postcode"]),
    firstString(data, ["city", "locality", "municipality", "town"]),
    firstString(data, ["state", "stateCode", "region", "province"]),
    coordinates?.latitude ?? null,
    coordinates?.longitude ?? null,
    readString(data.geohash),
  ]);
}

export function buildBiteSaverRestaurantIndex(value: {
  sourceDocumentId: string;
  source: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (value.source === null) {
    return null;
  }
  const name = normalizedNameProjection(
    firstString(value.source, ["restaurantName", "name"]),
  );
  if (name === null) {
    return null;
  }
  const approvalStatus = lowerStatus(value.source.approvalStatus, "pending");
  const imageUrl = publicUrl(value.source.mainImageUrl ?? value.source.imageUrl);
  const website = publicUrl(value.source.website);
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteSaverRestaurant",
    sourceDocumentId: value.sourceDocumentId,
  });
  return finalizeIndexDocument({
    searchIndexVersion,
    entityType: "restaurant",
    source: "biteSaver",
    sourceDocumentId: value.sourceDocumentId,
    indexDocumentId,
    ...name,
    ...biteSaverGeography(value.source),
    publicVisible:
      approvalStatus === "approved" && value.source.couponPostingEnabled === true,
    adminDirectoryVisible: approvalStatus === "approved",
    approvalStatus,
    couponApplicationSubmitted:
      value.source.couponApplicationSubmitted === true,
    ...(imageUrl === null ? {} : { primaryImageUrl: imageUrl }),
    ...(website === null ? {} : { website }),
    ...sourceTimestamps(value.source),
  }, value.now);
}

export function buildBiteScoreRestaurantIndex(value: {
  sourceDocumentId: string;
  source: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (value.source === null) {
    return null;
  }
  const name = normalizedNameProjection(
    firstString(value.source, ["name", "restaurantName", "restaurant_name"]),
  );
  if (name === null) {
    return null;
  }
  const isActive = biteScoreRestaurantIsActive(value.source);
  const claim = biteScoreRestaurantClaimProjection(value.source);
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: value.sourceDocumentId,
  });
  return finalizeIndexDocument({
    searchIndexVersion,
    entityType: "restaurant",
    source: "biteScore",
    sourceDocumentId: value.sourceDocumentId,
    indexDocumentId,
    ...name,
    ...biteScoreGeography(value.source),
    publicVisible: isActive,
    adminDirectoryVisible: true,
    isActive,
    ...claim,
    ...sourceTimestamps(value.source),
  }, value.now);
}

function categoryTokens(data: SearchIndexSourceData): readonly string[] {
  const sources = [data.category, data.subcategory];
  if (Array.isArray(data.categoryTags)) {
    sources.push(...data.categoryTags.slice(0, maximumDishCategoryInputCount));
  }
  const normalized = new Set<string>();
  for (const source of sources) {
    const text = readString(source);
    if (text === null) {
      continue;
    }
    try {
      normalized.add(normalizeSearchName(text));
    } catch {
      // Invalid category aliases are omitted rather than copied.
    }
  }
  return Object.freeze(
    [...normalized].sort().slice(0, maximumDishCategorySourceCount),
  );
}

function optionalScore(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10
    ? value
    : null;
}

export function buildBiteScoreDishIndex(value: {
  sourceDocumentId: string;
  dish: SearchIndexSourceData | null;
  restaurantDocumentId: string | null;
  restaurant: SearchIndexSourceData | null;
  aggregate: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (
    value.dish === null ||
    value.restaurant === null ||
    value.restaurantDocumentId === null ||
    readString(value.dish.restaurantId) !== value.restaurantDocumentId
  ) {
    return null;
  }
  const name = normalizedNameProjection(value.dish.name);
  const restaurantName = normalizedNameProjection(
    firstString(value.restaurant, ["name", "restaurantName", "restaurant_name"]),
  );
  if (name === null || restaurantName === null) {
    return null;
  }
  const dishActive = value.dish.isActive !== false &&
    readString(value.dish.mergedIntoDishId) === null;
  const restaurantActive = biteScoreRestaurantIsActive(value.restaurant);
  const tokens = categoryTokens(value.dish);
  let normalizedCategory: string | null = null;
  const category = readString(value.dish.category);
  if (category !== null) {
    try {
      normalizedCategory = normalizeSearchName(category);
    } catch {
      normalizedCategory = null;
    }
  }
  const categoryPrefixTokens = normalizedCategory === null
    ? Object.freeze([] as string[])
    : buildWordPrefixTokens(normalizedCategory).slice(
        0,
        maximumWordPrefixTokenCount,
      );
  const primaryImageUrl = publicUrl(value.dish.primaryImageUrl);
  const primaryImageId = boundedString(value.dish.primaryImageId, 1_500);
  const aggregateDishId = value.aggregate === null
    ? null
    : readString(value.aggregate.dishId);
  const aggregateRestaurantId = value.aggregate === null
    ? null
    : readString(value.aggregate.restaurantId);
  const aggregate = value.aggregate !== null &&
    (aggregateDishId === null || aggregateDishId === value.sourceDocumentId) &&
    (aggregateRestaurantId === null ||
      aggregateRestaurantId === value.restaurantDocumentId)
    ? value.aggregate
    : {};
  const overallBiteScore = optionalScore(aggregate.overallBiteScore) ?? 0;
  const ratingCount = typeof aggregate.ratingCount === "number" &&
    Number.isSafeInteger(aggregate.ratingCount) &&
    aggregate.ratingCount >= 0
    ? aggregate.ratingCount
    : 0;
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: value.sourceDocumentId,
  });
  return finalizeIndexDocument({
    searchIndexVersion,
    entityType: "dish",
    source: "biteScore",
    sourceDocumentId: value.sourceDocumentId,
    restaurantSourceDocumentId: value.restaurantDocumentId,
    indexDocumentId,
    ...name,
    categoryTokens: tokens,
    ...(normalizedCategory === null ? {} : { normalizedCategory }),
    categoryPrefixTokens,
    restaurantDisplayName: restaurantName.displayName,
    restaurantNormalizedName: restaurantName.normalizedName,
    restaurantNamePrefixTokens: restaurantName.namePrefixTokens,
    ...biteScoreGeography(value.restaurant),
    dishActive,
    restaurantActive,
    restaurantClaimed: value.restaurant.isClaimed === true,
    publicVisible: dishActive && restaurantActive,
    adminVisible: true,
    overallBiteScore,
    ratingCount,
    ...(optionalScore(aggregate.overallImpressionAverage) === null
      ? {}
      : { overallImpressionAverage: aggregate.overallImpressionAverage }),
    ...(optionalScore(aggregate.tastinessScoreAverage) === null
      ? {}
      : { tastinessScoreAverage: aggregate.tastinessScoreAverage }),
    ...(optionalScore(aggregate.qualityScoreAverage) === null
      ? {}
      : { qualityScoreAverage: aggregate.qualityScoreAverage }),
    ...(optionalScore(aggregate.valueScoreAverage) === null
      ? {}
      : { valueScoreAverage: aggregate.valueScoreAverage }),
    ...(primaryImageUrl === null ? {} : { primaryImageUrl }),
    ...(primaryImageId === null ? {} : { primaryImageId }),
    ...sourceTimestamps(value.dish),
    ...(readDate(aggregate.updatedAt) === null
      ? {}
      : { aggregateUpdatedAt: readDate(aggregate.updatedAt) }),
  }, value.now);
}

function offerBase(value: {
  offerType: "coupon" | "dailySpecial";
  sourceKind: "biteSaverCoupon" | "biteSaverDailySpecial";
  restaurantAccountId: string;
  sourceDocumentId: string;
  offer: SearchIndexSourceData;
  restaurant: SearchIndexSourceData;
}): Record<string, unknown> | null {
  const title = normalizedNameProjection(value.offer.title);
  const restaurantName = normalizedNameProjection(
    firstString(value.restaurant, ["restaurantName", "name"]),
  );
  if (title === null || restaurantName === null) {
    return null;
  }
  const descriptionSummary = boundedDescriptionSummary(value.offer.details);
  const imageUrl = publicUrl(value.offer.imageUrl);
  const restaurantImageUrl = publicUrl(value.restaurant.mainImageUrl);
  return {
    searchIndexVersion,
    entityType: "offer",
    offerType: value.offerType,
    source: "biteSaver",
    restaurantAccountId: value.restaurantAccountId,
    sourceDocumentId: value.sourceDocumentId,
    indexDocumentId: createSearchIndexDocumentId({
      entityKind: "offer",
      sourceKind: value.sourceKind,
      sourceDocumentId: value.sourceDocumentId,
      parentSourceDocumentId: value.restaurantAccountId,
    }),
    displayTitle: title.displayName,
    normalizedTitle: title.normalizedName,
    titlePrefixTokens: title.namePrefixTokens,
    restaurantDisplayName: restaurantName.displayName,
    restaurantNormalizedName: restaurantName.normalizedName,
    restaurantNamePrefixTokens: restaurantName.namePrefixTokens,
    ...biteSaverGeography(value.restaurant),
    ...(descriptionSummary === null ? {} : { descriptionSummary }),
    ...(imageUrl === null ? {} : { primaryImageUrl: imageUrl }),
    ...(restaurantImageUrl === null
      ? {}
      : { restaurantPrimaryImageUrl: restaurantImageUrl }),
    ...sourceTimestamps(value.offer),
  };
}

export function buildBiteSaverCouponOfferIndex(value: {
  restaurantAccountId: string;
  sourceDocumentId: string;
  offer: SearchIndexSourceData | null;
  restaurant: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (value.offer === null || value.restaurant === null) {
    return null;
  }
  const base = offerBase({
    offerType: "coupon",
    sourceKind: "biteSaverCoupon",
    restaurantAccountId: value.restaurantAccountId,
    sourceDocumentId: value.sourceDocumentId,
    offer: value.offer,
    restaurant: value.restaurant,
  });
  if (base === null) {
    return null;
  }
  const startAt = readDate(value.offer.startTime);
  const endAt = readDate(value.offer.endTime ?? value.offer.expires);
  const explicitActive = value.offer.isActive !== false && value.offer.active !== false;
  const scheduleActive = (startAt === null || value.now >= startAt) &&
    (endAt === null || value.now <= endAt);
  const offerActive = explicitActive && scheduleActive;
  return finalizeIndexDocument({
    ...base,
    publicVisible:
      parentSubscriptionAllowsOffers(value.restaurant) && offerActive,
    adminVisible: true,
    offerActive,
    ...(startAt === null ? {} : { startAt }),
    ...(endAt === null ? {} : { endAt }),
    isProximityOnly: value.offer.isProximityOnly === true,
  }, value.now);
}

function normalizedDays(value: unknown): readonly number[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  const days = new Set<number>();
  for (const entry of value) {
    const day = typeof entry === "number"
      ? entry
      : typeof entry === "string"
        ? Number(entry.trim())
        : Number.NaN;
    if (Number.isInteger(day) && day >= 1 && day <= 7) {
      days.add(day);
      if (days.size === 7) {
        break;
      }
    }
  }
  return Object.freeze([...days].sort((first, second) => first - second));
}

function normalizedTime(value: unknown): string | null {
  const text = readString(value);
  if (text === null) {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})$/u.exec(text);
  if (match === null) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : null;
}

function minutesSinceMidnight(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function dailySpecialSchedule(value: {
  offer: SearchIndexSourceData;
  now: Date;
}): {
  availabilityMode: "todayOnly" | "specificDays";
  daysOfWeek: readonly number[];
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  hideWhenUnavailable: boolean;
  expiresAt: Date | null;
  offerActive: boolean;
} {
  const availabilityMode = value.offer.availabilityMode === "specificDays"
    ? "specificDays"
    : "todayOnly";
  const daysOfWeek = normalizedDays(value.offer.daysOfWeek);
  const allDay = value.offer.allDay !== false;
  const startTime = allDay ? null : normalizedTime(value.offer.startTime);
  const endTime = allDay ? null : normalizedTime(value.offer.endTime);
  const hideWhenUnavailable = value.offer.hideWhenUnavailable !== false;
  let expiresAt = readDate(value.offer.expiresAt);
  if (availabilityMode === "todayOnly" && expiresAt === null) {
    const basis = readDate(value.offer.createdAt) ?? readDate(value.offer.updatedAt);
    if (basis !== null) {
      expiresAt = new Date(
        basis.getFullYear(),
        basis.getMonth(),
        basis.getDate() + 1,
      );
    }
  }
  const active = value.offer.isActive !== false;
  const notExpired = availabilityMode !== "todayOnly" ||
    expiresAt === null ||
    value.now < expiresAt;
  const weekday = value.now.getDay() === 0 ? 7 : value.now.getDay();
  const scheduledToday = availabilityMode === "todayOnly" ||
    daysOfWeek.includes(weekday);
  const currentMinutes = value.now.getHours() * 60 + value.now.getMinutes();
  const startMinutes = minutesSinceMidnight(startTime);
  const endMinutes = minutesSinceMidnight(endTime);
  const availableNow = allDay ||
    (startMinutes !== null &&
      endMinutes !== null &&
      currentMinutes >= startMinutes &&
      currentMinutes <= endMinutes);
  const offerActive = active &&
    notExpired &&
    scheduledToday &&
    (!hideWhenUnavailable || availableNow);
  return {
    availabilityMode,
    daysOfWeek,
    allDay,
    startTime,
    endTime,
    hideWhenUnavailable,
    expiresAt,
    offerActive,
  };
}

export function buildBiteSaverDailySpecialOfferIndex(value: {
  restaurantAccountId: string;
  sourceDocumentId: string;
  offer: SearchIndexSourceData | null;
  restaurant: SearchIndexSourceData | null;
  now: Date;
}): SearchIndexDocument | null {
  if (value.offer === null || value.restaurant === null) {
    return null;
  }
  const storedRestaurantId = readString(value.offer.restaurantId);
  const storedOwnerUid = readString(value.offer.ownerUid);
  if (
    (storedRestaurantId !== null &&
      storedRestaurantId !== value.restaurantAccountId) ||
    (storedOwnerUid !== null && storedOwnerUid !== value.restaurantAccountId)
  ) {
    return null;
  }
  const base = offerBase({
    offerType: "dailySpecial",
    sourceKind: "biteSaverDailySpecial",
    restaurantAccountId: value.restaurantAccountId,
    sourceDocumentId: value.sourceDocumentId,
    offer: value.offer,
    restaurant: value.restaurant,
  });
  if (base === null) {
    return null;
  }
  const schedule = dailySpecialSchedule({ offer: value.offer, now: value.now });
  return finalizeIndexDocument({
    ...base,
    publicVisible:
      parentSubscriptionAllowsOffers(value.restaurant) &&
      schedule.offerActive,
    adminVisible: true,
    offerActive: schedule.offerActive,
    availabilityMode: schedule.availabilityMode,
    daysOfWeek: schedule.daysOfWeek,
    allDay: schedule.allDay,
    ...(schedule.startTime === null ? {} : { startTime: schedule.startTime }),
    ...(schedule.endTime === null ? {} : { endTime: schedule.endTime }),
    hideWhenUnavailable: schedule.hideWhenUnavailable,
    ...(schedule.expiresAt === null ? {} : { expiresAt: schedule.expiresAt }),
  }, value.now);
}
