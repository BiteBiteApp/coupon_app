'use strict';
// Reviewer-only diagnostics: actual compiled handlers over the existing in-memory
// native fixture/authority adapter and injected membership provider. No SQL,
// emulator, cloud, production data or runtime qualification is claimed.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
const repo='/Users/colesmart/dev/coupon_app';
const fixturePath=path.join(repo,'functions/test/customer_bitesaver_search_handlers.test.js');
const fixtures=new Module(fixturePath,module);fixtures.filename=fixturePath;fixtures.paths=Module._nodeModulePaths(path.dirname(fixturePath));
const actualRequire=Module.createRequire(fixturePath),ignoreTest=()=>undefined;
fixtures.require=id=>id==='node:test'?ignoreTest:actualRequire(id);
fixtures._compile(fs.readFileSync(fixturePath,'utf8')+'\nmodule.exports.review={addReadyRestaurant,markSessionReady,guestIdentity,guestAnswerRequest,pageRequest,opaqueOfferId,replaceReadyCoupon,SerializedTransactionCustomerBiteSaverSearchDatabase};',fixturePath);
const F={...fixtures.exports,...fixtures.exports.review};
const C=actualRequire('../lib/customer_bitesaver_search_contract.js');
const {createPostgisSearchHandlers}=actualRequire('../lib/postgis_handlers.js');
const observations=[];
async function setup(enabled,specs,{serialized=false,now=F.nowMs}={}){
 const database=serialized?new F.SerializedTransactionCustomerBiteSaverSearchDatabase():new F.InMemoryCustomerBiteSaverSearchDatabase();let clock=now;
 const context=F.createContext(database,{identity:F.guestIdentity(),guestRestaurantWindow:enabled,now:()=>clock});
 const api=createPostgisSearchHandlers({database,provider:{async pinRevision(){return{revision:'37'};},async queryResults({query}){return database.queryDocuments(query);}}});
 const started=await api.startCustomerBiteSaverSearchV2(F.startRequest({searchText:'',timeZone:'America/New_York',utcOffsetMinutes:-240}),context);
 const session=database.documents.get(C.privateCustomerBiteSaverSearchSessionCollection+'/'+started.sessionId);
 const rows=specs.map((s,i)=>F.addReadyRestaurant(database,session,i,{onlyCoupons:true,offerCount:s.count,offerOverrides:{usageRule:'Once per customer'},resultCreatedAtMs:now,offerProjectionNowMs:now,...s.options}));
 for(let i=0;i<rows.length;i++)if(specs[i].hidden)database.documents.delete('restaurant_accounts/'+rows[i].accountId);
 const unavailable=new Set();for(let i=0;i<rows.length;i++)for(let j=0;j<rows[i].coupons.length;j++)if(specs[i].exclude?.(j))unavailable.add(F.opaqueOfferId(rows[i],rows[i].coupons[j]));
 return{database,context,api,started,rows,unavailable,setClock:value=>clock=value};
}
let requestNumber=0;
function request(f,cursor=null){return F.pageRequest(f.started,{clientRequestId:'review-window-page-'+String(++requestNumber).padStart(6,'0'),guestStateRevision:17,cursor});}
function answer(f,response,ids){return F.guestAnswerRequest(f.started,response,ids??response.candidates.filter(c=>f.unavailable.has(c.offerId)).map(c=>c.offerId),{clientRequestId:'review-window-answer-'+String(++requestNumber).padStart(6,'0')});}
function checkPublic(response){F.assertNoPrivateCanaries(response);if(response.outcome==='guestCheckRequired'){assert(response.candidates.length>=1&&response.candidates.length<=75);assert.equal(new Set(response.candidates.map(c=>c.offerId)).size,response.candidates.length);for(const c of response.candidates)assert.deepEqual(Object.keys(c).sort(),['offerId','usagePolicy']);assert.equal('result' in response,false);}}
async function finish(f,response,cursor=null,trace=[]){for(let n=0;n<1000;n++){checkPublic(response);if(response.outcome==='complete')return response;if(response.outcome==='guestCheckRequired'){trace.push(response.candidates.map(c=>c.offerId));response=await f.api.continueCustomerBiteSaverGuestOfferCheckV2(answer(f,response),f.context);}else{assert.equal(response.outcome,'retryRequired');assert.equal(response.reason,'workBudget');assert.equal(response.restartFrom,'originalOperation');response=await f.api.getCustomerBiteSaverSearchPageV2(request(f,cursor),f.context);}}throw Error('unbounded diagnostic continuation');}
async function allPages(enabled,specs){const f=await setup(enabled,specs),pages=[],trace=[];let cursor=null;for(let p=0;p<20;p++){const response=await finish(f,await f.api.getCustomerBiteSaverSearchPageV2(request(f,cursor),f.context),cursor,trace);const rows=response.result.restaurants;pages.push({hasMore:response.result.hasMore,cursor:response.result.nextCursor!==null,rows:rows.map(r=>({id:r.restaurantId,offers:r.offers.map(o=>o.offerId),hasMoreOffers:r.hasMoreOffers,usableOfferCount:r.usableOfferCount,offerCountState:r.offerCountState}))});cursor=response.result.nextCursor;if(cursor===null)return{pages,trace,f};}throw Error('unbounded diagnostic pages');}

