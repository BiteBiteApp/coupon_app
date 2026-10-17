import type { PostgisMembershipProvider } from "./postgis_handlers.js";
import { PostgisReadModel, PostgisCandidateError, storedProjection } from "./postgis_store.js";
import { select } from "./postgis_query.js";
import { hash } from "./postgis_semantics.js";
import { encodePostgisPrivateState, decodePostgisPrivateState, type PostgisProjection } from "./postgis_source.js";
interface MembershipWork {
    version: 1;
    selection: unknown;
    selected: {
        index_path: string;
        projection: PostgisProjection;
    }[] | null;
    rows: PostgisProjection[];
    parentIndex: number;
    offerAfter: string[] | null;
    accumulator: PostgisProjection | null;
}
import { buildResults, type Session } from "./customer_bitescore_search.js";
import { customerBiteScoreDigest, customerBiteScoreResultCollection, customerBiteScoreUtf16Key } from "./customer_bitescore_search_contract.js";
import { decodeDartUtf16FirestoreBytesOrderKey } from "./customer_bitesaver_search_matcher.js";
import { customerBiteSaverSessionInternals } from "./customer_bitesaver_search_session.js";
import { privateCustomerBiteSaverSearchSessionCollection } from "./customer_bitesaver_search_contract.js";
import { createPostgisBiteSaverResultBuilder } from "./customer_bitesaver_search_worker.js";
import type { CustomerBiteSaverSearchDatabase, CustomerBiteSaverStoredDocument } from "./customer_bitesaver_search_store.js";
import type { CustomerBiteSaverIdentityKeyV1 } from "./customer_bitesaver_public_identity.js";
/** SQL supplies pinned membership only. All current/private authority is read
 * by the existing handlers using the supplied Firestore database.
 */
