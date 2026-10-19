const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const api=require(path.resolve(process.env.POSTGIS_TEST_LIB||path.join(__dirname,'../lib'),'postgis_synthetic_workload.js'));
const runId='bs-postgis-workload-test',base={version:1,planId:'representative-v1',offset:0,count:25000,nowMs:1780000000000,
 operation:'seed',distribution:'mixed-national-v1',maxParentsPerInvocation:2500,maxInvocations:32,maxSourceOperations:3000000,maxSourceBytes:2147483648};
test('50k parent roots fit finite work/reservation bounds without claiming elapsed qualification',()=>{
 const b=api.postgisSyntheticWorkloadBudget(runId,base);
 assert.equal(b.datasetCounts.saverParents,25000);assert.equal(b.datasetCounts.scoreParents,25000);assert.equal(b.datasetCounts.totalParentRoots,50000);
 assert.equal(b.datasetCounts.rawDocuments,b.datasetCounts.totalParentRoots+b.datasetCounts.offers+b.datasetCounts.dishes+b.datasetCounts.aggregates);
 assert.ok(b.minimumInvocationsByWorkBounds<=32);assert.equal(b.maximumReservedActiveSeconds,19200);
 assert.ok(b.reservationCounts.writes*32<=40000000);assert.ok(b.reservationCounts.reads*32<=200000000);
 assert.equal(b.timingQualified,false);assert.match(b.units.count,/pairs/);
});
test('deterministic scenarios include distinct namespaces, variable children, actual usage rules, aliases and long suppressed cohort',()=>{
 const states=new Set(),childCounts=new Set();let suppressed=0;const cases=new Set();
 for(let i=0;i<1000;i++){
  const p=api.postgisSyntheticParent(runId,i,base.nowMs);assert.notEqual(p.saverId,p.scoreId);childCounts.add(p.couponIds.length);
  if(p.scenario.national)states.add(p.rows[0].data.state);
  for(const [key,value] of Object.entries(p.scenario))if(value)cases.add(key);
  for(const row of p.rows)assert.ok(!/users|redemptions|payment|auth/.test(row.path));
  if(p.scenario.historyCohort&&!p.scenario.hidden&&!p.scenario.expired&&!p.scenario.scheduled&&!p.scenario.noOffer){
   assert.equal(p.historyOfferOrdinals.length,p.couponIds.length);suppressed++;
   assert.equal(p.rows[0].data.latitude,25.77);assert.equal(p.rows[0].data.longitude,-80.19);
  }
  assert.deepEqual(api.postgisSyntheticParent(runId,i,base.nowMs),p);
 }
 assert.deepEqual([...states].sort(),['CA','NY','TX','WA']);
 for(const size of [0,1,2,3,10,100])assert.ok(childCounts.has(size));
 for(const c of ['hidden','expired','scheduled','noOffer','national','sparse','historyCohort'])assert.ok(cases.has(c));
 assert.ok(suppressed>=75);
});
test('offset/reservation/operation/byte/shape guards stay finite',()=>{
 for(const change of [{offset:100000},{count:80001},{maxInvocations:33},{maxParentsPerInvocation:2501},
  {maxSourceOperations:3000001},{maxSourceBytes:2147483649},{extra:true},{count:50000,maxParentsPerInvocation:25},
  {distribution:'arbitrary-data'},{operation:'write-path'}])assert.throws(()=>api.validatePostgisSyntheticWorkload(runId,{...base,...change}));
 assert.throws(()=>api.postgisSyntheticWorkloadBudget(runId,{...base,maxSourceOperations:1}));
 assert.throws(()=>api.postgisSyntheticParent('real-account',0,base.nowMs));
});
