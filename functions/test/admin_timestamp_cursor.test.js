"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");
const {Timestamp} = require("firebase-admin/firestore");
const {
  adminTimestampCursorValues,
  adminTimestampQueryValues,
} = require("../lib/admin_timestamp_cursor.js");
const {OpaqueCursorCodec} = require("../lib/opaque_cursor.js");
const {
  listCouponAdminCouponsPageHandler,
  listCouponAdminInviteHistoryPageHandler,
} = require("../lib/coupon_admin_paging.js");
const {
  listRatingAdminDirectoryPageHandler,
  listRatingAdminInviteHistoryPageHandler,
} = require("../lib/rating_admin_paging.js");

const nowMs = Date.UTC(2026, 8, 23);
const secret = Buffer.alloc(32, 7).toString("base64url");
const codec = new OpaqueCursorCodec({
  key: Buffer.from(secret, "base64url"),
  clock: () => nowMs,
});

const cases = [
  {
    name: "coupon list", handler: listCouponAdminCouponsPageHandler,
    size: 25, criteria: {restaurantAccountId: "restaurant-one"},
    changedCriteria: {restaurantAccountId: "restaurant-two"},
    source: "couponAdminCoupons", mode: "restaurantCoupons", caller: "couponAdmin",
    path: "restaurant_accounts/restaurant-one/coupons",
  },
  {
    name: "Coupon invite history", handler: listCouponAdminInviteHistoryPageHandler,
    size: 50, criteria: {side: "coupon"}, changedCriteria: {side: "bitescore"},
    source: "couponAdminInvites", mode: "couponInvites", caller: "couponAdmin",
    path: "restaurant_invites",
  },
  {
    name: "Rating invite history", handler: listRatingAdminInviteHistoryPageHandler,
    size: 50, criteria: {side: "bitescore"}, changedCriteria: {side: "coupon"},
    source: "ratingAdminInvites", mode: "bitescoreInvites", caller: "ratingAdmin",
    path: "restaurant_invites",
  },
  {
    name: "Rating directory reviews", handler: listRatingAdminDirectoryPageHandler,
    size: 50, criteria: {directoryKind: "reviews"},
    changedCriteria: {directoryKind: "claimedRestaurants"},
    source: "ratingAdminDirectory", mode: "reviews", caller: "ratingAdmin",
    path: "dish_reviews",
  },
];

function exactScalar(value) {
  const timestamp = value instanceof Date ? Timestamp.fromDate(value) : value;
  return timestamp instanceof Timestamp
    ? BigInt(timestamp.seconds) * 1_000_000_000n + BigInt(timestamp.nanoseconds)
    : value;
}

