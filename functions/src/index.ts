import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Firestore,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import Stripe from "stripe";

initializeApp();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

const db: Firestore = getFirestore();
const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripeCheckoutSuccessUrl = "https://coupon-app-29446.web.app/stripe-success.html";
const stripeCheckoutCancelUrl = "https://coupon-app-29446.web.app/stripe-cancel.html";
const stripeCustomerPortalReturnUrl = defineString(
  "STRIPE_CUSTOMER_PORTAL_RETURN_URL",
);
const hostedStripeCheckoutSuccessUrl =
  "https://coupon-app-29446.web.app/stripe-success.html";
const hostedStripeCheckoutCancelUrl =
  "https://coupon-app-29446.web.app/stripe-cancel.html";
const stripePriceId = "price_1TJKGjBwoT6e93tVkesJPfxD";
const stripeTrialDays = 60;
const subscriptionReturnSuccessUri = "couponapp://subscription-return?status=success";
const subscriptionReturnCancelUri = "couponapp://subscription-return?status=cancel";

type PushRequestData = {
  requestId?: string;
  installationId?: string;
  guestDeviceId?: string;
  authUid?: string | null;
  customerAccountUid?: string | null;
  isAnonymous?: boolean;
  couponId?: string;
  couponTitle?: string;
  restaurant?: string;
  isProximityOnly?: boolean;
  proximityRadiusMiles?: number | null;
  status?: string;
  source?: string;
  userLatitude?: number | null;
  userLongitude?: number | null;
};

type InstallationData = {
  installationId?: string;
  guestDeviceId?: string;
  fcmToken?: string | null;
  authUid?: string | null;
  customerAccountUid?: string | null;
  isAnonymous?: boolean;
  notificationsPermissionStatus?: string;
  platform?: string;
  proximityPushEnabled?: boolean;
  maxProximityPushesPerDay?: number;
};

type LocalExpertTypeConfig = {
  id: string;
  displayName: string;
  mappedCategoryNames?: string[];
  mappedSubcategories?: string[];
  aliases?: string[];
  categoryMayQualify?: boolean;
};

type LocalExpertReviewData = {
  id?: string;
  dishId?: string;
  restaurantId?: string;
  userId?: string;
  headline?: string | null;
  notes?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  isPublic?: boolean;
  isDeleted?: boolean;
  hidden?: boolean;
  isHidden?: boolean;
  status?: string;
};

type LocalExpertDishData = {
  id?: string;
  name?: string;
  category?: string;
  subcategory?: string;
  categoryTags?: string[];
  isActive?: boolean;
  mergedIntoDishId?: string | null;
};

type LocalExpertRestaurantData = {
  id?: string;
  location?: { latitude: number; longitude: number };
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
  active?: boolean;
};

type LocalExpertReviewCandidate = {
  reviewId: string;
  restaurantId: string;
  dishName?: string;
  categoryName?: string;
  subcategory?: string;
  categoryTags: string[];
  headline?: string | null;
  notes?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  latitude?: number;
  longitude?: number;
};

type LocalExpertResolvedReview = {
  candidate: LocalExpertReviewCandidate;
  expertType: LocalExpertTypeConfig;
};

type LocalExpertBadgeResult = {
  expertTypeId: string;
  displayName: string;
  level: "level1" | "level2" | "level3" | null;
  totalRestaurantCount: number;
  localClusterRestaurantCount: number;
  qualificationMethod: "none" | "localCluster" | "overall" | "both";
  qualifyingReviewIds: string[];
  qualifyingRestaurantIds: string[];
};

