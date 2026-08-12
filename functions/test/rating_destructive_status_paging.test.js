"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const {
  OpaqueCursorCodec,
} = require("../lib/opaque_cursor.js");
const {
  buildRatingDestructiveJobDocument,
  createRatingDestructiveJobId,
  ratingDestructiveJobCollection,
} = require("../lib/rating_destructive_job_contract.js");
const {
  buildRatingDestructiveOperationSummary,
  ratingDestructiveCallableContractVersion,
} = require("../lib/rating_destructive_callable_contract.js");
const {
  getRatingDestructiveOperationStatusHandler,
} = require("../lib/rating_destructive_callable_handlers.js");
const {
  createFirestoreRatingDestructiveStatusPagingDatabase,
  listRatingAdminDestructiveOperationsPageHandler,
  ratingDestructiveAdminPageSize,
  ratingDestructivePhaseCategory,
} = require("../lib/rating_destructive_status_paging.js");

const nowMs = Date.parse("2026-08-11T18:00:00.000Z");
const secret = Buffer.alloc(32, 71).toString("base64url");
const adminUid = "admin-uid";

const exactItemKeys = [
  "operationId",
  "operation",
  "status",
  "progressCategory",
  "phaseCategory",
  "processedCount",
  "phaseProcessedCount",
  "createdAtMs",
  "updatedAtMs",
  "sourceRestaurantId",
  "sourceRestaurantName",
  "targetRestaurantId",
  "targetRestaurantName",
  "sourceDishId",
  "sourceDishName",
  "targetDishId",
  "targetDishName",
  "complete",
  "retryable",
  "manualReviewRequired",
  "messageCategory",
].sort();

const phases = Object.freeze({
  claimed: "starting",
  move_dishes: "moving_data",
  move_reviews: "moving_data",
  rebuild_moved_dish_aggregates: "rebuilding",
  move_claim_requests: "moving_data",
  move_dish_proposals: "moving_data",
  move_restaurant_reports: "moving_data",
  move_dish_reports: "moving_data",
  move_review_reports: "moving_data",
  move_review_feedback_votes: "moving_data",
  resolve_duplicate_reports: "cleaning_up",
  finalize_restaurants: "finalizing",
  process_dishes: "cleaning_up",
  process_orphan_reviews: "cleaning_up",
  delete_restaurant_reports: "cleaning_up",
  delete_duplicate_reports: "cleaning_up",
  reconcile_milestone_users: "cleaning_up",
  finalize_restaurant: "finalizing",
  validate: "starting",
  rebuild_target_aggregate: "rebuilding",
  fold_target_aggregate: "rebuilding",
  rebuild_source_aggregate: "rebuilding",
  fold_source_aggregate: "rebuilding",
  finalize_dishes: "finalizing",
  process_reviews: "cleaning_up",
  reverse_contribution_points: "cleaning_up",
  delete_dish_reports: "cleaning_up",
  delete_aggregate: "cleaning_up",
  delete_dish: "cleaning_up",
  complete: "complete",
});

function unwrapTypeScriptExpression(value) {
  let current = value;
  while (true) {
    if (
      ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if (
      ts.isCallExpression(current) &&
      current.arguments.length === 1 &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.expression.getText() === "Object" &&
      current.expression.name.text === "freeze"
    ) {
      current = current.arguments[0];
      continue;
    }
    return current;
  }
}

function legalJobPhasesFromProductionSource() {
  const sourcePath = path.join(
    __dirname,
    "..",
    "src",
    "rating_destructive_job_contract.ts",
  );
  const source = fs.readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let initializer;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "jobPhases"
      ) {
        initializer = declaration.initializer;
      }
    }
  }
  assert.ok(initializer, "Production jobPhases must remain source-visible.");
  const object = unwrapTypeScriptExpression(initializer);
  assert.equal(ts.isObjectLiteralExpression(object), true);
  return Object.freeze(Object.fromEntries(object.properties.map((property) => {
    assert.equal(ts.isPropertyAssignment(property), true);
    assert.equal(ts.isIdentifier(property.name), true);
    const values = unwrapTypeScriptExpression(property.initializer);
    assert.equal(ts.isArrayLiteralExpression(values), true);
    return [
      property.name.text,
      Object.freeze(values.elements.map((element) => {
        const value = unwrapTypeScriptExpression(element);
        assert.equal(ts.isStringLiteral(value), true);
        return value.text;
      })),
    ];
  })));
}

