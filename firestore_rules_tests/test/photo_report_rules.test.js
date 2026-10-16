'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,deleteDoc,serverTimestamp}=require('firebase/firestore');
let env;
const actor=(uid,admin=false)=>env.authenticatedContext(uid,{admin,email_verified:true,firebase:{sign_in_provider:'password'}}).firestore();
const seed=rows=>env.withSecurityRulesDisabled(async c=>{for(const [p,d] of Object.entries(rows))await setDoc(doc(c.firestore(),p),d);});
const image={id:'image',dishId:'dish',restaurantId:'restaurant',uploadedByUserId:'uploader',reviewId:null,imageUrl:'https://example.test/image.jpg',storagePath:'unproven.jpg',moderationStatus:'removed',moderatedAt:new Date()};
const report={schemaVersion:1,reportScope:'photo',id:'photo',imageId:'image',dishId:'dish',restaurantId:'restaurant',reportingUserId:'reporter',reportedUserId:'uploader',supportingReviewId:'deleted-review',targetFingerprint:'a'.repeat(64),status:'pending',reason:'Other',createdAt:new Date()};
test.before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8792');env=await initializeTestEnvironment({projectId:'demo-photo-report-rules',firestore:{rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')}});});
test.beforeEach(async()=>{await env.clearFirestore();await seed({'review_reports/photo':report,'bitescore_dish_images/image':image,'bitescore_dishes/dish':{id:'dish',restaurantId:'restaurant'},'bitescore_restaurants/restaurant':{ownerUserId:'owner',isClaimed:true},'user_profiles/reporter/photo_report_state/admission':{count:1}});});
test.after(async()=>{if(env)await env.cleanup();});
test('photo reports are private and all client creation/evidence/status mutations are denied including Admin',async()=>{
 await assertSucceeds(getDoc(doc(actor('reporter'),'review_reports/photo')));
 await assertSucceeds(getDoc(doc(actor('admin',true),'review_reports/photo')));
 for(const db of [actor('reporter'),actor('uploader'),actor('owner'),actor('stranger'),actor('admin',true),env.unauthenticatedContext().firestore()]){
  await assertFails(setDoc(doc(db,'review_reports/new'),report));
  for(const fields of [{status:'dismissed',updatedAt:serverTimestamp()},{status:'resolved'},{imageId:'other'},{reportScope:'review',reviewId:'review'}])await assertFails(updateDoc(doc(db,'review_reports/photo'),fields));
  await assertFails(deleteDoc(doc(db,'review_reports/photo')));
  await assertFails(getDoc(doc(db,'user_profiles/reporter/photo_report_state/admission')));
  await assertFails(setDoc(doc(db,'user_profiles/reporter/photo_report_state/admission'),{count:0}));
 }
 for(const db of [actor('uploader'),actor('owner'),actor('stranger'),env.unauthenticatedContext().firestore()])await assertFails(getDoc(doc(db,'review_reports/photo')));
});
test('removed photo cannot be replaced, resurrected, or voted on through legacy client paths',async()=>{
 for(const db of [actor('uploader'),actor('owner'),actor('voter'),actor('admin',true)]){
  await assertFails(updateDoc(doc(db,'bitescore_dish_images/image'),{moderationStatus:'active'}));
  await assertFails(updateDoc(doc(db,'bitescore_dish_images/image'),{imageUrl:'https://example.test/replacement.jpg'}));
  await assertFails(setDoc(doc(db,'bitescore_dish_images/image'),{...image,moderationStatus:'active'}));
  await assertFails(deleteDoc(doc(db,'bitescore_dish_images/image')));
 }
 const voter=actor('voter');
 await assertFails(setDoc(doc(voter,'bitescore_dish_image_votes/image_voter'),{userId:'voter',imageId:'image',dishId:'dish',restaurantId:'restaurant',voteType:'helpful'}));
 await seed({'bitescore_dish_image_votes/image_voter':{userId:'voter',imageId:'image',dishId:'dish',restaurantId:'restaurant',voteType:'helpful'}});
 await assertSucceeds(deleteDoc(doc(voter,'bitescore_dish_image_votes/image_voter')));
});
test('unmoderated legacy photo update and uploader deletion remain valid; moderation injection is denied',async()=>{
 const {moderationStatus,moderatedAt,...normal}=image;
 await seed({'bitescore_dish_images/normal':{...normal,id:'normal'}});
 await assertSucceeds(updateDoc(doc(actor('voter'),'bitescore_dish_images/normal'),{helpfulCount:1,updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(actor('owner'),'bitescore_dish_images/normal'),{moderationStatus:'removed'}));
 await assertFails(setDoc(doc(actor('uploader'),'bitescore_dish_images/new'),image));
 await assertSucceeds(deleteDoc(doc(actor('uploader'),'bitescore_dish_images/normal')));
});
test('owner cannot restore a removed primary image through dish fields after trusted cutover',async()=>{
 await seed({'private_bitescore_runtime/aggregation':{enabled:true,version:1,epoch:'local'},'bitescore_dishes/dish':{id:'dish',restaurantId:'restaurant',aggregateWriteGeneration:0},'bitescore_dish_images/normal':{...image,id:'normal',moderationStatus:'active',imageUrl:'https://example.test/normal.jpg'}});
 for(const db of [actor('owner'),actor('admin',true)]) {
  await assertFails(updateDoc(doc(db,'bitescore_dishes/dish'),{primaryImageId:'image',primaryImageUrl:image.imageUrl}));
  await assertFails(updateDoc(doc(db,'bitescore_dishes/dish'),{primaryImageId:'normal',primaryImageUrl:image.imageUrl}));
  await assertSucceeds(updateDoc(doc(db,'bitescore_dishes/dish'),{primaryImageId:'normal',primaryImageUrl:'https://example.test/normal.jpg'}));
 }
});
