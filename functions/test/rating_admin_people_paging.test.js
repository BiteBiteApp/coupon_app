"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  contributionPointLedgerCollection,
  listRatingAdminContributionLedgerPageHandler,
  listRatingAdminUserPointsPageHandler,
  ratingAdminClaimedPreviewDisplayLimit,
  ratingAdminClaimedPreviewLimit,
  ratingAdminPeopleCursorSecretName,
  ratingAdminPeoplePageSize,
  ratingAdminPeoplePostFilterReadBudget,
  searchRatingAdminUsersPageHandler,
} = require("../lib/rating_admin_people_paging.js");
const {
  adminUserClaimedRestaurantCollection,
  adminUserClaimedRestaurantVersion,
  adminUserDirectoryCollection,
  adminUserDirectoryVersion,
} = require("../lib/admin_user_directory_contract.js");

const secret = "A".repeat(43);
const nowMs = Date.UTC(2026, 7, 10, 12);

function request(criteria, overrides = {}) {
  return {
    protocolVersion: "bitestar.page.v1",
    pageSize: 50,
    criteria,
    direction: "first",
    requestExactCount: true,
    clientRequestId: "people-request-1",
    ...overrides,
  };
}

function scalar(value) {
  if (value instanceof Date) return value.getTime();
  if (value === null) return Number.NEGATIVE_INFINITY;
  return value;
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
  constructor(collections = {}) {
    this.collections = collections;
    this.queries = [];
    this.counts = [];
    this.gets = [];
    this.queryReadCounts = [];
  }

  matching(collectionPath, filters) {
    return [...(this.collections[collectionPath] ?? [])].filter((document) =>
      filters.every((filter) => {
        const value = field(document, filter.field);
        if (filter.operation === "==") return value === filter.value;
        if (filter.operation === "array-contains") {
          return Array.isArray(value) && value.includes(filter.value);
        }
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
        for (let index = 0; index < query.cursor.values.length; index += 1) {
          const order = query.orders[index];
          const result = compare(field(document, order.field), query.cursor.values[index]);
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
    const result = query.limitToLast
      ? documents.slice(-query.limit)
      : documents.slice(0, query.limit);
    this.queryReadCounts.push(result.length);
    return result;
  }

  async countDocuments(value) {
    this.counts.push(value);
    return this.matching(value.collectionPath, value.filters).length;
  }

  async getDocuments(paths) {
    this.gets.push(paths);
    const byPath = new Map();
    for (const [collection, documents] of Object.entries(this.collections)) {
      for (const document of documents) {
        byPath.set(`${collection}/${document.id}`, document);
      }
    }
    return paths.map((value) => byPath.get(value)).filter(Boolean);
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

async function resolveClaimedLogicalPage(initialRequest, handlerContext) {
  let currentRequest = initialRequest;
  let candidate = null;
  const responses = [];
  for (let continuation = 0; continuation < 32; continuation += 1) {
    const result = await searchRatingAdminUsersPageHandler(
      currentRequest,
      handlerContext,
    );
    responses.push(result);
    if (result.preparation?.state !== "preparing") {
      if (candidate === null) return {page: result, responses};
      assert.equal(result.preparation?.state, "ready");
      assert.equal(result.items.length, 0);
      const {preparation: ignored, ...candidatePage} = candidate;
      return {
        page: {
          ...candidatePage,
          hasNext: result.hasNext,
          nextCursor: result.nextCursor,
          currentPageNumber: result.currentPageNumber,
          snapshotTimestampMs: result.snapshotTimestampMs,
          capabilities: {
            ...candidate.capabilities,
            first: result.currentPageNumber > 1,
            next: result.hasNext,
            last: false,
          },
        },
        responses,
      };
    }
    if (result.items.length > 0) {
      assert.equal(candidate, null);
      candidate = result;
    }
    assert.equal(result.hasNext, true);
    assert.equal(typeof result.nextCursor, "string");
    currentRequest = request(initialRequest.criteria, {
      direction: "forward",
      cursor: result.nextCursor,
      clientRequestId: `claimed-continuation-${continuation}`,
    });
  }
  throw new Error("Claimed User continuation did not terminate.");
}

async function collectClaimedLogicalPages(criteria, database) {
  const pages = [];
  const allResponses = [];
  let nextRequest = request(criteria);
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const resolved = await resolveClaimedLogicalPage(
      nextRequest,
      context(database),
    );
    pages.push(resolved.page);
    allResponses.push(...resolved.responses);
    if (!resolved.page.hasNext) return {pages, responses: allResponses};
    nextRequest = request(criteria, {
      direction: "forward",
      cursor: resolved.page.nextCursor,
      clientRequestId: `claimed-page-${pageNumber + 2}`,
    });
  }
  throw new Error("Claimed User logical paging did not terminate.");
}

function prefixes(value) {
  const words = value.split(" ");
  return [...new Set(words.flatMap((word) => {
    const result = [];
    for (let length = 2; length <= Math.min(32, word.length); length += 1) {
      result.push(word.slice(0, length));
    }
    return result;
  }))];
}

function user(index, overrides = {}) {
  const uid = overrides.uid ?? `user-${String(index).padStart(3, "0")}`;
  const displayName = overrides.displayName ?? `User ${String(index).padStart(3, "0")}`;
  const normalizedDisplayName = displayName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const userPointsDisplayName = overrides.userPointsDisplayName ?? displayName;
  const normalizedUserPointsDisplayName = userPointsDisplayName.toLowerCase();
  return {
    id: uid,
    data: {
      directoryVersion: adminUserDirectoryVersion,
      uid,
      displayName,
      normalizedDisplayName,
      displayNamePrefixTokens: prefixes(normalizedDisplayName),
      userPointsDisplayName,
      normalizedUserPointsDisplayName,
      displayEmail: overrides.email ?? `${uid}@example.test`,
      normalizedEmail: (overrides.email ?? `${uid}@example.test`).toLowerCase(),
      displayPhone: overrides.phone ?? `+1352555${String(index).padStart(4, "0")}`,
      normalizedPhone: overrides.normalizedPhone ?? `+1352555${String(index).padStart(4, "0")}`,
      contributionPoints: overrides.points ?? index,
      lastContributionAt: Object.hasOwn(overrides, "lastContributionAt")
        ? overrides.lastContributionAt
        : new Date(nowMs - index * 1_000),
      includedInUserPointsDirectory: overrides.included ?? true,
      couponAccountStatus: overrides.accountStatus ?? "approved",
      emailVerified: true,
      roleAdmin: overrides.isAdmin ?? false,
      roleCouponOwner: true,
      roleBiteScoreOwner: overrides.isOwner ?? false,
      activityProfile: true,
      activityClaims: overrides.claims ?? false,
      activityReviews: true,
      activityReports: false,
      activityDishSuggestions: false,
      activityReviewVotes: false,
      attackerPrivateMap: {passwordHash: "password-hash-canary"},
      stripeCustomerId: "cus_private_canary",
      ...overrides.fields,
    },
  };
}

function claim(id, ownerUid, name, overrides = {}) {
  const normalizedRestaurantName = name.toLowerCase();
  return {
    id,
    data: {
      claimedRestaurantVersion: adminUserClaimedRestaurantVersion,
      sourceRestaurantId: id,
      ownerUid,
      displayRestaurantName: name,
      normalizedRestaurantName,
      restaurantNamePrefixTokens: prefixes(normalizedRestaurantName),
      isClaimed: true,
      isActive: true,
      ...overrides,
    },
  };
}

function ledger(id, userId, createdAt, overrides = {}) {
  return {
    id,
    data: {
      id,
      userId,
      pointsDelta: 1,
      actionType: "dish_created",
      sourceKey: `source:${id}`,
      description: `Entry ${id}`,
      status: "active",
      dishId: `dish-${id}`,
      dishName: `Dish ${id}`,
      restaurantId: `restaurant-${id}`,
      restaurantName: `Restaurant ${id}`,
      restaurantCity: "Orlando",
      restaurantState: "FL",
      restaurantAddress: "1 Main St",
      restaurantPhone: "+13525550100",
      requestId: `request-${id}`,
      reason: "Test reason",
      createdAt,
      oauthToken: "oauth-private-canary",
      firebaseToken: "firebase-private-canary",
      customClaims: {admin: true},
      reviewBody: "review-private-canary",
      ...overrides,
    },
  };
}

test("people paging constants preserve the bounded contract", () => {
  assert.equal(ratingAdminPeopleCursorSecretName, "SEARCH_PAGINATION_CURSOR_KEY");
  assert.equal(ratingAdminPeoplePageSize, 50);
  assert.equal(ratingAdminPeoplePostFilterReadBudget, 500);
  assert.equal(ratingAdminClaimedPreviewLimit, 6);
  assert.equal(ratingAdminClaimedPreviewDisplayLimit, 5);
  assert.equal(contributionPointLedgerCollection, "bitescore_contribution_point_ledger");
});

test("all handlers reject malformed secrets and requests before database access", async () => {
  for (const [handler, criteria] of [
    [searchRatingAdminUsersPageHandler, {mode: "viewAll"}],
    [listRatingAdminUserPointsPageHandler, {sort: "mostPoints"}],
    [listRatingAdminContributionLedgerPageHandler, {userId: "user-1"}],
  ]) {
    const database = new FakeDatabase();
    await assert.rejects(
      handler(request(criteria), context(database, {cursorSecret: "bad"})),
      /not configured/,
    );
    await assert.rejects(
      handler({...request(criteria), unexpected: true}, context(database)),
      /page request is invalid/,
    );
    await assert.rejects(
      handler(request({...criteria, unexpected: true}), context(database)),
      /criteria are invalid/,
    );
    await assert.rejects(
      handler(request(criteria, {pageSize: 49}), context(database)),
      /page size is invalid/,
    );
    assert.equal(database.queries.length, 0);
    assert.equal(database.gets.length, 0);
    assert.equal(database.counts.length, 0);
  }
});

test("all handlers reject wrong protocol, direction, integers, IDs, and cursor shape before reads", async () => {
  const cases = [
    [searchRatingAdminUsersPageHandler, {mode: "viewAll"}],
    [listRatingAdminUserPointsPageHandler, {sort: "mostPoints"}],
    [listRatingAdminContributionLedgerPageHandler, {userId: "user-1"}],
  ];
  for (const [handler, criteria] of cases) {
    for (const invalid of [
      request(criteria, {protocolVersion: "wrong"}),
      request(criteria, {direction: "sideways"}),
      request(criteria, {pageSize: 50.5}),
      request(criteria, {clientRequestId: ""}),
      request(criteria, {direction: "forward"}),
      request(criteria, {direction: "first", cursor: "raw-cursor"}),
    ]) {
      const database = new FakeDatabase();
      await assert.rejects(handler(invalid, context(database)), /page request is invalid/);
      assert.equal(database.queries.length, 0);
      assert.equal(database.gets.length, 0);
      assert.equal(database.counts.length, 0);
    }
  }
});

test("Users View All pages 125 directory records with exact stable navigation", async () => {
  const users = Array.from({length: 125}, (_, index) => user(index));
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: users,
    [adminUserClaimedRestaurantCollection]: [],
  });
  const first = await searchRatingAdminUsersPageHandler(
    request({mode: "viewAll"}),
    context(database),
  );
  const second = await searchRatingAdminUsersPageHandler(
    request({mode: "viewAll"}, {direction: "forward", cursor: first.nextCursor}),
    context(database),
  );
  const third = await searchRatingAdminUsersPageHandler(
    request({mode: "viewAll"}, {direction: "forward", cursor: second.nextCursor}),
    context(database),
  );
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [50, 50, 25]);
  assert.deepEqual(first.total, {state: "exact", value: 125});
  assert.deepEqual([first.currentPageNumber, second.currentPageNumber, third.currentPageNumber], [1, 2, 3]);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map((item) => item.uid)).size, 125);
  assert.equal(third.hasNext, false);
  const previous = await searchRatingAdminUsersPageHandler(
    request({mode: "viewAll"}, {direction: "backward", cursor: third.previousCursor}),
    context(database),
  );
  assert.deepEqual(previous.items.map((item) => item.uid), second.items.map((item) => item.uid));
  const last = await searchRatingAdminUsersPageHandler(
    request({mode: "viewAll"}, {direction: "last"}),
    context(database),
  );
  assert.deepEqual(last.items.map((item) => item.uid), third.items.map((item) => item.uid));
  const directoryQueries = database.queries.filter((query) => query.collectionPath === adminUserDirectoryCollection);
  assert.ok(directoryQueries.every((query) => query.limit <= 51));
  assert.ok(database.gets.every((paths) => paths.every((value) => !value.includes("source_summaries"))));
});

