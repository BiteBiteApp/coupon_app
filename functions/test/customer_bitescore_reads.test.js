"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {GeoPoint,Timestamp} = require("firebase-admin/firestore");
const {OpaqueCursorCodec} = require("../lib/opaque_cursor.js");
const reads = require("../lib/customer_bitescore_reads.js");
const {buildBiteScoreRestaurantIndex, buildBiteScoreDishIndex} = require("../lib/search_index_builders.js");
const {canonicalRestaurantGeohash} = require("../lib/restaurant_geo_helpers.js");
const hash = (v) => createHash("sha256").update(v).digest("hex");
const review = (n, overrides = {}) => ({dishId: "dish", restaurantId: "restaurant", userId: `user${n}`,
  headline: n % 2 ? "Written review" : "", notes: "", overallImpression: 8, tastinessScore: 8,
  qualityScore: 8, valueScore: 8, overallBiteScore: n % 7 * 10, createdAt: new Date(1000 + n), updatedAt: new Date(1000 + n), ...overrides});
const {MemoryFirestore, fixture} = require("./helpers/bitescore_read_fixture.js");

test('review DTO uses exact source identity and established public visibility allowlist', () => {
  const source=review(1,{id:'wrong',ownerUserId:'private',stripeCustomerId:'private',internalToken:'private'});
  const result=reads.buildCustomerBiteScoreReview('actual',source);
  assert.equal(result.review.id,'actual');
  for(const key of ['ownerUserId','stripeCustomerId','internalToken']) assert.equal(JSON.stringify(result).includes(key),false);
  for(const hidden of [{isPublic:false},{isHidden:true},{hidden:true},{deleted:true},{rejected:true},{status:' HIDDEN '},{status:'deleted'},{status:'rejected'}]) assert.equal(reads.buildCustomerBiteScoreReview('actual',{...source,...hidden}).publicVisible,false);
  assert.equal(reads.buildCustomerBiteScoreReview('actual',{...source,status:'approved'}).publicVisible,true);
  assert.equal(reads.buildCustomerBiteScoreReview(' actual',source),null);
});

test('trusted review and feedback projection is duplicate-safe and follows current source across delayed events', async () => {
  const {db}=fixture(); const key=hash('r');
  db.values.set('dish_reviews/r',review(1));
  await Promise.all([reads.reconcileCustomerBiteScoreReview(db,'r'),reads.reconcileCustomerBiteScoreReview(db,'r')]);
  assert.equal(db.values.get(reads.customerBiteScoreReviewerStats+'/'+hash('user1')).publicReviewCount,1);
  db.values.set('review_feedback_votes/v',{reviewId:'r',voteType:'helpful'});
  await Promise.all([reads.reconcileCustomerBiteScoreFeedback(db,'v'),reads.reconcileCustomerBiteScoreFeedback(db,'v')]);
  assert.equal(db.values.get(reads.customerBiteScoreReviewIndex+'/'+key).helpfulScore,1);
  db.values.set('review_feedback_votes/v',{reviewId:'r',voteType:'not_helpful'});
  await reads.reconcileCustomerBiteScoreFeedback(db,'v');
  assert.equal(db.values.get(reads.customerBiteScoreReviewIndex+'/'+key).helpfulScore,-1);
  db.values.delete('review_feedback_votes/v'); await reads.reconcileCustomerBiteScoreFeedback(db,'v'); await reads.reconcileCustomerBiteScoreFeedback(db,'v');
  assert.equal(db.values.get(reads.customerBiteScoreReviewIndex+'/'+key).helpfulScore,0);
  db.values.set('dish_reviews/r',review(1,{isHidden:true})); await reads.reconcileCustomerBiteScoreReview(db,'r');
  assert.equal(db.values.get(reads.customerBiteScoreReviewerStats+'/'+hash('user1')).publicReviewCount,0);
  db.values.set('dish_reviews/r',review(1)); await reads.reconcileCustomerBiteScoreReview(db,'r');
  assert.equal(db.values.get(reads.customerBiteScoreReviewerStats+'/'+hash('user1')).publicReviewCount,1);
  db.values.delete('dish_reviews/r'); await reads.reconcileCustomerBiteScoreReview(db,'r');
  assert.equal(db.values.has(reads.customerBiteScoreReviewIndex+'/'+key),false);
});

