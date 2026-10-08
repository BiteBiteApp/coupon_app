"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {AdminUserMemoryDatabase: Database} = require("./helpers/admin_user_memory_database.js");
const m = require("../lib/admin_user_directory_maintenance.js");
const c = require("../lib/admin_user_directory_contract.js");
const b = require("../lib/admin_user_directory_builders.js");
const {verifyAdminUserDirectoryHandler: verify, adminUserVerificationPath} = require("../lib/admin_user_directory_recovery.js");
const now = new Date("2026-10-07T05:00:00Z");
const review = (uid = "u", extra = {}) => ({userId: uid, dishId: "dish", restaurantId: "cafe", overallImpression: 9, updatedAt: now, ...extra});
const cafe = uid => ({ownerUserId: uid, name: "Synthetic Cafe", city: "Test City", isClaimed: true, isActive: true});
const row = uid => c.adminUserDirectoryDocumentPath(uid);
async function finish(db, kind = "dishReview", uid = "u") {
  for (let i = 0; i < 100; i++) {
    const result = await m.reconcileAdminUserSource(db, kind, uid, now);
    if (result.state === "complete") return result;
    assert.equal(result.sourcePresent, undefined);
    assert.equal(result.summaryDeleted, false);
  }
  assert.fail("progress did not terminate");
}
async function request(db, action, state, time = now) {
  // These regressions exercise atomic-step interleavings. Expire the admission
  // budget after one step; separate efficiency tests exercise full bursts.
  let tick = 0;
  return verify(db, {schemaVersion: 1, action, ...(state ? {passId: state.passId, revision: state.revision} : {})}, time,
    {monotonicNow: () => tick++ * 3000});
}
async function finishVerification(db, state) {
  state ??= await request(db, "start");
  for (let i = 0; i < 2000 && state.status === "pending"; i++) state = await request(db, "continue", state);
  assert.equal(state.status, "complete");
  return state;
}

test("exact supported UID survives end-to-end; malformed present fields never fall back", async () => {
  for (const uid of [" exact ", "é", " ", "a:b", "x".repeat(128)]) {
    assert.equal(c.exactAdminUserUid(uid), uid);
    assert.equal(c.adminUserDirectoryDocumentPath(uid), "admin_user_directory/" + uid);
    assert.equal(b.effectiveAdminUserSourceUid("dishReview", "r", {userId: uid}), uid);
    const db = new Database({["user_profiles/" + uid]: {userId: uid, displayName: "Synthetic"}});
    await finish(db, "userProfile", uid);
    assert.equal(db.records.get(row(uid)).uid, uid);
  }
  for (const uid of ["", "bad/uid", ".", "..", "x\u0000", "x".repeat(129), 7]) {
    assert.equal(c.exactAdminUserUid(uid), null);
    assert.equal(b.effectiveAdminUserSourceUid("userProfile", "fallback", {userId: uid}), null);
    assert.equal(b.effectiveAdminUserSourceUid("dishEditProposal", "p", {userId: uid, createdByUserId: "fallback"}), null);
  }
  assert.equal(b.effectiveAdminUserSourceUid("restaurantAccount", "fallback", {}), "fallback");
  assert.equal(b.effectiveAdminUserSourceUid("dishEditProposal", "p", {createdByUserId: "legacy"}), "legacy");
});

test("80 malformed records cannot hide a valid lower record; budget means pending", async () => {
  const initial = {"dish_reviews/a-valid-lower": review()};
  for (let i = 0; i < 80; i++) initial[`dish_reviews/z-invalid-${String(i).padStart(3, "0")}`] = {userId: "u", createdAt: now, updatedAt: now};
  const db = new Database(initial);
  const first = await m.reconcileAdminUserSource(db, "dishReview", "u", now);
  assert.equal(first.state, "pending"); assert.equal(first.sourcePresent, undefined);
  assert.equal(db.records.has(row("u")), false);
  await finish(db);
  assert.equal(db.records.get(row("u")).activityReviews, true);
  assert(db.operations.filter(x => x.operation === "query").every(x => x.query.limit === 5));
  assert(db.operations.some(x => x.query?.startAfter));
});

test("all invalid including an exact page multiple reaches absence only at exhaustion", async () => {
  const db = new Database({"dish_reviews/old": review()}); await finish(db);
  db.records.delete("dish_reviews/old");
  for (let i = 0; i < 10; i++) db.records.set(`dish_reviews/bad-${i}`, {userId: "u"});
  assert.equal((await m.reconcileAdminUserSource(db, "dishReview", "u", now)).state, "pending");
  assert.equal(db.records.has(row("u")), true);
  const end = await finish(db); assert.equal(end.sourcePresent, false); assert.equal(db.records.has(row("u")), false);
});

