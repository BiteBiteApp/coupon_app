const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");

const {
  ReviewMilestoneReconciliationLockError,
  assertActiveReviewMilestoneReconciliationLockInPrivateTransaction,
  assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction,
  buildReviewMilestoneReconciliationLockDocument,
  buildReviewMilestoneReconciliationTerminalStateDocument,
  claimReviewMilestoneReconciliationLock,
  createReviewMilestoneLockEnforcedDishProposalPrivateDatabase,
  parseReviewMilestoneReconciliationLockDocument,
  parseReviewMilestoneReconciliationTerminalStateDocument,
  recordReviewMilestoneReconciliationTerminalState,
  releaseReviewMilestoneReconciliationLock,
  reviewMilestoneReconciliationLockCollection,
  reviewMilestoneReconciliationLockPath,
  reviewMilestoneReconciliationLockVersion,
  reviewMilestoneReconciliationTerminalStateCollection,
  reviewMilestoneReconciliationTerminalStatePath,
  reviewMilestoneReconciliationTerminalStateVersion,
  validateReviewMilestoneReconciliationLock,
} = require("../lib/review_milestone_reconciliation_lock.js");

const firstIdentity = Object.freeze({
  userId: "user-lock-contract-canary",
  operationId: "operation-lock-contract-canary",
  lockToken: "a".repeat(64),
});

function fixedClock(value) {
  return {now: () => new Date(value)};
}

const defaultTerminalFingerprints = Object.freeze({
  countStateFingerprint: "1".repeat(64),
  reconciliationStateFingerprint: "2".repeat(64),
});

function recordTerminal(database, identity = firstIdentity, overrides = {}) {
  return recordReviewMilestoneReconciliationTerminalState(
    database,
    identity,
    {...defaultTerminalFingerprints, ...overrides},
  );
}

function expectLockError(code) {
  return (error) => {
    assert.ok(error instanceof ReviewMilestoneReconciliationLockError);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /user-lock-contract-canary/u);
    assert.doesNotMatch(error.message, /operation-lock-contract-canary/u);
    assert.doesNotMatch(error.message, new RegExp("a".repeat(64), "u"));
    return true;
  };
}

test("lock path, parser, schema, timestamps, and fingerprint are strict", () => {
  assert.equal(
    reviewMilestoneReconciliationLockCollection,
    "private_review_milestone_reconciliation_locks",
  );
  assert.equal(
    reviewMilestoneReconciliationLockVersion,
    "bitestar.review-milestone-lock.v1",
  );
  assert.equal(
    reviewMilestoneReconciliationLockPath(firstIdentity.userId),
    `${reviewMilestoneReconciliationLockCollection}/${firstIdentity.userId}`,
  );
  assert.throws(
    () => reviewMilestoneReconciliationLockPath(` ${firstIdentity.userId}`),
    expectLockError("invalid-request"),
  );
  assert.throws(
    () => reviewMilestoneReconciliationLockPath("nested/user"),
    expectLockError("invalid-request"),
  );
  assert.throws(
    () => reviewMilestoneReconciliationLockPath("__reserved__"),
    expectLockError("invalid-request"),
  );
  assert.throws(
    () => buildReviewMilestoneReconciliationLockDocument({
      ...firstIdentity,
      operationId: "nested/operation",
      state: "active",
      createdAt: new Date("2026-08-11T12:00:00.000Z"),
      updatedAt: new Date("2026-08-11T12:00:00.000Z"),
    }),
    expectLockError("invalid-request"),
  );
  assert.throws(
    () => buildReviewMilestoneReconciliationLockDocument({
      ...firstIdentity,
      lockToken: "not-a-64-character-lowercase-hex-token",
      state: "active",
      createdAt: new Date("2026-08-11T12:00:00.000Z"),
      updatedAt: new Date("2026-08-11T12:00:00.000Z"),
    }),
    expectLockError("invalid-request"),
  );

  const lock = buildReviewMilestoneReconciliationLockDocument({
    ...firstIdentity,
    state: "active",
    createdAt: new Date("2026-08-11T12:00:00.000Z"),
    updatedAt: new Date("2026-08-11T12:00:00.000Z"),
  });
  assert.deepEqual(Object.keys(lock).sort(), [
    "createdAt",
    "fingerprint",
    "lockToken",
    "operationId",
    "state",
    "updatedAt",
    "userId",
    "version",
  ]);
  assert.match(lock.fingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    parseReviewMilestoneReconciliationLockDocument({
      id: firstIdentity.userId,
      data: lock,
    }),
    lock,
  );
  assert.equal(parseReviewMilestoneReconciliationLockDocument(null), null);

  assert.throws(
    () => parseReviewMilestoneReconciliationLockDocument({
      id: firstIdentity.userId,
      data: {...lock, unexpected: true},
    }),
    expectLockError("invalid-state"),
  );
  assert.throws(
    () => parseReviewMilestoneReconciliationLockDocument({
      id: firstIdentity.userId,
      data: {...lock, state: "released"},
    }),
    expectLockError("invalid-state"),
  );
  assert.throws(
    () => parseReviewMilestoneReconciliationLockDocument({
      id: "another-user",
      data: lock,
    }),
    expectLockError("invalid-state"),
  );
  assert.throws(
    () => buildReviewMilestoneReconciliationLockDocument({
      ...firstIdentity,
      state: "active",
      createdAt: new Date("2026-08-11T12:00:01.000Z"),
      updatedAt: new Date("2026-08-11T12:00:00.000Z"),
    }),
    expectLockError("invalid-request"),
  );
});

