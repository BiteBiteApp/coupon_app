'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const rulesRequire=createRequire(path.resolve(__dirname,'../../firestore_rules_tests/package.json'));
const {initializeTestEnvironment,assertFails}=rulesRequire('@firebase/rules-unit-testing');
const {ref,uploadBytes,getBytes}=rulesRequire('firebase/storage');
const enabled=process.env.RUN_UGC_TERMS_EMULATOR==='1';
const local=(name,fn)=>test(name,{skip:!enabled},fn);
const project='demo-coupon-app-rules',bucketName=`${project}.appspot.com`;
const termsApi=require('../lib/bitescore_terms'),photo=require('../lib/photo_screening'),text=require('../lib/review_text_moderation');
const {saveCustomerBiteScoreReview:save}=require('../lib/bitescore_review_aggregate');
const creation=require('../lib/customer_bitescore_creation');
const v1={version:'TEST-ONLY-approved-v1',text:'Synthetic test fixture. Not legal terms.'},v2={...v1,version:'TEST-ONLY-approved-v2'};
let app,db,store,env,auth,bucket,objects,now,calls;
const clean={adult:'VERY_UNLIKELY',violence:'VERY_UNLIKELY',racy:'UNLIKELY',medical:'VERY_LIKELY',spoof:'VERY_LIKELY'};
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=','base64');
const request=(changes={},uid='writer')=>({auth:{uid,token:{email_verified:true,admin:uid==='admin',firebase:{sign_in_provider:'password'}}},data:{schemaVersion:1,expectedUserId:uid,dishId:'dish',restaurantId:'restaurant',reviewId:null,mode:'gallery',contentType:'image/png',bytesBase64:bytes.toString('base64'),retry:false,...changes}});
const options=(approvedTerms=v1,provider={name:'fake',screen:async()=>{calls++;return clean;}})=>({approvedTerms,provider,objects,now:()=>now.getTime()});
const configure=policy=>db.doc(termsApi.biteScoreTermsRuntimePath).set({schemaVersion:1,required:true,version:policy.version,acceptedVersions:[policy.version,...(policy.acceptedPriorVersions??[])]});
const accept=(policy=v1,uid='writer')=>termsApi.customerBiteScoreTerms(store,{uid,emailVerified:true},{expectedUserId:uid,version:policy.version},true,now,policy);
const read=async p=>(await db.doc(p).get()).data();
const reviewInput=(extra={})=>({schemaVersion:1,expectedUserId:'writer',dishId:'dish',restaurantId:'restaurant',headline:'',notes:'',overallImpression:8,tastinessScore:7,qualityScore:9,valueScore:6,...extra});
const review=(extra={},policy=v1,provider)=>save(store,{uid:'writer',emailVerified:true},reviewInput(extra),now,policy,provider,()=>now);
const row=async result=>read(`${photo.screeningCollection}/${result.imageId}`);
const decision=(r,decision='approved')=>({auth:request({},'admin').auth,data:{schemaVersion:1,expectedUserId:'admin',imageId:r.imageId,generation:r.generation,decision}});
test.before(async()=>{if(!enabled)return;
 for(const [name,value]of Object.entries({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8792',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9298',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9198'}))assert.equal(process.env[name],value);
 assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
 app=require('firebase-admin/app').initializeApp({projectId:project,storageBucket:bucketName});db=require('firebase-admin/firestore').getFirestore(app);auth=require('firebase-admin/auth').getAuth(app);bucket=require('firebase-admin/storage').getStorage(app).bucket();
 store=require('../lib/rating_destructive_job_store').createFirestoreRatingDestructivePrivateDatabase(db);objects=photo.screeningObjects();
 env=await initializeTestEnvironment({projectId:project,firestore:{host:'127.0.0.1',port:8792,rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')},storage:{host:'127.0.0.1',port:9298,rules:fs.readFileSync(path.resolve(__dirname,'../../storage.rules'),'utf8')}});
 for(const uid of ['writer','other','admin']){try{await auth.deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}await auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true,password:'Local-test-only-12345'});}
});
test.beforeEach(async()=>{if(!enabled)return;await env.clearFirestore();await bucket.deleteFiles({force:true});now=new Date();calls=0;
 for(const[p,d]of Object.entries({[photo.screeningRuntimePath]:{required:true,enabled:true,policyVersion:photo.screeningPolicyVersion,retentionApproved:true,retentionPolicyVersion:'photo-retention-v1',failedScreeningRetentionDays:7,failedScreeningRetentionApproved:true,cleanupEnabled:true,monthlyAllowance:100},'private_bitescore_runtime/aggregation':{enabled:true,version:1,epoch:'terms'},[text.reviewTextRuntimePath]:{...text.reviewTextRuntimeCandidate,required:true,processingEnabled:true,cleanupEnabled:true,retentionApproved:true},'bitescore_restaurants/restaurant':{id:'restaurant',name:'Synthetic',normalizedName:'synthetic',address:'1 Test St',city:'Test',state:'NY',zipCode:'10001',latitude:40.75,longitude:-73.99,isActive:true,active:true,isClaimed:false,ownerUserId:null,restaurantWriteRevision:0},'bitescore_dishes/dish':{id:'dish',name:'Synthetic dish',normalizedName:'synthetic dish',restaurantId:'restaurant',restaurantName:'Synthetic',category:'Food',isActive:true,mergedIntoDishId:null,imageCount:0}}))await db.doc(p).set(d);
 await configure(v1);
});
test.after(async()=>{if(env)await env.cleanup();if(app)await app.delete();});
local('photo admission denies missing/obsolete receipt before Storage writes, provider calls or cost reservation',async()=>{
 for(const receipt of [null,{version:'old',acceptedAt:now}]){
  if(receipt)await db.doc('user_profiles/writer').set({termsAcceptance:receipt});
  await assert.rejects(photo.submitScreenedPhotoHandler(db,request(),options()),{code:'failed-precondition'});
  assert.equal(calls,0);assert.equal((await bucket.getFiles())[0].length,0);assert.equal((await db.collection(photo.screeningCollection).get()).size,0);assert.equal((await db.collection('private_bitescore_screening_usage').get()).size,0);
 }
});
for(const mode of ['gallery','missing','review'])local(`${mode} upload uses exact UID receipt and maintains generation, rating and point boundaries`,async()=>{
 await accept();let reviewId=null;
 if(mode==='review')reviewId=(await review()).review.id;
 const result=await photo.submitScreenedPhotoHandler(db,request({mode,reviewId}),options());assert.equal(result.state,'approved');assert.equal(calls,1);
 const r=await row(result),source=await read(`bitescore_dish_images/${result.imageId}`);assert.equal(source.storageGeneration,r.generation);assert.equal(source.uploadedByUserId,'writer');assert.equal((await read('bitescore_dishes/dish')).imageCount,1);
 assert.ok((await getBytes(ref(env.unauthenticatedContext().storage(bucketName),r.storagePath))).byteLength>0);
 await assert.rejects(photo.submitScreenedPhotoHandler(db,request({},'other'),options()),{code:'failed-precondition'});
 if(mode==='review')assert.equal((await read('dish_rating_aggregates/dish')).ratingCount,1);
});
local('version changing while provider runs holds photo private; current reacceptance permits exact pending approval',async()=>{
 await accept();let release,entered;const started=new Promise(r=>entered=r);
 const pending=photo.submitScreenedPhotoHandler(db,request(),options(v1,{name:'fake',screen:async()=>{calls++;entered();await new Promise(r=>release=r);return clean;}}));await started;await configure(v2);release();
 const result=await pending;assert.equal(result.state,'failed');const r=await row(result);
 await assertFails(getBytes(ref(env.unauthenticatedContext().storage(bucketName),r.storagePath)));
 await assert.rejects(photo.decideScreeningPhotoHandler(db,decision(r),options(v2)),{code:'failed-precondition'});
 await accept(v2);assert.equal((await photo.decideScreeningPhotoHandler(db,decision(r),options(v2))).state,'approved');assert.equal(calls,1);
});
local('pending flagged photo requires latest customer policy; Admin receipt is irrelevant; rejection survives',async()=>{
 await accept();const result=await photo.submitScreenedPhotoHandler(db,request(),options(v1,{name:'fake',screen:async()=>({...clean,adult:'POSSIBLE'})})),r=await row(result);
 assert.equal(result.state,'needs_review');await configure(v2);await accept(v2,'admin');
 await assert.rejects(photo.decideScreeningPhotoHandler(db,decision(r),options(v2)),{code:'failed-precondition'});
 assert.equal((await photo.decideScreeningPhotoHandler(db,decision(r,'rejected'),options(v2))).state,'rejected');
});
local('mandatory policy cannot publish without approved final source; disabled policy preserves prior saves',async()=>{
 await assert.rejects(review({},null),{code:'failed-precondition'});await assert.rejects(photo.submitScreenedPhotoHandler(db,request(),options(null)),{code:'failed-precondition'});
 await db.doc(termsApi.biteScoreTermsRuntimePath).set({required:false});assert.equal((await review({},null)).textStatus,'published');assert.equal((await photo.submitScreenedPhotoHandler(db,request(),options(null))).state,'approved');
});
local('pending written words require renewed acceptance; original submission time and rating remain unchanged',async()=>{
 await accept();const flagged={screen:async()=>({flagged:true})};const result=await review({headline:'Good',notes:'Pending words'},v1,flagged);
 assert.equal(result.textStatus,'pending');const p=await read(text.textPath(result.review.id)),rating=await read('dish_rating_aggregates/dish');
 await configure(v2);await assert.rejects(text.decideReviewText(store,'admin',result.review.id,p.version,true,now,v2),{code:'failed-precondition'});
 assert.equal((await read(`dish_reviews/${result.review.id}`)).notes,null);assert.deepEqual(await read('dish_rating_aggregates/dish'),rating);
 now=new Date(now.getTime()+1000);await accept(v2);await text.decideReviewText(store,'admin',result.review.id,p.version,true,now,v2);
 assert.equal((await read(`dish_reviews/${result.review.id}`)).notes,'Pending words');assert.deepEqual((await read(text.textPath(result.review.id))).createdAt,p.createdAt);assert.deepEqual(await read('dish_rating_aggregates/dish'),rating);
});
local('clean text callback cannot publish across mandatory version change',async()=>{
 await accept();let release,entered;const started=new Promise(r=>entered=r);const running=review({notes:'Delayed clean'},v1,{screen:async()=>{entered();await new Promise(r=>release=r);return {flagged:false};}});
 await started;await configure(v2);release();const result=await running;assert.equal(result.textStatus,'screening_failed');assert.equal((await read(`dish_reviews/${result.review.id}`)).notes,null);assert.equal((await read('dish_rating_aggregates/dish')).ratingCount,1);
});
local('new restaurant/dish and existing-dish enrichment are guarded before any orphaned public content',async()=>{
 const context={userId:'writer',email:'writer@example.test',emailVerified:true,isAnonymous:false,approvedTerms:v1};
 const input={schemaVersion:1,expectedUserId:'writer',requestId:'terms_restaurant_123',name:'New Test Restaurant',address:'2 Test St',city:'Test',state:'NY',zipCode:'10002',location:{latitude:40.75,longitude:-73.99}};
 await assert.rejects(creation.resolveCustomerBiteScoreRestaurantCreationHandler(store,input,context,now),{code:'failed-precondition'});assert.equal((await db.collection('bitescore_restaurants').get()).size,1);
 await accept();const r=await creation.resolveCustomerBiteScoreRestaurantCreationHandler(store,input,context,now);
 const dishInput={schemaVersion:1,expectedUserId:'writer',requestId:'terms_dish_123456',restaurantId:r.restaurant.id,dishName:'Test Dish',category:'Food',categoryTags:['food'],allowExistingMatch:true};
 const d=await creation.resolveCustomerBiteScoreDishCreationHandler(store,dishInput,context,now);assert.equal(d.wasCreated,true);
 assert.equal((await creation.resolveCustomerBiteScoreRestaurantCreationHandler(store,input,context,now)).restaurant.id,r.restaurant.id);
 await configure(v2);await assert.rejects(creation.resolveCustomerBiteScoreDishCreationHandler(store,{...dishInput,requestId:'terms_dish_other123',category:'New'},context,now),{code:'failed-precondition'});
 assert.equal((await read(`bitescore_dishes/${d.dish.id}`)).category,'Food');
});
local('acceptance cannot overcome deletion, restrictions, anonymous identity or wrong expected UID',async()=>{
 await accept();for(const fence of ['private_account_deletions/writer','user_profiles/writer/posting_restriction_state/current']){
 await db.doc(fence).set(fence.startsWith('user_profiles')?{schemaVersion:1,revision:1,kind:'indefinite',startsAt:new Date(1),endsAt:null,releasedAt:null}:{});
 await assert.rejects(photo.submitScreenedPhotoHandler(db,request(),options()));await assert.rejects(review());await db.doc(fence).delete();}
 const anonymous=request();anonymous.auth.token.firebase.sign_in_provider='anonymous';await assert.rejects(photo.submitScreenedPhotoHandler(db,anonymous,options()),{code:'unauthenticated'});
 await assert.rejects(photo.submitScreenedPhotoHandler(db,request({expectedUserId:'other'}),options()),{code:'permission-denied'});assert.equal(calls,0);
});
local('direct public Storage bytes stay closed even for accepted customers; private receipt is never exposed',async()=>{
 await accept();const client=env.authenticatedContext('writer',{email_verified:true,firebase:{sign_in_provider:'password'}});
 for(const p of ['bitescore_dishes/dish/images/new.jpg','bitescore_user_uploads/owner/dish_images/dish/new.jpg'])await assertFails(uploadBytes(ref(client.storage(bucketName),p),bytes,{contentType:'image/png'}));
 await db.doc('user_profiles/writer').set({privateEmail:'secret@example.test',phone:'+1555',termsAcceptance:{version:v1.version,acceptedAt:now}});
 const result=await termsApi.customerBiteScoreTerms(store,{uid:'writer',emailVerified:true},{expectedUserId:'writer'},false,now,v1);
 assert.deepEqual(Object.keys(result).sort(),['accepted','enabled','schemaVersion','text','userId','version']);
});
