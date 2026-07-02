const assert = require("node:assert/strict");
const test = require("node:test");

const {
  awardApprovedDishProposalContributionPointsCallableHandler,
  awardCreatedDishContributionPointsCallableHandler,
  awardDishImageContributionPointsCallableHandler,
  awardContributionPointsCallableHandler,
  awardContributionPointsTransaction,
  awardReviewMilestoneContributionPointsCallableHandler,
  buildContributionLedgerDocumentIdFromSourceKey,
  buildContributionReversalDocumentId,
  contributionPointCelebrationStatus,
  contributionPointLedgerCollection,
  contributionPointStatus,
  contributionUserProfilesCollection,
  markContributionPointLedgerEntriesCelebratedCallableHandler,
  reverseContributionPointLedgerEntryCallableHandler,
  reverseContributionPointLedgerEntryTransaction,
} = require("../lib/contribution_points_helpers.js");

const fakeFieldValues = {
  serverTimestamp: () => ({ __op: "serverTimestamp" }),
  increment: (delta) => ({ __op: "increment", delta }),
};

test("award creates a positive ledger entry and cached user total", async () => {
  const db = new FakeFirestore();
  const result = await awardContributionPointsTransaction(db, awardDraft(), {
    fieldValues: fakeFieldValues,
  });
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_created:dish-1",
  );
  const entry = db.get(ledgerPath(ledgerId));
  const userProfile = db.get(userProfilePath("user-1"));

  assert.deepEqual(result, {
    entries: [{ ledgerEntryId: ledgerId, points: 3, wasCreated: true }],
    actionGroupId: "dish_created:dish-1",
  });
  assert.equal(entry.userId, "user-1");
  assert.equal(entry.pointsDelta, 3);
  assert.equal(entry.actionType, "dish_created");
  assert.equal(entry.sourceKey, "dish_created:dish-1");
  assert.equal(entry.description, "Added a dish");
  assert.equal(entry.status, contributionPointStatus.active);
  assert.equal(
    entry.celebrationStatus,
    contributionPointCelebrationStatus.pending,
  );
  assert.equal(entry.dishId, "dish-1");
  assert.equal(entry.restaurantId, "restaurant-1");
  assert.equal(userProfile.userId, "user-1");
  assert.equal(userProfile.contributionPoints, 3);
  assert.ok(userProfile.lastContributionAt.startsWith("timestamp-"));
});

test("duplicate award with the same source key is a no-op", async () => {
  const db = new FakeFirestore();
  await awardContributionPointsTransaction(db, awardDraft(), {
    fieldValues: fakeFieldValues,
  });

  const duplicate = await awardContributionPointsTransaction(db, awardDraft(), {
    fieldValues: fakeFieldValues,
  });

  assert.deepEqual(duplicate, {
    entries: [
      {
        ledgerEntryId: buildContributionLedgerDocumentIdFromSourceKey(
          "dish_created:dish-1",
        ),
        points: 3,
        wasCreated: false,
      },
    ],
    actionGroupId: "dish_created:dish-1",
  });
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 3);
});

test("award restores a previously reversed source-key entry once", async () => {
  const db = new FakeFirestore();
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_created:dish-1",
  );
  db.seed(ledgerPath(ledgerId), {
    id: ledgerId,
    userId: "user-1",
    pointsDelta: 3,
    actionType: "dish_created",
    sourceKey: "dish_created:dish-1",
    description: "Added a dish",
    status: contributionPointStatus.reversed,
  });
  db.seed(userProfilePath("user-1"), {
    userId: "user-1",
    contributionPoints: 0,
  });

  const restored = await awardContributionPointsTransaction(db, awardDraft(), {
    fieldValues: fakeFieldValues,
  });
  const restoreId = `restore:${ledgerId}`;
  const restoreEntry = db.get(ledgerPath(restoreId));

  assert.deepEqual(restored, {
    entries: [{ ledgerEntryId: restoreId, points: 3, wasCreated: true }],
    actionGroupId: "dish_created:dish-1",
  });
  assert.equal(restoreEntry.originalLedgerEntryId, ledgerId);
  assert.equal(restoreEntry.description, "Added a dish restored");
  assert.equal(restoreEntry.status, contributionPointStatus.active);
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 3);

  const duplicateRestore = await awardContributionPointsTransaction(
    db,
    awardDraft(),
    { fieldValues: fakeFieldValues },
  );
  assert.equal(duplicateRestore.entries[0].wasCreated, false);
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 3);
});

test("reversal marks original entry, writes negative entry, and decrements total", async () => {
  const db = new FakeFirestore();
  await awardContributionPointsTransaction(db, awardDraft(), {
    fieldValues: fakeFieldValues,
  });
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_created:dish-1",
  );

  const result = await reverseContributionPointLedgerEntryTransaction(
    db,
    {
      ledgerEntryId: ledgerId,
      reason: "Dish was deleted by moderation",
    },
    { fieldValues: fakeFieldValues },
  );
  const original = db.get(ledgerPath(ledgerId));
  const reversalId = buildContributionReversalDocumentId(ledgerId);
  const reversal = db.get(ledgerPath(reversalId));

  assert.equal(result.status, "reversed");
  assert.equal(result.pointsDelta, -3);
  assert.equal(original.status, contributionPointStatus.reversed);
  assert.equal(original.reversalLedgerEntryId, reversalId);
  assert.equal(reversal.id, reversalId);
  assert.equal(reversal.userId, "user-1");
  assert.equal(reversal.pointsDelta, -3);
  assert.equal(reversal.actionType, "contribution_reversed");
  assert.equal(reversal.sourceKey, "reversal:dish_created:dish-1");
  assert.equal(reversal.description, "Points removed: Added a dish");
  assert.equal(reversal.status, contributionPointStatus.reversal);
  assert.equal(reversal.originalLedgerEntryId, ledgerId);
  assert.equal(reversal.reason, "Dish was deleted by moderation");
  assert.equal(reversal.dishId, "dish-1");
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 0);
});