test("exact UID is one direct directory read and preserves record-only identity", async () => {
  const recordOnly = user(1, {uid: "record-only-uid"});
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: [recordOnly],
    [adminUserClaimedRestaurantCollection]: [],
  });
  const found = await searchRatingAdminUsersPageHandler(
    request({mode: "uid", value: "record-only-uid"}),
    context(database),
  );
  assert.equal(found.items[0].uid, "record-only-uid");
  assert.equal(found.total.value, 1);
  assert.deepEqual(database.gets[0], ["admin_user_directory/record-only-uid"]);
  assert.equal(database.queries.filter((query) => query.collectionPath === adminUserDirectoryCollection).length, 0);
  const missing = await searchRatingAdminUsersPageHandler(
    request({mode: "uid", value: "missing-uid"}),
    context(database),
  );
  assert.equal(missing.items.length, 0);
});

test("email and phone modes normalize exact equality without substring behavior", async () => {
  const users = [
    user(1, {email: "Shared@Example.Test", phone: "(352) 555-0100", normalizedPhone: "+13525550100"}),
    user(2, {email: "shared@example.test", phone: "+1 352 555 0100", normalizedPhone: "+13525550100"}),
    user(3, {email: "notshared@example.test", phone: "+13525550101", normalizedPhone: "+13525550101"}),
  ];
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: users,
    [adminUserClaimedRestaurantCollection]: [],
  });
  const email = await searchRatingAdminUsersPageHandler(
    request({mode: "email", value: " SHARED@example.TEST "}),
    context(database),
  );
  assert.deepEqual(email.items.map((item) => item.uid), ["user-001", "user-002"]);
  assert.equal(email.total.value, 2);
  const phone = await searchRatingAdminUsersPageHandler(
    request({mode: "phone", value: "352-555-0100"}),
    context(database),
  );
  assert.deepEqual(phone.items.map((item) => item.uid), ["user-001", "user-002"]);
  assert.equal(phone.total.value, 2);
  assert.ok(database.counts.every((count) => count.filters.length === 1));
});

