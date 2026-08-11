const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  awardReviewMilestoneContributionPointsCallableHandler,
  buildContributionLedgerDocumentIdFromSourceKey,
  contributionPointAction,
  contributionPointLedgerCollection,
  contributionPointStatus,
  createFirestoreReviewMilestoneWinnerAccumulator,
  loadValidPublicReviewCountForUser,
  maximumContributionPointStepLimit,
  maximumReviewMilestoneScanStepLimit,
  privateReviewMilestoneCountAccumulatorCollection,
  reconcileReviewMilestonesForUserStep,
  reverseContributionPointsForDishStep,
  scanValidReviewMilestoneIdentitiesForUserStep,
} = require("../lib/contribution_points_helpers.js");
const {
  buildReviewMilestoneReconciliationLockDocument,
  releaseReviewMilestoneReconciliationLock,
  reviewMilestoneReconciliationLockCollection,
  reviewMilestoneReconciliationTerminalStateCollection,
} = require("../lib/review_milestone_reconciliation_lock.js");

const fakeFieldValues = {
  serverTimestamp: () => ({__op: "serverTimestamp"}),
  increment: (delta) => ({__op: "increment", delta}),
};
const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);

test("whole-dish reversal keeps exact typed private cursor state and bounds work", async () => {
  const db = new FakeFirestore();
  for (let index = 0; index < 125; index += 1) {
    seedLedgerEntry(db, {
      id: `entry-${padded(index)}`,
      dishId: "dish-source",
      userId: "user-source",
      pointsDelta: 1,
    });
  }
  const otherId = seedLedgerEntry(db, {
    id: "other-dish-entry",
    dishId: "dish-other",
    userId: "user-other",
    pointsDelta: 3,
  });
  db.seed("user_profiles/user-source", {contributionPoints: 125});
  db.seed("user_profiles/user-other", {contributionPoints: 3});

  const first = await reverseContributionPointsForDishStep(
    db,
    {
      operationId: "delete-dish-operation",
      dishId: "dish-source",
      limit: maximumContributionPointStepLimit,
      now: "bounded-now",
    },
    {fieldValues: fakeFieldValues},
  );
  assert.equal(first.processedCount, 50);
  assert.equal(first.complete, false);
  assert.equal(first.nextCursor.phase, "dish-ledger");
  assert.equal(first.nextCursor.afterLedgerDocumentId, "entry-049");
  assert.match(first.nextCursor.fingerprint, /^[a-f0-9]{64}$/u);

  const retry = await reverseContributionPointsForDishStep(
    db,
    {
      operationId: "delete-dish-operation",
      dishId: "dish-source",
      limit: 50,
      now: "bounded-now",
    },
    {fieldValues: fakeFieldValues},
  );
  assert.deepEqual(retry.nextCursor, first.nextCursor);

  let cursor = first.nextCursor;
  let complete = false;
  while (!complete) {
    const result = await reverseContributionPointsForDishStep(
      db,
      {
        operationId: "delete-dish-operation",
        dishId: "dish-source",
        cursor,
        limit: 50,
        now: "bounded-now",
      },
      {fieldValues: fakeFieldValues},
    );
    cursor = result.nextCursor;
    complete = result.complete;
  }
  assert.equal(db.get("user_profiles/user-source").contributionPoints, 0);
  assert.equal(
    db.get(`${contributionPointLedgerCollection}/${otherId}`).status,
    contributionPointStatus.active,
  );
  await assert.rejects(
    () => reverseContributionPointsForDishStep(db, {
      operationId: "different-operation",
      dishId: "dish-source",
      cursor: first.nextCursor,
      limit: 50,
    }),
    (error) => error.code === "invalid-argument",
  );
  assert.ok(db.queryLog
    .filter((query) => query.path === contributionPointLedgerCollection)
    .every((query) => query.limit <= 50 && query.orderedByDocumentId));
});

