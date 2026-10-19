"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),{performance}=require('node:perf_hooks'),{createRequire}=require('node:module');
const root=__dirname+'/baseline-source/functions',req=createRequire(root+'/package.json');
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
 const runtime=createLocalPostgisStagingRuntime({database:db,auth:getAuth(app),projectId,allowedProjectIds:[projectId],epoch:'corrections006-seed',sql:{host:'127.0.0.1',port:55441,database:'bsgate0_c007_seed',user:'bsgate0'},discoveryKey:Buffer.alloc(32,71),identityKeyV1:F.identityKeyV1,scoreCursorRootKey:Buffer.alloc(32,73),guestRestaurantWindow:true});
 try{
  await runtime.initialize();instrument(db);evidence.budget=W.postgisSyntheticWorkloadBudget(runId,plan);
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
 }finally{fs.writeFileSync(__dirname+'/seed-007-evidence.json',JSON.stringify(evidence,null,2)+'\n');await runtime.close();await db.terminate();await deleteApp(app);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
