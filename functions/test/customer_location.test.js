const assert = require("node:assert/strict");
const test = require("node:test");
const {resolveCustomerLocationHandler, createCustomerLocationAdmission, customerLocationDailyLimit} = require("../lib/customer_location.js");
const {geocodeCustomerUsSearchCenter, normalizeCustomerLocationQuery} = require("../lib/restaurant_geocoding.js");
const {fakeDatabase, candidate, request, dependencies} = require("./fixtures/customer_location.js");

for (const query of ["34461", "34461-1234", "Ocala, FL", "  Ocala,  fl "]) {
  test(`valid ${query} uses one restricted provider call and minimal response`, async () => {
    const d = dependencies(query);
    const result = await resolveCustomerLocationHandler(request(query), null, d);
    assert.deepEqual(result, {schemaVersion:1, latitude:29.18, longitude:-82.14, provider:"google", cacheSeconds:86400});
    assert.equal(d.calls.length, 1); assert.equal(d.reservations, 1); assert.equal(d.releases, 1);
    const url = new URL(d.calls[0]);
    assert.equal(url.origin, "https://maps.googleapis.com");
    assert.equal(url.searchParams.get("components"), "country:US");
    assert.equal(url.searchParams.get("region"), "us");
    assert.equal(url.searchParams.get("address"), query.trim().startsWith("34461") ? "34461" : "Ocala, FL");
    assert.equal(JSON.stringify(result).includes("FAKE_KEY_SENTINEL"), false);
  });
}

test("unconfirmed city-only asks for state before admission/provider", async () => {
  const d = dependencies();
  for (const q of ["Springfield", "Ocala"]) await assert.rejects(resolveCustomerLocationHandler(request(q), null, d), e => e.code === "invalid-argument" && /state/.test(e.message));
  assert.equal(d.reservations,0); assert.equal(d.calls.length,0);
});

test("tight input boundary rejects malformed/street/URL/provider controls without costs", async () => {
  const d = dependencies();
  for (const q of ["", "123 Main St", "https://example.com", "3446", "34461-12", "Ocala, ZZ", "a".repeat(121), "Ocala\nFL", "Ocala, FL&key=x"]) {
    await assert.rejects(resolveCustomerLocationHandler(request(q), null, d), e => e.code === "invalid-argument");
  }
  for (const data of [null, [], {...request(), url:"x"}, {...request(), schemaVersion:2}, {...request(), clientInstanceId:"x"}]) await assert.rejects(resolveCustomerLocationHandler(data,null,d));
  assert.equal(d.reservations,0); assert.equal(d.calls.length,0);
});

const badResults = {
  partial: {partial_match:true}, malformedPartial:{partial_match:"true"}, business:{types:["establishment"]}, street:{types:["street_address"]},
  nonUs: {address_components:candidate().address_components.map(c => c.types.includes("country") ? {...c, short_name:"CA"} : c)},
  wrongCity: {address_components:candidate().address_components.map(c => c.types.includes("locality") ? {...c,long_name:"Miami",short_name:"Miami"} : c)},
  wrongState: {address_components:candidate().address_components.map(c => c.types.includes("administrative_area_level_1") ? {...c,short_name:"GA"} : c)},
  invalidCoordinate:{geometry:{location:{lat:Infinity,lng:-82},location_type:"APPROXIMATE"}},
  nonUsCoordinate:{geometry:{location:{lat:0,lng:0},location_type:"APPROXIMATE"}},
  rooftop:{geometry:{location:{lat:29.18,lng:-82.14},location_type:"ROOFTOP"}},
};
for (const [name, overrides] of Object.entries(badResults)) test(`reject ${name} result without exposing provider data`, async () => {
  const d = dependencies(); d.payload = {status:"OK",results:[{...candidate(),...overrides}]};
  await assert.rejects(resolveCustomerLocationHandler(request(),null,d),e => !e.message.includes("FAKE_KEY_SENTINEL"));
  assert.equal(d.calls.length,1); assert.equal(d.releases,1);
});

test("ZIP must match requested postal center; ambiguous candidates rejected", async () => {
  const d=dependencies("34461"); d.payload={status:"OK",results:[candidate("99999")]};
  await assert.rejects(resolveCustomerLocationHandler(request("34461"),null,d));
  d.payload={status:"OK",results:[candidate(),candidate()]};
  await assert.rejects(resolveCustomerLocationHandler(request(),null,d),e=>e.code==="failed-precondition");
});

