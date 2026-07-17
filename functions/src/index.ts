import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Firestore,
  DocumentData,
  QueryDocumentSnapshot,
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
import {
  CallableRequest,
  HttpsError,
  onCall,
  onRequest,
} from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import Stripe from "stripe";
import {
  awardApprovedDishProposalContributionPointsCallableHandler,
  awardDishImageContributionPointsCallableHandler,
  awardContributionPointsCallableHandler,
  awardCreatedDishContributionPointsCallableHandler,
  awardReviewMilestoneContributionPointsCallableHandler,
  markContributionPointLedgerEntriesCelebratedCallableHandler,
  reconcileReviewMilestoneContributionPointsAfterModerationCallableHandler,
  reverseContributionPointsForDishCallableHandler,
  reverseContributionPointLedgerEntryCallableHandler,
} from "./contribution_points_helpers.js";
import {
  couponInviteRestaurantIdentity,
  filterAndSortInviteSummaries,
  generateInviteToken,
  hashInviteToken,
  invitePreviewUnavailableReason,
  inviteLink,
  normalizeInviteSide,
} from "./restaurant_invite_helpers.js";

initializeApp();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

const db: Firestore = getFirestore();
const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripeCheckoutSuccessUrl =
  "https://coupon-app-29446.web.app/stripe-success.html";
const stripeCheckoutCancelUrl =
  "https://coupon-app-29446.web.app/stripe-cancel.html";
const stripeCustomerPortalReturnUrl = defineString(
  "STRIPE_CUSTOMER_PORTAL_RETURN_URL",
);
const hostedStripeCheckoutSuccessUrl =
  "https://coupon-app-29446.web.app/stripe-success.html";
const hostedStripeCheckoutCancelUrl =
  "https://coupon-app-29446.web.app/stripe-cancel.html";
const stripePriceId = "price_1TJKGjBwoT6e93tVkesJPfxD";
const stripeTrialDays = 60;
const subscriptionReturnSuccessUri = "bitesaver://subscription-success";
const subscriptionReturnCancelUri = "bitesaver://subscription-cancel";
const restaurantInviteCollection = "restaurant_invites";
const restaurantInviteExpirationDays = 90;
const adminInviteEmails = new Set(["schuyler.cole@gmail.com"]);

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
  exactAliases?: string[];
  aliases?: string[];
  excludedCategoryNames?: string[];
  excludedSubcategories?: string[];
  excludedAliases?: string[];
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
  county?: string;
  countyName?: string;
  normalizedCounty?: string;
  state?: string;
  stateCode?: string;
  region?: string;
  province?: string;
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
  county?: string;
  state?: string;
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

type LocalExpertBadgeCelebrationEvent = {
  eventKey: string;
  expertTypeId: string;
  displayName: string;
  level: "level1" | "level2" | "level3";
  kind: "earned" | "levelUp";
  status: "pending";
};

type LocalExpertBadgePersistenceResult = {
  earnedBadgeCount: number;
  removedBadgeCount: number;
  celebrations: LocalExpertBadgeCelebrationEvent[];
};

