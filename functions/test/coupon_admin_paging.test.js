"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  couponAdminCouponPageSize,
  couponAdminCursorSecretName,
  couponAdminInvitePageSize,
  couponAdminPostFilterReadBudget,
  couponAdminQueuePageSize,
  couponAdminRestaurantPageSize,
  decodeCouponAdminCursorKey,
  listCouponAdminCouponsPageHandler,
  listCouponAdminInviteHistoryPageHandler,
  listCouponAdminQueuePageHandler,
} = require("../lib/coupon_admin_paging.js");
const {
  searchCouponAdminRestaurantsPageHandler,
} = require("../lib/coupon_admin_restaurant_search.js");
const {
  couponAdminRadiusAbsoluteLifetimeMs,
  couponAdminRadiusIdleLifetimeMs,
  couponAdminRadiusReadBudget,
  searchCouponAdminRadiusRestaurantsPage,
} = require("../lib/coupon_admin_radius_sessions.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");

const nowMs = Date.UTC(2026, 7, 8, 12);
const secret = "A".repeat(43);

function request(criteria, overrides = {}) {
  return {
    protocolVersion: "bitestar.page.v1",
    pageSize: 50,
    criteria,
    direction: "first",
    requestExactCount: true,
    clientRequestId: "request-1",
    ...overrides,
  };
}

function scalar(value) {
  return value instanceof Date ? value.getTime() : value;
}

function compareValues(first, second) {
  const a = scalar(first);
  const b = scalar(second);
  return a < b ? -1 : a > b ? 1 : 0;
}

function field(document, name) {
  return name === "__name__" ? document.id : document.data[name];
}

class FakePagingDatabase {
  constructor(collections = {}, sourceDocuments = {}) {
    this.collections = collections;
    this.sourceDocuments = sourceDocuments;
    this.queries = [];
    this.counts = [];
    this.gets = [];
    this.queryResultSizes = [];
  }

  matching(collectionPath, filters) {
    return [...(this.collections[collectionPath] ?? [])].filter((document) =>
      filters.every((filter) => {
        const value = field(document, filter.field);
        if (filter.operation === "==") return value === filter.value;
        if (filter.operation === "array-contains") {
          return Array.isArray(value) && value.includes(filter.value);
        }
        if (filter.operation === ">=") return compareValues(value, filter.value) >= 0;
        if (filter.operation === "<=") return compareValues(value, filter.value) <= 0;
        return false;
      }),
    );
  }

  async queryDocuments(query) {
    this.queries.push(query);
    let documents = this.matching(query.collectionPath, query.filters);
    documents = documents.filter((document) => query.orders.every((order) =>
      order.field === "__name__" || Object.hasOwn(document.data, order.field),
    ));
    documents.sort((first, second) => {
      for (const order of query.orders) {
        const compared = compareValues(field(first, order.field), field(second, order.field));
        if (compared !== 0) return order.direction === "desc" ? -compared : compared;
      }
      return 0;
    });
    if (query.cursor) {
      const compareCursor = (document) => {
        for (let index = 0; index < query.orders.length; index += 1) {
          const order = query.orders[index];
          const compared = compareValues(field(document, order.field), query.cursor.values[index]);
          if (compared !== 0) return order.direction === "desc" ? -compared : compared;
        }
        return 0;
      };
      documents = documents.filter((document) =>
        query.cursor.kind === "startAfter"
          ? compareCursor(document) > 0
          : compareCursor(document) < 0,
      );
    }
    const result = query.limitToLast
      ? documents.slice(-query.limit)
      : documents.slice(0, query.limit);
    this.queryResultSizes.push(result.length);
    return result;
  }

  async countDocuments(value) {
    this.counts.push(value);
    return this.matching(value.collectionPath, value.filters).length;
  }

  async getDocuments(paths) {
    this.gets.push([...paths]);
    return paths.flatMap((path) => this.sourceDocuments[path] ? [this.sourceDocuments[path]] : []);
  }
}

function handlerContext(database, overrides = {}) {
  return {
    adminUid: "admin-one",
    cursorSecret: secret,
    database,
    now: () => nowMs,
    nonceSource: (size) => new Uint8Array(size).fill(7),
    ...overrides,
  };
}