function compareScalar(left, right) {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function field(document, name) {
  return name === "__name__" ? document.id : document.data[name];
}

function compareDocument(left, right, orders) {
  for (const order of orders) {
    const comparison = compareScalar(
      field(left, order.field),
      field(right, order.field),
    );
    if (comparison !== 0) {
      return order.direction === "desc" ? -comparison : comparison;
    }
  }
  return 0;
}

function compareToCursor(document, values, orders) {
  for (let index = 0; index < orders.length; index += 1) {
    const comparison = compareScalar(
      field(document, orders[index].field),
      values[index],
    );
    if (comparison !== 0) {
      return orders[index].direction === "desc" ? -comparison : comparison;
    }
  }
  return 0;
}

class FakePagingDatabase {
  constructor() {
    this.records = new Map();
    this.queryCalls = [];
    this.countCalls = [];
    this.getCalls = [];
    this.transactionReadCount = 0;
    this.writeCount = 0;
  }

  seed(path, data) {
    this.records.set(path, structuredClone(data));
  }

  documentsIn(collectionPath) {
    const prefix = collectionPath + "/";
    const depth = collectionPath.split("/").length + 1;
    return [...this.records.entries()]
      .filter(([path]) =>
        path.startsWith(prefix) && path.split("/").length === depth)
      .map(([path, data]) => ({
        id: path.slice(prefix.length),
        data: structuredClone(data),
      }));
  }

  async queryDocuments(query) {
    this.queryCalls.push(structuredClone(query));
    let documents = this.documentsIn(query.collectionPath)
      .sort((left, right) => compareDocument(left, right, query.orders));
    if (query.cursor?.kind === "startAfter") {
      documents = documents.filter((document) =>
        compareToCursor(document, query.cursor.values, query.orders) > 0);
    } else if (query.cursor?.kind === "endBefore") {
      documents = documents.filter((document) =>
        compareToCursor(document, query.cursor.values, query.orders) < 0);
    }
    documents = query.limitToLast === true
      ? documents.slice(-query.limit)
      : documents.slice(0, query.limit);
    return structuredClone(documents);
  }

  async countDocuments(value) {
    this.countCalls.push(structuredClone(value));
    return this.documentsIn(value.collectionPath).length;
  }

  async getDocuments(paths) {
    this.getCalls.push([...paths]);
    return paths.flatMap((path) => {
      const data = this.records.get(path);
      return data === undefined
        ? []
        : [{id: path.slice(path.lastIndexOf("/") + 1), data: structuredClone(data)}];
    });
  }

  async runTransaction(operation) {
    return operation({
      getDocument: async (documentPath) => {
        this.transactionReadCount += 1;
        const data = this.records.get(documentPath);
        return data === undefined
          ? null
          : {
            id: documentPath.slice(documentPath.lastIndexOf("/") + 1),
            data: structuredClone(data),
            createTime: new Date(nowMs),
          };
      },
      queryDocuments: async () => [],
      setDocument: () => {
        this.writeCount += 1;
      },
      deleteDocument: () => {
        this.writeCount += 1;
      },
    });
  }
}

function identity(operation, index) {
  const suffix = String(index).padStart(3, "0");
  switch (operation) {
  case "restaurantMerge":
    return {
      sourceRestaurantId: `source-restaurant-${suffix}`,
      targetRestaurantId: `target-restaurant-${suffix}`,
      sourceDishId: null,
      targetDishId: null,
      restaurantId: null,
    };
  case "restaurantDelete":
    return {
      sourceRestaurantId: `delete-restaurant-${suffix}`,
      targetRestaurantId: null,
      sourceDishId: null,
      targetDishId: null,
      restaurantId: null,
    };
  case "dishMerge":
    return {
      sourceRestaurantId: null,
      targetRestaurantId: null,
      sourceDishId: `source-dish-${suffix}`,
      targetDishId: `target-dish-${suffix}`,
      restaurantId: `dish-restaurant-${suffix}`,
    };
  case "dishDelete":
    return {
      sourceRestaurantId: null,
      targetRestaurantId: null,
      sourceDishId: `delete-dish-${suffix}`,
      targetDishId: null,
      restaurantId: null,
    };
  default:
    throw new Error("Unsupported test operation.");
  }
}

function aggregateStateForDish(dishId) {
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
  };
}

