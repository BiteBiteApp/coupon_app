"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  customerBiteSaverGuestCheckLifetimeMilliseconds,
  customerBiteSaverIdleExpiryMilliseconds,
  customerBiteSaverPageConsumeLimit,
  customerBiteSaverPageSize,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  privateCustomerBiteSaverResultCollection,
  privateCustomerBiteSaverSearchSessionCollection,
  requireCustomerBiteSaverCapability,
  requireCustomerBiteSaverPublicId,
  supportedCustomerBiteSaverRadii,
  parseCustomerBiteSaverStartRequest,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  parseCustomerBiteSaverGuestOfferCheckContinuationRequest,
} = require("../lib/customer_bitesaver_guest_offer_checks.js");
const {
  customerBiteSaverOpaqueOfferId,
  customerBiteSaverOpaqueRestaurantId,
} = require("../lib/customer_bitesaver_public_identity.js");
const {
  customerBiteSaverSessionInternals,
  customerBiteSaverResultDocumentId,
  continueCustomerBiteSaverGuestOfferCheckHandler,
  getCustomerBiteSaverFavoriteStatesHandler,
  getCustomerBiteSaverOfferPageHandler,
  getCustomerBiteSaverSearchPageHandler,
  getCustomerBiteSaverSearchStatusHandler,
  startCustomerBiteSaverOfferRedemptionHandler,
  startCustomerBiteSaverSearchHandler,
  validateCustomerBiteSaverOfferRedemptionStartHandler,
} = require("../lib/customer_bitesaver_search_session.js");
const {
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverRestaurantIndex,
} = require("../lib/search_index_builders.js");
const {
  biteSaverOfferIndexCollection,
  restaurantSearchIndexCollection,
} = require("../lib/search_index_contract.js");
const {
  dartUtf16FirestoreBytesOrderKey,
  lowercaseDisplayNameOrderKey,
} = require("../lib/customer_bitesaver_search_matcher.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");

const fixturePath = path.resolve(
  __dirname,
  "../../test/fixtures/customer_bitesaver_client_boundary_v1.json",
);
const baseNowMs = Date.parse("2026-09-12T15:00:00.000Z");
const discoveryKey = Buffer.alloc(32, 17);
const identityKeyV1 = Buffer.alloc(32, 23);

function compareValues(left, right) {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  if (leftValue instanceof Uint8Array && rightValue instanceof Uint8Array) {
    return Buffer.compare(Buffer.from(leftValue), Buffer.from(rightValue));
  }
  if (leftValue === rightValue) return 0;
  if (leftValue === null || leftValue === undefined) return -1;
  if (rightValue === null || rightValue === undefined) return 1;
  if (typeof leftValue === "string" && typeof rightValue === "string") {
    return Buffer.compare(
      Buffer.from(leftValue, "utf8"),
      Buffer.from(rightValue, "utf8"),
    );
  }
  return leftValue < rightValue ? -1 : 1;
}

function assertExactKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

const evaluationContextKeys = Object.freeze([
  "schemaVersion",
  "sessionId",
  "attemptGeneration",
  "queryFingerprint",
  "evaluationAtMillis",
  "timeZone",
  "utcOffsetMinutes",
  "availabilityGeneration",
  "validUntilExclusiveMillis",
  "oncePerDayUnavailableWindows",
]);

