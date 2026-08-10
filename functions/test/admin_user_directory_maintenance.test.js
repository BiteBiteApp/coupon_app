"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  adminUserSourceConfigurations,
  handleAdminUserSourceWrite,
} = require("../lib/admin_user_directory_maintenance.js");
const {
  adminUserClaimedRestaurantDocumentPath,
  adminUserDirectoryDocumentPath,
  adminUserSourceKinds,
  adminUserSourceSummaryDocumentPath,
} = require("../lib/admin_user_directory_contract.js");

const now = new Date("2026-08-09T18:00:00.000Z");
const prior = new Date("2026-08-08T18:00:00.000Z");

function dateValue(value) {
  return value instanceof Date ? value.getTime() : null;
}

class FakeAdminUserDirectoryDatabase {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial));
    this.operations = [];
    this.transactionCount = 0;
    this._tail = Promise.resolve();
  }

  runTransaction(operation) {
    const execute = async () => {
      const transactionId = ++this.transactionCount;
      const staged = [];
      const boundary = {
        getDocument: async (path) => {
          this.operations.push({transactionId, operation: "get", path});
          return this.records.has(path)
            ? {id: path.split("/").at(-1), data: this.records.get(path)}
            : null;
        },
        queryDocuments: async (query) => {
          this.operations.push({transactionId, operation: "query", query});
          const prefix = `${query.collectionPath}/`;
          const segments = query.collectionPath.split("/").length + 1;
          let documents = [...this.records.entries()]
            .filter(([path]) => path.startsWith(prefix) && path.split("/").length === segments)
            .map(([path, data]) => ({id: path.slice(prefix.length), data}))
            .filter((document) => document.data[query.where.field] === query.where.value);
          for (const order of [...query.orderBy].reverse()) {
            if (order.field !== "__name__") {
              documents = documents.filter((document) =>
                Object.hasOwn(document.data, order.field) && document.data[order.field] != null);
            }
            documents.sort((left, right) => {
              const leftValue = order.field === "__name__"
                ? left.id
                : dateValue(left.data[order.field]) ?? left.data[order.field];
              const rightValue = order.field === "__name__"
                ? right.id
                : dateValue(right.data[order.field]) ?? right.data[order.field];
              const compared = typeof leftValue === "string"
                ? leftValue.localeCompare(rightValue)
                : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
              return order.direction === "asc" ? compared : -compared;
            });
          }
          return documents.slice(0, query.limit);
        },
        setDocument: (path, data) => {
          this.operations.push({transactionId, operation: "set", path, data});
          staged.push({operation: "set", path, data});
        },
        deleteDocument: (path) => {
          this.operations.push({transactionId, operation: "delete", path});
          staged.push({operation: "delete", path});
        },
      };
      const result = await operation(boundary);
      for (const write of staged) {
        if (write.operation === "set") this.records.set(write.path, write.data);
        else this.records.delete(write.path);
      }
      return result;
    };
    const result = this._tail.then(execute, execute);
    this._tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function restaurant(uid = "user-1", overrides = {}) {
  return {
    name: "Owned Restaurant",
    address: "1 Main Street",
    city: "Crystal River",
    state: "FL",
    zipCode: "34428",
    location: {latitude: 28.9, longitude: -82.6},
    ownerUserId: uid,
    isClaimed: true,
    isActive: true,
    createdAt: prior,
    updatedAt: now,
    ...overrides,
  };
}

function fixture(kind, uid = "user-1", overrides = {}) {
  const base = {createdAt: prior, updatedAt: now};
  const values = {
    restaurantAccount: {
      ...base,
      uid,
      restaurantName: "Account Current",
      email: "account@example.test",
      approvalStatus: "approved",
    },
    userProfile: {
      ...base,
      userId: uid,
      displayName: "Profile Current",
      contributionPoints: 3,
      lastContributionAt: now,
    },
    publicReviewerProfile: {
      ...base,
      userId: uid,
      publicDisplayName: "Public Current",
      fallbackUsername: "public_current",
    },
    biteScoreRestaurant: restaurant(uid),
    restaurantClaimRequest: {
      ...base,
      requesterUserId: uid,
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant",
      claimantName: "Claim Current",
      email: "claim@example.test",
      phone: "3525550100",
      status: "pending",
    },
    dishReview: {
      ...base,
      userId: uid,
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      overallImpression: 9,
    },
    reviewReport: {
      ...base,
      reportingUserId: uid,
      reviewId: "review-1",
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      status: "pending",
    },
    restaurantReport: {
      ...base,
      reportingUserId: uid,
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant",
      status: "pending",
    },
    dishReport: {
      ...base,
      reportingUserId: uid,
      dishId: "dish-1",
      dishName: "Dish",
      restaurantId: "restaurant-1",
      status: "pending",
    },
    duplicateRestaurantReport: {
      ...base,
      reportingUserId: uid,
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant",
      status: "pending",
    },
    dishEditProposal: {
      ...base,
      userId: uid,
      type: "rename",
      restaurantId: "restaurant-1",
      targetDishId: "dish-1",
      status: "pending",
    },
    reviewFeedbackVote: {
      ...base,
      userId: uid,
      reviewId: "review-1",
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      voteType: "helpful",
    },
  };
  return {...values[kind], ...overrides};
}

function sourceDocumentId(kind, uid = "user-1") {
  return adminUserSourceConfigurations[kind].documentIdFallback
    ? uid
    : `${kind}-1`;
}

function sourcePath(kind, uid = "user-1") {
  return `${adminUserSourceConfigurations[kind].collectionPath}/${sourceDocumentId(kind, uid)}`;
}

async function deliver(database, kind, uid = "user-1", event = {}) {
  const current = database.records.get(sourcePath(kind, uid)) ?? null;
  return handleAdminUserSourceWrite(database, {
    sourceKind: kind,
    sourceDocumentId: sourceDocumentId(kind, uid),
    before: event.before ?? null,
    after: event.after === undefined ? current : event.after,
    now,
  });
}

for (const kind of adminUserSourceKinds) {
  test(`${kind} rereads current source and maintains exactly one summary and directory row`, async () => {
    const uid = `record-only-${kind}`;
    const path = sourcePath(kind, uid);
    const current = fixture(kind, uid);
    const database = new FakeAdminUserDirectoryDatabase({[path]: current});
    await handleAdminUserSourceWrite(database, {
      sourceKind: kind,
      sourceDocumentId: sourceDocumentId(kind, uid),
      before: null,
      after: fixture(kind, uid, {displayName: "STALE_EVENT_CANARY"}),
      now,
    });
    const summaryPath = adminUserSourceSummaryDocumentPath({uid, sourceKind: kind});
    const directory = database.records.get(adminUserDirectoryDocumentPath(uid));
    assert.equal(database.records.has(summaryPath), true);
    assert.deepEqual(directory.sourceKinds, [kind]);
    assert.equal(JSON.stringify(directory).includes("STALE_EVENT_CANARY"), false);
    assert.equal(
      [...database.records.keys()].filter((entry) =>
        entry.startsWith("admin_user_directory_source_summaries/")).length,
      1,
    );
  });
}

test("duplicate and out-of-order delivery converge and suppress redundant writes", async () => {
  const path = sourcePath("userProfile");
  const database = new FakeAdminUserDirectoryDatabase({
    [path]: fixture("userProfile", "user-1", {displayName: "Newest Current"}),
  });
  await deliver(database, "userProfile", "user-1", {
    after: fixture("userProfile", "user-1", {displayName: "Older Event"}),
  });
  const writesAfterFirst = database.operations.filter((entry) => entry.operation === "set").length;
  await deliver(database, "userProfile", "user-1", {
    before: fixture("userProfile", "user-1", {displayName: "Oldest Event"}),
    after: fixture("userProfile", "user-1", {displayName: "Older Event"}),
  });
  const directory = database.records.get(adminUserDirectoryDocumentPath("user-1"));
  assert.equal(directory.displayName, "Newest Current");
  assert.equal(
    database.operations.filter((entry) => entry.operation === "set").length,
    writesAfterFirst,
  );
});

test("delete after recreation and update after deletion use current source state", async () => {
  const path = sourcePath("restaurantReport");
  const database = new FakeAdminUserDirectoryDatabase({
    [path]: fixture("restaurantReport"),
  });
  await deliver(database, "restaurantReport", "user-1");
  database.records.delete(path);
  await deliver(database, "restaurantReport", "user-1", {
    before: fixture("restaurantReport"),
    after: fixture("restaurantReport", "user-1", {status: "stale-update"}),
  });
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-1")), false);

  database.records.set(path, fixture("restaurantReport", "user-1", {status: "recreated"}));
  await deliver(database, "restaurantReport", "user-1", {
    before: fixture("restaurantReport"),
    after: null,
  });
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-1")), true);
});

test("UID reassignment reconciles old and new identities for a multi-record source", async () => {
  const kind = "dishReview";
  const path = sourcePath(kind, "user-a");
  const before = fixture(kind, "user-a");
  const after = fixture(kind, "user-b");
  const database = new FakeAdminUserDirectoryDatabase({[path]: after});
  await handleAdminUserSourceWrite(database, {
    sourceKind: kind,
    sourceDocumentId: sourceDocumentId(kind, "user-a"),
    before,
    after,
    now,
  });
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-a")), false);
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-b")), true);
});

test("UID reassignment reconciles old and new identities for a direct profile source", async () => {
  const path = "user_profiles/user-a";
  const before = fixture("userProfile", "user-a");
  const after = fixture("userProfile", "user-b");
  const database = new FakeAdminUserDirectoryDatabase({[path]: after});
  await handleAdminUserSourceWrite(database, {
    sourceKind: "userProfile",
    sourceDocumentId: "user-a",
    before,
    after,
    now,
  });
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-a")), false);
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-b")), true);
});

test("invalid source UIDs are ignored while a valid reassigned UID is reconciled", async () => {
  const path = sourcePath("dishReview", "user-a");
  const after = fixture("dishReview", "user-b");
  const database = new FakeAdminUserDirectoryDatabase({[path]: after});
  await handleAdminUserSourceWrite(database, {
    sourceKind: "dishReview",
    sourceDocumentId: sourceDocumentId("dishReview", "user-a"),
    before: fixture("dishReview", "invalid/uid"),
    after,
    now,
  });
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-b")), true);
});

test("concurrent category reconciliation retains both current summaries", async () => {
  const database = new FakeAdminUserDirectoryDatabase({
    [sourcePath("userProfile")]: fixture("userProfile"),
    [sourcePath("dishReview")]: fixture("dishReview"),
  });
  await Promise.all([
    deliver(database, "userProfile"),
    deliver(database, "dishReview"),
  ]);
  const directory = database.records.get(adminUserDirectoryDocumentPath("user-1"));
  assert.deepEqual(directory.sourceKinds, ["userProfile", "dishReview"]);
  assert.equal(directory.activityProfile, true);
  assert.equal(directory.activityReviews, true);
});

test("deleting one category retains aggregate and deleting the final source removes it", async () => {
  const profilePath = sourcePath("userProfile");
  const reviewPath = sourcePath("dishReview");
  const database = new FakeAdminUserDirectoryDatabase({
    [profilePath]: fixture("userProfile"),
    [reviewPath]: fixture("dishReview"),
  });
  await deliver(database, "userProfile");
  await deliver(database, "dishReview");
  database.records.delete(profilePath);
  await deliver(database, "userProfile", "user-1", {
    before: fixture("userProfile"),
    after: null,
  });
  let directory = database.records.get(adminUserDirectoryDocumentPath("user-1"));
  assert.deepEqual(directory.sourceKinds, ["dishReview"]);
  database.records.delete(reviewPath);
  await deliver(database, "dishReview", "user-1", {
    before: fixture("dishReview"),
    after: null,
  });
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-1")), false);
  assert.equal(
    database.records.has(adminUserSourceSummaryDocumentPath({
      uid: "user-1",
      sourceKind: "dishReview",
    })),
    false,
  );
});

test("legacy records without timestamps remain present through the bounded ID fallback", async () => {
  const path = sourcePath("reviewFeedbackVote");
  const legacy = fixture("reviewFeedbackVote", "user-1", {
    createdAt: undefined,
    updatedAt: undefined,
  });
  const database = new FakeAdminUserDirectoryDatabase({[path]: legacy});
  await deliver(database, "reviewFeedbackVote", "user-1", {after: legacy});
  const directory = database.records.get(adminUserDirectoryDocumentPath("user-1"));
  assert.equal(directory.activityReviewVotes, true);
  assert.equal(directory.latestActivityAt, null);
});

test("restaurant rename and owner change update one claimed index and both UID aggregates", async () => {
  const path = sourcePath("biteScoreRestaurant", "user-a");
  const id = sourceDocumentId("biteScoreRestaurant", "user-a");
  const before = restaurant("user-a", {name: "Before Name"});
  const after = restaurant("user-b", {name: "After Name"});
  const database = new FakeAdminUserDirectoryDatabase({[path]: after});
  await handleAdminUserSourceWrite(database, {
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: id,
    before,
    after,
    now,
  });
  const claimed = database.records.get(adminUserClaimedRestaurantDocumentPath(id));
  assert.equal(claimed.ownerUid, "user-b");
  assert.equal(claimed.displayRestaurantName, "After Name");
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-a")), false);
  assert.equal(database.records.has(adminUserDirectoryDocumentPath("user-b")), true);

  database.records.delete(path);
  await handleAdminUserSourceWrite(database, {
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: id,
    before: after,
    after: null,
    now,
  });
  assert.equal(database.records.has(adminUserClaimedRestaurantDocumentPath(id)), false);
});

test("source and aggregate reconciliation enforce exact bounded read maxima", async () => {
  for (const kind of adminUserSourceKinds.filter((value) => value !== "biteScoreRestaurant")) {
    const database = new FakeAdminUserDirectoryDatabase({
      [sourcePath(kind)]: fixture(kind),
    });
    await deliver(database, kind);
    const transactionId = database.transactionCount;
    const operations = database.operations.filter((entry) => entry.transactionId === transactionId);
    const queries = operations.filter((entry) => entry.operation === "query");
    const gets = operations.filter((entry) => entry.operation === "get");
    const expectedQueries = adminUserSourceConfigurations[kind].documentIdFallback
      ? 0
      : adminUserSourceConfigurations[kind].uidFields.length * 3;
    assert.equal(queries.length, expectedQueries, `${kind} query count`);
    assert.equal(gets.length, adminUserSourceConfigurations[kind].documentIdFallback ? 14 : 13);
    assert.equal(queries.every((entry) => entry.query.limit === 1), true);
    assert.equal(
      gets.filter((entry) =>
        entry.path.startsWith("admin_user_directory_source_summaries/")).length,
      12,
    );
  }
});

test("no query is unbounded and no complete collection or user history is read", async () => {
  const database = new FakeAdminUserDirectoryDatabase({
    [sourcePath("dishEditProposal")]: fixture("dishEditProposal"),
  });
  await deliver(database, "dishEditProposal");
  const queries = database.operations.filter((entry) => entry.operation === "query");
  assert.equal(queries.length, 6);
  for (const operation of queries) {
    assert.equal(operation.query.limit, 1);
    assert.equal(typeof operation.query.where.field, "string");
    assert.equal(operation.query.where.value, "user-1");
  }
});
