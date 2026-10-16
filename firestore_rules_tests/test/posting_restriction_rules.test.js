'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp}=require('firebase/firestore');
let env;
const actor=(uid,admin=false)=>env.authenticatedContext(uid,{admin,email_verified:true,firebase:{sign_in_provider:'password'}}).firestore();
const state=uid=>`user_profiles/${uid}/posting_restriction_state/current`;
const restriction=(extra={})=>({schemaVersion:1,revision:1,kind:'indefinite',startsAt:new Date(1),endsAt:null,releasedAt:null,...extra});
const seed=rows=>env.withSecurityRulesDisabled(async c=>{for(const [p,d]of Object.entries(rows))await setDoc(doc(c.firestore(),p),d);});
const review={id:'review',dishId:'dish',restaurantId:'restaurant',userId:'customer',overallImpression:8,overallBiteScore:80,headline:'damn good',createdAt:new Date(),updatedAt:new Date()};
const image={id:'image',dishId:'dish',restaurantId:'restaurant',uploadedByUserId:'customer',imageUrl:'https://example.test/food.jpg',helpfulCount:1,notHelpfulCount:0};
const dish={id:'dish',restaurantId:'restaurant',name:'Dish',isActive:true,aggregateWriteGeneration:0};
test.before(async()=>{assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);env=await initializeTestEnvironment({projectId:'demo-posting-restriction-rules',firestore:{rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')}});});
test.beforeEach(async()=>{await env.clearFirestore();await seed({'bitescore_restaurants/restaurant':{id:'restaurant',isClaimed:true,ownerUserId:'owner',isActive:true,active:true,restaurantWriteRevision:0},'bitescore_dishes/dish':dish,'dish_reviews/review':review,'bitescore_dish_images/image':image});});
test.after(async()=>{if(env)await env.cleanup();});
test('private restriction state is unreadable and unforgeable by customers, strangers, guests and client Admins',async()=>{
 await seed({[state('customer')]:restriction()});
 for(const db of [actor('customer'),actor('other'),actor('admin',true),env.unauthenticatedContext().firestore()]){
  await assertFails(getDoc(doc(db,state('customer'))));await assertFails(setDoc(doc(db,state('customer')),restriction({releasedAt:new Date()})));await assertFails(deleteDoc(doc(db,state('customer'))));
  await assertFails(setDoc(doc(db,state('new')),restriction()));
 }
});
for(const [label,r]of [['7d',restriction({kind:'7d',startsAt:new Date(),endsAt:new Date(Date.now()+7*86400000)})],['14d',restriction({kind:'14d',startsAt:new Date(),endsAt:new Date(Date.now()+14*86400000)})],['indefinite',restriction()],['malformed',{}]])test(`${label} blocks direct new reviews, edits, photos, categories, catalog creates, suggestions and public votes`,async()=>{
 const db=actor('customer');await seed({[state('customer')]:r});
 await assertFails(setDoc(doc(db,'dish_reviews/new'),{...review,id:'new'}));await assertFails(updateDoc(doc(db,'dish_reviews/review'),{headline:'republished'}));
 await assertFails(setDoc(doc(db,'dish_reviews/forged'),{...review,id:'forged',userId:'other'}));
 await assertFails(setDoc(doc(db,'bitescore_dish_images/new'),{...image,id:'new'}));
 await assertFails(updateDoc(doc(db,'bitescore_dishes/dish'),{category:'new'}));
 await assertFails(setDoc(doc(db,'bitescore_dishes/new'),{id:'new',restaurantId:'restaurant',name:'New',createdByUserId:'customer',createdFromCreateFlow:true,createdFromReviewId:'new-review',createdWithRestaurantId:'restaurant'}));
 await assertFails(setDoc(doc(db,'bitescore_restaurants/new'),{id:'new',name:'New',createdByUserId:'customer',createdFromCreateFlow:true,isClaimed:false,ownerUserId:null,isActive:true,active:true,restaurantWriteRevision:0}));
 await assertFails(setDoc(doc(db,'dish_edit_proposals/new'),{userId:'customer',status:'pending',type:'rename',dishId:'dish',sourceDishId:'dish',restaurantId:'restaurant',proposedName:'Rename'}));
 await assertFails(setDoc(doc(db,'review_feedback_votes/new'),{userId:'customer',reviewId:'review',dishId:'dish',restaurantId:'restaurant',voteType:'helpful'}));
 await assertFails(setDoc(doc(db,'bitescore_dish_image_votes/new'),{userId:'customer',imageId:'image',dishId:'dish',restaurantId:'restaurant',voteType:'helpful'}));
});
test('absent, automatically expired and released state permit legacy publication, including mild profanity',async()=>{
 for(const [id,r]of [['absent',null],['expired',restriction({kind:'7d',startsAt:new Date(1),endsAt:new Date(1000)})],['released',restriction({releasedAt:new Date(2000)})]]){
  if(r)await seed({[state('customer')]:r});const db=actor('customer');
  await assertSucceeds(setDoc(doc(db,`dish_reviews/${id}`),{...review,id}));
  await assertSucceeds(updateDoc(doc(db,'dish_reviews/review'),{headline:id}));
  await assertSucceeds(setDoc(doc(db,`bitescore_dish_images/${id}`),{...image,id}));
  await assertSucceeds(updateDoc(doc(db,'bitescore_dishes/dish'),{category:id}));
 }
});
test('restricted legacy actor cannot bypass photo publication through arbitrary dish primary URL; own withdrawal and existing photo selection survive',async()=>{
 const db=actor('customer');await seed({[state('customer')]:restriction(),'bitescore_dish_image_votes/image_customer':{imageId:'image',userId:'customer',dishId:'dish',restaurantId:'restaurant',voteType:'helpful'}});
 await assertFails(updateDoc(doc(db,'bitescore_dishes/dish'),{primaryImageUrl:'https://evil.test/new.jpg'}));
 await assertFails(updateDoc(doc(db,'bitescore_dishes/dish'),{primaryImageId:'image',primaryImageUrl:'https://evil.test/new.jpg'}));
 const batch=writeBatch(db);batch.delete(doc(db,'bitescore_dish_image_votes/image_customer'));batch.update(doc(db,'bitescore_dish_images/image'),{helpfulCount:0,updatedAt:serverTimestamp()});await assertSucceeds(batch.commit());
 await assertSucceeds(updateDoc(doc(db,'bitescore_dishes/dish'),{primaryImageId:'image',primaryImageUrl:image.imageUrl}));
 await assertSucceeds(updateDoc(doc(db,'bitescore_dishes/dish'),{primaryImageId:null,primaryImageUrl:null}));
});
test('own content deletion, private abuse reporting, favorites and owner menu/dish functions survive restriction',async()=>{
 await seed({[state('customer')]:restriction(),[state('owner')]:restriction(),'review_feedback_votes/own':{userId:'customer',reviewId:'review',dishId:'dish',restaurantId:'restaurant',voteType:'helpful'},'restaurant_menus/menu':{id:'menu',createdByUserId:'owner',bitescoreRestaurantId:'restaurant'},'restaurant_menus/menu/menu_items/item':{name:'Food'}});
 const customer=actor('customer');
 await assertSucceeds(setDoc(doc(customer,'review_reports/report'),{reviewId:'review',dishId:'dish',restaurantId:'restaurant',reportingUserId:'customer',status:'pending',reason:'Other'}));
 await assertSucceeds(getDoc(doc(customer,'review_reports/report')));
 await assertSucceeds(setDoc(doc(customer,'user_profiles/customer/favorite_dishes/dish'),{dishId:'dish',userId:'customer'}));
 await assertSucceeds(deleteDoc(doc(customer,'review_feedback_votes/own')));
 await assertSucceeds(deleteDoc(doc(customer,'bitescore_dish_images/image')));
 await assertSucceeds(deleteDoc(doc(customer,'dish_reviews/review')));
 await assertSucceeds(updateDoc(doc(actor('owner'),'restaurant_menus/menu/menu_items/item'),{name:'Business food'}));
 await assertSucceeds(updateDoc(doc(actor('owner'),'bitescore_dishes/dish'),{name:'Owner edit'}));
 await assertSucceeds(getDoc(doc(actor('owner'),'bitescore_restaurants/restaurant')));
});
