"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {Timestamp} = require("firebase-admin/firestore");
const {createHash} = require("node:crypto");
const {getCustomerBiteScoreProfileSummaryHandler, customerBiteScoreProfileBadge,
  customerBiteScoreFallbackUsername} = require("../lib/customer_bitescore_profile_summary.js");
function fakeDb(userId) {
  const documents = new Map([
    [`public_reviewer_profiles/${userId}`, {chosenUsername: "pizzaFan", fallbackUsername: "anon111", createdAt: new Date("2026-01-01"), email: "NEVER"}],
    [`private_bitescore_reviewer_stats/${createHash("sha256").update(userId).digest("hex")}`, {publicReviewCount: 50, publicHelpfulVotesReceived: 100}],
    [`user_profiles/${userId}`, {contributionPoints: 99, email: "NEVER", stripeCustomerId: "NEVER", authUid: "NEVER"}],
  ]);
  documents.set(`user_profiles/${userId}/local_expert_badges/burger`, {
    expertTypeId: "burger", displayName: "Burger", level: "level1", totalRestaurantCount: 5,
    localClusterRestaurantCount: 4, qualificationMethod: "localCluster", earnedAt: new Date("2026-01-01"),
    email: "NEVER", internalAdminNote: "NEVER",
  });
  const limits = [], reads = [];
  const query = {where() {return this;}, orderBy() {return this;}, limit(n) {limits.push(n); return this;},
    async get() {return {docs: [{data: () => ({createdAtMs: Date.parse("2025-01-01")})}]};}};
  return {documents, limits, reads, getAll(...refs) {assert.ok([1, 3, 4, 23].includes(refs.length)); return Promise.all(refs.map(ref => ref.get()));}, doc(path) {return {async get() {reads.push(path); const value = documents.get(path); return {exists: value !== undefined, data: () => value};}};}, collection() {return query;}};
}
test("public profile header preserves totals/badge and never returns private fields", async () => {
  const db = fakeDb("user-1");
  const response = await getCustomerBiteScoreProfileSummaryHandler(db, {userId: "user-1"}, {userId: "viewer"}, {
    now: new Date("2026-09-19"), ownAccountCreatedAt: async () => {throw Error("public reads must not read Auth");},
  });
  assert.equal(response.publicDisplayName, "pizzaFan");
  assert.equal(response.reviewCount, 50);
  assert.equal(response.helpfulVotesReceived, 100);
  assert.equal(response.badgeLabel, "Top Contributor");
  assert.equal(response.contributionPoints, 99);
  assert.equal(response.badges.length, 1);
  assert.equal(response.badges[0].expertTypeId, "burger");
  assert.equal(response.badges[0].earnedAtMs, Date.parse("2026-01-01"));
  assert.equal(response.accountAgeDays, 626);
  assert.deepEqual(db.limits, [1]);
  assert.equal(JSON.stringify(response).includes("NEVER"), false);
});
test("own profile age comes from trusted Auth metadata without returning it", async () => {
  const db = fakeDb("user-1");
  const response = await getCustomerBiteScoreProfileSummaryHandler(db, {userId: "user-1"}, {userId: "user-1"}, {
    now: new Date("2026-09-19"), ownAccountCreatedAt: async (uid) => {
      assert.equal(uid, "user-1"); return Date.parse("2026-09-18");
    },
  });
  assert.equal(response.accountAgeDays, 1);
  assert.equal(response.badgeLabel, "Active Reviewer");
  assert.equal(Object.hasOwn(response, "createdAt"), false);
});
test("established badge thresholds and fallback username remain deterministic", () => {
  assert.equal(customerBiteScoreProfileBadge({reviewCount: 0, helpfulVotesReceived: 0, accountAgeDays: 999}), "New Reviewer");
  assert.equal(customerBiteScoreProfileBadge({reviewCount: 5, helpfulVotesReceived: 0, accountAgeDays: 0}), "Active Reviewer");
  assert.equal(customerBiteScoreProfileBadge({reviewCount: 15, helpfulVotesReceived: 25, accountAgeDays: 30}), "Trusted Reviewer");
  assert.equal(customerBiteScoreProfileBadge({reviewCount: 50, helpfulVotesReceived: 100, accountAgeDays: 90}), "Top Contributor");
  assert.equal(customerBiteScoreFallbackUsername("user-1"), "anon151824");
});