test("candidate deletion or mutation before finalization restarts instead of publishing cached data", async () => {
  for (const mutation of ["delete", "change", "uid"]) {
    const initial = {"dish_reviews/z-winner": review()};
    for (let i = 0; i < 4; i++) initial[`dish_reviews/a-${i}`] = {userId: "u"};
    const db = new Database(initial);
    await m.reconcileAdminUserSource(db, "dishReview", "u", now);
    if (mutation === "delete") db.records.delete("dish_reviews/z-winner");
    else db.records.set("dish_reviews/z-winner", mutation === "uid" ? review("other") : {userId: "u"});
    const restart = await m.reconcileAdminUserSource(db, "dishReview", "u", now);
    assert.equal(restart.state, "pending");
    await finish(db); assert.equal(db.records.has(row("u")), false);
  }
});

test("scanned invalid row becomes valid and insertion behind cursor: event invalidates generation", async () => {
  const initial = {};
  for (let i = 0; i < 12; i++) initial[`dish_reviews/r-${String(i).padStart(2, "0")}`] = {userId: "u"};
  const db = new Database(initial);
  await m.reconcileAdminUserSource(db, "dishReview", "u", now);
  const beforeGeneration = db.records.get(m.adminUserWorkPath("u", "dishReview")).generation;
  db.records.set("dish_reviews/r-00", review()); db.records.set("dish_reviews/a-new", review());
  await m.handleAdminUserSourceWrite(db, {sourceKind: "dishReview", sourceDocumentId: "r-00", before: {userId: "u"}, after: review(), now, eventId: "change"});
  assert.notEqual(db.records.get(m.adminUserWorkPath("u", "dishReview")).generation, beforeGeneration);
  await finish(db); assert.equal(db.records.get(row("u")).activityReviews, true);
});

test("two workers and reversed duplicate events converge from current source without point writes", async () => {
  const db = new Database({"dish_reviews/r": review("new"), "user_profiles/new": {userId: "new", contributionPoints: 17, displayName: "Synthetic"}});
  await Promise.all([finish(db, "userProfile", "new"), finish(db, "dishReview", "new")]);
  for (const [before, after, eventId] of [[review("old"), review("new"), "new"], [null, review("old"), "old"], [review("old"), review("new"), "new"]]) {
    await m.handleAdminUserSourceWrite(db, {sourceKind: "dishReview", sourceDocumentId: "r", before, after, eventId, now});
  }
  assert.equal(db.records.has(row("old")), false);
  assert.equal(db.records.get(row("new")).contributionPoints, 17);
  assert.deepEqual(db.records.get(row("new")).sourceKinds, ["userProfile", "dishReview"]);
  assert(db.operations.filter(x => x.operation === "set" || x.operation === "delete").every(x => x.path.startsWith("admin_user_")));
});

test("noncanonical same-kind direct sources are deterministic and preserve surviving contribution", async () => {
  const db = new Database({"user_profiles/a": {userId: "u", displayName: "First"}, "user_profiles/z": {userId: "u", displayName: "Last"}});
  await finish(db, "userProfile"); assert.equal(db.records.get(row("u")).displayName, "Last");
  db.records.delete("user_profiles/z");
  await m.handleAdminUserSourceWrite(db, {sourceKind: "userProfile", sourceDocumentId: "z", before: {userId: "u"}, after: null, now});
  assert.equal(db.records.get(row("u")).displayName, "First");
});

test("fences remove directory, all progress and relationships; malformed owner cannot publish", async () => {
  for (const uid of ["u", "bad/uid"]) {
    const db = new Database({"bitescore_restaurants/cafe": cafe(uid), "private_account_deletions/u": {state: "requested"}});
    await m.handleAdminUserSourceWrite(db, {sourceKind: "biteScoreRestaurant", sourceDocumentId: "cafe", before: null, after: cafe(uid), now});
    assert.equal(db.records.has(c.adminUserClaimedRestaurantDocumentPath("cafe")), false);
    assert.equal(db.records.has(row("u")), false);
    for (const kind of c.adminUserSourceKinds) assert.equal(db.records.has(m.adminUserWorkPath("u", kind)), false);
  }
  const db = new Database({"dish_reviews/r": review()}); await finish(db);
  db.records.set("private_account_deletions/u", {state: "requested"});
  await finish(db);
  assert.equal(db.records.has(row("u")), false); assert.equal(db.records.has(m.adminUserWorkPath("u", "dishReview")), false);
});