for (const sort of reads.customerBiteScoreReviewSorts) test(`reviews apply global ${sort} before paging; 63 records no repeats`, async () => {
  const {db,context}=fixture();
  const expected=[];
  for(let n=0;n<63;n++) {const rid=`r${n.toString().padStart(3,'0')}`;db.values.set('dish_reviews/'+rid,review(n));await reads.reconcileCustomerBiteScoreReview(db,rid);expected.push(reads.buildCustomerBiteScoreReview(rid,review(n)));}
  expected.sort((a,b)=>{
    if(sort==='Most helpful') return Number(b.writtenText)-Number(a.writtenText)||b.helpfulScore-a.helpfulScore||b.createdAtMs-a.createdAtMs||a.reviewId.localeCompare(b.reviewId);
    if(sort==='Most recent') return b.createdAtMs-a.createdAtMs||a.reviewId.localeCompare(b.reviewId);
    return (sort==='Highest score'?-1:1)*(a.overallBiteScore-b.overallBiteScore)||b.createdAtMs-a.createdAtMs||a.reviewId.localeCompare(b.reviewId);
  });
  const ids=[]; let cursor;
  do {const page=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort,cursor},context); assert.ok(page.items.length<=25); ids.push(...page.items.map((i)=>i.review.id));cursor=page.nextCursor;}while(cursor);
  assert.deepEqual(ids,expected.map((i)=>i.reviewId)); assert.ok(db.limits.every((n)=>n<=26));
});

