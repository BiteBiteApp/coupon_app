"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {GeoPoint} = require("firebase-admin/firestore");
const {
  ResourcePath,
} = require("../node_modules/@google-cloud/firestore/build/src/path.js");

const {
  handleBiteSaverCouponOfferWrite,
  handleBiteSaverDailySpecialOfferWrite,
  handleBiteSaverRestaurantWrite,
  handleBiteScoreRestaurantWrite,
  createFirestoreSearchIndexDatabase,
  processSearchIndexJob,
  reconcileBiteSaverCouponOfferIndex,
  reconcileBiteSaverDailySpecialOfferIndex,
  reconcileBiteSaverRestaurantIndex,
  reconcileBiteScoreDishIndex,
  reconcileBiteScoreRestaurantIndex,
} = require("../lib/search_index_maintenance.js");
const {
  biteSaverOfferCatalogUpdatedAtField,
  biteSaverOfferParentFingerprint,
  biteScoreDishParentFingerprint,
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverDailySpecialOfferIndex,
} = require("../lib/search_index_builders.js");
const {
  privateCustomerBiteSaverCatalogGenerationCollection,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  buildSearchIndexJobDocument,
  customerBiteSaverCatalogGenerationShard,
  createSearchIndexDocumentId,
  createSearchIndexJobId,
  createSearchIndexSourceOccurrenceId,
  maximumSearchIndexDocumentBytes,
  maximumSearchIndexWorkerBatchSize,
  readPrivateSearchIndexCursorDocumentId,
  searchIndexJobVersion,
  serializedSearchIndexDocumentBytes,
} = require("../lib/search_index_contract.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");
const {
  dartUtf16FirestoreBytesOrderKey,
  decodeDartUtf16FirestoreBytesOrderKey,
} = require("../lib/customer_bitesaver_search_matcher.js");

const now = new Date("2026-08-08T16:00:00.000Z");
const coordinates = {latitude: 28.8517, longitude: -82.487};
const geohash = canonicalRestaurantGeohash(coordinates);

function catalogGenerationPath(identity) {
  const shard = customerBiteSaverCatalogGenerationShard({identity});
  return {
    ...shard,
    path: `${privateCustomerBiteSaverCatalogGenerationCollection}/${shard.documentId}`,
  };
}

function compareFirestoreDocumentIds(first, second) {
  return new ResourcePath("fake-query", first).compareTo(
    new ResourcePath("fake-query", second),
  );
}

function sameFirestoreQueryValue(first, second) {
  if (first instanceof Uint8Array && second instanceof Uint8Array) {
    return Buffer.from(first).equals(Buffer.from(second));
  }
  return first === second;
}

class FakeSearchIndexDatabase {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial));
    this.operations = [];
    this.failSetPath = null;
    this.deleteDocumentHook = null;
    this.getDocumentHook = null;
    this.queryDocumentsHook = null;
    this.beforeTransactionCommitHook = null;
    this.transactionAttempts = [];
    this.nextServerTimestampMilliseconds = now.getTime();
  }

  async getDocument(path) {
    this.operations.push({operation: "get", path});
    if (this.getDocumentHook !== null) {
      const result = await this.getDocumentHook(path, this);
      if (result !== undefined) return result;
    }
    return this.records.has(path) ? this.records.get(path) : null;
  }

  async setDocument(path, data) {
    this.operations.push({operation: "set", path, data});
    if (path === this.failSetPath) throw new Error("injected-index-write-failure");
    this.records.set(path, data);
  }

  async deleteDocument(path) {
    this.operations.push({operation: "delete", path});
    if (this.deleteDocumentHook !== null) {
      await this.deleteDocumentHook(path, this);
    }
    this.records.delete(path);
  }

  async createDocumentIfAbsent(path, data) {
    this.operations.push({operation: "createIfAbsent", path, data});
    if (this.records.has(path)) return false;
    this.records.set(path, data);
    return true;
  }

  async updateDocument(path, data) {
    this.operations.push({operation: "update", path, data});
    this.records.set(path, {...(this.records.get(path) ?? {}), ...data});
  }

  async queryDocuments(query) {
    this.operations.push({operation: "query", query});
    const prefix = `${query.collectionPath}/`;
    const expectedSegments = query.collectionPath.split("/").length + 1;
    let documents = [...this.records.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.split("/").length === expectedSegments)
      .map(([path, data]) => ({id: path.slice(prefix.length), data}))
      .filter((document) => query.where === undefined ||
        sameFirestoreQueryValue(
          document.data[query.where.field],
          query.where.value,
        ))
      .sort((first, second) =>
        compareFirestoreDocumentIds(first.id, second.id));
    if (query.afterDocumentId !== undefined && query.afterDocumentId !== null) {
      documents = documents.filter((document) =>
        compareFirestoreDocumentIds(document.id, query.afterDocumentId) > 0);
    }
    const selected = documents.slice(0, query.limit);
    if (this.queryDocumentsHook !== null) {
      const result = await this.queryDocumentsHook(query, selected, this);
      if (result !== undefined) return result;
    }
    return selected;
  }

  async runTransaction(operation) {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const reads = new Map();
      const writes = [];
      const transaction = {
        getDocument: async (path) => {
          const value = await this.getDocument(path);
          reads.set(path, this.records.get(path));
          return value;
        },
        setDocument: (path, data) => {
          writes.push({operation: "set", path, data});
        },
        deleteDocument: (path) => {
          writes.push({operation: "delete", path});
        },
        updateExistingDocumentServerTimestamp: (path, field) => {
          writes.push({operation: "serverTimestamp", path, field});
        },
      };
      const result = await operation(transaction);
      this.transactionAttempts.push({
        attempt,
        readPaths: [...reads.keys()],
        writeCount: writes.length,
        writes: writes.map((write) => ({...write})),
      });
      if (this.beforeTransactionCommitHook !== null) {
        await this.beforeTransactionCommitHook({attempt, reads, writes}, this);
      }
      const conflicted = [...reads].some(([path, value]) =>
        this.records.get(path) !== value);
      if (conflicted) continue;
      for (const write of writes) {
        if (write.operation === "set") {
          await this.setDocument(write.path, write.data);
        } else if (write.operation === "delete") {
          await this.deleteDocument(write.path);
        } else {
          this.operations.push({...write});
          if (!this.records.has(write.path)) {
            const error = new Error("missing-document");
            error.code = 5;
            throw error;
          }
          this.nextServerTimestampMilliseconds += 1;
          this.records.set(write.path, {
            ...this.records.get(write.path),
            [write.field]: new Date(this.nextServerTimestampMilliseconds),
          });
        }
      }
      return result;
    }
    throw new Error("injected-transaction-retry-limit");
  }
}

function pauseFirstTransactionCommit(database) {
  let release;
  let signalReady;
  const ready = new Promise((resolve) => {
    signalReady = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  let paused = false;
  database.beforeTransactionCommitHook = async () => {
    if (paused) return;
    paused = true;
    signalReady();
    await released;
  };
  return {ready, release};
}

function pauseFirstQueryResult(database, predicate) {
  let release;
  let signalReady;
  const ready = new Promise((resolve) => {
    signalReady = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  let paused = false;
  database.queryDocumentsHook = async (query, documents) => {
    if (paused || !predicate(query)) return undefined;
    paused = true;
    signalReady(documents);
    await released;
    return documents;
  };
  return {ready, release};
}

function biteSaverRestaurant(overrides = {}) {
  return {
    restaurantName: "Current BiteSaver",
    city: "Crystal River",
    state: "FL",
    zipCode: "34428",
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    geohash,
    approvalStatus: "approved",
    couponApplicationSubmitted: true,
    subscriptionStatus: "active",
    couponPostingEnabled: true,
    updatedAt: now,
    ...overrides,
  };
}

function biteScoreRestaurant(overrides = {}) {
  return {
    name: "Current BiteScore",
    city: "Crystal River",
    state: "FL",
    zipCode: "34428",
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    geohash,
    isActive: true,
    isClaimed: false,
    updatedAt: now,
    ...overrides,
  };
}

function biteScoreDish(id, overrides = {}) {
  return {
    id,
    restaurantId: "restaurant-1",
    restaurantName: "stale denormalized name",
    name: `Dish ${id}`,
    category: "Dinner",
    isActive: true,
    updatedAt: now,
    ...overrides,
  };
}

function coupon(id, overrides = {}) {
  return {
    id,
    restaurant: "stale source name",
    title: `Coupon ${id}`,
    startTime: new Date(now.getTime() - 60_000),
    endTime: new Date(now.getTime() + 60_000),
    updatedAt: now,
    ...overrides,
  };
}

function dailySpecial(id, overrides = {}) {
  return {
    id,
    restaurantId: "account-1",
    ownerUid: "account-1",
    title: `Special ${id}`,
    isActive: true,
    availabilityMode: "todayOnly",
    allDay: true,
    expiresAt: new Date(now.getTime() + 60_000),
    updatedAt: now,
    ...overrides,
  };
}

function withoutProperties(value, ...properties) {
  const result = {...value};
  for (const property of properties) {
    delete result[property];
  }
  return result;
}

function jobFixture(overrides = {}) {
  const input = {
    jobKind: "biteScoreDishes",
    parentSource: "biteScore",
    parentSourceDocumentId: "restaurant-1",
    requestedSourceFingerprint: biteScoreDishParentFingerprint(biteScoreRestaurant()),
    sourceOccurrenceId: "1".repeat(64),
    now,
    ...overrides,
  };
  const document = buildSearchIndexJobDocument(input);
  const id = createSearchIndexJobId({...document, continuationCursor: document.continuationCursor});
  return {id, document};
}

test("direct create and duplicate delivery produce one identical restaurant index", async () => {
  const database = new FakeSearchIndexDatabase({
    "restaurant_accounts/account-1": biteSaverRestaurant(),
  });
  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  await reconcileBiteSaverRestaurantIndex(
    database,
    "account-1",
    new Date(now.getTime() + 60_000),
  );
  const sets = database.operations.filter((entry) =>
    entry.operation === "set" && entry.path.startsWith("restaurant_search_index/"));
  assert.equal(sets.length, 1);
  assert.equal(database.records.size, 3);
  const generation = catalogGenerationPath({
    entityType: "restaurant",
    restaurantAccountId: "account-1",
  });
  assert.equal(database.records.get(generation.path).generation, 1);
  assert.ok(database.transactionAttempts.some((attempt) =>
    attempt.readPaths.includes(generation.path) && attempt.writeCount === 2));
});

test("update overwrites the same deterministic restaurant index", async () => {
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant({
      id: "embedded-conflict",
      streetAddress: "1 Main St",
    }),
  });
  await reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
  const indexId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: "restaurant-1",
  });
  const indexPath = `restaurant_search_index/${indexId}`;
  database.records.set(
    "bitescore_restaurants/restaurant-1",
    biteScoreRestaurant({
      id: "embedded-conflict",
      name: "Newer Current Name",
      streetAddress: "1 Main St",
      updatedAt: new Date(now.getTime() + 1),
    }),
  );
  await reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
  assert.equal(database.records.get(indexPath).displayName, "Newer Current Name");
  assert.equal(database.records.get(indexPath).sourceDocumentId, "restaurant-1");
  assert.equal(
    database.records.get(indexPath).customerPublicProjection.sourceDocumentId,
    "restaurant-1",
  );
  assert.equal(database.records.has(`restaurant_search_index/${indexId}`), true);
});

test("out-of-order parent events reread and preserve the current newer source", async () => {
  const current = biteScoreRestaurant({name: "Newest Authoritative Name"});
  const older = biteScoreRestaurant({name: "Older Event Name"});
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": current,
  });
  await handleBiteScoreRestaurantWrite(database, {
    restaurantId: "restaurant-1",
    before: biteScoreRestaurant({name: "Oldest Name"}),
    after: older,
    sourceEventId: "event-out-of-order",
    now,
  });
  const index = [...database.records.entries()]
    .find(([path]) => path.startsWith("restaurant_search_index/"))[1];
  assert.equal(index.displayName, "Newest Authoritative Name");
  const jobs = [...database.records.keys()].filter((path) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(jobs.length, 1);
});

test("update after delete cannot recreate and delete after recreation cannot win", async () => {
  const indexId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteSaverRestaurant",
    sourceDocumentId: "account-1",
  });
  const database = new FakeSearchIndexDatabase({
    "restaurant_accounts/account-1": biteSaverRestaurant(),
  });
  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  database.records.delete("restaurant_accounts/account-1");
  await handleBiteSaverRestaurantWrite(database, {
    restaurantAccountId: "account-1",
    before: biteSaverRestaurant(),
    after: biteSaverRestaurant({restaurantName: "stale update"}),
    sourceEventId: "event-after-delete",
    now,
  });
  assert.equal(database.records.has(`restaurant_search_index/${indexId}`), false);

  database.records.set(
    "restaurant_accounts/account-1",
    biteSaverRestaurant({restaurantName: "Recreated Current"}),
  );
  await handleBiteSaverRestaurantWrite(database, {
    restaurantAccountId: "account-1",
    before: biteSaverRestaurant(),
    after: null,
    sourceEventId: "event-delete-after-recreate",
    now,
  });
  assert.equal(
    database.records.get(`restaurant_search_index/${indexId}`).displayName,
    "Recreated Current",
  );
});

test("transaction fencing prevents stale restaurant writes, recreation, and reverse-order updates", async () => {
  const sourcePath = "bitescore_restaurants/restaurant-1";
  const indexId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: "restaurant-1",
  });
  const indexPath = `restaurant_search_index/${indexId}`;

  {
    const database = new FakeSearchIndexDatabase({
      [sourcePath]: biteScoreRestaurant({name: "Old Active", streetAddress: "1 Main St"}),
    });
    const barrier = pauseFirstTransactionCommit(database);
    const older = reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
    await barrier.ready;
    database.records.set(
      sourcePath,
      biteScoreRestaurant({name: "Now Inactive", streetAddress: "1 Main St", isActive: false}),
    );
    await reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
    barrier.release();
    await older;
    assert.equal(database.records.get(indexPath).displayName, "Now Inactive");
    assert.equal(database.records.get(indexPath).publicVisible, false);
    assert.equal(database.records.get(indexPath).customerPublicProjection, null);
  }

  {
    const database = new FakeSearchIndexDatabase({
      [sourcePath]: biteScoreRestaurant({name: "Old Update", streetAddress: "1 Main St"}),
    });
    const barrier = pauseFirstTransactionCommit(database);
    const older = reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
    await barrier.ready;
    database.records.delete(sourcePath);
    await reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
    barrier.release();
    await older;
    assert.equal(database.records.has(indexPath), false);
  }

  {
    const database = new FakeSearchIndexDatabase({
      [sourcePath]: biteScoreRestaurant({name: "First Update", streetAddress: "1 Main St"}),
    });
    const barrier = pauseFirstTransactionCommit(database);
    const first = reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
    await barrier.ready;
    database.records.set(
      sourcePath,
      biteScoreRestaurant({name: "Second Update", streetAddress: "1 Main St"}),
    );
    await reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
    barrier.release();
    await first;
    assert.equal(database.records.get(indexPath).displayName, "Second Update");
  }
});

test("dish transactions revalidate the dish, aggregate, and parent before commit", async () => {
  const restaurantPath = "bitescore_restaurants/restaurant-1";
  const dishPath = "bitescore_dishes/dish-1";
  const aggregatePath = "dish_rating_aggregates/dish-1";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const indexPath = `dish_search_index/${indexId}`;
  const database = new FakeSearchIndexDatabase({
    [restaurantPath]: biteScoreRestaurant(),
    [dishPath]: biteScoreDish("dish-1", {name: "Old Dish"}),
    [aggregatePath]: {dishId: "dish-1", restaurantId: "restaurant-1", overallBiteScore: 80},
  });
  const barrier = pauseFirstTransactionCommit(database);
  const older = reconcileBiteScoreDishIndex(database, "dish-1", now);
  await barrier.ready;
  database.records.set(restaurantPath, biteScoreRestaurant({isActive: false}));
  database.records.set(dishPath, biteScoreDish("dish-1", {name: "New Dish"}));
  database.records.set(
    aggregatePath,
    {dishId: "dish-1", restaurantId: "restaurant-1", overallBiteScore: 95},
  );
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  barrier.release();
  await older;
  const index = database.records.get(indexPath);
  assert.equal(index.displayName, "New Dish");
  assert.equal(index.overallBiteScore, 95);
  assert.equal(index.restaurantActive, false);
  assert.equal(index.customerPublicProjection, null);

  const deleteBarrier = pauseFirstTransactionCommit(database);
  const staleUpdate = reconcileBiteScoreDishIndex(database, "dish-1", now);
  await deleteBarrier.ready;
  database.records.delete(dishPath);
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  deleteBarrier.release();
  await staleUpdate;
  assert.equal(database.records.has(indexPath), false);
});

test("dish and aggregate reconciliation always joins current sources", async () => {
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant({name: "Current Parent"}),
    "bitescore_dishes/dish-1": biteScoreDish("dish-1"),
    "dish_rating_aggregates/dish-1": {
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      overallBiteScore: 8.5,
      ratingCount: 4,
    },
  });
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const path = `dish_search_index/${indexId}`;
  assert.equal(database.records.get(path).restaurantDisplayName, "Current Parent");
  assert.equal(database.records.get(path).overallBiteScore, 8.5);
  assert.equal(database.records.get(path).sourceDocumentId, "dish-1");
  assert.equal(
    database.records.get(path).customerPublicProjection.sourceDocumentId,
    "dish-1",
  );
  assert.equal(
    database.records.get(path).customerPublicProjection.restaurantSourceDocumentId,
    "restaurant-1",
  );

  database.records.delete("dish_rating_aggregates/dish-1");
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  assert.equal(database.records.get(path).overallBiteScore, 0);
  assert.equal(database.records.get(path).ratingCount, 0);

  database.records.delete("bitescore_dishes/dish-1");
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  assert.equal(database.records.has(path), false);
});

test("invalid exact dish parent IDs clear stale indexes without unsafe path reads", async () => {
  const dishPath = "bitescore_dishes/dish-1";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const indexPath = `dish_search_index/${indexId}`;
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    [dishPath]: biteScoreDish("dish-1"),
  });
  const invalidParentIds = [
    " restaurant-1 ",
    "restaurant/other",
    "",
    ".",
    "control\u0001",
    "format\u200b",
    "khmer\u17b4",
    "khmer\u17b5",
    "malformed\ud800",
    "x".repeat(1_501),
  ];
  for (const parentId of invalidParentIds) {
    database.records.set(dishPath, biteScoreDish("dish-1"));
    await reconcileBiteScoreDishIndex(database, "dish-1", now);
    assert.equal(database.records.has(indexPath), true);
    const operationStart = database.operations.length;
    database.records.set(dishPath, biteScoreDish("dish-1", {restaurantId: parentId}));
    await reconcileBiteScoreDishIndex(database, "dish-1", now);
    assert.equal(database.records.has(indexPath), false, JSON.stringify(parentId));
    const unsafeParentReads = database.operations.slice(operationStart)
      .filter((entry) => entry.operation === "get")
      .map((entry) => entry.path)
      .filter((path) => path.startsWith("bitescore_restaurants/"));
    assert.deepEqual(unsafeParentReads, [], JSON.stringify(parentId));
  }
});

test("same-fingerprint reconciliation replaces unknown nested customer keys", async () => {
  const sourcePath = "bitescore_restaurants/restaurant-1";
  const database = new FakeSearchIndexDatabase({
    [sourcePath]: biteScoreRestaurant({streetAddress: "1 Main St"}),
  });
  await reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
  const indexEntry = [...database.records.entries()].find(([path]) =>
    path.startsWith("restaurant_search_index/"));
  const [indexPath, index] = indexEntry;
  database.records.set(indexPath, {
    ...index,
    customerPublicProjection: {
      ...index.customerPublicProjection,
      stalePrivateNestedKey: "must-be-removed",
    },
  });
  await reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
  assert.equal(
    Object.hasOwn(
      database.records.get(indexPath).customerPublicProjection,
      "stalePrivateNestedKey",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(database.records.get(indexPath)).includes("must-be-removed"),
    false,
  );
});

test("oversized current category input removes an older valid customer payload and can recover", async () => {
  const dishPath = "bitescore_dishes/dish-1";
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    [dishPath]: biteScoreDish("dish-1"),
  });
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const indexPath = `dish_search_index/${indexId}`;
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  assert.notEqual(database.records.get(indexPath).customerPublicProjection, null);
  database.records.set(
    dishPath,
    biteScoreDish("dish-1", {categoryManualKeywords: "x".repeat(4_097)}),
  );
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  assert.equal(database.records.get(indexPath).customerPublicProjection, null);
  assert.equal(database.records.get(indexPath).adminVisible, true);
  database.records.set(dishPath, biteScoreDish("dish-1", {category: "Recovered"}));
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  assert.equal(database.records.get(indexPath).customerPublicProjection.category, "Recovered");
});

test("malformed category sources remove a stale customer payload and corrected source recreates it", async () => {
  const dishId = "dish-malformed-category-recovery";
  const dishPath = `bitescore_dishes/${dishId}`;
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  const indexPath = `dish_search_index/${indexId}`;
  const validCategory = {
    category: "Dinner",
    categoryManualKeywords: "supper,evening",
    categoryTags: ["Featured", "Seasonal"],
  };
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    [dishPath]: biteScoreDish(dishId, validCategory),
  });

  await reconcileBiteScoreDishIndex(database, dishId, now);
  const current = database.records.get(indexPath);
  assert.notEqual(current.customerPublicProjection, null);
  database.records.set(indexPath, {
    ...current,
    customerPublicProjection: {
      ...current.customerPublicProjection,
      staleCustomerCanary: "must-be-removed",
    },
  });
  database.records.set(dishPath, biteScoreDish(dishId, {
    category: "malformed\ud800",
    categoryManualKeywords: ["safe", "malformed\udc00"],
    categoryTags: ["safe", "malformed\ud800"],
  }));

  await reconcileBiteScoreDishIndex(database, dishId, now);
  const malformed = database.records.get(indexPath);
  assert.equal(malformed.customerPublicProjection, null);
  assert.equal(malformed.adminVisible, true);
  assert.equal(JSON.stringify(malformed).includes("must-be-removed"), false);

  const correctedCategory = {
    category: "Recovered Dinner",
    categoryManualKeywords: "supper,recovered",
    categoryTags: ["Featured", "Recovered"],
  };
  database.records.set(
    dishPath,
    biteScoreDish(dishId, correctedCategory),
  );
  await reconcileBiteScoreDishIndex(database, dishId, now);
  const recovered = database.records.get(indexPath).customerPublicProjection;
  assert.notEqual(recovered, null);
  assert.equal(recovered.category, correctedCategory.category);
  assert.equal(
    recovered.categoryManualKeywords,
    correctedCategory.categoryManualKeywords,
  );
  assert.deepEqual(recovered.categoryTags, correctedCategory.categoryTags);
});

