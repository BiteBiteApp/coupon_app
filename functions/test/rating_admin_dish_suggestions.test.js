"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  createDishProposalGroupId,
  createDishProposalJobId,
  dishProposalAutomaticDelayMilliseconds,
  dishProposalDocumentFingerprint,
  dishProposalGroupCollection,
  dishProposalGroupPath,
  dishProposalGroupVersion,
  dishProposalJobCollection,
  dishProposalJobPath,
  dishProposalJobVersion,
  dishProposalSupporterCollection,
  dishMergeReviewLockCollection,
  dishMergeReviewLockPath,
  dishMergeReviewLockVersion,
} = require("../lib/dish_proposal_private_contract.js");
const {OpaqueCursorCodec} = require("../lib/opaque_cursor.js");
const {createQueryFingerprint} = require("../lib/query_fingerprint.js");
const {
  listRatingAdminDishSuggestionsPageHandler,
  ratingAdminDishSuggestionsEntityKind,
  ratingAdminDishSuggestionsPageSize,
} = require("../lib/rating_admin_dish_suggestions_paging.js");
const {
  applyRatingAdminDishSuggestionGroupHandler,
  dishProposalActionContractVersion,
  dishProposalActionResultContractVersion,
  dishProposalScheduledExistingJobLimit,
  dishProposalScheduledWorkLimit,
  processDishProposalResolutionWorkHandler,
  rejectRatingAdminDishSuggestionGroupHandler,
} = require("../lib/dish_proposal_runtime_integration.js");

const baseTimeMs = Date.UTC(2026, 7, 10, 12);
const cursorSecret = "A".repeat(43);
const privacyCanaries = Object.freeze([
  "proposal-reason-canary",
  "private-email-canary@example.test",
  "+1-555-private-phone",
  "auth-token-canary",
  "stripe-secret-canary",
  "nested-private-map-canary",
]);

function pageRequest(overrides = {}) {
  return {
    protocolVersion: "bitestar.page.v1",
    pageSize: 25,
    criteria: {entityKind: "dishSuggestions"},
    direction: "first",
    requestExactCount: true,
    clientRequestId: "dish-suggestions-request-1",
    ...overrides,
  };
}

function scalar(value) {
  return value instanceof Date ? value.getTime() : value;
}

function compare(left, right) {
  const first = scalar(left);
  const second = scalar(right);
  if (first === second) return 0;
  if (first === null) return -1;
  if (second === null) return 1;
  return first < second ? -1 : 1;
}

function field(document, name) {
  return name === "__name__" ? document.id : document.data[name];
}

class FakeDatabase {
  constructor(collections = {}, sources = {}) {
    this.collections = collections;
    this.sources = sources;
    this.queries = [];
    this.gets = [];
    this.counts = [];
    this.writeAttempts = [];
  }

  matching(collectionPath, filters) {
    return [...(this.collections[collectionPath] ?? [])].filter((document) =>
      filters.every((filter) => {
        const result = compare(field(document, filter.field), filter.value);
        if (filter.operation === "==") return result === 0;
        if (filter.operation === "<=") return result <= 0;
        if (filter.operation === ">=") return result >= 0;
        throw new Error("Unsupported fake query filter.");
      }),
    );
  }

  async queryDocuments(query) {
    this.queries.push(structuredClone(query));
    let documents = this.matching(query.collectionPath, query.filters);
    documents.sort((left, right) => {
      for (const order of query.orders) {
        const result = compare(field(left, order.field), field(right, order.field));
        if (result !== 0) return order.direction === "desc" ? -result : result;
      }
      return 0;
    });
    if (query.cursor !== undefined) {
      const compareCursor = (document) => {
        for (let index = 0; index < query.orders.length; index += 1) {
          const order = query.orders[index];
          const result = compare(
            field(document, order.field),
            query.cursor.values[index],
          );
          if (result !== 0) {
            return order.direction === "desc" ? -result : result;
          }
        }
        return 0;
      };
      documents = documents.filter((document) =>
        query.cursor.kind === "startAfter" ?
          compareCursor(document) > 0 :
          compareCursor(document) < 0,
      );
    }
    return query.limitToLast ?
      documents.slice(-query.limit) :
      documents.slice(0, query.limit);
  }

  async countDocuments(query) {
    this.counts.push(structuredClone(query));
    return this.matching(query.collectionPath, query.filters).length;
  }

  async getDocuments(paths) {
    this.gets.push([...paths]);
    return paths
      .map((path) => this.sources[path])
      .filter((document) => document !== undefined);
  }

  async runTransaction() {
    this.writeAttempts.push("runTransaction");
    throw new Error("Paging must not start a write transaction.");
  }

  async setDocument() {
    this.writeAttempts.push("setDocument");
    throw new Error("Paging must not write.");
  }

  async deleteDocument() {
    this.writeAttempts.push("deleteDocument");
    throw new Error("Paging must not write.");
  }
}

function pagingContext(database, overrides = {}) {
  return {
    adminUid: "admin-1",
    cursorSecret,
    database,
    now: () => baseTimeMs,
    nonceSource: () => new Uint8Array(12).fill(7),
    ...overrides,
  };
}

function groupFingerprint(group) {
  return dishProposalDocumentFingerprint(dishProposalGroupVersion, [
    group.groupId,
    group.proposalType,
    group.restaurantId,
    group.sourceDishId,
    group.mergeTargetDishId,
    group.normalizedProposedName,
    group.resolutionIdentitiesValid,
    group.hasPendingMembers,
    group.oldestTrustedServerCreateTime?.toISOString() ?? null,
    group.dueAt?.toISOString() ?? null,
    group.enoughSupporters,
    group.autoEligible,
    group.lastMembershipGeneration,
    group.resolutionSequence,
    group.activeJobId,
    group.activeResolutionType,
    group.cycleCutoffGeneration,
    group.cycleCutoffAt?.toISOString() ?? null,
  ]);
}

function makeGroup(index, overrides = {}) {
  const proposalType = overrides.proposalType ?? "rename";
  const oldestTrustedServerCreateTime = Object.hasOwn(
    overrides,
    "oldestTrustedServerCreateTime",
  ) ? overrides.oldestTrustedServerCreateTime : new Date(baseTimeMs + index);
  const hasPendingMembers = overrides.hasPendingMembers ??
    oldestTrustedServerCreateTime !== null;
  const dueAt = Object.hasOwn(overrides, "dueAt") ?
    overrides.dueAt :
    oldestTrustedServerCreateTime === null ?
      null :
      new Date(
        oldestTrustedServerCreateTime.getTime() +
          dishProposalAutomaticDelayMilliseconds,
      );
  const identity = {
    proposalType,
    restaurantId: overrides.restaurantId ?? "restaurant-1",
    sourceDishId: overrides.sourceDishId ?? `dish-${index}`,
    mergeTargetDishId: proposalType === "merge" ?
      overrides.mergeTargetDishId ?? `target-${index}` :
      null,
    normalizedProposedName: proposalType === "rename" ?
      overrides.normalizedProposedName ?? `renamed dish ${index}` :
      null,
  };
  const groupId = createDishProposalGroupId(identity);
  const activeJobId = overrides.activeJobId ?? null;
  const enoughSupporters = overrides.enoughSupporters ?? hasPendingMembers;
  const group = {
    version: dishProposalGroupVersion,
    groupId,
    ...identity,
    resolutionIdentitiesValid: overrides.resolutionIdentitiesValid ?? true,
    hasPendingMembers,
    oldestTrustedServerCreateTime,
    dueAt,
    enoughSupporters,
    autoEligible: overrides.autoEligible ??
      (enoughSupporters && activeJobId === null),
    lastMembershipGeneration: overrides.lastMembershipGeneration ?? index + 1,
    resolutionSequence: overrides.resolutionSequence ?? 0,
    activeJobId,
    activeResolutionType: overrides.activeResolutionType ?? null,
    cycleCutoffGeneration: overrides.cycleCutoffGeneration ?? null,
    cycleCutoffAt: overrides.cycleCutoffAt ?? null,
    indexedAt: overrides.indexedAt ?? new Date(baseTimeMs + 10_000 + index),
  };
  return {
    id: groupId,
    data: {...group, fingerprint: groupFingerprint(group)},
  };
}

function withResolutionIdentityMarker(group, value) {
  const copy = structuredClone(group);
  if (value === "missing") {
    delete copy.data.resolutionIdentitiesValid;
  } else {
    copy.data.resolutionIdentitiesValid = value;
  }
  return copy;
}

function jobFingerprint(job) {
  return dishProposalDocumentFingerprint(dishProposalJobVersion, [
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
    job.completedAt?.toISOString() ?? null,
  ]);
}

function makeActiveGroup(index, options = {}) {
  const resolutionType = options.resolutionType ?? "apply";
  const resolutionSequence = options.resolutionSequence ?? 1;
  const cycleCutoffAt = new Date(baseTimeMs - 1_000);
  const inactive = makeGroup(index, {
    ...options,
    resolutionSequence,
    enoughSupporters: options.enoughSupporters ?? false,
    autoEligible: false,
  });
  const jobId = createDishProposalJobId({
    groupId: inactive.id,
    resolutionSequence,
    resolutionType,
  });
  const group = makeGroup(index, {
    ...options,
    resolutionSequence,
    activeJobId: jobId,
    activeResolutionType: resolutionType,
    cycleCutoffGeneration: options.cycleCutoffGeneration ?? index + 1,
    cycleCutoffAt,
    enoughSupporters: options.enoughSupporters ?? false,
    autoEligible: false,
  });
  const status = options.status ?? "active";
  const isMergeApply = group.data.proposalType === "merge" &&
    resolutionType === "apply";
  const job = {
    version: dishProposalJobVersion,
    jobId,
    groupId: group.id,
    resolutionType,
    proposalType: group.data.proposalType,
    status,
    phase: status === "complete" ?
      "complete" :
      resolutionType === "reject" ?
        "finalize_rejections" :
        group.data.proposalType === "merge" ?
          "validate_targets" :
          "validate_target",
    restaurantId: group.data.restaurantId,
    sourceDishId: group.data.sourceDishId,
    mergeTargetDishId: group.data.mergeTargetDishId,
    normalizedProposedName: group.data.normalizedProposedName,
    resolutionSequence,
    cycleCutoffGeneration: group.data.cycleCutoffGeneration,
    cycleCutoffAt,
    reviewMigrationCursorId: null,
    aggregateState: null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    sourceActiveAggregateWriteGeneration:
      options.sourceActiveAggregateWriteGeneration ??
        (isMergeApply ? 1 : null),
    sourceCompletionAggregateWriteGeneration:
      options.sourceCompletionAggregateWriteGeneration ??
        (isMergeApply ? 2 : null),
    targetActiveAggregateWriteGeneration:
      options.targetActiveAggregateWriteGeneration ??
        (isMergeApply ? 1 : null),
    targetCompletionAggregateWriteGeneration:
      options.targetCompletionAggregateWriteGeneration ??
        (isMergeApply ? 2 : null),
    pointsCursorGeneration: null,
    pointsCursorMemberId: null,
    renameOldValue: null,
    renameNewValue: null,
    shouldAwardPoints: false,
    failureCode: status === "manual_review_required" ? "manual-check" : null,
    createdAt: cycleCutoffAt,
    updatedAt: new Date(baseTimeMs),
    completedAt: status === "complete" ? new Date(baseTimeMs) : null,
  };
  return {
    group,
    job: {
      id: jobId,
      data: {...job, fingerprint: jobFingerprint(job)},
    },
  };
}

