'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{createRequire}=require('node:module');
const req=createRequire(process.env.BS_PERF_SOURCE+'/functions/package.json');
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore'),{getAuth}=req('firebase-admin/auth');
const F=req('./test/fixtures/postgis_gate0.cjs'),I=req('./lib/customer_bitesaver_public_identity.js');
const {createLocalPostgisStagingRuntime}=req('./lib/postgis_staging_runtime.js'),{createPostgisSearchHandlers}=req('./lib/postgis_handlers.js');
async function main(){
 const projectId='demo-bs-postgis-flutter',app=initializeApp({projectId},'performance007-races'),db=getFirestore(app);
 const runtime=createLocalPostgisStagingRuntime({database:db,auth:getAuth(app),projectId,allowedProjectIds:[projectId],guestRestaurantWindow:true,epoch:'flutter-local-source-v1',sql:{host:'127.0.0.1',port:55441,database:'bsgate0_flutter_linux007repro',user:'bsgate0'},discoveryKey:Buffer.alloc(32,71),identityKeyV1:F.identityKeyV1,scoreCursorRootKey:Buffer.alloc(32,73)});
 const api=createPostgisSearchHandlers({database:runtime.authority,provider:runtime.provider});let clock=Date.parse('2026-10-19T23:00:00Z'),sequence=0;
 const context={database:runtime.authority,discoveryKey:Buffer.alloc(32,71),identityKeyV1:F.identityKeyV1,identity:{authUid:null,authIsAnonymous:false},guestRestaurantWindow:true,now:()=>clock};
 const fixture=F.dataset({saverParents:35,scoreParents:30,includeCases:false});const results=[];
 const requestId=()=>`performance007-race2-${String(++sequence).padStart(12,'0')}`;
 async function start(){const clientInstanceId=requestId();const state=await api.startCustomerBiteSaverSearchV2({schemaVersion:1,clientRequestId:requestId(),clientInstanceId,...F.center,radiusMiles:15,locationMode:'current',typedLocation:null,searchText:'',timeZone:'America/New_York',utcOffsetMinutes:-240,freshSearch:true},context);const bound=extra=>({schemaVersion:1,clientRequestId:requestId(),clientInstanceId,sessionId:state.sessionId,capability:state.capability,criteriaFingerprint:state.criteriaFingerprint,...extra});const page=bound({cursor:null,guestStateRevision:1});const first=await api.getCustomerBiteSaverSearchPageV2(page,context);assert.equal(first.outcome,'guestCheckRequired');assert.equal(first.candidates.length,26);return {first,bound,page};}
 function answer(f,batch=f.first){return f.bound({operationRef:batch.operationRef,checkToken:batch.checkToken,batchSequence:batch.batchSequence,guestStateRevision:batch.guestStateRevision,entireBatchEvaluated:true,unavailableOfferIds:[]});}
 try{
  let f=await start(),a=answer(f);await assert.rejects(api.continueCustomerBiteSaverGuestOfferCheckV2(a,{...context,identity:{authUid:'other-synthetic-account',authIsAnonymous:false}}));results.push('cross-account-denied');
  const complete=await api.continueCustomerBiteSaverGuestOfferCheckV2(a,context);assert.equal(complete.result.restaurants.length,25);assert.deepEqual(await api.continueCustomerBiteSaverGuestOfferCheckV2(a,context),complete);results.push('lost-completion-reply-replays-exact-page');
  f=await start();clock=f.first.logicalExpiresAtMillis;const refreshed=await api.getCustomerBiteSaverSearchPageV2({...f.page,clientRequestId:requestId()},context);assert.equal(refreshed.outcome,'guestCheckRequired');assert.deepEqual(refreshed.candidates,f.first.candidates);assert.equal(refreshed.batchSequence,f.first.batchSequence+1);await assert.rejects(api.continueCustomerBiteSaverGuestOfferCheckV2(answer(f),context));assert.equal((await api.continueCustomerBiteSaverGuestOfferCheckV2(answer(f,refreshed),context)).result.restaurants.length,25);results.push('expired-window-reissue-preserves-candidates-and-rejects-old-answer');
  for(const kind of ['parent','offer']){
   f=await start();const c=f.first.candidates.at(-1);
   const coupon=fixture.sources.find(row=>row.path.startsWith('restaurant_accounts/')&&row.path.split('/')[2]==='coupons'&&I.customerBiteSaverOpaqueOfferId(F.identityKeyV1,row.path.split('/')[1],'coupon',row.path.split('/')[3])===c.offerId);assert(coupon);
   const target=kind==='parent'?coupon.path.split('/').slice(0,2).join('/'):coupon.path;
   const before=await db.doc(target).get();assert(before.exists);await db.doc(target).delete();
   try{const response=await api.continueCustomerBiteSaverGuestOfferCheckV2(answer(f),context);assert.equal(response.outcome,'retryRequired');assert.equal(response.reason,'sourceChanged');assert.equal(response.result,undefined);results.push(kind+'-withdrawal-rejected-before-page-delivery');}
   finally{await db.doc(target).set(before.data());}
  }
  fs.writeFileSync(process.env.BS_PERF_OUTPUT,JSON.stringify({kind:'real-local-Firestore-PostGIS-native-window',checks:results,passed:results.length},null,2)+'\n');
 }finally{await runtime.close();await db.terminate();await deleteApp(app);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
