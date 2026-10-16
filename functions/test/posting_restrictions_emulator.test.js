'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_POSTING_RESTRICTION_EMULATOR==='1';
let app,db,auth,api,callables;
const project='demo-coupon-app-rules';
const {postingRestrictionPath}=require('../lib/posting_restriction_guard');
const local=(name,fn)=>test(name,{skip:!enabled},fn);
const identity=uid=>({uid,token:{admin:uid==='admin',email_verified:true,firebase:{sign_in_provider:'password'}}});
const input=(action='7d',revision=0)=>({schemaVersion:1,expectedUserId:'admin',targetUserId:'customer',reportId:'report',expectedRevision:revision,action,requestId:randomUUID()});
const review=()=>({schemaVersion:1,expectedUserId:'customer',dishId:'dish',restaurantId:'restaurant',headline:'damn good',notes:'normal food review',overallImpression:8,tastinessScore:8,qualityScore:8,valueScore:8});
test.before(async()=>{if(!enabled)return;
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8792');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
 app=require('firebase-admin/app').initializeApp({projectId:project});db=require('firebase-admin/firestore').getFirestore(app);auth=require('firebase-admin/auth').getAuth(app);
 api=require('../lib/posting_restrictions');callables=require('../lib/customer_bitescore_runtime');
});
test.beforeEach(async()=>{if(!enabled)return;
 assert.equal((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'})).status,200);
 for(const [p,d]of Object.entries({'private_bitescore_runtime/aggregation':{enabled:true,version:1,epoch:'posting'},'bitescore_restaurants/restaurant':{id:'restaurant',name:'Place',isActive:true,active:true,restaurantWriteRevision:0,latitude:40,longitude:-73},'bitescore_dishes/dish':{id:'dish',restaurantId:'restaurant',name:'Food',isActive:true},'dish_reviews/evidence':{userId:'customer',dishId:'dish',restaurantId:'restaurant'},'review_reports/report':{reviewId:'evidence',dishId:'dish',restaurantId:'restaurant'}}))await db.doc(p).set(d);
});test.after(async()=>{if(app)await app.delete();});
local('real Auth emulator identities reach callable wrappers; private status, stale account and unauthorized Admin denied',async()=>{
 async function signed(uid,admin){
  try{await auth.deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
  await auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true,password:'Local-fixture-12345'});if(admin)await auth.setCustomUserClaims(uid,{admin:true});
  const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-fixture`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${uid}@example.test`,password:'Local-fixture-12345',returnSecureToken:true})});
  const body=await response.json();assert.equal(response.status,200,body.error?.message);const token=await auth.verifyIdToken(body.idToken);return {uid:token.uid,token};
 }
 const admin=await signed('admin',true),customer=await signed('customer',false);
 await assert.rejects(callables.setAdminPostingRestriction.run({auth:customer,data:{...input(),expectedUserId:'customer'}}),{code:'permission-denied'});
 assert.equal((await callables.setAdminPostingRestriction.run({auth:admin,data:input()})).status,'active');
 assert.equal((await auth.getUser('customer')).disabled,false);
 await assert.rejects(callables.saveCustomerBiteScoreReview.run({auth:customer,data:review()}),e=>e.details?.reason==='posting-restricted');
 await assert.rejects(callables.getCustomerPostingStatus.run({auth:customer,data:{schemaVersion:1,expectedUserId:'other'}}),{code:'permission-denied'});
 const own=await callables.getCustomerPostingStatus.run({auth:customer,data:{schemaVersion:1,expectedUserId:'customer'}});assert.equal(own.status,'active');assert(!JSON.stringify(own).includes('issuedBy'));
 await callables.setAdminPostingRestriction.run({auth:admin,data:{...input('release',1),reportId:null}});
 assert.ok((await callables.saveCustomerBiteScoreReview.run({auth:customer,data:review()})).review.id);
});
local('real Firestore competing Admin decisions serialize; repeated requests never extend or undo newer release',async()=>{
 const attempts=[input(),input('14d')];const results=await Promise.allSettled(attempts.map(data=>api.setAdminPostingRestrictionHandler(db,{auth:identity('admin'),data})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await db.doc(postingRestrictionPath('customer')).get()).get('revision'),1);
 const winner=attempts[results.findIndex(x=>x.status==='fulfilled')];const original=(await db.doc(postingRestrictionPath('customer')).get()).data();
 await api.setAdminPostingRestrictionHandler(db,{auth:identity('admin'),data:winner});assert.deepEqual((await db.doc(postingRestrictionPath('customer')).get()).data(),original);
 await api.setAdminPostingRestrictionHandler(db,{auth:identity('admin'),data:{...input('release',1),reportId:null}});
 await assert.rejects(api.setAdminPostingRestrictionHandler(db,{auth:identity('admin'),data:winner}),{code:'failed-precondition'});
});
local('automatic expiry needs no cleanup; restriction prevents new catalog writes and respects account-deletion fence',async()=>{
 await api.setAdminPostingRestrictionHandler(db,{auth:identity('admin'),data:input()},()=>Date.now()-8*86400000);
 assert.equal((await callables.getCustomerPostingStatus.run({auth:identity('customer'),data:{schemaVersion:1,expectedUserId:'customer'}})).status,'expired');
 assert.ok((await callables.saveCustomerBiteScoreReview.run({auth:identity('customer'),data:review()})).review.id);
 await api.setAdminPostingRestrictionHandler(db,{auth:identity('admin'),data:input('indefinite',1)});
 const creation=require('../lib/customer_bitescore_creation');const context={userId:'customer',email:'customer@example.test',emailVerified:true,isAnonymous:false};const store=require('../lib/rating_destructive_job_store').createFirestoreRatingDestructivePrivateDatabase(db);
 await assert.rejects(creation.resolveCustomerBiteScoreDishCreationHandler(store,{schemaVersion:1,expectedUserId:'customer',requestId:'new-dish-request-123',restaurantId:'restaurant',dishName:'Burger',category:'Food',categoryTags:[],allowExistingMatch:false},context),e=>e.details?.reason==='posting-restricted');
 await db.doc('private_account_deletions/customer').set({state:'requested'});
 await assert.rejects(api.setAdminPostingRestrictionHandler(db,{auth:identity('admin'),data:input('release',2)}),{code:'failed-precondition'});
});
