"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  biteScoreClaimInvitationEpochIsValid,
  biteScoreClaimInvitationIsInCurrentEpoch,
  clearClaimPreparationAfterUnclaim,
  invitationPreparationIdentity,
  isSafeBiteScoreUnclaimTransition,
  latestInvitationPreparationPatch,
  parseAdminRestaurantQrPreparationDocument,
  projectAdminRestaurantQrPreparation,
  terminalInvitationPreparationPatch,
  updateAdminRestaurantQrPreparation,
  updateAdminRestaurantQrPreparationCallableHandler,
  validateAdminRestaurantQrPreparedClaimAssociation,
  validateAdminRestaurantQrPreparedOwnerAssociation,
} = require("../lib/admin_restaurant_qr_preparation.js");
const {HttpsError} = require("firebase-functions/v2/https");

const now = new Date("2026-08-17T12:00:00.000Z");
const future = new Date("2026-09-17T12:00:00.000Z");
const past = new Date("2026-07-17T12:00:00.000Z");
const bindingId = "A".repeat(43);

class FakePreparationDatabase {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial));
    this.transactionCount = 0;
    this.batchLoads = [];
    this.documentReads = [];
    this.retryNextTransaction = false;
    this._tail = Promise.resolve();
  }

  injectTransactionRetryOnce() {
    this.retryNextTransaction = true;
  }

  runTransaction(operation) {
    const execute = async () => {
      const attemptCount = this.retryNextTransaction ? 2 : 1;
      this.retryNextTransaction = false;
      let result;
      for (let attempt = 0; attempt < attemptCount; attempt += 1) {
        this.transactionCount += 1;
        const staged = [];
        const transaction = {
          getDocument: async (path) => {
            this.documentReads.push(path);
            return this.records.has(path)
              ? {id: path.split("/").at(-1), data: this.records.get(path)}
              : null;
          },
          queryRestaurantAccounts: async (catalogRestaurantId) =>
            [...this.records.entries()]
              .filter(([path, data]) =>
                path.startsWith("restaurant_accounts/") &&
                path.split("/").length === 2 &&
                data.biteScoreCatalogRestaurantId === catalogRestaurantId)
              .slice(0, 2)
              .map(([path, data]) => ({id: path.split("/").at(-1), data})),
          mergeDocument: (path, patch) => staged.push({path, patch}),
        };
        result = await operation(transaction);
        if (attempt + 1 < attemptCount) {
          continue;
        }
        for (const {path, patch} of staged) {
          const updated = {...(this.records.get(path) ?? {}), ...patch.set};
          for (const field of patch.deleteFields) delete updated[field];
          this.records.set(path, updated);
        }
      }
      return result;
    };
    const result = this._tail.then(execute, execute);
    this._tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async getPreparationDocuments(catalogRestaurantIds) {
    this.batchLoads.push([...catalogRestaurantIds]);
    return new Map(catalogRestaurantIds
      .map((id) => [
        id,
        this.records.get(`private_admin_restaurant_qr_preparation/${id}`),
      ])
      .filter((entry) => entry[1] !== undefined));
  }
}

