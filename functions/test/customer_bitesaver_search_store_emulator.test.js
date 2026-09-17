"use strict";

const assert = require("node:assert/strict");
const {randomBytes} = require("node:crypto");
const test = require("node:test");

const emulatorGate = process.env.BITESAVER_FIRESTORE_EMULATOR_TEST === "1";

function requireSafeEmulatorConfiguration() {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const gcloudProject = process.env.GCLOUD_PROJECT ?? "";
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT ?? "";
  if (gcloudProject && googleCloudProject &&
      gcloudProject !== googleCloudProject) {
    throw new Error(
      "The BiteSaver adapter emulator gate refuses conflicting project IDs.",
    );
  }
  const projectId = gcloudProject || googleCloudProject;
  const hostMatch = /^(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/u.exec(host) ??
    /^\[::1\]:([1-9][0-9]{0,4})$/u.exec(host);
  const port = hostMatch === null ? NaN : Number(hostMatch[1]);
  if (hostMatch === null || port > 65_535) {
    throw new Error(
      "The BiteSaver adapter emulator gate requires an explicit loopback " +
      "FIRESTORE_EMULATOR_HOST.",
    );
  }
  if (!/^demo-bs-adapter-[a-z0-9-]+$/u.test(projectId)) {
    throw new Error(
      "The BiteSaver adapter emulator gate requires a dedicated " +
      "demo-bs-adapter-* project.",
    );
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "The BiteSaver adapter emulator gate refuses application-default " +
      "credential files.",
    );
  }
  return Object.freeze({host, projectId});
}

