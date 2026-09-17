"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CustomerBiteSaverContractError,
  customerBiteSaverSearchSchemaVersion,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  customerBiteSaverCouponRedemptionPath,
} = require("../lib/customer_bitesaver_customer_data_contract.js");
const {
  customerBiteSaverDeviceCouponUsagePath,
  customerBiteSaverDeviceUsageCoreInternals,
  executeCustomerBiteSaverDeviceBoundUse,
  parseCustomerBiteSaverCombinedUseRequest,
} = require("../lib/customer_bitesaver_device_usage_core.js");

const baseNowMs = Date.parse("2026-09-16T16:00:00.000Z");
const secretKey = Buffer.alloc(32, 83);
const restaurantId = `bsr_${Buffer.alloc(32, 11).toString("base64url")}`;
const offerId = `bso_${Buffer.alloc(32, 12).toString("base64url")}`;
const secondOfferId = `bso_${Buffer.alloc(32, 13).toString("base64url")}`;

class MemoryDatabase {
  constructor() {
    this.documents = new Map();
    this.writes = [];
    this.transactionRuns = 0;
    this.queue = Promise.resolve();
  }

  stored(path) {
    const data = this.documents.get(path);
    return data === undefined ? null : Object.freeze({
      id: path.slice(path.lastIndexOf("/") + 1),
      path,
      data,
    });
  }

  async getDocument(path) {
    return this.stored(path);
  }

  async getDocuments(paths) {
    return paths.map((path) => this.stored(path));
  }

  async queryDocuments() {
    throw new Error("the device-usage core does not query collections");
  }

  async runTransaction(operation) {
    const prior = this.queue;
    let release;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      this.transactionRuns += 1;
      const staged = [];
      const result = await operation({
        getDocument: async (path) => this.stored(path),
        getDocuments: async (paths) => paths.map((path) => this.stored(path)),
        createDocument: (path, data) => staged.push({type: "create", path, data}),
        setDocument: (path, data) => staged.push({type: "set", path, data}),
        deleteDocument: (path) => staged.push({type: "delete", path}),
      });
      for (const write of staged) {
        if (write.type === "create" && this.documents.has(write.path)) {
          throw new Error(`document already exists: ${write.path}`);
        }
        if (write.type === "delete") this.documents.delete(write.path);
        else this.documents.set(write.path, write.data);
      }
      this.writes.push(...staged);
      return result;
    } finally {
      release();
    }
  }

  async commitWrites() {
    throw new Error("not used by the device-usage core");
  }
}

function rawRequest({
  logicalRequestId = "device-use-request-0001",
  selectedOfferId = offerId,
  origin = "discovery",
  currentCoordinates = null,
} = {}) {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    logicalRequestId,
    restaurantId,
    offerId: selectedOfferId,
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    currentCoordinates,
    origin: origin === "saved"
      ? {kind: "saved", accessToken: "synthetic-saved-authority-token"}
      : {
          kind: "discovery",
          clientInstanceId: "device-core-client-0001",
          sessionId: `bss_${Buffer.alloc(32, 15).toString("base64url")}`,
          capability: "synthetic-discovery-capability",
          criteriaFingerprint: "c".repeat(64),
          offerOccurrence: "synthetic-delivered-offer-occurrence",
          guestStateRevision: 7,
        },
  };
}

function usageRecords(database, role) {
  return [...database.documents.entries()].filter(([, data]) =>
    data.role === role);
}

function context(database, clock, {
  userId = null,
  deviceSubject = "app-device-subject-a",
  evidenceState = "verified",
  evidenceOverrides = {},
  randomByte = 31,
} = {}) {
  return {
    database,
    discoveryKey: secretKey,
    identity: {authUid: userId, authIsAnonymous: false},
    now: () => clock.value,
    randomSource: (size) => Buffer.alloc(size, randomByte),
    deviceEvidenceVerifier: {
      async verify(input) {
        if (evidenceState !== "verified") return {state: evidenceState};
        return {
          state: "verified",
          deviceSubject,
          requestFingerprint: input.requestFingerprint,
          authenticatedUserId: userId,
          validFromMillis: clock.value - 1_000,
          validUntilMillis: clock.value + 60_000,
          ...evidenceOverrides,
        };
      },
    },
  };
}