const localExpertClusterRadiusMiles = 30;
const localExpertTypes: LocalExpertTypeConfig[] = [
  {
    id: "burger",
    displayName: "Burger",
    mappedCategoryNames: ["Burgers"],
    mappedSubcategories: ["Burgers", "Black bean burger", "Veggie burger"],
    aliases: ["burger", "burgers", "cheeseburger", "bacon burger"],
    categoryMayQualify: true,
  },
  {
    id: "pizza",
    displayName: "Pizza",
    mappedCategoryNames: ["Pizza"],
    mappedSubcategories: ["Pizza", "Vegan pizza"],
    aliases: ["pizza", "pepperoni pizza", "cheese pizza"],
    categoryMayQualify: true,
  },
  {
    id: "burrito",
    displayName: "Burrito",
    mappedSubcategories: ["Burrito", "Breakfast burrito"],
    aliases: ["burrito", "burritos"],
  },
  {
    id: "tacos",
    displayName: "Tacos",
    mappedCategoryNames: ["Tacos"],
    mappedSubcategories: ["Tacos", "Breakfast tacos", "Vegan tacos"],
    aliases: ["taco", "tacos"],
    categoryMayQualify: true,
  },
  {
    id: "wings",
    displayName: "Wings",
    mappedSubcategories: ["Boneless wings", "Wings"],
    aliases: ["wings", "wing", "chicken wings", "boneless wings"],
  },
  {
    id: "lobster",
    displayName: "Lobster",
    mappedSubcategories: ["Lobster"],
    aliases: ["lobster", "lobster roll"],
  },
  {
    id: "pasta",
    displayName: "Pasta",
    mappedSubcategories: ["Pasta", "Gnocchi"],
    aliases: ["pasta", "spaghetti", "fettuccine", "linguine", "rigatoni"],
  },
  {
    id: "ramen",
    displayName: "Ramen",
    mappedSubcategories: ["Ramen"],
    aliases: ["ramen", "tonkotsu ramen", "miso ramen"],
  },
  {
    id: "donuts",
    displayName: "Donuts",
    mappedCategoryNames: ["Donuts"],
    aliases: ["donut", "donuts", "doughnut", "doughnuts"],
    categoryMayQualify: true,
  },
  {
    id: "steak",
    displayName: "Steak",
    mappedCategoryNames: ["Steakhouse"],
    mappedSubcategories: [
      "Filet mignon",
      "Hibachi steak",
      "New York strip",
      "Prime rib",
      "Ribeye",
      "Sirloin",
      "Steak",
      "Steak frites",
      "Steak sandwich",
      "Steak tips",
      "T-bone steak",
    ],
    aliases: [
      "steak",
      "ribeye",
      "filet mignon",
      "new york strip",
      "sirloin",
      "t-bone",
      "t bone",
      "porterhouse",
      "prime rib",
    ],
  },
  {
    id: "chinese",
    displayName: "Chinese",
    mappedCategoryNames: ["Chinese"],
    mappedSubcategories: [
      "Beef and broccoli",
      "Chow mein",
      "Dumplings",
      "Egg rolls",
      "Fried rice",
      "General Tso’s chicken",
      "Hot and sour soup",
      "Kung pao chicken",
      "Lo mein",
      "Mongolian beef",
      "Orange chicken",
      "Sesame chicken",
      "Sweet and sour chicken",
      "Wonton soup",
    ],
    aliases: ["chinese", "general tsos chicken", "kung pao", "lo mein"],
    categoryMayQualify: true,
  },
  {
    id: "japanese_sushi",
    displayName: "Japanese / Sushi",
    mappedCategoryNames: ["Japanese / Sushi"],
    mappedSubcategories: [
      "Bento box",
      "Gyoza",
      "Hibachi chicken",
      "Hibachi steak",
      "Nigiri",
      "Sashimi",
      "Sushi",
      "Sushi roll",
      "Tempura",
      "Teriyaki chicken",
      "Udon",
    ],
    aliases: ["japanese", "sushi", "sashimi", "nigiri", "hibachi", "teriyaki"],
    categoryMayQualify: true,
  },
];

function isPermissionUsable(status: string | undefined): boolean {
  return status === "authorized" || status === "provisional";
}

function hasText(value: string | undefined | null): boolean {
  return !!value && value.trim().length > 0;
}

function buildNotificationTitle(data: PushRequestData): string {
  if (hasText(data.restaurant)) {
    return `Nearby deal at ${data.restaurant!.trim()}`;
  }
  return "Nearby deal unlocked";
}

function buildNotificationBody(data: PushRequestData): string {
  if (hasText(data.couponTitle)) {
    return data.couponTitle!.trim();
  }
  return "A nearby proximity coupon just became available.";
}

function unixSecondsToTimestamp(seconds?: number | null): Timestamp | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Timestamp.fromMillis(seconds * 1000);
}

function normalizeTerm(value?: string | null): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : [];
}

function writtenReviewWordCount(headline?: string | null, notes?: string | null): number {
  const combined = [headline, notes]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(" ")
    .replace(/’/g, "'");
  return combined.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g)?.length ?? 0;
}

function addSearchTerms(terms: Set<string>, value?: string | null): void {
  const normalized = normalizeTerm(value);
  if (!normalized) {
    return;
  }
  terms.add(normalized);
  for (const part of normalized.split("/")) {
    const trimmed = part.trim();
    if (trimmed) {
      terms.add(trimmed);
    }
  }
}

