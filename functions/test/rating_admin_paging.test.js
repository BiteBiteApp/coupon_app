"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  listRatingAdminDirectoryPageHandler,
  listRatingAdminInviteHistoryPageHandler,
  listRatingAdminQueuePageHandler,
  ratingAdminCursorSecretName,
  ratingAdminDirectoryPageSize,
  ratingAdminInvitePageSize,
  ratingAdminQueuePageSize,
  ratingAdminRestaurantPageSize,
} = require("../lib/rating_admin_paging.js");
const {
  searchRatingAdminRestaurantsPageHandler,
} = require("../lib/rating_admin_restaurant_search.js");
const {
  ratingAdminRadiusAbsoluteLifetimeMs,
  ratingAdminRadiusIdleLifetimeMs,
  ratingAdminRadiusReadBudget,
  searchRatingAdminRadiusRestaurantsPage,
} = require("../lib/rating_admin_radius_sessions.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");

const secret = "A".repeat(43);
const nowMs = Date.UTC(2026, 7, 8, 12);

function request(criteria, pageSize = 50, overrides = {}) {
  return {
    protocolVersion: "bitestar.page.v1",
    pageSize,
    criteria,
    direction: "first",
    requestExactCount: true,
    clientRequestId: "rating-request-1",
    ...overrides,
  };
}

function scalar(value) {
  return value instanceof Date ? value.getTime() : value;
}

function compare(first, second) {
  const a = scalar(first);
  const b = scalar(second);
  return a < b ? -1 : a > b ? 1 : 0;
}

function field(document, name) {
  return name === "__name__" ? document.id : document.data[name];
}

class FakeDatabase {
  constructor(collections = {}, sources = {}) {
    this.collections = collections;
    this.sources = sources;
    this.queries = [];
    this.gets = [];
    this.counts = [];
  }

  matching(path, filters) {
    return [...(this.collections[path] ?? [])].filter((document) =>
      filters.every((filter) => {
        const value = field(document, filter.field);
        if (filter.operation === "==") return value === filter.value;
        if (filter.operation === "array-contains") {
          return Array.isArray(value) && value.includes(filter.value);
        }
        if (filter.operation === ">=") return compare(value, filter.value) >= 0;
        if (filter.operation === "<=") return compare(value, filter.value) <= 0;
        return false;
      }),
    );
  }

  async queryDocuments(query) {
    this.queries.push(query);
    let documents = this.matching(query.collectionPath, query.filters);
    documents = documents.filter((document) =>
      query.orders.every((order) =>
        order.field === "__name__" || Object.hasOwn(document.data, order.field)),
    );
    documents.sort((first, second) => {
      for (const order of query.orders) {
        const result = compare(field(first, order.field), field(second, order.field));
        if (result !== 0) return order.direction === "desc" ? -result : result;
      }
      return 0;
    });
    if (query.cursor) {
      const compareCursor = (document) => {
        for (let index = 0; index < query.orders.length; index += 1) {
          const order = query.orders[index];
          const result = compare(
            field(document, order.field),
            query.cursor.values[index],
          );
          if (result !== 0) return order.direction === "desc" ? -result : result;
        }
        return 0;
      };
      documents = documents.filter((document) =>
        query.cursor.kind === "startAfter"
          ? compareCursor(document) > 0
          : compareCursor(document) < 0,
      );
    }
    return query.limitToLast
      ? documents.slice(-query.limit)
      : documents.slice(0, query.limit);
  }

  async countDocuments(value) {
    this.counts.push(value);
    return this.matching(value.collectionPath, value.filters).length;
  }

  async getDocuments(paths) {
    this.gets.push(paths);
    return paths
      .map((path) => this.sources[path])
      .filter((document) => document !== undefined);
  }
}

function context(database, overrides = {}) {
  return {
    adminUid: "admin-1",
    cursorSecret: secret,
    database,
    now: () => nowMs,
    nonceSource: () => new Uint8Array(12).fill(7),
    ...overrides,
  };
}