const localExpertClusterRadiusMiles = 30;
const localExpertCelebrationSubcollection = "local_expert_badge_celebrations";
const cubanSandwichCanonicalId = "cuban_sandwich";
const chickenPieCanonicalId = "chicken_pie";
const legacyLocalExpertTypeIds = new Set([
  "burrito",
  "tacos",
  "lobster",
  "pasta",
]);
const localExpertStateNameToCode = new Map<string, string>([
  ["ALABAMA", "AL"],
  ["ALASKA", "AK"],
  ["ARIZONA", "AZ"],
  ["ARKANSAS", "AR"],
  ["CALIFORNIA", "CA"],
  ["COLORADO", "CO"],
  ["CONNECTICUT", "CT"],
  ["DELAWARE", "DE"],
  ["FLORIDA", "FL"],
  ["GEORGIA", "GA"],
  ["HAWAII", "HI"],
  ["IDAHO", "ID"],
  ["ILLINOIS", "IL"],
  ["INDIANA", "IN"],
  ["IOWA", "IA"],
  ["KANSAS", "KS"],
  ["KENTUCKY", "KY"],
  ["LOUISIANA", "LA"],
  ["MAINE", "ME"],
  ["MARYLAND", "MD"],
  ["MASSACHUSETTS", "MA"],
  ["MICHIGAN", "MI"],
  ["MINNESOTA", "MN"],
  ["MISSISSIPPI", "MS"],
  ["MISSOURI", "MO"],
  ["MONTANA", "MT"],
  ["NEBRASKA", "NE"],
  ["NEVADA", "NV"],
  ["NEW HAMPSHIRE", "NH"],
  ["NEW JERSEY", "NJ"],
  ["NEW MEXICO", "NM"],
  ["NEW YORK", "NY"],
  ["NORTH CAROLINA", "NC"],
  ["NORTH DAKOTA", "ND"],
  ["OHIO", "OH"],
  ["OKLAHOMA", "OK"],
  ["OREGON", "OR"],
  ["PENNSYLVANIA", "PA"],
  ["RHODE ISLAND", "RI"],
  ["SOUTH CAROLINA", "SC"],
  ["SOUTH DAKOTA", "SD"],
  ["TENNESSEE", "TN"],
  ["TEXAS", "TX"],
  ["UTAH", "UT"],
  ["VERMONT", "VT"],
  ["VIRGINIA", "VA"],
  ["WASHINGTON", "WA"],
  ["WEST VIRGINIA", "WV"],
  ["WISCONSIN", "WI"],
  ["WYOMING", "WY"],
  ["DISTRICT OF COLUMBIA", "DC"],
]);
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
    aliases: ["pizza", "pepperoni pizza", "cheese pizza", "vegan pizza"],
    categoryMayQualify: true,
  },
  {
    id: "wings",
    displayName: "Wings",
    mappedSubcategories: ["Boneless wings", "Wings"],
    aliases: ["wings", "wing", "chicken wings", "boneless wings"],
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
  {
    id: "mexican",
    displayName: "Mexican",
    mappedCategoryNames: ["Mexican", "Tacos"],
    mappedSubcategories: [
      "Burrito",
      "Breakfast burrito",
      "Breakfast tacos",
      "Carne asada",
      "Chilaquiles",
      "Chile relleno",
      "Chimichanga",
      "Elote / street corn",
      "Enchiladas",
      "Fajitas",
      "Guacamole",
      "Nachos",
      "Quesadilla",
      "Rice bowl",
      "Tacos",
      "Tamales",
      "Tostada",
      "Vegan tacos",
    ],
    aliases: [
      "mexican",
      "taco",
      "tacos",
      "burrito",
      "burritos",
      "enchiladas",
      "quesadilla",
      "quesadillas",
      "tamale",
      "tamales",
      "fajita",
      "fajitas",
      "nachos",
      "chilaquiles",
      "chile relleno",
      "carne asada",
    ],
    categoryMayQualify: true,
  },
  {
    id: "seafood",
    displayName: "Seafood",
    mappedCategoryNames: ["Seafood"],
    mappedSubcategories: [
      "Clam chowder",
      "Crab",
      "Fish",
      "Grouper",
      "Lobster",
      "Oysters",
      "Salmon",
      "Scallops",
      "Seafood platter",
      "Shrimp",
    ],
    aliases: [
      "seafood",
      "lobster",
      "lobster roll",
      "shrimp",
      "crab",
      "oysters",
      "oyster",
      "scallops",
      "scallop",
      "clams",
      "clam",
      "mussels",
      "mussel",
      "fish",
      "grouper",
      "salmon",
    ],
    excludedCategoryNames: ["Japanese / Sushi"],
    excludedSubcategories: ["Sushi", "Sushi roll", "Sashimi", "Nigiri"],
    excludedAliases: ["sushi", "sushi roll", "sashimi", "nigiri"],
    categoryMayQualify: true,
  },
  {
    id: "italian",
    displayName: "Italian",
    mappedCategoryNames: ["Italian"],
    mappedSubcategories: [
      "Breadsticks",
      "Bruschetta",
      "Calzone",
      "Chicken parmesan",
      "Eggplant parmesan",
      "Garlic knots",
      "Gnocchi",
      "Italian sub",
      "Meatballs",
      "Pasta",
      "Risotto",
      "Stromboli",
    ],
    aliases: [
      "italian",
      "spaghetti",
      "lasagna",
      "ravioli",
      "pasta",
      "fettuccine",
      "linguine",
      "rigatoni",
      "gnocchi",
      "chicken parmesan",
      "chicken parm",
      "chicken parmigiana",
      "eggplant parmesan",
      "meatballs",
    ],
    excludedSubcategories: ["Pizza", "Vegan pizza"],
    excludedAliases: ["pizza", "pepperoni pizza", "cheese pizza"],
    categoryMayQualify: true,
  },
  {
    id: "bbq",
    displayName: "BBQ",
    mappedCategoryNames: ["BBQ"],
    mappedSubcategories: [
      "BBQ chicken",
      "BBQ sandwich",
      "Brisket",
      "Burnt ends",
      "Pulled pork",
      "Ribs",
    ],
    aliases: [
      "bbq",
      "barbecue",
      "barbeque",
      "bar-b-q",
      "bar-b-que",
      "bbq sandwich",
      "ribs",
      "bbq ribs",
      "pulled pork",
      "brisket",
      "bbq brisket",
      "bbq chicken",
      "burnt ends",
    ],
    categoryMayQualify: true,
  },
  {
    id: "hot_dogs_corn_dogs",
    displayName: "Hot Dogs / Corn Dogs",
    mappedSubcategories: ["Hot dogs"],
    aliases: [
      "hot dog",
      "hot dogs",
      "hotdog",
      "hotdogs",
      "corn dog",
      "corn dogs",
      "corndog",
      "corndogs",
      "coney",
      "coney dog",
      "chili dog",
      "chili dogs",
    ],
  },
  {
    id: "chili",
    displayName: "Chili",
    mappedCategoryNames: ["American", "Soup"],
    mappedSubcategories: ["Chili"],
    exactAliases: ["chili", "chilli"],
    aliases: [
      "chili con carne",
      "chilli con carne",
      "texas chili",
      "beef chili",
      "bowl of chili",
      "chili bowl",
      "white chicken chili",
      "vegetarian chili",
      "chili dog",
      "chili dogs",
      "chili cheese dog",
      "chili cheese dogs",
    ],
    excludedAliases: [
      "chili sauce",
      "sweet chili sauce",
      "chili oil",
      "chili pepper",
      "chili peppers",
      "green chili",
      "green chili pepper",
    ],
  },
  {
    id: "mac_and_cheese",
    displayName: "Mac and Cheese",
    mappedSubcategories: ["Mac and cheese"],
    aliases: [
      "mac and cheese",
      "mac & cheese",
      "macaroni and cheese",
      "macaroni & cheese",
      "mac n cheese",
      "mac 'n' cheese",
    ],
  },
  {
    id: "meatloaf",
    displayName: "Meatloaf",
    mappedSubcategories: ["Meatloaf"],
    aliases: ["meatloaf", "meat loaf", "meatloaves"],
  },
  {
    id: "chicken_pie",
    displayName: "Chicken Pie / Chicken Pot Pie",
    mappedSubcategories: ["Chicken Pie / Chicken Pot Pie"],
    aliases: [
      chickenPieCanonicalId,
      "chicken pie",
      "chicken pies",
      "chicken pot pie",
      "chicken pot pies",
    ],
  },
  {
    id: "chicken_sandwich",
    displayName: "Chicken Sandwich",
    mappedSubcategories: ["Chicken sandwich"],
    aliases: [
      "chicken sandwich",
      "fried chicken sandwich",
      "grilled chicken sandwich",
      "spicy chicken sandwich",
    ],
    excludedSubcategories: ["Cuban sandwich"],
    excludedAliases: [cubanSandwichCanonicalId, "cuban sandwich", "cubano"],
  },
  {
    id: "fried_chicken",
    displayName: "Fried Chicken",
    mappedSubcategories: ["Chicken tenders", "Fried chicken"],
    aliases: [
      "fried chicken",
      "fried chicken pieces",
      "fried chicken dinner",
      "chicken tenders",
      "chicken tender",
      "chicken fingers",
      "chicken finger",
      "chicken strips",
      "chicken strip",
      "fried chicken sandwich",
    ],
    excludedSubcategories: ["Boneless wings", "Wings"],
    excludedAliases: ["wings", "wing", "chicken wings", "boneless wings"],
  },
  {
    id: "cuban",
    displayName: "Cuban",
    mappedCategoryNames: ["Cuban"],
    mappedSubcategories: [
      "Arroz con pollo",
      "Bistec empanizado",
      "Black beans and rice",
      "Croquetas",
      "Cuban coffee",
      "Cuban sandwich",
      "Cuban-style chicken",
      "Cuban tamal",
      "Empanadas",
      "Flan",
      "Lechón / roast pork",
      "Maduros / sweet plantains",
      "Masitas de puerco",
      "Medianoche",
      "Moros y cristianos",
      "Palomilla steak",
      "Picadillo",
      "Potato balls / papas rellenas",
      "Ropa vieja",
      "Tostones",
      "Vaca frita",
      "Yuca with mojo",
    ],
    aliases: [
      cubanSandwichCanonicalId,
      "cuban",
      "cubano",
      "cuban sandwich",
      "medianoche",
      "ropa vieja",
      "ropa viejo",
      "picadillo",
      "lechon",
      "lechón",
      "roast pork",
      "masitas de puerco",
      "vaca frita",
      "arroz con pollo",
      "palomilla steak",
      "bistec empanizado",
      "croquetas",
      "papas rellenas",
      "papa rellena",
      "potato ball",
      "potato balls",
      "black beans and rice",
      "moros y cristianos",
      "yuca with mojo",
      "tostones",
      "maduros",
      "sweet plantains",
      "cuban tamal",
      "cuban tamale",
      "cuban-style chicken",
      "cuban coffee",
    ],
    categoryMayQualify: true,
  },
  {
    id: "subs_sandwiches",
    displayName: "Subs / Sandwiches",
    mappedCategoryNames: [
      "Subs",
      "Deli / Sandwiches",
      "subs",
      "deli_sandwiches",
    ],
    mappedSubcategories: [
      "Sandwiches",
      "Subs",
      "BLT",
      "Chicken salad sandwich",
      "Club sandwich",
      "Cuban sandwich",
      "Ham sandwich",
      "Italian sub",
      "Pastrami sandwich",
      "Philly cheesesteak",
      "Reuben",
      "Roast beef sandwich",
      "Tuna sandwich",
      "Turkey sandwich",
      "Wrap",
    ],
    aliases: [
      cubanSandwichCanonicalId,
      "sub",
      "subs",
      "sub sandwich",
      "sub sandwiches",
      "submarine",
      "submarine sandwich",
      "submarine sandwiches",
      "hoagie",
      "hoagies",
      "grinder",
      "grinders",
      "hero",
      "heroes",
      "hero sandwich",
      "hero sandwiches",
      "deli sandwich",
      "deli sandwiches",
      "torpedo",
      "torpedo sandwich",
      "torpedo sandwiches",
      "cuban sandwich",
      "cubano",
    ],
    excludedCategoryNames: [
      "BBQ",
      "Burgers",
      "Chicken",
      "Mexican",
      "Tacos",
      "Breakfast / Brunch",
      "bbq",
      "burgers",
      "chicken_wings",
      "mexican",
      "tacos",
      "breakfast_brunch",
    ],
    excludedSubcategories: [
      "BBQ sandwich",
      "Burgers",
      "Chicken sandwich",
      "Fried chicken",
      "Grilled chicken",
      "Hot dogs",
      "Breakfast sandwich",
      "Breakfast burrito",
      "Breakfast tacos",
      "Burrito",
      "Tacos",
    ],
    excludedAliases: [
      "bbq sandwich",
      "barbecue sandwich",
      "barbeque sandwich",
      "pulled pork sandwich",
      "brisket sandwich",
      "chicken sandwich",
      "fried chicken sandwich",
      "grilled chicken sandwich",
      "spicy chicken sandwich",
      "breakfast sandwich",
      "burger",
      "burgers",
      "hamburger",
      "hamburgers",
      "cheeseburger",
      "cheeseburgers",
      "hot dog",
      "hot dogs",
      "hotdog",
      "hotdogs",
      "corn dog",
      "corn dogs",
      "corndog",
      "corndogs",
      "taco",
      "tacos",
      "burrito",
      "burritos",
    ],
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
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
}

type AdminInviteContext = {
  uid: string;
  email: string;
};

function requireAdminInviteAccess(
  request: CallableRequest<unknown>,
): AdminInviteContext {
  const uid = request.auth?.uid?.trim();
  const email = readString(request.auth?.token.email)?.toLowerCase();

  if (!uid || !email || !adminInviteEmails.has(email)) {
    throw new HttpsError(
      "permission-denied",
      "Admin access is required to create restaurant invites.",
    );
  }

  return { uid, email };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inviteExpirationTimestamp(): Timestamp {
  return Timestamp.fromMillis(
    Date.now() + restaurantInviteExpirationDays * 24 * 60 * 60 * 1000,
  );
}

function timestampMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function serializeInviteDoc(
  doc: QueryDocumentSnapshot<DocumentData>,
): Record<string, unknown> {
  const data = doc.data();
  return {
    id: doc.id,
    type: readString(data.type) ?? "",
    side: readString(data.side) ?? "",
    status: readString(data.status) ?? "",
    restaurantId: readString(data.restaurantId) ?? "",
    pendingRestaurantKey: readString(data.pendingRestaurantKey) ?? "",
    restaurantName: readString(data.restaurantName) ?? "",
    createdByUid: readString(data.createdByUid) ?? "",
    createdByEmail: readString(data.createdByEmail) ?? "",
    createdAtMillis: timestampMillis(data.createdAt),
    expiresAtMillis: timestampMillis(data.expiresAt),
    usedAtMillis: timestampMillis(data.usedAt),
    usedByUid: readString(data.usedByUid) ?? "",
    usedByEmail: readString(data.usedByEmail) ?? "",
    maxUses: readNumber(data.maxUses) ?? 1,
    useCount: readNumber(data.useCount) ?? 0,
    lastAccessedAtMillis: timestampMillis(data.lastAccessedAt),
    revokedAtMillis: timestampMillis(data.revokedAt),
    revokedByUid: readString(data.revokedByUid) ?? "",
  };
}

export const createCouponRestaurantInvite = onCall(async (request) => {
  const admin = requireAdminInviteAccess(request);
  const data = readRecord(request.data);
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const inviteRef = db.collection(restaurantInviteCollection).doc();

  const restaurantName = readString(data.restaurantName);
  if (!restaurantName) {
    throw new HttpsError(
      "invalid-argument",
      "Restaurant name is required for a coupon invite.",
    );
  }

  const { restaurantId, pendingRestaurantKey } = couponInviteRestaurantIdentity(
    data.restaurantId,
    inviteRef.id,
  );
  const couponPrefill = {
    restaurantName,
    streetAddress: readString(data.streetAddress) ?? null,
    city: readString(data.city) ?? null,
    state: readString(data.state) ?? null,
    zipCode: readString(data.zipCode) ?? null,
    phone: readString(data.phone) ?? null,
    website: readString(data.website) ?? null,
    latitude: readOptionalNumber(data.latitude),
    longitude: readOptionalNumber(data.longitude),
  };
  const expiresAt = inviteExpirationTimestamp();

  await inviteRef.set({
    tokenHash,
    type: "coupon_invite",
    side: "coupon",
    status: "active",
    restaurantId,
    pendingRestaurantKey,
    restaurantName,
    couponPrefill,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: admin.uid,
    createdByEmail: admin.email,
    expiresAt,
    usedAt: null,
    usedByUid: null,
    usedByEmail: null,
    maxUses: 1,
    useCount: 0,
    lastAccessedAt: null,
    revokedAt: null,
    revokedByUid: null,
  });

  return {
    inviteId: inviteRef.id,
    token,
    inviteUrl: inviteLink("coupon", token),
    expiresAtMillis: expiresAt.toMillis(),
  };
});

export const createBiteScoreRestaurantClaimInvite = onCall(async (request) => {
  const admin = requireAdminInviteAccess(request);
  const data = readRecord(request.data);
  const restaurantId = readString(data.restaurantId);
  if (!restaurantId) {
    throw new HttpsError(
      "invalid-argument",
      "BiteScore restaurant ID is required.",
    );
  }

  const restaurantSnapshot = await db
    .collection("bitescore_restaurants")
    .doc(restaurantId)
    .get();
  if (!restaurantSnapshot.exists) {
    throw new HttpsError(
      "not-found",
      "The selected BiteScore restaurant was not found.",
    );
  }

  const restaurantData = restaurantSnapshot.data() ?? {};
  const restaurantName =
    readString(restaurantData.name) ??
    readString(restaurantData.restaurantName);
  if (!restaurantName) {
    throw new HttpsError(
      "failed-precondition",
      "The selected BiteScore restaurant is missing a name.",
    );
  }

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = inviteExpirationTimestamp();
  const inviteRef = db.collection(restaurantInviteCollection).doc();
  const addressParts = [
    readString(restaurantData.address) ??
      readString(restaurantData.streetAddress),
    readString(restaurantData.city),
    readString(restaurantData.state) ?? readString(restaurantData.stateCode),
    readString(restaurantData.zipCode) ??
      readString(restaurantData.zip) ??
      readString(restaurantData.postalCode),
  ].filter((part): part is string => Boolean(part));

  await inviteRef.set({
    tokenHash,
    type: "bitescore_claim_invite",
    side: "bitescore",
    status: "active",
    restaurantId,
    restaurantName,
    restaurantAddressSummary: addressParts.join(", "),
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: admin.uid,
    createdByEmail: admin.email,
    expiresAt,
    usedAt: null,
    usedByUid: null,
    usedByEmail: null,
    maxUses: 1,
    useCount: 0,
    lastAccessedAt: null,
    revokedAt: null,
    revokedByUid: null,
  });

  return {
    inviteId: inviteRef.id,
    token,
    inviteUrl: inviteLink("bitescore", token),
    expiresAtMillis: expiresAt.toMillis(),
  };
});

export const revokeRestaurantInvite = onCall(async (request) => {
  const admin = requireAdminInviteAccess(request);
  const data = readRecord(request.data);
  const inviteId = readString(data.inviteId);
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "Invite ID is required.");
  }

  const inviteRef = db.collection(restaurantInviteCollection).doc(inviteId);
  const inviteSnapshot = await inviteRef.get();
  if (!inviteSnapshot.exists) {
    throw new HttpsError("not-found", "Invite not found.");
  }

  await inviteRef.set(
    {
      status: "revoked",
      revokedAt: FieldValue.serverTimestamp(),
      revokedByUid: admin.uid,
    },
    { merge: true },
  );

  return { inviteId, status: "revoked" };
});

