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
 db.doc(core.reviewTextRuntimePath).set({...core.reviewTextRuntimeCandidate,required:true,processingEnabled:true,cleanupEnabled:true,retentionApproved:true}),
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
local('queue is bounded and paginated; expired text is excluded and cleanup deletes private words',async()=>{for(let i=0;i<27;i++){const id=`r${String(i).padStart(2,'0')}`;const p={reviewId:id,dishId:'dish',restaurantId:'restaurant',userId:'writer',version:'v',status:'pending',retentionPolicyVersion:core.reviewTextRetentionPolicy,headline:'held',notes:'private',createdAt:new Date(now.getTime()-core.pendingReviewTextSeconds*1000+1000),expiresAt:new Date(now.getTime()+1000)};await db.doc(core.textPath(id)).set(p);await db.doc(`dish_reviews/${id}`).set({id,dishId:'dish',restaurantId:'restaurant',userId:'writer',textRevision:'v'});}const a=await handlers.listReviewTextHandler(db,req({},'admin',true),now);assert.equal(a.items.length,25);assert.ok(a.nextCursor);const b=await handlers.listReviewTextHandler(db,req({cursor:a.nextCursor},'admin',true),now);assert.equal(b.items.length,2);assert.equal(b.nextCursor,null);now=new Date(now.getTime()+2000);assert.equal((await handlers.listReviewTextHandler(db,req({},'admin',true),now)).items.length,0);assert.equal(await handlers.expireReviewTexts(db,now),25);assert.equal(await handlers.expireReviewTexts(db,now),2);});
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
local('valid flagged completion keeps original 30-day retention while a new posting restriction blocks publication',async()=>{
 const first=await save();
 let release,entered;const started=new Promise(r=>entered=r);
 const delayed={screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response('hate'));}};
 const running=save({notes:'Held edit'},delayed);await started;
 const screening=await privateReview(first.review.id),aggregate=await rating();
 await db.doc('user_profiles/writer/posting_restriction_state/current').set({schemaVersion:1,revision:1,kind:'indefinite',startsAt:new Date(1),endsAt:null,releasedAt:null});
 release();assert.equal((await running).textStatus,'pending');
 const pending=await privateReview(first.review.id);
 assert.deepEqual(pending.createdAt,screening.createdAt);
 assert.equal(pending.expiresAt.toMillis(),screening.createdAt.toMillis()+2592000*1000);
 await assert.rejects(core.decideReviewText(store,'admin',first.review.id,pending.version,true,now),{code:'permission-denied'});
 assert.equal((await publicReview(first.review.id)).notes,'Tasty');
 assert.deepEqual(await rating(),aggregate);assert.equal(aggregate.ratingCount,1);
});
local('expired screening lease recovers once, fences abandoned completion, keeps original deadline',async()=>{
 let release,entered;const started=new Promise(r=>entered=r);const delayed={screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response());}};
 const abandoned=save({},delayed);await started;
 const doc=(await db.collection(core.reviewTextCollection).get()).docs[0];const before=doc.data();
 now=new Date(now.getTime()+61000);const current=await save({},provider('hate'));const after=await privateReview(current.review.id);
 assert.equal(after.version,before.version);assert.notEqual(after.attemptId,before.attemptId);assert.equal(after.expiresAt.toMillis(),before.createdAt.toMillis()+core.pendingReviewTextSeconds*1000);
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

