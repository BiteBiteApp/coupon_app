'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const media=require('../lib/account_deletion_finalized_media');
const api=require('../lib/account_deletion_service');
const {createAccountDeletionStep}=require('../lib/account_deletion_cleanup');
const enabled=process.env.RUN_ACCOUNT_DELETION_EMULATOR==='1';
const project='demo-coupon-app-rules';
let db,auth,app,now;
const ownerKey=media.accountDeletionPhotoOwnerKey;
const path=(uid='late-A')=>`bitescore_user_uploads/${ownerKey(uid)}/dish_images/shared/${randomUUID()}.jpg`;
const metadata=(uid='late-A')=>({ownershipVersion:'1',uploaderKey:ownerKey(uid),dishId:'shared'});
const event=(name,generation='10',meta=metadata())=>({type:media.accountDeletionFinalizeEvent,data:{bucket:media.accountDeletionMediaBucket,name,generation,metadata:meta}});
const unavailable=()=>{throw Error('Unexpected dependency access');};
for(const [label,change] of [
 ['other bucket',e=>e.data.bucket='foreign'],['metadata update',e=>e.type='google.cloud.storage.object.v1.metadataUpdated'],
 ['old photo',e=>e.data.name='bitescore_dishes/shared/images/old.jpg'],['old shared menu',e=>e.data.name='restaurant_menus/shared/menu_images/old.jpg'],
 ['malformed generation',e=>e.data.generation='10x'],['unsafe numeric generation',e=>e.data.generation=Number.MAX_SAFE_INTEGER+1],
 ['forged metadata',e=>e.data.metadata.uploaderKey=ownerKey('late-B')],['missing proof',e=>e.data.metadata={}],
 ['extra path segment',e=>e.data.name+='/extra'],
])test(`finalize ignores ${label} before dependencies`,async()=>{const e=event(path());change(e);await media.accountDeletionObjectFinalizedHandler(new Proxy({},{get:unavailable}),e,unavailable,{readGeneration:unavailable,deleteGeneration:unavailable});});
const local=(name,fn)=>test(name,{skip:!enabled},fn);
const identity=async(uid)=>{try{const u=await auth.getUser(uid);return {uid,creationTime:u.metadata.creationTime,providerIds:u.providerData.map(p=>p.providerId),disabled:u.disabled};}catch(e){if(e.code==='auth/user-not-found')return null;throw e;}};
const ordinary={nextPersonalPath:async()=>null,personalGeneration:async()=>null,nextOwnedPath:async()=>null,nextMenuPath:async()=>null,referenceUrls:async()=>[],generation:async()=>null,deleteGeneration:unavailable};
const authAdapter={getIdentity:identity,deleteIdentity:uid=>auth.deleteUser(uid)};
async function accept(uid='late-A'){
 const receipt=randomBytes(32).toString('base64url');
 await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt},{uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},await identity(uid),now);
 return receipt;
}
const root=(uid='late-A')=>db.doc(`private_account_deletions/${uid}`);
async function drain(objects,uid='late-A'){
 const step=createAccountDeletionStep(authAdapter,undefined,ordinary,objects);
 for(let i=0;i<200;i++){now+=4000000;await api.processAccountDeletionJob(db,uid,step,()=>now);const j=(await root(uid).get()).data();if(j.state==='complete')return j;if(j.state==='pending')return j;}
 throw Error('Bounded local drain did not converge');
}
function fakeObjects(name,generation='10',meta=metadata()){
 const values=new Map([[name,{generation,metadata:meta}]]),deletes=[];
 return {values,deletes,async readGeneration(p,g){const v=values.get(p);return v?.generation===g?{...v}:null;},async deleteGeneration(p,g){deletes.push([p,g]);if(values.get(p)?.generation===g)values.delete(p);}};
}
const invoke=(e,o,getIdentity=identity)=>media.accountDeletionObjectFinalizedHandler(db,e,getIdentity,o,()=>now);
const rows=async()=> (await root().collection('object_items').where('kind','==','late_finalize').get()).docs;
test.before(async()=>{
 if(!enabled)return;
 for(const [key,value]of Object.entries({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8792',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9198',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9298',GCLOUD_PROJECT:project}))assert.equal(process.env[key],value,`LOCAL ${key}`);
 assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
 app=require('firebase-admin/app').initializeApp({projectId:project});db=require('firebase-admin/firestore').getFirestore(app);auth=require('firebase-admin/auth').getAuth(app);
});
test.beforeEach(async()=>{
 if(!enabled)return;now=Date.now();
 assert.equal((await fetch(`http://127.0.0.1:8792/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'})).status,200);
 assert.equal((await fetch(`http://127.0.0.1:9198/emulator/v1/projects/${project}/accounts`,{method:'DELETE'})).status,200);
 for(const uid of ['late-A','late-B'])await auth.createUser({uid,email:`${uid}@example.test`,password:'LOCAL-only-123456'});
});
test.after(async()=>{if(app)await app.delete();});
local('active A survives, and deleting A cannot affect B or a B URL published by A',async()=>{
 const a=path(),b=path('late-B'),o=fakeObjects(a);o.values.set(b,{generation:'11',metadata:metadata('late-B')});
 await invoke(event(a),o);assert.ok(o.values.has(a));assert.equal((await root().get()).exists,false);
 await accept();await db.doc('bitescore_dish_images/copied').set({uploadedByUserId:'late-A',storagePath:b});
 await invoke(event(b,'11',metadata('late-B')),o);assert.ok(o.values.has(b));assert.equal(o.deletes.length,0);
});
local('core race: complete after ordinary scan, then late finalize deletes exact A generation without resurrection',async()=>{
 const name=path(),o=fakeObjects(name);o.values.clear();const receipt=await accept();
 const complete=await drain(o);assert.equal(complete.state,'complete');assert.equal(complete.personalObjectScanComplete,true);assert.equal(await identity('late-A'),null);
 o.values.set(name,{generation:'10',metadata:metadata()});await invoke(event(name),o);
 assert.equal(o.values.size,0);assert.deepEqual(o.deletes,[[name,'10']]);assert.equal((await root().get()).get('state'),'pending');
 assert.equal((await drain(o)).state,'complete');assert.equal((await api.getAccountDeletionStatusHandler(db,{schemaVersion:1,receipt},null)).state,'complete');
 for(const p of ['user_profiles/late-A','restaurant_accounts/late-A','public_reviewer_profiles/late-A'])assert.equal((await db.doc(p).get()).exists,false);
 assert.equal(await identity('late-A'),null);assert.ok(await identity('late-B'));
 const revision=(await root().get()).get('mediaRevision');await invoke(event(name),o);assert.equal((await root().get()).get('state'),'complete');assert.equal((await root().get()).get('mediaRevision'),revision);
});
local('stale G1 event preserves newer G2 even when G1 was journaled before replacement',async()=>{
 await accept();const name=path(),o=fakeObjects(name);o.deleteGeneration=async()=>{throw Error('transient');};
 await assert.rejects(invoke(event(name),o));o.values.set(name,{generation:'11',metadata:metadata('late-B')});
 await invoke(event(name),o);assert.equal(o.values.get(name).generation,'11');assert.equal((await rows())[0].get('complete'),true);
});
local('foreign current metadata cannot be used as owner proof even with forged matching event metadata',async()=>{
 await accept();const name=path(),o=fakeObjects(name,'10',metadata('late-B'));
 await assert.rejects(invoke(event(name),o));assert.equal(o.deletes.length,0);assert.equal((await rows())[0].get('complete'),false);
});
for(const mode of ['temporary','lost-ack','after-delete-read','crash-after-journal'])local(`durable retry recovers ${mode} through the existing worker`,async()=>{
 await accept();const name=path(),o=fakeObjects(name);const del=o.deleteGeneration.bind(o),read=o.readGeneration.bind(o);
 let failed=false;
 if(mode==='temporary'||mode==='lost-ack')o.deleteGeneration=async(p,g)=>{if(!failed){failed=true;if(mode==='lost-ack')await del(p,g);throw Error(mode);}await del(p,g);};
 if(mode==='after-delete-read')o.readGeneration=async(p,g)=>{if(o.deletes.length&&!failed){failed=true;throw Error('lost verification');}return read(p,g);};
 await assert.rejects(invoke(event(name),o,mode==='crash-after-journal'?async()=>{throw Error('crash');}:identity));
 assert.equal((await rows())[0].get('complete'),false);
 assert.equal((await drain(o)).state,'complete');assert.equal(o.values.has(name),false);assert.equal(o.deletes.length,1);assert.equal((await rows())[0].get('complete'),true);
});
local('parallel duplicate deliveries create one journal/revision; already absent event is idempotent',async()=>{
 await accept();const name=path(),o=fakeObjects(name);o.values.clear();
 await Promise.all([invoke(event(name),o),invoke(event(name),o)]);
 assert.equal((await rows()).length,1);assert.equal((await root().get()).get('mediaRevision'),1);assert.equal(o.deletes.length,0);
});
local('finalize registration racing worker completion prevents false complete and preserves active lease',async()=>{
 await accept();const name=path(),o=fakeObjects(name);o.deleteGeneration=async()=>{throw Error('retry');};
 await api.processAccountDeletionJob(db,'late-A',async c=>{
  const token=c.job.leaseToken;await assert.rejects(invoke(event(name),o));assert.equal((await root().get()).get('leaseToken'),token);return {complete:true};
 },()=>now);
 assert.equal((await root().get()).get('state'),'pending');assert.equal((await root().get()).get('reason'),'media');
});
local('preexisting known late journal also blocks completion without a revision change',async()=>{
 await accept();const name=path(),o=fakeObjects(name);o.deleteGeneration=async()=>{throw Error('retry');};await assert.rejects(invoke(event(name),o));
 await api.processAccountDeletionJob(db,'late-A',async()=>({complete:true}),()=>now);
 assert.equal((await root().get()).get('state'),'pending');
});
local('same-email new UID survives; unsafe identical UID reuse preserves bytes and reports identity_changed',async()=>{
 await accept();const name=path(),o=fakeObjects(name);o.values.clear();await drain(o);
 await auth.createUser({uid:'same-email-new-uid',email:'late-A@example.test',password:'LOCAL-only-123456'});
 const b=path('same-email-new-uid');o.values.set(b,{generation:'20',metadata:metadata('same-email-new-uid')});await invoke(event(b,'20',metadata('same-email-new-uid')),o);assert.ok(o.values.has(b));
 await auth.createUser({uid:'late-A',email:'replacement@example.test',password:'LOCAL-only-123456'});
 // Force a distinct persisted old creation identity without relying on emulator second resolution.
 await root().update({authCreationTime:'Wed, 01 Jan 2020 00:00:00 GMT'});
 o.values.set(name,{generation:'10',metadata:metadata()});await assert.rejects(invoke(event(name),o));assert.ok(o.values.has(name));
 assert.equal((await drain(o)).reason,'identity_changed');assert.ok(await identity('late-A'));
});
local('retired menu grant retains exact proof after absent scan/completion; revoked preparation alone is insufficient',async()=>{
 const id='bsmia_'+randomBytes(32).toString('base64url'),name=`public_menu_images/${id}/image.jpg`,g=db.doc(`private_menu_image_upload_authorizations/${id}`);
 await g.set({schemaVersion:1,state:'revoked',ownerUserId:'late-A',sourceType:'sharedMenu',sourceId:'adopted',fileName:'image.jpg'});
 const o=fakeObjects(name,'10',{});await invoke(event(name,'10',{}),o);assert.ok(o.values.has(name));
 o.values.clear();await accept();assert.equal((await drain(o)).state,'complete');const proof=(await g.get()).data();assert.equal(proof.state,'retired');assert.equal(proof.deletionOperationId,(await root().get()).get('operationId'));
 await db.doc('restaurant_menus/adopted').set({createdByUserId:'late-B',name:'B facts'});
 o.values.set(name,{generation:'10',metadata:{}});await invoke(event(name,'10',{}),o);assert.equal(o.values.has(name),false);assert.equal((await db.doc('restaurant_menus/adopted').get()).get('createdByUserId'),'late-B');
});
local('every trusted business prefix resolves exact UID; foreign and malformed grants survive',async()=>{
 await accept();
 for(const directory of ['restaurant_images','coupon_images','menu_images']){const name=`bitesaver_restaurants/late-A/${directory}/a.jpg`,o=fakeObjects(name,'10',{});await invoke(event(name,'10',{}),o);assert.equal(o.values.size,0);}
 const id='bsmia_'+randomBytes(32).toString('base64url'),name=`public_menu_images/${id}/image.jpg`,o=fakeObjects(name,'10',{});
 await db.doc(`private_menu_image_upload_authorizations/${id}`).set({schemaVersion:1,state:'revoked',ownerUserId:'late-B',sourceType:'biteSaver',sourceId:'late-B',fileName:'image.jpg'});await invoke(event(name,'10',{}),o);assert.ok(o.values.has(name));
 await db.doc(`private_menu_image_upload_authorizations/${id}`).update({ownerUserId:'late-A'});await invoke(event(name,'10',{}),o);assert.ok(o.values.has(name));
});
local('real local Storage adapter removes late object and preserves forged ownership metadata',async()=>{
 await accept();const name=path(),bucket=require('firebase-admin/storage').getStorage(app).bucket(media.accountDeletionMediaBucket),file=bucket.file(name);
 const o=media.createAccountDeletionFinalizedObjects();await drain(o);
 await file.save(Buffer.from('synthetic delayed finalize'),{resumable:false,metadata:{contentType:'image/jpeg',metadata:metadata()}});
 const generation=String((await file.getMetadata())[0].generation);await invoke(event(name,generation),o);assert.equal((await file.exists())[0],false);
 await invoke(event(name,generation),o);
 const foreign=bucket.file(path());await foreign.save(Buffer.from('synthetic forged object'),{resumable:false,metadata:{contentType:'image/jpeg',metadata:metadata('late-B')}});
 const g=String((await foreign.getMetadata())[0].generation);await assert.rejects(invoke(event(foreign.name,g),o));assert.equal((await foreign.exists())[0],true);
 await foreign.delete();
 // Storage emulator does not model retained old versions/provider delivery.
 // Exact G1/G2 precondition races are deterministic fakes above.
});

test('pinned Storage SDK receives exact decimal generation and precondition without Number rounding',async()=>{
 const adminStorage=require('firebase-admin/storage'),original=adminStorage.getStorage;
 const sdk=new (require('@google-cloud/storage').Storage)({projectId:project});
 const requests=[],generation='9007199254740993';
 sdk.request=(options,callback)=>{requests.push(options);callback(null,{generation,metadata:metadata()},{});};
 adminStorage.getStorage=()=>({bucket:name=>{assert.equal(name,media.accountDeletionMediaBucket);return sdk.bucket(name);}});
 try {
  const o=media.createAccountDeletionFinalizedObjects();
  assert.equal((await o.readGeneration('synthetic/local.jpg',generation)).generation,generation);
  await o.deleteGeneration('synthetic/local.jpg',generation);
  await require('../lib/account_deletion_media').createAccountDeletionObjects().deleteGeneration('synthetic/local.jpg',generation);
  assert.equal(requests.length,3);
  for(const request of requests)assert.equal(request.qs.generation,generation);
  for(const request of requests.slice(1))assert.equal(request.qs.ifGenerationMatch,generation);
 }finally{adminStorage.getStorage=original;}
});
