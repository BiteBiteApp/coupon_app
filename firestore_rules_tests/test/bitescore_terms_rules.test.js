'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const {doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch} = require('firebase/firestore');
let env;
const policyPath = 'private_bitescore_runtime/terms';
const policy = {schemaVersion: 1, required: true, version: 'TEST-v1', acceptedVersions: ['TEST-v1']};
const actor = (uid = 'writer', overrides = {}) => env.authenticatedContext(uid, {email_verified: true, firebase: {sign_in_provider: 'password'}, ...overrides}).firestore();
const seed = rows => env.withSecurityRulesDisabled(async c => {for (const [p,d] of Object.entries(rows)) await setDoc(doc(c.firestore(), p), d);});
const receipt = (version = 'TEST-v1') => ({userId: 'writer', termsAcceptance: {version, acceptedAt: new Date(1)}});
const profile = {userId: 'writer', publicDisplayName: 'Chosen', chosenUsername: 'Chosen', chosenUsernameNormalized: 'chosen', fallbackUsername: 'anon123', createdAt: new Date(1), updatedAt: new Date(1)};
const dish = {id: 'dish', restaurantId: 'restaurant', name: 'Dish', category: 'Food', isActive: true, aggregateWriteGeneration: 0};
const review = {id: 'review', userId: 'writer', dishId: 'dish', restaurantId: 'restaurant', headline: 'Public', notes: 'Words', overallBiteScore: 80, createdAt: new Date(1), updatedAt: new Date(1)};
const proposal = {id:'rename', type:'rename', restaurantId:'restaurant', targetDishId:'dish', canonicalSourceDishId:'dish', proposedName:'New Dish', normalizedProposedName:'new dish', userId:'writer', status:'pending', createdAt:new Date(), updatedAt:new Date()};
test.before(async () => {assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d+$/);env = await initializeTestEnvironment({projectId:'demo-ugc-terms-rules',firestore:{rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')}});});
test.beforeEach(async () => {await env.clearFirestore();await seed({[policyPath]:policy,'bitescore_restaurants/restaurant':{id:'restaurant',isActive:true,active:true,isClaimed:true,ownerUserId:'owner',restaurantWriteRevision:0},'bitescore_dishes/dish':dish,'dish_reviews/review':review});});
test.after(async () => {if (env) await env.cleanup();});
test('missing/wrong/forged-time receipt denies customer categories and authored names; exact trusted receipt allows',async()=>{
 const db=actor();
 for(const data of [{userId:'writer'},receipt('old'),{...receipt(),termsAcceptance:{version:'TEST-v1',acceptedAt:'forged'}}]){
  await seed({'user_profiles/writer':data});
  await assertFails(updateDoc(doc(db,'bitescore_dishes/dish'),{category:'New'}));
  await assertFails(setDoc(doc(db,'public_reviewer_profiles/writer'),profile));
  await assertFails(setDoc(doc(db,'public_usernames/chosen'),{username:'chosen',userId:'writer',reservationType:'custom'}));
 }
 await seed({'user_profiles/writer':receipt()});
 const batch=writeBatch(db);batch.set(doc(db,'public_reviewer_profiles/writer'),profile);batch.set(doc(db,'public_usernames/chosen'),{username:'chosen',userId:'writer',reservationType:'custom'});await assertSucceeds(batch.commit());
 await assertSucceeds(updateDoc(doc(db,'bitescore_dishes/dish'),{category:'New',categoryManualKeywords:'Tasty',categoryTags:['tasty']}));
});
test('prior receipts survive only an explicitly compatible revision; a mandatory version denies them',async()=>{
 const db=actor();await seed({'user_profiles/writer':receipt(),[policyPath]:{...policy,version:'TEST-v2',acceptedVersions:['TEST-v2']}});
 await assertFails(setDoc(doc(db,'public_reviewer_profiles/writer'),profile));
 await seed({[policyPath]:{...policy,version:'TEST-v2',acceptedVersions:['TEST-v2','TEST-v1']}});
 await assertSucceeds(setDoc(doc(db,'public_reviewer_profiles/writer'),profile));
});
test('clients including Admin cannot forge, replace or erase acceptance or runtime',async()=>{
 for(const db of [actor(),actor('admin',{admin:true})]){
  await assertFails(setDoc(doc(db,'user_profiles/writer'),receipt()));
  await assertFails(setDoc(doc(db,policyPath),{required:false}));
 }
 await seed({'user_profiles/writer':receipt()});
 for(const db of [actor(),actor('admin',{admin:true})])await assertFails(updateDoc(doc(db,'user_profiles/writer'),{termsAcceptance:{version:'TEST-v2',acceptedAt:new Date()}}));
 await assertSucceeds(updateDoc(doc(actor(),'user_profiles/writer'),{displayName:'Private account name'}));
});
test('generated fallback and unchanged public identity housekeeping remain available; forged fallback words denied',async()=>{
 const db=actor(), fallback={...profile,publicDisplayName:'anon123',chosenUsername:null,chosenUsernameNormalized:null};
 await assertSucceeds(setDoc(doc(db,'public_reviewer_profiles/writer'),fallback));
 // The existing profile loader normalizes an absent chosen name to ''.
 await assertSucceeds(updateDoc(doc(db,'public_reviewer_profiles/writer'),{...fallback,chosenUsernameNormalized:'',updatedAt:new Date()}));
 await assertSucceeds(setDoc(doc(db,'public_usernames/anon123'),{username:'anon123',userId:'writer',reservationType:'fallback'}));
 for(const changes of [{publicDisplayName:'User words'},{fallbackUsername:'User words',publicDisplayName:'User words'},{username:'User words'}])await assertFails(updateDoc(doc(db,'public_reviewer_profiles/writer'),changes));
 await assertFails(setDoc(doc(db,'public_usernames/forged'),{username:'forged',userId:'writer',reservationType:'fallback'}));
 await seed({'public_reviewer_profiles/writer':profile});
 await assertSucceeds(updateDoc(doc(db,'public_reviewer_profiles/writer'),{...profile,updatedAt:new Date()}));
});
test('anonymous/unverified/wrong UID cannot use accepted public-content receipt',async()=>{
 await seed({'user_profiles/writer':receipt()});
 for(const db of [actor('other'),actor('writer',{email_verified:false}),actor('writer',{firebase:{sign_in_provider:'anonymous'}})])await assertFails(setDoc(doc(db,'public_reviewer_profiles/writer'),profile));
});
test('active cutover denies legacy review writes and photo metadata even with acceptance; withdrawal survives',async()=>{
 await seed({'user_profiles/writer':receipt()});const db=actor();
 await assertFails(setDoc(doc(db,'dish_reviews/new'),{...review,id:'new'}));
 await assertFails(updateDoc(doc(db,'dish_reviews/review'),{notes:'New words'}));
 await assertFails(setDoc(doc(db,'dish_rating_aggregates/dish'),{dishId:'dish',restaurantId:'restaurant',ratingCount:1,overallBiteScore:80,aggregateWriteGeneration:0}));
 await assertFails(setDoc(doc(db,'bitescore_dish_images/image'),{id:'image',dishId:'dish',restaurantId:'restaurant',uploadedByUserId:'writer',reviewId:null,imageUrl:'https://example.test/photo'}));
 await assertSucceeds(deleteDoc(doc(db,'dish_reviews/review')));
});
test('direct customer restaurant/dish creation requires the exact receipt with populated runtime and restriction documents',async()=>{
 const db=actor();
 const restaurant={id:'new-restaurant',name:'Customer restaurant',restaurantWriteRevision:0,isClaimed:false,ownerUserId:null,isActive:true,active:true,createdByUserId:'writer',createdFromCreateFlow:true};
 const newDish={id:'new-dish',restaurantId:'restaurant',name:'Customer dish',category:'Food',isActive:true,createdByUserId:'writer',createdFromCreateFlow:true,createdFromReviewId:'future-review',createdWithRestaurantId:'restaurant'};
 await seed({'private_bitescore_runtime/aggregation':{version:1,enabled:false},'private_bitescore_runtime/photo_screening':{required:false},'private_bitescore_runtime/review_text':{required:false},'user_profiles/writer/posting_restriction_state/current':{schemaVersion:1,revision:1,kind:'indefinite',startsAt:new Date(1),endsAt:null,releasedAt:new Date(2)}});
 for(const data of [{userId:'writer'},receipt('old')]){
  await seed({'user_profiles/writer':data});
  await assertFails(setDoc(doc(db,'bitescore_restaurants/new-restaurant'),restaurant));
  await assertFails(setDoc(doc(db,'bitescore_dishes/new-dish'),newDish));
 }
 await seed({'user_profiles/writer':receipt()});
 await assertSucceeds(setDoc(doc(db,'bitescore_restaurants/new-restaurant'),restaurant));
 await assertSucceeds(setDoc(doc(db,'bitescore_dishes/new-dish'),newDish));
 await assertSucceeds(updateDoc(doc(db,'bitescore_dishes/dish'),{category:'New category'}));
});
test('rename suggestion requires acceptance; merge feedback introduces no public words',async()=>{
 const db=actor();await assertFails(setDoc(doc(db,'dish_edit_proposals/rename'),proposal));
 await seed({'user_profiles/writer':receipt()});await assertSucceeds(setDoc(doc(db,'dish_edit_proposals/rename'),proposal));
 await seed({'user_profiles/writer':{userId:'writer'}});
 await assertSucceeds(setDoc(doc(db,'dish_edit_proposals/merge'),{...proposal,id:'merge',type:'merge',sourceDishId:'dish',targetDishId:'otherDish',mergeTargetDishId:'otherDish',proposedName:null}));
});
test('deletion and posting restriction still defeat an accepted receipt',async()=>{
 const db=actor();await seed({'user_profiles/writer':receipt(),'private_account_deletions/writer':{}});
 await assertFails(setDoc(doc(db,'public_reviewer_profiles/writer'),profile));
 await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'private_account_deletions/writer')));
 await seed({'user_profiles/writer/posting_restriction_state/current':{schemaVersion:1,revision:1,kind:'indefinite',startsAt:new Date(1),endsAt:null,releasedAt:null}});
 await assertFails(setDoc(doc(db,'public_reviewer_profiles/writer'),profile));
 await assertFails(updateDoc(doc(db,'bitescore_dishes/dish'),{category:'New'}));
 await assertSucceeds(deleteDoc(doc(db,'dish_reviews/review')));
});
test('ordinary public reads, favorites, reports, private profile and owner withdrawal remain independent',async()=>{
 const db=actor();await seed({'public_reviewer_profiles/writer':profile});
 await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'public_reviewer_profiles/writer')));
 await assertSucceeds(setDoc(doc(db,'user_profiles/writer'),{userId:'writer',displayName:'Private'}));
 await assertSucceeds(setDoc(doc(db,'user_profiles/writer/favorite_dishes/dish'),{dishId:'dish',userId:'writer'}));
 await assertSucceeds(setDoc(doc(db,'dish_reports/report'),{id:'report',dishId:'dish',restaurantId:'restaurant',reportingUserId:'writer',reason:'Incorrect',status:'pending'}));
 await assertFails(updateDoc(doc(actor('owner'),'bitescore_dishes/dish'),{name:'Owner name'}));
 await assertSucceeds(updateDoc(doc(actor('owner'),'bitescore_dishes/dish'),{isActive:false}));
 await seed({'user_profiles/owner':receipt()});
 await assertSucceeds(updateDoc(doc(actor('owner'),'bitescore_dishes/dish'),{name:'Owner name'}));
});
test('absent/off preserves legacy contribution behavior; malformed active configuration closes',async()=>{
 const db=actor();await seed({[policyPath]:{required:false}});
 await assertSucceeds(setDoc(doc(db,'dish_reviews/new'),{...review,id:'new'}));
 await assertSucceeds(setDoc(doc(db,'public_reviewer_profiles/writer'),profile));
 for(const config of [{},{required:true},{...policy,version:''}]){
  await seed({[policyPath]:config,'user_profiles/writer':receipt()});
  await assertFails(updateDoc(doc(db,'bitescore_dishes/dish'),{category:'New'}));
 }
});
