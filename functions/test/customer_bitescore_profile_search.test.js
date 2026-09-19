"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {createHash} = require("node:crypto");
const {GeoPoint, Timestamp} = require("firebase-admin/firestore");
const {MemoryDatabase, nowMs, date, context, addRestaurant, addDish, continued} = require("./support/customer_bitescore_fixtures.js");
const {startCustomerBiteScoreProfileListHandler: start, advanceCustomerBiteScoreProfileListHandler: advance,
  getCustomerBiteScoreProfileListPageHandler: page} = require("../lib/customer_bitescore_profile_search.js");
const {customerBiteScoreProfileGenerationPath, nextCustomerBiteScoreProfileGeneration,
  reconcileCustomerBiteScoreFavoriteGeneration} = require("../lib/customer_bitescore_profile_generation.js");
const {customerBiteScoreExpertMatches} = require("../lib/customer_bitescore_search_expert.js");
const {customerBiteScoreExpertTypes} = require("../lib/customer_bitescore_search_expert_data.js");
const {buildCustomerBiteScoreReview, customerBiteScoreReviewIndex} = require("../lib/customer_bitescore_reads.js");
const userId = "reviewer-a";
const ctx = {...context(), userId};
function request(criteria, generation = 1) {
  return {schemaVersion: 1, clientInstanceId: "profile-instance", clientRequestId: `request-${generation}`,
    queryGeneration: generation, criteria: {userId, ...criteria}};
}
async function ready(db, req, c = ctx) {
  let state = await start(db, req, c);
  for (let i = 0; state.state === "preparing"; i++) {
    assert(i < 1000);
    state = await advance(db, continued(state), c);
  }
  assert.equal(state.state, "ready");
  return state;
}
async function all(db, state, c = ctx) {
  const result = [];
  let cursor = null;
  do {
    const response = await page(db, continued(state, cursor), c);
    assert(response.items.length <= 25);
    result.push(...response.items);
    cursor = response.nextCursor;
  } while (cursor);
  return result;
}
function review(db, reviewId, dishId, restaurantId, overrides = {}) {
  const source = {userId, dishId, restaurantId, overallImpression: 8, overallBiteScore: 80,
    createdAt: date, notes: "A public review", ...overrides};
  db.documents.set(`dish_reviews/${reviewId}`, source);
  db.documents.set(`${customerBiteScoreReviewIndex}/${createHash("sha256").update(reviewId).digest("hex")}`,
    buildCustomerBiteScoreReview(reviewId, source));
  return source;
}

test("1164 actual-Dart golden cases preserve all established Local Expert category/alias/exclusion qualification", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/customer_bitescore_expert_parity.json"), "utf8"));
  for (const [file, hash] of Object.entries(fixture.sourceSha256)) {
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(__dirname, "../..", file))).digest("hex"), hash);
  }
  assert.equal(fixture.cases.length, 1164);
  for (const c of fixture.cases) assert.deepEqual(customerBiteScoreExpertTypes.filter((type) => customerBiteScoreExpertMatches(c, type.id))
    .map((v) => v.id), c.expected, JSON.stringify(c));
});

test("saved restaurant alphabetical and dish score/name order are global across 93 candidates, preserving identical names", async () => {
  const db = new MemoryDatabase();
  const dishes = [], restaurants = [];
  for (let i = 0; i < 93; i++) {
    const restaurantId = `restaurant-${i}`;
    const parent = addRestaurant(db, restaurantId, {name: `Cafe ${i % 4}`});
    const dishId = `dish-${i}`;
    addDish(db, dishId, parent, {name: `Burger ${i % 3}`}, {overallBiteScore: i % 6, ratingCount: 100 - i});
    db.documents.set(`user_profiles/${userId}/favorite_restaurants/${restaurantId}`, {restaurantId});
    db.documents.set(`user_profiles/${userId}/favorite_dishes/${dishId}`, {dishId});
    restaurants.push({id: restaurantId, name: parent.name});
    dishes.push({id: dishId, name: `Burger ${i % 3}`, score: i % 6});
  }
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const savedRestaurants = await all(db, await ready(db, request({kind: "savedRestaurants"})));
  assert.deepEqual(savedRestaurants.map((v) => v.restaurant.sourceDocumentId), restaurants.sort((a, b) =>
    cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id)).map((v) => v.id));
  const savedDishes = await all(db, await ready(db, request({kind: "savedDishes"}, 2)));
  assert.deepEqual(savedDishes.map((v) => v.dish.sourceDocumentId), dishes.sort((a, b) =>
    b.score - a.score || cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id)).map((v) => v.id));
  assert(db.queries.every((q) => q.limit <= 26));
  assert(db.readBatches.every((batch) => batch.length <= 75));
  assert(db.maxWrites <= 26);
});

