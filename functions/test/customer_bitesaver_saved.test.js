"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {Timestamp} = require("firebase-admin/firestore");

const {
  CustomerBiteSaverContractError,
  customerBiteSaverSearchSchemaVersion,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  customerBiteSaverOpaqueOfferId,
  customerBiteSaverOpaqueRestaurantId,
} = require("../lib/customer_bitesaver_public_identity.js");
const {
  getCustomerBiteSaverSavedMenuPageHandler,
  getCustomerBiteSaverSavedPageHandler,
} = require("../lib/customer_bitesaver_saved.js");
const {
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverRestaurantIndex,
} = require("../lib/search_index_builders.js");
const {
  biteSaverOfferIndexCollection,
  restaurantSearchIndexCollection,
} = require("../lib/search_index_contract.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");

const nowMs = Date.parse("2026-09-16T16:00:00.000Z");
const discoveryKey = Buffer.alloc(32, 41);
const identityKeyV1 = Buffer.alloc(32, 59);
const savedFixture = JSON.parse(fs.readFileSync(path.resolve(
  __dirname,
  "../../test/fixtures/customer_bitesaver_saved_page_v1.json",
), "utf8"));

function compare(left, right) {
  const timestampParts = (value) => {
    if (value instanceof Date) {
      const seconds = Math.floor(value.getTime() / 1_000);
      return {seconds, nanoseconds: (value.getTime() - seconds * 1_000) * 1_000_000};
    }
    if (value !== null && typeof value === "object") {
      const seconds = value.seconds ?? value._seconds;
      const nanoseconds = value.nanoseconds ?? value._nanoseconds;
      if (Number.isSafeInteger(seconds) && Number.isSafeInteger(nanoseconds)) {
        return {seconds, nanoseconds};
      }
    }
    return null;
  };
  const leftTimestamp = timestampParts(left);
  const rightTimestamp = timestampParts(right);
  if (leftTimestamp !== null && rightTimestamp !== null) {
    if (leftTimestamp.seconds !== rightTimestamp.seconds) {
      return leftTimestamp.seconds < rightTimestamp.seconds ? -1 : 1;
    }
    if (leftTimestamp.nanoseconds !== rightTimestamp.nanoseconds) {
      return leftTimestamp.nanoseconds < rightTimestamp.nanoseconds ? -1 : 1;
    }
    return 0;
  }
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "string" && typeof b === "string") {
    return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  }
  return a < b ? -1 : 1;
}

class MemoryDatabase {
  constructor() {
    this.documents = new Map();
    this.queries = [];
    this.gets = [];
    this.getMany = [];
    this.writes = [];
    this.failQuery = false;
  }

  set(path, data) {
    this.documents.set(path, data);
  }

  stored(path) {
    const data = this.documents.get(path);
    return data === undefined ? null : Object.freeze({
      id: path.slice(path.lastIndexOf("/") + 1),
      path,
      data,
    });
  }

  async getDocument(path) {
    this.gets.push(path);
    return this.stored(path);
  }

  async getDocuments(paths) {
    this.getMany.push([...paths]);
    return paths.map((path) => this.stored(path));
  }

  async queryDocuments(query) {
    this.queries.push(query);
    if (this.failQuery) throw new Error("query failure canary");
    const prefix = `${query.collectionPath}/`;
    let documents = [...this.documents.keys()]
      .filter((path) =>
        path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => this.stored(path));
    for (const filter of query.filters) {
      documents = documents.filter((document) => {
        const candidate = filter.field === "__name__"
          ? document.id
          : document.data[filter.field];
        if (filter.operation === "in") {
          return Array.isArray(filter.value) && filter.value.includes(candidate);
        }
        const ordering = compare(candidate, filter.value);
        if (filter.operation === "==") return ordering === 0;
        if (filter.operation === ">=") return ordering >= 0;
        if (filter.operation === "<=") return ordering <= 0;
        if (filter.operation === ">") return ordering > 0;
        return ordering < 0;
      });
    }
    documents.sort((left, right) => {
      for (const order of query.orders) {
        const leftValue = order.field === "__name__"
          ? left.id
          : left.data[order.field];
        const rightValue = order.field === "__name__"
          ? right.id
          : right.data[order.field];
        const ordering = compare(leftValue, rightValue);
        if (ordering !== 0) {
          return order.direction === "desc" ? -ordering : ordering;
        }
      }
      return 0;
    });
    if (query.startAfter !== undefined) {
      documents = documents.filter((document) => {
        for (let index = 0; index < query.orders.length; index += 1) {
          const order = query.orders[index];
          const value = order.field === "__name__"
            ? document.id
            : document.data[order.field];
          const ordering = compare(value, query.startAfter[index]) *
            (order.direction === "desc" ? -1 : 1);
          if (ordering !== 0) return ordering > 0;
        }
        return false;
      });
    }
    return documents.slice(0, query.limit);
  }

