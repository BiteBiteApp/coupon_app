'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const enabled=process.env.RUN_ACCOUNT_DELETION_EMULATOR==='1';
const project='demo-coupon-app-rules';
let db,auth,app,now,api,cleanup,store,aggregate,reads;
const identity=async(uid)=>{try {const u=await auth.getUser(uid);return {uid:u.uid,creationTime:u.metadata.creationTime,providerIds:u.providerData.map(p=>p.providerId),disabled:u.disabled};}catch(e){if(e.code==='auth/user-not-found')return null;throw e;}};
const objects={nextPersonalPath:async()=>null,personalGeneration:async()=>null,nextOwnedPath:async()=>null,nextMenuPath:async()=>null,referenceUrls:async()=>[],generation:async()=>null,deleteGeneration:async()=>{throw Error("Unexpected object delete");}};
const authAdapter={getIdentity:identity,deleteIdentity:uid=>auth.deleteUser(uid)};
const receipt=()=>randomBytes(32).toString('base64url');
async function request(uid,value=receipt()) {
 const u=await identity(uid);
 return {value,status:await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt:value},
 {uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},u,now)};
}
async function job(uid){return (await db.doc(`private_account_deletions/${uid}`).get()).data();}
async function run(uid,step=cleanup.createAccountDeletionStep(authAdapter,undefined,objects),limit=250) {
 for(let i=0;i<limit;i++){now+=4000000;await api.processAccountDeletionJob(db,uid,step,()=>now);const j=await job(uid);if(j.state==='complete')return j;if(j.state==='pending')return j;}
 throw new Error('Bounded fixture failed to converge');
}
const hash=x=>createHash('sha256').update(x).digest('hex');
test.before(async()=>{
 if(!enabled)return;
 for(const [key,expected] of Object.entries({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8792',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9198',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9298',GCLOUD_PROJECT:project})) assert.equal(process.env[key],expected,`LOCAL guard ${key}`);
 assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS,'No credential files allowed');
 const {initializeApp}=require('firebase-admin/app');
 app=initializeApp({projectId:project,storageBucket:`${project}.appspot.com`});
 db=require('firebase-admin/firestore').getFirestore(app);auth=require('firebase-admin/auth').getAuth(app);
 api=require('../lib/account_deletion_service');cleanup=require('../lib/account_deletion_cleanup');
 store=require('../lib/rating_destructive_job_store').createFirestoreRatingDestructivePrivateDatabase(db);
 aggregate=require('../lib/bitescore_review_aggregate');reads=require('../lib/customer_bitescore_reads');
});
test.beforeEach(async()=>{
 if(!enabled)return;
 now=Date.now();
 assert.equal((await fetch(`http://127.0.0.1:8792/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'})).status,200);
 assert.equal((await fetch(`http://127.0.0.1:9198/emulator/v1/projects/${project}/accounts`,{method:'DELETE'})).status,200);
 for(const uid of ['fake-A','fake-B'])await auth.createUser({uid,email:`${uid}@example.test`,password:'LOCAL-only-fixture-9876',emailVerified:false});
});
test.after(async()=>{if(app)await app.delete();});
const local=(name,fn)=>test(name,{skip:!enabled},fn);
local('A reviews and votes removed; B and shared catalog/accounting survive; orphan child families cleaned',async()=>{
 await db.doc('private_bitescore_runtime/aggregation').set({version:1,enabled:true,epoch:'fixed-local-test-epoch'});
 await db.doc('bitescore_restaurants/shared').set({id:'shared',name:'Shared facts',isActive:true,active:true,createdByUserId:'fake-A',bio:null,restaurantWriteRevision:0});
 await db.doc('bitescore_dishes/shared-dish').set({id:'shared-dish',restaurantId:'shared',name:'Shared dish',isActive:true,createdByUserId:'fake-A',aggregateWriteGeneration:0});
 for(const uid of ['fake-A','fake-B']) {
   const result=await aggregate.saveCustomerBiteScoreReview(store,{uid,emailVerified:true},{schemaVersion:1,expectedUserId:uid,dishId:'shared-dish',restaurantId:'shared',tastinessScore:8,overallImpression:8,qualityScore:8,valueScore:8,headline:`${uid} headline`,notes:`${uid} notes`},new Date(now));
   const id=aggregate.customerBiteScoreReviewDocumentId('shared-dish',uid);await reads.reconcileCustomerBiteScoreReview(db,id);assert.ok(result);
 }
 const aReview=aggregate.customerBiteScoreReviewDocumentId('shared-dish','fake-A'), bReview=aggregate.customerBiteScoreReviewDocumentId('shared-dish','fake-B');
 for(const [id,uid,reviewId] of [['A-on-B','fake-A',bReview],['B-on-A','fake-B',aReview]]) {
   await db.doc(`review_feedback_votes/${id}`).set({userId:uid,reviewId,dishId:'shared-dish',restaurantId:'shared',voteType:'helpful'});await reads.reconcileCustomerBiteScoreFeedback(db,id);
 }
 await db.doc('review_reports/B-about-A').set({reportingUserId:'fake-B',reviewId:aReview,dishId:'shared-dish',restaurantId:'shared'});
 await db.doc('user_profiles/fake-A').set({displayName:'A',contributionPoints:10});
 await db.doc('user_profiles/fake-B').set({displayName:'B',contributionPoints:10});
 for(const child of ['favorite_restaurants','favorite_dishes','favorite_coupons','local_expert_badges','local_expert_badge_celebrations'])await db.doc(`user_profiles/fake-A/${child}/one`).set({restaurantId:'shared',dishId:'shared-dish'});
 await db.doc('customer_redemptions/fake-A/coupon_redemptions/one').set({couponId:'coupon'}); // parent intentionally absent
 await db.doc('bitescore_contribution_point_ledger/A-point').set({userId:'fake-A',pointsDelta:10});
 await db.doc('public_usernames/name-A').set({userId:'fake-A'});await db.doc('public_usernames/reassigned').set({userId:'fake-B'});
 await db.doc('private_device_only_security/device-A').set({opaque:true});
 const saved=await request('fake-A');assert.equal((await request('fake-A',saved.value)).status.operationId,saved.status.operationId);
 await assert.rejects(aggregate.saveCustomerBiteScoreReview(store,{uid:'fake-A',emailVerified:true},{schemaVersion:1,expectedUserId:'fake-A',dishId:'shared-dish',restaurantId:'shared',tastinessScore:8,overallImpression:8,qualityScore:8,valueScore:8,headline:'late',notes:'late'},new Date(now)));
 assert.equal((await run('fake-A')).state,'complete');
 assert.equal(await identity('fake-A'),null);assert.ok(await identity('fake-B'));
 assert.ok(!(await db.doc(`dish_reviews/${aReview}`).get()).exists);assert.ok((await db.doc(`dish_reviews/${bReview}`).get()).exists);
 assert.equal((await db.doc('dish_rating_aggregates/shared-dish').get()).get('ratingCount'),1);
 assert.equal((await db.doc('bitescore_restaurants/shared').get()).get('createdByUserId'),undefined);
 assert.equal((await db.doc('bitescore_dishes/shared-dish').get()).get('name'),'Shared dish');
 assert.equal((await db.doc(`private_bitescore_review_stats/${hash(bReview)}`).get()).get('helpfulCount'),0);
 assert.ok(!(await db.doc('review_reports/B-about-A').get()).exists);
 assert.ok((await db.doc('public_usernames/reassigned').get()).exists);assert.ok((await db.doc('private_device_only_security/device-A').get()).exists);
 for(const child of ['favorite_restaurants','favorite_dishes','favorite_coupons','local_expert_badges','local_expert_badge_celebrations'])assert.ok((await db.collection(`user_profiles/fake-A/${child}`).get()).empty);
 assert.ok((await db.collection('customer_redemptions/fake-A/coupon_redemptions').get()).empty);
 // Delayed source events reread current documents, cannot recreate A's mirrors.
 await reads.reconcileCustomerBiteScoreReview(db,aReview);await reads.reconcileCustomerBiteScoreFeedback(db,'B-on-A');
 assert.ok(!(await db.doc(`private_bitescore_reviewer_stats/${hash('fake-A')}`).get()).exists);
 assert.equal((await api.getAccountDeletionStatusHandler(db,{schemaVersion:1,receipt:saved.value},null)).state,'complete');
 await auth.createUser({uid:'fake-A-new',email:'fake-A@example.test',password:'LOCAL-only-fixture-9876'});
 assert.equal(await api.processAccountDeletionJob(db,'fake-A',cleanup.createAccountDeletionStep(authAdapter,undefined,objects),()=>now),'busy');assert.ok(await identity('fake-A-new'));
});
local('lost response receipt recovery, wrong-account/unknown receipt denial, duplicate workers and lease recovery',async()=>{
 const r=await request('fake-A');
 assert.equal((await api.getAccountDeletionStatusHandler(db,{schemaVersion:1,receipt:r.value},null)).operationId,r.status.operationId);
 await assert.rejects(api.getAccountDeletionStatusHandler(db,{schemaVersion:1,receipt:r.value},'fake-B'));
 await assert.rejects(api.getAccountDeletionStatusHandler(db,{schemaVersion:1,receipt:receipt()},null));
 let release;const wait=new Promise(resolve=>release=resolve);let calls=0;
 const step=async()=>{calls++;await wait;return {phase:'verify'};};
 const first=api.processAccountDeletionJob(db,'fake-A',step,()=>now);await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(await api.processAccountDeletionJob(db,'fake-A',step,()=>now),'busy');release();await first;assert.equal(calls,1);
 await db.doc('private_account_deletions/fake-A').update({leaseToken:'c'.repeat(48),leaseUntilMs:now+120000});
 assert.equal(await api.processAccountDeletionJob(db,'fake-A',async()=>({phase:'verify'}),()=>now),'busy');now+=120001;
 assert.equal(await api.processAccountDeletionJob(db,'fake-A',async()=>({phase:'verify'}),()=>now),'advanced');
});
local('ambiguous Auth response is durable and retries absent identity to verified completion',async()=>{
 await request('fake-A');let once=true;
 const adapter={getIdentity:identity,deleteIdentity:async uid=>{await auth.deleteUser(uid);if(once){once=false;throw new Error('injected lost response');}}};
 const step=cleanup.createAccountDeletionStep(adapter,undefined,objects);const partial=await run('fake-A',step);assert.equal(partial.state,'pending');assert.equal(partial.phase,'auth');assert.equal(await identity('fake-A'),null);
 assert.equal((await run('fake-A',step)).state,'complete');
});
local('ambiguous media and mixed business roots remain pending with no Auth deletion',async()=>{
 await db.doc('private_bitescore_runtime/aggregation').set({version:1,enabled:true,epoch:'fixed-local-test-epoch'});
 await db.doc('bitescore_restaurants/media-restaurant').set({id:'media-restaurant',name:'Shared facts',isActive:true});
 await db.doc('bitescore_dishes/media-dish').set({id:'media-dish',restaurantId:'media-restaurant',name:'Shared dish',isActive:true,imageCount:1});
 await db.doc('bitescore_dish_images/unproven').set({id:'unproven',uploadedByUserId:'fake-A',dishId:'media-dish',restaurantId:'media-restaurant',reviewId:null,storagePath:'foreign/image.jpg',imageUrl:'https://foreign.invalid/image',sortOrder:0,helpfulCount:0,notHelpfulCount:0,createdAt:new Date(now),updatedAt:new Date(now)});
 await request('fake-A');assert.equal((await run('fake-A')).reason,'media');assert.ok(await identity('fake-A'));assert.ok(!(await db.doc('bitescore_dish_images/unproven').get()).exists);assert.equal((await db.doc('bitescore_dishes/media-dish').get()).get('imageCount'),0);assert.equal((await db.collection('private_account_deletions/fake-A/media_items').get()).docs[0].get('disposition'),'unproven_original_uploader');
 await db.doc('restaurant_accounts/fake-B').set({stripeCustomerId:'cus_fixture'});await request('fake-B');assert.equal((await run('fake-B')).reason,'billing');assert.ok((await db.doc('restaurant_accounts/fake-B').get()).exists);
});

local('real local callable request rejects revoked sessions and wrong UID; freshness uses auth_time',async()=>{
 const response=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-fake-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'fake-A@example.test',password:'LOCAL-only-fixture-9876',returnSecureToken:true})});
 assert.equal(response.status,200);const credentials=await response.json();
 const runtime=require('../lib/account_deletion_runtime');
 const requestValue={auth:{uid:'fake-A'},rawRequest:{headers:{authorization:`Bearer ${credentials.idToken}`}},data:{schemaVersion:1,expectedUid:'fake-B',confirmation:'DELETE',receipt:receipt()}};
 await assert.rejects(runtime.requestAccountDeletion.run(requestValue));
 requestValue.data.expectedUid='fake-A';
 const accepted=await runtime.requestAccountDeletion.run(requestValue);assert.equal(accepted.state,'requested');
 // Emulator supports tokensValidAfterTime through Admin update/revocation.
 await new Promise(resolve=>setTimeout(resolve,1100));
 await auth.revokeRefreshTokens('fake-A');
 await assert.rejects(runtime.requestAccountDeletion.run(requestValue),e=>e.code==='unauthenticated');
 const parts=credentials.idToken.split('.');const expired=JSON.parse(Buffer.from(parts[1],'base64url'));expired.exp=Math.floor(Date.now()/1000)-60;
 const expiredRequest={...requestValue,rawRequest:{headers:{authorization:`Bearer ${parts[0]}.${Buffer.from(JSON.stringify(expired)).toString('base64url')}.${parts[2]}`}}};
 await assert.rejects(runtime.requestAccountDeletion.run(expiredRequest),e=>e.code==='unauthenticated');
 await auth.updateUser('fake-A',{disabled:true});
 await assert.rejects(runtime.requestAccountDeletion.run(requestValue),e=>e.code==='unauthenticated');
});
local('new milestone work is suppressed after the fence without stalling shared work',async()=>{
 await request('fake-A');
 const {claimReviewMilestoneReconciliationLock}=require('../lib/review_milestone_reconciliation_lock');
 const result=await claimReviewMilestoneReconciliationLock(db,{userId:'fake-A',operationId:'fake-operation',lockToken:'a'.repeat(64)},{now:()=>new Date(now)});
 assert.equal(result.status,'account-deletion');
 assert.deepEqual((await db.doc('private_review_milestone_reconciliation_locks/fake-A').get()).data(),{accountDeletionRequested:true});
});

local('post-Auth verification recovers a late personal root and refuses retained private accounting',async()=>{
 await request('fake-A');
 const step=cleanup.createAccountDeletionStep(authAdapter,undefined,objects);
 for(let i=0;i<100&&(await job('fake-A')).phase!=='auth_verify';i++) {
  now+=4000000; await api.processAccountDeletionJob(db,'fake-A',step,()=>now);
 }
 assert.equal((await job('fake-A')).phase,'auth_verify');
 assert.equal(await identity('fake-A'),null);
 const privateRow=db.doc('private_rating_destructive_job_items/late-local-A');
 await privateRow.set({userId:'fake-A'});
 now+=4000000; await api.processAccountDeletionJob(db,'fake-A',step,()=>now);
 assert.equal((await job('fake-A')).state,'pending');
 assert.equal((await job('fake-A')).reason,'accepted_work');
 await privateRow.delete(); // synthetic recovery: accepted worker has now drained
 const generation=require('../lib/customer_bitescore_profile_generation').customerBiteScoreProfileGenerationPath('fake-A');
 await db.doc(generation).set({localLateFixture:true});
 now+=4000000; await api.processAccountDeletionJob(db,'fake-A',step,()=>now);
 assert.equal((await job('fake-A')).phase,'identity');
 assert.equal((await run('fake-A',step)).state,'complete');
 assert.ok(!(await db.doc(generation).get()).exists);
});

local('bounded upload-grant preparation makes progress before atomic acceptance and leaves B grants alone',async()=>{
 for(let start=0;start<1701;start+=400){const batch=db.batch();for(let i=start;i<Math.min(start+400,1701);i++)batch.set(db.doc(`private_menu_image_upload_authorizations/local-${i}`),{ownerUserId:'fake-A',state:'active'});await batch.commit();}
 await db.doc('private_menu_image_upload_authorizations/B-grant').set({ownerUserId:'fake-B',state:'active'});
 await assert.rejects(request('fake-A'),e=>e.code==='resource-exhausted');assert.equal((await db.doc('private_account_deletions/fake-A').get()).exists,false);
 assert.equal((await db.collection('private_menu_image_upload_authorizations').where('ownerUserId','==','fake-A').where('state','==','active').get()).size,501);
 await request('fake-A');assert.equal((await db.collection('private_menu_image_upload_authorizations').where('ownerUserId','==','fake-A').where('state','==','active').get()).size,0);
 assert.equal((await db.doc('private_menu_image_upload_authorizations/B-grant').get()).get('state'),'active');
});
local('acceptance preserves an active milestone lock and its owner can drain without erasing the deletion fence',async()=>{
 const ml=require('../lib/review_milestone_reconciliation_lock'),lock={userId:'fake-A',operationId:'local-active-work',lockToken:'a'.repeat(64)},clock={now:()=>new Date(now)};
 await ml.claimReviewMilestoneReconciliationLock(db,lock,clock);await request('fake-A');
 const ref=db.doc(ml.reviewMilestoneReconciliationLockPath('fake-A'));assert.equal((await ref.get()).get('state'),'active');assert.equal((await ref.get()).get('accountDeletionRequested'),true);
 assert.equal((await ml.claimReviewMilestoneReconciliationLock(db,lock,clock)).status,'already-owned');
 await ml.recordReviewMilestoneReconciliationTerminalState(db,lock,{countStateFingerprint:'b'.repeat(64),reconciliationStateFingerprint:'c'.repeat(64)});
 await ml.releaseReviewMilestoneReconciliationLock(db,lock,clock);assert.equal((await ref.get()).get('state'),'released');assert.equal((await ref.get()).get('accountDeletionRequested'),true);
 assert.equal((await ml.claimReviewMilestoneReconciliationLock(db,{...lock,operationId:'new-forbidden'},clock)).status,'account-deletion');
});
