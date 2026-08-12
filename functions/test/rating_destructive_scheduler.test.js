import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {
  buildRatingDestructiveJobDocument,
  createRatingDestructiveCallerBindingFingerprint,
  createRatingDestructiveJobId,
  ratingDestructiveJobCollection,
} from "../lib/rating_destructive_job_contract.js";
import {
  createFirestoreRatingDestructiveSchedulerDiscoveryDatabase,
  processRatingDestructiveOperationWorkHandler,
  ratingDestructiveScheduledFunctionOptions,
  ratingDestructiveScheduledWorkLimit,
} from "../lib/rating_destructive_scheduler.js";

const baseTime = new Date("2026-08-11T12:00:00.000Z");
const schedulerTime = new Date("2026-08-11T13:00:00.000Z");
const unusedDependencies = Object.freeze({});

function buildJob(index, status = "active") {
  const suffix = String(index).padStart(3, "0");
  const requestId = `scheduler-request-${suffix}`;
  const sourceRestaurantId = `scheduler-source-${suffix}`;
  const targetRestaurantId = `scheduler-target-${suffix}`;
  const jobId = createRatingDestructiveJobId({
    requestId,
    operation: "restaurantMerge",
    sourceRestaurantId,
    targetRestaurantId,
    sourceDishId: null,
    targetDishId: null,
    restaurantId: null,
  });
  const callerBindingFingerprint =
    createRatingDestructiveCallerBindingFingerprint("scheduler-admin");
  const terminal = status === "complete";
  const failureCode = status === "retryable"
    ? "temporary_dependency"
    : status === "manual_review_required"
      ? "entity_state_incompatible"
      : null;
  return buildRatingDestructiveJobDocument({
    jobId,
    requestId,
    operation: "restaurantMerge",
    authorizedCallerKind: "admin",
    callerBindingFingerprint,
    status,
    phase: terminal ? "complete" : "claimed",
    sourceRestaurantId,
    targetRestaurantId,
    sourceDishId: null,
    targetDishId: null,
    restaurantId: null,
    expectedSourceRestaurantRevision: 1,
    sourceActiveRestaurantRevision: 2,
    sourceCompletionRestaurantRevision: 3,
    expectedTargetRestaurantRevision: 4,
    targetActiveRestaurantRevision: 5,
    targetCompletionRestaurantRevision: 6,
    expectedSourceAggregateGeneration: null,
    sourceActiveAggregateGeneration: null,
    sourceCompletionAggregateGeneration: null,
    expectedTargetAggregateGeneration: null,
    targetActiveAggregateGeneration: null,
    targetCompletionAggregateGeneration: null,
    cursorDocumentId: null,
    itemCursorId: null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
    processedCount: 0,
    phaseProcessedCount: 0,
    failureCode,
    createdAt: baseTime,
    updatedAt: new Date(baseTime.getTime() + index * 1_000),
    completedAt: terminal
      ? new Date(baseTime.getTime() + index * 1_000)
      : null,
  });
}

function stored(job) {
  return Object.freeze({id: job.jobId, data: Object.freeze({...job})});
}

function context(discoveryDatabase, processStep) {
  return {
    discoveryDatabase,
    dependencies: unusedDependencies,
    now: () => schedulerTime,
    processStep,
  };
}

test("scheduler uses the exact bounded oldest-updated query and leaves backlog", async () => {
  const documents = Array.from({length: 30}, (_, index) =>
    stored(buildJob(index, index % 2 === 0 ? "active" : "retryable")));
  const queries = [];
  let discoveryCalls = 0;
  const discoveryDatabase = {
    async queryDocuments(query) {
      discoveryCalls += 1;
      queries.push(query);
      return documents;
    },
  };
  const calls = [];
  const summary = await processRatingDestructiveOperationWorkHandler(context(
    discoveryDatabase,
    async (_dependencies, jobId, now) => {
      calls.push({jobId, now});
      return Object.freeze({job: buildJob(999), processedDocuments: 1});
    },
  ));

  assert.equal(ratingDestructiveScheduledWorkLimit, 25);
  assert.deepEqual(ratingDestructiveScheduledFunctionOptions, {
    schedule: "every 1 minute",
    region: "us-central1",
  });
  assert.equal(discoveryCalls, 1);
  assert.deepEqual(queries, [{
    collectionPath: ratingDestructiveJobCollection,
    where: [{
      field: "status",
      operator: "in",
      value: ["active", "retryable"],
    }],
    orderBy: [
      {field: "updatedAt", direction: "asc"},
      {field: "__name__", direction: "asc"},
    ],
    limit: 25,
  }]);
  assert.deepEqual(summary, {
    selectedJobs: 25,
    processedJobs: 25,
    failures: 0,
  });
  assert.deepEqual(
    calls.map((call) => call.jobId),
    documents.slice(0, 25).map((document) => document.id),
  );
  assert.ok(calls.every((call) => call.now.getTime() === schedulerTime.getTime()));
  assert.equal(new Set(calls.map((call) => call.jobId)).size, 25);
  assert.equal(documents.length - calls.length, 5);
  assert.deepEqual(Object.keys(summary).sort(), [
    "failures",
    "processedJobs",
    "selectedJobs",
  ]);
});