function assertEvaluationContext(value, started) {
  assertExactKeys(value, evaluationContextKeys);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.sessionId, started.sessionId);
  assert.equal(value.attemptGeneration, started.attemptGeneration);
  assert.equal(value.queryFingerprint, started.queryFingerprint);
  assert.equal(Number.isSafeInteger(value.evaluationAtMillis), true);
  assert.equal(typeof value.timeZone, "string");
  assert.equal(value.timeZone.length > 0, true);
  assert.equal(Number.isSafeInteger(value.utcOffsetMinutes), true);
  assert.equal(value.utcOffsetMinutes >= -840, true);
  assert.equal(value.utcOffsetMinutes <= 840, true);
  assert.match(value.availabilityGeneration, /^[0-9a-f]{64}$/u);
  assert.equal(
    value.validUntilExclusiveMillis > value.evaluationAtMillis,
    true,
  );
  assert.equal(
    value.oncePerDayUnavailableWindows.length >= 1 &&
      value.oncePerDayUnavailableWindows.length <= 2,
    true,
  );
  let previousEnd = null;
  let evaluationMemberships = 0;
  for (const window of value.oncePerDayUnavailableWindows) {
    assertExactKeys(window, [
      "startAtMillisInclusive",
      "endAtMillisExclusive",
    ]);
    assert.equal(
      window.startAtMillisInclusive < window.endAtMillisExclusive,
      true,
    );
    if (previousEnd !== null) {
      assert.equal(previousEnd < window.startAtMillisInclusive, true);
    }
    if (
      window.startAtMillisInclusive <= value.evaluationAtMillis &&
      value.evaluationAtMillis < window.endAtMillisExclusive
    ) {
      evaluationMemberships += 1;
    }
    previousEnd = window.endAtMillisExclusive;
  }
  assert.equal(evaluationMemberships, 1);
  assert.equal(previousEnd, value.evaluationAtMillis + 1);
}

function assertOfferUsagePolicies(offers) {
  const couponPolicies = new Set([
    "oncePerCustomer",
    "oncePerDay",
    "unlimited",
    "reusableAfterTimer",
  ]);
  for (const offer of offers) {
    if (offer.offerType === "coupon") {
      assert.equal(couponPolicies.has(offer.usagePolicy), true);
    } else {
      assert.equal(offer.offerType, "dailySpecial");
      assert.equal(offer.usagePolicy, null);
    }
  }
}

function countEvaluationContexts(value) {
  if (value === null || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    return value.reduce(
      (total, entry) => total + countEvaluationContexts(entry),
      0,
    );
  }
  return (Object.hasOwn(value, "evaluationContext") ? 1 : 0) +
    Object.values(value).reduce(
      (total, entry) => total + countEvaluationContexts(entry),
      0,
    );
}

class MemoryDatabase {
  constructor() {
    this.documents = new Map();
  }

  stored(documentPath) {
    const data = this.documents.get(documentPath);
    return data === undefined
      ? null
      : {
          id: documentPath.slice(documentPath.lastIndexOf("/") + 1),
          path: documentPath,
          data,
        };
  }

  async getDocument(documentPath) {
    return this.stored(documentPath);
  }

  async getDocuments(paths) {
    return paths.map((documentPath) => this.stored(documentPath));
  }

  async queryDocuments(query) {
    const prefix = `${query.collectionPath}/`;
    let documents = [...this.documents.keys()]
      .filter((documentPath) =>
        documentPath.startsWith(prefix) &&
        !documentPath.slice(prefix.length).includes("/"))
      .map((documentPath) => this.stored(documentPath));
    for (const filter of query.filters) {
      documents = documents.filter((document) => {
        const candidate = filter.field === "__name__"
          ? document.id
          : document.data[filter.field];
        const comparison = compareValues(candidate, filter.value);
        if (filter.operation === "==") return comparison === 0;
        if (filter.operation === ">=") return comparison >= 0;
        if (filter.operation === "<=") return comparison <= 0;
        if (filter.operation === ">") return comparison > 0;
        return comparison < 0;
      });
    }
    documents.sort((left, right) => {
      for (const order of query.orders) {
        const leftValue = order.field === "__name__"
          ? left.id
          : left.data[order.field];
        const rightValue = order.field === "__name__"
          ? right.id
          : right.data[order.field];
        const comparison = compareValues(leftValue, rightValue);
        if (comparison !== 0) {
          return order.direction === "desc" ? -comparison : comparison;
        }
      }
      return 0;
    });
    if (query.startAfter !== undefined) {
      documents = documents.filter((document) => {
        for (let index = 0; index < query.orders.length; index += 1) {
          const order = query.orders[index];
          const candidate = order.field === "__name__"
            ? document.id
            : document.data[order.field];
          const comparison = compareValues(
            candidate,
            query.startAfter[index],
          ) * (order.direction === "desc" ? -1 : 1);
          if (comparison !== 0) return comparison > 0;
        }
        return false;
      });
    }
    return documents.slice(0, query.limit);
  }