function restaurantSource(id, overrides = {}) {
  return {
    id,
    data: {
      name: "Restaurant " + id,
      normalizedName: "restaurant " + id,
      address: "1 Main St",
      city: "Orlando",
      state: "FL",
      zipCode: "32801",
      latitude: 28.5,
      longitude: -81.3,
      isActive: true,
      isClaimed: false,
      ...overrides,
    },
  };
}

test("Rating Admin constants preserve the shared protocol sizes and secret", () => {
  assert.equal(ratingAdminCursorSecretName, "SEARCH_PAGINATION_CURSOR_KEY");
  assert.equal(ratingAdminRestaurantPageSize, 50);
  assert.equal(ratingAdminDirectoryPageSize, 50);
  assert.equal(ratingAdminQueuePageSize, 25);
  assert.equal(ratingAdminInvitePageSize, 50);
});

test("missing secret and unknown restaurant criteria fail before reads", async () => {
  const database = new FakeDatabase();
  const criteria = {
    mode: "exactZip",
    zipCode: "32801",
    status: "all",
  };
  await assert.rejects(
    searchRatingAdminRestaurantsPageHandler(
      request(criteria),
      context(database, {cursorSecret: ""}),
    ),
    /not configured/,
  );
  await assert.rejects(
    searchRatingAdminRestaurantsPageHandler(
      request({...criteria, uid: "attacker"}),
      context(database),
    ),
    /criteria are invalid/,
  );
  assert.equal(database.queries.length, 0);
  assert.equal(database.gets.length, 0);
});

test("directory, queue, and invite criteria reject unknown kinds before reads", async () => {
  const database = new FakeDatabase();
  await assert.rejects(
    listRatingAdminDirectoryPageHandler(
      request({directoryKind: "reviews", unexpected: true}),
      context(database),
    ),
    /criteria are invalid/,
  );
  await assert.rejects(
    listRatingAdminQueuePageHandler(
      request({queueKind: "arbitrary_collection"}, 25),
      context(database),
    ),
    /queue kind is invalid/,
  );
  await assert.rejects(
    listRatingAdminInviteHistoryPageHandler(
      request({side: "coupon"}),
      context(database),
    ),
    /invite side is invalid/,
  );
  assert.equal(database.queries.length, 0);
  assert.equal(database.counts.length, 0);
  assert.equal(database.gets.length, 0);
});

test("exact ZIP reaches all 250 records and enriches only selected sources", async () => {
  const indexes = [];
  const sources = {};
  for (let index = 0; index < 250; index += 1) {
    const id = "restaurant-" + index.toString().padStart(3, "0");
    indexes.push({
      id: "index-" + id,
      data: {
        source: "biteScore",
        adminDirectoryVisible: true,
        zip5: "32801",
        normalizedName: "restaurant " + index.toString().padStart(3, "0"),
        sourceDocumentId: id,
        isActive: true,
      },
    });
    sources["bitescore_restaurants/" + id] = restaurantSource(id);
  }
  const database = new FakeDatabase(
    {restaurant_search_index: indexes},
    sources,
  );
  const criteria = {
    mode: "exactZip",
    zipCode: "32801",
    status: "all",
  };
  const first = await searchRatingAdminRestaurantsPageHandler(
    request(criteria),
    context(database),
  );
  assert.equal(first.items.length, 50);
  assert.equal(first.total.value, 250);
  assert.equal(first.hasNext, true);
  assert.equal(database.queries[0].limit, 51);
  assert.equal(database.gets[0].length, 50);
  const pages = [first];
  while (pages.at(-1).hasNext) {
    const prior = pages.at(-1);
    pages.push(await searchRatingAdminRestaurantsPageHandler(
      request(criteria, 50, {
        direction: "forward",
        cursor: prior.nextCursor,
        clientRequestId: "rating-request-" + (pages.length + 1),
      }),
      context(database),
    ));
  }
  assert.equal(pages.length, 5);
  assert.equal(new Set(pages.flatMap((page) => page.items).map((item) =>
    item.documentId)).size, 250);
  assert.equal(database.gets.every((paths) => paths.length <= 50), true);
});

