"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {MemoryDatabase} = require("./helpers/customer_bitesaver_memory_database.js");
const {getCustomerBiteSaverSearchPageHandler} = require("../lib/customer_bitesaver_search_session.js");
const {buildBiteSaverCouponOfferIndex, buildBiteSaverDailySpecialOfferIndex} = require("../lib/search_index_builders.js");
const {customerBiteSaverOpaqueRestaurantId} = require("../lib/customer_bitesaver_public_identity.js");
const {biteSaverOfferIndexCollection} = require("../lib/search_index_contract.js");
const {canonicalRestaurantGeohash} = require("../lib/restaurant_geo_helpers.js");
const now = Date.parse("2026-09-19T16:00:00Z");
const identityKeyV1 = Buffer.alloc(32, 59);
const binding = "A".repeat(43);
function fixture() {
  const database = new MemoryDatabase();
  const catalog = {id:"catalog-a", name:"Same Restaurant", address:"1 Main St", streetAddress:"1 Main St",
    city:"Hartford", state:"CT", zipCode:"06103", latitude:41.7658, longitude:-72.6734,
    restaurantWriteRevision:1, isActive:true, isClaimed:false, ownerUserId:null};
  const account = {restaurantName:"Same Restaurant", approvalStatus:"approved", couponApplicationSubmitted:true,
    subscriptionStatus:"active", couponPostingEnabled:true, streetAddress:"1 Main St", city:"Hartford", state:"CT",
    zipCode:"06103", latitude:41.7658, longitude:-72.6734, businessHours:[], bio:"Public bio",
    phone:"8605551234", website:"https://example.test", mainImageUrl:"https://example.test/restaurant.jpg",
    geohash:canonicalRestaurantGeohash({latitude:41.7658,longitude:-72.6734}),
    ownerUid:"private-owner-canary", stripeCustomerId:"private-payment-canary",
    biteScoreCatalogRestaurantId:"catalog-a", biteSaverCatalogBindingId:binding};
  database.set("bitescore_restaurants/catalog-a", catalog);
  const context = {database, discoveryKey:Buffer.alloc(32,41), identityKeyV1,
    identity:{authUid:null,authIsAnonymous:false}, now:()=>now};
  function participate() {
    catalog.biteSaverCatalogBindingId = binding;
    database.set("restaurant_accounts/account-a", account);
  }
  function offer(id, type="coupon", overrides={}) {
    const raw = {title:`Public ${id}`, restaurant:"Same Restaurant", details:"Public details", usageRule:"Unlimited",
      isActive:true, active:true, isProximityOnly:false, createdAt:new Date(now - 1000), updatedAt:new Date(now - 500),
      availabilityMode:"specificDays", daysOfWeek:[1,2,3,4,5,6,7], allDay:true,
      privateField:"private-offer-canary", ...overrides};
    const projection = type === "coupon" ? buildBiteSaverCouponOfferIndex({restaurantAccountId:"account-a",sourceDocumentId:id,
      offer:raw,restaurant:account,now:new Date(now),identityKeyV1}) : buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId:"account-a",sourceDocumentId:id,offer:raw,restaurant:account,now:new Date(now)});
    assert.ok(projection);
    database.set(`restaurant_accounts/account-a/${type === "coupon" ? "coupons" : "daily_specials"}/${id}`,raw);
    database.set(`${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,projection);
    return raw;
  }
  return {database,context,catalog,account,participate,offer};
}
function request(overrides={}) {return {schemaVersion:1,kind:"publicProfile",section:"profile",
  catalogRestaurantId:"catalog-a",cursor:null,timeZone:"America/New_York",utcOffsetMinutes:-240,...overrides};}
async function read(f, overrides={}) {return getCustomerBiteSaverSearchPageHandler(request(overrides),f.context);}

test("unchanged exact permanent ID moves from unbound to genuine public profile; never writes",async()=>{
  const f=fixture();
  const before=await read(f); assert.equal(before.state,"notParticipating");
  assert.equal(f.database.documents.has("restaurant_accounts/account-a"),false);
  f.participate(); f.offer("coupon-a"); f.offer("special-a","dailySpecial");
  const result=await read(f);
  assert.equal(result.state,"available");
  assert.equal(result.catalogRestaurantId,"catalog-a");
  assert.equal(result.restaurant.restaurantId,customerBiteSaverOpaqueRestaurantId(identityKeyV1,"account-a"));
  assert.equal(result.restaurant.bio,"Public bio");
  assert.equal(result.restaurant.imageUrl,"https://example.test/restaurant.jpg");
  assert.equal(result.restaurant.phone,"8605551234");
  assert.deepEqual(result.restaurant.offers.map(o=>o.offerType).sort(),["coupon","dailySpecial"]);
  const json=JSON.stringify(result);
  for(const forbidden of ["private-owner-canary","private-payment-canary","private-offer-canary","account-a",
    '"accessToken"','"capability"','"sessionId"','"challengeId"']) assert.equal(json.includes(forbidden),false,forbidden);
  assert.deepEqual(f.database.writes,[]);
  assert.ok(f.database.queries.every(q=>q.limit<=26));
  assert.ok(f.database.queries.filter(q=>q.collectionPath==="restaurant_accounts").every(q=>q.limit===2 &&
    q.filters[0].field==="biteScoreCatalogRestaurantId"));
});

test("same names never substitute another exact catalog identity",async()=>{
  const f=fixture(); f.participate(); f.offer("coupon-a");
  f.database.set("bitescore_restaurants/catalog-b",{...f.catalog,id:"catalog-b",biteSaverCatalogBindingId:"B".repeat(43)});
  f.database.set("restaurant_accounts/account-b",{...f.account,bio:"Other exact profile",
    biteScoreCatalogRestaurantId:"catalog-b",biteSaverCatalogBindingId:"B".repeat(43)});
  const a=await read(f), b=await read(f,{catalogRestaurantId:"catalog-b"});
  assert.notEqual(a.restaurant.restaurantId,b.restaurant.restaurantId);
  assert.equal(b.restaurant.bio,"Other exact profile"); assert.equal(b.restaurant.offers.length,0);
});

test("missing, malformed, conflicting or withdrawn binding fails closed",async()=>{
  for (const change of [
    f=>f.database.documents.delete("bitescore_restaurants/catalog-a"),
    f=>{f.catalog.biteSaverCatalogBindingId="broken";},
    f=>{f.account.biteSaverCatalogBindingId="B".repeat(43);},
    f=>{delete f.account.biteSaverCatalogBindingId;},
    f=>f.database.set("restaurant_accounts/duplicate",{...f.account}),
    f=>{f.account.couponPostingEnabled=false;},
    f=>{f.catalog.isActive=false;},
  ]) {
    const f=fixture(); f.participate(); change(f);
    assert.equal((await read(f)).state,"unavailable"); assert.deepEqual(f.database.writes,[]);
  }
  const f=fixture();
  for(const id of [""," catalog-a","catalog-a/child",".."])
    await assert.rejects(read(f,{catalogRestaurantId:id}),{code:"invalid-argument"});
});

test("bounded offers paginate without duplicate IDs; cursors cannot change permanent target",async()=>{
  const f=fixture(); f.participate();
  for(let i=0;i<28;i++) f.offer(`coupon-${String(i).padStart(2,"0")}`);
  const first=await read(f); assert.equal(first.restaurant.offers.length,25); assert.equal(first.hasMore,true);
  const second=await read(f,{cursor:first.nextCursor}); assert.equal(second.restaurant.offers.length,3);
  assert.equal(second.hasMore,false);
  assert.equal(new Set([...first.restaurant.offers,...second.restaurant.offers].map(o=>o.offerId)).size,28);
  f.catalog.biteSaverCatalogBindingId="B".repeat(43); f.account.biteSaverCatalogBindingId="B".repeat(43);
  await assert.rejects(read(f,{cursor:first.nextCursor}),{code:"failed-precondition"});
  assert.deepEqual(f.database.writes,[]);
});

test("existing menu scanner serves allowlisted bounded menu data with no usage work",async()=>{
  const f=fixture(); f.participate();
  f.database.set("restaurant_accounts/account-a/menu_items/item-a",{name:"Public pasta",description:"Tomato",price:"$12",
    category:"Dinner",sortOrder:0,ownerUid:"private-menu-canary"});
  const page=await read(f,{section:"menu"});
  assert.equal(page.state,"available");
  assert.equal(page.entries.length,1);
  assert.equal(JSON.stringify(page).includes("private-menu-canary"),false);
  assert.equal(JSON.stringify(page).includes("account-a"),false);
  assert.deepEqual(f.database.writes,[]);
});

test("public display observes local special schedules and expiration without usage reads",async()=>{
  const f=fixture(); f.participate();
  f.context.now=()=>Date.parse("2026-09-19T02:00:00Z"); // Friday22:00 New York, Saturday UTC.
  f.offer("friday","dailySpecial",{createdAt:new Date("2026-09-18T12:00:00Z"),
    daysOfWeek:[5],allDay:true,hideWhenUnavailable:true});
  f.offer("saturday","dailySpecial",{createdAt:new Date("2026-09-18T12:00:00Z"),
    daysOfWeek:[6],allDay:true,hideWhenUnavailable:true});
  f.offer("expired","dailySpecial",{availabilityMode:"todayOnly",expiresAt:new Date("2026-09-18T23:00:00Z")});
  const page=await read(f);
  assert.deepEqual(page.restaurant.offers.map(o=>o.title),["Public friday"]);
  assert.equal(f.database.gets.some(path=>path.includes("redemption") || path.includes("device")),false);
  assert.deepEqual(f.database.writes,[]);
  await assert.rejects(read(f,{utcOffsetMinutes:0}),{code:"invalid-argument"});
});

test("raw source bytes stop a public page and continuation resumes after the consumed item",async()=>{
  const f=fixture(); f.participate();
  f.offer("z-padded","coupon",{privatePadding:"x".repeat(1048576)});
  f.offer("a-next");
  const page=await read(f);
  assert.equal(page.partial,true);
  assert.equal(page.restaurant.offers.length,1);
  assert.equal(JSON.stringify(page).includes("privatePadding"),false);
  const next=await read(f,{cursor:page.nextCursor});
  assert.equal(next.restaurant.offers.length,1);
  assert.notEqual(next.restaurant.offers[0].offerId,page.restaurant.offers[0].offerId);
  assert.deepEqual(f.database.writes,[]);
});

test("a public cursor cannot be exchanged for Saved coupon-use authority",async()=>{
  const f=fixture(); f.participate();
  for(let i=0;i<26;i++) f.offer(`coupon-${i}`);
  const page=await read(f);
  const {authenticateCustomerBiteSaverSavedChallengeAuthority} = require("../lib/customer_bitesaver_saved.js");
  const useRequest={origin:{kind:"saved",accessToken:page.nextCursor},
    restaurantId:page.restaurant.restaurantId,offerId:page.restaurant.offers[0].offerId};
  assert.throws(()=>authenticateCustomerBiteSaverSavedChallengeAuthority(useRequest,
    {...f.context,identity:{authUid:"signed-customer",authIsAnonymous:false}},now),{code:"invalid-argument"});
  assert.deepEqual(f.database.writes,[]);
});

test("profile uses existing canonical own-favorite reader without creating a Saved access token",async()=>{
  const f=fixture();f.participate();f.offer("coupon-a");
  f.context.identity={authUid:"signed-customer",authIsAnonymous:false};
  const initial=await read(f);
  assert.deepEqual(initial.favoriteStates.map(s=>s.state),["notFavorite","notFavorite"]);
  const id=initial.restaurant.restaurantId;
  f.database.set(`user_profiles/signed-customer/favorite_restaurants/${id}`,{
    schemaVersion:1,favoriteKind:"bitesaverRestaurant",userId:"signed-customer",restaurantId:id,
    createdAt:new Date(now),updatedAt:new Date(now)});
  const saved=await read(f);
  assert.equal(saved.favoriteStates[0].state,"favorite");
  f.context.identity={authUid:"another-customer",authIsAnonymous:false};
  assert.equal((await read(f)).favoriteStates[0].state,"notFavorite");
  assert.equal(JSON.stringify(saved).includes("accessToken"),false);
  assert.deepEqual(f.database.writes,[]);
});

test("profile accepts the same seasonal timezone metadata as ordinary Browse",async()=>{
  const f=fixture();f.participate();f.offer("coupon-a");
  assert.equal((await read(f,{utcOffsetMinutes:-300})).state,"available");
  await assert.rejects(read(f,{timeZone:"not/a/zone"}),{code:"invalid-argument"});
});

const {productionDeviceUseFixture} = require('./helpers/customer_bitesaver_production_device_fixture.js');
const {reserveCustomerBiteSaverDeviceChallengeAdmission} = require('../lib/customer_bitesaver_device_challenge_admission.js');
async function prepareProfileUse(f, overrides={}) {
  const page = await read(f);
  const request = {schemaVersion:1, kind:'publicProfileUse', clientRequestId:'profile-context-request-0001',
    clientInstanceId:'profile-stable-client-0001',catalogRestaurantId:'catalog-a',
    restaurantId:page.restaurant.restaurantId,offerId:page.restaurant.offers.find(o=>o.offerType==='coupon').offerId,
    timeZone:'America/New_York',utcOffsetMinutes:-240,
    guestStateRevision:f.context.identity.authUid && !f.context.identity.authIsAnonymous ? null : 0,
    ...overrides};
  const access = await getCustomerBiteSaverSearchPageHandler(request,f.context);
  const use = {schemaVersion:1, logicalRequestId:request.clientRequestId,restaurantId:request.restaurantId,
    offerId:request.offerId,timeZone:request.timeZone,utcOffsetMinutes:request.utcOffsetMinutes,currentCoordinates:null,
    origin:{kind:'discovery',clientInstanceId:request.clientInstanceId,sessionId:access.sessionId,
      capability:access.capability,criteriaFingerprint:access.criteriaFingerprint,
      offerOccurrence:access.offerOccurrence,guestStateRevision:request.guestStateRevision}};
  return {request,access,use};
}
for (const signed of [false,true]) test(`profile ${signed?'signed':'guest'} final use enters production device writer once, context itself consumes nothing`,async()=>{
  const f=fixture();f.participate();f.offer('coupon1','coupon',{usageRule:'Once per customer'});
  if(signed) f.context.identity={authUid:'profile-signed-owner',authIsAnonymous:false};
  const prepared=await prepareProfileUse(f);
  assert.ok(f.database.writes.length>0);
  assert.ok(f.database.writes.every(w=>w.path.startsWith('private_bitesaver_search_')));
  const repeated=await prepareProfileUse(f,{clientRequestId:'profile-context-request-0002'});
  assert.equal(repeated.access.sessionId,prepared.access.sessionId);
  assert.equal(repeated.access.capability,prepared.access.capability);
  const production=await productionDeviceUseFixture(prepared.use,f.context);
  const result=await production.use();
  assert.equal(result.status,'started');assert.equal(result.timerStartedAtMillis,now);
  assert.equal(result.timerExpiresAtMillis,now+300000);
  assert.deepEqual(await production.use(),result); production.assertPrivateAndReplayed();
  assert.equal([...f.database.documents.values()].filter(d=>d.role==='deviceCouponUsage').length,1);
  assert.equal([...f.database.documents.keys()].filter(p=>p.startsWith('customer_redemptions/')).length,signed?1:0);
});

const {getCustomerBiteSaverSavedPageHandler} = require('../lib/customer_bitesaver_saved.js');
async function savedUse(f, prepared, id='saved-profile-cross-use-0001') {
  const uid=f.context.identity.authUid;
  f.database.set(`user_profiles/${uid}/favorite_coupons/${prepared.use.offerId}`,{
    schemaVersion:1,favoriteKind:'bitesaverCoupon',userId:uid,restaurantId:prepared.use.restaurantId,
    offerId:prepared.use.offerId,offerType:'coupon',createdAt:new Date(now),updatedAt:new Date(now)});
  const page=await getCustomerBiteSaverSavedPageHandler({schemaVersion:1,clientRequestId:id,
    section:'coupons',cursor:null},f.context);
  assert.equal(page.entries.length,1);
  return {...prepared.use,logicalRequestId:id,origin:{kind:'saved',accessToken:page.entries[0].accessToken}};
}
for(const profileFirst of [true,false]) test(`profile and Saved share account/device history in both directions (profileFirst=${profileFirst})`,async()=>{
  const f=fixture();f.participate();f.offer('coupon1','coupon',{usageRule:'Once per customer'});
  f.context.identity={authUid:'cross-entry-owner',authIsAnonymous:false};
  const prepared=await prepareProfileUse(f);const saved=await savedUse(f,prepared);
  const first=await productionDeviceUseFixture(profileFirst?prepared.use:saved,f.context);
  const accepted=await first.use();assert.equal(accepted.status,'started');
  let clock=now+60000;f.context.now=()=>clock;
  const other=await productionDeviceUseFixture(profileFirst?saved:prepared.use,f.context);
  const joined=await other.use();assert.equal(joined.status,'active');
  assert.equal(joined.timerStartedAtMillis,accepted.timerStartedAtMillis);
  assert.equal(joined.timerExpiresAtMillis-clock,240000);
  clock=now+300001;
  const denied=await productionDeviceUseFixture({...prepared.use,logicalRequestId:'profile-after-expiry-0001'},f.context);
  const result=await denied.use();assert.equal(result.status,'denied');assert.equal(result.reason,'used');
  assert.equal([...f.database.documents.values()].filter(d=>d.role==='deviceCouponUsage').length,1);
});

test('profile exact accepted outcome recovers after fresh expiry and withdrawal; new operation cannot',async()=>{
  const f=fixture();f.participate();f.offer('coupon1','coupon',{usageRule:'Once per customer'});
  const prepared=await prepareProfileUse(f);const production=await productionDeviceUseFixture(prepared.use,f.context);
  const accepted=await production.use();f.context.now=()=>now+16*60000;f.catalog.isActive=false;
  assert.deepEqual(await production.use(),accepted);production.assertPrivateAndReplayed();
  const fresh=await productionDeviceUseFixture({...prepared.use,logicalRequestId:'withdrawn-fresh-profile-0001'},f.context);
  await assert.rejects(fresh.use());
  assert.equal([...f.database.documents.values()].filter(d=>d.role==='deviceCouponUsage').length,1);
});

for(const signed of [false,true]) test(`profile ${signed?'signed mixed Saved':'guest rescan'} shares the existing thirty-slot rolling allowance`,async()=>{
  const f=fixture();f.participate();f.offer('coupon1');
  if(signed)f.context.identity={authUid:'profile-rate-owner',authIsAnonymous:false};
  const prepared=await prepareProfileUse(f);
  const saved=signed?await savedUse(f,prepared):null;
  const grants=[];
  for(let i=0;i<30;i++) grants.push(await reserveCustomerBiteSaverDeviceChallengeAdmission({
    request:{...(saved && i%2?saved:prepared.use),logicalRequestId:`profile-rate-attempt-${String(i).padStart(4,'0')}`},
    platform:'android',context:f.context}));
  assert.equal(new Set(grants.map(g=>g.admissionHandle)).size,1);
  const reopened=await prepareProfileUse(f,{clientRequestId:'profile-reopened-request-0002',timeZone:'UTC',utcOffsetMinutes:0});
  assert.equal(reopened.access.sessionId,prepared.access.sessionId);
  await assert.rejects(reserveCustomerBiteSaverDeviceChallengeAdmission({request:reopened.use,platform:'android',context:f.context}),
    e=>e.code==='resource-exhausted'&&e.retryAfterMillis===120000);
  f.context.now=()=>now+120000;
  const fresh=await reserveCustomerBiteSaverDeviceChallengeAdmission({request:reopened.use,platform:'android',context:f.context});
  assert.equal(fresh.admissionHandle,grants[0].admissionHandle);
});

test('profile private session start quota is shared with ordinary Browse starts',async()=>{
  const f=fixture();f.participate();f.offer('coupon1');
  const {startCustomerBiteSaverSearchHandler}=require('../lib/customer_bitesaver_search_session.js');
  await prepareProfileUse(f);
  for(let i=0;i<5;i++) {
    await startCustomerBiteSaverSearchHandler({schemaVersion:1,clientRequestId:`ordinary-start-request-${i}`,
      clientInstanceId:'profile-stable-client-0001',latitude:41.7658,longitude:-72.6734,radiusMiles:5,
      locationMode:'current',typedLocation:null,searchText:`test${i}`,timeZone:'America/New_York',utcOffsetMinutes:-240,freshSearch:true},f.context);
    for(const [p,d] of f.database.documents) if(p.startsWith('private_bitesaver_search_sessions/')&&d.state==='preparing') {
      f.database.set(p,{...d,state:'failed',failureCode:'preparation_failed'});
    }
  }
  // A new exact restaurant context shares callerControl's six fresh starts.
  f.database.set('bitescore_restaurants/catalog-b',{...f.catalog,id:'catalog-b',biteSaverCatalogBindingId:'B'.repeat(43)});
  f.database.set('restaurant_accounts/account-b',{...f.account,biteScoreCatalogRestaurantId:'catalog-b',biteSaverCatalogBindingId:'B'.repeat(43)});
  const parent=f.database.documents.get('restaurant_accounts/account-b');
  const raw={...f.database.documents.get('restaurant_accounts/account-a/coupons/coupon1')};
  const projection=buildBiteSaverCouponOfferIndex({restaurantAccountId:'account-b',sourceDocumentId:'coupon1',offer:raw,restaurant:parent,now:new Date(now),identityKeyV1});
  f.database.set('restaurant_accounts/account-b/coupons/coupon1',raw);f.database.set(`${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,projection);
  await assert.rejects(prepareProfileUse(f,{clientRequestId:'different-profile-target-0001',catalogRestaurantId:'catalog-b',
    restaurantId:projection.publicRestaurantId,offerId:projection.publicOfferId}),{code:'resource-exhausted'});
});