export const listRestaurantInvites = onCall(async (request) => {
  requireAdminInviteAccess(request);
  const data = readRecord(request.data);
  const side = readString(data.side);
  const limitInput = readNumber(data.limit);
  const limit = Math.min(Math.max(limitInput ?? 50, 1), 100);

  const snapshot = await db.collection(restaurantInviteCollection).get();
  const invites = snapshot.docs.map(serializeInviteDoc);
  return {
    invites: filterAndSortInviteSummaries(invites, side, limit),
  };
});

export const previewRestaurantInvite = onCall(async (request) => {
  const data = readRecord(request.data);
  const token = readString(data.token);
  if (!token) {
    throw new HttpsError("invalid-argument", "Invite token is required.");
  }

  const expectedSide = normalizeInviteSide(readString(data.side));
  const tokenHash = hashInviteToken(token);
  const snapshot = await db
    .collection(restaurantInviteCollection)
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new HttpsError("not-found", "This invite link is no longer valid.");
  }

  const inviteDoc = snapshot.docs[0];
  const invite = serializeInviteDoc(inviteDoc);
  const unavailableReason = invitePreviewUnavailableReason(
    invite,
    expectedSide,
  );
  if (unavailableReason !== null) {
    throw new HttpsError(
      "failed-precondition",
      "This invite link is no longer valid.",
      { reason: unavailableReason },
    );
  }

  const inviteData = inviteDoc.data();
  const side = normalizeInviteSide(invite.side);
  if (!side) {
    throw new HttpsError(
      "failed-precondition",
      "This invite link is no longer valid.",
      { reason: "missing-side" },
    );
  }

  const safePreview: Record<string, unknown> = {
    inviteId: invite.id,
    side,
    type: invite.type,
    status: invite.status,
    restaurantName: invite.restaurantName,
    expiresAtMillis: invite.expiresAtMillis,
  };

  if (side === "coupon") {
    const couponPrefill = readRecord(inviteData.couponPrefill);
    safePreview.pendingRestaurantKey = invite.pendingRestaurantKey;
    safePreview.couponPrefill = {
      streetAddress: readString(couponPrefill.streetAddress) ?? null,
      city: readString(couponPrefill.city) ?? null,
      state: readString(couponPrefill.state) ?? null,
      zipCode: readString(couponPrefill.zipCode) ?? null,
      phone: readString(couponPrefill.phone) ?? null,
      website: readString(couponPrefill.website) ?? null,
      latitude: readOptionalNumber(couponPrefill.latitude),
      longitude: readOptionalNumber(couponPrefill.longitude),
    };
  } else {
    safePreview.restaurantId = invite.restaurantId;
    safePreview.restaurantAddressSummary =
      readString(inviteData.restaurantAddressSummary) ?? "";
  }

  return safePreview;
});

