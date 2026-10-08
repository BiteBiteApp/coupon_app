"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {AdminUserMemoryDatabase: Database} = require("./helpers/admin_user_memory_database.js");
const m = require("../lib/admin_user_directory_maintenance.js");
const c = require("../lib/admin_user_directory_contract.js");
const now = new Date("2026-10-08T04:00:00Z");
const review = (uid = "u", extra = {}) => ({userId: uid, dishId: "dish", restaurantId: "cafe", overallImpression: 8, updatedAt: now, ...extra});
const workPath = uid => c.adminUserWorkPath(uid, "dishReview");
const summaryPath = uid => c.adminUserSourceSummaryDocumentPath({uid, sourceKind: "dishReview"});
const work = (db, uid = "u") => db.records.get(workPath(uid));
const initial = (count, uid = "u") => Object.fromEntries(Array.from({length: count}, (_, i) =>
  [`dish_reviews/r-${String(i).padStart(5, "0")}`, review(uid)]));
const write = (eventId = "A", sourceDocumentId = "r-00000", before = null, after = review()) =>
  ({sourceKind: "dishReview", sourceDocumentId, before, after, now, eventId});
const deliver = (db, event = write(), clock = () => 0) => m.handleAdminUserSourceWrite(db, event, {monotonicNow: clock});
const pending = error => error instanceof m.AdminUserDirectoryEventPendingError;
async function finishEvent(db, event = write()) {
  let rejected = 0;
  for (let i = 0; i < 100; i++) {
    try {const result = await deliver(db, event); assert(result.every(x => x.state === "complete")); return rejected;}
    catch (error) {assert(pending(error)); rejected++;}
  }
  assert.fail("event did not terminate");
}
async function resumeDirect(db, uid = "u") {
  return db.runTransaction(async tx => m.advanceAdminUserSource(tx,
    m.parseAdminUserWork(await tx.getDocument(workPath(uid))), now));
}

test("event finishes 4/5/6/25 reviews; 1000 needs ten rejected deliveries then completion", async () => {
  for (const count of [4, 5, 6, 25, 1000]) {
    const db = new Database(initial(count));
    const rejections = await finishEvent(db);
    assert.equal(rejections, count === 1000 ? 10 : 0);
    assert.equal(work(db).state, "complete");
    assert.equal(db.records.get(c.adminUserDirectoryDocumentPath("u")).activityReviews, true);
    assert(db.operations.filter(x => x.operation === "query").every(x => x.query.limit === 5));
  }
});

test("explicit20step limit and soft elapsed admission save unfinished progress and reject", async () => {
  const db = new Database(initial(1000));
  await assert.rejects(deliver(db), pending);
  assert.equal(db.transactionCount, 21); assert.equal(work(db).cursor, "r-00099");
  const generation = work(db).generation;
  let tick = 0;
  await assert.rejects(deliver(db, write(), () => tick++ * m.adminUserEventAdmissionMillis), pending);
  assert.equal(db.transactionCount, 23); assert.equal(work(db).cursor, "r-00104");
  assert.equal(work(db).generation, generation);
  assert.equal(await finishEvent(db), 8);
});

test("alternating distinct and older event IDs preserve stable pending generation and terminate", async () => {
  const db = new Database(initial(1000)); let generation;
  for (let i = 0; i < 11; i++) {
    const event = write(i % 2 ? "older-B" : "newer-A", i % 2 ? "r-00001" : "r-00000");
    if (i < 10) await assert.rejects(deliver(db, event), pending); else await deliver(db, event);
    generation ??= work(db).generation; assert.equal(work(db).generation, generation);
    if (i < 10) assert.equal(work(db).cursor, `r-${String((i + 1) * 100 - 1).padStart(5, "0")}`);
  }
  assert.equal(work(db).state, "complete");
  const published = structuredClone(db.records.get(summaryPath("u")));
  assert.equal(await finishEvent(db, write("delayed", "r-00000", null, review("u", {updatedAt: new Date(0)}))), 10);
  assert.equal(db.records.get(summaryPath("u")).sourceFingerprint, published.sourceFingerprint);
});

test("current behind-cursor event candidate is folded atomically before another worker completes", async () => {
  const db = new Database(initial(12)); await m.reconcileAdminUserSource(db, "dishReview", "u", now);
  const generation = work(db).generation, newer = new Date(now.getTime() + 100000);
  db.records.set("dish_reviews/a-new", review("u", {updatedAt: newer}));
  let release, registered;
  const pause = new Promise(resolve => {release = resolve;});
  const ready = new Promise(resolve => {registered = resolve;});
  let first = true;
  const paused = {runTransaction: async operation => {
    const result = await db.runTransaction(operation);
    if (first) {first = false; registered(); await pause;}
    return result;
  }};
  const event = deliver(paused, write("B", "a-new", null, review("u", {updatedAt: newer})));
  await ready;
  assert.equal(work(db).cursor, "r-00004"); assert.equal(work(db).activityId, "a-new");
  while (work(db).state === "pending") await resumeDirect(db);
  release(); await event;
  assert.equal(work(db).generation, generation);
  assert.equal(db.records.get(summaryPath("u")).latestActivityAt.getTime(), newer.getTime());
});

