"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDishMergeReviewLockDocument,
  claimDishProposalGroupForApply,
  claimDishProposalGroupForReject,
  dishMergeAggregateCanBeAdvancedAfterSafeAbort,
  dishMergeAggregateIsReady,
  dishMergeReviewLocksBelongToJob,
  nextDishAggregateWriteGenerations,
  parseDishMergeReviewLockDocument,
  processDishProposalJobStep,
  readEffectiveDishAggregateWriteGeneration,
} = require("../lib/dish_proposal_resolution_jobs.js");
const {
  maintainDishEditProposalPrivateState,
} = require("../lib/dish_proposal_private_maintenance.js");
const {
  createDishProposalMemberId,
  dishMergeReviewLockCollection,
  dishMergeReviewLockPath,
  dishMergeReviewLockVersion,
  dishProposalAggregateScanBatchSize,
  dishProposalFinalizationBatchSize,
  dishProposalGroupPath,
  dishProposalJobPath,
  dishProposalMemberCollection,
  dishProposalReviewMigrationBatchSize,
  dishProposalSupporterCollection,
} = require("../lib/dish_proposal_private_contract.js");
const {
  dishReviewAggregateWinnerCollectionPath,
} = require("../lib/dish_review_aggregate_accumulator.js");

const baseTime = new Date("2026-08-10T12:00:00.000Z");
const canaries = Object.freeze([
  "proposal-reason-canary",
  "private-email-canary@example.com",
  "+1-555-phone-canary",
  "review-text-canary",
  "auth-token-canary",
  "stripe-secret-canary",
  "nested-private-map-canary",
]);

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
  const actual = fieldValue(document, condition.field);
  const comparison = compareValues(actual, condition.value);
  switch (condition.operator) {
    case "==":
      return comparison === 0;
    case "<=":
      return comparison <= 0;
    case ">=":
      return comparison >= 0;
    case "<":
      return comparison < 0;
    case ">":
      return comparison > 0;
    default:
      throw new Error(`Unsupported query operator: ${condition.operator}`);
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

class InMemoryDishProposalDatabase {
  constructor() {
    this.records = new Map();
    this.transactionTail = Promise.resolve();
    this.attemptedQueries = [];
    this.committedOperations = [];
    this.committedTransactions = [];
    this.setFailure = null;
  }

  seed(documentPath, data, createTime = baseTime) {
    this.records.set(documentPath, {
      data: clone(data),
      createTime: createTime === null ? null : new Date(createTime.getTime()),
    });
  }

  patch(documentPath, data) {
    const current = this.records.get(documentPath);
    assert.ok(current, `Cannot patch missing document ${documentPath}`);
    this.records.set(documentPath, {
      data: {...clone(current.data), ...clone(data)},
      createTime: current.createTime,
    });
  }

  remove(documentPath) {
    this.records.delete(documentPath);
  }

  data(documentPath) {
    return clone(this.records.get(documentPath)?.data);
  }

  has(documentPath) {
    return this.records.has(documentPath);
  }

  documentsIn(collectionPath) {
    const prefix = `${collectionPath}/`;
    const segmentCount = collectionPath.split("/").length + 1;
    return [...this.records.entries()]
      .filter(([documentPath]) =>
        documentPath.startsWith(prefix) &&
        documentPath.split("/").length === segmentCount
      )
      .map(([documentPath, stored]) => ({
        id: documentPath.slice(prefix.length),
        path: documentPath,
        data: clone(stored.data),
        createTime: stored.createTime === null
          ? null
          : new Date(stored.createTime.getTime()),
      }));
  }

  injectSetFailureOnce(predicate, message = "injected-set-failure") {
    assert.equal(this.setFailure, null, "Only one set failure may be armed.");
    this.setFailure = {predicate, message};
  }

  committedSetCount(documentPath) {
    return this.committedOperations.filter(
      (operation) => operation.type === "set" && operation.path === documentPath,
    ).length;
  }

  async runTransaction(operation) {
    const run = this.transactionTail.then(async () => {
      const working = new Map(
        [...this.records.entries()].map(([documentPath, stored]) => [
          documentPath,
          clone(stored),
        ]),
      );
      const transaction = new InMemoryDishProposalTransaction(this, working);
      const result = await operation(transaction);
      this.records = working;
      this.committedOperations.push(...transaction.operations);
      this.committedTransactions.push(clone(transaction.operations));
      return result;
    });
    this.transactionTail = run.catch(() => undefined);
    return run;
  }

  clientPatchReview(documentPath, data) {
    const current = this.data(documentPath);
    if (current === undefined) throw new Error("missing-client-review");
    const requested = {...current, ...clone(data)};
    for (const dishId of [current.dishId, requested.dishId]) {
      const lock = typeof dishId === "string"
        ? this.data(dishMergeReviewLockPath(dishId))
        : null;
      if (lock?.blocksClientReviews === true) {
        throw new Error("client-review-blocked-by-merge-lock");
      }
    }
    this.patch(documentPath, data);
  }

  clientSetAggregate(documentPath, data) {
    const current = this.data(documentPath);
    const pathDishId = documentPath.slice(documentPath.lastIndexOf("/") + 1);
    for (const dishId of [pathDishId, current?.dishId, data.dishId]) {
      const lock = typeof dishId === "string"
        ? this.data(dishMergeReviewLockPath(dishId))
        : null;
      if (lock?.blocksClientAggregates === true) {
        throw new Error("client-aggregate-blocked-by-merge-lock");
      }
    }
    const dish = this.data(`bitescore_dishes/${pathDishId}`);
    const dishGeneration = dish?.aggregateWriteGeneration ?? 0;
    const requestGeneration = data.aggregateWriteGeneration ?? 0;
    if (
      !Number.isSafeInteger(dishGeneration) ||
      dishGeneration < 0 ||
      !Number.isSafeInteger(requestGeneration) ||
      requestGeneration < 0 ||
      requestGeneration !== dishGeneration
    ) {
      throw new Error("client-aggregate-generation-mismatch");
    }
    if (current === undefined) {
      this.seed(documentPath, data);
    } else {
      this.patch(documentPath, data);
    }
  }
}

class InMemoryDishProposalTransaction {
  constructor(database, working) {
    this.database = database;
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
    assert.ok(Number.isInteger(query.limit) && query.limit > 0);
    this.database.attemptedQueries.push(clone(query));
    this.operations.push({type: "query", query: clone(query)});
    const prefix = `${query.collectionPath}/`;
    const segmentCount = query.collectionPath.split("/").length + 1;
    return [...this.working.entries()]
      .filter(([documentPath]) =>
        documentPath.startsWith(prefix) &&
        documentPath.split("/").length === segmentCount
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

  setDocument(documentPath, data, options = undefined) {
    this.operations.push({
      type: "set",
      path: documentPath,
      data: clone(data),
      options: clone(options),
    });
    const failure = this.database.setFailure;
    if (failure !== null && failure.predicate(
      documentPath,
      data,
      options,
      this.operations,
    )) {
      this.database.setFailure = null;
      throw new Error(failure.message);
    }
    const existing = this.working.get(documentPath);
    const nextData = options?.merge === true && existing !== undefined
      ? {...clone(existing.data), ...clone(data)}
      : clone(data);
    this.working.set(documentPath, {
      data: nextData,
      createTime: existing?.createTime ?? baseTime,
    });
  }

  deleteDocument(documentPath) {
    this.operations.push({type: "delete", path: documentPath});
    this.working.delete(documentPath);
  }
}

class IdempotentPointLedger {
  constructor() {
    this.ledger = new Map();
    this.points = 0;
    this.attempts = [];
    this.failAfterCommitOnce = false;
  }

  async award(request) {
    this.attempts.push(clone(request));
    const wasCreated = !this.ledger.has(request.proposalDocumentId);
    if (wasCreated) {
      this.ledger.set(request.proposalDocumentId, clone(request));
      this.points += 1;
    }
    if (this.failAfterCommitOnce) {
      this.failAfterCommitOnce = false;
      throw new Error("injected-after-point-ledger-commit");
    }
    return {
      outcome: wasCreated ? "awarded" : "alreadyAwarded",
      result: {
        entries: [{
          ledgerEntryId: request.proposalDocumentId,
          points: 1,
          wasCreated,
        }],
      },
    };
  }
}

function dependencies(database, pointLedger = new IdempotentPointLedger()) {
  return {
    database,
    awardApprovedProposalPoints: (request) => pointLedger.award(request),
  };
}

function copyDatabase(database) {
  const copy = new InMemoryDishProposalDatabase();
  for (const [documentPath, stored] of database.records.entries()) {
    copy.seed(documentPath, stored.data, stored.createTime);
  }
  return copy;
}

function proposalData({
  type,
  restaurantId = "restaurant-1",
  sourceDishId,
  mergeTargetDishId,
  proposedName,
  supporterUid,
  status = "pending",
  includeCanaries = false,
}) {
  return {
    type,
    restaurantId,
    sourceDishId,
    ...(mergeTargetDishId === undefined ? {} : {mergeTargetDishId}),
    ...(proposedName === undefined ? {} : {proposedName}),
    userId: supporterUid,
    status,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...(includeCanaries
      ? {
          reason: canaries[0],
          email: canaries[1],
          phone: canaries[2],
          authToken: canaries[4],
          stripeSecret: canaries[5],
          arbitraryNestedMap: {value: canaries[6]},
        }
      : {}),
  };
}

async function addProposal(database, value) {
  const createTime = value.createTime ?? baseTime;
  database.seed(
    `dish_edit_proposals/${value.id}`,
    proposalData(value),
    createTime,
  );
  return maintainDishEditProposalPrivateState(
    database,
    value.id,
    value.maintainedAt ?? createTime,
  );
}

async function createProposalGroup(database, {
  count,
  prefix,
  type,
  sourceDishId,
  mergeTargetDishId,
  proposedName,
  includeCanaries = false,
}) {
  let groupId = null;
  const proposalIds = [];
  for (let index = 0; index < count; index += 1) {
    const id = `${prefix}-${String(index).padStart(3, "0")}`;
    proposalIds.push(id);
    const result = await addProposal(database, {
      id,
      type,
      sourceDishId,
      mergeTargetDishId,
      proposedName,
      supporterUid: `${prefix}-supporter-${String(index).padStart(3, "0")}`,
      includeCanaries,
      createTime: new Date(baseTime.getTime() + index),
      maintainedAt: new Date(baseTime.getTime() + 1_000 + index),
    });
    groupId ??= result.currentGroupId;
    assert.equal(result.currentGroupId, groupId);
  }
  assert.notEqual(groupId, null);
  return {groupId, proposalIds};
}

function seedDish(database, dishId, overrides = {}) {
  database.seed(`bitescore_dishes/${dishId}`, {
    id: dishId,
    restaurantId: "restaurant-1",
    restaurantName: "Fixture Restaurant",
    name: `Dish ${dishId}`,
    normalizedName: `dish ${dishId}`.toLowerCase(),
    isActive: true,
    ...overrides,
  });
}

function reviewData({id, dishId, userId, score, updatedOffset = 0}) {
  const impression = score / 10;
  return {
    id,
    dishId,
    restaurantId: "restaurant-1",
    userId,
    overallImpression: impression,
    tastinessScore: indexOrNull(score, 2),
    qualityScore: indexOrNull(score, 3),
    valueScore: indexOrNull(score, 5),
    overallBiteScore: score,
    headline: canaries[3],
    notes: canaries[3],
    arbitraryNestedMap: {value: canaries[6]},
    createdAt: new Date(baseTime.getTime() + updatedOffset),
    updatedAt: new Date(baseTime.getTime() + updatedOffset),
  };
}

function indexOrNull(score, divisor) {
  return score % divisor === 0 ? null : score / 10;
}

function seedReviews(database, {
  count,
  prefix,
  dishId,
  userPrefix = prefix,
  startingScore = 50,
}) {
  const reviewPaths = [];
  for (let index = 0; index < count; index += 1) {
    const id = `${prefix}-${String(index).padStart(3, "0")}`;
    const documentPath = `dish_reviews/${id}`;
    reviewPaths.push(documentPath);
    database.seed(documentPath, reviewData({
      id,
      dishId,
      userId: `${userPrefix}-user-${String(index).padStart(3, "0")}`,
      score: startingScore + (index % 41),
      updatedOffset: index,
    }));
  }
  return reviewPaths;
}

function legacyAggregate(documents, dishId, restaurantId) {
  const winners = new Map();
  for (const document of documents) {
    const review = document.data;
    if (review.dishId !== dishId || typeof review.userId !== "string") continue;
    const normalizedUserId = review.userId.trim();
    if (normalizedUserId.length === 0) continue;
    const freshness = review.updatedAt instanceof Date
      ? review.updatedAt.getTime()
      : review.createdAt instanceof Date
      ? review.createdAt.getTime()
      : 0;
    const current = winners.get(normalizedUserId);
    if (
      current === undefined ||
      freshness > current.freshness ||
      (freshness === current.freshness && document.id > current.document.id)
    ) {
      winners.set(normalizedUserId, {review, document, freshness});
    }
  }
  const reviews = [...winners.values()].map((entry) => entry.review);
  if (reviews.length === 0) {
    return {
      dishId,
      restaurantId,
      overallBiteScore: 0,
      ratingCount: 0,
      overallImpressionAverage: null,
      tastinessScoreAverage: null,
      qualityScoreAverage: null,
      valueScoreAverage: null,
    };
  }
  const average = (field) => {
    const values = reviews
      .map((review) => review[field])
      .filter((value) => typeof value === "number");
    return values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  return {
    dishId,
    restaurantId,
    overallBiteScore: average("overallBiteScore"),
    ratingCount: reviews.length,
    overallImpressionAverage: average("overallImpression"),
    tastinessScoreAverage: average("tastinessScore"),
    qualityScoreAverage: average("qualityScore"),
    valueScoreAverage: average("valueScore"),
  };
}

function aggregateFromMaterializedWinners(
  winnerDocuments,
  dishId,
  restaurantId,
) {
  const winners = [...winnerDocuments]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((document) => document.data);
  if (winners.length === 0) {
    return {
      dishId,
      restaurantId,
      overallBiteScore: 0,
      ratingCount: 0,
      overallImpressionAverage: null,
      tastinessScoreAverage: null,
      qualityScoreAverage: null,
      valueScoreAverage: null,
    };
  }
  let overallBiteScoreSum = 0;
  let overallImpressionSum = 0;
  let tastinessScoreSum = 0;
  let tastinessScoreCount = 0;
  let qualityScoreSum = 0;
  let qualityScoreCount = 0;
  let valueScoreSum = 0;
  let valueScoreCount = 0;
  for (const winner of winners) {
    overallBiteScoreSum += winner.overallBiteScore;
    overallImpressionSum += winner.overallImpression;
    if (winner.tastinessScore !== null) {
      tastinessScoreSum += winner.tastinessScore;
      tastinessScoreCount += 1;
    }
    if (winner.qualityScore !== null) {
      qualityScoreSum += winner.qualityScore;
      qualityScoreCount += 1;
    }
    if (winner.valueScore !== null) {
      valueScoreSum += winner.valueScore;
      valueScoreCount += 1;
    }
  }
  return {
    dishId,
    restaurantId,
    overallBiteScore: overallBiteScoreSum / winners.length,
    ratingCount: winners.length,
    overallImpressionAverage: overallImpressionSum / winners.length,
    tastinessScoreAverage: tastinessScoreCount === 0
      ? null
      : tastinessScoreSum / tastinessScoreCount,
    qualityScoreAverage: qualityScoreCount === 0
      ? null
      : qualityScoreSum / qualityScoreCount,
    valueScoreAverage: valueScoreCount === 0
      ? null
      : valueScoreSum / valueScoreCount,
  };
}

function assertAggregatesNumericallyEquivalent(actual, expected) {
  assert.equal(actual.dishId, expected.dishId);
  assert.equal(actual.restaurantId, expected.restaurantId);
  assert.equal(actual.ratingCount, expected.ratingCount);
  for (const field of [
    "overallBiteScore",
    "overallImpressionAverage",
    "tastinessScoreAverage",
    "qualityScoreAverage",
    "valueScoreAverage",
  ]) {
    if (expected[field] === null) {
      assert.equal(actual[field], null, field);
    } else {
      assert.ok(
        Math.abs(actual[field] - expected[field]) <= Number.EPSILON * 32,
        `${field}: ${actual[field]} != ${expected[field]}`,
      );
    }
  }
}

function withoutUpdatedAt(document) {
  const {
    updatedAt: _updatedAt,
    aggregateWriteGeneration: _aggregateWriteGeneration,
    ...rest
  } = document;
  return rest;
}

function jobData(database, jobId) {
  const job = database.data(dishProposalJobPath(jobId));
  assert.ok(job, `Missing job ${jobId}`);
  return job;
}

async function runUntilTerminal(
  resolutionDependencies,
  jobId,
  {maximumSteps = 1_000, now = baseTime} = {},
) {
  const results = [];
  for (let step = 0; step < maximumSteps; step += 1) {
    const result = await processDishProposalJobStep(
      resolutionDependencies,
      jobId,
      new Date(now.getTime() + step + 1),
    );
    results.push(result);
    if (result.status === "complete" || result.status === "manual_review_required") {
      return results;
    }
  }
  throw new Error(`Job ${jobId} did not reach a terminal state.`);
}

function assertNoCanaries(value, label) {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) {
    assert.equal(
      serialized.includes(canary),
      false,
      `${label} leaked ${canary}`,
    );
  }
}

function privateStateSnapshot(database) {
  const collectionPrefixes = [
    dishProposalMemberCollection,
    dishProposalSupporterCollection,
    "private_dish_edit_proposal_groups",
    "private_dish_edit_application_jobs",
    dishMergeReviewLockCollection,
  ];
  return [...database.records.entries()]
    .filter(([documentPath]) => collectionPrefixes.some(
      (collectionPath) =>
        documentPath === collectionPath ||
        documentPath.startsWith(`${collectionPath}/`),
    ))
    .map(([path, stored]) => ({path, data: clone(stored.data)}));
}

test("resolution claims serialize Apply/Reject races with exactly one winner", async () => {
  const scenarios = [
    ["apply", "apply"],
    ["apply", "reject"],
    ["reject", "apply"],
  ];

  for (const [firstResolution, secondResolution] of scenarios) {
    const database = new InMemoryDishProposalDatabase();
    const prefix = `race-${firstResolution}-${secondResolution}`;
    const sourceDishId = `${prefix}-source`;
    const targetDishId = `${prefix}-target`;
    const {groupId} = await createProposalGroup(database, {
      count: 2,
      prefix,
      type: "merge",
      sourceDishId,
      mergeTargetDishId: targetDishId,
    });
    seedDish(database, sourceDishId);
    seedDish(database, targetDishId);
    const claim = (resolution, offset) => resolution === "apply"
      ? claimDishProposalGroupForApply(
          database,
          groupId,
          new Date(baseTime.getTime() + offset),
        )
      : claimDishProposalGroupForReject(
          database,
          groupId,
          new Date(baseTime.getTime() + offset),
        );

    const results = await Promise.all([
      claim(firstResolution, 10_000),
      claim(secondResolution, 10_001),
    ]);
    const winners = results.filter((result) => result.claimed);
    const losers = results.filter((result) => !result.claimed);
    assert.equal(winners.length, 1, `${firstResolution} vs ${secondResolution}`);
    assert.equal(losers.length, 1, `${firstResolution} vs ${secondResolution}`);
    assert.equal(losers[0].reason, "already-active");
    assert.equal(losers[0].jobId, winners[0].jobId);

    const job = jobData(database, winners[0].jobId);
    const group = database.data(dishProposalGroupPath(groupId));
    assert.equal(group.activeJobId, job.jobId);
    assert.equal(group.activeResolutionType, firstResolution);
    assert.equal(job.resolutionType, firstResolution);
    if (firstResolution === "apply") {
      const sourceLock = database.data(dishMergeReviewLockPath(sourceDishId));
      const targetLock = database.data(dishMergeReviewLockPath(targetDishId));
      assert.equal(sourceLock.jobId, job.jobId);
      assert.equal(targetLock.jobId, job.jobId);
      assert.equal(sourceLock.role, "source");
      assert.equal(targetLock.role, "target");
    } else {
      assert.equal(database.has(dishMergeReviewLockPath(sourceDishId)), false);
      assert.equal(database.has(dishMergeReviewLockPath(targetDishId)), false);
    }
  }
});

test("shared merge lock and generation exports preserve committed invariants", () => {
  assert.equal(readEffectiveDishAggregateWriteGeneration({}), 0);
  assert.equal(
    readEffectiveDishAggregateWriteGeneration({aggregateWriteGeneration: 4}),
    4,
  );
  assert.deepEqual(nextDishAggregateWriteGenerations(4), {
    active: 5,
    completion: 6,
  });
  assert.throws(
    () => nextDishAggregateWriteGenerations(Number.MAX_SAFE_INTEGER),
    /exhausted/u,
  );

  const job = {
    jobId: "shared-direct-job",
    groupId: "shared-direct-job",
    sourceDishId: "shared-source",
    mergeTargetDishId: "shared-target",
    sourceActiveAggregateWriteGeneration: 5,
    sourceCompletionAggregateWriteGeneration: 6,
    targetActiveAggregateWriteGeneration: 9,
    targetCompletionAggregateWriteGeneration: 10,
  };
  const sourceLock = buildDishMergeReviewLockDocument({
    version: dishMergeReviewLockVersion,
    dishId: job.sourceDishId,
    jobId: job.jobId,
    groupId: job.groupId,
    role: "source",
    state: "active",
    blocksClientReviews: true,
    blocksClientAggregates: true,
    activeAggregateWriteGeneration:
      job.sourceActiveAggregateWriteGeneration,
    completionAggregateWriteGeneration:
      job.sourceCompletionAggregateWriteGeneration,
    targetDishId: job.mergeTargetDishId,
    createdAt: baseTime,
    indexedAt: baseTime,
  });
  const targetLock = buildDishMergeReviewLockDocument({
    version: dishMergeReviewLockVersion,
    dishId: job.mergeTargetDishId,
    jobId: job.jobId,
    groupId: job.groupId,
    role: "target",
    state: "active",
    blocksClientReviews: true,
    blocksClientAggregates: true,
    activeAggregateWriteGeneration:
      job.targetActiveAggregateWriteGeneration,
    completionAggregateWriteGeneration:
      job.targetCompletionAggregateWriteGeneration,
    targetDishId: null,
    createdAt: baseTime,
    indexedAt: baseTime,
  });
  const parsedSourceLock = parseDishMergeReviewLockDocument({
    id: job.sourceDishId,
    data: sourceLock,
    createTime: baseTime,
  });
  const parsedTargetLock = parseDishMergeReviewLockDocument({
    id: job.mergeTargetDishId,
    data: targetLock,
    createTime: baseTime,
  });
  assert.deepEqual(parsedSourceLock, sourceLock);
  assert.deepEqual(parsedTargetLock, targetLock);
  assert.equal(
    dishMergeReviewLocksBelongToJob(
      job,
      parsedSourceLock,
      parsedTargetLock,
    ),
    true,
  );
  assert.equal(
    dishMergeAggregateIsReady(
      {
        id: job.mergeTargetDishId,
        data: {
          dishId: job.mergeTargetDishId,
          restaurantId: "restaurant-1",
          aggregateWriteGeneration:
            job.targetActiveAggregateWriteGeneration,
          ratingCount: 0,
          overallBiteScore: 0,
        },
        createTime: baseTime,
      },
      job.mergeTargetDishId,
      "restaurant-1",
      job.targetActiveAggregateWriteGeneration,
    ),
    true,
  );
  assert.equal(
    dishMergeAggregateCanBeAdvancedAfterSafeAbort(
      null,
      job.sourceDishId,
      "restaurant-1",
      job.sourceActiveAggregateWriteGeneration,
    ),
    true,
  );
});

test("new proposal claims fail closed on destructive restaurant and dish locks", async () => {
  const cases = [
    {
      name: "restaurant",
      claim: claimDishProposalGroupForApply,
      path: ({restaurantId}) =>
        `private_rating_restaurant_operation_locks/${restaurantId}`,
      lock: {
        version: "bitestar.rating-restaurant-operation-lock.v1",
        state: "active",
      },
    },
    {
      name: "source-dish",
      claim: claimDishProposalGroupForReject,
      path: ({sourceDishId}) =>
        `private_rating_dish_operation_locks/${sourceDishId}`,
      lock: {
        version: "bitestar.rating-dish-operation-lock.v1",
        state: "active",
      },
    },
    {
      name: "target-dish",
      claim: claimDishProposalGroupForApply,
      path: ({targetDishId}) =>
        `private_rating_dish_operation_locks/${targetDishId}`,
      lock: {
        version: "bitestar.rating-dish-operation-lock.v1",
        state: "merged_source",
      },
    },
    {
      name: "malformed-present",
      claim: claimDishProposalGroupForApply,
      path: ({sourceDishId}) =>
        `private_rating_dish_operation_locks/${sourceDishId}`,
      lock: {unexpected: "private state"},
    },
  ];

  for (const testCase of cases) {
    const database = new InMemoryDishProposalDatabase();
    const sourceDishId = `destructive-${testCase.name}-source`;
    const targetDishId = `destructive-${testCase.name}-target`;
    const created = await createProposalGroup(database, {
      count: 2,
      prefix: `destructive-${testCase.name}`,
      type: "merge",
      sourceDishId,
      mergeTargetDishId: targetDishId,
    });
    seedDish(database, sourceDishId);
    seedDish(database, targetDishId);
    database.seed(testCase.path({
      restaurantId: "restaurant-1",
      sourceDishId,
      targetDishId,
    }), testCase.lock);
    const committedMutationCount = database.committedOperations.filter(
      (operation) => operation.type === "set" || operation.type === "delete",
    ).length;

    const result = await testCase.claim(
      database,
      created.groupId,
      new Date(baseTime.getTime() + 19_000),
    );

    assert.deepEqual(result, {
      claimed: false,
      jobId: null,
      reason: "dish-locked",
    }, testCase.name);
    assert.equal(
      database.committedOperations.filter(
        (operation) => operation.type === "set" || operation.type === "delete",
      ).length,
      committedMutationCount,
      testCase.name,
    );
    assert.equal(
      database.documentsIn("private_dish_edit_application_jobs").length,
      0,
      testCase.name,
    );
    assert.equal(
      database.documentsIn(dishMergeReviewLockCollection).length,
      0,
      testCase.name,
    );
    assert.equal(
      database.data(dishProposalGroupPath(created.groupId)).activeJobId,
      null,
      testCase.name,
    );
    assert.equal(
      database.data(`bitescore_dishes/${sourceDishId}`)
        .aggregateWriteGeneration,
      undefined,
      testCase.name,
    );
    assert.equal(
      database.data(`bitescore_dishes/${targetDishId}`)
        .aggregateWriteGeneration,
      undefined,
      testCase.name,
    );
  }
});

test("an already-active proposal job ignores a later destructive lock", async () => {
  const database = new InMemoryDishProposalDatabase();
  const sourceDishId = "active-before-destructive-source";
  const targetDishId = "active-before-destructive-target";
  const created = await createProposalGroup(database, {
    count: 2,
    prefix: "active-before-destructive",
    type: "merge",
    sourceDishId,
    mergeTargetDishId: targetDishId,
  });
  seedDish(database, sourceDishId);
  seedDish(database, targetDishId);
  const claim = await claimDishProposalGroupForApply(
    database,
    created.groupId,
    new Date(baseTime.getTime() + 19_100),
  );
  assert.equal(claim.claimed, true);
  database.seed(
    "private_rating_restaurant_operation_locks/restaurant-1",
    {unexpected: "present after claim"},
  );

  const repeatClaim = await claimDishProposalGroupForReject(
    database,
    created.groupId,
    new Date(baseTime.getTime() + 19_101),
  );
  assert.deepEqual(repeatClaim, {
    claimed: false,
    jobId: claim.jobId,
    reason: "already-active",
  });
  const result = await processDishProposalJobStep(
    dependencies(database),
    claim.jobId,
    new Date(baseTime.getTime() + 19_102),
  );
  assert.equal(result.status, "active");
  assert.equal(result.phase, "move_reviews");
});

test("merge locks are atomic, cannot be stolen, and release only for safe pre-mutation invalidity", async () => {
  const database = new InMemoryDishProposalDatabase();
  const sharedTarget = "lock-shared-target";
  const first = await createProposalGroup(database, {
    count: 2,
    prefix: "lock-first",
    type: "merge",
    sourceDishId: "lock-source-a",
    mergeTargetDishId: sharedTarget,
  });
  const second = await createProposalGroup(database, {
    count: 2,
    prefix: "lock-second",
    type: "merge",
    sourceDishId: "lock-source-b",
    mergeTargetDishId: sharedTarget,
  });
  seedDish(database, "lock-source-a");
  seedDish(database, "lock-source-b");
  seedDish(database, sharedTarget);

  const claimed = await claimDishProposalGroupForApply(
    database,
    first.groupId,
    new Date(baseTime.getTime() + 20_000),
  );
  assert.equal(claimed.claimed, true);
  assert.equal(database.has(dishProposalJobPath(claimed.jobId)), true);
  assert.equal(database.has(dishMergeReviewLockPath("lock-source-a")), true);
  assert.equal(database.has(dishMergeReviewLockPath(sharedTarget)), true);

  const blocked = await claimDishProposalGroupForApply(
    database,
    second.groupId,
    new Date(baseTime.getTime() + 20_001),
  );
  assert.deepEqual(blocked, {
    claimed: false,
    jobId: null,
    reason: "dish-locked",
  });
  assert.equal(database.has(dishMergeReviewLockPath("lock-source-b")), false);
  assert.equal(database.data(dishProposalGroupPath(second.groupId)).activeJobId, null);

  const incompatibleDatabase = new InMemoryDishProposalDatabase();
  const incompatible = await createProposalGroup(incompatibleDatabase, {
    count: 2,
    prefix: "incompatible",
    type: "merge",
    sourceDishId: "incompatible-source",
    mergeTargetDishId: "incompatible-target",
  });
  seedDish(incompatibleDatabase, "incompatible-source");
  seedDish(incompatibleDatabase, "incompatible-target", {
    restaurantId: "another-restaurant",
  });
  const incompatibleClaim = await claimDishProposalGroupForApply(
    incompatibleDatabase,
    incompatible.groupId,
    new Date(baseTime.getTime() + 21_000),
  );
  assert.equal(incompatibleClaim.claimed, true);
  assert.equal(
    jobData(incompatibleDatabase, incompatibleClaim.jobId).status,
    "manual_review_required",
  );
  assert.equal(
    incompatibleDatabase.has(dishMergeReviewLockPath("incompatible-source")),
    false,
  );
  assert.equal(
    incompatibleDatabase.has(dishMergeReviewLockPath("incompatible-source")),
    false,
  );
  assert.equal(
    incompatibleDatabase.has(dishMergeReviewLockPath("incompatible-target")),
    false,
  );

  const abortDatabase = new InMemoryDishProposalDatabase();
  const abort = await createProposalGroup(abortDatabase, {
    count: 2,
    prefix: "safe-abort",
    type: "merge",
    sourceDishId: "safe-abort-source",
    mergeTargetDishId: "safe-abort-target",
  });
  seedDish(abortDatabase, "safe-abort-source", {
    aggregateWriteGeneration: 4,
  });
  seedDish(abortDatabase, "safe-abort-target", {
    aggregateWriteGeneration: 8,
  });
  abortDatabase.seed("dish_rating_aggregates/safe-abort-source", {
    dishId: "safe-abort-source",
    restaurantId: "restaurant-1",
    ratingCount: 0,
    aggregateWriteGeneration: 4,
  });
  abortDatabase.seed("dish_rating_aggregates/safe-abort-target", {
    dishId: "safe-abort-target",
    restaurantId: "restaurant-1",
    ratingCount: 0,
    aggregateWriteGeneration: 8,
  });
  const abortClaim = await claimDishProposalGroupForApply(
    abortDatabase,
    abort.groupId,
    new Date(baseTime.getTime() + 21_100),
  );
  const abortJob = jobData(abortDatabase, abortClaim.jobId);
  assert.equal(abortJob.sourceActiveAggregateWriteGeneration, 5);
  assert.equal(abortJob.sourceCompletionAggregateWriteGeneration, 6);
  assert.equal(abortJob.targetActiveAggregateWriteGeneration, 9);
  assert.equal(abortJob.targetCompletionAggregateWriteGeneration, 10);
  abortDatabase.patch("bitescore_dishes/safe-abort-target", {
    restaurantId: "changed-after-valid-claim",
  });
  const abortResult = await processDishProposalJobStep(
    dependencies(abortDatabase),
    abortClaim.jobId,
    new Date(baseTime.getTime() + 21_101),
  );
  assert.equal(abortResult.status, "manual_review_required");
  assert.equal(
    jobData(abortDatabase, abortClaim.jobId).failureCode,
    "merge_targets_invalid",
  );
  assert.equal(
    abortDatabase.data("bitescore_dishes/safe-abort-source")
      .aggregateWriteGeneration,
    6,
  );
  assert.equal(
    abortDatabase.data("bitescore_dishes/safe-abort-target")
      .aggregateWriteGeneration,
    10,
  );
  assert.equal(
    abortDatabase.data("dish_rating_aggregates/safe-abort-source")
      .aggregateWriteGeneration,
    6,
  );
  assert.equal(
    abortDatabase.data("dish_rating_aggregates/safe-abort-target")
      .aggregateWriteGeneration,
    10,
  );
  assert.equal(
    abortDatabase.has(dishMergeReviewLockPath("safe-abort-source")),
    false,
  );
  assert.equal(
    abortDatabase.has(dishMergeReviewLockPath("safe-abort-target")),
    false,
  );
  assert.throws(
    () => abortDatabase.clientSetAggregate(
      "dish_rating_aggregates/safe-abort-target",
      {
        dishId: "safe-abort-target",
        restaurantId: "restaurant-1",
        ratingCount: 0,
        aggregateWriteGeneration: 9,
      },
    ),
    /client-aggregate-generation-mismatch/,
  );

  const retainedDatabase = new InMemoryDishProposalDatabase();
  const retained = await createProposalGroup(retainedDatabase, {
    count: 1,
    prefix: "unsafe-abort",
    type: "merge",
    sourceDishId: "unsafe-abort-source",
    mergeTargetDishId: "unsafe-abort-target",
  });
  seedDish(retainedDatabase, "unsafe-abort-source");
  seedDish(retainedDatabase, "unsafe-abort-target");
  const retainedClaim = await claimDishProposalGroupForApply(
    retainedDatabase,
    retained.groupId,
    new Date(baseTime.getTime() + 21_200),
  );
  retainedDatabase.patch("bitescore_dishes/unsafe-abort-target", {
    restaurantId: "invalid-after-claim",
    aggregateWriteGeneration: 77,
  });
  const retainedResult = await processDishProposalJobStep(
    dependencies(retainedDatabase),
    retainedClaim.jobId,
    new Date(baseTime.getTime() + 21_201),
  );
  assert.equal(retainedResult.status, "manual_review_required");
  assert.equal(
    jobData(retainedDatabase, retainedClaim.jobId).failureCode,
    "merge_targets_invalid_locks_retained",
  );
  assert.equal(
    retainedDatabase.has(dishMergeReviewLockPath("unsafe-abort-source")),
    true,
  );
  assert.equal(
    retainedDatabase.has(dishMergeReviewLockPath("unsafe-abort-target")),
    true,
  );
});

test("invalid merge identities do not materialize and a missing lock is retryable", async () => {
  for (const variant of ["self", "missing"]) {
    const database = new InMemoryDishProposalDatabase();
    const sourceDishId = `${variant}-merge-source`;
    const result = await addProposal(database, {
      id: `${variant}-merge-proposal`,
      type: "merge",
      sourceDishId,
      ...(variant === "self" ? {mergeTargetDishId: sourceDishId} : {}),
      supporterUid: `${variant}-supporter`,
    });
    assert.equal(result.currentGroupId, null);
    assert.equal(result.memberWritten, false);
    assert.equal(
      database.documentsIn("private_dish_edit_application_jobs").length,
      0,
    );
    assert.equal(database.documentsIn(dishMergeReviewLockCollection).length, 0);
  }

  const retryableDatabase = new InMemoryDishProposalDatabase();
  const retryable = await createProposalGroup(retryableDatabase, {
    count: 2,
    prefix: "missing-lock",
    type: "merge",
    sourceDishId: "missing-lock-source",
    mergeTargetDishId: "missing-lock-target",
  });
  seedDish(retryableDatabase, "missing-lock-source");
  seedDish(retryableDatabase, "missing-lock-target");
  const retryableClaim = await claimDishProposalGroupForApply(
    retryableDatabase,
    retryable.groupId,
    new Date(baseTime.getTime() + 23_000),
  );
  retryableDatabase.remove(dishMergeReviewLockPath("missing-lock-target"));
  const retryableStep = await processDishProposalJobStep(
    dependencies(retryableDatabase),
    retryableClaim.jobId,
    new Date(baseTime.getTime() + 23_001),
  );
  assert.equal(retryableStep.status, "retryable");
  assert.equal(jobData(retryableDatabase, retryableClaim.jobId).phase, "validate_targets");
  assert.equal(
    retryableDatabase.has(dishMergeReviewLockPath("missing-lock-source")),
    true,
  );
});

test("cycle cutoffs exclude new and late-materialized members and permit a later cycle", async () => {
  const database = new InMemoryDishProposalDatabase();
  const initial = await createProposalGroup(database, {
    count: 2,
    prefix: "cycle-initial",
    type: "merge",
    sourceDishId: "cycle-source",
    mergeTargetDishId: "cycle-target",
  });
  const lateId = "cycle-late-materialized";
  database.seed(
    `dish_edit_proposals/${lateId}`,
    proposalData({
      type: "merge",
      sourceDishId: "cycle-source",
      mergeTargetDishId: "cycle-target",
      supporterUid: "cycle-late-supporter",
    }),
    new Date(baseTime.getTime() + 5),
  );

  const firstClaim = await claimDishProposalGroupForReject(
    database,
    initial.groupId,
    new Date(baseTime.getTime() + 30_000),
  );
  assert.equal(firstClaim.claimed, true);
  assert.equal(jobData(database, firstClaim.jobId).cycleCutoffGeneration, 2);

  const recreatedId = initial.proposalIds[1];
  database.remove(`dish_edit_proposals/${recreatedId}`);
  await maintainDishEditProposalPrivateState(
    database,
    recreatedId,
    new Date(baseTime.getTime() + 30_001),
  );
  database.seed(
    `dish_edit_proposals/${recreatedId}`,
    proposalData({
      type: "merge",
      sourceDishId: "cycle-source",
      mergeTargetDishId: "cycle-target",
      supporterUid: "cycle-recreated-supporter",
    }),
    new Date(baseTime.getTime() + 30_002),
  );
  const recreatedResult = await maintainDishEditProposalPrivateState(
    database,
    recreatedId,
    new Date(baseTime.getTime() + 30_003),
  );
  assert.equal(recreatedResult.currentGroupId, initial.groupId);

  const newResult = await addProposal(database, {
    id: "cycle-new-after-cutoff",
    type: "merge",
    sourceDishId: "cycle-source",
    mergeTargetDishId: "cycle-target",
    supporterUid: "cycle-new-supporter",
    createTime: new Date(baseTime.getTime() + 31_000),
    maintainedAt: new Date(baseTime.getTime() + 31_001),
  });
  const lateResult = await maintainDishEditProposalPrivateState(
    database,
    lateId,
    new Date(baseTime.getTime() + 31_002),
  );
  assert.equal(newResult.currentGroupId, initial.groupId);
  assert.equal(lateResult.currentGroupId, initial.groupId);
  const activeGroup = database.data(dishProposalGroupPath(initial.groupId));
  assert.equal(activeGroup.activeJobId, firstClaim.jobId);
  assert.equal(activeGroup.lastMembershipGeneration, 5);

  await runUntilTerminal(
    dependencies(database),
    firstClaim.jobId,
    {now: new Date(baseTime.getTime() + 32_000)},
  );
  assert.equal(
    database.data(`dish_edit_proposals/${initial.proposalIds[0]}`).status,
    "rejected",
  );
  assert.equal(database.data(`dish_edit_proposals/${recreatedId}`).status, "pending");
  assert.equal(database.data("dish_edit_proposals/cycle-new-after-cutoff").status, "pending");
  assert.equal(database.data(`dish_edit_proposals/${lateId}`).status, "pending");
  const retainedGroup = database.data(dishProposalGroupPath(initial.groupId));
  assert.ok(retainedGroup);
  assert.equal(retainedGroup.activeJobId, null);
  assert.equal(retainedGroup.hasPendingMembers, true);

  const secondClaim = await claimDishProposalGroupForReject(
    database,
    initial.groupId,
    new Date(baseTime.getTime() + 33_000),
  );
  assert.equal(secondClaim.claimed, true);
  assert.equal(jobData(database, secondClaim.jobId).cycleCutoffGeneration, 5);
  await runUntilTerminal(
    dependencies(database),
    secondClaim.jobId,
    {now: new Date(baseTime.getTime() + 34_000)},
  );
  assert.equal(database.data("dish_edit_proposals/cycle-new-after-cutoff").status, "rejected");
  assert.equal(database.data(`dish_edit_proposals/${lateId}`).status, "rejected");
  assert.equal(database.data(`dish_edit_proposals/${recreatedId}`).status, "rejected");
  assert.equal(database.has(dishProposalGroupPath(initial.groupId)), false);
});

test("an active job retains an empty group until terminal cleanup", async () => {
  const database = new InMemoryDishProposalDatabase();
  const created = await createProposalGroup(database, {
    count: 1,
    prefix: "active-empty",
    type: "rename",
    sourceDishId: "active-empty-dish",
    proposedName: "Later Name",
  });
  const claim = await claimDishProposalGroupForReject(
    database,
    created.groupId,
    new Date(baseTime.getTime() + 40_000),
  );
  database.patch(`dish_edit_proposals/${created.proposalIds[0]}`, {
    status: "cancelled",
  });
  await maintainDishEditProposalPrivateState(
    database,
    created.proposalIds[0],
    new Date(baseTime.getTime() + 40_001),
  );
  const activeEmptyGroup = database.data(dishProposalGroupPath(created.groupId));
  assert.ok(activeEmptyGroup);
  assert.equal(activeEmptyGroup.hasPendingMembers, false);
  assert.equal(activeEmptyGroup.activeJobId, claim.jobId);

  const completed = await processDishProposalJobStep(
    dependencies(database),
    claim.jobId,
    new Date(baseTime.getTime() + 40_002),
  );
  assert.equal(completed.status, "complete");
  assert.equal(database.has(dishProposalGroupPath(created.groupId)), false);
});

test("merge migration moves every exact-source review while aggregates use only valid candidates", async () => {
  const database = new InMemoryDishProposalDatabase();
  const sourceDishId = "mixed-review-source";
  const targetDishId = "mixed-review-target";
  const created = await createProposalGroup(database, {
    count: 1,
    prefix: "mixed-review-proposal",
    type: "merge",
    sourceDishId,
    mergeTargetDishId: targetDishId,
  });
  seedDish(database, sourceDishId);
  seedDish(database, targetDishId);

  const totalReviewCount = 105;
  const minimalReviewIndices = new Set([0, 50, 104]);
  const originalMinimalUpdatedAt = new Date(baseTime.getTime() - 10_000);
  const validReviewDocuments = [];
  for (let index = 0; index < totalReviewCount; index += 1) {
    const id = `mixed-review-${String(index).padStart(3, "0")}`;
    if (minimalReviewIndices.has(index)) {
      database.seed(`dish_reviews/${id}`, {
        userId: `minimal-user-${index}`,
        dishId: sourceDishId,
        ...(index === 50
          ? {
              migrationSentinel: `preserve-${index}`,
              arbitraryNestedMap: {value: `nested-${index}`},
              updatedAt: originalMinimalUpdatedAt,
            }
          : {}),
      });
      continue;
    }
    const data = reviewData({
      id,
      dishId: sourceDishId,
      userId: `valid-user-${index}`,
      score: 50 + (index % 41),
      updatedOffset: index,
    });
    database.seed(`dish_reviews/${id}`, data);
    validReviewDocuments.push({id, data});
  }
  const expectedTargetAggregate = {
    ...legacyAggregate(
      validReviewDocuments,
      sourceDishId,
      "restaurant-1",
    ),
    dishId: targetDishId,
  };

  const claim = await claimDishProposalGroupForApply(
    database,
    created.groupId,
    new Date(baseTime.getTime() + 41_000),
  );
  assert.equal(claim.claimed, true);
  const resolutionDependencies = dependencies(database);
  const validated = await processDishProposalJobStep(
    resolutionDependencies,
    claim.jobId,
    new Date(baseTime.getTime() + 41_001),
  );
  assert.equal(validated.phase, "move_reviews");

  database.injectSetFailureOnce(
    (documentPath) => documentPath === "dish_reviews/mixed-review-050",
  );
  const failedBatch = await processDishProposalJobStep(
    resolutionDependencies,
    claim.jobId,
    new Date(baseTime.getTime() + 41_002),
  );
  assert.equal(failedBatch.status, "retryable");
  assert.equal(failedBatch.phase, "move_reviews");
  assert.equal(failedBatch.processedDocuments, 0);
  assert.equal(jobData(database, claim.jobId).reviewMigrationCursorId, null);
  assert.equal(
    database.documentsIn("dish_reviews").filter(
      (document) => document.data.dishId === sourceDishId,
    ).length,
    totalReviewCount,
  );
  assert.equal(database.has(dishMergeReviewLockPath(sourceDishId)), true);
  assert.equal(database.has(dishMergeReviewLockPath(targetDishId)), true);

  const firstBatchAt = new Date(baseTime.getTime() + 41_003);
  const firstBatch = await processDishProposalJobStep(
    resolutionDependencies,
    claim.jobId,
    firstBatchAt,
  );
  assert.equal(firstBatch.phase, "move_reviews");
  assert.equal(
    firstBatch.processedDocuments,
    dishProposalReviewMigrationBatchSize,
  );
  assert.equal(
    jobData(database, claim.jobId).reviewMigrationCursorId,
    "mixed-review-099",
  );
  assert.equal(database.data("dish_reviews/mixed-review-000").dishId, targetDishId);
  assert.equal(database.data("dish_reviews/mixed-review-050").dishId, targetDishId);
  assert.equal(database.data("dish_reviews/mixed-review-100").dishId, sourceDishId);
  assert.equal(database.data("dish_reviews/mixed-review-104").dishId, sourceDishId);
  assert.equal(
    database.documentsIn("dish_reviews").filter(
      (document) => document.data.dishId === sourceDishId,
    ).length,
    5,
  );
  assert.equal(database.data(`bitescore_dishes/${sourceDishId}`).isActive, true);
  assert.equal(jobData(database, claim.jobId).phase, "move_reviews");
  assert.equal(jobData(database, claim.jobId).status, "active");
  assert.equal(database.has(dishMergeReviewLockPath(sourceDishId)), true);
  assert.equal(database.has(dishMergeReviewLockPath(targetDishId)), true);

  const secondBatchAt = new Date(baseTime.getTime() + 41_004);
  const secondBatch = await processDishProposalJobStep(
    resolutionDependencies,
    claim.jobId,
    secondBatchAt,
  );
  assert.equal(secondBatch.phase, "rebuild_target_aggregate");
  assert.equal(secondBatch.processedDocuments, 5);

  for (const [index, expectedUpdatedAt] of [
    [0, firstBatchAt],
    [50, firstBatchAt],
    [104, secondBatchAt],
  ]) {
    const review = database.data(
      `dish_reviews/mixed-review-${String(index).padStart(3, "0")}`,
    );
    assert.equal(review.userId, `minimal-user-${index}`);
    assert.equal(review.dishId, targetDishId);
    assert.equal(review.restaurantId, "restaurant-1");
    assert.deepEqual(review.updatedAt, expectedUpdatedAt);
    if (index === 50) {
      assert.equal(review.migrationSentinel, `preserve-${index}`);
      assert.deepEqual(review.arbitraryNestedMap, {value: `nested-${index}`});
    } else {
      assert.equal(Object.hasOwn(review, "migrationSentinel"), false);
      assert.equal(Object.hasOwn(review, "arbitraryNestedMap"), false);
    }
  }

  const terminal = await runUntilTerminal(
    resolutionDependencies,
    claim.jobId,
    {now: new Date(baseTime.getTime() + 41_100)},
  );
  assert.equal(terminal.at(-1).status, "complete");
  assert.equal(
    database.documentsIn("dish_reviews").filter(
      (document) => document.data.dishId === sourceDishId,
    ).length,
    0,
  );
  assert.equal(
    database.documentsIn("dish_reviews").filter(
      (document) => document.data.dishId === targetDishId,
    ).length,
    totalReviewCount,
  );
  assertAggregatesNumericallyEquivalent(
    database.data(`dish_rating_aggregates/${targetDishId}`),
    expectedTargetAggregate,
  );
  assert.equal(
    database.data(`dish_rating_aggregates/${sourceDishId}`).ratingCount,
    0,
  );
  for (let index = 0; index < totalReviewCount; index += 1) {
    assert.equal(
      database.committedSetCount(
        `dish_reviews/mixed-review-${String(index).padStart(3, "0")}`,
      ),
      1,
    );
  }
});

test("large merge jobs are bounded, exact, retry-safe, private, and lock-safe", async () => {
  const database = new InMemoryDishProposalDatabase();
  const pointLedger = new IdempotentPointLedger();
  let resolutionDependencies = dependencies(database, pointLedger);
  const sourceDishId = "large-merge-source";
  const targetDishId = "large-merge-target";
  const created = await createProposalGroup(database, {
    count: 121,
    prefix: "large-merge-proposal",
    type: "merge",
    sourceDishId,
    mergeTargetDishId: targetDishId,
    includeCanaries: true,
  });
  seedDish(database, sourceDishId, {
    name: "Source Platter",
    normalizedName: "source platter",
  });
  seedDish(database, targetDishId, {
    name: "Target Platter",
    normalizedName: "target platter",
  });
  const sourceReviewPaths = seedReviews(database, {
    count: 251,
    prefix: "large-source-review",
    dishId: sourceDishId,
  });
  seedReviews(database, {
    count: 7,
    prefix: "large-target-review",
    dishId: targetDishId,
  });
  database.seed(
    "dish_reviews/000-normalized-reviewer",
    reviewData({
      id: "embedded-normalized-first",
      dishId: targetDishId,
      userId: " normalized-reviewer",
      score: 11,
      updatedOffset: 10,
    }),
  );
  database.seed(
    "dish_reviews/middle-normalized-reviewer",
    reviewData({
      id: "embedded-normalized-winner",
      dishId: targetDishId,
      userId: "normalized-reviewer ",
      score: 97,
      updatedOffset: 30,
    }),
  );
  database.seed(
    "dish_reviews/zzz-normalized-reviewer",
    reviewData({
      id: "embedded-normalized-last",
      dishId: targetDishId,
      userId: "normalized-reviewer",
      score: 23,
      updatedOffset: 20,
    }),
  );
  database.seed(
    "dish_reviews/equal-time-source-a",
    reviewData({
      id: "embedded-id-that-would-win",
      dishId: targetDishId,
      userId: "equal-time-reviewer",
      score: 13,
      updatedOffset: 40,
    }),
  );
  database.seed(
    "dish_reviews/equal-time-source-z",
    reviewData({
      id: "embedded-id-that-would-lose",
      dishId: targetDishId,
      userId: "equal-time-reviewer",
      score: 89,
      updatedOffset: 40,
    }),
  );
  database.seed(`dish_rating_aggregates/${sourceDishId}`, {
    dishId: sourceDishId,
    restaurantId: "restaurant-1",
    overallBiteScore: 999,
    ratingCount: 999,
    aggregateWriteGeneration: 0,
  });
  database.seed(`dish_rating_aggregates/${targetDishId}`, {
    dishId: targetDishId,
    restaurantId: "restaurant-1",
    overallBiteScore: 999,
    ratingCount: 999,
    aggregateWriteGeneration: 0,
  });
  const preClaimTargetPayload = {
    dishId: targetDishId,
    restaurantId: "restaurant-1",
    overallBiteScore: 12,
    ratingCount: 1,
    aggregateWriteGeneration: 0,
  };
  assert.doesNotThrow(
    () => database.clientSetAggregate(`dish_rating_aggregates/${targetDishId}`, {
      dishId: targetDishId,
      restaurantId: "restaurant-1",
      overallBiteScore: 999,
      ratingCount: 999,
    }),
  );

  const claim = await claimDishProposalGroupForApply(
    database,
    created.groupId,
    new Date(baseTime.getTime() + 50_000),
  );
  assert.equal(claim.claimed, true);
  const jobId = claim.jobId;
  const jobPath = dishProposalJobPath(jobId);
  const sourceLockPath = dishMergeReviewLockPath(sourceDishId);
  const targetLockPath = dishMergeReviewLockPath(targetDishId);
  const claimedJob = jobData(database, jobId);
  assert.equal(claimedJob.sourceActiveAggregateWriteGeneration, 1);
  assert.equal(claimedJob.sourceCompletionAggregateWriteGeneration, 2);
  assert.equal(claimedJob.targetActiveAggregateWriteGeneration, 1);
  assert.equal(claimedJob.targetCompletionAggregateWriteGeneration, 2);
  assert.equal(
    database.data(`bitescore_dishes/${sourceDishId}`)
      .aggregateWriteGeneration,
    1,
  );
  assert.equal(
    database.data(`bitescore_dishes/${targetDishId}`)
      .aggregateWriteGeneration,
    1,
  );
  assert.equal(database.data(sourceLockPath).state, "active");
  assert.equal(database.data(targetLockPath).state, "active");
  assert.equal(database.data(sourceLockPath).activeAggregateWriteGeneration, 1);
  assert.equal(database.data(sourceLockPath).completionAggregateWriteGeneration, 2);
  assert.equal(database.data(targetLockPath).activeAggregateWriteGeneration, 1);
  assert.equal(database.data(targetLockPath).completionAggregateWriteGeneration, 2);
  assert.throws(
    () => database.clientSetAggregate(
      `dish_rating_aggregates/${targetDishId}`,
      preClaimTargetPayload,
    ),
    /client-aggregate-blocked-by-merge-lock/,
  );
  const duringLockTargetPayload = {
    ...preClaimTargetPayload,
    overallBiteScore: 34,
    aggregateWriteGeneration: 1,
  };
  assert.throws(
    () => database.clientSetAggregate(
      `dish_rating_aggregates/${targetDishId}`,
      duringLockTargetPayload,
    ),
    /client-aggregate-blocked-by-merge-lock/,
  );
  assertNoCanaries(privateStateSnapshot(database), "claimed private state");
  assertNoCanaries(
    privateStateSnapshot(database).map((document) => document.path),
    "private deterministic IDs",
  );

  database.injectSetFailureOnce(
    (documentPath) => documentPath === jobPath,
    "injected-after-locks-before-migration",
  );
  let result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 50_001),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "validate_targets");
  assert.equal(database.has(sourceLockPath), true);
  assert.equal(database.has(targetLockPath), true);
  assert.equal(
    database.documentsIn("dish_edit_proposals")
      .every((document) => document.data.status === "pending"),
    true,
  );

  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 50_002),
  );
  assert.equal(result.phase, "move_reviews");
  assert.equal(result.status, "active");

  database.injectSetFailureOnce(
    (documentPath) => documentPath === "dish_reviews/large-source-review-050",
    "injected-during-review-batch",
  );
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 50_003),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "move_reviews");
  assert.equal(
    sourceReviewPaths.every(
      (documentPath) => database.data(documentPath).dishId === sourceDishId,
    ),
    true,
  );
  assert.equal(database.has(sourceLockPath), true);
  assert.equal(database.has(targetLockPath), true);

  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 50_004),
  );
  assert.equal(result.processedDocuments, 100);
  assert.equal(result.phase, "move_reviews");
  assert.equal(database.data(sourceReviewPaths[0]).dishId, targetDishId);
  assert.throws(
    () => database.clientPatchReview(sourceReviewPaths[0], {dishId: sourceDishId}),
    /client-review-blocked-by-merge-lock/,
  );
  assert.equal(database.data(sourceReviewPaths[0]).dishId, targetDishId);
  assert.throws(
    () => database.clientSetAggregate(`dish_rating_aggregates/${sourceDishId}`, {
      dishId: sourceDishId,
      restaurantId: "restaurant-1",
      ratingCount: 1,
    }),
    /client-aggregate-blocked-by-merge-lock/,
  );

  database.injectSetFailureOnce(
    (documentPath) => documentPath === jobPath,
    "injected-after-review-writes-before-cursor",
  );
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 50_005),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "move_reviews");
  assert.equal(database.data(sourceReviewPaths[100]).dishId, sourceDishId);

  resolutionDependencies = dependencies(database, pointLedger);
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 50_006),
  );
  assert.equal(result.processedDocuments, 100);
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 50_007),
  );
  assert.equal(result.processedDocuments, 51);
  assert.equal(result.phase, "rebuild_target_aggregate");
  assert.equal(
    sourceReviewPaths.every(
      (documentPath) => database.data(documentPath).dishId === targetDishId,
    ),
    true,
  );

  database.injectSetFailureOnce(
    (documentPath) => documentPath === jobPath,
    "injected-during-aggregate-page",
  );
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 50_008),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "rebuild_target_aggregate");
  assert.equal(database.data(`dish_rating_aggregates/${targetDishId}`).ratingCount, 999);

  const rawTargetResults = [];
  let aggregateStep = 0;
  while (jobData(database, jobId).phase === "rebuild_target_aggregate") {
    const aggregateResult = await processDishProposalJobStep(
      resolutionDependencies,
      jobId,
      new Date(baseTime.getTime() + 51_000 + aggregateStep),
    );
    rawTargetResults.push(aggregateResult);
    aggregateStep += 1;
    assert.ok(aggregateStep < 10);
  }
  assert.equal(rawTargetResults.length, 3);
  assert.deepEqual(
    rawTargetResults.map((entry) => entry.processedDocuments),
    [100, 100, 63],
  );
  assertNoCanaries(jobData(database, jobId), "aggregate job checkpoint");
  const winnerCollection = dishReviewAggregateWinnerCollectionPath(jobId);
  const materializedWinners = database.documentsIn(winnerCollection);
  assert.equal(materializedWinners.length, 260);
  const winnerSourceDocumentIds = materializedWinners.map(
    (document) => document.data.sourceDocumentId,
  );
  assert.equal(
    winnerSourceDocumentIds.includes("middle-normalized-reviewer"),
    true,
  );
  assert.equal(
    winnerSourceDocumentIds.includes("000-normalized-reviewer"),
    false,
  );
  assert.equal(
    winnerSourceDocumentIds.includes("zzz-normalized-reviewer"),
    false,
  );
  assert.equal(
    winnerSourceDocumentIds.includes("equal-time-source-z"),
    true,
  );
  assert.equal(
    winnerSourceDocumentIds.includes("equal-time-source-a"),
    false,
  );
  assertNoCanaries(
    materializedWinners,
    "aggregate winner materialization",
  );

  database.injectSetFailureOnce(
    (documentPath) => documentPath === jobPath,
    "injected-during-winner-fold",
  );
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 51_050),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "fold_target_aggregate");
  assert.equal(database.documentsIn(winnerCollection).length, 260);
  assert.equal(database.data(`dish_rating_aggregates/${targetDishId}`).ratingCount, 999);

  const aggregatePhaseResults = [];
  while (
    new Set([
      "fold_target_aggregate",
      "rebuild_source_aggregate",
      "fold_source_aggregate",
    ]).has(jobData(database, jobId).phase)
  ) {
    const phaseBefore = jobData(database, jobId).phase;
    const aggregateResult = await processDishProposalJobStep(
      resolutionDependencies,
      jobId,
      new Date(baseTime.getTime() + 51_100 + aggregateStep),
    );
    aggregatePhaseResults.push({
      phaseBefore,
      processedDocuments: aggregateResult.processedDocuments,
    });
    aggregateStep += 1;
    assert.ok(aggregateStep < 20);
  }
  assert.deepEqual(
    aggregatePhaseResults
      .filter((entry) => entry.phaseBefore === "fold_target_aggregate")
      .map((entry) => entry.processedDocuments),
    [100, 100, 60],
  );
  assert.deepEqual(
    aggregatePhaseResults
      .filter((entry) => entry.phaseBefore === "rebuild_source_aggregate")
      .map((entry) => entry.processedDocuments),
    [0],
  );
  assert.deepEqual(
    aggregatePhaseResults
      .filter((entry) => entry.phaseBefore === "fold_source_aggregate")
      .map((entry) => entry.processedDocuments),
    [0],
  );
  assert.equal(database.documentsIn(winnerCollection).length, 0);
  assert.equal(jobData(database, jobId).phase, "finalize_dishes");

  const expectedTargetAggregate = legacyAggregate(
    database.documentsIn("dish_reviews"),
    targetDishId,
    "restaurant-1",
  );
  const actualTargetAggregate = withoutUpdatedAt(
    database.data(`dish_rating_aggregates/${targetDishId}`),
  );
  assert.deepEqual(
    actualTargetAggregate,
    aggregateFromMaterializedWinners(
      materializedWinners,
      targetDishId,
      "restaurant-1",
    ),
  );
  assertAggregatesNumericallyEquivalent(
    actualTargetAggregate,
    expectedTargetAggregate,
  );
  assert.deepEqual(
    withoutUpdatedAt(database.data(`dish_rating_aggregates/${sourceDishId}`)),
    legacyAggregate(
      database.documentsIn("dish_reviews"),
      sourceDishId,
      "restaurant-1",
    ),
  );
  assert.equal(
    database.committedSetCount(`dish_rating_aggregates/${targetDishId}`),
    1,
  );
  assert.equal(
    database.committedSetCount(`dish_rating_aggregates/${sourceDishId}`),
    1,
  );
  assert.equal(
    database.data(`dish_rating_aggregates/${targetDishId}`)
      .aggregateWriteGeneration,
    1,
  );
  assert.equal(
    database.data(`dish_rating_aggregates/${sourceDishId}`)
      .aggregateWriteGeneration,
    1,
  );

  database.injectSetFailureOnce(
    (documentPath) => documentPath === `bitescore_dishes/${sourceDishId}`,
    "injected-before-dish-finalization",
  );
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 51_101),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "finalize_dishes");
  assert.equal(database.data(`bitescore_dishes/${sourceDishId}`).isActive, true);
  assert.equal(database.has(sourceLockPath), true);
  assert.equal(database.has(targetLockPath), true);

  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 51_102),
  );
  assert.equal(result.phase, "award_points");
  assert.equal(database.data(`bitescore_dishes/${sourceDishId}`).isActive, false);
  assert.equal(
    database.data(`bitescore_dishes/${sourceDishId}`).mergedIntoDishId,
    targetDishId,
  );
  assert.equal(
    database.documentsIn("dish_edit_proposals")
      .every((document) => document.data.status === "pending"),
    true,
  );

  pointLedger.failAfterCommitOnce = true;
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 51_103),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "award_points");
  assert.equal(pointLedger.points, 1);
  assert.equal(pointLedger.ledger.size, 1);
  assert.equal(jobData(database, jobId).pointsCursorMemberId, null);
  assert.equal(database.has(sourceLockPath), true);
  assert.equal(database.has(targetLockPath), true);

  resolutionDependencies = dependencies(database, pointLedger);
  let pointsSteps = 0;
  while (jobData(database, jobId).phase === "award_points") {
    const pointsResult = await processDishProposalJobStep(
      resolutionDependencies,
      jobId,
      new Date(baseTime.getTime() + 52_000 + pointsSteps),
    );
    assert.ok(pointsResult.processedDocuments <= 1);
    pointsSteps += 1;
    assert.ok(pointsSteps < 130);
  }
  assert.equal(pointLedger.points, 121);
  assert.equal(pointLedger.ledger.size, 121);
  assert.equal(pointLedger.attempts.length, 122);
  assert.equal(jobData(database, jobId).phase, "finalize_proposals");
  assert.equal(
    database.documentsIn("dish_edit_proposals")
      .every((document) => document.data.status === "pending"),
    true,
  );

  database.injectSetFailureOnce(
    (documentPath) => documentPath.startsWith("dish_edit_proposals/"),
    "injected-during-proposal-finalization",
  );
  result = await processDishProposalJobStep(
    resolutionDependencies,
    jobId,
    new Date(baseTime.getTime() + 53_000),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "finalize_proposals");
  assert.equal(
    database.documentsIn("dish_edit_proposals")
      .every((document) => document.data.status === "pending"),
    true,
  );
  assert.equal(database.has(sourceLockPath), true);
  assert.equal(database.has(targetLockPath), true);

  const finalizationResults = [];
  let finalizationStep = 0;
  while (jobData(database, jobId).status !== "complete") {
    const finalizationResult = await processDishProposalJobStep(
      resolutionDependencies,
      jobId,
      new Date(baseTime.getTime() + 54_000 + finalizationStep),
    );
    finalizationResults.push(finalizationResult);
    finalizationStep += 1;
    assert.ok(finalizationStep < 130);
    if (finalizationResult.status !== "complete") {
      assert.equal(database.has(targetLockPath), true);
    }
  }

  assert.equal(jobData(database, jobId).status, "complete");
  assert.equal(database.has(targetLockPath), false);
  assert.equal(database.data(sourceLockPath).state, "merged_source");
  assert.equal(database.data(sourceLockPath).blocksClientReviews, true);
  assert.equal(database.data(sourceLockPath).blocksClientAggregates, true);
  assert.equal(database.data(sourceLockPath).activeAggregateWriteGeneration, 2);
  assert.equal(database.data(sourceLockPath).completionAggregateWriteGeneration, 2);
  assert.equal(
    database.data(`bitescore_dishes/${sourceDishId}`)
      .aggregateWriteGeneration,
    2,
  );
  assert.equal(
    database.data(`bitescore_dishes/${targetDishId}`)
      .aggregateWriteGeneration,
    2,
  );
  assert.equal(
    database.data(`dish_rating_aggregates/${sourceDishId}`)
      .aggregateWriteGeneration,
    2,
  );
  assert.equal(
    database.data(`dish_rating_aggregates/${targetDishId}`)
      .aggregateWriteGeneration,
    2,
  );
  const targetUnlockTransactions = database.committedTransactions.filter(
    (operations) => operations.some(
      (operation) =>
        operation.type === "delete" && operation.path === targetLockPath,
    ),
  );
  assert.equal(targetUnlockTransactions.length, 1);
  const targetUnlockOperations = targetUnlockTransactions[0];
  assert.equal(
    targetUnlockOperations.some(
      (operation) =>
        operation.type === "set" &&
        operation.path === `bitescore_dishes/${targetDishId}` &&
        operation.data.aggregateWriteGeneration === 2,
    ),
    true,
  );
  assert.equal(
    targetUnlockOperations.some(
      (operation) =>
        operation.type === "set" &&
        operation.path === `dish_rating_aggregates/${targetDishId}` &&
        operation.data.aggregateWriteGeneration === 2,
    ),
    true,
  );
  assert.equal(database.has(dishProposalGroupPath(created.groupId)), false);
  assert.equal(
    created.proposalIds.every(
      (proposalId) =>
        database.data(`dish_edit_proposals/${proposalId}`).status === "approved",
    ),
    true,
  );
  assert.equal(
    database.documentsIn(dishProposalMemberCollection).length,
    0,
  );
  assert.equal(
    sourceReviewPaths.every(
      (documentPath) =>
        database.data(documentPath).dishId === targetDishId &&
        database.committedSetCount(documentPath) === 1,
    ),
    true,
  );
  assert.equal(
    finalizationResults.every(
      (entry) => entry.processedDocuments <= dishProposalFinalizationBatchSize,
    ),
    true,
  );

  assert.throws(
    () => database.clientPatchReview(sourceReviewPaths[0], {dishId: sourceDishId}),
    /client-review-blocked-by-merge-lock/,
  );
  assert.throws(
    () => database.clientSetAggregate(`dish_rating_aggregates/${sourceDishId}`, {
      dishId: sourceDishId,
      restaurantId: "restaurant-1",
      ratingCount: 1,
    }),
    /client-aggregate-blocked-by-merge-lock/,
  );
  assert.throws(
    () => database.clientSetAggregate(
      `dish_rating_aggregates/${targetDishId}`,
      preClaimTargetPayload,
    ),
    /client-aggregate-generation-mismatch/,
  );
  assert.throws(
    () => database.clientSetAggregate(
      `dish_rating_aggregates/${targetDishId}`,
      duringLockTargetPayload,
    ),
    /client-aggregate-generation-mismatch/,
  );
  assert.throws(
    () => database.clientSetAggregate(`dish_rating_aggregates/${targetDishId}`, {
      dishId: targetDishId,
      restaurantId: "restaurant-1",
      ratingCount: expectedTargetAggregate.ratingCount,
    }),
    /client-aggregate-generation-mismatch/,
  );
  assert.doesNotThrow(
    () => database.clientSetAggregate(`dish_rating_aggregates/${targetDishId}`, {
      ...database.data(`dish_rating_aggregates/${targetDishId}`),
      ratingCount: expectedTargetAggregate.ratingCount,
    }),
  );

  const reviewQueries = database.attemptedQueries.filter(
    (query) => query.collectionPath === "dish_reviews",
  );
  const migrationQueries = reviewQueries.filter(
    (query) => query.orderBy?.[0]?.field === "__name__",
  );
  const targetAggregateQueries = reviewQueries.filter(
    (query) =>
      query.orderBy?.[0]?.field === "__name__" &&
      query.where?.some(
        (condition) =>
          condition.field === "dishId" && condition.value === targetDishId,
      ),
  );
  assert.ok(migrationQueries.length >= 5);
  assert.ok(targetAggregateQueries.length >= 4);
  assert.equal(
    reviewQueries.some(
      (query) => query.orderBy?.some((order) => order.field === "userId"),
    ),
    false,
  );
  assert.equal(
    migrationQueries.every(
      (query) =>
        query.limit <= dishProposalReviewMigrationBatchSize &&
        query.where?.some((condition) => condition.field === "dishId"),
    ),
    true,
  );
  assert.equal(
    targetAggregateQueries.every(
      (query) =>
        query.limit <= dishProposalAggregateScanBatchSize &&
        query.where?.some((condition) => condition.field === "dishId"),
    ),
    true,
  );
  const winnerFoldQueries = database.attemptedQueries.filter(
    (query) => query.collectionPath === winnerCollection,
  );
  assert.ok(winnerFoldQueries.length >= 5);
  assert.equal(
    winnerFoldQueries.every(
      (query) =>
        query.limit <= dishProposalAggregateScanBatchSize &&
        query.orderBy?.[0]?.field === "__name__",
    ),
    true,
  );
  const memberQueries = database.attemptedQueries.filter(
    (query) => query.collectionPath === dishProposalMemberCollection,
  );
  assert.equal(
    memberQueries.every(
      (query) =>
        query.limit <= 50 &&
        query.where?.some((condition) => condition.field === "groupId"),
    ),
    true,
  );
  assertNoCanaries(privateStateSnapshot(database), "completed private state");
  assertNoCanaries(database.committedOperations, "transaction operation log");
});

