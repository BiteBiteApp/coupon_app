"use strict";

const assert = require("node:assert/strict");
const {createHash, randomBytes} = require("node:crypto");
const test = require("node:test");

function requireSafeEmulator() {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const first = process.env.GCLOUD_PROJECT ?? "";
  const second = process.env.GOOGLE_CLOUD_PROJECT ?? "";
  const match = /^(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/u.exec(host) ??
    /^\[::1\]:([1-9][0-9]{0,4})$/u.exec(host);
  if (!match || Number(match[1]) > 65_535 ||
      (first || second) !== "demo-bs-retention-lifecycle" ||
      (first && second && first !== second) || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Admin retention tests require demo-bs-retention-lifecycle, an explicit loopback emulator and no credential file.");
  }
  return first || second;
}

if (process.env.BITESTAR_ADMIN_RETENTION_EMULATOR_TEST !== "1") {
  test("real Firestore Admin temporary-retention regression requires its local gate", {
    skip: "set BITESTAR_ADMIN_RETENTION_EMULATOR_TEST=1 with the dedicated local emulator",
  }, () => {});
} else {
  const projectId = requireSafeEmulator(); // Before any Firebase import.
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore, Timestamp} = require("firebase-admin/firestore");
  const coupon = require("../lib/coupon_admin_radius_sessions.js");
  const rating = require("../lib/rating_admin_radius_sessions.js");
  const link = require("../lib/admin_link_restaurant_radius_sessions.js");
  const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const branches = [
    {name: "Coupon Admin", source: "biteSaver", sessions: coupon.couponAdminRadiusSessionCollection,
      active: coupon.couponAdminRadiusActiveCollection, create: coupon.createFirestoreCouponAdminRadiusStore},
    {name: "Rating Admin", source: "biteScore", sessions: rating.ratingAdminRadiusSessionCollection,
      active: rating.ratingAdminRadiusActiveCollection, create: rating.createFirestoreRatingAdminRadiusStore},
    {name: "Admin Link", source: "biteScore", sessions: link.adminLinkRestaurantSessionCollection,
      active: link.adminLinkRestaurantActiveCollection, create: link.createFirestoreAdminLinkRestaurantRadiusStore, link: true},
  ];
  for (const branch of branches) {
    test(`real Firestore ${branch.name} expires logically and retains child TTL metadata`, {
      concurrency: false, timeout: 60_000,
    }, async () => {
      const id = "admin_retention_" + randomBytes(12).toString("hex");
      const app = initializeApp({projectId}, id);
      const db = getFirestore(app);
      const store = branch.create(db);
      const createdAtMs = Date.now();
      const session = {
        id, schemaVersion: 1, state: branch.link ? "preparing" : "ready",
        callerBinding: hash([id, "caller"]), queryFingerprint: hash([id, "query"]),
        pageSize: 50, center: {latitude: 28.5383, longitude: -81.3792, displayName: "Synthetic center"},
        radiusMiles: 10, createdAtMs, lastUsedAtMs: createdAtMs,
        idleExpiresAtMs: createdAtMs + 15 * 60_000,
        absoluteExpiresAtMs: createdAtMs + 60 * 60_000,
        leaseToken: null, leaseUntilMs: null, lastCompletedRequestId: null,
        scannedDocumentCount: 0, failureMessage: null,
        ...(branch.link ? {
          orderingVersion: 1, searchInstanceHash: hash([id, "instance"]),
          centerInput: {mode: "location", location: "Synthetic center"},
          normalizedRestaurantName: null, sources: ["biteScore"], biteScoreStatus: "active",
          filterContractVersion: 1, needsQrPreparation: false, leaseGeneration: 0,
          ranges: [{source: "biteScore", collectionName: "bitescore_restaurants", start: "dhw", end: "dhx",
            biteScoreIsActive: true, afterGeohash: null, afterDocumentId: null, exhausted: false}],
        } : {
          source: branch.source, searchMode: "nearbyRadius", status: "active",
          normalizedName: null, nameWords: [], nameAnchor: null, resultCount: 1,
          ranges: [{start: "dhw", end: "dhx", afterGeohash: null, afterDocumentId: null, exhausted: true}],
        }),
      };
      const activeKey = hash([session.callerBinding, session.queryFingerprint,
        ...(branch.link ? [session.searchInstanceHash] : [])]);
      const parent = db.doc(`${branch.sessions}/${id}`);
      const pointer = db.doc(`${branch.active}/${activeKey}`);
      const resultId = hash([id, "result"]);
      const child = parent.collection("results").doc(resultId);
      const result = {id: resultId, source: branch.source, sourceDocumentId: id + "_restaurant",
        normalizedName: "synthetic restaurant", distanceMillimeters: 100,
        expiresAtMs: session.absoluteExpiresAtMs};
      let ownsNamespace = false;
      try {
        assert.equal((await parent.get()).exists, false);
        assert.equal((await pointer.get()).exists, false);
        assert.equal((await parent.collection("results").limit(1).get()).empty, true);
        ownsNamespace = true;
        if (branch.link) {
          await store.acquireInitialSession({activeKey, session, nowMs: createdAtMs});
          const claim = await store.claimSession({sessionId: id, callerBinding: session.callerBinding,
            queryFingerprint: session.queryFingerprint, clientRequestId: id + "_advance",
            leaseToken: id + "_lease", nowMs: createdAtMs});
          assert.equal(claim.status, "claimed");
          await store.finishAdvance({sessionId: id, leaseToken: claim.session.leaseToken,
            leaseGeneration: claim.session.leaseGeneration, clientRequestId: id + "_advance",
            ranges: session.ranges.map(range => ({...range, exhausted: true})),
            documentsRead: 1, state: "ready", results: [result]});
        } else {
          await store.createSession(session);
          await store.writeResults(id, [result]);
        }
        const touch = {sessionId: id, activeKey, callerBinding: session.callerBinding,
          queryFingerprint: session.queryFingerprint, nowMs: Date.now()};
        assert.equal((await store.touchReadySession(touch)).state, "ready");
        const initialParent = (await parent.get()).data();
        const initialPointer = (await pointer.get()).data();
        const materialized = (await parent.collection("results").get()).docs;
        assert.equal(materialized.length, branch.link ? 2 : 1);
        assert.ok(initialParent.expiresAt instanceof Timestamp);
        assert.equal(initialParent.expiresAt.toMillis(), initialParent.idleExpiresAtMs);
        assert.ok(initialPointer.expiresAt instanceof Timestamp);
        for (const doc of materialized) {
          assert.ok(doc.data().expiresAt instanceof Timestamp);
          assert.equal(doc.data().expiresAt.toMillis(), session.absoluteExpiresAtMs);
        }

        // Move only our synthetic clock boundary into the past; do not wait
        // for or claim to simulate asynchronous Firestore TTL deletion.
        const deadline = Date.now() - 60_000;
        await parent.update({idleExpiresAtMs: deadline, expiresAt: Timestamp.fromMillis(deadline)});
        const before = (await parent.get()).data();
        await assert.rejects(store.touchReadySession({...touch, nowMs: Date.now()}),
          error => error.code === "failed-precondition");
        assert.deepEqual((await parent.get()).data(), before);
        assert.equal((await child.get()).exists, true);
        assert.equal((await pointer.get()).exists, true);

        // An actual Firestore parent deletion does not delete its children.
        // This proves why the separate results-group TTL is required.
        await parent.delete();
        assert.equal((await parent.get()).exists, false);
        assert.equal((await child.get()).exists, true);
        assert.equal((await child.get()).data().expiresAt.toMillis(), session.absoluteExpiresAtMs);
      } finally {
        // Delete only children beneath this random test-owned parent plus its
        // exact pointer; never clear a collection or unrelated emulator data.
        try {
          if (ownsNamespace) {
            const children = await parent.collection("results").get();
            const cleanup = db.batch();
            children.docs.forEach(doc => cleanup.delete(doc.ref));
            cleanup.delete(parent); cleanup.delete(pointer);
            await cleanup.commit();
            assert.equal((await parent.get()).exists, false);
            assert.equal((await pointer.get()).exists, false);
            assert.equal((await parent.collection("results").get()).empty, true);
          }
        } finally {
          await db.terminate();
          await deleteApp(app);
        }
      }
    });
  }
}