function makeMergeLock(fixture, role) {
  const dishId = role === "source" ?
    fixture.group.data.sourceDishId :
    fixture.group.data.mergeTargetDishId;
  const targetDishId = role === "source" ?
    fixture.group.data.mergeTargetDishId : null;
  const createdAt = new Date(baseTimeMs - 2_000);
  const lock = {
    version: dishMergeReviewLockVersion,
    dishId,
    jobId: fixture.job.id,
    groupId: fixture.group.id,
    role,
    state: "active",
    blocksClientReviews: true,
    blocksClientAggregates: true,
    activeAggregateWriteGeneration: 1,
    completionAggregateWriteGeneration: 2,
    targetDishId,
    createdAt,
    indexedAt: createdAt,
  };
  return {
    id: dishId,
    data: {
      ...lock,
      fingerprint: dishProposalDocumentFingerprint(
        dishMergeReviewLockVersion,
        [
          lock.dishId,
          lock.jobId,
          lock.groupId,
          lock.role,
          lock.state,
          lock.blocksClientReviews,
          lock.blocksClientAggregates,
          lock.activeAggregateWriteGeneration,
          lock.completionAggregateWriteGeneration,
          lock.targetDishId,
          lock.createdAt.toISOString(),
        ],
      ),
    },
  };
}

function makeDish(id, overrides = {}) {
  return {
    id,
    data: {
      id,
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant One",
      name: `Dish ${id}`,
      isActive: true,
      mergedIntoDishId: null,
      ...overrides,
    },
  };
}

function makeSupporters(groups) {
  const supporters = [];
  for (const [index, group] of groups.entries()) {
    for (let supporter = 0; supporter < index % 4; supporter += 1) {
      supporters.push({
        id: `${group.id}-supporter-${supporter}`,
        data: {
          groupId: group.id,
          supporterUid: `private-user-${index}-${supporter}`,
          reason: privacyCanaries[0],
          email: privacyCanaries[1],
        },
      });
    }
  }
  return supporters;
}

class FakePrivateDatabase {
  constructor(documents = {}) {
    this.documents = new Map(Object.entries(documents));
    this.transactions = 0;
    this.gets = [];
    this.queries = [];
    this.writes = [];
  }

  set(path, document) {
    this.documents.set(path, structuredClone(document));
  }

  async runTransaction(operation) {
    this.transactions += 1;
    const transaction = {
      getDocument: async (path) => {
        this.gets.push(path);
        const document = this.documents.get(path);
        return document === undefined ? null : structuredClone(document);
      },
      queryDocuments: async (query) => {
        this.queries.push(structuredClone(query));
        return [];
      },
      setDocument: (path, data, options) => {
        this.writes.push({type: "set", path, data, options});
      },
      deleteDocument: (path) => {
        this.writes.push({type: "delete", path});
      },
    };
    return operation(transaction);
  }
}

class TransactionalPrivateDatabase {
  constructor(documents = {}) {
    this.records = new Map(
      Object.entries(documents).map(([path, document]) => [
        path,
        structuredClone(document),
      ]),
    );
    this.transactionTail = Promise.resolve();
    this.committedTransactions = [];
    this.nextTransactionGate = null;
    this.requestedTransactions = 0;
    this.transactionRequestWaiters = [];
  }

  holdNextTransaction() {
    assert.equal(this.nextTransactionGate, null);
    let markStarted;
    let release;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise((resolve) => {
      release = resolve;
    });
    this.nextTransactionGate = {markStarted, released};
    return {started, release};
  }

  document(path) {
    const document = this.records.get(path);
    return document === undefined ? null : structuredClone(document);
  }

  documentsIn(collectionPath) {
    const prefix = `${collectionPath}/`;
    const segmentCount = collectionPath.split("/").length + 1;
    return [...this.records.entries()]
      .filter(([path]) =>
        path.startsWith(prefix) && path.split("/").length === segmentCount)
      .map(([, document]) => structuredClone(document));
  }

  waitForRequestedTransactions(count) {
    if (this.requestedTransactions >= count) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.transactionRequestWaiters.push({count, resolve});
    });
  }

  async runTransaction(operation) {
    this.requestedTransactions += 1;
    const readyWaiters = this.transactionRequestWaiters.filter(
      (waiter) => this.requestedTransactions >= waiter.count,
    );
    this.transactionRequestWaiters = this.transactionRequestWaiters.filter(
      (waiter) => this.requestedTransactions < waiter.count,
    );
    for (const waiter of readyWaiters) waiter.resolve();
    const run = this.transactionTail.then(async () => {
      const gate = this.nextTransactionGate;
      if (gate !== null) {
        this.nextTransactionGate = null;
        gate.markStarted();
        await gate.released;
      }
      const working = new Map(
        [...this.records.entries()].map(([path, document]) => [
          path,
          structuredClone(document),
        ]),
      );
      const operations = [];
      const transaction = {
        getDocument: async (path) => {
          const document = working.get(path);
          return document === undefined ? null : structuredClone(document);
        },
        queryDocuments: async () => [],
        setDocument: (path, data, options) => {
          const existing = working.get(path);
          const nextData = options?.merge === true ?
            {...(existing?.data ?? {}), ...structuredClone(data)} :
            structuredClone(data);
          working.set(path, {
            id: path.slice(path.lastIndexOf("/") + 1),
            data: nextData,
            createTime: existing?.createTime ?? new Date(baseTimeMs),
          });
          operations.push({type: "set", path});
        },
        deleteDocument: (path) => {
          working.delete(path);
          operations.push({type: "delete", path});
        },
      };
      const result = await operation(transaction);
      this.records = working;
      this.committedTransactions.push(operations);
      return result;
    });
    this.transactionTail = run.catch(() => undefined);
    return run;
  }
}

class FakeDiscoveryDatabase {
  constructor(jobs, groups) {
    this.jobs = jobs;
    this.groups = groups;
    this.queries = [];
  }

  async queryDocuments(query) {
    this.queries.push(structuredClone(query));
    if (query.collectionPath === dishProposalJobCollection) {
      return this.jobs.map((document) => structuredClone(document));
    }
    if (query.collectionPath === dishProposalGroupCollection) {
      return this.groups.map((document) => structuredClone(document));
    }
    throw new Error("Unexpected runtime discovery collection.");
  }
}

class FilteringDiscoveryDatabase {
  constructor(jobs, groups) {
    this.jobs = jobs;
    this.groups = groups;
    this.queries = [];
  }

  async queryDocuments(query) {
    this.queries.push(structuredClone(query));
    const source = query.collectionPath === dishProposalJobCollection ?
      this.jobs :
      query.collectionPath === dishProposalGroupCollection ?
        this.groups :
        (() => {
          throw new Error("Unexpected filtering discovery collection.");
        })();
    const matches = source.filter((document) => query.where.every((filter) => {
      const actual = field(document, filter.field);
      if (filter.operator === "==") return actual === filter.value;
      if (filter.operator === "<=") return compare(actual, filter.value) <= 0;
      if (filter.operator === "in") {
        return Array.isArray(filter.value) && filter.value.includes(actual);
      }
      throw new Error("Unsupported filtering discovery operator.");
    }));
    matches.sort((left, right) => {
      for (const order of query.orderBy) {
        const result = compare(field(left, order.field), field(right, order.field));
        if (result !== 0) return order.direction === "desc" ? -result : result;
      }
      return 0;
    });
    return matches.slice(0, query.limit).map((document) =>
      structuredClone(document));
  }
}

function signaledDiscoveryDatabase(jobs, groups) {
  let markDueQueryObserved;
  const dueQueryObserved = new Promise((resolve) => {
    markDueQueryObserved = resolve;
  });
  const database = new FakeDiscoveryDatabase(jobs, groups);
  const queryDocuments = database.queryDocuments.bind(database);
  database.queryDocuments = async (query) => {
    const result = await queryDocuments(query);
    if (query.collectionPath === dishProposalGroupCollection) {
      markDueQueryObserved();
    }
    return result;
  };
  return {database, dueQueryObserved};
}

function resolutionDependencies(privateDatabase) {
  return {
    database: privateDatabase,
    awardApprovedProposalPoints: async () => ({awarded: false}),
  };
}

function actionRequest(group, overrides = {}) {
  return {
    contractVersion: dishProposalActionContractVersion,
    groupId: group.id,
    expectedFingerprint: group.data.fingerprint,
    expectedMembershipGeneration: group.data.lastMembershipGeneration,
    expectedResolutionSequence: group.data.resolutionSequence,
    clientRequestId: "dish-suggestion-action-1",
    ...overrides,
  };
}

function guardedClaimRecorder(calls, jobId = "claimed-job") {
  return async (database, groupId, now) => {
    const group = await database.runTransaction((transaction) =>
      transaction.getDocument(dishProposalGroupPath(groupId)));
    calls.push({groupId, now, guardVisible: group !== null});
    return group === null ?
      {claimed: false, jobId: null, reason: "missing-group"} :
      {claimed: true, jobId, reason: "claimed"};
  };
}

function stepResult(jobId, status = "active") {
  return {
    jobId,
    phase: status === "complete" ? "complete" : "validate_target",
    status,
    processedDocuments: 1,
  };
}

function realClaimHandlerContext(database, stepCalls) {
  return {
    privateDatabase: database,
    resolutionDependencies: resolutionDependencies(database),
    now: () => new Date(baseTimeMs),
    processStep: async (dependencies, jobId, now) => {
      assert.equal(dependencies.database, database);
      stepCalls.push({jobId, now});
      return stepResult(jobId);
    },
  };
}

function assertSingleDurableClaim(database, group, resolutionType) {
  const jobs = database.documentsIn(dishProposalJobCollection);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].data.resolutionType, resolutionType);
  assert.equal(jobs[0].data.groupId, group.id);
  const currentGroup = database.document(dishProposalGroupPath(group.id));
  assert.equal(currentGroup.data.activeJobId, jobs[0].id);
  assert.equal(currentGroup.data.activeResolutionType, resolutionType);
  assert.equal(
    currentGroup.data.resolutionSequence,
    group.data.resolutionSequence + 1,
  );
  assert.equal(
    database.committedTransactions.flat().filter((operation) =>
      operation.type === "set" &&
        operation.path.startsWith(`${dishProposalJobCollection}/`)).length,
    1,
  );
  assert.equal(
    database.documentsIn("bitescore_contribution_point_ledger").length,
    0,
  );
  assert.equal(database.documentsIn("user_profiles").length, 0);
  return jobs[0];
}

