'use strict';

// Release composition only. No production constants or runtime documents are
// changed, and providers below are deterministic functions with no transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createRequire} = require('node:module');
const rulesRequire = createRequire(path.resolve(__dirname, '../../firestore_rules_tests/package.json'));
const {initializeTestEnvironment, assertFails} = rulesRequire('@firebase/rules-unit-testing');
const {ref, uploadBytes} = rulesRequire('firebase/storage');
const terms = require('../lib/bitescore_terms');
const text = require('../lib/review_text_moderation');
const photos = require('../lib/photo_screening');
const ownerPhotos = require('../lib/owner_photo_screening');
const reports = require('../lib/photo_reports');
const safety = require('../lib/reviewer_safety');
const {saveCustomerBiteScoreReview: saveReview} = require('../lib/bitescore_review_aggregate');
const {createFirestoreRatingDestructivePrivateDatabase} = require('../lib/rating_destructive_job_store');

const enabled = process.env.RUN_SAFETY_RELEASE_EMULATOR === '1';
const local = (name, fn) => test(name, {skip: !enabled}, fn);
// Storage's cross-service Rules reads use the emulator's configured project.
// The orchestrator runs this file serially with other suites using this project.
const project = 'demo-coupon-app-rules';
const bucketName = `${project}.appspot.com`;
const legal = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../legal/review-manifest.json'), 'utf8'));
const releaseTerms = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../tool/safety_release_prep/candidate/approved-terms.json'), 'utf8'));
const releaseRuntime = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../tool/safety_release_prep/candidate/runtime-phases.json'), 'utf8'));
const approvedTerms = Object.freeze({version: legal.approvedTermsVersion,
  text: fs.readFileSync(path.resolve(__dirname, '../../legal/terms-of-service.txt'), 'utf8')});
const policyVariant = process.env.SAFETY_RELEASE_RULES ?? 'source';
assert.ok(['source', 'candidate'].includes(policyVariant));
const rulesRoot = policyVariant === 'candidate' ? '../../tool/safety_release_prep/candidate' : '../..';
const cleanPhoto = {adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'UNLIKELY', medical: 'VERY_LIKELY', spoof: 'VERY_LIKELY'};
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=', 'base64');
const photoPolicy = {required: true, enabled: true, ownerRequired: true, ownerEnabled: true,
  policyVersion: 'conservative-hold-v1', monthlyAllowance: 1000, retentionApproved: true,
  retentionPolicyVersion: 'photo-retention-v1', failedScreeningRetentionDays: 7,
  failedScreeningRetentionApproved: true, cleanupEnabled: true};
const textPolicy = {...text.reviewTextRuntimeCandidate, required: true, processingEnabled: true,
  retentionApproved: true, cleanupEnabled: true};
const termsPolicy = {schemaVersion: 1, required: true, version: approvedTerms.version, acceptedVersions: [approvedTerms.version]};
let app, db, auth, bucket, env, store, objects, now, providerCalls;
const read = async p => (await db.doc(p).get()).data();
const signed = uid => ({uid, token: {admin: uid === 'admin', email_verified: true, firebase: {sign_in_provider: 'password'}}});
const request = (uid, data) => ({auth: signed(uid), data: {schemaVersion: 1, expectedUserId: uid, ...data}});
const photoInput = extra => ({dishId: 'dish', restaurantId: 'restaurant', reviewId: null, mode: 'gallery',
  contentType: 'image/png', bytesBase64: bytes.toString('base64'), retry: false, ...extra});
const ownerInput = extra => ({sourceType: 'biteSaver', sourceId: 'owner', family: 'menu', targetId: 'page',
  contentType: 'image/png', bytesBase64: bytes.toString('base64'), retry: false, ...extra});
const photoProvider = () => ({name: 'deterministic-release-fixture', screen: async () => {providerCalls++; return cleanPhoto;}});
const textProvider = flagged => ({screen: async () => {providerCalls++; return {flagged};}});
const options = provider => ({approvedTerms, objects, now: () => now.getTime(), provider: provider ?? photoProvider()});
const customerPhoto = (extra = {}, provider) => photos.submitScreenedPhotoHandler(db, request('customer', photoInput(extra)), options(provider));
const ownerPhoto = (extra = {}, provider) => ownerPhotos.submitScreenedOwnerPhotoHandler(db, request('owner', ownerInput(extra)), options(provider));
const useOwner = imageId => ownerPhotos.useOwnerScreenedPhotoHandler(db, request('owner', {imageId, action: 'attach'}), options());
const review = (notes = 'Approved words', provider = textProvider(false)) => saveReview(store,
  {uid: 'customer', emailVerified: true}, {schemaVersion: 1, expectedUserId: 'customer', dishId: 'dish',
    restaurantId: 'restaurant', headline: 'Food', notes, overallImpression: 8, tastinessScore: 7,
    qualityScore: 9, valueScore: 6}, now, approvedTerms, provider, () => now);
