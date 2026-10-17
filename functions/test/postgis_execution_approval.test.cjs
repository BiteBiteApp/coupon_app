const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const api=require('../lib/postgis_execution_approval.js');
function fixture(){
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const trust={test:publicKey.export({format:'pem',type:'spki'})};
 const claims={protocolVersion:api.postgisApprovalProtocol,projectId:'bitestar-isolated-test',projectNumber:'123456789',runId:'bs-postgis-test',candidateDigest:'a'.repeat(64),configDigest:'b'.repeat(64),notBeforeMs:1000,validUntilMs:100000,cleanupUntilMs:200000,allowedGates:[1,2,3,4,5]};
 const expected={projectId:claims.projectId,projectNumber:claims.projectNumber,runId:claims.runId,candidateDigest:claims.candidateDigest,configDigest:claims.configDigest,gate:1,nowMs:2000};
 const sign=(value=claims,text=api.canonicalPostgisApproval(value))=>({keyId:'test',payloadBase64:Buffer.from(text).toString('base64'),signatureBase64:crypto.sign(null,Buffer.from(text),privateKey).toString('base64')});
 return{claims,expected,trust,sign};
}
module.exports={fixture};
test('authentic canonical Ed25519 approval creates a non-forgeable immutable permit',()=>{
 const f=fixture(),p=api.verifyPostgisExecutionApproval(f.sign(),f.trust,f.expected);
 assert.deepEqual({...p},f.claims);assert.ok(Object.isFrozen(p.allowedGates));
 api.requirePostgisExecutionPermit(p,f.expected);
 assert.throws(()=>api.requirePostgisExecutionPermit({...p},f.expected));
});
test('signature, key, canonical bytes and exact schemas fail closed',()=>{
 const f=fixture(),good=f.sign();
 for(const value of [{...good,keyId:'unknown'},{...good,signatureBase64:Buffer.alloc(64).toString('base64')},{...good,payloadBase64:good.payloadBase64+'='},{...good,trust:f.trust},f.sign(f.claims,JSON.stringify(f.claims)),f.sign({...f.claims,extra:true})])assert.throws(()=>api.verifyPostgisExecutionApproval(value,f.trust,f.expected));
});
test('project, run, exact candidate/config digest, gates and lifetime bind the permit',()=>{
 const f=fixture();for(const key of ['projectId','projectNumber','runId','candidateDigest','configDigest'])assert.throws(()=>api.verifyPostgisExecutionApproval(f.sign(),f.trust,{...f.expected,[key]:'wrong'}));
 for(const change of [{nowMs:999},{nowMs:100000},{gate:0},{gate:6},{purpose:'other'}])assert.throws(()=>api.verifyPostgisExecutionApproval(f.sign(),f.trust,{...f.expected,...change}));
 for(const change of [{projectId:'coupon-app-29446'},{projectId:'demo-bs-postgis-test'},{allowedGates:[2,1]},{allowedGates:[1,1]},{validUntilMs:1000+72*60*60*1000+1},{cleanupUntilMs:100000+7*24*60*60*1000+1}])assert.throws(()=>api.verifyPostgisExecutionApproval(f.sign({...f.claims,...change}),f.trust,f.expected));
});
test('expired execution can only retain signed bounded gate5 cleanup authority',()=>{
 const f=fixture(),expected={...f.expected,gate:5,purpose:'cleanup',nowMs:150000};
 const p=api.verifyPostgisExecutionApproval(f.sign(),f.trust,expected);api.requirePostgisExecutionPermit(p,expected);
 for(const change of [{purpose:'execute'},{gate:1},{nowMs:200000}])assert.throws(()=>api.requirePostgisExecutionPermit(p,{...expected,...change}));
});
test('optional early cost checkpoint requires exactly signed literal100',()=>{
 const f=fixture();assert.equal(api.verifyPostgisExecutionApproval(f.sign({...f.claims,costCheckpointUsd:100}),f.trust,f.expected).costCheckpointUsd,100);
 assert.throws(()=>api.verifyPostgisExecutionApproval(f.sign({...f.claims,costCheckpointUsd:101}),f.trust,f.expected));
});
test('offline CLI uses a separate trusted file; tampered approvals emit only a safe error',()=>{
 const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'postgis-approval-'));try{
 const trust=path.join(dir,'trust.json');fs.writeFileSync(trust,JSON.stringify(f.trust));
 const cli=path.resolve(__dirname,'../../tool/postgis_staging/verify-approval.cjs');
 const run=approval=>cp.spawnSync(process.execPath,[cli,trust],{input:JSON.stringify({approval,expected:f.expected}),encoding:'utf8',timeout:5000});
 assert.equal(JSON.parse(run(f.sign()).stdout).verified,true);
 const rejected=run({...f.sign(),keyId:'unknown'});assert.equal(rejected.status,1);assert.deepEqual(JSON.parse(rejected.stdout),{verified:false,error:'approval_rejected'});
 }finally{fs.rmSync(dir,{recursive:true});}
});
test('full configuration canonicalization includes lexically sorted numeric-looking keys',()=>{
 const value={'2':{z:3,a:2},'10':['quoted"',true,null],a:1};
 const canonical='{"10":["quoted\\\"",true,null],"2":{"a":2,"z":3},"a":1}';
 assert.equal(api.digestPostgisConfiguration(value),crypto.createHash('sha256').update(canonical).digest('hex'));
 for(const value of [{x:0.1},{x:Infinity},{x:Number.MAX_SAFE_INTEGER+1},{x:'é'},{'':1},{x:undefined},{x:new Date()}])assert.throws(()=>api.digestPostgisConfiguration(value));
 const result=cp.spawnSync('python3',['-c','import sys,json,hashlib; print(hashlib.sha256(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(\",\",\":\"),ensure_ascii=True).encode()).hexdigest())'],{input:JSON.stringify(value),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr??String(result.error));assert.equal(result.stdout.trim(),api.digestPostgisConfiguration(value));
});
