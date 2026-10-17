import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {open, mkdir, readFile, link, unlink, chmod, stat} from "node:fs/promises";
import {resolve, join, isAbsolute} from "node:path";
import {createInterface} from "node:readline";
import {
  decodePostgisProjection, postgisCanonicalJson, postgisSourceDigest,
  postgisSourceCollections, postgisSourceShardFor, postgisSourceVersion,
  type PostgisSourceFence, type PostgisJson,
} from "./postgis_source.js";
import {
  postgisRecoveryDigestHeader, postgisRecoveryIdentity,
  validatePostgisRecoverySnapshot, validatePostgisSourceFence,
  type PostgisRecoveryManifest, type PostgisRecoveryRow,
  type PostgisRecoverySnapshotReader,
} from "./postgis_source_recovery.js";
import {entityFromProjection} from "./postgis_semantics.js";
import {insertEntity, type PostgisPool, type PostgisConnection} from "./postgis_store.js";
import {cloudSqlPostgisIdentity, requireCloudSqlPostgisPool, type CloudSqlPostgisConfiguration} from "./postgis_cloudsql.js";
import {GcsPostgisSnapshotStore, requireApprovedPostgisSnapshotStore} from "./postgis_snapshot_gcs.js";

function snapshotId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(value)) throw new Error("Invalid recovery snapshot ID.");
}
async function requireLocalDatabase(pool: PostgisPool): Promise<void> {
  const result = (await pool.query("SELECT current_database() AS name,current_user AS owner,inet_server_addr()::text AS address")).rows[0];
  if (!/^bsgate0(?:_[a-z0-9_]+)?$/u.test(result.name) || result.owner !== "bsgate0" ||
      !/^(?:127\.0\.0\.1(?:\/32)?|::1(?:\/128)?)$/u.test(result.address)) {
    throw new Error("Snapshot operations require the isolated local Gate 0 database.");
  }
}
type Offset = Readonly<{identity: string; offset: number}>;
type OffsetIndex = Readonly<{rowCount: number; dataBytes: number; offsets: readonly Offset[]}>;

