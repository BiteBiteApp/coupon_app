"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {createHash} = require("node:crypto");
const {GeoPoint} = require("firebase-admin/firestore");
const {OpaqueCursorCodec} = require("../lib/opaque_cursor.js");
const contract = require("../lib/customer_bitescore_search_contract.js");
const matcher = require("../lib/customer_bitescore_search_matcher.js");
const {
  startCustomerBiteScoreSearchHandler: start,
  advanceCustomerBiteScoreSearchHandler: advance,
  getCustomerBiteScoreSearchPageHandler: page,
} = require("../lib/customer_bitescore_search.js");
const {buildBiteScoreRestaurantIndex, buildBiteScoreDishIndex} = require("../lib/search_index_builders.js");
const {canonicalRestaurantGeohash} = require("../lib/restaurant_geo_helpers.js");

const {MemoryDatabase, nowMs, date, context, restaurant, addRestaurant, addDish, request, continued, ready, allPages} = require("./support/customer_bitescore_fixtures.js");

test("914 independent Dart golden cases preserve food, category, fuzzy, and plain matching", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/customer_bitescore_matcher_parity.json"), "utf8"));
  for (const [file, hash] of Object.entries(fixture.sourceSha256)) {
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(__dirname, "../..", file))).digest("hex"), hash,
      "Regenerate and independently review parity fixtures when product matching changes");
  }
  assert.equal(fixture.cases.length, 914);
  for (const c of fixture.cases) {
    const actual = c.kind === "food" ? matcher.matchesBiteScoreFood([c.source], c.query, c.fuzzy) :
      c.kind === "plain" ? matcher.matchesBiteScorePlainText(c.source, c.query) :
      matcher.matchesBiteScoreFood(matcher.biteScoreCategoryTerms({category: c.category, subcategory: c.subcategory,
        categoryManualKeywords: c.manualKeywords, categoryTags: c.categoryTags}), c.query, c.fuzzy);
    assert.equal(actual, c.expected, JSON.stringify(c));
  }
});

function compareExpected(left, right, sort) {
  const a = left.aggregate, b = right.aggregate;
  const high = b.overallBiteScore - a.overallBiteScore || b.ratingCount - a.ratingCount ||
    (left.source.name.toLowerCase() < right.source.name.toLowerCase() ? -1 : left.source.name.toLowerCase() > right.source.name.toLowerCase() ? 1 : 0) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (sort === "Most Reviewed") return b.ratingCount - a.ratingCount || high;
  if (sort === "Closest") return left.distance - right.distance || high;
  const field = {"Best Value": "valueScoreAverage", "Best Flavor": "tastinessScoreAverage",
    "Highest Quality": "qualityScoreAverage", "Most Enjoyed": "overallImpressionAverage"}[sort];
  if (field) {
    if (a[field] == null && b[field] != null) return 1;
    if (b[field] == null && a[field] != null) return -1;
    return (b[field] ?? 0) - (a[field] ?? 0) || high;
  }
  return high;
}

for (const sort of contract.customerBiteScoreSorts) {
  test(`global ${sort} ranking spans batches/pages, preserves ties and canonical identity`, async () => {
    const db = new MemoryDatabase();
    const parent = addRestaurant(db);
    const rows = [];
    for (let i = 0; i < 137; i++) rows.push({...addDish(db, `dish-${i.toString().padStart(3, "0")}`, parent,
      {name: i % 3 === 0 ? "Same name" : `Dish ${i % 7}`}, {
        overallBiteScore: (i % 6) * 10, ratingCount: i % 8,
        valueScoreAverage: i % 4 === 0 ? null : i % 10,
        tastinessScoreAverage: i % 5 === 0 ? null : (i + 2) % 10,
        qualityScoreAverage: i % 3 === 0 ? null : (i + 3) % 10,
        overallImpressionAverage: i % 6 === 0 ? null : (i + 4) % 10,
      }), distance: 0});
    const state = await ready(db, request({sort}));
    const first = await page(db, continued(state), context());
    const repeated = await page(db, continued(state), context());
    assert.deepEqual(first.items, repeated.items);
    assert.equal(first.items.length, 25);
    const results = await allPages(db, state);
    assert.equal(results.length, 137);
    assert.equal(new Set(results.map((v) => v.sourceDocumentId)).size, 137);
    assert.deepEqual(results.map((v) => v.sourceDocumentId), rows.sort((a, b) => compareExpected(a, b, sort)).map((v) => v.id));
    assert(db.queries.every((q) => q.limit <= 26));
    assert(db.maxWrites <= 26);
  });
}

