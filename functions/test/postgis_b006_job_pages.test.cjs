'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const lib=path.resolve(process.env.BS_TRACK_LIB||path.join(__dirname,'../lib'));
const A=require(path.join(lib,'postgis_execution_approval.js')),C=require(path.join(lib,'postgis_cloudsql.js'));
function fixture({pages=3,action='prune',pending=2,throwAt=null}={}){
 const job={id:'bs-postgis-review-source',action,maxPages:pages};
 if(action==='fixture-stream')job.workload={version:1,planId:'test',offset:0,count:1,nowMs:1792252800000,operation:'seed',distribution:'mixed-national-v1',maxParentsPerInvocation:1,maxInvocations:1,maxSourceOperations:10000,maxSourceBytes:1048576};
 const configuration={syntheticOnly:true,projectId:'bitestar-isolated-review',projectNumber:'123456789',runId:'bs-postgis-review',candidateDigest:'a'.repeat(64),gate:1,allowedProjectIds:['bitestar-isolated-review'],region:'us-central1',hosted:{sql:{instanceConnectionName:'bitestar-isolated-review:us-central1:bs-postgis-review-db',database:'bs_postgis_primary',restoreDatabase:'bs_postgis_restore',schema:'public',serviceAccountEmail:'bs-postgis-review-job@bitestar-isolated-review.iam.gserviceaccount.com'},jobs:[job],snapshot:{snapshotId:'one'}}};
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),now=Date.now();
 const claims={protocolVersion:A.postgisApprovalProtocol,projectId:configuration.projectId,projectNumber:configuration.projectNumber,runId:configuration.runId,candidateDigest:configuration.candidateDigest,configDigest:A.digestPostgisConfiguration(configuration),notBeforeMs:now-1000,validUntilMs:now+3600000,cleanupUntilMs:now+7200000,allowedGates:[1,5]};
 const bytes=Buffer.from(A.canonicalPostgisApproval(claims)),approval={keyId:'test',payloadBase64:bytes.toString('base64'),signatureBase64:crypto.sign(null,bytes,privateKey).toString('base64')},trustedKeys={test:publicKey.export({type:'spki',format:'pem'})};
 const options={configuration,approval,trustedKeys,jobId:job.id,keyFile:'/unused',port:8080},trace={opens:0,closes:0,validations:0,prunes:0};
 const manifest={fence:{shards:Array.from({length:16},()=>({seq:100}))}};
 const runtime={source:{async acknowledgePublishedFence(){trace.validations++;if(trace.validations===throwAt)throw Error('validation rejected');return{ready:trace.validations>pending,validatedRows:trace.validations*64};},
 async pruneAcknowledgedEvents(store,limit){assert.equal(limit,400);trace.prunes++;return{deleted:100,prunedThrough:Array(16).fill(100)};}}};
 const filename=path.join(lib,'postgis_hosted_job_entrypoint.js'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
 const original=m.require.bind(m);m.require=name=>{
 if(name==='./postgis_hosted_entrypoint.js')return{async openApprovedHostedPostgisResources(value){trace.opens++;return{permit:A.verifyPostgisExecutionApproval(value.approval,value.trustedKeys,C.cloudSqlPostgisIdentity(value.configuration)),resources:{database:{},pool:{},identityKeyV1:Buffer.alloc(32)},async close(){trace.closes++;}};}};
 if(name==='./postgis_hosted_runtime.js')return{createHostedPostgisRuntime:()=>runtime};
 if(name==='./postgis_snapshot_gcs.js')return{GcsPostgisSnapshotStore:class{async readRecoveryManifest(){return manifest;}}};
 if(name==='./postgis_hosted_jobs.js')return{requirePostgisSyntheticBatchesComplete:async()=>{},runHostedPostgisNativeJob:async(...args)=>{trace.workload=args[5];trace.workload.authorize();return{ready:true};}};
 return original(name);};m._compile(fs.readFileSync(filename,'utf8'),filename);
 return{trace,options,run:()=>m.exports.runApprovedHostedPostgisJob(options)};
}
test('signed prune job advances bounded validation pages then prunes in the same allowance',async()=>{const f=fixture(),r=await f.run();assert.equal(r.ready,true);assert.equal(f.trace.validations,3);assert.equal(f.trace.prunes,1);assert.equal(f.trace.closes,1);});
test('signed maxPages stops before unfinished validation can prune',async()=>{const f=fixture({pages:2}),r=await f.run();assert.equal(r.ready,false);assert.equal(r.phase,'validate-recovery');assert.equal(f.trace.validations,2);assert.equal(f.trace.prunes,0);assert.equal(f.trace.closes,1);});
test('failed validation closes resources and never prunes',async()=>{const f=fixture({throwAt:2});await assert.rejects(f.run(),/validation rejected/);assert.equal(f.trace.closes,1);assert.equal(f.trace.prunes,0);});
test('fixture-stream requires provider execution identity before opening resources and forwards bounded permit checks',async()=>{
 const prior=process.env.CLOUD_RUN_EXECUTION;try{delete process.env.CLOUD_RUN_EXECUTION;const bad=fixture({action:'fixture-stream'});await assert.rejects(bad.run(),/execution identity/);assert.equal(bad.trace.opens,0);
 process.env.CLOUD_RUN_EXECUTION='bs-postgis-review-source-abc12';const good=fixture({action:'fixture-stream'});assert.equal((await good.run()).ready,true);assert.equal(good.trace.workload.invocationId,process.env.CLOUD_RUN_EXECUTION);assert(good.trace.workload.deadlineMs<=Date.now()+540000);assert.equal(good.trace.closes,1);
 }finally{if(prior===undefined)delete process.env.CLOUD_RUN_EXECUTION;else process.env.CLOUD_RUN_EXECUTION=prior;}
});
