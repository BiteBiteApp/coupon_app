"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const enabled = process.env.RUN_ADMIN_USERS_RECOVERY_EMULATOR === "1";
if (!enabled) {
  test("Admin Users real adapter/wrappers require the explicit local gate", {skip: true}, () => {});
} else {
  // No production fallback, credentials, Auth calls or real secrets.
  const project = "demo-bs-admin-users-recovery";
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:23080");
  assert.equal(process.env.GCLOUD_PROJECT, project);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, project);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(process.env.FIREBASE_CONFIG, undefined);
  process.env.SEARCH_PAGINATION_CURSOR_KEY = "A".repeat(43);
  for (const transport of [require("node:http"), require("node:https")]) {
    const original = transport.request;
    transport.request = function(options, ...rest) {
      const host = typeof options === "string" ? new URL(options).hostname : options.hostname || options.host;
      assert(["127.0.0.1", "localhost"].includes(host), "Non-loopback HTTP blocked");
      return original.call(this, options, ...rest);
    };
  }
  const index = require("../lib/index.js");
  const {getFirestore} = require("firebase-admin/firestore");
  const {getApps, deleteApp} = require("firebase-admin/app");
  const c = require("../lib/admin_user_directory_contract.js");
  const m = require("../lib/admin_user_directory_maintenance.js");
  const p = require("../lib/rating_admin_people_paging.js");
  const recovery = require("../lib/admin_user_directory_recovery.js");
  const db = getFirestore(), adapter = m.createFirestoreAdminUserDirectoryDatabase(db);
  const admin = {uid: "synthetic-admin", token: {email: "schuyler.cole@gmail.com"}};
  const now = new Date("2026-10-07T12:00:00Z");
  const profile = uid => ({userId: uid, displayName: "Synthetic Person", contributionPoints: 17, passwordHash: "private-canary"});
  const review = uid => ({userId: uid, dishId: "dish", restaurantId: "cafe", overallImpression: 8, updatedAt: now});
  const cafe = uid => ({ownerUserId: uid, name: "Synthetic Cafe", city: "Test City", isClaimed: true, isActive: true});
  const event = (parameter, id, before, after, eventId = "event") => ({id: eventId, params: {[parameter]: id}, data: {
    before: {exists: before !== null, data: () => before}, after: {exists: after !== null, data: () => after}}});
  const call = (action, state) => index.verifyAdminUserDirectory.run({auth: admin, data: {schemaVersion: 1, action,
    ...(state ? {passId: state.passId, revision: state.revision} : {})}});
  const search = (criteria, navigation = {}) => index.searchRatingAdminUsersPage.run({auth: admin, data: {
    protocolVersion: "bitestar.page.v1", pageSize: 50, criteria, direction: "first", requestExactCount: true, clientRequestId: "local-proof", ...navigation}});
  async function complete(state) {
    state ??= await call("start");
    for (let i = 0; i < 2000 && state.status === "pending"; i++) state = await call("continue", state);
    assert.equal(state.status, "complete");
    return state;
  }
  test.beforeEach(async () => {
    const result = await fetch(`http://127.0.0.1:23080/emulator/v1/projects/${project}/databases/(default)/documents`, {method: "DELETE"});
    assert.equal(result.status, 200);
  });
  test.after(async () => {await db.terminate(); await Promise.all(getApps().map(deleteApp));});

  test("actual exported twelve wrappers request retry and propagate transient failure", async () => {
    const names = Object.keys(index).filter(name => name.startsWith("maintainAdminUserDirectoryFrom"));
    assert.equal(names.length, 12);
    for (const name of names) assert.equal(index[name].__endpoint.eventTrigger.retry, true, name);
    const original = db.runTransaction, failure = Error("synthetic transaction failure");
    db.runTransaction = async () => {throw failure;};
    try { await assert.rejects(index.maintainAdminUserDirectoryFromUserProfile.run(event("userId", "u", null, profile("u"))), error => error === failure); }
    finally {db.runTransaction = original;}
  });

  test("actual callable guards deny ordinary/unauthenticated callers before reads", async () => {
    const original = db.runTransaction;
    db.runTransaction = async () => {assert.fail("unauthorized read");};
    try {
      for (const auth of [undefined, {uid: "ordinary", token: {email: "ordinary@example.test"}}, {uid: "admin", token: {email: admin.token.email, firebase: {sign_in_provider: "anonymous"}}}]) {
        await assert.rejects(index.verifyAdminUserDirectory.run({auth, data: {schemaVersion: 1, action: "start"}}), error => error.code === "permission-denied");
        await assert.rejects(index.searchRatingAdminUsersPage.run({auth, data: {}}), error => error.code === "permission-denied");
      }
    } finally {db.runTransaction = original;}
  });

  test("original relationship defects through actual wrapper: fenced and malformed owners cannot publish", async () => {
    for (const uid of ["fenced", "bad/uid"]) {
      await db.doc("bitescore_restaurants/cafe").set(cafe(uid));
      await db.doc("private_account_deletions/fenced").set({state: "requested"});
      await index.maintainAdminUserDirectoryFromBiteScoreRestaurant.run(event("restaurantId", "cafe", null, cafe(uid), uid));
      assert.equal((await db.doc(c.adminUserClaimedRestaurantDocumentPath("cafe")).get()).exists, false);
    }
  });

  test("exact whitespace UID survives actual wrapper, Firestore adapter and callable; retained fenced row is invisible", async () => {
    const uid = " exact-user ";
    await db.doc(`user_profiles/${uid}`).set(profile(uid));
    await index.maintainAdminUserDirectoryFromUserProfile.run(event("userId", uid, null, profile(uid)));
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("exact-user")).get()).exists, false);
    let result = await search({mode: "uid", value: uid});
    assert.equal(result.items[0].uid, uid);
    assert.equal(JSON.stringify(result).includes("private-canary"), false);
    await db.doc(`private_account_deletions/${uid}`).set({state: "requested"});
    result = await search({mode: "uid", value: uid}); assert.deepEqual(result.items, []);
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath(uid)).get()).exists, true, "retained row is filtered before cleanup");
    await index.maintainAdminUserDirectoryFromUserProfile.run(event("userId", uid, null, profile(uid), "delayed"));
    assert.equal((await db.doc(c.adminUserWorkPath(uid, "userProfile")).get()).exists, false);
  });

  test("actual manual wrapper discovers pre-checkpoint work after retry expiry, resumes and completes malformed history", {timeout: 120000}, async () => {
    const batch = db.batch();
    batch.set(db.doc("dish_reviews/a-valid-lower"), review("missed"));
    for (let i = 0; i < 80; i++) batch.set(db.doc(`dish_reviews/z-invalid-${i.toString().padStart(3, "0")}`), {userId: "missed", createdAt: now, updatedAt: now});
    batch.set(db.doc("user_profiles/owner"), profile("owner"));
    batch.set(db.doc("bitescore_restaurants/cafe"), cafe("owner"));
    batch.set(db.doc("bitescore_restaurants/cafe2"), cafe("owner"));
    await batch.commit(); // No event delivered, and no checkpoint exists.
    assert.deepEqual((await search({mode: "uid", value: "missed"})).items, []);
    let state = await call("start"), passId = state.passId;
    state = await call("continue", state);
    const [a, b] = await Promise.all([call("continue", state), call("continue", state)]);
    assert.equal(a.revision, b.revision); assert.equal(a.steps, state.steps + 1);
    state = await call("pause", a); assert.equal(state.status, "paused");
    assert.equal((await call("continue", state)).steps, state.steps);
    const updated = (await db.doc(recovery.adminUserVerificationPath).get()).get("updatedAt");
    await call("status"); assert((await db.doc(recovery.adminUserVerificationPath).get()).get("updatedAt").isEqual(updated));
    state = await call("start"); assert.equal(state.passId, passId);
    state = await complete(state); assert.equal(typeof state.lastCompletedAtMillis, "number");
    assert.equal((await search({mode: "uid", value: "missed"})).items[0].uid, "missed");
    const owners = await search({mode: "claimedRestaurant", value: "synthetic"});
    assert.deepEqual(owners.items.map(row => row.uid), ["owner"]);
    assert.equal((await db.doc("user_profiles/owner").get()).get("contributionPoints"), 17);
    assert.equal((await db.collection("bitescore_contribution_point_ledger").get()).empty, true);
    const prior = state.lastCompletedAtMillis;
    state = await call("start"); assert.notEqual(state.passId, passId); assert.equal(state.lastCompletedAtMillis, prior);
  });

  test("actual adapter conflict retries prevent stale generation from publishing after source transfer", {timeout: 120000}, async () => {
    const batch = db.batch();
    for (let i = 0; i < 12; i++) batch.set(db.doc(`dish_reviews/r-${i.toString().padStart(2, "0")}`), review("old"));
    await batch.commit();
    await m.reconcileAdminUserSource(adapter, "dishReview", "old", now);
    const oldGeneration = (await db.doc(c.adminUserWorkPath("old", "dishReview")).get()).get("generation");
    await db.doc("dish_reviews/r-00").set(review("new"));
    await Promise.all([
      m.reconcileAdminUserSource(adapter, "dishReview", "old", now),
      index.maintainAdminUserDirectoryFromDishReview.run(event("reviewId", "r-00", review("old"), review("new"), "transfer")),
    ]);
    assert.notEqual((await db.doc(c.adminUserWorkPath("old", "dishReview")).get()).get("generation"), oldGeneration);
    await complete();
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("new")).get()).exists, true);
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("old")).get()).exists, true, "surviving contribution remains");
  });

  test("actual adapter rolls back publication and resumes its checkpoint after a partial transaction failure", async () => {
    await db.doc("user_profiles/u").set(profile("u"));
    let injected = true;
    const failing = {runTransaction: operation => adapter.runTransaction(tx => operation({...tx, setDocument(path, data) {
      if (injected && path.startsWith("admin_user_directory/")) {injected = false; throw Error("failure after summary staged");}
      tx.setDocument(path, data);
    }}))};
    await assert.rejects(m.reconcileAdminUserSource(failing, "userProfile", "u", now));
    assert.equal((await db.doc(c.adminUserWorkPath("u", "userProfile")).get()).get("state"), "pending");
    assert.equal((await db.doc(c.adminUserSourceSummaryDocumentPath({uid: "u", sourceKind: "userProfile"})).get()).exists, false);
    await m.reconcileAdminUserSource(adapter, "userProfile", "u", now);
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("u")).get()).exists, true);
  });

  test("actual deletion cleanup removes new private UID progress including completed work", async () => {
    const {createAccountDeletionStep} = require("../lib/account_deletion_cleanup.js");
    for (const kind of c.adminUserSourceKinds) await db.doc(c.adminUserWorkPath("deleted", kind)).set({uid: "deleted", state: "complete"});
    const step = createAccountDeletionStep({getIdentity: async () => null, deleteIdentity: async () => assert.fail("Auth mutation")});
    let job = {uid: "deleted", phase: "identity", index: 0};
    for (let i = 0; i < 60 && job.phase === "identity"; i++) job = {...job, ...await step({db, job, assertLease: async () => {}})};
    assert.notEqual(job.phase, "identity");
    for (const kind of c.adminUserSourceKinds) assert.equal((await db.doc(c.adminUserWorkPath("deleted", kind)).get()).exists, false);
  });

  test("actual manual wrapper persists failure without losing cursor and resumes after transient query failure", async () => {
    await db.doc("user_profiles/missed").set(profile("missed"));
    let state = await call("start"); state = await call("continue", state);
    const checkpoint = (await db.doc(recovery.adminUserVerificationPath).get()).data();
    const original = db.runTransaction;
    db.runTransaction = (operation, options) => original.call(db, tx => operation(new Proxy(tx, {get(target, property) {
      if (property === "get") return (...args) => {
        if (typeof args[0].limit === "function") throw Error("synthetic source query failure");
        return target.get(...args);
      };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    }})), options);
    try {state = await call("continue", state);} finally {db.runTransaction = original;}
    assert.equal(state.status, "failed");
    assert.equal(state.lastCompletedAtMillis, null);
    const failed = (await db.doc(recovery.adminUserVerificationPath).get()).data();
    assert.equal(failed.family, checkpoint.family); assert.equal(failed.cursor, checkpoint.cursor);
    state = await call("start"); assert.equal(state.passId, checkpoint.passId);
    await complete(state);
    assert.equal((await search({mode: "uid", value: "missed"})).items[0].uid, "missed");
  });

  test("actual reader preserves 50-row forward/backward paging and exact document-ID order with fenced retained rows", async () => {
    const builders = require("../lib/admin_user_directory_builders.js");
    const batch = db.batch();
    for (let i = 0; i < 53; i++) {
      const uid = `user-${i.toString().padStart(3, "0")}`;
      const summary = builders.buildAdminUserSourceSummary({uid, sourceKind: "userProfile", representative: {id: uid, data: profile(uid)}, now});
      batch.set(db.doc(c.adminUserDirectoryDocumentPath(uid)), builders.buildAdminUserDirectoryDocument({uid, summaries: [summary], now}));
    }
    batch.set(db.doc("private_account_deletions/user-000"), {state: "requested"}); await batch.commit();
    const first = await search({mode: "viewAll"}); assert.equal(first.items.length, 50); assert.equal(first.items[0].uid, "user-001");
    const next = await search({mode: "viewAll"}, {direction: "forward", cursor: first.nextCursor}); assert.equal(next.items.length, 2);
    const previous = await search({mode: "viewAll"}, {direction: "backward", cursor: next.previousCursor});
    assert.deepEqual(previous.items.map(row => row.uid), first.items.map(row => row.uid));
  });
}
