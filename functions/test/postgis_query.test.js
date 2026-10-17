"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {writeFileSync} = require("node:fs");
const {performance} = require("node:perf_hooks");
const F = require("./fixtures/postgis_gate0.cjs");
const S = require("../lib/postgis_source.js");
const O = require("../lib/postgis_semantics.js");
const Q = require("../lib/postgis_query.js");
const {createLocalPostgisPool, PostgisReadModel} = require("../lib/postgis_store.js");
const {PostgisMembership} = require("../lib/postgis_membership.js");
const {parseCustomerBiteScoreCriteria} = require("../lib/customer_bitescore_search_contract.js");
const {startCustomerBiteSaverSearchHandler, customerBiteSaverOrderedResultQuery} = require("../lib/customer_bitesaver_search_session.js");
const {privateCustomerBiteSaverSearchSessionCollection} = require("../lib/customer_bitesaver_search_contract.js");
const {MemoryDatabase} = require("./support/customer_bitescore_fixtures.js");

// Only this dedicated local database can be touched. Source transport is an
// explicit in-memory event fixture; PostgreSQL/PostGIS execution is real.
const config = {host: "127.0.0.1", port: 55441, database: "bsgate0_query", user: "bsgate0"};
const enabled = process.env.BS_POSTGIS_SQL_TEST === "1";

class SyntheticEventSource {
  constructor(documents) {
    this.events = Array.from({length: 16}, () => []);
    this.documents = new Map();
    for (const document of documents) this.append(document);
  }
  append(document) {
    const payload = {collection: document.collection, indexDocumentId: document.id,
      projection: S.encodePostgisProjection(document.collection, document.id, document.data)};
    const shard = S.postgisSourceShardFor(document.collection, document.id);
    const event = {shard, seq: this.events[shard].length + 1, payload, digest: S.postgisSourceDigest(payload)};
    this.events[shard].push(event);
    const key = `${document.collection}/${document.id}`;
    if (payload.projection === null) this.documents.delete(key);
    else this.documents.set(key, document);
    return event;
  }
  async readFence() {
    return {protocolVersion: S.postgisSourceVersion, epoch: "synthetic-query-events-v1", enrolled: true,
      shards: this.events.map(events => ({seq: events.length, partitions: S.postgisSourceManifest(events)}))};
  }
  async readEvents(shard, after, through, limit) {
    return this.events[shard].filter(event => event.seq > after && event.seq <= through).slice(0, limit);
  }
}

function scoreCriteria(overrides = {}) {
  const criteria = parseCustomerBiteScoreCriteria({kind: "dish", center: F.center,
    radiusMiles: 15, text: "", sort: "Closest", ...overrides});
  return {space: "score", kind: criteria.kind, criteria};
}
function saverCriteria(overrides = {}) {
  return {space: "saver", kind: "restaurant", center: F.center, radiusMiles: 15,
    text: "", typedLocation: null, timeZone: "America/New_York", locationMode: "typed", ...overrides};
}
function compareTuple(left, right) {
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}
function expected(documents, criteria) {
  const rows = documents.flatMap(document => {
    const projection = S.encodePostgisProjection(document.collection, document.id, document.data);
    if (!projection) return [];
    return [O.entityFromProjection({id: document.id, path: `${document.collection}/${document.id}`,
      data: S.decodePostgisProjection(projection)}, projection)];
  });
  const current = {...criteria, membershipMs: F.now.getTime()};
  return rows.filter(row => row.space === criteria.space && row.kind === criteria.kind && row.visible)
    .flatMap(row => {
      const parent = row.kind === "dish" ? rows.find(candidate => candidate.space === row.space &&
        candidate.kind === "restaurant" && candidate.id === row.parent_id && candidate.visible) : row;
      if (!parent) return [];
      const rank = row.space === "score" ? O.score.matchAndRank(criteria.criteria, row.dto, parent.dto) : O.saverRank(current, row);
      if (!rank) return [];
      if (row.space === "saver" && !rows.some(offer => offer.space === "saver" &&
          offer.parent_id === row.id && offer.visible && O.available(current, row, offer).visible &&
          O.saverMatches(current, row, offer))) return [];
      return [{id: row.id, tuple: [rank.rank0, rank.rank1, rank.rank2, row.name_key, row.id_key]}];
    }).sort((a, b) => compareTuple(a.tuple, b.tuple)).map(row => row.id);
}
async function catchUp(model) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const result = await model.catchUp(75);
    if (result.ready) return result.revision;
  }
  throw new Error("test catch-up exceeded bounded attempts");
}
async function pages(pool, revision, criteria, options = {}) {
  let boundary = null, rounds = 0, partials = 0, maxMemo = 0;
  const items = [], measurements = [];
  do {
    const start = performance.now();
    const result = await Q.select(pool, {revision, criteria, membership_ms: F.now.getTime()}, boundary, options);
    measurements.push(performance.now() - start);
    if (result.partial) { partials++; assert.equal(result.items.length, 0); }
    items.push(...result.items);
    maxMemo = Math.max(maxMemo, result.metrics.distanceMemoPoints);
    boundary = result.hasMore ? result.boundary : null;
    assert(++rounds < 2000, "bounded paging did not complete");
  } while (boundary !== null);
  const ids = items.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, "paging duplicated identities");
  return {items, ids, rounds, partials, maxMemo, measurements};
}