function normalizedListContains(values: string[] | undefined, normalized: string | null): boolean {
  if (!normalized) {
    return false;
  }
  return (values ?? []).some((value) => normalizeTerm(value) === normalized);
}

function matchLocalExpertType(candidate: LocalExpertReviewCandidate):
LocalExpertTypeConfig | null {
  const normalizedCategory = normalizeTerm(candidate.categoryName);
  const normalizedSubcategory = normalizeTerm(candidate.subcategory);

  for (const type of localExpertTypes) {
    if (normalizedListContains(type.mappedSubcategories, normalizedSubcategory)) {
      return type;
    }
  }

  const searchTerms = new Set<string>();
  addSearchTerms(searchTerms, candidate.dishName);
  addSearchTerms(searchTerms, candidate.subcategory);
  for (const tag of candidate.categoryTags) {
    addSearchTerms(searchTerms, tag);
  }

  for (const type of localExpertTypes) {
    for (const alias of type.aliases ?? []) {
      const normalizedAlias = normalizeTerm(alias);
      if (!normalizedAlias) {
        continue;
      }
      if (
        searchTerms.has(normalizedAlias) ||
        Array.from(searchTerms).some((term) => term.includes(normalizedAlias))
      ) {
        return type;
      }
    }
  }

  for (const type of localExpertTypes) {
    if (
      type.categoryMayQualify &&
      normalizedListContains(type.mappedCategoryNames, normalizedCategory)
    ) {
      return type;
    }
  }

  return null;
}

