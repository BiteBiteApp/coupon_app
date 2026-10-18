import {readFileSync, statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {cloudSqlPostgisIdentity, createCloudSqlPostgisPool} from "./postgis_cloudsql.js";
import {verifyPostgisExecutionApproval, type PostgisApprovalEnvelope} from "./postgis_execution_approval.js";
import {createHostedPostgisRuntime, requireHostedPostgisConfiguration, type HostedPostgisConfiguration} from "./postgis_hosted_runtime.js";
import {startHostedPostgisHttpHost} from "./postgis_hosted_transport.js";
import {requireQualifiedPostgisRuntime} from "./postgis_runtime.js";
import type {CustomerBiteSaverIdentityKeyV1} from "./customer_bitesaver_public_identity.js";

function readJson(path: string, maximum = 256 * 1024): unknown {
  if (!isAbsolute(path) || statSync(path).size > maximum) throw new Error("Invalid bounded operator file.");
  return JSON.parse(readFileSync(path, "utf8"));
}
function key(value: unknown): Uint8Array {
  if (typeof value !== "string") throw new Error("Invalid isolated runtime key.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) throw new Error("Invalid isolated runtime key.");
  return bytes;
}
/** Explicit execution only. All validation and numerical qualification precedes
 * ADC initialization, key-file access and creation of any cloud SDK client.
 */
export async function openApprovedHostedPostgisResources(options: {
  configuration: HostedPostgisConfiguration; approval: PostgisApprovalEnvelope;
  trustedKeys: Readonly<Record<string, string>>; keyFile: string; port: number;
}) {
  const config = JSON.parse(JSON.stringify(options.configuration)) as HostedPostgisConfiguration,
    identity = cloudSqlPostgisIdentity(config);
  const permit = verifyPostgisExecutionApproval(options.approval, options.trustedKeys, identity);
  requireHostedPostgisConfiguration(config, permit);
  requireQualifiedPostgisRuntime("hosted");
  const keys = readJson(options.keyFile, 4096) as Record<string, unknown>;
  if (Object.keys(keys).sort().join(",") !== "discoveryKeyBase64,identityKeyV1Base64,scoreCursorRootKeyBase64") throw new Error("Invalid isolated runtime keys.");
  const discoveryKey = key(keys.discoveryKeyBase64), identityKeyV1 = key(keys.identityKeyV1Base64) as CustomerBiteSaverIdentityKeyV1,
    scoreCursorRootKey = key(keys.scoreCursorRootKeyBase64);
  // Never reached from import, dry-run, test discovery or invalid approvals.
  const {initializeApp, applicationDefault, deleteApp} = await import("firebase-admin/app");
  const {getFirestore} = await import("firebase-admin/firestore");
  const {getAuth} = await import("firebase-admin/auth");
  const {getAppCheck} = await import("firebase-admin/app-check");
  requireHostedPostgisConfiguration(config, permit);
  const app = initializeApp({projectId: config.projectId, credential: applicationDefault()}, `postgis-${config.runId}`);
  let pool: Awaited<ReturnType<typeof createCloudSqlPostgisPool>> | undefined;
  try {
    pool = await createCloudSqlPostgisPool(config, permit);
    const database = getFirestore(app, config.hosted.firestoreDatabase), auth = getAuth(app), appCheck = getAppCheck(app);
    const resources = {database, auth, pool, discoveryKey, identityKeyV1, scoreCursorRootKey};
    return {configuration: config, permit, resources, appCheck,
      async close() {try {await pool!.end();} finally {await deleteApp(app);}}};
  } catch (error) {try {await pool?.end();} finally {await deleteApp(app);}throw error;}
}
export async function startApprovedHostedPostgisService(options: Parameters<typeof openApprovedHostedPostgisResources>[0]) {
  const opened = await openApprovedHostedPostgisResources(options);
  try {
    const runtime = createHostedPostgisRuntime(opened.configuration, opened.permit, opened.resources);
    const host = await startHostedPostgisHttpHost(opened.configuration, opened.permit, {
      verifyIdToken: token => opened.resources.auth.verifyIdToken(token),
      verifyAppCheckToken: async token => {const verified = await opened.appCheck.verifyToken(token);return {app_id: verified.appId, token: verified.token};},
      invoke: runtime.invoke}, options.port);
    return {runtime, async close() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {await Promise.race([(async () => {try {await host.close();} finally {await opened.close();}})(),
        new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error("Bounded hosted shutdown expired.")), 9000);})]);}
      finally {clearTimeout(timer);}
    }};
  } catch (error) {await opened.close();throw error;}
}
export async function hostedPostgisMain(args: readonly string[]): Promise<void> {
  if (args.length === 2 && args[0] === "--dry-run") {
    const configuration = readJson(args[1]) as HostedPostgisConfiguration;
    let configured = false;
    try {cloudSqlPostgisIdentity(configuration);configured = true;} catch { /* unapproved checked-in template */ }
    process.stdout.write(JSON.stringify({status: "SOURCE_ONLY_NO_CLOUD_EXECUTION", configured,
      credentialsInitialized: false, listenerStarted: false, runtimeQualifiedForLinux: false}) + "\n");
    return;
  }
  if (args.length !== 5 || args[0] !== "--execute") throw new Error("Use --dry-run CONFIG, or explicitly approved --execute CONFIG APPROVAL TRUST KEYS.");
  const service = await startApprovedHostedPostgisService({configuration: readJson(args[1]) as HostedPostgisConfiguration,
    approval: readJson(args[2], 32 * 1024) as PostgisApprovalEnvelope,
    trustedKeys: readJson(args[3], 64 * 1024) as Readonly<Record<string, string>>,
    keyFile: args[4], port: Number(process.env.PORT ?? "8080")});
  let stopping = false;
  const stop = () => {if (!stopping) {stopping = true;void service.close().then(() => {process.exit(0);}, () => {process.exit(1);});}};
  process.once("SIGTERM", stop);process.once("SIGINT", stop);
}
if (require.main === module) hostedPostgisMain(process.argv.slice(2)).catch(() => {
  process.stderr.write("Hosted PostGIS startup refused or failed.\n");process.exitCode = 1;
});