const accept = uid => terms.customerBiteScoreTerms(store, {uid, emailVerified: true},
  {expectedUserId: uid, version: approvedTerms.version}, true, now, approvedTerms);
const row = result => read(`${photos.screeningCollection}/${result.imageId}`);
const media = async value => fetch(`http://127.0.0.1:9298/v0/b/${bucketName}/o/${encodeURIComponent(value.storagePath)}?alt=media`);
function gate(result) {
  let enter, release;
  const entered = new Promise(resolve => {enter = resolve;});
  const waiting = new Promise(resolve => {release = resolve;});
  return {entered, release, provider: {name: 'deterministic-release-gate', screen: async () => {
    providerCalls++; enter(); await waiting; return result;
  }}};
}

test.before(async () => {
  if (!enabled) return;
  for (const [key, value] of Object.entries({FIRESTORE_EMULATOR_HOST: '127.0.0.1:8792',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9198', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9298'})) {
    assert.equal(process.env[key], value, `local-only guard ${key}`);
  }
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  app = require('firebase-admin/app').initializeApp({projectId: project, storageBucket: bucketName});
  db = require('firebase-admin/firestore').getFirestore(app);
  auth = require('firebase-admin/auth').getAuth(app);
  bucket = require('firebase-admin/storage').getStorage(app).bucket();
  store = createFirestoreRatingDestructivePrivateDatabase(db);
  objects = photos.screeningObjects();
  env = await initializeTestEnvironment({projectId: project,
    firestore: {host: '127.0.0.1', port: 8792, rules: fs.readFileSync(path.resolve(__dirname, rulesRoot, 'firestore.rules'), 'utf8')},
    storage: {host: '127.0.0.1', port: 9298, rules: fs.readFileSync(path.resolve(__dirname, rulesRoot, 'storage.rules'), 'utf8')}});
  for (const uid of ['customer', 'owner', 'admin', 'other']) {
    try {await auth.deleteUser(uid);} catch (error) {if (error.code !== 'auth/user-not-found') throw error;}
    await auth.createUser({uid, email: `${uid}@example.test`, emailVerified: true, password: 'Local-only-12345'});
    if (uid === 'admin') await auth.setCustomUserClaims(uid, {admin: true});
  }
});
test.beforeEach(async () => {
  if (!enabled) return;
  await env.clearFirestore();
  await bucket.deleteFiles({force: true});
  now = new Date(); providerCalls = 0;
  for (const [p, value] of Object.entries({
    [terms.biteScoreTermsRuntimePath]: termsPolicy,
    [text.reviewTextRuntimePath]: textPolicy, [photos.screeningRuntimePath]: photoPolicy,
    'private_bitescore_runtime/aggregation': {enabled: true, version: 1, epoch: 'release-composition'},
    'bitescore_restaurants/restaurant': {id: 'restaurant', name: 'Synthetic restaurant', isActive: true},
    'bitescore_dishes/dish': {id: 'dish', name: 'Synthetic dish', restaurantId: 'restaurant', isActive: true, imageCount: 0},
    'restaurant_accounts/owner': {uid: 'owner', restaurantName: 'Synthetic owner', couponApplicationSubmitted: true,
      approvalStatus: 'approved', couponPostingEnabled: true},
    'public_reviewer_profiles/customer': {userId: 'customer', publicDisplayName: 'Synthetic contributor'},
  })) await db.doc(p).set(value);
});
test.after(async () => {if (env) await env.cleanup(); if (app) await app.delete();});