test("malformed restaurant cuisine tags remove a stale customer payload and corrected source recreates it", async () => {
  const restaurantId = "restaurant-malformed-cuisine-recovery";
  const restaurantPath = `bitescore_restaurants/${restaurantId}`;
  const indexId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: restaurantId,
  });
  const indexPath = `restaurant_search_index/${indexId}`;
  const validCuisineTags = ["Café", "ភោជនីយដ្ឋាន", "Sushi 🍣"];
  const database = new FakeSearchIndexDatabase({
    [restaurantPath]: biteScoreRestaurant({
      streetAddress: "1 Main St",
      cuisineTags: validCuisineTags,
    }),
  });

  await reconcileBiteScoreRestaurantIndex(database, restaurantId, now);
  const current = database.records.get(indexPath);
  assert.deepEqual(
    current.customerPublicProjection.cuisineTags,
    validCuisineTags,
  );
  database.records.set(indexPath, {
    ...current,
    customerPublicProjection: {
      ...current.customerPublicProjection,
      staleCustomerCanary: "must-be-removed",
    },
  });
  database.records.set(
    restaurantPath,
    biteScoreRestaurant({
      streetAddress: "1 Main St",
      cuisineTags: ["safe-before", "broken\ud800tag", "safe-after"],
    }),
  );

  await reconcileBiteScoreRestaurantIndex(database, restaurantId, now);
  const malformed = database.records.get(indexPath);
  assert.equal(malformed.customerPublicProjection, null);
  assert.equal(malformed.adminDirectoryVisible, true);
  assert.equal(malformed.publicVisible, true);
  assert.equal(JSON.stringify(malformed).includes("must-be-removed"), false);
  assert.equal(JSON.stringify(malformed).includes("safe-before"), false);
  assert.equal(JSON.stringify(malformed).includes("safe-after"), false);

  const correctedCuisineTags = ["Café", "ខ្មែរ", "Recovered 🍜"];
  database.records.set(
    restaurantPath,
    biteScoreRestaurant({
      streetAddress: "1 Main St",
      cuisineTags: correctedCuisineTags,
    }),
  );
  await reconcileBiteScoreRestaurantIndex(database, restaurantId, now);
  const recovered = database.records.get(indexPath).customerPublicProjection;
  assert.notEqual(recovered, null);
  assert.deepEqual(recovered.cuisineTags, correctedCuisineTags);
  assert.ok(recovered.categoryTokens.length > 0);
});

test("real 64 KiB dish reconciliation removes an older payload on overflow and recovers", async () => {
  const supplementaryLetter = (offset) =>
    String.fromCodePoint(0x10400 + offset);
  const highByteName = (offset) => [
    supplementaryLetter(offset).repeat(32),
    supplementaryLetter(offset + 1).repeat(32),
    supplementaryLetter(offset + 2).repeat(32),
  ].join(" ");
  const restaurantId = "restaurant-size";
  const dishId = "dish-size";
  const restaurantPath = `bitescore_restaurants/${restaurantId}`;
  const dishPath = `bitescore_dishes/${dishId}`;
  const aggregatePath = `dish_rating_aggregates/${dishId}`;
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  const indexPath = `dish_search_index/${indexId}`;
  const restaurant = {
    name: highByteName(0),
    streetAddress: "A".repeat(200),
    city: "Ocala",
    state: "FL",
    zipCode: "34470",
    location: new GeoPoint(coordinates.latitude, coordinates.longitude),
    geohash,
    isActive: true,
    isClaimed: false,
  };
  const dishAtPrimaryImageIdLength = (length) => ({
    id: dishId,
    restaurantId,
    name: highByteName(4),
    categoryTags: Array.from({length: 14}, (_, index) =>
      supplementaryLetter(10 + index).repeat(100)),
    isActive: true,
    primaryImageId: "i".repeat(length),
    primaryImageUrl:
      `https://e.test/${supplementaryLetter(50).repeat(1_979)}`,
  });
  const database = new FakeSearchIndexDatabase({
    [restaurantPath]: restaurant,
    [dishPath]: dishAtPrimaryImageIdLength(1_459),
    [aggregatePath]: {
      dishId,
      restaurantId,
      overallBiteScore: 100,
      ratingCount: 1,
    },
  });

  await reconcileBiteScoreDishIndex(database, dishId, now);
  const exactBoundary = database.records.get(indexPath);
  assert.equal(
    serializedSearchIndexDocumentBytes(exactBoundary),
    maximumSearchIndexDocumentBytes,
  );
  assert.notEqual(exactBoundary.customerPublicProjection, null);
  database.records.set(indexPath, {
    ...exactBoundary,
    customerPublicProjection: {
      ...exactBoundary.customerPublicProjection,
      staleBoundaryCanary: true,
    },
  });

  database.records.set(dishPath, dishAtPrimaryImageIdLength(1_460));
  await reconcileBiteScoreDishIndex(database, dishId, now);
  const oversized = database.records.get(indexPath);
  assert.equal(oversized.customerPublicProjection, null);
  assert.equal(oversized.primaryImageId.length, 1_460);
  assert.equal(JSON.stringify(oversized).includes("staleBoundaryCanary"), false);
  assert.ok(
    serializedSearchIndexDocumentBytes(oversized) <=
      maximumSearchIndexDocumentBytes,
  );

  database.records.set(dishPath, dishAtPrimaryImageIdLength(1_459));
  await reconcileBiteScoreDishIndex(database, dishId, now);
  const corrected = database.records.get(indexPath);
  assert.equal(
    serializedSearchIndexDocumentBytes(corrected),
    maximumSearchIndexDocumentBytes,
  );
  assert.notEqual(corrected.customerPublicProjection, null);
  assert.equal(corrected.primaryImageId.length, 1_459);
});

test("offer direct write and source delete reconcile one deterministic index", async () => {
  const database = new FakeSearchIndexDatabase({
    "restaurant_accounts/account-1": biteSaverRestaurant({restaurantName: "Current Parent"}),
    "restaurant_accounts/account-1/coupons/coupon-1": coupon("coupon-1"),
  });
  await reconcileBiteSaverCouponOfferIndex(database, "account-1", "coupon-1", now);
  const indexId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: "account-1",
    sourceDocumentId: "coupon-1",
  });
  const path = `bitesaver_offer_index/${indexId}`;
  assert.equal(database.records.get(path).restaurantDisplayName, "Current Parent");
  database.records.delete("restaurant_accounts/account-1/coupons/coupon-1");
  await reconcileBiteSaverCouponOfferIndex(database, "account-1", "coupon-1", now);
  assert.equal(database.records.has(path), false);
});

test("maximum-byte offer parent identity survives indexing and cleanup queries", async () => {
  const restaurantAccountId = "\u{1f4be}".repeat(374) + "\u00e9\u00e9";
  const couponId = "maximum-parent-coupon";
  const parentPath = `restaurant_accounts/${restaurantAccountId}`;
  const childPath = `${parentPath}/coupons/${couponId}`;
  assert.equal(Buffer.byteLength(restaurantAccountId, "utf8"), 1_500);
  const parent = biteSaverRestaurant({restaurantName: "Maximum Parent"});
  const database = new FakeSearchIndexDatabase({
    [parentPath]: parent,
    [childPath]: coupon(couponId),
  });
  await reconcileBiteSaverCouponOfferIndex(
    database,
    restaurantAccountId,
    couponId,
    now,
  );
  const indexId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: restaurantAccountId,
    sourceDocumentId: couponId,
  });
  const indexPath = `bitesaver_offer_index/${indexId}`;
  const indexed = database.records.get(indexPath);
  assert.equal(indexed.restaurantAccountId instanceof Uint8Array, true);
  assert.equal(indexed.restaurantAccountId.byteLength, 1_500);
  assert.equal(
    decodeDartUtf16FirestoreBytesOrderKey(
      indexed.restaurantAccountId,
      1_500,
    ),
    restaurantAccountId,
  );

  database.records.delete(parentPath);
  const sourceEventId = "maximum-parent-delete-event";
  await handleBiteSaverRestaurantWrite(database, {
    restaurantAccountId,
    before: parent,
    after: null,
    sourceEventId,
    now,
  });
  const jobId = createSearchIndexJobId({
    jobKind: "biteSaverOffers",
    parentSource: "biteSaver",
    parentSourceDocumentId: restaurantAccountId,
    requestedSourceFingerprint: biteSaverOfferParentFingerprint(null),
    sourceOccurrenceId: createSearchIndexSourceOccurrenceId(sourceEventId),
    continuationCursor: null,
  });
  assert.deepEqual(
    await processSearchIndexJob(database, jobId, now),
    {processedCount: 1, continuationCursor: null},
  );
  assert.equal(database.records.has(indexPath), false);
});

test("offer trigger commits projection, generation, and parent catalog marker together", async () => {
  const restaurantAccountId = "account-atomic";
  const couponId = "coupon-atomic";
  const parentPath = `restaurant_accounts/${restaurantAccountId}`;
  const childPath = `${parentPath}/coupons/${couponId}`;
  const indexPath = `bitesaver_offer_index/${createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: restaurantAccountId,
    sourceDocumentId: couponId,
  })}`;
  const generation = catalogGenerationPath({
    entityType: "offer",
    offerType: "coupon",
    restaurantAccountId,
    sourceDocumentId: couponId,
  });
  const database = new FakeSearchIndexDatabase({
    [parentPath]: biteSaverRestaurant(),
    [childPath]: coupon(couponId, {
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    }),
  });

  await handleBiteSaverCouponOfferWrite(database, {
    restaurantAccountId,
    couponId,
    now,
  });

  assert.equal(database.transactionAttempts.length, 1);
  assert.deepEqual(
    database.transactionAttempts[0].writes.map((write) => ({
      operation: write.operation,
      path: write.path,
      ...(write.field === undefined ? {} : {field: write.field}),
    })),
    [
      {operation: "set", path: indexPath},
      {operation: "set", path: generation.path},
      {
        operation: "serverTimestamp",
        path: parentPath,
        field: biteSaverOfferCatalogUpdatedAtField,
      },
    ],
  );
  assert.equal(database.transactionAttempts[0].writeCount, 3);
  assert.equal(database.records.has(indexPath), true);
  assert.equal(database.records.get(generation.path).generation, 1);
  assert.ok(
    database.records.get(parentPath)[biteSaverOfferCatalogUpdatedAtField] instanceof Date,
  );
  assert.equal(
    database.operations.filter((entry) => entry.operation === "serverTimestamp").length,
    1,
  );
});

test("unrelated private offer writes do not advance generation or parent marker", async () => {
  const restaurantAccountId = "account-unrelated-offer";
  const couponId = "coupon-unrelated-offer";
  const parentPath = `restaurant_accounts/${restaurantAccountId}`;
  const childPath = `${parentPath}/coupons/${couponId}`;
  const generation = catalogGenerationPath({
    entityType: "offer",
    offerType: "coupon",
    restaurantAccountId,
    sourceDocumentId: couponId,
  });
  const initialCoupon = coupon(couponId, {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  const database = new FakeSearchIndexDatabase({
    [parentPath]: biteSaverRestaurant(),
    [childPath]: initialCoupon,
  });

  await handleBiteSaverCouponOfferWrite(database, {
    restaurantAccountId,
    couponId,
    now,
  });
  const initialMarker =
    database.records.get(parentPath)[biteSaverOfferCatalogUpdatedAtField];
  assert.ok(initialMarker instanceof Date);
  assert.equal(database.records.get(generation.path).generation, 1);

  database.records.set(childPath, {
    ...initialCoupon,
    moderationNotes: "unrelated private canary",
  });
  database.operations.length = 0;
  await handleBiteSaverCouponOfferWrite(database, {
    restaurantAccountId,
    couponId,
    now: new Date(now.getTime() + 1_000),
  });

  assert.equal(
    database.records.get(parentPath)[biteSaverOfferCatalogUpdatedAtField]
      .getTime(),
    initialMarker.getTime(),
  );
  assert.equal(database.records.get(generation.path).generation, 1);
  assert.equal(
    database.operations.some((entry) => entry.operation === "serverTimestamp"),
    false,
  );

  database.records.set(childPath, {
    ...initialCoupon,
    title: "Customer-visible title change",
  });
  database.operations.length = 0;
  await handleBiteSaverCouponOfferWrite(database, {
    restaurantAccountId,
    couponId,
    now: new Date(now.getTime() + 2_000),
  });
  assert.equal(database.records.get(generation.path).generation, 2);
  assert.ok(
    database.records.get(parentPath)[biteSaverOfferCatalogUpdatedAtField] >
      initialMarker,
  );
  assert.equal(
    database.operations.filter((entry) => entry.operation === "serverTimestamp")
      .length,
    1,
  );
});

test("eligible offer projection mutations bump one deterministic shard exactly once", async () => {
  const identity = {
    entityType: "offer",
    offerType: "coupon",
    restaurantAccountId: "account-1",
    sourceDocumentId: "coupon-generation",
  };
  const generation = catalogGenerationPath(identity);
  const sourcePath =
    "restaurant_accounts/account-1/coupons/coupon-generation";
  const database = new FakeSearchIndexDatabase({
    "restaurant_accounts/account-1": biteSaverRestaurant(),
    [sourcePath]: coupon("coupon-generation", {
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    }),
  });

  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-generation",
    now,
  );
  assert.deepEqual(database.records.get(generation.path), {
    protocolVersion: "bitestar.customer-bitesaver-search.v1",
    shardIndex: generation.index,
    generation: 1,
    updatedAt: now,
  });

  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-generation",
    now,
  );
  assert.equal(database.records.get(generation.path).generation, 1);

  database.records.set(sourcePath, coupon("coupon-generation", {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    moderationNotes: "unrelated private edit",
  }));
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-generation",
    now,
  );
  assert.equal(database.records.get(generation.path).generation, 1);

  database.records.set(sourcePath, coupon("coupon-generation", {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    title: "Customer-visible change",
  }));
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-generation",
    now,
  );
  assert.equal(database.records.get(generation.path).generation, 2);

  database.records.delete(sourcePath);
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-generation",
    now,
  );
  assert.equal(database.records.get(generation.path).generation, 3);
});

test("time changes do not bump generation and repaired v2 sources re-enter it", async () => {
  const identity = {
    entityType: "offer",
    offerType: "coupon",
    restaurantAccountId: "account-1",
    sourceDocumentId: "coupon-time",
  };
  const generation = catalogGenerationPath(identity);
  const sourcePath = "restaurant_accounts/account-1/coupons/coupon-time";
  const source = coupon("coupon-time", {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    endTime: new Date(now.getTime() + 1),
  });
  const database = new FakeSearchIndexDatabase({
    "restaurant_accounts/account-1": biteSaverRestaurant(),
    [sourcePath]: source,
  });
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-time",
    now,
  );
  assert.equal(database.records.get(generation.path).generation, 1);
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-time",
    new Date(now.getTime() + 2),
  );
  assert.equal(database.records.get(generation.path).generation, 1);

  const ineligibleIdentity = {...identity, sourceDocumentId: "coupon-ineligible"};
  const ineligibleGeneration = catalogGenerationPath(ineligibleIdentity);
  const ineligibleSourcePath =
    "restaurant_accounts/account-1/coupons/coupon-ineligible";
  const ineligibleIndexPath = `bitesaver_offer_index/${createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: "account-1",
    sourceDocumentId: "coupon-ineligible",
  })}`;
  database.records.set(
    ineligibleSourcePath,
    coupon("coupon-ineligible", {createdAt: null}),
  );
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-ineligible",
    now,
  );
  assert.equal(database.records.has(ineligibleGeneration.path), false);
  assert.equal(
    database.records.get(ineligibleIndexPath).customerDiscoverable,
    false,
  );
  assert.equal(
    Object.hasOwn(
      database.records.get(ineligibleIndexPath),
      "catalogGenerationContribution",
    ),
    false,
  );

  database.records.set(ineligibleSourcePath, coupon("coupon-ineligible", {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  }));
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-ineligible",
    now,
  );
  assert.equal(database.records.get(ineligibleGeneration.path).generation, 1);
  assert.equal(
    database.records.get(ineligibleIndexPath).customerDiscoverable,
    true,
  );

  database.records.set(ineligibleSourcePath, coupon("coupon-ineligible", {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    isActive: false,
  }));
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-ineligible",
    now,
  );
  assert.equal(database.records.get(ineligibleGeneration.path).generation, 2);
  assert.equal(
    database.records.get(ineligibleIndexPath).customerDiscoverable,
    false,
  );

  database.records.set(ineligibleSourcePath, coupon("coupon-ineligible", {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  }));
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-ineligible",
    now,
  );
  assert.equal(database.records.get(ineligibleGeneration.path).generation, 3);
  assert.equal(
    database.records.get(ineligibleIndexPath).customerDiscoverable,
    true,
  );
});

test("restaurant customer projection changes bump but catalog timestamps do not", async () => {
  const identity = {
    entityType: "restaurant",
    restaurantAccountId: "account-1",
  };
  const generation = catalogGenerationPath(identity);
  const parentPath = "restaurant_accounts/account-1";
  const database = new FakeSearchIndexDatabase({
    [parentPath]: biteSaverRestaurant({bio: "Original bio"}),
  });
  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  assert.equal(database.records.get(generation.path).generation, 1);

  database.records.set(parentPath, biteSaverRestaurant({
    bio: "Original bio",
    offerCatalogUpdatedAt: new Date(now.getTime() + 1),
  }));
  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  assert.equal(database.records.get(generation.path).generation, 1);

  database.records.set(parentPath, biteSaverRestaurant({bio: "Changed bio"}));
  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  assert.equal(database.records.get(generation.path).generation, 2);

  database.records.set(parentPath, biteSaverRestaurant({
    bio: "Changed bio",
    approvalStatus: "pending",
  }));
  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  assert.equal(database.records.get(generation.path).generation, 3);
  database.records.set(parentPath, biteSaverRestaurant({
    bio: "Invisible edit",
    approvalStatus: "pending",
  }));
  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  assert.equal(database.records.get(generation.path).generation, 3);
});

test("concurrent eligible mutations sharing one generation shard cannot lose a bump", async () => {
  const firstId = "coupon-concurrent-0";
  const firstIdentity = {
    entityType: "offer",
    offerType: "coupon",
    restaurantAccountId: "account-1",
    sourceDocumentId: firstId,
  };
  const firstShard = catalogGenerationPath(firstIdentity);
  let secondId = null;
  for (let index = 1; index < 1_000; index += 1) {
    const candidate = `coupon-concurrent-${index}`;
    if (catalogGenerationPath({...firstIdentity, sourceDocumentId: candidate}).index === firstShard.index) {
      secondId = candidate;
      break;
    }
  }
  assert.notEqual(secondId, null);
  const createdAt = new Date("2026-08-01T00:00:00.000Z");
  const database = new FakeSearchIndexDatabase({
    "restaurant_accounts/account-1": biteSaverRestaurant(),
    [`restaurant_accounts/account-1/coupons/${firstId}`]: coupon(firstId, {createdAt}),
    [`restaurant_accounts/account-1/coupons/${secondId}`]: coupon(secondId, {createdAt}),
  });
  const barrier = pauseFirstTransactionCommit(database);
  const firstWrite = reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    firstId,
    now,
  );
  await barrier.ready;
  const secondWrite = reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    secondId,
    now,
  );
  await secondWrite;
  barrier.release();
  await firstWrite;

  assert.equal(database.records.get(firstShard.path).generation, 2);
  assert.ok(database.transactionAttempts.some((attempt) =>
    attempt.readPaths.includes(firstShard.path) && attempt.writeCount === 2));
});

test("invalid BiteSaver child identities cannot redirect catalog updates", async () => {
  const accountPath = "restaurant_accounts/account-1";
  const database = new FakeSearchIndexDatabase({
    [accountPath]: biteSaverRestaurant(),
  });
  await handleBiteSaverCouponOfferWrite(database, {
    restaurantAccountId: " account-1 ",
    couponId: "coupon-1",
    now,
  });
  await handleBiteSaverDailySpecialOfferWrite(database, {
    restaurantAccountId: "account-1",
    dailySpecialId: "special/1",
    now,
  });
  assert.deepEqual(database.operations, []);
  assert.equal(
    Object.hasOwn(database.records.get(accountPath), biteSaverOfferCatalogUpdatedAtField),
    false,
  );
});

