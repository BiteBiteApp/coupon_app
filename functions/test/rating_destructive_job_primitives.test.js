"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  ratingDestructiveAggregateWinnerCollectionPath,
  scanRatingDestructiveAggregateWinnerPage,
  foldRatingDestructiveAggregateWinnerPage,
} = require("../lib/rating_destructive_aggregate.js");
const {
  buildRatingDestructiveJobDocument,
  buildRatingDestructiveJobItemDocument,
  buildRatingDishOperationLockDocument,
  createRatingDestructiveJobId,
  createRatingDestructiveJobItemId,
  ratingDestructiveJobItemCollection,
  ratingDestructiveJobItemPath,
  ratingDestructiveJobPath,
  ratingDishOperationLockPath,
} = require("../lib/rating_destructive_job_contract.js");
const {
  buildInitialDishDeletionItem,
  processDishDeletionItemStep,
  processFirstReviewDeletionUnit,
  processMilestoneUserItemStep,
  processStandaloneDishDeleteStep,
} = require("../lib/rating_dish_delete_job.js");

const baseTime = new Date("2026-08-11T12:00:00.000Z");
const nextTime = new Date("2026-08-11T12:01:00.000Z");
const laterTime = new Date("2026-08-11T12:02:00.000Z");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function sha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
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
    default: throw new Error("unsupported-test-query-operator");
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

class StrictInMemoryDatabase {
  constructor() {
    this.records = new Map();
    this.attemptedQueries = [];
    this.committedTransactions = [];
  }

  seed(path, data, createTime = baseTime) {
    this.records.set(path, {data: clone(data), createTime: clone(createTime)});
  }

  replace(path, data, createTime = baseTime) {
    this.records.set(path, {data: clone(data), createTime: clone(createTime)});
  }

  data(path) {
    return clone(this.records.get(path)?.data);
  }

  has(path) {
    return this.records.has(path);
  }

  documentsIn(collectionPath) {
    const prefix = `${collectionPath}/`;
    const segmentCount = collectionPath.split("/").length + 1;
    return [...this.records.entries()]
      .filter(([path]) => path.startsWith(prefix) &&
        path.split("/").length === segmentCount)
      .map(([path, stored]) => ({
        id: path.slice(prefix.length),
        path,
        data: clone(stored.data),
        createTime: clone(stored.createTime),
      }));
  }

  setCount(path) {
    return this.committedTransactions.flat().filter(
      (operation) => operation.type === "set" && operation.path === path,
    ).length;
  }

  async runTransaction(operation) {
    const working = new Map(
      [...this.records.entries()].map(([path, stored]) => [path, clone(stored)]),
    );
    const transaction = new StrictInMemoryTransaction(this, working);
    const result = await operation(transaction);
    this.records = working;
    this.committedTransactions.push(clone(transaction.operations));
    return result;
  }
}

class StrictInMemoryTransaction {
  constructor(database, working) {
    this.database = database;
    this.working = working;
    this.operations = [];
    this.hasWritten = false;
  }

  assertCanRead() {
    assert.equal(
      this.hasWritten,
      false,
      "a destructive primitive attempted a Firestore read after a write",
    );
  }

  async getDocument(path) {
    this.assertCanRead();
    this.operations.push({type: "get", path});
    const stored = this.working.get(path);
    if (stored === undefined) return null;
    return {
      id: path.slice(path.lastIndexOf("/") + 1),
      data: clone(stored.data),
      createTime: clone(stored.createTime),
    };
  }

  async queryDocuments(query) {
    this.assertCanRead();
    assert.ok(Number.isInteger(query.limit) && query.limit > 0);
    this.database.attemptedQueries.push(clone(query));
    this.operations.push({type: "query", query: clone(query)});
    const prefix = `${query.collectionPath}/`;
    const segmentCount = query.collectionPath.split("/").length + 1;
    return [...this.working.entries()]
      .filter(([path]) => path.startsWith(prefix) &&
        path.split("/").length === segmentCount)
      .map(([path, stored]) => ({
        id: path.slice(prefix.length),
        data: clone(stored.data),
        createTime: clone(stored.createTime),
      }))
      .filter((document) => (query.where ?? []).every(
        (condition) => matchesCondition(document, condition),
      ))
      .sort((left, right) => compareDocuments(left, right, query.orderBy))
      .filter((document) => isAfterCursor(document, query))
      .slice(0, query.limit);
  }