local('published exact Terms compose with customer rating/photo and owner explicit attachment without authority grants', async () => {
  assert.equal(approvedTerms.version, 'bitestar-terms-v1');
  assert.equal(legal.effectiveDate, '2026-10-17');
  assert.equal(createHash('sha256').update(approvedTerms.text).digest('hex'), legal.documents['terms-of-service'].textSha256);
  assert.deepEqual(approvedTerms, {version: releaseTerms.version, text: releaseTerms.text});
  assert.equal(releaseTerms.canonicalTextSha256, legal.documents['terms-of-service'].textSha256);
  assert.equal(releaseTerms.effectiveDate, legal.effectiveDate);
  assert.deepEqual(releaseTerms.acceptedPriorVersions, []);
  assert.equal(releaseTerms.executionEnabled, false);
  assert.equal(releaseRuntime.executionEnabled, false);
  assert.equal(releaseRuntime.productionWritesAuthorized, false);
  assert.deepEqual(termsPolicy, releaseRuntime.phases.enforcedPaused[terms.biteScoreTermsRuntimePath]);
  assert.deepEqual(photoPolicy, releaseRuntime.phases.isolatedEnabledTestsOnly[photos.screeningRuntimePath]);
  assert.deepEqual(textPolicy, releaseRuntime.phases.isolatedEnabledTestsOnly[text.reviewTextRuntimePath]);
  assert.equal(terms.approvedBiteScoreTerms, null);
  await assert.rejects(review(), {code: 'failed-precondition'});
  await assert.rejects(customerPhoto(), {code: 'failed-precondition'});
  await assert.rejects(ownerPhoto(), {code: 'failed-precondition'});
  assert.equal(providerCalls, 0);
  for (const uid of ['customer', 'owner']) {
    const status = await accept(uid);
    assert.equal(status.text, approvedTerms.text);
    assert.equal(status.version, approvedTerms.version);
    const receipt = (await read(`user_profiles/${uid}`)).termsAcceptance;
    assert.equal(receipt.version, approvedTerms.version);
    assert.equal(receipt.acceptedAt.toMillis(), now.getTime());
  }
  const saved = await review();
  const image = await customerPhoto({mode: 'review', reviewId: saved.review.id});
  assert.equal(saved.textStatus, 'published'); assert.equal(image.state, 'approved');
  assert.equal((await read('dish_rating_aggregates/dish')).ratingCount, 1);
  const ownerImage = await ownerPhoto();
  assert.equal(ownerImage.state, 'available');
  assert.equal((await media(await row(ownerImage))).status, 403);
  assert.equal(await read('restaurant_accounts/owner/menu_images/page'), undefined);
  await useOwner(ownerImage.imageId);
  assert.equal((await media(await row(ownerImage))).status, 200);
  assert.equal((await read('restaurant_accounts/owner/menu_images/page')).imageUrl, ownerImage.imageUrl);
  await assert.rejects(ownerPhotos.useOwnerScreenedPhotoHandler(db, request('customer', {imageId: ownerImage.imageId, action: 'attach'}), options()), {code: 'permission-denied'});
});

local('simultaneous provider pause keeps held text/customer photos/owner assets private and recovery preserves original versions', async () => {
  await accept('customer'); await accept('owner');
  const original = await review();
  const textGate = gate({flagged: false}), customerGate = gate(cleanPhoto), ownerGate = gate(cleanPhoto);
  const pendingText = review('Delayed replacement', textGate.provider);
  const pendingCustomer = customerPhoto({}, customerGate.provider);
  const pendingOwner = ownerPhoto({}, ownerGate.provider);
  await Promise.all([textGate.entered, customerGate.entered, ownerGate.entered]);
  await db.doc(text.reviewTextRuntimePath).update({processingEnabled: false});
  await db.doc(photos.screeningRuntimePath).update({enabled: false, ownerEnabled: false});
  assert.deepEqual(await read(text.reviewTextRuntimePath), releaseRuntime.phases.enforcedPaused[text.reviewTextRuntimePath]);
  assert.deepEqual(await read(photos.screeningRuntimePath), releaseRuntime.phases.enforcedPaused[photos.screeningRuntimePath]);
  textGate.release(); customerGate.release(); ownerGate.release();
  const [heldText, heldCustomer, heldOwner] = await Promise.all([pendingText, pendingCustomer, pendingOwner]);
  assert.equal(heldText.textStatus, 'screening_failed'); assert.equal(heldCustomer.state, 'failed'); assert.equal(heldOwner.state, 'failed');
  assert.equal((await read(`dish_reviews/${original.review.id}`)).notes, 'Approved words');
  assert.equal((await read('dish_rating_aggregates/dish')).ratingCount, 1);
  const customerRow = await row(heldCustomer), ownerRow = await row(heldOwner), textRow = await read(text.textPath(original.review.id));
  assert.equal((await media(customerRow)).status, 403); assert.equal((await media(ownerRow)).status, 403);
  await assert.rejects(useOwner(heldOwner.imageId));
  const before = providerCalls;
  assert.equal((await review('Delayed replacement')).textStatus, 'screening_failed');
  assert.equal(providerCalls, before);
  await db.doc(text.reviewTextRuntimePath).update({processingEnabled: true});
  await db.doc(photos.screeningRuntimePath).update({enabled: true, ownerEnabled: true});
  now = new Date(now.getTime() + 241000);
  const retriedText = await review('Delayed replacement');
  const retriedCustomer = await customerPhoto({retry: true});
  const retriedOwner = await ownerPhoto({retry: true});
  assert.equal(retriedText.textStatus, 'published');
  const recoveredText = await read(text.textPath(original.review.id));
  assert.equal(recoveredText.version, textRow.version);
  assert.equal(recoveredText.createdAt.toMillis(), textRow.createdAt.toMillis());
  assert.equal((await read(`dish_reviews/${original.review.id}`)).notes, 'Delayed replacement');
  assert.equal(retriedCustomer.imageId, heldCustomer.imageId); assert.equal(retriedOwner.imageId, heldOwner.imageId);
  assert.equal(retriedCustomer.state, 'approved'); assert.equal(retriedOwner.state, 'available');
  assert.equal((await row(retriedOwner)).createdAt.toMillis(), ownerRow.createdAt.toMillis());
  assert.equal((await row(retriedOwner)).expiresAt.toMillis(), ownerRow.createdAt.toMillis() + 2592000000);
  assert.equal((await row(retriedCustomer)).createdAt.toMillis(), customerRow.createdAt.toMillis());
  assert.equal(textRow.expiresAt.toMillis() - textRow.createdAt.toMillis(), 604800000);
  assert.equal((await media(await row(retriedOwner))).status, 403);
  await useOwner(retriedOwner.imageId);
  assert.equal((await media(await row(retriedOwner))).status, 200);
});