test("whole-dish reversal never advances beyond a failed ledger entry", async () => {
  const db = new FakeFirestore();
  for (let index = 0; index < 60; index += 1) {
    seedLedgerEntry(db, {
      id: `entry-${padded(index)}`,
      dishId: "dish-source",
      userId: "user-source",
      pointsDelta: 1,
    });
  }
  db.seed("user_profiles/user-source", {contributionPoints: 60});
  db.failOnSetPath = `${contributionPointLedgerCollection}/entry-025`;
  await assert.rejects(
    () => reverseContributionPointsForDishStep(
      db,
      {
        operationId: "delete-dish-operation",
        dishId: "dish-source",
        limit: 50,
        now: "bounded-now",
      },
      {fieldValues: fakeFieldValues},
    ),
    (error) => {
      assert.equal(error.message, "Contribution point reversal step failed.");
      assert.equal(error.message.includes("entry-025"), false);
      return true;
    },
  );
  assert.equal(
    db.get(`${contributionPointLedgerCollection}/entry-025`).status,
    contributionPointStatus.active,
  );
  assert.equal(
    db.get(`${contributionPointLedgerCollection}/entry-026`).status,
    contributionPointStatus.active,
  );
  db.failOnSetPath = null;
  const resumed = await reverseContributionPointsForDishStep(
    db,
    {
      operationId: "delete-dish-operation",
      dishId: "dish-source",
      limit: 50,
      now: "bounded-now",
    },
    {fieldValues: fakeFieldValues},
  );
  assert.equal(resumed.nextCursor.afterLedgerDocumentId, "entry-049");
});

test("locked bounded review scan is exact, atomic per page, and retry-safe", async () => {
  const db = new FakeFirestore();
  const identity = lockIdentity("user-source", "review-recount", tokenA);
  seedActiveLock(db, identity);
  for (let index = 0; index < 120; index += 1) {
    seedReview(db, {
      id: `review-${padded(index)}`,
      userId: identity.userId,
      dishId: `dish-${padded(index)}`,
      headline: "headline-canary",
      notes: "notes-canary",
    });
  }
  seedReview(db, {
    id: "review-120-hidden",
    userId: identity.userId,
    dishId: "dish-hidden",
    isHidden: true,
  });
  seedReview(db, {
    id: "review-121-duplicate",
    userId: identity.userId,
    dishId: " dish-000 ",
  });
  seedReview(db, {
    id: "review-122-rejected",
    userId: identity.userId,
    dishId: "dish-rejected",
    status: " REJECTED ",
  });
  seedReview(db, {
    id: "other-user-review",
    userId: "user-other",
    dishId: "other-dish",
  });
  const accumulator = await initializeWorkflow(db, identity, "scan-exact");
  const manifestPath = accumulatorManifestPath("scan-exact");
  const winnerPath = `${manifestPath}/seen_valid_identities`;

  const first = await scanPage(db, identity, accumulator, null, 100);
  assert.equal(first.processedCount, 100);
  assert.equal(first.complete, false);
  assert.equal(first.nextCursor.phase, "review-scan");
  assert.equal(first.nextCursor.afterReviewDocumentId, "review-099");
  assert.match(first.nextCursor.fingerprint, /^[a-f0-9]{64}$/u);
  const winnerCountAfterFirst = db.documentsInCollection(winnerPath).length;
  const retry = await scanPage(db, identity, accumulator, null, 100);
  assert.deepEqual(retry, first);
  assert.equal(db.documentsInCollection(winnerPath).length, winnerCountAfterFirst);

  let result = first;
  while (!result.complete) {
    result = await scanPage(db, identity, accumulator, result.nextCursor, 100);
  }
  const fullCount = await loadValidPublicReviewCountForUser(db, identity.userId);
  assert.equal(fullCount, 120);
  assert.equal(result.validReviewCount, fullCount);
  assert.equal(db.get(manifestPath).state, "count-complete");
  assert.equal(db.get(manifestPath).validReviewCount, fullCount);
  const privateRows = JSON.stringify(db.documentsInCollection(winnerPath));
  assert.equal(privateRows.includes("headline-canary"), false);
  assert.equal(privateRows.includes("notes-canary"), false);
  assert.ok(db.transactionLog.every((entry) => entry.reads <= 102));
  assert.ok(db.transactionLog.every((entry) => entry.writes <= 101));
  assert.ok(db.queryLog
    .filter((query) => query.path === "dish_reviews" && query.limit !== null)
    .every((query) => query.limit <= 100 && query.orderedByDocumentId));
});