function jobContinuation(operation, phase, operationIdentity, index) {
  const empty = {
    cursorDocumentId: null,
    itemCursorId: null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
  };
  if (operation === "dishDelete" && phase !== "complete") {
    return {...empty, itemCursorId: `dish-item-${index}`};
  }
  if (operation !== "dishMerge") return empty;
  if (phase === "fold_target_aggregate") {
    return {
      ...empty,
      aggregateWinnerCursorId: `target-winner-${index}`,
      aggregateState: aggregateStateForDish(operationIdentity.targetDishId),
    };
  }
  if (phase === "fold_source_aggregate") {
    return {
      ...empty,
      aggregateWinnerCursorId: `source-winner-${index}`,
      aggregateState: aggregateStateForDish(operationIdentity.sourceDishId),
    };
  }
  return empty;
}

function buildJob(index, changes = {}) {
  const operation = changes.operation ?? [
    "restaurantMerge",
    "restaurantDelete",
    "dishMerge",
    "dishDelete",
  ][index % 4];
  const operationIdentity = identity(operation, index);
  const requestId = `page-request-${String(index).padStart(3, "0")}`;
  const jobId = createRatingDestructiveJobId({
    requestId,
    operation,
    ...operationIdentity,
  });
  const defaultPhase = {
    restaurantMerge: "claimed",
    restaurantDelete: "claimed",
    dishMerge: "validate",
    dishDelete: "process_reviews",
  }[operation];
  const indexedStatus = [
    "active",
    "retryable",
    "manual_review_required",
    "complete",
  ][index % 4];
  const status = changes.status ?? (
    changes.phase === "complete" ? "complete" : indexedStatus
  );
  const phase = changes.phase ?? (
    status === "complete" ? "complete" : defaultPhase
  );
  const updatedAt = new Date(nowMs - (index * 1_000));
  const restaurantRevisions = operation === "restaurantMerge"
    ? {
      expectedSourceRestaurantRevision: 2,
      sourceActiveRestaurantRevision: 3,
      sourceCompletionRestaurantRevision: 4,
      expectedTargetRestaurantRevision: 7,
      targetActiveRestaurantRevision: 8,
      targetCompletionRestaurantRevision: 9,
    }
    : operation === "restaurantDelete"
      ? {
        expectedSourceRestaurantRevision: 2,
        sourceActiveRestaurantRevision: 3,
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
      expectedTargetAggregateGeneration: 7,
      targetActiveAggregateGeneration: 8,
      targetCompletionAggregateGeneration: 9,
    }
    : {
      expectedSourceAggregateGeneration: null,
      sourceActiveAggregateGeneration: null,
    sourceCompletionAggregateGeneration: null,
    expectedTargetAggregateGeneration: null,
    targetActiveAggregateGeneration: null,
    targetCompletionAggregateGeneration: null,
  };
  const continuation = jobContinuation(
    operation,
    phase,
    operationIdentity,
    index,
  );
  return buildRatingDestructiveJobDocument({
    jobId,
    requestId,
    operation,
    authorizedCallerKind: "admin",
    callerBindingFingerprint: createHash("sha256")
      .update(`caller-${index}`, "utf8")
      .digest("hex"),
    status,
    phase,
    ...operationIdentity,
    ...restaurantRevisions,
    ...generations,
    ...continuation,
    processedCount: index * 3,
    phaseProcessedCount: phase === "complete" ? 0 : index,
    failureCode: status === "retryable"
      ? "temporary_dependency"
      : status === "manual_review_required"
        ? "operation_conflict"
        : null,
    createdAt: new Date(updatedAt.getTime() - 60_000),
    updatedAt,
    completedAt: status === "complete" ? updatedAt : null,
    ...changes,
  });
}

