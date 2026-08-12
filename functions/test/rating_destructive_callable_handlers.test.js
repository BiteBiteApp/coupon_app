"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {HttpsError} = require("firebase-functions/v2/https");

const {
  buildRatingDestructiveOperationSummary,
  parseRatingDestructiveStatusRequest,
  parseRatingDishDeleteStartRequest,
  parseRatingDishMergeStartRequest,
  parseRatingRestaurantDeleteStartRequest,
  parseRatingRestaurantMergeStartRequest,
  ratingDestructiveCallableContractVersion,
  ratingDestructiveSummaryContractVersion,
} = require("../lib/rating_destructive_callable_contract.js");
const {
  getRatingDestructiveOperationStatusHandler,
  startRatingDishDeleteHandler,
  startRatingDishMergeHandler,
  startRatingRestaurantDeleteHandler,
  startRatingRestaurantMergeHandler,
} = require("../lib/rating_destructive_callable_handlers.js");
const {
  buildRatingDestructiveJobDocument,
  createRatingDestructiveCallerBindingFingerprint,
  createRatingDestructiveJobId,
  ratingDestructiveJobPath,
  ratingDestructiveJobVersion,
  ratingRestaurantOperationLockPath,
} = require("../lib/rating_destructive_job_contract.js");

const now = new Date("2026-08-11T17:00:00.000Z");
const later = new Date("2026-08-11T17:01:00.000Z");
const admin = Object.freeze({
  uid: "admin-uid",
  authorizedCallerKind: "admin",
});
const owner = Object.freeze({
  uid: "owner-uid",
  authorizedCallerKind: "owner",
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class MemoryDatabase {
  constructor() {
    this.records = new Map();
    this.readCount = 0;
    this.writeCount = 0;
  }

  seed(path, data) {
    this.records.set(path, clone(data));
  }

  data(path) {
    const value = this.records.get(path);
    return value === undefined ? null : clone(value);
  }

  async runTransaction(operation) {
    const pendingSets = [];
    const pendingDeletes = [];
    const result = await operation({
      getDocument: async (path) => {
        this.readCount += 1;
        const data = this.records.get(path);
        if (data === undefined) return null;
        return {id: path.split("/").at(-1), data: clone(data), createTime: now};
      },
      queryDocuments: async () => [],
      setDocument: (path, data, options) => {
        pendingSets.push({path, data: clone(data), options});
      },
      deleteDocument: (path) => pendingDeletes.push(path),
    });
    for (const {path, data, options} of pendingSets) {
      const next = options?.merge === true
        ? {...(this.records.get(path) ?? {}), ...data}
        : data;
      this.records.set(path, clone(next));
      this.writeCount += 1;
    }
    for (const path of pendingDeletes) {
      this.records.delete(path);
      this.writeCount += 1;
    }
    return result;
  }
}

function seedRestaurant(database, id, revision, changes = {}) {
  database.seed(`bitescore_restaurants/${id}`, {
    name: `Restaurant ${id}`,
    isActive: true,
    isClaimed: false,
    ownerUserId: null,
    restaurantWriteRevision: revision,
    ...changes,
  });
}

function seedDish(database, id, restaurantId, generation, changes = {}) {
  database.seed(`bitescore_dishes/${id}`, {
    restaurantId,
    restaurantName: `Restaurant ${restaurantId}`,
    isActive: true,
    mergedIntoDishId: null,
    aggregateWriteGeneration: generation,
    ...changes,
  });
}

function identity(operation) {
  switch (operation) {
  case "restaurantMerge":
    return {
      sourceRestaurantId: "restaurant-a",
      targetRestaurantId: "restaurant-b",
      sourceDishId: null,
      targetDishId: null,
      restaurantId: null,
    };
  case "restaurantDelete":
    return {
      sourceRestaurantId: "restaurant-a",
      targetRestaurantId: null,
      sourceDishId: null,
      targetDishId: null,
      restaurantId: null,
    };
  case "dishMerge":
    return {
      sourceRestaurantId: null,
      targetRestaurantId: null,
      sourceDishId: "dish-a",
      targetDishId: "dish-b",
      restaurantId: "restaurant-a",
    };
  case "dishDelete":
    return {
      sourceRestaurantId: null,
      targetRestaurantId: null,
      sourceDishId: "dish-a",
      targetDishId: null,
      restaurantId: null,
    };
  default:
    throw new Error("Unsupported operation.");
  }
}

function buildJob(operation, changes = {}) {
  const operationIdentity = identity(operation);
  const requestId = changes.requestId ?? `request-${operation}`;
  const jobId = createRatingDestructiveJobId({
    requestId,
    operation,
    ...operationIdentity,
  });
  const phase = changes.phase ?? ({
    restaurantMerge: "claimed",
    restaurantDelete: "claimed",
    dishMerge: "validate",
    dishDelete: "process_reviews",
  })[operation];
  const status = changes.status ?? "active";
  const isComplete = status === "complete";
  return buildRatingDestructiveJobDocument({
    jobId,
    requestId,
    operation,
    authorizedCallerKind: changes.authorizedCallerKind ?? "admin",
    callerBindingFingerprint: changes.callerBindingFingerprint ??
      createRatingDestructiveCallerBindingFingerprint(admin.uid),
    status,
    phase: isComplete ? "complete" : phase,
    ...operationIdentity,
    expectedSourceRestaurantRevision:
      operation === "restaurantMerge" || operation === "restaurantDelete"
        ? 7
        : null,
    sourceActiveRestaurantRevision:
      operation === "restaurantMerge" || operation === "restaurantDelete"
        ? 8
        : null,
    sourceCompletionRestaurantRevision:
      operation === "restaurantMerge" ? 9 : null,
    expectedTargetRestaurantRevision: operation === "restaurantMerge"
      ? 20
      : null,
    targetActiveRestaurantRevision: operation === "restaurantMerge"
      ? 21
      : null,
    targetCompletionRestaurantRevision: operation === "restaurantMerge"
      ? 22
      : null,
    expectedSourceAggregateGeneration: operation === "dishMerge" ? 3 : null,
    sourceActiveAggregateGeneration: operation === "dishMerge" ? 4 : null,
    sourceCompletionAggregateGeneration: operation === "dishMerge" ? 5 : null,
    expectedTargetAggregateGeneration: operation === "dishMerge" ? 10 : null,
    targetActiveAggregateGeneration: operation === "dishMerge" ? 11 : null,
    targetCompletionAggregateGeneration: operation === "dishMerge" ? 12 : null,
    cursorDocumentId: null,
    itemCursorId: operation === "dishDelete" && !isComplete
      ? "deletion-item"
      : null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
    processedCount: changes.processedCount ?? 0,
    phaseProcessedCount: isComplete
      ? 0
      : changes.phaseProcessedCount ?? 0,
    failureCode: status === "retryable"
      ? "temporary_dependency"
      : status === "manual_review_required"
        ? "entity_state_incompatible"
        : null,
    createdAt: now,
    updatedAt: later,
    completedAt: isComplete ? later : null,
  });
}

function baseContext(database, actor = admin) {
  return {
    privateDatabase: database,
    processingDependencies: {
      database,
      external: new Proxy({}, {
        get() {
          return async () => {
            throw new Error("Unexpected destructive external step.");
          };
        },
      }),
    },
    authenticate: () => actor,
    now: () => now,
  };
}

function realClaimContext(database, actor = admin) {
  return {
    ...baseContext(database, actor),
    processStep: async (_dependencies, jobId) => ({
      job: database.data(ratingDestructiveJobPath(jobId)),
      processedDocuments: 0,
    }),
  };
}

function request(data) {
  return {auth: {uid: "ignored-by-injected-auth"}, data};
}

function restaurantMergeData(changes = {}) {
  return {
    contractVersion: ratingDestructiveCallableContractVersion,
    sourceRestaurantId: "restaurant-a",
    targetRestaurantId: "restaurant-b",
    expectedSourceRestaurantRevision: 7,
    expectedTargetRestaurantRevision: 20,
    clientRequestId: "request-restaurantMerge",
    ...changes,
  };
}

function restaurantDeleteData(changes = {}) {
  return {
    contractVersion: ratingDestructiveCallableContractVersion,
    restaurantId: "restaurant-a",
    expectedRestaurantRevision: 7,
    clientRequestId: "request-restaurantDelete",
    ...changes,
  };
}

function dishMergeData(changes = {}) {
  return {
    contractVersion: ratingDestructiveCallableContractVersion,
    sourceDishId: "dish-a",
    targetDishId: "dish-b",
    clientRequestId: "request-dishMerge",
    ...changes,
  };
}

function dishDeleteData(changes = {}) {
  return {
    contractVersion: ratingDestructiveCallableContractVersion,
    dishId: "dish-a",
    clientRequestId: "request-dishDelete",
    ...changes,
  };
}

function assertHttpsCode(code) {
  return (error) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, code);
    return true;
  };
}

