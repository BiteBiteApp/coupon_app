'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const enabled=process.env.RUN_ACCOUNT_DELETION_EMULATOR==='1';
let app,db,now,api,billing,contract,webhook,indexExports,mockStripeEvent,mockStripeSubscription,mockCheckoutBodies,mockRetrieveIds,mockRetrieveHook;
const uid='billing-A';
const local=(name,fn)=>test(name,{skip:!enabled},fn);
const meta=()=>webhook.createOwnerBillingStripeMetadata({ownerUid:uid,checkoutAttemptId:'attempt-A'});
const sub=(changes={})=>({id:'sub_owned',customer:'cus_owned',metadata:meta(),status:'active',cancel_at_period_end:false,schedule:null,pending_invoice_item_interval:null,transfer_data:null,items:{has_more:false,data:[{price:{id:billing.deletionStripePriceId,recurring:{usage_type:'licensed'}},quantity:1}]},...changes});
async function seed(subscriptionStatus='active') {
 const created=new Date(now-10000);let state=contract.createCheckoutPendingOwnerBillingState(contract.createInitialOwnerBillingState(uid,created),{checkoutAttemptId:'attempt-A',checkoutRequestFingerprint:'a'.repeat(64),checkoutAttemptCreatedAt:created,now:created});
 state=webhook.applyOwnerBillingWebhookEvent({current:state,incoming:webhook.createOwnerBillingWebhookEvent({metadata:meta(),stripeCustomerId:'cus_owned',stripeSubscriptionId:'sub_owned',rawStripeStatus:subscriptionStatus,eventType:'customer.subscription.updated',eventCreated:Math.floor(now/1000),eventId:'evt_fixture'}),now:new Date(now)}).state;
 await db.doc(`private_owner_billing_states/${uid}`).set(state);
 await db.doc(`restaurant_accounts/${uid}`).set({name:'Private person business',approvalStatus:'approved',couponPostingEnabled:true,stripeCustomerId:'cus_owned',stripeSubscriptionId:'sub_owned'});
 await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt:'a'.repeat(43)},{uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},{uid,creationTime:new Date(now-100000).toUTCString(),providerIds:['password'],disabled:false},now);
}
async function pass(adapter) {
 now+=4000000;
 return api.processAccountDeletionJob(db,uid,async context=>({complete:await billing.reconcileAccountDeletionBilling(context,adapter)}),()=>now);
}
function fake(value) {
 const calls=[];return {value,calls,async listSubscriptions(customer){assert.equal(customer,"cus_owned");return {data:[structuredClone(this.value)],has_more:false};},async retrieveSubscription(id){calls.push(['retrieve',id]);return structuredClone(this.value);},async cancelSubscription(id){calls.push(['cancel',id]);this.value.status='canceled';},async retrieveCheckout(){throw Error('unexpected Checkout');},async expireCheckout(){throw Error('unexpected expire');},async replayCheckout(){throw Error('unexpected replay');}};
}
function legacyMetadata(primary=false) {
 return {ownerUid:uid,restaurantAccountId:uid,source:'bitesaver_subscription',...(primary?{billingPlanName:'coupon_monthly'}:{})};
}
async function seedLegacy() {
 await db.doc(`restaurant_accounts/${uid}`).set({uid,name:'Existing old Checkout account',approvalStatus:'approved',couponPostingEnabled:true,stripeCustomerId:'cus_owned',stripeSubscriptionId:'sub_owned'});
 await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt:'a'.repeat(43)},{uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},{uid,creationTime:new Date(now-100000).toUTCString(),providerIds:['password'],disabled:false},now);
}
test.before(async()=>{
 if(!enabled)return;
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8792');assert.equal(process.env.GCLOUD_PROJECT,'demo-coupon-app-rules');assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
 app=require('firebase-admin/app').initializeApp({projectId:'demo-coupon-app-rules'},'billing-deletion-fake');db=require('firebase-admin/firestore').getFirestore(app);
 api=require('../lib/account_deletion_service');billing=require('../lib/account_deletion_billing');contract=require('../lib/owner_billing_state_contract');webhook=require('../lib/owner_billing_webhook');
 const Module=require('node:module'),load=Module._load;
 try {
  Module._load=function(name,parent,isMain) {
   if(name==='stripe')return class LocalStripe {
    webhooks={constructEvent:()=>mockStripeEvent};
    subscriptions={retrieve:async id=>{mockRetrieveIds.push(id);if(mockRetrieveHook)await mockRetrieveHook();return structuredClone(mockStripeSubscription);}};
    checkout={sessions:{create:async body=>{mockCheckoutBodies.push(structuredClone(body));return {id:'cs_forward',url:'https://checkout.stripe.test/local-only',customer:body.customer??'cus_fresh'};}}};
   };
   if(name==='firebase-functions/params') {
    const actual=load.call(this,name,parent,isMain);
    return {...actual,defineSecret:name=>({name,value:()=> 'LOCAL_FAKE_ONLY'})};
   }
   return load.call(this,name,parent,isMain);
  };
  indexExports=require('../lib/index');
 } finally {Module._load=load;}
});
test.beforeEach(async()=>{if(!enabled)return;now=Date.now();mockCheckoutBodies=[];mockRetrieveIds=[];mockRetrieveHook=null;assert.equal((await fetch('http://127.0.0.1:8792/emulator/v1/projects/demo-coupon-app-rules/databases/(default)/documents',{method:'DELETE'})).status,200);});
test.after(async()=>{if(app)for(const value of require('firebase-admin/app').getApps())await value.delete();});
for(const status of ['active','trialing','past_due','unpaid','paused','incomplete']) local(`${status} owned subscription cancels before complete; business closes at acceptance`,async()=>{
 await seed(status);const adapter=fake(sub({status,cancel_at_period_end:true}));assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('couponPostingEnabled'),false);
 for(let i=0;i<6;i++)await pass(adapter);
 assert.equal(adapter.value.status,'canceled');assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,1);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');assert.ok((await db.doc(`private_owner_billing_states/${uid}`).get()).exists);
});
local('identity-verified already canceled historical price succeeds without cancellation',async()=>{
 await seed('canceled');const adapter=fake(sub({status:'canceled',items:{has_more:false,data:[]}}));for(let i=0;i<4;i++)await pass(adapter);assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,0);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('lost cancellation response recovers through retrieval without duplicate side effect',async()=>{
 await seed();const adapter=fake(sub());adapter.cancelSubscription=async function(id){this.calls.push(['cancel',id]);this.value.status='canceled';throw Error('lost acknowledgement');};for(let i=0;i<6;i++)await pass(adapter);assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,1);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('404 and foreign identity never imply success or cancel another subscription',async()=>{
 await seed();const adapter=fake(sub({customer:'cus_other'}));for(let i=0;i<3;i++)await pass(adapter);assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,0);assert.notEqual((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');adapter.retrieveSubscription=async()=>{throw Object.assign(Error('not found'),{statusCode:404});};await pass(adapter);assert.notEqual((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('Stripe adapter uses explicit no-final-invoice/no-proration and bounded timeout only',async()=>{
 const calls=[];const stripe={subscriptions:{retrieve:async(...args)=>{calls.push(['retrieve',...args]);return sub();},cancel:async(...args)=>calls.push(['cancel',...args])},checkout:{sessions:{retrieve(){},expire(){},create(){}}}};const adapter=billing.createAccountDeletionStripeAdapter(stripe);await adapter.cancelSubscription('sub_owned');assert.deepEqual(calls,[['cancel','sub_owned',{invoice_now:false,prorate:false},{timeout:10000,maxNetworkRetries:0}]]);
});
local('deletion wins before dispatch: closed intent, zero Checkout network calls',async()=>{
 await seed();let calls=0;await assert.rejects(billing.createDeletionAwareCheckout(db,{checkout:{sessions:{create:async()=>{calls++;}}}},uid,'attempt-never',{mode:'subscription'}));assert.equal(calls,0);assert.equal((await db.doc(`private_owner_billing_states/${uid}/checkout_intents/attempt-never`).get()).get('confirmedStatus'),'not_dispatched');
});
local('shared-customer pagination cancels both owned subscriptions and preserves B',async()=>{
 await seed();
 const second=sub({id:'sub_second',metadata:webhook.createOwnerBillingStripeMetadata({ownerUid:uid,checkoutAttemptId:'attempt-second'})});
 const foreign=sub({id:'sub_foreign',metadata:webhook.createOwnerBillingStripeMetadata({ownerUid:'billing-B',checkoutAttemptId:'attempt-B'})});
 const values=new Map([['sub_owned',sub()],['sub_second',second],['sub_foreign',foreign]]),calls=[];
 const adapter=fake(sub());adapter.retrieveSubscription=async id=>structuredClone(values.get(id));adapter.cancelSubscription=async id=>{calls.push(id);values.get(id).status='canceled';};
 adapter.listSubscriptions=async(customer,after)=>{assert.equal(customer,'cus_owned');return after?{data:[structuredClone(second)],has_more:false}:{data:[structuredClone(values.get('sub_owned')),structuredClone(foreign)],has_more:true};};
 for(let i=0;i<15;i++)await pass(adapter);
 assert.deepEqual(calls.sort(),['sub_owned','sub_second']);assert.equal(foreign.status,'active');assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('actual owner cleanup promptly cancels, scrubs business, releases only A claim, preserves B and history',async()=>{
 await seed();await db.doc(`restaurant_accounts/${uid}/coupons/one`).set({ownerUid:uid,imageUrl:null});
 await db.doc('bitescore_restaurants/shared-A').set({ownerUserId:uid,isClaimed:true,name:'Independent catalog',restaurantWriteRevision:5,linkedBiteSaverUid:uid});
 await db.doc('bitescore_restaurants/shared-B').set({ownerUserId:'billing-B',isClaimed:true,name:'B catalog',restaurantWriteRevision:3,linkedBiteSaverUid:uid,menuSourceUpdatedBy:uid});
 const adapter=fake(sub()),creation=(await db.doc(`private_account_deletions/${uid}`).get()).get('authCreationTime');let exists=true;
 const auth={getIdentity:async()=>exists?{uid,creationTime:creation,providerIds:['password'],disabled:false}:null,deleteIdentity:async()=>{assert.equal(adapter.value.status,'canceled');exists=false;}};
 const objects={nextPersonalPath:async()=>null,personalGeneration:async()=>null,nextOwnedPath:async()=>null,nextMenuPath:async()=>null,referenceUrls:async()=>[],generation:async()=>null,deleteGeneration:async()=>{throw Error('no file');}};
 const step=require('../lib/account_deletion_cleanup').createAccountDeletionStep(auth,adapter,objects);
 for(let i=0;i<200;i++){now+=1000;await api.processAccountDeletionJob(db,uid,step,()=>now);const j=(await db.doc(`private_account_deletions/${uid}`).get()).data();assert.equal(j.attempts,0,'Successful progress must not incur outage backoff');if(j.state==='complete')break;}
 assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');assert.equal(exists,false);
 const root=(await db.doc(`restaurant_accounts/${uid}`).get()).data();assert.equal(root.name,undefined);assert.equal(root.couponPostingEnabled,false);assert.equal(root.stripeCustomerId,'cus_owned');assert.ok((await db.collection(`restaurant_accounts/${uid}/coupons`).get()).empty);
 assert.equal((await db.doc('bitescore_restaurants/shared-A').get()).get('ownerUserId'),null);assert.equal((await db.doc('bitescore_restaurants/shared-A').get()).get('name'),'Independent catalog');
 assert.equal((await db.doc('bitescore_restaurants/shared-B').get()).get('ownerUserId'),'billing-B');assert.equal((await db.doc('bitescore_restaurants/shared-B').get()).get('linkedBiteSaverUid'),undefined);assert.equal((await db.doc('bitescore_restaurants/shared-B').get()).get('menuSourceUpdatedBy'),undefined);
});
local('crash after reservation before dispatch closes automatically without an external Checkout',async()=>{
 await seed();const ref=db.doc(`private_owner_billing_states/${uid}/checkout_intents/attempt-reserved`);
 await db.runTransaction(tx=>billing.reserveAccountDeletionCheckoutIntent(db,tx,uid,'attempt-reserved',{newAttempt:true,sessionId:null,attemptedAtMs:now}));
 const adapter=fake(sub());for(let i=0;i<10;i++)await pass(adapter);
 assert.equal((await ref.get()).get('confirmedStatus'),'not_dispatched');assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('persisted exact Checkout body survives map reordering and lost response, then expires before completion',async()=>{
 const created=new Date(now-10000);
 const state=contract.createCheckoutPendingOwnerBillingState(contract.createInitialOwnerBillingState(uid,created),{checkoutAttemptId:'attempt-A',checkoutRequestFingerprint:'a'.repeat(64),checkoutAttemptCreatedAt:created,now:created});
 await db.doc(`private_owner_billing_states/${uid}`).set(state);await db.doc(`restaurant_accounts/${uid}`).set({approvalStatus:'approved',couponPostingEnabled:true});
 await db.runTransaction(tx=>billing.reserveAccountDeletionCheckoutIntent(db,tx,uid,'attempt-A',{newAttempt:true,sessionId:null,attemptedAtMs:now}));
 const body={mode:'subscription',metadata:meta(),client_reference_id:uid,line_items:[{quantity:1,price:billing.deletionStripePriceId}],success_url:'https://example.test/success?token=LOCAL',cancel_url:'https://example.test/cancel?token=LOCAL'};let firstKey;
 await assert.rejects(billing.createDeletionAwareCheckout(db,{checkout:{sessions:{create:async (payload,options)=>{firstKey=options.idempotencyKey;assert.deepEqual({...payload,expires_at:undefined},{...body,expires_at:undefined});assert.ok(Number.isSafeInteger(payload.expires_at));throw Error('lost response');}}}},uid,'attempt-A',body));
 const ref=db.doc(`private_owner_billing_states/${uid}/checkout_intents/attempt-A`);const raw=(await ref.get()).data();raw.body=Object.fromEntries(Object.entries(raw.body).reverse());await ref.set(raw);
 await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt:'a'.repeat(43)},{uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},{uid,creationTime:created.toUTCString(),providerIds:['password'],disabled:false},now);
 const session={id:'cs_local',metadata:meta(),mode:'subscription',client_reference_id:uid,status:'open',subscription:null,customer:null};let replays=0,expirations=0;
 const adapter=fake(sub());adapter.replayCheckout=async(payload,key)=>{replays++;assert.equal(key,firstKey);assert.deepEqual({...payload,expires_at:undefined},{...body,expires_at:undefined});assert.ok(Number.isSafeInteger(payload.expires_at));return structuredClone(session);};adapter.retrieveCheckout=async()=>structuredClone(session);adapter.expireCheckout=async()=>{expirations++;session.status='expired';};
 // Keep this fixture inside Stripe's existing-key retention window.
 for(let i=0;i<6;i++){now+=1000;await api.processAccountDeletionJob(db,uid,async c=>({complete:await billing.reconcileAccountDeletionBilling(c,adapter)}),()=>now);}
 assert.equal(replays,1);assert.equal(expirations,1);assert.equal((await ref.get()).get('body'),undefined);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
function objectFake(path,urls=[]) {
 const values=new Map([[path,{generation:'10',urls}]]),deletes=[];
 return {values,deletes,nextPersonalPath:async(u,after)=>[...values.keys()].sort().find(p=>p.startsWith(`bitescore_user_uploads/${require('node:crypto').createHash('sha256').update(`bitestar.dish-upload.v1:${u}`).digest('hex')}/dish_images/`)&&(!after||p>after))??null,personalGeneration:async p=>values.get(p)?.generation??null,nextOwnedPath:async(uid,after)=>[...values.keys()].sort().find(p=>p.startsWith(`bitesaver_restaurants/${uid}/`)&&(!after||p>after))??null,nextMenuPath:async(menu,after)=>[...values.keys()].sort().find(p=>p.startsWith(`restaurant_menus/${menu}/menu_images/`)&&(!after||p>after))??null,referenceUrls:async p=>values.get(p)?.urls??[],generation:async p=>values.get(p)?.generation??null,async deleteGeneration(p,g){assert.equal(values.get(p)?.generation,g);deletes.push([p,g]);values.delete(p);}};
}
async function mediaPass(objects) {let done=false;now+=4000000;await api.processAccountDeletionJob(db,uid,async c=>{done=await require('../lib/account_deletion_media').accountDeletionOwnedObjectStep(c,objects);return {};},()=>now);return done;}
local('owned object deletion captures generation and recovers a lost acknowledgement once',async()=>{
 await seed();const path=`bitesaver_restaurants/${uid}/restaurant_images/local.jpg`,objects=objectFake(path);let lost=true;const remove=objects.deleteGeneration.bind(objects);objects.deleteGeneration=async(p,g)=>{await remove(p,g);if(lost){lost=false;throw Error('lost delete acknowledgement');}};
 for(let i=0;i<8;i++)if(await mediaPass(objects))break;
 assert.equal(objects.values.size,0);assert.deepEqual(objects.deletes,[[path,'10']]);const rows=await db.collection(`private_account_deletions/${uid}/object_items`).get();assert.equal(rows.docs[0].get('complete'),true);
});
local('changed generation is retained without deleting replacement bytes',async()=>{
 await seed();const path=`bitesaver_restaurants/${uid}/restaurant_images/local.jpg`,objects=objectFake(path);
 await mediaPass(objects);objects.values.get(path).generation='11';await mediaPass(objects);
 assert.equal(objects.deletes.length,0);assert.equal(objects.values.get(path).generation,'11');assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'pending');
});
local('B URL-only reuse cannot claim A bytes; independent B reference remains',async()=>{
 await seed();const path=`bitesaver_restaurants/${uid}/restaurant_images/shared.jpg`,url='https://example.test/LOCAL-object-url',objects=objectFake(path,[url]);
 await db.doc('restaurant_accounts/billing-B/menu_images/shared').set({imageUrl:url});
 for(let i=0;i<6;i++)if(await mediaPass(objects))break;
 assert.deepEqual(objects.deletes,[[path,'10']]);assert.equal(objects.values.has(path),false);assert.equal((await db.doc('restaurant_accounts/billing-B/menu_images/shared').get()).get('imageUrl'),url);
});
local('revoked public-menu grant binds exact account and foreign grant cannot delete',async()=>{
 await seed();const grantId='bsmia_'+ 'g'.repeat(43),path=`public_menu_images/${grantId}/image.jpg`,objects=objectFake(path);const grant=db.doc(`private_menu_image_upload_authorizations/${grantId}`);
 await grant.set({schemaVersion:1,state:'revoked',ownerUserId:uid,sourceType:'biteSaver',sourceId:'billing-B',fileName:'image.jpg'});
 now+=4000000;await api.processAccountDeletionJob(db,uid,async c=>({complete:await require('../lib/account_deletion_media').deleteAccountOwnedMenuObject(c,grantId,objects)}),()=>now);assert.equal(objects.deletes.length,0);assert.ok(objects.values.has(path));
 await grant.update({sourceId:uid});
 for(let i=0;i<4;i++){now+=4000000;await api.processAccountDeletionJob(db,uid,async c=>({complete:await require('../lib/account_deletion_media').deleteAccountOwnedMenuObject(c,grantId,objects)}),()=>now);}
 assert.deepEqual(objects.deletes,[[path,'10']]);
});

local('legacy reused Checkout reservation retains the open session until verified expiration',async()=>{
 const created=new Date(now-10000);
 let state=contract.createCheckoutPendingOwnerBillingState(contract.createInitialOwnerBillingState(uid,created),{checkoutAttemptId:'attempt-A',checkoutRequestFingerprint:'a'.repeat(64),checkoutAttemptCreatedAt:created,now:created});
 state=contract.recordCheckoutSession(state,{checkoutSessionId:'cs_legacy',stripeCustomerId:null,now:created});
 await db.doc(`private_owner_billing_states/${uid}`).set(state);
 await db.runTransaction(tx=>billing.reserveAccountDeletionCheckoutIntent(db,tx,uid,'attempt-A',{newAttempt:false,sessionId:state.checkoutSessionId,attemptedAtMs:created.getTime()}));
 await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt:'a'.repeat(43)},{uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},{uid,creationTime:created.toUTCString(),providerIds:['password'],disabled:false},now);
 let creates=0;await assert.rejects(billing.createDeletionAwareCheckout(db,{checkout:{sessions:{create:async()=>{creates++;}}}},uid,'attempt-A',{mode:'subscription'}));assert.equal(creates,0);
 const ref=db.doc(`private_owner_billing_states/${uid}/checkout_intents/attempt-A`);assert.equal((await ref.get()).get('terminal'),false);
 const session={id:'cs_legacy',metadata:meta(),client_reference_id:uid,mode:'subscription',status:'open'};let expired=0;
 const adapter=fake(sub());adapter.retrieveCheckout=async id=>{assert.equal(id,'cs_legacy');return structuredClone(session);};adapter.expireCheckout=async id=>{assert.equal(id,'cs_legacy');expired++;session.status='expired';};
 for(let i=0;i<5;i++)await pass(adapter);
 assert.equal(expired,1);assert.equal((await ref.get()).get('confirmedStatus'),'expired');assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('legacy reused unknown Checkout is never misreported as not dispatched',async()=>{
 await seed();await db.runTransaction(tx=>billing.reserveAccountDeletionCheckoutIntent(db,tx,uid,'attempt-unknown',{newAttempt:false,sessionId:null,attemptedAtMs:now-10000}));
 const adapter=fake(sub());for(let i=0;i<8;i++)await pass(adapter);
 const ref=db.doc(`private_owner_billing_states/${uid}/checkout_intents/attempt-unknown`);
 assert.equal((await ref.get()).get('terminal'),false);assert.equal((await ref.get()).get('confirmedStatus'),undefined);assert.notEqual((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('lost local checkpoint after accepted cancellation retrieves terminal state without recancel',async()=>{
 await seed();const adapter=fake(sub()),original=db.runTransaction.bind(db);let failNext=false,failed=0;
 db.runTransaction=async(...args)=>{if(failNext){failNext=false;failed++;throw Error('LOCAL lost checkpoint');}return original(...args);};
 adapter.cancelSubscription=async id=>{adapter.calls.push(['cancel',id]);adapter.value.status='canceled';failNext=true;};
 try {for(let i=0;i<7;i++)await pass(adapter);} finally {db.runTransaction=original;}
 assert.equal(failed,1);assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,1);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
async function deliver(event,subscription) {
 mockStripeEvent=event;mockStripeSubscription=subscription;let code,body;
 const response={status(value){code=value;return this;},json(value){body=value;return this;},send(value){body=value;return this;}};
 await indexExports.stripeWebhook({method:'POST',header:()=> 'LOCAL_FAKE_SIGNATURE',rawBody:Buffer.from('LOCAL_FAKE_EVENT')},response);
 assert.equal(code,200,typeof body==='string'?body:undefined);
}
for(const primary of [false,true]) {
 const label=primary?'four-field primary':'three-field compatibility';
 local(`${label} accepted old Checkout replaces prior IDs only through verified completion`,async()=>{
  await db.doc(`restaurant_accounts/${uid}`).set({uid,subscriptionStatus:'inactive',couponPostingEnabled:false,stripeCustomerId:'cus_prior',stripeSubscriptionId:'sub_prior'});
  const subscription=sub({metadata:legacyMetadata(primary)});
  mockStripeEvent={id:'evt_oldreplace',created:Math.floor(now/1000),type:'customer.subscription.updated',data:{object:subscription}};mockStripeSubscription=subscription;
  let code;const response={status(value){code=value;return this;},send(){return this;},json(){return this;}};
  await indexExports.stripeWebhook({method:'POST',header:()=> 'LOCAL_FAKE_SIGNATURE',rawBody:Buffer.from('LOCAL_FAKE_EVENT')},response);
  assert.equal(code,500);assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('stripeCustomerId'),'cus_prior');
  const session={id:'cs_replacement',mode:'subscription',subscription:subscription.id,customer:'cus_owned',client_reference_id:uid,metadata:subscription.metadata};
  await deliver({id:'evt_oldreplacecomplete',created:Math.floor(now/1000),type:'checkout.session.completed',data:{object:session}},subscription);
  const root=(await db.doc(`restaurant_accounts/${uid}`).get()).data();assert.equal(root.stripeCustomerId,'cus_owned');assert.equal(root.stripeSubscriptionId,'sub_owned');assert.equal(root.couponPostingEnabled,true);
  await deliver({id:'evt_oldreplacelater',created:Math.floor(now/1000)+1,type:'customer.subscription.updated',data:{object:{...subscription,status:'past_due'}}});
  assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('couponPostingEnabled'),false);
 });
 local(`${label} Checkout completion updates normal billing without fabricating v2 state`,async()=>{
  await db.doc(`restaurant_accounts/${uid}`).set({uid,name:'Existing owner',approvalStatus:'approved',couponPostingEnabled:false});
  const subscription=sub({metadata:legacyMetadata(primary),status:'trialing',trial_end:Math.floor(now/1000)+1000});
  const session={id:'cs_old',mode:'subscription',subscription:subscription.id,customer:'cus_owned',client_reference_id:uid,metadata:subscription.metadata};
  const event={id:'evt_oldcompletion',created:Math.floor(now/1000),type:'checkout.session.completed',data:{object:session}};
  await deliver(event,subscription);await deliver(event,subscription);
  const root=(await db.doc(`restaurant_accounts/${uid}`).get()).data();
  assert.equal(root.subscriptionStatus,'trialing');assert.equal(root.couponPostingEnabled,true);assert.equal(root.hasUsedTrial,true);assert.equal(root.name,'Existing owner');assert.equal(root.stripeSubscriptionId,'sub_owned');
  assert.equal((await db.doc(`private_owner_billing_states/${uid}`).get()).exists,false);
  assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).exists,false);
 });
 local(`${label} active subscription cancels through worker and retains real ownership`,async()=>{
  await seedLegacy();const adapter=fake(sub({metadata:legacyMetadata(primary)}));
  for(let i=0;i<8;i++)await pass(adapter);
  assert.equal(adapter.value.status,'canceled');assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,1);
  assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
  assert.equal((await db.doc(`private_account_deletions/${uid}/billing_intents/sub_owned`).get()).get('checkoutAttemptId'),null);
  assert.equal((await db.doc(`private_owner_billing_states/${uid}`).get()).exists,false);
  assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('couponPostingEnabled'),false);
 });
 local(`${label} already-canceled subscription is complete without cancellation or current-price requirements`,async()=>{
  await seedLegacy();const adapter=fake(sub({metadata:legacyMetadata(primary),status:'canceled',items:{has_more:false,data:[]}}));
  for(let i=0;i<6;i++)await pass(adapter);
  assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,0);
  assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
 });
 local(`${label} late Checkout after cleanup reopens cancellation without recreating the account`,async()=>{
  await seedLegacy();const settled=fake(sub({metadata:legacyMetadata(primary),status:'canceled'}));for(let i=0;i<6;i++)await pass(settled);
  await db.doc(`restaurant_accounts/${uid}`).delete();
  const late=sub({id:'sub_oldlate',metadata:legacyMetadata(primary)});
  const session={id:'cs_oldlate',mode:'subscription',subscription:late.id,customer:'cus_owned',client_reference_id:uid,metadata:late.metadata};
  const event={id:'evt_oldlate',created:Math.floor(now/1000)-100,type:'checkout.session.completed',data:{object:session}};
  await deliver(event,late);await deliver(event,late);
  const job=db.doc(`private_account_deletions/${uid}`),intent=db.doc(`private_account_deletions/${uid}/billing_intents/sub_oldlate`);
  assert.equal((await job.get()).get('state'),'pending');assert.equal((await intent.get()).get('terminal'),false);assert.equal((await intent.get()).get('checkoutAttemptId'),null);
  assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).exists,false);
  const adapter=fake(late);for(let i=0;i<6;i++)await pass(adapter);
  assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,1);assert.equal((await job.get()).get('state'),'complete');
  assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).exists,false);
 });
}
for(const name of ['createCheckoutSession','createSubscriptionCheckoutSession']) local(`${name} proves the legacy customer for a real new v2 attempt and updates the old root`,async()=>{
 await db.doc(`restaurant_accounts/${uid}`).set({uid,hasUsedTrial:true,subscriptionStatus:'inactive',couponPostingEnabled:false,stripeCustomerId:'cus_owned',stripeSubscriptionId:'sub_prior'});
 mockStripeSubscription=sub({id:'sub_prior',metadata:legacyMetadata(),status:'canceled',items:{has_more:false,data:[]}});
 const request={auth:{uid},data:{returnProtocolVersion:2,restaurantAccountDocumentId:uid}};
 await indexExports[name].run(request);await indexExports[name].run(request);
 assert.deepEqual(mockRetrieveIds,['sub_prior']);assert.equal(mockCheckoutBodies.length,2);
 const body=mockCheckoutBodies[0];assert.equal(body.customer,'cus_owned');assert.deepEqual(mockCheckoutBodies[1],body);assert.equal(body.subscription_data.trial_period_days,undefined);
 assert.equal(body.metadata.contractVersion,webhook.ownerBillingStripeMetadataContractVersion);assert.equal(body.metadata.ownerUid,uid);assert.ok(body.metadata.checkoutAttemptId);assert.deepEqual(body.metadata,body.subscription_data.metadata);
 const subscription=sub({id:'sub_forward',metadata:body.metadata});
 await deliver({id:'evt_forward',created:Math.floor(Date.now()/1000),type:'customer.subscription.updated',data:{object:subscription}});
 const root=(await db.doc(`restaurant_accounts/${uid}`).get()).data();assert.equal(root.stripeCustomerId,'cus_owned');assert.equal(root.stripeSubscriptionId,'sub_forward');assert.equal(root.couponPostingEnabled,true);
 assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).exists,false);
});
for(const [label,change] of [
 ['foreign customer',()=>({customer:'cus_other'})],['foreign subscription',()=>({id:'sub_other'})],
 ['foreign owner',()=>({metadata:{...legacyMetadata(),ownerUid:'billing-B',restaurantAccountId:'billing-B'}})],
]) local(`new Checkout refuses unproven legacy ${label} before reservation or creation`,async()=>{
 await db.doc(`restaurant_accounts/${uid}`).set({uid,stripeCustomerId:'cus_owned',stripeSubscriptionId:'sub_owned'});
 mockStripeSubscription=sub({metadata:legacyMetadata(),status:'canceled',...change()});
 await assert.rejects(indexExports.createCheckoutSession.run({auth:{uid},data:{returnProtocolVersion:2,restaurantAccountDocumentId:uid}}));
 assert.equal(mockCheckoutBodies.length,0);assert.equal((await db.doc(`private_owner_billing_states/${uid}`).get()).exists,false);
});
local('legacy customer proof cannot survive an intervening account-binding change',async()=>{
 const root=db.doc(`restaurant_accounts/${uid}`);await root.set({uid,stripeCustomerId:'cus_owned',stripeSubscriptionId:'sub_owned'});
 mockStripeSubscription=sub({metadata:legacyMetadata(),status:'canceled'});mockRetrieveHook=async()=>root.update({stripeCustomerId:'cus_changed',stripeSubscriptionId:'sub_changed'});
 await assert.rejects(indexExports.createCheckoutSession.run({auth:{uid},data:{returnProtocolVersion:2,restaurantAccountDocumentId:uid}}));
 assert.equal(mockCheckoutBodies.length,0);assert.equal((await db.doc(`private_owner_billing_states/${uid}`).get()).exists,false);
});
local('deletion blocks legacy customer lookup before any provider call',async()=>{
 await seedLegacy();await assert.rejects(indexExports.createCheckoutSession.run({auth:{uid},data:{returnProtocolVersion:2,restaurantAccountDocumentId:uid}}));
 assert.deepEqual(mockRetrieveIds,[]);assert.deepEqual(mockCheckoutBodies,[]);
});
for(const [label,change] of [
 ['foreign customer',()=>({customer:'cus_other'})],['foreign subscription',()=>({id:'sub_other'})],
 ['foreign owner',()=>({metadata:{...legacyMetadata(),ownerUid:'billing-B',restaurantAccountId:'billing-B'}})],
 ['partial v2',()=>({metadata:{...legacyMetadata(),checkoutAttemptId:'invented'}})],
]) local(`legacy worker rejects ${label} even if provider says canceled`,async()=>{
  const changes=change();
  await seedLegacy();const adapter=fake(sub({metadata:legacyMetadata(),status:'canceled',...changes}));await pass(adapter);
  assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,0);assert.notEqual((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('legacy subscription cannot overwrite a forward private lifecycle or recreate a missing account',async()=>{
 await seed();await db.doc(`private_account_deletions/${uid}`).delete();
 const before=(await db.doc(`private_owner_billing_states/${uid}`).get()).data();
 const old=sub({metadata:legacyMetadata(),status:'canceled'});
 await deliver({id:'evt_oldstale',created:Math.floor(now/1000)-100,type:'customer.subscription.updated',data:{object:old}});
 assert.deepEqual((await db.doc(`private_owner_billing_states/${uid}`).get()).data(),before);
 assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('stripeSubscriptionId'),'sub_owned');
 await db.doc(`restaurant_accounts/${uid}`).delete();await db.doc(`private_owner_billing_states/${uid}`).delete();
 await deliver({id:'evt_oldmissing',created:Math.floor(now/1000),type:'customer.subscription.updated',data:{object:old}});
 assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).exists,false);
});
local('pending forward Checkout does not silence or lose the bound old subscription',async()=>{
 await seedLegacy();await db.doc(`private_account_deletions/${uid}`).delete();
 const t=new Date(now-10000),pending=contract.createCheckoutPendingOwnerBillingState(contract.createInitialOwnerBillingState(uid,t),{checkoutAttemptId:'attempt-new',checkoutRequestFingerprint:'a'.repeat(64),checkoutAttemptCreatedAt:t,now:t});
 await db.doc(`private_owner_billing_states/${uid}`).set(pending);
 const old=sub({metadata:legacyMetadata(),status:'past_due'});
 await deliver({id:'evt_oldpending',created:Math.floor(now/1000),type:'customer.subscription.updated',data:{object:old}});
 assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('subscriptionStatus'),'inactive');
 assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('couponPostingEnabled'),false);
 assert.equal((await db.doc(`private_owner_billing_states/${uid}`).get()).get('checkoutAttemptId'),'attempt-new');
 await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt:'a'.repeat(43)},{uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},{uid,creationTime:new Date(now-100000).toUTCString(),providerIds:['password'],disabled:false},now);
 const adapter=fake(old);for(let i=0;i<6;i++)await pass(adapter);
 assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,1);
 // Unknown accepted forward work still cannot be silently treated as closed.
 assert.notEqual((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('incomplete old billing association stays pending without invented ownership or provider calls',async()=>{
 await seedLegacy();await db.doc(`restaurant_accounts/${uid}`).update({stripeCustomerId:'',stripeSubscriptionId:''});
 const adapter=fake(sub({metadata:legacyMetadata()}));await pass(adapter);
 assert.deepEqual(adapter.calls,[]);assert.notEqual((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
 assert.equal((await db.doc(`private_owner_billing_states/${uid}`).get()).exists,false);
});
local('a partial account projection does not invalidate an authoritative v2 billing association',async()=>{
 await seed();await db.doc(`restaurant_accounts/${uid}`).update({stripeSubscriptionId:require('firebase-admin/firestore').FieldValue.delete()});
 const adapter=fake(sub());for(let i=0;i<6;i++)await pass(adapter);
 assert.equal(adapter.calls.filter(c=>c[0]==='cancel').length,1);
 assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('old Checkout rejects conflicting session/customer/subscription bindings before any obligation',async()=>{
 await seedLegacy();const subscription=sub({metadata:legacyMetadata()});
 const base={id:'cs_oldconflict',mode:'subscription',subscription:'sub_owned',customer:'cus_owned',client_reference_id:uid,metadata:legacyMetadata()};
 for(const patch of [{customer:'cus_other'},{client_reference_id:'billing-B'},{subscription:'sub_other'},{metadata:meta()}]) {
  mockStripeEvent={id:'evt_conflict',created:Math.floor(now/1000),type:'checkout.session.completed',data:{object:{...base,...patch}}};mockStripeSubscription=subscription;
  let code;const response={status(value){code=value;return this;},send(){return this;},json(){return this;}};
  await indexExports.stripeWebhook({method:'POST',header:()=> 'LOCAL_FAKE_SIGNATURE',rawBody:Buffer.from('LOCAL_FAKE_EVENT')},response);
  assert.equal(code,500);assert.equal((await db.collection(`private_account_deletions/${uid}/billing_intents`).get()).size,0);
 }
});
local('actual late and duplicate webhook handlers queue every owned subscription without reopening business',async()=>{
 await seed();const older=sub({id:'sub_late',metadata:webhook.createOwnerBillingStripeMetadata({ownerUid:uid,checkoutAttemptId:'attempt-old'}),cancel_at_period_end:false});
 const event={id:'evt_old',created:Math.floor(now/1000)-100,type:'customer.subscription.updated',data:{object:older}};
 await deliver(event);await deliver(event);
 const intent=db.doc(`private_account_deletions/${uid}/billing_intents/sub_late`);assert.equal((await intent.get()).get('terminal'),false);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('billingRevision'),1);
 assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('couponPostingEnabled'),false);assert.equal((await db.doc(`private_owner_billing_states/${uid}`).get()).get('stripeSubscriptionId'),'sub_owned');
 const checkoutSub=sub({id:'sub_checkoutlate',metadata:webhook.createOwnerBillingStripeMetadata({ownerUid:uid,checkoutAttemptId:'attempt-checkout-old'})});
 const session={id:'cs_late',mode:'subscription',subscription:checkoutSub.id,customer:'cus_owned',client_reference_id:uid,metadata:checkoutSub.metadata};
 await deliver({id:'evt_checkout',created:Math.floor(now/1000)-200,type:'checkout.session.completed',data:{object:session}},checkoutSub);
 await deliver({id:'evt_checkout',created:Math.floor(now/1000)-200,type:'checkout.session.completed',data:{object:session}},checkoutSub);
 assert.equal((await db.doc(`private_account_deletions/${uid}/billing_intents/sub_checkoutlate`).get()).get('terminal'),false);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('billingRevision'),2);
 assert.equal((await db.doc(`restaurant_accounts/${uid}`).get()).get('couponPostingEnabled'),false);assert.equal((await db.doc(`private_owner_billing_states/${uid}`).get()).get('stripeSubscriptionId'),'sub_owned');
});
local('billing revision arriving before the Auth barrier prevents identity removal',async()=>{
 await seed('canceled');const adapter=fake(sub({status:'canceled'}));for(let i=0;i<3;i++)await pass(adapter);
 const ref=db.doc(`private_account_deletions/${uid}`);await ref.update({phase:'auth',state:'processing',nextAttemptAtMs:now,leaseToken:null,leaseUntilMs:0});
 const creation=(await ref.get()).get('authCreationTime');let reads=0,deletes=0;
 const auth={getIdentity:async()=>{reads++;if(reads===2)await db.runTransaction(tx=>billing.queueAccountDeletionSubscription(db,tx,uid,{subscriptionId:'sub_new',customerId:'cus_owned',checkoutAttemptId:'attempt-new'}));return {uid,creationTime:creation,providerIds:['password'],disabled:false};},deleteIdentity:async()=>{deletes++;}};
 now+=1000;await api.processAccountDeletionJob(db,uid,require('../lib/account_deletion_cleanup').createAccountDeletionStep(auth,adapter),()=>now);
 assert.equal(deletes,0);assert.notEqual((await ref.get()).get('state'),'complete');assert.equal((await db.doc(`private_account_deletions/${uid}/billing_intents/sub_new`).get()).get('terminal'),false);
});

async function runActualOwner(objects=objectFake(''),adapter=fake(sub())) {
 const ref=db.doc(`private_account_deletions/${uid}`),creation=(await ref.get()).get('authCreationTime');let exists=true;
 const auth={getIdentity:async()=>exists?{uid,creationTime:creation,providerIds:['password'],disabled:false}:null,deleteIdentity:async()=>{exists=false;}};
 const step=require('../lib/account_deletion_cleanup').createAccountDeletionStep(auth,adapter,objects);
 for(let i=0;i<300;i++){now+=4000000;await api.processAccountDeletionJob(db,uid,step,()=>now);const value=(await ref.get()).data();if(value.state==='complete'||value.state==='pending')return value;}
 throw Error('Local bounded owner fixture did not converge');
}
local('proposal supporter removal and delayed maintenance preserve B and cannot recreate A',async()=>{
 const ps=require('../lib/dish_proposal_private_store').createFirestoreDishProposalPrivateDatabase(db),pm=require('../lib/dish_proposal_private_maintenance'),pc=require('../lib/dish_proposal_private_contract');
 for(const [id,u] of [['delete-A',uid],['keep-B','billing-B']]){await db.doc(`dish_edit_proposals/${id}`).set({status:'pending',type:'rename',restaurantId:'local-restaurant',sourceDishId:'local-dish',proposedName:'Garlic Soup',userId:u});await pm.maintainDishEditProposalPrivateState(ps,id,new Date(now));}
 const a=(await db.doc(pc.dishProposalMemberPath('delete-A')).get()).data();assert.ok(a);
 await seed();await pm.maintainDishEditProposalPrivateState(ps,'delete-A',new Date(now));await pm.maintainDishEditProposalPrivateState(ps,'delete-A',new Date(now));
 assert.equal((await db.doc(pc.dishProposalMemberPath('delete-A')).get()).exists,false);assert.equal((await db.doc(pc.dishProposalSupporterPath(a.groupId,uid)).get()).exists,false);assert.equal((await db.doc(pc.dishProposalMemberPath('keep-B')).get()).exists,true);
 assert.equal((await runActualOwner()).state,'complete');assert.equal((await db.doc('dish_edit_proposals/delete-A').get()).exists,false);assert.equal((await db.doc('dish_edit_proposals/keep-B').get()).exists,true);
 await pm.maintainDishEditProposalPrivateState(ps,'delete-A',new Date(now));assert.equal((await db.doc(pc.dishProposalMemberPath('delete-A')).get()).exists,false);
});
local('shared menu facts and adopted B changes survive exact A attribution removal',async()=>{
 for(const owner of [uid,'billing-B']) {
  const menu='menu-'+owner,catalog='catalog-'+owner;
  await db.doc(`restaurant_menus/${menu}`).set({createdByUserId:uid,bitescoreRestaurantId:catalog});
  await db.doc(`restaurant_menus/${menu}/menu_items/keep`).set({name:'Factual soup',description:'B edits survive'});
  await db.doc(`restaurant_menus/${menu}/menu_sections/keep`).set({title:'Lunch'});
  await db.doc(`bitescore_restaurants/${catalog}`).set({id:catalog,name:'Independent catalog',ownerUserId:owner,isClaimed:true,sharedMenuId:menu,restaurantWriteRevision:0});
 }
 await seed();assert.equal((await runActualOwner()).state,'complete');
 for(const owner of [uid,'billing-B']) {
  assert.equal((await db.doc(`restaurant_menus/menu-${owner}`).get()).get('createdByUserId'),undefined);
  assert.equal((await db.doc(`restaurant_menus/menu-${owner}/menu_items/keep`).get()).get('description'),'B edits survive');
  assert.equal((await db.doc(`restaurant_menus/menu-${owner}/menu_sections/keep`).get()).exists,true);
  assert.equal((await db.doc(`bitescore_restaurants/catalog-${owner}`).get()).get('sharedMenuId'),'menu-'+owner);
 }
 assert.equal((await db.doc('bitescore_restaurants/catalog-billing-B').get()).get('ownerUserId'),'billing-B');
});
local('historical shared-menu bytes without immutable author proof are retained as exact exception',async()=>{
 await db.doc('restaurant_menus/menu-A').set({createdByUserId:uid,bitescoreRestaurantId:'catalog-A'});
 await db.doc('bitescore_restaurants/catalog-A').set({sharedMenuId:'menu-A',restaurantWriteRevision:0});
 const path='restaurant_menus/menu-A/menu_images/old.jpg',objects=objectFake(path);await seed();
 assert.equal((await runActualOwner(objects)).state,'pending');assert.equal(objects.deletes.length,0);assert.equal(objects.values.has(path),true);
});
function terminalWork() {
 const rc=require('../lib/rating_destructive_job_contract'),t=new Date(now);
 const identity={requestId:'local-retired-delete',operation:'dishDelete',sourceRestaurantId:null,targetRestaurantId:null,sourceDishId:'local-old-dish',targetDishId:null,restaurantId:null},jobId=rc.createRatingDestructiveJobId(identity);
 const nullJobFields=['expectedSourceRestaurantRevision','sourceActiveRestaurantRevision','sourceCompletionRestaurantRevision','expectedTargetRestaurantRevision','targetActiveRestaurantRevision','targetCompletionRestaurantRevision','expectedSourceAggregateGeneration','sourceActiveAggregateGeneration','sourceCompletionAggregateGeneration','expectedTargetAggregateGeneration','targetActiveAggregateGeneration','targetCompletionAggregateGeneration','cursorDocumentId','itemCursorId','aggregateCursorDocumentId','aggregateWinnerCursorId','aggregateState','failureCode'];
 const parent=rc.buildRatingDestructiveJobDocument({...identity,jobId,authorizedCallerKind:'admin',callerBindingFingerprint:rc.createRatingDestructiveCallerBindingFingerprint('local-admin'),status:'complete',phase:'complete',...Object.fromEntries(nullJobFields.map(k=>[k,null])),processedCount:0,phaseProcessedCount:0,createdAt:t,updatedAt:t,completedAt:t});
 const itemIdentity={jobId,operation:'dishDelete',kind:'milestoneUser',restaurantId:null,dishId:null,userId:uid},itemId=rc.createRatingDestructiveJobItemId(itemIdentity);
 const nullItemFields=['currentReviewId','cursorDocumentId','secondaryCursorDocumentId','aggregateCursorDocumentId','aggregateWinnerCursorId','aggregateState','pointReversalCursor','milestoneResetCursor','milestoneReviewCursor','milestoneReconcileCursor','milestoneLockToken','milestoneScanId','validReviewCount','failureCode'];
 const item=rc.buildRatingDestructiveJobItemDocument({...itemIdentity,itemId,status:'complete',subphase:'complete',...Object.fromEntries(nullItemFields.map(k=>[k,null])),processedCount:0,createdAt:t,updatedAt:t,completedAt:t});
 return {rc,t,jobId,itemId,parent,item};
}
async function workPass(){now+=4000000;return api.processAccountDeletionJob(db,uid,async c=>{await require('../lib/account_deletion_work').accountDeletionSettledWorkStep(c);return {};},()=>now);}
local('strict completed milestone scratch drains children before parent item and preserves B aggregate winners',async()=>{
 const {rc,t,jobId,itemId,parent,item}=terminalWork();await db.doc(rc.ratingDestructiveJobPath(jobId)).set(parent);await db.doc(rc.ratingDestructiveJobItemPath(itemId)).set(item);
 const cp=require('../lib/contribution_points_helpers'),ml=require('../lib/review_milestone_reconciliation_lock'),lock={userId:uid,operationId:jobId,lockToken:require('../lib/rating_dish_delete_job').milestoneLockToken(jobId,itemId,uid)};
 await db.doc(ml.reviewMilestoneReconciliationLockPath(uid)).set(ml.buildReviewMilestoneReconciliationLockDocument({...lock,state:'active',createdAt:t,updatedAt:t}));
 await db.doc('dish_reviews/local-count-fixture').set({userId:uid,dishId:'local-count-dish',isPublic:true});
 const accumulator=cp.createFirestoreReviewMilestoneWinnerAccumulator(db,{...lock,namespaceId:itemId,scanId:itemId});let cursor=null,result;
 do{result=await accumulator.initializeFreshScanStep({cursor,limit:50});cursor=result.nextCursor;}while(!result.complete);cursor=null;
 do{result=await cp.scanValidReviewMilestoneIdentitiesForUserStep(db,{...lock,cursor,limit:100},accumulator);cursor=result.nextCursor;}while(!result.complete);assert.equal(result.validReviewCount,1);cursor=null;
 do{result=await cp.reconcileReviewMilestonesForUserStep(db,{...lock,currentReviewCount:1,cursor,limit:50,now:t},accumulator);cursor=result.nextCursor;}while(!result.complete);
 await ml.releaseReviewMilestoneReconciliationLock(db,lock,{now:()=>t});await db.doc('dish_reviews/local-count-fixture').delete();
 const manifest=db.doc(`private_review_milestone_count_accumulators/${itemId}`);assert.equal((await manifest.get()).get('reconciliationPhase'),'complete');assert.equal((await manifest.collection('seen_valid_identities').get()).size,1);
 const mergeIdentity={requestId:'local-retired-merge',operation:'dishMerge',sourceRestaurantId:null,targetRestaurantId:null,sourceDishId:'local-source-dish',targetDishId:'local-target-dish',restaurantId:'local-restaurant'},mergeId=rc.createRatingDestructiveJobId(mergeIdentity);
 const {version,fingerprint,...parentCore}=parent;const mergeParent=rc.buildRatingDestructiveJobDocument({...parentCore,...mergeIdentity,jobId:mergeId,expectedSourceAggregateGeneration:0,sourceActiveAggregateGeneration:1,sourceCompletionAggregateGeneration:2,expectedTargetAggregateGeneration:0,targetActiveAggregateGeneration:1,targetCompletionAggregateGeneration:2});await db.doc(rc.ratingDestructiveJobPath(mergeId)).set(mergeParent);
 const ag=require('../lib/dish_review_aggregate_accumulator'),winnerPath=require('../lib/rating_destructive_aggregate').ratingDestructiveAggregateWinnerCollectionPath(mergeId),refs=[];
 for(const u of [uid,'billing-B']){const w=ag.buildDishReviewAggregateWinnerDocument({jobId:mergeId,aggregateRole:'target',candidate:{sourceDocumentId:`local-review-${u}`,dishId:'local-target-dish',restaurantId:'local-restaurant',userId:u,overallImpression:8,tastinessScore:8,qualityScore:8,valueScore:8,overallBiteScore:8,freshnessSeconds:Math.floor(now/1000),freshnessNanoseconds:0},indexedAt:t});const ref=db.doc(`${winnerPath}/${w.winnerId}`);await ref.set(w);refs.push(ref);}
 await seed();await workPass();assert.equal((await manifest.get()).exists,true);assert.equal((await manifest.collection('seen_valid_identities').get()).empty,true);await workPass();assert.equal((await manifest.get()).exists,false);assert.equal((await db.doc(rc.ratingDestructiveJobItemPath(itemId)).get()).exists,false);
 await workPass();await workPass();assert.equal((await refs[0].get()).exists,false);assert.equal((await refs[1].get()).exists,true);assert.equal((await db.doc(rc.ratingDestructiveJobPath(jobId)).get()).exists,true);
});
local('malformed completed parent leaves settled-work evidence intact and pending',async()=>{
 const {rc,jobId,itemId,parent,item}=terminalWork();await db.doc(rc.ratingDestructiveJobPath(jobId)).set({...parent,fingerprint:'0'.repeat(64)});await db.doc(rc.ratingDestructiveJobItemPath(itemId)).set(item);
 await seed();assert.equal(await workPass(),'pending');assert.equal((await db.doc(rc.ratingDestructiveJobItemPath(itemId)).get()).exists,true);
});

local('late verified Checkout resolves an older unknown intent and still cancels its subscription',async()=>{
 await seed();await db.runTransaction(tx=>billing.reserveAccountDeletionCheckoutIntent(db,tx,uid,'attempt-old-unknown',{newAttempt:false,sessionId:null,attemptedAtMs:now-10000}));
 const late=sub({id:'sub_recovered',metadata:webhook.createOwnerBillingStripeMetadata({ownerUid:uid,checkoutAttemptId:'attempt-old-unknown'})});
 const session={id:'cs_recovered',mode:'subscription',subscription:late.id,customer:'cus_owned',client_reference_id:uid,metadata:late.metadata};
 await deliver({id:'evt_recovered',created:Math.floor(now/1000),type:'checkout.session.completed',data:{object:session}},late);
 const ref=db.doc(`private_owner_billing_states/${uid}/checkout_intents/attempt-old-unknown`);assert.equal((await ref.get()).get('sessionId'),'cs_recovered');assert.equal((await ref.get()).get('terminal'),true);
 const adapter=fake(sub()),rows=new Map([['sub_owned',adapter.value],['sub_recovered',late]]);let cancellations=0;
 adapter.retrieveSubscription=async id=>structuredClone(rows.get(id));adapter.cancelSubscription=async id=>{cancellations++;rows.get(id).status='canceled';};
 for(let i=0;i<12;i++)await pass(adapter);
 assert.equal(cancellations,2);assert.equal(late.status,'canceled');assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});

local('actual Storage adapter lists local owned files and deletes only the captured generation idempotently',async()=>{
 assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:9298');
 const path=`bitesaver_restaurants/${uid}/restaurant_images/LOCAL-storage-adapter.txt`;
 const file=require('firebase-admin/storage').getStorage().bucket('coupon-app-29446.firebasestorage.app').file(path);
 await file.save(Buffer.from('synthetic local fixture'),{resumable:false,metadata:{contentType:'text/plain'}});
 const adapter=require('../lib/account_deletion_media').createAccountDeletionObjects(),generation=await adapter.generation(path);
 assert.match(generation,/^[0-9]+$/);assert.equal(await adapter.nextOwnedPath(uid),path);
 await adapter.deleteGeneration(path,generation);assert.equal(await adapter.generation(path),null);await adapter.deleteGeneration(path,generation);assert.equal(await adapter.nextOwnedPath(uid),null);
});

local('aged current Checkout discovers exact owned session without replay; paginated B sessions survive',async()=>{
 const created=new Date(now-10000);
 await db.doc(`private_owner_billing_states/${uid}`).set(contract.createCheckoutPendingOwnerBillingState(contract.createInitialOwnerBillingState(uid,created),{checkoutAttemptId:'attempt-A',checkoutRequestFingerprint:'a'.repeat(64),checkoutAttemptCreatedAt:created,now:created}));
 const body={mode:'subscription',metadata:meta(),client_reference_id:uid,line_items:[{quantity:1,price:billing.deletionStripePriceId}]};
 await assert.rejects(billing.createDeletionAwareCheckout(db,{checkout:{sessions:{create:async()=>{throw Error('lost response');}}}},uid,'attempt-A',body));
 const intent=db.doc(`private_owner_billing_states/${uid}/checkout_intents/attempt-A`),expires=(await intent.get()).get('admissionExpiresAt');
 await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt:'a'.repeat(43)},{uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},{uid,creationTime:created.toUTCString(),providerIds:['password'],disabled:false},now);
 now=(expires+1)*1000;
 const adapter=fake(sub());let listed=0;const calls=[];
 const session={id:'cs_found',mode:'subscription',client_reference_id:uid,metadata:meta(),expires_at:expires,status:'complete',customer:'cus_owned',subscription:'sub_owned'};
 adapter.listCheckouts=async(expiry,customer,after)=>{assert.equal(expiry,expires);assert.equal(customer,undefined);calls.push(after);listed++;return {data:after?[session]:[{id:'cs_foreign',metadata:webhook.createOwnerBillingStripeMetadata({ownerUid:'B',checkoutAttemptId:'other'})}],has_more:!after,providerNowMs:now};};
 adapter.retrieveCheckout=async()=>session;
 for(let i=0;i<15;i++)await pass(adapter);
 assert.equal(listed,2);assert.deepEqual(calls,[undefined,'cs_foreign']);assert.equal(adapter.value.status,'canceled');assert.equal((await intent.get()).get('terminal'),true);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('absent owned grant bytes still remove exact A menu reference and preserve unrelated B image',async()=>{
 await seed();const grantId='bsmia_'+ 'z'.repeat(43),path=`public_menu_images/${grantId}/image.jpg`,objects=objectFake('');
 await db.doc(`private_menu_image_upload_authorizations/${grantId}`).set({schemaVersion:1,state:'revoked',ownerUserId:uid,sourceType:'sharedMenu',sourceId:'shared',fileName:'image.jpg'});
 await db.doc('restaurant_menus/shared/menu_images/A').set({storagePath:path,imageUrl:'https://example.test/A'});
 await db.doc('restaurant_menus/shared/menu_images/B').set({storagePath:'B-owned',imageUrl:'https://example.test/B'});
 for(let i=0;i<5;i++){now+=4000000;await api.processAccountDeletionJob(db,uid,async c=>({complete:await require('../lib/account_deletion_media').deleteAccountOwnedMenuObject(c,grantId,objects)}),()=>now);}
 assert.equal((await db.doc('restaurant_menus/shared/menu_images/A').get()).exists,false);assert.equal((await db.doc('restaurant_menus/shared/menu_images/B').get()).exists,true);
});
local('field-author cleanup removes A text on B catalog, preserves B text on A-created catalog',async()=>{
 await db.doc('bitescore_restaurants/B').set({bio:'A personal note',bioAuthorUid:uid,ownerUserId:'billing-B',restaurantWriteRevision:0});
 await db.doc('bitescore_restaurants/A').set({createdByUserId:uid,bio:'B replacement note',bioAuthorUid:'billing-B',restaurantWriteRevision:0});
 await seed();assert.equal((await runActualOwner()).state,'complete');
 assert.equal((await db.doc('bitescore_restaurants/B').get()).get('bio'),undefined);assert.equal((await db.doc('bitescore_restaurants/B').get()).get('ownerUserId'),'billing-B');
 assert.equal((await db.doc('bitescore_restaurants/A').get()).get('bio'),'B replacement note');assert.equal((await db.doc('bitescore_restaurants/A').get()).get('createdByUserId'),undefined);
});
local('current trusted A/B photo publications clean A bytes including abandoned photos, preserve B and reject URL theft',async()=>{
 const create=require('../lib/customer_bitescore_photos').createCustomerBiteScorePhotoHandler;
 const key=u=>require('node:crypto').createHash('sha256').update(`bitestar.dish-upload.v1:${u}`).digest('hex');
 const path=u=>`bitescore_user_uploads/${key(u)}/dish_images/current-dish/photo.jpg`;
 const objects=objectFake(path(uid));objects.values.set(path('billing-B'),{generation:'10',urls:[]});objects.values.set(path(uid).replace('photo.jpg','abandoned.jpg'),{generation:'10',urls:[]});
 await db.doc('private_bitescore_runtime/aggregation').set({version:1,enabled:true,epoch:'local-photo'});
 await db.doc('bitescore_restaurants/current-restaurant').set({id:'current-restaurant',isActive:true,restaurantWriteRevision:0});
 await db.doc('bitescore_dishes/current-dish').set({id:'current-dish',restaurantId:'current-restaurant',isActive:true,imageCount:0});
 const data=u=>({schemaVersion:1,expectedUserId:u,imageId:u,dishId:'current-dish',restaurantId:'current-restaurant',reviewId:null,mode:'gallery',storagePath:path(u),imageUrl:`https://firebasestorage.googleapis.com/v0/b/demo-photos/o/${encodeURIComponent(path(u))}?alt=media&token=LOCAL`});
 const auth=u=>({uid:u,token:{email_verified:true,firebase:{sign_in_provider:'password'}}});
 const options={readUploadedObject:async name=>({bucket:'demo-photos',name,size:10,contentType:'image/jpeg',downloadTokens:['LOCAL'],generation:'10',metadata:{ownershipVersion:'1',uploaderKey:name.split('/')[1],dishId:'current-dish'}})};
 for(const u of [uid,'billing-B'])await create(db,{data:data(u),auth:auth(u)},options);
 await assert.rejects(create(db,{data:{...data('billing-B'),expectedUserId:uid},auth:auth(uid)},options));
 await seed();await assert.rejects(create(db,{data:data(uid),auth:auth(uid)},options));
 assert.equal((await runActualOwner(objects)).state,'complete');assert.equal((await db.doc(`bitescore_dish_images/${uid}`).get()).exists,false);assert.equal((await db.doc('bitescore_dish_images/billing-B').get()).exists,true);
 assert.equal(objects.values.has(path(uid)),false);assert.equal(objects.values.has(path('billing-B')),true);assert.equal(objects.deletes.length,2);
});
local('aged unknown Checkout requires provider-observed closure and complete no-match enumeration',async()=>{
 const created=new Date(now-10000);
 await db.doc(`private_owner_billing_states/${uid}`).set(contract.createCheckoutPendingOwnerBillingState(contract.createInitialOwnerBillingState(uid,created),{checkoutAttemptId:'attempt-A',checkoutRequestFingerprint:'a'.repeat(64),checkoutAttemptCreatedAt:created,now:created}));
 const body={mode:'subscription',metadata:meta(),client_reference_id:uid,customer:'cus_owned',line_items:[{quantity:1,price:billing.deletionStripePriceId}]};
 await assert.rejects(billing.createDeletionAwareCheckout(db,{checkout:{sessions:{create:async()=>{throw Error('lost response');}}}},uid,'attempt-A',body));
 const ref=db.doc(`private_owner_billing_states/${uid}/checkout_intents/attempt-A`),expiry=(await ref.get()).get('admissionExpiresAt');
 await api.requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:uid,confirmation:'DELETE',receipt:'a'.repeat(43)},{uid,authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},{uid,creationTime:created.toUTCString(),providerIds:['password'],disabled:false},now);
 now=(expiry+1)*1000;const adapter=fake(sub());let providerNowMs=(expiry-1)*1000,calls=0;
 adapter.listCheckouts=async(expires,customer)=>{calls++;assert.equal(expires,expiry);assert.equal(customer,'cus_owned');return {data:[],has_more:false,providerNowMs};};
 await pass(adapter);assert.equal((await ref.get()).get('terminal'),false);
 providerNowMs=(expiry+1)*1000;await pass(adapter);await pass(adapter);
 assert.ok(calls>=2);assert.equal((await ref.get()).get('confirmedStatus'),'closed_admission_no_session');assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('bio cleanup waits for accepted restaurant work without invalidating its revision',async()=>{
 await db.doc('bitescore_restaurants/locked').set({bio:'A note',bioAuthorUid:uid,restaurantWriteRevision:8});
 await db.doc('private_rating_restaurant_operation_locks/locked').set({permanent:false});
 await seed();const first=await runActualOwner();assert.equal(first.state,'pending');assert.equal(first.reason,'accepted_work');assert.equal((await db.doc('bitescore_restaurants/locked').get()).get('restaurantWriteRevision'),8);
 await db.doc('private_rating_restaurant_operation_locks/locked').delete();assert.equal((await runActualOwner()).state,'complete');assert.equal((await db.doc('bitescore_restaurants/locked').get()).get('bio'),undefined);
});
local('personal generation journal recovers lost acknowledgement and refuses a replacement',async()=>{
 const module=require('../lib/account_deletion_media'),key=require('node:crypto').createHash('sha256').update(`bitestar.dish-upload.v1:${uid}`).digest('hex');
 const path=`bitescore_user_uploads/${key}/dish_images/dish/one.jpg`;await seed();const objects=objectFake(path);
 const step=async()=>{now+=4000000;await api.processAccountDeletionJob(db,uid,async c=>({complete:await module.accountDeletionPersonalObjectStep(c,objects)}),()=>now);};
 await step();objects.values.get(path).generation='11';await step();assert.equal(objects.deletes.length,0);assert.equal(objects.values.get(path).generation,'11');
 // Restore only the synthetic provider snapshot to exercise an independent
 // response-loss case; production recovery never overwrites a replacement.
 objects.values.get(path).generation='10';let once=true;const del=objects.deleteGeneration.bind(objects);objects.deleteGeneration=async(p,g)=>{await del(p,g);if(once){once=false;throw Error('lost response');}};
 for(let i=0;i<5;i++)await step();assert.deepEqual(objects.deletes,[[path,'10']]);assert.equal((await db.doc(`private_account_deletions/${uid}`).get()).get('state'),'complete');
});
local('actual local personal-object adapter validates owner metadata and preserves a foreign proof',async()=>{
 const ownerKey=require('node:crypto').createHash('sha256').update(`bitestar.dish-upload.v1:${uid}`).digest('hex');
 const path=`bitescore_user_uploads/${ownerKey}/dish_images/local-dish/${require('node:crypto').randomUUID()}.jpg`;
 const file=require('firebase-admin/storage').getStorage().bucket('coupon-app-29446.firebasestorage.app').file(path);
 const adapter=require('../lib/account_deletion_media').createAccountDeletionObjects();
 await file.save(Buffer.from([1,2,3]),{resumable:false,metadata:{contentType:'image/jpeg',metadata:{ownershipVersion:'1',uploaderKey:ownerKey,dishId:'local-dish'}}});
 const generation=await adapter.personalGeneration(path,uid);assert.match(generation,/^[0-9]+$/);assert.equal(await adapter.nextPersonalPath(uid),path);
 await assert.rejects(adapter.personalGeneration(path,'billing-B'));
 await file.setMetadata({metadata:{ownershipVersion:'1',uploaderKey:'foreign',dishId:'local-dish'}});
 await assert.rejects(adapter.personalGeneration(path,uid));assert.notEqual(await adapter.generation(path),null);
 await file.delete();
});
