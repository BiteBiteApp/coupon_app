'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Timestamp}=require('firebase-admin/firestore');
const F=require('./fixtures/postgis_gate0.cjs');
const S=require('../lib/postgis_source.js'),O=require('../lib/postgis_semantics.js');
const B=require('../lib/search_index_builders.js');
const {evaluateCustomerBiteSaverOfferAvailability:nativeAvailability}=require('../lib/customer_bitesaver_offer_availability.js');
const {PostgisReadModel,createLocalPostgisPool}=require('../lib/postgis_store.js');
const {PostgisMembership}=require('../lib/postgis_membership.js');
const {startCustomerBiteSaverSearchHandler,customerBiteSaverOrderedResultQuery}=require('../lib/customer_bitesaver_search_session.js');
const {privateCustomerBiteSaverSearchSessionCollection}=require('../lib/customer_bitesaver_search_contract.js');
const {MemoryDatabase}=require('./support/customer_bitescore_fixtures.js');
const now=F.now,ms=now.getTime(),seconds=ms/1000;
const criteria={space:'saver',kind:'restaurant',center:F.center,radiusMiles:15,text:'',typedLocation:null,
 timeZone:'America/New_York',locationMode:'current',membershipMs:ms};
function cases(){return [
 ['coupon-expired','coupon',{endTime:new Timestamp(seconds-1,999999000)},false],
 ['coupon-start-submillisecond','coupon',{startTime:new Timestamp(seconds,1000)},false],
 ['coupon-start-submicrosecond','coupon',{startTime:new Timestamp(seconds,999)},true],
 ['coupon-end-inclusive','coupon',{endTime:new Timestamp(seconds,0)},true],
 ['coupon-end-submillisecond','coupon',{endTime:new Timestamp(seconds,999999000)},true],
 ['coupon-scheduled','coupon',{startTime:Timestamp.fromMillis(ms+1000)},false],
 ['coupon-available','coupon',{},true],
 ['daily-expired','dailySpecial',{expiresAt:Timestamp.fromMillis(ms)},false],
 ['daily-available','dailySpecial',{expiresAt:Timestamp.fromMillis(ms+1000)},true],
 ];}
function fixture(name,kind,changes){
 const id='offer-time006-'+name,parent=F.saverSource(0,{...F.center,restaurantName:name});
 const p=F.saver(id,parent);
 const o=kind==='coupon'?F.coupon(id,'time-offer',parent,F.couponSource('time-offer',0,changes)):(()=>{
  const data=B.buildBiteSaverDailySpecialOfferIndex({restaurantAccountId:id,sourceDocumentId:'time-offer',restaurant:parent,
   offer:{id:'time-offer',title:'Synthetic daily',isActive:true,availabilityMode:'todayOnly',allDay:true,
    createdAt:now,updatedAt:now,...changes},now,identityKeyV1:F.identityKeyV1});
  assert(data);return{collection:'bitesaver_offer_index',id:data.indexDocumentId,data};})();
 const entity=d=>{const projection=S.encodePostgisProjection(d.collection,d.id,d.data);assert(projection);
  return O.entityFromProjection({id:d.id,path:`${d.collection}/${d.id}`,data:S.decodePostgisProjection(projection)},projection);};
 return {p,o,parent:entity(p),offer:entity(o)};
}
function expected(f,kind){return nativeAvailability({offerType:kind,offer:f.o.data,parentEligible:true,now,timeZone:criteria.timeZone,
 locationMode:'current',restaurantCoordinates:f.p.data,currentCoordinates:F.center,usage:null});}
for(const [name,kind,changes,visible]of cases())test(`SQL JSON round-trip preserves native time eligibility: ${name}`,()=>{
 const f=fixture(name,kind,changes),native=expected(f,kind);assert.equal(native.visible,visible,'fixture must exercise intended native boundary');
 // Exact PostgreSQL JSONB wire representation: Timestamp methods are absent.
 const parent=JSON.parse(JSON.stringify(f.parent)),offer=JSON.parse(JSON.stringify(f.offer));
 assert.equal(typeof offer.dto.startTime?.toDate,'undefined');
 assert.deepEqual(O.available(criteria,parent,offer),native);
});
test('real SQL selector and native membership agree for timestamp schedules and resumptions',
 {skip:process.env.BS_POSTGIS_SQL_TEST!=='1',timeout:60000},async()=>{
 const documents=cases().flatMap(([name,kind,changes])=>{const f=fixture(name,kind,changes);return[f.p,f.o];});
 const events=Array.from({length:16},()=>[]);
 for(const d of documents){const payload={collection:d.collection,indexDocumentId:d.id,projection:S.encodePostgisProjection(d.collection,d.id,d.data)},shard=S.postgisSourceShardFor(d.collection,d.id);
 events[shard].push({shard,seq:events[shard].length+1,payload,digest:S.postgisSourceDigest(payload)});}
 const source={async readFence(){return{protocolVersion:S.postgisSourceVersion,epoch:'offer-time006',enrolled:true,shards:events.map(es=>({seq:es.length,partitions:S.postgisSourceManifest(es)}))};},
 async readEvents(shard,after,through,limit){return events[shard].filter(e=>e.seq>after&&e.seq<=through).slice(0,limit);}};
 const pool=createLocalPostgisPool({host:'127.0.0.1',port:55441,database:'bsgate0_time006',user:'bsgate0'}),model=new PostgisReadModel(pool,source);
 try{
 await pool.query('DROP SCHEMA public CASCADE');await pool.query('CREATE SCHEMA public');await model.initializeLocalSchema();
 let ready=false;for(let i=0;i<100;i++){if((await model.catchUp(75)).ready){ready=true;break;}}assert(ready);
 const authority=new MemoryDatabase(),discoveryKey=Buffer.alloc(32,43);
 const start=await startCustomerBiteSaverSearchHandler({schemaVersion:1,clientRequestId:'offer-time006-native-request',clientInstanceId:'offer-time006-native-client',
  ...F.center,radiusMiles:15,locationMode:'current',typedLocation:null,searchText:'',timeZone:criteria.timeZone,utcOffsetMinutes:-240,freshSearch:true},
 {database:authority,discoveryKey,identityKeyV1:F.identityKeyV1,identity:{authUid:'synthetic-time006-user',authIsAnonymous:false},now:()=>ms,randomSource:n=>Buffer.alloc(n,53)});
 const expiry=new Date(Date.now()+60000),session={...authority.documents.get(`${privateCustomerBiteSaverSearchSessionCollection}/${start.sessionId}`),
  state:'ready',phase:'ready',logicalExpiresAt:expiry,absoluteExpiresAt:expiry,expiresAt:expiry};
 const pinned=await model.pinRevision({pinId:start.sessionId,expiresAtMs:expiry.getTime()});
 const request={space:'saver',revision:pinned.revision,session,query:customerBiteSaverOrderedResultQuery({session})};
 let rows,partials=0;for(let i=0;i<100;i++){
  try{rows=await new PostgisMembership(model,authority,discoveryKey,F.identityKeyV1,{queries:2,timeMs:4000}).queryResults(request);break;}
  catch(error){assert.equal(error.code,'unavailable');partials++;}
 }
 assert(rows);assert(partials>0,'durable refinement must be exercised');
 const expectedIds=cases().filter(([name,kind,changes])=>expected(fixture(name,kind,changes),kind).visible).map(([name])=>'offer-time006-'+name).sort();
 assert.deepEqual(rows.map(r=>r.data.authoritativeAccountId).sort(),expectedIds);
 assert(rows.every(r=>r.data.usableOfferCountAtPreparation===1));
 }finally{await model.close();}
});