test("exact City + State excludes the same city in another state", async () => {
  const indexes = [
    ["springfield-fl", "FL|springfield"],
    ["springfield-il", "IL|springfield"],
  ].map(([id, cityStateKey]) => ({
    id: "index-" + id,
    data: {
      source: "biteScore",
      adminDirectoryVisible: true,
      cityStateKey,
      normalizedName: id,
      sourceDocumentId: id,
      isActive: true,
    },
  }));
  const database = new FakeDatabase(
    {restaurant_search_index: indexes},
    {
      "bitescore_restaurants/springfield-fl": restaurantSource(
        "springfield-fl",
        {latitude: undefined, longitude: undefined},
      ),
      "bitescore_restaurants/springfield-il": restaurantSource(
        "springfield-il",
      ),
    },
  );
  const page = await searchRatingAdminRestaurantsPageHandler(
    request({
      mode: "exactCity",
      city: "Springfield",
      state: "fl",
      status: "all",
    }),
    context(database),
  );
  assert.deepEqual(page.items.map((item) => item.documentId), [
    "springfield-fl",
  ]);
  assert.equal(page.items[0].latitude, null);
  assert.equal(page.items[0].longitude, null);
});

test("active and inactive predicates are server-side and source rechecked", async () => {
  const indexes = [
    {
      id: "active-index",
      data: {
        source: "biteScore",
        adminDirectoryVisible: true,
        zip5: "32801",
        normalizedName: "active",
        sourceDocumentId: "active",
        isActive: true,
      },
    },
    {
      id: "hidden-index",
      data: {
        source: "biteScore",
        adminDirectoryVisible: true,
        zip5: "32801",
        normalizedName: "hidden",
        sourceDocumentId: "hidden",
        isActive: false,
      },
    },
  ];
  const database = new FakeDatabase(
    {restaurant_search_index: indexes},
    {
      "bitescore_restaurants/active": restaurantSource("active"),
      "bitescore_restaurants/hidden": restaurantSource(
        "hidden",
        {isActive: false},
      ),
    },
  );
  const page = await searchRatingAdminRestaurantsPageHandler(
    request({
      mode: "exactZip",
      zipCode: "32801",
      status: "inactive",
    }),
    context(database),
  );
  assert.deepEqual(page.items.map((item) => item.documentId), ["hidden"]);
  assert.deepEqual(
    database.queries[0].filters.find((filter) => filter.field === "isActive"),
    {field: "isActive", operation: "==", value: false},
  );
});

test("dish pages are index-scoped by exact restaurant ID", async () => {
  const indexes = ["a", "b"].map((restaurantId) => ({
    id: "dish-index-" + restaurantId,
    data: {
      source: "biteScore",
      adminVisible: true,
      restaurantSourceDocumentId: restaurantId,
      normalizedName: "same dish",
      sourceDocumentId: "dish-" + restaurantId,
      dishActive: true,
    },
  }));
  const sources = Object.fromEntries(["a", "b"].map((restaurantId) => [
    "bitescore_dishes/dish-" + restaurantId,
    {
      id: "dish-" + restaurantId,
      data: {
        restaurantId,
        restaurantName: "Restaurant " + restaurantId,
        name: "Same Dish",
        normalizedName: "same dish",
        isActive: true,
      },
    },
  ]));
  const database = new FakeDatabase({dish_search_index: indexes}, sources);
  const page = await listRatingAdminDirectoryPageHandler(
    request({
      directoryKind: "dishesByRestaurant",
      restaurantId: "a",
      status: "all",
    }),
    context(database),
  );
  assert.deepEqual(page.items.map((item) => item.id), ["dish-a"]);
  assert.equal(database.gets[0].length, 1);
});