  setDocument(path, data, options = undefined) {
    this.hasWritten = true;
    this.operations.push({type: "set", path, data: clone(data)});
    const existing = this.working.get(path);
    this.working.set(path, {
      data: options?.merge === true && existing !== undefined
        ? {...clone(existing.data), ...clone(data)}
        : clone(data),
      createTime: existing?.createTime ?? baseTime,
    });
  }

  deleteDocument(path) {
    this.hasWritten = true;
    this.operations.push({type: "delete", path});
    this.working.delete(path);
  }
}

function dishDeleteIdentity(requestId = "request-dish-delete") {
  const identity = {
    requestId,
    operation: "dishDelete",
    sourceRestaurantId: null,
    targetRestaurantId: null,
    sourceDishId: "dish-source",
    targetDishId: null,
    restaurantId: null,
  };
  return {...identity, jobId: createRatingDestructiveJobId(identity)};
}

function buildDishDeleteJob(changes = {}) {
  const identity = dishDeleteIdentity(changes.requestId);
  const phase = changes.phase ?? "process_reviews";
  const status = changes.status ?? (phase === "complete" ? "complete" : "active");
  const defaultItemCursorId = status === "complete"
    ? null
    : createRatingDestructiveJobItemId({
        jobId: identity.jobId,
        operation: "dishDelete",
        kind: "dishDeletion",
        restaurantId: "restaurant-1",
        dishId: "dish-source",
        userId: null,
      });
  return buildRatingDestructiveJobDocument({
    ...identity,
    status,
    phase,
    expectedSourceRestaurantRevision: null,
    sourceActiveRestaurantRevision: null,
    sourceCompletionRestaurantRevision: null,
    expectedTargetRestaurantRevision: null,
    targetActiveRestaurantRevision: null,
    targetCompletionRestaurantRevision: null,
    expectedSourceAggregateGeneration: null,
    sourceActiveAggregateGeneration: null,
    sourceCompletionAggregateGeneration: null,
    expectedTargetAggregateGeneration: null,
    targetActiveAggregateGeneration: null,
    targetCompletionAggregateGeneration: null,
    cursorDocumentId: null,
    itemCursorId: defaultItemCursorId,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
    processedCount: 0,
    phaseProcessedCount: 0,
    failureCode: status === "active" || status === "complete"
      ? null
      : "entity_state_incompatible",
    createdAt: baseTime,
    updatedAt: baseTime,
    completedAt: status === "complete" ? baseTime : null,
    ...changes,
    jobId: identity.jobId,
    requestId: identity.requestId,
  });
}

function rebuildJob(job, changes) {
  const {version: _version, fingerprint: _fingerprint, ...core} = job;
  return buildRatingDestructiveJobDocument({...core, ...changes});
}

function rebuildItem(item, changes) {
  const {version: _version, fingerprint: _fingerprint, ...core} = item;
  return buildRatingDestructiveJobItemDocument({...core, ...changes});
}

function activeDishLock(job) {
  return buildRatingDishOperationLockDocument({
    dishId: "dish-source",
    jobId: job.jobId,
    operation: "dishDelete",
    role: "source",
    state: "active_source",
    active: true,
    permanent: false,
    restaurantId: "restaurant-1",
    targetDishId: null,
    createdAt: baseTime,
    updatedAt: baseTime,
  });
}

