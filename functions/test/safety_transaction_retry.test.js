'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const photo = require('../lib/photo_screening');
const owner = require('../lib/owner_photo_screening');
const text = require('../lib/review_text_moderation');
const {saveCustomerBiteScoreReview} = require('../lib/bitescore_review_aggregate');
const {createFirestoreRatingDestructivePrivateDatabase} = require('../lib/rating_destructive_job_store');
const enabled = process.env.RUN_SAFETY_TRANSACTION_EMULATOR === '1';
const local = (name, fn) => test(name, {skip: !enabled}, fn);
const project = 'demo-safety-transaction-retry';
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=', 'base64');
const clean = {adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'UNLIKELY', medical: 'VERY_LIKELY', spoof: 'VERY_LIKELY'};
let app, db, store, providerCalls, injected, surfaced, now;
const auth = {uid: 'author', token: {email_verified: true, firebase: {sign_in_provider: 'password'}}};
// The integration suite tests real Storage. This regression isolates the
// Firestore transaction boundary and proves that retry never repeats a provider.
const objects = {put: async () => '123', read: async (_path, generation, digest) => {
  assert.equal(generation, '123'); assert.equal(digest, createHash('sha256').update(bytes).digest('hex'));
  return {bytes, contentType: 'image/png'};
}, url: objectPath => `https://example.test/${objectPath}`};
const options = () => ({now: () => now.getTime(), identity: async () => 'synthetic-account-lifetime', objects,
  provider: {name: 'deterministic-transaction-test', screen: async () => {providerCalls++; return clean;}}});
const photoData = {schemaVersion: 1, expectedUserId: 'author', contentType: 'image/png', bytesBase64: bytes.toString('base64'), retry: false};
const run = lane => lane === 'customer' ? photo.submitScreenedPhotoHandler(db, {auth, data: {...photoData,
  dishId: 'dish', restaurantId: 'restaurant', reviewId: null, mode: 'gallery'}}, options()) :
  lane === 'owner' ? owner.submitScreenedOwnerPhotoHandler(db, {auth, data: {...photoData,
    sourceType: 'biteSaver', sourceId: 'author', family: 'menu', targetId: 'page'}}, options()) :
    saveCustomerBiteScoreReview(store, {uid: 'author', emailVerified: true}, {schemaVersion: 1,
      expectedUserId: 'author', dishId: 'dish', restaurantId: 'restaurant', headline: 'Food', notes: 'Exact words',
      overallImpression: 8, tastinessScore: 7, qualityScore: 9, valueScore: 6}, now, undefined,
    {screen: async () => {providerCalls++; return {flagged: false};}}, () => now);
async function faultOnCompletion(operation, error) {
  const original = db.runTransaction;
  db.runTransaction = function (callback, ...args) {
    return original.call(this, async tx => {
      try {return await callback(new Proxy(tx, {get(target, key) {
      if (key === 'get') return async reference => {
        if (providerCalls === 1 && injected === 0 && reference.path === 'private_account_deletions/author') {
          injected++; throw error;
        }
        return target.get(reference);
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      }}));} catch (error) {surfaced.push(error); throw error;}
    }, ...args);
  };
  try {return await operation();} finally {db.runTransaction = original;}
}
test.before(async () => {
  if (!enabled) return;
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8792');
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  app = require('firebase-admin/app').initializeApp({projectId: project});
  db = require('firebase-admin/firestore').getFirestore(app);
  store = createFirestoreRatingDestructivePrivateDatabase(db);
});
test.beforeEach(async () => {
  if (!enabled) return;
  assert.equal((await fetch(`http://127.0.0.1:8792/emulator/v1/projects/${project}/databases/(default)/documents`, {method: 'DELETE'})).status, 200);
  providerCalls = 0; injected = 0; surfaced = []; now = new Date();
  for (const [p, data] of Object.entries({
    'private_bitescore_runtime/aggregation': {enabled: true, version: 1, epoch: 'transaction-retry'},
    [photo.screeningRuntimePath]: {required: true, enabled: true, ownerRequired: true, ownerEnabled: true,
      policyVersion: 'conservative-hold-v1', monthlyAllowance: 1000, retentionApproved: true, cleanupEnabled: true,
      retentionPolicyVersion: 'photo-retention-v1', failedScreeningRetentionDays: 7, failedScreeningRetentionApproved: true},
    [text.reviewTextRuntimePath]: {...text.reviewTextRuntimeCandidate, required: true, processingEnabled: true,
      retentionApproved: true, cleanupEnabled: true},
    'bitescore_dishes/dish': {id: 'dish', restaurantId: 'restaurant', isActive: true, imageCount: 0},
    'bitescore_restaurants/restaurant': {id: 'restaurant', isActive: true},
    'restaurant_accounts/author': {uid: 'author', approvalStatus: 'approved', couponPostingEnabled: true},
  })) await db.doc(p).set(data);
});
test.after(async () => {if (app) await app.delete();});

for (const lane of ['customer', 'owner', 'text']) {
  local(`${lane}: Firestore abort retries completion checks without resubmitting provider or spending admission`, async () => {
    const result = await faultOnCompletion(() => run(lane), Object.assign(new Error('Injected Firestore transaction abort'), {code: 10}));
    assert.equal(injected, 1); assert.equal(providerCalls, 1);
    assert.equal(surfaced.length, 1); assert.equal(surfaced[0].code, 10);
    assert.equal(lane === 'text' ? result.textStatus : result.state, lane === 'text' ? 'published' : lane === 'owner' ? 'available' : 'approved');
    if (lane !== 'text') {
      assert.equal((await db.doc(`private_bitescore_screening_usage/${now.toISOString().slice(0, 7)}`).get()).get('reservedUnits'), 1);
      assert.equal((await db.doc(`${photo.screeningCollection}/${result.imageId}`).get()).get('attempts'), 1);
    } else assert.equal((await db.doc('dish_rating_aggregates/dish').get()).get('ratingCount'), 1);
  });
  local(`${lane}: nonretryable completion error reaches transaction adapter without publishing unchecked content`, async () => {
    const error = Object.assign(new Error('Injected invalid transaction'), {code: 3});
    if (lane === 'text') {
      // The outer save must still report the already-committed rating honestly.
      const result = await faultOnCompletion(() => run(lane), error);
      assert.equal(result.textStatus, 'screening_failed');
      assert.equal((await db.doc('dish_rating_aggregates/dish').get()).get('ratingCount'), 1);
      assert.equal((await db.collection(text.reviewTextCollection).get()).docs[0].get('status'), 'screening');
    } else await assert.rejects(faultOnCompletion(() => run(lane), error), failure => failure === error);
    assert.deepEqual(surfaced, [error]);
    assert.equal(injected, 1); assert.equal(providerCalls, 1);
    if (lane === 'text') assert.equal((await db.collection('dish_reviews').get()).docs[0].get('notes'), null);
    else {
      assert.equal((await db.collection(photo.screeningCollection).get()).docs[0].get('state'), 'scanning');
      assert.equal((await db.collection('bitescore_dish_images').get()).size, 0);
    }
  });
}