test("coupon and daily-special create, update, and delete advance the public catalog signal", async () => {
  const offerKinds = [
    {
      childCollection: "coupons",
      sourceKind: "biteSaverCoupon",
      sourceDocumentId: "coupon-1",
      source: (title) => coupon("coupon-1", {
        title,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
      handle: (database) => handleBiteSaverCouponOfferWrite(database, {
        restaurantAccountId: "account-1",
        couponId: "coupon-1",
        now,
      }),
    },
    {
      childCollection: "daily_specials",
      sourceKind: "biteSaverDailySpecial",
      sourceDocumentId: "special-1",
      source: (title) => dailySpecial("special-1", {
        title,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
      handle: (database) => handleBiteSaverDailySpecialOfferWrite(database, {
        restaurantAccountId: "account-1",
        dailySpecialId: "special-1",
        now,
      }),
    },
  ];

  for (const offerKind of offerKinds) {
    for (const mutation of ["create", "update", "delete"]) {
      const accountPath = "restaurant_accounts/account-1";
      const childPath = `${accountPath}/${offerKind.childCollection}/${offerKind.sourceDocumentId}`;
      const database = new FakeSearchIndexDatabase({
        [accountPath]: biteSaverRestaurant(),
      });
      await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
      const restaurantIndexId = createSearchIndexDocumentId({
        entityKind: "restaurant",
        sourceKind: "biteSaverRestaurant",
        sourceDocumentId: "account-1",
      });
      const restaurantIndexPath = `restaurant_search_index/${restaurantIndexId}`;
      const originalFingerprint =
        database.records.get(restaurantIndexPath).sourceFingerprint;
      const offerIndexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: offerKind.sourceKind,
        parentSourceDocumentId: "account-1",
        sourceDocumentId: offerKind.sourceDocumentId,
      });
      const offerIndexPath = `bitesaver_offer_index/${offerIndexId}`;

      if (mutation !== "create") {
        database.records.set(childPath, offerKind.source("Before"));
        await offerKind.handle(database);
        database.operations.length = 0;
      }
      if (mutation === "delete") {
        database.records.delete(childPath);
      } else {
        database.records.set(childPath, offerKind.source("After"));
      }

      await offerKind.handle(database);
      const offerCatalogUpdatedAt =
        database.records.get(accountPath)[biteSaverOfferCatalogUpdatedAtField];
      assert.ok(offerCatalogUpdatedAt instanceof Date, `${offerKind.sourceKind} ${mutation}`);
      assert.equal(
        database.operations.filter((entry) => entry.operation === "serverTimestamp").length,
        1,
        `${offerKind.sourceKind} ${mutation}`,
      );
      assert.equal(
        database.operations.some((entry) => entry.operation === "query"),
        false,
        `${offerKind.sourceKind} ${mutation}`,
      );
      assert.equal(
        database.records.has(offerIndexPath),
        mutation !== "delete",
        `${offerKind.sourceKind} ${mutation}`,
      );

      await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
      const projection = database.records.get(restaurantIndexPath);
      assert.equal(
        projection[biteSaverOfferCatalogUpdatedAtField].getTime(),
        offerCatalogUpdatedAt.getTime(),
        `${offerKind.sourceKind} ${mutation}`,
      );
      assert.notEqual(
        projection.sourceFingerprint,
        originalFingerprint,
        `${offerKind.sourceKind} ${mutation}`,
      );
    }
  }
});

test("duplicate offer trigger delivery leaves the catalog marker unchanged", async () => {
  const accountPath = "restaurant_accounts/account-1";
  const database = new FakeSearchIndexDatabase({
    [accountPath]: biteSaverRestaurant(),
    [`${accountPath}/coupons/coupon-1`]: coupon("coupon-1", {
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    }),
  });

  await handleBiteSaverCouponOfferWrite(database, {
    restaurantAccountId: "account-1",
    couponId: "coupon-1",
    now,
  });
  const first = database.records.get(accountPath)[biteSaverOfferCatalogUpdatedAtField];
  await handleBiteSaverCouponOfferWrite(database, {
    restaurantAccountId: "account-1",
    couponId: "coupon-1",
    now,
  });
  const second = database.records.get(accountPath)[biteSaverOfferCatalogUpdatedAtField];

  assert.ok(first instanceof Date);
  assert.ok(second instanceof Date);
  assert.equal(second.getTime(), first.getTime());
  assert.equal(
    database.operations.filter((entry) => entry.operation === "serverTimestamp").length,
    1,
  );
  assert.equal(
    database.operations.some((entry) => entry.operation === "query"),
    false,
  );
  assert.equal(
    [...database.records.keys()].some((path) =>
      path.startsWith("private_search_index_jobs/")),
    false,
  );

  const missingParentDatabase = new FakeSearchIndexDatabase();
  await handleBiteSaverCouponOfferWrite(missingParentDatabase, {
    restaurantAccountId: "missing-account",
    couponId: "coupon-1",
    now,
  });
  assert.equal(
    missingParentDatabase.records.has("restaurant_accounts/missing-account"),
    false,
  );
});

test("every effective BiteSaver parent transition reconciles both offer kinds end to end", async (t) => {
  const fallbackImageOne = "https://images.example.test/fallback-one.jpg";
  const fallbackImageTwo = "https://images.example.test/fallback-two.jpg";
  const canonicalImage = "https://images.example.test/canonical.jpg";
  const movedCoordinates = {latitude: 27.9506, longitude: -82.4572};
  const movedGeohash = canonicalRestaurantGeohash(movedCoordinates);
  const fallbackImageParent = (imageUrl, overrides = {}) =>
    withoutProperties(
      biteSaverRestaurant({imageUrl, ...overrides}),
      "mainImageUrl",
    );
  const noImageParent = (overrides = {}) =>
    withoutProperties(
      biteSaverRestaurant(overrides),
      "mainImageUrl",
      "imageUrl",
    );
  const absentZipParent = (postalCode, overrides = {}) =>
    withoutProperties(
      biteSaverRestaurant({postalCode, ...overrides}),
      "zipCode",
    );

  const scenarios = [
    {
      name: "safe effective name change",
      before: biteSaverRestaurant({restaurantName: "Before Bistro"}),
      after: biteSaverRestaurant({restaurantName: "After Bistro"}),
    },
    {
      name: "unsafe higher-priority name makes the safe name alias effective",
      before: biteSaverRestaurant({
        restaurantName: "Canonical Bistro",
        name: "Fallback Bistro",
      }),
      after: biteSaverRestaurant({
        restaurantName: "unsafe\ud800name",
        name: "Fallback Bistro",
      }),
    },
    {
      name: "effective name alias changes",
      before: biteSaverRestaurant({
        restaurantName: "unsafe\u200bname",
        name: "Fallback One",
      }),
      after: biteSaverRestaurant({
        restaurantName: "unsafe\u200bname",
        name: "Fallback Two",
      }),
    },
    {
      name: "canonical name restoration changes the effective name",
      before: biteSaverRestaurant({
        restaurantName: "unsafe\u202ename",
        name: "Fallback Bistro",
      }),
      after: biteSaverRestaurant({
        restaurantName: "Restored Bistro",
        name: "Fallback Bistro",
      }),
    },
    {
      name: "effective imageUrl fallback changes",
      before: fallbackImageParent(fallbackImageOne),
      after: fallbackImageParent(fallbackImageTwo),
    },
    {
      name: "canonical mainImageUrl is added over the fallback",
      before: fallbackImageParent(fallbackImageOne),
      after: biteSaverRestaurant({
        mainImageUrl: canonicalImage,
        imageUrl: fallbackImageOne,
      }),
    },
    {
      name: "canonical mainImageUrl removal makes the fallback effective",
      before: biteSaverRestaurant({
        mainImageUrl: canonicalImage,
        imageUrl: fallbackImageOne,
      }),
      after: fallbackImageParent(fallbackImageOne),
    },
    {
      name: "effective fallback image is removed",
      before: fallbackImageParent(fallbackImageOne),
      after: noImageParent(),
    },
    {
      name: "unsafe authoritative image removes the selected image",
      before: biteSaverRestaurant({
        mainImageUrl: canonicalImage,
        imageUrl: fallbackImageOne,
      }),
      after: biteSaverRestaurant({
        mainImageUrl: "https://ｅxample.test/unsafe.jpg",
        imageUrl: fallbackImageOne,
      }),
    },
    {
      name: "ordinary valid zipCode changes",
      before: biteSaverRestaurant({zipCode: "34428"}),
      after: biteSaverRestaurant({zipCode: "34429"}),
    },
    {
      name: "absent zipCode follows a changing postalCode fallback",
      before: absentZipParent("34470"),
      after: absentZipParent("33602"),
    },
    {
      name: "null zipCode follows a changing postalCode fallback",
      before: biteSaverRestaurant({zipCode: null, postalCode: "34470"}),
      after: biteSaverRestaurant({zipCode: null, postalCode: "33602"}),
    },
    {
      name: "raw-malformed primary ZIP follows a valid fallback",
      before: biteSaverRestaurant({
        zipCode: "34\tBAD",
        postalCode: "34470",
      }),
      after: biteSaverRestaurant({
        zipCode: "34\tBAD",
        postalCode: "33602",
      }),
    },
    {
      name: "syntactically invalid primary ZIP changes to raw-invalid fallback",
      before: biteSaverRestaurant({
        zipCode: "34BAD",
        postalCode: "34470",
      }),
      after: biteSaverRestaurant({
        zipCode: "34\tBAD",
        postalCode: "34470",
      }),
    },
    {
      name: "effective city and state change",
      before: biteSaverRestaurant({city: "Crystal River", state: "FL"}),
      after: biteSaverRestaurant({city: "Savannah", state: "GA"}),
    },
    {
      name: "valid coordinates and geohash move together",
      before: biteSaverRestaurant(),
      after: biteSaverRestaurant({
        latitude: movedCoordinates.latitude,
        longitude: movedCoordinates.longitude,
        geohash: movedGeohash,
      }),
    },
    {
      name: "valid geography becomes invalid",
      before: biteSaverRestaurant(),
      after: biteSaverRestaurant({latitude: 999}),
    },
    {
      name: "invalid geography becomes valid",
      before: biteSaverRestaurant({latitude: 999}),
      after: biteSaverRestaurant(),
    },
    {
      name: "trusted posting eligibility becomes ineligible",
      before: biteSaverRestaurant({couponPostingEnabled: true}),
      after: biteSaverRestaurant({couponPostingEnabled: false}),
    },
    {
      name: "approved eligibility becomes ineligible",
      before: biteSaverRestaurant({approvalStatus: "approved"}),
      after: biteSaverRestaurant({approvalStatus: "pending"}),
    },
    {
      name: "Admin-visible eligibility becomes hidden",
      before: biteSaverRestaurant({adminHidden: false}),
      after: biteSaverRestaurant({adminHidden: true}),
    },
    {
      name: "ineligible parent becomes eligible",
      before: biteSaverRestaurant({couponPostingEnabled: false}),
      after: biteSaverRestaurant({couponPostingEnabled: true}),
    },
    {
      name: "parent deletion removes both effective offer indexes",
      before: biteSaverRestaurant(),
      after: null,
    },
    {
      name: "parent recreation restores both effective offer indexes",
      before: null,
      after: biteSaverRestaurant({restaurantName: "Recreated Bistro"}),
    },
  ];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    await t.test(scenario.name, async () => {
      const accountId = `account-effective-parent-${scenarioIndex}`;
      const accountPath = `restaurant_accounts/${accountId}`;
      const couponId = `coupon-effective-${scenarioIndex}`;
      const specialId = `special-effective-${scenarioIndex}`;
      const couponPath = `${accountPath}/coupons/${couponId}`;
      const specialPath = `${accountPath}/daily_specials/${specialId}`;
      const couponSource = coupon(couponId);
      const specialSource = dailySpecial(specialId, {
        restaurantId: accountId,
        ownerUid: accountId,
      });
      const couponIndexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: "biteSaverCoupon",
        parentSourceDocumentId: accountId,
        sourceDocumentId: couponId,
      });
      const specialIndexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: "biteSaverDailySpecial",
        parentSourceDocumentId: accountId,
        sourceDocumentId: specialId,
      });
      const couponIndexPath = `bitesaver_offer_index/${couponIndexId}`;
      const specialIndexPath = `bitesaver_offer_index/${specialIndexId}`;

      const unrelatedAccountId = `unrelated-account-${scenarioIndex}`;
      const unrelatedCouponId = `unrelated-coupon-${scenarioIndex}`;
      const unrelatedParent = biteSaverRestaurant({
        restaurantName: "Unrelated Restaurant",
      });
      const unrelatedCoupon = coupon(unrelatedCouponId);
      const unrelatedIndex = buildBiteSaverCouponOfferIndex({
        restaurantAccountId: unrelatedAccountId,
        sourceDocumentId: unrelatedCouponId,
        offer: unrelatedCoupon,
        restaurant: unrelatedParent,
        now,
      });
      assert.notEqual(unrelatedIndex, null);
      const unrelatedIndexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: "biteSaverCoupon",
        parentSourceDocumentId: unrelatedAccountId,
        sourceDocumentId: unrelatedCouponId,
      });
      const unrelatedIndexPath = `bitesaver_offer_index/${unrelatedIndexId}`;

      const initial = {
        [couponPath]: couponSource,
        [specialPath]: specialSource,
        [`restaurant_accounts/${unrelatedAccountId}`]: unrelatedParent,
        [`restaurant_accounts/${unrelatedAccountId}/coupons/${unrelatedCouponId}`]:
          unrelatedCoupon,
        [unrelatedIndexPath]: unrelatedIndex,
      };
      if (scenario.before !== null) {
        initial[accountPath] = scenario.before;
      }
      const database = new FakeSearchIndexDatabase(initial);

      const expectedBeforeCoupon = buildBiteSaverCouponOfferIndex({
        restaurantAccountId: accountId,
        sourceDocumentId: couponId,
        offer: couponSource,
        restaurant: scenario.before,
        now,
      });
      const expectedBeforeSpecial = buildBiteSaverDailySpecialOfferIndex({
        restaurantAccountId: accountId,
        sourceDocumentId: specialId,
        offer: specialSource,
        restaurant: scenario.before,
        now,
      });
      const expectedAfterCoupon = buildBiteSaverCouponOfferIndex({
        restaurantAccountId: accountId,
        sourceDocumentId: couponId,
        offer: couponSource,
        restaurant: scenario.after,
        now,
      });
      const expectedAfterSpecial = buildBiteSaverDailySpecialOfferIndex({
        restaurantAccountId: accountId,
        sourceDocumentId: specialId,
        offer: specialSource,
        restaurant: scenario.after,
        now,
      });
      assert.notDeepEqual(
        expectedBeforeCoupon,
        expectedAfterCoupon,
        "coupon builder output must change",
      );
      assert.notDeepEqual(
        expectedBeforeSpecial,
        expectedAfterSpecial,
        "daily-special builder output must change",
      );
      assert.notEqual(
        biteSaverOfferParentFingerprint(scenario.before),
        biteSaverOfferParentFingerprint(scenario.after),
        "parent fingerprint must change",
      );

      await reconcileBiteSaverCouponOfferIndex(
        database,
        accountId,
        couponId,
        now,
      );
      await reconcileBiteSaverDailySpecialOfferIndex(
        database,
        accountId,
        specialId,
        now,
      );
      for (const [indexPath, sourceKind, sourceDocumentId] of [
        [couponIndexPath, "biteSaverCoupon", couponId],
        [specialIndexPath, "biteSaverDailySpecial", specialId],
      ]) {
        database.records.set(indexPath, {
          ...(database.records.get(indexPath) ?? {}),
          restaurantAccountId:
            dartUtf16FirestoreBytesOrderKey(accountId),
          sourceDocumentId,
          sourceKind,
          restaurantDisplayName: "stale-name-canary",
          restaurantPrimaryImageUrl:
            "https://images.example.test/stale-image-canary.jpg",
          staleCustomerCanary: "must-be-replaced-or-removed",
        });
      }

      if (scenario.after === null) {
        database.records.delete(accountPath);
      } else {
        database.records.set(accountPath, scenario.after);
      }
      const operationsBeforeEvent = database.operations.length;
      const transactionAttemptsBeforeEvent = database.transactionAttempts.length;
      const sourceEventId = `effective-parent-event-${scenarioIndex}`;
      const event = {
        restaurantAccountId: accountId,
        before: scenario.before,
        after: scenario.after,
        sourceEventId,
        now,
      };
      await handleBiteSaverRestaurantWrite(database, event);
      await handleBiteSaverRestaurantWrite(database, event);

      const sourceOccurrenceId = createSearchIndexSourceOccurrenceId(
        sourceEventId,
      );
      const requestedSourceFingerprint = biteSaverOfferParentFingerprint(
        scenario.after,
      );
      const expectedJobId = createSearchIndexJobId({
        jobKind: "biteSaverOffers",
        parentSource: "biteSaver",
        parentSourceDocumentId: accountId,
        requestedSourceFingerprint,
        sourceOccurrenceId,
        continuationCursor: null,
      });
      const jobPath = `private_search_index_jobs/${expectedJobId}`;
      const occurrenceJobs = [...database.records.entries()].filter(
        ([path, document]) =>
          path.startsWith("private_search_index_jobs/") &&
          document.sourceOccurrenceId === sourceOccurrenceId,
      );
      assert.equal(occurrenceJobs.length, 1);
      assert.equal(occurrenceJobs[0][0], jobPath);
      assert.equal(occurrenceJobs[0][1].continuationCursor, undefined);
      assert.equal(
        occurrenceJobs[0][1].requestedSourceFingerprint,
        requestedSourceFingerprint,
      );
      assert.equal(occurrenceJobs[0][1].status, "pending");
      const eventOperations = database.operations.slice(operationsBeforeEvent);
      assert.equal(
        eventOperations.filter((operation) =>
          operation.operation === "createIfAbsent" &&
          operation.path === jobPath).length,
        2,
        "duplicate delivery must address only the deterministic root job",
      );

      const result = await processSearchIndexJob(database, expectedJobId, now);
      assert.deepEqual(result, {processedCount: 2, continuationCursor: null});
      const completedJob = database.records.get(jobPath);
      assert.equal(completedJob.status, "completed");
      assert.equal(completedJob.processedCount, 2);
      assert.equal(completedJob.continuationJobId, null);
      assert.equal(
        [...database.records.keys()].filter((path) =>
          path.startsWith("private_search_index_jobs/")).length,
        1,
        "two small offer phases must not create a continuation job",
      );

      if (scenario.after === null) {
        const cleanupQueries = database.operations.filter((operation) =>
          operation.operation === "query" &&
          operation.query.collectionPath === "bitesaver_offer_index" &&
          operation.query.where?.field === "restaurantAccountId" &&
          sameFirestoreQueryValue(
            operation.query.where.value,
            dartUtf16FirestoreBytesOrderKey(accountId),
          ));
        assert.equal(cleanupQueries.length, 1);
      } else {
        for (const collectionPath of [
          `${accountPath}/coupons`,
          `${accountPath}/daily_specials`,
        ]) {
          assert.equal(
            database.operations.filter((operation) =>
              operation.operation === "query" &&
              operation.query.collectionPath === collectionPath).length,
            1,
            `${collectionPath} phase`,
          );
        }
      }

      for (const [indexPath, expected] of [
        [couponIndexPath, expectedAfterCoupon],
        [specialIndexPath, expectedAfterSpecial],
      ]) {
        if (expected === null) {
          assert.equal(database.records.has(indexPath), false);
        } else {
          assert.deepEqual(database.records.get(indexPath), expected);
          assert.equal(
            Object.hasOwn(database.records.get(indexPath), "staleCustomerCanary"),
            false,
          );
        }
      }
      assert.strictEqual(database.records.get(unrelatedIndexPath), unrelatedIndex);
      assert.equal(
        database.operations.slice(operationsBeforeEvent).some((operation) =>
          (operation.operation === "set" || operation.operation === "delete") &&
          operation.path === unrelatedIndexPath),
        false,
      );

      const operationsBeforeWorkerRedelivery = database.operations.length;
      const transactionsBeforeWorkerRedelivery =
        database.transactionAttempts.length;
      const duplicateResult = await processSearchIndexJob(
        database,
        expectedJobId,
        now,
      );
      assert.deepEqual(
        duplicateResult,
        {processedCount: 0, continuationCursor: null},
      );
      assert.equal(
        database.transactionAttempts.length,
        transactionsBeforeWorkerRedelivery,
      );
      assert.equal(
        database.operations.slice(operationsBeforeWorkerRedelivery).some(
          (operation) => operation.operation !== "get",
        ),
        false,
      );
      assert.ok(
        database.transactionAttempts.length > transactionAttemptsBeforeEvent,
        "handler/worker path must exercise real transactions",
      );
    });
  }
});

test("a posting-flag-only parent transition disables every public BiteSaver index", async () => {
  const accountPath = "restaurant_accounts/account-1";
  const couponPath = `${accountPath}/coupons/coupon-1`;
  const dailySpecialPath = `${accountPath}/daily_specials/special-1`;
  const before = biteSaverRestaurant({
    subscriptionStatus: "active",
    couponPostingEnabled: true,
  });
  const after = {
    ...before,
    couponPostingEnabled: false,
  };
  const database = new FakeSearchIndexDatabase({
    [accountPath]: before,
    [couponPath]: coupon("coupon-1"),
    [dailySpecialPath]: {
      id: "special-1",
      restaurantId: "account-1",
      ownerUid: "account-1",
      title: "Current Special",
      isActive: true,
      availabilityMode: "todayOnly",
      allDay: true,
      expiresAt: new Date(now.getTime() + 60_000),
      updatedAt: now,
    },
  });
  const restaurantIndexId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteSaverRestaurant",
    sourceDocumentId: "account-1",
  });
  const couponIndexId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: "account-1",
    sourceDocumentId: "coupon-1",
  });
  const dailySpecialIndexId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverDailySpecial",
    parentSourceDocumentId: "account-1",
    sourceDocumentId: "special-1",
  });
  const restaurantIndexPath =
    `restaurant_search_index/${restaurantIndexId}`;
  const couponIndexPath = `bitesaver_offer_index/${couponIndexId}`;
  const dailySpecialIndexPath =
    `bitesaver_offer_index/${dailySpecialIndexId}`;

  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  await reconcileBiteSaverCouponOfferIndex(
    database,
    "account-1",
    "coupon-1",
    now,
  );
  await reconcileBiteSaverDailySpecialOfferIndex(
    database,
    "account-1",
    "special-1",
    now,
  );
  assert.equal(database.records.get(restaurantIndexPath).publicVisible, true);
  assert.equal(database.records.get(couponIndexPath).publicVisible, true);
  assert.equal(database.records.get(dailySpecialIndexPath).publicVisible, true);

  database.records.set(accountPath, after);
  await handleBiteSaverRestaurantWrite(database, {
    restaurantAccountId: "account-1",
    before,
    after,
    sourceEventId: "event-posting-flag",
    now,
  });

  const restaurantIndex = database.records.get(restaurantIndexPath);
  assert.equal(restaurantIndex.publicVisible, false);
  assert.equal(restaurantIndex.adminDirectoryVisible, true);
  const jobs = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(jobs.length, 1);
  assert.equal(
    jobs[0][1].requestedSourceFingerprint,
    biteSaverOfferParentFingerprint(after),
  );

  const jobId = jobs[0][0].slice("private_search_index_jobs/".length);
  const result = await processSearchIndexJob(database, jobId, now);
  assert.deepEqual(result, {processedCount: 2, continuationCursor: null});
  const couponIndex = database.records.get(couponIndexPath);
  const dailySpecialIndex = database.records.get(dailySpecialIndexPath);
  assert.equal(couponIndex.publicVisible, false);
  assert.equal(couponIndex.adminVisible, true);
  assert.equal(dailySpecialIndex.publicVisible, false);
  assert.equal(dailySpecialIndex.adminVisible, true);
  assert.equal(database.records.has(accountPath), true);
  assert.equal(database.records.has(couponPath), true);
  assert.equal(database.records.has(dailySpecialPath), true);
  assert.equal(
    database.operations.some((operation) =>
      operation.operation === "delete" &&
      [accountPath, couponPath, dailySpecialPath].includes(operation.path)),
    false,
  );
});

test("effective BiteSaver ZIP and geography changes fan out through both offer kinds", async (t) => {
  const scenarios = [
    {
      name: "malformed primary ZIP follows changing postalCode fallback",
      before: biteSaverRestaurant({
        zipCode: "34\tBAD",
        postalCode: "34470",
      }),
      after: biteSaverRestaurant({
        zipCode: "34\tBAD",
        postalCode: "33602",
      }),
      assertBefore(index) {
        assert.equal(index.zip5, "34470");
      },
      assertAfter(index) {
        assert.equal(index.zip5, "33602");
      },
    },
    {
      name: "control-whitespace geohash becomes canonical",
      before: biteSaverRestaurant({geohash: `\t${geohash}`}),
      after: biteSaverRestaurant({geohash}),
      assertBefore(index) {
        assert.equal(Object.hasOwn(index, "geohash"), false);
        assert.equal(Object.hasOwn(index, "location"), false);
      },
      assertAfter(index) {
        assert.equal(index.geohash, geohash);
        assert.equal(index.latitude, coordinates.latitude);
        assert.equal(index.longitude, coordinates.longitude);
        assert.ok(index.location instanceof GeoPoint);
      },
    },
  ];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    await t.test(scenario.name, async () => {
      const accountId = `account-parent-parity-${scenarioIndex}`;
      const accountPath = `restaurant_accounts/${accountId}`;
      const couponId = `coupon-${scenarioIndex}`;
      const specialId = `special-${scenarioIndex}`;
      const couponPath = `${accountPath}/coupons/${couponId}`;
      const specialPath = `${accountPath}/daily_specials/${specialId}`;
      const couponIndexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: "biteSaverCoupon",
        parentSourceDocumentId: accountId,
        sourceDocumentId: couponId,
      });
      const specialIndexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: "biteSaverDailySpecial",
        parentSourceDocumentId: accountId,
        sourceDocumentId: specialId,
      });
      const couponIndexPath = `bitesaver_offer_index/${couponIndexId}`;
      const specialIndexPath = `bitesaver_offer_index/${specialIndexId}`;
      const database = new FakeSearchIndexDatabase({
        [accountPath]: scenario.before,
        [couponPath]: coupon(couponId),
        [specialPath]: dailySpecial(specialId, {
          restaurantId: accountId,
          ownerUid: accountId,
        }),
      });

      await reconcileBiteSaverCouponOfferIndex(
        database,
        accountId,
        couponId,
        now,
      );
      await reconcileBiteSaverDailySpecialOfferIndex(
        database,
        accountId,
        specialId,
        now,
      );
      scenario.assertBefore(database.records.get(couponIndexPath));
      scenario.assertBefore(database.records.get(specialIndexPath));
      for (const indexPath of [couponIndexPath, specialIndexPath]) {
        database.records.set(indexPath, {
          ...database.records.get(indexPath),
          staleCustomerCanary: "must-be-replaced",
        });
      }

      database.records.set(accountPath, scenario.after);
      const sourceEventId = `bitesaver-parent-parity-${scenarioIndex}`;
      await handleBiteSaverRestaurantWrite(database, {
        restaurantAccountId: accountId,
        before: scenario.before,
        after: scenario.after,
        sourceEventId,
        now,
      });
      const occurrenceId = createSearchIndexSourceOccurrenceId(sourceEventId);
      const job = [...database.records.entries()].find(([path, data]) =>
        path.startsWith("private_search_index_jobs/") &&
        data.sourceOccurrenceId === occurrenceId);
      assert.notEqual(job, undefined);
      assert.equal(
        job[1].requestedSourceFingerprint,
        biteSaverOfferParentFingerprint(scenario.after),
      );

      const result = await processSearchIndexJob(
        database,
        job[0].slice("private_search_index_jobs/".length),
        now,
      );
      assert.deepEqual(result, {processedCount: 2, continuationCursor: null});
      for (const indexPath of [couponIndexPath, specialIndexPath]) {
        const current = database.records.get(indexPath);
        scenario.assertAfter(current);
        assert.equal(current.publicVisible, true);
        assert.equal(Object.hasOwn(current, "staleCustomerCanary"), false);
      }
    });
  }
});