test("display-name word-prefix is global, punctuation-normalized, and middle substrings do not match", async () => {
  const users = [
    user(1, {displayName: "Anne-Marie Smith"}),
    user(2, {displayName: "Smith, Annette"}),
    user(3, {displayName: "Joanne Middle"}),
  ];
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: users,
    [adminUserClaimedRestaurantCollection]: [],
  });
  const page = await searchRatingAdminUsersPageHandler(
    request({mode: "displayName", value: "ann smi"}),
    context(database),
  );
  assert.deepEqual(page.items.map((item) => item.uid), ["user-001", "user-002"]);
  assert.equal(page.total.state, "unknown");
  assert.ok(database.queries[0].limit <= 500);
});

test("post-filtered display-name sparse Previous replays the prior bounded raw window", async () => {
  const users = Array.from({length: 130}, (_, index) => user(index, {
    displayName: index % 2 === 0 ? `Alpha River ${index}` : `Alpha Ridge ${index}`,
  }));
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: users,
    [adminUserClaimedRestaurantCollection]: [],
  });
  const first = await searchRatingAdminUsersPageHandler(
    request({mode: "displayName", value: "alpha riv"}),
    context(database),
  );
  const second = await searchRatingAdminUsersPageHandler(
    request({mode: "displayName", value: "alpha riv"}, {direction: "forward", cursor: first.nextCursor}),
    context(database),
  );
  const previous = await searchRatingAdminUsersPageHandler(
    request({mode: "displayName", value: "alpha riv"}, {direction: "backward", cursor: second.previousCursor}),
    context(database),
  );
  assert.deepEqual(previous.items.map((item) => item.uid), first.items.map((item) => item.uid));
});

