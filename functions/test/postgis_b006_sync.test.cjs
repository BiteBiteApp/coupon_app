'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const path=require('node:path'),fs=require('node:fs');
const lib=path.resolve(process.env.BS_TRACK_LIB || path.join(__dirname,'../lib'));
const S=require(path.join(lib,'postgis_source.js')),{PostgisReadModel,createLocalPostgisPool}=require(path.join(lib,'postgis_store.js'));
const F=require('./fixtures/postgis_gate0.cjs');
class Source {
 constructor(docs){this.events=Array.from({length:16},()=>[]);this.reads=0;for(const d of docs)this.append(d);}
 append(d){const payload={collection:d.collection,indexDocumentId:d.id,projection:S.encodePostgisProjection(d.collection,d.id,d.data)};
 const shard=S.postgisSourceShardFor(d.collection,d.id),event={shard,seq:this.events[shard].length+1,payload,digest:S.postgisSourceDigest(payload)};
 this.events[shard].push(event);return event;}
 async readFence(){this.reads++;return {protocolVersion:S.postgisSourceVersion,epoch:'b006-sync',enrolled:true,
 shards:this.events.map(e=>({seq:e.length,partitions:S.postgisSourceManifest(e)}))};}
 async readEvents(shard,after,through,limit){return this.events[shard].filter(e=>e.seq>after&&e.seq<=through).slice(0,limit);}
}
async function ready(m){for(let i=0;i<2000;i++){const r=await m.catchUp(75);if(r.ready)return r;}throw Error('bounded catchup exceeded');}
test('B006 finite admission, transactional incremental manifest and independent audit', {skip:process.env.BS_POSTGIS_SQL_TEST!=='1',timeout:120000},async t=>{
 const p=createLocalPostgisPool({host:'127.0.0.1',port:55441,database:'bsgate0_b006_sync',user:'bsgate0'});
 const fixture=F.dataset({saverParents:200,scoreParents:200}),s=new Source(fixture.documents);
 const evidence={dataset:fixture.documents.length,measurements:{publicationLockMs:[],metadataRows:[]},tests:[]};
 const measured={query:p.query.bind(p),end:p.end.bind(p),async connect(){const c=await p.connect();let locked=null;
 return {release:()=>c.release(),async query(sql,params){const result=await c.query(sql,params);
 if(sql.includes('FROM publication WHERE singleton FOR UPDATE'))locked=performance.now();
 if(sql.includes('FROM source_manifest_partitions'))evidence.measurements.metadataRows.push(result.rowCount);
 if(sql==='COMMIT'&&locked!==null){evidence.measurements.publicationLockMs.push(performance.now()-locked);locked=null;}return result;}};}};
 const m=new PostgisReadModel(measured,s);
 try{
 await p.query('DROP SCHEMA public CASCADE');await p.query('CREATE SCHEMA public');await m.initializeLocalSchema();
 await ready(m);let a=await m.auditSourceManifest();assert.equal(a.heads,fixture.documents.length);assert.equal(a.partitions,48);
 await t.test('one finite target survives process restart and unrelated continuous writes',async()=>{
 const d=fixture.documents.find(d=>d.collection==='restaurant_search_index');s.append({...d,data:{...d.data,displayName:'first update'}});
 const request={pinId:'b006-finite-target-00001',expiresAtMs:Date.now()+600000};
 await assert.rejects(m.pinRevision(request),/captured|watermark|catch/);
 const target=(await p.query('SELECT target FROM admission_targets WHERE id=$1',[request.pinId])).rows[0].target;
 const reads=s.reads;
 // Restart model and change the live target on every admission attempt.
 const restarted=new PostgisReadModel(measured,s);for(let i=0;i<3;i++){
 s.append({...d,data:{...d.data,displayName:`continuous-${i}`}});
 await assert.rejects(restarted.pinRevision(request),/captured|watermark|catch/);
 }assert.equal(s.reads,reads,'retry must not capture a newer source fence');
 // Capture a worker target, then continue appending while it completes.
 await restarted.catchUp(75);
 for(let i=0;i<2000;i++){s.append({...d,data:{...d.data,displayName:`more-${i}`}});const r=await restarted.catchUp(75);if(r.ready)break;if(i===1999)throw Error('no publication');}
 const revision=await restarted.pinRevision(request);assert(BigInt(revision.revision)>0n);
 const published=(await p.query('SELECT fence FROM publication WHERE singleton')).rows[0].fence;
 assert(target.shards.every((v,i)=>v.seq<=Number(published[i])));
 s.append({...d,data:{...d.data,displayName:'beyond pinned'}});assert.deepEqual(await restarted.pinRevision(request),revision);
 await assert.rejects(restarted.pinRevision({...request,expiresAtMs:request.expiresAtMs+1}),/changed|expiry/);
 evidence.tests.push('finite target persisted and strict source target covered');
 });
 await ready(m);await m.auditSourceManifest();
 await t.test('duplicates, deletes, recreate and rollback maintain exact manifest',async()=>{
 const d=fixture.documents[0];s.append(d);await ready(m);const before=await m.auditSourceManifest();
 s.append({...d,data:null});await ready(m);assert.equal((await m.auditSourceManifest()).heads,before.heads-1);
 s.append(d);await ready(m);assert.equal((await m.auditSourceManifest()).heads,before.heads);
 const c=await p.connect();try{await c.query('BEGIN');await c.query('DELETE FROM source_heads WHERE index_path=$1',[`${d.collection}/${d.id}`]);await c.query('ROLLBACK');}finally{c.release();}
 assert.equal((await m.auditSourceManifest()).heads,before.heads);
 });
 await t.test('audit detects metadata corruption independently',async()=>{
 await p.query("UPDATE source_manifest_partitions SET count=count+1 WHERE shard=0 AND collection='restaurant_search_index'");
 await assert.rejects(m.auditSourceManifest(),/manifest/i);
 await p.query("UPDATE source_manifest_partitions SET count=count-1 WHERE shard=0 AND collection='restaurant_search_index'");await m.auditSourceManifest();
 });
 await t.test('publication aggregates fixed48 while full audit remains explicit',async()=>{
 const start=performance.now();const audit=await m.auditSourceManifest();evidence.measurements.auditMs=performance.now()-start;
 const sql=fs.readFileSync(path.join(__dirname,'../src/postgis_store.ts'),'utf8');
 const publishing=sql.slice(sql.indexOf('const actual ='),sql.indexOf('const actual =')+600);
 assert(publishing.includes('source_manifest_partitions'));assert(!publishing.includes('GROUP BY'));
 evidence.measurements.partitionRows=(await p.query('SELECT count(*)::int AS n FROM source_manifest_partitions')).rows[0].n;
 evidence.measurements.heads=audit.heads;
 const plans=await p.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT shard,collection,count::int,xor::text FROM source_manifest_partitions');evidence.metadataPlan=plans.rows[0]['QUERY PLAN'];
 });
 if(process.env.BS_TRACK_REPORT)fs.writeFileSync(path.join(process.env.BS_TRACK_REPORT,'sync-evidence.json'),JSON.stringify(evidence,null,2));
 }finally{await p.end();}
});
