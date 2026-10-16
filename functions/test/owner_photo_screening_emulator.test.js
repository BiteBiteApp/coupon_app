'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module'),{createHash}=require('node:crypto');
const rulesRequire=createRequire(path.resolve(__dirname,'../../firestore_rules_tests/package.json'));
const {initializeTestEnvironment,assertFails,assertSucceeds}=rulesRequire('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc}=rulesRequire('firebase/firestore');
const {ref,uploadBytes,getBytes,getMetadata,getDownloadURL}=rulesRequire('firebase/storage');
const enabled=process.env.RUN_OWNER_SCREENING_EMULATOR==='1';
const local=(name,fn)=>test(name,{skip:!enabled},fn);
const project='demo-coupon-app-rules',bucketName=`${project}.appspot.com`;
let app,db,bucket,env,auth,api,objects,now,calls;
const clean={adult:'VERY_UNLIKELY',violence:'VERY_UNLIKELY',racy:'UNLIKELY',medical:'VERY_LIKELY',spoof:'VERY_LIKELY'};
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=','base64');
const signed=uid=>({uid,token:{email_verified:true,admin:uid==='admin',firebase:{sign_in_provider:'password'}}});
const request=(changes={},uid='customer')=>({auth:signed(uid),data:{schemaVersion:1,expectedUserId:uid,dishId:'dish',restaurantId:'restaurant',reviewId:null,mode:'gallery',contentType:'image/png',bytesBase64:bytes.toString('base64'),retry:false,...changes}});
const options=(provider={name:'fake',screen:async()=>{calls++;return clean;}})=>({provider,now:()=>now,objects});
const adminData=(row,extra={})=>({schemaVersion:1,expectedUserId:'admin',imageId:row.imageId,generation:row.generation??null,...extra});
const ownerApi=require('../lib/owner_photo_screening');
const ownerRequest=(changes={},uid='owner')=>({auth:signed(uid),data:{schemaVersion:1,expectedUserId:uid,sourceType:'biteSaver',sourceId:'owner',family:'managed',targetId:'gallery',contentType:'image/png',bytesBase64:bytes.toString('base64'),retry:false,...changes}});
const submit=(changes={},opts=options(),uid='owner')=>ownerApi.submitScreenedOwnerPhotoHandler(db,ownerRequest(changes,uid),opts);
const use=(imageId,action='attach',uid='owner')=>ownerApi.useOwnerScreenedPhotoHandler(db,{auth:signed(uid),data:{schemaVersion:1,expectedUserId:uid,imageId,action}},options());
const record=async result=>(await db.doc(`${api.screeningCollection}/${result.imageId}`).get()).data();
const media=async row=>fetch(`http://127.0.0.1:9298/v0/b/${bucketName}/o/${encodeURIComponent(row.storagePath)}?alt=media`);
const gone=async row=>{assert.equal((await bucket.file(row.storagePath).exists())[0],false);assert.ok([403,404].includes((await media(row)).status));};
const client=(uid,admin=false)=>env.authenticatedContext(uid,{admin,email_verified:true,firebase:{sign_in_provider:'password'}});
test.before(async()=>{if(!enabled)return;
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8792');assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:9298');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
 app=require('firebase-admin/app').initializeApp({projectId:project,storageBucket:bucketName});db=require('firebase-admin/firestore').getFirestore(app);bucket=require('firebase-admin/storage').getStorage(app).bucket();auth=require('firebase-admin/auth').getAuth(app);
 api=require('../lib/photo_screening');objects=api.screeningObjects();
 env=await initializeTestEnvironment({projectId:project,firestore:{host:'127.0.0.1',port:8792,rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')},storage:{host:'127.0.0.1',port:9298,rules:fs.readFileSync(path.resolve(__dirname,'../../storage.rules'),'utf8')}});
 for(const uid of ['customer','other','admin','owner']){try{await auth.deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}await auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true,password:'Local-photo-12345'});if(uid==='admin')await auth.setCustomUserClaims(uid,{admin:true});}
});
test.beforeEach(async()=>{if(!enabled)return;await env.clearFirestore();await bucket.deleteFiles({force:true});now=Date.now();calls=0;
 for(const [p,d]of Object.entries({[api.screeningRuntimePath]:{required:true,enabled:true,policyVersion:api.screeningPolicyVersion,retentionApproved:true,retentionPolicyVersion:"photo-retention-v1",failedScreeningRetentionDays:7,failedScreeningRetentionApproved:true,cleanupEnabled:true,monthlyAllowance:1000,ownerRequired:true,ownerEnabled:true},'private_bitescore_runtime/aggregation':{enabled:true,version:1,epoch:'screening'},'bitescore_restaurants/restaurant':{id:'restaurant',name:'Synthetic restaurant',isActive:true,ownerUserId:'owner',isClaimed:true},'bitescore_dishes/dish':{id:'dish',name:'Synthetic dish',restaurantId:'restaurant',isActive:true,imageCount:0},'restaurant_accounts/owner':{uid:'owner',restaurantName:'Synthetic owner',couponApplicationSubmitted:true,approvalStatus:'approved',couponPostingEnabled:true},'restaurant_menus/menu':{createdByUserId:'owner',name:'Synthetic shared menu'},'dish_reviews/review':{userId:'customer',dishId:'dish',restaurantId:'restaurant'}}))await db.doc(p).set(d);
});
test.after(async()=>{if(env)await env.cleanup();if(app)await app.delete();});

local('managed image is private while scanning, available and registered; only explicit Save publishes',async()=>{
 let resolve,entered;const ready=new Promise(r=>entered=r),wait=new Promise(r=>resolve=r);
 const opts=options({name:'fake',screen:async()=>{calls++;entered();return wait;}});
 const first=submit({},opts);await ready;const pending=await submit({},opts);const row=await record(pending);
 assert.equal(pending.state,'scanning');assert.equal((await media(row)).status,403);
 await assertFails(getDownloadURL(ref(env.unauthenticatedContext().storage(bucketName),row.storagePath)));
 assert.equal((await bucket.file(row.storagePath).getMetadata())[0].metadata.firebaseStorageDownloadTokens,undefined);
 resolve(clean);const available=await first;assert.equal(available.state,'available');assert.equal((await media(row)).status,403);assert.equal(calls,1);
 const {createOwnerMediaDependencies}=require('../lib/bitesaver_owner_media_runtime');const {saveOwnerMedia,publicOwnerGallery}=require('../lib/bitesaver_owner_media');
 const deps=createOwnerMediaDependencies(db,bucket,async()=>{throw Error('must not mint token');});
 const call=data=>saveOwnerMedia({auth:signed('owner'),data:{intent:'ownerMediaUpdate',...data}},deps);
 const registered=await call({action:'register',imageId:available.imageId,extension:'jpg',expectedVersion:0,requestId:'reg'});
 assert.equal(registered.media.images.length,1);assert.equal((await media(row)).status,403);
 await call({action:'publish',section:'photos',gallery:[available.imageId],expectedVersion:1,requestId:'save'});
 assert.equal((await media(row)).status,200);assert.deepEqual(publicOwnerGallery((await db.doc('restaurant_accounts/owner').get()).data()),[available.imageUrl]);
 assert.equal((await submit()).imageId,available.imageId);assert.equal(calls,1);
});
local('coupon and both menu sources publish only exact intended target; text draft is never created by scan or Admin',async()=>{
 for(const [sourceType,sourceId,family,targetId] of [['biteSaver','owner','coupon','coupon'],['biteSaver','owner','menu','legacy'],['sharedMenu','menu','menu','shared']]){
  const result=await submit({sourceType,sourceId,family,targetId});const row=await record(result);
  const target=require('../lib/owner_photo_identity').ownerPhotoTargetPath(row);assert.equal((await db.doc(target).get()).exists,false);assert.equal((await media(row)).status,403);
  if(family==='coupon'){await assert.rejects(use(row.imageId));await db.doc(target).set({id:targetId,title:'Keep text',imageUrl:null});}
  await assert.rejects(use(row.imageId,'attach','other'));
  const published=await use(row.imageId);assert.equal(published.state,'published');assert.equal((await media(row)).status,200);
  assert.equal((await db.doc(target).get()).get('imageUrl'),result.imageUrl);
  if (family==='menu') {
   const dto=require('../lib/customer_bitesaver_search_session').customerPublicMenuEntry({key:'public-key',privateSourceIdentities:['owner',sourceId],kind:'menu_images',document:{id:targetId,data:(await db.doc(target).get()).data()}});
   assert.equal(dto.imageUrl,result.imageUrl);assert.deepEqual(Object.keys(dto).sort(),['imageUrl','key','kind','sortOrder']);
   assert.ok(!decodeURIComponent(dto.imageUrl).includes('/owner/'));
  }
  await use(row.imageId,'remove');assert.equal((await record(result)).state,'withdrawn');await gone(row);
  if(family==='coupon')assert.equal((await db.doc(target).get()).get('title'),'Keep text');
 }
});
local('held image queue identifies exact owner source; Admin approval alone stays private until owner saves',async()=>{
 const result=await submit({family:'menu',targetId:'page'},options({name:'fake',screen:async()=>({...clean,racy:'POSSIBLE'})})),row=await record(result);
 const queue=await api.listScreeningPhotosHandler(db,{auth:signed('admin'),data:{schemaVersion:1,expectedUserId:'admin',after:null}},options());
 assert.equal(queue.items[0].family,'menu');assert.equal(queue.items[0].ownerUserId,'owner');assert.equal(queue.items[0].targetId,'page');
 await api.previewScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row)},options());
 const approved=await api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'approved'})},options());
 assert.equal(approved.state,'available');assert.equal((await media(row)).status,403);assert.equal((await db.doc('restaurant_accounts/owner/menu_images/page').get()).exists,false);
 await use(row.imageId);assert.equal((await media(row)).status,200);
});
local('forged sources, account switches, arbitrary URLs, changed source and deletion fence fail before admission',async()=>{
 for(const change of [{expectedUserId:'other'},{sourceId:'../owner'},{sourceType:'bitescore_restaurants'},{family:'unknown'},{imageUrl:'https://arbitrary.test/a'},{approved:true}])await assert.rejects(submit(change));
 await assert.rejects(submit({},options(),'other'));await assert.rejects(submit({sourceType:'sharedMenu',sourceId:'menu',family:'menu',targetId:'page'},options(),'other'));
 await db.doc('private_account_deletions/owner').set({state:'requested'});await assert.rejects(submit());assert.equal(calls,0);
});
local('source removal and byte replacement during scan never publish; exact-generation Admin decision rejects',async()=>{
 const result=await submit({},options({name:'fake',screen:async()=>{const row=(await db.collection(api.screeningCollection).get()).docs[0].data();await bucket.file(row.storagePath).save(Buffer.from('changed'),{resumable:false});return clean;}}));
 assert.equal(result.state,'failed');const row=await record(result);assert.equal((await media(row)).status,403);
 await assert.rejects(api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'approved'})},options()));
});
local('shared 1000 allowance admits only one of owner and BiteScore at 999; rollover uses same UTC bucket',async()=>{
 const usage=`private_bitescore_screening_usage/${new Date(now).toISOString().slice(0,7)}`;await db.doc(usage).set({reservedUnits:999});
 const results=await Promise.allSettled([submit(),api.submitScreenedPhotoHandler(db,request(),options())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);assert.equal((await db.doc(usage).get()).get('reservedUnits'),1000);
 await assert.rejects(submit({family:'menu',targetId:'other'}),{code:'resource-exhausted'});assert.equal(calls,1);
 now=Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth()+1,1);
 await submit({family:'menu',targetId:'next'});assert.equal(calls,2);
 assert.equal((await db.doc(`private_bitescore_screening_usage/${new Date(now).toISOString().slice(0,7)}`).get()).get('reservedUnits'),1);
});
local('pending and approved-but-unused expire at original 30 days; failed stored bytes at seven; rejection is prompt',async()=>{
 const ret=require('../lib/photo_screening_retention');
 for(const mode of ['held','unused','failed','rejected']){
  const result=await submit({family:'menu',targetId:mode},options({name:'fake',screen:async()=>{if(mode==='failed')throw Error('offline');return mode==='unused'?clean:{...clean,adult:'LIKELY'};}}));const row=await record(result);
  if(mode==='rejected'){await api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'rejected'})},options());await gone(row);continue;}
  const expiry=mode==='failed'?7:30;const at=now;now=millisForTest(row.createdAt)+expiry*ret.dayMs-1;await ret.maintainScreeningPhotos(db,{now:()=>now});assert.equal((await bucket.file(row.storagePath).exists())[0],true);
  now++;await ret.maintainScreeningPhotos(db,{now:()=>now});await gone(row);assert.equal((await record(result)).state,'expired');now=at;
 }
 function millisForTest(t){return t.toMillis();}
});
local('after candidate cutover old clients cannot upload public bytes or change image URLs; historical reads and text edits remain',async()=>{
 for(const objectPath of ['bitesaver_restaurants/owner/restaurant_images/old.jpg','bitesaver_restaurants/owner/coupon_images/old.jpg','bitesaver_restaurants/owner/menu_images/old.jpg','restaurant_menus/menu/menu_images/old.jpg','public_menu_images/bsmia_'+ 'a'.repeat(43)+'/image.jpg']){
  for(const uid of ['owner','admin','other'])await assertFails(uploadBytes(ref(client(uid,uid==='admin').storage(bucketName),objectPath),bytes,{contentType:'image/png'}));
  await bucket.file(objectPath).save(bytes,{resumable:false,metadata:{contentType:'image/png'}});assert.equal((await media({storagePath:objectPath})).status,200);
 }
 const store=client('owner').firestore();await assertSucceeds(setDoc(doc(store,'restaurant_accounts/owner/coupons/text'),{id:'text',title:'Text only',imageUrl:null}));
 await assertFails(updateDoc(doc(store,'restaurant_accounts/owner/coupons/text'),{imageUrl:'https://evil.test/image'}));
 await db.doc('restaurant_accounts/owner/coupons/historical').set({id:'historical',title:'Old',imageUrl:'https://old.test/photo'});
 await assertSucceeds(updateDoc(doc(store,'restaurant_accounts/owner/coupons/historical'),{title:'Edited text'}));
 await assertFails(updateDoc(doc(store,'restaurant_accounts/owner'),{mainImageUrl:'https://evil.test/image'}));
 for(const path of ['restaurant_accounts/owner/menu_images/new','restaurant_menus/menu/menu_images/new'])await assertFails(setDoc(doc(store,path),{id:'new',imageUrl:'https://evil.test/image'}));
});