test("missing, replaced, and malformed locks cannot advance review state", async () => {
  for (const scenario of ["missing", "replaced", "malformed"]) {
    const db = new FakeFirestore();
    const identity = lockIdentity("user-source", `scan-${scenario}`, tokenA);
    seedActiveLock(db, identity);
    for (let index = 0; index < 110; index += 1) {
      seedReview(db, {
        id: `review-${padded(index)}`,
        userId: identity.userId,
        dishId: `dish-${padded(index)}`,
      });
    }
    const namespaceId = `lock-loss-${scenario}`;
    const accumulator = await initializeWorkflow(
      db,
      identity,
      namespaceId,
    );
    const first = await scanPage(db, identity, accumulator, null, 100);
    const manifestPath = accumulatorManifestPath(namespaceId);
    const before = db.get(manifestPath);
    const lockPath = lockDocumentPath(identity.userId);
    if (scenario === "missing") {
      db.remove(lockPath);
    } else if (scenario === "replaced") {
      seedActiveLock(db, lockIdentity(identity.userId, "replacement", tokenB));
    } else {
      db.seed(lockPath, {version: "malformed-present-lock"});
    }
    await assert.rejects(
      () => scanPage(db, identity, accumulator, first.nextCursor, 100),
    );
    assert.deepEqual(db.get(manifestPath), before, scenario);
  }
});

test("review cursor and accumulator reject wrong operation, token, phase, and failed page", async () => {
  const db = new FakeFirestore();
  const identity = lockIdentity("user-source", "strict-cursor", tokenA);
  seedActiveLock(db, identity);
  for (let index = 0; index < 110; index += 1) {
    seedReview(db, {
      id: `review-${padded(index)}`,
      userId: identity.userId,
      dishId: `dish-${padded(index)}`,
    });
  }
  const accumulator = await initializeWorkflow(db, identity, "strict-cursor");
  const first = await scanPage(db, identity, accumulator, null, 100);
  const manifestPath = accumulatorManifestPath("strict-cursor");
  const beforeFailure = db.get(manifestPath);
  await assert.rejects(
    () => scanValidReviewMilestoneIdentitiesForUserStep(
      db,
      {...identity, operationId: "wrong-operation", cursor: first.nextCursor, limit: 100},
      accumulator,
    ),
  );
  await assert.rejects(
    () => scanValidReviewMilestoneIdentitiesForUserStep(
      db,
      {...identity, lockToken: tokenB, cursor: first.nextCursor, limit: 100},
      accumulator,
    ),
  );
  await assert.rejects(
    () => scanPage(
      db,
      identity,
      accumulator,
      {...first.nextCursor, phase: "ledger"},
      100,
    ),
    (error) => error.code === "invalid-argument",
  );
  assert.deepEqual(db.get(manifestPath), beforeFailure);

  db.failOnSetPath = manifestPath;
  await assert.rejects(
    () => scanPage(db, identity, accumulator, first.nextCursor, 100),
    /Injected bounded-step write failure/u,
  );
  assert.deepEqual(db.get(manifestPath), beforeFailure);
  assert.equal(db.get(lockDocumentPath(identity.userId)).state, "active");
  db.failOnSetPath = null;
  const final = await scanPage(db, identity, accumulator, first.nextCursor, 100);
  assert.equal(final.complete, true);
  assert.equal(final.validReviewCount, 110);
});

