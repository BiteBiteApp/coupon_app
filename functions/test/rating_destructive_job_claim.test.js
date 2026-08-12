"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRatingDestructiveJobDocument,
  buildRatingDishOperationLockDocument,
  buildRatingRestaurantOperationLockDocument,
  createRatingDestructiveJobId,
  ratingDestructiveJobItemPath,
  ratingDestructiveJobPath,
  ratingDestructiveJobVersion,
  ratingDishOperationLockCollection,
  ratingDishOperationLockPath,
  ratingRestaurantOperationLockCollection,
  ratingRestaurantOperationLockPath,
  RatingDestructiveContractError,
} = require("../lib/rating_destructive_job_contract.js");
const {
  RatingDestructiveClaimError,
  claimRatingDestructiveOperation,
  parseRatingDestructiveClaimRequest,
  processRatingDestructiveJobStep,
} = require("../lib/rating_destructive_job_processor.js");
const {
  RatingDestructiveProcessError,
} = require("../lib/rating_destructive_job_runtime.js");
const {
  createDishProposalJobId,
  dishMergeReviewLockPath,
  dishMergeReviewLockVersion,
  dishProposalDocumentFingerprint,
  dishProposalJobPath,
  dishProposalJobVersion,
} = require("../lib/dish_proposal_private_contract.js");
const {
  buildDishMergeReviewLockDocument,
  parseDishProposalJobDocument,
} = require("../lib/dish_proposal_resolution_jobs.js");
const {
  ReviewMilestoneReconciliationLockError,
} = require("../lib/review_milestone_reconciliation_lock.js");

const now = new Date("2026-08-11T15:00:00.000Z");
const later = new Date("2026-08-11T15:05:00.000Z");
const maximumSafeInteger = Number.MAX_SAFE_INTEGER;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function compareValues(left, right) {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
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
    default: throw new Error(`Unsupported query operator ${condition.operator}`);
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
  for (let index = 0; index < (query.orderBy ?? []).length; index += 1) {
    const order = query.orderBy[index];
    const comparison = compareValues(
      fieldValue(document, order.field),
      query.startAfter[index],
    );
    if (comparison !== 0) {
      return order.direction === "desc" ? comparison < 0 : comparison > 0;
    }
  }
  return false;
}

class InMemoryRatingDestructiveDatabase {
  constructor() {
    this.records = new Map();
    this.committedTransactions = [];
    this.transactionTail = Promise.resolve();
  }

  seed(documentPath, data, createTime = now) {
    this.records.set(documentPath, {
      data: clone(data),
      createTime: createTime === null ? null : new Date(createTime.getTime()),
    });
  }

  data(documentPath) {
    return clone(this.records.get(documentPath)?.data);
  }

  has(documentPath) {
    return this.records.has(documentPath);
  }

  documentsIn(collectionPath) {
    const prefix = `${collectionPath}/`;
    const expectedSegments = collectionPath.split("/").length + 1;
    return [...this.records.entries()]
      .filter(([documentPath]) =>
        documentPath.startsWith(prefix) &&
        documentPath.split("/").length === expectedSegments
      )
      .map(([documentPath, stored]) => ({
        id: documentPath.slice(prefix.length),
        path: documentPath,
        data: clone(stored.data),
      }));
  }

  committedSetCount(documentPath) {
    return this.committedTransactions.flat().filter(
      (operation) => operation.type === "set" &&
        operation.path === documentPath,
    ).length;
  }

  async runTransaction(operation) {
    const run = this.transactionTail.then(async () => {
      const working = new Map(
        [...this.records.entries()].map(([path, stored]) => [
          path,
          clone(stored),
        ]),
      );
      const transaction = new InMemoryRatingDestructiveTransaction(working);
      const result = await operation(transaction);
      this.records = working;
      this.committedTransactions.push(clone(transaction.operations));
      return result;
    });
    this.transactionTail = run.catch(() => undefined);
    return run;
  }
}

class InMemoryRatingDestructiveTransaction {
  constructor(working) {
    this.working = working;
    this.operations = [];
  }

  async getDocument(documentPath) {
    this.operations.push({type: "get", path: documentPath});
    const stored = this.working.get(documentPath);
    if (stored === undefined) return null;
    return {
      id: documentPath.slice(documentPath.lastIndexOf("/") + 1),
      data: clone(stored.data),
      createTime: stored.createTime === null
        ? null
        : new Date(stored.createTime.getTime()),
    };
  }

  async queryDocuments(query) {
    this.operations.push({type: "query", query: clone(query)});
    const prefix = `${query.collectionPath}/`;
    const expectedSegments = query.collectionPath.split("/").length + 1;
    return [...this.working.entries()]
      .filter(([documentPath]) =>
        documentPath.startsWith(prefix) &&
        documentPath.split("/").length === expectedSegments
      )
      .map(([documentPath, stored]) => ({
        id: documentPath.slice(prefix.length),
        data: clone(stored.data),
        createTime: stored.createTime === null
          ? null
          : new Date(stored.createTime.getTime()),
      }))
      .filter((document) =>
        (query.where ?? []).every((condition) =>
          matchesCondition(document, condition)
        )
      )
      .sort((left, right) => compareDocuments(left, right, query.orderBy))
      .filter((document) => isAfterCursor(document, query))
      .slice(0, query.limit);
  }

  setDocument(documentPath, data, options) {
    this.operations.push({
      type: "set",
      path: documentPath,
      data: clone(data),
      options: clone(options),
    });
    const current = this.working.get(documentPath);
    this.working.set(documentPath, {
      data: options?.merge === true && current !== undefined
        ? {...clone(current.data), ...clone(data)}
        : clone(data),
      createTime: current?.createTime ?? new Date(now.getTime()),
    });
  }

  deleteDocument(documentPath) {
    this.operations.push({type: "delete", path: documentPath});
    this.working.delete(documentPath);
  }
}

const unexpectedExternalStep = async () => {
  assert.fail("Claiming must not call destructive external steps.");
};

function dependencies(database) {
  return {
    database,
    external: {
      reverseDishContributionPointsStep: unexpectedExternalStep,
      claimMilestoneUser: unexpectedExternalStep,
      resetMilestoneAccumulatorStep: unexpectedExternalStep,
      scanMilestoneReviewsStep: unexpectedExternalStep,
      reconcileMilestoneStep: unexpectedExternalStep,
      releaseMilestoneUser: unexpectedExternalStep,
    },
  };
}