function indexDocument(number, overrides = {}) {
  const id = `r${String(number).padStart(4, "0")}`;
  return {
    id: `index-${id}`,
    data: {
      source: "biteSaver",
      sourceDocumentId: id,
      adminDirectoryVisible: true,
      zip5: "01234",
      cityStateKey: "inverness|FL",
      normalizedName: `restaurant ${String(number).padStart(4, "0")}`,
      namePrefixTokens: ["re", "res", "rest", "restaurant"],
      geohash: "djjjjjjjjj",
      latitude: 28.85,
      longitude: -82.49,
      ...overrides,
    },
  };
}

function sourceDocument(number, overrides = {}) {
  const id = `r${String(number).padStart(4, "0")}`;
  return {
    id,
    data: {
      uid: `uid-${id}`,
      restaurantName: `Restaurant ${number}`,
      approvalStatus: "approved",
      couponApplicationSubmitted: true,
      streetAddress: "1 Test Way",
      city: "Inverness",
      state: "FL",
      zipCode: "01234",
      phone: "5550100",
      website: "https://example.test",
      latitude: 28.85,
      longitude: -82.49,
      ...overrides,
    },
  };
}

function restaurantDatabase(count, mutateIndex) {
  const index = [];
  const sources = {};
  for (let number = 0; number < count; number += 1) {
    const document = indexDocument(number);
    if (mutateIndex) mutateIndex(document, number);
    index.push(document);
    const source = sourceDocument(number);
    sources[`restaurant_accounts/${source.id}`] = source;
  }
  return new FakePagingDatabase({restaurant_search_index: index}, sources);
}

test("Coupon Admin constants and cursor secret contract are exact", () => {
  assert.equal(couponAdminCursorSecretName, "SEARCH_PAGINATION_CURSOR_KEY");
  assert.equal(couponAdminRestaurantPageSize, 50);
  assert.equal(couponAdminQueuePageSize, 25);
  assert.equal(couponAdminCouponPageSize, 25);
  assert.equal(couponAdminInvitePageSize, 50);
  assert.equal(couponAdminPostFilterReadBudget, 500);
  assert.equal(decodeCouponAdminCursorKey(secret).byteLength, 32);
  for (const invalid of [undefined, "", "A".repeat(42), "!".repeat(43)]) {
    assert.throws(() => decodeCouponAdminCursorKey(invalid), (error) =>
      error.code === "failed-precondition");
  }
});

test("missing or malformed cursor secret fails before a database query", async () => {
  const database = restaurantDatabase(1);
  await assert.rejects(
    searchCouponAdminRestaurantsPageHandler(
      request({mode: "exactZip", zipCode: "01234"}),
      handlerContext(database, {cursorSecret: "bad"}),
    ),
    (error) => error.code === "failed-precondition",
  );
  assert.equal(database.queries.length, 0);
  assert.equal(database.counts.length, 0);
});

test("exact ZIP reaches 250 restaurants in five server pages without duplicates", async () => {
  const database = restaurantDatabase(250);
  const context = handlerContext(database);
  let page = await searchCouponAdminRestaurantsPageHandler(
    request({mode: "exactZip", zipCode: "01234-9999"}),
    context,
  );
  const ids = [];
  for (let number = 1; number <= 5; number += 1) {
    assert.equal(page.currentPageNumber, number);
    assert.equal(page.items.length, 50);
    assert.deepEqual(page.total, {state: "exact", value: 250});
    ids.push(...page.items.map((item) => item.documentId));
    if (number < 5) {
      page = await searchCouponAdminRestaurantsPageHandler(
        request(
          {mode: "exactZip", zipCode: "01234"},
          {
            direction: "forward",
            cursor: page.nextCursor,
            clientRequestId: `request-${number + 1}`,
          },
        ),
        context,
      );
    }
  }
  assert.equal(new Set(ids).size, 250);
  assert.equal(database.queries.every((query) => query.limit <= 51), true);
  assert.equal(database.gets.every((paths) => paths.length <= 50), true);
});

test("exact ZIP supports backward and last pages with stable IDs", async () => {
  const database = restaurantDatabase(111);
  const context = handlerContext(database);
  const first = await searchCouponAdminRestaurantsPageHandler(
    request({mode: "exactZip", zipCode: "01234"}),
    context,
  );
  const second = await searchCouponAdminRestaurantsPageHandler(
    request(
      {mode: "exactZip", zipCode: "01234"},
      {direction: "forward", cursor: first.nextCursor, clientRequestId: "next"},
    ),
    context,
  );
  const previous = await searchCouponAdminRestaurantsPageHandler(
    request(
      {mode: "exactZip", zipCode: "01234"},
      {direction: "backward", cursor: second.previousCursor, clientRequestId: "previous"},
    ),
    context,
  );
  const last = await searchCouponAdminRestaurantsPageHandler(
    request(
      {mode: "exactZip", zipCode: "01234"},
      {direction: "last", clientRequestId: "last"},
    ),
    context,
  );
  assert.deepEqual(previous.items.map((item) => item.documentId), first.items.map((item) => item.documentId));
  assert.equal(last.currentPageNumber, 3);
  assert.equal(last.items.length, 11);
});