test("active dish pages expose exact 50 + next bounds", async () => {
  const indexes = [];
  const sources = {};
  for (let index = 0; index < 51; index += 1) {
    const id = "dish-" + index.toString().padStart(2, "0");
    indexes.push({
      id: "index-" + id,
      data: {
        source: "biteScore",
        adminVisible: true,
        restaurantSourceDocumentId: "restaurant-a",
        normalizedName: id,
        sourceDocumentId: id,
        dishActive: true,
      },
    });
    sources["bitescore_dishes/" + id] = {
      id,
      data: {
        restaurantId: "restaurant-a",
        restaurantName: "Restaurant A",
        name: id,
        normalizedName: id,
        isActive: true,
      },
    };
  }
  const database = new FakeDatabase({dish_search_index: indexes}, sources);
  const criteria = {
    directoryKind: "dishesByRestaurant",
    restaurantId: "restaurant-a",
    status: "active",
  };
  const first = await listRatingAdminDirectoryPageHandler(
    request(criteria),
    context(database),
  );
  assert.equal(first.items.length, 50);
  assert.deepEqual(first.total, {state: "exact", value: 51});
  assert.equal(first.hasNext, true);
  assert.equal(database.queries[0].limit, 51);
  assert.equal(database.gets[0].length, 50);
  const second = await listRatingAdminDirectoryPageHandler(
    request(criteria, 50, {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "dish-next",
    }),
    context(database),
  );
  assert.deepEqual(second.items.map((item) => item.id), ["dish-50"]);
});

test("review pages load only page-referenced dish, restaurant, and profile", async () => {
  const createdAt = new Date(nowMs - 1000);
  const database = new FakeDatabase(
    {
      dish_reviews: [{
        id: "review-1",
        data: {
          dishId: "dish-1",
          restaurantId: "restaurant-1",
          userId: "user-1",
          overallImpression: 8,
          overallBiteScore: 80,
          createdAt,
        },
      }],
    },
    {
      "bitescore_dishes/dish-1": {
        id: "dish-1",
        data: {name: "Dish"},
      },
      "bitescore_restaurants/restaurant-1": restaurantSource(
        "restaurant-1",
        {name: "Restaurant"},
      ),
      "public_reviewer_profiles/user-1": {
        id: "user-1",
        data: {publicDisplayName: "Reviewer"},
      },
    },
  );
  const page = await listRatingAdminDirectoryPageHandler(
    request({directoryKind: "reviews"}),
    context(database),
  );
  assert.equal(page.items[0].reviewerDisplayName, "Reviewer");
  assert.deepEqual(database.gets.map((paths) => paths.length), [1, 1, 1]);
  assert.equal(database.queries[0].limit, 51);
});

