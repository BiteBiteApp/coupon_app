'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const fixturePath=path.join(__dirname,'customer_bitesaver_search_handlers.test.js'),fixture=new Module(fixturePath,module);
fixture.filename=fixturePath;fixture.paths=Module._nodeModulePaths(__dirname);const actual=Module.createRequire(fixturePath);
fixture.require=id=>id==='node:test'?()=>undefined:actual(id);
fixture._compile(fs.readFileSync(fixturePath,'utf8')+'\nmodule.exports.boundary={restaurantWindowFixture,finishRestaurantWindow,opaqueOfferId,guestAnswerRequest};',fixturePath);
const F=fixture.exports.boundary,C=require('../lib/customer_bitesaver_search_contract.js');
const {exactCustomerBiteSaverDistanceMiles,canonicalRestaurantGeohash}=require('../lib/restaurant_geo_helpers.js');
const {createQueryFingerprint}=require('../lib/query_fingerprint.js');
const sourcePath=require.resolve('../lib/customer_bitesaver_search_session.js'),source=new Module(sourcePath,module);
source.filename=sourcePath;source.paths=Module._nodeModulePaths(path.dirname(sourcePath));
source._compile(fs.readFileSync(sourcePath,'utf8')+'\nmodule.exports.testBoundary=guestCheckBoundaryFingerprint;',sourcePath);
const fingerprint=source.exports.testBoundary;
function progress(distance){const row={sortTuple:[1,distance,'name','id']};return{kind:'restaurantPage',windowVersion:1,outerBoundary:[1,distance,'name','id'],currentRestaurant:row,readyRestaurants:[row],pendingRestaurants:[row],resultSourceExhausted:false};}
test('integer-only guest progress keeps the existing fingerprint bytes',()=>{
 for(const n of [0,1,30]){const p=progress(n);assert.equal(fingerprint(p),createQueryFingerprint({kind:p.kind,progress:p}));}
 const p={kind:'offerPage',scanBoundary:[0,'date','id']};assert.equal(fingerprint(p),createQueryFingerprint({kind:p.kind,progress:p}));
});
test('each permitted distance field is lossless, bounded and fingerprint-sensitive',()=>{
 const next=Buffer.alloc(8);next.writeDoubleBE(0.1);next.writeBigUInt64BE(next.readBigUInt64BE()+1n);const adjacent=next.readDoubleBE();
 for(const target of ['outerBoundary','currentRestaurant','readyRestaurants','pendingRestaurants']){
  const p=progress(0),q=structuredClone(p),r=structuredClone(p);
  const tuple=v=>target==='outerBoundary'?v.outerBoundary:target==='currentRestaurant'?v.currentRestaurant.sortTuple:v[target][0].sortTuple;
  tuple(q)[1]=0.1;tuple(r)[1]=adjacent;
  assert.notEqual(fingerprint(q),fingerprint(r),target);assert.equal(fingerprint(q),fingerprint(structuredClone(q)));
 }
 assert.throws(()=>fingerprint(progress(NaN)));assert.throws(()=>fingerprint(progress(Infinity)));
 const invalid=progress(0);invalid.currentRestaurant.visibleOfferCount=0.1;assert.throws(()=>fingerprint(invalid),'non-distance validation stays strict');
});
for(const enabled of [false,true])test(`fractional native guest boundaries survive >75 restricted history IDs, replay and later pages (window=${enabled})`,async()=>{
 const f=await F.restaurantWindowFixture({count:110,enabled,options:{restaurant:{latitude:28.5384,geohash:canonicalRestaurantGeohash({latitude:28.5384,longitude:-81.3792})}}});
 const distance=exactCustomerBiteSaverDistanceMiles({latitude:f.session.criteria.latitude,longitude:f.session.criteria.longitude},f.seeded[0].restaurantProjection);
 assert(distance>0&&!Number.isSafeInteger(distance));
 for(const row of f.seeded){const result={...row.result,distanceMiles:distance,distanceSortMiles:distance};row.result=result;f.database.documents.set(row.resultPath,result);}
 const excluded=f.seeded.slice(0,76).map(r=>F.opaqueOfferId(r,r.coupons[0]));
 const first=await f.page();assert.equal(first.outcome,'guestCheckRequired');
 const done=await F.finishRestaurantWindow(f,first,excluded);
 assert(done.history.checkedBatches.every(batch=>batch.length<=75));
 assert(new Set(done.history.checkedBatches.flat()).size>75);
 assert.deepEqual(done.response.result.restaurants.map(r=>r.restaurantId),f.seeded.slice(76,101).map(r=>r.publicRestaurantId));
 assert.equal(done.response.result.hasMore,true);
 const replay=await f.page();assert.deepEqual(replay,done.response);
 const request={...f.request,clientRequestId:'fractional-later-page-0001',cursor:done.response.result.nextCursor};let answer=0;
 const next={...f,request,page:(r=request)=>f.page(r),answer:r=>f.answer({...r,clientRequestId:`fractional-later-answer-${++answer}`})};
 const last=await F.finishRestaurantWindow(next,await next.page(),excluded);
 assert.deepEqual(last.response.result.restaurants.map(r=>r.restaurantId),f.seeded.slice(101).map(r=>r.publicRestaurantId));
 assert.equal(last.response.result.hasMore,false);
});
test('one-ULP fractional progress tampering cannot reuse an accepted challenge token',async()=>{
 const f=await F.restaurantWindowFixture({count:2,enabled:false,options:{restaurant:{latitude:28.5384,geohash:canonicalRestaurantGeohash({latitude:28.5384,longitude:-81.3792})}}});
 const distance=exactCustomerBiteSaverDistanceMiles({latitude:f.session.criteria.latitude,longitude:f.session.criteria.longitude},f.seeded[0].restaurantProjection);
 for(const row of f.seeded)f.database.documents.set(row.resultPath,{...row.result,distanceMiles:distance,distanceSortMiles:distance});
 const first=await f.page(),key=`${C.privateCustomerBiteSaverGuestOfferCheckCollection}/${first.operationRef}`,original=f.database.documents.get(key);
 const bytes=Buffer.alloc(8);bytes.writeDoubleBE(distance);bytes.writeBigUInt64BE(bytes.readBigUInt64BE()+1n);
 const changed={...original,progress:{...original.progress,currentRestaurant:{...original.progress.currentRestaurant,sortTuple:[...original.progress.currentRestaurant.sortTuple]}}};
 changed.progress.currentRestaurant.sortTuple[1]=bytes.readDoubleBE();f.database.documents.set(key,changed);
 await assert.rejects(f.answer(F.guestAnswerRequest(f.started,first,[])));
 f.database.documents.set(key,original);assert((await f.answer(F.guestAnswerRequest(f.started,first,[]))).outcome);
});
