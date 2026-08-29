"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");
const {Timestamp} = require("firebase-admin/firestore");

const {
  adminLinkRestaurantAbsoluteLifetimeMs,
  adminLinkRestaurantActiveCollection,
  adminLinkRestaurantIdleLifetimeMs,
  adminLinkRestaurantLeaseLifetimeMs,
  adminLinkRestaurantResultSubcollection,
  adminLinkRestaurantSessionCollection,
  createFirestoreAdminLinkRestaurantRadiusStore,
} = require("../lib/admin_link_restaurant_radius_sessions.js");

const baseNowMs = Date.UTC(2026, 7, 17, 12);

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function activeKeyFor(session) {
  return hash(JSON.stringify([
    session.callerBinding,
    session.queryFingerprint,
    session.searchInstanceHash,
  ]));
}

function completedRequestMarkerId(clientRequestId) {
  return `request_${hash(JSON.stringify([
    "adminLinkRestaurantCompletedAdvanceRequest",
    1,
    clientRequestId,
  ]))}`;
}

function sessionPath(sessionId) {
  return `${adminLinkRestaurantSessionCollection}/${sessionId}`;
}

function activePath(activeKey) {
  return `${adminLinkRestaurantActiveCollection}/${activeKey}`;
}

function resultPath(sessionId, resultId) {
  return `${sessionPath(sessionId)}/${adminLinkRestaurantResultSubcollection}/${resultId}`;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      // firebase-admin Timestamp instances are immutable. Retaining them keeps
      // their toMillis() behavior intact for the production parser.
      return value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      cloneValue(entry),
    ]));
  }
  return value;
}

function logicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(logicalValue);
  }
  if (
    value !== null && typeof value === "object" &&
    typeof value.toMillis === "function"
  ) {
    return {timestampMs: value.toMillis()};
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      logicalValue(entry),
    ]));
  }
  return value;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return {promise, resolve, reject};
}

class DeterministicBarrier {
  constructor(participantCount) {
    this.participantCount = participantCount;
    this.arrivals = [];
    this.release = deferred();
  }

  async arrive(value) {
    this.arrivals.push(value);
    if (this.arrivals.length === this.participantCount) {
      this.release.resolve();
    }
    await this.release.promise;
  }
}

class TransactionConflict extends Error {
  constructor(paths) {
    super("Injected optimistic transaction conflict.");
    this.paths = paths;
  }
}

class TransactionPreconditionError extends Error {
  constructor(message) {
    super(message);
  }
}

class HarnessDocumentReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
    this.id = path.slice(path.lastIndexOf("/") + 1);
  }

  collection(name) {
    return new HarnessCollectionReference(this.database, `${this.path}/${name}`);
  }

  async get() {
    return this.database.snapshot(this.path, this.database.nowMs);
  }
}

class HarnessCollectionReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }

  doc(id) {
    return new HarnessDocumentReference(this.database, `${this.path}/${id}`);
  }

  where() {
    this.database.queryConstructionCount += 1;
    throw new Error("Queries are outside this adapter transaction harness.");
  }

  orderBy() {
    this.database.queryConstructionCount += 1;
    throw new Error("Queries are outside this adapter transaction harness.");
  }
}

class HarnessTransaction {
  constructor(database, runId, attempt, readTimeMs) {
    this.database = database;
    this.runId = runId;
    this.attempt = attempt;
    this.readTimeMs = readTimeMs;
    this.snapshotDocuments = new Map([...database.documents].map(([path, data]) => [
      path,
      cloneValue(data),
    ]));
    this.snapshotVersions = new Map(database.versions);
    this.readVersions = new Map();
    this.writes = [];
  }

  async get(reference) {
    if (this.writes.length !== 0) {
      this.database.readAfterWriteViolations += 1;
      throw new Error("Transaction reads must precede all writes.");
    }
    if (!(reference instanceof HarnessDocumentReference)) {
      throw new Error("Only document reads are supported by this harness.");
    }
    if (!this.readVersions.has(reference.path)) {
      this.readVersions.set(
        reference.path,
        this.snapshotVersions.get(reference.path) ?? 0,
      );
    }
    return this.database.snapshot(
      reference.path,
      this.readTimeMs,
      this.snapshotDocuments,
    );
  }

  create(reference, data) {
    return this.buffer("create", reference, data);
  }

  set(reference, data, options = undefined) {
    return this.buffer(
      options?.merge === true ? "merge-set" : "set",
      reference,
      data,
    );
  }

  update(reference, data) {
    return this.buffer("update", reference, data);
  }

  delete(reference) {
    return this.buffer("delete", reference, undefined);
  }

  buffer(operation, reference, data) {
    if (!(reference instanceof HarnessDocumentReference)) {
      throw new Error("Only document writes are supported by this harness.");
    }
    this.writes.push({
      operation,
      path: reference.path,
      data: cloneValue(data),
    });
    return this;
  }

  writePaths() {
    return this.writes.map((write) => write.path);
  }

  validate() {
    const conflicts = [];
    for (const [path, observedVersion] of this.readVersions) {
      if (this.database.version(path) !== observedVersion) {
        conflicts.push(path);
      }
    }
    if (conflicts.length !== 0) {
      throw new TransactionConflict(conflicts);
    }

    // Validate every write precondition against an isolated existence model
    // before applying any buffered write.
    const existence = new Map();
    const exists = (path) => existence.has(path)
      ? existence.get(path)
      : this.database.documents.has(path);
    for (const write of this.writes) {
      if (write.operation === "create") {
        if (exists(write.path)) {
          throw new TransactionPreconditionError(
            `Cannot create existing document ${write.path}.`,
          );
        }
        existence.set(write.path, true);
      } else if (write.operation === "update") {
        if (!exists(write.path)) {
          throw new TransactionPreconditionError(
            `Cannot update missing document ${write.path}.`,
          );
        }
        existence.set(write.path, true);
      } else if (write.operation === "delete") {
        existence.set(write.path, false);
      } else {
        existence.set(write.path, true);
      }
    }
  }