test("claimed-restaurant pages deduplicate owners without breaking forward/Previous continuity", async () => {
  const users = Array.from({length: 65}, (_, index) => user(index, {uid: `owner-${String(index).padStart(3, "0")}`}));
  const claims = users.flatMap((entry, index) => [
    claim(`restaurant-${index}-a`, entry.id, `River Grill ${index} A`),
    claim(`restaurant-${index}-b`, entry.id, `River Grill ${index} B`),
  ]);
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: users,
    [adminUserClaimedRestaurantCollection]: claims,
  });
  const first = (await resolveClaimedLogicalPage(
    request({mode: "claimedRestaurant", value: "river gr"}),
    context(database),
  )).page;
  const second = (await resolveClaimedLogicalPage(
    request({mode: "claimedRestaurant", value: "river gr"}, {direction: "forward", cursor: first.nextCursor}),
    context(database),
  )).page;
  const previous = (await resolveClaimedLogicalPage(
    request({mode: "claimedRestaurant", value: "river gr"}, {direction: "backward", cursor: second.previousCursor}),
    context(database),
  )).page;
  const forwardAgain = (await resolveClaimedLogicalPage(
    request({mode: "claimedRestaurant", value: "river gr"}, {direction: "forward", cursor: previous.nextCursor}),
    context(database),
  )).page;
  assert.deepEqual([first.items.length, second.items.length], [50, 15]);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.uid)).size, 65);
  assert.deepEqual(previous.items.map((item) => item.uid), first.items.map((item) => item.uid));
  assert.deepEqual(forwardAgain.items.map((item) => item.uid), second.items.map((item) => item.uid));
  assert.equal(first.total.state, "unknown");
  const searchQueries = database.queries.filter((query) =>
    query.collectionPath === adminUserClaimedRestaurantCollection &&
    query.filters.some((filter) => filter.field === "restaurantNamePrefixTokens"));
  assert.ok(searchQueries.every((query) => query.limit === 500));
  assert.ok(database.gets.every((paths) => paths.length <= 50));
});

