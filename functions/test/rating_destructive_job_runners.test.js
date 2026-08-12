"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  claimRatingDestructiveOperation,
  processRatingDestructiveJobStep,
} = require("../lib/rating_destructive_job_processor.js");
const {
  createRatingDestructiveCallerBindingFingerprint,
  ratingDestructiveJobCollection,
  ratingDestructiveJobItemCollection,
  ratingDestructiveJobPath,
  ratingDishOperationLockCollection,
  ratingRestaurantOperationLockCollection,
} = require("../lib/rating_destructive_job_contract.js");
const {
  dishMergeReviewLockPath,
} = require("../lib/dish_proposal_private_contract.js");
const {
  buildReviewMilestoneReconciliationLockDocument,
  reviewMilestoneReconciliationLockPath,
} = require("../lib/review_milestone_reconciliation_lock.js");
const {
  loadRatingDestructiveJob,
  updateRatingDestructiveJob,
} = require("../lib/rating_destructive_job_runtime.js");
const {
  processRestaurantMergeStep,
} = require("../lib/rating_restaurant_merge_job.js");
const {
  processRestaurantDeleteStep,
} = require("../lib/rating_restaurant_delete_job.js");
const {
  processDishMergeStep,
} = require("../lib/rating_dish_merge_job.js");
const {
  processStandaloneDishDeleteStep,
} = require("../lib/rating_dish_delete_job.js");

