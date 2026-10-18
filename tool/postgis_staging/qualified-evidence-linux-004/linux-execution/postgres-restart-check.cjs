"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),crypto=require("node:crypto"),{execFile}=require("node:child_process"),{promisify}=require("node:util");
const repo="/app";
const {createLocalPostgisPool}=require(repo+"/functions/lib/postgis_store.js");
const {select}=require(repo+"/functions/lib/postgis_query.js");
const {parseCustomerBiteScoreCriteria}=require(repo+"/functions/lib/customer_bitescore_search_contract.js");
const {postgisCanonicalJson}=require(repo+"/functions/lib/postgis_source.js");
const root=__dirname, dataDirectory="/var/lib/postgresql/18/docker";
if(process.env.BS_POSTGIS_RESTART_TEST!=="1")throw Error("Explicit coordinated task-local restart gate required");
const pool=createLocalPostgisPool({host:"127.0.0.1",port:55441,database:"bsgate0_flutter",user:"bsgate0"});
const hash=value=>crypto.createHash("sha256").update(postgisCanonicalJson(value)).digest("hex");
async function snapshot(){
  const meta=(await pool.query("SELECT current_database() AS database,current_user AS owner,inet_server_addr()::text AS address,current_setting('data_directory') AS directory,version() AS version,pg_postmaster_start_time() AS started_at")).rows[0];
  assert.equal(meta.database,"bsgate0_flutter");assert.equal(meta.owner,"bsgate0");assert.equal(meta.directory,dataDirectory);assert.equal(meta.address,"127.0.0.1/32");
  const publication=(await pool.query("SELECT revision,fence FROM publication WHERE singleton")).rows[0];
  const counts=(await pool.query("SELECT (SELECT count(*)::int FROM entities) AS entities,(SELECT count(*)::int FROM source_heads) AS heads,(SELECT count(*)::int FROM revision_pins) AS pins")).rows[0];
  assert(counts.entities<10000&&counts.heads<10000&&counts.pins<10000,"only the bounded synthetic fixture is authorized");
  const heads=(await pool.query("SELECT index_path,shard,payload,digest FROM source_heads ORDER BY index_path")).rows;
  const entities=(await pool.query("SELECT * FROM entities ORDER BY space,kind,id,valid_from")).rows;
  // pg bytea needs JSON serialization before canonical source JSON hashing.
  const pins=(await pool.query("SELECT * FROM revision_pins ORDER BY id")).rows;
  const active=pins.filter(pin=>Number(pin.expires_ms)>Date.now()+60000);assert(active.length>0,"an actual active fixture session pin must survive");
  const criteria=parseCustomerBiteScoreCriteria({kind:"restaurant",center:{latitude:25.77,longitude:-80.19},radiusMiles:15,text:"",sort:"Closest"});
  const result=await select(pool,{revision:publication.revision,criteria:{space:"score",kind:"restaurant",criteria},membership_ms:Date.now()},null,{size:25});
  assert.equal(result.partial,false);assert(result.items.length>0);
  return {meta,publication,counts,sourceHeadsHash:hash(heads),entitiesHash:hash(JSON.parse(JSON.stringify(entities))),pinsHash:hash(pins),activePin:active[0],orderedIds:result.items.map(row=>row.id),boundary:result.boundary};
}
(async()=>{
  const before=await snapshot();
  const old=await pool.connect();let oldError=null;old.on?.("error",error=>{oldError=error.code||error.message;});
  const backend=(await old.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const activeQuery=old.query("SELECT pg_sleep(10)").then(()=>({unexpectedSuccess:true}),error=>({code:error.code||null,message:error.message}));
  for(let attempt=0;attempt<20;attempt++){
    const active=(await pool.query("SELECT state,query FROM pg_stat_activity WHERE pid=$1",[backend])).rows[0];
    if(active?.state==="active"&&active.query.includes("pg_sleep"))break;
    if(attempt===19)throw Error("did not observe active interrupted query");
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const restartStarted=Date.now();
  // Root orchestrator restarts only the task-owned PostgreSQL process. No Docker socket enters this workload.
  fs.writeFileSync(root+"/restart-request.json",JSON.stringify({backend,beforeStartedAt:before.meta.started_at}));
  while(!fs.existsSync(root+"/restart-completed.json")) {
    if(Date.now()-restartStarted>45000)throw Error("Task-local restart coordinator did not finish");
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const processResult={stdout:fs.readFileSync(root+"/restart-completed.json","utf8")};
  const failure=await activeQuery;assert.equal(failure.unexpectedSuccess,undefined);assert.equal(failure.code,"57P01");
  await assert.rejects(old.query("SELECT 1"));old.release(true);
  const after=await snapshot();
  for(const key of ["publication","counts","sourceHeadsHash","entitiesHash","pinsHash","activePin","orderedIds","boundary"])assert.deepEqual(after[key],before[key],key);
  assert.notEqual(after.meta.started_at.toISOString(),before.meta.started_at.toISOString());
  const result={pass:true,taskOwnedCluster:dataDirectory,sameSyntheticDatasetPreserved:true,activeQueryFailure:failure,oldConnectionError:oldError,oldConnectionRejected:true,boundedPoolReconnected:true,elapsedMs:Date.now()-restartStarted,before,after,pgCtlOutput:processResult.stdout.trim(),restartKind:"actual PostgreSQL server fast restart; no data reset",qualification:"local only; no hosted failover or crash/power-loss claim"};
  fs.writeFileSync(root+"/postgres-restart-evidence.json",JSON.stringify(result,null,2));console.log(JSON.stringify({pass:true,revision:after.publication.revision,counts:after.counts,activeQueryFailure:failure.code,boundedPoolReconnected:true,elapsedMs:result.elapsedMs}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pool.end());
