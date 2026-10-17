import {createHash} from "node:crypto";
import {FieldPath, type Firestore, type Transaction} from "firebase-admin/firestore";
import {
  emptyPostgisSourceShard, encodePostgisProjection, postgisSourceCollections,
  postgisSourceDigest, postgisSourceIdentity, postgisSourceShardCount,
  postgisSourceShardFor, postgisSourceVersion, postgisXorDigest,
  validatePostgisSourceEvent, type PostgisSourceCollection, type PostgisSourceEvent,
  type PostgisSourceFence, type PostgisSourcePayload, type PostgisSourceShard, type PostgisJson,
} from "./postgis_source.js";
import {
  validatePostgisRecoverySnapshot, validatePostgisSourceFence,
  type PostgisRecoveryManifest, type PostgisRecoverySnapshotReader,
} from "./postgis_source_recovery.js";

export const postgisSourceControlPath = "private_postgis_source_control/active";
export const postgisSourceEventsCollection = "private_postgis_source_events";
export const postgisSourceShardsCollection = "private_postgis_source_shards";
export const postgisSourceHeadsCollection = "private_postgis_source_heads";
export const postgisSourceBootstrapsCollection = "private_postgis_source_bootstraps";
export const postgisSourceRetentionPath = "private_postgis_source_retention/acknowledged";

export type PostgisSourceConfiguration = Readonly<{
  /** Explicit candidate epoch; never reset this value to hide a delivery gap. */
  epoch: string;
  projectId: string;
  allowedProjectIds: readonly string[];
}>;

export type PostgisEnrollmentCheckpoint = Readonly<{
  protocolVersion: typeof postgisSourceVersion;
  epoch: string;
  bootstrapId: string;
  phase: "scan" | "complete";
  collectionIndex: number;
  afterDocumentId: string | null;
  scanned: number;
  startFence: PostgisSourceFence;
  endFence: PostgisSourceFence | null;
}>;

function boundedIdentifier(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(value)) throw new Error("Invalid PostGIS candidate identifier.");
}

export function requirePostgisSourceConfiguration(database: Firestore, config: PostgisSourceConfiguration): void {
  boundedIdentifier(config.epoch);
  if (!config.projectId || config.projectId === "coupon-app-29446" ||
      (database as unknown as {readonly projectId: unknown}).projectId !== config.projectId ||
      !config.allowedProjectIds.includes(config.projectId) ||
      config.allowedProjectIds.includes("coupon-app-29446")) {
    throw new Error("PostGIS source requires an explicitly allowlisted nonproduction project.");
  }
}

function shardId(shard: number): string {
  if (!Number.isInteger(shard) || shard < 0 || shard >= postgisSourceShardCount) throw new Error("Invalid PostGIS shard.");
  return `s${shard.toString().padStart(2, "0")}`;
}

function eventId(shard: number, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("Invalid PostGIS sequence.");
  return `${shardId(shard)}_${seq.toString().padStart(16, "0")}`;
}

function requireControl(data: Record<string, unknown> | undefined, config: PostgisSourceConfiguration): void {
  if (data?.protocolVersion !== postgisSourceVersion || data.epoch !== config.epoch ||
      data.projectId !== config.projectId || data.writerVersion !== postgisSourceVersion) {
    throw new Error("PostGIS projection writers are not initialized for this epoch.");
  }
}

function readShard(data: Record<string, unknown> | undefined): PostgisSourceShard {
  if (data === undefined) return emptyPostgisSourceShard();
  const shard = data as unknown as PostgisSourceShard;
  if (!Number.isSafeInteger(shard.seq) || shard.seq < 0 || !shard.partitions ||
      postgisSourceCollections.some((collection) => {
        const entry = shard.partitions[collection];
        return !entry || !Number.isSafeInteger(entry.count) || entry.count < 0 ||
          !/^[0-9a-f]{64}$/u.test(entry.xor);
      })) throw new Error("Invalid PostGIS source manifest shard.");
  return shard;
}

/**
 * Actual Firestore implementation of the prototype's transactional source and
 * outbox boundary. Construction is inert; initialize/enrollment are explicit.
 * Every maintenance writer must use this same epoch before enrollment begins.
 */
export class FirestorePostgisSource {
  constructor(readonly database: Firestore, readonly config: PostgisSourceConfiguration) {
    requirePostgisSourceConfiguration(database, config);
  }