for(const mutation of ['restaurant','offer','actor','client','capability','publicMarker','expired','malformed'])
  test(`profile admission rejects ${mutation} context before reservation`,async()=>{
    const f=fixture();f.participate();f.offer('coupon1');f.context.identity={authUid:'profile-owner',authIsAnonymous:false};
    const prepared=await prepareProfileUse(f);const request=structuredClone(prepared.use);
    if(mutation==='restaurant') request.restaurantId='bsr_'+'B'.repeat(43);
    if(mutation==='offer') request.offerId='bso_'+'B'.repeat(43);
    if(mutation==='actor') f.context.identity={authUid:'different-owner',authIsAnonymous:false};
    if(mutation==='client') request.origin.clientInstanceId='another-client-instance-0001';
    if(mutation==='capability') request.origin.capability='bscap_'+'B'.repeat(43);
    if(mutation==='publicMarker') request.origin.offerOccurrence=(await read(f)).restaurant.offers[0].offerOccurrence;
    if(mutation==='expired') f.context.now=()=>now+60*60000;
    if(mutation==='malformed') request.origin.offerOccurrence='malformed';
    const writes=f.database.writes.length;
    await assert.rejects(reserveCustomerBiteSaverDeviceChallengeAdmission({request,platform:'android',context:f.context}));
    assert.equal(f.database.writes.length,writes);
  });