function seedRestaurant(database, restaurantId, revision = 7, changes = {}) {
  database.seed(`bitescore_restaurants/${restaurantId}`, {
    name: `Restaurant ${restaurantId}`,
    isActive: true,
    isClaimed: false,
    ownerUserId: null,
    restaurantWriteRevision: revision,
    ...changes,
  });
}

function seedDish(
  database,
  dishId,
  restaurantId = "restaurant-a",
  aggregateWriteGeneration = 3,
  changes = {},
) {
  database.seed(`bitescore_dishes/${dishId}`, {
    restaurantId,
    restaurantName: `Restaurant ${restaurantId}`,
    isActive: true,
    mergedIntoDishId: null,
    aggregateWriteGeneration,
    ...changes,
  });
}

function restaurantMergeRequest(changes = {}) {
  return {
    contractVersion: ratingDestructiveJobVersion,
    requestId: "request-restaurant-merge",
    operation: "restaurantMerge",
    sourceRestaurantId: "restaurant-a",
    targetRestaurantId: "restaurant-b",
    expectedSourceRestaurantRevision: 7,
    expectedTargetRestaurantRevision: 20,
    ...changes,
  };
}

function restaurantDeleteRequest(changes = {}) {
  return {
    contractVersion: ratingDestructiveJobVersion,
    requestId: "request-restaurant-delete",
    operation: "restaurantDelete",
    sourceRestaurantId: "restaurant-a",
    expectedSourceRestaurantRevision: 7,
    ...changes,
  };
}

function dishMergeRequest(changes = {}) {
  return {
    contractVersion: ratingDestructiveJobVersion,
    requestId: "request-dish-merge",
    operation: "dishMerge",
    sourceDishId: "dish-a",
    targetDishId: "dish-b",
    restaurantId: "restaurant-a",
    ...changes,
  };
}

function dishDeleteRequest(changes = {}) {
  return {
    contractVersion: ratingDestructiveJobVersion,
    requestId: "request-dish-delete",
    operation: "dishDelete",
    sourceDishId: "dish-a",
    ...changes,
  };
}

function assertClaimError(error, code) {
  assert.ok(error instanceof RatingDestructiveClaimError);
  assert.equal(error.code, code);
  assert.equal(
    error.message,
    "Rating destructive-operation claim could not be accepted.",
  );
  return true;
}

async function rejectsClaim(database, request, code) {
  await assert.rejects(
    claimRatingDestructiveOperation(dependencies(database), request, now),
    (error) => assertClaimError(error, code),
  );
}

function destructiveJobId(request) {
  return createRatingDestructiveJobId({
    requestId: request.requestId,
    operation: request.operation,
    sourceRestaurantId: request.operation === "restaurantMerge" ||
        request.operation === "restaurantDelete"
      ? request.sourceRestaurantId
      : null,
    targetRestaurantId: request.operation === "restaurantMerge"
      ? request.targetRestaurantId
      : null,
    sourceDishId: request.operation === "dishMerge" ||
        request.operation === "dishDelete"
      ? request.sourceDishId
      : null,
    targetDishId: request.operation === "dishMerge"
      ? request.targetDishId
      : null,
    restaurantId: request.operation === "dishMerge"
      ? request.restaurantId
      : null,
  });
}

function rebuildRatingDestructiveJob(job, changes) {
  const {
    version: _version,
    fingerprint: _fingerprint,
    ...core
  } = job;
  return buildRatingDestructiveJobDocument({...core, ...changes});
}

async function processInjectedFailure(error, requestId) {
  const database = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(database, "restaurant-a", 7);
  seedRestaurant(database, "restaurant-b", 20);
  const claim = await claimRatingDestructiveOperation(
    dependencies(database),
    restaurantMergeRequest({requestId}),
    now,
  );
  let transactionCall = 0;
  const injectedDependencies = dependencies(database);
  injectedDependencies.database = {
    async runTransaction(operation) {
      transactionCall += 1;
      if (transactionCall === 2) {
        throw error;
      }
      return database.runTransaction(operation);
    },
  };
  const result = await processRatingDestructiveJobStep(
    injectedDependencies,
    claim.job.jobId,
    later,
  );
  assert.equal(transactionCall, 3);
  assert.equal(result.processedDocuments, 0);
  assert.equal(
    database.committedSetCount(ratingDestructiveJobPath(claim.job.jobId)),
    2,
  );
  return {database, claim, result};
}

