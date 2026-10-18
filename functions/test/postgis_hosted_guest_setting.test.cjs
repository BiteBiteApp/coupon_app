'use strict';
// Focused hosted composition qualification. Real configuration clone,
// Ed25519 verification, branded CloudSQL wrapper, runtime guard, callable context,
// PostGIS bridge and native guest handlers. Only lower storage/provider adapters
// are replaced. No actual SQL, Firebase, credentials, listener or cloud activity.
const {test: nativeTest}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
const repo=path.resolve(__dirname,'../..');
const fixturePath=path.join(repo,'functions/test/customer_bitesaver_search_handlers.test.js');
const requireFixture=Module.createRequire(fixturePath),fixtures=new Module(fixturePath,module);
fixtures.filename=fixturePath;fixtures.paths=Module._nodeModulePaths(path.dirname(fixturePath));
fixtures.require=id=>id==='node:test'?()=>undefined:requireFixture(id);
fixtures._compile(fs.readFileSync(fixturePath,'utf8')+'\nmodule.exports.review={addReadyRestaurant,markSessionReady,guestIdentity,guestAnswerRequest,pageRequest,opaqueOfferId};',fixturePath);
const F={...fixtures.exports,...fixtures.exports.review};
const load=name=>requireFixture('../lib/'+name+'.js');
const C=load('customer_bitesaver_search_contract'),native=load('customer_bitesaver_search_session');
const SC=load('customer_bitescore_search_contract'),score=load('customer_bitescore_search');
const SF=requireFixture('./support/customer_bitescore_fixtures.js');
const approval=load('postgis_execution_approval'),cloudsql=load('postgis_cloudsql');
const runtime=load('postgis_hosted_runtime'),entry=load('postgis_hosted_entrypoint');
const realGuard=load('postgis_runtime').requireQualifiedPostgisRuntime;
// Linux hosted serving is intentionally unqualified. Never replace the guard.
// Only its explicit eligibility refusal skips composition; all imports/errors above remain fatal.
let guardEligibility;
try { realGuard('hosted'); } catch (error) {
 const refusals = ['PostGIS hosted Linux runtime is unqualified; local qualification is insufficient.',
  'PostGIS exact-distance runtime is unqualified; run the compatibility gate first.',
  'PostGIS exact-distance runtime flags are unqualified.'];
 if (!refusals.includes(error.message)) throw error;
 guardEligibility = error.message;
}
const test = (name, fn) => nativeTest(name, guardEligibility ? {skip: 'Hosted runtime unqualified: ' + guardEligibility} : {}, fn);
const observations=[];let requestSequence=0;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function configuration(mode){
 const c={syntheticOnly:true,projectId:'bitestar-isolated-test',projectNumber:'123456789',runId:'bs-postgis-test',candidateDigest:'a'.repeat(64),gate:1,allowedProjectIds:['bitestar-isolated-test'],region:'us-central1',hosted:{sql:{instanceConnectionName:'bitestar-isolated-test:us-central1:bs-postgis-test-db',database:'bs_postgis_search',restoreDatabase:'bs_postgis_restore',schema:'public',serviceAccountEmail:'bitestar-search@bitestar-isolated-test.iam.gserviceaccount.com'},epoch:'guest-setting-unit-test',firestoreDatabase:'search-qualification',allowedOrigins:[],enforceAppCheck:false}};
 if(mode!=='absent')c.hosted.guestRestaurantWindow=mode;
 return c;
}
function signConfiguration(config){
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),expected=cloudsql.cloudSqlPostgisIdentity(config),now=Date.now();
 const claims={protocolVersion:approval.postgisApprovalProtocol,...Object.fromEntries(['projectId','projectNumber','runId','candidateDigest','configDigest'].map(k=>[k,expected[k]])),notBeforeMs:now-1000,validUntilMs:now+60000,cleanupUntilMs:now+120000,allowedGates:[1,5]};
 const bytes=Buffer.from(approval.canonicalPostgisApproval(claims));
 const envelope={keyId:'unit-test-only',payloadBase64:bytes.toString('base64'),signatureBase64:crypto.sign(null,bytes,privateKey).toString('base64')};
 const trust={'unit-test-only':publicKey.export({format:'pem',type:'spki'})};
 const permit=approval.verifyPostgisExecutionApproval(envelope,trust,expected);
 return{expected,claims,envelope,trust,permit};
}
function isolation(t){
 // Real guard runs with exact qualified Darwin binary, not a test bypass.
 realGuard('hosted');
 assert.equal(load('postgis_runtime').requireQualifiedPostgisRuntime,realGuard);
 t.mock.timers.enable({apis:['Date'],now:F.nowMs});
 const authorityByFirestore=new WeakMap(),providerTraces=new WeakMap();
 const calls={network:0,source:0,maintenance:0,authority:0,provider:0,connector:0,pool:0};
 const forbid=()=>{calls.network++;throw Error('independent review forbids network');};
 for(const [moduleName,names] of [['node:net',['connect']],['node:tls',['connect']],['node:http',['request','get']],['node:https',['request','get']]])for(const name of names)t.mock.method(require(moduleName),name,forbid);
 t.mock.method(globalThis,'fetch',forbid);
 t.mock.method(load('postgis_source_firestore'),'createFirestorePostgisSource',()=>{calls.source++;return Object.freeze({reviewOnly:true});});
 t.mock.method(load('search_index_maintenance'),'createFirestoreSearchIndexDatabase',()=>{calls.maintenance++;return Object.freeze({reviewOnly:true});});
 t.mock.method(load('customer_bitesaver_search_store'),'createFirestoreCustomerBiteSaverSearchDatabase',database=>{calls.authority++;const result=authorityByFirestore.get(database);assert(result);return result;});
 t.mock.method(load('postgis_search_binding'),'createFirestorePostgisBindingPruner',()=>async()=>({deleted:0}));
 t.mock.method(load('postgis_membership'),'PostgisMembership',function(_model,database){calls.provider++;const trace=[];providerTraces.set(database,trace);return{async pinRevision(input){trace.push({kind:'pin',...input});return{revision:'37'};},async queryResults(input){trace.push({kind:'query',space:input.space,revision:input.revision,limit:input.query.limit});if(input.space==='score'){const prefix=(input.session.criteria.kind==='restaurant'?'restaurant_search_index':'dish_search_index')+'/';const docs=[...database.documents.keys()].filter(p=>p.startsWith(prefix)).map(p=>database.stored(p));for(const result of await score.buildResults(database,input.session,docs)){const id=SC.customerBiteScoreDigest('result',input.session.sessionId,input.session.attempt,result.sourceId);database.documents.set(SC.customerBiteScoreResultCollection+'/'+id,result);}}return database.queryDocuments(input.query);}};});
 t.after(()=>{assert.equal(calls.network,0);assert.equal(load('postgis_runtime').requireQualifiedPostgisRuntime,realGuard);});
 async function prepare(mode){
  const config=configuration(mode),signed=signConfiguration(config),database=new F.InMemoryCustomerBiteSaverSearchDatabase();
  const firestore={projectId:config.projectId,databaseId:config.hosted.firestoreDatabase};authorityByFirestore.set(firestore,database);
  let options;
  const raw={totalCount:0,idleCount:0,waitingCount:0,on(){},async connect(){return{async query(text){assert.equal(text,'SELECT current_database() AS database, current_user AS username');return{rows:[{database:options.database,username:options.user}],rowCount:1};},release(){}};},async end(){}};
  const pool=await cloudsql.createCloudSqlPostgisPool(config,signed.permit,'primary',{createConnector(){calls.connector++;return{async getOptions(value){assert.equal(value.ipType,'PRIVATE');assert.equal(value.authType,'IAM');return{stream(){}};},close(){}};},createPool(value){calls.pool++;options=value;return raw;}});
  cloudsql.requireCloudSqlPostgisPool(pool,signed.expected);
  t.after(()=>pool.end());
  const resources={database:firestore,auth:{app:{options:{projectId:config.projectId}}},pool,discoveryKey:F.discoveryKey,identityKeyV1:Buffer.alloc(32,23),scoreCursorRootKey:Buffer.alloc(32,29)};
  function construct(){return runtime.createHostedPostgisRuntime(config,signed.permit,resources);}
  return{config,signed,database,resources,construct,trace:()=>providerTraces.get(database)};
 }
 return{prepare,calls};
}
function callable(data,signed=false){return{data,...(signed?{auth:{uid:'handler-test-customer',token:{firebase:{sign_in_provider:'password'}}}}:{})};}
async function seedSearch(f,{signed=false,count=35,offers=1}={}){
 const started=await f.runtime.invoke('startCustomerBiteSaverSearchV2',callable(F.startRequest({searchText:''}),signed));
 const session=f.database.documents.get(C.privateCustomerBiteSaverSearchSessionCollection+'/'+started.sessionId);assert(session);assert.equal(session.state,'ready');
 const rows=Array.from({length:count},(_,i)=>F.addReadyRestaurant(f.database,session,i,{offerCount:offers,onlyCoupons:true,offerOverrides:{usageRule:'Once per customer'}}));
 return{...f,signedConfigDigest:f.signed.expected.configDigest,started,session,rows,signed};
}
function pageInput(f){return F.pageRequest(f.started,{guestStateRevision:f.signed?null:17,clientRequestId:'hosted-review-page-'+String(++requestSequence).padStart(6,'0')});}
function check(response){F.assertNoPrivateCanaries(response);if(response.outcome==='guestCheckRequired'){assert(response.candidates.length>=1&&response.candidates.length<=75);assert.equal(new Set(response.candidates.map(c=>c.offerId)).size,response.candidates.length);for(const c of response.candidates)assert.deepEqual(Object.keys(c).sort(),['offerId','usagePolicy']);}}
async function complete(f,initial,excluded=[]){
 let response=initial;const history=new Set(excluded),batches=[],answers=[];
 for(let n=0;n<150;n++){
  check(response);if(response.outcome==='complete')return{response,batches,answers};
  if(response.outcome==='guestCheckRequired'){
   batches.push(response.candidates.map(x=>x.offerId));const intersection=response.candidates.filter(x=>history.has(x.offerId)).map(x=>x.offerId);answers.push(intersection);
   const answer=F.guestAnswerRequest(f.started,response,intersection,{clientRequestId:'hosted-review-answer-'+String(++requestSequence).padStart(6,'0')});
   response=await f.runtime.invoke('continueCustomerBiteSaverGuestOfferCheckV2',callable(answer,f.signed));
  }else{assert.equal(response.outcome,'retryRequired');assert.equal(response.reason,'workBudget');response=await f.runtime.invoke('getCustomerBiteSaverSearchPageV2',callable(pageInput(f),f.signed));}
 }
 throw Error('review fixture exceeded bounded continuation attempts');
}
async function assertMode(f,enabled,label){
 const first=await f.runtime.invoke('getCustomerBiteSaverSearchPageV2',callable(pageInput(f)));assert.equal(first.outcome,'guestCheckRequired');assert.equal(first.candidates.length,enabled?26:1);
 const checkpoint=f.database.documents.get(C.privateCustomerBiteSaverGuestOfferCheckCollection+'/'+first.operationRef);assert.equal(checkpoint.progress.windowVersion,enabled?1:undefined);
 const done=await complete(f,first);assert.equal(done.response.result.restaurants.length,25);assert.equal(done.response.result.hasMore,true);assert.deepEqual(done.response.result.restaurants.map(r=>r.restaurantId),f.rows.slice(0,25).map(r=>r.publicRestaurantId));assert.equal(done.batches.length,enabled?1:26);
 observations.push({case:label,firstCandidates:first.candidates.length,rounds:done.batches.length,cards:25,orderedIdsSha256:digest(done.response.result.restaurants.map(r=>r.restaurantId)),signedConfigDigest:f.signedConfigDigest});
 return done;
}
for(const mode of ['absent',false,true])test(`actual hosted composition selects ${String(mode)} mode`,async t=>{const env=isolation(t),f=await env.prepare(mode);f.runtime=f.construct();const seeded=await seedSearch(f);await assertMode(seeded,mode===true,String(mode));});
test('signed invalid JSON types reject before native/provider construction',async t=>{const env=isolation(t);for(const value of [null,'true',0,1,[],{}]){const config=configuration(value),signed=signConfiguration(config);assert.throws(()=>runtime.requireHostedPostgisConfiguration(config,signed.permit),/hosted candidate/);assert.throws(()=>runtime.createHostedPostgisRuntime(config,signed.permit,{}),/hosted candidate/);}assert.equal(env.calls.source,0);assert.equal(env.calls.authority,0);assert.equal(env.calls.provider,0);assert.equal(env.calls.connector,0);assert.throws(()=>signConfiguration(configuration(undefined)));});
test('changed mode, stale permit and modified signature reject before key or provider access',async t=>{const env=isolation(t),f=await env.prepare(false);f.config.hosted.guestRestaurantWindow=true;const before={...env.calls};assert.throws(()=>f.construct(),/approval/);assert.deepEqual(env.calls,before);const expected=cloudsql.cloudSqlPostgisIdentity(f.config);assert.throws(()=>approval.verifyPostgisExecutionApproval(f.signed.envelope,f.signed.trust,expected),/approval/);const altered={...f.signed.claims,configDigest:expected.configDigest};const changedEnvelope={...f.signed.envelope,payloadBase64:Buffer.from(approval.canonicalPostgisApproval(altered)).toString('base64')};assert.throws(()=>approval.verifyPostgisExecutionApproval(changedEnvelope,f.signed.trust,expected),/approval/);await assert.rejects(entry.openApprovedHostedPostgisResources({configuration:f.config,approval:changedEnvelope,trustedKeys:f.signed.trust,keyFile:'/independent-review-this-key-file-must-not-open',port:8080}),/approval/);assert.deepEqual(env.calls,before);});
for(const initial of [false,true])test(`post-construction caller mutation cannot flip ${initial} signed mode`,async t=>{const env=isolation(t),f=await env.prepare(initial);f.runtime=f.construct();f.config.hosted={...f.config.hosted,guestRestaurantWindow:!initial};f.config.allowedProjectIds.push('attacker-project');const seeded=await seedSearch(f);await assertMode(seeded,initial,'mutation-'+initial);});
test('unsigned environment and caller request cannot enable absent signed mode',async t=>{const env=isolation(t),prior=process.env.BS_POSTGIS_GUEST_WINDOW;process.env.BS_POSTGIS_GUEST_WINDOW='1';t.after(()=>{if(prior===undefined)delete process.env.BS_POSTGIS_GUEST_WINDOW;else process.env.BS_POSTGIS_GUEST_WINDOW=prior;});const f=await env.prepare('absent');f.runtime=f.construct();await assert.rejects(f.runtime.invoke('startCustomerBiteSaverSearchV2',callable({...F.startRequest({searchText:''}),guestRestaurantWindow:true})),{code:'invalid-argument'});const seeded=await seedSearch(f);await assert.rejects(f.runtime.invoke('getCustomerBiteSaverSearchPageV2',callable({...pageInput(seeded),guestRestaurantWindow:true})),{code:'invalid-argument'});await assertMode(seeded,false,'unsigned-overrides');});
test('signed hosted window enforces exact history intersection and global75 bound',async t=>{const env=isolation(t),f=await env.prepare(true);f.runtime=f.construct();const seeded=await seedSearch(f,{count:35,offers:3});const first=await f.runtime.invoke('getCustomerBiteSaverSearchPageV2',callable(pageInput(seeded)));assert.equal(first.candidates.length,75);const unrelated='bso_'+Buffer.alloc(32,101).toString('base64url');const excluded=seeded.rows.slice(0,3).flatMap(r=>r.coupons.map(c=>F.opaqueOfferId(r,c))).concat(unrelated);const done=await complete(seeded,first,excluded);assert.deepEqual(done.response.result.restaurants.map(r=>r.restaurantId),seeded.rows.slice(3,28).map(r=>r.publicRestaurantId));assert.equal(done.response.result.hasMore,true);assert(!done.answers.flat().includes(unrelated));assert(done.answers.every((ids,i)=>ids.every(id=>done.batches[i].includes(id))));observations.push({case:'75-and-intersection',maximumChallenge:Math.max(...done.batches.map(b=>b.length)),rounds:done.batches.length,cards:done.response.result.restaurants.length,unrelatedHistoryDisclosed:false});});
test('signed-in Saver retains native25-card behavior with either hosted guest setting',async t=>{const env=isolation(t),ids=[];for(const enabled of [false,true]){const f=await env.prepare(enabled);f.runtime=f.construct();const seeded=await seedSearch(f,{signed:true});const response=await f.runtime.invoke('getCustomerBiteSaverSearchPageV2',callable(pageInput(seeded),true));check(response);assert.equal(response.outcome,undefined);assert.equal(response.restaurants.length,25);ids.push(response.restaurants.map(r=>r.restaurantId));assert.equal([...f.database.documents.keys()].filter(p=>p.startsWith(C.privateCustomerBiteSaverGuestOfferCheckCollection+'/')).length,0);}assert.deepEqual(ids[0],ids[1]);});
test('BiteScore and Finder retain actual native results under either guest setting',async t=>{const env=isolation(t),seen=[];for(const enabled of [false,true]){const f=await env.prepare(enabled);f.runtime=f.construct();const parent=SF.addRestaurant(f.database,'review-score-parent');SF.addDish(f.database,'review-score-dish',parent);for(const [kind,criteria] of [['score',{kind:'dish',text:'Burger'}],['finder',{kind:'restaurant',text:'Alpha',finder:{state:'FL',location:'Miami'}}]]){const clientInstanceId='review-'+kind+'-instance-0001';const started=await f.runtime.invoke('startCustomerBiteScoreSearchV2',callable({schemaVersion:1,clientInstanceId,clientRequestId:'review-'+kind+'-request-0001',queryGeneration:1,criteria}));const result=await f.runtime.invoke('getCustomerBiteScoreSearchPageV2',callable({...SF.continued(started),clientInstanceId}));assert.equal(result.state,'ready');assert.equal(result.items.length,1);assert.equal(result.items[0].sourceDocumentId,kind==='score'?'review-score-dish':'review-score-parent');assert.equal(result.nextCursor,null);seen.push({enabled,kind,items:result.items});}assert.equal([...f.database.documents.keys()].filter(p=>p.startsWith(C.privateCustomerBiteSaverGuestOfferCheckCollection+'/')).length,0);}assert.deepEqual(seen[0].items,seen[2].items);assert.deepEqual(seen[1].items,seen[3].items);observations.push({case:'score-finder',resultsPerFlow:1,modes:[false,true],sameNativeItems:true});});
test('legacy native V1 remains serial even with context option true',async t=>{isolation(t);const database=new F.InMemoryCustomerBiteSaverSearchDatabase(),context=F.createContext(database,{identity:F.guestIdentity(),guestRestaurantWindow:true});const started=await native.startCustomerBiteSaverSearchHandler(F.startRequest({searchText:''}),context),session=F.markSessionReady(database,started);Array.from({length:35},(_,i)=>F.addReadyRestaurant(database,session,i,{offerCount:1,onlyCoupons:true,offerOverrides:{usageRule:'Once per customer'}}));const first=await native.getCustomerBiteSaverSearchPageHandler(F.pageRequest(started,{guestStateRevision:17}),context);assert.equal(first.candidates.length,1);assert.equal(database.documents.get(C.privateCustomerBiteSaverGuestOfferCheckCollection+'/'+first.operationRef).progress.windowVersion,undefined);});
process.on('exit',()=>{const target=process.env.BS_REVIEW_OBSERVATIONS;if(!target)return;fs.writeFileSync(target,JSON.stringify({scope:'Report-only actual hosted composition with real qualified Darwin guard and cryptographic permit, injected lower storage/provider boundaries; no cloud execution',node:process.version,platform:process.platform,guardUnmodified:load('postgis_runtime').requireQualifiedPostgisRuntime===realGuard,observations},null,2)+'\n');});
