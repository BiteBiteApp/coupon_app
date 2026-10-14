'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {initializeTestEnvironment, assertFails} = require('@firebase/rules-unit-testing');
const {doc, updateDoc, getDoc} = require('firebase/firestore');
const functionRequire = require('node:module').createRequire(path.resolve(__dirname, '../../functions/package.json'));
const {initializeApp, deleteApp} = functionRequire('firebase-admin/app');
const {getFirestore, FieldValue} = functionRequire('firebase-admin/firestore');
const {saveBiteSaverRestaurantProfileHandler, biteSaverLocationSource, createBiteSaverLocationValidationFingerprint} = require('../../functions/lib/bitesaver_restaurant_profile.js');
const {createRestaurantAddressFingerprint} = require('../../functions/lib/restaurant_geocoding.js');
const {requireAccountWritable} = require('../../functions/lib/account_deletion_guard.js');
const {canonicalRestaurantGeohash} = require('../../functions/lib/restaurant_geo_helpers.js');
const {createFirestoreSearchIndexDatabase, handleBiteSaverRestaurantWrite, reconcileBiteSaverCouponOfferIndex} = require('../../functions/lib/search_index_maintenance.js');
const {createFirestoreCustomerBiteSaverSearchDatabase} = require('../../functions/lib/customer_bitesaver_search_store.js');
const {startCustomerBiteSaverSearchHandler, getCustomerBiteSaverSearchPageHandler, getCustomerBiteSaverOfferPageHandler} = require('../../functions/lib/customer_bitesaver_search_session.js');
const {processCustomerBiteSaverSearchJob} = require('../../functions/lib/customer_bitesaver_search_worker.js');
const {privateCustomerBiteSaverSearchSessionCollection, privateCustomerBiteSaverResultCollection, customerBiteSaverSearchSchemaVersion} = require('../../functions/lib/customer_bitesaver_search_contract.js');

