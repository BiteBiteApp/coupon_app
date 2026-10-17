"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createHmac} = require("node:crypto");
const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");
const C = require("../lib/customer_search_callable_context.js");
const R = require("../lib/postgis_staging_runtime.js");
const M = require("../lib/search_index_maintenance.js");
const {requireQualifiedPostgisRuntime} = require("../lib/postgis_runtime.js");
const qualifiedRuntime = process.env.BS_POSTGIS_RUNTIME_TEST === "1";

test("shared verified callable contexts ignore payload identities and preserve native actor domains", () => {
  const root = Buffer.alloc(32, 61), instance = "synthetic-instance-0001";
  const request = {auth: {uid: "verified-user", token: {firebase: {sign_in_provider: "password"}}},
    data: {clientInstanceId: instance, uid: "spoof", actorId: "spoof"}};
  assert.deepEqual(C.customerBiteSaverCallableIdentity(request), {authUid: "verified-user", authIsAnonymous: false});
  assert.deepEqual(C.customerBiteSaverCallableIdentity({data: request.data}), {authUid: null, authIsAnonymous: false});
  const key = createHmac("sha256", root).update("bitestar.customer-bitescore.cursor-key.v1").digest();
  assert.equal(C.customerBiteScoreCallableContext(request, root).actorId,
    C.customerBiteScoreActorBinding(key, "verified-user", instance));
  assert.notEqual(C.customerBiteScoreCallableContext({...request, auth: undefined}, root).actorId,
    C.customerBiteScoreCallableContext(request, root).actorId);
  assert.throws(() => C.customerBiteScoreCallableContext({...request, data: {clientInstanceId: "short"}}, root), /Invalid BiteScore client/);
  assert.throws(() => C.customerBiteScoreCallableContext({...request, data: {clientInstanceId: "short"}},
    () => { throw new Error("invalid request must not access a secret"); }), /Invalid BiteScore client/);
});

test("candidate numerical guard rejects option changes even after a cached qualification", {skip: !qualifiedRuntime}, () => {
  requireQualifiedPostgisRuntime();
  const original = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = "--jitless";
    assert.throws(requireQualifiedPostgisRuntime, /flags are unqualified/);
  } finally {
    if (original === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = original;
  }
  process.execArgv.push("--jitless");
  try { assert.throws(requireQualifiedPostgisRuntime, /flags are unqualified/); }
  finally { process.execArgv.pop(); }
});

test("inert staging registration rejects wrong targets and reuses exact native source handlers", {skip: !qualifiedRuntime}, async () => {
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore} = require("firebase-admin/firestore");
  const {getAuth} = require("firebase-admin/auth");
  const beforeFirestore = process.env.FIRESTORE_EMULATOR_HOST, beforeAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8088";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  const projectId = "demo-bs-postgis-registration";
  const app = initializeApp({projectId}, "inert-postgis-registration");
  const database = getFirestore(app);
  const options = {database, auth: getAuth(app), projectId, allowedProjectIds: [projectId], epoch: "inert-registration-v1",
    sql: {host: "127.0.0.1", port: 55441, database: "bsgate0_query", user: "bsgate0"},
    discoveryKey: Buffer.alloc(32, 61), identityKeyV1: Buffer.alloc(32, 63), scoreCursorRootKey: Buffer.alloc(32, 65)};
  let runtime;
  const originals = {};
  try {
    for (const change of [{projectId: "coupon-app-29446"}, {allowedProjectIds: [projectId, "another-project"]},
      {scoreCursorRootKey: Buffer.alloc(31)}, {sql: {...options.sql, host: "cloud-sql.example"}}]) {
      assert.throws(() => R.createLocalPostgisStagingRuntime({...options, ...change}), /explicit demo project|isolated local/);
    }
    process.env.FIRESTORE_EMULATOR_HOST = "example.com:8088";
    assert.throws(() => R.createLocalPostgisStagingRuntime(options), /loopback emulators/);
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8088";
    runtime = R.createLocalPostgisStagingRuntime(options);
    const callables = runtime.registerCallables();
    assert.deepEqual(Object.keys(callables), [...R.postgisStagingCallableNames]);
    assert(Object.values(callables).every(value => value.__endpoint.callableTrigger));
    const calls = [];
    for (const name of ["handleBiteSaverRestaurantWrite", "handleBiteScoreRestaurantWrite", "reconcileBiteScoreDishIndex",
      "handleBiteSaverCouponOfferWrite", "handleBiteSaverDailySpecialOfferWrite", "processSearchIndexJob"]) {
      originals[name] = M[name]; M[name] = async (...args) => { calls.push({name, args}); };
    }
    const triggers = runtime.registerSourceTriggers();
    const expected = [
      ["maintainPostgisBiteSaverRestaurant", "restaurant_accounts/{restaurantAccountId}", "handleBiteSaverRestaurantWrite"],
      ["maintainPostgisBiteScoreRestaurant", "bitescore_restaurants/{restaurantId}", "handleBiteScoreRestaurantWrite"],
      ["maintainPostgisBiteScoreDish", "bitescore_dishes/{dishId}", "reconcileBiteScoreDishIndex"],
      ["maintainPostgisBiteScoreDishAggregate", "dish_rating_aggregates/{dishId}", "reconcileBiteScoreDishIndex"],
      ["maintainPostgisBiteSaverCoupon", "restaurant_accounts/{restaurantAccountId}/coupons/{couponId}", "handleBiteSaverCouponOfferWrite"],
      ["maintainPostgisBiteSaverDailySpecial", "restaurant_accounts/{restaurantAccountId}/daily_specials/{dailySpecialId}", "handleBiteSaverDailySpecialOfferWrite"],
      ["processPostgisSearchIndexJob", "private_search_index_jobs/{jobId}", "processSearchIndexJob"],
    ];
    assert.deepEqual(Object.keys(triggers), expected.map(row => row[0]));
    for (const [name, path, native] of expected) {
      const trigger = triggers[name];
      assert.equal(trigger.__endpoint.eventTrigger.eventFilterPathPatterns.document, path);
      assert.equal(trigger.__endpoint.eventTrigger.retry, true);
      await trigger.run({id: "synthetic-source-event-001", params: {restaurantAccountId: "synthetic-parent",
        restaurantId: "synthetic-catalog", dishId: "synthetic-dish", couponId: "synthetic-coupon",
        dailySpecialId: "synthetic-special", jobId: "synthetic-job"},
      data: {before: {exists: false}, after: {exists: true, data: () => ({synthetic: true})}}});
      assert.equal(calls.at(-1).name, native);
      assert.equal(calls.at(-1).args[0], runtime.maintenanceDatabase);
    }
    assert.equal(calls[0].args[1].sourceEventId, "synthetic-source-event-001");
    assert.equal(calls[0].args[1].before, null);
    assert.deepEqual(calls[0].args[1].after, {synthetic: true});
    assert.equal(calls.at(-1).args[3], options.identityKeyV1);
    assert.equal(runtime.pool.totalCount, 0, "registration must not contact SQL or initialize any resource");
    const productionIndex = readFileSync(resolve(__dirname, "../src/index.ts"), "utf8");
    assert(!productionIndex.includes("postgis_staging_runtime"));
    assert(!productionIndex.includes("export const startCustomerBiteSaverSearchV2"));
  } finally {
    for (const [name, original] of Object.entries(originals)) M[name] = original;
    if (runtime) await runtime.close();
    await database.terminate(); await deleteApp(app);
    if (beforeFirestore === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = beforeFirestore;
    if (beforeAuth === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = beforeAuth;
  }
});
