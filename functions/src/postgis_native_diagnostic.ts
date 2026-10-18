import {createHash} from "node:crypto";
import {readFileSync, statSync} from "node:fs";
import {cpus, endianness, machine, release} from "node:os";
import {isAbsolute, resolve} from "node:path";
import {performance} from "node:perf_hooks";
import {cloudSqlPostgisIdentity, createCloudSqlPostgisPool, requireCloudSqlPostgisPool,
  type CloudSqlDependencies, type CloudSqlPostgisConfiguration} from "./postgis_cloudsql.js";
import {verifyPostgisExecutionApproval, requirePostgisExecutionPermit,
  type PostgisApprovalEnvelope} from "./postgis_execution_approval.js";
import {parseCustomerBiteScoreCriteria} from "./customer_bitescore_search_contract.js";
import {exactCustomerBiteSaverDistanceMiles} from "./restaurant_geo_helpers.js";
import {queryPlan} from "./postgis_query.js";
import type {PostgisClient} from "./postgis_store.js";

export const postgisNativeDiagnosticProtocol = "bitestar.postgis-native-diagnostic.v1";
const taskLifetimeMs = 600_000, workLifetimeMs = 540_000, outputLimit = 64 * 1024;

/** Fixed diagnostic identity, not a search-runtime allowance. No caller SQL,
 * coordinates, filenames, query counts or serving operation are accepted.
 */
export function nativePostgisDiagnosticIdentity(configuration: CloudSqlPostgisConfiguration, jobId: string) {
  const identity = cloudSqlPostgisIdentity(configuration);
  const plan = configuration.hosted.nativeDiagnostic as Record<string, unknown> | undefined;
  if (configuration.gate !== 1 || !plan || Array.isArray(plan) ||
      Object.keys(plan).sort().join(",") !== "action,id,protocolVersion" ||
      plan.protocolVersion !== postgisNativeDiagnosticProtocol || plan.action !== "numerical-only" ||
      plan.id !== `${configuration.runId}-native` || jobId !== plan.id ||
      configuration.hosted.sql.database !== "bs_postgis_diagnostic" ||
      configuration.hosted.sql.serviceAccountEmail !== `${configuration.runId}-diag@${configuration.projectId}.iam.gserviceaccount.com`) {
    throw new Error("Invalid isolated native numerical diagnostic plan.");
  }
  return identity;
}
function boundedFile(path: string, maximum: number): Buffer {
  if (statSync(path).size > maximum) throw new Error("Diagnostic input exceeds its bound.");
  return readFileSync(path);
}
function sha(path: string, maximum = 8 * 1024 * 1024): string {
  return createHash("sha256").update(boundedFile(path, maximum)).digest("hex");
}
function bits(value: number): string {const b = Buffer.alloc(8); b.writeDoubleBE(value); return b.toString("hex");}
function step(value: number, offset: number): number {
  const b = Buffer.alloc(8); b.writeDoubleBE(value); b.writeBigUInt64BE(b.readBigUInt64BE() + BigInt(offset)); return b.readDoubleBE();
}
function requireTrue(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`Native numerical diagnostic failed: ${label}.`);
}
function runtimeEvidence() {
  const cpu = cpus();
  const cpuInfo = process.platform === "linux" ? boundedFile("/proc/cpuinfo", 2 * 1024 * 1024).toString("utf8") : "";
  // Allowlisted fields only: never environment, process.report, credentials or hostname.
  const cpuFields = [...new Set(cpuInfo.split("\n").filter(line => /^(vendor_id|model name|flags)\s*:/u.test(line)))];
  requireTrue(cpuFields.length <= 48 && cpuFields.join("\n").length <= 24 * 1024, "CPU metadata bound");
  return {node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
    kernel: release(), machine: machine(), endianness: endianness(), cpuCount: cpu.length,
    cpuModels: [...new Set(cpu.map(item => item.model))].slice(0, 16), cpuFields,
    distribution: process.platform === "linux" ? boundedFile("/etc/os-release", 4096).toString("utf8") : "local-test",
    nodeSha256: sha(process.execPath, 256 * 1024 * 1024), execArgv: [...process.execArgv], nodeOptionsPresent: !!process.env.NODE_OPTIONS,
    compiledQuerySha256: sha(resolve(__dirname, "postgis_query.js")),
    authoritativeGeometrySha256: sha(resolve(__dirname, "restaurant_geo_helpers.js")),
    dependencyLockSha256: sha(resolve(__dirname, "../package-lock.json"))};
}
function arithmeticEvidence() {
  const cases: [string, number | boolean, number | boolean][] = [
    ["ties-even-low", 1 + Number.EPSILON / 2, 1],
    ["ties-even-high", (1 + Number.EPSILON) + Number.EPSILON / 2, 1 + 2 * Number.EPSILON],
    ["subnormal-preserved", Number.MIN_VALUE * 1, Number.MIN_VALUE],
    ["subnormal-halving", 2 * Number.MIN_VALUE * .5, Number.MIN_VALUE],
    ["subnormal-underflow-even", Number.MIN_VALUE / 2, 0],
    ["sqrt-signed-zero", Math.sqrt(-0), -0], ["sqrt-min-subnormal", Math.sqrt(Number.MIN_VALUE), 2 ** -537],
    ["sqrt-min-normal", Math.sqrt(2 ** -1022), 2 ** -511], ["sqrt-two", Math.sqrt(2), 1.4142135623730951],
    ["sqrt-closed-square", Math.sqrt(Number.MIN_VALUE) ** 2, Number.MIN_VALUE],
    ["cos-pole-positive", Math.cos(90 * (Math.PI / 180)) > 0, true],
    ["sin-subnormal", Math.sin(Number.MIN_VALUE), Number.MIN_VALUE],
    ["atan-subnormal", Math.atan(Number.MIN_VALUE), Number.MIN_VALUE],
  ];
  return cases.map(([name, actual, expected]) => {
    requireTrue(Object.is(actual, expected), name);
    return {name, actual: typeof actual === "number" ? bits(actual) : actual, pass: true};
  });
}