  applyWrites(writes) {
    for (const write of writes) {
      if (write.type === "create" && this.documents.has(write.path)) {
        throw new Error(`already exists: ${write.path}`);
      }
      if (write.type === "delete") {
        this.documents.delete(write.path);
      } else {
        this.documents.set(write.path, write.data);
      }
    }
  }

  async runTransaction(operation) {
    const writes = [];
    const transaction = {
      getDocument: async (documentPath) => this.stored(documentPath),
      getDocuments: async (paths) =>
        paths.map((documentPath) => this.stored(documentPath)),
      createDocument: (documentPath, data) =>
        writes.push({type: "create", path: documentPath, data}),
      setDocument: (documentPath, data) =>
        writes.push({type: "set", path: documentPath, data}),
      deleteDocument: (documentPath) =>
        writes.push({type: "delete", path: documentPath}),
    };
    const result = await operation(transaction);
    this.applyWrites(writes);
    return result;
  }

  async commitWrites(writes) {
    this.applyWrites(writes);
  }
}

function context(database, identity, now) {
  let entropy = 1;
  return {
    database,
    discoveryKey,
    identityKeyV1,
    identity,
    now,
    randomSource: (size) => Buffer.alloc(size, entropy++),
  };
}

function startRequest(clientRequestId) {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId,
    clientInstanceId: "fixture-client-instance-0001",
    latitude: 28.5383,
    longitude: -81.3792,
    radiusMiles: 10,
    locationMode: "current",
    typedLocation: null,
    searchText: "",
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    freshSearch: true,
  };
}

function boundRequest(started, clientRequestId) {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId,
    clientInstanceId: "fixture-client-instance-0001",
    sessionId: started.sessionId,
    capability: started.capability,
    criteriaFingerprint: started.criteriaFingerprint,
  };
}

function pageRequest(started, clientRequestId, guestStateRevision) {
  return {
    ...boundRequest(started, clientRequestId),
    cursor: null,
    guestStateRevision,
  };
}

function offerPageRequest(
  started,
  restaurantId,
  clientRequestId,
  guestStateRevision,
) {
  return {
    ...pageRequest(started, clientRequestId, guestStateRevision),
    restaurantId,
  };
}

function guestAnswerRequest(started, challenge, clientRequestId) {
  return {
    ...boundRequest(started, clientRequestId),
    operationRef: challenge.operationRef,
    checkToken: challenge.checkToken,
    batchSequence: challenge.batchSequence,
    guestStateRevision: challenge.guestStateRevision,
    entireBatchEvaluated: true,
    unavailableOfferIds: [],
  };
}

function markReady(database, started) {
  const sessionPath =
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  const session = database.documents.get(sessionPath);
  const ready = {
    ...session,
    state: "ready",
    phase: "ready",
    progress: {
      ...session.progress,
      completedRestaurantRanges: session.restaurantRanges.length,
      completedOfferRanges: session.offerRanges.length,
    },
  };
  database.documents.set(sessionPath, ready);
  return ready;
}

function rawRestaurant(nowMs = baseNowMs) {
  return {
    restaurantName: "Fixture Café 😀",
    approvalStatus: "approved",
    couponApplicationSubmitted: true,
    subscriptionStatus: "active",
    couponPostingEnabled: true,
    streetAddress: "1 Public Avenue",
    city: "Orlando",
    state: "FL",
    zipCode: "32801",
    latitude: 28.5383,
    longitude: -81.3792,
    geohash: canonicalRestaurantGeohash({
      latitude: 28.5383,
      longitude: -81.3792,
    }),
    phone: "+1 407-555-0100",
    website: "https://restaurant.example.test",
    bio: "Synthetic public fixture",
    mainImageUrl: "https://images.example.test/restaurant.jpg",
    businessHours: [],
    formattedAddress: "1 Public Avenue, Orlando, FL 32801",
    offerCatalogUpdatedAt: new Date(nowMs - 60_000),
  };
}

