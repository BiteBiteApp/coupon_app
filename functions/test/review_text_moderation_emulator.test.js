'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const enabled=process.env.RUN_REVIEW_TEXT_EMULATOR==='1';
const local=(name,fn)=>test(name,{skip:!enabled},fn);
const core=require('../lib/review_text_moderation'), handlers=require('../lib/review_text_handlers');
const {saveCustomerBiteScoreReview,reconcileBiteScoreReviewAggregateEvent}=require('../lib/bitescore_review_aggregate');
const {createFirestoreRatingDestructivePrivateDatabase}=require('../lib/rating_destructive_job_store');
const {OpenAIReviewTextProvider,reviewTextCategories,reviewTextModel}=require('../lib/review_text_provider');
let app,db,store,calls=0,now;
const uid='writer';
const input=(extra={})=>({schemaVersion:1,expectedUserId:uid,dishId:'dish',restaurantId:'restaurant',headline:'Good',notes:'Tasty',overallImpression:8,tastinessScore:7,qualityScore:9,valueScore:6,...extra});
const auth=(user=uid,admin=false)=>({uid:user,token:{admin,email_verified:true,firebase:{sign_in_provider:'password'}}});
const req=(data={},user=uid,admin=false)=>({auth:auth(user,admin),data:{schemaVersion:1,expectedUserId:user,...data}});
const response=(category=null)=>({id:'modr-test',model:reviewTextModel,results:[{flagged:!!category,categories:Object.fromEntries(reviewTextCategories.map(k=>[k,k===category])),category_scores:Object.fromEntries(reviewTextCategories.map(k=>[k,k===category?.8:.001])),category_applied_input_types:Object.fromEntries(reviewTextCategories.map(k=>[k,['text']]))}]});
const provider=(category=null)=>new OpenAIReviewTextProvider(()=> 'synthetic-key',async()=>{calls++;return response(category);});
const save=(extra={},p=provider())=>saveCustomerBiteScoreReview(store,{uid,emailVerified:true},input(extra),now,undefined,p,()=>now);
const read=async path=>(await db.doc(path).get()).data();
const publicReview=async id=>read(`dish_reviews/${id}`);
const privateReview=async id=>read(core.textPath(id));
const rating=async()=>read('dish_rating_aggregates/dish');
test.before(async()=>{if(!enabled)return;assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8792');assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);app=require('firebase-admin/app').initializeApp({projectId:'demo-review-text'});db=require('firebase-admin/firestore').getFirestore(app);store=createFirestoreRatingDestructivePrivateDatabase(db);});
test.beforeEach(async()=>{if(!enabled)return;calls=0;now=new Date();await fetch('http://127.0.0.1:8792/emulator/v1/projects/demo-review-text/databases/(default)/documents',{method:'DELETE'});await Promise.all([
 db.doc('private_bitescore_runtime/aggregation').set({enabled:true,version:1,epoch:'test'}),
 db.doc(core.reviewTextRuntimePath).set({...core.reviewTextRuntimeCandidate,required:true,processingEnabled:true,cleanupEnabled:true,retentionApproved:true,retentionSeconds:3600}),
 db.doc('bitescore_dishes/dish').set({id:'dish',restaurantId:'restaurant',isActive:true}),db.doc('bitescore_restaurants/restaurant').set({id:'restaurant',isActive:true})]);});
test.after(async()=>{if(app)await app.delete();});
local('clean new review publishes once and preserves trusted ratings, counts and retry idempotency',async()=>{const a=await save();assert.equal(a.textStatus,'published');assert.equal(a.review.notes,'Tasty');assert.equal((await rating()).ratingCount,1);assert.equal((await privateReview(a.review.id)).notes,undefined);const b=await save();assert.equal(b.review.id,a.review.id);assert.equal(calls,1);assert.equal((await rating()).ratingCount,1);});
local('rating-only never calls provider and explicit blank removes words',async()=>{const a=await save({headline:'',notes:''});assert.equal(calls,0);assert.equal((await rating()).ratingCount,1);await save();await save({headline:'',notes:''});assert.equal((await publicReview(a.review.id)).notes,null);assert.equal(await privateReview(a.review.id),undefined);});
local('questionable new words are private, rating remains public and Admin rejection erases only proposal words',async()=>{const a=await save({},provider('hate'));assert.equal(a.textStatus,'pending');assert.equal(a.review.notes,null);assert.equal((await publicReview(a.review.id)).notes,null);assert.equal((await privateReview(a.review.id)).notes,'Tasty');assert.equal((await rating()).ratingCount,1);const p=await privateReview(a.review.id);await handlers.decideReviewTextHandler(db,req({reviewId:a.review.id,version:p.version,action:'reject'},'admin',true));assert.equal((await privateReview(a.review.id)).status,'rejected');assert.equal((await privateReview(a.review.id)).notes,undefined);assert.equal((await rating()).ratingCount,1);});
local('questionable edit retains older words and changes rating exactly once; approval changes no aggregate or timestamps',async()=>{const a=await save();const b=await save({headline:'New',notes:'New words',overallImpression:10},provider('harassment'));assert.equal(b.review.notes,'Tasty');assert.equal((await rating()).ratingCount,1);assert.ok(Math.abs((await rating()).overallBiteScore-88)<.00001);const before=await publicReview(a.review.id),aggregate=await rating(),p=await privateReview(a.review.id);await core.decideReviewText(store,'admin',a.review.id,p.version,true,now);assert.equal((await publicReview(a.review.id)).notes,'New words');assert.deepEqual(await rating(),aggregate);assert.deepEqual((await publicReview(a.review.id)).updatedAt,before.updatedAt);});
local('partial removal is honored while replacement words are held',async()=>{const a=await save();await save({headline:'',notes:'Held'},provider('hate'));const r=await publicReview(a.review.id);assert.equal(r.headline,null);assert.equal(r.notes,'Tasty');});
local('superseded proposal cannot be approved or rejected',async()=>{const a=await save({},provider('hate'));const p=await privateReview(a.review.id);await save({notes:'Replacement'},provider('hate'));for(const approve of [true,false])await assert.rejects(core.decideReviewText(store,'admin',a.review.id,p.version,approve,now),{code:'failed-precondition'});assert.equal((await rating()).ratingCount,1);});
local('delayed provider cannot publish after newer edit',async()=>{let release,entered;const started=new Promise(r=>entered=r);const p={screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response());}};const first=save({notes:'Old delayed'},p);await started;const newer=await save({notes:'New current'});release();assert.equal((await first).textStatus,'superseded');assert.equal((await publicReview(newer.review.id)).notes,'New current');assert.equal((await rating()).ratingCount,1);});
local('withdrawal and same-ID recreation cannot revive old proposal, including delayed delete trigger',async()=>{const a=await save({},provider('hate'));const old=await privateReview(a.review.id);const before=await publicReview(a.review.id);await db.doc(`dish_reviews/${a.review.id}`).delete();await assert.rejects(core.decideReviewText(store,'admin',a.review.id,old.version,true,now));await reconcileBiteScoreReviewAggregateEvent(store,{reviewId:a.review.id,before,after:null,now});assert.equal((await rating()).ratingCount,0);await save({notes:'Recreated'},provider('hate'));await core.reconcileReviewText(store,a.review.id);const p=await privateReview(a.review.id);assert.notEqual(p.version,old.version);await assert.rejects(core.decideReviewText(store,'admin',a.review.id,old.version,true,now));assert.equal((await rating()).ratingCount,1);});
local('changed dish identity and deletion fence block decisions and private drafts',async()=>{const a=await save({},provider('hate'));const p=await privateReview(a.review.id);await db.doc(`dish_reviews/${a.review.id}`).update({dishId:'merged'});await assert.rejects(core.decideReviewText(store,'admin',a.review.id,p.version,true,now));await core.reconcileReviewText(store,a.review.id);assert.equal(await privateReview(a.review.id),undefined);await db.doc('private_account_deletions/writer').set({});await assert.rejects(save(),{code:'failed-precondition'});await assert.rejects(handlers.getOwnReviewTextHandler(db,req({reviewId:a.review.id})),{code:'failed-precondition'});});
local('provider failure and processing pause retain rating and private words with no false publication',async()=>{const a=await save({}, {screen:async()=>{throw Error('timeout');}});assert.equal(a.textStatus,'screening_failed');assert.equal(a.review.notes,null);assert.equal((await rating()).ratingCount,1);await db.doc(core.reviewTextRuntimePath).update({processingEnabled:false});const b=await save({notes:'Paused words'});assert.equal(b.textStatus,'screening_failed');assert.equal(calls,0);assert.equal((await privateReview(a.review.id)).notes,'Paused words');});
local('disabled feature preserves historical words without provider traffic; unapproved retention blocks activation',async()=>{await db.doc(core.reviewTextRuntimePath).set(core.reviewTextRuntimeCandidate);const a=await save();assert.equal(a.textStatus,'legacy');assert.equal(a.review.notes,'Tasty');assert.equal(calls,0);await db.doc(core.reviewTextRuntimePath).update({required:true});await assert.rejects(save(),{code:'failed-precondition'});});
local('author status is private, rejects account switch; nonadmin queue/decision denied',async()=>{const a=await save({},provider('hate'));const owner=await handlers.getOwnReviewTextHandler(db,req({reviewId:a.review.id}),now);assert.equal(owner.proposal.notes,'Tasty');assert.equal((await handlers.getOwnReviewTextHandler(db,req({reviewId:a.review.id},'other'),now)).proposal,null);await assert.rejects(handlers.getOwnReviewTextHandler(db,{...req({reviewId:a.review.id}),auth:auth('other')}),{code:'permission-denied'});await assert.rejects(handlers.listReviewTextHandler(db,req()),{code:'permission-denied'});await assert.rejects(handlers.decideReviewTextHandler(db,req({reviewId:a.review.id,version:owner.proposal.version,action:'approve'})),{code:'permission-denied'});});
local('queue is bounded and paginated; expired text is excluded and cleanup deletes private words',async()=>{for(let i=0;i<27;i++){const id=`r${String(i).padStart(2,'0')}`;const p={reviewId:id,dishId:'dish',restaurantId:'restaurant',userId:'writer',version:'v',status:'pending',headline:'held',notes:'private',createdAt:now,expiresAt:new Date(now.getTime()+1000)};await db.doc(core.textPath(id)).set(p);await db.doc(`dish_reviews/${id}`).set({id,dishId:'dish',restaurantId:'restaurant',userId:'writer',textRevision:'v'});}const a=await handlers.listReviewTextHandler(db,req({},'admin',true),now);assert.equal(a.items.length,25);assert.ok(a.nextCursor);const b=await handlers.listReviewTextHandler(db,req({cursor:a.nextCursor},'admin',true),now);assert.equal(b.items.length,2);assert.equal(b.nextCursor,null);now=new Date(now.getTime()+2000);assert.equal((await handlers.listReviewTextHandler(db,req({},'admin',true),now)).items.length,0);assert.equal(await handlers.expireReviewTexts(db,now),25);assert.equal(await handlers.expireReviewTexts(db,now),2);});
local('per-user admissions bound calls independently of image allowance',async()=>{for(let i=0;i<9;i++)await save({notes:`edit ${i}`});assert.equal(calls,6);assert.equal((await rating()).ratingCount,1);assert.equal((await db.collection('private_bitescore_photo_screenings').get()).size,0);});
local('posting restrictions active/expired/released and terms remain independent',async()=>{assert.equal(require('../lib/bitescore_terms').approvedBiteScoreTerms,null);const p='user_profiles/writer/posting_restriction_state/current';await db.doc(p).set({schemaVersion:1,revision:1,kind:'indefinite',startsAt:new Date(1),endsAt:null,releasedAt:null});await assert.rejects(save(),{code:'permission-denied'});await db.doc(p).update({releasedAt:new Date(2)});await save();await db.doc(p).update({releasedAt:null,kind:'7d',endsAt:new Date(100)});await save({notes:'Expired restriction'});assert.equal((await rating()).ratingCount,1);});
local('explicit failed resubmission retries same version at most twice without extending retention',async()=>{
 let tries=0;const failure={screen:async()=>{tries++;throw Error('offline');}};
 const a=await save({},failure),p=await privateReview(a.review.id);await save({},failure);assert.equal(tries,1);
 now=new Date(now.getTime()+61000);await save({},failure);assert.equal(tries,2);const retried=await privateReview(a.review.id);assert.equal(retried.version,p.version);assert.deepEqual(retried.expiresAt,p.expiresAt);
 now=new Date(now.getTime()+61000);await save({},failure);assert.equal(tries,2);
});
local('public projection, reviewer history source and report evidence contain approved words only',async()=>{
 const reads=require('../lib/customer_bitescore_reads');
 const a=await save();await save({headline:'PRIVATE proposed headline',notes:'PRIVATE proposed notes'},provider('hate'));
 await reads.reconcileCustomerBiteScoreReview(db,a.review.id);
 const projection=reads.buildCustomerBiteScoreReview(a.review.id,await publicReview(a.review.id));assert.equal(projection.review.notes,'Tasty');assert.equal(JSON.stringify(projection).includes('PRIVATE'),false);assert.equal(JSON.stringify(projection).includes('textRevision'),false);
 await db.doc('public_reviewer_profiles/writer').set({userId:'writer',publicDisplayName:'Writer'});
 const report=await require('../lib/reviewer_safety').submitReviewerReportHandler(db,req({targetUserId:'writer',reason:'Harassment',supportingReviewId:a.review.id,requestId:'synthetic_report_12345'},'reporter'));
 assert.equal(JSON.stringify(await read(`review_reports/${report.reportId}`)).includes('PRIVATE'),false);
 const before=await rating();await reads.reconcileCustomerBiteScoreReview(db,a.review.id);assert.deepEqual(await rating(),before);assert.equal(calls,2);
});
local('deleted account, active posting restriction and dish locks during screening cannot publish',async()=>{
 for(const block of ['deletion','posting','lock']) {
  let release,entered;const started=new Promise(r=>entered=r);const delayed={screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response());}};
  const running=save({notes:`blocked ${block}`},delayed);await started;
  const path=block==='deletion'?'private_account_deletions/writer':block==='posting'?'user_profiles/writer/posting_restriction_state/current':'private_rating_dish_operation_locks/dish';
  await db.doc(path).set(block==='posting'?{schemaVersion:1,revision:1,kind:'indefinite',startsAt:new Date(1),endsAt:null,releasedAt:null}:{});release();const a=await running;assert.equal(a.textStatus,'screening_failed');assert.equal((await publicReview(a.review.id)).notes,null);await db.doc(path).delete();
 }
});
local('simultaneous ordinary edits still contribute one rating and only current words',async()=>{
 const results=await Promise.all([save({notes:'One',overallImpression:2}),save({notes:'Two',overallImpression:10})]);
 assert.equal(new Set(results.map(r=>r.review.id)).size,1);assert.equal((await rating()).ratingCount,1);
 const source=await publicReview(results[0].review.id);assert.ok(['One','Two'].includes(source.notes));assert.equal((await rating()).overallBiteScore,source.overallBiteScore);
});
local('expired screening lease recovers once, fences abandoned completion, keeps original deadline',async()=>{
 let release,entered;const started=new Promise(r=>entered=r);const delayed={screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response());}};
 const abandoned=save({},delayed);await started;
 const doc=(await db.collection(core.reviewTextCollection).get()).docs[0];const before=doc.data();
 now=new Date(now.getTime()+61000);const current=await save({},provider('hate'));const after=await privateReview(current.review.id);
 assert.equal(after.version,before.version);assert.notEqual(after.attemptId,before.attemptId);assert.deepEqual(after.expiresAt,before.expiresAt);
 release();assert.equal((await abandoned).textStatus,'superseded');assert.equal((await publicReview(current.review.id)).notes,null);
});
local('terminal receipts do not crowd raw-text expiry and cleanup must be approved before holding words',async()=>{
 const a=await save();assert.equal((await privateReview(a.review.id)).expiresAt,undefined);
 await save({notes:'Held'},provider('hate'));const p=await privateReview(a.review.id);await core.decideReviewText(store,'admin',a.review.id,p.version,false,now);assert.equal((await privateReview(a.review.id)).expiresAt,undefined);assert.equal((await privateReview(a.review.id)).notes,undefined);
 await db.doc(core.reviewTextRuntimePath).update({cleanupEnabled:false});await assert.rejects(save({notes:'New'}),{code:'failed-precondition'});
});
local('existing published-review moderation is not bypassed by text approval',async()=>{
 const a=await save({},provider('hate'));const p=await privateReview(a.review.id);
 await db.doc(`dish_reviews/${a.review.id}`).update({hidden:true});
 await assert.rejects(core.decideReviewText(store,'admin',a.review.id,p.version,true,now),{code:'failed-precondition'});
 const edited=await save({notes:'New clean words'});assert.equal(edited.textStatus,'screening_failed');assert.equal((await publicReview(a.review.id)).hidden,true);assert.equal((await publicReview(a.review.id)).notes,null);assert.equal((await rating()).ratingCount,1);
});
