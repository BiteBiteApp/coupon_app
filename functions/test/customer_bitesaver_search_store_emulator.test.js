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
  } = require("../lib/customer_bitesaver_search_cursor.js");
  const {
    customerBiteSaverCandidatePrefix,
    customerBiteSaverOrderedResultQuery,
    customerBiteSaverResultDocumentId,
    continueCustomerBiteSaverGuestOfferCheckHandler,
    getCustomerBiteSaverFavoriteStatesHandler,
    getCustomerBiteSaverOfferPageHandler,
    getCustomerBiteSaverSearchPageHandler,
    getCustomerBiteSaverSearchStatusHandler,
    startCustomerBiteSaverSearchHandler,
    validateCustomerBiteSaverOfferRedemptionStartHandler,
    customerBiteSaverSessionInternals,
  } = require("../lib/customer_bitesaver_search_session.js");
  const {
    createFirestoreCustomerBiteSaverSearchDatabase,
  } = require("../lib/customer_bitesaver_search_store.js");
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

  const fixedNowMs = Date.parse("2026-09-10T16:00:00.000Z");
  const secretKey = Buffer.alloc(32, 61);
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

  async function startSession({guest = false, clock, request = {}} = {}) {
    const clientInstanceId = requestId("client");
    const uid = guest ? null : requestId("uid");
    const context = {
      database,
      secretKey,
      identity: {authUid: uid, authIsAnonymous: false},
      now: () => clock.value,
      randomSource: (size) => randomBytes(size),
    };
    const response = await startCustomerBiteSaverSearchHandler(
      startRequest(clientInstanceId, request),
      context,
    );
    return {clientInstanceId, context, response, uid};
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
    });
    assert.notEqual(parentProjection, null);
    const publicRestaurantId = customerBiteSaverOpaqueRestaurantId(
      secretKey,
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
      secretKey,
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
      secretKey,
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
        secretKey,
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
          secretKey,
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
      secretKey,
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
    assert.equal(first.restaurants.length, customerBiteSaverPageSize);
    assert.equal(first.hasMore, true);
    assert.notEqual(first.nextCursor, null);
    assert.equal(first.restaurants.some(({restaurantId}) =>
      restaurantId === witness.publicRestaurantId), false);
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
    assert.deepEqual(
      second.restaurants.map(({restaurantId}) => restaurantId),
      [witness.publicRestaurantId],
    );
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);

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
    const authorized = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(bundle, {
        restaurantIds: [firstRestaurant.publicRestaurantId],
        offerIds: [firstPreparedOfferId],
      }),
      bundle.context,
    );
    assert.deepEqual(authorized.states.map(({state}) => state), ["favorite", "favorite"]);
    assert.ok(metrics.favoritePointReadRequests > favoriteDocumentReadsBefore);
    const restaurantEvidence = await documentsWithRole("deliveredRestaurantIdentity");
    const offerEvidence = await documentsWithRole("deliveredOfferIdentity");
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
      secretKey,
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
    const finalOfferId = customerBiteSaverOpaqueOfferId(
      secretKey,
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
    const originalDeadline = concurrent[0].validationExpiresAtMillis;
    assert.equal(originalDeadline, fixedNowMs + 60_000);

    clock.value = fixedNowMs + 59_999;
    const replay = await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: requestId("transport-before-expiry")},
      bundle.context,
    );
    assert.equal(replay.allowed, true);
    assert.equal(replay.evaluatedAtMillis, fixedNowMs);
    assert.equal(replay.validationExpiresAtMillis, originalDeadline);
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
        secretKey,
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
    assert.deepEqual(initial.evaluationContext, {
      evaluationAtMillis: originalEvaluationAt,
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      availabilityGeneration:
        initial.evaluationContext.availabilityGeneration,
    });
    assert.match(
      initial.evaluationContext.availabilityGeneration,
      /^[a-f0-9]{64}$/u,
    );
    assert.equal(initial.logicalExpiresAtMillis, refreshAt);

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
    assert.deepEqual(refreshed.evaluationContext, initial.evaluationContext);
    assert.equal(refreshed.logicalExpiresAtMillis, refreshAt + 300_000);

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
        secretKey,
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
    assert.deepEqual(initial.evaluationContext, {
      evaluationAtMillis: originalEvaluationAt,
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      availabilityGeneration:
        initial.evaluationContext.availabilityGeneration,
    });
    assert.match(
      initial.evaluationContext.availabilityGeneration,
      /^[a-f0-9]{64}$/u,
    );
    assert.equal(initial.logicalExpiresAtMillis, refreshAt);

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
    assert.deepEqual(refreshed.evaluationContext, initial.evaluationContext);
    assert.equal(refreshed.logicalExpiresAtMillis, refreshAt + 300_000);

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
        secretKey,
        expiring.accountId,
        "dailySpecial",
        expiring.daily[0].sourceDocumentId,
      );
      const checkedCouponOfferId = customerBiteSaverOpaqueOfferId(
        secretKey,
        expiring.accountId,
        "coupon",
        expiring.coupons[0].sourceDocumentId,
      );
      const witnessCouponOfferId = witness === null
        ? null
        : customerBiteSaverOpaqueOfferId(
            secretKey,
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
      assert.deepEqual(
        Object.keys(initial.evaluationContext).sort(),
        [
          "availabilityGeneration",
          "evaluationAtMillis",
          "timeZone",
          "utcOffsetMinutes",
        ],
      );
      assert.equal(
        initial.evaluationContext.evaluationAtMillis,
        deadlineCase.evaluationAtMs,
      );
      assert.equal(initial.evaluationContext.timeZone, "America/New_York");
      assert.equal(initial.evaluationContext.utcOffsetMinutes, -240);
      assert.match(
        initial.evaluationContext.availabilityGeneration,
        /^[a-f0-9]{64}$/u,
      );
      assert.equal(initial.logicalExpiresAtMillis, deadlineCase.cutoffAtMs);

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
      assert.equal(fresh.evaluationContext.utcOffsetMinutes, -240);
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
        secretKey,
        parent.accountId,
        "dailySpecial",
        parent.daily[0].sourceDocumentId,
      );
      const couponOfferId = customerBiteSaverOpaqueOfferId(
        secretKey,
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
      secretKey,
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
