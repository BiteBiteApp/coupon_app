'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Timestamp} = require('firebase-admin/firestore');
const safety = require('../lib/reviewer_safety');
const enabled = process.env.RUN_REVIEWER_SAFETY_EMULATOR === '1';
let db, app, serial = 0;
const auth = (uid = 'reporter', verified = true, provider = 'password') => ({uid, token: {email_verified: verified, firebase: {sign_in_provider: provider}}});
const report = (extra = {}, authentication = auth()) => ({auth: authentication, data: {schemaVersion: 1, expectedUserId: 'reporter', targetUserId: 'target', reason: 'Harassment', supportingReviewId: null, requestId: `safety_request_${String(++serial).padStart(8, '0')}`, ...extra}});
const block = (extra = {}, authentication = auth()) => ({auth: authentication, data: {schemaVersion: 1, expectedUserId: 'reporter', targetUserId: 'target', expectedRevision: 0, supportingReviewId: null, ...extra}});
const unblock = (extra = {}, authentication = auth()) => {const r = block(extra, authentication); delete r.data.supportingReviewId; return r;};
const status = (extra = {}, authentication = auth()) => ({auth: authentication, data: {schemaVersion: 1, expectedUserId: 'reporter', targetUserId: 'target', ...extra}});
const code = expected => error => error.code === expected;
const local = (name, fn) => test(name, {skip: !enabled}, fn);
test.before(async () => {
  if (!enabled) return;
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8792');
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  app = require('firebase-admin/app').initializeApp({projectId: 'demo-reviewer-safety'});
  db = require('firebase-admin/firestore').getFirestore(app);
});
test.beforeEach(async () => {
  if (!enabled) return;
  assert.equal((await fetch('http://127.0.0.1:8792/emulator/v1/projects/demo-reviewer-safety/databases/(default)/documents', {method: 'DELETE'})).status, 200);
  await db.doc('public_reviewer_profiles/target').set({userId: 'target', publicDisplayName: 'Public name', email: 'DO NOT COPY', private: 'DO NOT COPY'});
  await db.doc('bitescore_dishes/dish').set({restaurantId: 'restaurant', isActive: true});
  await db.doc('bitescore_restaurants/restaurant').set({isActive: true});
  await db.doc('dish_reviews/review').set({userId: 'target', dishId: 'dish', restaurantId: 'restaurant', headline: 'Original', notes: 'Public notes', private: 'DO NOT COPY'});
});
test.after(async () => {if (app) await app.delete();});

