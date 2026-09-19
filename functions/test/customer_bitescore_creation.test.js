"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../lib/customer_bitescore_creation.js");
const {customerBiteScoreReviewDocumentId} = require("../lib/bitescore_review_aggregate.js");
const {buildBiteScoreRestaurantIndex, buildBiteScoreDishIndex} = require("../lib/search_index_builders.js");
const {decideRestaurantGeohashWrite, extractBiteScoreRestaurantCoordinates} = require("../lib/restaurant_geo_helpers.js");
const claim = api.submitCustomerBiteScoreRestaurantClaimHandler;
const restaurant = api.resolveCustomerBiteScoreRestaurantCreationHandler;
const dish = api.resolveCustomerBiteScoreDishCreationHandler;
const complete = api.completeCustomerBiteScoreRestaurantProvenanceHandler;
const {OpaqueCursorCodec} = require("../lib/opaque_cursor.js");
const cursorCodec = new OpaqueCursorCodec({key: Buffer.alloc(32, 7)});
const actor = {cursorCodec, userId: "verified-user", email: "real@example.test", emailVerified: true, isAnonymous: false};
const now = new Date("2026-09-19T05:00:00Z");
class Database {
  documents = new Map(); queries = []; reads = []; tail = Promise.resolve();
  set(path, data) { this.documents.set(path, structuredClone(data)); }
  get(path) { return this.documents.get(path); }
  async runTransaction(callback) {
    const running = this.tail.then(async () => {
      let writing = false; const writes = [];
      const read = (path, data) => ({id: path.split("/").at(-1), data, createTime: now});
      const check = () => assert.equal(writing, false, "transaction read after write");
      const result = await callback({
        getDocument: async (path) => { check(); this.reads.push(path); return this.documents.has(path) ? read(path, this.get(path)) : null; },
        queryDocuments: async (query) => {
          check(); this.queries.push(query); assert.ok(query.limit === 1 || query.limit === 25);
          return [...this.documents.entries()].filter(([path, data]) => {
            if (!path.startsWith(query.collectionPath + "/") || path.split("/").length !== 2) return false;
            return (query.where ?? []).every((f) => f.operator === "==" && data[f.field] === f.value);
          }).filter(([path]) => !query.startAfter || path.split("/").at(-1) > query.startAfter[0]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, query.limit).map(([path, data]) => read(path, data));
        },
        setDocument: (path, data, options) => { writing = true; writes.push([path, data, options]); },
        deleteDocument: () => { throw Error("creation may not delete"); },
      });
      for (const [path, data, options] of writes) this.set(path, options?.merge ? {...this.get(path), ...data} : data);
      return result;
    });
    this.tail = running.catch(() => {}); return running;
  }
}
const restaurantInput = (extra = {}) => ({schemaVersion: 1, expectedUserId: actor.userId, requestId: "restaurant_request_01", name: "Good Food",
  address: "1 Main St", city: "New York", state: "New York", zipCode: "10001", ...extra});
const dishInput = (id, extra = {}) => ({schemaVersion: 1, expectedUserId: actor.userId, requestId: "dish_request_0001", restaurantId: id,
  dishName: "  bBQ-smash BURGER ", category: "Burgers", subcategory: "Beef", categoryManualKeywords: null,
  categoryTags: ["burgers", "burger", "bbq-smash burger", "good food"], priceLabel: "$8", allowExistingMatch: true, ...extra});
const claimInput = (id, extra = {}) => ({schemaVersion: 1, expectedUserId: actor.userId, restaurantId: id, claimantName: " Owner ", phone: "555-0100", message: "Please review", ...extra});
async function created(db = new Database()) {
  const response = await restaurant(db, restaurantInput({location: {latitude: 40.75, longitude: -73.99}}), actor, now);
  return {db, response, id: response.restaurant.id};
}
async function resolved(handler, db, input, context = actor) {
  let request = input, calls = 0;
  while (true) {
    calls++;
    const result = await handler(db, request, context, now);
    if (result.state !== "preparing") return {result, calls};
    assert.equal(typeof result.nextCursor, "string");
    request = {...input, cursor: result.nextCursor};
  }
}