export const redeemCouponRestaurantInvite = onCall(async (request) => {
  const uid = request.auth?.uid?.trim();
  const userEmail = readString(request.auth?.token.email);
  if (!uid || !userEmail) {
    throw new HttpsError(
      "unauthenticated",
      "Please sign in before redeeming this invite.",
    );
  }

  const data = readRecord(request.data);
  const token = readString(data.token);
  if (!token) {
    throw new HttpsError("invalid-argument", "Invite token is required.");
  }

  const tokenHash = hashInviteToken(token);
  const inviteQuery = db
    .collection(restaurantInviteCollection)
    .where("tokenHash", "==", tokenHash)
    .limit(1);
  const accountRef = db.collection("restaurant_accounts").doc(uid);

  const result = await db.runTransaction(async (transaction) => {
    const inviteSnapshot = await transaction.get(inviteQuery);
    if (inviteSnapshot.empty) {
      throw new HttpsError("not-found", "This invite link is no longer valid.");
    }

    const inviteDoc = inviteSnapshot.docs[0];
    const invite = serializeInviteDoc(inviteDoc);
    const unavailableReason = invitePreviewUnavailableReason(invite, "coupon");
    if (unavailableReason !== null) {
      throw new HttpsError(
        "failed-precondition",
        unavailableReason === "used"
          ? "This invite has already been used."
          : "This invite link is no longer valid.",
        { reason: unavailableReason },
      );
    }

    if (invite.type !== "coupon_invite" || invite.side !== "coupon") {
      throw new HttpsError(
        "failed-precondition",
        "This invite link is no longer valid.",
        { reason: "wrong-type" },
      );
    }

    const inviteData = inviteDoc.data();
    const couponPrefill = readRecord(inviteData.couponPrefill);
    const restaurantName =
      readString(inviteData.restaurantName) ??
      readString(couponPrefill.restaurantName);
    if (!restaurantName) {
      throw new HttpsError(
        "failed-precondition",
        "This invite link is no longer valid.",
        { reason: "missing-restaurant-name" },
      );
    }

    const accountSnapshot = await transaction.get(accountRef);
    const accountData = accountSnapshot.data() ?? {};
    const existingRestaurantName = readString(accountData.restaurantName);
    const existingSubmitted = accountData.couponApplicationSubmitted === true;
    const existingApprovalStatus = readString(accountData.approvalStatus);
    const hasExistingCouponAccount =
      Boolean(existingRestaurantName) ||
      existingSubmitted ||
      Boolean(existingApprovalStatus);
    if (
      hasExistingCouponAccount &&
      (!existingRestaurantName ||
        existingRestaurantName.trim().toLowerCase() !==
          restaurantName.trim().toLowerCase())
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This signed-in account already has a different coupon-side restaurant account.",
        { reason: "conflicting-account" },
      );
    }

    const latitude = readOptionalNumber(couponPrefill.latitude);
    const longitude = readOptionalNumber(couponPrefill.longitude);
    const accountUpdate: Record<string, unknown> = {
      uid,
      email: userEmail,
      restaurantName,
      streetAddress: readString(couponPrefill.streetAddress) ?? null,
      city: readString(couponPrefill.city) ?? "",
      state: readString(couponPrefill.state) ?? "",
      zipCode: readString(couponPrefill.zipCode) ?? "",
      phone: readString(couponPrefill.phone) ?? null,
      website: readString(couponPrefill.website) ?? null,
      couponApplicationSubmitted: true,
      approvalStatus: "approved",
      emailVerified: request.auth?.token.email_verified === true,
      inviteId: invite.id,
      inviteRestaurantKey: invite.pendingRestaurantKey || null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (latitude !== null) {
      accountUpdate.latitude = latitude;
    }
    if (longitude !== null) {
      accountUpdate.longitude = longitude;
    }
    if (!accountSnapshot.exists || accountData.createdAt == null) {
      accountUpdate.createdAt = FieldValue.serverTimestamp();
    }

    transaction.set(accountRef, accountUpdate, { merge: true });
    transaction.set(
      inviteDoc.ref,
      {
        status: "used",
        usedAt: FieldValue.serverTimestamp(),
        usedByUid: uid,
        usedByEmail: userEmail,
        useCount: (readNumber(inviteDoc.data().useCount) ?? 0) + 1,
      },
      { merge: true },
    );

    return {
      inviteId: invite.id,
      restaurantName,
    };
  });

  return result;
});