test("long exact IDs and astral/BMP ties retain Dart UTF16 order without identity normalization", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  const ids = ["😀", "\ue000", "id-" + "x".repeat(1497), "same-A", "same-a"];
  for (const id of ids) addDish(db, id, parent, {name: "Same"});
  const state = await ready(db);
  assert.deepEqual((await allPages(db, state)).map((v) => v.sourceDocumentId), [...ids].sort());
  for (const [p, data] of db.documents) if (p.startsWith(contract.customerBiteScoreResultCollection + "/")) {
    assert(data.idKey0.length <= 1500 && data.idKey1.length <= 1500);
  }
  assert.throws(() => contract.parseCustomerBiteScoreCriteria({kind: "dish", restaurantId: " restaurant-a "}));
});

test("Finder returns globally ranked eight suggestions and close-match exact-first behavior", async () => {
  const db = new MemoryDatabase();
  for (let i = 0; i < 70; i++) addRestaurant(db, `restaurant-${i}`, {name: `Cafe Alpha ${i}`});
  addRestaurant(db, "exact", {name: "Alpha"});
  addRestaurant(db, "other-state", {name: "Alpha", state: "NY"});
  const criteria = {kind: "restaurant", text: "Alpha", finder: {state: "fl", location: "331"}};
  const state = await ready(db, request(criteria));
  const result = await page(db, continued(state), context());
  assert.equal(result.items.length, 8);
  assert.equal(result.items[0].sourceDocumentId, "exact");
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  const close = await ready(db, request({...criteria, finder: {state: "FL", location: "Miami", mode: "close"}},
    {queryGeneration: 2, clientRequestId: "close"}));
  assert.equal((await page(db, continued(close), context())).items[0].sourceDocumentId, "exact");
});

test("criteria generations, actors, and sessions fence stale starts/pages/cursors", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  for (let i = 0; i < 55; i++) addDish(db, `dish-${i}`, parent);
  const a = await ready(db);
  const first = await page(db, continued(a), context());
  await assert.rejects(page(db, continued(a), context("other-customer")), /unavailable/);
  const b = await ready(db, request({}, {clientInstanceId: "other-instance", clientRequestId: "b"}));
  await assert.rejects(page(db, continued(b, first.nextCursor), context()), /unavailable/);
  await ready(db, request({text: "burger"}, {queryGeneration: 2, clientRequestId: "c"}));
  await assert.rejects(page(db, continued(a, first.nextCursor), context()), /unavailable/);
  await assert.rejects(start(db, request({}, {clientRequestId: "stale", queryGeneration: 1}), context()), /unavailable/);
  await assert.rejects(start(db, request({}, {clientRequestId: "c", queryGeneration: 2}), context()), /unavailable/);
});

test("hidden/deleted source and parent records are suppressed before asynchronous projections catch up", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  addDish(db, "one", parent); addDish(db, "two", parent); addDish(db, "three", parent);
  const state = await ready(db);
  db.documents.delete("bitescore_dishes/one");
  db.documents.get("bitescore_dishes/two").isActive = false;
  assert.deepEqual((await page(db, continued(state), context())).items.map((v) => v.sourceDocumentId), ["three"]);
  db.documents.get("bitescore_restaurants/restaurant-a").isActive = false;
  assert.equal((await page(db, continued(state), context())).items.length, 0);
});