test("restaurant lookup is read-only before address verification and new source has modern canonical fields", async () => {
  const db = new Database();
  assert.deepEqual(await restaurant(db, restaurantInput(), actor, now), {schemaVersion: 1, requiresLocation: true});
  assert.equal(db.documents.size, 0);
  const {response, id} = await created(db); const data = db.get(`bitescore_restaurants/${id}`);
  assert.equal(response.wasCreated, true); assert.equal(data.normalizedName, "good food");
  assert.equal(data.state, "NY"); assert.equal(data.zipCode, "10001");
  assert.equal(data.latitude, 40.75); assert.equal(data.restaurantWriteRevision, 0);
  assert.equal(data.createdByUserId, actor.userId); assert.equal(data.createdFromCreateFlow, true);
  assert.equal(data.isActive, true); assert.equal(data.active, true); assert.equal(data.isClaimed, false);
  assert.equal(data.ownerUserId, null); assert.equal(data.createdFromDishId, undefined);
  assert.equal(response.restaurant.ownerUserId, undefined); assert.equal(response.restaurant.createdByUserId, undefined);
});

test("exact restaurant matching finds beyond a preview and never returns mixed private source fields", async () => {
  const {db, id} = await created(); const target = db.get(`bitescore_restaurants/${id}`);
  db.set(`bitescore_restaurants/${id}`, {...target, ownerUserId: "private-owner", isClaimed: true,
    claimInvitationEpochAt: now, linkedBiteSaverUid: "private-link", billing: {secret: true}});
  for (let i = 0; i < 150; i++) db.set(`bitescore_restaurants/a${i}`, {...target, id: `a${i}`, normalizedName: `other${i}`});
  const response = await restaurant(db, restaurantInput({requestId: "different_request_02", expectedUserId: "other-user"}), {...actor, userId: "other-user"});
  assert.equal(response.restaurant.id, id); assert.equal(response.wasCreated, false);
  assert.equal(response.restaurant.isClaimed, true);
  for (const key of ["ownerUserId", "claimInvitationEpochAt", "linkedBiteSaverUid", "billing", "createdByUserId"]) assert.equal(response.restaurant[key], undefined);
  assert.deepEqual(db.queries.at(-1).where.map((v) => v.field), ["zipCode", "normalizedName"]);
});

test("new canonical writes directly produce safe search projections without a geohash revision race", async () => {
  const {db, id} = await created();
  const result = await dish(db, dishInput(id), actor, now);
  const source = db.get(`bitescore_restaurants/${id}`);
  assert.deepEqual(decideRestaurantGeohashWrite(source, extractBiteScoreRestaurantCoordinates), {type: "none"});
  const parent = buildBiteScoreRestaurantIndex({sourceDocumentId: id, source, now});
  const child = buildBiteScoreDishIndex({sourceDocumentId: result.dish.id,
    dish: db.get(`bitescore_dishes/${result.dish.id}`), restaurantDocumentId: id, restaurant: source, aggregate: null, now});
  assert.equal(parent.customerPublicProjection.sourceDocumentId, id);
  assert.equal(child.customerPublicProjection.sourceDocumentId, result.dish.id);
  assert.equal(parent.customerPublicProjection.geohash, source.geohash);
  assert.equal(child.customerPublicProjection.geohash, source.geohash);
  assert.equal(parent.customerPublicProjection.createdByUserId, undefined);
  assert.equal(child.customerPublicProjection.createdFromReviewId, undefined);
});