  async runTransaction(operation) {
    return operation({
      getDocument: (path) => this.getDocument(path),
      getDocuments: (paths) => this.getDocuments(paths),
      createDocument: (path, data) => this.writes.push({type: "create", path, data}),
      setDocument: (path, data) => this.writes.push({type: "set", path, data}),
      deleteDocument: (path) => this.writes.push({type: "delete", path}),
    });
  }

  async commitWrites(writes) {
    this.writes.push(...writes);
  }
}

function context(database, uid = "saved-customer") {
  return {
    database,
    discoveryKey,
    identityKeyV1,
    identity: {authUid: uid, authIsAnonymous: false},
    now: () => nowMs,
    randomSource: (size) => Buffer.alloc(size, 7),
  };
}

function request(section, cursor = null, suffix = "0001") {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: `saved-request-${suffix}`,
    section,
    cursor,
  };
}

function menuRequest(accessToken, cursor = null, suffix = "0001") {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: `saved-menu-request-${suffix}`,
    accessToken,
    cursor,
  };
}

function rawRestaurant(index, overrides = {}) {
  return {
    restaurantName: `Same Name Restaurant ${index % 2}`,
    approvalStatus: "approved",
    couponApplicationSubmitted: true,
    subscriptionStatus: "active",
    couponPostingEnabled: true,
    streetAddress: `${index} Public Avenue`,
    city: "Orlando",
    state: "FL",
    zipCode: "32801",
    latitude: 28.5383,
    longitude: -81.3792,
    geohash: canonicalRestaurantGeohash({
      latitude: 28.5383,
      longitude: -81.3792,
    }),
    businessHours: [],
    ownerUid: "private-owner-canary",
    ...overrides,
  };
}

function rawCoupon(index, overrides = {}) {
  return {
    title: `Coupon ${index}`,
    restaurant: "Same Name Restaurant",
    details: "Public details",
    usageRule: "Unlimited",
    couponCode: `SAVE${index}`,
    isActive: true,
    active: true,
    isProximityOnly: false,
    createdAt: new Date(nowMs - index * 1000),
    updatedAt: new Date(nowMs - index * 500),
    internalCost: "private-offer-canary",
    ...overrides,
  };
}

function restaurantFavorite(uid, restaurantId, createdAt) {
  return {
    schemaVersion: 1,
    favoriteKind: "bitesaverRestaurant",
    userId: uid,
    restaurantId,
    createdAt,
    updatedAt: createdAt,
  };
}

function couponFavorite(uid, restaurantId, offerId, createdAt, overrides = {}) {
  return {
    schemaVersion: 1,
    favoriteKind: "bitesaverCoupon",
    userId: uid,
    restaurantId,
    offerId,
    offerType: "coupon",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function seedRestaurant(database, uid, index, options = {}) {
  const accountId = options.accountId ?? `account-${String(index).padStart(3, "0")}`;
  const raw = rawRestaurant(index, options.restaurant);
  const projection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: accountId,
    source: raw,
    now: new Date(nowMs),
    identityKeyV1,
  });
  assert.notEqual(projection, null);
  const restaurantId = customerBiteSaverOpaqueRestaurantId(identityKeyV1, accountId);
  database.set(`restaurant_accounts/${accountId}`, raw);
  database.set(
    `${restaurantSearchIndexCollection}/${projection.indexDocumentId}`,
    projection,
  );
  const createdAt = new Date(nowMs - index * 1000);
  database.set(
    `user_profiles/${uid}/favorite_restaurants/${restaurantId}`,
    restaurantFavorite(uid, restaurantId, createdAt),
  );
  return {accountId, restaurantId, raw, projection, createdAt};
}

