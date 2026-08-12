const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const contract = require("../lib/rating_destructive_job_contract.js");

const now = new Date("2026-08-11T12:00:00.000Z");
const later = new Date("2026-08-11T12:01:00.000Z");

function operationIdentity(operation) {
  switch (operation) {
  case "restaurantMerge":
    return {
      sourceRestaurantId: "restaurant-source",
      targetRestaurantId: "restaurant-target",
      sourceDishId: null,
      targetDishId: null,
      restaurantId: null,
    };
  case "restaurantDelete":
    return {
      sourceRestaurantId: "restaurant-source",
      targetRestaurantId: null,
      sourceDishId: null,
      targetDishId: null,
      restaurantId: null,
    };
  case "dishMerge":
    return {
      sourceRestaurantId: null,
      targetRestaurantId: null,
      sourceDishId: "dish-source",
      targetDishId: "dish-target",
      restaurantId: "restaurant",
    };
  case "dishDelete":
    return {
      sourceRestaurantId: null,
      targetRestaurantId: null,
      sourceDishId: "dish-source",
      targetDishId: null,
      restaurantId: null,
    };
  default:
    throw new Error("unsupported test operation");
  }
}

function aggregateStateForDish(dishId, changes = {}) {
  return {
    accumulatorVersion: "bitestar.dish-review-aggregate-accumulator.v1",
    dishId,
    committedRatingCount: 3,
    overallBiteScoreSum: 12.5,
    overallImpressionSum: 11,
    tastinessScoreSum: 4,
    tastinessScoreCount: 1,
    qualityScoreSum: 8,
    qualityScoreCount: 2,
    valueScoreSum: 5,
    valueScoreCount: 1,
    ...changes,
  };
}

const jobPhases = {
  restaurantMerge: [
    "claimed", "move_dishes", "move_reviews",
    "rebuild_moved_dish_aggregates", "move_claim_requests",
    "move_dish_proposals", "move_restaurant_reports", "move_dish_reports",
    "move_review_reports", "move_review_feedback_votes",
    "resolve_duplicate_reports", "finalize_restaurants", "complete",
  ],
  restaurantDelete: [
    "claimed", "process_dishes", "process_orphan_reviews",
    "delete_restaurant_reports", "delete_duplicate_reports",
    "reconcile_milestone_users", "finalize_restaurant", "complete",
  ],
  dishMerge: [
    "validate", "move_reviews", "rebuild_target_aggregate",
    "fold_target_aggregate", "rebuild_source_aggregate",
    "fold_source_aggregate", "finalize_dishes", "complete",
  ],
  dishDelete: [
    "process_reviews", "reverse_contribution_points", "delete_dish_reports",
    "delete_aggregate", "delete_dish", "reconcile_milestone_users",
    "complete",
  ],
};

const jobContinuationFields = [
  "cursorDocumentId",
  "itemCursorId",
  "aggregateCursorDocumentId",
  "aggregateWinnerCursorId",
  "aggregateState",
];

function jobContinuation(operation, phase) {
  const empty = {
    cursorDocumentId: null,
    itemCursorId: null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
  };
  if (operation === "restaurantDelete" && phase === "process_dishes") {
    return {...empty, itemCursorId: "restaurant-delete-item"};
  }
  if (operation === "dishDelete" && phase !== "complete") {
    return {...empty, itemCursorId: "dish-delete-item"};
  }
  if (operation !== "dishMerge") return empty;
  if (phase === "move_reviews") {
    return {...empty, cursorDocumentId: "review-cursor"};
  }
  if (
    phase === "rebuild_target_aggregate" ||
    phase === "rebuild_source_aggregate"
  ) {
    return {...empty, aggregateCursorDocumentId: "aggregate-review-cursor"};
  }
  if (phase === "fold_target_aggregate") {
    return {
      ...empty,
      aggregateWinnerCursorId: "target-winner-cursor",
      aggregateState: aggregateStateForDish("dish-target"),
    };
  }
  if (phase === "fold_source_aggregate") {
    return {
      ...empty,
      aggregateWinnerCursorId: "source-winner-cursor",
      aggregateState: aggregateStateForDish("dish-source"),
    };
  }
  return empty;
}

function ownedJobContinuationFields(operation, phase) {
  if (operation === "restaurantDelete" && phase === "process_dishes") {
    return new Set(["itemCursorId"]);
  }
  if (operation === "dishDelete" && phase !== "complete") {
    return new Set(["itemCursorId"]);
  }
  if (operation === "dishMerge" && phase === "move_reviews") {
    return new Set(["cursorDocumentId"]);
  }
  if (
    operation === "dishMerge" &&
    (phase === "rebuild_target_aggregate" ||
      phase === "rebuild_source_aggregate")
  ) {
    return new Set(["aggregateCursorDocumentId"]);
  }
  if (
    operation === "dishMerge" &&
    (phase === "fold_target_aggregate" || phase === "fold_source_aggregate")
  ) {
    return new Set(["aggregateWinnerCursorId", "aggregateState"]);
  }
  return new Set();
}

