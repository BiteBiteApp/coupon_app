"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

if (process.env.BITESAVER_FIRESTORE_EMULATOR_TEST !== "1") {
  test("proposal points real Firestore regressions require a local emulator", {
    skip: "set BITESAVER_FIRESTORE_EMULATOR_TEST=1 with loopback/demo configuration",
  }, () => {});
} else {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.match(host ?? "", /^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/u);
  assert.ok(Number(host.split(":")[1]) <= 65535);
  for (const key of ["FIREBASE_EMULATOR_HUB", "FIREBASE_EMULATOR_HUB_HOST"]) {
    if (process.env[key]) assert.match(process.env[key], /^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/u);
  }
  const projectId = "demo-bs-adapter-proposal-repair";
  assert.equal(process.env.GCLOUD_PROJECT, projectId);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, projectId);
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore, Timestamp} = require("firebase-admin/firestore");
  const contract = require("../lib/dish_proposal_private_contract.js");
  const maintenance = require("../lib/dish_proposal_private_maintenance.js");
  const jobs = require("../lib/dish_proposal_resolution_jobs.js");
  const runtime = require("../lib/dish_proposal_runtime_integration.js");
  const points = require("../lib/contribution_points_helpers.js");
  const {createFirestoreDishProposalPrivateDatabase} = require("../lib/dish_proposal_private_store.js");
  const {createReviewMilestoneLockEnforcedDishProposalPrivateDatabase} = require("../lib/review_milestone_reconciliation_lock.js");
  const apps = [0, 1].map((n) => initializeApp({projectId}, `proposal-points-${n}`));
  const stores = apps.map((app) => getFirestore(app));
  const db = stores[0];
  function dependencies(store) {
    const result = jobs.createFirestoreDishProposalResolutionDependencies(store);
    result.database = createReviewMilestoneLockEnforcedDishProposalPrivateDatabase(result.database);
    return result;
  }
  const contexts = stores.map((store) => ({
    privateDatabase: createFirestoreDishProposalPrivateDatabase(store),
    discoveryDatabase: runtime.createFirestoreDishProposalRuntimeDiscoveryDatabase(store),
    resolutionDependencies: dependencies(store),
    now: () => new Date(Date.now() + 4 * 86400000),
  }));
  const tick = (context = contexts[0]) => runtime.processDishProposalResolutionWorkHandler(context);
  const data = async (path) => (await db.doc(path).get()).data();
  const snapshot = async () => Object.fromEntries((await Promise.all(
    (await db.listCollections()).map(async (col) => (await col.get()).docs.map(
      (d) => [d.ref.path, {data: d.data(), updateTime: d.updateTime}],
    )),
  )).flat().sort(([a], [b]) => a.localeCompare(b)));
  const jobPath = (id) => `${contract.dishProposalJobCollection}/${id}`;
  async function onlyJob() {
    const docs = (await db.collection(contract.dishProposalJobCollection).get()).docs;
    assert.equal(docs.length, 1);
    return {id: docs[0].id, ...docs[0].data()};
  }
  async function seed(type = "rename", store = db) {
    await store.doc("bitescore_restaurants/r").set({id: "r", name: "Local fixture", isActive: true});
    await store.doc("bitescore_dishes/source").set({id: "source", restaurantId: "r", restaurantName: "Local fixture", name: "Soup", normalizedName: "soup", isActive: true});
    if (type === "merge") await store.doc("bitescore_dishes/target").set({id: "target", restaurantId: "r", restaurantName: "Local fixture", name: "Garlic Soup", normalizedName: "garlic soup", isActive: true});
    const ids = type === "merge" ? ["p", "p2"] : ["p"];
    for (const id of ids) {
      await store.doc(`user_profiles/${id}-user`).set({identityCanary: "preserve", billingCanary: "preserve", contributionPoints: 0});
      await store.doc(`dish_edit_proposals/${id}`).set({
        id: "ignored-embedded-alias", status: "pending", type,
        restaurantId: "r", sourceDishId: "source", userId: `${id}-user`,
        ...(type === "rename" ? {proposedName: "garlic soup"} : {mergeTargetDishId: "target"}),
      });
      await maintenance.maintainDishEditProposalPrivateState(
        createFirestoreDishProposalPrivateDatabase(store), id, new Date(),
      );
    }
    return ids;
  }
  async function advanceUntil(predicate, concurrent = false) {
    for (let n = 0; n < 40; n++) {
      if (await predicate()) return;
      const current = await onlyJob();
      assert.notEqual(current.failureCode, "point_award_not_eligible", "valid current-source proposal was rejected at award_points");
      assert.notEqual(current.status, "manual_review_required", current.failureCode);
      if (concurrent) await Promise.all(contexts.map(tick));
      else await tick();
    }
    assert.ok(await predicate(), "bounded scheduler steps must converge");
  }
  async function reachAward() {
    await tick();
    await advanceUntil(async () => (await onlyJob()).phase === "award_points");
    return onlyJob();
  }
  async function assertAwardOnce(ids, type = "rename") {
    const entries = (await db.collection(points.contributionPointLedgerCollection).get()).docs;
    assert.equal(entries.length, ids.length);
    for (const id of ids) {
      const sourceKey = `dish_${type}_approved:${id}`;
      const ledgerId = points.buildContributionLedgerDocumentIdFromExactSourceKey(sourceKey);
      const entry = await data(`${points.contributionPointLedgerCollection}/${ledgerId}`);
      assert.equal(entry.userId, `${id}-user`);
      assert.equal(entry.requestId, id);
      assert.equal(entry.sourceKey, sourceKey);
      assert.equal(entry.pointsDelta, 1);
      assert.equal(entry.dishId, "source");
      assert.equal(entry.restaurantId, "r");
      const profile = await data(`user_profiles/${id}-user`);
      assert.equal(profile.contributionPoints, entry.pointsDelta);
      assert.equal(profile.identityCanary, "preserve");
      assert.equal(profile.billingCanary, "preserve");
      assert.equal((await data(`dish_edit_proposals/${id}`)).status, "approved");
    }
  }
  test.beforeEach(async () => {
    assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {method: "DELETE"})).status, 200);
  });
  test.after(async () => {
    await Promise.all(stores.map((store) => store.terminate()));
    await Promise.all(apps.map(deleteApp));
  });

  test("current producer rename completes and duplicate schedulers award the contributor once", async () => {
    const ids = await seed();
    await Promise.all(contexts.map(tick));
    await advanceUntil(async () => (await onlyJob()).status === "complete", true);
    assert.equal((await data("bitescore_dishes/source")).name, "Garlic Soup");
    await assertAwardOnce(ids);
    const before = await snapshot();
    await Promise.all(contexts.map(tick));
    assert.deepEqual(await snapshot(), before);
  });

  test("retry after rename and after committed award resumes without renaming or awarding twice", async () => {
    const ids = await seed();
    const job = await reachAward();
    await db.doc("bitescore_dishes/source").update({newerMetadata: "preserve"});
    const renamed = await db.doc("bitescore_dishes/source").get();
    const original = contexts[0].resolutionDependencies;
    let failBefore = true, failAfter = true;
    const context = {...contexts[0], resolutionDependencies: {...original,
      awardApprovedProposalPoints: async (request) => {
        if (failBefore) { failBefore = false; throw new Error("local failure before award"); }
        const result = await original.awardApprovedProposalPoints(request);
        if (failAfter) { failAfter = false; throw new Error("local response lost after committed award"); }
        return result;
      },
    }};
    await tick(context);
    assert.equal((await data(jobPath(job.id))).status, "retryable");
    assert.equal((await data("user_profiles/p-user")).contributionPoints, 0);
    await tick(context);
    const pending = await data(jobPath(job.id));
    assert.equal(pending.status, "retryable");
    assert.equal(pending.phase, "award_points");
    assert.equal(pending.pointsCursorMemberId, null);
    assert.equal((await data("user_profiles/p-user")).contributionPoints, 1);
    const award = (await db.collection(points.contributionPointLedgerCollection).get()).docs[0];
    await advanceUntil(async () => (await onlyJob()).status === "complete", true);
    await assertAwardOnce(ids);
    assert.deepEqual((await db.doc("bitescore_dishes/source").get()).updateTime, renamed.updateTime);
    assert.equal((await data("bitescore_dishes/source")).newerMetadata, "preserve");
    assert.deepEqual((await award.ref.get()).updateTime, award.updateTime);
  });

  test("old job cannot award or overwrite a newer contributor membership", async () => {
    await seed();
    const oldJob = await reachAward();
    await db.doc("dish_edit_proposals/p").update({userId: "new-user", proposedName: "newer soup"});
    await maintenance.maintainDishEditProposalPrivateState(contexts[0].privateDatabase, "p", new Date());
    const newer = await data("dish_edit_proposals/p");
    for (let n = 0; n < 15 && (await data(jobPath(oldJob.id))).status !== "complete"; n++) {
      await Promise.all(contexts.map((c) => jobs.processDishProposalJobStep(c.resolutionDependencies, oldJob.id, new Date())));
    }
    assert.equal((await data(jobPath(oldJob.id))).status, "complete");
    assert.deepEqual(await data("dish_edit_proposals/p"), newer);
    assert.equal((await db.collection(points.contributionPointLedgerCollection).get()).size, 0);
    assert.equal((await data("user_profiles/p-user")).contributionPoints, 0);
    assert.equal(await data("user_profiles/new-user"), undefined);
    assert.equal((await data("bitescore_dishes/source")).name, "Garlic Soup");
  });

  test("merge shares the current group contract and awards each supporter once", async () => {
    const ids = await seed("merge");
    await tick();
    await advanceUntil(async () => (await onlyJob()).status === "complete", true);
    await assertAwardOnce(ids, "merge");
    assert.equal((await data("bitescore_dishes/source")).mergedIntoDishId, "target");
    assert.equal((await data("bitescore_dishes/target")).name, "Garlic Soup");
  });

  test("empty work remains read-only with the existing bounded scheduler limits", async () => {
    const before = await snapshot();
    await Promise.all(contexts.map(tick));
    assert.deepEqual(await snapshot(), before);
    assert.equal(runtime.dishProposalScheduledExistingJobLimit, 15);
    assert.equal(runtime.dishProposalScheduledWorkLimit, 25);
  });

  test("Firestore serialization exposes the original floor versus canonical Date mismatch", async (t) => {
    for (const nanos of [499000, 500000, 999000, 999499000, 999500000, 999999000]) {
      await db.doc("timestamp_cases/precision").set({value: new Timestamp(1700000000, nanos)});
      const value = (await data("timestamp_cases/precision")).value;
      const canonicalMillis = contract.readDishProposalDate(value).getTime();
      assert.equal(canonicalMillis, 1700000000000 + Math.round(nanos / 1000000));
      assert.equal(value.toMillis(), 1700000000000 + Math.floor(nanos / 1000000));
      t.diagnostic(JSON.stringify({nanoseconds: value.nanoseconds, canonicalMillis, originalFloorMillis: value.toMillis()}));
    }
  });

  test("Firestore timestamp round trips preserve canonical creation milliseconds at precision boundaries", async () => {
    // Server creation times cannot be chosen by a client. Substitute only that
    // metadata using real Timestamps read back from Firestore; every producer,
    // transaction, fingerprint and award still uses the actual implementation.
    const cases = [0, 499000, 500000, 999000, 999499000, 999500000, 999999000];
    for (const nanos of cases) {
      const timestamp = new Timestamp(1700000000, nanos);
      await db.doc("timestamp_cases/current").set({timestamp});
      const roundTrip = (await data("timestamp_cases/current")).timestamp;
      assert.equal(roundTrip.nanoseconds, nanos);
      assert.equal(roundTrip.toDate().getTime(), 1700000000000 + Math.round(nanos / 1000000));
      assert.equal(roundTrip.toMillis(), 1700000000000 + Math.floor(nanos / 1000000));
      const metadataStore = Object.create(db);
      metadataStore.runTransaction = (fn) => db.runTransaction((tx) => fn(new Proxy(tx, {
        get(target, key) {
          if (key === "get") return async (ref) => {
            const snap = await target.get(ref);
            if (ref.path === "dish_edit_proposals/p") return new Proxy(snap, {
              get(value, field) { return field === "createTime" ? roundTrip : Reflect.get(value, field, value); },
            });
            return snap;
          };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })));
      await seed("rename", metadataStore);
      const privateDb = createFirestoreDishProposalPrivateDatabase(metadataStore);
      const groups = (await db.collection(contract.dishProposalGroupCollection).get()).docs;
      const group = maintenance.parseDishProposalGroupDocument({id: groups[0].id, data: groups[0].data(), createTime: null});
      const claim = await jobs.claimDishProposalGroupForApply(privateDb, group.groupId, new Date());
      const dep = dependencies(metadataStore);
      for (let n = 0; n < 15 && (await data(jobPath(claim.jobId))).status !== "complete"; n++) {
        await jobs.processDishProposalJobStep(dep, claim.jobId, new Date());
      }
      assert.equal((await data(jobPath(claim.jobId))).status, "complete", `nanoseconds=${nanos}`);
      await assertAwardOnce(["p"]);
      // Clear only this dedicated local demo project between boundary cases.
      assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {method: "DELETE"})).status, 200);
    }
  });
}
