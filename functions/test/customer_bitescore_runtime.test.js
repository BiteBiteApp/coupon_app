"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {customerBiteScoreActorBinding} = require("../lib/customer_bitescore_runtime.js");

test("authenticated admission stays bound to one user across client instances; guest and user scopes remain separate", () => {
  const key = Buffer.alloc(32, 41);
  const first = customerBiteScoreActorBinding(key, "user-a", "instance-a");
  assert.equal(first, customerBiteScoreActorBinding(key, "user-a", "instance-b"));
  assert.notEqual(first, customerBiteScoreActorBinding(key, "user-b", "instance-a"));
  assert.notEqual(first, customerBiteScoreActorBinding(key, null, "user-a"));
  assert.notEqual(customerBiteScoreActorBinding(key, null, "instance-a"), customerBiteScoreActorBinding(key, null, "instance-b"));
});

test('Terms callables use verified Firebase actor, never spoofed payload identity or draft receipts', async () => {
  const {initializeApp, deleteApp} = require('firebase-admin/app');
  const app = initializeApp({projectId: 'demo-terms-local-test'});
  const api = require('../lib/customer_bitescore_runtime.js');
  const metadata = require('./fixtures/customer_bitescore_runtime_metadata.json');
  try {
    for (const name of ['getCustomerBiteScoreTerms', 'acceptCustomerBiteScoreTerms']) {
      assert.deepEqual(JSON.parse(JSON.stringify(api[name].__endpoint)), metadata[name]);
      for (const auth of [undefined,
        {uid: 'A', token: {email_verified: false}},
        {uid: 'A', token: {email_verified: true, firebase: {sign_in_provider: 'anonymous'}}},
        {uid: 'B', token: {email_verified: true}}]) {
        await assert.rejects(api[name].run({auth, data: {expectedUserId: 'A', uid: 'A', emailVerified: true}}),
          {code: 'permission-denied'});
      }
    }
    const auth = {uid: 'A', token: {email_verified: true, firebase: {sign_in_provider: 'password'}}};
    assert.deepEqual(await api.getCustomerBiteScoreTerms.run({auth, data: {expectedUserId: 'A'}}),
      {schemaVersion: 1, enabled: false, userId: 'A'});
    await assert.rejects(api.acceptCustomerBiteScoreTerms.run({auth, data: {expectedUserId: 'A', version: 'draft'}}),
      {code: 'failed-precondition'});
  } finally { await deleteApp(app); }
});
