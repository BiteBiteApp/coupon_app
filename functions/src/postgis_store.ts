import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePostgisProjection, postgisSourceCollections, postgisSourceDigest, postgisSourceVersion, validatePostgisSourceEvent, type PostgisSourceEvent, type PostgisSourceFence, type PostgisProjection } from "./postgis_source.js";
import { entityFromProjection } from "./postgis_semantics.js";
// The driver boundary is checked when materializing the domain rows. It never
// supplies a public DTO directly. No global pool or credential lookup on import.
export interface PostgisConnection {
    query(text: string | {
        text: string;
        values: unknown[];
    }, values?: unknown[]): Promise<{
        rows: any[];
        rowCount: number;
    }>;
}
export interface PostgisClient extends PostgisConnection {
    release(destroy?: boolean): void;
}
export interface PostgisPool extends PostgisConnection {
    connect(): Promise<PostgisClient>;
    end(): Promise<void>;
    on(event: string, callback: (error: Error) => void): void;
    totalCount: number;
    idleCount: number;
    waitingCount: number;
}
export interface PostgisEventSource {
    readFence(): Promise<PostgisSourceFence>;
    readEvents(shard: number, afterSeq: number, throughSeq: number, limit: number): Promise<readonly PostgisSourceEvent[]>;
}
export class PostgisCandidateError extends Error {
    constructor(readonly code: "unavailable" | "failed-precondition" | "resource-exhausted", message: string) {
        super(message);
        this.name = "PostgisCandidateError";
    }
}
export function createLocalPostgisPool(config: {
    host: string;
    port: number;
    database: string;
    user: string;
}): PostgisPool {
    if (config.host !== "127.0.0.1" || !Number.isInteger(config.port) || config.port < 1024 ||
        !/^bsgate0(?:_[a-z0-9_]+)?$/u.test(config.database) || config.user !== "bsgate0") {
        throw new PostgisCandidateError("failed-precondition", "Only the isolated local candidate database is authorized.");
    }
    const { Pool } = require("pg") as {
        Pool: new (options: Record<string, unknown>) => PostgisPool;
    };
    const pool = new Pool({ ...config, password: "", max: 4, connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 10000, query_timeout: 5500, statement_timeout: 5000,
        options: "-c extra_float_digits=1 -c idle_in_transaction_session_timeout=10000",
        application_name: "bitestar_postgis_gate0" });
    // pg removes idle failed connections; handling the event prevents an unrelated
    // idle disconnect from crashing the process. Requests still return errors.
    pool.on("error", () => undefined);
    return pool;
}
async function transaction<T>(pool: PostgisPool, action: (client: PostgisClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let destroy = false;
    try {
        await client.query("BEGIN");
        const result = await action(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        try {
            await client.query("ROLLBACK");
        }
        catch {
            destroy = true;
        }
        throw error;
    }
    finally {
        client.release(destroy);
    }
}
const columns = ["space", "kind", "id", "parent_id", "visible", "dto", "fingerprint", "latitude", "longitude",
    "name_key", "id_key", "fields", "state", "city", "zip", "finder_name", "finder_close", "score", "reviews",
    "value_score", "flavor_score", "quality_score", "enjoyed_score", "pref_city", "pref_state", "finder_tokens",
    "raw_city_lower", "raw_zip_lower", "recall", "projection", "index_path"];
export async function insertEntity(client: PostgisConnection, entity: Record<string, any>, revision: number): Promise<void> {
    await client.query(`INSERT INTO entities (${columns.join(",")},valid_from,geo)
    SELECT space,kind,id,parent_id,visible,dto,fingerprint,latitude,longitude,decode(name_key,'hex'),decode(id_key,'hex'),
    fields,state,city,zip,finder_name,finder_close,score,reviews,value_score,flavor_score,quality_score,enjoyed_score,
    pref_city,pref_state,finder_tokens,raw_city_lower,raw_zip_lower,recall,projection,index_path,$2,
    CASE WHEN latitude IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography END
    FROM jsonb_to_recordset($1::jsonb) AS r(space text,kind text,id text,parent_id text,visible boolean,dto jsonb,
    fingerprint text,latitude float8,longitude float8,name_key text,id_key text,fields text,state text,city text,
    zip text,finder_name text,finder_close text,score float8,reviews float8,value_score float8,flavor_score float8,
    quality_score float8,enjoyed_score float8,pref_city text,pref_state text,finder_tokens text[],
    raw_city_lower text,raw_zip_lower text,recall text,projection jsonb,index_path text)`, [JSON.stringify([entity]), revision]);
}
function vector(fence: PostgisSourceFence): number[] { return fence.shards.map(shard => shard.seq); }
function validateFence(fence: PostgisSourceFence): void {
    if (fence.protocolVersion !== postgisSourceVersion || !fence.enrolled || !fence.epoch || fence.shards.length !== 16 ||
        fence.shards.some(shard => !Number.isSafeInteger(shard.seq) || shard.seq < 0 ||
            postgisSourceCollections.some(collection => !Number.isSafeInteger(shard.partitions[collection]?.count) ||
                shard.partitions[collection].count < 0 || !/^[a-f0-9]{64}$/u.test(shard.partitions[collection].xor)))) {
        throw new PostgisCandidateError("failed-precondition", "The searchable source bootstrap is incomplete.");
    }
}
/** Derived index with finite publication fences and restartable bounded writes. */
export class PostgisReadModel {
    constructor(readonly pool: PostgisPool, readonly source: PostgisEventSource) { }
    async initializeLocalSchema(): Promise<void> {
        await this.pool.query(readFileSync(join(__dirname, "../search_candidate/schema.sql"), "utf8"));
    }
    async receive(events: readonly PostgisSourceEvent[]): Promise<void> {
        if (events.length > 100)
            throw new Error("PostGIS receive batch exceeds 100 events.");
        events.forEach(validatePostgisSourceEvent);
        await transaction(this.pool, async (client) => {
            for (const event of events) {
                const result = await client.query(`INSERT INTO inbox(shard,seq,payload,digest) VALUES($1,$2,$3,$4)
          ON CONFLICT(shard,seq) DO UPDATE SET digest=inbox.digest RETURNING digest`, [event.shard, event.seq, event.payload, event.digest]);
                if (result.rows[0].digest !== event.digest)
                    throw new Error("Conflicting duplicate PostGIS source event.");
            }
        });
    }
    /** One bounded delivery. Repeated calls resume the same persisted target. */
    async catchUp(batchSize = 75): Promise<{
        ready: boolean;
        revision: string;
        applied: number;
        fence: number[];
    }> {
        try {
            return await this.advanceCatchUp(batchSize);
        }
        catch (error) {
            await this.pool.query("UPDATE ingestion_progress SET state='blocked',failure=$1 WHERE singleton AND coalesce(failure->>'kind','') <> 'snapshot_restore'", [{
                    kind: "delivery_or_publication_failed", at: Date.now(),
                }]);
            throw error;
        }
    }
    private async advanceCatchUp(batchSize: number): Promise<{
        ready: boolean;
        revision: string;
        applied: number;
        fence: number[];
    }> {
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
            throw new Error("Invalid ingestion batch.");
        const captured = await this.source.readFence();
        validateFence(captured);
        // Snapshot the target once. Never move the finish line during retries.
        const state = await transaction(this.pool, async (client) => {
            const publication = (await client.query("SELECT * FROM publication WHERE singleton FOR UPDATE")).rows[0];
            let progress = (await client.query("SELECT * FROM ingestion_progress WHERE singleton FOR UPDATE")).rows[0];
            if (progress.failure?.kind === "snapshot_restore")
                throw new PostgisCandidateError("unavailable", "The search snapshot restore is incomplete.");
            if (progress.epoch !== null && progress.epoch !== captured.epoch)
                throw new Error("PostGIS source epoch changed.");
            if (progress.target === null) {
                if (vector(captured).some((seq, shard) => seq < publication.fence[shard]))
                    throw new Error("PostGIS source fence moved backwards.");
                await client.query("UPDATE ingestion_progress SET target=$1,epoch=$2,state='receiving',failure=NULL WHERE singleton", [captured, captured.epoch]);
                progress = { ...progress, target: captured };
            }
            return { publication, progress };
        });
        const target = state.progress.target as PostgisSourceFence;
        const shard = vector(target).findIndex((seq, index) => seq > state.progress.fence[index]);
        if (shard !== -1) {
            const after = state.progress.fence[shard] as number;
            const events = await this.source.readEvents(shard, after, target.shards[shard].seq, batchSize);
            const needed = Math.min(batchSize, target.shards[shard].seq - after);
            if (events.length !== needed || events.some((event, index) => event.shard !== shard || event.seq !== after + index + 1)) {
                throw new PostgisCandidateError("failed-precondition", "Search ingestion has a missing source event; publication is blocked.");
            }
            await this.receive(events);
            await transaction(this.pool, async (client) => {
                const publication = (await client.query("SELECT * FROM publication WHERE singleton FOR UPDATE")).rows[0];
                const progress = (await client.query("SELECT * FROM ingestion_progress WHERE singleton FOR UPDATE")).rows[0];
                if (progress.failure?.kind === "snapshot_restore")
                    throw new PostgisCandidateError("unavailable", "The search snapshot restore is incomplete.");
                // Another worker may already have completed this batch. No old write is reapplied.
                if (progress.fence[shard] !== after || postgisSourceDigest(progress.target) !== postgisSourceDigest(target))
                    return;
                const revision = Number(publication.revision) + 1;
                for (const event of events) {
                    validatePostgisSourceEvent(event);
                    const path = `${event.payload.collection}/${event.payload.indexDocumentId}`;
                    // A second change to this identity in the unpublished revision replaces
                    // only that future row. Historical pinned rows remain intact.
                    await client.query("DELETE FROM entities WHERE index_path=$1 AND valid_from=$2", [path, revision]);
                    await client.query("UPDATE entities SET valid_to=$2 WHERE index_path=$1 AND valid_to=9223372036854775807", [path, revision]);
                    await client.query("DELETE FROM projection_poison WHERE index_path=$1", [path]);
                    if (event.payload.projection === null) {
                        await client.query("DELETE FROM source_heads WHERE index_path=$1", [path]);
                    }
                    else {
                        let entity: Record<string, any> | null = null;
                        try {
                            const data = decodePostgisProjection(event.payload.projection);
                            entity = entityFromProjection({ path, id: event.payload.indexDocumentId, data }, event.payload.projection);
                        }
                        catch {
                            // Keep the exact ordered source witness, but never publish a
                            // revision containing an uninterpretable projection. A newer
                            // authoritative repair/delete event is the only way to clear it.
                            await client.query("INSERT INTO projection_poison(index_path,revision,shard,seq,digest) VALUES($1,$2,$3,$4,$5)", [path, revision, shard, event.seq, event.digest]);
                        }
                        if (entity !== null)
                            await insertEntity(client, entity, revision);
                        await client.query(`INSERT INTO source_heads(index_path,shard,payload,digest) VALUES($1,$2,$3,$4)
              ON CONFLICT(index_path) DO UPDATE SET shard=EXCLUDED.shard,payload=EXCLUDED.payload,digest=EXCLUDED.digest`, [path, shard, event.payload, event.digest]);
                    }
                }
                const next = [...progress.fence];
                next[shard] = events[events.length - 1].seq;
                await client.query("UPDATE ingestion_progress SET fence=$1,state='receiving',failure=NULL WHERE singleton", [JSON.stringify(next)]);
            });
            return { ready: false, revision: String(state.publication.revision), applied: events.length, fence: vector(target) };
        }
        return transaction(this.pool, async (client) => {
            const publication = (await client.query("SELECT * FROM publication WHERE singleton FOR UPDATE")).rows[0];
            const progress = (await client.query("SELECT * FROM ingestion_progress WHERE singleton FOR UPDATE")).rows[0];
            if (progress.failure?.kind === "snapshot_restore")
                throw new PostgisCandidateError("unavailable", "The search snapshot restore is incomplete.");
            if (postgisSourceDigest(progress.target) !== postgisSourceDigest(target) ||
                vector(target).some((seq, index) => seq !== progress.fence[index])) {
                return { ready: false, revision: String(publication.revision), applied: 0, fence: vector(target) };
            }
            if ((await client.query("SELECT index_path FROM projection_poison LIMIT 1")).rowCount > 0) {
                throw new PostgisCandidateError("failed-precondition", "Search publication has a poisoned projection. Repair the source, then resume.");
            }
            // Exactly 48 transactionally maintained partitions; catalog-wide
            // recomputation is an explicit independent audit, never a publish lock.
            const actual = (await client.query("SELECT shard,collection,count::int,xor::text FROM source_manifest_partitions")).rows;
      if (actual.length !== 48) throw new Error("Incomplete source manifest metadata.");
            for (let shard = 0; shard < 16; shard++)
                for (const collection of postgisSourceCollections) {
                    const entry = actual.find(row => row.shard === shard && row.collection === collection);
                    const xor = entry ? BigInt(`0b${entry.xor}`).toString(16).padStart(64, "0") : "0".repeat(64);
                    const expected = target.shards[shard].partitions[collection];
                    if ((entry?.count ?? 0) !== expected.count || xor !== expected.xor) {
                        throw new PostgisCandidateError("failed-precondition", "Search source manifest is incomplete or inconsistent.");
                    }
                }
            const changed = vector(target).some((seq, index) => seq !== publication.fence[index]);
            const revision = Number(publication.revision) + (changed ? 1 : 0);
            if (changed) {
                await client.query("INSERT INTO revisions(revision,fence,source_manifest) VALUES($1,$2,$3)", [revision, JSON.stringify(vector(target)), target]);
                await client.query("UPDATE publication SET revision=$1,fence=$2 WHERE singleton", [revision, JSON.stringify(vector(target))]);
            }
            await client.query("UPDATE revisions SET source_manifest=$2 WHERE revision=$1", [revision, target]);
            await client.query("UPDATE bootstrap SET ready=true WHERE singleton");
            await client.query("UPDATE ingestion_progress SET state='ready',target=NULL,failure=NULL WHERE singleton");
            return { ready: true, revision: String(revision), applied: 0, fence: vector(target) };
        });
    }
    /** Explicit recovery after a newer source repair. Every old event remains in
     * the applied manifest; no gap or poison event is skipped or called success.
     */
    async resumeAfterSourceRepair(): Promise<void> {
        const fence = await this.source.readFence();
        validateFence(fence);
        await transaction(this.pool, async (client) => {
            await client.query("SELECT revision FROM publication WHERE singleton FOR UPDATE");
            const progress = (await client.query("SELECT * FROM ingestion_progress WHERE singleton FOR UPDATE")).rows[0];
            if (progress.epoch !== fence.epoch || progress.state !== "blocked" || progress.target === null ||
                vector(progress.target).some((seq, index) => seq !== progress.fence[index]) ||
                vector(fence).some((seq, index) => seq < progress.fence[index]) ||
                !vector(fence).some((seq, index) => seq > progress.fence[index]) ||
                (await client.query("SELECT index_path FROM projection_poison LIMIT 1")).rowCount === 0) {
                throw new Error("No fully received poisoned revision has a newer source repair fence.");
            }
            await client.query("UPDATE ingestion_progress SET target=$1,state='receiving',failure=NULL WHERE singleton", [fence]);
        });
    }
    /** Independent MVCC full recomputation, deliberately outside publication locks.
     * Run explicitly during qualification/maintenance to detect metadata drift.
     */
    async auditSourceManifest(): Promise<{heads: number; partitions: number; fence: number[]}> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
            const actual = (await client.query(`SELECT shard,payload->>'collection' AS collection,count(*)::int AS count,
                bit_xor(('x'||digest)::bit(256))::text AS xor FROM source_heads GROUP BY shard,payload->>'collection'`)).rows;
            const saved = (await client.query("SELECT shard,collection,count::int,xor::text FROM source_manifest_partitions")).rows;
            if (saved.length !== 48) throw new Error("Search manifest partition metadata is incomplete.");
            for (const partition of saved) {
                const full = actual.find(row => row.shard === partition.shard && row.collection === partition.collection);
                if (partition.count !== (full?.count ?? 0) || partition.xor !== (full?.xor ?? "0".repeat(256))) {
                    throw new Error("Search incremental manifest differs from independent source-head audit.");
                }
            }
            const progress = (await client.query("SELECT fence,target FROM ingestion_progress WHERE singleton")).rows[0];
            if (progress.target !== null) throw new Error("Independent full audit requires a complete published revision.");
            const expected = (await client.query("SELECT r.source_manifest FROM revisions r JOIN publication p ON r.revision=p.revision WHERE p.singleton")).rows[0].source_manifest as PostgisSourceFence;
            validateFence(expected);
            for (const partition of saved) {
                const wanted = expected.shards[partition.shard].partitions[partition.collection as keyof typeof expected.shards[0]["partitions"]];
                if (partition.count !== wanted.count || BigInt("0b" + partition.xor).toString(16).padStart(64,"0") !== wanted.xor) {
                    throw new Error("Independent source-head audit differs from published source manifest.");
                }
            }
            const fence = progress.fence;
            await client.query("COMMIT");
            return {heads: actual.reduce((total, row) => total + row.count, 0), partitions: saved.length, fence};
        } catch (error) {await client.query("ROLLBACK").catch(() => undefined); throw error;}
        finally {client.release();}
    }
    async pinRevision(value: {
        pinId: string;
        expiresAtMs: number;
    }): Promise<{revision: string}> {
        // Own the request's identity before any asynchronous source read.
        const {pinId, expiresAtMs} = value, now = Date.now();
        if (!/^[a-zA-Z0-9_-]{16,200}$/u.test(pinId) || !Number.isSafeInteger(expiresAtMs) ||
            expiresAtMs <= now || expiresAtMs > now + 24 * 60 * 60000)
            throw new Error("Invalid search revision pin.");
        const saved = (await this.pool.query("SELECT target,expires_ms FROM admission_targets WHERE id=$1", [pinId])).rows[0];
        if (saved && Number(saved.expires_ms) !== expiresAtMs) throw new Error("Search admission replay changed.");
        const captured = saved?.target ?? await this.source.readFence();
        validateFence(captured);
        const result = await transaction(this.pool, async (client) => {
            const publication = (await client.query("SELECT * FROM publication WHERE singleton FOR SHARE")).rows[0];
            const prior = (await client.query("SELECT * FROM revision_pins WHERE id=$1", [pinId])).rows[0];
            if (prior) {
                if (Number(prior.expires_ms) <= Date.now() || Number(prior.expires_ms) !== expiresAtMs)
                    throw new Error("Search pin replay changed.");
                return {revision: String(prior.revision)};
            }
            // Commit the captured watermark even when this attempt must wait.
            // Concurrent first attempts retain the first committed exact target.
            await client.query("INSERT INTO admission_targets(id,expires_ms,target) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
                [pinId, expiresAtMs, captured]);
            const target = (await client.query("SELECT * FROM admission_targets WHERE id=$1", [pinId])).rows[0];
            if (Number(target.expires_ms) !== expiresAtMs || expiresAtMs <= Date.now()) throw new Error("Search admission replay changed or expired.");
            const fence = target.target as PostgisSourceFence;
            validateFence(fence);
            const progress = (await client.query("SELECT epoch FROM ingestion_progress WHERE singleton")).rows[0];
            if (progress.epoch !== fence.epoch || !(await client.query("SELECT ready FROM bootstrap WHERE singleton")).rows[0].ready ||
                vector(fence).some((seq, shard) => seq > publication.fence[shard])) return null;
            await client.query("INSERT INTO revision_pins(id,revision,expires_ms) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING", [pinId, publication.revision, expiresAtMs]);
            const pin = (await client.query("SELECT revision,expires_ms FROM revision_pins WHERE id=$1", [pinId])).rows[0];
            if (Number(pin.expires_ms) !== expiresAtMs) throw new Error("Search pin replay changed.");
            return {revision: String(pin.revision)};
        });
        if (result === null) throw new PostgisCandidateError("unavailable", "The search index is catching up to this search's captured source watermark. Retry this search.");
        return result;
    }
    async withPinnedRevision<T>(revision: string, expiresAtMs: number, action: (client: PostgisConnection) => Promise<T>): Promise<T> {
        return transaction(this.pool, async (client) => {
            await client.query("SELECT revision FROM publication WHERE singleton FOR SHARE");
            const pins = await client.query("SELECT id FROM revision_pins WHERE revision=$1 AND expires_ms>=$2 AND expires_ms>$3 LIMIT 1", [revision, expiresAtMs, Date.now()]);
            if (pins.rowCount === 0)
                throw new PostgisCandidateError("failed-precondition", "The search revision expired. Refresh the search.");
            return action(client);
        });
    }
    async garbageCollect(nowMs = Date.now(), batchSize = 100): Promise<{
        removedVersions: number;
        removedEvents: number;
        removedPins: number;
        removedWork: number;
        removedRevisions: number;
    }> {
        if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
            throw new Error("Invalid bounded PostGIS garbage collection.");
        }
        return transaction(this.pool, async (client) => {
            const publication = (await client.query("SELECT * FROM publication WHERE singleton FOR UPDATE")).rows[0];
            // Each category is bounded independently. Remaining expired pins safely
            // retain old versions until a later page; no unbounded deletion holds the
            // publication lock while customer requests wait.
            const pins = await client.query(`DELETE FROM revision_pins WHERE id IN
        (SELECT id FROM revision_pins WHERE expires_ms<=$1 AND lease_ms<=$1 ORDER BY expires_ms,id LIMIT $2)`, [nowMs, batchSize]);
            await client.query(`DELETE FROM admission_targets WHERE id IN
                (SELECT id FROM admission_targets WHERE expires_ms<=$1 ORDER BY expires_ms,id LIMIT $2)`, [nowMs, batchSize]);
            const work = await client.query(`DELETE FROM refinement_work WHERE id IN
        (SELECT id FROM refinement_work WHERE expires_ms<=$1 ORDER BY expires_ms,id LIMIT $2)`, [nowMs, batchSize]);
            const minimum = (await client.query("SELECT coalesce(min(revision),$1::bigint) AS revision FROM revision_pins", [publication.revision])).rows[0].revision;
            const removed = await client.query(`DELETE FROM entities WHERE ctid IN
        (SELECT ctid FROM entities WHERE valid_to<=$1 ORDER BY valid_to LIMIT $2)`, [minimum, batchSize]);
            const events = await client.query(`DELETE FROM inbox WHERE (shard,seq) IN
        (SELECT shard,seq FROM inbox WHERE seq<=($1::jsonb->>shard)::bigint ORDER BY shard,seq LIMIT $2)`, [JSON.stringify(publication.fence), batchSize]);
            const revisions = await client.query(`DELETE FROM revisions WHERE revision IN
        (SELECT r.revision FROM revisions r WHERE r.revision<$1
          AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.revision=r.revision)
          AND NOT EXISTS (SELECT 1 FROM revision_pins p WHERE p.revision=r.revision)
          AND NOT EXISTS (SELECT 1 FROM refinement_work w WHERE w.revision=r.revision)
          ORDER BY r.revision LIMIT $2)`, [minimum, batchSize]);
            return { removedVersions: removed.rowCount, removedEvents: events.rowCount,
                removedPins: pins.rowCount, removedWork: work.rowCount, removedRevisions: revisions.rowCount };
        });
    }
    async close(): Promise<void> { await this.pool.end(); }
}
export function storedProjection(row: {
    index_path: string;
    projection: PostgisProjection;
}) {
    return { path: row.index_path, id: row.index_path.split("/")[1], data: decodePostgisProjection(row.projection) };
}
