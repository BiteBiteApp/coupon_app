'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const enabled = process.env.RUN_WEB_RELEASE_ADMIN_EMULATOR === '1';
const local = (name, fn) => test(name, {skip: !enabled}, fn);
let db, app, api, auth;
const admin = {uid: 'admin', token: {admin: true}};
const customer = {uid: 'customer', token: {}};
const names = [
  'listRatingAdminDishSuggestionsPage', 'applyRatingAdminDishSuggestionGroup',
  'rejectRatingAdminDishSuggestionGroup', 'approveRestaurantNameChange',
  'getAdminPostingRestriction', 'setAdminPostingRestriction',
  'listCouponAdminCouponsPage',
];

test.before(() => {
  if (!enabled) return;
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8792');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-coupon-app-rules');
  assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  api = require('../lib/index');
  app = require('firebase-admin/app').getApp();
  db = require('firebase-admin/firestore').getFirestore(app);
  auth = require('firebase-admin/auth').getAuth(app);
});
test.beforeEach(async () => {
  if (!enabled) return;
  const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-coupon-app-rules/databases/(default)/documents`, {method: 'DELETE'});
  assert.equal(cleared.status, 200);
  await db.doc('restaurant_accounts/owner').set({uid: 'owner', restaurantName: 'Old Cafe', subscriptionStatus: 'active', canary: 'preserve'});
  await db.doc('restaurant_name_change_requests/request').set({userId: 'owner', requestedRestaurantName: ' New Cafe ', status: 'pending'});
});
test.after(async () => { if (app) await app.delete(); });

local('all seven exact wrappers deny unsigned, customer, owner and forged body authority using verified Auth-emulator tokens', async () => {
  const actors = [];
  for (const uid of ['customer', 'owner']) {
    try { await auth.deleteUser(uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    await auth.createUser({uid, email: `${uid}@example.test`, emailVerified: true, password: 'Local-fixture-12345'});
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-fixture`, {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: `${uid}@example.test`, password: 'Local-fixture-12345', returnSecureToken: true}),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    const token = await auth.verifyIdToken(body.idToken);
    actors.push({uid: token.uid, token});
  }
  for (const name of names) {
    assert.equal(typeof api[name]?.run, 'function', name);
    const data = name.includes('PostingRestriction')
      ? {schemaVersion: 1, expectedUserId: 'customer', reportId: null, targetUserId: 'owner',
        ...(name.startsWith('set') ? {action: 'release', expectedRevision: 0, requestId: 'release-fixture-request'} : {})}
      : {};
    const missingAuthCode = name.includes('DishSuggestion') || name === 'listCouponAdminCouponsPage' ? 'permission-denied' : 'unauthenticated';
    await assert.rejects(api[name].run({data}), {code: missingAuthCode}, name);
    for (const actor of actors) {
      await assert.rejects(api[name].run({auth: actor, data: {...data, ...(name.includes('PostingRestriction') ? {expectedUserId: actor.uid} : {})}}), {code: 'permission-denied'}, `${name}/${actor.uid}`);
      const forgedData = name.includes('PostingRestriction') ? {...data, expectedUserId: 'admin'} : {...data, admin: true, uid: 'admin', email: 'schuyler.cole@gmail.com'};
      await assert.rejects(api[name].run({auth: actor, data: forgedData}), {code: 'permission-denied'}, `${name}/forged-${actor.uid}`);
    }
  }
  assert.equal((await db.doc('restaurant_accounts/owner').get()).get('restaurantName'), 'Old Cafe');
  assert.equal((await db.doc('restaurant_name_change_requests/request').get()).get('status'), 'pending');
});
local('name approval uses stored request identity and name; retry is idempotent and unrelated fields survive', async () => {
  const request = {auth: admin, data: {requestId: 'request'}};
  assert.deepEqual(await api.approveRestaurantNameChange.run(request), {approved: true});
  const before = (await db.doc('restaurant_accounts/owner').get()).data();
  assert.equal(before.restaurantName, 'New Cafe');
  assert.equal(before.subscriptionStatus, 'active');
  assert.equal(before.canary, 'preserve');
  assert.equal((await db.doc('restaurant_name_change_requests/request').get()).get('status'), 'approved');
  await api.approveRestaurantNameChange.run(request);
  assert.deepEqual((await db.doc('restaurant_accounts/owner').get()).data(), before);
  await assert.rejects(api.approveRestaurantNameChange.run({auth: admin, data: {requestId: 'request', uid: 'other'}}), {code: 'invalid-argument'});
});
local('name approval rejects deletion-marked actor or target and changed owner identity', async () => {
  const request = {auth: admin, data: {requestId: 'request'}};
  for (const uid of ['admin', 'owner']) {
    await db.doc(`private_account_deletions/${uid}`).set({state: 'complete'});
    await assert.rejects(api.approveRestaurantNameChange.run(request), {code: 'failed-precondition'});
    assert.equal((await db.doc('restaurant_accounts/owner').get()).get('restaurantName'), 'Old Cafe');
    await db.doc(`private_account_deletions/${uid}`).delete();
  }
  await db.doc('restaurant_accounts/owner').update({uid: 'other'});
  await assert.rejects(api.approveRestaurantNameChange.run(request), {code: 'failed-precondition'});
});