test("bounded milestone awards retain the lock through terminal reconciliation", async () => {
  const db = new FakeFirestore();
  const identity = lockIdentity("user-source", "award-reconcile", tokenA);
  seedActiveLock(db, identity);
  db.seed("user_profiles/user-source", {contributionPoints: 0});
  seedDistinctReviews(db, identity.userId, 260);
  const accumulator = await initializeWorkflow(db, identity, "award-reconcile");
  const count = await completeReviewCount(db, identity, accumulator);
  assert.equal(count, 260);

  const first = await reconcilePage(
    db,
    identity,
    accumulator,
    260,
    null,
    50,
  );
  assert.equal(first.processedCount, 50);
  assert.equal(first.complete, false);
  assert.equal(first.nextCursor.phase, "awards");
  assert.equal(first.nextCursor.afterMilestone, 250);
  const retry = await reconcilePage(
    db,
    identity,
    accumulator,
    260,
    null,
    50,
  );
  assert.deepEqual(retry, first);
  assert.equal(db.get("user_profiles/user-source").contributionPoints, 50);

  let result = first;
  while (!result.complete) {
    result = await reconcilePage(
      db,
      identity,
      accumulator,
      260,
      result.nextCursor,
      50,
    );
  }
  assert.equal(db.get("user_profiles/user-source").contributionPoints, 52);
  assert.equal(db.get(lockDocumentPath(identity.userId)).state, "active");
  const terminal = db.get(terminalDocumentPath(identity.userId));
  assert.equal(terminal.countComplete, true);
  assert.equal(terminal.reconciliationComplete, true);

  const released = await releaseReviewMilestoneReconciliationLock(
    db,
    identity,
    {now: () => new Date("2026-08-11T00:01:00.000Z")},
  );
  assert.equal(released.status, "released");
  assert.equal(db.get(lockDocumentPath(identity.userId)).state, "released");
  const releasedRetry = await releaseReviewMilestoneReconciliationLock(
    db,
    identity,
    {now: () => new Date("2026-08-11T00:02:00.000Z")},
  );
  assert.equal(releasedRetry.status, "already-released");
});

test("bounded milestone ledger reversal is exact, idempotent, and user-scoped", async () => {
  const db = new FakeFirestore();
  const identity = lockIdentity("user-source", "reverse-reconcile", tokenA);
  seedActiveLock(db, identity);
  seedDistinctReviews(db, identity.userId, 23);
  const accumulator = await initializeWorkflow(db, identity, "reverse-reconcile");
  assert.equal(await completeReviewCount(db, identity, accumulator), 23);
  for (let index = 1; index <= 130; index += 1) {
    const sourceKey = `review_milestone:${identity.userId}:${index * 5}`;
    seedLedgerEntry(db, {
      id: buildContributionLedgerDocumentIdFromSourceKey(sourceKey),
      dishId: null,
      userId: identity.userId,
      pointsDelta: 1,
      actionType: contributionPointAction.reviewMilestone,
      sourceKey,
    });
  }
  const otherId = seedLedgerEntry(db, {
    id: "other-user-milestone",
    dishId: null,
    userId: "user-other",
    pointsDelta: 1,
    actionType: contributionPointAction.reviewMilestone,
    sourceKey: "review_milestone:user-other:5",
  });
  db.seed("user_profiles/user-source", {contributionPoints: 130});
  db.seed("user_profiles/user-other", {contributionPoints: 1});

  let cursor = null;
  let complete = false;
  let sawExactLedgerCursor = false;
  while (!complete) {
    const result = await reconcilePage(
      db,
      identity,
      accumulator,
      23,
      cursor,
      50,
    );
    if (result.nextCursor?.phase === "ledger" &&
        result.nextCursor.afterLedgerDocumentId !== null) {
      sawExactLedgerCursor = true;
      assert.equal(
        db.get(`${contributionPointLedgerCollection}/${result.nextCursor.afterLedgerDocumentId}`)
          .userId,
        identity.userId,
      );
    }
    cursor = result.nextCursor;
    complete = result.complete;
  }
  assert.equal(sawExactLedgerCursor, true);
  for (let index = 1; index <= 130; index += 1) {
    const sourceKey = `review_milestone:${identity.userId}:${index * 5}`;
    const entry = db.get(
      `${contributionPointLedgerCollection}/${buildContributionLedgerDocumentIdFromSourceKey(sourceKey)}`,
    );
    assert.equal(
      entry.status,
      index <= 4 ? contributionPointStatus.active : contributionPointStatus.reversed,
    );
  }
  assert.equal(db.get("user_profiles/user-source").contributionPoints, 4);
  assert.equal(
    db.get(`${contributionPointLedgerCollection}/${otherId}`).status,
    contributionPointStatus.active,
  );
  assert.equal(db.get("user_profiles/user-other").contributionPoints, 1);
  assert.ok(db.queryLog
    .filter((query) => query.path === contributionPointLedgerCollection)
    .every((query) => query.limit <= 50 && query.orderedByDocumentId));
});