test("rename apply retries safely, awards once, excludes later members, and uses no locks", async () => {
  const database = new InMemoryDishProposalDatabase();
  const pointLedger = new IdempotentPointLedger();
  const created = await createProposalGroup(database, {
    count: 55,
    prefix: "rename-valid",
    type: "rename",
    sourceDishId: "rename-dish",
    proposedName: "crispy garlic knots",
    includeCanaries: true,
  });
  seedDish(database, "rename-dish", {
    name: "Garlic Knots",
    normalizedName: "garlic knots",
  });
  const claim = await claimDishProposalGroupForApply(
    database,
    created.groupId,
    new Date(baseTime.getTime() + 60_000),
  );
  assert.equal(claim.claimed, true);
  assert.equal(jobData(database, claim.jobId).cycleCutoffGeneration, 55);
  const later = await addProposal(database, {
    id: "rename-valid-later",
    type: "rename",
    sourceDishId: "rename-dish",
    proposedName: "crispy garlic knots",
    supporterUid: "rename-later-supporter",
    includeCanaries: true,
    createTime: new Date(baseTime.getTime() + 60_001),
    maintainedAt: new Date(baseTime.getTime() + 60_002),
  });
  assert.equal(later.currentGroupId, created.groupId);
  assert.equal(database.documentsIn(dishMergeReviewLockCollection).length, 0);

  database.injectSetFailureOnce(
    (documentPath) => documentPath === "bitescore_dishes/rename-dish",
    "injected-rename-write-failure",
  );
  let result = await processDishProposalJobStep(
    dependencies(database, pointLedger),
    claim.jobId,
    new Date(baseTime.getTime() + 60_003),
  );
  assert.equal(result.status, "retryable");
  assert.equal(result.phase, "validate_target");
  assert.equal(database.data("bitescore_dishes/rename-dish").name, "Garlic Knots");

  result = await processDishProposalJobStep(
    dependencies(database, pointLedger),
    claim.jobId,
    new Date(baseTime.getTime() + 60_004),
  );
  assert.equal(result.phase, "award_points");
  assert.equal(database.data("bitescore_dishes/rename-dish").name, "Crispy Garlic Knots");
  assert.equal(
    database.data("bitescore_dishes/rename-dish").normalizedName,
    "crispy garlic knots",
  );

  pointLedger.failAfterCommitOnce = true;
  result = await processDishProposalJobStep(
    dependencies(database, pointLedger),
    claim.jobId,
    new Date(baseTime.getTime() + 60_005),
  );
  assert.equal(result.status, "retryable");
  assert.equal(pointLedger.points, 1);
  let step = 0;
  const renameDependencies = dependencies(database, pointLedger);
  while (jobData(database, claim.jobId).phase === "award_points") {
    await processDishProposalJobStep(
      renameDependencies,
      claim.jobId,
      new Date(baseTime.getTime() + 61_000 + step),
    );
    step += 1;
    assert.ok(step < 65);
  }
  assert.equal(pointLedger.points, 55);
  assert.equal(pointLedger.ledger.size, 55);
  assert.equal(pointLedger.attempts.length, 56);
  assert.equal(database.data("dish_edit_proposals/rename-valid-later").status, "pending");

  const finalizationResults = await runUntilTerminal(
    renameDependencies,
    claim.jobId,
    {now: new Date(baseTime.getTime() + 62_000)},
  );
  assert.equal(jobData(database, claim.jobId).status, "complete");
  assert.equal(
    created.proposalIds.every(
      (proposalId) =>
        database.data(`dish_edit_proposals/${proposalId}`).status === "approved",
    ),
    true,
  );
  assert.equal(database.data("dish_edit_proposals/rename-valid-later").status, "pending");
  assert.equal(database.documentsIn(dishMergeReviewLockCollection).length, 0);
  assert.equal(
    finalizationResults.every(
      (entry) => entry.processedDocuments <= dishProposalFinalizationBatchSize,
    ),
    true,
  );
  const group = database.data(dishProposalGroupPath(created.groupId));
  assert.ok(group);
  assert.equal(group.activeJobId, null);
  assert.equal(group.hasPendingMembers, true);
  assert.equal(
    pointLedger.attempts.every(
      (request) =>
        request.groupId === created.groupId &&
        request.activeJobId === claim.jobId &&
        request.cycleCutoffGeneration === 55 &&
        request.membershipGeneration <= 55 &&
        request.oldValue === "Garlic Knots" &&
        request.newValue === "Crispy Garlic Knots" &&
        Number.isSafeInteger(request.trustedServerCreateTimeMillis),
    ),
    true,
  );
  assertNoCanaries(privateStateSnapshot(database), "rename private state");
});