test("reversing an already reversed entry is safe and does not double-decrement", async () => {
  const db = new FakeFirestore();
  await awardContributionPointsTransaction(db, awardDraft(), {
    fieldValues: fakeFieldValues,
  });
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_created:dish-1",
  );
  await reverseContributionPointLedgerEntryTransaction(
    db,
    { ledgerEntryId: ledgerId, reason: "First reversal" },
    { fieldValues: fakeFieldValues },
  );

  const second = await reverseContributionPointLedgerEntryTransaction(
    db,
    { ledgerEntryId: ledgerId, reason: "Second reversal" },
    { fieldValues: fakeFieldValues },
  );

  assert.equal(second.status, "already-reversed");
  assert.equal(second.pointsDelta, 0);
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 0);
});

test("missing ledger entry reversal fails safely", async () => {
  const db = new FakeFirestore();

  const result = await reverseContributionPointLedgerEntryTransaction(
    db,
    { ledgerEntryId: "missing-entry", reason: "Missing content" },
    { fieldValues: fakeFieldValues },
  );

  assert.deepEqual(result, {
    ledgerEntryId: "missing-entry",
    pointsDelta: 0,
    status: "missing",
  });
  assert.equal(db.size, 0);
});

test("award transaction rolls back ledger writes if cached total write fails", async () => {
  const db = new FakeFirestore();
  db.failOnSetPath = userProfilePath("user-1");

  await assert.rejects(
    () =>
      awardContributionPointsTransaction(db, awardDraft(), {
        fieldValues: fakeFieldValues,
      }),
    /Injected write failure/,
  );

  assert.equal(
    db.get(ledgerPath(buildContributionLedgerDocumentIdFromSourceKey(
      "dish_created:dish-1",
    ))),
    undefined,
  );
  assert.equal(db.get(userProfilePath("user-1")), undefined);
});

test("admin callable can award and reverse contribution points", async () => {
  const db = new FakeFirestore();
  const awardResponse = await awardContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: adminAuth(),
      data: { draft: awardDraft({ points: 1, sourceKey: "dish_image:image-1" }) },
    }),
    { fieldValues: fakeFieldValues },
  );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_image:image-1",
  );
  const reverseResponse =
    await reverseContributionPointLedgerEntryCallableHandler(
      db,
      callableRequest({
        auth: adminAuth(),
        data: { ledgerEntryId: ledgerId, reason: "Admin moderation" },
      }),
      { fieldValues: fakeFieldValues },
    );

  assert.equal(awardResponse.ok, true);
  assert.equal(awardResponse.result.entries[0].wasCreated, true);
  assert.equal(reverseResponse.ok, true);
  assert.equal(reverseResponse.result.status, "reversed");
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 0);
});

test("ordinary callable user cannot mutate another user's total", async () => {
  const db = new FakeFirestore();

  await assert.rejects(
    () =>
      awardContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-2", token: { email: "user-2@example.com" } },
          data: { draft: awardDraft({ userId: "user-1" }) },
        }),
      ),
    (error) => error.code === "permission-denied",
  );

  assert.equal(db.get(userProfilePath("user-1")), undefined);
});

test("review milestone callable awards verified milestone points", async () => {
  const db = new FakeFirestore();
  seedPublicReviews(db, { userId: "user-1", count: 5 });

  const response = await awardReviewMilestoneContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { userId: "user-1", validPublicReviewCount: 999 },
    }),
    { fieldValues: fakeFieldValues },
  );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "review_milestone:user-1:5",
  );

  assert.equal(response.ok, true);
  assert.equal(response.result.actionGroupId, "review_milestones:user-1:5");
  assert.deepEqual(response.result.entries, [
    { ledgerEntryId: ledgerId, points: 1, wasCreated: true },
  ]);
  assert.equal(db.get(ledgerPath(ledgerId)).actionType, "review_milestone");
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 1);
});

test("review milestone callable ignores hidden, duplicate, and private reviews", async () => {
  const db = new FakeFirestore();
  seedPublicReviews(db, { userId: "user-1", count: 4 });
  db.seed("dish_reviews/private", {
    userId: "user-1",
    dishId: "dish-private",
    isPublic: false,
  });
  db.seed("dish_reviews/hidden", {
    userId: "user-1",
    dishId: "dish-hidden",
    hidden: true,
  });
  db.seed("dish_reviews/duplicate", {
    userId: "user-1",
    dishId: "dish-1",
  });

  const response = await awardReviewMilestoneContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { userId: "user-1", validPublicReviewCount: 5 },
    }),
    { fieldValues: fakeFieldValues },
  );

  assert.equal(response.result.actionGroupId, "review_milestones:user-1:4");
  assert.deepEqual(response.result.entries, []);
  assert.equal(db.get(userProfilePath("user-1")), undefined);
});

test("duplicate review milestone callable does not double-award", async () => {
  const db = new FakeFirestore();
  seedPublicReviews(db, { userId: "user-1", count: 5 });

  await awardReviewMilestoneContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { userId: "user-1" },
    }),
    { fieldValues: fakeFieldValues },
  );
  const duplicate = await awardReviewMilestoneContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { userId: "user-1" },
    }),
    { fieldValues: fakeFieldValues },
  );

  assert.equal(duplicate.result.entries[0].wasCreated, false);
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 1);
});