test("failed reconciliation retains lock and durable cursor until a safe retry", async () => {
  const db = new FakeFirestore();
  const identity = lockIdentity("user-source", "failed-reconcile", tokenA);
  seedActiveLock(db, identity);
  const accumulator = await initializeWorkflow(db, identity, "failed-reconcile");
  assert.equal(await completeReviewCount(db, identity, accumulator), 0);
  for (let index = 0; index < 60; index += 1) {
    seedLedgerEntry(db, {
      id: `milestone-entry-${padded(index)}`,
      dishId: null,
      userId: identity.userId,
      pointsDelta: 1,
      actionType: contributionPointAction.reviewMilestone,
      sourceKey: `review_milestone:${identity.userId}:${(index + 1) * 5}`,
    });
  }
  db.seed("user_profiles/user-source", {contributionPoints: 60});
  const manifestPath = accumulatorManifestPath("failed-reconcile");
  const before = db.get(manifestPath);
  db.failOnSetPath = `${contributionPointLedgerCollection}/milestone-entry-025`;
  await assert.rejects(
    () => reconcilePage(db, identity, accumulator, 0, null, 50),
    (error) => error.message === "Review milestone reconciliation step failed.",
  );
  assert.deepEqual(db.get(manifestPath), before);
  assert.equal(db.get(lockDocumentPath(identity.userId)).state, "active");

  db.failOnSetPath = null;
  const resumed = await reconcilePage(db, identity, accumulator, 0, null, 50);
  assert.equal(resumed.complete, false);
  const afterFirstCommittedPage = db.get(manifestPath);
  db.remove(lockDocumentPath(identity.userId));
  await assert.rejects(
    () => reconcilePage(db, identity, accumulator, 0, resumed.nextCursor, 50),
  );
  assert.deepEqual(db.get(manifestPath), afterFirstCommittedPage);
  seedActiveLock(db, identity);
  const final = await reconcilePage(
    db,
    identity,
    accumulator,
    0,
    resumed.nextCursor,
    50,
  );
  assert.equal(final.complete, true);
  assert.equal(db.get("user_profiles/user-source").contributionPoints, 0);
});

test("private cursor canaries never cross current public Functions or logs", async () => {
  const helperSource = fs.readFileSync(
    path.join(__dirname, "../src/contribution_points_helpers.ts"),
    "utf8",
  );
  const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");
  assert.equal(helperSource.includes("base64url"), false);
  assert.equal(helperSource.includes("encodeBoundedCursor"), false);
  assert.equal(indexSource.includes("scanValidReviewMilestoneIdentitiesForUserStep"), false);
  assert.equal(indexSource.includes("reconcileReviewMilestonesForUserStep"), false);

  const db = new FakeFirestore();
  const canary = "private-review-document-id-canary";
  seedReview(db, {id: canary, userId: "public-user", dishId: "public-dish"});
  const calls = [];
  const originals = {};
  for (const method of ["log", "info", "warn", "error"]) {
    originals[method] = console[method];
    console[method] = (...args) => calls.push([method, ...args]);
  }
  let response;
  try {
    response = await awardReviewMilestoneContributionPointsCallableHandler(
      db,
      {auth: {uid: "public-user", token: {}}, data: {}},
      {fieldValues: fakeFieldValues},
    );
  } finally {
    for (const method of ["log", "info", "warn", "error"]) {
      console[method] = originals[method];
    }
  }
  assert.equal(JSON.stringify(response).includes(canary), false);
  assert.equal(JSON.stringify(response).includes("cursor"), false);
  assert.equal(JSON.stringify(calls).includes(canary), false);
  assert.equal(calls.length, 0);
});