test("changed supporter is reconciled without cursor advance and remains for a later cycle", async () => {
  const database = new InMemoryDishProposalDatabase();
  const created = await addProposal(database, {
    id: "supporter-change-proposal",
    type: "rename",
    sourceDishId: "supporter-change-dish",
    proposedName: "new dish name",
    supporterUid: "supporter-u1",
  });
  seedDish(database, "supporter-change-dish", {
    name: "Old Dish Name",
    normalizedName: "old dish name",
  });
  const claim = await claimDishProposalGroupForApply(
    database,
    created.currentGroupId,
    new Date(baseTime.getTime() + 65_000),
  );
  let result = await processDishProposalJobStep(
    dependencies(database),
    claim.jobId,
    new Date(baseTime.getTime() + 65_001),
  );
  assert.equal(result.phase, "award_points");

  const raceLedger = {
    attempts: [],
    async award(request) {
      this.attempts.push(clone(request));
      database.patch("dish_edit_proposals/supporter-change-proposal", {
        userId: "supporter-u2",
      });
      return {outcome: "notEligible", result: {entries: []}};
    },
  };
  result = await processDishProposalJobStep(
    dependencies(database, raceLedger),
    claim.jobId,
    new Date(baseTime.getTime() + 65_002),
  );
  assert.equal(result.processedDocuments, 1);
  assert.equal(result.phase, "award_points");
  assert.equal(jobData(database, claim.jobId).pointsCursorGeneration, null);
  assert.equal(jobData(database, claim.jobId).pointsCursorMemberId, null);
  assert.deepEqual(
    raceLedger.attempts.map((request) => request.supporterUid),
    ["supporter-u1"],
  );
  const memberDocumentId = createDishProposalMemberId(
    "supporter-change-proposal",
  );
  const refreshedMember = database.data(
    `${dishProposalMemberCollection}/${memberDocumentId}`,
  );
  assert.equal(refreshedMember.supporterUid, "supporter-u2");
  assert.equal(refreshedMember.membershipGeneration, 2);
  assert.ok(
    refreshedMember.membershipGeneration >
      jobData(database, claim.jobId).cycleCutoffGeneration,
  );

  await runUntilTerminal(
    dependencies(database, raceLedger),
    claim.jobId,
    {now: new Date(baseTime.getTime() + 65_100)},
  );
  assert.equal(
    database.data("dish_edit_proposals/supporter-change-proposal").status,
    "pending",
  );
  const retainedGroup = database.data(
    dishProposalGroupPath(created.currentGroupId),
  );
  assert.ok(retainedGroup);
  assert.equal(retainedGroup.activeJobId, null);
  assert.equal(retainedGroup.hasPendingMembers, true);
  assert.equal(retainedGroup.lastMembershipGeneration, 2);
  const laterClaim = await claimDishProposalGroupForApply(
    database,
    created.currentGroupId,
    new Date(baseTime.getTime() + 65_200),
  );
  assert.equal(laterClaim.claimed, true);
  assert.equal(jobData(database, laterClaim.jobId).cycleCutoffGeneration, 2);
});