function pointCursor(jobId, dishId, afterLedgerDocumentId) {
  const version = "bitestar.contribution-dish-reverse-cursor.v2";
  const operationFingerprint = sha256([
    "bitestar.review-milestone-operation.v1",
    ["operationId", jobId],
  ]);
  const dishFingerprint = sha256([
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
    fingerprint: sha256([
      version,
      ["phase", core.phase],
      ["operationFingerprint", operationFingerprint],
      ["dishFingerprint", dishFingerprint],
      ["afterLedgerDocumentId", afterLedgerDocumentId],
    ]),
  };
}

function unexpectedExternal() {
  const unexpected = async () => {
    throw new Error("unexpected-external-step");
  };
  return {
    reverseDishContributionPointsStep: unexpected,
    claimMilestoneUser: unexpected,
    resetMilestoneAccumulatorStep: unexpected,
    scanMilestoneReviewsStep: unexpected,
    reconcileMilestoneStep: unexpected,
    releaseMilestoneUser: unexpected,
  };
}

function review(id, changes = {}) {
  return {
    id,
    dishId: "dish-source",
    restaurantId: "restaurant-1",
    userId: "user-1",
    overallImpression: 8,
    tastinessScore: 9,
    qualityScore: 7,
    valueScore: 6,
    overallBiteScore: 80,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...changes,
  };
}

function assertReadsPrecedeWrites(operations) {
  const firstWrite = operations.findIndex(
    (operation) => operation.type === "set" || operation.type === "delete",
  );
  assert.notEqual(firstWrite, -1);
  assert.equal(
    operations.slice(firstWrite).some(
      (operation) => operation.type === "get" || operation.type === "query",
    ),
    false,
  );
}

test("aggregate namespace paths are exact and fail closed without leaking input", () => {
  assert.equal(
    ratingDestructiveAggregateWinnerCollectionPath("namespace-1"),
    "private_rating_destructive_job_items/namespace-1/aggregate_winners",
  );
  const canary = "secret@example.test/path";
  assert.throws(
    () => ratingDestructiveAggregateWinnerCollectionPath(canary),
    (error) => {
      assert.equal(error.name, "RatingDestructiveContractError");
      assert.equal(error.code, "invalid-request");
      assert.equal(error.message.includes(canary), false);
      assert.equal(error.message.includes("secret@example.test"), false);
      return true;
    },
  );
  for (const invalid of ["", ".", ".."]) {
    assert.throws(
      () => ratingDestructiveAggregateWinnerCollectionPath(invalid),
      {name: "RatingDestructiveContractError", code: "invalid-request"},
    );
  }
});

test("aggregate scan and fold are bounded, read-before-write, and content-minimal", async () => {
  const database = new StrictInMemoryDatabase();
  database.seed("dish_reviews/review-a", review("review-a", {
    userId: "user-1",
    overallBiteScore: 50,
    updatedAt: baseTime,
    headline: "private-headline-canary",
    notes: "private-notes-canary",
    nested: {token: "private-token-canary"},
  }));
  database.seed("dish_reviews/review-b", review("review-b", {
    userId: " user-1 ",
    overallBiteScore: 90,
    updatedAt: nextTime,
  }));
  database.seed("dish_reviews/review-c", review("review-c", {
    userId: "user-2",
    overallBiteScore: 70,
  }));

  const scan = await database.runTransaction((transaction) =>
    scanRatingDestructiveAggregateWinnerPage(transaction, {
      namespaceId: "namespace-aggregate",
      role: "target",
      dishId: "dish-source",
      cursorDocumentId: null,
      now: nextTime,
    }));
  assert.deepEqual(scan, {
    processedDocuments: 3,
    nextCursorDocumentId: null,
    complete: true,
  });
  assertReadsPrecedeWrites(database.committedTransactions[0]);
  const scanQuery = database.attemptedQueries[0];
  assert.equal(scanQuery.collectionPath, "dish_reviews");
  assert.equal(scanQuery.limit, 100);
  assert.deepEqual(scanQuery.orderBy, [{field: "__name__", direction: "asc"}]);

  const winnerPath = ratingDestructiveAggregateWinnerCollectionPath(
    "namespace-aggregate",
  );
  const winners = database.documentsIn(winnerPath);
  assert.equal(winners.length, 2);
  const serializedWinners = JSON.stringify(winners);
  for (const canary of [
    "private-headline-canary",
    "private-notes-canary",
    "private-token-canary",
  ]) {
    assert.equal(serializedWinners.includes(canary), false, canary);
  }

  const fold = await database.runTransaction((transaction) =>
    foldRatingDestructiveAggregateWinnerPage(transaction, {
      namespaceId: "namespace-aggregate",
      role: "target",
      dishId: "dish-source",
      restaurantId: "restaurant-1",
      cursorDocumentId: null,
      aggregateState: null,
    }));
  assert.equal(fold.processedDocuments, 2);
  assert.equal(fold.complete, true);
  assert.equal(fold.nextCursorDocumentId, null);
  assert.equal(fold.aggregate.ratingCount, 2);
  assert.equal(fold.aggregate.overallBiteScore, 80);
  assert.equal(database.documentsIn(winnerPath).length, 0);
  assertReadsPrecedeWrites(database.committedTransactions[1]);
  assert.equal(database.attemptedQueries[1].limit, 100);
});

test("review deletion drains 50-document trust pages in order and dedupes milestone users", async () => {
  const database = new StrictInMemoryDatabase();
  const job = buildDishDeleteJob();
  database.seed(ratingDestructiveJobPath(job.jobId), job);
  database.seed("dish_reviews/review-1", review("review-1", {
    headline: "review-headline-canary",
    notes: "review-notes-canary",
    email: "review-email-canary@example.test",
  }));
  for (let index = 0; index < 51; index += 1) {
    const suffix = String(index).padStart(3, "0");
    database.seed(`review_feedback_votes/vote-${suffix}`, {
      reviewId: "review-1",
      userId: `voter-${suffix}`,
    });
    database.seed(`review_reports/report-${suffix}`, {
      reviewId: "review-1",
      reason: "private-report-reason-canary",
    });
  }

  const runUnit = () => database.runTransaction((transaction) =>
    processFirstReviewDeletionUnit(
      transaction,
      job,
      "dishId",
      "dish-source",
      nextTime,
    ));

  assert.deepEqual(await runUnit(), {found: true, processedDocuments: 50});
  assert.equal(database.documentsIn("review_feedback_votes").length, 1);
  assert.equal(database.documentsIn("review_reports").length, 51);
  assert.equal(database.has("dish_reviews/review-1"), true);

  assert.deepEqual(await runUnit(), {found: true, processedDocuments: 1});
  assert.equal(database.documentsIn("review_feedback_votes").length, 0);
  assert.equal(database.documentsIn("review_reports").length, 51);

  assert.deepEqual(await runUnit(), {found: true, processedDocuments: 50});
  assert.equal(database.documentsIn("review_reports").length, 1);
  assert.equal(database.has("dish_reviews/review-1"), true);

  assert.deepEqual(await runUnit(), {found: true, processedDocuments: 1});
  assert.equal(database.documentsIn("review_reports").length, 0);
  assert.deepEqual(await runUnit(), {found: true, processedDocuments: 1});
  assert.equal(database.has("dish_reviews/review-1"), false);

  const milestoneItemId = createRatingDestructiveJobItemId({
    jobId: job.jobId,
    operation: "dishDelete",
    kind: "milestoneUser",
    restaurantId: null,
    dishId: null,
    userId: "user-1",
  });
  const milestonePath = ratingDestructiveJobItemPath(milestoneItemId);
  assert.equal(database.has(milestonePath), true);
  assert.equal(database.setCount(milestonePath), 1);

  database.seed("dish_reviews/review-2", review("review-2", {
    headline: "second-review-headline-canary",
  }));
  assert.deepEqual(await runUnit(), {found: true, processedDocuments: 1});
  assert.equal(database.has("dish_reviews/review-2"), false);
  assert.equal(database.setCount(milestonePath), 1);
  assert.equal(database.documentsIn(ratingDestructiveJobItemCollection).length, 1);

  const trustQueries = database.attemptedQueries.filter((query) =>
    query.collectionPath === "review_feedback_votes" ||
    query.collectionPath === "review_reports");
  assert.equal(trustQueries.length >= 6, true);
  assert.equal(trustQueries.every((query) => query.limit === 50), true);
  const reviewQueries = database.attemptedQueries.filter(
    (query) => query.collectionPath === "dish_reviews",
  );
  assert.equal(reviewQueries.every((query) => query.limit === 1), true);

  const privateState = JSON.stringify(
    database.documentsIn(ratingDestructiveJobItemCollection),
  );
  for (const canary of [
    "review-headline-canary",
    "review-notes-canary",
    "review-email-canary@example.test",
    "private-report-reason-canary",
    "second-review-headline-canary",
  ]) {
    assert.equal(privateState.includes(canary), false, canary);
  }
  for (const operations of database.committedTransactions) {
    const hasWrites = operations.some(
      (operation) => operation.type === "set" || operation.type === "delete",
    );
    if (hasWrites) assertReadsPrecedeWrites(operations);
  }
});

test("point reversal advances a bound cursor once and does not replay after completion", async () => {
  const database = new StrictInMemoryDatabase();
  let job = buildDishDeleteJob({phase: "reverse_contribution_points"});
  let item = buildInitialDishDeletionItem(job, {
    dishId: "dish-source",
    restaurantId: "restaurant-1",
    now: baseTime,
  });
  item = rebuildItem(item, {subphase: "reverse_contribution_points"});
  job = rebuildJob(job, {itemCursorId: item.itemId});
  database.seed(ratingDestructiveJobPath(job.jobId), job);
  database.seed(ratingDestructiveJobItemPath(item.itemId), item);
  database.seed(ratingDishOperationLockPath("dish-source"), activeDishLock(job));

  const calls = [];
  const cursor = pointCursor(job.jobId, "dish-source", "ledger-050");
  const external = {
    ...unexpectedExternal(),
    async reverseDishContributionPointsStep(value) {
      calls.push(clone(value));
      return calls.length === 1
        ? {processedCount: 50, nextCursor: cursor, complete: false}
        : {processedCount: 4, nextCursor: null, complete: true};
    },
  };
  const dependencies = {database, external};

  const first = await processDishDeletionItemStep(
    dependencies,
    job,
    item,
    nextTime,
  );
  assert.equal(first.processedDocuments, 50);
  assert.equal(first.item.subphase, "reverse_contribution_points");
  assert.deepEqual(first.item.pointReversalCursor, cursor);
  assert.equal(first.item.processedCount, 50);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cursor, null);

  const second = await processDishDeletionItemStep(
    dependencies,
    first.job,
    first.item,
    laterTime,
  );
  assert.equal(second.processedDocuments, 4);
  assert.equal(second.item.subphase, "delete_dish_reports");
  assert.equal(second.item.pointReversalCursor, null);
  assert.equal(second.item.processedCount, 54);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].cursor, cursor);

  await processDishDeletionItemStep(
    dependencies,
    second.job,
    second.item,
    new Date("2026-08-11T12:03:00.000Z"),
  );
  assert.equal(calls.length, 2);
});