test("claim is transactional, same-owner idempotent, and conflicts strictly", async () => {
  const database = new FakeFirestore();
  assert.deepEqual(
    await claimReviewMilestoneReconciliationLock(
      database,
      firstIdentity,
      fixedClock("2026-08-11T12:00:00.000Z"),
    ),
    {status: "acquired"},
  );
  const firstStored = database.get(lockPath(firstIdentity.userId));
  assert.equal(firstStored.state, "active");
  assert.equal(firstStored.createdAt.toISOString(), "2026-08-11T12:00:00.000Z");

  assert.deepEqual(
    await claimReviewMilestoneReconciliationLock(
      database,
      firstIdentity,
      fixedClock("2026-08-11T12:05:00.000Z"),
    ),
    {status: "already-owned"},
  );
  assert.deepEqual(database.get(lockPath(firstIdentity.userId)), firstStored);

  await assert.rejects(
    () => claimReviewMilestoneReconciliationLock(
      database,
      {...firstIdentity, operationId: "other-operation"},
      fixedClock("2026-08-11T12:05:00.000Z"),
    ),
    expectLockError("conflict"),
  );
  await assert.rejects(
    () => claimReviewMilestoneReconciliationLock(
      database,
      {...firstIdentity, lockToken: "b".repeat(64)},
      fixedClock("2026-08-11T12:05:00.000Z"),
    ),
    expectLockError("conflict"),
  );
  assert.deepEqual(database.get(lockPath(firstIdentity.userId)), firstStored);
});

test("released owner retry is inert and a different operation can replace it", async () => {
  const database = new FakeFirestore();
  await claimReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:00:00.000Z"),
  );
  await recordTerminal(database);
  await releaseReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:10:00.000Z"),
  );
  const released = database.get(lockPath(firstIdentity.userId));

  assert.deepEqual(
    await claimReviewMilestoneReconciliationLock(
      database,
      firstIdentity,
      fixedClock("2026-08-11T12:20:00.000Z"),
    ),
    {status: "already-released"},
  );
  await assert.rejects(
    () => claimReviewMilestoneReconciliationLock(
      database,
      {...firstIdentity, lockToken: "b".repeat(64)},
      fixedClock("2026-08-11T12:20:00.000Z"),
    ),
    expectLockError("conflict"),
  );
  assert.deepEqual(database.get(lockPath(firstIdentity.userId)), released);

  const nextIdentity = {
    ...firstIdentity,
    operationId: "next-operation",
    lockToken: "c".repeat(64),
  };
  assert.deepEqual(
    await claimReviewMilestoneReconciliationLock(
      database,
      nextIdentity,
      fixedClock("2026-08-11T12:30:00.000Z"),
    ),
    {status: "acquired"},
  );
  const replacement = database.get(lockPath(firstIdentity.userId));
  assert.equal(replacement.state, "active");
  assert.equal(replacement.operationId, nextIdentity.operationId);
  assert.equal(replacement.lockToken, nextIdentity.lockToken);
  assert.equal(replacement.createdAt.toISOString(), "2026-08-11T12:30:00.000Z");
  assert.equal(database.get(terminalPath(firstIdentity.userId)), undefined);
});