test("point cursor rejects empty, unknown, and still-ineligible helper outcomes", async () => {
  const database = new InMemoryDishProposalDatabase();
  const created = await createProposalGroup(database, {
    count: 1,
    prefix: "point-outcome",
    type: "rename",
    sourceDishId: "point-outcome-dish",
    proposedName: "outcome dish",
  });
  seedDish(database, "point-outcome-dish", {
    name: "Before Outcome",
    normalizedName: "before outcome",
  });
  const claim = await claimDishProposalGroupForApply(
    database,
    created.groupId,
    new Date(baseTime.getTime() + 66_000),
  );
  await processDishProposalJobStep(
    dependencies(database),
    claim.jobId,
    new Date(baseTime.getTime() + 66_001),
  );

  for (const unsafeResult of [undefined, {outcome: "unknown", result: {entries: []}}]) {
    const unsafe = await processDishProposalJobStep(
      {
        database,
        awardApprovedProposalPoints: async () => unsafeResult,
      },
      claim.jobId,
      new Date(baseTime.getTime() + 66_010),
    );
    assert.equal(unsafe.status, "retryable");
    assert.equal(unsafe.phase, "award_points");
    assert.equal(jobData(database, claim.jobId).pointsCursorGeneration, null);
    assert.equal(jobData(database, claim.jobId).pointsCursorMemberId, null);
  }

  const ineligible = await processDishProposalJobStep(
    {
      database,
      awardApprovedProposalPoints: async () => ({
        outcome: "notEligible",
        result: {entries: []},
      }),
    },
    claim.jobId,
    new Date(baseTime.getTime() + 66_020),
  );
  assert.equal(ineligible.status, "retryable");
  assert.equal(ineligible.phase, "award_points");
  assert.equal(
    jobData(database, claim.jobId).failureCode,
    "point_award_not_eligible",
  );
  assert.equal(jobData(database, claim.jobId).pointsCursorGeneration, null);
  assert.equal(jobData(database, claim.jobId).pointsCursorMemberId, null);
});