function hasUsableCoordinates(candidate: LocalExpertReviewCandidate): boolean {
  const lat = candidate.latitude;
  const lng = candidate.longitude;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function distanceMiles(first: LocalExpertReviewCandidate, second: LocalExpertReviewCandidate):
number {
  if (!hasUsableCoordinates(first) || !hasUsableCoordinates(second)) {
    return Number.POSITIVE_INFINITY;
  }
  const earthRadiusMiles = 3958.7613;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = toRadians(first.latitude!);
  const lat2 = toRadians(second.latitude!);
  const deltaLat = toRadians(second.latitude! - first.latitude!);
  const deltaLng = toRadians(second.longitude! - first.longitude!);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bestPairwiseClusterCount(candidates: LocalExpertReviewCandidate[]): number {
  const byRestaurant = new Map<string, LocalExpertReviewCandidate>();
  for (const candidate of candidates) {
    if (hasUsableCoordinates(candidate)) {
      byRestaurant.set(candidate.restaurantId.trim(), candidate);
    }
  }
  const locations = Array.from(byRestaurant.values())
    .sort((a, b) => a.restaurantId.localeCompare(b.restaurantId));
  if (locations.length < 2) {
    return locations.length;
  }

  const adjacency = new Map<number, Set<number>>();
  for (let i = 0; i < locations.length; i += 1) {
    adjacency.set(i, new Set<number>());
  }
  for (let i = 0; i < locations.length; i += 1) {
    for (let j = i + 1; j < locations.length; j += 1) {
      if (distanceMiles(locations[i], locations[j]) <= localExpertClusterRadiusMiles) {
        adjacency.get(i)!.add(j);
        adjacency.get(j)!.add(i);
      }
    }
  }

  let best = 0;
  function expand(clique: number[], candidatesToSearch: number[]): void {
    if (clique.length + candidatesToSearch.length <= best) {
      return;
    }
    if (candidatesToSearch.length === 0) {
      best = Math.max(best, clique.length);
      return;
    }
    const remaining = [...candidatesToSearch];
    while (remaining.length > 0) {
      if (clique.length + remaining.length <= best) {
        return;
      }
      const next = remaining.shift()!;
      expand(
        [...clique, next],
        remaining.filter((candidate) => adjacency.get(next)!.has(candidate)),
      );
      best = Math.max(best, clique.length + 1);
    }
  }

  expand([], locations.map((_, index) => index));
  return best;
}

function representativeTimeMillis(candidate: LocalExpertReviewCandidate): number {
  return (
    candidate.updatedAt?.toMillis() ??
    candidate.createdAt?.toMillis() ??
    0
  );
}

function dedupeKey(userId: string, restaurantId: string, expertTypeId: string): string {
  return `${userId.trim().toLowerCase()}|${restaurantId.trim().toLowerCase()}|${expertTypeId}`;
}

function isPublicReview(
  review: LocalExpertReviewData,
  dish: LocalExpertDishData,
  restaurant: LocalExpertRestaurantData,
): boolean {
  const status = normalizeTerm(review.status);
  if (
    review.isPublic === false ||
    review.isDeleted === true ||
    review.hidden === true ||
    review.isHidden === true ||
    status === "deleted" ||
    status === "hidden" ||
    status === "rejected"
  ) {
    return false;
  }
  const mergedIntoDishId = readString(dish.mergedIntoDishId);
  return (
    dish.isActive !== false &&
    !mergedIntoDishId &&
    restaurant.isActive !== false &&
    restaurant.active !== false
  );
}

async function buildLocalExpertCandidatesForUser(userId: string):
Promise<LocalExpertReviewCandidate[]> {
  const reviewSnapshot = await db
    .collection("dish_reviews")
    .where("userId", "==", userId)
    .get();
  const candidates: LocalExpertReviewCandidate[] = [];

  for (const reviewDoc of reviewSnapshot.docs) {
    try {
      const review = reviewDoc.data() as LocalExpertReviewData;
      const dishId = readString(review.dishId);
      const restaurantId = readString(review.restaurantId);
      if (!dishId || !restaurantId || writtenReviewWordCount(review.headline, review.notes) < 10) {
        continue;
      }

      const [dishDoc, restaurantDoc] = await Promise.all([
        db.collection("bitescore_dishes").doc(dishId).get(),
        db.collection("bitescore_restaurants").doc(restaurantId).get(),
      ]);
      if (!dishDoc.exists || !restaurantDoc.exists) {
        continue;
      }

      const dish = dishDoc.data() as LocalExpertDishData;
      const restaurant = restaurantDoc.data() as LocalExpertRestaurantData;
      if (!isPublicReview(review, dish, restaurant)) {
        continue;
      }

      const location = restaurant.location;
      candidates.push({
        reviewId: readString(review.id) ?? reviewDoc.id,
        restaurantId,
        dishName: readString(dish.name),
        categoryName: readString(dish.category),
        subcategory: readString(dish.subcategory),
        categoryTags: readStringList(dish.categoryTags),
        headline: review.headline,
        notes: review.notes,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        latitude: location?.latitude ?? readNumber(restaurant.latitude),
        longitude: location?.longitude ?? readNumber(restaurant.longitude),
      });
    } catch (error) {
      logger.warn("Skipping malformed Local Expert review candidate", {
        reviewId: reviewDoc.id,
        userId,
        error,
      });
    }
  }

  return candidates;
}

function calculateLocalExpertBadges(candidates: LocalExpertReviewCandidate[]):
LocalExpertBadgeResult[] {
  const representativesByKey = new Map<string, LocalExpertResolvedReview>();

  for (const candidate of candidates) {
    const type = matchLocalExpertType(candidate);
    if (!type) {
      continue;
    }

    const key = dedupeKey("unused", candidate.restaurantId, type.id);
    const existing = representativesByKey.get(key);
    if (
      !existing ||
      representativeTimeMillis(candidate) > representativeTimeMillis(existing.candidate) ||
      (
        representativeTimeMillis(candidate) === representativeTimeMillis(existing.candidate) &&
        candidate.reviewId.localeCompare(existing.candidate.reviewId) > 0
      )
    ) {
      representativesByKey.set(key, { candidate, expertType: type });
    }
  }

  return localExpertTypes.map((type) => {
    const representatives = Array.from(representativesByKey.values())
      .filter((entry) => entry.expertType.id === type.id)
      .sort((a, b) => {
        const restaurantComparison = a.candidate.restaurantId
          .localeCompare(b.candidate.restaurantId);
        return restaurantComparison !== 0
          ? restaurantComparison
          : a.candidate.reviewId.localeCompare(b.candidate.reviewId);
      });
    const restaurantIds = Array.from(
      new Set(representatives.map((entry) => entry.candidate.restaurantId.trim())),
    ).sort();
    const reviewIds = representatives.map((entry) => entry.candidate.reviewId).sort();
    const total = restaurantIds.length;
    const local = bestPairwiseClusterCount(
      representatives.map((entry) => entry.candidate),
    );

    let level: LocalExpertBadgeResult["level"] = null;
    if (total >= 25) {
      level = "level3";
    } else if (total >= 10 || local >= 5) {
      level = "level2";
    } else if (total >= 5 || local >= 3) {
      level = "level1";
    }

    const overallQualified =
      (level === "level3" && total >= 25) ||
      (level === "level2" && total >= 10) ||
      (level === "level1" && total >= 5);
    const localQualified =
      (level === "level2" && local >= 5) ||
      (level === "level1" && local >= 3);
    const qualificationMethod = !level
      ? "none"
      : overallQualified && localQualified
        ? "both"
        : localQualified
          ? "localCluster"
          : "overall";

    return {
      expertTypeId: type.id,
      displayName: type.displayName,
      level,
      totalRestaurantCount: total,
      localClusterRestaurantCount: local,
      qualificationMethod,
      qualifyingReviewIds: reviewIds,
      qualifyingRestaurantIds: restaurantIds,
    };
  });
}

async function persistLocalExpertBadges(userId: string, results: LocalExpertBadgeResult[]):
Promise<{ earnedBadgeCount: number; removedBadgeCount: number }> {
  const badgeCollection = db
    .collection("user_profiles")
    .doc(userId)
    .collection("local_expert_badges");
  const existingSnapshot = await badgeCollection.get();
  const existingIds = new Set(existingSnapshot.docs.map((doc) => doc.id));
  const batch = db.batch();
  let earnedBadgeCount = 0;
  let removedBadgeCount = 0;

  for (const result of results) {
    const badgeRef = badgeCollection.doc(result.expertTypeId);
    if (!result.level) {
      continue;
    }
    const existingDoc = existingSnapshot.docs.find((doc) => doc.id === result.expertTypeId);
    const existingEarnedAt = existingDoc?.get("earnedAt");
    earnedBadgeCount += 1;
    existingIds.delete(result.expertTypeId);
    batch.set(
      badgeRef,
      {
        expertTypeId: result.expertTypeId,
        displayName: result.displayName,
        level: result.level,
        totalRestaurantCount: result.totalRestaurantCount,
        localClusterRestaurantCount: result.localClusterRestaurantCount,
        qualificationMethod: result.qualificationMethod,
        qualifyingReviewIds: result.qualifyingReviewIds.slice(0, 50),
        qualifyingRestaurantIds: result.qualifyingRestaurantIds.slice(0, 50),
        qualifyingReviewIdsTruncated: result.qualifyingReviewIds.length > 50,
        qualifyingRestaurantIdsTruncated: result.qualifyingRestaurantIds.length > 50,
        earnedAt: existingEarnedAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        source: "localExpertFunctionsV1",
      },
      { merge: true },
    );
  }

  for (const staleId of existingIds) {
    removedBadgeCount += 1;
    batch.delete(badgeCollection.doc(staleId));
  }

  await batch.commit();
  return { earnedBadgeCount, removedBadgeCount };
}

async function recalculateLocalExpertBadgesForUser(userId: string):
Promise<{ earnedBadgeCount: number; removedBadgeCount: number }> {
  const candidates = await buildLocalExpertCandidatesForUser(userId);
  const results = calculateLocalExpertBadges(candidates);
  return persistLocalExpertBadges(userId, results);
}

function mapStripeStatusToAppStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "inactive";
    default:
      return "inactive";
  }
}

