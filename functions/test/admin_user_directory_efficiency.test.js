"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {AdminUserMemoryDatabase: Database} = require("./helpers/admin_user_memory_database.js");
const r = require("../lib/admin_user_directory_recovery.js");
const m = require("../lib/admin_user_directory_maintenance.js");
const c = require("../lib/admin_user_directory_contract.js");
const now = new Date("2026-10-07T00:00:00Z");
const profile = uid => ({userId: uid, displayName: "Synthetic", contributionPoints: 17});
const cafe = owner => ({name: "Synthetic Cafe", city: "Test City", ownerUserId: owner, isClaimed: true, isActive: true});
const req = (db, action, state, execution = {monotonicNow: () => 0}) => r.verifyAdminUserDirectoryHandler(db,
  {schemaVersion: 1, action, ...(state ? {passId: state.passId, revision: state.revision} : {})}, now, execution);
const single = (db, action, state) => {let tick = 0; return req(db, action, state, {monotonicNow: () => tick++ * 3000});};
async function complete(db, state) {
  state ??= await req(db, "start");
  for (let i = 0; i < 1000 && state.status === "pending"; i++) state = await req(db, "continue", state);
  assert.equal(state.status, "complete"); return state;
}
async function discover(db) {
  let s = await req(db, "start");
  while (s.phase !== "reconciling") s = await single(db, "continue", s);
  return s;
}
const many = () => new Database(Object.fromEntries(Array.from({length: 40}, (_, i) => [`user_profiles/u-${i}`, profile(`u-${i}`)])));
function afterCommit(db, hook) {return {runTransaction: async op => {const result = await db.runTransaction(op); await hook(); return result;}};}

for (const [label, override, expected] of [
  ["valid", {}, ["userProfile"]],
  ["duplicate", {sourceKinds: ["userProfile", "userProfile"]}, ["userProfile"]],
  ["missing", {sourceKinds: undefined}, c.adminUserSourceKinds],
  ["empty", {sourceKinds: []}, c.adminUserSourceKinds],
  ["unknown", {sourceKinds: ["futureKind"]}, c.adminUserSourceKinds],
  ["wrong type", {sourceKinds: "userProfile"}, c.adminUserSourceKinds],
  ["wrong version", {directoryVersion: "old"}, c.adminUserSourceKinds],
  ["wrong UID", {uid: "alias"}, c.adminUserSourceKinds],
  ["oversized", {sourceKinds: Array(13).fill("userProfile")}, c.adminUserSourceKinds],
]) test(`recorded kind hint ${label} preserves conservative registration`, async () => {
  const uid = " exact ";
  const db = new Database({[c.adminUserDirectoryDocumentPath(uid)]: {directoryVersion: c.adminUserDirectoryVersion, uid, sourceKinds: ["userProfile"], ...override}});
  const state = await discover(db);
  const scopes = [...db.records.values()].filter(x => x.workType === "source");
  assert.deepEqual(scopes.map(x => x.sourceKind).sort(), [...expected].sort());
  assert(scopes.every(x => x.uid === uid));
  await complete(db, state);
  assert(!db.records.has(c.adminUserDirectoryDocumentPath(uid)), "directory-only orphan is removed");
});

test("incomplete valid hints cannot hide a new source or a stale omitted summary", async () => {
  const db = new Database({"user_profiles/u": profile("u"), "public_reviewer_profiles/u": profile("u")});
  await complete(db);
  const path = c.adminUserDirectoryDocumentPath("u");
  db.records.set(path, {...db.records.get(path), sourceKinds: ["userProfile"]});
  db.records.delete("public_reviewer_profiles/u"); // No event: summary census must find omitted stale kind.
  db.records.set("dish_reviews/r", {userId: "u", dishId: "d", restaurantId: "c", overallImpression: 8}); // No prior checkpoint.
  await complete(db);
  const row = db.records.get(path);
  assert.deepEqual(row.sourceKinds, ["userProfile", "dishReview"]);
  assert.equal(row.contributionPoints, 17); assert.equal(row.activityReviews, true);
  assert(!db.records.has(c.adminUserSourceSummaryDocumentPath({uid: "u", sourceKind: "publicReviewerProfile"})));
});

test("unchanged sparse verification avoids absent scopes and preserves every published field", async () => {
  const db = new Database({"user_profiles/é": profile("é")}); await complete(db);
  const before = [...db.records].filter(([p]) => !p.includes("/auw_") && p !== r.adminUserVerificationPath);
  db.operations = []; await complete(db);
  assert.deepEqual([...db.records].filter(([p]) => !p.includes("/auw_") && p !== r.adminUserVerificationPath), before);
  assert.equal([...db.records.values()].filter(v => v.workType === "source").length, 1);
  assert(!db.operations.some(op => op.query?.where && op.query.collectionPath !== "user_profiles" && op.query.where.field !== "state"));
});

