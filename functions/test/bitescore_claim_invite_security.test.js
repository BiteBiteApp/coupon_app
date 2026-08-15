"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const actualFirestore = require("firebase-admin/firestore");

const restaurantId = "claimable-restaurant";
const restaurantPath = `bitescore_restaurants/${restaurantId}`;
const lockPath = `private_rating_restaurant_operation_locks/${restaurantId}`;
const adminEmail = "schuyler.cole@gmail.com";
const tokenA = "A".repeat(43);
const tokenB = "B".repeat(43);

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function deepClone(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof actualFirestore.Timestamp) {
    return actualFirestore.Timestamp.fromMillis(value.toMillis());
  }
  if (Array.isArray(value)) {
    return value.map(deepClone);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, deepClone(nested)]),
  );
}

function loadRuntime() {
  const serverTimestamp = Object.freeze({__fieldValue: "serverTimestamp"});
  const deleteField = Object.freeze({__fieldValue: "delete"});
  const state = {
    autoId: 0,
    beforeCommit: null,
    conflictSources: [],
    conflicts: 0,
    documents: new Map(),
    logs: [],
    transactionAttempts: 0,
  };

  function resolveWriteValue(value) {
    if (value === serverTimestamp) {
      return actualFirestore.Timestamp.fromMillis(Date.now());
    }
    if (value instanceof actualFirestore.Timestamp) {
      return actualFirestore.Timestamp.fromMillis(value.toMillis());
    }
    if (Array.isArray(value)) {
      return value.map(resolveWriteValue);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          resolveWriteValue(nested),
        ]),
      );
    }
    return value;
  }

  function writeDocument(documentPath, data, merge = false) {
    const current = state.documents.get(documentPath);
    const resolved = resolveWriteValue(data);
    const nextData = merge && current
      ? {...deepClone(current.data), ...deepClone(resolved)}
      : deepClone(resolved);
    for (const [key, value] of Object.entries(nextData)) {
      if (value === deleteField) {
        delete nextData[key];
      }
    }
    state.documents.set(documentPath, {
      data: nextData,
      version: (current?.version ?? 0) + 1,
    });
  }

  function documentSnapshot(reference) {
    const stored = state.documents.get(reference.path);
    return {
      exists: stored !== undefined,
      id: reference.id,
      ref: reference,
      data: () => stored === undefined ? undefined : deepClone(stored.data),
    };
  }

  class FakeDocumentReference {
    constructor(documentPath) {
      this.path = documentPath;
      this.id = documentPath.slice(documentPath.lastIndexOf("/") + 1);
    }

    async get() {
      await new Promise((resolve) => setImmediate(resolve));
      return documentSnapshot(this);
    }

    async set(data, options = undefined) {
      writeDocument(this.path, data, options?.merge === true);
    }
  }

  class FakeQuery {
    constructor(collectionPath) {
      this.collectionPath = collectionPath;
      this.filters = [];
      this.maximum = null;
    }

    where(field, operation, value) {
      this.filters.push({field, operation, value});
      return this;
    }

    limit(value) {
      this.maximum = value;
      return this;
    }

    matchingReferences() {
      const prefix = `${this.collectionPath}/`;
      const matches = [];
      for (const [documentPath, stored] of state.documents.entries()) {
        if (!documentPath.startsWith(prefix) ||
            documentPath.slice(prefix.length).includes("/")) {
          continue;
        }
        const matchesFilters = this.filters.every((filter) => {
          assert.equal(filter.operation, "==");
          return stored.data[filter.field] === filter.value;
        });
        if (matchesFilters) {
          matches.push(new FakeDocumentReference(documentPath));
        }
      }
      return this.maximum === null ? matches : matches.slice(0, this.maximum);
    }

    async get() {
      const docs = this.matchingReferences().map(documentSnapshot);
      return {docs, empty: docs.length === 0};
    }
  }

  class FakeCollectionReference extends FakeQuery {
    doc(documentId = undefined) {
      const resolvedId = documentId ?? `auto-${++state.autoId}`;
      return new FakeDocumentReference(`${this.collectionPath}/${resolvedId}`);
    }
  }

  class TransactionConflict extends Error {
    constructor(sources) {
      super("Transaction conflict.");
      this.sources = sources;
    }
  }

  class FakeTransaction {
    constructor() {
      this.queryReads = [];
      this.readVersions = new Map();
      this.writes = [];
    }

    async get(target) {
      await new Promise((resolve) => setImmediate(resolve));
      if (target instanceof FakeDocumentReference) {
        const version = state.documents.get(target.path)?.version ?? 0;
        if (!this.readVersions.has(target.path)) {
          this.readVersions.set(target.path, version);
        }
        return documentSnapshot(target);
      }
      assert.ok(target instanceof FakeQuery);
      const references = target.matchingReferences();
      this.queryReads.push({
        target,
        resultVersions: references.map((reference) => [
          reference.path,
          state.documents.get(reference.path)?.version ?? 0,
        ]),
      });
      const docs = references.map((reference) => {
        const version = state.documents.get(reference.path)?.version ?? 0;
        if (!this.readVersions.has(reference.path)) {
          this.readVersions.set(reference.path, version);
        }
        return documentSnapshot(reference);
      });
      return {docs, empty: docs.length === 0};
    }

    set(reference, data, options = undefined) {
      this.writes.push({
        reference,
        data: deepClone(data),
        merge: options?.merge === true,
      });
      return this;
    }

    commit() {
      const conflictSources = [];
      for (const [documentPath, expectedVersion] of this.readVersions) {
        if ((state.documents.get(documentPath)?.version ?? 0) !== expectedVersion) {
          conflictSources.push(documentPath);
        }
      }
      for (const queryRead of this.queryReads) {
        const currentResultVersions = queryRead.target
          .matchingReferences()
          .map((reference) => [
            reference.path,
            state.documents.get(reference.path)?.version ?? 0,
          ]);
        if (!Array.isArray(queryRead.resultVersions) ||
            JSON.stringify(currentResultVersions) !==
              JSON.stringify(queryRead.resultVersions)) {
          conflictSources.push(
            `query:${queryRead.target.collectionPath}:tokenHash`,
          );
        }
      }
      if (conflictSources.length > 0) {
        throw new TransactionConflict([...new Set(conflictSources)]);
      }
      for (const write of this.writes) {
        writeDocument(write.reference.path, write.data, write.merge);
      }
    }
  }

  const database = {
    collection(collectionPath) {
      return new FakeCollectionReference(collectionPath);
    },
    async runTransaction(operation) {
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        state.transactionAttempts += 1;
        const transaction = new FakeTransaction();
        const result = await operation(transaction);
        if (state.beforeCommit !== null) {
          await state.beforeCommit({attempt, transaction});
        }
        try {
          transaction.commit();
          return result;
        } catch (error) {
          if (!(error instanceof TransactionConflict)) {
            throw error;
          }
          state.conflicts += 1;
          state.conflictSources.push(error.sources);
        }
      }
      throw new Error("Transaction retry limit exhausted.");
    },
  };

  class MockHttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  const logger = Object.fromEntries(
    ["debug", "error", "info", "log", "warn"].map((level) => [
      level,
      (...arguments_) => state.logs.push({level, arguments_}),
    ]),
  );
  const passThroughTrigger = (...arguments_) =>
    arguments_[arguments_.length - 1];
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    switch (request) {
      case "firebase-admin/app":
        return {initializeApp() {}};
      case "firebase-admin/firestore":
        return {
          ...actualFirestore,
          FieldValue: {
            delete: () => deleteField,
            serverTimestamp: () => serverTimestamp,
          },
          getFirestore: () => database,
        };
      case "firebase-admin/messaging":
        return {getMessaging: () => ({send: async () => "unused"})};
      case "firebase-functions":
        return {logger};
      case "firebase-functions/params":
        return {
          defineSecret: (name) => ({name, value: () => "unused"}),
          defineString: (name) => ({name, value: () => "unused"}),
        };
      case "firebase-functions/v2/firestore":
        return {
          onDocumentCreated: passThroughTrigger,
          onDocumentDeleted: passThroughTrigger,
          onDocumentWritten: passThroughTrigger,
        };
      case "firebase-functions/v2/https":
        return {
          HttpsError: MockHttpsError,
          onCall: passThroughTrigger,
          onRequest: passThroughTrigger,
        };
      case "firebase-functions/v2/options":
        return {setGlobalOptions() {}};
      case "firebase-functions/v2/scheduler":
        return {onSchedule: passThroughTrigger};
      case "stripe":
        return class FakeStripe {};
      default:
        return originalLoad.call(this, request, parent, isMain);
    }
  };

  const indexPath = path.resolve(__dirname, "../lib/index.js");
  delete require.cache[indexPath];
  let exports;
  try {
    exports = require(indexPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[indexPath];
  }

  return {
    createInvite: exports.createBiteScoreRestaurantClaimInvite,
    database,
    data(documentPath) {
      const stored = state.documents.get(documentPath);
      return stored === undefined ? undefined : deepClone(stored.data);
    },
    documents(collectionPath) {
      const prefix = `${collectionPath}/`;
      return [...state.documents.entries()]
        .filter(([documentPath]) =>
          documentPath.startsWith(prefix) &&
          !documentPath.slice(prefix.length).includes("/"))
        .map(([documentPath, stored]) => ({
          id: documentPath.slice(prefix.length),
          data: deepClone(stored.data),
        }));
    },
    patch(documentPath, data) {
      writeDocument(documentPath, data, true);
    },
    redeemInvite: exports.redeemBiteScoreRestaurantClaimInvite,
    reset() {
      state.autoId = 0;
      state.beforeCommit = null;
      state.conflictSources.length = 0;
      state.conflicts = 0;
      state.documents.clear();
      state.logs.length = 0;
      state.transactionAttempts = 0;
    },
    seed(documentPath, data) {
      writeDocument(documentPath, data, false);
    },
    setBeforeCommit(operation) {
      state.beforeCommit = operation;
    },
    state,
  };
}