test("malformed present locks fail closed for claim and validation", async () => {
  const database = new FakeFirestore();
  database.seed(lockPath(firstIdentity.userId), {
    version: reviewMilestoneReconciliationLockVersion,
    userId: firstIdentity.userId,
    operationId: firstIdentity.operationId,
    lockToken: firstIdentity.lockToken,
    state: "active",
    createdAt: new Date("2026-08-11T12:00:00.000Z"),
    updatedAt: new Date("2026-08-11T12:00:00.000Z"),
    fingerprint: "0".repeat(64),
  });
  const before = database.get(lockPath(firstIdentity.userId));
  await assert.rejects(
    () => claimReviewMilestoneReconciliationLock(
      database,
      firstIdentity,
      fixedClock("2026-08-11T12:10:00.000Z"),
    ),
    expectLockError("invalid-state"),
  );
  await assert.rejects(
    () => validateReviewMilestoneReconciliationLock(database, firstIdentity),
    expectLockError("invalid-state"),
  );
  assert.deepEqual(database.get(lockPath(firstIdentity.userId)), before);
});

test("validation requires the exact active user, operation, and token", async () => {
  const database = new FakeFirestore();
  await assert.rejects(
    () => validateReviewMilestoneReconciliationLock(database, firstIdentity),
    expectLockError("missing"),
  );
  await claimReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:00:00.000Z"),
  );
  await recordTerminal(database);
  assert.deepEqual(
    await validateReviewMilestoneReconciliationLock(database, firstIdentity),
    {status: "active"},
  );
  await assert.rejects(
    () => validateReviewMilestoneReconciliationLock(database, {
      ...firstIdentity,
      operationId: "wrong-operation",
    }),
    expectLockError("ownership-mismatch"),
  );
  await assert.rejects(
    () => validateReviewMilestoneReconciliationLock(database, {
      ...firstIdentity,
      lockToken: "b".repeat(64),
    }),
    expectLockError("ownership-mismatch"),
  );
  await releaseReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:10:00.000Z"),
  );
  await assert.rejects(
    () => validateReviewMilestoneReconciliationLock(database, firstIdentity),
    expectLockError("inactive"),
  );
});

test("terminal state recorder is strict, bound, and identically idempotent", async () => {
  const unlockedDatabase = new FakeFirestore();
  await assert.rejects(
    () => recordTerminal(unlockedDatabase),
    expectLockError("missing"),
  );
  assert.equal(
    unlockedDatabase.get(terminalPath(firstIdentity.userId)),
    undefined,
  );

  const database = new FakeFirestore();
  await claimReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:00:00.000Z"),
  );

  assert.deepEqual(await recordTerminal(database), {status: "recorded"});
  const stored = database.get(terminalPath(firstIdentity.userId));
  const parsed = parseReviewMilestoneReconciliationTerminalStateDocument({
    id: firstIdentity.userId,
    data: stored,
  });
  assert.equal(parsed.fingerprint, stored.fingerprint);
  assert.deepEqual(Object.keys(stored).sort(), [
    "countComplete",
    "countStateFingerprint",
    "fingerprint",
    "lockToken",
    "operationId",
    "reconciliationComplete",
    "reconciliationStateFingerprint",
    "userId",
    "version",
  ]);
  assert.equal(stored.version, reviewMilestoneReconciliationTerminalStateVersion);
  assert.equal(
    reviewMilestoneReconciliationTerminalStatePath(firstIdentity.userId),
    terminalPath(firstIdentity.userId),
  );
  assert.deepEqual(await recordTerminal(database), {
    status: "already-recorded",
  });
  await assert.rejects(
    () => recordTerminal(database, firstIdentity, {
      reconciliationStateFingerprint: "3".repeat(64),
    }),
    expectLockError("terminal-mismatch"),
  );
  assert.deepEqual(database.get(terminalPath(firstIdentity.userId)), stored);

  assert.throws(
    () => buildReviewMilestoneReconciliationTerminalStateDocument({
      ...firstIdentity,
      countComplete: true,
      reconciliationComplete: false,
      ...defaultTerminalFingerprints,
    }),
    expectLockError("completion-required"),
  );
});