test("BiteSaver eligibility and parent lifecycle fanout remove and recreate offer output", async () => {
  const accountId = "account-parent-lifecycle";
  const accountPath = `restaurant_accounts/${accountId}`;
  const couponId = "coupon-lifecycle";
  const specialId = "special-lifecycle";
  const couponPath = `${accountPath}/coupons/${couponId}`;
  const specialPath = `${accountPath}/daily_specials/${specialId}`;
  const couponIndexId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: accountId,
    sourceDocumentId: couponId,
  });
  const specialIndexId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverDailySpecial",
    parentSourceDocumentId: accountId,
    sourceDocumentId: specialId,
  });
  const indexPaths = [
    `bitesaver_offer_index/${couponIndexId}`,
    `bitesaver_offer_index/${specialIndexId}`,
  ];
  const active = biteSaverRestaurant();
  const inactive = biteSaverRestaurant({couponPostingEnabled: false});
  const database = new FakeSearchIndexDatabase({
    [accountPath]: active,
    [couponPath]: coupon(couponId),
    [specialPath]: dailySpecial(specialId, {
      restaurantId: accountId,
      ownerUid: accountId,
    }),
  });
  await reconcileBiteSaverCouponOfferIndex(database, accountId, couponId, now);
  await reconcileBiteSaverDailySpecialOfferIndex(
    database,
    accountId,
    specialId,
    now,
  );

  let eventSequence = 0;
  const transition = async (before, after) => {
    if (after === null) {
      database.records.delete(accountPath);
    } else {
      database.records.set(accountPath, after);
    }
    const sourceEventId = `bitesaver-lifecycle-${eventSequence++}`;
    await handleBiteSaverRestaurantWrite(database, {
      restaurantAccountId: accountId,
      before,
      after,
      sourceEventId,
      now,
    });
    const occurrenceId = createSearchIndexSourceOccurrenceId(sourceEventId);
    const job = [...database.records.entries()].find(([path, data]) =>
      path.startsWith("private_search_index_jobs/") &&
      data.sourceOccurrenceId === occurrenceId);
    assert.notEqual(job, undefined);
    await processSearchIndexJob(
      database,
      job[0].slice("private_search_index_jobs/".length),
      now,
    );
  };

  await transition(active, inactive);
  for (const indexPath of indexPaths) {
    assert.equal(database.records.get(indexPath).publicVisible, false);
    assert.equal(database.records.get(indexPath).adminVisible, true);
  }

  await transition(inactive, active);
  for (const indexPath of indexPaths) {
    assert.equal(database.records.get(indexPath).publicVisible, true);
  }

  await transition(active, null);
  for (const indexPath of indexPaths) {
    assert.equal(database.records.has(indexPath), false);
  }

  await transition(null, active);
  for (const indexPath of indexPaths) {
    assert.equal(database.records.get(indexPath).publicVisible, true);
  }
});

test("equivalent and unrelated BiteSaver parent changes do not enqueue fanout", async (t) => {
  const canonicalImage = "https://images.example.test/canonical.jpg";
  const aliasEquivalentBefore = withoutProperties(
    biteSaverRestaurant({
      restaurantName: null,
      name: " Same   Bistro ",
      zipCode: "03440-1234",
      city: " Crystal   River ",
      state: "fl",
      imageUrl: canonicalImage,
    }),
    "mainImageUrl",
  );
  const aliasEquivalentAfter = withoutProperties(
    biteSaverRestaurant({
      restaurantName: "Same Bistro",
      name: "ignored lower name",
      zip: "03440-1234",
      city: "Crystal River",
      state: "FL",
      mainImageUrl: canonicalImage,
      imageUrl: "https://images.example.test/ignored.jpg",
    }),
    "zipCode",
  );
  const cases = [
    {
      name: "unsupported city state and coordinate aliases",
      before: biteSaverRestaurant({
        locality: "Ocala",
        stateCode: "GA",
        lat: 27.9,
        lng: -82.4,
      }),
      after: biteSaverRestaurant({
        locality: "Tampa",
        stateCode: "NY",
        lat: 25.7,
        lng: -80.1,
      }),
    },
    {
      name: "unrelated owner private and subscription fields",
      before: biteSaverRestaurant({
        ownerUid: "owner-before",
        email: "before@example.test",
        subscriptionStatus: "active",
      }),
      after: biteSaverRestaurant({
        ownerUid: "owner-after",
        email: "after@example.test",
        subscriptionStatus: "inactive",
      }),
    },
    {
      name: "ignored imageUrl changes while canonical image remains selected",
      before: biteSaverRestaurant({
        mainImageUrl: canonicalImage,
        imageUrl: "https://images.example.test/ignored-before.jpg",
      }),
      after: biteSaverRestaurant({
        mainImageUrl: canonicalImage,
        imageUrl: "https://images.example.test/ignored-after.jpg",
      }),
    },
    {
      name: "name image ZIP and location aliases keep one effective result",
      before: aliasEquivalentBefore,
      after: aliasEquivalentAfter,
    },
    {
      name: "non-searchable public profile fields",
      before: biteSaverRestaurant({
        streetAddress: "1 Before Street",
        phone: "555-0100",
        website: "https://before.example.test",
      }),
      after: biteSaverRestaurant({
        streetAddress: "2 After Street",
        phone: "555-0200",
        website: "https://after.example.test",
      }),
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, async () => {
      const accountId = `account-no-fanout-${index}`;
      const accountPath = `restaurant_accounts/${accountId}`;
      const couponId = `coupon-no-fanout-${index}`;
      const specialId = `special-no-fanout-${index}`;
      const couponPath = `${accountPath}/coupons/${couponId}`;
      const specialPath = `${accountPath}/daily_specials/${specialId}`;
      const couponSource = coupon(couponId);
      const specialSource = dailySpecial(specialId, {
        restaurantId: accountId,
        ownerUid: accountId,
      });
      const couponIndexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: "biteSaverCoupon",
        parentSourceDocumentId: accountId,
        sourceDocumentId: couponId,
      });
      const specialIndexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: "biteSaverDailySpecial",
        parentSourceDocumentId: accountId,
        sourceDocumentId: specialId,
      });
      const couponIndexPath = `bitesaver_offer_index/${couponIndexId}`;
      const specialIndexPath = `bitesaver_offer_index/${specialIndexId}`;
      assert.equal(
        biteSaverOfferParentFingerprint(scenario.before),
        biteSaverOfferParentFingerprint(scenario.after),
      );
      assert.deepEqual(
        buildBiteSaverCouponOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId: couponId,
          offer: couponSource,
          restaurant: scenario.before,
          now,
        }),
        buildBiteSaverCouponOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId: couponId,
          offer: couponSource,
          restaurant: scenario.after,
          now,
        }),
      );
      assert.deepEqual(
        buildBiteSaverDailySpecialOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId: specialId,
          offer: specialSource,
          restaurant: scenario.before,
          now,
        }),
        buildBiteSaverDailySpecialOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId: specialId,
          offer: specialSource,
          restaurant: scenario.after,
          now,
        }),
      );
      const database = new FakeSearchIndexDatabase({
        [accountPath]: scenario.before,
        [couponPath]: couponSource,
        [specialPath]: specialSource,
      });
      await reconcileBiteSaverCouponOfferIndex(
        database,
        accountId,
        couponId,
        now,
      );
      await reconcileBiteSaverDailySpecialOfferIndex(
        database,
        accountId,
        specialId,
        now,
      );
      const couponIndexBefore = database.records.get(couponIndexPath);
      const specialIndexBefore = database.records.get(specialIndexPath);
      assert.notEqual(couponIndexBefore, undefined);
      assert.notEqual(specialIndexBefore, undefined);

      database.records.set(accountPath, scenario.after);
      const operationsBeforeEvent = database.operations.length;
      const event = {
        restaurantAccountId: accountId,
        before: scenario.before,
        after: scenario.after,
        sourceEventId: `no-fanout-${index}`,
        now,
      };
      await handleBiteSaverRestaurantWrite(database, event);
      await handleBiteSaverRestaurantWrite(database, event);
      assert.equal(
        [...database.records.keys()].some((path) =>
          path.startsWith("private_search_index_jobs/")),
        false,
      );
      assert.strictEqual(database.records.get(couponIndexPath), couponIndexBefore);
      assert.strictEqual(database.records.get(specialIndexPath), specialIndexBefore);
      assert.equal(
        database.operations.slice(operationsBeforeEvent).some((operation) =>
          operation.operation === "query" ||
          ((operation.operation === "set" || operation.operation === "delete") &&
            (operation.path === couponIndexPath ||
              operation.path === specialIndexPath))),
        false,
      );
    });
  }
});

test("current Home matcher parent changes enqueue offer projection repair", async (t) => {
  const cases = [
    {
      name: "searchable bio",
      before: biteSaverRestaurant({bio: "Before bio"}),
      after: biteSaverRestaurant({bio: "After bio"}),
    },
    {
      name: "ZIP+4 matching suffix",
      before: biteSaverRestaurant({zipCode: "03440-1234"}),
      after: biteSaverRestaurant({zipCode: "03440-9876"}),
    },
  ];
  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, async () => {
      assert.notEqual(
        biteSaverOfferParentFingerprint(scenario.before),
        biteSaverOfferParentFingerprint(scenario.after),
      );
      const accountId = `account-matcher-fanout-${index}`;
      const accountPath = `restaurant_accounts/${accountId}`;
      const database = new FakeSearchIndexDatabase({
        [accountPath]: scenario.after,
      });
      await handleBiteSaverRestaurantWrite(database, {
        restaurantAccountId: accountId,
        before: scenario.before,
        after: scenario.after,
        sourceEventId: `matcher-fanout-${index}`,
        now,
      });
      assert.equal(
        [...database.records.keys()].some((path) =>
          path.startsWith("private_search_index_jobs/")),
        true,
      );
    });
  }
});

test("an Admin Hide transition reconciles the restaurant and stored offer indexes", async () => {
  const accountPath = "restaurant_accounts/account-1";
  const couponPath = `${accountPath}/coupons/coupon-1`;
  const before = biteSaverRestaurant();
  const after = {...before, adminHidden: true};
  const database = new FakeSearchIndexDatabase({
    [accountPath]: before,
    [couponPath]: coupon("coupon-1"),
  });
  const restaurantIndexId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteSaverRestaurant",
    sourceDocumentId: "account-1",
  });
  const couponIndexId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: "account-1",
    sourceDocumentId: "coupon-1",
  });
  const restaurantIndexPath = `restaurant_search_index/${restaurantIndexId}`;
  const couponIndexPath = `bitesaver_offer_index/${couponIndexId}`;

  await reconcileBiteSaverRestaurantIndex(database, "account-1", now);
  await reconcileBiteSaverCouponOfferIndex(database, "account-1", "coupon-1", now);
  assert.equal(database.records.get(restaurantIndexPath).publicVisible, true);
  assert.equal(database.records.get(couponIndexPath).publicVisible, true);

  database.records.set(accountPath, after);
  await handleBiteSaverRestaurantWrite(database, {
    restaurantAccountId: "account-1",
    before,
    after,
    sourceEventId: "event-admin-hide",
    now,
  });
  assert.equal(database.records.get(restaurantIndexPath).publicVisible, false);
  assert.equal(database.records.get(restaurantIndexPath).adminDirectoryVisible, true);

  const jobs = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(jobs.length, 1);
  assert.equal(
    jobs[0][1].requestedSourceFingerprint,
    biteSaverOfferParentFingerprint(after),
  );
  await processSearchIndexJob(
    database,
    jobs[0][0].slice("private_search_index_jobs/".length),
    now,
  );
  assert.equal(database.records.get(couponIndexPath).publicVisible, false);
  assert.equal(database.records.get(couponIndexPath).adminVisible, true);
  assert.equal(database.records.has(accountPath), true);
  assert.equal(database.records.has(couponPath), true);
});

test("duplicate relevant parent events create only one deterministic job", async () => {
  const before = biteSaverRestaurant({restaurantName: "Before"});
  const after = biteSaverRestaurant({restaurantName: "After"});
  const database = new FakeSearchIndexDatabase({
    "restaurant_accounts/account-1": after,
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await handleBiteSaverRestaurantWrite(database, {
      restaurantAccountId: "account-1",
      before,
      after,
      sourceEventId: "same-delivered-event",
      now,
    });
  }
  const jobs = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0][1].requestedSourceFingerprint, biteSaverOfferParentFingerprint(after));
  assert.equal(JSON.stringify(jobs[0][1]).includes("Before"), false);
});

test("delete-event redelivery keeps one root occurrence while a later delete is distinct", async () => {
  const restaurantPath = "bitescore_restaurants/restaurant-1";
  const active = biteScoreRestaurant({name: "Before Delete"});
  const recreated = biteScoreRestaurant({name: "Recreated Between Deliveries"});
  const database = new FakeSearchIndexDatabase({[restaurantPath]: active});
  const deliverDelete = async (sourceEventId, before) => {
    await handleBiteScoreRestaurantWrite(database, {
      restaurantId: "restaurant-1",
      before,
      after: null,
      sourceEventId,
      now,
    });
  };

  database.records.delete(restaurantPath);
  await deliverDelete("same-delete-cloud-event", active);
  const firstOccurrenceId = createSearchIndexSourceOccurrenceId(
    "same-delete-cloud-event",
  );
  const firstJobs = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(firstJobs.length, 1);
  assert.equal(firstJobs[0][1].sourceOccurrenceId, firstOccurrenceId);
  const firstJobPath = firstJobs[0][0];

  database.records.set(restaurantPath, recreated);
  await deliverDelete("same-delete-cloud-event", active);
  const jobsAfterRedelivery = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(jobsAfterRedelivery.length, 1);
  assert.equal(jobsAfterRedelivery[0][0], firstJobPath);
  assert.equal(jobsAfterRedelivery[0][1].sourceOccurrenceId, firstOccurrenceId);
  assert.equal(
    database.operations.filter((entry) =>
      entry.operation === "createIfAbsent" && entry.path === firstJobPath).length,
    2,
  );

  database.records.delete(restaurantPath);
  await deliverDelete("later-distinct-delete-cloud-event", recreated);
  const finalJobs = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(finalJobs.length, 2);
  const laterOccurrenceId = createSearchIndexSourceOccurrenceId(
    "later-distinct-delete-cloud-event",
  );
  assert.notEqual(laterOccurrenceId, firstOccurrenceId);
  const laterJob = finalJobs.find(([, document]) =>
    document.sourceOccurrenceId === laterOccurrenceId);
  assert.notEqual(laterJob, undefined);
  assert.notEqual(laterJob[0], firstJobPath);
  assert.ok(finalJobs.every(([, document]) =>
    document.requestedSourceFingerprint ===
      biteScoreDishParentFingerprint(null, "restaurant-1")));
});

test("missing event identity or snapshots never create an ambiguous parent job", async (t) => {
  const handlers = [
    {
      name: "BiteSaver",
      documentId: "account-malformed-event",
      parentPath: "restaurant_accounts/account-malformed-event",
      active: biteSaverRestaurant(),
      invoke(database, value) {
        return handleBiteSaverRestaurantWrite(database, {
          restaurantAccountId: value.documentId,
          before: value.before,
          after: value.after,
          sourceEventId: value.sourceEventId,
          now,
        });
      },
    },
    {
      name: "BiteScore",
      documentId: "restaurant-malformed-event",
      parentPath: "bitescore_restaurants/restaurant-malformed-event",
      active: biteScoreRestaurant(),
      invoke(database, value) {
        return handleBiteScoreRestaurantWrite(database, {
          restaurantId: value.documentId,
          before: value.before,
          after: value.after,
          sourceEventId: value.sourceEventId,
          now,
        });
      },
    },
  ];
  const cases = [
    {
      name: "missing event ID",
      changes: {sourceEventId: undefined},
    },
    {
      name: "empty event ID",
      changes: {sourceEventId: ""},
    },
    {
      name: "non-string event ID",
      changes: {sourceEventId: 42},
    },
    {
      name: "over-limit event ID length",
      changes: {sourceEventId: "x".repeat(4_097)},
    },
    {
      name: "over-limit event ID bytes",
      changes: {sourceEventId: "😀".repeat(1_025)},
    },
    {
      name: "no usable snapshots",
      changes: {
        before: null,
        after: null,
        sourceEventId: "event-with-no-snapshots",
      },
    },
    {
      name: "undefined event data",
      changes: {
        before: undefined,
        after: undefined,
        sourceEventId: "event-with-undefined-data",
      },
    },
    {
      name: "missing before snapshot",
      changes: {
        before: undefined,
        sourceEventId: "event-with-missing-before",
      },
    },
    {
      name: "missing after snapshot",
      changes: {
        before: null,
        after: undefined,
        sourceEventId: "event-with-missing-after",
      },
    },
    {
      name: "array snapshot data",
      changes: {
        after: [],
        sourceEventId: "event-with-array-data",
      },
    },
    {
      name: "scalar snapshot data",
      changes: {
        before: "malformed",
        after: {},
        sourceEventId: "event-with-scalar-data",
      },
    },
    {
      name: "non-record object snapshot data",
      changes: {
        after: new Date(now.getTime()),
        sourceEventId: "event-with-non-record-object-data",
      },
    },
    {
      name: "snapshot data with a throwing field getter",
      changes: {
        after: Object.defineProperty({}, "restaurantName", {
          enumerable: true,
          get() {
            throw new Error("must-not-escape");
          },
        }),
        sourceEventId: "event-with-throwing-snapshot-data",
      },
    },
    {
      name: "missing document ID metadata",
      changes: {
        documentId: undefined,
        sourceEventId: "event-with-missing-document-id",
      },
    },
    {
      name: "empty document ID metadata",
      changes: {
        documentId: "",
        sourceEventId: "event-with-empty-document-id",
      },
    },
    {
      name: "slash-containing document path metadata",
      changes: {
        documentId: "malformed/document/path",
        sourceEventId: "event-with-malformed-document-path",
      },
    },
    {
      name: "over-limit document ID metadata",
      changes: {
        documentId: "x".repeat(1_501),
        sourceEventId: "event-with-over-limit-document-id",
      },
    },
  ];

  for (const handler of handlers) {
    for (const scenario of cases) {
      await t.test(`${handler.name}: ${scenario.name}`, async () => {
        const database = new FakeSearchIndexDatabase({
          [handler.parentPath]: handler.active,
        });
        const activeRecord = database.records.get(handler.parentPath);
        const value = {
          documentId: handler.documentId,
          before: handler.active,
          after: null,
          sourceEventId: "valid-event-id",
          ...scenario.changes,
        };
        await handler.invoke(database, value);
        await handler.invoke(database, value);
        assert.deepEqual(database.operations, []);
        assert.deepEqual(database.transactionAttempts, []);
        assert.strictEqual(database.records.get(handler.parentPath), activeRecord);
        assert.equal(
          [...database.records.keys()].some((path) =>
            path.startsWith("private_search_index_jobs/")),
          false,
        );
      });
    }
  }
});

test("valid parent events preserve transient infrastructure retry behavior", async (t) => {
  const cases = [
    {
      name: "BiteSaver",
      documentId: "account-transient-parent",
      parentPath: "restaurant_accounts/account-transient-parent",
      before: biteSaverRestaurant({restaurantName: "Before Bistro"}),
      after: biteSaverRestaurant({restaurantName: "After Bistro"}),
      invoke(database, value) {
        return handleBiteSaverRestaurantWrite(database, {
          restaurantAccountId: value.documentId,
          before: value.before,
          after: value.after,
          sourceEventId: value.sourceEventId,
          now,
        });
      },
    },
    {
      name: "BiteScore",
      documentId: "restaurant-transient-parent",
      parentPath: "bitescore_restaurants/restaurant-transient-parent",
      before: biteScoreRestaurant({name: "Before Bistro"}),
      after: biteScoreRestaurant({name: "After Bistro"}),
      invoke(database, value) {
        return handleBiteScoreRestaurantWrite(database, {
          restaurantId: value.documentId,
          before: value.before,
          after: value.after,
          sourceEventId: value.sourceEventId,
          now,
        });
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const transientError = new Error("injected-parent-read-failure");
      const database = new FakeSearchIndexDatabase({
        [scenario.parentPath]: scenario.after,
      });
      database.getDocumentHook = async (path) => {
        if (path === scenario.parentPath) throw transientError;
        return undefined;
      };
      await assert.rejects(
        scenario.invoke(database, {
          documentId: scenario.documentId,
          before: scenario.before,
          after: scenario.after,
          sourceEventId: `valid-transient-${scenario.name}`,
        }),
        (error) => error === transientError,
      );
      assert.deepEqual(database.operations, [
        {operation: "get", path: scenario.parentPath},
      ]);
      assert.equal(
        [...database.records.keys()].some((path) =>
          path.startsWith("private_search_index_jobs/")),
        false,
      );
    });
  }
});

test("BiteSaver delete-event recurrence keeps occurrence identity exact", async () => {
  const accountId = "account-delete-occurrence";
  const accountPath = `restaurant_accounts/${accountId}`;
  const active = biteSaverRestaurant({restaurantName: "Before Delete"});
  const recreated = biteSaverRestaurant({restaurantName: "Recreated Parent"});
  const database = new FakeSearchIndexDatabase({[accountPath]: active});
  const deliverDelete = async (sourceEventId, before) => {
    await handleBiteSaverRestaurantWrite(database, {
      restaurantAccountId: accountId,
      before,
      after: null,
      sourceEventId,
      now,
    });
  };

  database.records.delete(accountPath);
  await deliverDelete("same-bitesaver-delete-event", active);
  const firstOccurrenceId = createSearchIndexSourceOccurrenceId(
    "same-bitesaver-delete-event",
  );
  const firstJobs = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(firstJobs.length, 1);
  assert.equal(firstJobs[0][1].sourceOccurrenceId, firstOccurrenceId);
  const firstJobPath = firstJobs[0][0];

  database.records.set(accountPath, recreated);
  await deliverDelete("same-bitesaver-delete-event", active);
  const jobsAfterRedelivery = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(jobsAfterRedelivery.length, 1);
  assert.equal(jobsAfterRedelivery[0][0], firstJobPath);
  assert.equal(
    database.records.get(accountPath).restaurantName,
    "Recreated Parent",
  );

  database.records.delete(accountPath);
  await deliverDelete("later-bitesaver-delete-event", recreated);
  const finalJobs = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(finalJobs.length, 2);
  const laterOccurrenceId = createSearchIndexSourceOccurrenceId(
    "later-bitesaver-delete-event",
  );
  assert.notEqual(laterOccurrenceId, firstOccurrenceId);
  const laterJob = finalJobs.find(([, document]) =>
    document.sourceOccurrenceId === laterOccurrenceId);
  assert.notEqual(laterJob, undefined);
  assert.notEqual(laterJob[0], firstJobPath);
  assert.ok(finalJobs.every(([, document]) =>
    document.requestedSourceFingerprint ===
      biteSaverOfferParentFingerprint(null)));
});