test("all five queues enforce pending status, size 25, and page-only targets", async () => {
  const createdAt = new Date(nowMs - 1000);
  const fixtures = [
    ["reportedReviews", "review_reports", {
      reviewId: "review-1",
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      reportingUserId: "reporter",
    }],
    ["restaurantReports", "restaurant_reports", {
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant",
      reportingUserId: "reporter",
    }],
    ["dishReports", "dish_reports", {
      dishId: "dish-1",
      dishName: "Dish",
      restaurantId: "restaurant-1",
      reportingUserId: "reporter",
    }],
    ["duplicateRestaurantReports", "duplicate_restaurant_reports", {
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant",
      reportingUserId: "reporter",
    }],
    ["claims", "restaurant_claim_requests", {
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant",
      requesterUserId: "user-1",
      claimantName: "Owner",
      email: "owner@example.com",
      phone: "5555555555",
    }],
  ];
  for (const [kind, collection, fields] of fixtures) {
    const database = new FakeDatabase(
      {
        [collection]: [{
          id: kind + "-1",
          data: {...fields, status: "pending", createdAt},
        }],
      },
      {
        "dish_reviews/review-1": {
          id: "review-1",
          data: {
            dishId: "dish-1",
            restaurantId: "restaurant-1",
            userId: "user-1",
            overallImpression: 8,
            overallBiteScore: 80,
            createdAt,
          },
        },
        "bitescore_dishes/dish-1": {
          id: "dish-1",
          data: {
            restaurantId: "restaurant-1",
            restaurantName: "Restaurant",
            name: "Dish",
            normalizedName: "dish",
            isActive: true,
          },
        },
        "bitescore_restaurants/restaurant-1": restaurantSource(
          "restaurant-1",
          {name: "Restaurant"},
        ),
        "public_reviewer_profiles/user-1": {
          id: "user-1",
          data: {publicDisplayName: "Reviewer"},
        },
      },
    );
    const page = await listRatingAdminQueuePageHandler(
      request({queueKind: kind}, 25),
      context(database),
    );
    assert.equal(page.items.length, 1, kind);
    assert.equal(database.queries[0].collectionPath, collection, kind);
    assert.equal(database.queries[0].limit, 26, kind);
    assert.deepEqual(database.queries[0].filters, [{
      field: "status",
      operation: "==",
      value: "pending",
    }], kind);
  }
});

test("claimed restaurants page 50 + next with page-bounded claim lookups", async () => {
  const indexes = [];
  const sources = {};
  for (let index = 0; index < 51; index += 1) {
    const id = "claimed-" + index.toString().padStart(2, "0");
    indexes.push({
      id: "index-" + id,
      data: {
        source: "biteScore",
        adminDirectoryVisible: true,
        isClaimed: true,
        normalizedName: id,
        sourceDocumentId: id,
      },
    });
    sources["bitescore_restaurants/" + id] = restaurantSource(id, {
      isClaimed: true,
      ownerUserId: "owner-" + id,
    });
  }
  const database = new FakeDatabase(
    {
      restaurant_search_index: indexes,
      restaurant_claim_requests: [],
    },
    sources,
  );
  const criteria = {directoryKind: "claimedRestaurants"};
  const first = await listRatingAdminDirectoryPageHandler(
    request(criteria),
    context(database),
  );
  assert.equal(first.items.length, 50);
  assert.deepEqual(first.total, {state: "exact", value: 51});
  assert.equal(first.hasNext, true);
  assert.equal(database.gets[0].length, 50);
  assert.equal(
    database.queries.filter((query) =>
      query.collectionPath === "restaurant_claim_requests").length,
    50,
  );
  const second = await listRatingAdminDirectoryPageHandler(
    request(criteria, 50, {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "claimed-next",
    }),
    context(database),
  );
  assert.equal(second.items.length, 1);
});

test("invite history filters BiteScore before reads and omits token material", async () => {
  const createdAt = new Date(nowMs - 1000);
  const database = new FakeDatabase({
    restaurant_invites: [
      {
        id: "rating-invite",
        data: {
          side: "bitescore",
          type: "claim",
          status: "active",
          restaurantId: "restaurant-1",
          restaurantName: "Restaurant",
          token: "must-not-return",
          tokenHash: "must-not-return",
          createdAt,
        },
      },
      {
        id: "coupon-invite",
        data: {side: "coupon", status: "active", createdAt},
      },
    ],
  });
  const page = await listRatingAdminInviteHistoryPageHandler(
    request({side: "bitescore"}),
    context(database),
  );
  assert.deepEqual(page.items.map((item) => item.id), ["rating-invite"]);
  assert.equal(JSON.stringify(page).includes("must-not-return"), false);
  assert.deepEqual(database.queries[0].filters, [{
    field: "side",
    operation: "==",
    value: "bitescore",
  }]);
  assert.equal(database.queries[0].limit, 51);
});

