'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const {validateDeletionConfirmation, deletionReceiptDigest, deletionReceiptMatches, safeDeletionStatus} = require('../lib/account_deletion_contract');
const {accountDeletionPath, requireAccountWritableInStore} = require('../lib/account_deletion_guard');
const now = Date.parse('2026-09-23T05:40:00Z');
const time = now / 1000;
const receipt = randomBytes(32).toString('base64url');
const user = {uid:'fake-A', creationTime:new Date(now-1000000).toUTCString(), providerIds:['password'], disabled:false};
const session = {uid:user.uid, authTime:time, issuedAt:time, signInProvider:'password'};
const payload = {schemaVersion:1,expectedUid:user.uid,confirmation:'DELETE',receipt};
const invalid = (raw=payload,s=session,u=user) => assert.throws(()=>validateDeletionConfirmation(raw,s,u,now));
test('fresh self confirmation works without email verification',()=>assert.equal(validateDeletionConfirmation(payload,session,user,now).uid,user.uid));
for (const [name,extra] of [['UID target',{expectedUid:'fake-B'}],['arbitrary path',{path:'users/fake-B'}],['arbitrary email',{email:'b@example.test'}],['wrong confirmation',{confirmation:'yes'}],['wrong version',{schemaVersion:2}]]) test(`reject ${name}`,()=>invalid({...payload,...extra}));
test('refresh iat never substitutes for linked-provider auth_time',()=>invalid(payload,{...session,authTime:time-301}));
test('future authentication and disabled/mismatched Auth identity fail closed',()=>{
 invalid(payload,{...session,authTime:time+1});invalid(payload,session,{...user,disabled:true});invalid(payload,session,{...user,uid:'fake-B'});
});
test('truly anonymous session supports current possession without forcing a provider',()=>{
 const anonymous={...session,authTime:time-10000,signInProvider:'anonymous'};
 assert.equal(validateDeletionConfirmation(payload,anonymous,{...user,providerIds:[]},now).uid,user.uid);
 invalid(payload,anonymous,user); invalid(payload,{...anonymous,issuedAt:time-301},{...user,providerIds:[]});
});
test('receipt grants only high entropy equality and safe state exposes no personal fields',()=>{
 const digest=deletionReceiptDigest(receipt);assert.equal(digest.length,64);assert.ok(deletionReceiptMatches(receipt,digest));assert.ok(!deletionReceiptMatches(randomBytes(32).toString('base64url'),digest));
 assert.throws(()=>deletionReceiptDigest('email@example.test'));
 const status=safeDeletionStatus({operationId:'a'.repeat(64),state:'pending',reason:'billing',uid:user.uid,email:'fake@example.test'},true);
 assert.deepEqual(Object.keys(status).sort(),['schemaVersion','operationId','state','reason','receiptAccepted'].sort());
});
test('existence fence rejects malformed marker and does not accept paths as UIDs',async()=>{
 for (const uid of ['','..','x/y']) assert.throws(()=>accountDeletionPath(uid));
 await assert.rejects(requireAccountWritableInStore({getDocument:async()=>({data:{broken:true}})},user.uid));
 await requireAccountWritableInStore({getDocument:async()=>null},user.uid);
});