const baseTime = new Date("2026-08-11T12:00:00.000Z");
const contractVersion = "bitestar.rating-destructive-job.v1";
const adminCaller = Object.freeze({
  authorizedCallerKind: "admin",
  callerBindingFingerprint:
    createRatingDestructiveCallerBindingFingerprint("admin-test-uid"),
  authorizedCallerUid: "admin-test-uid",
});
const privacyCanaries = Object.freeze([
  "private-review-text-canary",
  "private-report-body-canary",
  "private-proposal-reason-canary",
  "private-email-canary@example.test",
  "+1-555-private-phone-canary",
  "private-owner-uid-canary",
  "private-user-profile-canary",
  "private-auth-token-canary",
  "sk_live_private_stripe_canary",
  "private-arbitrary-nested-map-canary",
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function compareValues(left, right) {
  const normalizedLeft = left instanceof Date ? left.getTime() : left;
  const normalizedRight = right instanceof Date ? right.getTime() : right;
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function fieldValue(document, field) {
  return field === "__name__" ? document.id : document.data[field];
}

function matchesCondition(document, condition) {
  const comparison = compareValues(
    fieldValue(document, condition.field),
    condition.value,
  );
  switch (condition.operator) {
    case "==": return comparison === 0;
    case "<=": return comparison <= 0;
    case ">=": return comparison >= 0;
    case "<": return comparison < 0;
    case ">": return comparison > 0;
    default: throw new Error(`Unsupported operator ${condition.operator}`);
  }
}

function compareDocuments(left, right, orderBy) {
  for (const order of orderBy ?? []) {
    const comparison = compareValues(
      fieldValue(left, order.field),
      fieldValue(right, order.field),
    );
    if (comparison !== 0) {
      return order.direction === "desc" ? -comparison : comparison;
    }
  }
  return left.id.localeCompare(right.id);
}

function isAfterCursor(document, query) {
  if (query.startAfter === undefined || query.startAfter === null) return true;
  const orderBy = query.orderBy ?? [];
  for (let index = 0; index < orderBy.length; index += 1) {
    const comparison = compareValues(
      fieldValue(document, orderBy[index].field),
      query.startAfter[index],
    );
    if (comparison !== 0) {
      return orderBy[index].direction === "desc"
        ? comparison < 0
        : comparison > 0;
    }
  }
  return false;
}

class InMemoryDestructiveDatabase {
  constructor() {
    this.records = new Map();
    this.transactionTail = Promise.resolve();
    this.attemptedQueries = [];
    this.committedTransactions = [];
    this.failure = null;
  }

  seed(path, data, createTime = baseTime) {
    this.records.set(path, {
      data: clone(data),
      createTime: createTime === null ? null : new Date(createTime.getTime()),
    });
  }

  data(path) {
    return clone(this.records.get(path)?.data);
  }

  has(path) {
    return this.records.has(path);
  }

  remove(path) {
    this.records.delete(path);
  }

  patch(path, data) {
    const stored = this.records.get(path);
    assert.ok(stored, `Cannot patch missing ${path}`);
    this.records.set(path, {
      data: {...clone(stored.data), ...clone(data)},
      createTime: stored.createTime,
    });
  }

  documentsIn(collectionPath) {
    const prefix = `${collectionPath}/`;
    const segments = collectionPath.split("/").length + 1;
    return [...this.records.entries()]
      .filter(([path]) =>
        path.startsWith(prefix) && path.split("/").length === segments)
      .map(([path, stored]) => ({
        id: path.slice(prefix.length),
        path,
        data: clone(stored.data),
        createTime: stored.createTime === null
          ? null
          : new Date(stored.createTime.getTime()),
      }));
  }

  failOneCommitWhen(predicate, code = "aborted") {
    assert.equal(this.failure, null);
    this.failure = {predicate, code};
  }

  async runTransaction(operation) {
    const run = this.transactionTail.then(async () => {
      const working = new Map(
        [...this.records.entries()].map(([path, value]) => [path, clone(value)]),
      );
      const transaction = new InMemoryDestructiveTransaction(this, working);
      const result = await operation(transaction);
      if (
        this.failure !== null &&
        this.failure.predicate(transaction.operations)
      ) {
        const {code} = this.failure;
        this.failure = null;
        throw Object.assign(new Error("injected transaction failure"), {code});
      }
      this.records = working;
      this.committedTransactions.push(clone(transaction.operations));
      return result;
    });
    this.transactionTail = run.catch(() => undefined);
    return run;
  }
}

class InMemoryDestructiveTransaction {
  constructor(database, working) {
    this.database = database;
    this.working = working;
    this.operations = [];
  }

  async getDocument(path) {
    this.operations.push({type: "get", path});
    const stored = this.working.get(path);
    if (stored === undefined) return null;
    return {
      id: path.slice(path.lastIndexOf("/") + 1),
      data: clone(stored.data),
      createTime: stored.createTime === null
        ? null
        : new Date(stored.createTime.getTime()),
    };
  }

  async queryDocuments(query) {
    this.database.attemptedQueries.push(clone(query));
    this.operations.push({type: "query", query: clone(query)});
    return this.database.documentsIn.call(
      {records: this.working},
      query.collectionPath,
    )
      .filter((document) =>
        (query.where ?? []).every((condition) =>
          matchesCondition(document, condition)))
      .sort((left, right) => compareDocuments(left, right, query.orderBy))
      .filter((document) => isAfterCursor(document, query))
      .slice(0, query.limit)
      .map((document) => ({
        id: document.id,
        data: clone(document.data),
        createTime: document.createTime,
      }));
  }

  setDocument(path, data, options) {
    this.operations.push({
      type: "set",
      path,
      data: clone(data),
      merge: options?.merge === true,
    });
    const existing = this.working.get(path);
    const nextData = options?.merge === true && existing !== undefined
      ? {...clone(existing.data), ...clone(data)}
      : clone(data);
    this.working.set(path, {
      data: nextData,
      createTime: existing?.createTime ?? new Date(baseTime.getTime()),
    });
  }

  deleteDocument(path) {
    this.operations.push({type: "delete", path});
    this.working.delete(path);
  }
}

function createExternalSteps(overrides = {}) {
  const calls = {
    reverse: [],
    claim: [],
    reset: [],
    scan: [],
    reconcile: [],
    release: [],
  };
  const external = {
    async reverseDishContributionPointsStep(value) {
      calls.reverse.push(clone(value));
      return {processedCount: 0, nextCursor: null, complete: true};
    },
    async claimMilestoneUser(identity) {
      calls.claim.push(clone(identity));
      return {status: "acquired"};
    },
    async resetMilestoneAccumulatorStep(identity, cursor) {
      calls.reset.push({identity: clone(identity), cursor: clone(cursor)});
      return {processedCount: 0, nextCursor: null, complete: true};
    },
    async scanMilestoneReviewsStep(identity, cursor) {
      calls.scan.push({identity: clone(identity), cursor: clone(cursor)});
      return {
        processedCount: 0,
        nextCursor: null,
        complete: true,
        validReviewCount: 0,
      };
    },
    async reconcileMilestoneStep(identity, count, cursor) {
      calls.reconcile.push({
        identity: clone(identity),
        count,
        cursor: clone(cursor),
      });
      return {processedCount: 0, nextCursor: null, complete: true};
    },
    async releaseMilestoneUser(identity) {
      calls.release.push(clone(identity));
      return {status: "released"};
    },
    ...overrides,
  };
  return {external, calls};
}

function dependencies(database, external) {
  return Object.freeze({database, external});
}

function restaurant(id, overrides = {}) {
  return {
    id,
    name: `Restaurant ${id}`,
    isActive: true,
    isClaimed: false,
    ownerUserId: null,
    phone: null,
    bio: null,
    cuisineTags: [],
    restaurantWriteRevision: 4,
    ...overrides,
  };
}

function dish(id, restaurantId, overrides = {}) {
  return {
    id,
    name: `Dish ${id}`,
    normalizedName: `dish ${id}`,
    restaurantId,
    restaurantName: `Restaurant ${restaurantId}`,
    isActive: true,
    aggregateWriteGeneration: 0,
    ...overrides,
  };
}

function review(id, dishId, restaurantId, userId, overrides = {}) {
  return {
    id,
    dishId,
    restaurantId,
    userId,
    overallImpression: 4,
    tastinessScore: 4,
    qualityScore: 4,
    valueScore: 4,
    overallBiteScore: 80,
    headline: privacyCanaries[0],
    arbitraryNestedMap: {value: privacyCanaries[9]},
    createdAt: new Date(baseTime.getTime()),
    updatedAt: new Date(baseTime.getTime()),
    ...overrides,
  };
}

const runnerClockOffsets = new WeakMap();

async function runUntil(deps, jobId, predicate, maximumSteps = 1_000) {
  const results = [];
  for (let step = 0; step < maximumSteps; step += 1) {
    const offset = runnerClockOffsets.get(deps.database) ?? 10_000;
    runnerClockOffsets.set(deps.database, offset + 1);
    const result = await processRatingDestructiveJobStep(
      deps,
      jobId,
      new Date(baseTime.getTime() + offset),
    );
    results.push(result);
    if (predicate(result.job)) return results;
  }
  const last = results.at(-1)?.job;
  const itemState = typeof deps.database.documentsIn === "function"
    ? deps.database.documentsIn(ratingDestructiveJobItemCollection).map(
      (document) => ({
        kind: document.data.kind,
        status: document.data.status,
        subphase: document.data.subphase,
      }),
    )
    : [];
  throw new Error(
    `Job ${jobId} did not reach the expected state: ` +
    `${last?.status}/${last?.phase}/${last?.failureCode}; ` +
    `items=${JSON.stringify(itemState)}`,
  );
}

async function runToTerminal(deps, jobId, maximumSteps = 2_000) {
  return runUntil(
    deps,
    jobId,
    (job) => job.status === "complete" ||
      job.status === "manual_review_required",
    maximumSteps,
  );
}

function privateDocuments(database) {
  const prefixes = [
    ratingDestructiveJobCollection,
    ratingDestructiveJobItemCollection,
    ratingRestaurantOperationLockCollection,
    ratingDishOperationLockCollection,
    "private_dish_merge_review_locks",
    "private_review_milestone_reconciliation_locks",
    "private_review_milestone_reconciliation_terminal_states",
  ];
  return [...database.records.entries()]
    .filter(([path]) => prefixes.some((prefix) =>
      path === prefix || path.startsWith(`${prefix}/`)))
    .map(([path, stored]) => ({path, data: stored.data}));
}

function assertNoPrivateCanaries(database) {
  const serialized = JSON.stringify(privateDocuments(database));
  for (const canary of privacyCanaries) {
    assert.equal(serialized.includes(canary), false, `private leak: ${canary}`);
  }
}

function assertBoundedQueries(database) {
  assert.ok(database.attemptedQueries.length > 0);
  for (const query of database.attemptedQueries) {
    assert.ok(Number.isInteger(query.limit));
    assert.ok(query.limit >= 1 && query.limit <= 100, JSON.stringify(query));
  }
}

function sha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function pointCursor(operationId, dishId, afterLedgerDocumentId) {
  const version = "bitestar.contribution-dish-reverse-cursor.v2";
  const operationFingerprint = sha([
    "bitestar.review-milestone-operation.v1",
    ["operationId", operationId],
  ]);
  const dishFingerprint = sha([
    version,
    ["dishId", dishId],
  ]);
  const core = {
    version,
    phase: "dish-ledger",
    operationFingerprint,
    dishFingerprint,
    afterLedgerDocumentId,
  };
  return {
    ...core,
    fingerprint: sha([
      version,
      ["phase", core.phase],
      ["operationFingerprint", operationFingerprint],
      ["dishFingerprint", dishFingerprint],
      ["afterLedgerDocumentId", afterLedgerDocumentId],
    ]),
  };
}

function activeMilestoneLock(userId, operationId = "other-operation") {
  return buildReviewMilestoneReconciliationLockDocument({
    userId,
    operationId,
    lockToken: sha([operationId, userId]),
    state: "active",
    createdAt: baseTime,
    updatedAt: baseTime,
  });
}

const failureBoundaryCodes = Object.freeze({
  after_claim_revision_locks: "temporary_dependency",
  during_collection_page: "temporary_dependency",
  after_page_writes_before_cursor_advancement: "temporary_dependency",
  during_aggregate_work: "temporary_dependency",
  during_aggregate_raw_scan: "temporary_dependency",
  during_aggregate_winner_fold: "temporary_dependency",
  before_source_retirement: "temporary_dependency",
  during_dish_review_trust_cleanup: "temporary_dependency",
  during_review_feedback_cleanup: "temporary_dependency",
  during_review_report_cleanup: "temporary_dependency",
  during_point_reversal: "temporary_dependency",
  during_milestone_reconciliation: "temporary_dependency",
  during_milestone_review_count: "temporary_dependency",
  during_milestone_ledger_reconcile: "temporary_dependency",
  before_aggregate_deletion: "temporary_dependency",
  before_dish_hard_delete: "temporary_dependency",
  before_restaurant_hard_delete: "temporary_dependency",
  before_final_hard_delete: "temporary_dependency",
  during_target_unlock: "temporary_dependency",
  during_final_lock_conversion: "temporary_dependency",
  during_job_completion: "temporary_dependency",
  active_milestone_lock: "preexisting_job_active",
});

function jobContinuation(job) {
  return {
    phase: job.phase,
    cursorDocumentId: job.cursorDocumentId,
    itemCursorId: job.itemCursorId,
    aggregateCursorDocumentId: job.aggregateCursorDocumentId,
    aggregateWinnerCursorId: job.aggregateWinnerCursorId,
    aggregateState: job.aggregateState,
    processedCount: job.processedCount,
    phaseProcessedCount: job.phaseProcessedCount,
  };
}

function currentJob(database, jobId) {
  return database.data(`${ratingDestructiveJobCollection}/${jobId}`);
}

function assertBoundaryFailure(before, result, boundary) {
  const context = `${boundary}: ${result.job.status}/${result.job.failureCode}`;
  assert.equal(result.job.failureCode, failureBoundaryCodes[boundary], context);
  assert.equal(result.job.status, "retryable", context);
  assert.deepEqual(jobContinuation(result.job), jobContinuation(before), boundary);
}

function injectCommitFailure(database, predicate) {
  database.failOneCommitWhen(predicate, "aborted");
}

function assertMultipleBoundedPages(database, collectionPath, limit, minimum) {
  const pages = database.attemptedQueries.filter((query) =>
    query.collectionPath === collectionPath && query.limit === limit);
  assert.ok(pages.length >= minimum, `${collectionPath}: ${pages.length}`);
}

async function markJobManual(database, jobId, now) {
  return database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, jobId);
    return updateRatingDestructiveJob(transaction, current, {
      status: "manual_review_required",
      failureCode: "malformed_private_state",
    }, now);
  });
}

function recordSnapshot(database) {
  return [...database.records.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => [path, clone(value)]);
}