test("exact City and State never mixes the same city in another state", async () => {
  const database = restaurantDatabase(250, (document, number) => {
    document.data.cityStateKey = number < 200 ? "FL|inverness" : "CA|inverness";
  });
  const page = await searchCouponAdminRestaurantsPageHandler(
    request({mode: "exactCity", city: " Inverness ", state: "fl"}),
    handlerContext(database),
  );
  assert.equal(page.items.length, 50);
  assert.deepEqual(page.total, {state: "exact", value: 200});
  assert.equal(database.queries[0].filters.some((filter) =>
    filter.field === "cityStateKey" && filter.value === "FL|inverness"), true);
});

test("exact City rejects bare city before reads", async () => {
  const database = restaurantDatabase(1);
  await assert.rejects(
    searchCouponAdminRestaurantsPageHandler(
      request({mode: "exactCity", city: "Inverness"}),
      handlerContext(database),
    ),
    (error) => error.code === "invalid-argument",
  );
  assert.equal(database.queries.length, 0);
});

test("multiword prefix scan continues after the 500-document budget", async () => {
  const database = restaurantDatabase(520, (document, number) => {
    document.data.normalizedName = number === 510
      ? "mat subscription"
      : `mat alpha ${String(number).padStart(4, "0")}`;
    document.data.namePrefixTokens = ["ma", "mat"];
  });
  const criteria = {mode: "exactZip", zipCode: "01234", restaurantName: "mat sub"};
  const first = await searchCouponAdminRestaurantsPageHandler(
    request(criteria),
    handlerContext(database),
  );
  assert.equal(first.items.length, 0);
  assert.equal(first.hasNext, true);
  assert.deepEqual(first.total, {state: "unknown"});
  assert.equal(database.queries[0].limit, 500);
  const second = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "continuation",
    }),
    handlerContext(database),
  );
  assert.deepEqual(second.items.map((item) => item.documentId), ["r0510"]);
});

test("partial multiword pages continue from the last raw candidate", async () => {
  const database = restaurantDatabase(520, (document, number) => {
    document.data.normalizedName = number === 0 || number === 510
      ? `mat alpha ${String(number).padStart(4, "0")} subscription`
      : `mat alpha ${String(number).padStart(4, "0")}`;
    document.data.namePrefixTokens = ["ma", "mat"];
  });
  const criteria = {mode: "exactZip", zipCode: "01234", restaurantName: "mat sub"};
  const first = await searchCouponAdminRestaurantsPageHandler(
    request(criteria),
    handlerContext(database),
  );
  assert.deepEqual(first.items.map((item) => item.documentId), ["r0000"]);
  assert.equal(first.hasNext, true);
  const second = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "partial-continuation",
    }),
    handlerContext(database),
  );
  assert.deepEqual(second.items.map((item) => item.documentId), ["r0510"]);
  const previous = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "backward",
      cursor: second.previousCursor,
      clientRequestId: "partial-previous",
    }),
    handlerContext(database),
  );
  assert.deepEqual(previous.items.map((item) => item.documentId), ["r0000"]);
  const restoredSecond = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "forward",
      cursor: previous.nextCursor,
      clientRequestId: "partial-restored-forward",
    }),
    handlerContext(database),
  );
  assert.deepEqual(restoredSecond.items.map((item) => item.documentId), ["r0510"]);
  assert.equal(new Set([
    ...first.items,
    ...second.items,
  ].map((item) => item.documentId)).size, 2);
  assert.equal(database.queries.every((query) => query.limit <= 500), true);
  assert.equal(database.queryResultSizes.every((size) => size <= 500), true);
});