test("invite history returns 50 + next with an exact BiteScore count", async () => {
  const invites = [];
  for (let index = 0; index < 51; index += 1) {
    invites.push({
      id: "invite-" + index.toString().padStart(2, "0"),
      data: {
        side: "bitescore",
        type: "claim",
        status: "active",
        restaurantId: "restaurant-1",
        restaurantName: "Restaurant",
        createdAt: new Date(nowMs - index),
      },
    });
  }
  const database = new FakeDatabase({restaurant_invites: invites});
  const criteria = {side: "bitescore"};
  const first = await listRatingAdminInviteHistoryPageHandler(
    request(criteria),
    context(database),
  );
  assert.equal(first.items.length, 50);
  assert.deepEqual(first.total, {state: "exact", value: 51});
  assert.equal(first.hasNext, true);
  const second = await listRatingAdminInviteHistoryPageHandler(
    request(criteria, 50, {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "invite-next",
    }),
    context(database),
  );
  assert.equal(second.items.length, 1);
});

test("cursor binding rejects another Admin caller", async () => {
  const indexes = [];
  const sources = {};
  for (let index = 0; index < 51; index += 1) {
    const id = "r-" + index.toString().padStart(2, "0");
    indexes.push({
      id: "i-" + id,
      data: {
        source: "biteScore",
        adminDirectoryVisible: true,
        zip5: "32801",
        normalizedName: id,
        sourceDocumentId: id,
        isActive: true,
      },
    });
    sources["bitescore_restaurants/" + id] = restaurantSource(id);
  }
  const database = new FakeDatabase(
    {restaurant_search_index: indexes},
    sources,
  );
  const criteria = {
    mode: "exactZip",
    zipCode: "32801",
    status: "all",
  };
  const first = await searchRatingAdminRestaurantsPageHandler(
    request(criteria),
    context(database),
  );
  await assert.rejects(
    searchRatingAdminRestaurantsPageHandler(
      request(criteria, 50, {
        direction: "forward",
        cursor: first.nextCursor,
      }),
      context(database, {adminUid: "another-admin"}),
    ),
    /cursor is invalid/,
  );
});

class FakeRadiusStore {
  constructor() {
    this.sessions = new Map();
    this.results = new Map();
    this.lastSession = null;
    this.maximumAdvanceReads = 0;
  }

  async createSession(session) {
    this.sessions.set(session.id, session);
    this.results.set(session.id, new Map());
    this.lastSession = session.id;
  }

  async getSession(id) {
    return this.sessions.get(id) ?? null;
  }

  async getActiveSession() {
    return this.sessions.get(this.lastSession) ?? null;
  }

  async claimSession(input) {
    const session = this.sessions.get(input.sessionId);
    if (session.lastCompletedRequestId === input.clientRequestId) {
      return {status: "duplicate", session};
    }
    if (session.leaseToken && session.leaseUntilMs > input.nowMs) {
      return {status: "busy", session};
    }
    const claimed = {
      ...session,
      leaseToken: input.leaseToken,
      leaseUntilMs: input.nowMs + 30000,
    };
    this.sessions.set(session.id, claimed);
    return {status: "claimed", session: claimed};
  }

