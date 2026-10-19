// Deterministic local-only Google doubles. No network or Firebase initialization.
function candidate(query="Ocala, FL") {
 const zip=/^\d/.test(query);const c=(name,type,short=name)=>({long_name:name,short_name:short,types:[type]});
 return {types:zip?["postal_code"]:["locality","political"],geometry:{location:{lat:29.18,lng:-82.14},location_type:"APPROXIMATE"},
 address_components:[c("United States","country","US"),c("Florida","administrative_area_level_1","FL"),c(zip?query.slice(0,5):"34461","postal_code"),c("Ocala","locality")],formatted_address:"Ocala, FL, USA"};
}
function request(query="Ocala, FL"){return {schemaVersion:1,query,clientInstanceId:"local_fixture_instance_123"};}
function dependencies(query="Ocala, FL") {
 const d={calls:[],reservations:0,releases:0,payload:{status:"OK",results:[candidate(query)]},getGeocodingApiKey:()=>"FAKE_KEY_SENTINEL",dailyLimit:()=>250,
 reserve:async()=>{d.reservations++;return async()=>{d.releases++;};},fetchGeocoding:async(url)=>{d.calls.push(url);return {ok:true,json:async()=>d.payload};}};return d;
}
function fakeDatabase(){
 const db={data:undefined};let queue=Promise.resolve();const ref={};db.doc=()=>ref;
 db.runTransaction=fn=>{const run=queue.then(()=>fn({get:async()=>({data:()=>structuredClone(db.data),get:k=>db.data?.[k]}),set:(_,v)=>{db.data=structuredClone(v);},update:(_,v)=>{db.data={...db.data,...structuredClone(v)};}}));queue=run.catch(()=>{});return run;};return db;
}
module.exports={candidate,request,dependencies,fakeDatabase};