test("four public start parsers and exact status parser reject extra trust", () => {
  assert.deepEqual(
    parseRatingRestaurantMergeStartRequest(restaurantMergeData()),
    restaurantMergeData(),
  );
  assert.deepEqual(
    parseRatingRestaurantDeleteStartRequest(restaurantDeleteData()),
    restaurantDeleteData(),
  );
  assert.deepEqual(parseRatingDishMergeStartRequest(dishMergeData()),
    dishMergeData());
  assert.deepEqual(parseRatingDishDeleteStartRequest(dishDeleteData()),
    dishDeleteData());
  const operationId = "a".repeat(64);
  assert.deepEqual(parseRatingDestructiveStatusRequest({
    contractVersion: ratingDestructiveCallableContractVersion,
    operationId,
    clientRequestId: "status-request",
  }), {
    contractVersion: ratingDestructiveCallableContractVersion,
    operationId,
    clientRequestId: "status-request",
  });

  for (const {parser, valid} of [
    {
      parser: parseRatingRestaurantMergeStartRequest,
      valid: restaurantMergeData(),
    },
    {
      parser: parseRatingRestaurantDeleteStartRequest,
      valid: restaurantDeleteData(),
    },
    {parser: parseRatingDishMergeStartRequest, valid: dishMergeData()},
    {parser: parseRatingDishDeleteStartRequest, valid: dishDeleteData()},
  ]) {
    for (const invalid of [
      null,
      [],
      new Date(),
      {...valid, unexpected: true},
      {...valid, contractVersion: "v0"},
      {...valid, clientRequestId: "contains space"},
    ]) {
      assert.throws(
        () => parser(invalid),
        assertHttpsCode("invalid-argument"),
      );
    }
  }
  assert.throws(
    () => parseRatingDishMergeStartRequest({
      ...dishMergeData(), restaurantId: "restaurant-a",
    }),
    assertHttpsCode("invalid-argument"),
  );
  assert.throws(
    () => parseRatingDishMergeStartRequest({
      ...dishMergeData(), expectedSourceAggregateGeneration: 3,
    }),
    assertHttpsCode("invalid-argument"),
  );
  assert.throws(
    () => parseRatingDishDeleteStartRequest({
      ...dishDeleteData(), restaurantId: "restaurant-a",
    }),
    assertHttpsCode("invalid-argument"),
  );
  assert.throws(
    () => parseRatingDishDeleteStartRequest({
      ...dishDeleteData(), expectedSourceAggregateGeneration: 3,
    }),
    assertHttpsCode("invalid-argument"),
  );
  assert.throws(
    () => parseRatingDishMergeStartRequest({
      ...dishMergeData(), targetDishId: "dish-a",
    }),
    assertHttpsCode("invalid-argument"),
  );
  for (const invalid of [
    {...restaurantMergeData(), sourceRestaurantId: "restaurant-b"},
    {...restaurantMergeData(), expectedSourceRestaurantRevision: 1.5},
    {...restaurantMergeData(), expectedTargetRestaurantRevision:
      Number.MAX_SAFE_INTEGER + 1},
  ]) {
    assert.throws(
      () => parseRatingRestaurantMergeStartRequest(invalid),
      assertHttpsCode("invalid-argument"),
    );
  }
});

