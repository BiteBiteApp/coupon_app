"use strict";
// Actual loopback API completion samples. No response, token, cursor or customer
// payload is retained. This does not measure Flutter rendering or hosted latency.
const assert = require("node:assert/strict");
const {writeFileSync, readFileSync} = require("node:fs");
const {join, dirname} = require("node:path");
const {randomBytes} = require("node:crypto");
const {performance} = require("node:perf_hooks");
assert.equal(process.env.BS_POSTGIS_LOCAL_API_BENCHMARK, "1");
const url = "http://127.0.0.1:8188";
const batch = randomBytes(8).toString("hex");
const count = 100, concurrency = 4;
let requestCount = 0, retryCount = 0, responseBytes = 0;
const errors = [];

async function call(name, data) {
  for (let attempt = 0; attempt < 100; attempt++) {
    requestCount++;
    const response = await fetch(`${url}/${name}`, {method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({data}), signal: AbortSignal.timeout(15_000)});
    const raw = await response.text(); responseBytes += Buffer.byteLength(raw);
    const value = JSON.parse(raw);
    if (value.error) {
      errors.push({code: value.error.status, retry: ["UNAVAILABLE", "RESOURCE_EXHAUSTED"].includes(value.error.status)});
      if (["UNAVAILABLE", "RESOURCE_EXHAUSTED"].includes(value.error.status)) {
        retryCount++; await new Promise(resolve => setTimeout(resolve, 20)); continue;
      }
      throw new Error(`Candidate API failed: ${value.error.status}`);
    }
    assert(response.ok); return value.result;
  }
  throw new Error("Candidate API did not produce a complete result within the retry bound.");
}

async function sample(kind, number) {
  const clientInstanceId = `api-${batch}-${kind}-${number}`;
  const criteria = kind === "score" ? {kind: "dish", center: {latitude: 25.77, longitude: -80.19},
    radiusMiles: 15, text: "submarine", sort: "Closest"} : {kind: "restaurant", text: "Synthetic Gate0 Catalog",
    finder: {state: "FL", location: "Miami", mode: "suggestions"}};
  const began = performance.now();
  const start = await call("startCustomerBiteScoreSearchV2", {schemaVersion: 1, clientInstanceId,
    clientRequestId: `request-${batch}-${kind}-${number}`, queryGeneration: 1, criteria});
  assert.equal(start.state, "ready");
  const page = await call("getCustomerBiteScoreSearchPageV2", {schemaVersion: 1, clientInstanceId,
    sessionId: start.sessionId, queryFingerprint: start.queryFingerprint, cursor: null});
  assert.equal(page.state, "ready");
  assert.equal(page.items.length, kind === "score" ? 25 : 8);
  assert(page.items.every(item => typeof item.sourceDocumentId === "string"));
  return performance.now() - began;
}
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
  return {sampleCount: samples.length, minimumMs: sorted[0], p50Ms: percentile(.5), p95Ms: percentile(.95),
    p99Ms: percentile(.99), maximumMs: sorted.at(-1)};
}
async function main() {
  assert(process.env.BS_POSTGIS_LOCAL_API_REPORT, "exact report path required");
  const hostMetadata = JSON.parse(readFileSync(join(dirname(process.env.BS_POSTGIS_LOCAL_API_REPORT), "postgis-flutter-host.json"), "utf8"));
  assert.equal(hostMetadata.projectId, "demo-bs-postgis-flutter");
  assert.equal(hostMetadata.url, url);
  const results = {};
  for (const kind of ["score", "finder"]) {
    for (let warmup = 0; warmup < 5; warmup++) await sample(kind, `warmup-${warmup}`);
    const samples = new Array(count);
    let next = 0;
    await Promise.all(Array.from({length: concurrency}, async () => {
      while (next < count) { const index = next++; samples[index] = await sample(kind, index); }
    }));
    results[kind] = {...stats(samples), samplesMs: samples};
  }
  const report = {kind: "actual-local-HTTP-Firestore-PostGIS-useful-page-completion", projectId: "demo-bs-postgis-flutter",
    renderedByFlutter: false, hostedEvidence: false, coldStartMeasured: false, concurrency,
    clients: 210, warmupSamplesExcluded: 10, requestCount, retryCount, responseBytes,
    fixture: hostMetadata.fixture, activeEntities: hostMetadata.activeEntities,
    publishedRevision: hostMetadata.publishedRevision, publishedSourceFence: hostMetadata.publishedSourceFence ?? null,
    failures: 0, errors, results,
    note: "100 completed independent clients per scenario, start through useful native page including retries; warm local server. Not a hosted or Flutter useful-render target claim."};
  writeFileSync(process.env.BS_POSTGIS_LOCAL_API_REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({kind: report.kind, requestCount, retryCount, failures: report.failures,
    score: stats(results.score.samplesMs), finder: stats(results.finder.samplesMs)}) + "\n");
}
main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; });
