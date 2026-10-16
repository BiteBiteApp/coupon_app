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

const safetyPreferences = uid => `user_profiles/${uid}/reviewer_safety_state/preferences`;
const safetyBlock = (uid, target = userId) => `user_profiles/${uid}/blocked_reviewers/${target}`;
const viewer = {...context('viewer-actor'), userId: 'viewer'};
function blocking(db, uid, revision, blocked) {
  db.documents.set(safetyPreferences(uid), {schemaVersion: 1, revision, updatedAt: Timestamp.now()});
  if (blocked) db.documents.set(safetyBlock(uid), {schemaVersion: 1, targetUserId: userId, createdAt: Timestamp.now()});
  else db.documents.delete(safetyBlock(uid));
}
function safetyFixture(total = 32) {
  const db = new MemoryDatabase();
  const parent = addRestaurant(db), dish = addDish(db, 'dish-a', parent);
  for (let i = 0; i < total; i++) review(db, `r${String(i).padStart(3, '0')}`, dish.id, parent.id,
    {createdAt: new Date(nowMs + i), overallBiteScore: i % 7});
  const visibilityBatches = [], exactReads = [];
  const run = db.runTransaction.bind(db);
  db.runTransaction = operation => run(tx => operation({...tx,
    getDocument: p => {exactReads.push(p); return tx.getDocument(p);},
    getDocuments: paths => {exactReads.push(...paths); if (paths.some(p => p.includes('/reviewer_safety_state/'))) visibilityBatches.push([...paths]); return tx.getDocuments(paths);},
  }));
  return {db, visibilityBatches, exactReads};
}
const listCriteria = (kind, sort = 'mostRecent') => ({kind, sort, ...(kind === 'localExpert' ? {expertTypeId: 'burger'} : {})});
const isUnavailable = error => ['not-found', 'failed-precondition'].includes(error.code);

for (const kind of ['reviews', 'localExpert']) for (const sort of ['mostRecent', 'highestRated', 'lowestRated', 'nearest']) {
  test(`${kind} ${sort}: unblocked/guest ordering and paging preserved; blocked initial and cached paths rejected`, async () => {
    const {db, visibilityBatches, exactReads} = safetyFixture();
    const c = listCriteria(kind, sort);
    const guest = context('guest-actor');
    const publicState = await ready(db, request(c), guest);
    const expected = await all(db, publicState, guest);
    const state = await ready(db, request(c), viewer);
    assert.deepEqual(await all(db, state, viewer), expected);
    const first = await page(db, continued(state), viewer);
    assert.equal(first.items.length, 25); assert.ok(first.nextCursor);
    blocking(db, 'viewer', 1, true);
    const queryCount = db.queries.length;
    for (const operation of [() => start(db, request(c, 2), viewer), () => advance(db, continued(state), viewer),
      () => page(db, continued(state), viewer), () => page(db, continued(state, first.nextCursor), viewer)]) {
      await assert.rejects(operation(), {code: 'not-found', message: 'This reviewer is unavailable.'});
    }
    assert.equal(db.queries.length, queryCount, 'blocked requests fail before review/result queries');
    assert.deepEqual(await all(db, publicState, guest), expected);
    assert.ok(visibilityBatches.every(batch => batch.length === 4));
    assert.ok(!exactReads.some(p => p.startsWith(`user_profiles/${userId}/reviewer_safety_state`) || p.startsWith(`user_profiles/${userId}/blocked_reviewers`)));
    assert.ok(db.queries.every(q => q.limit <= 26 && !q.collectionPath.includes('blocked_reviewers')));
    assert.ok(db.readBatches.every(batch => batch.length <= 75));
    assert.ok(db.maxWrites <= 26);
  });
}

