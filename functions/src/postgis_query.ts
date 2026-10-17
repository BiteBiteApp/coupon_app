// Query/refinement algorithm recovered from the qualified October 1 prototype.
// SQL is a conservative retrieval bound; current application predicates decide
// exact membership and ordering. Incomplete work never becomes an empty page.
import * as O from "./postgis_semantics.js";
import type { PostgisConnection } from "./postgis_store.js";
import { requireQualifiedPostgisRuntime } from "./postgis_runtime.js";
function shape(r: any) { return { ...r, name_key: Buffer.isBuffer(r.name_key) ? r.name_key.toString('hex') : r.name_key, id_key: Buffer.isBuffer(r.id_key) ? r.id_key.toString('hex') : r.id_key }; }
export function queryPlan(session: any, after: any = null, limit = 128, { lowerBound = false, knownDistancePoints = [] as any[] } = {}) {
    const c = session.criteria, s = c.space === 'score' ? c.criteria : null, args: unknown[] = [], v = (x: unknown) => { args.push(x); return '$' + args.length; }, rev = v(session.revision);
    const parent = c.space === 'score' && c.kind === 'dish';
    const p = parent ? 'p' : 'r';
    const where = [`r.space=${v(c.space)}`, `r.kind=${v(c.kind)}`, `r.visible`, `r.valid_from<=${rev}`, `r.valid_to>${rev}`];
    let joins = '';
    if (parent) {
        joins = `JOIN entities p ON p.space=r.space AND p.kind='restaurant' AND p.id=r.parent_id AND p.valid_from<=${rev} AND p.valid_to>${rev} AND p.visible`;
    }
    const center = c.space === 'score' ? s.center : c.center, radius = c.space === 'score' ? s.radiusMiles : c.radiusMiles;
    let distance = '0::float8';
    if (center) {
        const lat = v(center.latitude), lon = v(center.longitude);
        const longitudeBound = `CASE WHEN abs(${p}.latitude::numeric)<=60 AND abs(${lat}::numeric)<=60 AND abs(${p}.longitude::numeric-${lon}::numeric)<=4 THEN greatest(0::numeric,least(0.4::numeric*111000::numeric*abs(${p}.longitude::numeric-${lon}::numeric),50000::numeric)-1::numeric) ELSE 0::numeric END`;
        distance = lowerBound ? `(greatest(0::numeric,0.99::numeric*least(111000::numeric*abs(${p}.latitude::numeric-${lat}::numeric),50000::numeric)-1::numeric,${longitudeBound})/1609.344::numeric)::float8` : `app_miles(${lat},${lon},${p}.latitude,${p}.longitude)`;
        if (lowerBound) {
            where.push(`${p}.latitude IS NOT NULL AND ${p}.longitude IS NOT NULL`);
            if (radius * 1609.344 < 49499) {
                const span = (radius * 1609.344 + 1) / (.99 * 111000) + 1e-10;
                where.push(`${p}.latitude BETWEEN ${v(center.latitude - span)} AND ${v(center.latitude + span)}`);
            }
        }
        if (lowerBound && knownDistancePoints.length) {
            if (knownDistancePoints.length > 64)
                throw Error('distance_memo_limit');
            distance = `CASE ${knownDistancePoints.map((point: any) => `WHEN ${p}.latitude=${v(point.latitude)}::float8 AND ${p}.longitude=${v(point.longitude)}::float8 THEN ${v(point.distance)}::float8`).join(' ')} ELSE ${distance} END`;
        }
        else if (!lowerBound)
            where.push(`ST_DWithin(${p}.geo,ST_SetSRID(ST_MakePoint(${lon},${lat}),4326)::geography,${v(radius * 1609.344 * 1.01 + 1)})`);
    }
    let rank0 = '0::float8', rank1 = '0::float8', rank2 = '0::float8';
    if (c.space === 'saver') {
        const typed = c.typedLocation;
        let pref = 'false';
        if (typed?.kind === 'zip')
            pref = `r.zip=${v(typed.zip)}`;
        else if (typed?.kind === 'city')
            pref = `r.pref_city=${v(O.contract.normalizeCustomerBiteSaverCity(typed.city))}` + (typed.state ? ` AND r.pref_state=${v(typed.state)}` : '');
        rank0 = `CASE WHEN (${pref}) THEN 0::float8 ELSE 1::float8 END`;
        rank1 = `CASE WHEN (${pref}) THEN 0::float8 ELSE ${distance} END`;
        const q = O.saver.normalizeCustomerBiteSaverSearchText(c.text || '');
        if (q) {
            const needle = v('%' + q + '%');
            where.push(`(r.fields LIKE ${needle} OR EXISTS(SELECT 1 FROM entities o WHERE o.space='saver' AND o.kind IN ('coupon','dailySpecial') AND o.parent_id=r.id AND o.visible AND o.valid_from<=${rev} AND o.valid_to>${rev} AND o.fields LIKE ${needle}))`);
        }
    }
    else {
        if (s.text && !s.finder) {
            const short = O.shortRecall(s.text);
            if (short) {
                const plainRecall = `(${p}.fields LIKE ${v('%' + short.n + '%')} OR string_to_array(${p}.recall,chr(1)) && ${v(short.exact)}::text[])`;
                where.push(c.kind === 'restaurant' ? plainRecall : `(string_to_array(r.recall,chr(1)) && ${v(short.exact)}::text[] OR r.recall LIKE ANY(${v(short.long)}::text[]) OR ${plainRecall})`);
            }
            else {
                const patterns = O.recallPatterns(s.text);
                if (patterns)
                    where.push(`(r.recall LIKE ANY(${v(patterns)}::text[]) OR ${p}.recall LIKE ANY(${v(patterns)}::text[]))`);
            }
        }
        if (s.restaurantId)
            where.push(`${p}.id=${v(s.restaurantId)}`);
        if (!center && s.locationText)
            where.push(`(strpos(${p}.raw_city_lower,${v(s.locationText)})>0 OR strpos(${p}.raw_zip_lower,${v(s.locationText)})>0)`);
        if (s.finder) {
            where.push(`r.state=${v(s.finder.state)}`);
            const f = s.finder.location;
            if (s.finder.mode === 'close') {
                where.push(`r.city=${v(O.matcher.normalizeBiteScoreFinderText(f))}`);
                rank0 = `-finder_close_score(r.finder_close,${v(O.matcher.normalizeBiteScoreFinderText(s.text))},r.finder_tokens,${v(s.text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean))}::text[])`;
            }
            else {
                if (f)
                    where.push(/^\d+$/.test(f) ? `r.zip LIKE ${v(f + '%')}` : `r.city LIKE ${v('%' + O.matcher.normalizeBiteScoreFinderText(f) + '%')}`);
                rank0 = `-finder_score(r.finder_name,${v(O.finderNorm(s.text))})`;
            }
        }
        else if (c.kind === 'dish') {
            const cols: Record<string, string> = { 'Best Value': 'value_score', 'Best Flavor': 'flavor_score', 'Highest Quality': 'quality_score', 'Most Enjoyed': 'enjoyed_score' };
            if (cols[s.sort]) {
                rank0 = `coalesce(-r.${cols[s.sort]},1)`;
                rank1 = '-r.score';
                rank2 = '-r.reviews';
            }
            else if (s.sort === 'Closest') {
                rank0 = distance;
                rank1 = '-r.score';
                rank2 = '-r.reviews';
            }
            else if (s.sort === 'Most Reviewed') {
                rank0 = '-r.reviews';
                rank1 = '-r.score';
            }
            else if (s.sort !== 'Dish Name') {
                rank0 = '-r.score';
                rank1 = '-r.reviews';
            }
        }
        else if (s.sort === 'Closest')
            rank0 = distance;
    }
    const outer: string[] = [];
    if (s?.finder)
        outer.push('rank0<0');
    if (after) {
        outer.push(`(rank0,rank1,rank2,name_key,id_key)>(${v(after[0])},${v(after[1])},${v(after[2])},decode(${v(after[3])},'hex'),decode(${v(after[4])},'hex'))`);
    }
    const text = `WITH ranked AS (SELECT r.*,${p}.dto AS parent_dto,${p}.fingerprint AS parent_fingerprint,${distance} AS distance,${rank0} AS rank0,${rank1} AS rank1,${rank2} AS rank2 FROM entities r ${joins} WHERE ${where.join(' AND ')}) SELECT * FROM ranked ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''} ORDER BY rank0,rank1,rank2,name_key,id_key LIMIT ${v(limit)}`;
    return { text, values: args };
}
// Raw SQL order is a proved lower bound. The bounded heap is ordered ONLY by
// the authoritative Node tuple. No approximate distance is a public boundary.
function exactTuple(r: any, rank: any) { return [rank.rank0, rank.rank1, rank.rank2, r.name_key, r.id_key]; }
function tupleCompare(a: any[], b: any[]) { for (let i = 0; i < a.length; i++) {
    const c = a[i] === b[i] ? 0 : a[i] < b[i] ? -1 : 1;
    if (c)
        return c;
} return 0; }
export async function select(pool: PostgisConnection, session: any, after: any = null, { size = 25, budget = 64, chunk = 64, timeBudgetMs = 5000 } = {}) {
    requireQualifiedPostgisRuntime();
    const state = after?.refinement === 1 ? after : { refinement: 1, afterExact: after, scanAfter: null, top: [], offerAfter: null, active: null };
    if (state.afterExact && !Array.isArray(state.afterExact))
        throw Error('invalid_refinement_boundary');
    // Append-only until raw scan resets: eviction could lower an unseen row behind scanAfter.
    state.distancePoints ??= [];
    if (state.distancePoints.length > 64)
        throw Error('distance_memo_limit');
    let queries = 0, examined = 0, sqlMs = 0, transferBytes = 0, maxOfferRows = 0, done = false, proved = false;
    const c = { ...session.criteria, membershipMs: session.membership_ms }, deadline = performance.now() + Math.max(0, Math.min(5000, timeBudgetMs));
    while (queries < budget && performance.now() < deadline) {
        let rows;
        const resumed = !!state.active;
        if (state.active)
            rows = [state.active];
        else {
            const t = performance.now();
            rows = (await pool.query(queryPlan(session, state.scanAfter, chunk, { lowerBound: true, knownDistancePoints: state.distancePoints }))).rows.map(shape);
            queries++;
            sqlMs += performance.now() - t;
            transferBytes += Buffer.byteLength(JSON.stringify(rows));
        }
        if (rows.length === 0) {
            done = true;
            break;
        }
        let stopped = false;
        for (const r of rows) {
            const lower = [r.rank0, r.rank1, r.rank2, r.name_key, r.id_key];
            if (state.top.length === size + 1 && tupleCompare(lower, state.top.at(-1).tuple) > 0) {
                proved = true;
                stopped = true;
                break;
            }
            examined++;
            let rank = c.space === 'saver' ? O.saverRank(c, r) : O.score.matchAndRank(c.criteria, r.dto, r.parent_dto);
            const center = c.space === 'saver' ? c.center : c.criteria.center, point = r.parent_dto ?? r.dto;
            if (center && state.distancePoints.length < 64 && (c.space === 'saver' || c.criteria.sort === 'Closest') && !state.distancePoints.some((p: any) => p.latitude === point.latitude && p.longitude === point.longitude)) {
                const distance = O.geo.exactCustomerBiteSaverDistanceMiles(center, point);
                if (Number.isFinite(distance))
                    state.distancePoints.push({ latitude: point.latitude, longitude: point.longitude, distance });
            }
            if (rank && state.afterExact && tupleCompare(exactTuple(r, rank), state.afterExact) <= 0)
                rank = null;
            if (c.space === 'saver' && rank) {
                let matched = false, childDone = false;
                while (!matched && !childDone && queries < budget && performance.now() < deadline) {
                    const t = performance.now();
                    const batch = (await pool.query("SELECT * FROM entities WHERE space='saver' AND kind IN ('coupon','dailySpecial') AND parent_id=$1 AND visible AND valid_from<=$2 AND valid_to>$2 AND ($3::text IS NULL OR (id COLLATE \"C\",kind COLLATE \"C\")>($3 COLLATE \"C\",$4 COLLATE \"C\")) ORDER BY id COLLATE \"C\",kind COLLATE \"C\" LIMIT 75", [r.id, session.revision, state.offerAfter?.[0] ?? null, state.offerAfter?.[1] ?? null])).rows.map(shape);
                    queries++;
                    sqlMs += performance.now() - t;
                    maxOfferRows = Math.max(maxOfferRows, batch.length);
                    transferBytes += Buffer.byteLength(JSON.stringify(batch));
                    matched = batch.some((o: any) => O.available(c, r, o).visible && O.saverMatches(c, r, o));
                    childDone = batch.length < 75;
                    state.offerAfter = batch.length ? [batch[batch.length - 1].id, batch[batch.length - 1].kind] : state.offerAfter;
                }
                if (!matched && !childDone) {
                    state.active = r;
                    stopped = true;
                    break;
                }
                state.offerAfter = null;
                if (!matched)
                    rank = null;
            }
            state.active = null;
            state.scanAfter = lower;
            if (rank && !state.top.some((x: any) => x.space === r.space && x.id === r.id && x.kind === r.kind)) {
                const tuple = exactTuple(r, rank);
                if (!state.afterExact || tupleCompare(tuple, state.afterExact) > 0) {
                    const candidate = { id: r.id, kind: r.kind, space: r.space, visible: r.visible, dto: r.dto, fingerprint: r.fingerprint, projection: r.projection, index_path: r.index_path, parent_id: r.parent_id, parent_fingerprint: r.parent_fingerprint, parent_dto: r.parent_dto, rank, tuple };
                    let i = 0;
                    while (i < state.top.length && tupleCompare(state.top[i].tuple, tuple) < 0)
                        i++;
                    state.top.splice(i, 0, candidate);
                    if (state.top.length > size + 1)
                        state.top.pop();
                }
            }
        }
        if (stopped)
            break;
        // A one-row resumption is not evidence that the underlying query exhausted.
        if (rows.length < chunk && !resumed) {
            done = true;
            break;
        }
        after = null;
    }
    const complete = done || proved, items = complete ? state.top.slice(0, size) : [], hasMore = !complete || state.top.length > size;
    return { items, hasMore, boundary: complete ? items.at(-1)?.tuple ?? state.afterExact : state, partial: !complete, metrics: { examined, queries, sqlMs, transferBytes, maxOfferRows, heapMaximum: size + 1, distanceMemoPoints: state.distancePoints.length, refinementComplete: complete } };
}