function jobCore(operation, changes = {}) {
  const identity = {...operationIdentity(operation), ...changes};
  const requestId = changes.requestId ?? `request-${operation}`;
  const jobId = changes.jobId ?? contract.createRatingDestructiveJobId({
    requestId,
    operation,
    sourceRestaurantId: identity.sourceRestaurantId,
    targetRestaurantId: identity.targetRestaurantId,
    sourceDishId: identity.sourceDishId,
    targetDishId: identity.targetDishId,
    restaurantId: identity.restaurantId,
  });
  const revisions = operation === "restaurantMerge"
    ? {
      expectedSourceRestaurantRevision: 7,
      sourceActiveRestaurantRevision: 8,
      sourceCompletionRestaurantRevision: 9,
      expectedTargetRestaurantRevision: 20,
      targetActiveRestaurantRevision: 21,
      targetCompletionRestaurantRevision: 22,
    }
    : operation === "restaurantDelete"
      ? {
        expectedSourceRestaurantRevision: 7,
        sourceActiveRestaurantRevision: 8,
        sourceCompletionRestaurantRevision: null,
        expectedTargetRestaurantRevision: null,
        targetActiveRestaurantRevision: null,
        targetCompletionRestaurantRevision: null,
      }
      : {
        expectedSourceRestaurantRevision: null,
        sourceActiveRestaurantRevision: null,
        sourceCompletionRestaurantRevision: null,
        expectedTargetRestaurantRevision: null,
        targetActiveRestaurantRevision: null,
        targetCompletionRestaurantRevision: null,
      };
  const generations = operation === "dishMerge"
    ? {
      expectedSourceAggregateGeneration: 2,
      sourceActiveAggregateGeneration: 3,
      sourceCompletionAggregateGeneration: 4,
      expectedTargetAggregateGeneration: 10,
      targetActiveAggregateGeneration: 11,
      targetCompletionAggregateGeneration: 12,
    }
    : {
      expectedSourceAggregateGeneration: null,
      sourceActiveAggregateGeneration: null,
      sourceCompletionAggregateGeneration: null,
      expectedTargetAggregateGeneration: null,
      targetActiveAggregateGeneration: null,
      targetCompletionAggregateGeneration: null,
    };
  const phase = changes.phase ?? ({
    restaurantMerge: "claimed",
    restaurantDelete: "claimed",
    dishMerge: "validate",
    dishDelete: "process_reviews",
  })[operation];
  const status = changes.status ?? (phase === "complete" ? "complete" : "active");
  return {
    jobId,
    requestId,
    operation,
    status,
    phase,
    sourceRestaurantId: identity.sourceRestaurantId,
    targetRestaurantId: identity.targetRestaurantId,
    sourceDishId: identity.sourceDishId,
    targetDishId: identity.targetDishId,
    restaurantId: identity.restaurantId,
    ...revisions,
    ...generations,
    ...jobContinuation(operation, phase),
    processedCount: 0,
    phaseProcessedCount: 0,
    failureCode: null,
    createdAt: now,
    updatedAt: later,
    completedAt: phase === "complete" ? later : null,
    ...changes,
    jobId,
    requestId,
  };
}

function buildJob(operation, changes = {}) {
  return contract.buildRatingDestructiveJobDocument(jobCore(operation, changes));
}

function stored(document, idField) {
  return {id: document[idField], data: {...document}};
}

function malformed(document, idField, changes) {
  return {id: document[idField], data: {...document, ...changes}};
}

function canonicalize(value) {
  if (value instanceof Date) return {$date: value.toISOString()};
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function structuralSha(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function resignContractDocument(document, changes) {
  const data = {...document, ...changes};
  const version = data.version;
  const core = {...data};
  delete core.version;
  delete core.fingerprint;
  return {
    ...data,
    fingerprint: structuralSha({version, core}),
  };
}

function assertInvalidState(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.name, "RatingDestructiveContractError");
    assert.equal(error.code, "invalid-state");
    assert.equal(error.message, "Stored rating destructive state is invalid.");
    return true;
  });
}

function assertInvalidRequest(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.name, "RatingDestructiveContractError");
    assert.equal(error.code, "invalid-request");
    assert.equal(error.message, "Rating destructive contract input is invalid.");
    return true;
  });
}

test("exports only the four destructive operations through strict job builders", () => {
  for (const operation of [
    "restaurantMerge", "restaurantDelete", "dishMerge", "dishDelete",
  ]) {
    const document = buildJob(operation);
    assert.equal(document.operation, operation);
    assert.match(document.jobId, /^[a-f0-9]{64}$/u);
    assert.match(document.fingerprint, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      contract.parseRatingDestructiveJobDocument(stored(document, "jobId")),
      document,
    );
  }
  assertInvalidRequest(() => contract.createRatingDestructiveJobId({
    requestId: "request",
    operation: "genericDelete",
    sourceRestaurantId: "restaurant",
    targetRestaurantId: null,
    sourceDishId: null,
    targetDishId: null,
    restaurantId: null,
  }));
});

