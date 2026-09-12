"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CustomerBiteSaverContractError,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  privateCustomerBiteSaverActiveSessionCollection,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  bindCustomerBiteSaverRequestReplayDeadline,
  customerBiteSaverRequestReplayDocumentId,
  customerBiteSaverRequestReplayPath,
  customerBiteSaverLogicalRedemptionReplayRole,
  customerBiteSaverRequestReplayRole,
  customerBiteSaverRequestReplayState,
  reserveCustomerBiteSaverLogicalRedemptionReplay,
  reserveCustomerBiteSaverRequestReplay,
  reserveCustomerBiteSaverRequestReplayInTransaction,
} = require("../lib/customer_bitesaver_request_replay.js");

const nowMs = Date.parse("2026-09-09T12:00:00.000Z");
const absoluteExpiresAtMs = nowMs + 60 * 60_000;
const secretKey = Buffer.alloc(32, 7);
const sessionId = `bss_${Buffer.alloc(32, 1).toString("base64url")}`;
const callerCapabilityBinding = "c".repeat(64);
const clientRequestId = "page-request-00001";
const requestFingerprint = "d".repeat(64);
const redemptionRequestId = "redemption-request-00001";

class InMemoryReplayDatabase {
  constructor() {
    this.documents = new Map();
    this.transactionRuns = 0;
    this.createdPaths = [];
  }

  stored(path) {
    const data = this.documents.get(path);
    return data === undefined
      ? null
      : {
          id: path.slice(path.lastIndexOf("/") + 1),
          path,
          data,
        };
  }

  async getDocument(path) {
    return this.stored(path);
  }

  async getDocuments(paths) {
    return paths.map((path) => this.stored(path));
  }

  async queryDocuments() {
    throw new Error("request replay must not query collections");
  }

  async runTransaction(operation) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      this.transactionRuns += 1;
      const creates = [];
      const writes = [];
      const transaction = {
        getDocument: async (path) => this.stored(path),
        getDocuments: async (paths) => paths.map((path) => this.stored(path)),
        createDocument: (path, data) => {
          creates.push(path);
          writes.push({type: "create", path, data});
        },
        setDocument: (path, data) => writes.push({type: "set", path, data}),
        deleteDocument: (path) => writes.push({type: "delete", path}),
      };
      const response = await operation(transaction);
      if (creates.some((path) => this.documents.has(path))) {
        continue;
      }
      for (const write of writes) {
        if (write.type === "delete") {
          this.documents.delete(write.path);
        } else {
          this.documents.set(write.path, write.data);
        }
      }
      this.createdPaths.push(...creates);
      return response;
    }
    throw new Error("transaction retry limit exceeded");
  }

  async commitWrites() {
    throw new Error("request replay must reserve transactionally");
  }
}

function replayInput(database, overrides = {}) {
  return {
    database,
    secretKey,
    sessionId,
    attemptGeneration: 3,
    callerCapabilityBinding,
    purpose: "restaurantPage",
    clientRequestId,
    requestFingerprint,
    nowMs,
    absoluteSessionExpiresAt: new Date(absoluteExpiresAtMs),
    ...overrides,
  };
}

function logicalRedemptionInput(database, overrides = {}) {
  return {
    database,
    secretKey,
    sessionId,
    attemptGeneration: 3,
    callerCapabilityBinding,
    redemptionRequestId,
    requestFingerprint,
    nowMs,
    logicalSessionExpiresAt: new Date(absoluteExpiresAtMs),
    absoluteSessionExpiresAt: new Date(absoluteExpiresAtMs),
    ...overrides,
  };
}

function documentsWithRole(database, role) {
  return [...database.documents.entries()].filter(([, data]) =>
    data.role === role);
}

function assertContractError(error, code) {
  return error instanceof CustomerBiteSaverContractError && error.code === code;
}