test("review milestone callable requires auth and own user unless admin", async () => {
  const db = new FakeFirestore();
  seedPublicReviews(db, { userId: "user-1", count: 5 });

  await assert.rejects(
    () =>
      awardReviewMilestoneContributionPointsCallableHandler(
        db,
        callableRequest({ auth: null, data: { userId: "user-1" } }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "unauthenticated",
  );
  await assert.rejects(
    () =>
      awardReviewMilestoneContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-2", token: { email: "user-2@example.com" } },
          data: { userId: "user-1" },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "permission-denied",
  );

  const adminResponse = await awardReviewMilestoneContributionPointsCallableHandler(
    db,
    callableRequest({ auth: adminAuth(), data: { userId: "user-1" } }),
    { fieldValues: fakeFieldValues },
  );
  assert.equal(adminResponse.result.entries[0].wasCreated, true);
});

test("dish image callable awards when image belongs to caller", async () => {
  const db = new FakeFirestore();
  seedDishImageAwardData(db, { userId: "user-1" });

  const response = await awardDishImageContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { imageId: "image-1", dishId: "dish-1", points: 99 },
    }),
    { fieldValues: fakeFieldValues },
  );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_image_added:dish-1:image-1",
  );
  const entry = db.get(ledgerPath(ledgerId));

  assert.equal(response.ok, true);
  assert.deepEqual(response.result.entries, [
    { ledgerEntryId: ledgerId, points: 1, wasCreated: true },
  ]);
  assert.equal(entry.userId, "user-1");
  assert.equal(entry.pointsDelta, 1);
  assert.equal(entry.actionType, "dish_image_added");
  assert.equal(entry.imageId, "image-1");
  assert.equal(entry.dishId, "dish-1");
  assert.equal(entry.restaurantId, "restaurant-1");
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 1);
});

test("dish image callable rejects missing or mismatched images", async () => {
  const db = new FakeFirestore();
  seedDishImageAwardData(db, { userId: "user-1" });

  await assert.rejects(
    () =>
      awardDishImageContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-2", token: { email: "user-2@example.com" } },
          data: { imageId: "image-1" },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "permission-denied",
  );
  await assert.rejects(
    () =>
      awardDishImageContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-1", token: { email: "user-1@example.com" } },
          data: { imageId: "missing-image" },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "not-found",
  );
  await assert.rejects(
    () =>
      awardDishImageContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-1", token: { email: "user-1@example.com" } },
          data: { imageId: "image-1", dishId: "wrong-dish" },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "invalid-argument",
  );
});

test("duplicate dish image callable does not double-award", async () => {
  const db = new FakeFirestore();
  seedDishImageAwardData(db, { userId: "user-1" });

  await awardDishImageContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { imageId: "image-1", dishId: "dish-1" },
    }),
    { fieldValues: fakeFieldValues },
  );
  const duplicate = await awardDishImageContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { imageId: "image-1", dishId: "dish-1" },
    }),
    { fieldValues: fakeFieldValues },
  );

  assert.equal(duplicate.result.entries[0].wasCreated, false);
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 1);
});

test("created dish callable awards one point for a new dish at an existing restaurant", async () => {
  const db = new FakeFirestore();
  seedCreatedDishAwardData(db, {
    userId: "user-1",
    restaurantId: "restaurant-1",
    dishId: "dish-2",
    reviewId: "review-1",
  });
  db.seed("bitescore_dishes/dish-1", {
    __createTimeMillis: 1000,
    id: "dish-1",
    name: "Garlic Knots",
    restaurantId: "restaurant-1",
    isActive: true,
  });

  const response = await awardCreatedDishContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: {
        restaurantId: "restaurant-1",
        dishId: "dish-2",
        reviewId: "review-1",
        points: 99,
        createdNewRestaurant: true,
      },
    }),
    { fieldValues: fakeFieldValues },
  );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_created:dish-2",
  );
  const entry = db.get(ledgerPath(ledgerId));

  assert.equal(response.ok, true);
  assert.deepEqual(response.result.entries, [
    { ledgerEntryId: ledgerId, points: 1, wasCreated: true },
  ]);
  assert.equal(entry.userId, "user-1");
  assert.equal(entry.pointsDelta, 1);
  assert.equal(entry.actionType, "dish_created");
  assert.equal(entry.sourceKey, "dish_created:dish-2");
  assert.equal(entry.reviewId, "review-1");
  assert.equal(entry.dishId, "dish-2");
  assert.equal(entry.restaurantId, "restaurant-1");
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 1);
});

test("created dish callable awards first-dish points for an existing restaurant", async () => {
  const db = new FakeFirestore();
  seedCreatedDishAwardData(db, {
    userId: "user-1",
    restaurantId: "restaurant-1",
    dishId: "dish-1",
    reviewId: "review-1",
  });

  const response = await awardCreatedDishContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: {
        restaurantId: "restaurant-1",
        dishId: "dish-1",
        reviewId: "review-1",
      },
    }),
    { fieldValues: fakeFieldValues },
  );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "restaurant_first_dish:restaurant-1:dish-1",
  );
  const entry = db.get(ledgerPath(ledgerId));

  assert.deepEqual(response.result.entries, [
    { ledgerEntryId: ledgerId, points: 3, wasCreated: true },
  ]);
  assert.equal(entry.actionType, "restaurant_first_dish");
  assert.equal(entry.description, "Added the first dish to an existing restaurant");
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 3);
});