test("job phase matrix owns only exact continuation fields", () => {
  const futureState = {
    cursorDocumentId: "future-review-cursor",
    itemCursorId: "future-item-cursor",
    aggregateCursorDocumentId: "future-aggregate-cursor",
    aggregateWinnerCursorId: "future-winner-cursor",
    aggregateState: aggregateStateForDish("dish-target"),
  };
  for (const [operation, allowed] of Object.entries(jobPhases)) {
    for (const phase of allowed) {
      const document = buildJob(operation, {phase});
      assert.equal(
        contract.parseRatingDestructiveJobDocument(
          stored(document, "jobId"),
        ).phase,
        phase,
      );
      const owned = ownedJobContinuationFields(operation, phase);
      for (const field of jobContinuationFields) {
        if (owned.has(field)) continue;
        assertInvalidRequest(() => contract.buildRatingDestructiveJobDocument({
          ...jobCore(operation, {phase}),
          [field]: futureState[field],
        }));
        const forged = resignContractDocument(document, {
          [field]: futureState[field],
        });
        assertInvalidState(() => contract.parseRatingDestructiveJobDocument({
          id: document.jobId,
          data: forged,
        }));
      }

      const nullableOwned = [...owned].filter((field) => !(
        operation === "dishDelete" && field === "itemCursorId"
      ));
      if (nullableOwned.length > 0) {
        const cleared = Object.fromEntries(
          nullableOwned.map((field) => [field, null]),
        );
        const cleanStart = buildJob(operation, {phase, ...cleared});
        assert.deepEqual(
          contract.parseRatingDestructiveJobDocument(
            stored(cleanStart, "jobId"),
          ),
          cleanStart,
        );
      }

      if (operation === "dishDelete" && phase !== "complete") {
        assertInvalidRequest(() => buildJob(operation, {
          phase,
          itemCursorId: null,
        }));
        const forged = resignContractDocument(document, {itemCursorId: null});
        assertInvalidState(() => contract.parseRatingDestructiveJobDocument({
          id: document.jobId,
          data: forged,
        }));
      }

      if (phase === "complete") {
        assert.equal(document.phaseProcessedCount, 0);
        assertInvalidRequest(() => buildJob(operation, {
          phase,
          phaseProcessedCount: 1,
        }));
        const forged = resignContractDocument(document, {
          phaseProcessedCount: 1,
        });
        assertInvalidState(() => contract.parseRatingDestructiveJobDocument({
          id: document.jobId,
          data: forged,
        }));
      }

      if (phase === "fold_target_aggregate" || phase === "fold_source_aggregate") {
        for (const changes of [
          {aggregateWinnerCursorId: null},
          {aggregateState: null},
          {aggregateState: aggregateStateForDish(
            phase === "fold_target_aggregate" ? "dish-source" : "dish-target",
          )},
        ]) {
          assertInvalidRequest(() => buildJob(operation, {phase, ...changes}));
          const forged = resignContractDocument(document, changes);
          assertInvalidState(() => contract.parseRatingDestructiveJobDocument({
            id: document.jobId,
            data: forged,
          }));
        }
      }
    }
  }
});

test("job parser fails closed for version, operation, phase, and status", () => {
  const document = buildJob("restaurantMerge");
  assertInvalidState(() => contract.parseRatingDestructiveJobDocument(
    malformed(document, "jobId", {version: "v0"}),
  ));
  assertInvalidState(() => contract.parseRatingDestructiveJobDocument(
    malformed(document, "jobId", {operation: "dishDelete"}),
  ));
  assertInvalidState(() => contract.parseRatingDestructiveJobDocument(
    malformed(document, "jobId", {phase: "delete_everything"}),
  ));
  assertInvalidState(() => contract.parseRatingDestructiveJobDocument(
    malformed(document, "jobId", {status: "failed"}),
  ));
});

test("job parser fails closed for malformed cursor, integer, timestamp, and keys", () => {
  const document = buildJob("restaurantMerge");
  for (const changes of [
    {cursorDocumentId: "not/a/document-id"},
    {processedCount: Number.MAX_SAFE_INTEGER + 1},
    {updatedAt: new Date(Number.NaN)},
    {unexpected: true},
  ]) {
    assertInvalidState(() => contract.parseRatingDestructiveJobDocument(
      malformed(document, "jobId", changes),
    ));
  }
  const missing = {...document};
  delete missing.phaseProcessedCount;
  assertInvalidState(() => contract.parseRatingDestructiveJobDocument({
    id: document.jobId,
    data: missing,
  }));
});

test("job operation identities, revisions, generations, and targets are exact", () => {
  assertInvalidRequest(() => buildJob("restaurantMerge", {
    targetRestaurantId: null,
  }));
  assertInvalidRequest(() => buildJob("restaurantMerge", {
    targetRestaurantId: "restaurant-source",
  }));
  assertInvalidRequest(() => buildJob("restaurantDelete", {
    targetRestaurantId: "forbidden-target",
  }));
  for (const [field, value] of [
    ["sourceRestaurantId", "forbidden-source-restaurant"],
    ["targetRestaurantId", "forbidden-target-restaurant"],
    ["targetDishId", "forbidden-target-dish"],
    ["restaurantId", "forbidden-restaurant"],
  ]) {
    assertInvalidRequest(() => buildJob("dishDelete", {[field]: value}));
    assertInvalidRequest(() => contract.createRatingDestructiveJobId({
      requestId: "dish-delete-invalid-identity",
      operation: "dishDelete",
      ...operationIdentity("dishDelete"),
      [field]: value,
    }));
  }
  assertInvalidRequest(() => buildJob("dishDelete", {sourceDishId: null}));
  assertInvalidRequest(() => buildJob("dishMerge", {
    sourceActiveAggregateGeneration: 4,
  }));
  assertInvalidRequest(() => buildJob("restaurantMerge", {
    targetCompletionRestaurantRevision: 23,
  }));

  const validDishDelete = buildJob("dishDelete");
  assert.equal(validDishDelete.restaurantId, null);
  const forgedIdentity = {
    requestId: validDishDelete.requestId,
    operation: "dishDelete",
    sourceRestaurantId: null,
    targetRestaurantId: null,
    sourceDishId: validDishDelete.sourceDishId,
    targetDishId: null,
    restaurantId: "forbidden-stored-restaurant",
  };
  const forgedJobId = structuralSha({
    version: contract.ratingDestructiveJobVersion,
    identity: forgedIdentity,
  });
  const forgedDishDelete = resignContractDocument(validDishDelete, {
    jobId: forgedJobId,
    restaurantId: forgedIdentity.restaurantId,
  });
  assertInvalidState(() => contract.parseRatingDestructiveJobDocument({
    id: forgedJobId,
    data: forgedDishDelete,
  }));
});