async function resolveRestaurantAccountUid(params: {
  ownerUid?: string | null;
  restaurantAccountId?: string | null;
  stripeCustomerId?: string | null;
}): Promise<string | null> {
  const ownerUid = params.ownerUid?.trim();
  if (ownerUid) {
    return ownerUid;
  }

  const restaurantAccountId = params.restaurantAccountId?.trim();
  if (restaurantAccountId) {
    return restaurantAccountId;
  }

  const stripeCustomerId = params.stripeCustomerId?.trim();
  if (!stripeCustomerId) {
    return null;
  }

  const snapshot = await db
    .collection("restaurant_accounts")
    .where("stripeCustomerId", "==", stripeCustomerId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return snapshot.docs[0].id;
}

async function syncRestaurantSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  fallbackMetadata?: Record<string, string>,
): Promise<void> {
  const metadata = {
    ...(fallbackMetadata ?? {}),
    ...(subscription.metadata ?? {}),
  };

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const restaurantUid = await resolveRestaurantAccountUid({
    ownerUid: metadata.ownerUid,
    restaurantAccountId: metadata.restaurantAccountId,
    stripeCustomerId,
  });

  if (!restaurantUid) {
    logger.warn("Could not resolve restaurant account for Stripe subscription", {
      subscriptionId: subscription.id,
      stripeCustomerId,
      metadata,
    });
    return;
  }

  const subscriptionStatus = mapStripeStatusToAppStatus(subscription.status);
  const couponPostingEnabled =
    subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const trialEndsAt = subscriptionStatus === "trialing"
    ? unixSecondsToTimestamp(subscription.trial_end)
    : null;
  const updateData: Record<string, unknown> = {
    subscriptionStatus,
    trialEndsAt,
    subscriptionEndsAt:
      unixSecondsToTimestamp((subscription as any).current_period_end) ??
      unixSecondsToTimestamp(subscription.ended_at) ??
      unixSecondsToTimestamp(subscription.canceled_at),
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    billingPlanName: metadata.billingPlanName?.trim() || "coupon_monthly",
    couponPostingEnabled,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (couponPostingEnabled || subscription.status === "trialing") {
    updateData.hasUsedTrial = true;
  }

  await db.collection("restaurant_accounts").doc(restaurantUid).set(
    updateData,
    { merge: true },
  );
}





export const createSubscriptionCheckoutSession = onCall(
  {
    secrets: [stripeSecretKey],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const successUrl =
      stripeCheckoutSuccessUrl || hostedStripeCheckoutSuccessUrl;
    const cancelUrl =
      stripeCheckoutCancelUrl || hostedStripeCheckoutCancelUrl;
    if (!successUrl || !cancelUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe Checkout is not configured.",
      );
    }

    const stripe = new Stripe(stripeSecretKey.value(), {
      apiVersion: "2025-08-27.basil",
    });

    const ownerUid = request.auth.uid;

    try {
      const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData =
        {
          metadata: {
            ownerUid,
            restaurantAccountId: ownerUid,
            source: "bitesaver_subscription",
          },
        };
      

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: stripePriceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: ownerUid,
        metadata: {
          ownerUid,
          restaurantAccountId: ownerUid,
          source: "bitesaver_subscription",
        },
        subscription_data: subscriptionData,
      });

      if (!session.url) {
        throw new HttpsError(
          "internal",
          "Stripe Checkout did not return a URL.",
        );
      }
      

      return {
        checkoutUrl: session.url,
      };
    } catch (error) {
      logger.error("Failed to create Stripe Checkout session", {
        ownerUid,
        error,
      });
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "Could not start Stripe Checkout.",
      );
    }
  },
);