async function runRealManualClaimRace({
  index,
  firstHandler,
  secondHandler,
  winningResolutionType,
  repeatedClientRequestId = false,
}) {
  const group = makeGroup(index, {enoughSupporters: false});
  const database = new TransactionalPrivateDatabase({
    [dishProposalGroupPath(group.id)]: group,
  });
  const stepCalls = [];
  const context = realClaimHandlerContext(database, stepCalls);
  assert.equal(Object.hasOwn(context, "claimApply"), false);
  assert.equal(Object.hasOwn(context, "claimReject"), false);
  const firstRequest = actionRequest(group, {
    clientRequestId: "real-claim-race-first",
  });
  const secondRequest = actionRequest(group, {
    clientRequestId: repeatedClientRequestId ?
      firstRequest.clientRequestId :
      "real-claim-race-second",
  });
  const gate = database.holdNextTransaction();
  const first = firstHandler(firstRequest, context);
  await gate.started;
  const second = secondHandler(secondRequest, context);
  gate.release();
  const results = await Promise.all([first, second]);

  assert.equal(results[0].accepted, true);
  assert.equal(results[0].resolutionType, winningResolutionType);
  assert.equal(results[1].accepted, false);
  assert.equal(stepCalls.length, 1);
  assert.equal(stepCalls[0].now.getTime(), baseTimeMs);
  const job = assertSingleDurableClaim(
    database,
    group,
    winningResolutionType,
  );
  assert.equal(stepCalls[0].jobId, job.id);
  return {database, group, results, stepCalls};
}

async function runRealManualVsScheduledRace({
  index,
  manualHandler,
  winningResolutionType,
}) {
  const group = makeGroup(index, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
    ),
  });
  const database = new TransactionalPrivateDatabase({
    [dishProposalGroupPath(group.id)]: group,
  });
  const stepCalls = [];
  const processStep = realClaimHandlerContext(database, stepCalls).processStep;
  const manualContext = {
    privateDatabase: database,
    resolutionDependencies: resolutionDependencies(database),
    now: () => new Date(baseTimeMs),
    processStep,
  };
  const discovery = signaledDiscoveryDatabase([], [group]);
  const scheduledContext = {
    discoveryDatabase: discovery.database,
    privateDatabase: database,
    resolutionDependencies: resolutionDependencies(database),
    now: () => new Date(baseTimeMs),
    processStep,
  };
  assert.equal(Object.hasOwn(manualContext, "claimApply"), false);
  assert.equal(Object.hasOwn(manualContext, "claimReject"), false);
  assert.equal(Object.hasOwn(scheduledContext, "claimApply"), false);

  const gate = database.holdNextTransaction();
  const manual = manualHandler(actionRequest(group), manualContext);
  await gate.started;
  const scheduled = processDishProposalResolutionWorkHandler(scheduledContext);
  await discovery.dueQueryObserved;
  await database.waitForRequestedTransactions(2);
  gate.release();
  const [manualResult, scheduledSummary] = await Promise.all([
    manual,
    scheduled,
  ]);

  assert.equal(manualResult.accepted, true);
  assert.equal(manualResult.resolutionType, winningResolutionType);
  assert.deepEqual(scheduledSummary, {
    selectedExistingJobs: 0,
    selectedDueGroups: 1,
    processedExistingJobs: 0,
    claimedDueGroups: 0,
    processedDueGroups: 0,
    failures: 0,
  });
  assert.equal(stepCalls.length, 1);
  const job = assertSingleDurableClaim(
    database,
    group,
    winningResolutionType,
  );
  assert.equal(stepCalls[0].jobId, job.id);
  return {database, group, manualResult, scheduledSummary};
}

test("Dish Suggestions paging uses the exact shared protocol contract", () => {
  assert.equal(ratingAdminDishSuggestionsPageSize, 25);
  assert.equal(ratingAdminDishSuggestionsEntityKind, "dishSuggestions");
});

test("strict page request, criteria, secret, and cursor shape fail before reads", async () => {
  const database = new FakeDatabase();
  for (const invalidRequest of [
    undefined,
    null,
    [],
    new Date(),
    {},
    Object.assign(Object.create({nonPlain: true}), pageRequest()),
    pageRequest({protocolVersion: "bitestar.page.v0"}),
    pageRequest({pageSize: 24}),
    pageRequest({pageSize: 0}),
    pageRequest({pageSize: 101}),
    pageRequest({pageSize: 25.5}),
    pageRequest({pageSize: Number.MAX_SAFE_INTEGER + 1}),
    pageRequest({criteria: null}),
    pageRequest({criteria: []}),
    pageRequest({criteria: {entityKind: "dishSuggestions", uid: "attacker"}}),
    pageRequest({criteria: {entityKind: "other"}}),
    pageRequest({requestExactCount: "true"}),
    pageRequest({direction: "sideways"}),
    pageRequest({direction: "backward"}),
    pageRequest({clientRequestId: "invalid request id"}),
    pageRequest({clientRequestId: ""}),
    pageRequest({clientRequestId: "x".repeat(129)}),
    pageRequest({direction: "forward"}),
    pageRequest({cursor: "unexpected-first-cursor"}),
    pageRequest({direction: "last", cursor: "unexpected-last-cursor"}),
    pageRequest({direction: "forward", cursor: ""}),
    {...pageRequest(), extra: true},
  ]) {
    await assert.rejects(
      listRatingAdminDishSuggestionsPageHandler(
        invalidRequest,
        pagingContext(database),
      ),
      /invalid/,
    );
  }
  for (const invalidSecret of [
    undefined,
    null,
    42,
    "",
    "short",
    "!".repeat(43),
    "A".repeat(42),
    "A".repeat(44),
  ]) {
    await assert.rejects(
      listRatingAdminDishSuggestionsPageHandler(
        pageRequest(),
        pagingContext(database, {cursorSecret: invalidSecret}),
      ),
      /not configured/,
    );
  }
  assert.equal(database.queries.length, 0);
  assert.equal(database.counts.length, 0);
  assert.equal(database.gets.length, 0);
  assert.equal(database.writeAttempts.length, 0);
});

test("75 groups page first, next, previous, and last in exact 25-row order", async () => {
  const groups = Array.from({length: 75}, (_, index) => makeGroup(index, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs + Math.floor(index / 3),
    ),
  }));
  const sources = {};
  for (const group of groups) {
    sources[`bitescore_dishes/${group.data.sourceDishId}`] =
      makeDish(group.data.sourceDishId);
  }
  sources["bitescore_restaurants/restaurant-1"] = {
    id: "restaurant-1",
    data: {name: "Restaurant One"},
  };
  const database = new FakeDatabase({
    [dishProposalGroupCollection]: [...groups].reverse(),
    [dishProposalSupporterCollection]: makeSupporters(groups),
  }, sources);

  const first = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest(),
    pagingContext(database),
  );
  const second = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest({
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "dish-suggestions-request-2",
    }),
    pagingContext(database),
  );
  const third = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest({
      direction: "forward",
      cursor: second.nextCursor,
      clientRequestId: "dish-suggestions-request-3",
    }),
    pagingContext(database),
  );
  const previous = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest({
      direction: "backward",
      cursor: third.previousCursor,
      clientRequestId: "dish-suggestions-request-previous",
    }),
    pagingContext(database),
  );
  const last = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest({
      direction: "last",
      clientRequestId: "dish-suggestions-request-last",
    }),
    pagingContext(database),
  );

  const expectedIds = [...groups]
    .sort((left, right) =>
      compare(
        left.data.oldestTrustedServerCreateTime,
        right.data.oldestTrustedServerCreateTime,
      ) || left.id.localeCompare(right.id))
    .map((group) => group.id);
  assert.deepEqual(first.items.map((item) => item.groupId), expectedIds.slice(0, 25));
  assert.deepEqual(second.items.map((item) => item.groupId), expectedIds.slice(25, 50));
  assert.deepEqual(third.items.map((item) => item.groupId), expectedIds.slice(50));
  assert.deepEqual(previous.items.map((item) => item.groupId), expectedIds.slice(25, 50));
  assert.deepEqual(last.items.map((item) => item.groupId), expectedIds.slice(50));
  assert.deepEqual(
    [first.currentPageNumber, second.currentPageNumber, third.currentPageNumber],
    [1, 2, 3],
  );
  assert.deepEqual(first.total, {state: "exact", value: 75});
  assert.deepEqual(second.total, {state: "exact", value: 75});
  assert.deepEqual(third.total, {state: "exact", value: 75});
  assert.equal(first.hasPrevious, false);
  assert.equal(first.hasNext, true);
  assert.equal(second.hasPrevious, true);
  assert.equal(second.hasNext, true);
  assert.equal(third.hasPrevious, true);
  assert.equal(third.hasNext, false);
  assert.equal(last.items.length, 25);
  assert.equal(last.hasNext, false);
  assert.equal(first.nextCursor.includes(expectedIds[24]), false);
  for (const page of [first, second, third, previous, last]) {
    assert.equal(page.capabilities.next, page.hasNext);
    assert.equal(page.capabilities.previous, page.hasPrevious);
    assert.equal(page.capabilities.first, page.currentPageNumber > 1);
    assert.equal(page.capabilities.last, page.currentPageNumber < 3);
    assert.equal(page.hasNext, page.currentPageNumber < 3);
    assert.equal(page.hasPrevious, page.currentPageNumber > 1);
    assert.equal(
      Object.hasOwn(page, "nextCursor"),
      page.hasNext,
    );
    assert.equal(
      Object.hasOwn(page, "previousCursor"),
      page.hasPrevious,
    );
  }

  assert.equal(database.queries.every((query) => query.limit <= 26), true);
  assert.equal(database.queries.length, 5);
  assert.deepEqual(database.queries[0].orders, [
    {field: "oldestTrustedServerCreateTime", direction: "asc"},
    {field: "__name__", direction: "asc"},
  ]);
  assert.equal(database.queries.at(-1).limit, 25);
  assert.equal(database.queries.at(-1).limitToLast, true);
  assert.equal(database.gets.length, 15);
  assert.equal(database.gets.every((paths) => paths.length <= 25), true);
  assert.equal(database.counts.every((query) =>
    query.collectionPath === dishProposalGroupCollection ||
      query.collectionPath === dishProposalSupporterCollection), true);
  assert.equal(database.counts.filter((query) =>
    query.collectionPath === dishProposalGroupCollection).length, 5);
  assert.equal(database.counts.filter((query) =>
    query.collectionPath === dishProposalSupporterCollection).length, 125);
  assert.equal(database.writeAttempts.length, 0);
});