function rawCoupon(
  index,
  {nowMs = baseNowMs, usageRule = "Once per customer"} = {},
) {
  return {
    title: `Fixture Coupon ${index}`,
    restaurant: "Fixture Café",
    details: "Synthetic coupon details",
    usageRule,
    couponCode: `FIXTURE${index}`,
    couponNumber: index,
    isActive: true,
    active: true,
    isProximityOnly: false,
    createdAt: new Date(nowMs - index * 1_000),
    updatedAt: new Date(nowMs - index * 500),
  };
}

function previewCandidate(projection) {
  return {
    offerType: projection.offerType,
    sourceDocumentId: projection.sourceDocumentId,
    indexDocumentId: projection.indexDocumentId,
    sourceCreatedAtMs: projection.sourceCreatedAt.getTime(),
    sourceCreatedAtOrderKey: projection.sourceCreatedAtOrderKey,
    sourceFingerprint: projection.catalogGenerationContribution,
  };
}

function safeRestaurantSnapshot(projection) {
  return {
    displayName: projection.displayName,
    streetAddress: projection.streetAddress ?? null,
    city: projection.city ?? "",
    state: projection.state ?? "",
    zipCode: projection.zipCode ?? "",
    formattedAddress: projection.formattedAddress ?? null,
    primaryImageUrl: projection.primaryImageUrl ?? null,
    phone: projection.phone ?? null,
    website: projection.website ?? null,
    businessHours: projection.businessHours ?? [],
    bio: projection.bio ?? null,
    biteScoreCatalogRestaurantId:
      projection.biteScoreCatalogRestaurantId ?? null,
    biteSaverCatalogBindingId: projection.biteSaverCatalogBindingId ?? null,
  };
}

