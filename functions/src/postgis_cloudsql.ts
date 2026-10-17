import type {PostgisClient, PostgisPool} from "./postgis_store.js";
import {digestPostgisConfiguration, requirePostgisExecutionPermit,
  type PostgisApprovalExpectation, type VerifiedPostgisExecutionPermit} from "./postgis_execution_approval.js";

export type CloudSqlPostgisConfiguration = Readonly<{
  projectId: string; projectNumber: string; runId: string; candidateDigest: string; gate: number;
  syntheticOnly: true;
  allowedProjectIds: readonly string[]; region: "us-central1";
  hosted: Readonly<{sql: Readonly<{
    instanceConnectionName: string; database: string; restoreDatabase: string; schema: "public";
    serviceAccountEmail: string;
  }>; [key: string]: unknown}>;
  [key: string]: unknown;
}>;
export type CloudSqlPoolIdentity = PostgisApprovalExpectation & Readonly<{database: string; schema: "public"}>;
export interface CloudSqlConnectorTransport {
  getOptions(options: {instanceConnectionName: string; ipType: "PRIVATE"; authType: "IAM"}): Promise<{stream: unknown}>;
  close(): void;
}
export type CloudSqlDependencies = Readonly<{
  createConnector(): CloudSqlConnectorTransport;
  createPool(options: Record<string, unknown>): PostgisPool;
}>;
const pools = new WeakMap<PostgisPool, {identity: CloudSqlPoolIdentity; permit: VerifiedPostgisExecutionPermit; closed: boolean}>();
function rejected(): never {throw new Error("Invalid or unavailable approved private Cloud SQL connection.");}
export function cloudSqlPostgisIdentity(configuration: CloudSqlPostgisConfiguration, target: "primary" | "restore" = "primary"): CloudSqlPoolIdentity {
  const sql = configuration.hosted?.sql;
  if (!sql || configuration.syntheticOnly !== true || configuration.projectId === "coupon-app-29446" || configuration.projectId.startsWith("demo-") ||
      configuration.allowedProjectIds?.length !== 1 || configuration.allowedProjectIds[0] !== configuration.projectId ||
      configuration.region !== "us-central1" || !/^bs-postgis-[a-z0-9-]{1,60}$/u.test(configuration.runId) ||
      sql.instanceConnectionName !== `${configuration.projectId}:${configuration.region}:${configuration.runId}-db` ||
      !/^bs_postgis_[a-z0-9_]{1,40}$/u.test(sql.database) || !/^bs_postgis_[a-z0-9_]{1,40}$/u.test(sql.restoreDatabase) ||
      sql.database === sql.restoreDatabase || sql.schema !== "public" ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(configuration.projectId) ||
      !new RegExp(`^[a-z][a-z0-9-]{4,28}[a-z0-9]@${configuration.projectId}\\.iam\\.gserviceaccount\\.com$`, "u").test(sql.serviceAccountEmail) ||
      (target !== "primary" && target !== "restore") || !Number.isInteger(configuration.gate) || configuration.gate < 1 || configuration.gate > 4) rejected();
  return Object.freeze({projectId: configuration.projectId, projectNumber: configuration.projectNumber,
    runId: configuration.runId, candidateDigest: configuration.candidateDigest,
    configDigest: digestPostgisConfiguration(configuration), gate: configuration.gate, purpose: "execute",
    database: target === "primary" ? sql.database : sql.restoreDatabase, schema: sql.schema});
}
/** Identity is held outside caller-controlled properties. A local pool or a
 * structurally identical object cannot be used by hosted snapshot helpers.
 */
export function requireCloudSqlPostgisPool(pool: PostgisPool, expected: CloudSqlPoolIdentity): void {
  const record = pools.get(pool);
  if (!record || record.closed || expected.purpose === "cleanup" || expected.nowMs !== undefined ||
      Object.keys(record.identity).some(key => record.identity[key as keyof CloudSqlPoolIdentity] !==
        expected[key as keyof CloudSqlPoolIdentity])) rejected();
  requirePostgisExecutionPermit(record.permit, {...record.identity, nowMs: undefined});
}
function deadline<T>(promise: Promise<T>, milliseconds: number, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {expired = true; reject(new Error("Cloud SQL operation timed out."));}, milliseconds);
    promise.then(value => {clearTimeout(timer); if (expired) late?.(value); else resolve(value);}, error => {
      clearTimeout(timer); if (!expired) reject(error);
    });
  });
}
function realDependencies(): CloudSqlDependencies {
  // These imports and constructors are deliberately behind config + signature verification.
  const {Connector} = require("@google-cloud/cloud-sql-connector") as {Connector: new () => CloudSqlConnectorTransport};
  const {Pool} = require("pg") as {Pool: new (options: Record<string, unknown>) => PostgisPool};
  return {createConnector: () => new Connector(), createPool: options => new Pool(options)};
}
/** No network/ADC on import. PRIVATE connector TLS + automatic IAM login are
 * mandatory. The caller must separately provision an approved Direct VPC route.
 * No host, password, TLS-disable, public-IP or fallback option is accepted.
 */