test("opaque cursors are tamper-evident, caller-bound, and direction-bound", async () => {
  const groups = Array.from({length: 26}, (_, index) => makeGroup(index));
  const database = new FakeDatabase({
    [dishProposalGroupCollection]: groups,
    [dishProposalSupporterCollection]: [],
  });
  const first = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest(),
    pagingContext(database),
  );
  const readsAfterFirst = database.queries.length + database.counts.length;
  const finalCharacter = first.nextCursor.endsWith("A") ? "B" : "A";
  const tampered = first.nextCursor.slice(0, -1) + finalCharacter;

  await assert.rejects(
    listRatingAdminDishSuggestionsPageHandler(
      pageRequest({direction: "forward", cursor: tampered}),
      pagingContext(database),
    ),
    /invalid or expired/,
  );
  await assert.rejects(
    listRatingAdminDishSuggestionsPageHandler(
      pageRequest({direction: "forward", cursor: first.nextCursor}),
      pagingContext(database, {
        now: () => baseTimeMs + 30 * 60 * 1_000 + 1,
      }),
    ),
    /invalid or expired/,
  );
  await assert.rejects(
    listRatingAdminDishSuggestionsPageHandler(
      pageRequest({direction: "forward", cursor: first.nextCursor}),
      pagingContext(database, {adminUid: "admin-2"}),
    ),
    /invalid or expired/,
  );
  await assert.rejects(
    listRatingAdminDishSuggestionsPageHandler(
      pageRequest({direction: "backward", cursor: first.nextCursor}),
      pagingContext(database),
    ),
    /invalid or expired/,
  );
  const codec = new OpaqueCursorCodec({
    key: Buffer.from(cursorSecret, "base64url"),
    clock: () => baseTimeMs,
    nonceSource: () => new Uint8Array(12).fill(9),
  });
  const expectedCursorInput = {
    queryFingerprint: createQueryFingerprint({
      entityKind: ratingAdminDishSuggestionsEntityKind,
    }),
    source: "ratingAdminDishSuggestions",
    searchMode: ratingAdminDishSuggestionsEntityKind,
    pageSize: ratingAdminDishSuggestionsPageSize,
    purpose: "forward",
    sortTuple: [
      groups[24].data.oldestTrustedServerCreateTime.getTime(),
      groups[24].id,
      2,
    ],
    callerBinding: createHash("sha256")
      .update(JSON.stringify(["ratingAdmin", "admin-1"]))
      .digest("hex"),
  };
  const boundCursorVariants = [
    {...expectedCursorInput, queryFingerprint: "f".repeat(64)},
    {...expectedCursorInput, source: "wrongSource"},
    {...expectedCursorInput, searchMode: "wrongMode"},
    {...expectedCursorInput, pageSize: 26},
    {
      ...expectedCursorInput,
      callerBinding: createHash("sha256").update("wrong-caller").digest("hex"),
    },
    {...expectedCursorInput, purpose: "backward"},
    {...expectedCursorInput, sortTuple: [baseTimeMs, groups[24].id]},
    {...expectedCursorInput, sortTuple: [baseTimeMs, groups[24].id, 0]},
    {...expectedCursorInput, sortTuple: [baseTimeMs, "unsafe/group", 2]},
  ];
  for (const variant of boundCursorVariants) {
    await assert.rejects(
      listRatingAdminDishSuggestionsPageHandler(
        pageRequest({direction: "forward", cursor: codec.encode(variant)}),
        pagingContext(database),
      ),
      /invalid or expired/,
    );
  }
  assert.equal(
    database.queries.length + database.counts.length,
    readsAfterFirst,
  );
  assert.equal(database.writeAttempts.length, 0);
});

test("a stale cursor beyond the exact last page signals out-of-range", async () => {
  const groups = Array.from({length: 51}, (_, index) => makeGroup(60 + index));
  const database = new FakeDatabase({
    [dishProposalGroupCollection]: groups,
    [dishProposalSupporterCollection]: [],
  });
  const first = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest(),
    pagingContext(database),
  );
  const second = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest({
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "stale-page-anchor-2",
    }),
    pagingContext(database),
  );
  assert.equal(second.currentPageNumber, 2);
  assert.equal(typeof second.nextCursor, "string");

  database.collections[dishProposalGroupCollection] = [groups[0]];
  const queriesBeforeStaleRequest = database.queries.length;
  await assert.rejects(
    listRatingAdminDishSuggestionsPageHandler(
      pageRequest({
        direction: "forward",
        cursor: second.nextCursor,
        clientRequestId: "stale-page-anchor-3",
      }),
      pagingContext(database),
    ),
    (error) => error.code === "out-of-range" &&
      !String(error).includes(groups[50].id),
  );
  assert.equal(database.queries.length, queriesBeforeStaleRequest);

  const nominalSecondPageGroups = Array.from(
    {length: 26},
    (_, index) => makeGroup(1_000 + index, {
      oldestTrustedServerCreateTime: new Date(baseTimeMs - 10_000 + index),
    }),
  );
  database.collections[dishProposalGroupCollection] = nominalSecondPageGroups;
  const queriesBeforeEmptyAnchor = database.queries.length;
  await assert.rejects(
    listRatingAdminDishSuggestionsPageHandler(
      pageRequest({
        direction: "forward",
        cursor: first.nextCursor,
        clientRequestId: "stale-empty-second-page-anchor",
      }),
      pagingContext(database),
    ),
    (error) => error.code === "out-of-range" &&
      error.message === "The Dish Suggestions page is no longer available.",
  );
  assert.equal(database.queries.length, queriesBeforeEmptyAnchor + 1);
});

test("queue visibility, safe projection, missing entities, and counts fail closed", async () => {
  const idle = makeGroup(100, {
    enoughSupporters: false,
  });
  const applying = makeActiveGroup(101, {
    status: "active",
    sourceDishId: "duplicate-name-a",
  });
  const rejecting = makeActiveGroup(102, {
    status: "active",
    resolutionType: "reject",
    sourceDishId: "duplicate-name-b",
  });
  const retryable = makeActiveGroup(103, {
    status: "retryable",
  });
  const manual = makeActiveGroup(104, {
    status: "manual_review_required",
    sourceDishId: "source-private",
    normalizedProposedName: "new-safe-name",
    oldestTrustedServerCreateTime: null,
    dueAt: null,
    hasPendingMembers: false,
    enoughSupporters: false,
  });
  const merge = makeGroup(105, {
    proposalType: "merge",
    sourceDishId: "merge-source",
    mergeTargetDishId: "merge-target",
    enoughSupporters: false,
  });
  const missing = makeGroup(106, {
    proposalType: "merge",
    sourceDishId: "missing-source",
    mergeTargetDishId: "missing-target",
    enoughSupporters: false,
  });
  const activeFixtures = [applying, rejecting, retryable, manual];
  const groups = [
    idle,
    ...activeFixtures.map((fixture) => fixture.group),
    merge,
    missing,
  ];
  const database = new FakeDatabase({
    [dishProposalGroupCollection]: groups,
    [dishProposalSupporterCollection]: [
      {id: "supporter-1", data: {
        groupId: manual.group.id,
        uid: "private-user",
        payload: privacyCanaries,
      }},
      {id: "supporter-2", data: {
        groupId: manual.group.id,
        nested: {secret: privacyCanaries[5]},
      }},
    ],
  }, {
    ...Object.fromEntries(activeFixtures.map((fixture) => [
      dishProposalJobPath(fixture.job.id),
      fixture.job,
    ])),
    "bitescore_dishes/duplicate-name-a": makeDish("duplicate-name-a", {
      name: "Duplicate Dish Name",
    }),
    "bitescore_dishes/duplicate-name-b": makeDish("duplicate-name-b", {
      name: "Duplicate Dish Name",
    }),
    "bitescore_dishes/merge-source": makeDish("merge-source", {
      name: "Merge Source",
    }),
    "bitescore_dishes/merge-target": makeDish("merge-target", {
      name: "Merge Target",
    }),
    "bitescore_dishes/source-private": makeDish("source-private", {
      proposalReason: privacyCanaries[0],
      ownerEmail: privacyCanaries[1],
      phone: privacyCanaries[2],
      token: privacyCanaries[3],
      nested: {stripe: privacyCanaries[4]},
    }),
    "bitescore_restaurants/restaurant-1": {
      id: "restaurant-1",
      data: {
        name: "Restaurant One",
        privateEmail: privacyCanaries[1],
        secret: privacyCanaries[4],
      },
    },
  });

  const page = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest(),
    pagingContext(database),
  );
  assert.equal(page.items.length, 7);
  assert.deepEqual(new Set(page.items.map((item) => item.groupId)),
    new Set(groups.map((group) => group.id)));
  const stateByGroup = new Map(page.items.map((item) => [
    item.groupId,
    item.resolutionState,
  ]));
  assert.equal(stateByGroup.get(applying.group.id), "applying");
  assert.equal(stateByGroup.get(rejecting.group.id), "rejecting");
  assert.equal(stateByGroup.get(retryable.group.id), "retryable");
  assert.equal(stateByGroup.get(manual.group.id), "manual_review_required");
  const manualItem = page.items.find((item) => item.groupId === manual.group.id);
  assert.equal(manualItem.supporterCount, 2);
  assert.equal(manualItem.proposedDisplayName, "new-safe-name");
  assert.equal(manualItem.hasPendingMembers, false);
  assert.equal(manualItem.oldestTrustedProposalTimeMillis, null);
  assert.deepEqual(manualItem.sourceDish, {
    id: "source-private",
    restaurantId: "restaurant-1",
    restaurantName: "Restaurant One",
    name: "Dish source-private",
    isActive: true,
    mergedIntoDishId: null,
  });
  assert.deepEqual(manualItem.restaurant, {
    id: "restaurant-1",
    name: "Restaurant One",
  });
  const duplicateNameItems = [applying, rejecting].map((fixture) =>
    page.items.find((item) => item.groupId === fixture.group.id));
  assert.deepEqual(
    duplicateNameItems.map((item) => item.sourceDish.name),
    ["Duplicate Dish Name", "Duplicate Dish Name"],
  );
  assert.deepEqual(
    duplicateNameItems.map((item) => item.sourceDish.id),
    ["duplicate-name-a", "duplicate-name-b"],
  );
  const mergeItem = page.items.find((item) => item.groupId === merge.id);
  assert.equal(mergeItem.sourceDish.id, "merge-source");
  assert.equal(mergeItem.mergeTargetDish.id, "merge-target");
  assert.equal(mergeItem.proposedDisplayName, null);
  const missingItem = page.items.find((item) => item.groupId === missing.id);
  assert.equal(missingItem.sourceDish, null);
  assert.equal(missingItem.mergeTargetDish, null);
  const idleItem = page.items.find((item) => item.groupId === idle.id);
  assert.equal(idleItem.hasPendingMembers, true);
  assert.equal(
    idleItem.oldestTrustedProposalTimeMillis,
    idle.data.oldestTrustedServerCreateTime.getTime(),
  );
  assert.equal(idleItem.resolutionState, "idle");

  const serialized = JSON.stringify(page);
  for (const canary of privacyCanaries) {
    assert.equal(serialized.includes(canary), false, canary);
  }
  assert.deepEqual(database.queries[0].filters, [{
    field: "resolutionIdentitiesValid",
    operation: "==",
    value: true,
  }]);
  assert.equal(database.writeAttempts.length, 0);
});

test("queue preserves valid long rename display names without truncation", async () => {
  const normalizedProposedName = "a".repeat(2_000);
  const group = makeGroup(108, {
    normalizedProposedName,
    enoughSupporters: false,
  });
  const database = new FakeDatabase({
    [dishProposalGroupCollection]: [group],
    [dishProposalSupporterCollection]: [],
  }, {
    [`bitescore_dishes/${group.data.sourceDishId}`]: makeDish(
      group.data.sourceDishId,
    ),
    "bitescore_restaurants/restaurant-1": {
      id: "restaurant-1",
      data: {name: "Restaurant One"},
    },
  });

  const page = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest(),
    pagingContext(database),
  );

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].proposedDisplayName, normalizedProposedName);
  assert.equal(database.writeAttempts.length, 0);
});