test("three sparse post-filter pages remain stable forward and backward", async () => {
  const database = restaurantDatabase(1020, (document, number) => {
    document.data.normalizedName = number === 0 || number === 510 || number === 1010
      ? `mat alpha ${String(number).padStart(4, "0")} subscription`
      : `mat alpha ${String(number).padStart(4, "0")}`;
    document.data.namePrefixTokens = ["ma", "mat"];
  });
  const criteria = {mode: "exactZip", zipCode: "01234", restaurantName: "mat sub"};
  const first = await searchCouponAdminRestaurantsPageHandler(
    request(criteria),
    handlerContext(database),
  );
  const second = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "sparse-page-2",
    }),
    handlerContext(database),
  );
  const third = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "forward",
      cursor: second.nextCursor,
      clientRequestId: "sparse-page-3",
    }),
    handlerContext(database),
  );
  assert.deepEqual([
    first.items.map((item) => item.documentId),
    second.items.map((item) => item.documentId),
    third.items.map((item) => item.documentId),
  ], [["r0000"], ["r0510"], ["r1010"]]);
  assert.equal(third.hasNext, false);
  const backToSecond = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "backward",
      cursor: third.previousCursor,
      clientRequestId: "sparse-back-2",
    }),
    handlerContext(database),
  );
  const backToFirst = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "backward",
      cursor: backToSecond.previousCursor,
      clientRequestId: "sparse-back-1",
    }),
    handlerContext(database),
  );
  const forwardAgain = await searchCouponAdminRestaurantsPageHandler(
    request(criteria, {
      direction: "forward",
      cursor: backToFirst.nextCursor,
      clientRequestId: "sparse-forward-again",
    }),
    handlerContext(database),
  );
  assert.deepEqual(backToSecond.items.map((item) => item.documentId), ["r0510"]);
  assert.deepEqual(backToFirst.items.map((item) => item.documentId), ["r0000"]);
  assert.deepEqual(forwardAgain.items.map((item) => item.documentId), ["r0510"]);
  assert.equal(new Set([
    ...first.items,
    ...second.items,
    ...third.items,
  ].map((item) => item.documentId)).size, 3);
  assert.equal(database.queries.every((query) => query.limit <= 500), true);
  assert.equal(database.queryResultSizes.every((size) => size <= 500), true);
});

test("name prefixes longer than the indexed token maximum remain exhaustive", async () => {
  const name = "abcdefghijklmnopqrstuvwxyzabcdefghij";
  const anchor = name.slice(0, 32);
  const database = restaurantDatabase(1, (document) => {
    document.data.normalizedName = name;
    document.data.namePrefixTokens = [anchor];
  });
  const page = await searchCouponAdminRestaurantsPageHandler(
    request({mode: "exactZip", zipCode: "01234", restaurantName: name}),
    handlerContext(database),
  );
  assert.deepEqual(page.items.map((item) => item.documentId), ["r0000"]);
  assert.deepEqual(page.total, {state: "unknown"});
  assert.equal(
    database.queries[0].filters.some((filter) =>
      filter.field === "namePrefixTokens" && filter.value === anchor),
    true,
  );
});

function dated(id, milliseconds, data = {}) {
  return {id, data: {...data, createdAt: new Date(milliseconds), updatedAt: new Date(milliseconds)}};
}