function compareEligiblePages(name,before,after,specs){
 const essential=pages=>pages.map(p=>({...p,rows:p.rows.map(({usableOfferCount,offerCountState,...row})=>row)}));
 assert.deepEqual(essential(after.pages),essential(before.pages));
 const differences=[];
 for(const [label,result] of [['serial',before],['window',after]]){
   const seeded=new Map(result.f.rows.map((r,i)=>[r.publicRestaurantId,{r,s:specs[i]}]));
   for(const page of result.pages)for(const row of page.rows){
     const {r,s}=seeded.get(row.id);assert(!s.hidden);
     const actual=r.coupons.filter((_,j)=>!(s.exclude?.(j))).length;
     if(row.offerCountState==='current')assert.equal(row.usableOfferCount,actual,`${name}/${label} current count truthful`);
     else{assert.equal(row.offerCountState,'unknown');assert.equal(row.usableOfferCount,null);assert(actual>=3);}
   }
 }
 for(let p=0;p<after.pages.length;p++)for(let r=0;r<after.pages[p].rows.length;r++){
   const a=after.pages[p].rows[r],b=before.pages[p].rows[r];
   if(a.usableOfferCount!==b.usableOfferCount||a.offerCountState!==b.offerCountState)differences.push({page:p,row:r,serial:{count:b.usableOfferCount,state:b.offerCountState},window:{count:a.usableOfferCount,state:a.offerCountState}});
 }
 if(differences.length)observations.push({case:name,metadataDifferences:differences,classification:'ACCEPT AND CLOSE',reason:'100-item scan budget can change exhaustion proof; membership/order/hasMore and truthful unknown/current DTO invariants hold. Parent acknowledged existing supported unknown count.'});
}

