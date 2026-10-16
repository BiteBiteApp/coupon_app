'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module'),{createHash}=require('node:crypto');
const rulesRequire=createRequire(path.resolve(__dirname,'../../firestore_rules_tests/package.json'));
const {initializeTestEnvironment,assertFails,assertSucceeds}=rulesRequire('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc}=rulesRequire('firebase/firestore');
const {ref,uploadBytes,getBytes,getMetadata,getDownloadURL}=rulesRequire('firebase/storage');
const enabled=process.env.RUN_PHOTO_SCREENING_EMULATOR==='1';
const local=(name,fn)=>test(name,{skip:!enabled},fn);
const project='demo-coupon-app-rules',bucketName=`${project}.appspot.com`;
let app,db,bucket,env,auth,api,objects,now,calls;
const clean={adult:'VERY_UNLIKELY',violence:'VERY_UNLIKELY',racy:'UNLIKELY',medical:'VERY_LIKELY',spoof:'VERY_LIKELY'};
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=','base64');
const signed=uid=>({uid,token:{email_verified:true,admin:uid==='admin',firebase:{sign_in_provider:'password'}}});
const request=(changes={},uid='customer')=>({auth:signed(uid),data:{schemaVersion:1,expectedUserId:uid,dishId:'dish',restaurantId:'restaurant',reviewId:null,mode:'gallery',contentType:'image/png',bytesBase64:bytes.toString('base64'),retry:false,...changes}});
const options=(provider={name:'fake',screen:async()=>{calls++;return clean;}})=>({provider,now:()=>now,objects});
const adminData=(row,extra={})=>({schemaVersion:1,expectedUserId:'admin',imageId:row.imageId,generation:row.generation??null,...extra});
const submit=(changes={},opts=options(),uid='customer')=>api.submitScreenedPhotoHandler(db,request(changes,uid),opts);
const record=async result=>(await db.doc(`${api.screeningCollection}/${result.imageId}`).get()).data();
const media=async row=>fetch(`http://127.0.0.1:9298/v0/b/${bucketName}/o/${encodeURIComponent(row.storagePath)}?alt=media`);
const client=(uid,admin=false)=>env.authenticatedContext(uid,{admin,email_verified:true,firebase:{sign_in_provider:'password'}});
test.before(async()=>{if(!enabled)return;
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8792');assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:9298');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
 app=require('firebase-admin/app').initializeApp({projectId:project,storageBucket:bucketName});db=require('firebase-admin/firestore').getFirestore(app);bucket=require('firebase-admin/storage').getStorage(app).bucket();auth=require('firebase-admin/auth').getAuth(app);
 api=require('../lib/photo_screening');objects=api.screeningObjects();
 env=await initializeTestEnvironment({projectId:project,firestore:{host:'127.0.0.1',port:8792,rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')},storage:{host:'127.0.0.1',port:9298,rules:fs.readFileSync(path.resolve(__dirname,'../../storage.rules'),'utf8')}});
 for(const uid of ['customer','other','admin','owner']){try{await auth.deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}await auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true,password:'Local-photo-12345'});if(uid==='admin')await auth.setCustomUserClaims(uid,{admin:true});}
});
test.beforeEach(async()=>{if(!enabled)return;await env.clearFirestore();await env.clearStorage();now=Date.now();calls=0;
 for(const [p,d]of Object.entries({[api.screeningRuntimePath]:{required:true,enabled:true,policyVersion:api.screeningPolicyVersion,retentionApproved:true,monthlyAllowance:100},'private_bitescore_runtime/aggregation':{enabled:true,version:1,epoch:'screening'},'bitescore_restaurants/restaurant':{id:'restaurant',name:'Synthetic restaurant',isActive:true,ownerUserId:'owner',isClaimed:true},'bitescore_dishes/dish':{id:'dish',name:'Synthetic dish',restaurantId:'restaurant',isActive:true,imageCount:0},'dish_reviews/review':{userId:'customer',dishId:'dish',restaurantId:'restaurant'}}))await db.doc(p).set(d);
});
test.after(async()=>{if(env)await env.cleanup();if(app)await app.delete();});
local('ordinary photo: actual tokenless Storage bytes denied pending, approved on exact generation, one scan under concurrency',async()=>{
 let resolve,entered;const ready=new Promise(r=>entered=r),wait=new Promise(r=>resolve=r);
 const opts=options({name:'fake',screen:async()=>{calls++;entered();return wait;}});
 const first=submit({},opts);await ready;
 const second=await submit({},opts);assert.equal(second.state,'scanning');const pending=await record(second);
 assert.equal((await media(pending)).status,403);const sr=ref(env.unauthenticatedContext().storage(bucketName),pending.storagePath);
 await assertFails(getMetadata(sr));await assertFails(getDownloadURL(sr));await assertFails(getBytes(sr));
 assert.equal((await bucket.file(pending.storagePath).getMetadata())[0].metadata.firebaseStorageDownloadTokens,undefined);
 assert.equal((await db.collection('bitescore_dish_images').get()).size,0);
 resolve(clean);const result=await first;assert.equal(result.state,'approved');assert.equal(calls,1);assert.equal((await media(await record(result))).status,200);
 assert.equal((await db.doc('bitescore_dishes/dish').get()).get('imageCount'),1);
 assert.equal((await submit()).image.id,result.imageId);assert.equal(calls,1);
 const source=(await db.doc(`bitescore_dish_images/${result.imageId}`).get()).data();assert.equal(source.storageGeneration,pending.generation);
 assert.equal(result.image.reportTargetVersion,require('../lib/customer_bitescore_reads').customerBiteScorePhotoVersion(source));
 await require('../lib/customer_bitescore_reads').reconcileCustomerBiteScoreImage(db,result.imageId);
 assert.equal((await db.doc('bitescore_dishes/dish').get()).get('imageCount'),1);
});
local('suspicious/ambiguous held privately; authorized preview and decision; no repeated scan',async()=>{
 const result=await submit({},options({name:'fake',screen:async()=>{calls++;return {...clean,adult:'VERY_LIKELY'};}}));
 assert.equal(result.state,'needs_review');const row=await record(result);assert.equal((await media(row)).status,403);assert.equal((await db.doc('bitescore_dishes/dish').get()).get('imageCount'),0);
 assert.equal((await submit()).state,'needs_review');assert.equal(calls,1);
 for(const uid of ['customer','other'])await assert.rejects(api.previewScreeningPhotoHandler(db,{auth:signed(uid),data:{...adminData(row),expectedUserId:uid}},options()),{code:'permission-denied'});
 const preview=await api.previewScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row)},options());assert.equal(preview.bytesBase64,bytes.toString('base64'));assert(!JSON.stringify(preview).includes('https://'));
 const queue=await api.listScreeningPhotosHandler(db,{auth:signed('admin'),data:{schemaVersion:1,expectedUserId:'admin',after:null}});assert.equal(queue.items[0].dishName,'Synthetic dish');
 const approved=await api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'approved'})},options());assert.equal(approved.state,'approved');assert.equal((await media(row)).status,200);
 await assert.rejects(api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'rejected'})},options()),{code:'failed-precondition'});
});
local('rejection stays nonpublic and cannot be reversed or retried into publication',async()=>{
 const result=await submit({},options({name:'fake',screen:async()=>({...clean,violence:'POSSIBLE'})})),row=await record(result);
 await api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'rejected'})},options());
 assert.equal((await submit({retry:true})).state,'rejected');assert.equal((await media(row)).status,403);
 await assert.rejects(api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'approved'})},options()),{code:'failed-precondition'});
});
local('missing/malformed provider response and timeout fail closed; explicit bounded retry only',async()=>{
 const opts=options({name:'fake',screen:async()=>{calls++;return {};}});
 const failed=await submit({},opts);assert.equal(failed.state,'failed');assert.equal((await submit({},opts)).state,'failed');assert.equal(calls,1);
 assert.equal((await submit({retry:true},opts)).state,'failed');assert.equal(calls,1);
 now+=181000;assert.equal((await submit({retry:true},opts)).state,'failed');assert.equal(calls,2);
 now+=999999;await submit({retry:true},opts);assert.equal(calls,2);assert.equal((await media(await record(failed))).status,403);
 const timeout={...options({name:'fake',screen:async()=>new Promise(()=>{})}),providerTimeoutMs:5};
 assert.equal((await submit({},timeout,'other')).state,'failed');
});
local('auth account switch, malformed identity, forged verdict/URL and deleted account denied',async()=>{
 for(const changes of [{expectedUserId:'other'},{dishId:'../dish'},{approved:true},{imageUrl:'https://example.test/x'},{bytesBase64:'x'},{contentType:'text/html'}])await assert.rejects(submit(changes));
 await assert.rejects(api.submitScreenedPhotoHandler(db,{...request(),auth:null},options()),{code:'unauthenticated'});
 await auth.deleteUser('other');await assert.rejects(submit({},options(),'other'),{code:'failed-precondition'});await auth.createUser({uid:'other'});
 assert.equal(calls,0);
});
local('review/missing/gallery share screening; exact review ownership and missing-photo race protected',async()=>{
 await assert.rejects(submit({mode:'review',reviewId:'review'},options(),'other'),{code:'failed-precondition'});
 const result=await submit({mode:'review',reviewId:'review'});assert.equal(result.image.reviewId,'review');
 await assert.rejects(submit({mode:'missing'}),{code:'failed-precondition'});
 assert.equal((await submit({},options(),'other')).state,'approved');assert.equal(calls,2);
});
local('deleted/retired parents and active posting restriction deny before costs',async()=>{
 for(const [p,d]of [['private_account_deletions/customer',{state:'requested'}],['user_profiles/customer/posting_restriction_state/current',{schemaVersion:1,kind:'indefinite',revision:1,startsAt:new Date(),endsAt:null,releasedAt:null}],['bitescore_dishes/dish',{isActive:false}]]){
  const previous=(await db.doc(p).get()).data();await db.doc(p).set(d,{merge:true});await assert.rejects(submit());if(previous)await db.doc(p).set(previous);else await db.doc(p).delete();
 }
 await db.doc('bitescore_restaurants/restaurant').delete();await assert.rejects(submit());assert.equal(calls,0);
});
local('account deletion/restriction/parent retirement during scan never publishes',async()=>{
 for(const [i,p,d]of [[0,'private_account_deletions/customer',{state:'requested'}],[1,'bitescore_dishes/dish',{isActive:false}],[2,'user_profiles/customer/posting_restriction_state/current',{schemaVersion:1,kind:'indefinite',revision:1,startsAt:new Date(),endsAt:null,releasedAt:null}]]){
  const previous=(await db.doc(p).get()).data();const opts=options({name:'fake',screen:async()=>{await db.doc(p).set(d,{merge:true});return clean;}});
  const result=await submit({bytesBase64:Buffer.concat([bytes,Buffer.from([i])]).toString('base64')},opts);assert.equal(result.state,'failed');assert.equal((await media(await record(result))).status,403);
  if(previous)await db.doc(p).set(previous);else await db.doc(p).delete();
 }
 assert.equal((await db.collection('bitescore_dish_images').get()).size,0);
});
local('changed/deleted generation cannot be automatically or manually approved',async()=>{
 const opts=options({name:'fake',screen:async()=>{const row=(await db.collection(api.screeningCollection).get()).docs[0].data();await bucket.file(row.storagePath).save(Buffer.from('replacement'),{resumable:false});return clean;}});
 const failed=await submit({},opts),row=await record(failed);assert.equal(failed.state,'failed');assert.equal((await media(row)).status,403);
 await assert.rejects(api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'approved'})},options()),{code:'failed-precondition'});
 await bucket.file(row.storagePath).delete();await assert.rejects(api.previewScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row)},options()),{code:'not-found'});
 await api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'rejected'})},options());
});
local('allowance is atomic across users; disabled or absent allowance/retention never calls provider',async()=>{
 for(const change of [{enabled:false},{monthlyAllowance:0},{monthlyAllowance:null},{retentionApproved:false},{policyVersion:'unapproved'}]){
  const prior=(await db.doc(api.screeningRuntimePath).get()).data();await db.doc(api.screeningRuntimePath).update(change);await assert.rejects(submit());await db.doc(api.screeningRuntimePath).set(prior);
 }
 await db.doc(api.screeningRuntimePath).update({monthlyAllowance:1});
 const results=await Promise.allSettled([submit(),submit({},options(),'other')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(calls,1);
 assert.equal((await db.doc(`private_bitescore_screening_usage/${new Date(now).toISOString().slice(0,7)}`).get()).get('reservedUnits'),1);
});
local('global leases and per-user admission bound concurrency; live pause blocks in-flight auto publication',async()=>{
 await db.doc('private_bitescore_screening_usage/concurrency').set({active:{a:now+10000,b:now+10000,c:now+10000,d:now+10000}});await assert.rejects(submit(),{code:'resource-exhausted'});assert.equal(calls,0);
 await db.doc('private_bitescore_screening_usage/concurrency').delete();await db.doc('user_profiles/customer/photo_screening_state/admission').set({count:4,windowAt:now});await assert.rejects(submit(),{code:'resource-exhausted'});
 await db.doc('user_profiles/customer/photo_screening_state/admission').delete();const result=await submit({},options({name:'fake',screen:async()=>{await db.doc(api.screeningRuntimePath).update({enabled:false});return clean;}}));assert.equal(result.state,'failed');assert.equal((await media(await record(result))).status,403);
});
local('server gate blocks legacy publication and all client public-write/Storage bypasses including Admin and owner',async()=>{
 const legacy=require('../lib/customer_bitescore_photos');await assert.rejects(legacy.createCustomerBiteScorePhotoHandler(db,{auth:signed('customer'),data:{schemaVersion:1,expectedUserId:'customer',imageId:'x',dishId:'dish',restaurantId:'restaurant',reviewId:null,imageUrl:'x',storagePath:'x',mode:'gallery'}}),{code:'failed-precondition'});
 const result=await submit(),row=await record(result),source=(await db.doc(`bitescore_dish_images/${result.imageId}`).get()).data();
 for(const c of [client('customer'),client('other'),client('owner'),client('admin',true),env.unauthenticatedContext()]){
  const store=c.firestore();await assertFails(setDoc(doc(store,'bitescore_dish_images/forged'),{...source,id:'forged',createdAt:new Date(),updatedAt:new Date()}));
  await assertFails(updateDoc(doc(store,`bitescore_dish_images/${result.imageId}`),{imageUrl:'https://example.test/unapproved.png'}));
  await assertFails(setDoc(doc(store,`${api.screeningCollection}/${result.imageId}`),{state:'approved'}));await assertFails(getDoc(doc(store,`${api.screeningCollection}/${result.imageId}`)));
  await assertFails(uploadBytes(ref(c.storage(bucketName),row.storagePath),bytes,{contentType:'image/png'}));
  await assertFails(uploadBytes(ref(c.storage(bucketName),row.storagePath.replace(/screened_.*$/, 'legacy.jpg')),bytes,{contentType:'image/png'}));
  await assertFails(updateDoc(doc(store,'bitescore_dishes/dish'),{primaryImageId:'forged',primaryImageUrl:'https://example.test/unapproved.png'}));
 }
 await assertSucceeds(updateDoc(doc(client('owner').firestore(),`bitescore_dish_images/${result.imageId}`),{sortOrder:2}));
});
local('Report Photo exact identity/removal and voting preserved; retries cannot resurrect',async()=>{
 const result=await submit(),row=await record(result);
 const vote=require('../lib/customer_bitescore_photos').toggleCustomerBiteScorePhotoVoteHandler;
 await vote(db,{auth:signed('other'),data:{schemaVersion:1,expectedUserId:'other',imageId:result.imageId,dishId:'dish',restaurantId:'restaurant',voteType:'helpful'}});
 const reports=require('../lib/photo_reports');const report=await reports.submitPhotoReportHandler(db,{auth:signed('other'),data:{schemaVersion:1,expectedUserId:'other',imageId:result.imageId,dishId:'dish',restaurantId:'restaurant',reportTargetVersion:result.image.reportTargetVersion,requestId:'deterministic-report-123',reason:'Other'}});
 await reports.moderatePhotoReportHandler(db,{auth:signed('admin'),data:{schemaVersion:1,expectedUserId:'admin',reportId:report.reportId,imageId:result.imageId,action:'remove'}});
 assert.equal((await media(row)).status,403);assert.equal((await submit({retry:true})).state,'removed');assert.equal(calls,1);
 assert.equal((await db.doc('bitescore_dishes/dish').get()).get('imageCount'),0);
 assert.equal((await api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'approved'})},options())).state,'removed');
});
local('real Auth emulator token reaches screened callable wrapper without real provider access',async()=>{
 const response=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'customer@example.test',password:'Local-photo-12345',returnSecureToken:true})});const body=await response.json();assert.equal(response.status,200);const token=await auth.verifyIdToken(body.idToken);
 const callable=require('../lib/customer_bitescore_runtime').submitScreenedBiteScorePhoto;
 await db.doc(api.screeningRuntimePath).update({enabled:false});await assert.rejects(callable.run({auth:{uid:token.uid,token},data:request().data}),{code:'unavailable'});
});
local('two different missing photos admitted concurrently publish only one and never rescan the held loser',async()=>{
 let releases=[],entered;const ready=new Promise(r=>entered=r);let n=0;
 const opts=options({name:'fake',screen:async()=>{calls++;return new Promise(resolve=>{releases.push(resolve);if(++n===2)entered();});}});
 const a=submit({mode:'missing'},opts),b=submit({mode:'missing',bytesBase64:Buffer.concat([bytes,Buffer.from([9])]).toString('base64')},opts);
 await ready;for(const release of releases)release(clean);const results=await Promise.all([a,b]);assert.deepEqual(results.map(x=>x.state).sort(),['approved','needs_review']);
 assert.equal((await db.doc('bitescore_dishes/dish').get()).get('imageCount'),1);assert.equal((await db.collection('bitescore_dish_images').get()).size,1);
 const held=await record(results.find(x=>x.state==='needs_review'));
 await assert.rejects(api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(held,{decision:'approved'})},options()),{code:'failed-precondition'});
 assert.equal((await media(held)).status,403);assert.equal(calls,2);assert.deepEqual((await db.doc('private_bitescore_screening_usage/concurrency').get()).get('active'),{});
});
local('review-photo contribution point survives delayed Admin approval and trigger/callable retries without duplication',async()=>{
 const result=await submit({mode:'review',reviewId:'review'},options({name:'fake',screen:async()=>({...clean,racy:'POSSIBLE'})})),row=await record(result);
 await api.awardApprovedScreenedPhotoPoints(db,result.imageId);assert.equal((await db.collection('bitescore_contribution_point_ledger').get()).size,0);
 await api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'approved'})},options());
 await api.awardApprovedScreenedPhotoPoints(db,result.imageId);await api.awardApprovedScreenedPhotoPoints(db,result.imageId);
 const points=require('../lib/contribution_points_helpers');await points.awardDishImageContributionPointsCallableHandler(db,{auth:signed('customer'),data:{imageId:result.imageId,dishId:'dish'}});
 assert.equal((await db.collection('bitescore_contribution_point_ledger').get()).size,1);assert.equal((await db.doc('user_profiles/customer').get()).get('contributionPoints'),1);
 const gallery=await submit();await api.awardApprovedScreenedPhotoPoints(db,gallery.imageId);assert.equal((await db.collection('bitescore_contribution_point_ledger').get()).size,1);
});
local('long generation strings remain exact in verdict and object checks, never converted to JS Number',async()=>{
 const generation='9007199254740993';let seen;const fakeObjects={put:async()=>generation,read:async(p,g,d)=>{seen=g;return {bytes,contentType:'image/png'};},url:p=>`https://example.test/${encodeURIComponent(p)}`};
 const result=await submit({}, {...options(),objects:fakeObjects});assert.equal(result.state,'approved');assert.equal(seen,generation);assert.equal((await record(result)).generation,generation);
});