test("production start handlers reject malformed public data before reads", async () => {
  const missingField = restaurantMergeData();
  delete missingField.sourceRestaurantId;
  const nonPlain = Object.assign(
    Object.create({inherited: true}),
    restaurantMergeData(),
  );
  for (const invalid of [
    null,
    undefined,
    [],
    nonPlain,
    missingField,
    {...restaurantMergeData(), unknown: true},
    {...restaurantMergeData(), contractVersion: "v0"},
    {...restaurantMergeData(), sourceRestaurantId: "bad/path"},
    {...restaurantMergeData(), targetRestaurantId: "."},
    {...restaurantMergeData(), expectedSourceRestaurantRevision: 1.5},
  ]) {
    const database = new MemoryDatabase();
    await assert.rejects(
      startRatingRestaurantMergeHandler(
        request(invalid),
        baseContext(database),
      ),
      assertHttpsCode("invalid-argument"),
    );
    assert.equal(database.readCount, 0);
    assert.equal(database.writeCount, 0);
  }

  for (const {handler, data} of [
    {
      handler: startRatingDishMergeHandler,
      data: {...dishMergeData(), restaurantId: "restaurant-a"},
    },
    {
      handler: startRatingDishMergeHandler,
      data: {...dishMergeData(), expectedSourceAggregateGeneration: 3},
    },
    {
      handler: startRatingDishDeleteHandler,
      data: {...dishDeleteData(), restaurantId: "restaurant-a"},
    },
    {
      handler: startRatingDishDeleteHandler,
      data: {...dishDeleteData(), expectedSourceAggregateGeneration: 3},
    },
  ]) {
    const database = new MemoryDatabase();
    await assert.rejects(
      handler(request(data), baseContext(database)),
      assertHttpsCode("invalid-argument"),
    );
    assert.equal(database.readCount, 0);
    assert.equal(database.writeCount, 0);
  }
});