function compare(a, b) {
  a = exactScalar(a);
  b = exactScalar(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

class TimestampDatabase {
  constructor(path, documents) {
    this.path = path;
    this.documents = documents;
    this.queries = [];
    this.counts = [];
    this.gets = [];
  }

  matches(query) {
    assert.equal(query.collectionPath, this.path);
    return this.documents.filter(document => query.filters.every(filter => {
      assert.equal(filter.operation, "==");
      return document.data[filter.field] === filter.value;
    }));
  }

  async queryDocuments(query) {
    this.queries.push(query);
    assert.deepEqual(query.orders, [
      {field: "createdAt", direction: "desc"},
      {field: "__name__", direction: "desc"},
    ]);
    function againstTuple(document, tuple) {
      for (let i = 0; i < query.orders.length; i++) {
        const field = query.orders[i].field;
        const value = field === "__name__" ? document.id : document.data[field];
        const result = compare(value, tuple[i]);
        if (result) return -result;
      }
      return 0;
    }
    let documents = this.matches(query).sort((a, b) =>
      againstTuple(a, [b.data.createdAt, b.id]));
    if (query.cursor) {
      documents = documents.filter(document => query.cursor.kind === "startAfter"
        ? againstTuple(document, query.cursor.values) > 0
        : againstTuple(document, query.cursor.values) < 0);
    }
    return query.limitToLast ? documents.slice(-query.limit) : documents.slice(0, query.limit);
  }

  async countDocuments(query) {
    this.counts.push(query);
    return this.matches(query).length;
  }

  async getDocuments(paths) {
    this.gets.push(paths);
    return [];
  }
}

function documentsFor(config, length = config.size * 3 + 7) {
  return Array.from({length}, (_, i) => ({
    id: `row-${String(i).padStart(4, "0")}`,
    data: {
      // Every primary timestamp lies within one millisecond. Three equal
      // primary values force document-ID ties across 25/50-row boundaries.
      createdAt: new Timestamp(1_700_000_000, 123_000_001 + Math.floor(i / 3) * 1_000),
      side: config.criteria.side,
      dishId: "dish-one", restaurantId: "restaurant-one", userId: "reviewer-one",
      token: "must-not-appear", tokenHash: "must-not-appear", billing: "must-not-appear",
    },
  }));
}

function setup(config, documents = documentsFor(config)) {
  const database = new TimestampDatabase(config.path, documents);
  const context = {adminUid: "admin-one", cursorSecret: secret, database, now: () => nowMs};
  const request = {
    protocolVersion: "bitestar.page.v1", pageSize: config.size,
    criteria: config.criteria, direction: "first", requestExactCount: true,
    clientRequestId: "timestamp-boundary",
  };
  const binding = {
    source: config.source, searchMode: config.mode, pageSize: config.size,
    callerBinding: createHash("sha256").update(JSON.stringify([config.caller, "admin-one"])).digest("hex"),
  };
  return {database, context, request, binding};
}

const ids = page => page.items.map(item => item.id);
const invalidCursor = error => error.code === "invalid-argument";

test("timestamp boundary round trips retain all nanoseconds and Date precision", () => {
  for (const timestamp of [
    new Timestamp(-62_135_596_800, 0), new Timestamp(-1, 999_999_999),
    new Timestamp(0, 1), new Timestamp(1_700_000_000, 123_456_789),
    new Timestamp(253_402_300_799, 999_999_999), Timestamp.fromDate(new Date(-1)),
  ]) {
    const tuple = [...adminTimestampCursorValues(timestamp, "document-id"), 2];
    const binding = {queryFingerprint: "a".repeat(64), source: "unit", searchMode: "timestamp", pageSize: 25, callerBinding: "b".repeat(64)};
    const token = codec.encode({...binding, purpose: "forward", sortTuple: tuple});
    const decoded = codec.decode(token, {...binding, purposes: ["forward"]});
    assert.deepEqual(decoded.sortTuple, tuple);
    const [boundary, documentId] = adminTimestampQueryValues(decoded.sortTuple);
    assert(boundary.isEqual(timestamp));
    assert.equal(documentId, "document-id");
  }
  assert.deepEqual(adminTimestampCursorValues(new Date(-1), "id"), [-1, 999_000_000, "id"]);
});

test("timestamp boundary rejects malformed domains and lossy legacy shapes", () => {
  for (const tuple of [
    [0, 0, "id"], [0, 0, "id", 2, 3], [1_700_000_000_123, "id", 2],
    ["0", 0, "id", 2], [0.1, 0, "id", 2], [0, 0.1, "id", 2],
    [-62_135_596_801, 0, "id", 2], [253_402_300_800, 0, "id", 2],
    [0, -1, "id", 2], [0, 1_000_000_000, "id", 2],
    [0, 0, "", 2], [0, 0, "parent/id", 2], [0, 0, ".", 2],
    [0, 0, "..", 2], [0, 0, 123, 2], [0, 0, "id", 0],
    [0, 0, "id", "2"], [0, 0, "id", 2.1],
  ]) assert.throws(() => adminTimestampQueryValues(tuple), invalidCursor);
  for (const value of [null, 0, "timestamp", new Date(NaN), {toMillis: () => 123}]) {
    assert.throws(() => adminTimestampCursorValues(value, "id"), error => error.code === "failed-precondition");
  }
});

for (const config of cases) {
  test(`${config.name}: exact forward/backward/last pages preserve same-millisecond timestamps and ID ties`, async () => {
    const documents = documentsFor(config);
    const expected = [...documents].sort((a, b) =>
      compare(b.data.createdAt, a.data.createdAt) || compare(b.id, a.id));
    const {database, context, request, binding} = setup(config, documents);
    const pages = [];
    let page = await config.handler(request, context);
    while (true) {
      const number = pages.length + 1;
      pages.push(page);
      assert.deepEqual(ids(page), expected.slice((number - 1) * config.size, number * config.size).map(x => x.id));
      assert.equal(page.currentPageNumber, number);
      assert.equal(page.pageSize, config.size);
      assert.equal(page.hasPrevious, number > 1);
      assert(!JSON.stringify(page.items).includes("must-not-appear"));
      if (!page.hasNext) break;
      const boundary = expected[number * config.size - 1];
      const decoded = codec.decode(page.nextCursor, {...binding, queryFingerprint: page.queryFingerprint, purposes: ["forward"]});
      assert.deepEqual(decoded.sortTuple, [boundary.data.createdAt.seconds, boundary.data.createdAt.nanoseconds, boundary.id, number + 1]);
      page = await config.handler({...request, direction: "forward", cursor: page.nextCursor}, context);
      const queryBoundary = database.queries.at(-1).cursor.values[0];
      assert(queryBoundary instanceof Timestamp);
      assert(queryBoundary.isEqual(boundary.data.createdAt));
    }
    const allIds = pages.flatMap(ids);
    assert.equal(new Set(allIds).size, documents.length);
    assert.deepEqual(allIds, expected.map(x => x.id));
    assert(pages.length >= 4);
    for (let i = pages.length - 1; i > 0; i--) {
      const previous = await config.handler({...request, direction: "backward", cursor: pages[i].previousCursor}, context);
      assert.deepEqual(ids(previous), ids(pages[i - 1]));
      assert.equal(previous.currentPageNumber, i);
      assert.equal(previous.hasNext, true);
      assert.equal(previous.hasPrevious, i > 1);
      const anchor = expected[i * config.size];
      assert(database.queries.at(-1).cursor.values[0].isEqual(anchor.data.createdAt));
    }
    const last = await config.handler({...request, direction: "last"}, context);
    assert.deepEqual(ids(last), ids(pages.at(-1)));
    assert.equal(last.hasNext, false);
    assert.equal(last.currentPageNumber, pages.length);
    assert.deepEqual(ids(await config.handler({...request, direction: "backward", cursor: last.previousCursor}, context)), ids(pages.at(-2)));
    assert(database.queries.every(query => query.limit <= config.size + 1));
  });

  test(`${config.name}: tampering, stale criteria/caller/direction and malformed signed tuples fail before reads`, async () => {
    const {database, context, request, binding} = setup(config);
    const first = await config.handler(request, context);
    const oldQueries = database.queries.length;
    const oldCounts = database.counts.length;
    const encrypted = Buffer.from(first.nextCursor.slice("bsp1.".length), "base64url");
    encrypted[encrypted.length - 1] ^= 1;
    const decoded = codec.decode(first.nextCursor, {...binding, queryFingerprint: first.queryFingerprint, purposes: ["forward"]});
    for (const [raw, override] of [
      [{...request, direction: "forward", cursor: "bsp1." + encrypted.toString("base64url")}, {}],
      [{...request, direction: "backward", cursor: first.nextCursor}, {}],
      [{...request, direction: "forward", cursor: first.nextCursor, criteria: config.changedCriteria}, {}],
      [{...request, direction: "forward", cursor: first.nextCursor}, {adminUid: "another-admin"}],
      ...[[decoded.sortTuple[0], -1, decoded.sortTuple[2], 2], [decoded.sortTuple[0], 1_000_000_000, decoded.sortTuple[2], 2], [1_700_000_000_123, decoded.sortTuple[2], 2]].map(sortTuple => [
        {...request, direction: "forward", cursor: codec.encode({...binding, queryFingerprint: first.queryFingerprint, purpose: "forward", sortTuple})}, {},
      ]),
    ]) await assert.rejects(config.handler(raw, {...context, ...override}), invalidCursor);
    assert.equal(database.queries.length, oldQueries);
    assert.equal(database.counts.length, oldCounts);
  });

  test(`${config.name}: empty and exact-full-page first/last behavior is unchanged`, async () => {
    for (const length of [0, config.size, config.size * 2]) {
      const {context, request} = setup(config, documentsFor(config, length));
      const first = await config.handler(request, context);
      const last = await config.handler({...request, direction: "last"}, context);
      assert.equal(first.hasPrevious, false);
      assert.equal(first.currentPageNumber, 1);
      assert.equal(last.hasNext, false);
      assert.equal(last.currentPageNumber, Math.max(1, length / config.size));
      assert.equal(first.items.length, Math.min(length, config.size));
      assert.equal(last.items.length, Math.min(length, config.size));
      assert.equal(first.hasNext, length > config.size);
      assert.equal(last.hasPrevious, length > config.size);
    }
  });
}