function heavyClaimFixture(heavyCounts, lightCount = 51) {
  const heavyUsers = heavyCounts.map((_, index) =>
    user(index, {uid: `owner-${String(index).padStart(3, "0")}-heavy`}));
  const lightUsers = Array.from({length: lightCount}, (_, index) =>
    user(index + heavyUsers.length, {
      uid: `owner-${String(index + heavyUsers.length).padStart(3, "0")}-light`,
    }));
  const claims = [
    ...heavyUsers.flatMap((entry, ownerIndex) =>
      Array.from({length: heavyCounts[ownerIndex]}, (_, claimIndex) =>
        claim(
          `heavy-${ownerIndex}-${String(claimIndex).padStart(4, "0")}`,
          entry.id,
          `River Heavy ${ownerIndex} ${claimIndex}`,
        ))),
    ...lightUsers.map((entry, index) =>
      claim(`light-${index}`, entry.id, `River Light ${index}`)),
  ];
  return {users: [...heavyUsers, ...lightUsers], claims};
}

function assertClaimedBounds(database) {
  for (let index = 0; index < database.queries.length; index += 1) {
    const query = database.queries[index];
    if (query.filters.some(
      (filter) => filter.field === "restaurantNamePrefixTokens",
    )) {
      assert.ok(database.queryReadCounts[index] <= 500);
    }
  }
  assert.ok(database.gets.every((paths) => paths.length <= 50));
}

test("1,100-row owner never creates an empty logical User page", async () => {
  const fixture = heavyClaimFixture([1_100]);
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: fixture.users,
    [adminUserClaimedRestaurantCollection]: fixture.claims,
  });
  const {pages, responses} = await collectClaimedLogicalPages(
    {mode: "claimedRestaurant", value: "river"},
    database,
  );
  const ids = pages.flatMap((page) => page.items.map((item) => item.uid));
  assert.ok(pages.every((page) => page.items.length > 0));
  assert.deepEqual(
    pages.map((page) => page.currentPageNumber),
    Array.from({length: pages.length}, (_, index) => index + 1),
  );
  assert.equal(ids.length, 52);
  assert.equal(new Set(ids).size, 52);
  assert.equal(ids.filter((value) => value === fixture.users[0].id).length, 1);
  const preparing = responses.filter((value) =>
    value.preparation?.state === "preparing");
  assert.ok(preparing.length > 0);
  assert.ok(preparing.every((value) =>
    value.currentPageNumber >= 1 && value.currentPageNumber <= 3));
  assertClaimedBounds(database);
});