  async initialize(): Promise<void> {
    await this.database.runTransaction(async (transaction) => {
      const reference = this.database.doc(postgisSourceControlPath);
      const existing = await transaction.get(reference);
      if (existing.exists) {
        requireControl(existing.data(), this.config);
        return;
      }
      transaction.create(reference, {
        protocolVersion: postgisSourceVersion, writerVersion: postgisSourceVersion,
        epoch: this.config.epoch, projectId: this.config.projectId, enrolled: false,
      });
    });
  }

  /** Call after all other transaction reads and before any writes. */
  async recordMutation(
    transaction: Transaction,
    collection: PostgisSourceCollection,
    indexDocumentId: string,
    projection: Readonly<Record<string, unknown>> | null,
  ): Promise<void> {
    const identity = postgisSourceIdentity(collection, indexDocumentId);
    const headId = createHash("sha256").update(identity).digest("hex");
    const shard = postgisSourceShardFor(collection, indexDocumentId);
    const controlRef = this.database.doc(postgisSourceControlPath);
    const headRef = this.database.doc(`${postgisSourceHeadsCollection}/${headId}`);
    const shardRef = this.database.doc(`${postgisSourceShardsCollection}/${shardId(shard)}`);
    const [control, headSnapshot, shardSnapshot] = await transaction.getAll(controlRef, headRef, shardRef);
    requireControl(control.data(), this.config);
    const payload: PostgisSourcePayload = {
      collection, indexDocumentId,
      projection: encodePostgisProjection(collection, indexDocumentId, projection),
    };
    const digest = postgisSourceDigest(payload);
    const oldHead = headSnapshot.data();
    if (oldHead !== undefined && (oldHead.identity !== identity || oldHead.epoch !== this.config.epoch ||
        typeof oldHead.digest !== "string" || !/^[a-f0-9]{64}$/u.test(oldHead.digest) ||
        typeof oldHead.present !== "boolean")) throw new Error("Invalid PostGIS identity head.");
    if (oldHead?.digest === digest || (oldHead === undefined && payload.projection === null)) return;
    const oldShard = readShard(shardSnapshot.data());
    if (oldShard.seq === Number.MAX_SAFE_INTEGER) throw new Error("PostGIS source sequence is exhausted.");
    const seq = oldShard.seq + 1;
    const previous = oldShard.partitions[collection];
    let xor = previous.xor;
    let count = previous.count;
    if (oldHead?.present === true) {
      xor = postgisXorDigest(xor, oldHead.digest as string);
      count--;
    }
    if (payload.projection !== null) {
      xor = postgisXorDigest(xor, digest);
      count++;
    }
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("PostGIS source count is inconsistent.");
    const event: PostgisSourceEvent = {shard, seq, payload, digest};
    transaction.create(this.database.doc(`${postgisSourceEventsCollection}/${eventId(shard, seq)}`), event);
    transaction.set(headRef, {
      epoch: this.config.epoch, identity, seq, digest, present: payload.projection !== null,
    });
    transaction.set(shardRef, {
      seq, partitions: {...oldShard.partitions, [collection]: {count, xor}},
    });
  }

  private async fenceInTransaction(transaction: Transaction): Promise<PostgisSourceFence> {
    const snapshots = await transaction.getAll(
      this.database.doc(postgisSourceControlPath),
      ...Array.from({length: postgisSourceShardCount}, (_, shard) =>
        this.database.doc(`${postgisSourceShardsCollection}/${shardId(shard)}`)),
    );
    requireControl(snapshots[0].data(), this.config);
    return {
      protocolVersion: postgisSourceVersion, epoch: this.config.epoch,
      enrolled: snapshots[0].get("enrolled") === true,
      shards: snapshots.slice(1).map((snapshot) => readShard(snapshot.data())),
    };
  }

  async readFence(): Promise<PostgisSourceFence> {
    return this.database.runTransaction((transaction) => this.fenceInTransaction(transaction), {readOnly: true});
  }