test("bounded city-only helper never silently chooses among candidates", async () => {
  const d=dependencies(); d.payload={status:"OK",results:[candidate(),candidate()]};
  await assert.rejects(geocodeCustomerUsSearchCenter(normalizeCustomerLocationQuery("Ocala"),d));
});

test("missing configuration and default-closed allowance make zero requests",async()=>{
  for (const configure of [d=>d.getGeocodingApiKey=()=>"",d=>d.dailyLimit=()=>0]) {
    const d=dependencies();configure(d);
    await assert.rejects(resolveCustomerLocationHandler(request(),null,d),e=>e.code==="failed-precondition");
    assert.equal(d.calls.length,0);assert.equal(d.reservations,0);
  }
  for(const value of [undefined,"-1","251","1000","NaN","1.1"]) assert.equal(customerLocationDailyLimit(value),0);
  assert.equal(customerLocationDailyLimit("250"),250);
});

test("timeouts, provider failures and malformed JSON are sanitized with no retries",async()=>{
  for(const kind of ["timeout","network","json","status"]) {
    const d=dependencies();d.timeoutMilliseconds=5;
    d.fetchGeocoding=async()=>{d.calls.push("attempt");if(kind==="timeout")return new Promise(()=>{});if(kind==="network")throw Error("FAKE_KEY_SENTINEL raw private error");return {ok:true,json:async()=>{if(kind==="json")throw Error("FAKE_KEY_SENTINEL");return {status:"OVER_QUERY_LIMIT",error_message:"FAKE_KEY_SENTINEL"};}};};
    await assert.rejects(resolveCustomerLocationHandler(request(),null,d),e=>!e.message.includes("FAKE_KEY_SENTINEL") && (e.code==="deadline-exceeded"||e.code==="unavailable"||e.code==="internal"));
    assert.equal(d.calls.length,1);assert.equal(d.releases,1);
  }
});

test("transactional shared allowance survives rotating guests/concurrency/replays and failed providers",async()=>{
  const db=fakeDatabase(); const reserve=createCustomerLocationAdmission(db,()=>Date.UTC(2026,9,17));
  const outcomes=await Promise.allSettled(Array.from({length:8},(_,i)=>reserve(`actor${i}`,3)));
  assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,3);
  for(const r of outcomes)if(r.status==="fulfilled")await r.value();
  await assert.rejects(reserve("rotated",3),e=>e.code==="resource-exhausted");
  assert.equal(db.data.total.dayCount,3);assert.equal(Object.keys(db.data.active).length,0);
  assert.equal(Object.keys(db.data.actors).length,3);
});

test("actor minute, concurrency, day rollover and malformed state fail safely",async()=>{
  let at=Date.UTC(2026,9,17);const db=fakeDatabase();const reserve=createCustomerLocationAdmission(db,()=>at);
  for(let i=0;i<3;i++){const release=await reserve("same",250);await release();}
  await assert.rejects(reserve("same",250));
  const release=await reserve("other",250);
  at+=60_000; await (await reserve("same",250))(); await release();
  db.data.total.dayCount=-1;await assert.rejects(reserve("new",250),e=>e.code==="unavailable");
  at+=86400000;await (await reserve("fresh",250))();assert.equal(db.data.total.dayCount,1);
  const leases=[];for(let i=0;i<4;i++)leases.push(await reserve(`parallel${i}`,250));
  await assert.rejects(reserve("fifth",250));
  for(const r of leases)await r();
});

test("shared minute and actor daily ceilings hold after released requests",async()=>{
  let at=Date.UTC(2026,9,17);const db=fakeDatabase();const reserve=createCustomerLocationAdmission(db,()=>at);
  for(let i=0;i<20;i++)await (await reserve(`guest${i}`,250))();
  await assert.rejects(reserve("rotated-guest",250),e=>e.code==="resource-exhausted");
  for(let i=0;i<20;i++){at+=60_000;await (await reserve("daily-actor",250))();}
  at+=60_000;
  await assert.rejects(reserve("daily-actor",250),e=>e.code==="resource-exhausted");
  assert.equal(db.data.total.dayCount,40);
});

test("abandoned leases expire without refunding attempted-call allowance",async()=>{
  let at=Date.UTC(2026,9,17);const db=fakeDatabase();const reserve=createCustomerLocationAdmission(db,()=>at);
  for(let i=0;i<4;i++)await reserve(`abandoned${i}`,250);
  await assert.rejects(reserve("waiting",250),e=>e.code==="resource-exhausted");
  at+=30_001;await (await reserve("waiting",250))();
  assert.equal(db.data.total.dayCount,5);assert.equal(Object.keys(db.data.active).length,0);
});