/** Durable local Gate 0 files. Hosted snapshot storage remains separately gated. */
export class LocalPostgisSnapshotReader implements PostgisRecoverySnapshotReader {
  readonly directory: string;
  constructor(directory: string) {
    if (!isAbsolute(directory)) throw new Error("Snapshot directory must be absolute.");
    this.directory = resolve(directory);
  }
  path(id: string, extension: "manifest.json" | "rows.jsonl" | "offsets.json"): string {
    snapshotId(id); return join(this.directory, `${id}.${extension}`);
  }
  async readRecoveryManifest(id: string): Promise<PostgisRecoveryManifest | null> {
    try {
      const file = this.path(id, "manifest.json");
      if ((await stat(file)).size > 128 * 1024) throw new Error("Recovery manifest is oversized.");
      return JSON.parse(await readFile(file, "utf8")) as PostgisRecoveryManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async readRecoveryRows(id: string, afterIdentity: string | null, limit: number): Promise<readonly PostgisRecoveryRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid snapshot row page.");
    const indexPath = this.path(id, "offsets.json");
    if ((await stat(indexPath)).size > 16 * 1024 * 1024) throw new Error("Recovery offset index exceeds the local bound.");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as OffsetIndex;
    const bytes = (await stat(this.path(id, "rows.jsonl"))).size;
    if (bytes !== index.dataBytes || !Number.isSafeInteger(index.rowCount) || index.rowCount < 0 ||
        !Array.isArray(index.offsets)) throw new Error("Recovery row file does not match its sparse index.");
    let start = 0;
    let previous = "";
    let previousOffset = -1;
    for (const entry of index.offsets) {
      if (typeof entry.identity !== "string" || entry.identity <= previous || !Number.isSafeInteger(entry.offset) ||
          entry.offset <= previousOffset || entry.offset < 0 || entry.offset >= bytes) throw new Error("Invalid recovery sparse index.");
      if (afterIdentity !== null && entry.identity <= afterIdentity) start = entry.offset;
      previous = entry.identity; previousOffset = entry.offset;
    }
    const stream = createReadStream(this.path(id, "rows.jsonl"), {encoding: "utf8", start});
    const lines = createInterface({input: stream, crlfDelay: Infinity});
    const rows: PostgisRecoveryRow[] = [];
    try {
      for await (const line of lines) {
        if (!line || Buffer.byteLength(line) > 128 * 1024) throw new Error("Invalid recovery row boundary.");
        const row = JSON.parse(line) as PostgisRecoveryRow;
        if (afterIdentity === null || postgisRecoveryIdentity(row) > afterIdentity) rows.push(row);
        if (rows.length === limit) break;
      }
    } finally {lines.close(); stream.destroy();}
    return rows;
  }
}

/** Export only a complete published source snapshot, with no overwrite or partial manifest. */
export async function exportPostgisSnapshot(pool: PostgisPool, directory: string, id: string): Promise<PostgisRecoveryManifest> {
  await requireLocalDatabase(pool); snapshotId(id);
  const reader = new LocalPostgisSnapshotReader(directory);
  await mkdir(reader.directory, {recursive: true});
  if (await reader.readRecoveryManifest(id) !== null) throw new Error("Recovery snapshot already exists.");
  const suffix = `.partial-${process.pid}-${createHash("sha256").update(String(process.hrtime.bigint())).digest("hex").slice(0, 10)}`;
  const rowPath = reader.path(id, "rows.jsonl"), indexPath = reader.path(id, "offsets.json"), manifestPath = reader.path(id, "manifest.json");
  const temporary = [rowPath + suffix, indexPath + suffix, manifestPath + suffix];
  const linked: string[] = [];
  const client = await pool.connect();
  let rowsFile: Awaited<ReturnType<typeof open>> | null = null;
  let committed = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const publication = (await client.query("SELECT * FROM publication WHERE singleton FOR SHARE")).rows[0];
    const progress = (await client.query("SELECT * FROM ingestion_progress WHERE singleton")).rows[0];
    const ready = (await client.query("SELECT ready FROM bootstrap WHERE singleton")).rows[0]?.ready;
    if (!ready || progress.target !== null || progress.state !== "ready") throw new Error("Cannot export an incomplete search publication.");
    const fence = (await client.query("SELECT source_manifest FROM revisions WHERE revision=$1", [publication.revision])).rows[0]?.source_manifest as PostgisSourceFence;
    validatePostgisSourceFence(fence);
    if (fence.epoch !== progress.epoch || fence.shards.some((shard, index) => shard.seq !== publication.fence[index])) throw new Error("Published snapshot fence is inconsistent.");
    const rowCount = Number((await client.query("SELECT count(*) AS count FROM source_heads")).rows[0].count);
    const header = {protocolVersion: postgisSourceVersion, snapshotId: id, fence, rowCount};
    const hash = createHash("sha256").update(postgisRecoveryDigestHeader(header));
    rowsFile = await open(temporary[0], "wx", 0o600);
    const offsets: Offset[] = [];
    let written = 0, dataBytes = 0;
    await client.query("DECLARE recovery_export NO SCROLL CURSOR FOR SELECT index_path,payload,digest FROM source_heads ORDER BY index_path COLLATE \"C\"");
    while (true) {
      const result = await client.query("FETCH FORWARD 500 FROM recovery_export");
      for (const source of result.rows) {
        const row: PostgisRecoveryRow = {payload: source.payload, digest: source.digest};
        if (postgisRecoveryIdentity(row) !== source.index_path || row.payload.projection === null ||
            row.digest !== postgisSourceDigest(row.payload)) throw new Error("Published source head is corrupt.");
        if (written % 500 === 0) offsets.push({identity: source.index_path, offset: dataBytes});
        const canonical = postgisCanonicalJson(row);
        hash.update("\n").update(canonical);
        const line = canonical + "\n";
        await rowsFile.write(line);
        dataBytes += Buffer.byteLength(line); written++;
      }
      if (result.rows.length < 500) break;
    }
    if (written !== rowCount) throw new Error("Recovery export did not include every source head.");
    await rowsFile.sync(); await rowsFile.close(); rowsFile = null;
    const manifest: PostgisRecoveryManifest = {...header, digest: hash.digest("hex")};
    for (const [file, content] of [[temporary[1], JSON.stringify({rowCount, dataBytes, offsets})],
      [temporary[2], JSON.stringify(manifest)]] as const) {
      const handle = await open(file, "wx", 0o600);
      try {await handle.writeFile(content); await handle.sync();} finally {await handle.close();}
    }
    // Hard links provide atomic create-if-absent publication without a rename
    // that could overwrite another worker's qualified artifact.
    for (let index = 0; index < 2; index++) {
      const destination = index === 0 ? rowPath : indexPath;
      await link(temporary[index], destination); linked.push(destination); await chmod(destination, 0o400);
    }
    await client.query("COMMIT"); committed = true;
    await link(temporary[2], manifestPath); linked.push(manifestPath); await chmod(manifestPath, 0o400);
    const directoryHandle = await open(reader.directory, "r");
    try {await directoryHandle.sync();} finally {await directoryHandle.close();}
    await validatePostgisRecoverySnapshot(reader, manifest);
    return manifest;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    for (const file of linked) await unlink(file).catch(() => undefined);
    throw error;
  } finally {
    if (rowsFile !== null) await rowsFile.close();
    for (const file of temporary) await unlink(file).catch(() => undefined);
    client.release();
  }
}