test("point reversal compare-and-set discards a stale external result", async () => {
  const database = new StrictInMemoryDatabase();
  let job = buildDishDeleteJob({
    requestId: "request-point-cas",
    phase: "reverse_contribution_points",
  });
  let item = buildInitialDishDeletionItem(job, {
    dishId: "dish-source",
    restaurantId: "restaurant-1",
    now: baseTime,
  });
  item = rebuildItem(item, {
    subphase: "reverse_contribution_points",
    processedCount: 7,
  });
  job = rebuildJob(job, {itemCursorId: item.itemId});
  database.seed(ratingDestructiveJobPath(job.jobId), job);
  database.seed(ratingDestructiveJobItemPath(item.itemId), item);
  database.seed(ratingDishOperationLockPath("dish-source"), activeDishLock(job));

  const concurrent = rebuildItem(item, {
    subphase: "delete_dish_reports",
    updatedAt: nextTime,
  });
  const external = {
    ...unexpectedExternal(),
    async reverseDishContributionPointsStep() {
      database.replace(ratingDestructiveJobItemPath(item.itemId), concurrent);
      return {processedCount: 50, nextCursor: null, complete: true};
    },
  };
  const result = await processDishDeletionItemStep(
    {database, external},
    job,
    item,
    laterTime,
  );
  assert.equal(result.processedDocuments, 0);
  assert.equal(result.item.subphase, "delete_dish_reports");
  assert.equal(result.item.processedCount, 7);
  assert.deepEqual(database.data(ratingDestructiveJobItemPath(item.itemId)), concurrent);
});