const preferences = uid => `user_profiles/${uid}/reviewer_safety_state/preferences`;
const block = (uid, target) => `user_profiles/${uid}/blocked_reviewers/${target}`;
function setBlock(db, viewer, target, revision, blocked) {
  db.documents.set(preferences(viewer), {schemaVersion: 1, revision, updatedAt: Timestamp.now()});
  if (blocked) db.documents.set(block(viewer, target), {schemaVersion: 1, targetUserId: target, createdAt: Timestamp.now()});
  else db.documents.delete(block(viewer, target));
}
const summary = (db, viewer = 'viewer', extra = {}) => getCustomerBiteScoreProfileSummaryHandler(db,
  {userId: 'target', ...extra}, {userId: viewer}, {ownAccountCreatedAt: async () => Date.parse('2026-01-01')});

test('blocked summary fails neutrally before any username, badge, contribution or review read', async () => {
  const db = fakeDb('target'); setBlock(db, 'viewer', 'target', 1, true);
  await assert.rejects(summary(db), {code: 'not-found', message: 'This reviewer is unavailable.'});
  assert.deepEqual(db.limits, []);
  assert.deepEqual(db.reads.sort(), [preferences('viewer'), block('viewer', 'target'), 'private_account_deletions/target', 'private_account_deletions/viewer'].sort());
});

test('guest, other-viewer and own summaries preserve public behavior without using a supplied viewer identity', async () => {
  const db = fakeDb('target'); setBlock(db, 'viewer', 'target', 1, true);
  const before = require('node:v8').serialize([...db.documents]);
  for (const viewer of [null, undefined, 'anonymous-guest', 'other', 'target']) {
    // Pass context directly so undefined really represents signed-out viewing.
    const result = await getCustomerBiteScoreProfileSummaryHandler(db, {userId: 'target', viewerId: 'viewer', expectedUserId: 'viewer'},
      {userId: viewer}, {ownAccountCreatedAt: async uid => {assert.equal(uid, 'target'); return Date.parse('2026-01-01');}});
    assert.equal(result.publicDisplayName, 'pizzaFan'); assert.equal(result.reviewCount, 50);
    assert.equal(result.contributionPoints, 99); assert.equal(result.badges.length, 1);
    assert.equal(JSON.stringify(result).includes('NEVER'), false);
    assert.equal(Object.hasOwn(result, 'blocked'), false);
  }
  assert.ok(!db.reads.includes(preferences('viewer')));
  assert.deepEqual(require('node:v8').serialize([...db.documents]), before);
});

test('summary rechecks blocking and revision after in-flight public reads', async () => {
  for (const change of ['block', 'block-unblock', 'remove', 'malformed']) {
    const db = fakeDb('target'); setBlock(db, 'viewer', 'target', 1, false);
    const original = db.getAll.bind(db); let changed = false;
    db.getAll = async (...refs) => {
      const result = await original(...refs);
      if (refs.length === 23 && !changed) {
        changed = true;
        if (change === 'remove') db.documents.delete(preferences('viewer'));
        else if (change === 'malformed') db.documents.set(preferences('viewer'), {});
        else setBlock(db, 'viewer', 'target', 2, change === 'block');
      }
      return result;
    };
    await assert.rejects(summary(db), e => ['not-found', 'failed-precondition'].includes(e.code));
    assert.equal(changed, true);
  }
});