function authority({
  usagePolicy = "oncePerCustomer",
  offer = {},
  recoveryExpiresAtMillis = baseNowMs + 24 * 60 * 60_000,
  deniedReason = null,
  onPrepare = null,
} = {}) {
  return async (request, operationContext) => {
    onPrepare?.();
    const signedUserId = operationContext.identity.authUid === null ||
        operationContext.identity.authIsAnonymous
      ? null
      : operationContext.identity.authUid;
    return Object.freeze({
      origin: request.origin.kind,
      signedUserId,
      async readInTransaction() {
        if (deniedReason !== null) {
          return Object.freeze({
            kind: "denied",
            origin: request.origin.kind,
            signedUserId,
            restaurantId: request.restaurantId,
            offerId: request.offerId,
            freshUseExpiresAtMillis: recoveryExpiresAtMillis,
            recoveryExpiresAtMillis,
            reason: deniedReason,
          });
        }
        return Object.freeze({
          kind: "authorized",
          origin: request.origin.kind,
          signedUserId,
          restaurantId: request.restaurantId,
          offerId: request.offerId,
          freshUseExpiresAtMillis: recoveryExpiresAtMillis,
          recoveryExpiresAtMillis,
          source: Object.freeze({
            offer: Object.freeze({
              isActive: true,
              active: true,
              usageRule: usagePolicy === "oncePerCustomer"
                ? "Once per customer"
                : usagePolicy === "oncePerDay"
                  ? "Once per day"
                  : usagePolicy === "unlimited"
                    ? "Unlimited"
                    : "Reusable after timer",
              isProximityOnly: false,
              ...offer,
            }),
            usagePolicy,
            timeZone: request.timeZone,
            utcOffsetMinutes: request.utcOffsetMinutes,
            locationMode: "current",
            restaurantCoordinates: {latitude: 28.5383, longitude: -81.3792},
            currentCoordinates: request.currentCoordinates,
          }),
        });
      },
    });
  };
}

function contractError(code) {
  return (error) => error instanceof CustomerBiteSaverContractError &&
    error.code === code;
}

test("guest, account switching, cross-device use, and distinct coupons share only the required scopes", async () => {
  const database = new MemoryDatabase();
  const clock = {value: baseNowMs};
  const guestRequest = parseCustomerBiteSaverCombinedUseRequest(rawRequest());
  const guest = await executeCustomerBiteSaverDeviceBoundUse(
    guestRequest,
    context(database, clock),
    authority(),
  );
  assert.equal(guest.status, "started");
  assert.equal(usageRecords(database, "deviceCouponUsage").length, 1);
  assert.equal(usageRecords(database, "deviceUseOutcomeReceipt").length, 1);

  const accountA = "device-core-account-a";
  const signedRequest = parseCustomerBiteSaverCombinedUseRequest(rawRequest({
    logicalRequestId: "device-use-request-0002",
    origin: "saved",
  }));
  const signed = await executeCustomerBiteSaverDeviceBoundUse(
    signedRequest,
    context(database, clock, {userId: accountA}),
    authority(),
  );
  assert.equal(signed.status, "active");
  assert.equal(signed.redemptionId, guest.redemptionId);
  assert.equal(signed.timerStartedAtMillis, guest.timerStartedAtMillis);
  assert.notEqual(
    database.stored(customerBiteSaverCouponRedemptionPath(accountA, offerId)),
    null,
  );

  const accountB = "device-core-account-b";
  const switched = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-use-request-0003",
      origin: "saved",
    })),
    context(database, clock, {userId: accountB}),
    authority(),
  );
  assert.equal(switched.status, "active");
  assert.equal(switched.redemptionId, guest.redemptionId);
  assert.notEqual(
    database.stored(customerBiteSaverCouponRedemptionPath(accountB, offerId)),
    null,
  );

  const secondDevice = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-use-request-0004",
      origin: "saved",
    })),
    context(database, clock, {
      userId: accountA,
      deviceSubject: "app-device-subject-b",
    }),
    authority(),
  );
  assert.equal(secondDevice.status, "active");
  assert.equal(secondDevice.redemptionId, guest.redemptionId);
  assert.equal(usageRecords(database, "deviceCouponUsage").length, 2);

  const distinct = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-use-request-0005",
      selectedOfferId: secondOfferId,
      origin: "saved",
    })),
    context(database, clock, {userId: accountA, randomByte: 32}),
    authority(),
  );
  assert.equal(distinct.status, "started");
  assert.notEqual(distinct.redemptionId, guest.redemptionId);
});