/** Stream bounded pages from one repeatable-read publication directly to GCS.
 * No runner filesystem is used. Slow/failed uploads can abort the bounded SQL
 * transaction; immutable chunks are safe to reconcile on an explicit retry.
 */
export async function publishHostedPostgisSnapshot(
  pool: PostgisPool, configuration: CloudSqlPostgisConfiguration, store: GcsPostgisSnapshotStore, id: string,
): Promise<PostgisRecoveryManifest> {
  requireCloudSqlPostgisPool(pool, cloudSqlPostgisIdentity(configuration)); snapshotId(id);
  requireApprovedPostgisSnapshotStore(store, configuration, id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const publication = (await client.query("SELECT * FROM publication WHERE singleton")).rows[0];
    const progress = (await client.query("SELECT * FROM ingestion_progress WHERE singleton")).rows[0];
    const ready = (await client.query("SELECT ready FROM bootstrap WHERE singleton")).rows[0]?.ready;
    if (!ready || progress.target !== null || progress.state !== "ready") throw new Error("Cannot export an incomplete search publication.");
    const fence = (await client.query("SELECT source_manifest FROM revisions WHERE revision=$1", [publication.revision])).rows[0]?.source_manifest as PostgisSourceFence;
    validatePostgisSourceFence(fence);
    if (fence.epoch !== progress.epoch || fence.shards.some((shard, index) => shard.seq !== publication.fence[index])) throw new Error("Published snapshot fence is inconsistent.");
    const rowCount = Number((await client.query("SELECT count(*) AS count FROM source_heads")).rows[0].count);
    const header = {protocolVersion: postgisSourceVersion, snapshotId: id, fence, rowCount};
    const readRows = async (_id: string, after: string | null, limit: number): Promise<readonly PostgisRecoveryRow[]> => {
      if (_id !== id || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid hosted snapshot page.");
      const result = await client.query(`SELECT index_path,payload,digest FROM source_heads
        WHERE ($1::text IS NULL OR index_path COLLATE "C" > $1::text COLLATE "C") ORDER BY index_path COLLATE "C" LIMIT $2`, [after, limit]);
      return result.rows.map(source => {
        const row = {payload: source.payload, digest: source.digest} as PostgisRecoveryRow;
        if (postgisRecoveryIdentity(row) !== source.index_path || row.payload.projection === null ||
            row.digest !== postgisSourceDigest(row.payload)) throw new Error("Published source head is corrupt.");
        return row;
      });
    };
    const hash = createHash("sha256").update(postgisRecoveryDigestHeader(header));
    let after: string | null = null, count = 0;
    while (true) {
      const rows = await readRows(id, after, 500);
      for (const row of rows) {hash.update("\n").update(postgisCanonicalJson(row)); after = postgisRecoveryIdentity(row); count++;}
      if (rows.length < 500) break;
    }
    if (count !== rowCount) throw new Error("Hosted snapshot row count changed.");
    const manifest: PostgisRecoveryManifest = {...header, digest: hash.digest("hex")};
    await store.publish({readRecoveryManifest: async requested => requested === id ? manifest : null,
      readRecoveryRows: readRows}, manifest);
    await client.query("COMMIT");
    return manifest;
  } catch (error) {await client.query("ROLLBACK").catch(() => undefined); throw error;}
  finally {client.release();}
}

async function verifyHeads(client: PostgisConnection, fence: PostgisSourceFence): Promise<void> {
  const actual = (await client.query(`SELECT shard,payload->>'collection' AS collection,count(*)::int AS count,
    bit_xor(('x'||digest)::bit(256))::text AS xor FROM source_heads GROUP BY shard,payload->>'collection'`)).rows;
  for (let shard = 0; shard < 16; shard++) for (const collection of postgisSourceCollections) {
    const entry = actual.find((row) => row.shard === shard && row.collection === collection);
    const xor = entry ? BigInt(`0b${entry.xor}`).toString(16).padStart(64, "0") : "0".repeat(64);
    const expected = fence.shards[shard].partitions[collection];
    if ((entry?.count ?? 0) !== expected.count || xor !== expected.xor) throw new Error("Restored snapshot source manifest is incomplete.");
  }
}

/** One bounded restore page; only a fresh derived database may begin restoration. */
export async function restorePostgisSnapshot(
  pool: PostgisPool, reader: PostgisRecoverySnapshotReader, id: string, batchSize = 75,
): Promise<{ready: boolean; restored: number; afterIdentity: string | null}> {
  await requireLocalDatabase(pool); snapshotId(id);
  return restoreSnapshot(pool, reader, id, batchSize);
}

/** Restore has the same integrity/fence gate as local recovery and can target
 * only the separately configured fresh restore database, never the serving DB.
 */
export async function restoreHostedPostgisSnapshot(
  pool: PostgisPool, configuration: CloudSqlPostgisConfiguration,
  reader: GcsPostgisSnapshotStore, id: string, batchSize = 75,
): Promise<{ready: boolean; restored: number; afterIdentity: string | null}> {
  requireCloudSqlPostgisPool(pool, cloudSqlPostgisIdentity(configuration, "restore")); snapshotId(id);
  requireApprovedPostgisSnapshotStore(reader, configuration, id);
  return restoreSnapshot(pool, reader, id, batchSize);
}

async function restoreSnapshot(
  pool: PostgisPool, reader: PostgisRecoverySnapshotReader, id: string, batchSize: number,
): Promise<{ready: boolean; restored: number; afterIdentity: string | null}> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Invalid recovery restore page.");
  const manifest = await reader.readRecoveryManifest(id);
  if (manifest === null) throw new Error("Recovery snapshot is missing.");
  validatePostgisSourceFence(manifest.fence);
  await pool.query(`CREATE TABLE IF NOT EXISTS snapshot_restore_progress (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), snapshot_id text NOT NULL,
    digest text NOT NULL, manifest jsonb NOT NULL, after_identity text, restored_count bigint NOT NULL,
    complete boolean NOT NULL DEFAULT false)`);
  const existing = (await pool.query("SELECT * FROM snapshot_restore_progress WHERE singleton")).rows[0];
  if (!existing) await validatePostgisRecoverySnapshot(reader, manifest);
  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN"); began = true;
    const publication = (await client.query("SELECT * FROM publication WHERE singleton FOR UPDATE")).rows[0];
    let progress = (await client.query("SELECT * FROM snapshot_restore_progress WHERE singleton FOR UPDATE")).rows[0];
    if (!progress) {
      const totals = (await client.query(`SELECT (SELECT count(*) FROM entities) AS entities,
        (SELECT count(*) FROM source_heads) AS heads,(SELECT count(*) FROM revision_pins) AS pins,
        (SELECT count(*) FROM sessions) AS sessions,(SELECT ready FROM bootstrap WHERE singleton) AS ready`)).rows[0];
      const ingestion = (await client.query("SELECT * FROM ingestion_progress WHERE singleton FOR UPDATE")).rows[0];
      if (Number(totals.entities) || Number(totals.heads) || Number(totals.pins) || Number(totals.sessions) ||
          totals.ready || ingestion.target !== null || publication.fence.some((seq: number) => seq !== 0)) {
        throw new Error("Recovery restore requires a fresh empty derived database.");
      }
      await client.query(`INSERT INTO snapshot_restore_progress(singleton,snapshot_id,digest,manifest,after_identity,restored_count)
        VALUES(true,$1,$2,$3,NULL,0)`, [id, manifest.digest, manifest]);
      await client.query("UPDATE ingestion_progress SET state='blocked',failure=$1 WHERE singleton",
        [{kind: "snapshot_restore", snapshotId: id, digest: manifest.digest}]);
      progress = {snapshot_id: id, digest: manifest.digest, manifest, after_identity: null, restored_count: 0, complete: false};
    }
    if (progress.snapshot_id !== id || progress.digest !== manifest.digest ||
        postgisSourceDigest(progress.manifest) !== postgisSourceDigest(manifest as unknown as PostgisJson)) {
      throw new Error("Recovery resume changed its immutable snapshot.");
    }
    await client.query("COMMIT"); began = false;
    if (progress.complete) return {ready: true, restored: Number(progress.restored_count), afterIdentity: progress.after_identity};
    const rows = await reader.readRecoveryRows(id, progress.after_identity, batchSize);
    if (rows.length > batchSize) throw new Error("Recovery reader exceeded its page bound.");
    await client.query("BEGIN"); began = true;
    await client.query("SELECT * FROM publication WHERE singleton FOR UPDATE");
    const current = (await client.query("SELECT * FROM snapshot_restore_progress WHERE singleton FOR UPDATE")).rows[0];
    if (current.snapshot_id !== id || current.digest !== manifest.digest || current.after_identity !== progress.after_identity) {
      throw new Error("Recovery restore advanced concurrently; resume the persisted checkpoint.");
    }
    let after = progress.after_identity as string | null;
    let restored = Number(progress.restored_count);
    for (const row of rows) {
      const identity = postgisRecoveryIdentity(row);
      if ((after !== null && identity <= after) || row.payload.projection === null || row.digest !== postgisSourceDigest(row.payload)) {
        throw new Error("Invalid recovery row during restore.");
      }
      const data = decodePostgisProjection(row.payload.projection);
      const entity = entityFromProjection({path: identity, id: row.payload.indexDocumentId, data}, row.payload.projection);
      await insertEntity(client, entity, 0);
      await client.query("INSERT INTO source_heads(index_path,shard,payload,digest) VALUES($1,$2,$3,$4)",
        [identity, postgisSourceShardFor(row.payload.collection, row.payload.indexDocumentId), row.payload, row.digest]);
      after = identity; restored++;
      if (restored > manifest.rowCount) throw new Error("Restore exceeds the immutable snapshot row count.");
    }
    const complete = rows.length < batchSize;
    if (complete) {
      if (restored !== manifest.rowCount) throw new Error("Recovery restore is missing source rows.");
      await verifyHeads(client, manifest.fence);
      const vector = JSON.stringify(manifest.fence.shards.map((shard) => shard.seq));
      await client.query("UPDATE revisions SET source_manifest=$1,fence=$2 WHERE revision=0", [manifest.fence, vector]);
      await client.query("UPDATE publication SET revision=0,fence=$1 WHERE singleton", [vector]);
      await client.query("UPDATE ingestion_progress SET fence=$1,state='ready',failure=NULL,target=NULL,epoch=$2 WHERE singleton", [vector, manifest.fence.epoch]);
      await client.query("UPDATE bootstrap SET ready=true WHERE singleton");
    }
    await client.query("UPDATE snapshot_restore_progress SET after_identity=$1,restored_count=$2,complete=$3 WHERE singleton", [after, restored, complete]);
    await client.query("COMMIT"); began = false;
    return {ready: complete, restored, afterIdentity: after};
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    throw error;
  } finally {client.release();}
}