test("created dish callable treats unrelated restaurant provenance as existing restaurant context", async () => {
  const db = new FakeFirestore();
  seedCreatedDishAwardData(db, {
    userId: "user-1",
    restaurantId: "restaurant-1",
    dishId: "dish-1",
    reviewId: "review-1",
    restaurantOverrides: {
      createdByUserId: "user-2",
      createdFromDishId: "other-dish",
      createdFromReviewId: "other-review",
      createdFromCreateFlow: true,
    },
  });

  const response = await awardCreatedDishContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: {
        restaurantId: "restaurant-1",
        dishId: "dish-1",
        reviewId: "review-1",
      },
    }),
    { fieldValues: fakeFieldValues },
  );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "restaurant_first_dish:restaurant-1:dish-1",
  );

  assert.deepEqual(response.result.entries, [
    { ledgerEntryId: ledgerId, points: 3, wasCreated: true },
  ]);
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 3);
});

test("created dish callable awards new-restaurant first-dish points with matching restaurant provenance", async () => {
  const db = new FakeFirestore();
  seedCreatedDishAwardData(db, {
    userId: "user-1",
    restaurantId: "restaurant-1",
    dishId: "dish-1",
    reviewId: "review-1",
    newRestaurant: true,
  });

  const response = await awardCreatedDishContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: {
        restaurantId: "restaurant-1",
        dishId: "dish-1",
        reviewId: "review-1",
      },
    }),
    { fieldValues: fakeFieldValues },
  );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "new_restaurant_first_dish:restaurant-1:dish-1",
  );
  const entry = db.get(ledgerPath(ledgerId));

  assert.deepEqual(response.result.entries, [
    { ledgerEntryId: ledgerId, points: 3, wasCreated: true },
  ]);
  assert.equal(entry.actionType, "new_restaurant_first_dish");
  assert.equal(entry.description, "Added a new restaurant and its first dish");
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 3);
});

test("created dish callable does not award old dishes without creation provenance", async () => {
  const db = new FakeFirestore();
  seedCreatedDishAwardData(db, {
    userId: "user-1",
    restaurantId: "restaurant-1",
    dishId: "dish-1",
    reviewId: "review-1",
    dishOverrides: {
      createdByUserId: undefined,
      createdFromReviewId: undefined,
      createdWithRestaurantId: undefined,
      createdFromCreateFlow: undefined,
    },
  });

  const response = await awardCreatedDishContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: {
        restaurantId: "restaurant-1",
        dishId: "dish-1",
        reviewId: "review-1",
      },
    }),
    { fieldValues: fakeFieldValues },
  );

  assert.deepEqual(response.result, { entries: [] });
  assert.equal(db.get(userProfilePath("user-1")), undefined);
});

test("created dish callable rejects review and provenance ownership mismatches", async () => {
  const db = new FakeFirestore();
  seedCreatedDishAwardData(db, {
    userId: "user-2",
    restaurantId: "restaurant-1",
    dishId: "dish-1",
    reviewId: "review-1",
  });

  await assert.rejects(
    () =>
      awardCreatedDishContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-1", token: { email: "user-1@example.com" } },
          data: {
            restaurantId: "restaurant-1",
            dishId: "dish-1",
            reviewId: "review-1",
          },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "permission-denied",
  );

  db.seed("dish_reviews/review-1", {
    id: "review-1",
    userId: "user-1",
    dishId: "dish-1",
    restaurantId: "restaurant-1",
  });

  await assert.rejects(
    () =>
      awardCreatedDishContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-1", token: { email: "user-1@example.com" } },
          data: {
            restaurantId: "restaurant-1",
            dishId: "dish-1",
            reviewId: "review-1",
          },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "permission-denied",
  );

  db.seed("bitescore_dishes/dish-1", {
    __createTimeMillis: 2000,
    id: "dish-1",
    name: "Pizza",
    restaurantId: "restaurant-1",
    isActive: true,
    createdByUserId: "user-1",
    createdFromReviewId: "review-1",
    createdWithRestaurantId: "restaurant-1",
    createdFromCreateFlow: true,
  });
  db.seed("bitescore_restaurants/restaurant-1", {
    id: "restaurant-1",
    name: "Pizza Place",
    city: "Lecanto",
    state: "FL",
    address: "1 Main St",
    phone: "555-0100",
    createdByUserId: "user-2",
    createdFromDishId: "dish-1",
    createdFromReviewId: "review-1",
    createdFromCreateFlow: true,
  });

  await assert.rejects(
    () =>
      awardCreatedDishContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-1", token: { email: "user-1@example.com" } },
          data: {
            restaurantId: "restaurant-1",
            dishId: "dish-1",
            reviewId: "review-1",
          },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "permission-denied",
  );
});

test("duplicate created dish callable does not double-award", async () => {
  const db = new FakeFirestore();
  seedCreatedDishAwardData(db, {
    userId: "user-1",
    restaurantId: "restaurant-1",
    dishId: "dish-1",
    reviewId: "review-1",
    newRestaurant: true,
  });

  await awardCreatedDishContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: {
        restaurantId: "restaurant-1",
        dishId: "dish-1",
        reviewId: "review-1",
      },
    }),
    { fieldValues: fakeFieldValues },
  );
  const duplicate = await awardCreatedDishContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: {
        restaurantId: "restaurant-1",
        dishId: "dish-1",
        reviewId: "review-1",
      },
    }),
    { fieldValues: fakeFieldValues },
  );

  assert.equal(duplicate.result.entries[0].wasCreated, false);
  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 3);
});

