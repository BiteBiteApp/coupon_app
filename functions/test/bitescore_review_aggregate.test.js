"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  biteScoreReviewAggregationRuntimePath,
  biteScoreReviewAggregateStatePath,
  continueBiteScoreReviewAggregateRebuild,
  continueBiteScoreReviewAggregates,
  reconcileBiteScoreReviewAggregateEvent,
  reconcileBiteScoreReviewAggregateDish,
  saveCustomerBiteScoreReview,
  computeTrustedBiteScore,
} = require("../lib/bitescore_review_aggregate.js");

const {customerBiteScoreUtf16Key} = require("../lib/customer_bitescore_search_contract.js");
const base = new Date("2026-09-19T12:00:00Z");
const later = (n) => new Date(base.getTime() + n * 1000);
class MemoryDatabase {
  documents = new Map();
  queries = [];
  reads = [];
  tail = Promise.resolve();
  set(path, data) { this.documents.set(path, structuredClone(data)); }
  get(path) { return this.documents.get(path); }
  async runTransaction(operation) {
    const running = this.tail.then(async () => {
      const writes = [];
      let writing = false;
      const readCheck = () => assert.equal(writing, false, "Firestore reads must precede writes");
      const read = (path, data) => ({id: path.split("/").at(-1), data: structuredClone(data), createTime: base});
      const result = await operation({
        getDocument: async (path) => {
          readCheck(); this.reads.push(path);
          return this.documents.has(path) ? read(path, this.documents.get(path)) : null;
        },
        queryDocuments: async (query) => {
          readCheck(); this.queries.push(structuredClone(query));
          assert.ok(query.limit > 0 && query.limit <= 25);
          const prefix = query.collectionPath + "/";
          let rows = [...this.documents.entries()].filter(([p]) =>
            p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
            .map(([p, d]) => read(p, d));
          const field = (row, key) => key === "__name__" ? row.id : row.data[key];
          for (const condition of query.where ?? []) {
            rows = rows.filter((row) => {
              const v = field(row, condition.field);
              if (condition.operator === "==") return v === condition.value;
              if (condition.operator === "<") return v < condition.value;
              throw Error("Unhandled comparison");
            });
          }
          const order = query.orderBy ?? [{field: "__name__", direction: "asc"}];
          // Firestore orderBy excludes missing fields.
          rows = rows.filter((row) => order.every((o) => field(row, o.field) !== undefined));
          const cmp = (a, b) => {
            for (const o of order) {
              const av = field(a, o.field), bv = field(b, o.field);
              const c = av instanceof Uint8Array && bv instanceof Uint8Array
                ? Buffer.compare(Buffer.from(av), Buffer.from(bv))
                : av < bv ? -1 : av > bv ? 1 : 0;
              if (c) return o.direction === "desc" ? -c : c;
            }
            return 0;
          };
          rows.sort(cmp);
          if (query.startAfter) {
            const cursor = {id: "", data: {}};
            order.forEach((o, i) => {
              if (o.field === "__name__") cursor.id = query.startAfter[i];
              else cursor.data[o.field] = query.startAfter[i];
            });
            rows = rows.filter((row) => cmp(row, cursor) > 0);
          }
          return rows.slice(0, query.limit);
        },
        setDocument: (path, data, options) => { writing = true; writes.push([path, data, options]); },
        deleteDocument: (path) => { writing = true; writes.push([path, null]); },
      });
      for (const [path, data, options] of writes) {
        if (data === null) this.documents.delete(path);
        else this.set(path, options?.merge ? {...this.get(path), ...data} : data);
      }
      return result;
    });
    this.tail = running.catch(() => {});
    return running;
  }
}
function database() {
  const db = new MemoryDatabase();
  db.set(biteScoreReviewAggregationRuntimePath, {enabled: true, version: 1, epoch: "new-content"});
  db.set("bitescore_restaurants/restaurant-1", {id: "restaurant-1", isActive: true});
  db.set("bitescore_dishes/dish-1", {id: "dish-1", restaurantId: "restaurant-1", isActive: true});
  return db;
}
function input(overrides = {}) {
  return {schemaVersion: 1, expectedUserId: "user-1", dishId: "dish-1", restaurantId: "restaurant-1", headline: "Good",
    notes: "Tasty", overallImpression: 8, tastinessScore: 7, qualityScore: 9, valueScore: 6, ...overrides};
}
function raw(reviewId, overrides = {}) {
  const key = customerBiteScoreUtf16Key(reviewId);
  return {aggregateReviewOrder0: key.subarray(0, 1500), aggregateReviewOrder1: key.subarray(1500), id: reviewId, dishId: "dish-1", restaurantId: "restaurant-1", userId: "user-1",
    overallImpression: 8, tastinessScore: 7, qualityScore: 9, valueScore: 6, overallBiteScore: 78,
    headline: "Good", notes: "Tasty", createdAt: base, updatedAt: base, ...overrides};
}
const save = (db, uid, overrides = {}, time = base) => saveCustomerBiteScoreReview(
  db, {uid, emailVerified: true}, input({expectedUserId: uid, ...overrides}), time);
const event = (db, reviewId, before, after, time = later(1)) => reconcileBiteScoreReviewAggregateEvent(
  db, {reviewId, before, after, now: time});
const aggregate = (db) => db.get("dish_rating_aggregates/dish-1");
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`); }

// Formula and contribution semantics match the established client, including
// visibility being separate from score eligibility.
test("trusted save preserves formula, replaces edits, and trigger retry is idempotent", async () => {
  const db = database();
  const created = await save(db, "user-1");
  close(created.review.overallBiteScore, computeTrustedBiteScore(input()));
  assert.equal(aggregate(db).ratingCount, 1);
  const id = created.review.id;
  const original = db.get(`dish_reviews/${id}`);
  await event(db, id, null, original);
  await event(db, id, null, original);
  assert.equal(aggregate(db).ratingCount, 1);
  await save(db, "user-1", {overallImpression: 10}, later(2));
  const edited = db.get(`dish_reviews/${id}`);
  close(aggregate(db).overallBiteScore, computeTrustedBiteScore(input({overallImpression: 10})));
  await event(db, id, null, original, later(3));
  await event(db, id, original, edited, later(4));
  assert.equal(aggregate(db).ratingCount, 1);
  assert.equal(edited.createdAt.getTime(), original.createdAt.getTime());
  assert.equal(JSON.stringify(created).includes("undefined"), false);
  assert.equal(Object.hasOwn(created.review, "createdAt"), false);
});

test("concurrent logical reviews preserve totals and only one contribution per reviewer", async () => {
  const db = database();
  await Promise.all(Array.from({length: 40}, (_, i) => save(db, `u${i}`, {overallImpression: i % 10 + 1})));
  assert.equal(aggregate(db).ratingCount, 40);
  const expected = Array.from({length: 40}, (_, i) => computeTrustedBiteScore(input({overallImpression: i % 10 + 1})))
    .reduce((a, b) => a + b, 0) / 40;
  close(aggregate(db).overallBiteScore, expected);
  await Promise.all([save(db, "u0", {qualityScore: 1}), save(db, "u0", {qualityScore: 10})]);
  assert.equal(aggregate(db).ratingCount, 40);
  assert.ok(db.queries.every((q) => q.limit === 1));
});

test("delete, stale deletion after restoration, moderation, and actual zero review result", async () => {
  const db = database();
  const response = await save(db, "user-1");
  const reviewId = response.review.id;
  const original = db.get(`dish_reviews/${reviewId}`);
  for (const flag of [{hidden: true}, {isPublic: false}, {status: "rejected"}, {deleted: true}]) {
    const hidden = {...original, ...flag, updatedAt: later(2)};
    db.set(`dish_reviews/${reviewId}`, hidden);
    await event(db, reviewId, original, hidden);
    assert.equal(aggregate(db).ratingCount, 1, "visibility does not change established score eligibility");
  }
  db.documents.delete(`dish_reviews/${reviewId}`);
  await event(db, reviewId, original, null);
  assert.equal(aggregate(db).ratingCount, 0);
  assert.equal(aggregate(db).overallBiteScore, 0);
  assert.equal(aggregate(db).tastinessScoreAverage, null);
  db.set(`dish_reviews/${reviewId}`, {...original, updatedAt: later(4)});
  await event(db, reviewId, null, original);
  await event(db, reviewId, original, null); // delayed deletion must read restoration
  assert.equal(aggregate(db).ratingCount, 1);
});

test("duplicate logical IDs use global freshness and exact document ID tie-break", async () => {
  const db = database();
  for (const [reviewId, score] of [["a", 10], ["z", 90]]) db.set(`dish_reviews/${reviewId}`, raw(reviewId, {overallBiteScore: score}));
  await event(db, "a", null, raw("a"));
  assert.equal(aggregate(db).ratingCount, 1);
  assert.equal(aggregate(db).overallBiteScore, 90);
  await event(db, "z", null, raw("z"));
  assert.equal(aggregate(db).ratingCount, 1);
  db.documents.delete("dish_reviews/z");
  await event(db, "z", raw("z"), null);
  assert.equal(aggregate(db).overallBiteScore, 10);
  const edit = await save(db, "user-1", {qualityScore: 10}, later(5));
  assert.equal(edit.review.id, "a", "edit existing logical review, do not create another rating");
  assert.equal(aggregate(db).ratingCount, 1);
});

test("old delayed save timestamps cannot change logical freshness winner", async () => {
  const db = database();
  db.set("dish_reviews/a", raw("a", {updatedAt: later(10)}));
  db.set("dish_reviews/z", raw("z", {updatedAt: later(9)}));
  await event(db, "a", null, raw("a"));
  await save(db, "user-1", {overallImpression: 10}, base);
  const after = aggregate(db).overallBiteScore;
  await event(db, "a", null, raw("a"));
  assert.equal(aggregate(db).overallBiteScore, after);
});

test("default off and required post-wipe initialization never backfill old fake data", async () => {
  const db = database();
  db.documents.delete(biteScoreReviewAggregationRuntimePath);
  await assert.rejects(save(db, "user-1"), {code: "failed-precondition"});
  db.set("dish_reviews/old", raw("old"));
  await event(db, "old", null, raw("old"));
  assert.equal(aggregate(db), undefined);
  db.set(biteScoreReviewAggregationRuntimePath, {enabled: true, version: 1, epoch: "new-content"});
  db.set("dish_rating_aggregates/dish-1", {ratingCount: 4});
  await assert.rejects(save(db, "user-1"), {code: "failed-precondition"});
});

test("trusted review rejects an account switch before accessing either account's data", async () => {
  let transactions = 0;
  const db = {runTransaction: async () => { transactions++; throw Error("must not access database"); }};
  await assert.rejects(saveCustomerBiteScoreReview(db, {uid: "user-b", emailVerified: true},
    input({expectedUserId: "user-a"}), base), {code: "permission-denied"});
  assert.equal(transactions, 0);
});

test("save enforces auth, exact identity, visibility, inputs, and all operation locks", async () => {
  const db = database();
  await assert.rejects(saveCustomerBiteScoreReview(db, {uid: "u", emailVerified: false}, input(), base), {code: "permission-denied"});
  for (const value of [{dishId: " dish-1"}, {restaurantId: "restaurant-1 "}, {ratingCount: 99}, {qualityScore: 11}, {valueScore: NaN}]) {
    await assert.rejects(save(db, "u", value), {code: "invalid-argument"});
  }
  for (const [path, data] of [
    ["private_rating_dish_operation_locks/dish-1", {active: true}],
    ["private_rating_restaurant_operation_locks/restaurant-1", {active: true}],
    ["private_dish_merge_review_locks/dish-1", {blocksClientReviews: true}],
    ["private_review_milestone_reconciliation_locks/u", {state: "active"}],
  ]) {
    db.set(path, data);
    await assert.rejects(save(db, "u"), {code: "unavailable"});
    db.documents.delete(path);
  }
  db.set("bitescore_dishes/dish-1", {id: "dish-1", restaurantId: "restaurant-1", isActive: false});
  await assert.rejects(save(db, "u"), {code: "failed-precondition"});
});

test("bounded generation rebase preserves destructive aggregate until full scan and cleanup complete", async () => {
  const db = database();
  await Promise.all(Array.from({length: 61}, (_, i) => save(db, `u${i}`)));
  const before = {...aggregate(db)};
  // Simulate trusted merge changing generation and moving source reviews.
  db.set("bitescore_dishes/dish-1", {...db.get("bitescore_dishes/dish-1"), aggregateWriteGeneration: 2});
  db.set("dish_reviews/merge-duplicate", raw("merge-duplicate", {userId: "u0", overallBiteScore: 100, updatedAt: later(5)}));
  db.set("dish_reviews/merge-new", raw("merge-new", {userId: "incoming", overallBiteScore: 90, updatedAt: later(5)}));
  await reconcileBiteScoreReviewAggregateDish(db, "dish-1", later(6));
  await assert.rejects(save(db, "u0"), {code: "unavailable"});
  await continueBiteScoreReviewAggregateRebuild(db, "dish-1", later(7));
  assert.deepEqual(aggregate(db), before, "never publish a first-batch aggregate");
  let steps = 1;
  while (db.get(biteScoreReviewAggregateStatePath("dish-1")).status !== "ready") {
    await continueBiteScoreReviewAggregates(db, later(7 + steps++));
    assert.ok(steps < 20);
  }
  assert.ok(steps >= 4);
  assert.equal(aggregate(db).ratingCount, 62);
  close(aggregate(db).overallBiteScore, (60 * computeTrustedBiteScore(input()) + 100 + 90) / 62);
  assert.equal(aggregate(db).aggregateWriteGeneration, 2);
  await save(db, "u0", {overallImpression: 7}, later(40));
  assert.equal(aggregate(db).ratingCount, 62);
});

test("rebuild restarts on intervening review events and waits for active merge locks", async () => {
  const db = database();
  await Promise.all(Array.from({length: 30}, (_, i) => save(db, `u${i}`)));
  const statePath = biteScoreReviewAggregateStatePath("dish-1");
  db.set("bitescore_dishes/dish-1", {...db.get("bitescore_dishes/dish-1"), aggregateWriteGeneration: 3});
  await reconcileBiteScoreReviewAggregateDish(db, "dish-1", later(1));
  db.set("private_dish_merge_review_locks/dish-1", {blocksClientAggregates: true});
  await continueBiteScoreReviewAggregateRebuild(db, "dish-1", later(2));
  assert.equal(db.get(statePath).cursor, null);
  db.documents.delete("private_dish_merge_review_locks/dish-1");
  await continueBiteScoreReviewAggregateRebuild(db, "dish-1", later(3));
  const serial = db.get(statePath).serial;
  const path = [...db.documents.keys()].find((p) => p.startsWith("dish_reviews/"));
  const old = db.get(path);
  db.documents.delete(path);
  await event(db, path.split("/")[1], old, null, later(4));
  assert.ok(db.get(statePath).serial > serial);
  for (let i = 0; db.get(statePath).status !== "ready"; i++) {
    assert.ok(i < 20);
    await continueBiteScoreReviewAggregateRebuild(db, "dish-1", later(5 + i));
  }
  assert.equal(aggregate(db).ratingCount, 29);
  const contributions = [...db.documents.entries()].filter(([p]) => p.startsWith(statePath + "/contributions/"));
  assert.equal(contributions.length, 29, "obsolete generation records are cleaned in bounded pages");
});

test("shared new-data identity fixtures bind review IDs to dish creation provenance", async () => {
  const {customerBiteScoreReviewDocumentId} = require("../lib/bitescore_review_aggregate.js");
  const fixtures = require("../../test/fixtures/bitescore_trusted_review_identity_v1.json");
  for (const fixture of fixtures) {
    assert.equal(customerBiteScoreReviewDocumentId(fixture.dishId, fixture.userId), fixture.reviewId);
    const db = database();
    db.set(`bitescore_dishes/${fixture.dishId}`, {
      id: fixture.dishId, restaurantId: "restaurant-1", isActive: true,
      createdByUserId: fixture.userId, createdFromReviewId: fixture.reviewId,
      createdWithRestaurantId: "restaurant-1", createdFromCreateFlow: true,
    });
    const response = await save(db, fixture.userId, {dishId: fixture.dishId});
    assert.equal(response.review.id, db.get(`bitescore_dishes/${fixture.dishId}`).createdFromReviewId);
    assert.equal(response.review.dishId, fixture.dishId);
  }
});

test("previously unrated new merge target initializes accounting from bounded operation rebase", async () => {
  const db = database();
  db.set("bitescore_dishes/dish-1", {...db.get("bitescore_dishes/dish-1"), aggregateWriteGeneration: 2});
  db.set("dish_rating_aggregates/dish-1", {ratingCount: 1, overallBiteScore: 78, aggregateWriteGeneration: 2});
  db.set("dish_reviews/moved", raw("moved"));
  await reconcileBiteScoreReviewAggregateDish(db, "dish-1", later(1));
  assert.equal(db.get(biteScoreReviewAggregateStatePath("dish-1")).status, "rebuilding");
  await continueBiteScoreReviewAggregates(db, later(2));
  await continueBiteScoreReviewAggregates(db, later(3));
  assert.equal(aggregate(db).ratingCount, 1);
  await save(db, "user-2", {}, later(4));
  assert.equal(aggregate(db).ratingCount, 2);
});

test("dish deletion retires and boundedly cleans its private accounting without recreating scores", async () => {
  const db = database();
  await Promise.all(Array.from({length: 30}, (_, i) => save(db, `u${i}`)));
  db.documents.delete("bitescore_dishes/dish-1");
  db.documents.delete("dish_rating_aggregates/dish-1");
  await reconcileBiteScoreReviewAggregateDish(db, "dish-1", later(1));
  const path = biteScoreReviewAggregateStatePath("dish-1");
  assert.equal(db.get(path).status, "retired");
  await continueBiteScoreReviewAggregates(db, later(2));
  assert.ok(db.get(path));
  await continueBiteScoreReviewAggregates(db, later(3));
  assert.equal(db.get(path), undefined);
  assert.equal(aggregate(db), undefined);
  assert.equal([...db.documents.keys()].filter((p) => p.startsWith(path)).length, 0);
});

test("logical review tie-break preserves Dart UTF-16 ordering rather than UTF-8 document order", async () => {
  const db = database();
  // UTF-8 orders the supplementary character last; Dart UTF-16 orders U+E000 last.
  const a = "review-\u{1f355}", z = "review-\ue000";
  db.set(`dish_reviews/${a}`, raw(a, {overallBiteScore: 10}));
  db.set(`dish_reviews/${z}`, raw(z, {overallBiteScore: 90}));
  await event(db, a, null, raw(a));
  assert.equal(aggregate(db).overallBiteScore, 90);
  const result = await save(db, "user-1", {}, later(2));
  assert.equal(result.review.id, z);
  assert.equal(Object.hasOwn(result.review, "aggregateReviewOrder0"), false);
});

const {customerBiteScoreTerms, approvedBiteScoreTerms, biteScoreTermsRuntimePath} = require('../lib/bitescore_terms.js');
const approvedTermsFixture = {version: 'SIMULATED-APPROVED-v1', text: 'Simulated approved Terms for tests only.'};
const activateTerms = (db, policy = approvedTermsFixture) => db.set(biteScoreTermsRuntimePath, {schemaVersion: 1, required: true, version: policy.version, acceptedVersions: [policy.version, ...(policy.acceptedPriorVersions ?? [])]});
const termsActor = {uid: 'user-1', emailVerified: true, anonymous: false};
const acceptTerms = (db, overrides = {}, actor = termsActor, policy = approvedTermsFixture, now = base) =>
  customerBiteScoreTerms(db, actor, {expectedUserId: 'user-1', version: policy?.version, ...overrides}, true, now, policy);
const saveWithTerms = (db, overrides = {}, policy = approvedTermsFixture) =>
  saveCustomerBiteScoreReview(db, termsActor, input(overrides), later(1), policy);

test('unpublished default is dormant, saves unchanged, and never issues a draft receipt', async () => {
  assert.equal(approvedBiteScoreTerms, null);
  const db = database();
  assert.deepEqual(await customerBiteScoreTerms(db, termsActor, {expectedUserId: 'user-1'}, false, base),
    {schemaVersion: 1, userId: 'user-1', enabled: false});
  await assert.rejects(customerBiteScoreTerms(db, termsActor, {expectedUserId: 'user-1', version: 'draft'}, true, base),
    {code: 'failed-precondition'});
  assert.equal(db.get('user_profiles/user-1'), undefined);
  await save(db, 'user-1');
  assert.equal(aggregate(db).ratingCount, 1);
  assert.ok(!db.reads.includes('user_profiles/user-1'));
});

test('active trusted write denies missing, obsolete, cross-user and client-asserted receipts atomically', async () => {
  const db = database();
  activateTerms(db);
  for (const receipt of [undefined, {version: 'old', acceptedAt: base}, {version: approvedTermsFixture.version}]) {
    db.set('user_profiles/user-1', {termsAcceptance: receipt});
    await assert.rejects(saveWithTerms(db), {code: 'failed-precondition'});
    await assert.rejects(saveWithTerms(db, {accepted: true, termsAcceptance: {version: approvedTermsFixture.version}}),
      {code: 'invalid-argument'});
    assert.equal(aggregate(db), undefined);
    assert.ok(![...db.documents.keys()].some(p => p.startsWith('dish_reviews/')));
  }
  await acceptTerms(db, {expectedUserId: 'user-2'}, {...termsActor, uid: 'user-2'});
  await assert.rejects(saveWithTerms(db), {code: 'failed-precondition'});
});

test('acceptance is UID-bound, minimal, idempotent and preserves private profile fields', async () => {
  const db = database();
  activateTerms(db);
  db.set('user_profiles/user-1', {userId: 'user-1', displayName: 'Existing', points: 7});
  await acceptTerms(db, {acceptedAt: 'client time', uid: 'victim', accepted: true});
  await acceptTerms(db, {}, termsActor, approvedTermsFixture, later(100));
  assert.deepEqual(db.get('user_profiles/user-1'), {userId: 'user-1', displayName: 'Existing', points: 7,
    termsAcceptance: {version: approvedTermsFixture.version, acceptedAt: base}});
  assert.equal(db.get('user_profiles/victim'), undefined);
  const first = await saveWithTerms(db);
  const edited = await saveWithTerms(db, {overallImpression: 10});
  assert.equal(first.review.id, edited.review.id);
  assert.equal(first.review.createdAtMillis, edited.review.createdAtMillis);
  assert.equal(aggregate(db).ratingCount, 1);
  close(edited.review.overallBiteScore, computeTrustedBiteScore(input({overallImpression: 10})));
  const next = {...approvedTermsFixture, version: 'SIMULATED-APPROVED-v2'};
  activateTerms(db, next);
  await assert.rejects(saveWithTerms(db, {}, next), {code: 'failed-precondition'});
  await assert.rejects(acceptTerms(db, {version: approvedTermsFixture.version}, termsActor, next), {code: 'failed-precondition'});
  await acceptTerms(db, {}, termsActor, next);
  await saveWithTerms(db, {}, next);
});

test('guest, unverified, signed-out, account-switched and deleting identities cannot accept', async () => {
  const db = database();
  activateTerms(db);
  for (const actor of [{uid: '', emailVerified: false}, {...termsActor, anonymous: true},
    {...termsActor, emailVerified: false}, {...termsActor, uid: 'user-2'}]) {
    await assert.rejects(acceptTerms(db, {}, actor), {code: 'permission-denied'});
  }
  db.set('private_account_deletions/user-1', {});
  await assert.rejects(acceptTerms(db), {code: 'failed-precondition'});
  await assert.rejects(saveWithTerms(db), {code: 'failed-precondition'});
  assert.equal(db.get('user_profiles/user-1'), undefined);
});

test('existing Rules exclude receipt field from client mutations and existing deletion removes profile root', () => {
  const fs = require('node:fs');
  const rules = fs.readFileSync('../firestore.rules', 'utf8');
  const fields = rules.slice(rules.indexOf('function profileWritableFields()'), rules.indexOf('function userOwnedCreate'));
  assert.ok(!fields.includes('termsAcceptance'));
  assert.match(fields, /keys\(\)\.hasOnly\(profileWritableFields\(\)\)/);
  assert.match(fields, /changedKeys\(\)\.hasOnly\(profileWritableFields\(\)\)/);
  assert.match(rules, /allow read: if isAdmin\(\) \|\| isSelf\(userId\)/);
  const cleanup = fs.readFileSync('src/account_deletion_cleanup.ts', 'utf8');
  assert.match(cleanup, /function personalRootPaths[\s\S]*?`user_profiles\/\$\{uid\}`/);
});

test('posting-only restriction rejects trusted rating/review edits before any writes and automatically expires', async()=>{
 const db=new MemoryDatabase();const uid='restricted';
 const input={schemaVersion:1,expectedUserId:uid,dishId:'dish',restaurantId:'restaurant',headline:'damn good',notes:'draft stays client-side',overallImpression:8,tastinessScore:8,qualityScore:8,valueScore:8};
 db.set(biteScoreReviewAggregationRuntimePath,{enabled:true,version:1,epoch:'posting-test'});
 db.set('bitescore_dishes/dish',{id:'dish',restaurantId:'restaurant',isActive:true});
 db.set('bitescore_restaurants/restaurant',{id:'restaurant',isActive:true});
 const result=await saveCustomerBiteScoreReview(db,{uid,emailVerified:true},input,base);
 const before=[...db.documents];
 const p=`user_profiles/${uid}/posting_restriction_state/current`;
 db.set(p,{schemaVersion:1,revision:1,kind:'7d',startsAt:base,endsAt:later(7*86400),releasedAt:null});
 await assert.rejects(saveCustomerBiteScoreReview(db,{uid,emailVerified:true},{...input,notes:'edited'},later(1)),e=>e.details?.reason==='posting-restricted');
 for(const [path,data] of before)assert.deepEqual(db.get(path),data);
 const updated=await saveCustomerBiteScoreReview(db,{uid,emailVerified:true},{...input,notes:'edited'},later(7*86400));
 assert.equal(updated.review.id,result.review.id);assert.equal(updated.review.notes,'edited');assert.equal(db.get('dish_rating_aggregates/dish').ratingCount,1);
});

test('mandatory runtime with no approved text, stale Function version or malformed metadata fails closed', async () => {
  const db = database(); activateTerms(db);
  await assert.rejects(saveWithTerms(db, {}, null), {code:'failed-precondition'});
  await assert.rejects(customerBiteScoreTerms(db, termsActor, {expectedUserId:'user-1'}, false, base, null), {code:'failed-precondition'});
  await acceptTerms(db);
  activateTerms(db, {...approvedTermsFixture, version:'SIMULATED-APPROVED-v2'});
  await assert.rejects(saveWithTerms(db), {code:'failed-precondition'});
  for (const config of [{}, {required:true}, {required:'yes'}, {schemaVersion:1,required:true,version:approvedTermsFixture.version,acceptedVersions:['unapproved']}]) {
    db.set(biteScoreTermsRuntimePath, config);
    await assert.rejects(saveWithTerms(db), {code:'failed-precondition'});
  }
  db.set(biteScoreTermsRuntimePath, {required:false});
  await saveWithTerms(db); // An approved future source release alone never activates.
});
test('an explicitly compatible revision honors original receipt without rewriting its date or version', async () => {
  const db=database();activateTerms(db);await acceptTerms(db);
  const original=structuredClone(db.get('user_profiles/user-1'));
  const compatible={...approvedTermsFixture,version:'SIMULATED-APPROVED-v2',acceptedPriorVersions:[approvedTermsFixture.version]};
  activateTerms(db,compatible);
  const status=await customerBiteScoreTerms(db,termsActor,{expectedUserId:'user-1'},false,later(1),compatible);
  assert.equal(status.accepted,true);assert.equal(status.version,compatible.version);
  await saveWithTerms(db,{},compatible);assert.deepEqual(db.get('user_profiles/user-1'),original);
});
test('malformed/future receipt time and anonymous trusted review actor cannot publish', async () => {
  const db=database();activateTerms(db);
  for (const acceptedAt of [new Date(NaN),new Date('2099-01-01'),{toDate:true},'2026-01-01']) {
    db.set('user_profiles/user-1',{termsAcceptance:{version:approvedTermsFixture.version,acceptedAt}});
    await assert.rejects(saveWithTerms(db),{code:'failed-precondition'});
  }
  await acceptTerms(db);
  await assert.rejects(saveCustomerBiteScoreReview(db,{...termsActor,anonymous:true},input(),later(1),approvedTermsFixture),{code:'permission-denied'});
});