const runtime = loadRuntime();

function canonicalRestaurant(overrides = {}) {
  return {
    id: restaurantId,
    name: "Claimable Cafe",
    address: "1 Main St",
    city: "Ocala",
    state: "FL",
    zipCode: "34470",
    isActive: true,
    active: true,
    isClaimed: false,
    ownerUserId: null,
    restaurantWriteRevision: 4,
    ...overrides,
  };
}

function restaurantWithActivity(activity) {
  const data = canonicalRestaurant();
  delete data.isActive;
  delete data.active;
  return {...data, ...activity};
}

function restaurantWithClaimState(claimState) {
  const data = canonicalRestaurant();
  delete data.isClaimed;
  delete data.ownerUserId;
  return {...data, ...claimState};
}

function activeInvite(token, overrides = {}) {
  return {
    tokenHash: hashToken(token),
    type: "bitescore_claim_invite",
    side: "bitescore",
    status: "active",
    restaurantId,
    restaurantName: "Claimable Cafe",
    restaurantAddressSummary: "1 Main St, Ocala, FL, 34470",
    createdAt: actualFirestore.Timestamp.fromMillis(Date.now() - 1_000),
    createdByUid: "admin-1",
    createdByEmail: adminEmail,
    expiresAt: actualFirestore.Timestamp.fromMillis(Date.now() + 60_000),
    usedAt: null,
    usedByUid: null,
    usedByEmail: null,
    maxUses: 1,
    useCount: 0,
    lastAccessedAt: null,
    revokedAt: null,
    revokedByUid: null,
    ...overrides,
  };
}