test('operator projection is public allowlist only, with no synthetic review', () => {
  const p = safety.reviewerReportAdminProjection('r', {schemaVersion: 1, reportScope: 'reviewer', reportedUserId: 'target', reportingUserId: 'reporter', status: 'pending', reason: 'Other', evidence: {publicDisplayName: 'Name', capturedAt: new Timestamp(1, 123456000), supportingReview: null, secret: 'DO NOT COPY'}, secret: 'DO NOT COPY'});
  assert.equal(p.evidence.capturedAtMillis, 1123);
  assert.equal(p.evidence.supportingReview, null);
  assert.equal('reviewId' in p, false);
  assert.equal('review' in p, false);
  assert.equal(JSON.stringify(p).includes('DO NOT COPY'), false);
});
local('verified caller identity, self/anonymous/unverified/forged/extra field rejection', async () => {
  for (const a of [undefined, auth('reporter', true, 'anonymous')]) {
    const r = report(); r.auth = a;
    await assert.rejects(safety.submitReviewerReportHandler(db, r), code('unauthenticated'));
  }
  await assert.rejects(safety.submitReviewerReportHandler(db, report({}, auth('reporter', false))), code('permission-denied'));
  await assert.rejects(safety.submitReviewerReportHandler(db, report({expectedUserId: 'other'})), code('permission-denied'));
  await assert.rejects(safety.submitReviewerReportHandler(db, report({targetUserId: 'reporter'})), code('invalid-argument'));
  await assert.rejects(safety.submitReviewerReportHandler(db, report({targetUserId: 'invented'})), code('not-found'));
  for (const extra of [{reason: 'invented'}, {evidence: {}}, {reportingUserId: 'other'}, {supportingReviewId: 'missing'}, {requestId: 'short'}]) {
    await assert.rejects(safety.submitReviewerReportHandler(db, report(extra)));
  }
  assert.equal((await db.collection('review_reports').get()).size, 0);
});
local('profile-only report captures bounded immutable public evidence, never a fake review', async () => {
  const r = report();
  const result = await safety.submitReviewerReportHandler(db, r);
  const ref = db.doc('review_reports/' + result.reportId), saved = (await ref.get()).data();
  assert.equal(saved.reportingUserId, 'reporter'); assert.equal(saved.reportedUserId, 'target');
  assert.equal(saved.reportScope, 'reviewer'); assert.equal(saved.evidence.supportingReview, null);
  for (const field of ['reviewId', 'dishId', 'restaurantId']) assert.equal(field in saved, false);
  assert.ok(saved.createdAt instanceof Timestamp); assert.ok(saved.evidence.capturedAt instanceof Timestamp);
  assert.equal(JSON.stringify(saved).includes('DO NOT COPY'), false);
  await db.doc('public_reviewer_profiles/target').update({publicDisplayName: 'Changed'});
  assert.equal((await safety.submitReviewerReportHandler(db, r)).reportId, result.reportId);
  assert.deepEqual((await ref.get()).data(), saved);
  await assert.rejects(safety.submitReviewerReportHandler(db, {...r, data: {...r.data, reason: 'Spam'}}), code('already-exists'));
});
local('supporting review proves actual author/parents; text bounds and deletion independence', async () => {
  await db.doc('dish_reviews/review').update({headline: 'h'.repeat(500), notes: 'n'.repeat(4000)});
  await assert.rejects(safety.submitReviewerReportHandler(db, report({targetUserId: 'someone-else', supportingReviewId: 'review'})), code('not-found'));
  await db.doc('bitescore_dishes/dish').update({restaurantId: 'wrong'});
  await assert.rejects(safety.submitReviewerReportHandler(db, report({supportingReviewId: 'review'})), code('not-found'));
  await db.doc('bitescore_dishes/dish').update({restaurantId: 'restaurant'});
  await db.doc('dish_reviews/review').update({isHidden: true});
  await assert.rejects(safety.submitReviewerReportHandler(db, report({supportingReviewId: 'review'})), code('not-found'));
  await db.doc('dish_reviews/review').update({isHidden: false});
  const result = await safety.submitReviewerReportHandler(db, report({supportingReviewId: 'review'}));
  const ref = db.doc('review_reports/' + result.reportId), saved = (await ref.get()).data();
  assert.equal(saved.evidence.supportingReview.headline.length, 200);
  assert.equal(saved.evidence.supportingReview.notes.length, 2000);
  assert.equal(saved.evidence.supportingReview.textTruncated, true);
  assert.equal((await db.collection('review_reports').where('reviewId', '==', 'review').get()).empty, true);
  await db.doc('dish_reviews/review').delete();
  assert.deepEqual((await ref.get()).data(), saved);
  assert.equal(safety.reviewerReportAdminProjection(result.reportId, saved).evidence.supportingReview.reviewId, 'review');
});
local('duplicate request races share one pending report; receipts survive dismissal and new reports', async () => {
  const requests = [report(), report(), report(), report()];
  const results = await Promise.all(requests.map(r => safety.submitReviewerReportHandler(db, r)));
  assert.equal(new Set(results.map(r => r.reportId)).size, 1);
  assert.equal((await db.collection('review_reports').get()).size, 1);
  assert.equal(results.filter(r => r.submitted).length, 1);
  const id = results[0].reportId;
  await db.doc('review_reports/' + id).update({status: 'dismissed'});
  const next = await safety.submitReviewerReportHandler(db, report());
  assert.notEqual(next.reportId, id);
  for (const r of requests) assert.equal((await safety.submitReviewerReportHandler(db, r)).reportId, id);
  assert.equal((await db.collection('review_reports').get()).size, 2);
});
local('12 distinct requests per minute, exact retries free, window recovery', async () => {
  const requests = Array.from({length: 12}, () => report());
  for (const r of requests) await safety.submitReviewerReportHandler(db, r, 1_000_000);
  await safety.submitReviewerReportHandler(db, requests[0], 1_000_001);
  const limited = report();
  await assert.rejects(safety.submitReviewerReportHandler(db, limited, 1_059_999), code('resource-exhausted'));
  await safety.submitReviewerReportHandler(db, limited, 1_060_000);
  assert.equal((await db.doc('user_profiles/reporter/reviewer_safety_state/report_admission').get()).get('count'), 1);
});
local('block/unblock status isolates accounts; retries and revisions cannot reverse newer choices', async () => {
  const first = block();
  assert.deepEqual(await safety.blockReviewerHandler(db, first), {schemaVersion: 1, targetUserId: 'target', blocked: true, revision: 1});
  assert.equal((await safety.blockReviewerHandler(db, first)).revision, 1);
  const saved = (await db.doc(safety.reviewerBlockPath('reporter', 'target')).get()).data();
  assert.deepEqual(Object.keys(saved).sort(), ['createdAt', 'schemaVersion', 'targetUserId']);
  assert.ok(saved.createdAt instanceof Timestamp);
  assert.equal((await safety.getReviewerSafetyStatusHandler(db, status())).blocked, true);
  assert.equal((await safety.getReviewerSafetyStatusHandler(db, status({expectedUserId: 'other'}, auth('other')))).blocked, false);
  await assert.rejects(safety.getReviewerSafetyStatusHandler(db, status({expectedUserId: 'reporter'}, auth('other'))), code('permission-denied'));
  const removal = unblock({expectedRevision: 1});
  assert.equal((await safety.unblockReviewerHandler(db, removal)).revision, 2);
  assert.equal((await safety.unblockReviewerHandler(db, removal)).revision, 2);
  await assert.rejects(safety.blockReviewerHandler(db, first), code('failed-precondition'));
  assert.equal((await db.doc('dish_reviews/review').get()).get('headline'), 'Original');
  assert.ok((await db.doc('public_reviewer_profiles/target').get()).exists);
});
local('block rejects self/anonymous/invented targets; unblock needs no surviving target', async () => {
  await assert.rejects(safety.blockReviewerHandler(db, block({targetUserId: 'reporter'})), code('invalid-argument'));
  await assert.rejects(safety.blockReviewerHandler(db, block({}, auth('reporter', true, 'anonymous'))), code('unauthenticated'));
  await assert.rejects(safety.blockReviewerHandler(db, block({targetUserId: 'invented'})), code('not-found'));
  await safety.blockReviewerHandler(db, block({}, auth('reporter', false)));
  await db.doc('public_reviewer_profiles/target').delete();
  await db.doc('private_account_deletions/target').set({state: 'complete'});
  assert.equal((await safety.unblockReviewerHandler(db, unblock({expectedRevision: 1}))).blocked, false);
  assert.equal((await safety.unblockReviewerHandler(db, unblock({targetUserId: 'never-existed', expectedRevision: 2}))).revision, 2);
});
local('report and block fences apply to both parties; no private recreation after deletion', async () => {
  for (const who of ['reporter', 'target']) {
    const fence = db.doc('private_account_deletions/' + who); await fence.set({});
    await assert.rejects(safety.submitReviewerReportHandler(db, report()), code('failed-precondition'));
    await assert.rejects(safety.blockReviewerHandler(db, block()), code('failed-precondition'));
    await fence.delete();
  }
  await db.doc('private_account_deletions/reporter').set({state: 'complete'});
  await assert.rejects(safety.unblockReviewerHandler(db, unblock()), code('failed-precondition'));
  await assert.rejects(safety.getReviewerSafetyStatusHandler(db, status()), code('failed-precondition'));
  assert.equal((await db.collection('user_profiles/reporter/reviewer_safety_state').get()).empty, true);
});
local('public source without profile is valid only with matching supporting review', async () => {
  await db.doc('public_reviewer_profiles/target').delete();
  await assert.rejects(safety.submitReviewerReportHandler(db, report()), code('not-found'));
  assert.equal((await safety.submitReviewerReportHandler(db, report({supportingReviewId: 'review'}))).submitted, true);
  assert.equal((await safety.blockReviewerHandler(db, block({supportingReviewId: 'review'}))).blocked, true);
});

local('four source callable exports preserve identity checks and reach only the local private contracts', async () => {
  const runtime = require('../lib/customer_bitescore_runtime');
  for (const name of ['submitReviewerReport', 'blockReviewer', 'unblockReviewer', 'getReviewerSafetyStatus']) {
    assert.equal(typeof runtime[name].run, 'function');
    assert.equal(runtime[name].__endpoint.serviceAccountEmail, runtime.biteScoreCustomerRuntimeServiceAccount);
  }
  const submitted = await runtime.submitReviewerReport.run(report());
  assert.equal(submitted.submitted, true);
  await runtime.blockReviewer.run(block());
  assert.equal((await runtime.getReviewerSafetyStatus.run(status())).blocked, true);
  assert.equal((await runtime.unblockReviewer.run(unblock({expectedRevision: 1}))).blocked, false);
  await assert.rejects(runtime.blockReviewer.run(block({expectedUserId: 'another'})), code('permission-denied'));
});