test("release rejects absent, malformed, forged, or mismatched terminal source", async () => {
  const terminalCases = [
    {name: "absent", terminal: null, code: "completion-required"},
    {
      name: "partial",
      terminal: {
        version: reviewMilestoneReconciliationTerminalStateVersion,
        ...firstIdentity,
        countComplete: true,
      },
      code: "invalid-state",
    },
    {
      name: "forged",
      terminal: {
        ...buildReviewMilestoneReconciliationTerminalStateDocument({
          ...firstIdentity,
          countComplete: true,
          reconciliationComplete: true,
          ...defaultTerminalFingerprints,
        }),
        fingerprint: "0".repeat(64),
      },
      code: "invalid-state",
    },
    {
      name: "mismatched operation",
      terminal: buildReviewMilestoneReconciliationTerminalStateDocument({
        ...firstIdentity,
        operationId: "another-completed-operation",
        lockToken: "f".repeat(64),
        countComplete: true,
        reconciliationComplete: true,
        ...defaultTerminalFingerprints,
      }),
      code: "completion-required",
    },
  ];

  for (const testCase of terminalCases) {
    const database = new FakeFirestore();
    await claimReviewMilestoneReconciliationLock(
      database,
      firstIdentity,
      fixedClock("2026-08-11T12:00:00.000Z"),
    );
    if (testCase.terminal !== null) {
      database.seed(terminalPath(firstIdentity.userId), testCase.terminal);
    }
    const before = database.get(lockPath(firstIdentity.userId));
    await assert.rejects(
      () => releaseReviewMilestoneReconciliationLock(
        database,
        firstIdentity,
        fixedClock("2026-08-11T12:10:00.000Z"),
      ),
      expectLockError(testCase.code),
      testCase.name,
    );
    assert.deepEqual(database.get(lockPath(firstIdentity.userId)), before);
  }
});

test("release rereads terminal source and exact completed retry is idempotent", async () => {
  const database = new FakeFirestore();
  await claimReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:00:00.000Z"),
  );
  await recordTerminal(database);

  assert.deepEqual(
    await releaseReviewMilestoneReconciliationLock(
      database,
      firstIdentity,
      fixedClock("2026-08-11T12:10:00.000Z"),
    ),
    {status: "released"},
  );
  const released = database.get(lockPath(firstIdentity.userId));
  assert.equal(released.state, "released");
  assert.equal(released.createdAt.toISOString(), "2026-08-11T12:00:00.000Z");
  assert.equal(released.updatedAt.toISOString(), "2026-08-11T12:10:00.000Z");

  assert.deepEqual(
    await releaseReviewMilestoneReconciliationLock(
      database,
      firstIdentity,
      fixedClock("2026-08-11T12:20:00.000Z"),
    ),
    {status: "already-released"},
  );
  assert.deepEqual(database.get(lockPath(firstIdentity.userId)), released);

  await assert.rejects(
    () => releaseReviewMilestoneReconciliationLock(
      database,
      {...firstIdentity, lockToken: "b".repeat(64)},
      fixedClock("2026-08-11T12:20:00.000Z"),
    ),
    expectLockError("ownership-mismatch"),
  );
  assert.deepEqual(database.get(lockPath(firstIdentity.userId)), released);

  database.remove(terminalPath(firstIdentity.userId));
  await assert.rejects(
    () => releaseReviewMilestoneReconciliationLock(
      database,
      firstIdentity,
      fixedClock("2026-08-11T12:30:00.000Z"),
    ),
    expectLockError("completion-required"),
  );
  assert.deepEqual(database.get(lockPath(firstIdentity.userId)), released);
});

test("path-based guards support review writers and fail closed", async () => {
  const database = new FakeFirestore();
  const privateTransaction = database.privateTransaction();
  await assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction(
    privateTransaction,
    firstIdentity.userId,
  );

  await claimReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:00:00.000Z"),
  );
  await assert.rejects(
    () => assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction(
      privateTransaction,
      firstIdentity.userId,
    ),
    expectLockError("conflict"),
  );
  const active = await assertActiveReviewMilestoneReconciliationLockInPrivateTransaction(
    privateTransaction,
    firstIdentity,
  );
  assert.equal(active.state, "active");

  await recordTerminal(database);
  await releaseReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:10:00.000Z"),
  );
  await assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction(
    privateTransaction,
    firstIdentity.userId,
  );

  database.seed(lockPath(firstIdentity.userId), {
    ...database.get(lockPath(firstIdentity.userId)),
    unexpected: true,
  });
  await assert.rejects(
    () => assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction(
      privateTransaction,
      firstIdentity.userId,
    ),
    expectLockError("invalid-state"),
  );
});