test("another worker completing between burst steps cannot cause a new generation", async () => {
  const db = new Database(initial(12)); let calls = 0, generation;
  const competing = {runTransaction: async operation => {
    const result = await db.runTransaction(operation);
    if (++calls === 2) {
      generation = work(db).generation;
      while (work(db).state === "pending") await resumeDirect(db);
    }
    return result;
  }};
  await deliver(competing);
  assert.equal(work(db).generation, generation); assert.equal(work(db).state, "complete");
});

test("selected deletion, reassignment, invalidation and activity decrease rescan and terminate with duplicates", async () => {
  for (const mutation of ["delete", "transfer", "invalid", "decrease"]) {
    const db = new Database(initial(10));
    const selected = review("u", {updatedAt: new Date(now.getTime() + 1000)});
    db.records.set("dish_reviews/r-00000", selected);
    await m.reconcileAdminUserSource(db, "dishReview", "u", now);
    const generation = work(db).generation;
    if (mutation === "delete") db.records.delete("dish_reviews/r-00000");
    else db.records.set("dish_reviews/r-00000", mutation === "invalid" ? {userId: "u"} :
      review(mutation === "transfer" ? "v" : "u", {updatedAt: new Date(0)}));
    const after = db.records.get("dish_reviews/r-00000") ?? null;
    await finishEvent(db, write("change", "r-00000", selected, after));
    assert.notEqual(work(db).generation, generation);
    assert.equal(db.records.get(summaryPath("u")).latestActivityAt.getTime(), now.getTime());
    assert.equal(work(db).state, "complete");
  }
});

test("two affected users get fair steps across alternating IDs and elapsed cutoff", async () => {
  for (const slow of [false, true]) {
    const db = new Database({...initial(99, "old"), "dish_reviews/new-a": review("new"), "dish_reviews/new-b": review("new")});
    const event = id => write(id, "new-a", review("old"), review("new"));
    let tick = 0;
    if (slow) await assert.rejects(deliver(db, event("A"), () => tick++ * 3000), pending);
    else await assert.rejects(deliver(db, event("A")), pending);
    assert.equal(work(db, "new").state, "complete", "short second UID completes in first admitted round");
    if (slow) assert.equal(work(db, "old").cursor, "r-00004");
    await deliver(db, event("B"));
    assert.equal(work(db, "old").state, "complete");
    for (const id of ["A", "B", "A", "B"]) {
      try {await deliver(db, event(id));} catch (error) {assert(pending(error));}
      assert.equal(work(db, "new").state, "complete");
    }
    await finishEvent(db, event("B"));
    assert.equal(work(db, "new").state, "complete");
  }
});

test("all-invalid and mixed pages terminate; malformed permanent event inputs do no work", async () => {
  for (const valid of [false, true]) {
    const records = Object.fromEntries(Array.from({length: 80}, (_, i) => [`dish_reviews/z-${i}`, {userId: "u"}]));
    if (valid) records["dish_reviews/a-valid"] = review();
    const db = new Database(records);
    await deliver(db, write("A", "z-0", null, {userId: "u"}));
    assert.equal(work(db).state, "complete"); assert.equal(db.records.has(c.adminUserDirectoryDocumentPath("u")), valid);
  }
  for (const id of ["", ".", "..", "bad/id", undefined]) {
    const db = new Database(); assert.deepEqual(await deliver(db, {...write(), sourceDocumentId: id}), []);
    assert.equal(db.transactionCount, 0);
  }
  const db = new Database(); await deliver(db, write("bad", "r", null, {userId: "bad/uid"}));
  assert.equal(db.records.size, 0);
});

test("fence read failures and a write failure after saved progress reject and preserve cursor", async () => {
  const db = new Database(initial(25)); let transactions = 0;
  const failure = Error("synthetic transaction write failure");
  const failing = {runTransaction: operation => {
    if (++transactions === 4) return db.runTransaction(async tx => {await operation(tx); throw failure;});
    return db.runTransaction(operation);
  }};
  await assert.rejects(deliver(failing), error => error === failure);
  const checkpoint = structuredClone(work(db)); assert.equal(checkpoint.cursor, "r-00009");
  db.failRead = path => path.startsWith("private_account_deletions/");
  await assert.rejects(deliver(db), /synthetic read failure/); assert.deepEqual(work(db), checkpoint);
  db.failRead = null; await deliver(db); assert.equal(work(db).generation, checkpoint.generation);
  assert.equal(work(db).state, "complete");
});

test("fence installed between saved steps removes all private progress and prevents publication", async () => {
  const db = new Database(initial(25)); let calls = 0;
  const fenced = {runTransaction: async operation => {
    const result = await db.runTransaction(operation);
    if (++calls === 2) db.records.set("private_account_deletions/u", {state: "requested"});
    return result;
  }};
  await deliver(fenced);
  assert.equal(db.records.has(c.adminUserDirectoryDocumentPath("u")), false);
  for (const kind of c.adminUserSourceKinds) {
    assert.equal(db.records.has(c.adminUserWorkPath("u", kind)), false);
    assert.equal(db.records.has(c.adminUserSourceSummaryDocumentPath({uid: "u", sourceKind: kind})), false);
  }
});