test("all four start handlers construct only exact server claim requests", async () => {
  const cases = [
    {
      handler: startRatingRestaurantMergeHandler,
      data: restaurantMergeData(),
      seed(database) {
        seedRestaurant(database, "restaurant-a", 7);
        seedRestaurant(database, "restaurant-b", 20);
      },
      operation: "restaurantMerge",
      expected: {
        sourceRestaurantId: "restaurant-a",
        targetRestaurantId: "restaurant-b",
        expectedSourceRestaurantRevision: 7,
        expectedTargetRestaurantRevision: 20,
      },
    },
    {
      handler: startRatingRestaurantDeleteHandler,
      data: restaurantDeleteData(),
      seed(database) {
        seedRestaurant(database, "restaurant-a", 7);
      },
      operation: "restaurantDelete",
      expected: {
        sourceRestaurantId: "restaurant-a",
        expectedSourceRestaurantRevision: 7,
      },
    },
    {
      handler: startRatingDishMergeHandler,
      data: dishMergeData(),
      seed(database) {
        seedDish(database, "dish-a", "restaurant-a", 3);
        seedDish(database, "dish-b", "restaurant-a", 10);
        seedRestaurant(database, "restaurant-a", 7);
      },
      operation: "dishMerge",
      expected: {
        sourceDishId: "dish-a",
        targetDishId: "dish-b",
        restaurantId: "restaurant-a",
      },
    },
    {
      handler: startRatingDishDeleteHandler,
      data: dishDeleteData(),
      seed(database) {
        seedDish(database, "dish-a", "restaurant-a", 3);
        seedRestaurant(database, "restaurant-a", 7);
      },
      operation: "dishDelete",
      expected: {sourceDishId: "dish-a"},
    },
  ];

  for (const entry of cases) {
    const database = new MemoryDatabase();
    entry.seed(database);
    let capturedClaim = null;
    let processCalls = 0;
    const context = {
      ...baseContext(database),
      claim: async (_dependencies, claimRequest) => {
        capturedClaim = claimRequest;
        return {job: buildJob(entry.operation, {
          requestId: claimRequest.requestId,
        }), claimed: true};
      },
      processStep: async (_dependencies, _jobId) => {
        processCalls += 1;
        return {job: buildJob(entry.operation, {
          requestId: entry.data.clientRequestId,
          processedCount: 1,
        }), processedDocuments: 1};
      },
    };
    const result = await entry.handler(request(entry.data), context);
    assert.equal(processCalls, 1);
    assert.equal(result.accepted, true);
    assert.equal(result.messageCategory, "accepted_processing");
    assert.equal(result.processedCount, 1);
    assert.deepEqual(capturedClaim, {
      contractVersion: ratingDestructiveJobVersion,
      requestId: entry.data.clientRequestId,
      operation: entry.operation,
      ...entry.expected,
      authorizedCallerKind: "admin",
      callerBindingFingerprint:
        createRatingDestructiveCallerBindingFingerprint(admin.uid),
      authorizedCallerUid: admin.uid,
    });
  }
});

