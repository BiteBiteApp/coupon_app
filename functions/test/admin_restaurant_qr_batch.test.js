"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  markAdminRestaurantQrBatchPreparedCallableHandler,
  prepareAdminRestaurantQrBatchCallableHandler,
} = require("../lib/admin_restaurant_qr_batch.js");
const {requireAdminInviteAccess} = require("../lib/admin_authorization.js");
const {hashInviteToken} = require("../lib/restaurant_invite_helpers.js");

const now = new Date("2026-08-29T16:00:00.000Z");
const past = new Date("2026-08-28T16:00:00.000Z");
const bindingId = "B".repeat(43);
const adminRequest = (data) => ({
  data,
  auth: {
    uid: "admin-user",
    token: {email: "schuyler.cole@gmail.com"},
  },
});

class FakeBatchDatabase {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial));
    this.allocations = 0;
    this.transactionCount = 0;
    this.pointReads = 0;
    this.queryCount = 0;
    this.queryReturnedDocuments = 0;
    this.committedWrites = 0;
    this.activeTransactions = 0;
    this.maximumActiveTransactions = 0;
    this.delays = new Map();
    this.failCommitFor = new Set();
    this.retries = new Map();
  }

  allocateRestaurantInviteId() {
    this.allocations += 1;
    return `batch-invite-${this.allocations}`;
  }

  delayRestaurant(id, millis) {
    this.delays.set(id, millis);
  }

  retryRestaurantOnce(id, beforeRetry = () => {}) {
    this.retries.set(id, beforeRetry);
  }

  async runTransaction(operation) {
    this.activeTransactions += 1;
    this.maximumActiveTransactions = Math.max(
      this.maximumActiveTransactions,
      this.activeTransactions,
    );
    let restaurantId = null;
    try {
      const execute = async () => {
        this.transactionCount += 1;
        const staged = [];
        const transaction = {
          getDocument: async (path) => {
            this.pointReads += 1;
            const parts = path.split("/");
            const id = parts.at(-1);
            if (path.startsWith("bitescore_restaurants/")) {
              restaurantId = id;
              const delay = this.delays.get(id) ?? 0;
              if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            }
            return this.records.has(path)
              ? {id, data: this.records.get(path)}
              : null;
          },
          queryRestaurantAccounts: async (catalogRestaurantId) => {
            restaurantId ??= catalogRestaurantId;
            this.queryCount += 1;
            const documents = [...this.records.entries()]
              .filter(([path, data]) =>
                path.startsWith("restaurant_accounts/") &&
                path.split("/").length === 2 &&
                data.biteScoreCatalogRestaurantId === catalogRestaurantId)
              .slice(0, 2)
              .map(([path, data]) => ({id: path.split("/").at(-1), data}));
            this.queryReturnedDocuments += documents.length;
            return documents;
          },
          mergeDocument: (path, patch) => {
            staged.push({kind: "merge", path, patch});
          },
          createDocument: (path, data) => {
            staged.push({kind: "create", path, data});
          },
        };
        const result = await operation(transaction);
        return {result, staged};
      };

      let attempt = await execute();
      const beforeRetry = restaurantId === null
        ? undefined
        : this.retries.get(restaurantId);
      if (beforeRetry !== undefined) {
        this.retries.delete(restaurantId);
        beforeRetry();
        attempt = await execute();
      }
      if (restaurantId !== null && this.failCommitFor.has(restaurantId)) {
        this.failCommitFor.delete(restaurantId);
        throw new Error("synthetic commit failure");
      }
      for (const write of attempt.staged) {
        if (write.kind === "create") {
          if (this.records.has(write.path)) {
            throw new Error("synthetic create collision");
          }
          this.records.set(write.path, write.data);
        } else {
          const updated = {
            ...(this.records.get(write.path) ?? {}),
            ...write.patch.set,
          };
          for (const field of write.patch.deleteFields) delete updated[field];
          this.records.set(write.path, updated);
        }
        this.committedWrites += 1;
      }
      return attempt.result;
    } finally {
      this.activeTransactions -= 1;
    }
  }

  async getPreparationDocuments(catalogRestaurantIds) {
    return new Map(catalogRestaurantIds
      .map((id) => [
        id,
        this.records.get(`private_admin_restaurant_qr_preparation/${id}`),
      ])
      .filter((entry) => entry[1] !== undefined));
  }
}