test("exact proposal IDs including whitespace remain distinct through points and finalization", async () => {
  const database = new InMemoryDishProposalDatabase();
  const pointLedger = new IdempotentPointLedger();
  const exactIds = ["x", " x "];
  let groupId = null;
  for (let index = 0; index < exactIds.length; index += 1) {
    const result = await addProposal(database, {
      id: exactIds[index],
      type: "rename",
      sourceDishId: "exact-id-dish",
      proposedName: "exact identity name",
      supporterUid: `exact-supporter-${index}`,
      createTime: new Date(baseTime.getTime() + index),
      maintainedAt: new Date(baseTime.getTime() + 100 + index),
    });
    groupId ??= result.currentGroupId;
    assert.equal(result.currentGroupId, groupId);
  }
  assert.notEqual(
    createDishProposalMemberId(exactIds[0]),
    createDishProposalMemberId(exactIds[1]),
  );
  assert.equal(
    database.has(
      `${dishProposalMemberCollection}/${createDishProposalMemberId(exactIds[0])}`,
    ),
    true,
  );
  assert.equal(
    database.has(
      `${dishProposalMemberCollection}/${createDishProposalMemberId(exactIds[1])}`,
    ),
    true,
  );
  seedDish(database, "exact-id-dish", {
    name: "Before Exact Identity",
    normalizedName: "before exact identity",
  });
  const claim = await claimDishProposalGroupForApply(
    database,
    groupId,
    new Date(baseTime.getTime() + 67_000),
  );
  await runUntilTerminal(
    dependencies(database, pointLedger),
    claim.jobId,
    {now: new Date(baseTime.getTime() + 67_001)},
  );
  assert.deepEqual(
    [...pointLedger.ledger.keys()].sort(),
    [...exactIds].sort(),
  );
  assert.deepEqual(
    pointLedger.attempts.map((request) => request.proposalDocumentId).sort(),
    [...exactIds].sort(),
  );
  assert.equal(pointLedger.points, 2);
  assert.equal(database.data("dish_edit_proposals/x").status, "approved");
  assert.equal(database.data("dish_edit_proposals/ x ").status, "approved");
});