test("exact outcome replay precedes fresh authority and freezes original timer across reset", async () => {
  const database = new MemoryDatabase();
  const clock = {value: baseNowMs};
  const request = parseCustomerBiteSaverCombinedUseRequest(rawRequest({
    logicalRequestId: "device-use-replay-0001",
    origin: "saved",
  }));
  let prepares = 0;
  const first = await executeCustomerBiteSaverDeviceBoundUse(
    request,
    context(database, clock, {userId: "replay-account"}),
    authority({usagePolicy: "oncePerDay", onPrepare: () => prepares += 1}),
  );
  assert.equal(first.status, "started");
  clock.value += 13 * 60 * 60_000;
  const exact = await executeCustomerBiteSaverDeviceBoundUse(
    request,
    context(database, clock, {userId: "replay-account"}),
    async () => {
      throw new Error("fresh projection/favorite/source must not be read");
    },
  );
  assert.deepEqual(exact, first);
  assert.equal(prepares, 1);

  await assert.rejects(
    executeCustomerBiteSaverDeviceBoundUse(
      parseCustomerBiteSaverCombinedUseRequest({
        ...rawRequest({
          logicalRequestId: "device-use-replay-0001",
          origin: "saved",
        }),
        timeZone: "America/Chicago",
        utcOffsetMinutes: -300,
      }),
      context(database, clock, {userId: "replay-account"}),
      authority(),
    ),
    contractError("failed-precondition"),
  );
});

test("active and used scope reconciliation preserves the original anchors", async () => {
  const database = new MemoryDatabase();
  const clock = {value: baseNowMs};
  const userId = "reconcile-account";
  const first = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-reconcile-0001",
      origin: "saved",
    })),
    context(database, clock, {userId}),
    authority(),
  );
  const binding = customerBiteSaverDeviceUsageCoreInternals.deviceBinding(
    secretKey,
    "app-device-subject-a",
  );
  const devicePath = customerBiteSaverDeviceCouponUsagePath({
    secretKey,
    deviceBinding: binding,
    offerId,
  });
  const originalDevice = database.documents.get(devicePath);
  database.documents.delete(customerBiteSaverCouponRedemptionPath(userId, offerId));
  const active = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-reconcile-0002",
      origin: "saved",
    })),
    context(database, clock, {userId}),
    authority(),
  );
  assert.equal(active.status, "active");
  assert.equal(active.redemptionId, first.redemptionId);
  const reconciledAccount = database.documents.get(
    customerBiteSaverCouponRedemptionPath(userId, offerId),
  );
  assert.equal(reconciledAccount.redemptionId, originalDevice.redemptionId);
  assert.equal(
    reconciledAccount.timerStartedAt.getTime(),
    originalDevice.timerStartedAt.getTime(),
  );

  clock.value = first.timerExpiresAtMillis;
  database.documents.delete(customerBiteSaverCouponRedemptionPath(userId, offerId));
  const denied = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-reconcile-0003",
      origin: "saved",
    })),
    context(database, clock, {userId}),
    authority(),
  );
  assert.equal(denied.status, "denied");
  assert.equal(denied.reason, "used");
  assert.equal(
    database.documents.get(
      customerBiteSaverCouponRedemptionPath(userId, offerId),
    ).redemptionId,
    first.redemptionId,
  );
});