export const redeemBiteScoreRestaurantClaimInvite = onCall(async (request) => {
  const uid = request.auth?.uid?.trim();
  const userEmail = readString(request.auth?.token.email);
  const userName =
    readString(request.auth?.token.name) ??
    userEmail ??
    "Invited restaurant owner";
  if (!uid || !userEmail) {
    throw new HttpsError(
      "unauthenticated",
      "Please sign in before redeeming this invite.",
    );
  }

  const data = readRecord(request.data);
  const token = readString(data.token);
  if (!token) {
    throw new HttpsError("invalid-argument", "Invite token is required.");
  }

  const tokenHash = hashInviteToken(token);
  const inviteQuery = db
    .collection(restaurantInviteCollection)
    .where("tokenHash", "==", tokenHash)
    .limit(1);

  const result = await db.runTransaction(async (transaction) => {
    const inviteSnapshot = await transaction.get(inviteQuery);
    if (inviteSnapshot.empty) {
      throw new HttpsError("not-found", "This invite link is no longer valid.");
    }

    const inviteDoc = inviteSnapshot.docs[0];
    const invite = serializeInviteDoc(inviteDoc);
    const unavailableReason = invitePreviewUnavailableReason(
      invite,
      "bitescore",
    );
    if (unavailableReason !== null) {
      throw new HttpsError(
        "failed-precondition",
        unavailableReason === "used"
          ? "This invite has already been used."
          : "This invite link is no longer valid.",
        { reason: unavailableReason },
      );
    }

    if (
      invite.type !== "bitescore_claim_invite" ||
      invite.side !== "bitescore"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This invite link is no longer valid.",
        { reason: "wrong-type" },
      );
    }

    const restaurantId = readString(inviteDoc.data().restaurantId);
    if (!restaurantId) {
      throw new HttpsError(
        "failed-precondition",
        "This invite link is no longer valid.",
        { reason: "missing-restaurant-id" },
      );
    }

    const restaurantRef = db
      .collection("bitescore_restaurants")
      .doc(restaurantId);
    const restaurantSnapshot = await transaction.get(restaurantRef);
    if (!restaurantSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "The invited BiteScore restaurant was not found.",
      );
    }

    const restaurantData = restaurantSnapshot.data() ?? {};
    const restaurantName =
      readString(restaurantData.name) ??
      readString(restaurantData.restaurantName) ??
      readString(inviteDoc.data().restaurantName);
    if (!restaurantName) {
      throw new HttpsError(
        "failed-precondition",
        "The invited BiteScore restaurant is missing a name.",
        { reason: "missing-restaurant-name" },
      );
    }

    const existingOwnerUid = readString(restaurantData.ownerUserId);
    if (existingOwnerUid && existingOwnerUid !== uid) {
      throw new HttpsError(
        "failed-precondition",
        "This BiteScore restaurant has already been claimed.",
        { reason: "already-claimed" },
      );
    }

    const claimRef = db.collection("restaurant_claim_requests").doc();
    transaction.set(claimRef, {
      id: claimRef.id,
      restaurantId,
      restaurantName,
      requesterUserId: uid,
      claimantName: userName,
      email: userEmail,
      phone: "Not provided",
      message: "Approved by secure BiteScore invite token.",
      status: "approved",
      inviteId: invite.id,
      inviteType: invite.type,
      approvedBy: "invite",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      approvedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      restaurantRef,
      {
        ownerUserId: uid,
        isClaimed: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(
      inviteDoc.ref,
      {
        status: "used",
        usedAt: FieldValue.serverTimestamp(),
        usedByUid: uid,
        usedByEmail: userEmail,
        useCount: (readNumber(inviteDoc.data().useCount) ?? 0) + 1,
      },
      { merge: true },
    );

    return {
      inviteId: invite.id,
      restaurantId,
      restaurantName,
    };
  });

  return result;
});

function writtenReviewWordCount(
  headline?: string | null,
  notes?: string | null,
): number {
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

function normalizedListContains(
  values: string[] | undefined,
  normalized: string | null,
): boolean {
  if (!normalized) {
    return false;
  }
  return (values ?? []).some((value) => normalizeTerm(value) === normalized);
}

function matchesAliases(
  aliases: string[] | undefined,
  sources: string[],
): boolean {
  const searchTerms = new Set<string>();
  for (const source of sources) {
    addSearchTerms(searchTerms, source);
  }
  for (const alias of aliases ?? []) {
    const normalizedAlias = normalizeTerm(alias);
    if (!normalizedAlias) {
      continue;
    }
    if (
      searchTerms.has(normalizedAlias) ||
      Array.from(searchTerms).some((term) => term.includes(normalizedAlias))
    ) {
      return true;
    }
  }
  return false;
}

function matchesExactAliases(
  aliases: string[] | undefined,
  sources: string[],
): boolean {
  const normalizedSources = new Set(
    sources
      .map((source) => normalizeTerm(source))
      .filter((source): source is string => !!source),
  );
  for (const alias of aliases ?? []) {
    const normalizedAlias = normalizeTerm(alias);
    if (normalizedAlias && normalizedSources.has(normalizedAlias)) {
      return true;
    }
  }
  return false;
}

function isExcludedFromLocalExpertType(
  type: LocalExpertTypeConfig,
  normalizedCategory: string | null,
  normalizedSubcategory: string | null,
  searchSources: string[],
): boolean {
  return (
    normalizedListContains(type.excludedCategoryNames, normalizedCategory) ||
    normalizedListContains(type.excludedSubcategories, normalizedSubcategory) ||
    matchesAliases(type.excludedAliases, searchSources)
  );
}

function matchLocalExpertTypes(
  candidate: LocalExpertReviewCandidate,
): LocalExpertTypeConfig[] {
  const normalizedCategory = normalizeTerm(candidate.categoryName);
  const normalizedSubcategory = normalizeTerm(candidate.subcategory);
  const searchSources = [
    candidate.dishName,
    candidate.subcategory,
    ...candidate.categoryTags,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  const matches: LocalExpertTypeConfig[] = [];

  for (const type of localExpertTypes) {
    if (
      isExcludedFromLocalExpertType(
        type,
        normalizedCategory,
        normalizedSubcategory,
        searchSources,
      )
    ) {
      continue;
    }
    if (
      normalizedListContains(type.mappedSubcategories, normalizedSubcategory)
    ) {
      matches.push(type);
      continue;
    }
    if (matchesExactAliases(type.exactAliases, searchSources)) {
      matches.push(type);
      continue;
    }
    if (matchesAliases(type.aliases, searchSources)) {
      matches.push(type);
      continue;
    }
    if (
      type.categoryMayQualify &&
      normalizedListContains(type.mappedCategoryNames, normalizedCategory)
    ) {
      matches.push(type);
    }
  }
  return matches;
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

function distanceMiles(
  first: LocalExpertReviewCandidate,
  second: LocalExpertReviewCandidate,
): number {
  if (!hasUsableCoordinates(first) || !hasUsableCoordinates(second)) {
    return Number.POSITIVE_INFINITY;
  }
  const earthRadiusMiles = 3958.7613;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(first.latitude!);
  const lat2 = toRadians(second.latitude!);
  const deltaLat = toRadians(second.latitude! - first.latitude!);
  const deltaLng = toRadians(second.longitude! - first.longitude!);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bestPairwiseClusterCount(
  candidates: LocalExpertReviewCandidate[],
): number {
  const byRestaurant = new Map<string, LocalExpertReviewCandidate>();
  for (const candidate of candidates) {
    if (hasUsableCoordinates(candidate)) {
      byRestaurant.set(candidate.restaurantId.trim(), candidate);
    }
  }
  const locations = Array.from(byRestaurant.values()).sort((a, b) =>
    a.restaurantId.localeCompare(b.restaurantId),
  );
  if (locations.length < 2) {
    return locations.length;
  }

  const adjacency = new Map<number, Set<number>>();
  for (let i = 0; i < locations.length; i += 1) {
    adjacency.set(i, new Set<number>());
  }
  for (let i = 0; i < locations.length; i += 1) {
    for (let j = i + 1; j < locations.length; j += 1) {
      if (
        distanceMiles(locations[i], locations[j]) <=
        localExpertClusterRadiusMiles
      ) {
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

  expand(
    [],
    locations.map((_, index) => index),
  );
  return best;
}

function normalizeCountyKey(value?: string | null): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\u2018\u2019\u201B\u2032']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+county$/, "")
    .trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeStateKey(value?: string | null): string | null {
  const stateName = value
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stateCode = stateName
    ? localExpertStateNameToCode.get(stateName)
    : null;
  if (stateCode) {
    return stateCode;
  }
  const normalized = value
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return normalized && normalized.length > 0 ? normalized : null;
}

function sameCountyKey(candidate: LocalExpertReviewCandidate): string | null {
  const county = normalizeCountyKey(candidate.county);
  const state = normalizeStateKey(candidate.state);
  return county && state ? `${state}:${county}` : null;
}

function bestSameCountyCount(candidates: LocalExpertReviewCandidate[]): number {
  const restaurantIdsByCounty = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const key = sameCountyKey(candidate);
    const restaurantId = candidate.restaurantId.trim();
    if (!key || restaurantId.length === 0) {
      continue;
    }
    const restaurants = restaurantIdsByCounty.get(key) ?? new Set<string>();
    restaurants.add(restaurantId);
    restaurantIdsByCounty.set(key, restaurants);
  }
  let best = 0;
  for (const restaurantIds of restaurantIdsByCounty.values()) {
    best = Math.max(best, restaurantIds.size);
  }
  return best;
}

function representativeTimeMillis(
  candidate: LocalExpertReviewCandidate,
): number {
  return (
    candidate.updatedAt?.toMillis() ?? candidate.createdAt?.toMillis() ?? 0
  );
}

function dedupeKey(
  userId: string,
  restaurantId: string,
  expertTypeId: string,
): string {
  return `${userId.trim().toLowerCase()}|${restaurantId.trim().toLowerCase()}|${expertTypeId}`;
}

function localExpertLevelRank(level?: string | null): number {
  switch (level) {
    case "level1":
      return 1;
    case "level2":
      return 2;
    case "level3":
      return 3;
    default:
      return 0;
  }
}

function localExpertCelebrationEventKey(
  userId: string,
  expertTypeId: string,
  level: string,
): string {
  return `${userId}_${expertTypeId}_${level}`;
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

async function buildLocalExpertCandidatesForUser(
  userId: string,
): Promise<LocalExpertReviewCandidate[]> {
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
      if (
        !dishId ||
        !restaurantId ||
        writtenReviewWordCount(review.headline, review.notes) < 10
      ) {
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
      const county =
        readString(restaurant.county) ??
        readString(restaurant.countyName) ??
        readString(restaurant.normalizedCounty);
      const state =
        readString(restaurant.state) ??
        readString(restaurant.stateCode) ??
        readString(restaurant.region) ??
        readString(restaurant.province);
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
        county,
        state,
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

function calculateLocalExpertBadges(
  candidates: LocalExpertReviewCandidate[],
): LocalExpertBadgeResult[] {
  const representativesByKey = new Map<string, LocalExpertResolvedReview>();

  for (const candidate of candidates) {
    const types = matchLocalExpertTypes(candidate);
    if (types.length === 0) {
      continue;
    }

    for (const type of types) {
      const key = dedupeKey("unused", candidate.restaurantId, type.id);
      const existing = representativesByKey.get(key);
      if (
        !existing ||
        representativeTimeMillis(candidate) >
          representativeTimeMillis(existing.candidate) ||
        (representativeTimeMillis(candidate) ===
          representativeTimeMillis(existing.candidate) &&
          candidate.reviewId.localeCompare(existing.candidate.reviewId) > 0)
      ) {
        representativesByKey.set(key, { candidate, expertType: type });
      }
    }
  }

  return localExpertTypes.map((type) => {
    const representatives = Array.from(representativesByKey.values())
      .filter((entry) => entry.expertType.id === type.id)
      .sort((a, b) => {
        const restaurantComparison = a.candidate.restaurantId.localeCompare(
          b.candidate.restaurantId,
        );
        return restaurantComparison !== 0
          ? restaurantComparison
          : a.candidate.reviewId.localeCompare(b.candidate.reviewId);
      });
    const restaurantIds = Array.from(
      new Set(
        representatives.map((entry) => entry.candidate.restaurantId.trim()),
      ),
    ).sort();
    const reviewIds = representatives
      .map((entry) => entry.candidate.reviewId)
      .sort();
    const total = restaurantIds.length;
    const local = bestPairwiseClusterCount(
      representatives.map((entry) => entry.candidate),
    );
    const county = bestSameCountyCount(
      representatives.map((entry) => entry.candidate),
    );
    const localOrCounty = Math.max(local, county);

    let level: LocalExpertBadgeResult["level"] = null;
    if (total >= 25) {
      level = "level3";
    } else if (total >= 10 || localOrCounty >= 5) {
      level = "level2";
    } else if (total >= 5 || localOrCounty >= 3) {
      level = "level1";
    }

    const overallQualified =
      (level === "level3" && total >= 25) ||
      (level === "level2" && total >= 10) ||
      (level === "level1" && total >= 5);
    const localQualified =
      (level === "level2" && localOrCounty >= 5) ||
      (level === "level1" && localOrCounty >= 3);
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

async function persistLocalExpertBadges(
  userId: string,
  results: LocalExpertBadgeResult[],
): Promise<LocalExpertBadgePersistenceResult> {
  const badgeCollection = db
    .collection("user_profiles")
    .doc(userId)
    .collection("local_expert_badges");
  const celebrationCollection = db
    .collection("user_profiles")
    .doc(userId)
    .collection(localExpertCelebrationSubcollection);
  const existingSnapshot = await badgeCollection.get();
  const existingIds = new Set(existingSnapshot.docs.map((doc) => doc.id));
  const batch = db.batch();
  let earnedBadgeCount = 0;
  let removedBadgeCount = 0;
  const celebrations: LocalExpertBadgeCelebrationEvent[] = [];

  for (const result of results) {
    const badgeRef = badgeCollection.doc(result.expertTypeId);
    if (!result.level) {
      continue;
    }
    const existingDoc = existingSnapshot.docs.find(
      (doc) => doc.id === result.expertTypeId,
    );
    const existingEarnedAt = existingDoc?.get("earnedAt");
    const existingLevel = readString(existingDoc?.get("level"));
    const existingLevelRank = localExpertLevelRank(existingLevel);
    const newLevelRank = localExpertLevelRank(result.level);
    const celebrationKind =
      existingLevelRank === 0
        ? "earned"
        : existingLevelRank < newLevelRank
          ? "levelUp"
          : null;
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
        qualifyingRestaurantIdsTruncated:
          result.qualifyingRestaurantIds.length > 50,
        earnedAt: existingEarnedAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        source: "localExpertFunctionsV1",
      },
      { merge: true },
    );

    if (celebrationKind) {
      const eventKey = localExpertCelebrationEventKey(
        userId,
        result.expertTypeId,
        result.level,
      );
      const celebrationRef = celebrationCollection.doc(eventKey);
      const celebrationDoc = await celebrationRef.get();
      if (!celebrationDoc.exists) {
        const celebration: LocalExpertBadgeCelebrationEvent = {
          eventKey,
          expertTypeId: result.expertTypeId,
          displayName: result.displayName,
          level: result.level,
          kind: celebrationKind,
          status: "pending",
        };
        celebrations.push(celebration);
        batch.set(celebrationRef, {
          ...celebration,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          source: "localExpertFunctionsV1",
        });
      }
    }
  }

  for (const staleId of existingIds) {
    if (legacyLocalExpertTypeIds.has(staleId)) {
      continue;
    }
    removedBadgeCount += 1;
    batch.delete(badgeCollection.doc(staleId));
  }

  await batch.commit();
  return { earnedBadgeCount, removedBadgeCount, celebrations };
}

async function recalculateLocalExpertBadgesForUser(
  userId: string,
): Promise<LocalExpertBadgePersistenceResult> {
  const candidates = await buildLocalExpertCandidatesForUser(userId);
  const results = calculateLocalExpertBadges(candidates);
  return persistLocalExpertBadges(userId, results);
}

function mapStripeStatusToAppStatus(
  status: Stripe.Subscription.Status,
): string {
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
      : (subscription.customer?.id ?? null);

  const restaurantUid = await resolveRestaurantAccountUid({
    ownerUid: metadata.ownerUid,
    restaurantAccountId: metadata.restaurantAccountId,
    stripeCustomerId,
  });

  if (!restaurantUid) {
    logger.warn(
      "Could not resolve restaurant account for Stripe subscription",
      {
        subscriptionId: subscription.id,
        stripeCustomerId,
        metadata,
      },
    );
    return;
  }

  const subscriptionStatus = mapStripeStatusToAppStatus(subscription.status);
  const couponPostingEnabled =
    subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const trialEndsAt =
    subscriptionStatus === "trialing"
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

  await db
    .collection("restaurant_accounts")
    .doc(restaurantUid)
    .set(updateData, { merge: true });
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
    const cancelUrl = stripeCheckoutCancelUrl || hostedStripeCheckoutCancelUrl;
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
    const cancelUrl = stripeCheckoutCancelUrl || hostedStripeCheckoutCancelUrl;
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
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;");
  const escapedMessage = params.message
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;");
  const escapedButton = params.buttonLabel
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;");
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
      <p class="hint">If BiteStar does not open, switch back to the app to continue.</p>
    </div>
  </body>
</html>`;
}

export const subscriptionCheckoutSuccess = onRequest((request, response) => {
  response.status(200).send(
    renderSubscriptionReturnPage({
      title: "Subscription Active",
      message:
        "Your subscription was successful. Tap below to return to BiteStar.",
      returnUri: subscriptionReturnSuccessUri,
      buttonLabel: "Open BiteStar",
    }),
  );
});

export const subscriptionCheckoutCancel = onRequest((request, response) => {
  response.status(200).send(
    renderSubscriptionReturnPage({
      title: "Subscription Canceled",
      message: "No changes were made. Tap below to return to BiteStar.",
      returnUri: subscriptionReturnCancelUri,
      buttonLabel: "Open BiteStar",
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
      const installation = installationSnap.data() as
        | InstallationData
        | undefined;

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
    await db.recursiveDelete(
      accountRef.collection("coupon_number_reservations"),
    );
    await db.recursiveDelete(accountRef.collection("coupon_code_reservations"));
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
    celebrations: result.celebrations,
  };
});

export const awardContributionPoints = onCall(async (request) => {
  return awardContributionPointsCallableHandler(db, request);
});

export const awardReviewMilestoneContributionPoints = onCall(
  async (request) => {
    return awardReviewMilestoneContributionPointsCallableHandler(db, request);
  },
);

export const awardDishImageContributionPoints = onCall(async (request) => {
  return awardDishImageContributionPointsCallableHandler(db, request);
});

export const awardCreatedDishContributionPoints = onCall(async (request) => {
  return awardCreatedDishContributionPointsCallableHandler(db, request);
});

export const awardApprovedDishProposalContributionPoints = onCall(
  async (request) => {
    return awardApprovedDishProposalContributionPointsCallableHandler(
      db,
      request,
    );
  },
);

export const markContributionPointLedgerEntriesCelebrated = onCall(
  async (request) => {
    return markContributionPointLedgerEntriesCelebratedCallableHandler(
      db,
      request,
    );
  },
);

export const reverseContributionPointsForDish = onCall(async (request) => {
  return reverseContributionPointsForDishCallableHandler(db, request);
});

export const reconcileReviewMilestoneContributionPointsAfterModeration = onCall(
  async (request) => {
    return reconcileReviewMilestoneContributionPointsAfterModerationCallableHandler(
      db,
      request,
    );
  },
);

export const reverseContributionPointLedgerEntry = onCall(async (request) => {
  return reverseContributionPointLedgerEntryCallableHandler(db, request);
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
        logger.error(
          "Failed to recalculate Local Expert badges after review write",
          {
            reviewId: event.params.reviewId,
            userId,
            error,
          },
        );
      }
    }
  },
);