test("production handlers fail closed for stale, missing, and incompatible entities", async () => {
  for (const revisions of [[8, 20], [7, 21]]) {
    const database = new MemoryDatabase();
    seedRestaurant(database, "restaurant-a", revisions[0]);
    seedRestaurant(database, "restaurant-b", revisions[1]);
    await assert.rejects(
      startRatingRestaurantMergeHandler(
        request(restaurantMergeData()),
        baseContext(database),
      ),
      assertHttpsCode("aborted"),
    );
    assert.equal(database.writeCount, 0);
  }

  for (const missing of ["source", "target"]) {
    const database = new MemoryDatabase();
    if (missing !== "source") {
      seedRestaurant(database, "restaurant-a", 7);
    }
    if (missing !== "target") {
      seedRestaurant(database, "restaurant-b", 20);
    }
    await assert.rejects(
      startRatingRestaurantMergeHandler(
        request(restaurantMergeData()),
        baseContext(database),
      ),
      assertHttpsCode("not-found"),
    );
    assert.equal(database.writeCount, 0);
  }

  for (const missing of ["source", "target"]) {
    const database = new MemoryDatabase();
    if (missing !== "source") {
      seedDish(database, "dish-a", "restaurant-a", 3);
    }
    if (missing !== "target") {
      seedDish(database, "dish-b", "restaurant-a", 10);
    }
    seedRestaurant(database, "restaurant-a", 7);
    await assert.rejects(
      startRatingDishMergeHandler(
        request(dishMergeData()),
        baseContext(database),
      ),
      assertHttpsCode("not-found"),
    );
    assert.equal(database.writeCount, 0);
  }

  for (const state of [
    {sourceRestaurant: "restaurant-a", targetRestaurant: "restaurant-b"},
    {sourceChanges: {isActive: false}},
    {targetChanges: {isActive: false}},
    {sourceChanges: {mergedIntoDishId: "other-dish"}},
    {targetChanges: {mergedIntoDishId: "other-dish"}},
  ]) {
    const database = new MemoryDatabase();
    seedDish(
      database,
      "dish-a",
      state.sourceRestaurant ?? "restaurant-a",
      3,
      state.sourceChanges,
    );
    seedDish(
      database,
      "dish-b",
      state.targetRestaurant ?? "restaurant-a",
      10,
      state.targetChanges,
    );
    seedRestaurant(database, "restaurant-a", 7);
    seedRestaurant(database, "restaurant-b", 7);
    await assert.rejects(
      startRatingDishMergeHandler(
        request(dishMergeData()),
        baseContext(database),
      ),
      assertHttpsCode("failed-precondition"),
    );
    assert.equal(database.writeCount, 0);
  }
});