test("1,600-row owner preserves forward Previous forward logical identities", async () => {
  const fixture = heavyClaimFixture([1_600]);
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: fixture.users,
    [adminUserClaimedRestaurantCollection]: fixture.claims,
  });
  const criteria = {mode: "claimedRestaurant", value: "river"};
  const first = (await resolveClaimedLogicalPage(request(criteria), context(database))).page;
  const second = (await resolveClaimedLogicalPage(
    request(criteria, {direction: "forward", cursor: first.nextCursor}),
    context(database),
  )).page;
  const third = (await resolveClaimedLogicalPage(
    request(criteria, {direction: "forward", cursor: second.nextCursor}),
    context(database),
  )).page;
  const previousSecond = (await resolveClaimedLogicalPage(
    request(criteria, {direction: "backward", cursor: third.previousCursor}),
    context(database),
  )).page;
  const previousFirst = (await resolveClaimedLogicalPage(
    request(criteria, {direction: "backward", cursor: previousSecond.previousCursor}),
    context(database),
  )).page;
  const forwardAgain = (await resolveClaimedLogicalPage(
    request(criteria, {direction: "forward", cursor: previousFirst.nextCursor}),
    context(database),
  )).page;
  const forwardIds = [first, second, third]
    .flatMap((page) => page.items.map((item) => item.uid));
  assert.equal(forwardIds.length, fixture.users.length);
  assert.equal(new Set(forwardIds).size, fixture.users.length);
  assert.equal(
    forwardIds.filter((value) => value === fixture.users[0].id).length,
    1,
  );
  assert.deepEqual(
    [first, second, third].map((page) => page.currentPageNumber),
    [1, 2, 3],
  );
  assert.deepEqual(previousSecond.items.map((item) => item.uid), second.items.map((item) => item.uid));
  assert.deepEqual(previousFirst.items.map((item) => item.uid), first.items.map((item) => item.uid));
  assert.deepEqual(forwardAgain.items.map((item) => item.uid), second.items.map((item) => item.uid));
  assert.ok([first, second, third, previousSecond, previousFirst, forwardAgain]
    .every((page) => page.items.length > 0));
  assertClaimedBounds(database);
});

test("all-one-owner exhaustion resolves page one without a fake Next page", async () => {
  const fixture = heavyClaimFixture([1_600], 0);
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: fixture.users,
    [adminUserClaimedRestaurantCollection]: fixture.claims,
  });
  const resolved = await resolveClaimedLogicalPage(
    request({mode: "claimedRestaurant", value: "river"}),
    context(database),
  );
  assert.deepEqual(resolved.page.items.map((item) => item.uid), [fixture.users[0].id]);
  assert.equal(resolved.page.currentPageNumber, 1);
  assert.equal(resolved.page.hasNext, false);
  assert.ok(resolved.responses.length > 1);
  assert.ok(resolved.responses.some((value) =>
    value.preparation?.state === "preparing"));
  assert.ok(resolved.responses.every((value) =>
    value.currentPageNumber === 1));
  assertClaimedBounds(database);
});

test("multiple heavy owners and every later light owner remain reachable once", async () => {
  const fixture = heavyClaimFixture([1_100, 1_100]);
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: fixture.users,
    [adminUserClaimedRestaurantCollection]: fixture.claims,
  });
  const {pages} = await collectClaimedLogicalPages(
    {mode: "claimedRestaurant", value: "river"},
    database,
  );
  const ids = pages.flatMap((page) => page.items.map((item) => item.uid));
  assert.equal(ids.length, fixture.users.length);
  assert.equal(new Set(ids).size, fixture.users.length);
  for (const heavy of fixture.users.slice(0, 2)) {
    assert.equal(ids.filter((value) => value === heavy.id).length, 1);
  }
  assert.ok(pages.every((page) => page.items.length > 0));
  assertClaimedBounds(database);
});

test("sparse claimed post-filter windows continue without advancing a logical page", async () => {
  const misses = Array.from({length: 550}, (_, index) => {
    const owner = `owner-${String(index).padStart(4, "0")}-miss`;
    return claim(`miss-${index}`, owner, `Restaurant River ${index}`);
  });
  const matchingUsers = Array.from({length: 51}, (_, index) =>
    user(index, {uid: `owner-${String(index + 550).padStart(4, "0")}-match`}));
  const matches = matchingUsers.map((entry, index) =>
    claim(`match-${index}`, entry.id, `Restaurant Zebra ${index}`));
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: matchingUsers,
    [adminUserClaimedRestaurantCollection]: [...misses, ...matches],
  });
  const resolved = await resolveClaimedLogicalPage(
    request({mode: "claimedRestaurant", value: "restaurant ze"}),
    context(database),
  );
  assert.equal(resolved.page.items.length, 50);
  assert.equal(resolved.page.currentPageNumber, 1);
  assert.ok(resolved.responses.some((value) =>
    value.preparation?.state === "preparing" && value.items.length === 0));
  assert.ok(resolved.responses.filter((value) =>
    value.preparation?.state === "preparing" && value.items.length === 0)
    .every((value) => value.currentPageNumber === 1));
  assertClaimedBounds(database);
});