function restaurant(id, overrides = {}) {
  return {
    id,
    name: "River Grill",
    address: "1 Main St",
    city: "Hartford",
    state: "CT",
    zipCode: "06103",
    latitude: 41.7658,
    longitude: -72.6734,
    restaurantWriteRevision: 1,
    isActive: true,
    isClaimed: false,
    ownerUserId: null,
    ...overrides,
  };
}

function withRestaurants(entries) {
  return new FakeBatchDatabase(Object.fromEntries(entries.map(([id, data]) => [
    `bitescore_restaurants/${id}`,
    restaurant(id, data),
  ])));
}

function dependencies(database) {
  return {
    database,
    requireAdmin: requireAdminInviteAccess,
    now: () => now,
    serverTimestamp: () => now,
  };
}

function prepareRequest(ids, overrides = {}) {
  return {
    schemaVersion: 1,
    catalogRestaurantIds: ids,
    ...overrides,
  };
}

function markRequest(restaurants, overrides = {}) {
  return {schemaVersion: 1, restaurants, ...overrides};
}

function preparation(database, id) {
  return database.records.get(
    `private_admin_restaurant_qr_preparation/${id}`,
  );
}

async function prepare(database, ids) {
  return prepareAdminRestaurantQrBatchCallableHandler(
    adminRequest(prepareRequest(ids)),
    dependencies(database),
  );
}

async function mark(database, restaurants) {
  return markAdminRestaurantQrBatchPreparedCallableHandler(
    adminRequest(markRequest(restaurants)),
    dependencies(database),
  );
}

test("authorization precedes validation, allocation, and every database read", async () => {
  for (const auth of [
    null,
    {uid: "customer", token: {email: "customer@example.test"}},
    {uid: "owner", token: {email: "owner@example.test", admin: true}},
  ]) {
    const database = withRestaurants([["restaurant-1", {}]]);
    await assert.rejects(
      prepareAdminRestaurantQrBatchCallableHandler(
        {data: {unknown: true}, auth},
        dependencies(database),
      ),
      (error) => error.code === "permission-denied",
    );
    await assert.rejects(
      markAdminRestaurantQrBatchPreparedCallableHandler(
        {data: {unknown: true}, auth},
        dependencies(database),
      ),
      (error) => error.code === "permission-denied",
    );
    assert.equal(database.allocations, 0);
    assert.equal(database.transactionCount, 0);
  }

  const database = withRestaurants([["restaurant-1", {}]]);
  const response = await prepare(database, ["restaurant-1"]);
  assert.equal(response.outcome, "complete");
});

test("preparation rejects the closed request boundary before mutation", async () => {
  const invalidRequests = [
    {},
    {schemaVersion: 2, catalogRestaurantIds: ["restaurant-1"]},
    {schemaVersion: 1, catalogRestaurantIds: []},
    {schemaVersion: 1, catalogRestaurantIds: ["restaurant-1"], extra: true},
    {schemaVersion: 1, catalogRestaurantIds: ["restaurant-1", "restaurant-1"]},
    {schemaVersion: 1, catalogRestaurantIds: [" restaurant-1"]},
    {schemaVersion: 1, catalogRestaurantIds: ["restaurant-1 "]},
    {schemaVersion: 1, catalogRestaurantIds: ["restaurant/1"]},
    {schemaVersion: 1, catalogRestaurantIds: Array.from(
      {length: 26},
      (_, index) => `restaurant-${index}`,
    )},
  ];
  for (const value of invalidRequests) {
    const database = withRestaurants([["restaurant-1", {}]]);
    await assert.rejects(
      prepareAdminRestaurantQrBatchCallableHandler(
        adminRequest(value),
        dependencies(database),
      ),
      (error) => error.code === "invalid-argument",
    );
    assert.equal(database.allocations, 0, JSON.stringify(value));
    assert.equal(database.transactionCount, 0, JSON.stringify(value));
  }
});