function adminRequest() {
  return {
    auth: {uid: "admin-1", token: {email: adminEmail}},
    data: {restaurantId},
  };
}

function redemptionRequest(token, uid = "owner-1") {
  return {
    auth: {
      uid,
      token: {email: `${uid}@example.test`, name: `Owner ${uid}`},
    },
    data: {token},
  };
}

async function expectFailedPrecondition(operation, messagePattern = undefined) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, "failed-precondition");
    if (messagePattern !== undefined) {
      assert.match(error.message, messagePattern);
    }
    return true;
  });
}

async function expectGenericInvalidInvite(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, "failed-precondition");
    assert.equal(error.message, "This invite link is no longer valid.");
    assert.equal(error.details, undefined);
    return true;
  });
}

async function expectTerminalInvite(operation, expectedReason) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, "failed-precondition");
    assert.equal(error.details?.reason, expectedReason);
    assert.equal(
      error.message,
      expectedReason === "used"
        ? "This invite has already been used."
        : "This invite link is no longer valid.",
    );
    return true;
  });
}

async function exerciseBothClaimPaths(restaurantData, expectedClaimable) {
  runtime.reset();
  runtime.seed(restaurantPath, restaurantData);
  if (expectedClaimable) {
    await runtime.createInvite(adminRequest());
    assert.equal(runtime.documents("restaurant_invites").length, 1);
  } else {
    await expectFailedPrecondition(runtime.createInvite(adminRequest()));
    assert.equal(runtime.documents("restaurant_invites").length, 0);
  }

  runtime.reset();
  runtime.seed(restaurantPath, restaurantData);
  runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA));
  if (expectedClaimable) {
    await runtime.redeemInvite(redemptionRequest(tokenA));
    assert.equal(runtime.data(restaurantPath).isClaimed, true);
    assert.equal(runtime.data("restaurant_invites/invite-a").status, "used");
  } else {
    await expectFailedPrecondition(runtime.redeemInvite(redemptionRequest(tokenA)));
    assert.equal(runtime.data("restaurant_invites/invite-a").status, "active");
    assert.equal(runtime.data("restaurant_invites/invite-a").useCount, 0);
  }
}