  async readEvents(shard: number, afterSeq: number, throughSeq: number, limit = 100): Promise<readonly PostgisSourceEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || throughSeq < afterSeq) throw new Error("Invalid PostGIS event range.");
    const start = eventId(shard, afterSeq);
    const end = eventId(shard, throughSeq);
    if (afterSeq === throughSeq) return [];
    const query = await this.database.collection(postgisSourceEventsCollection)
      .orderBy(FieldPath.documentId()).startAfter(start).endAt(end).limit(limit).get();
    const events = query.docs.map((snapshot) => snapshot.data() as PostgisSourceEvent);
    const expected = Math.min(limit, throughSeq - afterSeq);
    if (events.length !== expected) throw new Error("PostGIS source event gap; publication must remain blocked.");
    events.forEach((event, offset) => {
      validatePostgisSourceEvent(event);
      if (event.shard !== shard || event.seq !== afterSeq + offset + 1) throw new Error("PostGIS source event order gap.");
    });
    return events;
  }

  async scanProjections(collection: PostgisSourceCollection, afterDocumentId: string | null, limit = 100): Promise<readonly PostgisSourcePayload[]> {
    if (!postgisSourceCollections.includes(collection) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid PostGIS scan.");
    let query = this.database.collection(collection).orderBy(FieldPath.documentId());
    if (afterDocumentId !== null) query = query.startAfter(afterDocumentId);
    const result = await query.limit(limit).get();
    return result.docs.map((snapshot) => ({
      collection, indexDocumentId: snapshot.id,
      projection: encodePostgisProjection(collection, snapshot.id, snapshot.data()),
    }));
  }

  async enrollProjection(collection: PostgisSourceCollection, id: string): Promise<void> {
    await this.database.runTransaction(async (transaction) => {
      const current = await transaction.get(this.database.doc(`${collection}/${id}`));
      await this.recordMutation(transaction, collection, id, current.exists ? current.data()! : null);
    });
  }

  async beginEnrollment(bootstrapId: string): Promise<PostgisEnrollmentCheckpoint> {
    boundedIdentifier(bootstrapId);
    return this.database.runTransaction(async (transaction) => {
      const reference = this.database.doc(`${postgisSourceBootstrapsCollection}/${bootstrapId}`);
      const [existing, control] = await transaction.getAll(reference, this.database.doc(postgisSourceControlPath));
      requireControl(control.data(), this.config);
      if (existing.exists) {
        const result = existing.data() as PostgisEnrollmentCheckpoint;
        if (result.epoch !== this.config.epoch || result.protocolVersion !== postgisSourceVersion) throw new Error("PostGIS bootstrap epoch mismatch.");
        return result;
      }
      if (control.get("enrolled") === true || control.get("bootstrapId")) throw new Error("PostGIS source already has an enrollment owner.");
      const startFence = await this.fenceInTransaction(transaction);
      const result: PostgisEnrollmentCheckpoint = {
        protocolVersion: postgisSourceVersion, epoch: this.config.epoch, bootstrapId,
        phase: "scan", collectionIndex: 0, afterDocumentId: null, scanned: 0,
        startFence, endFence: null,
      };
      transaction.create(reference, result);
      transaction.update(this.database.doc(postgisSourceControlPath), {bootstrapId});
      return result;
    });
  }

  /** One bounded, resumable enrollment page. Delivery/replay is independently durable in SQL. */
  async advanceEnrollment(bootstrapId: string, limit = 100): Promise<PostgisEnrollmentCheckpoint> {
    const checkpoint = await this.beginEnrollment(bootstrapId);
    if (checkpoint.phase === "complete") return checkpoint;
    const collection = postgisSourceCollections[checkpoint.collectionIndex];
    const rows = await this.scanProjections(collection, checkpoint.afterDocumentId, limit);
    // Re-read each row inside the journal transaction: a scan snapshot is never
    // allowed to resurrect a deleted/edited row or overwrite a newer event.
    for (const row of rows) await this.enrollProjection(collection, row.indexDocumentId);
    return this.database.runTransaction(async (transaction) => {
      const reference = this.database.doc(`${postgisSourceBootstrapsCollection}/${bootstrapId}`);
      const current = (await transaction.get(reference)).data() as PostgisEnrollmentCheckpoint;
      if (current.phase !== checkpoint.phase || current.collectionIndex !== checkpoint.collectionIndex ||
          current.afterDocumentId !== checkpoint.afterDocumentId || current.scanned !== checkpoint.scanned) {
        throw new Error("PostGIS enrollment advanced concurrently; resume from its durable checkpoint.");
      }
      const nextCollection = rows.length < limit ? checkpoint.collectionIndex + 1 : checkpoint.collectionIndex;
      const complete = nextCollection === postgisSourceCollections.length;
      const endFence = complete ? {...await this.fenceInTransaction(transaction), enrolled: true} : null;
      const next: PostgisEnrollmentCheckpoint = {
        ...checkpoint, phase: complete ? "complete" : "scan", collectionIndex: nextCollection,
        afterDocumentId: nextCollection === checkpoint.collectionIndex ? rows[rows.length - 1].indexDocumentId : null,
        scanned: checkpoint.scanned + rows.length, endFence,
      };
      transaction.set(reference, next);
      if (complete) transaction.update(this.database.doc(postgisSourceControlPath), {enrolled: true});
      return next;
    });
  }

  async acknowledgePublishedFence(
    fence: PostgisSourceFence,
    recoveryManifest: PostgisRecoveryManifest,
    reader: PostgisRecoverySnapshotReader,
  ): Promise<void> {
    validatePostgisSourceFence(fence);
    if (fence.epoch !== this.config.epoch || postgisSourceDigest(fence as unknown as PostgisJson) !==
        postgisSourceDigest(recoveryManifest.fence as unknown as PostgisJson)) throw new Error("Recovery snapshot epoch/fence does not match publication.");
    await validatePostgisRecoverySnapshot(reader, recoveryManifest);
    await this.database.runTransaction(async (transaction) => {
      const reference = this.database.doc(postgisSourceRetentionPath);
      const existing = (await transaction.get(reference)).data();
      const current = await this.fenceInTransaction(transaction);
      if (!current.enrolled || fence.shards.some((shard, index) => shard.seq > current.shards[index].seq)) {
        throw new Error("Cannot acknowledge an incomplete or future source fence.");
      }
      if (existing !== undefined && (existing.epoch !== fence.epoch ||
          fence.shards.some((shard, index) => shard.seq < existing.fence.shards[index].seq))) {
        throw new Error("An older recovery snapshot cannot replace the acknowledged source fence.");
      }
      transaction.set(reference, {
        epoch: fence.epoch, fence, recoveryManifest,
        prunedThrough: existing?.prunedThrough ?? Array.from({length: 16}, () => 0),
      });
    });
  }

  /**
   * Bounded source GC. The retained recovery artifact is re-read and verified
   * before deletion; only acknowledged events at/below its exact fence qualify.
   * Its artifact must remain retained until superseded by another validated
   * snapshot. A fresh SQL database restores that snapshot before replay.
   */
  async pruneAcknowledgedEvents(reader: PostgisRecoverySnapshotReader, limit = 400): Promise<{deleted: number; prunedThrough: readonly number[]}> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 400) throw new Error("Invalid source prune batch.");
    const reference = this.database.doc(postgisSourceRetentionPath);
    const saved = (await reference.get()).data();
    if (saved === undefined || saved.epoch !== this.config.epoch) throw new Error("No acknowledged durable recovery snapshot; source events cannot be pruned.");
    const manifest = saved.recoveryManifest as PostgisRecoveryManifest;
    await validatePostgisRecoverySnapshot(reader, manifest);
    return this.database.runTransaction(async (transaction) => {
      const [snapshot, control] = await transaction.getAll(reference, this.database.doc(postgisSourceControlPath));
      requireControl(control.data(), this.config);
      const current = snapshot.data();
      if (control.get("enrolled") !== true || current === undefined || current.epoch !== this.config.epoch ||
          postgisSourceDigest(current.recoveryManifest) !== postgisSourceDigest(manifest as unknown as PostgisJson)) {
        throw new Error("Source recovery acknowledgement changed; retry pruning.");
      }
      const through = current.prunedThrough as number[];
      if (!Array.isArray(through) || through.length !== 16 || through.some((seq, shard) =>
        !Number.isSafeInteger(seq) || seq < 0 || seq > manifest.fence.shards[shard].seq)) {
        throw new Error("Invalid source retention checkpoint.");
      }
      const shard = through.findIndex((seq, index) => seq < manifest.fence.shards[index].seq);
      if (shard === -1) return {deleted: 0, prunedThrough: through};
      const end = Math.min(manifest.fence.shards[shard].seq, through[shard] + limit);
      const query = this.database.collection(postgisSourceEventsCollection).orderBy(FieldPath.documentId())
        .startAfter(eventId(shard, through[shard])).endAt(eventId(shard, end)).limit(limit);
      const events = await transaction.get(query);
      if (events.size !== end - through[shard]) throw new Error("Source retention found a journal gap; restore exact evidence or recover from the validated snapshot.");
      const next = [...through]; next[shard] = end;
      for (const event of events.docs) transaction.delete(event.ref);
      transaction.update(reference, {prunedThrough: next});
      return {deleted: events.size, prunedThrough: next};
    });
  }
}

export function createFirestorePostgisSource(database: Firestore, config: PostgisSourceConfiguration): FirestorePostgisSource {
  return new FirestorePostgisSource(database, config);
}