/** Pure, fixed synthetic numerical experiment. The only SQL source is checked-in
 * code and queryPlan's existing distance expression; no application table read.
 * Exported for local PostgreSQL qualification with an injected query transport.
 */
export async function collectPostgisNumericalEvidence(query: PostgisClient["query"], checkDeadline: () => void) {
  const read: PostgisClient["query"] = async (text, values) => {checkDeadline(); return query(text, values);};
  const session = (await read("SELECT current_setting('extra_float_digits') AS extra_float_digits, current_setting('transaction_read_only') AS read_only, version() AS version, postgis_full_version() AS postgis")).rows[0];
  requireTrue(session?.extra_float_digits === "1" && session.read_only === "on", "read-only rounding session");
  const extensions = (await read("SELECT extname, extversion FROM pg_catalog.pg_extension WHERE extname IN ('postgis','pg_trgm','fuzzystrmatch') ORDER BY extname")).rows;
  const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -1022, -(2 ** -1022),
    ...[4, 60, 90, 180].flatMap(x => [-1, 0, 1].flatMap(n => [step(x, n), -step(x, n)])),
    50000 / 111000, 1 / 111000, 50000 / 44400, 1 / 44400];
  const bridge = [];
  for (const input of values) {
    const row = (await read("SELECT $1::float8 AS transported, ($1::float8)::numeric::text AS decimal, (($1::float8)::numeric)::float8 AS roundtrip, (least(50000::numeric,111000::numeric*abs(($1::float8)::numeric))/1609.344::numeric)::float8 AS capped_miles", [input])).rows[0];
    requireTrue(input === 0 ? row.transported === 0 : Object.is(row.transported, input), "float8 transport");
    requireTrue(Math.abs(row.roundtrip - input) < 1e-12 && Number.isFinite(row.capped_miles), "numeric bridge");
    bridge.push({inputBits: bits(input), transportBits: bits(row.transported), decimal: row.decimal,
      roundtripBits: bits(row.roundtrip), absoluteError: Math.abs(row.roundtrip - input), cappedMiles: row.capped_miles});
  }
  const cap = (await read("SELECT (49499::numeric/1609.344::numeric)::float8 AS latitude_cap, (49999::numeric/1609.344::numeric)::float8 AS longitude_cap")).rows[0];
  requireTrue(Math.abs(cap.latitude_cap - 49499 / 1609.344) < 1e-10 && Math.abs(cap.longitude_cap - 49999 / 1609.344) < 1e-10, "numeric caps");
  const locations = [[-90, -180], [-90, 180], [90, -180], [90, 180], [0, 1], [Number.MIN_VALUE, 1],
    [-Number.MIN_VALUE, -1], [89.99999999999999, 179.99999999999997], [-89.99999999999999, -179.99999999999997],
    [0, -179], [.00000001, 179], [4.491576420597607, 1], [.4491576420597607, 1]];
  type Point = {latitude: number; longitude: number};
  const pairs: [Point, Point][] = [];
  for (const a of locations) for (const b of locations) pairs.push([{latitude: a[0], longitude: a[1]}, {latitude: b[0], longitude: b[1]}]);
  for (const a of [-60.00000000000001, -60, -59.99999999999999, 0, 59.99999999999999, 60, 60.00000000000001])
    for (const b of [-60, 0, 60]) for (const delta of [-4.000000000000001, -4, -3.9999999999999996, 0, 3.9999999999999996, 4, 4.000000000000001])
      pairs.push([{latitude: a, longitude: 1}, {latitude: b, longitude: 1 + delta}]);
  pairs.push([{latitude: 25.77, longitude: -80.20}, {latitude: 25.77, longitude: -80.19}],
    [{latitude: 60, longitude: 180}, {latitude: 60, longitude: -180}]);
  let positiveBounds = 0;
  for (const [a, b] of pairs) {
    const criteria = parseCustomerBiteScoreCriteria({kind: "dish", center: a, radiusMiles: 30, text: "", sort: "Closest"});
    const plan = queryPlan({revision: 3, criteria: {space: "score", kind: "dish", criteria}}, null, 64, {lowerBound: true});
    const match = plan.text.match(/,((?:\(greatest)[\s\S]*?) AS distance,/u);
    requireTrue(match, "existing distance expression");
    const expression = match[1].replace(/\$(\d+)/gu, (_, n: string) => {
      const value = plan.values[Number(n) - 1];
      requireTrue(typeof value === "number" && Number.isFinite(value), "fixed numeric literal");
      return `(${value})`;
    });
    const bound = (await read(`SELECT ${expression} AS bound FROM (SELECT $1::float8 latitude, $2::float8 longitude) p`, [b.latitude, b.longitude])).rows[0].bound;
    const exact = exactCustomerBiteSaverDistanceMiles(a, b);
    requireTrue(Number.isFinite(bound) && bound <= exact, "distance lower bound");
    if (bound > 0) positiveBounds++;
  }
  let radiusEdgeVectors = 0, acceptedRadiusEdgeVectors = 0;
  for (const center of [{latitude: 25.77, longitude: -80.19}, {latitude: 0, longitude: 179.9},
    {latitude: 89.9, longitude: 10}, {latitude: -89.9, longitude: -170}, {latitude: 45, longitude: 179.99}, {latitude: -45, longitude: -179.99}])
    for (const radius of [1, 3, 5, 10, 15, 20, 30]) for (let bearing = 0; bearing < 360; bearing += 30) for (const delta of [-1e-10, 0, 1e-10]) {
      checkDeadline();
      const a = (radius + delta) * 1609.344 / 6378137, lat = center.latitude * Math.PI / 180,
        lon = center.longitude * Math.PI / 180, b = bearing * Math.PI / 180;
      const lat2 = Math.asin(Math.sin(lat) * Math.cos(a) + Math.cos(lat) * Math.sin(a) * Math.cos(b)),
        lon2 = lon + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(lat), Math.cos(a) - Math.sin(lat) * Math.sin(lat2));
      const point = {latitude: lat2 * 180 / Math.PI, longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180};
      const accepted = exactCustomerBiteSaverDistanceMiles(center, point) <= radius;
      const span = (radius * 1609.344 + 1) / (.99 * 111000) + 1e-10;
      requireTrue(!accepted || (point.latitude >= center.latitude - span && point.latitude <= center.latitude + span), "radius recall");
      radiusEdgeVectors++; if (accepted) acceptedRadiusEdgeVectors++;
    }
  requireTrue(pairs.length === 318 && radiusEdgeVectors === 1512 && bridge.length === 34, "fixed experiment sizes");
  return {session, extensions, bridge, maximumCoordinateError: Math.max(...bridge.map(row => row.absoluteError)), cap,
    combinedBoundVectors: pairs.length, positiveBounds, radiusEdgeVectors, acceptedRadiusEdgeVectors, missed: 0};
}

