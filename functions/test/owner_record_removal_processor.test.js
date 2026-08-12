"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require("../lib/owner_record_removal_contract.js");
const ownerState = require("../lib/owner_record_state_contract.js");
const processor = require("../lib/owner_record_removal_processor.js");
const ratingContract = require("../lib/rating_destructive_job_contract.js");
const storageContract = require("../lib/owner_record_removal_storage.js");
const subscriptionReturn = require("../lib/subscription_return_ledger.js");

const targetUid = "owner_processor_target_1";
const otherUid = "owner_processor_other_1";
const sourceGeneration = 4;
const completionGeneration = 5;
const createdAt = new Date("2026-08-12T15:00:00.000Z");
const jobId = contract.createOwnerRecordRemovalJobId({
  targetUid,
  sourceGeneration,
});
const jobPath = contract.ownerRecordRemovalJobPath(jobId);
const ownerPath = `${ownerState.ownerRecordStateCollection}/${targetUid}`;
const accountRootPath = `restaurant_accounts/${targetUid}`;
const returnPath =
  `${subscriptionReturn.subscriptionReturnLedgerCollection}/${targetUid}`;

class RetryTransaction extends Error {}

function clone(value) {
  return structuredClone(value);
}

function documentId(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function directChildId(collectionPath, path) {
  const prefix = `${collectionPath}/`;
  if (!path.startsWith(prefix)) return null;
  const suffix = path.slice(prefix.length);
  return suffix.length !== 0 && !suffix.includes("/") ? suffix : null;
}

class InMemoryDatabase {
  constructor(documents = {}) {
    this.documents = new Map(
      Object.entries(documents).map(([path, data]) => [path, clone(data)]),
    );
    this.queries = [];
    this.transactions = [];
    this.queue = Promise.resolve();
    this.beforeQuery = null;
    this.afterQuery = null;
    this.beforeCommit = null;
    this.afterCommit = null;
  }

  async runTransaction(operation) {
    const execute = async () => {
      while (true) {
      const staged = new Map();
      const deleted = new Set();
      const stats = {
        sets: 0,
        deletes: 0,
        gets: [],
        queries: [],
        committed: false,
      };
      const visibleValue = (path) => {
        if (deleted.has(path)) return undefined;
        return staged.has(path) ? staged.get(path) : this.documents.get(path);
      };
      const visibleEntries = () => {
        const paths = new Set([...this.documents.keys(), ...staged.keys()]);
        return [...paths]
          .filter((path) => !deleted.has(path))
          .map((path) => [path, visibleValue(path)]);
      };
      const transaction = {
        getDocument: async (path) => {
          stats.gets.push(path);
          const data = visibleValue(path);
          return data === undefined
            ? null
            : {id: documentId(path), data: clone(data)};
        },
        queryDocuments: async (query) => {
          const recorded = clone(query);
          this.queries.push(recorded);
          stats.queries.push(recorded);
          await this.beforeQuery?.(recorded, this);
          let results = visibleEntries()
            .map(([path, data]) => ({
              id: directChildId(query.collectionPath, path),
              data,
            }))
            .filter((entry) => entry.id !== null);
          for (const condition of query.where ?? []) {
            assert.equal(condition.operator, "==");
            results = results.filter(
              (entry) => entry.data[condition.field] === condition.value,
            );
          }
          if (query.orderByDocumentId === "asc") {
            results.sort((left, right) => left.id < right.id ? -1 :
              left.id > right.id ? 1 : 0);
          }
          const page = results.slice(0, query.limit).map((entry) => ({
            id: entry.id,
            data: clone(entry.data),
          }));
          await this.afterQuery?.(recorded, clone(page), this);
          return page;
        },
        setDocument: (path, data, options) => {
          const next = options?.merge === true
            ? {...(visibleValue(path) ?? {}), ...data}
            : data;
          staged.set(path, clone(next));
          deleted.delete(path);
          stats.sets += 1;
          stats.setPaths ??= [];
          stats.setPaths.push(path);
        },
        deleteDocument: (path) => {
          staged.delete(path);
          deleted.add(path);
          stats.deletes += 1;
          stats.deletePaths ??= [];
          stats.deletePaths.push(path);
        },
      };
      try {
        const result = await operation(transaction);
        await this.beforeCommit?.(stats, this);
        for (const path of deleted) this.documents.delete(path);
        for (const [path, data] of staged) this.documents.set(path, data);
        stats.committed = true;
        await this.afterCommit?.(stats, this);
        return clone(result);
      } catch (error) {
        if (error instanceof RetryTransaction) {
          stats.retried = true;
          continue;
        }
        throw error;
      } finally {
        this.transactions.push(stats);
      }
      }
    };
    const pending = this.queue.then(execute, execute);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  document(path) {
    const data = this.documents.get(path);
    return data === undefined ? null : clone(data);
  }

  set(path, data) {
    this.documents.set(path, clone(data));
  }

  delete(path) {
    this.documents.delete(path);
  }

  pathsUnder(collectionPath) {
    return [...this.documents.keys()]
      .filter((path) => directChildId(collectionPath, path) !== null)
      .sort();
  }
}

class InMemoryStorage {
  constructor(objects = []) {
    this.objects = new Map(
      objects.map((object) => [object.name, clone(object)]),
    );
    this.listRequests = [];
    this.deleteRequests = [];
    this.beforeDelete = null;
    this.afterDelete = null;
    this.afterList = null;
  }

  async listFirstObjects(request) {
    this.listRequests.push(clone(request));
    const prefix = storageContract.buildOwnerRecordRemovalStoragePrefix(
      request.targetUid,
      request.kind,
    );
    const page = [...this.objects.values()]
      .filter((object) => object.name.startsWith(prefix))
      .sort((left, right) => left.name < right.name ? -1 :
        left.name > right.name ? 1 : 0)
      .slice(0, request.limit)
      .map(clone);
    await this.afterList?.(clone(request), clone(page), this);
    return page;
  }

  async deleteExactObject(request) {
    this.deleteRequests.push(clone(request));
    await this.beforeDelete?.(request, this);
    const current = this.objects.get(request.name);
    let result;
    if (current === undefined) {
      result = "not_found";
    } else if (current.providerGeneration !== request.providerGeneration) {
      result = "precondition_failed";
    } else {
      this.objects.delete(request.name);
      result = "deleted";
    }
    await this.afterDelete?.(request, result, this);
    return result;
  }

  object(name) {
    const value = this.objects.get(name);
    return value === undefined ? null : clone(value);
  }
}

function buildJob(overrides = {}) {
  return contract.buildOwnerRecordRemovalJobDocument({
    operation: contract.ownerRecordRemovalOperation,
    jobId,
    requestId: "request_owner_processor_1",
    callerFingerprint:
      contract.createOwnerRecordRemovalCallerFingerprint(
        "admin_owner_processor_1",
      ),
    targetUid,
    status: "active",
    phase: "unclaim_rating_restaurants",
    sourceGeneration,
    completionGeneration,
    cutoverApplied: true,
    billingGateCategory: "inactive",
    failureCategory: null,
    ...contract.createEmptyOwnerRecordRemovalCounters(),
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    ...overrides,
  });
}

function removingOwner() {
  return ownerState.buildOwnerRecordStateDocument({
    ownerUid: targetUid,
    generation: completionGeneration,
    state: "removing",
    activeJobId: jobId,
    createdAt,
    updatedAt: createdAt,
  });
}

function baseDocuments(phase = "unclaim_rating_restaurants") {
  return {
    [jobPath]: buildJob({phase}),
    [ownerPath]: removingOwner(),
  };
}

function context(database, storage = new InMemoryStorage()) {
  let time = createdAt.getTime();
  return {
    database,
    storage,
    clock: () => new Date(time += 1_000),
  };
}

function ratingPath(index) {
  return `bitescore_restaurants/restaurant_${String(index).padStart(3, "0")}`;
}

function ratingRestaurant(index, overrides = {}) {
  return {
    ownerUserId: targetUid,
    isClaimed: true,
    isActive: index % 2 === 0,
    ownerRecordGeneration: sourceGeneration,
    restaurantWriteRevision: 1_000 + index,
    displayName: `Restaurant ${index}`,
    createdByUserId: `creator_${index}`,
    address: {city: "Canary City", order: index},
    updatedAt: new Date(createdAt.getTime() - 60_000),
    ...overrides,
  };
}

function childPath(uid, collection, index) {
  return `restaurant_accounts/${uid}/${collection}/` +
    `record_${String(index).padStart(3, "0")}`;
}

function storageObject(uid, kind, index, overrides = {}) {
  const prefix = storageContract.buildOwnerRecordRemovalStoragePrefix(
    uid,
    kind,
  );
  return {
    name: `${prefix}object_${String(index).padStart(3, "0")}.webp`,
    providerGeneration: String(index + 1),
    ownerRecordGeneration: String(sourceGeneration),
    ...overrides,
  };
}

function validReturnState(generation = sourceGeneration) {
  return subscriptionReturn.reserveSubscriptionReturnContext({
    rawState: undefined,
    ownerUid: targetUid,
    restaurantAccountDocumentId: targetUid,
    ownerRecordGeneration: generation,
    tokenHash: "a".repeat(64),
    family: "checkout",
    nowEpochMs: createdAt.getTime(),
  });
}

const retainedCollectionPaths = Object.freeze([
  "user_profiles",
  `user_profiles/${targetUid}/favorite_restaurants`,
  `user_profiles/${targetUid}/favorite_dishes`,
  `user_profiles/${targetUid}/favorite_coupons`,
  `user_profiles/${targetUid}/local_expert_badges`,
  `user_profiles/${targetUid}/local_expert_badge_celebrations`,
  "public_reviewer_profiles",
  "public_usernames",
  "dish_reviews",
  "review_feedback_votes",
  "bitescore_dish_image_votes",
  "bitescore_dish_images",
  "restaurant_reports",
  "dish_reports",
  "review_reports",
  "duplicate_restaurant_reports",
  "dish_edit_proposals",
  "restaurant_claim_requests",
  "bitescore_contribution_point_ledger",
  `customer_redemptions/${targetUid}/coupon_redemptions`,
  "customer_device_installations",
  "proximity_push_requests",
  "restaurant_invites",
  "restaurant_name_change_requests",
  "bitesaver_reports",
  "restaurant_menus",
  "private_owner_billing_states",
  "private_rating_destructive_jobs",
  "private_rating_destructive_job_items",
  "private_rating_restaurant_operation_locks",
  "private_rating_dish_operation_locks",
  "private_dish_edit_proposal_group_members",
  "private_dish_edit_proposal_group_supporters",
  "private_dish_edit_proposal_groups",
  "private_dish_edit_application_jobs",
  "private_dish_merge_review_locks",
  "private_review_milestone_count_accumulators",
  "private_review_milestone_reconciliation_locks",
  "private_review_milestone_reconciliation_terminal_states",
  "admin_user_directory",
  "admin_user_directory_source_summaries",
  "admin_user_claimed_restaurant_index",
  "restaurant_search_index",
  "dish_search_index",
  "bitesaver_offer_index",
  "private_search_index_jobs",
]);

function retainedCanaryDocuments() {
  const documents = {};
  for (const collectionPath of retainedCollectionPaths) {
    const singletonId = [
      "user_profiles",
      "public_reviewer_profiles",
      "private_owner_billing_states",
      "admin_user_directory",
    ].includes(collectionPath) ? targetUid : "owner_removal_retained_canary";
    documents[`${collectionPath}/${singletonId}`] = {
      targetUid,
      retainedCanaryCollection: collectionPath,
      payload: {
        distinctive: `preserve:${collectionPath}`,
        nested: true,
      },
    };
  }
  documents[`restaurant_accounts/${targetUid}/customer_notes/note_001`] = {
    ownerRecordGeneration: sourceGeneration,
    retained: "non-allowlisted account child",
  };
  return documents;
}

function oneShotCommitFailure(database, timing, predicate) {
  const field = timing === "before" ? "beforeCommit" : "afterCommit";
  database[field] = async (stats) => {
    if (!predicate(stats)) return;
    database[field] = null;
    throw new Error(`injected ${timing}-commit failure`);
  };
}

async function runUntilComplete(processContext, maximumSteps = 100) {
  const seen = [];
  for (let step = 0; step < maximumSteps; step += 1) {
    const result = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    seen.push({status: result.status, phase: result.phase});
    if (result.status === "complete") return {result, seen};
    assert.notEqual(result.status, "manual_review_required", result.failureCategory);
  }
  assert.fail(`processor did not complete in ${maximumSteps} steps`);
}

async function advanceToFinalization(processContext, database) {
  const verified = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(verified.status, "active");
  assert.equal(verified.phase, "finalize_owner_state");
  assert.equal(database.document(ownerPath).state, "removing");
  assert.equal(database.document(ownerPath).activeJobId, jobId);
  assert.equal(database.document(ownerPath).generation, completionGeneration);
  return verified;
}

function assertRouteBack(result, database, expectedPhase, counters) {
  assert.equal(result.status, "active");
  assert.equal(result.phase, expectedPhase);
  assert.equal(result.completionGeneration, completionGeneration);
  assert.equal(result.failureCategory, null);
  for (const counter of contract.ownerRecordRemovalCounterFields) {
    assert.equal(result[counter], counters[counter], counter);
  }
  const owner = database.document(ownerPath);
  assert.equal(owner.state, "removing");
  assert.equal(owner.generation, completionGeneration);
  assert.equal(owner.activeJobId, jobId);
}

test("one bounded step at a time completes every phase and preserves all retained canaries", async () => {
  const documents = baseDocuments();
  const ratingBefore = new Map();
  for (let index = 0; index < 121; index += 1) {
    const path = ratingPath(index);
    documents[path] = ratingRestaurant(index);
    ratingBefore.set(path, clone(documents[path]));
  }
  const otherOwnerRatingPath =
    "bitescore_restaurants/restaurant_other_owner_canary";
  const otherOwnerRatingBefore = ratingRestaurant(999, {
    ownerUserId: otherUid,
    isClaimed: true,
    isActive: false,
    ownerRecordGeneration: sourceGeneration + 17,
    restaurantWriteRevision: 9_999,
    displayName: "Another owner's retained Rating restaurant",
    distinctiveOtherOwnerCanary: {preserve: "exactly"},
  });
  documents[otherOwnerRatingPath] = otherOwnerRatingBefore;
  for (const definition of processor.ownerRecordRemovalChildPhases) {
    for (let index = 0; index < 251; index += 1) {
      documents[childPath(targetUid, definition.collection, index)] = {
        ownerRecordGeneration: sourceGeneration,
        payload: {collection: definition.collection, index},
      };
    }
    documents[childPath(otherUid, definition.collection, 0)] = {
      ownerRecordGeneration: sourceGeneration,
      retained: `other-${definition.collection}`,
    };
  }
  documents[accountRootPath] = {
    ownerRecordGeneration: sourceGeneration,
    restaurantName: "Delete this account root",
  };
  documents[returnPath] = validReturnState();

  const retainedDocuments = retainedCanaryDocuments();
  assert.equal(retainedCollectionPaths.length, 46);
  assert.equal(Object.keys(retainedDocuments).length, 47);
  Object.assign(documents, retainedDocuments);
  const retainedBefore = clone(retainedDocuments);

  const storageObjects = [];
  for (const definition of processor.ownerRecordRemovalStoragePhases) {
    for (let index = 0; index < 26; index += 1) {
      storageObjects.push(storageObject(targetUid, definition.kind, index));
    }
    storageObjects.push(storageObject(otherUid, definition.kind, 0));
  }
  const sharedStorageCanary = {
    name: `restaurant_menus/${targetUid}/shared_menu.webp`,
    providerGeneration: "9001",
    ownerRecordGeneration: String(sourceGeneration),
  };
  storageObjects.push(sharedStorageCanary);

  const database = new InMemoryDatabase(documents);
  const storage = new InMemoryStorage(storageObjects);
  const processContext = context(database, storage);
  const {result, seen} = await runUntilComplete(processContext);

  assert.equal(seen.length, 45);
  assert.deepEqual(
    [...new Set(seen.map((entry) => entry.phase))],
    contract.ownerRecordRemovalPhases.filter(
      (phase) => phase !== "billing_gate",
    ),
  );
  assert.deepEqual(result, database.document(jobPath));
  assert.equal(result.status, "complete");
  assert.equal(result.phase, "complete");
  assert.equal(result.failureCategory, null);
  assert.ok(result.completedAt instanceof Date);
  assert.deepEqual(
    {
      ratingRestaurantsUnclaimed: result.ratingRestaurantsUnclaimed,
      couponsDeleted: result.couponsDeleted,
      dailySpecialsDeleted: result.dailySpecialsDeleted,
      couponNumberReservationsDeleted:
        result.couponNumberReservationsDeleted,
      couponCodeReservationsDeleted: result.couponCodeReservationsDeleted,
      accountMenuImagesDeleted: result.accountMenuImagesDeleted,
      accountMenuItemsDeleted: result.accountMenuItemsDeleted,
      accountMenuSectionsDeleted: result.accountMenuSectionsDeleted,
      storageRestaurantImagesDeleted: result.storageRestaurantImagesDeleted,
      storageCouponImagesDeleted: result.storageCouponImagesDeleted,
      storageMenuImagesDeleted: result.storageMenuImagesDeleted,
      subscriptionReturnDocumentsDeleted:
        result.subscriptionReturnDocumentsDeleted,
      accountRootsDeleted: result.accountRootsDeleted,
    },
    {
      ratingRestaurantsUnclaimed: 121,
      couponsDeleted: 251,
      dailySpecialsDeleted: 251,
      couponNumberReservationsDeleted: 251,
      couponCodeReservationsDeleted: 251,
      accountMenuImagesDeleted: 251,
      accountMenuItemsDeleted: 251,
      accountMenuSectionsDeleted: 251,
      storageRestaurantImagesDeleted: 26,
      storageCouponImagesDeleted: 26,
      storageMenuImagesDeleted: 26,
      subscriptionReturnDocumentsDeleted: 1,
      accountRootsDeleted: 1,
    },
  );

  for (const [path, before] of ratingBefore) {
    const after = database.document(path);
    assert.deepEqual(after, {
      ...before,
      ownerUserId: null,
      isClaimed: false,
      ownerRecordGeneration: null,
      restaurantWriteRevision: before.restaurantWriteRevision + 1,
      updatedAt: after.updatedAt,
    });
    assert.equal(after.isActive, before.isActive);
    assert.equal(after.createdByUserId, before.createdByUserId);
    assert.ok(after.updatedAt > before.updatedAt);
  }
  assert.deepEqual(
    database.document(otherOwnerRatingPath),
    otherOwnerRatingBefore,
  );
  for (const definition of processor.ownerRecordRemovalChildPhases) {
    assert.deepEqual(
      database.pathsUnder(
        `restaurant_accounts/${targetUid}/${definition.collection}`,
      ),
      [],
    );
    assert.deepEqual(
      database.document(childPath(otherUid, definition.collection, 0)),
      {
        ownerRecordGeneration: sourceGeneration,
        retained: `other-${definition.collection}`,
      },
    );
  }
  assert.equal(database.document(returnPath), null);
  assert.equal(database.document(accountRootPath), null);
  const finalOwner = database.document(ownerPath);
  assert.equal(finalOwner.state, "removed");
  assert.equal(finalOwner.generation, completionGeneration);
  assert.equal(finalOwner.activeJobId, null);

  for (const [path, before] of Object.entries(retainedBefore)) {
    assert.deepEqual(database.document(path), before, path);
  }
  for (const definition of processor.ownerRecordRemovalStoragePhases) {
    assert.equal(
      [...storage.objects.keys()].some((name) => name.startsWith(
        storageContract.buildOwnerRecordRemovalStoragePrefix(
          targetUid,
          definition.kind,
        ),
      )),
      false,
    );
    assert.notEqual(
      storage.object(storageObject(otherUid, definition.kind, 0).name),
      null,
    );
  }
  assert.deepEqual(storage.object(sharedStorageCanary.name), sharedStorageCanary);

  for (const query of database.queries) {
    if (query.collectionPath === "bitescore_restaurants") {
      assert.ok(query.limit === 50 || query.limit === 1);
    } else {
      assert.ok(query.limit === 100 || query.limit === 1);
    }
  }
  assert.ok(database.transactions.every((entry) => entry.sets <= 51));
  assert.ok(database.transactions.every((entry) => entry.deletes <= 100));
  assert.ok(storage.listRequests.every(
    (request) => request.limit === 25 || request.limit === 1,
  ));
  assert.ok(storage.deleteRequests.length > 0);
  assert.ok(storage.deleteRequests.every((request) =>
    request.name.startsWith(
      storageContract.buildOwnerRecordRemovalStoragePrefix(
        targetUid,
        request.kind,
      ),
    )));

  const documentSnapshot = clone([...database.documents.entries()]);
  const objectSnapshot = clone([...storage.objects.entries()]);
  const repeated = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.deepEqual(repeated, result);
  assert.deepEqual([...database.documents.entries()], documentSnapshot);
  assert.deepEqual([...storage.objects.entries()], objectSnapshot);
});

test("rating generation and revision failures are fail-closed without a partial unclaim", async (t) => {
  const cases = [
    {
      name: "missing generation",
      changes: {ownerRecordGeneration: undefined},
      remove: "ownerRecordGeneration",
      expected: "record_generation_missing",
    },
    {
      name: "older generation",
      changes: {ownerRecordGeneration: sourceGeneration - 1},
      expected: "generation_mismatch",
    },
    {
      name: "newer generation",
      changes: {ownerRecordGeneration: sourceGeneration + 1},
      expected: "newer_generation_record_found",
    },
    {
      name: "exhausted revision",
      changes: {restaurantWriteRevision: Number.MAX_SAFE_INTEGER},
      expected: "unsupported_partial_state",
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const restaurant = ratingRestaurant(0, scenario.changes);
      if (scenario.remove !== undefined) delete restaurant[scenario.remove];
      const path = ratingPath(0);
      const database = new InMemoryDatabase({
        ...baseDocuments(),
        [path]: restaurant,
      });
      const before = database.document(path);
      const result = await processor.processOwnerRecordRemovalStep(
        context(database),
        jobId,
      );
      assert.equal(result.status, "manual_review_required");
      assert.equal(result.failureCategory, scenario.expected);
      assert.equal(result.ratingRestaurantsUnclaimed, 0);
      assert.deepEqual(database.document(path), before);
      assert.equal(database.document(ownerPath).state, "removing");
    });
  }
});

test("child phases reject missing, malformed, and newer generations without deleting", async (t) => {
  const cases = [
    {
      name: "missing generation",
      data: {payload: "missing-generation"},
      expected: "record_generation_missing",
    },
    {
      name: "malformed generation",
      data: {ownerRecordGeneration: String(sourceGeneration)},
      expected: "record_generation_missing",
    },
    {
      name: "newer generation",
      data: {ownerRecordGeneration: sourceGeneration + 1},
      expected: "newer_generation_record_found",
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const path = childPath(targetUid, "coupons", 0);
      const database = new InMemoryDatabase({
        ...baseDocuments("delete_coupons"),
        [path]: scenario.data,
      });
      const before = database.document(path);
      const result = await processor.processOwnerRecordRemovalStep(
        context(database),
        jobId,
      );
      assert.equal(result.status, "manual_review_required");
      assert.equal(result.failureCategory, scenario.expected);
      assert.equal(result.couponsDeleted, 0);
      assert.deepEqual(database.document(path), before);
      assert.equal(result.phase, "delete_coupons");
      assert.equal(database.document(ownerPath).state, "removing");
    });
  }
});