export const createCheckoutSession = onCall(
  {
    secrets: [stripeSecret],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const successUrl =
      stripeCheckoutSuccessUrl || hostedStripeCheckoutSuccessUrl;
    const cancelUrl =
      stripeCheckoutCancelUrl || hostedStripeCheckoutCancelUrl;
    if (!successUrl || !cancelUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe Checkout is not configured.",
      );
    }

    try {
      const stripe = new Stripe(stripeSecret.value(), {
        apiVersion: "2025-08-27.basil",
      });

      const ownerUid = request.auth.uid;
     const accountRef = db.collection("restaurant_accounts").doc(ownerUid);
const accountSnap = await accountRef.get();
const hasUsedTrial = accountSnap.data()?.hasUsedTrial === true;

const includeTrial = !hasUsedTrial;
      const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData =
        {
          metadata: {
            ownerUid,
            restaurantAccountId: ownerUid,
            billingPlanName: "coupon_monthly",
            source: "bitesaver_subscription",
          },
        };
      if (includeTrial) {
        subscriptionData.trial_period_days = stripeTrialDays;
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: stripePriceId,
            quantity: 1,
          },
        ],
        subscription_data: subscriptionData,
        metadata: {
          ownerUid,
          restaurantAccountId: ownerUid,
          billingPlanName: "coupon_monthly",
          source: "bitesaver_subscription",
        },
        client_reference_id: ownerUid,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return {
        url: session.url,
      };
    } catch (error) {
      logger.error("Failed to create checkout session", { error });
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "Failed to create checkout session",
      );
    }
  },
);

