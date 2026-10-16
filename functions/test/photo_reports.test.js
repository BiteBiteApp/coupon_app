'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {Timestamp} = require('firebase-admin/firestore');
const photos = require('../lib/photo_reports');
const reads = require('../lib/customer_bitescore_reads');
const {currentBiteScorePrimaryImage} = require('../lib/customer_bitescore_search_contract');
const enabled = process.env.RUN_PHOTO_REPORT_EMULATOR === '1';
let db, app, serial = 0;
const source = (extra = {}) => ({id: 'image', dishId: 'dish', restaurantId: 'restaurant', uploadedByUserId: 'uploader', reviewId: 'review', imageUrl: 'https://example.test/photo.jpg', storagePath: 'legacy/unproven.jpg', helpfulCount: 3, notHelpfulCount: 1, sortOrder: 0, createdAt: Timestamp.fromMillis(1000), ...extra});
const auth = (uid = 'reporter', extra = {}) => ({uid, token: {email_verified: false, firebase: {sign_in_provider: 'password'}, ...extra}});
const request = (extra = {}, a = auth()) => ({auth: a, data: {schemaVersion: 1, expectedUserId: 'reporter', imageId: 'image', dishId: 'dish', restaurantId: 'restaurant', reason: 'Profanity / Inappropriate Content', requestId: `photo_request_${String(++serial).padStart(8,'0')}`, reportTargetVersion: photos.photoReportTargetFingerprint(source()), ...extra}});
const action = (reportId, extra = {}, a = auth('admin', {admin: true})) => ({auth: a, data: {schemaVersion: 1, expectedUserId: 'admin', reportId, imageId: 'image', action: 'remove', ...extra}});
const local = (name, fn) => test(name, {skip: !enabled}, fn);
const code = expected => error => error.code === expected;
test.before(async () => {
  if (!enabled) return;
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8792');
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  app = require('firebase-admin/app').initializeApp({projectId: 'demo-photo-report-tests'});
  db = require('firebase-admin/firestore').getFirestore(app);
});
test.beforeEach(async () => {
  if (!enabled) return;
  assert.equal((await fetch('http://127.0.0.1:8792/emulator/v1/projects/demo-photo-report-tests/databases/(default)/documents', {method:'DELETE'})).status, 200);
  for (const [path, value] of Object.entries({
    'private_bitescore_runtime/aggregation': {enabled: true, version: 1, epoch: 'local-photo-test'},
    'bitescore_restaurants/restaurant': {id: 'restaurant', name: 'Restaurant', isActive: true},
    'bitescore_dishes/dish': {id: 'dish', name: 'Food', restaurantId: 'restaurant', isActive: true, imageCount: 2, primaryImageId: 'image', primaryImageUrl: source().imageUrl},
    'dish_reviews/review': {userId: 'uploader', dishId: 'dish', restaurantId: 'restaurant', headline: 'Keep this', overallImpression: 8},
    'dish_rating_aggregates/dish': {ratingCount: 1, overallBiteScore: 8},
    'bitescore_dish_images/image': source(),
    'bitescore_dish_images/other': source({id:'other', imageUrl:'https://example.test/other.jpg', storagePath:'other.jpg', helpfulCount:1, reviewId:null}),
    'bitescore_dish_image_votes/vote': {userId:'voter', imageId:'image', dishId:'dish', restaurantId:'restaurant', voteType:'helpful'},
  })) await db.doc(path).set(value);
  await reads.reconcileCustomerBiteScoreImage(db, 'other');
  await reads.reconcileCustomerBiteScoreImage(db, 'image');
});
test.after(async () => {if (app) await app.delete();});

