const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const firebase = require("firebase/compat/app");
require("firebase/compat/firestore");

const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");

const projectId = "demo-coupon-app-rules";
const rulesPath = path.resolve(__dirname, "../../firestore.rules");
const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;
const biteSaverRestaurantPublicProjectionVersion =
  "bitestar.bitesaver-public-restaurant.v1";

let testEnv;
let actors;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(rulesPath, "utf8"),
    },
  });

  actors = {
    unauthenticated: testEnv.unauthenticatedContext(),
    customer: testEnv.authenticatedContext("customer-a", {
      email: "customer-a@example.com",
      email_verified: true,
    }),
    wrongCustomer: testEnv.authenticatedContext("customer-b", {
      email: "customer-b@example.com",
      email_verified: true,
    }),
    restaurantOwner: testEnv.authenticatedContext("owner-1", {
      email: "owner-1@example.com",
      email_verified: true,
    }),
    wrongRestaurantOwner: testEnv.authenticatedContext("owner-2", {
      email: "owner-2@example.com",
      email_verified: true,
    }),
    biteScoreOwner: testEnv.authenticatedContext("bitescore-owner", {
      email: "bitescore-owner@example.com",
      email_verified: true,
    }),
    admin: testEnv.authenticatedContext("admin-1", {
      admin: true,
      email: "admin@example.com",
      email_verified: true,
    }),
  };
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedFirestore();
});

test.after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

function dbFor(actorName) {
  return actors[actorName].firestore();
}