test("all four runners no-op when an active selection becomes manual", async (t) => {
  const cases = [
    {
      name: "restaurantMerge",
      seed(database) {
        database.seed("bitescore_restaurants/stale-source", restaurant("stale-source"));
        database.seed("bitescore_restaurants/stale-target", restaurant("stale-target"));
      },
      request: {
        contractVersion,
        ...adminCaller,
        requestId: "stale-restaurant-merge",
        operation: "restaurantMerge",
        sourceRestaurantId: "stale-source",
        targetRestaurantId: "stale-target",
        expectedSourceRestaurantRevision: 4,
        expectedTargetRestaurantRevision: 4,
      },
      run: processRestaurantMergeStep,
    },
    {
      name: "restaurantDelete",
      seed(database) {
        database.seed("bitescore_restaurants/stale-delete", restaurant("stale-delete"));
      },
      request: {
        contractVersion,
        ...adminCaller,
        requestId: "stale-restaurant-delete",
        operation: "restaurantDelete",
        sourceRestaurantId: "stale-delete",
        expectedSourceRestaurantRevision: 4,
      },
      run: processRestaurantDeleteStep,
    },
    {
      name: "dishMerge",
      seed(database) {
        database.seed("bitescore_dishes/stale-source-dish", dish(
          "stale-source-dish", "stale-restaurant",
        ));
        database.seed("bitescore_dishes/stale-target-dish", dish(
          "stale-target-dish", "stale-restaurant",
        ));
      },
      request: {
        contractVersion,
        ...adminCaller,
        requestId: "stale-dish-merge",
        operation: "dishMerge",
        sourceDishId: "stale-source-dish",
        targetDishId: "stale-target-dish",
        restaurantId: "stale-restaurant",
      },
      run: processDishMergeStep,
    },
    {
      name: "dishDelete",
      seed(database) {
        database.seed("bitescore_dishes/stale-delete-dish", dish(
          "stale-delete-dish", "stale-restaurant",
        ));
      },
      request: {
        contractVersion,
        ...adminCaller,
        requestId: "stale-dish-delete",
        operation: "dishDelete",
        sourceDishId: "stale-delete-dish",
      },
      run: processStandaloneDishDeleteStep,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const database = new InMemoryDestructiveDatabase();
      const {external} = createExternalSteps();
      const deps = dependencies(database, external);
      scenario.seed(database);
      const claimed = await claimRatingDestructiveOperation(
        deps,
        scenario.request,
        baseTime,
      );
      const staleActiveSelection = claimed.job;
      const manual = await markJobManual(
        database,
        claimed.job.jobId,
        new Date(baseTime.getTime() + 1),
      );
      const before = recordSnapshot(database);
      const result = await scenario.run(
        deps,
        staleActiveSelection,
        new Date(baseTime.getTime() + 2),
      );
      assert.equal(result.processedDocuments, 0);
      assert.deepEqual(result.job, manual);
      assert.deepEqual(database.data(ratingDestructiveJobPath(manual.jobId)), manual);
      assert.deepEqual(recordSnapshot(database), before);
    });
  }
});