test("preparation rejects malformed Unicode IDs before every side effect", async () => {
  const malformedIds = ["\uD800", "\uDC00"];
  const requests = [
    ...malformedIds.map((id) => prepareRequest([id])),
    ...malformedIds.map((id) => prepareRequest(["restaurant-1", id])),
  ];
  for (const request of requests) {
    const database = withRestaurants([["restaurant-1", {}]]);
    const recordsBefore = [...database.records.entries()];
    await assert.rejects(
      prepareAdminRestaurantQrBatchCallableHandler(
        adminRequest(request),
        dependencies(database),
      ),
      (error) => error.code === "invalid-argument",
    );
    assert.equal(database.allocations, 0);
    assert.equal(database.transactionCount, 0);
    assert.equal(database.pointReads, 0);
    assert.equal(database.queryCount, 0);
    assert.equal(database.committedWrites, 0);
    assert.deepEqual([...database.records.entries()], recordsBefore);
  }
});

test("preparation returns all four authoritative participation matrices", async () => {
  const cases = [
    ["neither", {}, ["I", "C", "SA", "SR"]],
    ["score-only", {
      isClaimed: true,
      ownerUserId: "score-owner",
    }, ["I", "SA", "SR"]],
    ["saver-only", {
      biteSaverCatalogBindingId: bindingId,
    }, ["C", "SA", "SR"]],
    ["both", {
      isClaimed: true,
      ownerUserId: "different-score-owner",
      biteSaverCatalogBindingId: bindingId,
    }, ["SA", "SR"]],
  ];
  for (const [id, overrides, expectedTypes] of cases) {
    const database = withRestaurants([[id, overrides]]);
    if (overrides.biteSaverCatalogBindingId) {
      database.records.set(`restaurant_accounts/saver-owner-${id}`, {
        biteScoreCatalogRestaurantId: id,
        biteSaverCatalogBindingId: bindingId,
      });
    }
    const response = await prepare(database, [id]);
    assert.equal(response.results[0].outcome, "ready", id);
    assert.deepEqual(
      response.results[0].labels.map((label) => label.type),
      expectedTypes,
      id,
    );
    const stored = preparation(database, id);
    assert.equal(stored?.saPrepared, undefined, id);
    assert.equal(stored?.srPrepared, undefined, id);
    assert.equal(stored?.iPreparedInviteId, undefined, id);
    assert.equal(stored?.cPreparedInviteId, undefined, id);
  }
});

test("ready payloads preserve canonical identity, route encoding, and token secrecy", async () => {
  const id = "same name west";
  const database = withRestaurants([[id, {}]]);
  const response = await prepare(database, [id]);
  const result = response.results[0];
  assert.equal(result.catalogRestaurantId, id);
  assert.equal(result.restaurantName, "River Grill");
  const labels = Object.fromEntries(result.labels.map((label) => [
    label.type,
    label,
  ]));
  assert.equal(
    labels.SA.payloadUrl,
    "https://go.bitestar.app/r/coupons/same%20name%20west",
  );
  assert.equal(
    labels.SR.payloadUrl,
    "https://go.bitestar.app/r/bitescore/same%20name%20west",
  );
  for (const type of ["I", "C"]) {
    const label = labels[type];
    const invite = database.records.get(
      `restaurant_invites/${label.invitationId}`,
    );
    const token = label.payloadUrl.split("/").at(-1);
    assert.equal(invite.tokenHash, hashInviteToken(token));
    assert.equal(Object.hasOwn(invite, "token"), false);
    assert.equal(Object.hasOwn(preparation(database, id), "token"), false);
  }
  assert.equal(database.records.has("restaurant_accounts/same name west"), false);
});

test("preparation preserves input order, isolates failures, and caps concurrency at four", async () => {
  const ids = Array.from({length: 25}, (_, index) => `restaurant-${index}`);
  const database = withRestaurants(ids.map((id) => [id, {name: "Same Name"}]));
  database.delayRestaurant(ids[0], 20);
  database.delayRestaurant(ids[1], 10);
  database.records.delete(`bitescore_restaurants/${ids[7]}`);
  const response = await prepare(database, ids);
  assert.deepEqual(
    response.results.map((result) => result.catalogRestaurantId),
    ids,
  );
  assert.equal(response.outcome, "partialFailure");
  assert.equal(response.results[7].outcome, "unavailable");
  assert.equal(response.results[7].code, "restaurant_not_found");
  assert.equal(response.results.filter((result) => result.outcome === "ready").length, 24);
  assert.ok(database.maximumActiveTransactions <= 4);
  assert.equal(database.pointReads, 75);
  assert.equal(database.queryCount, 25);
  assert.equal(database.queryReturnedDocuments, 0);
  assert.equal(database.committedWrites, 72);
});

