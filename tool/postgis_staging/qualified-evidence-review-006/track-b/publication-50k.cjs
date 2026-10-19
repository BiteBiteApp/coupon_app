'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{performance}=require('node:perf_hooks');
const base='/Users/colesmart/.codex/reports/BS-BITESTAR-POSTGIS-REVIEW-CORRECTIONS-006-20261019/selected-source/functions';
const {Pool}=require(base+'/node_modules/pg'),S=require(base+'/lib-b006/postgis_source.js');
const {PostgisReadModel,createLocalPostgisPool}=require(base+'/lib-b006/postgis_store.js');
const sourcePool=new Pool({host:'127.0.0.1',port:55441,user:'bsgate0',database:'bsgate0_query006',max:1});
const p=createLocalPostgisPool({host:'127.0.0.1',port:55441,user:'bsgate0',database:'bsgate0_b006_restore'});
const partitions=Array.from({length:16},S.emptyPostgisSourceShard),events=Array.from({length:16},()=>[]);
let epoch='b006-publication-50k',baseline=[],example=null,count=0;
const source={async readFence(){return structuredClone({protocolVersion:S.postgisSourceVersion,epoch,enrolled:true,shards:partitions});},
 async readEvents(shard,after,through,limit){return events[shard].filter(e=>e.seq>after&&e.seq<=through).slice(0,limit);}};
const evidence={kind:'native-projection-derived-snapshot-fixture',cloud:false,sourceTransport:'synthetic-finite-fence-events',
 sourceCopyReadOnlyDatabase:'bsgate0_query006',ownedDatabase:'bsgate0_b006_restore',baselineHeadCount:0,lockHolds:[],lockWaits:[],readerMs:[],admissionMs:[],ingestionMs:[],metadataRows:[]};
const measured={query:p.query.bind(p),end:p.end.bind(p),async connect(){const c=await p.connect();let lock=null,phase=null;
 return {release:()=>c.release(),async query(sql,args){let before=performance.now();const result=await c.query(sql,args);
 if(sql.includes('FROM publication WHERE singleton FOR UPDATE')){lock=performance.now();phase='ingestion';evidence.lockWaits.push(lock-before);}
 if(sql==='SELECT shard,collection,count::int,xor::text FROM source_manifest_partitions'){phase='publication';evidence.metadataRows.push(result.rowCount);}
 if(sql==='COMMIT'&&lock!==null){evidence.lockHolds.push({phase,ms:performance.now()-lock});lock=null;}return result;}};}};