test("queue projects optional rename names without changing group state", async () => {
  const emptyRename = makeGroup(110, {
    normalizedProposedName: "",
    enoughSupporters: false,
  });
  const namedRename = makeGroup(111, {
    normalizedProposedName: "crispy garlic knots",
    enoughSupporters: false,
  });
  const merge = makeGroup(112, {
    proposalType: "merge",
    sourceDishId: "projection-merge-source",
    mergeTargetDishId: "projection-merge-target",
    enoughSupporters: false,
  });
  const groups = [emptyRename, namedRename, merge];
  const database = new FakeDatabase({
    [dishProposalGroupCollection]: groups,
    [dishProposalSupporterCollection]: [],
  }, {
    ...Object.fromEntries(groups.map((group) => [
      `bitescore_dishes/${group.data.sourceDishId}`,
      makeDish(group.data.sourceDishId),
    ])),
    "bitescore_dishes/projection-merge-target": makeDish(
      "projection-merge-target",
    ),
    "bitescore_restaurants/restaurant-1": {
      id: "restaurant-1",
      data: {name: "Restaurant One"},
    },
  });

  const page = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest(),
    pagingContext(database),
  );
  const itemById = new Map(page.items.map((item) => [item.groupId, item]));
  const emptyItem = itemById.get(emptyRename.id);

  assert.equal(page.items.length, 3);
  assert.deepEqual(page.total, {state: "exact", value: 3});
  assert.equal(emptyItem.proposedDisplayName, null);
  assert.equal(page.items.some((item) => item.proposedDisplayName === ""), false);
  assert.equal(
    itemById.get(namedRename.id).proposedDisplayName,
    "crispy garlic knots",
  );
  assert.equal(itemById.get(merge.id).proposedDisplayName, null);
  assert.deepEqual({
    groupId: emptyItem.groupId,
    fingerprint: emptyItem.fingerprint,
    membershipGeneration: emptyItem.membershipGeneration,
    resolutionSequence: emptyItem.resolutionSequence,
    sourceDishId: emptyItem.sourceDishId,
    restaurantId: emptyItem.restaurantId,
    hasPendingMembers: emptyItem.hasPendingMembers,
    oldestTrustedProposalTimeMillis:
      emptyItem.oldestTrustedProposalTimeMillis,
    dueAtMillis: emptyItem.dueAtMillis,
    dueNow: emptyItem.dueNow,
    enoughSupporters: emptyItem.enoughSupporters,
    autoEligible: emptyItem.autoEligible,
    supporterCount: emptyItem.supporterCount,
    resolutionState: emptyItem.resolutionState,
  }, {
    groupId: emptyRename.id,
    fingerprint: emptyRename.data.fingerprint,
    membershipGeneration: emptyRename.data.lastMembershipGeneration,
    resolutionSequence: emptyRename.data.resolutionSequence,
    sourceDishId: emptyRename.data.sourceDishId,
    restaurantId: emptyRename.data.restaurantId,
    hasPendingMembers: emptyRename.data.hasPendingMembers,
    oldestTrustedProposalTimeMillis:
      emptyRename.data.oldestTrustedServerCreateTime.getTime(),
    dueAtMillis: emptyRename.data.dueAt.getTime(),
    dueNow: false,
    enoughSupporters: false,
    autoEligible: false,
    supporterCount: 0,
    resolutionState: "idle",
  });
  assert.equal(database.writeAttempts.length, 0);
});

test("mixed 25-item queue page survives one empty rename name", async () => {
  const groups = Array.from({length: 25}, (_, index) => {
    const sourceDishId = `mixed-dish-${index}`;
    if (index === 0) {
      return makeGroup(200 + index, {
        sourceDishId,
        normalizedProposedName: "",
        enoughSupporters: false,
      });
    }
    if (index % 6 === 0) {
      return makeGroup(200 + index, {
        proposalType: "merge",
        sourceDishId,
        mergeTargetDishId: "mixed-dish-1",
        enoughSupporters: false,
      });
    }
    return makeGroup(200 + index, {
      sourceDishId,
      normalizedProposedName: `crispy garlic knots ${index}`,
      enoughSupporters: false,
    });
  });
  const database = new FakeDatabase({
    [dishProposalGroupCollection]: [...groups].reverse(),
    [dishProposalSupporterCollection]: [],
  }, {
    ...Object.fromEntries(groups.map((group) => [
      `bitescore_dishes/${group.data.sourceDishId}`,
      makeDish(group.data.sourceDishId),
    ])),
    "bitescore_restaurants/restaurant-1": {
      id: "restaurant-1",
      data: {name: "Restaurant One"},
    },
  });

  const page = await listRatingAdminDishSuggestionsPageHandler(
    pageRequest(),
    pagingContext(database),
  );
  const itemById = new Map(page.items.map((item) => [item.groupId, item]));

  assert.equal(page.items.length, 25);
  assert.deepEqual(page.total, {state: "exact", value: 25});
  assert.equal(page.hasNext, false);
  assert.equal(itemById.get(groups[0].id).proposedDisplayName, null);
  assert.equal(
    page.items.filter((item) =>
      item.proposalType === "rename" && item.proposedDisplayName === null
    ).length,
    1,
  );
  for (const group of groups) {
    const item = itemById.get(group.id);
    assert.ok(item);
    assert.equal(item.fingerprint, group.data.fingerprint);
    assert.equal(
      item.membershipGeneration,
      group.data.lastMembershipGeneration,
    );
    assert.equal(item.resolutionSequence, group.data.resolutionSequence);
    assert.equal(item.sourceDishId, group.data.sourceDishId);
    assert.equal(item.restaurantId, group.data.restaurantId);
    assert.equal(
      item.proposedDisplayName,
      group.data.proposalType === "rename" &&
        group.data.normalizedProposedName.length > 0 ?
        group.data.normalizedProposedName :
        null,
    );
  }
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0].limit, 26);
  assert.equal(database.gets.length, 3);
  assert.equal(database.gets.every((paths) => paths.length <= 25), true);
  assert.equal(database.counts.length, 26);
  assert.equal(database.writeAttempts.length, 0);
});

test("unsafe or oversized queue identities fail before enrichment without disclosure", async () => {
  const unsafeIdentities = [
    "unsafe/raw-entity-id-canary",
    `oversized-${"x".repeat(1_501)}`,
  ];
  for (const unsafeIdentity of unsafeIdentities) {
    const group = makeGroup(109, {sourceDishId: unsafeIdentity});
    const database = new FakeDatabase({
      [dishProposalGroupCollection]: [group],
      [dishProposalSupporterCollection]: [],
    });
    let failure;
    try {
      await listRatingAdminDishSuggestionsPageHandler(
        pageRequest(),
        pagingContext(database),
      );
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error);
    assert.equal(String(failure).includes(unsafeIdentity), false);
    assert.equal(database.queries.length, 1);
    assert.equal(database.gets.length, 0);
    assert.equal(database.counts.length, 1);
    assert.equal(
      database.counts[0].collectionPath,
      dishProposalGroupCollection,
    );
    assert.equal(database.writeAttempts.length, 0);
  }
});

test("25 and 100 invalid queue groups cannot starve the valid group", async () => {
  for (const backlogSize of [25, 100]) {
    const invalidGroups = Array.from({length: backlogSize}, (_, index) =>
      withResolutionIdentityMarker(
        makeGroup(120 + index, {
          sourceDishId: `invalid-backlog-${backlogSize}-${index}`,
          oldestTrustedServerCreateTime: new Date(baseTimeMs - 1_000 + index),
        }),
        index % 2 === 0 ? false : "missing",
      ));
    const validSourceDishId = `valid-after-${backlogSize}-invalid-groups`;
    const valid = makeGroup(250 + backlogSize, {
      sourceDishId: validSourceDishId,
      oldestTrustedServerCreateTime: new Date(baseTimeMs + 1_000),
    });
    const database = new FakeDatabase({
      [dishProposalGroupCollection]: [...invalidGroups, valid],
      [dishProposalSupporterCollection]: [],
    }, {
      [`bitescore_dishes/${validSourceDishId}`]: makeDish(validSourceDishId),
      "bitescore_restaurants/restaurant-1": {
        id: "restaurant-1",
        data: {name: "Restaurant One"},
      },
    });

    const page = await listRatingAdminDishSuggestionsPageHandler(
      pageRequest(),
      pagingContext(database),
    );
    assert.deepEqual(page.items.map((item) => item.groupId), [valid.id]);
    assert.deepEqual(page.total, {state: "exact", value: 1});
    assert.deepEqual(database.counts[0].filters, [{
      field: "resolutionIdentitiesValid",
      operation: "==",
      value: true,
    }]);
    assert.deepEqual(database.queries[0].filters, [{
      field: "resolutionIdentitiesValid",
      operation: "==",
      value: true,
    }]);
    assert.equal(database.queries[0].limit, 26);
  }
});

test("25 and 100 invalid due groups cannot starve the valid scheduled claim", async () => {
  for (const backlogSize of [25, 100]) {
    const invalidGroups = Array.from({length: backlogSize}, (_, index) =>
      withResolutionIdentityMarker(
        makeGroup(360 + index, {
          sourceDishId: `invalid-due-backlog-${backlogSize}-${index}`,
          oldestTrustedServerCreateTime: new Date(
            baseTimeMs - dishProposalAutomaticDelayMilliseconds -
              10_000 + index,
          ),
        }),
        index % 2 === 0 ? false : "missing",
      ));
    const valid = makeGroup(500 + backlogSize, {
      sourceDishId: `valid-scheduled-after-${backlogSize}-invalid-groups`,
      oldestTrustedServerCreateTime: new Date(
        baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
      ),
    });
    const discovery = new FilteringDiscoveryDatabase(
      [],
      [...invalidGroups, valid],
    );
    const privateDatabase = new FakePrivateDatabase({
      [dishProposalGroupPath(valid.id)]: valid,
    });
    const claimCalls = [];
    const stepCalls = [];

    const summary = await processDishProposalResolutionWorkHandler({
      discoveryDatabase: discovery,
      privateDatabase,
      resolutionDependencies: resolutionDependencies(privateDatabase),
      now: () => new Date(baseTimeMs),
      claimApply: guardedClaimRecorder(claimCalls),
      processStep: async (dependencies, jobId) => {
        void dependencies;
        stepCalls.push(jobId);
        return stepResult(jobId);
      },
    });

    assert.deepEqual(claimCalls.map((call) => call.groupId), [valid.id]);
    assert.equal(stepCalls.length, 1);
    assert.equal(summary.claimedDueGroups, 1);
    assert.deepEqual(discovery.queries[1].where[0], {
      field: "resolutionIdentitiesValid",
      operator: "==",
      value: true,
    });
    assert.equal(discovery.queries[1].limit, 25);
  }
});