test("exact retry returns already-processing without a second start step", async () => {
  const database = new MemoryDatabase();
  seedRestaurant(database, "restaurant-a", 7);
  let processCalls = 0;
  const context = {
    ...baseContext(database),
    claim: async () => ({job: buildJob("restaurantDelete", {
      requestId: restaurantDeleteData().clientRequestId,
    }), claimed: false}),
    processStep: async () => {
      processCalls += 1;
      throw new Error("Exact retry must not process.");
    },
  };
  const result = await startRatingRestaurantDeleteHandler(
    request(restaurantDeleteData()),
    context,
  );
  assert.equal(processCalls, 0);
  assert.equal(result.accepted, false);
  assert.equal(result.messageCategory, "already_processing");
});

test("real handler claims reject malformed private state and retry mismatch", async () => {
  const malformedJobDatabase = new MemoryDatabase();
  seedRestaurant(malformedJobDatabase, "restaurant-a", 7);
  const malformedRequest = restaurantDeleteData({
    clientRequestId: "malformed-existing-job",
  });
  const malformedJobId = createRatingDestructiveJobId({
    requestId: malformedRequest.clientRequestId,
    operation: "restaurantDelete",
    ...identity("restaurantDelete"),
  });
  malformedJobDatabase.seed(ratingDestructiveJobPath(malformedJobId), {
    version: "malformed-private-job",
  });
  await assert.rejects(
    startRatingRestaurantDeleteHandler(
      request(malformedRequest),
      realClaimContext(malformedJobDatabase),
    ),
    assertHttpsCode("failed-precondition"),
  );
  assert.equal(malformedJobDatabase.writeCount, 0);

  const malformedLockDatabase = new MemoryDatabase();
  seedRestaurant(malformedLockDatabase, "restaurant-a", 7);
  malformedLockDatabase.seed(
    ratingRestaurantOperationLockPath("restaurant-a"),
    {version: "malformed-private-lock"},
  );
  await assert.rejects(
    startRatingRestaurantDeleteHandler(
      request(restaurantDeleteData({clientRequestId: "malformed-lock"})),
      realClaimContext(malformedLockDatabase),
    ),
    assertHttpsCode("failed-precondition"),
  );
  assert.equal(malformedLockDatabase.writeCount, 0);

  const retryDatabase = new MemoryDatabase();
  seedRestaurant(retryDatabase, "restaurant-a", 7);
  const original = restaurantDeleteData({clientRequestId: "retry-mismatch"});
  await startRatingRestaurantDeleteHandler(
    request(original),
    realClaimContext(retryDatabase),
  );
  const writesAfterClaim = retryDatabase.writeCount;
  await assert.rejects(
    startRatingRestaurantDeleteHandler(
      request({...original, expectedRestaurantRevision: 8}),
      realClaimContext(retryDatabase),
    ),
    assertHttpsCode("failed-precondition"),
  );
  assert.equal(retryDatabase.writeCount, writesAfterClaim);
});

test("authorization occurs before request parsing and protected reads", async () => {
  const database = new MemoryDatabase();
  const unauthenticatedContext = {
    ...baseContext(database),
    authenticate: () => {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    },
  };
  await assert.rejects(
    startRatingDishMergeHandler(request(null), unauthenticatedContext),
    assertHttpsCode("unauthenticated"),
  );
  assert.equal(database.readCount, 0);

  await assert.rejects(
    startRatingRestaurantMergeHandler(
      request(restaurantMergeData()),
      baseContext(database, owner),
    ),
    assertHttpsCode("permission-denied"),
  );
  await assert.rejects(
    startRatingRestaurantDeleteHandler(
      request(restaurantDeleteData()),
      baseContext(database, owner),
    ),
    assertHttpsCode("permission-denied"),
  );
  await assert.rejects(
    startRatingDishDeleteHandler(
      request(dishDeleteData()),
      baseContext(database, owner),
    ),
    assertHttpsCode("permission-denied"),
  );
  assert.equal(database.readCount, 0);
});

