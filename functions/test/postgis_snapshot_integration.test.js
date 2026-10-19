"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

if (process.env.BS_POSTGIS_SQL_TEST !== "1" || process.env.POSTGIS_SOURCE_EMULATOR_TEST !== "1") {
  test("actual Firestore/PostGIS external snapshot recovery requires explicit local runtime gates", {skip: "set both BS_POSTGIS_SQL_TEST=1 and POSTGIS_SOURCE_EMULATOR_TEST=1"}, () => {});
} else {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const project = process.env.GCLOUD_PROJECT ?? "";
  if (host !== "127.0.0.1:8088" || !/^demo-bs-postgis-[a-z0-9-]+$/u.test(project) || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Snapshot integration requires the dedicated local loopback Firestore emulator and demo project.");
  }
  const {randomBytes} = require("node:crypto");
  const {Pool} = require("pg");
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore} = require("firebase-admin/firestore");
  const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
  const {createFirestorePostgisSource, postgisSourceEventsCollection} = require("../lib/postgis_source_firestore.js");
  const {createFirestoreSearchIndexDatabase, reconcileBiteScoreRestaurantIndex} = require("../lib/search_index_maintenance.js");
  const {createLocalPostgisPool, PostgisReadModel} = require("../lib/postgis_store.js");
  const {LocalPostgisSnapshotReader, exportPostgisSnapshot, restorePostgisSnapshot} = require("../lib/postgis_snapshot.js");
  const {validatePostgisRecoverySnapshot} = require("../lib/postgis_source_recovery.js");
  const fixture = require("./fixtures/postgis_gate0.cjs");
  const {makeGcsSnapshotFixture} = require("./support/postgis_gcs_fixture.cjs");

  for (const storage of ["local-files", "simulated-gcs-json-api"]) test(`real Firestore bootstrap survives SQL loss via ${storage}, bounded resume and post-snapshot replay`, async (t) => {
    const suffix = randomBytes(5).toString("hex");
    const sourceDatabase = `bsgate0_snapshot_source_${suffix}`, restoredDatabase = `bsgate0_snapshot_restore_${suffix}`;
    const admin = new Pool({host: "127.0.0.1", port: 55441, database: "postgres", user: "bsgate0", max: 1});
    const isolatedProject = `demo-bs-postgis-${suffix}`;
    const app = initializeApp({projectId: isolatedProject}, `snapshot-${suffix}`);
    const db = getFirestore(app);
    const config = {epoch: `snapshot-${suffix}`, projectId: isolatedProject, allowedProjectIds: [isolatedProject]};
    const source = createFirestorePostgisSource(db, config);
    const writer = createFirestoreSearchIndexDatabase(db, {postgisSource: config});
    const base = process.env.BS_POSTGIS_REPORT_DIR || os.tmpdir();
    await fs.mkdir(base, {recursive: true});
    const directory = await fs.mkdtemp(path.join(base, "recovery-snapshot-"));
    const sqlConfig = (database) => ({host: "127.0.0.1", port: 55441, database, user: "bsgate0"});
    let original = null, restored = null;
    const created = new Set();
    let exported;
    try {
      // 180 Score parents x (parent + two dishes), plus 6 Saver rows:
      // this crosses the 500-row sparse file-index boundary.
      const data = fixture.dataset({saverParents: 2, scoreParents: 180, offersPerRestaurant: 2,
        dishesPerRestaurant: 2, noOfferEvery: 0, includeCases: false});
      for (let offset = 0; offset < data.documents.length; offset += 400) {
        const batch = db.batch();
        for (const document of data.documents.slice(offset, offset + 400)) batch.set(db.doc(`${document.collection}/${document.id}`), document.data);
        await batch.commit();
      }
      // Real raw source for the update delivered after recovery snapshot publication.
      const mutableId = data.expected.scoreRestaurantIds[0];
      const mutableSource = data.sources.find((entry) => entry.path === `bitescore_restaurants/${mutableId}`);
      await db.doc(mutableSource.path).set(mutableSource.data);
      await source.initialize();
      let enrollment = await source.beginEnrollment("bootstrap");
      while (enrollment.phase !== "complete") enrollment = await source.advanceEnrollment("bootstrap", 100);
      await admin.query(`CREATE DATABASE ${sourceDatabase}`); created.add(sourceDatabase);
      original = new PostgisReadModel(createLocalPostgisPool(sqlConfig(sourceDatabase)), source);
      await original.initializeLocalSchema();
      let intake;
      do {intake = await original.catchUp(75);} while (!intake.ready);
      assert.equal(Number((await original.pool.query("SELECT count(*) FROM source_heads")).rows[0].count), data.documents.length);
      // Native Firestore writes, SQL intake and admission really overlap. The
      // durable search target must finish while later source writes continue.
      const {performance}=require("node:perf_hooks");
      await db.doc(mutableSource.path).update({name:"Concurrent initial"});
      await reconcileBiteScoreRestaurantIndex(writer,mutableId,fixture.now);
      const admissionRequest={pinId:`concurrent-target-${suffix}`,expiresAtMs:Date.now()+600000};
      await assert.rejects(original.pinRevision(admissionRequest),/captured source watermark/);
      let admitted=false,writes=0,writesAtAdmission=null,attempts=0;const admissionMs=[],intakeMs=[];
      const concurrentWriter=(async()=>{for(let i=0;i<30;i++){
        await db.doc(mutableSource.path).update({name:`Concurrent edit ${i}`});
        await reconcileBiteScoreRestaurantIndex(writer,mutableId,fixture.now);writes++;
        await new Promise(resolve=>setTimeout(resolve,20));}})();
      for(let i=0;writes<5;i++){assert(i<1000,"native writer must make progress");await new Promise(resolve=>setTimeout(resolve,5));}
      const concurrentIngest=(async()=>{for(let i=0;i<100&&!admitted;i++){
        const start=performance.now();await original.catchUp(75);intakeMs.push(performance.now()-start);
        await new Promise(resolve=>setTimeout(resolve,5));}})();
      const concurrentAdmission=(async()=>{for(let i=0;i<100&&!admitted;i++){
        const start=performance.now();attempts++;
        try {await new PostgisReadModel(original.pool,source).pinRevision(admissionRequest);admitted=true;writesAtAdmission=writes;}
        catch(error){assert.match(error.message,/captured source watermark/);}
        admissionMs.push(performance.now()-start);await new Promise(resolve=>setTimeout(resolve,5));}})();
      await Promise.all([concurrentWriter,concurrentIngest,concurrentAdmission]);
      assert(admitted);assert(writesAtAdmission>=5&&writesAtAdmission<30,"admission must not chase continuing native writes");
      const concurrentMetrics={writes,attempts,writesAtAdmission,admissionMs,intakeMs,actualConcurrentFirestoreWrites:true};
      const settledFence=await source.readFence();
      for(let i=0;i<100;i++) {intake=await original.catchUp(75);
        const published=(await original.pool.query("SELECT fence FROM publication WHERE singleton")).rows[0].fence;
        if(intake.ready&&settledFence.shards.every((shard,index)=>shard.seq<=published[index]))break;
        assert(i<99,"settled source fence must complete");}
      exported = await exportPostgisSnapshot(original.pool, directory, "qualified");
      const localReader = new LocalPostgisSnapshotReader(directory);
      const gcs = storage === "simulated-gcs-json-api" ? makeGcsSnapshotFixture() : null;
      const reader = gcs ? gcs.createStore() : localReader;
      if (gcs) {
        gcs.state.retentionPolicy = {isLocked:true,retentionPeriod:"31536000"};
        const before = gcs.state.before;
        gcs.state.before = async request => {
          if (before) {const result=await before(request);if(result)return result;}
          for (const object of gcs.objects.values()) object.metadata.retentionExpirationTime = new Date(Date.now()+31536000000).toISOString();
          if (request.method === "GET" && !new URL(request.url).pathname.includes("/o/")) return gcs.response(200,{
            name:gcs.config.hosted.snapshot.bucket,projectNumber:gcs.state.bucketProject,timeCreated:gcs.state.bucketCreatedAt,retentionPolicy:gcs.state.retentionPolicy});
        };
        await reader.publish(localReader, exported);
      }
      assert.equal(exported.rowCount, data.documents.length);
      await validatePostgisRecoverySnapshot(reader, exported);
      await assert.rejects(exportPostgisSnapshot(original.pool, directory, "qualified"), /already exists/);
      const page1 = await reader.readRecoveryRows("qualified", null, 500);
      const last = page1[page1.length - 1].payload;
      const page2 = await reader.readRecoveryRows("qualified", `${last.collection}/${last.indexDocumentId}`, 500);
      assert.equal(page1.length + page2.length, data.documents.length);
      assert.equal(page1.length, 500);

      let rowReads=0, returnedRows=0, returnedRowBytes=0, maximumPage=0, validationPages=0;
      const readRows=reader.readRecoveryRows.bind(reader);
      reader.readRecoveryRows=async (...args)=>{const rows=await readRows(...args);rowReads++;returnedRows+=rows.length;
        returnedRowBytes+=rows.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row)),0);maximumPage=Math.max(maximumPage,rows.length);return rows;};
      let acknowledgement;
      do {const restartedSource=createFirestorePostgisSource(db,config);
        acknowledgement=await restartedSource.acknowledgePublishedFence(exported.fence,exported,reader);validationPages++;
        assert(validationPages<20);assert(maximumPage<=64);
      } while(!acknowledgement.ready);
      const validationMetrics={rowReads,returnedRows,returnedRowBytes,maximumPage,validationPages};
      assert.equal(returnedRows,data.documents.length);
      rowReads=0;returnedRows=0;returnedRowBytes=0;maximumPage=0;
      await db.doc(mutableSource.path).update({name: "Updated after retained snapshot"});
      await reconcileBiteScoreRestaurantIndex(writer, mutableId, fixture.now);
      let removedEvents = 0;
      while (true) {const result = await source.pruneAcknowledgedEvents(reader, 400); removedEvents += result.deleted; if (!result.deleted) break;}
      assert.equal(removedEvents, exported.fence.shards.reduce((sum, shard) => sum + shard.seq, 0));
      assert.equal(rowReads,0,"pruning must reuse exact validated artifact proof without replaying rows");
      const pruneMetrics={rowReads,returnedRows,returnedRowBytes};
      assert.equal((await db.collection(postgisSourceEventsCollection).get()).size, 1);
      await original.close(); original = null;
      await admin.query(`DROP DATABASE ${sourceDatabase}`); created.delete(sourceDatabase);
      if (gcs) {
        // The fake provider holds the actual generation-pinned bytes. Remove
        // runner export files too; restoration must use the JSON API adapter.
        for (const extension of ["manifest.json", "rows.jsonl", "offsets.json"]) await fs.unlink(localReader.path("qualified", extension));
        await fs.writeFile(path.join(directory, "simulated-provider-objects.json"), JSON.stringify(
          [...gcs.objects.entries()].map(([name, item]) => ({name, metadata: item.metadata, bodyBase64: item.body.toString("base64")})), null, 2));
      }
      // The source SQL database is now gone and older source events were pruned.
      await admin.query(`CREATE DATABASE ${restoredDatabase}`); created.add(restoredDatabase);
      restored = new PostgisReadModel(createLocalPostgisPool(sqlConfig(restoredDatabase)), source);
      await restored.initializeLocalSchema();
      let recovery = await restorePostgisSnapshot(restored.pool, reader, "qualified", 75);
      assert.equal(recovery.ready, false);
      assert.equal((await restored.pool.query("SELECT ready FROM bootstrap WHERE singleton")).rows[0].ready, false);
      await assert.rejects(restored.catchUp(75), /snapshot.*restor|restor.*snapshot/i);
      await restored.close(); // Worker interruption; committed restore progress remains.
      restored = new PostgisReadModel(createLocalPostgisPool(sqlConfig(restoredDatabase)), source);
      let restorePages = 1;
      while (!recovery.ready) {recovery = await restorePostgisSnapshot(restored.pool, reader, "qualified", 75); restorePages++; assert(restorePages < 40);}
      assert.equal(recovery.restored, data.documents.length);
      assert.equal((await restored.pool.query("SELECT ready FROM bootstrap WHERE singleton")).rows[0].ready, true);
      assert.equal(Number((await restored.pool.query("SELECT count(*) FROM source_heads")).rows[0].count), data.documents.length);
      do {intake = await restored.catchUp(75);} while (!intake.ready);
      const changed = (await restored.pool.query("SELECT payload FROM source_heads WHERE payload->'projection'->>'sourceDocumentId'=$1", [mutableId])).rows[0];
      assert.equal(changed.payload.projection.customerPublicProjection.displayName, "Updated after retained snapshot");
      assert.deepEqual((await restored.pool.query("SELECT fence FROM publication WHERE singleton")).rows[0].fence,
        (await source.readFence()).shards.map((shard) => shard.seq));
      await assert.rejects(restorePostgisSnapshot(restored.pool, reader, "other-snapshot", 75), gcs ? /outside approved scope/ : /missing/);
      const evidence = {syntheticOnly: true, storage, realGcsContacted: false,
        localExportFilesRemovedBeforeRestore: gcs !== null, providerObjects: gcs?.objects.size ?? null,
        firestoreEmulator: host, postgres: "127.0.0.1:55441",
        sourceProject: isolatedProject, documents: data.documents.length, sourceDatabaseDeleted: true,
        sourceEventsPruned: removedEvents, postSnapshotEventsReplayed: 1, restorePages,
        interruptedRestoreResumed: true, concurrentIngestionRejected: true, concurrentMetrics,validationMetrics,pruneMetrics,
        restoreMetrics:{rowReads,returnedRows,returnedRowBytes,maximumPage},snapshot: exported,
        snapshotDirectory: directory};
      await fs.writeFile(path.join(directory, "qualification.json"), JSON.stringify(evidence, null, 2));
      t.diagnostic(`Qualified ${data.documents.length} real projection rows; recovery evidence ${path.join(directory, "qualification.json")}`);
    } finally {
      if (original) await original.close();
      if (restored) await restored.close();
      for (const database of created) await admin.query(`DROP DATABASE ${database}`);
      await admin.end();
      await fetch(`http://${host}/emulator/v1/projects/${isolatedProject}/databases/(default)/documents`, {method: "DELETE"});
      await deleteApp(app);
      if (!process.env.BS_POSTGIS_REPORT_DIR) await fs.rm(directory, {recursive: true, force: true});
    }
  });
}