  commit() {
    this.validate();
    const nextDocuments = new Map(this.database.documents);
    const nextVersions = new Map(this.database.versions);
    for (const write of this.writes) {
      const previous = nextDocuments.get(write.path);
      if (write.operation === "delete") {
        nextDocuments.delete(write.path);
      } else if (write.operation === "update" || write.operation === "merge-set") {
        nextDocuments.set(write.path, {
          ...cloneValue(previous),
          ...cloneValue(write.data),
        });
      } else {
        nextDocuments.set(write.path, cloneValue(write.data));
      }
      nextVersions.set(write.path, (nextVersions.get(write.path) ?? 0) + 1);
    }
    // The state swap is the only visibility point for the complete write set.
    this.database.documents = nextDocuments;
    this.database.versions = nextVersions;
  }
}

class VersionedFirestoreHarness {
  constructor(nowMs = baseNowMs) {
    this.nowMs = nowMs;
    this.documents = new Map();
    this.versions = new Map();
    this.runCount = 0;
    this.transactionAttempts = [];
    this.conflictCount = 0;
    this.readAfterWriteViolations = 0;
    this.queryConstructionCount = 0;
    this.beforeCommit = null;
    this.commitFailures = new Map();
  }

  collection(path) {
    return new HarnessCollectionReference(this, path);
  }

  async getAll() {
    throw new Error("getAll is outside this adapter transaction harness.");
  }

  version(path) {
    return this.versions.get(path) ?? 0;
  }

  snapshot(path, readTimeMs, documents = this.documents) {
    const stored = documents.get(path);
    return {
      id: path.slice(path.lastIndexOf("/") + 1),
      exists: stored !== undefined,
      readTime: {toMillis: () => readTimeMs},
      data: () => stored === undefined ? undefined : cloneValue(stored),
    };
  }

  read(path) {
    const value = this.documents.get(path);
    return value === undefined ? undefined : cloneValue(value);
  }

  writeDirect(path, data) {
    this.documents.set(path, cloneValue(data));
    this.versions.set(path, this.version(path) + 1);
  }

  deleteDirect(path) {
    this.documents.delete(path);
    this.versions.set(path, this.version(path) + 1);
  }

  pathsUnder(prefix) {
    return [...this.documents.keys()].filter((path) => path.startsWith(prefix));
  }

  failNextCommit(runId, error) {
    this.commitFailures.set(runId, error);
  }

  nextRunId() {
    return this.runCount + 1;
  }

  attemptsFor(runId) {
    return this.transactionAttempts.filter((entry) => entry.runId === runId);
  }

  async runTransaction(operation) {
    const runId = ++this.runCount;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const transaction = new HarnessTransaction(
        this,
        runId,
        attempt,
        this.nowMs,
      );
      let result;
      try {
        result = await operation(transaction);
      } catch (error) {
        this.transactionAttempts.push(this.attemptRecord(
          transaction,
          "callback-error",
        ));
        throw error;
      }

      try {
        if (this.beforeCommit !== null) {
          await this.beforeCommit({runId, attempt, transaction});
        }
        const commitFailure = this.commitFailures.get(runId);
        if (commitFailure !== undefined) {
          this.commitFailures.delete(runId);
          transaction.validate();
          throw commitFailure;
        }
        transaction.commit();
        this.transactionAttempts.push(this.attemptRecord(
          transaction,
          "committed",
        ));
        return result;
      } catch (error) {
        if (error instanceof TransactionConflict) {
          this.conflictCount += 1;
          this.transactionAttempts.push(this.attemptRecord(
            transaction,
            "conflict",
            error.paths,
          ));
          continue;
        }
        this.transactionAttempts.push(this.attemptRecord(
          transaction,
          "commit-error",
        ));
        throw error;
      }
    }
    throw new Error("Transaction retry limit exhausted.");
  }

  attemptRecord(transaction, outcome, conflictPaths = []) {
    return {
      runId: transaction.runId,
      attempt: transaction.attempt,
      readTimeMs: transaction.readTimeMs,
      reads: [...transaction.readVersions.entries()],
      writes: transaction.writes.map((write) => ({
        operation: write.operation,
        path: write.path,
      })),
      outcome,
      conflictPaths: [...conflictPaths],
    };
  }
}

function makeSession(id, overrides = {}) {
  return Object.freeze({
    id,
    schemaVersion: 1,
    orderingVersion: 1,
    state: "preparing",
    callerBinding: hash("caller-binding"),
    queryFingerprint: hash("query-fingerprint"),
    searchInstanceHash: hash("search-instance"),
    pageSize: 50,
    center: Object.freeze({
      latitude: 28.5383,
      longitude: -81.3792,
      displayName: "Orlando, FL",
    }),
    centerInput: Object.freeze({mode: "location", location: "Orlando, FL"}),
    radiusMiles: 10,
    normalizedRestaurantName: null,
    sources: Object.freeze(["biteScore"]),
    biteScoreStatus: "active",
    filterContractVersion: 1,
    needsQrPreparation: false,
    ranges: Object.freeze([Object.freeze({
      source: "biteScore",
      collectionName: "bitescore_restaurants",
      start: "dhw",
      end: "dhx",
      biteScoreIsActive: true,
      afterGeohash: null,
      afterDocumentId: null,
      exhausted: false,
    })]),
    createdAtMs: baseNowMs,
    lastUsedAtMs: baseNowMs,
    idleExpiresAtMs: baseNowMs + adminLinkRestaurantIdleLifetimeMs,
    absoluteExpiresAtMs: baseNowMs + adminLinkRestaurantAbsoluteLifetimeMs,
    leaseToken: null,
    leaseUntilMs: null,
    leaseGeneration: 0,
    lastCompletedRequestId: null,
    scannedDocumentCount: 0,
    failureMessage: null,
    ...overrides,
  });
}

