'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const lib=path.resolve(__dirname,process.env.BS_TRACK_LIB||'../lib');
const S=require(path.join(lib,'postgis_source.js')),R=require(path.join(lib,'postgis_source_recovery.js'));
const {LocalPostgisSnapshotReader}=require(path.join(lib,'postgis_snapshot.js'));
const fixture=require('./fixtures/postgis_gate0.cjs');
async function setup(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'b006-hash-'));
 const docs=fixture.dataset({scoreParents:50,saverParents:3,includeCases:false}).documents;
 const rows=docs.map(d=>{const payload={collection:d.collection,indexDocumentId:d.id,projection:S.encodePostgisProjection(d.collection,d.id,d.data)};
 return {payload,digest:S.postgisSourceDigest(payload)};}).sort((a,b)=>R.postgisRecoveryIdentity(a)<R.postgisRecoveryIdentity(b)?-1:1);
 const shards=Array.from({length:16},(_,shard)=>{const events=rows.filter(r=>S.postgisSourceShardFor(r.payload.collection,r.payload.indexDocumentId)===shard);
 return {seq:events.length,partitions:S.postgisSourceManifest(events.map((row,i)=>({...row,shard,seq:i+1})))};});
 const fence={protocolVersion:S.postgisSourceVersion,epoch:'checkpoint-test',enrolled:true,shards},manifest=R.createPostgisRecoveryManifest('checkpoint',fence,rows);
 const reader=new LocalPostgisSnapshotReader(dir);const content=rows.map(r=>JSON.stringify(r)+'\n').join('');
 await fs.writeFile(reader.path('checkpoint','manifest.json'),JSON.stringify(manifest),{mode:0o400});
 await fs.writeFile(reader.path('checkpoint','rows.jsonl'),content,{mode:0o400});
 await fs.writeFile(reader.path('checkpoint','offsets.json'),JSON.stringify({rowCount:rows.length,dataBytes:Buffer.byteLength(content),offsets:[{identity:R.postgisRecoveryIdentity(rows[0]),offset:0}]}),{mode:0o400});
 return {dir,reader,manifest,rows,cleanup:()=>fs.rm(dir,{recursive:true,force:true})};
}
test('bounded recovery validation resumes across every page and process boundary with the original digest',async()=>{
 const f=await setup();try{let state=null,pages=0;while(!state?.complete){const previous=state?.count??0;
 state=await R.advancePostgisRecoveryValidation(new LocalPostgisSnapshotReader(f.dir),f.manifest,state,[1,63,64][pages%3]);
 assert(state.count-previous<=64);state=JSON.parse(JSON.stringify(state));assert(++pages<100);}
 assert.equal(state.count,f.rows.length);R.validateCompletePostgisRecoveryCheckpoint(f.manifest,state);
 assert.deepEqual(await R.advancePostgisRecoveryValidation(f.reader,f.manifest,state),state);
 const corrupted=structuredClone(state);corrupted.hash.words[0]=(corrupted.hash.words[0]^1)>>>0;
 assert.throws(()=>R.validateCompletePostgisRecoveryCheckpoint(f.manifest,corrupted),/checkpoint/);
 }finally{await f.cleanup();}
});
test('partial hash corruption never publishes a successful validation',async()=>{
 const f=await setup();try{let state=await R.advancePostgisRecoveryValidation(f.reader,f.manifest,null,1);
 state=structuredClone(state);state.hash.words[0]=(state.hash.words[0]^1)>>>0;
 await assert.rejects(async()=>{for(let i=0;i<100&&!state.complete;i++)state=await R.advancePostgisRecoveryValidation(f.reader,f.manifest,state,64);},/corrupt/);
 }finally{await f.cleanup();}
});
test('changed readonly file identity, missing files and writable artifacts cannot reuse proof',async()=>{
 for(const mode of ['replace','delete','writable']){const f=await setup();try{
 const state=await R.advancePostgisRecoveryValidation(f.reader,f.manifest,null,1),file=f.reader.path('checkpoint','rows.jsonl');
 if(mode==='replace'){const bytes=await fs.readFile(file);await fs.unlink(file);await fs.writeFile(file,bytes,{mode:0o400});}
 if(mode==='delete')await fs.unlink(file);if(mode==='writable')await fs.chmod(file,0o600);
 await assert.rejects(R.advancePostgisRecoveryValidation(new LocalPostgisSnapshotReader(f.dir),f.manifest,state,64),/changed|ENOENT|mutable/);
 }finally{await f.cleanup();}}
});
test('arbitrary reader success claims cannot supply immutable proof',async()=>{
 const f=await setup();try{const reader={readRecoveryManifest:f.reader.readRecoveryManifest.bind(f.reader),readRecoveryRows:f.reader.readRecoveryRows.bind(f.reader),immutable:true};
 await assert.rejects(R.advancePostgisRecoveryValidation(reader,f.manifest,null),/verified immutable/);
 }finally{await f.cleanup();}
});
test('GCS reusable validation requires actual locked retention and exact-generation bytes; ordinary reads remain available',async()=>{
 const f=await setup();try{
 const {makeGcsSnapshotFixture}=require('./support/postgis_gcs_fixture.cjs');const g=makeGcsSnapshotFixture({snapshotId:'checkpoint'});
 let store=g.createStore();await store.publish(f.reader,f.manifest);
 await assert.rejects(R.advancePostgisRecoveryValidation(store,f.manifest,null),/locked.*retention/);
 assert.deepEqual(await store.readRecoveryManifest('checkpoint'),f.manifest);
 let until=new Date(Date.now()+2*86400000).toISOString(),locked=true;
 g.state.before=async request=>{
  for(const object of g.objects.values())object.metadata.retentionExpirationTime=until;
  if(request.method==='GET'&&!new URL(request.url).pathname.includes('/o/'))return g.response(200,{name:g.config.hosted.snapshot.bucket,
   projectNumber:g.state.bucketProject,timeCreated:g.state.bucketCreatedAt,retentionPolicy:{isLocked:locked,retentionPeriod:'172800'}});
 };
 store=g.createStore();let state=null;for(let i=0;i<100&&!state?.complete;i++)state=await R.advancePostgisRecoveryValidation(store,f.manifest,state,64);
 assert(state.complete);const before=g.requests.length;
 await R.advancePostgisRecoveryValidation(g.createStore(),f.manifest,state,64);
 assert(!g.requests.slice(before).some(r=>r.url.includes('rows-')&&r.url.includes('alt=media')),'completed proof must not replay chunk data');
 locked=false;await assert.rejects(R.advancePostgisRecoveryValidation(g.createStore(),f.manifest,state),/locked.*retention/);
 locked=true;until=new Date(Date.now()+1000).toISOString();await assert.rejects(R.advancePostgisRecoveryValidation(g.createStore(),f.manifest,state),/retention.*horizon/);
 until=new Date(Date.now()+2*86400000).toISOString();const name=[...g.objects.keys()].find(n=>n.endsWith('manifest.json'));g.objects.delete(name);
 await assert.rejects(R.advancePostgisRecoveryValidation(g.createStore(),f.manifest,state),/unavailable/);
 }finally{await f.cleanup();}
});