test('soft moderation removes public projection, not raw content; stale primary is suppressed', () => {
  assert.equal(reads.customerBiteScoreImage('image', source({moderationStatus:'removed'}), 'dish', 'restaurant'), null);
  const valid = reads.customerBiteScoreReportableImage('image', source(), 'dish', 'restaurant');
  assert.match(valid.reportTargetVersion, /^[a-f0-9]{64}$/);
  assert.equal('uploadedByUserId' in valid, false); assert.equal('storagePath' in valid, false);
  assert.deepEqual(currentBiteScorePrimaryImage({id:'dish', primaryImageUrl:'old'}, {primaryImageUrl:'new'}), {id:'dish'});
  assert.deepEqual(currentBiteScorePrimaryImage({id:'dish', primaryImageUrl:'same'}, {primaryImageUrl:'same'}), {id:'dish',primaryImageUrl:'same'});
});
local('authenticated unverified report captures exact server identity, minimal evidence, never removes automatically', async () => {
  const saved = await photos.submitPhotoReportHandler(db, request());
  const report = (await db.doc('review_reports/'+saved.reportId).get()).data();
  assert.equal(report.reportingUserId, 'reporter'); assert.equal(report.reportedUserId, 'uploader');
  assert.equal(report.imageId, 'image'); assert.equal(report.supportingReviewId, 'review');
  assert.equal('reviewId' in report, false); assert.equal('imageUrl' in report, false); assert.equal('storagePath' in report, false);
  assert.ok(report.createdAt instanceof Timestamp); assert.equal(report.status,'pending');
  assert.equal((await db.doc('bitescore_dish_images/image').get()).get('moderationStatus'), undefined);
});
local('forgery, anonymous, malformed reasons and mismatched parents/version are rejected', async () => {
  for (const a of [null, auth('reporter',{firebase:{sign_in_provider:'anonymous'}})]) await assert.rejects(photos.submitPhotoReportHandler(db,request({},a)),code('unauthenticated'));
  await assert.rejects(photos.submitPhotoReportHandler(db,request({},auth('different'))),code('permission-denied'));
  for (const extra of [{reportingUserId:'forged'},{reportedUserId:'forged'},{evidence:{}},{reason:'x'.repeat(2001)},{requestId:'short'},{imageId:'../bad'},{reportTargetVersion:'bad'}]) await assert.rejects(photos.submitPhotoReportHandler(db,request(extra)),code('invalid-argument'));
  for (const extra of [{imageId:'missing'},{dishId:'wrong'},{restaurantId:'wrong'}]) await assert.rejects(photos.submitPhotoReportHandler(db,request(extra)),code('not-found'));
  await assert.rejects(photos.submitPhotoReportHandler(db,request({reportTargetVersion:'0'.repeat(64)})),code('failed-precondition'));
  await db.doc('bitescore_dishes/dish').update({restaurantId:'wrong'});
  await assert.rejects(photos.submitPhotoReportHandler(db,request()),code('not-found'));
  assert.equal((await db.collection('review_reports').get()).size,0);
});
local('parallel submissions share one pending case; exact retry survives dismissal; new request can report again', async () => {
  const requests = Array.from({length:5},()=>request());
  const results = await Promise.all(requests.map(r=>photos.submitPhotoReportHandler(db,r)));
  assert.equal(new Set(results.map(r=>r.reportId)).size,1); assert.equal(results.filter(r=>r.submitted).length,1);
  const id=results[0].reportId;
  await photos.moderatePhotoReportHandler(db,action(id,{action:'dismiss'}));
  assert.equal((await photos.submitPhotoReportHandler(db,requests[0])).reportId,id);
  assert.notEqual((await photos.submitPhotoReportHandler(db,request())).reportId,id);
  await assert.rejects(photos.submitPhotoReportHandler(db,{...requests[0],data:{...requests[0].data,reason:'Spam'}}),code('already-exists'));
});
local('rate admission is serialized and exact network retries are free', async () => {
  const first=request(); await photos.submitPhotoReportHandler(db,first,1000000);
  for(let i=1;i<12;i++)await photos.submitPhotoReportHandler(db,request(),1000001);
  await photos.submitPhotoReportHandler(db,first,1000002);
  await assert.rejects(photos.submitPhotoReportHandler(db,request(),1059999),code('resource-exhausted'));
  await photos.submitPhotoReportHandler(db,request(),1060000);
});
local('deleted supporting review leaves independent photo case and preview actionable', async () => {
  const saved=await photos.submitPhotoReportHandler(db,request());
  await db.doc('dish_reviews/review').delete();
  const report=(await db.doc('review_reports/'+saved.reportId).get()).data();
  assert.equal((await db.collection('review_reports').where('reviewId','==','review').get()).size,0);
  const view=photos.photoReportAdminProjection(saved.reportId,report,source(),{name:'Food'},{name:'Restaurant'});
  assert.equal(view.imageState,'available'); assert.equal(view.imageId,'image'); assert.equal(view.supportingReviewId,'review');
  assert.equal(view.imageUrl,source().imageUrl); assert.equal('reportingUserId' in view,false);
  await photos.moderatePhotoReportHandler(db,action(saved.reportId));
  assert.equal((await db.doc('review_reports/'+saved.reportId).get()).get('status'),'resolved');
});
local('Admin-only exact removal preserves other images, all votes/reviews/ratings and repairs primary/count once', async () => {
  const saved=await photos.submitPhotoReportHandler(db,request());
  const keepPaths=['bitescore_dish_images/other','dish_reviews/review','dish_rating_aggregates/dish','bitescore_dish_image_votes/vote','bitescore_restaurants/restaurant'];
  const before=await Promise.all(keepPaths.map(async p=>(await db.doc(p).get()).data()));
  await assert.rejects(photos.moderatePhotoReportHandler(db,action(saved.reportId,{},auth('admin'))),code('permission-denied'));
  await assert.rejects(photos.moderatePhotoReportHandler(db,action(saved.reportId,{imageId:'other'})),code('not-found'));
  await Promise.all([photos.moderatePhotoReportHandler(db,action(saved.reportId)),photos.moderatePhotoReportHandler(db,action(saved.reportId))]);
  const image=(await db.doc('bitescore_dish_images/image').get()).data();
  assert.equal(image.moderationStatus,'removed'); assert.equal(image.storagePath,source().storagePath); assert.equal(image.helpfulCount,3);
  const dish=(await db.doc('bitescore_dishes/dish').get()).data(); assert.equal(dish.imageCount,1); assert.equal(dish.primaryImageId,'other');
  const state=createHash('sha256').update('image').digest('hex'); assert.equal((await db.doc('private_bitescore_image_state/'+state).get()).exists,false);
  assert.deepEqual(await Promise.all(keepPaths.map(async p=>(await db.doc(p).get()).data())),before);
  await assert.rejects(photos.submitPhotoReportHandler(db,request()),code('not-found'));
});
local('replacement cannot inherit a stale report or removal; new display version gets a new case', async () => {
  const first=await photos.submitPhotoReportHandler(db,request());
  const replacement=source({imageUrl:'https://example.test/replacement.jpg'});
  await db.doc('bitescore_dish_images/image').set(replacement);
  await assert.rejects(photos.submitPhotoReportHandler(db,request()),code('failed-precondition'));
  await assert.rejects(photos.moderatePhotoReportHandler(db,action(first.reportId)),code('failed-precondition'));
  const report=(await db.doc('review_reports/'+first.reportId).get()).data();
  assert.equal(photos.photoReportAdminProjection(first.reportId,report,replacement,{},{}).imageState,'changed');
  const next=await photos.submitPhotoReportHandler(db,request({reportTargetVersion:photos.photoReportTargetFingerprint(replacement)}));
  assert.notEqual(next.reportId,first.reportId);
});
local('missing photo is truthful and resolvable; dismissed report cannot later remove content', async () => {
  const saved=await photos.submitPhotoReportHandler(db,request());
  await db.doc('bitescore_dish_images/image').delete();
  const report=(await db.doc('review_reports/'+saved.reportId).get()).data();
  const view=photos.photoReportAdminProjection(saved.reportId,report,undefined,undefined,undefined);
  assert.equal(view.imageState,'unavailable'); assert.equal(view.imageUrl,null);
  await photos.moderatePhotoReportHandler(db,action(saved.reportId));
  assert.equal((await db.doc('bitescore_dishes/dish').get()).get('imageCount'),1);
});
local('deletion fences protect reporter/uploader/Admin and runtime must be active', async () => {
  const saved=await photos.submitPhotoReportHandler(db,request());
  for(const uid of ['reporter','uploader','admin']) {
    await db.doc('private_account_deletions/'+uid).set({});
    await assert.rejects(photos.moderatePhotoReportHandler(db,action(saved.reportId)),code('failed-precondition'));
    if(uid!=='admin') await assert.rejects(photos.submitPhotoReportHandler(db,request()),code('failed-precondition'));
    await db.doc('private_account_deletions/'+uid).delete();
  }
  await db.doc('private_bitescore_runtime/aggregation').update({enabled:false});
  await assert.rejects(photos.moderatePhotoReportHandler(db,action(saved.reportId)),code('failed-precondition'));
  assert.equal((await db.doc('bitescore_dish_images/image').get()).get('moderationStatus'),undefined);
});
for (const retiredParent of [null, 'inactive restaurant', 'merged dish', 'deleted dish', 'deleted restaurant']) {
local(`interrupted removal retries before resolution with ${retiredParent ?? 'live parents'}`, async () => {
 const saved=await photos.submitPhotoReportHandler(db,request());
 let lost=false;
 const interrupted=new Proxy(db,{get(target,key){if(key==='runTransaction')return async fn=>{
   const result=await target.runTransaction(fn);
   if(!lost&&result?.reportId===saved.reportId&&result?.status==='resolved'){lost=true;throw new Error('injected interrupted response');}
   return result;
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(photos.moderatePhotoReportHandler(interrupted,action(saved.reportId)),/injected/);
 assert.equal((await db.doc('bitescore_dish_images/image').get()).get('moderationStatus'),'removed');
 assert.equal((await db.doc('review_reports/'+saved.reportId).get()).get('status'),'pending');
 await assert.rejects(photos.moderatePhotoReportHandler(db,action(saved.reportId,{action:'dismiss'})),code('failed-precondition'));
 if(retiredParent==='inactive restaurant') await db.doc('bitescore_restaurants/restaurant').update({isActive:false});
 if(retiredParent==='merged dish') await db.doc('bitescore_dishes/dish').update({mergedIntoDishId:'replacement'});
 if(retiredParent==='deleted dish') await db.doc('bitescore_dishes/dish').delete();
 if(retiredParent==='deleted restaurant') await db.doc('bitescore_restaurants/restaurant').delete();
 await photos.moderatePhotoReportHandler(db,action(saved.reportId));
 assert.equal((await db.doc('review_reports/'+saved.reportId).get()).get('status'),'resolved');
 if(!retiredParent) assert.equal((await db.doc('bitescore_dishes/dish').get()).get('primaryImageId'),'other');
});
}
local('moderation racing ahead of the create projection repairs count without losing other photos', async () => {
 const state=createHash('sha256').update('image').digest('hex'),dishState=createHash('sha256').update('dish').digest('hex');
 await db.doc('private_bitescore_image_state/'+state).delete();
 await db.doc('private_bitescore_read_generations/'+dishState).update({publicImageCount:1});
 const saved=await photos.submitPhotoReportHandler(db,request());
 await photos.moderatePhotoReportHandler(db,action(saved.reportId));
 assert.equal((await db.doc('bitescore_dishes/dish').get()).get('imageCount'),1);
 assert.equal((await db.doc('bitescore_dish_images/other').get()).exists,true);
});

local('real callable wrappers preserve secret-free runtime and enforce authority before operations', async () => {
 const runtime=require('../lib/customer_bitescore_runtime');
 for(const name of ['submitPhotoReport','moderatePhotoReport']) {
   const endpoint=runtime[name].__endpoint;
   assert.equal(endpoint.serviceAccountEmail,'bitescore-customer-runtime@coupon-app-29446.iam.gserviceaccount.com');
   assert.equal(endpoint.timeoutSeconds,60);assert.equal(endpoint.secretEnvironmentVariables,undefined);
 }
 await assert.rejects(runtime.submitPhotoReport.run(request({},null)),code('unauthenticated'));
 const saved=await runtime.submitPhotoReport.run(request());
 await assert.rejects(runtime.moderatePhotoReport.run(action(saved.reportId,{},auth('admin'))),code('permission-denied'));
 const result=await runtime.moderatePhotoReport.run(action(saved.reportId));
 assert.equal(result.status,'resolved');
});