test("retryable work resumes only for phase-compatible failure categories", async (t) => {
  await t.test("temporary dependency resumes the exact child phase", async () => {
    const path = childPath(targetUid, "coupons", 0);
    const database = new InMemoryDatabase({
      [jobPath]: buildJob({
        status: "retryable",
        phase: "delete_coupons",
        failureCategory: "temporary_dependency",
      }),
      [ownerPath]: removingOwner(),
      [path]: {ownerRecordGeneration: sourceGeneration, value: "source"},
    });
    const result = await processor.processOwnerRecordRemovalStep(
      context(database),
      jobId,
    );
    assert.equal(result.status, "active");
    assert.equal(result.phase, "delete_coupons");
    assert.equal(result.failureCategory, null);
    assert.equal(result.couponsDeleted, 1);
    assert.equal(database.document(path), null);
  });

  for (const scenario of [
    {
      name: "Rating-lock failure cannot resume a child phase",
      failureCategory: "restaurant_lock_conflict",
    },
    {
      name: "Storage-generation failure cannot resume a child phase",
      failureCategory: "storage_generation_mismatch",
    },
    {
      name: "manual-only generation failure cannot resume as retryable",
      failureCategory: "generation_mismatch",
    },
  ]) {
    await t.test(scenario.name, async () => {
      const path = childPath(targetUid, "coupons", 0);
      const child = {
        ownerRecordGeneration: sourceGeneration,
        value: scenario.name,
      };
      const database = new InMemoryDatabase({
        [jobPath]: buildJob({
          status: "retryable",
          phase: "delete_coupons",
          failureCategory: scenario.failureCategory,
        }),
        [ownerPath]: removingOwner(),
        [path]: child,
      });
      const result = await processor.processOwnerRecordRemovalStep(
        context(database),
        jobId,
      );
      assert.equal(result.status, "manual_review_required");
      assert.equal(result.failureCategory, "unsupported_partial_state");
      assert.equal(result.couponsDeleted, 0);
      assert.deepEqual(database.document(path), child);
    });
  }
});