test("parent jobs distinguish recurring states while duplicate event delivery stays idempotent", async () => {
  const restaurantPath = "bitescore_restaurants/restaurant-1";
  const dishPath = "bitescore_dishes/dish-1";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const indexPath = `dish_search_index/${indexId}`;
  const active = biteScoreRestaurant({isActive: true});
  const inactive = biteScoreRestaurant({isActive: false});
  const database = new FakeSearchIndexDatabase({
    [restaurantPath]: active,
    [dishPath]: biteScoreDish("dish-1"),
  });
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  assert.notEqual(database.records.get(indexPath).customerPublicProjection, null);

  const transition = async (before, after, sourceEventId) => {
    if (after === null) {
      database.records.delete(restaurantPath);
    } else {
      database.records.set(restaurantPath, after);
    }
    await handleBiteScoreRestaurantWrite(database, {
      restaurantId: "restaurant-1",
      before,
      after,
      sourceEventId,
      now,
    });
    const occurrenceId = createSearchIndexSourceOccurrenceId(sourceEventId);
    const jobEntry = [...database.records.entries()].find(([path, data]) =>
      path.startsWith("private_search_index_jobs/") &&
      data.sourceOccurrenceId === occurrenceId);
    assert.notEqual(jobEntry, undefined, sourceEventId);
    await processSearchIndexJob(
      database,
      jobEntry[0].slice("private_search_index_jobs/".length),
      now,
    );
    return jobEntry;
  };

  const firstInactive = await transition(active, inactive, "event-inactive-1");
  assert.equal(database.records.get(indexPath).customerPublicProjection, null);
  await transition(inactive, active, "event-active-1");
  assert.notEqual(database.records.get(indexPath).customerPublicProjection, null);
  const secondInactive = await transition(active, inactive, "event-inactive-2");
  assert.equal(database.records.get(indexPath).customerPublicProjection, null);
  assert.equal(
    firstInactive[1].requestedSourceFingerprint,
    secondInactive[1].requestedSourceFingerprint,
  );
  assert.notEqual(firstInactive[0], secondInactive[0]);

  const jobCountAfterSecondInactive = [...database.records.keys()].filter((path) =>
    path.startsWith("private_search_index_jobs/")).length;
  await handleBiteScoreRestaurantWrite(database, {
    restaurantId: "restaurant-1",
    before: active,
    after: inactive,
    sourceEventId: "event-inactive-2",
    now,
  });
  assert.equal(
    [...database.records.keys()].filter((path) =>
      path.startsWith("private_search_index_jobs/")).length,
    jobCountAfterSecondInactive,
  );

  await transition(inactive, active, "event-active-before-delete");
  await transition(active, null, "event-delete-1");
  assert.equal(database.records.has(indexPath), false);
  await transition(null, active, "event-recreate-1");
  assert.notEqual(database.records.get(indexPath).customerPublicProjection, null);
  await transition(active, null, "event-delete-2");
  assert.equal(database.records.has(indexPath), false);

  database.records.set(restaurantPath, active);
  await transition(null, active, "event-recreate-2");
  const beforeDelayedDuplicateCount = [...database.records.keys()].filter((path) =>
    path.startsWith("private_search_index_jobs/")).length;
  await handleBiteScoreRestaurantWrite(database, {
    restaurantId: "restaurant-1",
    before: active,
    after: inactive,
    sourceEventId: "event-inactive-1",
    now,
  });
  assert.equal(
    [...database.records.keys()].filter((path) =>
      path.startsWith("private_search_index_jobs/")).length,
    beforeDelayedDuplicateCount,
  );
  assert.notEqual(database.records.get(indexPath).customerPublicProjection, null);
});

test("irrelevant parent-only changes do not enqueue dependent work", async () => {
  const source = biteScoreRestaurant();
  for (const field of [
    "ownerUserId",
    "streetAddress",
    "state_name",
    "zip_code",
    "phone",
  ]) {
    const before = {...source, [field]: `before-${field}`};
    const after = {...source, [field]: `after-${field}`};
    const database = new FakeSearchIndexDatabase({
      "bitescore_restaurants/restaurant-1": after,
    });
    await handleBiteScoreRestaurantWrite(database, {
      restaurantId: "restaurant-1",
      before,
      after,
      sourceEventId: `event-irrelevant-${field}`,
      now,
    });
    assert.equal(
      [...database.records.keys()].some((path) =>
        path.startsWith("private_search_index_jobs/")),
      false,
      field,
    );
  }
});

test("consumed parent name, geography, coordinate, and activity fields enqueue dependent work", async () => {
  const source = biteScoreRestaurant();
  const cases = [
    {field: "name", value: "Changed Parent Name"},
    {field: "city", value: "Ocala"},
    {field: "state", value: "GA"},
    {field: "zipCode", value: "34470"},
    {
      field: "location",
      value: new GeoPoint(coordinates.latitude + 0.01, coordinates.longitude),
    },
    {field: "geohash", value: "djjjjjjjjj"},
    {field: "isActive", value: false},
  ];
  for (const {field, value} of cases) {
    const after = {...source, [field]: value};
    const database = new FakeSearchIndexDatabase({
      "bitescore_restaurants/restaurant-1": after,
    });
    await handleBiteScoreRestaurantWrite(database, {
      restaurantId: "restaurant-1",
      before: source,
      after,
      sourceEventId: `event-consumed-${field}`,
      now,
    });
    assert.equal(
      [...database.records.keys()].filter((path) =>
        path.startsWith("private_search_index_jobs/")).length,
      1,
      field,
    );
  }
});

test("canonical parent field removal and re-addition always enqueue and reconcile dishes", async () => {
  const parentPath = "bitescore_restaurants/restaurant-1";
  const dishPath = "bitescore_dishes/dish-1";
  const base = biteScoreRestaurant({
    streetAddress: "1 Main St",
    locality: "Crystal River",
    region: "FL",
    postalCode: "34428",
    location: {latitude: coordinates.latitude, longitude: coordinates.longitude, isEqual() { return true; }},
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });
  const database = new FakeSearchIndexDatabase({
    [parentPath]: base,
    [dishPath]: biteScoreDish("dish-1"),
  });
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const indexPath = `dish_search_index/${indexId}`;
  await reconcileBiteScoreDishIndex(database, "dish-1", now);

  let eventSequence = 0;
  for (const field of ["city", "state", "zipCode", "location", "latitude", "longitude", "geohash"]) {
    const removed = {...base};
    delete removed[field];
    database.records.set(parentPath, removed);
    const removeEvent = `canonical-remove-${field}-${eventSequence++}`;
    await handleBiteScoreRestaurantWrite(database, {
      restaurantId: "restaurant-1",
      before: base,
      after: removed,
      sourceEventId: removeEvent,
      now,
    });
    const removeOccurrence = createSearchIndexSourceOccurrenceId(removeEvent);
    const removeJob = [...database.records.entries()].find(([path, data]) =>
      path.startsWith("private_search_index_jobs/") &&
      data.sourceOccurrenceId === removeOccurrence);
    assert.notEqual(removeJob, undefined, field);
    await processSearchIndexJob(
      database,
      removeJob[0].slice("private_search_index_jobs/".length),
      now,
    );
    if (["city", "state", "zipCode", "geohash"].includes(field)) {
      assert.equal(database.records.get(indexPath).customerPublicProjection, null, field);
    }

    database.records.set(parentPath, base);
    const addEvent = `canonical-add-${field}-${eventSequence++}`;
    await handleBiteScoreRestaurantWrite(database, {
      restaurantId: "restaurant-1",
      before: removed,
      after: base,
      sourceEventId: addEvent,
      now,
    });
    const addOccurrence = createSearchIndexSourceOccurrenceId(addEvent);
    const addJob = [...database.records.entries()].find(([path, data]) =>
      path.startsWith("private_search_index_jobs/") &&
      data.sourceOccurrenceId === addOccurrence);
    assert.notEqual(addJob, undefined, field);
    await processSearchIndexJob(
      database,
      addJob[0].slice("private_search_index_jobs/".length),
      now,
    );
    assert.notEqual(database.records.get(indexPath).customerPublicProjection, null, field);
  }
});

test("eligibility-changing parent scalar transitions enqueue and clear stale customer payloads", async () => {
  const parentPath = "bitescore_restaurants/restaurant-1";
  const dishPath = "bitescore_dishes/dish-1";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const indexPath = `dish_search_index/${indexId}`;
  const cases = [
    {
      label: "compatible GeoPoint to invalid plain coordinate map",
      eventId: "event-coordinate-object-kind",
      before: (() => {
        const source = biteScoreRestaurant({
          location: new GeoPoint(coordinates.latitude, coordinates.longitude),
        });
        delete source.latitude;
        delete source.longitude;
        return source;
      })(),
      afterLocation: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      },
    },
    {
      label: "well-formed replacement character to malformed surrogate",
      eventId: "event-exact-utf16-parent-field",
      before: biteScoreRestaurant({city: "A\ufffdB"}),
      afterCity: "A\ud800B",
    },
  ];

  for (const transition of cases) {
    const after = transition.afterLocation === undefined
      ? {...transition.before, city: transition.afterCity}
      : {...transition.before, location: transition.afterLocation};
    const database = new FakeSearchIndexDatabase({
      [parentPath]: transition.before,
      [dishPath]: biteScoreDish("dish-1"),
    });
    await reconcileBiteScoreDishIndex(database, "dish-1", now);
    const initialIndex = database.records.get(indexPath);
    assert.notEqual(
      initialIndex.customerPublicProjection,
      null,
      transition.label,
    );
    database.records.set(indexPath, {
      ...initialIndex,
      customerPublicProjection: {
        ...initialIndex.customerPublicProjection,
        staleNestedCanary: transition.label,
      },
    });

    database.records.set(parentPath, after);
    await handleBiteScoreRestaurantWrite(database, {
      restaurantId: "restaurant-1",
      before: transition.before,
      after,
      sourceEventId: transition.eventId,
      now,
    });
    const occurrenceId = createSearchIndexSourceOccurrenceId(transition.eventId);
    const jobEntry = [...database.records.entries()].find(([path, data]) =>
      path.startsWith("private_search_index_jobs/") &&
      data.sourceOccurrenceId === occurrenceId);
    assert.notEqual(jobEntry, undefined, transition.label);
    await processSearchIndexJob(
      database,
      jobEntry[0].slice("private_search_index_jobs/".length),
      now,
    );

    const reconciledIndex = database.records.get(indexPath);
    assert.equal(
      reconciledIndex.customerPublicProjection,
      null,
      transition.label,
    );
    assert.equal(
      JSON.stringify(reconciledIndex).includes("staleNestedCanary"),
      false,
      transition.label,
    );
  }
});

test("invalid actual source IDs are skipped before any Firestore path is constructed", async () => {
  for (const invalidId of ["", " padded ", "slash/id", ".", "control\u0001", "format\u200b", "khmer\u17b5", "bad\ud800", "x".repeat(1_501)]) {
    const database = new FakeSearchIndexDatabase();
    await reconcileBiteScoreRestaurantIndex(database, invalidId, now);
    await reconcileBiteScoreDishIndex(database, invalidId, now);
    await handleBiteScoreRestaurantWrite(database, {
      restaurantId: invalidId,
      before: null,
      after: biteScoreRestaurant(),
      sourceEventId: "invalid-source-event",
      now,
    });
    assert.deepEqual(database.operations, [], JSON.stringify(invalidId));
  }
});

test("BiteScore worker processes at most 100 and creates one continuation", async () => {
  const initial = {"bitescore_restaurants/restaurant-1": biteScoreRestaurant()};
  for (let index = 0; index < 101; index += 1) {
    const id = `dish-${String(index).padStart(3, "0")}`;
    initial[`bitescore_dishes/${id}`] = biteScoreDish(id);
  }
  const job = jobFixture();
  initial[`private_search_index_jobs/${job.id}`] = job.document;
  const database = new FakeSearchIndexDatabase(initial);
  const result = await processSearchIndexJob(database, job.id, now);
  assert.equal(result.processedCount, maximumSearchIndexWorkerBatchSize);
  assert.deepEqual(result.continuationCursor, {
    phase: "dishes",
    afterDocumentId: "dish-099",
  });
  assert.equal(
    [...database.records.keys()].filter((path) => path.startsWith("dish_search_index/")).length,
    100,
  );
  assert.equal(
    database.operations.filter((entry) => entry.operation === "createIfAbsent").length,
    1,
  );
  assert.equal(database.records.get(`private_search_index_jobs/${job.id}`).status, "completed");
  for (const operation of database.operations.filter((entry) => entry.operation === "query")) {
    assert.ok(operation.query.limit <= 101);
  }
});

test("fake queries use exact Firestore ResourcePath order for sort and resume", async () => {
  const expectedOrder = [
    "__id-9223372036854775808__",
    "__id-2__",
    "__id0__",
    "__id1__",
    "__id2__",
    "__id10__",
    "__id123__",
    "__id9223372036854775807__",
    " leading-space",
    "0-ordinary",
    "Z-ordinary",
    "__",
    "___",
    "a-ordinary",
    "é-multibyte",
    "😀-multibyte",
  ];
  const database = new FakeSearchIndexDatabase(Object.fromEntries(
    [...expectedOrder]
      .reverse()
      .map((documentId) => [`ordering/${documentId}`, {documentId}]),
  ));

  const allDocuments = await database.queryDocuments({
    collectionPath: "ordering",
    limit: expectedOrder.length,
  });
  assert.deepEqual(allDocuments.map((document) => document.id), expectedOrder);

  const importedFirstPage = await database.queryDocuments({
    collectionPath: "ordering",
    limit: 2,
  });
  assert.deepEqual(
    importedFirstPage.map((document) => document.id),
    ["__id-9223372036854775808__", "__id-2__"],
  );
  const importedSecondPage = await database.queryDocuments({
    collectionPath: "ordering",
    afterDocumentId: importedFirstPage.at(-1).id,
    limit: 1,
  });
  assert.deepEqual(
    importedSecondPage.map((document) => document.id),
    ["__id0__"],
  );

  for (const afterDocumentId of [
    "__id-9223372036854775808__",
    "__id-2__",
    "__id2__",
    "__id10__",
    "__id9223372036854775807__",
    "Z-ordinary",
    "___",
  ]) {
    const resumed = await database.queryDocuments({
      collectionPath: "ordering",
      afterDocumentId,
      limit: expectedOrder.length,
    });
    assert.deepEqual(
      resumed.map((document) => document.id),
      expectedOrder.filter((documentId) =>
        compareFirestoreDocumentIds(documentId, afterDocumentId) > 0),
    );
  }

  for (let firstIndex = 0; firstIndex < expectedOrder.length; firstIndex += 1) {
    for (let secondIndex = 0;
      secondIndex < expectedOrder.length;
      secondIndex += 1) {
      const first = expectedOrder[firstIndex];
      const second = expectedOrder[secondIndex];
      const fakeComparison = Math.sign(compareFirestoreDocumentIds(first, second));
      const sdkComparison = Math.sign(
        new ResourcePath("ordering", first).compareTo(
          new ResourcePath("ordering", second),
        ),
      );
      assert.equal(fakeComparison, sdkComparison, `${first} vs ${second}`);
      assert.equal(fakeComparison, firstIndex === secondIndex ? 0 :
        firstIndex < secondIndex ? -1 : 1);
      if (first !== second) assert.notEqual(fakeComparison, 0);
    }
  }

  assert.notEqual("__id01__", "__id1__");
  assert.equal(compareFirestoreDocumentIds("__id01__", "__id1__"), 0);
  assert.equal(compareFirestoreDocumentIds("__id1__", "__id01__"), 0);
  assert.equal(readPrivateSearchIndexCursorDocumentId("__id01__"), null);
  assert.equal(
    readPrivateSearchIndexCursorDocumentId("__id1__"),
    "__id1__",
  );
});

test("private cursors preserve short underscore IDs at every page boundary", async (t) => {
  const totalDishCount = 103;
  const boundaryPositions = [1, 99, 100, 101];
  const boundaryIds = ["__", "___"];

  function sourceIdsWithBoundary(boundaryId, boundaryPosition) {
    const beforeCount = boundaryPosition - 1;
    const before = [];
    if (beforeCount >= 1) before.push("__id2__");
    if (beforeCount >= 2) before.push("__id10__");
    let whitespaceIndex = 0;
    while (before.length < beforeCount) {
      before.push(` ${String(whitespaceIndex).padStart(3, "0")}`);
      whitespaceIndex += 1;
    }
    const afterCount = totalDishCount - boundaryPosition;
    const after = afterCount === 0 ? [] : ["dish-with-trailing-space "];
    let ordinaryIndex = 0;
    while (after.length < afterCount) {
      after.push(`dish-safe-${String(ordinaryIndex).padStart(3, "0")}`);
      ordinaryIndex += 1;
    }
    return [...before, boundaryId, ...after]
      .sort(compareFirestoreDocumentIds);
  }

  for (let boundaryIdIndex = 0;
    boundaryIdIndex < boundaryIds.length;
    boundaryIdIndex += 1) {
    const boundaryId = boundaryIds[boundaryIdIndex];
    for (let positionIndex = 0;
      positionIndex < boundaryPositions.length;
      positionIndex += 1) {
      const boundaryPosition = boundaryPositions[positionIndex];
      await t.test(
        `${JSON.stringify(boundaryId)} at item ${boundaryPosition}`,
        async () => {
          const sourceIds = sourceIdsWithBoundary(boundaryId, boundaryPosition);
          assert.equal(sourceIds.length, totalDishCount);
          assert.equal(sourceIds[boundaryPosition - 1], boundaryId);
          assert.equal(new Set(sourceIds).size, totalDishCount);

          const initial = {
            "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
          };
          for (const sourceId of sourceIds) {
            initial[`bitescore_dishes/${sourceId}`] = biteScoreDish(sourceId);
          }
          const occurrenceNibble = (
            boundaryIdIndex * boundaryPositions.length + positionIndex + 1
          ).toString(16);
          const job = jobFixture({
            sourceOccurrenceId: occurrenceNibble.repeat(64),
          });
          initial[`private_search_index_jobs/${job.id}`] = job.document;
          const database = new FakeSearchIndexDatabase(initial);

          let currentJobId = job.id;
          let totalProcessed = 0;
          const processedJobIds = [];
          while (currentJobId !== null) {
            processedJobIds.push(currentJobId);
            const result = await processSearchIndexJob(database, currentJobId, now);
            totalProcessed += result.processedCount;
            const storedJob = database.records.get(
              `private_search_index_jobs/${currentJobId}`,
            );
            currentJobId = storedJob.continuationJobId;
          }
          assert.equal(totalProcessed, totalDishCount);
          assert.equal(processedJobIds.length, 2);

          const expectedFirstBoundary = sourceIds[99];
          const rootJob = database.records.get(
            `private_search_index_jobs/${job.id}`,
          );
          const continuation = database.records.get(
            `private_search_index_jobs/${rootJob.continuationJobId}`,
          );
          assert.equal(
            continuation.continuationCursor.afterDocumentId,
            expectedFirstBoundary,
          );
          assert.equal(
            createSearchIndexJobId(continuation),
            rootJob.continuationJobId,
          );
          const sourceQueries = database.operations.filter((entry) =>
            entry.operation === "query" &&
            entry.query.collectionPath === "bitescore_dishes");
          assert.deepEqual(
            sourceQueries.map((entry) => entry.query.afterDocumentId ?? null),
            [null, expectedFirstBoundary],
          );

          const expectedIndexedIds = sourceIds.filter((sourceId) => {
            try {
              createSearchIndexDocumentId({
                entityKind: "dish",
                sourceKind: "biteScoreDish",
                sourceDocumentId: sourceId,
              });
              return true;
            } catch {
              return false;
            }
          });
          const indexedDishes = [...database.records.entries()]
            .filter(([path]) => path.startsWith("dish_search_index/"))
            .map(([, data]) => data.sourceDocumentId)
            .sort(compareFirestoreDocumentIds);
          assert.deepEqual(indexedDishes, expectedIndexedIds);
          const dishSets = database.operations.filter((entry) =>
            entry.operation === "set" &&
            entry.path.startsWith("dish_search_index/"));
          assert.equal(dishSets.length, expectedIndexedIds.length);
          for (const sourceId of expectedIndexedIds) {
            assert.equal(
              dishSets.filter((entry) =>
                entry.data.sourceDocumentId === sourceId).length,
              1,
            );
          }

          for (const processedJobId of processedJobIds) {
            const beforeDuplicate = database.operations.length;
            const duplicate = await processSearchIndexJob(
              database,
              processedJobId,
              now,
            );
            assert.deepEqual(duplicate, {
              processedCount: 0,
              continuationCursor: null,
            });
            assert.equal(database.operations.length, beforeDuplicate + 1);
          }
          assert.equal(
            database.operations.filter((entry) =>
              entry.operation === "set" &&
              entry.path.startsWith("dish_search_index/")).length,
            expectedIndexedIds.length,
          );
        },
      );
    }
  }
});

test("signed imported and ordinary private IDs paginate in one total order", async (t) => {
  const cases = [
    {documentId: "__id-9223372036854775808__", position: 1},
    {documentId: "__id-2__", position: 100, retryContinuation: true},
    {documentId: "__id0__", position: 99},
    {documentId: "__id2__", position: 101},
    {documentId: "__id10__", position: 100},
    {documentId: "__id9223372036854775807__", position: 101},
    {documentId: " private boundary ", position: 99},
    {documentId: "ordinary-boundary", position: 100},
    {documentId: "é-boundary", position: 101},
    {documentId: "😀-boundary", position: 100},
  ];
  const candidatePool = new Set([
    "__id-9223372036854775808__",
    "__id9223372036854775807__",
  ]);
  for (let numericId = -600; numericId <= 600; numericId += 1) {
    candidatePool.add(numericId < 0
      ? `__id-${Math.abs(numericId)}__`
      : `__id${numericId}__`);
  }
  for (let index = 0; index < 300; index += 1) {
    const suffix = String(index).padStart(3, "0");
    candidatePool.add(` ${suffix}`);
    candidatePool.add(`ascii-${suffix}`);
    candidatePool.add(`zulu-${suffix}`);
    candidatePool.add(`é-${suffix}`);
    candidatePool.add(`${String.fromCodePoint(0x1f601 + index)}-${suffix}`);
  }

  const orderedIdsAt = (documentId, position) => {
    const candidates = [...candidatePool]
      .filter((candidate) =>
        candidate !== documentId &&
        readPrivateSearchIndexCursorDocumentId(candidate) === candidate)
      .sort(compareFirestoreDocumentIds);
    assert.deepEqual(
      candidates.filter((candidate) =>
        compareFirestoreDocumentIds(candidate, documentId) === 0),
      [],
      `${documentId} must have one unique SDK position`,
    );
    const before = candidates.filter((candidate) =>
      compareFirestoreDocumentIds(candidate, documentId) < 0);
    const after = candidates.filter((candidate) =>
      compareFirestoreDocumentIds(candidate, documentId) > 0);
    const beforeCount = position - 1;
    const afterCount = 103 - position;
    assert.ok(before.length >= beforeCount, documentId);
    assert.ok(after.length >= afterCount, documentId);
    const result = [
      ...before.slice(-beforeCount || before.length),
      documentId,
      ...after.slice(0, afterCount),
    ].sort(compareFirestoreDocumentIds);
    assert.equal(result.length, 103, documentId);
    assert.equal(result[position - 1], documentId);
    assert.equal(new Set(result).size, result.length);
    return result;
  };

  for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
    const scenario = cases[caseIndex];
    await t.test(
      `${JSON.stringify(scenario.documentId)} at item ${scenario.position}`,
      async () => {
        const sourceIds = orderedIdsAt(
          scenario.documentId,
          scenario.position,
        );
        const job = jobFixture({
          sourceOccurrenceId: caseIndex.toString(16).repeat(64),
        });
        const jobPath = `private_search_index_jobs/${job.id}`;
        const initial = {
          "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
          [jobPath]: job.document,
        };
        for (const sourceId of sourceIds) {
          initial[`bitescore_dishes/${sourceId}`] = biteScoreDish(sourceId);
        }
        const database = new FakeSearchIndexDatabase(initial);

        const first = await processSearchIndexJob(database, job.id, now);
        assert.equal(first.processedCount, 100);
        assert.deepEqual(first.continuationCursor, {
          phase: "dishes",
          afterDocumentId: sourceIds[99],
        });
        const continuationJobId = database.records.get(jobPath).continuationJobId;
        const continuationPath =
          `private_search_index_jobs/${continuationJobId}`;
        assert.equal(
          database.records.get(continuationPath)
            .continuationCursor.afterDocumentId,
          sourceIds[99],
        );

        if (scenario.retryContinuation === true) {
          let injectedFailure = false;
          database.queryDocumentsHook = async (query) => {
            if (
              !injectedFailure &&
              query.collectionPath === "bitescore_dishes" &&
              query.afterDocumentId === sourceIds[99]
            ) {
              injectedFailure = true;
              throw new Error("injected-signed-cursor-retry");
            }
            return undefined;
          };
          await assert.rejects(
            processSearchIndexJob(database, continuationJobId, now),
            /injected-signed-cursor-retry/u,
          );
          assert.equal(database.records.get(continuationPath).status, "pending");
          assert.equal(
            database.records.get(continuationPath)
              .continuationCursor.afterDocumentId,
            scenario.documentId,
          );
        }

        assert.deepEqual(
          await processSearchIndexJob(database, continuationJobId, now),
          {processedCount: 3, continuationCursor: null},
        );
        const sourceQueries = database.operations.filter((entry) =>
          entry.operation === "query" &&
          entry.query.collectionPath === "bitescore_dishes");
        assert.deepEqual(
          sourceQueries.map((entry) => entry.query.afterDocumentId ?? null),
          scenario.retryContinuation === true
            ? [null, sourceIds[99], sourceIds[99]]
            : [null, sourceIds[99]],
        );

        const expectedIndexedIds = sourceIds.filter((sourceId) => {
          try {
            createSearchIndexDocumentId({
              entityKind: "dish",
              sourceKind: "biteScoreDish",
              sourceDocumentId: sourceId,
            });
            return true;
          } catch {
            return false;
          }
        });
        const indexedIds = [...database.records.entries()]
          .filter(([path]) => path.startsWith("dish_search_index/"))
          .map(([, document]) => document.sourceDocumentId)
          .sort(compareFirestoreDocumentIds);
        assert.deepEqual(indexedIds, expectedIndexedIds);
        for (const sourceId of sourceIds) {
          const setCount = database.operations.filter((entry) =>
            entry.operation === "set" &&
            entry.path.startsWith("dish_search_index/") &&
            entry.data.sourceDocumentId === sourceId).length;
          assert.equal(
            setCount,
            expectedIndexedIds.includes(sourceId) ? 1 : 0,
            sourceId,
          );
        }

        for (const deliveredJobId of [job.id, continuationJobId]) {
          assert.deepEqual(
            await processSearchIndexJob(database, deliveredJobId, now),
            {processedCount: 0, continuationCursor: null},
          );
        }
      },
    );
  }
});