test("preparation reports hidden, locked, malformed, ambiguous, and future state", async () => {
  const ids = ["hidden", "locked", "malformed", "ambiguous", "future", "valid"];
  const database = withRestaurants([
    ["hidden", {isActive: false}],
    ["locked", {}],
    ["malformed", {isClaimed: true, ownerUserId: null}],
    ["ambiguous", {biteSaverCatalogBindingId: bindingId}],
    ["future", {}],
    ["valid", {}],
  ]);
  database.records.set(
    "private_rating_restaurant_operation_locks/locked",
    {operationId: "synthetic"},
  );
  database.records.set("restaurant_accounts/ambiguous-a", {
    biteScoreCatalogRestaurantId: "ambiguous",
    biteSaverCatalogBindingId: bindingId,
  });
  database.records.set("restaurant_accounts/ambiguous-b", {
    biteScoreCatalogRestaurantId: "ambiguous",
    biteSaverCatalogBindingId: bindingId,
  });
  database.records.set(
    "private_admin_restaurant_qr_preparation/future",
    {schemaVersion: 2},
  );
  const response = await prepare(database, ids);
  assert.deepEqual(
    response.results.map((result) => result.outcome),
    ["unavailable", "unavailable", "unavailable", "unavailable", "unavailable", "ready"],
  );
  assert.deepEqual(
    response.results.slice(0, 5).map((result) => result.code),
    [
      "restaurant_state_unavailable",
      "restaurant_locked",
      "restaurant_state_unavailable",
      "restaurant_state_unavailable",
      "preparation_state_unavailable",
    ],
  );
  assert.deepEqual(
    database.records.get("private_admin_restaurant_qr_preparation/future"),
    {schemaVersion: 2},
  );
});

test("transaction retry commits one logical invitation set and rollback commits none", async () => {
  const retryDatabase = withRestaurants([["retry", {}]]);
  retryDatabase.retryRestaurantOnce("retry");
  const retried = await prepare(retryDatabase, ["retry"]);
  assert.equal(retried.results[0].outcome, "ready");
  assert.equal(retryDatabase.transactionCount, 2);
  assert.equal(
    [...retryDatabase.records.keys()].filter((path) =>
      path.startsWith("restaurant_invites/")).length,
    2,
  );
  assert.equal(retryDatabase.committedWrites, 3);

  const failedDatabase = withRestaurants([["rollback", {}]]);
  failedDatabase.failCommitFor.add("rollback");
  const failed = await prepare(failedDatabase, ["rollback"]);
  assert.equal(failed.results[0].outcome, "failed");
  assert.equal(failed.results[0].code, "transaction_failed");
  assert.equal(
    [...failedDatabase.records.keys()].some((path) =>
      path.startsWith("restaurant_invites/")),
    false,
  );
  assert.equal(preparation(failedDatabase, "rollback"), undefined);
});

test("new invitation B preserves valid prepared A and preparation never checks labels", async () => {
  const database = withRestaurants([["restaurant-1", {}]]);
  const first = await prepare(database, ["restaurant-1"]);
  const firstI = first.results[0].labels.find((label) => label.type === "I");
  database.records.set(
    "private_admin_restaurant_qr_preparation/restaurant-1",
    {
      ...preparation(database, "restaurant-1"),
      iPreparedInviteId: firstI.invitationId,
      iPreparedInviteExpiresAt: new Date(firstI.invitationExpiresAtMillis),
      saPrepared: true,
    },
  );
  const second = await prepare(database, ["restaurant-1"]);
  const secondI = second.results[0].labels.find((label) => label.type === "I");
  assert.notEqual(secondI.invitationId, firstI.invitationId);
  assert.equal(preparation(database, "restaurant-1").iLatestInviteId, secondI.invitationId);
  assert.equal(preparation(database, "restaurant-1").iPreparedInviteId, firstI.invitationId);
  assert.equal(preparation(database, "restaurant-1").saPrepared, true);
  assert.equal(preparation(database, "restaurant-1").srPrepared, undefined);
});