test("request replay reservation freezes evaluation time and TTL exactly", async () => {
  const database = new InMemoryReplayDatabase();
  const input = replayInput(database);
  const first = await reserveCustomerBiteSaverRequestReplay(input);
  const retry = await reserveCustomerBiteSaverRequestReplay({
    ...input,
    nowMs: nowMs + 5 * 60_000,
  });

  assert.deepEqual(first, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: absoluteExpiresAtMs,
    replayed: false,
  });
  assert.deepEqual(retry, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: absoluteExpiresAtMs,
    replayed: true,
  });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(database.createdPaths.length, 1);

  const expectedPath = customerBiteSaverRequestReplayPath(secretKey, input);
  assert.equal(database.createdPaths[0], expectedPath);
  assert.match(
    expectedPath,
    new RegExp(`^${privateCustomerBiteSaverActiveSessionCollection}/` +
      "bsrqr_[A-Za-z0-9_-]{43}$", "u"),
  );
  const document = database.documents.get(expectedPath);
  assert.deepEqual(Object.keys(document).sort(), [
    "absoluteExpiresAt",
    "attemptGeneration",
    "callerCapabilityBinding",
    "clientRequestBinding",
    "createdAt",
    "evaluationAt",
    "expiresAt",
    "logicalExpiresAt",
    "protocolVersion",
    "purpose",
    "requestFingerprint",
    "role",
    "schemaVersion",
    "sessionId",
    "state",
  ]);
  assert.equal(document.protocolVersion, customerBiteSaverSearchProtocolVersion);
  assert.equal(document.schemaVersion, customerBiteSaverSearchSchemaVersion);
  assert.equal(document.role, customerBiteSaverRequestReplayRole);
  assert.equal(document.state, customerBiteSaverRequestReplayState);
  assert.equal(document.evaluationAt.getTime(), nowMs);
  assert.equal(document.createdAt.getTime(), nowMs);
  assert.equal(document.logicalExpiresAt.getTime(), absoluteExpiresAtMs);
  assert.equal(document.absoluteExpiresAt.getTime(), absoluteExpiresAtMs);
  assert.equal(document.expiresAt.getTime(), absoluteExpiresAtMs);
  assert.match(document.clientRequestBinding, /^bsrqb_[A-Za-z0-9_-]{43}$/u);
  assert.equal(JSON.stringify(document).includes(clientRequestId), false);
  assert.equal(expectedPath.includes(clientRequestId), false);
});

test("request replay document IDs bind every replay identity dimension", () => {
  const database = new InMemoryReplayDatabase();
  const base = replayInput(database);
  const variants = [
    {...base, sessionId: `bss_${Buffer.alloc(32, 2).toString("base64url")}`},
    {...base, attemptGeneration: base.attemptGeneration + 1},
    {...base, callerCapabilityBinding: "e".repeat(64)},
    {...base, purpose: "offerPage"},
    {...base, purpose: "redemptionValidation"},
    {...base, purpose: "redemptionStart"},
    {...base, purpose: "guestOfferCheckAnswer"},
    {...base, clientRequestId: "page-request-00002"},
  ];
  const baseId = customerBiteSaverRequestReplayDocumentId(secretKey, base);
  const ids = variants.map((entry) =>
    customerBiteSaverRequestReplayDocumentId(secretKey, entry));

  assert.match(baseId, /^bsrqr_[A-Za-z0-9_-]{43}$/u);
  assert.equal(new Set([baseId, ...ids]).size, ids.length + 1);
  assert.notEqual(
    baseId,
    customerBiteSaverRequestReplayDocumentId(Buffer.alloc(32, 8), base),
  );
});