test('summary rejects malformed preferences, inconsistent blocks and either deletion fence', async () => {
  const db = fakeDb('target');
  for (const revision of [undefined, -1, 0.5, '1', Number.MAX_SAFE_INTEGER, NaN]) {
    db.documents.set(preferences('viewer'), {schemaVersion: 1, revision, updatedAt: Timestamp.now()});
    await assert.rejects(summary(db), {code: 'failed-precondition'});
  }
  for (const change of [record => record.targetUserId = 'forged', record => record.schemaVersion = 2, record => record.createdAt = 'forged']) {
    setBlock(db, 'viewer', 'target', 1, true); change(db.documents.get(block('viewer', 'target')));
    await assert.rejects(summary(db), {code: 'failed-precondition'});
  }
  setBlock(db, 'viewer', 'target', 1, true); db.documents.delete(preferences('viewer'));
  await assert.rejects(summary(db), {code: 'failed-precondition'});
  setBlock(db, 'viewer', 'target', 2, false);
  for (const uid of ['viewer', 'target']) {
    db.documents.set(`private_account_deletions/${uid}`, {});
    await assert.rejects(summary(db), {code: 'failed-precondition'});
    db.documents.delete(`private_account_deletions/${uid}`);
  }
});

test('summary uses only fixed exact visibility reads before and after content', async () => {
  for (const viewer of [null, 'viewer', 'target']) {
    const db = fakeDb('target'); await summary(db, viewer);
    const privateSafety = db.reads.filter(p => p.includes('/reviewer_safety_state/') || p.includes('/blocked_reviewers/'));
    assert.equal(privateSafety.length, viewer === null ? 0 : 4);
    assert.equal(db.reads.filter(p => p.startsWith('private_account_deletions/')).length, viewer === 'viewer' ? 4 : 2);
    assert.deepEqual(db.limits, [1]);
  }
});

test('all four real runtime wrappers derive viewer identity from Firebase auth and keep target data separate', async () => {
  const Module = require('node:module'), originalLoad = Module._load;
  const actualFirestore = require('firebase-admin/firestore');
  const actualParams = require('firebase-functions/params');
  const observed = [];
  const handler = async (_db, raw, context) => { observed.push({raw, context}); return {}; };
  Module._load = function(name, parent, isMain) {
    if (name === 'firebase-admin/firestore') return {...actualFirestore, getFirestore: () => ({})};
    if (name === 'firebase-functions/params') return {...actualParams, defineSecret: name => ({name, value: () => Buffer.alloc(32, 7).toString('base64url')})};
    if (name === './customer_bitescore_profile_summary.js') return {getCustomerBiteScoreProfileSummaryHandler: handler};
    if (name === './customer_bitescore_profile_search.js') return {
      startCustomerBiteScoreProfileListHandler: handler, advanceCustomerBiteScoreProfileListHandler: handler,
      getCustomerBiteScoreProfileListPageHandler: handler,
    };
    return originalLoad.call(this, name, parent, isMain);
  };
  let runtime;
  try { runtime = require('../lib/customer_bitescore_runtime.js'); } finally { Module._load = originalLoad; }
  for (const endpoint of ['getCustomerBiteScoreProfileSummary', 'startCustomerBiteScoreProfileList', 'advanceCustomerBiteScoreProfileList', 'getCustomerBiteScoreProfileListPage']) {
    const actors = [];
    for (const uid of ['viewer', 'other', 'anonymous-guest', null]) {
      const auth = uid === null ? undefined : {uid, token: {firebase: {sign_in_provider: uid === 'anonymous-guest' ? 'anonymous' : 'password'}}};
      await runtime[endpoint].run({auth, data: {clientInstanceId: 'synthetic_instance_123', userId: 'target', viewerId: 'forged', criteria: {kind: 'reviews', userId: 'target'}}});
      const call = observed.pop();
      assert.equal(call.context.userId, uid);
      assert.equal(call.raw.userId, 'target'); assert.equal(call.raw.criteria.userId, 'target');
      actors.push(call.context.actorId);
    }
    assert.equal(new Set(actors).size, 4);
  }
});
