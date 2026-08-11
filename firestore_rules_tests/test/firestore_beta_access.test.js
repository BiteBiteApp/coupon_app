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
    createdByUserId,
    createdFromCreateFlow: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
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
  { aggregateWriteGeneration } = {},
) {
  return {
    id: dishId,
    restaurantId: "bs-1",
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
  headline = "Merge lock rules fixture",
} = {}) {
  return {
    id,
    dishId,
    restaurantId: "bs-1",
    userId: "customer-a",
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
  ratingCount = 1,
  aggregateWriteGeneration,
} = {}) {
  return {
    dishId,
    restaurantId: "bs-1",
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

test("public read of pending/private restaurant accounts is denied", async () => {
  await assertFails(
    dbFor("unauthenticated").doc("restaurant_accounts/pending-owner").get(),
  );
});

test("public read of approved/public restaurant content is allowed", async () => {
  const db = dbFor("unauthenticated");
  assert.equal(
    (await assertSucceeds(db.doc("restaurant_accounts/owner-1").get())).exists,
    true,
  );
  assert.equal(
    (
      await assertSucceeds(
        db.collection("restaurant_accounts")
          .where("approvalStatus", "==", "approved")
          .get(),
      )
    ).size,
    1,
  );
  await assertSucceeds(db.doc("restaurant_accounts/owner-1/coupons/coupon-1").get());
  await assertSucceeds(
    db.doc("restaurant_accounts/owner-1/daily_specials/special-1").get(),
  );
  await assertSucceeds(db.doc("bitescore_restaurants/bs-1").get());
  await assertSucceeds(db.doc("bitescore_dishes/dish-1").get());
  await assertSucceeds(db.doc("dish_rating_aggregates/dish-1").get());
  await assertSucceeds(db.doc("dish_reviews/dish-1_customer-a").get());
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
      },
      { merge: true },
    ),
  );

  await assertFails(
    db.doc("bitescore_restaurants/new-restaurant-4").set(
      { createdFromDishId: "forged-dish" },
      { merge: true },
    ),
  );
  await assertFails(
    db.doc("bitescore_restaurants/new-restaurant-4").set(
      { createdFromReviewId: "forged-review" },
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
        status: "approved",
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
