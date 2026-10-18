"use strict";
const path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.env.BS_TEST_SOURCE||'/app';
const {Pool}=require(root+'/functions/node_modules/pg');
const approval=require(root+'/functions/lib/postgis_execution_approval.js');
const diagnostic=require(root+'/functions/lib/postgis_native_diagnostic.js');
const configuration={syntheticOnly:true,projectId:'bitestar-isolated-test',projectNumber:'123456789',runId:'bs-postgis-test',candidateDigest:'a'.repeat(64),gate:1,allowedProjectIds:['bitestar-isolated-test'],region:'us-central1',hosted:{sql:{instanceConnectionName:'bitestar-isolated-test:us-central1:bs-postgis-test-db',database:'bs_postgis_diagnostic',restoreDatabase:'bs_postgis_restore',schema:'public',serviceAccountEmail:'bs-postgis-test-diag@bitestar-isolated-test.iam.gserviceaccount.com'},nativeDiagnostic:{id:'bs-postgis-test-native',action:'numerical-only',protocolVersion:diagnostic.postgisNativeDiagnosticProtocol}}};
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),now=Date.now();
const claims={protocolVersion:approval.postgisApprovalProtocol,projectId:configuration.projectId,projectNumber:configuration.projectNumber,runId:configuration.runId,candidateDigest:configuration.candidateDigest,configDigest:approval.digestPostgisConfiguration(configuration),notBeforeMs:now-1000,validUntilMs:now+3600000,cleanupUntilMs:now+7200000,allowedGates:[1,5]};
const bytes=Buffer.from(approval.canonicalPostgisApproval(claims));
const envelope={keyId:'LOCAL_TEST_EPHEMERAL_ONLY',payloadBase64:bytes.toString('base64'),signatureBase64:crypto.sign(null,bytes,privateKey).toString('base64')};
let closed=0,statements=0;
const dependencies={createConnector(){return{async getOptions(o){assert.equal(o.ipType,'PRIVATE');assert.equal(o.authType,'IAM');return{stream(){throw Error('Local fixture uses explicit injected PostgreSQL transport only');}};},close(){closed++;}};},createPool(o){const pool=new Pool({...o,stream:undefined,host:process.env.BS_TEST_HOST||'bs-cloud005-pg',port:Number(process.env.BS_TEST_PORT||5432)});const query=pool.query.bind(pool);pool.query=(...args)=>{statements++;return query(...args);};return pool;}};
(async()=>{
 const evidence=await diagnostic.runApprovedPostgisNativeDiagnostic({configuration,approval:envelope,trustedKeys:{LOCAL_TEST_EPHEMERAL_ONLY:publicKey.export({format:'pem',type:'spki'})},jobId:'bs-postgis-test-native'},dependencies);
 assert.equal(closed,1);assert.equal(evidence.numerical.missed,0);assert.equal(evidence.numerical.bridge.length,34);assert.equal(evidence.numerical.combinedBoundVectors,318);assert.equal(evidence.numerical.radiusEdgeVectors,1512);
 const role=new Pool({host:process.env.BS_TEST_HOST||'bs-cloud005-pg',port:Number(process.env.BS_TEST_PORT||5432),user:'bs-postgis-test-diag@bitestar-isolated-test.iam',database:'bs_postgis_diagnostic'});
 const denied=[];
 try{for(const text of ['SELECT * FROM diagnostic_private_canary','CREATE TABLE blocked(id integer)','CREATE TEMP TABLE blocked(id integer)']){await assert.rejects(role.query(text),e=>{assert.equal(e.code,'42501');return true;});denied.push(text.split(' ').slice(0,2).join(' '));}}finally{await role.end();}
 console.log(JSON.stringify({scope:'LOCAL_EMULATED_LINUX_ACTUAL_POSTGRESQL; injected transport, ephemeral test-only signature, not Cloud SQL/IAM evidence or execution approval',evidence,leastPrivilegeDenied:denied,cloudExecuted:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