test("restaurantMerge is bounded, retry-safe, exact, private, and unlocks only the target", async () => {
  const database = new InMemoryDestructiveDatabase();
  const {external} = createExternalSteps();
  const deps = dependencies(database, external);
  database.seed("bitescore_restaurants/source", restaurant("source", {
    ownerUserId: "source-owner",
    isClaimed: true,
    phone: privacyCanaries[4],
    bio: "source bio",
    cuisineTags: ["Thai", "Cafe"],
  }));
  database.seed("bitescore_restaurants/target", restaurant("target", {
    name: "Target Name",
    ownerUserId: "target-owner",
    isClaimed: true,
    phone: "target phone",
    bio: null,
    cuisineTags: ["Cafe", "Italian"],
  }));
  database.seed("bitescore_dishes/existing-dish", dish(
    "existing-dish",
    "source",
    {
      restaurantName: "Restaurant source",
      mergedIntoDishId: "legacy-merged-dish",
      movedDishSentinel: "preserve-moved-dish",
    },
  ));
  const scaleDishIds = [];
  for (let index = 0; index < 250; index += 1) {
    const id = `scale-dish-${String(index).padStart(3, "0")}`;
    scaleDishIds.push(id);
    database.seed(`bitescore_dishes/${id}`, dish(id, "source", {
      movedDishSentinel: `preserve-${id}`,
    }));
  }
  for (let index = 0; index < 251; index += 1) {
    const id = `merge-review-${String(index).padStart(3, "0")}`;
    database.seed(`dish_reviews/${id}`, review(
      id,
      "existing-dish",
      "source",
      `merge-user-${String(index).padStart(3, "0")}`,
      {migrationSentinel: `keep-${index}`},
    ));
  }
  const movedCollections = [
    "restaurant_claim_requests",
    "dish_edit_proposals",
    "restaurant_reports",
    "dish_reports",
    "review_reports",
    "review_feedback_votes",
    "duplicate_restaurant_reports",
  ];
  const movedPaths = [];
  for (const collection of movedCollections) {
    const count = collection === "restaurant_claim_requests" ? 121 : 1;
    for (let index = 0; index < count; index += 1) {
      const id = `${collection}-${String(index).padStart(3, "0")}`;
      const path = `${collection}/${id}`;
      movedPaths.push({collection, path});
      database.seed(path, {
        restaurantId: "source",
        restaurantName: "Old Name",
        status: "pending",
        body: privacyCanaries[1],
        reason: privacyCanaries[2],
        nested: {secret: privacyCanaries[8]},
      });
    }
  }
  const retained = [
    "bitescore_dish_images/image",
    "bitescore_dish_image_votes/vote",
    "restaurant_menus/menu",
    "restaurant_invites/invite",
    "user_profiles/favorite-user/favorite_restaurants/source",
  ];
  for (const path of retained) {
    database.seed(path, {
      restaurantId: "source",
      retainedSentinel: `retain-${path}`,
    });
  }
  const contributionLedgerCollection =
    "bitescore_contribution_point_ledger";
  const contributionLedgerId = "restaurant-merge-existing-dish-award";
  const contributionLedgerPath =
    `${contributionLedgerCollection}/${contributionLedgerId}`;
  database.seed(contributionLedgerPath, {
    id: contributionLedgerId,
    userId: "merge-ledger-user",
    pointsDelta: 1,
    actionType: "dish_created",
    sourceKey: "dish_created:existing-dish",
    description: "Restaurant merge ledger preservation canary",
    status: "active",
    celebrationStatus: "pending",
    dishId: "existing-dish",
    dishName: "Dish existing-dish",
    restaurantId: "source",
    restaurantName: "Restaurant source",
    restaurantCity: null,
    restaurantState: null,
    restaurantAddress: null,
    restaurantPhone: null,
    reviewId: null,
    requestId: null,
    imageId: null,
    oldValue: null,
    newValue: null,
    mergeSourceDishId: null,
    mergeSourceDishName: null,
    mergeTargetDishId: null,
    mergeTargetDishName: null,
    createdAt: baseTime,
    updatedAt: baseTime,
  });
  const contributionLedgerBefore = database.data(contributionLedgerPath);
  const contributionLedgerIdsBefore = database
    .documentsIn(contributionLedgerCollection)
    .map((document) => document.id)
    .sort();
  assert.equal(Object.hasOwn(deps, "storage"), false);

  const claimed = await claimRatingDestructiveOperation(deps, {
    contractVersion,
    ...adminCaller,
    requestId: "restaurant-merge-request",
    operation: "restaurantMerge",
    sourceRestaurantId: "source",
    targetRestaurantId: "target",
    expectedSourceRestaurantRevision: 4,
    expectedTargetRestaurantRevision: 4,
  }, baseTime);
  assert.equal(claimed.claimed, true);
  assert.equal(database.data("bitescore_restaurants/source").restaurantWriteRevision, 5);
  assert.equal(database.data("bitescore_restaurants/target").restaurantWriteRevision, 5);
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/source`).active, true);
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/target`).active, true);
  const replay = await claimRatingDestructiveOperation(deps, {
    contractVersion,
    ...adminCaller,
    requestId: "restaurant-merge-request",
    operation: "restaurantMerge",
    sourceRestaurantId: "source",
    targetRestaurantId: "target",
    expectedSourceRestaurantRevision: 4,
    expectedTargetRestaurantRevision: 4,
  }, new Date(baseTime.getTime() + 1));
  assert.equal(replay.claimed, false);

  let before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === ratingDestructiveJobPath(claimed.job.jobId) &&
    operation.data.phase === "move_dishes"));
  let failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 2),
  );
  assertBoundaryFailure(before, failed, "after_claim_revision_locks");
  assert.equal(database.data("bitescore_restaurants/source").restaurantWriteRevision, 5);
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/target`).active, true);

  await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 3),
  );
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === "bitescore_dishes/scale-dish-050"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 4),
  );
  assertBoundaryFailure(before, failed, "during_collection_page");
  assertBoundaryFailure(
    before,
    failed,
    "after_page_writes_before_cursor_advancement",
  );
  assert.equal(database.data("bitescore_dishes/scale-dish-050").restaurantId, "source");

  await runUntil(deps, claimed.job.jobId, (job) => job.phase === "move_reviews");
  const lockedReviewPath = reviewMilestoneReconciliationLockPath("merge-user-000");
  database.seed(lockedReviewPath, activeMilestoneLock("merge-user-000"));
  before = currentJob(database, claimed.job.jobId);
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 5),
  );
  assertBoundaryFailure(before, failed, "active_milestone_lock");
  assert.equal(database.data("dish_reviews/merge-review-000").restaurantId, "source");
  assert.equal(database.data(lockedReviewPath).state, "active");
  database.remove(lockedReviewPath);

  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === "dish_reviews/merge-review-050"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 6),
  );
  assertBoundaryFailure(before, failed, "during_collection_page");
  assertBoundaryFailure(
    before,
    failed,
    "after_page_writes_before_cursor_advancement",
  );
  assert.equal(database.data("dish_reviews/merge-review-050").restaurantId, "source");

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "rebuild_moved_dish_aggregates");
  await runUntil(deps, claimed.job.jobId, () =>
    database.documentsIn(ratingDestructiveJobItemCollection).some((document) =>
      document.data.kind === "movedDish" &&
      document.data.status === "active" &&
      document.data.subphase === "rebuild_aggregate"));
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) =>
    operations.some((operation) =>
      operation.type === "query" &&
      operation.query.collectionPath === "dish_reviews") &&
    operations.some((operation) =>
      operation.type === "set" &&
      operation.path.startsWith(`${ratingDestructiveJobItemCollection}/`)));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 20_007),
  );
  assertBoundaryFailure(before, failed, "during_aggregate_work");
  assertBoundaryFailure(before, failed, "during_aggregate_raw_scan");
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/target`).active, true);

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "move_claim_requests");
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === "restaurant_claim_requests/restaurant_claim_requests-050"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 20_008),
  );
  assertBoundaryFailure(before, failed, "during_collection_page");
  assertBoundaryFailure(
    before,
    failed,
    "after_page_writes_before_cursor_advancement",
  );
  assert.equal(
    database.data("restaurant_claim_requests/restaurant_claim_requests-050")
      .restaurantId,
    "source",
  );

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "finalize_restaurants");
  database.seed("restaurant_reports/late-required", {restaurantId: "source"});
  const guarded = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 50_000),
  );
  assert.equal(guarded.job.status, "retryable");
  assert.equal(database.has("bitescore_restaurants/source"), true);
  assert.equal(database.has(`${ratingRestaurantOperationLockCollection}/target`), true);
  database.patch("restaurant_reports/late-required", {restaurantId: "target"});

  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === "bitescore_restaurants/source" &&
    operation.data.isActive === false));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 50_001),
  );
  assertBoundaryFailure(before, failed, "before_source_retirement");
  assertBoundaryFailure(before, failed, "during_target_unlock");
  assertBoundaryFailure(before, failed, "during_final_lock_conversion");
  assertBoundaryFailure(before, failed, "during_job_completion");
  assert.equal(database.data("bitescore_restaurants/source").isActive, true);
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/target`).active, true);
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/source`).active, true);
  assert.equal(currentJob(database, claimed.job.jobId).phase, "finalize_restaurants");

  const terminal = await runToTerminal(deps, claimed.job.jobId);
  assert.equal(terminal.at(-1).job.status, "complete");

  const contributionLedgerAfter = database.data(contributionLedgerPath);
  const contributionLedgerIdsAfter = database
    .documentsIn(contributionLedgerCollection)
    .map((document) => document.id)
    .sort();
  assert.equal(database.has(contributionLedgerPath), true);
  assert.deepEqual(contributionLedgerAfter, contributionLedgerBefore);
  assert.equal(contributionLedgerAfter.id, contributionLedgerId);
  assert.equal(contributionLedgerAfter.dishId, "existing-dish");
  assert.equal(contributionLedgerAfter.restaurantId, "source");
  assert.equal(contributionLedgerAfter.userId, "merge-ledger-user");
  assert.equal(contributionLedgerAfter.actionType, "dish_created");
  assert.equal(
    contributionLedgerAfter.sourceKey,
    "dish_created:existing-dish",
  );
  assert.equal(contributionLedgerAfter.pointsDelta, 1);
  assert.equal(contributionLedgerAfter.status, "active");
  assert.equal(contributionLedgerAfter.celebrationStatus, "pending");
  assert.deepEqual(contributionLedgerIdsAfter, contributionLedgerIdsBefore);
  assert.equal(contributionLedgerIdsAfter.length, 1);
  const contributionLedgerWrites = database.committedTransactions
    .flat()
    .filter((operation) =>
      (operation.type === "set" || operation.type === "delete") &&
      operation.path.startsWith(`${contributionLedgerCollection}/`));
  assert.deepEqual(contributionLedgerWrites, []);

  for (let index = 0; index < 251; index += 1) {
    const data = database.data(
      `dish_reviews/merge-review-${String(index).padStart(3, "0")}`,
    );
    assert.equal(data.restaurantId, "target");
    assert.equal(data.dishId, "existing-dish");
    assert.equal(data.migrationSentinel, `keep-${index}`);
    assert.equal(data.headline, privacyCanaries[0]);
  }
  for (const {collection, path} of movedPaths) {
    const data = database.data(path);
    assert.equal(data.restaurantId, "target");
    assert.equal(data.body, privacyCanaries[1]);
    if (collection === "duplicate_restaurant_reports") {
      assert.equal(data.status, "resolved");
    }
  }
  const source = database.data("bitescore_restaurants/source");
  const target = database.data("bitescore_restaurants/target");
  assert.equal(source.isActive, false);
  assert.equal(source.isClaimed, false);
  assert.equal(source.ownerUserId, null);
  assert.equal(source.restaurantWriteRevision, 6);
  assert.equal(target.ownerUserId, "target-owner");
  assert.equal(target.phone, "target phone");
  assert.equal(target.bio, "source bio");
  assert.deepEqual(target.cuisineTags, ["Cafe", "Italian", "Thai"]);
  assert.equal(target.restaurantWriteRevision, 6);
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/source`).state, "merged_source");
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/source`).permanent, true);
  assert.equal(database.has(`${ratingRestaurantOperationLockCollection}/target`), false);
  const movedDish = database.data("bitescore_dishes/existing-dish");
  assert.equal(movedDish.restaurantId, "target");
  assert.equal(movedDish.restaurantName, "Target Name");
  assert.equal(movedDish.mergedIntoDishId, "legacy-merged-dish");
  assert.equal(movedDish.movedDishSentinel, "preserve-moved-dish");
  assert.equal(database.data("dish_rating_aggregates/existing-dish").restaurantId, "target");
  assert.equal(database.data("dish_rating_aggregates/existing-dish").ratingCount, 251);
  assert.equal(database.has(`${ratingDishOperationLockCollection}/existing-dish`), false);
  for (const id of scaleDishIds) {
    const data = database.data(`bitescore_dishes/${id}`);
    assert.equal(data.restaurantId, "target");
    assert.equal(data.movedDishSentinel, `preserve-${id}`);
    assert.equal(database.has(`${ratingDishOperationLockCollection}/${id}`), false);
  }
  assert.equal(database.documentsIn("bitescore_dishes").filter(
    (document) => document.data.restaurantId === "source").length, 0);
  assert.equal(database.documentsIn("bitescore_dishes").filter(
    (document) => document.data.restaurantId === "target").length, 251);
  const movedItems = database.documentsIn(ratingDestructiveJobItemCollection)
    .filter((document) => document.data.kind === "movedDish");
  assert.equal(movedItems.length, 251);
  assert.equal(movedItems.every((document) =>
    document.data.status === "complete"), true);
  for (const path of retained) {
    assert.equal(database.data(path).retainedSentinel, `retain-${path}`);
  }
  assertMultipleBoundedPages(database, "bitescore_dishes", 100, 3);
  assertMultipleBoundedPages(database, "dish_reviews", 100, 3);
  assertMultipleBoundedPages(database, "restaurant_claim_requests", 100, 2);
  assertBoundedQueries(database);
  assertNoPrivateCanaries(database);
});