test("pending queue reaches legacy createdAt-only records with stable navigation", async () => {
  const pending = Array.from({length: 24}, (_, index) => dated(`pending-${index}`, index, {
    approvalStatus: "pending",
    restaurantName: `Pending ${index}`,
    uid: `uid-${index}`,
    email: "admin@example.test",
    phone: "555",
    streetAddress: "Street",
    city: "City",
    state: "FL",
    zipCode: "34428",
    website: "",
    couponApplicationSubmitted: true,
    profileVersion: 1,
  }));
  pending.push({
    id: "pending-legacy",
    data: {
      approvalStatus: "pending",
      restaurantName: "Legacy Pending",
      uid: "legacy-uid",
      createdAt: new Date(100),
    },
  });
  pending.push(dated("pending-tie-a", 99, {approvalStatus: "pending"}));
  pending.push(dated("pending-tie-z", 99, {approvalStatus: "pending"}));
  pending.push(dated("approved", 200, {approvalStatus: "approved"}));
  const database = new FakePagingDatabase({restaurant_accounts: pending});
  const first = await listCouponAdminQueuePageHandler(
    request({queueKind: "pendingApplications"}, {pageSize: 25}),
    handlerContext(database),
  );
  assert.equal(first.items.length, 25);
  assert.deepEqual(first.items.slice(0, 3).map((item) => item.id), [
    "pending-legacy",
    "pending-tie-z",
    "pending-tie-a",
  ]);
  assert.deepEqual(first.total, {state: "exact", value: 27});
  assert.equal(database.queries[0].limit, 26);
  assert.deepEqual(database.queries[0].orders, [
    {field: "createdAt", direction: "desc"},
    {field: "__name__", direction: "desc"},
  ]);
  assert.equal(JSON.stringify(first).includes("approved"), false);
  const second = await listCouponAdminQueuePageHandler(
    request(
      {queueKind: "pendingApplications"},
      {
        pageSize: 25,
        direction: "forward",
        cursor: first.nextCursor,
        clientRequestId: "pending-next",
      },
    ),
    handlerContext(database),
  );
  assert.equal(second.items.length, 2);
  const previous = await listCouponAdminQueuePageHandler(
    request(
      {queueKind: "pendingApplications"},
      {
        pageSize: 25,
        direction: "backward",
        cursor: second.previousCursor,
        clientRequestId: "pending-previous",
      },
    ),
    handlerContext(database),
  );
  const last = await listCouponAdminQueuePageHandler(
    request(
      {queueKind: "pendingApplications"},
      {pageSize: 25, direction: "last", clientRequestId: "pending-last"},
    ),
    handlerContext(database),
  );
  const firstAgain = await listCouponAdminQueuePageHandler(
    request(
      {queueKind: "pendingApplications"},
      {pageSize: 25, direction: "first", clientRequestId: "pending-first"},
    ),
    handlerContext(database),
  );
  assert.deepEqual(previous.items.map((item) => item.id), first.items.map((item) => item.id));
  assert.deepEqual(last.items.map((item) => item.id), second.items.map((item) => item.id));
  assert.deepEqual(firstAgain.items.map((item) => item.id), first.items.map((item) => item.id));
  const allIds = [...first.items, ...second.items].map((item) => item.id);
  assert.equal(allIds.length, 27);
  assert.equal(new Set(allIds).size, 27);
  assert.equal(allIds.includes("pending-legacy"), true);
  assert.equal(database.counts.every((count) => count.filters.length === 1), true);
  assert.equal(database.queries.every((query) => query.limit <= 26), true);
});

test("name-change and report queues use exact status filters and stable timestamp order", async () => {
  const database = new FakePagingDatabase({
    restaurant_name_change_requests: [
      dated("name-old", 1, {status: "pending", userId: "u1", currentRestaurantName: "A", requestedRestaurantName: "B"}),
      dated("name-new", 2, {status: "pending", userId: "u2", currentRestaurantName: "C", requestedRestaurantName: "D"}),
      dated("name-done", 3, {status: "approved"}),
    ],
    bitesaver_reports: [
      dated("report-open", 2, {status: "open", reportType: "coupon", restaurantName: "R", couponTitle: "C", restaurantId: "r", couponId: "c", reason: "reason", note: "", reporterUid: "u"}),
      dated("report-closed", 3, {status: "reviewed"}),
    ],
  });
  const names = await listCouponAdminQueuePageHandler(
    request({queueKind: "nameChanges"}, {pageSize: 25}),
    handlerContext(database),
  );
  const reports = await listCouponAdminQueuePageHandler(
    request({queueKind: "openReports"}, {pageSize: 25}),
    handlerContext(database),
  );
  assert.deepEqual(names.items.map((item) => item.id), ["name-new", "name-old"]);
  assert.deepEqual(names.total, {state: "exact", value: 2});
  assert.deepEqual(reports.items.map((item) => item.id), ["report-open"]);
  assert.deepEqual(reports.total, {state: "exact", value: 1});
});

test("coupon pages are restaurant-scoped, exact, stable, and read at most 26", async () => {
  const coupons = Array.from({length: 30}, (_, index) => dated(`coupon-${index}`, index, {
    title: `Coupon ${index}`,
    restaurant: "Restaurant",
    expires: "Soon",
    usageRule: "Once",
    couponNumber: `${index}`,
    isProximityOnly: false,
    proximityRadiusMiles: null,
    details: null,
    imageUrl: null,
  }));
  const database = new FakePagingDatabase({
    "restaurant_accounts/restaurant-one/coupons": coupons,
    "restaurant_accounts/restaurant-two/coupons": [dated("other", 99, {})],
  });
  const page = await listCouponAdminCouponsPageHandler(
    request({restaurantAccountId: "restaurant-one"}, {pageSize: 25}),
    handlerContext(database),
  );
  assert.equal(page.items.length, 25);
  assert.equal(page.items[0].id, "coupon-29");
  assert.deepEqual(page.total, {state: "exact", value: 30});
  assert.equal(database.queries[0].collectionPath, "restaurant_accounts/restaurant-one/coupons");
  assert.equal(database.queries[0].limit, 26);
  assert.equal(typeof database.write, "undefined");
});

