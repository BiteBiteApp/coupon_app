const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const enabled=process.env.BS_POSTGIS_HOSTED_SOURCE_TEST==='1';
test('real emulator lease refuses concurrent writers and resumes only the same plan after an injected lost-process lease',{skip:!enabled},async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS,undefined);
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const lib=process.env.POSTGIS_TEST_LIB||path.join(__dirname,'../lib');
 const F=require(path.join(lib,'postgis_source_firestore.js')),M=require(path.join(lib,'search_index_maintenance.js')),W=require(path.join(lib,'postgis_synthetic_workload.js'));
 const projectId='demo-bs-workload-'+crypto.randomBytes(4).toString('hex'),app=initializeApp({projectId},projectId),db=getFirestore(app);
 const config={projectId,allowedProjectIds:[projectId],epoch:'synthetic-lease-test'},source=F.createFirestorePostgisSource(db,config),maintenance=M.createFirestoreSearchIndexDatabase(db,{postgisSource:config});
 const runId='bs-postgis-lease-test',key=Buffer.alloc(32,19);let now=Date.now();
 const plan={version:1,planId:'lease-plan',offset:1,count:2,nowMs:now,operation:'seed',distribution:'mixed-national-v1',maxParentsPerInvocation:2,maxInvocations:4,maxSourceOperations:3000000,maxSourceBytes:2147483648};
 const options=id=>({invocationId:id,deadlineMs:now+540000,now:()=>now});
 try{
  await source.initialize();let enteredResolve,release;
  const entered=new Promise(resolve=>enteredResolve=resolve),held=new Promise(resolve=>release=resolve);
  let first=true;const heldMaintenance={...maintenance,runTransaction:async operation=>{if(first){first=false;enteredResolve();await held;}return maintenance.runTransaction(operation);}};
  const running=W.runPostgisSyntheticWorkload(db,heldMaintenance,key,runId,plan,options('first-execution'));
  await entered;
  await assert.rejects(W.runPostgisSyntheticWorkload(db,maintenance,key,runId,plan,options('overlapping-execution')),/writer lease/);
  release();assert.equal((await running).ready,true);
  const second={...plan,planId:'interrupted-plan',offset:10,count:1};let lost=false;
  const fail={...maintenance,runTransaction:async()=>{lost=true;throw Error('injected process loss before native journal');}};
  await assert.rejects(W.runPostgisSyntheticWorkload(db,fail,key,runId,second,{...options('lost-execution'),deadlineMs:now+1000,
   authorize:()=>{if(lost)throw Error('injected unavailable process: no finally release');}}));
  assert.equal((await db.doc('private_postgis_fixture_control/owner').get()).get('activeUntilMs'),now+600000);
  await assert.rejects(W.runPostgisSyntheticWorkload(db,maintenance,key,runId,{...second,planId:'overtaking-plan'},options('different-execution')),/different synthetic batch/);
  now+=61000;
  await assert.rejects(W.runPostgisSyntheticWorkload(db,maintenance,key,runId,second,options('early-resume')),/writer lease/);
  now+=539001;
  assert.equal((await W.runPostgisSyntheticWorkload(db,maintenance,key,runId,second,options('after-platform-lifetime'))).ready,true);
  const marker=await db.doc('private_postgis_fixture_batches/'+W.validatePostgisSyntheticWorkload(runId,second)).get();
  assert.deepEqual(marker.get('invocationIds'),['lost-execution','after-platform-lifetime']);
  assert.equal(marker.get('next'),11);
  assert.ok((await source.readFence()).shards.some(s=>s.seq>0));
 }finally{await db.terminate();await deleteApp(app);}
});