test("approved proposal callable lets admins award rename proposal points", async () => {
  const db = new FakeFirestore();
  seedApprovedProposalAwardData(db, {
    proposalId: "proposal-1",
    userId: "submitter-1",
    type: "rename",
  });

  const response =
    await awardApprovedDishProposalContributionPointsCallableHandler(
      db,
      callableRequest({
        auth: adminAuth(),
        data: {
          proposalId: "proposal-1",
          oldValue: "Pizza",
          newValue: "House Pizza",
          points: 99,
          userId: "attacker",
        },
      }),
      { fieldValues: fakeFieldValues },
    );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_rename_approved:proposal-1",
  );
  const entry = db.get(ledgerPath(ledgerId));

  assert.equal(response.ok, true);
  assert.deepEqual(response.result.entries, [
    { ledgerEntryId: ledgerId, points: 1, wasCreated: true },
  ]);
  assert.equal(entry.userId, "submitter-1");
  assert.equal(entry.pointsDelta, 1);
  assert.equal(entry.actionType, "dish_rename_approved");
  assert.equal(entry.sourceKey, "dish_rename_approved:proposal-1");
  assert.equal(entry.description, "Approved dish rename: Pizza -> House Pizza");
  assert.equal(entry.dishId, "dish-1");
  assert.equal(entry.dishName, "House Pizza");
  assert.equal(entry.restaurantId, "restaurant-1");
  assert.equal(entry.restaurantName, "Pizza Place");
  assert.equal(entry.requestId, "proposal-1");
  assert.equal(entry.oldValue, "Pizza");
  assert.equal(entry.newValue, "House Pizza");
  assert.equal(db.get(userProfilePath("submitter-1")).contributionPoints, 1);
  assert.equal(db.get(userProfilePath("attacker")), undefined);
});

test("approved proposal callable lets admins award merge proposal points", async () => {
  const db = new FakeFirestore();
  seedApprovedProposalAwardData(db, {
    proposalId: "merge-proposal",
    userId: "submitter-1",
    type: "merge",
  });

  const response =
    await awardApprovedDishProposalContributionPointsCallableHandler(
      db,
      callableRequest({
        auth: adminAuth(),
        data: { proposalId: "merge-proposal" },
      }),
      { fieldValues: fakeFieldValues },
    );
  const ledgerId = buildContributionLedgerDocumentIdFromSourceKey(
    "dish_merge_approved:merge-proposal",
  );
  const entry = db.get(ledgerPath(ledgerId));

  assert.deepEqual(response.result.entries, [
    { ledgerEntryId: ledgerId, points: 1, wasCreated: true },
  ]);
  assert.equal(entry.actionType, "dish_merge_approved");
  assert.equal(entry.description, "Approved merge of Pizza into House Pizza");
  assert.equal(entry.oldValue, "Pizza");
  assert.equal(entry.newValue, "House Pizza");
  assert.equal(entry.mergeSourceDishId, "dish-1");
  assert.equal(entry.mergeSourceDishName, "Pizza");
  assert.equal(entry.mergeTargetDishId, "dish-2");
  assert.equal(entry.mergeTargetDishName, "House Pizza");
  assert.equal(db.get(userProfilePath("submitter-1")).contributionPoints, 1);
});

test("approved proposal callable rejects non-admins and missing proposals", async () => {
  const db = new FakeFirestore();
  seedApprovedProposalAwardData(db, {
    proposalId: "proposal-1",
    userId: "submitter-1",
    type: "rename",
  });

  await assert.rejects(
    () =>
      awardApprovedDishProposalContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-1", token: { email: "user-1@example.com" } },
          data: { proposalId: "proposal-1", oldValue: "Pizza" },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "permission-denied",
  );
  await assert.rejects(
    () =>
      awardApprovedDishProposalContributionPointsCallableHandler(
        db,
        callableRequest({
          auth: adminAuth(),
          data: { proposalId: "missing-proposal" },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "not-found",
  );
  assert.equal(db.get(userProfilePath("submitter-1")), undefined);
});

test("approved proposal callable safely no-ops rejected and no-op rename proposals", async () => {
  const db = new FakeFirestore();
  seedApprovedProposalAwardData(db, {
    proposalId: "rejected-proposal",
    userId: "submitter-1",
    type: "rename",
    status: "rejected",
  });
  seedApprovedProposalAwardData(db, {
    proposalId: "noop-proposal",
    userId: "submitter-1",
    type: "rename",
  });

  const rejected =
    await awardApprovedDishProposalContributionPointsCallableHandler(
      db,
      callableRequest({
        auth: adminAuth(),
        data: {
          proposalId: "rejected-proposal",
          oldValue: "Pizza",
          newValue: "House Pizza",
        },
      }),
      { fieldValues: fakeFieldValues },
    );
  const noOp = await awardApprovedDishProposalContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: adminAuth(),
      data: {
        proposalId: "noop-proposal",
        oldValue: "House Pizza",
        newValue: "House Pizza",
      },
    }),
    { fieldValues: fakeFieldValues },
  );

  assert.deepEqual(rejected.result, { entries: [] });
  assert.deepEqual(noOp.result, { entries: [] });
  assert.equal(db.get(userProfilePath("submitter-1")), undefined);
});

test("duplicate approved proposal callable does not double-award", async () => {
  const db = new FakeFirestore();
  seedApprovedProposalAwardData(db, {
    proposalId: "proposal-1",
    userId: "submitter-1",
    type: "rename",
  });
  const request = callableRequest({
    auth: adminAuth(),
    data: {
      proposalId: "proposal-1",
      oldValue: "Pizza",
      newValue: "House Pizza",
    },
  });

  await awardApprovedDishProposalContributionPointsCallableHandler(
    db,
    request,
    { fieldValues: fakeFieldValues },
  );
  const duplicate =
    await awardApprovedDishProposalContributionPointsCallableHandler(
      db,
      request,
      { fieldValues: fakeFieldValues },
    );

  assert.equal(duplicate.result.entries[0].wasCreated, false);
  assert.equal(db.get(userProfilePath("submitter-1")).contributionPoints, 1);
});

