'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {MemoryFirestore} = require('./helpers/bitescore_read_fixture');
const {getCustomerPostingStatusHandler: own, getAdminPostingRestrictionHandler: inspect, setAdminPostingRestrictionHandler: change} = require('../lib/posting_restrictions');
const {postingRestrictionPath: path, requirePostingAllowed, postingRestrictionStatus} = require('../lib/posting_restriction_guard');
const {photoReportTargetFingerprint} = require('../lib/photo_reports');
const now = Date.parse('2026-10-16T21:00:00Z'), day = 86400000;
const auth = (uid = 'admin', admin = true) => ({uid, token: {admin, email_verified: true, firebase: {sign_in_provider: 'password'}}});
const request = (extra = {}, identity = auth()) => ({auth: identity, data: {schemaVersion: 1, expectedUserId: identity?.uid ?? '', ...extra}});
const action = (extra = {}, identity) => request({reportId: 'report', targetUserId: 'author', expectedRevision: 0, action: '7d', requestId: 'request-0000000001', ...extra}, identity);
function fixture() { const db = new MemoryFirestore(); db.values.set('review_reports/report', {reviewId: 'review', dishId: 'dish', restaurantId: 'restaurant'}); db.values.set('dish_reviews/review', {userId: 'author', dishId: 'dish', restaurantId: 'restaurant', notes: 'damn good'}); return db; }
for (const [kind, days] of [['7d', 7], ['14d', 14], ['indefinite', null]]) test(`${kind}: trusted time, expiry and one bounded audit; no content/score mutations`, async () => {
  const db = fixture(), before = [...db.values];
  const result = await change(db, action({action: kind}), () => now);
  assert.equal(result.status, 'active'); assert.equal(result.endsAtMillis, days === null ? null : now + days * day);
  const record = db.values.get(path('author')); assert.equal(record.issuedByUid, 'admin'); assert.equal(record.targetUserId, 'author');
  for (const [p, d] of before) assert.deepEqual(db.values.get(p), d);
  assert.equal(db.values.size, before.length + 1);
  assert.throws(() => requirePostingAllowed(record, now), e => e.code === 'permission-denied' && e.details.reason === 'posting-restricted');
  if (days !== null) { assert.throws(() => requirePostingAllowed(record, now + days * day - 1)); requirePostingAllowed(record, now + days * day); }
  else assert.throws(() => requirePostingAllowed(record, now + 1000 * day));
});
test('absent state permits posting; malformed server state fails closed', () => {
  requirePostingAllowed(undefined, now);
  for (const record of [{}, {schemaVersion: 1}, {schemaVersion: 1, revision: 1, kind: '7d', startsAt: new Date(now), endsAt: null, releasedAt: null}]) assert.throws(() => postingRestrictionStatus(record, now), {code: 'failed-precondition'});
});
test('release after source/report removal; retry does not restart a restriction; stale retry cannot undo newer action', async () => {
  const db = fixture(); const input = action({action: 'indefinite'});
  const first = await change(db, input, () => now); assert.deepEqual(await change(db, input, () => now + day), first);
  db.values.delete('review_reports/report'); db.values.delete('dish_reviews/review');
  assert.equal((await inspect(db, request({reportId: null, targetUserId: 'author'}), () => now)).status, 'active');
  const release = action({action: 'release', reportId: null, expectedRevision: 1, requestId: 'request-0000000002'});
  assert.equal((await change(db, release, () => now + 100)).status, 'released');
  requirePostingAllowed(db.values.get(path('author')), now + 101);
  assert.equal(db.values.get(path('author')).releasedByUid, 'admin');
  await assert.rejects(change(db, input, () => now + 200), {code: 'failed-precondition'});
});
test('simultaneous admin decisions with same observed revision yield one winner and refresh conflict', async () => {
  const db = fixture(); const results = await Promise.allSettled(['7d','14d','indefinite'].map((kind,i) => change(db, action({action: kind, requestId: `request-000000000${i}`}), () => now)));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(db.values.get(path('author')).revision, 1);
});
test('nonadmins, anonymous, forged target and account switch are rejected before mutation', async () => {
  for (const who of [null, auth('customer', false), {uid:'admin',token:{admin:true,firebase:{sign_in_provider:'anonymous'}}}]) {
    const db=fixture(); await assert.rejects(change(db,action({},who))); await assert.rejects(inspect(db,request({reportId:'report',targetUserId:null},who))); assert.equal(db.values.size,2);
  }
  const db=fixture(); await assert.rejects(change(db,action({expectedUserId:'previous-admin'})),{code:'permission-denied'});
  await assert.rejects(change(db,action({targetUserId:'different-author'})),{code:'failed-precondition'});
  await assert.rejects(own(db,request({},auth('author',false)).data));
});
test('customer status contains no operator, report, request, or other-user data', async () => {
  const db=fixture(); await change(db,action(),()=>now);
  const result=await own(db,request({},auth('author',false)),()=>now);
  assert.equal(result.status,'active'); for(const field of ['issuedByUid','targetUserId','sourceReportId','lastRequestId','lastRequestFingerprint'])assert.equal(Object.hasOwn(result,field),false);
  await assert.rejects(own(db,request({targetUserId:'other'},auth('author',false))),{code:'invalid-argument'});
  assert.equal((await own(db,request({},auth('other',false)),()=>now)).status,'none');
});
test('legacy review report requires exact extant author and matching parents; never names', async () => {
  for(const changeData of [{userId:'',displayName:'author'},{dishId:'other'},{restaurantId:'other'}]) {
    const db=fixture();db.values.set('dish_reviews/review',{...db.values.get('dish_reviews/review'),...changeData}); await assert.rejects(inspect(db,request({reportId:'report',targetUserId:null})));
  }
  const db=fixture();db.values.delete('dish_reviews/review');await assert.rejects(inspect(db,request({reportId:'report',targetUserId:null})),{code:'failed-precondition'});
});
test('trusted reviewer and exact photo evidence resolve authors; changed/missing photos fail safely', async () => {
  const db=fixture();db.values.set('review_reports/reviewer',{schemaVersion:1,reportScope:'reviewer',reportedUserId:'author',evidence:{publicDisplayName:'someone'}});
  assert.equal((await inspect(db,request({reportId:'reviewer',targetUserId:null}))).targetUserId,'author');
  const image={id:'photo',uploadedByUserId:'author',dishId:'dish',restaurantId:'restaurant',storagePath:'path',imageUrl:'https://example.test/image',createdAt:new Date(now)};
  db.values.set('bitescore_dish_images/photo',image);db.values.set('review_reports/photo',{schemaVersion:1,reportScope:'photo',imageId:'photo',dishId:'dish',restaurantId:'restaurant',reportedUserId:'author',targetFingerprint:photoReportTargetFingerprint(image)});
  assert.equal((await inspect(db,request({reportId:'photo',targetUserId:null}))).targetUserId,'author');
  db.values.set('bitescore_dish_images/photo',{...image,uploadedByUserId:'replacement'});await assert.rejects(inspect(db,request({reportId:'photo',targetUserId:null})),{code:'failed-precondition'});
  db.values.delete('bitescore_dish_images/photo');await assert.rejects(inspect(db,request({reportId:'photo',targetUserId:null})),{code:'failed-precondition'});
});
test('actor/target deletion fences prevent restrictions from recreating cleaned private state', async () => {
  for(const uid of ['admin','author']) {const db=fixture();db.values.set(`private_account_deletions/${uid}`,{});await assert.rejects(change(db,action()),{code:'failed-precondition'});assert.equal(db.values.has(path('author')),false);}
});