test("bounded helpers reject oversized limits and forged private manifest state", async () => {
  const db = new FakeFirestore();
  await assert.rejects(
    () => reverseContributionPointsForDishStep(db, {
      operationId: "dish-operation",
      dishId: "dish-source",
      limit: 51,
    }),
    (error) => error.code === "invalid-argument",
  );
  const identity = lockIdentity("user-source", "limit-operation", tokenA);
  seedActiveLock(db, identity);
  const accumulator = await initializeWorkflow(db, identity, "limit-operation");
  await assert.rejects(
    () => scanPage(db, identity, accumulator, null, 101),
    (error) => error.code === "invalid-argument",
  );
  await scanPage(db, identity, accumulator, null, 100);
  const manifestPath = accumulatorManifestPath("limit-operation");
  db.seed(manifestPath, {...db.get(manifestPath), validReviewCount: 999});
  await assert.rejects(() => accumulator.readCompletedReviewCount());
});

function lockIdentity(userId, operationId, lockToken) {
  return {userId, operationId, lockToken};
}

function seedActiveLock(db, identity) {
  const createdAt = new Date("2026-08-11T00:00:00.000Z");
  db.seed(
    lockDocumentPath(identity.userId),
    buildReviewMilestoneReconciliationLockDocument({
      ...identity,
      state: "active",
      createdAt,
      updatedAt: createdAt,
    }),
  );
}

function lockDocumentPath(userId) {
  return `${reviewMilestoneReconciliationLockCollection}/${userId}`;
}

function terminalDocumentPath(userId) {
  return `${reviewMilestoneReconciliationTerminalStateCollection}/${userId}`;
}

function accumulatorManifestPath(namespaceId) {
  return `${privateReviewMilestoneCountAccumulatorCollection}/${namespaceId}`;
}

async function initializeWorkflow(db, identity, namespaceId) {
  const accumulator = createFirestoreReviewMilestoneWinnerAccumulator(db, {
    namespaceId,
    ...identity,
    scanId: `scan-${namespaceId}`,
  });
  let cursor = null;
  let complete = false;
  do {
    const result = await accumulator.initializeFreshScanStep({cursor, limit: 50});
    cursor = result.nextCursor;
    complete = result.complete;
  } while (!complete);
  return accumulator;
}

function scanPage(db, identity, accumulator, cursor, limit) {
  return scanValidReviewMilestoneIdentitiesForUserStep(
    db,
    {...identity, cursor, limit},
    accumulator,
  );
}

async function completeReviewCount(db, identity, accumulator) {
  let cursor = null;
  for (;;) {
    const result = await scanPage(
      db,
      identity,
      accumulator,
      cursor,
      maximumReviewMilestoneScanStepLimit,
    );
    if (result.complete) {
      return result.validReviewCount;
    }
    cursor = result.nextCursor;
  }
}

function reconcilePage(db, identity, accumulator, count, cursor, limit) {
  return reconcileReviewMilestonesForUserStep(
    db,
    {
      ...identity,
      currentReviewCount: count,
      cursor,
      limit,
      now: "bounded-now",
    },
    accumulator,
    {fieldValues: fakeFieldValues},
  );
}

function seedDistinctReviews(db, userId, count) {
  for (let index = 0; index < count; index += 1) {
    seedReview(db, {
      id: `review-${String(index).padStart(4, "0")}`,
      userId,
      dishId: `dish-${String(index).padStart(4, "0")}`,
    });
  }
}

function padded(value) {
  return String(value).padStart(3, "0");
}