test("PostGIS pool refuses any nonlocal or production database target", () => {
  for (const change of [{host: "db.example.com"}, {database: "coupon-app-29446"},
    {database: "postgres"}, {user: "postgres"}, {port: 543}]) {
    assert.throws(() => createLocalPostgisPool({...config, ...change}), /isolated local/);
  }
});

test("PostGIS synthetic fixture uses real builders and preserves independent identities", () => {
  const fixture = F.dataset();
  assert.equal(fixture.manifest.fingerprint, F.dataset().manifest.fingerprint);
  assert.equal(fixture.manifest.documentCount, 211);
  assert.notEqual(fixture.cases.identityIsolation.saver, fixture.cases.identityIsolation.score);
  assert.equal(fixture.cases.changing.before.id, fixture.cases.changing.after.id);
  assert.notEqual(fixture.cases.changing.before.data.sourceFingerprint, fixture.cases.changing.after.data.sourceFingerprint);
  assert.equal(fixture.cases.nearTie[0].exactDistanceMiles, fixture.cases.nearTie[1].exactDistanceMiles);
  assert.equal(fixture.cases.nearTie[0].exactDistanceMiles, 0.9999999999997047);
});

test("real local PostGIS: mixed query, revision and resource qualification (synthetic event transport)",
  {skip: !enabled, timeout: 120_000}, async t => {
    const fixture = F.dataset({saverParents: 90, scoreParents: 90});
    const source = new SyntheticEventSource(fixture.documents);
    const pool = createLocalPostgisPool(config), model = new PostgisReadModel(pool, source);
    const evidence = {kind: "real-postgresql-postgis-query-integration", firestoreTransport: "in-memory-synthetic-events",
      flutterRenderingMeasured: false, hostedEvidence: false, dataset: fixture.manifest, tests: [], observations: []};
    try {
      assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "bsgate0_query");
      await model.initializeLocalSchema();
      // Only bsgate0_query is reset; never the integrating agent's bsgate0 DB.
      await pool.query("TRUNCATE receipts,admissions,sessions,revision_pins,refinement_work,projection_poison,inbox,entities,source_heads,ingestion_progress,bootstrap,publication,revisions CASCADE");
      await model.initializeLocalSchema();
      let revision = await catchUp(model);
      const beforeDocuments = [...source.documents.values()];

      await t.test("real extensions, bounded pool, exact float transport and full manifest publication", async () => {
        const extensions = (await pool.query("SELECT extname,extversion FROM pg_extension ORDER BY extname")).rows;
        assert(extensions.some(extension => extension.extname === "postgis"));
        assert.equal((await pool.query("SHOW extra_float_digits")).rows[0].extra_float_digits, "1");
        assert.equal(Number((await pool.query("SELECT count(*) AS n FROM source_heads")).rows[0].n), fixture.documents.length);
        assert.equal(Number(revision), 1);
        evidence.extensions = extensions;
        evidence.firstPublishedRevision = revision;
      });

      await t.test("all dish sort modes exhaust in exact current-policy order", async () => {
        for (const sort of ["Highest BiteScore", "Closest", "Most Reviewed", "Best Value", "Best Flavor", "Highest Quality", "Most Enjoyed"]) {
          const criteria = scoreCriteria({sort});
          const actual = await pages(pool, revision, criteria);
          assert.deepEqual(actual.ids, expected(beforeDocuments, criteria), sort);
          assert.equal(actual.ids.length, 180);
        }
      });

      await t.test("alias, spelling, category and parent filters retain exact match semantics", async () => {
        for (const extra of [{text: "submarine"}, {text: "hambuger"}, {categoryQueries: ["burgers"]},
          {restaurantId: fixture.expected.scoreRestaurantIds[0], sort: "Dish Name"}]) {
          const criteria = scoreCriteria(extra), actual = await pages(pool, revision, criteria);
          assert(actual.ids.length > 0, JSON.stringify(extra));
          assert.deepEqual(actual.ids, expected(beforeDocuments, criteria));
        }
      });

      await t.test("radius/near-tie ordering and >64-coordinate refinement have no missing later pages", async () => {
        const criteria = scoreCriteria({kind: "restaurant", radiusMiles: 1});
        const actual = await pages(pool, revision, criteria, {size: 11, chunk: 7, budget: 2});
        assert.deepEqual(actual.ids, expected(beforeDocuments, criteria));
        assert(!actual.ids.includes(fixture.cases.outsideRadiusId));
        assert(actual.partials > 0);
        const first = actual.ids.indexOf("gate0-near-tie-1"), second = actual.ids.indexOf("gate0-near-tie-0");
        assert(first >= 0 && first < second, "source exact tie must be broken by name, not SQL trig");
      });

      await t.test("Finder suggestions and close matching use current eight-result contract", async () => {
        for (const mode of ["suggestions", "close"]) {
          const criteria = scoreCriteria({kind: "restaurant", center: null, text: "Synthetic Gate0 Catalog",
            finder: {state: "FL", location: mode === "close" ? "Miami" : "331", mode}});
          const result = await Q.select(pool, {revision, criteria, membership_ms: F.now.getTime()}, null, {size: 8});
          assert.equal(result.partial, false);
          assert.deepEqual(result.items.map(row => row.id), expected(beforeDocuments, criteria).slice(0, 8));
          assert.equal(result.items.length, 8);
        }
      });

      await t.test("Saver excludes no-offer/hidden parents and matches current visible offers/Specials", async () => {
        for (const extra of [{}, {text: "noodle"}, {typedLocation: {kind: "zip", zip: "33101"}}, {text: "saturday plate"}]) {
          const criteria = saverCriteria(extra), actual = await pages(pool, revision, criteria);
          assert.deepEqual(actual.ids, expected(beforeDocuments, criteria));
          for (const id of fixture.expected.noOfferParentIds) assert(!actual.ids.includes(id));
          assert(!actual.ids.includes(fixture.cases.hiddenParentId));
          assert(actual.ids.length > 0, JSON.stringify(extra));
        }
      });

      await t.test("zero work budget returns truthful incomplete state with resumable frontier", async () => {
        const criteria = scoreCriteria();
        const first = await Q.select(pool, {revision, criteria, membership_ms: F.now.getTime()}, null, {budget: 0});
        assert.equal(first.partial, true);
        assert.equal(first.hasMore, true);
        assert.deepEqual(first.items, []);
        const resumed = await Q.select(pool, {revision, criteria, membership_ms: F.now.getTime()}, first.boundary);
        assert.equal(resumed.partial, false);
        assert.equal(resumed.items.length, 25);
      });

      await t.test("same raw coupon ID under two accounts remains two derived children", async () => {
        for (let i = 0; i < 2; i++) {
          const parentId = `gate0-scoped-coupon-parent-${i}`, parent = F.saverSource(2000 + i);
          source.append(F.saver(parentId, parent));
          source.append(F.coupon(parentId, "same-coupon-id", parent, F.couponSource("same-coupon-id", 0)));
        }
        revision = await catchUp(model);
        const rows = (await pool.query("SELECT id,parent_id FROM entities WHERE kind='coupon' AND dto->>'sourceDocumentId'='same-coupon-id' AND valid_to=9223372036854775807")).rows;
        assert.equal(rows.length, 2);
        assert.notEqual(rows[0].id, rows[1].id);
        assert.notEqual(rows[0].parent_id, rows[1].parent_id);
      });

      await t.test("edited/deleted/recreated source advances atomically while old valid pin protects paging", async () => {
        const expiresAtMs = Date.now() + 60_000;
        const pin = await model.pinRevision({pinId: "gate0-query-pinned-revision", expiresAtMs});
        const originalRevision = pin.revision;
        source.append(fixture.cases.changing.after);
        revision = await catchUp(model);
        assert(Number(revision) > Number(originalRevision));
        await model.garbageCollect();
        const query = "SELECT dto->>'displayTitle' AS title FROM entities WHERE index_path=$1 AND valid_from<=$2 AND valid_to>$2";
        const path = `${fixture.cases.changing.before.collection}/${fixture.cases.changing.before.id}`;
        const original = await model.withPinnedRevision(originalRevision, expiresAtMs,
          client => client.query(query, [path, originalRevision]));
        const current = await pool.query(query, [path, revision]);
        assert.equal(original.rows[0].title, "Synthetic noodle offer");
        assert.equal(current.rows[0].title, "Synthetic edited same ID");
        source.append({...fixture.cases.changing.after, data: null});
        source.append(fixture.cases.changing.after);
        revision = await catchUp(model);
        assert.equal((await pool.query(query, [path, revision])).rows.length, 1);
      });

      await t.test("poison/conflicting receipt and missing event cannot publish incomplete revision", async () => {
        const before = (await pool.query("SELECT revision FROM publication WHERE singleton")).rows[0].revision;
        const event = source.append(fixture.cases.changing.before);
        await assert.rejects(model.receive([{...event, digest: "0".repeat(64)}]), /poisoned/);
        const originalRead = source.readEvents;
        source.readEvents = async () => [];
        await assert.rejects(model.catchUp(), /missing source event/);
        assert.equal((await pool.query("SELECT revision FROM publication WHERE singleton")).rows[0].revision, before);
        source.readEvents = originalRead;
        revision = await catchUp(model);
        await model.receive([event]);
        const changed = {...event.payload, projection: S.encodePostgisProjection(fixture.cases.changing.after.collection,
          fixture.cases.changing.after.id, fixture.cases.changing.after.data)};
        await assert.rejects(model.receive([{...event, payload: changed, digest: S.postgisSourceDigest(changed)}]), /Conflicting duplicate/);
      });

      await t.test("valid-digest semantic poison cannot publish and only a later source repair or delete recovers", async () => {
        const original = fixture.cases.changing.after;
        for (const repair of ["replace", "delete"]) {
          const published = (await pool.query("SELECT revision FROM publication WHERE singleton")).rows[0].revision;
          const poisoned = source.append({...original, data: {...original.data, displayTitle: {invalid: true}}});
          await assert.rejects(catchUp(model), /poisoned projection/);
          assert.equal((await pool.query("SELECT revision FROM publication WHERE singleton")).rows[0].revision, published);
          const witnesses = (await pool.query("SELECT shard,seq,digest FROM projection_poison")).rows;
          assert.equal(witnesses.length, 1);
          assert.equal(witnesses[0].digest, poisoned.digest);
          assert.equal(Number(witnesses[0].seq), poisoned.seq);
          assert.equal(Number((await pool.query("SELECT count(*) AS n FROM inbox WHERE shard=$1 AND seq=$2", [poisoned.shard, poisoned.seq])).rows[0].n), 1);
          await assert.rejects(model.resumeAfterSourceRepair(), /newer source repair fence/);
          source.append(repair === "replace" ? original : {...original, data: null});
          await assert.rejects(catchUp(model), /poisoned projection/);
          await model.resumeAfterSourceRepair();
          revision = await catchUp(model);
          assert(Number(revision) > Number(published));
          assert.equal(Number((await pool.query("SELECT count(*) AS n FROM projection_poison")).rows[0].n), 0);
          const active = (await pool.query("SELECT dto->>'displayTitle' AS title FROM entities WHERE index_path=$1 AND valid_from<=$2 AND valid_to>$2",
            [`${original.collection}/${original.id}`, revision])).rows;
          assert.equal(active.length, repair === "replace" ? 1 : 0);
          if (repair === "replace") assert.equal(active[0].title, "Synthetic edited same ID");
        }
      });

      await t.test("native Saver provider translates tied-name/coordinate ID boundaries without losing later parents", async () => {
        const expectedIds = [];
        for (let i = 0; i < 30; i++) {
          const accountId = `gate0-native-tied-${String(i).padStart(3, "0")}`;
          const parent = F.saverSource(5000 + i, {...F.center, restaurantName: "Synthetic equal boundary"});
          source.append(F.saver(accountId, parent));
          source.append(F.coupon(accountId, "same-raw-offer-id", parent, F.couponSource("same-raw-offer-id", 0)));
          expectedIds.push(accountId);
        }
        revision = await catchUp(model);
        const authority = new MemoryDatabase(), discoveryKey = Buffer.alloc(32, 43);
        const start = await startCustomerBiteSaverSearchHandler({schemaVersion: 1,
          clientRequestId: "native-sql-paging-request", clientInstanceId: "native-sql-paging-client",
          ...F.center, radiusMiles: 15, locationMode: "current", typedLocation: null,
          searchText: "equal boundary", timeZone: "America/New_York", utcOffsetMinutes: -240, freshSearch: true},
        {database: authority, discoveryKey, identityKeyV1: F.identityKeyV1,
          identity: {authUid: "synthetic-sql-paging-user", authIsAnonymous: false}, now: () => F.now.getTime(),
          randomSource: size => Buffer.alloc(size, 47)});
        const path = `${privateCustomerBiteSaverSearchSessionCollection}/${start.sessionId}`;
        const expiry = new Date(Date.now() + 60_000);
        const session = {...authority.documents.get(path), state: "ready", phase: "ready",
          logicalExpiresAt: expiry, absoluteExpiresAt: expiry, expiresAt: expiry};
        const provider = new PostgisMembership(model, authority, discoveryKey, F.identityKeyV1);
        const pinned = await provider.pinRevision({pinId: start.sessionId, expiresAtMs: expiry.getTime()});
        const query = customerBiteSaverOrderedResultQuery({session});
        const first = await provider.queryResults({space: "saver", revision: pinned.revision, session, query});
        assert.equal(first.length, 26);
        const lastDelivered = first[24].data;
        const next = await provider.queryResults({space: "saver", revision: pinned.revision, session,
          query: {...query, startAfter: [lastDelivered.exactPreferenceRank, lastDelivered.distanceSortMiles,
            lastDelivered.lowercaseDisplayNameOrderKey, lastDelivered.authoritativeAccountIdOrderKey]}});
        assert.equal(next.length, 5);
        const combined = [...first.slice(0, 25), ...next].map(row => row.data.authoritativeAccountId);
        assert.deepEqual(combined, expectedIds);
        assert.equal(new Set(combined).size, 30);
      });

      await t.test("offer-heavy native summary resumes from durable bounded checkpoints without duplicates", async () => {
        const accountId = "gate0-checkpoint-many-offers";
        const parent = F.saverSource(6001, {...F.center, restaurantName: "Synthetic checkpoint many"});
        source.append(F.saver(accountId, parent));
        for (let i = 0; i < 230; i++) {
          const id = `gate0-checkpoint-offer-${String(i).padStart(4, "0")}`;
          source.append(F.coupon(accountId, id, parent, F.couponSource(id, i)));
        }
        await catchUp(model);
        const authority = new MemoryDatabase(), discoveryKey = Buffer.alloc(32, 43);
        const start = await startCustomerBiteSaverSearchHandler({schemaVersion: 1,
          clientRequestId: "native-many-offers-request", clientInstanceId: "native-many-offers-client",
          ...F.center, radiusMiles: 15, locationMode: "current", typedLocation: null,
          searchText: "checkpoint many", timeZone: "America/New_York", utcOffsetMinutes: -240, freshSearch: true},
        {database: authority, discoveryKey, identityKeyV1: F.identityKeyV1,
          identity: {authUid: "synthetic-many-offers-user", authIsAnonymous: false}, now: () => F.now.getTime(),
          randomSource: size => Buffer.alloc(size, 49)});
        const expiry = new Date(Date.now() + 60_000);
        const session = {...authority.documents.get(`${privateCustomerBiteSaverSearchSessionCollection}/${start.sessionId}`),
          state: "ready", phase: "ready", logicalExpiresAt: expiry, absoluteExpiresAt: expiry, expiresAt: expiry};
        const pinned = await model.pinRevision({pinId: start.sessionId, expiresAtMs: expiry.getTime()});
        const request = {space: "saver", revision: pinned.revision, session,
          query: customerBiteSaverOrderedResultQuery({session})};
        let rows, partials = 0, sawAccumulator = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          // A new provider on every attempt models worker-process interruption.
          const provider = new PostgisMembership(model, authority, discoveryKey, F.identityKeyV1, {queries: 2, timeMs: 4000});
          try {rows = await provider.queryResults(request); break;}
          catch (error) {
            assert.equal(error.code, "unavailable"); partials++;
            const states = (await pool.query("SELECT state FROM refinement_work WHERE session_id=$1", [session.sessionId])).rows;
            assert.equal(states.length, 1);
            sawAccumulator ||= states[0].state.accumulator !== null;
            assert(Buffer.byteLength(JSON.stringify(states[0].state)) < 100_000);
          }
        }
        assert(rows, "bounded checkpoint did not finish");
        assert(partials >= 2); assert(sawAccumulator);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].data.usableOfferCountAtPreparation, 230);
        assert.equal(rows[0].data.previewCouponCandidates.length, 3);
        assert.equal((await pool.query("SELECT id FROM refinement_work WHERE session_id=$1", [session.sessionId])).rowCount, 0);
      });

      await t.test("statement/acquisition timeouts release connections and the bounded pool recovers", async () => {
        const client = await pool.connect();
        try {
          await client.query("SET statement_timeout=1");
          await assert.rejects(client.query("SELECT pg_sleep(0.05)"), /timeout/);
          await client.query("SET statement_timeout=5000");
        } finally { client.release(); }
        assert.equal((await pool.query("SELECT 1 AS alive")).rows[0].alive, 1);
        const held = await Promise.all(Array.from({length: 4}, () => pool.connect()));
        try { await assert.rejects(pool.connect(), /timeout/); }
        finally { for (const connection of held) connection.release(); }
        assert(pool.totalCount <= 4);
        assert.equal(pool.waitingCount, 0);
      });

      await t.test("concurrent real SQL useful selections report observations without hosted/UI claims", async () => {
        const criteria = scoreCriteria({text: "submarine"});
        const observed = await Promise.all(Array.from({length: 8}, async () => {
          const start = performance.now();
          const result = await Q.select(pool, {revision, criteria, membership_ms: F.now.getTime()});
          assert.equal(result.partial, false);
          assert.equal(result.items.length, 25);
          return performance.now() - start;
        }));
        evidence.observations = observed;
        evidence.measurement = {kind: "SQL-selection-completion-ms-including-local-pool-wait",
          sampleCount: observed.length, minimumMs: Math.min(...observed), maximumMs: Math.max(...observed),
          p95: null, p99: null, coldUsefulRenderMs: null, warmUsefulRenderMs: null,
          note: "Insufficient tail samples. This is not Flutter/API end-to-end or hosted useful-page latency."};
        evidence.peakLocalPoolConnections = pool.totalCount;
        assert(pool.totalCount <= 4);
      });
      evidence.finalRevision = revision;
      evidence.status = "SQL_SUBTESTS_COMPLETED; inspect TAP for individual failures";
    } finally {
      await model.close();
      if (process.env.BS_POSTGIS_QUERY_EVIDENCE) {
        writeFileSync(process.env.BS_POSTGIS_QUERY_EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
      }
    }
  });