test("page replay authorization deadline tightens monotonically without shortening retention", async () => {
  const database = new InMemoryReplayDatabase();
  const input = replayInput(database);
  await reserveCustomerBiteSaverRequestReplay(input);
  const firstDeadlineMs = nowMs + 3 * 60_000;
  const laterDeadlineMs = nowMs + 5 * 60_000;
  const first = await bindCustomerBiteSaverRequestReplayDeadline({
    ...input,
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: firstDeadlineMs,
    nowMs: nowMs + 1,
  });
  const later = await bindCustomerBiteSaverRequestReplayDeadline({
    ...input,
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: laterDeadlineMs,
    nowMs: firstDeadlineMs - 1,
  });
  const expired = await bindCustomerBiteSaverRequestReplayDeadline({
    ...input,
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: laterDeadlineMs,
    nowMs: firstDeadlineMs,
  });

  assert.deepEqual(first, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: firstDeadlineMs,
    live: true,
  });
  assert.deepEqual(later, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: firstDeadlineMs,
    live: true,
  });
  assert.deepEqual(expired, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: firstDeadlineMs,
    live: false,
  });
  const path = customerBiteSaverRequestReplayPath(secretKey, input);
  const document = database.documents.get(path);
  assert.equal(document.evaluationAt.getTime(), nowMs);
  assert.equal(document.logicalExpiresAt.getTime(), firstDeadlineMs);
  assert.equal(document.absoluteExpiresAt.getTime(), absoluteExpiresAtMs);
  assert.equal(document.expiresAt.getTime(), absoluteExpiresAtMs);
  assert.equal(database.createdPaths.length, 1);
  assert.deepEqual(
    await reserveCustomerBiteSaverRequestReplay({
      ...input,
      nowMs: firstDeadlineMs,
    }),
    {
      evaluationAtMs: nowMs,
      logicalExpiresAtMs: firstDeadlineMs,
      replayed: true,
    },
  );
});

test("page deadline binding cannot alter unrelated replay purposes", async () => {
  const database = new InMemoryReplayDatabase();
  const input = replayInput(database, {
    purpose: "redemptionStart",
    clientRequestId: "deadline-purpose-redemption-0001",
  });
  await reserveCustomerBiteSaverRequestReplay(input);
  const transactionRuns = database.transactionRuns;
  await assert.rejects(
    bindCustomerBiteSaverRequestReplayDeadline({
      ...input,
      evaluationAtMs: nowMs,
      logicalExpiresAtMs: nowMs + 3 * 60_000,
      nowMs: nowMs + 1,
    }),
    (error) => assertContractError(error, "invalid-argument"),
  );
  assert.equal(database.transactionRuns, transactionRuns);
  const document = database.documents.get(
    customerBiteSaverRequestReplayPath(secretKey, input),
  );
  assert.equal(document.logicalExpiresAt.getTime(), absoluteExpiresAtMs);
  assert.equal(document.expiresAt.getTime(), absoluteExpiresAtMs);
});