test("current-device activity continues but a used current device cannot borrow an account timer", async () => {
  const database = new MemoryDatabase();
  const clock = {value: baseNowMs};
  const userId = "same-phone-policy-account";
  const phoneX = "same-phone-policy-device-x";
  const phoneY = "same-phone-policy-device-y";
  const accountPath = (selectedOfferId) =>
    customerBiteSaverCouponRedemptionPath(userId, selectedOfferId);
  const devicePath = (deviceSubject, selectedOfferId) =>
    customerBiteSaverDeviceCouponUsagePath({
      secretKey,
      deviceBinding:
        customerBiteSaverDeviceUsageCoreInternals.deviceBinding(
          secretKey,
          deviceSubject,
        ),
      offerId: selectedOfferId,
    });
  const use = ({
    logicalRequestId,
    selectedOfferId = offerId,
    deviceSubject,
    signed = true,
  }) => executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId,
      selectedOfferId,
      origin: signed ? "saved" : "discovery",
    })),
    context(database, clock, {
      userId: signed ? userId : null,
      deviceSubject,
    }),
    authority(),
  );

  const accountUse = await use({
    logicalRequestId: "same-phone-account-first-0001",
    deviceSubject: phoneX,
  });
  assert.equal(accountUse.status, "started");
  clock.value = accountUse.timerExpiresAtMillis;

  const currentPhoneUse = await use({
    logicalRequestId: "same-phone-guest-current-0001",
    deviceSubject: phoneY,
    signed: false,
  });
  assert.equal(currentPhoneUse.status, "started");
  const accountBeforeContinuation = database.documents.get(accountPath(offerId));
  const deviceBeforeContinuation = database.documents.get(
    devicePath(phoneY, offerId),
  );
  const writesBeforeContinuation = database.writes.length;
  const continuationRequest = {
    logicalRequestId: "same-phone-continuation-0001",
    deviceSubject: phoneY,
  };
  const continuation = await use(continuationRequest);
  assert.equal(continuation.status, "active");
  assert.equal(continuation.redemptionId, currentPhoneUse.redemptionId);
  assert.equal(
    continuation.timerStartedAtMillis,
    currentPhoneUse.timerStartedAtMillis,
  );
  assert.equal(
    continuation.timerExpiresAtMillis,
    currentPhoneUse.timerExpiresAtMillis,
  );
  assert.strictEqual(
    database.documents.get(accountPath(offerId)),
    accountBeforeContinuation,
  );
  assert.strictEqual(
    database.documents.get(devicePath(phoneY, offerId)),
    deviceBeforeContinuation,
  );
  assert.equal(database.writes.length - writesBeforeContinuation, 1);

  const writesBeforeContinuationReplay = database.writes.length;
  assert.deepEqual(await use(continuationRequest), continuation);
  assert.equal(database.writes.length, writesBeforeContinuationReplay);

  const currentPhoneSecondOffer = await use({
    logicalRequestId: "same-phone-reverse-guest-0001",
    selectedOfferId: secondOfferId,
    deviceSubject: phoneY,
    signed: false,
  });
  assert.equal(currentPhoneSecondOffer.status, "started");
  clock.value = currentPhoneSecondOffer.timerExpiresAtMillis;

  const writesBeforeExpiredContinuationReplay = database.writes.length;
  const expiredContinuationReplay = await use(continuationRequest);
  assert.deepEqual(expiredContinuationReplay, continuation);
  assert.equal(
    expiredContinuationReplay.timerExpiresAtMillis <= clock.value,
    true,
  );
  assert.equal(database.writes.length, writesBeforeExpiredContinuationReplay);

  const afterCurrentTimer = await use({
    logicalRequestId: "same-phone-after-deadline-0001",
    deviceSubject: phoneY,
  });
  assert.equal(afterCurrentTimer.status, "denied");
  assert.equal(afterCurrentTimer.reason, "used");

  const remoteAccountTimer = await use({
    logicalRequestId: "same-phone-reverse-account-0001",
    selectedOfferId: secondOfferId,
    deviceSubject: phoneX,
  });
  assert.equal(remoteAccountTimer.status, "started");
  const accountBeforeReverse = database.documents.get(accountPath(secondOfferId));
  const deviceBeforeReverse = database.documents.get(
    devicePath(phoneY, secondOfferId),
  );
  const writesBeforeReverse = database.writes.length;
  const reverseRequest = {
    logicalRequestId: "same-phone-reverse-current-0001",
    selectedOfferId: secondOfferId,
    deviceSubject: phoneY,
  };
  const reverse = await use(reverseRequest);
  assert.equal(reverse.status, "denied");
  assert.equal(reverse.reason, "used");
  assert.strictEqual(
    database.documents.get(accountPath(secondOfferId)),
    accountBeforeReverse,
  );
  assert.strictEqual(
    database.documents.get(devicePath(phoneY, secondOfferId)),
    deviceBeforeReverse,
  );
  assert.equal(database.writes.length - writesBeforeReverse, 1);

  const writesBeforeReverseReplay = database.writes.length;
  assert.deepEqual(await use(reverseRequest), reverse);
  assert.equal(database.writes.length, writesBeforeReverseReplay);
});