  async touchReadySession(input) {
    const session = this.sessions.get(input.sessionId);
    const next = {
      ...session,
      lastUsedAtMs: input.nowMs,
      idleExpiresAtMs: Math.min(
        input.nowMs + ratingAdminRadiusIdleLifetimeMs,
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
    this.maximumAdvanceReads = Math.max(
      this.maximumAdvanceReads,
      input.documentsRead,
    );
    const next = {
      ...session,
      state: input.state,
      ranges: input.ranges,
      leaseToken: null,
      leaseUntilMs: null,
      lastCompletedRequestId: input.clientRequestId,
      scannedDocumentCount:
        session.scannedDocumentCount + input.documentsRead,
      resultCount: input.resultCount,
    };
    this.sessions.set(input.sessionId, next);
    return next;
  }

  async failAdvance(input) {
    const session = this.sessions.get(input.sessionId);
    this.sessions.set(input.sessionId, {
      ...session,
      state: "failed",
      leaseToken: null,
      leaseUntilMs: null,
    });
  }

  async queryResults(input) {
    let documents = [...this.results.get(input.sessionId).values()].map(
      (result) => ({id: result.id, data: result}),
    );
    documents.sort((first, second) =>
      compare(
        first.data.distanceMillimeters,
        second.data.distanceMillimeters,
      ) ||
      compare(first.data.normalizedName, second.data.normalizedName) ||
      compare(first.data.sourceDocumentId, second.data.sourceDocumentId));
    if (input.cursor) {
      const compareCursor = (document) =>
        compare(
          document.data.distanceMillimeters,
          input.cursor.values[0],
        ) ||
        compare(document.data.normalizedName, input.cursor.values[1]) ||
        compare(document.data.sourceDocumentId, input.cursor.values[2]);
      documents = documents.filter((document) =>
        input.cursor.kind === "startAfter"
          ? compareCursor(document) > 0
          : compareCursor(document) < 0);
    }
    return input.limitToLast
      ? documents.slice(-input.limit)
      : documents.slice(0, input.limit);
  }

  async countResults(sessionId) {
    return this.results.get(sessionId).size;
  }
}

test("Rating radius sessions exceed 135 with bounded exhaustive advancement", async () => {
  const center = {
    latitude: 28.8517,
    longitude: -82.487,
    displayName: "Crystal River, FL",
  };
  const geohash = canonicalRestaurantGeohash(center);
  const indexes = [];
  const sources = {};
  for (let index = 0; index < 520; index += 1) {
    const id = "radius-" + index.toString().padStart(4, "0");
    indexes.push({
      id: "index-" + id,
      data: {
        source: "biteScore",
        sourceDocumentId: id,
        adminDirectoryVisible: true,
        isActive: true,
        normalizedName: "restaurant " + index.toString().padStart(4, "0"),
        namePrefixTokens: ["re", "restaurant"],
        geohash,
        latitude: center.latitude + (index % 2) * 0.000001,
        longitude: center.longitude,
      },
    });
    sources["bitescore_restaurants/" + id] = restaurantSource(id, {
      latitude: center.latitude,
      longitude: center.longitude,
    });
  }
  const database = new FakeDatabase(
    {restaurant_search_index: indexes},
    sources,
  );
  const store = new FakeRadiusStore();
  const handler = context(database, {
    radiusStore: store,
    geocodeLocation: async () => center,
    sessionIdSource: () => "rating-radius-session",
    leaseTokenSource: () => "rating-radius-lease",
  });
  const criteria = {
    mode: "nearbyRadius",
    locationQuery: "Crystal River, FL",
    radiusMiles: 10,
    status: "active",
  };
  let result = await searchRatingAdminRadiusRestaurantsPage(
    request(criteria),
    handler,
  );
  assert.equal(result.preparation.state, "preparing");
  assert.equal(result.items.length, 0);
  assert.equal(store.maximumAdvanceReads, ratingAdminRadiusReadBudget);
  result = await searchRatingAdminRadiusRestaurantsPage(
    request(criteria, 50, {
      direction: "forward",
      cursor: result.nextCursor,
      clientRequestId: "rating-radius-advance",
    }),
    handler,
  );
  assert.equal(result.preparation.state, "ready");
  assert.deepEqual(result.total, {state: "exact", value: 520});
  assert.equal(result.items.length, 50);
  assert.equal(store.maximumAdvanceReads <= 450, true);
  assert.equal(ratingAdminRadiusIdleLifetimeMs, 15 * 60 * 1000);
  assert.equal(ratingAdminRadiusAbsoluteLifetimeMs, 60 * 60 * 1000);
});
