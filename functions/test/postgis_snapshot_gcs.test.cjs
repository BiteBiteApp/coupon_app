"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {makeGcsSnapshotFixture} = require("./support/postgis_gcs_fixture.cjs");
const {GcsPostgisSnapshotStore} = require("../lib/postgis_snapshot_gcs.js");
const {emptyPostgisSourceShard, postgisSourceDigest, postgisSourceShardFor, postgisXorDigest, postgisSourceVersion} = require("../lib/postgis_source.js");
const {createPostgisRecoveryManifest, validatePostgisRecoverySnapshot, postgisRecoveryIdentity} = require("../lib/postgis_source_recovery.js");
function source(count = 546) {
  const shards = Array.from({length: 16}, emptyPostgisSourceShard);
  const rows = Array.from({length: count}, (_, i) => {
    const payload = {collection: "restaurant_search_index", indexDocumentId: `fixture-${String(i).padStart(5, "0")}`, projection: {name: `Synthetic ${i}`}};
    const digest = postgisSourceDigest(payload), shard = shards[postgisSourceShardFor(payload.collection, payload.indexDocumentId)];
    shard.seq++; shard.partitions[payload.collection].count++;
    shard.partitions[payload.collection].xor = postgisXorDigest(shard.partitions[payload.collection].xor, digest);
    return {payload, digest};
  });
  const manifest = createPostgisRecoveryManifest("qualified", {protocolVersion: postgisSourceVersion, epoch: "fixture", enrolled: true, shards}, rows);
  return {manifest, rows, reader: {readRecoveryManifest: async () => manifest,
    readRecoveryRows: async (_id, after, limit) => rows.filter(row => after === null || postgisRecoveryIdentity(row) > after).slice(0, limit)}};
}
test("construction and missing/forged approval are inert; production/mismatched config refused", () => {
  const f = makeGcsSnapshotFixture(); f.createStore(); assert.equal(f.requests.length, 0);
  assert.throws(() => new GcsPostgisSnapshotStore(f.config, {...f.permit}, {transport: f.transport}), /approval/);
  for (const change of [{projectId: "coupon-app-29446"}, {syntheticOnly: false}, {candidateDigest: "e".repeat(64)}, {allowedProjectIds: ["other-project"]}]) {
    assert.throws(() => new GcsPostgisSnapshotStore({...f.config, ...change}, f.permit, {transport: f.transport}));
  }
  assert.equal(f.requests.length, 0);
});
test("immutable generation-pinned chunks round-trip beyond500 rows; retry is identical", async () => {
  const f = makeGcsSnapshotFixture(), s = source(), store = f.createStore();
  await store.publish(s.reader, s.manifest); assert.equal(f.objects.size, 3);
  await validatePostgisRecoverySnapshot(store, s.manifest);
  assert.equal((await store.readRecoveryRows("qualified", postgisRecoveryIdentity(s.rows[499]), 500)).length, 46);
  const before = [...f.objects.values()].map(x => x.metadata.generation);
  await f.createStore().publish(s.reader, s.manifest);
  assert.deepEqual([...f.objects.values()].map(x => x.metadata.generation), before);
  assert(f.requests.filter(x => x.method === "POST").every(x => x.url.includes("ifGenerationMatch=0")));
});
test("lost upload acknowledgements reconcile verified bytes and do not duplicate", async () => {
  const f = makeGcsSnapshotFixture(), s = source(); f.state.afterWrite = async () => {throw new Error("lost reply");};
  await f.createStore().publish(s.reader, s.manifest); assert.equal(f.objects.size, 3);
});
test("interrupted upload never publishes completeness and resumes create-if-absent", async () => {
  const f = makeGcsSnapshotFixture(), s = source();
  f.state.before = request => request.method === "POST" && request.body.includes("rows-000001") ? f.response(403, {}) : null;
  await assert.rejects(f.createStore().publish(s.reader, s.manifest), /refused/);
  assert.equal(f.objects.size, 1); assert.equal(await f.createStore().readRecoveryManifest("qualified"), null);
  f.state.before = null; await f.createStore().publish(s.reader, s.manifest); assert.equal(f.objects.size, 3);
});
for (const scenario of ["missing", "corrupt", "generation", "metadata"]) test(`${scenario} chunk rejects recovery evidence`, async () => {
  const f = makeGcsSnapshotFixture(), s = source(), store = f.createStore(); await store.publish(s.reader, s.manifest);
  const [name, item] = [...f.objects.entries()][0];
  if (scenario === "missing") f.objects.delete(name);
  if (scenario === "corrupt") item.body[3] ^= 1;
  if (scenario === "generation") item.metadata.generation = "9999";
  if (scenario === "metadata") item.metadata.metadata.runId = "bs-postgis-wrong";
  await assert.rejects(validatePostgisRecoverySnapshot(store, s.manifest), /snapshot/i);
});
test("terminal generation replacement/removal after pin is rejected even for identical bytes", async () => {
  const f = makeGcsSnapshotFixture(), s = source(), store = f.createStore(); await store.publish(s.reader, s.manifest);
  const [name, item] = [...f.objects.entries()].find(([key]) => key.endsWith("manifest.json"));
  item.metadata.generation = "9999"; await assert.rejects(store.readRecoveryManifest("qualified"), /generation/);
  f.objects.delete(name); await assert.rejects(store.readRecoveryManifest("qualified"), /unavailable/);
});
test("conflicting create cannot overwrite previously durable rows", async () => {
  const f = makeGcsSnapshotFixture(), s = source(), store = f.createStore(); await store.publish(s.reader, s.manifest);
  const item = [...f.objects.values()][0]; item.metadata.metadata.sha256 = "f".repeat(64);
  await assert.rejects(f.createStore().publish(s.reader, s.manifest), /Conflicting/); assert.equal(f.objects.size, 3);
});
test("permission and timeout failures are not absence; bucket incarnation/scope and expiry fail closed", async () => {
  const f = makeGcsSnapshotFixture(), store = f.createStore();
  f.state.before = () => f.response(403, {}); await assert.rejects(store.readRecoveryManifest("qualified"), /unavailable/);
  f.state.before = () => {throw new Error("timeout");}; await assert.rejects(store.readRecoveryManifest("qualified"), /timeout/);
  f.state.before = null; f.state.bucketCreatedAt = "2026-10-17T01:00:00.000Z";
  await assert.rejects(store.readRecoveryManifest("qualified"), /incarnation/);
  f.state.bucketCreatedAt = f.config.hosted.snapshot.bucketCreatedAt; f.state.bucketProject = "999999999999";
  await assert.rejects(store.readRecoveryManifest("qualified"), /ownership/);
  await assert.rejects(store.readRecoveryManifest("unapproved"), /scope/);
  const before = f.requests.length; f.advanceClock(2 * 60 * 60_000);
  await assert.rejects(store.readRecoveryManifest("qualified"), /approval/); assert.equal(f.requests.length, before);
});
test("unverified source and storage overflow never produce a terminal manifest", async () => {
  const f = makeGcsSnapshotFixture(), s = source(); s.rows.pop();
  await assert.rejects(f.createStore().publish(s.reader, s.manifest), /incomplete/); assert.equal(f.requests.length, 0);
  const bounded = makeGcsSnapshotFixture({maxSnapshotBytes: 1024}), good = source();
  await assert.rejects(bounded.createStore().publish(good.reader, good.manifest), /storage bound/);
  assert.equal(bounded.objects.size, 0);
});
test("empty complete snapshot retains fence and validates without data objects", async () => {
  const f = makeGcsSnapshotFixture(), s = source(0), store = f.createStore();
  await store.publish(s.reader, s.manifest); await validatePostgisRecoverySnapshot(store, s.manifest); assert.equal(f.objects.size, 1);
});
test("malformed provider JSON and transport errors never expose response fragments", async () => {
  const f = makeGcsSnapshotFixture(), store = f.createStore(), canary = "review_private_canary_invalid_json";
  f.state.before = () => f.response(200, Buffer.from(canary));
  await assert.rejects(store.readRecoveryManifest("qualified"), error => error.message === "Invalid snapshot provider JSON." && !error.message.includes(canary));
  f.state.before = () => {throw new Error(canary);};
  await assert.rejects(store.readRecoveryManifest("qualified"), error => error.message === "Snapshot provider transport timeout or failure.");
});
test("hosted streaming export uses branded approved SQL and no filesystem; restore binds exact store and ID", async () => {
  const {createCloudSqlPostgisPool} = require("../lib/postgis_cloudsql.js");
  const {publishHostedPostgisSnapshot, restoreHostedPostgisSnapshot} = require("../lib/postgis_snapshot.js");
  const f = makeGcsSnapshotFixture(), s = source(546), store = f.createStore(), queries = [];
  const dependencies = {createConnector: () => ({getOptions: async () => ({stream() {}}), close() {}}),
    createPool: options => {
      const query = async (text, values) => {
        queries.push(text);
        let rows = [];
        if (text.startsWith("SELECT current_database()")) rows = [{database: options.database, username: options.user}];
        else if (text.includes("FROM publication")) rows = [{revision: 1, fence: s.manifest.fence.shards.map(x => x.seq)}];
        else if (text.includes("FROM ingestion_progress")) rows = [{target: null, state: "ready", epoch: "fixture"}];
        else if (text.includes("SELECT ready")) rows = [{ready: true}];
        else if (text.includes("source_manifest FROM revisions")) rows = [{source_manifest: s.manifest.fence}];
        else if (text.includes("count(*)")) rows = [{count: String(s.rows.length)}];
        else if (text.includes("SELECT index_path,payload,digest")) {
          assert(values[1] <= 500);
          rows = s.rows.filter(row => values[0] === null || postgisRecoveryIdentity(row) > values[0]).slice(0, values[1])
            .map(row => ({index_path: postgisRecoveryIdentity(row), ...row}));
        }
        return {rows, rowCount: rows.length};
      };
      return {query, connect: async () => ({query, release() {}}), end: async () => {}, on() {}, totalCount: 0, idleCount: 0, waitingCount: 0};
    }};
  await assert.rejects(publishHostedPostgisSnapshot({}, f.config, store, "qualified"), /Cloud SQL/);
  const primary = await createCloudSqlPostgisPool(f.config, f.permit, "primary", dependencies);
  const restored = await createCloudSqlPostgisPool(f.config, f.permit, "restore", dependencies);
  try {
    const manifest = await publishHostedPostgisSnapshot(primary, f.config, store, "qualified");
    assert.equal(manifest.digest, s.manifest.digest); assert.equal(f.objects.size, 3);
    assert(queries.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    await assert.rejects(restoreHostedPostgisSnapshot(primary, f.config, store, "qualified"), /Cloud SQL/);
    const wrongStore = makeGcsSnapshotFixture({bucket: "another-snapshot-bucket"}).createStore();
    const before = queries.length;
    await assert.rejects(restoreHostedPostgisSnapshot(restored, f.config,
      {...s.reader, assertConfiguration() {}}, "qualified"), /approved GCS/);
    await assert.rejects(restoreHostedPostgisSnapshot(restored, f.config, wrongStore, "qualified"), /binding/);
    await assert.rejects(restoreHostedPostgisSnapshot(restored, f.config, store, "other"), /scope/);
    assert.equal(queries.length, before);
  } finally {await primary.end(); await restored.end();}
});