export async function createCloudSqlPostgisPool(configuration: CloudSqlPostgisConfiguration,
  permit: VerifiedPostgisExecutionPermit, target: "primary" | "restore" = "primary", dependencies?: CloudSqlDependencies,
): Promise<PostgisPool> {
  // Retain no caller-owned reference across connector/credential awaits. The
  // digest and every later target/user option refer to this same JSON snapshot.
  configuration = JSON.parse(JSON.stringify(configuration)) as CloudSqlPostgisConfiguration;
  const identity = cloudSqlPostgisIdentity(configuration, target);
  requirePostgisExecutionPermit(permit, identity);
  const deps = dependencies ?? realDependencies(), connector = deps.createConnector();
  let initialized = false, closedConnector = false, raw: PostgisPool | undefined;
  const closeConnector = () => {if (!closedConnector) {closedConnector = true; connector.close();}};
  const leased = new Map<PostgisClient, () => void>();
  try {
    const options = await deadline(connector.getOptions({instanceConnectionName: configuration.hosted.sql.instanceConnectionName,
      ipType: "PRIVATE", authType: "IAM"}).then(value => {initialized = true; return value;}), 10_000, closeConnector);
    if (!options || typeof options.stream !== "function") rejected();
    requirePostgisExecutionPermit(permit, identity);
    const user = configuration.hosted.sql.serviceAccountEmail.replace(/\.gserviceaccount\.com$/u, "");
    raw = deps.createPool({stream: options.stream, user, database: identity.database, max: 4,
      connectionTimeoutMillis: 2000, idleTimeoutMillis: 10_000, query_timeout: 5500, statement_timeout: 5000,
      maxLifetimeSeconds: 3000, allowExitOnIdle: true,
      options: "-c extra_float_digits=1 -c idle_in_transaction_session_timeout=10000 -c search_path=public",
      application_name: "bitestar_postgis_hosted_staging"});
    raw.on("error", () => undefined);
    const underlying = raw;
    const record = {identity, permit, closed: false};
    const wrapper: PostgisPool = {
      get totalCount() {return underlying.totalCount;}, get idleCount() {return underlying.idleCount;},
      get waitingCount() {return underlying.waitingCount;}, on: (event, listener) => underlying.on(event, listener),
      async connect() {
        if (record.closed) rejected();
        requirePostgisExecutionPermit(permit, identity);
        const client = await deadline(underlying.connect(), 2000, late => late.release(true));
        if (record.closed) {client.release(true); rejected();}
        let released = false, failed = false;
        const release = (destroy = false) => {if (!released) {released = true; leased.delete(client); client.release(destroy || failed);}};
        leased.set(client, () => release(true));
        return {query: async (text, values) => {
          try {
            if (released || record.closed) rejected();
            requirePostgisExecutionPermit(permit, identity);
            return await client.query(text, values);
          } catch (error) {failed = true; throw error;}
        }, release};
      },
      async query(text, values) {
        const client = await wrapper.connect();
        try {return await client.query(text, values);} finally {client.release();}
      },
      async end() {
        if (record.closed) return;
        record.closed = true;
        for (const release of leased.values()) release();
        try {await deadline(underlying.end(), 6000);} finally {closeConnector();}
      },
    };
    pools.set(wrapper, record);
    const health = await wrapper.query("SELECT current_database() AS database, current_user AS username");
    if (health.rows.length !== 1 || health.rows[0].database !== identity.database || health.rows[0].username !== user) {
      await wrapper.end(); rejected();
    }
    return wrapper;
  } catch {
    if (raw) {for (const release of leased.values()) release(); await deadline(raw.end(), 6000).catch(() => undefined);}
    // Pinned connector1.12.1 caches rejected initial promises. Its close() adds
    // an uncaught then() to those promises. Explicit instance names allocate no
    // DNS timer/socket on initial refresh failure, so close only after success.
    // A late successful initialization is closed by the deadline callback above.
    if (initialized) closeConnector();
    return rejected();
  }
}