test("point reversal fences manual jobs before and after the external step", async () => {
  function setup(requestId) {
    const database = new StrictInMemoryDatabase();
    let job = buildDishDeleteJob({
      requestId,
      phase: "reverse_contribution_points",
    });
    let item = buildInitialDishDeletionItem(job, {
      dishId: "dish-source",
      restaurantId: "restaurant-1",
      now: baseTime,
    });
    item = rebuildItem(item, {subphase: "reverse_contribution_points"});
    job = rebuildJob(job, {itemCursorId: item.itemId});
    database.seed(ratingDestructiveJobPath(job.jobId), job);
    database.seed(ratingDestructiveJobItemPath(item.itemId), item);
    database.seed(ratingDishOperationLockPath("dish-source"), activeDishLock(job));
    return {database, job, item};
  }

  {
    const {database, job, item} = setup("request-point-pre-fence");
    const manual = rebuildJob(job, {
      status: "manual_review_required",
      failureCode: "entity_state_incompatible",
      updatedAt: nextTime,
    });
    database.replace(ratingDestructiveJobPath(job.jobId), manual);
    let calls = 0;
    const external = {
      ...unexpectedExternal(),
      async reverseDishContributionPointsStep() {
        calls += 1;
        return {processedCount: 9, nextCursor: null, complete: true};
      },
    };
    const result = await processDishDeletionItemStep(
      {database, external},
      job,
      item,
      laterTime,
    );
    assert.equal(calls, 0);
    assert.equal(result.processedDocuments, 0);
    assert.deepEqual(result.job, manual);
    assert.deepEqual(
      database.data(ratingDestructiveJobItemPath(item.itemId)),
      item,
    );
  }

  {
    const {database, job, item} = setup("request-point-post-fence");
    const manual = rebuildJob(job, {
      status: "manual_review_required",
      failureCode: "entity_state_incompatible",
      updatedAt: nextTime,
    });
    let calls = 0;
    const external = {
      ...unexpectedExternal(),
      async reverseDishContributionPointsStep() {
        calls += 1;
        database.replace(ratingDestructiveJobPath(job.jobId), manual);
        return {processedCount: 9, nextCursor: null, complete: true};
      },
    };
    const result = await processDishDeletionItemStep(
      {database, external},
      job,
      item,
      laterTime,
    );
    assert.equal(calls, 1);
    assert.equal(result.processedDocuments, 0);
    assert.deepEqual(result.job, manual);
    assert.deepEqual(
      database.data(ratingDestructiveJobItemPath(item.itemId)),
      item,
    );
    assert.deepEqual(database.data(ratingDestructiveJobPath(job.jobId)), manual);
  }
});

