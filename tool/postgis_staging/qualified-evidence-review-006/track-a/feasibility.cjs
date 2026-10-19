'use strict';
// Report-only feasibility experiment. No serving strategy or runtime guard change.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const selected=path.resolve(__dirname,'../selected-source/functions'),file=selected+'/test/postgis_query_006.test.cjs';
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(path.dirname(file));
const actual=Module.createRequire(file);fixture.require=id=>id==='node:test'?()=>undefined:actual(id);
fixture._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports={cases,oracle,groups,tupleCompare};',file);
const F=fixture.exports,Q=actual('../lib/postgis_query.js'),Score=actual('../lib/customer_bitescore_search.js');
const {createLocalPostgisPool}=actual('../lib/postgis_store.js');
(async()=>{
 actual('../lib/postgis_runtime.js').requireQualifiedPostgisRuntime();
 const pool=createLocalPostgisPool({host:'127.0.0.1',port:55441,database:'bsgate0_query006',user:'bsgate0'});
 const result={kind:'report-only complete conservative recall plus native bounded-heap feasibility; not serving code',runtime:{node:process.version,v8:process.versions.v8},startedAt:new Date().toISOString(),cases:[]};
 try{
  const names=['radius-0-1','radius-0-15','radius-4-30','finder-close'],cases=F.cases().filter(c=>names.includes(c.name));
  const expected=F.oracle(F.groups(),cases); // exhaustive independently regenerated source, outside timing
  for(const [ci,{name,criteria}] of cases.entries()){
   const plan=Q.queryPlan({criteria,revision:'1'},null,64,{lowerBound:true});
   const from=plan.text.slice(plan.text.indexOf('FROM entities'),plan.text.indexOf(') SELECT * FROM ranked'));
   let boundary=null,heap=[],queries=0,rows=0,bytes=0,complete=false,rounds=[];
   const pageSize=name==='finder-close'?8:26;
   const start=performance.now();
   while(!complete){
    const roundStart=performance.now();let roundQueries=0;
    while(roundQueries<64&&performance.now()-roundStart<4000){
     const values=[...plan.values],v=x=>{values.push(x);return '$'+values.length;};
     let sql=`SELECT r.id,r.dto,r.name_key,r.id_key,${criteria.kind==='dish'?'p':'r'}.dto AS parent_dto ${from} AND r.id LIKE 'query006-%'`;
     if(boundary)sql+=` AND (r.name_key,r.id_key)>(decode(${v(boundary[0])},'hex'),decode(${v(boundary[1])},'hex'))`;
     sql+=' ORDER BY r.name_key,r.id_key LIMIT 128';
     // Eliminate parameters belonging only to removed SQL rank expressions.
     const numbers=[...new Set([...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b),positions=new Map(numbers.map((n,i)=>[n,i+1]));
     sql=sql.replace(/\$(\d+)/g,(_,n)=>'$'+positions.get(Number(n)));
     const batch=(await pool.query({text:sql,values:numbers.map(n=>values[n-1])})).rows;queries++;roundQueries++;rows+=batch.length;bytes+=Buffer.byteLength(JSON.stringify(batch));
     for(const row of batch){
      boundary=[row.name_key.toString('hex'),row.id_key.toString('hex')];
      const rank=Score.matchAndRank(criteria.criteria,row.dto,row.parent_dto);
      if(rank){const tuple=[rank.rank0,rank.rank1,rank.rank2,...boundary];heap.push({id:row.id,tuple});heap.sort((a,b)=>F.tupleCompare(a.tuple,b.tuple));if(heap.length>pageSize+1)heap.pop();}
     }
     if(batch.length<128){complete=true;break;}
    }
    rounds.push({queries:roundQueries,elapsedMs:performance.now()-roundStart,ready:complete});
    assert(rounds.length<100,'bounded experiment failed to converge');
   }
   const elapsedMs=performance.now()-start;
   assert.deepEqual(heap.map(r=>r.id),expected[ci].slice(0,pageSize+1).map(r=>r.id));
   const observation={name,exactExpectedCount:expected[ci].length,queries,rows,bytes,elapsedMs,rounds,heapMaximum:pageSize+1,firstUsefulResultRequiresCompleteEnumeration:true};
   result.cases.push(observation);console.log(JSON.stringify(observation));
  }
  result.finishedAt=new Date().toISOString();
 }finally{fs.writeFileSync(__dirname+'/feasibility.json',JSON.stringify(result,null,2)+'\n');await pool.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