for (const sort of ["highestRated", "lowestRated", "mostRecent", "nearest"]) {
  test(`Local Expert ${sort} preserves exact global review comparator, across pages and varied distances`, async () => {
    const db = new MemoryDatabase();
    const rows = [];
    for (let i = 0; i < 87; i++) {
      const parent = addRestaurant(db, `restaurant-${i}`, {location: new GeoPoint(25.77 + (i % 5) * .01, -80.19)});
      const dish = addDish(db, `dish-${i}`, parent, {name: "Burger", category: "Burgers"});
      const reviewId = `review-${i}`;
      const data = review(db, reviewId, dish.id, parent.id,
        {overallBiteScore: i % 6, createdAt: new Date(nowMs + i % 7 * 1000)});
      rows.push({id: reviewId, score: data.overallBiteScore, date: data.createdAt.getTime(), distance: i % 5});
    }
    const state = await ready(db, request({kind: "localExpert", expertTypeId: "burger", sort,
      location: {latitude: 25.77, longitude: -80.19}}));
    const cmp = (a, b) => {
      const primary = sort === "highestRated" ? b.score - a.score || a.date - b.date :
        sort === "lowestRated" ? a.score - b.score || b.date - a.date :
        sort === "nearest" ? a.distance - b.distance || b.date - a.date : b.date - a.date;
      return primary || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    };
    assert.deepEqual((await all(db, state)).map((v) => v.review.id), rows.sort(cmp).map((v) => v.id));
    const first = await page(db, continued(state), ctx);
    assert.deepEqual((await page(db, continued(state), ctx)).items, first.items);
    assert.equal(new Set((await all(db, state)).map((v) => v.review.id)).size, 87);
  });
}

test("Saved authorization, session/cursor fences, source deletion and LocalExpert-only isDeleted suppression", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  const dish = addDish(db, "dish-a", parent);
  db.documents.set(`user_profiles/${userId}/favorite_dishes/${dish.id}`, {dishId: dish.id});
  await assert.rejects(start(db, request({kind: "savedDishes"}), {...ctx, userId: "other"}), {code: "permission-denied"});
  const state = await ready(db, request({kind: "savedDishes"}));
  assert.equal((await page(db, continued(state), ctx)).items.length, 1);
  await assert.rejects(page(db, continued(state), {...ctx, actorId: "other"}));
  db.documents.delete(`user_profiles/${userId}/favorite_dishes/${dish.id}`);
  assert.equal((await page(db, continued(state), ctx)).items.length, 0);
  review(db, "deleted-for-expert", dish.id, parent.id, {isDeleted: true});
  const reviews = await ready(db, request({kind: "reviews"}, 2));
  assert.equal((await page(db, continued(reviews), ctx)).items.length, 1, "own/public lists preserve their established visibility guard");
  const experts = await ready(db, request({kind: "localExpert", expertTypeId: "burger"}, 3));
  assert.equal((await page(db, continued(experts), ctx)).items.length, 0, "Local Expert's stricter established isDeleted guard remains");
  await assert.rejects(page(db, continued(reviews), ctx));
});

test("profile generation changes restart preparation and account for insertion before the source cursor", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  for (let i = 0; i < 30; i++) {
    const dishId = `dish-${i}`;
    addDish(db, dishId, parent);
    db.documents.set(`user_profiles/${userId}/favorite_dishes/${dishId}`, {dishId});
  }
  let state = await start(db, request({kind: "savedDishes"}), ctx);
  state = await advance(db, continued(state), ctx);
  addDish(db, "a-new-best", parent, {}, {overallBiteScore: 100});
  db.documents.set(`user_profiles/${userId}/favorite_dishes/a-new-best`, {dishId: "a-new-best"});
  db.documents.set(customerBiteScoreProfileGenerationPath(userId), nextCustomerBiteScoreProfileGeneration(null));
  while (state.state === "preparing") state = await advance(db, continued(state), ctx);
  const items = await all(db, state);
  assert.equal(items.length, 31);
  assert.equal(items[0].dish.sourceDocumentId, "a-new-best");
});

test("favorite generation rereads latest state and is idempotent across duplicate, delayed, delete and restore events", async () => {
  const db = new MemoryDatabase();
  const favoritePath = `user_profiles/${userId}/favorite_dishes/dish-a`;
  const run = () => reconcileCustomerBiteScoreFavoriteGeneration(db, userId, "favorite_dishes", "dish-a");
  db.documents.set(favoritePath, {dishId: "dish-a"});
  await Promise.all([run(), run(), run()]);
  assert.equal(db.documents.get(customerBiteScoreProfileGenerationPath(userId)).generation, 1);
  db.documents.set(favoritePath, {dishId: "dish-a", updatedAt: date});
  await run();
  assert.equal(db.documents.get(customerBiteScoreProfileGenerationPath(userId)).generation, 1);
  db.documents.delete(favoritePath);
  await Promise.all([run(), run()]);
  assert.equal(db.documents.get(customerBiteScoreProfileGenerationPath(userId)).generation, 2);
  db.documents.set(favoritePath, {dishId: "dish-a"});
  await Promise.all([run(), run()]);
  assert.equal(db.documents.get(customerBiteScoreProfileGenerationPath(userId)).generation, 3);
});

test("profile and Local Expert date ties preserve Dart microseconds before canonical review identity", async () => {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db);
  const dish = addDish(db, "dish-a", parent);
  review(db, "a-older", dish.id, parent.id, {createdAt: new Timestamp(100, 1000)});
  review(db, "z-newer", dish.id, parent.id, {createdAt: new Timestamp(100, 2000)});
  const recent = await ready(db, request({kind: "reviews"}));
  assert.deepEqual((await all(db, recent)).map((v) => v.review.id), ["z-newer", "a-older"]);
  const high = await ready(db, request({kind: "localExpert", expertTypeId: "burger", sort: "highestRated"}, 2));
  assert.deepEqual((await all(db, high)).map((v) => v.review.id), ["a-older", "z-newer"]);
});