const model=new PostgisReadModel(measured,source);
(async()=>{try{
 await p.query('DROP SCHEMA public CASCADE');await p.query('CREATE SCHEMA public');await model.initializeLocalSchema();
 let cursor=['',''];const loaded=performance.now();
 while(true){const rows=(await sourcePool.query(`SELECT to_jsonb(e)||jsonb_build_object('valid_from','1','valid_to',valid_to::text,'geo',ST_AsHEXEWKB(geo::geometry)) AS entity
 FROM entities e WHERE kind='restaurant' AND valid_to=9223372036854775807 AND id LIKE 'query006-%' AND (space,id)>($1,$2)
 ORDER BY space,id LIMIT 500`,cursor)).rows.map(r=>r.entity);if(!rows.length)break;
 const heads=rows.map(e=>{const [collection,...rest]=e.index_path.split('/');const id=rest.join('/');const payload={collection,indexDocumentId:id,projection:e.projection};
 const digest=S.postgisSourceDigest(payload),shard=S.postgisSourceShardFor(collection,id),part=partitions[shard].partitions[collection];
 partitions[shard]={seq:partitions[shard].seq+1,partitions:{...partitions[shard].partitions,[collection]:{count:part.count+1,xor:S.postgisXorDigest(part.xor,digest)}}};
 if(!example&&e.space==='score')example={payload,digest,shard};return {index_path:e.index_path,shard,payload,digest};});
 const c=await p.connect();try{await c.query('BEGIN');await c.query('INSERT INTO entities SELECT * FROM jsonb_populate_recordset(NULL::entities,$1::jsonb)',[JSON.stringify(rows)]);
 await c.query('INSERT INTO source_heads SELECT * FROM jsonb_populate_recordset(NULL::source_heads,$1::jsonb)',[JSON.stringify(heads)]);await c.query('COMMIT');}
 catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 count+=rows.length;cursor=[rows.at(-1).space,rows.at(-1).id];
 }
 assert(count>=50000);baseline=partitions.map(s=>s.seq);const fence=await source.readFence();
 await p.query('INSERT INTO revisions(revision,fence,source_manifest) VALUES(1,$1,$2)',[JSON.stringify(baseline),fence]);
 await p.query('UPDATE publication SET revision=1,fence=$1',[JSON.stringify(baseline)]);
 await p.query("UPDATE ingestion_progress SET fence=$1,target=NULL,epoch=$2,state='ready',failure=NULL",[JSON.stringify(baseline),epoch]);await p.query('UPDATE bootstrap SET ready=true');
 evidence.baselineHeadCount=count;evidence.loadMs=performance.now()-loaded;
 let before=performance.now();evidence.audit=await model.auditSourceManifest();evidence.fullAuditMs=performance.now()-before;
 evidence.fullAuditPlan=(await p.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT shard,payload->>'collection',count(*),bit_xor(('x'||digest)::bit(256)) FROM source_heads GROUP BY shard,payload->>'collection'`)).rows[0]['QUERY PLAN'];
 evidence.metadataPlan=(await p.query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT shard,collection,count::int,xor::text FROM source_manifest_partitions')).rows[0]['QUERY PLAN'];
 let old=example,done=false;
 function append(i){const payload=structuredClone(example.payload);payload.projection.customerPublicProjection.displayName=`Synthetic publication update ${i}`;
 const digest=S.postgisSourceDigest(payload),shard=example.shard,part=partitions[shard].partitions[payload.collection];
 partitions[shard]={seq:partitions[shard].seq+1,partitions:{...partitions[shard].partitions,[payload.collection]:{count:part.count,xor:S.postgisXorDigest(S.postgisXorDigest(part.xor,old.digest),digest)}}};
 events[shard].push({payload,digest,shard,seq:partitions[shard].seq});old={payload,digest,shard};}
 const expiry=Date.now()+600000;await model.pinRevision({pinId:'b006-large-reader-pin-00001',expiresAtMs:expiry});
 const reader=(async()=>{while(!done){const start=performance.now();await model.withPinnedRevision('1',expiry,async c=>{await c.query('SELECT id FROM entities WHERE space=$1 AND kind=$2 AND id=$3',['score','restaurant',example.payload.projection.sourceDocumentId]);});evidence.readerMs.push(performance.now()-start);await new Promise(r=>setTimeout(r,2));}})();
 for(let i=0;i<40;i++){
 append(i);const request={pinId:`b006-large-admission-${String(i).padStart(5,'0')}`,expiresAtMs:expiry};
 const start=performance.now();await assert.rejects(model.pinRevision(request),/captured/);
 const began=performance.now();let result;do{result=await model.catchUp(75);}while(!result.ready);evidence.ingestionMs.push(performance.now()-began);
 await model.pinRevision(request);evidence.admissionMs.push(performance.now()-start);
 }
 done=true;await reader;evidence.finalAudit=await model.auditSourceManifest();assert.equal(evidence.finalAudit.heads,count);assert(evidence.metadataRows.every(n=>n===48));
 for(const key of ['readerMs','admissionMs','ingestionMs','lockWaits']){const rows=[...evidence[key]].sort((a,b)=>a-b);evidence[key+'Summary']={n:rows.length,p50:rows[Math.floor(rows.length*.5)],p95:rows[Math.floor(rows.length*.95)],max:rows.at(-1)};}
 const holds=evidence.lockHolds.filter(x=>x.phase==='publication').map(x=>x.ms).sort((a,b)=>a-b);evidence.publicationHoldSummary={n:holds.length,p50:holds[Math.floor(holds.length*.5)],p95:holds[Math.floor(holds.length*.95)],max:holds.at(-1)};
 fs.writeFileSync('/Users/colesmart/.codex/reports/BS-BITESTAR-POSTGIS-REVIEW-CORRECTIONS-006-20261019/track-b/publication-50k.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({heads:count,fullAuditMs:evidence.fullAuditMs,publicationHold:evidence.publicationHoldSummary,reader:evidence.readerMsSummary,admission:evidence.admissionMsSummary}));
 }finally{await sourcePool.end();await p.end();}})().catch(e=>{console.error(e);process.exitCode=1;});