function makeResult(hexCharacter, session, overrides = {}) {
  return Object.freeze({
    id: hexCharacter.repeat(64),
    source: "biteScore",
    sourceDocumentId: `restaurant-${hexCharacter}`,
    distanceMillimeters: Number.parseInt(hexCharacter, 16) * 100 + 1,
    normalizedName: `restaurant ${hexCharacter}`,
    expiresAtMs: session.absoluteExpiresAtMs,
    ...overrides,
  });
}

function advancedRanges(session, documentId, exhausted) {
  return Object.freeze(session.ranges.map((range) => Object.freeze({
    ...range,
    afterGeohash: "dhw5",
    afterDocumentId: documentId,
    exhausted,
  })));
}

async function acquire(database, session) {
  const store = createFirestoreAdminLinkRestaurantRadiusStore(
    database,
    () => database.nowMs,
  );
  const activeKey = activeKeyFor(session);
  const acquired = await store.acquireInitialSession({
    activeKey,
    session,
    nowMs: database.nowMs,
  });
  return {store, activeKey, session: acquired};
}

async function claim(store, session, clientRequestId, leaseToken) {
  const result = await store.claimSession({
    sessionId: session.id,
    callerBinding: session.callerBinding,
    queryFingerprint: session.queryFingerprint,
    clientRequestId,
    leaseToken,
    nowMs: baseNowMs,
  });
  assert.equal(result.status, "claimed");
  return result.session;
}

async function finish(store, session, clientRequestId, results, overrides = {}) {
  const state = overrides.state ?? "ready";
  const ranges = overrides.ranges ?? (state === "ready"
    ? Object.freeze(session.ranges.map((range) => Object.freeze({
      ...range,
      exhausted: true,
    })))
    : session.ranges);
  return store.finishAdvance({
    sessionId: session.id,
    leaseToken: session.leaseToken,
    leaseGeneration: session.leaseGeneration,
    clientRequestId,
    ranges,
    documentsRead: results.length,
    state,
    results,
  });
}

test("transaction harness replays conflicts, rolls back, and enforces ordering", async () => {
  const database = new VersionedFirestoreHarness();
  const statePath = "harness/state";
  const firstOnlyPath = "harness/first-only";
  const finalOnlyPath = "harness/final-only";
  database.writeDirect(statePath, {value: 0});
  let callbackCount = 0;
  const replayRunId = database.nextRunId();
  database.beforeCommit = async ({runId, attempt}) => {
    if (runId === replayRunId && attempt === 1) {
      assert.equal(database.read(firstOnlyPath), undefined);
      database.writeDirect(statePath, {value: 1});
    }
  };

  const replayResult = await database.runTransaction(async (transaction) => {
    callbackCount += 1;
    const state = await transaction.get(database.collection("harness").doc("state"));
    if (callbackCount === 1) {
      transaction.set(database.collection("harness").doc("first-only"), {
        fromAttempt: 1,
      });
    } else {
      transaction.set(database.collection("harness").doc("final-only"), {
        fromAttempt: callbackCount,
      });
    }
    transaction.update(database.collection("harness").doc("state"), {
      value: state.data().value + 1,
    });
    return callbackCount;
  });

  assert.equal(replayResult, 2);
  assert.equal(callbackCount, 2);
  assert.equal(database.read(firstOnlyPath), undefined);
  assert.deepEqual(database.read(finalOnlyPath), {fromAttempt: 2});
  assert.deepEqual(database.read(statePath), {value: 2});
  assert.deepEqual(
    database.attemptsFor(replayRunId).map((entry) => entry.outcome),
    ["conflict", "committed"],
  );

  database.beforeCommit = null;
  const thrownPath = "harness/thrown";
  await assert.rejects(
    database.runTransaction(async (transaction) => {
      transaction.set(database.collection("harness").doc("thrown"), {bad: true});
      throw new Error("callback failed after buffering a write");
    }),
    /callback failed/u,
  );
  assert.equal(database.read(thrownPath), undefined);

  const orderedPath = "harness/ordered";
  await assert.rejects(
    database.runTransaction(async (transaction) => {
      transaction.set(database.collection("harness").doc("ordered"), {bad: true});
      await transaction.get(database.collection("harness").doc("state"));
    }),
    /reads must precede all writes/u,
  );
  assert.equal(database.read(orderedPath), undefined);
  assert.equal(database.readAfterWriteViolations, 1);

  database.writeDirect("harness/update", {before: true, retained: true});
  database.writeDirect("harness/delete", {present: true});
  await database.runTransaction(async (transaction) => {
    transaction.create(database.collection("harness").doc("create"), {created: true});
    transaction.set(database.collection("harness").doc("set"), {set: true});
    transaction.update(database.collection("harness").doc("update"), {before: false});
    transaction.delete(database.collection("harness").doc("delete"));
  });
  assert.deepEqual(database.read("harness/create"), {created: true});
  assert.deepEqual(database.read("harness/set"), {set: true});
  assert.deepEqual(database.read("harness/update"), {
    before: false,
    retained: true,
  });
  assert.equal(database.read("harness/delete"), undefined);
  assert.ok(database.version("harness/delete") > 0);
});

