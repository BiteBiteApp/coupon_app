'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const {doc, setDoc, getDoc, getDocs, collection, query, where, deleteDoc, updateDoc, writeBatch, serverTimestamp} = require('firebase/firestore');

const policy = process.env.SAFETY_RULES_POLICY ?? 'source';
assert.ok(['source', 'candidate'].includes(policy));
const ruleFile = policy === 'source' ? '../../firestore.rules' : '../../tool/safety_release_prep/candidate/firestore.rules';
let env;
const actor = (uid, admin = false) => env.authenticatedContext(uid,
  {admin, email_verified: true, firebase: {sign_in_provider: 'password'}}).firestore();
const seed = rows => env.withSecurityRulesDisabled(async c => {
  for (const [p, value] of Object.entries(rows)) await setDoc(doc(c.firestore(), p), value);
});
const vote = {reviewId: 'review', dishId: 'dish', restaurantId: 'restaurant', userId: 'voter', voteType: 'helpful'};
test.before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8792');
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  env = await initializeTestEnvironment({projectId: `demo-safety-policy-${policy}`,
    firestore: {rules: fs.readFileSync(path.resolve(__dirname, ruleFile), 'utf8')}});
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await seed({
    'bitescore_restaurants/restaurant': {id: 'restaurant', name: 'Synthetic restaurant', isActive: true, active: true, isClaimed: true, ownerUserId: 'owner', restaurantWriteRevision: 0},
    'bitescore_dishes/dish': {id: 'dish', restaurantId: 'restaurant', isActive: true},
    'dish_reviews/review': {id: 'review', userId: 'author', dishId: 'dish', restaurantId: 'restaurant', notes: 'Published words'},
    'review_feedback_votes/vote': vote,
    'review_reports/legacy': {reviewId: 'review', dishId: 'dish', restaurantId: 'restaurant', reportingUserId: 'reporter', status: 'pending'},
    // Actual trusted shapes deliberately do not have a top-level reviewId.
    'review_reports/photo': {reportScope: 'photo', supportingReviewId: 'review', imageId: 'image', reportingUserId: 'reporter', status: 'pending'},
    'review_reports/reviewer': {reportScope: 'reviewer', reportedUserId: 'author', reportingUserId: 'reporter', evidence: {review: {reviewId: 'review'}}, status: 'pending'},
  });
});
test.after(async () => {if (env) await env.cleanup();});

test('actual Admin remove-review query/delete order removes votes and legacy reports, preserving independent cases', async () => {
  const admin = actor('admin', true);
  // BiteScoreService.deleteReviewAsAdmin -> _deleteReviewTrustData performs these
  // exact queries and sequential deletes before deleting the review itself.
  for (const name of ['review_feedback_votes', 'review_reports']) {
    const rows = await assertSucceeds(getDocs(query(collection(admin, name), where('reviewId', '==', 'review'))));
    assert.equal(rows.size, 1);
    for (const row of rows.docs) await assertSucceeds(deleteDoc(row.ref));
  }
  await assertSucceeds(deleteDoc(doc(admin, 'dish_reviews/review')));
  assert.equal((await getDoc(doc(admin, 'dish_reviews/review'))).exists(), false);
  assert.equal((await getDoc(doc(admin, 'review_reports/photo'))).exists(), true);
  assert.equal((await getDoc(doc(admin, 'review_reports/reviewer'))).exists(), true);
});

test('a stranger, author or business owner cannot impersonate Admin to delete another user vote', async () => {
  for (const db of [actor('stranger'), actor('author'), actor('owner'), env.unauthenticatedContext().firestore()]) {
    await assertFails(deleteDoc(doc(db, 'review_feedback_votes/vote')));
  }
});

for (const fence of ['admin', 'voter']) test(`Admin vote cleanup preserves deletion fence for ${fence}`, async () => {
  await seed({[`private_account_deletions/${fence}`]: {state: 'requested'}});
  await assertFails(deleteDoc(doc(actor('admin', true), 'review_feedback_votes/vote')));
});

for (const kind of ['dish', 'restaurant']) test(`Admin vote cleanup preserves ${kind} operation lock`, async () => {
  await seed({[`private_rating_${kind}_operation_locks/${kind}`]: {state: 'running'}});
  await assertFails(deleteDoc(doc(actor('admin', true), 'review_feedback_votes/vote')));
});

test('Admin permission is deletion-only and cannot overwrite or forge another user vote', async () => {
  const admin = actor('admin', true);
  await assertFails(updateDoc(doc(admin, 'review_feedback_votes/vote'), {voteType: 'notHelpful'}));
  await assertFails(setDoc(doc(admin, 'review_feedback_votes/forged'), vote));
});

if (policy === 'source') test('source own-vote withdrawal remains available', async () => {
  await assertSucceeds(deleteDoc(doc(actor('voter'), 'review_feedback_votes/vote')));
});

if (policy === 'candidate') test('candidate keeps Admin review movement closed even without screening runtime', async () => {
  const admin = actor('admin', true);
  for (const runtime of [null, {required: false}, {required: true, processingEnabled: false}]) {
    if (runtime) await seed({'private_bitescore_runtime/review_text': runtime});
    await assertFails(updateDoc(doc(admin, 'dish_reviews/review'), {dishId: 'other'}));
    await assertFails(updateDoc(doc(admin, 'dish_reviews/review'), {userId: 'other'}));
  }
});