for(const [name,specs] of [
 ['sparse mixed exclusions',Array.from({length:80},(_,i)=>({count:1,hidden:i%7===0,exclude:()=>i%5===0}))],
 ['dense unresolved first parent',Array.from({length:40},(_,i)=>({count:i===0?40:3,exclude:j=>i===0?j<36:(i%7===0)}))],
 ['empty visible page after all history exclusions',Array.from({length:28},()=>({count:4,exclude:()=>true}))],
])test('review differential '+name,async()=>{const before=await allPages(false,specs),after=await allPages(true,specs);compareEligiblePages(name,before,after,specs);observations.push({case:name,serialChallenges:before.trace.length,windowChallenges:after.trace.length,maximumWindowIds:Math.max(0,...after.trace.map(x=>x.length)),cards:after.pages.reduce((n,p)=>n+p.rows.length,0)});});
test('review 75 IDs global across parents; 76th parent-group resumes without omission',async()=>{const f=await setup(true,Array.from({length:26},()=>({count:3})));const first=await f.api.getCustomerBiteSaverSearchPageV2(request(f),f.context);checkPublic(first);assert.equal(first.candidates.length,75);const doc=f.database.documents.get(C.privateCustomerBiteSaverGuestOfferCheckCollection+'/'+first.operationRef);assert.equal(doc.progress.windowVersion,1);assert.equal(doc.activeBatch.restaurantSlices.reduce((n,s)=>n+s.candidateCount,0),75);assert.equal(doc.activeBatch.restaurantSlices.length,25);assert.equal(doc.progress.outerBoundary,null);const trace=[];const result=await finish(f,first,null,trace);assert.equal(result.result.restaurants.length,25);assert.equal(result.result.hasMore,true);assert.equal(new Set(trace.flat()).size,78);observations.push({case:'75 global',sizes:trace.map(x=>x.length)});});
test('review expired reissue preserves exact candidate and parent slices',async()=>{const f=await setup(true,Array.from({length:26},()=>({count:1})));const req=request(f),first=await f.api.getCustomerBiteSaverSearchPageV2(req,f.context),key=C.privateCustomerBiteSaverGuestOfferCheckCollection+'/'+first.operationRef;const slices=structuredClone(f.database.documents.get(key).activeBatch.restaurantSlices);f.setClock(first.logicalExpiresAtMillis+1);const refreshed=await f.api.getCustomerBiteSaverSearchPageV2(request(f),f.context);assert.equal(refreshed.outcome,'guestCheckRequired');assert.deepEqual(refreshed.candidates,first.candidates);assert.deepEqual(f.database.documents.get(key).activeBatch.restaurantSlices,slices);assert(refreshed.batchSequence>first.batchSequence);assert.notEqual(refreshed.checkToken,first.checkToken);assert.equal(refreshed.evaluationContext.evaluationAtMillis,first.evaluationContext.evaluationAtMillis);});
test('review lost accepted answer recovers exactly once after token expiry',async()=>{const f=await setup(true,Array.from({length:26},()=>({count:1}))),first=await f.api.getCustomerBiteSaverSearchPageV2(request(f),f.context),a=answer(f,first),key=C.privateCustomerBiteSaverGuestOfferCheckCollection+'/'+first.operationRef,original=f.database.runTransaction.bind(f.database);let captured=false;f.database.runTransaction=async fn=>{const result=await original(fn);if(!captured&&result?.document?.state==='answerAccepted'){captured=true;throw Error('review lost accepted reply');}return result;};await assert.rejects(f.api.continueCustomerBiteSaverGuestOfferCheckV2(a,f.context),/review lost accepted reply/);f.database.runTransaction=original;assert(captured);assert.equal(f.database.documents.get(key).state,'answerAccepted');f.setClock(first.logicalExpiresAtMillis+1);const result=await f.api.continueCustomerBiteSaverGuestOfferCheckV2(a,f.context);assert.equal(result.outcome,'complete');assert.equal(result.result.restaurants.length,25);const state=JSON.stringify(f.database.documents.get(key));assert.deepEqual(await f.api.continueCustomerBiteSaverGuestOfferCheckV2(a,f.context),result);assert.equal(JSON.stringify(f.database.documents.get(key)),state);});
test('review withdrawn pending parent produces restart and no partial positive result',async()=>{const f=await setup(true,Array.from({length:26},()=>({count:1}))),first=await f.api.getCustomerBiteSaverSearchPageV2(request(f),f.context);f.database.documents.delete('restaurant_accounts/'+f.rows[10].accountId);const result=await f.api.continueCustomerBiteSaverGuestOfferCheckV2(answer(f,first),f.context);assert.equal(result.outcome,'retryRequired');assert.equal(result.reason,'sourceChanged');assert.equal(result.restartFrom,'search');assert.equal('result' in result,false);});
test('review option-off context refuses pending window without completing it',async()=>{const f=await setup(true,Array.from({length:3},()=>({count:1}))),first=await f.api.getCustomerBiteSaverSearchPageV2(request(f),f.context),a=answer(f,first);await assert.rejects(f.api.continueCustomerBiteSaverGuestOfferCheckV2(a,{...f.context,guestRestaurantWindow:false}));const result=await f.api.continueCustomerBiteSaverGuestOfferCheckV2(a,f.context);assert.equal(result.outcome,'complete');assert.equal(result.result.restaurants.length,3);});

