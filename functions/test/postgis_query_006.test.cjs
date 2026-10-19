'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {GeoPoint} = require('firebase-admin/firestore');
const F = require('./fixtures/postgis_gate0.cjs');
const S = require('../lib/postgis_source.js');
const O = require('../lib/postgis_semantics.js');
const Q = require('../lib/postgis_query.js');
const {createLocalPostgisPool, insertEntity} = require('../lib/postgis_store.js');
const B = require('../lib/search_index_builders.js');
const C = require('../lib/search_index_contract.js');
const Score = require('../lib/customer_bitescore_search.js');
const SC = require('../lib/customer_bitescore_search_contract.js');
const Saver = require('../lib/customer_bitesaver_search_matcher.js');
const Contract = require('../lib/customer_bitesaver_search_contract.js');
const Geo = require('../lib/restaurant_geo_helpers.js');
const Availability = require('../lib/customer_bitesaver_offer_availability.js');
const centers = [F.center, {latitude:35.68,longitude:139.69},
  {latitude:0,longitude:179.9}, {latitude:60.1,longitude:24}, {latitude:85,longitude:-40}];
const radii = [1,3,5,10,15,20,30];
const dimensions = {parents:50_000, stripeParents:40_000, localClusters:5, childrenPerEligibleParent:1};
const revision = '1';
function wrap(longitude) { return ((longitude+180)%360+360)%360-180; }
function coordinates(i) {
  if (i < 40_000) return {latitude:F.center.latitude+((i%41)-20)*0.0001,
    longitude:-179.9+(Math.floor(i/2)%10_000)*359.8/9999};
  const center = centers[Math.floor((i-40_000)/2000)];
  const n = Math.floor((i-40_000)%2000/2);
  return {latitude:center.latitude+((n%40)-19.5)*0.02,
    longitude:wrap(center.longitude+(Math.floor(n/40)-12)*0.025)};
}
function documentsFor(i) {
  const id=`query006-${String(i).padStart(6,'0')}`,point=coordinates(i);
  if (i%2===0) {
    const parent=F.saverSource(i,{...point,restaurantName:i%500===0?`Rare Juniper ${i}`:`Synthetic Query Diner ${i}`});
    const doc=F.saver(id,parent), docs=[doc];
    if (i%8!==0) docs.push(F.coupon(id,`${id}-offer`,parent,F.couponSource(`${id}-offer`,0,
      {title:i%6===0?'Synthetic noodle offer':'Synthetic ordinary offer',usageRule:'Once per customer'})));
    return docs;
  }
  const parent=F.scoreSource(i,{location:new GeoPoint(point.latitude,point.longitude),
    name:i%501===0?`Rare Juniper Catalog ${i}`:`Synthetic Query Catalog ${i}`});
  const dish={id:`${id}-dish`,restaurantId:id,name:i%3===0?'Synthetic Hamburger':'Synthetic Hoagie',
    category:'Sandwiches',subcategory:i%3===0?'Hamburger':'Submarine sandwich',categoryTags:['Sandwiches'],
    isActive:true,createdAt:F.now,updatedAt:F.now};
  const aggregate={dishId:dish.id,restaurantId:id,overallBiteScore:60+i%40,ratingCount:2+i%100,
    tastinessScoreAverage:8,qualityScoreAverage:8,valueScoreAverage:7,overallImpressionAverage:8,updatedAt:F.now};
  const data=B.buildBiteScoreDishIndex({sourceDocumentId:dish.id,dish,restaurantDocumentId:id,restaurant:parent,aggregate,now:F.now});
  assert(data);
  return [F.score(id,parent),{collection:C.dishSearchIndexCollection,id:data.indexDocumentId,data}];
}
function destination(center,miles,bearing) {
  const angle=miles*1609.344/6378137,b=bearing*Math.PI/180,lat=center.latitude*Math.PI/180,lon=center.longitude*Math.PI/180;
  const y=Math.asin(Math.sin(lat)*Math.cos(angle)+Math.cos(lat)*Math.sin(angle)*Math.cos(b));
  const x=lon+Math.atan2(Math.sin(b)*Math.sin(angle)*Math.cos(lat),Math.cos(angle)-Math.sin(lat)*Math.sin(y));
  return {latitude:y*180/Math.PI,longitude:wrap(x*180/Math.PI)};
}
function edgeDocuments() {
  const docs=[];
  for (const [ci,center] of centers.entries()) for(const radius of radii)
    for(const bearing of [0,45,90,135,180,225,270,315]) for(const factor of [1-1e-12,1,1+1e-12]) {
      const point=destination(center,radius*factor,bearing),id=`query006-edge-${docs.length}`;
      docs.push(F.score(id,F.scoreSource(60_000+docs.length,{name:`Synthetic Radius Edge ${id}`,location:new GeoPoint(point.latitude,point.longitude)})));
    }
  for(const [i,point] of F.nearTie.entries()) docs.push(F.score(`query006-tie-${i}`,F.scoreSource(70_000+i,
    {name:i?'A exact tie':'Z exact tie',location:new GeoPoint(point.latitude,point.longitude)})));
  return docs;
}
function saver(overrides={}) { return {space:'saver',kind:'restaurant',center:F.center,radiusMiles:15,text:'',typedLocation:null,timeZone:'America/New_York',locationMode:'typed',...overrides}; }
function score(overrides={}) { const criteria=SC.parseCustomerBiteScoreCriteria({kind:'restaurant',center:F.center,radiusMiles:15,text:'',sort:'Closest',...overrides});return {space:'score',kind:criteria.kind,criteria}; }
function cases() {
  const values=[];
  for(const [ci,center] of centers.entries()) for(const radius of radii)
    values.push({name:`radius-${ci}-${radius}`,criteria:score({center,radiusMiles:radius})});
  for(const extra of [{},{text:'noodle'},{text:'Rare Juniper'},{typedLocation:{kind:'zip',zip:'33101'}}])
    values.push({name:`saver-${values.length}`,criteria:saver(extra)});
  for(const sort of ['Highest BiteScore','Closest','Most Reviewed','Best Value','Best Flavor','Highest Quality','Most Enjoyed','Dish Name'])
    values.push({name:`dish-sort-${sort}`,criteria:score({kind:'dish',sort,...(sort==='Dish Name'?{restaurantId:'query006-041001'}:{})})});
  for(const text of ['s','Rare Juniper','submarine','hambuger','not-a-real-rare-word'])
    values.push({name:`text-${text}`,criteria:score({kind:'dish',text})});
  values.push({name:'category',criteria:score({kind:'dish',categoryQueries:['burgers']})});
  for(const mode of ['suggestions','close'])values.push({name:`finder-${mode}`,criteria:score({center:null,text:'Rare Juniper Catalog',finder:{state:'FL',location:mode==='close'?'Miami':'331',mode}})});
  return values;
}
function tupleCompare(a,b) { for(let i=0;i<a.length;i++) if(a[i]!==b[i])return a[i]<b[i]?-1:1;return 0; }
function key(text) { return SC.customerBiteScoreUtf16Key(text).toString('hex'); }
// Exhaustive native oracle: independently regenerate source projections and call
// the existing native predicates. No SQL recall/ranking expression decides an ID.
function oracle(groups,queries) {
  const output=queries.map(()=>[]);
  for(const docs of groups) {
    const p=docs[0],space=p.data.source==='biteSaver'?'saver':'score';
    const parent=space==='saver'?p.data:SC.readCustomerBiteScorePublicProjection({id:p.id,path:`${p.collection}/${p.id}`,data:p.data},'restaurant');
    if(!parent)continue;
    for(const [qi,{criteria:c}] of queries.entries()) {
      if(c.space!==space)continue;
      if(space==='saver') {
        if(parent.publicVisible!==true)continue;
        const distance=Geo.exactCustomerBiteSaverDistanceMiles(c.center,parent);
        if(distance>c.radiusMiles)continue;
        if(!docs.slice(1).some(({data:o})=>o.customerDiscoverable===true&&o.customerParentEligibilityFingerprint===parent.customerParentEligibilityFingerprint&&
          Availability.evaluateCustomerBiteSaverOfferAvailability({offerType:o.offerType,offer:o,parentEligible:true,now:F.now,timeZone:c.timeZone,locationMode:c.locationMode,restaurantCoordinates:parent,currentCoordinates:null,usage:null}).visible&&
          (Saver.customerBiteSaverRestaurantMatches(c.text,parent)||(o.searchMatchComplete===true&&Saver.customerBiteSaverMatchValuesContain(c.text,o.searchMatchValues)))))continue;
        const preferred=Contract.customerBiteSaverExactLocationPreference({typedLocation:c.typedLocation,restaurantCity:parent.city,restaurantState:parent.state,restaurantZipCode:parent.zipCode});
        output[qi].push({id:parent.sourceDocumentId,tuple:[preferred?0:1,preferred?0:distance,0,key(parent.displayName.toLowerCase()),key(parent.sourceDocumentId)]});
      } else {
        for(const doc of c.kind==='restaurant'?[p]:docs.slice(1)) {
          const dto=SC.readCustomerBiteScorePublicProjection({id:doc.id,path:`${doc.collection}/${doc.id}`,data:doc.data},c.kind);
          if(!dto)continue;
          const rank=Score.matchAndRank(c.criteria,dto,parent);
          if(rank)output[qi].push({id:doc.data.sourceDocumentId,tuple:[rank.rank0,rank.rank1,rank.rank2,key(dto.displayName.toLowerCase()),key(doc.data.sourceDocumentId)]});
        }
      }
    }
  }
  return output.map(rows=>rows.sort((a,b)=>tupleCompare(a.tuple,b.tuple)));
}
function* groups() { for(let i=0;i<dimensions.parents;i++)yield documentsFor(i);for(const d of edgeDocuments())yield[d]; }
async function seed(pool) {
  const existing=Number((await pool.query("SELECT count(*) AS n FROM entities WHERE id LIKE 'query006-%' AND kind='restaurant'")).rows[0].n);
  const expected=dimensions.parents+edgeDocuments().length;
  if(existing===expected)return{reused:true,parentCount:expected};
  assert.equal(existing,0,'partial fixture retained; inspect failure before deliberate repair');
  let template=null;
  await insertEntity({async query(text){template=text;return {rows:[],rowCount:0};}}, {}, 1);
  let batch=[],entities=0;
  const flush=async()=>{if(!batch.length)return;await pool.query(template,[JSON.stringify(batch),1]);entities+=batch.length;batch=[];};
  for(const docs of groups())for(const doc of docs) {
    const projection=S.encodePostgisProjection(doc.collection,doc.id,doc.data);assert(projection);
    batch.push(O.entityFromProjection({id:doc.id,path:`${doc.collection}/${doc.id}`,data:S.decodePostgisProjection(projection)},projection));
    if(batch.length>=100)await flush();
  }
  await flush();await pool.query('ANALYZE entities');return{reused:false,parentCount:expected,entities};
}
function summarizePlan(plan) {
  const indexes=[],nodes=[];let removed=0,rows=0;
  function visit(n){nodes.push(n['Node Type']);if(n['Index Name'])indexes.push(n['Index Name']);removed+=(n['Rows Removed by Filter']||0)*(n['Actual Loops']||1);rows+=n['Actual Rows']||0;for(const child of n.Plans||[])visit(child);}
  visit(plan.Plan);return{executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],indexes,nodes,removedByFilter:removed,nodeRows:rows,sharedHitBlocks:plan.Plan['Shared Hit Blocks'],sharedReadBlocks:plan.Plan['Shared Read Blocks']};
}