test("transaction harness replays a tombstone-version conflict atomically", async () => {
  const database = new VersionedFirestoreHarness();
  const tombstonePath = "harness/tombstone-conflict";
  const firstOnlyPath = "harness/tombstone-first-only";
  const finalOnlyPath = "harness/tombstone-final-only";
  const tombstoneReference = database
    .collection("harness")
    .doc("tombstone-conflict");

  database.writeDirect(tombstonePath, {state: "live"});
  const liveDocumentVersion = database.version(tombstonePath);
  assert.equal(liveDocumentVersion, 1);
  database.deleteDirect(tombstonePath);
  const tombstoneVersion = database.version(tombstonePath);
  assert.equal(tombstoneVersion, 2);
  assert.ok(tombstoneVersion > liveDocumentVersion);
  assert.equal(database.read(tombstonePath), undefined);

  let callbackCount = 0;
  let concurrentMutationVersion;
  let mutationRunId;
  const transactionARunId = database.nextRunId();
  database.beforeCommit = async ({runId, attempt, transaction}) => {
    if (runId !== transactionARunId || attempt !== 1) return;

    assert.equal(
      transaction.readVersions.get(tombstonePath),
      tombstoneVersion,
    );
    assert.ok(transaction.writePaths().includes(firstOnlyPath));
    assert.equal(database.read(firstOnlyPath), undefined);

    mutationRunId = database.nextRunId();
    await database.runTransaction(async (transactionB) => {
      transactionB.create(tombstoneReference, {state: "recreated-by-b"});
    });
    concurrentMutationVersion = database.version(tombstonePath);
    assert.equal(concurrentMutationVersion, 3);
    assert.ok(concurrentMutationVersion > tombstoneVersion);
  };

  let result;
  try {
    result = await database.runTransaction(async (transactionA) => {
      callbackCount += 1;
      const snapshot = await transactionA.get(tombstoneReference);
      if (callbackCount === 1) {
        assert.equal(snapshot.exists, false);
        transactionA.set(
          database.collection("harness").doc("tombstone-first-only"),
          {fromAttempt: 1, observedVersion: tombstoneVersion},
        );
      } else {
        assert.equal(snapshot.exists, true);
        assert.deepEqual(snapshot.data(), {state: "recreated-by-b"});
        assert.equal(database.read(firstOnlyPath), undefined);
        transactionA.set(
          database.collection("harness").doc("tombstone-final-only"),
          {fromAttempt: 2, observedVersion: concurrentMutationVersion},
        );
      }
      return callbackCount;
    });
  } finally {
    database.beforeCommit = null;
  }

  assert.equal(result, 2);
  assert.equal(callbackCount, 2);
  assert.equal(database.conflictCount, 1);
  assert.deepEqual(
    database.attemptsFor(transactionARunId).map((entry) => entry.outcome),
    ["conflict", "committed"],
  );
  assert.deepEqual(
    database.attemptsFor(transactionARunId).map((entry) =>
      entry.reads.find(([path]) => path === tombstonePath)?.[1]),
    [tombstoneVersion, concurrentMutationVersion],
  );
  assert.deepEqual(
    database.attemptsFor(transactionARunId)[0].conflictPaths,
    [tombstonePath],
  );
  assert.deepEqual(
    database.attemptsFor(mutationRunId).map((entry) => entry.outcome),
    ["committed"],
  );
  assert.equal(database.read(firstOnlyPath), undefined);
  assert.equal(database.version(firstOnlyPath), 0);
  assert.deepEqual(database.read(finalOnlyPath), {
    fromAttempt: 2,
    observedVersion: concurrentMutationVersion,
  });
  assert.equal(database.version(finalOnlyPath), 1);
  assert.deepEqual(database.read(tombstonePath), {state: "recreated-by-b"});
  assert.equal(database.version(tombstonePath), concurrentMutationVersion);
});

test("production session parser accepts canonical normalized values and rejects drift", async () => {
  const database = new VersionedFirestoreHarness();
  const canonical = "ff".repeat(50);
  const initial = makeSession("session-normalized", {
    normalizedRestaurantName: canonical,
  });
  const {store, session} = await acquire(database, initial);
  assert.equal(session.normalizedRestaurantName, canonical);
  assert.equal(
    (await store.getSession(session.id)).normalizedRestaurantName,
    canonical,
  );

  const path = sessionPath(session.id);
  database.writeDirect(path, {
    ...database.read(path),
    normalizedRestaurantName: "Restaurant",
  });
  await assert.rejects(
    store.getSession(session.id),
    (error) => error.code === "failed-precondition",
  );

  database.writeDirect(path, {
    ...database.read(path),
    normalizedRestaurantName: "x".repeat(101),
  });
  await assert.rejects(
    store.getSession(session.id),
    (error) => error.code === "failed-precondition",
  );
});

test("production session storage persists v1 filters and parses legacy missing fields off", async () => {
  const database = new VersionedFirestoreHarness();
  const initial = makeSession("session-filter-contract", {
    needsQrPreparation: true,
  });
  const {store, session} = await acquire(database, initial);
  const stored = database.read(sessionPath(session.id));
  assert.equal(stored.filterContractVersion, 1);
  assert.equal(stored.needsQrPreparation, true);
  assert.equal((await store.getSession(session.id)).needsQrPreparation, true);

  const {
    filterContractVersion: _filterContractVersion,
    needsQrPreparation: _needsQrPreparation,
    ...legacy
  } = stored;
  database.writeDirect(sessionPath(session.id), legacy);
  const parsedLegacy = await store.getSession(session.id);
  assert.equal(parsedLegacy.filterContractVersion, 1);
  assert.equal(parsedLegacy.needsQrPreparation, false);

  database.writeDirect(sessionPath(session.id), {
    ...legacy,
    filterContractVersion: 1,
  });
  await assert.rejects(
    store.getSession(session.id),
    (error) => error.code === "failed-precondition",
  );
});

