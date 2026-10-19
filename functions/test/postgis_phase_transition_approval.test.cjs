const {test}=require('node:test'), assert=require('node:assert/strict'),crypto=require('node:crypto');
const path=require('node:path');
const api=require(path.resolve(process.env.POSTGIS_TEST_LIB||path.join(__dirname,'../lib'),'postgis_phase_transition_approval.js'));
function fixture(){
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),trust={test:publicKey.export({format:'pem',type:'spki'})};
 const claims={protocolVersion:'bitestar.postgis-phase-transition.v1',projectId:'bitestar-isolated-test',projectNumber:'123456789',runId:'bs-postgis-test',priorCandidateDigest:'a'.repeat(64),priorConfigDigest:'b'.repeat(64),nextCandidateDigest:'c'.repeat(64),nextConfigDigest:'d'.repeat(64),nextApprovalDigest:'e'.repeat(64),evidenceDigest:'f'.repeat(64),firstBillableAtMs:1000,deadlineMs:100000,fromPhase:'diagnostic',toPhase:'serving',sequence:1,notBeforeMs:2000,validUntilMs:90000};
 const {protocolVersion,notBeforeMs,validUntilMs,...identity}=claims,expected={...identity,purpose:'phase-transition',nowMs:3000};
 const sign=(value=claims,text=api.canonicalPostgisPhaseTransition(value))=>({keyId:'test',payloadBase64:Buffer.from(text).toString('base64'),signatureBase64:crypto.sign(null,Buffer.from(text),privateKey).toString('base64')});
 return{claims,expected,trust,sign};
}
test('separate genuine Ed25519 phase approval binds both artifacts, evidence and original clock',()=>{
 const f=fixture();assert.deepEqual(api.verifyPostgisPhaseTransitionApproval(f.sign(),f.trust,f.expected),f.claims);
 for(const key of Object.keys(f.expected).filter(k=>!['nowMs','purpose'].includes(k))){assert.throws(()=>api.verifyPostgisPhaseTransitionApproval(f.sign(),f.trust,{...f.expected,[key]:'wrong'}),key);}
});
test('forged/noncanonical/expired/out-of-order/production and new-timer approvals fail closed',()=>{
 const f=fixture();for(const change of [{sequence:2},{toPhase:'diagnostic'},{projectId:'coupon-app-29446'},{validUntilMs:100001},{notBeforeMs:999},{deadlineMs:259201001}])assert.throws(()=>api.verifyPostgisPhaseTransitionApproval(f.sign({...f.claims,...change}),f.trust,f.expected));
 for(const change of [{nowMs:1999},{nowMs:90000},{purpose:'execute'}])assert.throws(()=>api.verifyPostgisPhaseTransitionApproval(f.sign(),f.trust,{...f.expected,...change}));
 for(const envelope of [{...f.sign(),signatureBase64:Buffer.alloc(64).toString('base64')},{...f.sign(),keyId:'other'},f.sign(f.claims,JSON.stringify(f.claims)),f.sign({...f.claims,extra:true})])assert.throws(()=>api.verifyPostgisPhaseTransitionApproval(envelope,f.trust,f.expected));
});
test('offline shared CLI dispatches only separately signed phase claims and keeps trust outside input',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
 const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'postgis-phase-public-'));
 try{const keys=path.join(dir,'public-trust.json');fs.writeFileSync(keys,JSON.stringify(f.trust));
  const cli=path.resolve(__dirname,'../../tool/postgis_staging/verify-approval.cjs');
  const run=(approval,expected=f.expected)=>cp.spawnSync(process.execPath,[cli,keys],{input:JSON.stringify({approval,expected}),encoding:'utf8',timeout:5000});
  const valid=run(f.sign());assert.equal(valid.status,0,valid.stderr);assert.deepEqual(JSON.parse(valid.stdout),{verified:true,claims:f.claims});
  const wrong=run(f.sign(),{...f.expected,evidenceDigest:'0'.repeat(64)});assert.equal(wrong.status,1);assert.deepEqual(JSON.parse(wrong.stdout),{verified:false,error:'approval_rejected'});
 }finally{fs.rmSync(dir,{recursive:true});}
});