test("retries bind generated restaurant IDs to actor and request without overwriting another request", async () => {
  const {db, response, id} = await created();
  assert.deepEqual(await restaurant(db, restaurantInput(), actor), response);
  assert.equal(db.documents.size, 1);
  await assert.rejects(restaurant(db, restaurantInput({name: "Different"}), actor), {code: "failed-precondition"});
  assert.equal(db.get(`bitescore_restaurants/${id}`).name, "Good Food");
});

test("dish creation and force-create preserve distinct exact identities and modern review provenance", async () => {
  const {db, id} = await created();
  const first = await dish(db, dishInput(id), actor, now);
  assert.equal(first.wasCreated, true); assert.equal(first.restaurantHadNoDishesBefore, true);
  assert.equal(first.dish.name, "Bbq-Smash Burger");
  const source = db.get(`bitescore_dishes/${first.dish.id}`);
  assert.equal(source.createdFromReviewId, customerBiteScoreReviewDocumentId(first.dish.id, actor.userId));
  assert.equal(source.createdWithRestaurantId, id); assert.equal(source.createdByUserId, actor.userId);
  assert.equal(source.mergedIntoDishId, null); assert.equal(source.isActive, true);
  assert.equal(first.dish.createdByUserId, undefined);
  const retry = await dish(db, dishInput(id), actor, now);
  assert.equal(retry.dish.id, first.dish.id); assert.equal(retry.wasCreated, true);
  const second = await dish(db, dishInput(id, {requestId: "dish_request_0002", allowExistingMatch: false}), actor, now);
  assert.notEqual(second.dish.id, first.dish.id); assert.equal(second.wasCreated, true);
  assert.equal(second.restaurantHadNoDishesBefore, false);
});

test("existing dish category edit retains identity, price, provenance and aggregate authority", async () => {
  const {db, id} = await created(); const first = await dish(db, dishInput(id), actor, now);
  const path = `bitescore_dishes/${first.dish.id}`;
  db.set(path, {...db.get(path), aggregateWriteGeneration: 7, privateMetadata: "hidden"});
  const result = await dish(db, dishInput(id, {requestId: "dish_request_0003", expectedUserId: "second-user", category: "Other", categoryManualKeywords: "smoky", priceLabel: "$99"}), {...actor, userId: "second-user"}, now);
  assert.equal(result.wasCreated, false); assert.equal(result.dish.id, first.dish.id);
  assert.equal(db.get(path).createdByUserId, actor.userId); assert.equal(db.get(path).aggregateWriteGeneration, 7);
  assert.equal(result.dish.priceLabel, "$8"); assert.equal(result.dish.category, "Other");
  assert.equal(result.dish.privateMetadata, undefined); assert.equal(result.dish.aggregateWriteGeneration, undefined);
});

test("inactive and merged dish rows do not conceal a later active exact match", async () => {
  const {db, id} = await created();
  for (let i = 0; i < 120; i++) db.set(`bitescore_dishes/a${i}`, {id: `a${i}`, restaurantId: id, normalizedName: "bbq-smash burger", isActive: false, mergedIntoDishId: null});
  const first = await dish(db, dishInput(id), actor);
  const result = await dish(db, dishInput(id, {requestId: "dish_request_0002"}), actor);
  assert.equal(result.dish.id, first.dish.id); assert.equal(result.wasCreated, false);
});

test("provenance completion is creator-bound, revision-fenced and idempotent without requiring an unwritten review", async () => {
  const {db, id} = await created(); const result = await dish(db, dishInput(id), actor);
  const input = {schemaVersion: 1, expectedUserId: actor.userId, restaurantId: id, dishId: result.dish.id, expectedRestaurantRevision: 0};
  await assert.rejects(complete(db, {...input, expectedUserId: "other-user"}, {...actor, userId: "other-user"}), {code: "permission-denied"});
  await assert.rejects(complete(db, {...input, expectedRestaurantRevision: 1}, actor), {code: "failed-precondition"});
  const response = await complete(db, input, actor);
  assert.equal(response.restaurant.restaurantWriteRevision, 1);
  assert.deepEqual(await complete(db, input, actor), response);
  const source = db.get(`bitescore_restaurants/${id}`);
  assert.equal(source.createdFromDishId, result.dish.id);
  assert.equal(source.createdFromReviewId, customerBiteScoreReviewDocumentId(result.dish.id, actor.userId));
  assert.equal([...db.documents.keys()].some((p) => p.startsWith("dish_reviews/")), false);
  assert.equal(response.restaurant.createdFromReviewId, undefined);
});