test("Coupon invite history filters before reads and omits token material", async () => {
  const invites = Array.from({length: 55}, (_, index) => dated(`invite-${index}`, index, {
    type: "coupon_invite",
    side: "coupon",
    status: "active",
    restaurantId: `r-${index}`,
    pendingRestaurantKey: "",
    restaurantName: `Restaurant ${index}`,
    createdByEmail: "admin@example.test",
    expiresAt: new Date(nowMs + 1000),
    usedAt: null,
    revokedAt: null,
    maxUses: 1,
    useCount: 0,
    token: "plaintext-canary",
    tokenHash: "hash-canary",
  }));
  invites.push(dated("rating", 100, {side: "bitescore"}));
  const database = new FakePagingDatabase({restaurant_invites: invites});
  const page = await listCouponAdminInviteHistoryPageHandler(
    request({side: "coupon"}),
    handlerContext(database),
  );
  assert.equal(page.items.length, 50);
  assert.deepEqual(page.total, {state: "exact", value: 55});
  assert.equal(database.queries[0].limit, 51);
  assert.deepEqual(database.queries[0].filters, [{field: "side", operation: "==", value: "coupon"}]);
  const serialized = JSON.stringify(page);
  assert.equal(serialized.includes("plaintext-canary"), false);
  assert.equal(serialized.includes("hash-canary"), false);
});

test("strict criteria and cursor binding reject unknown fields and another caller", async () => {
  const database = restaurantDatabase(60);
  await assert.rejects(
    searchCouponAdminRestaurantsPageHandler(
      request({mode: "exactZip", zipCode: "01234", unexpected: true}),
      handlerContext(database),
    ),
    (error) => error.code === "invalid-argument",
  );
  const first = await searchCouponAdminRestaurantsPageHandler(
    request({mode: "exactZip", zipCode: "01234"}),
    handlerContext(database),
  );
  await assert.rejects(
    searchCouponAdminRestaurantsPageHandler(
      request(
        {mode: "exactZip", zipCode: "01234"},
        {direction: "forward", cursor: first.nextCursor, clientRequestId: "wrong-caller"},
      ),
      handlerContext(database, {adminUid: "another-admin"}),
    ),
    (error) => error.code === "invalid-argument",
  );
});

class FakeRadiusStore {
  constructor() {
    this.sessions = new Map();
    this.results = new Map();
    this.maximumAdvanceReads = 0;
    this.lastSession = null;
  }
  async createSession(session) {
    this.sessions.set(session.id, session);
    this.results.set(session.id, new Map());
    this.lastSession = session.id;
  }
  async getSession(id) { return this.sessions.get(id) ?? null; }
  async getActiveSession() { return this.sessions.get(this.lastSession) ?? null; }
  async claimSession(input) {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error("missing");
    if (session.lastCompletedRequestId === input.clientRequestId) {
      return {status: "duplicate", session};
    }
    if (session.leaseToken && session.leaseUntilMs > input.nowMs) {
      return {status: "busy", session};
    }
    const claimed = {...session, leaseToken: input.leaseToken, leaseUntilMs: input.nowMs + 30000};
    this.sessions.set(session.id, claimed);
    return {status: "claimed", session: claimed};
  }
  async touchReadySession(input) {
    const session = this.sessions.get(input.sessionId);
    const next = {
      ...session,
      lastUsedAtMs: input.nowMs,
      idleExpiresAtMs: Math.min(
        input.nowMs + couponAdminRadiusIdleLifetimeMs,
        session.absoluteExpiresAtMs,
      ),
    };
    this.sessions.set(input.sessionId, next);
    return next;
  }
  async writeResults(sessionId, results) {
    const target = this.results.get(sessionId);
    for (const result of results) target.set(result.id, result);
  }
  async finishAdvance(input) {
    const session = this.sessions.get(input.sessionId);
    this.maximumAdvanceReads = Math.max(this.maximumAdvanceReads, input.documentsRead);
    const next = {
      ...session,
      state: input.state,
      ranges: input.ranges,
      leaseToken: null,
      leaseUntilMs: null,
      lastCompletedRequestId: input.clientRequestId,
      scannedDocumentCount: session.scannedDocumentCount + input.documentsRead,
      resultCount: input.resultCount,
    };
    this.sessions.set(input.sessionId, next);
    return next;
  }
  async failAdvance(input) {
    const session = this.sessions.get(input.sessionId);
    this.sessions.set(input.sessionId, {...session, state: "failed", leaseToken: null, leaseUntilMs: null});
  }
  async queryResults(input) {
    let documents = [...this.results.get(input.sessionId).values()].map((result) => ({
      id: result.id,
      data: result,
    }));
    documents.sort((a, b) =>
      compareValues(a.data.distanceMillimeters, b.data.distanceMillimeters) ||
      compareValues(a.data.normalizedName, b.data.normalizedName) ||
      compareValues(a.data.sourceDocumentId, b.data.sourceDocumentId));
    if (input.cursor) {
      const compare = (document) =>
        compareValues(document.data.distanceMillimeters, input.cursor.values[0]) ||
        compareValues(document.data.normalizedName, input.cursor.values[1]) ||
        compareValues(document.data.sourceDocumentId, input.cursor.values[2]);
      documents = documents.filter((document) => input.cursor.kind === "startAfter" ? compare(document) > 0 : compare(document) < 0);
    }
    return input.limitToLast ? documents.slice(-input.limit) : documents.slice(0, input.limit);
  }
  async countResults(sessionId) { return this.results.get(sessionId).size; }
}