const projectId = 'demo-bitestar-cuisine';
const now = new Date('2026-10-14T20:00:00Z');
const identityKeyV1 = Buffer.alloc(32, 31), discoveryKey = Buffer.alloc(32, 29);
let env, app, db, deps, indexDb, searchDb, sequence = 0, entropy = 20;
const auth = uid => ({uid, token: {email: `${uid}@example.test`, email_verified: true, firebase: {sign_in_provider: 'password'}}});
const profile = {streetAddress: '1 Public Avenue', city: 'Orlando', state: 'FL', zipCode: '32801', phone: '(407) 555-0100', website: 'https://example.test', bio: 'Neighborhood food'};
function account() {
  const coordinates = {latitude: 28.5383, longitude: -81.3792};
  const addressFingerprint = createRestaurantAddressFingerprint({streetAddress: profile.streetAddress, city: profile.city, state: profile.state, zipCode: profile.zipCode});
  return {...profile, ...coordinates, uid: 'owner', restaurantName: 'Ordinary Cafe', email: 'private-canary@example.test', privateUnknown: {preserve: true}, approvalStatus: 'approved', couponApplicationSubmitted: true, subscriptionStatus: 'active', couponPostingEnabled: true, profileVersion: 1, locationVersion: 1, formattedAddress: '1 Public Avenue, Orlando, FL 32801, USA', locationSource: biteSaverLocationSource, locationValidatedAt: now, addressFingerprint, locationValidationFingerprint: createBiteSaverLocationValidationFingerprint({...coordinates, addressFingerprint, locationSource: biteSaverLocationSource}), geohash: canonicalRestaurantGeohash(coordinates)};
}
test.before(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8792') throw Error('Exact isolated Firestore emulator required');
  env = await initializeTestEnvironment({projectId, firestore: {rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')}});
  app = initializeApp({projectId}, 'cuisine-local-test');
  db = getFirestore(app);
  indexDb = createFirestoreSearchIndexDatabase(db);
  searchDb = createFirestoreCustomerBiteSaverSearchDatabase(db);
  deps = {
    getAccount: async id => {const snapshot = await db.doc(`restaurant_accounts/${id}`).get(); return {exists: snapshot.exists, data: snapshot.data() ?? {}};},
    runAccountTransaction: (id, evaluate) => db.runTransaction(async transaction => {
      await requireAccountWritable(db, transaction, id);
      const ref = db.doc(`restaurant_accounts/${id}`), snapshot = await transaction.get(ref);
      const decision = evaluate({exists: snapshot.exists, data: snapshot.data() ?? {}});
      if (decision.operation === 'create') transaction.create(ref, decision.data);
      if (decision.operation === 'update') transaction.update(ref, decision.data);
      return decision.response;
    }),
    geocodeAddress: async () => {throw Error('Cuisine-only edit must not geocode');},
    serverTimestamp: () => FieldValue.serverTimestamp(),
  };
});
test.after(async () => {if (db) await db.terminate(); if (app) await deleteApp(app); if (env) await env.cleanup();});

async function save(cuisineTags) {
  const ref = db.doc('restaurant_accounts/owner'), before = (await ref.get()).data();
  const data = {intent: 'ownerUpdate', updateSection: 'basicInformation', requestId: `cuisine-local-${++sequence}`, expectedProfileVersion: before.profileVersion, expectedLocationVersion: before.locationVersion, profile: {...profile, cuisineTags}};
  const result = await saveBiteSaverRestaurantProfileHandler({auth: auth('owner'), data}, deps);
  assert.equal(result.documentId, 'owner');
  const after = (await ref.get()).data();
  assert.deepEqual(after.cuisineTags, cuisineTags);
  assert.deepEqual(after.privateUnknown, {preserve: true});
  await handleBiteSaverRestaurantWrite(indexDb, {restaurantAccountId: 'owner', before, after, sourceEventId: data.requestId, now, identityKeyV1});
  return {data, result};
}
async function search(searchText, expected) {
  const context = {database: searchDb, discoveryKey, identityKeyV1, identity: {authUid: 'local-reader', authIsAnonymous: false}, now: () => now.getTime(), randomSource: size => Buffer.alloc(size, ++entropy)};
  const started = await startCustomerBiteSaverSearchHandler({schemaVersion: customerBiteSaverSearchSchemaVersion, clientRequestId: `cuisine-request-${++sequence}`, clientInstanceId: `cuisine-instance-${sequence}`, latitude: 28.5383, longitude: -81.3792, radiusMiles: 10, locationMode: 'current', typedLocation: null, searchText, timeZone: 'America/New_York', utcOffsetMinutes: -240, freshSearch: true}, context);
  const ref = db.doc(`${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`);
  let session;
  for (let i = 0; i < 100; i++) {
    session = (await ref.get()).data();
    if (session.state !== 'preparing') break;
    await processCustomerBiteSaverSearchJob(session.currentJobId, context);
  }
  assert.equal(session.state, 'ready');
  const results = await db.collection(privateCustomerBiteSaverResultCollection).where('sessionId', '==', started.sessionId).get();
  assert.equal(results.size, expected, searchText);
  const bound = {schemaVersion: customerBiteSaverSearchSchemaVersion, clientRequestId: `cuisine-public-page-${sequence}`, clientInstanceId: `cuisine-instance-${sequence}`, sessionId: started.sessionId, capability: started.capability, criteriaFingerprint: started.criteriaFingerprint, cursor: null, guestStateRevision: null};
  const page = await getCustomerBiteSaverSearchPageHandler(bound, context);
  assert.equal(page.restaurants.length, expected, `Public response for ${searchText}`);
  assert.equal(JSON.stringify(page).includes('private-canary'), false);
  for (const restaurant of page.restaurants) {
    assert.equal(Object.hasOwn(restaurant, 'cuisineTags'), false, 'Existing strict public DTO stays unchanged');
    const offers = await getCustomerBiteSaverOfferPageHandler({...bound, clientRequestId: `cuisine-public-offers-${sequence}`, restaurantId: restaurant.restaurantId}, context);
    assert.equal(offers.offers.length, 1);
  }
  for (const result of results.docs) {
    assert.equal(result.data().authoritativeAccountId, 'owner');
    assert.equal(JSON.stringify(result.data().safeRestaurantSnapshot).includes('private-canary'), false);
  }
}

test('unchanged Rules deny direct cuisine writes and private reads; actual owner writer feeds bounded search', async () => {
  await env.clearFirestore();
  await db.doc('restaurant_accounts/owner').set(account());
  await db.doc('restaurant_accounts/owner/coupons/lunch').set({title: 'Lunch deal', details: 'Local offer', usageRule: 'Unlimited', isActive: true, active: true, isProximityOnly: false, couponCode: 'LOCAL', couponNumber: 1, createdAt: now, updatedAt: now});
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext('other', auth('other').token), env.authenticatedContext('owner', auth('owner').token)]) {
    await assertFails(updateDoc(doc(context.firestore(), 'restaurant_accounts/owner'), {cuisineTags: ['BBQ']}));
  }
  await assertFails(getDoc(doc(env.authenticatedContext('other', auth('other').token).firestore(), 'restaurant_accounts/owner')));
  const first = await save(['Barbecue']);
  await reconcileBiteSaverCouponOfferIndex(indexDb, 'owner', 'lunch', now, true, identityKeyV1);
  await saveBiteSaverRestaurantProfileHandler({auth: auth('owner'), data: first.data}, deps);
  assert.equal((await db.doc('restaurant_accounts/owner').get()).data().profileVersion, first.result.profileVersion);
  await assert.rejects(saveBiteSaverRestaurantProfileHandler({auth: auth('other'), data: first.data}, deps));
  await assert.rejects(saveBiteSaverRestaurantProfileHandler({auth: auth('owner'), data: {...first.data, documentId: 'other'}}, deps));
  await search('BBQ', 1);
  await save(['Thai']);
  await search('BBQ', 0);
  await search('Thai', 1);
  await save([]);
  await search('Thai', 0);
  await search('Ordinary Cafe', 1);
});