test("rename no-op, missing-target, and reject paths preserve their point and lock semantics", async () => {
  const noOpDatabase = new InMemoryDishProposalDatabase();
  const noOpLedger = new IdempotentPointLedger();
  const noOp = await createProposalGroup(noOpDatabase, {
    count: 1,
    prefix: "rename-no-op",
    type: "rename",
    sourceDishId: "rename-no-op-dish",
    proposedName: "pizza slice",
  });
  seedDish(noOpDatabase, "rename-no-op-dish", {
    name: "Pizza Slice",
    normalizedName: "pizza slice",
  });
  const noOpClaim = await claimDishProposalGroupForApply(
    noOpDatabase,
    noOp.groupId,
    new Date(baseTime.getTime() + 70_000),
  );
  await runUntilTerminal(
    dependencies(noOpDatabase, noOpLedger),
    noOpClaim.jobId,
    {now: new Date(baseTime.getTime() + 70_001)},
  );
  assert.equal(noOpLedger.points, 0);
  assert.equal(noOpLedger.ledger.size, 0);
  assert.equal(
    noOpDatabase.committedSetCount("bitescore_dishes/rename-no-op-dish"),
    0,
  );
  assert.equal(
    noOpDatabase.data(`dish_edit_proposals/${noOp.proposalIds[0]}`).status,
    "approved",
  );
  assert.equal(noOpDatabase.documentsIn(dishMergeReviewLockCollection).length, 0);

  const missingDatabase = new InMemoryDishProposalDatabase();
  const missing = await createProposalGroup(missingDatabase, {
    count: 1,
    prefix: "rename-missing",
    type: "rename",
    sourceDishId: "missing-rename-dish",
    proposedName: "Missing Rename",
  });
  const missingClaim = await claimDishProposalGroupForApply(
    missingDatabase,
    missing.groupId,
    new Date(baseTime.getTime() + 71_000),
  );
  const missingResult = await processDishProposalJobStep(
    dependencies(missingDatabase),
    missingClaim.jobId,
    new Date(baseTime.getTime() + 71_001),
  );
  assert.equal(missingResult.status, "manual_review_required");
  assert.equal(
    jobData(missingDatabase, missingClaim.jobId).failureCode,
    "rename_target_invalid",
  );
  assert.equal(
    missingDatabase.data(`dish_edit_proposals/${missing.proposalIds[0]}`).status,
    "pending",
  );
  assert.equal(missingDatabase.documentsIn(dishMergeReviewLockCollection).length, 0);

  const rejectDatabase = new InMemoryDishProposalDatabase();
  const rejectLedger = new IdempotentPointLedger();
  const rejected = await createProposalGroup(rejectDatabase, {
    count: 2,
    prefix: "merge-reject",
    type: "merge",
    sourceDishId: "reject-source",
    mergeTargetDishId: "reject-target",
  });
  seedDish(rejectDatabase, "reject-source");
  seedDish(rejectDatabase, "reject-target");
  const rejectClaim = await claimDishProposalGroupForReject(
    rejectDatabase,
    rejected.groupId,
    new Date(baseTime.getTime() + 72_000),
  );
  assert.equal(rejectDatabase.documentsIn(dishMergeReviewLockCollection).length, 0);
  await runUntilTerminal(
    dependencies(rejectDatabase, rejectLedger),
    rejectClaim.jobId,
    {now: new Date(baseTime.getTime() + 72_001)},
  );
  assert.equal(rejectLedger.points, 0);
  assert.equal(
    rejected.proposalIds.every(
      (proposalId) =>
        rejectDatabase.data(`dish_edit_proposals/${proposalId}`).status === "rejected",
    ),
    true,
  );
  assert.equal(rejectDatabase.data("bitescore_dishes/reject-source").isActive, true);
  assert.equal(rejectDatabase.data("bitescore_dishes/reject-target").isActive, true);
  assert.equal(rejectDatabase.documentsIn(dishMergeReviewLockCollection).length, 0);
});