for(const mutation of ['binding','duplicate','catalogHidden','couponHidden','couponExpired','outsideProximity','missingProximity'])
  test(`profile fresh use rejects ${mutation} with no successful history`,async()=>{
    const f=fixture();f.participate();const raw=f.offer('coupon1','coupon',{usageRule:'Once per customer',
      ...(mutation.includes('Proximity')?{isProximityOnly:true,proximityRadiusMiles:1}:{})});
    const prepared=await prepareProfileUse(f);
    if(mutation==='binding') {f.account.biteSaverCatalogBindingId='B'.repeat(43);f.catalog.biteSaverCatalogBindingId='B'.repeat(43);}
    if(mutation==='duplicate') f.database.set('restaurant_accounts/conflict',{...f.account});
    if(mutation==='catalogHidden') f.catalog.isActive=false;
    if(mutation==='couponHidden') raw.isActive=false;
    if(mutation==='couponExpired') {raw.endTime=new Date(now-1);}
    if(mutation==='outsideProximity') prepared.use.currentCoordinates={latitude:40,longitude:-70,capturedAtMillis:now};
    const production=await productionDeviceUseFixture(prepared.use,f.context);
    const result=await production.use();assert.equal(result.status,'denied');
    assert.equal(result.timerStartedAtMillis,null);
    assert.equal([...f.database.documents.values()].filter(d=>d.role==='deviceCouponUsage').length,0);
  });