function biteScoreRestaurantCreateData({
  id = "new-restaurant-1",
  createdByUserId = "customer-a",
} = {}) {
  return {
    id,
    name: "New Provenance Pizza",
    restaurantName: "New Provenance Pizza",
    normalizedName: "new provenance pizza",
    address: "2 Main St",
    streetAddress: "2 Main St",
    city: "Lecanto",
    state: "FL",
    zipCode: "34461",
    location: new firebase.firestore.GeoPoint(28.8517, -82.487),
    isClaimed: false,
    isActive: true,
    active: true,
    restaurantWriteRevision: 0,
    createdByUserId,
    createdFromCreateFlow: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function claimableBiteScoreRestaurantData(
  id,
  { overrides = {}, omittedFields = [] } = {},
) {
  const data = {
    ...biteScoreRestaurantCreateData({ id }),
    restaurantWriteRevision: 4,
    ...overrides,
  };
  for (const field of omittedFields) {
    delete data[field];
  }
  return data;
}

function restaurantClaimRequestData(
  id,
  restaurantId,
  overrides = {},
) {
  return {
    id,
    restaurantId,
    restaurantName: `Claim fixture ${restaurantId}`,
    requesterUserId: "customer-a",
    claimantName: "Customer A",
    email: "customer-a@example.com",
    phone: "555-0100",
    status: "pending",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function restaurantClaimApprovalBatch(
  db,
  {
    claimId,
    restaurantId,
    requesterUserId = "customer-a",
    nextRevision = 5,
    claimPatch = {},
    restaurantPatch = {},
  },
) {
  const batch = db.batch();
  batch.set(
    db.doc(`restaurant_claim_requests/${claimId}`),
    {
      status: "approved",
      updatedAt: serverTimestamp(),
      ...claimPatch,
    },
    { merge: true },
  );
  batch.set(
    db.doc(`bitescore_restaurants/${restaurantId}`),
    {
      ownerUserId: requesterUserId,
      isClaimed: true,
      restaurantWriteRevision: nextRevision,
      updatedAt: serverTimestamp(),
      ...restaurantPatch,
    },
    { merge: true },
  );
  return batch;
}

function biteScoreDishCreateData({
  id = "new-dish-1",
  restaurantId = "bs-1",
  createdByUserId = "customer-a",
  createdFromReviewId = "new-dish-1_customer-a",
  createdWithRestaurantId = restaurantId,
} = {}) {
  return {
    id,
    restaurantId,
    restaurantName: "BiteScore Pizza",
    name: "New Pizza Slice",
    normalizedName: "new pizza slice",
    category: "Pizza",
    isActive: true,
    imageCount: 0,
    createdByUserId,
    createdFromReviewId,
    createdWithRestaurantId,
    createdFromCreateFlow: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function ruleTestDishData(
  dishId,
  { aggregateWriteGeneration, restaurantId = "bs-1" } = {},
) {
  return {
    id: dishId,
    restaurantId,
    restaurantName: "BiteScore Pizza",
    name: `Rules fixture ${dishId}`,
    normalizedName: `rules fixture ${dishId}`,
    category: "Pizza",
    isActive: true,
    imageCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...(aggregateWriteGeneration === undefined
      ? {}
      : { aggregateWriteGeneration }),
  };
}

function reviewWriteData({
  id,
  dishId,
  restaurantId = "bs-1",
  userId = "customer-a",
  headline = "Merge lock rules fixture",
} = {}) {
  return {
    id,
    dishId,
    restaurantId,
    userId,
    overallImpression: 8,
    overallBiteScore: 80,
    headline,
    notes: "Rules-only merge lock fixture.",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function aggregateWriteData({
  dishId,
  restaurantId = "bs-1",
  ratingCount = 1,
  aggregateWriteGeneration,
} = {}) {
  return {
    dishId,
    restaurantId,
    overallBiteScore: 80,
    ratingCount,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...(aggregateWriteGeneration === undefined
      ? {}
      : { aggregateWriteGeneration }),
  };
}

function dishProposalWriteData(overrides = {}) {
  return {
    id: "rules-proposal",
    type: "rename",
    restaurantId: "bs-1",
    targetDishId: "dish-1",
    proposedName: "Cheese Slice",
    userId: "customer-a",
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function mergeReviewLockData(
  dishId,
  {
    role = "source",
    state = "active",
    targetDishId = null,
    blocksClientReviews = true,
    blocksClientAggregates = true,
    activeAggregateWriteGeneration = 1,
    completionAggregateWriteGeneration = state === "active"
      ? activeAggregateWriteGeneration + 1
      : activeAggregateWriteGeneration,
  } = {},
) {
  return {
    version: "bitestar.dish-merge-review-lock.v1",
    dishId,
    jobId: "job-rules-fixture",
    groupId: "group-rules-fixture",
    role,
    state,
    blocksClientReviews,
    blocksClientAggregates,
    activeAggregateWriteGeneration,
    completionAggregateWriteGeneration,
    targetDishId,
    fingerprint: "rules-fixture-fingerprint",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    indexedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function reviewMilestoneLockData(
  userId,
  {
    operationId = "rules-review-milestone-operation",
    lockToken = "a".repeat(64),
    state = "active",
    fingerprint = "b".repeat(64),
  } = {},
) {
  return {
    version: "bitestar.review-milestone-lock.v1",
    userId,
    operationId,
    lockToken,
    state,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:01.000Z"),
    fingerprint,
  };
}

function ratingRestaurantOperationLockData(
  restaurantId,
  state = "active",
) {
  return {
    version: "bitestar.rating-restaurant-operation-lock.v1",
    restaurantId,
    jobId: `restaurant-job-${restaurantId}`,
    operation: "restaurantDelete",
    role: "source",
    state,
    fingerprint: "c".repeat(64),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:01.000Z"),
  };
}

function ratingDishOperationLockData(dishId, state = "active") {
  return {
    version: "bitestar.rating-dish-operation-lock.v1",
    dishId,
    jobId: `dish-job-${dishId}`,
    operation: "dishDelete",
    role: "source",
    state,
    fingerprint: "d".repeat(64),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:01.000Z"),
  };
}

function restaurantCouponWriteData(id, overrides = {}) {
  return {
    id,
    restaurant: "Approved Tacos",
    title: "Free Salsa",
    usageRule: "Once per customer",
    startTime: new Date("2026-01-15T00:00:00.000Z"),
    endTime: new Date("2026-02-15T00:00:00.000Z"),
    couponNumber: "1002",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function restaurantDailySpecialWriteData(id, overrides = {}) {
  return {
    id,
    restaurantId: "owner-1",
    ownerUid: "owner-1",
    title: "Dinner Special",
    isActive: true,
    availabilityMode: "recurring",
    allDay: true,
    hideWhenUnavailable: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function restaurantSearchIndexRuleData(
  indexDocumentId,
  {publicVisible = true, overrides = {}, omittedFields = []} = {},
) {
  const data = {
    searchIndexVersion: "bitestar.search-index.v1",
    publicProjectionVersion: biteSaverRestaurantPublicProjectionVersion,
    entityType: "restaurant",
    source: "biteSaver",
    sourceDocumentId: "owner-1",
    indexDocumentId,
    displayName: "Approved Tacos",
    normalizedName: "approved tacos",
    namePrefixTokens: ["approved", "tacos"],
    phone: "555-0101",
    city: "Lecanto",
    state: "FL",
    zip5: "34461",
    publicVisible,
    sourceFingerprint: "e".repeat(64),
    indexedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
  for (const field of omittedFields) {
    delete data[field];
  }
  return data;
}

async function seedRuleTestDocuments(documents) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();
    for (const { documentPath, data } of documents) {
      batch.set(db.doc(documentPath), data);
    }
    await batch.commit();
  });
}

async function updateRuleTestDocument(documentPath, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(documentPath).update(data);
  });
}

async function deleteRuleTestDocuments(documentPaths) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();
    for (const documentPath of documentPaths) {
      batch.delete(db.doc(documentPath));
    }
    await batch.commit();
  });
}

async function seedMergeReviewLocks(
  dishIds,
  { activeAggregateWriteGeneration = 1 } = {},
) {
  const documents = [];
  for (const [index, dishId] of dishIds.entries()) {
    documents.push(
      {
        documentPath: `bitescore_dishes/${dishId}`,
        data: ruleTestDishData(dishId, {
          aggregateWriteGeneration: activeAggregateWriteGeneration,
        }),
      },
      {
        documentPath: `private_dish_merge_review_locks/${dishId}`,
        data: mergeReviewLockData(dishId, {
          role: dishIds.length === 1 || index > 0 ? "target" : "source",
          targetDishId: index === 0 ? (dishIds[1] ?? null) : null,
          activeAggregateWriteGeneration,
        }),
      },
    );
  }
  await seedRuleTestDocuments(documents);
}

async function removeMergeReviewLock(
  dishId,
  { completionAggregateWriteGeneration = 2 } = {},
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();
    batch.set(
      db.doc(`bitescore_dishes/${dishId}`),
      { aggregateWriteGeneration: completionAggregateWriteGeneration },
      { merge: true },
    );
    batch.delete(db.doc(`private_dish_merge_review_locks/${dishId}`));
    await batch.commit();
  });
}

async function seedFirestore() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();
    const seededAt = new Date("2026-01-01T00:00:00.000Z");

    batch.set(db.doc("restaurant_accounts/owner-1"), {
      uid: "owner-1",
      email: "owner-1@example.com",
      restaurantName: "Approved Tacos",
      approvalStatus: "approved",
      couponApplicationSubmitted: true,
      subscriptionStatus: "active",
      couponPostingEnabled: true,
      stripeCustomerId: "cus_seed_owner_1",
      stripeSubscriptionId: "sub_seed_owner_1",
      city: "Lecanto",
      state: "FL",
      zipCode: "34461",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_accounts/pending-owner"), {
      uid: "pending-owner",
      email: "pending-owner@example.com",
      restaurantName: "Pending Burgers",
      approvalStatus: "pending",
      couponApplicationSubmitted: true,
      subscriptionStatus: "inactive",
      couponPostingEnabled: false,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_accounts/owner-1/coupons/coupon-1"), {
      id: "coupon-1",
      restaurant: "Approved Tacos",
      title: "Free Chips",
      usageRule: "Once per customer",
      startTime: seededAt,
      endTime: new Date("2026-02-01T00:00:00.000Z"),
      couponNumber: "1001",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_accounts/owner-1/daily_specials/special-1"), {
      id: "special-1",
      restaurantId: "owner-1",
      ownerUid: "owner-1",
      title: "Lunch Special",
      isActive: true,
      availabilityMode: "recurring",
      allDay: true,
      hideWhenUnavailable: true,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_accounts/owner-1/menu_items/item-1"), {
      id: "item-1",
      name: "Taco",
      description: "Classic taco",
      price: "4.00",
      category: "Entrees",
      sortOrder: 1,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_accounts/owner-1/menu_sections/section-1"), {
      id: "section-1",
      title: "Dinner",
      body: "Served daily",
      sortOrder: 1,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_accounts/owner-1/menu_images/image-1"), {
      id: "image-1",
      imageUrl: "https://example.com/menu.jpg",
      sortOrder: 1,
      createdAt: seededAt,
      updatedAt: seededAt,
    });

    batch.set(db.doc("restaurant_name_change_requests/request-1"), {
      userId: "owner-1",
      currentRestaurantName: "Approved Tacos",
      requestedRestaurantName: "Approved Taco Co.",
      status: "pending",
      createdAt: seededAt,
      updatedAt: seededAt,
    });

    batch.set(db.doc("user_profiles/customer-a"), {
      userId: "customer-a",
      email: "customer-a@example.com",
      displayName: "Customer A",
      contributionPoints: 5,
      lastContributionAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("user_profiles/customer-b"), {
      userId: "customer-b",
      email: "customer-b@example.com",
      displayName: "Customer B",
      updatedAt: seededAt,
    });
    batch.set(
      db.doc(
        "user_profiles/customer-a/local_expert_badge_celebrations/pizza_level2",
      ),
      {
        eventKey: "pizza_level2",
        expertTypeId: "pizza",
        displayName: "Pizza",
        level: "level2",
        kind: "levelUp",
        status: "pending",
        totalRestaurantCount: 5,
        localClusterRestaurantCount: 5,
        earnedAt: seededAt,
        createdAt: seededAt,
        updatedAt: seededAt,
      },
    );
    batch.set(db.doc("user_profiles/customer-a/favorite_restaurants/bs-1"), {
      userId: "customer-a",
      restaurantId: "bs-1",
      restaurantName: "BiteScore Pizza",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("user_profiles/customer-a/favorite_dishes/dish-1"), {
      userId: "customer-a",
      restaurantId: "bs-1",
      dishId: "dish-1",
      dishName: "Pizza Slice",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("user_profiles/customer-a/favorite_coupons/coupon-1"), {
      userId: "customer-a",
      couponId: "coupon-1",
      couponTitle: "Free Chips",
      restaurantName: "Approved Tacos",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(
      db.doc("customer_redemptions/customer-a/coupon_redemptions/coupon-1"),
      {
        couponId: "coupon-1",
        redeemedCount: 1,
        lastRedeemedAt: seededAt,
        updatedAt: seededAt,
      },
    );

    batch.set(db.doc("public_reviewer_profiles/customer-a"), {
      userId: "customer-a",
      publicDisplayName: "Customer A",
      fallbackUsername: "anon_customer_a",
      chosenUsername: "CustomerA",
      chosenUsernameNormalized: "customera",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("public_usernames/anon_customer_a"), {
      userId: "customer-a",
      username: "anon_customer_a",
      reservationType: "fallback",
      createdAt: seededAt,
      updatedAt: seededAt,
    });

    batch.set(db.doc("bitescore_restaurants/bs-1"), {
      id: "bs-1",
      name: "BiteScore Pizza",
      restaurantName: "BiteScore Pizza",
      normalizedName: "bitescore pizza",
      address: "1 Main St",
      streetAddress: "1 Main St",
      city: "Lecanto",
      state: "FL",
      zipCode: "34461",
      location: new firebase.firestore.GeoPoint(28.8517, -82.487),
      ownerUserId: "bitescore-owner",
      isClaimed: true,
      isActive: true,
      active: true,
      restaurantWriteRevision: 4,
      sharedMenuId: "menu-1",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("bitescore_dishes/dish-1"), {
      id: "dish-1",
      restaurantId: "bs-1",
      restaurantName: "BiteScore Pizza",
      name: "Pizza Slice",
      normalizedName: "pizza slice",
      category: "Pizza",
      isActive: true,
      imageCount: 0,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("dish_rating_aggregates/dish-1"), {
      dishId: "dish-1",
      restaurantId: "bs-1",
      overallBiteScore: 87,
      ratingCount: 1,
      updatedAt: seededAt,
    });
    batch.set(db.doc("dish_reviews/dish-1_customer-a"), {
      id: "dish-1_customer-a",
      dishId: "dish-1",
      restaurantId: "bs-1",
      userId: "customer-a",
      overallImpression: 8,
      overallBiteScore: 80,
      headline: "Solid slice",
      notes: "Good crust and sauce.",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("review_feedback_votes/dish-1_customer-a_customer-b"), {
      id: "dish-1_customer-a_customer-b",
      reviewId: "dish-1_customer-a",
      dishId: "dish-1",
      restaurantId: "bs-1",
      userId: "customer-b",
      voteType: "helpful",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("bitescore_dish_images/image-1"), {
      id: "image-1",
      dishId: "dish-1",
      restaurantId: "bs-1",
      uploadedByUserId: "customer-a",
      imageUrl: "https://example.com/dish.jpg",
      storagePath: "bitescore_dishes/dish-1/images/image-1.jpg",
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_menus/menu-1"), {
      restaurantName: "BiteScore Pizza",
      normalizedName: "bitescore pizza",
      normalizedAddressKey: "1-main-st-lecanto-fl-34461",
      bitescoreRestaurantId: "bs-1",
      createdByUserId: "bitescore-owner",
      linkStatus: "bitescore_only",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_menus/menu-1/menu_items/item-1"), {
      id: "item-1",
      name: "Pizza Slice",
      description: "Cheese slice",
      price: "3.50",
      category: "Pizza",
      sortOrder: 1,
      createdAt: seededAt,
      updatedAt: seededAt,
    });

    batch.set(db.doc("review_reports/review-report-1"), {
      id: "review-report-1",
      reviewId: "dish-1_customer-a",
      dishId: "dish-1",
      restaurantId: "bs-1",
      reportingUserId: "customer-b",
      reason: "spam",
      status: "pending",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_reports/restaurant-report-1"), {
      id: "restaurant-report-1",
      restaurantId: "bs-1",
      restaurantName: "BiteScore Pizza",
      reportingUserId: "customer-b",
      reason: "closed",
      status: "pending",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("dish_reports/dish-report-1"), {
      id: "dish-report-1",
      dishId: "dish-1",
      restaurantId: "bs-1",
      dishName: "Pizza Slice",
      reportingUserId: "customer-b",
      reason: "duplicate",
      status: "pending",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("duplicate_restaurant_reports/duplicate-report-1"), {
      id: "duplicate-report-1",
      restaurantId: "bs-1",
      restaurantName: "BiteScore Pizza",
      reportingUserId: "customer-b",
      reason: "duplicate",
      status: "pending",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("restaurant_claim_requests/claim-1"), {
      id: "claim-1",
      restaurantId: "bs-1",
      restaurantName: "BiteScore Pizza",
      requesterUserId: "customer-a",
      claimantName: "Customer A",
      email: "customer-a@example.com",
      phone: "555-0100",
      status: "pending",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("dish_edit_proposals/proposal-1"), {
      id: "proposal-1",
      type: "rename",
      restaurantId: "bs-1",
      targetDishId: "dish-1",
      proposedName: "Cheese Pizza Slice",
      userId: "customer-a",
      status: "pending",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("bitesaver_reports/bitesaver-report-1"), {
      reportType: "coupon",
      restaurantId: "owner-1",
      couponId: "coupon-1",
      reason: "expired",
      reporterUid: "customer-a",
      status: "open",
      createdAt: seededAt,
      updatedAt: seededAt,
    });

    batch.set(db.doc("restaurant_invites/invite-1"), {
      tokenHash: "token_hash_seed",
      type: "coupon_invite",
      side: "coupon",
      status: "active",
      restaurantName: "Invite Only",
      createdByUid: "admin-1",
      createdAt: seededAt,
      expiresAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    batch.set(db.doc("bitescore_contribution_point_ledger/entry-1"), {
      id: "entry-1",
      userId: "customer-a",
      pointsDelta: 1,
      actionType: "review",
      sourceKey: "review:dish-1_customer-a",
      description: "Review created",
      status: "active",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("proximity_push_requests/request-1"), {
      requestId: "request-1",
      installationId: "installation-1",
      couponId: "coupon-1",
      couponTitle: "Free Chips",
      restaurant: "Approved Tacos",
      status: "pending",
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    batch.set(db.doc("customer_device_installations/installation-1"), {
      installationId: "installation-1",
      authUid: "customer-a",
      fcmToken: "seed-token",
      proximityPushEnabled: true,
      notificationsPermissionStatus: "authorized",
      updatedAt: seededAt,
    });

    await batch.commit();
  });
}

test("public writes are denied by default", async () => {
  await assertFails(
    dbFor("unauthenticated").doc("public_write_attempts/doc-1").set({
      value: true,
    }),
  );
});

test("restaurant account root gets are private to the exact owner and Admin", async () => {
  await seedRuleTestDocuments([
    {
      documentPath: "restaurant_accounts/hidden-owner",
      data: {
        uid: "hidden-owner",
        restaurantName: "Hidden Restaurant",
        approvalStatus: "approved",
        couponPostingEnabled: true,
        adminHidden: true,
      },
    },
    {
      documentPath: "restaurant_accounts/posting-disabled-owner",
      data: {
        uid: "posting-disabled-owner",
        restaurantName: "Posting Disabled Restaurant",
        approvalStatus: "approved",
        couponPostingEnabled: false,
      },
    },
    {
      documentPath: "restaurant_accounts/rejected-owner",
      data: {
        uid: "rejected-owner",
        restaurantName: "Rejected Restaurant",
        approvalStatus: "rejected",
        couponPostingEnabled: false,
      },
    },
  ]);

  const rootPaths = [
    "restaurant_accounts/owner-1",
    "restaurant_accounts/pending-owner",
    "restaurant_accounts/hidden-owner",
    "restaurant_accounts/posting-disabled-owner",
    "restaurant_accounts/rejected-owner",
  ];
  for (const actor of ["unauthenticated", "customer"]) {
    for (const rootPath of rootPaths) {
      await assertFails(dbFor(actor).doc(rootPath).get());
    }
  }
  await assertFails(
    dbFor("wrongRestaurantOwner").doc("restaurant_accounts/owner-1").get(),
  );
  await assertSucceeds(
    dbFor("restaurantOwner").doc("restaurant_accounts/owner-1").get(),
  );
  for (const rootPath of rootPaths) {
    await assertSucceeds(dbFor("admin").doc(rootPath).get());
  }
});

test("public child content remains readable through internal parent checks", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const customerPaths = [
    `${accountPath}/coupons/coupon-1`,
    `${accountPath}/daily_specials/special-1`,
    `${accountPath}/menu_items/item-1`,
    `${accountPath}/menu_sections/section-1`,
    `${accountPath}/menu_images/image-1`,
  ];
  for (const actor of ["unauthenticated", "customer"]) {
    await assertFails(dbFor(actor).doc(accountPath).get());
    for (const childPath of customerPaths) {
      await assertSucceeds(dbFor(actor).doc(childPath).get());
    }
  }
  for (const actor of ["restaurantOwner", "admin"]) {
    await assertSucceeds(dbFor(actor).doc(accountPath).get());
    for (const childPath of customerPaths) {
      await assertSucceeds(dbFor(actor).doc(childPath).get());
    }
  }

  const db = dbFor("unauthenticated");
  await assertSucceeds(db.doc("bitescore_restaurants/bs-1").get());
  await assertSucceeds(db.doc("bitescore_dishes/dish-1").get());
  await assertSucceeds(db.doc("dish_rating_aggregates/dish-1").get());
  await assertSucceeds(db.doc("dish_reviews/dish-1_customer-a").get());
});

test("public restaurant projection gets require the exact current BiteSaver contract", async () => {
  const publicPath = "restaurant_search_index/public-current";
  const deniedPaths = [
    "restaurant_search_index/public-hidden",
    "restaurant_search_index/public-visible-malformed",
    "restaurant_search_index/public-visible-missing",
    "restaurant_search_index/stale-version-missing",
    "restaurant_search_index/stale-version-wrong",
    "restaurant_search_index/bitescore-current",
    "restaurant_search_index/wrong-entity",
  ];
  await seedRuleTestDocuments([
    {
      documentPath: publicPath,
      data: restaurantSearchIndexRuleData("public-current"),
    },
    {
      documentPath: deniedPaths[0],
      data: restaurantSearchIndexRuleData("public-hidden", {
        publicVisible: false,
      }),
    },
    {
      documentPath: deniedPaths[1],
      data: restaurantSearchIndexRuleData("public-visible-malformed", {
        publicVisible: "true",
      }),
    },
    {
      documentPath: deniedPaths[2],
      data: restaurantSearchIndexRuleData("public-visible-missing", {
        omittedFields: ["publicVisible"],
      }),
    },
    {
      documentPath: deniedPaths[3],
      data: restaurantSearchIndexRuleData("stale-version-missing", {
        omittedFields: ["publicProjectionVersion"],
        overrides: {privateCanary: "stale-private-index-data"},
      }),
    },
    {
      documentPath: deniedPaths[4],
      data: restaurantSearchIndexRuleData("stale-version-wrong", {
        overrides: {
          publicProjectionVersion: "bitestar.bitesaver-public-restaurant.v0",
          privateCanary: "wrong-version-private-index-data",
        },
      }),
    },
    {
      documentPath: deniedPaths[5],
      data: restaurantSearchIndexRuleData("bitescore-current", {
        overrides: {
          source: "biteScore",
          privateCanary: "bitescore-out-of-scope-data",
        },
      }),
    },
    {
      documentPath: deniedPaths[6],
      data: restaurantSearchIndexRuleData("wrong-entity", {
        overrides: {entityType: "dish"},
      }),
    },
  ]);

  for (const actorName of ["unauthenticated", "customer"]) {
    const db = dbFor(actorName);
    const publicSnapshot = await assertSucceeds(db.doc(publicPath).get());
    assert.equal(publicSnapshot.exists, true);
    assert.equal(publicSnapshot.data().displayName, "Approved Tacos");
    assert.equal(publicSnapshot.data().phone, "555-0101");
    for (const field of [
      "uid",
      "email",
      "phoneNumber",
      "emailVerified",
      "couponApplicationSubmitted",
      "approvalStatus",
      "approvedAt",
      "approvedByUid",
      "adminHidden",
      "couponPostingEnabled",
      "subscriptionStatus",
      "subscriptionEndsAt",
      "cancelAtPeriodEnd",
      "trialEndsAt",
      "billingPlanName",
      "hasUsedTrial",
      "stripeCustomerId",
      "stripeSubscriptionId",
      "stripePriceId",
      "stripeCheckoutSessionId",
      "inviteId",
      "inviteRestaurantKey",
      "inviteTokenHash",
      "tokenHash",
      "profileRequestId",
      "profileRequestFingerprint",
      "privateCanary",
      "unknownLegacyField",
    ]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(publicSnapshot.data(), field),
        false,
        field,
      );
    }
    for (const deniedPath of deniedPaths) {
      await assertFails(db.doc(deniedPath).get());
    }
  }

  const adminDb = dbFor("admin");
  for (const documentPath of [publicPath, ...deniedPaths]) {
    await assertSucceeds(adminDb.doc(documentPath).get());
  }
  await assertSucceeds(
    dbFor("restaurantOwner").doc("restaurant_accounts/owner-1").get(),
  );
  await assertSucceeds(
    adminDb.doc("restaurant_accounts/pending-owner").get(),
  );
});

test("public restaurant projection lists must constrain all four contract gates", async () => {
  await seedRuleTestDocuments([
    {
      documentPath: "restaurant_search_index/public-current",
      data: restaurantSearchIndexRuleData("public-current"),
    },
    {
      documentPath: "restaurant_search_index/public-hidden",
      data: restaurantSearchIndexRuleData("public-hidden", {
        publicVisible: false,
      }),
    },
    {
      documentPath: "restaurant_search_index/stale-version-missing",
      data: restaurantSearchIndexRuleData("stale-version-missing", {
        omittedFields: ["publicProjectionVersion"],
        overrides: {privateCanary: "stale-private-index-data"},
      }),
    },
    {
      documentPath: "restaurant_search_index/bitescore-current",
      data: restaurantSearchIndexRuleData("bitescore-current", {
        overrides: {source: "biteScore"},
      }),
    },
  ]);

  for (const actorName of ["unauthenticated", "customer"]) {
    const collection = dbFor(actorName).collection("restaurant_search_index");
    const publicQuery = collection
      .where("source", "==", "biteSaver")
      .where("entityType", "==", "restaurant")
      .where(
        "publicProjectionVersion",
        "==",
        biteSaverRestaurantPublicProjectionVersion,
      )
      .where("publicVisible", "==", true);
    const publicSnapshot = await assertSucceeds(publicQuery.get());
    assert.equal(publicSnapshot.size, 1);
    assert.equal(publicSnapshot.docs[0].id, "public-current");
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        publicSnapshot.docs[0].data(),
        "privateCanary",
      ),
      false,
    );

    const routeSnapshot = await assertSucceeds(
      publicQuery.where("sourceDocumentId", "==", "owner-1").limit(1).get(),
    );
    assert.equal(routeSnapshot.size, 1);
    assert.equal(routeSnapshot.docs[0].data().sourceDocumentId, "owner-1");

    await assertFails(collection.get());
    await assertFails(collection.where("publicVisible", "==", true).get());
    await assertFails(
      collection
        .where("source", "==", "biteSaver")
        .where("entityType", "==", "restaurant")
        .where(
          "publicProjectionVersion",
          "==",
          biteSaverRestaurantPublicProjectionVersion,
        )
        .get(),
    );
    await assertFails(
      collection
        .where("source", "==", "biteSaver")
        .where("entityType", "==", "restaurant")
        .where("publicVisible", "==", true)
        .get(),
    );
    await assertFails(
      collection
        .where("source", "==", "biteSaver")
        .where(
          "publicProjectionVersion",
          "==",
          biteSaverRestaurantPublicProjectionVersion,
        )
        .where("publicVisible", "==", true)
        .get(),
    );
    await assertFails(
      collection
        .where("entityType", "==", "restaurant")
        .where(
          "publicProjectionVersion",
          "==",
          biteSaverRestaurantPublicProjectionVersion,
        )
        .where("publicVisible", "==", true)
        .get(),
    );
  }

  const adminSnapshot = await assertSucceeds(
    dbFor("admin").collection("restaurant_search_index").get(),
  );
  assert.equal(adminSnapshot.size, 4);
});

test("search indexes remain server-written and non-restaurant artifacts stay private", async () => {
  const publicPath = "restaurant_search_index/public-current";
  const privatePaths = [
    "dish_search_index/private-dish",
    "bitesaver_offer_index/private-offer",
    "private_search_index_jobs/private-job",
    "private_search_index_jobs/private-job/steps/private-step",
  ];
  await seedRuleTestDocuments([
    {
      documentPath: publicPath,
      data: restaurantSearchIndexRuleData("public-current"),
    },
    ...privatePaths.map((documentPath) => ({
      documentPath,
      data: {privateCanary: "server-only-search-data"},
    })),
  ]);

  for (const actorName of [
    "unauthenticated",
    "customer",
    "restaurantOwner",
    "admin",
  ]) {
    const db = dbFor(actorName);
    await assertFails(
      db.doc("restaurant_search_index/client-created").set({
        source: "biteSaver",
        entityType: "restaurant",
        publicProjectionVersion: biteSaverRestaurantPublicProjectionVersion,
        publicVisible: true,
      }),
    );
    await assertFails(db.doc(publicPath).update({restaurantName: "Forged"}));
    await assertFails(db.doc(publicPath).delete());
    for (const privatePath of privatePaths) {
      await assertFails(db.doc(privatePath).get());
      await assertFails(db.doc(privatePath).update({state: "forged"}));
      await assertFails(db.doc(privatePath).delete());
    }
  }

  for (const actorName of ["customer", "admin"]) {
    const db = dbFor(actorName);
    await assertFails(db.collection("dish_search_index").get());
    await assertFails(db.collection("bitesaver_offer_index").get());
    await assertFails(db.collection("private_search_index_jobs").get());
  }
});

test("BiteSaver Admin Hide is narrow, owner-safe, and blocks customer content", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const customerPaths = [
    `${accountPath}/coupons/coupon-1`,
    `${accountPath}/daily_specials/special-1`,
    `${accountPath}/menu_images/image-1`,
    `${accountPath}/menu_items/item-1`,
    `${accountPath}/menu_sections/section-1`,
  ];
  const adminRef = dbFor("admin").doc(accountPath);

  for (const actor of ["restaurantOwner", "wrongRestaurantOwner", "customer"]) {
    await assertFails(dbFor(actor).doc(accountPath).update({
      adminHidden: true,
      updatedAt: serverTimestamp(),
    }));
  }
  await assertFails(adminRef.update({adminHidden: true}));
  await assertFails(adminRef.update({
    adminHidden: "true",
    updatedAt: serverTimestamp(),
  }));
  await assertFails(adminRef.update({
    adminHidden: true,
    bio: "Combined unrelated mutation",
    updatedAt: serverTimestamp(),
  }));

  await assertSucceeds(adminRef.update({
    adminHidden: true,
    updatedAt: serverTimestamp(),
  }));
  const hidden = await assertSucceeds(adminRef.get());
  assert.equal(hidden.data().adminHidden, true);
  assert.equal(hidden.data().couponPostingEnabled, true);
  assert.equal(hidden.data().stripeCustomerId, "cus_seed_owner_1");
  assert.equal(hidden.data().stripeSubscriptionId, "sub_seed_owner_1");

  await assertFails(dbFor("customer").doc(accountPath).get());
  for (const path of customerPaths) {
    await assertFails(dbFor("customer").doc(path).get());
    await assertSucceeds(dbFor("restaurantOwner").doc(path).get());
    await assertSucceeds(dbFor("admin").doc(path).get());
  }
  await assertSucceeds(
    dbFor("restaurantOwner").doc(accountPath).update({
      bio: "Owner profile access remains available while hidden",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    dbFor("restaurantOwner").doc(`${accountPath}/coupons/coupon-1`).update({
      title: "Owner-authored hidden coupon",
    }),
  );
});

test("BiteSaver Admin Restore removes only the veto and preserves posting gates", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const adminRef = dbFor("admin").doc(accountPath);
  await assertSucceeds(adminRef.update({
    adminHidden: true,
    updatedAt: serverTimestamp(),
  }));

  await assertFails(
    dbFor("restaurantOwner").doc(accountPath).update({
      adminHidden: false,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(adminRef.update({
    adminHidden: false,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(dbFor("customer").doc(accountPath).get());
  await assertSucceeds(
    dbFor("customer").doc(`${accountPath}/coupons/coupon-1`).get(),
  );
  const restored = await assertSucceeds(adminRef.get());
  assert.equal(restored.data().adminHidden, false);
  assert.equal(restored.data().couponPostingEnabled, true);
  assert.equal(restored.data().subscriptionStatus, "active");

  await updateRuleTestDocument(accountPath, {couponPostingEnabled: false});
  await assertFails(dbFor("customer").doc(accountPath).get());
  await assertFails(
    dbFor("customer").doc(`${accountPath}/coupons/coupon-1`).get(),
  );
  await assertSucceeds(dbFor("restaurantOwner").doc(accountPath).get());
  await assertSucceeds(dbFor("admin").doc(accountPath).get());
});

test("public can read review feedback votes for dish detail trust summaries", async () => {
  const snapshot = await assertSucceeds(
    dbFor("unauthenticated")
      .collection("review_feedback_votes")
      .where("reviewId", "in", ["dish-1_customer-a"])
      .get(),
  );

  assert.equal(snapshot.size, 1);
  assert.equal(snapshot.docs[0].data().voteType, "helpful");
});

test("users can read/update their own user profile safe fields", async () => {
  const db = dbFor("customer");
  await assertSucceeds(db.doc("user_profiles/customer-a").get());
  await assertSucceeds(
    db.doc("user_profiles/customer-a").set(
      {
        userId: "customer-a",
        displayName: "Updated Customer A",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("users cannot read another user's private profile", async () => {
  await assertFails(dbFor("wrongCustomer").doc("user_profiles/customer-a").get());
});

test("users cannot write another user's private profile", async () => {
  await assertFails(
    dbFor("wrongCustomer").doc("user_profiles/customer-a").set(
      {
        userId: "customer-a",
        displayName: "Forged",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("users can acknowledge their own Local Expert badge celebrations", async () => {
  await assertSucceeds(
    dbFor("customer")
      .doc("user_profiles/customer-a/local_expert_badge_celebrations/pizza_level2")
      .set(
        {
          status: "celebrated",
          celebratedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
  );
});

test("users cannot modify Local Expert badge award details", async () => {
  await assertFails(
    dbFor("customer")
      .doc("user_profiles/customer-a/local_expert_badge_celebrations/pizza_level2")
      .set(
        {
          displayName: "Forged BBQ",
          level: "level3",
          status: "celebrated",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
  );
});

test("users cannot acknowledge another user's Local Expert badge celebration", async () => {
  await assertFails(
    dbFor("wrongCustomer")
      .doc("user_profiles/customer-a/local_expert_badge_celebrations/pizza_level2")
      .set(
        {
          status: "celebrated",
          celebratedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
  );
});

test("clients cannot create fake Local Expert badge celebrations", async () => {
  await assertFails(
    dbFor("customer")
      .doc("user_profiles/customer-a/local_expert_badge_celebrations/forged_level3")
      .set({
        eventKey: "forged_level3",
        expertTypeId: "bbq",
        displayName: "BBQ",
        level: "level3",
        kind: "levelUp",
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
  );
});

test("users can create/update their own public reviewer profile safe fields", async () => {
  const db = dbFor("wrongCustomer");
  const profileRef = db.doc("public_reviewer_profiles/customer-b");

  await assertSucceeds(
    profileRef.set({
      userId: "customer-b",
      publicDisplayName: "Slice Queen",
      fallbackUsername: "anon_customer_b",
      chosenUsername: "SliceQueen",
      chosenUsernameNormalized: "slicequeen",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  await assertSucceeds(
    profileRef.set(
      {
        publicDisplayName: "Slice Queen Updated",
        chosenUsername: "SliceQueenUpdated",
        chosenUsernameNormalized: "slicequeenupdated",
        userId: "customer-b",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("users cannot write phoneNumber to public reviewer profiles", async () => {
  await assertFails(
    dbFor("wrongCustomer").doc("public_reviewer_profiles/customer-b").set({
      userId: "customer-b",
      publicDisplayName: "Customer B",
      fallbackUsername: "anon_customer_b",
      phoneNumber: "+15550100",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  await assertFails(
    dbFor("customer").doc("public_reviewer_profiles/customer-a").set(
      {
        userId: "customer-a",
        phoneNumber: "+15550100",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("users cannot write another user's public reviewer profile", async () => {
  await assertFails(
    dbFor("wrongCustomer").doc("public_reviewer_profiles/customer-a").set(
      {
        userId: "customer-a",
        publicDisplayName: "Forged Public Name",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("users cannot forge userId on their public reviewer profile", async () => {
  await assertFails(
    dbFor("customer").doc("public_reviewer_profiles/customer-a").set(
      {
        userId: "customer-b",
        publicDisplayName: "Forged User",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("public can read public reviewer profiles", async () => {
  const snapshot = await assertSucceeds(
    dbFor("unauthenticated").doc("public_reviewer_profiles/customer-a").get(),
  );
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.data().chosenUsernameNormalized, "customera");
});

test("username reservations remain owner-managed", async () => {
  const db = dbFor("customer");
  await assertSucceeds(
    db.doc("public_usernames/customer_a_custom").set({
      username: "customer_a_custom",
      userId: "customer-a",
      reservationType: "custom",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  await assertFails(
    dbFor("wrongCustomer").doc("public_usernames/anon_customer_a").set(
      {
        username: "anon_customer_a",
        userId: "customer-b",
        reservationType: "custom",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("reviewer identity setup and review creation are allowed for verified users", async () => {
  const db = dbFor("customer");

  await assertSucceeds(
    db.runTransaction(async (transaction) => {
      transaction.set(db.doc("public_usernames/customer_a_reviews"), {
        username: "customer_a_reviews",
        userId: "customer-a",
        reservationType: "custom",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.set(
        db.doc("public_reviewer_profiles/customer-a"),
        {
          userId: "customer-a",
          publicDisplayName: "Customer A Reviews",
          fallbackUsername: "anon_customer_a",
          chosenUsername: "CustomerAReviews",
          chosenUsernameNormalized: "customer_a_reviews",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }),
  );

  await assertSucceeds(
    db.doc("dish_reviews/dish-1_customer-a_identity").set({
      id: "dish-1_customer-a_identity",
      dishId: "dish-1",
      restaurantId: "bs-1",
      userId: "customer-a",
      overallImpression: 9,
      overallBiteScore: 90,
      headline: "Great after identity setup",
      notes: "Identity setup did not block this review.",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("customers can manage their own favorites and redemptions", async () => {
  const db = dbFor("customer");
  await assertSucceeds(
    db.doc("user_profiles/customer-a/favorite_restaurants/bs-2").set({
      userId: "customer-a",
      restaurantId: "bs-2",
      restaurantName: "Saved Restaurant",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    db.doc("customer_redemptions/customer-a/coupon_redemptions/coupon-2").set(
      {
        couponId: "coupon-2",
        redeemedCount: firebase.firestore.FieldValue.increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("customers cannot manage another user's favorites", async () => {
  await assertFails(
    dbFor("wrongCustomer")
      .doc("user_profiles/customer-a/favorite_restaurants/bs-1")
      .delete(),
  );
});

test("customers cannot manage another user's redemptions", async () => {
  await assertFails(
    dbFor("wrongCustomer")
      .doc("customer_redemptions/customer-a/coupon_redemptions/coupon-1")
      .set({ couponId: "coupon-1", updatedAt: serverTimestamp() }, { merge: true }),
  );
});

test("restaurant owners can manage their own approved/subscribed content", async () => {
  const db = dbFor("restaurantOwner");
  await assertSucceeds(
    db.doc("restaurant_accounts/owner-1/coupons/coupon-2").set({
      id: "coupon-2",
      restaurant: "Approved Tacos",
      title: "Free Salsa",
      usageRule: "Once per customer",
      startTime: new Date("2026-01-15T00:00:00.000Z"),
      endTime: new Date("2026-02-15T00:00:00.000Z"),
      couponNumber: "1002",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    db.doc("restaurant_accounts/owner-1/daily_specials/special-2").set({
      id: "special-2",
      restaurantId: "owner-1",
      ownerUid: "owner-1",
      title: "Dinner Special",
      isActive: true,
      availabilityMode: "recurring",
      allDay: true,
      hideWhenUnavailable: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    db.doc("restaurant_accounts/owner-1/menu_items/item-2").set({
      id: "item-2",
      name: "Burrito",
      description: "Bean burrito",
      price: "8.00",
      category: "Entrees",
      sortOrder: 2,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("exact true posting flag preserves active, trialing, and scheduled-cancellation access", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const cases = [
    { label: "active", subscriptionStatus: "active" },
    { label: "trialing", subscriptionStatus: "trialing" },
    {
      label: "scheduled-cancellation",
      subscriptionStatus: "active",
      cancelAtPeriodEnd: true,
      subscriptionCurrentPeriodEnd: new Date("2026-03-01T00:00:00.000Z"),
    },
  ];

  for (const [index, projection] of cases.entries()) {
    await updateRuleTestDocument(accountPath, {
      approvalStatus: "approved",
      subscriptionStatus: projection.subscriptionStatus,
      couponPostingEnabled: true,
      cancelAtPeriodEnd: projection.cancelAtPeriodEnd ?? false,
      subscriptionCurrentPeriodEnd:
        projection.subscriptionCurrentPeriodEnd ??
        firebase.firestore.FieldValue.delete(),
    });

    const couponId = `posting-enabled-${projection.label}`;
    const ownerRef = dbFor("restaurantOwner").doc(
      `${accountPath}/coupons/${couponId}`,
    );
    await assertSucceeds(
      ownerRef.set(
        restaurantCouponWriteData(couponId, {
          couponNumber: `${1100 + index}`,
        }),
      ),
    );
    await assertSucceeds(
      ownerRef.update({
        title: `Updated ${projection.label}`,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(dbFor("customer").doc(accountPath).get());
    await assertSucceeds(dbFor("customer").doc(ownerRef.path).get());
  }
});

test("false, missing, malformed, and unapproved posting projections fail closed", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const existingCouponPath = `${accountPath}/coupons/coupon-1`;
  const existingSpecialPath = `${accountPath}/daily_specials/special-1`;
  const existingMenuPath = `${accountPath}/menu_items/item-1`;
  const cases = [
    { label: "active-false", subscriptionStatus: "active", flag: false },
    { label: "trialing-false", subscriptionStatus: "trialing", flag: false },
    { label: "past-due", subscriptionStatus: "past_due", flag: false },
    { label: "unpaid", subscriptionStatus: "unpaid", flag: false },
    { label: "incomplete", subscriptionStatus: "incomplete", flag: false },
    { label: "paused", subscriptionStatus: "paused", flag: false },
    { label: "canceled", subscriptionStatus: "canceled", flag: false },
    { label: "missing", subscriptionStatus: "active", missingFlag: true },
    { label: "string", subscriptionStatus: "active", flag: "true" },
    { label: "number", subscriptionStatus: "active", flag: 1 },
    { label: "null", subscriptionStatus: "active", flag: null },
    {
      label: "pending-true",
      subscriptionStatus: "active",
      flag: true,
      approvalStatus: "pending",
    },
  ];

  for (const projection of cases) {
    await updateRuleTestDocument(accountPath, {
      approvalStatus: projection.approvalStatus ?? "approved",
      subscriptionStatus: projection.subscriptionStatus,
      couponPostingEnabled: projection.missingFlag
        ? firebase.firestore.FieldValue.delete()
        : projection.flag,
    });

    const newCouponPath = `${accountPath}/coupons/blocked-${projection.label}`;
    await assertFails(
      dbFor("restaurantOwner")
        .doc(newCouponPath)
        .set(restaurantCouponWriteData(`blocked-${projection.label}`)),
    );
    assert.equal(
      (await assertSucceeds(dbFor("admin").doc(newCouponPath).get())).exists,
      false,
    );

    const before = await assertSucceeds(
      dbFor("admin").doc(existingCouponPath).get(),
    );
    await assertFails(
      dbFor("restaurantOwner").doc(existingCouponPath).update({
        title: `Blocked ${projection.label}`,
        endTime: new Date("2027-01-01T00:00:00.000Z"),
        isActive: true,
        updatedAt: serverTimestamp(),
      }),
    );
    const after = await assertSucceeds(
      dbFor("admin").doc(existingCouponPath).get(),
    );
    assert.equal(after.data().title, before.data().title);
    assert.equal(
      after.data().endTime.toMillis(),
      before.data().endTime.toMillis(),
    );
    assert.equal(after.data().isActive, before.data().isActive);

    for (const path of [
      accountPath,
      existingCouponPath,
      existingSpecialPath,
    ]) {
      await assertFails(dbFor("customer").doc(path).get());
      await assertSucceeds(dbFor("restaurantOwner").doc(path).get());
      await assertSucceeds(dbFor("admin").doc(path).get());
    }

    if ((projection.approvalStatus ?? "approved") === "approved") {
      await assertSucceeds(dbFor("customer").doc(existingMenuPath).get());
    } else {
      await assertFails(dbFor("customer").doc(existingMenuPath).get());
    }
  }
});

test("restaurant account root lists and queries are Admin-only", async () => {
  await seedRuleTestDocuments([
    {
      documentPath: "restaurant_accounts/hidden-approved-owner",
      data: {
        uid: "hidden-approved-owner",
        restaurantName: "Hidden Approved Restaurant",
        approvalStatus: "approved",
        couponPostingEnabled: true,
        adminHidden: true,
      },
    },
  ]);

  for (const actor of ["unauthenticated", "customer", "restaurantOwner"]) {
    const db = dbFor(actor);
    await assertFails(db.collection("restaurant_accounts").get());
    await assertFails(
      db.collection("restaurant_accounts")
        .where("approvalStatus", "==", "approved")
        .where("couponPostingEnabled", "==", true)
        .get(),
    );
    await assertFails(
      db.collection("restaurant_accounts")
        .where("uid", "==", "owner-1")
        .get(),
    );
  }

  const adminDb = dbFor("admin");
  const adminAll = await assertSucceeds(
    adminDb.collection("restaurant_accounts").get(),
  );
  assert.equal(adminAll.size, 3);
  const adminApproved = await assertSucceeds(
    adminDb.collection("restaurant_accounts")
      .where("approvalStatus", "==", "approved")
      .get(),
  );
  assert.deepEqual(
    adminApproved.docs.map((document) => document.id).sort(),
    ["hidden-approved-owner", "owner-1"],
  );
});

test("inactive owners can delete only their coupons without broadening other deletes", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const couponPath = `${accountPath}/coupons/coupon-1`;
  const specialPath = `${accountPath}/daily_specials/special-1`;
  const menuPath = `${accountPath}/menu_items/item-1`;
  const reservationPath = `${accountPath}/coupon_number_reservations/1001`;
  await updateRuleTestDocument(accountPath, {
    subscriptionStatus: "canceled",
    couponPostingEnabled: false,
  });
  await seedRuleTestDocuments([
    {
      documentPath: reservationPath,
      data: {
        couponId: "coupon-1",
        couponNumber: "1001",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
  ]);

  for (const actor of ["wrongRestaurantOwner", "customer"]) {
    await assertFails(dbFor(actor).doc(couponPath).delete());
    assert.equal(
      (await assertSucceeds(dbFor("admin").doc(couponPath).get())).exists,
      true,
    );
  }

  await assertSucceeds(dbFor("restaurantOwner").doc(couponPath).get());
  await assertSucceeds(dbFor("restaurantOwner").doc(couponPath).delete());
  await assertSucceeds(dbFor("restaurantOwner").doc(couponPath).delete());
  assert.equal(
    (await assertSucceeds(dbFor("admin").doc(couponPath).get())).exists,
    false,
  );

  for (const path of [accountPath, specialPath, menuPath, reservationPath]) {
    assert.equal(
      (await assertSucceeds(dbFor("admin").doc(path).get())).exists,
      true,
    );
  }
  for (const path of [specialPath, menuPath, reservationPath]) {
    await assertFails(dbFor("restaurantOwner").doc(path).delete());
    assert.equal(
      (await assertSucceeds(dbFor("admin").doc(path).get())).exists,
      true,
    );
  }
});

test("inactive-owner service-shaped coupon deletion is atomic and retry-safe", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const couponPath = `${accountPath}/coupons/coupon-1`;
  await updateRuleTestDocument(accountPath, {
    subscriptionStatus: "active",
    couponPostingEnabled: false,
  });

  const adminDb = dbFor("admin");
  const accountBefore = await assertSucceeds(adminDb.doc(accountPath).get());
  const updatedAtBefore = accountBefore.data().updatedAt;
  const wrongOwnerDb = dbFor("wrongRestaurantOwner");
  const rejectedBatch = wrongOwnerDb.batch();
  rejectedBatch.delete(wrongOwnerDb.doc(couponPath));
  rejectedBatch.update(wrongOwnerDb.doc(accountPath), {
    updatedAt: new Date("2026-12-01T00:00:00.000Z"),
  });
  await assertFails(rejectedBatch.commit());

  assert.equal(
    (await assertSucceeds(adminDb.doc(couponPath).get())).exists,
    true,
  );
  const accountAfterRejectedBatch = await assertSucceeds(
    adminDb.doc(accountPath).get(),
  );
  assert.equal(
    accountAfterRejectedBatch.data().updatedAt.toMillis(),
    updatedAtBefore.toMillis(),
  );

  const ownerDb = dbFor("restaurantOwner");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const deleteBatch = ownerDb.batch();
    deleteBatch.delete(ownerDb.doc(couponPath));
    deleteBatch.update(ownerDb.doc(accountPath), {
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(deleteBatch.commit());
  }

  assert.equal(
    (await assertSucceeds(adminDb.doc(couponPath).get())).exists,
    false,
  );
  assert.equal(
    (await assertSucceeds(adminDb.doc(accountPath).get())).exists,
    true,
  );
});

test("inactive owners cannot create or update daily specials or menu content", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  await updateRuleTestDocument(accountPath, {
    subscriptionStatus: "active",
    couponPostingEnabled: false,
  });

  const blockedSpecialPath = `${accountPath}/daily_specials/blocked-special`;
  await assertFails(
    dbFor("restaurantOwner")
      .doc(blockedSpecialPath)
      .set(restaurantDailySpecialWriteData("blocked-special")),
  );
  await assertFails(
    dbFor("restaurantOwner")
      .doc(`${accountPath}/daily_specials/special-1`)
      .update({title: "Blocked special edit", updatedAt: serverTimestamp()}),
  );
  await assertFails(
    dbFor("restaurantOwner").doc(`${accountPath}/menu_items/blocked-item`).set({
      id: "blocked-item",
      name: "Blocked item",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("restaurantOwner").doc(`${accountPath}/menu_items/item-1`).update({
      name: "Blocked menu edit",
      updatedAt: serverTimestamp(),
    }),
  );

  assert.equal(
    (await assertSucceeds(dbFor("admin").doc(blockedSpecialPath).get())).exists,
    false,
  );
  assert.equal(
    (
      await assertSucceeds(
        dbFor("admin").doc(`${accountPath}/daily_specials/special-1`).get(),
      )
    ).data().title,
    "Lunch Special",
  );
  assert.equal(
    (
      await assertSucceeds(
        dbFor("admin").doc(`${accountPath}/menu_items/item-1`).get(),
      )
    ).data().name,
    "Taco",
  );
});

test("admin coupon moderation remains available for inactive restaurants", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const couponId = "admin-inactive-coupon";
  const couponPath = `${accountPath}/coupons/${couponId}`;
  await updateRuleTestDocument(accountPath, {
    subscriptionStatus: "active",
    couponPostingEnabled: false,
  });

  const adminRef = dbFor("admin").doc(couponPath);
  await assertSucceeds(
    adminRef.set(
      restaurantCouponWriteData(couponId, {couponNumber: "1200"}),
    ),
  );
  await assertSucceeds(
    adminRef.update({title: "Admin moderated", updatedAt: serverTimestamp()}),
  );
  assert.equal(
    (await assertSucceeds(adminRef.get())).data().title,
    "Admin moderated",
  );
  await assertSucceeds(adminRef.delete());
  assert.equal((await assertSucceeds(adminRef.get())).exists, false);
});

test("owner coupon deletion requires the parent account while admin moderation does not", async () => {
  const accountPath = "restaurant_accounts/owner-1";
  const couponPath = `${accountPath}/coupons/coupon-1`;
  await deleteRuleTestDocuments([accountPath]);

  await assertFails(dbFor("restaurantOwner").doc(couponPath).delete());
  assert.equal(
    (await assertSucceeds(dbFor("admin").doc(couponPath).get())).exists,
    true,
  );
  await assertSucceeds(dbFor("admin").doc(couponPath).delete());
  assert.equal(
    (await assertSucceeds(dbFor("admin").doc(couponPath).get())).exists,
    false,
  );
});

test("wrong restaurant owners cannot manage another owner's content", async () => {
  await assertFails(
    dbFor("wrongRestaurantOwner")
      .doc("restaurant_accounts/owner-1/coupons/coupon-2")
      .set({
        id: "coupon-2",
        restaurant: "Approved Tacos",
        title: "Forged Coupon",
        usageRule: "Unlimited",
        startTime: new Date("2026-01-15T00:00:00.000Z"),
        endTime: new Date("2026-02-15T00:00:00.000Z"),
        couponNumber: "9999",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }),
  );
});

test("restaurant account root deletion is denied to every client role", async () => {
  const accountPath = "restaurant_accounts/owner-1";

  for (const actor of [
    "unauthenticated",
    "customer",
    "restaurantOwner",
    "wrongRestaurantOwner",
    "admin",
  ]) {
    await assertFails(dbFor(actor).doc(accountPath).delete());
  }

  const account = await assertSucceeds(
    dbFor("restaurantOwner").doc(accountPath).get(),
  );
  assert.equal(account.exists, true);
});

test("restaurant root reads isolate owners while update policy stays unchanged", async () => {
  const accountPath = "restaurant_accounts/owner-1";

  for (const actor of ["restaurantOwner", "admin"]) {
    const account = await assertSucceeds(dbFor(actor).doc(accountPath).get());
    assert.equal(account.exists, true);
  }
  for (const actor of ["unauthenticated", "customer", "wrongRestaurantOwner"]) {
    await assertFails(dbFor(actor).doc(accountPath).get());
  }

  await assertSucceeds(
    dbFor("restaurantOwner").doc(accountPath).update({
      bio: "Owner-updated profile",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("wrongRestaurantOwner").doc(accountPath).update({
      bio: "Forged profile",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    dbFor("admin").doc(accountPath).update({
      bio: "Admin-reviewed profile",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("permanent catalog binding fields are writable only by trusted server code", async () => {
  const bindingId = "A".repeat(43);
  const accountRef = dbFor("restaurantOwner").doc(
    "restaurant_accounts/owner-1",
  );
  const biteScoreRef = dbFor("biteScoreOwner").doc(
    "bitescore_restaurants/bs-1",
  );

  await assertFails(
    dbFor("customer").doc("restaurant_accounts/customer-a").set({
      uid: "customer-a",
      restaurantName: "Customer Forged Binding Cafe",
      approvalStatus: "pending",
      biteScoreCatalogRestaurantId: "bs-1",
      biteSaverCatalogBindingId: bindingId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(accountRef.set(
    {
      biteScoreCatalogRestaurantId: "bs-1",
      biteSaverCatalogBindingId: bindingId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ));
  await assertFails(dbFor("admin").doc(accountRef.path).set(
    {
      biteScoreCatalogRestaurantId: "bs-1",
      biteSaverCatalogBindingId: bindingId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ));
  await assertFails(biteScoreRef.set(
    {
      biteSaverCatalogBindingId: bindingId,
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ));
  await assertFails(dbFor("admin").doc(biteScoreRef.path).set(
    {
      biteSaverCatalogBindingId: bindingId,
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ));
  await assertFails(
    dbFor("customer").doc("bitescore_restaurants/new-bound-restaurant").set({
      ...biteScoreRestaurantCreateData({ id: "new-bound-restaurant" }),
      biteSaverCatalogBindingId: bindingId,
    }),
  );

  await updateRuleTestDocument("restaurant_accounts/owner-1", {
    biteScoreCatalogRestaurantId: "bs-1",
    biteSaverCatalogBindingId: bindingId,
  });
  await updateRuleTestDocument("bitescore_restaurants/bs-1", {
    biteSaverCatalogBindingId: bindingId,
  });

  await assertSucceeds(accountRef.set(
    { bio: "Binding-safe owner edit", updatedAt: serverTimestamp() },
    { merge: true },
  ));
  await assertSucceeds(dbFor("admin").doc(accountRef.path).set(
    { adminHidden: true, updatedAt: serverTimestamp() },
    { merge: true },
  ));
  await assertSucceeds(biteScoreRef.set(
    {
      bio: "Binding-safe BiteScore owner edit",
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ));
  await assertSucceeds(dbFor("admin").doc(biteScoreRef.path).set(
    {
      isActive: false,
      active: false,
      restaurantWriteRevision: 6,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ));
});

test("coupon deletion remains available to the owner and admin only", async () => {
  const couponPath = "restaurant_accounts/owner-1/coupons/coupon-1";
  const ownerCoupon = await assertSucceeds(
    dbFor("restaurantOwner").doc(couponPath).get(),
  );

  await assertFails(dbFor("wrongRestaurantOwner").doc(couponPath).delete());
  await assertSucceeds(dbFor("restaurantOwner").doc(couponPath).delete());

  await seedRuleTestDocuments([
    {documentPath: couponPath, data: ownerCoupon.data()},
  ]);
  await assertSucceeds(dbFor("admin").doc(couponPath).delete());
});

test("restaurant owners can update their own safe public profile fields", async () => {
  await assertSucceeds(
    dbFor("restaurantOwner").doc("restaurant_accounts/owner-1").set(
      {
        bio: "Family-owned taco counter with fresh salsa.",
        mainImageUrl: "https://example.com/approved-tacos.jpg",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("wrong restaurant owners cannot update another owner's public profile fields", async () => {
  await assertFails(
    dbFor("wrongRestaurantOwner").doc("restaurant_accounts/owner-1").set(
      {
        bio: "Forged profile",
        mainImageUrl: "https://example.com/forged.jpg",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("restaurant owners can update their own BiteSaver menu-routing fields", async () => {
  const db = dbFor("restaurantOwner");
  const accountRef = db.doc("restaurant_accounts/owner-1");

  await assertSucceeds(
    accountRef.set(
      {
        menuSourceSide: "biteScore",
        linkedBiteScoreRestaurantId: "bs-1",
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "owner-1",
      },
      { merge: true },
    ),
  );

  await assertSucceeds(
    accountRef.set(
      {
        menuSourceSide: "biteSaver",
        linkedBiteScoreRestaurantId: firebase.firestore.FieldValue.delete(),
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "owner-1",
      },
      { merge: true },
    ),
  );
});

test("wrong restaurant owners cannot update BiteSaver menu-routing fields", async () => {
  await assertFails(
    dbFor("wrongRestaurantOwner").doc("restaurant_accounts/owner-1").set(
      {
        menuSourceSide: "biteScore",
        linkedBiteScoreRestaurantId: "bs-1",
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "owner-2",
      },
      { merge: true },
    ),
  );
});

test("restaurant owners cannot combine menu-routing updates with protected fields", async () => {
  await assertFails(
    dbFor("restaurantOwner").doc("restaurant_accounts/owner-1").set(
      {
        menuSourceSide: "biteScore",
        linkedBiteScoreRestaurantId: "bs-1",
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "owner-1",
        stripeCustomerId: "cus_forged",
        subscriptionStatus: "active",
      },
      { merge: true },
    ),
  );
});

test("restaurant owners cannot forge menu-routing updater identity", async () => {
  await assertFails(
    dbFor("restaurantOwner").doc("restaurant_accounts/owner-1").set(
      {
        menuSourceSide: "biteScore",
        linkedBiteScoreRestaurantId: "bs-1",
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "owner-2",
      },
      { merge: true },
    ),
  );
});

test("restaurant owners cannot write billing/admin/subscription fields", async () => {
  await assertFails(
    dbFor("restaurantOwner").doc("restaurant_accounts/owner-1").set(
      {
        approvalStatus: "approved",
        couponPostingEnabled: true,
        hasUsedTrial: false,
        stripeCustomerId: "cus_forged",
        stripeSubscriptionId: "sub_forged",
        subscriptionStatus: "active",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("BiteScore claimed restaurant owners can manage linked public content", async () => {
  const db = dbFor("biteScoreOwner");
  await assertSucceeds(
    db.doc("bitescore_restaurants/bs-1").set(
      {
        bio: "Owner updated bio",
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  await assertSucceeds(
    db.doc("restaurant_menus/menu-1/menu_items/item-2").set({
      id: "item-2",
      name: "Garlic Knots",
      description: "Six pieces",
      price: "5.00",
      category: "Sides",
      sortOrder: 2,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("BiteScore claimed restaurant owners can link and unlink BiteSaver routing", async () => {
  const db = dbFor("biteScoreOwner");
  const restaurantRef = db.doc("bitescore_restaurants/bs-1");

  await assertSucceeds(
    restaurantRef.set(
      {
        menuSourceSide: "biteSaver",
        linkedBiteSaverUid: "owner-1",
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "bitescore-owner",
        restaurantWriteRevision: 5,
      },
      { merge: true },
    ),
  );

  await assertSucceeds(
    restaurantRef.set(
      {
        menuSourceSide: "biteScore",
        linkedBiteSaverUid: firebase.firestore.FieldValue.delete(),
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "bitescore-owner",
        restaurantWriteRevision: 6,
      },
      { merge: true },
    ),
  );
});

test("wrong users cannot manage a claimed BiteScore owner's content", async () => {
  await assertFails(
    dbFor("wrongRestaurantOwner").doc("bitescore_restaurants/bs-1").set(
      {
        bio: "Forged bio",
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("wrong users cannot update BiteScore linked BiteSaver routing", async () => {
  await assertFails(
    dbFor("wrongRestaurantOwner").doc("bitescore_restaurants/bs-1").set(
      {
        menuSourceSide: "biteSaver",
        linkedBiteSaverUid: "owner-1",
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "owner-2",
        restaurantWriteRevision: 5,
      },
      { merge: true },
    ),
  );
});

test("BiteScore owners cannot combine routing updates with ownership changes", async () => {
  await assertFails(
    dbFor("biteScoreOwner").doc("bitescore_restaurants/bs-1").set(
      {
        menuSourceSide: "biteSaver",
        linkedBiteSaverUid: "owner-1",
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "bitescore-owner",
        ownerUserId: "owner-2",
        isClaimed: false,
        restaurantWriteRevision: 5,
      },
      { merge: true },
    ),
  );
});

test("BiteScore owners cannot forge routing updater identity", async () => {
  await assertFails(
    dbFor("biteScoreOwner").doc("bitescore_restaurants/bs-1").set(
      {
        menuSourceSide: "biteSaver",
        linkedBiteSaverUid: "owner-1",
        menuSourceUpdatedAt: serverTimestamp(),
        menuSourceUpdatedBy: "owner-2",
        restaurantWriteRevision: 5,
      },
      { merge: true },
    ),
  );
});

test("BiteScore dish provenance owner can create with own provenance", async () => {
  await assertSucceeds(
    dbFor("customer")
      .doc("bitescore_dishes/new-dish-1")
      .set(biteScoreDishCreateData()),
  );
});

test("BiteScore dish provenance cannot be forged on create", async () => {
  await assertFails(
    dbFor("customer").doc("bitescore_dishes/forged-dish-1").set(
      biteScoreDishCreateData({
        id: "forged-dish-1",
        createdByUserId: "customer-b",
      }),
    ),
  );
});

test("BiteScore dish provenance cannot change after create", async () => {
  const db = dbFor("customer");
  await assertSucceeds(
    db.doc("bitescore_dishes/new-dish-2").set(
      biteScoreDishCreateData({
        id: "new-dish-2",
        createdFromReviewId: "new-dish-2_customer-a",
      }),
    ),
  );

  await assertFails(
    db.doc("bitescore_dishes/new-dish-2").set(
      { createdByUserId: "customer-b" },
      { merge: true },
    ),
  );
  await assertFails(
    db.doc("bitescore_dishes/new-dish-2").set(
      { createdFromReviewId: "forged-review" },
      { merge: true },
    ),
  );
  await assertFails(
    db.doc("bitescore_dishes/new-dish-2").set(
      { createdWithRestaurantId: "forged-restaurant" },
      { merge: true },
    ),
  );
});

test("BiteScore dish provenance cannot be added later to old dishes", async () => {
  await assertFails(
    dbFor("customer").doc("bitescore_dishes/dish-1").set(
      {
        createdByUserId: "customer-a",
        createdFromReviewId: "dish-1_customer-a",
        createdWithRestaurantId: "bs-1",
        createdFromCreateFlow: true,
      },
      { merge: true },
    ),
  );
});

test("old BiteScore dish docs without provenance remain readable and updatable", async () => {
  const db = dbFor("customer");
  await assertSucceeds(db.doc("bitescore_dishes/dish-1").get());
  await assertSucceeds(
    db.doc("bitescore_dishes/dish-1").set(
      {
        category: "Pizza",
        subcategory: "Slices",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("aggregate write generation is server-owned and client immutable", async () => {
  const customerDb = dbFor("customer");
  const generatedDishId = "new-generated-dish";

  await assertSucceeds(
    customerDb.doc(`bitescore_dishes/${generatedDishId}`).set({
      ...biteScoreDishCreateData({
        id: generatedDishId,
        createdFromReviewId: `${generatedDishId}_customer-a`,
      }),
    }),
  );

  for (const [index, generation] of [
    0,
    1,
    -1,
    1.5,
    9007199254740992,
    null,
  ].entries()) {
    const dishId = `client-generated-dish-${index}`;
    await assertFails(
      customerDb.doc(`bitescore_dishes/${dishId}`).set({
        ...biteScoreDishCreateData({
          id: dishId,
          createdFromReviewId: `${dishId}_customer-a`,
        }),
        aggregateWriteGeneration: generation,
      }),
    );
  }

  await assertFails(
    customerDb.doc(`bitescore_dishes/${generatedDishId}`).set(
      {
        aggregateWriteGeneration: 0,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );

  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${generatedDishId}`,
      data: ruleTestDishData(generatedDishId, {
        aggregateWriteGeneration: 2,
      }),
    },
    {
      documentPath: "bitescore_dishes/malformed-generation-dish",
      data: ruleTestDishData("malformed-generation-dish", {
        aggregateWriteGeneration: "2",
      }),
    },
  ]);

  for (const generation of [1, 3, null]) {
    await assertFails(
      dbFor("admin").doc(`bitescore_dishes/${generatedDishId}`).set(
        {
          aggregateWriteGeneration: generation,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  }
  await assertFails(
    dbFor("admin").doc(`bitescore_dishes/${generatedDishId}`).update({
      aggregateWriteGeneration: firebase.firestore.FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("admin").doc("bitescore_dishes/malformed-generation-dish").update({
      category: "Malformed state must fail closed",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("admin").doc("bitescore_dishes/malformed-generation-dish").delete(),
  );
});

test("BiteScore restaurant create requires an exact revision zero", async () => {
  const adminDb = dbFor("admin");
  await assertSucceeds(
    adminDb.doc("bitescore_restaurants/revision-create-zero").set(
      biteScoreRestaurantCreateData({ id: "revision-create-zero" }),
    ),
  );

  const missingRevisionData = biteScoreRestaurantCreateData({
    id: "revision-create-missing",
  });
  delete missingRevisionData.restaurantWriteRevision;
  await assertFails(
    adminDb
      .doc("bitescore_restaurants/revision-create-missing")
      .set(missingRevisionData),
  );

  const invalidRevisions = [
    1,
    -1,
    1.5,
    9007199254740992,
    "0",
    null,
  ];
  for (const [index, restaurantWriteRevision] of invalidRevisions.entries()) {
    const id = `revision-create-invalid-${index}`;
    await assertFails(
      adminDb.doc(`bitescore_restaurants/${id}`).set({
        ...biteScoreRestaurantCreateData({ id }),
        restaurantWriteRevision,
      }),
    );
  }
});

test("BiteScore restaurant update requires the current revision plus one", async () => {
  const restaurantRef = dbFor("admin").doc("bitescore_restaurants/bs-1");

  await assertSucceeds(
    restaurantRef.set(
      {
        bio: "Fresh revision four edit",
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );

  await assertFails(
    restaurantRef.set(
      { bio: "Omitted revision", updatedAt: serverTimestamp() },
      { merge: true },
    ),
  );

  for (const [index, restaurantWriteRevision] of [
    5,
    7,
    0,
    -1,
    1.5,
    9007199254740992,
    "6",
    null,
  ].entries()) {
    await assertFails(
      restaurantRef.set(
        {
          bio: `Invalid revision update ${index}`,
          restaurantWriteRevision,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  }

  await assertFails(
    restaurantRef.update({
      restaurantWriteRevision: firebase.firestore.FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("Admin exact BiteScore Hide and Restore writes preserve all other data", async () => {
  const restaurantRef = dbFor("admin").doc("bitescore_restaurants/bs-1");
  const original = (await restaurantRef.get()).data();

  await assertSucceeds(
    restaurantRef.set(
      {
        isActive: false,
        active: false,
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  const hidden = (await restaurantRef.get()).data();
  assert.equal(hidden.isActive, false);
  assert.equal(hidden.active, false);
  assert.equal(hidden.restaurantWriteRevision, 5);
  for (const field of [
    "id",
    "name",
    "address",
    "location",
    "ownerUserId",
    "isClaimed",
    "sharedMenuId",
  ]) {
    assert.deepEqual(hidden[field], original[field], field);
  }

  await assertSucceeds(
    restaurantRef.set(
      {
        isActive: true,
        active: true,
        restaurantWriteRevision: 6,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  const restored = (await restaurantRef.get()).data();
  assert.equal(restored.isActive, true);
  assert.equal(restored.active, true);
  assert.equal(restored.restaurantWriteRevision, 6);
  assert.equal(restored.ownerUserId, "bitescore-owner");
  assert.equal(restored.isClaimed, true);
});

test("Admin Restore normalizes hidden malformed and conflicting activity", async () => {
  const cases = [
    { id: "restore-hidden", isActive: false, active: false },
    { id: "restore-malformed", isActive: "true", active: false },
    { id: "restore-conflicting", isActive: true, active: false },
  ];
  await seedRuleTestDocuments(cases.map((entry) => ({
    documentPath: `bitescore_restaurants/${entry.id}`,
    data: {
      id: entry.id,
      name: `Restaurant ${entry.id}`,
      isActive: entry.isActive,
      active: entry.active,
      restaurantWriteRevision: 4,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  })));

  for (const entry of cases) {
    const ref = dbFor("admin").doc(`bitescore_restaurants/${entry.id}`);
    await assertSucceeds(
      ref.set(
        {
          isActive: true,
          active: true,
          restaurantWriteRevision: 5,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
    const restored = (await ref.get()).data();
    assert.equal(restored.isActive, true, entry.id);
    assert.equal(restored.active, true, entry.id);
    assert.equal(restored.restaurantWriteRevision, 5, entry.id);
  }
});

test("non-Admins cannot change BiteScore restaurant activity", async () => {
  for (const actor of ["customer", "biteScoreOwner"]) {
    await assertFails(
      dbFor(actor).doc("bitescore_restaurants/bs-1").set(
        {
          isActive: false,
          active: false,
          restaurantWriteRevision: 5,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  }
});

test("Admin activity writes cannot include profile ownership or claim changes", async () => {
  const restaurantRef = dbFor("admin").doc("bitescore_restaurants/bs-1");
  for (const extra of [
    { name: "Changed while hiding" },
    { address: "99 Changed Address" },
    { ownerUserId: "other-owner" },
    { isClaimed: false },
    { linkedBiteSaverUid: "other-link" },
  ]) {
    await assertFails(
      restaurantRef.set(
        {
          isActive: false,
          active: false,
          restaurantWriteRevision: 5,
          updatedAt: serverTimestamp(),
          ...extra,
        },
        { merge: true },
      ),
    );
  }
});

test("Admin activity writes require equal Booleans timestamp and exact revision", async () => {
  const restaurantRef = dbFor("admin").doc("bitescore_restaurants/bs-1");
  const invalidWrites = [
    {
      isActive: false,
      active: true,
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    },
    {
      isActive: "false",
      active: false,
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    },
    {
      isActive: false,
      active: 0,
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    },
    {
      isActive: false,
      active: false,
      restaurantWriteRevision: 4,
      updatedAt: serverTimestamp(),
    },
    {
      isActive: false,
      active: false,
      restaurantWriteRevision: 6,
      updatedAt: serverTimestamp(),
    },
    {
      isActive: false,
      active: false,
      restaurantWriteRevision: 5,
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  ];
  for (const write of invalidWrites) {
    await assertFails(restaurantRef.set(write, { merge: true }));
  }
});

test("existing Admin and owner profile edits remain available without activity changes", async () => {
  await assertSucceeds(
    dbFor("admin").doc("bitescore_restaurants/bs-1").set(
      {
        phone: "555-0199",
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  await assertSucceeds(
    dbFor("biteScoreOwner").doc("bitescore_restaurants/bs-1").set(
      {
        bio: "Owner profile edit remains available",
        restaurantWriteRevision: 6,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("BiteScore restaurant revision accepts the safe maximum and then exhausts", async () => {
  const restaurantPath = "bitescore_restaurants/revision-maximum";
  await seedRuleTestDocuments([
    {
      documentPath: restaurantPath,
      data: {
        id: "revision-maximum",
        name: "Maximum Revision Restaurant",
        restaurantWriteRevision: 9007199254740990,
      },
    },
  ]);

  const restaurantRef = dbFor("admin").doc(restaurantPath);
  await assertSucceeds(
    restaurantRef.set(
      {
        bio: "Maximum revision reached",
        restaurantWriteRevision: 9007199254740991,
      },
      { merge: true },
    ),
  );
  await assertFails(
    restaurantRef.set(
      {
        bio: "Unsafe next revision",
        restaurantWriteRevision: 9007199254740992,
      },
      { merge: true },
    ),
  );
});

test("BiteScore restaurant invalid current revisions fail closed", async () => {
  const invalidCurrentRevisions = [
    { suffix: "missing" },
    { suffix: "negative", restaurantWriteRevision: -1 },
    { suffix: "fractional", restaurantWriteRevision: 1.5 },
    { suffix: "unsafe", restaurantWriteRevision: 9007199254740992 },
    { suffix: "wrong-type", restaurantWriteRevision: "4" },
  ];
  await seedRuleTestDocuments(
    invalidCurrentRevisions.map(({ suffix, restaurantWriteRevision }) => ({
      documentPath: `bitescore_restaurants/current-revision-${suffix}`,
      data: {
        id: `current-revision-${suffix}`,
        name: "Invalid Revision Restaurant",
        ...(restaurantWriteRevision === undefined
          ? {}
          : { restaurantWriteRevision }),
      },
    })),
  );

  for (const { suffix } of invalidCurrentRevisions) {
    await assertFails(
      dbFor("admin")
        .doc(`bitescore_restaurants/current-revision-${suffix}`)
        .set(
          {
            bio: "Must not migrate or repair implicitly",
            restaurantWriteRevision: 5,
          },
          { merge: true },
        ),
    );
  }
});

test("stale full Admin restaurant edit preserves an intervening update", async () => {
  const restaurantRef = dbFor("admin").doc("bitescore_restaurants/bs-1");
  const staleSnapshot = await restaurantRef.get();

  await assertSucceeds(
    restaurantRef.set(
      {
        city: "Inverness",
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );

  await assertFails(
    restaurantRef.set({
      ...staleSnapshot.data(),
      bio: "Delayed stale full edit",
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    }),
  );

  const currentData = (await restaurantRef.get()).data();
  assert.equal(currentData.city, "Inverness");
  assert.equal(currentData.restaurantWriteRevision, 5);
  assert.equal(currentData.bio, undefined);
});

test("stale partial restaurant claim update is rejected", async () => {
  const restaurantPath = "bitescore_restaurants/stale-claim";
  await seedRuleTestDocuments([
    {
      documentPath: restaurantPath,
      data: {
        id: "stale-claim",
        name: "Stale Claim Restaurant",
        isClaimed: false,
        restaurantWriteRevision: 4,
      },
    },
  ]);
  const restaurantRef = dbFor("admin").doc(restaurantPath);

  await assertSucceeds(
    restaurantRef.set(
      { phone: "555-0199", restaurantWriteRevision: 5 },
      { merge: true },
    ),
  );
  await assertFails(
    restaurantRef.set(
      {
        ownerUserId: "customer-a",
        isClaimed: true,
        restaurantWriteRevision: 5,
      },
      { merge: true },
    ),
  );

  const currentData = (await restaurantRef.get()).data();
  assert.equal(currentData.phone, "555-0199");
  assert.equal(currentData.isClaimed, false);
  assert.equal(currentData.ownerUserId, undefined);
  assert.equal(currentData.restaurantWriteRevision, 5);
});

test("stale restaurant unclaim update is rejected", async () => {
  const restaurantRef = dbFor("admin").doc("bitescore_restaurants/bs-1");

  await assertSucceeds(
    restaurantRef.set(
      { phone: "555-0188", restaurantWriteRevision: 5 },
      { merge: true },
    ),
  );
  await assertFails(
    restaurantRef.set(
      {
        ownerUserId: firebase.firestore.FieldValue.delete(),
        isClaimed: false,
        restaurantWriteRevision: 5,
      },
      { merge: true },
    ),
  );

  const currentData = (await restaurantRef.get()).data();
  assert.equal(currentData.phone, "555-0188");
  assert.equal(currentData.isClaimed, true);
  assert.equal(currentData.ownerUserId, "bitescore-owner");
  assert.equal(currentData.restaurantWriteRevision, 5);
});

test("restaurant revision preserves owner and Admin authorization and isolation", async () => {
  await seedRuleTestDocuments([
    {
      documentPath: "bitescore_restaurants/unrelated-revision",
      data: {
        id: "unrelated-revision",
        name: "Unrelated Restaurant",
        marker: "unchanged",
        restaurantWriteRevision: 9,
      },
    },
  ]);
  const restaurantRef = dbFor("biteScoreOwner").doc(
    "bitescore_restaurants/bs-1",
  );

  await assertSucceeds(
    restaurantRef.set(
      {
        bio: "Owner-authorized revision",
        restaurantWriteRevision: 5,
      },
      { merge: true },
    ),
  );
  await assertFails(
    dbFor("wrongRestaurantOwner").doc("bitescore_restaurants/bs-1").set(
      {
        bio: "Wrong owner with a correct next revision",
        restaurantWriteRevision: 6,
      },
      { merge: true },
    ),
  );
  await assertSucceeds(
    dbFor("admin").doc("bitescore_restaurants/bs-1").set(
      {
        bio: "Admin-authorized revision",
        restaurantWriteRevision: 6,
      },
      { merge: true },
    ),
  );

  const unrelatedData = (
    await dbFor("admin").doc("bitescore_restaurants/unrelated-revision").get()
  ).data();
  assert.equal(unrelatedData.marker, "unchanged");
  assert.equal(unrelatedData.restaurantWriteRevision, 9);
});

test("restaurant revision does not change delete authorization", async () => {
  await seedRuleTestDocuments([
    {
      documentPath: "bitescore_restaurants/delete-missing-revision",
      data: {
        id: "delete-missing-revision",
        name: "Disposable Invalid Restaurant",
      },
    },
  ]);

  await assertFails(
    dbFor("biteScoreOwner").doc("bitescore_restaurants/bs-1").delete(),
  );
  await assertSucceeds(
    dbFor("admin").doc("bitescore_restaurants/bs-1").delete(),
  );
  await assertSucceeds(
    dbFor("admin")
      .doc("bitescore_restaurants/delete-missing-revision")
      .delete(),
  );
});

test("BiteScore restaurant provenance owner can create initial provenance", async () => {
  await assertSucceeds(
    dbFor("customer")
      .doc("bitescore_restaurants/new-restaurant-1")
      .set(biteScoreRestaurantCreateData()),
  );
});

test("BiteScore restaurant provenance cannot be forged on create", async () => {
  await assertFails(
    dbFor("customer").doc("bitescore_restaurants/forged-restaurant-1").set(
      biteScoreRestaurantCreateData({
        id: "forged-restaurant-1",
        createdByUserId: "customer-b",
      }),
    ),
  );
});

test("BiteScore restaurant creator can complete provenance once", async () => {
  const db = dbFor("customer");
  await assertSucceeds(
    db.doc("bitescore_restaurants/new-restaurant-2").set(
      biteScoreRestaurantCreateData({ id: "new-restaurant-2" }),
    ),
  );

  await assertSucceeds(
    db.doc("bitescore_restaurants/new-restaurant-2").set(
      {
        createdFromDishId: "new-dish-2",
        createdFromReviewId: "new-dish-2_customer-a",
        restaurantWriteRevision: 1,
      },
      { merge: true },
    ),
  );
});

test("wrong user cannot complete BiteScore restaurant provenance", async () => {
  await assertSucceeds(
    dbFor("customer").doc("bitescore_restaurants/new-restaurant-3").set(
      biteScoreRestaurantCreateData({ id: "new-restaurant-3" }),
    ),
  );

  await assertFails(
    dbFor("wrongCustomer").doc("bitescore_restaurants/new-restaurant-3").set(
      {
        createdFromDishId: "new-dish-3",
        createdFromReviewId: "new-dish-3_customer-a",
        restaurantWriteRevision: 1,
      },
      { merge: true },
    ),
  );
});

test("BiteScore restaurant completed provenance cannot change", async () => {
  const db = dbFor("customer");
  await assertSucceeds(
    db.doc("bitescore_restaurants/new-restaurant-4").set(
      biteScoreRestaurantCreateData({ id: "new-restaurant-4" }),
    ),
  );
  await assertSucceeds(
    db.doc("bitescore_restaurants/new-restaurant-4").set(
      {
        createdFromDishId: "new-dish-4",
        createdFromReviewId: "new-dish-4_customer-a",
        restaurantWriteRevision: 1,
      },
      { merge: true },
    ),
  );

  await assertFails(
    db.doc("bitescore_restaurants/new-restaurant-4").set(
      {
        createdFromDishId: "forged-dish",
        restaurantWriteRevision: 2,
      },
      { merge: true },
    ),
  );
  await assertFails(
    db.doc("bitescore_restaurants/new-restaurant-4").set(
      {
        createdFromReviewId: "forged-review",
        restaurantWriteRevision: 2,
      },
      { merge: true },
    ),
  );
});

test("BiteScore restaurant provenance cannot be added later to old restaurants", async () => {
  await assertFails(
    dbFor("biteScoreOwner").doc("bitescore_restaurants/bs-1").set(
      {
        createdByUserId: "bitescore-owner",
        createdFromDishId: "dish-1",
        createdFromReviewId: "dish-1_bitescore-owner",
        createdFromCreateFlow: true,
        restaurantWriteRevision: 5,
      },
      { merge: true },
    ),
  );
});

test("old BiteScore restaurant docs without provenance remain readable and updatable", async () => {
  const db = dbFor("biteScoreOwner");
  await assertSucceeds(db.doc("bitescore_restaurants/bs-1").get());
  await assertSucceeds(
    db.doc("bitescore_restaurants/bs-1").set(
      {
        bio: "Still owner editable",
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("verified signed-in users can create BiteScore reviews/reports/proposals with own userId", async () => {
  const db = dbFor("customer");
  await assertSucceeds(
    db.doc("dish_reviews/dish-1_customer-a_new").set({
      id: "dish-1_customer-a_new",
      dishId: "dish-1",
      restaurantId: "bs-1",
      userId: "customer-a",
      overallImpression: 9,
      overallBiteScore: 90,
      headline: "Great",
      notes: "Fresh and well seasoned.",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    db.doc("review_reports/review-report-2").set({
      id: "review-report-2",
      reviewId: "dish-1_customer-a",
      dishId: "dish-1",
      restaurantId: "bs-1",
      reportingUserId: "customer-a",
      reason: "spam",
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    db.doc("dish_edit_proposals/proposal-2").set({
      id: "proposal-2",
      type: "rename",
      restaurantId: "bs-1",
      targetDishId: "dish-1",
      proposedName: "Cheese Slice",
      userId: "customer-a",
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("users cannot forge another userId on BiteScore reviews", async () => {
  await assertFails(
    dbFor("customer").doc("dish_reviews/dish-1_customer-b_forged").set({
      id: "dish-1_customer-b_forged",
      dishId: "dish-1",
      restaurantId: "bs-1",
      userId: "customer-b",
      overallImpression: 10,
      overallBiteScore: 100,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("users cannot forge another userId on reports or proposals", async () => {
  await assertFails(
    dbFor("customer").doc("dish_edit_proposals/proposal-forged").set({
      id: "proposal-forged",
      type: "rename",
      restaurantId: "bs-1",
      targetDishId: "dish-1",
      proposedName: "Forged",
      userId: "customer-b",
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("proposal resolution identities accept only canonical consistent aliases", async () => {
  const customerDb = dbFor("customer");
  const valid = [
    dishProposalWriteData(),
    dishProposalWriteData({
      type: "merge",
      targetDishId: "standard-source",
      mergeTargetDishId: "standard-target",
      proposedName: null,
    }),
    dishProposalWriteData({
      type: "merge",
      sourceDishId: "duplicate-source",
      targetDishId: "duplicate-target",
      mergeTargetDishId: "duplicate-target",
      proposedName: null,
    }),
    dishProposalWriteData({
      type: null,
      targetType: "merge",
      sourceDishId: "legacy-source",
      targetDishId: null,
      targetId: "legacy-target",
      mergeTargetDishId: null,
      proposedName: null,
    }),
    dishProposalWriteData({
      restaurantId: "restaurant with internal space",
      targetDishId: "dish with internal space",
    }),
    dishProposalWriteData({
      restaurantId: "餐厅-一",
      targetDishId: "crème-brûlée",
    }),
    dishProposalWriteData({
      targetDishId: "é".repeat(750),
    }),
  ];
  for (const [index, data] of valid.entries()) {
    await assertSucceeds(
      customerDb.doc(`dish_edit_proposals/rules-valid-${index}`).set(data),
    );
  }

  const invalid = [
    {restaurantId: "unsafe/restaurant"},
    {targetDishId: "unsafe/source"},
    {targetDishId: null, targetId: "unsafe/legacy"},
    {targetDishId: " padded-source"},
    {targetDishId: "trailing-source "},
    {targetDishId: ""},
    {targetDishId: "."},
    {targetDishId: ".."},
    {targetDishId: "__reserved__"},
    {targetDishId: "unsafe\u0000source"},
    {targetDishId: "x".repeat(1_501)},
    {targetDishId: "é".repeat(751)},
    {type: "rename", targetType: "merge"},
    {targetDishId: "source-a", targetId: "source-b"},
    {sourceDishId: "source-a", targetDishId: "source-b"},
    {type: "merge", targetDishId: "source", mergeTargetDishId: null},
    {type: "merge", targetDishId: "same", mergeTargetDishId: "same"},
    {
      type: "merge",
      sourceDishId: "source",
      targetDishId: "target-a",
      mergeTargetDishId: "target-b",
    },
    {
      type: "merge",
      targetDishId: "source",
      mergeTargetDishId: "unsafe/target",
    },
  ];
  for (const [index, patch] of invalid.entries()) {
    await assertFails(
      customerDb
        .doc(`dish_edit_proposals/rules-invalid-${index}`)
        .set(dishProposalWriteData(patch)),
    );
  }
});

test("Admin proposal updates cannot leave unsafe resolution identities", async () => {
  const proposal = dbFor("admin").doc("dish_edit_proposals/proposal-1");
  await assertSucceeds(proposal.update({status: "rejected"}));
  await assertFails(proposal.update({targetDishId: "unsafe/source"}));
  await assertFails(proposal.update({
    targetDishId: null,
    targetId: "unsafe/legacy",
  }));
  await assertFails(proposal.update({
    type: "merge",
    mergeTargetDishId: "dish-1",
  }));
  await assertSucceeds(proposal.update({
    type: "merge",
    mergeTargetDishId: "dish-2",
  }));
});

test("users cannot write another user's review feedback vote", async () => {
  await assertFails(
    dbFor("customer").doc("review_feedback_votes/forged-vote").set({
      id: "forged-vote",
      reviewId: "dish-1_customer-a",
      dishId: "dish-1",
      restaurantId: "bs-1",
      userId: "customer-b",
      voteType: "helpful",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("restaurant owners can create own name-change requests with userId", async () => {
  await assertSucceeds(
    dbFor("restaurantOwner").doc("restaurant_name_change_requests/request-2").set({
      userId: "owner-1",
      currentRestaurantName: "Approved Tacos",
      requestedRestaurantName: "Approved Taco Kitchen",
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );
});

test("restaurant owners cannot forge another userId on name-change requests", async () => {
  await assertFails(
    dbFor("restaurantOwner").doc("restaurant_name_change_requests/request-forged").set({
      userId: "owner-2",
      currentRestaurantName: "Approved Tacos",
      requestedRestaurantName: "Forged Taco Kitchen",
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );
});

test("normal users cannot create name-change requests for restaurant owners", async () => {
  await assertFails(
    dbFor("customer").doc("restaurant_name_change_requests/request-customer").set({
      userId: "owner-1",
      currentRestaurantName: "Approved Tacos",
      requestedRestaurantName: "Customer Forged Name",
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );
});

test("admins can update name-change request moderation fields", async () => {
  await assertSucceeds(
    dbFor("admin").doc("restaurant_name_change_requests/request-1").set(
      {
        status: "approved",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("client reads of restaurant_invites are denied", async () => {
  await assertFails(dbFor("customer").doc("restaurant_invites/invite-1").get());
});

test("client writes to restaurant_invites are denied", async () => {
  await assertFails(
    dbFor("admin").doc("restaurant_invites/invite-2").set({
      tokenHash: "forged",
      status: "active",
      createdAt: serverTimestamp(),
    }),
  );
});

test("client writes to contribution ledger are denied", async () => {
  await assertFails(
    dbFor("customer").doc("bitescore_contribution_point_ledger/forged").set({
      id: "forged",
      userId: "customer-a",
      pointsDelta: 100,
      actionType: "forged",
      sourceKey: "forged:source",
      description: "Forged points",
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("client writes to contribution totals are denied", async () => {
  await assertFails(
    dbFor("customer").doc("user_profiles/customer-a").set(
      {
        contributionPoints: 1000,
        lastContributionAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("client writes to Stripe/subscription/admin fields are denied", async () => {
  await assertFails(
    dbFor("restaurantOwner").doc("restaurant_accounts/owner-1").update({
      approvalStatus: "approved",
      billingPlanName: "coupon_monthly",
      couponPostingEnabled: true,
      stripeCustomerId: "cus_client_forged",
      stripeSubscriptionId: "sub_client_forged",
      subscriptionEndsAt: new Date("2027-01-01T00:00:00.000Z"),
      subscriptionStatus: "active",
      trialEndsAt: new Date("2027-01-01T00:00:00.000Z"),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("client access to proximity push/status paths is denied", async () => {
  await assertFails(
    dbFor("customer").doc("proximity_push_requests/request-2").set({
      requestId: "request-2",
      installationId: "installation-1",
      couponId: "coupon-1",
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("client access to customer device installation tokens is denied", async () => {
  await assertFails(
    dbFor("customer").doc("customer_device_installations/installation-1").get(),
  );
});

test("direct BiteScore claims enforce the strict restaurant activity matrix", async () => {
  const cases = [
    {
      label: "activity-absent",
      allowed: true,
      omittedFields: ["isActive", "active"],
    },
    {
      label: "canonical-active-only",
      allowed: true,
      omittedFields: ["active"],
    },
    {
      label: "canonical-inactive-only",
      allowed: false,
      overrides: { isActive: false },
      omittedFields: ["active"],
    },
    {
      label: "legacy-active-only",
      allowed: true,
      omittedFields: ["isActive"],
    },
    {
      label: "legacy-inactive-only",
      allowed: false,
      overrides: { active: false },
      omittedFields: ["isActive"],
    },
    { label: "both-active", allowed: true },
    {
      label: "both-inactive",
      allowed: false,
      overrides: { isActive: false, active: false },
    },
    {
      label: "canonical-active-legacy-inactive",
      allowed: false,
      overrides: { isActive: true, active: false },
    },
    {
      label: "canonical-inactive-legacy-active",
      allowed: false,
      overrides: { isActive: false, active: true },
    },
    {
      label: "canonical-string",
      allowed: false,
      overrides: { isActive: "true" },
      omittedFields: ["active"],
    },
    {
      label: "legacy-null",
      allowed: false,
      overrides: { active: null },
      omittedFields: ["isActive"],
    },
    {
      label: "legacy-string-with-canonical-active",
      allowed: false,
      overrides: { isActive: true, active: "true" },
    },
  ];
  await seedRuleTestDocuments(cases.map((entry) => ({
    documentPath: `bitescore_restaurants/claim-${entry.label}`,
    data: claimableBiteScoreRestaurantData(
      `claim-${entry.label}`,
      {
        overrides: entry.overrides,
        omittedFields: entry.omittedFields,
      },
    ),
  })));

  const db = dbFor("customer");
  for (const entry of cases) {
    const restaurantId = `claim-${entry.label}`;
    const claimId = `claim-request-${entry.label}`;
    const write = db.doc(`restaurant_claim_requests/${claimId}`).set(
      restaurantClaimRequestData(claimId, restaurantId),
    );
    if (entry.allowed) {
      await assertSucceeds(write);
    } else {
      await assertFails(write);
    }
  }
});

test("direct BiteScore claims enforce strict unclaimed ownership types", async () => {
  const db = dbFor("customer");
  const adminDb = dbFor("admin");
  const allowedCases = [
    {
      label: "ownership-absent",
      omittedFields: ["isClaimed", "ownerUserId"],
    },
    { label: "false-owner-absent", omittedFields: ["ownerUserId"] },
    {
      label: "claim-absent-owner-null",
      overrides: { ownerUserId: null },
      omittedFields: ["isClaimed"],
    },
    {
      label: "claim-absent-owner-empty",
      overrides: { ownerUserId: "" },
      omittedFields: ["isClaimed"],
    },
    { label: "false-owner-null", overrides: { ownerUserId: null } },
    { label: "false-owner-empty", overrides: { ownerUserId: "" } },
  ];
  const invalidIsClaimedValues = [
    ["claimed-true", true],
    ["claimed-null", null],
    ["claimed-integer", 0],
    ["claimed-double", 1.5],
    ["claimed-string", "false"],
    ["claimed-map", { malformed: true }],
    ["claimed-list", [false]],
    ["claimed-timestamp", new Date("2026-01-02T00:00:00.000Z")],
    ["claimed-geopoint", new firebase.firestore.GeoPoint(28, -82)],
    ["claimed-reference", adminDb.doc("bitescore_restaurants/bs-1")],
  ];
  const invalidOwnerValues = [
    ["owner-whitespace", " "],
    ["owner-nonempty", "owner-1"],
    ["owner-integer", 7],
    ["owner-double", 1.5],
    ["owner-true", true],
    ["owner-false", false],
    ["owner-map", { malformed: true }],
    ["owner-list", ["owner-1"]],
    ["owner-timestamp", new Date("2026-01-02T00:00:00.000Z")],
    ["owner-geopoint", new firebase.firestore.GeoPoint(28, -82)],
    ["owner-reference", adminDb.doc("bitescore_restaurants/bs-1")],
  ];
  const documents = [];
  for (const entry of allowedCases) {
    const restaurantId = `claim-${entry.label}`;
    documents.push({
      documentPath: `bitescore_restaurants/${restaurantId}`,
      data: claimableBiteScoreRestaurantData(restaurantId, entry),
    });
  }
  for (const [label, isClaimed] of invalidIsClaimedValues) {
    const restaurantId = `claim-${label}`;
    documents.push({
      documentPath: `bitescore_restaurants/${restaurantId}`,
      data: claimableBiteScoreRestaurantData(restaurantId, {
        overrides: { isClaimed },
      }),
    });
  }
  for (const [label, ownerUserId] of invalidOwnerValues) {
    const restaurantId = `claim-${label}`;
    documents.push({
      documentPath: `bitescore_restaurants/${restaurantId}`,
      data: claimableBiteScoreRestaurantData(restaurantId, {
        overrides: { ownerUserId },
      }),
    });
  }
  await seedRuleTestDocuments(documents);

  for (const entry of allowedCases) {
    const restaurantId = `claim-${entry.label}`;
    const claimId = `claim-request-${entry.label}`;
    await assertSucceeds(
      db.doc(`restaurant_claim_requests/${claimId}`).set(
        restaurantClaimRequestData(claimId, restaurantId),
      ),
    );
  }
  for (const [label] of [
    ...invalidIsClaimedValues,
    ...invalidOwnerValues,
  ]) {
    const restaurantId = `claim-${label}`;
    const claimId = `claim-request-${label}`;
    await assertFails(
      db.doc(`restaurant_claim_requests/${claimId}`).set(
        restaurantClaimRequestData(claimId, restaurantId),
      ),
    );
  }
});

test("direct claims require an exact canonical restaurant and no lock", async () => {
  const exactId = "claim-canonical-exact";
  const missingEmbeddedId = "claim-canonical-missing-id";
  const mismatchedEmbeddedId = "claim-canonical-mismatched-id";
  const lockedId = "claim-canonical-locked";
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_restaurants/${exactId}`,
      data: claimableBiteScoreRestaurantData(exactId),
    },
    {
      documentPath: `bitescore_restaurants/${missingEmbeddedId}`,
      data: claimableBiteScoreRestaurantData(missingEmbeddedId, {
        omittedFields: ["id"],
      }),
    },
    {
      documentPath: `bitescore_restaurants/${mismatchedEmbeddedId}`,
      data: claimableBiteScoreRestaurantData(mismatchedEmbeddedId, {
        overrides: { id: "another-restaurant" },
      }),
    },
    {
      documentPath: `bitescore_restaurants/${lockedId}`,
      data: claimableBiteScoreRestaurantData(lockedId),
    },
    {
      documentPath:
        `private_rating_restaurant_operation_locks/${lockedId}`,
      data: ratingRestaurantOperationLockData(lockedId),
    },
  ]);

  const db = dbFor("customer");
  await assertSucceeds(
    db.doc("restaurant_claim_requests/canonical-exact").set(
      restaurantClaimRequestData("canonical-exact", exactId),
    ),
  );
  for (const [claimId, restaurantId] of [
    ["canonical-missing", "claim-canonical-missing"],
    ["canonical-missing-id", missingEmbeddedId],
    ["canonical-mismatched-id", mismatchedEmbeddedId],
    ["canonical-locked", lockedId],
    ["canonical-slash", "restaurant/alias"],
  ]) {
    await assertFails(
      db.doc(`restaurant_claim_requests/${claimId}`).set(
        restaurantClaimRequestData(claimId, restaurantId),
      ),
    );
  }

  const missingRestaurantId = restaurantClaimRequestData(
    "canonical-missing-field",
    exactId,
  );
  delete missingRestaurantId.restaurantId;
  await assertFails(
    db.doc("restaurant_claim_requests/canonical-missing-field")
      .set(missingRestaurantId),
  );
  await assertFails(
    db.doc("restaurant_claim_requests/canonical-forged-requester").set(
      restaurantClaimRequestData("canonical-forged-requester", exactId, {
        requesterUserId: "customer-b",
      }),
    ),
  );
});

test("Admin claim approval atomically assigns a canonical active restaurant", async () => {
  const restaurantId = "claim-approval-active";
  const claimId = "claim-approval-active";
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_restaurants/${restaurantId}`,
      data: claimableBiteScoreRestaurantData(restaurantId),
    },
    {
      documentPath: `restaurant_claim_requests/${claimId}`,
      data: restaurantClaimRequestData(claimId, restaurantId),
    },
  ]);

  const db = dbFor("admin");
  await assertSucceeds(
    restaurantClaimApprovalBatch(db, { claimId, restaurantId }).commit(),
  );
  const claim = (await db.doc(
    `restaurant_claim_requests/${claimId}`,
  ).get()).data();
  const restaurant = (await db.doc(
    `bitescore_restaurants/${restaurantId}`,
  ).get()).data();
  assert.equal(claim.status, "approved");
  assert.equal(restaurant.ownerUserId, "customer-a");
  assert.equal(restaurant.isClaimed, true);
  assert.equal(restaurant.restaurantWriteRevision, 5);
});

test("Admin approval rejects hidden, malformed, claimed, and locked states", async () => {
  const db = dbFor("admin");
  const invalidIsClaimedValues = [
    ["claimed-true", true],
    ["claimed-null", null],
    ["claimed-integer", 0],
    ["claimed-double", 1.5],
    ["claimed-string", "false"],
    ["claimed-map", { malformed: true }],
    ["claimed-list", [false]],
    ["claimed-timestamp", new Date("2026-01-02T00:00:00.000Z")],
    ["claimed-geopoint", new firebase.firestore.GeoPoint(28, -82)],
    ["claimed-reference", db.doc("bitescore_restaurants/bs-1")],
  ];
  const invalidOwnerValues = [
    ["owner-whitespace", " "],
    ["owner-nonempty", "owner-1"],
    ["owner-integer", 7],
    ["owner-double", 1.5],
    ["owner-true", true],
    ["owner-false", false],
    ["owner-map", { malformed: true }],
    ["owner-list", ["owner-1"]],
    ["owner-timestamp", new Date("2026-01-02T00:00:00.000Z")],
    ["owner-geopoint", new firebase.firestore.GeoPoint(28, -82)],
    ["owner-reference", db.doc("bitescore_restaurants/bs-1")],
  ];
  const cases = [
    {
      label: "hidden",
      overrides: { isActive: false, active: false },
    },
    {
      label: "activity-conflict",
      overrides: { isActive: true, active: false },
    },
    {
      label: "activity-malformed",
      overrides: { isActive: "true", active: true },
    },
    { label: "restaurant-id-missing", omittedFields: ["id"] },
    {
      label: "restaurant-id-mismatch",
      overrides: { id: "another-restaurant" },
    },
    ...invalidIsClaimedValues.map(([label, isClaimed]) => ({
      label,
      overrides: { isClaimed },
    })),
    ...invalidOwnerValues.map(([label, ownerUserId]) => ({
      label,
      overrides: { ownerUserId },
    })),
  ];
  const documents = [];
  for (const entry of cases) {
    const restaurantId = `approval-${entry.label}`;
    const claimId = `approval-${entry.label}`;
    documents.push(
      {
        documentPath: `bitescore_restaurants/${restaurantId}`,
        data: claimableBiteScoreRestaurantData(restaurantId, {
          overrides: entry.overrides,
          omittedFields: entry.omittedFields,
        }),
      },
      {
        documentPath: `restaurant_claim_requests/${claimId}`,
        data: restaurantClaimRequestData(claimId, restaurantId),
      },
    );
  }
  const lockedId = "approval-locked";
  documents.push(
    {
      documentPath: `bitescore_restaurants/${lockedId}`,
      data: claimableBiteScoreRestaurantData(lockedId),
    },
    {
      documentPath: `restaurant_claim_requests/${lockedId}`,
      data: restaurantClaimRequestData(lockedId, lockedId),
    },
    {
      documentPath:
        `private_rating_restaurant_operation_locks/${lockedId}`,
      data: ratingRestaurantOperationLockData(lockedId),
    },
  );
  await seedRuleTestDocuments(documents);

  for (const entry of [...cases, { label: "locked" }]) {
    const restaurantId = `approval-${entry.label}`;
    const claimId = `approval-${entry.label}`;
    await assertFails(
      restaurantClaimApprovalBatch(db, { claimId, restaurantId }).commit(),
    );
    const claim = (await db.doc(
      `restaurant_claim_requests/${claimId}`,
    ).get()).data();
    assert.equal(claim.status, "pending", entry.label);
  }
});

test("Admin approval requires getAfter ownership and narrow exact identities", async () => {
  const variants = [
    { label: "status-only", statusOnly: true },
    { label: "claim-id", claimPatch: { id: "another-claim" } },
    {
      label: "claim-restaurant",
      claimPatch: { restaurantId: "another-restaurant" },
    },
    {
      label: "claim-requester",
      claimPatch: { requesterUserId: "customer-b" },
    },
    {
      label: "claim-extra-field",
      claimPatch: { claimantName: "Changed during approval" },
    },
    { label: "restaurant-owner", restaurantPatch: { ownerUserId: "customer-b" } },
    { label: "restaurant-claimed", restaurantPatch: { isClaimed: false } },
    { label: "restaurant-extra-field", restaurantPatch: { bio: "Too broad" } },
    { label: "restaurant-hidden-after", restaurantPatch: { active: false } },
    { label: "stale-revision", nextRevision: 4 },
  ];
  await seedRuleTestDocuments(variants.flatMap((entry) => {
    const restaurantId = `approval-after-${entry.label}`;
    const claimId = `approval-after-${entry.label}`;
    return [
      {
        documentPath: `bitescore_restaurants/${restaurantId}`,
        data: claimableBiteScoreRestaurantData(restaurantId),
      },
      {
        documentPath: `restaurant_claim_requests/${claimId}`,
        data: restaurantClaimRequestData(claimId, restaurantId),
      },
    ];
  }));

  const db = dbFor("admin");
  for (const entry of variants) {
    const restaurantId = `approval-after-${entry.label}`;
    const claimId = `approval-after-${entry.label}`;
    const write = entry.statusOnly
      ? db.doc(`restaurant_claim_requests/${claimId}`).update({
        status: "approved",
        updatedAt: serverTimestamp(),
      })
      : restaurantClaimApprovalBatch(db, {
        claimId,
        restaurantId,
        claimPatch: entry.claimPatch,
        restaurantPatch: entry.restaurantPatch,
        nextRevision: entry.nextRevision,
      }).commit();
    await assertFails(write);
    const claim = (await db.doc(
      `restaurant_claim_requests/${claimId}`,
    ).get()).data();
    const restaurant = (await db.doc(
      `bitescore_restaurants/${restaurantId}`,
    ).get()).data();
    assert.equal(claim.status, "pending", entry.label);
    assert.equal(restaurant.isClaimed, false, entry.label);
    assert.equal(restaurant.ownerUserId, undefined, entry.label);
    assert.equal(restaurant.restaurantWriteRevision, 4, entry.label);
  }
});

test("claim approval observes state, claim, and lock changes before commit", async () => {
  const variants = ["hidden", "claimed", "lock", "request-rejected"];
  await seedRuleTestDocuments(variants.flatMap((label) => {
    const restaurantId = `approval-race-${label}`;
    const claimId = `approval-race-${label}`;
    return [
      {
        documentPath: `bitescore_restaurants/${restaurantId}`,
        data: claimableBiteScoreRestaurantData(restaurantId),
      },
      {
        documentPath: `restaurant_claim_requests/${claimId}`,
        data: restaurantClaimRequestData(claimId, restaurantId),
      },
    ];
  }));

  const db = dbFor("admin");
  for (const label of variants) {
    const restaurantId = `approval-race-${label}`;
    const claimId = `approval-race-${label}`;
    const preparedApproval = restaurantClaimApprovalBatch(db, {
      claimId,
      restaurantId,
      nextRevision: label == "hidden" || label == "claimed" ? 6 : 5,
    });
    if (label == "hidden") {
      await db.doc(`bitescore_restaurants/${restaurantId}`).update({
        isActive: false,
        active: false,
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      });
    } else if (label == "claimed") {
      await db.doc(`bitescore_restaurants/${restaurantId}`).update({
        ownerUserId: "customer-b",
        isClaimed: true,
        restaurantWriteRevision: 5,
        updatedAt: serverTimestamp(),
      });
    } else if (label == "lock") {
      await seedRuleTestDocuments([{
        documentPath:
          `private_rating_restaurant_operation_locks/${restaurantId}`,
        data: ratingRestaurantOperationLockData(restaurantId),
      }]);
    } else {
      await db.doc(`restaurant_claim_requests/${claimId}`).update({
        status: "rejected",
        updatedAt: serverTimestamp(),
      });
    }

    await assertFails(preparedApproval.commit());
    const claim = (await db.doc(
      `restaurant_claim_requests/${claimId}`,
    ).get()).data();
    const restaurant = (await db.doc(
      `bitescore_restaurants/${restaurantId}`,
    ).get()).data();
    assert.notEqual(claim.status, "approved", label);
    assert.notEqual(restaurant.ownerUserId, "customer-a", label);
  }
});

test("claim denial remains independent and clients cannot assign ownership", async () => {
  const restaurantId = "claim-denial-hidden";
  const claimId = "claim-denial-hidden";
  const ordinaryRestaurantId = "claim-direct-owner-assignment";
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_restaurants/${restaurantId}`,
      data: claimableBiteScoreRestaurantData(restaurantId, {
        overrides: { isActive: false, active: false },
      }),
    },
    {
      documentPath: `restaurant_claim_requests/${claimId}`,
      data: restaurantClaimRequestData(claimId, restaurantId),
    },
    {
      documentPath: `bitescore_restaurants/${ordinaryRestaurantId}`,
      data: claimableBiteScoreRestaurantData(ordinaryRestaurantId),
    },
  ]);

  await assertSucceeds(
    dbFor("admin").doc(`restaurant_claim_requests/${claimId}`).update({
      status: "rejected",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("customer").doc(
      `bitescore_restaurants/${ordinaryRestaurantId}`,
    ).update({
      ownerUserId: "customer-a",
      isClaimed: true,
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("biteScoreOwner").doc("bitescore_restaurants/bs-1").update({
      ownerUserId: "customer-a",
      isClaimed: true,
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("customer").doc(`restaurant_claim_requests/${claimId}`).update({
      status: "approved",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("admin custom claim can read/update moderation and admin workflows", async () => {
  const db = dbFor("admin");
  await assertSucceeds(
    db.collection("restaurant_accounts")
      .where("couponApplicationSubmitted", "==", true)
      .get(),
  );
  await assertSucceeds(
    db.doc("restaurant_accounts/pending-owner").set(
      {
        approvalStatus: "approved",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  await assertSucceeds(
    db.doc("restaurant_claim_requests/claim-1").set(
      {
        status: "rejected",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  await assertSucceeds(
    db.doc("review_reports/review-report-1").set(
      {
        status: "dismissed",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
  await assertSucceeds(
    db.doc("bitesaver_reports/bitesaver-report-1").set(
      {
        status: "resolved",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
});

test("ordinary unlocked review create, update, and delete remain allowed", async () => {
  const db = dbFor("customer");
  const reviewRef = db.doc("dish_reviews/rules-unlocked-review");
  await seedRuleTestDocuments([
    {
      documentPath: "bitescore_dishes/rules-unlocked-dish",
      data: ruleTestDishData("rules-unlocked-dish"),
    },
  ]);

  await assertSucceeds(
    reviewRef.set(
      reviewWriteData({
        id: "rules-unlocked-review",
        dishId: "rules-unlocked-dish",
      }),
    ),
  );
  await assertSucceeds(
    reviewRef.update({
      headline: "Updated while unlocked",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(reviewRef.delete());
});

test("an active review milestone lock blocks review create, update, and delete", async () => {
  const dishId = "rules-milestone-locked-dish";
  const reviewPath = "dish_reviews/rules-milestone-locked-existing";
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId),
    },
    {
      documentPath: reviewPath,
      data: reviewWriteData({
        id: "rules-milestone-locked-existing",
        dishId,
      }),
    },
    {
      documentPath:
        "private_review_milestone_reconciliation_locks/customer-a",
      data: reviewMilestoneLockData("customer-a"),
    },
  ]);

  const customerDb = dbFor("customer");
  await assertFails(
    customerDb.doc("dish_reviews/rules-milestone-locked-create").set(
      reviewWriteData({
        id: "rules-milestone-locked-create",
        dishId,
      }),
    ),
  );
  await assertFails(
    customerDb.doc(reviewPath).update({
      headline: "Blocked while milestone locked",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(customerDb.doc(reviewPath).delete());
  await assertFails(
    dbFor("admin").doc(reviewPath).update({
      headline: "Admin is also blocked by the private lock",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(dbFor("admin").doc(reviewPath).delete());
});

test("review updates check both current and requested milestone-lock users", async () => {
  const dishId = "rules-milestone-identity-dish";
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId),
    },
    {
      documentPath: "dish_reviews/rules-unlocked-to-locked-user",
      data: reviewWriteData({
        id: "rules-unlocked-to-locked-user",
        dishId,
        userId: "customer-b",
      }),
    },
    {
      documentPath: "dish_reviews/rules-locked-to-unlocked-user",
      data: reviewWriteData({
        id: "rules-locked-to-unlocked-user",
        dishId,
      }),
    },
    {
      documentPath: "dish_reviews/rules-unlocked-to-unlocked-user",
      data: reviewWriteData({
        id: "rules-unlocked-to-unlocked-user",
        dishId,
        userId: "customer-b",
      }),
    },
    {
      documentPath:
        "private_review_milestone_reconciliation_locks/customer-a",
      data: reviewMilestoneLockData("customer-a"),
    },
  ]);

  const adminDb = dbFor("admin");
  await assertFails(
    adminDb.doc("dish_reviews/rules-unlocked-to-locked-user").update({
      userId: "customer-a",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    adminDb.doc("dish_reviews/rules-locked-to-unlocked-user").update({
      userId: "customer-b",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    adminDb.doc("dish_reviews/rules-unlocked-to-unlocked-user").update({
      userId: "owner-2",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("an unrelated unlocked review user remains unaffected", async () => {
  const dishId = "rules-milestone-unrelated-dish";
  const reviewRef = dbFor("wrongCustomer").doc(
    "dish_reviews/rules-milestone-unrelated-review",
  );
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId),
    },
    {
      documentPath:
        "private_review_milestone_reconciliation_locks/customer-a",
      data: reviewMilestoneLockData("customer-a"),
    },
  ]);

  await assertSucceeds(
    reviewRef.set(
      reviewWriteData({
        id: "rules-milestone-unrelated-review",
        dishId,
        userId: "customer-b",
      }),
    ),
  );
  await assertSucceeds(
    reviewRef.update({
      headline: "Unrelated user remains writable",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(reviewRef.delete());
});

test("a strict released milestone lock restores ordinary review writes", async () => {
  const dishId = "rules-milestone-released-dish";
  const reviewRef = dbFor("customer").doc(
    "dish_reviews/rules-milestone-released-review",
  );
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId),
    },
    {
      documentPath:
        "private_review_milestone_reconciliation_locks/customer-a",
      data: reviewMilestoneLockData("customer-a", { state: "released" }),
    },
  ]);

  await assertSucceeds(
    reviewRef.set(
      reviewWriteData({
        id: "rules-milestone-released-review",
        dishId,
      }),
    ),
  );
  await assertSucceeds(
    reviewRef.update({
      headline: "Released lock is terminal",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(reviewRef.delete());
});

test("a malformed released milestone lock remains fail-closed", async () => {
  const dishId = "rules-milestone-malformed-lock-dish";
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId),
    },
    {
      documentPath:
        "private_review_milestone_reconciliation_locks/customer-a",
      data: reviewMilestoneLockData("customer-a", {
        state: "released",
        fingerprint: "not-a-valid-fingerprint",
      }),
    },
  ]);

  await assertFails(
    dbFor("customer").doc("dish_reviews/rules-malformed-lock-create").set(
      reviewWriteData({
        id: "rules-malformed-lock-create",
        dishId,
      }),
    ),
  );
});

test("private review milestone lock and terminal state cannot cross client boundary", async () => {
  const activePath =
    "private_review_milestone_reconciliation_locks/customer-a";
  const newPath =
    "private_review_milestone_reconciliation_locks/customer-b";
  const terminalPath =
    "private_review_milestone_reconciliation_terminal_states/customer-a";
  const newTerminalPath =
    "private_review_milestone_reconciliation_terminal_states/customer-b";
  await seedRuleTestDocuments([
    {
      documentPath: activePath,
      data: reviewMilestoneLockData("customer-a"),
    },
    {
      documentPath: terminalPath,
      data: {version: "private-terminal-canary"},
    },
  ]);

  for (const actorName of ["customer", "admin"]) {
    const db = dbFor(actorName);
    await assertFails(db.doc(activePath).get());
    await assertFails(
      db.doc(newPath).set(reviewMilestoneLockData("customer-b")),
    );
    await assertFails(
      db.doc(activePath).update({
        state: "released",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(db.doc(activePath).delete());
    await assertFails(db.doc(terminalPath).get());
    await assertFails(
      db.doc(newTerminalPath).set({version: "private-terminal-canary"}),
    );
    await assertFails(
      db.doc(terminalPath).update({version: "private-terminal-updated"}),
    );
    await assertFails(db.doc(terminalPath).delete());
  }
});

test("review writes reject lexical dish aliases even when alias dishes exist", async () => {
  const sourceDishId = "rules-canonical-review-source";
  const otherDishId = "rules-canonical-review-other";
  const aliasDishIds = [
    ` ${sourceDishId} `,
    `${sourceDishId} `,
    `\t${sourceDishId}`,
  ];
  await seedMergeReviewLocks([sourceDishId]);
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${otherDishId}`,
      data: ruleTestDishData(otherDishId),
    },
    ...aliasDishIds.map((dishId) => ({
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId),
    })),
    ...aliasDishIds.map((dishId, index) => ({
      documentPath: `dish_reviews/rules-current-alias-review-${index}`,
      data: reviewWriteData({
        id: `rules-current-alias-review-${index}`,
        dishId,
      }),
    })),
    {
      documentPath: "dish_reviews/rules-current-canonical-review",
      data: reviewWriteData({
        id: "rules-current-canonical-review",
        dishId: otherDishId,
      }),
    },
    {
      documentPath: "dish_reviews/rules-current-locked-review",
      data: reviewWriteData({
        id: "rules-current-locked-review",
        dishId: sourceDishId,
      }),
    },
  ]);
  const customerDb = dbFor("customer");

  await assertFails(
    customerDb.doc("dish_reviews/rules-exact-locked-create").set(
      reviewWriteData({
        id: "rules-exact-locked-create",
        dishId: sourceDishId,
      }),
    ),
  );

  for (const [index, dishId] of aliasDishIds.entries()) {
    await assertFails(
      customerDb.doc(`dish_reviews/rules-alias-create-${index}`).set(
        reviewWriteData({
          id: `rules-alias-create-${index}`,
          dishId,
        }),
      ),
    );
    await assertFails(
      customerDb.doc(`dish_reviews/rules-current-alias-review-${index}`).update({
        dishId: otherDishId,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      customerDb.doc("dish_reviews/rules-current-canonical-review").update({
        dishId,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      customerDb.doc(`dish_reviews/rules-current-alias-review-${index}`).delete(),
    );
  }

  await assertFails(
    customerDb.doc("dish_reviews/rules-slash-alias-create").set(
      reviewWriteData({
        id: "rules-slash-alias-create",
        dishId: `${sourceDishId}/alias`,
      }),
    ),
  );
  await assertFails(
    customerDb.doc("dish_reviews/rules-current-locked-review").update({
      dishId: `${sourceDishId} `,
      updatedAt: serverTimestamp(),
    }),
  );

  const clientAliasDishId = ` ${sourceDishId}-client `;
  await assertFails(
    customerDb.doc(`bitescore_dishes/${clientAliasDishId}`).set(
      biteScoreDishCreateData({
        id: clientAliasDishId,
        createdFromReviewId: "rules-alias-client-review",
      }),
    ),
  );
});

test("source and target review creates are blocked by active merge locks", async () => {
  const sourceDishId = "rules-review-create-source";
  const targetDishId = "rules-review-create-target";
  const db = dbFor("customer");
  await seedMergeReviewLocks([sourceDishId, targetDishId]);

  await assertFails(
    db.doc("dish_reviews/rules-locked-source-create").set(
      reviewWriteData({
        id: "rules-locked-source-create",
        dishId: sourceDishId,
      }),
    ),
  );
  await assertFails(
    db.doc("dish_reviews/rules-locked-target-create").set(
      reviewWriteData({
        id: "rules-locked-target-create",
        dishId: targetDishId,
      }),
    ),
  );
});

test("review updates check both current and requested dish locks", async () => {
  const sourceDishId = "rules-review-update-source";
  const targetDishId = "rules-review-update-target";
  const otherDishId = "rules-review-update-other";
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${otherDishId}`,
      data: ruleTestDishData(otherDishId),
    },
    {
      documentPath: "dish_reviews/rules-current-source-review",
      data: reviewWriteData({
        id: "rules-current-source-review",
        dishId: sourceDishId,
      }),
    },
    {
      documentPath: "dish_reviews/rules-current-target-review",
      data: reviewWriteData({
        id: "rules-current-target-review",
        dishId: targetDishId,
      }),
    },
    {
      documentPath: "dish_reviews/rules-moved-target-review",
      data: reviewWriteData({
        id: "rules-moved-target-review",
        dishId: targetDishId,
      }),
    },
    {
      documentPath: "dish_reviews/rules-source-to-other-review",
      data: reviewWriteData({
        id: "rules-source-to-other-review",
        dishId: sourceDishId,
      }),
    },
    {
      documentPath: "dish_reviews/rules-other-to-source-review",
      data: reviewWriteData({
        id: "rules-other-to-source-review",
        dishId: otherDishId,
      }),
    },
  ]);
  await seedMergeReviewLocks([sourceDishId, targetDishId]);
  const db = dbFor("customer");

  await assertFails(
    db.doc("dish_reviews/rules-current-source-review").update({
      headline: "Blocked source update",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    db.doc("dish_reviews/rules-current-target-review").update({
      headline: "Blocked target update",
      updatedAt: serverTimestamp(),
    }),
  );

  await removeMergeReviewLock(targetDishId);

  await assertFails(
    db.doc("dish_reviews/rules-moved-target-review").update({
      dishId: sourceDishId,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    db.doc("dish_reviews/rules-source-to-other-review").update({
      dishId: otherDishId,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    db.doc("dish_reviews/rules-other-to-source-review").update({
      dishId: sourceDishId,
      updatedAt: serverTimestamp(),
    }),
  );
});

test("review delete is blocked while its dish is merge locked", async () => {
  const sourceDishId = "rules-review-delete-source";
  const reviewPath = "dish_reviews/rules-locked-delete-review";
  await seedRuleTestDocuments([
    {
      documentPath: reviewPath,
      data: reviewWriteData({
        id: "rules-locked-delete-review",
        dishId: sourceDishId,
      }),
    },
  ]);
  await seedMergeReviewLocks([sourceDishId]);

  await assertFails(dbFor("customer").doc(reviewPath).delete());
  await assertFails(dbFor("admin").doc(reviewPath).delete());
});

test("source and target aggregate writes are blocked by active merge locks", async () => {
  const sourceDishId = "rules-aggregate-source";
  const targetDishId = "rules-aggregate-target";
  await seedMergeReviewLocks([sourceDishId, targetDishId]);
  const customerDb = dbFor("customer");

  await assertFails(
    customerDb
      .doc(`dish_rating_aggregates/${sourceDishId}`)
      .set(aggregateWriteData({
        dishId: sourceDishId,
        aggregateWriteGeneration: 1,
      })),
  );
  await assertFails(
    customerDb
      .doc(`dish_rating_aggregates/${targetDishId}`)
      .set(aggregateWriteData({
        dishId: targetDishId,
        aggregateWriteGeneration: 1,
      })),
  );

  await seedRuleTestDocuments([
    {
      documentPath: `dish_rating_aggregates/${sourceDishId}`,
      data: aggregateWriteData({
        dishId: sourceDishId,
        aggregateWriteGeneration: 1,
      }),
    },
    {
      documentPath: `dish_rating_aggregates/${targetDishId}`,
      data: aggregateWriteData({
        dishId: targetDishId,
        aggregateWriteGeneration: 1,
      }),
    },
  ]);

  await assertFails(
    customerDb.doc(`dish_rating_aggregates/${sourceDishId}`).update({
      ratingCount: 2,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    customerDb.doc(`dish_rating_aggregates/${targetDishId}`).update({
      ratingCount: 2,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("admin").doc(`dish_rating_aggregates/${sourceDishId}`).delete(),
  );
  await assertFails(
    dbFor("admin").doc(`dish_rating_aggregates/${targetDishId}`).delete(),
  );
});

test("any exact merge lock document blocks review and aggregate writes fail closed", async () => {
  const createDishId = "rules-malformed-lock-create";
  const existingDishId = "rules-malformed-lock-existing";
  await seedRuleTestDocuments([
    ...[createDishId, existingDishId].flatMap((dishId) => [
      {
        documentPath: `bitescore_dishes/${dishId}`,
        data: ruleTestDishData(dishId, {
          aggregateWriteGeneration: 1,
        }),
      },
      {
        documentPath: `private_dish_merge_review_locks/${dishId}`,
        data: mergeReviewLockData(dishId, {
          blocksClientReviews: false,
          blocksClientAggregates: false,
        }),
      },
    ]),
    {
      documentPath: "dish_reviews/rules-malformed-lock-existing-review",
      data: reviewWriteData({
        id: "rules-malformed-lock-existing-review",
        dishId: existingDishId,
      }),
    },
    {
      documentPath: `dish_rating_aggregates/${existingDishId}`,
      data: aggregateWriteData({
        dishId: existingDishId,
        aggregateWriteGeneration: 1,
      }),
    },
  ]);
  const customerDb = dbFor("customer");

  await assertFails(
    customerDb.doc("dish_reviews/rules-malformed-lock-create-review").set(
      reviewWriteData({
        id: "rules-malformed-lock-create-review",
        dishId: createDishId,
      }),
    ),
  );
  await assertFails(
    customerDb.doc("dish_reviews/rules-malformed-lock-existing-review").update({
      headline: "Malformed lock must remain blocking",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    customerDb.doc("dish_reviews/rules-malformed-lock-existing-review").delete(),
  );
  await assertFails(
    customerDb.doc(`dish_rating_aggregates/${createDishId}`).set(
      aggregateWriteData({
        dishId: createDishId,
        aggregateWriteGeneration: 1,
      }),
    ),
  );
  await assertFails(
    customerDb.doc(`dish_rating_aggregates/${existingDishId}`).update({
      ratingCount: 2,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    dbFor("admin").doc(`dish_rating_aggregates/${existingDishId}`).delete(),
  );
});

test("aggregate writes default missing generations to zero and require an exact match", async () => {
  const customerDb = dbFor("customer");
  const generatedDishId = "rules-generated-aggregate-dish";
  const explicitZeroDishId = "rules-explicit-zero-aggregate-dish";
  const maxSafeDishId = "rules-max-safe-aggregate-dish";

  await assertSucceeds(
    customerDb.doc("dish_rating_aggregates/dish-1").update({
      ratingCount: 2,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    customerDb.doc("dish_rating_aggregates/dish-1").set(
      {
        aggregateWriteGeneration: 0,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );

  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${generatedDishId}`,
      data: ruleTestDishData(generatedDishId, {
        aggregateWriteGeneration: 1,
      }),
    },
    {
      documentPath: `bitescore_dishes/${explicitZeroDishId}`,
      data: ruleTestDishData(explicitZeroDishId, {
        aggregateWriteGeneration: 0,
      }),
    },
    {
      documentPath: `bitescore_dishes/${maxSafeDishId}`,
      data: ruleTestDishData(maxSafeDishId, {
        aggregateWriteGeneration: 9007199254740991,
      }),
    },
  ]);
  const generatedAggregateRef = customerDb.doc(
    `dish_rating_aggregates/${generatedDishId}`,
  );

  await assertFails(
    generatedAggregateRef.set(
      aggregateWriteData({ dishId: generatedDishId }),
    ),
  );
  await assertFails(
    generatedAggregateRef.set(
      aggregateWriteData({
        dishId: generatedDishId,
        aggregateWriteGeneration: 0,
      }),
    ),
  );
  await assertFails(
    generatedAggregateRef.set(
      aggregateWriteData({
        dishId: generatedDishId,
        aggregateWriteGeneration: 2,
      }),
    ),
  );
  await assertSucceeds(
    generatedAggregateRef.set(
      aggregateWriteData({
        dishId: generatedDishId,
        aggregateWriteGeneration: 1,
      }),
    ),
  );
  await assertFails(
    generatedAggregateRef.update({
      aggregateWriteGeneration: 0,
      updatedAt: serverTimestamp(),
    }),
  );

  await assertSucceeds(
    customerDb.doc(`dish_rating_aggregates/${explicitZeroDishId}`).set(
      aggregateWriteData({ dishId: explicitZeroDishId }),
    ),
  );
  await assertSucceeds(
    customerDb.doc(`dish_rating_aggregates/${maxSafeDishId}`).set(
      aggregateWriteData({
        dishId: maxSafeDishId,
        aggregateWriteGeneration: 9007199254740991,
      }),
    ),
  );

  for (const generation of [-1, 1.5, 9007199254740992, "0", null]) {
    await assertFails(
      customerDb.doc("dish_rating_aggregates/dish-1").set(
        aggregateWriteData({
          dishId: "dish-1",
          aggregateWriteGeneration: generation,
        }),
      ),
    );
  }

  for (const [index, generation] of [
    -1,
    1.5,
    9007199254740992,
    "1",
    null,
  ].entries()) {
    const malformedDishId = `rules-malformed-generation-${index}`;
    await seedRuleTestDocuments([
      {
        documentPath: `bitescore_dishes/${malformedDishId}`,
        data: ruleTestDishData(malformedDishId, {
          aggregateWriteGeneration: generation,
        }),
      },
    ]);
    await assertFails(
      customerDb.doc(`dish_rating_aggregates/${malformedDishId}`).set(
        aggregateWriteData({
          dishId: malformedDishId,
          aggregateWriteGeneration: generation,
        }),
      ),
    );
  }
});

test("pre-claim and active-lock aggregate payloads stay stale after completion", async () => {
  const dishId = "rules-delayed-aggregate-dish";
  const preClaimAggregate = aggregateWriteData({
    dishId,
    aggregateWriteGeneration: 0,
  });
  const activeLockAggregate = aggregateWriteData({
    dishId,
    aggregateWriteGeneration: 1,
  });
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId),
    },
  ]);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();
    batch.set(
      db.doc(`bitescore_dishes/${dishId}`),
      { aggregateWriteGeneration: 1 },
      { merge: true },
    );
    batch.set(
      db.doc(`private_dish_merge_review_locks/${dishId}`),
      mergeReviewLockData(dishId, {
        role: "target",
        activeAggregateWriteGeneration: 1,
        completionAggregateWriteGeneration: 2,
      }),
    );
    await batch.commit();
  });

  const aggregateRef = dbFor("customer").doc(
    `dish_rating_aggregates/${dishId}`,
  );
  await assertFails(aggregateRef.set(preClaimAggregate));
  await assertFails(aggregateRef.set(activeLockAggregate));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();
    batch.set(
      db.doc(`bitescore_dishes/${dishId}`),
      { aggregateWriteGeneration: 2 },
      { merge: true },
    );
    batch.set(
      db.doc(`dish_rating_aggregates/${dishId}`),
      aggregateWriteData({
        dishId,
        aggregateWriteGeneration: 2,
      }),
    );
    batch.delete(db.doc(`private_dish_merge_review_locks/${dishId}`));
    await batch.commit();
  });

  await assertFails(aggregateRef.set(preClaimAggregate));
  await assertFails(aggregateRef.set(activeLockAggregate));
  await assertSucceeds(
    aggregateRef.set(
      aggregateWriteData({
        dishId,
        aggregateWriteGeneration: 2,
      }),
    ),
  );
});

test("aggregate writes reject lexical path and body aliases even when alias dishes exist", async () => {
  const sourceDishId = "rules-canonical-aggregate-source";
  const otherDishId = "rules-canonical-aggregate-other";
  const aliasDishIds = [
    ` ${sourceDishId} `,
    `${sourceDishId} `,
    `\t${sourceDishId}`,
  ];
  await seedMergeReviewLocks([sourceDishId]);
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${otherDishId}`,
      data: ruleTestDishData(otherDishId),
    },
    ...aliasDishIds.map((dishId) => ({
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId),
    })),
    ...aliasDishIds.map((dishId, index) => ({
      documentPath: `dish_rating_aggregates/${dishId}`,
      data: aggregateWriteData({
        dishId,
        aggregateWriteGeneration: 0,
      }),
    })),
    {
      documentPath: `dish_rating_aggregates/${otherDishId}`,
      data: aggregateWriteData({ dishId: otherDishId }),
    },
  ]);
  const customerDb = dbFor("customer");

  await assertFails(
    customerDb.doc(`dish_rating_aggregates/${sourceDishId}`).set(
      aggregateWriteData({
        dishId: sourceDishId,
        aggregateWriteGeneration: 1,
      }),
    ),
  );

  for (const dishId of aliasDishIds) {
    await assertFails(
      customerDb.doc(`dish_rating_aggregates/${dishId}`).set(
        aggregateWriteData({
          dishId,
          aggregateWriteGeneration: 0,
        }),
      ),
    );
    await assertFails(
      customerDb.doc(`dish_rating_aggregates/${otherDishId}`).update({
        dishId,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      customerDb.doc(`dish_rating_aggregates/${dishId}`).update({
        ratingCount: 2,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      dbFor("admin").doc(`dish_rating_aggregates/${dishId}`).delete(),
    );
  }

  await assertFails(
    customerDb.doc(`dish_rating_aggregates/${otherDishId}`).update({
      dishId: `${sourceDishId}/alias`,
      updatedAt: serverTimestamp(),
    }),
  );
});

test("aggregate create, update, and delete check path, current, and requested dish identities", async () => {
  const sourceDishId = "rules-authoritative-source";
  const otherDishId = "rules-authoritative-other";
  await seedMergeReviewLocks([sourceDishId]);
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${otherDishId}`,
      data: ruleTestDishData(otherDishId),
    },
  ]);
  const customerDb = dbFor("customer");

  await assertFails(
    customerDb
      .doc(`dish_rating_aggregates/${sourceDishId}`)
      .set(aggregateWriteData({ dishId: otherDishId })),
  );
  await assertFails(
    customerDb
      .doc("dish_rating_aggregates/rules-create-body-locked")
      .set(aggregateWriteData({ dishId: sourceDishId })),
  );

  await seedRuleTestDocuments([
    {
      documentPath: `dish_rating_aggregates/${sourceDishId}`,
      data: aggregateWriteData({ dishId: otherDishId }),
    },
    {
      documentPath: "dish_rating_aggregates/rules-current-body-locked",
      data: aggregateWriteData({ dishId: sourceDishId }),
    },
    {
      documentPath: "dish_rating_aggregates/rules-requested-body-locked",
      data: aggregateWriteData({ dishId: otherDishId }),
    },
  ]);

  await assertFails(
    customerDb.doc(`dish_rating_aggregates/${sourceDishId}`).update({
      ratingCount: 2,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    customerDb.doc("dish_rating_aggregates/rules-current-body-locked").update({
      dishId: otherDishId,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    customerDb.doc("dish_rating_aggregates/rules-requested-body-locked").update({
      dishId: sourceDishId,
      updatedAt: serverTimestamp(),
    }),
  );

  await assertFails(
    dbFor("admin").doc(`dish_rating_aggregates/${sourceDishId}`).delete(),
  );
  await assertFails(
    dbFor("admin")
      .doc("dish_rating_aggregates/rules-current-body-locked")
      .delete(),
  );
});

test("target writes resume after unlock while source stays protected and unrelated dishes remain unaffected", async () => {
  const sourceDishId = "rules-permanent-source";
  const targetDishId = "rules-unlocked-target";
  const otherDishId = "rules-unrelated-dish";
  await seedMergeReviewLocks([sourceDishId, targetDishId]);
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${sourceDishId}`,
      data: ruleTestDishData(sourceDishId, {
        aggregateWriteGeneration: 2,
      }),
    },
    {
      documentPath: `bitescore_dishes/${otherDishId}`,
      data: ruleTestDishData(otherDishId),
    },
    {
      documentPath: `private_dish_merge_review_locks/${sourceDishId}`,
      data: mergeReviewLockData(sourceDishId, {
        state: "merged_source",
        targetDishId,
        activeAggregateWriteGeneration: 2,
        completionAggregateWriteGeneration: 2,
      }),
    },
  ]);
  await removeMergeReviewLock(targetDishId);
  const customerDb = dbFor("customer");
  const targetReviewRef = customerDb.doc(
    "dish_reviews/rules-unlocked-target-review",
  );
  const targetAggregateRef = customerDb.doc(
    `dish_rating_aggregates/${targetDishId}`,
  );

  await assertSucceeds(
    targetReviewRef.set(
      reviewWriteData({
        id: "rules-unlocked-target-review",
        dishId: targetDishId,
      }),
    ),
  );
  await assertSucceeds(
    targetReviewRef.update({
      headline: "Target unlocked",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(targetReviewRef.delete());

  await assertSucceeds(
    targetAggregateRef.set(aggregateWriteData({
      dishId: targetDishId,
      aggregateWriteGeneration: 2,
    })),
  );
  await assertSucceeds(
    targetAggregateRef.update({
      ratingCount: 2,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    dbFor("admin").doc(`dish_rating_aggregates/${targetDishId}`).delete(),
  );

  await assertFails(
    customerDb.doc("dish_reviews/rules-permanent-source-review").set(
      reviewWriteData({
        id: "rules-permanent-source-review",
        dishId: sourceDishId,
      }),
    ),
  );
  await assertFails(
    customerDb
      .doc(`dish_rating_aggregates/${sourceDishId}`)
      .set(aggregateWriteData({
        dishId: sourceDishId,
        aggregateWriteGeneration: 2,
      })),
  );

  await assertSucceeds(
    customerDb.doc("dish_reviews/rules-unrelated-review").set(
      reviewWriteData({
        id: "rules-unrelated-review",
        dishId: otherDishId,
      }),
    ),
  );
  await assertSucceeds(
    customerDb
      .doc(`dish_rating_aggregates/${otherDishId}`)
      .set(aggregateWriteData({ dishId: otherDishId })),
  );
});

test("private merge review locks cannot be read or written by clients", async () => {
  const sourceDishId = "rules-private-lock-source";
  const lockRefForCustomer = dbFor("customer").doc(
    `private_dish_merge_review_locks/${sourceDishId}`,
  );
  const lockRefForAdmin = dbFor("admin").doc(
    `private_dish_merge_review_locks/${sourceDishId}`,
  );
  await seedMergeReviewLocks([sourceDishId]);

  await assertFails(lockRefForCustomer.get());
  await assertFails(lockRefForAdmin.get());
  await assertFails(
    lockRefForCustomer.set(
      {
        blocksClientReviews: false,
        blocksClientAggregates: false,
      },
      { merge: true },
    ),
  );
  await assertFails(lockRefForAdmin.delete());
});

test("rating destructive jobs, items, descendants, and locks stay private", async () => {
  const existingPaths = [
    "private_rating_destructive_jobs/job-existing",
    "private_rating_destructive_job_items/item-existing",
    "private_rating_destructive_job_items/item-existing/steps/step-existing",
    "private_rating_restaurant_operation_locks/restaurant-existing",
    "private_rating_dish_operation_locks/dish-existing",
  ];
  const newPaths = [
    "private_rating_destructive_jobs/job-new",
    "private_rating_destructive_job_items/item-new",
    "private_rating_destructive_job_items/item-new/steps/step-new",
    "private_rating_restaurant_operation_locks/restaurant-new",
    "private_rating_dish_operation_locks/dish-new",
  ];
  await seedRuleTestDocuments(existingPaths.map((documentPath) => ({
    documentPath,
    data: {privateCanary: "rating-destructive-private-canary"},
  })));

  for (const actorName of ["customer", "admin"]) {
    const db = dbFor(actorName);
    for (const documentPath of existingPaths) {
      await assertFails(db.doc(documentPath).get());
      await assertFails(db.doc(documentPath).update({state: "forged"}));
      await assertFails(db.doc(documentPath).delete());
    }
    for (const documentPath of newPaths) {
      await assertFails(db.doc(documentPath).set({state: "forged"}));
    }
  }
});

test("restaurant operation locks fail closed and deletion unlocks only the target", async () => {
  const lockedStates = [
    ["active", ratingRestaurantOperationLockData("unused", "active")],
    [
      "permanent",
      ratingRestaurantOperationLockData("unused", "merged_source"),
    ],
    ["malformed", {unexpected: "malformed-present-lock"}],
  ];
  const documents = [];
  for (const [label, lockTemplate] of lockedStates) {
    const existingId = `rules-restaurant-${label}`;
    const createId = `rules-restaurant-create-${label}`;
    documents.push(
      {
        documentPath: `bitescore_restaurants/${existingId}`,
        data: {
          ...biteScoreRestaurantCreateData({id: existingId}),
          restaurantWriteRevision: 4,
        },
      },
      {
        documentPath:
          `private_rating_restaurant_operation_locks/${existingId}`,
        data: {...lockTemplate, restaurantId: existingId},
      },
      {
        documentPath:
          `private_rating_restaurant_operation_locks/${createId}`,
        data: {...lockTemplate, restaurantId: createId},
      },
    );
  }
  const unlockId = "rules-restaurant-unlock-target";
  const unrelatedId = "rules-restaurant-unrelated";
  documents.push(
    {
      documentPath: `bitescore_restaurants/${unlockId}`,
      data: {
        ...biteScoreRestaurantCreateData({id: unlockId}),
        restaurantWriteRevision: 4,
      },
    },
    {
      documentPath:
        `private_rating_restaurant_operation_locks/${unlockId}`,
      data: ratingRestaurantOperationLockData(unlockId),
    },
    {
      documentPath: `bitescore_restaurants/${unrelatedId}`,
      data: {
        ...biteScoreRestaurantCreateData({id: unrelatedId}),
        restaurantWriteRevision: 4,
      },
    },
  );
  await seedRuleTestDocuments(documents);
  const adminDb = dbFor("admin");

  for (const [label] of lockedStates) {
    const existingRef = adminDb.doc(
      `bitescore_restaurants/rules-restaurant-${label}`,
    );
    await assertFails(existingRef.update({
      bio: "Blocked by exact operation lock",
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(existingRef.delete());
    const createId = `rules-restaurant-create-${label}`;
    await assertFails(
      adminDb.doc(`bitescore_restaurants/${createId}`).set(
        biteScoreRestaurantCreateData({id: createId}),
      ),
    );
  }

  const unlockRef = adminDb.doc(`bitescore_restaurants/${unlockId}`);
  await assertFails(unlockRef.update({
    bio: "Still locked",
    restaurantWriteRevision: 5,
    updatedAt: serverTimestamp(),
  }));
  await deleteRuleTestDocuments([
    `private_rating_restaurant_operation_locks/${unlockId}`,
  ]);
  await assertSucceeds(unlockRef.update({
    bio: "Unlocked after safe boundary",
    restaurantWriteRevision: 5,
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(
    adminDb.doc(`bitescore_restaurants/${unrelatedId}`).update({
      bio: "Unrelated remains writable",
      restaurantWriteRevision: 5,
      updatedAt: serverTimestamp(),
    }),
  );
  const unlockedCreateId = "rules-restaurant-unlocked-create";
  await assertSucceeds(
    adminDb.doc(`bitescore_restaurants/${unlockedCreateId}`).set(
      biteScoreRestaurantCreateData({id: unlockedCreateId}),
    ),
  );
  await assertSucceeds(
    adminDb.doc(`bitescore_restaurants/${unlockedCreateId}`).delete(),
  );
});

test("dish writes check the exact dish and requested, current, and new restaurants", async () => {
  const restaurantA = "rules-dish-restaurant-a";
  const restaurantB = "rules-dish-restaurant-b";
  const exactDishId = "rules-exact-operation-locked-dish";
  const currentRestaurantDishId = "rules-current-restaurant-locked-dish";
  const requestedRestaurantDishId = "rules-requested-restaurant-locked-dish";
  const unlockDishId = "rules-unlock-operation-dish";
  await seedRuleTestDocuments([
    ...[
      exactDishId,
      currentRestaurantDishId,
      requestedRestaurantDishId,
      unlockDishId,
    ].map((dishId) => ({
      documentPath: `bitescore_dishes/${dishId}`,
      data: ruleTestDishData(dishId, {restaurantId: restaurantA}),
    })),
    {
      documentPath: `private_rating_dish_operation_locks/${exactDishId}`,
      data: ratingDishOperationLockData(exactDishId, "deleted_source"),
    },
    {
      documentPath:
        `private_rating_restaurant_operation_locks/${restaurantA}`,
      data: ratingRestaurantOperationLockData(restaurantA),
    },
    {
      documentPath:
        `private_rating_restaurant_operation_locks/${restaurantB}`,
      data: {malformed: "present-target-lock"},
    },
    {
      documentPath: `private_rating_dish_operation_locks/${unlockDishId}`,
      data: {malformed: "present-dish-lock"},
    },
  ]);
  const adminDb = dbFor("admin");

  const createDishLocked = "rules-create-dish-locked";
  await seedRuleTestDocuments([{
    documentPath:
      `private_rating_dish_operation_locks/${createDishLocked}`,
    data: ratingDishOperationLockData(createDishLocked),
  }]);
  await assertFails(
    adminDb.doc(`bitescore_dishes/${createDishLocked}`).set(
      biteScoreDishCreateData({
        id: createDishLocked,
        restaurantId: "bs-1",
      }),
    ),
  );
  await assertFails(
    adminDb.doc("bitescore_dishes/rules-create-restaurant-locked").set(
      biteScoreDishCreateData({
        id: "rules-create-restaurant-locked",
        restaurantId: restaurantA,
      }),
    ),
  );
  await assertFails(adminDb.doc(`bitescore_dishes/${exactDishId}`).update({
    category: "Blocked exact dish",
    updatedAt: serverTimestamp(),
  }));
  await assertFails(adminDb.doc(`bitescore_dishes/${exactDishId}`).delete());
  await assertFails(
    adminDb.doc(`bitescore_dishes/${currentRestaurantDishId}`).update({
      restaurantId: "bs-1",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    adminDb.doc(`bitescore_dishes/${currentRestaurantDishId}`).delete(),
  );
  await assertFails(
    adminDb.doc(`bitescore_dishes/${requestedRestaurantDishId}`).update({
      restaurantId: restaurantB,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    adminDb.doc(`bitescore_dishes/${unlockDishId}`).update({
      category: "Still locked",
      updatedAt: serverTimestamp(),
    }),
  );

  await deleteRuleTestDocuments([
    `private_rating_dish_operation_locks/${unlockDishId}`,
    `private_rating_restaurant_operation_locks/${restaurantA}`,
    `private_rating_restaurant_operation_locks/${restaurantB}`,
  ]);
  await assertSucceeds(
    adminDb.doc(`bitescore_dishes/${unlockDishId}`).update({
      category: "Unlocked",
      updatedAt: serverTimestamp(),
    }),
  );
  const unrelatedDishId = "rules-unrelated-operation-dish";
  await assertSucceeds(
    adminDb.doc(`bitescore_dishes/${unrelatedDishId}`).set(
      biteScoreDishCreateData({id: unrelatedDishId, restaurantId: "bs-1"}),
    ),
  );
  await assertSucceeds(
    adminDb.doc(`bitescore_dishes/${unrelatedDishId}`).delete(),
  );
});

test("reviews and aggregates check old and new destructive identities", async () => {
  const restaurantA = "rules-review-restaurant-a";
  const restaurantB = "rules-review-restaurant-b";
  const dishA = "rules-review-dish-a";
  const dishB = "rules-review-dish-b";
  const reviewPath = "dish_reviews/rules-destructive-identity-review";
  const aggregatePath = `dish_rating_aggregates/${dishA}`;
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${dishA}`,
      data: ruleTestDishData(dishA, {restaurantId: restaurantA}),
    },
    {
      documentPath: `bitescore_dishes/${dishB}`,
      data: ruleTestDishData(dishB, {restaurantId: restaurantB}),
    },
    {
      documentPath: reviewPath,
      data: reviewWriteData({
        id: "rules-destructive-identity-review",
        dishId: dishA,
        restaurantId: restaurantA,
      }),
    },
    {
      documentPath: aggregatePath,
      data: aggregateWriteData({dishId: dishA, restaurantId: restaurantA}),
    },
  ]);
  const adminDb = dbFor("admin");
  const customerDb = dbFor("customer");
  const reviewMovement = {
    dishId: dishB,
    restaurantId: restaurantB,
    updatedAt: serverTimestamp(),
  };

  const sequentialLocks = [
    [
      `private_rating_dish_operation_locks/${dishA}`,
      ratingDishOperationLockData(dishA),
    ],
    [
      `private_rating_dish_operation_locks/${dishB}`,
      {malformed: "requested-dish-lock"},
    ],
    [
      `private_rating_restaurant_operation_locks/${restaurantA}`,
      ratingRestaurantOperationLockData(restaurantA, "deleted_source"),
    ],
    [
      `private_rating_restaurant_operation_locks/${restaurantB}`,
      {malformed: "requested-restaurant-lock"},
    ],
  ];
  for (const [lockPath, lockData] of sequentialLocks) {
    await seedRuleTestDocuments([{documentPath: lockPath, data: lockData}]);
    await assertFails(adminDb.doc(reviewPath).update(reviewMovement));
    await deleteRuleTestDocuments([lockPath]);
  }
  await assertSucceeds(adminDb.doc(reviewPath).update(reviewMovement));
  await seedRuleTestDocuments([{
    documentPath: `private_rating_dish_operation_locks/${dishB}`,
    data: ratingDishOperationLockData(dishB, "merged_source"),
  }]);
  await assertFails(adminDb.doc(reviewPath).delete());
  await deleteRuleTestDocuments([
    `private_rating_dish_operation_locks/${dishB}`,
  ]);
  await assertSucceeds(adminDb.doc(reviewPath).delete());

  await seedRuleTestDocuments([{
    documentPath: `private_rating_dish_operation_locks/${dishA}`,
    data: ratingDishOperationLockData(dishA),
  }]);
  await assertFails(
    customerDb.doc("dish_reviews/rules-locked-review-create").set(
      reviewWriteData({
        id: "rules-locked-review-create",
        dishId: dishA,
        restaurantId: restaurantA,
      }),
    ),
  );
  await assertFails(adminDb.doc(aggregatePath).update({
    restaurantId: restaurantB,
    ratingCount: 2,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(adminDb.doc(aggregatePath).delete());
  await deleteRuleTestDocuments([
    `private_rating_dish_operation_locks/${dishA}`,
  ]);

  for (const restaurantId of [restaurantA, restaurantB]) {
    const lockPath =
      `private_rating_restaurant_operation_locks/${restaurantId}`;
    await seedRuleTestDocuments([{
      documentPath: lockPath,
      data: ratingRestaurantOperationLockData(restaurantId),
    }]);
    await assertFails(adminDb.doc(aggregatePath).update({
      restaurantId: restaurantB,
      ratingCount: 2,
      updatedAt: serverTimestamp(),
    }));
    await deleteRuleTestDocuments([lockPath]);
  }
  await assertSucceeds(adminDb.doc(aggregatePath).update({
    restaurantId: restaurantB,
    ratingCount: 2,
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(adminDb.doc(aggregatePath).delete());

  const aggregateCreatePath =
    "dish_rating_aggregates/rules-aggregate-create-locked";
  const aggregateCreateDish = "rules-aggregate-create-locked";
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_dishes/${aggregateCreateDish}`,
      data: ruleTestDishData(aggregateCreateDish, {
        restaurantId: restaurantA,
      }),
    },
    {
      documentPath:
        `private_rating_restaurant_operation_locks/${restaurantA}`,
      data: {malformed: "aggregate-create-restaurant-lock"},
    },
  ]);
  await assertFails(customerDb.doc(aggregateCreatePath).set(
    aggregateWriteData({
      dishId: aggregateCreateDish,
      restaurantId: restaurantA,
    }),
  ));
});

test("restaurant dependents check requested, current, and new restaurant locks", async () => {
  const restaurantA = "rules-dependent-restaurant-a";
  const restaurantB = "rules-dependent-restaurant-b";
  const cases = [
    {
      collection: "restaurant_claim_requests",
      data: {
        id: "claim-existing",
        restaurantId: restaurantA,
        restaurantName: "Restaurant A",
        requesterUserId: "customer-a",
        claimantName: "Customer A",
        email: "customer-a@example.com",
        phone: "555-0100",
        status: "pending",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
    {
      collection: "restaurant_reports",
      data: {
        id: "restaurant-report-existing",
        restaurantId: restaurantA,
        restaurantName: "Restaurant A",
        reportingUserId: "customer-a",
        reason: "closed",
        status: "pending",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
    {
      collection: "duplicate_restaurant_reports",
      data: {
        id: "duplicate-report-existing",
        restaurantId: restaurantA,
        restaurantName: "Restaurant A",
        reportingUserId: "customer-a",
        reason: "duplicate",
        status: "pending",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
  ];
  await seedRuleTestDocuments([
    {
      documentPath: `bitescore_restaurants/${restaurantA}`,
      data: claimableBiteScoreRestaurantData(restaurantA),
    },
    {
      documentPath: `bitescore_restaurants/${restaurantB}`,
      data: claimableBiteScoreRestaurantData(restaurantB),
    },
    ...cases.map(({collection, data}) => ({
      documentPath: `${collection}/existing`,
      data,
    })),
  ]);
  const customerDb = dbFor("customer");
  const adminDb = dbFor("admin");
  const oldLockPath =
    `private_rating_restaurant_operation_locks/${restaurantA}`;
  const newLockPath =
    `private_rating_restaurant_operation_locks/${restaurantB}`;

  await seedRuleTestDocuments([{
    documentPath: oldLockPath,
    data: ratingRestaurantOperationLockData(restaurantA),
  }]);
  for (const {collection, data} of cases) {
    await assertFails(
      customerDb.doc(`${collection}/create-locked`).set({
        ...data,
        id: `${collection}-create-locked`,
      }),
    );
    await assertFails(adminDb.doc(`${collection}/existing`).update({
      restaurantId: restaurantB,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(adminDb.doc(`${collection}/existing`).delete());
  }
  await deleteRuleTestDocuments([oldLockPath]);
  await seedRuleTestDocuments([{
    documentPath: newLockPath,
    data: {malformed: "new-restaurant-lock"},
  }]);
  for (const {collection} of cases) {
    await assertFails(adminDb.doc(`${collection}/existing`).update({
      restaurantId: restaurantB,
      updatedAt: serverTimestamp(),
    }));
  }
  await deleteRuleTestDocuments([newLockPath]);
  for (const {collection, data} of cases) {
    await assertSucceeds(adminDb.doc(`${collection}/existing`).update({
      restaurantId: restaurantB,
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(adminDb.doc(`${collection}/existing`).delete());
    await assertSucceeds(
      customerDb.doc(`${collection}/create-unlocked`).set({
        ...data,
        id: `${collection}-create-unlocked`,
        restaurantId: restaurantB,
      }),
    );
  }
});

test("dish dependents check old and new dish and restaurant locks", async () => {
  const restaurantA = "rules-dish-dependent-restaurant-a";
  const restaurantB = "rules-dish-dependent-restaurant-b";
  const dishA = "rules-dish-dependent-a";
  const dishB = "rules-dish-dependent-b";
  const cases = [
    {
      collection: "review_reports",
      actor: "admin",
      data: {
        id: "review-report-existing",
        reviewId: "review-existing",
        dishId: dishA,
        restaurantId: restaurantA,
        reportingUserId: "customer-a",
        reason: "spam",
        status: "pending",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
    {
      collection: "dish_reports",
      actor: "admin",
      data: {
        id: "dish-report-existing",
        dishId: dishA,
        dishName: "Dish A",
        restaurantId: restaurantA,
        reportingUserId: "customer-a",
        reason: "duplicate",
        status: "pending",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
    {
      collection: "review_feedback_votes",
      actor: "customer",
      data: {
        id: "review-vote-existing",
        reviewId: "review-existing",
        dishId: dishA,
        restaurantId: restaurantA,
        userId: "customer-a",
        voteType: "helpful",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
  ];
  await seedRuleTestDocuments(cases.map(({collection, data}) => ({
    documentPath: `${collection}/destructive-existing`,
    data,
  })));
  const customerDb = dbFor("customer");
  const lockSequence = [
    [
      `private_rating_dish_operation_locks/${dishA}`,
      ratingDishOperationLockData(dishA),
    ],
    [
      `private_rating_dish_operation_locks/${dishB}`,
      {malformed: "new-dish-lock"},
    ],
    [
      `private_rating_restaurant_operation_locks/${restaurantA}`,
      ratingRestaurantOperationLockData(restaurantA, "merged_source"),
    ],
    [
      `private_rating_restaurant_operation_locks/${restaurantB}`,
      {malformed: "new-restaurant-lock"},
    ],
  ];

  for (const [lockPath, lockData] of lockSequence) {
    await seedRuleTestDocuments([{documentPath: lockPath, data: lockData}]);
    for (const {collection, actor} of cases) {
      await assertFails(dbFor(actor).doc(
        `${collection}/destructive-existing`,
      ).update({
        dishId: dishB,
        restaurantId: restaurantB,
        updatedAt: serverTimestamp(),
      }));
    }
    await deleteRuleTestDocuments([lockPath]);
  }

  await seedRuleTestDocuments([
    {
      documentPath: `private_rating_dish_operation_locks/${dishA}`,
      data: ratingDishOperationLockData(dishA),
    },
    {
      documentPath:
        `private_rating_restaurant_operation_locks/${restaurantA}`,
      data: ratingRestaurantOperationLockData(restaurantA),
    },
  ]);
  for (const {collection, data} of cases) {
    await assertFails(
      customerDb.doc(`${collection}/create-locked`).set({
        ...data,
        id: `${collection}-create-locked`,
      }),
    );
  }
  await deleteRuleTestDocuments([
    `private_rating_dish_operation_locks/${dishA}`,
    `private_rating_restaurant_operation_locks/${restaurantA}`,
  ]);

  for (const {collection, actor, data} of cases) {
    const ref = dbFor(actor).doc(`${collection}/destructive-existing`);
    await assertSucceeds(ref.update({
      dishId: dishB,
      restaurantId: restaurantB,
      updatedAt: serverTimestamp(),
    }));
    await seedRuleTestDocuments([{
      documentPath: `private_rating_dish_operation_locks/${dishB}`,
      data: {malformed: "current-delete-lock"},
    }]);
    await assertFails(ref.delete());
    await deleteRuleTestDocuments([
      `private_rating_dish_operation_locks/${dishB}`,
    ]);
    await assertSucceeds(ref.delete());
    await assertSucceeds(
      customerDb.doc(`${collection}/create-unlocked`).set({
        ...data,
        id: `${collection}-create-unlocked`,
        dishId: dishB,
        restaurantId: restaurantB,
      }),
    );
  }
});

test("dish proposals check every current source and target alias", async () => {
  const restaurantA = "rules-proposal-restaurant-a";
  const restaurantB = "rules-proposal-restaurant-b";
  const oldDish = "rules-proposal-old-dish";
  const newDish = "rules-proposal-new-dish";
  const aliasCases = [
    {
      label: "targetDishId",
      lockedDishId: "rules-proposal-target-dish-lock",
      data: dishProposalWriteData({
        restaurantId: "bs-1",
        targetDishId: "rules-proposal-target-dish-lock",
      }),
    },
    {
      label: "targetId",
      lockedDishId: "rules-proposal-target-id-lock",
      data: dishProposalWriteData({
        type: null,
        targetType: "rename",
        targetDishId: null,
        targetId: "rules-proposal-target-id-lock",
      }),
    },
    {
      label: "sourceDishId",
      lockedDishId: "rules-proposal-source-dish-lock",
      data: dishProposalWriteData({
        type: "merge",
        sourceDishId: "rules-proposal-source-dish-lock",
        targetDishId: "rules-proposal-source-target",
        mergeTargetDishId: "rules-proposal-source-target",
        proposedName: null,
      }),
    },
    {
      label: "mergeTargetDishId",
      lockedDishId: "rules-proposal-merge-target-lock",
      data: dishProposalWriteData({
        type: "merge",
        sourceDishId: "rules-proposal-merge-source",
        targetDishId: "rules-proposal-merge-target-lock",
        mergeTargetDishId: "rules-proposal-merge-target-lock",
        proposedName: null,
      }),
    },
  ];
  await seedRuleTestDocuments(aliasCases.map(({lockedDishId}) => ({
    documentPath: `private_rating_dish_operation_locks/${lockedDishId}`,
    data: {malformed: "present-alias-lock"},
  })));
  const customerDb = dbFor("customer");
  const adminDb = dbFor("admin");
  for (const {label, data} of aliasCases) {
    await assertFails(
      customerDb.doc(`dish_edit_proposals/create-${label}`).set(data),
    );
  }
  await deleteRuleTestDocuments(aliasCases.map(
    ({lockedDishId}) =>
      `private_rating_dish_operation_locks/${lockedDishId}`,
  ));

  const proposalPath = "dish_edit_proposals/destructive-movement";
  await seedRuleTestDocuments([{
    documentPath: proposalPath,
    data: dishProposalWriteData({
      id: "destructive-movement",
      restaurantId: restaurantA,
      targetDishId: oldDish,
    }),
  }]);
  const movement = {
    restaurantId: restaurantB,
    targetDishId: newDish,
    updatedAt: serverTimestamp(),
  };
  const movementLocks = [
    `private_rating_dish_operation_locks/${oldDish}`,
    `private_rating_dish_operation_locks/${newDish}`,
    `private_rating_restaurant_operation_locks/${restaurantA}`,
    `private_rating_restaurant_operation_locks/${restaurantB}`,
  ];
  for (const lockPath of movementLocks) {
    await seedRuleTestDocuments([{
      documentPath: lockPath,
      data: {malformed: "present-movement-lock"},
    }]);
    await assertFails(adminDb.doc(proposalPath).update(movement));
    await deleteRuleTestDocuments([lockPath]);
  }
  await assertSucceeds(adminDb.doc(proposalPath).update(movement));
  await seedRuleTestDocuments([{
    documentPath: `private_rating_dish_operation_locks/${newDish}`,
    data: ratingDishOperationLockData(newDish, "deleted_source"),
  }]);
  await assertFails(adminDb.doc(proposalPath).delete());
  await deleteRuleTestDocuments([
    `private_rating_dish_operation_locks/${newDish}`,
  ]);
  await assertSucceeds(adminDb.doc(proposalPath).delete());

  await seedRuleTestDocuments([{
    documentPath:
      `private_rating_restaurant_operation_locks/${restaurantA}`,
    data: ratingRestaurantOperationLockData(restaurantA),
  }]);
  await assertFails(
    customerDb.doc("dish_edit_proposals/create-restaurant-locked").set(
      dishProposalWriteData({
        restaurantId: restaurantA,
        targetDishId: "rules-proposal-unlocked-dish",
      }),
    ),
  );
  await deleteRuleTestDocuments([
    `private_rating_restaurant_operation_locks/${restaurantA}`,
  ]);
  await assertSucceeds(
    customerDb.doc("dish_edit_proposals/create-unlocked").set(
      dishProposalWriteData({
        restaurantId: restaurantA,
        targetDishId: "rules-proposal-unlocked-dish",
      }),
    ),
  );
});