test("eligible daily and reusable device history does not become a permanent block", async () => {
  for (const [usagePolicy, eligibleAtMillis] of [
    ["reusableAfterTimer", baseNowMs + 5 * 60_000],
    ["oncePerDay", Date.parse("2026-09-17T04:01:00.000Z")],
  ]) {
    const database = new MemoryDatabase();
    const clock = {value: baseNowMs};
    const userId = `eligible-${usagePolicy}-account`;
    const deviceY = `eligible-${usagePolicy}-device-y`;
    const operationAuthority = authority({
      usagePolicy,
      recoveryExpiresAtMillis: baseNowMs + 48 * 60 * 60_000,
    });
    const use = (logicalRequestId, deviceSubject, signed) =>
      executeCustomerBiteSaverDeviceBoundUse(
        parseCustomerBiteSaverCombinedUseRequest(rawRequest({
          logicalRequestId,
          origin: signed ? "saved" : "discovery",
        })),
        context(database, clock, {
          userId: signed ? userId : null,
          deviceSubject,
        }),
        operationAuthority,
      );
    const deviceUse = await use(
      `eligible-${usagePolicy}-device-0001`,
      deviceY,
      false,
    );
    assert.equal(deviceUse.status, "started", usagePolicy);
    clock.value = eligibleAtMillis;
    const accountUse = await use(
      `eligible-${usagePolicy}-account-0001`,
      `eligible-${usagePolicy}-device-x`,
      true,
    );
    assert.equal(accountUse.status, "started", usagePolicy);
    const combined = await use(
      `eligible-${usagePolicy}-combined-0001`,
      deviceY,
      true,
    );
    assert.equal(combined.status, "active", usagePolicy);
    assert.equal(combined.redemptionId, accountUse.redemptionId, usagePolicy);
    assert.equal(
      combined.timerExpiresAtMillis,
      accountUse.timerExpiresAtMillis,
      usagePolicy,
    );
  }
});

test("concurrent guest and signed operations consume one device allowance", async () => {
  const database = new MemoryDatabase();
  const clock = {value: baseNowMs};
  const guestRequest = parseCustomerBiteSaverCombinedUseRequest(rawRequest({
    logicalRequestId: "device-race-guest-0001",
  }));
  const signedRequest = parseCustomerBiteSaverCombinedUseRequest(rawRequest({
    logicalRequestId: "device-race-signed-0001",
    origin: "saved",
  }));
  const [guest, signed] = await Promise.all([
    executeCustomerBiteSaverDeviceBoundUse(
      guestRequest,
      context(database, clock, {randomByte: 41}),
      authority(),
    ),
    executeCustomerBiteSaverDeviceBoundUse(
      signedRequest,
      context(database, clock, {userId: "race-account", randomByte: 42}),
      authority(),
    ),
  ]);
  assert.deepEqual([guest.status, signed.status].sort(), ["active", "started"]);
  assert.equal(guest.redemptionId, signed.redemptionId);
  assert.equal(usageRecords(database, "deviceCouponUsage").length, 1);
  assert.notEqual(
    database.stored(customerBiteSaverCouponRedemptionPath("race-account", offerId)),
    null,
  );
});

