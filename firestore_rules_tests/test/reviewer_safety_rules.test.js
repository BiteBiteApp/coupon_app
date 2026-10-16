'use strict';
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const {doc, collection, query, where, limit, setDoc, getDoc, getDocs, updateDoc, deleteDoc, serverTimestamp} = require('firebase/firestore');
let env;
const actor = (uid, admin = false, provider = 'password') => env.authenticatedContext(uid, {email_verified: true, admin, firebase: {sign_in_provider: provider}}).firestore();
const seed = rows => env.withSecurityRulesDisabled(async c => {for (const [p, data] of Object.entries(rows)) await setDoc(doc(c.firestore(), p), data);});
const reviewer = {schemaVersion: 1, reportScope: 'reviewer', reportingUserId: 'reporter', reportedUserId: 'target', reason: 'Harassment', status: 'pending', evidence: {publicDisplayName: 'Captured', supportingReview: null, capturedAt: new Date()}, createdAt: new Date(), updatedAt: new Date()};
const legacy = {id: 'legacy', reviewId: 'review', dishId: 'dish', restaurantId: 'restaurant', reportingUserId: 'reporter', reason: 'Spam', status: 'pending', createdAt: new Date(), updatedAt: new Date()};
test.before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8792');
  env = await initializeTestEnvironment({projectId: 'demo-reviewer-safety-rules', firestore: {rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')}});
});
test.beforeEach(async () => {await env.clearFirestore(); await seed({'dish_reviews/review': {userId: 'target', dishId: 'dish', restaurantId: 'restaurant'}, 'review_reports/reviewer': reviewer});});
test.after(async () => {if (env) await env.cleanup();});
test('legacy create/edit/read/dismiss/delete remain compatible; authoritative reviewer fields cannot be forged', async () => {
  const db = actor('reporter'), admin = actor('admin', true);
  await assertSucceeds(setDoc(doc(db, 'review_reports/legacy'), legacy));
  await assertSucceeds(updateDoc(doc(db, 'review_reports/legacy'), {reason: 'Other', updatedAt: serverTimestamp()}));
  for (const extra of [{reportScope: 'reviewer'}, {reportedUserId: 'target'}, {evidence: {}}, {reportScope: 'unknown'}]) {
    await assertFails(setDoc(doc(db, 'review_reports/forged'), {...legacy, ...extra}));
    await assertFails(updateDoc(doc(db, 'review_reports/legacy'), extra));
  }
  await assertFails(setDoc(doc(db, 'review_reports/new-reviewer'), reviewer));
  await assertSucceeds(updateDoc(doc(admin, 'review_reports/legacy'), {status: 'dismissed', updatedAt: serverTimestamp()}));
  await assertSucceeds(deleteDoc(doc(admin, 'review_reports/legacy')));
});
test('reviewer evidence immutable; only Admin resolution works, independent of supporting review', async () => {
  const reporter = actor('reporter'), admin = actor('admin', true), target = actor('target');
  await assertSucceeds(getDoc(doc(reporter, 'review_reports/reviewer')));
  await assertSucceeds(getDoc(doc(admin, 'review_reports/reviewer')));
  await assertFails(getDoc(doc(target, 'review_reports/reviewer')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'review_reports/reviewer')));
  await assertSucceeds(getDocs(query(collection(reporter, 'review_reports'), where('reportingUserId', '==', 'reporter'), limit(25))));
  for (const db of [reporter, admin]) for (const change of [{reason: 'Other'}, {evidence: {}}, {reportedUserId: 'wrong'}, {reportScope: 'review'}, {reviewId: 'review'}]) await assertFails(updateDoc(doc(db, 'review_reports/reviewer'), change));
  await assertFails(updateDoc(doc(reporter, 'review_reports/reviewer'), {status: 'dismissed', updatedAt: serverTimestamp()}));
  await env.withSecurityRulesDisabled(c => deleteDoc(doc(c.firestore(), 'dish_reviews/review')));
  await assertSucceeds(updateDoc(doc(admin, 'review_reports/reviewer'), {status: 'dismissed', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(doc(admin, 'review_reports/reviewer'), {status: 'pending', updatedAt: serverTimestamp()}));
  await seed({'private_account_deletions/target': {}});
  await assertFails(updateDoc(doc(admin, 'review_reports/reviewer'), {status: 'dismissed', updatedAt: serverTimestamp()}));
});
test('blocks/preferences are owner-readable, all direct writes denied, admission/receipts remain server-only', async () => {
  const block = 'user_profiles/reporter/blocked_reviewers/target';
  const pref = 'user_profiles/reporter/reviewer_safety_state/preferences';
  const admission = 'user_profiles/reporter/reviewer_safety_state/report_admission';
  await seed({[block]: {schemaVersion: 1, targetUserId: 'target', createdAt: new Date()}, [pref]: {schemaVersion: 1, revision: 1}, [admission]: {count: 1}});
  const owner = actor('reporter');
  await assertSucceeds(getDoc(doc(owner, block))); await assertSucceeds(getDoc(doc(owner, pref)));
  await assertSucceeds(getDocs(query(collection(owner, 'user_profiles/reporter/blocked_reviewers'), limit(25))));
  for (const db of [owner, actor('target'), actor('stranger'), actor('admin', true), actor('reporter', false, 'anonymous'), env.unauthenticatedContext().firestore()]) {
    for (const p of [block, pref, admission]) {
      if (db !== owner || p === admission) await assertFails(getDoc(doc(db, p)));
      await assertFails(setDoc(doc(db, p), {forged: true}));
      await assertFails(updateDoc(doc(db, p), {revision: 2}));
      await assertFails(deleteDoc(doc(db, p)));
    }
    await assertFails(getDocs(collection(db, 'user_profiles/reporter/reviewer_safety_state')));
  }
});