test("completion cannot attach another restaurant's dish or replace already populated provenance", async () => {
  const {db, id} = await created(); const result = await dish(db, dishInput(id), actor);
  const input = {schemaVersion: 1, expectedUserId: actor.userId, restaurantId: id, dishId: result.dish.id, expectedRestaurantRevision: 0};
  const dishPath = `bitescore_dishes/${result.dish.id}`; const original = db.get(dishPath);
  db.set(dishPath, {...original, restaurantId: "another-parent"});
  await assert.rejects(complete(db, input, actor), {code: "permission-denied"});
  db.set(dishPath, original);
  db.set(`bitescore_restaurants/${id}`, {...db.get(`bitescore_restaurants/${id}`), createdFromDishId: null});
  await assert.rejects(complete(db, input, actor), {code: "failed-precondition"});
});

test("claim submission derives identity and email, prevents pending duplicates, and preserves rejected history", async () => {
  const {db, id} = await created();
  const first = await claim(db, claimInput(id), actor, now);
  const path = `restaurant_claim_requests/${first.claimId}`; const source = db.get(path);
  assert.equal(source.requesterUserId, actor.userId); assert.equal(source.email, actor.email);
  assert.equal(source.restaurantName, "Good Food"); assert.equal(source.status, "pending");
  assert.deepEqual(Object.keys(first).sort(), ["claimId", "schemaVersion"]);
  await assert.rejects(claim(db, claimInput(id), actor), {code: "already-exists"});
  db.set(path, {...source, status: "rejected"});
  const second = await claim(db, claimInput(id), actor);
  assert.notEqual(first.claimId, second.claimId); assert.equal(db.get(path).status, "rejected");
  assert.equal(db.get(`bitescore_restaurants/${id}`).isClaimed, false);
});

test("claim eligibility rejects canonical mismatch, owner, malformed flags, inactive and missing targets", async () => {
  for (const changes of [{id: "wrong"}, {isClaimed: true}, {isClaimed: "false"}, {ownerUserId: "owner"}, {ownerUserId: 0}, {active: false}, {isActive: false}, {isActive: "true"}]) {
    const {db, id} = await created();
    db.set(`bitescore_restaurants/${id}`, {...db.get(`bitescore_restaurants/${id}`), ...changes});
    await assert.rejects(claim(db, claimInput(id), actor), {code: "failed-precondition"});
    assert.equal([...db.documents.keys()].some((p) => p.startsWith("restaurant_claim_requests/")), false);
  }
  await assert.rejects(claim(new Database(), claimInput("missing"), actor), {code: "failed-precondition"});
});

test("all creation and claim entrypoints require verified nonanonymous auth before any reads", async () => {
  for (const context of [{...actor, userId: null}, {...actor, emailVerified: false}, {...actor, isAnonymous: true}]) {
    const db = new Database();
    for (const handler of [claim, restaurant, dish, complete]) await assert.rejects(handler(db, {}, context), {code: "permission-denied"});
    assert.equal(db.reads.length, 0); assert.equal(db.queries.length, 0);
  }
});

