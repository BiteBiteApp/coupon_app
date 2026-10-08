"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
if (process.env.RUN_ADMIN_USERS_RECOVERY_EMULATOR !== "1") {
  test("Admin Users event completion needs explicit local emulator gate", {skip: true}, () => {});
} else {
  const project = "demo-bs-admin-users-recovery";
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:23080");
  assert.equal(process.env.GCLOUD_PROJECT, project);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, project);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(process.env.FIREBASE_CONFIG, undefined);
  // Reject non-local sockets, including the Firestore gRPC transport.
  const net = require("node:net"), connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function(...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host = typeof options === "object" ? options.host : args[1];
    assert(["127.0.0.1", "localhost", "::1"].includes(host), "Non-loopback socket blocked");
    return connect.apply(this, args);
  };
  process.env.SEARCH_PAGINATION_CURSOR_KEY = "A".repeat(43);
  const index = require("../lib/index.js");
  const m = require("../lib/admin_user_directory_maintenance.js");
  const c = require("../lib/admin_user_directory_contract.js");
  const {getFirestore} = require("firebase-admin/firestore");
  const {getApps, deleteApp} = require("firebase-admin/app");
  const db = getFirestore(), adapter = m.createFirestoreAdminUserDirectoryDatabase(db);
  const originalTransaction = db.runTransaction;
  const now = new Date("2026-10-08T04:00:00Z"), results = [];
  const review = (uid = "u", extra = {}) => ({userId: uid, dishId: "dish", restaurantId: "cafe", overallImpression: 8, updatedAt: now, ...extra});
  const event = (id = "r-00000", eventId = "A", before = null, after = review(), param = "reviewId") => ({
    id: eventId, params: {[param]: id}, data: {before: {exists: before !== null, data: () => before}, after: {exists: after !== null, data: () => after}}});
  const trigger = index.maintainAdminUserDirectoryFromDishReview;
  const stored = async(uid = "u") => (await db.doc(c.adminUserWorkPath(uid, "dishReview")).get()).data();
  const summary = async(uid = "u") => (await db.doc(c.adminUserSourceSummaryDocumentPath({uid, sourceKind: "dishReview"})).get()).data();
  async function seed(count, uid = "u") {
    for (let start = 0; start < count; start += 400) {
      const batch = db.batch();
      for (let i = start; i < Math.min(count, start + 400); i++) batch.set(db.doc(`dish_reviews/r-${String(i).padStart(5, "0")}`), review(uid));
      await batch.commit();
    }
  }
  async function retry(e, invoke = input => trigger.run(input)) {
    for (let i = 0; i < 100; i++) {
      try {await invoke(typeof e === "function" ? e(i) : e); return i + 1;}
      catch (error) {assert(error instanceof m.AdminUserDirectoryEventPendingError);}
    }
    assert.fail("event did not finish within fixture delivery limit");
  }
  async function measure(label, action) {
    const counts = {label, invocations: 0, resolved: 0, rejectedPending: 0, executions: 0, attempts: 0,
      pointReads: 0, queryCalls: 0, queryRows: 0, emptyQueries: 0, committedSets: 0, committedDeletes: 0};
    db.runTransaction = async function(operation, options) {
      counts.executions++; let writes;
      const result = await originalTransaction.call(this, async tx => {
        counts.attempts++; writes = [];
        return operation(new Proxy(tx, {get(target, name) {
          if (name === "get") return async(...args) => {
            const value = await target.get(...args);
            if (Array.isArray(value.docs)) {counts.queryCalls++; counts.queryRows += value.docs.length; if (!value.docs.length) counts.emptyQueries++;}
            else counts.pointReads++;
            return value;
          };
          if (["set", "delete", "update"].includes(name)) return (...args) => {writes.push(name); return target[name](...args);};
          const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
        }}));
      }, options);
      for (const name of writes) name === "delete" ? counts.committedDeletes++ : counts.committedSets++;
      return result;
    };
    const invoke = async(e, wrapper = trigger) => {
      counts.invocations++;
      try {await wrapper.run(e); counts.resolved++; return true;}
      catch (error) {assert(error instanceof m.AdminUserDirectoryEventPendingError); counts.rejectedPending++; throw error;}
    };
    try {await action(invoke);} finally {db.runTransaction = originalTransaction;}
    counts.logicalReads = counts.pointReads + counts.queryRows + counts.emptyQueries;
    counts.committedWrites = counts.committedSets + counts.committedDeletes;
    results.push(counts);
  }
  test.beforeEach(async () => {
    const result = await fetch(`http://127.0.0.1:23080/emulator/v1/projects/${project}/databases/(default)/documents`, {method: "DELETE"});
    assert.equal(result.status, 200);
  });
  test.after(async () => {
    if (process.env.ADMIN_USERS_EVENT_EVIDENCE_PATH) require("node:fs").writeFileSync(process.env.ADMIN_USERS_EVENT_EVIDENCE_PATH,
      JSON.stringify({scope: "actual exported .run wrappers; loopback real Firestore adapter; deliberately supplied retry deliveries, not live transport", results}, null, 2) + "\n");
    await db.terminate(); await Promise.all(getApps().map(deleteApp));
  });

  test("actual wrappers keep retry metadata and normal profiles/accounts complete with safe totals", async () => {
    const names = Object.keys(index).filter(name => name.startsWith("maintainAdminUserDirectoryFrom"));
    assert.equal(names.length, 12);
    for (const name of names) assert.equal(index[name].__endpoint.eventTrigger.retry, true);
    for (const [kind, collection, param, wrapper, data] of [
      ["userProfile", "user_profiles", "userId", index.maintainAdminUserDirectoryFromUserProfile,
        {userId: "u", displayName: "Synthetic", contributionPoints: 17, passwordHash: "private-canary"}],
      ["restaurantAccount", "restaurant_accounts", "restaurantAccountId", index.maintainAdminUserDirectoryFromRestaurantAccount,
        {uid: "u", restaurantName: "Synthetic", email: "private@example.test"}],
    ]) {
      await db.doc(`${collection}/u`).set(data);
      await measure(kind, invoke => invoke(event("u", kind, null, data, param), wrapper));
      assert.equal((await db.doc(c.adminUserWorkPath("u", kind)).get()).get("state"), "complete");
    }
    assert.equal((await db.doc("user_profiles/u").get()).get("contributionPoints"), 17);
    assert.equal((await db.collection("bitescore_contribution_point_ledger").get()).empty, true);
    const row = (await db.doc(c.adminUserDirectoryDocumentPath("u")).get()).data();
    assert.equal(row.contributionPoints, 17); assert.equal(JSON.stringify(row).includes("private-canary"), false);
  });

  for (const count of [4, 5, 6, 25, 1000]) test(`actual event complete-update cost: ${count} reviews`, {timeout: 120000}, async () => {
    await seed(count);
    await measure(`reviews=${count}`, invoke => retry(event(), invoke));
    const counts = results.at(-1);
    assert.equal(counts.resolved, 1); assert.equal(counts.queryCalls, Math.floor(count / 5) + 1);
    assert.equal(counts.queryRows, count); assert.equal((await stored()).state, "complete");
    if (count < 100) assert.equal(counts.invocations, 1);
    else {assert(counts.invocations >= 11); assert.equal(counts.rejectedPending, counts.invocations - 1);}
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("u")).get()).get("activityReviews"), true);
  });

  test("actual proposal completes both attribution scans with primary and legacy identities", async () => {
    const data = {userId: "u", createdByUserId: "u", type: "edit", restaurantId: "cafe", sourceDishId: "dish"};
    await db.doc("dish_edit_proposals/p").set(data);
    await measure("proposal-two-fields", invoke => invoke(event("p", "P", null, data, "proposalId"), index.maintainAdminUserDirectoryFromDishEditProposal));
    assert.equal(results.at(-1).queryCalls, 2); assert.equal(results.at(-1).queryRows, 2);
    assert.equal((await db.doc(c.adminUserWorkPath("u", "dishEditProposal")).get()).get("state"), "complete");
    const legacy = {...data, createdByUserId: "legacy"}; delete legacy.userId;
    await db.doc("dish_edit_proposals/legacy").set(legacy);
    await index.maintainAdminUserDirectoryFromDishEditProposal.run(event("legacy", "L", null, legacy, "proposalId"));
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("legacy")).get()).exists, true);
  });

  test("actual all-invalid and mixed malformed histories complete without endless retries", async () => {
    const batch = db.batch();
    for (const uid of ["invalid", "mixed"]) for (let i = 0; i < 80; i++) batch.set(db.doc(`dish_reviews/${uid}-z-${i}`), {userId: uid});
    batch.set(db.doc("dish_reviews/a-valid"), review("mixed")); await batch.commit();
    for (const uid of ["invalid", "mixed"]) {
      await trigger.run(event(`${uid}-z-0`, uid, null, {userId: uid}));
      assert.equal((await stored(uid)).state, "complete");
      assert.equal((await db.doc(c.adminUserDirectoryDocumentPath(uid)).get()).exists, uid === "mixed");
    }
    await trigger.run(event("bad/id", "bad", null, {userId: "bad/uid"}));
  });

  test("actual event interruption rolls back failing transaction and resumes saved progress", async () => {
    await seed(25); let calls = 0; const failure = Error("synthetic write interruption");
    db.runTransaction = (operation, options) => originalTransaction.call(db, async tx => {
      const value = await operation(tx);
      if (++calls === 4) throw failure;
      return value;
    }, options);
    try {await assert.rejects(trigger.run(event()), error => error === failure);} finally {db.runTransaction = originalTransaction;}
    const checkpoint = await stored(); assert.equal(checkpoint.cursor, "r-00009"); assert.equal(checkpoint.state, "pending");
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("u")).get()).exists, false);
    await trigger.run(event()); assert.equal((await stored()).generation, checkpoint.generation);
    assert.equal((await stored()).state, "complete");
  });

  test("actual alternating and delayed deliveries finish1000 without resetting pending generation", {timeout: 120000}, async () => {
    await seed(1000); let generation, deliveries = 0;
    await retry(i => event(i % 2 ? "r-00001" : "r-00000", i % 2 ? "older-B" : "newer-A"), async e => {
      deliveries++;
      try {await trigger.run(e);} finally {
        const current = await stored(); generation ??= current.generation; assert.equal(current.generation, generation);
      }
    });
    assert(deliveries >= 11);
    const fingerprint = (await summary()).sourceFingerprint;
    await retry(event("r-00000", "delayed", null, review("u", {updatedAt: new Date(0)})));
    assert.equal((await summary()).sourceFingerprint, fingerprint);
  });

  test("real transaction atomic fold protects new behind-cursor source while competing worker finishes", async () => {
    await seed(12); await m.reconcileAdminUserSource(adapter, "dishReview", "u", now);
    const generation = (await stored()).generation, newer = new Date(now.getTime() + 100000);
    await db.doc("dish_reviews/a-new").set(review("u", {updatedAt: newer}));
    let release, registered, first = true;
    const pause = new Promise(resolve => {release = resolve;}), ready = new Promise(resolve => {registered = resolve;});
    db.runTransaction = async(operation, options) => {
      const result = await originalTransaction.call(db, operation, options);
      if (first) {first = false; registered(); await pause;}
      return result;
    };
    const delivery = trigger.run(event("a-new", "B", null, review("u", {updatedAt: newer})));
    try {
      await ready;
      while ((await stored()).state === "pending") await m.reconcileAdminUserSource(adapter, "dishReview", "u", now);
      release(); await delivery;
    } finally {release(); db.runTransaction = originalTransaction;}
    assert.equal((await stored()).generation, generation);
    assert.equal((await summary()).latestActivityAt.toMillis(), newer.getTime());
  });

  test("actual concurrent wrappers and a source reassignment retain surviving contributions", async () => {
    await seed(25, "old"); await m.reconcileAdminUserSource(adapter, "dishReview", "old", now);
    await db.doc("dish_reviews/r-00000").set(review("new"));
    await Promise.all([
      trigger.run(event("r-00000", "transfer", review("old"), review("new"))),
      trigger.run(event("r-00001", "old-delayed", null, review("old"))),
    ]);
    for (const uid of ["old", "new"]) {
      assert.equal((await stored(uid)).state, "complete");
      assert.equal((await db.doc(c.adminUserDirectoryDocumentPath(uid)).get()).exists, true);
    }
  });

  test("actual failed fence read rejects; fence between steps prevents publication", async () => {
    await seed(25); let calls = 0;
    db.runTransaction = (operation, options) => originalTransaction.call(db, tx => operation(new Proxy(tx, {get(target, name) {
      if (name === "get") return (...args) => {
        if (args[0].path?.startsWith("private_account_deletions/")) throw Error("synthetic fence read failure");
        return target.get(...args);
      };
      const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
    }})), options);
    try {await assert.rejects(trigger.run(event()), /synthetic fence read failure/);} finally {db.runTransaction = originalTransaction;}
    assert.equal(await stored(), undefined);
    db.runTransaction = async(operation, options) => {
      const value = await originalTransaction.call(db, operation, options);
      if (++calls === 2) await db.doc("private_account_deletions/u").set({state: "requested"});
      return value;
    };
    try {await trigger.run(event());} finally {db.runTransaction = originalTransaction;}
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("u")).get()).exists, false);
    assert.equal(await stored(), undefined);
  });

  test("modeled finite retry expiry leaves honest pending state; actual manual Verify/Resume finishes", {timeout: 120000}, async () => {
    await seed(1000); await assert.rejects(trigger.run(event()), error => error instanceof m.AdminUserDirectoryEventPendingError);
    assert.equal((await stored()).state, "pending");
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("u")).get()).exists, false);
    // Stop supplying event deliveries, modeling expiry; no claim of live expiry.
    const auth = {uid: "synthetic-admin", token: {email: "schuyler.cole@gmail.com"}};
    const call = (action, state) => index.verifyAdminUserDirectory.run({auth, data: {schemaVersion: 1, action,
      ...(state ? {passId: state.passId, revision: state.revision} : {})}});
    let state = await call("start");
    state = await call("continue", state); assert.equal(state.status, "pending");
    state = await call("pause", state); assert.equal(state.status, "paused");
    const passId = state.passId; state = await call("start"); assert.equal(state.passId, passId);
    for (let i = 0; i < 2000 && state.status === "pending"; i++) state = await call("continue", state);
    assert.equal(state.status, "complete"); assert.equal((await stored()).state, "complete");
    assert.equal((await db.doc(c.adminUserDirectoryDocumentPath("u")).get()).get("activityReviews"), true);
  });
}