test("customer-invalid whitespace IDs make stable progress at every page boundary", async (t) => {
  const customerInvalidId = " padded ";
  assert.equal(
    readPrivateSearchIndexCursorDocumentId(customerInvalidId),
    customerInvalidId,
  );
  assert.throws(
    () => createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: customerInvalidId,
    }),
    /document-ID segment/u,
  );

  for (let positionIndex = 0; positionIndex < 4; positionIndex += 1) {
    const position = [1, 99, 100, 101][positionIndex];
    await t.test(`whitespace ID at item ${position}`, async () => {
      const sourceIds = [
        ...Array.from({length: position - 1}, (_, index) =>
          `__id${index}__`),
        customerInvalidId,
        ...Array.from({length: 103 - position}, (_, index) =>
          `safe-dish-${String(index).padStart(3, "0")}`),
      ].sort(compareFirestoreDocumentIds);
      assert.equal(sourceIds.length, 103);
      assert.equal(sourceIds[position - 1], customerInvalidId);
      assert.equal(new Set(sourceIds).size, sourceIds.length);
      assert.deepEqual(
        sourceIds.filter((sourceId) =>
          compareFirestoreDocumentIds(sourceId, customerInvalidId) === 0),
        [customerInvalidId],
      );

      const job = jobFixture({
        sourceOccurrenceId: String(positionIndex + 1).repeat(64),
      });
      const jobPath = `private_search_index_jobs/${job.id}`;
      const initial = {
        "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
        [jobPath]: job.document,
      };
      for (const sourceId of sourceIds) {
        initial[`bitescore_dishes/${sourceId}`] = biteScoreDish(sourceId);
      }
      const database = new FakeSearchIndexDatabase(initial);
      const queriedPages = [];
      let injectContinuationFailure = true;
      database.queryDocumentsHook = async (query, documents) => {
        if (query.collectionPath !== "bitescore_dishes") return undefined;
        queriedPages.push({
          afterDocumentId: query.afterDocumentId ?? null,
          documentIds: documents.map((document) => document.id),
        });
        if (
          query.afterDocumentId !== null &&
          query.afterDocumentId !== undefined &&
          injectContinuationFailure
        ) {
          injectContinuationFailure = false;
          throw new Error("injected-whitespace-cursor-retry");
        }
        return undefined;
      };

      const first = await processSearchIndexJob(database, job.id, now);
      const expectedCursor = sourceIds[99];
      assert.deepEqual(first, {
        processedCount: 100,
        continuationCursor: {
          phase: "dishes",
          afterDocumentId: expectedCursor,
        },
      });
      const rootJob = database.records.get(jobPath);
      const continuationPath =
        `private_search_index_jobs/${rootJob.continuationJobId}`;
      assert.equal(rootJob.status, "completed");
      assert.equal(
        database.records.get(continuationPath)
          .continuationCursor.afterDocumentId,
        expectedCursor,
      );
      if (position === 100) {
        assert.equal(expectedCursor, customerInvalidId);
      }

      await assert.rejects(
        processSearchIndexJob(database, rootJob.continuationJobId, now),
        /injected-whitespace-cursor-retry/u,
      );
      assert.equal(database.records.get(continuationPath).status, "pending");
      assert.equal(
        database.records.get(continuationPath)
          .continuationCursor.afterDocumentId,
        expectedCursor,
      );
      const continuation = await processSearchIndexJob(
        database,
        rootJob.continuationJobId,
        now,
      );
      assert.deepEqual(continuation, {
        processedCount: 3,
        continuationCursor: null,
      });
      assert.equal(database.records.get(continuationPath).status, "completed");
      assert.deepEqual(queriedPages, [
        {
          afterDocumentId: null,
          documentIds: sourceIds.slice(0, 101),
        },
        {
          afterDocumentId: expectedCursor,
          documentIds: sourceIds.slice(100),
        },
        {
          afterDocumentId: expectedCursor,
          documentIds: sourceIds.slice(100),
        },
      ]);

      const expectedIndexedIds = sourceIds.filter((sourceId) =>
        sourceId !== customerInvalidId);
      const indexedIds = [...database.records.entries()]
        .filter(([path]) => path.startsWith("dish_search_index/"))
        .map(([, document]) => document.sourceDocumentId)
        .sort(compareFirestoreDocumentIds);
      assert.deepEqual(indexedIds, expectedIndexedIds);
      for (const sourceId of sourceIds) {
        const writeCount = database.operations.filter((entry) =>
          entry.operation === "set" &&
          entry.path.startsWith("dish_search_index/") &&
          entry.data.sourceDocumentId === sourceId).length;
        assert.equal(
          writeCount,
          sourceId === customerInvalidId ? 0 : 1,
          sourceId,
        );
      }

      for (const deliveredJobId of [job.id, rootJob.continuationJobId]) {
        const operationCount = database.operations.length;
        assert.deepEqual(
          await processSearchIndexJob(database, deliveredJobId, now),
          {processedCount: 0, continuationCursor: null},
        );
        assert.equal(database.operations.length, operationCount + 1);
        assert.equal(database.operations.at(-1).operation, "get");
      }
    });
  }
});

test("noncanonical __id01__ in a later BiteSaver phase terminalizes before writes", async () => {
  const jobDocument = buildSearchIndexJobDocument({
    jobKind: "biteSaverOffers",
    parentSource: "biteSaver",
    parentSourceDocumentId: "account-1",
    requestedSourceFingerprint: biteSaverOfferParentFingerprint(
      biteSaverRestaurant(),
    ),
    sourceOccurrenceId: "9".repeat(64),
    now,
  });
  const jobId = createSearchIndexJobId(jobDocument);
  const jobPath = `private_search_index_jobs/${jobId}`;
  const database = new FakeSearchIndexDatabase({
    "restaurant_accounts/account-1": biteSaverRestaurant(),
    "restaurant_accounts/account-1/coupons/coupon-valid":
      coupon("coupon-valid"),
    "restaurant_accounts/account-1/daily_specials/__id01__":
      dailySpecial("__id01__"),
    [jobPath]: jobDocument,
  });

  assert.deepEqual(
    await processSearchIndexJob(database, jobId, now),
    {processedCount: 0, continuationCursor: null},
  );
  assert.equal(database.records.get(jobPath).status, "invalid");
  assert.equal(database.records.get(jobPath).processedCount, 0);
  assert.equal(database.records.get(jobPath).continuationJobId, undefined);
  assert.equal(database.transactionAttempts.length, 0);
  assert.equal(
    [...database.records.keys()].some((path) =>
      path.startsWith("bitesaver_offer_index/")),
    false,
  );
  assert.equal(
    database.operations.filter((entry) => entry.operation === "query").length,
    2,
  );

  const operationCount = database.operations.length;
  assert.deepEqual(await processSearchIndexJob(database, jobId, now), {
    processedCount: 0,
    continuationCursor: null,
  });
  assert.equal(database.operations.length, operationCount + 1);
  assert.deepEqual(database.operations.at(-1), {
    operation: "get",
    path: jobPath,
  });
});

test("canonical imported __id1__ source completes through the actual worker", async () => {
  const job = jobFixture({sourceOccurrenceId: "d".repeat(64)});
  const jobPath = `private_search_index_jobs/${job.id}`;
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    "bitescore_dishes/__id1__": biteScoreDish("__id1__"),
    [jobPath]: job.document,
  });

  assert.deepEqual(await processSearchIndexJob(database, job.id, now), {
    processedCount: 1,
    continuationCursor: null,
  });
  assert.equal(database.records.get(jobPath).status, "completed");
  const indexedDishes = [...database.records.entries()]
    .filter(([path]) => path.startsWith("dish_search_index/"))
    .map(([, document]) => document);
  assert.equal(indexedDishes.length, 1);
  assert.equal(indexedDishes[0].sourceDocumentId, "__id1__");

  const operationCount = database.operations.length;
  assert.deepEqual(await processSearchIndexJob(database, job.id, now), {
    processedCount: 0,
    continuationCursor: null,
  });
  assert.equal(database.operations.length, operationCount + 1);
  assert.deepEqual(database.operations.at(-1), {
    operation: "get",
    path: jobPath,
  });
});

test("Firestore query adapter passes the exact private cursor to startAfter", async () => {
  const operations = [];
  const query = {
    where(field, operator, value) {
      operations.push(["where", field, operator, value]);
      return this;
    },
    orderBy(field) {
      operations.push(["orderBy", field]);
      return this;
    },
    startAfter(value) {
      operations.push(["startAfter", value]);
      return this;
    },
    limit(value) {
      operations.push(["limit", value]);
      return this;
    },
    async get() {
      return {docs: []};
    },
  };
  const firestore = {
    collection(path) {
      operations.push(["collection", path]);
      return query;
    },
  };
  const database = createFirestoreSearchIndexDatabase(firestore);
  const rawCursor = " product-invalid-boundary ";
  await database.queryDocuments({
    collectionPath: "bitescore_dishes",
    where: {field: "restaurantId", value: "restaurant-1"},
    afterDocumentId: rawCursor,
    limit: 101,
  });
  assert.deepEqual(
    operations.find((operation) => operation[0] === "startAfter"),
    ["startAfter", rawCursor],
  );
});

test("transient continuation failure retries the same product-invalid cursor without omission", async () => {
  const sourceIds = Array.from({length: 102}, (_, index) => {
    const base = `dish-${String(index).padStart(3, "0")}`;
    return index === 99 ? `${base} ` : base;
  });
  const invalidSourceId = sourceIds[99];
  const initial = {
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
  };
  for (const sourceId of sourceIds) {
    initial[`bitescore_dishes/${sourceId}`] = biteScoreDish(sourceId);
  }
  const job = jobFixture({sourceOccurrenceId: "c".repeat(64)});
  initial[`private_search_index_jobs/${job.id}`] = job.document;
  const database = new FakeSearchIndexDatabase(initial);
  await processSearchIndexJob(database, job.id, now);
  const rootJob = database.records.get(`private_search_index_jobs/${job.id}`);
  const continuationPath =
    `private_search_index_jobs/${rootJob.continuationJobId}`;
  assert.equal(
    database.records.get(continuationPath).continuationCursor.afterDocumentId,
    invalidSourceId,
  );

  let injected = false;
  database.queryDocumentsHook = async (query) => {
    if (
      !injected &&
      query.collectionPath === "bitescore_dishes" &&
      query.afterDocumentId === invalidSourceId
    ) {
      injected = true;
      throw new Error("injected-transient-query-failure");
    }
    return undefined;
  };
  await assert.rejects(
    processSearchIndexJob(database, rootJob.continuationJobId, now),
    /injected-transient-query-failure/,
  );
  assert.equal(database.records.get(continuationPath).status, "pending");
  assert.equal(
    database.records.get(continuationPath).continuationCursor.afterDocumentId,
    invalidSourceId,
  );

  const retry = await processSearchIndexJob(
    database,
    rootJob.continuationJobId,
    now,
  );
  assert.deepEqual(retry, {processedCount: 2, continuationCursor: null});
  assert.equal(database.records.get(continuationPath).status, "completed");
  const continuationQueries = database.operations.filter((entry) =>
    entry.operation === "query" &&
    entry.query.collectionPath === "bitescore_dishes" &&
    entry.query.afterDocumentId === invalidSourceId);
  assert.equal(continuationQueries.length, 2);
  const indexedSourceIds = [...database.records.entries()]
    .filter(([path]) => path.startsWith("dish_search_index/"))
    .map(([, data]) => data.sourceDocumentId);
  assert.equal(indexedSourceIds.includes(invalidSourceId), false);
  assert.equal(indexedSourceIds.length, sourceIds.length - 1);
});

test("BiteSaver worker shares one 100-record bound across both offer types", async () => {
  const initial = {"restaurant_accounts/account-1": biteSaverRestaurant()};
  for (let index = 0; index < 80; index += 1) {
    const id = `coupon-${String(index).padStart(3, "0")}`;
    initial[`restaurant_accounts/account-1/coupons/${id}`] = coupon(id);
  }
  for (let index = 0; index < 30; index += 1) {
    const id = `special-${String(index).padStart(3, "0")}`;
    initial[`restaurant_accounts/account-1/daily_specials/${id}`] = {
      id,
      restaurantId: "account-1",
      ownerUid: "account-1",
      title: `Special ${id}`,
      isActive: true,
      availabilityMode: "todayOnly",
      allDay: true,
      expiresAt: new Date(now.getTime() + 60_000),
    };
  }
  const document = buildSearchIndexJobDocument({
    jobKind: "biteSaverOffers",
    parentSource: "biteSaver",
    parentSourceDocumentId: "account-1",
    requestedSourceFingerprint: biteSaverOfferParentFingerprint(initial["restaurant_accounts/account-1"]),
    sourceOccurrenceId: "2".repeat(64),
    now,
  });
  const id = createSearchIndexJobId(document);
  initial[`private_search_index_jobs/${id}`] = document;
  const database = new FakeSearchIndexDatabase(initial);
  const result = await processSearchIndexJob(database, id, now);
  assert.equal(result.processedCount, 100);
  assert.deepEqual(result.continuationCursor, {
    phase: "dailySpecials",
    afterDocumentId: "special-019",
  });
  assert.equal(
    [...database.records.keys()].filter((path) => path.startsWith("bitesaver_offer_index/")).length,
    100,
  );
});

test("worker does not create an empty continuation when exactly 100 records finish", async () => {
  const initial = {"restaurant_accounts/account-1": biteSaverRestaurant()};
  for (let index = 0; index < 100; index += 1) {
    const id = `coupon-${String(index).padStart(3, "0")}`;
    initial[`restaurant_accounts/account-1/coupons/${id}`] = coupon(id);
  }
  const document = buildSearchIndexJobDocument({
    jobKind: "biteSaverOffers",
    parentSource: "biteSaver",
    parentSourceDocumentId: "account-1",
    requestedSourceFingerprint: biteSaverOfferParentFingerprint(initial["restaurant_accounts/account-1"]),
    sourceOccurrenceId: "3".repeat(64),
    now,
  });
  const id = createSearchIndexJobId(document);
  initial[`private_search_index_jobs/${id}`] = document;
  const database = new FakeSearchIndexDatabase(initial);
  const result = await processSearchIndexJob(database, id, now);
  assert.deepEqual(result, {processedCount: 100, continuationCursor: null});
  assert.equal(
    database.operations.filter((entry) => entry.operation === "createIfAbsent").length,
    0,
  );
});

test("duplicate worker delivery is idempotent", async () => {
  const job = jobFixture();
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    "bitescore_dishes/dish-1": biteScoreDish("dish-1"),
    [`private_search_index_jobs/${job.id}`]: job.document,
  });
  await processSearchIndexJob(database, job.id, now);
  const operationCount = database.operations.length;
  const second = await processSearchIndexJob(database, job.id, now);
  assert.deepEqual(second, {processedCount: 0, continuationCursor: null});
  assert.equal(
    database.operations.slice(operationCount).some((entry) =>
      entry.operation === "set" || entry.operation === "delete" || entry.operation === "query"),
    false,
  );
});

test("worker failure never marks the current job complete", async () => {
  const job = jobFixture();
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    "bitescore_dishes/dish-1": biteScoreDish("dish-1"),
    [`private_search_index_jobs/${job.id}`]: job.document,
  });
  database.failSetPath = `dish_search_index/${indexId}`;
  await assert.rejects(
    processSearchIndexJob(database, job.id, now),
    /injected-index-write-failure/,
  );
  assert.equal(database.records.get(`private_search_index_jobs/${job.id}`).status, "pending");

  database.failSetPath = null;
  const retry = await processSearchIndexJob(database, job.id, now);
  assert.equal(retry.processedCount, 1);
  assert.equal(database.records.get(`private_search_index_jobs/${job.id}`).status, "completed");
  assert.equal(database.records.has(`dish_search_index/${indexId}`), true);
});

test("concurrent duplicate worker delivery converges to one current index", async () => {
  const job = jobFixture();
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    "bitescore_dishes/dish-1": biteScoreDish("dish-1"),
    [`private_search_index_jobs/${job.id}`]: job.document,
  });
  await Promise.all([
    processSearchIndexJob(database, job.id, now),
    processSearchIndexJob(database, job.id, now),
  ]);
  assert.equal(
    [...database.records.keys()].filter((path) => path.startsWith("dish_search_index/")).length,
    1,
  );
  assert.equal(database.records.get(`private_search_index_jobs/${job.id}`).status, "completed");
});

test("retried parent worker cannot restore a dish after a newer parent hide", async () => {
  const job = jobFixture({sourceOccurrenceId: "9".repeat(64)});
  const parentPath = "bitescore_restaurants/restaurant-1";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-1",
  });
  const indexPath = `dish_search_index/${indexId}`;
  const database = new FakeSearchIndexDatabase({
    [parentPath]: biteScoreRestaurant(),
    "bitescore_dishes/dish-1": biteScoreDish("dish-1"),
    [`private_search_index_jobs/${job.id}`]: job.document,
  });
  const barrier = pauseFirstTransactionCommit(database);
  const worker = processSearchIndexJob(database, job.id, now);
  await barrier.ready;
  database.records.set(parentPath, biteScoreRestaurant({isActive: false}));
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  barrier.release();
  await worker;
  assert.equal(database.records.get(indexPath).restaurantActive, false);
  assert.equal(database.records.get(indexPath).customerPublicProjection, null);
  assert.equal(database.records.get(`private_search_index_jobs/${job.id}`).status, "completed");
});

test("deleted-parent cleanup reconciles stale query candidates to current dish ownership", async (t) => {
  const scenarios = [
    {name: "reparented to active B", reparented: true, parentActive: true},
    {name: "reparented to inactive B", reparented: true, parentActive: false},
    {name: "dish deleted after the A query", reparented: false},
  ];
  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
    const scenario = scenarios[scenarioIndex];
    await t.test(scenario.name, async () => {
      const job = jobFixture({
        requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
        sourceOccurrenceId: `${scenarioIndex + 6}`.repeat(64),
      });
      const parentAPath = "bitescore_restaurants/restaurant-1";
      const parentBPath = "bitescore_restaurants/restaurant-2";
      const dishPath = "bitescore_dishes/dish-reparented";
      const indexId = createSearchIndexDocumentId({
        entityKind: "dish",
        sourceKind: "biteScoreDish",
        sourceDocumentId: "dish-reparented",
      });
      const indexPath = `dish_search_index/${indexId}`;
      const database = new FakeSearchIndexDatabase({
        [parentAPath]: biteScoreRestaurant({name: "Deleted Parent A"}),
        [dishPath]: biteScoreDish("dish-reparented"),
        [`private_search_index_jobs/${job.id}`]: job.document,
      });
      await reconcileBiteScoreDishIndex(database, "dish-reparented", now);
      assert.equal(
        database.records.get(indexPath).restaurantSourceDocumentId,
        "restaurant-1",
      );
      database.records.delete(parentAPath);

      const queryBarrier = pauseFirstQueryResult(
        database,
        (query) => query.collectionPath === "dish_search_index",
      );
      const cleanup = processSearchIndexJob(database, job.id, now);
      const staleCandidates = await queryBarrier.ready;
      assert.deepEqual(staleCandidates.map((entry) => entry.id), [indexId]);

      if (scenario.reparented) {
        database.records.set(
          parentBPath,
          biteScoreRestaurant({
            name: "Current Parent B",
            isActive: scenario.parentActive,
          }),
        );
        database.records.set(
          dishPath,
          biteScoreDish("dish-reparented", {restaurantId: "restaurant-2"}),
        );
        await reconcileBiteScoreDishIndex(database, "dish-reparented", now);
        assert.equal(
          database.records.get(indexPath).restaurantSourceDocumentId,
          "restaurant-2",
        );
      } else {
        database.records.delete(dishPath);
        await reconcileBiteScoreDishIndex(database, "dish-reparented", now);
        assert.equal(database.records.has(indexPath), false);
      }

      queryBarrier.release();
      const result = await cleanup;
      assert.deepEqual(result, {processedCount: 1, continuationCursor: null});
      if (scenario.reparented) {
        const currentIndex = database.records.get(indexPath);
        assert.equal(currentIndex.restaurantSourceDocumentId, "restaurant-2");
        assert.equal(currentIndex.restaurantDisplayName, "Current Parent B");
        assert.equal(
          currentIndex.customerPublicProjection === null,
          !scenario.parentActive,
        );
      } else {
        assert.equal(database.records.has(indexPath), false);
      }

      const duplicate = await processSearchIndexJob(database, job.id, now);
      assert.deepEqual(duplicate, {
        processedCount: 0,
        continuationCursor: null,
      });
      if (scenario.reparented) {
        assert.equal(
          database.records.get(indexPath).restaurantSourceDocumentId,
          "restaurant-2",
        );
      }
    });
  }
});