test("logical redemption identity is independent of transport request IDs", async () => {
  const database = new InMemoryReplayDatabase();
  const firstTransport = replayInput(database, {
    purpose: "redemptionStart",
    clientRequestId: "redemption-transport-0001",
  });
  const secondTransport = replayInput(database, {
    purpose: "redemptionStart",
    clientRequestId: "redemption-transport-0002",
    nowMs: nowMs + 30_000,
  });

  await reserveCustomerBiteSaverRequestReplay(firstTransport);
  const first = await reserveCustomerBiteSaverLogicalRedemptionReplay(
    logicalRedemptionInput(database),
  );
  await reserveCustomerBiteSaverRequestReplay(secondTransport);
  const retry = await reserveCustomerBiteSaverLogicalRedemptionReplay(
    logicalRedemptionInput(database, {nowMs: nowMs + 30_000}),
  );

  assert.deepEqual(first, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: nowMs + 60_000,
    replayed: false,
  });
  assert.deepEqual(retry, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: nowMs + 60_000,
    replayed: true,
  });
  const transportDocuments = documentsWithRole(
    database,
    customerBiteSaverRequestReplayRole,
  );
  const logicalDocuments = documentsWithRole(
    database,
    customerBiteSaverLogicalRedemptionReplayRole,
  );
  assert.equal(transportDocuments.length, 2);
  assert.equal(logicalDocuments.length, 1);
  assert.notEqual(transportDocuments[0][0], transportDocuments[1][0]);
  assert.match(
    logicalDocuments[0][0],
    new RegExp(`^${privateCustomerBiteSaverActiveSessionCollection}/` +
      "bslrr_[A-Za-z0-9_-]{43}$", "u"),
  );
  const logicalDocument = logicalDocuments[0][1];
  assert.deepEqual(Object.keys(logicalDocument).sort(), [
    "absoluteExpiresAt",
    "attemptGeneration",
    "callerCapabilityBinding",
    "createdAt",
    "evaluationAt",
    "expiresAt",
    "logicalExpiresAt",
    "logicalRequestBinding",
    "protocolVersion",
    "requestFingerprint",
    "role",
    "schemaVersion",
    "sessionId",
    "state",
  ]);
  assert.equal(logicalDocument.evaluationAt.getTime(), nowMs);
  assert.equal(logicalDocument.createdAt.getTime(), nowMs);
  assert.equal(logicalDocument.logicalExpiresAt.getTime(), nowMs + 60_000);
  assert.equal(logicalDocument.absoluteExpiresAt.getTime(), absoluteExpiresAtMs);
  assert.equal(logicalDocument.expiresAt.getTime(), absoluteExpiresAtMs);
  assert.match(
    logicalDocument.logicalRequestBinding,
    /^bslrb_[A-Za-z0-9_-]{43}$/u,
  );
  assert.equal(
    JSON.stringify(logicalDocument).includes(firstTransport.clientRequestId),
    false,
  );
  assert.equal(
    JSON.stringify(logicalDocument).includes(secondTransport.clientRequestId),
    false,
  );
});

test("logical redemption deadline stays fixed at and after expiry", async () => {
  const database = new InMemoryReplayDatabase();
  const input = logicalRedemptionInput(database);
  const first = await reserveCustomerBiteSaverLogicalRedemptionReplay(input);
  const [beforeExpiry, atExpiry, afterExpiry] = await Promise.all([
    reserveCustomerBiteSaverLogicalRedemptionReplay({
      ...input,
      nowMs: nowMs + 59_999,
    }),
    reserveCustomerBiteSaverLogicalRedemptionReplay({
      ...input,
      nowMs: nowMs + 60_000,
    }),
    reserveCustomerBiteSaverLogicalRedemptionReplay({
      ...input,
      nowMs: nowMs + 60_001,
    }),
  ]);

  assert.deepEqual(first, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: nowMs + 60_000,
    replayed: false,
  });
  for (const replay of [beforeExpiry, atExpiry, afterExpiry]) {
    assert.deepEqual(replay, {
      evaluationAtMs: nowMs,
      logicalExpiresAtMs: nowMs + 60_000,
      replayed: true,
    });
  }
  assert.equal(beforeExpiry.logicalExpiresAtMs > nowMs + 59_999, true);
  assert.equal(atExpiry.logicalExpiresAtMs <= nowMs + 60_000, true);
  assert.equal(afterExpiry.logicalExpiresAtMs <= nowMs + 60_001, true);

  const logicalDocuments = documentsWithRole(
    database,
    customerBiteSaverLogicalRedemptionReplayRole,
  );
  assert.equal(logicalDocuments.length, 1);
  assert.equal(database.createdPaths.length, 1);
  assert.equal(logicalDocuments[0][1].logicalExpiresAt.getTime(), nowMs + 60_000);
  assert.equal(logicalDocuments[0][1].expiresAt.getTime(), absoluteExpiresAtMs);
});

