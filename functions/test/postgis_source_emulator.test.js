"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {randomBytes} = require("node:crypto");

if (process.env.POSTGIS_SOURCE_EMULATOR_TEST !== "1") {
  test("real Firestore PostGIS ingestion requires explicit local emulator qualification", {skip: "set POSTGIS_SOURCE_EMULATOR_TEST=1 with loopback emulator and demo-bs-postgis-* project"}, () => {});
} else {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const project = process.env.GCLOUD_PROJECT ?? "";
  const match = /^(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/u.exec(host);
  if (!match || +match[1] > 65535 || !/^demo-bs-postgis-[a-z0-9-]+$/u.test(project) ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== project)) {
    throw new Error("PostGIS source tests require loopback Firestore, a dedicated demo-bs-postgis-* project and no credential file.");
  }
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore} = require("firebase-admin/firestore");
  const S = require("../lib/postgis_source.js");
  const F = require("../lib/postgis_source_firestore.js");
  const M = require("../lib/search_index_maintenance.js");
  const B = require("../lib/search_index_builders.js");
  const C = require("../lib/search_index_contract.js");
  const {canonicalRestaurantGeohash} = require("../lib/restaurant_geo_helpers.js");
  const epoch = "source-test-" + randomBytes(5).toString("hex");
  const isolatedProject = "demo-bs-postgis-" + randomBytes(5).toString("hex");
  const app = initializeApp({projectId: isolatedProject}, epoch);
  const db = getFirestore(app);
  const config = {epoch, projectId: isolatedProject, allowedProjectIds: [isolatedProject]};
  const source = F.createFirestorePostgisSource(db, config);
  const writer = M.createFirestoreSearchIndexDatabase(db, {postgisSource: config});
  const ordinaryWriter = M.createFirestoreSearchIndexDatabase(db);
  const now = new Date("2026-10-17T15:00:00Z");
  const restaurant = (name) => ({name, streetAddress: "1 Synthetic Street", city: "Miami", state: "FL", zipCode: "33101",
    latitude: 25.77, longitude: -80.19, geohash: canonicalRestaurantGeohash({latitude: 25.77, longitude: -80.19}), isActive: true, isClaimed: false});
  const indexId = (id) => C.createSearchIndexDocumentId({entityKind: "restaurant", sourceKind: "biteScoreRestaurant", sourceDocumentId: id});
  async function put(id, data, selectedWriter = writer) {
    if (data === null) await db.doc(`bitescore_restaurants/${id}`).delete();
    else await db.doc(`bitescore_restaurants/${id}`).set(data);
    await M.reconcileBiteScoreRestaurantIndex(selectedWriter, id, now);
  }
  async function allEvents(fence) {
    const result = [];
    for (let shard = 0; shard < 16; shard++) {
      let seq = 0;
      while (seq < fence.shards[shard].seq) {
        const page = await source.readEvents(shard, seq, fence.shards[shard].seq, 2);
        result.push(...page); seq = page[page.length - 1].seq;
      }
    }
    return result;
  }
  function expectedManifest(fence) {
    return Object.fromEntries(S.postgisSourceCollections.map((collection) => [collection,
      fence.shards.reduce((sum, shard) => ({count: sum.count + shard.partitions[collection].count,
        xor: S.postgisXorDigest(sum.xor, shard.partitions[collection].xor)}), {count: 0, xor: S.postgisZeroDigest})]));
  }
  test("real Firestore source journaling, fenced bootstrap and interruption recovery", async (t) => {
    try {
      await t.test("default writer remains dormant and pre-existing projections are not mistaken for an empty enrolled source", async () => {
        await put("legacy", restaurant("Before enrollment"), ordinaryWriter);
        assert.equal((await db.collection(F.postgisSourceEventsCollection).get()).size, 0);
        await source.initialize();
        const fence = await source.readFence();
        assert.equal(fence.enrolled, false);
        assert.equal(fence.shards.reduce((n, s) => n + s.seq, 0), 0);
      });
      await t.test("real maintenance create/update/delete/recreate and duplicate delivery preserve a single identity sequence", async () => {
        await put("same", restaurant("First"));
        const beforeDuplicate = await source.readFence();
        await M.reconcileBiteScoreRestaurantIndex(writer, "same", now);
        assert.deepEqual(await source.readFence(), beforeDuplicate);
        await put("same", restaurant("Edited"));
        await put("same", null);
        await put("same", restaurant("Recreated"));
        const events = (await allEvents(await source.readFence())).filter((e) => e.payload.indexDocumentId === indexId("same"));
        assert.equal(events.length, 4);
        assert.equal(events[2].payload.projection, null);
        assert.equal(S.decodePostgisProjection(events[3].payload.projection).customerPublicProjection.displayName, "Recreated");
        assert(events.every((e) => e.shard === events[0].shard));
      });
      await t.test("interrupted source transaction cannot commit an event or advance a shard", async () => {
        const before = await source.readFence();
        const id = indexId("atomic");
        const projection = B.buildBiteScoreRestaurantIndex({sourceDocumentId: "atomic", source: restaurant("Atomic"), now});
        await assert.rejects(db.runTransaction(async (tx) => {
          await source.recordMutation(tx, "restaurant_search_index", id, projection);
          tx.set(db.doc(`restaurant_search_index/${id}`), projection);
          throw Error("injected_before_commit");
        }), /injected_before_commit/);
        assert.deepEqual(await source.readFence(), before);
        assert.equal((await db.doc(`restaurant_search_index/${id}`).get()).exists, false);
      });
      await t.test("bootstrap resumes after interruption, re-reads raced scan rows and captures an end fence only after every collection", async () => {
        let checkpoint = await source.beginEnrollment("bootstrap");
        assert.equal(checkpoint.startFence.enrolled, false);
        checkpoint = await source.advanceEnrollment("bootstrap", 1);
        const restarted = F.createFirestorePostgisSource(db, config);
        assert.deepEqual(await restarted.beginEnrollment("bootstrap"), checkpoint);
        await put("behind-cursor", restaurant("Concurrent create"));
        const rows = await source.scanProjections("restaurant_search_index", null, 100);
        assert(rows.some((row) => row.indexDocumentId === indexId("legacy")));
        await put("legacy", null);
        await source.enrollProjection("restaurant_search_index", indexId("legacy"));
        await put("legacy", restaurant("Concurrent recreation"));
        while (checkpoint.phase !== "complete") checkpoint = await restarted.advanceEnrollment("bootstrap", 1);
        assert.equal(checkpoint.endFence.enrolled, true);
        assert.equal(checkpoint.collectionIndex, 3);
        assert.deepEqual(await restarted.advanceEnrollment("bootstrap", 1), checkpoint);
        const events = await allEvents(checkpoint.endFence);
        assert.deepEqual(S.postgisSourceManifest(events), expectedManifest(checkpoint.endFence));
        assert.equal(expectedManifest(checkpoint.endFence).restaurant_search_index.count, 3);
      });
      await t.test("concurrent identity writes on the same shard cannot lose a committed sequence or count", async () => {
        const chosen = [];
        const target = S.postgisSourceShardFor("restaurant_search_index", indexId("concurrent0"));
        for (let n = 0; chosen.length < 4; n++) {
          const id = `concurrent${n}`;
          if (S.postgisSourceShardFor("restaurant_search_index", indexId(id)) === target) chosen.push(id);
        }
        const before = await source.readFence();
        await Promise.all(chosen.map((id) => put(id, restaurant(id))));
        const after = await source.readFence();
        assert.equal(after.shards[target].seq - before.shards[target].seq, 4);
        assert.deepEqual(S.postgisSourceManifest(await allEvents(after)), expectedManifest(after));
      });
      await t.test("actual BiteSaver account/coupon/special and BiteScore dish/aggregate paths journal parent fanout and independent identities", async () => {
        const fixture = require("./fixtures/postgis_gate0.cjs");
        const saverParent = fixture.saverSource(0);
        const account = "same"; // Intentionally the same text as the independent Score ID.
        await db.doc(`restaurant_accounts/${account}`).set(saverParent);
        await M.reconcileBiteSaverRestaurantIndex(writer, account, now, fixture.identityKeyV1);
        const offer = fixture.couponSource("coupon", 0);
        await db.doc(`restaurant_accounts/${account}/coupons/coupon`).set(offer);
        await M.handleBiteSaverCouponOfferWrite(writer, {restaurantAccountId: account, couponId: "coupon", now,
          identityKeyV1: fixture.identityKeyV1});
        const special = {id: "special", restaurantId: account, ownerUid: account, title: "Synthetic plate",
          isActive: true, createdAt: now, updatedAt: now, availabilityMode: "specificDays", daysOfWeek: [6], allDay: true};
        await db.doc(`restaurant_accounts/${account}/daily_specials/special`).set(special);
        await M.handleBiteSaverDailySpecialOfferWrite(writer, {restaurantAccountId: account, dailySpecialId: "special", now});
        await db.doc("bitescore_dishes/dish").set({name: "Synthetic Burger", restaurantId: "same", category: "Burgers", isActive: true});
        await db.doc("dish_rating_aggregates/dish").set({dishId: "dish", restaurantId: "same", overallBiteScore: 80, ratingCount: 3});
        await M.reconcileBiteScoreDishIndex(writer, "dish", now);
        const first = await source.readFence();
        let events = await allEvents(first);
        assert.equal(expectedManifest(first).bitesaver_offer_index.count, 2);
        assert.equal(expectedManifest(first).dish_search_index.count, 1);
        assert.deepEqual(S.postgisSourceManifest(events), expectedManifest(first));
        assert(!JSON.stringify(events).includes(fixture.privateCanary));
        const saverId = C.createSearchIndexDocumentId({entityKind: "restaurant", sourceKind: "biteSaverRestaurant", sourceDocumentId: account});
        assert(events.some((e) => e.payload.indexDocumentId === saverId));
        assert(events.some((e) => e.payload.indexDocumentId === indexId("same")));
        await db.doc("dish_rating_aggregates/dish").update({overallBiteScore: 90});
        await M.reconcileBiteScoreDishIndex(writer, "dish", now);
        const scoreBefore = (await db.doc("bitescore_restaurants/same").get()).data();
        const scoreAfter = {...scoreBefore, isActive: false};
        await db.doc("bitescore_restaurants/same").set(scoreAfter);
        await M.handleBiteScoreRestaurantWrite(writer, {restaurantId: "same", before: scoreBefore, after: scoreAfter,
          sourceEventId: "score-hide", now});
        const saverAfter = {...saverParent, adminHidden: true};
        await db.doc(`restaurant_accounts/${account}`).set(saverAfter);
        await M.handleBiteSaverRestaurantWrite(writer, {restaurantAccountId: account, before: saverParent, after: saverAfter,
          sourceEventId: "saver-hide", now, identityKeyV1: fixture.identityKeyV1});
        for (let pass = 0; pass < 5; pass++) {
          const jobs = (await db.collection(C.privateSearchIndexJobCollection).get()).docs.filter((d) => d.get("status") === "pending");
          if (jobs.length === 0) break;
          for (const job of jobs) await M.processSearchIndexJob(writer, job.id, now, fixture.identityKeyV1);
          assert(pass < 4, "bounded parent fanout must finish");
        }
        const hidden = await source.readFence();
        assert.equal(expectedManifest(hidden).dish_search_index.count, 0);
        events = await allEvents(hidden);
        assert.deepEqual(S.postgisSourceManifest(events), expectedManifest(hidden));
        await db.doc(`restaurant_accounts/${account}/coupons/coupon`).delete();
        await M.handleBiteSaverCouponOfferWrite(writer, {restaurantAccountId: account, couponId: "coupon", now,
          identityKeyV1: fixture.identityKeyV1});
        await db.doc(`restaurant_accounts/${account}/daily_specials/special`).delete();
        await M.handleBiteSaverDailySpecialOfferWrite(writer, {restaurantAccountId: account, dailySpecialId: "special", now});
        const deleted = await source.readFence();
        assert.equal(expectedManifest(deleted).bitesaver_offer_index.count, 0);
        assert.deepEqual(S.postgisSourceManifest(await allEvents(deleted)), expectedManifest(deleted));
      });
      await t.test("poison and missing-event gaps block delivery; restoring exact immutable evidence permits retry", async () => {
        const fence = await source.readFence();
        const event = (await allEvents(fence))[0];
        const eventId = `s${String(event.shard).padStart(2, "0")}_${String(event.seq).padStart(16, "0")}`;
        const ref = db.doc(`${F.postgisSourceEventsCollection}/${eventId}`);
        await ref.update({digest: "0".repeat(64)});
        await assert.rejects(source.readEvents(event.shard, event.seq - 1, event.seq), /poison/);
        await ref.set(event);
        await ref.delete();
        await assert.rejects(source.readEvents(event.shard, event.seq - 1, event.seq), /gap/);
        await ref.set(event);
        assert.deepEqual(await source.readEvents(event.shard, event.seq - 1, event.seq), [event]);
      });
      await t.test("epoch replacement and incomplete enrollment owner changes fail closed", async () => {
        await assert.rejects(F.createFirestorePostgisSource(db, {...config, epoch: "replacement"}).initialize(), /initialized/);
        await assert.rejects(source.beginEnrollment("second-bootstrap"), /owner/);
        assert.equal((await source.readFence()).epoch, epoch);
      });
      await t.test("source retention requires actual intact recovery files and preserves every change beyond the acknowledged fence", async () => {
        const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
        const R = require("../lib/postgis_source_recovery.js");
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bs-source-recovery-"));
        const {LocalPostgisSnapshotReader} = require("../lib/postgis_snapshot.js");
        const reader = new LocalPostgisSnapshotReader(directory);
        const manifestPath = id => reader.path(id,"manifest.json"), rowPath=id=>reader.path(id,"rows.jsonl");
        async function replace(file,bytes) {await fs.chmod(file,0o600);await fs.writeFile(file,bytes);await fs.chmod(file,0o400);}
        async function acknowledge(fence,manifest) {while (!(await source.acknowledgePublishedFence(fence,manifest,reader)).ready) {}}
        async function saveSnapshot(id, fence) {
          const latest = new Map();
          for (const event of await allEvents(fence)) {
            const key = `${event.payload.collection}/${event.payload.indexDocumentId}`;
            if (event.payload.projection === null) latest.delete(key);
            else latest.set(key, {payload: event.payload, digest: event.digest});
          }
          const rows = [...latest.values()].sort((a, b) => R.postgisRecoveryIdentity(a) < R.postgisRecoveryIdentity(b) ? -1 : 1);
          const manifest = R.createPostgisRecoveryManifest(id, fence, rows);
          const content=rows.map(row=>JSON.stringify(row)+"\n").join("");
          let bytes=0;const offsets=[];for(let i=0;i<rows.length;i++) {if(i%500===0)offsets.push({identity:R.postgisRecoveryIdentity(rows[i]),offset:bytes});bytes+=Buffer.byteLength(JSON.stringify(rows[i])+"\n");}
          await fs.writeFile(manifestPath(id), JSON.stringify(manifest),{mode:0o400});
          await fs.writeFile(rowPath(id), content,{mode:0o400});
          await fs.writeFile(reader.path(id,"offsets.json"),JSON.stringify({rowCount:rows.length,dataBytes:bytes,offsets}),{mode:0o400});
          return {manifest, rows};
        }
        try {
          await assert.rejects(source.pruneAcknowledgedEvents(reader, 2), /No acknowledged/);
          const firstFence = await source.readFence();
          const first = await saveSnapshot("first", firstFence);
          const exactRows = await fs.readFile(rowPath("first"), "utf8");
          await replace(rowPath("first"), "");
          await assert.rejects(source.acknowledgePublishedFence(firstFence, first.manifest, reader), /incomplete|sparse index/);
          await replace(rowPath("first"), exactRows);
          await assert.rejects(source.acknowledgePublishedFence({...firstFence, epoch: "wrong"}, first.manifest, reader), /epoch/);
          await acknowledge(firstFence, first.manifest);
          await put("newer-snapshot", restaurant("Newer"));
          const secondFence = await source.readFence();
          const second = await saveSnapshot("second", secondFence);
          await acknowledge(secondFence, second.manifest);
          await assert.rejects(source.acknowledgePublishedFence(firstFence, first.manifest, reader), /older/);
          await put("must-survive-prune", restaurant("After acknowledged snapshot"));
          const finalFence = await source.readFence();
          const durableFile = await fs.readFile(manifestPath("second"), "utf8");
          await fs.unlink(manifestPath("second"));
          await assert.rejects(source.pruneAcknowledgedEvents(reader, 2), /unavailable/);
          await fs.writeFile(manifestPath("second"), durableFile,{mode:0o400});
          await assert.rejects(source.pruneAcknowledgedEvents(reader,2),/changed/);
          const replacement = await saveSnapshot("second-requalified",secondFence);
          await acknowledge(secondFence,replacement.manifest);
          let deleted = 0;
          while (true) {
            const batch = await source.pruneAcknowledgedEvents(reader, 2);
            assert(batch.deleted <= 2);
            deleted += batch.deleted;
            if (batch.deleted === 0) break;
          }
          assert.equal(deleted, secondFence.shards.reduce((n, shard) => n + shard.seq, 0));
          const surviving = (await db.collection(F.postgisSourceEventsCollection).get()).docs.map((d) => d.data());
          assert.equal(surviving.length, 1);
          assert.equal(surviving[0].payload.indexDocumentId, indexId("must-survive-prune"));
          assert.deepEqual(await source.readFence(), finalFence);
          const restarted = F.createFirestorePostgisSource(db, config);
          assert.equal((await restarted.pruneAcknowledgedEvents(reader, 2)).deleted, 0);
          await R.validatePostgisRecoverySnapshot(reader, second.manifest);
        } finally {await fs.rm(directory, {recursive: true, force: true});}
      });
    } finally {
      // Only this run's generated, isolated emulator project can be removed.
      await fetch(`http://${host}/emulator/v1/projects/${isolatedProject}/databases/(default)/documents`, {method: "DELETE"});
      await deleteApp(app);
    }
  });
}