test("projection allowlist strips owner/payment/invite metadata, including nested hours", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db, "parent", {ownerUserId: "owner-private", stripeId: "secret"});
  addDish(db, "dish", parent, {createdByUserId: "private-creator"});
  const p = contract.customerBiteScoreIndexPath("restaurant", "parent");
  const index = db.documents.get(p);
  db.documents.set(p, {...index, customerPublicProjection: {...index.customerPublicProjection,
    ownerUserId: "leak", stripeSecret: "private-payment", inviteToken: "private-invite",
    businessHours: [{day: "Monday", opensAt: "9:00 AM", closesAt: "5:00 PM", closed: false, token: "private-hours"}]}});
  const state = await ready(db);
  const result = await page(db, continued(state), context());
  assert.equal(result.items.length, 1);
  const encoded = JSON.stringify(result.items);
  for (const forbidden of ["ownerUserId", "stripe", "invite", "createdByUserId", "private-"]) assert(!encoded.includes(forbidden));
  assert.deepEqual(result.items[0].restaurant.businessHours,
    [{day: "Monday", opensAt: "9:00 AM", closesAt: "5:00 PM", closed: false}]);
  assert.equal(contract.readCustomerBiteScorePublicProjection({id: "wrong", path: p, data: index}, "restaurant"), null);
});

test("catalog mutation during preparation restarts a fenced attempt and does not miss earlier IDs", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  for (let i = 0; i < 60; i++) addDish(db, `dish-${i}`, parent);
  let state = await start(db, request(), context());
  state = await advance(db, continued(state), context());
  addDish(db, "new-highest", parent, {}, {overallBiteScore: 100});
  const generationPath = contract.customerBiteScoreGenerationShardPath("dish", "new-highest");
  db.documents.set(generationPath, contract.nextCustomerBiteScoreGenerationDocument(null, date));
  for (let i = 0; state.state === "preparing" && i < 30; i++) state = await advance(db, continued(state), context());
  assert.equal(state.state, "ready");
  const items = await allPages(db, state);
  assert.equal(items.length, 61);
  assert.equal(items[0].sourceDocumentId, "new-highest");
  assert.equal(db.documents.get(`${contract.customerBiteScoreSessionCollection}/${state.sessionId}`).attempt, 1);
});

test("radius dish search uses current parent geography even when dish geo fanout is pending", async () => {
  const db = new MemoryDatabase();
  const old = addRestaurant(db, "moved", {location: new GeoPoint(40.7, -74)});
  addDish(db, "dish", old);
  addRestaurant(db, "moved", {location: new GeoPoint(25.77, -80.19)});
  const near = addRestaurant(db, "near", {location: new GeoPoint(25.77001, -80.19)});
  addDish(db, "near-dish", near);
  const state = await ready(db, request({center: {latitude: 25.77, longitude: -80.19}, radiusMiles: 1, sort: "Closest"}));
  const items = await allPages(db, state);
  assert.deepEqual(items.map((v) => v.sourceDocumentId), ["dish", "near-dish"]);
  assert(items[0].distanceMiles < items[1].distanceMiles);
  assert(db.queries.filter((q) => q.collectionPath === "dish_search_index").every((q) =>
    q.filters.some((f) => f.field === "restaurantSourceDocumentId") && !q.filters.some((f) => f.field === "geohash")));
});

test("bounded restaurant context, categories, location text and food aliases all bind before ranking", async () => {
  const db = new MemoryDatabase();
  const first = addRestaurant(db);
  const second = addRestaurant(db, "other", {city: "Orlando", zipCode: "32801"});
  addDish(db, "sub", first, {name: "Italian Hoagie", category: "Subs", categoryTags: ["sub"]});
  addDish(db, "sandwich", first, {name: "Barbecue Sandwich", category: "Other", categoryTags: [], categoryManualKeywords: "bbq"});
  addDish(db, "elsewhere", second, {name: "Italian Hoagie", category: "Subs"});
  const state = await ready(db, request({restaurantId: first.id, text: "sandwhich", categoryQueries: ["sub"], locationText: "miam"}));
  assert.deepEqual((await allPages(db, state)).map((v) => v.sourceDocumentId), ["sub"]);
});

test("expiry, admission, idempotent start and overlapping preparations stay bounded", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  for (let i = 0; i < 26; i++) addDish(db, `dish-${i}`, parent);
  const state = await start(db, request(), context());
  assert.deepEqual(await start(db, request(), context()), state);
  const concurrent = await Promise.all([advance(db, continued(state), context()), advance(db, continued(state), context())]);
  assert(concurrent.every((v) => v.scannedCount <= 25));
  assert.equal(db.queries.filter((q) => q.collectionPath === "dish_search_index").length, 1);
  await assert.rejects(page(db, continued(state), context("customer-a", nowMs + 15 * 60_000)), /expired/);
  await start(db, request({}, {clientInstanceId: "two", clientRequestId: "two"}), context());
  await assert.rejects(start(db, request({}, {clientInstanceId: "three", clientRequestId: "three"}), context()), /finish another/);
});