test("failed fence reads reject relationships and source progress without any writes", async () => {
  const db = new Database({"bitescore_restaurants/cafe": cafe("u")}); db.failRead = path => path.startsWith("private_account_deletions/");
  await assert.rejects(m.reconcileAdminUserClaimedRestaurant(db, "cafe", now));
  await assert.rejects(m.reconcileAdminUserSource(db, "biteScoreRestaurant", "u", now));
  assert(!db.operations.some(x => x.operation === "set"));
});

test("ownership creation transfer removal preserve other sources and one stable relationship", async () => {
  const db = new Database({"bitescore_restaurants/cafe": cafe("a"), "user_profiles/a": {userId: "a", displayName: "A"}});
  await finish(db, "userProfile", "a");
  for (const [before, after] of [[null, cafe("a")], [cafe("a"), cafe("b")], [cafe("b"), null]]) {
    if (after) db.records.set("bitescore_restaurants/cafe", after); else db.records.delete("bitescore_restaurants/cafe");
    await m.handleAdminUserSourceWrite(db, {sourceKind: "biteScoreRestaurant", sourceDocumentId: "cafe", before, after, now});
  }
  assert.equal(db.records.has(c.adminUserClaimedRestaurantDocumentPath("cafe")), false);
  assert.deepEqual(db.records.get(row("a")).sourceKinds, ["userProfile"]);
  assert.equal(db.records.has(row("b")), false);
});

test("manual pass discovers a brand-new identity with no checkpoint and repairs stale derived state", async () => {
  const db = new Database({"dish_reviews/r": review("missed"), "user_profiles/stale": {userId: "stale", displayName: "Old"}});
  await finish(db, "userProfile", "stale"); db.records.delete("user_profiles/stale");
  assert.equal(db.records.has(m.adminUserWorkPath("missed", "dishReview")), false);
  const state = await finishVerification(db); assert.equal(state.lastCompletedAtMillis, now.getTime());
  assert.equal(db.records.get(row("missed")).activityReviews, true); assert.equal(db.records.has(row("stale")), false);
  assert(db.operations.filter(x => x.operation === "query").every(x => x.query.limit <= 5));
});

test("pause/close equivalent sends no work, resumes same pass; duplicate concurrent batch is idempotent", async () => {
  const db = new Database({"user_profiles/u": {userId: "u", displayName: "Synthetic"}});
  let state = await request(db, "start"); const id = state.passId;
  const [a, bResult] = await Promise.all([request(db, "continue", state), request(db, "continue", state)]);
  assert.equal(a.revision, bResult.revision); assert.equal(a.steps, 1);
  state = await request(db, "pause", a);
  const paused = await request(db, "continue", state); assert.equal(paused.status, "paused"); assert.equal(paused.steps, state.steps);
  const stored = structuredClone(db.records.get(adminUserVerificationPath));
  await request(db, "status"); assert.deepEqual(db.records.get(adminUserVerificationPath), stored);
  state = await request(db, "start"); assert.equal(state.passId, id);
  await finishVerification(db, state);
});

test("failure after checkpoint marks resumable failure; retry-expiry equivalent needs only foreground requests", async () => {
  const db = new Database({"dish_reviews/r": review()});
  let state = await request(db, "start"); state = await request(db, "continue", state);
  const before = db.records.get(adminUserVerificationPath);
  db.failRead = path => path === "user_profiles";
  state = await request(db, "continue", state); assert.equal(state.status, "failed");
  assert.equal(db.records.get(adminUserVerificationPath).family, before.family);
  db.failRead = null;
  state = await request(db, "start", undefined, new Date(now.getTime() + 3 * 86400000));
  assert.equal(state.passId, before.passId);
  await finishVerification(db, state); assert.equal(db.records.get(row("u")).activityReviews, true);
});

test("a later verification rechecks a previously invalid scanned row without any delivered event", async () => {
  const db = new Database({"dish_reviews/r": {userId: "u"}});
  await finishVerification(db); assert.equal(db.records.has(row("u")), false);
  db.records.set("dish_reviews/r", review());
  await finishVerification(db); assert.equal(db.records.get(row("u")).activityReviews, true);
});