test("owner dishMerge derives relationship and persists only caller binding", async () => {
  const database = new MemoryDatabase();
  seedDish(database, "dish-a", "restaurant-a", 3);
  seedDish(database, "dish-b", "restaurant-a", 10);
  seedRestaurant(database, "restaurant-a", 7, {
    isActive: false,
    isClaimed: true,
    ownerUserId: owner.uid,
  });
  const context = {
    ...baseContext(database, owner),
    processStep: async (_dependencies, jobId) => ({
      job: database.data(ratingDestructiveJobPath(jobId)),
      processedDocuments: 0,
    }),
  };
  const result = await startRatingDishMergeHandler(
    request(dishMergeData()),
    context,
  );
  const job = database.data(ratingDestructiveJobPath(result.operationId));
  assert.equal(job.authorizedCallerKind, "owner");
  assert.equal(
    job.callerBindingFingerprint,
    createRatingDestructiveCallerBindingFingerprint(owner.uid),
  );
  assert.equal("authorizedCallerUid" in job, false);
  assert.equal(JSON.stringify(job).includes(owner.uid), false);

  const denied = new MemoryDatabase();
  seedDish(denied, "dish-a", "restaurant-a", 3);
  seedDish(denied, "dish-b", "restaurant-a", 10);
  seedRestaurant(denied, "restaurant-a", 7, {
    isClaimed: true,
    ownerUserId: "unrelated-owner",
  });
  await assert.rejects(
    startRatingDishMergeHandler(
      request(dishMergeData()),
      baseContext(denied, owner),
    ),
    assertHttpsCode("permission-denied"),
  );
  assert.equal(denied.writeCount, 0);

  const unclaimed = new MemoryDatabase();
  seedDish(unclaimed, "dish-a", "restaurant-a", 3);
  seedDish(unclaimed, "dish-b", "restaurant-a", 10);
  seedRestaurant(unclaimed, "restaurant-a", 7, {
    isClaimed: false,
    ownerUserId: owner.uid,
  });
  await assert.rejects(
    startRatingDishMergeHandler(
      request(dishMergeData()),
      baseContext(unclaimed, owner),
    ),
    assertHttpsCode("permission-denied"),
  );
  assert.equal(unclaimed.writeCount, 0);
});