const at = (created, seconds, offset=0) => new Date(created + seconds*1000 + offset);
local('approved inert configuration has exact separate durations; incomplete or legacy active contracts fail closed',async()=>{
 assert.equal(core.pendingReviewTextSeconds,2592000);assert.equal(core.failedReviewTextSeconds,604800);
 for(const key of ['required','processingEnabled','cleanupEnabled','retentionApproved'])assert.equal(core.reviewTextRuntimeCandidate[key],false);
 for(const change of [{retentionPolicyVersion:'old'},{pendingRetentionSeconds:604800},{failedRetentionSeconds:2592000},{processingEnabled:'yes'},{failedRetentionSeconds:null}]){
  await db.doc(core.reviewTextRuntimePath).set({...core.reviewTextRuntimeCandidate,required:true,processingEnabled:true,cleanupEnabled:true,retentionApproved:true,...change});
  await assert.rejects(save(),{code:'failed-precondition'});
 }
 await db.doc(core.reviewTextRuntimePath).set({required:true,processingEnabled:true,cleanupEnabled:true,retentionApproved:true,retentionSeconds:2592000,policyVersion:'openai-clean-or-human-v1'});
 await assert.rejects(save(),{code:'failed-precondition'});assert.equal(calls,0);
});
local('flagged pending deadline is exactly 30 consecutive days from original submission; duplicate saves and reads never extend it',async()=>{
 const created=now.getTime(),a=await save({},provider('hate'));const p=await privateReview(a.review.id);
 assert.equal(p.createdAt.toMillis(),created);assert.equal(p.expiresAt.toMillis(),created+2592000000);
 now=at(created,2592000,-1);await save({},provider('hate'));assert.equal(calls,1);
 const own=await handlers.getOwnReviewTextHandler(db,req({reviewId:a.review.id}),now);assert.equal(own.proposal.status,'pending');assert.equal(own.proposal.notes,'Tasty');
 const queue=await handlers.listReviewTextHandler(db,req({},'admin',true),now);assert.equal(queue.items[0].createdAtMillis,created);assert.equal(queue.items[0].expiresAtMillis,created+2592000000);
 assert.equal((await privateReview(a.review.id)).expiresAt.toMillis(),p.expiresAt.toMillis());
 await core.decideReviewText(store,'admin',a.review.id,p.version,true,now);assert.equal((await publicReview(a.review.id)).notes,'Tasty');
 now=at(created,2592000,1);await handlers.expireReviewTexts(db,now);assert.equal((await publicReview(a.review.id)).notes,'Tasty');assert.equal((await privateReview(a.review.id)).notes,undefined);
});
for(const offset of [0,1])local(`pending at 30 days + ${offset}ms expires without scheduler and preserves prior public words, ratings and votes`,async()=>{
 const first=await save();await db.doc(`dish_reviews/${first.review.id}`).update({helpfulCount:9});
 const created=now.getTime();await save({notes:'Private pending'},provider('hate'));const p=await privateReview(first.review.id),aggregate=await rating();
 now=at(created,2592000,offset);
 assert.equal((await handlers.getOwnReviewTextHandler(db,req({reviewId:first.review.id}),now)).proposal.notes,null);
 assert.equal((await handlers.listReviewTextHandler(db,req({},'admin',true),now)).items.length,0);
 for(const approve of [true,false])await assert.rejects(core.decideReviewText(store,'admin',first.review.id,p.version,approve,now),{code:'failed-precondition'});
 assert.equal((await save({notes:'Private pending'},provider('hate'))).textStatus,'expired');assert.equal(calls,2);
 assert.equal((await privateReview(first.review.id)).notes,undefined);assert.equal((await privateReview(first.review.id)).expiresAt,undefined);
 assert.equal((await publicReview(first.review.id)).notes,'Tasty');assert.equal((await publicReview(first.review.id)).helpfulCount,9);const currentAggregate=await rating();assert.deepEqual({...currentAggregate,updatedAt:null},{...aggregate,updatedAt:null});
});
local('failed screening expires at exactly seven days, never publishes automatically and never extends on duplicate resubmission',async()=>{
 const created=now.getTime(),a=await save({}, {screen:async()=>{throw Error('offline');}});const p=await privateReview(a.review.id);
 assert.equal(p.expiresAt.toMillis(),created+604800000);
 now=at(created,604800,-1);assert.equal((await handlers.getOwnReviewTextHandler(db,req({reviewId:a.review.id}),now)).proposal.status,'screening_failed');
 now=at(created,604800);const result=await save();assert.equal(result.textStatus,'expired');assert.equal(calls,0);
 assert.equal((await privateReview(a.review.id)).notes,undefined);assert.equal((await publicReview(a.review.id)).notes,null);assert.equal((await rating()).ratingCount,1);
 now=at(created,604800,1);assert.equal((await save()).textStatus,'expired');assert.equal(calls,0);
});
for(const flagged of [false,true])local(`explicit successful retry ${flagged?'flagged':'clean'} uses original submission and correct state deadline`,async()=>{
 const created=now.getTime(),a=await save({}, {screen:async()=>{throw Error('offline');}});const first=await privateReview(a.review.id);
 now=at(created,604800,-1);const result=await save({},provider(flagged?'hate':null)),p=await privateReview(a.review.id);
 assert.equal(p.version,first.version);assert.equal(p.createdAt.toMillis(),created);assert.equal(p.attemptCount,2);
 if(flagged){assert.equal(result.textStatus,'pending');assert.equal(p.expiresAt.toMillis(),created+2592000000);now=at(created,604800,1);assert.equal(await handlers.expireReviewTexts(db,now),0);assert.equal((await privateReview(a.review.id)).notes,'Tasty');}
 else{assert.equal(result.textStatus,'published');assert.equal(p.expiresAt,undefined);assert.equal(p.notes,undefined);now=at(created,2592000,1);await handlers.expireReviewTexts(db,now);assert.equal((await publicReview(a.review.id)).notes,'Tasty');}
 assert.equal((await rating()).ratingCount,1);
});
local('in-flight lease becomes honest failure; response at seven-day boundary cannot publish',async()=>{
 const created=now.getTime();let entered,release;const started=new Promise(r=>entered=r);
 const running=save({}, {screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response());}});await started;
 const p=(await db.collection(core.reviewTextCollection).get()).docs[0];assert.equal(p.get('expiresAt').toMillis(),created+604800000);
 now=new Date(created+20000);assert.equal((await handlers.getOwnReviewTextHandler(db,req({reviewId:p.id}),now)).proposal.status,'screening_failed');
 now=at(created,604800);release();assert.equal((await running).textStatus,'expired');assert.equal((await privateReview(p.id)).notes,undefined);assert.equal((await publicReview(p.id)).notes,null);
});
local('pause and admission failure use seven days; malformed active config blocks late clean publication and Admin approval',async()=>{
 await db.doc(core.reviewTextRuntimePath).update({processingEnabled:false});const created=now.getTime(),a=await save();assert.equal((await privateReview(a.review.id)).expiresAt.toMillis(),created+604800000);assert.equal(calls,0);
 await db.doc(core.reviewTextRuntimePath).update({processingEnabled:true});await db.doc(`${core.reviewTextAdmissionCollection}/writer`).set({userId:uid,window:Math.floor(now.getTime()/60000),count:6});await save({notes:'Busy'});assert.equal((await privateReview(a.review.id)).expiresAt.toMillis(),created+604800000);assert.equal(calls,0);
 now=new Date(created+61000);let release,entered;const started=new Promise(r=>entered=r);const running=save({notes:'Delayed'}, {screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response());}});await started;
 await db.doc(core.reviewTextRuntimePath).update({failedRetentionSeconds:2592000});release();assert.equal((await running).textStatus,'screening_failed');const p=await privateReview(a.review.id);await assert.rejects(core.decideReviewText(store,'admin',a.review.id,p.version,true,now),{code:'failed-precondition'});assert.equal((await publicReview(a.review.id)).notes,null);
});
local('Admin rejection wins against an in-flight retry and immediately strips raw words',async()=>{
 const a=await save({}, {screen:async()=>{throw Error('offline');}});now=new Date(now.getTime()+61000);let release,entered;const started=new Promise(r=>entered=r);
 const running=save({}, {screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response());}});await started;
 const p=await privateReview(a.review.id);await core.decideReviewText(store,'admin',a.review.id,p.version,false,now);release();assert.equal((await running).textStatus,'superseded');assert.equal((await privateReview(a.review.id)).status,'rejected');assert.equal((await privateReview(a.review.id)).notes,undefined);assert.equal((await publicReview(a.review.id)).notes,null);
});
local('bounded expiry recovers after partial job failure and duplicate runs; TTL deletion cannot affect public content',async()=>{
 const a=await save();const publicBefore=await publicReview(a.review.id),aggregate=await rating();await save({notes:'Expired'},provider('hate'));
 now=at(now.getTime(),2592000);const original=db.runTransaction;let steps=0;
 // A worker interruption between records must not require a global reset.
 for(let i=0;i<2;i++)await db.doc(core.textPath(`extra${i}`)).set({retentionPolicyVersion:core.reviewTextRetentionPolicy,status:'pending',createdAt:new Date(now.getTime()-2592000000),expiresAt:now,notes:'private'});
 db.runTransaction=function(...args){if(++steps===2)return Promise.reject(Error('simulated job crash'));return original.apply(this,args);};
 try{await assert.rejects(handlers.expireReviewTexts(db,now),/simulated job crash/);}finally{db.runTransaction=original;}
 assert.equal(await handlers.expireReviewTexts(db,now),2);assert.equal(await handlers.expireReviewTexts(db,now),0);
 assert.equal((await handlers.getOwnReviewTextHandler(db,req({reviewId:a.review.id}),now)).proposal.status,'expired');
 // Model Firestore's whole-document TTL delete (the emulator does not run TTL).
 await db.doc(core.textPath(a.review.id)).delete();const own=await handlers.getOwnReviewTextHandler(db,req({reviewId:a.review.id}),now);assert.equal(own.proposal.status,'expired');assert.equal(own.proposal.notes,null);
 const ttlCalls=calls;assert.equal((await save({notes:'Expired'})).textStatus,'expired');assert.equal(calls,ttlCalls);assert.equal((await publicReview(a.review.id)).notes,publicBefore.notes);assert.deepEqual({...await rating(),updatedAt:null},{...aggregate,updatedAt:null});
});
local('decision clock is rechecked after reads crossing the 30-day deadline',async()=>{
 const created=now.getTime(),a=await save({},provider('hate')),p=await privateReview(a.review.id);
 now=at(created,2592000,-1);
 const delayed={runTransaction:fn=>store.runTransaction(tx=>fn(new Proxy(tx,{get(target,key){if(key==='getDocument')return async path=>{const result=await target.getDocument(path);if(path==='bitescore_dishes/dish')now=at(created,2592000);return result;};return target[key];}})))};
 await assert.rejects(core.decideReviewText(delayed,'admin',a.review.id,p.version,true,()=>now),{code:'failed-precondition'});
 assert.equal((await publicReview(a.review.id)).notes,null);
});
local('provider clock is rechecked after permission reads crossing the seven-day deadline',async()=>{
 const created=now.getTime();let release,entered;const started=new Promise(r=>entered=r);
 const running=save({}, {screen:async()=>{entered();await new Promise(r=>release=r);return require('../lib/review_text_provider').parseReviewTextSignal(response());}});await started;
 const p=(await db.collection(core.reviewTextCollection).get()).docs[0].data();now=at(created,604800,-1);
 const delayed={runTransaction:fn=>store.runTransaction(tx=>fn(new Proxy(tx,{get(target,key){if(key==='getDocument')return async path=>{const result=await target.getDocument(path);if(path==='bitescore_dishes/dish')now=at(created,604800);return result;};return target[key];}})))};
 const status=await core.finishReviewText(delayed,{reviewId:p.reviewId,version:p.version,attemptId:p.attemptId,headline:p.headline,notes:p.notes},require('../lib/review_text_provider').parseReviewTextSignal(response()),()=>now);
 assert.equal(status,'expired');release();await running;assert.equal((await publicReview(p.reviewId)).notes,null);
});
local('author and Admin responses use clock after reads and omit words at exact expiry',async()=>{
 const created=now.getTime(),a=await save({},provider('hate'));const original=db.runTransaction;
 db.runTransaction=function(fn,...args){return original.call(this,tx=>fn(new Proxy(tx,{get(target,key){if(key==='getAll')return async(...refs)=>{const result=await target.getAll(...refs);now=at(created,2592000);return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}})),...args);};
 try{now=at(created,2592000,-1);assert.equal((await handlers.getOwnReviewTextHandler(db,req({reviewId:a.review.id}),()=>now)).proposal.notes,null);now=at(created,2592000,-1);assert.equal((await handlers.listReviewTextHandler(db,req({},'admin',true),()=>now)).items.length,0);}finally{db.runTransaction=original;}
});
local('raw TTL removal keeps only minimal current identity and withdrawal removes that receipt',async()=>{
 const created=now.getTime(),a=await save({},provider('hate')),receipt=await read(core.textReceiptPath(a.review.id));
 assert.equal(receipt.createdAt.toMillis(),created);assert.equal(receipt.notes,undefined);assert.equal(receipt.headline,undefined);assert.equal(receipt.signal,undefined);
 now=at(created,2592000);await db.doc(core.textPath(a.review.id)).delete();assert.equal((await save()).textStatus,'expired');assert.equal(calls,1);
 await db.doc(`dish_reviews/${a.review.id}`).delete();await core.reconcileReviewText(store,a.review.id);assert.equal(await read(core.textReceiptPath(a.review.id)),undefined);
});