test('2D recall emits wrapped envelopes only in its proved latitude domain',()=>{
  for(const center of [{latitude:25,longitude:0},{latitude:0,longitude:179.9},{latitude:0,longitude:-179.9}]) {
    const plan=Q.queryPlan({criteria:saver({center}),revision},null,64,{lowerBound:true});
    assert(plan.text.includes('geo::geometry'));
    assert.equal((plan.text.match(/ST_MakeEnvelope/g)||[]).length,Math.abs(center.longitude)>179?2:1);
  }
  for(const center of [{latitude:60,longitude:0},{latitude:-60,longitude:0},{latitude:85,longitude:179.9}])
    assert(!Q.queryPlan({criteria:saver({center}),revision},null,64,{lowerBound:true}).text.includes('ST_MakeEnvelope'));
});

test('actual 50k-parent SQL plans, conservative recall and exhaustive native oracle',
  {skip:process.env.BS_POSTGIS_006_SQL_TEST!=='1',timeout:900_000},async()=>{
    const pool=createLocalPostgisPool({host:'127.0.0.1',port:55441,database:'bsgate0_query006',user:'bsgate0'});
    const evidence={kind:'real local PostGIS50k query qualification; synthetic projections; no billed-read or hosted claim',startedAt:new Date().toISOString(),dimensions,queries:[],plans:[]};
    try {
      assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,'bsgate0_query006');
      await pool.query(fs.readFileSync(path.join(__dirname,'../search_candidate/schema.sql'),'utf8'));
      evidence.seed=await seed(pool);
      evidence.server=(await pool.query('SELECT version(),postgis_full_version()')).rows[0];
      evidence.seqscan=(await pool.query('SHOW enable_seqscan')).rows[0];
      assert.equal(evidence.seqscan.enable_seqscan,'on');
      const queries=cases();
      // Include pre-existing185-row baseline fixture independently in the oracle.
      const baseline=F.dataset({saverParents:35,scoreParents:30,includeCases:false});
      const baselineGroups=[];
      for(const p of baseline.documents.filter(d=>d.data.entityType==='restaurant')) {
        const parent=p.data.sourceDocumentId;
        baselineGroups.push([p,...baseline.documents.filter(d=>d.data.entityType!=='restaurant'&&
          (d.data.restaurantSourceDocumentId===parent||Saver.decodeDartUtf16FirestoreBytesOrderKey(d.data.restaurantAccountId,1500)===parent))]);
      }
      const oracleStart=performance.now(),expected=oracle((function*(){yield*groups();yield*baselineGroups;})(),queries);
      evidence.oracleMsOutsideQueryTiming=performance.now()-oracleStart;
      const old=process.env.BS_POSTGIS_BASELINE_LIB?require(path.join(process.env.BS_POSTGIS_BASELINE_LIB,'postgis_query.js')):null;
      for(const [qi,{name,criteria}] of queries.entries()) {
        const session={criteria,revision,membership_ms:F.now.getTime()},want=expected[qi];
        // Unbounded exhaustive recall is a separate diagnostic, never a serving request.
        const recall=Q.queryPlan(session,null,100_000,{lowerBound:true});
        recall.text=recall.text.replace('SELECT * FROM ranked','SELECT id FROM ranked');
        const candidates=new Set((await pool.query(recall)).rows.map(r=>r.id));
        for(const row of want)assert(candidates.has(row.id),`${name}: recall omitted ${row.id}`);
        let boundary=null,actual=[],partials=0,sqlStatements=0,returnedRows=0,jsonBytes=0;
        const measured={async query(sql,values){sqlStatements++;const r=await pool.query(sql,values);returnedRows+=r.rows.length;jsonBytes+=Buffer.byteLength(JSON.stringify(r.rows));return r;}};
        const start=performance.now();
        for(let page=0;page<2;page++) {
          let result;
          for(let attempt=0;attempt<1000;attempt++) {
            result=await Q.select(measured,session,boundary,{size:26,budget:64,chunk:64,timeBudgetMs:4000});
            if(!result.partial)break;partials++;assert.equal(result.items.length,0);boundary=result.boundary;
          }
          assert(result&&!result.partial,'bounded continuation failed');
          actual.push(...result.items.map(r=>r.id));
          assert.equal(result.hasMore,want.length>actual.length,name);
          if(!result.hasMore)break;boundary=result.boundary;
        }
        const elapsedMs=performance.now()-start;
        assert.deepEqual(actual,want.slice(0,actual.length).map(r=>r.id),name);
        const observation={name,expectedCount:want.length,recallCount:candidates.size,returnedItems:actual.length,partials,sqlStatements,returnedRows,jsonBytes,elapsedMs,
          orderedIdSha256:crypto.createHash('sha256').update(JSON.stringify(actual)).digest('hex')};
        evidence.queries.push(observation);
        // Each emitted shape, including all radii, is explained without forced indexes.
        for(const [mode,implementation] of old?[['baseline',old],['envelope',Q]]:[['envelope',Q]]) {
          const plan=implementation.queryPlan(session,null,64,{lowerBound:true});
          const explained=(await pool.query({text:'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+plan.text,values:plan.values})).rows[0]['QUERY PLAN'][0];
          evidence.plans.push({name,mode,sql:plan.text,values:plan.values,...summarizePlan(explained),raw:explained});
        }
        console.log(JSON.stringify(observation));
      }
      const tie=expected[queries.findIndex(q=>q.name==='radius-0-1')].map(r=>r.id);
      assert(tie.indexOf('query006-tie-1')>=0&&tie.indexOf('query006-tie-1')<tie.indexOf('query006-tie-0'));
      evidence.finishedAt=new Date().toISOString();
    } finally {
      if(process.env.BS_POSTGIS_006_EVIDENCE)fs.writeFileSync(process.env.BS_POSTGIS_006_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
      await pool.end();
    }
  });

test('Finder close bounded ASCII fast path exactly matches native scores and long fallback',
  {skip:process.env.BS_POSTGIS_006_SQL_TEST!=='1',timeout:120_000},async()=>{
    const pool=createLocalPostgisPool({host:'127.0.0.1',port:55441,database:'bsgate0_query006',user:'bsgate0'});
    const Matcher=require('../lib/customer_bitescore_search_matcher.js');
    const pairs=[['',''],['a',''],['','a'],['Rare Juniper','Rare Juniper Catalog'],
      ['O’Brian & Sons','OBrian and Son'],['Café Résumé 東京','Cafe Resume'],
      ['Taco   Place!','taco place'],['one two three','one two four']];
    for(const length of [1,3,15,64,254,255,256,300,800]) {
      pairs.push(['a'.repeat(length-1)+'b','a'.repeat(length-1)+'c']);
      for(const delta of [-1,0,1]) {
        const changed=Math.max(0,Math.min(length,Math.floor(length*.45)+delta));
        pairs.push(['a'.repeat(length),'a'.repeat(length-changed)+'b'.repeat(changed)]);
      }
    }
    let state=62119;
    const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
    for(let i=0;i<120;i++) {
      const length=1+random()%255,chars=Array.from({length},()=>String.fromCharCode(97+random()%26));
      const changed=chars.map(c=>random()%5===0?String.fromCharCode(97+random()%26):c);
      pairs.push([chars.join(''),changed.join('')]);
    }
    try {
      await pool.query(fs.readFileSync(path.join(__dirname,'../search_candidate/schema.sql'),'utf8'));
      for(const [name,query] of pairs) {
        const tokens=value=>value.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
        const result=await pool.query('SELECT finder_close_score($1,$2,$3::text[],$4::text[]) AS score',
          [Matcher.normalizeBiteScoreFinderText(name),Matcher.normalizeBiteScoreFinderText(query),tokens(name),tokens(query)]);
        assert.equal(result.rows[0].score,Matcher.biteScoreFinderCloseScore(query,name),`Finder exact score ${name.length}/${query.length}`);
      }
      console.log(JSON.stringify({finderExactNativeScoreVectors:pairs.length,maximumLength:800,includes255And256:true}));
    }finally{await pool.end();}
  });