test("dish-review database decorator deduplicates exact raw users in one transaction", async () => {
  const exactOtherUserId = "second-exact-user";
  const documents = [
    storedPrivateDocument("review-one", {userId: firstIdentity.userId}),
    storedPrivateDocument("review-two", {userId: firstIdentity.userId}),
    storedPrivateDocument("review-three", {userId: exactOtherUserId}),
    storedPrivateDocument("review-four", {userId: ` ${firstIdentity.userId}`}),
    storedPrivateDocument("review-five", {userId: "nested/user"}),
    storedPrivateDocument("review-six", {userId: 42}),
    storedPrivateDocument("review-seven", {}),
  ];
  const database = new FakeDishProposalPrivateDatabase({
    dish_reviews: documents,
    dishes: [storedPrivateDocument("dish-one", {name: "Soup"})],
  });
  database.seed(
    lockPath(exactOtherUserId),
    buildReviewMilestoneReconciliationLockDocument({
      userId: exactOtherUserId,
      operationId: "completed-other-operation",
      lockToken: "e".repeat(64),
      state: "released",
      createdAt: new Date("2026-08-11T11:00:00.000Z"),
      updatedAt: new Date("2026-08-11T11:10:00.000Z"),
    }),
  );
  const decorated = createReviewMilestoneLockEnforcedDishProposalPrivateDatabase(
    database,
  );
  const returned = await decorated.runTransaction(async (transaction) => {
    const unrelated = await transaction.queryDocuments({
      collectionPath: "dishes",
      limit: 10,
    });
    assert.equal(unrelated.length, 1);
    const reviews = await transaction.queryDocuments({
      collectionPath: "dish_reviews",
      limit: 50,
    });
    transaction.setDocument("private_test_results/result", {complete: true});
    return reviews;
  });

  assert.deepEqual(returned, documents);
  assert.equal(database.runCount, 1);
  assert.deepEqual(
    database.lockReadPaths,
    [lockPath(firstIdentity.userId), lockPath(exactOtherUserId)],
  );
  assert.deepEqual(database.get("private_test_results/result"), {
    complete: true,
  });
  assert.equal(
    database.events.every((event) => event.transactionId === 1),
    true,
  );
});

test("dish-review database decorator rejects active or malformed locks generically", async () => {
  for (const testCase of [
    {
      name: "active",
      lock: buildReviewMilestoneReconciliationLockDocument({
        ...firstIdentity,
        state: "active",
        createdAt: new Date("2026-08-11T12:00:00.000Z"),
        updatedAt: new Date("2026-08-11T12:00:00.000Z"),
      }),
      code: "conflict",
    },
    {
      name: "malformed",
      lock: {
        version: reviewMilestoneReconciliationLockVersion,
        ...firstIdentity,
        state: "active",
        createdAt: new Date("2026-08-11T12:00:00.000Z"),
        updatedAt: new Date("2026-08-11T12:00:00.000Z"),
        fingerprint: "0".repeat(64),
      },
      code: "invalid-state",
    },
  ]) {
    const database = new FakeDishProposalPrivateDatabase({
      dish_reviews: [storedPrivateDocument("review-canary", {
        userId: firstIdentity.userId,
      })],
    });
    database.seed(lockPath(firstIdentity.userId), testCase.lock);
    const decorated = createReviewMilestoneLockEnforcedDishProposalPrivateDatabase(
      database,
    );
    await assert.rejects(
      () => decorated.runTransaction(async (transaction) => {
        const reviews = await transaction.queryDocuments({
          collectionPath: "dish_reviews",
          limit: 50,
        });
        transaction.setDocument("private_test_results/must-not-commit", {
          reviewCount: reviews.length,
        });
      }),
      expectLockError(testCase.code),
      testCase.name,
    );
    assert.equal(database.get("private_test_results/must-not-commit"), undefined);
  }
});

