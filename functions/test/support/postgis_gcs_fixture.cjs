"use strict";
const {generateKeyPairSync, sign, createHash} = require("node:crypto");
const {canonicalPostgisApproval, digestPostgisConfiguration, verifyPostgisExecutionApproval} = require("../../lib/postgis_execution_approval.js");
const {GcsPostgisSnapshotStore} = require("../../lib/postgis_snapshot_gcs.js");

// Deterministic JSON API simulation: no credentials, DNS or provider SDK calls.
function makeGcsSnapshotFixture(overrides = {}) {
  let now = Date.now(), sequence = 100;
  const config = {projectId: "bs-snapshot-fixture", projectNumber: "123456789012", runId: "bs-postgis-snapshot-fixture",
    candidateDigest: "b".repeat(64), gate: 1, region: "us-central1", syntheticOnly: true, allowedProjectIds: ["bs-snapshot-fixture"],
    hosted: {sql: {instanceConnectionName: "bs-snapshot-fixture:us-central1:bs-postgis-snapshot-fixture-db",
      database: "bs_postgis_primary", restoreDatabase: "bs_postgis_restore", schema: "public",
      serviceAccountEmail: "snapshot-runner@bs-snapshot-fixture.iam.gserviceaccount.com"},
      snapshot: {bucket: "bs-snapshot-fixture", bucketCreatedAt: "2026-10-17T00:00:00.000Z",
      prefix: "runs/bs-postgis-snapshot-fixture/snapshots/", snapshotId: "qualified",
      serviceAccountEmail: "snapshot-runner@bs-snapshot-fixture.iam.gserviceaccount.com", maxSnapshotBytes: 32 * 1024 * 1024,
      ...overrides}}};
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const expected = {projectId: config.projectId, projectNumber: config.projectNumber, runId: config.runId,
    candidateDigest: config.candidateDigest, configDigest: digestPostgisConfiguration(config), gate: 1, nowMs: now};
  const claims = {protocolVersion: "bitestar.postgis-execution-approval.v1", ...expected,
    notBeforeMs: now - 1000, validUntilMs: now + 60 * 60_000, cleanupUntilMs: now + 60 * 60_000, allowedGates: [1]};
  delete claims.gate; delete claims.nowMs;
  const bytes = Buffer.from(canonicalPostgisApproval(claims));
  const envelope = {keyId: "fixture", payloadBase64: bytes.toString("base64"), signatureBase64: sign(null, bytes, privateKey).toString("base64")};
  const permit = verifyPostgisExecutionApproval(envelope, {fixture: publicKey.export({type: "spki", format: "pem"})}, expected);
  const objects = new Map(), requests = [];
  const state = {before: null, afterWrite: null, bucketProject: config.projectNumber, bucketCreatedAt: config.hosted.snapshot.bucketCreatedAt};
  const response = (status, value) => ({status, body: Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))});
  const transport = async request => {
    requests.push({method: request.method, url: request.url});
    if (state.before) {const value = await state.before(request); if (value) return value;}
    const url = new URL(request.url);
    if (request.method === "POST") {
      if (url.searchParams.get("ifGenerationMatch") !== "0") throw new Error("unconditional upload");
      const boundary = request.contentType.split("boundary=")[1];
      const split = Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
      const offset = request.body.indexOf(split), metadataStart = request.body.indexOf("\r\n\r\n") + 4;
      const metadata = JSON.parse(request.body.subarray(metadataStart, offset).toString());
      const body = request.body.subarray(offset + split.length, request.body.length - Buffer.byteLength(`\r\n--${boundary}--\r\n`));
      if (objects.has(metadata.name)) return response(412, {});
      if (createHash("md5").update(body).digest("base64") !== metadata.md5Hash) return response(400, {});
      const record = {body: Buffer.from(body), metadata: {...metadata, bucket: config.hosted.snapshot.bucket,
        generation: String(++sequence), size: String(body.length)}};
      objects.set(metadata.name, record);
      if (state.afterWrite) await state.afterWrite(metadata.name);
      return response(200, record.metadata);
    }
    const objectPart = url.pathname.split("/o/")[1];
    if (objectPart === undefined) return response(200, {name: config.hosted.snapshot.bucket,
      projectNumber: state.bucketProject, timeCreated: state.bucketCreatedAt});
    const object = objects.get(decodeURIComponent(objectPart));
    if (!object) return response(404, {});
    const expectedGeneration = url.searchParams.get("generation");
    if (expectedGeneration && (expectedGeneration !== object.metadata.generation ||
      expectedGeneration !== url.searchParams.get("ifGenerationMatch"))) return response(412, {});
    return response(200, url.searchParams.get("alt") === "media" ? object.body : object.metadata);
  };
  const createStore = () => new GcsPostgisSnapshotStore(config, permit, {transport, now: () => now});
  return {config, expected, permit, objects, requests, state, transport, createStore,
    advanceClock: milliseconds => {now += milliseconds;}, response};
}
module.exports = {makeGcsSnapshotFixture};