export class PostgisMembership implements PostgisMembershipProvider {
    constructor(readonly model: PostgisReadModel, readonly authority: CustomerBiteSaverSearchDatabase, readonly discoveryKey: Uint8Array, readonly identityKeyV1: CustomerBiteSaverIdentityKeyV1, readonly workBudget: Readonly<{
        queries: number;
        timeMs: number;
    }> = { queries: 64, timeMs: 4000 }) {
        if (!Number.isInteger(workBudget.queries) || workBudget.queries < 1 || workBudget.queries > 64 ||
            !Number.isFinite(workBudget.timeMs) || workBudget.timeMs <= 0 || workBudget.timeMs > 5000) {
            throw new Error("Invalid bounded PostGIS membership work budget.");
        }
    }
    pinRevision(input: {
        pinId: string;
        expiresAtMs: number;
    }) { return this.model.pinRevision(input); }
    async queryResults(input: Parameters<PostgisMembershipProvider["queryResults"]>[0]): Promise<readonly CustomerBiteSaverStoredDocument[]> {
        const sessionId = input.session.sessionId as string;
        const saverSession = input.space === "saver" ? customerBiteSaverSessionInternals.parseSession({
            path: `${privateCustomerBiteSaverSearchSessionCollection}/${sessionId}`, id: sessionId, data: input.session,
        }) : null;
        if (input.space === "saver" && saverSession === null)
            throw new Error("Invalid pinned BiteSaver session.");
        const scoreSession = input.session as unknown as Session;
        const expiry = saverSession?.absoluteExpiresAt.getTime() ?? scoreSession.absoluteExpiresAtMs;
        const membershipMs = saverSession?.createdAt.getTime() ?? scoreSession.createdAtMs;
        const criteria = saverSession ? { space: "saver", kind: "restaurant",
            center: { latitude: saverSession.criteria.latitude, longitude: saverSession.criteria.longitude },
            radiusMiles: saverSession.criteria.radiusMiles, typedLocation: saverSession.criteria.typedLocation,
            text: saverSession.criteria.normalizedSearchQuery, timeZone: saverSession.criteria.timeZone,
            locationMode: saverSession.criteria.locationMode } :
            { space: "score", kind: scoreSession.criteria.kind, criteria: scoreSession.criteria };
        const after = input.query.startAfter;
        const saverAfterId = after && input.space === "saver" ? decodeDartUtf16FirestoreBytesOrderKey(after[3], 1500) : null;
        if (after && input.space === "saver" && saverAfterId === null)
            throw new Error("Invalid native search boundary.");
        const exactBoundary = after === undefined ? null : input.space === "saver"
            ? [after[0], after[1], 0, after[2], customerBiteScoreUtf16Key(saverAfterId!).toString("hex")]
            : [after[0], after[1], after[2], Buffer.from(after[3] as Uint8Array).toString("hex"),
                Buffer.concat([Buffer.from(after[4] as Uint8Array), Buffer.from(after[5] as Uint8Array)]).toString("hex")];
        const workId = hash(["postgis.membership.v1", sessionId, input.revision, exactBoundary, input.query.limit]);
        const outcome = await this.model.withPinnedRevision(input.revision, expiry, async (client) => {
            await client.query(`INSERT INTO refinement_work(id,session_id,revision,expires_ms,state) VALUES($1,$2,$3,$4,NULL)
        ON CONFLICT(id) DO NOTHING`, [workId, sessionId, input.revision, expiry]);
            const work = (await client.query("SELECT state FROM refinement_work WHERE id=$1 FOR UPDATE", [workId])).rows[0];
            const state: MembershipWork = work.state?.version === 1 ? work.state : {
                version: 1, selection: work.state ?? exactBoundary, selected: null,
                rows: [], parentIndex: 0, offerAfter: null, accumulator: null,
            };
            const deadline = performance.now() + this.workBudget.timeMs;
            let queries = 0;
            const checkpoint = async () => {
                if (Buffer.byteLength(JSON.stringify(state)) > 16 * 1024 * 1024) {
                    throw new PostgisCandidateError("resource-exhausted", "The private search checkpoint exceeds its bound.");
                }
                await client.query("UPDATE refinement_work SET state=$2 WHERE id=$1", [workId, state]);
                return { partial: true as const, rows: [] };
            };
            if (state.selected === null) {
                const result = await select(client, { criteria, revision: input.revision, membership_ms: membershipMs }, state.selection, { size: input.query.limit, budget: this.workBudget.queries, chunk: 64,
                    timeBudgetMs: deadline - performance.now() });
                queries += result.metrics.queries;
                if (result.partial) {
                    state.selection = result.boundary;
                    return checkpoint();
                }
                // Keep only the encoded native projections once ordering is proven.
                state.selected = result.items.map(({ index_path, projection }: {
                    index_path: string;
                    projection: PostgisProjection;
                }) => ({ index_path, projection }));
                state.selection = null;
            }
            const documents = state.selected!.map(storedProjection);
            let rows: CustomerBiteSaverStoredDocument[];
            if (saverSession) {
                rows = state.rows.map(row => decodePostgisPrivateState(row) as unknown as CustomerBiteSaverStoredDocument);
                while (state.parentIndex < documents.length) {
                    if (queries >= this.workBudget.queries || performance.now() >= deadline)
                        return checkpoint();
                    const parent = documents[state.parentIndex];
                    const builder = createPostgisBiteSaverResultBuilder({ database: this.authority,
                        discoveryKey: this.discoveryKey, identityKeyV1: this.identityKeyV1 }, saverSession, parent, state.accumulator === null ? null : decodePostgisPrivateState(state.accumulator) as unknown as CustomerBiteSaverStoredDocument);
                    let complete = false;
                    while (!complete && queries < this.workBudget.queries && performance.now() < deadline) {
                        const batch = await client.query(`SELECT id,index_path,projection,projection->>'geohash' AS geohash FROM entities WHERE space='saver'
              AND kind IN ('coupon','dailySpecial') AND parent_id=$1 AND visible
              AND valid_from<=$2 AND valid_to>$2 AND ($3::text IS NULL OR (projection->>'geohash' COLLATE "C",id COLLATE "C")>($3 COLLATE "C",$4 COLLATE "C"))
              ORDER BY projection->>'geohash' COLLATE "C",id COLLATE "C" LIMIT 75`, [parent.data.sourceDocumentId, input.revision, state.offerAfter?.[0] ?? null, state.offerAfter?.[1] ?? null]);
                        queries++;
                        builder.addOffers(batch.rows.map(storedProjection));
                        complete = batch.rows.length < 75;
                        const last = batch.rows[batch.rows.length - 1];
                        if (last)
                            state.offerAfter = [last.geohash, last.id];
                    }
                    if (!complete) {
                        state.accumulator = encodePostgisPrivateState(builder.snapshot());
                        return checkpoint();
                    }
                    const row = builder.finish();
                    // A selector/adapter disagreement is never a silently shortened page.
                    if (row === null)
                        throw new Error("PostGIS/native BiteSaver membership mismatch.");
                    rows.push(row);
                    state.rows.push(encodePostgisPrivateState(row));
                    state.parentIndex++;
                    state.offerAfter = null;
                    state.accumulator = null;
                }
            }
            else {
                const snapshotDatabase: CustomerBiteSaverSearchDatabase = { ...this.authority,
                    getDocuments: async (paths) => {
                        const records = (await client.query("SELECT index_path,projection FROM entities WHERE index_path=ANY($1::text[]) AND valid_from<=$2 AND valid_to>$2", [paths, input.revision])).rows;
                        const byPath = new Map(records.map(row => [row.index_path, storedProjection(row)]));
                        return paths.map(path => byPath.get(path) ?? null);
                    } };
                const results = await buildResults(snapshotDatabase, scoreSession, documents);
                if (results.length !== documents.length)
                    throw new Error("PostGIS/native BiteScore membership mismatch.");
                rows = results.map(data => {
                    const id = customerBiteScoreDigest("result", sessionId, scoreSession.attempt, data.sourceId);
                    return { id, path: `${customerBiteScoreResultCollection}/${id}`, data };
                });
            }
            await client.query("DELETE FROM refinement_work WHERE id=$1", [workId]);
            return { partial: false as const, rows };
        });
        if (outcome.partial)
            throw new PostgisCandidateError("unavailable", "Search preparation is continuing. Retry the same request.");
        return outcome.rows;
    }
}