function seedCoupon(database, uid, index, options = {}) {
  const seeded = seedRestaurant(database, uid, index, options);
  const sourceDocumentId = options.sourceDocumentId ?? `coupon-${index}`;
  const raw = rawCoupon(index, options.coupon);
  const projection = buildBiteSaverCouponOfferIndex({
    restaurantAccountId: seeded.accountId,
    sourceDocumentId,
    offer: raw,
    restaurant: seeded.raw,
    now: new Date(nowMs),
    identityKeyV1,
  });
  assert.notEqual(projection, null);
  const offerId = customerBiteSaverOpaqueOfferId(
    identityKeyV1,
    seeded.accountId,
    "coupon",
    sourceDocumentId,
  );
  database.set(
    `restaurant_accounts/${seeded.accountId}/coupons/${sourceDocumentId}`,
    raw,
  );
  database.set(
    `${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,
    projection,
  );
  database.set(
    `user_profiles/${uid}/favorite_coupons/${offerId}`,
    couponFavorite(uid, seeded.restaurantId, offerId, seeded.createdAt),
  );
  return {...seeded, sourceDocumentId, offerId, offerProjection: projection};
}

function contractError(code) {
  return (error) =>
    error instanceof CustomerBiteSaverContractError && error.code === code;
}

test("Saved pages restart without search state and continue beyond 25 exactly", async () => {
  const database = new MemoryDatabase();
  const uid = "restart-owner";
  const expected = [];
  for (let index = 0; index < 31; index += 1) {
    expected.push(seedRestaurant(database, uid, index).restaurantId);
  }

  const first = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants"),
    context(database, uid),
  );
  assert.equal(first.entries.length, 25);
  assert.equal(first.hasMore, true);
  assert.equal(first.partial, false);
  assert.equal(first.entries.every((entry) => entry.availability === "available"), true);
  assert.equal(first.entries.every((entry) => entry.accessToken?.startsWith("bssv1.")), true);
  assert.equal(JSON.stringify(first).includes("account-"), false);
  assert.equal(JSON.stringify(first).includes("private-owner-canary"), false);

  const boundaryPath = database.queries[0].collectionPath + "/" +
    first.entries[24].restaurantId;
  database.documents.delete(boundaryPath);
  const second = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants", first.nextCursor, "0002"),
    context(database, uid),
  );
  assert.equal(second.entries.length, 6);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([
    ...first.entries.map((entry) => entry.restaurantId),
    ...second.entries.map((entry) => entry.restaurantId),
  ]).size, 31);
  assert.equal(database.queries.some((query) =>
    query.collectionPath.includes("private_customer_bitesaver")), false);
  assert.equal(database.queries[0].limit, 26);
  assert.equal(database.queries[1].limit, 25);
  assert.equal(database.getMany.every((paths) => paths.length <= 25), true);
  assert.equal(database.writes.length, 0);

  await assert.rejects(
    getCustomerBiteSaverSavedPageHandler(
      request("restaurants", first.nextCursor, "0003"),
      context(database, "different-owner"),
    ),
    contractError("invalid-argument"),
  );
  assert.equal(expected.length, 31);
});

test("Saved fixture is emitted exactly by the production handler", async () => {
  const database = new MemoryDatabase();
  const uid = "fixture-owner";
  const restaurantId = savedFixture.response.entries[0].restaurantId;
  database.set(
    `user_profiles/${uid}/favorite_restaurants/${restaurantId}`,
    restaurantFavorite(uid, restaurantId, new Date(nowMs)),
  );
  const result = await getCustomerBiteSaverSavedPageHandler(
    savedFixture.request,
    context(database, uid),
  );
  assert.deepEqual(result, savedFixture.response);
  assert.equal(
    savedFixture.fixtureVersion,
    "bitestar.customer-bitesaver-saved-page.v1",
  );
});

test("Saved continuation preserves Firestore nanosecond timestamp order", async () => {
  const database = new MemoryDatabase();
  const uid = "nanosecond-owner";
  const expected = [];
  for (let index = 0; index < 27; index += 1) {
    const seeded = seedRestaurant(database, uid, index);
    const createdAt = new Timestamp(1_800_000_000, index);
    database.set(
      `user_profiles/${uid}/favorite_restaurants/${seeded.restaurantId}`,
      restaurantFavorite(uid, seeded.restaurantId, createdAt),
    );
    expected.unshift(seeded.restaurantId);
  }
  const first = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants"),
    context(database, uid),
  );
  const second = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants", first.nextCursor, "0002"),
    context(database, uid),
  );
  assert.deepEqual(
    [...first.entries, ...second.entries].map(({restaurantId}) => restaurantId),
    expected,
  );
  assert.equal(first.entries.length, 25);
  assert.equal(second.entries.length, 2);
  assert.equal(second.hasMore, false);
});

test("bounded scanning advances past 75 legacy rows and keeps later canonical rows", async () => {
  const database = new MemoryDatabase();
  const uid = "scan-owner";
  for (let index = 0; index < 75; index += 1) {
    const date = new Date(nowMs - index * 1000);
    database.set(
      `user_profiles/${uid}/favorite_restaurants/legacy-${String(index).padStart(3, "0")}`,
      {restaurantType: "bitesaver", createdAt: date},
    );
  }
  const later = seedRestaurant(database, uid, 100);
  const first = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants"),
    context(database, uid),
  );
  assert.deepEqual(first.entries, []);
  assert.equal(first.partial, true);
  assert.equal(first.hasMore, true);
  assert.equal(database.getMany.length, 1);
  assert.deepEqual(database.getMany[0], []);

  const second = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants", first.nextCursor, "0002"),
    context(database, uid),
  );
  assert.deepEqual(second.entries.map((entry) => entry.restaurantId), [
    later.restaurantId,
  ]);
  assert.equal(second.hasMore, false);
});

test("coupon Saved resolution is collision-safe, read-only, and neutral when hidden", async () => {
  const database = new MemoryDatabase();
  const uid = "coupon-owner";
  const first = seedCoupon(database, uid, 0, {
    accountId: "collision-account-a",
    sourceDocumentId: "same-child-id",
  });
  const second = seedCoupon(database, uid, 1, {
    accountId: "collision-account-b",
    sourceDocumentId: "same-child-id",
  });
  const hidden = seedCoupon(database, uid, 2, {
    accountId: "hidden-account",
    restaurant: {approvalStatus: "pending", couponApplicationSubmitted: false},
  });
  const expired = seedCoupon(database, uid, 3, {
    accountId: "expired-account",
    coupon: {endTime: new Date(nowMs - 1)},
  });
  const deleted = seedCoupon(database, uid, 4, {
    accountId: "deleted-account",
  });
  database.documents.delete(
    `restaurant_accounts/${deleted.accountId}/coupons/${deleted.sourceDocumentId}`,
  );
  assert.notEqual(first.offerId, second.offerId);

  const result = await getCustomerBiteSaverSavedPageHandler(
    request("coupons"),
    context(database, uid),
  );
  const byId = new Map(result.entries.map((entry) => [entry.offerId, entry]));
  for (const seeded of [first, second]) {
    const entry = byId.get(seeded.offerId);
    assert.equal(entry.availability, "available");
    assert.equal(entry.restaurantId, seeded.restaurantId);
    assert.equal(entry.offer.available, false);
    assert.match(entry.offer.offerOccurrence, /^bsoc1\.[A-Za-z0-9_-]{43}$/u);
    assert.equal(entry.offer.availabilityReason, "savedReadOnly");
    assert.equal(entry.offer.usageState, "unknown");
  }
  for (const seeded of [hidden, expired, deleted]) {
    assert.deepEqual(byId.get(seeded.offerId), {
      favoriteKind: "bitesaverCoupon",
      restaurantId: seeded.restaurantId,
      offerId: seeded.offerId,
      availability: "unavailable",
      restaurant: null,
      offer: null,
      accessToken: null,
    });
  }
  assert.equal(JSON.stringify(result).includes("private-offer-canary"), false);
  assert.equal(database.writes.length, 0);
});

test("Saved menu access survives unfavorite but remains account and source bound", async () => {
  const database = new MemoryDatabase();
  const uid = "menu-owner";
  const seeded = seedRestaurant(database, uid, 0, {accountId: "menu-account"});
  database.set(
    `restaurant_accounts/${seeded.accountId}/menu_items/item-private-id`,
    {
      name: "Public pasta",
      description: "Tomato and basil",
      price: "$12",
      category: "Dinner",
      sortOrder: 1,
      privateNote: "private-menu-canary",
    },
  );
  const page = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants"),
    context(database, uid),
  );
  const token = page.entries[0].accessToken;
  database.documents.delete(
    `user_profiles/${uid}/favorite_restaurants/${seeded.restaurantId}`,
  );

  const menu = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(token),
    context(database, uid),
  );
  assert.equal(menu.state, "available");
  assert.equal(menu.restaurantId, seeded.restaurantId);
  assert.deepEqual(menu.entries.map((entry) => entry.name), ["Public pasta"]);
  assert.equal(JSON.stringify(menu).includes("item-private-id"), false);
  assert.equal(JSON.stringify(menu).includes("private-menu-canary"), false);
  assert.equal(database.writes.length, 0);

  await assert.rejects(
    getCustomerBiteSaverSavedMenuPageHandler(
      menuRequest(token, null, "0002"),
      context(database, "replacement-owner"),
    ),
    contractError("invalid-argument"),
  );
  await assert.rejects(
    getCustomerBiteSaverSavedMenuPageHandler(
      menuRequest(`${token.slice(0, -1)}x`, null, "0003"),
      context(database, uid),
    ),
    contractError("invalid-argument"),
  );
  await assert.rejects(
    getCustomerBiteSaverSavedMenuPageHandler(
      menuRequest(token, null, "0004"),
      {
        ...context(database, uid),
        now: () => nowMs + 24 * 60 * 60 * 1_000,
      },
    ),
    contractError("invalid-argument"),
  );
  database.set(`restaurant_accounts/${seeded.accountId}`, {
    ...seeded.raw,
    menuSourceSide: "biteScore",
  });
  await assert.rejects(
    getCustomerBiteSaverSavedMenuPageHandler(
      menuRequest(token, null, "0005"),
      context(database, uid),
    ),
    contractError("failed-precondition"),
  );
});

test("Saved menu candidate-budget continuation reaches a valid 76th row exactly once", async () => {
  const database = new MemoryDatabase();
  const uid = "candidate-budget-owner";
  const seeded = seedRestaurant(database, uid, 0, {
    accountId: "candidate-budget-account",
  });
  for (let index = 0; index < 75; index += 1) {
    database.set(
      `restaurant_accounts/${seeded.accountId}/menu_images/` +
        `image_${String(index).padStart(3, "0")}`,
      {privateNote: `filtered-${index}`},
    );
  }
  database.set(
    `restaurant_accounts/${seeded.accountId}/menu_images/image_075`,
    {
      imageUrl: "https://images.example.test/saved-76.webp",
      sortOrder: 76,
    },
  );
  const page = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants"),
    context(database, uid),
  );
  const token = page.entries[0].accessToken;

  const first = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(token),
    context(database, uid),
  );
  const retry = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(token),
    context(database, uid),
  );
  assert.deepEqual(first.entries, []);
  assert.equal(first.hasMore, true);
  assert.notEqual(first.nextCursor, null);
  assert.deepEqual(retry.entries, first.entries);
  assert.equal(retry.hasMore, first.hasMore);
  assert.notEqual(retry.nextCursor, null);
  assert.deepEqual(
    database.queries
      .filter(({collectionPath}) => collectionPath.endsWith("/menu_images"))
      .slice(0, 3)
      .map(({limit}) => limit),
    [26, 26, 23],
  );

  const second = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(token, first.nextCursor, "0002"),
    context(database, uid),
  );
  assert.deepEqual(second.entries.map(({imageUrl}) => imageUrl), [
    "https://images.example.test/saved-76.webp",
  ]);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
  const retrySecond = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(token, retry.nextCursor, "0003"),
    context(database, uid),
  );
  assert.deepEqual(retrySecond.entries, second.entries);
  assert.equal(retrySecond.hasMore, false);
  assert.equal(database.writes.length, 0);
});

test("Saved menu byte-budget rejection advances and preserves the next compact row", async () => {
  const database = new MemoryDatabase();
  const uid = "byte-budget-owner";
  const seeded = seedRestaurant(database, uid, 0, {
    accountId: "byte-budget-account",
  });
  database.set(
    `restaurant_accounts/${seeded.accountId}/menu_images/a_visible`,
    {imageUrl: "https://images.example.test/before-budget.webp", sortOrder: 1},
  );
  database.set(
    `restaurant_accounts/${seeded.accountId}/menu_images/b_rejected`,
    {privateNote: "x".repeat(1_048_576)},
  );
  database.set(
    `restaurant_accounts/${seeded.accountId}/menu_images/c_visible`,
    {imageUrl: "https://images.example.test/after-budget.webp", sortOrder: 2},
  );
  const page = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants"),
    context(database, uid),
  );
  const token = page.entries[0].accessToken;

  const first = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(token),
    context(database, uid),
  );
  assert.deepEqual(first.entries.map(({imageUrl}) => imageUrl), [
    "https://images.example.test/before-budget.webp",
  ]);
  assert.equal(first.hasMore, true);
  assert.notEqual(first.nextCursor, null);

  const second = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(token, first.nextCursor, "0002"),
    context(database, uid),
  );
  assert.deepEqual(second.entries.map(({imageUrl}) => imageUrl), [
    "https://images.example.test/after-budget.webp",
  ]);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.entries, ...second.entries]
    .map(({key}) => key)).size, 2);
  assert.equal(database.writes.length, 0);
});

test("Saved menu exact-full and multi-page reads retain exhaustion and retry semantics", async () => {
  async function menuWithCount(count, accountId, uid) {
    const database = new MemoryDatabase();
    const seeded = seedRestaurant(database, uid, 0, {accountId});
    for (let index = 0; index < count; index += 1) {
      database.set(
        `restaurant_accounts/${accountId}/menu_items/` +
          `item_${String(index).padStart(3, "0")}`,
        {
          name: `Item ${index}`,
          description: "",
          price: "$1",
          category: "Test",
          sortOrder: index,
        },
      );
    }
    const page = await getCustomerBiteSaverSavedPageHandler(
      request("restaurants"),
      context(database, uid),
    );
    return {database, token: page.entries[0].accessToken};
  }

  const exact = await menuWithCount(25, "exact-full-account", "exact-full-owner");
  const exactPage = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(exact.token),
    context(exact.database, "exact-full-owner"),
  );
  assert.equal(exactPage.entries.length, 25);
  assert.equal(exactPage.hasMore, false);
  assert.equal(exactPage.nextCursor, null);

  const paged = await menuWithCount(27, "paged-account", "paged-owner");
  const first = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(paged.token),
    context(paged.database, "paged-owner"),
  );
  const retry = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(paged.token),
    context(paged.database, "paged-owner"),
  );
  const second = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(paged.token, first.nextCursor, "0002"),
    context(paged.database, "paged-owner"),
  );
  assert.equal(first.entries.length, 25);
  assert.equal(first.hasMore, true);
  assert.deepEqual(retry.entries, first.entries);
  assert.equal(retry.hasMore, first.hasMore);
  assert.notEqual(retry.nextCursor, null);
  assert.equal(second.entries.length, 2);
  assert.equal(second.hasMore, false);
  const retrySecond = await getCustomerBiteSaverSavedMenuPageHandler(
    menuRequest(paged.token, retry.nextCursor, "0003"),
    context(paged.database, "paged-owner"),
  );
  assert.deepEqual(retrySecond.entries, second.entries);
  assert.equal(retrySecond.hasMore, false);
  assert.equal(new Set([...first.entries, ...second.entries]
    .map(({key}) => key)).size, 27);
  assert.equal(paged.database.writes.length, 0);
});

test("empty, failed, anonymous, and malformed reads never write or infer absence", async () => {
  const emptyDatabase = new MemoryDatabase();
  const empty = await getCustomerBiteSaverSavedPageHandler(
    request("restaurants"),
    context(emptyDatabase, "empty-owner"),
  );
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.hasMore, false);
  assert.deepEqual(emptyDatabase.queries.map((query) => query.collectionPath), [
    "user_profiles/empty-owner/favorite_restaurants",
  ]);
  assert.equal(emptyDatabase.writes.length, 0);

  const failedDatabase = new MemoryDatabase();
  seedRestaurant(failedDatabase, "failed-owner", 0);
  const before = new Map(failedDatabase.documents);
  failedDatabase.failQuery = true;
  await assert.rejects(
    getCustomerBiteSaverSavedPageHandler(
      request("restaurants"),
      context(failedDatabase, "failed-owner"),
    ),
    /query failure canary/u,
  );
  assert.deepEqual(failedDatabase.documents, before);
  assert.equal(failedDatabase.writes.length, 0);

  await assert.rejects(
    getCustomerBiteSaverSavedPageHandler(request("restaurants"), {
      ...context(new MemoryDatabase(), "anonymous"),
      identity: {authUid: "anonymous", authIsAnonymous: true},
    }),
    contractError("permission-denied"),
  );
});