for (const owner of [undefined, null, "", "bad/uid", 7, {uid: "u"}]) test(`catalog owner ${JSON.stringify(owner)} retains required repair`, async () => {
  const source = cafe(owner), db = new Database({"bitescore_restaurants/cafe": source});
  await m.handleAdminUserSourceWrite(db, {sourceKind: "biteScoreRestaurant", sourceDocumentId: "cafe", before: null, after: source, now, eventId: "create"});
  const ambiguous = owner !== undefined && owner !== null;
  assert.equal(db.records.has(c.adminUserRelationshipWorkPath("cafe")), ambiguous);
  assert(!db.records.has(c.adminUserClaimedRestaurantDocumentPath("cafe")));
  await complete(db);
  assert.equal(db.records.has(c.adminUserRelationshipWorkPath("cafe")), ambiguous);
  assert(![...db.records.keys()].some(p => p.startsWith("admin_user_directory/")));
});

test("unowned event still clears stale relationship and completes preexisting pending work", async () => {
  const db = new Database({"bitescore_restaurants/cafe": cafe("old")}); await complete(db);
  await db.runTransaction(async tx => (await m.prepareAdminUserWork(tx, {restaurantId: "cafe"}, now, {invalidate: true}))());
  db.records.set("bitescore_restaurants/cafe", cafe(null));
  await m.handleAdminUserSourceWrite(db, {sourceKind: "biteScoreRestaurant", sourceDocumentId: "cafe", before: cafe(null), after: cafe(null), now, eventId: "unowned"});
  assert(!db.records.has(c.adminUserClaimedRestaurantDocumentPath("cafe")));
  assert.equal(db.records.get(c.adminUserRelationshipWorkPath("cafe")).state, "complete");
  await complete(db); assert(!db.records.has(c.adminUserDirectoryDocumentPath("old")));
});

test("missed unclaim and failed no-owner event repair remain discoverable from derived census", async () => {
  const db = new Database({"bitescore_restaurants/cafe": cafe("old")}); await complete(db);
  db.records.delete(c.adminUserRelationshipWorkPath("cafe")); // No prior recovery checkpoint.
  db.records.set("bitescore_restaurants/cafe", cafe(null));
  db.failRead = p => p === "bitescore_restaurants/cafe";
  await assert.rejects(m.handleAdminUserSourceWrite(db, {sourceKind: "biteScoreRestaurant", sourceDocumentId: "cafe", before: cafe(null), after: cafe(null), now}));
  assert(db.records.has(c.adminUserClaimedRestaurantDocumentPath("cafe")));
  db.failRead = null; await complete(db);
  assert(!db.records.has(c.adminUserClaimedRestaurantDocumentPath("cafe")));
  assert(!db.records.has(c.adminUserDirectoryDocumentPath("old")));
});

test("stale no-owner event rereads current owner; missed current UID event is found by full discovery", async () => {
  const db = new Database({"bitescore_restaurants/cafe": cafe("new")});
  await m.handleAdminUserSourceWrite(db, {sourceKind: "biteScoreRestaurant", sourceDocumentId: "cafe", before: cafe(null), after: cafe(null), now});
  assert.equal(db.records.get(c.adminUserClaimedRestaurantDocumentPath("cafe")).ownerUid, "new");
  assert(!db.records.has(c.adminUserRelationshipWorkPath("cafe")));
  await complete(db); assert.equal(db.records.get(c.adminUserDirectoryDocumentPath("new")).roleBiteScoreOwner, true);
});

test("owner removal retains registration before failed immediate reconciliation", async () => {
  const db = new Database({"bitescore_restaurants/cafe": cafe(null)});
  db.failRead = p => p === "bitescore_restaurants/cafe";
  await assert.rejects(m.handleAdminUserSourceWrite(db, {sourceKind: "biteScoreRestaurant", sourceDocumentId: "cafe", before: cafe("old"), after: cafe(null), now}));
  assert.equal(db.records.get(c.adminUserRelationshipWorkPath("cafe")).state, "pending");
  assert.equal(db.records.get(c.adminUserWorkPath("old", "biteScoreRestaurant")).state, "pending");
});

test("old completed source checkpoints still enforce fences without directory or source", async () => {
  const db = new Database({"user_profiles/u": profile("u")}); await complete(db);
  db.records.delete("user_profiles/u"); db.records.delete(c.adminUserDirectoryDocumentPath("u"));
  db.records.delete(c.adminUserSourceSummaryDocumentPath({uid: "u", sourceKind: "userProfile"}));
  db.records.set("private_account_deletions/u", {});
  await complete(db); assert(!db.records.has(c.adminUserWorkPath("u", "userProfile")));
});