test("A: concurrent production acquisition conflicts and converges on one session", async () => {
  const database = new VersionedFirestoreHarness();
  const store = createFirestoreAdminLinkRestaurantRadiusStore(
    database,
    () => database.nowMs,
  );
  const first = makeSession("session-concurrent-a");
  const second = makeSession("session-concurrent-b");
  const activeKey = activeKeyFor(first);
  assert.equal(activeKeyFor(second), activeKey);
  const acquisitionBarrier = new DeterministicBarrier(2);
  database.beforeCommit = async ({attempt, transaction}) => {
    const createsParentSession = transaction.writes.some((write) =>
      write.operation === "create" &&
      write.path.startsWith(`${adminLinkRestaurantSessionCollection}/`) &&
      write.path.split("/").length === 2);
    if (attempt === 1 && createsParentSession) {
      await acquisitionBarrier.arrive(transaction.runId);
    }
  };
  const firstAcquisitionRunId = database.nextRunId();
  const [firstResult, secondResult] = await Promise.all([
    store.acquireInitialSession({
      activeKey,
      session: first,
      nowMs: database.nowMs,
    }),
    store.acquireInitialSession({
      activeKey,
      session: second,
      nowMs: database.nowMs,
    }),
  ]);
  const acquisitionRunIds = [firstAcquisitionRunId, firstAcquisitionRunId + 1];
  database.beforeCommit = null;

  assert.equal(acquisitionBarrier.arrivals.length, 2);
  assert.equal(firstResult.id, secondResult.id);
  const parentSessions = database.pathsUnder(
    `${adminLinkRestaurantSessionCollection}/`,
  ).filter((path) => path.split("/").length === 2);
  assert.deepEqual(parentSessions, [sessionPath(firstResult.id)]);
  assert.deepEqual(
    database.pathsUnder(`${adminLinkRestaurantActiveCollection}/`),
    [activePath(activeKey)],
  );
  const persistedActivePointer = database.read(activePath(activeKey));
  assert.equal(
    persistedActivePointer.expiresAt.toMillis(),
    Math.min(firstResult.idleExpiresAtMs, firstResult.absoluteExpiresAtMs),
  );
  assert.ok(persistedActivePointer.expiresAt.toMillis() > database.nowMs);
  assert.deepEqual(
    logicalValue(persistedActivePointer),
    logicalValue({
      sessionId: firstResult.id,
      callerBinding: first.callerBinding,
      queryFingerprint: first.queryFingerprint,
      searchInstanceHash: first.searchInstanceHash,
      expiresAt: database.read(activePath(activeKey)).expiresAt,
    }),
  );
  const acquisitionAttempts = acquisitionRunIds.flatMap((runId) =>
    database.attemptsFor(runId));
  assert.equal(acquisitionAttempts.length, 3);
  assert.equal(
    acquisitionAttempts.filter((entry) => entry.outcome === "conflict").length,
    1,
  );
  assert.equal(
    acquisitionAttempts.filter((entry) => entry.outcome === "committed").length,
    2,
  );
  for (const runId of acquisitionRunIds) {
    const firstAttempt = database.attemptsFor(runId)[0];
    assert.deepEqual(firstAttempt.reads[0], [activePath(activeKey), 0]);
  }
  assert.deepEqual(
    acquisitionRunIds.map((runId) => database.attemptsFor(runId).length).sort(),
    [1, 2],
  );

  const claimBarrier = new DeterministicBarrier(2);
  database.beforeCommit = async ({attempt, transaction}) => {
    const claimsSession = transaction.writes.some((write) =>
      write.operation === "update" && write.path === sessionPath(firstResult.id));
    if (attempt === 1 && claimsSession) {
      await claimBarrier.arrive(transaction.runId);
    }
  };
  const claimRunId = database.nextRunId();
  const [firstClaim, secondClaim] = await Promise.all([
    store.claimSession({
      sessionId: firstResult.id,
      callerBinding: first.callerBinding,
      queryFingerprint: first.queryFingerprint,
      clientRequestId: "concurrent-claim-a",
      leaseToken: "lease-concurrent-a",
      nowMs: database.nowMs,
    }),
    store.claimSession({
      sessionId: firstResult.id,
      callerBinding: first.callerBinding,
      queryFingerprint: first.queryFingerprint,
      clientRequestId: "concurrent-claim-b",
      leaseToken: "lease-concurrent-b",
      nowMs: database.nowMs,
    }),
  ]);
  database.beforeCommit = null;
  assert.equal(claimBarrier.arrivals.length, 2);
  assert.deepEqual(
    [firstClaim.status, secondClaim.status].sort(),
    ["busy", "claimed"],
  );
  assert.deepEqual(
    [database.attemptsFor(claimRunId).length,
      database.attemptsFor(claimRunId + 1).length].sort(),
    [1, 2],
  );
  assert.equal(
    [firstClaim, secondClaim].filter((entry) => entry.status === "claimed").length,
    1,
  );
  assert.equal(database.readAfterWriteViolations, 0);
});