function seedJob(database, job) {
  database.seed(`${ratingDestructiveJobCollection}/${job.jobId}`, {...job});
}

function seedNames(database, job, omitSource = false) {
  const values = [
    ["bitescore_restaurants", job.sourceRestaurantId, "Source Restaurant"],
    ["bitescore_restaurants", job.targetRestaurantId, "Target Restaurant"],
    ["bitescore_dishes", job.sourceDishId, "Source Dish"],
    ["bitescore_dishes", job.targetDishId, "Target Dish"],
    ["bitescore_restaurants", job.restaurantId, "Dish Restaurant"],
  ];
  for (const [collection, id, prefix] of values) {
    if (id !== null && !(omitSource && id === job.sourceRestaurantId)) {
      database.seed(`${collection}/${id}`, {id, name: `${prefix} ${id}`});
    }
  }
}

function request(direction = "first", cursor) {
  return {
    protocolVersion: "bitestar.page.v1",
    pageSize: ratingDestructiveAdminPageSize,
    criteria: {scope: "all"},
    direction,
    requestExactCount: true,
    clientRequestId: `request-${direction}`,
    ...(cursor === undefined ? {} : {cursor}),
  };
}

function context(database, uid = adminUid) {
  return {
    adminUid: uid,
    cursorSecret: secret,
    database,
    now: () => nowMs + 10_000,
    nonceSource: (size) => Buffer.alloc(size, 19),
  };
}

function errorCode(error) {
  return error?.code;
}

