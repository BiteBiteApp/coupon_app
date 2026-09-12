import type {
  CustomerBiteSaverStoredDocument,
} from "./customer_bitesaver_search_store.js";

export const customerBiteSaverFavoriteContractVersion =
  "bitestar.customer-bitesaver-favorite.v1" as const;
export const customerBiteSaverCouponRedemptionContractVersion =
  "bitestar.customer-bitesaver-coupon-redemption.v1" as const;
export const customerBiteSaverCustomerDataSchemaVersion = 1 as const;
export const customerBiteSaverCouponRedemptionV1TimerMilliseconds =
  5 * 60_000;

export const customerBiteSaverRestaurantFavoriteKind =
  "bitesaverRestaurant" as const;
export const customerBiteSaverCouponFavoriteKind = "bitesaverCoupon" as const;
export const customerBiteSaverCouponOfferType = "coupon" as const;
export const customerBiteSaverRedemptionIdPrefix = "bsrd" as const;

const restaurantFavoriteKeys = Object.freeze([
  "createdAt",
  "favoriteKind",
  "restaurantId",
  "schemaVersion",
  "updatedAt",
  "userId",
].sort());

const couponFavoriteKeys = Object.freeze([
  "createdAt",
  "favoriteKind",
  "offerId",
  "offerType",
  "restaurantId",
  "schemaVersion",
  "updatedAt",
  "userId",
].sort());

const couponRedemptionKeys = Object.freeze([
  "createdAt",
  "offerId",
  "offerType",
  "redemptionId",
  "restaurantId",
  "schemaVersion",
  "timerExpiresAt",
  "timerStartedAt",
  "updatedAt",
  "userId",
].sort());