test("B: stale production finisher cannot overwrite a lease takeover", async () => {
  const database = new VersionedFirestoreHarness();
  const initial = makeSession("session-takeover");
  const {store, activeKey, session} = await acquire(database, initial);
  const claimedA = await claim(
    store,
    session,
    "takeover-request-a",
    "lease-takeover-a",
  );
  const resultA = makeResult("a", claimedA);
  const resultB = makeResult("b", claimedA);
  const markerAPath = resultPath(
    session.id,
    completedRequestMarkerId("takeover-request-a"),
  );
  const markerBPath = resultPath(
    session.id,
    completedRequestMarkerId("takeover-request-b"),
  );
  const unrelatedPath = resultPath(session.id, "f".repeat(64));
  database.writeDirect(unrelatedPath, {
    source: "biteScore",
    sourceDocumentId: "unrelated",
    distanceMillimeters: 999_999,
    normalizedName: "unrelated",
    schemaVersion: 1,
    orderingVersion: 1,
    expiresAt: Timestamp.fromMillis(session.absoluteExpiresAtMs),
  });
  const unrelatedBefore = logicalValue(database.read(unrelatedPath));

  const paused = deferred();
  const resume = deferred();
  const finishARunId = database.nextRunId();
  database.beforeCommit = async ({runId, attempt, transaction}) => {
    if (runId === finishARunId && attempt === 1) {
      assert.ok(transaction.readVersions.has(sessionPath(session.id)));
      assert.ok(transaction.readVersions.has(activePath(activeKey)));
      assert.ok(transaction.writePaths().includes(resultPath(session.id, resultA.id)));
      assert.ok(transaction.writePaths().includes(markerAPath));
      assert.equal(database.read(resultPath(session.id, resultA.id)), undefined);
      assert.equal(database.read(markerAPath), undefined);
      paused.resolve();
      await resume.promise;
    }
  };
  const finishAPromise = finish(
    store,
    claimedA,
    "takeover-request-a",
    [resultA],
    {
      state: "ready",
      ranges: advancedRanges(claimedA, "cursor-a", true),
    },
  );
  await paused.promise;

  let completedB;
  let persistedSessionAfterB;
  let persistedActiveAfterB;
  let persistedResultBAfterB;
  let persistedMarkerBAfterB;
  try {
    database.nowMs = claimedA.leaseUntilMs + 1;
    const claimedB = await claim(
      store,
      claimedA,
      "takeover-request-b",
      "lease-takeover-b",
    );
    assert.equal(claimedB.leaseGeneration, claimedA.leaseGeneration + 1);
    completedB = await finish(
      store,
      claimedB,
      "takeover-request-b",
      [resultB],
      {
        state: "ready",
        ranges: advancedRanges(claimedB, "cursor-b", true),
      },
    );
    persistedSessionAfterB = logicalValue(database.read(sessionPath(session.id)));
    persistedActiveAfterB = logicalValue(database.read(activePath(activeKey)));
    persistedResultBAfterB = logicalValue(
      database.read(resultPath(session.id, resultB.id)),
    );
    persistedMarkerBAfterB = logicalValue(database.read(markerBPath));
  } finally {
    resume.resolve();
  }

  await assert.rejects(
    finishAPromise,
    (error) => error.code === "failed-precondition",
  );
  database.beforeCommit = null;

  assert.equal(database.read(resultPath(session.id, resultA.id)), undefined);
  assert.equal(database.read(markerAPath), undefined);
  assert.notEqual(database.read(resultPath(session.id, resultB.id)), undefined);
  assert.notEqual(database.read(markerBPath), undefined);
  assert.equal(completedB.lastCompletedRequestId, "takeover-request-b");
  assert.equal(completedB.scannedDocumentCount, 1);
  assert.equal(completedB.ranges[0].afterDocumentId, "cursor-b");
  assert.notEqual(completedB.ranges[0].afterDocumentId, "cursor-a");
  assert.deepEqual(logicalValue(database.read(sessionPath(session.id))), persistedSessionAfterB);
  assert.deepEqual(logicalValue(database.read(activePath(activeKey))), persistedActiveAfterB);
  assert.deepEqual(
    logicalValue(database.read(resultPath(session.id, resultB.id))),
    persistedResultBAfterB,
  );
  assert.deepEqual(logicalValue(database.read(markerBPath)), persistedMarkerBAfterB);
  assert.deepEqual(logicalValue(database.read(unrelatedPath)), unrelatedBefore);
  assert.deepEqual(
    database.attemptsFor(finishARunId).map((entry) => entry.outcome),
    ["conflict", "callback-error"],
  );
  assert.equal(database.attemptsFor(finishARunId)[1].writes.length, 0);
  assert.equal(database.readAfterWriteViolations, 0);
});

test("C: production finish retries one atomic conflict without duplicate progress", async () => {
  const database = new VersionedFirestoreHarness();
  const initial = makeSession("session-conflict-retry");
  const {store, activeKey, session} = await acquire(database, initial);
  const claimed = await claim(
    store,
    session,
    "conflict-request",
    "lease-conflict",
  );
  const result = makeResult("c", claimed);
  const materializedPath = resultPath(session.id, result.id);
  const markerPath = resultPath(
    session.id,
    completedRequestMarkerId("conflict-request"),
  );
  const sessionBefore = logicalValue(database.read(sessionPath(session.id)));
  const activeBefore = logicalValue(database.read(activePath(activeKey)));
  const finishRunId = database.nextRunId();
  let invisibleFirstWriteSet = false;
  database.beforeCommit = async ({runId, attempt, transaction}) => {
    if (runId === finishRunId && attempt === 1) {
      assert.ok(transaction.writePaths().includes(materializedPath));
      assert.ok(transaction.writePaths().includes(markerPath));
      assert.ok(transaction.writePaths().includes(sessionPath(session.id)));
      assert.ok(transaction.writePaths().includes(activePath(activeKey)));
      assert.equal(database.read(materializedPath), undefined);
      assert.equal(database.read(markerPath), undefined);
      assert.deepEqual(logicalValue(database.read(sessionPath(session.id))), sessionBefore);
      assert.deepEqual(logicalValue(database.read(activePath(activeKey))), activeBefore);
      invisibleFirstWriteSet = true;
      database.writeDirect(activePath(activeKey), database.read(activePath(activeKey)));
    }
  };

  const completed = await finish(
    store,
    claimed,
    "conflict-request",
    [result],
  );
  database.beforeCommit = null;
  assert.equal(invisibleFirstWriteSet, true);
  assert.deepEqual(
    database.attemptsFor(finishRunId).map((entry) => entry.outcome),
    ["conflict", "committed"],
  );
  assert.equal(database.attemptsFor(finishRunId).length, 2);
  assert.notEqual(database.read(materializedPath), undefined);
  assert.notEqual(database.read(markerPath), undefined);
  assert.equal(database.version(materializedPath), 1);
  assert.equal(database.version(markerPath), 1);
  assert.equal(completed.scannedDocumentCount, 1);
  assert.equal(completed.lastCompletedRequestId, "conflict-request");
  const persistedSession = database.read(sessionPath(session.id));
  assert.equal(persistedSession.scannedDocumentCount, 1);
  assert.equal(persistedSession.lastCompletedRequestId, "conflict-request");
  assert.equal(persistedSession.ranges[0].exhausted, true);
  const persistedActive = database.read(activePath(activeKey));
  assert.equal(persistedActive.sessionId, session.id);
  assert.equal(persistedActive.callerBinding, session.callerBinding);
  assert.equal(persistedActive.queryFingerprint, session.queryFingerprint);
  assert.equal(persistedActive.searchInstanceHash, session.searchInstanceHash);
  assert.equal(
    persistedActive.expiresAt.toMillis(),
    Math.min(completed.idleExpiresAtMs, completed.absoluteExpiresAtMs),
  );
  assert.equal(
    database.pathsUnder(`${sessionPath(session.id)}/${adminLinkRestaurantResultSubcollection}/`)
      .filter((path) => path === materializedPath).length,
    1,
  );
  assert.equal(database.readAfterWriteViolations, 0);
});