test('profile sessions bind revision across block/unblock, same-UID retries and stale cursor replay', async () => {
  for (const kind of ['reviews', 'localExpert']) {
    const {db} = safetyFixture(); const req = request(listCriteria(kind));
    const state = await ready(db, req, viewer), first = await page(db, continued(state), viewer);
    blocking(db, 'viewer', 1, true); blocking(db, 'viewer', 2, false);
    for (const operation of [() => start(db, req, viewer), () => advance(db, continued(state), viewer),
      () => page(db, continued(state, first.nextCursor), viewer)]) await assert.rejects(operation(), {code: 'failed-precondition'});
    const fresh = await ready(db, request(listCriteria(kind), 2), viewer);
    assert.equal((await all(db, fresh, viewer)).length, 32);
    await assert.rejects(page(db, continued(fresh, first.nextCursor), viewer));
  }
});

test('reviewer sessions reject switched accounts even if the actor binding is accidentally reused', async () => {
  const {db, exactReads} = safetyFixture();
  const state = await ready(db, request(listCriteria('reviews')), viewer);
  for (const userId of ['other', null, undefined]) {
    exactReads.length = 0;
    for (const operation of [advance, page]) await assert.rejects(operation(db, continued(state), {...viewer, userId}), {code: 'failed-precondition'});
    assert.ok(!exactReads.some(p => p.includes('/blocked_reviewers/')), 'reject identity mismatch before private visibility reads');
  }
  const untouched = await page(db, continued(state), viewer); assert.equal(untouched.items.length, 25);
});

test('pre-safety reviewer sessions require refresh while legacy saved sessions stay valid', async () => {
  const {db} = safetyFixture(1);
  let state = await ready(db, request(listCriteria('reviews')), viewer);
  const sessionPath = `private_bitescore_search_sessions/${state.sessionId}`;
  const stored = db.documents.get(sessionPath);
  delete stored.reviewerVisibility;
  const {customerBiteScoreDigest: digest} = require('../lib/customer_bitescore_search_contract.js');
  stored.queryFingerprint = digest(stored.version, stored.criteria);
  await assert.rejects(page(db, {...continued(state), queryFingerprint: stored.queryFingerprint}, viewer), {code: 'failed-precondition'});
  db.documents.set(`user_profiles/${userId}/favorite_dishes/dish-a`, {dishId: 'dish-a'});
  state = await ready(db, request({kind: 'savedDishes'}, 2), ctx);
  const saved = db.documents.get(`private_bitescore_search_sessions/${state.sessionId}`);
  assert.equal(Object.hasOwn(saved, 'reviewerVisibility'), false);
  assert.equal(saved.queryFingerprint, digest(saved.version, saved.criteria));
  assert.equal((await page(db, continued(state), ctx)).items.length, 1);
});

test('in-flight preparation and page reads reject block/unblock changes before returning', async () => {
  for (const kind of ['reviews', 'localExpert']) for (const phase of ['advance', 'page']) for (const blocked of [true, false]) {
    const {db} = safetyFixture();
    const state = phase === 'page' ? await ready(db, request(listCriteria(kind)), viewer) : await start(db, request(listCriteria(kind)), viewer);
    let changed = false;
    db.beforeQuery = query => {
      if (!changed && query.collectionPath === (phase === 'advance' ? customerBiteScoreReviewIndex : 'private_bitescore_search_results')) {
        changed = true; blocking(db, 'viewer', blocked ? 1 : 2, blocked);
      }
    };
    await assert.rejects((phase === 'advance' ? advance : page)(db, continued(state), viewer), isUnavailable);
    assert.equal(changed, true);
  }
});

