"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), crypto = require("node:crypto");
const repo = require("node:path").resolve(__dirname, "../../..");
if (process.platform !== "linux" || process.arch !== "x64" || process.version !== "v24.21.0" || process.execArgv.length || process.env.NODE_OPTIONS) throw Error("Run this diagnostic in the pinned Linux amd64 image without extra flags.");
const {createLocalPostgisPool} = require(repo + "/functions/lib/postgis_store.js");
const {queryPlan} = require(repo + "/functions/lib/postgis_query.js");
const geo = require(repo + "/functions/lib/restaurant_geo_helpers.js");
const {parseCustomerBiteScoreCriteria} = require(repo + "/functions/lib/customer_bitescore_search_contract.js");
const pool = createLocalPostgisPool({host:"127.0.0.1",port:55441,database:"bsgate0_linux",user:"bsgate0"});
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
(async()=>{
  // Diagnostic only: this does not call select(), change or bypass the serving runtime guard.
  const locations=[[-90,-180],[-90,180],[90,-180],[90,180],[0,1],[Number.MIN_VALUE,1],[-Number.MIN_VALUE,-1],[89.99999999999999,179.99999999999997],[-89.99999999999999,-179.99999999999997],[0,-179],[.00000001,179],[4.491576420597607,1],[.4491576420597607,1]];
  const pairs=[];
  for(const a of locations)for(const b of locations)pairs.push([{latitude:a[0],longitude:a[1]},{latitude:b[0],longitude:b[1]}]);
  for(const a of [-60.00000000000001,-60,-59.99999999999999,0,59.99999999999999,60,60.00000000000001])for(const b of [-60,0,60])for(const delta of [-4.000000000000001,-4,-3.9999999999999996,0,3.9999999999999996,4,4.000000000000001])pairs.push([{latitude:a,longitude:1},{latitude:b,longitude:1+delta}]);
  pairs.push([{latitude:25.77,longitude:-80.20},{latitude:25.77,longitude:-80.19}],[{latitude:60,longitude:180},{latitude:60,longitude:-180}]);
  let positive=0;
  for(const [a,b] of pairs){
    const criteria=parseCustomerBiteScoreCriteria({kind:"dish",center:a,radiusMiles:30,text:"",sort:"Closest"});
    const plan=queryPlan({revision:3,criteria:{space:"score",kind:"dish",criteria}},null,64,{lowerBound:true});
    let expression=plan.text.match(/,((?:\(greatest).*?) AS distance,/s)[1];
    expression=expression.replace(/\$(\d+)/g,(_,n)=>"("+String(plan.values[Number(n)-1])+")");
    const bound=(await pool.query("SELECT "+expression+" AS bound FROM (SELECT $1::float8 latitude,$2::float8 longitude) p",[b.latitude,b.longitude])).rows[0].bound;
    const exact=geo.exactCustomerBiteSaverDistanceMiles(a,b);
    assert(bound<=exact,JSON.stringify({a,b,bound,exact})); if(bound>0)positive++;
  }
  const cases=[];
  for(const center of [{latitude:25.77,longitude:-80.19},{latitude:0,longitude:179.9},{latitude:89.9,longitude:10},{latitude:-89.9,longitude:-170},{latitude:45,longitude:179.99},{latitude:-45,longitude:-179.99}])for(const radius of [1,3,5,10,15,20,30])for(let bearing=0;bearing<360;bearing+=30)for(const delta of [-1e-10,0,1e-10]){
    const a=(radius+delta)*1609.344/6378137,lat=center.latitude*Math.PI/180,lon=center.longitude*Math.PI/180,b=bearing*Math.PI/180;
    const lat2=Math.asin(Math.sin(lat)*Math.cos(a)+Math.cos(lat)*Math.sin(a)*Math.cos(b)),lon2=lon+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(lat),Math.cos(a)-Math.sin(lat)*Math.sin(lat2));
    const point={latitude:lat2*180/Math.PI,longitude:((lon2*180/Math.PI+540)%360)-180};
    const accepted=geo.exactCustomerBiteSaverDistanceMiles(center,point)<=radius;
    const span=(radius*1609.344+1)/(.99*111000)+1e-10;
    const recalled=point.latitude>=center.latitude-span&&point.latitude<=center.latitude+span;
    assert(!accepted||recalled);cases.push({accepted,recalled});
  }
  const result={kind:"Linux actual SQL expression/radius diagnostic; finite vectors are not runtime qualification",runtime:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,nodeSha256:sha(process.execPath)},server:(await pool.query("SELECT version() AS version")).rows[0].version,querySha256:sha(repo+"/functions/src/postgis_query.ts"),unchangedAuthoritativeGeometrySha256:sha(repo+"/functions/lib/restaurant_geo_helpers.js"),combinedBoundVectors:pairs.length,positiveBounds:positive,radiusEdgeVectors:cases.length,acceptedRadiusEdgeVectors:cases.filter(c=>c.accepted).length,missed:0,finiteSamplesAreNotUniversalProof:true,proofArtifact:"Retained original exact-rational audit must be independently reconciled with this Linux V8 build",servingRuntimeQualified:false,linuxDiagnosticOnly:true};
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pool.end());