test("locks are independent per exact user and contain no timeout or logging surface", async () => {
  const database = new FakeFirestore();
  const otherIdentity = {
    userId: "another-user",
    operationId: "another-operation",
    lockToken: "d".repeat(64),
  };
  await claimReviewMilestoneReconciliationLock(
    database,
    firstIdentity,
    fixedClock("2026-08-11T12:00:00.000Z"),
  );
  await claimReviewMilestoneReconciliationLock(
    database,
    otherIdentity,
    fixedClock("2026-08-11T12:00:00.000Z"),
  );
  assert.equal(database.get(lockPath(firstIdentity.userId)).state, "active");
  assert.equal(database.get(lockPath(otherIdentity.userId)).state, "active");

  const source = fs.readFileSync(
    path.join(__dirname, "../src/review_milestone_reconciliation_lock.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(?:console|logger)\s*\./u);
  assert.doesNotMatch(source, /\bsetTimeout\s*\(/u);
  assert.doesNotMatch(source, /\b(?:onCall|onRequest)\s*\(/u);
  assert.doesNotMatch(source, /(?:base64|encrypt|secret)/iu);
});

function lockPath(userId) {
  return `${reviewMilestoneReconciliationLockCollection}/${userId}`;
}

function terminalPath(userId) {
  return `${reviewMilestoneReconciliationTerminalStateCollection}/${userId}`;
}

function storedPrivateDocument(id, data) {
  return {
    id,
    data: cloneValue(data),
    createTime: new Date("2026-08-11T10:00:00.000Z"),
  };
}

class FakeDishProposalPrivateDatabase {
  constructor(queryDocumentsByCollection) {
    this.queryDocumentsByCollection = queryDocumentsByCollection;
    this.store = new Map();
    this.runCount = 0;
    this.events = [];
    this.lockReadPaths = [];
  }

  async runTransaction(operation) {
    this.runCount += 1;
    const transactionId = this.runCount;
    const workingStore = cloneStore(this.store);
    const transaction = {
      getDocument: async (documentPath) => {
        this.events.push({transactionId, kind: "get", path: documentPath});
        if (documentPath.startsWith(
          `${reviewMilestoneReconciliationLockCollection}/`,
        )) {
          this.lockReadPaths.push(documentPath);
        }
        const data = workingStore.get(documentPath);
        if (data === undefined) {
          return null;
        }
        return storedPrivateDocument(
          documentPath.slice(documentPath.lastIndexOf("/") + 1),
          data,
        );
      },
      queryDocuments: async (query) => {
        this.events.push({
          transactionId,
          kind: "query",
          collectionPath: query.collectionPath,
        });
        return cloneValue(
          this.queryDocumentsByCollection[query.collectionPath] ?? [],
        );
      },
      setDocument: (documentPath, data) => {
        this.events.push({transactionId, kind: "set", path: documentPath});
        workingStore.set(documentPath, cloneValue(data));
      },
      deleteDocument: (documentPath) => {
        this.events.push({transactionId, kind: "delete", path: documentPath});
        workingStore.delete(documentPath);
      },
    };
    const result = await operation(transaction);
    this.store = workingStore;
    return result;
  }

  seed(documentPath, data) {
    this.store.set(documentPath, cloneValue(data));
  }

  get(documentPath) {
    return cloneValue(this.store.get(documentPath));
  }
}

class FakeFirestore {
  constructor() {
    this.store = new Map();
  }

  collection(collectionPath) {
    return {
      doc: (id) => {
        const documentPath = `${collectionPath}/${id}`;
        return {
          id,
          path: documentPath,
          get: async () => new FakeSnapshot(id, this.store.get(documentPath)),
        };
      },
    };
  }

  async runTransaction(operation) {
    const workingStore = cloneStore(this.store);
    const transaction = {
      get: async (reference) => new FakeSnapshot(
        reference.id,
        workingStore.get(reference.path),
      ),
      set: (reference, data) => {
        workingStore.set(reference.path, cloneValue(data));
      },
      delete: (reference) => {
        workingStore.delete(reference.path);
      },
    };
    const result = await operation(transaction);
    this.store = workingStore;
    return result;
  }

  privateTransaction() {
    return {
      getDocument: async (documentPath) => {
        const data = this.store.get(documentPath);
        if (data === undefined) {
          return null;
        }
        return {
          id: documentPath.slice(documentPath.lastIndexOf("/") + 1),
          data: cloneValue(data),
        };
      },
    };
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
}

class FakeSnapshot {
  constructor(id, data) {
    this.id = id;
    this.exists = data !== undefined;
    this.value = cloneValue(data);
  }

  data() {
    return cloneValue(this.value);
  }
}

function cloneStore(store) {
  return new Map(
    Array.from(store.entries(), ([documentPath, data]) => [
      documentPath,
      cloneValue(data),
    ]),
  );
}

function cloneValue(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    );
  }
  return value;
}