export async function runApprovedPostgisNativeDiagnostic(options: {
  configuration: CloudSqlPostgisConfiguration; approval: PostgisApprovalEnvelope;
  trustedKeys: Readonly<Record<string, string>>; jobId: string;
}, dependencies?: CloudSqlDependencies) {
  const started = performance.now();
  const jobId = options.jobId;
  const config = JSON.parse(JSON.stringify(options.configuration)) as CloudSqlPostgisConfiguration;
  const identity = nativePostgisDiagnosticIdentity(config, jobId);
  const permit = verifyPostgisExecutionApproval(options.approval, options.trustedKeys, identity);
  requireTrue(permit.validUntilMs - Date.now() >= taskLifetimeMs, "full diagnostic task approval horizon");
  requireTrue(!process.env.NODE_OPTIONS && process.execArgv.every(arg => arg.startsWith("--test")), "default numerical runtime flags");
  const checkDeadline = () => {
    requirePostgisExecutionPermit(permit, identity);
    requireTrue(performance.now() - started < workLifetimeMs, "work deadline");
  };
  checkDeadline();
  const runtime = runtimeEvidence(), arithmetic = arithmeticEvidence();
  checkDeadline();
  // Deliberately no hosted-runtime import: this is evidence collection, never
  // serving, source ingestion, Firestore, runtime keys or schema initialization.
  const pool = await createCloudSqlPostgisPool(config, permit, "primary", dependencies);
  try {
    requireCloudSqlPostgisPool(pool, identity); checkDeadline();
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const numerical = await collectPostgisNumericalEvidence(client.query, checkDeadline);
      await client.query("ROLLBACK"); checkDeadline();
      const evidence = {protocolVersion: postgisNativeDiagnosticProtocol, projectId: config.projectId,
        projectNumber: config.projectNumber, runId: config.runId, jobId,
        candidateDigest: config.candidateDigest, configDigest: identity.configDigest,
        syntheticOnly: true, runtime, arithmetic, numerical, elapsedMs: Math.ceil(performance.now() - started),
        finiteSamplesAreNotUniversalProof: true, servingRuntimeQualified: false, listenerStarted: false,
        workloadTablesAccessed: false, proofReviewRequired: true};
      requireTrue(Buffer.byteLength(JSON.stringify(evidence)) <= outputLimit, "evidence output bound");
      return evidence;
    } finally {client.release(true);}
  } finally {await pool.end();}
}
function json(path: string, maximum: number): unknown {
  if (!isAbsolute(path)) throw new Error("Absolute operator file required.");
  return JSON.parse(boundedFile(path, maximum).toString("utf8"));
}
export async function nativePostgisDiagnosticMain(args: readonly string[]): Promise<void> {
  if (args.length === 2 && args[0] === "--dry-run") {
    json(args[1], 256 * 1024);
    process.stdout.write('{"status":"SOURCE_ONLY_NO_CLOUD_EXECUTION","diagnosticStarted":false,"servingRuntimeQualified":false,"credentialsInitialized":false}\n'); return;
  }
  if (args.length !== 5 || args[0] !== "--execute") throw new Error("Explicit signed diagnostic inputs required.");
  const configuration = json(args[1], 256 * 1024) as CloudSqlPostgisConfiguration;
  const evidence = await runApprovedPostgisNativeDiagnostic({configuration,
    approval: json(args[2], 32 * 1024) as PostgisApprovalEnvelope,
    trustedKeys: json(args[3], 64 * 1024) as Readonly<Record<string, string>>, jobId: args[4]});
  process.stdout.write(JSON.stringify(evidence) + "\n");
}
if (require.main === module) nativePostgisDiagnosticMain(process.argv.slice(2)).then(() => {process.exit(0);}, () => {
  process.stderr.write("Native numerical diagnostic refused or incomplete; no serving qualification granted.\n"); process.exit(1);
});