local('default-OFF is distinct from safe pause; malformed required policy blocks every new screening lane', async () => {
  await db.doc(terms.biteScoreTermsRuntimePath).delete();
  await db.doc(text.reviewTextRuntimePath).delete();
  await db.doc(photos.screeningRuntimePath).delete();
  const legacy = await review();
  assert.equal(legacy.textStatus, 'legacy'); assert.equal(legacy.review.notes, 'Approved words');
  await assert.rejects(customerPhoto()); await assert.rejects(ownerPhoto());
  assert.equal(providerCalls, 0);
  await db.doc(text.reviewTextRuntimePath).set(text.reviewTextRuntimeCandidate);
  assert.equal((await review('Explicit dormant words')).textStatus, 'legacy');
  await db.doc(terms.biteScoreTermsRuntimePath).set({required: true});
  await assert.rejects(review('Malformed Terms'), {code: 'failed-precondition'});
  await db.doc(terms.biteScoreTermsRuntimePath).set({schemaVersion: 1, required: true, version: approvedTerms.version, acceptedVersions: [approvedTerms.version]});
  await accept('customer'); await accept('owner');
  await db.doc(text.reviewTextRuntimePath).set({...textPolicy, processingEnabled: 'malformed'});
  await db.doc(photos.screeningRuntimePath).set({...photoPolicy, failedScreeningRetentionDays: null});
  await assert.rejects(review('Unchecked words'), {code: 'failed-precondition'});
  await assert.rejects(customerPhoto()); await assert.rejects(ownerPhoto());
  assert.equal(providerCalls, 0);
  for (const uid of ['customer', 'owner', 'admin']) {
    const storage = env.authenticatedContext(uid, signed(uid).token).storage(bucketName);
    for (const p of ['bitescore_dishes/dish/images/direct.jpg', 'bitesaver_restaurants/owner/menu_images/direct.jpg']) {
      await assertFails(uploadBytes(ref(storage, p), bytes, {contentType: 'image/png'}));
    }
  }
});

local('screened photo remains shared after personal block and exact report is actionable after its review disappears', async () => {
  await accept('customer');
  const saved = await review();
  const image = await customerPhoto({mode: 'review', reviewId: saved.review.id});
  const source = await read(`bitescore_dish_images/${image.imageId}`);
  await safety.blockReviewerHandler(db, request('other', {targetUserId: 'customer', expectedRevision: 0, supportingReviewId: saved.review.id}));
  assert.equal((await media(await row(image))).status, 200);
  const report = await reports.submitPhotoReportHandler(db, request('other', {imageId: image.imageId, dishId: 'dish', restaurantId: 'restaurant',
    reason: 'Profanity / Inappropriate Content', requestId: 'release-report-exact-photo', reportTargetVersion: reports.photoReportTargetFingerprint(source)}));
  await db.doc(`dish_reviews/${saved.review.id}`).delete();
  const evidence = await read(`review_reports/${report.reportId}`);
  assert.equal(evidence.supportingReviewId, saved.review.id);
  assert.equal(reports.photoReportAdminProjection(report.reportId, evidence, source, {}, {}).imageState, 'available');
  await reports.moderatePhotoReportHandler(db, request('admin', {reportId: report.reportId, imageId: image.imageId, action: 'remove'}));
  assert.equal((await read(`review_reports/${report.reportId}`)).status, 'resolved');
  assert.equal((await read(`bitescore_dish_images/${image.imageId}`)).moderationStatus, 'removed');
  assert.equal((await customerPhoto({mode: 'review', reviewId: saved.review.id}).catch(error => ({code: error.code}))).code, 'failed-precondition');
});