test("claimed preview shows five, marks more, and surfaces the exact search match", async () => {
  const owner = user(1, {uid: "owner-preview"});
  const claims = [
    claim("a", owner.id, "Alpha One"),
    claim("b", owner.id, "Bravo Two"),
    claim("c", owner.id, "Charlie Three"),
    claim("d", owner.id, "Delta Four"),
    claim("e", owner.id, "Echo Five"),
    claim("f", owner.id, "Zeta Match"),
    claim("g", owner.id, "Zulu Seven"),
  ];
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: [owner],
    [adminUserClaimedRestaurantCollection]: claims,
  });
  const page = await searchRatingAdminUsersPageHandler(
    request({mode: "claimedRestaurant", value: "zeta"}),
    context(database),
  );
  assert.equal(page.items[0].claimedRestaurantNames.length, 5);
  assert.ok(page.items[0].claimedRestaurantNames.includes("Zeta Match"));
  assert.equal(page.items[0].hasMoreClaimedRestaurants, true);
  const preview = database.queries.find((query) =>
    query.filters.some((filter) => filter.field === "ownerUid"));
  assert.equal(preview.limit, 6);
});

test("all four User Points sorts are global, exact, and keep explicit null activity rows reachable", async () => {
  const users = Array.from({length: 125}, (_, index) => user(index, {
    points: index % 17,
    userPointsDisplayName: `Points ${String(124 - index).padStart(3, "0")}`,
    lastContributionAt: index === 124 ? null : new Date(nowMs - (index % 11) * 1_000),
  }));
  for (const sort of ["mostPoints", "fewestPoints", "displayNameAz", "mostRecentActivity"]) {
    const database = new FakeDatabase({[adminUserDirectoryCollection]: users});
    const first = await listRatingAdminUserPointsPageHandler(request({sort}), context(database));
    const second = await listRatingAdminUserPointsPageHandler(
      request({sort}, {direction: "forward", cursor: first.nextCursor}),
      context(database),
    );
    const last = await listRatingAdminUserPointsPageHandler(
      request({sort}, {direction: "last"}),
      context(database),
    );
    assert.equal(first.items.length, 50, sort);
    assert.equal(second.items.length, 50, sort);
    assert.equal(last.items.length, 25, sort);
    assert.equal(first.total.value, 125, sort);
    assert.ok(database.queries.every((query) => query.limit <= 51), sort);
    assert.ok(database.queries.every((query) => query.collectionPath === adminUserDirectoryCollection), sort);
    if (sort === "mostRecentActivity") {
      assert.ok(last.items.some((item) => item.userId === "user-124"));
    }
  }
});

test("ledger filters one UID before reads and pages timestamp/document-ID descending", async () => {
  const sameTime = new Date(nowMs);
  const userA = Array.from({length: 65}, (_, index) => ledger(
    `a-${String(index).padStart(3, "0")}`,
    "user-a",
    index < 2 ? sameTime : new Date(nowMs - index * 1_000),
  ));
  const userB = [ledger("b-private", "user-b", new Date(nowMs + 1_000))];
  const database = new FakeDatabase({
    [contributionPointLedgerCollection]: [...userA, ...userB],
  });
  const first = await listRatingAdminContributionLedgerPageHandler(
    request({userId: "user-a"}),
    context(database),
  );
  const second = await listRatingAdminContributionLedgerPageHandler(
    request({userId: "user-a"}, {direction: "forward", cursor: first.nextCursor}),
    context(database),
  );
  assert.deepEqual([first.items.length, second.items.length], [50, 15]);
  assert.equal(first.total.value, 65);
  assert.equal(first.items[0].id, "a-001");
  assert.equal(first.items[1].id, "a-000");
  assert.ok([...first.items, ...second.items].every((item) => item.userId === "user-a"));
  assert.ok(database.queries.every((query) =>
    query.filters.some((filter) => filter.field === "userId" && filter.value === "user-a")));
  assert.ok(database.queries.every((query) => query.limit <= 51));
});

