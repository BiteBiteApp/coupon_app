'use strict';
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,deleteDoc}=require('firebase/firestore');
const {ref,uploadBytes,getBytes}=require('firebase/storage');
const projectId='demo-coupon-app-rules';
let env;
const actor=(uid,admin=false)=>env.authenticatedContext(uid,{email:`${uid}@example.test`,email_verified:true,admin,firebase:{sign_in_provider:'password'}});
const seed=async(rows)=>env.withSecurityRulesDisabled(async context=>{for(const [p,v] of Object.entries(rows))await setDoc(doc(context.firestore(),p),v);});
test.before(async()=>{
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8792'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9298')throw new Error('Deletion Rules tests require exact guarded local emulator ports');
 env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')},storage:{rules:fs.readFileSync(path.resolve(__dirname,'../../storage.rules'),'utf8')}});
});
test.beforeEach(async()=>{await env.clearFirestore();await env.clearStorage();await seed({'user_profiles/fake-A':{userId:'fake-A',displayName:'A'},'user_profiles/fake-B':{userId:'fake-B',displayName:'B'}});});
test.after(async()=>{if(env)await env.cleanup();});
test('marker is client-private; existence blocks actor and Admin target writes but preserves reads and B',async()=>{
 const a=actor('fake-A').firestore(),b=actor('fake-B',true).firestore();
 await assertSucceeds(updateDoc(doc(a,'user_profiles/fake-A'),{displayName:'before'}));
 await assertFails(setDoc(doc(a,'private_account_deletions/fake-A'),{state:'complete'}));
 for(const marker of [{},{state:'pending'},{state:'complete'},{malformed:true}]) {
  await seed({'private_account_deletions/fake-A':marker});
  await assertFails(getDoc(doc(a,'private_account_deletions/fake-A')));
  await assertFails(updateDoc(doc(a,'user_profiles/fake-A'),{displayName:'late'}));
  await assertFails(updateDoc(doc(b,'user_profiles/fake-A'),{displayName:'late admin'}));
  await assertSucceeds(getDoc(doc(a,'user_profiles/fake-A')));
  await assertSucceeds(updateDoc(doc(b,'user_profiles/fake-B'),{displayName:'B survives'}));
 }
});
test('active B cannot create or retarget feedback onto absent/deleting A review; orphan own-delete remains',async()=>{
 const b=actor('fake-B').firestore();
 const vote={userId:'fake-B',reviewId:'review-A',dishId:'dish',restaurantId:'restaurant',voteType:'helpful'};
 await seed({'dish_reviews/review-A':{userId:'fake-A',dishId:'dish',restaurantId:'restaurant'},'dish_reviews/review-B':{userId:'fake-B',dishId:'dish',restaurantId:'restaurant'}});
 await assertSucceeds(setDoc(doc(b,'review_feedback_votes/B-A'),vote));
 await seed({'private_account_deletions/fake-A':{state:'requested'}});
 await assertFails(updateDoc(doc(b,'review_feedback_votes/B-A'),{voteType:'not_helpful'}));
 await assertSucceeds(deleteDoc(doc(b,'review_feedback_votes/B-A')));
 await assertFails(setDoc(doc(b,'review_feedback_votes/new'),vote));
 await assertFails(setDoc(doc(b,'review_feedback_votes/missing'),{...vote,reviewId:'absent'}));
 await assertSucceeds(setDoc(doc(b,'review_feedback_votes/own'),{...vote,reviewId:'review-B'}));
});
test('anonymous actor fence covers direct writes and Admin cannot recreate nested favorites',async()=>{
 const admin=actor('fake-B',true).firestore();
 const favorite={userId:'fake-A',restaurantId:'restaurant',restaurantType:'bitescore',savedAt:new Date()};
 await assertSucceeds(setDoc(doc(actor('fake-A').firestore(),'user_profiles/fake-A/favorite_restaurants/restaurant'),favorite));
 await assertSucceeds(deleteDoc(doc(admin,'user_profiles/fake-A/favorite_restaurants/restaurant')));
 await seed({'user_profiles/fake-A/favorite_restaurants/restaurant':favorite});
 await seed({'private_account_deletions/fake-A':{}});
 await assertFails(deleteDoc(doc(admin,'user_profiles/fake-A/favorite_restaurants/restaurant')));
 await assertFails(setDoc(doc(actor('fake-A').firestore(),'user_profiles/fake-A/favorite_restaurants/another'),favorite));
 const anonymous=env.authenticatedContext('fake-A',{firebase:{sign_in_provider:'anonymous'}}).firestore();
 await assertFails(updateDoc(doc(anonymous,'user_profiles/fake-A'),{displayName:'late'}));
});
test('immutable uploader Rules bind actual owner and reject forged proof, old admission and post-fence admission',async()=>{
 await seed({'bitescore_dishes/shared':{id:'shared'}});
 const a=actor('fake-A').storage(),b=actor('fake-B').storage(),bytes=new Uint8Array([1,2,3]);
 const ownerKey=uid=>require('node:crypto').createHash('sha256').update(`bitestar.dish-upload.v1:${uid}`).digest('hex');
 const nonce=require('node:crypto').randomUUID();
 const path=(uid,name)=>`bitescore_user_uploads/${ownerKey(uid)}/dish_images/shared/${name}-${nonce}.jpg`;
 const meta=uid=>({contentType:'image/jpeg',customMetadata:{ownershipVersion:'1',uploaderKey:ownerKey(uid),dishId:'shared'}});
 await assertSucceeds(uploadBytes(ref(a,path('fake-A','a')),bytes,meta('fake-A')));
 await assertFails(uploadBytes(ref(a,path('fake-B','forged-path')),bytes,meta('fake-A')));
 await assertFails(uploadBytes(ref(a,path('fake-A','forged-owner')),bytes,meta('fake-B')));
 for(const customMetadata of [{},{ownershipVersion:'1',uploaderKey:ownerKey('fake-A'),dishId:'other'},{...meta('fake-A').customMetadata,extra:'no'}])
  await assertFails(uploadBytes(ref(a,path('fake-A','bad')),bytes,{contentType:'image/jpeg',customMetadata}));
 await assertFails(uploadBytes(ref(a,path('fake-A','a')),bytes,meta('fake-A')));
 await assertFails(uploadBytes(ref(a,'bitescore_dishes/shared/images/old.jpg'),bytes,meta('fake-A')));
 await seed({'private_account_deletions/fake-A':{}});
 await assertFails(uploadBytes(ref(a,path('fake-A','late')),bytes,meta('fake-A')));
 await assertSucceeds(uploadBytes(ref(b,path('fake-B','b')),bytes,meta('fake-B')));
 await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(),path('fake-A','a'))));
});
test('catalog bio authorship follows the real editor and cannot be reassigned without changing text',async()=>{
 await seed({'bitescore_restaurants/catalog':{id:'catalog',ownerUserId:'fake-A',isClaimed:true,restaurantWriteRevision:0,bio:'A note',bioAuthorUid:'fake-A'}});
 const admin=actor('fake-B',true).firestore(),target=doc(admin,'bitescore_restaurants/catalog');
 await assertFails(updateDoc(target,{bioAuthorUid:'fake-B',restaurantWriteRevision:1}));
 await assertFails(updateDoc(target,{bio:'B replacement',bioAuthorUid:'fake-A',restaurantWriteRevision:1}));
 await assertSucceeds(updateDoc(target,{bio:'B replacement',bioAuthorUid:'fake-B',restaurantWriteRevision:1}));
 await assertFails(updateDoc(target,{bio:'unattributed',restaurantWriteRevision:2,bioAuthorUid:null}));
});
