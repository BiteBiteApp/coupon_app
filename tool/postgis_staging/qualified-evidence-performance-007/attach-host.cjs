'use strict';
const {createRequire}=require('node:module'),{writeFileSync}=require('node:fs');
const req=createRequire(process.env.BS_PERF_SOURCE+'/functions/package.json');
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore'),{getAuth}=req('firebase-admin/auth');
const F=req('./test/fixtures/postgis_gate0.cjs');
// Inject only the existing context clock seam, never wall-clock deadlines or guards.
if(process.env.BS_PERF_NOW){const H=req('./lib/postgis_handlers.js'),original=H.createPostgisSearchHandlers;H.createPostgisSearchHandlers=(...args)=>Object.fromEntries(Object.entries(original(...args)).map(([name,fn])=>[name,(input,context)=>fn(input,{...context,now:()=>Date.parse(process.env.BS_PERF_NOW),nowMs:Date.parse(process.env.BS_PERF_NOW)})]));}
const {createLocalPostgisStagingRuntime,startLocalPostgisHttpHost}=req('./lib/postgis_staging_runtime.js');
async function main(){
 const projectId='demo-bs-postgis-flutter',app=initializeApp({projectId},'performance007'),db=getFirestore(app);
 const runtime=createLocalPostgisStagingRuntime({database:db,auth:getAuth(app),projectId,allowedProjectIds:[projectId],guestRestaurantWindow:true,epoch:'flutter-local-source-v1',sql:{host:'127.0.0.1',port:55441,database:'bsgate0_flutter_linux007repro',user:'bsgate0'},discoveryKey:Buffer.alloc(32,71),identityKeyV1:F.identityKeyV1,scoreCursorRootKey:Buffer.alloc(32,73)});
 let observed=runtime;
 if(process.env.BS_PERF_OBSERVER)observed=require(process.env.BS_PERF_OBSERVER).observe(runtime,db);
 const host=await startLocalPostgisHttpHost(observed,{port:8188});
 console.log(JSON.stringify({ready:true,fence:await runtime.source.readFence(),runtime:process.version,arch:process.arch,availabilityClock:process.env.BS_PERF_NOW??'original-real-clock'}));
 async function close(){await host.close();await runtime.close();await db.terminate();await deleteApp(app);}
 process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
}
main().catch(e=>{console.error(e);process.exitCode=1;});