test("trusted request allowlists reject forged actor, ownership, invitation, aggregate and whitespace identities", async () => {
  const {db, id} = await created();
  for (const extra of [{requesterUserId: "victim"}, {email: "forged"}, {ownerUserId: "victim"}, {status: "approved"}]) {
    await assert.rejects(claim(db, claimInput(id, extra), actor), {code: "invalid-argument"});
  }
  for (const extra of [{createdByUserId: "victim"}, {isClaimed: true}, {claimInvitationEpochAt: now}]) {
    await assert.rejects(restaurant(db, restaurantInput(extra), actor), {code: "invalid-argument"});
  }
  for (const extra of [{aggregateWriteGeneration: 4}, {createdFromReviewId: "forged"}, {restaurantId: ` ${id}`}]) {
    await assert.rejects(dish(db, dishInput(id, extra), actor), {code: "invalid-argument"});
  }
});

test("restaurant and dish operation locks block writes and provenance without read-after-write", async () => {
  const {db, id} = await created(); const result = await dish(db, dishInput(id), actor);
  db.set(`private_rating_restaurant_operation_locks/${id}`, {jobId: "destructive"});
  await assert.rejects(claim(db, claimInput(id), actor), {code: "failed-precondition"});
  await assert.rejects(restaurant(db, restaurantInput(), actor), {code: "failed-precondition"});
  await assert.rejects(dish(db, dishInput(id), actor), {code: "failed-precondition"});
  db.documents.delete(`private_rating_restaurant_operation_locks/${id}`);
  db.set(`private_rating_dish_operation_locks/${result.dish.id}`, {jobId: "merge"});
  await assert.rejects(dish(db, dishInput(id), actor), {code: "failed-precondition"});
  await assert.rejects(dish(db, dishInput(id, {requestId: "dish_request_0002"}), actor), {code: "failed-precondition"});
  await assert.rejects(complete(db, {schemaVersion: 1, expectedUserId: actor.userId, restaurantId: id, dishId: result.dish.id, expectedRestaurantRevision: 0}, actor), {code: "failed-precondition"});
});

test("concurrent request retries create one dish and concurrent pending claims create one request", async () => {
  const {db, id} = await created();
  const results = await Promise.all(Array.from({length: 6}, () => dish(db, dishInput(id, {allowExistingMatch: false}), actor)));
  assert.equal(new Set(results.map((r) => r.dish.id)).size, 1);
  const claims = await Promise.allSettled(Array.from({length: 6}, () => claim(db, claimInput(id), actor)));
  assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
});

test("all four handlers reject an SDK account switch before any source reads or writes", async () => {
  const db = new Database();
  const inputs = [claimInput("restaurant-1"), restaurantInput(), dishInput("restaurant-1"),
    {schemaVersion: 1, expectedUserId: actor.userId, restaurantId: "restaurant-1", dishId: "dish-1", expectedRestaurantRevision: 0}];
  for (const [index, handler] of [claim, restaurant, dish, complete].entries()) {
    await assert.rejects(handler(db, inputs[index], {...actor, userId: "switched-user"}), {code: "permission-denied"});
    await assert.rejects(handler(db, {...inputs[index], expectedUserId: ` ${actor.userId}`}, actor), {code: "invalid-argument"});
  }
  assert.deepEqual(db.reads, []); assert.deepEqual(db.queries, []); assert.equal(db.documents.size, 0);
});

test("restaurant names at and above1500 UTF8 bytes resolve exact full values beyond100 in bounded continuation", async () => {
  for (const name of ["é".repeat(750), "é".repeat(750) + " target"]) {
    const {db, id} = await created(); const base = db.get(`bitescore_restaurants/${id}`);
    for (let i = 0; i < 126; i++) {
      const rowId = `long-${String(i).padStart(3, "0")}-` + "x".repeat(1300);
      const rowName = i === 125 ? name : i === 124 ? name + " other" : `Other ${i}`;
      db.set(`bitescore_restaurants/${rowId}`, {...base, id: rowId, name: rowName, normalizedName: rowName.toLowerCase()});
    }
    const queryStart = db.queries.length;
    const {result, calls} = await resolved(restaurant, db, restaurantInput({requestId: "long_restaurant_request", name}));
    assert.equal(result.wasCreated, false); assert.equal(result.restaurant.name, name); assert.equal(calls, 6);
    assert.ok(db.queries.slice(queryStart).every((q) => q.limit === 25 && q.where.every((f) => f.field !== "normalizedName")));
    assert.equal(db.documents.size, 127);
  }
});

