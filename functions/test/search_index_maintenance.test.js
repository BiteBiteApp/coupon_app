"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  handleBiteSaverCouponOfferWrite,
  handleBiteSaverDailySpecialOfferWrite,
  handleBiteSaverRestaurantWrite,
  handleBiteScoreRestaurantWrite,
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
} = require("../lib/search_index_builders.js");
const {
  buildSearchIndexJobDocument,
  createSearchIndexDocumentId,
  createSearchIndexJobId,
  maximumSearchIndexWorkerBatchSize,
} = require("../lib/search_index_contract.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");

const now = new Date("2026-08-08T16:00:00.000Z");
const coordinates = {latitude: 28.8517, longitude: -82.487};
const geohash = canonicalRestaurantGeohash(coordinates);

class FakeSearchIndexDatabase {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial));
    this.operations = [];
    this.failSetPath = null;
    this.deleteDocumentHook = null;
    this.getDocumentHook = null;
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

  async updateExistingDocumentServerTimestamp(path, field) {
    this.operations.push({operation: "serverTimestamp", path, field});
    if (!this.records.has(path)) {
      const error = new Error("missing-document");
      error.code = 5;
      throw error;
    }
    this.nextServerTimestampMilliseconds += 1;
    this.records.set(path, {
      ...this.records.get(path),
      [field]: new Date(this.nextServerTimestampMilliseconds),
    });
  }

  async queryDocuments(query) {
    this.operations.push({operation: "query", query});
    const prefix = `${query.collectionPath}/`;
    const expectedSegments = query.collectionPath.split("/").length + 1;
    let documents = [...this.records.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.split("/").length === expectedSegments)
      .map(([path, data]) => ({id: path.slice(prefix.length), data}))
      .filter((document) => query.where === undefined ||
        document.data[query.where.field] === query.where.value)
      .sort((first, second) => first.id.localeCompare(second.id));
    if (query.afterDocumentId) {
      documents = documents.filter((document) => document.id > query.afterDocumentId);
    }
    return documents.slice(0, query.limit);
  }
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

function jobFixture(overrides = {}) {
  const input = {
    jobKind: "biteScoreDishes",
    parentSource: "biteScore",
    parentSourceDocumentId: "restaurant-1",
    requestedSourceFingerprint: biteScoreDishParentFingerprint(biteScoreRestaurant()),
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
  assert.equal(database.records.size, 2);
});

test("update overwrites the same deterministic restaurant index", async () => {
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": biteScoreRestaurant(),
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
    biteScoreRestaurant({name: "Newer Current Name", updatedAt: new Date(now.getTime() + 1)}),
  );
  await reconcileBiteScoreRestaurantIndex(database, "restaurant-1", now);
  assert.equal(database.records.get(indexPath).displayName, "Newer Current Name");
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
    now,
  });
  assert.equal(
    database.records.get(`restaurant_search_index/${indexId}`).displayName,
    "Recreated Current",
  );
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

  database.records.delete("dish_rating_aggregates/dish-1");
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  assert.equal(database.records.get(path).overallBiteScore, 0);
  assert.equal(database.records.get(path).ratingCount, 0);

  database.records.delete("bitescore_dishes/dish-1");
  await reconcileBiteScoreDishIndex(database, "dish-1", now);
  assert.equal(database.records.has(path), false);
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

test("coupon and daily-special create, update, and delete advance the public catalog signal", async () => {
  const offerKinds = [
    {
      childCollection: "coupons",
      sourceKind: "biteSaverCoupon",
      sourceDocumentId: "coupon-1",
      source: (title) => coupon("coupon-1", {title}),
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
      source: (title) => dailySpecial("special-1", {title}),
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

test("offer catalog retries advance monotonically without loops or parent recreation", async () => {
  const accountPath = "restaurant_accounts/account-1";
  const database = new FakeSearchIndexDatabase({
    [accountPath]: biteSaverRestaurant(),
    [`${accountPath}/coupons/coupon-1`]: coupon("coupon-1"),
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
  assert.ok(second > first);
  assert.equal(
    database.operations.filter((entry) => entry.operation === "serverTimestamp").length,
    2,
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
      now,
    });
  }
  const jobs = [...database.records.entries()].filter(([path]) =>
    path.startsWith("private_search_index_jobs/"));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0][1].requestedSourceFingerprint, biteSaverOfferParentFingerprint(after));
  assert.equal(JSON.stringify(jobs[0][1]).includes("Before"), false);
});

test("irrelevant parent-only changes do not enqueue dependent work", async () => {
  const source = biteScoreRestaurant();
  const database = new FakeSearchIndexDatabase({
    "bitescore_restaurants/restaurant-1": {...source, phone: "changed"},
  });
  await handleBiteScoreRestaurantWrite(database, {
    restaurantId: "restaurant-1",
    before: {...source, phone: "before"},
    after: {...source, phone: "changed"},
    now,
  });
  assert.equal(
    [...database.records.keys()].some((path) => path.startsWith("private_search_index_jobs/")),
    false,
  );
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

test("parent recreation detected during cleanup prevents stale deletion", async () => {
  const job = jobFixture({
    requestedSourceFingerprint: biteScoreDishParentFingerprint(null),
    continuationCursor: {phase: "derivedCleanup", afterDocumentId: null},
  });
  const database = new FakeSearchIndexDatabase({
    [`private_search_index_jobs/${job.id}`]: job.document,
    "dish_search_index/index-1": {
      restaurantSourceDocumentId: "restaurant-1",
      sourceDocumentId: "dish-1",
    },
  });
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
  assert.equal(result.processedCount, 0);
  assert.deepEqual(result.continuationCursor, {phase: "dishes", afterDocumentId: null});
  assert.equal(database.records.has("dish_search_index/index-1"), true);
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
        restaurantAccountId: "account-1",
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