test("marking rejects every malformed closed contract before transactions", async () => {
  const badGroups = [
    {},
    {schemaVersion: 2, restaurants: []},
    {schemaVersion: 1, restaurants: []},
    {schemaVersion: 1, restaurants: [{
      catalogRestaurantId: "restaurant-1",
      labels: [{type: "I"}],
    }]},
    {schemaVersion: 1, restaurants: [{
      catalogRestaurantId: "restaurant-1",
      labels: [{type: "SA", invitationId: "invite-1"}],
    }]},
    {schemaVersion: 1, restaurants: [{
      catalogRestaurantId: "restaurant-1",
      labels: [{type: "SA"}, {type: "SA"}],
    }]},
    {schemaVersion: 1, restaurants: [{
      catalogRestaurantId: "restaurant-1",
      labels: [{type: "X"}],
    }]},
    {schemaVersion: 1, restaurants: [{
      catalogRestaurantId: " restaurant-1",
      labels: [{type: "SA"}],
    }]},
    {schemaVersion: 1, restaurants: [{
      catalogRestaurantId: "restaurant-1",
      labels: [{type: "SA", extra: true}],
    }], extra: true},
    {schemaVersion: 1, restaurants: [
      {catalogRestaurantId: "restaurant-1", labels: [{type: "SA"}]},
      {catalogRestaurantId: "restaurant-1", labels: [{type: "SR"}]},
    ]},
    {schemaVersion: 1, restaurants: Array.from({length: 26}, (_, index) => ({
      catalogRestaurantId: `restaurant-${index}`,
      labels: [{type: "SA"}],
    }))},
  ];
  for (const request of badGroups) {
    const database = withRestaurants([["restaurant-1", {}]]);
    await assert.rejects(
      markAdminRestaurantQrBatchPreparedCallableHandler(
        adminRequest(request),
        dependencies(database),
      ),
      (error) => error.code === "invalid-argument",
    );
    assert.equal(database.transactionCount, 0, JSON.stringify(request));
  }
});

test("marking rejects malformed Unicode identities before every side effect", async () => {
  const requests = [];
  for (const malformed of ["\uD800", "\uDC00"]) {
    requests.push(
      markRequest([
        {catalogRestaurantId: "restaurant-1", labels: [{type: "SA"}]},
        {catalogRestaurantId: malformed, labels: [{type: "SR"}]},
      ]),
      markRequest([
        {catalogRestaurantId: "restaurant-1", labels: [{type: "SA"}]},
        {
          catalogRestaurantId: "restaurant-2",
          labels: [{type: "I", invitationId: malformed}],
        },
      ]),
      markRequest([
        {catalogRestaurantId: "restaurant-1", labels: [{type: "SA"}]},
        {
          catalogRestaurantId: "restaurant-2",
          labels: [{type: "C", invitationId: malformed}],
        },
      ]),
    );
  }
  for (const request of requests) {
    const database = withRestaurants([
      ["restaurant-1", {}],
      ["restaurant-2", {}],
    ]);
    const recordsBefore = [...database.records.entries()];
    await assert.rejects(
      markAdminRestaurantQrBatchPreparedCallableHandler(
        adminRequest(request),
        dependencies(database),
      ),
      (error) => error.code === "invalid-argument",
    );
    assert.equal(database.allocations, 0);
    assert.equal(database.transactionCount, 0);
    assert.equal(database.pointReads, 0);
    assert.equal(database.queryCount, 0);
    assert.equal(database.committedWrites, 0);
    assert.deepEqual([...database.records.entries()], recordsBefore);
  }
});

