'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const here=__dirname, selected=path.join(here,'../selected-source/functions');
const F=require(selected+'/test/fixtures/postgis_gate0.cjs');
const base=process.env.BS_QUERY_LIB||path.join(here,'baseline/lib');
const S=require(base+'/postgis_source.js'),Q=require(base+'/postgis_query.js');
const {createLocalPostgisPool,PostgisReadModel}=require(base+'/postgis_store.js');
class Source{
 constructor(docs){this.events=Array.from({length:16},()=>[]);for(const d of docs){const payload={collection:d.collection,indexDocumentId:d.id,projection:S.encodePostgisProjection(d.collection,d.id,d.data)},shard=S.postgisSourceShardFor(d.collection,d.id);this.events[shard].push({shard,seq:this.events[shard].length+1,payload,digest:S.postgisSourceDigest(payload)});}}
 async readFence(){return{protocolVersion:S.postgisSourceVersion,epoch:'track-a-real-baseline-006',enrolled:true,shards:this.events.map(events=>({seq:events.length,partitions:S.postgisSourceManifest(events)}))};}
 async readEvents(shard,after,through,limit){return this.events[shard].filter(e=>e.seq>after&&e.seq<=through).slice(0,limit);}
}
(async()=>{
 const fixture=F.dataset({saverParents:35,scoreParents:30,includeCases:false}), pool=createLocalPostgisPool({host:'127.0.0.1',port:55441,database:'bsgate0_query006',user:'bsgate0'}), model=new PostgisReadModel(pool,new Source(fixture.documents));
 const evidence={kind:'actual local PostgreSQL/PostGIS selector baseline; real runtime guard; synthetic event transport',startedAt:new Date().toISOString(),runtime:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch},queryHash:crypto.createHash('sha256').update(fs.readFileSync(base+'/postgis_query.js')).digest('hex'),fixture:fixture.manifest,measurements:[]};
 try{
 assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,'bsgate0_query006');
 await model.initializeLocalSchema();let revision;
 for(let i=0;i<1000;i++){const r=await model.catchUp(75);if(r.ready){revision=r.revision;break;}}assert(revision);
 evidence.server=(await pool.query('SELECT version(),postgis_full_version()')).rows[0];
 const criteria={space:'saver',kind:'restaurant',center:F.center,radiusMiles:15,text:'',typedLocation:null,timeZone:'America/New_York',locationMode:'typed'};
 for(const repeated of [true,false]){
 const counts={sqlStatements:0,candidateStatements:0,offerProofStatements:0,returnedRows:0,returnedJsonBytes:0};
 const measured={async query(q,args){counts.sqlStatements++;if(typeof q==='object')counts.candidateStatements++;else counts.offerProofStatements++;const r=await pool.query(q,args);counts.returnedRows+=r.rows.length;counts.returnedJsonBytes+=Buffer.byteLength(JSON.stringify(r.rows));return r;}};
 const ids=[],metrics=[],begin=performance.now();let boundary=null;
 for(let i=0;i<(repeated?26:1);i++){const r=await Q.select(measured,{criteria,revision,membership_ms:F.now.getTime()},boundary,{size:repeated?1:26});assert.equal(r.partial,false);ids.push(...r.items.map(r=>r.id));boundary=r.boundary;metrics.push(r.metrics);}
 evidence.measurements.push({mode:repeated?'26 separate one-row selects':'one bounded 26-row select',ids,counts,elapsedMs:performance.now()-begin,metrics});
 }
 assert.deepEqual(evidence.measurements[0].ids,evidence.measurements[1].ids);assert.equal(evidence.measurements[0].ids.length,26);
 evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(here,'real-query-baseline.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence.measurements.map(({mode,counts,elapsedMs})=>({mode,counts,elapsedMs})),null,2));
 }finally{await pool.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
