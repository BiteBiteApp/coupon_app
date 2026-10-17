import {createHash} from "node:crypto";
import {
  emptyPostgisSourceShard, postgisCanonicalJson, postgisSourceCollections,
  postgisSourceDigest, postgisSourceIdentity, postgisSourceShardFor,
  postgisSourceVersion, postgisXorDigest, type PostgisJson,
  type PostgisSourceFence, type PostgisSourcePayload, type PostgisSourceShard,
} from "./postgis_source.js";

export type PostgisRecoveryRow = Readonly<{payload: PostgisSourcePayload; digest: string}>;
export type PostgisRecoveryManifest = Readonly<{
  protocolVersion: typeof postgisSourceVersion;
  snapshotId: string;
  fence: PostgisSourceFence;
  rowCount: number;
  digest: string;
}>;
export interface PostgisRecoverySnapshotReader {
  readRecoveryManifest(snapshotId: string): Promise<PostgisRecoveryManifest | null>;
  readRecoveryRows(snapshotId: string, afterIdentity: string | null, limit: number): Promise<readonly PostgisRecoveryRow[]>;
}

export function postgisRecoveryIdentity(row: PostgisRecoveryRow): string {
  postgisSourceIdentity(row.payload.collection, row.payload.indexDocumentId);
  return `${row.payload.collection}/${row.payload.indexDocumentId}`;
}

export function validatePostgisSourceFence(fence: PostgisSourceFence): void {
  if (!fence || fence.protocolVersion !== postgisSourceVersion || !fence.enrolled ||
      typeof fence.epoch !== "string" || !/^[A-Za-z0-9_-]{1,100}$/u.test(fence.epoch) ||
      !Array.isArray(fence.shards) || fence.shards.length !== 16 || fence.shards.some((shard) =>
        !Number.isSafeInteger(shard.seq) || shard.seq < 0 || !shard.partitions ||
        postgisSourceCollections.some((collection) => {
          const partition = shard.partitions[collection];
          return !partition || !Number.isSafeInteger(partition.count) || partition.count < 0 ||
            !/^[a-f0-9]{64}$/u.test(partition.xor);
        }))) throw new Error("Invalid or incomplete PostGIS source fence.");
}

export function postgisRecoveryDigestHeader(manifest: Omit<PostgisRecoveryManifest, "digest">): string {
  return postgisCanonicalJson({protocolVersion: manifest.protocolVersion, snapshotId: manifest.snapshotId,
    fence: manifest.fence as unknown as PostgisJson, rowCount: manifest.rowCount});
}

/** Convenience for bounded fixtures. Runtime exporters may stream the same hash. */
export function createPostgisRecoveryManifest(snapshotId: string, fence: PostgisSourceFence, rows: readonly PostgisRecoveryRow[]): PostgisRecoveryManifest {
  validatePostgisSourceFence(fence);
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(snapshotId)) throw new Error("Invalid recovery snapshot ID.");
  const header = {protocolVersion: postgisSourceVersion, snapshotId, fence, rowCount: rows.length};
  const hash = createHash("sha256").update(postgisRecoveryDigestHeader(header));
  const sorted = [...rows].sort((left, right) => {
    const a = postgisRecoveryIdentity(left), b = postgisRecoveryIdentity(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const row of sorted) hash.update("\n").update(postgisCanonicalJson(row));
  return {...header, digest: hash.digest("hex")};
}

/** Reads actual retained contents in bounded pages; a caller's success flag is never proof. */
export async function validatePostgisRecoverySnapshot(
  reader: PostgisRecoverySnapshotReader,
  expected: PostgisRecoveryManifest,
): Promise<void> {
  validatePostgisSourceFence(expected.fence);
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(expected.snapshotId) || expected.protocolVersion !== postgisSourceVersion ||
      !Number.isSafeInteger(expected.rowCount) || expected.rowCount < 0 || !/^[a-f0-9]{64}$/u.test(expected.digest)) {
    throw new Error("Invalid PostGIS recovery manifest.");
  }
  const retained = await reader.readRecoveryManifest(expected.snapshotId);
  if (retained === null || postgisSourceDigest(retained as unknown as PostgisJson) !==
      postgisSourceDigest(expected as unknown as PostgisJson)) throw new Error("The exact durable recovery snapshot is unavailable.");
  const hash = createHash("sha256").update(postgisRecoveryDigestHeader(expected));
  const actual: PostgisSourceShard[] = Array.from({length: 16}, emptyPostgisSourceShard);
  let after: string | null = null;
  let count = 0;
  while (true) {
    const rows = await reader.readRecoveryRows(expected.snapshotId, after, 500);
    if (!Array.isArray(rows) || rows.length > 500) throw new Error("Invalid recovery snapshot page.");
    for (const row of rows as readonly PostgisRecoveryRow[]) {
      const identity = postgisRecoveryIdentity(row);
      if ((after !== null && identity <= after) || row.payload.projection === null ||
          row.digest !== postgisSourceDigest(row.payload)) throw new Error("Invalid, duplicate or poisoned recovery row.");
      const shard = postgisSourceShardFor(row.payload.collection, row.payload.indexDocumentId);
      const partition = actual[shard].partitions[row.payload.collection];
      actual[shard] = {...actual[shard], partitions: {...actual[shard].partitions,
        [row.payload.collection]: {count: partition.count + 1, xor: postgisXorDigest(partition.xor, row.digest)}}};
      hash.update("\n").update(postgisCanonicalJson(row));
      after = identity;
      if (++count > expected.rowCount) throw new Error("Recovery snapshot contains unexpected rows.");
    }
    if (rows.length < 500) break;
  }
  if (count !== expected.rowCount || hash.digest("hex") !== expected.digest) throw new Error("Recovery snapshot is incomplete or corrupt.");
  for (let shard = 0; shard < 16; shard++) for (const collection of postgisSourceCollections) {
    const before = expected.fence.shards[shard].partitions[collection];
    const afterPartition = actual[shard].partitions[collection];
    if (before.count !== afterPartition.count || before.xor !== afterPartition.xor) {
      throw new Error("Recovery snapshot does not match its published source manifest.");
    }
  }
  // Catch replacement/removal during a streaming read before any source data is pruned.
  const final = await reader.readRecoveryManifest(expected.snapshotId);
  if (final === null || postgisSourceDigest(final as unknown as PostgisJson) !==
      postgisSourceDigest(expected as unknown as PostgisJson)) throw new Error("Recovery snapshot changed during validation.");
}