function initializeMenu(db, extra = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'restaurant_menus/menu'), {restaurantName: 'Synthetic restaurant', normalizedName: 'synthetic restaurant',
    normalizedAddressKey: 'synthetic', bitescoreRestaurantId: 'restaurant', createdByUserId: 'owner', linkStatus: 'bitescore_only',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra});
  batch.set(doc(db, 'bitescore_restaurants/restaurant'), {sharedMenuId: 'menu', restaurantWriteRevision: 1,
    updatedAt: serverTimestamp()}, {merge: true});
  return batch.commit();
}

test('actual owner empty shared-menu initialization and subsequent touch work before photo submission', async () => {
  await assertSucceeds(initializeMenu(actor('owner')));
  await assertSucceeds(setDoc(doc(actor('owner'), 'restaurant_menus/menu'), {updatedAt: serverTimestamp()}, {merge: true}));
  assert.equal((await getDoc(doc(actor('owner'), 'bitescore_restaurants/restaurant'))).data().sharedMenuId, 'menu');
});

test('empty menu initialization cannot be used by stranger or to publish unchecked extra content', async () => {
  await assertFails(initializeMenu(actor('stranger')));
  await seed({'private_bitescore_runtime/terms': {schemaVersion: 1, required: true, version: 'bitestar-terms-v1', acceptedVersions: ['bitestar-terms-v1']}});
  await assertFails(initializeMenu(actor('owner'), {description: 'Unchecked public content'}));
});

test('owner menu initialization remains fenced by deletion and restaurant operation lock', async () => {
  await seed({'private_account_deletions/owner': {state: 'requested'}});
  await assertFails(initializeMenu(actor('owner')));
  await env.withSecurityRulesDisabled(c => deleteDoc(doc(c.firestore(), 'private_account_deletions/owner')));
  await seed({'private_rating_restaurant_operation_locks/restaurant': {state: 'running'}});
  await assertFails(initializeMenu(actor('owner')));
});

test('owner pending name request needs contributor Terms and cannot approve itself', async () => {
  const db = actor('owner');
  const data = {userId: 'owner', currentRestaurantName: 'Old', requestedRestaurantName: 'New', status: 'pending', createdAt: serverTimestamp()};
  await seed({'private_bitescore_runtime/terms': {schemaVersion: 1, required: true, version: 'bitestar-terms-v1', acceptedVersions: ['bitestar-terms-v1']}});
  await assertFails(setDoc(doc(db, 'restaurant_name_change_requests/request'), data));
  await seed({'user_profiles/owner': {termsAcceptance: {version: 'bitestar-terms-v1', acceptedAt: new Date(1)}}});
  await assertSucceeds(setDoc(doc(db, 'restaurant_name_change_requests/request'), data));
  await assertFails(updateDoc(doc(db, 'restaurant_name_change_requests/request'), {status: 'approved'}));
});

if (policy === 'candidate') test('existing Admin name rejection uses exact server-time merge while approval and identity changes stay held', async () => {
  const admin = actor('admin', true), requestPath = 'restaurant_name_change_requests/request';
  await seed({[requestPath]: {userId: 'owner', requestedRestaurantName: 'New', status: 'pending'}});
  await assertFails(updateDoc(doc(actor('owner'), requestPath), {status: 'rejected', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(doc(admin, requestPath), {status: 'approved', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(doc(admin, requestPath), {status: 'rejected', updatedAt: new Date(1)}));
  await assertFails(updateDoc(doc(admin, requestPath), {status: 'rejected', userId: 'other', updatedAt: serverTimestamp()}));
  await assertSucceeds(setDoc(doc(admin, requestPath), {status: 'rejected', updatedAt: serverTimestamp()}, {merge: true}));
  await seed({'private_account_deletions/owner': {state: 'requested'}});
  await assertFails(updateDoc(doc(admin, requestPath), {status: 'rejected', updatedAt: serverTimestamp()}));
});

if (policy === 'candidate') test('candidate retains unrelated content holds and live public browsing', async () => {
  const db = actor('owner'), admin = actor('admin', true);
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'bitescore_restaurants/restaurant')));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'dish_reviews/review')));
  await assertFails(updateDoc(doc(admin, 'bitescore_restaurants/restaurant'), {name: 'Movement not authorized'}));
  await assertFails(setDoc(doc(db, 'restaurant_menus/menu/menu_items/item'), {name: 'New item'}));
  await assertFails(setDoc(doc(db, 'restaurant_menus/menu/menu_sections/section'), {name: 'New section'}));
  await seed({'restaurant_accounts/owner': {uid: 'owner', approvalStatus: 'approved', couponPostingEnabled: true},
    'restaurant_accounts/owner/coupons/coupon': {id: 'coupon'}});
  await assertFails(deleteDoc(doc(admin, 'restaurant_accounts/owner/coupons/coupon')));
});

test('private safety records and acceptance cannot be forged by client Admin or any customer', async () => {
  await seed({'user_profiles/author/blocked_reviewers/other': {targetUserId: 'other'}});
  await assertSucceeds(getDoc(doc(actor('author'), 'user_profiles/author/blocked_reviewers/other')));
  await assertFails(getDoc(doc(actor('stranger'), 'user_profiles/author/blocked_reviewers/other')));
  for (const db of [actor('author'), actor('stranger'), actor('admin', true)]) {
    await assertFails(setDoc(doc(db, 'user_profiles/author'), {termsAcceptance: {version: 'bitestar-terms-v1', acceptedAt: new Date()}}));
    for (const collectionName of ['private_bitescore_review_text', 'private_bitescore_review_text_receipts', 'private_bitescore_photo_screenings']) {
      await assertFails(getDoc(doc(db, `${collectionName}/private`)));
      await assertFails(setDoc(doc(db, `${collectionName}/private`), {state: 'approved'}));
    }
  }
});