test("D: failed production finish commit rolls back and remains safely retryable", async () => {
  const database = new VersionedFirestoreHarness();
  const initial = makeSession("session-failure-rollback");
  const {store, activeKey, session} = await acquire(database, initial);
  const claimed = await claim(
    store,
    session,
    "rollback-request",
    "lease-rollback",
  );
  const result = makeResult("d", claimed);
  const materializedPath = resultPath(session.id, result.id);
  const markerPath = resultPath(
    session.id,
    completedRequestMarkerId("rollback-request"),
  );
  const sessionBefore = logicalValue(database.read(sessionPath(session.id)));
  const activeBefore = logicalValue(database.read(activePath(activeKey)));
  const failedRunId = database.nextRunId();
  database.failNextCommit(
    failedRunId,
    new Error("injected commit failure after write preparation"),
  );

  await assert.rejects(
    finish(store, claimed, "rollback-request", [result]),
    /injected commit failure/u,
  );
  const failedAttempt = database.attemptsFor(failedRunId);
  assert.equal(failedAttempt.length, 1);
  assert.equal(failedAttempt[0].outcome, "commit-error");
  assert.ok(failedAttempt[0].writes.some((write) => write.path === materializedPath));
  assert.ok(failedAttempt[0].writes.some((write) => write.path === markerPath));
  assert.ok(failedAttempt[0].writes.some((write) =>
    write.path === sessionPath(session.id)));
  assert.ok(failedAttempt[0].writes.some((write) =>
    write.path === activePath(activeKey)));
  assert.equal(database.read(materializedPath), undefined);
  assert.equal(database.read(markerPath), undefined);
  assert.deepEqual(logicalValue(database.read(sessionPath(session.id))), sessionBefore);
  assert.deepEqual(logicalValue(database.read(activePath(activeKey))), activeBefore);

  const completed = await finish(
    store,
    claimed,
    "rollback-request",
    [result],
  );
  assert.notEqual(database.read(materializedPath), undefined);
  assert.notEqual(database.read(markerPath), undefined);
  assert.equal(completed.scannedDocumentCount, 1);
  assert.equal(completed.lastCompletedRequestId, "rollback-request");
  assert.equal(
    database.read(sessionPath(session.id)).lastCompletedRequestId,
    "rollback-request",
  );
  assert.equal(database.read(sessionPath(session.id)).scannedDocumentCount, 1);
  assert.equal(
    database.read(activePath(activeKey)).expiresAt.toMillis(),
    Math.min(completed.idleExpiresAtMs, completed.absoluteExpiresAtMs),
  );
  assert.equal(database.version(materializedPath), 1);
  assert.equal(database.version(markerPath), 1);
  assert.equal(database.readAfterWriteViolations, 0);
});

test("E: every exercised production adapter transaction obeys reads-before-writes", async () => {
  const database = new VersionedFirestoreHarness();
  const initial = makeSession("session-read-order");
  const {store, activeKey, session} = await acquire(database, initial);
  const firstClaim = await claim(
    store,
    session,
    "read-order-request-a",
    "lease-read-order-a",
  );
  const ready = await finish(
    store,
    firstClaim,
    "read-order-request-a",
    [makeResult("e", firstClaim)],
  );
  database.nowMs += 1_000;
  const touched = await store.touchReadySession({
    sessionId: session.id,
    activeKey,
    callerBinding: session.callerBinding,
    queryFingerprint: session.queryFingerprint,
    nowMs: database.nowMs,
  });
  assert.ok(touched.idleExpiresAtMs > ready.idleExpiresAtMs);
  assert.equal(database.readAfterWriteViolations, 0);
  assert.equal(database.queryConstructionCount, 0);

  const failureDatabase = new VersionedFirestoreHarness();
  const failureInitial = makeSession("session-read-order-failure");
  const failureSetup = await acquire(failureDatabase, failureInitial);
  const failureClaim = await claim(
    failureSetup.store,
    failureSetup.session,
    "read-order-failure-request",
    "lease-read-order-failure",
  );
  await failureSetup.store.failAdvance({
    sessionId: failureSetup.session.id,
    leaseToken: failureClaim.leaseToken,
    leaseGeneration: failureClaim.leaseGeneration,
    clientRequestId: "read-order-failure-request",
  });
  assert.equal(
    (await failureSetup.store.getSession(failureSetup.session.id)).state,
    "failed",
  );
  assert.equal(failureDatabase.readAfterWriteViolations, 0);
  assert.equal(failureDatabase.queryConstructionCount, 0);
  assert.ok(database.transactionAttempts.length >= 4);
  assert.ok(database.transactionAttempts.every((entry) =>
    entry.outcome === "committed"));
  assert.ok(failureDatabase.transactionAttempts.length >= 3);
  assert.ok(failureDatabase.transactionAttempts.every((entry) =>
    entry.outcome === "committed"));
});