function seedLedgerEntry(db, overrides) {
  const id = overrides.id;
  db.seed(`${contributionPointLedgerCollection}/${id}`, {
    id,
    userId: overrides.userId,
    pointsDelta: overrides.pointsDelta,
    actionType: overrides.actionType ?? contributionPointAction.dishCreated,
    sourceKey: overrides.sourceKey ?? `dish_created:${id}`,
    description: overrides.description ?? "Contribution award",
    status: overrides.status ?? contributionPointStatus.active,
    dishId: overrides.dishId,
  });
  return id;
}

function seedReview(db, data) {
  db.seed(`dish_reviews/${data.id}`, {
    userId: data.userId,
    dishId: data.dishId,
    isPublic: data.isPublic,
    isHidden: data.isHidden,
    hidden: data.hidden,
    deleted: data.deleted,
    isDeleted: data.isDeleted,
    rejected: data.rejected,
    status: data.status,
    headline: data.headline,
    notes: data.notes,
  });
}

class FakeFirestore {
  constructor() {
    this.store = new Map();
    this.clock = 0;
    this.failOnSetPath = null;
    this.queryLog = [];
    this.transactionLog = [];
  }

  collection(collectionPath) {
    return new FakeCollectionReference(this, collectionPath);
  }

  async runTransaction(updateFunction) {
    const workingStore = cloneStore(this.store);
    const transaction = new FakeTransaction(this, workingStore);
    const result = await updateFunction(transaction);
    this.store = workingStore;
    this.transactionLog.push({
      reads: transaction.readCount,
      writes: transaction.writeCount,
    });
    return result;
  }

  seed(documentPath, data) {
    this.store.set(documentPath, cloneValue(data));
  }

  remove(documentPath) {
    this.store.delete(documentPath);
  }

  get(documentPath) {
    return cloneValue(this.store.get(documentPath));
  }

  documentsInCollection(collectionPath) {
    const prefix = `${collectionPath}/`;
    return Array.from(this.store.entries())
      .filter(([documentPath]) =>
        documentPath.startsWith(prefix) &&
        !documentPath.slice(prefix.length).includes("/"))
      .map(([documentPath, data]) => ({
        id: documentPath.slice(prefix.length),
        data: cloneValue(data),
      }));
  }
}

class FakeTransaction {
  constructor(db, workingStore) {
    this.db = db;
    this.workingStore = workingStore;
    this.readCount = 0;
    this.writeCount = 0;
    this.hasWritten = false;
  }

  async get(ref) {
    if (this.hasWritten) {
      throw new Error("Fake transaction read occurred after a write.");
    }
    this.readCount += 1;
    return new FakeDocumentSnapshot(ref.id, this.workingStore.get(ref.path));
  }

  set(ref, data, options = undefined) {
    if (this.db.failOnSetPath === ref.path) {
      throw new Error("Injected bounded-step write failure");
    }
    this.hasWritten = true;
    this.writeCount += 1;
    const existing = options?.merge ? this.workingStore.get(ref.path) ?? {} : {};
    const next = options?.merge ? cloneValue(existing) : {};
    for (const [key, value] of Object.entries(data)) {
      next[key] = this.materializeValue(value, existing[key]);
    }
    this.workingStore.set(ref.path, next);
  }

  delete(ref) {
    this.hasWritten = true;
    this.writeCount += 1;
    this.workingStore.delete(ref.path);
  }

  materializeValue(value, existingValue) {
    if (value && value.__op === "increment") {
      return (typeof existingValue === "number" ? existingValue : 0) + value.delta;
    }
    if (value && value.__op === "serverTimestamp") {
      this.db.clock += 1;
      return `timestamp-${this.db.clock}`;
    }
    return cloneValue(value);
  }
}

class FakeDocumentReference {
  constructor(db, documentPath, id) {
    this.db = db;
    this.path = documentPath;
    this.id = id;
  }

  async get() {
    return new FakeDocumentSnapshot(this.id, this.db.store.get(this.path));
  }
}

class FakeCollectionReference {
  constructor(db, collectionPath) {
    this.db = db;
    this.path = collectionPath;
  }

  doc(id) {
    return new FakeDocumentReference(this.db, `${this.path}/${id}`, id);
  }