test("active and permanent Rating operation locks block exact unclaim semantics", async (t) => {
  for (const lockCase of [
    {
      name: "active lock is retryable and can resume",
      state: "active_source",
      active: true,
      permanent: false,
      expectedStatus: "retryable",
    },
    {
      name: "permanent lock requires manual review",
      state: "deleted_source",
      active: false,
      permanent: true,
      expectedStatus: "manual_review_required",
    },
  ]) {
    await t.test(lockCase.name, async () => {
      const restaurantId = documentId(ratingPath(0));
      const lockPath = ratingContract.ratingRestaurantOperationLockPath(
        restaurantId,
      );
      const lock = ratingContract.buildRatingRestaurantOperationLockDocument({
        restaurantId,
        jobId: "rating_operation_job_1",
        operation: "restaurantDelete",
        role: "source",
        state: lockCase.state,
        active: lockCase.active,
        permanent: lockCase.permanent,
        targetRestaurantId: null,
        createdAt,
        updatedAt: createdAt,
      });
      const database = new InMemoryDatabase({
        ...baseDocuments(),
        [ratingPath(0)]: ratingRestaurant(0),
        [lockPath]: lock,
      });
      const before = database.document(ratingPath(0));
      const processContext = context(database);
      const blocked = await processor.processOwnerRecordRemovalStep(
        processContext,
        jobId,
      );
      assert.equal(blocked.status, lockCase.expectedStatus);
      assert.equal(blocked.failureCategory, "restaurant_lock_conflict");
      assert.deepEqual(database.document(ratingPath(0)), before);

      if (lockCase.active) {
        database.delete(lockPath);
        const resumed = await processor.processOwnerRecordRemovalStep(
          processContext,
          jobId,
        );
        assert.equal(resumed.status, "active");
        assert.equal(resumed.failureCategory, null);
        assert.equal(resumed.ratingRestaurantsUnclaimed, 1);
        assert.deepEqual(database.document(ratingPath(0)), {
          ...before,
          ownerUserId: null,
          isClaimed: false,
          ownerRecordGeneration: null,
          restaurantWriteRevision: before.restaurantWriteRevision + 1,
          updatedAt: database.document(ratingPath(0)).updatedAt,
        });
      }
    });
  }
});