function restaurant(overrides = {}) {
  return {
    id: "restaurant-1",
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

function invite(type, restaurantId = "restaurant-1", overrides = {}) {
  const owner = type === "I";
  return {
    type: owner ? "coupon_invite" : "bitescore_claim_invite",
    side: owner ? "coupon" : "bitescore",
    status: "active",
    restaurantId: owner ? null : restaurantId,
    ...(owner
      ? {
          pendingRestaurantKey: "pending_invite-1",
          biteScoreCatalogRestaurantId: restaurantId,
        }
      : {}),
    maxUses: 1,
    useCount: 0,
    usedAt: null,
    usedByUid: null,
    usedByEmail: null,
    revokedAt: null,
    revokedByUid: null,
    createdAt: past,
    expiresAt: future,
    ...overrides,
  };
}

function database(overrides = {}) {
  return new FakePreparationDatabase({
    "bitescore_restaurants/restaurant-1": restaurant(),
    ...overrides,
  });
}

function mutation(type, prepared, overrides = {}) {
  return {
    catalogRestaurantId: "restaurant-1",
    type,
    prepared,
    ...overrides,
  };
}

function prepRecord(databaseValue, id = "restaurant-1") {
  return databaseValue.records.get(
    `private_admin_restaurant_qr_preparation/${id}`,
  );
}

async function applyPatch(databaseValue, patch, id = "restaurant-1") {
  await databaseValue.runTransaction(async (transaction) => {
    transaction.mergeDocument(
      `private_admin_restaurant_qr_preparation/${id}`,
      patch,
    );
  });
}

test("callable authorization runs before any preparation transaction", async () => {
  const data = database();
  await assert.rejects(
    updateAdminRestaurantQrPreparationCallableHandler(
      {data: mutation("SA", true), auth: null},
      {
        database: data,
        requireAdmin() {
          throw new HttpsError("permission-denied", "Admin access is required.");
        },
        now: () => now,
      },
    ),
    (error) => error.code === "permission-denied",
  );
  assert.equal(data.transactionCount, 0);
});

test("canonical catalog identity is required and standalone account IDs fail", async () => {
  const data = database({
    "restaurant_accounts/standalone-owner": {
      uid: "standalone-owner",
      approvalStatus: "approved",
    },
  });
  await assert.rejects(
    updateAdminRestaurantQrPreparation(data, {
      catalogRestaurantId: "unsafe/path",
      type: "SA",
      prepared: true,
    }, now),
    (error) => error.code === "invalid-argument",
  );
  await assert.rejects(
    updateAdminRestaurantQrPreparation(data, {
      catalogRestaurantId: "standalone-owner",
      type: "SA",
      prepared: true,
    }, now),
    (error) => error.code === "not-found",
  );
  assert.equal(
    data.records.has(
      "private_admin_restaurant_qr_preparation/standalone-owner",
    ),
    false,
  );
});

test("request and invitation identities reject unsafe exact path segments", async () => {
  const unsafeIds = [
    " restaurant-1",
    "restaurant-1 ",
    "",
    "   ",
    "restaurant/id",
  ];
  for (const unsafeId of unsafeIds) {
    const data = database();
    await assert.rejects(
      updateAdminRestaurantQrPreparation(data, {
        catalogRestaurantId: unsafeId,
        type: "SA",
        prepared: true,
      }, now),
      (error) => error.code === "invalid-argument",
      unsafeId,
    );
    assert.equal(prepRecord(data), undefined, unsafeId);
  }

  for (const unsafeInviteId of [
    " invitation-id ",
    "",
    "   ",
    "invitation/id",
  ]) {
    const data = database();
    await assert.rejects(
      updateAdminRestaurantQrPreparation(
        data,
        mutation("I", true, {expectedInviteId: unsafeInviteId}),
        now,
      ),
      (error) => error.code === "invalid-argument",
      unsafeInviteId,
    );
    assert.equal(prepRecord(data), undefined, unsafeInviteId);
  }
});

test("missing and strictly valid version-1 documents parse", () => {
  assert.deepEqual(parseAdminRestaurantQrPreparationDocument(null), {
    saPrepared: false,
    srPrepared: false,
    iLatest: null,
    iPrepared: null,
    cLatest: null,
    cPrepared: null,
  });
  assert.deepEqual(parseAdminRestaurantQrPreparationDocument({
    schemaVersion: 1,
    saPrepared: true,
    iLatestInviteId: "invite-1",
    iLatestInviteExpiresAt: future,
  }), {
    saPrepared: true,
    srPrepared: false,
    iLatest: {id: "invite-1", expiresAtMillis: future.getTime()},
    iPrepared: null,
    cLatest: null,
    cPrepared: null,
  });
  assert.deepEqual(latestInvitationPreparationPatch(
    null,
    "I",
    "invite-1",
    future,
  ), {
    set: {
      schemaVersion: 1,
      iLatestInviteId: "invite-1",
      iLatestInviteExpiresAt: future,
    },
    deleteFields: [],
  });
  assert.deepEqual(projectAdminRestaurantQrPreparation({
    catalogRestaurantId: "restaurant-1",
    rawPreparation: null,
    biteSaverParticipation: "unbound",
    biteScoreClaim: "available",
    ownerPreparedValidation: {state: "absent", inviteId: null},
    claimPreparedValidation: {state: "absent", inviteId: null},
    nowMillis: now.getTime(),
  }), {
    canonicalCatalogRestaurantId: "restaurant-1",
    i: "unprepared",
    c: "unprepared",
    sa: "unprepared",
    sr: "unprepared",
  });
});

test("unknown, future, mistyped, and contradictory preparation data fail closed", () => {
  const malformedDocuments = [
    {schemaVersion: 1, unknownField: true},
    {schemaVersion: 2},
    {schemaVersion: 1, saPrepared: "yes"},
    {schemaVersion: 1, iLatestInviteId: "invite-1"},
    {
      schemaVersion: 1,
      iLatestInviteId: "invite-1",
      iLatestInviteExpiresAt: future,
      iPreparedInviteId: "invite-1",
      iPreparedInviteExpiresAt: past,
    },
    {
      schemaVersion: 1,
      iLatestInviteId: "shared-id",
      iLatestInviteExpiresAt: future,
      cPreparedInviteId: "shared-id",
      cPreparedInviteExpiresAt: future,
    },
  ];
  for (const malformed of malformedDocuments) {
    assert.equal(parseAdminRestaurantQrPreparationDocument(malformed), null);
  }
  assert.deepEqual(projectAdminRestaurantQrPreparation({
    catalogRestaurantId: "restaurant-1",
    rawPreparation: {schemaVersion: 1, unknownField: false},
    biteSaverParticipation: "bound",
    biteScoreClaim: "claimed",
    ownerPreparedValidation: {state: "unavailable", inviteId: null},
    claimPreparedValidation: {state: "unavailable", inviteId: null},
    nowMillis: now.getTime(),
  }), {
    canonicalCatalogRestaurantId: "restaurant-1",
    i: "unavailable",
    c: "unavailable",
    sa: "unavailable",
    sr: "unavailable",
  });
});

test("SA and SR manual updates are reversible, isolated, concurrent, and idempotent", async () => {
  const data = database();
  await Promise.all([
    updateAdminRestaurantQrPreparation(data, mutation("SA", true), now),
    updateAdminRestaurantQrPreparation(data, mutation("SR", true), now),
  ]);
  assert.equal(prepRecord(data).saPrepared, true);
  assert.equal(prepRecord(data).srPrepared, true);

  await updateAdminRestaurantQrPreparation(data, mutation("SA", true), now);
  assert.equal(prepRecord(data).saPrepared, true);
  assert.equal(prepRecord(data).srPrepared, true);

  await updateAdminRestaurantQrPreparation(data, mutation("SA", false), now);
  assert.equal(prepRecord(data).saPrepared, false);
  assert.equal(prepRecord(data).srPrepared, true);
});

test("missing state initializes v1 and valid updates preserve unrelated fields on retry", async () => {
  const data = database();
  await updateAdminRestaurantQrPreparation(data, mutation("SA", true), now);
  assert.deepEqual(prepRecord(data), {schemaVersion: 1, saPrepared: true});

  data.records.set(
    "private_admin_restaurant_qr_preparation/restaurant-1",
    {schemaVersion: 1, saPrepared: true, srPrepared: true},
  );
  const transactionsBeforeRetry = data.transactionCount;
  data.injectTransactionRetryOnce();
  await updateAdminRestaurantQrPreparation(data, mutation("SA", false), now);
  assert.equal(data.transactionCount, transactionsBeforeRetry + 2);
  assert.deepEqual(prepRecord(data), {
    schemaVersion: 1,
    saPrepared: false,
    srPrepared: true,
  });
});

test("Admin mutation and lifecycle helpers never normalize unsupported state", async () => {
  for (const malformed of [
    {schemaVersion: 2, saPrepared: true},
    {schemaVersion: 1, saPrepared: true, unknownField: "retain"},
  ]) {
    const data = database({
      "private_admin_restaurant_qr_preparation/restaurant-1": malformed,
    });
    await assert.rejects(
      updateAdminRestaurantQrPreparation(data, mutation("SA", false), now),
      (error) => error.code === "failed-precondition",
    );
    assert.deepEqual(prepRecord(data), malformed);
    assert.throws(
      () => latestInvitationPreparationPatch(
        malformed,
        "I",
        "invite-1",
        future,
      ),
      (error) => error.code === "failed-precondition",
    );
    assert.equal(
      terminalInvitationPreparationPatch(malformed, "I", "invite-1"),
      null,
    );
    const cleared = await clearClaimPreparationAfterUnclaim(
      data,
      "restaurant-1",
      restaurant({isClaimed: true, ownerUserId: "owner-1"}),
      restaurant({claimInvitationEpochAt: now}),
      now,
    );
    assert.equal(cleared, false);
    assert.deepEqual(prepRecord(data), malformed);
  }
});

test("manual invitation check uses and validates the latest server-known invite", async () => {
  const data = database({
    "restaurant_invites/invite-1": invite("I"),
    "private_admin_restaurant_qr_preparation/restaurant-1": {
      schemaVersion: 1,
      iLatestInviteId: "invite-1",
      iLatestInviteExpiresAt: future,
      srPrepared: true,
    },
    "restaurant_invites/claim-1": invite("C", "restaurant-1", {
      createdAt: past,
    }),
  });
  const result = await updateAdminRestaurantQrPreparation(
    data,
    mutation("I", true),
    now,
  );
  assert.equal(result.i, "prepared");
  assert.equal(prepRecord(data).iPreparedInviteId, "invite-1");
  assert.equal(prepRecord(data).srPrepared, true);

  await updateAdminRestaurantQrPreparation(data, mutation("I", false), now);
  assert.equal(Object.hasOwn(prepRecord(data), "iPreparedInviteId"), false);
  assert.equal(prepRecord(data).iLatestInviteId, "invite-1");
});

test("exact I and C invitation validation rejects every invalid lifecycle shape", async () => {
  const cases = [
    ["wrong restaurant", invite("I", "other")],
    ["wrong type", invite("C")],
    ["expired", invite("I", "restaurant-1", {expiresAt: past})],
    ["revoked", invite("I", "restaurant-1", {
      status: "revoked",
      revokedAt: now,
      revokedByUid: "admin",
    })],
    ["used", invite("I", "restaurant-1", {
      status: "used",
      useCount: 1,
      usedAt: now,
      usedByUid: "owner",
      usedByEmail: "owner@example.test",
    })],
  ];
  for (const [label, inviteData] of cases) {
    const data = database({"restaurant_invites/invite-1": inviteData});
    await assert.rejects(
      updateAdminRestaurantQrPreparation(
        data,
        mutation("I", true, {expectedInviteId: "invite-1"}),
        now,
      ),
      (error) => error.code === "failed-precondition",
      label,
    );
    assert.equal(prepRecord(data), undefined, label);
  }

  const claimData = database({
    "restaurant_invites/claim-1": invite("C"),
  });
  const claimResult = await updateAdminRestaurantQrPreparation(
    claimData,
    mutation("C", true, {expectedInviteId: "claim-1"}),
    now,
  );
  assert.equal(claimResult.c, "prepared");
  assert.equal(prepRecord(claimData).cPreparedInviteId, "claim-1");
});

test("I preparation reuses the hardened Admin search eligibility invariant", async () => {
  const ineligibleRestaurants = [
    ["inactive", restaurant({isActive: false})],
    ["document identity mismatch", restaurant({id: "other"})],
    ["profile incomplete", restaurant({address: undefined})],
    ["revision missing", restaurant({restaurantWriteRevision: undefined})],
    ["revision invalid", restaurant({restaurantWriteRevision: Number.MAX_SAFE_INTEGER})],
    ["claim state invalid", restaurant({isClaimed: true, ownerUserId: null})],
    ["padded owner identity", restaurant({
      isClaimed: true,
      ownerUserId: " owner-1",
    })],
    ["padded linked BiteSaver identity", restaurant({
      linkedBiteSaverUid: " account-1",
    })],
    ["path-like linked BiteSaver identity", restaurant({
      linkedBiteSaverUid: "account/1",
    })],
  ];
  for (const [label, restaurantData] of ineligibleRestaurants) {
    const data = database({
      "bitescore_restaurants/restaurant-1": restaurantData,
      "restaurant_invites/invite-1": invite("I"),
    });
    await assert.rejects(
      updateAdminRestaurantQrPreparation(
        data,
        mutation("I", true, {expectedInviteId: "invite-1"}),
        now,
      ),
      (error) => error.code === "failed-precondition",
      label,
    );
    assert.equal(prepRecord(data), undefined, label);
  }

  const contradictoryAccount = database({
    "restaurant_accounts/owner-1": {
      biteScoreCatalogRestaurantId: "restaurant-1",
      biteSaverCatalogBindingId: bindingId,
    },
    "restaurant_invites/invite-1": invite("I"),
  });
  await assert.rejects(
    updateAdminRestaurantQrPreparation(
      contradictoryAccount,
      mutation("I", true, {expectedInviteId: "invite-1"}),
      now,
    ),
    (error) => error.code === "failed-precondition",
  );
  assert.equal(prepRecord(contradictoryAccount), undefined);
});

test("a newer latest invite preserves an older valid prepared invite", async () => {
  const data = database({
    "restaurant_invites/invite-a": invite("I", "restaurant-1", {
      pendingRestaurantKey: "pending_invite-a",
    }),
    "restaurant_invites/invite-b": invite("I", "restaurant-1", {
      pendingRestaurantKey: "pending_invite-b",
    }),
    "private_admin_restaurant_qr_preparation/restaurant-1": {
      schemaVersion: 1,
      iLatestInviteId: "invite-a",
      iLatestInviteExpiresAt: future,
      iPreparedInviteId: "invite-a",
      iPreparedInviteExpiresAt: future,
    },
  });
  const latestPatch = latestInvitationPreparationPatch(
    prepRecord(data),
    "I",
    "invite-b",
    future,
  );
  assert.deepEqual(latestPatch.deleteFields, []);
  await applyPatch(data, latestPatch);
  assert.equal(prepRecord(data).iLatestInviteId, "invite-b");
  assert.equal(prepRecord(data).iPreparedInviteId, "invite-a");
  const ownerPreparedValidation =
    validateAdminRestaurantQrPreparedOwnerAssociation({
      catalogRestaurantId: "restaurant-1",
      rawPreparation: prepRecord(data),
      restaurantData: data.records.get("bitescore_restaurants/restaurant-1"),
      invitation: {
        id: "invite-a",
        data: data.records.get("restaurant_invites/invite-a"),
      },
      nowMillis: now.getTime(),
    });
  assert.equal(projectAdminRestaurantQrPreparation({
    catalogRestaurantId: "restaurant-1",
    rawPreparation: prepRecord(data),
    biteSaverParticipation: "unbound",
    biteScoreClaim: "available",
    ownerPreparedValidation,
    claimPreparedValidation: {state: "absent", inviteId: null},
    nowMillis: now.getTime(),
  }).i, "prepared");

  await updateAdminRestaurantQrPreparation(
    data,
    mutation("I", true, {expectedInviteId: "invite-a"}),
    now,
  );
  assert.equal(prepRecord(data).iLatestInviteId, "invite-b");
  assert.equal(prepRecord(data).iPreparedInviteId, "invite-a");

  await updateAdminRestaurantQrPreparation(
    data,
    mutation("I", true, {expectedInviteId: "invite-b"}),
    now,
  );
  assert.equal(prepRecord(data).iPreparedInviteId, "invite-b");
});

test("prepared I projection rejects every invalid authoritative invitation shape", () => {
  const rawPreparation = {
    schemaVersion: 1,
    iPreparedInviteId: "invite-1",
    iPreparedInviteExpiresAt: future,
  };
  const restaurantData = {isActive: true};
  const status = (invitation) => {
    const ownerPreparedValidation =
      validateAdminRestaurantQrPreparedOwnerAssociation({
        catalogRestaurantId: "restaurant-1",
        rawPreparation,
        restaurantData,
        invitation,
        nowMillis: now.getTime(),
      });
    return projectAdminRestaurantQrPreparation({
      catalogRestaurantId: "restaurant-1",
      rawPreparation,
      biteSaverParticipation: "unbound",
      biteScoreClaim: "available",
      ownerPreparedValidation,
      claimPreparedValidation: {state: "absent", inviteId: null},
      nowMillis: now.getTime(),
    }).i;
  };
  const valid = {id: "invite-1", data: invite("I")};
  assert.equal(status(valid), "prepared");
  assert.equal(status(null), "unprepared");
  for (const overrides of [
    {expiresAt: past},
    {status: "revoked"},
    {useCount: 1},
    {usedAt: now},
    {revokedAt: now},
    {biteScoreCatalogRestaurantId: "other"},
    {pendingRestaurantKey: "pending_other"},
    {type: "bitescore_claim_invite"},
    {side: "bitescore"},
    {expiresAt: new Date(future.getTime() + 1)},
  ]) {
    assert.equal(
      status({id: "invite-1", data: invite("I", "restaurant-1", overrides)}),
      "unprepared",
      JSON.stringify(overrides),
    );
  }
});

test("C invitation A stays valid after B becomes latest within one epoch", async () => {
  const data = database({
    "restaurant_invites/claim-a": invite("C", "restaurant-1", {
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
    }),
    "restaurant_invites/claim-b": invite("C", "restaurant-1", {
      createdAt: new Date("2026-08-02T12:00:00.000Z"),
    }),
    "private_admin_restaurant_qr_preparation/restaurant-1": {
      schemaVersion: 1,
      cLatestInviteId: "claim-a",
      cLatestInviteExpiresAt: future,
      cPreparedInviteId: "claim-a",
      cPreparedInviteExpiresAt: future,
    },
  });
  await applyPatch(data, latestInvitationPreparationPatch(
    prepRecord(data),
    "C",
    "claim-b",
    future,
  ));
  assert.equal(prepRecord(data).cLatestInviteId, "claim-b");
  assert.equal(prepRecord(data).cPreparedInviteId, "claim-a");

  await updateAdminRestaurantQrPreparation(
    data,
    mutation("C", true, {expectedInviteId: "claim-a"}),
    now,
  );
  assert.equal(prepRecord(data).cLatestInviteId, "claim-b");
  assert.equal(prepRecord(data).cPreparedInviteId, "claim-a");

  await updateAdminRestaurantQrPreparation(
    data,
    mutation("C", true, {expectedInviteId: "claim-b"}),
    now,
  );
  assert.equal(prepRecord(data).cPreparedInviteId, "claim-b");
});

test("terminal invite cleanup removes only matching latest/prepared fields", async () => {
  const raw = {
    schemaVersion: 1,
    iLatestInviteId: "invite-b",
    iLatestInviteExpiresAt: future,
    iPreparedInviteId: "invite-a",
    iPreparedInviteExpiresAt: future,
    cLatestInviteId: "claim-1",
    cLatestInviteExpiresAt: future,
    cPreparedInviteId: "claim-1",
    cPreparedInviteExpiresAt: future,
    saPrepared: true,
  };
  const preparedPatch = terminalInvitationPreparationPatch(
    raw,
    "I",
    "invite-a",
  );
  assert.deepEqual(preparedPatch.deleteFields, [
    "iPreparedInviteId",
    "iPreparedInviteExpiresAt",
  ]);
  const latestPatch = terminalInvitationPreparationPatch(raw, "I", "invite-b");
  assert.deepEqual(latestPatch.deleteFields, [
    "iLatestInviteId",
    "iLatestInviteExpiresAt",
  ]);
  const claimLatestPatch = terminalInvitationPreparationPatch(
    {
      ...raw,
      cLatestInviteId: "claim-b",
      cLatestInviteExpiresAt: future,
      cPreparedInviteId: "claim-a",
      cPreparedInviteExpiresAt: future,
    },
    "C",
    "claim-b",
  );
  assert.deepEqual(claimLatestPatch.deleteFields, [
    "cLatestInviteId",
    "cLatestInviteExpiresAt",
  ]);
  assert.equal(terminalInvitationPreparationPatch(raw, "I", "other"), null);
  assert.deepEqual(invitationPreparationIdentity("claim-1", invite("C")), {
    catalogRestaurantId: "restaurant-1",
    type: "C",
  });
});

test("N/R derives from current participation without altering stored preparation", () => {
  const raw = {
    schemaVersion: 1,
    iPreparedInviteId: "invite-1",
    iPreparedInviteExpiresAt: future,
    cPreparedInviteId: "claim-1",
    cPreparedInviteExpiresAt: future,
    saPrepared: true,
    srPrepared: true,
  };
  const projection = projectAdminRestaurantQrPreparation({
    catalogRestaurantId: "restaurant-1",
    rawPreparation: raw,
    biteSaverParticipation: "bound",
    biteScoreClaim: "claimed",
    ownerPreparedValidation: {state: "eligible", inviteId: "invite-1"},
    claimPreparedValidation: {state: "eligible", inviteId: "claim-1"},
    nowMillis: now.getTime(),
  });
  assert.deepEqual(projection, {
    canonicalCatalogRestaurantId: "restaurant-1",
    i: "notRequired",
    c: "notRequired",
    sa: "prepared",
    sr: "prepared",
  });
});

test("C projection validation distinguishes pre-epoch, fresh, and unavailable state", () => {
  const epochAt = new Date("2026-08-10T12:00:00.000Z");
  const rawPreparation = {
    schemaVersion: 1,
    cPreparedInviteId: "claim-1",
    cPreparedInviteExpiresAt: future,
  };
  const projection = (claimPreparedValidation) =>
    projectAdminRestaurantQrPreparation({
      catalogRestaurantId: "restaurant-1",
      rawPreparation,
      biteSaverParticipation: "unbound",
      biteScoreClaim: "available",
      ownerPreparedValidation: {state: "absent", inviteId: null},
      claimPreparedValidation,
      nowMillis: now.getTime(),
    }).c;
  const validation = (restaurantData, invitation) =>
    validateAdminRestaurantQrPreparedClaimAssociation({
      catalogRestaurantId: "restaurant-1",
      rawPreparation,
      restaurantData,
      invitation,
      nowMillis: now.getTime(),
    });
  const oldInvitation = {
    id: "claim-1",
    data: invite("C", "restaurant-1", {createdAt: past}),
  };
  const freshInvitation = {
    id: "claim-1",
    data: invite("C", "restaurant-1", {
      createdAt: new Date("2026-08-10T12:00:00.001Z"),
    }),
  };
  const epochRestaurant = restaurant({claimInvitationEpochAt: epochAt});

  const preEpoch = validation(epochRestaurant, oldInvitation);
  assert.deepEqual(preEpoch, {state: "ineligible", inviteId: "claim-1"});
  assert.equal(projection(preEpoch), "unprepared");

  const missing = validation(epochRestaurant, null);
  assert.deepEqual(missing, {state: "ineligible", inviteId: "claim-1"});
  assert.equal(projection(missing), "unprepared");

  const mismatched = validation(epochRestaurant, {
    id: "other-claim",
    data: freshInvitation.data,
  });
  assert.deepEqual(mismatched, {
    state: "ineligible",
    inviteId: "claim-1",
  });
  assert.equal(projection(mismatched), "unprepared");

  const fresh = validation(epochRestaurant, freshInvitation);
  assert.deepEqual(fresh, {state: "eligible", inviteId: "claim-1"});
  assert.equal(projection(fresh), "prepared");

  const malformedEpoch = validation(
    restaurant({claimInvitationEpochAt: "invalid"}),
    freshInvitation,
  );
  assert.deepEqual(malformedEpoch, {
    state: "unavailable",
    inviteId: "claim-1",
  });
  assert.equal(projection(malformedEpoch), "unavailable");
});

test("unrelated mutations project surviving C preparation against its epoch", async () => {
  const epochAt = new Date("2026-08-10T12:00:00.000Z");
  const basePreparation = {
    schemaVersion: 1,
    cPreparedInviteId: "claim-1",
    cPreparedInviteExpiresAt: future,
    srPrepared: true,
  };
  const oldData = database({
    "bitescore_restaurants/restaurant-1": restaurant({
      claimInvitationEpochAt: epochAt,
    }),
    "restaurant_invites/claim-1": invite("C", "restaurant-1", {
      createdAt: past,
    }),
    "private_admin_restaurant_qr_preparation/restaurant-1": basePreparation,
  });
  const oldResult = await updateAdminRestaurantQrPreparation(
    oldData,
    mutation("SA", true),
    now,
  );
  assert.equal(oldResult.c, "unprepared");
  assert.equal(oldResult.sa, "prepared");
  assert.equal(prepRecord(oldData).cPreparedInviteId, "claim-1");
  assert.equal(prepRecord(oldData).srPrepared, true);

  const freshData = database({
    "bitescore_restaurants/restaurant-1": restaurant({
      claimInvitationEpochAt: epochAt,
    }),
    "restaurant_invites/claim-1": invite("C", "restaurant-1", {
      createdAt: new Date("2026-08-10T12:00:00.001Z"),
    }),
    "private_admin_restaurant_qr_preparation/restaurant-1": basePreparation,
  });
  const freshResult = await updateAdminRestaurantQrPreparation(
    freshData,
    mutation("SA", true),
    now,
  );
  assert.equal(freshResult.c, "prepared");
  assert.equal(freshResult.sa, "prepared");
  assert.equal(prepRecord(freshData).cPreparedInviteId, "claim-1");

  const malformedEpoch = database({
    "bitescore_restaurants/restaurant-1": restaurant({
      claimInvitationEpochAt: "invalid",
    }),
    "restaurant_invites/claim-1": invite("C"),
    "private_admin_restaurant_qr_preparation/restaurant-1": basePreparation,
  });
  await assert.rejects(
    updateAdminRestaurantQrPreparation(
      malformedEpoch,
      mutation("SA", true),
      now,
    ),
    (error) => error.code === "failed-precondition",
  );
  assert.deepEqual(prepRecord(malformedEpoch), basePreparation);
});

test("safe unclaim detection is activity-independent and requires a valid epoch", () => {
  const hiddenClaimed = restaurant({
    isActive: false,
    isClaimed: true,
    ownerUserId: "owner-1",
  });
  const hiddenUnclaimed = restaurant({
    isActive: false,
    claimInvitationEpochAt: now,
  });
  assert.equal(
    isSafeBiteScoreUnclaimTransition(hiddenClaimed, hiddenUnclaimed),
    true,
  );
  assert.equal(
    isSafeBiteScoreUnclaimTransition(hiddenClaimed, restaurant({
      isActive: false,
    })),
    false,
  );
  assert.equal(
    isSafeBiteScoreUnclaimTransition(hiddenClaimed, restaurant({
      isActive: false,
      claimInvitationEpochAt: "invalid",
    })),
    false,
  );
  assert.equal(
    isSafeBiteScoreUnclaimTransition(
      restaurant({isActive: false}),
      hiddenUnclaimed,
    ),
    false,
  );
});

test("hidden safe unclaim clears old C state before a later restore", async () => {
  const data = database({
    "private_admin_restaurant_qr_preparation/restaurant-1": {
      schemaVersion: 1,
      cLatestInviteId: "claim-old",
      cLatestInviteExpiresAt: future,
      cPreparedInviteId: "claim-old",
      cPreparedInviteExpiresAt: future,
      saPrepared: true,
    },
  });
  const cleared = await clearClaimPreparationAfterUnclaim(
    data,
    "restaurant-1",
    restaurant({
      isActive: false,
      isClaimed: true,
      ownerUserId: "owner-1",
    }),
    restaurant({
      isActive: false,
      claimInvitationEpochAt: now,
    }),
    now,
  );
  assert.equal(cleared, true);
  assert.equal(prepRecord(data).cLatestInviteId, undefined);
  assert.equal(prepRecord(data).cPreparedInviteId, undefined);
  assert.equal(prepRecord(data).saPrepared, true);
});

test("safe unclaim clears C latest/prepared state and preserves I/SA/SR", async () => {
  const data = database({
    "private_admin_restaurant_qr_preparation/restaurant-1": {
      schemaVersion: 1,
      iPreparedInviteId: "invite-1",
      iPreparedInviteExpiresAt: future,
      cLatestInviteId: "claim-1",
      cLatestInviteExpiresAt: future,
      cPreparedInviteId: "claim-1",
      cPreparedInviteExpiresAt: future,
      saPrepared: true,
      srPrepared: true,
    },
  });
  const cleared = await clearClaimPreparationAfterUnclaim(
    data,
    "restaurant-1",
    restaurant({isClaimed: true, ownerUserId: "owner-1"}),
    restaurant({claimInvitationEpochAt: now}),
    now,
  );
  assert.equal(cleared, true);
  const stored = prepRecord(data);
  assert.equal(Object.hasOwn(stored, "cLatestInviteId"), false);
  assert.equal(Object.hasOwn(stored, "cPreparedInviteId"), false);
  assert.equal(stored.iPreparedInviteId, "invite-1");
  assert.equal(stored.saPrepared, true);
  assert.equal(stored.srPrepared, true);
});

test("delayed unclaim cleanup preserves a fresh post-transition C cycle", async () => {
  const data = database({
    "private_admin_restaurant_qr_preparation/restaurant-1": {
      schemaVersion: 1,
      cLatestInviteId: "claim-fresh",
      cLatestInviteExpiresAt: future,
      cPreparedInviteId: "claim-fresh",
      cPreparedInviteExpiresAt: future,
    },
    "restaurant_invites/claim-fresh": invite("C", "restaurant-1", {
      createdAt: future,
    }),
  });

  const cleared = await clearClaimPreparationAfterUnclaim(
    data,
    "restaurant-1",
    restaurant({isClaimed: true, ownerUserId: "owner-1"}),
    restaurant({claimInvitationEpochAt: now}),
    now,
  );

  assert.equal(cleared, false);
  assert.equal(prepRecord(data).cLatestInviteId, "claim-fresh");
  assert.equal(prepRecord(data).cPreparedInviteId, "claim-fresh");
});

test("safe unclaim epoch rejects old C invites before cleanup and accepts fresh invites", async () => {
  const epochAt = new Date("2026-08-10T12:00:00.000Z");
  const oldInvite = invite("C", "restaurant-1", {
    createdAt: new Date("2026-08-10T11:59:59.999Z"),
  });
  const equalInvite = invite("C", "restaurant-1", {createdAt: epochAt});
  const freshInvite = invite("C", "restaurant-1", {
    createdAt: new Date("2026-08-10T12:00:00.001Z"),
  });
  assert.equal(biteScoreClaimInvitationEpochIsValid(restaurant()), true);
  assert.equal(biteScoreClaimInvitationEpochIsValid(
    restaurant({claimInvitationEpochAt: epochAt}),
  ), true);
  assert.equal(biteScoreClaimInvitationEpochIsValid(
    restaurant({claimInvitationEpochAt: "invalid"}),
  ), false);
  assert.equal(biteScoreClaimInvitationIsInCurrentEpoch(
    restaurant(),
    oldInvite,
  ), true);
  assert.equal(biteScoreClaimInvitationIsInCurrentEpoch(
    restaurant({claimInvitationEpochAt: "invalid"}),
    freshInvite,
  ), false);
  assert.equal(biteScoreClaimInvitationIsInCurrentEpoch(
    restaurant({claimInvitationEpochAt: epochAt}),
    oldInvite,
  ), false);
  assert.equal(biteScoreClaimInvitationIsInCurrentEpoch(
    restaurant({claimInvitationEpochAt: epochAt}),
    equalInvite,
  ), false);
  assert.equal(biteScoreClaimInvitationIsInCurrentEpoch(
    restaurant({claimInvitationEpochAt: epochAt}),
    freshInvite,
  ), true);

  const malformedEpoch = database({
    "bitescore_restaurants/restaurant-1": restaurant({
      claimInvitationEpochAt: "invalid",
    }),
    "restaurant_invites/claim-fresh": freshInvite,
  });
  await assert.rejects(
    updateAdminRestaurantQrPreparation(
      malformedEpoch,
      mutation("C", true, {expectedInviteId: "claim-fresh"}),
      now,
    ),
    (error) => error.code === "failed-precondition",
  );
  assert.equal(prepRecord(malformedEpoch), undefined);

  const data = database({
    "bitescore_restaurants/restaurant-1": restaurant({
      claimInvitationEpochAt: epochAt,
    }),
    "restaurant_invites/claim-old": oldInvite,
    "restaurant_invites/claim-fresh": freshInvite,
    "private_admin_restaurant_qr_preparation/restaurant-1": {
      schemaVersion: 1,
      cLatestInviteId: "claim-old",
      cLatestInviteExpiresAt: future,
    },
  });
  await assert.rejects(
    updateAdminRestaurantQrPreparation(
      data,
      mutation("C", true, {expectedInviteId: "claim-old"}),
      now,
    ),
    (error) => error.code === "failed-precondition",
  );
  assert.equal(prepRecord(data).cPreparedInviteId, undefined);

  await updateAdminRestaurantQrPreparation(
    data,
    mutation("C", true, {expectedInviteId: "claim-fresh"}),
    now,
  );
  assert.equal(prepRecord(data).cPreparedInviteId, "claim-fresh");
  assert.equal(
    data.documentReads.filter((path) =>
      path === "restaurant_invites/claim-fresh").length,
    1,
  );

  const cleared = await clearClaimPreparationAfterUnclaim(
    data,
    "restaurant-1",
    restaurant({isClaimed: true, ownerUserId: "owner-1"}),
    restaurant({claimInvitationEpochAt: epochAt}),
    epochAt,
  );
  assert.equal(cleared, true);
  assert.equal(prepRecord(data).cLatestInviteId, undefined);
  assert.equal(prepRecord(data).cPreparedInviteId, "claim-fresh");
});

test("bound participation makes I N/R and rejects a new I preparation mark", async () => {
  const data = database({
    "bitescore_restaurants/restaurant-1": restaurant({
      biteSaverCatalogBindingId: bindingId,
    }),
    "restaurant_accounts/owner-1": {
      biteScoreCatalogRestaurantId: "restaurant-1",
      biteSaverCatalogBindingId: bindingId,
    },
    "restaurant_invites/invite-1": invite("I"),
  });
  await assert.rejects(
    updateAdminRestaurantQrPreparation(
      data,
      mutation("I", true, {expectedInviteId: "invite-1"}),
      now,
    ),
    (error) => error.code === "failed-precondition",
  );
});

test("authoritative invitation lifecycle operations retain exact preparation wiring", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const section = (start, end) => source.slice(
    source.indexOf(start),
    source.indexOf(end),
  );
  const couponCreate = section(
    "export const createCouponRestaurantInvite",
    "export const createBiteScoreRestaurantClaimInvite",
  );
  const claimCreate = section(
    "export const createBiteScoreRestaurantClaimInvite",
    "export const revokeRestaurantInvite",
  );
  const revoke = section(
    "export const revokeRestaurantInvite",
    "export const listRestaurantInvites",
  );
  const couponRedemption = section(
    "export const redeemCouponRestaurantInvite",
    "export const redeemBiteScoreRestaurantClaimInvite",
  );
  const claimRedemption = section(
    "export const redeemBiteScoreRestaurantClaimInvite",
    "function writtenReviewWordCount",
  );

  assert.match(
    couponCreate,
    /latestInvitationPreparationPatch\([\s\S]*?"I"/u,
  );
  assert.match(
    claimCreate,
    /latestInvitationPreparationPatch\([\s\S]*?"C"/u,
  );
  assert.match(revoke, /terminalInvitationPreparationPatch\(/u);
  assert.match(couponRedemption, /terminalInvitationPreparationPatch\([\s\S]*"I"/u);
  assert.match(claimRedemption, /terminalInvitationPreparationPatch\([\s\S]*"C"/u);
  for (const creation of [couponCreate, claimCreate]) {
    assert.doesNotMatch(creation, /preparedId|PreparedInviteId/u);
  }
});