test("logical redemption reservation rejects semantic rebinding", async () => {
  const database = new InMemoryReplayDatabase();
  const input = logicalRedemptionInput(database);
  await reserveCustomerBiteSaverLogicalRedemptionReplay(input);
  const originalEntry = documentsWithRole(
    database,
    customerBiteSaverLogicalRedemptionReplayRole,
  )[0];
  const originalDocument = structuredClone(originalEntry[1]);

  await assert.rejects(
    reserveCustomerBiteSaverLogicalRedemptionReplay({
      ...input,
      nowMs: nowMs + 1,
      requestFingerprint: "e".repeat(64),
    }),
    (error) => assertContractError(error, "invalid-argument"),
  );
  assert.deepEqual(database.documents.get(originalEntry[0]), originalDocument);
  assert.equal(
    documentsWithRole(database, customerBiteSaverLogicalRedemptionReplayRole)
      .length,
    1,
  );

  const distinct = await reserveCustomerBiteSaverLogicalRedemptionReplay({
    ...input,
    redemptionRequestId: "redemption-request-00002",
    nowMs: nowMs + 1,
  });
  assert.deepEqual(distinct, {
    evaluationAtMs: nowMs + 1,
    logicalExpiresAtMs: nowMs + 60_001,
    replayed: false,
  });
  assert.equal(
    documentsWithRole(database, customerBiteSaverLogicalRedemptionReplayRole)
      .length,
    2,
  );
});

test("concurrent logical redemption reservations converge on one tombstone", async () => {
  const database = new InMemoryReplayDatabase();
  const input = logicalRedemptionInput(database);
  const results = await Promise.all([
    reserveCustomerBiteSaverLogicalRedemptionReplay(input),
    reserveCustomerBiteSaverLogicalRedemptionReplay({...input}),
  ]);

  assert.equal(results.filter((result) => result.replayed === false).length, 1);
  assert.equal(results.filter((result) => result.replayed === true).length, 1);
  for (const result of results) {
    assert.equal(result.evaluationAtMs, nowMs);
    assert.equal(result.logicalExpiresAtMs, nowMs + 60_000);
  }
  assert.equal(
    documentsWithRole(database, customerBiteSaverLogicalRedemptionReplayRole)
      .length,
    1,
  );
  assert.equal(database.createdPaths.length, 1);
  assert.ok(database.transactionRuns >= 3);
});

test("guest answer replay is purpose-separated, retry-safe, and conflict-bound", async () => {
  const database = new InMemoryReplayDatabase();
  const base = replayInput(database);
  const answer = replayInput(database, {
    purpose: "guestOfferCheckAnswer",
    clientRequestId: "guest-answer-request-0001",
    requestFingerprint: "a".repeat(64),
  });
  const pageId = customerBiteSaverRequestReplayDocumentId(secretKey, {
    ...answer,
    purpose: base.purpose,
  });
  const answerId = customerBiteSaverRequestReplayDocumentId(secretKey, answer);

  assert.notEqual(answerId, pageId);
  assert.deepEqual(
    await reserveCustomerBiteSaverRequestReplay(answer),
    {
      evaluationAtMs: nowMs,
      logicalExpiresAtMs: absoluteExpiresAtMs,
      replayed: false,
    },
  );
  assert.deepEqual(
    await reserveCustomerBiteSaverRequestReplay({...answer, nowMs: nowMs + 1}),
    {
      evaluationAtMs: nowMs,
      logicalExpiresAtMs: absoluteExpiresAtMs,
      replayed: true,
    },
  );
  await assert.rejects(
    reserveCustomerBiteSaverRequestReplay({
      ...answer,
      nowMs: nowMs + 2,
      requestFingerprint: "b".repeat(64),
    }),
    (error) => assertContractError(error, "invalid-argument") &&
      error.message ===
        "The client request ID was already used for a different request.",
  );
  assert.equal(database.createdPaths.length, 1);
});

