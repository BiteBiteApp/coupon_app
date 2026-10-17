import {readFileSync, statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {openApprovedHostedPostgisResources} from "./postgis_hosted_entrypoint.js";
import {createHostedPostgisRuntime, type HostedPostgisConfiguration} from "./postgis_hosted_runtime.js";
import {cloudSqlPostgisIdentity, createCloudSqlPostgisPool} from "./postgis_cloudsql.js";
import {GcsPostgisSnapshotStore} from "./postgis_snapshot_gcs.js";
import {publishHostedPostgisSnapshot, restoreHostedPostgisSnapshot} from "./postgis_snapshot.js";
import {PostgisReadModel} from "./postgis_store.js";
import {requirePostgisSyntheticBatchesComplete, runHostedPostgisNativeJob, type HostedPostgisJob} from "./postgis_hosted_jobs.js";
import {verifyPostgisExecutionApproval, type PostgisApprovalEnvelope} from "./postgis_execution_approval.js";
function json(path: string): any {
  if (!isAbsolute(path) || statSync(path).size > 256 * 1024) throw new Error("Invalid bounded job input.");
  return JSON.parse(readFileSync(path, "utf8"));
}
export async function runApprovedHostedPostgisJob(options: Parameters<typeof openApprovedHostedPostgisResources>[0] & {jobId: string}): Promise<unknown> {
  // Jobs are signed immutable configuration, never an arbitrary runtime payload.
  const config = JSON.parse(JSON.stringify(options.configuration)) as HostedPostgisConfiguration;
  const jobs = config.hosted.jobs as readonly (HostedPostgisJob & {maxPages?: number})[] | undefined;
  if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > 12 || new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("Invalid approved job plan.");
  const job = jobs.find(item => item.id === options.jobId);
  if (!job || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/u.test(job.id) ||
      !["initialize", "fixture", "enroll", "catchup", "lifecycle", "snapshot", "restore", "prune"].includes(job.action) ||
      !Number.isInteger(job.maxPages ?? 8) || (job.maxPages ?? 8) < 1 || (job.maxPages ?? 8) > 64) throw new Error("Unapproved bounded job.");
  // Provider admission can precede a delayed container start. Reverify here,
  // before any keys or credentials, for the entire 600s platform task lifetime.
  const permit = verifyPostgisExecutionApproval(options.approval, options.trustedKeys, cloudSqlPostgisIdentity(config));
  if (permit.validUntilMs - Date.now() < 600_000) throw new Error("Execution approval cannot cover the full hosted job lifetime.");
  const opened = await openApprovedHostedPostgisResources({...options, configuration: config});
  let restorePool: Awaited<ReturnType<typeof createCloudSqlPostgisPool>> | undefined;
  try {
    const runtime = createHostedPostgisRuntime(config, opened.permit, opened.resources), deadline = Date.now() + 540_000;
    if (["initialize", "fixture", "lifecycle"].includes(job.action)) return await runHostedPostgisNativeJob(runtime, opened.resources.database,
      opened.resources.identityKeyV1, config.runId, job);
    await requirePostgisSyntheticBatchesComplete(opened.resources.database, config.runId);
    if (job.action === "snapshot" || job.action === "restore" || job.action === "prune") {
      const snapshot = config.hosted.snapshot as {snapshotId: string}, store = new GcsPostgisSnapshotStore(config, opened.permit);
      if (job.action === "snapshot") return await publishHostedPostgisSnapshot(opened.resources.pool, config, store, snapshot.snapshotId);
      if (job.action === "prune") {
        const manifest = await store.readRecoveryManifest(snapshot.snapshotId);
        if (!manifest) throw new Error("Retained recovery snapshot is missing.");
        await runtime.source.acknowledgePublishedFence(manifest.fence, manifest, store);
        return await runtime.source.pruneAcknowledgedEvents(store, 100);
      }
      restorePool = await createCloudSqlPostgisPool(config, opened.permit, "restore");
      await new PostgisReadModel(restorePool, runtime.source).initializeLocalSchema();
      let result;
      for (let i = 0; i < (job.maxPages ?? 8) && Date.now() < deadline; i++) {
        result = await restoreHostedPostgisSnapshot(restorePool, config, store, snapshot.snapshotId, 75);
        if (result.ready) return result;
      }
      return result ?? {ready: false};
    }
    let result;
    for (let i = 0; i < (job.maxPages ?? 8) && Date.now() < deadline; i++) {
      result = await runHostedPostgisNativeJob(runtime, opened.resources.database, opened.resources.identityKeyV1, config.runId, job);
      if ((result as {ready?: boolean; phase?: string}).ready || (result as {phase?: string}).phase === "complete") return result;
    }
    return result;
  } finally {try {await restorePool?.end();} finally {await opened.close();}}
}
export async function hostedPostgisJobMain(args: readonly string[]): Promise<void> {
  if (args.length === 2 && args[0] === "--dry-run") {json(args[1]);process.stdout.write('{"status":"SOURCE_ONLY_NO_CLOUD_EXECUTION","jobStarted":false}\n');return;}
  if (args.length !== 6 || args[0] !== "--execute") throw new Error("Explicit approved job inputs required.");
  const result = await runApprovedHostedPostgisJob({configuration: json(args[1]), approval: json(args[2]) as PostgisApprovalEnvelope,
    trustedKeys: json(args[3]), keyFile: args[4], port: 8080, jobId: args[5]});
  process.stdout.write(JSON.stringify({jobId: args[5],completedInvocation: true,
    ready: (result as {ready?: boolean})?.ready ?? null, phase: (result as {phase?: string})?.phase ?? null}) + "\n");
}
if (require.main === module) hostedPostgisJobMain(process.argv.slice(2)).then(() => {process.exit(0);}, () => {
  process.stderr.write("Hosted staging job refused or incomplete; reconcile the approved checkpoint.\n");process.exit(1);
});
