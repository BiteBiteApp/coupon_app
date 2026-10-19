"use strict"; Error.stackTraceLimit=100;
const assert=require('node:assert/strict'),fs=require('node:fs'),{performance}=require('node:perf_hooks'),{createRequire}=require('node:module');
const root=__dirname+'/selected-source/functions',req=createRequire(root+'/package.json');
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore,Query,DocumentReference}=req('firebase-admin/firestore'),{getAuth}=req('firebase-admin/auth');
const {createLocalPostgisStagingRuntime}=req('./lib/postgis_staging_runtime.js');
const W=req('./lib/postgis_synthetic_workload.js'),F=req('./test/fixtures/postgis_gate0.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS,undefined);
const projectId='demo-bs-postgis-c006-final',runId='bs-postgis-c006-final',nowMs=Date.parse('2026-10-19T20:00:00Z');
const plan={version:1,planId:'local-500-final',offset:0,count:500,nowMs,operation:'seed',distribution:'mixed-national-v1',maxParentsPerInvocation:250,maxInvocations:6,maxSourceOperations:3000000,maxSourceBytes:2147483648};
const evidence={reference:'original unbatched algorithm with only canonical timestamp decoding and fractional boundary fingerprint corrections; true original baseline failed and is preserved separately',kind:'real-local-raw-Firestore-native-projections-journal-SQL',hosted:false,billingEvidence:false,plan,attempts:[],checks:[]};
const counts={directWrites:0,directDeletes:0,requestedDocuments:0,queryReturnedDocuments:0,transactionCalls:0,transactionAttempts:0,scheduledWrites:0,scheduledDeletes:0,commits:0};
async function main(){
 const app=initializeApp({projectId},'corrections006-seed'),db=getFirestore(app);
 const runtime=createLocalPostgisStagingRuntime({database:db,auth:getAuth(app),projectId,allowedProjectIds:[projectId],epoch:'corrections006-seed',sql:{host:'127.0.0.1',port:55441,database:'bsgate0_c006_seed_final',user:'bsgate0'},discoveryKey:Buffer.alloc(32,71),identityKeyV1:F.identityKeyV1,scoreCursorRootKey:Buffer.alloc(32,73),guestRestaurantWindow:true});
 try{
  const identity=req('./lib/customer_bitesaver_public_identity.js');
  const history=new Set(),suppressedParents=new Set();
  for(let i=0;i<500;i++){const p=W.postgisSyntheticParent(runId,i,nowMs);for(const c of p.historyOfferOrdinals)history.add(identity.customerBiteSaverOpaqueOfferId(F.identityKeyV1,p.saverId,'coupon',p.couponIds[c]));if(p.scenario.historyCohort)suppressedParents.add(identity.customerBiteSaverOpaqueRestaurantId(F.identityKeyV1,p.saverId));}
  async function pages(host,label){
   let sequence=0;const clientInstanceId='seed006-finalcap8-history-'+label+'-instance';
   const h=req('./lib/postgis_handlers.js').createPostgisSearchHandlers({database:host.authority,provider:host.provider}); const context={database:host.authority,discoveryKey:Buffer.alloc(32,71),identityKeyV1:F.identityKeyV1,identity:{authUid:null,authIsAnonymous:false},guestRestaurantWindow:true}; const transientAttempts=[]; const call=async(name,data)=>{for(let attempt=0;attempt<100;attempt++){const t=performance.now();try{return await h[name](data,context);}catch(error){if(error.code!=='unavailable')throw error;transientAttempts.push({endpoint:name,milliseconds:performance.now()-t,waitMs:200});await new Promise(resolve=>setTimeout(resolve,200));}}throw Error('Native continuation attempt bound exhausted');};
   const state=await call('startCustomerBiteSaverSearchV2',{schemaVersion:1,clientRequestId:'seed006-finalcap8-'+label+'-start',clientInstanceId,...F.center,radiusMiles:15,locationMode:'current',typedLocation:null,searchText:'',timeZone:'America/New_York',utcOffsetMinutes:-240,freshSearch:true});
   const bound=extra=>({schemaVersion:1,clientRequestId:'seed006-finalcap8-'+label+'-bound-'+(++sequence),clientInstanceId,sessionId:state.sessionId,capability:state.capability,criteriaFingerprint:state.criteriaFingerprint,...extra});
   const result={pages:[],pageTimings:[],challengeSizes:[],suppressedAnswers:[],waits:0};let cursor=null;
   for(let page=0;page<2;page++){ const pageStarted=performance.now();const attemptsBefore=transientAttempts.length;
    const request=bound({cursor,guestStateRevision:1});let response=await call('getCustomerBiteSaverSearchPageV2',request);
    for(let rounds=0;response.outcome!=='complete';rounds++){
     assert(rounds<100);
     if(response.outcome==='retryRequired'){result.waits++;response=await call('getCustomerBiteSaverSearchPageV2',request);continue;}
     assert.equal(response.outcome,'guestCheckRequired');assert(response.candidates.length>0&&response.candidates.length<=75);
     const unavailableOfferIds=response.candidates.map(c=>c.offerId).filter(id=>history.has(id));result.challengeSizes.push(response.candidates.length);result.suppressedAnswers.push(unavailableOfferIds.length);
     response=await call('continueCustomerBiteSaverGuestOfferCheckV2',bound({operationRef:response.operationRef,checkToken:response.checkToken,batchSequence:response.batchSequence,guestStateRevision:response.guestStateRevision,entireBatchEvaluated:true,unavailableOfferIds}));
    }
    assert.equal(response.result.restaurants.length,25);assert(response.result.restaurants.every(r=>!suppressedParents.has(r.restaurantId)));
    result.pageTimings.push({page,milliseconds:performance.now()-pageStarted,unavailableAttempts:transientAttempts.length-attemptsBefore});result.pages.push({ids:response.result.restaurants.map(r=>[r.restaurantId,r.offers.map(o=>o.offerId)]),hasMore:response.result.hasMore});cursor=response.result.nextCursor;
   }
   return {...result,transientAttempts};
  }
  evidence.historyCorrectedUnbatched=JSON.parse(fs.readFileSync(__dirname+'/seed-history-page-timings.json','utf8')).historyCorrectedUnbatched; const u=performance.now();evidence.historyAfter=await pages(runtime,'after-finalcap');evidence.historyAfter.elapsedMs=performance.now()-u;assert.deepEqual(evidence.historyAfter.pages,evidence.historyCorrectedUnbatched.pages);evidence.checks.push('final-cap-exact-first-and-later-page-parity-against-retained-corrected-unbatched-reference');

  const b=performance.now();evidence.fiftyThousandPlan=W.postgisSyntheticWorkloadBudget('bs-postgis-proposed006',{...plan,planId:'unapproved-50k',count:50000,maxParentsPerInvocation:2500,maxInvocations:32,maxSourceOperations:3000000,maxSourceBytes:2147483648});evidence.fiftyThousandPlan.calculationMs=performance.now()-b;
 }finally{fs.writeFileSync(__dirname+'/seed-history-finalcap.json',JSON.stringify(evidence,null,2)+'\n');await runtime.close();await db.terminate();await deleteApp(app);}
}
main().then(()=>console.log('PASS local seed/resume/bounds/source publication')).catch(e=>{console.error(e);process.exitCode=1;});