function seedReadyRestaurant(
  database,
  session,
  suffix,
  {nowMs = baseNowMs, usageRule = "Once per customer"} = {},
) {
  const accountId = `fixture-account-${suffix}`;
  const restaurant = rawRestaurant(nowMs);
  const restaurantProjection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: accountId,
    source: restaurant,
    now: new Date(nowMs),
  });
  assert.notEqual(restaurantProjection, null);
  const publicRestaurantId = customerBiteSaverOpaqueRestaurantId(
    identityKeyV1,
    accountId,
  );
  const coupons = [];
  for (let index = 1; index <= 2; index += 1) {
    const sourceDocumentId = `fixture-coupon-${suffix}-${index}`;
    const raw = rawCoupon(index, {nowMs, usageRule});
    const projection = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: accountId,
      sourceDocumentId,
      offer: raw,
      restaurant,
      now: new Date(nowMs),
    });
    assert.notEqual(projection, null);
    coupons.push(previewCandidate(projection));
    database.documents.set(
      `restaurant_accounts/${accountId}/coupons/${sourceDocumentId}`,
      raw,
    );
    database.documents.set(
      `${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,
      projection,
    );
  }
  database.documents.set(`restaurant_accounts/${accountId}`, restaurant);
  database.documents.set(
    `${restaurantSearchIndexCollection}/${restaurantProjection.indexDocumentId}`,
    restaurantProjection,
  );
  const result = {
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
      restaurantProjection.displayName,
    ),
    authoritativeAccountIdOrderKey: dartUtf16FirestoreBytesOrderKey(accountId),
    authoritativeAccountId: accountId,
    publicRestaurantId,
    parentProjectionDocumentId: restaurantProjection.indexDocumentId,
    parentProjectionFingerprint: restaurantProjection.sourceFingerprint,
    parentOfferCatalogFingerprint:
      customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint(
        restaurant,
      ),
    offerCatalogFingerprint: "f".repeat(64),
    parentMatches: true,
    offerMatches: false,
    previewDailyCandidates: [],
    previewCouponCandidates: coupons,
    usableOfferCountAtPreparation: coupons.length,
    safeRestaurantSnapshot: safeRestaurantSnapshot(restaurantProjection),
    createdAt: new Date(nowMs),
    logicalExpiresAt: session.logicalExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    expiresAt: session.absoluteExpiresAt,
  };
  const resultId = customerBiteSaverResultDocumentId(
    discoveryKey,
    session.sessionId,
    session.attemptGeneration,
    publicRestaurantId,
  );
  database.documents.set(
    `${privateCustomerBiteSaverResultCollection}/${resultId}`,
    result,
  );
  return {
    accountId,
    publicRestaurantId,
    publicOfferIds: coupons.map((candidate) =>
      customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        accountId,
        candidate.offerType,
        candidate.sourceDocumentId,
      )),
  };
}

async function buildSignedFixture() {
  const database = new MemoryDatabase();
  let nowMs = baseNowMs;
  const handlerContext = context(
    database,
    {authUid: "fixture-signed-customer", authIsAnonymous: false},
    () => nowMs,
  );
  const requestStart = startRequest("fixture-start-request-0001");
  const responseStart = await startCustomerBiteSaverSearchHandler(
    requestStart,
    handlerContext,
  );
  const requestStatus = boundRequest(
    responseStart,
    "fixture-status-preparing-0001",
  );
  const statusPreparing = await getCustomerBiteSaverSearchStatusHandler(
    requestStatus,
    handlerContext,
  );

  const sessionPath =
    `${privateCustomerBiteSaverSearchSessionCollection}/${responseStart.sessionId}`;
  const preparingSession = database.documents.get(sessionPath);
  database.documents.set(sessionPath, {
    ...preparingSession,
    state: "failed",
    failureCode: "preparation_failed",
  });
  const statusFailed = await getCustomerBiteSaverSearchStatusHandler(
    boundRequest(responseStart, "fixture-status-failed-0001"),
    handlerContext,
  );
  const failedSession = database.documents.get(sessionPath);
  database.documents.set(sessionPath, preparingSession);

  const readySession = markReady(database, responseStart);
  const statusReady = await getCustomerBiteSaverSearchStatusHandler(
    boundRequest(responseStart, "fixture-status-ready-0001"),
    handlerContext,
  );
  const seeded = seedReadyRestaurant(database, readySession, "signed");
  const requestRestaurantPage = pageRequest(
    responseStart,
    "fixture-restaurant-page-0001",
    null,
  );
  const restaurantPage = await getCustomerBiteSaverSearchPageHandler(
    requestRestaurantPage,
    handlerContext,
  );
  const requestOfferPage = offerPageRequest(
    responseStart,
    seeded.publicRestaurantId,
    "fixture-offer-page-0001",
    null,
  );
  const offerPage = await getCustomerBiteSaverOfferPageHandler(
    requestOfferPage,
    handlerContext,
  );
  const requestFavoriteStates = {
    ...boundRequest(responseStart, "fixture-favorites-request-0001"),
    restaurantIds: [seeded.publicRestaurantId],
    offerIds: [offerPage.offers[0].offerId],
  };
  const favoriteStates = await getCustomerBiteSaverFavoriteStatesHandler(
    requestFavoriteStates,
    handlerContext,
  );
  const requestValidation = {
    ...boundRequest(responseStart, "fixture-validation-request-0001"),
    restaurantId: seeded.publicRestaurantId,
    offerId: offerPage.offers[0].offerId,
    offerOccurrence: offerPage.offers[0].offerOccurrence,
    redemptionRequestId: "fixture-redemption-operation-0001",
    currentCoordinates: null,
    guestStateRevision: null,
  };
  const validation = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    requestValidation,
    handlerContext,
  );
  assert.equal(validation.allowed, true);
  const requestRedemptionStart = {
    ...requestValidation,
    clientRequestId: "fixture-redemption-start-0001",
    validationId: validation.validationId,
  };
  const redemptionStart = await startCustomerBiteSaverOfferRedemptionHandler(
    requestRedemptionStart,
    handlerContext,
  );

  nowMs += customerBiteSaverIdleExpiryMilliseconds + 1;
  const statusExpired = await getCustomerBiteSaverSearchStatusHandler(
    boundRequest(responseStart, "fixture-status-expired-0001"),
    handlerContext,
  );
  database.documents.set(sessionPath, failedSession);
  const statusExpiredAfterFailure =
    await getCustomerBiteSaverSearchStatusHandler(
      boundRequest(responseStart, "fixture-status-expired-failed-0001"),
      handlerContext,
    );

  return {
    requests: {
      start: requestStart,
      status: requestStatus,
      restaurantPage: requestRestaurantPage,
      offerPage: requestOfferPage,
      favoriteStates: requestFavoriteStates,
      redemptionValidation: requestValidation,
      redemptionStart: requestRedemptionStart,
    },
    responses: {
      start: responseStart,
      status: {
        preparing: statusPreparing,
        ready: statusReady,
        failed: statusFailed,
        expired: statusExpired,
        expiredAfterFailure: statusExpiredAfterFailure,
      },
      restaurantPage,
      offerPage,
      favoriteStates,
      redemptionValidation: validation,
      redemptionStart,
    },
  };
}

async function buildDailyUsageParityFixture() {
  const evaluationAtMillis = Date.parse("2026-03-08T07:30:00.000Z");
  const completionAtMillis = Date.parse("2026-03-08T04:30:00.000Z");
  const database = new MemoryDatabase();
  const handlerContext = context(
    database,
    {authUid: "fixture-daily-customer", authIsAnonymous: false},
    () => evaluationAtMillis,
  );
  const started = await startCustomerBiteSaverSearchHandler(
    {
      ...startRequest("fixture-daily-start-0001"),
      utcOffsetMinutes: -240,
    },
    handlerContext,
  );
  const ready = markReady(database, started);
  seedReadyRestaurant(database, ready, "daily", {
    nowMs: evaluationAtMillis,
    usageRule: "Once per day",
  });
  const response = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, "fixture-daily-page-0001", null),
    handlerContext,
  );
  assert.equal(response.evaluationContext.evaluationAtMillis,
    evaluationAtMillis);
  assert.equal(response.evaluationContext.utcOffsetMinutes, -240);
  assert.equal(response.restaurants.length, 1);
  assert.equal(response.restaurants[0].offers.length, 2);
  assert.equal(response.restaurants[0].offers.every(({usagePolicy}) =>
    usagePolicy === "oncePerDay"), true);
  assert.equal(response.evaluationContext.oncePerDayUnavailableWindows.some(
    (window) => window.startAtMillisInclusive <= completionAtMillis &&
      completionAtMillis < window.endAtMillisExclusive,
  ), false);
  return Object.freeze({completionAtMillis, response});
}

async function buildGuestFixture() {
  const database = new MemoryDatabase();
  let nowMs = baseNowMs;
  const handlerContext = context(
    database,
    {authUid: null, authIsAnonymous: false},
    () => nowMs,
  );
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest("fixture-guest-start-0001"),
    handlerContext,
  );
  const readySession = markReady(database, started);
  const seeded = seedReadyRestaurant(database, readySession, "guest");

  const restaurantRequest = pageRequest(
    started,
    "fixture-guest-restaurant-0001",
    3,
  );
  const restaurantChallenge = await getCustomerBiteSaverSearchPageHandler(
    restaurantRequest,
    handlerContext,
  );
  assert.equal(restaurantChallenge.outcome, "guestCheckRequired");
  const restaurantAnswer = guestAnswerRequest(
    started,
    restaurantChallenge,
    "fixture-guest-answer-restaurant-0001",
  );
  const restaurantComplete =
    await continueCustomerBiteSaverGuestOfferCheckHandler(
      restaurantAnswer,
      handlerContext,
    );

  const offerRequest = offerPageRequest(
    started,
    seeded.publicRestaurantId,
    "fixture-guest-offer-page-0001",
    3,
  );
  const offerChallenge = await getCustomerBiteSaverOfferPageHandler(
    offerRequest,
    handlerContext,
  );
  assert.equal(offerChallenge.outcome, "guestCheckRequired");
  const offerAnswer = guestAnswerRequest(
    started,
    offerChallenge,
    "fixture-guest-answer-offer-0001",
  );
  const offerComplete = await continueCustomerBiteSaverGuestOfferCheckHandler(
    offerAnswer,
    handlerContext,
  );

  const offer = offerComplete.result.offers[0];
  const validationRequest = {
    ...boundRequest(started, "fixture-guest-validation-0001"),
    restaurantId: seeded.publicRestaurantId,
    offerId: offer.offerId,
    offerOccurrence: offer.offerOccurrence,
    redemptionRequestId: "fixture-guest-redemption-0001",
    currentCoordinates: null,
    guestStateRevision: 3,
  };
  const validationChallenge =
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      validationRequest,
      handlerContext,
    );
  assert.equal(validationChallenge.outcome, "guestCheckRequired");
  const validationAnswer = guestAnswerRequest(
    started,
    validationChallenge,
    "fixture-guest-answer-validation-0001",
  );
  const validationComplete =
    await continueCustomerBiteSaverGuestOfferCheckHandler(
      validationAnswer,
      handlerContext,
    );

  const retryDatabase = new MemoryDatabase();
  let retryNowMs = baseNowMs;
  const retryContext = context(
    retryDatabase,
    {authUid: null, authIsAnonymous: true},
    () => retryNowMs,
  );
  const retryStarted = await startCustomerBiteSaverSearchHandler(
    startRequest("fixture-retry-start-0001"),
    retryContext,
  );
  const retryReady = markReady(retryDatabase, retryStarted);
  seedReadyRestaurant(retryDatabase, retryReady, "retry");
  const expiringChallenge = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(retryStarted, "fixture-retry-page-0001", 7),
    retryContext,
  );
  const expiringAnswer = guestAnswerRequest(
    retryStarted,
    expiringChallenge,
    "fixture-retry-answer-0001",
  );
  retryNowMs += customerBiteSaverGuestCheckLifetimeMilliseconds + 1;
  const retryRequired =
    await continueCustomerBiteSaverGuestOfferCheckHandler(
      expiringAnswer,
      retryContext,
    );

  return {
    requests: {
      restaurantPage: restaurantRequest,
      restaurantContinuation: restaurantAnswer,
      offerPage: offerRequest,
      offerContinuation: offerAnswer,
      redemptionValidation: validationRequest,
      validationContinuation: validationAnswer,
    },
    responses: {
      restaurantChallenge,
      restaurantComplete,
      offerChallenge,
      offerComplete,
      validationChallenge,
      validationComplete,
      retryRequired,
    },
  };
}

async function buildFixture() {
  const signed = await buildSignedFixture();
  const guest = await buildGuestFixture();
  const dailyUsageParity = await buildDailyUsageParityFixture();
  return {
    fixtureVersion: "bitestar.customer-bitesaver-client-boundary.v1",
    contract: {
      protocolVersion: customerBiteSaverSearchProtocolVersion,
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      region: "us-central1",
      pageSize: customerBiteSaverPageSize,
      pageConsumeLimit: customerBiteSaverPageConsumeLimit,
      guestCandidateLimit: 75,
      supportedRadiiMiles: [...supportedCustomerBiteSaverRadii],
    },
    signed,
    guest,
    dailyUsageParity,
  };
}

let generatedFixture;
function generated() {
  generatedFixture ??= buildFixture();
  return generatedFixture;
}

test("fixture is generated byte-for-value by current production handlers", async () => {
  const current = await generated();
  if (process.env.UPDATE_BITESAVER_CLIENT_BOUNDARY_FIXTURE === "1") {
    fs.writeFileSync(fixturePath, `${JSON.stringify(current, null, 2)}\n`);
  }
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  assert.deepEqual(fixture, current);
});

test("fixture requests remain accepted by exported closed parsers", async () => {
  const fixture = await generated();
  assert.deepEqual(
    parseCustomerBiteSaverStartRequest(fixture.signed.requests.start),
    fixture.signed.requests.start,
  );
  for (const request of [
    fixture.guest.requests.restaurantContinuation,
    fixture.guest.requests.offerContinuation,
    fixture.guest.requests.validationContinuation,
  ]) {
    assert.deepEqual(
      parseCustomerBiteSaverGuestOfferCheckContinuationRequest(request),
      request,
    );
  }
  assert.equal(
    requireCustomerBiteSaverCapability(
      fixture.signed.responses.start.capability,
    ),
    fixture.signed.responses.start.capability,
  );
  for (const restaurant of
    fixture.signed.responses.restaurantPage.restaurants) {
    requireCustomerBiteSaverPublicId(restaurant.restaurantId, "bsr");
    for (const offer of restaurant.offers) {
      requireCustomerBiteSaverPublicId(offer.offerId, "bso");
    }
  }
});

test("fixture exposes one bound evaluation context and current policy per result", async () => {
  const fixture = await generated();
  const started = fixture.signed.responses.start;
  const signedRestaurantPage = fixture.signed.responses.restaurantPage;
  const signedOfferPage = fixture.signed.responses.offerPage;
  const signedValidation = fixture.signed.responses.redemptionValidation;

  for (const response of [
    signedRestaurantPage,
    signedOfferPage,
    signedValidation,
  ]) {
    assert.equal(countEvaluationContexts(response), 1);
    assertEvaluationContext(response.evaluationContext, started);
  }
  assertOfferUsagePolicies(
    signedRestaurantPage.restaurants.flatMap(({offers}) => offers),
  );
  assertOfferUsagePolicies(signedOfferPage.offers);
  assert.equal(signedValidation.usagePolicy, "oncePerCustomer");

  const guestBinding =
    fixture.guest.responses.restaurantChallenge.evaluationContext;
  for (const challenge of [
    fixture.guest.responses.restaurantChallenge,
    fixture.guest.responses.offerChallenge,
    fixture.guest.responses.validationChallenge,
  ]) {
    assert.equal(challenge.outcome, "guestCheckRequired");
    assert.equal(countEvaluationContexts(challenge), 1);
    assertEvaluationContext(challenge.evaluationContext, guestBinding);
    assert.equal(
      challenge.evaluationContext.validUntilExclusiveMillis,
      challenge.logicalExpiresAtMillis,
    );
    assert.equal(challenge.candidates.every(({usagePolicy}) =>
      usagePolicy === "oncePerCustomer" || usagePolicy === "oncePerDay"), true);
  }
  for (const complete of [
    fixture.guest.responses.restaurantComplete,
    fixture.guest.responses.offerComplete,
    fixture.guest.responses.validationComplete,
  ]) {
    assert.equal(complete.outcome, "complete");
    assert.equal(countEvaluationContexts(complete), 1);
    assert.equal(Object.hasOwn(complete.result, "evaluationContext"), false);
    assertEvaluationContext(complete.evaluationContext, guestBinding);
  }
  assertOfferUsagePolicies(
    fixture.guest.responses.restaurantComplete.result.restaurants.flatMap(
      ({offers}) => offers,
    ),
  );
  assertOfferUsagePolicies(fixture.guest.responses.offerComplete.result.offers);
  assert.equal(
    fixture.guest.responses.validationComplete.result.usagePolicy,
    "oncePerCustomer",
  );

  const serialized = JSON.stringify(fixture);
  for (const privateCanary of [
    "fixture-account-",
    "fixture-coupon-",
    "authoritativeAccountId",
    "sourceDocumentId",
    privateCustomerBiteSaverResultCollection,
    privateCustomerBiteSaverSearchSessionCollection,
  ]) {
    assert.equal(serialized.includes(privateCanary), false);
  }
});

test("fixture carries the production New York daily-use boundary to Dart", async () => {
  const fixture = await generated();
  const daily = fixture.dailyUsageParity;
  const response = daily.response;
  const context = response.evaluationContext;
  assert.equal(countEvaluationContexts(response), 1);
  assertEvaluationContext(context, context);
  assert.equal(
    context.evaluationAtMillis,
    Date.parse("2026-03-08T07:30:00.000Z"),
  );
  assert.equal(daily.completionAtMillis,
    Date.parse("2026-03-08T04:30:00.000Z"));
  assert.equal(context.timeZone, "America/New_York");
  assert.equal(context.utcOffsetMinutes, -240);
  assert.deepEqual(context.oncePerDayUnavailableWindows, [{
    startAtMillisInclusive: Date.parse("2026-03-08T05:00:00.000Z"),
    endAtMillisExclusive: context.evaluationAtMillis + 1,
  }]);
  assert.equal(context.oncePerDayUnavailableWindows.some((window) =>
    window.startAtMillisInclusive <= daily.completionAtMillis &&
      daily.completionAtMillis < window.endAtMillisExclusive), false);
  assertOfferUsagePolicies(response.restaurants.flatMap(({offers}) => offers));
  assert.equal(response.restaurants.every(({offers}) =>
    offers.every(({usagePolicy}) => usagePolicy === "oncePerDay")), true);
});