function milestoneCursorBundle(jobId, itemId, userId, lockToken, scanId) {
  const accumulatorVersion = "bitestar.review-milestone-accumulator.v2";
  const userFingerprint = sha256([
    accumulatorVersion,
    ["userId", userId],
  ]);
  const operationFingerprint = sha256([
    "bitestar.review-milestone-operation.v1",
    ["operationId", jobId],
  ]);
  const lockFingerprint = sha256([
    "bitestar.review-milestone-lock-binding.v1",
    ["userId", userId],
    ["operationId", jobId],
    ["lockToken", lockToken],
  ]);
  const scanFingerprint = sha256([
    accumulatorVersion,
    ["namespaceId", itemId],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["scanId", scanId],
  ]);
  const resetVersion =
    "bitestar.review-milestone-accumulator-reset-cursor.v2";
  const reset = {
    version: resetVersion,
    phase: "accumulator-reset",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    scanFingerprint,
    afterWinnerDocumentId: "winner-050",
  };
  reset.fingerprint = sha256([
    resetVersion,
    ["phase", reset.phase],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["scanFingerprint", scanFingerprint],
    ["afterWinnerDocumentId", reset.afterWinnerDocumentId],
  ]);
  const reviewVersion = "bitestar.review-milestone-review-cursor.v3";
  const reviewCursor = {
    version: reviewVersion,
    phase: "review-scan",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    scanFingerprint,
    sequence: 1,
    afterReviewDocumentId: "review-100",
  };
  reviewCursor.fingerprint = sha256([
    reviewVersion,
    ["phase", reviewCursor.phase],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["scanFingerprint", scanFingerprint],
    ["sequence", reviewCursor.sequence],
    ["afterReviewDocumentId", reviewCursor.afterReviewDocumentId],
  ]);
  const reconcileVersion = "bitestar.review-milestone-reconcile-cursor.v2";
  const countStateFingerprint = sha256("count-state");
  const reconcile = {
    version: reconcileVersion,
    phase: "ledger",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    countStateFingerprint,
    afterLedgerDocumentId: "milestone-ledger-050",
  };
  reconcile.fingerprint = sha256([
    reconcileVersion,
    ["phase", reconcile.phase],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["countStateFingerprint", countStateFingerprint],
    ["afterLedgerDocumentId", reconcile.afterLedgerDocumentId],
  ]);
  return {reset, review: reviewCursor, reconcile};
}