if (!emulatorGate) {
  test(
    "real Firestore BiteSaver adapter integration requires the explicit emulator gate",
    {skip: "set BITESAVER_FIRESTORE_EMULATOR_TEST=1 and use emulators:exec"},
    () => {},
  );
} else {
  // Safety is checked before Firebase app initialization. There is deliberately
  // no credential or non-emulator fallback in this file.
  const safety = requireSafeEmulatorConfiguration();
  const {deleteApp, initializeApp} = require("firebase-admin/app");
  const {getFirestore} = require("firebase-admin/firestore");
  const {
    CustomerBiteSaverContractError,
    customerBiteSaverGuestCheckMaximumCandidateIds,
    customerBiteSaverMaximumConcurrentOperations,
    customerBiteSaverMaximumWritesPerCommit,
    customerBiteSaverPageSize,
    customerBiteSaverPreviewCandidateRetentionLimit,
    customerBiteSaverRangesPerWorker,
    customerBiteSaverSearchProtocolVersion,
    customerBiteSaverSearchSchemaVersion,
    customerBiteSaverWorkerSourceLimit,
    privateCustomerBiteSaverCandidateCollection,
    privateCustomerBiteSaverGuestOfferCheckCollection,
    privateCustomerBiteSaverJobCollection,
    privateCustomerBiteSaverResultCollection,
    privateCustomerBiteSaverSearchSessionCollection,
  } = require("../lib/customer_bitesaver_search_contract.js");
  const {
    customerBiteSaverOpaqueOfferId,
    customerBiteSaverOpaqueRestaurantId,
  } = require("../lib/customer_bitesaver_public_identity.js");
  const {
    customerBiteSaverCandidatePrefix,
    customerBiteSaverMenuPageSize,
    customerBiteSaverOrderedResultQuery,
    customerBiteSaverResultDocumentId,
    continueCustomerBiteSaverGuestOfferCheckHandler,
    getCustomerBiteSaverFavoriteStatesHandler,
    getCustomerBiteSaverMenuPageHandler,
    getCustomerBiteSaverOfferPageHandler,
    getCustomerBiteSaverSearchPageHandler,
    getCustomerBiteSaverSearchStatusHandler,
    startCustomerBiteSaverSearchHandler,
    startCustomerBiteSaverOfferRedemptionHandler,
    validateCustomerBiteSaverOfferRedemptionStartHandler,
    customerBiteSaverSessionInternals,
  } = require("../lib/customer_bitesaver_search_session.js");
  const {
    createFirestoreCustomerBiteSaverSearchDatabase,
  } = require("../lib/customer_bitesaver_search_store.js");
  const {
    getCustomerBiteSaverSavedMenuPageHandler,
    getCustomerBiteSaverSavedPageHandler,
    startCustomerBiteSaverSavedOfferRedemptionHandler,
    validateCustomerBiteSaverSavedOfferRedemptionStartHandler,
  } = require("../lib/customer_bitesaver_saved.js");
  const {
    createCustomerBiteSaverWorkerCounters,
    customerBiteSaverMaximumCandidateDocumentBytes,
    customerBiteSaverMaximumIndexedOrderKeyBytes,
    customerBiteSaverMaximumResultDocumentBytes,
    customerBiteSaverWorkerPreviewSummaryLimit,
    processCustomerBiteSaverSearchJob,
  } = require("../lib/customer_bitesaver_search_worker.js");
  const {
    buildBiteSaverCouponOfferIndex,
    buildBiteSaverDailySpecialOfferIndex,
    buildBiteSaverRestaurantIndex,
  } = require("../lib/search_index_builders.js");
  const {
    biteSaverOfferIndexCollection,
    restaurantSearchIndexCollection,
  } = require("../lib/search_index_contract.js");
  const {
    dartUtf16FirestoreBytesCursorValue,
    dartUtf16FirestoreBytesOrderKey,
    lowercaseDisplayNameOrderKey,
  } = require("../lib/customer_bitesaver_search_matcher.js");
  const {
    canonicalRestaurantGeohash,
  } = require("../lib/restaurant_geo_helpers.js");
  const {
    customerBiteSaverDeviceCouponUsagePath,
    customerBiteSaverDeviceUsageCoreInternals,
  } = require("../lib/customer_bitesaver_device_usage_core.js");
  const {
    handleCustomerBiteSaverDeviceBoundUse,
  } = require("../lib/customer_bitesaver_device_usage_handler.js");

  const fixedNowMs = Date.parse("2026-09-10T16:00:00.000Z");
  const discoveryKey = Buffer.alloc(32, 61);
  const identityKeyV1 = Buffer.alloc(32, 67);
  const runNamespace = `bs_adapter_${Date.now().toString(36)}_${
    randomBytes(6).toString("hex")}`;
  const app = initializeApp(
    {projectId: safety.projectId},
    `bitesaver-adapter-${runNamespace}`,
  );
  const firestore = getFirestore(app);
  const realDatabase = createFirestoreCustomerBiteSaverSearchDatabase(firestore);
  const ownedPaths = new Set();
  const hooks = {
    afterGetDocument: null,
    afterTransactionGetDocuments: null,
    beforeQuery: null,
    afterTransactionCommit: null,
  };
  const metrics = {
    getDocumentCalls: 0,
    getDocumentsCalls: 0,
    pointReadRequests: 0,
    pointReadResults: 0,
    favoritePointReadRequests: 0,
    queryCalls: 0,
    queryReadResults: 0,
    transactionInvocations: 0,
    transactionAttempts: 0,
    transactionPointReadRequests: 0,
    transactionPointReadResults: 0,
    transactionWritesAttempted: 0,
    transactionWritesCommitted: 0,
    commitCalls: 0,
    commitWrites: 0,
    maximumCommitWrites: 0,
    maximumTransactionWrites: 0,
    maximumJsonWriteBytes: 0,
    maximumJsonWritePath: null,
    writesByRole: Object.create(null),
    writesByState: Object.create(null),
    scenarioMeasurements: Object.create(null),
  };

  function jsonBytes(value) {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  }

  function recordWrite(write) {
    if (write.type === "delete") return;
    const bytes = jsonBytes(write.data);
    if (bytes > metrics.maximumJsonWriteBytes) {
      metrics.maximumJsonWriteBytes = bytes;
      metrics.maximumJsonWritePath = write.path;
    }
    if (typeof write.data.role === "string") {
      metrics.writesByRole[write.data.role] =
        (metrics.writesByRole[write.data.role] ?? 0) + 1;
    }
    if (typeof write.data.state === "string") {
      metrics.writesByState[write.data.state] =
        (metrics.writesByState[write.data.state] ?? 0) + 1;
    }
  }

  function countStored(documents) {
    return documents.reduce((count, document) =>
      count + (document === null ? 0 : 1), 0);
  }

  const database = {
    async getDocument(path) {
      metrics.getDocumentCalls += 1;
      metrics.pointReadRequests += 1;
      if (/^user_profiles\/[^/]+\/favorite_(?:restaurants|coupons)\//u.test(path)) {
        metrics.favoritePointReadRequests += 1;
      }
      const result = await realDatabase.getDocument(path);
      metrics.pointReadResults += result === null ? 0 : 1;
      if (hooks.afterGetDocument !== null) {
        await hooks.afterGetDocument(path, result);
      }
      return result;
    },
    async getDocuments(paths) {
      metrics.getDocumentsCalls += 1;
      metrics.pointReadRequests += paths.length;
      metrics.favoritePointReadRequests += paths.filter((path) =>
        /^user_profiles\/[^/]+\/favorite_(?:restaurants|coupons)\//u.test(path)
      ).length;
      const result = await realDatabase.getDocuments(paths);
      metrics.pointReadResults += countStored(result);
      return result;
    },
    async queryDocuments(query) {
      metrics.queryCalls += 1;
      if (hooks.beforeQuery !== null) await hooks.beforeQuery(query);
      const result = await realDatabase.queryDocuments(query);
      metrics.queryReadResults += result.length;
      return result;
    },
    async runTransaction(operation) {
      metrics.transactionInvocations += 1;
      let committedWrites = [];
      const result = await realDatabase.runTransaction(async (transaction) => {
        metrics.transactionAttempts += 1;
        const attemptedWrites = [];
        committedWrites = attemptedWrites;
        const facade = {
          async getDocument(path) {
            metrics.transactionPointReadRequests += 1;
            if (/^user_profiles\/[^/]+\/favorite_(?:restaurants|coupons)\//u.test(path)) {
              metrics.favoritePointReadRequests += 1;
            }
            const document = await transaction.getDocument(path);
            metrics.transactionPointReadResults += document === null ? 0 : 1;
            return document;
          },
          async getDocuments(paths) {
            metrics.transactionPointReadRequests += paths.length;
            metrics.favoritePointReadRequests += paths.filter((path) =>
              /^user_profiles\/[^/]+\/favorite_(?:restaurants|coupons)\//u.test(path)
            ).length;
            const documents = await transaction.getDocuments(paths);
            metrics.transactionPointReadResults += countStored(documents);
            if (hooks.afterTransactionGetDocuments !== null) {
              await hooks.afterTransactionGetDocuments(paths, documents);
            }
            return documents;
          },
          createDocument(path, data) {
            const write = {type: "create", path, data};
            attemptedWrites.push(write);
            recordWrite(write);
            metrics.transactionWritesAttempted += 1;
            transaction.createDocument(path, data);
          },
          setDocument(path, data) {
            const write = {type: "set", path, data};
            attemptedWrites.push(write);
            recordWrite(write);
            metrics.transactionWritesAttempted += 1;
            transaction.setDocument(path, data);
          },
          deleteDocument(path) {
            const write = {type: "delete", path};
            attemptedWrites.push(write);
            recordWrite(write);
            metrics.transactionWritesAttempted += 1;
            transaction.deleteDocument(path);
          },
        };
        return operation(facade);
      });
      for (const write of committedWrites) {
        if (write.type !== "delete") ownedPaths.add(write.path);
      }
      metrics.transactionWritesCommitted += committedWrites.length;
      metrics.maximumTransactionWrites = Math.max(
        metrics.maximumTransactionWrites,
        committedWrites.length,
      );
      if (hooks.afterTransactionCommit !== null) {
        await hooks.afterTransactionCommit(result, committedWrites);
      }
      return result;
    },
    async commitWrites(writes) {
      for (const write of writes) recordWrite(write);
      await realDatabase.commitWrites(writes);
      for (const write of writes) {
        if (write.type !== "delete") ownedPaths.add(write.path);
      }
      metrics.commitCalls += 1;
      metrics.commitWrites += writes.length;
      metrics.maximumCommitWrites = Math.max(
        metrics.maximumCommitWrites,
        writes.length,
      );
    },
  };

  let requestSequence = 0;
  function requestId(label) {
    requestSequence += 1;
    return `${runNamespace}_${label}_${requestSequence.toString(36)}`.slice(0, 128);
  }

  function millis(value) {
    if (value instanceof Date) return value.getTime();
    if (value !== null && typeof value === "object") {
      if (typeof value.toMillis === "function") return value.toMillis();
      if (typeof value.toDate === "function") return value.toDate().getTime();
    }
    return NaN;
  }

  async function bounded(promise, label, timeoutMs = 20_000) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} exceeded ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return {promise, resolve, reject};
  }

  async function commitAll(writes) {
    for (let offset = 0; offset < writes.length;
      offset += customerBiteSaverMaximumWritesPerCommit) {
      await database.commitWrites(writes.slice(
        offset,
        offset + customerBiteSaverMaximumWritesPerCommit,
      ));
    }
  }

  function snapshotMetrics() {
    return Object.freeze({
      pointReads: metrics.pointReadRequests +
        metrics.transactionPointReadRequests,
      queries: metrics.queryCalls,
      queryReads: metrics.queryReadResults,
      writes: metrics.transactionWritesCommitted + metrics.commitWrites,
    });
  }

  async function seed(path, data) {
    await database.commitWrites([{type: "set", path, data}]);
  }

  function rawRestaurant(index, overrides = {}, referenceNowMs = fixedNowMs) {
    const latitude = 28.5383;
    const longitude = -81.3792;
    return {
      restaurantName: `Restaurant ${String(index).padStart(4, "0")}`,
      approvalStatus: "approved",
      couponApplicationSubmitted: true,
      subscriptionStatus: "active",
      couponPostingEnabled: true,
      streetAddress: `${index} Public Avenue`,
      city: "Orlando",
      state: "FL",
      zipCode: "32801",
      latitude,
      longitude,
      geohash: canonicalRestaurantGeohash({latitude, longitude}),
      phone: "+1 407-555-0100",
      website: "https://restaurant.example.test",
      bio: "Synthetic emulator restaurant",
      mainImageUrl: "https://images.example.test/restaurant.jpg",
      businessHours: [],
      formattedAddress: `${index} Public Avenue, Orlando, FL 32801`,
      offerCatalogUpdatedAt: new Date(referenceNowMs - 1_000),
      ...overrides,
    };
  }

  function rawCoupon(index, overrides = {}, referenceNowMs = fixedNowMs) {
    return {
      title: `Coupon ${String(index).padStart(4, "0")}`,
      restaurant: "Restaurant Alias",
      details: "Synthetic coupon",
      usageRule: "Unlimited",
      couponCode: `SAVE${index}`,
      couponNumber: index,
      isActive: true,
      active: true,
      isProximityOnly: false,
      createdAt: new Date(referenceNowMs - index * 1_000),
      updatedAt: new Date(referenceNowMs - index * 500),
      ...overrides,
    };
  }

  function rawDailySpecial(
    accountId,
    index,
    overrides = {},
    referenceNowMs = fixedNowMs,
  ) {
    return {
      restaurantId: accountId,
      ownerUid: accountId,
      title: `Daily ${String(index).padStart(4, "0")}`,
      details: "Synthetic daily special",
      isActive: true,
      availabilityMode: "specificDays",
      daysOfWeek: [4],
      allDay: true,
      hideWhenUnavailable: true,
      createdAt: new Date(referenceNowMs - index * 1_000),
      updatedAt: new Date(referenceNowMs - index * 500),
      ...overrides,
    };
  }

  function canonicalRestaurantFavorite(userId, restaurantId) {
    return {
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      favoriteKind: "bitesaverRestaurant",
      userId,
      restaurantId,
      createdAt: new Date(fixedNowMs),
      updatedAt: new Date(fixedNowMs),
    };
  }

  function canonicalCouponFavorite(userId, restaurantId, offerId) {
    return {
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      favoriteKind: "bitesaverCoupon",
      userId,
      restaurantId,
      offerId,
      offerType: "coupon",
      createdAt: new Date(fixedNowMs),
      updatedAt: new Date(fixedNowMs),
    };
  }

  function previewCandidate(projection) {
    return Object.freeze({
      offerType: projection.offerType,
      sourceDocumentId: projection.sourceDocumentId,
      indexDocumentId: projection.indexDocumentId,
      sourceCreatedAtMs: millis(projection.sourceCreatedAt),
      sourceCreatedAtOrderKey: projection.sourceCreatedAtOrderKey,
      sourceFingerprint: projection.catalogGenerationContribution,
    });
  }

  function safeRestaurantSnapshot(projection) {
    return Object.freeze({
      displayName: projection.displayName,
      streetAddress: projection.streetAddress ?? null,
      city: projection.city ?? "",
      state: projection.state ?? "",
      zipCode: projection.zipCode ?? "",
      formattedAddress: projection.formattedAddress ?? null,
      primaryImageUrl: projection.primaryImageUrl ?? null,
      phone: projection.phone ?? null,
      website: projection.website ?? null,
      businessHours: projection.businessHours ?? Object.freeze([]),
      bio: projection.bio ?? null,
      biteScoreCatalogRestaurantId:
        projection.biteScoreCatalogRestaurantId ?? null,
      biteSaverCatalogBindingId: projection.biteSaverCatalogBindingId ?? null,
    });
  }

  function startRequest(clientInstanceId, overrides = {}) {
    return {
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("start"),
      clientInstanceId,
      latitude: 28.5383,
      longitude: -81.3792,
      radiusMiles: 10,
      locationMode: "current",
      typedLocation: null,
      searchText: "",
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      freshSearch: true,
      ...overrides,
    };
  }

  async function startSession({guest = false, clock, request = {}, uid} = {}) {
    const clientInstanceId = requestId("client");
    const authenticatedUid = guest ? null : uid ?? requestId("uid");
    const context = {
      database,
      discoveryKey,
      identityKeyV1,
      identity: {authUid: authenticatedUid, authIsAnonymous: false},
      now: () => clock.value,
      randomSource: (size) => randomBytes(size),
    };
    const response = await startCustomerBiteSaverSearchHandler(
      startRequest(clientInstanceId, request),
      context,
    );
    return {clientInstanceId, context, response, uid: authenticatedUid};
  }

  function boundRequest(bundle, overrides = {}) {
    return {
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("bound"),
      clientInstanceId: bundle.clientInstanceId,
      sessionId: bundle.response.sessionId,
      capability: bundle.response.capability,
      criteriaFingerprint: bundle.response.criteriaFingerprint,
      ...overrides,
    };
  }

  function pageRequest(bundle, overrides = {}) {
    return boundRequest(bundle, {
      cursor: null,
      guestStateRevision: null,
      ...overrides,
    });
  }

  function offerPageRequest(bundle, restaurantId, overrides = {}) {
    return pageRequest(bundle, {restaurantId, ...overrides});
  }

  function menuPageRequest(bundle, restaurantId, overrides = {}) {
    return boundRequest(bundle, {restaurantId, cursor: null, ...overrides});
  }

  function favoriteRequest(bundle, overrides = {}) {
    return boundRequest(bundle, {
      restaurantIds: [],
      offerIds: [],
      ...overrides,
    });
  }

  function redemptionRequest(bundle, restaurantId, offer, overrides = {}) {
    return boundRequest(bundle, {
      restaurantId,
      offerId: offer.offerId,
      offerOccurrence: offer.offerOccurrence,
      redemptionRequestId: requestId("redemption-logical"),
      currentCoordinates: null,
      guestStateRevision: null,
      ...overrides,
    });
  }

  function redemptionStartRequest(request, validation, overrides = {}) {
    return {
      ...request,
      clientRequestId: requestId("redemption-start"),
      validationId: validation.validationId,
      ...overrides,
    };
  }

  function guestAnswerRequest(bundle, challenge, unavailableOfferIds, overrides = {}) {
    return {
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("guest-answer"),
      clientInstanceId: bundle.clientInstanceId,
      sessionId: bundle.response.sessionId,
      capability: bundle.response.capability,
      criteriaFingerprint: bundle.response.criteriaFingerprint,
      operationRef: challenge.operationRef,
      checkToken: challenge.checkToken,
      batchSequence: challenge.batchSequence,
      guestStateRevision: challenge.guestStateRevision,
      entireBatchEvaluated: true,
      unavailableOfferIds,
      ...overrides,
    };
  }

  function assertEvaluationContext(context, bundle, evaluationAtMillis) {
    assert.deepEqual(Object.keys(context).sort(), [
      "attemptGeneration",
      "availabilityGeneration",
      "evaluationAtMillis",
      "oncePerDayUnavailableWindows",
      "queryFingerprint",
      "schemaVersion",
      "sessionId",
      "timeZone",
      "utcOffsetMinutes",
      "validUntilExclusiveMillis",
    ]);
    assert.equal(context.schemaVersion, 1);
    assert.equal(context.sessionId, bundle.response.sessionId);
    assert.equal(context.attemptGeneration, bundle.response.attemptGeneration);
    assert.equal(context.queryFingerprint, bundle.response.queryFingerprint);
    assert.equal(context.evaluationAtMillis, evaluationAtMillis);
    assert.match(context.availabilityGeneration, /^[a-f0-9]{64}$/u);
    assert.equal(context.validUntilExclusiveMillis > evaluationAtMillis, true);
    assert.equal(context.oncePerDayUnavailableWindows.length >= 1, true);
    assert.equal(context.oncePerDayUnavailableWindows.length <= 2, true);
    let previousEnd = null;
    let evaluationMemberships = 0;
    for (const window of context.oncePerDayUnavailableWindows) {
      assert.deepEqual(Object.keys(window).sort(), [
        "endAtMillisExclusive",
        "startAtMillisInclusive",
      ]);
      assert.equal(Number.isSafeInteger(window.startAtMillisInclusive), true);
      assert.equal(Number.isSafeInteger(window.endAtMillisExclusive), true);
      assert.equal(
        window.startAtMillisInclusive < window.endAtMillisExclusive,
        true,
      );
      if (previousEnd !== null) {
        assert.equal(previousEnd < window.startAtMillisInclusive, true);
      }
      if (
        window.startAtMillisInclusive <= evaluationAtMillis &&
        evaluationAtMillis < window.endAtMillisExclusive
      ) {
        evaluationMemberships += 1;
      }
      previousEnd = window.endAtMillisExclusive;
    }
    assert.equal(evaluationMemberships, 1);
  }

  async function currentSession(bundle) {
    return database.getDocument(
      `${privateCustomerBiteSaverSearchSessionCollection}/${
        bundle.response.sessionId}`,
    );
  }

  async function markReady(bundle) {
    const stored = await currentSession(bundle);
    assert.notEqual(stored, null);
    const ready = Object.freeze({...stored.data, state: "ready", phase: "ready"});
    await seed(stored.path, ready);
    return ready;
  }

  function readyRestaurantWrites(session, index, options = {}) {
    const suffix = String(index).padStart(4, "0");
    const accountId = options.accountId ?? `${runNamespace}_account_${suffix}`;
    const preparationNowMs = options.preparationNowMs ?? fixedNowMs;
    const restaurant = rawRestaurant(
      index,
      options.restaurant,
      preparationNowMs,
    );
    const parentProjection = buildBiteSaverRestaurantIndex({
      sourceDocumentId: accountId,
      source: restaurant,
      now: new Date(preparationNowMs),
      ...(options.customerIdentityKeyV1 === undefined
        ? {}
        : {identityKeyV1: options.customerIdentityKeyV1}),
    });
    assert.notEqual(parentProjection, null);
    const publicRestaurantId = customerBiteSaverOpaqueRestaurantId(
      identityKeyV1,
      accountId,
    );
    const daily = [];
    const coupons = [];
    const writes = [];
    const offerCount = options.offerCount ?? 2;
    for (let offerIndex = 0; offerIndex < offerCount; offerIndex += 1) {
      const offerType = options.onlyCoupons || offerIndex % 2 === 1
        ? "coupon"
        : "dailySpecial";
      const sourceDocumentId = options.offerIdForIndex?.(offerIndex, offerType) ??
        `${offerType === "coupon" ? "coupon" : "daily"}_${suffix}_${
          String(offerIndex).padStart(3, "0")}`;
      const offerOverrides = options.offerOverridesForIndex?.(
        offerIndex,
        offerType,
      ) ?? options.offerOverrides;
      const raw = offerType === "coupon"
        ? rawCoupon(
          index * 1_000 + offerIndex,
          offerOverrides,
          preparationNowMs,
        )
        : rawDailySpecial(
          accountId,
          index * 1_000 + offerIndex,
          offerOverrides,
          preparationNowMs,
        );
      const projection = offerType === "coupon"
        ? buildBiteSaverCouponOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId,
          offer: raw,
          restaurant,
          now: new Date(preparationNowMs),
          ...(options.customerIdentityKeyV1 === undefined
            ? {}
            : {identityKeyV1: options.customerIdentityKeyV1}),
        })
        : buildBiteSaverDailySpecialOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId,
          offer: raw,
          restaurant,
          now: new Date(preparationNowMs),
        });
      assert.notEqual(projection, null);
      const collection = offerType === "coupon" ? "coupons" : "daily_specials";
      writes.push(
        {
          type: "set",
          path: `restaurant_accounts/${accountId}/${collection}/${sourceDocumentId}`,
          data: raw,
        },
        {
          type: "set",
          path: `${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,
          data: projection,
        },
      );
      (offerType === "coupon" ? coupons : daily).push(
        previewCandidate(projection),
      );
    }
    writes.push(
      {type: "set", path: `restaurant_accounts/${accountId}`, data: restaurant},
      {
        type: "set",
        path: `${restaurantSearchIndexCollection}/${
          parentProjection.indexDocumentId}`,
        data: parentProjection,
      },
    );
    const result = Object.freeze({
      protocolVersion: customerBiteSaverSearchProtocolVersion,
      sessionId: session.sessionId,
      attemptGeneration: session.attemptGeneration,
      criteriaFingerprint: session.criteriaFingerprint,
      queryFingerprint: session.queryFingerprint,
      callerBindingHash: session.callerBindingHash,
      state: "result",
      eligibleAtPreparation: true,
      exactPreferenceRank: options.exactPreferenceRank ?? 1,
      distanceSortMiles: 0,
      distanceMiles: 0,
      lowercaseDisplayNameOrderKey: lowercaseDisplayNameOrderKey(
        parentProjection.displayName,
      ),
      authoritativeAccountIdOrderKey:
        dartUtf16FirestoreBytesOrderKey(accountId),
      authoritativeAccountId: accountId,
      publicRestaurantId,
      parentProjectionDocumentId: parentProjection.indexDocumentId,
      parentProjectionFingerprint: parentProjection.sourceFingerprint,
      parentOfferCatalogFingerprint:
        customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint(
          restaurant,
        ),
      offerCatalogFingerprint: "f".repeat(64),
      parentMatches: session.criteria.normalizedSearchQuery.length === 0,
      offerMatches: session.criteria.normalizedSearchQuery.length !== 0,
      previewDailyCandidates: daily.slice(
        0,
        customerBiteSaverPreviewCandidateRetentionLimit,
      ),
      previewCouponCandidates: coupons.slice(
        0,
        customerBiteSaverPreviewCandidateRetentionLimit,
      ),
      usableOfferCountAtPreparation: daily.length + coupons.length,
      safeRestaurantSnapshot: safeRestaurantSnapshot(parentProjection),
      createdAt: new Date(preparationNowMs),
      logicalExpiresAt: session.logicalExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      expiresAt: session.absoluteExpiresAt,
    });
    const resultId = customerBiteSaverResultDocumentId(
      discoveryKey,
      session.sessionId,
      session.attemptGeneration,
      publicRestaurantId,
    );
    const resultPath = `${privateCustomerBiteSaverResultCollection}/${resultId}`;
    writes.push({type: "set", path: resultPath, data: result});
    return {
      accountId,
      publicRestaurantId,
      restaurant,
      parentProjection,
      result,
      resultPath,
      daily,
      coupons,
      writes,
    };
  }

  function unavailableResultWrite(session, index) {
    const suffix = String(index).padStart(4, "0");
    const accountId = `${runNamespace}_unavailable_${suffix}`;
    const publicRestaurantId = customerBiteSaverOpaqueRestaurantId(
      identityKeyV1,
      accountId,
    );
    const data = Object.freeze({
      protocolVersion: customerBiteSaverSearchProtocolVersion,
      sessionId: session.sessionId,
      attemptGeneration: session.attemptGeneration,
      criteriaFingerprint: session.criteriaFingerprint,
      queryFingerprint: session.queryFingerprint,
      callerBindingHash: session.callerBindingHash,
      state: "result",
      eligibleAtPreparation: true,
      exactPreferenceRank: 1,
      distanceSortMiles: 0,
      distanceMiles: 0,
      lowercaseDisplayNameOrderKey: lowercaseDisplayNameOrderKey(
        `Restaurant ${suffix}`,
      ),
      authoritativeAccountIdOrderKey:
        dartUtf16FirestoreBytesOrderKey(accountId),
      authoritativeAccountId: accountId,
      publicRestaurantId,
      parentProjectionDocumentId: `si_${"d".repeat(64)}`,
      parentProjectionFingerprint: "a".repeat(64),
      parentOfferCatalogFingerprint: "e".repeat(64),
      parentMatches: true,
      offerMatches: false,
      usableOfferCountAtPreparation: 1,
      safeRestaurantSnapshot: safeRestaurantSnapshot({
        displayName: `Restaurant ${suffix}`,
      }),
      previewDailyCandidates: [],
      previewCouponCandidates: [],
      offerCatalogFingerprint: "b".repeat(64),
      createdAt: new Date(fixedNowMs),
      logicalExpiresAt: session.logicalExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      expiresAt: session.absoluteExpiresAt,
    });
    const path = `${privateCustomerBiteSaverResultCollection}/${
      customerBiteSaverResultDocumentId(
        discoveryKey,
        session.sessionId,
        session.attemptGeneration,
        publicRestaurantId,
      )}`;
    return {type: "set", path, data};
  }

  function rawSourcePaths(parent) {
    return Object.freeze([
      `restaurant_accounts/${parent.accountId}`,
      ...parent.daily.map(({sourceDocumentId}) =>
        `restaurant_accounts/${parent.accountId}/daily_specials/${
          sourceDocumentId}`),
      ...parent.coupons.map(({sourceDocumentId}) =>
        `restaurant_accounts/${parent.accountId}/coupons/${sourceDocumentId}`),
    ]);
  }

  async function rawDocumentUpdateTimes(paths) {
    const snapshots = await Promise.all(paths.map((path) =>
      firestore.doc(path).get()));
    return Object.freeze(snapshots.map((snapshot, index) => {
      assert.equal(snapshot.exists, true);
      assert.notEqual(snapshot.updateTime, undefined);
      return Object.freeze({
        path: paths[index],
        updateTimeMillis: snapshot.updateTime.toMillis(),
        updateTimeSeconds: snapshot.updateTime.seconds,
        updateTimeNanoseconds: snapshot.updateTime.nanoseconds,
      });
    }));
  }

  async function documentsWithRole(role) {
    const paths = [...ownedPaths];
    const results = [];
    for (let offset = 0; offset < paths.length; offset += 100) {
      const documents = await database.getDocuments(paths.slice(offset, offset + 100));
      for (const document of documents) {
        if (document?.data.role === role) results.push(document);
      }
    }
    return results;
  }

  function contractError(code) {
    return (error) => error instanceof CustomerBiteSaverContractError &&
      error.code === code;
  }

  test.after(async () => {
    hooks.afterGetDocument = null;
    hooks.afterTransactionGetDocuments = null;
    hooks.beforeQuery = null;
    hooks.afterTransactionCommit = null;
    // This set contains only writes that successfully committed through this
    // test's adapter. Opaque private IDs and the initial generation scaffolding
    // are isolated by the required per-invocation demo-bs-adapter-* project.
    const paths = [...ownedPaths].sort((left, right) =>
      right.split("/").length - left.split("/").length);
    try {
      for (let offset = 0; offset < paths.length; offset += 400) {
        const batch = firestore.batch();
        for (const path of paths.slice(offset, offset + 400)) {
          batch.delete(firestore.doc(path));
        }
        await batch.commit();
      }
    } finally {
      try {
        await deleteApp(app);
      } finally {
        process.stdout.write(`# BiteSaver real-adapter emulator metrics ${JSON.stringify({
          projectId: safety.projectId,
          emulatorHost: safety.host,
          namespace: runNamespace,
          ownedPaths: ownedPaths.size,
          ...metrics,
        })}\n`);
      }
    }
  });

  test("real adapter preserves document-ID and multi-field startAfter boundaries",
    {timeout: 30_000}, async () => {
    const collection = `${runNamespace}_boundary_rows`;
    await commitAll([
      {type: "set", path: `${collection}/a`, data: {rank: 1, label: "z"}},
      {type: "set", path: `${collection}/b`, data: {rank: 1, label: "z"}},
      {type: "set", path: `${collection}/c`, data: {rank: 1, label: "y"}},
      {type: "set", path: `${collection}/d`, data: {rank: 2, label: "x"}},
    ]);
    const exact = await database.queryDocuments({
      collectionPath: collection,
      filters: [{field: "__name__", operation: "==", value: "b"}],
      orders: [{field: "__name__", direction: "asc"}],
      limit: 10,
    });
    assert.deepEqual(exact.map(({id}) => id), ["b"]);
    const after = await database.queryDocuments({
      collectionPath: collection,
      filters: [],
      orders: [
        {field: "rank", direction: "asc"},
        {field: "label", direction: "desc"},
        {field: "__name__", direction: "asc"},
      ],
      startAfter: [1, "z", "a"],
      limit: 2,
    });
    assert.deepEqual(after.map(({id}) => id), ["b", "c"]);
  });

  test("real adapter pages canonical Saved and resolves exact public identities",
    {timeout: 30_000}, async () => {
    const uid = `${runNamespace}_saved_owner`;
    const seeded = [];
    const writes = [];
    for (let index = 0; index < 26; index += 1) {
      const accountId = `${runNamespace}_saved_account_${index}`;
      const savedLatitude = 40.7128;
      const savedLongitude = -74.0060;
      const restaurant = rawRestaurant(8_000 + index, {
        city: "New York",
        state: "NY",
        zipCode: "10007",
        latitude: savedLatitude,
        longitude: savedLongitude,
        geohash: canonicalRestaurantGeohash({
          latitude: savedLatitude,
          longitude: savedLongitude,
        }),
      });
      const projection = buildBiteSaverRestaurantIndex({
        sourceDocumentId: accountId,
        source: restaurant,
        now: new Date(fixedNowMs),
        identityKeyV1,
      });
      assert.notEqual(projection, null);
      const restaurantId = customerBiteSaverOpaqueRestaurantId(
        identityKeyV1,
        accountId,
      );
      seeded.push(restaurantId);
      writes.push(
        {
          type: "set",
          path: `restaurant_accounts/${accountId}`,
          data: restaurant,
        },
        {
          type: "set",
          path: `${restaurantSearchIndexCollection}/${projection.indexDocumentId}`,
          data: projection,
        },
        {
          type: "set",
          path: `user_profiles/${uid}/favorite_restaurants/${restaurantId}`,
          data: {
            ...canonicalRestaurantFavorite(uid, restaurantId),
            createdAt: new Date(fixedNowMs - index * 1_000),
            updatedAt: new Date(fixedNowMs - index * 1_000),
          },
        },
      );
    }
    await commitAll(writes);
    const savedContext = {
      database,
      discoveryKey,
      identityKeyV1,
      identity: {authUid: uid, authIsAnonymous: false},
      now: () => fixedNowMs,
      randomSource: (size) => Buffer.alloc(size, 13),
    };
    const savedRequest = (cursor, suffix) => ({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId(`saved_${suffix}`),
      section: "restaurants",
      cursor,
    });
    const before = snapshotMetrics();
    const first = await getCustomerBiteSaverSavedPageHandler(
      savedRequest(null, "first"),
      savedContext,
    );
    const second = await getCustomerBiteSaverSavedPageHandler(
      savedRequest(first.nextCursor, "second"),
      savedContext,
    );
    const after = snapshotMetrics();
    assert.equal(first.entries.length, 25);
    assert.equal(first.hasMore, true);
    assert.equal(second.entries.length, 1);
    assert.equal(second.hasMore, false);
    assert.deepEqual(
      [...first.entries, ...second.entries].map(({restaurantId}) => restaurantId),
      seeded,
    );
    assert.equal(first.entries.every(({availability}) =>
      availability === "available"), true);
    assert.deepEqual({
      queries: after.queries - before.queries,
      queryReads: after.queryReads - before.queryReads,
      pointReads: after.pointReads - before.pointReads,
      writes: after.writes - before.writes,
    }, {queries: 4, queryReads: 53, pointReads: 26, writes: 0});

    const menuAccountId = `${runNamespace}_saved_account_0`;
    const menuWrites = Array.from({length: 75}, (_, index) => ({
      type: "set",
      path: `restaurant_accounts/${menuAccountId}/menu_images/` +
        `filtered_${String(index).padStart(3, "0")}`,
      data: {privateCanary: `filtered-${index}`},
    }));
    menuWrites.push({
      type: "set",
      path: `restaurant_accounts/${menuAccountId}/menu_images/valid_075`,
      data: {
        imageUrl: "https://images.example.test/saved-adapter-76.webp",
        sortOrder: 76,
      },
    });
    await commitAll(menuWrites);
    const menuBefore = snapshotMetrics();
    const menuFirst = await getCustomerBiteSaverSavedMenuPageHandler({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("saved_menu_first"),
      accessToken: first.entries[0].accessToken,
      cursor: null,
    }, savedContext);
    const menuSecond = await getCustomerBiteSaverSavedMenuPageHandler({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("saved_menu_second"),
      accessToken: first.entries[0].accessToken,
      cursor: menuFirst.nextCursor,
    }, savedContext);
    const menuAfter = snapshotMetrics();
    assert.deepEqual(menuFirst.entries, []);
    assert.equal(menuFirst.hasMore, true);
    assert.notEqual(menuFirst.nextCursor, null);
    assert.deepEqual(menuSecond.entries.map(({imageUrl}) => imageUrl), [
      "https://images.example.test/saved-adapter-76.webp",
    ]);
    assert.equal(menuSecond.hasMore, false);
    assert.equal(menuSecond.nextCursor, null);
    assert.equal(JSON.stringify([menuFirst, menuSecond]).includes("privateCanary"), false);
    assert.equal(menuAfter.writes - menuBefore.writes, 0);

    await assert.rejects(
      getCustomerBiteSaverSavedPageHandler(savedRequest(null, "anonymous"), {
        ...savedContext,
        identity: {authUid: uid, authIsAnonymous: true},
      }),
      contractError("permission-denied"),
    );
    metrics.scenarioMeasurements.saved = {
      pages: 2,
      visibleEntries: first.entries.length + second.entries.length,
      maximumFavoriteQueryLimit: 26,
      maximumProjectionInValues: 25,
      queryReads: after.queryReads - before.queryReads,
      pointReads: after.pointReads - before.pointReads,
      writes: 0,
      menuPages: 2,
      menuVisibleEntries: 1,
      menuQueryReads: menuAfter.queryReads - menuBefore.queryReads,
      menuWrites: 0,
    };
  });

  test("real adapter Saved redemption contends and replays one canonical write",
    {timeout: 30_000}, async () => {
    const uid = `${runNamespace}_saved_redemption_owner`;
    const accountId = `${runNamespace}_saved_redemption_account`;
    const sourceDocumentId = `${runNamespace}_saved_redemption_coupon`;
    const savedLatitude = 40.7128;
    const savedLongitude = -74.0060;
    const restaurant = rawRestaurant(8_500, {
      city: "New York",
      state: "NY",
      zipCode: "10007",
      latitude: savedLatitude,
      longitude: savedLongitude,
      geohash: canonicalRestaurantGeohash({
        latitude: savedLatitude,
        longitude: savedLongitude,
      }),
    });
    const coupon = rawCoupon(8_500, {usageRule: "Once per customer"});
    const restaurantProjection = buildBiteSaverRestaurantIndex({
      sourceDocumentId: accountId,
      source: restaurant,
      now: new Date(fixedNowMs),
      identityKeyV1,
    });
    const offerProjection = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: accountId,
      sourceDocumentId,
      offer: coupon,
      restaurant,
      now: new Date(fixedNowMs),
      identityKeyV1,
    });
    assert.notEqual(restaurantProjection, null);
    assert.notEqual(offerProjection, null);
    const restaurantId = customerBiteSaverOpaqueRestaurantId(
      identityKeyV1,
      accountId,
    );
    const offerId = customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      accountId,
      "coupon",
      sourceDocumentId,
    );
    await commitAll([
      {
        type: "set",
        path: `restaurant_accounts/${accountId}`,
        data: restaurant,
      },
      {
        type: "set",
        path: `restaurant_accounts/${accountId}/coupons/${sourceDocumentId}`,
        data: coupon,
      },
      {
        type: "set",
        path: `${restaurantSearchIndexCollection}/${restaurantProjection.indexDocumentId}`,
        data: restaurantProjection,
      },
      {
        type: "set",
        path: `${biteSaverOfferIndexCollection}/${offerProjection.indexDocumentId}`,
        data: offerProjection,
      },
      {
        type: "set",
        path: `user_profiles/${uid}/favorite_coupons/${offerId}`,
        data: canonicalCouponFavorite(uid, restaurantId, offerId),
      },
    ]);
    const savedContext = {
      database,
      discoveryKey,
      identityKeyV1,
      identity: {authUid: uid, authIsAnonymous: false},
      now: () => fixedNowMs,
      randomSource: (size) => Buffer.alloc(size, 17),
    };
    const page = await getCustomerBiteSaverSavedPageHandler({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("saved_redemption_page"),
      section: "coupons",
      cursor: null,
    }, savedContext);
    assert.equal(page.entries.length, 1);
    const validationRequest = {
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("saved_redemption_validation"),
      accessToken: page.entries[0].accessToken,
      restaurantId,
      offerId,
      redemptionRequestId: requestId("saved_redemption_logical"),
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      currentCoordinates: null,
    };
    const validation =
      await validateCustomerBiteSaverSavedOfferRedemptionStartHandler(
        validationRequest,
        savedContext,
      );
    assert.equal(validation.allowed, true);
    const startRequest = {
      ...validationRequest,
      clientRequestId: requestId("saved_redemption_start"),
      validationId: validation.validationId,
    };
    const before = snapshotMetrics();
    const [first, concurrent] = await bounded(Promise.all([
      startCustomerBiteSaverSavedOfferRedemptionHandler(
        startRequest,
        savedContext,
      ),
      startCustomerBiteSaverSavedOfferRedemptionHandler(
        startRequest,
        savedContext,
      ),
    ]), "concurrent Saved redemption start");
    await firestore.doc(
      `${biteSaverOfferIndexCollection}/${offerProjection.indexDocumentId}`,
    ).delete();
    assert.equal(
      (await firestore.doc(
        `${biteSaverOfferIndexCollection}/${offerProjection.indexDocumentId}`,
      ).get()).exists,
      false,
    );
    const exactRetry = await startCustomerBiteSaverSavedOfferRedemptionHandler(
      startRequest,
      savedContext,
    );
    const after = snapshotMetrics();
    assert.deepEqual(concurrent, first);
    assert.deepEqual(exactRetry, first);
    assert.equal(first.status, "started");
    assert.equal(first.timerStartedAtMillis, fixedNowMs);
    const usagePath =
      `customer_redemptions/${uid}/coupon_redemptions/${offerId}`;
    const usage = await database.getDocument(usagePath);
    assert.notEqual(usage, null);
    assert.equal(usage.data.redemptionId, first.redemptionId);
    assert.equal(millis(usage.data.timerStartedAt), first.timerStartedAtMillis);
    assert.equal(millis(usage.data.timerExpiresAt), first.timerExpiresAtMillis);
    assert.equal(
      after.writes - before.writes,
      2,
      "one usage document and one start receipt must commit",
    );
    metrics.scenarioMeasurements.savedRedemption = {
      concurrentStarts: 2,
      exactRetries: 1,
      projectionWithdrawnBeforeExactRetry: true,
      canonicalUsageWrites: 1,
      startReceiptWrites: 1,
      writes: after.writes - before.writes,
    };
  });

  test("real adapter device-bound Browse and Saved contend on device and account scopes",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const guestBundle = await startSession({guest: true, clock});
    const guestSession = await markReady(guestBundle);
    const accountId = `${runNamespace}_device_core_account`;
    const parent = readyRestaurantWrites(guestSession, 8_700, {
      accountId,
      offerCount: 2,
      onlyCoupons: true,
      customerIdentityKeyV1: identityKeyV1,
      offerOverrides: {usageRule: "Once per customer"},
    });
    const uidA = `${runNamespace}_device_core_user_a`;
    const uidB = `${runNamespace}_device_core_user_b`;
    const publicOfferIds = parent.coupons.map(({sourceDocumentId}) =>
      customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        accountId,
        "coupon",
        sourceDocumentId,
      ));
    await commitAll([
      ...parent.writes,
      ...[uidA, uidB].flatMap((uid) => publicOfferIds.map((publicOfferId) => ({
        type: "set",
        path: `user_profiles/${uid}/favorite_coupons/${publicOfferId}`,
        data: canonicalCouponFavorite(
          uid,
          parent.publicRestaurantId,
          publicOfferId,
        ),
      }))),
    ]);

    const guestPageRequest = pageRequest(guestBundle, {
      clientRequestId: requestId("device_core_guest_page"),
      guestStateRevision: 87,
    });
    const challenge = await getCustomerBiteSaverSearchPageHandler(
      guestPageRequest,
      guestBundle.context,
    );
    assert.equal(challenge.outcome, "guestCheckRequired");
    const guestComplete = await continueCustomerBiteSaverGuestOfferCheckHandler(
      guestAnswerRequest(guestBundle, challenge, [], {
        clientRequestId: requestId("device_core_guest_answer"),
      }),
      guestBundle.context,
    );
    assert.equal(guestComplete.outcome, "complete");
    const deliveredRestaurant = guestComplete.result.restaurants[0];
    const deliveredOffer = deliveredRestaurant.offers.find(({offerId}) =>
      offerId === publicOfferIds[0]);
    assert.notEqual(deliveredOffer, undefined);

    const signedContext = (uid, deviceSubject, randomByte) => {
      let entropy = randomByte;
      return {
        database,
        discoveryKey,
        identityKeyV1,
        identity: {authUid: uid, authIsAnonymous: false},
        now: () => clock.value,
        randomSource: (size) => Buffer.alloc(size, entropy++),
        deviceEvidenceVerifier: {
          async verify(input) {
            return {
              state: "verified",
              deviceSubject,
              requestFingerprint: input.requestFingerprint,
              authenticatedUserId: uid,
              validFromMillis: clock.value - 1_000,
              validUntilMillis: clock.value + 60_000,
            };
          },
        },
      };
    };
    const guestDeviceContext = {
      ...guestBundle.context,
      deviceEvidenceVerifier: {
        async verify(input) {
          return {
            state: "verified",
            deviceSubject: "synthetic-real-adapter-device-a",
            requestFingerprint: input.requestFingerprint,
            authenticatedUserId: null,
            validFromMillis: clock.value - 1_000,
            validUntilMillis: clock.value + 60_000,
          };
        },
      },
    };
    const savedContextA = signedContext(
      uidA,
      "synthetic-real-adapter-device-a",
      71,
    );
    const savedPageA = await getCustomerBiteSaverSavedPageHandler({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("device_core_saved_page_a"),
      section: "coupons",
      cursor: null,
    }, savedContextA);
    const savedEntryA = savedPageA.entries.find(({offerId}) =>
      offerId === publicOfferIds[0]);
    assert.notEqual(savedEntryA, undefined);
    const guestUseRequest = {
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      logicalRequestId: requestId("device_core_guest_use"),
      restaurantId: parent.publicRestaurantId,
      offerId: publicOfferIds[0],
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      currentCoordinates: null,
      origin: {
        kind: "discovery",
        clientInstanceId: guestBundle.clientInstanceId,
        sessionId: guestBundle.response.sessionId,
        capability: guestBundle.response.capability,
        criteriaFingerprint: guestBundle.response.criteriaFingerprint,
        offerOccurrence: deliveredOffer.offerOccurrence,
        guestStateRevision: 87,
      },
    };
    const savedUseRequestA = {
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      logicalRequestId: requestId("device_core_saved_use_a"),
      restaurantId: parent.publicRestaurantId,
      offerId: publicOfferIds[0],
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      currentCoordinates: null,
      origin: {kind: "saved", accessToken: savedEntryA.accessToken},
    };

    const bothUsageReads = deferred();
    let initialUsageReadArrivals = 0;
    hooks.afterTransactionGetDocuments = async (paths) => {
      if (!paths.some((path) =>
        path.startsWith("private_bitesaver_device_coupon_usage/"))) return;
      if (initialUsageReadArrivals >= 2) return;
      initialUsageReadArrivals += 1;
      if (initialUsageReadArrivals === 2) bothUsageReads.resolve();
      await bothUsageReads.promise;
    };
    const before = snapshotMetrics();
    const invocationsBefore = metrics.transactionInvocations;
    const attemptsBefore = metrics.transactionAttempts;
    const [guestUse, savedUse] = await bounded(Promise.all([
      handleCustomerBiteSaverDeviceBoundUse(
        guestUseRequest,
        guestDeviceContext,
      ),
      handleCustomerBiteSaverDeviceBoundUse(
        savedUseRequestA,
        savedContextA,
      ),
    ]), "device-bound guest/signed contention", 60_000);
    hooks.afterTransactionGetDocuments = null;
    const after = snapshotMetrics();
    const transactionInvocations =
      metrics.transactionInvocations - invocationsBefore;
    const transactionAttempts = metrics.transactionAttempts - attemptsBefore;
    assert.equal(initialUsageReadArrivals, 2);
    assert.deepEqual(
      [guestUse.status, savedUse.status].sort(),
      ["active", "started"],
    );
    assert.equal(guestUse.redemptionId, savedUse.redemptionId);
    assert.equal(guestUse.timerStartedAtMillis, savedUse.timerStartedAtMillis);
    assert.equal(transactionInvocations, 2);
    assert.equal(transactionAttempts >= 3, true);
    assert.equal(after.writes - before.writes, 4);
    assert.notEqual(await database.getDocument(
      `customer_redemptions/${uidA}/coupon_redemptions/${publicOfferIds[0]}`,
    ), null);

    const savedContextB = signedContext(
      uidB,
      "synthetic-real-adapter-device-a",
      72,
    );
    const savedPageB = await getCustomerBiteSaverSavedPageHandler({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      clientRequestId: requestId("device_core_saved_page_b"),
      section: "coupons",
      cursor: null,
    }, savedContextB);
    const savedEntryB = savedPageB.entries.find(({offerId}) =>
      offerId === publicOfferIds[0]);
    const accountSwitchRequest = {
      ...savedUseRequestA,
      logicalRequestId: requestId("device_core_saved_use_b"),
      origin: {kind: "saved", accessToken: savedEntryB.accessToken},
    };
    const accountSwitchBefore = snapshotMetrics();
    const accountSwitch = await handleCustomerBiteSaverDeviceBoundUse(
      accountSwitchRequest,
      savedContextB,
    );
    const accountSwitchAfter = snapshotMetrics();
    assert.equal(accountSwitch.status, "active");
    assert.equal(accountSwitch.redemptionId, guestUse.redemptionId);
    assert.notEqual(await database.getDocument(
      `customer_redemptions/${uidB}/coupon_redemptions/${publicOfferIds[0]}`,
    ), null);

    const secondDeviceContextA = signedContext(
      uidA,
      "synthetic-real-adapter-device-b",
      73,
    );
    const secondDeviceBefore = snapshotMetrics();
    const secondDevice = await handleCustomerBiteSaverDeviceBoundUse({
      ...savedUseRequestA,
      logicalRequestId: requestId("device_core_second_device"),
    }, secondDeviceContextA);
    const secondDeviceAfter = snapshotMetrics();
    assert.equal(secondDevice.status, "active");
    assert.equal(secondDevice.redemptionId, guestUse.redemptionId);

    const untouchedEntry = savedPageA.entries.find(({offerId}) =>
      offerId === publicOfferIds[1]);
    const distinctBefore = snapshotMetrics();
    const distinctCoupon = await handleCustomerBiteSaverDeviceBoundUse({
      ...savedUseRequestA,
      logicalRequestId: requestId("device_core_distinct_coupon"),
      offerId: publicOfferIds[1],
      origin: {kind: "saved", accessToken: untouchedEntry.accessToken},
    }, savedContextA);
    const distinctAfter = snapshotMetrics();
    assert.equal(distinctCoupon.status, "started");
    assert.notEqual(distinctCoupon.redemptionId, guestUse.redemptionId);

    clock.value = guestUse.timerExpiresAtMillis;
    const deniedBefore = snapshotMetrics();
    const denied = await handleCustomerBiteSaverDeviceBoundUse({
      ...savedUseRequestA,
      logicalRequestId: requestId("device_core_used_denial"),
    }, savedContextA);
    const deniedAfter = snapshotMetrics();
    assert.equal(denied.status, "denied");
    assert.equal(denied.reason, "used");

    await database.commitWrites([{
      type: "delete",
      path: `user_profiles/${uidB}/favorite_coupons/${publicOfferIds[0]}`,
    }, {
      type: "delete",
      path: `${biteSaverOfferIndexCollection}/${parent.coupons[0].indexDocumentId}`,
    }]);
    const queriesBeforeRecovery = metrics.queryCalls;
    const replayBefore = snapshotMetrics();
    assert.deepEqual(
      await handleCustomerBiteSaverDeviceBoundUse(
        accountSwitchRequest,
        savedContextB,
      ),
      accountSwitch,
    );
    const replayAfter = snapshotMetrics();
    assert.equal(metrics.queryCalls, queriesBeforeRecovery);
    assert.equal(replayAfter.writes, replayBefore.writes);
    await assert.rejects(
      handleCustomerBiteSaverDeviceBoundUse({
        ...accountSwitchRequest,
        currentCoordinates: {
          latitude: 28.5383,
          longitude: -81.3792,
          capturedAtMillis: clock.value,
        },
      }, savedContextB),
      contractError("failed-precondition"),
    );
    assert.equal(metrics.queryCalls, queriesBeforeRecovery);

    const delta = (beforeValue, afterValue) => ({
      pointReads: afterValue.pointReads - beforeValue.pointReads,
      queries: afterValue.queries - beforeValue.queries,
      queryReads: afterValue.queryReads - beforeValue.queryReads,
      writes: afterValue.writes - beforeValue.writes,
    });
    assert.deepEqual(delta(accountSwitchBefore, accountSwitchAfter), {
      pointReads: 7,
      queries: 1,
      queryReads: 1,
      writes: 2,
    });
    assert.deepEqual(delta(secondDeviceBefore, secondDeviceAfter), {
      pointReads: 7,
      queries: 1,
      queryReads: 1,
      writes: 2,
    });
    assert.deepEqual(delta(distinctBefore, distinctAfter), {
      pointReads: 7,
      queries: 1,
      queryReads: 1,
      writes: 3,
    });
    assert.deepEqual(delta(deniedBefore, deniedAfter), {
      pointReads: 7,
      queries: 1,
      queryReads: 1,
      writes: 1,
    });
    assert.deepEqual(delta(replayBefore, replayAfter), {
      pointReads: 1,
      queries: 0,
      queryReads: 0,
      writes: 0,
    });

    metrics.scenarioMeasurements.deviceUsageCore = {
      syntheticDeviceEvidenceBoundary: true,
      realFirestoreTransactions: transactionInvocations,
      realFirestoreAttempts: transactionAttempts,
      contentionExtraAttempts: transactionAttempts - transactionInvocations,
      contentionPointReads: after.pointReads - before.pointReads,
      contentionQueries: after.queries - before.queries,
      contentionQueryReads: after.queryReads - before.queryReads,
      contentionWrites: after.writes - before.writes,
      activeReconciliation: delta(accountSwitchBefore, accountSwitchAfter),
      secondDeviceReconciliation: delta(
        secondDeviceBefore,
        secondDeviceAfter,
      ),
      freshSignedDistinctCoupon: delta(distinctBefore, distinctAfter),
      semanticDenial: delta(deniedBefore, deniedAfter),
      exactReplay: delta(replayBefore, replayAfter),
      guestAndSignedSameDevice: true,
      accountSwitchReconciled: true,
      sameAccountSecondDeviceReconciled: true,
      distinctCouponStarted: true,
    };
    // This file shares one emulator namespace across sequential scenarios.
    // Remove this scenario's synthetic public projections so the later broad
    // Florida worker campaign measures only the 26 records it creates.
    await database.commitWrites([
      {
        type: "delete",
        path: `${restaurantSearchIndexCollection}/${
          parent.parentProjection.indexDocumentId}`,
      },
      ...parent.coupons.map(({indexDocumentId}) => ({
        type: "delete",
        path: `${biteSaverOfferIndexCollection}/${indexDocumentId}`,
      })),
    ]);
  });

  test("real handlers preserve a current-device timer and reject borrowing a remote timer",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const setupBundle = await startSession({guest: true, clock});
    const setupSession = await markReady(setupBundle);
    const accountId = `${runNamespace}_same_phone_policy_account`;
    const parent = readyRestaurantWrites(setupSession, 8_710, {
      accountId,
      offerCount: 2,
      onlyCoupons: true,
      customerIdentityKeyV1: identityKeyV1,
      offerOverrides: {usageRule: "Once per customer"},
    });
    const uid = `${runNamespace}_same_phone_policy_user`;
    const offerIds = parent.coupons.map(({sourceDocumentId}) =>
      customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        accountId,
        "coupon",
        sourceDocumentId,
      ));
    await commitAll([
      ...parent.writes,
      ...offerIds.map((publicOfferId) => ({
        type: "set",
        path: `user_profiles/${uid}/favorite_coupons/${publicOfferId}`,
        data: canonicalCouponFavorite(
          uid,
          parent.publicRestaurantId,
          publicOfferId,
        ),
      })),
    ]);

    const signedContext = (deviceSubject, randomByte) => {
      let entropy = randomByte;
      return {
        database,
        discoveryKey,
        identityKeyV1,
        identity: {authUid: uid, authIsAnonymous: false},
        now: () => clock.value,
        randomSource: (size) => Buffer.alloc(size, entropy++),
        deviceEvidenceVerifier: {
          async verify(input) {
            return {
              state: "verified",
              deviceSubject,
              requestFingerprint: input.requestFingerprint,
              authenticatedUserId: uid,
              validFromMillis: clock.value - 1_000,
              validUntilMillis: clock.value + 60_000,
            };
          },
        },
      };
    };
    const phoneX = "synthetic-same-phone-policy-device-x";
    const phoneY = "synthetic-same-phone-policy-device-y";
    const contextX = signedContext(phoneX, 81);
    const contextY = signedContext(phoneY, 82);
    const deviceUsagePath = (deviceSubject, offerId) =>
      customerBiteSaverDeviceCouponUsagePath({
        secretKey: discoveryKey,
        deviceBinding:
          customerBiteSaverDeviceUsageCoreInternals.deviceBinding(
            discoveryKey,
            deviceSubject,
          ),
        offerId,
      });
    const accountUsagePath = (offerId) =>
      `customer_redemptions/${uid}/coupon_redemptions/${offerId}`;
    const savedPage = async (label, context) =>
      getCustomerBiteSaverSavedPageHandler({
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        clientRequestId: requestId(label),
        section: "coupons",
        cursor: null,
      }, context);
    const savedEntry = (page, offerId) => {
      const entry = page.entries.find((candidate) =>
        candidate.offerId === offerId);
      assert.notEqual(entry, undefined);
      return entry;
    };
    const savedUseRequest = (label, offerId, accessToken) => ({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      logicalRequestId: requestId(label),
      restaurantId: parent.publicRestaurantId,
      offerId,
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      currentCoordinates: null,
      origin: {kind: "saved", accessToken},
    });
    const assertUsageUnchanged = async (path, before) => {
      const after = await database.getDocument(path);
      assert.notEqual(after, null);
      assert.deepEqual(after.data, before.data);
    };

    const initialSavedPage = await savedPage("same_phone_initial_saved", contextX);
    const accountFirst = await handleCustomerBiteSaverDeviceBoundUse(
      savedUseRequest(
        "same_phone_account_first",
        offerIds[0],
        savedEntry(initialSavedPage, offerIds[0]).accessToken,
      ),
      contextX,
    );
    assert.equal(accountFirst.status, "started");
    clock.value = accountFirst.timerExpiresAtMillis;

    const guestBundle = await startSession({guest: true, clock});
    const guestSession = await markReady(guestBundle);
    const currentParent = readyRestaurantWrites(guestSession, 8_710, {
      accountId,
      offerCount: 2,
      onlyCoupons: true,
      preparationNowMs: clock.value,
      customerIdentityKeyV1: identityKeyV1,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(currentParent.writes);
    const guestPageRequest = pageRequest(guestBundle, {
      clientRequestId: requestId("same_phone_guest_page"),
      guestStateRevision: 91,
    });
    const challenge = await getCustomerBiteSaverSearchPageHandler(
      guestPageRequest,
      guestBundle.context,
    );
    assert.equal(challenge.outcome, "guestCheckRequired");
    const guestPage = await continueCustomerBiteSaverGuestOfferCheckHandler(
      guestAnswerRequest(guestBundle, challenge, [], {
        clientRequestId: requestId("same_phone_guest_answer"),
      }),
      guestBundle.context,
    );
    assert.equal(guestPage.outcome, "complete");
    const deliveredOffers = new Map(
      guestPage.result.restaurants[0].offers.map((offer) =>
        [offer.offerId, offer]),
    );
    const guestContextY = {
      ...guestBundle.context,
      deviceEvidenceVerifier: {
        async verify(input) {
          return {
            state: "verified",
            deviceSubject: phoneY,
            requestFingerprint: input.requestFingerprint,
            authenticatedUserId: null,
            validFromMillis: clock.value - 1_000,
            validUntilMillis: clock.value + 60_000,
          };
        },
      },
    };
    const discoveryUseRequest = (label, offerId, offerOccurrence, revision) => ({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      logicalRequestId: requestId(label),
      restaurantId: parent.publicRestaurantId,
      offerId,
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      currentCoordinates: null,
      origin: {
        kind: "discovery",
        clientInstanceId: guestBundle.clientInstanceId,
        sessionId: guestBundle.response.sessionId,
        capability: guestBundle.response.capability,
        criteriaFingerprint: guestBundle.response.criteriaFingerprint,
        offerOccurrence,
        guestStateRevision: revision,
      },
    });
    const currentPhoneFirst = await handleCustomerBiteSaverDeviceBoundUse(
      discoveryUseRequest(
        "same_phone_current_guest_first",
        offerIds[0],
        deliveredOffers.get(offerIds[0]).offerOccurrence,
        91,
      ),
      guestContextY,
    );
    const currentPhoneSecond = await handleCustomerBiteSaverDeviceBoundUse(
      discoveryUseRequest(
        "same_phone_current_guest_second",
        offerIds[1],
        deliveredOffers.get(offerIds[1]).offerOccurrence,
        91,
      ),
      guestContextY,
    );
    assert.equal(currentPhoneFirst.status, "started");
    assert.equal(currentPhoneSecond.status, "started");

    const ownerPage = await savedPage("same_phone_owner_page", contextY);
    const continuationRequest = savedUseRequest(
      "same_phone_owner_continuation",
      offerIds[0],
      savedEntry(ownerPage, offerIds[0]).accessToken,
    );
    const ownerAccountBefore = await database.getDocument(
      accountUsagePath(offerIds[0]),
    );
    const ownerDeviceBefore = await database.getDocument(
      deviceUsagePath(phoneY, offerIds[0]),
    );
    assert.equal(millis(ownerAccountBefore.data.timerExpiresAt) <= clock.value, true);
    assert.equal(millis(ownerDeviceBefore.data.timerExpiresAt) > clock.value, true);
    const ownerBefore = snapshotMetrics();
    const continuation = await handleCustomerBiteSaverDeviceBoundUse(
      continuationRequest,
      contextY,
    );
    const ownerAfter = snapshotMetrics();
    assert.equal(continuation.status, "active");
    assert.equal(continuation.redemptionId, currentPhoneFirst.redemptionId);
    assert.equal(
      continuation.timerStartedAtMillis,
      currentPhoneFirst.timerStartedAtMillis,
    );
    assert.equal(
      continuation.timerExpiresAtMillis,
      currentPhoneFirst.timerExpiresAtMillis,
    );
    assert.equal(ownerAfter.writes - ownerBefore.writes, 1);
    await assertUsageUnchanged(accountUsagePath(offerIds[0]), ownerAccountBefore);
    await assertUsageUnchanged(
      deviceUsagePath(phoneY, offerIds[0]),
      ownerDeviceBefore,
    );
    const ownerReplayBefore = snapshotMetrics();
    assert.deepEqual(
      await handleCustomerBiteSaverDeviceBoundUse(continuationRequest, contextY),
      continuation,
    );
    const ownerReplayAfter = snapshotMetrics();
    assert.equal(ownerReplayAfter.writes, ownerReplayBefore.writes);

    clock.value = currentPhoneSecond.timerExpiresAtMillis;
    const expiredReplayBefore = snapshotMetrics();
    const expiredReplay = await handleCustomerBiteSaverDeviceBoundUse(
      continuationRequest,
      contextY,
    );
    const expiredReplayAfter = snapshotMetrics();
    assert.deepEqual(expiredReplay, continuation);
    assert.equal(expiredReplay.timerExpiresAtMillis <= clock.value, true);
    assert.equal(expiredReplayAfter.writes, expiredReplayBefore.writes);
    const ownerExpiredPage = await savedPage("same_phone_owner_expired_page", contextY);
    const afterDeadline = await handleCustomerBiteSaverDeviceBoundUse(
      savedUseRequest(
        "same_phone_owner_after_deadline",
        offerIds[0],
        savedEntry(ownerExpiredPage, offerIds[0]).accessToken,
      ),
      contextY,
    );
    assert.equal(afterDeadline.status, "denied");
    assert.equal(afterDeadline.reason, "used");

    const remoteTimerPage = await savedPage("same_phone_remote_timer_page", contextX);
    const remoteTimer = await handleCustomerBiteSaverDeviceBoundUse(
      savedUseRequest(
        "same_phone_remote_timer",
        offerIds[1],
        savedEntry(remoteTimerPage, offerIds[1]).accessToken,
      ),
      contextX,
    );
    assert.equal(remoteTimer.status, "started");

    const signedBundle = await startSession({clock, uid});
    const signedSession = await markReady(signedBundle);
    const signedParent = readyRestaurantWrites(signedSession, 8_710, {
      accountId,
      offerCount: 2,
      onlyCoupons: true,
      preparationNowMs: clock.value,
      customerIdentityKeyV1: identityKeyV1,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(signedParent.writes);
    const signedPageResult = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(signedBundle, {
        clientRequestId: requestId("same_phone_signed_page"),
      }),
      signedBundle.context,
    );
    const signedOffer = signedPageResult.restaurants[0].offers.find((offer) =>
      offer.offerId === offerIds[1]);
    assert.notEqual(signedOffer, undefined);
    const reverseSavedPage = await savedPage(
      "same_phone_reverse_saved_page",
      contextY,
    );
    const reverseRequests = [{
      origin: "saved",
      request: savedUseRequest(
        "same_phone_reverse_saved",
        offerIds[1],
        savedEntry(reverseSavedPage, offerIds[1]).accessToken,
      ),
      context: contextY,
    }, {
      origin: "discovery",
      request: {
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        logicalRequestId: requestId("same_phone_reverse_discovery"),
        restaurantId: parent.publicRestaurantId,
        offerId: offerIds[1],
        timeZone: "America/New_York",
        utcOffsetMinutes: -240,
        currentCoordinates: null,
        origin: {
          kind: "discovery",
          clientInstanceId: signedBundle.clientInstanceId,
          sessionId: signedBundle.response.sessionId,
          capability: signedBundle.response.capability,
          criteriaFingerprint: signedBundle.response.criteriaFingerprint,
          offerOccurrence: signedOffer.offerOccurrence,
          guestStateRevision: null,
        },
      },
      context: {
        ...signedBundle.context,
        deviceEvidenceVerifier: contextY.deviceEvidenceVerifier,
      },
    }];
    const reverseAccountBefore = await database.getDocument(
      accountUsagePath(offerIds[1]),
    );
    const reverseDeviceBefore = await database.getDocument(
      deviceUsagePath(phoneY, offerIds[1]),
    );
    assert.equal(millis(reverseDeviceBefore.data.timerExpiresAt) <= clock.value, true);
    assert.equal(millis(reverseAccountBefore.data.timerExpiresAt) > clock.value, true);
    const reverseMeasurements = [];
    for (const scenario of reverseRequests) {
      const before = snapshotMetrics();
      const result = await handleCustomerBiteSaverDeviceBoundUse(
        scenario.request,
        scenario.context,
      );
      const after = snapshotMetrics();
      assert.equal(result.status, "denied", scenario.origin);
      assert.equal(result.reason, "used", scenario.origin);
      assert.equal(after.writes - before.writes, 1, scenario.origin);
      await assertUsageUnchanged(
        accountUsagePath(offerIds[1]),
        reverseAccountBefore,
      );
      await assertUsageUnchanged(
        deviceUsagePath(phoneY, offerIds[1]),
        reverseDeviceBefore,
      );
      const replayBefore = snapshotMetrics();
      assert.deepEqual(
        await handleCustomerBiteSaverDeviceBoundUse(
          scenario.request,
          scenario.context,
        ),
        result,
      );
      const replayAfter = snapshotMetrics();
      assert.equal(replayAfter.writes, replayBefore.writes, scenario.origin);
      reverseMeasurements.push({
        origin: scenario.origin,
        pointReads: after.pointReads - before.pointReads,
        queries: after.queries - before.queries,
        queryReads: after.queryReads - before.queryReads,
        writes: after.writes - before.writes,
      });
    }
    metrics.scenarioMeasurements.samePhoneTimerPolicy = {
      syntheticDeviceEvidenceBoundary: true,
      ownerApprovedContinuation: {
        status: continuation.status,
        preservedRedemptionId: continuation.redemptionId,
        preservedTimerStartedAtMillis: continuation.timerStartedAtMillis,
        preservedTimerExpiresAtMillis: continuation.timerExpiresAtMillis,
        writes: ownerAfter.writes - ownerBefore.writes,
        exactReplayWrites: ownerReplayAfter.writes - ownerReplayBefore.writes,
        expiredExactReplayWrites:
          expiredReplayAfter.writes - expiredReplayBefore.writes,
        afterDeadlineStatus: afterDeadline.status,
      },
      reverseCases: reverseMeasurements,
      usageRecordsUnchanged: true,
    };

    await database.commitWrites([
      {
        type: "delete",
        path: `${restaurantSearchIndexCollection}/${
          signedParent.parentProjection.indexDocumentId}`,
      },
      ...signedParent.coupons.map(({indexDocumentId}) => ({
        type: "delete",
        path: `${biteSaverOfferIndexCollection}/${indexDocumentId}`,
      })),
    ]);
  });

  test("installed SDK retries genuinely conflicting real adapter transactions",
    {timeout: 30_000}, async () => {
    const path = `${runNamespace}_transaction_rows/counter`;
    await seed(path, {value: 0});
    const participantCount = 4;
    const allInitialReads = deferred();
    const releaseInitialAttempts = deferred();
    let arrivals = 0;
    const localAttempts = Array(participantCount).fill(0);
    const attemptsBefore = metrics.transactionAttempts;
    const invocationsBefore = metrics.transactionInvocations;
    const operations = Array.from({length: participantCount}, (_, index) =>
      database.runTransaction(async (transaction) => {
        localAttempts[index] += 1;
        const current = await transaction.getDocument(path);
        assert.notEqual(current, null);
        if (localAttempts[index] === 1) {
          arrivals += 1;
          if (arrivals === participantCount) allInitialReads.resolve();
          await releaseInitialAttempts.promise;
        }
        transaction.setDocument(path, {value: current.data.value + 1});
      }));
    try {
      await bounded(allInitialReads.promise, "transaction contention barrier");
      releaseInitialAttempts.resolve();
      await bounded(Promise.all(operations), "conflicting adapter transactions");
    } finally {
      releaseInitialAttempts.resolve();
      await bounded(
        Promise.allSettled(operations),
        "transaction contention teardown",
        5_000,
      ).catch(() => {});
    }
    const final = await database.getDocument(path);
    assert.equal(final.data.value, participantCount);
    const invocations = metrics.transactionInvocations - invocationsBefore;
    const attempts = metrics.transactionAttempts - attemptsBefore;
    assert.equal(invocations, participantCount);
    assert.ok(attempts > invocations, `expected retries, observed ${attempts}/${invocations}`);
    assert.ok(localAttempts.some((count) => count > 1));
    metrics.scenarioMeasurements.forcedConflict = {invocations, attempts};
  });

  test("real worker pages ranges to ready with bounded maximum-domain summaries",
    {timeout: 120_000}, async () => {
    const seedWrites = [];
    const parentCount = 26;
    const maximumAccountPrefix = `${runNamespace}_worker_account_`;
    const maximumAccountId = maximumAccountPrefix + "a".repeat(
      customerBiteSaverMaximumIndexedOrderKeyBytes -
        Buffer.byteLength(maximumAccountPrefix, "utf8"),
    );
    assert.equal(
      Buffer.byteLength(maximumAccountId, "utf8"),
      customerBiteSaverMaximumIndexedOrderKeyBytes,
    );
    const maximumOfferId = (index) => {
      const suffix = index.toString(36).padStart(4, "0");
      const prefix = `${runNamespace}_`;
      return `${prefix}${"\"".repeat(1_500 - prefix.length - suffix.length)}${suffix}`;
    };
    for (let index = 0; index < parentCount; index += 1) {
      const accountId = index === 0
        ? maximumAccountId
        : index === 1
          ? `${maximumAccountPrefix}\u{10000}_supplementary`
          : index === 2
            ? `${maximumAccountPrefix}\ue000_bmp`
            : `${maximumAccountPrefix}${String(index).padStart(3, "0")}`;
      const restaurant = rawRestaurant(100 + index, {
        restaurantName: "Shared binary order restaurant",
      });
      const parentProjection = buildBiteSaverRestaurantIndex({
        sourceDocumentId: accountId,
        source: restaurant,
        now: new Date(fixedNowMs),
      });
      assert.notEqual(parentProjection, null);
      seedWrites.push(
        {type: "set", path: `restaurant_accounts/${accountId}`, data: restaurant},
        {
          type: "set",
          path: `${restaurantSearchIndexCollection}/${parentProjection.indexDocumentId}`,
          data: parentProjection,
        },
      );
      const offerCount = index === 0 ? 75 : 1;
      for (let offerIndex = 0; offerIndex < offerCount; offerIndex += 1) {
        const sourceDocumentId = index === 0
          ? maximumOfferId(offerIndex)
          : `${runNamespace}_worker_coupon_${index}_${offerIndex}`;
        assert.ok(Buffer.byteLength(sourceDocumentId, "utf8") <= 1_500);
        const coupon = rawCoupon(20_000 + index * 100 + offerIndex);
        const projection = buildBiteSaverCouponOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId,
          offer: coupon,
          restaurant,
          now: new Date(fixedNowMs),
        });
        assert.notEqual(projection, null);
        seedWrites.push(
          {
            type: "set",
            path: `restaurant_accounts/${accountId}/coupons/${sourceDocumentId}`,
            data: coupon,
          },
          {
            type: "set",
            path: `${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,
            data: projection,
          },
        );
      }
    }
    assert.equal(Buffer.byteLength(maximumOfferId(0), "utf8"), 1_500);
    await commitAll(seedWrites);

    const clock = {value: fixedNowMs};
    const bundle = await startSession({guest: true, clock});
    const phases = [];
    const iterationCounters = [];
    let session = await currentSession(bundle);
    for (let iteration = 0; session.data.state === "preparing"; iteration += 1) {
      assert.ok(iteration < 120, "real worker continuation did not converge");
      phases.push(session.data.phase);
      const counters = createCustomerBiteSaverWorkerCounters();
      const processed = await processCustomerBiteSaverSearchJob(
        session.data.currentJobId,
        {
          database,
          discoveryKey,
          identityKeyV1,
          now: () => clock.value,
          randomSource: (size) => randomBytes(size),
          counters,
        },
      );
      assert.equal(processed, true);
      iterationCounters.push({...counters});
      session = await currentSession(bundle);
    }
    assert.equal(session.data.state, "ready");
    assert.equal(session.data.phase, "ready");
    assert.ok(phases.filter((phase) => phase === "restaurantRanges").length >= 2);
    assert.ok(phases.filter((phase) => phase === "offerRanges").length >= 3);
    assert.ok(phases.includes("finalizeCandidates"));
    assert.ok(phases.includes("verifyCatalogGeneration"));
    assert.ok(iterationCounters.every((entry) =>
      entry.writesCommittedMaximum < customerBiteSaverMaximumWritesPerCommit + 1));
    assert.ok(iterationCounters.every((entry) =>
      entry.sourceDocumentsProcessed <= customerBiteSaverWorkerSourceLimit));
    assert.ok(iterationCounters.every((entry) =>
      entry.rangesAdvanced <= customerBiteSaverRangesPerWorker));
    assert.ok(iterationCounters.every((entry) =>
      entry.candidateIdentitiesRetained <= customerBiteSaverWorkerSourceLimit));
    assert.ok(iterationCounters.every((entry) =>
      entry.firestoreOperationsInFlightMaximum <=
        customerBiteSaverMaximumConcurrentOperations));

    const readySession = session.data;
    const results = [];
    let startAfter;
    while (true) {
      const page = await database.queryDocuments(customerBiteSaverOrderedResultQuery({
        session: readySession,
        ...(startAfter === undefined ? {} : {startAfter}),
        limit: 26,
      }));
      results.push(...page);
      if (page.length < 26) break;
      const last = page.at(-1).data;
      startAfter = [
        last.exactPreferenceRank,
        last.distanceSortMiles,
        last.lowercaseDisplayNameOrderKey,
        dartUtf16FirestoreBytesCursorValue(
          last.authoritativeAccountIdOrderKey,
          customerBiteSaverMaximumIndexedOrderKeyBytes,
        ),
      ];
    }
    assert.equal(
      results.length,
      parentCount,
      JSON.stringify({
        maximumPresent: results.some(({data}) =>
          data.authoritativeAccountId === maximumAccountId),
        accountIds: results.map(({data}) => data.authoritativeAccountId),
      }),
    );
    assert.deepEqual(
      results.map(({data}) => data.authoritativeAccountId),
      results.map(({data}) => data.authoritativeAccountId)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    );
    const maximumResult = results.find(({data}) =>
      data.authoritativeAccountId === maximumAccountId);
    assert.notEqual(maximumResult, undefined);
    assert.equal(maximumResult.data.usableOfferCountAtPreparation, 75);
    assert.ok(maximumResult.data.previewCouponCandidates.length <=
      customerBiteSaverWorkerPreviewSummaryLimit);
    assert.ok(jsonBytes(maximumResult.data) <= customerBiteSaverMaximumResultDocumentBytes);

    const prefix = customerBiteSaverCandidatePrefix(
      readySession.sessionId,
      readySession.attemptGeneration,
    );
    const candidates = await database.queryDocuments({
      collectionPath: privateCustomerBiteSaverCandidateCollection,
      filters: [
        {field: "__name__", operation: ">=", value: prefix},
        {field: "__name__", operation: "<=", value: `${prefix}\uf8ff`},
      ],
      orders: [{field: "__name__", direction: "asc"}],
      limit: 101,
    });
    assert.equal(candidates.length, parentCount);
    const maximumCandidate = candidates.find(({data}) =>
      data.authoritativeAccountId === maximumAccountId);
    assert.notEqual(maximumCandidate, undefined);
    assert.equal(maximumCandidate.data.usableOfferCount, 75);
    assert.ok(maximumCandidate.data.previewCouponCandidates.length <=
      customerBiteSaverWorkerPreviewSummaryLimit);
    assert.ok(jsonBytes(maximumCandidate.data) <=
      customerBiteSaverMaximumCandidateDocumentBytes);
    metrics.scenarioMeasurements.worker = {
      iterations: phases.length,
      results: results.length,
      maximumCandidateJsonBytes: jsonBytes(maximumCandidate.data),
      maximumResultJsonBytes: jsonBytes(maximumResult.data),
      maximumOfferIdentityUtf8Bytes: Buffer.byteLength(maximumOfferId(0), "utf8"),
    };
  });

  test("real menu adapter resolves own and reciprocal shared sources with bounded continuation",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const ownBundle = await startSession({clock});
    const ownSession = await markReady(ownBundle);
    const ownParent = readyRestaurantWrites(ownSession, 790, {
      offerCount: 1,
      onlyCoupons: true,
      restaurant: {menuSourceSide: "biteSaver"},
    });
    const ownMenuWrites = [
      {
        type: "set",
        path: `restaurant_accounts/${ownParent.accountId}/menu_images/a_image`,
        data: {
          imageUrl: "https://images.example.test/menu-a.webp",
          sortOrder: 10,
          privateCanary: "own-image-private",
        },
      },
      {
        type: "set",
        path: `restaurant_accounts/${ownParent.accountId}/menu_images/b_image`,
        data: {
          imageUrl: "https://images.example.test/menu-b.webp",
          sortOrder: -1,
        },
      },
    ];
    for (let index = 0; index < 27; index += 1) {
      const suffix = String(index).padStart(2, "0");
      ownMenuWrites.push({
        type: "set",
        path: `restaurant_accounts/${ownParent.accountId}/menu_items/own_item_${suffix}`,
        data: {
          name: `Own item ${suffix}`,
          description: `Description ${suffix}`,
          price: index % 2 === 0 ? `$${index}.00` : "",
          category: index % 2 === 0 ? "Lunch" : "Dinner",
          sortOrder: 27 - index,
          ownerUserId: "own-private-canary",
        },
      });
    }
    ownMenuWrites.push({
      type: "set",
      path: `restaurant_accounts/${ownParent.accountId}/menu_sections/z_section`,
      data: {
        title: "Own section",
        body: "Own section body",
        sortOrder: 2,
        privateNotes: "own-section-private",
      },
    });
    await commitAll([...ownParent.writes, ...ownMenuWrites]);
    const ownDelivery = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(ownBundle),
      ownBundle.context,
    );
    assert.equal(
      ownDelivery.restaurants.some(({restaurantId}) =>
        restaurantId === ownParent.publicRestaurantId),
      true,
    );

    const ownMenuQueries = [];
    hooks.beforeQuery = async (query) => {
      if (query.collectionPath.startsWith(
        `restaurant_accounts/${ownParent.accountId}/menu_`,
      )) ownMenuQueries.push(query);
    };
    const writesBeforeOwnMenu = metrics.transactionWritesCommitted +
      metrics.commitWrites;
    const ownFirstBefore = {
      pointReads: metrics.pointReadRequests,
      queries: metrics.queryCalls,
      queryReads: metrics.queryReadResults,
    };
    let ownFirstAfter;
    let ownSecondAfter;
    let ownFirst;
    let ownSecond;
    try {
      ownFirst = await getCustomerBiteSaverMenuPageHandler(
        menuPageRequest(ownBundle, ownParent.publicRestaurantId),
        ownBundle.context,
      );
      ownFirstAfter = {
        pointReads: metrics.pointReadRequests,
        queries: metrics.queryCalls,
        queryReads: metrics.queryReadResults,
      };
      ownSecond = await getCustomerBiteSaverMenuPageHandler(
        menuPageRequest(ownBundle, ownParent.publicRestaurantId, {
          cursor: ownFirst.nextCursor,
        }),
        ownBundle.context,
      );
      ownSecondAfter = {
        pointReads: metrics.pointReadRequests,
        queries: metrics.queryCalls,
        queryReads: metrics.queryReadResults,
      };
    } finally {
      hooks.beforeQuery = null;
    }
    assert.equal(ownFirst.entries.length, customerBiteSaverMenuPageSize);
    assert.deepEqual(
      ownFirst.entries.slice(0, 2).map(({kind}) => kind),
      ["image", "image"],
    );
    assert.deepEqual(
      ownFirst.entries.slice(2).map(({name}) => name),
      Array.from({length: 23}, (_, index) =>
        `Own item ${String(index).padStart(2, "0")}`),
    );
    assert.equal(ownFirst.hasMore, true);
    assert.notEqual(ownFirst.nextCursor, null);
    assert.equal(ownSecond.entries.length, 5);
    assert.deepEqual(
      ownSecond.entries.slice(0, 4).map(({name}) => name),
      ["Own item 23", "Own item 24", "Own item 25", "Own item 26"],
    );
    assert.equal(ownSecond.entries[4].kind, "section");
    assert.equal(ownSecond.hasMore, false);
    assert.equal(ownSecond.nextCursor, null);
    assert.equal(
      new Set([...ownFirst.entries, ...ownSecond.entries]
        .map(({key}) => key)).size,
      30,
    );
    const ownWire = JSON.stringify([ownFirst, ownSecond]);
    assert.equal(ownWire.includes("private-canary"), false);
    assert.equal(ownWire.includes("ownerUserId"), false);
    assert.equal(ownWire.includes(ownParent.accountId), false);
    assert.equal(
      metrics.transactionWritesCommitted + metrics.commitWrites,
      writesBeforeOwnMenu,
    );
    assert.deepEqual({
      pointReads: ownFirstAfter.pointReads - ownFirstBefore.pointReads,
      queries: ownFirstAfter.queries - ownFirstBefore.queries,
      queryReads: ownFirstAfter.queryReads - ownFirstBefore.queryReads,
      writes: 0,
    }, {pointReads: 6, queries: 2, queryReads: 28, writes: 0});
    assert.deepEqual({
      pointReads: ownSecondAfter.pointReads - ownFirstAfter.pointReads,
      queries: ownSecondAfter.queries - ownFirstAfter.queries,
      queryReads: ownSecondAfter.queryReads - ownFirstAfter.queryReads,
      writes: 0,
    }, {pointReads: 6, queries: 2, queryReads: 5, writes: 0});
    assert.equal(ownMenuQueries.length, 4);
    assert.ok(ownMenuQueries.every((query) =>
      query.filters.length === 0 &&
      query.orders.length === 1 &&
      query.orders[0].field === "__name__" &&
      query.orders[0].direction === "asc" &&
      query.limit > 0 && query.limit <= 26));
    assert.deepEqual(
      ownMenuQueries.map(({collectionPath}) => collectionPath),
      [
        `restaurant_accounts/${ownParent.accountId}/menu_images`,
        `restaurant_accounts/${ownParent.accountId}/menu_items`,
        `restaurant_accounts/${ownParent.accountId}/menu_items`,
        `restaurant_accounts/${ownParent.accountId}/menu_sections`,
      ],
    );
    assert.deepEqual(ownMenuQueries[2].startAfter, ["own_item_22"]);

    const sharedBundle = await startSession({clock});
    const sharedSession = await markReady(sharedBundle);
    const scoreId = `${runNamespace}_score_menu`;
    const sharedMenuId = `${runNamespace}_shared_menu`;
    const sharedOwnerId = `${runNamespace}_different_owner`;
    const bindingId = Buffer.alloc(32, 29).toString("base64url");
    const sharedParent = readyRestaurantWrites(sharedSession, 791, {
      offerCount: 1,
      onlyCoupons: true,
      restaurant: {
        menuSourceSide: "biteScore",
        linkedBiteScoreRestaurantId: scoreId,
        biteScoreCatalogRestaurantId: scoreId,
        biteSaverCatalogBindingId: bindingId,
      },
    });
    await commitAll([
      ...sharedParent.writes,
      {
        type: "set",
        path: `bitescore_restaurants/${scoreId}`,
        data: {
          isActive: true,
          active: true,
          isClaimed: true,
          ownerUserId: sharedOwnerId,
          menuSourceSide: "biteScore",
          sharedMenuId,
          restaurantWriteRevision: 9,
          biteSaverCatalogBindingId: bindingId,
        },
      },
      {
        type: "set",
        path: `restaurant_menus/${sharedMenuId}`,
        data: {
          bitescoreRestaurantId: scoreId,
          createdByUserId: sharedOwnerId,
          privateCanary: "shared-parent-private",
        },
      },
      {
        type: "set",
        path: `restaurant_menus/${sharedMenuId}/menu_sections/shared_section`,
        data: {
          title: "Shared section",
          body: "Shared body",
          sortOrder: 1,
          createdByUserId: sharedOwnerId,
        },
      },
    ]);
    await getCustomerBiteSaverSearchPageHandler(
      pageRequest(sharedBundle),
      sharedBundle.context,
    );
    const sharedMenuQueries = [];
    hooks.beforeQuery = async (query) => {
      if (query.collectionPath.startsWith(
        `restaurant_menus/${sharedMenuId}/menu_`,
      )) sharedMenuQueries.push(query);
    };
    const sharedBefore = {
      pointReads: metrics.pointReadRequests,
      queries: metrics.queryCalls,
      queryReads: metrics.queryReadResults,
      writes: metrics.transactionWritesCommitted + metrics.commitWrites,
    };
    let shared;
    try {
      shared = await getCustomerBiteSaverMenuPageHandler(
        menuPageRequest(sharedBundle, sharedParent.publicRestaurantId),
        sharedBundle.context,
      );
    } finally {
      hooks.beforeQuery = null;
    }
    const sharedAfter = {
      pointReads: metrics.pointReadRequests,
      queries: metrics.queryCalls,
      queryReads: metrics.queryReadResults,
      writes: metrics.transactionWritesCommitted + metrics.commitWrites,
    };
    assert.equal(shared.menuStyle, "biteScore");
    assert.deepEqual(shared.entries.map(({kind}) => kind), ["section"]);
    assert.equal(shared.hasMore, false);
    assert.deepEqual(
      sharedMenuQueries.map(({collectionPath}) => collectionPath),
      [
        `restaurant_menus/${sharedMenuId}/menu_images`,
        `restaurant_menus/${sharedMenuId}/menu_items`,
        `restaurant_menus/${sharedMenuId}/menu_sections`,
      ],
    );
    const sharedWire = JSON.stringify(shared);
    assert.equal(sharedWire.includes(sharedMenuId), false);
    assert.equal(sharedWire.includes(sharedOwnerId), false);
    assert.equal(sharedWire.includes("createdByUserId"), false);
    assert.deepEqual({
      pointReads: sharedAfter.pointReads - sharedBefore.pointReads,
      queries: sharedAfter.queries - sharedBefore.queries,
      queryReads: sharedAfter.queryReads - sharedBefore.queryReads,
      writes: sharedAfter.writes - sharedBefore.writes,
    }, {pointReads: 10, queries: 3, queryReads: 1, writes: 0});
    metrics.scenarioMeasurements.menu = {
      ownVisibleEntries: ownFirst.entries.length + ownSecond.entries.length,
      ownQueries: ownMenuQueries.length,
      ownInitialPointReads: 6,
      ownInitialQueryReads: 28,
      ownContinuationPointReads: 6,
      ownContinuationQueryReads: 5,
      sharedQueries: sharedMenuQueries.length,
      sharedPointReads: 10,
      sharedQueryReads: 1,
      menuWrites: 0,
      maximumVisibleEntriesPerPage: customerBiteSaverMenuPageSize,
      maximumQueryLimit: Math.max(...ownMenuQueries.map(({limit}) => limit)),
    };
  });

  test("signed pages reject unusable lookahead, preserve witnesses, and issue favorite evidence",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({clock});
    const session = await markReady(bundle);
    const seeded = [];
    const writes = [];
    for (let index = 0; index < 25; index += 1) {
      const entry = readyRestaurantWrites(session, index, {
        offerCount: 1,
        onlyCoupons: true,
      });
      seeded.push(entry);
      writes.push(...entry.writes);
    }
    writes.push(unavailableResultWrite(session, 25));
    const witness = readyRestaurantWrites(session, 26, {
      offerCount: 1,
      onlyCoupons: true,
    });
    seeded.push(witness);
    writes.push(...witness.writes);
    await commitAll(writes);

    const firstRestaurant = seeded[0];
    const firstPreparedOfferId = customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      firstRestaurant.accountId,
      "coupon",
      firstRestaurant.coupons[0].sourceDocumentId,
    );
    const favoriteReadsBefore = metrics.getDocumentsCalls;
    const favoriteDocumentReadsBefore = metrics.favoritePointReadRequests;
    const prepared = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(bundle, {
        restaurantIds: [firstRestaurant.publicRestaurantId],
        offerIds: [firstPreparedOfferId],
      }),
      bundle.context,
    );
    assert.deepEqual(prepared.states.map(({state}) => state), ["unknown", "unknown"]);
    assert.equal(metrics.getDocumentsCalls, favoriteReadsBefore + 1);
    assert.equal(metrics.favoritePointReadRequests, favoriteDocumentReadsBefore);

    const first = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(bundle),
      bundle.context,
    );
    assertEvaluationContext(first.evaluationContext, bundle, fixedNowMs);
    assert.equal(first.evaluationContext.timeZone, "America/New_York");
    assert.equal(first.evaluationContext.utcOffsetMinutes, -240);
    assert.equal(first.restaurants[0].offers[0].usagePolicy, "unlimited");
    assert.equal(first.restaurants.length, customerBiteSaverPageSize);
    assert.equal(first.hasMore, true);
    assert.notEqual(first.nextCursor, null);
    assert.equal(first.restaurants.some(({restaurantId}) =>
      restaurantId === witness.publicRestaurantId), false);
    await commitAll([
      {
        type: "set",
        path: `user_profiles/${bundle.uid}/favorite_restaurants/` +
          `bitesaver_account_${firstRestaurant.accountId}`,
        data: {restaurantAccountId: firstRestaurant.accountId},
      },
      {
        type: "set",
        path: `user_profiles/${bundle.uid}/favorite_coupons/${
          firstRestaurant.coupons[0].sourceDocumentId}`,
        data: {
          restaurantAccountId: firstRestaurant.accountId,
          couponId: firstRestaurant.coupons[0].sourceDocumentId,
          offerType: "coupon",
        },
      },
    ]);
    const mixedFavoriteReadsBefore = metrics.favoritePointReadRequests;
    const mixed = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(bundle, {
        restaurantIds: [
          first.restaurants[0].restaurantId,
          witness.publicRestaurantId,
        ],
        offerIds: [first.restaurants[0].offers[0].offerId],
      }),
      bundle.context,
    );
    assert.deepEqual(mixed.states.map(({state}) => state), [
      "unknown",
      "unknown",
      "unknown",
    ]);
    assert.equal(metrics.favoritePointReadRequests, mixedFavoriteReadsBefore);
    const second = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(bundle, {cursor: first.nextCursor}),
      bundle.context,
    );
    assertEvaluationContext(second.evaluationContext, bundle, fixedNowMs);
    assert.equal(second.restaurants[0].offers[0].usagePolicy, "unlimited");
    assert.deepEqual(
      second.restaurants.map(({restaurantId}) => restaurantId),
      [witness.publicRestaurantId],
    );
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);

    const legacyOnlyReadsBefore = metrics.favoritePointReadRequests;
    const legacyOnly = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(bundle, {
        restaurantIds: [firstRestaurant.publicRestaurantId],
        offerIds: [firstPreparedOfferId],
      }),
      bundle.context,
    );
    assert.deepEqual(
      legacyOnly.states.map(({state}) => state),
      ["notFavorite", "notFavorite"],
    );
    assert.equal(
      metrics.favoritePointReadRequests,
      legacyOnlyReadsBefore + 2,
    );

    await commitAll([
      {
        type: "set",
        path: `user_profiles/${bundle.uid}/favorite_restaurants/` +
          firstRestaurant.publicRestaurantId,
        data: canonicalRestaurantFavorite(
          bundle.uid,
          firstRestaurant.publicRestaurantId,
        ),
      },
      {
        type: "set",
        path: `user_profiles/${bundle.uid}/favorite_coupons/${
          firstPreparedOfferId}`,
        data: canonicalCouponFavorite(
          bundle.uid,
          firstRestaurant.publicRestaurantId,
          firstPreparedOfferId,
        ),
      },
    ]);
    const authorized = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(bundle, {
        restaurantIds: [firstRestaurant.publicRestaurantId],
        offerIds: [firstPreparedOfferId],
      }),
      bundle.context,
    );
    assert.deepEqual(authorized.states.map(({state}) => state), ["favorite", "favorite"]);
    assert.ok(metrics.favoritePointReadRequests > favoriteDocumentReadsBefore);
    const restaurantEvidence =
      (await documentsWithRole("deliveredRestaurantIdentity"))
        .filter(({data}) => data.sessionId === bundle.response.sessionId);
    const offerEvidence = (await documentsWithRole("deliveredOfferIdentity"))
      .filter(({data}) => data.sessionId === bundle.response.sessionId);
    assert.equal(restaurantEvidence.length, 26);
    assert.equal(offerEvidence.length, 26);

    const exhaustionBundle = await startSession({clock});
    const exhaustionSession = await markReady(exhaustionBundle);
    const exhaustionWrites = [];
    for (let index = 100; index < 125; index += 1) {
      exhaustionWrites.push(...readyRestaurantWrites(exhaustionSession, index, {
        offerCount: 1,
        onlyCoupons: true,
      }).writes);
    }
    exhaustionWrites.push(unavailableResultWrite(exhaustionSession, 125));
    await commitAll(exhaustionWrites);
    const exhausted = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(exhaustionBundle),
      exhaustionBundle.context,
    );
    assert.equal(exhausted.restaurants.length, 25);
    assert.equal(exhausted.hasMore, false);
    assert.equal(exhausted.nextCursor, null);
    assert.equal(exhausted.partial, false);
  });

  test("favorite states fail closed in order for corrupt persisted result backing",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({clock});
    const session = await markReady(bundle);
    const first = readyRestaurantWrites(session, 901, {
      offerCount: 1,
      onlyCoupons: true,
    });
    const second = readyRestaurantWrites(session, 902, {
      offerCount: 1,
      onlyCoupons: true,
    });
    await commitAll([...first.writes, ...second.writes]);
    const issued = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(bundle),
      bundle.context,
    );
    const issuedByRestaurantId = new Map(issued.restaurants.map((restaurant) =>
      [restaurant.restaurantId, restaurant]));
    const firstOfferId = issuedByRestaurantId.get(first.publicRestaurantId)
      ?.offers[0]?.offerId;
    const secondOfferId = issuedByRestaurantId.get(second.publicRestaurantId)
      ?.offers[0]?.offerId;
    assert.equal(typeof firstOfferId, "string");
    assert.equal(typeof secondOfferId, "string");
    const restaurantIds = [second.publicRestaurantId, first.publicRestaurantId];
    const offerIds = [firstOfferId, secondOfferId];
    const orderedIds = [...restaurantIds, ...offerIds];

    // A valid authorization chain plus absent canonical favorite documents is
    // the positive control: absence alone is a definitive notFavorite state.
    const missing = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(bundle, {restaurantIds, offerIds}),
      bundle.context,
    );
    assert.deepEqual(missing.states, orderedIds.map((id) => ({
      id,
      state: "notFavorite",
    })));

    const malformedBackings = [
      {
        label: "extra-field",
        data: {...first.result, unexpectedPrivateField: true},
      },
      {
        label: "identity-mismatch",
        data: {...first.result, authoritativeAccountId: second.accountId},
      },
    ];
    for (const backing of malformedBackings) {
      await seed(first.resultPath, backing.data);
      const favoriteReadsBefore = metrics.favoritePointReadRequests;
      const failedClosed = await getCustomerBiteSaverFavoriteStatesHandler(
        favoriteRequest(bundle, {
          clientRequestId: requestId(`favorite-${backing.label}`),
          restaurantIds,
          offerIds,
        }),
        bundle.context,
      );
      assert.deepEqual(failedClosed.states, orderedIds.map((id) => ({
        id,
        state: "unknown",
      })));
      assert.equal(metrics.favoritePointReadRequests, favoriteReadsBefore);
    }
    await seed(first.resultPath, first.result);
    metrics.scenarioMeasurements.favoriteBackingFailClosed = {
      requestedStates: orderedIds.length,
      missingCanonicalStates: missing.states.length,
      malformedBackingCases: malformedBackings.length,
      favoriteReadsAfterInvalidBacking: 0,
    };
  });

  test("signed offer pages preserve the usable 27th witness and prove final exhaustion",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({clock});
    const session = await markReady(bundle);
    const parent = readyRestaurantWrites(session, 200, {
      offerCount: 27,
      onlyCoupons: true,
    });
    await commitAll(parent.writes);
    await database.commitWrites([{
      type: "delete",
      path: `restaurant_accounts/${parent.accountId}/coupons/${
        parent.coupons[25].sourceDocumentId}`,
    }]);
    const witnessOfferId = customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      parent.accountId,
      "coupon",
      parent.coupons[26].sourceDocumentId,
    );
    const first = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(bundle, parent.publicRestaurantId),
      bundle.context,
    );
    assert.equal(first.offers.length, 25);
    assert.equal(first.hasMore, true);
    assert.notEqual(first.nextCursor, null);
    assert.equal(first.offers.some(({offerId}) => offerId === witnessOfferId), false);
    const favoriteReadsBeforeWitness = metrics.favoritePointReadRequests;
    const beforeWitnessIssuance = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(bundle, {offerIds: [witnessOfferId]}),
      bundle.context,
    );
    assert.deepEqual(beforeWitnessIssuance.states, [
      {id: witnessOfferId, state: "unknown"},
    ]);
    assert.equal(metrics.favoritePointReadRequests, favoriteReadsBeforeWitness);
    const second = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(bundle, parent.publicRestaurantId, {cursor: first.nextCursor}),
      bundle.context,
    );
    assert.deepEqual(second.offers.map(({offerId}) => offerId), [witnessOfferId]);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);

    const exhaustedBundle = await startSession({clock});
    const exhaustedSession = await markReady(exhaustedBundle);
    const exhaustedParent = readyRestaurantWrites(exhaustedSession, 201, {
      offerCount: 26,
      onlyCoupons: true,
    });
    await commitAll(exhaustedParent.writes);
    await database.commitWrites([{
      type: "delete",
      path: `restaurant_accounts/${exhaustedParent.accountId}/coupons/${
        exhaustedParent.coupons[25].sourceDocumentId}`,
    }]);
    const exhausted = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(exhaustedBundle, exhaustedParent.publicRestaurantId),
      exhaustedBundle.context,
    );
    assert.equal(exhausted.offers.length, 25);
    assert.equal(exhausted.hasMore, false);
    assert.equal(exhausted.nextCursor, null);
    assert.equal(exhausted.partial, false);
  });

  test("signed page budgets persist truthful partial boundaries for both page types",
    {timeout: 180_000}, async () => {
    const clock = {value: fixedNowMs};
    const restaurantBundle = await startSession({clock});
    const restaurantSession = await markReady(restaurantBundle);
    const restaurantRows = [];
    const restaurantWrites = [];
    for (let index = 600; index < 701; index += 1) {
      const entry = readyRestaurantWrites(restaurantSession, index, {
        offerCount: 1,
        onlyCoupons: true,
      });
      restaurantRows.push(entry);
      restaurantWrites.push(...entry.writes);
    }
    await commitAll(restaurantWrites);
    await commitAll(restaurantRows.slice(25, 100).map(({accountId}) => ({
      type: "delete",
      path: `restaurant_accounts/${accountId}`,
    })));
    const restaurantRequest = pageRequest(restaurantBundle, {
      clientRequestId: requestId("restaurant-budget"),
    });
    const restaurantPartial = await getCustomerBiteSaverSearchPageHandler(
      restaurantRequest,
      restaurantBundle.context,
    );
    assert.equal(restaurantPartial.restaurants.length, 25);
    assert.equal(restaurantPartial.partial, true);
    assert.equal(restaurantPartial.hasMore, true);
    assert.notEqual(restaurantPartial.nextCursor, null);
    assert.deepEqual(
      await getCustomerBiteSaverSearchPageHandler(
        restaurantRequest,
        restaurantBundle.context,
      ),
      restaurantPartial,
    );
    const restaurantContinued = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(restaurantBundle, {cursor: restaurantPartial.nextCursor}),
      restaurantBundle.context,
    );
    assert.deepEqual(
      restaurantContinued.restaurants.map(({restaurantId}) => restaurantId),
      [restaurantRows[100].publicRestaurantId],
    );
    assert.equal(restaurantContinued.partial, false);
    assert.equal(restaurantContinued.hasMore, false);

    const offerBundle = await startSession({clock});
    const offerSession = await markReady(offerBundle);
    const offerParent = readyRestaurantWrites(offerSession, 710, {
      offerCount: 101,
      onlyCoupons: true,
    });
    await commitAll(offerParent.writes);
    await commitAll(offerParent.coupons.slice(25, 100).map((candidate) => ({
      type: "delete",
      path: `restaurant_accounts/${offerParent.accountId}/coupons/${
        candidate.sourceDocumentId}`,
    })));
    const offerRequest = offerPageRequest(
      offerBundle,
      offerParent.publicRestaurantId,
      {clientRequestId: requestId("offer-budget")},
    );
    const offerPartial = await getCustomerBiteSaverOfferPageHandler(
      offerRequest,
      offerBundle.context,
    );
    assertEvaluationContext(
      offerPartial.evaluationContext,
      offerBundle,
      fixedNowMs,
    );
    assert.equal(offerPartial.offers[0].usagePolicy, "unlimited");
    assert.equal(offerPartial.offers.length, 25);
    assert.equal(offerPartial.partial, true);
    assert.equal(offerPartial.hasMore, true);
    assert.notEqual(offerPartial.nextCursor, null);
    assert.deepEqual(
      await getCustomerBiteSaverOfferPageHandler(
        offerRequest,
        offerBundle.context,
      ),
      offerPartial,
    );
    const offerContinued = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(offerBundle, offerParent.publicRestaurantId, {
        cursor: offerPartial.nextCursor,
      }),
      offerBundle.context,
    );
    assertEvaluationContext(
      offerContinued.evaluationContext,
      offerBundle,
      fixedNowMs,
    );
    const finalOfferId = customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      offerParent.accountId,
      "coupon",
      offerParent.coupons[100].sourceDocumentId,
    );
    assert.deepEqual(offerContinued.offers.map(({offerId}) => offerId), [finalOfferId]);
    assert.equal(offerContinued.partial, false);
    assert.equal(offerContinued.hasMore, false);
    metrics.scenarioMeasurements.pageBudgets = {
      consumedPerCallBound: 100,
      restaurantRejectedLookahead: 75,
      offerRejectedLookahead: 75,
    };
  });

  test("redemption logical fence survives changed transports and concurrent first attempts",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({clock});
    const session = await markReady(bundle);
    const parent = readyRestaurantWrites(session, 300, {
      offerCount: 2,
      onlyCoupons: true,
    });
    await commitAll(parent.writes);
    const page = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(bundle),
      bundle.context,
    );
    const [firstOffer, secondOffer] = page.restaurants[0].offers;
    assertEvaluationContext(page.evaluationContext, bundle, fixedNowMs);
    assert.equal(firstOffer.usagePolicy, "unlimited");
    assert.equal(secondOffer.usagePolicy, "unlimited");
    const logicalId = requestId("shared-redemption-logical");
    const request = redemptionRequest(
      bundle,
      parent.publicRestaurantId,
      firstOffer,
      {redemptionRequestId: logicalId},
    );
    const concurrentAttemptsBefore = metrics.transactionAttempts;
    const concurrentInvocationsBefore = metrics.transactionInvocations;
    const concurrent = await bounded(Promise.all([
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {...request, clientRequestId: requestId("transport-a")},
        bundle.context,
      ),
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {...request, clientRequestId: requestId("transport-b")},
        bundle.context,
      ),
    ]), "concurrent logical redemption reservation");
    const concurrentTransactionInvocations =
      metrics.transactionInvocations - concurrentInvocationsBefore;
    const concurrentTransactionAttempts =
      metrics.transactionAttempts - concurrentAttemptsBefore;
    assert.ok(concurrent.every(({allowed}) => allowed));
    assert.equal(
      concurrent[0].validationExpiresAtMillis,
      concurrent[1].validationExpiresAtMillis,
    );
    assert.equal(concurrent[0].evaluatedAtMillis, fixedNowMs);
    assert.equal(concurrent[1].evaluatedAtMillis, fixedNowMs);
    assert.equal(concurrent[0].usagePolicy, "unlimited");
    assert.equal(concurrent[1].usagePolicy, "unlimited");
    assertEvaluationContext(
      concurrent[0].evaluationContext,
      bundle,
      fixedNowMs,
    );
    assert.deepEqual(
      concurrent[1].evaluationContext,
      concurrent[0].evaluationContext,
    );
    const originalDeadline = concurrent[0].validationExpiresAtMillis;
    assert.equal(originalDeadline, fixedNowMs + 60_000);
    assert.equal(
      concurrent[0].evaluationContext.validUntilExclusiveMillis,
      originalDeadline,
    );

    clock.value = fixedNowMs + 59_999;
    const replay = await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: requestId("transport-before-expiry")},
      bundle.context,
    );
    assert.equal(replay.allowed, true);
    assert.equal(replay.evaluatedAtMillis, fixedNowMs);
    assert.equal(replay.validationExpiresAtMillis, originalDeadline);
    assert.deepEqual(replay.evaluationContext, concurrent[0].evaluationContext);
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        redemptionRequest(bundle, parent.publicRestaurantId, secondOffer, {
          clientRequestId: requestId("transport-rebind"),
          redemptionRequestId: logicalId,
        }),
        bundle.context,
      ),
      contractError("invalid-argument"),
    );
    clock.value = originalDeadline;
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {...request, clientRequestId: requestId("transport-at-expiry")},
        bundle.context,
      ),
      contractError("failed-precondition"),
    );
    const logicalReservations = await documentsWithRole("logicalRedemptionReplay");
    const reservationsForSession = logicalReservations.filter(({data}) =>
      data.sessionId === bundle.response.sessionId);
    assert.equal(reservationsForSession.length, 1);
    assert.equal(
      millis(reservationsForSession[0].data.logicalExpiresAt),
      originalDeadline,
    );
    metrics.scenarioMeasurements.redemptionContention = {
      transactionInvocations: concurrentTransactionInvocations,
      transactionAttempts: concurrentTransactionAttempts,
      authoritativeLogicalReservations: reservationsForSession.length,
      fixedEvaluationAtMillis: concurrent[0].evaluatedAtMillis,
      fixedDeadlineMillis: originalDeadline,
    };
  });

  test("real adapter carries the exact New York daily-use context through signed and guest replay",
    {timeout: 120_000}, async () => {
    const completionAtMs = Date.parse("2026-03-08T04:30:00.000Z");
    const evaluationAtMs = Date.parse("2026-03-08T07:30:00.000Z");
    const expectedUnavailableWindows = [{
      startAtMillisInclusive: Date.parse("2026-03-08T05:01:00.000Z"),
      endAtMillisExclusive: evaluationAtMs + 1,
    }];
    const isUnavailableCompletion = (context, completedAtMs) =>
      context.oncePerDayUnavailableWindows.some((window) =>
        window.startAtMillisInclusive <= completedAtMs &&
        completedAtMs < window.endAtMillisExclusive);

    const signedClock = {value: evaluationAtMs};
    const signedBundle = await startSession({
      clock: signedClock,
      uid: requestId("ny-daily-signed-user"),
    });
    const signedSession = await markReady(signedBundle);
    const signedParent = readyRestaurantWrites(signedSession, 904, {
      preparationNowMs: evaluationAtMs,
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per day"},
    });
    await commitAll(signedParent.writes);
    const signedOfferId = customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      signedParent.accountId,
      "coupon",
      signedParent.coupons[0].sourceDocumentId,
    );
    const timerStartedAt = new Date(completionAtMs - 5 * 60_000);
    await seed(
      `customer_redemptions/${signedBundle.uid}/coupon_redemptions/${
        signedOfferId}`,
      {
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        userId: signedBundle.uid,
        restaurantId: signedParent.publicRestaurantId,
        offerId: signedOfferId,
        offerType: "coupon",
        redemptionId: `bsrd_${Buffer.alloc(32, 89).toString("base64url")}`,
        timerStartedAt,
        timerExpiresAt: new Date(completionAtMs),
        createdAt: new Date(timerStartedAt.getTime()),
        updatedAt: new Date(timerStartedAt.getTime()),
      },
    );

    const signedRequest = pageRequest(signedBundle, {
      clientRequestId: requestId("ny-daily-signed-page"),
    });
    const signedPage = await getCustomerBiteSaverSearchPageHandler(
      signedRequest,
      signedBundle.context,
    );
    assertEvaluationContext(
      signedPage.evaluationContext,
      signedBundle,
      evaluationAtMs,
    );
    assert.equal(signedPage.evaluationContext.timeZone, "America/New_York");
    assert.equal(signedPage.evaluationContext.utcOffsetMinutes, -240);
    assert.deepEqual(
      signedPage.evaluationContext.oncePerDayUnavailableWindows,
      expectedUnavailableWindows,
    );
    assert.equal(
      isUnavailableCompletion(signedPage.evaluationContext, completionAtMs),
      false,
    );
    assert.equal(signedPage.restaurants.length, 1);
    const signedOffer = signedPage.restaurants[0].offers[0];
    assert.equal(signedOffer.offerId, signedOfferId);
    assert.equal(signedOffer.usagePolicy, "oncePerDay");
    assert.equal(signedOffer.available, true);
    assert.deepEqual(
      await getCustomerBiteSaverSearchPageHandler(
        signedRequest,
        signedBundle.context,
      ),
      signedPage,
    );
    const signedPageReplays = (await documentsWithRole("requestReplay"))
      .filter(({data}) =>
        data.sessionId === signedBundle.response.sessionId &&
        data.purpose === "restaurantPage");
    assert.equal(signedPageReplays.length, 1);
    assert.equal(
      millis(signedPageReplays[0].data.evaluationAt),
      evaluationAtMs,
    );
    assert.equal(
      millis(signedPageReplays[0].data.logicalExpiresAt),
      signedPage.evaluationContext.validUntilExclusiveMillis,
    );

    const validationRequest = redemptionRequest(
      signedBundle,
      signedParent.publicRestaurantId,
      signedOffer,
      {redemptionRequestId: requestId("ny-daily-validation")},
    );
    const validation =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        validationRequest,
        signedBundle.context,
      );
    assert.equal(validation.allowed, true);
    assert.equal(validation.usagePolicy, "oncePerDay");
    assert.equal(validation.evaluatedAtMillis, evaluationAtMs);
    assertEvaluationContext(
      validation.evaluationContext,
      signedBundle,
      evaluationAtMs,
    );
    assert.deepEqual(
      validation.evaluationContext.oncePerDayUnavailableWindows,
      expectedUnavailableWindows,
    );
    assert.equal(
      isUnavailableCompletion(validation.evaluationContext, completionAtMs),
      false,
    );
    assert.equal(
      validation.evaluationContext.validUntilExclusiveMillis,
      validation.validationExpiresAtMillis,
    );
    const logicalReplays = (await documentsWithRole("logicalRedemptionReplay"))
      .filter(({data}) =>
        data.sessionId === signedBundle.response.sessionId);
    assert.equal(logicalReplays.length, 1);
    assert.equal(millis(logicalReplays[0].data.evaluationAt), evaluationAtMs);
    assert.equal(
      millis(logicalReplays[0].data.logicalExpiresAt),
      validation.validationExpiresAtMillis,
    );
    signedClock.value = validation.validationExpiresAtMillis - 1;
    const validationReplay =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...validationRequest,
          clientRequestId: requestId("ny-daily-validation-replay"),
        },
        signedBundle.context,
      );
    assert.deepEqual(validationReplay, validation);
    signedClock.value = validation.validationExpiresAtMillis;
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...validationRequest,
          clientRequestId: requestId("ny-daily-validation-expired"),
        },
        signedBundle.context,
      ),
      contractError("failed-precondition"),
    );
    signedClock.value =
      signedPage.evaluationContext.validUntilExclusiveMillis;
    await assert.rejects(
      getCustomerBiteSaverSearchPageHandler(
        signedRequest,
        signedBundle.context,
      ),
      contractError("failed-precondition"),
    );

    const guestClock = {value: evaluationAtMs};
    const guestBundle = await startSession({guest: true, clock: guestClock});
    const guestSession = await markReady(guestBundle);
    const guestParent = readyRestaurantWrites(guestSession, 905, {
      preparationNowMs: evaluationAtMs,
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per day"},
    });
    await commitAll(guestParent.writes);
    const guestOfferId = customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      guestParent.accountId,
      "coupon",
      guestParent.coupons[0].sourceDocumentId,
    );
    const guestRequest = pageRequest(guestBundle, {
      clientRequestId: requestId("ny-daily-guest-page"),
      guestStateRevision: 1,
    });
    const challenge = await getCustomerBiteSaverSearchPageHandler(
      guestRequest,
      guestBundle.context,
    );
    assert.equal(challenge.outcome, "guestCheckRequired");
    assert.deepEqual(challenge.candidates, [{
      offerId: guestOfferId,
      usagePolicy: "oncePerDay",
    }]);
    assertEvaluationContext(
      challenge.evaluationContext,
      guestBundle,
      evaluationAtMs,
    );
    assert.equal(challenge.evaluationContext.utcOffsetMinutes, -240);
    assert.deepEqual(
      challenge.evaluationContext.oncePerDayUnavailableWindows,
      expectedUnavailableWindows,
    );
    assert.equal(
      isUnavailableCompletion(challenge.evaluationContext, completionAtMs),
      false,
    );
    assert.equal(
      challenge.evaluationContext.validUntilExclusiveMillis,
      challenge.logicalExpiresAtMillis,
    );
    assert.deepEqual(
      await getCustomerBiteSaverSearchPageHandler(
        guestRequest,
        guestBundle.context,
      ),
      challenge,
    );
    const guestDocument = await database.getDocument(
      `${privateCustomerBiteSaverGuestOfferCheckCollection}/${
        challenge.operationRef}`,
    );
    assert.notEqual(guestDocument, null);
    assert.equal(millis(guestDocument.data.evaluationAt), evaluationAtMs);
    assert.equal(guestDocument.data.utcOffsetMinutes, -240);
    assert.equal(
      guestDocument.data.activeBatch.expiresAtMillis,
      challenge.evaluationContext.validUntilExclusiveMillis,
    );
    assert.equal(
      guestDocument.data.activeBatch.availabilityGeneration,
      challenge.evaluationContext.availabilityGeneration,
    );
    guestClock.value = challenge.logicalExpiresAtMillis;
    const expiredChallenge =
      await continueCustomerBiteSaverGuestOfferCheckHandler(
        guestAnswerRequest(guestBundle, challenge, []),
        guestBundle.context,
      );
    assert.equal(expiredChallenge.outcome, "retryRequired");
    assert.equal(expiredChallenge.reason, "checkExpired");
    assert.equal(expiredChallenge.restartFrom, "originalOperation");

    metrics.scenarioMeasurements.newYorkDailyUsageContext = {
      completionAtMillis: completionAtMs,
      evaluationAtMillis: evaluationAtMs,
      unavailableWindows: expectedUnavailableWindows,
      signedPageValidUntilExclusiveMillis:
        signedPage.evaluationContext.validUntilExclusiveMillis,
      validationValidUntilExclusiveMillis:
        validation.evaluationContext.validUntilExclusiveMillis,
      guestChallengeValidUntilExclusiveMillis:
        challenge.evaluationContext.validUntilExclusiveMillis,
    };
  });

  test("same-session redelivery preserves original validated start evidence and recovery",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({clock});
    const session = await markReady(bundle);
    const parent = readyRestaurantWrites(session, 903, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(parent.writes);
    const originalPage = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(bundle, {clientRequestId: requestId("original-page")}),
      bundle.context,
    );
    const originalRestaurant = originalPage.restaurants[0];
    const originalOffer = originalRestaurant.offers[0];
    const originalRequest = redemptionRequest(
      bundle,
      originalRestaurant.restaurantId,
      originalOffer,
      {redemptionRequestId: requestId("original-evidence-logical")},
    );
    const validation =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        originalRequest,
        bundle.context,
      );
    assert.equal(validation.allowed, true);
    const originalMarkers = (await documentsWithRole("deliveredOfferIdentity"))
      .filter(({data}) =>
        data.sessionId === bundle.response.sessionId &&
        data.publicOfferId === originalOffer.offerId);
    assert.equal(originalMarkers.length, 1);
    const originalMarkerGeneration =
      originalMarkers[0].data.pageGenerationFingerprint;
    const originalMarkerAvailabilityAt = millis(
      originalMarkers[0].data.availabilityAt,
    );

    clock.value = fixedNowMs + 1_000;
    const redeliveredPage = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(bundle, {clientRequestId: requestId("redelivered-page")}),
      bundle.context,
    );
    const redeliveredOffer = redeliveredPage.restaurants[0].offers[0];
    assert.equal(redeliveredOffer.offerId, originalOffer.offerId);
    assert.notEqual(redeliveredOffer.offerOccurrence, originalOffer.offerOccurrence);
    const redeliveredMarkers =
      (await documentsWithRole("deliveredOfferIdentity"))
        .filter(({data}) =>
          data.sessionId === bundle.response.sessionId &&
          data.publicOfferId === originalOffer.offerId);
    assert.equal(redeliveredMarkers.length, 1);
    assert.notEqual(
      redeliveredMarkers[0].data.pageGenerationFingerprint,
      originalMarkerGeneration,
    );
    assert.equal(
      millis(redeliveredMarkers[0].data.availabilityAt),
      clock.value,
    );
    assert.notEqual(
      millis(redeliveredMarkers[0].data.availabilityAt),
      originalMarkerAvailabilityAt,
    );

    const startRequestValue = redemptionStartRequest(
      originalRequest,
      validation,
      {clientRequestId: requestId("original-evidence-start")},
    );
    const started = await startCustomerBiteSaverOfferRedemptionHandler(
      startRequestValue,
      bundle.context,
    );
    assert.equal(started.status, "started");
    assert.equal(started.timerStartedAtMillis, clock.value);
    assert.equal(started.timerExpiresAtMillis, clock.value + 5 * 60_000);
    const usagePath =
      `customer_redemptions/${bundle.uid}/coupon_redemptions/${originalOffer.offerId}`;
    const usage = await database.getDocument(usagePath);
    assert.notEqual(usage, null);
    assert.equal(usage.data.redemptionId, started.redemptionId);
    assert.equal(millis(usage.data.timerStartedAt), started.timerStartedAtMillis);
    assert.equal(millis(usage.data.timerExpiresAt), started.timerExpiresAtMillis);
    const receipts = (await documentsWithRole("redemptionStartReceipt"))
      .filter(({data}) => data.sessionId === bundle.response.sessionId);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].data.redemptionId, started.redemptionId);
    assert.equal(
      millis(receipts[0].data.timerStartedAt),
      started.timerStartedAtMillis,
    );
    assert.equal(
      millis(receipts[0].data.timerExpiresAt),
      started.timerExpiresAtMillis,
    );

    const committedWritesBeforeRecovery = metrics.transactionWritesCommitted;
    const transactionsBeforeRecovery = metrics.transactionInvocations;
    clock.value = validation.validationExpiresAtMillis;
    const recovered = await startCustomerBiteSaverOfferRedemptionHandler(
      {...startRequestValue, clientRequestId: requestId("committed-recovery")},
      bundle.context,
    );
    assert.deepEqual(recovered, started);
    assert.equal(
      metrics.transactionWritesCommitted,
      committedWritesBeforeRecovery,
    );
    assert.equal(metrics.transactionInvocations, transactionsBeforeRecovery);
    metrics.scenarioMeasurements.sameSessionRedelivery = {
      markerGenerationChanged: true,
      committedRecoveryWrites:
        metrics.transactionWritesCommitted - committedWritesBeforeRecovery,
      recoveredTimerStartedAtMillis: recovered.timerStartedAtMillis,
      recoveredTimerExpiresAtMillis: recovered.timerExpiresAtMillis,
    };
  });

  test("real adapter atomically starts canonical usage across signed sessions",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const uid = requestId("shared-redemption-owner");
    const firstBundle = await startSession({clock, uid});
    const secondBundle = await startSession({clock, uid});
    const firstSession = await markReady(firstBundle);
    const secondSession = await markReady(secondBundle);
    const accountId = requestId("shared-redemption-account");
    const firstParent = readyRestaurantWrites(firstSession, 301, {
      accountId,
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    const secondParent = readyRestaurantWrites(secondSession, 301, {
      accountId,
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(firstParent.writes);
    await commitAll(secondParent.writes);
    const [firstPage, secondPage] = await bounded(Promise.all([
      getCustomerBiteSaverSearchPageHandler(
        pageRequest(firstBundle),
        firstBundle.context,
      ),
      getCustomerBiteSaverSearchPageHandler(
        pageRequest(secondBundle),
        secondBundle.context,
      ),
    ]), "shared redemption page issuance");
    const firstRestaurant = firstPage.restaurants[0];
    const secondRestaurant = secondPage.restaurants[0];
    assert.equal(firstRestaurant.restaurantId, firstParent.publicRestaurantId);
    assert.equal(secondRestaurant.restaurantId, firstParent.publicRestaurantId);
    const firstOffer = firstRestaurant.offers[0];
    const secondOffer = secondRestaurant.offers[0];
    assert.equal(secondOffer.offerId, firstOffer.offerId);
    const firstRequest = redemptionRequest(
      firstBundle,
      firstRestaurant.restaurantId,
      firstOffer,
      {redemptionRequestId: requestId("first-start-logical")},
    );
    const secondRequest = redemptionRequest(
      secondBundle,
      secondRestaurant.restaurantId,
      secondOffer,
      {redemptionRequestId: requestId("second-start-logical")},
    );
    const [firstValidation, secondValidation] = await bounded(Promise.all([
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        firstRequest,
        firstBundle.context,
      ),
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        secondRequest,
        secondBundle.context,
      ),
    ]), "shared redemption validation");
    assert.equal(firstValidation.allowed, true);
    assert.equal(secondValidation.allowed, true);
    const firstStartRequest = redemptionStartRequest(
      firstRequest,
      firstValidation,
    );
    const secondStartRequest = redemptionStartRequest(
      secondRequest,
      secondValidation,
    );
    const transactionInvocationsBefore = metrics.transactionInvocations;
    const transactionAttemptsBefore = metrics.transactionAttempts;
    const [firstStart, secondStart] = await bounded(Promise.all([
      startCustomerBiteSaverOfferRedemptionHandler(
        firstStartRequest,
        firstBundle.context,
      ),
      startCustomerBiteSaverOfferRedemptionHandler(
        secondStartRequest,
        secondBundle.context,
      ),
    ]), "concurrent canonical redemption starts");
    const concurrentTransactionInvocations =
      metrics.transactionInvocations - transactionInvocationsBefore;
    const concurrentTransactionAttempts =
      metrics.transactionAttempts - transactionAttemptsBefore;
    assert.deepEqual(
      [firstStart.status, secondStart.status].sort(),
      ["active", "started"],
    );
    assert.match(firstStart.redemptionId, /^bsrd_[A-Za-z0-9_-]{43}$/u);
    assert.equal(secondStart.redemptionId, firstStart.redemptionId);
    assert.equal(secondStart.timerStartedAtMillis, firstStart.timerStartedAtMillis);
    assert.equal(secondStart.timerExpiresAtMillis, firstStart.timerExpiresAtMillis);
    assert.equal(firstStart.timerStartedAtMillis, fixedNowMs);
    assert.equal(firstStart.timerExpiresAtMillis, fixedNowMs + 5 * 60_000);

    const usagePath =
      `customer_redemptions/${uid}/coupon_redemptions/${firstOffer.offerId}`;
    const usage = await database.getDocument(usagePath);
    assert.notEqual(usage, null);
    assert.deepEqual(Object.keys(usage.data).sort(), [
      "createdAt",
      "offerId",
      "offerType",
      "redemptionId",
      "restaurantId",
      "schemaVersion",
      "timerExpiresAt",
      "timerStartedAt",
      "updatedAt",
      "userId",
    ]);
    assert.equal(usage.data.schemaVersion, customerBiteSaverSearchSchemaVersion);
    assert.equal(usage.data.userId, uid);
    assert.equal(usage.data.restaurantId, firstRestaurant.restaurantId);
    assert.equal(usage.data.offerId, firstOffer.offerId);
    assert.equal(usage.data.offerType, "coupon");
    assert.equal(usage.data.redemptionId, firstStart.redemptionId);
    assert.equal(millis(usage.data.timerStartedAt), firstStart.timerStartedAtMillis);
    assert.equal(millis(usage.data.timerExpiresAt), firstStart.timerExpiresAtMillis);
    assert.equal(millis(usage.data.createdAt), firstStart.timerStartedAtMillis);
    assert.equal(millis(usage.data.updatedAt), firstStart.timerStartedAtMillis);
    assert.equal(
      await database.getDocument(
        `customer_redemptions/${uid}/coupon_redemptions/${
          firstParent.coupons[0].sourceDocumentId}`,
      ),
      null,
    );
    const sessionIds = new Set([
      firstBundle.response.sessionId,
      secondBundle.response.sessionId,
    ]);
    const receipts = (await documentsWithRole("redemptionStartReceipt"))
      .filter(({data}) => sessionIds.has(data.sessionId));
    assert.equal(receipts.length, 2);

    // A caller retry after losing either response recovers that session's
    // original status and the shared authoritative timer anchors.
    clock.value = firstValidation.validationExpiresAtMillis;
    assert.deepEqual(
      await startCustomerBiteSaverOfferRedemptionHandler(
        {
          ...firstStartRequest,
          clientRequestId: requestId("lost-start-response"),
        },
        firstBundle.context,
      ),
      firstStart,
    );
    const unchangedUsage = await database.getDocument(usagePath);
    assert.equal(unchangedUsage.data.redemptionId, usage.data.redemptionId);
    assert.equal(
      millis(unchangedUsage.data.timerStartedAt),
      millis(usage.data.timerStartedAt),
    );

    clock.value = firstStart.timerExpiresAtMillis;
    const completed =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        redemptionRequest(
          firstBundle,
          firstRestaurant.restaurantId,
          firstOffer,
          {redemptionRequestId: requestId("completed-start-logical")},
        ),
        firstBundle.context,
      );
    assert.equal(completed.allowed, false);
    assert.equal(completed.reason, "used");
    assert.equal(completed.validationId, null);

    const raceBundle = await startSession({clock, uid});
    const raceSession = await markReady(raceBundle);
    const raceParent = readyRestaurantWrites(raceSession, 302, {
      preparationNowMs: clock.value,
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(raceParent.writes);
    const racePage = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(raceBundle),
      raceBundle.context,
    );
    const raceRestaurant = racePage.restaurants[0];
    const raceOffer = raceRestaurant.offers[0];
    const raceRequest = redemptionRequest(
      raceBundle,
      raceRestaurant.restaurantId,
      raceOffer,
      {redemptionRequestId: requestId("withdrawn-start-logical")},
    );
    const raceValidation =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        raceRequest,
        raceBundle.context,
      );
    assert.equal(raceValidation.allowed, true);
    await database.commitWrites([{
      type: "delete",
      path: `restaurant_accounts/${raceParent.accountId}/coupons/${
        raceParent.coupons[0].sourceDocumentId}`,
    }]);
    await assert.rejects(
      startCustomerBiteSaverOfferRedemptionHandler(
        redemptionStartRequest(raceRequest, raceValidation),
        raceBundle.context,
      ),
      contractError("failed-precondition"),
    );
    assert.equal(
      await database.getDocument(
        `customer_redemptions/${uid}/coupon_redemptions/${raceOffer.offerId}`,
      ),
      null,
    );
    metrics.scenarioMeasurements.redemptionStart = {
      concurrentTransactionInvocations,
      concurrentTransactionAttempts,
      authoritativeStartReceipts: receipts.length,
      canonicalUsageDocuments: 1,
      timerDurationMillis:
        firstStart.timerExpiresAtMillis - firstStart.timerStartedAtMillis,
    };
  });

  test("stored start receipt recovery fences absolute expiry at minus one exact and plus one",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({clock});
    const session = await markReady(bundle);
    const parent = readyRestaurantWrites(session, 904, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(parent.writes);
    const page = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(bundle),
      bundle.context,
    );
    const restaurant = page.restaurants[0];
    const offer = restaurant.offers[0];
    const request = redemptionRequest(
      bundle,
      restaurant.restaurantId,
      offer,
      {redemptionRequestId: requestId("receipt-boundary-logical")},
    );
    const validation =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        request,
        bundle.context,
      );
    assert.equal(validation.allowed, true);
    const startRequestValue = redemptionStartRequest(request, validation);
    const started = await startCustomerBiteSaverOfferRedemptionHandler(
      startRequestValue,
      bundle.context,
    );
    const absoluteExpiresAtMs = millis(session.absoluteExpiresAt);
    assert.equal(absoluteExpiresAtMs, fixedNowMs + 60 * 60_000);
    const committedWritesBeforeBoundaries = metrics.transactionWritesCommitted;
    const transactionsBeforeBoundaries = metrics.transactionInvocations;

    clock.value = absoluteExpiresAtMs - 1;
    assert.deepEqual(
      await startCustomerBiteSaverOfferRedemptionHandler(
        {
          ...startRequestValue,
          clientRequestId: requestId("receipt-boundary-minus-one"),
        },
        bundle.context,
      ),
      started,
    );
    assert.equal(
      metrics.transactionWritesCommitted,
      committedWritesBeforeBoundaries,
    );
    assert.equal(metrics.transactionInvocations, transactionsBeforeBoundaries);

    for (const [label, atMs] of [
      ["exact", absoluteExpiresAtMs],
      ["plus-one", absoluteExpiresAtMs + 1],
    ]) {
      clock.value = atMs;
      await assert.rejects(
        startCustomerBiteSaverOfferRedemptionHandler(
          {
            ...startRequestValue,
            clientRequestId: requestId(`receipt-boundary-${label}`),
          },
          bundle.context,
        ),
        contractError("failed-precondition"),
      );
      assert.equal(
        metrics.transactionWritesCommitted,
        committedWritesBeforeBoundaries,
      );
      assert.equal(metrics.transactionInvocations, transactionsBeforeBoundaries);
    }
    metrics.scenarioMeasurements.startReceiptBoundaries = {
      absoluteExpiresAtMs,
      recoveredOffsets: [-1],
      rejectedOffsets: [0, 1],
      committedWrites: 0,
    };
  });

  test("actual SDK receipt read cannot recover after crossing absolute expiry",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({clock});
    const session = await markReady(bundle);
    const parent = readyRestaurantWrites(session, 905, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(parent.writes);
    const page = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(bundle),
      bundle.context,
    );
    const restaurant = page.restaurants[0];
    const offer = restaurant.offers[0];
    const request = redemptionRequest(
      bundle,
      restaurant.restaurantId,
      offer,
      {redemptionRequestId: requestId("delayed-receipt-logical")},
    );
    const validation =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        request,
        bundle.context,
      );
    assert.equal(validation.allowed, true);
    const startRequestValue = redemptionStartRequest(request, validation);
    await startCustomerBiteSaverOfferRedemptionHandler(
      startRequestValue,
      bundle.context,
    );
    const absoluteExpiresAtMs = millis(session.absoluteExpiresAt);
    clock.value = absoluteExpiresAtMs - 1;
    const receiptRead = deferred();
    const releaseReceiptRead = deferred();
    let interceptedReceiptPath = null;
    hooks.afterGetDocument = async (documentPath, document) => {
      if (
        interceptedReceiptPath === null &&
        document?.data.role === "redemptionStartReceipt" &&
        document.data.sessionId === bundle.response.sessionId
      ) {
        interceptedReceiptPath = documentPath;
        receiptRead.resolve();
        await releaseReceiptRead.promise;
      }
    };
    const committedWritesBeforeRecovery = metrics.transactionWritesCommitted;
    const transactionsBeforeRecovery = metrics.transactionInvocations;
    const recoveryPromise = startCustomerBiteSaverOfferRedemptionHandler(
      {
        ...startRequestValue,
        clientRequestId: requestId("delayed-receipt-recovery"),
      },
      bundle.context,
    );
    void recoveryPromise.catch(() => {});
    try {
      await bounded(receiptRead.promise, "actual start receipt read");
      clock.value = absoluteExpiresAtMs;
      releaseReceiptRead.resolve();
      await assert.rejects(
        bounded(recoveryPromise, "delayed start receipt recovery"),
        contractError("failed-precondition"),
      );
    } finally {
      hooks.afterGetDocument = null;
      releaseReceiptRead.resolve();
      await recoveryPromise.catch(() => {});
    }
    assert.equal(typeof interceptedReceiptPath, "string");
    assert.equal(
      metrics.transactionWritesCommitted,
      committedWritesBeforeRecovery,
    );
    assert.equal(metrics.transactionInvocations, transactionsBeforeRecovery);
    metrics.scenarioMeasurements.delayedReceiptRecovery = {
      receiptReadCompletedBeforeClockCrossing: true,
      crossedToMillis: absoluteExpiresAtMs,
      committedWrites: 0,
    };
  });

  test("guest offer page keeps its scheduled-start evaluation anchor across refresh",
    {timeout: 120_000}, async () => {
    const originalEvaluationAt = fixedNowMs;
    const scheduledStartAt = originalEvaluationAt + 60_000;
    const refreshAt = originalEvaluationAt + 300_000;
    const clock = {value: originalEvaluationAt};
    const bundle = await startSession({guest: true, clock});
    const session = await markReady(bundle);
    const parent = readyRestaurantWrites(session, 351, {
      offerCount: 27,
      onlyCoupons: true,
      offerOverridesForIndex: (index) => ({
        usageRule: index > 0 && index < 26
          ? "Once per customer"
          : "Unlimited",
        ...(index === 0
          ? {startTime: new Date(scheduledStartAt)}
          : {}),
      }),
    });
    await commitAll(parent.writes);
    const offerIds = parent.coupons.map(({sourceDocumentId}) =>
      customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        parent.accountId,
        "coupon",
        sourceDocumentId,
      ));
    const checkedOfferIds = offerIds.slice(1, 26);
    const boundaryFor = (index) => [
      1,
      parent.coupons[index].sourceCreatedAtOrderKey,
      parent.coupons[index].sourceDocumentId,
    ];
    const request = offerPageRequest(bundle, parent.publicRestaurantId, {
      clientRequestId: requestId("guest-scheduled-offer-page"),
      guestStateRevision: 351,
    });

    const initial = await getCustomerBiteSaverOfferPageHandler(
      request,
      bundle.context,
    );
    assert.equal(initial.outcome, "guestCheckRequired");
    assert.equal(initial.operation, "offerPage");
    assert.deepEqual(
      initial.candidates,
      checkedOfferIds.map((offerId) => ({
        offerId,
        usagePolicy: "oncePerCustomer",
      })),
    );
    assertEvaluationContext(initial.evaluationContext, bundle,
      originalEvaluationAt);
    assert.equal(initial.evaluationContext.timeZone, "America/New_York");
    assert.equal(initial.evaluationContext.utcOffsetMinutes, -240);
    assert.equal(initial.logicalExpiresAtMillis, refreshAt);
    assert.equal(
      initial.evaluationContext.validUntilExclusiveMillis,
      initial.logicalExpiresAtMillis,
    );

    const checkPath = privateCustomerBiteSaverGuestOfferCheckCollection +
      "/" + initial.operationRef;
    const beforeRefresh = await database.getDocument(checkPath);
    assert.notEqual(beforeRefresh, null);
    assert.equal(beforeRefresh.data.state, "awaitingAnswer");
    assert.equal(millis(beforeRefresh.data.evaluationAt), originalEvaluationAt);
    assert.equal(
      beforeRefresh.data.activeBatch.issuedAtMillis,
      originalEvaluationAt,
    );
    assert.equal(beforeRefresh.data.activeBatch.expiresAtMillis, refreshAt);
    assert.equal(beforeRefresh.data.activeBatch.sourceExhausted, false);
    assert.deepEqual(
      beforeRefresh.data.activeBatch.nextOfferBoundary,
      boundaryFor(25),
    );
    assert.deepEqual(
      beforeRefresh.data.activeBatch.candidates.map(
        ({sourceDocumentId}) => sourceDocumentId,
      ),
      parent.coupons.slice(1, 26).map(
        ({sourceDocumentId}) => sourceDocumentId,
      ),
    );
    assert.equal(beforeRefresh.data.progress.scanBoundary, null);
    assert.deepEqual(beforeRefresh.data.progress.readyOffers, []);
    const retainedProgress = beforeRefresh.data.progress;
    const staleAnswer = guestAnswerRequest(
      bundle,
      initial,
      checkedOfferIds,
      {clientRequestId: requestId("guest-scheduled-offer-stale-answer")},
    );

    clock.value = refreshAt;
    const refreshed = await getCustomerBiteSaverOfferPageHandler(
      {
        ...request,
        clientRequestId: requestId("guest-scheduled-offer-refresh"),
      },
      bundle.context,
    );
    assert.equal(refreshed.outcome, "guestCheckRequired");
    assert.equal(refreshed.operationRef, initial.operationRef);
    assert.equal(refreshed.batchSequence, initial.batchSequence + 1);
    assert.notEqual(refreshed.checkToken, initial.checkToken);
    assert.deepEqual(refreshed.candidates, initial.candidates);
    assert.equal(
      refreshed.evaluationContext.evaluationAtMillis,
      initial.evaluationContext.evaluationAtMillis,
    );
    assert.deepEqual(
      refreshed.evaluationContext.oncePerDayUnavailableWindows,
      initial.evaluationContext.oncePerDayUnavailableWindows,
    );
    assert.notEqual(
      refreshed.evaluationContext.availabilityGeneration,
      initial.evaluationContext.availabilityGeneration,
    );
    assert.equal(refreshed.logicalExpiresAtMillis, refreshAt + 300_000);
    assert.equal(
      refreshed.evaluationContext.validUntilExclusiveMillis,
      refreshed.logicalExpiresAtMillis,
    );

    const afterRefresh = await database.getDocument(checkPath);
    assert.notEqual(afterRefresh, null);
    assert.equal(millis(afterRefresh.data.evaluationAt), originalEvaluationAt);
    assert.deepEqual(afterRefresh.data.progress, retainedProgress);
    assert.deepEqual(
      afterRefresh.data.activeBatch.nextOfferBoundary,
      boundaryFor(25),
    );
    assert.equal(afterRefresh.data.activeBatch.sourceExhausted, false);
    assert.equal(afterRefresh.data.activeBatch.issuedAtMillis, refreshAt);
    assert.equal(
      afterRefresh.data.activeBatch.expiresAtMillis,
      refreshAt + 300_000,
    );
    assert.deepEqual(
      afterRefresh.data.activeBatch.candidates.map(({offerId}) => offerId),
      checkedOfferIds,
    );
    assert.deepEqual(
      await getCustomerBiteSaverOfferPageHandler(request, bundle.context),
      refreshed,
    );
    await assert.rejects(
      continueCustomerBiteSaverGuestOfferCheckHandler(
        staleAnswer,
        bundle.context,
      ),
      contractError("failed-precondition"),
    );

    const anchored = await continueCustomerBiteSaverGuestOfferCheckHandler(
      guestAnswerRequest(bundle, refreshed, checkedOfferIds, {
        clientRequestId: requestId("guest-scheduled-offer-answer"),
      }),
      bundle.context,
    );
    assert.equal(anchored.outcome, "complete");
    assert.equal(anchored.operation, "offerPage");
    assert.deepEqual(
      anchored.result.offers.map(({offerId}) => offerId),
      [offerIds[26]],
    );
    assert.deepEqual(
      anchored.result.offers.map(({available}) => available),
      [true],
    );
    assert.equal(anchored.result.restaurantId, parent.publicRestaurantId);
    assert.equal(anchored.result.hasMore, false);
    assert.equal(anchored.result.nextCursor, null);
    assert.equal(anchored.result.partial, false);
    assert.equal(
      anchored.evaluationContext.evaluationAtMillis,
      originalEvaluationAt,
    );
    assert.equal(anchored.evaluationContext.timeZone, "America/New_York");
    assert.equal(anchored.evaluationContext.utcOffsetMinutes, -240);
    assert.match(
      anchored.evaluationContext.availabilityGeneration,
      /^[a-f0-9]{64}$/u,
    );

    const anchoredDocument = await database.getDocument(checkPath);
    assert.notEqual(anchoredDocument, null);
    assert.equal(anchoredDocument.data.state, "completed");
    assert.equal(
      millis(anchoredDocument.data.evaluationAt),
      originalEvaluationAt,
    );
    assert.equal(anchoredDocument.data.progress.sourceExhausted, true);
    assert.deepEqual(
      anchoredDocument.data.progress.scanBoundary,
      boundaryFor(26),
    );
    assert.deepEqual(
      anchoredDocument.data.progress.readyOffers.map(({offerId}) => offerId),
      [offerIds[26]],
    );

    const fresh = await getCustomerBiteSaverOfferPageHandler(
      {
        ...request,
        clientRequestId: requestId("guest-scheduled-offer-fresh"),
        guestStateRevision: 352,
      },
      bundle.context,
    );
    assert.equal(fresh.outcome, "guestCheckRequired");
    assert.notEqual(fresh.operationRef, refreshed.operationRef);
    assert.deepEqual(
      fresh.candidates.map(({offerId}) => offerId),
      checkedOfferIds,
    );
    assert.equal(fresh.evaluationContext.evaluationAtMillis, refreshAt);
    assert.equal(fresh.evaluationContext.timeZone, "America/New_York");
    assert.equal(fresh.evaluationContext.utcOffsetMinutes, -240);
    assert.notEqual(
      fresh.evaluationContext.availabilityGeneration,
      initial.evaluationContext.availabilityGeneration,
    );
    const freshPath = privateCustomerBiteSaverGuestOfferCheckCollection +
      "/" + fresh.operationRef;
    const freshDocument = await database.getDocument(freshPath);
    assert.notEqual(freshDocument, null);
    assert.equal(millis(freshDocument.data.evaluationAt), refreshAt);
    assert.equal(freshDocument.data.activeBatch.issuedAtMillis, refreshAt);
    assert.deepEqual(
      freshDocument.data.activeBatch.nextOfferBoundary,
      boundaryFor(25),
    );

    const freshComplete =
      await continueCustomerBiteSaverGuestOfferCheckHandler(
        guestAnswerRequest(bundle, fresh, checkedOfferIds, {
          clientRequestId: requestId("guest-scheduled-offer-fresh-answer"),
        }),
        bundle.context,
      );
    assert.equal(freshComplete.outcome, "complete");
    assert.deepEqual(
      freshComplete.result.offers.map(({offerId}) => offerId),
      [offerIds[0], offerIds[26]],
    );
    assert.deepEqual(
      freshComplete.result.offers.map(({available}) => available),
      [true, true],
    );
    assert.equal(freshComplete.result.hasMore, false);
    assert.equal(freshComplete.result.nextCursor, null);
    assert.equal(freshComplete.result.partial, false);
    assert.equal(
      freshComplete.evaluationContext.evaluationAtMillis,
      refreshAt,
    );
    assert.equal(freshComplete.evaluationContext.timeZone, "America/New_York");
    assert.equal(freshComplete.evaluationContext.utcOffsetMinutes, -240);
  });

  test("guest restaurant page keeps scheduled membership and preview proof anchored",
    {timeout: 120_000}, async () => {
    const originalEvaluationAt = fixedNowMs;
    const scheduledStartAt = originalEvaluationAt + 60_000;
    const refreshAt = originalEvaluationAt + 300_000;
    const clock = {value: originalEvaluationAt};
    const bundle = await startSession({guest: true, clock});
    const session = await markReady(bundle);
    const parent = readyRestaurantWrites(session, 352, {
      offerCount: 3,
      onlyCoupons: true,
      offerOverridesForIndex: (index) => ({
        usageRule: index === 0 ? "Unlimited" : "Once per customer",
        ...(index === 0
          ? {startTime: new Date(scheduledStartAt)}
          : {}),
      }),
    });
    await commitAll(parent.writes);
    const offerIds = parent.coupons.map(({sourceDocumentId}) =>
      customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        parent.accountId,
        "coupon",
        sourceDocumentId,
      ));
    const checkedOfferIds = offerIds.slice(1);
    const pendingBoundary = [
      1,
      parent.coupons[2].sourceCreatedAtOrderKey,
      parent.coupons[2].sourceDocumentId,
    ];
    const request = pageRequest(bundle, {
      clientRequestId: requestId("guest-scheduled-restaurant-page"),
      guestStateRevision: 360,
    });

    const initial = await getCustomerBiteSaverSearchPageHandler(
      request,
      bundle.context,
    );
    assert.equal(initial.outcome, "guestCheckRequired");
    assert.equal(initial.operation, "restaurantPage");
    assert.deepEqual(
      initial.candidates,
      checkedOfferIds.map((offerId) => ({
        offerId,
        usagePolicy: "oncePerCustomer",
      })),
    );
    assertEvaluationContext(initial.evaluationContext, bundle,
      originalEvaluationAt);
    assert.equal(initial.evaluationContext.timeZone, "America/New_York");
    assert.equal(initial.evaluationContext.utcOffsetMinutes, -240);
    assert.equal(initial.logicalExpiresAtMillis, refreshAt);
    assert.equal(
      initial.evaluationContext.validUntilExclusiveMillis,
      initial.logicalExpiresAtMillis,
    );

    const checkPath = privateCustomerBiteSaverGuestOfferCheckCollection +
      "/" + initial.operationRef;
    const beforeRefresh = await database.getDocument(checkPath);
    assert.notEqual(beforeRefresh, null);
    assert.equal(beforeRefresh.data.state, "awaitingAnswer");
    assert.equal(millis(beforeRefresh.data.evaluationAt), originalEvaluationAt);
    assert.equal(
      beforeRefresh.data.activeBatch.issuedAtMillis,
      originalEvaluationAt,
    );
    assert.equal(beforeRefresh.data.activeBatch.expiresAtMillis, refreshAt);
    assert.equal(beforeRefresh.data.activeBatch.sourceExhausted, true);
    assert.deepEqual(
      beforeRefresh.data.activeBatch.nextOfferBoundary,
      pendingBoundary,
    );
    assert.deepEqual(
      beforeRefresh.data.activeBatch.candidates.map(
        ({sourceDocumentId}) => sourceDocumentId,
      ),
      parent.coupons.slice(1).map(({sourceDocumentId}) => sourceDocumentId),
    );
    assert.equal(beforeRefresh.data.progress.outerBoundary, null);
    assert.deepEqual(beforeRefresh.data.progress.readyRestaurants, []);
    assert.notEqual(beforeRefresh.data.progress.currentRestaurant, null);
    assert.equal(
      beforeRefresh.data.progress.currentRestaurant.restaurantId,
      parent.publicRestaurantId,
    );
    assert.equal(
      beforeRefresh.data.progress.currentRestaurant.liveBoundary,
      null,
    );
    assert.deepEqual(
      beforeRefresh.data.progress.currentRestaurant.retainedOffers,
      [],
    );
    assert.equal(
      beforeRefresh.data.progress.currentRestaurant.visibleOfferCount,
      0,
    );
    assert.equal(
      beforeRefresh.data.progress.currentRestaurant.countKnown,
      true,
    );
    const retainedProgress = beforeRefresh.data.progress;
    const staleAnswer = guestAnswerRequest(
      bundle,
      initial,
      checkedOfferIds,
      {clientRequestId: requestId("guest-scheduled-restaurant-stale")},
    );

    clock.value = refreshAt;
    const refreshed = await getCustomerBiteSaverSearchPageHandler(
      {
        ...request,
        clientRequestId: requestId("guest-scheduled-restaurant-refresh"),
      },
      bundle.context,
    );
    assert.equal(refreshed.outcome, "guestCheckRequired");
    assert.equal(refreshed.operationRef, initial.operationRef);
    assert.equal(refreshed.batchSequence, initial.batchSequence + 1);
    assert.notEqual(refreshed.checkToken, initial.checkToken);
    assert.deepEqual(refreshed.candidates, initial.candidates);
    assert.equal(
      refreshed.evaluationContext.evaluationAtMillis,
      initial.evaluationContext.evaluationAtMillis,
    );
    assert.deepEqual(
      refreshed.evaluationContext.oncePerDayUnavailableWindows,
      initial.evaluationContext.oncePerDayUnavailableWindows,
    );
    assert.notEqual(
      refreshed.evaluationContext.availabilityGeneration,
      initial.evaluationContext.availabilityGeneration,
    );
    assert.equal(refreshed.logicalExpiresAtMillis, refreshAt + 300_000);
    assert.equal(
      refreshed.evaluationContext.validUntilExclusiveMillis,
      refreshed.logicalExpiresAtMillis,
    );

    const afterRefresh = await database.getDocument(checkPath);
    assert.notEqual(afterRefresh, null);
    assert.equal(millis(afterRefresh.data.evaluationAt), originalEvaluationAt);
    assert.deepEqual(afterRefresh.data.progress, retainedProgress);
    assert.deepEqual(
      afterRefresh.data.activeBatch.nextOfferBoundary,
      pendingBoundary,
    );
    assert.equal(afterRefresh.data.activeBatch.sourceExhausted, true);
    assert.equal(afterRefresh.data.activeBatch.issuedAtMillis, refreshAt);
    assert.equal(
      afterRefresh.data.activeBatch.expiresAtMillis,
      refreshAt + 300_000,
    );
    assert.deepEqual(
      afterRefresh.data.activeBatch.candidates.map(({offerId}) => offerId),
      checkedOfferIds,
    );
    assert.deepEqual(
      await getCustomerBiteSaverSearchPageHandler(request, bundle.context),
      refreshed,
    );
    await assert.rejects(
      continueCustomerBiteSaverGuestOfferCheckHandler(
        staleAnswer,
        bundle.context,
      ),
      contractError("failed-precondition"),
    );

    const anchored = await continueCustomerBiteSaverGuestOfferCheckHandler(
      guestAnswerRequest(bundle, refreshed, checkedOfferIds, {
        clientRequestId: requestId("guest-scheduled-restaurant-answer"),
      }),
      bundle.context,
    );
    assert.equal(anchored.outcome, "complete");
    assert.equal(anchored.operation, "restaurantPage");
    assert.deepEqual(anchored.result.restaurants, []);
    assert.equal(anchored.result.hasMore, false);
    assert.equal(anchored.result.nextCursor, null);
    assert.equal(anchored.result.partial, false);
    assert.equal(
      anchored.evaluationContext.evaluationAtMillis,
      originalEvaluationAt,
    );
    assert.equal(anchored.evaluationContext.timeZone, "America/New_York");
    assert.equal(anchored.evaluationContext.utcOffsetMinutes, -240);
    assert.match(
      anchored.evaluationContext.availabilityGeneration,
      /^[a-f0-9]{64}$/u,
    );

    const anchoredDocument = await database.getDocument(checkPath);
    assert.notEqual(anchoredDocument, null);
    assert.equal(anchoredDocument.data.state, "completed");
    assert.equal(
      millis(anchoredDocument.data.evaluationAt),
      originalEvaluationAt,
    );
    assert.equal(anchoredDocument.data.progress.resultSourceExhausted, true);
    assert.equal(anchoredDocument.data.progress.currentRestaurant, null);
    assert.deepEqual(anchoredDocument.data.progress.readyRestaurants, []);

    const fresh = await getCustomerBiteSaverSearchPageHandler(
      {
        ...request,
        clientRequestId: requestId("guest-scheduled-restaurant-fresh"),
        guestStateRevision: 361,
      },
      bundle.context,
    );
    assert.equal(fresh.outcome, "guestCheckRequired");
    assert.notEqual(fresh.operationRef, refreshed.operationRef);
    assert.deepEqual(
      fresh.candidates.map(({offerId}) => offerId),
      checkedOfferIds,
    );
    assert.equal(fresh.evaluationContext.evaluationAtMillis, refreshAt);
    assert.equal(fresh.evaluationContext.timeZone, "America/New_York");
    assert.equal(fresh.evaluationContext.utcOffsetMinutes, -240);
    assert.notEqual(
      fresh.evaluationContext.availabilityGeneration,
      initial.evaluationContext.availabilityGeneration,
    );
    const freshPath = privateCustomerBiteSaverGuestOfferCheckCollection +
      "/" + fresh.operationRef;
    const freshDocument = await database.getDocument(freshPath);
    assert.notEqual(freshDocument, null);
    assert.equal(millis(freshDocument.data.evaluationAt), refreshAt);
    assert.equal(freshDocument.data.activeBatch.issuedAtMillis, refreshAt);
    assert.deepEqual(
      freshDocument.data.activeBatch.nextOfferBoundary,
      pendingBoundary,
    );
    assert.deepEqual(
      freshDocument.data.progress.currentRestaurant.retainedOffers.map(
        ({offerId}) => offerId,
      ),
      [offerIds[0]],
    );
    assert.equal(
      freshDocument.data.progress.currentRestaurant.visibleOfferCount,
      1,
    );
    assert.equal(
      freshDocument.data.progress.currentRestaurant.countKnown,
      true,
    );

    const freshComplete =
      await continueCustomerBiteSaverGuestOfferCheckHandler(
        guestAnswerRequest(bundle, fresh, checkedOfferIds, {
          clientRequestId: requestId(
            "guest-scheduled-restaurant-fresh-answer",
          ),
        }),
        bundle.context,
      );
    assert.equal(freshComplete.outcome, "complete");
    assert.deepEqual(
      freshComplete.result.restaurants.map(({restaurantId}) => restaurantId),
      [parent.publicRestaurantId],
    );
    const [restaurant] = freshComplete.result.restaurants;
    assert.deepEqual(
      restaurant.offers.map(({offerId}) => offerId),
      [offerIds[0]],
    );
    assert.deepEqual(
      restaurant.offers.map(({available}) => available),
      [true],
    );
    assert.equal(restaurant.hasMoreOffers, false);
    assert.equal(restaurant.usableOfferCount, 1);
    assert.equal(restaurant.offerCountState, "current");
    assert.equal(freshComplete.result.hasMore, false);
    assert.equal(freshComplete.result.nextCursor, null);
    assert.equal(freshComplete.result.partial, false);
    assert.equal(
      freshComplete.evaluationContext.evaluationAtMillis,
      refreshAt,
    );
    assert.equal(
      freshComplete.evaluationContext.timeZone,
      "America/New_York",
    );
    assert.equal(freshComplete.evaluationContext.utcOffsetMinutes, -240);
  });

  test("real guest pages fence retained daily specials before, at, and after schedule deadlines",
    {timeout: 480_000}, async () => {
    const deadlineCases = Object.freeze([
      Object.freeze({
        label: "inclusive-window",
        evaluationAtMs: Date.parse("2026-09-10T12:00:00.000Z"),
        cutoffAtMs: Date.parse("2026-09-10T12:03:00.000Z"),
        dailyOverrides: Object.freeze({
          availabilityMode: "specificDays",
          daysOfWeek: Object.freeze([4]),
          allDay: false,
          startTime: "08:00",
          endTime: "08:02",
          hideWhenUnavailable: true,
        }),
      }),
      Object.freeze({
        label: "specific-days",
        evaluationAtMs: Date.parse("2026-09-11T03:58:00.000Z"),
        cutoffAtMs: Date.parse("2026-09-11T04:00:00.000Z"),
        dailyOverrides: Object.freeze({
          availabilityMode: "specificDays",
          daysOfWeek: Object.freeze([4]),
          allDay: true,
          hideWhenUnavailable: true,
        }),
      }),
      Object.freeze({
        label: "expiry-less-today-only",
        evaluationAtMs: Date.parse("2026-09-11T03:58:00.000Z"),
        cutoffAtMs: Date.parse("2026-09-11T04:00:00.000Z"),
        dailyOverrides: Object.freeze({
          availabilityMode: "todayOnly",
          daysOfWeek: Object.freeze([]),
          allDay: true,
          hideWhenUnavailable: true,
          createdAt: new Date("2026-09-11T03:57:00.000Z"),
          updatedAt: new Date("2026-09-11T03:57:30.000Z"),
        }),
      }),
      Object.freeze({
        label: "fall-back-below-start",
        // First 01:59 EDT keeps the rollback inside the guest-check lease.
        evaluationAtMs: Date.parse("2026-11-01T05:59:00.000Z"),
        cutoffAtMs: Date.parse("2026-11-01T06:00:00.000Z"),
        dailyOverrides: Object.freeze({
          availabilityMode: "specificDays",
          daysOfWeek: Object.freeze([7]),
          allDay: false,
          startTime: "01:30",
          endTime: "02:30",
          hideWhenUnavailable: true,
        }),
      }),
    ]);
    const operations = Object.freeze(["offerPage", "restaurantPage"]);
    const pendingBranches = Object.freeze([
      Object.freeze({label: "deadline-minus-one", offsetMs: -1}),
      Object.freeze({label: "deadline", offsetMs: 0}),
      Object.freeze({label: "deadline-plus-one", offsetMs: 1}),
    ]);
    const scenarioEvidence = [];
    let fixtureSequence = 0;

    async function prepareGuestDeadlineScenario(deadlineCase, operation, suffix) {
      fixtureSequence += 1;
      const scenarioLabel = `${deadlineCase.label}-${operation}-${suffix}`;
      const clock = {value: deadlineCase.evaluationAtMs};
      const bundle = await startSession({
        guest: true,
        clock,
        request: {
          timeZone: "America/New_York",
          utcOffsetMinutes: -240,
        },
      });
      const session = await markReady(bundle);
      const parentIndex = 8_000 + fixtureSequence * 2;
      const expiring = readyRestaurantWrites(session, parentIndex, {
        preparationNowMs: deadlineCase.evaluationAtMs,
        offerCount: 2,
        offerOverridesForIndex: (_index, offerType) =>
          offerType === "dailySpecial"
            ? deadlineCase.dailyOverrides
            : {usageRule: "Once per customer"},
      });
      const witness = operation === "restaurantPage"
        ? readyRestaurantWrites(session, parentIndex + 1, {
            preparationNowMs: deadlineCase.evaluationAtMs,
            offerCount: 1,
            onlyCoupons: true,
            offerOverrides: {usageRule: "Unlimited"},
          })
        : null;
      await commitAll([
        ...expiring.writes,
        ...(witness?.writes ?? []),
      ]);
      const expiringDailyOfferId = customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        expiring.accountId,
        "dailySpecial",
        expiring.daily[0].sourceDocumentId,
      );
      const checkedCouponOfferId = customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        expiring.accountId,
        "coupon",
        expiring.coupons[0].sourceDocumentId,
      );
      const witnessCouponOfferId = witness === null
        ? null
        : customerBiteSaverOpaqueOfferId(
            identityKeyV1,
            witness.accountId,
            "coupon",
            witness.coupons[0].sourceDocumentId,
          );
      const sourcePaths = Object.freeze([
        ...rawSourcePaths(expiring),
        ...(witness === null ? [] : rawSourcePaths(witness)),
      ]);
      const sourceTimesBefore = await rawDocumentUpdateTimes(sourcePaths);
      const guestStateRevision = 7_000 + fixtureSequence * 2;
      const originalRequest = operation === "offerPage"
        ? offerPageRequest(bundle, expiring.publicRestaurantId, {
            clientRequestId: requestId(`${scenarioLabel}-page`),
            guestStateRevision,
          })
        : pageRequest(bundle, {
            clientRequestId: requestId(`${scenarioLabel}-page`),
            guestStateRevision,
          });
      const pageHandler = operation === "offerPage"
        ? getCustomerBiteSaverOfferPageHandler
        : getCustomerBiteSaverSearchPageHandler;
      const initial = await pageHandler(originalRequest, bundle.context);
      assert.equal(initial.outcome, "guestCheckRequired");
      assert.equal(initial.operation, operation);
      assert.deepEqual(initial.candidates, [{
        offerId: checkedCouponOfferId,
        usagePolicy: "oncePerCustomer",
      }]);
      assertEvaluationContext(
        initial.evaluationContext,
        bundle,
        deadlineCase.evaluationAtMs,
      );
      assert.equal(initial.evaluationContext.timeZone, "America/New_York");
      assert.equal(
        initial.evaluationContext.utcOffsetMinutes,
        deadlineCase.label === "fall-back-second-occurrence" ? -300 : -240,
      );
      assert.match(
        initial.evaluationContext.availabilityGeneration,
        /^[a-f0-9]{64}$/u,
      );
      assert.equal(initial.logicalExpiresAtMillis, deadlineCase.cutoffAtMs);
      assert.equal(
        initial.evaluationContext.validUntilExclusiveMillis,
        initial.logicalExpiresAtMillis,
      );

      const checkPath = privateCustomerBiteSaverGuestOfferCheckCollection +
        "/" + initial.operationRef;
      const pending = await database.getDocument(checkPath);
      assert.notEqual(pending, null);
      assert.equal(pending.data.state, "awaitingAnswer");
      assert.equal(
        millis(pending.data.evaluationAt),
        deadlineCase.evaluationAtMs,
      );
      assert.equal(
        millis(pending.data.logicalExpiresAt),
        deadlineCase.documentCutoffAtMs ?? deadlineCase.cutoffAtMs,
      );
      assert.equal(
        pending.data.activeBatch.issuedAtMillis,
        deadlineCase.evaluationAtMs,
      );
      assert.equal(
        pending.data.activeBatch.expiresAtMillis,
        deadlineCase.cutoffAtMs,
      );
      assert.equal(pending.data.activeBatch.sourceExhausted, true);
      assert.deepEqual(
        pending.data.activeBatch.candidates.map(({offerId}) => offerId),
        [checkedCouponOfferId],
      );
      const retainedOffers = operation === "offerPage"
        ? pending.data.progress.readyOffers
        : pending.data.progress.currentRestaurant.retainedOffers;
      const eligibilityCutoffAtMs =
        deadlineCase.eligibilityCutoffAtMs ?? deadlineCase.cutoffAtMs;
      assert.deepEqual(
        retainedOffers.map(({offerId, eligibilityExpiresAtMs}) => ({
          offerId,
          eligibilityExpiresAtMs,
        })),
        [{
          offerId: expiringDailyOfferId,
          eligibilityExpiresAtMs: eligibilityCutoffAtMs,
        }],
        scenarioLabel,
      );
      if (operation === "offerPage") {
        assert.equal(pending.data.progress.scanBoundary, null);
      } else {
        assert.equal(
          pending.data.progress.currentRestaurant.restaurantId,
          expiring.publicRestaurantId,
        );
        assert.equal(
          pending.data.progress.currentRestaurant.liveBoundary,
          null,
        );
        assert.equal(
          pending.data.progress.currentRestaurant.visibleOfferCount,
          1,
        );
        assert.equal(
          pending.data.progress.currentRestaurant.countKnown,
          true,
        );
        assert.deepEqual(pending.data.progress.readyRestaurants, []);
      }
      return {
        scenarioLabel,
        deadlineCase,
        operation,
        clock,
        bundle,
        expiring,
        witness,
        expiringDailyOfferId,
        checkedCouponOfferId,
        witnessCouponOfferId,
        sourcePaths,
        sourceTimesBefore,
        guestStateRevision,
        originalRequest,
        pageHandler,
        initial,
        checkPath,
      };
    }

    function assertGuestCompletion(scenario, completed) {
      assert.equal(completed.outcome, "complete");
      assert.equal(completed.operation, scenario.operation);
      assert.equal(
        completed.evaluationContext.evaluationAtMillis,
        scenario.deadlineCase.evaluationAtMs,
      );
      if (scenario.operation === "offerPage") {
        assert.deepEqual(
          completed.result.offers.map(({offerId}) => offerId),
          [scenario.expiringDailyOfferId],
        );
        assert.deepEqual(
          completed.result.offers.map(({available}) => available),
          [true],
        );
        assert.match(
          completed.result.offers[0].offerOccurrence,
          /^bsoc1\.[A-Za-z0-9_-]+$/u,
        );
        assert.equal(completed.result.hasMore, false);
        assert.equal(completed.result.nextCursor, null);
        assert.equal(completed.result.partial, false);
        return;
      }
      assert.notEqual(scenario.witness, null);
      assert.notEqual(scenario.witnessCouponOfferId, null);
      assert.deepEqual(
        completed.result.restaurants.map(({restaurantId}) => restaurantId),
        [scenario.expiring.publicRestaurantId,
          scenario.witness.publicRestaurantId],
      );
      const [expiringRestaurant, witnessRestaurant] =
        completed.result.restaurants;
      assert.deepEqual(
        expiringRestaurant.offers.map(({offerId}) => offerId),
        [scenario.expiringDailyOfferId],
      );
      assert.equal(expiringRestaurant.usableOfferCount, 1);
      assert.equal(expiringRestaurant.offerCountState, "current");
      assert.equal(expiringRestaurant.hasMoreOffers, false);
      assert.deepEqual(
        witnessRestaurant.offers.map(({offerId}) => offerId),
        [scenario.witnessCouponOfferId],
      );
      assert.equal(witnessRestaurant.usableOfferCount, 1);
      assert.equal(witnessRestaurant.offerCountState, "current");
      assert.equal(witnessRestaurant.hasMoreOffers, false);
      for (const restaurant of completed.result.restaurants) {
        for (const offer of restaurant.offers) {
          assert.match(offer.offerOccurrence, /^bsoc1\.[A-Za-z0-9_-]+$/u);
        }
      }
      assert.equal(completed.result.hasMore, false);
      assert.equal(completed.result.nextCursor, null);
      assert.equal(completed.result.partial, false);
    }

    async function assertExpiredRefresh(scenario, refreshAtMs) {
      scenario.clock.value = refreshAtMs;
      const invalidated = await scenario.pageHandler(
        {
          ...scenario.originalRequest,
          clientRequestId: requestId(`${scenario.scenarioLabel}-refresh`),
        },
        scenario.bundle.context,
      );
      assert.equal(invalidated.outcome, "retryRequired");
      assert.equal(invalidated.operation, scenario.operation);
      assert.equal(
        invalidated.guestStateRevision,
        scenario.guestStateRevision,
      );
      assert.equal(invalidated.reason, "sourceChanged");
      assert.equal(
        invalidated.restartFrom,
        scenario.operation === "restaurantPage"
          ? "search"
          : "originalOperation",
      );
      assert.equal(
        invalidated.logicalExpiresAtMillis,
        scenario.deadlineCase.cutoffAtMs,
      );
      assert.equal("result" in invalidated, false);
      const invalidatedDocument = await database.getDocument(
        scenario.checkPath,
      );
      assert.notEqual(invalidatedDocument, null);
      assert.equal(invalidatedDocument.data.state, "retryRequired");
      assert.equal(invalidatedDocument.data.activeBatch, null);
      assert.equal(invalidatedDocument.data.acceptedAnswer, null);
      assert.equal(invalidatedDocument.data.retryReason, "sourceChanged");
      assert.equal(
        invalidatedDocument.data.restartFrom,
        scenario.operation === "restaurantPage"
          ? "search"
          : "originalOperation",
      );
      assert.equal(
        millis(invalidatedDocument.data.evaluationAt),
        scenario.deadlineCase.evaluationAtMs,
      );
      assert.equal(
        millis(invalidatedDocument.data.logicalExpiresAt),
        scenario.deadlineCase.cutoffAtMs,
      );
      const repeated = await scenario.pageHandler(
        {
          ...scenario.originalRequest,
          clientRequestId: requestId(
            `${scenario.scenarioLabel}-repeat-refresh`,
          ),
        },
        scenario.bundle.context,
      );
      assert.deepEqual(repeated, invalidated);
      return invalidated;
    }

    async function assertFreshCurrentControl(scenario, freshAtMs) {
      scenario.clock.value = freshAtMs;
      const freshRequest = scenario.operation === "offerPage"
        ? offerPageRequest(
            scenario.bundle,
            scenario.expiring.publicRestaurantId,
            {
              clientRequestId: requestId(
                `${scenario.scenarioLabel}-fresh`,
              ),
              guestStateRevision: scenario.guestStateRevision + 1,
            },
          )
        : pageRequest(scenario.bundle, {
            clientRequestId: requestId(`${scenario.scenarioLabel}-fresh`),
            guestStateRevision: scenario.guestStateRevision + 1,
          });
      const fresh = await scenario.pageHandler(
        freshRequest,
        scenario.bundle.context,
      );
      assert.equal(fresh.outcome, "guestCheckRequired");
      assert.equal(fresh.operation, scenario.operation);
      assert.notEqual(fresh.operationRef, scenario.initial.operationRef);
      assert.equal(
        fresh.evaluationContext.evaluationAtMillis,
        freshAtMs,
      );
      assert.equal(fresh.evaluationContext.timeZone, "America/New_York");
      assert.equal(
        fresh.evaluationContext.utcOffsetMinutes,
        scenario.deadlineCase.label === "fall-back-below-start" ? -300 : -240,
      );
      assert.deepEqual(fresh.candidates, [{
        offerId: scenario.checkedCouponOfferId,
        usagePolicy: "oncePerCustomer",
      }]);
      const freshComplete =
        await continueCustomerBiteSaverGuestOfferCheckHandler(
          guestAnswerRequest(
            scenario.bundle,
            fresh,
            [scenario.checkedCouponOfferId],
            {
              clientRequestId: requestId(
                `${scenario.scenarioLabel}-fresh-answer`,
              ),
            },
          ),
          scenario.bundle.context,
        );
      assert.equal(freshComplete.outcome, "complete");
      assert.equal(freshComplete.operation, scenario.operation);
      assert.equal(
        freshComplete.evaluationContext.evaluationAtMillis,
        freshAtMs,
      );
      assert.equal(
        JSON.stringify(freshComplete).includes(
          scenario.expiringDailyOfferId,
        ),
        false,
      );
      if (scenario.operation === "offerPage") {
        assert.deepEqual(freshComplete.result.offers, []);
        assert.equal(
          freshComplete.result.restaurantId,
          scenario.expiring.publicRestaurantId,
        );
        assert.equal(freshComplete.result.hasMore, false);
        assert.equal(freshComplete.result.nextCursor, null);
        assert.equal(freshComplete.result.partial, false);
      } else {
        assert.notEqual(scenario.witness, null);
        assert.notEqual(scenario.witnessCouponOfferId, null);
        assert.deepEqual(
          freshComplete.result.restaurants.map(({restaurantId}) =>
            restaurantId),
          [scenario.witness.publicRestaurantId],
        );
        const [restaurant] = freshComplete.result.restaurants;
        assert.deepEqual(
          restaurant.offers.map(({offerId}) => offerId),
          [scenario.witnessCouponOfferId],
        );
        assert.deepEqual(
          restaurant.offers.map(({available}) => available),
          [true],
        );
        assert.match(
          restaurant.offers[0].offerOccurrence,
          /^bsoc1\.[A-Za-z0-9_-]+$/u,
        );
        assert.equal(restaurant.usableOfferCount, 1);
        assert.equal(restaurant.offerCountState, "current");
        assert.equal(restaurant.hasMoreOffers, false);
        assert.equal(freshComplete.result.hasMore, false);
        assert.equal(freshComplete.result.nextCursor, null);
        assert.equal(freshComplete.result.partial, false);
      }
      return freshComplete;
    }

    async function assertRollbackReentry(scenario) {
      const evaluationAtMs = Date.parse("2026-11-01T06:30:00.000Z");
      const eligibilityCutoffAtMs = Date.parse(
        "2026-11-01T07:31:00.000Z",
      );
      const operationCutoffAtMs = evaluationAtMs + 5 * 60_000;
      const documentCutoffAtMs = evaluationAtMs + 60 * 60_000;
      const reentryScenario = await prepareGuestDeadlineScenario(
        {
          label: "fall-back-second-occurrence",
          evaluationAtMs,
          cutoffAtMs: operationCutoffAtMs,
          documentCutoffAtMs,
          eligibilityCutoffAtMs,
          dailyOverrides: scenario.deadlineCase.dailyOverrides,
        },
        scenario.operation,
        "fresh-fold-reentry",
      );
      assert.equal(
        reentryScenario.initial.evaluationContext.evaluationAtMillis,
        evaluationAtMs,
      );
      assert.equal(
        reentryScenario.initial.logicalExpiresAtMillis,
        operationCutoffAtMs,
      );
      const completed =
        await continueCustomerBiteSaverGuestOfferCheckHandler(
          guestAnswerRequest(
            reentryScenario.bundle,
            reentryScenario.initial,
            [reentryScenario.checkedCouponOfferId],
            {
              clientRequestId: requestId(
                `${reentryScenario.scenarioLabel}-answer`,
              ),
            },
          ),
          reentryScenario.bundle.context,
        );
      assertGuestCompletion(reentryScenario, completed);
      assert.deepEqual(
        await rawDocumentUpdateTimes(reentryScenario.sourcePaths),
        reentryScenario.sourceTimesBefore,
      );
      return Object.freeze({
        evaluationAtMs,
        eligibilityCutoffAtMs,
        documentCutoffAtMs,
        operationCutoffAtMs,
      });
    }

    for (let caseIndex = 0; caseIndex < deadlineCases.length; caseIndex += 1) {
      const deadlineCase = deadlineCases[caseIndex];
      for (let operationIndex = 0; operationIndex < operations.length;
        operationIndex += 1) {
        const operation = operations[operationIndex];
        const rowEvidence = {
          deadlineKind: deadlineCase.label,
          operation,
          evaluationAtMillis: deadlineCase.evaluationAtMs,
          cutoffAtMillis: deadlineCase.cutoffAtMs,
          pendingBranches: [],
          acceptedAnswerReplayReason: null,
          freshResultCount: null,
        };

        for (const branch of pendingBranches) {
          const scenario = await prepareGuestDeadlineScenario(
            deadlineCase,
            operation,
            branch.label,
          );
          const answer = guestAnswerRequest(
            scenario.bundle,
            scenario.initial,
            [scenario.checkedCouponOfferId],
            {
              clientRequestId: requestId(
                `${scenario.scenarioLabel}-answer`,
              ),
            },
          );
          const branchAtMs = deadlineCase.cutoffAtMs + branch.offsetMs;
          scenario.clock.value = branchAtMs;
          const response =
            await continueCustomerBiteSaverGuestOfferCheckHandler(
              answer,
              scenario.bundle.context,
            );
          if (branch.offsetMs < 0) {
            assertGuestCompletion(scenario, response);
          } else {
            assert.equal(response.outcome, "retryRequired");
            assert.equal(response.operation, operation);
            assert.equal(
              response.guestStateRevision,
              scenario.guestStateRevision,
            );
            assert.equal(response.reason, "checkExpired");
            assert.equal(response.restartFrom, "originalOperation");
            assert.equal(
              response.logicalExpiresAtMillis,
              deadlineCase.cutoffAtMs,
            );
            assert.equal("result" in response, false);
          }
          const invalidated = await assertExpiredRefresh(
            scenario,
            Math.max(branchAtMs, deadlineCase.cutoffAtMs),
          );
          if (branch.offsetMs === 0) {
            const freshComplete = await assertFreshCurrentControl(
              scenario,
              deadlineCase.cutoffAtMs,
            );
            rowEvidence.freshResultCount = operation === "offerPage"
              ? freshComplete.result.offers.length
              : freshComplete.result.restaurants.length;
            if (deadlineCase.label === "fall-back-below-start") {
              rowEvidence.rollbackReentry = await assertRollbackReentry(
                scenario,
              );
            }
          }
          assert.deepEqual(
            await rawDocumentUpdateTimes(scenario.sourcePaths),
            scenario.sourceTimesBefore,
          );
          rowEvidence.pendingBranches.push(Object.freeze({
            branch: branch.label,
            requestAtMillis: branchAtMs,
            answerOutcome: response.outcome,
            answerReason: response.reason ?? null,
            refreshReason: invalidated.reason,
          }));
        }

        const replayScenario = await prepareGuestDeadlineScenario(
          deadlineCase,
          operation,
          "lost-accepted-answer",
        );
        const acceptedAnswer = guestAnswerRequest(
          replayScenario.bundle,
          replayScenario.initial,
          [replayScenario.checkedCouponOfferId],
          {
            clientRequestId: requestId(
              `${replayScenario.scenarioLabel}-answer`,
            ),
          },
        );
        const lostResponse = new Error(
          `accepted ${replayScenario.scenarioLabel} guest response was lost`,
        );
        let interceptedAcceptedAnswer = false;
        hooks.afterTransactionCommit = async (value) => {
          if (
            interceptedAcceptedAnswer ||
            value?.document?.operationRef !==
              replayScenario.initial.operationRef ||
            value.document.state !== "answerAccepted"
          ) {
            return;
          }
          interceptedAcceptedAnswer = true;
          const stored = await realDatabase.getDocument(
            replayScenario.checkPath,
          );
          assert.notEqual(stored, null);
          assert.equal(stored.data.state, "answerAccepted");
          throw lostResponse;
        };
        try {
          await assert.rejects(
            continueCustomerBiteSaverGuestOfferCheckHandler(
              acceptedAnswer,
              replayScenario.bundle.context,
            ),
            (error) => error === lostResponse,
          );
        } finally {
          hooks.afterTransactionCommit = null;
        }
        assert.equal(interceptedAcceptedAnswer, true);
        const accepted = await database.getDocument(replayScenario.checkPath);
        assert.notEqual(accepted, null);
        assert.equal(accepted.data.state, "answerAccepted");
        assert.equal(
          millis(accepted.data.evaluationAt),
          deadlineCase.evaluationAtMs,
        );
        assert.equal(
          millis(accepted.data.logicalExpiresAt),
          deadlineCase.cutoffAtMs,
        );
        assert.equal(
          accepted.data.activeBatch.expiresAtMillis,
          deadlineCase.cutoffAtMs,
        );
        replayScenario.clock.value = deadlineCase.cutoffAtMs;
        const expiredReplay =
          await continueCustomerBiteSaverGuestOfferCheckHandler(
            acceptedAnswer,
            replayScenario.bundle.context,
          );
        assert.equal(expiredReplay.outcome, "retryRequired");
        assert.equal(expiredReplay.operation, operation);
        assert.equal(expiredReplay.reason, "checkExpired");
        assert.equal(expiredReplay.restartFrom, "originalOperation");
        assert.equal(
          expiredReplay.logicalExpiresAtMillis,
          deadlineCase.cutoffAtMs,
        );
        assert.equal("result" in expiredReplay, false);
        await assertExpiredRefresh(
          replayScenario,
          deadlineCase.cutoffAtMs,
        );
        const replayInvalidatedDocument = await database.getDocument(
          replayScenario.checkPath,
        );
        assert.notEqual(replayInvalidatedDocument, null);
        assert.deepEqual(
          Object.keys(
            replayInvalidatedDocument.data.lastAcceptedAnswer,
          ).sort(),
          ["batchSequence", "clientRequestId", "requestFingerprint"],
        );
        assert.equal(
          replayInvalidatedDocument.data.lastAcceptedAnswer.batchSequence,
          acceptedAnswer.batchSequence,
        );
        assert.equal(
          replayInvalidatedDocument.data.lastAcceptedAnswer.clientRequestId,
          acceptedAnswer.clientRequestId,
        );
        assert.match(
          replayInvalidatedDocument.data.lastAcceptedAnswer
            .requestFingerprint,
          /^[a-f0-9]{64}$/u,
        );
        assert.deepEqual(
          await rawDocumentUpdateTimes(replayScenario.sourcePaths),
          replayScenario.sourceTimesBefore,
        );
        rowEvidence.acceptedAnswerReplayReason = expiredReplay.reason;
        scenarioEvidence.push(Object.freeze({
          ...rowEvidence,
          pendingBranches: Object.freeze(rowEvidence.pendingBranches),
        }));
      }
    }
    assert.equal(scenarioEvidence.length, 8);
    assert.ok(scenarioEvidence.every((entry) =>
      entry.pendingBranches.length === 3));
    metrics.scenarioMeasurements.dailySpecialDeadlines = {
      parameterizedScenarios: scenarioEvidence.length,
      deadlineKinds: deadlineCases.length,
      guestPageOperations: operations.length,
      retainedSixRowScenarios: 6,
      rollbackScenarios: 2,
      pendingBoundaryBranches: scenarioEvidence.length *
        pendingBranches.length,
      acceptedAnswerReplayScenarios: scenarioEvidence.length,
      rollbackReentryScenarios: scenarioEvidence.filter((entry) =>
        entry.rollbackReentry !== undefined).length,
      evidence: scenarioEvidence,
    };
  });

  test("signed page replay is bounded before, at, and after daily-special deadlines",
    {timeout: 240_000}, async () => {
    const deadlineCases = Object.freeze([
      Object.freeze({
        label: "inclusive-window",
        evaluationAtMs: Date.parse("2026-09-10T12:00:00.000Z"),
        cutoffAtMs: Date.parse("2026-09-10T12:03:00.000Z"),
        dailyOverrides: Object.freeze({
          availabilityMode: "specificDays",
          daysOfWeek: Object.freeze([4]),
          allDay: false,
          startTime: "08:00",
          endTime: "08:02",
          hideWhenUnavailable: true,
        }),
      }),
      Object.freeze({
        label: "fall-back-below-start",
        // First 01:45 EDT; the cutoff is the rollback to 01:00 EST.
        evaluationAtMs: Date.parse("2026-11-01T05:45:00.000Z"),
        cutoffAtMs: Date.parse("2026-11-01T06:00:00.000Z"),
        dailyOverrides: Object.freeze({
          availabilityMode: "specificDays",
          daysOfWeek: Object.freeze([7]),
          allDay: false,
          startTime: "01:30",
          endTime: "02:30",
          hideWhenUnavailable: true,
        }),
      }),
    ]);
    const operations = Object.freeze(["offerPage", "restaurantPage"]);
    const scenarioEvidence = [];
    const lostResponseEvidence = [];
    const lateCrossingEvidence = [];
    let fixtureSequence = 0;

    async function prepareSignedDeadlineScenario(
      deadlineCase,
      operation,
      suffix,
    ) {
      fixtureSequence += 1;
      const scenarioLabel = `${deadlineCase.label}-${operation}-${suffix}`;
      const clock = {value: deadlineCase.evaluationAtMs};
      const bundle = await startSession({
        clock,
        request: {
          timeZone: "America/New_York",
          utcOffsetMinutes: -240,
        },
      });
      const session = await markReady(bundle);
      const parent = readyRestaurantWrites(
        session,
        9_000 + fixtureSequence,
        {
          preparationNowMs: deadlineCase.evaluationAtMs,
          offerCount: 2,
          offerOverridesForIndex: (_index, offerType) =>
            offerType === "dailySpecial"
              ? deadlineCase.dailyOverrides
              : {usageRule: "Unlimited"},
        },
      );
      await commitAll(parent.writes);
      const dailyOfferId = customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        parent.accountId,
        "dailySpecial",
        parent.daily[0].sourceDocumentId,
      );
      const couponOfferId = customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        parent.accountId,
        "coupon",
        parent.coupons[0].sourceDocumentId,
      );
      const sourcePaths = rawSourcePaths(parent);
      const sourceTimesBefore = await rawDocumentUpdateTimes(sourcePaths);
      const request = operation === "offerPage"
        ? offerPageRequest(bundle, parent.publicRestaurantId, {
            clientRequestId: requestId(`${scenarioLabel}-page`),
          })
        : pageRequest(bundle, {
            clientRequestId: requestId(`${scenarioLabel}-page`),
          });
      return {
        scenarioLabel,
        deadlineCase,
        operation,
        clock,
        bundle,
        session,
        parent,
        dailyOfferId,
        couponOfferId,
        sourcePaths,
        sourceTimesBefore,
        request,
        pageHandler: operation === "offerPage"
          ? getCustomerBiteSaverOfferPageHandler
          : getCustomerBiteSaverSearchPageHandler,
      };
    }

    function assertSignedPage(scenario, response, includeDaily) {
      let offers;
      if (scenario.operation === "offerPage") {
        assert.equal(response.restaurantId, scenario.parent.publicRestaurantId);
        assert.equal(response.hasMore, false);
        assert.equal(response.nextCursor, null);
        assert.equal(response.partial, false);
        offers = response.offers;
      } else {
        assert.equal(response.state, "ready");
        assert.equal(response.restaurants.length, 1);
        assert.equal(
          response.restaurants[0].restaurantId,
          scenario.parent.publicRestaurantId,
        );
        assert.equal(response.hasMore, false);
        assert.equal(response.nextCursor, null);
        assert.equal(response.partial, false);
        assert.equal(
          response.restaurants[0].usableOfferCount,
          includeDaily ? 2 : 1,
        );
        assert.equal(
          response.restaurants[0].offerCountState,
          "current",
        );
        assert.equal(response.restaurants[0].hasMoreOffers, false);
        offers = response.restaurants[0].offers;
      }
      assert.deepEqual(
        offers.map(({offerId}) => offerId),
        includeDaily
          ? [scenario.dailyOfferId, scenario.couponOfferId]
          : [scenario.couponOfferId],
      );
      assert.ok(offers.every(({available}) => available));
      for (const offer of offers) {
        assert.match(offer.offerOccurrence, /^bsoc1\.[A-Za-z0-9_-]+$/u);
      }
    }

    async function newDocumentsSince(pathsBefore) {
      const paths = [...ownedPaths].filter((path) => !pathsBefore.has(path));
      return database.getDocuments(paths);
    }

    for (const deadlineCase of deadlineCases) {
      for (const operation of operations) {
        const scenario = await prepareSignedDeadlineScenario(
          deadlineCase,
          operation,
          "replay",
        );
        const pathsBeforeInitial = new Set(ownedPaths);
        const initial = await scenario.pageHandler(
          scenario.request,
          scenario.bundle.context,
        );
        assertSignedPage(scenario, initial, true);
        const initialDocuments = await newDocumentsSince(pathsBeforeInitial);
        const replayDocuments = initialDocuments.filter((document) =>
          document?.data.role === "requestReplay" &&
          document.data.sessionId === scenario.session.sessionId &&
          document.data.purpose === operation);
        assert.equal(replayDocuments.length, 1);
        const replayDocument = replayDocuments[0];
        assert.equal(
          millis(replayDocument.data.evaluationAt),
          deadlineCase.evaluationAtMs,
        );
        assert.equal(
          millis(replayDocument.data.logicalExpiresAt),
          deadlineCase.cutoffAtMs,
        );
        assert.ok(
          millis(replayDocument.data.expiresAt) > deadlineCase.cutoffAtMs,
        );
        const evidenceDocuments = initialDocuments.filter((document) =>
          document !== null &&
          document.data.sessionId === scenario.session.sessionId &&
          (document.data.role === "deliveredOfferIdentity" ||
            document.data.role === "deliveredRestaurantIdentity"));
        assert.equal(
          evidenceDocuments.filter(({data}) =>
            data.role === "deliveredOfferIdentity").length,
          2,
        );
        assert.equal(
          evidenceDocuments.filter(({data}) =>
            data.role === "deliveredRestaurantIdentity").length,
          operation === "restaurantPage" ? 1 : 0,
        );

        scenario.clock.value = deadlineCase.cutoffAtMs - 1;
        const beforeDeadline = await scenario.pageHandler(
          scenario.request,
          scenario.bundle.context,
        );
        assert.deepEqual(beforeDeadline, initial);
        const evidencePaths = evidenceDocuments.map(({path}) => path).sort();
        const evidenceTimesBeforeExpiry = await rawDocumentUpdateTimes(
          evidencePaths,
        );
        const pathsBeforeExpiry = new Set(ownedPaths);

        scenario.clock.value = deadlineCase.cutoffAtMs;
        await assert.rejects(
          scenario.pageHandler(scenario.request, scenario.bundle.context),
          contractError("failed-precondition"),
        );
        scenario.clock.value = deadlineCase.cutoffAtMs + 1;
        await assert.rejects(
          scenario.pageHandler(scenario.request, scenario.bundle.context),
          contractError("failed-precondition"),
        );
        assert.deepEqual(
          [...ownedPaths].filter((path) => !pathsBeforeExpiry.has(path)),
          [],
        );
        assert.deepEqual(
          await rawDocumentUpdateTimes(evidencePaths),
          evidenceTimesBeforeExpiry,
        );
        const replayAfterExpiry = await database.getDocument(
          replayDocument.path,
        );
        assert.notEqual(replayAfterExpiry, null);
        assert.equal(
          millis(replayAfterExpiry.data.evaluationAt),
          deadlineCase.evaluationAtMs,
        );
        assert.equal(
          millis(replayAfterExpiry.data.logicalExpiresAt),
          deadlineCase.cutoffAtMs,
        );

        const freshRequest = {
          ...scenario.request,
          clientRequestId: requestId(`${scenario.scenarioLabel}-fresh`),
        };
        const fresh = await scenario.pageHandler(
          freshRequest,
          scenario.bundle.context,
        );
        assertSignedPage(scenario, fresh, false);
        assert.equal(
          JSON.stringify(fresh).includes(scenario.dailyOfferId),
          false,
        );
        let rollbackReentry = null;
        if (deadlineCase.label === "fall-back-below-start") {
          const reentryAtMs = Date.parse("2026-11-01T06:30:00.000Z");
          const reentryEligibilityCutoffAtMs = Date.parse(
            "2026-11-01T07:31:00.000Z",
          );
          const reentryReplayCutoffAtMs = reentryAtMs + 15 * 60_000;
          const reentryScenario = await prepareSignedDeadlineScenario(
            {
              label: "fall-back-second-occurrence",
              evaluationAtMs: reentryAtMs,
              cutoffAtMs: reentryEligibilityCutoffAtMs,
              dailyOverrides: deadlineCase.dailyOverrides,
            },
            operation,
            "fresh-fold-reentry",
          );
          const pathsBeforeReentry = new Set(ownedPaths);
          const reentry = await reentryScenario.pageHandler(
            reentryScenario.request,
            reentryScenario.bundle.context,
          );
          assertSignedPage(reentryScenario, reentry, true);
          const reentryReplayDocuments = (await newDocumentsSince(
            pathsBeforeReentry,
          )).filter((document) =>
            document?.data.role === "requestReplay" &&
            document.data.sessionId === reentryScenario.session.sessionId &&
            document.data.purpose === operation);
          assert.equal(reentryReplayDocuments.length, 1);
          assert.equal(
            millis(reentryReplayDocuments[0].data.evaluationAt),
            reentryAtMs,
          );
          assert.equal(
            millis(reentryReplayDocuments[0].data.logicalExpiresAt),
            reentryReplayCutoffAtMs,
          );
          assert.deepEqual(
            await rawDocumentUpdateTimes(reentryScenario.sourcePaths),
            reentryScenario.sourceTimesBefore,
          );
          rollbackReentry = Object.freeze({
            evaluationAtMillis: reentryAtMs,
            eligibilityCutoffAtMillis: reentryEligibilityCutoffAtMs,
            replayCutoffAtMillis: reentryReplayCutoffAtMs,
          });
        }
        assert.deepEqual(
          await rawDocumentUpdateTimes(scenario.sourcePaths),
          scenario.sourceTimesBefore,
        );
        scenarioEvidence.push(Object.freeze({
          deadlineKind: deadlineCase.label,
          operation,
          evaluationAtMillis: deadlineCase.evaluationAtMs,
          cutoffAtMillis: deadlineCase.cutoffAtMs,
          beforeDeadlineReplayAtMillis: deadlineCase.cutoffAtMs - 1,
          exactDeadlineReplayAtMillis: deadlineCase.cutoffAtMs,
          afterDeadlineReplayAtMillis: deadlineCase.cutoffAtMs + 1,
          beforeDeadlineReplayMatched: true,
          exactDeadlineRejected: true,
          afterDeadlineRejected: true,
          freshOfferCount: operation === "offerPage"
            ? fresh.offers.length
            : fresh.restaurants[0].offers.length,
          evidenceWritesAfterExpiry: 0,
          rollbackReentry,
        }));
      }
    }

    for (const operation of operations) {
      const deadlineCase = deadlineCases[0];
      const scenario = await prepareSignedDeadlineScenario(
        deadlineCase,
        operation,
        "lost-response",
      );
      const pathsBeforeLostResponse = new Set(ownedPaths);
      const lostResponse = new Error(
        `signed ${operation} response was lost after replay reservation`,
      );
      let interceptedReservation = false;
      hooks.afterTransactionCommit = async (_value, committedWrites) => {
        if (
          interceptedReservation ||
          !committedWrites.some((write) =>
            write.data?.role === "requestReplay" &&
            write.data.sessionId === scenario.session.sessionId &&
            write.data.purpose === operation)
        ) {
          return;
        }
        interceptedReservation = true;
        throw lostResponse;
      };
      try {
        await assert.rejects(
          scenario.pageHandler(scenario.request, scenario.bundle.context),
          (error) => error === lostResponse,
        );
      } finally {
        hooks.afterTransactionCommit = null;
      }
      assert.equal(interceptedReservation, true);
      const documentsAfterLoss = await newDocumentsSince(
        pathsBeforeLostResponse,
      );
      assert.equal(
        documentsAfterLoss.filter((document) =>
          document?.data.role === "requestReplay" &&
          document.data.sessionId === scenario.session.sessionId &&
          document.data.purpose === operation).length,
        1,
      );
      assert.equal(
        documentsAfterLoss.filter((document) =>
          document !== null &&
          (document.data.role === "deliveredOfferIdentity" ||
            document.data.role === "deliveredRestaurantIdentity")).length,
        0,
      );
      scenario.clock.value = deadlineCase.cutoffAtMs - 1;
      const recovered = await scenario.pageHandler(
        scenario.request,
        scenario.bundle.context,
      );
      assertSignedPage(scenario, recovered, true);
      const recoveredReplay = (await newDocumentsSince(
        pathsBeforeLostResponse,
      )).find((document) =>
        document?.data.role === "requestReplay" &&
        document.data.sessionId === scenario.session.sessionId &&
        document.data.purpose === operation);
      assert.notEqual(recoveredReplay, undefined);
      assert.equal(
        millis(recoveredReplay.data.evaluationAt),
        deadlineCase.evaluationAtMs,
      );
      assert.equal(
        millis(recoveredReplay.data.logicalExpiresAt),
        deadlineCase.cutoffAtMs,
      );
      scenario.clock.value = deadlineCase.cutoffAtMs;
      await assert.rejects(
        scenario.pageHandler(scenario.request, scenario.bundle.context),
        contractError("failed-precondition"),
      );
      assert.deepEqual(
        await rawDocumentUpdateTimes(scenario.sourcePaths),
        scenario.sourceTimesBefore,
      );
      lostResponseEvidence.push(Object.freeze({
        operation,
        evaluationAtMillis: deadlineCase.evaluationAtMs,
        recoveredAtMillis: deadlineCase.cutoffAtMs - 1,
        cutoffAtMillis: deadlineCase.cutoffAtMs,
        recoveredBeforeCutoff: true,
        rejectedAtCutoff: true,
      }));
    }

    for (const operation of operations) {
      const deadlineCase = deadlineCases[0];
      const scenario = await prepareSignedDeadlineScenario(
        deadlineCase,
        operation,
        "late-clock-crossing",
      );
      const pathsBeforeRequest = new Set(ownedPaths);
      let crossedAtReplayCommit = false;
      hooks.afterTransactionCommit = async (_value, committedWrites) => {
        if (
          crossedAtReplayCommit ||
          !committedWrites.some((write) =>
            write.data?.role === "requestReplay" &&
            write.data.sessionId === scenario.session.sessionId &&
            write.data.purpose === operation)
        ) {
          return;
        }
        crossedAtReplayCommit = true;
        scenario.clock.value = deadlineCase.cutoffAtMs;
      };
      try {
        await assert.rejects(
          scenario.pageHandler(scenario.request, scenario.bundle.context),
          contractError("failed-precondition"),
        );
      } finally {
        hooks.afterTransactionCommit = null;
      }
      assert.equal(crossedAtReplayCommit, true);
      const documentsAfterCrossing = await newDocumentsSince(
        pathsBeforeRequest,
      );
      const replayAfterCrossing = documentsAfterCrossing.filter((document) =>
        document?.data.role === "requestReplay" &&
        document.data.sessionId === scenario.session.sessionId &&
        document.data.purpose === operation);
      assert.equal(replayAfterCrossing.length, 1);
      assert.equal(
        millis(replayAfterCrossing[0].data.evaluationAt),
        deadlineCase.evaluationAtMs,
      );
      assert.equal(
        millis(replayAfterCrossing[0].data.logicalExpiresAt),
        deadlineCase.cutoffAtMs,
      );
      assert.equal(
        documentsAfterCrossing.filter((document) =>
          document !== null &&
          (document.data.role === "deliveredOfferIdentity" ||
            document.data.role === "deliveredRestaurantIdentity")).length,
        0,
      );
      assert.deepEqual(
        await rawDocumentUpdateTimes(scenario.sourcePaths),
        scenario.sourceTimesBefore,
      );
      lateCrossingEvidence.push(Object.freeze({
        operation,
        evaluationAtMillis: deadlineCase.evaluationAtMs,
        crossedAtMillis: deadlineCase.cutoffAtMs,
        successfulIssuanceEvidenceWrites: 0,
      }));
    }

    assert.equal(scenarioEvidence.length, 4);
    assert.equal(lostResponseEvidence.length, 2);
    assert.equal(lateCrossingEvidence.length, 2);
    metrics.scenarioMeasurements.signedPageReplayDeadlines = {
      parameterizedScenarios: scenarioEvidence.length,
      deadlineKinds: deadlineCases.length,
      pageOperations: operations.length,
      replayBoundaryBranches: scenarioEvidence.length * 3,
      lostResponseScenarios: lostResponseEvidence.length,
      lateClockCrossingScenarios: lateCrossingEvidence.length,
      rollbackReentryScenarios: scenarioEvidence.filter((entry) =>
        entry.rollbackReentry !== null).length,
      evidence: scenarioEvidence,
      lostResponseEvidence,
      lateCrossingEvidence,
    };
  });

  test("guest page checkpoint crosses five minutes without replaying 1,000 accepted candidates",
    {timeout: 180_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({guest: true, clock});
    const session = await markReady(bundle);
    const unavailableCount = 1_000;
    const parent = readyRestaurantWrites(session, 350, {
      offerCount: unavailableCount + 1,
      onlyCoupons: true,
      offerOverridesForIndex: (index) => ({
        usageRule: index < unavailableCount
          ? "Once per customer"
          : "Unlimited",
      }),
    });
    await commitAll(parent.writes);
    const initialRequest = offerPageRequest(bundle, parent.publicRestaurantId, {
      clientRequestId: requestId("guest-long-page"),
      guestStateRevision: 350,
    });
    let response = await getCustomerBiteSaverOfferPageHandler(
      initialRequest,
      bundle.context,
    );
    const acceptedOfferIds = [];
    let challengeCount = 0;
    let refreshProved = false;
    let maximumCheckpointBytes = 0;
    let workBudgetResumes = 0;
    while (response.outcome !== "complete") {
      if (response.outcome === "retryRequired") {
        assert.equal(response.reason, "workBudget");
        workBudgetResumes += 1;
        response = await getCustomerBiteSaverOfferPageHandler(
          initialRequest,
          bundle.context,
        );
        continue;
      }
      assert.equal(response.outcome, "guestCheckRequired");
      assert.equal(
        response.evaluationContext.evaluationAtMillis,
        fixedNowMs,
      );
      challengeCount += 1;
      assert.ok(response.candidates.length > 0);
      assert.ok(response.candidates.length <=
        customerBiteSaverGuestCheckMaximumCandidateIds);
      const checkPath = `${privateCustomerBiteSaverGuestOfferCheckCollection}/${
        response.operationRef}`;
      const pending = await database.getDocument(checkPath);
      assert.equal(pending.data.state, "awaitingAnswer");
      assert.equal(millis(pending.data.evaluationAt), fixedNowMs);
      assert.equal(pending.data.activeBatch.issuedAtMillis, clock.value);
      assert.ok(pending.data.activeBatch.candidates.length > 0);
      assert.ok(pending.data.activeBatch.candidates.length <=
        customerBiteSaverGuestCheckMaximumCandidateIds);
      maximumCheckpointBytes = Math.max(
        maximumCheckpointBytes,
        jsonBytes(pending.data),
      );

      if (!refreshProved && challengeCount === 3) {
        const expiredChallenge = response;
        const staleAnswer = guestAnswerRequest(
          bundle,
          expiredChallenge,
          expiredChallenge.candidates.map(({offerId}) => offerId),
        );
        const boundaryBefore = pending.data.progress.scanBoundary;
        const pendingBoundaryBefore =
          pending.data.activeBatch.nextOfferBoundary;
        clock.value = pending.data.activeBatch.expiresAtMillis;
        response = await getCustomerBiteSaverOfferPageHandler(
          initialRequest,
          bundle.context,
        );
        assert.equal(response.outcome, "guestCheckRequired");
        assert.equal(response.operationRef, expiredChallenge.operationRef);
        assert.notEqual(response.checkToken, expiredChallenge.checkToken);
        assert.equal(response.batchSequence, expiredChallenge.batchSequence + 1);
        assert.equal(
          response.evaluationContext.evaluationAtMillis,
          fixedNowMs,
        );
        assert.equal(
          response.logicalExpiresAtMillis,
          clock.value + 300_000,
        );
        assert.deepEqual(
          response.candidates.map(({offerId}) => offerId),
          expiredChallenge.candidates.map(({offerId}) => offerId),
        );
        const refreshed = await database.getDocument(checkPath);
        assert.equal(millis(refreshed.data.evaluationAt), fixedNowMs);
        assert.deepEqual(refreshed.data.progress.scanBoundary, boundaryBefore);
        assert.deepEqual(
          refreshed.data.activeBatch.nextOfferBoundary,
          pendingBoundaryBefore,
        );
        assert.equal(refreshed.data.activeBatch.issuedAtMillis, clock.value);
        assert.equal(
          refreshed.data.activeBatch.expiresAtMillis,
          clock.value + 300_000,
        );
        await assert.rejects(
          continueCustomerBiteSaverGuestOfferCheckHandler(
            staleAnswer,
            bundle.context,
          ),
          contractError("failed-precondition"),
        );
        refreshProved = true;
      }

      const challengedIds = response.candidates.map(({offerId}) => offerId);
      const answer = guestAnswerRequest(bundle, response, challengedIds);
      clock.value += 10_000;
      response = await continueCustomerBiteSaverGuestOfferCheckHandler(
        answer,
        bundle.context,
      );
      acceptedOfferIds.push(...challengedIds);
    }
    assert.equal(refreshProved, true);
    assert.ok(challengeCount > 30);
    assert.ok(clock.value - fixedNowMs > 5 * 60_000);
    assert.equal(acceptedOfferIds.length, unavailableCount);
    assert.equal(new Set(acceptedOfferIds).size, unavailableCount);
    assert.equal(response.operation, "offerPage");
    assert.equal(response.result.offers.length, 1);
    assert.equal(response.result.offers[0].available, true);
    assert.equal(
      response.evaluationContext.evaluationAtMillis,
      fixedNowMs,
    );
    assert.ok(maximumCheckpointBytes <= 768 * 1_024);
    metrics.scenarioMeasurements.guestMovingClock = {
      acceptedCandidates: acceptedOfferIds.length,
      challengeResponses: challengeCount,
      elapsedClockMilliseconds: clock.value - fixedNowMs,
      maximumCheckpointJsonBytes: maximumCheckpointBytes,
      workBudgetResumes,
    };
  });

  test("full guest state is written/read at pending, accepted, and completed bounds",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({guest: true, clock});
    const session = await markReady(bundle);
    const maximumAccountPrefix = `${runNamespace}_guest_`;
    const maximumAccountId = maximumAccountPrefix + "a".repeat(
      customerBiteSaverMaximumIndexedOrderKeyBytes -
        Buffer.byteLength(maximumAccountPrefix, "utf8"),
    );
    assert.equal(
      dartUtf16FirestoreBytesOrderKey(maximumAccountId).byteLength,
      customerBiteSaverMaximumIndexedOrderKeyBytes,
    );
    const maximumOfferId = (index) => {
      const suffix = index.toString(36).padStart(4, "0");
      const prefix = `${runNamespace}_guest_`;
      return `${prefix}${"\"".repeat(1_500 - prefix.length - suffix.length)}${suffix}`;
    };
    const parent = readyRestaurantWrites(session, 400, {
      accountId: maximumAccountId,
      offerCount: customerBiteSaverGuestCheckMaximumCandidateIds,
      onlyCoupons: true,
      offerIdForIndex: maximumOfferId,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(parent.writes);
    let response = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(bundle, parent.publicRestaurantId, {
        guestStateRevision: Number.MAX_SAFE_INTEGER,
      }),
      bundle.context,
    );
    assert.equal(response.outcome, "guestCheckRequired");
    const checkPath = `${privateCustomerBiteSaverGuestOfferCheckCollection}/${
      response.operationRef}`;
    const stateSizes = {pending: [], accepted: [], completed: []};
    const checked = [];
    hooks.afterTransactionCommit = async (value) => {
      if (value?.document?.role !== "guestOfferCheck" ||
          value.document.state !== "answerAccepted") return;
      const persisted = await realDatabase.getDocument(checkPath);
      assert.notEqual(persisted, null);
      assert.equal(persisted.data.state, "answerAccepted");
      stateSizes.accepted.push(jsonBytes(persisted.data));
    };
    try {
      while (response.outcome === "guestCheckRequired") {
        assert.ok(response.candidates.length > 0);
        assert.ok(response.candidates.length <=
          customerBiteSaverGuestCheckMaximumCandidateIds);
        checked.push(...response.candidates.map(({offerId}) => offerId));
        const pending = await database.getDocument(checkPath);
        assert.equal(pending.data.state, "awaitingAnswer");
        stateSizes.pending.push(jsonBytes(pending.data));
        response = await continueCustomerBiteSaverGuestOfferCheckHandler(
          guestAnswerRequest(
            bundle,
            response,
            response.candidates.map(({offerId}) => offerId),
          ),
          bundle.context,
        );
      }
    } finally {
      hooks.afterTransactionCommit = null;
    }
    assert.equal(response.outcome, "complete");
    assert.equal(response.result.offers.length, 0);
    assert.equal(checked.length, customerBiteSaverGuestCheckMaximumCandidateIds);
    assert.equal(new Set(checked).size, checked.length);
    const completed = await database.getDocument(checkPath);
    assert.equal(completed.data.state, "completed");
    stateSizes.completed.push(jsonBytes(completed.data));
    assert.ok(stateSizes.pending.some((bytes) => bytes > 96 * 1_024));
    assert.ok(stateSizes.accepted.some((bytes) => bytes > 96 * 1_024));
    assert.ok(Math.max(...stateSizes.pending, ...stateSizes.accepted,
      ...stateSizes.completed) <= 768 * 1_024);
    metrics.scenarioMeasurements.guestMaximumState = {
      pendingJsonBytes: Math.max(...stateSizes.pending),
      acceptedJsonBytes: Math.max(...stateSizes.accepted),
      completedJsonBytes: Math.max(...stateSizes.completed),
      checkedCandidates: checked.length,
    };
  });

  test("real guest answer contention commits one answer and records SDK attempts",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({guest: true, clock});
    const session = await markReady(bundle);
    const parent = readyRestaurantWrites(session, 500, {
      offerCount: 2,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    await commitAll(parent.writes);
    const challenge = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(bundle, parent.publicRestaurantId, {
        guestStateRevision: 51,
      }),
      bundle.context,
    );
    assert.equal(challenge.outcome, "guestCheckRequired");
    const answers = [
      guestAnswerRequest(bundle, challenge, [], {
        clientRequestId: requestId("answer-a"),
      }),
      guestAnswerRequest(bundle, challenge, [challenge.candidates[0].offerId], {
        clientRequestId: requestId("answer-b"),
      }),
    ];
    const attemptsBefore = metrics.transactionAttempts;
    const invocationsBefore = metrics.transactionInvocations;
    const settled = await bounded(Promise.allSettled(answers.map((answer) =>
      continueCustomerBiteSaverGuestOfferCheckHandler(answer, bundle.context))),
    "concurrent guest answers");
    const fulfilled = settled.filter(({status}) => status === "fulfilled");
    const rejected = settled.filter(({status}) => status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(contractError("failed-precondition")(rejected[0].reason) ||
      contractError("resource-exhausted")(rejected[0].reason));
    const check = await database.getDocument(
      `${privateCustomerBiteSaverGuestOfferCheckCollection}/${challenge.operationRef}`,
    );
    assert.equal(check.data.state, "completed");
    metrics.scenarioMeasurements.guestAnswerContention = {
      transactionInvocations:
        metrics.transactionInvocations - invocationsBefore,
      transactionAttempts: metrics.transactionAttempts - attemptsBefore,
    };
  });

  test("worker lease contention, expiry takeover, stale rejection, and terminal redelivery are real",
    {timeout: 120_000}, async () => {
    const clock = {value: fixedNowMs};
    const contention = await startSession({guest: true, clock});
    let session = await currentSession(contention);
    const jobId = session.data.currentJobId;
    const workerContext = () => ({
      database,
      discoveryKey,
      identityKeyV1,
      now: () => clock.value,
      randomSource: (size) => randomBytes(size),
      counters: createCustomerBiteSaverWorkerCounters(),
    });
    const settled = await bounded(Promise.allSettled([
      processCustomerBiteSaverSearchJob(jobId, workerContext()),
      processCustomerBiteSaverSearchJob(jobId, workerContext()),
    ]), "worker lease contention");
    assert.equal(settled.filter(({status, value}) =>
      status === "fulfilled" && value === true).length, 1);
    assert.equal(settled.filter(({status, value}) =>
      status === "fulfilled" && value === false).length +
      settled.filter(({status}) => status === "rejected").length, 1);
    assert.equal(await processCustomerBiteSaverSearchJob(jobId, workerContext()), false);

    const takeover = await startSession({guest: true, clock});
    session = await currentSession(takeover);
    const takeoverJobPath = `${privateCustomerBiteSaverJobCollection}/${
      session.data.currentJobId}`;
    const takeoverJob = await database.getDocument(takeoverJobPath);
    const expiredLease = `lease_${Buffer.alloc(16, 7).toString("base64url")}`;
    await commitAll([
      {
        type: "set",
        path: takeoverJobPath,
        data: {
          ...takeoverJob.data,
          state: "processing",
          leaseId: expiredLease,
          leaseExpiresAt: new Date(clock.value - 1),
          attemptCount: 1,
        },
      },
      {
        type: "set",
        path: session.path,
        data: {
          ...session.data,
          workerLeaseId: expiredLease,
          workerLeaseExpiresAt: new Date(clock.value - 1),
        },
      },
    ]);
    assert.equal(await processCustomerBiteSaverSearchJob(
      session.data.currentJobId,
      workerContext(),
    ), true);
    const reclaimed = await database.getDocument(takeoverJobPath);
    assert.equal(reclaimed.data.state, "completed");
    assert.equal(reclaimed.data.attemptCount, 2);

    const stale = await startSession({guest: true, clock});
    session = await currentSession(stale);
    const staleJobId = session.data.currentJobId;
    const staleJobPath = `${privateCustomerBiteSaverJobCollection}/${staleJobId}`;
    const queryEntered = deferred();
    const releaseQuery = deferred();
    let blocked = false;
    hooks.beforeQuery = async (query) => {
      if (!blocked && query.collectionPath === restaurantSearchIndexCollection) {
        blocked = true;
        queryEntered.resolve();
        await releaseQuery.promise;
      }
    };
    const staleWorker = processCustomerBiteSaverSearchJob(
      staleJobId,
      workerContext(),
    );
    const replacementLease = `lease_${Buffer.alloc(16, 8).toString("base64url")}`;
    try {
      await bounded(queryEntered.promise, "stale worker query barrier");
      const [claimedJob, claimedSession] = await database.getDocuments([
        staleJobPath,
        session.path,
      ]);
      await commitAll([
        {
          type: "set",
          path: staleJobPath,
          data: {...claimedJob.data, leaseId: replacementLease},
        },
        {
          type: "set",
          path: session.path,
          data: {...claimedSession.data, workerLeaseId: replacementLease},
        },
      ]);
      releaseQuery.resolve();
      assert.equal(await bounded(staleWorker, "stale worker completion"), false);
    } finally {
      releaseQuery.resolve();
      hooks.beforeQuery = null;
      await bounded(
        Promise.allSettled([staleWorker]),
        "stale worker teardown",
        5_000,
      ).catch(() => {});
    }
    const afterStale = await database.getDocument(staleJobPath);
    assert.equal(afterStale.data.leaseId, replacementLease);
  });

  test("logical expiry is enforced while emulator documents still physically exist",
    {timeout: 30_000}, async () => {
    const clock = {value: fixedNowMs};
    const bundle = await startSession({clock});
    const session = await markReady(bundle);
    const logicalExpiry = millis(session.logicalExpiresAt);
    clock.value = logicalExpiry;
    const expired = await getCustomerBiteSaverSearchStatusHandler(
      boundRequest(bundle),
      bundle.context,
    );
    assert.equal(expired.state, "expired");
    const physical = await realDatabase.getDocument(
      `${privateCustomerBiteSaverSearchSessionCollection}/${bundle.response.sessionId}`,
    );
    assert.notEqual(physical, null);
    assert.equal(physical.data.state, "expired");
  });
}