async function managedHarness() {
 const {createOwnerMediaDependencies}=require('../lib/bitesaver_owner_media_runtime');
 const {saveOwnerMedia}=require('../lib/bitesaver_owner_media');
 const deps=createOwnerMediaDependencies(db,bucket,async()=>{throw Error('token minting forbidden');});
 const call=data=>saveOwnerMedia({auth:signed('owner'),data:{intent:'ownerMediaUpdate',...data}},deps);
 return {call, deps, async register(asset){const s=await call({action:'load'});return call({action:'register',imageId:asset.imageId,extension:'jpg',expectedVersion:s.media.version,requestId:`reg-${s.media.version}`});},
 async publish(extra){const s=await call({action:'load'});return call({action:'publish',section:'specials',gallery:s.media.gallery,mode:'manual',boardImage:null,specials:[],...extra,expectedVersion:s.media.version,contentFingerprint:s.contentFingerprint,requestId:`pub-${s.media.version}`});}};
}
const special=(extra={})=>({id:'lunch',title:'Lunch',details:'Keep this text',isActive:true,availabilityMode:'specificDays',daysOfWeek:[1,2,3,4,5,6,7],allDay:true,startTime:null,endTime:null,hideWhenUnavailable:true,expiresAtMillis:null,imageId:null,...extra});
async function saveMain(asset) {
 return db.runTransaction(async tx=>{
  const source=await tx.get(db.doc('restaurant_accounts/owner'));
  const row=await ownerApi.requireOwnerPhotoReference(db,tx,'biteSaver','owner','main','owner',asset.imageUrl,source.get('mainImageUrl'));
  tx.update(source.ref,{mainImageUrl:asset.imageUrl});ownerApi.markOwnerPhotoAttached(db,tx,row);
 });
}
local('main preserves inactive subscription eligibility; exact save and migration into managed gallery preserve live references',async()=>{
 await db.doc('restaurant_accounts/owner').update({couponPostingEnabled:false,approvalStatus:'pending'});
 const main=await submit({family:'main',targetId:'owner'}),row=await record(main);await saveMain(main);assert.equal((await media(row)).status,200);
 await assert.rejects(submit({family:'managed',targetId:'gallery'}));
 await db.doc('restaurant_accounts/owner').update({couponPostingEnabled:true,approvalStatus:'approved'});
 const h=await managedHarness();await h.publish({section:'photos',gallery:['legacy-main']});
 await db.doc('restaurant_accounts/owner').update({mainImageUrl:'https://historical.test/new'});
 await ownerApi.retireDetachedOwnerPhoto(db,main.imageUrl,options());assert.equal((await record(main)).state,'approved');assert.equal((await media(row)).status,200);
 await h.publish({section:'photos',gallery:[]});await ownerApi.retireDetachedOwnerPhoto(db,main.imageUrl,options());
 assert.equal((await record(main)).state,'withdrawn');await require('../lib/photo_screening_retention').maintainScreeningPhotos(db,{now:()=>now});await gone(row);
});
local('manual special and board use exact targets, text-only entries and exclusive display; crossed gallery assignment fails',async()=>{
 const h=await managedHarness(); const a=await submit({targetId:'lunch'});await h.register(a);
 const b=await submit({targetId:'board'});await h.register(b);
 const g=await submit({targetId:'gallery'});await h.register(g);
 await assert.rejects(h.publish({gallery:[g.imageId],specials:[special({imageId:g.imageId})]}));
 await h.publish({specials:[special({imageId:a.imageId}),special({id:'text'})]});
 const publicSpecial=require('../lib/bitesaver_owner_media').managedSpecialForPublication;
 let root=(await db.doc('restaurant_accounts/owner').get()).data();
 assert.equal(publicSpecial(root,'lunch',(await db.doc('restaurant_accounts/owner/daily_specials/lunch').get()).data()).imageUrl,a.imageUrl);
 assert.equal(publicSpecial(root,'text',(await db.doc('restaurant_accounts/owner/daily_specials/text').get()).data()).imageUrl,null);
 assert.equal((await media(await record(a))).status,200);assert.equal((await media(await record(b))).status,403);
 await h.publish({specials:[special({imageId:a.imageId})],mode:'photo',boardImage:b.imageId,board:special({title:'Board',imageId:b.imageId})});
 root=(await db.doc('restaurant_accounts/owner').get()).data();assert.equal(publicSpecial(root,'lunch',(await db.doc('restaurant_accounts/owner/daily_specials/lunch').get()).data()),null);
 assert.equal(publicSpecial(root,'bitesaver_managed_board',(await db.doc('restaurant_accounts/owner/daily_specials/bitesaver_managed_board').get()).data()).imageUrl,b.imageUrl);
});
local('global and owner pauses stop new attachment in every lane while unchanged coupon text remains usable',async()=>{
 const main=await submit({family:'main',targetId:'owner'}),coupon=await submit({family:'coupon',targetId:'c'}),menu=await submit({family:'menu',targetId:'m'}),gallery=await submit();
 await db.doc('restaurant_accounts/owner/coupons/c').set({id:'c',title:'Text',imageUrl:null});await use(coupon.imageId);
 const h=await managedHarness();await h.register(gallery);
 for(const field of ['enabled','ownerEnabled']){
  await db.doc(api.screeningRuntimePath).update({[field]:false});
  await assert.rejects(saveMain(main));await assert.rejects(use(menu.imageId));await assert.rejects(h.publish({section:'photos',gallery:[gallery.imageId]}));
  await assertSucceeds(updateDoc(doc(client('owner').firestore(),'restaurant_accounts/owner/coupons/c'),{title:'Text edited'}));
  assert.equal((await use(coupon.imageId)).state,'published');
  await db.doc(api.screeningRuntimePath).update({[field]:true});
 }
 assert.equal(calls,4);
});
local('upload absence is cleaned after lease and permits only explicit bounded retry; status never scans',async()=>{
 const ret=require('../lib/photo_screening_retention');
 const failed=await submit({}, {...options(),objects:{...objects,put:async()=>{throw Error('upload failed');}}});
 assert.equal(failed.state,'upload_failed');assert.equal(calls,0);now+=180001;
 await ret.maintainScreeningPhotos(db,{now:()=>now});assert.equal((await record(failed)).cleanupStatus,'complete');
 await ownerApi.getOwnerScreenedPhotoHandler(db,{auth:signed('owner'),data:{schemaVersion:1,expectedUserId:'owner',imageId:failed.imageId}},options());assert.equal(calls,0);
 assert.equal((await submit()).state,'upload_failed');assert.equal(calls,0);
 const retried=await submit({retry:true});assert.equal(retried.state,'available');assert.equal(calls,1);assert.equal(retried.imageId,failed.imageId);
 const before=await record(retried);await bucket.file(before.storagePath).delete();await assert.rejects(submit({retry:true}));assert.equal(calls,1);
});
local('trusted target token cannot be stripped; deletion/recreation and generation replacement cannot resurrect approval',async()=>{
 const result=await submit({family:'menu',targetId:'page'});await use(result.imageId);
 const target='restaurant_accounts/owner/menu_images/page';const current=(await db.doc(target).get()).data();
 await assertFails(updateDoc(doc(client('owner').firestore(),target),{screeningTargetToken:'forged'}));
 await assertFails(updateDoc(doc(client('owner').firestore(),target),{screeningImageId:'legacy'}));
 assert.equal((await submit({family:'menu',targetId:'page'})).imageId,result.imageId);assert.equal(calls,1);
 await db.doc(target).delete();await db.doc(target).set({id:'page',title:'Different incarnation',imageUrl:null});
 await assert.rejects(use(result.imageId));await assert.rejects(ownerApi.getOwnerScreenedPhotoHandler(db,{auth:signed('owner'),data:{schemaVersion:1,expectedUserId:'owner',imageId:result.imageId}},options()));
 await db.doc(target).set(current);const row=await record(result);await bucket.file(row.storagePath).save(bytes,{resumable:false});
 assert.equal((await media(row)).status,403);await assert.rejects(use(result.imageId));
});
local('Admin menu authority retains existing inactive-owner exception and rechecks revoked Admin claims',async()=>{
 await db.doc('restaurant_accounts/owner').update({couponPostingEnabled:false,approvalStatus:'pending'});
 const result=await submit({family:'menu',targetId:'admin-page'},options(),'admin');await use(result.imageId,'attach','admin');assert.equal((await media(await record(result))).status,200);
 await assert.rejects(use(result.imageId,'attach','owner'));
 await auth.setCustomUserClaims('admin',{});
 await assert.rejects(submit({family:'menu',targetId:'revoked'},options(),'admin'));
 await auth.setCustomUserClaims('admin',{admin:true});
});
local('source revocation and account deletion during provider call fail closed; delayed retire cannot remove live image',async()=>{
 for(const mode of ['source','deletion']){
  const result=await submit({family:'menu',targetId:mode},options({name:'fake',screen:async()=>{
   if(mode==='source')await db.doc('restaurant_accounts/owner').update({couponPostingEnabled:false});else await db.doc('private_account_deletions/owner').set({state:'requested'});return clean;
  }}));assert.equal(result.state,'failed');assert.equal((await media(await record(result))).status,403);
  await db.doc('private_account_deletions/owner').delete();await db.doc('restaurant_accounts/owner').update({couponPostingEnabled:true});
 }
 const result=await submit({family:'coupon',targetId:'safe'});await db.doc('restaurant_accounts/owner/coupons/safe').set({title:'Safe'});await use(result.imageId);
 await ownerApi.retireDetachedOwnerPhoto(db,result.imageUrl,options());assert.equal((await record(result)).state,'approved');
 await db.doc('restaurant_accounts/owner/coupons/safe').update({imageUrl:null});await ownerApi.retireDetachedOwnerPhoto(db,result.imageUrl,options());
 assert.equal((await record(result)).state,'withdrawn');await require('../lib/photo_screening_retention').maintainScreeningPhotos(db,{now:()=>now});await gone(await record(result));
});
local('deletion drains exact screened shared-menu references even when bytes already absent; other owners and shared text survive',async()=>{
 const result=await submit({sourceType:'sharedMenu',sourceId:'menu',family:'menu',targetId:'screened'});await use(result.imageId);
 await db.doc('restaurant_menus/menu/menu_images/other').set({imageUrl:'https://other.test/image',storagePath:'other/bytes'});
 await db.doc('restaurant_menus/menu/menu_items/text').set({name:'Keep shared menu text'});
 const row=await record(result);await bucket.file(row.storagePath).delete();
 const remove=require('../lib/account_deletion_media').removeScreenedOwnerMenuReference;
 const context={db,job:{uid:'owner'},assertLease:async()=>{}};
 assert.equal(await remove(context,row),true);assert.equal(await remove(context,row),false);
 assert.equal((await db.doc('restaurant_menus/menu/menu_images/screened').get()).exists,false);
 assert.equal((await db.doc('restaurant_menus/menu/menu_images/other').get()).exists,true);assert.equal((await db.doc('restaurant_menus/menu/menu_items/text').get()).get('name'),'Keep shared menu text');
});
local('manual-special approval cannot follow a deleted/recreated target; draft token survives later text saves',async()=>{
 const h=await managedHarness();await h.publish({specials:[special()]});
 const held=await submit({targetId:'lunch'},options({name:'fake',screen:async()=>({...clean,racy:'POSSIBLE'})}));const row=await record(held);
 await db.doc('restaurant_accounts/owner/daily_specials/lunch').delete();await db.doc('restaurant_accounts/owner/daily_specials/lunch').set({...special(),title:'Replacement'});
 await assert.rejects(api.decideScreeningPhotoHandler(db,{auth:signed('admin'),data:adminData(row,{decision:'approved'})},options()));
 const draft=await submit({targetId:'draft-special'});await h.register(draft);
 await h.publish({specials:[special({id:'draft-special',imageId:draft.imageId})]});
 const target=db.doc('restaurant_accounts/owner/daily_specials/draft-special');const token=(await target.get()).get('screeningTargetToken');assert.ok(token);
 await h.publish({specials:[special({id:'draft-special',title:'Edited text',imageId:draft.imageId})]});assert.equal((await target.get()).get('screeningTargetToken'),token);
 await assertFails(updateDoc(doc(client('owner').firestore(),target.path),{screeningTargetToken:'forged'}));
 await target.delete();await target.set({...special(),id:'draft-special',title:'Recreated',imageUrl:null});
 await assert.rejects(h.publish({specials:[special({id:'draft-special',imageId:draft.imageId})]}));
});
local('legacy deletion of manual special or board hides bytes immediately and retirement preserves unrelated gallery',async()=>{
 const h=await managedHarness();const gallery=await submit();await h.register(gallery);
 const manual=await submit({targetId:'lunch'});await h.register(manual);const board=await submit({targetId:'board'});await h.register(board);
 await h.publish({gallery:[gallery.imageId],specials:[special({imageId:manual.imageId})],mode:'photo',boardImage:board.imageId,board:special({imageId:board.imageId})});
 for(const [asset,target] of [[manual,'lunch'],[board,'bitesaver_managed_board']]){
  await ownerApi.retireDetachedOwnerPhoto(db,asset.imageUrl,options());assert.equal((await record(asset)).state,'approved');
  await db.doc(`restaurant_accounts/owner/daily_specials/${target}`).delete();assert.equal((await media(await record(asset))).status,403);
  await ownerApi.retireDetachedOwnerPhoto(db,asset.imageUrl,options());assert.equal((await record(asset)).state,'withdrawn');
 }
 await h.publish({section:'photos',gallery:[gallery.imageId]});
 await require('../lib/photo_screening_retention').maintainScreeningPhotos(db,{now:()=>now});
 await gone(await record(manual));await gone(await record(board));assert.equal((await media(await record(gallery))).status,200);
});
local('removing an unrelated unused photo preserves published special, board and gallery references',async()=>{
 const h=await managedHarness();const gallery=await submit();await h.register(gallery);
 const manual=await submit({targetId:'lunch'});await h.register(manual);const board=await submit({targetId:'board'});await h.register(board);
 const unused=await submit({bytesBase64:Buffer.concat([bytes,Buffer.from('different')]).toString('base64')});await h.register(unused);
 await h.publish({gallery:[gallery.imageId],specials:[special({imageId:manual.imageId})],mode:'photo',boardImage:board.imageId,board:special({imageId:board.imageId})});
 const before=(await h.call({action:'load'})).media;const image=before.images.find(i=>i.id===unused.imageId);
 await require('../lib/bitesaver_owner_media').removeOwnerImage({auth:signed('owner'),data:{imageId:unused.imageId,registrationVersion:image.registrationVersion}},h.deps);
 const after=(await h.call({action:'load'})).media;
 assert.deepEqual(after.gallery,before.gallery);assert.deepEqual(after.specialImages,before.specialImages);assert.equal(after.boardImage,before.boardImage);
 for(const asset of [gallery,manual,board]){const row=await record(asset);assert.equal(row.attached,true);assert.equal((await media(row)).status,200);}
 await gone(await record(unused));
 // A bounded legacy-special page cannot prove that a later document is absent.
 for(let i=0;i<53;i++)await db.doc(`restaurant_accounts/owner/daily_specials/a${String(i).padStart(3,'0')}`).set({title:'Legacy text'});
 await h.publish({section:'photos',gallery:[gallery.imageId]});
 const overflow=(await h.call({action:'load'})).media;
 assert.deepEqual(overflow.specialImages,before.specialImages);assert.equal(overflow.boardImage,before.boardImage);
 for(const asset of [gallery,manual,board])assert.equal((await media(await record(asset))).status,200);
});
local('full account deletion removes screened shared-menu bytes and references while retaining shared facts and other users',async()=>{
 await db.doc('restaurant_menus/menu').update({bitescoreRestaurantId:'restaurant'});
 const result=await submit({sourceType:'sharedMenu',sourceId:'menu',family:'menu',targetId:'owned'});await use(result.imageId);
 const row=await record(result);
 await db.doc('restaurant_menus/menu/menu_items/text').set({name:'Shared facts'});
 await db.doc('restaurant_menus/menu/menu_images/other').set({imageUrl:'https://other.test/image',storagePath:'other/object'});
 const deletion=require('../lib/account_deletion_service');
 const identity=async uid=>{try{const u=await auth.getUser(uid);return {uid,creationTime:u.metadata.creationTime,providerIds:u.providerData.map(p=>p.providerId),disabled:u.disabled};}catch(e){if(e.code==='auth/user-not-found')return null;throw e;}};
 const adapter={getIdentity:identity,deleteIdentity:uid=>auth.deleteUser(uid)};
 const generation=async path=>{try{return String((await bucket.file(path).getMetadata())[0].generation);}catch(e){if(e.code===404)return null;throw e;}};
 const objectAdapter={nextOwnedPath:async()=>null,nextMenuPath:async()=>null,referenceUrls:async()=>[],generation,
  nextPersonalPath:async(uid,after)=>{const prefix=`bitescore_user_uploads/${require('../lib/account_deletion_finalized_media').accountDeletionPhotoOwnerKey(uid)}/`;
   return (await bucket.getFiles({prefix}))[0].map(f=>f.name).sort().find(p=>!after||p>after)??null;},
  personalGeneration:async(path,uid)=>{assert.ok(path.includes(require('../lib/account_deletion_finalized_media').accountDeletionPhotoOwnerKey(uid)));return generation(path);},
  deleteGeneration:async(path,g)=>{assert.equal(await generation(path),g);await bucket.file(path).delete();}};
 await deletion.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:'owner',confirmation:'DELETE',receipt:'x'.repeat(43)},
  {uid:'owner',authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},await identity('owner'),now);
 const step=require('../lib/account_deletion_cleanup').createAccountDeletionStep(adapter,undefined,objectAdapter);
 let job;
 for(let i=0;i<250;i++){now+=4000000;await deletion.processAccountDeletionJob(db,'owner',step,()=>now);job=(await db.doc('private_account_deletions/owner').get()).data();if(['complete','pending'].includes(job.state))break;}
 assert.equal(job.state,'complete',JSON.stringify({phase:job.phase,reason:job.pendingReason}));
 await gone(row);assert.equal((await db.doc('restaurant_menus/menu/menu_images/owned').get()).exists,false);
 assert.equal((await db.doc('restaurant_menus/menu/menu_images/other').get()).exists,true);assert.equal((await db.doc('restaurant_menus/menu/menu_items/text').get()).get('name'),'Shared facts');
 assert.equal(await identity('owner'),null);assert.ok(await identity('other'));assert.equal((await db.doc(`${api.screeningCollection}/${row.imageId}`).get()).exists,false);
});