test("source-specific callables share the cached contribution total", async () => {
  const db = new FakeFirestore();
  seedPublicReviews(db, { userId: "user-1", count: 5 });
  seedDishImageAwardData(db, { userId: "user-1" });
  seedCreatedDishAwardData(db, {
    userId: "user-1",
    restaurantId: "restaurant-1",
    dishId: "dish-2",
    reviewId: "review-created-dish",
  });
  db.seed("bitescore_dishes/dish-1", {
    __createTimeMillis: 1000,
    id: "dish-1",
    name: "Garlic Knots",
    restaurantId: "restaurant-1",
    isActive: true,
  });

  await awardReviewMilestoneContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { userId: "user-1" },
    }),
    { fieldValues: fakeFieldValues },
  );
  await awardDishImageContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { imageId: "image-1", dishId: "dish-1" },
    }),
    { fieldValues: fakeFieldValues },
  );
  await awardCreatedDishContributionPointsCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: {
        restaurantId: "restaurant-1",
        dishId: "dish-2",
        reviewId: "review-created-dish",
      },
    }),
    { fieldValues: fakeFieldValues },
  );

  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 3);
});

test("celebration callable marks caller's pending entry celebrated", async () => {
  const db = new FakeFirestore();
  db.seed(ledgerPath("ledger-1"), pendingLedgerEntry({ id: "ledger-1" }));

  const response =
    await markContributionPointLedgerEntriesCelebratedCallableHandler(
      db,
      callableRequest({
        auth: { uid: "user-1", token: { email: "user-1@example.com" } },
        data: { ledgerEntryIds: ["ledger-1"] },
      }),
      { fieldValues: fakeFieldValues },
    );
  const entry = db.get(ledgerPath("ledger-1"));

  assert.equal(response.ok, true);
  assert.deepEqual(response.result, {
    attemptedEntryIds: ["ledger-1"],
    markedEntryIds: ["ledger-1"],
    alreadyCelebratedEntryIds: [],
    missingEntryIds: [],
    ignoredEntryIds: [],
  });
  assert.equal(
    entry.celebrationStatus,
    contributionPointCelebrationStatus.celebrated,
  );
  assert.ok(entry.celebratedAt.startsWith("timestamp-"));
});

test("celebration callable marks multiple own pending entries", async () => {
  const db = new FakeFirestore();
  db.seed(ledgerPath("ledger-1"), pendingLedgerEntry({ id: "ledger-1" }));
  db.seed(ledgerPath("ledger-2"), pendingLedgerEntry({
    id: "ledger-2",
    sourceKey: "dish_image_added:dish-1:image-2",
  }));

  const response =
    await markContributionPointLedgerEntriesCelebratedCallableHandler(
      db,
      callableRequest({
        auth: { uid: "user-1", token: { email: "user-1@example.com" } },
        data: { ledgerEntryIds: ["ledger-1", "ledger-2", "ledger-1"] },
      }),
      { fieldValues: fakeFieldValues },
    );

  assert.deepEqual(response.result.markedEntryIds, ["ledger-1", "ledger-2"]);
  assert.deepEqual(response.result.attemptedEntryIds, ["ledger-1", "ledger-2"]);
  assert.equal(
    db.get(ledgerPath("ledger-1")).celebrationStatus,
    contributionPointCelebrationStatus.celebrated,
  );
  assert.equal(
    db.get(ledgerPath("ledger-2")).celebrationStatus,
    contributionPointCelebrationStatus.celebrated,
  );
});

test("celebration callable treats already-celebrated entries as safe success", async () => {
  const db = new FakeFirestore();
  db.seed(ledgerPath("ledger-1"), pendingLedgerEntry({
    id: "ledger-1",
    celebrationStatus: contributionPointCelebrationStatus.celebrated,
    celebratedAt: "existing-timestamp",
  }));

  const response =
    await markContributionPointLedgerEntriesCelebratedCallableHandler(
      db,
      callableRequest({
        auth: { uid: "user-1", token: { email: "user-1@example.com" } },
        data: { ledgerEntryIds: ["ledger-1"] },
      }),
      { fieldValues: fakeFieldValues },
    );

  assert.deepEqual(response.result.alreadyCelebratedEntryIds, ["ledger-1"]);
  assert.deepEqual(response.result.markedEntryIds, []);
  assert.equal(db.get(ledgerPath("ledger-1")).celebratedAt, "existing-timestamp");
});

test("celebration callable rejects attempts to mark another user's entry", async () => {
  const db = new FakeFirestore();
  db.seed(ledgerPath("ledger-1"), pendingLedgerEntry({
    id: "ledger-1",
    userId: "user-2",
  }));

  await assert.rejects(
    () =>
      markContributionPointLedgerEntriesCelebratedCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-1", token: { email: "user-1@example.com" } },
          data: { ledgerEntryIds: ["ledger-1"] },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "permission-denied",
  );
  assert.equal(
    db.get(ledgerPath("ledger-1")).celebrationStatus,
    contributionPointCelebrationStatus.pending,
  );
});

test("celebration callable reports missing entries safely", async () => {
  const db = new FakeFirestore();

  const response =
    await markContributionPointLedgerEntriesCelebratedCallableHandler(
      db,
      callableRequest({
        auth: { uid: "user-1", token: { email: "user-1@example.com" } },
        data: { ledgerEntryIds: ["missing-ledger"] },
      }),
      { fieldValues: fakeFieldValues },
    );

  assert.deepEqual(response.result, {
    attemptedEntryIds: ["missing-ledger"],
    markedEntryIds: [],
    alreadyCelebratedEntryIds: [],
    missingEntryIds: ["missing-ledger"],
    ignoredEntryIds: [],
  });
});