test("strict projections and source contain no sensitive response or logging canaries", async () => {
  const directoryDatabase = new FakeDatabase({
    [adminUserDirectoryCollection]: [user(1)],
    [adminUserClaimedRestaurantCollection]: [],
  });
  const users = await searchRatingAdminUsersPageHandler(
    request({mode: "viewAll"}),
    context(directoryDatabase),
  );
  const ledgerDatabase = new FakeDatabase({
    [contributionPointLedgerCollection]: [ledger(
      "entry-1",
      "user-1",
      new Date(nowMs),
      {
        actionType: "ledger-action-private-canary",
        sourceKey: "ledger-source-private-canary",
        status: "ledger-status-private-canary",
        internalLedgerPayload: "ledger-internal-private-canary",
      },
    )],
  });
  const entries = await listRatingAdminContributionLedgerPageHandler(
    request({userId: "user-1"}),
    context(ledgerDatabase),
  );
  assert.deepEqual(Object.keys(entries.items[0]).sort(), [
    "createdAtMillis",
    "description",
    "dishId",
    "dishName",
    "id",
    "pointsDelta",
    "reason",
    "requestId",
    "restaurantAddress",
    "restaurantCity",
    "restaurantId",
    "restaurantName",
    "restaurantPhone",
    "restaurantState",
    "userId",
  ]);
  assert.deepEqual(entries.items[0], {
    id: "entry-1",
    userId: "user-1",
    pointsDelta: 1,
    description: "Entry entry-1",
    dishId: "dish-entry-1",
    dishName: "Dish entry-1",
    restaurantId: "restaurant-entry-1",
    restaurantName: "Restaurant entry-1",
    restaurantCity: "Orlando",
    restaurantState: "FL",
    restaurantAddress: "1 Main St",
    restaurantPhone: "+13525550100",
    requestId: "request-entry-1",
    reason: "Test reason",
    createdAtMillis: nowMs,
  });
  for (const removed of ["actionType", "sourceKey", "status"]) {
    assert.equal(Object.hasOwn(entries.items[0], removed), false, removed);
  }
  const serialized = JSON.stringify({users, entries});
  for (const removed of ["actionType", "sourceKey", "status"]) {
    assert.equal(serialized.includes(`"${removed}"`), false, removed);
  }
  for (const canary of [
    "password-hash-canary",
    "cus_private_canary",
    "oauth-private-canary",
    "firebase-private-canary",
    "review-private-canary",
    "customClaims",
    "ledger-action-private-canary",
    "ledger-source-private-canary",
    "ledger-status-private-canary",
    "ledger-internal-private-canary",
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
  const source = readFileSync(
    path.resolve(__dirname, "../src/rating_admin_people_paging.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(?:console|logger)\s*\./u);
});

test("opaque cursors reject wrong caller, query, purpose, and expiry", async () => {
  const database = new FakeDatabase({
    [adminUserDirectoryCollection]: Array.from({length: 60}, (_, index) => user(index)),
    [adminUserClaimedRestaurantCollection]: [],
  });
  const first = await searchRatingAdminUsersPageHandler(
    request({mode: "viewAll"}),
    context(database),
  );
  await assert.rejects(
    searchRatingAdminUsersPageHandler(
      request({mode: "viewAll"}, {direction: "forward", cursor: first.nextCursor}),
      context(database, {adminUid: "other-admin"}),
    ),
    /cursor is invalid/,
  );
  await assert.rejects(
    searchRatingAdminUsersPageHandler(
      request({mode: "email", value: "user-001@example.test"}, {direction: "forward", cursor: first.nextCursor}),
      context(database),
    ),
    /cursor is invalid/,
  );
  await assert.rejects(
    searchRatingAdminUsersPageHandler(
      request({mode: "viewAll"}, {direction: "backward", cursor: first.nextCursor}),
      context(database),
    ),
    /cursor is invalid/,
  );
  await assert.rejects(
    searchRatingAdminUsersPageHandler(
      request({mode: "viewAll"}, {direction: "forward", cursor: first.nextCursor}),
      context(database, {now: () => nowMs + 31 * 60 * 1_000}),
    ),
    /cursor is invalid/,
  );
});

test("unsupported search values and ledger identities fail before reads", async () => {
  for (const criteria of [
    {mode: "role", value: "admin"},
    {mode: "displayName", value: "a"},
    {mode: "email", value: "not-email"},
    {mode: "phone", value: "12"},
    {mode: "uid", value: "bad/id"},
  ]) {
    const database = new FakeDatabase();
    await assert.rejects(
      searchRatingAdminUsersPageHandler(request(criteria), context(database)),
      /invalid|characters/,
    );
    assert.equal(database.queries.length, 0);
    assert.equal(database.gets.length, 0);
  }
  const database = new FakeDatabase();
  await assert.rejects(
    listRatingAdminContributionLedgerPageHandler(
      request({userId: "bad/id"}),
      context(database),
    ),
    /identity is invalid/,
  );
  assert.equal(database.queries.length, 0);
});