function claimMilestoneItem(job, userId) {
  const itemId = createRatingDestructiveJobItemId({
    jobId: job.jobId,
    operation: job.operation,
    kind: "milestoneUser",
    restaurantId: null,
    dishId: null,
    userId,
  });
  return buildRatingDestructiveJobItemDocument({
    itemId,
    jobId: job.jobId,
    operation: job.operation,
    kind: "milestoneUser",
    status: "active",
    subphase: "claim_lock",
    restaurantId: null,
    dishId: null,
    userId,
    currentReviewId: null,
    cursorDocumentId: null,
    secondaryCursorDocumentId: null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
    pointReversalCursor: null,
    milestoneResetCursor: null,
    milestoneReviewCursor: null,
    milestoneReconcileCursor: null,
    milestoneLockToken: sha256(`lock-${userId}`),
    milestoneScanId: itemId,
    validReviewCount: null,
    processedCount: 0,
    failureCode: null,
    createdAt: baseTime,
    updatedAt: baseTime,
    completedAt: null,
  });
}

test("milestone processing fences manual jobs before and after external work", async () => {
  function setup(requestId) {
    const database = new StrictInMemoryDatabase();
    const job = buildDishDeleteJob({
      requestId,
      phase: "reconcile_milestone_users",
    });
    const item = claimMilestoneItem(job, `user-${requestId}`);
    database.seed(ratingDestructiveJobPath(job.jobId), job);
    database.seed(ratingDestructiveJobItemPath(item.itemId), item);
    return {database, job, item};
  }

  {
    const {database, job, item} = setup("milestone-pre-fence");
    const manual = rebuildJob(job, {
      status: "manual_review_required",
      failureCode: "entity_state_incompatible",
      updatedAt: nextTime,
    });
    database.replace(ratingDestructiveJobPath(job.jobId), manual);
    let calls = 0;
    const external = {
      ...unexpectedExternal(),
      async claimMilestoneUser() {
        calls += 1;
        return {status: "acquired"};
      },
    };
    const result = await processMilestoneUserItemStep(
      {database, external},
      job,
      item,
      laterTime,
    );
    assert.equal(calls, 0);
    assert.equal(result.processedDocuments, 0);
    assert.deepEqual(result.job, manual);
    assert.deepEqual(
      database.data(ratingDestructiveJobItemPath(item.itemId)),
      item,
    );
  }

  {
    const {database, job, item} = setup("milestone-post-fence");
    const manual = rebuildJob(job, {
      status: "manual_review_required",
      failureCode: "entity_state_incompatible",
      updatedAt: nextTime,
    });
    let calls = 0;
    const external = {
      ...unexpectedExternal(),
      async claimMilestoneUser() {
        calls += 1;
        database.replace(ratingDestructiveJobPath(job.jobId), manual);
        return {status: "acquired"};
      },
    };
    const result = await processMilestoneUserItemStep(
      {database, external},
      job,
      item,
      laterTime,
    );
    assert.equal(calls, 1);
    assert.equal(result.processedDocuments, 0);
    assert.deepEqual(result.job, manual);
    assert.deepEqual(
      database.data(ratingDestructiveJobItemPath(item.itemId)),
      item,
    );
  }
});