test("Rating ownership changed after selection is re-read and left untouched", async () => {
  const path = ratingPath(0);
  const database = new InMemoryDatabase({
    ...baseDocuments(),
    [path]: ratingRestaurant(0),
  });
  const ownershipAfterRace = {
    ...database.document(path),
    ownerUserId: otherUid,
    ownerRecordGeneration: sourceGeneration + 1,
    restaurantWriteRevision: 7_001,
    ownershipRaceCanary: "new owner won before exact-document read",
  };
  database.afterQuery = async (query, page, boundary) => {
    if (
      query.collectionPath !== "bitescore_restaurants" ||
      page.some(({id}) => id === documentId(path)) === false
    ) {
      return;
    }
    boundary.afterQuery = null;
    boundary.set(path, ownershipAfterRace);
  };

  const processContext = context(database);
  const raced = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(raced.status, "active");
  assert.equal(raced.phase, "unclaim_rating_restaurants");
  assert.equal(raced.ratingRestaurantsUnclaimed, 0);
  assert.deepEqual(database.document(path), ownershipAfterRace);

  const advanced = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(advanced.phase, "delete_coupons");
  assert.equal(advanced.ratingRestaurantsUnclaimed, 0);
  assert.deepEqual(database.document(path), ownershipAfterRace);
});

test("Rating revision changed after selection advances the current revision once", async () => {
  const path = ratingPath(0);
  const before = ratingRestaurant(0);
  const database = new InMemoryDatabase({
    ...baseDocuments(),
    [path]: before,
  });
  const revisionAfterRace = {
    ...before,
    restaurantWriteRevision: 8_001,
    revisionRaceCanary: {preserve: "concurrent writer payload"},
  };
  database.afterQuery = async (query, page, boundary) => {
    if (
      query.collectionPath !== "bitescore_restaurants" ||
      page.some(({id}) => id === documentId(path)) === false
    ) {
      return;
    }
    boundary.afterQuery = null;
    boundary.set(path, revisionAfterRace);
  };

  const result = await processor.processOwnerRecordRemovalStep(
    context(database),
    jobId,
  );
  const after = database.document(path);
  assert.equal(result.status, "active");
  assert.equal(result.ratingRestaurantsUnclaimed, 1);
  assert.equal(after.restaurantWriteRevision, 8_002);
  assert.equal(after.ownerUserId, null);
  assert.equal(after.isClaimed, false);
  assert.equal(after.ownerRecordGeneration, null);
  assert.equal(after.isActive, revisionAfterRace.isActive);
  assert.equal(after.createdByUserId, revisionAfterRace.createdByUserId);
  assert.deepEqual(
    after.revisionRaceCanary,
    revisionAfterRace.revisionRaceCanary,
  );
});

test("Rating lock becoming active after selection blocks every patch", async () => {
  const path = ratingPath(0);
  const restaurantId = documentId(path);
  const lockPath = ratingContract.ratingRestaurantOperationLockPath(
    restaurantId,
  );
  const before = ratingRestaurant(0);
  const database = new InMemoryDatabase({
    ...baseDocuments(),
    [path]: before,
  });
  const activeLock =
    ratingContract.buildRatingRestaurantOperationLockDocument({
      restaurantId,
      jobId: "rating_operation_race_job",
      operation: "restaurantDelete",
      role: "source",
      state: "active_source",
      active: true,
      permanent: false,
      targetRestaurantId: null,
      createdAt,
      updatedAt: createdAt,
    });
  database.afterQuery = async (query, page, boundary) => {
    if (
      query.collectionPath !== "bitescore_restaurants" ||
      page.some(({id}) => id === restaurantId) === false
    ) {
      return;
    }
    boundary.afterQuery = null;
    boundary.set(lockPath, activeLock);
  };

  const processContext = context(database);
  const blocked = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(blocked.status, "retryable");
  assert.equal(blocked.failureCategory, "restaurant_lock_conflict");
  assert.equal(blocked.ratingRestaurantsUnclaimed, 0);
  assert.deepEqual(database.document(path), before);
  assert.deepEqual(database.document(lockPath), activeLock);

  database.delete(lockPath);
  const resumed = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(resumed.status, "active");
  assert.equal(resumed.failureCategory, null);
  assert.equal(resumed.ratingRestaurantsUnclaimed, 1);
  assert.equal(
    database.document(path).restaurantWriteRevision,
    before.restaurantWriteRevision + 1,
  );
});

test("child already deleted after selection is an idempotent zero-count race", async () => {
  const path = childPath(targetUid, "coupons", 0);
  const database = new InMemoryDatabase({
    ...baseDocuments("delete_coupons"),
    [path]: {
      ownerRecordGeneration: sourceGeneration,
      childRaceCanary: "selected before another worker deleted it",
    },
  });
  database.afterQuery = async (query, page, boundary) => {
    if (
      query.collectionPath !== `restaurant_accounts/${targetUid}/coupons` ||
      page.some(({id}) => id === documentId(path)) === false
    ) {
      return;
    }
    boundary.afterQuery = null;
    boundary.delete(path);
  };

  const processContext = context(database);
  const raced = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(raced.status, "active");
  assert.equal(raced.phase, "delete_coupons");
  assert.equal(raced.couponsDeleted, 0);
  assert.equal(database.document(path), null);

  const advanced = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(advanced.phase, "delete_daily_specials");
  assert.equal(advanced.couponsDeleted, 0);
});

test("storage deletion is provider-generation-bound and retryable after a precondition race", async () => {
  const object = storageObject(targetUid, "coupon_images", 0, {
    providerGeneration: "7",
  });
  const database = new InMemoryDatabase(
    baseDocuments("delete_storage_coupon_images"),
  );
  const storage = new InMemoryStorage([object]);
  let raced = false;
  storage.beforeDelete = async (request, boundary) => {
    if (!raced) {
      raced = true;
      boundary.objects.set(request.name, {
        ...boundary.objects.get(request.name),
        providerGeneration: "8",
      });
    }
  };
  const processContext = context(database, storage);
  const failed = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(failed.status, "retryable");
  assert.equal(failed.failureCategory, "storage_generation_mismatch");
  assert.equal(failed.storageCouponImagesDeleted, 0);
  assert.equal(storage.object(object.name).providerGeneration, "8");
  assert.equal(storage.deleteRequests[0].providerGeneration, "7");

  storage.beforeDelete = null;
  const resumed = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(resumed.status, "active");
  assert.equal(resumed.failureCategory, null);
  assert.equal(resumed.storageCouponImagesDeleted, 1);
  assert.equal(storage.object(object.name), null);
  assert.equal(storage.deleteRequests[1].providerGeneration, "8");
});