test("exact invitation A can be marked after B is latest, with idempotent retry", async () => {
  const database = withRestaurants([["restaurant-1", {}]]);
  const first = await prepare(database, ["restaurant-1"]);
  const firstI = first.results[0].labels.find((label) => label.type === "I");
  const firstC = first.results[0].labels.find((label) => label.type === "C");
  const second = await prepare(database, ["restaurant-1"]);
  const secondI = second.results[0].labels.find((label) => label.type === "I");
  assert.notEqual(firstI.invitationId, secondI.invitationId);
  const group = {
    catalogRestaurantId: "restaurant-1",
    labels: [
      {type: "I", invitationId: firstI.invitationId},
      {type: "C", invitationId: firstC.invitationId},
      {type: "SA"},
      {type: "SR"},
    ],
  };
  const saved = await mark(database, [group]);
  assert.equal(saved.outcome, "complete");
  assert.deepEqual(saved.results[0].labels.map((label) => label.status), [
    "saved", "saved", "saved", "saved",
  ]);
  assert.equal(preparation(database, "restaurant-1").iLatestInviteId, secondI.invitationId);
  assert.equal(preparation(database, "restaurant-1").iPreparedInviteId, firstI.invitationId);
  const repeated = await mark(database, [group]);
  assert.deepEqual(
    repeated.results[0].labels.map((label) => label.alreadySaved),
    [true, true, true, true],
  );
});

test("invalid invitation shapes fail per type while valid fields commit", async () => {
  const cases = [
    ["wrong family", {type: "bitescore_claim_invite"}],
    ["wrong restaurant", {biteScoreCatalogRestaurantId: "other"}],
    ["expired", {expiresAt: past}],
    ["revoked", {status: "revoked", revokedAt: now, revokedByUid: "admin"}],
    ["used", {status: "used", useCount: 1, usedAt: now, usedByUid: "owner"}],
  ];
  for (const [label, inviteOverrides] of cases) {
    const database = withRestaurants([["restaurant-1", {}]]);
    const prepared = await prepare(database, ["restaurant-1"]);
    const ownerLabel = prepared.results[0].labels.find((entry) => entry.type === "I");
    const path = `restaurant_invites/${ownerLabel.invitationId}`;
    database.records.set(path, {...database.records.get(path), ...inviteOverrides});
    const result = await mark(database, [{
      catalogRestaurantId: "restaurant-1",
      labels: [
        {type: "I", invitationId: ownerLabel.invitationId},
        {type: "SA"},
      ],
    }]);
    assert.equal(result.outcome, "partialFailure", label);
    assert.deepEqual(result.results[0].labels.map((entry) => entry.status), [
      "failed", "saved",
    ], label);
    assert.equal(preparation(database, "restaurant-1").iPreparedInviteId, undefined, label);
    assert.equal(preparation(database, "restaurant-1").saPrepared, true, label);
  }
});

test("pre-epoch C fails while current C and permanent labels save", async () => {
  const epoch = new Date("2026-08-29T15:00:00.000Z");
  const database = withRestaurants([["restaurant-1", {
    claimInvitationEpochAt: epoch,
  }]]);
  const prepared = await prepare(database, ["restaurant-1"]);
  const claimLabel = prepared.results[0].labels.find((label) => label.type === "C");
  const path = `restaurant_invites/${claimLabel.invitationId}`;
  database.records.set(path, {...database.records.get(path), createdAt: past});
  const result = await mark(database, [{
    catalogRestaurantId: "restaurant-1",
    labels: [
      {type: "C", invitationId: claimLabel.invitationId},
      {type: "SR"},
    ],
  }]);
  assert.deepEqual(result.results[0].labels.map((entry) => entry.status), [
    "failed", "saved",
  ]);
  assert.equal(preparation(database, "restaurant-1").cPreparedInviteId, undefined);
  assert.equal(preparation(database, "restaurant-1").srPrepared, true);
});

