"use strict";

// Dedicated local integration fixture. It cannot provision or address a cloud
// target. No production entrypoint, flags or credentials are loaded.
const assert = require("node:assert/strict");
const {writeFileSync} = require("node:fs");
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

async function main() {
  const app = initializeApp({projectId}, "postgis-flutter-local-host");
  const database = getFirestore(app), auth = getAuth(app);
  const runtime = createLocalPostgisStagingRuntime({database, auth, projectId, allowedProjectIds: [projectId],
    epoch: "flutter-local-source-v1", sql: {host: "127.0.0.1", port: 55441, database: "bsgate0_flutter", user: "bsgate0"},
    discoveryKey: Buffer.alloc(32, 71), identityKeyV1: F.identityKeyV1, scoreCursorRootKey: Buffer.alloc(32, 73)});
  await runtime.initialize();
  const fixture = F.dataset({saverParents: 35, scoreParents: 30, includeCases: false});
  const now = new Date();
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
  const host = await startLocalPostgisHttpHost(runtime, {port: 8188});
  const metadata = {kind: "real-local-Flutter-Auth-Firestore-PostGIS", url: host.url, projectId,
    database: "bsgate0_flutter", firestore: "127.0.0.1:8088", auth: "127.0.0.1:9099",
    fixture: fixture.manifest, publishedRevision: published.revision,
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
