'use strict';
// Report-only local work counters. No service, credentials, cloud or SQL access.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../selected-source'),lib=path.join(__dirname,'review-c-lib');
const S=require(lib+'/postgis_source.js'),R=require(lib+'/postgis_source_recovery.js');
const {LocalPostgisSnapshotReader}=require(lib+'/postgis_snapshot.js');
const F=require(lib+'/postgis_source_firestore.js'),fixture=require(root+'/functions/test/fixtures/postgis_gate0.cjs');
const eventId=(shard,seq)=>`s${String(shard).padStart(2,'0')}_${String(seq).padStart(16,'0')}`;
function injectedDatabase(manifest,validation){
 const projectId='demo-bs-postgis-b006-scaling',events=new Set(),control={protocolVersion:S.postgisSourceVersion,writerVersion:S.postgisSourceVersion,epoch:manifest.fence.epoch,projectId,enrolled:true};
 const retained={epoch:manifest.fence.epoch,fence:manifest.fence,recoveryManifest:manifest,validation,prunedThrough:Array(16).fill(0)};
 for(let s=0;s<16;s++)for(let n=1;n<=manifest.fence.shards[s].seq+3;n++)events.add(eventId(s,n));
 const counters={transactions:0,metadataDocumentReads:0,eventDocumentReads:0,eventDeletes:0,checkpointWrites:0,maxEventReadsPerTransaction:0,maxWritesPerTransaction:0};
 const snapshot=ref=>({data:()=>ref.path===F.postgisSourceRetentionPath?retained:control,get:k=>(ref.path===F.postgisSourceRetentionPath?retained:control)[k]});
 const db={projectId,doc(p){const ref={path:p,get:async()=>{counters.metadataDocumentReads++;return snapshot(ref);}};return ref;},
  collection(p){assert.equal(p,F.postgisSourceEventsCollection);return {orderBy(){return this;},startAfter(v){this.after=v;return this;},endAt(v){this.end=v;return this;},limit(v){this.count=v;return this;}};},
  async runTransaction(callback){let writes=0;counters.transactions++;const result=await callback({
   getAll:async(...refs)=>{counters.metadataDocumentReads+=refs.length;return refs.map(snapshot);},
   get:async q=>{const names=[...events].filter(id=>id>q.after&&id<=q.end).sort().slice(0,q.count);counters.eventDocumentReads+=names.length;counters.maxEventReadsPerTransaction=Math.max(counters.maxEventReadsPerTransaction,names.length);return {size:names.length,docs:names.map(id=>({ref:{id}}))};},
   delete:ref=>{assert(events.delete(ref.id));writes++;counters.eventDeletes++;},
   update:(ref,patch)=>{assert.equal(ref.path,F.postgisSourceRetentionPath);Object.assign(retained,patch);writes++;counters.checkpointWrites++;}
  });counters.maxWritesPerTransaction=Math.max(counters.maxWritesPerTransaction,writes);return result;}};
 return {db,counters,events,projectId};
}
(async()=>{
 const records=[];
 for(const count of [128,1024,8192]){
  const directory=path.join(__dirname,'work-scaling',String(count));await fs.mkdir(directory,{recursive:true});
  const docs=fixture.dataset({scoreParents:count,saverParents:0,dishesPerRestaurant:0,includeCases:false}).documents;
  const rows=docs.map(d=>{const payload={collection:d.collection,indexDocumentId:d.id,projection:S.encodePostgisProjection(d.collection,d.id,d.data)};return {payload,digest:S.postgisSourceDigest(payload)};}).sort((a,b)=>R.postgisRecoveryIdentity(a)<R.postgisRecoveryIdentity(b)?-1:1);
  assert.equal(rows.length,count);
  const shards=Array.from({length:16},(_,shard)=>{const events=rows.filter(r=>S.postgisSourceShardFor(r.payload.collection,r.payload.indexDocumentId)===shard);return {seq:events.length,partitions:S.postgisSourceManifest(events.map((row,i)=>({...row,shard,seq:i+1})))};});
  const fence={protocolVersion:S.postgisSourceVersion,epoch:'work-scaling',enrolled:true,shards};
  const manifest=R.createPostgisRecoveryManifest('scale-'+count,fence,rows),reader=new LocalPostgisSnapshotReader(directory),offsets=[];let bytes=0;
  const lines=rows.map((row,i)=>{if(i%500===0)offsets.push({identity:R.postgisRecoveryIdentity(row),offset:bytes});const line=JSON.stringify(row)+'\n';bytes+=Buffer.byteLength(line);return line;});
  for(const [extension,content] of [['rows.jsonl',lines.join('')],['manifest.json',JSON.stringify(manifest)],['offsets.json',JSON.stringify({rowCount:count,dataBytes:bytes,offsets})]])await fs.writeFile(reader.path(manifest.snapshotId,extension),content,{mode:0o400,flag:'wx'});
  const original=reader.readRecoveryRows.bind(reader);const counters={rowCalls:0,returnedRows:0,returnedSerializedBytes:0,maxRows:0};
  reader.readRecoveryRows=async(...args)=>{const page=await original(...args);counters.rowCalls++;counters.returnedRows+=page.length;counters.returnedSerializedBytes+=page.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row)+'\n'),0);counters.maxRows=Math.max(counters.maxRows,page.length);return page;};
  let state=null,validationPages=0;const start=performance.now();
  while(!state?.complete){state=await R.advancePostgisRecoveryValidation(reader,manifest,state,64);state=JSON.parse(JSON.stringify(state));validationPages++;}
  const validationMs=performance.now()-start;assert.equal(counters.returnedRows,count);assert.equal(counters.maxRows,64);
  const prior={...counters};const injected=injectedDatabase(manifest,state),source=F.createFirestorePostgisSource(injected.db,{epoch:fence.epoch,projectId:injected.projectId,allowedProjectIds:[injected.projectId]});
  let deleted=0,pruneCalls=0;for(;;){const result=await source.pruneAcknowledgedEvents(reader,400);pruneCalls++;deleted+=result.deleted;if(!result.deleted)break;assert(pruneCalls<100);}
  assert.equal(deleted,count);assert.equal(injected.events.size,48);assert.deepEqual(counters,prior);assert(injected.counters.maxEventReadsPerTransaction<=400);assert(injected.counters.maxWritesPerTransaction<=401);
  records.push({snapshotRows:count,snapshotBytes:bytes,validationPages,validationMs,validationWork:prior,pruneEvents:deleted,pruneCalls,pruneSnapshotRowReads:counters.rowCalls-prior.rowCalls,pruneReturnedRowBytes:counters.returnedSerializedBytes-prior.returnedSerializedBytes,pruneDatabaseWork:injected.counters,preservedAboveFenceEvents:injected.events.size,artifactDirectory:directory});
 }
 const report={scope:'Actual local readonly files, native projection builders, exact manifest validation and production prune method with injected bounded Firestore adapter; no cloud/SQL/emulator I/O.',validationPageLimit:64,pruneEventLimit:400,hostedJobMaxPagesMaximum:64,hostedWorkDeadlineSeconds:540,records,limits:['Returned serialized bytes are not total filesystem read traffic; sparse reader may scan at most its preceding 500-row offset segment.','Injected Firestore counters validate operation scaling and safety boundaries, not provider latency, cost or transaction retries.','Real emulator deletion, missing/gap/epoch and fresh SQL restore are separately qualified by retained actual recovery tests.','Exact multiples of 64 require a final empty validation page to prove EOF.']};
 await fs.writeFile(path.join(__dirname,'recovery-work-scaling.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