test("long dish names distinguish common indexed prefixes and scan all remaining eligible parent scope", async () => {
  const {db, id} = await created(); const first = await dish(db, dishInput(id), actor);
  const base = db.get(`bitescore_dishes/${first.dish.id}`);
  const name = "x".repeat(1600) + " desired";
  for (let i = 0; i < 127; i++) {
    const rowId = `long-${String(i).padStart(3, "0")}`;
    const rowName = i === 126 ? name : i === 125 ? "x".repeat(1600) + " alias" : `Other ${i}`;
    db.set(`bitescore_dishes/${rowId}`, {...base, id: rowId, name: rowName, normalizedName: rowName.toLowerCase()});
  }
  const queryStart = db.queries.length;
  const {result, calls} = await resolved(dish, db, dishInput(id, {requestId: "long_dish_request_01", dishName: name}));
  assert.equal(result.dish.id, "long-126"); assert.equal(result.wasCreated, false); assert.equal(calls, 6);
  for (const query of db.queries.slice(queryStart)) {
    assert.ok(query.limit <= 25);
    assert.deepEqual(query.where.map((f) => f.field), ["restaurantId", "isActive", "mergedIntoDishId"]);
  }
});

test("long-name continuation binds actor and complete criteria and exhausts without inventing a match", async () => {
  const {db, id} = await created(); const base = db.get(`bitescore_restaurants/${id}`);
  for (let i = 0; i < 104; i++) db.set(`bitescore_restaurants/r${String(i).padStart(3, "0")}`, {...base, id: `r${String(i).padStart(3, "0")}`, normalizedName: `other${i}`});
  const input = restaurantInput({requestId: "missing_long_request", name: "é".repeat(750) + " absent"});
  const initial = await restaurant(db, input, actor);
  assert.equal(initial.state, "preparing");
  const reordered = Object.fromEntries(Object.entries({...input, cursor: initial.nextCursor}).reverse());
  assert.equal((await restaurant(db, reordered, actor)).state, "preparing");
  const locatedInput = {...input, location: {latitude: 40.75, longitude: -73.99}};
  const located = await restaurant(db, locatedInput, actor);
  const reorderedLocated = Object.fromEntries(Object.entries({...locatedInput,
    location: {longitude: -73.9900, latitude: 40.7500}, cursor: located.nextCursor}).reverse());
  assert.equal((await restaurant(db, reorderedLocated, actor)).state, "preparing");
  await assert.rejects(restaurant(db, {...input, name: input.name + "changed", cursor: initial.nextCursor}, actor));
  await assert.rejects(restaurant(db, {...input, expectedUserId: "other", cursor: initial.nextCursor}, {...actor, userId: "other"}));
  await assert.rejects(restaurant(db, {...input, cursor: initial.nextCursor.slice(0, -3) + "abc"}, actor));
  const {result, calls} = await resolved(restaurant, db, input);
  assert.deepEqual(result, {schemaVersion: 1, requiresLocation: true}); assert.equal(calls, 5);
  assert.equal(db.documents.size, 105);
});

test("short equality response is compared with the complete normalized value before reuse", async () => {
  const {db, id} = await created(); const run = db.runTransaction.bind(db);
  db.runTransaction = (callback) => run((tx) => callback({...tx, queryDocuments: async (query) => {
    const rows = await tx.queryDocuments(query);
    return rows.map((row) => ({...row, data: {...row.data, normalizedName: "different"}}));
  }}));
  await assert.rejects(restaurant(db, restaurantInput({requestId: "different_request_02"}), actor), {code: "failed-precondition"});
  assert.equal(db.documents.size, 1); assert.equal(db.get(`bitescore_restaurants/${id}`).normalizedName, "good food");
});