test("job status, completion, and bounded aggregate state are strict", () => {
  assertInvalidRequest(() => buildJob("restaurantMerge", {
    status: "retryable",
  }));
  assertInvalidRequest(() => buildJob("restaurantMerge", {
    status: "complete",
  }));
  assertInvalidRequest(() => buildJob("restaurantMerge", {
    failureCode: "temporary_dependency",
  }));
  const retryable = buildJob("restaurantMerge", {
    status: "retryable",
    failureCode: "temporary_dependency",
  });
  assert.equal(retryable.failureCode, "temporary_dependency");
  const aggregateState = {
    accumulatorVersion: "bitestar.dish-review-aggregate-accumulator.v1",
    dishId: "dish-target",
    committedRatingCount: 3,
    overallBiteScoreSum: 12.5,
    overallImpressionSum: 11,
    tastinessScoreSum: 4,
    tastinessScoreCount: 1,
    qualityScoreSum: 8,
    qualityScoreCount: 2,
    valueScoreSum: 5,
    valueScoreCount: 1,
  };
  const aggregateJob = buildJob("dishMerge", {
    phase: "fold_target_aggregate",
    aggregateWinnerCursorId: "winner-cursor",
    aggregateState,
  });
  assert.deepEqual(aggregateJob.aggregateState, aggregateState);
  assertInvalidRequest(() => buildJob("restaurantMerge", {aggregateState}));
  assertInvalidRequest(() => buildJob("dishMerge", {
    phase: "fold_target_aggregate",
    aggregateWinnerCursorId: "winner-cursor",
    aggregateState: {...aggregateState, arbitraryPayload: "forbidden"},
  }));
});

test("job absence differs from malformed-present state and fingerprints bind IDs", () => {
  assert.equal(contract.parseRatingDestructiveJobDocument(null), null);
  const document = buildJob("dishDelete");
  assertInvalidState(() => contract.parseRatingDestructiveJobDocument({
    id: "different-job-id",
    data: document,
  }));
  assertInvalidState(() => contract.parseRatingDestructiveJobDocument(
    malformed(document, "jobId", {fingerprint: "0".repeat(64)}),
  ));
});

test("exact opaque Firestore IDs are not trimmed or over-rejected", () => {
  const opaqueSource = " \t__source__\u0000 ";
  const opaqueTarget = "\u007ftarget ";
  const document = buildJob("restaurantMerge", {
    requestId: " internal request \u0001 ",
    sourceRestaurantId: opaqueSource,
    targetRestaurantId: opaqueTarget,
  });
  assert.equal(document.sourceRestaurantId, opaqueSource);
  assert.equal(document.targetRestaurantId, opaqueTarget);
  assert.equal(
    contract.ratingRestaurantOperationLockPath(opaqueSource),
    `private_rating_restaurant_operation_locks/${opaqueSource}`,
  );
  for (const invalid of ["", ".", "..", "has/slash", "x".repeat(1501)]) {
    assertInvalidRequest(() => contract.ratingDishOperationLockPath(invalid));
  }
  assert.doesNotThrow(() => contract.ratingDishOperationLockPath(
    "😀".repeat(375),
  ));
  assertInvalidRequest(() => contract.ratingDishOperationLockPath(
    `${"😀".repeat(375)}a`,
  ));
});

test("job IDs use canonical structural SHA-256 and do not expose identity text", () => {
  const first = contract.createRatingDestructiveJobId({
    requestId: "pii-canary@example.test",
    operation: "dishMerge",
    sourceRestaurantId: null,
    targetRestaurantId: null,
    sourceDishId: "source|dish",
    targetDishId: "target",
    restaurantId: "restaurant",
  });
  const reordered = contract.createRatingDestructiveJobId({
    restaurantId: "restaurant",
    targetDishId: "target",
    sourceDishId: "source|dish",
    targetRestaurantId: null,
    sourceRestaurantId: null,
    operation: "dishMerge",
    requestId: "pii-canary@example.test",
  });
  const unambiguousOther = contract.createRatingDestructiveJobId({
    requestId: "pii-canary@example.test",
    operation: "dishMerge",
    sourceRestaurantId: null,
    targetRestaurantId: null,
    sourceDishId: "source",
    targetDishId: "dish|target",
    restaurantId: "restaurant",
  });
  assert.equal(first, reordered);
  assert.notEqual(first, unambiguousOther);
  assert.equal(first.includes("pii-canary"), false);
  assert.match(first, /^[a-f0-9]{64}$/u);
});

const itemSubphases = {
  movedDish: [
    "pending", "rebuild_aggregate", "fold_aggregate", "complete",
  ],
  dishDeletion: [
    "claimed_or_attached", "process_reviews", "reverse_contribution_points",
    "delete_dish_reports", "delete_aggregate", "delete_dish",
    "reconcile_milestone_users", "complete",
  ],
  milestoneUser: [
    "claim_lock", "reset_count_accumulator", "count_reviews",
    "reconcile_milestones", "record_terminal", "release_lock", "complete",
  ],
};

const itemContinuationFields = [
  "currentReviewId",
  "cursorDocumentId",
  "secondaryCursorDocumentId",
  "aggregateCursorDocumentId",
  "aggregateWinnerCursorId",
  "aggregateState",
  "pointReversalCursor",
  "milestoneResetCursor",
  "milestoneReviewCursor",
  "milestoneReconcileCursor",
  "milestoneLockToken",
  "milestoneScanId",
  "validReviewCount",
];