test("action requests are strict and reject every malformed identity before reads", async () => {
  const group = makeGroup(200);
  const database = new FakePrivateDatabase({
    [dishProposalGroupPath(group.id)]: group,
  });
  let claimCalls = 0;
  let stepCalls = 0;
  const context = {
    privateDatabase: database,
    resolutionDependencies: resolutionDependencies(database),
    claimApply: async () => {
      claimCalls += 1;
      return {claimed: true, jobId: "unexpected", reason: "claimed"};
    },
    processStep: async () => {
      stepCalls += 1;
      return stepResult("unexpected");
    },
  };
  const valid = actionRequest(group);
  const invalidRequests = [
    undefined,
    null,
    [],
    {...valid, unexpected: true},
    {...valid, contractVersion: "wrong"},
    {...valid, groupId: "not-a-group-id"},
    {...valid, groupId: "../unsafe-group-path"},
    {...valid, expectedFingerprint: "not-a-fingerprint"},
    {...valid, expectedMembershipGeneration: -1},
    {...valid, expectedMembershipGeneration: 1.5},
    {...valid, expectedResolutionSequence: Number.MAX_SAFE_INTEGER + 1},
    {...valid, clientRequestId: "contains whitespace"},
  ];
  for (const request of invalidRequests) {
    await assert.rejects(
      applyRatingAdminDishSuggestionGroupHandler(request, context),
      (error) => error.code === "invalid-argument",
    );
  }
  assert.equal(database.transactions, 0);
  assert.equal(claimCalls, 0);
  assert.equal(stepCalls, 0);
  assert.equal(database.writes.length, 0);
});

test("manual Apply and Reject use the exact optimistic gate and one bounded step", async () => {
  const group = makeGroup(201, {enoughSupporters: false});
  assert.ok(group.data.dueAt.getTime() > baseTimeMs);
  for (const [handler, claimKey, expectedStatus, resolutionType] of [
    [
      applyRatingAdminDishSuggestionGroupHandler,
      "claimApply",
      "applying",
      "apply",
    ],
    [
      rejectRatingAdminDishSuggestionGroupHandler,
      "claimReject",
      "rejecting",
      "reject",
    ],
  ]) {
    const database = new FakePrivateDatabase({
      [dishProposalGroupPath(group.id)]: group,
    });
    const claimCalls = [];
    const processCalls = [];
    const context = {
      privateDatabase: database,
      resolutionDependencies: resolutionDependencies(database),
      now: () => new Date(baseTimeMs),
      [claimKey]: guardedClaimRecorder(claimCalls),
      processStep: async (dependencies, jobId, now) => {
        processCalls.push({dependencies, jobId, now});
        return stepResult(jobId);
      },
    };
    const result = await handler(actionRequest(group), context);

    assert.deepEqual(result, {
      contractVersion: dishProposalActionResultContractVersion,
      accepted: true,
      status: expectedStatus,
      resolutionType,
      processing: true,
      complete: false,
      manualReviewRequired: false,
      messageCategory: "accepted_processing",
    });
    assert.equal(claimCalls.length, 1);
    assert.equal(claimCalls[0].groupId, group.id);
    assert.equal(claimCalls[0].guardVisible, true);
    assert.equal(claimCalls[0].now.getTime(), baseTimeMs);
    assert.equal(processCalls.length, 1);
    assert.equal(processCalls[0].jobId, "claimed-job");
    assert.equal(processCalls[0].now.getTime(), baseTimeMs);
    assert.equal(database.writes.length, 0);
  }
});

test("manual optimistic gate returns stale or not-actionable without a job step", async () => {
  const group = makeGroup(202);
  const staleRequests = [
    actionRequest(group, {expectedFingerprint: "f".repeat(64)}),
    actionRequest(group, {
      expectedMembershipGeneration: group.data.lastMembershipGeneration + 1,
    }),
    actionRequest(group, {
      expectedResolutionSequence: group.data.resolutionSequence + 1,
    }),
  ];
  for (const request of staleRequests) {
    const database = new FakePrivateDatabase({
      [dishProposalGroupPath(group.id)]: group,
    });
    const claimCalls = [];
    let stepCalls = 0;
    const result = await applyRatingAdminDishSuggestionGroupHandler(request, {
      privateDatabase: database,
      resolutionDependencies: resolutionDependencies(database),
      claimApply: guardedClaimRecorder(claimCalls),
      processStep: async (dependencies, jobId) => {
        void dependencies;
        stepCalls += 1;
        return stepResult(jobId);
      },
    });
    assert.deepEqual(result, {
      contractVersion: dishProposalActionResultContractVersion,
      accepted: false,
      status: "stale",
      resolutionType: null,
      processing: false,
      complete: false,
      manualReviewRequired: false,
      messageCategory: "stale_group",
    });
    assert.equal(claimCalls.length, 1);
    assert.equal(claimCalls[0].guardVisible, false);
    assert.equal(stepCalls, 0);
  }

  const missingDatabase = new FakePrivateDatabase();
  const missingClaimCalls = [];
  const missing = await rejectRatingAdminDishSuggestionGroupHandler(
    actionRequest(group),
    {
      privateDatabase: missingDatabase,
      resolutionDependencies: resolutionDependencies(missingDatabase),
      claimReject: guardedClaimRecorder(missingClaimCalls),
      processStep: async () => {
        throw new Error("A missing group must not receive a step.");
      },
    },
  );
  assert.equal(missing.status, "not_actionable");
  assert.equal(missing.accepted, false);
  assert.equal(missingClaimCalls[0].guardVisible, false);
});

test("active and malformed private action state cannot be overwritten", async () => {
  const applying = makeActiveGroup(203, {status: "active"});
  const rejecting = makeActiveGroup(204, {
    status: "active",
    resolutionType: "reject",
  });
  const manual = makeActiveGroup(205, {status: "manual_review_required"});
  for (const [fixture, handler, expectedStatus] of [
    [applying, rejectRatingAdminDishSuggestionGroupHandler, "applying"],
    [rejecting, applyRatingAdminDishSuggestionGroupHandler, "rejecting"],
    [manual, applyRatingAdminDishSuggestionGroupHandler,
      "manual_review_required"],
  ]) {
    const database = new FakePrivateDatabase({
      [dishProposalGroupPath(fixture.group.id)]: fixture.group,
      [dishProposalJobPath(fixture.job.id)]: fixture.job,
    });
    const claimCalls = [];
    let stepCalls = 0;
    const claim = guardedClaimRecorder(claimCalls);
    const result = await handler(actionRequest(fixture.group), {
      privateDatabase: database,
      resolutionDependencies: resolutionDependencies(database),
      claimApply: claim,
      claimReject: claim,
      processStep: async (dependencies, jobId) => {
        void dependencies;
        stepCalls += 1;
        return stepResult(jobId);
      },
    });
    assert.equal(result.accepted, false);
    assert.equal(result.status, expectedStatus);
    assert.equal(result.resolutionType, fixture.job.data.resolutionType);
    assert.equal(claimCalls[0].guardVisible, false);
    assert.equal(stepCalls, 0);
    assert.equal(database.writes.length, 0);
  }

  const validGroup = makeGroup(206);
  const malformedGroup = structuredClone(validGroup);
  malformedGroup.data.fingerprint = "0".repeat(64);
  const malformedDatabase = new FakePrivateDatabase({
    [dishProposalGroupPath(validGroup.id)]: malformedGroup,
  });
  await assert.rejects(
    applyRatingAdminDishSuggestionGroupHandler(
      actionRequest(validGroup),
      {
        privateDatabase: malformedDatabase,
        resolutionDependencies: resolutionDependencies(malformedDatabase),
        claimApply: guardedClaimRecorder([]),
        processStep: async () => stepResult("unexpected"),
      },
    ),
    (error) => error.code === "failed-precondition",
  );
  assert.equal(malformedDatabase.writes.length, 0);
});

test("actions require canonical marked identities but do not own rename limits", async () => {
  const unsafePath = makeGroup(207, {sourceDishId: "dish/unsafe"});
  const markerFalse = withResolutionIdentityMarker(makeGroup(209), false);
  const markerMissing = withResolutionIdentityMarker(makeGroup(210), "missing");
  const oversizedName = makeGroup(208, {
    normalizedProposedName: "x".repeat(501),
  });
  for (const invalidGroup of [unsafePath, markerFalse, markerMissing]) {
    for (const [handler, claimKey] of [
      [applyRatingAdminDishSuggestionGroupHandler, "claimApply"],
      [rejectRatingAdminDishSuggestionGroupHandler, "claimReject"],
    ]) {
      const database = new FakePrivateDatabase({
        [dishProposalGroupPath(invalidGroup.id)]: invalidGroup,
      });
      const claimCalls = [];
      let stepCalls = 0;
      await assert.rejects(
        handler(actionRequest(invalidGroup), {
          privateDatabase: database,
          resolutionDependencies: resolutionDependencies(database),
          [claimKey]: guardedClaimRecorder(claimCalls),
          processStep: async () => {
            stepCalls += 1;
            return stepResult("unexpected");
          },
        }),
        (error) => error.code === "failed-precondition",
      );
      assert.equal(claimCalls.length, 0);
      assert.equal(stepCalls, 0);
      assert.equal(database.writes.length, 0);
    }
  }

  const oversizedDatabase = new FakePrivateDatabase({
    [dishProposalGroupPath(oversizedName.id)]: oversizedName,
  });
  const oversizedClaims = [];
  let oversizedSteps = 0;
  const oversizedResult = await applyRatingAdminDishSuggestionGroupHandler(
    actionRequest(oversizedName),
    {
      privateDatabase: oversizedDatabase,
      resolutionDependencies: resolutionDependencies(oversizedDatabase),
      claimApply: guardedClaimRecorder(oversizedClaims),
      processStep: async (dependencies, jobId) => {
        void dependencies;
        oversizedSteps += 1;
        return stepResult(jobId);
      },
    },
  );
  assert.equal(oversizedResult.accepted, true);
  assert.deepEqual(oversizedClaims.map((call) => call.guardVisible), [true]);
  assert.equal(oversizedSteps, 1);

  const invalidGroups = [unsafePath, markerFalse, markerMissing];
  const discovery = new FakeDiscoveryDatabase(
    [],
    [...invalidGroups, oversizedName],
  );
  const database = new FakePrivateDatabase(Object.fromEntries(
    [...invalidGroups, oversizedName].map((group) => [
      dishProposalGroupPath(group.id),
      group,
    ]),
  ));
  const scheduledClaims = [];
  let scheduledSteps = 0;
  const summary = await processDishProposalResolutionWorkHandler({
    discoveryDatabase: discovery,
    privateDatabase: database,
    resolutionDependencies: resolutionDependencies(database),
    now: () => new Date(
      baseTimeMs + dishProposalAutomaticDelayMilliseconds + 10_000,
    ),
    claimApply: guardedClaimRecorder(scheduledClaims, "oversized-job"),
    processStep: async (dependencies, jobId) => {
      void dependencies;
      assert.equal(jobId, "oversized-job");
      scheduledSteps += 1;
      return stepResult(jobId);
    },
  });
  assert.deepEqual(scheduledClaims.map((call) => call.groupId), [
    oversizedName.id,
  ]);
  assert.equal(scheduledSteps, 1);
  assert.deepEqual(summary, {
    selectedExistingJobs: 0,
    selectedDueGroups: 4,
    processedExistingJobs: 0,
    claimedDueGroups: 1,
    processedDueGroups: 1,
    failures: 3,
  });
});