test("stale A candidate cannot delete an index already pointing to B before cleanup starts", async () => {
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    sourceOccurrenceId: "d".repeat(64),
  });
  const dishId = "dish-already-reparented";
  const dishPath = `bitescore_dishes/${dishId}`;
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  const indexPath = `dish_search_index/${indexId}`;
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-2": biteScoreRestaurant({
      name: "Already Current Parent B",
    }),
    [dishPath]: biteScoreDish(dishId, {restaurantId: "restaurant-2"}),
    [`private_search_index_jobs/${job.id}`]: job.document,
  });
  await reconcileBiteScoreDishIndex(database, dishId, now);
  const beforeCleanup = database.records.get(indexPath);
  assert.equal(beforeCleanup.restaurantSourceDocumentId, "restaurant-2");
  const transactionAttemptStart = database.transactionAttempts.length;
  const operationStart = database.operations.length;

  let suppliedStaleSnapshot = false;
  database.queryDocumentsHook = async (query) => {
    if (
      !suppliedStaleSnapshot &&
      query.collectionPath === "dish_search_index" &&
      query.where?.value === "restaurant-1"
    ) {
      suppliedStaleSnapshot = true;
      return [{
        id: indexId,
        data: {
          ...beforeCleanup,
          restaurantSourceDocumentId: "restaurant-1",
        },
      }];
    }
    return undefined;
  };
  const cleanup = await processSearchIndexJob(database, job.id, now);
  assert.equal(suppliedStaleSnapshot, true);
  assert.deepEqual(cleanup, {processedCount: 1, continuationCursor: null});
  assert.equal(
    database.operations.some((entry) =>
      entry.operation === "delete" && entry.path === indexPath),
    false,
  );
  assert.deepEqual(database.records.get(indexPath), beforeCleanup);
  assert.equal(
    database.records.get(indexPath).customerPublicProjection
      .restaurantSourceDocumentId,
    "restaurant-2",
  );
  const cleanupAttempts = database.transactionAttempts.slice(
    transactionAttemptStart,
  );
  assert.equal(cleanupAttempts.length, 1);
  assert.ok(cleanupAttempts[0].readPaths.length <= 5);
  const cleanupOperations = database.operations.slice(operationStart);
  assert.equal(
    cleanupOperations.filter((entry) => entry.operation === "query").length,
    1,
  );
  assert.ok(
    cleanupOperations.filter((entry) => entry.operation === "get").length <= 9,
  );
});

test("Firestore transaction adapter preserves current B during stale A cleanup", async () => {
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    sourceOccurrenceId: "f".repeat(64),
  });
  const dishId = "dish-firestore-adapter";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  const indexPath = `dish_search_index/${indexId}`;
  const jobPath = `private_search_index_jobs/${job.id}`;
  const records = new Map(Object.entries({
    "bitescore_restaurants/restaurant-2": biteScoreRestaurant({
      name: "Firestore Parent B",
    }),
    [`bitescore_dishes/${dishId}`]: biteScoreDish(dishId, {
      restaurantId: "restaurant-2",
    }),
    [indexPath]: {
      sourceDocumentId: dishId,
      restaurantSourceDocumentId: "restaurant-2",
    },
    [jobPath]: job.document,
  }));
  const operations = [];
  const snapshot = (path) => ({
    exists: records.has(path),
    data: () => records.get(path),
  });
  const reference = (path) => ({
    path,
    async get() {
      operations.push(["get", path]);
      return snapshot(path);
    },
    async set(data, options) {
      operations.push(["set", path, options ?? null]);
      records.set(
        path,
        options?.merge ? {...(records.get(path) ?? {}), ...data} : data,
      );
    },
    async delete() {
      operations.push(["delete", path]);
      records.delete(path);
    },
    async update(data) {
      operations.push(["update", path]);
      records.set(path, {...records.get(path), ...data});
    },
  });
  const firestore = {
    doc: reference,
    collection(collectionPath) {
      const state = {
        where: null,
        afterDocumentId: null,
        limit: null,
      };
      return {
        where(field, operator, value) {
          state.where = {field, operator, value};
          return this;
        },
        orderBy() {
          return this;
        },
        startAfter(afterDocumentId) {
          state.afterDocumentId = afterDocumentId;
          return this;
        },
        limit(limit) {
          state.limit = limit;
          return this;
        },
        async get() {
          operations.push(["query", collectionPath, {...state}]);
          assert.equal(collectionPath, "dish_search_index");
          assert.deepEqual(state.where, {
            field: "restaurantSourceDocumentId",
            operator: "==",
            value: "restaurant-1",
          });
          return {
            docs: [{
              id: indexId,
              data: () => ({
                sourceDocumentId: dishId,
                restaurantSourceDocumentId: "restaurant-1",
              }),
            }],
          };
        },
      };
    },
    async runTransaction(operation) {
      operations.push(["transaction"]);
      const writes = [];
      const result = await operation({
        async get(documentReference) {
          operations.push(["transactionGet", documentReference.path]);
          return snapshot(documentReference.path);
        },
        set(documentReference, data) {
          writes.push(["set", documentReference.path, data]);
        },
        delete(documentReference) {
          writes.push(["delete", documentReference.path]);
        },
        create(documentReference, data) {
          writes.push(["create", documentReference.path, data]);
        },
      });
      for (const [operationKind, path, data] of writes) {
        operations.push([`transaction${operationKind}`, path]);
        if (operationKind === "delete") {
          records.delete(path);
        } else {
          records.set(path, data);
        }
      }
      return result;
    },
  };

  const database = createFirestoreSearchIndexDatabase(firestore);
  const result = await processSearchIndexJob(database, job.id, now);
  assert.deepEqual(result, {processedCount: 1, continuationCursor: null});
  assert.equal(records.get(indexPath).restaurantSourceDocumentId, "restaurant-2");
  assert.equal(records.get(indexPath).restaurantDisplayName, "Firestore Parent B");
  assert.notEqual(records.get(indexPath).customerPublicProjection, null);
  assert.equal(
    operations.some(([operationKind, path]) =>
      operationKind === "transactiondelete" && path === indexPath),
    false,
  );
  assert.equal(
    operations.some(([operationKind, path]) =>
      operationKind === "transactionset" && path === indexPath),
    true,
  );
});

test("malformed current cleanup candidates make bounded terminal progress without touching B rows", async () => {
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    sourceOccurrenceId: "e".repeat(64),
  });
  const staleRows = {
    "dish_search_index/missing-source": {
      restaurantSourceDocumentId: "restaurant-1",
    },
    "dish_search_index/invalid-source": {
      restaurantSourceDocumentId: "restaurant-1",
      sourceDocumentId: " product-invalid ",
    },
    "dish_search_index/mismatched-id": {
      restaurantSourceDocumentId: "restaurant-1",
      sourceDocumentId: "dish-valid-but-wrong-index-id",
    },
    "dish_search_index/preserve-current-b": {
      restaurantSourceDocumentId: "restaurant-2",
      sourceDocumentId: " product-invalid ",
      currentBCanary: true,
    },
  };
  const database = new FakeSearchIndexDatabase({
    ...staleRows,
    [`private_search_index_jobs/${job.id}`]: job.document,
  });
  database.queryDocumentsHook = async (query) =>
    query.collectionPath === "dish_search_index"
      ? Object.entries(staleRows).map(([path, data]) => ({
          id: path.slice("dish_search_index/".length),
          data: {
            ...data,
            restaurantSourceDocumentId: "restaurant-1",
          },
        }))
      : undefined;
  const result = await processSearchIndexJob(database, job.id, now);
  assert.deepEqual(result, {processedCount: 4, continuationCursor: null});
  assert.equal(database.records.has("dish_search_index/missing-source"), false);
  assert.equal(database.records.has("dish_search_index/invalid-source"), false);
  assert.equal(database.records.has("dish_search_index/mismatched-id"), false);
  assert.equal(
    database.records.get("dish_search_index/preserve-current-b").currentBCanary,
    true,
  );
  assert.equal(
    database.operations.some((entry) =>
      entry.operation === "get" &&
      (entry.path === "bitescore_dishes/ product-invalid " ||
        entry.path === "bitescore_dishes/dish-valid-but-wrong-index-id")),
    false,
  );
  assert.equal(
    database.records.get(`private_search_index_jobs/${job.id}`).status,
    "completed",
  );
  assert.ok(
    database.transactionAttempts.every((attempt) =>
      attempt.readPaths.length <= 2),
  );
});

test("deleted-parent cleanup transaction retries after a later B reconciliation wins", async () => {
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    sourceOccurrenceId: "a".repeat(64),
  });
  const parentAPath = "bitescore_restaurants/restaurant-1";
  const parentBPath = "bitescore_restaurants/restaurant-2";
  const dishPath = "bitescore_dishes/dish-reverse-order";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: "dish-reverse-order",
  });
  const indexPath = `dish_search_index/${indexId}`;
  const database = new FakeSearchIndexDatabase({
    [parentAPath]: biteScoreRestaurant({name: "Deleted Parent A"}),
    [dishPath]: biteScoreDish("dish-reverse-order"),
    [`private_search_index_jobs/${job.id}`]: job.document,
  });
  await reconcileBiteScoreDishIndex(database, "dish-reverse-order", now);
  database.records.delete(parentAPath);

  const commitBarrier = pauseFirstTransactionCommit(database);
  const cleanup = processSearchIndexJob(database, job.id, now);
  await commitBarrier.ready;
  database.records.set(
    parentBPath,
    biteScoreRestaurant({name: "Winning Parent B"}),
  );
  database.records.set(
    dishPath,
    biteScoreDish("dish-reverse-order", {restaurantId: "restaurant-2"}),
  );
  await reconcileBiteScoreDishIndex(database, "dish-reverse-order", now);
  commitBarrier.release();
  await cleanup;

  const currentIndex = database.records.get(indexPath);
  assert.equal(currentIndex.restaurantSourceDocumentId, "restaurant-2");
  assert.equal(currentIndex.restaurantDisplayName, "Winning Parent B");
  assert.notEqual(currentIndex.customerPublicProjection, null);
});

test("parent deletion cleans derived indexes in bounded chunks", async () => {
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
  });
  const initial = {[`private_search_index_jobs/${job.id}`]: job.document};
  for (let index = 0; index < 101; index += 1) {
    const id = `index-${String(index).padStart(3, "0")}`;
    initial[`dish_search_index/${id}`] = {
      restaurantSourceDocumentId: "restaurant-1",
      sourceDocumentId: `dish-${index}`,
    };
  }
  const database = new FakeSearchIndexDatabase(initial);
  const result = await processSearchIndexJob(database, job.id, now);
  assert.equal(result.processedCount, 100);
  assert.deepEqual(result.continuationCursor, {
    phase: "derivedCleanup",
    afterDocumentId: "index-099",
  });
  assert.equal(
    [...database.records.keys()].filter((path) => path.startsWith("dish_search_index/")).length,
    1,
  );
});

test("production deletion root cleans stale candidates after parent recreation", async () => {
  const parentId = "restaurant-1";
  const parentPath = "bitescore_restaurants/" + parentId;
  const dishId = "dish-deleted-before-late-worker";
  const dishPath = "bitescore_dishes/" + dishId;
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  const indexPath = "dish_search_index/" + indexId;
  const before = biteScoreRestaurant({name: "Deleted Parent"});
  const database = new FakeSearchIndexDatabase({
    [parentPath]: before,
    [dishPath]: biteScoreDish(dishId),
  });
  await reconcileBiteScoreDishIndex(database, dishId, now);
  assert.notEqual(
    database.records.get(indexPath).customerPublicProjection,
    null,
  );

  database.records.delete(parentPath);
  database.records.delete(dishPath);
  await handleBiteScoreRestaurantWrite(database, {
    restaurantId: parentId,
    before,
    after: null,
    sourceEventId: "late-delete-worker-event",
    now,
  });
  const rootJobPaths = [...database.records.keys()].filter((path) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(rootJobPaths.length, 1);
  const rootJobPath = rootJobPaths[0];
  const rootJobId = rootJobPath.slice("private_search_index_jobs/".length);
  assert.equal(
    database.records.get(rootJobPath).requestedSourceFingerprint,
    biteScoreDishParentFingerprint(null, parentId),
  );

  database.records.set(
    parentPath,
    biteScoreRestaurant({name: "Recreated Before Worker Delivery"}),
  );
  assert.deepEqual(await processSearchIndexJob(database, rootJobId, now), {
    processedCount: 1,
    continuationCursor: {phase: "dishes", afterDocumentId: null},
  });
  assert.equal(database.records.has(indexPath), false);
  assert.equal(
    database.operations.some((entry) =>
      entry.operation === "query" &&
      entry.query.collectionPath === "dish_search_index"),
    true,
  );

  const continuationJobId =
    database.records.get(rootJobPath).continuationJobId;
  assert.equal(typeof continuationJobId, "string");
  assert.deepEqual(
    await processSearchIndexJob(database, continuationJobId, now),
    {processedCount: 0, continuationCursor: null},
  );
  assert.equal(database.records.has(indexPath), false);
  assert.deepEqual(
    await processSearchIndexJob(database, rootJobId, now),
    {processedCount: 0, continuationCursor: null},
  );
});

test("BiteSaver deletion root cleans stale offers after parent recreation", async () => {
  const accountId = "account-late-delete-worker";
  const accountPath = "restaurant_accounts/" + accountId;
  const couponId = "coupon-deleted-before-late-worker";
  const couponPath = accountPath + "/coupons/" + couponId;
  const indexId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: accountId,
    sourceDocumentId: couponId,
  });
  const indexPath = "bitesaver_offer_index/" + indexId;
  const before = biteSaverRestaurant({restaurantName: "Deleted BiteSaver"});
  const database = new FakeSearchIndexDatabase({
    [accountPath]: before,
    [couponPath]: coupon(couponId),
  });
  await reconcileBiteSaverCouponOfferIndex(
    database,
    accountId,
    couponId,
    now,
  );
  assert.equal(database.records.get(indexPath).publicVisible, true);

  database.records.delete(accountPath);
  database.records.delete(couponPath);
  await handleBiteSaverRestaurantWrite(database, {
    restaurantAccountId: accountId,
    before,
    after: null,
    sourceEventId: "late-bitesaver-delete-worker-event",
    now,
  });
  const rootJobPaths = [...database.records.keys()].filter((path) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(rootJobPaths.length, 1);
  const rootJobPath = rootJobPaths[0];
  const rootJobId = rootJobPath.slice("private_search_index_jobs/".length);
  assert.equal(
    database.records.get(rootJobPath).requestedSourceFingerprint,
    biteSaverOfferParentFingerprint(null),
  );

  database.records.set(
    accountPath,
    biteSaverRestaurant({restaurantName: "Recreated BiteSaver"}),
  );
  assert.deepEqual(await processSearchIndexJob(database, rootJobId, now), {
    processedCount: 1,
    continuationCursor: {phase: "coupons", afterDocumentId: null},
  });
  assert.equal(database.records.has(indexPath), false);

  const continuationJobId =
    database.records.get(rootJobPath).continuationJobId;
  assert.equal(typeof continuationJobId, "string");
  assert.deepEqual(
    await processSearchIndexJob(database, continuationJobId, now),
    {processedCount: 0, continuationCursor: null},
  );
  assert.equal(database.records.has(indexPath), false);
  assert.deepEqual(
    await processSearchIndexJob(database, rootJobId, now),
    {processedCount: 0, continuationCursor: null},
  );
});

test("recreated parent waits for every cleanup page before child-source scanning", async () => {
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    sourceOccurrenceId: "4".repeat(64),
  });
  const jobPath = `private_search_index_jobs/${job.id}`;
  const initial = {[jobPath]: job.document};
  for (let index = 0; index < 101; index += 1) {
    const dishId = `deleted-dish-${String(index).padStart(3, "0")}`;
    const indexId = createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: dishId,
    });
    initial[`dish_search_index/${indexId}`] = {
      searchIndexVersion: 1,
      sourceKind: "biteScoreDish",
      sourceDocumentId: dishId,
      restaurantSourceDocumentId: "restaurant-1",
      customerPublicProjection: {staleCustomerCanary: true},
    };
  }
  const database = new FakeSearchIndexDatabase(initial);
  let recreationCount = 0;
  database.queryDocumentsHook = async (query, documents, fake) => {
    if (
      recreationCount === 0 &&
      query.collectionPath === "dish_search_index"
    ) {
      recreationCount += 1;
      fake.records.set(
        "bitescore_restaurants/restaurant-1",
        biteScoreRestaurant({name: "Recreated Across Cleanup Pages"}),
      );
    }
    return documents;
  };

  const first = await processSearchIndexJob(database, job.id, now);
  assert.equal(recreationCount, 1);
  assert.equal(first.processedCount, 100);
  assert.equal(first.continuationCursor.phase, "derivedCleanup");
  assert.equal(
    [...database.records.keys()].filter((path) =>
      path.startsWith("dish_search_index/")).length,
    1,
  );
  const cleanupContinuationId = database.records.get(jobPath).continuationJobId;
  assert.equal(typeof cleanupContinuationId, "string");

  const second = await processSearchIndexJob(
    database,
    cleanupContinuationId,
    now,
  );
  assert.deepEqual(second, {
    processedCount: 1,
    continuationCursor: {phase: "dishes", afterDocumentId: null},
  });
  assert.equal(
    [...database.records.keys()].filter((path) =>
      path.startsWith("dish_search_index/")).length,
    0,
  );
  const sourceContinuationId = database.records.get(
    `private_search_index_jobs/${cleanupContinuationId}`,
  ).continuationJobId;
  assert.equal(typeof sourceContinuationId, "string");

  assert.deepEqual(
    await processSearchIndexJob(database, sourceContinuationId, now),
    {processedCount: 0, continuationCursor: null},
  );
  assert.equal(
    [...database.records.keys()].filter((path) =>
      path.startsWith("dish_search_index/")).length,
    0,
  );
  for (const deliveredJobId of [
    job.id,
    cleanupContinuationId,
    sourceContinuationId,
  ]) {
    assert.deepEqual(
      await processSearchIndexJob(database, deliveredJobId, now),
      {processedCount: 0, continuationCursor: null},
    );
  }
});

test("selected vanished index rebuilds from current reparented source", async (t) => {
  for (const scenario of [
    {name: "active B", isActive: true, customerVisible: true},
    {name: "inactive B", isActive: false, customerVisible: false},
  ]) {
    await t.test(scenario.name, async () => {
      const parentAPath = "bitescore_restaurants/restaurant-1";
      const parentBPath = "bitescore_restaurants/restaurant-2";
      const dishId =
        "dish-vanished-index-" + (scenario.isActive ? "active" : "inactive");
      const dishPath = "bitescore_dishes/" + dishId;
      const indexId = createSearchIndexDocumentId({
        entityKind: "dish",
        sourceKind: "biteScoreDish",
        sourceDocumentId: dishId,
      });
      const indexPath = "dish_search_index/" + indexId;
      const job = jobFixture({
        requestedSourceFingerprint:
          biteScoreDishParentFingerprint(null, "restaurant-1"),
        sourceOccurrenceId: scenario.isActive
          ? "8".repeat(64)
          : "9".repeat(64),
      });
      const jobPath = "private_search_index_jobs/" + job.id;
      const database = new FakeSearchIndexDatabase({
        [parentAPath]: biteScoreRestaurant({name: "Parent A"}),
        [dishPath]: biteScoreDish(dishId),
      });
      await reconcileBiteScoreDishIndex(database, dishId, now);
      database.records.delete(parentAPath);
      database.records.set(jobPath, job.document);

      const queryBarrier = pauseFirstQueryResult(
        database,
        (query) => query.collectionPath === "dish_search_index",
      );
      const cleanup = processSearchIndexJob(database, job.id, now);
      assert.deepEqual(
        (await queryBarrier.ready).map((candidate) => candidate.id),
        [indexId],
      );
      database.records.delete(indexPath);
      database.records.set(
        parentBPath,
        biteScoreRestaurant({
          name: "Parent " + scenario.name,
          isActive: scenario.isActive,
        }),
      );
      database.records.set(
        dishPath,
        biteScoreDish(dishId, {restaurantId: "restaurant-2"}),
      );
      queryBarrier.release();

      assert.deepEqual(await cleanup, {
        processedCount: 1,
        continuationCursor: null,
      });
      const rebuilt = database.records.get(indexPath);
      assert.notEqual(rebuilt, undefined);
      assert.equal(rebuilt.restaurantSourceDocumentId, "restaurant-2");
      assert.equal(rebuilt.adminVisible, true);
      assert.equal(
        rebuilt.customerPublicProjection !== null,
        scenario.customerVisible,
      );
      assert.equal(database.records.get(jobPath).status, "completed");
      assert.deepEqual(
        await processSearchIndexJob(database, job.id, now),
        {processedCount: 0, continuationCursor: null},
      );
    });
  }
});

test("selected dish is reconciled against recreated A before switching phases", async () => {
  const dishId = "dish-still-owned-by-a";
  const dishPath = `bitescore_dishes/${dishId}`;
  const parentPath = "bitescore_restaurants/restaurant-1";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  const indexPath = `dish_search_index/${indexId}`;
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    sourceOccurrenceId: "2".repeat(64),
  });
  const jobPath = `private_search_index_jobs/${job.id}`;
  const database = new FakeSearchIndexDatabase({
    [parentPath]: biteScoreRestaurant({name: "Old Parent A"}),
    [dishPath]: biteScoreDish(dishId, {name: "Current Dish Under A"}),
  });
  await reconcileBiteScoreDishIndex(database, dishId, now);
  assert.equal(database.records.get(indexPath).restaurantDisplayName, "Old Parent A");
  database.records.delete(parentPath);
  database.records.set(jobPath, job.document);

  const queryBarrier = pauseFirstQueryResult(
    database,
    (query) => query.collectionPath === "dish_search_index",
  );
  const cleanup = processSearchIndexJob(database, job.id, now);
  assert.deepEqual(
    (await queryBarrier.ready).map((candidate) => candidate.id),
    [indexId],
  );
  database.records.set(
    parentPath,
    biteScoreRestaurant({name: "Recreated Parent A"}),
  );
  queryBarrier.release();

  const result = await cleanup;
  assert.deepEqual(result, {
    processedCount: 1,
    continuationCursor: {phase: "dishes", afterDocumentId: null},
  });
  assert.equal(
    database.records.get(indexPath).restaurantDisplayName,
    "Recreated Parent A",
  );
  assert.equal(
    database.records.get(indexPath).customerPublicProjection
      .restaurantDisplayName,
    "Recreated Parent A",
  );
  const continuationJobId = database.records.get(jobPath).continuationJobId;
  assert.equal(typeof continuationJobId, "string");
  assert.deepEqual(
    await processSearchIndexJob(database, continuationJobId, now),
    {processedCount: 1, continuationCursor: null},
  );
  assert.equal(
    database.records.get(indexPath).restaurantDisplayName,
    "Recreated Parent A",
  );
  assert.deepEqual(
    await processSearchIndexJob(database, job.id, now),
    {processedCount: 0, continuationCursor: null},
  );
});

test("candidate transaction retries when recreated A is deleted again", async () => {
  const dishId = "dish-parent-recreated-then-deleted";
  const dishPath = `bitescore_dishes/${dishId}`;
  const parentPath = "bitescore_restaurants/restaurant-1";
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  const indexPath = `dish_search_index/${indexId}`;
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    sourceOccurrenceId: "3".repeat(64),
  });
  const database = new FakeSearchIndexDatabase({
    [parentPath]: biteScoreRestaurant({name: "Original Parent A"}),
    [dishPath]: biteScoreDish(dishId),
  });
  await reconcileBiteScoreDishIndex(database, dishId, now);
  database.records.delete(parentPath);
  database.records.set(`private_search_index_jobs/${job.id}`, job.document);

  const queryBarrier = pauseFirstQueryResult(
    database,
    (query) => query.collectionPath === "dish_search_index",
  );
  const cleanup = processSearchIndexJob(database, job.id, now);
  await queryBarrier.ready;
  database.records.set(
    parentPath,
    biteScoreRestaurant({name: "Ephemeral Recreated Parent A"}),
  );
  let deletedRecreatedParent = false;
  database.beforeTransactionCommitHook = async ({reads}) => {
    if (deletedRecreatedParent || !reads.has(parentPath)) return;
    deletedRecreatedParent = true;
    database.records.delete(parentPath);
  };
  const attemptsBeforeCleanup = database.transactionAttempts.length;
  queryBarrier.release();

  assert.deepEqual(await cleanup, {
    processedCount: 1,
    continuationCursor: null,
  });
  assert.equal(deletedRecreatedParent, true);
  assert.equal(database.records.has(parentPath), false);
  assert.equal(database.records.has(indexPath), false);
  assert.ok(
    database.transactionAttempts.length >= attemptsBeforeCleanup + 2,
  );
});