test('malformed private state and deleting viewer/target fail closed for profile list start and continuation', async () => {
  const {db} = safetyFixture(1);
  const state = await ready(db, request(listCriteria('reviews')), viewer);
  const invalid = [
    () => db.documents.set(safetyPreferences('viewer'), {}),
    () => db.documents.set(safetyPreferences('viewer'), {schemaVersion: 1, revision: -1, updatedAt: Timestamp.now()}),
    () => db.documents.set(safetyPreferences('viewer'), {schemaVersion: 1, revision: '1', updatedAt: Timestamp.now()}),
    () => {blocking(db, 'viewer', 1, true); db.documents.get(safetyBlock('viewer')).targetUserId = 'forged';},
    () => {blocking(db, 'viewer', 1, true); db.documents.delete(safetyPreferences('viewer'));},
    () => db.documents.set('private_account_deletions/viewer', {}),
    () => db.documents.set(`private_account_deletions/${userId}`, {}),
  ];
  for (const corrupt of invalid) {
    db.documents.delete(safetyPreferences('viewer')); db.documents.delete(safetyBlock('viewer'));
    db.documents.delete('private_account_deletions/viewer'); db.documents.delete(`private_account_deletions/${userId}`);
    corrupt();
    for (const operation of [() => start(db, request(listCriteria('reviews'), 2), viewer), () => advance(db, continued(state), viewer), () => page(db, continued(state), viewer)]) {
      await assert.rejects(operation(), {code: 'failed-precondition'});
    }
  }
});

test('saved lists ignore blocking state and preserve ownership, results, and exact session contract', async () => {
  const {db, visibilityBatches} = safetyFixture(1);
  db.documents.set(`user_profiles/${userId}/favorite_dishes/dish-a`, {dishId: 'dish-a'});
  db.documents.set(`user_profiles/${userId}/favorite_restaurants/restaurant-a`, {restaurantId: 'restaurant-a'});
  db.documents.set(safetyPreferences(userId), {malformed: true});
  for (const [i, kind] of ['savedDishes', 'savedRestaurants'].entries()) {
    const state = await ready(db, request({kind}, i + 1), ctx);
    assert.equal((await all(db, state, ctx)).length, 1);
    await assert.rejects(page(db, continued(state), viewer), {code: 'failed-precondition'});
  }
  assert.equal(visibilityBatches.length, 0);
});

test('profile visibility work is constant per operation and public records never change', async () => {
  const {db, visibilityBatches} = safetyFixture(32);
  const publicData = () => require('node:v8').serialize([...db.documents].filter(([p]) => !p.startsWith('private_bitescore_search_') && !p.startsWith('private_bitescore_search_admission/')));
  const before = publicData();
  let state = await start(db, request(listCriteria('reviews')), viewer);
  assert.equal(visibilityBatches.length, 1);
  let checks = visibilityBatches.length;
  state = await advance(db, continued(state), viewer);
  assert.equal(visibilityBatches.length - checks, 2);
  state = await advance(db, continued(state), viewer);
  checks = visibilityBatches.length;
  const result = await page(db, continued(state), viewer);
  assert.equal(visibilityBatches.length - checks, 2);
  assert.equal(result.items.length, 25);
  for (const batch of visibilityBatches) assert.deepEqual(batch, [safetyPreferences('viewer'), safetyBlock('viewer'), `private_account_deletions/${userId}`, 'private_account_deletions/viewer']);
  for (const key of ['reviewerVisibility', 'viewerBinding', 'revision', 'blocked']) assert.equal(Object.hasOwn(result, key), false);
  assert.deepEqual(publicData(), before);
});

test('public target criteria cannot select private viewer state; anonymous guests retain public lists', async () => {
  const {db, exactReads} = safetyFixture(1);
  blocking(db, 'viewer', 1, true);
  const spoofed = {...request(listCriteria('reviews')), viewerId: 'other', userId: 'other', expectedUserId: 'other'};
  await assert.rejects(start(db, spoofed, viewer), {code: 'not-found'});
  exactReads.length = 0;
  const guest = {...context('anonymous-actor'), userId: 'anonymous-guest'};
  const state = await ready(db, spoofed, guest);
  assert.equal((await all(db, state, guest)).length, 1);
  assert.ok(!exactReads.some(p => p === safetyPreferences('viewer') || p === safetyBlock('viewer')));
  assert.ok(!exactReads.some(p => p === safetyPreferences(userId) || p === safetyBlock(userId)));
});