test("one selected long-running job receives one step and duplicate rows are deduped", async () => {
  const longJob = stored(buildJob(40));
  const nextJob = stored(buildJob(41));
  const calls = [];
  const discoveryDatabase = {
    async queryDocuments() {
      return [longJob, longJob, nextJob, nextJob];
    },
  };

  const summary = await processRatingDestructiveOperationWorkHandler(context(
    discoveryDatabase,
    async (_dependencies, jobId) => {
      calls.push(jobId);
      await Promise.resolve();
      return Object.freeze({job: buildJob(999), processedDocuments: 100});
    },
  ));

  assert.deepEqual(calls, [longJob.id, nextJob.id]);
  assert.deepEqual(summary, {
    selectedJobs: 2,
    processedJobs: 2,
    failures: 0,
  });
});

test("one retryable step failure does not block later selected jobs", async () => {
  const documents = [
    stored(buildJob(50, "retryable")),
    stored(buildJob(51)),
    stored(buildJob(52)),
  ];
  const calls = [];
  const discoveryDatabase = {
    async queryDocuments() {
      return documents;
    },
  };

  const summary = await processRatingDestructiveOperationWorkHandler(context(
    discoveryDatabase,
    async (_dependencies, jobId) => {
      calls.push(jobId);
      if (jobId === documents[0].id) {
        throw new Error("transient test failure");
      }
      return Object.freeze({job: buildJob(999), processedDocuments: 1});
    },
  ));

  assert.deepEqual(calls, documents.map((document) => document.id));
  assert.deepEqual(summary, {
    selectedJobs: 3,
    processedJobs: 2,
    failures: 1,
  });
});

test("manual, complete, and malformed selected documents fail safely untouched", async () => {
  const active = stored(buildJob(60));
  const manual = stored(buildJob(61, "manual_review_required"));
  const complete = stored(buildJob(62, "complete"));
  const malformedJob = buildJob(63);
  const malformed = Object.freeze({
    id: malformedJob.jobId,
    data: Object.freeze({...malformedJob, fingerprint: "not-a-fingerprint"}),
  });
  const calls = [];
  const discoveryDatabase = {
    async queryDocuments() {
      return [manual, complete, malformed, active];
    },
  };

  const summary = await processRatingDestructiveOperationWorkHandler(context(
    discoveryDatabase,
    async (_dependencies, jobId) => {
      calls.push(jobId);
      return Object.freeze({job: buildJob(999), processedDocuments: 1});
    },
  ));

  assert.deepEqual(calls, [active.id]);
  assert.deepEqual(summary, {
    selectedJobs: 4,
    processedJobs: 1,
    failures: 3,
  });
  assert.equal(JSON.stringify(summary).includes(active.id), false);
});

test("overlapping deliveries rely on one processor fence and never loop", async () => {
  const document = stored(buildJob(70));
  let stepCalls = 0;
  let committedMutations = 0;
  let fenceClaimed = false;
  let releaseFirst;
  const firstAtFence = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const discoveryDatabase = {
    async queryDocuments() {
      return [document];
    },
  };
  const fencedStep = async () => {
    stepCalls += 1;
    if (stepCalls === 1) {
      releaseFirst();
      await Promise.resolve();
    }
    if (!fenceClaimed) {
      fenceClaimed = true;
      committedMutations += 1;
    }
    return Object.freeze({job: buildJob(999), processedDocuments: 1});
  };

  const first = processRatingDestructiveOperationWorkHandler(
    context(discoveryDatabase, fencedStep),
  );
  await firstAtFence;
  const second = processRatingDestructiveOperationWorkHandler(
    context(discoveryDatabase, fencedStep),
  );
  const summaries = await Promise.all([first, second]);

  assert.equal(stepCalls, 2);
  assert.equal(committedMutations, 1);
  assert.deepEqual(summaries, [
    {selectedJobs: 1, processedJobs: 1, failures: 0},
    {selectedJobs: 1, processedJobs: 1, failures: 0},
  ]);
});

test("Firestore discovery adapter performs only the supplied bounded read", async () => {
  const operations = [];
  const fakeQuery = {
    where(field, operator, value) {
      operations.push(["where", field, operator, value]);
      return this;
    },
    orderBy(field, direction) {
      operations.push(["orderBy", field, direction]);
      return this;
    },
    limit(value) {
      operations.push(["limit", value]);
      return this;
    },
    async get() {
      operations.push(["get"]);
      return {
        docs: [{
          id: "job-id",
          data: () => ({status: "active"}),
        }],
      };
    },
  };
  const firestore = {
    collection(path) {
      operations.push(["collection", path]);
      return fakeQuery;
    },
  };
  const adapter = createFirestoreRatingDestructiveSchedulerDiscoveryDatabase(
    firestore,
  );
  const documents = await adapter.queryDocuments({
    collectionPath: ratingDestructiveJobCollection,
    where: [{
      field: "status",
      operator: "in",
      value: ["active", "retryable"],
    }],
    orderBy: [
      {field: "updatedAt", direction: "asc"},
      {field: "__name__", direction: "asc"},
    ],
    limit: 25,
  });

  assert.deepEqual(documents, [{id: "job-id", data: {status: "active"}}]);
  assert.deepEqual(operations[0], ["collection", ratingDestructiveJobCollection]);
  assert.deepEqual(operations[1], [
    "where",
    "status",
    "in",
    ["active", "retryable"],
  ]);
  assert.deepEqual(operations[2], ["orderBy", "updatedAt", "asc"]);
  assert.equal(operations[3][0], "orderBy");
  assert.notEqual(operations[3][1], "__name__");
  assert.equal(operations[3][2], "asc");
  assert.deepEqual(operations.slice(4), [["limit", 25], ["get"]]);
});

test("scheduler source has no logging surface for job identities", () => {
  const source = readFileSync(
    new URL("../src/rating_destructive_scheduler.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(?:console|logger)\s*\./u);
});
