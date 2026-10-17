'use strict';
// Review-only branch composition test. Provider/runtime boundaries are injected;
// this is not credential, SQL, GCS, hosted or concurrency qualification.
const assert=require('node:assert/strict'),{test}=require('node:test');
const base='/Users/colesmart/dev/coupon_app/functions/lib/';
const opener=require(base+'postgis_hosted_entrypoint.js'),runtime=require(base+'postgis_hosted_runtime.js'),jobs=require(base+'postgis_hosted_jobs.js'),sql=require(base+'postgis_cloudsql.js'),gcs=require(base+'postgis_snapshot_gcs.js'),snapshot=require(base+'postgis_snapshot.js'),model=require(base+'postgis_store.js');
let calls=[],nextResults=[],failure=null,pending=false,advanceClock=false,now=1000;
const primary={name:'primary'},restore={name:'restore',async end(){calls.push(['restore.close']);}},database={};
const native={source:{async acknowledgePublishedFence(f,m,s){calls.push(['ack',f,m,s]);},async pruneAcknowledgedEvents(s,n){calls.push(['prune',s,n]);return{deleted:2};}}};
const manifest={fence:{test:'fence'}};
opener.openApprovedHostedPostgisResources=async options=>{calls.push(['open',options.configuration]);return{permit:{test:'permit'},resources:{database,pool:primary,identityKeyV1:Buffer.alloc(32)},async close(){calls.push(['close']);}};};
runtime.createHostedPostgisRuntime=()=>native;
jobs.requirePostgisSyntheticBatchesComplete=async()=>{calls.push(['pending']);if(pending)throw Error('pending');};
jobs.runHostedPostgisNativeJob=async(r,d,k,runId,job)=>{calls.push(['native',job.action]);assert.equal(r,native);assert.equal(d,database);if(failure)throw failure;if(advanceClock)now+=600000;return nextResults.shift()??{ready:false};};
sql.createCloudSqlPostgisPool=async(c,p,target)=>{calls.push(['restore.open',target]);return restore;};
gcs.GcsPostgisSnapshotStore=class{constructor(c,p){calls.push(['store',c.hosted.snapshot.snapshotId]);}async readRecoveryManifest(id){calls.push(['manifest',id]);return manifest;}};
snapshot.publishHostedPostgisSnapshot=async(p,c,s,id)=>{calls.push(['snapshot',p,id]);return{ready:true};};
snapshot.restoreHostedPostgisSnapshot=async(p,c,s,id,size)=>{calls.push(['restore.page',p,id,size]);if(failure)throw failure;return nextResults.shift()??{ready:false};};
model.PostgisReadModel=class{constructor(p,s){calls.push(['model',p,s]);}async initializeLocalSchema(){calls.push(['schema']);}};
const {runApprovedHostedPostgisJob:run}=require(base+'postgis_hosted_job_entrypoint.js');
const approval=require(base+'postgis_execution_approval.js'),crypto=require('node:crypto'),pair=crypto.generateKeyPairSync('ed25519');
const trust={review:pair.publicKey.export({type:'spki',format:'pem'})};
function reset(){calls=[];nextResults=[];failure=null;pending=false;advanceClock=false;now=1000;}
function options(action,maxPages=3,horizon=3600000){
 const configuration={syntheticOnly:true,projectId:'bitestar-isolated-review',projectNumber:'123456789',runId:'bs-postgis-review',candidateDigest:'a'.repeat(64),gate:1,allowedProjectIds:['bitestar-isolated-review'],region:'us-central1',hosted:{sql:{instanceConnectionName:'bitestar-isolated-review:us-central1:bs-postgis-review-db',database:'bs_postgis_search',restoreDatabase:'bs_postgis_restore',schema:'public',serviceAccountEmail:'bitestar-search@bitestar-isolated-review.iam.gserviceaccount.com'},epoch:'review',firestoreDatabase:'search-qualification',allowedOrigins:[],enforceAppCheck:false,snapshot:{snapshotId:'review'},jobs:[{id:'bs-postgis-review-job',action,maxPages,bootstrapId:'review',batch:{offset:0,count:1,nowMs:1,operation:'seed'}}]}};
 const now=Date.now(),claims={protocolVersion:approval.postgisApprovalProtocol,projectId:configuration.projectId,projectNumber:configuration.projectNumber,runId:configuration.runId,candidateDigest:configuration.candidateDigest,configDigest:approval.digestPostgisConfiguration(configuration),notBeforeMs:Math.max(0,now-1000),validUntilMs:now+horizon,cleanupUntilMs:now+7200000,allowedGates:[1,5]};
 const bytes=Buffer.from(approval.canonicalPostgisApproval(claims));
 return{configuration,approval:{keyId:'review',payloadBase64:bytes.toString('base64'),signatureBase64:crypto.sign(null,bytes,pair.privateKey).toString('base64')},trustedKeys:trust,keyFile:'/unused',port:8080,jobId:'bs-postgis-review-job'};
}
for(const action of ['initialize','fixture','lifecycle'])test(action+' delegates once and closes',async()=>{reset();await run(options(action));assert.equal(calls.filter(x=>x[0]==='native').length,1);assert.equal(calls.at(-1)[0],'close');});
for(const action of ['enroll','catchup'])test(action+' bounds pages and recognizes durable completion',async()=>{reset();await run(options(action));assert.equal(calls.filter(x=>x[0]==='native').length,3);reset();nextResults=[{},action==='enroll'?{phase:'complete'}:{ready:true}];await run(options(action));assert.equal(calls.filter(x=>x[0]==='native').length,2);assert.equal(calls.at(-1)[0],'close');});
test('deadline stops subsequent native page',async()=>{reset();advanceClock=true;const original=Date.now;Date.now=()=>now;try{await run(options('catchup'));assert.equal(calls.filter(x=>x[0]==='native').length,1);}finally{Date.now=original;}});
test('pending source blocks publication before store or native work and closes',async()=>{for(const action of ['enroll','catchup','snapshot','restore','prune']){reset();pending=true;await assert.rejects(run(options(action)),/pending/);assert.equal(calls.some(x=>['native','store','restore.open'].includes(x[0])),false);assert.equal(calls.at(-1)[0],'close');}});
test('snapshot forwards signed config snapshot identity to approved helper',async()=>{reset();await run(options('snapshot'));const call=calls.find(x=>x[0]==='snapshot');assert.equal(call[1],primary);assert.equal(call[2],'review');assert.equal(calls.at(-1)[0],'close');});
test('prune acknowledges actual retained manifest before one bounded deletion',async()=>{reset();await run(options('prune'));assert.deepEqual(calls.filter(x=>['manifest','ack','prune'].includes(x[0])).map(x=>x[0]),['manifest','ack','prune']);const ack=calls.find(x=>x[0]==='ack'),prune=calls.find(x=>x[0]==='prune');assert.equal(ack[1],manifest.fence);assert.equal(ack[2],manifest);assert.equal(ack[3],prune[1]);assert.equal(prune[2],100);});
test('restore uses separate target, initializes, bounds pages, and closes both pools',async()=>{reset();await run(options('restore'));assert.deepEqual(calls.find(x=>x[0]==='restore.open'),['restore.open','restore']);assert.equal(calls.filter(x=>x[0]==='schema').length,1);const pages=calls.filter(x=>x[0]==='restore.page');assert.equal(pages.length,3);for(const p of pages){assert.equal(p[1],restore);assert.equal(p[2],'review');assert.equal(p[3],75);}assert.deepEqual(calls.slice(-2).map(x=>x[0]),['restore.close','close']);});
test('work errors propagate and both opened targets close',async()=>{for(const action of ['catchup','restore']){reset();failure=Error('injected');await assert.rejects(run(options(action)),/injected/);assert.equal(calls.at(-1)[0],'close');if(action==='restore')assert.equal(calls.at(-2)[0],'restore.close');}});
test('unknown job and unbounded page counts fail before resource opening',async()=>{for(const amount of [0,65,1.5]){reset();const o=options('catchup');o.configuration.hosted.jobs[0].maxPages=amount;await assert.rejects(run(o));assert.equal(calls.length,0);}reset();const o=options('catchup');o.jobId='not-approved';await assert.rejects(run(o));assert.equal(calls.length,0);});

test('exact 600s signed startup horizon permits the bounded job',async()=>{reset();const original=Date.now;Date.now=()=>now;try{await run(options('initialize',3,600000));assert.equal(calls[0][0],'open');}finally{Date.now=original;}});
test('provider queue delay makes a previously adequate signed horizon reject before resources',async()=>{reset();const original=Date.now;Date.now=()=>now;try{const o=options('initialize',3,600000);now++;await assert.rejects(run(o),/cannot cover the full hosted job lifetime/);assert.equal(calls.length,0);}finally{Date.now=original;}});
