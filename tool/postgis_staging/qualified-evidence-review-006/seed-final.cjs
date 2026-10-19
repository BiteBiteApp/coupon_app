"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),{performance}=require('node:perf_hooks'),{createRequire}=require('node:module');
const root=__dirname+'/selected-source/functions',req=createRequire(root+'/package.json');
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore,Query,DocumentReference}=req('firebase-admin/firestore'),{getAuth}=req('firebase-admin/auth');
const {createLocalPostgisStagingRuntime}=req('./lib/postgis_staging_runtime.js');
const W=req('./lib/postgis_synthetic_workload.js'),F=req('./test/fixtures/postgis_gate0.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS,undefined);
const projectId='demo-bs-postgis-c006-final',runId='bs-postgis-c006-final',nowMs=Date.parse('2026-10-19T20:00:00Z');
const plan={version:1,planId:'local-500-final',offset:0,count:500,nowMs,operation:'seed',distribution:'mixed-national-v1',maxParentsPerInvocation:250,maxInvocations:6,maxSourceOperations:3000000,maxSourceBytes:2147483648};
const evidence={kind:'real-local-raw-Firestore-native-projections-journal-SQL',hosted:false,billingEvidence:false,plan,attempts:[],checks:[]};
const counts={directWrites:0,directDeletes:0,requestedDocuments:0,queryReturnedDocuments:0,transactionCalls:0,transactionAttempts:0,scheduledWrites:0,scheduledDeletes:0,commits:0};
function instrument(db){
 for(const k of ['set','update','create','delete']){const o=DocumentReference.prototype[k];DocumentReference.prototype[k]=function(...a){counts[k==='delete'?'directDeletes':'directWrites']++;return o.apply(this,a);};}

 const getAll=db.getAll.bind(db);db.getAll=(...a)=>{counts.requestedDocuments+=a.filter(v=>v instanceof DocumentReference).length;return getAll(...a);};
 const originalQuery=Query.prototype.get;Query.prototype.get=async function(...a){const r=await originalQuery.apply(this,a);counts.queryReturnedDocuments+=r.docs.length;return r;};
 function writes(t){for(const k of ['set','update','create','delete']){const o=t[k].bind(t);t[k]=(...a)=>{counts[k==='delete'?'scheduledDeletes':'scheduledWrites']++;return o(...a);};}return t;}
 const batch=db.batch.bind(db);db.batch=(...a)=>{const b=writes(batch(...a)),commit=b.commit.bind(b);b.commit=(...args)=>{counts.commits++;return commit(...args);};return b;};
 const tx=db.runTransaction.bind(db),wrapped=new WeakSet();db.runTransaction=(fn,...a)=>{counts.transactionCalls++;return tx(t=>{counts.transactionAttempts++;if(!wrapped.has(t)){wrapped.add(t);writes(t);for(const k of ['get','getAll']){const o=t[k].bind(t);t[k]=async(...args)=>{counts.requestedDocuments+=args.filter(v=>v instanceof DocumentReference).length;const r=await o(...args);if(r?.docs)counts.queryReturnedDocuments+=r.docs.length;return r;};}}return fn(t);},...a);};
}
async function main(){
 const app=initializeApp({projectId},'corrections006-seed'),db=getFirestore(app);
 const runtime=createLocalPostgisStagingRuntime({database:db,auth:getAuth(app),projectId,allowedProjectIds:[projectId],epoch:'corrections006-seed',sql:{host:'127.0.0.1',port:55441,database:'bsgate0_c006_seed_final',user:'bsgate0'},discoveryKey:Buffer.alloc(32,71),identityKeyV1:F.identityKeyV1,scoreCursorRootKey:Buffer.alloc(32,73),guestRestaurantWindow:true});
 try{
  await runtime.initialize();instrument(db);evidence.budget=W.postgisSyntheticWorkloadBudget(runId,plan);
  let authCalls=0;const start=performance.now();
  await assert.rejects(()=>W.runPostgisSyntheticWorkload(db,runtime.maintenanceDatabase,F.identityKeyV1,runId,plan,{invocationId:'interrupted-0',deadlineMs:Date.now()+300000,authorize(){if(++authCalls===15)throw Error('Intentional local interruption');}}),/Intentional local interruption/);
  evidence.attempts.push({kind:'intentional-interruption',milliseconds:performance.now()-start,counts:{...counts}});
  await assert.rejects(()=>W.runPostgisSyntheticWorkload(db,runtime.maintenanceDatabase,F.identityKeyV1,runId,{...plan,planId:'conflicting-plan'},{invocationId:'forbidden-0',deadlineMs:Date.now()+300000}),/different synthetic batch/);
  evidence.checks.push('different-plan-refused-while-incomplete');
  let result;
  for(let i=0;i<5;i++){
   const t=performance.now(),before={...counts};result=await W.runPostgisSyntheticWorkload(db,runtime.maintenanceDatabase,F.identityKeyV1,runId,plan,{invocationId:'resume-'+i,deadlineMs:Date.now()+300000});
   evidence.attempts.push({kind:'resume',result,milliseconds:performance.now()-t,counts:Object.fromEntries(Object.keys(counts).map(k=>[k,counts[k]-before[k]]))});
   if(result.ready)break;
   await assert.rejects(()=>W.runPostgisSyntheticWorkload(db,runtime.maintenanceDatabase,F.identityKeyV1,runId,plan,{invocationId:'resume-'+i,deadlineMs:Date.now()+300000}),/already attempted/);
  }
  assert(result.ready);evidence.seedCounts={...counts};
  const accounts=await db.collection('restaurant_accounts').get(),catalog=await db.collection('bitescore_restaurants').get();
  assert.equal(accounts.size,500);assert.equal(catalog.size,500);assert(accounts.docs.every(d=>d.id.startsWith(runId+'-saver-')));assert(catalog.docs.every(d=>d.id.startsWith(runId+'-score-')));
  evidence.checks.push('500-separate-saver-and-500-score-identities','interrupted-parent-replayed-and-completed');
  const scenarios={},raw={parents:1000,coupons:0,dishes:0,aggregates:0,sourceBytes:0,historyOrdinals:0};
  for(let i=0;i<500;i++){const p=W.postgisSyntheticParent(runId,i,nowMs);for(const[k,v]of Object.entries(p.scenario))if(v)scenarios[k]=(scenarios[k]??0)+1;raw.coupons+=p.couponIds.length;raw.dishes+=p.dishIds.length;raw.aggregates+=p.dishIds.length;raw.sourceBytes+=Buffer.byteLength(JSON.stringify(p.rows));raw.historyOrdinals+=p.historyOfferOrdinals.length;}
  evidence.raw=raw;evidence.scenarios=scenarios;
  let enrollment=await runtime.source.beginEnrollment('corrections006-seed');for(let i=0;enrollment.phase!=='complete';i++){assert(i<100);enrollment=await runtime.source.advanceEnrollment('corrections006-seed',100);}
  let pub;const t=performance.now();for(let i=0;i<100;i++){pub=await runtime.model.catchUp(100);if(pub.ready)break;}assert(pub.ready);evidence.publication={...pub,milliseconds:performance.now()-t};
  evidence.sqlCounts=(await runtime.pool.query('SELECT space,kind,count(*)::int AS count FROM entities WHERE valid_to=9223372036854775807 GROUP BY space,kind ORDER BY space,kind')).rows;
  evidence.audit=await runtime.model.auditSourceManifest();
  const identity=req('./lib/customer_bitesaver_public_identity.js');
  const history=new Set(),suppressedParents=new Set();
  for(let i=0;i<500;i++){const p=W.postgisSyntheticParent(runId,i,nowMs);for(const c of p.historyOfferOrdinals)history.add(identity.customerBiteSaverOpaqueOfferId(F.identityKeyV1,p.saverId,'coupon',p.couponIds[c]));if(p.scenario.historyCohort)suppressedParents.add(identity.customerBiteSaverOpaqueRestaurantId(F.identityKeyV1,p.saverId));}
  const baselineReq=createRequire(__dirname+'/baseline-source/functions/package.json');
  const baseline=baselineReq('./lib/postgis_staging_runtime.js').createLocalPostgisStagingRuntime({database:db,auth:getAuth(app),projectId,allowedProjectIds:[projectId],epoch:'corrections006-seed',sql:{host:'127.0.0.1',port:55441,database:'bsgate0_c006_seed_final',user:'bsgate0'},discoveryKey:Buffer.alloc(32,71),identityKeyV1:F.identityKeyV1,scoreCursorRootKey:Buffer.alloc(32,73),guestRestaurantWindow:true});
  async function pages(host,label){
   let sequence=0;const clientInstanceId='seed006-history-'+label+'-instance';
   const call=(name,data)=>host.invoke(name,{data});
   const state=await call('startCustomerBiteSaverSearchV2',{schemaVersion:1,clientRequestId:'seed006-'+label+'-start',clientInstanceId,...F.center,radiusMiles:15,locationMode:'current',typedLocation:null,searchText:'',timeZone:'America/New_York',utcOffsetMinutes:-240,freshSearch:true});
   const bound=extra=>({schemaVersion:1,clientRequestId:'seed006-'+label+'-bound-'+(++sequence),clientInstanceId,sessionId:state.sessionId,capability:state.capability,criteriaFingerprint:state.criteriaFingerprint,...extra});
   const result={pages:[],challengeSizes:[],suppressedAnswers:[],waits:0};let cursor=null;
   for(let page=0;page<2;page++){
    const request=bound({cursor,guestStateRevision:1});let response=await call('getCustomerBiteSaverSearchPageV2',request);
    for(let rounds=0;response.outcome!=='complete';rounds++){
     assert(rounds<100);
     if(response.outcome==='retryRequired'){result.waits++;response=await call('getCustomerBiteSaverSearchPageV2',request);continue;}
     assert.equal(response.outcome,'guestCheckRequired');assert(response.candidates.length>0&&response.candidates.length<=75);
     const unavailableOfferIds=response.candidates.map(c=>c.offerId).filter(id=>history.has(id));result.challengeSizes.push(response.candidates.length);result.suppressedAnswers.push(unavailableOfferIds.length);
     response=await call('continueCustomerBiteSaverGuestOfferCheckV2',bound({operationRef:response.operationRef,checkToken:response.checkToken,batchSequence:response.batchSequence,guestStateRevision:response.guestStateRevision,entireBatchEvaluated:true,unavailableOfferIds}));
    }
    assert.equal(response.result.restaurants.length,25);assert(response.result.restaurants.every(r=>!suppressedParents.has(r.restaurantId)));
    result.pages.push({ids:response.result.restaurants.map(r=>[r.restaurantId,r.offers.map(o=>o.offerId)]),hasMore:response.result.hasMore});cursor=response.result.nextCursor;
   }
   return result;
  }
  try{const t=performance.now();evidence.historyBaseline=await pages(baseline,'before');evidence.historyBaseline.elapsedMs=performance.now()-t;const u=performance.now();evidence.historyAfter=await pages(runtime,'after');evidence.historyAfter.elapsedMs=performance.now()-u;assert.deepEqual(evidence.historyAfter.pages,evidence.historyBaseline.pages);evidence.checks.push('real-native-SQL-long-history-prefix-first-and-later-page-parity');}finally{await baseline.close();}

  const b=performance.now();evidence.fiftyThousandPlan=W.postgisSyntheticWorkloadBudget('bs-postgis-proposed006',{...plan,planId:'unapproved-50k',count:50000,maxParentsPerInvocation:2500,maxInvocations:32});evidence.fiftyThousandPlan.calculationMs=performance.now()-b;
 }finally{fs.writeFileSync(__dirname+'/seed-final-evidence.json',JSON.stringify(evidence,null,2)+'\n');await runtime.close();await db.terminate();await deleteApp(app);}
}
main().then(()=>console.log('PASS local seed/resume/bounds/source publication')).catch(e=>{console.error(e);process.exitCode=1;});
