"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {randomBytes} = require("node:crypto");

test("bounded SQL cleanup preserves active revisions, remaining foreign keys and unpublished source events",
  {skip: process.env.BS_POSTGIS_SQL_TEST !== "1"}, async () => {
    const {Pool} = require("pg");
    const {PostgisReadModel, createLocalPostgisPool, insertEntity} = require("../lib/postgis_store.js");
    const {entityFromProjection} = require("../lib/postgis_semantics.js");
    const {encodePostgisProjection, decodePostgisProjection} = require("../lib/postgis_source.js");
    const F = require("./fixtures/postgis_gate0.cjs");
    const database = `bsgate0_cleanup_${randomBytes(5).toString("hex")}`;
    const admin = new Pool({host: "127.0.0.1", port: 55441, database: "postgres", user: "bsgate0", max: 1});
    let model;
    try {
      await admin.query(`CREATE DATABASE ${database}`);
      model = new PostgisReadModel(createLocalPostgisPool({host: "127.0.0.1", port: 55441, database, user: "bsgate0"}), {
        readFence() {throw Error("cleanup must not read the source");}, readEvents() {throw Error("cleanup must not read the source");},
      });
      await model.initializeLocalSchema();
      const now = Date.now(), fence = Array(16).fill(5);
      for (let revision = 1; revision <= 8; revision++) {
        await model.pool.query("INSERT INTO revisions(revision,fence) VALUES($1,$2)", [revision, JSON.stringify(fence)]);
      }
      await model.pool.query("UPDATE publication SET revision=8,fence=$1", [JSON.stringify(fence)]);
      const document = F.dataset({saverParents: 0, scoreParents: 1, dishesPerRestaurant: 0, includeCases: false}).documents[0];
      const projection = encodePostgisProjection(document.collection, document.id, document.data);
      const entity = entityFromProjection({id: document.id, path: `${document.collection}/${document.id}`,
        data: decodePostgisProjection(projection)}, projection);
      for (let revision = 0; revision <= 8; revision++) {
        await insertEntity(model.pool, entity, revision);
        if (revision < 8) await model.pool.query("UPDATE entities SET valid_to=$2 WHERE valid_from=$1", [revision, revision + 1]);
      }
      await model.pool.query("INSERT INTO revision_pins(id,revision,expires_ms) VALUES('active',3,$1)", [now + 10000]);
      await model.pool.query("INSERT INTO revision_pins(id,revision,expires_ms,lease_ms) VALUES('leased',4,$1,$2)", [now - 1, now + 10000]);
      for (let index = 0; index < 5; index++) {
        await model.pool.query("INSERT INTO revision_pins(id,revision,expires_ms) VALUES($1,1,$2)", [`expired-${index}`, now - 1]);
        await model.pool.query("INSERT INTO refinement_work(id,session_id,revision,expires_ms) VALUES($1,'expired',0,$2)", [`expired-${index}`, now - 1]);
      }
      // Live work and old compatibility session rows still own revision foreign keys.
      await model.pool.query("INSERT INTO refinement_work(id,session_id,revision,expires_ms) VALUES('live','live',1,$1)", [now + 10000]);
      await model.pool.query("INSERT INTO sessions(id,actor,realm,revision,criteria,criteria_hash,membership_ms,expires_ms,idle_ms) VALUES('live','actor','score',2,'{}','hash',$1,$2,$2)", [now, now + 10000]);
      for (let shard = 0; shard < 16; shard++) for (let seq = 1; seq <= 8; seq++) {
        await model.pool.query("INSERT INTO inbox(shard,seq,payload,digest) VALUES($1,$2,'{}','fixture')", [shard, seq]);
      }
      await assert.rejects(model.garbageCollect(now, 501), /bounded/);
      let totals = {removedVersions: 0, removedEvents: 0, removedPins: 0, removedWork: 0, removedRevisions: 0};
      for (let round = 0; round < 100; round++) {
        const removed = await model.garbageCollect(now, 2);
        for (const [kind, count] of Object.entries(removed)) {assert(count <= 2, kind); totals[kind] += count;}
        if (Object.values(removed).every(count => count === 0)) break;
        assert(round < 99);
      }
      assert.deepEqual(totals, {removedVersions: 3, removedEvents: 80, removedPins: 5, removedWork: 5, removedRevisions: 1});
      assert.deepEqual((await model.pool.query("SELECT id FROM revision_pins ORDER BY id")).rows.map(row => row.id), ["active", "leased"]);
      assert.deepEqual((await model.pool.query("SELECT valid_from::int AS revision FROM entities ORDER BY valid_from")).rows.map(row => row.revision), [3,4,5,6,7,8]);
      assert.equal(Number((await model.pool.query("SELECT count(*) FROM inbox WHERE seq>5")).rows[0].count), 48);
      assert.equal(Number((await model.pool.query("SELECT count(*) FROM revisions WHERE revision IN (1,2)")).rows[0].count), 2);
      await model.withPinnedRevision("3", now + 10000, async client => {
        assert.equal(Number((await client.query("SELECT count(*) FROM entities WHERE valid_from<=3 AND valid_to>3")).rows[0].count), 1);
      });
    } finally {
      if (model) await model.close();
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.end();
    }
  });

test("real Firestore bounded binding cleanup is inert, nonproduction guarded and retains live bindings",
  {skip: process.env.POSTGIS_SOURCE_EMULATOR_TEST !== "1"}, async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host !== "127.0.0.1:8088" || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error("Dedicated local emulator required.");
    const {initializeApp, deleteApp} = require("firebase-admin/app");
    const {getFirestore} = require("firebase-admin/firestore");
    const {createFirestorePostgisBindingPruner, buildPostgisPendingSearchBinding, buildPostgisSearchBinding,
      postgisSearchBindingPath, postgisSearchBindingCollection} = require("../lib/postgis_search_binding.js");
    const projectId = `demo-bs-postgis-${randomBytes(5).toString("hex")}`;
    const app = initializeApp({projectId}, projectId), db = getFirestore(app);
    const config = {epoch: "cleanup", projectId, allowedProjectIds: [projectId]};
    try {
      const now = Date.now(), ids = Array.from({length: 7}, (_, index) => index.toString(16).padStart(64, "0"));
      for (const [index, id] of ids.entries()) {
        const pending = buildPostgisPendingSearchBinding(id, index < 5 ? now - 1 : now + 10000);
        const binding = index % 2 ? buildPostgisSearchBinding(id, {...pending, revision: "1"}, pending.expiresAtMs) : pending;
        await db.doc(postgisSearchBindingPath(id)).set(binding);
      }
      assert.throws(() => createFirestorePostgisBindingPruner(db, {...config, allowedProjectIds: [projectId, "coupon-app-29446"]}), /nonproduction/);
      assert.throws(() => createFirestorePostgisBindingPruner(db, {...config, projectId: "different-project"}), /nonproduction/);
      const prune = createFirestorePostgisBindingPruner(db, config);
      assert.equal((await db.collection(postgisSearchBindingCollection).get()).size, 7, "constructing maintenance is inert");
      await assert.rejects(prune(now, 401), /bounded/);
      assert.deepEqual(await prune(now, 2), {deleted: 2});
      assert.deepEqual(await prune(now, 2), {deleted: 2});
      assert.deepEqual(await prune(now, 2), {deleted: 1});
      assert.deepEqual(await prune(now, 2), {deleted: 0});
      assert.deepEqual((await db.collection(postgisSearchBindingCollection).get()).docs.map(doc => doc.id).sort(), ids.slice(5));
    } finally {
      await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {method: "DELETE"});
      await deleteApp(app);
    }
  });