test("celebration callable only changes celebration bookkeeping fields", async () => {
  const db = new FakeFirestore();
  db.seed(ledgerPath("ledger-1"), pendingLedgerEntry({
    id: "ledger-1",
    pointsDelta: 7,
    sourceKey: "review_milestone:user-1:35",
    unrelatedField: "keep-me",
  }));
  db.seed(userProfilePath("user-1"), {
    userId: "user-1",
    contributionPoints: 42,
    lastContributionAt: "unchanged",
  });

  await markContributionPointLedgerEntriesCelebratedCallableHandler(
    db,
    callableRequest({
      auth: { uid: "user-1", token: { email: "user-1@example.com" } },
      data: { ledgerEntryIds: ["ledger-1"] },
    }),
    { fieldValues: fakeFieldValues },
  );
  const entry = db.get(ledgerPath("ledger-1"));
  const userProfile = db.get(userProfilePath("user-1"));

  assert.equal(entry.pointsDelta, 7);
  assert.equal(entry.sourceKey, "review_milestone:user-1:35");
  assert.equal(entry.status, contributionPointStatus.active);
  assert.equal(entry.unrelatedField, "keep-me");
  assert.equal(
    entry.celebrationStatus,
    contributionPointCelebrationStatus.celebrated,
  );
  assert.deepEqual(userProfile, {
    userId: "user-1",
    contributionPoints: 42,
    lastContributionAt: "unchanged",
  });
});