test("recreated parent cannot skip a selected missing dish before child-scan continuation", async () => {
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    sourceOccurrenceId: "c".repeat(64),
  });
  const dishId = "dish-selected-then-deleted";
  const dishPath = `bitescore_dishes/${dishId}`;
  const indexId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  const indexPath = `dish_search_index/${indexId}`;
  const jobPath = `private_search_index_jobs/${job.id}`;
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant({
      name: "Parent Before Deletion",
    }),
    [dishPath]: biteScoreDish(dishId),
  });
  await reconcileBiteScoreDishIndex(database, dishId, now);
  assert.notEqual(
    database.records.get(indexPath).customerPublicProjection,
    null,
  );
  database.records.delete("bitescore_restaurants/restaurant-1");
  database.records.delete(dishPath);
  database.records.set(jobPath, job.document);

  let parentReads = 0;
  database.getDocumentHook = async (path, fake) => {
    if (path !== "bitescore_restaurants/restaurant-1") return undefined;
    parentReads += 1;
    if (parentReads === 1) return null;
    const recreated = biteScoreRestaurant({name: "Recreated Parent"});
    fake.records.set(path, recreated);
    return recreated;
  };
  const result = await processSearchIndexJob(database, job.id, now);
  assert.equal(result.processedCount, 1);
  assert.deepEqual(result.continuationCursor, {phase: "dishes", afterDocumentId: null});
  assert.equal(database.records.has(indexPath), false);
  assert.equal(database.records.get(jobPath).status, "completed");
  const continuationJobId = database.records.get(jobPath).continuationJobId;
  assert.equal(typeof continuationJobId, "string");

  let continuationFailureInjected = false;
  database.queryDocumentsHook = async (query) => {
    if (
      !continuationFailureInjected &&
      query.collectionPath === "bitescore_dishes"
    ) {
      continuationFailureInjected = true;
      throw new Error("injected-candidate-first-continuation-failure");
    }
    return undefined;
  };
  await assert.rejects(
    processSearchIndexJob(database, continuationJobId, now),
    /injected-candidate-first-continuation-failure/u,
  );
  assert.equal(
    database.records.get(`private_search_index_jobs/${continuationJobId}`).status,
    "pending",
  );
  const continuationResult = await processSearchIndexJob(
    database,
    continuationJobId,
    now,
  );
  assert.deepEqual(continuationResult, {
    processedCount: 0,
    continuationCursor: null,
  });
  assert.equal(database.records.has(indexPath), false);
  assert.equal(
    database.records.get(`private_search_index_jobs/${continuationJobId}`).status,
    "completed",
  );

  for (const deliveredJobId of [job.id, continuationJobId]) {
    assert.deepEqual(
      await processSearchIndexJob(database, deliveredJobId, now),
      {processedCount: 0, continuationCursor: null},
    );
  }
  assert.equal(database.records.has(indexPath), false);
});

test("recreated BiteSaver parent cannot skip a selected missing offer", async (t) => {
  const scenarios = [
    {
      name: "coupon",
      sourceOccurrenceId: "5".repeat(64),
      sourceKind: "biteSaverCoupon",
      sourceDocumentId: "coupon-selected-then-deleted",
      childPath:
        "restaurant_accounts/account-1/coupons/coupon-selected-then-deleted",
      child: coupon("coupon-selected-then-deleted"),
      reconcile: (database) => reconcileBiteSaverCouponOfferIndex(
        database,
        "account-1",
        "coupon-selected-then-deleted",
        now,
      ),
    },
    {
      name: "daily special",
      sourceOccurrenceId: "6".repeat(64),
      sourceKind: "biteSaverDailySpecial",
      sourceDocumentId: "special-selected-then-deleted",
      childPath:
        "restaurant_accounts/account-1/daily_specials/special-selected-then-deleted",
      child: dailySpecial("special-selected-then-deleted"),
      reconcile: (database) => reconcileBiteSaverDailySpecialOfferIndex(
        database,
        "account-1",
        "special-selected-then-deleted",
        now,
      ),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const parentPath = "restaurant_accounts/account-1";
      const indexId = createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: scenario.sourceKind,
        parentSourceDocumentId: "account-1",
        sourceDocumentId: scenario.sourceDocumentId,
      });
      const indexPath = `bitesaver_offer_index/${indexId}`;
      const jobDocument = buildSearchIndexJobDocument({
        jobKind: "biteSaverOffers",
        parentSource: "biteSaver",
        parentSourceDocumentId: "account-1",
        requestedSourceFingerprint: biteSaverOfferParentFingerprint(null),
        sourceOccurrenceId: scenario.sourceOccurrenceId,
        now,
      });
      const jobId = createSearchIndexJobId(jobDocument);
      const jobPath = `private_search_index_jobs/${jobId}`;
      const database = new FakeSearchIndexDatabase({
        [parentPath]: biteSaverRestaurant({restaurantName: "Original Parent"}),
        [scenario.childPath]: scenario.child,
      });
      await scenario.reconcile(database);
      assert.notEqual(
        database.records.get(indexPath).customerPublicProjection,
        null,
      );
      database.records.delete(parentPath);
      database.records.delete(scenario.childPath);
      database.records.set(jobPath, jobDocument);

      const queryBarrier = pauseFirstQueryResult(
        database,
        (query) => query.collectionPath === "bitesaver_offer_index",
      );
      const cleanup = processSearchIndexJob(database, jobId, now);
      assert.deepEqual(
        (await queryBarrier.ready).map((candidate) => candidate.id),
        [indexId],
      );
      database.records.set(
        parentPath,
        biteSaverRestaurant({restaurantName: "Recreated Parent"}),
      );
      queryBarrier.release();

      assert.deepEqual(await cleanup, {
        processedCount: 1,
        continuationCursor: {phase: "coupons", afterDocumentId: null},
      });
      assert.equal(database.records.has(indexPath), false);
      assert.equal(database.records.has(parentPath), true);
      const continuationJobId = database.records.get(jobPath).continuationJobId;
      assert.equal(typeof continuationJobId, "string");
      assert.deepEqual(
        await processSearchIndexJob(database, continuationJobId, now),
        {processedCount: 0, continuationCursor: null},
      );
      assert.equal(database.records.has(indexPath), false);
      assert.equal(database.records.has(parentPath), true);
    });
  }
});

test("parent recreation between cleanup check and delete converges for both job kinds", async (t) => {
  const cases = [
    {
      name: "BiteScore dishes",
      jobKind: "biteScoreDishes",
      parentSource: "biteScore",
      parentId: "restaurant-1",
      parentPath: "bitescore_restaurants/restaurant-1",
      childPath: "bitescore_dishes/dish-race",
      indexId: createSearchIndexDocumentId({
        entityKind: "dish",
        sourceKind: "biteScoreDish",
        sourceDocumentId: "dish-race",
      }),
      indexCollection: "dish_search_index",
      oldIndex: {
        restaurantSourceDocumentId: "restaurant-1",
        sourceDocumentId: "dish-race",
        displayName: "Stale Deleted Dish",
      },
      requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
      sourceContinuationPhase: "dishes",
      recreate: async (database) => {
        database.records.set(
          "bitescore_restaurants/restaurant-1",
          biteScoreRestaurant({name: "Recreated BiteScore"}),
        );
        database.records.set(
          "bitescore_dishes/dish-race",
          biteScoreDish("dish-race", {name: "Current Recreated Dish"}),
        );
        await reconcileBiteScoreDishIndex(database, "dish-race", now);
      },
      assertCurrentIndex: (index) => {
        assert.equal(index.displayName, "Current Recreated Dish");
        assert.equal(index.restaurantDisplayName, "Recreated BiteScore");
      },
    },
    {
      name: "BiteSaver offers",
      jobKind: "biteSaverOffers",
      parentSource: "biteSaver",
      parentId: "account-1",
      parentPath: "restaurant_accounts/account-1",
      childPath: "restaurant_accounts/account-1/coupons/coupon-race",
      indexId: createSearchIndexDocumentId({
        entityKind: "offer",
        sourceKind: "biteSaverCoupon",
        parentSourceDocumentId: "account-1",
        sourceDocumentId: "coupon-race",
      }),
      indexCollection: "bitesaver_offer_index",
      oldIndex: {
        restaurantAccountId:
          dartUtf16FirestoreBytesOrderKey("account-1"),
        sourceDocumentId: "coupon-race",
        displayTitle: "Stale Deleted Coupon",
      },
      requestedSourceFingerprint: biteSaverOfferParentFingerprint(null),
      sourceContinuationPhase: "coupons",
      recreate: async (database) => {
        database.records.set(
          "restaurant_accounts/account-1",
          biteSaverRestaurant({restaurantName: "Recreated BiteSaver"}),
        );
        database.records.set(
          "restaurant_accounts/account-1/coupons/coupon-race",
          coupon("coupon-race", {title: "Current Recreated Coupon"}),
        );
        await reconcileBiteSaverCouponOfferIndex(
          database,
          "account-1",
          "coupon-race",
          now,
        );
      },
      assertCurrentIndex: (index) => {
        assert.equal(index.displayTitle, "Current Recreated Coupon");
        assert.equal(index.restaurantDisplayName, "Recreated BiteSaver");
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const continuationCursor = {
        phase: scenario.sourceContinuationPhase,
        afterDocumentId: null,
      };
      const jobDocument = buildSearchIndexJobDocument({
        jobKind: scenario.jobKind,
        parentSource: scenario.parentSource,
        parentSourceDocumentId: scenario.parentId,
        requestedSourceFingerprint: scenario.requestedSourceFingerprint,
        sourceOccurrenceId: "4".repeat(64),
        continuationCursor: {phase: "derivedCleanup", afterDocumentId: null},
        now,
      });
      const jobId = createSearchIndexJobId(jobDocument);
      const indexPath = `${scenario.indexCollection}/${scenario.indexId}`;
      const database = new FakeSearchIndexDatabase({
        [`private_search_index_jobs/${jobId}`]: jobDocument,
        [indexPath]: scenario.oldIndex,
      });
      let recreationCount = 0;
      database.deleteDocumentHook = async (path) => {
        if (path !== indexPath || recreationCount !== 0) return;
        recreationCount += 1;
        await scenario.recreate(database);
      };

      const cleanupResult = await processSearchIndexJob(database, jobId, now);
      assert.equal(recreationCount, 1);
      assert.equal(cleanupResult.processedCount, 1);
      assert.deepEqual(cleanupResult.continuationCursor, continuationCursor);
      assert.equal(database.records.has(scenario.parentPath), true);
      assert.equal(database.records.has(scenario.childPath), true);
      assert.equal(database.records.has(indexPath), false);

      const expectedContinuationId = createSearchIndexJobId({
        jobKind: scenario.jobKind,
        parentSource: scenario.parentSource,
        parentSourceDocumentId: scenario.parentId,
        requestedSourceFingerprint: scenario.requestedSourceFingerprint,
        sourceOccurrenceId: "4".repeat(64),
        continuationCursor,
      });
      assert.equal(
        database.records.get(`private_search_index_jobs/${jobId}`).continuationJobId,
        expectedContinuationId,
      );
      const continuationCreateIndex = database.operations.findIndex((entry) =>
        entry.operation === "createIfAbsent" &&
        entry.path === `private_search_index_jobs/${expectedContinuationId}`);
      const cleanupCompleteIndex = database.operations.findIndex((entry) =>
        entry.operation === "update" &&
        entry.path === `private_search_index_jobs/${jobId}`);
      assert.ok(continuationCreateIndex >= 0);
      assert.ok(cleanupCompleteIndex > continuationCreateIndex);

      const continuationResult = await processSearchIndexJob(
        database,
        expectedContinuationId,
        now,
      );
      assert.ok(continuationResult.processedCount <= maximumSearchIndexWorkerBatchSize);
      assert.equal(database.records.has(scenario.parentPath), true);
      assert.equal(database.records.has(scenario.childPath), true);
      assert.equal(database.records.has(indexPath), true);
      const currentIndex = database.records.get(indexPath);
      scenario.assertCurrentIndex(currentIndex);
      assert.equal(JSON.stringify(currentIndex).includes("Stale Deleted"), false);
      assert.equal(
        [...database.records.keys()].filter((path) =>
          path.startsWith(`${scenario.indexCollection}/`)).length,
        1,
      );
      assert.equal(
        [...database.records.keys()].filter((path) =>
          path.startsWith("private_search_index_jobs/")).length,
        2,
      );

      const duplicateResult = await processSearchIndexJob(database, jobId, now);
      assert.deepEqual(duplicateResult, {
        processedCount: 0,
        continuationCursor: null,
      });
      assert.equal(database.records.has(indexPath), true);
      assert.equal(
        [...database.records.keys()].filter((path) =>
          path.startsWith("private_search_index_jobs/")).length,
        2,
      );
    });
  }
});

test("expired jobs fail closed without querying or touching derived indexes", async () => {
  const expiredNow = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const document = buildSearchIndexJobDocument({
    jobKind: "biteScoreDishes",
    parentSource: "biteScore",
    parentSourceDocumentId: "restaurant-1",
    requestedSourceFingerprint: "a".repeat(64),
    sourceOccurrenceId: "5".repeat(64),
    now: expiredNow,
    expiresAt: new Date(now.getTime() - 1),
  });
  const id = createSearchIndexJobId(document);
  const database = new FakeSearchIndexDatabase({
    [`private_search_index_jobs/${id}`]: document,
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
  });
  const result = await processSearchIndexJob(database, id, now);
  assert.deepEqual(result, {processedCount: 0, continuationCursor: null});
  assert.equal(database.records.get(`private_search_index_jobs/${id}`).status, "expired");
  assert.equal(database.operations.some((entry) => entry.operation === "query"), false);
});

test("every immutable private-job identity mutation is terminal before worker side effects", async (t) => {
  const cases = [
    {
      name: "closed protocol version changes",
      job: jobFixture({sourceOccurrenceId: "1".repeat(64)}),
      parserInvalid: true,
      mutate(document) {
        return {
          ...document,
          searchIndexJobVersion: "bitestar.search-index-job.v2",
        };
      },
    },
    {
      name: "paired job kind and parent source change",
      job: jobFixture({sourceOccurrenceId: "2".repeat(64)}),
      mutate(document) {
        return {
          ...document,
          jobKind: "biteSaverOffers",
          parentSource: "biteSaver",
        };
      },
    },
    {
      name: "exact parent source document ID changes",
      job: jobFixture({sourceOccurrenceId: "3".repeat(64)}),
      mutate(document) {
        return {...document, parentSourceDocumentId: "restaurant-2"};
      },
    },
    {
      name: "requested source fingerprint changes",
      job: jobFixture({sourceOccurrenceId: "4".repeat(64)}),
      mutate(document) {
        return {
          ...document,
          requestedSourceFingerprint: "f".repeat(64),
        };
      },
    },
    {
      name: "source occurrence changes",
      job: jobFixture({sourceOccurrenceId: "5".repeat(64)}),
      mutate(document) {
        return {...document, sourceOccurrenceId: "6".repeat(64)};
      },
    },
    {
      name: "valid cursor phase changes",
      job: jobFixture({
        sourceOccurrenceId: "7".repeat(64),
        continuationCursor: {
          phase: "dishes",
          afterDocumentId: "dish-A",
        },
      }),
      mutate(document) {
        return {
          ...document,
          continuationCursor: {
            phase: "derivedCleanup",
            afterDocumentId: document.continuationCursor.afterDocumentId,
          },
        };
      },
    },
    {
      name: "cursor A becomes cursor B",
      job: jobFixture({
        sourceOccurrenceId: "8".repeat(64),
        continuationCursor: {
          phase: "dishes",
          afterDocumentId: "dish-A",
        },
      }),
      mutate(document) {
        return {
          ...document,
          continuationCursor: {
            phase: "dishes",
            afterDocumentId: "dish-B",
          },
        };
      },
    },
    {
      name: "no cursor gains a valid cursor",
      job: jobFixture({sourceOccurrenceId: "9".repeat(64)}),
      mutate(document) {
        return {
          ...document,
          continuationCursor: {
            phase: "dishes",
            afterDocumentId: "dish-999",
          },
        };
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const path = `private_search_index_jobs/${scenario.job.id}`;
      const tamperedDocument = scenario.mutate(scenario.job.document);
      assert.equal(createSearchIndexJobId(scenario.job.document), scenario.job.id);
      if (scenario.parserInvalid === true) {
        assert.equal(
          scenario.job.document.searchIndexJobVersion,
          searchIndexJobVersion,
        );
        assert.notEqual(
          tamperedDocument.searchIndexJobVersion,
          searchIndexJobVersion,
        );
      } else {
        assert.notEqual(
          createSearchIndexJobId(tamperedDocument),
          scenario.job.id,
        );
      }
      const database = new FakeSearchIndexDatabase({
        [path]: tamperedDocument,
        "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
        "bitescore_restaurants/restaurant-2": biteScoreRestaurant(),
        "bitescore_dishes/dish-001": biteScoreDish("dish-001"),
        "restaurant_accounts/restaurant-1": biteSaverRestaurant(),
        "restaurant_accounts/restaurant-1/coupons/coupon-1":
          coupon("coupon-1"),
      });

      const first = await processSearchIndexJob(database, scenario.job.id, now);
      assert.deepEqual(first, {processedCount: 0, continuationCursor: null});
      assert.equal(database.records.get(path).status, "invalid");
      assert.notEqual(database.records.get(path).status, "completed");
      assert.equal(database.records.get(path).processedCount, 0);
      assert.deepEqual(database.records.get(path).completedAt, now);
      assert.equal(database.records.get(path).continuationJobId, undefined);
      assert.deepEqual(
        database.operations.map(({operation, path: operationPath}) => ({
          operation,
          path: operationPath,
        })),
        [
          {operation: "get", path},
          {operation: "update", path},
        ],
      );
      assert.equal(database.transactionAttempts.length, 0);
      assert.equal(
        [...database.records.keys()].some((recordPath) =>
          recordPath.startsWith("dish_search_index/") ||
          recordPath.startsWith("bitesaver_offer_index/")),
        false,
      );

      const operationCount = database.operations.length;
      const duplicate = await processSearchIndexJob(
        database,
        scenario.job.id,
        now,
      );
      assert.deepEqual(duplicate, {
        processedCount: 0,
        continuationCursor: null,
      });
      assert.equal(database.operations.length, operationCount + 1);
      assert.deepEqual(database.operations.at(-1), {operation: "get", path});
    });
  }
});

test("correct cursor-bound job runs once and redelivery stays idempotent", async () => {
  const job = jobFixture({
    sourceOccurrenceId: "a".repeat(64),
    continuationCursor: {
      phase: "dishes",
      afterDocumentId: "dish-000",
    },
  });
  assert.notEqual(
    job.id,
    createSearchIndexJobId({...job.document, continuationCursor: undefined}),
  );
  assert.equal(createSearchIndexJobId(job.document), job.id);
  const path = `private_search_index_jobs/${job.id}`;
  const database = new FakeSearchIndexDatabase({
    [path]: job.document,
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    "bitescore_dishes/dish-000": biteScoreDish("dish-000"),
    "bitescore_dishes/dish-001": biteScoreDish("dish-001"),
  });

  const first = await processSearchIndexJob(database, job.id, now);
  assert.deepEqual(first, {processedCount: 1, continuationCursor: null});
  assert.equal(database.records.get(path).status, "completed");
  assert.deepEqual(
    database.operations.find((entry) =>
      entry.operation === "query" &&
      entry.query.collectionPath === "bitescore_dishes").query.afterDocumentId,
    "dish-000",
  );
  assert.deepEqual(
    [...database.records.entries()]
      .filter(([recordPath]) => recordPath.startsWith("dish_search_index/"))
      .map(([, document]) => document.sourceDocumentId),
    ["dish-001"],
  );

  const operationCount = database.operations.length;
  const duplicate = await processSearchIndexJob(database, job.id, now);
  assert.deepEqual(duplicate, {processedCount: 0, continuationCursor: null});
  assert.equal(database.operations.length, operationCount + 1);
  assert.deepEqual(database.operations.at(-1), {operation: "get", path});
});

test("tampered private cursor becomes terminal invalid and duplicate delivery is a no-op", async () => {
  const job = jobFixture({sourceOccurrenceId: "b".repeat(64)});
  const path = `private_search_index_jobs/${job.id}`;
  const database = new FakeSearchIndexDatabase({
    [path]: {
      ...job.document,
      continuationCursor: {
        phase: "dishes",
        afterDocumentId: "slash/not-a-single-document-id",
      },
    },
  });

  const first = await processSearchIndexJob(database, job.id, now);
  assert.deepEqual(first, {processedCount: 0, continuationCursor: null});
  assert.equal(database.records.get(path).status, "invalid");
  assert.equal(database.records.get(path).processedCount, 0);
  assert.equal(database.operations.some((entry) => entry.operation === "query"), false);

  const operationCount = database.operations.length;
  const duplicate = await processSearchIndexJob(database, job.id, now);
  assert.deepEqual(duplicate, {processedCount: 0, continuationCursor: null});
  assert.equal(database.operations.length, operationCount + 1);
  assert.deepEqual(database.operations.at(-1), {operation: "get", path});
});

test("noncanonical imported job cursor is terminal before source work", async () => {
  const job = jobFixture({sourceOccurrenceId: "e".repeat(64)});
  const path = "private_search_index_jobs/" + job.id;
  const database = new FakeSearchIndexDatabase({
    [path]: {
      ...job.document,
      continuationCursor: {
        phase: "dishes",
        afterDocumentId: "__id01__",
      },
    },
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    "bitescore_dishes/dish-must-not-run": biteScoreDish("dish-must-not-run"),
  });

  assert.deepEqual(await processSearchIndexJob(database, job.id, now), {
    processedCount: 0,
    continuationCursor: null,
  });
  assert.equal(database.records.get(path).status, "invalid");
  assert.equal(database.records.get(path).processedCount, 0);
  assert.deepEqual(
    database.operations.map(({operation, path: operationPath}) => ({
      operation,
      path: operationPath,
    })),
    [
      {operation: "get", path},
      {operation: "update", path},
    ],
  );
  assert.equal(database.transactionAttempts.length, 0);

  const operationCount = database.operations.length;
  assert.deepEqual(await processSearchIndexJob(database, job.id, now), {
    processedCount: 0,
    continuationCursor: null,
  });
  assert.equal(database.operations.length, operationCount + 1);
  assert.deepEqual(database.operations.at(-1), {operation: "get", path});
});

test("unsupported cursor phase becomes terminal invalid without source work or retries", async () => {
  const job = jobFixture({sourceOccurrenceId: "0".repeat(64)});
  const path = `private_search_index_jobs/${job.id}`;
  const database = new FakeSearchIndexDatabase({
    [path]: {
      ...job.document,
      continuationCursor: {
        phase: "unsupportedFuturePhase",
        afterDocumentId: null,
      },
    },
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
    "bitescore_dishes/dish-must-not-run": biteScoreDish("dish-must-not-run"),
  });

  const first = await processSearchIndexJob(database, job.id, now);
  assert.deepEqual(first, {processedCount: 0, continuationCursor: null});
  assert.deepEqual(database.records.get(path), {
    ...job.document,
    continuationCursor: {
      phase: "unsupportedFuturePhase",
      afterDocumentId: null,
    },
    status: "invalid",
    processedCount: 0,
    completedAt: now,
  });
  assert.deepEqual(
    database.operations.map(({operation, path: operationPath}) => ({
      operation,
      path: operationPath,
    })),
    [
      {operation: "get", path},
      {operation: "update", path},
    ],
  );
  assert.equal(database.transactionAttempts.length, 0);

  const operationCount = database.operations.length;
  assert.deepEqual(
    await processSearchIndexJob(database, job.id, now),
    {processedCount: 0, continuationCursor: null},
  );
  assert.equal(database.operations.length, operationCount + 1);
  assert.deepEqual(database.operations.at(-1), {operation: "get", path});
});