test("in-transaction replay reservation composes atomically with caller state", async () => {
  const database = new InMemoryReplayDatabase();
  const input = replayInput(database, {
    purpose: "guestOfferCheckAnswer",
    clientRequestId: "guest-answer-request-atomic-0001",
  });
  const progressPath = "private_bitesaver_guest_offer_checks/check-progress";
  const reservation = await database.runTransaction(async (transaction) => {
    const replay = await reserveCustomerBiteSaverRequestReplayInTransaction(
      input,
      transaction,
    );
    transaction.setDocument(progressPath, {state: "advanced"});
    return replay;
  });

  assert.deepEqual(reservation, {
    evaluationAtMs: nowMs,
    logicalExpiresAtMs: absoluteExpiresAtMs,
    replayed: false,
  });
  assert.equal(database.transactionRuns, 1);
  assert.equal(
    database.documents.has(customerBiteSaverRequestReplayPath(secretKey, input)),
    true,
  );
  assert.deepEqual(database.documents.get(progressPath), {state: "advanced"});

  const rolledBack = new InMemoryReplayDatabase();
  const rollbackInput = replayInput(rolledBack, {
    purpose: "guestOfferCheckAnswer",
    clientRequestId: "guest-answer-request-atomic-0002",
  });
  await assert.rejects(
    rolledBack.runTransaction(async (transaction) => {
      await reserveCustomerBiteSaverRequestReplayInTransaction(
        rollbackInput,
        transaction,
      );
      transaction.setDocument(progressPath, {state: "must-not-commit"});
      throw new Error("transaction aborted");
    }),
    /transaction aborted/u,
  );
  assert.equal(rolledBack.documents.size, 0);
});

test("one client request ID cannot be rebound to another request", async () => {
  const database = new InMemoryReplayDatabase();
  const input = replayInput(database);
  await reserveCustomerBiteSaverRequestReplay(input);

  await assert.rejects(
    reserveCustomerBiteSaverRequestReplay({
      ...input,
      nowMs: nowMs + 1,
      requestFingerprint: "e".repeat(64),
    }),
    (error) => assertContractError(error, "invalid-argument") &&
      error.message ===
        "The client request ID was already used for a different request.",
  );
  assert.equal(database.createdPaths.length, 1);
});

test("replay parsing accepts Firestore timestamps and rejects non-closed state", async () => {
  const database = new InMemoryReplayDatabase();
  const input = replayInput(database);
  await reserveCustomerBiteSaverRequestReplay(input);
  const path = customerBiteSaverRequestReplayPath(secretKey, input);
  const original = database.documents.get(path);
  const timestampDocument = {...original};
  for (const field of [
    "evaluationAt",
    "createdAt",
    "logicalExpiresAt",
    "absoluteExpiresAt",
    "expiresAt",
  ]) {
    const date = original[field];
    timestampDocument[field] = {toDate: () => new Date(date.getTime())};
  }
  database.documents.set(path, timestampDocument);
  assert.deepEqual(
    await reserveCustomerBiteSaverRequestReplay({
      ...input,
      nowMs: nowMs + 1,
    }),
    {
      evaluationAtMs: nowMs,
      logicalExpiresAtMs: absoluteExpiresAtMs,
      replayed: true,
    },
  );

  database.documents.set(path, {...timestampDocument, unexpected: true});
  await assert.rejects(
    reserveCustomerBiteSaverRequestReplay({...input, nowMs: nowMs + 2}),
    (error) => assertContractError(error, "failed-precondition") &&
      error.message === "The BiteSaver request replay state is invalid.",
  );
});

test("invalid replay input fails before starting a transaction", async () => {
  const database = new InMemoryReplayDatabase();
  for (const overrides of [
    {requestFingerprint: "D".repeat(64)},
    {nowMs: nowMs + 0.5},
    {absoluteSessionExpiresAt: new Date(nowMs)},
    {purpose: "status"},
    {clientRequestId: "short"},
  ]) {
    await assert.rejects(
      reserveCustomerBiteSaverRequestReplay(replayInput(database, overrides)),
      (error) => assertContractError(error, "invalid-argument"),
    );
  }
  await assert.rejects(
    reserveCustomerBiteSaverRequestReplay(replayInput(database, {
      secretKey: Buffer.alloc(31),
    })),
    (error) => assertContractError(error, "failed-precondition"),
  );
  assert.equal(database.transactionRuns, 0);
});