test("Storage not-found is idempotent and dependency throws are retryable", async (t) => {
  await t.test("not-found makes no false counter increment", async () => {
    const object = storageObject(targetUid, "coupon_images", 0);
    const database = new InMemoryDatabase(
      baseDocuments("delete_storage_coupon_images"),
    );
    const storage = new InMemoryStorage([object]);
    storage.beforeDelete = async (request, boundary) => {
      boundary.objects.delete(request.name);
    };
    const processContext = context(database, storage);
    const result = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(result.status, "active");
    assert.equal(result.phase, "delete_storage_coupon_images");
    assert.equal(result.storageCouponImagesDeleted, 0);
    assert.equal(result.failureCategory, null);
    assert.equal(storage.object(object.name), null);
    assert.equal(storage.deleteRequests.length, 1);

    storage.beforeDelete = null;
    const advanced = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(advanced.phase, "delete_storage_menu_images");
    assert.equal(advanced.storageCouponImagesDeleted, 0);
  });

  await t.test("list dependency failure records retryable and resumes", async () => {
    const database = new InMemoryDatabase(
      baseDocuments("delete_storage_coupon_images"),
    );
    const storage = new InMemoryStorage();
    const originalList = storage.listFirstObjects.bind(storage);
    storage.listFirstObjects = async () => {
      throw new Error("injected list dependency failure");
    };
    const processContext = context(database, storage);
    const failed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(failed.status, "retryable");
    assert.equal(failed.failureCategory, "temporary_dependency");
    assert.equal(failed.phase, "delete_storage_coupon_images");

    storage.listFirstObjects = originalList;
    const resumed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(resumed.status, "active");
    assert.equal(resumed.failureCategory, null);
    assert.equal(resumed.phase, "delete_storage_menu_images");
  });

  await t.test("delete dependency failure preserves object and resumes", async () => {
    const object = storageObject(targetUid, "coupon_images", 0);
    const database = new InMemoryDatabase(
      baseDocuments("delete_storage_coupon_images"),
    );
    const storage = new InMemoryStorage([object]);
    storage.beforeDelete = async () => {
      throw new Error("injected delete dependency failure");
    };
    const processContext = context(database, storage);
    const failed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(failed.status, "retryable");
    assert.equal(failed.failureCategory, "temporary_dependency");
    assert.equal(failed.storageCouponImagesDeleted, 0);
    assert.deepEqual(storage.object(object.name), object);

    storage.beforeDelete = null;
    const resumed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(resumed.status, "active");
    assert.equal(resumed.failureCategory, null);
    assert.equal(resumed.storageCouponImagesDeleted, 1);
    assert.equal(storage.object(object.name), null);
  });
});

test("newer Storage generation metadata is manual and never reaches delete", async () => {
  const object = storageObject(targetUid, "menu_images", 0, {
    ownerRecordGeneration: String(sourceGeneration + 1),
  });
  const database = new InMemoryDatabase(
    baseDocuments("delete_storage_menu_images"),
  );
  const storage = new InMemoryStorage([object]);
  const result = await processor.processOwnerRecordRemovalStep(
    context(database, storage),
    jobId,
  );
  assert.equal(result.status, "manual_review_required");
  assert.equal(result.failureCategory, "newer_generation_record_found");
  assert.equal(result.storageMenuImagesDeleted, 0);
  assert.equal(storage.deleteRequests.length, 0);
  assert.deepEqual(storage.object(object.name), object);
});

test("subscription return validation and account-root generation both fail closed", async (t) => {
  await t.test("malformed return ledger remains present", async () => {
    const malformed = {
      ...validReturnState(),
      fingerprint: "0".repeat(64),
    };
    const database = new InMemoryDatabase({
      ...baseDocuments("delete_subscription_return_state"),
      [returnPath]: malformed,
    });
    const result = await processor.processOwnerRecordRemovalStep(
      context(database),
      jobId,
    );
    assert.equal(result.status, "manual_review_required");
    assert.equal(result.failureCategory, "malformed_private_state");
    assert.deepEqual(database.document(returnPath), malformed);
  });

  await t.test("newer account root remains present", async () => {
    const root = {
      ownerRecordGeneration: sourceGeneration + 1,
      retainedUntilGenerationIsResolved: true,
    };
    const database = new InMemoryDatabase({
      ...baseDocuments("delete_account_root"),
      [accountRootPath]: root,
    });
    const result = await processor.processOwnerRecordRemovalStep(
      context(database),
      jobId,
    );
    assert.equal(result.status, "manual_review_required");
    assert.equal(result.failureCategory, "newer_generation_record_found");
    assert.deepEqual(database.document(accountRootPath), root);
  });
});

test("subscription-return retries count source reappearance and reject newer reappearance", async (t) => {
  for (const counter of [0, 1]) {
    await t.test(`absent document with prior counter ${counter}`, async () => {
      const database = new InMemoryDatabase({
        [jobPath]: buildJob({
          phase: "delete_subscription_return_state",
          subscriptionReturnDocumentsDeleted: counter,
        }),
        [ownerPath]: removingOwner(),
      });
      const result = await processor.processOwnerRecordRemovalStep(
        context(database),
        jobId,
      );
      assert.equal(result.status, "active");
      assert.equal(result.phase, "delete_account_root");
      assert.equal(result.subscriptionReturnDocumentsDeleted, counter);
    });
  }

  await t.test("source-generation reappearance is deleted and counted again", async () => {
    const database = new InMemoryDatabase({
      [jobPath]: buildJob({
        phase: "delete_subscription_return_state",
        subscriptionReturnDocumentsDeleted: 1,
      }),
      [ownerPath]: removingOwner(),
      [returnPath]: validReturnState(),
    });
    const result = await processor.processOwnerRecordRemovalStep(
      context(database),
      jobId,
    );
    assert.equal(result.status, "active");
    assert.equal(result.phase, "delete_account_root");
    assert.equal(result.subscriptionReturnDocumentsDeleted, 2);
    assert.equal(database.document(returnPath), null);
  });

  await t.test("newer-generation reappearance remains and manualizes", async () => {
    const newer = validReturnState(sourceGeneration + 1);
    const database = new InMemoryDatabase({
      [jobPath]: buildJob({
        phase: "delete_subscription_return_state",
        subscriptionReturnDocumentsDeleted: 1,
      }),
      [ownerPath]: removingOwner(),
      [returnPath]: newer,
    });
    const result = await processor.processOwnerRecordRemovalStep(
      context(database),
      jobId,
    );
    assert.equal(result.status, "manual_review_required");
    assert.equal(result.phase, "delete_subscription_return_state");
    assert.equal(result.failureCategory, "newer_generation_record_found");
    assert.equal(result.subscriptionReturnDocumentsDeleted, 1);
    assert.deepEqual(database.document(returnPath), newer);
  });
});

test("account-root absence preserves its counter and source reappearance increments it", async (t) => {
  for (const counter of [0, 1]) {
    await t.test(`absent root with prior counter ${counter}`, async () => {
      const database = new InMemoryDatabase({
        [jobPath]: buildJob({
          phase: "delete_account_root",
          accountRootsDeleted: counter,
        }),
        [ownerPath]: removingOwner(),
      });
      const result = await processor.processOwnerRecordRemovalStep(
        context(database),
        jobId,
      );
      assert.equal(result.status, "active");
      assert.equal(result.phase, "verify_remnants");
      assert.equal(result.accountRootsDeleted, counter);
      assert.equal(database.document(accountRootPath), null);
    });
  }

  await t.test("reappeared root is deleted and counted again", async () => {
    const root = {
      ownerRecordGeneration: sourceGeneration,
      payload: "source-generation reappearance",
    };
    const database = new InMemoryDatabase({
      [jobPath]: buildJob({
        phase: "delete_account_root",
        accountRootsDeleted: 1,
      }),
      [ownerPath]: removingOwner(),
      [accountRootPath]: root,
    });
    const result = await processor.processOwnerRecordRemovalStep(
      context(database),
      jobId,
    );
    assert.equal(result.status, "active");
    assert.equal(result.phase, "verify_remnants");
    assert.equal(result.accountRootsDeleted, 2);
    assert.equal(database.document(accountRootPath), null);
  });
});

test("root and verification phases route remnants back before finalization", async () => {
  const coupon = childPath(targetUid, "coupons", 0);
  const database = new InMemoryDatabase({
    ...baseDocuments("delete_account_root"),
    [accountRootPath]: {
      ownerRecordGeneration: sourceGeneration,
      retainedField: "root payload",
    },
    [coupon]: {
      ownerRecordGeneration: sourceGeneration,
      retainedUntilDeletePhase: true,
    },
  });
  const processContext = context(database);

  const routedFromRoot = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(routedFromRoot.phase, "delete_coupons");
  assert.notEqual(database.document(accountRootPath), null);
  assert.notEqual(database.document(coupon), null);

  await processor.processOwnerRecordRemovalStep(processContext, jobId);
  const backToRoot = contract.rebuildOwnerRecordRemovalJobDocument(
    database.document(jobPath),
    {
      phase: "verify_remnants",
      now: new Date(database.document(jobPath).updatedAt.getTime() + 1_000),
    },
  );
  database.set(jobPath, backToRoot);
  const storageRemnant = storageObject(targetUid, "restaurant_images", 0);
  processContext.storage.objects.set(storageRemnant.name, storageRemnant);

  const routedFromVerify = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(
    routedFromVerify.phase,
    "delete_storage_restaurant_images",
  );
  assert.equal(database.document(ownerPath).state, "removing");
  assert.notEqual(database.document(accountRootPath), null);
});