test("F: an old completed request marker remains idempotent after a later advance", async () => {
  const database = new VersionedFirestoreHarness();
  const initial = makeSession("session-old-request");
  const {store, session} = await acquire(database, initial);
  const oldRequestId = "old-completed-request";
  const laterRequestId = "later-completed-request";
  const oldClaim = await claim(
    store,
    session,
    oldRequestId,
    "lease-old-request",
  );
  const oldResult = makeResult("1", oldClaim);
  const afterOld = await finish(
    store,
    oldClaim,
    oldRequestId,
    [oldResult],
    {
      state: "preparing",
      ranges: advancedRanges(oldClaim, "cursor-old", false),
    },
  );
  database.nowMs += 1_000;
  const laterClaim = await claim(
    store,
    afterOld,
    laterRequestId,
    "lease-later-request",
  );
  const laterResult = makeResult("2", laterClaim);
  await finish(
    store,
    laterClaim,
    laterRequestId,
    [laterResult],
    {
      state: "ready",
      ranges: advancedRanges(laterClaim, "cursor-later", true),
    },
  );

  const oldMarkerId = completedRequestMarkerId(oldRequestId);
  const laterMarkerId = completedRequestMarkerId(laterRequestId);
  assert.match(oldResult.id, /^[a-f0-9]{64}$/u);
  assert.match(laterResult.id, /^[a-f0-9]{64}$/u);
  assert.match(oldMarkerId, /^request_[a-f0-9]{64}$/u);
  assert.match(laterMarkerId, /^request_[a-f0-9]{64}$/u);
  assert.notEqual(oldMarkerId, oldResult.id);
  assert.notEqual(oldMarkerId, laterResult.id);
  assert.notEqual(laterMarkerId, oldResult.id);
  assert.notEqual(laterMarkerId, laterResult.id);
  const sessionBeforeRetry = logicalValue(database.read(sessionPath(session.id)));
  const activeBeforeRetry = logicalValue(
    database.read(activePath(activeKeyFor(session))),
  );
  const resultPathsBeforeRetry = database.pathsUnder(
    `${sessionPath(session.id)}/${adminLinkRestaurantResultSubcollection}/`,
  ).sort();
  const queryCountBeforeRetry = database.queryConstructionCount;
  const retryRunId = database.nextRunId();

  const duplicate = await store.claimSession({
    sessionId: session.id,
    callerBinding: session.callerBinding,
    queryFingerprint: session.queryFingerprint,
    clientRequestId: oldRequestId,
    leaseToken: "lease-old-retry",
    nowMs: database.nowMs,
  });

  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(logicalValue(duplicate.session), logicalValue(
    await store.getSession(session.id),
  ));
  assert.deepEqual(logicalValue(database.read(sessionPath(session.id))), sessionBeforeRetry);
  assert.deepEqual(
    logicalValue(database.read(activePath(activeKeyFor(session)))),
    activeBeforeRetry,
  );
  assert.deepEqual(
    database.pathsUnder(
      `${sessionPath(session.id)}/${adminLinkRestaurantResultSubcollection}/`,
    ).sort(),
    resultPathsBeforeRetry,
  );
  assert.equal(resultPathsBeforeRetry.length, 4);
  assert.deepEqual(resultPathsBeforeRetry, [
    resultPath(session.id, oldResult.id),
    resultPath(session.id, laterResult.id),
    resultPath(session.id, oldMarkerId),
    resultPath(session.id, laterMarkerId),
  ].sort());
  assert.equal(database.queryConstructionCount, queryCountBeforeRetry);
  assert.equal(database.attemptsFor(retryRunId).length, 1);
  assert.equal(database.attemptsFor(retryRunId)[0].writes.length, 0);
  assert.equal(database.attemptsFor(retryRunId)[0].outcome, "committed");
  assert.equal(duplicate.session.lastCompletedRequestId, laterRequestId);
  assert.equal(duplicate.session.scannedDocumentCount, 2);
  assert.equal(duplicate.session.ranges[0].afterDocumentId, "cursor-later");
  assert.equal(database.readAfterWriteViolations, 0);
});

test("filtered production advance retry is marker-idempotent without extra progress", async () => {
  const database = new VersionedFirestoreHarness();
  const initial = makeSession("session-filtered-idempotency", {
    needsQrPreparation: true,
  });
  const {store, session} = await acquire(database, initial);
  const clientRequestId = "filtered-completed-advance";
  const claimed = await claim(
    store,
    session,
    clientRequestId,
    "lease-filtered-idempotency",
  );
  const result = makeResult("a", claimed);
  const completed = await finish(
    store,
    claimed,
    clientRequestId,
    [result],
    {
      state: "preparing",
      ranges: advancedRanges(claimed, "filtered-cursor", false),
    },
  );
  assert.equal(completed.needsQrPreparation, true);
  assert.equal(completed.lastCompletedRequestId, clientRequestId);
  assert.equal(completed.scannedDocumentCount, 1);
  assert.equal(completed.ranges[0].afterDocumentId, "filtered-cursor");

  const sessionBeforeRetry = logicalValue(
    database.read(sessionPath(session.id)),
  );
  const parsedSessionBeforeRetry = logicalValue(
    await store.getSession(session.id),
  );
  const activeBeforeRetry = logicalValue(
    database.read(activePath(activeKeyFor(session))),
  );
  const resultPathsBeforeRetry = database.pathsUnder(
    `${sessionPath(session.id)}/${adminLinkRestaurantResultSubcollection}/`,
  ).sort();
  const queryCountBeforeRetry = database.queryConstructionCount;
  const retryRunId = database.nextRunId();

  const duplicate = await store.claimSession({
    sessionId: session.id,
    callerBinding: session.callerBinding,
    queryFingerprint: session.queryFingerprint,
    clientRequestId,
    leaseToken: "lease-filtered-idempotency-retry",
    nowMs: database.nowMs,
  });

  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(logicalValue(duplicate.session), parsedSessionBeforeRetry);
  assert.deepEqual(
    logicalValue(database.read(sessionPath(session.id))),
    sessionBeforeRetry,
  );
  assert.deepEqual(
    logicalValue(database.read(activePath(activeKeyFor(session)))),
    activeBeforeRetry,
  );
  assert.deepEqual(
    database.pathsUnder(
      `${sessionPath(session.id)}/${adminLinkRestaurantResultSubcollection}/`,
    ).sort(),
    resultPathsBeforeRetry,
  );
  assert.equal(resultPathsBeforeRetry.length, 2);
  assert.equal(database.queryConstructionCount, queryCountBeforeRetry);
  assert.equal(database.attemptsFor(retryRunId).length, 1);
  assert.equal(database.attemptsFor(retryRunId)[0].writes.length, 0);
  assert.equal(database.attemptsFor(retryRunId)[0].outcome, "committed");
  assert.equal(database.readAfterWriteViolations, 0);
});