test("merge chooser alphabetic order is global and permitted only for an exact restaurant-bound dish list", async () => {
  assert.equal(contract.customerBiteScoreSorts.length, 7, "Home's exposed seven sort choices remain unchanged");
  assert.throws(() => contract.parseCustomerBiteScoreCriteria({kind: "dish", sort: "Dish Name"}));
  assert.throws(() => contract.parseCustomerBiteScoreCriteria({kind: "restaurant", sort: "Dish Name", restaurantId: "parent"}));
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  const expected = [];
  for (let i = 0; i < 71; i++) {
    const name = `Burger ${i % 8}`;
    const id = `dish-${i}`;
    addDish(db, id, parent, {name}, {overallBiteScore: i % 10});
    expected.push({id, name});
  }
  const other = addRestaurant(db, "other");
  addDish(db, "exclude-other", other, {name: "AAA"});
  const state = await ready(db, request({sort: "Dish Name", restaurantId: parent.id}));
  expected.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  assert.deepEqual((await allPages(db, state)).map((v) => v.sourceDocumentId), expected.map((v) => v.id));
});

test("Home nearest ordering preserves sub-rounding distances and score ties across every geographic batch/page", async () => {
  const db = new MemoryDatabase();
  const rows = [];
  for (let group = 0; group < 12; group++) {
    const parent = addRestaurant(db, `parent-${group}`, {location: new GeoPoint(25.77 + group * 0.0000001, -80.19)});
    for (let offset = 0; offset < 7; offset++) {
      const id = `dish-${group}-${offset}`;
      addDish(db, id, parent, {name: "Same"}, {overallBiteScore: offset % 2, ratingCount: offset % 3});
      rows.push({id, group, score: offset % 2, count: offset % 3});
    }
  }
  const state = await ready(db, request({sort: "Closest", center: {latitude: 25.77, longitude: -80.19}, radiusMiles: 1}));
  rows.sort((a, b) => a.group - b.group || b.score - a.score || b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const result = await allPages(db, state);
  assert.deepEqual(result.map((v) => v.sourceDocumentId), rows.map((v) => v.id));
  assert.equal(new Set(result.map((v) => v.sourceDocumentId)).size, 84);
  assert.equal(new Set(result.map((v) => v.distanceMiles)).size, 12);
  assert(db.queries.every((q) => q.limit <= 26));
});

test("an in-flight old preparation cannot publish after a newer criteria generation replaces it", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  addDish(db, "dish", parent);
  const state = await start(db, request(), context());
  let unblock;
  let arrived;
  const blocked = new Promise((resolve) => {unblock = resolve;});
  const entered = new Promise((resolve) => {arrived = resolve;});
  db.beforeQuery = async (query) => {
    if (query.collectionPath === "dish_search_index") {arrived(); await blocked;}
  };
  const pending = advance(db, continued(state), context());
  await entered;
  await start(db, request({text: "changed"}, {queryGeneration: 2, clientRequestId: "newer"}), context());
  unblock();
  await assert.rejects(pending, /unavailable/);
  assert.equal([...db.documents.keys()].filter((v) => v.startsWith(contract.customerBiteScoreResultCollection + "/")).length, 0);
});

test("source errors release only their preparation lease, and excessive concurrent mutation fails closed after bounded restarts", async () => {
  const db = new MemoryDatabase();
  const state = await start(db, request(), context());
  db.beforeQuery = async () => {throw new Error("Synthetic transport failure");};
  await assert.rejects(advance(db, continued(state), context()), /transport failure/);
  assert.equal(db.documents.get(`${contract.customerBiteScoreSessionCollection}/${state.sessionId}`).leaseId, null);
  const generationPath = contract.customerBiteScoreGenerationShardPath("dish", "changed");
  db.beforeQuery = async () => {
    db.documents.set(generationPath, contract.nextCustomerBiteScoreGenerationDocument(db.documents.get(generationPath), date));
  };
  let current = state;
  for (let i = 0; i < 3; i++) current = await advance(db, continued(current), context());
  assert.equal(current.state, "failed");
  assert.equal((await page(db, continued(current), context())).items.length, 0);
});