test("creation is transactional and stores only a token hash", async () => {
  runtime.reset();
  runtime.seed(restaurantPath, canonicalRestaurant());

  const result = await runtime.createInvite(adminRequest());
  const invites = runtime.documents("restaurant_invites");
  assert.equal(invites.length, 1);
  assert.equal(result.inviteId, invites[0].id);
  assert.equal(typeof result.token, "string");
  assert.equal(invites[0].data.tokenHash, hashToken(result.token));
  assert.equal(Object.hasOwn(invites[0].data, "token"), false);
  assert.equal(JSON.stringify(invites[0].data).includes(result.token), false);
  assert.equal(JSON.stringify(runtime.state.logs).includes(result.token), false);
  assert.equal(runtime.state.logs.length, 0);
  assert.match(result.inviteUrl, new RegExp(`${result.token}$`, "u"));
});

test("both claim callables use the complete strict activity truth table", async () => {
  const cases = [
    [{}, true],
    [{isActive: true}, true],
    [{isActive: false}, false],
    [{active: true}, true],
    [{active: false}, false],
    [{isActive: true, active: true}, true],
    [{isActive: false, active: false}, false],
    [{isActive: true, active: false}, false],
    [{isActive: false, active: true}, false],
    [{isActive: "true"}, false],
    [{active: null}, false],
    [{isActive: true, active: 1}, false],
  ];
  for (const [activity, expectedClaimable] of cases) {
    await exerciseBothClaimPaths(
      restaurantWithActivity(activity),
      expectedClaimable,
    );
  }
});

test("both claim callables require exact embedded identity and strict unclaimed state", async () => {
  const cases = [
    [{}, true],
    [{isClaimed: false}, true],
    [{ownerUserId: null}, true],
    [{ownerUserId: ""}, true],
    [{isClaimed: false, ownerUserId: null}, true],
    [{isClaimed: true}, false],
    [{isClaimed: null}, false],
    [{isClaimed: 0}, false],
    [{isClaimed: "false"}, false],
    [{isClaimed: {}}, false],
    [{isClaimed: []}, false],
    [{ownerUserId: " "}, false],
    [{ownerUserId: "owner-1"}, false],
    [{ownerUserId: 7}, false],
    [{ownerUserId: true}, false],
    [{ownerUserId: {}}, false],
    [{ownerUserId: []}, false],
    [{isClaimed: false, ownerUserId: "owner-1"}, false],
    [{isClaimed: true, ownerUserId: null}, false],
  ];
  for (const [claimState, expectedClaimable] of cases) {
    await exerciseBothClaimPaths(
      restaurantWithClaimState(claimState),
      expectedClaimable,
    );
  }

  for (const invalidIdentity of [undefined, "other-id", 7, null]) {
    const data = canonicalRestaurant();
    if (invalidIdentity === undefined) {
      delete data.id;
    } else {
      data.id = invalidIdentity;
    }
    await exerciseBothClaimPaths(data, false);
  }
});