export const createCustomerPortalSession = onCall(
  {
    secrets: [stripeSecret],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const returnUrl = stripeCustomerPortalReturnUrl.value();
    if (!returnUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe Customer Portal is not configured.",
      );
    }

    const ownerUid = request.auth.uid;
    const accountSnapshot = await db
      .collection("restaurant_accounts")
      .doc(ownerUid)
      .get();
    const accountData = accountSnapshot.data();
    const stripeCustomerId =
      typeof accountData?.stripeCustomerId === "string"
        ? accountData.stripeCustomerId.trim()
        : "";

    if (!stripeCustomerId) {
      throw new HttpsError(
        "failed-precondition",
        "No Stripe customer is linked to this restaurant account.",
      );
    }

    try {
      const stripe = new Stripe(stripeSecret.value(), {
        apiVersion: "2025-08-27.basil",
      });
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl,
      });

      if (!session.url) {
        throw new HttpsError(
          "internal",
          "Stripe Customer Portal did not return a URL.",
        );
      }

      return {
        url: session.url,
      };
    } catch (error) {
      logger.error("Failed to create Stripe Customer Portal session", {
        ownerUid,
        error,
      });
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "Failed to create customer portal session.",
      );
    }
  },
);

function renderSubscriptionReturnPage(params: {
  title: string;
  message: string;
  returnUri: string;
  buttonLabel: string;
}): string {
  const escapedTitle = params.title
    .split("&").join("&amp;")
.split("<").join("&lt;")
.split(">").join("&gt;");
  const escapedMessage = params.message
    .split("&").join("&amp;")
.split("<").join("&lt;")
.split(">").join("&gt;");
  const escapedButton = params.buttonLabel
    .split("&").join("&amp;")
.split("<").join("&lt;")
.split(">").join("&gt;");
  const escapedReturnUri = params.returnUri.split("&").join("&amp;");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 420px;
        background: #ffffff;
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
        text-align: center;
      }
      .button {
        display: inline-block;
        margin-top: 20px;
        padding: 14px 20px;
        border-radius: 14px;
        background: #111827;
        color: #ffffff;
        text-decoration: none;
        font-weight: 700;
      }
      .hint {
        margin-top: 12px;
        color: #64748b;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapedTitle}</h1>
      <p>${escapedMessage}</p>
      <a class="button" href="${escapedReturnUri}">${escapedButton}</a>
      <p class="hint">If the app does not open automatically, tap the button above.</p>
    </div>
    <script>
      window.location.replace("${params.returnUri}");
    </script>
  </body>
</html>`;
}

export const subscriptionCheckoutSuccess = onRequest((request, response) => {
  response.status(200).send(
    renderSubscriptionReturnPage({
      title: "Subscription started successfully",
      message: "Your subscription has started. You can return to the app now.",
      returnUri: subscriptionReturnSuccessUri,
      buttonLabel: "Return to app",
    }),
  );
});

export const subscriptionCheckoutCancel = onRequest((request, response) => {
  response.status(200).send(
    renderSubscriptionReturnPage({
      title: "Subscription checkout canceled",
      message: "No changes were made. You can return to the app now.",
      returnUri: subscriptionReturnCancelUri,
      buttonLabel: "Return to app",
    }),
  );
});

export const stripeWebhook = onRequest(
  {
    secrets: [stripeSecret, stripeWebhookSecret],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    const signature = request.header("stripe-signature");
    if (!signature) {
      logger.warn("Missing Stripe signature header.");
      response.status(400).send("Missing Stripe signature.");
      return;
    }

    const stripe = new Stripe(stripeSecret.value(), {
      apiVersion: "2025-08-27.basil",
    });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        stripeWebhookSecret.value(),
      );
    } catch (error) {
      logger.error("Invalid Stripe webhook signature", { error });
      response.status(400).send("Invalid Stripe signature.");
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (
            session.mode === "subscription" &&
            typeof session.subscription === "string"
          ) {
            const subscription = await stripe.subscriptions.retrieve(
              session.subscription,
            );
            await syncRestaurantSubscriptionFromStripe(
              subscription,
              session.metadata ?? undefined,
            );
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          await syncRestaurantSubscriptionFromStripe(subscription);
          break;
        }
        default:
          logger.info("Ignoring Stripe webhook event", {
            type: event.type,
          });
      }

      response.status(200).json({ received: true });
    } catch (error) {
      logger.error("Failed to process Stripe webhook", {
        type: event.type,
        error,
      });
      response.status(500).send("Webhook processing failed.");
    }
  },
);

export const processProximityPushRequest = onDocumentCreated(
  "proximity_push_requests/{requestId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn("Missing event snapshot.");
      return;
    }

    const requestRef = snapshot.ref;
    const requestId = event.params.requestId as string;
    const raw = snapshot.data() as PushRequestData | undefined;

    if (!raw) {
      await requestRef.set(
        {
          status: "failed",
          failureReason: "missing_request_data",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    logger.info("Processing proximity push request", {
      requestId,
      installationId: raw.installationId,
      couponId: raw.couponId,
      restaurant: raw.restaurant,
    });

    const claimResult = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(requestRef);
      const freshData = fresh.data() as PushRequestData | undefined;

      if (!fresh.exists || !freshData) {
        return { proceed: false, reason: "missing_request_doc" };
      }

      const status = freshData.status ?? "pending";
      if (status !== "pending") {
        return { proceed: false, reason: `status_${status}` };
      }

      tx.set(
        requestRef,
        {
          status: "processing",
          processingStartedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { proceed: true, reason: "claimed" };
    });

    if (!claimResult.proceed) {
      logger.info("Skipping request before send", {
        requestId,
        reason: claimResult.reason,
      });
      return;
    }

    try {
      const installationId = raw.installationId?.trim();
      if (!installationId) {
        await requestRef.set(
          {
            status: "skipped_missing_installation",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      const installationRef = db
        .collection("customer_device_installations")
        .doc(installationId);

      const installationSnap = await installationRef.get();
      const installation =
        installationSnap.data() as InstallationData | undefined;

      if (!installationSnap.exists || !installation) {
        await requestRef.set(
          {
            status: "skipped_missing_installation_doc",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      const proximityPushEnabled = installation.proximityPushEnabled ?? true;
      const maxPerDay = installation.maxProximityPushesPerDay ?? 2;
      const permissionStatus = installation.notificationsPermissionStatus;
      const token = installation.fcmToken?.trim();

      if (!proximityPushEnabled || maxPerDay <= 0) {
        await requestRef.set(
          {
            status: "skipped_disabled",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      if (!isPermissionUsable(permissionStatus)) {
        await requestRef.set(
          {
            status: "skipped_permission",
            permissionStatus: permissionStatus ?? null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      if (!token) {
        await requestRef.set(
          {
            status: "skipped_missing_token",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      const title = buildNotificationTitle(raw);
      const body = buildNotificationBody(raw);

      const response = await getMessaging().send({
        token,
        notification: {
          title,
          body,
        },
        data: {
          type: "proximity_coupon",
          requestId,
          installationId,
          couponId: raw.couponId ?? "",
          couponTitle: raw.couponTitle ?? "",
          restaurant: raw.restaurant ?? "",
          source: raw.source ?? "client_proximity_trigger",
        },
        android: {
          priority: "high",
          notification: {
            channelId: "default",
          },
        },
      });

      await requestRef.set(
        {
          status: "sent",
          fcmMessageId: response,
          sentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      logger.info("Proximity push sent", {
        requestId,
        installationId,
        response,
      });
    } catch (error) {
      logger.error("Failed to process proximity push request", {
        requestId,
        error,
      });

      await requestRef.set(
        {
          status: "failed",
          failureReason:
            error instanceof Error ? error.message : "unknown_error",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  },
);

export const cleanupDeletedRestaurantCoupons = onDocumentDeleted(
  "restaurant_accounts/{uid}",
  async (event) => {
    const uid = event.params.uid as string;
    const accountRef =
      event.data?.ref ?? db.collection("restaurant_accounts").doc(uid);
    await db.recursiveDelete(accountRef.collection("coupons"));
  },
);

export const recalculateMyLocalExpertBadges = onCall(async (request) => {
  const uid = request.auth?.uid?.trim();
  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Sign in to recalculate Local Expert badges.",
    );
  }

  const result = await recalculateLocalExpertBadgesForUser(uid);
  return {
    ok: true,
    earnedBadgeCount: result.earnedBadgeCount,
    removedBadgeCount: result.removedBadgeCount,
  };
});

export const recalculateLocalExpertBadgesOnReviewWrite = onDocumentWritten(
  "dish_reviews/{reviewId}",
  async (event) => {
    const userIds = new Set<string>();
    const beforeUserId = readString(event.data?.before.data()?.userId);
    const afterUserId = readString(event.data?.after.data()?.userId);
    if (beforeUserId) {
      userIds.add(beforeUserId);
    }
    if (afterUserId) {
      userIds.add(afterUserId);
    }

    for (const userId of userIds) {
      try {
        await recalculateLocalExpertBadgesForUser(userId);
      } catch (error) {
        logger.error("Failed to recalculate Local Expert badges after review write", {
          reviewId: event.params.reviewId,
          userId,
          error,
        });
      }
    }
  },
);