test('profile proximity accepts legitimate fresh current evidence; Unlimited stays untimed',async()=>{
  const f=fixture();f.participate();f.offer('coupon1','coupon',{isProximityOnly:true,proximityRadiusMiles:1});
  const prepared=await prepareProfileUse(f);assert.equal(prepared.access.isProximityOnly,true);
  prepared.use.currentCoordinates={latitude:41.7658,longitude:-72.6734,capturedAtMillis:now};
  const production=await productionDeviceUseFixture(prepared.use,f.context);
  const result=await production.use();assert.equal(result.status,'unlimited');assert.equal(result.timerStartedAtMillis,null);
  assert.deepEqual(await production.use(),result);production.assertPrivateAndReplayed();
  assert.equal([...f.database.documents.values()].filter(d=>d.role==='deviceCouponUsage').length,0);
});

for (const signed of [false, true]) test(`profile ${signed?'signed':'guest'} invalid possession proof cannot write success`, async () => {
  const f=fixture(); f.participate(); f.offer('coupon1','coupon',{usageRule:'Once per customer'});
  if(signed) f.context.identity={authUid:'invalid-proof-owner',authIsAnonymous:false};
  const prepared=await prepareProfileUse(f);
  const production=await productionDeviceUseFixture(prepared.use,f.context);
  await assert.rejects(production.useWithProof({possessionSignature:Buffer.alloc(70,1).toString('base64url')}));
  assert.equal([...f.database.documents.values()].filter(d=>d.role==='deviceCouponUsage'||d.role==='deviceUseOutcomeReceipt').length,0);
  assert.equal([...f.database.documents.keys()].some(p=>p.startsWith('customer_redemptions/')),false);
});