test("labels that became not required do not force prepared state", async () => {
  const database = withRestaurants([["restaurant-1", {}]]);
  const prepared = await prepare(database, ["restaurant-1"]);
  const ownerLabel = prepared.results[0].labels.find((label) => label.type === "I");
  const claimLabel = prepared.results[0].labels.find((label) => label.type === "C");
  database.records.set("bitescore_restaurants/restaurant-1", restaurant(
    "restaurant-1",
    {
      biteSaverCatalogBindingId: bindingId,
      isClaimed: true,
      ownerUserId: "different-score-owner",
    },
  ));
  database.records.set("restaurant_accounts/saver-owner", {
    biteScoreCatalogRestaurantId: "restaurant-1",
    biteSaverCatalogBindingId: bindingId,
  });
  const result = await mark(database, [{
    catalogRestaurantId: "restaurant-1",
    labels: [
      {type: "I", invitationId: ownerLabel.invitationId},
      {type: "C", invitationId: claimLabel.invitationId},
    ],
  }]);
  assert.equal(result.outcome, "complete");
  assert.equal(result.results[0].labels[0].status, "notRequired");
  assert.equal(result.results[0].labels[1].status, "notRequired");
  assert.equal(preparation(database, "restaurant-1").iPreparedInviteId, undefined);
  assert.equal(preparation(database, "restaurant-1").cPreparedInviteId, undefined);
  assert.equal(result.results[0].preparation.i, "notRequired");
  assert.equal(result.results[0].preparation.c, "notRequired");
});

test("marking transaction failure reports no saved labels and retry creates no invites", async () => {
  const database = withRestaurants([["restaurant-1", {}]]);
  const beforeInvites = [...database.records.keys()].filter((path) =>
    path.startsWith("restaurant_invites/")).length;
  database.failCommitFor.add("restaurant-1");
  const group = {
    catalogRestaurantId: "restaurant-1",
    labels: [{type: "SA"}, {type: "SR"}],
  };
  const failed = await mark(database, [group]);
  assert.equal(failed.results[0].outcome, "failed");
  assert.deepEqual(failed.results[0].labels.map((label) => label.status), [
    "failed", "failed",
  ]);
  assert.equal(preparation(database, "restaurant-1"), undefined);
  const retried = await mark(database, [group]);
  assert.equal(retried.results[0].outcome, "processed");
  assert.equal(preparation(database, "restaurant-1").saPrepared, true);
  assert.equal(preparation(database, "restaurant-1").srPrepared, true);
  assert.equal(
    [...database.records.keys()].filter((path) =>
      path.startsWith("restaurant_invites/")).length,
    beforeInvites,
  );
});

test("marking retries from current state and preserves unrelated fields", async () => {
  const database = withRestaurants([["restaurant-1", {}]]);
  database.records.set(
    "private_admin_restaurant_qr_preparation/restaurant-1",
    {schemaVersion: 1, srPrepared: false},
  );
  database.retryRestaurantOnce("restaurant-1", () => {
    database.records.set(
      "private_admin_restaurant_qr_preparation/restaurant-1",
      {schemaVersion: 1, srPrepared: true},
    );
  });
  const response = await mark(database, [{
    catalogRestaurantId: "restaurant-1",
    labels: [{type: "SA"}],
  }]);
  assert.equal(database.transactionCount, 2);
  assert.deepEqual(preparation(database, "restaurant-1"), {
    schemaVersion: 1,
    srPrepared: true,
    saPrepared: true,
  });
  assert.equal(response.results[0].preparation.sr, "prepared");
});

test("marking preserves restaurant order and observes transaction/read bounds", async () => {
  const ids = Array.from({length: 25}, (_, index) => `mark-${index}`);
  const database = withRestaurants(ids.map((id) => [id, {}]));
  const prepared = await prepare(database, ids);
  database.pointReads = 0;
  database.queryCount = 0;
  database.queryReturnedDocuments = 0;
  database.committedWrites = 0;
  database.maximumActiveTransactions = 0;
  database.delayRestaurant(ids[0], 20);
  const response = await mark(database, prepared.results.map((result) => ({
    catalogRestaurantId: result.catalogRestaurantId,
    labels: result.labels.map((label) =>
      label.type === "I" || label.type === "C"
        ? {type: label.type, invitationId: label.invitationId}
        : {type: label.type}),
  })));
  assert.deepEqual(response.results.map((result) => result.catalogRestaurantId), ids);
  assert.equal(response.outcome, "complete");
  assert.ok(database.maximumActiveTransactions <= 4);
  assert.equal(database.pointReads, 125);
  assert.equal(database.queryCount, 25);
  assert.equal(database.committedWrites, 25);
});