test("manual pass coalesces same UID/kind and drains event invalidation behind completed work cursor", async () => {
  const db = new Database({"dish_reviews/a": review(), "dish_reviews/b": review()});
  let state = await request(db, "start");
  while (state.phase !== "reconciling") state = await request(db, "continue", state);
  const generation = db.records.get(m.adminUserWorkPath("u", "dishReview")).generation;
  state = await request(db, "continue", state);
  assert.equal(db.records.get(m.adminUserWorkPath("u", "dishReview")).generation, generation);
  db.records.set("dish_reviews/b", review("v"));
  await m.handleAdminUserSourceWrite(db, {sourceKind: "dishReview", sourceDocumentId: "b", before: review(), after: review("v"), eventId: "transfer", now});
  await finishVerification(db, state);
  assert(db.records.has(row("u"))); assert(db.records.has(row("v")));
});

module.exports = {Database, request, finishVerification, review, cafe, now};

test("a full discovery page of fenced derived users coalesces cleanup below transaction limits", async () => {
  const db = new Database();
  for (let i = 0; i < 5; i++) {
    const uid = `fenced-${i}`;
    db.records.set(row(uid), {uid});
    db.records.set(`private_account_deletions/${uid}`, {state: "requested"});
    for (const kind of c.adminUserSourceKinds) db.records.set(c.adminUserWorkPath(uid, kind), {sensitive: true});
  }
  await finishVerification(db);
  const writes = new Map();
  for (const op of db.operations.filter(x => x.operation === "delete" || x.operation === "set")) writes.set(op.transactionId, (writes.get(op.transactionId) ?? 0) + 1);
  assert.equal(Math.max(...writes.values()), 126); // 5 × (12 summaries + 12 work + directory), control.
  assert.equal([...db.records.keys()].filter(path => path.includes("/auw_")).length, 0);
});

test("progress is byte bounded and stores witnesses without source payloads", async () => {
  const db = new Database();
  for (let i = 0; i < 5; i++) db.records.set(`dish_reviews/r-${i}`, review("u", {notes: "large-source-content".repeat(10000)}));
  await m.reconcileAdminUserSource(db, "dishReview", "u", now);
  const stored = db.records.get(c.adminUserWorkPath("u", "dishReview"));
  assert.equal(stored.state, "pending");
  assert(Buffer.byteLength(JSON.stringify(stored)) < 2048);
  assert.equal(JSON.stringify(stored).includes("large-source-content"), false);
  await assert.rejects(db.runTransaction(tx => m.setAdminUserProgress(tx, c.adminUserWorkPath("u", "dishReview"), {...stored, unexpected: "x".repeat(c.maximumAdminUserProgressBytes)})));
  assert.deepEqual(db.records.get(c.adminUserWorkPath("u", "dishReview")), stored);
});

test("exact restaurant IDs stay distinct and a missed deletion is discovered without aliasing", async () => {
  const db = new Database({"user_profiles/u": {userId: "u", displayName: "Synthetic"},
    "bitescore_restaurants/ cafe ": cafe("u"), "bitescore_restaurants/cafe": cafe("u")});
  await finishVerification(db);
  const exact = c.adminUserClaimedRestaurantDocumentPath(" cafe "), alias = c.adminUserClaimedRestaurantDocumentPath("cafe");
  assert.equal(db.records.get(exact).sourceRestaurantId, " cafe ");
  assert.equal(db.records.get(alias).sourceRestaurantId, "cafe");
  db.records.delete("bitescore_restaurants/ cafe "); // No deletion event delivered.
  await finishVerification(db);
  assert.equal(db.records.has(exact), false); assert.equal(db.records.has(alias), true);
  assert.equal(db.records.has(row("u")), true);
});

test("blank supported UID has a safe display fallback and is searchable without breaking View All", async () => {
  const {searchRatingAdminUsersPageHandler: search} = require("../lib/rating_admin_people_paging.js");
  const db = new Database({"user_profiles/ ": {userId: " "}});
  await finishVerification(db);
  const directory = db.records.get(row(" "));
  assert.equal(directory.uid, " "); assert.equal(directory.displayName, "Unnamed user");
  assert.equal(directory.userPointsDisplayName, "Unnamed user");
  const reader = {
    getDocuments: async paths => paths.filter(path => db.records.has(path)).map(path => ({id: path.split("/").at(-1), data: db.records.get(path)})),
    queryDocuments: async query => query.collectionPath === c.adminUserDirectoryCollection ? [{id: " ", data: directory}] : [],
  };
  for (const criteria of [{mode: "uid", value: " "}, {mode: "viewAll"}]) {
    const result = await search({protocolVersion: "bitestar.page.v1", pageSize: 50, direction: "first", requestExactCount: true, clientRequestId: "blank-uid", criteria},
      {database: reader, adminUid: "admin", cursorSecret: "A".repeat(43)});
    assert.equal(result.items[0].uid, " "); assert.equal(result.items[0].displayName, "Unnamed user");
  }
});