test("celebration callable rejects unauthenticated callers", async () => {
  const db = new FakeFirestore();

  await assert.rejects(
    () =>
      markContributionPointLedgerEntriesCelebratedCallableHandler(
        db,
        callableRequest({
          auth: null,
          data: { ledgerEntryIds: ["ledger-1"] },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "unauthenticated",
  );
});

test("celebration callable rejects oversized input lists", async () => {
  const db = new FakeFirestore();

  await assert.rejects(
    () =>
      markContributionPointLedgerEntriesCelebratedCallableHandler(
        db,
        callableRequest({
          auth: { uid: "user-1", token: { email: "user-1@example.com" } },
          data: {
            ledgerEntryIds: Array.from(
              { length: 31 },
              (_, index) => `ledger-${index}`,
            ),
          },
        }),
        { fieldValues: fakeFieldValues },
      ),
    (error) => error.code === "invalid-argument",
  );
});

function awardDraft(overrides = {}) {
  return {
    userId: "user-1",
    points: 3,
    actionType: "dish_created",
    sourceKey: "dish_created:dish-1",
    description: "Added a dish",
    dishId: "dish-1",
    dishName: "Pizza",
    restaurantId: "restaurant-1",
    restaurantName: "Pizza Place",
    restaurantCity: "Lecanto",
    restaurantState: "FL",
    restaurantAddress: "1 Main St",
    restaurantPhone: "555-0100",
    ...overrides,
  };
}

function pendingLedgerEntry(overrides = {}) {
  return {
    id: "ledger-1",
    userId: "user-1",
    pointsDelta: 1,
    actionType: "dish_image_added",
    sourceKey: "dish_image_added:dish-1:image-1",
    description: "Added a dish image",
    status: contributionPointStatus.active,
    celebrationStatus: contributionPointCelebrationStatus.pending,
    ...overrides,
  };
}

function adminAuth() {
  return { uid: "admin-1", token: { admin: true, email: "admin@example.com" } };
}

function callableRequest({ auth, data }) {
  return { auth, data };
}

function ledgerPath(id) {
  return `${contributionPointLedgerCollection}/${id}`;
}

function userProfilePath(userId) {
  return `${contributionUserProfilesCollection}/${userId}`;
}

function seedPublicReviews(db, { userId, count }) {
  for (let index = 1; index <= count; index += 1) {
    db.seed(`dish_reviews/review-${index}`, {
      id: `review-${index}`,
      userId,
      dishId: `dish-${index}`,
      restaurantId: `restaurant-${index}`,
      isPublic: true,
      overallBiteScore: 8,
    });
  }
}

function seedDishImageAwardData(db, { userId }) {
  db.seed("bitescore_dish_images/image-1", {
    id: "image-1",
    dishId: "dish-1",
    restaurantId: "restaurant-1",
    uploadedByUserId: userId,
    reviewId: "review-1",
    imageUrl: "https://example.com/image.jpg",
  });
  db.seed("bitescore_dishes/dish-1", {
    id: "dish-1",
    name: "Pizza",
    restaurantId: "restaurant-1",
  });
  db.seed("bitescore_restaurants/restaurant-1", {
    id: "restaurant-1",
    name: "Pizza Place",
    city: "Lecanto",
    state: "FL",
    address: "1 Main St",
    phone: "555-0100",
  });
}

function seedCreatedDishAwardData(db, {
  userId,
  restaurantId,
  dishId,
  reviewId,
  newRestaurant = false,
  dishOverrides = {},
  restaurantOverrides = {},
}) {
  db.seed(`dish_reviews/${reviewId}`, {
    id: reviewId,
    userId,
    dishId,
    restaurantId,
    isPublic: true,
    overallBiteScore: 8,
  });
  db.seed(`bitescore_dishes/${dishId}`, {
    __createTimeMillis: 2000,
    id: dishId,
    name: "Pizza",
    restaurantId,
    isActive: true,
    createdByUserId: userId,
    createdFromReviewId: reviewId,
    createdWithRestaurantId: restaurantId,
    createdFromCreateFlow: true,
    ...dishOverrides,
  });
  db.seed(`bitescore_restaurants/${restaurantId}`, {
    id: restaurantId,
    name: "Pizza Place",
    city: "Lecanto",
    state: "FL",
    address: "1 Main St",
    phone: "555-0100",
    ...(newRestaurant
      ? {
          createdByUserId: userId,
          createdFromDishId: dishId,
          createdFromReviewId: reviewId,
          createdFromCreateFlow: true,
        }
      : {}),
    ...restaurantOverrides,
  });
}

function seedApprovedProposalAwardData(db, {
  proposalId,
  userId,
  type,
  status = "pending",
}) {
  db.seed(`dish_edit_proposals/${proposalId}`, {
    id: proposalId,
    type,
    restaurantId: "restaurant-1",
    targetDishId: "dish-1",
    mergeTargetDishId: type === "merge" ? "dish-2" : null,
    proposedName: type === "rename" ? "House Pizza" : null,
    userId,
    status,
  });
  db.seed("bitescore_dishes/dish-1", {
    id: "dish-1",
    name: type === "rename" ? "House Pizza" : "Pizza",
    restaurantId: "restaurant-1",
    isActive: true,
  });
  db.seed("bitescore_dishes/dish-2", {
    id: "dish-2",
    name: "House Pizza",
    restaurantId: "restaurant-1",
    isActive: true,
  });
  db.seed("bitescore_restaurants/restaurant-1", {
    id: "restaurant-1",
    name: "Pizza Place",
    city: "Lecanto",
    state: "FL",
    address: "1 Main St",
    phone: "555-0100",
  });
}

class FakeFirestore {
  constructor() {
    this.store = new Map();
    this.clock = 0;
    this.failOnSetPath = null;
  }

  get size() {
    return this.store.size;
  }

  collection(path) {
    return new FakeCollectionReference(this, path);
  }

  async runTransaction(updateFunction) {
    const workingStore = cloneStore(this.store);
    const transaction = new FakeTransaction(this, workingStore);
    const result = await updateFunction(transaction);
    this.store = workingStore;
    return result;
  }

  seed(path, data) {
    this.store.set(path, cloneValue(data));
  }

  get(path) {
    return cloneValue(this.store.get(path));
  }
}

class FakeTransaction {
  constructor(db, workingStore) {
    this.db = db;
    this.workingStore = workingStore;
  }

  async get(ref) {
    return new FakeDocumentSnapshot(ref.id, this.workingStore.get(ref.path));
  }

  set(ref, data, options = undefined) {
    if (this.db.failOnSetPath === ref.path) {
      throw new Error(`Injected write failure for ${ref.path}`);
    }
    const existing =
      options && options.merge ? this.workingStore.get(ref.path) ?? {} : {};
    const next = options && options.merge ? cloneValue(existing) : {};
    for (const [key, value] of Object.entries(data)) {
      next[key] = this.materializeValue(value, existing[key]);
    }
    this.workingStore.set(ref.path, next);
  }

  materializeValue(value, existingValue) {
    if (value && value.__op === "increment") {
      return (typeof existingValue === "number" ? existingValue : 0) + value.delta;
    }
    if (value && value.__op === "serverTimestamp") {
      this.db.clock += 1;
      return `timestamp-${this.db.clock}`;
    }
    return cloneValue(value);
  }
}

class FakeDocumentReference {
  constructor(db, path, id) {
    this.db = db;
    this.path = path;
    this.id = id;
  }

  async get() {
    return new FakeDocumentSnapshot(this.id, this.db.store.get(this.path));
  }
}

class FakeCollectionReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentReference(this.db, `${this.path}/${id}`, id);
  }

  where(fieldPath, opStr, value) {
    return new FakeQuery(this.db, this.path, [
      { fieldPath, opStr, value },
    ]);
  }
}

class FakeQuery {
  constructor(db, path, filters) {
    this.db = db;
    this.path = path;
    this.filters = filters;
  }

  where(fieldPath, opStr, value) {
    return new FakeQuery(this.db, this.path, [
      ...this.filters,
      { fieldPath, opStr, value },
    ]);
  }

  async get() {
    const docs = [];
    const prefix = `${this.path}/`;
    for (const [path, data] of this.db.store.entries()) {
      if (!path.startsWith(prefix)) {
        continue;
      }
      const id = path.slice(prefix.length);
      if (id.includes("/")) {
        continue;
      }
      if (this.matches(data)) {
        docs.push(new FakeDocumentSnapshot(id, data));
      }
    }
    return { docs };
  }

  matches(data) {
    return this.filters.every((filter) => {
      if (filter.opStr !== "==") {
        throw new Error(`Unsupported fake query operator ${filter.opStr}`);
      }
      return data && data[filter.fieldPath] === filter.value;
    });
  }
}

class FakeDocumentSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    const createTimeMillis = data && data.__createTimeMillis;
    this.createTime =
      typeof createTimeMillis === "number"
        ? { toMillis: () => createTimeMillis }
        : undefined;
  }

  get exists() {
    return this._data !== undefined;
  }

  data() {
    const cloned = cloneValue(this._data);
    if (cloned && Object.prototype.hasOwnProperty.call(cloned, "__createTimeMillis")) {
      delete cloned.__createTimeMillis;
    }
    return cloned;
  }
}

function cloneStore(store) {
  const clone = new Map();
  for (const [key, value] of store.entries()) {
    clone.set(key, cloneValue(value));
  }
  return clone;
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}