test("Admin destructive operations page is exact, bounded, navigable, enriched, and private", async () => {
  const database = new FakePagingDatabase();
  const jobs = [];
  for (let index = 0; index < 75; index += 1) {
    const job = buildJob(index, index === 9
      ? {updatedAt: new Date(nowMs - 8_000)}
      : {});
    jobs.push(job);
    seedJob(database, job);
    seedNames(database, job, index === 72);
  }
  const privacyCanaryJob = jobs.find((job) => job.operation === "dishMerge");
  assert.ok(privacyCanaryJob?.restaurantId);
  database.seed(
    `bitescore_restaurants/${privacyCanaryJob.restaurantId}`,
    {name: "PRIVATE CONTEXT RESTAURANT CANARY"},
  );
  const expected = [...jobs].sort((left, right) =>
    right.updatedAt.getTime() - left.updatedAt.getTime() ||
    right.jobId.localeCompare(left.jobId));
  const jobsById = new Map(jobs.map((job) => [job.jobId, job]));

  const first = await listRatingAdminDestructiveOperationsPageHandler(
    request(),
    context(database),
  );
  const second = await listRatingAdminDestructiveOperationsPageHandler(
    request("forward", first.nextCursor),
    context(database),
  );
  const third = await listRatingAdminDestructiveOperationsPageHandler(
    request("forward", second.nextCursor),
    context(database),
  );
  const previousSecond = await listRatingAdminDestructiveOperationsPageHandler(
    request("backward", third.previousCursor),
    context(database),
  );
  const previousFirst = await listRatingAdminDestructiveOperationsPageHandler(
    request("backward", previousSecond.previousCursor),
    context(database),
  );
  const last = await listRatingAdminDestructiveOperationsPageHandler(
    request("last"),
    context(database),
  );

  assert.deepEqual(
    [first, second, third].map((page) => page.currentPageNumber),
    [1, 2, 3],
  );
  assert.deepEqual(
    [first, second, third].map((page) => page.items.length),
    [25, 25, 25],
  );
  assert.deepEqual(first.total, {state: "exact", value: 75});
  assert.equal(first.protocolVersion, "bitestar.page.v1");
  assert.equal(first.pageSize, 25);
  assert.deepEqual(first.capabilities, {
    first: false,
    previous: false,
    numberedVisitedPages: true,
    next: true,
    last: true,
  });
  assert.deepEqual(third.capabilities, {
    first: true,
    previous: true,
    numberedVisitedPages: true,
    next: false,
    last: false,
  });
  assert.equal(previousSecond.currentPageNumber, 2);
  assert.deepEqual(
    previousSecond.items.map((item) => item.operationId),
    second.items.map((item) => item.operationId),
  );
  assert.equal(previousFirst.currentPageNumber, 1);
  assert.deepEqual(
    previousFirst.items.map((item) => item.operationId),
    first.items.map((item) => item.operationId),
  );
  assert.equal(last.currentPageNumber, 3);
  assert.deepEqual(
    last.items.map((item) => item.operationId),
    third.items.map((item) => item.operationId),
  );

  const visibleIds = [first, second, third]
    .flatMap((page) => page.items.map((item) => item.operationId));
  assert.equal(new Set(visibleIds).size, 75);
  assert.deepEqual(visibleIds, expected.map((job) => job.jobId));
  assert.equal(first.items.every((item) =>
    JSON.stringify(item).includes("cursorDocumentId") === false), true);
  for (const item of [...first.items, ...second.items, ...third.items]) {
    const job = jobsById.get(item.operationId);
    assert.ok(job);
    assert.deepEqual(Object.keys(item).sort(), exactItemKeys);
    assert.equal(item.messageCategory, "current_status");
    assert.equal(typeof item.operationId, "string");
    assert.equal(item.createdAtMs <= item.updatedAtMs, true);
    assert.equal(
      item.complete,
      item.status === "complete",
    );
    assert.equal(item.retryable, item.status === "retryable");
    assert.equal(
      item.manualReviewRequired,
      item.status === "manual_review_required",
    );
    for (const [key, id, prefix] of [
      ["sourceRestaurant", job.sourceRestaurantId, "Source Restaurant"],
      ["targetRestaurant", job.targetRestaurantId, "Target Restaurant"],
      ["sourceDish", job.sourceDishId, "Source Dish"],
      ["targetDish", job.targetDishId, "Target Dish"],
    ]) {
      assert.equal(item[`${key}Id`], id);
      const omitted = id === jobs[72].sourceRestaurantId;
      assert.equal(
        item[`${key}Name`],
        id === null || omitted ? null : `${prefix} ${id}`,
      );
    }
    const serialized = JSON.stringify(item);
    for (const forbidden of [
      "fingerprint", "failureCode", "requestId", "cursorDocumentId",
      "itemCursorId", "aggregateState", "expectedSourceRestaurantRevision",
      "sourceActiveAggregateGeneration", "callerBindingFingerprint",
      "authorizedCallerKind", "ownerUserId",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.equal(Object.hasOwn(item, "restaurantId"), false);
    assert.equal(Object.hasOwn(item, "restaurantName"), false);
  }
  const missingSource = [first, second, third]
    .flatMap((page) => page.items)
    .find((item) => item.sourceRestaurantId === jobs[72].sourceRestaurantId);
  assert.ok(missingSource);
  assert.equal(missingSource.sourceRestaurantName, null);

  assert.ok(database.queryCalls.length > 0);
  for (const query of database.queryCalls) {
    assert.equal(query.collectionPath, ratingDestructiveJobCollection);
    assert.deepEqual(query.filters, []);
    assert.deepEqual(query.orders, [
      {field: "updatedAt", direction: "desc"},
      {field: "__name__", direction: "desc"},
    ]);
    assert.equal(query.limit <= 26, true);
    assert.equal(Object.hasOwn(query, "offset"), false);
  }
  assert.equal(database.queryCalls.some((query) => query.limit === 26), true);
  assert.equal(database.queryCalls.some((query) => query.limitToLast === true), true);
  assert.equal(database.countCalls.every((call) =>
    call.collectionPath === ratingDestructiveJobCollection &&
    call.filters.length === 0), true);
  assert.equal(database.getCalls.every((paths) => paths.length <= 25), true);
  assert.equal(
    database.getCalls.length,
    database.queryCalls.length * 4,
    "Each mixed page must use only the four authorized enrichment roles.",
  );
  assert.equal(database.getCalls.flat().some((documentPath) =>
    documentPath ===
      `bitescore_restaurants/${privacyCanaryJob.restaurantId}`), false);
  const serializedPages = JSON.stringify([first, second, third]);
  assert.equal(serializedPages.includes(privacyCanaryJob.restaurantId), false);
  assert.equal(
    serializedPages.includes("PRIVATE CONTEXT RESTAURANT CANARY"),
    false,
  );
  assert.equal(database.writeCount, 0);
});

test("dish records retain authorized identities without restaurant enrichment", async () => {
  const database = new FakePagingDatabase();
  const dishMerge = buildJob(102, {
    operation: "dishMerge",
    status: "active",
    phase: "move_reviews",
  });
  const dishDelete = buildJob(103, {
    operation: "dishDelete",
    status: "active",
    phase: "process_reviews",
  });
  for (const job of [dishMerge, dishDelete]) {
    seedJob(database, job);
    seedNames(database, job);
  }
  database.seed(`bitescore_restaurants/${dishMerge.restaurantId}`, {
    name: "PRIVATE DISH RESTAURANT CANARY",
  });

  const page = await listRatingAdminDestructiveOperationsPageHandler(
    request(),
    context(database),
  );
  assert.equal(page.items.length, 2);
  const mergeItem = page.items.find((item) => item.operation === "dishMerge");
  const deleteItem = page.items.find((item) => item.operation === "dishDelete");
  assert.ok(mergeItem);
  assert.ok(deleteItem);
  assert.equal(mergeItem.sourceDishId, dishMerge.sourceDishId);
  assert.equal(mergeItem.sourceDishName, `Source Dish ${dishMerge.sourceDishId}`);
  assert.equal(mergeItem.targetDishId, dishMerge.targetDishId);
  assert.equal(mergeItem.targetDishName, `Target Dish ${dishMerge.targetDishId}`);
  assert.equal(deleteItem.sourceDishId, dishDelete.sourceDishId);
  assert.equal(
    deleteItem.sourceDishName,
    `Source Dish ${dishDelete.sourceDishId}`,
  );
  for (const item of page.items) {
    assert.equal(Object.hasOwn(item, "restaurantId"), false);
    assert.equal(Object.hasOwn(item, "restaurantName"), false);
  }
  assert.equal(database.getCalls.length, 2);
  assert.equal(database.getCalls.flat().every((documentPath) =>
    documentPath.startsWith("bitescore_dishes/")), true);
  assert.equal(JSON.stringify(page).includes(dishMerge.restaurantId), false);
  assert.equal(
    JSON.stringify(page).includes("PRIVATE DISH RESTAURANT CANARY"),
    false,
  );
  assert.equal(database.writeCount, 0);
});

test("phase categories remain exhaustive fixed secondary detail", () => {
  assert.deepEqual(
    Object.fromEntries(Object.keys(phases).map((phase) => [
      phase,
      ratingDestructivePhaseCategory(phase),
    ])),
    phases,
  );
});

test("every legal job projects one shared progress category across start, status, and page", async () => {
  const legalPhases = legalJobPhasesFromProductionSource();
  assert.deepEqual(Object.keys(legalPhases), [
    "restaurantMerge",
    "restaurantDelete",
    "dishMerge",
    "dishDelete",
  ]);
  assert.deepEqual(
    [...new Set(Object.values(legalPhases).flat())].sort(),
    Object.keys(phases).sort(),
  );
  const counts = new Map();
  let variant = 1_000;
  let explicitProcessReviews;
  const explicitReconciliations = [];

  for (const [operation, operationPhases] of Object.entries(legalPhases)) {
    for (const phase of operationPhases) {
      const statuses = phase === "complete"
        ? ["complete"]
        : ["active", "retryable", "manual_review_required"];
      for (const status of statuses) {
        const job = buildJob(variant, {operation, phase, status});
        const database = new FakePagingDatabase();
        seedJob(database, job);
        const start = buildRatingDestructiveOperationSummary(job, {
          accepted: true,
          mode: "start",
        });
        const exactStatus = await getRatingDestructiveOperationStatusHandler({
          data: {
            contractVersion: ratingDestructiveCallableContractVersion,
            operationId: job.jobId,
            clientRequestId: `matrix-status-${variant}`,
          },
        }, {
          privateDatabase: database,
          authenticate: () => ({
            uid: adminUid,
            authorizedCallerKind: "admin",
          }),
        });
        const page = await listRatingAdminDestructiveOperationsPageHandler(
          request(),
          context(database),
        );
        const record = page.items[0];

        assert.equal(record.operationId, job.jobId);
        for (const field of [
          "operationId",
          "operation",
          "status",
          "processedCount",
          "phaseProcessedCount",
          "createdAtMs",
          "updatedAtMs",
          "complete",
          "retryable",
          "manualReviewRequired",
          "messageCategory",
        ]) {
          assert.equal(record[field], exactStatus[field], field);
        }
        assert.equal(record.progressCategory, start.progressCategory);
        assert.equal(record.progressCategory, exactStatus.progressCategory);
        assert.equal(record.phaseCategory, ratingDestructivePhaseCategory(phase));
        assert.equal(record.complete, exactStatus.complete);
        assert.equal(record.retryable, exactStatus.retryable);
        assert.equal(
          record.manualReviewRequired,
          exactStatus.manualReviewRequired,
        );
        assert.equal(database.writeCount, 0);
        assert.equal(database.transactionReadCount, 1);
        counts.set(operation, (counts.get(operation) ?? 0) + 1);

        if (
          operation === "dishDelete" &&
          phase === "process_reviews" &&
          status === "active"
        ) {
          explicitProcessReviews = {start, exactStatus, record};
        }
        if (phase === "reconcile_milestone_users" && status === "active") {
          explicitReconciliations.push({start, exactStatus, record});
        }
        variant += 1;
      }
    }
  }

  assert.deepEqual(Object.fromEntries(counts), {
    restaurantMerge: 37,
    restaurantDelete: 22,
    dishMerge: 22,
    dishDelete: 19,
  });
  assert.equal(variant - 1_000, 100);
  assert.ok(explicitProcessReviews);
  assert.equal(explicitProcessReviews.start.progressCategory, "moving_data");
  assert.equal(
    explicitProcessReviews.exactStatus.progressCategory,
    "moving_data",
  );
  assert.equal(explicitProcessReviews.record.progressCategory, "moving_data");
  assert.equal(explicitProcessReviews.record.phaseCategory, "cleaning_up");
  assert.equal(explicitReconciliations.length, 2);
  for (const value of explicitReconciliations) {
    assert.equal(value.start.progressCategory, "rebuilding");
    assert.equal(value.exactStatus.progressCategory, "rebuilding");
    assert.equal(value.record.progressCategory, "rebuilding");
    assert.equal(value.record.phaseCategory, "cleaning_up");
  }
});

test("strict request and opaque cursor binding reject wrong caller, query, source, purpose, and page size", async () => {
  const database = new FakePagingDatabase();
  const jobs = [];
  for (let index = 0; index < 30; index += 1) {
    const job = buildJob(index, {status: "active"});
    jobs.push(job);
    seedJob(database, job);
  }
  const first = await listRatingAdminDestructiveOperationsPageHandler(
    request(),
    context(database),
  );
  await assert.rejects(
    listRatingAdminDestructiveOperationsPageHandler(
      request("forward", first.nextCursor),
      context(database, "other-admin"),
    ),
    (error) => errorCode(error) === "invalid-argument",
  );
  await assert.rejects(
    listRatingAdminDestructiveOperationsPageHandler(
      request("backward", first.nextCursor),
      context(database),
    ),
    (error) => errorCode(error) === "invalid-argument",
  );

  const callerBinding = createHash("sha256")
    .update(JSON.stringify(["ratingAdminDestructiveOperations", adminUid]), "utf8")
    .digest("hex");
  const codec = new OpaqueCursorCodec({
    key: Buffer.from(secret, "base64url"),
    clock: () => nowMs + 10_000,
    nonceSource: (size) => Buffer.alloc(size, 37),
  });
  const anchor = first.items.at(-1);
  const cursorInput = {
    queryFingerprint: first.queryFingerprint,
    source: "ratingAdminDestructiveOperations",
    searchMode: "all",
    pageSize: 25,
    purpose: "forward",
    sortTuple: [anchor.updatedAtMs, anchor.operationId, 2],
    callerBinding,
  };
  const wrongQuery = codec.encode({
    ...cursorInput,
    queryFingerprint: "f".repeat(64),
  });
  const wrongSource = codec.encode({...cursorInput, source: "ratingAdminQueue"});
  const wrongEntity = codec.encode({...cursorInput, searchMode: "recent"});
  const wrongPurpose = codec.encode({...cursorInput, purpose: "backward"});
  const wrongPageSize = codec.encode({...cursorInput, pageSize: 24});
  for (const cursor of [
    wrongQuery,
    wrongSource,
    wrongEntity,
    wrongPurpose,
    wrongPageSize,
  ]) {
    await assert.rejects(
      listRatingAdminDestructiveOperationsPageHandler(
        request("forward", cursor),
        context(database),
      ),
      (error) => errorCode(error) === "invalid-argument",
    );
  }

  const invalidRequests = [
    {...request(), criteria: {}},
    {...request(), criteria: {scope: "all", extra: true}},
    {...request(), criteria: {scope: "recent"}},
    {...request(), pageSize: 24},
    {...request(), requestExactCount: false},
    {...request(), protocolVersion: "wrong"},
    {...request(), unknown: true},
  ];
  for (const value of invalidRequests) {
    await assert.rejects(
      listRatingAdminDestructiveOperationsPageHandler(value, context(database)),
      (error) => errorCode(error) === "invalid-argument",
    );
  }
  await assert.rejects(
    listRatingAdminDestructiveOperationsPageHandler(
      request(),
      context(database, ""),
    ),
    (error) => errorCode(error) === "permission-denied",
  );
});

test("every direct read including the lookahead is strictly parsed", async () => {
  const database = new FakePagingDatabase();
  for (let index = 0; index < 26; index += 1) {
    const job = buildJob(index, {status: "active"});
    const data = {...job};
    if (index === 25) delete data.fingerprint;
    database.seed(`${ratingDestructiveJobCollection}/${job.jobId}`, data);
  }
  await assert.rejects(
    listRatingAdminDestructiveOperationsPageHandler(
      request(),
      context(database),
    ),
    (error) => errorCode(error) === "failed-precondition",
  );
  assert.equal(database.queryCalls.length, 1);
  assert.equal(database.queryCalls[0].limit, 26);
  assert.equal(database.getCalls.length, 0);
  assert.equal(database.writeCount, 0);
});

test("empty pages remain exact and perform no direct or enrichment read", async () => {
  const database = new FakePagingDatabase();
  const page = await listRatingAdminDestructiveOperationsPageHandler(
    request(),
    context(database),
  );
  assert.deepEqual(page.items, []);
  assert.deepEqual(page.total, {state: "exact", value: 0});
  assert.equal(page.currentPageNumber, 1);
  assert.equal(page.hasNext, false);
  assert.equal(page.hasPrevious, false);
  assert.equal(database.queryCalls.length, 0);
  assert.equal(database.getCalls.length, 0);
  assert.equal(database.writeCount, 0);
});

test("Firestore adapter is exposed without adding a write surface", () => {
  assert.equal(
    typeof createFirestoreRatingDestructiveStatusPagingDatabase,
    "function",
  );
});