test("finalization routes every post-verification source remnant and later completes", async (t) => {
  const cases = [
    {
      name: "Rating restaurant",
      phase: "unclaim_rating_restaurants",
      counter: "ratingRestaurantsUnclaimed",
      install(database) {
        const path = ratingPath(0);
        const value = ratingRestaurant(0);
        database.set(path, value);
        return {kind: "document", path, value};
      },
      verifyCleaned(result, database, remnant) {
        assert.deepEqual(database.document(remnant.path), {
          ...remnant.value,
          ownerUserId: null,
          isClaimed: false,
          ownerRecordGeneration: null,
          restaurantWriteRevision:
            remnant.value.restaurantWriteRevision + 1,
          updatedAt: database.document(remnant.path).updatedAt,
        });
      },
    },
    ...processor.ownerRecordRemovalChildPhases.map((definition) => ({
      name: definition.collection,
      phase: definition.phase,
      counter: definition.counter,
      install(database) {
        const path = childPath(targetUid, definition.collection, 0);
        const value = {
          ownerRecordGeneration: sourceGeneration,
          postVerifyCanary: definition.collection,
        };
        database.set(path, value);
        return {kind: "document", path, value};
      },
      verifyCleaned(result, database, remnant) {
        assert.equal(database.document(remnant.path), null);
      },
    })),
    {
      name: "subscription return",
      phase: "delete_subscription_return_state",
      counter: "subscriptionReturnDocumentsDeleted",
      install(database) {
        const value = validReturnState();
        database.set(returnPath, value);
        return {kind: "document", path: returnPath, value};
      },
      verifyCleaned(result, database) {
        assert.equal(database.document(returnPath), null);
      },
    },
    {
      name: "account root",
      phase: "delete_account_root",
      counter: "accountRootsDeleted",
      install(database) {
        const value = {
          ownerRecordGeneration: sourceGeneration,
          postVerifyCanary: "account-root",
        };
        database.set(accountRootPath, value);
        return {kind: "document", path: accountRootPath, value};
      },
      verifyCleaned(result, database) {
        assert.equal(database.document(accountRootPath), null);
      },
    },
    ...processor.ownerRecordRemovalStoragePhases.map((definition) => ({
      name: `Storage ${definition.kind}`,
      phase: definition.phase,
      counter: definition.counter,
      install(_database, storage) {
        const value = storageObject(targetUid, definition.kind, 0);
        storage.objects.set(value.name, clone(value));
        return {kind: "storage", name: value.name, value};
      },
      verifyCleaned(result, _database, remnant, storage) {
        assert.equal(storage.object(remnant.name), null);
      },
    })),
  ];

  assert.equal(cases.length, 13);
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const counters = Object.fromEntries(
        contract.ownerRecordRemovalCounterFields.map(
          (counter, index) => [counter, index + 3],
        ),
      );
      const database = new InMemoryDatabase({
        [jobPath]: buildJob({phase: "verify_remnants", ...counters}),
        [ownerPath]: removingOwner(),
      });
      const storage = new InMemoryStorage();
      const processContext = context(database, storage);
      await advanceToFinalization(processContext, database);
      const remnant = scenario.install(database, storage);

      const routed = await processor.processOwnerRecordRemovalStep(
        processContext,
        jobId,
      );
      assertRouteBack(routed, database, scenario.phase, counters);
      if (remnant.kind === "storage") {
        assert.deepEqual(storage.object(remnant.name), remnant.value);
      } else {
        assert.deepEqual(database.document(remnant.path), remnant.value);
      }
      assert.equal(storage.deleteRequests.length, 0);

      const cleaned = await processor.processOwnerRecordRemovalStep(
        processContext,
        jobId,
      );
      assert.equal(cleaned[scenario.counter], counters[scenario.counter] + 1);
      scenario.verifyCleaned(cleaned, database, remnant, storage);
      const completed = await runUntilComplete(processContext, 40);
      assert.equal(completed.result.status, "complete");
      assert.equal(database.document(ownerPath).state, "removed");
    });
  }
});

test("finalization manualizes post-verification newer and malformed remnants", async (t) => {
  const cases = [
    {
      name: "newer child",
      expected: "newer_generation_record_found",
      install(database) {
        const path = childPath(targetUid, "coupons", 0);
        const value = {ownerRecordGeneration: sourceGeneration + 1};
        database.set(path, value);
        return {path, value};
      },
    },
    {
      name: "missing child generation",
      expected: "record_generation_missing",
      install(database) {
        const path = childPath(targetUid, "coupons", 0);
        const value = {canary: "missing"};
        database.set(path, value);
        return {path, value};
      },
    },
    {
      name: "malformed child generation",
      expected: "record_generation_missing",
      install(database) {
        const path = childPath(targetUid, "coupons", 0);
        const value = {ownerRecordGeneration: String(sourceGeneration)};
        database.set(path, value);
        return {path, value};
      },
    },
    {
      name: "older child generation",
      expected: "generation_mismatch",
      install(database) {
        const path = childPath(targetUid, "coupons", 0);
        const value = {ownerRecordGeneration: sourceGeneration - 1};
        database.set(path, value);
        return {path, value};
      },
    },
    {
      name: "newer account root",
      expected: "newer_generation_record_found",
      install(database) {
        const value = {ownerRecordGeneration: sourceGeneration + 1};
        database.set(accountRootPath, value);
        return {path: accountRootPath, value};
      },
    },
    {
      name: "newer subscription return",
      expected: "newer_generation_record_found",
      install(database) {
        const value = validReturnState(sourceGeneration + 1);
        database.set(returnPath, value);
        return {path: returnPath, value};
      },
    },
    {
      name: "newer Storage generation",
      expected: "newer_generation_record_found",
      install(_database, storage) {
        const value = storageObject(targetUid, "restaurant_images", 0, {
          ownerRecordGeneration: String(sourceGeneration + 1),
        });
        storage.objects.set(value.name, clone(value));
        return {name: value.name, value};
      },
    },
    {
      name: "older Storage generation",
      expected: "generation_mismatch",
      install(_database, storage) {
        const value = storageObject(targetUid, "restaurant_images", 0, {
          ownerRecordGeneration: String(sourceGeneration - 1),
        });
        storage.objects.set(value.name, clone(value));
        return {name: value.name, value};
      },
    },
    ...[
      ["missing Storage generation", undefined],
      ["malformed Storage generation", "04"],
    ].map(([name, ownerRecordGeneration]) => ({
      name,
      expected: "record_generation_missing",
      install(_database, storage) {
        const value = storageObject(targetUid, "restaurant_images", 0, {
          ownerRecordGeneration,
        });
        if (ownerRecordGeneration === undefined) {
          delete value.ownerRecordGeneration;
        }
        storage.objects.set(value.name, clone(value));
        return {name: value.name, value};
      },
    })),
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const database = new InMemoryDatabase(
        baseDocuments("verify_remnants"),
      );
      const storage = new InMemoryStorage();
      const unrelatedPath = childPath(otherUid, "coupons", 99);
      const unrelatedDocument = {
        ownerRecordGeneration: sourceGeneration + 99,
        unrelatedCanary: scenario.name,
      };
      const unrelatedStorage = storageObject(
        otherUid,
        "restaurant_images",
        99,
        {ownerRecordGeneration: String(sourceGeneration + 99)},
      );
      database.set(unrelatedPath, unrelatedDocument);
      storage.objects.set(unrelatedStorage.name, clone(unrelatedStorage));
      const processContext = context(database, storage);
      await advanceToFinalization(processContext, database);
      const remnant = scenario.install(database, storage);
      const failed = await processor.processOwnerRecordRemovalStep(
        processContext,
        jobId,
      );
      assert.equal(failed.status, "manual_review_required");
      assert.equal(failed.phase, "finalize_owner_state");
      assert.equal(failed.failureCategory, scenario.expected);
      assert.equal(database.document(ownerPath).state, "removing");
      assert.equal(database.document(ownerPath).activeJobId, jobId);
      assert.equal(database.document(ownerPath).generation, completionGeneration);
      assert.equal(storage.deleteRequests.length, 0);
      if (remnant.name !== undefined) {
        assert.deepEqual(storage.object(remnant.name), remnant.value);
      } else {
        assert.deepEqual(database.document(remnant.path), remnant.value);
      }
      assert.deepEqual(database.document(unrelatedPath), unrelatedDocument);
      assert.deepEqual(
        storage.object(unrelatedStorage.name),
        unrelatedStorage,
      );
    });
  }
});

test("successful finalization repeats bounded Storage and transactional Firestore barriers", async () => {
  const database = new InMemoryDatabase(
    baseDocuments("finalize_owner_state"),
  );
  const storage = new InMemoryStorage();
  const processContext = context(database, storage);
  const result = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(result.status, "complete");
  assert.deepEqual(
    storage.listRequests,
    processor.ownerRecordRemovalStoragePhases.map((definition) => ({
      targetUid,
      kind: definition.kind,
      limit: 1,
    })),
  );
  assert.deepEqual(storage.deleteRequests, []);
  const completionTransaction = database.transactions.find(
    (entry) => entry.committed &&
      entry.setPaths?.includes(ownerPath) &&
      entry.setPaths?.includes(jobPath),
  );
  assert.ok(completionTransaction);
  assert.equal(completionTransaction.queries.length, 8);
  assert.ok(completionTransaction.queries.every((query) => query.limit === 1));
  assert.ok(completionTransaction.gets.includes(returnPath));
  assert.ok(completionTransaction.gets.includes(accountRootPath));
  assert.equal(database.document(ownerPath).state, "removed");
});