test("milestone release terminalizes once and clears every private cursor binding", async () => {
  const database = new StrictInMemoryDatabase();
  const job = buildDishDeleteJob({requestId: "request-milestone-terminal"});
  const userId = "user-milestone";
  const itemId = createRatingDestructiveJobItemId({
    jobId: job.jobId,
    operation: "dishDelete",
    kind: "milestoneUser",
    restaurantId: null,
    dishId: null,
    userId,
  });
  const lockToken = sha256("milestone-lock-token");
  const cursors = milestoneCursorBundle(
    job.jobId,
    itemId,
    userId,
    lockToken,
    itemId,
  );
  const item = buildRatingDestructiveJobItemDocument({
    itemId,
    jobId: job.jobId,
    operation: "dishDelete",
    kind: "milestoneUser",
    status: "active",
    subphase: "release_lock",
    restaurantId: null,
    dishId: null,
    userId,
    currentReviewId: null,
    cursorDocumentId: null,
    secondaryCursorDocumentId: null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
    pointReversalCursor: null,
    milestoneResetCursor: null,
    milestoneReviewCursor: null,
    milestoneReconcileCursor: null,
    milestoneLockToken: lockToken,
    milestoneScanId: itemId,
    validReviewCount: 11,
    processedCount: 201,
    failureCode: null,
    createdAt: baseTime,
    updatedAt: nextTime,
    completedAt: null,
  });
  database.seed(ratingDestructiveJobPath(job.jobId), job);
  database.seed(ratingDestructiveJobItemPath(item.itemId), item);
  const releases = [];
  const external = {
    ...unexpectedExternal(),
    async releaseMilestoneUser(identity, now) {
      releases.push({identity: clone(identity), now: clone(now)});
      return {status: "released"};
    },
  };

  const result = await processMilestoneUserItemStep(
    {database, external},
    job,
    item,
    laterTime,
  );
  assert.equal(releases.length, 1);
  assert.equal(result.item.status, "complete");
  assert.equal(result.item.subphase, "complete");
  assert.equal(result.item.completedAt.getTime(), laterTime.getTime());
  for (const field of [
    "milestoneResetCursor",
    "milestoneReviewCursor",
    "milestoneReconcileCursor",
    "milestoneLockToken",
    "milestoneScanId",
  ]) {
    assert.equal(result.item[field], null, field);
  }
  const replay = await processMilestoneUserItemStep(
    {database, external},
    result.job,
    result.item,
    new Date("2026-08-11T12:03:00.000Z"),
  );
  assert.equal(replay.item.status, "complete");
  assert.equal(releases.length, 1);
});

test("manual-status processing is a controlled no-op", async () => {
  const database = new StrictInMemoryDatabase();
  const canary = "request-private-email-canary@example.test";
  const job = buildDishDeleteJob({
    requestId: canary,
    status: "manual_review_required",
    failureCode: "entity_state_incompatible",
  });
  database.seed(ratingDestructiveJobPath(job.jobId), job);
  const result = await processStandaloneDishDeleteStep(
    {database, external: unexpectedExternal()},
    job,
    nextTime,
  );
  assert.equal(result.processedDocuments, 0);
  assert.deepEqual(result.job, job);
  assert.deepEqual(database.data(ratingDestructiveJobPath(job.jobId)), job);
  assert.equal(JSON.stringify(result).includes(canary), true);
  assert.equal(database.committedTransactions.flat().some(
    (operation) => operation.type === "set" || operation.type === "delete",
  ), false);
});
