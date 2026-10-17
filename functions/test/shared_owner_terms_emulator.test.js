'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const req=require('node:module').createRequire(path.resolve(__dirname,'../../firestore_rules_tests/package.json'));
const {initializeTestEnvironment,assertFails,assertSucceeds}=req('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,deleteDoc,getDoc,writeBatch}=req('firebase/firestore');
const {ref,uploadBytes}=req('firebase/storage');
const terms=require('../lib/bitescore_terms'),photo=require('../lib/photo_screening'),owner=require('../lib/owner_photo_screening');
const profile=require('../lib/bitesaver_restaurant_profile'),{runBiteSaverProfileTransaction}=require('../lib/bitesaver_restaurant_profile_runtime');
const {approveRestaurantNameChangeHandler}=require('../lib/restaurant_name_approval');
const {createOwnerMediaDependencies}=require('../lib/bitesaver_owner_media_runtime');
const {saveOwnerMedia}=require('../lib/bitesaver_owner_media');
const menus=require('../lib/menu_image_upload_authorization');
const {saveCustomerBiteScoreReview}=require('../lib/bitescore_review_aggregate');
const enabled=process.env.RUN_SHARED_TERMS_EMULATOR==='1',local=(name,fn)=>test(name,{skip:!enabled},fn);
const project='demo-coupon-app-rules',bucketName=`${project}.appspot.com`;
const v1={version:'SHARED-TEST-v1',text:'Synthetic fixture, not legal Terms.'},v2={...v1,version:'SHARED-TEST-v2'};
const clean={adult:'VERY_UNLIKELY',violence:'VERY_UNLIKELY',racy:'UNLIKELY',medical:'VERY_LIKELY',spoof:'VERY_LIKELY'};
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=','base64');
let app,db,auth,bucket,store,env,objects,calls,now,geocodes;
const signed=(uid='owner')=>({uid,token:{email_verified:uid==='admin',admin:uid==='admin',firebase:{sign_in_provider:uid==='owner'?'phone':'password'}}});
const client=(uid='owner',extra={})=>env.authenticatedContext(uid,{email_verified:uid!=='owner',admin:uid==='admin',firebase:{sign_in_provider:uid==='owner'?'phone':'password'},...extra}).firestore();
const configure=(p=v1)=>db.doc(terms.biteScoreTermsRuntimePath).set({schemaVersion:1,required:true,version:p.version,acceptedVersions:[p.version,...(p.acceptedPriorVersions??[])]});
const accept=(p=v1,uid='owner',emailVerified=false)=>terms.customerBiteScoreTerms(store,{uid,emailVerified},{expectedUserId:uid,version:p.version},true,new Date(),p);
const read=async p=>(await db.doc(p).get()).data();
const opts=(approvedTerms=v1,extra={})=>({approvedTerms,now:()=>Date.now(),objects,provider:{name:'fake-only',screen:async()=>{calls++;return clean;}},...extra});
const upload=(changes={},options=opts(),uid='owner')=>owner.submitScreenedOwnerPhotoHandler(db,{auth:signed(uid),data:{schemaVersion:1,expectedUserId:uid,sourceType:'biteSaver',sourceId:'owner',family:'managed',targetId:'gallery',contentType:'image/png',bytesBase64:bytes.toString('base64'),retry:false,...changes}},options);
const use=(id,action='attach',p=v1,uid='owner')=>owner.useOwnerScreenedPhotoHandler(db,{auth:signed(uid),data:{schemaVersion:1,expectedUserId:uid,imageId:id,action}},opts(p));
const record=r=>read(`${photo.screeningCollection}/${r.imageId}`);
const media=(p=v1)=>createOwnerMediaDependencies(db,bucket,async()=>{throw Error('No public download token');},p);
const mediaCall=(data,p=v1)=>saveOwnerMedia({auth:signed(),data:{intent:'ownerMediaUpdate',...data}},media(p));
const load=(p=v1)=>mediaCall({action:'load'},p);
const register=async(r,p=v1)=>{const state=await load(p);return mediaCall({action:'register',imageId:r.imageId,extension:'jpg',expectedVersion:state.media.version,requestId:`reg_${r.imageId}`},p);};
const publish=async(changes,p=v1)=>{const state=await load(p);return mediaCall({action:'publish',section:'photos',gallery:[],expectedVersion:state.media.version,requestId:`save_${state.media.version}`,contentFingerprint:state.contentFingerprint,...changes},p);};
const business={restaurantName:'Test Cafe',streetAddress:'1 Test St',city:'Test City',state:'NY',zipCode:'10001',phone:'212-555-0100',website:'https://example.test'};
const dependencies=(p=v1)=>({getAccount:async id=>{const s=await db.doc(`restaurant_accounts/${id}`).get();return {exists:s.exists,data:s.data()??{}};},checkTerms:uid=>db.runTransaction(tx=>terms.requireBiteScoreTermsInFirestore(db,tx,uid,p)),runAccountTransaction:(id,fn)=>runBiteSaverProfileTransaction(db,id,fn,p),geocodeAddress:async a=>{geocodes++;return {...a,latitude:40.75,longitude:-73.99,formattedAddress:'1 Test St, Test City, NY 10001, USA',addressFingerprint:require('../lib/restaurant_geocoding').createRestaurantAddressFingerprint(a)};},serverTimestamp:()=>require('firebase-admin/firestore').FieldValue.serverTimestamp()});
const application=(p=v1)=>profile.saveBiteSaverRestaurantProfileHandler({auth:signed(),data:{intent:'submitApplication',requestId:'application',profile:business}},dependencies(p));
const approve=(version,p=v1,decision='approve',documentId='owner')=>profile.reviewBiteSaverApplicationHandler({auth:signed('admin'),data:{documentId,decision,expectedProfileVersion:version}},dependencies(p));

test.before(async()=>{if(!enabled)return;
 for(const[k,v]of Object.entries({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8792',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9298',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9198'}))assert.equal(process.env[k],v);
 assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
 app=require('firebase-admin/app').initializeApp({projectId:project,storageBucket:bucketName});db=require('firebase-admin/firestore').getFirestore(app);auth=require('firebase-admin/auth').getAuth(app);bucket=require('firebase-admin/storage').getStorage(app).bucket();objects=photo.screeningObjects();
 store=require('../lib/rating_destructive_job_store').createFirestoreRatingDestructivePrivateDatabase(db);
 env=await initializeTestEnvironment({projectId:project,firestore:{host:'127.0.0.1',port:8792,rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')},storage:{host:'127.0.0.1',port:9298,rules:fs.readFileSync(path.resolve(__dirname,'../../storage.rules'),'utf8')}});
 for(const uid of ['owner','other','admin']){try{await auth.deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}await auth.createUser({uid,email:`${uid}@example.test`,emailVerified:uid!=='owner',password:'Local-fixture-12345'});if(uid==='admin')await auth.setCustomUserClaims(uid,{admin:true});}
});
test.beforeEach(async()=>{if(!enabled)return;await env.clearFirestore();await bucket.deleteFiles({force:true});calls=0;geocodes=0;now=new Date();
 for(const[p,d]of Object.entries({[photo.screeningRuntimePath]:{required:true,enabled:true,policyVersion:photo.screeningPolicyVersion,retentionApproved:true,retentionPolicyVersion:'photo-retention-v1',failedScreeningRetentionDays:7,failedScreeningRetentionApproved:true,cleanupEnabled:true,monthlyAllowance:1000,ownerRequired:true,ownerEnabled:true},'private_bitescore_runtime/aggregation':{enabled:true,version:1,epoch:'shared'},'restaurant_accounts/owner':{uid:'owner',restaurantName:'Test Cafe',couponApplicationSubmitted:true,approvalStatus:'approved',couponPostingEnabled:true,profileVersion:1},'restaurant_menus/menu':{createdByUserId:'owner',bitescoreRestaurantId:'restaurant'},'bitescore_restaurants/restaurant':{id:'restaurant',name:'Test Cafe',isActive:true,active:true,isClaimed:true,ownerUserId:'owner',restaurantWriteRevision:0},'bitescore_dishes/dish':{id:'dish',name:'Dish',restaurantId:'restaurant',category:'Food',isActive:true,imageCount:0,aggregateWriteGeneration:0}}))await db.doc(p).set(d);
 await configure();
});
test.after(async()=>{if(env)await env.cleanup();if(app)await app.delete();});
local('phone owner accepts minimal shared root; same receipt permits owner UGC and later eligible customer review, never grants email eligibility',async()=>{
 await accept();const before=await read('user_profiles/owner');assert.deepEqual(Object.keys(before).sort(),['termsAcceptance','userId']);
 await assertSucceeds(setDoc(doc(client(),'restaurant_accounts/owner/coupons/c'),{id:'c',title:'Lunch'}));
 const input={schemaVersion:1,expectedUserId:'owner',dishId:'dish',restaurantId:'restaurant',headline:'',notes:'',overallImpression:8,tastinessScore:7,qualityScore:9,valueScore:6};
 await assert.rejects(saveCustomerBiteScoreReview(store,{uid:'owner',emailVerified:false},input,new Date(),v1),{code:'permission-denied'});
 await saveCustomerBiteScoreReview(store,{uid:'owner',emailVerified:true},input,new Date(),v1);
 await accept(v1,'owner',true);assert.deepEqual((await read('user_profiles/owner')).termsAcceptance,before.termsAcceptance);
 assert.equal((await read('dish_rating_aggregates/dish')).ratingCount,1);
});
local('customer-first receipt works for exact owner; another UID and anonymous actor cannot borrow it',async()=>{
 await accept(v1,'owner',true);const before=(await read('user_profiles/owner')).termsAcceptance;
 await assertSucceeds(setDoc(doc(client(),'restaurant_accounts/owner/menu_items/a'),{id:'a',name:'Soup'}));
 await assertFails(setDoc(doc(client('other'),'restaurant_accounts/owner/menu_items/b'),{id:'b',name:'Soup'}));
 await assertFails(setDoc(doc(client('owner',{firebase:{sign_in_provider:'anonymous'}}),'restaurant_accounts/owner/menu_items/b'),{id:'b',name:'Soup'}));
 await accept();assert.deepEqual((await read('user_profiles/owner')).termsAcceptance,before);
});
local('application denial precedes geocoding; final approval rechecks actual owner after mandatory version changes',async()=>{
 await db.doc('restaurant_accounts/owner').delete();await assert.rejects(application(),{code:'failed-precondition'});assert.equal(geocodes,0);
 await accept();const saved=await application();assert.equal(geocodes,1);assert.equal((await read('restaurant_accounts/owner')).approvalStatus,'pending');
 await configure(v2);await accept(v2,'admin',true);await assert.rejects(approve(saved.profileVersion,v2),{code:'failed-precondition'});
 await accept(v2);await approve(saved.profileVersion,v2);assert.equal((await read('restaurant_accounts/owner')).approvalStatus,'approved');
});
local('legacy Admin account document uses its recorded owner, and rejection is independent',async()=>{
 await db.doc('restaurant_accounts/owner').delete();await accept();const saved=await application();const pending=await read('restaurant_accounts/owner');await db.doc('restaurant_accounts/legacy-document').set(pending);
 await configure(v2);await accept(v2,'legacy-document');await assert.rejects(approve(saved.profileVersion,v2,'approve','legacy-document'),{code:'failed-precondition'});
 await assertFails(updateDoc(doc(client('admin'),'restaurant_accounts/legacy-document'),{approvalStatus:'approved'}));
 await accept(v2);await assertSucceeds(updateDoc(doc(client('admin'),'restaurant_accounts/legacy-document'),{approvalStatus:'approved'}));
 await db.doc('restaurant_accounts/legacy-document').update({approvalStatus:'pending'});
 await approve(saved.profileVersion,v2,'approve','legacy-document');
 await db.doc('user_profiles/owner').delete();await approve(saved.profileVersion,v2,'reject');assert.equal((await read('restaurant_accounts/owner')).approvalStatus,'rejected');
});
local('profile final transaction closes on policy change, substantive edits deny, image withdrawal and Admin maintenance survive',async()=>{
 await accept();await db.doc('restaurant_accounts/owner').update({bio:'New'});
 // A mandatory cutover races the cheap preflight and the final transaction.
 // Change real emulator state before the transaction reads policy (after its
 // profile read); no synthetic receipt or mocked policy result is supplied.
 await dependencies().checkTerms('owner');
 const native=db.runTransaction.bind(db);let changed=false;
 db.runTransaction=fn=>native(async tx=>{const original=tx.get.bind(tx);tx.get=async ref=>{if(ref.path===terms.biteScoreTermsRuntimePath&&!changed){changed=true;await configure(v2);}return original(ref);};return fn(tx);});
 try {await assert.rejects(runBiteSaverProfileTransaction(db,'owner',()=>({operation:'update',data:{bio:'Must not publish'},termsUserId:'owner',response:true}),v1),{code:'failed-precondition'});} finally {db.runTransaction=native;}
 assert.equal((await read('restaurant_accounts/owner')).bio,'New');
 await assert.rejects(runBiteSaverProfileTransaction(db,'owner',()=>({operation:'update',data:{bio:'No'},termsUserId:'owner',response:true}),v2),{code:'failed-precondition'});
 await runBiteSaverProfileTransaction(db,'owner',()=>({operation:'update',data:{mainImageUrl:null},response:true}),v2);
 await assertSucceeds(updateDoc(doc(client('admin'),'restaurant_accounts/owner'),{bio:'Admin correction'}));
 await assertSucceeds(updateDoc(doc(client(),'restaurant_accounts/owner'),{emailVerified:false,updatedAt:new Date()}));
});
local('name approval derives pending owner/name, refuses Admin substitution, and supported client uses trusted handler',async()=>{
 await db.doc('restaurant_name_change_requests/request').set({userId:'owner',requestedRestaurantName:'New Cafe',status:'pending'});await accept(v1,'admin',true);
 const request={auth:signed('admin'),data:{requestId:'request'}};
 await assert.rejects(approveRestaurantNameChangeHandler(db,request,v1),{code:'failed-precondition'});
 await assert.rejects(approveRestaurantNameChangeHandler(db,{...request,data:{...request.data,uid:'admin'}},v1),{code:'invalid-argument'});
 await assertFails(updateDoc(doc(client('admin'),'restaurant_name_change_requests/request'),{status:'approved'}));
 await accept();await approveRestaurantNameChangeHandler(db,request,v1);assert.equal((await read('restaurant_accounts/owner')).restaurantName,'New Cafe');
 await configure(v2);await approveRestaurantNameChangeHandler(db,request,v2); // acknowledged no-op
});
for(const [sourceType,sourceId,family,targetId]of [['biteSaver','owner','main','owner'],['biteSaver','owner','managed','gallery'],['biteSaver','owner','managed','board'],['biteSaver','owner','managed','special'],['biteSaver','owner','coupon','coupon'],['biteSaver','owner','menu','page'],['sharedMenu','menu','menu','page']])local(`Terms before cost/bytes/provider: ${sourceType}/${family}/${targetId}`,async()=>{
 const data={sourceType,sourceId,family,targetId};await assert.rejects(upload(data),{code:'failed-precondition'});assert.equal(calls,0);assert.equal((await bucket.getFiles())[0].length,0);assert.equal((await db.collection(photo.screeningCollection).get()).size,0);assert.equal((await db.collection('private_bitescore_screening_usage').get()).size,0);
 await accept();const result=await upload(data);assert.equal(result.state,'available');assert.equal(calls,1);assert.equal((await record(result)).ownerUserId,'owner');
});
local('cutover after bytes but before provider never invokes provider; private status/withdrawal still work',async()=>{
 await accept();const result=await upload({},opts(v1,{objects:{...objects,put:async(...args)=>{const generation=await objects.put(...args);await configure(v2);return generation;}}}));assert.equal(result.state,'failed');assert.equal(calls,0);
 const status=await owner.getOwnerScreenedPhotoHandler(db,{auth:signed(),data:{schemaVersion:1,expectedUserId:'owner',imageId:result.imageId}},opts(v2));assert.equal(status.state,'failed');await use(result.imageId,'discard',v2);
});
local('Admin approval stays private across cutover; exact owner reacceptance allows attachment without rescan or deadline reset',async()=>{
 await accept();const result=await upload({family:'menu',targetId:'page'},opts(v1,{provider:{name:'fake-only',screen:async()=>{calls++;return {...clean,racy:'POSSIBLE'};}}}));const initial=await record(result);
 await configure(v2);await accept(v2,'admin',true);
 await photo.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:{schemaVersion:1,expectedUserId:'admin',imageId:result.imageId,generation:initial.generation,decision:'approved'}},opts(v2));
 const approved=await record(result);assert.notEqual(approved.attached,true);assert.equal(approved.generation,initial.generation);assert.deepEqual(approved.expiresAt,initial.expiresAt);
 await assert.rejects(use(result.imageId,'attach',v2,'admin'),{code:'failed-precondition'});
 await assert.rejects(use(result.imageId,'attach',v2),{code:'failed-precondition'});
 assert.equal((await db.doc('restaurant_accounts/owner/menu_images/page').get()).exists,false);
 await accept(v2);await use(result.imageId,'attach',v2);assert.equal((await record(result)).attached,true);assert.equal(calls,1);
 await configure({...v2,version:'SHARED-TEST-v3'});await use(result.imageId,'remove',v2);assert.equal((await record(result)).state,'withdrawn');
});
local('managed gallery registration/status stay private; new attachment and reorder need current Terms while removal remains available',async()=>{
 await accept();const result=await upload();await register(result);await publish({gallery:[result.imageId]});const first=await record(result);assert.equal(first.attached,true);
 await configure(v2);await publish({gallery:[]},v2);assert.equal((await record(result)).attached,false);
 await assert.rejects(publish({gallery:[result.imageId]},v2),{code:'failed-precondition'});
 await accept(v2);await publish({gallery:[result.imageId]},v2);assert.equal(calls,1);
 await configure({...v2,version:'SHARED-TEST-v3'});await publish({gallery:[]},null);assert.equal((await record(result)).attached,false);
});
local('manual specials/board substantive changes require consent; whole-state same-content save, disable and delete survive reacceptance',async()=>{
 const special={id:'lunch',title:'Lunch',details:null,isActive:true,availabilityMode:'specificDays',daysOfWeek:[1,2],allDay:true,hideWhenUnavailable:true,imageId:null};
 const draft={section:'specials',gallery:[],mode:'manual',boardImage:null,specials:[special]};
 await assert.rejects(publish(draft),{code:'failed-precondition'});await accept();await publish(draft);
 await configure(v2);await publish(draft,v2);await publish({...draft,specials:[{...special,isActive:false}]},v2);
 await assert.rejects(publish({...draft,specials:[{...special,isActive:false,title:'New public title'}]},v2),{code:'failed-precondition'});
 await assert.rejects(publish({...draft,specials:[{...special,isActive:false,daysOfWeek:[3]}]},v2),{code:'failed-precondition'});
 await publish({...draft,specials:[]},v2);assert.equal((await db.collection('restaurant_accounts/owner/daily_specials').get()).size,0);
 await accept(v2);const board=await upload({targetId:'board'},opts(v2));await register(board,v2);
 await configure({...v2,version:'SHARED-TEST-v3'});await assert.rejects(publish({...draft,mode:'photo',boardImage:board.imageId,board:{...special,title:'Board'},specials:[]},null),{code:'failed-precondition'});
});
local('menu grant checks actual creator, grants cannot bypass candidate Storage, and screening cutoff remains closed',async()=>{
 await db.doc(photo.screeningRuntimePath).update({ownerRequired:false});
 const grant=(sourceType='sharedMenu',sourceId='menu',uid='owner',p=v1)=>menus.issueMenuImageUploadAuthorizationHandler({auth:signed(uid),data:{schemaVersion:1,sourceType,sourceId,fileExtension:'png'}},{database:menus.createFirestoreMenuImageUploadAuthorizationDatabase(db,p)});
 await accept(v1,'admin',true);await assert.rejects(grant('sharedMenu','menu','admin'),{code:'failed-precondition'});await assert.rejects(grant('biteSaver','owner'),{code:'failed-precondition'});
 await accept();for(const [kind,id]of [['sharedMenu','menu'],['biteSaver','owner']]){const result=await grant(kind,id);await assertFails(uploadBytes(ref(env.authenticatedContext('owner').storage(bucketName),result.objectPath),bytes,{contentType:'image/png'}));}
 await db.doc('restaurant_menus/menu').update({createdByUserId:'other'});await assert.rejects(grant(),{code:'permission-denied'});
 await db.doc(photo.screeningRuntimePath).update({ownerRequired:true});await assert.rejects(grant('biteSaver','owner'),{code:'failed-precondition'});
});
local('populated owner Rules protect promotion/menu create/edit; preserve withdrawal, deletion, Admin corrections and historical reads',async()=>{
 const c=client();
 for(const collection of ['coupons','daily_specials','menu_items','menu_sections','menu_images']){
  const p=`restaurant_accounts/owner/${collection}/entry`,data={id:'entry',restaurantId:'owner',ownerUid:'owner',title:'Public',name:'Item',body:'Menu',imageUrl:null,isActive:true};
  await assertFails(setDoc(doc(c,p),data));await db.doc(p).set(data);await assertFails(updateDoc(doc(c,p),{title:'Changed'}));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),p)));
  await assertSucceeds(updateDoc(doc(c,p),{isActive:false,imageUrl:null}));await assertSucceeds(deleteDoc(doc(c,p)));
 }
 await accept();
 const batch=writeBatch(c);
 for(const collection of ['coupons','daily_specials','menu_items','menu_sections','menu_images'])batch.set(doc(c,`restaurant_accounts/owner/${collection}/entry`),{id:'entry',restaurantId:'owner',ownerUid:'owner',title:'Accepted',imageUrl:null});
 await assertSucceeds(batch.commit());
 for(const collection of ['coupons','daily_specials','menu_items','menu_sections','menu_images'])await assertSucceeds(updateDoc(doc(c,`restaurant_accounts/owner/${collection}/entry`),{title:'Edited'}));
 await assertFails(updateDoc(doc(c,'restaurant_accounts/owner/coupons/entry'),{imageUrl:'https://unchecked.example/image'}));
 await configure(v2);await assertSucceeds(updateDoc(doc(client('admin'),'restaurant_accounts/owner/coupons/entry'),{title:'Admin correction'}));
 await db.doc('restaurant_accounts/owner').update({couponPostingEnabled:false});await accept(v2);await assertFails(setDoc(doc(c,'restaurant_accounts/owner/coupons/blocked'),{id:'blocked',title:'No subscription'}));
});
local('shared-menu creator authority and receipt are separate; opening an empty menu is permitted without acceptance',async()=>{
 const c=client('owner',{email_verified:true});
 for(const collection of ['menu_items','menu_sections','menu_images']){
  const p=`restaurant_menus/menu/${collection}/entry`;await assertFails(setDoc(doc(c,p),{name:'New',imageUrl:null}));
  await db.doc(p).set({name:'Existing',imageUrl:null});await assertFails(updateDoc(doc(c,p),{name:'Changed'}));await assertSucceeds(deleteDoc(doc(c,p)));
 }
 await db.doc('restaurant_menus/menu/menu_items/hidden').set({name:'Previously saved menu'});
 await assertFails(updateDoc(doc(c,'bitescore_restaurants/restaurant'),{sharedMenuId:'menu',restaurantWriteRevision:1,updatedAt:now}));
 const batch=writeBatch(c);batch.set(doc(c,'restaurant_menus/empty'),{restaurantName:'Test Cafe',normalizedName:'test cafe',normalizedAddressKey:'derived',bitescoreRestaurantId:'restaurant',createdByUserId:'owner',linkStatus:'bitescore_only',createdAt:now,updatedAt:now});batch.update(doc(c,'bitescore_restaurants/restaurant'),{sharedMenuId:'empty',restaurantWriteRevision:1,updatedAt:now});await assertSucceeds(batch.commit());
 await assertFails(updateDoc(doc(c,'restaurant_menus/empty'),{restaurantName:'Unaccepted words'}));
 await accept();for(const collection of ['menu_items','menu_sections','menu_images'])await assertSucceeds(setDoc(doc(c,`restaurant_menus/menu/${collection}/entry`),{name:'Accepted',imageUrl:null}));
 await assertFails(updateDoc(doc(c,'restaurant_menus/menu'),{createdByUserId:'other'}));await assertFails(setDoc(doc(client('other'),'restaurant_menus/menu/menu_items/other'),{name:'Not owner'}));
});
local('Rules reject stale/invalid/future receipts and malformed mandatory metadata; off preserves existing owner writes',async()=>{
 const target=doc(client(),'restaurant_accounts/owner/coupons/new');
 for(const receipt of [{version:'old',acceptedAt:now},{version:v1.version,acceptedAt:'forged'},{version:v1.version,acceptedAt:new Date(Date.now()+60000)}]){await db.doc('user_profiles/owner').set({termsAcceptance:receipt});await assertFails(setDoc(target,{id:'new',title:'Denied'}));}
 await accept();for(const metadata of [{},{required:true},{schemaVersion:1,required:true,version:'',acceptedVersions:[v1.version]}]){await db.doc(terms.biteScoreTermsRuntimePath).set(metadata);await assertFails(setDoc(target,{id:'new',title:'Denied'}));}
 await db.doc(terms.biteScoreTermsRuntimePath).set({required:false});await assertSucceeds(setDoc(target,{id:'new',title:'Dormant'}));
 await configure(v2);await assertFails(updateDoc(target,{title:'New required version'}));
 await configure({...v2,acceptedPriorVersions:[v1.version]});await assertSucceeds(updateDoc(target,{title:'Explicit compatibility'}));
 await db.doc('private_account_deletions/owner').set({state:'requested'});await assertFails(updateDoc(target,{title:'Deleted'}));
});