test('review cursors reject another actor, changed order, and generation changes; stale hidden text is excluded', async () => {
  const {db,context}=fixture(); for(let n=0;n<30;n++){db.values.set('dish_reviews/r'+n,review(n));await reads.reconcileCustomerBiteScoreReview(db,'r'+n);}
  const first=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent'},context);
  await assert.rejects(reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent',cursor:first.nextCursor},{...context,actorId:'other'}));
  await assert.rejects(reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Highest score',cursor:first.nextCursor},context));
  db.values.set('dish_reviews/r0',review(0,{notes:'new'}));await reads.reconcileCustomerBiteScoreReview(db,'r0');
  await assert.rejects(reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent',cursor:first.nextCursor},context));
  db.values.set('dish_reviews/r29',review(29,{isHidden:true}));
  const current=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent'},context);
  assert.ok(!current.items.some((item)=>item.review.id==='r29'));
});

test('detail allows only public DTO and server-confirmed owner metadata; hidden roots override stale index',async()=>{
  const {db,context}=fixture(); const detail=await reads.getCustomerBiteScoreDetailHandler(db,{kind:'dish',id:'dish'},context);
  assert.equal(detail.canManage,false);assert.equal(detail.dish.sourceDocumentId,'dish');assert.equal(JSON.stringify(detail).includes('ownerUserId'),false);
  const owner=await reads.getCustomerBiteScoreDetailHandler(db,{kind:'restaurant',id:'restaurant'},{...context,userId:'owner'});assert.equal(owner.canManage,true);
  db.values.set('bitescore_dishes/dish',{...db.values.get('bitescore_dishes/dish'),isActive:false});
  await assert.rejects(reads.getCustomerBiteScoreDetailHandler(db,{kind:'dish',id:'dish'},context));
});

test('image display DTO excludes uploader and internal storage path',()=>{
  const image=reads.customerBiteScoreImage('image',{dishId:'dish',restaurantId:'restaurant',imageUrl:'https://example.test/image.jpg',uploadedByUserId:'secret',storagePath:'private/path',helpfulCount:2},'dish','restaurant');
  assert.equal(image.helpfulCount,2);assert.equal('uploadedByUserId' in image,false);assert.equal('storagePath' in image,false);
  assert.equal(reads.customerBiteScoreImage('image',{dishId:'elsewhere'},'dish','restaurant'),null);
});


test('tied reviews preserve Dart UTF16 identity order including long distinct IDs', async()=>{
  const {db,context}=fixture();
  const ids=['r😀','r\ue000','x'.repeat(1498)+'a','x'.repeat(1498)+'b'];
  for(const rid of ids){db.values.set('dish_reviews/'+rid,review(1));await reads.reconcileCustomerBiteScoreReview(db,rid);}
  const page=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most helpful'},{...context,userId:'signed-viewer'});
  assert.deepEqual(page.items.map((v)=>v.review.id),[...ids].sort());
});

test('direct review target beyond initial25 anchors a bounded globallyordered page',async()=>{
  const {db,context}=fixture();
  for(let n=0;n<65;n++){db.values.set('dish_reviews/r'+n,review(n));await reads.reconcileCustomerBiteScoreReview(db,'r'+n);}
  const first=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent'},context);
  assert.ok(!first.items.some((v)=>v.review.id==='r12'));
  const target=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent',targetReviewId:'r12'},context);
  assert.equal(target.items[0].review.id,'r12');assert.equal(target.items.length,13);
  await assert.rejects(reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent',targetReviewId:'r12',cursor:first.nextCursor},context));
});

test('accepted long review text remains public written text and contributes helpful ordering',()=>{
 const notes='n'.repeat(10001);const result=reads.buildCustomerBiteScoreReview('long',review(2,{notes}));
 assert.equal(result.review.notes,notes);assert.equal(result.writtenText,true);
});

test('images preserve global helpful, sort, time and UTF16 order across25item pages; primary/count converge',async()=>{
 const {db,context}=fixture();const expected=[];db.values.set('private_bitescore_runtime/aggregation',{enabled:true,version:1,epoch:'test'});
 for(let i=0;i<63;i++){
  const imageId='image'+String(i).padStart(3,'0');
  const source={dishId:'dish',restaurantId:'restaurant',uploadedByUserId:'private',storagePath:'private/path',imageUrl:'https://example.test/'+i+'.jpg',helpfulCount:i%9,sortOrder:i%3,createdAt:new Date(1000+i)};
  db.values.set('bitescore_dish_images/'+imageId,source);await reads.reconcileCustomerBiteScoreImage(db,imageId);
  expected.push({...source,id:imageId});
 }
 expected.sort((a,b)=>b.helpfulCount-a.helpfulCount||a.sortOrder-b.sortOrder||a.createdAt-b.createdAt||(a.id<b.id?-1:1));
 const ids=[];let cursor;do{const page=await reads.pageCustomerBiteScoreImagesHandler(db,{dishId:'dish',cursor},context);ids.push(...page.items.map(v=>v.id));cursor=page.nextCursor;}while(cursor);
 assert.deepEqual(ids,expected.map(v=>v.id));
 assert.equal(db.values.get('bitescore_dishes/dish').imageCount,63);
 assert.equal(db.values.get('bitescore_dishes/dish').primaryImageId,expected[0].id);
 await reads.reconcileCustomerBiteScoreImage(db,expected[0].id);
 assert.equal(db.values.get('bitescore_dishes/dish').imageCount,63);
 db.values.delete('bitescore_dish_images/'+expected[0].id);await reads.reconcileCustomerBiteScoreImage(db,expected[0].id);
 assert.equal(db.values.get('bitescore_dishes/dish').imageCount,62);
 assert.equal(db.values.get('bitescore_dishes/dish').primaryImageId,expected[1].id);
 const first=await reads.pageCustomerBiteScoreImagesHandler(db,{dishId:'dish'},context);
 const latest=db.values.get('bitescore_dish_images/'+expected[1].id);latest.helpfulCount=100;
 await assert.rejects(reads.pageCustomerBiteScoreImagesHandler(db,{dishId:'dish'},context));
 await reads.reconcileCustomerBiteScoreImage(db,expected[1].id);
 await assert.rejects(reads.pageCustomerBiteScoreImagesHandler(db,{dishId:'dish',cursor:first.nextCursor},context));
 assert.ok(db.limits.every(n=>n<=26));
});

test('review photo uses global earliest sort/time/UTF16 order independently of gallery helpful order',async()=>{
 const {db,context}=fixture();db.values.set('dish_reviews/r',review(1));await reads.reconcileCustomerBiteScoreReview(db,'r');
 for(const [imageId,sortOrder,helpfulCount]of [['first',-1,0],['popular',5,100]]){
  db.values.set('bitescore_dish_images/'+imageId,{dishId:'dish',restaurantId:'restaurant',reviewId:'r',imageUrl:'https://example.test/'+imageId+'.jpg',sortOrder,helpfulCount,createdAt:new Date(1)});
  await reads.reconcileCustomerBiteScoreImage(db,imageId);
 }
 const reviews=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most helpful'},context);
 assert.equal(reviews.items[0].image.id,'first');
 const images=await reads.pageCustomerBiteScoreImagesHandler(db,{dishId:'dish'},context);assert.equal(images.items[0].id,'popular');
});


test('disabled image runtime indexes safely without replacing legacy primary/count',async()=>{
 const {db}=fixture();const original={...db.values.get('bitescore_dishes/dish'),primaryImageId:'legacy',primaryImageUrl:'https://example.test/legacy.jpg',imageCount:42};
 db.values.set('bitescore_dishes/dish',original);
 db.values.set('bitescore_dish_images/img',{dishId:'dish',restaurantId:'restaurant',imageUrl:'https://example.test/img.jpg'});
 await reads.reconcileCustomerBiteScoreImage(db,'img');
 assert.deepEqual(db.values.get('bitescore_dishes/dish'),original);
 assert.ok(db.values.has(reads.customerBiteScoreImageIndex+'/'+hash('img')));
});

test('review/image reordered stored keys are idempotent and submillisecond timestamps retain ordering',async()=>{
 const {db,context}=fixture();
 for(const [rid,nanos] of [['a',1000],['b',9000]]){db.values.set('dish_reviews/'+rid,review(1,{createdAt:new Timestamp(1,nanos)}));await reads.reconcileCustomerBiteScoreReview(db,rid);}
 const indexKey=reads.customerBiteScoreReviewIndex+'/'+hash('a');const index=db.values.get(indexKey);db.values.set(indexKey,Object.fromEntries(Object.entries(index).reverse()));
 const before=JSON.stringify([...db.values.entries()].filter(([path])=>path.startsWith(reads.customerBiteScoreReadGeneration+'/')));
 await reads.reconcileCustomerBiteScoreReview(db,'a');
 assert.equal(JSON.stringify([...db.values.entries()].filter(([path])=>path.startsWith(reads.customerBiteScoreReadGeneration+'/'))),before);
 const reviews=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent'},context);assert.deepEqual(reviews.items.map(i=>i.review.id),['b','a']);
 for(const [imageId,nanos]of [['z',1000],['a',9000],['i😀',99000],['i\ue000',99000]]){db.values.set('bitescore_dish_images/'+imageId,{dishId:'dish',restaurantId:'restaurant',imageUrl:'https://example.test/img.jpg',createdAt:new Timestamp(1,nanos)});await reads.reconcileCustomerBiteScoreImage(db,imageId);}
 const images=await reads.pageCustomerBiteScoreImagesHandler(db,{dishId:'dish'},context);assert.deepEqual(images.items.map(i=>i.id),['z','a','i😀','i\ue000']);
 const imageKey=reads.customerBiteScoreImageIndex+'/'+hash('z');db.values.set(imageKey,Object.fromEntries(Object.entries(db.values.get(imageKey)).reverse()));
 const generation=db.values.get(reads.customerBiteScoreReadGeneration+'/'+hash('dish')).imageGeneration;
 await reads.reconcileCustomerBiteScoreImage(db,'z');assert.equal(db.values.get(reads.customerBiteScoreReadGeneration+'/'+hash('dish')).imageGeneration,generation);
});

test('public helpful totals follow feedback, author reassignment, and visibility',async()=>{
 const {db}=fixture();db.values.set('dish_reviews/r',review(1));await reads.reconcileCustomerBiteScoreReview(db,'r');
 db.values.set('review_feedback_votes/v',{reviewId:'r',voteType:'helpful'});await reads.reconcileCustomerBiteScoreFeedback(db,'v');
 const stats=user=>db.values.get(reads.customerBiteScoreReviewerStats+'/'+hash(user));assert.equal(stats('user1').publicHelpfulVotesReceived,1);
 db.values.set('dish_reviews/r',review(2));await reads.reconcileCustomerBiteScoreReview(db,'r');assert.equal(stats('user1').publicHelpfulVotesReceived,0);assert.equal(stats('user2').publicHelpfulVotesReceived,1);
 db.values.set('dish_reviews/r',review(2,{isHidden:true}));await reads.reconcileCustomerBiteScoreReview(db,'r');assert.equal(stats('user2').publicHelpfulVotesReceived,0);
 db.values.delete('review_feedback_votes/v');await reads.reconcileCustomerBiteScoreFeedback(db,'v');assert.equal(stats('user2').publicHelpfulVotesReceived,0);
 db.values.set('dish_reviews/r',review(2));await reads.reconcileCustomerBiteScoreReview(db,'r');assert.equal(stats('user2').publicHelpfulVotesReceived,0);
});


test('trusted image writes wait for dish/restaurant/proposal locks without committing accounting ahead',async()=>{
 const {ratingDishOperationLockPath,ratingRestaurantOperationLockPath}=require('../lib/rating_destructive_job_contract.js');
 const {dishMergeReviewLockPath}=require('../lib/dish_proposal_private_contract.js');
 for(const [lockPath,value]of [[ratingDishOperationLockPath('dish'),{}],[ratingRestaurantOperationLockPath('restaurant'),{}],[dishMergeReviewLockPath('dish'),{blocksClientReviews:true}],[dishMergeReviewLockPath('dish'),{blocksClientAggregates:true}]]){
  const {db}=fixture();db.values.set('private_bitescore_runtime/aggregation',{enabled:true,version:1,epoch:'test'});
  db.values.set('bitescore_dish_images/img',{dishId:'dish',restaurantId:'restaurant',imageUrl:'https://example.test/img.jpg'});
  const before={...db.values.get('bitescore_dishes/dish')};db.values.set(lockPath,value);
  await assert.rejects(reads.reconcileCustomerBiteScoreImage(db,'img'),error=>error.code==='unavailable');
  assert.deepEqual(db.values.get('bitescore_dishes/dish'),before);
  assert.equal(db.values.has(reads.customerBiteScoreImageIndex+'/'+hash('img')),false);
  assert.equal(db.values.has(reads.customerBiteScoreReadGeneration+'/'+hash('dish')),false);
  db.values.delete(lockPath);await reads.reconcileCustomerBiteScoreImage(db,'img');
  assert.equal(db.values.get('bitescore_dishes/dish').primaryImageId,'img');assert.equal(db.values.get('bitescore_dishes/dish').imageCount,1);
 }
});

test('permanent retired and deleted image parents are never patched or resurrected',async()=>{
 const {ratingDishOperationLockPath,ratingRestaurantOperationLockPath}=require('../lib/rating_destructive_job_contract.js');
 const {dishMergeReviewLockPath}=require('../lib/dish_proposal_private_contract.js');
 for(const retire of [db=>db.values.set(ratingDishOperationLockPath('dish'),{permanent:true}),db=>db.values.set(ratingRestaurantOperationLockPath('restaurant'),{permanent:true}),db=>db.values.set(dishMergeReviewLockPath('dish'),{state:'merged_source'}),db=>db.values.delete('bitescore_dishes/dish'),db=>db.values.get('bitescore_dishes/dish').mergedIntoDishId='target']){
  const {db}=fixture();db.values.set('private_bitescore_runtime/aggregation',{enabled:true,version:1,epoch:'test'});
  db.values.set('bitescore_dish_images/img',{dishId:'dish',restaurantId:'restaurant',imageUrl:'https://example.test/img.jpg'});
  retire(db);const before=db.values.has('bitescore_dishes/dish')?{...db.values.get('bitescore_dishes/dish')}:undefined;
  await reads.reconcileCustomerBiteScoreImage(db,'img');await reads.reconcileCustomerBiteScoreImage(db,'img');
  assert.deepEqual(db.values.get('bitescore_dishes/dish'),before);
  assert.equal(db.values.has(reads.customerBiteScoreImageIndex+'/'+hash('img')),false);
 }
});

// Reviewer Safety Stage 2A: instrument only the existing bounded in-memory
// adapter; no production services or emulator processes are used by these tests.
const preferencesPath = uid => `user_profiles/${uid}/reviewer_safety_state/preferences`;
const blockPath = (uid, author) => `user_profiles/${uid}/blocked_reviewers/${author}`;
function setBlocks(db, uid, authors, revision) {
  for (const path of [...db.values.keys()]) if (path.startsWith(`user_profiles/${uid}/blocked_reviewers/`)) db.values.delete(path);
  db.values.set(preferencesPath(uid), {schemaVersion: 1, revision, updatedAt: Timestamp.fromMillis(5000 + revision)});
  for (const author of authors) db.values.set(blockPath(uid, author), {schemaVersion: 1, targetUserId: author, createdAt: Timestamp.fromMillis(5000)});
}
async function safetyFixture(total = 63, authorFor = n => `user${n}`) {
  const {db, context} = fixture();
  for (let n = 0; n < total; n++) {
    const rid = `r${String(n).padStart(3, '0')}`;
    db.values.set('dish_reviews/' + rid, review(n, {userId: authorFor(n)}));
    await reads.reconcileCustomerBiteScoreReview(db, rid);
  }
  const audit = {documents: [], batches: [], queries: []};
  const snap = db.snap.bind(db), getAll = db.getAll.bind(db), collection = db.collection.bind(db);
  db.snap = path => { audit.documents.push(path); return snap(path); };
  db.getAll = async (...refs) => { audit.batches.push(refs.map(ref => ref.path)); return getAll(...refs); };
  db.collection = path => { audit.queries.push(path); return collection(path); };
  return {db, audit, context: {...context, actorId: 'trusted-viewer', userId: 'viewer'}};
}
const requestPage = (db, context, extra = {}) => reads.pageCustomerBiteScoreReviewsHandler(db, {dishId: 'dish', sort: 'Most recent', ...extra}, context);
const refresh = error => error.code === 'failed-precondition' && error.message === 'Reviews changed. Refresh to continue.';

for (const sort of reads.customerBiteScoreReviewSorts) test(`personal filtering preserves ${sort}, lookahead and all eligible records across bounded pages`, async () => {
  const {db, context, audit} = await safetyFixture();
  const blockedAuthors = Array.from({length: 63}, (_, n) => `user${n}`).filter((_, n) => n % 3 !== 0);
  setBlocks(db, 'viewer', blockedAuthors, 1);
  const publicIds = [], visibleIds = [];
  for (const [reader, ids] of [[{...context, userId: null}, publicIds], [context, visibleIds]]) {
    let cursor; let pages = 0;
    do {
      const page = await requestPage(db, reader, {sort, cursor});
      assert.ok(page.items.length <= 25);
      ids.push(...page.items.map(item => item.review.id));
      cursor = page.nextCursor; pages++;
      assert.ok(pages <= 3, 'never refill/scan beyond a single bounded batch');
    } while (cursor);
    assert.equal(pages, 3);
  }
  assert.deepEqual(visibleIds, publicIds.filter(rid => Number(rid.slice(1)) % 3 === 0));
  assert.equal(new Set(visibleIds).size, visibleIds.length);
  const batches = audit.batches.filter(refs => refs[0]?.includes('/blocked_reviewers/'));
  assert.deepEqual(batches.map(refs => refs.length), [25, 25, 13]);
  assert.equal(audit.documents.filter(p => p === preferencesPath('viewer')).length, 6);
  assert.ok(audit.queries.every(p => !p.includes('blocked_reviewers') && !p.includes('reviewer_safety_state')));
});

test('no blocks, signed-out and guest contexts preserve ordinary public results and ignore forged viewer fields', async () => {
  const {db, context, audit} = await safetyFixture(3);
  setBlocks(db, 'someone-else', ['user1'], 1);
  for (const reader of [context, {...context, userId: null}, {...context, userId: undefined}, {...context, userId: 'anonymous-guest', actorId: 'guest-auth'}]) {
    const page = await requestPage(db, reader, {userId: 'someone-else', viewerId: 'someone-else', expectedUserId: 'someone-else'});
    assert.deepEqual(page.items.map(i => i.review.id), ['r002', 'r001', 'r000']);
  }
  assert.ok(!audit.documents.some(p => p.startsWith('user_profiles/someone-else/')));
});

test('one repeated blocked author adds one exact block read and no excluded text, image, identity or metadata', async () => {
  const {db, context, audit} = await safetyFixture(26, () => 'blocked-author');
  setBlocks(db, 'viewer', ['blocked-author'], 1);
  db.values.set('public_reviewer_profiles/blocked-author', {publicDisplayName: 'Do not disclose'});
  const before = require("node:v8").serialize([...db.values]);
  const page = await requestPage(db, context);
  assert.deepEqual(page.items, []); assert.ok(page.nextCursor);
  assert.deepEqual(Object.keys(page).sort(), ['items', 'nextCursor']);
  assert.equal(audit.batches.filter(refs => refs[0]?.includes('/blocked_reviewers/')).length, 1);
  assert.equal(audit.documents.filter(p => p === blockPath('viewer', 'blocked-author')).length, 1);
  assert.equal(audit.documents.filter(p => p === preferencesPath('viewer')).length, 2);
  assert.ok(!audit.documents.some(p => p.startsWith('public_reviewer_profiles/') || p.includes('/local_expert_badges/')));
  assert.ok(!audit.queries.includes(reads.customerBiteScoreImageIndex));
  assert.ok(!audit.queries.includes('review_reports'));
  assert.deepEqual(require("node:v8").serialize([...db.values]), before, 'reads preserve all public content, aggregates and votes');
  const end = await requestPage(db, context, {cursor: page.nextCursor});
  assert.deepEqual(end, {items: [], nextCursor: null});
  const other = await requestPage(db, {...context, userId: 'other', actorId: 'other'});
  assert.equal(other.items.length, 25);
  assert.equal((await reads.getCustomerBiteScoreDetailHandler(db, {kind: 'dish', id: 'dish'}, context)).dish.sourceDocumentId, 'dish');
});

test('long blocked prefix yields empty continuing pages without skipping lookahead or eligible reviews', async () => {
  const {db, context, audit} = await safetyFixture(82);
  setBlocks(db, 'viewer', Array.from({length: 60}, (_, n) => `user${n + 22}`), 1);
  const pages = []; let cursor;
  do { const page = await requestPage(db, context, {cursor}); pages.push(page); cursor = page.nextCursor; assert.ok(pages.length <= 4); } while (cursor);
  assert.deepEqual(pages.map(p => p.items.length), [0, 0, 15, 7]);
  assert.ok(pages[0].nextCursor && pages[1].nextCursor && pages[2].nextCursor);
  assert.equal(pages[3].nextCursor, null);
  assert.deepEqual(pages.flatMap(p => p.items.map(i => i.review.id)), Array.from({length: 22}, (_, i) => `r${String(21 - i).padStart(3, '0')}`));
  assert.equal(audit.queries.filter(p => p === reads.customerBiteScoreReviewIndex).length, 4);
});

test('blocked exact target is neutrally unavailable, valid target retains dish/order semantics', async () => {
  const {db, context, audit} = await safetyFixture();
  setBlocks(db, 'viewer', ['user12'], 1);
  await assert.rejects(requestPage(db, context, {targetReviewId: 'r012'}), {code: 'not-found', message: 'This review is unavailable.'});
  assert.ok(!audit.documents.includes('public_reviewer_profiles/user12'));
  const page = await requestPage(db, context, {targetReviewId: 'r013'});
  assert.equal(page.items[0].review.id, 'r013'); assert.equal(page.items.length, 13);
  const other = await requestPage(db, {...context, userId: null}, {targetReviewId: 'r012'});
  assert.equal(other.items[0].review.id, 'r012');
});

test('block/unblock revisions reject old continuations and account switches even with a reused actor binding', async () => {
  const {db, context} = await safetyFixture();
  const first = await requestPage(db, context);
  setBlocks(db, 'viewer', ['user30'], 1);
  await assert.rejects(requestPage(db, context, {cursor: first.nextCursor}), refresh);
  const blockedPage = await requestPage(db, context);
  const next = await requestPage(db, context, {cursor: blockedPage.nextCursor});
  assert.ok(!next.items.some(i => i.review.userId === 'user30'));
  setBlocks(db, 'viewer', [], 2);
  for (const cursor of [first.nextCursor, blockedPage.nextCursor]) await assert.rejects(requestPage(db, context, {cursor}), refresh);
  const fresh = await requestPage(db, context);
  for (const userId of ['another-user', null]) await assert.rejects(requestPage(db, {...context, userId}, {cursor: fresh.nextCursor}), refresh);
});

test('in-flight block/unblock and preference removal fail closed at the final revision check', async () => {
  for (const change of ['block', 'unblock', 'remove']) {
    const {db, context} = await safetyFixture(3);
    if (change !== 'block') setBlocks(db, 'viewer', ['user0'], 1);
    const getAll = db.getAll.bind(db); let changed = false;
    db.getAll = async (...refs) => {
      const snapshots = await getAll(...refs);
      if (!changed && refs.some(ref => ref.path.includes('/blocked_reviewers/'))) {
        changed = true;
        if (change === 'remove') db.values.delete(preferencesPath('viewer'));
        else setBlocks(db, 'viewer', change === 'block' ? ['user1'] : [], change === 'block' ? 1 : 2);
      }
      return snapshots;
    };
    await assert.rejects(requestPage(db, context), refresh); assert.equal(changed, true);
  }
});

test('malformed revision and inconsistent block identity never fall back to public content', async () => {
  const {db, context} = await safetyFixture(3);
  for (const value of [{}, {schemaVersion: 2, revision: 1}, ...[undefined, -1, 1.5, '1', Number.MAX_SAFE_INTEGER, NaN].map(revision => ({schemaVersion: 1, revision, updatedAt: Timestamp.now()})), {schemaVersion: 1, revision: 1, updatedAt: 'forged'}]) {
    db.values.set(preferencesPath('viewer'), value);
    await assert.rejects(requestPage(db, context), refresh);
  }
  setBlocks(db, 'viewer', ['user1'], 1);
  db.values.get(blockPath('viewer', 'user1')).targetUserId = 'someone-else';
  await assert.rejects(requestPage(db, context), refresh);
  setBlocks(db, 'viewer', ['user1'], 1); db.values.delete(preferencesPath('viewer'));
  await assert.rejects(requestPage(db, context), refresh);
});

test('authoritative reassignment cannot bypass blocks and inconsistent/stale sources remain fail closed', async () => {
  const {db, context, audit} = await safetyFixture(3);
  setBlocks(db, 'viewer', ['new-author'], 1);
  db.values.get('dish_reviews/r001').userId = 'new-author';
  const page = await requestPage(db, context);
  assert.ok(!page.items.some(i => i.review.id === 'r001'));
  assert.ok(audit.documents.includes(blockPath('viewer', 'new-author')));
  assert.ok(!audit.documents.includes('public_reviewer_profiles/user1'));
  await assert.rejects(requestPage(db, context, {targetReviewId: 'r001'}), {code: 'not-found'});
  db.values.get('dish_reviews/r000').notes = 'Stale projection';
  await assert.rejects(requestPage(db, context), refresh);
});

test('eligible review votes, pending reports, profile metadata, badges and image remain unchanged', async () => {
  const {db, context} = await safetyFixture(2);
  setBlocks(db, 'viewer', ['user0'], 1);
  db.values.set('review_feedback_votes/r001_viewer', {reviewId: 'r001', userId: 'viewer', voteType: 'helpful'});
  db.values.set('review_reports/report', {reviewId: 'r001', reportingUserId: 'viewer', status: 'pending'});
  db.values.set('public_reviewer_profiles/user1', {publicDisplayName: 'Visible reviewer'});
  db.values.set('user_profiles/user1/local_expert_badges/pizza', {expertTypeId: 'pizza', displayName: 'Pizza expert', level: 1});
  db.values.set('bitescore_dish_images/img', {dishId: 'dish', restaurantId: 'restaurant', reviewId: 'r001', imageUrl: 'https://example.test/visible.jpg'});
  await reads.reconcileCustomerBiteScoreImage(db, 'img');
  const before = require("node:v8").serialize([...db.values]);
  const page = await requestPage(db, context);
  assert.equal(page.items.length, 1);
  const item = page.items[0];
  assert.equal(item.currentUserVoteType, 'helpful'); assert.equal(item.hasPendingUserReport, true);
  assert.equal(item.reviewer.displayName, 'Visible reviewer'); assert.equal(item.reviewer.badges[0].expertTypeId, 'pizza');
  assert.equal(item.image.id, 'img');
  assert.deepEqual(require("node:v8").serialize([...db.values]), before);
});

test('actual review callable uses Firebase UID, keeps guest behavior, and never trusts payload viewer identity', async () => {
  const {db} = await safetyFixture(3);
  setBlocks(db, 'viewer', ['user1'], 1);
  const Module = require('node:module');
  const originalLoad = Module._load;
  const actualFirestore = require('firebase-admin/firestore');
  const actualParams = require('firebase-functions/params');
  // Only inject the database and a synthetic cursor key; execute the real
  // callable/readContext/handler chain without an SDK network connection.
  Module._load = function(name, parent, isMain) {
    if (name === 'firebase-admin/firestore') return {...actualFirestore, getFirestore: () => db};
    if (name === 'firebase-functions/params') return {...actualParams, defineSecret: secret => ({name: secret, value: () => Buffer.alloc(32, 9).toString('base64url')})};
    return originalLoad.call(this, name, parent, isMain);
  };
  let runtime;
  try { runtime = require('../lib/customer_bitescore_runtime.js'); } finally { Module._load = originalLoad; }
  const data = {dishId: 'dish', sort: 'Most recent', clientInstanceId: 'synthetic_instance_123', userId: 'viewer', viewerId: 'viewer'};
  for (const [auth, expected] of [
    [{uid: 'viewer', token: {firebase: {sign_in_provider: 'password'}}}, ['r002', 'r000']],
    [{uid: 'another', token: {firebase: {sign_in_provider: 'password'}}}, ['r002', 'r001', 'r000']],
    [{uid: 'anonymous-guest', token: {firebase: {sign_in_provider: 'anonymous'}}}, ['r002', 'r001', 'r000']],
    [undefined, ['r002', 'r001', 'r000']],
  ]) {
    const page = await runtime.pageCustomerBiteScoreReviews.run({auth, data});
    assert.deepEqual(page.items.map(item => item.review.id), expected);
  }
});

test('moderated source suppresses stale gallery and review-photo index entries without removing the written review',async()=>{
 const {db,context}=fixture();db.values.set('dish_reviews/r',review(1));await reads.reconcileCustomerBiteScoreReview(db,'r');
 const source={dishId:'dish',restaurantId:'restaurant',reviewId:'r',uploadedByUserId:'uploader',imageUrl:'https://example.test/photo.jpg',storagePath:'private',createdAt:new Date(1)};
 db.values.set('bitescore_dish_images/photo',source);await reads.reconcileCustomerBiteScoreImage(db,'photo');
 const before=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent'},context);
 assert.equal(before.items[0].image.id,'photo');assert.match(before.items[0].image.reportTargetVersion,/^[a-f0-9]{64}$/);
 // Do not run reconciliation: customer reads must independently reject removed source.
 db.values.set('bitescore_dish_images/photo',{...source,moderationStatus:'removed'});
 assert.equal((await reads.pageCustomerBiteScoreImagesHandler(db,{dishId:'dish'},context)).items.length,0);
 const after=await reads.pageCustomerBiteScoreReviewsHandler(db,{dishId:'dish',sort:'Most recent'},context);
 assert.equal(after.items.length,1);assert.equal(after.items[0].image,null);assert.equal(after.items[0].review.id,'r');
});
test('detail strips a stale primary URL without losing the dish when its search projection lags',async()=>{
 const {db,context}=fixture();
 const [path,index]=[...db.values.entries()].find(([path])=>path.startsWith('dish_search_index/'));
 db.values.set(path,{...index,customerPublicProjection:{...index.customerPublicProjection,primaryImageUrl:'https://example.test/removed.jpg'}});
 db.values.set('bitescore_dishes/dish',{...db.values.get('bitescore_dishes/dish'),primaryImageUrl:'https://example.test/replacement.jpg'});
 const detail=await reads.getCustomerBiteScoreDetailHandler(db,{kind:'dish',id:'dish'},context);
 assert.equal(detail.dish.sourceDocumentId,'dish');assert.equal(detail.dish.primaryImageUrl,undefined);
});