test("status is exact, non-disclosing, caller-bound, and performs zero writes", async () => {
  const database = new MemoryDatabase();
  const ownerJob = buildJob("dishMerge", {
    authorizedCallerKind: "owner",
    callerBindingFingerprint:
      createRatingDestructiveCallerBindingFingerprint(owner.uid),
  });
  database.seed(ratingDestructiveJobPath(ownerJob.jobId), ownerJob);
  const statusData = {
    contractVersion: ratingDestructiveCallableContractVersion,
    operationId: ownerJob.jobId,
    clientRequestId: "status-request",
  };
  const readsBeforeUnauthenticated = database.readCount;
  await assert.rejects(
    getRatingDestructiveOperationStatusHandler(request(statusData), {
      privateDatabase: database,
      authenticate: () => {
        throw new HttpsError("unauthenticated", "Authentication is required.");
      },
    }),
    assertHttpsCode("unauthenticated"),
  );
  assert.equal(database.readCount, readsBeforeUnauthenticated);
  const ownerResult = await getRatingDestructiveOperationStatusHandler(
    request(statusData),
    {privateDatabase: database, authenticate: () => owner},
  );
  const adminResult = await getRatingDestructiveOperationStatusHandler(
    request(statusData),
    {privateDatabase: database, authenticate: () => admin},
  );
  assert.deepEqual(ownerResult, adminResult);
  assert.equal(ownerResult.messageCategory, "current_status");
  assert.equal(database.writeCount, 0);
  assert.deepEqual(Object.keys(ownerResult).sort(), [
    "accepted", "complete", "contractVersion", "createdAtMs",
    "manualReviewRequired", "messageCategory", "operation", "operationId",
    "phaseProcessedCount", "processedCount", "processing",
    "progressCategory", "retryable", "status", "updatedAtMs",
  ]);
  for (const forbidden of [
    "phase", "failureCode", "authorizedCallerKind",
    "callerBindingFingerprint", "cursorDocumentId", "itemCursorId",
    "expectedSourceAggregateGeneration", "ownerUserId", "uid",
  ]) {
    assert.equal(Object.hasOwn(ownerResult, forbidden), false);
  }

  await assert.rejects(
    getRatingDestructiveOperationStatusHandler(request(statusData), {
      privateDatabase: database,
      authenticate: () => ({
        uid: "different-owner",
        authorizedCallerKind: "owner",
      }),
    }),
    assertHttpsCode("not-found"),
  );
  await assert.rejects(
    getRatingDestructiveOperationStatusHandler(request({
      ...statusData,
      operationId: "f".repeat(64),
    }), {
      privateDatabase: database,
      authenticate: () => owner,
    }),
    assertHttpsCode("not-found"),
  );
  assert.equal(database.writeCount, 0);

  const malformedDatabase = new MemoryDatabase();
  const malformedId = "b".repeat(64);
  malformedDatabase.seed(ratingDestructiveJobPath(malformedId), {
    version: "malformed-private-job",
  });
  await assert.rejects(
    getRatingDestructiveOperationStatusHandler(request({
      ...statusData,
      operationId: malformedId,
    }), {
      privateDatabase: malformedDatabase,
      authenticate: () => admin,
    }),
    assertHttpsCode("failed-precondition"),
  );
  assert.equal(malformedDatabase.writeCount, 0);
});

test("safe summaries cover active, retryable, manual, and complete states", () => {
  const expected = [
    [buildJob("restaurantMerge"), "starting", true, false,
      "accepted_processing"],
    [buildJob("restaurantMerge", {status: "retryable"}), "waiting_retry",
      true, false, "retryable_processing"],
    [buildJob("restaurantMerge", {status: "manual_review_required"}),
      "needs_attention", false, false, "manual_review_required"],
    [buildJob("restaurantMerge", {status: "complete"}), "complete", false,
      true, "accepted_complete"],
  ];
  for (const [job, progress, processing, complete, message] of expected) {
    const summary = buildRatingDestructiveOperationSummary(job, {
      accepted: true,
      mode: "start",
    });
    assert.equal(summary.contractVersion,
      ratingDestructiveSummaryContractVersion);
    assert.equal(summary.progressCategory, progress);
    assert.equal(summary.processing, processing);
    assert.equal(summary.complete, complete);
    assert.equal(summary.messageCategory, message);
    assert.equal(summary.retryable, job.status === "retryable");
    assert.equal(summary.manualReviewRequired,
      job.status === "manual_review_required");
  }
});

test("admin exact-status handler safely projects every strict job status", async () => {
  const database = new MemoryDatabase();
  for (const status of [
    "active", "retryable", "manual_review_required", "complete",
  ]) {
    const job = buildJob("restaurantMerge", {
      requestId: `status-${status}`,
      status,
    });
    database.seed(ratingDestructiveJobPath(job.jobId), job);
    const result = await getRatingDestructiveOperationStatusHandler(request({
      contractVersion: ratingDestructiveCallableContractVersion,
      operationId: job.jobId,
      clientRequestId: `read-${status}`,
    }), {
      privateDatabase: database,
      authenticate: () => admin,
    });
    assert.equal(result.status, status);
    assert.equal(result.messageCategory, "current_status");
    assert.equal(result.complete, status === "complete");
    assert.equal(result.retryable, status === "retryable");
    assert.equal(result.manualReviewRequired,
      status === "manual_review_required");
  }
  assert.equal(database.writeCount, 0);
});
