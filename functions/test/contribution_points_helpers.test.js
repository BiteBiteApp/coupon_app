const assert = require("node:assert/strict");
const test = require("node:test");

const {
  awardContributionPointsCallableHandler,
  awardContributionPointsTransaction,
  buildContributionLedgerDocumentIdFromSourceKey,
  buildContributionReversalDocumentId,
  contributionPointCelebrationStatus,
  contributionPointLedgerCollection,
  contributionPointStatus,
  contributionUserProfilesCollection,
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
    return {
      doc: (id) => new FakeDocumentReference(`${path}/${id}`, id),
    };
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
  constructor(path, id) {
    this.path = path;
    this.id = id;
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
