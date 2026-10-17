const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const enabled=process.env.BS_POSTGIS_HOSTED_SOURCE_TEST==='1';
test('controlled synthetic job exercises raw Firestore -> native maintenance -> atomic journal, interruption and tombstones',{skip:!enabled},async t=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS,undefined);
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const F=require('../lib/postgis_source_firestore.js'),M=require('../lib/search_index_maintenance.js'),J=require('../lib/postgis_hosted_jobs.js');
 const projectId='demo-bs-postgis-hosted-'+crypto.randomBytes(4).toString('hex'),app=initializeApp({projectId},projectId),db=getFirestore(app);
 const config={projectId,allowedProjectIds:[projectId],epoch:'hosted-job-fixture'},source=F.createFirestorePostgisSource(db,config),maintenance=M.createFirestoreSearchIndexDatabase(db,{postgisSource:config});
 const key=Buffer.alloc(32,11),runId='bs-postgis-job-test',batch={offset:0,count:2,nowMs:Date.now(),operation:'seed'};
 try{
 await source.initialize();await J.writePostgisSyntheticBatch(db,maintenance,key,runId,batch);
 await J.requirePostgisSyntheticBatchesComplete(db,runId);
 const heads=await db.collection(F.postgisSourceHeadsCollection).get();assert.equal(heads.size,8);
 const before=await source.readFence();await J.writePostgisSyntheticBatch(db,maintenance,key,runId,batch);assert.deepEqual(await source.readFence(),before);
 let enrollment;for(let i=0;i<5;i++){enrollment=await source.advanceEnrollment('fixture',100);if(enrollment.phase==='complete')break;}assert.equal(enrollment.phase,'complete');
 const edit={...batch,count:1,nowMs:batch.nowMs+1000,operation:'edit-offer'};await J.writePostgisSyntheticBatch(db,maintenance,key,runId,edit);assert.ok((await source.readFence()).shards.reduce((n,s)=>n+s.seq,0)>before.shards.reduce((n,s)=>n+s.seq,0));
 await J.writePostgisSyntheticBatch(db,maintenance,key,runId,{...edit,operation:'delete-offer'});
 const events=await db.collection(F.postgisSourceEventsCollection).get();assert.ok(events.docs.some(d=>d.get('payload.projection')===null));
 const broken={...batch,offset:5,count:1};const failing={...maintenance,runTransaction:async()=>{throw Error('injected interruption');}};
 await assert.rejects(J.writePostgisSyntheticBatch(db,failing,key,runId,broken));await assert.rejects(J.requirePostgisSyntheticBatchesComplete(db,runId));
 await assert.rejects(J.writePostgisSyntheticBatch(db,maintenance,key,runId,{...broken,offset:6}),/different synthetic batch/);
 await J.writePostgisSyntheticBatch(db,maintenance,key,runId,broken);await J.requirePostgisSyntheticBatchesComplete(db,runId);
 await J.writePostgisSyntheticBatch(db,maintenance,key,runId,{...edit,operation:'hide-parent'});
 const account=await db.doc(`restaurant_accounts/${runId}-saver-0`).get();assert.equal(account.get('adminHidden'),true);
 }finally{await db.terminate();await deleteApp(app);}
});