test("final Firestore transaction observes a remnant introduced at its read boundary", async () => {
  const path = childPath(targetUid, "coupons", 0);
  const value = {
    ownerRecordGeneration: sourceGeneration,
    finalTransactionCanary: true,
  };
  const database = new InMemoryDatabase(
    baseDocuments("finalize_owner_state"),
  );
  database.beforeQuery = async (query, boundary) => {
    if (!query.collectionPath.endsWith("/coupons")) return;
    database.beforeQuery = null;
    boundary.set(path, value);
  };
  const result = await processor.processOwnerRecordRemovalStep(
    context(database),
    jobId,
  );
  assert.equal(result.status, "active");
  assert.equal(result.phase, "delete_coupons");
  assert.deepEqual(database.document(path), value);
  assert.equal(database.document(ownerPath).state, "removing");
});

test("a retried final transaction rechecks remnants before committing completion", async () => {
  const path = childPath(targetUid, "coupons", 0);
  const value = {
    ownerRecordGeneration: sourceGeneration,
    retryCanary: true,
  };
  const database = new InMemoryDatabase(
    baseDocuments("finalize_owner_state"),
  );
  let retried = false;
  database.beforeCommit = async (stats, boundary) => {
    if (
      retried ||
      stats.setPaths?.includes(ownerPath) !== true ||
      stats.setPaths?.includes(jobPath) !== true
    ) {
      return;
    }
    retried = true;
    boundary.set(path, value);
    throw new RetryTransaction();
  };
  const result = await processor.processOwnerRecordRemovalStep(
    context(database),
    jobId,
  );
  assert.equal(retried, true);
  assert.equal(result.status, "active");
  assert.equal(result.phase, "delete_coupons");
  assert.deepEqual(database.document(path), value);
  assert.equal(database.document(ownerPath).state, "removing");
  assert.equal(database.document(ownerPath).activeJobId, jobId);
  assert.ok(database.transactions.some((entry) => entry.retried === true));
});

test("final Storage barrier respects stale job and owner state after listing", async (t) => {
  await t.test("another worker changes phase", async () => {
    const database = new InMemoryDatabase(
      baseDocuments("finalize_owner_state"),
    );
    const storage = new InMemoryStorage();
    storage.afterList = async (_request, _page, boundary) => {
      boundary.afterList = null;
      const current = database.document(jobPath);
      database.set(jobPath, contract.rebuildOwnerRecordRemovalJobDocument(
        current,
        {
          phase: "delete_coupons",
          now: new Date(current.updatedAt.getTime() + 10_000),
        },
      ));
    };
    const result = await processor.processOwnerRecordRemovalStep(
      context(database, storage),
      jobId,
    );
    assert.equal(result.phase, "delete_coupons");
    assert.equal(database.document(ownerPath).state, "removing");
  });

  await t.test("another worker manualizes", async () => {
    const database = new InMemoryDatabase(
      baseDocuments("finalize_owner_state"),
    );
    const storage = new InMemoryStorage();
    storage.afterList = async (_request, _page, boundary) => {
      boundary.afterList = null;
      const current = database.document(jobPath);
      database.set(jobPath, contract.rebuildOwnerRecordRemovalJobDocument(
        current,
        {
          status: "manual_review_required",
          failureCategory: "unsupported_partial_state",
          now: new Date(current.updatedAt.getTime() + 10_000),
        },
      ));
    };
    const result = await processor.processOwnerRecordRemovalStep(
      context(database, storage),
      jobId,
    );
    assert.equal(result.status, "manual_review_required");
    assert.equal(result.failureCategory, "unsupported_partial_state");
    assert.equal(database.document(ownerPath).state, "removing");
  });

  await t.test("another worker completes", async () => {
    const database = new InMemoryDatabase(
      baseDocuments("finalize_owner_state"),
    );
    const storage = new InMemoryStorage();
    let completedJob;
    let removedOwner;
    storage.afterList = async (_request, _page, boundary) => {
      boundary.afterList = null;
      const currentJob = database.document(jobPath);
      const currentOwner = database.document(ownerPath);
      const now = new Date(currentJob.updatedAt.getTime() + 10_000);
      completedJob = contract.rebuildOwnerRecordRemovalJobDocument(
        currentJob,
        {
          status: "complete",
          phase: "complete",
          failureCategory: null,
          completedAt: now,
          now,
        },
      );
      removedOwner = ownerState.buildOwnerRecordStateDocument({
        ownerUid: targetUid,
        generation: completionGeneration,
        state: "removed",
        activeJobId: null,
        createdAt: currentOwner.createdAt,
        updatedAt: now,
      });
      database.set(jobPath, completedJob);
      database.set(ownerPath, removedOwner);
    };
    const result = await processor.processOwnerRecordRemovalStep(
      context(database, storage),
      jobId,
    );
    assert.equal(result.status, "complete");
    assert.equal(result.phase, "complete");
    assert.deepEqual(database.document(jobPath), completedJob);
    assert.deepEqual(database.document(ownerPath), removedOwner);
    assert.equal(
      database.transactions.filter(
        (entry) => entry.committed && entry.setPaths?.some(
          (path) => path === ownerPath || path === jobPath,
        ),
      ).length,
      0,
    );
  });

  await t.test("owner generation changes", async () => {
    const database = new InMemoryDatabase(
      baseDocuments("finalize_owner_state"),
    );
    const storage = new InMemoryStorage();
    storage.afterList = async (_request, _page, boundary) => {
      boundary.afterList = null;
      const current = database.document(ownerPath);
      database.set(ownerPath, ownerState.buildOwnerRecordStateDocument({
        ownerUid: targetUid,
        generation: completionGeneration + 1,
        state: "removing",
        activeJobId: jobId,
        createdAt: current.createdAt,
        updatedAt: new Date(current.updatedAt.getTime() + 10_000),
      }));
    };
    await assert.rejects(
      processor.processOwnerRecordRemovalStep(
        context(database, storage),
        jobId,
      ),
      (error) => error instanceof processor.OwnerRecordRemovalProcessError &&
        error.code === "generation_mismatch",
    );
    assert.equal(database.document(jobPath).status, "active");
    assert.equal(database.document(jobPath).phase, "finalize_owner_state");
    assert.equal(database.document(ownerPath).state, "removing");
    assert.equal(database.document(ownerPath).generation, completionGeneration + 1);
  });
});

test("final Storage barrier routes listed objects without deleting them", async (t) => {
  for (const scenario of ["disappears", "provider generation changes"]) {
    await t.test(scenario, async () => {
      const object = storageObject(targetUid, "restaurant_images", 0);
      const database = new InMemoryDatabase(
        baseDocuments("finalize_owner_state"),
      );
      const storage = new InMemoryStorage([object]);
      storage.afterList = async (request, page, boundary) => {
        if (request.kind !== "restaurant_images" || page.length === 0) return;
        boundary.afterList = null;
        if (scenario === "disappears") {
          boundary.objects.delete(object.name);
        } else {
          boundary.objects.set(object.name, {
            ...object,
            providerGeneration: "99",
          });
        }
      };
      const processContext = context(database, storage);
      const routed = await processor.processOwnerRecordRemovalStep(
        processContext,
        jobId,
      );
      assert.equal(routed.status, "active");
      assert.equal(routed.phase, "delete_storage_restaurant_images");
      assert.equal(routed.storageRestaurantImagesDeleted, 0);
      assert.equal(storage.deleteRequests.length, 0);
      assert.equal(database.document(ownerPath).state, "removing");

      const cleaned = await processor.processOwnerRecordRemovalStep(
        processContext,
        jobId,
      );
      assert.equal(
        cleaned.storageRestaurantImagesDeleted,
        scenario === "disappears" ? 0 : 1,
      );
      assert.equal(storage.object(object.name), null);
      assert.equal(
        storage.deleteRequests.length,
        scenario === "disappears" ? 0 : 1,
      );
      if (scenario === "provider generation changes") {
        assert.equal(storage.deleteRequests[0].providerGeneration, "99");
      }
    });
  }
});

test("listed Storage remnant cannot let a stale route overwrite a newer phase", async () => {
  const object = storageObject(targetUid, "restaurant_images", 0);
  const counters = Object.fromEntries(
    contract.ownerRecordRemovalCounterFields.map(
      (counter, index) => [counter, index + 7],
    ),
  );
  const database = new InMemoryDatabase({
    [jobPath]: buildJob({phase: "finalize_owner_state", ...counters}),
    [ownerPath]: removingOwner(),
  });
  const storage = new InMemoryStorage([object]);
  let newerJob;
  storage.afterList = async (request, page, boundary) => {
    if (request.kind !== "restaurant_images" || page.length === 0) return;
    boundary.afterList = null;
    const current = database.document(jobPath);
    newerJob = contract.rebuildOwnerRecordRemovalJobDocument(current, {
      phase: "delete_coupons",
      now: new Date(current.updatedAt.getTime() + 10_000),
    });
    database.set(jobPath, newerJob);
  };

  const result = await processor.processOwnerRecordRemovalStep(
    context(database, storage),
    jobId,
  );
  assert.deepEqual(result, newerJob);
  assert.deepEqual(database.document(jobPath), newerJob);
  assert.deepEqual(storage.object(object.name), object);
  assert.equal(storage.deleteRequests.length, 0);
  assert.equal(database.document(ownerPath).state, "removing");
  assert.equal(database.document(ownerPath).generation, completionGeneration);
  for (const counter of contract.ownerRecordRemovalCounterFields) {
    assert.equal(result[counter], counters[counter], counter);
  }
});

