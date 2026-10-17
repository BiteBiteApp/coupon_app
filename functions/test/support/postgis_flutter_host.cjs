"use strict";

// Dedicated local integration fixture. It cannot provision or address a cloud
// target. No production entrypoint, flags or credentials are loaded.
const assert = require("node:assert/strict");
const {writeFileSync, appendFileSync} = require("node:fs");
const {AsyncLocalStorage} = require("node:async_hooks");
const {performance} = require("node:perf_hooks");
const {initializeApp, deleteApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
const F = require("../fixtures/postgis_gate0.cjs");
const M = require("../../lib/search_index_maintenance.js");
const {createLocalPostgisStagingRuntime, startLocalPostgisHttpHost} = require("../../lib/postgis_staging_runtime.js");

const projectId = "demo-bs-postgis-flutter";
assert.equal(process.env.BS_POSTGIS_FLUTTER_HOST, "1", "explicit local fixture opt-in required");
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8088");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
assert(!process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT === projectId);
assert(!process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT === projectId);

// Opted-in observation only: wrappers execute the same real operations and never
// retain request bodies, IDs, guest answers, SQL text, cursors or auth material.
function observe(runtime) {
  const destination = process.env.BS_POSTGIS_FLUTTER_TIMINGS;
  if (!destination) return runtime;
  const active = new AsyncLocalStorage();
  let sequence = 0;
  async function measure(kind, operation, paths = []) {
    const observation = active.getStore();
    if (!observation) return operation();
    const metric = observation.operations[kind] ??= {calls: 0, milliseconds: 0, failures: 0};
    metric.calls++;
    for (const path of paths) {
      observation.requestedDocuments++;
      if (observation.documentPaths.has(path)) observation.repeatedDocumentReads++;
      observation.documentPaths.add(path);
    }
    const start = performance.now();
    try { return await operation(); }
    catch (error) { metric.failures++; throw error; }
    finally { metric.milliseconds += performance.now() - start; }
  }
  function reads(target, prefix) {
    for (const name of ["getDocument", "getDocuments", "queryDocuments"]) {
      const original = target[name].bind(target);
      target[name] = (...args) => measure(`${prefix}.${name}`, () => original(...args),
        name === "getDocument" ? [args[0]] : name === "getDocuments" ? args[0] : []);
    }
  }
  reads(runtime.authority, "firestore");
  const commit = runtime.authority.commitWrites.bind(runtime.authority);
  runtime.authority.commitWrites = (...args) => measure("firestore.commitWrites", () => commit(...args));
  const transaction = runtime.authority.runTransaction.bind(runtime.authority);
  runtime.authority.runTransaction = operation => measure("firestore.transaction", () => transaction(tx => {
    reads(tx, "firestore.transactionRead");
    return operation(tx);
  }));
  for (const name of ["pinRevision", "queryResults"]) {
    const original = runtime.provider[name].bind(runtime.provider);
    runtime.provider[name] = (...args) => measure(`membership.${name}`, () => original(...args));
  }
  const withPinnedRevision = runtime.model.withPinnedRevision.bind(runtime.model);
  runtime.model.withPinnedRevision = (revision, expiry, operation) => withPinnedRevision(revision, expiry, client =>
    operation({query: (...args) => measure("sql.membershipQuery", () => client.query(...args))}));
  return {...runtime, async invoke(name, request) {
    const observation = {sequence: ++sequence, endpoint: name, signed: Boolean(request.auth),
      requestedDocuments: 0, repeatedDocumentReads: 0, documentPaths: new Set(), operations: {}};
    const start = performance.now();
    return active.run(observation, async () => {
      try {
        const result = await runtime.invoke(name, request);
        observation.status = "success";
        observation.challengeCandidates = Array.isArray(result?.candidates) ? result.candidates.length : 0;
        return result;
      } catch (error) { observation.status = "failure"; throw error; }
      finally {
        observation.milliseconds = performance.now() - start;
        observation.uniqueRequestedDocuments = observation.documentPaths.size;
        delete observation.documentPaths;
        appendFileSync(destination, JSON.stringify(observation) + "\n");
      }
    });
  }};
}

async function main() {
  const app = initializeApp({projectId}, "postgis-flutter-local-host");
  const database = getFirestore(app), auth = getAuth(app);
  const runtime = createLocalPostgisStagingRuntime({database, auth, projectId, allowedProjectIds: [projectId],
    guestRestaurantWindow: process.env.BS_POSTGIS_GUEST_WINDOW === "1",
    epoch: "flutter-local-source-v1", sql: {host: "127.0.0.1", port: 55441, database: "bsgate0_flutter", user: "bsgate0"},
    discoveryKey: Buffer.alloc(32, 71), identityKeyV1: F.identityKeyV1, scoreCursorRootKey: Buffer.alloc(32, 73)});
  await runtime.initialize();
  const fixture = F.dataset({saverParents: 35, scoreParents: 30, includeCases: false});
  const now = new Date(process.env.BS_POSTGIS_FIXTURE_NOW ?? Date.now());
  assert(Number.isFinite(now.getTime()), "valid fixed fixture timestamp required");
  // Seed raw source only, then invoke actual source-enabled projection writers.
  for (let offset = 0; offset < fixture.sources.length; offset += 200) {
    const batch = database.batch();
    for (const row of fixture.sources.slice(offset, offset + 200)) batch.set(database.doc(row.path),
      row.path.includes("/coupons/") ? {...row.data, startTime: new Date(now.getTime() - 86_400_000),
        endTime: new Date(now.getTime() + 86_400_000), updatedAt: now} : row.data);
    await batch.commit();
  }
  for (const row of fixture.sources) {
    const pieces = row.path.split("/");
    if (pieces[0] === "restaurant_accounts" && pieces.length === 2) {
      await M.reconcileBiteSaverRestaurantIndex(runtime.maintenanceDatabase, pieces[1], now, F.identityKeyV1);
    } else if (pieces[0] === "restaurant_accounts" && pieces[2] === "coupons") {
      await M.handleBiteSaverCouponOfferWrite(runtime.maintenanceDatabase,
        {restaurantAccountId: pieces[1], couponId: pieces[3], now, identityKeyV1: F.identityKeyV1});
    } else if (pieces[0] === "bitescore_restaurants") {
      await M.reconcileBiteScoreRestaurantIndex(runtime.maintenanceDatabase, pieces[1], now);
    } else if (pieces[0] === "bitescore_dishes") {
      const projection = fixture.documents.find(document => document.collection === "dish_search_index" &&
        document.data.sourceDocumentId === pieces[1]).data.customerPublicProjection;
      await database.doc(`dish_rating_aggregates/${pieces[1]}`).set({dishId: pieces[1], restaurantId: row.data.restaurantId,
        ratingCount: projection.ratingCount, overallBiteScore: projection.overallBiteScore,
        valueScoreAverage: projection.valueScoreAverage, tastinessScoreAverage: projection.tastinessScoreAverage,
        qualityScoreAverage: projection.qualityScoreAverage, overallImpressionAverage: projection.overallImpressionAverage});
      await M.reconcileBiteScoreDishIndex(runtime.maintenanceDatabase, pieces[1], now);
    }
  }
  let checkpoint = await runtime.source.beginEnrollment("flutter-local-bootstrap");
  for (let i = 0; checkpoint.phase !== "complete"; i++) {
    assert(i < 100); checkpoint = await runtime.source.advanceEnrollment("flutter-local-bootstrap", 75);
  }
  let published;
  for (let i = 0; i < 100; i++) {
    published = await runtime.model.catchUp(75);
    if (published.ready) break;
  }
  assert(published.ready, "complete source publication required before exposing local host");
  const host = await startLocalPostgisHttpHost(observe(runtime), {port: 8188});
  const metadata = {kind: "real-local-Flutter-Auth-Firestore-PostGIS", url: host.url, projectId,
    database: "bsgate0_flutter", firestore: "127.0.0.1:8088", auth: "127.0.0.1:9099",
    fixture: fixture.manifest, hostPid: process.pid, publishedRevision: published.revision,
    publishedSourceFence: await runtime.source.readFence(), fixtureTemporalNow: now.toISOString(),
    activeEntities: (await runtime.pool.query("SELECT count(*)::int AS n FROM entities WHERE valid_to=9223372036854775807")).rows[0].n};
  if (process.env.BS_POSTGIS_FLUTTER_METADATA) writeFileSync(process.env.BS_POSTGIS_FLUTTER_METADATA, JSON.stringify(metadata, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ready: true, url: host.url, projectId, activeEntities: metadata.activeEntities}) + "\n");
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    await host.close(); await runtime.close(); await database.terminate(); await deleteApp(app);
  }
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
}
main().catch(error => {
  process.stderr.write(`Local candidate fixture failed: ${error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