function activeProposalJob(sourceDishId, restaurantId = "restaurant-a") {
  const groupId = `group-${sourceDishId}`;
  const resolutionSequence = 1;
  const resolutionType = "apply";
  const jobId = createDishProposalJobId({
    groupId,
    resolutionSequence,
    resolutionType,
  });
  const job = {
    version: dishProposalJobVersion,
    jobId,
    groupId,
    resolutionType,
    proposalType: "rename",
    status: "active",
    phase: "validate_target",
    restaurantId,
    sourceDishId,
    mergeTargetDishId: null,
    normalizedProposedName: "renamed dish",
    resolutionSequence,
    cycleCutoffGeneration: 1,
    cycleCutoffAt: now,
    reviewMigrationCursorId: null,
    aggregateState: null,
    aggregateWinnerCursorId: null,
    aggregateCursorDocumentId: null,
    sourceActiveAggregateWriteGeneration: null,
    sourceCompletionAggregateWriteGeneration: null,
    targetActiveAggregateWriteGeneration: null,
    targetCompletionAggregateWriteGeneration: null,
    pointsCursorGeneration: null,
    pointsCursorMemberId: null,
    renameOldValue: null,
    renameNewValue: null,
    shouldAwardPoints: true,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  const fingerprint = dishProposalDocumentFingerprint(
    dishProposalJobVersion,
    [
      job.jobId,
      job.groupId,
      job.resolutionType,
      job.proposalType,
      job.status,
      job.phase,
      job.restaurantId,
      job.sourceDishId,
      job.mergeTargetDishId,
      job.normalizedProposedName,
      job.resolutionSequence,
      job.cycleCutoffGeneration,
      job.cycleCutoffAt.toISOString(),
      job.reviewMigrationCursorId,
      job.aggregateState,
      job.aggregateCursorDocumentId,
      job.aggregateWinnerCursorId,
      job.sourceActiveAggregateWriteGeneration,
      job.sourceCompletionAggregateWriteGeneration,
      job.targetActiveAggregateWriteGeneration,
      job.targetCompletionAggregateWriteGeneration,
      job.pointsCursorGeneration,
      job.pointsCursorMemberId,
      job.renameOldValue,
      job.renameNewValue,
      job.shouldAwardPoints,
      job.failureCode,
      job.createdAt.toISOString(),
      job.updatedAt.toISOString(),
      null,
    ],
  );
  const document = {...job, fingerprint};
  assert.deepEqual(
    parseDishProposalJobDocument({id: jobId, data: document}),
    document,
  );
  return document;
}

function activeReviewLock(dishId, role = "source") {
  return buildDishMergeReviewLockDocument({
    version: dishMergeReviewLockVersion,
    dishId,
    jobId: `proposal-job-${dishId}`,
    groupId: `proposal-group-${dishId}`,
    role,
    state: "active",
    blocksClientReviews: true,
    blocksClientAggregates: true,
    activeAggregateWriteGeneration: 8,
    completionAggregateWriteGeneration: 9,
    targetDishId: role === "source" ? `${dishId}-target` : null,
    createdAt: now,
    indexedAt: now,
  });
}

test("strict claim parser accepts only the four exact request shapes", () => {
  for (const request of [
    restaurantMergeRequest(),
    restaurantDeleteRequest(),
    dishMergeRequest(),
    dishDeleteRequest(),
  ]) {
    assert.deepEqual(parseRatingDestructiveClaimRequest(request), request);
  }

  const invalid = [
    null,
    {},
    {...dishDeleteRequest(), contractVersion: "v0"},
    {...dishDeleteRequest(), operation: "genericDelete"},
    {...dishDeleteRequest(), unexpected: true},
    {...dishDeleteRequest(), requestId: ""},
    {...dishDeleteRequest(), requestId: "."},
    {...dishDeleteRequest(), requestId: ".."},
    {...dishDeleteRequest(), requestId: "bad/id"},
    {...dishDeleteRequest(), requestId: "x".repeat(1_501)},
    {...dishDeleteRequest(), sourceDishId: "bad/id"},
    {...restaurantDeleteRequest(), expectedSourceRestaurantRevision: -1},
    {...restaurantDeleteRequest(), expectedSourceRestaurantRevision: 1.5},
    {...restaurantDeleteRequest(), expectedSourceRestaurantRevision: "7"},
  ];
  delete invalid[1].requestId;
  for (const request of invalid) {
    assert.throws(
      () => parseRatingDestructiveClaimRequest(request),
      (error) => assertClaimError(error, "invalid-request"),
    );
  }
});

test("dish claims reject forbidden identity and generation fields before a transaction", async () => {
  const attempts = [
    dishDeleteRequest({restaurantId: "unexpected-restaurant"}),
    dishMergeRequest({expectedSourceAggregateGeneration: 4}),
    dishMergeRequest({expectedTargetAggregateGeneration: 11}),
    dishDeleteRequest({expectedSourceAggregateGeneration: 4}),
    dishDeleteRequest({expectedTargetAggregateGeneration: 11}),
  ];

  for (const request of attempts) {
    const database = new InMemoryRatingDestructiveDatabase();
    seedDish(database, "dish-a", "restaurant-a", 3);
    if (request.operation === "dishMerge") {
      seedDish(database, "dish-b", "restaurant-a", 10);
    }
    const sourceBefore = database.data("bitescore_dishes/dish-a");
    const targetBefore = database.data("bitescore_dishes/dish-b");

    await rejectsClaim(database, request, "invalid-request");

    assert.equal(database.committedTransactions.length, 0);
    assert.deepEqual(
      database.data("bitescore_dishes/dish-a"),
      sourceBefore,
    );
    assert.deepEqual(
      database.data("bitescore_dishes/dish-b"),
      targetBefore,
    );
    assert.equal(
      database.has(ratingDestructiveJobPath(destructiveJobId(request))),
      false,
    );
    assert.equal(
      database.documentsIn(ratingDishOperationLockCollection).length,
      0,
    );
  }
});

test("restaurantMerge claim atomically reserves both revisions and locks", async () => {
  const database = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(database, "restaurant-a", 7);
  seedRestaurant(database, "restaurant-b", 20);

  const result = await claimRatingDestructiveOperation(
    dependencies(database),
    restaurantMergeRequest(),
    now,
  );

  assert.equal(result.claimed, true);
  assert.equal(result.job.operation, "restaurantMerge");
  assert.equal(result.job.phase, "claimed");
  assert.equal(result.job.expectedSourceRestaurantRevision, 7);
  assert.equal(result.job.sourceActiveRestaurantRevision, 8);
  assert.equal(result.job.sourceCompletionRestaurantRevision, 9);
  assert.equal(result.job.expectedTargetRestaurantRevision, 20);
  assert.equal(result.job.targetActiveRestaurantRevision, 21);
  assert.equal(result.job.targetCompletionRestaurantRevision, 22);
  assert.equal(
    database.data("bitescore_restaurants/restaurant-a")
      .restaurantWriteRevision,
    8,
  );
  assert.equal(
    database.data("bitescore_restaurants/restaurant-b")
      .restaurantWriteRevision,
    21,
  );
  assert.equal(
    database.data(ratingRestaurantOperationLockPath("restaurant-a")).role,
    "source",
  );
  assert.equal(
    database.data(ratingRestaurantOperationLockPath("restaurant-b")).role,
    "target",
  );
  assert.deepEqual(database.data(ratingDestructiveJobPath(result.job.jobId)), result.job);
});

test("restaurantDelete claim reserves one revision and one source lock", async () => {
  const database = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(database, "restaurant-a", 7);

  const result = await claimRatingDestructiveOperation(
    dependencies(database),
    restaurantDeleteRequest(),
    now,
  );

  assert.equal(result.claimed, true);
  assert.equal(result.job.operation, "restaurantDelete");
  assert.equal(result.job.sourceActiveRestaurantRevision, 8);
  assert.equal(result.job.sourceCompletionRestaurantRevision, null);
  assert.equal(
    database.data("bitescore_restaurants/restaurant-a")
      .restaurantWriteRevision,
    8,
  );
  const lock = database.data(
    ratingRestaurantOperationLockPath("restaurant-a"),
  );
  assert.equal(lock.operation, "restaurantDelete");
  assert.equal(lock.role, "source");
});

test("dishMerge claim reserves both generations and both lock families", async () => {
  const database = new InMemoryRatingDestructiveDatabase();
  seedDish(database, "dish-a", "restaurant-a", 3);
  seedDish(database, "dish-b", "restaurant-a", 10);

  const result = await claimRatingDestructiveOperation(
    dependencies(database),
    dishMergeRequest(),
    now,
  );

  assert.equal(result.claimed, true);
  assert.equal(result.job.operation, "dishMerge");
  assert.equal(result.job.phase, "validate");
  assert.deepEqual({
    expected: result.job.expectedSourceAggregateGeneration,
    active: result.job.sourceActiveAggregateGeneration,
    completion: result.job.sourceCompletionAggregateGeneration,
  }, {expected: 3, active: 4, completion: 5});
  assert.deepEqual({
    expected: result.job.expectedTargetAggregateGeneration,
    active: result.job.targetActiveAggregateGeneration,
    completion: result.job.targetCompletionAggregateGeneration,
  }, {expected: 10, active: 11, completion: 12});
  assert.equal(
    database.data("bitescore_dishes/dish-a").aggregateWriteGeneration,
    4,
  );
  assert.equal(
    database.data("bitescore_dishes/dish-b").aggregateWriteGeneration,
    11,
  );
  assert.equal(database.data(ratingDishOperationLockPath("dish-a")).role, "source");
  assert.equal(database.data(ratingDishOperationLockPath("dish-b")).role, "target");
  assert.equal(database.data(dishMergeReviewLockPath("dish-a")).role, "source");
  assert.equal(database.data(dishMergeReviewLockPath("dish-b")).role, "target");
});

test("dishDelete claim creates one reusable deletion item", async () => {
  const database = new InMemoryRatingDestructiveDatabase();
  seedDish(database, "dish-a", "restaurant-a", 3);

  const result = await claimRatingDestructiveOperation(
    dependencies(database),
    dishDeleteRequest(),
    now,
  );

  assert.equal(result.claimed, true);
  assert.equal(result.job.operation, "dishDelete");
  assert.equal(result.job.phase, "process_reviews");
  assert.ok(result.job.itemCursorId);
  const item = database.data(
    ratingDestructiveJobItemPath(result.job.itemCursorId),
  );
  assert.equal(item.jobId, result.job.jobId);
  assert.equal(item.kind, "dishDeletion");
  assert.equal(item.dishId, "dish-a");
  assert.equal(item.restaurantId, "restaurant-a");
  assert.equal(database.data(ratingDishOperationLockPath("dish-a")).role, "source");
});

test("same request is idempotent without a second revision, generation, or lock", async () => {
  const restaurantDatabase = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(restaurantDatabase, "restaurant-a", 7);
  seedRestaurant(restaurantDatabase, "restaurant-b", 20);
  const restaurantRequest = restaurantMergeRequest();
  const firstRestaurant = await claimRatingDestructiveOperation(
    dependencies(restaurantDatabase),
    restaurantRequest,
    now,
  );
  const secondRestaurant = await claimRatingDestructiveOperation(
    dependencies(restaurantDatabase),
    restaurantRequest,
    later,
  );
  assert.equal(firstRestaurant.claimed, true);
  assert.equal(secondRestaurant.claimed, false);
  assert.deepEqual(secondRestaurant.job, firstRestaurant.job);
  assert.equal(
    restaurantDatabase.data("bitescore_restaurants/restaurant-a")
      .restaurantWriteRevision,
    8,
  );
  assert.equal(
    restaurantDatabase.data("bitescore_restaurants/restaurant-b")
      .restaurantWriteRevision,
    21,
  );
  assert.equal(
    restaurantDatabase.committedSetCount(
      ratingRestaurantOperationLockPath("restaurant-a"),
    ),
    1,
  );
  assert.equal(
    restaurantDatabase.committedSetCount(
      ratingRestaurantOperationLockPath("restaurant-b"),
    ),
    1,
  );
  assert.equal(
    restaurantDatabase.documentsIn(ratingRestaurantOperationLockCollection)
      .length,
    2,
  );

  const dishDatabase = new InMemoryRatingDestructiveDatabase();
  seedDish(dishDatabase, "dish-a", "restaurant-a", 3);
  seedDish(dishDatabase, "dish-b", "restaurant-a", 10);
  const dishRequest = dishMergeRequest();
  const firstDish = await claimRatingDestructiveOperation(
    dependencies(dishDatabase),
    dishRequest,
    now,
  );
  const secondDish = await claimRatingDestructiveOperation(
    dependencies(dishDatabase),
    dishRequest,
    later,
  );
  assert.equal(firstDish.claimed, true);
  assert.equal(secondDish.claimed, false);
  assert.deepEqual(secondDish.job, firstDish.job);
  assert.equal(
    dishDatabase.data("bitescore_dishes/dish-a").aggregateWriteGeneration,
    4,
  );
  assert.equal(
    dishDatabase.data("bitescore_dishes/dish-b").aggregateWriteGeneration,
    11,
  );
  for (const path of [
    ratingDishOperationLockPath("dish-a"),
    ratingDishOperationLockPath("dish-b"),
    dishMergeReviewLockPath("dish-a"),
    dishMergeReviewLockPath("dish-b"),
  ]) {
    assert.equal(dishDatabase.committedSetCount(path), 1);
  }
  assert.equal(
    dishDatabase.documentsIn(ratingDishOperationLockCollection).length,
    2,
  );
});

test("deterministic restaurant retries require the exact expected revisions", async () => {
  const mergeDatabase = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(mergeDatabase, "restaurant-a", 7);
  seedRestaurant(mergeDatabase, "restaurant-b", 20);
  const mergeRequest = restaurantMergeRequest();
  const merge = await claimRatingDestructiveOperation(
    dependencies(mergeDatabase),
    mergeRequest,
    now,
  );
  const mergePath = ratingDestructiveJobPath(merge.job.jobId);
  const mergeSourceLock = ratingRestaurantOperationLockPath("restaurant-a");
  const mergeTargetLock = ratingRestaurantOperationLockPath("restaurant-b");
  const mergeTransactionCount = mergeDatabase.committedTransactions.length;
  const mergeState = {
    job: mergeDatabase.data(mergePath),
    source: mergeDatabase.data("bitescore_restaurants/restaurant-a"),
    target: mergeDatabase.data("bitescore_restaurants/restaurant-b"),
    sourceLock: mergeDatabase.data(mergeSourceLock),
    targetLock: mergeDatabase.data(mergeTargetLock),
  };

  for (const mismatched of [
    restaurantMergeRequest({expectedSourceRestaurantRevision: 8}),
    restaurantMergeRequest({expectedTargetRestaurantRevision: 21}),
  ]) {
    await rejectsClaim(mergeDatabase, mismatched, "operation-conflict");
    assert.equal(
      mergeDatabase.committedTransactions.length,
      mergeTransactionCount,
    );
    assert.deepEqual({
      job: mergeDatabase.data(mergePath),
      source: mergeDatabase.data("bitescore_restaurants/restaurant-a"),
      target: mergeDatabase.data("bitescore_restaurants/restaurant-b"),
      sourceLock: mergeDatabase.data(mergeSourceLock),
      targetLock: mergeDatabase.data(mergeTargetLock),
    }, mergeState);
  }

  const deleteDatabase = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(deleteDatabase, "restaurant-a", 7);
  const deletion = await claimRatingDestructiveOperation(
    dependencies(deleteDatabase),
    restaurantDeleteRequest(),
    now,
  );
  const deletePath = ratingDestructiveJobPath(deletion.job.jobId);
  const deleteLock = ratingRestaurantOperationLockPath("restaurant-a");
  const deleteTransactionCount = deleteDatabase.committedTransactions.length;
  const deleteState = {
    job: deleteDatabase.data(deletePath),
    source: deleteDatabase.data("bitescore_restaurants/restaurant-a"),
    sourceLock: deleteDatabase.data(deleteLock),
  };

  await rejectsClaim(
    deleteDatabase,
    restaurantDeleteRequest({expectedSourceRestaurantRevision: 8}),
    "operation-conflict",
  );
  assert.equal(
    deleteDatabase.committedTransactions.length,
    deleteTransactionCount,
  );
  assert.deepEqual({
    job: deleteDatabase.data(deletePath),
    source: deleteDatabase.data("bitescore_restaurants/restaurant-a"),
    sourceLock: deleteDatabase.data(deleteLock),
  }, deleteState);
});

test("processor preserves every exact typed destructive failure code", async (t) => {
  const expectations = [
    ["temporary_dependency", "retryable"],
    ["preexisting_job_active", "retryable"],
    ["operation_conflict", "manual_review_required"],
    ["malformed_private_state", "manual_review_required"],
    ["entity_state_incompatible", "manual_review_required"],
    ["lock_missing", "manual_review_required"],
    ["revision_exhausted", "manual_review_required"],
    ["generation_exhausted", "manual_review_required"],
    ["unsupported_partial_state", "manual_review_required"],
  ];
  for (const [failureCode, status] of expectations) {
    await t.test(failureCode, async () => {
      const error = new RatingDestructiveProcessError(failureCode);
      const canary = `typed-message-${failureCode}-must-not-persist`;
      error.message = `${canary}: unsupported_partial_state lock_missing`;
      const {database, claim, result} = await processInjectedFailure(
        error,
        `typed-failure-${failureCode}`,
      );
      assert.equal(result.job.status, status);
      assert.equal(result.job.failureCode, failureCode);
      assert.equal(JSON.stringify(result.job).includes(canary), false);
      assert.equal(JSON.stringify(database.data(
        ratingDestructiveJobPath(claim.job.jobId),
      )).includes(canary), false);
    });
  }
});

test("ordinary error messages cannot select a destructive failure code", async (t) => {
  const messages = [
    "active locked remain preexisting_job_active",
    "operation_conflict malformed_private_state lock_missing",
    "entity_state_incompatible revision_exhausted generation_exhausted " +
      "unsupported_partial_state",
  ];
  for (let index = 0; index < messages.length; index += 1) {
    await t.test(`generic-message-${index + 1}`, async () => {
      const canary = `private-generic-message-${index + 1}@example.test`;
      const {database, claim, result} = await processInjectedFailure(
        new Error(`${canary}: ${messages[index]}`),
        `generic-failure-message-${index + 1}`,
      );
      assert.equal(result.job.status, "retryable");
      assert.equal(result.job.failureCode, "temporary_dependency");
      assert.equal(JSON.stringify(result.job).includes(canary), false);
      assert.equal(JSON.stringify(database.data(
        ratingDestructiveJobPath(claim.job.jobId),
      )).includes(canary), false);
    });
  }
});

test("transient Firestore codes normalize only to temporary dependency", async (t) => {
  const transientCodes = [
    "aborted",
    10,
    "unavailable",
    14,
    "deadline-exceeded",
    4,
    "resource-exhausted",
    8,
  ];
  for (let index = 0; index < transientCodes.length; index += 1) {
    const transientCode = transientCodes[index];
    await t.test(String(transientCode), async () => {
      const canary = `private-transient-message-${index + 1}@example.test`;
      const error = Object.assign(
        new Error(`${canary}: operation_conflict unsupported_partial_state`),
        {code: transientCode},
      );
      const {database, claim, result} = await processInjectedFailure(
        error,
        `transient-failure-${index + 1}`,
      );
      assert.equal(result.job.status, "retryable");
      assert.equal(result.job.failureCode, "temporary_dependency");
      assert.equal(JSON.stringify(result.job).includes(canary), false);
      assert.equal(JSON.stringify(database.data(
        ratingDestructiveJobPath(claim.job.jobId),
      )).includes(canary), false);
    });
  }
});

test("typed lock and contract errors use their fixed failure categories", async (t) => {
  const expectations = [
    [
      new ReviewMilestoneReconciliationLockError("conflict"),
      "preexisting_job_active",
      "retryable",
    ],
    [
      new ReviewMilestoneReconciliationLockError("invalid-state"),
      "malformed_private_state",
      "manual_review_required",
    ],
    [
      new RatingDestructiveContractError("invalid-state"),
      "malformed_private_state",
      "manual_review_required",
    ],
    [
      new RatingDestructiveContractError("invalid-request"),
      "malformed_private_state",
      "manual_review_required",
    ],
  ];
  for (let index = 0; index < expectations.length; index += 1) {
    const [error, failureCode, status] = expectations[index];
    await t.test(`${error.name}-${error.code}`, async () => {
      const canary = `private-typed-boundary-${index + 1}@example.test`;
      error.message = `${canary}: unsupported_partial_state`;
      const {database, claim, result} = await processInjectedFailure(
        error,
        `typed-boundary-failure-${index + 1}`,
      );
      assert.equal(result.job.status, status);
      assert.equal(result.job.failureCode, failureCode);
      assert.equal(JSON.stringify(result.job).includes(canary), false);
      assert.equal(JSON.stringify(database.data(
        ratingDestructiveJobPath(claim.job.jobId),
      )).includes(canary), false);
    });
  }
});

test("failure recorder updates only the exact active dispatched snapshot", async () => {
  const exactDatabase = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(exactDatabase, "restaurant-a", 7);
  seedRestaurant(exactDatabase, "restaurant-b", 20);
  const exactClaim = await claimRatingDestructiveOperation(
    dependencies(exactDatabase),
    restaurantMergeRequest({requestId: "failure-recorder-exact"}),
    now,
  );
  let exactTransactionCall = 0;
  const exactDependencies = dependencies(exactDatabase);
  exactDependencies.database = {
    async runTransaction(operation) {
      exactTransactionCall += 1;
      if (exactTransactionCall === 2) {
        throw new Error("injected worker failure");
      }
      return exactDatabase.runTransaction(operation);
    },
  };
  const exactResult = await processRatingDestructiveJobStep(
    exactDependencies,
    exactClaim.job.jobId,
    later,
  );
  assert.equal(exactTransactionCall, 3);
  assert.equal(exactResult.processedDocuments, 0);
  assert.equal(exactResult.job.status, "retryable");
  assert.equal(exactResult.job.failureCode, "temporary_dependency");
  assert.equal(
    exactDatabase.committedSetCount(
      ratingDestructiveJobPath(exactClaim.job.jobId),
    ),
    2,
  );

  const races = [
    {
      name: "manual review",
      changes: {
        status: "manual_review_required",
        failureCode: "operation_conflict",
        updatedAt: later,
      },
    },
    {
      name: "retryable",
      changes: {
        status: "retryable",
        failureCode: "temporary_dependency",
        updatedAt: later,
      },
    },
    {
      name: "complete",
      changes: {
        status: "complete",
        phase: "complete",
        failureCode: null,
        completedAt: later,
        updatedAt: later,
      },
    },
    {
      name: "another phase",
      changes: {
        phase: "move_dishes",
        updatedAt: later,
      },
    },
    {
      name: "another fingerprint in the same phase",
      changes: {
        processedCount: 1,
        updatedAt: later,
      },
    },
  ];

  for (const race of races) {
    const database = new InMemoryRatingDestructiveDatabase();
    seedRestaurant(database, "restaurant-a", 7);
    seedRestaurant(database, "restaurant-b", 20);
    const claim = await claimRatingDestructiveOperation(
      dependencies(database),
      restaurantMergeRequest({
        requestId: `failure-recorder-${race.name.replaceAll(" ", "-")}`,
      }),
      now,
    );
    const racedJob = rebuildRatingDestructiveJob(claim.job, race.changes);
    const jobPath = ratingDestructiveJobPath(claim.job.jobId);
    let transactionCall = 0;
    const racedDependencies = dependencies(database);
    racedDependencies.database = {
      async runTransaction(operation) {
        transactionCall += 1;
        if (transactionCall === 2) {
          throw new Error("injected worker failure");
        }
        if (transactionCall === 3) {
          await database.runTransaction(async (transaction) => {
            transaction.setDocument(jobPath, racedJob);
          });
        }
        return database.runTransaction(operation);
      },
    };

    const result = await processRatingDestructiveJobStep(
      racedDependencies,
      claim.job.jobId,
      later,
    );

    assert.equal(transactionCall, 3, race.name);
    assert.equal(result.processedDocuments, 0, race.name);
    assert.deepEqual(result.job, racedJob, race.name);
    assert.deepEqual(database.data(jobPath), racedJob, race.name);
    assert.equal(database.committedSetCount(jobPath), 2, race.name);
  }
});

test("different requests for the same entity conflict without partial writes", async () => {
  const restaurantDatabase = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(restaurantDatabase, "restaurant-a", 7);
  await claimRatingDestructiveOperation(
    dependencies(restaurantDatabase),
    restaurantDeleteRequest({requestId: "restaurant-delete-first"}),
    now,
  );
  const transactionCount = restaurantDatabase.committedTransactions.length;
  await rejectsClaim(
    restaurantDatabase,
    restaurantDeleteRequest({
      requestId: "restaurant-delete-second",
      expectedSourceRestaurantRevision: 8,
    }),
    "operation-conflict",
  );
  assert.equal(restaurantDatabase.committedTransactions.length, transactionCount);
  assert.equal(
    restaurantDatabase.documentsIn(ratingRestaurantOperationLockCollection)
      .length,
    1,
  );

  const dishDatabase = new InMemoryRatingDestructiveDatabase();
  seedDish(dishDatabase, "dish-a");
  await claimRatingDestructiveOperation(
    dependencies(dishDatabase),
    dishDeleteRequest({requestId: "dish-delete-first"}),
    now,
  );
  await rejectsClaim(
    dishDatabase,
    dishDeleteRequest({requestId: "dish-delete-second"}),
    "operation-conflict",
  );
  assert.equal(
    dishDatabase.documentsIn(ratingDishOperationLockCollection).length,
    1,
  );
});

test("merge and delete requests conflict within each operation-lock family", async () => {
  const restaurantDatabase = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(restaurantDatabase, "restaurant-a", 7);
  seedRestaurant(restaurantDatabase, "restaurant-b", 20);
  await claimRatingDestructiveOperation(
    dependencies(restaurantDatabase),
    restaurantMergeRequest({requestId: "restaurant-merge-first"}),
    now,
  );
  await rejectsClaim(
    restaurantDatabase,
    restaurantDeleteRequest({
      requestId: "restaurant-delete-after-merge",
      sourceRestaurantId: "restaurant-b",
      expectedSourceRestaurantRevision: 21,
    }),
    "operation-conflict",
  );

  const dishDatabase = new InMemoryRatingDestructiveDatabase();
  seedDish(dishDatabase, "dish-a", "restaurant-a", 3);
  seedDish(dishDatabase, "dish-b", "restaurant-a", 10);
  await claimRatingDestructiveOperation(
    dependencies(dishDatabase),
    dishMergeRequest({requestId: "dish-merge-first"}),
    now,
  );
  await rejectsClaim(
    dishDatabase,
    dishDeleteRequest({requestId: "dish-delete-after-merge"}),
    "operation-conflict",
  );
});

test("dish and restaurant claims conflict in either commit order", async () => {
  const dishFirst = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(dishFirst, "restaurant-a", 7);
  seedDish(dishFirst, "dish-a", "restaurant-a");
  await claimRatingDestructiveOperation(
    dependencies(dishFirst),
    dishDeleteRequest({requestId: "dish-first"}),
    now,
  );
  await rejectsClaim(
    dishFirst,
    restaurantDeleteRequest({requestId: "restaurant-second"}),
    "operation-conflict",
  );
  assert.equal(
    dishFirst.data("bitescore_restaurants/restaurant-a")
      .restaurantWriteRevision,
    7,
  );

  const restaurantFirst = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(restaurantFirst, "restaurant-a", 7);
  seedDish(restaurantFirst, "dish-a", "restaurant-a");
  await claimRatingDestructiveOperation(
    dependencies(restaurantFirst),
    restaurantDeleteRequest({requestId: "restaurant-first"}),
    now,
  );
  await rejectsClaim(
    restaurantFirst,
    dishDeleteRequest({requestId: "dish-second"}),
    "operation-conflict",
  );
  assert.equal(
    restaurantFirst.documentsIn(ratingDishOperationLockCollection).length,
    0,
  );
});

test("A-to-B and B-to-A merge claims cannot both reserve the same entities", async () => {
  const restaurantDatabase = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(restaurantDatabase, "restaurant-a", 7);
  seedRestaurant(restaurantDatabase, "restaurant-b", 20);
  await claimRatingDestructiveOperation(
    dependencies(restaurantDatabase),
    restaurantMergeRequest({requestId: "restaurant-a-to-b"}),
    now,
  );
  await rejectsClaim(
    restaurantDatabase,
    restaurantMergeRequest({
      requestId: "restaurant-b-to-a",
      sourceRestaurantId: "restaurant-b",
      targetRestaurantId: "restaurant-a",
      expectedSourceRestaurantRevision: 21,
      expectedTargetRestaurantRevision: 8,
    }),
    "operation-conflict",
  );

  const dishDatabase = new InMemoryRatingDestructiveDatabase();
  seedDish(dishDatabase, "dish-a", "restaurant-a", 3);
  seedDish(dishDatabase, "dish-b", "restaurant-a", 10);
  await claimRatingDestructiveOperation(
    dependencies(dishDatabase),
    dishMergeRequest({requestId: "dish-a-to-b"}),
    now,
  );
  await rejectsClaim(
    dishDatabase,
    dishMergeRequest({
      requestId: "dish-b-to-a",
      sourceDishId: "dish-b",
      targetDishId: "dish-a",
    }),
    "operation-conflict",
  );
});

test("missing, equal, incompatible, and stale entities fail closed", async () => {
  const missingSource = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(missingSource, "restaurant-b", 20);
  await rejectsClaim(missingSource, restaurantMergeRequest(), "entity-not-found");

  const missingTarget = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(missingTarget, "restaurant-a", 7);
  await rejectsClaim(missingTarget, restaurantMergeRequest(), "entity-not-found");

  const missingDishSource = new InMemoryRatingDestructiveDatabase();
  seedDish(missingDishSource, "dish-b", "restaurant-a", 10);
  await rejectsClaim(
    missingDishSource,
    dishMergeRequest(),
    "entity-not-found",
  );

  const missingDishTarget = new InMemoryRatingDestructiveDatabase();
  seedDish(missingDishTarget, "dish-a", "restaurant-a", 3);
  await rejectsClaim(
    missingDishTarget,
    dishMergeRequest(),
    "entity-not-found",
  );

  const equalRestaurant = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(equalRestaurant, "restaurant-a", 7);
  await rejectsClaim(
    equalRestaurant,
    restaurantMergeRequest({
      targetRestaurantId: "restaurant-a",
      expectedTargetRestaurantRevision: 7,
    }),
    "invalid-request",
  );

  const equalDish = new InMemoryRatingDestructiveDatabase();
  seedDish(equalDish, "dish-a");
  await rejectsClaim(
    equalDish,
    dishMergeRequest({targetDishId: "dish-a"}),
    "invalid-request",
  );

  const stale = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(stale, "restaurant-a", 8);
  seedRestaurant(stale, "restaurant-b", 20);
  await rejectsClaim(stale, restaurantMergeRequest(), "stale-revision");
  assert.equal(
    stale.data("bitescore_restaurants/restaurant-a").restaurantWriteRevision,
    8,
  );

  const staleTarget = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(staleTarget, "restaurant-a", 7);
  seedRestaurant(staleTarget, "restaurant-b", 21);
  await rejectsClaim(
    staleTarget,
    restaurantMergeRequest(),
    "stale-revision",
  );

  const staleDelete = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(staleDelete, "restaurant-a", 8);
  await rejectsClaim(
    staleDelete,
    restaurantDeleteRequest(),
    "stale-revision",
  );

  const inactiveTarget = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(inactiveTarget, "restaurant-a", 7);
  seedRestaurant(inactiveTarget, "restaurant-b", 20, {isActive: false});
  await rejectsClaim(
    inactiveTarget,
    restaurantMergeRequest(),
    "entity-state-incompatible",
  );

  const wrongRestaurant = new InMemoryRatingDestructiveDatabase();
  seedDish(wrongRestaurant, "dish-a", "restaurant-a");
  seedDish(wrongRestaurant, "dish-b", "restaurant-b");
  await rejectsClaim(
    wrongRestaurant,
    dishMergeRequest(),
    "entity-state-incompatible",
  );
});

test("revision and aggregate-generation exhaustion produce exact terminal errors", async () => {
  const deleteRevision = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(deleteRevision, "restaurant-a", maximumSafeInteger);
  await rejectsClaim(
    deleteRevision,
    restaurantDeleteRequest({
      expectedSourceRestaurantRevision: maximumSafeInteger,
    }),
    "revision-exhausted",
  );

  const mergeRevision = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(mergeRevision, "restaurant-a", maximumSafeInteger - 1);
  seedRestaurant(mergeRevision, "restaurant-b", 20);
  await rejectsClaim(
    mergeRevision,
    restaurantMergeRequest({
      expectedSourceRestaurantRevision: maximumSafeInteger - 1,
    }),
    "revision-exhausted",
  );

  const generation = new InMemoryRatingDestructiveDatabase();
  seedDish(
    generation,
    "dish-a",
    "restaurant-a",
    maximumSafeInteger - 1,
  );
  seedDish(generation, "dish-b", "restaurant-a", 10);
  await rejectsClaim(
    generation,
    dishMergeRequest(),
    "generation-exhausted",
  );
  assert.equal(
    generation.documentsIn(ratingDishOperationLockCollection).length,
    0,
  );
});

test("malformed deterministic job and operation locks fail closed", async () => {
  const malformedJob = new InMemoryRatingDestructiveDatabase();
  const request = dishDeleteRequest();
  malformedJob.seed(ratingDestructiveJobPath(destructiveJobId(request)), {
    version: "malformed",
  });
  await rejectsClaim(
    malformedJob,
    request,
    "malformed-private-state",
  );

  const malformedRestaurantLock = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(malformedRestaurantLock, "restaurant-a", 7);
  malformedRestaurantLock.seed(
    ratingRestaurantOperationLockPath("restaurant-a"),
    {version: "malformed"},
  );
  await rejectsClaim(
    malformedRestaurantLock,
    restaurantDeleteRequest(),
    "malformed-private-state",
  );

  const malformedDishLock = new InMemoryRatingDestructiveDatabase();
  seedDish(malformedDishLock, "dish-a");
  malformedDishLock.seed(
    ratingDishOperationLockPath("dish-a"),
    {version: "malformed"},
  );
  await rejectsClaim(
    malformedDishLock,
    dishDeleteRequest(),
    "malformed-private-state",
  );

  const malformedReviewLock = new InMemoryRatingDestructiveDatabase();
  seedDish(malformedReviewLock, "dish-a");
  malformedReviewLock.seed(
    dishMergeReviewLockPath("dish-a"),
    {version: "malformed"},
  );
  await rejectsClaim(
    malformedReviewLock,
    dishDeleteRequest(),
    "malformed-private-state",
  );
});

test("valid pre-existing locks conflict and are never overwritten", async () => {
  const restaurantDatabase = new InMemoryRatingDestructiveDatabase();
  seedRestaurant(restaurantDatabase, "restaurant-a", 7);
  const restaurantLock = buildRatingRestaurantOperationLockDocument({
    restaurantId: "restaurant-a",
    jobId: "older-restaurant-job",
    operation: "restaurantDelete",
    role: "source",
    state: "active_source",
    active: true,
    permanent: false,
    targetRestaurantId: null,
    createdAt: now,
    updatedAt: now,
  });
  restaurantDatabase.seed(
    ratingRestaurantOperationLockPath("restaurant-a"),
    restaurantLock,
  );
  await rejectsClaim(
    restaurantDatabase,
    restaurantDeleteRequest(),
    "operation-conflict",
  );
  assert.deepEqual(
    restaurantDatabase.data(ratingRestaurantOperationLockPath("restaurant-a")),
    restaurantLock,
  );

  const dishDatabase = new InMemoryRatingDestructiveDatabase();
  seedDish(dishDatabase, "dish-a");
  const dishLock = buildRatingDishOperationLockDocument({
    dishId: "dish-a",
    jobId: "older-dish-job",
    operation: "dishDelete",
    role: "source",
    state: "active_source",
    active: true,
    permanent: false,
    restaurantId: "restaurant-a",
    targetDishId: null,
    createdAt: now,
    updatedAt: now,
  });
  dishDatabase.seed(ratingDishOperationLockPath("dish-a"), dishLock);
  await rejectsClaim(
    dishDatabase,
    dishDeleteRequest(),
    "operation-conflict",
  );
  assert.deepEqual(
    dishDatabase.data(ratingDishOperationLockPath("dish-a")),
    dishLock,
  );
});

test("active Dish Suggestions jobs conflict with direct merge and deletion", async () => {
  for (const request of [dishMergeRequest(), dishDeleteRequest()]) {
    const database = new InMemoryRatingDestructiveDatabase();
    seedDish(database, "dish-a", "restaurant-a", 3);
    if (request.operation === "dishMerge") {
      seedDish(database, "dish-b", "restaurant-a", 10);
    }
    const proposalJob = activeProposalJob("dish-a");
    database.seed(dishProposalJobPath(proposalJob.jobId), proposalJob);
    await rejectsClaim(database, request, "operation-conflict");
    assert.equal(
      database.documentsIn(ratingDishOperationLockCollection).length,
      0,
    );
  }
});

test("active Dish Suggestions review locks conflict with direct merge and deletion", async () => {
  for (const request of [dishMergeRequest(), dishDeleteRequest()]) {
    const database = new InMemoryRatingDestructiveDatabase();
    seedDish(database, "dish-a", "restaurant-a", 3);
    if (request.operation === "dishMerge") {
      seedDish(database, "dish-b", "restaurant-a", 10);
    }
    const lock = activeReviewLock("dish-a");
    database.seed(dishMergeReviewLockPath("dish-a"), lock);
    await rejectsClaim(database, request, "operation-conflict");
    assert.deepEqual(database.data(dishMergeReviewLockPath("dish-a")), lock);
  }
});

test("dishDelete may claim a missing dish without inventing restaurant identity", async () => {
  const database = new InMemoryRatingDestructiveDatabase();
  const result = await claimRatingDestructiveOperation(
    dependencies(database),
    dishDeleteRequest(),
    now,
  );

  assert.equal(result.claimed, true);
  assert.equal(result.job.restaurantId, null);
  const lock = database.data(ratingDishOperationLockPath("dish-a"));
  assert.equal(lock.restaurantId, null);
  const item = database.data(
    ratingDestructiveJobItemPath(result.job.itemCursorId),
  );
  assert.equal(item.restaurantId, null);
  assert.equal(item.dishId, "dish-a");
  assert.equal(database.has("bitescore_dishes/dish-a"), false);
});