function pointCursorFor(jobId, dishId, afterLedgerDocumentId = "ledger-cursor") {
  const version = "bitestar.contribution-dish-reverse-cursor.v2";
  const operationFingerprint = rawSha([
    "bitestar.review-milestone-operation.v1",
    ["operationId", jobId],
  ]);
  const dishFingerprint = rawSha([
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
    fingerprint: rawSha([
      version,
      ["phase", core.phase],
      ["operationFingerprint", operationFingerprint],
      ["dishFingerprint", dishFingerprint],
      ["afterLedgerDocumentId", afterLedgerDocumentId],
    ]),
  };
}

function milestoneCursorBundle(itemId, jobId, userId, lockToken, scanId) {
  const accumulatorVersion = "bitestar.review-milestone-accumulator.v2";
  const userFingerprint = rawSha([
    accumulatorVersion,
    ["userId", userId],
  ]);
  const operationFingerprint = rawSha([
    "bitestar.review-milestone-operation.v1",
    ["operationId", jobId],
  ]);
  const lockFingerprint = rawSha([
    "bitestar.review-milestone-lock-binding.v1",
    ["userId", userId],
    ["operationId", jobId],
    ["lockToken", lockToken],
  ]);
  const scanFingerprint = rawSha([
    accumulatorVersion,
    ["namespaceId", itemId],
    ["userFingerprint", userFingerprint],
    ["operationFingerprint", operationFingerprint],
    ["lockFingerprint", lockFingerprint],
    ["scanId", scanId],
  ]);
  const resetVersion =
    "bitestar.review-milestone-accumulator-reset-cursor.v2";
  const resetCore = {
    version: resetVersion,
    phase: "accumulator-reset",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    scanFingerprint,
    afterWinnerDocumentId: "winner-cursor",
  };
  const reset = {
    ...resetCore,
    fingerprint: rawSha([
      resetVersion,
      ["phase", resetCore.phase],
      ["userFingerprint", userFingerprint],
      ["operationFingerprint", operationFingerprint],
      ["lockFingerprint", lockFingerprint],
      ["scanFingerprint", scanFingerprint],
      ["afterWinnerDocumentId", resetCore.afterWinnerDocumentId],
    ]),
  };
  const reviewVersion = "bitestar.review-milestone-review-cursor.v3";
  const reviewCore = {
    version: reviewVersion,
    phase: "review-scan",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    scanFingerprint,
    sequence: 1,
    afterReviewDocumentId: "review-cursor",
  };
  const review = {
    ...reviewCore,
    fingerprint: rawSha([
      reviewVersion,
      ["phase", reviewCore.phase],
      ["userFingerprint", userFingerprint],
      ["operationFingerprint", operationFingerprint],
      ["lockFingerprint", lockFingerprint],
      ["scanFingerprint", scanFingerprint],
      ["sequence", reviewCore.sequence],
      ["afterReviewDocumentId", reviewCore.afterReviewDocumentId],
    ]),
  };
  const reconcileVersion = "bitestar.review-milestone-reconcile-cursor.v2";
  const countStateFingerprint = rawSha("count-state");
  const reconcileCore = {
    version: reconcileVersion,
    phase: "ledger",
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    countStateFingerprint,
    afterLedgerDocumentId: "milestone-ledger-cursor",
  };
  const reconcile = {
    ...reconcileCore,
    fingerprint: rawSha([
      reconcileVersion,
      ["phase", reconcileCore.phase],
      ["userFingerprint", userFingerprint],
      ["operationFingerprint", operationFingerprint],
      ["lockFingerprint", lockFingerprint],
      ["countStateFingerprint", countStateFingerprint],
      ["afterLedgerDocumentId", reconcileCore.afterLedgerDocumentId],
    ]),
  };
  return {reset, review, reconcile};
}

function itemContinuation(kind, subphase, identity) {
  const empty = Object.fromEntries(
    itemContinuationFields.map((field) => [field, null]),
  );
  if (kind === "movedDish" && subphase === "rebuild_aggregate") {
    return {...empty, aggregateCursorDocumentId: "aggregate-review-cursor"};
  }
  if (kind === "movedDish" && subphase === "fold_aggregate") {
    return {
      ...empty,
      aggregateWinnerCursorId: "aggregate-winner-cursor",
      aggregateState: aggregateStateForDish(identity.dishId),
    };
  }
  if (kind === "dishDeletion" && subphase === "reverse_contribution_points") {
    return {
      ...empty,
      pointReversalCursor: pointCursorFor(identity.jobId, identity.dishId),
    };
  }
  if (kind !== "milestoneUser" || subphase === "complete") return empty;
  const milestoneLockToken = "a".repeat(64);
  const milestoneScanId = identity.itemId;
  const cursors = milestoneCursorBundle(
    identity.itemId,
    identity.jobId,
    identity.userId,
    milestoneLockToken,
    milestoneScanId,
  );
  return {
    ...empty,
    milestoneResetCursor: subphase === "reset_count_accumulator"
      ? cursors.reset
      : null,
    milestoneReviewCursor: subphase === "count_reviews"
      ? cursors.review
      : null,
    milestoneReconcileCursor: subphase === "reconcile_milestones"
      ? cursors.reconcile
      : null,
    milestoneLockToken,
    milestoneScanId,
    validReviewCount: [
      "reconcile_milestones", "record_terminal", "release_lock",
    ].includes(subphase) ? 11 : null,
  };
}

function ownedItemContinuationFields(kind, subphase) {
  const owned = new Set();
  if (kind === "movedDish" && subphase === "rebuild_aggregate") {
    owned.add("aggregateCursorDocumentId");
  }
  if (kind === "movedDish" && subphase === "fold_aggregate") {
    owned.add("aggregateWinnerCursorId");
    owned.add("aggregateState");
  }
  if (kind === "dishDeletion" && subphase === "reverse_contribution_points") {
    owned.add("pointReversalCursor");
  }
  if (kind === "milestoneUser" && subphase !== "complete") {
    owned.add("milestoneLockToken");
    owned.add("milestoneScanId");
    if (subphase === "reset_count_accumulator") {
      owned.add("milestoneResetCursor");
    }
    if (subphase === "count_reviews") owned.add("milestoneReviewCursor");
    if (subphase === "reconcile_milestones") {
      owned.add("milestoneReconcileCursor");
    }
    if ([
      "reconcile_milestones", "record_terminal", "release_lock",
    ].includes(subphase)) {
      owned.add("validReviewCount");
    }
  }
  return owned;
}

function requiredItemContinuationFields(kind, subphase) {
  const required = new Set();
  if (kind === "milestoneUser" && subphase !== "complete") {
    required.add("milestoneLockToken");
    required.add("milestoneScanId");
  }
  if (
    kind === "milestoneUser" &&
    ["reconcile_milestones", "record_terminal", "release_lock"].includes(
      subphase,
    )
  ) {
    required.add("validReviewCount");
  }
  return required;
}

function itemCore(kind, operation, changes = {}) {
  const identity = kind === "movedDish"
    ? {restaurantId: "restaurant-target", dishId: "moved-dish", userId: null}
    : kind === "dishDeletion"
      ? {restaurantId: "restaurant", dishId: "deleted-dish", userId: null}
      : {restaurantId: null, dishId: null, userId: "affected-user"};
  Object.assign(identity, changes);
  const job = buildJob(operation);
  const jobId = changes.jobId ?? job.jobId;
  const itemId = changes.itemId ?? contract.createRatingDestructiveJobItemId({
    jobId,
    operation,
    kind,
    ...identity,
  });
  const subphase = changes.subphase ?? ({
    movedDish: "pending",
    dishDeletion: "claimed_or_attached",
    milestoneUser: "claim_lock",
  })[kind];
  const itemStatus = changes.status ??
    (subphase === "complete" ? "complete" : "active");
  const continuation = itemContinuation(kind, subphase, {
    itemId,
    jobId,
    dishId: identity.dishId,
    userId: identity.userId,
  });
  return {
    itemId,
    jobId,
    operation,
    kind,
    status: itemStatus,
    subphase,
    ...identity,
    ...continuation,
    processedCount: 0,
    failureCode: null,
    createdAt: now,
    updatedAt: later,
    completedAt: subphase === "complete" ? later : null,
    ...changes,
    itemId,
    jobId,
  };
}

function buildItem(kind, operation, changes = {}) {
  return contract.buildRatingDestructiveJobItemDocument(
    itemCore(kind, operation, changes),
  );
}

function futureItemContinuation(core) {
  const lockToken = core.milestoneLockToken ?? "a".repeat(64);
  const scanId = core.milestoneScanId ?? core.itemId;
  const milestoneCursors = core.userId === null
    ? {reset: {}, review: {}, reconcile: {}}
    : milestoneCursorBundle(
      core.itemId,
      core.jobId,
      core.userId,
      lockToken,
      scanId,
    );
  return {
    currentReviewId: "future-current-review",
    cursorDocumentId: "future-primary-cursor",
    secondaryCursorDocumentId: "future-secondary-cursor",
    aggregateCursorDocumentId: "future-aggregate-cursor",
    aggregateWinnerCursorId: "future-winner-cursor",
    aggregateState: aggregateStateForDish(core.dishId ?? "future-dish"),
    pointReversalCursor: core.dishId === null
      ? {}
      : pointCursorFor(core.jobId, core.dishId),
    milestoneResetCursor: milestoneCursors.reset,
    milestoneReviewCursor: milestoneCursors.review,
    milestoneReconcileCursor: milestoneCursors.reconcile,
    milestoneLockToken: lockToken,
    milestoneScanId: scanId,
    validReviewCount: 17,
  };
}

test("item subphase matrix owns only exact continuation fields", () => {
  const cases = [
    ["movedDish", "restaurantMerge"],
    ["dishDeletion", "restaurantDelete"],
    ["dishDeletion", "dishDelete"],
    ["milestoneUser", "restaurantDelete"],
    ["milestoneUser", "dishDelete"],
  ];
  for (const [kind, operation] of cases) {
    for (const subphase of itemSubphases[kind]) {
      const item = buildItem(kind, operation, {subphase});
      assert.equal(
        contract.parseRatingDestructiveJobItemDocument(
          stored(item, "itemId"),
        ).subphase,
        subphase,
      );
      const core = itemCore(kind, operation, {subphase});
      const future = futureItemContinuation(core);
      const owned = ownedItemContinuationFields(kind, subphase);
      for (const field of itemContinuationFields) {
        if (owned.has(field)) continue;
        assertInvalidRequest(() =>
          contract.buildRatingDestructiveJobItemDocument({
            ...core,
            [field]: future[field],
          }));
        const forged = resignContractDocument(item, {[field]: future[field]});
        assertInvalidState(() =>
          contract.parseRatingDestructiveJobItemDocument({
            id: item.itemId,
            data: forged,
          }));
      }

      const required = requiredItemContinuationFields(kind, subphase);
      for (const field of required) {
        assertInvalidRequest(() =>
          contract.buildRatingDestructiveJobItemDocument({
            ...core,
            [field]: null,
          }));
        const forged = resignContractDocument(item, {[field]: null});
        assertInvalidState(() =>
          contract.parseRatingDestructiveJobItemDocument({
            id: item.itemId,
            data: forged,
          }));
      }

      const nullableOwned = [...owned].filter((field) => !required.has(field));
      if (nullableOwned.length > 0) {
        const cleared = Object.fromEntries(
          nullableOwned.map((field) => [field, null]),
        );
        const cleanStart = buildItem(kind, operation, {
          subphase,
          ...cleared,
        });
        assert.deepEqual(
          contract.parseRatingDestructiveJobItemDocument(
            stored(cleanStart, "itemId"),
          ),
          cleanStart,
        );
      }

      if (kind === "movedDish" && subphase === "fold_aggregate") {
        for (const changes of [
          {aggregateWinnerCursorId: null},
          {aggregateState: null},
          {aggregateState: aggregateStateForDish("wrong-dish")},
        ]) {
          assertInvalidRequest(() => buildItem(kind, operation, {
            subphase,
            ...changes,
          }));
          const forged = resignContractDocument(item, changes);
          assertInvalidState(() =>
            contract.parseRatingDestructiveJobItemDocument({
              id: item.itemId,
              data: forged,
            }));
        }
      }
    }
  }
  assertInvalidRequest(() => buildItem(
    "movedDish",
    "restaurantMerge",
    {subphase: "process_reviews"},
  ));
});

test("item kind-operation identities reject malformed and speculative state", () => {
  assertInvalidRequest(() => buildItem("movedDish", "dishMerge"));
  assertInvalidRequest(() => buildItem("dishDeletion", "restaurantMerge"));
  assertInvalidRequest(() => buildItem("milestoneUser", "dishMerge"));
  assertInvalidRequest(() => buildItem(
    "milestoneUser",
    "dishDelete",
    {dishId: "forbidden"},
  ));
  assertInvalidRequest(() => contract.createRatingDestructiveJobItemId({
    jobId: "job",
    operation: "dishDelete",
    kind: "reviewDeletion",
    restaurantId: null,
    dishId: "dish",
    userId: null,
  }));
});

test("item parser binds document ID, job, identity, and fingerprint", () => {
  const item = buildItem("movedDish", "restaurantMerge");
  assertInvalidState(() => contract.parseRatingDestructiveJobItemDocument({
    id: "different",
    data: item,
  }));
  assertInvalidState(() => contract.parseRatingDestructiveJobItemDocument(
    malformed(item, "itemId", {jobId: "other-job"}),
  ));
  assertInvalidState(() => contract.parseRatingDestructiveJobItemDocument(
    malformed(item, "itemId", {fingerprint: "f".repeat(64)}),
  ));
  assertInvalidState(() => contract.parseRatingDestructiveJobItemDocument(
    malformed(item, "itemId", {arbitraryPayload: {review: "secret"}}),
  ));
  assert.equal(contract.parseRatingDestructiveJobItemDocument(null), null);
});

function rawSha(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

test("dish-deletion point cursor is exact, self-authenticating, and bound", () => {
  const core = itemCore("dishDeletion", "dishDelete", {
    subphase: "reverse_contribution_points",
    pointReversalCursor: null,
  });
  const operationFingerprint = rawSha([
    "bitestar.review-milestone-operation.v1",
    ["operationId", core.jobId],
  ]);
  const dishFingerprint = rawSha([
    "bitestar.contribution-dish-reverse-cursor.v2",
    ["dishId", core.dishId],
  ]);
  const pointCore = {
    version: "bitestar.contribution-dish-reverse-cursor.v2",
    phase: "dish-ledger",
    operationFingerprint,
    dishFingerprint,
    afterLedgerDocumentId: "ledger-cursor",
  };
  const pointReversalCursor = {
    ...pointCore,
    fingerprint: rawSha([
      pointCore.version,
      ["phase", pointCore.phase],
      ["operationFingerprint", operationFingerprint],
      ["dishFingerprint", dishFingerprint],
      ["afterLedgerDocumentId", pointCore.afterLedgerDocumentId],
    ]),
  };
  const item = contract.buildRatingDestructiveJobItemDocument({
    ...core,
    pointReversalCursor,
  });
  assert.deepEqual(item.pointReversalCursor, pointReversalCursor);
  assertInvalidRequest(() => contract.buildRatingDestructiveJobItemDocument({
    ...core,
    pointReversalCursor: {...pointReversalCursor, fingerprint: "0".repeat(64)},
  }));
  assertInvalidRequest(() => contract.buildRatingDestructiveJobItemDocument({
    ...core,
    pointReversalCursor: {...pointReversalCursor, extra: true},
  }));
});

test("moved-dish aggregate state is bounded and exact", () => {
  const aggregateState = {
    accumulatorVersion: "bitestar.dish-review-aggregate-accumulator.v1",
    dishId: "moved-dish",
    committedRatingCount: 0,
    overallBiteScoreSum: 0,
    overallImpressionSum: 0,
    tastinessScoreSum: 0,
    tastinessScoreCount: 0,
    qualityScoreSum: 0,
    qualityScoreCount: 0,
    valueScoreSum: 0,
    valueScoreCount: 0,
  };
  assert.equal(buildItem("movedDish", "restaurantMerge", {
    subphase: "fold_aggregate",
    aggregateWinnerCursorId: "winner-cursor",
    aggregateState,
  }).aggregateState.dishId, "moved-dish");
  assertInvalidRequest(() => buildItem("movedDish", "restaurantMerge", {
    subphase: "fold_aggregate",
    aggregateWinnerCursorId: "winner-cursor",
    aggregateState: {...aggregateState, dishId: "another-dish"},
  }));
  assertInvalidRequest(() => buildItem("dishDeletion", "dishDelete", {
    aggregateState,
  }));
});

function restaurantLock(changes = {}) {
  return contract.buildRatingRestaurantOperationLockDocument({
    restaurantId: "restaurant-source",
    jobId: "job",
    operation: "restaurantMerge",
    role: "source",
    state: "active_source",
    active: true,
    permanent: false,
    targetRestaurantId: "restaurant-target",
    createdAt: now,
    updatedAt: later,
    ...changes,
  });
}

function dishLock(changes = {}) {
  return contract.buildRatingDishOperationLockDocument({
    dishId: "dish-source",
    jobId: "job",
    operation: "dishMerge",
    role: "source",
    state: "active_source",
    active: true,
    permanent: false,
    restaurantId: "restaurant",
    targetDishId: "dish-target",
    createdAt: now,
    updatedAt: later,
    ...changes,
  });
}

test("restaurant lock parser accepts exact active and permanent matrices", () => {
  const locks = [
    restaurantLock(),
    restaurantLock({
      state: "merged_source", active: false, permanent: true,
    }),
    restaurantLock({
      restaurantId: "restaurant-target", role: "target",
      state: "active_target", targetRestaurantId: null,
    }),
    restaurantLock({
      operation: "restaurantDelete", targetRestaurantId: null,
    }),
    restaurantLock({
      operation: "restaurantDelete", state: "deleted_source",
      active: false, permanent: true, targetRestaurantId: null,
    }),
  ];
  for (const lock of locks) {
    assert.deepEqual(
      contract.parseRatingRestaurantOperationLockDocument(
        stored(lock, "restaurantId"),
      ),
      lock,
    );
  }
  assert.equal(contract.parseRatingRestaurantOperationLockDocument(null), null);
});

test("restaurant lock parser rejects wrong role, operation, booleans, and shape", () => {
  const lock = restaurantLock();
  for (const changes of [
    {role: "child"},
    {operation: "dishMerge"},
    {active: false},
    {permanent: true},
    {state: "released"},
    {extra: true},
    {fingerprint: "0".repeat(64)},
  ]) {
    assertInvalidState(() => contract.parseRatingRestaurantOperationLockDocument(
      malformed(lock, "restaurantId", changes),
    ));
  }
  assertInvalidState(() => contract.parseRatingRestaurantOperationLockDocument({
    id: "another-restaurant",
    data: lock,
  }));
});

test("dish lock parser accepts exact direct and child active/permanent matrices", () => {
  const locks = [
    dishLock(),
    dishLock({state: "merged_source", active: false, permanent: true}),
    dishLock({
      dishId: "dish-target", role: "target", state: "active_target",
      targetDishId: null,
    }),
    dishLock({
      operation: "dishDelete", targetDishId: null,
    }),
    dishLock({
      operation: "dishDelete", state: "deleted_source", active: false,
      permanent: true, restaurantId: null, targetDishId: null,
    }),
    dishLock({
      operation: "restaurantMerge", role: "child", targetDishId: null,
    }),
    dishLock({
      operation: "restaurantDelete", role: "child", targetDishId: null,
    }),
    dishLock({
      operation: "restaurantDelete", role: "child", state: "deleted_source",
      active: false, permanent: true, targetDishId: null,
    }),
  ];
  for (const lock of locks) {
    assert.deepEqual(
      contract.parseRatingDishOperationLockDocument(stored(lock, "dishId")),
      lock,
    );
  }
  assert.equal(contract.parseRatingDishOperationLockDocument(null), null);
});

test("dish lock parser rejects malformed role, operation, permanent state, and keys", () => {
  const lock = dishLock();
  for (const changes of [
    {role: "child"},
    {operation: "restaurantDelete"},
    {active: false},
    {permanent: true},
    {targetDishId: null},
    {state: "released"},
    {extra: "forbidden"},
    {fingerprint: "f".repeat(64)},
  ]) {
    assertInvalidState(() => contract.parseRatingDishOperationLockDocument(
      malformed(lock, "dishId", changes),
    ));
  }
});

test("collection names, versions, paths, and bounds remain exact", () => {
  assert.equal(contract.ratingDestructiveJobCollection,
    "private_rating_destructive_jobs");
  assert.equal(contract.ratingDestructiveJobItemCollection,
    "private_rating_destructive_job_items");
  assert.equal(contract.ratingRestaurantOperationLockCollection,
    "private_rating_restaurant_operation_locks");
  assert.equal(contract.ratingDishOperationLockCollection,
    "private_rating_dish_operation_locks");
  assert.equal(contract.ratingDestructiveJobVersion,
    "bitestar.rating-destructive-job.v1");
  assert.equal(contract.ratingDestructiveItemVersion,
    "bitestar.rating-destructive-item.v1");
  assert.equal(contract.ratingRestaurantOperationLockVersion,
    "bitestar.rating-restaurant-operation-lock.v1");
  assert.equal(contract.ratingDishOperationLockVersion,
    "bitestar.rating-dish-operation-lock.v1");
  assert.equal(contract.ratingDestructiveDirectBatchLimit, 100);
  assert.equal(contract.ratingDestructiveTrustBatchLimit, 50);
  assert.equal(contract.ratingDestructivePointReversalBatchLimit, 50);
  assert.equal(contract.ratingDestructiveMilestoneReviewBatchLimit, 100);
  assert.equal(contract.ratingDestructiveMilestoneReconciliationBatchLimit, 50);
  assert.equal(contract.ratingDestructiveAggregateBatchLimit, 100);
  assert.equal(contract.ratingDestructiveItemMaterializationBatchLimit, 100);
  assert.equal(contract.ratingDestructiveJobPath("job"),
    "private_rating_destructive_jobs/job");
  assert.equal(contract.ratingDestructiveJobItemPath("item"),
    "private_rating_destructive_job_items/item");
  assert.equal(contract.ratingDishOperationLockPath("dish"),
    "private_rating_dish_operation_locks/dish");
});

test("contract documents cannot carry payload or privacy canaries", () => {
  const canaries = [
    "private review text", "report body", "proposal reason",
    "owner@example.test", "+15555550123", "owner-user-uid",
    "profile secret", "token-secret", "sk_live_canary",
  ];
  const documents = [
    buildJob("restaurantMerge"),
    buildItem("movedDish", "restaurantMerge"),
    restaurantLock(),
    dishLock(),
  ];
  const serialized = JSON.stringify(documents);
  for (const canary of canaries) {
    assert.equal(serialized.includes(canary), false);
  }
  assertInvalidRequest(() => contract.buildRatingDestructiveJobDocument({
    ...jobCore("restaurantMerge"),
    payload: {phone: canaries[4]},
  }));
});
