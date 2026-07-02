const assert = require("node:assert/strict");
const test = require("node:test");

const {
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

test("source-specific callables share the cached contribution total", async () => {
  const db = new FakeFirestore();
  seedPublicReviews(db, { userId: "user-1", count: 5 });
  seedDishImageAwardData(db, { userId: "user-1" });

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

  assert.equal(db.get(userProfilePath("user-1")).contributionPoints, 2);
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
  }

  get exists() {
    return this._data !== undefined;
  }

  data() {
    return cloneValue(this._data);
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