test("full burst commits at most20 steps; status and pause do not advance; lost response replay cannot restart", async () => {
  const db = many(), start = await req(db, "start");
  const advanced = await req(db, "continue", start);
  assert.equal(advanced.steps, 20); assert.equal(advanced.status, "pending");
  assert.equal((await req(db, "continue", start)).steps, 20);
  assert.equal((await req(db, "status")).steps, 20);
  const pause = await req(db, "pause", advanced); assert.equal(pause.steps, 20);
  assert.equal((await req(db, "continue", pause)).status, "paused");
  const end = await complete(db, await req(db, "start"));
  assert.equal((await req(db, "continue", end)).passId, end.passId);
  assert.equal((await req(db, "continue", start)).lastCompletedAtMillis, now.getTime());
  assert.equal((await req(db, "start")).lastCompletedAtMillis, now.getTime());
});

test("soft admission budget stops new steps, not an already committed transaction", async () => {
  const db = many(), state = await req(db, "start"); let tick = 0;
  const result = await req(db, "continue", state, {monotonicNow: () => tick++ ? 5000 : 0});
  assert.equal(result.steps, 1); assert.equal(result.status, "pending");
});

test("a later burst failure preserves earlier commits and resumes without false completion", async () => {
  const db = many(), state = await req(db, "start");
  const boundary = afterCommit(db, () => {if (db.records.get(r.adminUserVerificationPath).steps === 3) db.failRead = p => p === "user_profiles";});
  const failed = await req(boundary, "continue", state);
  assert.equal(failed.steps, 3); assert.equal(failed.status, "failed"); assert.equal(failed.lastCompletedAtMillis, null);
  db.failRead = null; const resumed = await req(db, "start"); assert.equal(resumed.passId, state.passId);
  await complete(db, resumed);
  assert.equal([...db.records.keys()].filter(p => p.startsWith("admin_user_directory/")).length, 40);
});

for (const action of ["continue", "pause", "start"]) test(`burst stops after another Admin ${action}; never adopts their revision`, async () => {
  const db = many(), state = await req(db, "start"); let other;
  const boundary = afterCommit(db, async () => {
    if (!other) {other = true; other = await single(db, action, await req(db, "status"));}
  });
  const result = await req(boundary, "continue", state);
  assert.equal(result.revision, other.revision);
  assert.equal(result.steps, action === "continue" ? 2 : 1);
  assert.equal(result.status, action === "pause" ? "paused" : "pending");
});

test("authorization rejection between steps stops new work and preserves durable checkpoint", async () => {
  const db = many(), state = await req(db, "start"); let checks = 0;
  await assert.rejects(req(db, "continue", state, {monotonicNow: () => 0, assertAccess: () => {if (++checks === 3) throw Error("access rejected");}}), /access rejected/);
  const saved = await req(db, "status"); assert.equal(saved.steps, 2); assert.equal(saved.status, "pending");
  // This exercises the guard boundary, not remote Firebase token-revocation detection.
  await complete(db, saved);
});

for (const action of ["pause", "start"]) test(`late step failure cannot overwrite a competing ${action}`, async () => {
  const db = many(), start = await req(db, "start"); let competing;
  const boundary = {runTransaction: async op => {
    try {
      const result = await db.runTransaction(op);
      if (db.records.get(r.adminUserVerificationPath).steps === 3) db.failRead = p => p === "user_profiles";
      return result;
    } catch (error) {
      if (!competing) {competing = true; competing = await req(db, action, await req(db, "status"));}
      throw error;
    }
  }};
  const result = await req(boundary, "continue", start);
  assert.equal(result.revision, competing.revision); assert.equal(result.steps, 3);
  assert.equal(result.status, action === "pause" ? "paused" : "pending");
  assert.equal(result.lastCompletedAtMillis, null);
});

test("failed failure-marker write propagates error without losing earlier durable steps", async () => {
  const db = many(), start = await req(db, "start");
  const boundary = {runTransaction: async op => {
    try {
      const result = await db.runTransaction(op);
      if (db.records.get(r.adminUserVerificationPath).steps === 3) db.failRead = p => p === "user_profiles";
      return result;
    } catch (error) {db.failRead = () => true; throw error;}
  }};
  await assert.rejects(req(boundary, "continue", start), /synthetic read failure/);
  db.failRead = null; const saved = await req(db, "status");
  assert.equal(saved.steps, 3); assert.equal(saved.status, "pending"); assert.equal(saved.lastCompletedAtMillis, null);
  await complete(db, saved);
});