  where(fieldPath, opStr, value) {
    return new FakeQuery(this.db, this.path, [{fieldPath, opStr, value}]);
  }

  orderBy() {
    return new FakeQuery(this.db, this.path, [], true);
  }
}

class FakeQuery {
  constructor(
    db,
    queryPath,
    filters,
    orderedByDocumentId = false,
    afterDocumentId = null,
    queryLimit = null,
  ) {
    this.db = db;
    this.path = queryPath;
    this.filters = filters;
    this.orderedByDocumentId = orderedByDocumentId;
    this.afterDocumentId = afterDocumentId;
    this.queryLimit = queryLimit;
  }

  where(fieldPath, opStr, value) {
    return new FakeQuery(
      this.db,
      this.path,
      [...this.filters, {fieldPath, opStr, value}],
      this.orderedByDocumentId,
      this.afterDocumentId,
      this.queryLimit,
    );
  }

  orderBy() {
    return new FakeQuery(
      this.db,
      this.path,
      this.filters,
      true,
      this.afterDocumentId,
      this.queryLimit,
    );
  }

  startAfter(afterDocumentId) {
    return new FakeQuery(
      this.db,
      this.path,
      this.filters,
      this.orderedByDocumentId,
      afterDocumentId,
      this.queryLimit,
    );
  }

  limit(queryLimit) {
    return new FakeQuery(
      this.db,
      this.path,
      this.filters,
      this.orderedByDocumentId,
      this.afterDocumentId,
      queryLimit,
    );
  }

  count() {
    return new FakeAggregateQuery(this);
  }

  async get() {
    if (
      (this.orderedByDocumentId && this.queryLimit === null) ||
      (!this.orderedByDocumentId && this.queryLimit !== null) ||
      (!this.orderedByDocumentId && this.afterDocumentId !== null)
    ) {
      throw new Error("Fake query has an unsupported bound/order shape.");
    }
    this.db.queryLog.push({
      path: this.path,
      filters: cloneValue(this.filters),
      orderedByDocumentId: this.orderedByDocumentId,
      afterDocumentId: this.afterDocumentId,
      limit: this.queryLimit,
    });
    const prefix = `${this.path}/`;
    const rows = Array.from(this.db.store.entries())
      .filter(([documentPath, data]) => {
        if (!documentPath.startsWith(prefix)) return false;
        const id = documentPath.slice(prefix.length);
        if (id.includes("/") || compareIds(id, this.afterDocumentId ?? "") <= 0) {
          return false;
        }
        return this.filters.every((filter) => {
          if (filter.opStr !== "==") {
            throw new Error(`Unsupported fake query operator ${filter.opStr}`);
          }
          return data?.[filter.fieldPath] === filter.value;
        });
      })
      .sort(([left], [right]) => compareIds(left, right))
      .slice(0, this.queryLimit ?? undefined);
    return {
      docs: rows.map(([documentPath, data]) => new FakeDocumentSnapshot(
        documentPath.slice(prefix.length),
        data,
      )),
    };
  }
}

class FakeAggregateQuery {
  constructor(query) {
    this.query = query;
  }

  async get() {
    const prefix = `${this.query.path}/`;
    const count = Array.from(this.query.db.store.entries())
      .filter(([documentPath, data]) => {
        if (!documentPath.startsWith(prefix) ||
            documentPath.slice(prefix.length).includes("/")) return false;
        return this.query.filters.every((filter) =>
          filter.opStr === "==" && data?.[filter.fieldPath] === filter.value);
      }).length;
    this.query.db.queryLog.push({
      path: this.query.path,
      filters: cloneValue(this.query.filters),
      aggregate: "count",
      orderedByDocumentId: false,
      afterDocumentId: null,
      limit: null,
    });
    return {data: () => ({count})};
  }
}

class FakeDocumentSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
  }

  get exists() {
    return this._data !== undefined;
  }

  data() {
    return cloneValue(this._data);
  }
}

function compareIds(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function cloneStore(store) {
  return new Map(
    Array.from(store.entries(), ([key, value]) => [key, cloneValue(value)]),
  );
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}
