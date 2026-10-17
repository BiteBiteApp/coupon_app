const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const approval=require('../lib/postgis_execution_approval.js'),sql=require('../lib/postgis_cloudsql.js');
function fixture(){
 const configuration={syntheticOnly:true,projectId:'bitestar-isolated-test',projectNumber:'123456789',runId:'bs-postgis-test',candidateDigest:'a'.repeat(64),gate:1,allowedProjectIds:['bitestar-isolated-test'],region:'us-central1',hosted:{sql:{instanceConnectionName:'bitestar-isolated-test:us-central1:bs-postgis-test-db',database:'bs_postgis_search',restoreDatabase:'bs_postgis_restore',schema:'public',serviceAccountEmail:'bitestar-search@bitestar-isolated-test.iam.gserviceaccount.com'}}};
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const expected=sql.cloudSqlPostgisIdentity(configuration),now=Date.now(),claims={protocolVersion:approval.postgisApprovalProtocol,...Object.fromEntries(['projectId','projectNumber','runId','candidateDigest','configDigest'].map(k=>[k,expected[k]])),notBeforeMs:now-1000,validUntilMs:now+60000,cleanupUntilMs:now+120000,allowedGates:[1,2,3,4,5]};const bytes=Buffer.from(approval.canonicalPostgisApproval(claims));
 const permit=approval.verifyPostgisExecutionApproval({keyId:'test',payloadBase64:bytes.toString('base64'),signatureBase64:crypto.sign(null,bytes,privateKey).toString('base64')},{test:publicKey.export({type:'spki',format:'pem'})},expected);
 const trace={connector:0,close:0,end:0,queries:[],released:[],options:null};
 let failQuery=false;
 const raw={totalCount:0,idleCount:0,waitingCount:0,on(){},async connect(){return{async query(text){trace.queries.push(text);if(failQuery)throw Error('private-sensitive-provider-detail');return{rows:[{database:trace.options.database,username:trace.options.user}],rowCount:1};},release(destroy){trace.released.push(destroy);}};},async end(){trace.end++;}};
 const dependencies={createConnector(){trace.connector++;return{async getOptions(options){trace.connectorOptions=options;return{stream(){}};},close(){trace.close++;}};},createPool(options){trace.options=options;return raw;}};
 return{configuration,permit,expected,trace,dependencies,raw,failQuery(){failQuery=true;}};
}
module.exports={fixture};
test('unapproved/changed configuration never initializes connector or driver',async()=>{
 const f=fixture();for(const config of [{...f.configuration,projectId:'coupon-app-29446'},{...f.configuration,allowedProjectIds:[]},{...f.configuration,hosted:{sql:{...f.configuration.hosted.sql,instanceConnectionName:'attacker:us-central1:other'}}},{...f.configuration,candidateDigest:'b'.repeat(64)}])await assert.rejects(sql.createCloudSqlPostgisPool(config,f.permit,'primary',f.dependencies));
 await assert.rejects(sql.createCloudSqlPostgisPool(f.configuration,{...f.permit},'primary',f.dependencies));assert.equal(f.trace.connector,0);
});
test('mandatory encrypted PRIVATE IAM connector, bounded pool and exact identity probe',async()=>{
 const f=fixture(),pool=await sql.createCloudSqlPostgisPool(f.configuration,f.permit,'primary',f.dependencies);
 assert.deepEqual(f.trace.connectorOptions,{instanceConnectionName:f.configuration.hosted.sql.instanceConnectionName,ipType:'PRIVATE',authType:'IAM'});
 assert.equal(f.trace.options.user,'bitestar-search@bitestar-isolated-test.iam');
 for(const field of ['host','password','ssl','port'])assert.equal(field in f.trace.options,false);
 assert.equal(f.trace.options.max,4);assert.equal(f.trace.options.connectionTimeoutMillis,2000);assert.equal(f.trace.options.statement_timeout,5000);assert.equal(f.trace.options.query_timeout,5500);assert.equal(f.trace.options.maxLifetimeSeconds,3000);
 sql.requireCloudSqlPostgisPool(pool,f.expected);
 assert.throws(()=>sql.requireCloudSqlPostgisPool(f.raw,f.expected));assert.throws(()=>sql.requireCloudSqlPostgisPool(pool,{...f.expected,database:'bs_postgis_other'}));assert.throws(()=>sql.requireCloudSqlPostgisPool(pool,{...f.expected,nowMs:Date.now()}));
 await pool.end();await pool.end();assert.equal(f.trace.close,1);assert.equal(f.trace.end,1);assert.throws(()=>sql.requireCloudSqlPostgisPool(pool,f.expected));
});
test('initial connector rejection is safe and does not invoke problematic rejected-cache close',async()=>{
 const f=fixture();f.dependencies.createConnector=()=>({getOptions:async()=>{throw Error('secret');},close(){throw Error('must not close rejected SDK cache');}});
 await assert.rejects(sql.createCloudSqlPostgisPool(f.configuration,f.permit,'primary',f.dependencies),/Invalid or unavailable approved/);
 assert.equal(f.trace.options,null);
});
test('pool/identity failures close initialized connector without leaking provider errors',async()=>{
 const f=fixture();f.dependencies.createPool=()=>{throw Error('secret');};await assert.rejects(sql.createCloudSqlPostgisPool(f.configuration,f.permit,'primary',f.dependencies),/Invalid or unavailable approved/);assert.equal(f.trace.close,1);
 const g=fixture();g.raw.connect=async()=>({query:async()=>({rows:[{database:'wrong',username:'wrong'}],rowCount:1}),release(){}});await assert.rejects(sql.createCloudSqlPostgisPool(g.configuration,g.permit,'primary',g.dependencies));assert.equal(g.trace.close,1);
});
test('failed queries destroy the leased connection; close destroys active leases once',async()=>{
 const f=fixture(),pool=await sql.createCloudSqlPostgisPool(f.configuration,f.permit,'primary',f.dependencies);f.failQuery();await assert.rejects(pool.query('SELECT 1'));assert.equal(f.trace.released.at(-1),true);
 const client=await pool.connect();await pool.end();const count=f.trace.released.length;client.release();assert.equal(f.trace.released.length,count);assert.equal(f.trace.released.at(-1),true);await assert.rejects(pool.connect());
});
test('restore uses only the separately approved database and the same IAM transport',async()=>{
 const f=fixture(),pool=await sql.createCloudSqlPostgisPool(f.configuration,f.permit,'restore',f.dependencies);assert.equal(f.trace.options.database,'bs_postgis_restore');sql.requireCloudSqlPostgisPool(pool,sql.cloudSqlPostgisIdentity(f.configuration,'restore'));await pool.end();
});
test('caller mutation while credentials initialize cannot change the approved login target',async()=>{
 const f=fixture();f.dependencies.createConnector=()=>({async getOptions(){f.configuration.hosted.sql.serviceAccountEmail='attacker-login@bitestar-isolated-test.iam.gserviceaccount.com';f.configuration.hosted.sql.database='bs_postgis_attacker';return{stream(){}};},close(){f.trace.close++;}});
 const pool=await sql.createCloudSqlPostgisPool(f.configuration,f.permit,'primary',f.dependencies);
 assert.equal(f.trace.options.user,'bitestar-search@bitestar-isolated-test.iam');assert.equal(f.trace.options.database,'bs_postgis_search');sql.requireCloudSqlPostgisPool(pool,f.expected);await pool.end();
});
test('timed-out initialization closes a later successful connector without creating a pool',async t=>{
 const f=fixture();let finish;f.dependencies.createConnector=()=>({getOptions:()=>new Promise(resolve=>finish=resolve),close(){f.trace.close++;}});
 t.mock.timers.enable({apis:['setTimeout']});const pending=sql.createCloudSqlPostgisPool(f.configuration,f.permit,'primary',f.dependencies);
 const rejected=assert.rejects(pending,/Invalid or unavailable/);t.mock.timers.tick(10001);await rejected;finish({stream(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.trace.close,1);assert.equal(f.trace.options,null);
});
test('late acquired client is destroyed after the acquisition deadline',async t=>{
 const f=fixture(),pool=await sql.createCloudSqlPostgisPool(f.configuration,f.permit,'primary',f.dependencies);let finish,released;
 f.raw.connect=()=>new Promise(resolve=>finish=resolve);t.mock.timers.enable({apis:['setTimeout']});const pending=pool.connect(),rejected=assert.rejects(pending,/timed out/);t.mock.timers.tick(2001);await rejected;finish({query:async()=>({rows:[],rowCount:0}),release:value=>released=value});await new Promise(resolve=>setImmediate(resolve));assert.equal(released,true);await pool.end();
});
