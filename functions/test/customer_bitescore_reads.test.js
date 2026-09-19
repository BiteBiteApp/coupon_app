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