test("restaurantDelete drains dish/orphan dependents, reconciles users, and retains unrelated data", async () => {
  const database = new InMemoryDestructiveDatabase();
  const {external, calls} = createExternalSteps();
  const deps = dependencies(database, external);
  database.seed("bitescore_restaurants/delete-me", restaurant("delete-me"));
  database.seed("bitescore_restaurants/other", restaurant("other", {
    restaurantWriteRevision: 9,
  }));
  database.seed("bitescore_dishes/other-dish", dish("other-dish", "other"));
  database.seed("dish_rating_aggregates/other-dish", {sentinel: "keep"});
  const childDishIds = [];
  for (let index = 0; index < 101; index += 1) {
    const id = `child-dish-${String(index).padStart(3, "0")}`;
    childDishIds.push(id);
    database.seed(`bitescore_dishes/${id}`, dish(id, "delete-me", {
      deletionSentinel: `delete-${id}`,
    }));
    database.seed(`dish_rating_aggregates/${id}`, {
      deletionSentinel: `delete-${id}`,
    });
  }
  const orphanReviewIds = [];
  for (let index = 0; index < 251; index += 1) {
    const id = `orphan-review-${String(index).padStart(3, "0")}`;
    orphanReviewIds.push(id);
    database.seed(`dish_reviews/${id}`, review(
      id,
      "missing-dish",
      "delete-me",
      "shared-restaurant-delete-user",
      {deletionSentinel: `delete-${id}`},
    ));
  }
  for (let index = 0; index < 51; index += 1) {
    database.seed(`review_feedback_votes/orphan-vote-${String(index).padStart(3, "0")}`, {
      reviewId: "orphan-review-000",
      restaurantId: "delete-me",
      body: privacyCanaries[1],
    });
    database.seed(`review_reports/orphan-trust-${String(index).padStart(3, "0")}`, {
      reviewId: "orphan-review-000",
      restaurantId: "delete-me",
      body: privacyCanaries[1],
    });
  }
  for (let index = 0; index < 121; index += 1) {
    database.seed(`dish_reports/dish-report-${String(index).padStart(3, "0")}`, {
      dishId: "child-dish-000",
      restaurantId: "delete-me",
    });
  }
  for (let index = 0; index < 251; index += 1) {
    database.seed(`restaurant_reports/restaurant-report-${String(index).padStart(3, "0")}`, {
      restaurantId: "delete-me",
    });
    database.seed(`duplicate_restaurant_reports/duplicate-${String(index).padStart(3, "0")}`, {
      restaurantId: "delete-me",
    });
  }
  database.seed("review_feedback_votes/unrelated-vote", {
    reviewId: "missing-unrelated-review",
    restaurantId: "other",
    retainedSentinel: "retain-unrelated-vote",
  });
  database.seed("review_reports/unrelated-report", {
    reviewId: "missing-unrelated-review",
    restaurantId: "other",
    retainedSentinel: "retain-unrelated-report",
  });
  const retained = [
    "restaurant_claim_requests/claim",
    "dish_edit_proposals/proposal",
    "bitescore_dish_images/image",
    "bitescore_dish_image_votes/vote",
    "restaurant_menus/menu",
    "restaurant_invites/invite",
    "user_profiles/favorite-user/favorite_restaurants/delete-me",
    "private_dish_edit_proposal_groups/group",
    "private_dish_edit_proposal_group_members/member",
    "private_dish_edit_proposal_group_supporters/supporter",
    "bitescore_contribution_point_ledger/reversal-ledger",
  ];
  for (const path of retained) {
    database.seed(path, {
      restaurantId: "delete-me",
      dishId: "child-dish-000",
      retainedSentinel: `retain-${path}`,
    });
  }

  const claimed = await claimRatingDestructiveOperation(deps, {
    contractVersion,
    ...adminCaller,
    requestId: "restaurant-delete-request",
    operation: "restaurantDelete",
    sourceRestaurantId: "delete-me",
    expectedSourceRestaurantRevision: 4,
  }, baseTime);
  assert.equal(claimed.claimed, true);
  assert.equal(database.data("bitescore_restaurants/delete-me").restaurantWriteRevision, 5);

  await runUntil(
    deps,
    claimed.job.jobId,
    (job) => job.phase === "process_orphan_reviews",
    1_500,
  );
  const lockedReviewPath = reviewMilestoneReconciliationLockPath(
    "shared-restaurant-delete-user",
  );
  database.seed(
    lockedReviewPath,
    activeMilestoneLock("shared-restaurant-delete-user"),
  );
  let before = currentJob(database, claimed.job.jobId);
  let failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 2_000),
  );
  assertBoundaryFailure(before, failed, "active_milestone_lock");
  assert.equal(database.has("dish_reviews/orphan-review-000"), true);
  assert.equal(database.data(lockedReviewPath).state, "active");
  database.remove(lockedReviewPath);

  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "delete" &&
    operation.path === "review_feedback_votes/orphan-vote-025"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 2_001),
  );
  assertBoundaryFailure(before, failed, "during_dish_review_trust_cleanup");
  assertBoundaryFailure(before, failed, "during_review_feedback_cleanup");
  assert.equal(database.documentsIn("review_feedback_votes").filter(
    (document) => document.data.reviewId === "orphan-review-000").length, 51);

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "finalize_restaurant");
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "delete" &&
    operation.path === "bitescore_restaurants/delete-me"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 3_000),
  );
  assertBoundaryFailure(before, failed, "before_final_hard_delete");
  assertBoundaryFailure(before, failed, "before_restaurant_hard_delete");
  assertBoundaryFailure(before, failed, "during_final_lock_conversion");
  assertBoundaryFailure(before, failed, "during_job_completion");
  assert.equal(database.has("bitescore_restaurants/delete-me"), true);
  assert.equal(
    database.data(`${ratingRestaurantOperationLockCollection}/delete-me`).active,
    true,
  );

  const terminal = await runToTerminal(deps, claimed.job.jobId);
  assert.equal(terminal.at(-1).job.status, "complete");
  assert.equal(database.has("bitescore_restaurants/delete-me"), false);
  for (const id of childDishIds) {
    assert.equal(database.has(`bitescore_dishes/${id}`), false);
    assert.equal(database.has(`dish_rating_aggregates/${id}`), false);
    const lock = database.data(`${ratingDishOperationLockCollection}/${id}`);
    assert.equal(lock.state, "deleted_source");
    assert.equal(lock.permanent, true);
  }
  assert.equal(database.documentsIn("dish_reviews").filter(
    (document) => document.data.restaurantId === "delete-me").length, 0);
  assert.equal(database.documentsIn("review_feedback_votes").filter(
    (document) => orphanReviewIds.includes(document.data.reviewId)).length, 0);
  assert.equal(database.documentsIn("review_reports").filter(
    (document) => orphanReviewIds.includes(document.data.reviewId)).length, 0);
  assert.equal(database.documentsIn("dish_reports").filter(
    (document) => childDishIds.includes(document.data.dishId)).length, 0);
  assert.equal(database.documentsIn("restaurant_reports").filter(
    (document) => document.data.restaurantId === "delete-me").length, 0);
  assert.equal(database.documentsIn("duplicate_restaurant_reports").filter(
    (document) => document.data.restaurantId === "delete-me").length, 0);
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/delete-me`).state, "deleted_source");
  assert.equal(database.data(`${ratingRestaurantOperationLockCollection}/delete-me`).permanent, true);
  assert.equal(database.has("bitescore_restaurants/other"), true);
  assert.equal(database.has("bitescore_dishes/other-dish"), true);
  assert.equal(database.data("dish_rating_aggregates/other-dish").sentinel, "keep");
  assert.equal(database.data("review_feedback_votes/unrelated-vote")
    .retainedSentinel, "retain-unrelated-vote");
  assert.equal(database.data("review_reports/unrelated-report")
    .retainedSentinel, "retain-unrelated-report");
  assert.equal(calls.reverse.length, 101);
  assert.equal(new Set(calls.reverse.map((call) => call.dishId)).size, 101);
  assert.deepEqual(
    [...new Set(calls.reverse.map((call) => call.dishId))].sort(),
    childDishIds,
  );
  assert.equal(calls.claim.length, 1);
  assert.equal(calls.release.length, 1);
  for (const path of retained) {
    assert.equal(database.data(path).retainedSentinel, `retain-${path}`);
  }
  assertMultipleBoundedPages(database, "dish_reports", 100, 2);
  assertMultipleBoundedPages(database, "restaurant_reports", 100, 3);
  assertMultipleBoundedPages(database, "duplicate_restaurant_reports", 100, 3);
  assertMultipleBoundedPages(database, "review_feedback_votes", 50, 2);
  assertMultipleBoundedPages(database, "review_reports", 50, 2);
  assertBoundedQueries(database);
  assertNoPrivateCanaries(database);
});

test("direct dishMerge moves every review in bounded pages and rebuilds generation-safe aggregates", async () => {
  const database = new InMemoryDestructiveDatabase();
  const {external, calls} = createExternalSteps();
  const deps = dependencies(database, external);
  database.seed("bitescore_restaurants/restaurant", restaurant("restaurant"));
  database.seed("bitescore_dishes/source-dish", dish("source-dish", "restaurant", {
    productSentinel: "source-preserved",
  }));
  database.seed("bitescore_dishes/target-dish", dish("target-dish", "restaurant", {
    name: "Target metadata must win",
    productSentinel: "target-preserved",
  }));
  for (let index = 0; index < 251; index += 1) {
    const id = `direct-review-${String(index).padStart(3, "0")}`;
    const overrides = index === 250
      ? {
          overallImpression: undefined,
          tastinessScore: undefined,
          qualityScore: undefined,
          valueScore: undefined,
          overallBiteScore: undefined,
          minimalSentinel: "still-move",
        }
      : {
          migrationSentinel: `preserve-${index}`,
          updatedAt: new Date(baseTime.getTime() + index),
        };
    database.seed(`dish_reviews/${id}`, review(
      id,
      "source-dish",
      "restaurant",
      `direct-user-${index}`,
      overrides,
    ));
  }
  const retained = [
    "dish_edit_proposals/proposal",
    "bitescore_dish_images/image",
    "bitescore_dish_image_votes/vote",
    "bitescore_contribution_point_ledger/entry",
  ];
  for (const path of retained) {
    database.seed(path, {
      dishId: "source-dish",
      retainedSentinel: `retain-${path}`,
    });
  }

  const claimed = await claimRatingDestructiveOperation(deps, {
    contractVersion,
    ...adminCaller,
    requestId: "direct-merge-request",
    operation: "dishMerge",
    sourceDishId: "source-dish",
    targetDishId: "target-dish",
    restaurantId: "restaurant",
  }, baseTime);
  assert.equal(claimed.claimed, true);
  assert.equal(database.data("bitescore_dishes/source-dish").aggregateWriteGeneration, 1);
  assert.equal(database.data("bitescore_dishes/target-dish").aggregateWriteGeneration, 1);
  assert.equal(database.data(dishMergeReviewLockPath("source-dish")).state, "active");
  assert.equal(database.data(dishMergeReviewLockPath("target-dish")).state, "active");

  let before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === ratingDestructiveJobPath(claimed.job.jobId) &&
    operation.data.phase === "move_reviews"));
  let failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 1),
  );
  assertBoundaryFailure(before, failed, "after_claim_revision_locks");
  assert.equal(database.data("bitescore_dishes/source-dish")
    .aggregateWriteGeneration, 1);
  assert.equal(database.data(dishMergeReviewLockPath("source-dish")).state, "active");

  await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 2),
  );
  const lockedReviewPath = reviewMilestoneReconciliationLockPath("direct-user-0");
  database.seed(lockedReviewPath, activeMilestoneLock("direct-user-0"));
  before = currentJob(database, claimed.job.jobId);
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 3),
  );
  assertBoundaryFailure(before, failed, "active_milestone_lock");
  assert.equal(database.data("dish_reviews/direct-review-000").dishId, "source-dish");
  assert.equal(database.data(lockedReviewPath).state, "active");
  database.remove(lockedReviewPath);

  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === "dish_reviews/direct-review-050"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 4),
  );
  assertBoundaryFailure(before, failed, "during_collection_page");
  assertBoundaryFailure(
    before,
    failed,
    "after_page_writes_before_cursor_advancement",
  );
  assert.equal(database.data("dish_reviews/direct-review-050").dishId, "source-dish");

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "rebuild_target_aggregate");
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) =>
    operations.some((operation) =>
      operation.type === "query" &&
      operation.query.collectionPath === "dish_reviews") &&
    operations.some((operation) =>
      operation.type === "set" &&
      operation.path === ratingDestructiveJobPath(claimed.job.jobId)));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 5),
  );
  assertBoundaryFailure(before, failed, "during_aggregate_work");
  assertBoundaryFailure(before, failed, "during_aggregate_raw_scan");
  assert.equal(database.data("bitescore_dishes/source-dish").isActive, true);

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "fold_target_aggregate");
  const targetWinnerCollection =
    `${ratingDestructiveJobItemCollection}/${claimed.job.jobId}/aggregate_winners`;
  assert.equal(database.documentsIn(targetWinnerCollection).length, 250);
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) =>
    operations.some((operation) =>
      operation.type === "query" &&
      operation.query.collectionPath === targetWinnerCollection) &&
    operations.some((operation) =>
      operation.type === "delete" &&
      operation.path.startsWith(`${targetWinnerCollection}/`)));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 6),
  );
  assertBoundaryFailure(before, failed, "during_aggregate_work");
  assertBoundaryFailure(before, failed, "during_aggregate_winner_fold");
  assert.equal(database.documentsIn(targetWinnerCollection).length, 250);

  await runUntil(deps, claimed.job.jobId, (job) => job.phase === "finalize_dishes");
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === "bitescore_dishes/source-dish" &&
    operation.data.isActive === false));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 6),
  );
  assertBoundaryFailure(before, failed, "before_source_retirement");
  assertBoundaryFailure(before, failed, "during_target_unlock");
  assertBoundaryFailure(before, failed, "during_final_lock_conversion");
  assertBoundaryFailure(before, failed, "during_job_completion");
  assert.equal(database.data("bitescore_dishes/source-dish").isActive, true);
  assert.equal(database.data(`${ratingDishOperationLockCollection}/target-dish`).active, true);
  assert.equal(database.data(`${ratingDishOperationLockCollection}/source-dish`).active, true);
  assert.equal(database.data(dishMergeReviewLockPath("target-dish")).state, "active");
  assert.equal(currentJob(database, claimed.job.jobId).phase, "finalize_dishes");

  const terminal = await runToTerminal(deps, claimed.job.jobId);
  assert.equal(terminal.at(-1).job.status, "complete");
  for (let index = 0; index < 251; index += 1) {
    const data = database.data(
      `dish_reviews/direct-review-${String(index).padStart(3, "0")}`,
    );
    assert.equal(data.dishId, "target-dish");
    assert.equal(data.restaurantId, "restaurant");
    assert.equal(data.headline, privacyCanaries[0]);
  }
  assert.equal(database.data("dish_reviews/direct-review-250").minimalSentinel, "still-move");
  assert.equal(database.documentsIn("dish_reviews").filter(
    (document) => document.data.dishId === "source-dish").length, 0);
  assert.equal(database.documentsIn("dish_reviews").filter(
    (document) => document.data.dishId === "target-dish").length, 251);
  const sourceDish = database.data("bitescore_dishes/source-dish");
  const targetDish = database.data("bitescore_dishes/target-dish");
  assert.equal(sourceDish.isActive, false);
  assert.equal(sourceDish.mergedIntoDishId, "target-dish");
  assert.equal(sourceDish.productSentinel, "source-preserved");
  assert.equal(sourceDish.aggregateWriteGeneration, 2);
  assert.equal(targetDish.name, "Target metadata must win");
  assert.equal(targetDish.productSentinel, "target-preserved");
  assert.equal(targetDish.aggregateWriteGeneration, 2);
  assert.equal(database.data("dish_rating_aggregates/target-dish").ratingCount, 250);
  assert.equal(database.data("dish_rating_aggregates/target-dish").overallBiteScore, 80);
  assert.equal(database.data("dish_rating_aggregates/source-dish").ratingCount, 0);
  assert.equal(database.data(`${ratingDishOperationLockCollection}/source-dish`).state, "merged_source");
  assert.equal(database.data(`${ratingDishOperationLockCollection}/source-dish`).permanent, true);
  assert.equal(database.has(`${ratingDishOperationLockCollection}/target-dish`), false);
  assert.equal(database.data(dishMergeReviewLockPath("source-dish")).state, "merged_source");
  assert.equal(database.has(dishMergeReviewLockPath("target-dish")), false);
  assert.equal(calls.reverse.length, 0);
  assert.equal(database.documentsIn("private_dish_edit_application_jobs").length, 0);
  assert.equal(database.documentsIn("private_dish_edit_proposal_groups").length, 0);
  assert.equal(database.documentsIn("private_dish_edit_proposal_group_members").length, 0);
  assert.equal(database.documentsIn("private_dish_edit_proposal_group_supporters").length, 0);
  for (const path of retained) {
    assert.equal(database.data(path).retainedSentinel, `retain-${path}`);
  }
  assertMultipleBoundedPages(database, "dish_reviews", 100, 3);
  assertBoundedQueries(database);
  assertNoPrivateCanaries(database);
});

test("dishDelete retries bounded point reversal, drains trust first, deduplicates users, and protects a missing source", async () => {
  const database = new InMemoryDestructiveDatabase();
  const externalState = createExternalSteps();
  const pointEffects = new Map();
  let failPointReversal = false;
  externalState.external.reverseDishContributionPointsStep = async (value) => {
    externalState.calls.reverse.push(clone(value));
    if (failPointReversal) {
      failPointReversal = false;
      throw Object.assign(new Error("temporary point service failure"), {
        code: "unavailable",
      });
    }
    if (value.dishId === "already-missing-dish") {
      return {processedCount: 0, nextCursor: null, complete: true};
    }
    const page = value.cursor === null
      ? "start"
      : value.cursor.afterLedgerDocumentId;
    const processedCount = page === "start" ? 50 : page === "ledger-049" ? 50 : 21;
    if (!pointEffects.has(page)) pointEffects.set(page, processedCount);
    if (value.cursor === null) {
      return {
        processedCount: 50,
        nextCursor: pointCursor(value.operationId, value.dishId, "ledger-049"),
        complete: false,
      };
    }
    if (value.cursor.afterLedgerDocumentId === "ledger-049") {
      return {
        processedCount: 50,
        nextCursor: pointCursor(value.operationId, value.dishId, "ledger-099"),
        complete: false,
      };
    }
    return {processedCount: 21, nextCursor: null, complete: true};
  };
  const defaultMilestoneReviewScan = externalState.external.scanMilestoneReviewsStep;
  let failMilestoneReviewCount = false;
  let milestoneReviewCountAttempts = 0;
  externalState.external.scanMilestoneReviewsStep = async (...args) => {
    milestoneReviewCountAttempts += 1;
    if (failMilestoneReviewCount) {
      failMilestoneReviewCount = false;
      throw Object.assign(new Error("temporary milestone count failure"), {
        code: "unavailable",
      });
    }
    return defaultMilestoneReviewScan(...args);
  };
  const defaultReconcile = externalState.external.reconcileMilestoneStep;
  let failMilestoneReconciliation = false;
  let milestoneReconcileAttempts = 0;
  externalState.external.reconcileMilestoneStep = async (...args) => {
    milestoneReconcileAttempts += 1;
    if (failMilestoneReconciliation) {
      failMilestoneReconciliation = false;
      throw Object.assign(new Error("temporary milestone service failure"), {
        code: "unavailable",
      });
    }
    return defaultReconcile(...args);
  };
  const deps = dependencies(database, externalState.external);
  database.seed("bitescore_restaurants/delete-parent", restaurant("delete-parent"));
  database.seed("bitescore_dishes/delete-dish", dish("delete-dish", "delete-parent"));
  database.seed("bitescore_dishes/other-dish", dish("other-dish", "delete-parent"));
  database.seed("dish_rating_aggregates/delete-dish", {ratingCount: 251});
  database.seed("dish_rating_aggregates/other-dish", {ratingCount: 99});
  const deletedReviewIds = [];
  for (let index = 0; index < 251; index += 1) {
    const id = `delete-review-${String(index).padStart(3, "0")}`;
    deletedReviewIds.push(id);
    database.seed(`dish_reviews/${id}`, review(
      id,
      "delete-dish",
      "delete-parent",
      "same-user",
      {deletionSentinel: `delete-${id}`},
    ));
  }
  for (let index = 0; index < 121; index += 1) {
    database.seed(`review_feedback_votes/delete-vote-${String(index).padStart(3, "0")}`, {
      reviewId: "delete-review-000",
      body: privacyCanaries[1],
    });
    database.seed(`review_reports/delete-review-report-${String(index).padStart(3, "0")}`, {
      reviewId: "delete-review-000",
      body: privacyCanaries[1],
    });
  }
  database.seed("review_feedback_votes/orphan-vote", {reviewId: "missing-review"});
  database.seed("review_reports/orphan-report", {reviewId: "missing-review"});
  for (let index = 0; index < 121; index += 1) {
    database.seed(`dish_reports/delete-dish-report-${String(index).padStart(3, "0")}`, {
      dishId: "delete-dish",
    });
  }
  const retained = [
    "dish_edit_proposals/proposal",
    "bitescore_dish_images/image",
    "bitescore_dish_image_votes/vote",
  ];
  for (const path of retained) {
    database.seed(path, {
      dishId: "delete-dish",
      retainedSentinel: `retain-${path}`,
    });
  }
  const ledgerPaths = [];
  for (let index = 0; index < 121; index += 1) {
    const path = `bitescore_contribution_point_ledger/ledger-${String(index)
      .padStart(3, "0")}`;
    ledgerPaths.push(path);
    database.seed(path, {
      dishId: "delete-dish",
      retainedSentinel: `retain-${path}`,
    });
  }
  assert.equal(Object.hasOwn(deps, "storage"), false);

  const claimed = await claimRatingDestructiveOperation(deps, {
    contractVersion,
    ...adminCaller,
    requestId: "dish-delete-request",
    operation: "dishDelete",
    sourceDishId: "delete-dish",
  }, baseTime);
  assert.equal(claimed.claimed, true);
  const lockedReviewPath = reviewMilestoneReconciliationLockPath("same-user");
  database.seed(lockedReviewPath, activeMilestoneLock("same-user"));
  await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 1),
  );
  let before = currentJob(database, claimed.job.jobId);
  let failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 2),
  );
  assertBoundaryFailure(before, failed, "active_milestone_lock");
  assert.equal(database.has("dish_reviews/delete-review-000"), true);
  assert.equal(database.data(lockedReviewPath).state, "active");
  database.remove(lockedReviewPath);

  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "delete" &&
    operation.path === "review_feedback_votes/delete-vote-025"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 3),
  );
  assertBoundaryFailure(before, failed, "during_dish_review_trust_cleanup");
  assertBoundaryFailure(before, failed, "during_review_feedback_cleanup");
  assert.equal(database.documentsIn("review_feedback_votes").filter(
    (document) => document.data.reviewId === "delete-review-000").length, 121);

  await runUntil(deps, claimed.job.jobId, () =>
    database.documentsIn("review_feedback_votes").filter((document) =>
      document.data.reviewId === "delete-review-000").length === 0);
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "delete" &&
    operation.path === "review_reports/delete-review-report-025"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 4),
  );
  assertBoundaryFailure(before, failed, "during_dish_review_trust_cleanup");
  assertBoundaryFailure(before, failed, "during_review_report_cleanup");
  assert.equal(database.documentsIn("review_reports").filter(
    (document) => document.data.reviewId === "delete-review-000").length, 121);

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "reverse_contribution_points");
  before = currentJob(database, claimed.job.jobId);
  const dishItemPath = `${ratingDestructiveJobItemCollection}/${before.itemCursorId}`;
  const itemBeforePointFailure = database.data(dishItemPath);
  failPointReversal = true;
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 4),
  );
  assertBoundaryFailure(before, failed, "during_point_reversal");
  assert.deepEqual(database.data(dishItemPath), itemBeforePointFailure);
  assert.equal(pointEffects.size, 0);

  before = currentJob(database, claimed.job.jobId);
  const itemBeforeCursorFailure = database.data(dishItemPath);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === dishItemPath &&
    operation.data.pointReversalCursor !== null));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 5),
  );
  assertBoundaryFailure(before, failed, "during_point_reversal");
  assert.deepEqual(database.data(dishItemPath), itemBeforeCursorFailure);
  assert.equal(pointEffects.get("start"), 50);
  await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 6),
  );
  assert.equal(pointEffects.get("start"), 50);

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "delete_aggregate");
  before = currentJob(database, claimed.job.jobId);
  const itemBeforeAggregateDelete = database.data(dishItemPath);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "delete" &&
    operation.path === "dish_rating_aggregates/delete-dish"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 7),
  );
  assertBoundaryFailure(before, failed, "before_aggregate_deletion");
  assert.deepEqual(database.data(dishItemPath), itemBeforeAggregateDelete);
  assert.equal(database.data("dish_rating_aggregates/delete-dish").ratingCount, 251);

  await runUntil(deps, claimed.job.jobId, (job) => job.phase === "delete_dish");
  before = currentJob(database, claimed.job.jobId);
  const itemBeforeHardDelete = database.data(dishItemPath);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "delete" &&
    operation.path === "bitescore_dishes/delete-dish"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 7),
  );
  assertBoundaryFailure(before, failed, "before_final_hard_delete");
  assertBoundaryFailure(before, failed, "before_dish_hard_delete");
  assert.deepEqual(database.data(dishItemPath), itemBeforeHardDelete);
  assert.equal(database.has(`${ratingDishOperationLockCollection}/delete-dish`), true);
  assert.equal(database.has("bitescore_dishes/delete-dish"), true);

  await runUntil(deps, claimed.job.jobId, (job) =>
    job.phase === "reconcile_milestone_users");
  await runUntil(deps, claimed.job.jobId, () =>
    database.documentsIn(ratingDestructiveJobItemCollection).some((document) =>
      document.data.kind === "milestoneUser" &&
      document.data.subphase === "count_reviews"));
  before = currentJob(database, claimed.job.jobId);
  let milestoneItem = database.documentsIn(ratingDestructiveJobItemCollection)
    .find((document) => document.data.kind === "milestoneUser");
  assert.ok(milestoneItem);
  let milestoneBeforeFailure = clone(milestoneItem.data);
  failMilestoneReviewCount = true;
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 20_008),
  );
  assertBoundaryFailure(before, failed, "during_milestone_reconciliation");
  assertBoundaryFailure(before, failed, "during_milestone_review_count");
  assert.deepEqual(database.data(milestoneItem.path), milestoneBeforeFailure);

  await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 20_009),
  );
  milestoneItem = database.documentsIn(ratingDestructiveJobItemCollection)
    .find((document) => document.data.kind === "milestoneUser");
  assert.ok(milestoneItem);
  assert.equal(milestoneItem.data.subphase, "reconcile_milestones");
  before = currentJob(database, claimed.job.jobId);
  milestoneBeforeFailure = clone(milestoneItem.data);
  failMilestoneReconciliation = true;
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 20_010),
  );
  assertBoundaryFailure(before, failed, "during_milestone_reconciliation");
  assertBoundaryFailure(before, failed, "during_milestone_ledger_reconcile");
  assert.deepEqual(database.data(milestoneItem.path), milestoneBeforeFailure);

  await runUntil(deps, claimed.job.jobId, () =>
    database.documentsIn(ratingDestructiveJobItemCollection).some((document) =>
      document.data.kind === "milestoneUser" &&
      document.data.status === "complete"));
  before = currentJob(database, claimed.job.jobId);
  injectCommitFailure(database, (operations) => operations.some((operation) =>
    operation.type === "set" &&
    operation.path === `${ratingDishOperationLockCollection}/delete-dish` &&
    operation.data.state === "deleted_source"));
  failed = await processRatingDestructiveJobStep(
    deps,
    claimed.job.jobId,
    new Date(baseTime.getTime() + 20_011),
  );
  assertBoundaryFailure(before, failed, "during_final_lock_conversion");
  assertBoundaryFailure(before, failed, "during_job_completion");
  assert.equal(database.data(`${ratingDishOperationLockCollection}/delete-dish`).active, true);
  assert.equal(currentJob(database, claimed.job.jobId).phase, "reconcile_milestone_users");

  const terminal = await runToTerminal(deps, claimed.job.jobId);
  assert.equal(terminal.at(-1).job.status, "complete");
  assert.equal(externalState.calls.reverse.length, 5);
  assert.equal(externalState.calls.reverse.filter((call) =>
    call.cursor === null).length, 3);
  assert.equal(pointEffects.size, 3);
  assert.equal([...pointEffects.values()].reduce((sum, value) => sum + value, 0), 121);
  assert.equal(milestoneReviewCountAttempts, 2);
  assert.equal(milestoneReconcileAttempts, 2);
  assert.equal(externalState.calls.reconcile.length, 1);
  assert.equal(database.has("bitescore_dishes/delete-dish"), false);
  assert.equal(database.has("dish_rating_aggregates/delete-dish"), false);
  assert.equal(database.documentsIn("dish_reviews").filter(
    (document) => document.data.dishId === "delete-dish").length, 0);
  assert.equal(database.documentsIn("review_feedback_votes").filter(
    (document) => deletedReviewIds.includes(document.data.reviewId)).length, 0);
  assert.equal(database.documentsIn("review_reports").filter(
    (document) => deletedReviewIds.includes(document.data.reviewId)).length, 0);
  assert.equal(database.has("review_feedback_votes/orphan-vote"), true);
  assert.equal(database.has("review_reports/orphan-report"), true);
  assert.equal(database.documentsIn("dish_reports").filter(
    (document) => document.data.dishId === "delete-dish").length, 0);
  assert.equal(externalState.calls.claim.length, 1);
  assert.equal(externalState.calls.release.length, 1);
  assert.equal(database.data(`${ratingDishOperationLockCollection}/delete-dish`).state, "deleted_source");
  assert.equal(database.data(`${ratingDishOperationLockCollection}/delete-dish`).permanent, true);
  assert.equal(database.has("bitescore_dishes/other-dish"), true);
  assert.equal(database.data("dish_rating_aggregates/other-dish").ratingCount, 99);
  for (const path of [...retained, ...ledgerPaths]) {
    assert.equal(database.data(path).retainedSentinel, `retain-${path}`);
  }
  assert.equal(database.has("review_feedback_votes/orphan-vote"), true);
  assert.equal(database.has("review_reports/orphan-report"), true);
  assert.ok(database.committedTransactions.length > 300);
  assertMultipleBoundedPages(database, "review_feedback_votes", 50, 3);
  assertMultipleBoundedPages(database, "review_reports", 50, 3);
  assertMultipleBoundedPages(database, "dish_reports", 100, 2);

  const missingClaim = await claimRatingDestructiveOperation(deps, {
    contractVersion,
    ...adminCaller,
    requestId: "missing-dish-delete-request",
    operation: "dishDelete",
    sourceDishId: "already-missing-dish",
  }, new Date(baseTime.getTime() + 5_000));
  const missingTerminal = await runToTerminal(deps, missingClaim.job.jobId);
  assert.equal(missingTerminal.at(-1).job.status, "complete");
  assert.equal(database.data(`${ratingDishOperationLockCollection}/already-missing-dish`).state, "deleted_source");
  assertBoundedQueries(database);
  assertNoPrivateCanaries(database);
});
