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
      uid: "owner-1",
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