test("radius sessions exceed 135, advance in bounded calls, deduplicate, and become exactly paged", async () => {
  const center = {latitude: 28.8517, longitude: -82.487, displayName: "Crystal River, FL"};
  const geohash = canonicalRestaurantGeohash(center);
  const database = restaurantDatabase(520, (document, number) => {
    document.data.geohash = geohash;
    document.data.latitude = center.latitude + (number % 2) * 0.000001;
    document.data.longitude = center.longitude;
  });
  const store = new FakeRadiusStore();
  const context = handlerContext(database, {
    radiusStore: store,
    geocodeLocation: async () => center,
    sessionIdSource: () => "radius-session-one",
    leaseTokenSource: () => "lease-one",
  });
  const criteria = {mode: "nearbyRadius", locationQuery: "Crystal River, FL", radiusMiles: 10};
  let page = await searchCouponAdminRadiusRestaurantsPage(request(criteria), context);
  assert.equal(page.preparation.state, "preparing");
  assert.equal(page.items.length, 0);
  assert.equal(store.maximumAdvanceReads, couponAdminRadiusReadBudget);
  page = await searchCouponAdminRadiusRestaurantsPage(
    request(criteria, {direction: "forward", cursor: page.nextCursor, clientRequestId: "advance-2"}),
    context,
  );
  assert.equal(page.preparation.state, "ready");
  assert.deepEqual(page.total, {state: "exact", value: 520});
  assert.equal(page.items.length, 50);
  assert.equal(store.maximumAdvanceReads <= 450, true);
  const seen = new Set(page.items.map((item) => item.documentId));
  for (let index = 0; index < 4; index += 1) {
    page = await searchCouponAdminRadiusRestaurantsPage(
      request(criteria, {direction: "forward", cursor: page.nextCursor, clientRequestId: `page-${index}`}),
      context,
    );
    page.items.forEach((item) => seen.add(item.documentId));
  }
  assert.equal(seen.size, 250);
  const previous = await searchCouponAdminRadiusRestaurantsPage(
    request(criteria, {
      direction: "backward",
      cursor: page.previousCursor,
      clientRequestId: "radius-previous",
    }),
    context,
  );
  assert.equal(previous.currentPageNumber, 4);
  assert.equal(previous.items.length, 50);
  const last = await searchCouponAdminRadiusRestaurantsPage(
    request(criteria, {direction: "last", clientRequestId: "radius-last"}),
    context,
  );
  assert.equal(last.currentPageNumber, 11);
  assert.equal(last.items.length, 20);
  assert.equal(couponAdminRadiusIdleLifetimeMs, 15 * 60 * 1000);
  assert.equal(couponAdminRadiusAbsoluteLifetimeMs, 60 * 60 * 1000);
});