test("creation rejects a lock and retries against hide, claim, and lock races", async () => {
  runtime.reset();
  runtime.seed(restaurantPath, canonicalRestaurant());
  runtime.seed(lockPath, {operation: "restaurantDelete"});
  await expectFailedPrecondition(
    runtime.createInvite(adminRequest()),
    /temporarily unavailable/u,
  );
  assert.equal(runtime.documents("restaurant_invites").length, 0);

  const races = [
    () => runtime.patch(restaurantPath, {
      isActive: false,
      active: false,
      restaurantWriteRevision: 5,
    }),
    () => runtime.patch(restaurantPath, {
      isClaimed: true,
      ownerUserId: "other-owner",
      restaurantWriteRevision: 5,
    }),
    () => runtime.seed(lockPath, {operation: "restaurantDelete"}),
  ];
  for (const injectRace of races) {
    runtime.reset();
    runtime.seed(restaurantPath, canonicalRestaurant());
    let injected = false;
    runtime.setBeforeCommit(() => {
      if (!injected) {
        injected = true;
        injectRace();
      }
    });
    await expectFailedPrecondition(runtime.createInvite(adminRequest()));
    assert.ok(runtime.state.conflicts >= 1);
    assert.equal(runtime.documents("restaurant_invites").length, 0);
  }
});

test("hidden redemption leaves the invite unused and restoration preserves validity", async () => {
  runtime.reset();
  runtime.seed(restaurantPath, canonicalRestaurant({
    isActive: false,
    active: false,
  }));
  runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA));

  await expectFailedPrecondition(
    runtime.redeemInvite(redemptionRequest(tokenA)),
    /unavailable for claiming/u,
  );
  assert.equal(runtime.data("restaurant_invites/invite-a").status, "active");
  assert.equal(runtime.data("restaurant_invites/invite-a").useCount, 0);

  runtime.patch(restaurantPath, {
    isActive: true,
    active: true,
    restaurantWriteRevision: 5,
  });
  await runtime.redeemInvite(redemptionRequest(tokenA));
  assert.equal(runtime.data(restaurantPath).ownerUserId, "owner-1");
  assert.equal(runtime.data(restaurantPath).restaurantWriteRevision, 6);
  assert.equal(runtime.data("restaurant_invites/invite-a").status, "used");
  assert.equal(runtime.data("restaurant_invites/invite-a").useCount, 1);
  assert.equal(
    JSON.stringify(runtime.documents("restaurant_invites")).includes(tokenA),
    false,
  );
  assert.equal(JSON.stringify(runtime.state.logs).includes(tokenA), false);
});

test("restoration never revives expired, revoked, or used invites", async () => {
  const terminalInvites = [
    {
      invite: activeInvite(tokenA, {
        expiresAt: actualFirestore.Timestamp.fromMillis(Date.now() - 1),
      }),
      reason: "expired",
    },
    {
      invite: activeInvite(tokenA, {
        status: "revoked",
        revokedAt: actualFirestore.Timestamp.fromMillis(Date.now() - 1),
        revokedByUid: "admin-1",
      }),
      reason: "inactive",
    },
    {
      invite: activeInvite(tokenA, {
        status: "used",
        usedAt: actualFirestore.Timestamp.fromMillis(Date.now() - 1),
        usedByUid: "prior-owner",
        usedByEmail: "prior-owner@example.test",
        useCount: 1,
      }),
      reason: "inactive",
    },
    {
      invite: activeInvite(tokenA, {useCount: 1}),
      reason: "used",
    },
  ];
  for (const fixture of terminalInvites) {
    runtime.reset();
    runtime.seed(restaurantPath, canonicalRestaurant({
      isActive: false,
      active: false,
    }));
    runtime.seed("restaurant_invites/invite-a", fixture.invite);
    await expectTerminalInvite(
      runtime.redeemInvite(redemptionRequest(tokenA)),
      fixture.reason,
    );
    runtime.patch(restaurantPath, {
      isActive: true,
      active: true,
      restaurantWriteRevision: 5,
    });
    await expectTerminalInvite(
      runtime.redeemInvite(redemptionRequest(tokenA)),
      fixture.reason,
    );
    assert.deepEqual(
      runtime.data("restaurant_invites/invite-a"),
      fixture.invite,
    );
  }
});