export type CustomerBiteSaverCanonicalRestaurantFavorite = Readonly<{
  schemaVersion: typeof customerBiteSaverCustomerDataSchemaVersion;
  favoriteKind: typeof customerBiteSaverRestaurantFavoriteKind;
  userId: string;
  restaurantId: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CustomerBiteSaverCanonicalCouponFavorite = Readonly<{
  schemaVersion: typeof customerBiteSaverCustomerDataSchemaVersion;
  favoriteKind: typeof customerBiteSaverCouponFavoriteKind;
  userId: string;
  restaurantId: string;
  offerId: string;
  offerType: typeof customerBiteSaverCouponOfferType;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CustomerBiteSaverCanonicalCouponRedemption = Readonly<{
  schemaVersion: typeof customerBiteSaverCustomerDataSchemaVersion;
  userId: string;
  restaurantId: string;
  offerId: string;
  offerType: typeof customerBiteSaverCouponOfferType;
  redemptionId: string;
  timerStartedAt: Date;
  timerExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}>;

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
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

function validPathComponent(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value !== "." && value !== ".." && !/^__.*__$/u.test(value) &&
    !value.includes("/") && hasWellFormedUtf16(value) &&
    Buffer.byteLength(value, "utf8") <= 1_500;
}

function isPublicId(value: unknown, prefix: "bsr" | "bso"): value is string {
  return typeof value === "string" &&
    new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`, "u").test(value);
}

function dateValue(value: unknown): Date | null {
  let candidate: unknown = value;
  if (
    value !== null && typeof value === "object" && !(value instanceof Date)
  ) {
    const toDate = (value as {toDate?: unknown}).toDate;
    if (typeof toDate !== "function") {
      return null;
    }
    try {
      candidate = toDate.call(value);
    } catch {
      return null;
    }
  }
  if (!(candidate instanceof Date)) {
    return null;
  }
  const milliseconds = candidate.getTime();
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? new Date(milliseconds)
    : null;
}

function favoriteBase(value: {
  document: CustomerBiteSaverStoredDocument;
  userId: string;
  publicId: string;
  collection: "favorite_restaurants" | "favorite_coupons";
  keys: readonly string[];
}): Readonly<{createdAt: Date; updatedAt: Date}> | null {
  const data = value.document.data;
  const createdAt = dateValue(data.createdAt);
  const updatedAt = dateValue(data.updatedAt);
  const expectedPath = `user_profiles/${value.userId}/${value.collection}/` +
    value.publicId;
  if (
    !validPathComponent(value.userId) ||
    value.document.id !== value.publicId ||
    value.document.path !== expectedPath ||
    !hasExactKeys(data, value.keys) ||
    data.schemaVersion !== customerBiteSaverCustomerDataSchemaVersion ||
    data.userId !== value.userId ||
    createdAt === null || updatedAt === null ||
    updatedAt.getTime() < createdAt.getTime()
  ) {
    return null;
  }
  return Object.freeze({createdAt, updatedAt});
}

export function customerBiteSaverRestaurantFavoritePath(
  userId: string,
  restaurantId: string,
): string {
  if (!validPathComponent(userId) || !isPublicId(restaurantId, "bsr")) {
    throw new Error("Invalid canonical BiteSaver restaurant favorite path.");
  }
  return `user_profiles/${userId}/favorite_restaurants/${restaurantId}`;
}

export function customerBiteSaverCouponFavoritePath(
  userId: string,
  offerId: string,
): string {
  if (!validPathComponent(userId) || !isPublicId(offerId, "bso")) {
    throw new Error("Invalid canonical BiteSaver coupon favorite path.");
  }
  return `user_profiles/${userId}/favorite_coupons/${offerId}`;
}

export function customerBiteSaverCouponRedemptionPath(
  userId: string,
  offerId: string,
): string {
  if (!validPathComponent(userId) || !isPublicId(offerId, "bso")) {
    throw new Error("Invalid canonical BiteSaver coupon redemption path.");
  }
  return `customer_redemptions/${userId}/coupon_redemptions/${offerId}`;
}

export function parseCustomerBiteSaverRestaurantFavorite(
  document: CustomerBiteSaverStoredDocument,
  expected: Readonly<{userId: string; restaurantId: string}>,
): CustomerBiteSaverCanonicalRestaurantFavorite | null {
  if (!isPublicId(expected.restaurantId, "bsr")) {
    return null;
  }
  const base = favoriteBase({
    document,
    userId: expected.userId,
    publicId: expected.restaurantId,
    collection: "favorite_restaurants",
    keys: restaurantFavoriteKeys,
  });
  const data = document.data;
  if (
    base === null ||
    data.favoriteKind !== customerBiteSaverRestaurantFavoriteKind ||
    data.restaurantId !== expected.restaurantId
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverCustomerDataSchemaVersion,
    favoriteKind: customerBiteSaverRestaurantFavoriteKind,
    userId: expected.userId,
    restaurantId: expected.restaurantId,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  });
}

export function parseCustomerBiteSaverCouponFavorite(
  document: CustomerBiteSaverStoredDocument,
  expected: Readonly<{
    userId: string;
    restaurantId: string;
    offerId: string;
  }>,
): CustomerBiteSaverCanonicalCouponFavorite | null {
  if (
    !isPublicId(expected.restaurantId, "bsr") ||
    !isPublicId(expected.offerId, "bso")
  ) {
    return null;
  }
  const base = favoriteBase({
    document,
    userId: expected.userId,
    publicId: expected.offerId,
    collection: "favorite_coupons",
    keys: couponFavoriteKeys,
  });
  const data = document.data;
  if (
    base === null ||
    data.favoriteKind !== customerBiteSaverCouponFavoriteKind ||
    data.restaurantId !== expected.restaurantId ||
    data.offerId !== expected.offerId ||
    data.offerType !== customerBiteSaverCouponOfferType
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverCustomerDataSchemaVersion,
    favoriteKind: customerBiteSaverCouponFavoriteKind,
    userId: expected.userId,
    restaurantId: expected.restaurantId,
    offerId: expected.offerId,
    offerType: customerBiteSaverCouponOfferType,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  });
}

export function parseCustomerBiteSaverCouponRedemption(
  document: CustomerBiteSaverStoredDocument,
  expected: Readonly<{
    userId: string;
    restaurantId: string;
    offerId: string;
  }>,
): CustomerBiteSaverCanonicalCouponRedemption | null {
  const data = document.data;
  const timerStartedAt = dateValue(data.timerStartedAt);
  const timerExpiresAt = dateValue(data.timerExpiresAt);
  const createdAt = dateValue(data.createdAt);
  const updatedAt = dateValue(data.updatedAt);
  if (
    !validPathComponent(expected.userId) ||
    !isPublicId(expected.restaurantId, "bsr") ||
    !isPublicId(expected.offerId, "bso") ||
    document.id !== expected.offerId ||
    document.path !== customerBiteSaverCouponRedemptionPath(
      expected.userId,
      expected.offerId,
    ) ||
    !hasExactKeys(data, couponRedemptionKeys) ||
    data.schemaVersion !== customerBiteSaverCustomerDataSchemaVersion ||
    data.userId !== expected.userId ||
    data.restaurantId !== expected.restaurantId ||
    data.offerId !== expected.offerId ||
    data.offerType !== customerBiteSaverCouponOfferType ||
    typeof data.redemptionId !== "string" ||
    !/^bsrd_[A-Za-z0-9_-]{43}$/u.test(data.redemptionId) ||
    timerStartedAt === null || timerExpiresAt === null ||
    createdAt === null || updatedAt === null ||
    timerExpiresAt.getTime() !== timerStartedAt.getTime() +
      customerBiteSaverCouponRedemptionV1TimerMilliseconds ||
    createdAt.getTime() > timerStartedAt.getTime() ||
    updatedAt.getTime() !== timerStartedAt.getTime()
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverCustomerDataSchemaVersion,
    userId: expected.userId,
    restaurantId: expected.restaurantId,
    offerId: expected.offerId,
    offerType: customerBiteSaverCouponOfferType,
    redemptionId: data.redemptionId,
    timerStartedAt,
    timerExpiresAt,
    createdAt,
    updatedAt,
  });
}

export function buildCustomerBiteSaverCouponRedemption(value: Readonly<{
  userId: string;
  restaurantId: string;
  offerId: string;
  redemptionId: string;
  timerStartedAt: Date;
  createdAt: Date;
}>): CustomerBiteSaverCanonicalCouponRedemption {
  if (
    !validPathComponent(value.userId) ||
    !isPublicId(value.restaurantId, "bsr") ||
    !isPublicId(value.offerId, "bso") ||
    !/^bsrd_[A-Za-z0-9_-]{43}$/u.test(value.redemptionId) ||
    dateValue(value.timerStartedAt) === null ||
    dateValue(value.createdAt) === null ||
    value.createdAt.getTime() > value.timerStartedAt.getTime()
  ) {
    throw new Error("Invalid canonical BiteSaver coupon redemption.");
  }
  const timerStartedAt = new Date(value.timerStartedAt.getTime());
  return Object.freeze({
    schemaVersion: customerBiteSaverCustomerDataSchemaVersion,
    userId: value.userId,
    restaurantId: value.restaurantId,
    offerId: value.offerId,
    offerType: customerBiteSaverCouponOfferType,
    redemptionId: value.redemptionId,
    timerStartedAt,
    timerExpiresAt: new Date(
      timerStartedAt.getTime() +
        customerBiteSaverCouponRedemptionV1TimerMilliseconds,
    ),
    createdAt: new Date(value.createdAt.getTime()),
    updatedAt: new Date(timerStartedAt.getTime()),
  });
}

export const customerBiteSaverCustomerDataInternals = Object.freeze({
  couponFavoriteKeys,
  couponRedemptionKeys,
  restaurantFavoriteKeys,
});