test("scheduler caps >15 existing jobs and >10 due groups at 25 one-step items", async () => {
  const existing = Array.from({length: 20}, (_, index) =>
    makeActiveGroup(300 + index, {
      status: index % 2 === 0 ? "active" : "retryable",
    }));
  const dueGroups = Array.from({length: 20}, (_, index) =>
    makeGroup(400 + index, {
      oldestTrustedServerCreateTime: new Date(
        baseTimeMs - dishProposalAutomaticDelayMilliseconds - 10_000 + index,
      ),
    }));
  const discovery = new FakeDiscoveryDatabase(
    existing.map((fixture) => fixture.job),
    dueGroups,
  );
  const privateDatabase = new FakePrivateDatabase(Object.fromEntries([
    ...existing.flatMap((fixture) => [
      [dishProposalGroupPath(fixture.group.id), fixture.group],
      [dishProposalJobPath(fixture.job.id), fixture.job],
    ]),
    ...dueGroups.map((group) => [dishProposalGroupPath(group.id), group]),
  ]));
  const claimCalls = [];
  const stepCalls = [];
  const failedExistingJobId = existing[0].job.id;
  let failedDueJobId = null;
  const summary = await processDishProposalResolutionWorkHandler({
    discoveryDatabase: discovery,
    privateDatabase,
    resolutionDependencies: resolutionDependencies(privateDatabase),
    now: () => new Date(baseTimeMs),
    claimApply: async (database, groupId, now) => {
      const group = await database.runTransaction((transaction) =>
        transaction.getDocument(dishProposalGroupPath(groupId)));
      claimCalls.push({groupId, now, guardVisible: group !== null});
      const jobId = `auto-${groupId}`;
      if (failedDueJobId === null) failedDueJobId = jobId;
      return group === null ?
        {claimed: false, jobId: null, reason: "missing-group"} :
        {claimed: true, jobId, reason: "claimed"};
    },
    processStep: async (dependencies, jobId, now) => {
      void dependencies;
      stepCalls.push({jobId, now});
      if (jobId === failedExistingJobId || jobId === failedDueJobId) {
        throw new Error("injected-step-failure");
      }
      return stepResult(jobId);
    },
  });

  assert.deepEqual(summary, {
    selectedExistingJobs: 15,
    selectedDueGroups: 10,
    processedExistingJobs: 14,
    claimedDueGroups: 10,
    processedDueGroups: 9,
    failures: 2,
  });
  assert.equal(dishProposalScheduledExistingJobLimit, 15);
  assert.equal(dishProposalScheduledWorkLimit, 25);
  assert.equal(stepCalls.length, 25);
  assert.equal(new Set(stepCalls.map((call) => call.jobId)).size, 25);
  assert.equal(claimCalls.length, 10);
  assert.equal(claimCalls.every((call) => call.guardVisible), true);
  assert.equal(stepCalls.every((call) => call.now.getTime() === baseTimeMs), true);
  assert.equal(stepCalls.some((call) =>
    call.jobId === existing[14].job.id), true);
  assert.equal(stepCalls.some((call) =>
    call.jobId === `auto-${dueGroups[9].id}`), true);
  assert.equal(stepCalls.some((call) =>
    call.jobId === existing[15].job.id), false);
  assert.equal(stepCalls.some((call) =>
    call.jobId === `auto-${dueGroups[10].id}`), false);
  assert.equal(discovery.queries.length, 2);
  assert.deepEqual(discovery.queries[0], {
    collectionPath: dishProposalJobCollection,
    where: [{
      field: "status",
      operator: "in",
      value: ["active", "retryable"],
    }],
    orderBy: [
      {field: "updatedAt", direction: "asc"},
      {field: "__name__", direction: "asc"},
    ],
    limit: 15,
  });
  assert.deepEqual(discovery.queries[1], {
    collectionPath: dishProposalGroupCollection,
    where: [
      {
        field: "resolutionIdentitiesValid",
        operator: "==",
        value: true,
      },
      {field: "autoEligible", operator: "==", value: true},
      {field: "dueAt", operator: "<=", value: new Date(baseTimeMs)},
    ],
    orderBy: [
      {field: "dueAt", direction: "asc"},
      {field: "__name__", direction: "asc"},
    ],
    limit: 10,
  });
  assert.equal(privateDatabase.writes.length, 0);
});

test("scheduler enforces due eligibility again at selection and claim time", async () => {
  const dueRename = makeGroup(500, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 2_000,
    ),
  });
  const dueMerge = makeGroup(501, {
    proposalType: "merge",
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
    ),
  });
  const notDue = makeGroup(502);
  const insufficient = makeGroup(503, {
    enoughSupporters: false,
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
    ),
  });
  const manual = makeActiveGroup(504, {
    status: "manual_review_required",
    enoughSupporters: true,
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
    ),
  });
  const racedSelection = makeGroup(505, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
    ),
  });
  const racedCurrent = makeGroup(505);
  const selectedGroups = [
    dueRename,
    dueMerge,
    notDue,
    insufficient,
    manual.group,
    racedSelection,
  ];
  const currentGroups = [
    dueRename,
    dueMerge,
    notDue,
    insufficient,
    manual.group,
    racedCurrent,
  ];
  const discovery = new FakeDiscoveryDatabase([], selectedGroups);
  const privateDatabase = new FakePrivateDatabase(Object.fromEntries(
    currentGroups.map((group) => [dishProposalGroupPath(group.id), group]),
  ));
  const claimCalls = [];
  const stepCalls = [];
  const summary = await processDishProposalResolutionWorkHandler({
    discoveryDatabase: discovery,
    privateDatabase,
    resolutionDependencies: resolutionDependencies(privateDatabase),
    now: () => new Date(baseTimeMs),
    claimApply: async (database, groupId, now) => {
      const group = await database.runTransaction((transaction) =>
        transaction.getDocument(dishProposalGroupPath(groupId)));
      claimCalls.push({groupId, now, guardVisible: group !== null});
      return group === null ?
        {claimed: false, jobId: null, reason: "missing-group"} :
        {claimed: true, jobId: `claimed-${groupId}`, reason: "claimed"};
    },
    processStep: async (dependencies, jobId) => {
      void dependencies;
      stepCalls.push(jobId);
      return stepResult(jobId);
    },
  });

  assert.deepEqual(summary, {
    selectedExistingJobs: 0,
    selectedDueGroups: 6,
    processedExistingJobs: 0,
    claimedDueGroups: 2,
    processedDueGroups: 2,
    failures: 3,
  });
  assert.deepEqual(claimCalls.map((call) => call.groupId), [
    dueRename.id,
    dueMerge.id,
    racedSelection.id,
  ]);
  assert.deepEqual(claimCalls.map((call) => call.guardVisible), [
    true,
    true,
    false,
  ]);
  assert.equal(stepCalls.length, 2);
  assert.deepEqual(stepCalls, [
    `claimed-${dueRename.id}`,
    `claimed-${dueMerge.id}`,
  ]);
  assert.equal(privateDatabase.writes.length, 0);
});

test("scheduler pins the selected due-group cycle inside the claim transaction", async () => {
  const selected = makeGroup(600, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
    ),
    lastMembershipGeneration: 4,
    resolutionSequence: 2,
  });
  const replacementCycle = makeGroup(600, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 500,
    ),
    lastMembershipGeneration: 5,
    resolutionSequence: 3,
  });
  assert.equal(selected.id, replacementCycle.id);
  assert.notEqual(selected.data.fingerprint, replacementCycle.data.fingerprint);
  const discovery = new FakeDiscoveryDatabase([], [selected]);
  const privateDatabase = new FakePrivateDatabase({
    [dishProposalGroupPath(selected.id)]: replacementCycle,
  });
  const claimCalls = [];
  const stepCalls = [];

  const summary = await processDishProposalResolutionWorkHandler({
    discoveryDatabase: discovery,
    privateDatabase,
    resolutionDependencies: resolutionDependencies(privateDatabase),
    now: () => new Date(baseTimeMs),
    claimApply: async (database, groupId) => {
      const group = await database.runTransaction((transaction) =>
        transaction.getDocument(dishProposalGroupPath(groupId)));
      claimCalls.push({groupId, guardVisible: group !== null});
      return group === null ?
        {claimed: false, jobId: null, reason: "missing-group"} :
        {claimed: true, jobId: `claimed-${groupId}`, reason: "claimed"};
    },
    processStep: async (dependencies, jobId) => {
      void dependencies;
      stepCalls.push(jobId);
      return stepResult(jobId);
    },
  });

  assert.deepEqual(claimCalls, [{
    groupId: selected.id,
    guardVisible: false,
  }]);
  assert.deepEqual(stepCalls, []);
  assert.deepEqual(summary, {
    selectedExistingJobs: 0,
    selectedDueGroups: 1,
    processedExistingJobs: 0,
    claimedDueGroups: 0,
    processedDueGroups: 0,
    failures: 0,
  });
});

test("scheduler verifies each discovered job still owns its exact current group", async () => {
  const matching = makeActiveGroup(610, {
    status: "active",
    resolutionSequence: 1,
  });
  const staleSelection = makeActiveGroup(611, {
    status: "retryable",
    resolutionSequence: 1,
  });
  const replacementOwner = makeActiveGroup(611, {
    status: "active",
    resolutionSequence: 2,
  });
  assert.equal(staleSelection.group.id, replacementOwner.group.id);
  assert.notEqual(staleSelection.job.id, replacementOwner.job.id);
  const discovery = new FakeDiscoveryDatabase([
    matching.job,
    staleSelection.job,
  ], []);
  const privateDatabase = new FakePrivateDatabase({
    [dishProposalGroupPath(matching.group.id)]: matching.group,
    [dishProposalJobPath(matching.job.id)]: matching.job,
    [dishProposalGroupPath(staleSelection.group.id)]: replacementOwner.group,
    [dishProposalJobPath(staleSelection.job.id)]: staleSelection.job,
  });
  const stepCalls = [];

  const summary = await processDishProposalResolutionWorkHandler({
    discoveryDatabase: discovery,
    privateDatabase,
    resolutionDependencies: resolutionDependencies(privateDatabase),
    now: () => new Date(baseTimeMs),
    processStep: async (dependencies, jobId) => {
      void dependencies;
      stepCalls.push(jobId);
      return stepResult(jobId);
    },
    claimApply: guardedClaimRecorder([]),
  });

  assert.deepEqual(stepCalls, [matching.job.id]);
  assert.equal(
    privateDatabase.gets.includes(dishProposalGroupPath(matching.group.id)),
    true,
  );
  assert.equal(
    privateDatabase.gets.includes(
      dishProposalGroupPath(staleSelection.group.id),
    ),
    true,
  );
  assert.deepEqual(summary, {
    selectedExistingJobs: 2,
    selectedDueGroups: 0,
    processedExistingJobs: 1,
    claimedDueGroups: 0,
    processedDueGroups: 0,
    failures: 1,
  });
});