for(let seed=1;seed<=12;seed++)test('review deterministic differential matrix '+seed,async()=>{
 const specs=Array.from({length:26+seed*3},(_,i)=>({count:1+((i*17+seed*5)%8),hidden:(i+seed)%17===0,exclude:j=>(i*7+j*11+seed)%5<2}));
 const before=await allPages(false,specs),after=await allPages(true,specs);
 compareEligiblePages('matrix '+seed,before,after,specs);
 observations.push({case:'matrix '+seed,serialChallenges:before.trace.length,windowChallenges:after.trace.length,maximumWindowIds:Math.max(0,...after.trace.map(x=>x.length)),cards:after.pages.reduce((n,p)=>n+p.rows.length,0)});
});
test('review later-parent once-per-day candidate caps the entire challenge at local reset',async()=>{
 const at=Date.parse('2026-09-10T04:00:30.000Z'),reset=Date.parse('2026-09-10T04:01:00.000Z');
 const specs=Array.from({length:26},(_,i)=>({count:1,options:{offerOverrides:{usageRule:i===20?'Once per day':'Once per customer'}}}));
 const f=await setup(true,specs,{now:at}),first=await f.api.getCustomerBiteSaverSearchPageV2(request(f),f.context);
 assert.equal(first.candidates.length,26);assert.equal(first.logicalExpiresAtMillis,reset);
 const key=C.privateCustomerBiteSaverGuestOfferCheckCollection+'/'+first.operationRef,doc=f.database.documents.get(key);
 assert.equal(doc.logicalExpiresAt.getTime(),reset);
 const old=answer(f,first);f.setClock(reset);
 await assert.rejects(f.api.continueCustomerBiteSaverGuestOfferCheckV2(old,f.context));
 const refreshed=await f.api.getCustomerBiteSaverSearchPageV2(request(f),f.context);
 assert.equal(refreshed.outcome,'guestCheckRequired');assert.equal(refreshed.evaluationContext.evaluationAtMillis,reset);
 assert.equal(refreshed.candidates.find(c=>c.offerId===F.opaqueOfferId(f.rows[20],f.rows[20].coupons[0])).usagePolicy,'oncePerDay');
 const final=await finish(f,refreshed);assert.equal(final.result.restaurants.length,25);
 observations.push({case:'once-per-day later parent',firstExpiryMs:first.logicalExpiresAtMillis,freshEvaluationMs:refreshed.evaluationContext.evaluationAtMillis});
});
test('review later-parent coupon occurrence replacement invalidates the old challenge',async()=>{
 const f=await setup(true,Array.from({length:26},()=>({count:1}))),first=await f.api.getCustomerBiteSaverSearchPageV2(request(f),f.context);
 F.replaceReadyCoupon(f.database,f.rows[20],0,{createdAt:new Date(F.nowMs-42)});
 const result=await f.api.continueCustomerBiteSaverGuestOfferCheckV2(answer(f,first),f.context);
 assert.equal(result.outcome,'retryRequired');assert.equal(result.reason,'sourceChanged');assert.equal('result' in result,false);
});

process.on('exit',()=>fs.writeFileSync(path.join(__dirname,'independent-window-observations.v2.json'),JSON.stringify({scope:'in-memory native handler diagnostics; no performance/SQL/cloud claim',observations},null,2)+'\n'));