test("malformed BiteScore invites share one privacy-safe redemption error", async () => {
  const malformedInvites = [
    activeInvite(tokenA, {
      revokedAt: actualFirestore.Timestamp.fromMillis(Date.now() - 1),
    }),
    activeInvite(tokenA, {
      usedAt: actualFirestore.Timestamp.fromMillis(Date.now() - 1),
    }),
    activeInvite(tokenA, {maxUses: "1"}),
    activeInvite(tokenA, {useCount: -1}),
    activeInvite(tokenA, {restaurantId: ` ${restaurantId} `}),
    activeInvite(tokenA, {type: "coupon_invite"}),
    activeInvite(tokenA, {side: "coupon"}),
    activeInvite(tokenA, {restaurantId: null}),
    activeInvite(tokenA, {status: "inactive"}),
  ];
  for (const invite of malformedInvites) {
    runtime.reset();
    runtime.seed(restaurantPath, canonicalRestaurant());
    runtime.seed("restaurant_invites/invite-a", invite);
    await expectGenericInvalidInvite(
      runtime.redeemInvite(redemptionRequest(tokenA)),
    );
    assert.deepEqual(runtime.data("restaurant_invites/invite-a"), invite);
    assert.equal(runtime.data(restaurantPath).isClaimed, false);
  }

  runtime.reset();
  runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA));
  await expectGenericInvalidInvite(
    runtime.redeemInvite(redemptionRequest(tokenA)),
  );

  runtime.reset();
  runtime.seed(restaurantPath, canonicalRestaurant({
    name: null,
    restaurantName: null,
  }));
  runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA, {
    restaurantName: null,
  }));
  await expectGenericInvalidInvite(
    runtime.redeemInvite(redemptionRequest(tokenA)),
  );
});

test("redemption retries against hide, claim, and lock races without consuming", async () => {
  const races = [
    () => runtime.patch(restaurantPath, {
      isActive: false,
      active: false,
      restaurantWriteRevision: 5,
    }),
    () => runtime.patch(restaurantPath, {
      isClaimed: true,
      ownerUserId: "other-owner",
      restaurantWriteRevision: 5,
    }),
    () => runtime.seed(lockPath, {operation: "restaurantDelete"}),
  ];
  for (const injectRace of races) {
    runtime.reset();
    runtime.seed(restaurantPath, canonicalRestaurant());
    runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA));
    let injected = false;
    runtime.setBeforeCommit(() => {
      if (!injected) {
        injected = true;
        injectRace();
      }
    });
    await expectFailedPrecondition(runtime.redeemInvite(redemptionRequest(tokenA)));
    assert.ok(runtime.state.conflicts >= 1);
    assert.equal(runtime.data("restaurant_invites/invite-a").status, "active");
    assert.equal(runtime.data("restaurant_invites/invite-a").useCount, 0);
    assert.equal(runtime.documents("restaurant_claim_requests").length, 0);
  }
});

test("an unrelated invite write does not invalidate the token equality query", async () => {
  runtime.reset();
  runtime.seed(restaurantPath, canonicalRestaurant());
  runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA));
  let injected = false;
  runtime.setBeforeCommit(() => {
    if (!injected) {
      injected = true;
      runtime.seed("restaurant_invites/unrelated", activeInvite(tokenB));
    }
  });

  await runtime.redeemInvite(redemptionRequest(tokenA));
  assert.equal(runtime.state.transactionAttempts, 1);
  assert.equal(runtime.state.conflicts, 0);
  assert.deepEqual(runtime.state.conflictSources, []);
  assert.equal(runtime.data("restaurant_invites/invite-a").status, "used");
  assert.equal(runtime.data("restaurant_invites/unrelated").status, "active");
});