test("root, verification, and finalization failures remain retry-safe", async (t) => {
  await t.test("failure before root commit deletes nothing and retry resumes", async () => {
    const root = {
      ownerRecordGeneration: sourceGeneration,
      payload: "root-before-commit",
    };
    const database = new InMemoryDatabase({
      ...baseDocuments("delete_account_root"),
      [accountRootPath]: root,
    });
    oneShotCommitFailure(
      database,
      "before",
      (stats) => stats.deletePaths?.includes(accountRootPath) === true,
    );
    const processContext = context(database);
    const failed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(failed.status, "retryable");
    assert.equal(failed.phase, "delete_account_root");
    assert.equal(failed.failureCategory, "temporary_dependency");
    assert.equal(failed.accountRootsDeleted, 0);
    assert.deepEqual(database.document(accountRootPath), root);

    const resumed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(resumed.status, "active");
    assert.equal(resumed.phase, "verify_remnants");
    assert.equal(resumed.accountRootsDeleted, 1);
    assert.equal(database.document(accountRootPath), null);
  });

  await t.test("unknown response after root commit returns committed progress", async () => {
    const database = new InMemoryDatabase({
      ...baseDocuments("delete_account_root"),
      [accountRootPath]: {
        ownerRecordGeneration: sourceGeneration,
        payload: "root-after-commit",
      },
    });
    oneShotCommitFailure(
      database,
      "after",
      (stats) => stats.deletePaths?.includes(accountRootPath) === true,
    );
    const processContext = context(database);
    const result = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(result.status, "active");
    assert.equal(result.phase, "verify_remnants");
    assert.equal(result.failureCategory, null);
    assert.equal(result.accountRootsDeleted, 1);
    assert.equal(database.document(accountRootPath), null);

    const retried = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(retried.status, "active");
    assert.equal(retried.phase, "finalize_owner_state");
    assert.equal(retried.accountRootsDeleted, 1);
  });

  await t.test("verification read failure records exact retryable phase", async () => {
    const database = new InMemoryDatabase(
      baseDocuments("verify_remnants"),
    );
    database.beforeQuery = async () => {
      database.beforeQuery = null;
      throw new Error("injected verification query failure");
    };
    const processContext = context(database);
    const failed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(failed.status, "retryable");
    assert.equal(failed.phase, "verify_remnants");
    assert.equal(failed.failureCategory, "temporary_dependency");
    assert.equal(database.document(ownerPath).state, "removing");

    const resumed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(resumed.status, "active");
    assert.equal(resumed.phase, "finalize_owner_state");
    assert.equal(resumed.failureCategory, null);
    assert.equal(database.document(ownerPath).state, "removing");
  });

  await t.test("final Storage list failure preserves final phase and resumes", async () => {
    const counters = Object.fromEntries(
      contract.ownerRecordRemovalCounterFields.map(
        (counter, index) => [counter, index + 5],
      ),
    );
    const database = new InMemoryDatabase({
      [jobPath]: buildJob({phase: "finalize_owner_state", ...counters}),
      [ownerPath]: removingOwner(),
    });
    const storage = new InMemoryStorage();
    const listFirstObjects = storage.listFirstObjects.bind(storage);
    let failedOnce = false;
    storage.listFirstObjects = async (request) => {
      if (!failedOnce) {
        failedOnce = true;
        throw new Error("injected final Storage list failure");
      }
      return listFirstObjects(request);
    };
    const processContext = context(database, storage);
    const failed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(failed.status, "retryable");
    assert.equal(failed.phase, "finalize_owner_state");
    assert.equal(failed.failureCategory, "temporary_dependency");
    assert.equal(failed.completionGeneration, completionGeneration);
    assert.equal(database.document(ownerPath).state, "removing");
    assert.equal(database.document(ownerPath).activeJobId, jobId);
    assert.equal(database.document(ownerPath).generation, completionGeneration);
    assert.equal(storage.deleteRequests.length, 0);
    for (const counter of contract.ownerRecordRemovalCounterFields) {
      assert.equal(failed[counter], counters[counter], counter);
    }

    const resumed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.phase, "complete");
    assert.equal(resumed.failureCategory, null);
    assert.equal(database.document(ownerPath).state, "removed");
    assert.equal(database.document(ownerPath).activeJobId, null);
    for (const counter of contract.ownerRecordRemovalCounterFields) {
      assert.equal(resumed[counter], counters[counter], counter);
    }
  });

  await t.test("finalization commit failure preserves removing owner", async () => {
    const database = new InMemoryDatabase(
      baseDocuments("finalize_owner_state"),
    );
    oneShotCommitFailure(
      database,
      "before",
      (stats) => stats.setPaths?.includes(ownerPath) === true &&
        stats.setPaths?.includes(jobPath) === true,
    );
    const processContext = context(database);
    const failed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(failed.status, "retryable");
    assert.equal(failed.phase, "finalize_owner_state");
    assert.equal(failed.failureCategory, "temporary_dependency");
    assert.equal(database.document(ownerPath).state, "removing");
    assert.equal(database.document(ownerPath).activeJobId, jobId);
    assert.equal(database.beforeCommit, null);

    const resumed = await processor.processOwnerRecordRemovalStep(
      processContext,
      jobId,
    );
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.phase, "complete");
    assert.equal(resumed.failureCategory, null);
    assert.equal(database.document(ownerPath).state, "removed");
    assert.equal(database.document(ownerPath).activeJobId, null);
  });
});

test("concurrent workers commit one Rating page once and stale work cannot double-increment revisions", async () => {
  const documents = baseDocuments();
  for (let index = 0; index < 60; index += 1) {
    documents[ratingPath(index)] = ratingRestaurant(index);
  }
  const database = new InMemoryDatabase(documents);
  const processContext = context(database);
  const [first, second] = await Promise.all([
    processor.processOwnerRecordRemovalStep(processContext, jobId),
    processor.processOwnerRecordRemovalStep(processContext, jobId),
  ]);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.ratingRestaurantsUnclaimed, 50);
  assert.equal(second.ratingRestaurantsUnclaimed, 50);
  assert.equal(
    [...database.documents.values()].filter(
      (data) => data.ownerUserId === targetUid,
    ).length,
    10,
  );
  for (let index = 0; index < 50; index += 1) {
    assert.equal(
      database.document(ratingPath(index)).restaurantWriteRevision,
      1_001 + index,
    );
  }
  for (let index = 50; index < 60; index += 1) {
    assert.equal(
      database.document(ratingPath(index)).restaurantWriteRevision,
      1_000 + index,
    );
  }

  const next = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(next.ratingRestaurantsUnclaimed, 60);
  for (let index = 0; index < 60; index += 1) {
    assert.equal(
      database.document(ratingPath(index)).restaurantWriteRevision,
      1_001 + index,
    );
  }
});

test("worker A manualizes while stale Storage worker B cannot overwrite it", async () => {
  const objects = Array.from(
    {length: 3},
    (_, index) => storageObject(targetUid, "restaurant_images", index),
  );
  const database = new InMemoryDatabase(
    baseDocuments("delete_storage_restaurant_images"),
  );
  const storage = new InMemoryStorage(objects);
  let changed = false;
  storage.afterDelete = async () => {
    if (changed) return;
    changed = true;
    const current = database.document(jobPath);
    database.set(jobPath, contract.rebuildOwnerRecordRemovalJobDocument(
      current,
      {
        status: "manual_review_required",
        failureCategory: "unsupported_partial_state",
        now: new Date(current.updatedAt.getTime() + 10_000),
      },
    ));
  };

  const processContext = context(database, storage);
  const result = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.equal(result.status, "manual_review_required");
  assert.equal(result.failureCategory, "unsupported_partial_state");
  assert.equal(result.storageRestaurantImagesDeleted, 0);
  assert.equal(storage.object(objects[0].name), null);
  assert.deepEqual(storage.object(objects[1].name), objects[1]);
  assert.deepEqual(storage.object(objects[2].name), objects[2]);
  assert.equal(storage.deleteRequests.length, 1);
  assert.deepEqual(result, database.document(jobPath));

  const repeated = await processor.processOwnerRecordRemovalStep(
    processContext,
    jobId,
  );
  assert.deepEqual(repeated, result);
  assert.equal(repeated.storageRestaurantImagesDeleted, 0);
  assert.equal(storage.deleteRequests.length, 1);
});
