'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const retention=require('../lib/photo_screening_retention');

test('upload adapter requests create-only save and verifies immutable existing bytes after 412',async()=>{
 const adminStorage=require('firebase-admin/storage'),original=adminStorage.getStorage;
 const bytes=Buffer.from('synthetic immutable bytes'),sha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const metadata={proof:'synthetic'},generation='9007199254740993';let writes=0,reads=0;
 adminStorage.getStorage=()=>({bucket:()=>({name:'local',file:()=>({
  save:async(content,options)=>{assert.deepEqual(content,bytes);assert.equal(options.preconditionOpts.ifGenerationMatch,0);assert.equal(options.resumable,false);writes++;throw {code:412};},
  getMetadata:async()=>[{generation,size:String(bytes.length),contentType:'image/png',metadata}],
  download:async()=>{reads++;return [bytes];},
 })})});
 try {
  const objects=require('../lib/photo_screening').screeningObjects();
  assert.equal(await objects.put('synthetic/photo.png',bytes,'image/png',metadata),generation);
  assert.equal(writes,1);assert.equal(reads,1);await objects.read('synthetic/photo.png',generation,sha);
 }finally{adminStorage.getStorage=original;}
});

test('cleanup Storage adapter preserves long decimal generation in read, delete and precondition',async()=>{
 const adminStorage=require('firebase-admin/storage'),original=adminStorage.getStorage;
 const sdk=new (require('@google-cloud/storage').Storage)({projectId:'demo-coupon-app-rules'});
 const requests=[],generation='9007199254740993';
 sdk.request=(options,callback)=>{requests.push(options);callback(null,{generation,metadata:{}},{});};
 adminStorage.getStorage=()=>({bucket:()=>sdk.bucket('demo-coupon-app-rules.appspot.com')});
 try {
  const objects=retention.screeningCleanupObjects();
  assert.equal((await objects.inspect('synthetic/photo.png',generation)).generation,generation);
  await objects.remove('synthetic/photo.png',generation);
  assert.equal(requests.length,2);
  for(const request of requests)assert.equal(request.qs.generation,generation);
  assert.equal(requests[1].qs.ifGenerationMatch,generation);
 }finally{adminStorage.getStorage=original;}
});

test('cleanup adapter treats missing exact object as absent but never hides Storage failures',async()=>{
 const adminStorage=require('firebase-admin/storage'),original=adminStorage.getStorage;
 let code=404;
 adminStorage.getStorage=()=>({bucket:()=>({name:'local',file:()=>({getMetadata:async()=>{throw {code};},delete:async()=>{throw {code};}})})});
 try {
  const objects=retention.screeningCleanupObjects();
  assert.equal(await objects.inspect('synthetic/photo.png','123'),null);
  await objects.remove('synthetic/photo.png','123');
  for(const failure of [403,412,500]){
   code=failure;await assert.rejects(objects.inspect('synthetic/photo.png','123'));
   await assert.rejects(objects.remove('synthetic/photo.png','123'));
  }
 }finally{adminStorage.getStorage=original;}
});

test('bounded scheduled export and existing finalize export call retention without replacing account deletion',async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app');
 const app=initializeApp({projectId:'demo-retention-wiring'});
 const account=require('../lib/account_deletion_finalized_media');
 const original=[retention.maintainScreeningPhotos,retention.screeningPhotoFinalized,account.accountDeletionObjectFinalizedHandler,account.createAccountDeletionFinalizedObjects];
 const calls=[],event={type:'google.cloud.storage.object.v1.finalized',data:{bucket:'synthetic'}};
 retention.maintainScreeningPhotos=async()=>{calls.push('scheduled');return 0;};
 retention.screeningPhotoFinalized=async(db,value)=>{assert.equal(value,event);calls.push('retention');};
 account.accountDeletionObjectFinalizedHandler=async(db,value)=>{assert.equal(value,event);calls.push('account');};
 account.createAccountDeletionFinalizedObjects=()=>({});
 try {
  const runtime=require('../lib/customer_bitescore_runtime'),schedule=runtime.cleanupExpiredScreeningPhotos;
  assert.equal(schedule.__endpoint.scheduleTrigger.schedule,'every 15 minutes');
  assert.equal(schedule.__endpoint.scheduleTrigger.timeZone,'UTC');
  assert.equal(schedule.__endpoint.maxInstances,1);assert.equal(schedule.__endpoint.concurrency,1);
  assert.equal(schedule.__endpoint.serviceAccountEmail,runtime.biteScoreCustomerRuntimeServiceAccount);
  await schedule.run({scheduleTime:new Date(0).toISOString()});
  await require('../lib/account_deletion_runtime').cleanupAccountDeletionFinalizedImage.run(event);
  assert.deepEqual(calls,['scheduled','account','retention']);
 }finally{
  [retention.maintainScreeningPhotos,retention.screeningPhotoFinalized,account.accountDeletionObjectFinalizedHandler,account.createAccountDeletionFinalizedObjects]=original;
  await deleteApp(app);
 }
});