test("unlimited, source denials, malformed usage, and proof failures fail closed", async () => {
  const unlimitedDatabase = new MemoryDatabase();
  const clock = {value: baseNowMs};
  const unlimited = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-unlimited-0001",
      origin: "saved",
    })),
    context(unlimitedDatabase, clock, {userId: "unlimited-account"}),
    authority({usagePolicy: "unlimited"}),
  );
  assert.equal(unlimited.status, "unlimited");
  assert.equal(usageRecords(unlimitedDatabase, "deviceCouponUsage").length, 0);
  assert.equal(
    unlimitedDatabase.stored(customerBiteSaverCouponRedemptionPath(
      "unlimited-account",
      offerId,
    )),
    null,
  );

  const deniedDatabase = new MemoryDatabase();
  const denied = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-source-denied-0001",
    })),
    context(deniedDatabase, clock),
    authority({deniedReason: "offerUnavailable"}),
  );
  assert.equal(denied.status, "denied");
  assert.equal(usageRecords(deniedDatabase, "deviceCouponUsage").length, 0);

  const proximityDatabase = new MemoryDatabase();
  const proximity = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-proximity-denied-0001",
    })),
    context(proximityDatabase, clock),
    authority({offer: {isProximityOnly: true, proximityRadiusMiles: 1}}),
  );
  assert.equal(proximity.status, "denied");
  assert.equal(proximity.reason, "missingFreshLocation");

  const outsideDatabase = new MemoryDatabase();
  const outside = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-proximity-outside-0001",
      currentCoordinates: {
        latitude: 40.7128,
        longitude: -74.0060,
        capturedAtMillis: clock.value,
      },
    })),
    context(outsideDatabase, clock),
    authority({offer: {isProximityOnly: true, proximityRadiusMiles: 1}}),
  );
  assert.equal(outside.status, "denied");
  assert.equal(outside.reason, "outsideProximity");

  const expiredDatabase = new MemoryDatabase();
  const expired = await executeCustomerBiteSaverDeviceBoundUse(
    parseCustomerBiteSaverCombinedUseRequest(rawRequest({
      logicalRequestId: "device-source-expired-0001",
    })),
    context(expiredDatabase, clock),
    authority({offer: {endTime: new Date(clock.value - 1)}}),
  );
  assert.equal(expired.status, "denied");
  assert.equal(expired.reason, "expired");
  assert.equal(usageRecords(expiredDatabase, "deviceCouponUsage").length, 0);

  const malformedDatabase = new MemoryDatabase();
  const malformedBinding = customerBiteSaverDeviceUsageCoreInternals.deviceBinding(
    secretKey,
    "app-device-subject-a",
  );
  malformedDatabase.documents.set(customerBiteSaverDeviceCouponUsagePath({
    secretKey,
    deviceBinding: malformedBinding,
    offerId,
  }), {role: "deviceCouponUsage", malformed: true});
  await assert.rejects(
    executeCustomerBiteSaverDeviceBoundUse(
      parseCustomerBiteSaverCombinedUseRequest(rawRequest({
        logicalRequestId: "device-malformed-usage-0001",
      })),
      context(malformedDatabase, clock),
      authority(),
    ),
    contractError("failed-precondition"),
  );
  assert.equal(malformedDatabase.writes.length, 0);

  for (const [label, options, expectedCode] of [
    ["missing", null, "failed-precondition"],
    ["unavailable", {evidenceState: "unavailable"}, "unavailable"],
    ["invalid", {evidenceState: "invalid"}, "permission-denied"],
    ["mismatched", {
      evidenceOverrides: {requestFingerprint: "f".repeat(64)},
    }, "permission-denied"],
    ["expired", {
      evidenceOverrides: {validUntilMillis: baseNowMs},
    }, "permission-denied"],
  ]) {
    const proofDatabase = new MemoryDatabase();
    const proofContext = options === null
      ? {
          database: proofDatabase,
          discoveryKey: secretKey,
          identity: {authUid: null, authIsAnonymous: false},
          now: () => clock.value,
        }
      : context(proofDatabase, clock, options);
    await assert.rejects(
      executeCustomerBiteSaverDeviceBoundUse(
        parseCustomerBiteSaverCombinedUseRequest(rawRequest({
          logicalRequestId: `device-proof-${label}-0001`,
        })),
        proofContext,
        authority(),
      ),
      contractError(expectedCode),
      label,
    );
    assert.equal(proofDatabase.documents.size, 0, label);
    assert.equal(proofDatabase.writes.length, 0, label);
  }
});