test("scheduler isolates failures, preserves retry state and locks, and never duplicates durable effects", async () => {
  const retryableMerge = makeActiveGroup(620, {
    proposalType: "merge",
    sourceDishId: "partial-merge-source",
    mergeTargetDishId: "partial-merge-target",
    status: "retryable",
  });
  const manualTransition = makeActiveGroup(621, {status: "active"});
  const manualState = makeActiveGroup(621, {
    status: "manual_review_required",
  });
  const malformedSelectionFixture = makeActiveGroup(622, {status: "active"});
  const malformedSelection = structuredClone(malformedSelectionFixture.job);
  malformedSelection.data.fingerprint = "0".repeat(64);
  const malformedCurrentFixture = makeActiveGroup(623, {status: "active"});
  const malformedCurrentGroup = structuredClone(malformedCurrentFixture.group);
  malformedCurrentGroup.data.fingerprint = "0".repeat(64);
  const laterValid = makeActiveGroup(624, {status: "active"});
  const dueFailure = makeGroup(625, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 2_000,
    ),
  });
  const dueSuccess = makeGroup(626, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
    ),
  });
  const sourceLock = makeMergeLock(retryableMerge, "source");
  const targetLock = makeMergeLock(retryableMerge, "target");
  const initialLocks = [sourceLock, targetLock];
  const database = new TransactionalPrivateDatabase(Object.fromEntries([
    ...[
      retryableMerge,
      manualTransition,
      malformedSelectionFixture,
      laterValid,
    ].flatMap((fixture) => [
      [dishProposalGroupPath(fixture.group.id), fixture.group],
      [dishProposalJobPath(fixture.job.id), fixture.job],
    ]),
    [
      dishProposalGroupPath(malformedCurrentFixture.group.id),
      malformedCurrentGroup,
    ],
    [
      dishProposalJobPath(malformedCurrentFixture.job.id),
      malformedCurrentFixture.job,
    ],
    [dishProposalGroupPath(dueFailure.id), dueFailure],
    [dishProposalGroupPath(dueSuccess.id), dueSuccess],
    ...initialLocks.map((lock) => [
      dishMergeReviewLockPath(lock.id),
      lock,
    ]),
  ]));
  const discovery = new FakeDiscoveryDatabase([
    retryableMerge.job,
    manualTransition.job,
    malformedSelection,
    malformedCurrentFixture.job,
    laterValid.job,
  ], [dueFailure, dueSuccess]);
  const dueFailureJobId = createDishProposalJobId({
    groupId: dueFailure.id,
    resolutionSequence: 1,
    resolutionType: "apply",
  });
  const dueSuccessJobId = createDishProposalJobId({
    groupId: dueSuccess.id,
    resolutionSequence: 1,
    resolutionType: "apply",
  });
  const stepCalls = [];
  const failureCanary = `${privacyCanaries[0]}:${privacyCanaries[3]}`;
  const summary = await processDishProposalResolutionWorkHandler({
    discoveryDatabase: discovery,
    privateDatabase: database,
    resolutionDependencies: resolutionDependencies(database),
    now: () => new Date(baseTimeMs),
    processStep: async (dependencies, jobId) => {
      assert.equal(dependencies.database, database);
      stepCalls.push(jobId);
      if (jobId === retryableMerge.job.id || jobId === dueFailureJobId) {
        throw new Error(failureCanary);
      }
      if (jobId === manualTransition.job.id) {
        await database.runTransaction(async (transaction) => {
          transaction.setDocument(
            dishProposalJobPath(jobId),
            manualState.job.data,
          );
        });
        return stepResult(jobId, "manual_review_required");
      }
      return stepResult(jobId);
    },
  });

  assert.deepEqual(summary, {
    selectedExistingJobs: 5,
    selectedDueGroups: 2,
    processedExistingJobs: 2,
    claimedDueGroups: 2,
    processedDueGroups: 1,
    failures: 4,
  });
  assert.deepEqual(stepCalls, [
    retryableMerge.job.id,
    manualTransition.job.id,
    laterValid.job.id,
    dueFailureJobId,
    dueSuccessJobId,
  ]);
  assert.equal(
    database.document(dishProposalJobPath(retryableMerge.job.id)).data.status,
    "retryable",
  );
  assert.equal(
    database.document(dishProposalJobPath(manualTransition.job.id)).data.status,
    "manual_review_required",
  );
  assert.equal(
    database.document(dishProposalJobPath(dueFailureJobId)).data.status,
    "active",
  );
  assert.equal(
    database.document(dishProposalJobPath(dueSuccessJobId)).data.status,
    "active",
  );
  assert.deepEqual(
    database.documentsIn(dishMergeReviewLockCollection),
    initialLocks,
  );

  const jobsAfterFirstDelivery = database.documentsIn(
    dishProposalJobCollection,
  );
  assert.equal(jobsAfterFirstDelivery.length, 7);
  assert.equal(
    new Set(jobsAfterFirstDelivery.map((document) => document.id)).size,
    7,
  );
  assert.equal(
    jobsAfterFirstDelivery.every((document) =>
      ["active", "retryable", "manual_review_required"].includes(
        document.data.status,
      ) && document.data.resolutionType === "apply"),
    true,
  );
  assert.equal(
    database.documentsIn("bitescore_contribution_point_ledger").length,
    0,
  );
  assert.equal(database.documentsIn("user_profiles").length, 0);
  assert.equal(JSON.stringify(summary).includes(failureCanary), false);

  const retrySteps = [];
  const retrySummary = await processDishProposalResolutionWorkHandler({
    discoveryDatabase: new FilteringDiscoveryDatabase(
      jobsAfterFirstDelivery,
      [dueFailure, dueSuccess],
    ),
    privateDatabase: database,
    resolutionDependencies: resolutionDependencies(database),
    now: () => new Date(baseTimeMs),
    processStep: async (dependencies, jobId) => {
      assert.equal(dependencies.database, database);
      retrySteps.push(jobId);
      return stepResult(jobId);
    },
  });
  assert.deepEqual(retrySummary, {
    selectedExistingJobs: 6,
    selectedDueGroups: 2,
    processedExistingJobs: 5,
    claimedDueGroups: 0,
    processedDueGroups: 0,
    failures: 1,
  });
  assert.equal(retrySteps.includes(malformedCurrentFixture.job.id), false);
  assert.equal(retrySteps.includes(retryableMerge.job.id), true);
  const jobsAfterRetry = database.documentsIn(dishProposalJobCollection);
  assert.equal(jobsAfterRetry.length, 7);
  assert.equal(
    new Set(jobsAfterRetry.map((document) => document.id)).size,
    7,
  );
  assert.deepEqual(
    database.documentsIn(dishMergeReviewLockCollection),
    initialLocks,
  );
  assert.equal(
    database.documentsIn("bitescore_contribution_point_ledger").length,
    0,
  );
  assert.equal(database.documentsIn("user_profiles").length, 0);
});

test("real transactional claims make concurrent Apply versus Apply one-winner", async () => {
  await runRealManualClaimRace({
    index: 700,
    firstHandler: applyRatingAdminDishSuggestionGroupHandler,
    secondHandler: applyRatingAdminDishSuggestionGroupHandler,
    winningResolutionType: "apply",
  });
});

test("real transactional claims make concurrent Apply versus Reject one-winner", async () => {
  const result = await runRealManualClaimRace({
    index: 701,
    firstHandler: applyRatingAdminDishSuggestionGroupHandler,
    secondHandler: rejectRatingAdminDishSuggestionGroupHandler,
    winningResolutionType: "apply",
  });
  assert.equal(result.results[1].resolutionType, null);
});

test("real transactional claims make concurrent Reject versus Apply one-winner", async () => {
  const result = await runRealManualClaimRace({
    index: 702,
    firstHandler: rejectRatingAdminDishSuggestionGroupHandler,
    secondHandler: applyRatingAdminDishSuggestionGroupHandler,
    winningResolutionType: "reject",
  });
  assert.equal(result.results[0].status, "rejecting");
  assert.equal(result.results[1].resolutionType, null);
});

test("repeated clientRequestId still creates one durable real claim job", async () => {
  const result = await runRealManualClaimRace({
    index: 703,
    firstHandler: applyRatingAdminDishSuggestionGroupHandler,
    secondHandler: applyRatingAdminDishSuggestionGroupHandler,
    winningResolutionType: "apply",
    repeatedClientRequestId: true,
  });
  assert.equal(result.results[1].status, "stale");
});

test("real manual Apply wins atomically against overlapping scheduled Apply", async () => {
  await runRealManualVsScheduledRace({
    index: 704,
    manualHandler: applyRatingAdminDishSuggestionGroupHandler,
    winningResolutionType: "apply",
  });
});

test("real manual Reject cannot be overwritten by overlapping scheduled Apply", async () => {
  const result = await runRealManualVsScheduledRace({
    index: 705,
    manualHandler: rejectRatingAdminDishSuggestionGroupHandler,
    winningResolutionType: "reject",
  });
  assert.equal(result.manualResult.status, "rejecting");
});

test("overlapping scheduler deliveries create one real durable claim job", async () => {
  const group = makeGroup(706, {
    oldestTrustedServerCreateTime: new Date(
      baseTimeMs - dishProposalAutomaticDelayMilliseconds - 1_000,
    ),
  });
  const database = new TransactionalPrivateDatabase({
    [dishProposalGroupPath(group.id)]: group,
  });
  const firstDiscovery = signaledDiscoveryDatabase([], [group]);
  const secondDiscovery = signaledDiscoveryDatabase([], [group]);
  const stepCalls = [];
  const processStep = realClaimHandlerContext(database, stepCalls).processStep;
  const scheduledContext = (discoveryDatabase) => ({
    discoveryDatabase,
    privateDatabase: database,
    resolutionDependencies: resolutionDependencies(database),
    now: () => new Date(baseTimeMs),
    processStep,
  });
  const gate = database.holdNextTransaction();
  const first = processDishProposalResolutionWorkHandler(
    scheduledContext(firstDiscovery.database),
  );
  await gate.started;
  const second = processDishProposalResolutionWorkHandler(
    scheduledContext(secondDiscovery.database),
  );
  await secondDiscovery.dueQueryObserved;
  await database.waitForRequestedTransactions(2);
  gate.release();
  const summaries = await Promise.all([first, second]);

  assert.deepEqual(summaries[0], {
    selectedExistingJobs: 0,
    selectedDueGroups: 1,
    processedExistingJobs: 0,
    claimedDueGroups: 1,
    processedDueGroups: 1,
    failures: 0,
  });
  assert.deepEqual(summaries[1], {
    selectedExistingJobs: 0,
    selectedDueGroups: 1,
    processedExistingJobs: 0,
    claimedDueGroups: 0,
    processedDueGroups: 0,
    failures: 0,
  });
  assert.equal(stepCalls.length, 1);
  const job = assertSingleDurableClaim(database, group, "apply");
  assert.equal(stepCalls[0].jobId, job.id);
});