test("malformed active group and job operational fields fail closed", async () => {
  const malformedGroupDatabase = new InMemoryDishProposalDatabase();
  const malformedGroup = await createProposalGroup(malformedGroupDatabase, {
    count: 1,
    prefix: "malformed-active-group",
    type: "rename",
    sourceDishId: "malformed-active-group-dish",
    proposedName: "Malformed Group Name",
  });
  for (const marker of [false, "missing"]) {
    const markerDatabase = copyDatabase(malformedGroupDatabase);
    const groupPath = dishProposalGroupPath(malformedGroup.groupId);
    if (marker === false) {
      markerDatabase.patch(groupPath, {resolutionIdentitiesValid: false});
    } else {
      const groupData = markerDatabase.data(groupPath);
      delete groupData.resolutionIdentitiesValid;
      markerDatabase.seed(groupPath, groupData);
    }
    await assert.rejects(
      claimDishProposalGroupForApply(
        markerDatabase,
        malformedGroup.groupId,
        new Date(baseTime.getTime() + 79_999),
      ),
      /invalid schema/,
      `resolution identity marker ${marker}`,
    );
    assert.equal(
      markerDatabase.documentsIn("private_dish_edit_application_jobs").length,
      0,
    );
  }
  malformedGroupDatabase.patch(dishProposalGroupPath(malformedGroup.groupId), {
    activeJobId: {unexpected: "object"},
  });
  const malformedGroupBefore = malformedGroupDatabase.data(
    dishProposalGroupPath(malformedGroup.groupId),
  );
  await assert.rejects(
    claimDishProposalGroupForApply(
      malformedGroupDatabase,
      malformedGroup.groupId,
      new Date(baseTime.getTime() + 80_000),
    ),
    /invalid schema/,
  );
  assert.deepEqual(
    malformedGroupDatabase.data(dishProposalGroupPath(malformedGroup.groupId)),
    malformedGroupBefore,
  );
  assert.equal(
    malformedGroupDatabase.documentsIn("private_dish_edit_application_jobs")
      .length,
    0,
  );

  const validJobDatabase = new InMemoryDishProposalDatabase();
  const validJobGroup = await createProposalGroup(validJobDatabase, {
    count: 1,
    prefix: "malformed-job",
    type: "rename",
    sourceDishId: "malformed-job-dish",
    proposedName: "Malformed Job Name",
  });
  seedDish(validJobDatabase, "malformed-job-dish");
  const validClaim = await claimDishProposalGroupForApply(
    validJobDatabase,
    validJobGroup.groupId,
    new Date(baseTime.getTime() + 80_100),
  );
  const jobPath = dishProposalJobPath(validClaim.jobId);
  const malformedNullableFields = [
    "mergeTargetDishId",
    "normalizedProposedName",
    "reviewMigrationCursorId",
    "aggregateState",
    "aggregateCursorDocumentId",
    "aggregateWinnerCursorId",
    "sourceActiveAggregateWriteGeneration",
    "sourceCompletionAggregateWriteGeneration",
    "targetActiveAggregateWriteGeneration",
    "targetCompletionAggregateWriteGeneration",
    "pointsCursorGeneration",
    "pointsCursorMemberId",
    "renameOldValue",
    "renameNewValue",
    "failureCode",
    "completedAt",
  ];
  const malformedJobCases = [
    ...malformedNullableFields.map((field) => [field, {wrong: "type"}]),
    ["cycleCutoffGeneration", 1.5],
    ["resolutionSequence", Number.MAX_SAFE_INTEGER + 1],
    ["cycleCutoffAt", {wrong: "timestamp"}],
    ["version", "unknown-job-version"],
    ["status", "unknown-job-status"],
    ["phase", "unknown-job-phase"],
  ];
  for (const [field, value] of malformedJobCases) {
    const database = copyDatabase(validJobDatabase);
    database.patch(jobPath, {[field]: value});
    const malformedJobBefore = database.data(jobPath);
    await assert.rejects(
      processDishProposalJobStep(
        dependencies(database),
        validClaim.jobId,
        new Date(baseTime.getTime() + 80_200),
      ),
      /invalid|malformed/i,
      field,
    );
    assert.deepEqual(database.data(jobPath), malformedJobBefore, field);
    assert.equal(
      database.data("bitescore_dishes/malformed-job-dish").name,
      "Dish malformed-job-dish",
      field,
    );
  }
});