async function assertExactlyOneRedemption(requests) {
  const results = await Promise.allSettled(requests);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.ok(runtime.state.conflicts >= 1);
  assert.equal(runtime.documents("restaurant_claim_requests").length, 1);
  assert.equal(
    runtime.documents("restaurant_invites")
      .filter((invite) => invite.data.status === "used").length,
    1,
  );
}

function synchronizeNextTwoTransactionCommits() {
  let arrivals = 0;
  let releaseFirst;
  const secondArrival = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  runtime.setBeforeCommit(async () => {
    arrivals += 1;
    if (arrivals === 1) {
      await secondArrival;
    } else if (arrivals === 2) {
      releaseFirst();
    }
  });
}

test("same-token and different-invite redemptions remain exactly once", async () => {
  runtime.reset();
  runtime.seed(restaurantPath, canonicalRestaurant());
  runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA));
  synchronizeNextTwoTransactionCommits();
  await assertExactlyOneRedemption([
    runtime.redeemInvite(redemptionRequest(tokenA, "owner-1")),
    runtime.redeemInvite(redemptionRequest(tokenA, "owner-2")),
  ]);
  assert.ok(
    runtime.state.conflictSources.some((sources) =>
      sources.includes(restaurantPath) &&
      sources.includes("restaurant_invites/invite-a")),
  );

  for (const recipients of [
    ["owner-1", "owner-1"],
    ["owner-1", "owner-2"],
  ]) {
    runtime.reset();
    runtime.seed(restaurantPath, canonicalRestaurant());
    runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA));
    runtime.seed("restaurant_invites/invite-b", activeInvite(tokenB));
    synchronizeNextTwoTransactionCommits();
    await assertExactlyOneRedemption([
      runtime.redeemInvite(redemptionRequest(tokenA, recipients[0])),
      runtime.redeemInvite(redemptionRequest(tokenB, recipients[1])),
    ]);
    assert.deepEqual(runtime.state.conflictSources, [[restaurantPath]]);
  }
});

async function approvePendingClaim(ownerUid) {
  const claimRef = runtime.database
    .collection("restaurant_claim_requests")
    .doc("pending-claim");
  const restaurantRef = runtime.database
    .collection("bitescore_restaurants")
    .doc(restaurantId);
  return runtime.database.runTransaction(async (transaction) => {
    const [claimSnapshot, restaurantSnapshot] = await Promise.all([
      transaction.get(claimRef),
      transaction.get(restaurantRef),
    ]);
    const claim = claimSnapshot.data();
    const restaurant = restaurantSnapshot.data();
    if (!claimSnapshot.exists || claim.status !== "pending" ||
        !restaurantSnapshot.exists || restaurant.isClaimed !== false ||
        restaurant.ownerUserId !== null) {
      throw new Error("Approval lost the ownership race.");
    }
    transaction.set(claimRef, {status: "approved"}, {merge: true});
    transaction.set(restaurantRef, {
      isClaimed: true,
      ownerUserId: ownerUid,
      restaurantWriteRevision: restaurant.restaurantWriteRevision + 1,
    }, {merge: true});
    return {ownerUid};
  });
}

test("pending approval and invite redemption have exactly one owner winner", async () => {
  runtime.reset();
  runtime.seed(restaurantPath, canonicalRestaurant());
  runtime.seed("restaurant_claim_requests/pending-claim", {
    id: "pending-claim",
    restaurantId,
    requesterUserId: "owner-1",
    status: "pending",
  });
  runtime.seed("restaurant_invites/invite-a", activeInvite(tokenA));
  synchronizeNextTwoTransactionCommits();

  const results = await Promise.allSettled([
    approvePendingClaim("owner-1"),
    runtime.redeemInvite(redemptionRequest(tokenA, "owner-1")),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.ok(runtime.state.conflicts >= 1);
  assert.deepEqual(runtime.state.conflictSources, [[restaurantPath]]);
  assert.equal(runtime.data(restaurantPath).ownerUserId, "owner-1");
  assert.equal(runtime.data(restaurantPath).restaurantWriteRevision, 5);
});