test("radius session wrong caller and expiry fail closed", async () => {
  const center = {latitude: 28.8517, longitude: -82.487, displayName: "Center"};
  const database = restaurantDatabase(460, (document) => {
    document.data.geohash = canonicalRestaurantGeohash(center);
    document.data.latitude = center.latitude;
    document.data.longitude = center.longitude;
  });
  const store = new FakeRadiusStore();
  const context = handlerContext(database, {
    radiusStore: store,
    geocodeLocation: async () => center,
    sessionIdSource: () => "radius-session-two",
    leaseTokenSource: () => "lease-two",
  });
  const criteria = {mode: "nearbyRadius", locationQuery: "Center", radiusMiles: 10};
  const page = await searchCouponAdminRadiusRestaurantsPage(request(criteria), context);
  await assert.rejects(
    searchCouponAdminRadiusRestaurantsPage(
      request(criteria, {direction: "forward", cursor: page.nextCursor, clientRequestId: "wrong"}),
      {...context, adminUid: "wrong-admin"},
    ),
    (error) => error.code === "failed-precondition",
  );
  await assert.rejects(
    searchCouponAdminRadiusRestaurantsPage(
      request(
        {...criteria, locationQuery: "Different Center"},
        {direction: "forward", cursor: page.nextCursor, clientRequestId: "wrong-query"},
      ),
      context,
    ),
    (error) => error.code === "failed-precondition",
  );
  await assert.rejects(
    searchCouponAdminRadiusRestaurantsPage(
      request(criteria, {direction: "forward", cursor: page.nextCursor, clientRequestId: "expired"}),
      {...context, now: () => nowMs + couponAdminRadiusIdleLifetimeMs + 1},
    ),
    (error) => error.code === "failed-precondition",
  );
});

test("radius exact distance rejects a geohash candidate outside the circle", async () => {
  const center = {latitude: 28.8517, longitude: -82.487, displayName: "Center"};
  const database = restaurantDatabase(2, (document, number) => {
    document.data.geohash = canonicalRestaurantGeohash(center);
    document.data.latitude = number === 0 ? center.latitude : center.latitude + 2;
    document.data.longitude = center.longitude;
  });
  const store = new FakeRadiusStore();
  const context = handlerContext(database, {
    radiusStore: store,
    geocodeLocation: async () => center,
    sessionIdSource: () => "radius-distance",
    leaseTokenSource: () => "lease-distance",
  });
  const page = await searchCouponAdminRadiusRestaurantsPage(
    request({mode: "nearbyRadius", locationQuery: "Center", radiusMiles: 10}),
    context,
  );
  assert.equal(page.preparation.state, "ready");
  assert.deepEqual(page.total, {state: "exact", value: 1});
  assert.deepEqual(page.items.map((item) => item.documentId), ["r0000"]);
});

test("simultaneous radius continuations cannot double-advance a session", async () => {
  const center = {latitude: 28.8517, longitude: -82.487, displayName: "Center"};
  const geohash = canonicalRestaurantGeohash(center);
  const database = restaurantDatabase(950, (document) => {
    document.data.geohash = geohash;
    document.data.latitude = center.latitude;
    document.data.longitude = center.longitude;
  });
  const store = new FakeRadiusStore();
  let leaseNumber = 0;
  const context = handlerContext(database, {
    radiusStore: store,
    geocodeLocation: async () => center,
    sessionIdSource: () => "radius-concurrent",
    leaseTokenSource: () => `lease-${++leaseNumber}`,
  });
  const criteria = {mode: "nearbyRadius", locationQuery: "Center", radiusMiles: 10};
  const first = await searchCouponAdminRadiusRestaurantsPage(request(criteria), context);
  assert.equal(first.preparation.state, "preparing");
  const [one, two] = await Promise.all([
    searchCouponAdminRadiusRestaurantsPage(
      request(criteria, {direction: "forward", cursor: first.nextCursor, clientRequestId: "concurrent-one"}),
      context,
    ),
    searchCouponAdminRadiusRestaurantsPage(
      request(criteria, {direction: "forward", cursor: first.nextCursor, clientRequestId: "concurrent-two"}),
      context,
    ),
  ]);
  assert.equal([one, two].filter((page) => page.preparation.state === "preparing").length, 2);
  const session = await store.getSession("radius-concurrent");
  assert.equal(session.scannedDocumentCount, 900);
  assert.equal(store.results.get("radius-concurrent").size, 900);
  assert.equal(store.maximumAdvanceReads, 450);
  const finished = await searchCouponAdminRadiusRestaurantsPage(
    request(criteria, {direction: "forward", cursor: first.nextCursor, clientRequestId: "finish"}),
    context,
  );
  assert.equal(finished.preparation.state, "ready");
  assert.deepEqual(finished.total, {state: "exact", value: 950});
});