test("malformed merge locks remain present and prevent phase advancement", async () => {
  const validLockDatabase = new InMemoryDishProposalDatabase();
  const group = await createProposalGroup(validLockDatabase, {
    count: 1,
    prefix: "malformed-lock",
    type: "merge",
    sourceDishId: "malformed-lock-source",
    mergeTargetDishId: "malformed-lock-target",
  });
  seedDish(validLockDatabase, "malformed-lock-source");
  seedDish(validLockDatabase, "malformed-lock-target");
  const claim = await claimDishProposalGroupForApply(
    validLockDatabase,
    group.groupId,
    new Date(baseTime.getTime() + 81_000),
  );
  const sourceLockPath = dishMergeReviewLockPath("malformed-lock-source");
  const targetLockPath = dishMergeReviewLockPath("malformed-lock-target");
  const malformedLockCases = [
    ["targetDishId", {wrong: "type"}],
    ["activeAggregateWriteGeneration", 1.5],
    ["completionAggregateWriteGeneration", Number.MAX_SAFE_INTEGER + 1],
    ["version", "unknown-lock-version"],
    ["state", "unknown-lock-state"],
    ["indexedAt", {wrong: "timestamp"}],
    ["blocksClientReviews", false],
    ["jobId", {wrong: "type"}],
    ["groupId", {wrong: "type"}],
  ];
  for (const [field, value] of malformedLockCases) {
    const database = copyDatabase(validLockDatabase);
    database.patch(sourceLockPath, {[field]: value});
    const malformedLockBefore = database.data(sourceLockPath);
    const result = await processDishProposalJobStep(
      dependencies(database),
      claim.jobId,
      new Date(baseTime.getTime() + 81_100),
    );
    assert.equal(result.status, "retryable", field);
    assert.equal(result.phase, "validate_targets", field);
    assert.equal(
      jobData(database, claim.jobId).failureCode,
      "retryable_step_failure",
      field,
    );
    assert.deepEqual(database.data(sourceLockPath), malformedLockBefore, field);
    assert.equal(database.has(targetLockPath), true, field);
    assert.equal(
      database.data("bitescore_dishes/malformed-lock-source")
        .aggregateWriteGeneration,
      1,
      field,
    );
    assert.equal(
      database.data("bitescore_dishes/malformed-lock-target")
        .aggregateWriteGeneration,
      1,
      field,
    );
  }
});
