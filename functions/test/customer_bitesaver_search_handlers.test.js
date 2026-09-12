"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {Timestamp} = require("firebase-admin/firestore");

const {
  CustomerBiteSaverContractError,
  createCustomerBiteSaverCriteriaFingerprint,
  createCustomerBiteSaverMembershipFingerprint,
  customerBiteSaverGuestCheckMaximumCandidateIds,
  customerBiteSaverGuestCheckLifetimeMilliseconds,
  customerBiteSaverCursorLifetimeMilliseconds,
  customerBiteSaverIdleExpiryMilliseconds,
  customerBiteSaverPageSize,
  customerBiteSaverPreviewCandidateRetentionLimit,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  privateCustomerBiteSaverActiveSessionCollection,
  privateCustomerBiteSaverGuestOfferCheckCollection,
  privateCustomerBiteSaverJobCollection,
  privateCustomerBiteSaverResultCollection,
  privateCustomerBiteSaverSearchSessionCollection,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  customerBiteSaverCallerCapabilityBinding,
  CustomerBiteSaverCursorCodec,
  CustomerBiteSaverOfferOccurrenceCodec,
  customerBiteSaverOpaqueOfferId,
  customerBiteSaverOpaqueRestaurantId,
} = require("../lib/customer_bitesaver_search_cursor.js");
const {
  CustomerBiteSaverGuestOfferCheckCodec,
  customerBiteSaverGuestOfferCheckTokenMaximumBytes,
} = require("../lib/customer_bitesaver_guest_offer_checks.js");
const {createQueryFingerprint} = require("../lib/query_fingerprint.js");
const {
  dartUtf16FirestoreBytesCursorValue,
  dartUtf16FirestoreBytesOrderKey,
  lowercaseDisplayNameOrderKey,
} = require("../lib/customer_bitesaver_search_matcher.js");
const {
  customerBiteSaverRequestGateLeaseMilliseconds,
  customerBiteSaverSessionInternals,
  customerBiteSaverOrderedResultQuery,
  customerBiteSaverPerParentOfferQuery,
  customerBiteSaverResultDocumentId,
  continueCustomerBiteSaverGuestOfferCheckHandler,
  getCustomerBiteSaverOfferPageHandler,
  getCustomerBiteSaverFavoriteStatesHandler,
  getCustomerBiteSaverSearchPageHandler,
  getCustomerBiteSaverSearchStatusHandler,
  startCustomerBiteSaverSearchHandler,
  validateCustomerBiteSaverOfferRedemptionStartHandler,
} = require("../lib/customer_bitesaver_search_session.js");
const {
  customerBiteSaverFreshLocationMaximumAgeMilliseconds,
} = require("../lib/customer_bitesaver_offer_availability.js");
const {
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverDailySpecialOfferIndex,
  buildBiteSaverRestaurantIndex,
  customerBiteSaverTimestampOrderKey,
} = require("../lib/search_index_builders.js");
const {
  biteSaverOfferIndexCollection,
  restaurantSearchIndexCollection,
} = require("../lib/search_index_contract.js");
const {
  canonicalRestaurantGeohash,
  exactCustomerBiteSaverDistanceMiles,
} = require("../lib/restaurant_geo_helpers.js");

const nowMs = Date.parse("2026-09-09T12:00:00.000Z");
const secretKey = Buffer.alloc(32, 17);
const defaultSignedUid = "handler-test-customer";

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

class InMemoryCustomerBiteSaverSearchDatabase {
  constructor(entries = []) {
    this.documents = new Map(entries.map(([path, data]) => [path, data]));
    this.calls = {
      getDocument: [],
      getDocuments: [],
      queryDocuments: [],
      transactions: 0,
      transactionWrites: [],
      commits: [],
    };
    this.failGetDocuments = false;
    this.failGetDocumentsWhen = null;
    this.failTransactionWritesWhen = null;
    this.transactionWriteFailure = null;
    this.onTransactionGetDocument = null;
  }

  stored(path) {
    const data = this.documents.get(path);
    if (data === undefined) return null;
    return Object.freeze({
      id: path.slice(path.lastIndexOf("/") + 1),
      path,
      data,
    });
  }

  async getDocument(path) {
    this.calls.getDocument.push(path);
    return this.stored(path);
  }

  async getDocuments(paths) {
    this.calls.getDocuments.push([...paths]);
    if (
      this.failGetDocuments ||
      this.failGetDocumentsWhen?.(paths) === true
    ) throw new Error("private read canary");
    return paths.map((path) => this.stored(path));
  }

  async queryDocuments(query) {
    this.calls.queryDocuments.push(query);
    const prefix = `${query.collectionPath}/`;
    let documents = [...this.documents.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => this.stored(path));
    for (const filter of query.filters) {
      documents = documents.filter((document) => {
        const value = filter.field === "__name__"
          ? document.id
          : document.data[filter.field];
        const comparison = compareValues(value, filter.value);
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
          const value = order.field === "__name__"
            ? document.id
            : document.data[order.field];
          const comparison = compareValues(value, query.startAfter[index]) *
            (order.direction === "desc" ? -1 : 1);
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
    this.calls.transactions += 1;
    const writes = [];
    const transaction = {
      getDocument: async (path) => {
        this.calls.getDocument.push(path);
        const stored = this.stored(path);
        this.onTransactionGetDocument?.(path, stored);
        return stored;
      },
      getDocuments: async (paths) => {
        this.calls.getDocuments.push([...paths]);
        if (
          this.failGetDocuments ||
          this.failGetDocumentsWhen?.(paths) === true
        ) throw new Error("private read canary");
        return paths.map((path) => this.stored(path));
      },
      createDocument: (path, data) => writes.push({type: "create", path, data}),
      setDocument: (path, data) => writes.push({type: "set", path, data}),
      deleteDocument: (path) => writes.push({type: "delete", path}),
    };
    const result = await operation(transaction);
    if (this.failTransactionWritesWhen?.(writes) === true) {
      throw this.transactionWriteFailure ?? new Error("transaction write canary");
    }
    this.applyWrites(writes);
    this.calls.transactionWrites.push(writes);
    return result;
  }

  async commitWrites(writes) {
    this.calls.commits.push([...writes]);
    this.applyWrites(writes);
  }
}

class SerializedTransactionCustomerBiteSaverSearchDatabase extends
  InMemoryCustomerBiteSaverSearchDatabase {
  constructor(entries = []) {
    super(entries);
    this.transactionTail = Promise.resolve();
  }

  async runTransaction(operation) {
    const previous = this.transactionTail;
    let release;
    this.transactionTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await super.runTransaction(operation);
    } finally {
      release();
    }
  }
}

function createContext(database, overrides = {}) {
  let entropy = 1;
  return {
    database,
    secretKey,
    identity: {authUid: defaultSignedUid, authIsAnonymous: false},
    now: () => nowMs,
    randomSource: (size) => Buffer.alloc(size, entropy++),
    ...overrides,
  };
}

function startRequest(overrides = {}) {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: "start-request-0001",
    clientInstanceId: "client-instance-0001",
    latitude: 28.5383,
    longitude: -81.3792,
    radiusMiles: 10,
    locationMode: "current",
    typedLocation: null,
    searchText: "privacy-query-canary",
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    freshSearch: true,
    ...overrides,
  };
}

function boundRequest(started, overrides = {}) {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: "status-request-0001",
    clientInstanceId: "client-instance-0001",
    sessionId: started.sessionId,
    capability: started.capability,
    criteriaFingerprint: started.criteriaFingerprint,
    ...overrides,
  };
}

function assertContractError(error, code) {
  return error instanceof CustomerBiteSaverContractError && error.code === code;
}

function assertExactKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

const publicOfferKeys = Object.freeze([
  "offerId",
  "offerOccurrence",
  "offerType",
  "title",
  "details",
  "couponCode",
  "couponNumber",
  "usageRule",
  "availabilityMode",
  "daysOfWeek",
  "allDay",
  "startTime",
  "endTime",
  "startAtMillis",
  "endAtMillis",
  "expiresAtMillis",
  "expiresText",
  "isProximityOnly",
  "proximityRadiusMiles",
  "imageUrl",
  "sourceCreatedAtMillis",
  "available",
  "availabilityReason",
  "redemptionPolicyLabel",
  "activeTimerExpiresAtMillis",
  "nextAvailableAtMillis",
  "usageState",
]);

function assertNoPrivateCanaries(value) {
  const serialized = JSON.stringify(value);
  for (const canary of [
    "internal-account-canary",
    "source-offer-canary",
    "owner-uid-canary",
    "admin-private-canary",
    "private read canary",
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
}

function databaseCallCounts(database) {
  return {
    getDocument: database.calls.getDocument.length,
    getDocuments: database.calls.getDocuments.length,
    queryDocuments: database.calls.queryDocuments.length,
    transactions: database.calls.transactions,
    transactionWrites: database.calls.transactionWrites.length,
    commits: database.calls.commits.length,
  };
}

function rawRestaurant(index, overrides = {}) {
  const suffix = String(index).padStart(4, "0");
  return {
    restaurantName: `Restaurant ${suffix}`,
    approvalStatus: "approved",
    couponApplicationSubmitted: true,
    subscriptionStatus: "active",
    couponPostingEnabled: true,
    streetAddress: `${index} Public Avenue`,
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
    bio: "Safe public bio",
    mainImageUrl: "https://images.example.test/restaurant.jpg",
    businessHours: [],
    formattedAddress: `${index} Public Avenue, Orlando, FL 32801`,
    offerCatalogUpdatedAt: new Date("2026-09-09T11:00:00.000Z"),
    ownerUid: "owner-uid-canary",
    adminNotes: "admin-private-canary",
    ...overrides,
  };
}

function rawCoupon(index, overrides = {}) {
  return {
    title: `Coupon ${String(index).padStart(4, "0")}`,
    restaurant: "Restaurant Alias",
    details: "Safe coupon details",
    usageRule: "Unlimited",
    couponCode: `SAVE${index}`,
    couponNumber: index,
    isActive: true,
    active: true,
    isProximityOnly: false,
    createdAt: new Date(nowMs - index * 1_000),
    updatedAt: new Date(nowMs - index * 500),
    internalCost: "source-offer-canary",
    ...overrides,
  };
}

function rawDailySpecial(accountId, index, overrides = {}) {
  return {
    restaurantId: accountId,
    ownerUid: accountId,
    title: `Daily ${String(index).padStart(4, "0")}`,
    details: "Safe daily details",
    isActive: true,
    availabilityMode: "specificDays",
    daysOfWeek: [3],
    allDay: true,
    hideWhenUnavailable: true,
    createdAt: new Date(nowMs - index * 1_000),
    updatedAt: new Date(nowMs - index * 500),
    internalCost: "source-offer-canary",
    ...overrides,
  };
}

function previewCandidate(projection) {
  return Object.freeze({
    offerType: projection.offerType,
    sourceDocumentId: projection.sourceDocumentId,
    indexDocumentId: projection.indexDocumentId,
    sourceCreatedAtMs: projection.sourceCreatedAt.getTime(),
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

function addReadyRestaurant(database, session, index, options = {}) {
  const suffix = String(index).padStart(4, "0");
  const accountId = options.accountId ?? `internal-account-${suffix}`;
  const restaurant = rawRestaurant(index, options.restaurant);
  const restaurantProjection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: accountId,
    source: restaurant,
    now: new Date(nowMs),
  });
  assert.notEqual(restaurantProjection, null);
  const publicRestaurantId = customerBiteSaverOpaqueRestaurantId(
    secretKey,
    accountId,
  );
  const daily = [];
  const coupons = [];
  const offerCount = options.offerCount ?? 2;
  for (let offerIndex = 0; offerIndex < offerCount; offerIndex += 1) {
    const offerType = options.offerTypeForIndex?.(offerIndex) ??
      (options.onlyCoupons || offerIndex % 2 === 1
        ? "coupon"
        : "dailySpecial");
    const sourceDocumentId = options.offerIdForIndex?.(
      offerIndex,
      offerType,
    ) ?? options.sharedOfferId ??
      `${offerType === "coupon" ? "coupon" : "daily"}-${suffix}-${String(offerIndex).padStart(3, "0")}`;
    const offerOverrides = options.offerOverridesForIndex?.(
      offerIndex,
      offerType,
    ) ?? options.offerOverrides;
    const raw = offerType === "coupon"
      ? rawCoupon(index * 100 + offerIndex, offerOverrides)
      : rawDailySpecial(accountId, index * 100 + offerIndex, offerOverrides);
    const projection = offerType === "coupon"
      ? buildBiteSaverCouponOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId,
          offer: raw,
          restaurant,
          now: new Date(options.offerProjectionNowMs ?? nowMs),
        })
      : buildBiteSaverDailySpecialOfferIndex({
          restaurantAccountId: accountId,
          sourceDocumentId,
          offer: raw,
          restaurant,
          now: new Date(options.offerProjectionNowMs ?? nowMs),
        });
    assert.notEqual(projection, null);
    const collection = offerType === "coupon" ? "coupons" : "daily_specials";
    database.documents.set(
      `restaurant_accounts/${accountId}/${collection}/${sourceDocumentId}`,
      raw,
    );
    database.documents.set(
      `${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,
      projection,
    );
    (offerType === "coupon" ? coupons : daily).push(previewCandidate(projection));
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
    exactPreferenceRank: options.exactPreferenceRank ?? 1,
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
    safeRestaurantSnapshot: safeRestaurantSnapshot(restaurantProjection),
    createdAt: new Date(options.resultCreatedAtMs ?? nowMs),
    logicalExpiresAt: session.logicalExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    expiresAt: session.absoluteExpiresAt,
  };
  const resultId = customerBiteSaverResultDocumentId(
    secretKey,
    session.sessionId,
    session.attemptGeneration,
    publicRestaurantId,
  );
  const resultPath = `${privateCustomerBiteSaverResultCollection}/${resultId}`;
  database.documents.set(resultPath, result);
  return {
    accountId,
    publicRestaurantId,
    restaurant,
    restaurantProjection,
    result,
    resultPath,
    daily,
    coupons,
  };
}

function replaceReadyCoupon(
  database,
  seeded,
  index,
  overrides,
  projectionNowMs = nowMs,
) {
  const existing = seeded.coupons[index];
  assert.notEqual(existing, undefined);
  const rawPath =
    `restaurant_accounts/${seeded.accountId}/coupons/${existing.sourceDocumentId}`;
  const raw = {...database.documents.get(rawPath), ...overrides};
  const projection = buildBiteSaverCouponOfferIndex({
    restaurantAccountId: seeded.accountId,
    sourceDocumentId: existing.sourceDocumentId,
    offer: raw,
    restaurant: seeded.restaurant,
    now: new Date(projectionNowMs),
  });
  assert.notEqual(projection, null);
  const candidate = previewCandidate(projection);
  database.documents.set(rawPath, raw);
  database.documents.set(
    `${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,
    projection,
  );
  seeded.coupons[index] = candidate;
  return {candidate, raw, rawPath, projection};
}

function markSessionReady(database, started) {
  const path = `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  const session = database.documents.get(path);
  const ready = {...session, state: "ready", phase: "ready"};
  database.documents.set(path, ready);
  return ready;
}

function addUnavailableResult(database, session, index) {
  const suffix = String(index).padStart(4, "0");
  const accountId = `unavailable-account-${suffix}`;
  const publicRestaurantId = customerBiteSaverOpaqueRestaurantId(
    secretKey,
    accountId,
  );
  const data = {
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
    authoritativeAccountIdOrderKey: dartUtf16FirestoreBytesOrderKey(accountId),
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
    createdAt: new Date(nowMs),
    logicalExpiresAt: session.logicalExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    expiresAt: session.absoluteExpiresAt,
  };
  database.documents.set(`${privateCustomerBiteSaverResultCollection}/${
    customerBiteSaverResultDocumentId(
      secretKey,
      session.sessionId,
      session.attemptGeneration,
      publicRestaurantId,
    )}`, data);
  return data;
}

function pageRequest(started, overrides = {}) {
  return {
    ...boundRequest(started, {clientRequestId: "page-request-00001"}),
    cursor: null,
    guestStateRevision: null,
    ...overrides,
  };
}

function offerPageRequest(started, restaurantId, overrides = {}) {
  return {
    ...pageRequest(started, {
      clientRequestId: "offer-page-request-0001",
      ...overrides,
    }),
    restaurantId,
  };
}

function favoriteRequest(started, overrides = {}) {
  return {
    ...boundRequest(started, {clientRequestId: "favorite-request-0001"}),
    restaurantIds: [],
    offerIds: [],
    ...overrides,
  };
}

function redemptionRequest(started, restaurantId, offerId, overrides = {}) {
  return {
    ...boundRequest(started, {clientRequestId: "redeem-request-00001"}),
    restaurantId,
    offerId,
    offerOccurrence: "bsoc1.invalid",
    redemptionRequestId: "redemption-occurrence-0001",
    currentCoordinates: null,
    guestStateRevision: null,
    ...overrides,
  };
}

function guestAnswerRequest(
  started,
  challenge,
  unavailableOfferIds,
  overrides = {},
) {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId:
      `guest-answer-${challenge.operation}-${String(challenge.batchSequence)
        .padStart(4, "0")}`,
    clientInstanceId: "client-instance-0001",
    sessionId: started.sessionId,
    capability: started.capability,
    criteriaFingerprint: started.criteriaFingerprint,
    operationRef: challenge.operationRef,
    checkToken: challenge.checkToken,
    batchSequence: challenge.batchSequence,
    guestStateRevision: challenge.guestStateRevision,
    entireBatchEvaluated: true,
    unavailableOfferIds,
    ...overrides,
  };
}

class SimulatedLocalGuestHistory {
  constructor(unavailableOfferIds, revision) {
    this.unavailableOfferIds = new Set(unavailableOfferIds);
    this.revision = revision;
    this.checkedBatches = [];
    this.answers = [];
  }

  answer(started, challenge, overrides = {}) {
    assert.equal(challenge.guestStateRevision, this.revision);
    assert.ok(challenge.candidates.length > 0);
    assert.ok(
      challenge.candidates.length <=
        customerBiteSaverGuestCheckMaximumCandidateIds,
    );
    const candidateIds = challenge.candidates.map(({offerId}) => offerId);
    assert.equal(new Set(candidateIds).size, candidateIds.length);
    const unavailableOfferIds = candidateIds.filter((offerId) =>
      this.unavailableOfferIds.has(offerId));
    this.checkedBatches.push(candidateIds);
    this.answers.push(unavailableOfferIds);
    return guestAnswerRequest(
      started,
      challenge,
      unavailableOfferIds,
      overrides,
    );
  }
}

function guestIdentity() {
  return {authUid: null, authIsAnonymous: false};
}

function opaqueOfferId(seeded, candidate) {
  return customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    candidate.offerType,
    candidate.sourceDocumentId,
  );
}

function databaseDocumentState(database) {
  return JSON.stringify([...database.documents.entries()]);
}

function clonedDatabaseEntries(database) {
  return [...database.documents.entries()].map(
    ([path, data]) => [path, structuredClone(data)],
  );
}

function persistedGuestAnswerFingerprint(answer) {
  const unavailableOfferIds = [...answer.unavailableOfferIds].sort(
    (left, right) => Buffer.compare(
      Buffer.from(left, "utf8"),
      Buffer.from(right, "utf8"),
    ),
  );
  return createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    purpose: "guestOfferCheckAnswer",
    sessionId: answer.sessionId,
    operationRef: answer.operationRef,
    checkToken: answer.checkToken,
    batchSequence: answer.batchSequence,
    guestStateRevision: answer.guestStateRevision,
    entireBatchEvaluated: true,
    unavailableOfferIds,
  });
}

async function assertMalformedGuestCheckRejected({
  baselineEntries,
  context,
  documentPath,
  malformed,
  answer,
}) {
  const database = new InMemoryCustomerBiteSaverSearchDatabase(
    baselineEntries.map(([path, data]) => [path, structuredClone(data)]),
  );
  const caseContext = {...context, database};
  database.documents.set(documentPath, malformed);
  const beforeState = databaseDocumentState(database);
  await assert.rejects(
    continueCustomerBiteSaverGuestOfferCheckHandler(answer, caseContext),
    (error) => {
      assert.equal(assertContractError(error, "failed-precondition"), true);
      assert.equal(
        error.message,
        "The BiteSaver guest offer-check state is invalid.",
      );
      assertNoPrivateCanaries({error: error.message});
      return true;
    },
  );
  assert.equal(databaseDocumentState(database), beforeState);
  assert.equal(database.calls.transactionWrites.length, 0);
  assert.equal(database.calls.commits.length, 0);
}

async function deliveredRedemptionRequest(
  started,
  restaurantId,
  offerId,
  context,
  overrides = {},
) {
  const page = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, restaurantId, {
      clientRequestId: `redemption-offer-${restaurantId}`,
    }),
    context,
  );
  const offer = page.offers.find((entry) => entry.offerId === offerId);
  assert.notEqual(offer, undefined);
  return redemptionRequest(started, restaurantId, offerId, {
    offerOccurrence: offer.offerOccurrence,
    ...overrides,
  });
}

function fixtureOfferOccurrence(
  database,
  started,
  seeded,
  candidate,
) {
  const session = database.documents.get(
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`,
  );
  const callerCapabilityBinding = customerBiteSaverCallerCapabilityBinding(
    secretKey,
    session.callerBindingHash,
    session.capabilityHash,
  );
  const guestStateGeneration = createQueryFingerprint({
    guestStateRevision: null,
  });
  const usageGeneration = createQueryFingerprint({fixture: "usage-generation"});
  const matchingMode = session.criteria.normalizedSearchQuery.length === 0
    ? "parent"
    : "offer";
  const offerCatalogFingerprint =
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint(
      seeded.restaurant,
    );
  const pageGenerationFingerprint = createQueryFingerprint({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "offerPage",
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    queryFingerprint: session.queryFingerprint,
    availabilityAtMs: nowMs,
    timeZone: session.criteria.timeZone,
    utcOffsetMinutes: session.criteria.utcOffsetMinutes,
    callerScope: session.callerScope,
    authenticatedUidHash: session.authenticatedUidHash,
    callerCapabilityBinding,
    guestStateFingerprint: guestStateGeneration,
    usageGeneration,
    offerCatalogFingerprint,
    pageSize: customerBiteSaverPageSize,
    restaurantPublicId: seeded.publicRestaurantId,
    matchingMode,
  });
  const offerId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    candidate.offerType,
    candidate.sourceDocumentId,
  );
  return new CustomerBiteSaverOfferOccurrenceCodec({
    key: secretKey,
    now: () => nowMs,
  }).encode({
    pagePurpose: "offerPage",
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    queryFingerprint: session.queryFingerprint,
    pageGenerationFingerprint,
    callerCapabilityBinding,
    restaurantPublicId: seeded.publicRestaurantId,
    offerPublicId: offerId,
    authoritativeAccountId: seeded.accountId,
    offerType: candidate.offerType,
    sourceDocumentId: candidate.sourceDocumentId,
    indexDocumentId: candidate.indexDocumentId,
    sourceCreatedAtMs: candidate.sourceCreatedAtMs,
    sourceCreatedAtOrderKey: candidate.sourceCreatedAtOrderKey,
    sourceFingerprint: candidate.sourceFingerprint,
    matchingMode,
    availabilityAtMs: nowMs,
    guestStateFingerprint: guestStateGeneration,
    usageGeneration,
    offerCatalogFingerprint,
    expiresAtMs: session.logicalExpiresAt.getTime(),
  });
}

test("parent catalog fingerprints canonicalize Firestore Timestamp values", () => {
  const millis = Date.parse("2026-09-09T11:00:00.123Z");
  const dateFingerprint =
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({
      offerCatalogUpdatedAt: new Date(millis),
    });
  const timestampFingerprint =
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({
      offerCatalogUpdatedAt: {
        _seconds: Math.floor(millis / 1_000),
        _nanoseconds: (millis % 1_000) * 1_000_000,
        toDate: () => new Date(millis),
      },
    });
  assert.equal(timestampFingerprint, dateFingerprint);
  assert.notEqual(
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({
      offerCatalogUpdatedAt: {
        _seconds: Math.floor(millis / 1_000),
        _nanoseconds: (millis % 1_000) * 1_000_000 + 1,
        toDate: () => new Date(millis),
      },
    }),
    dateFingerprint,
  );
  const exactTimestampFingerprint =
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({
      offerCatalogUpdatedAt: {
        seconds: Math.floor(millis / 1_000),
        nanoseconds: (millis % 1_000) * 1_000_000,
        toDate: () => new Date(millis),
      },
    });
  assert.equal(exactTimestampFingerprint, dateFingerprint);
  assert.notEqual(
    exactTimestampFingerprint,
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({
      offerCatalogUpdatedAt: {
        seconds: Math.floor(millis / 1_000),
        nanoseconds: (millis % 1_000) * 1_000_000 + 1,
        toDate: () => new Date(millis),
      },
    }),
  );
  assert.notEqual(
    dateFingerprint,
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({
      offerCatalogUpdatedAt: new Date(millis + 1),
    }),
  );
  assert.notEqual(
    dateFingerprint,
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({}),
  );
});

test("projected and raw parent catalog fingerprints retain exact nanos", () => {
  const seconds = Math.floor(
    Date.parse("2026-09-09T11:00:00.123Z") / 1_000,
  );
  const firstTimestamp = new Timestamp(seconds, 123_000_001);
  const secondTimestamp = new Timestamp(seconds, 123_000_002);
  const projection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "catalog-nanos-account",
    source: rawRestaurant(1, {offerCatalogUpdatedAt: firstTimestamp}),
    now: new Date(nowMs),
  });
  const rawFingerprint =
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({
      offerCatalogUpdatedAt: firstTimestamp,
    });

  assert.equal(
    customerBiteSaverSessionInternals
      .projectedParentCatalogGenerationFingerprint(projection),
    rawFingerprint,
  );
  assert.notEqual(
    rawFingerprint,
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint({
      offerCatalogUpdatedAt: secondTimestamp,
    }),
  );
});

test("projected and raw parent catalog fingerprints agree without a marker", () => {
  const source = rawRestaurant(1);
  delete source.offerCatalogUpdatedAt;
  const projection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "catalog-missing-marker-account",
    source,
    now: new Date(nowMs),
  });

  assert.equal(
    customerBiteSaverSessionInternals
      .projectedParentCatalogGenerationFingerprint(projection),
    customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint(
      source,
    ),
  );
});

async function startSession(database = new InMemoryCustomerBiteSaverSearchDatabase(), options = {}) {
  const context = createContext(database, options.context);
  const request = startRequest(options.request);
  const response = await startCustomerBiteSaverSearchHandler(request, context);
  return {database, context, request, response};
}

test("start handler validates its closed request before any database access", async () => {
  for (const invalid of [
    {...startRequest(), unexpected: true},
    (() => {
      const value = startRequest();
      delete value.searchText;
      return value;
    })(),
    startRequest({schemaVersion: "1"}),
    startRequest({radiusMiles: 25}),
    startRequest({clientRequestId: "short"}),
  ]) {
    const database = new InMemoryCustomerBiteSaverSearchDatabase();
    await assert.rejects(
      startCustomerBiteSaverSearchHandler(invalid, createContext(database)),
      (error) => assertContractError(error, "invalid-argument"),
    );
    assert.equal(database.calls.transactions, 0);
    assert.deepEqual(database.calls.getDocument, []);
    assert.deepEqual(database.calls.getDocuments, []);
    assert.deepEqual(database.calls.queryDocuments, []);
    assert.deepEqual(database.calls.commits, []);
  }
});

test("start handler creates one bounded private session and exact safe response", async () => {
  const {database, response} = await startSession();
  assertExactKeys(response, [
    "schemaVersion",
    "sessionId",
    "capability",
    "state",
    "attemptGeneration",
    "criteriaFingerprint",
    "queryFingerprint",
    "logicalExpiresAtMillis",
  ]);
  assert.equal(response.schemaVersion, customerBiteSaverSearchSchemaVersion);
  assert.match(response.sessionId, /^bss_[A-Za-z0-9_-]{43}$/u);
  assert.match(response.capability, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(response.state, "preparing");
  assert.equal(response.attemptGeneration, 0);
  assert.match(response.criteriaFingerprint, /^[0-9a-f]{64}$/u);
  assert.match(response.queryFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(response), true);
  assertNoPrivateCanaries(response);

  assert.equal(database.calls.transactions, 1);
  assert.deepEqual(database.calls.getDocuments.map((paths) => paths.length), [16, 0]);
  assert.equal(Math.max(...database.calls.getDocuments.map((paths) => paths.length)), 16);
  const writes = database.calls.transactionWrites[0];
  assert.equal(writes.length, 21);
  assert.equal(writes.filter((write) => write.type === "create").length, 19);
  assert.equal(writes.filter((write) => write.type === "set").length, 2);
  assert.ok(database.documents.has(
    `${privateCustomerBiteSaverSearchSessionCollection}/${response.sessionId}`,
  ));
  assert.equal(
    writes.filter((write) => write.path.startsWith(`${privateCustomerBiteSaverJobCollection}/`)).length,
    1,
  );
  const control = [...database.documents.values()].find(
    (document) => document.role === "callerControl",
  );
  assert.notEqual(control, undefined);
  assert.match(
    control.recentRequests[0].clientRequestBinding,
    /^bssrb_[A-Za-z0-9_-]{43}$/u,
  );
  assert.equal(
    JSON.stringify([...database.documents.values()]).includes(
      "start-request-0001",
    ),
    false,
  );
});

test("start fails closed on malformed or cross-bound active private state", async (t) => {
  for (const fixture of [
    {
      name: "control has an undeclared field",
      role: "callerControl",
      mutate: (document) => ({...document, bypassCanary: true}),
    },
    {
      name: "pointer is bound to another caller",
      role: "criteriaPointer",
      mutate: (document) => ({
        ...document,
        callerBindingHash: "0".repeat(64),
      }),
    },
  ]) {
    await t.test(fixture.name, async () => {
      const database = new InMemoryCustomerBiteSaverSearchDatabase();
      const context = createContext(database);
      await startCustomerBiteSaverSearchHandler(startRequest(), context);
      const privateEntry = [...database.documents.entries()].find(
        ([, document]) => document.role === fixture.role,
      );
      assert.notEqual(privateEntry, undefined);
      database.documents.set(privateEntry[0], fixture.mutate(privateEntry[1]));
      const sessionCount = [...database.documents.keys()].filter((documentPath) =>
        documentPath.startsWith(
          `${privateCustomerBiteSaverSearchSessionCollection}/`,
        )).length;

      await assert.rejects(
        startCustomerBiteSaverSearchHandler(startRequest({
          clientRequestId: "strict-private-state-0002",
          freshSearch: true,
        }), context),
        (error) => {
          assert.equal(assertContractError(error, "failed-precondition"), true);
          assert.equal(error.message.includes("bypassCanary"), false);
          return true;
        },
      );
      assert.equal(
        [...database.documents.keys()].filter((documentPath) =>
          documentPath.startsWith(
            `${privateCustomerBiteSaverSearchSessionCollection}/`,
          )).length,
        sessionCount,
      );
    });
  }
});

test("start cannot bypass unfinished-session control through a malformed session", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database);
  const started = await startCustomerBiteSaverSearchHandler(startRequest(), context);
  const activeSessionPath =
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  database.documents.set(activeSessionPath, {
    ...database.documents.get(activeSessionPath),
    privateBypassCanary: true,
  });

  await assert.rejects(
    startCustomerBiteSaverSearchHandler(startRequest({
      clientRequestId: "strict-session-reference-0002",
      freshSearch: true,
    }), context),
    (error) => {
      assert.equal(assertContractError(error, "failed-precondition"), true);
      assert.equal(error.message.includes("privateBypassCanary"), false);
      return true;
    },
  );
  assert.equal(
    [...database.documents.keys()].filter((documentPath) =>
      documentPath.startsWith(
        `${privateCustomerBiteSaverSearchSessionCollection}/`,
      )).length,
    1,
  );
});

test("stored session criteria must remain fully canonical and version-bound", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest(),
    createContext(database),
  );
  const sessionPath =
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  const session = database.documents.get(sessionPath);
  const corruptions = [
    (criteria) => ({...criteria, eligibilityPolicyVersion: "future-policy"}),
    (criteria) => ({...criteria, latitudeBinary64: "0".repeat(16)}),
    (criteria) => ({...criteria, timeZone: "Not/A_Time_Zone"}),
    (criteria) => ({...criteria, normalizedSearchQuery: "NOT normalized"}),
    (criteria) => ({...criteria, normalizedSearchQuery: "\ud800"}),
    (criteria) => ({
      ...criteria,
      locationMode: "typed",
      typedLocation: {kind: "city", city: " New   York ", state: "Florida"},
    }),
  ];
  for (const mutate of corruptions) {
    const criteria = mutate(session.criteria);
    const corrupted = {
      ...session,
      criteria,
      criteriaFingerprint: createCustomerBiteSaverCriteriaFingerprint(criteria),
      queryFingerprint: createCustomerBiteSaverMembershipFingerprint({
        criteria,
        attemptGeneration: session.attemptGeneration,
        catalogGenerationVector: session.catalogGenerationVector,
      }),
    };
    assert.equal(customerBiteSaverSessionInternals.parseSession({
      id: started.sessionId,
      path: sessionPath,
      data: corrupted,
    }), null);
  }
});

test("start retry and non-fresh equivalent request reuse the authorized session", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database);
  const request = startRequest();
  const first = await startCustomerBiteSaverSearchHandler(request, context);
  const documentCount = database.documents.size;
  const retry = await startCustomerBiteSaverSearchHandler(request, context);
  assert.deepEqual(retry, first);
  assert.equal(database.documents.size, documentCount);
  assert.deepEqual(database.calls.transactionWrites.at(-1), []);

  const reused = await startCustomerBiteSaverSearchHandler(startRequest({
    clientRequestId: "start-request-0002",
    freshSearch: false,
  }), context);
  assert.equal(reused.sessionId, first.sessionId);
  assert.equal(reused.capability, first.capability);

  await assert.rejects(
    startCustomerBiteSaverSearchHandler(startRequest({
      searchText: "different criteria",
    }), context),
    (error) => assertContractError(error, "invalid-argument"),
  );
});

test("non-fresh starts cannot reuse membership across clock contracts", async () => {
  for (const [suffix, clockOverride] of [
    ["timezone", {timeZone: "America/Chicago", utcOffsetMinutes: -300}],
    ["offset", {timeZone: "America/New_York", utcOffsetMinutes: -300}],
  ]) {
    const database = new InMemoryCustomerBiteSaverSearchDatabase();
    const context = createContext(database);
    const first = await startCustomerBiteSaverSearchHandler(startRequest(), context);
    const changed = await startCustomerBiteSaverSearchHandler(startRequest({
      clientRequestId: `clock-contract-${suffix}-0002`,
      freshSearch: false,
      ...clockOverride,
    }), context);
    assert.notEqual(changed.sessionId, first.sessionId, suffix);
    assert.notEqual(changed.criteriaFingerprint, first.criteriaFingerprint, suffix);
  }
});

test("start replay survives pointer movement and binds the time-zone contract", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database);
  const first = await startCustomerBiteSaverSearchHandler(startRequest({
    clientRequestId: "start-replay-original-0001",
  }), context);
  const aliasRequest = startRequest({
    clientRequestId: "start-replay-alias-000002",
    freshSearch: false,
  });
  const aliased = await startCustomerBiteSaverSearchHandler(
    aliasRequest,
    context,
  );
  assert.equal(aliased.sessionId, first.sessionId);

  const fresh = await startCustomerBiteSaverSearchHandler(startRequest({
    clientRequestId: "start-replay-fresh-000002",
    freshSearch: true,
  }), context);
  assert.notEqual(fresh.sessionId, first.sessionId);
  assert.deepEqual(
    await startCustomerBiteSaverSearchHandler(aliasRequest, context),
    aliased,
  );

  await assert.rejects(
    startCustomerBiteSaverSearchHandler({
      ...aliasRequest,
      timeZone: "America/Chicago",
      utcOffsetMinutes: -300,
    }, context),
    (error) => assertContractError(error, "invalid-argument"),
  );
  const replayDocuments = [...database.documents.values()].filter(
    (document) => document.role === "startRequestReplay",
  );
  assert.equal(replayDocuments.length, 3);
  assert.ok(replayDocuments.every((document) =>
    !JSON.stringify(document).includes("start-replay-")));
});

test("authorized activity slides logical expiry and touches preparing work", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  let clock = nowMs;
  const context = createContext(database, {now: () => clock});
  const started = await startCustomerBiteSaverSearchHandler(startRequest(), context);
  const sessionPath =
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  const initial = database.documents.get(sessionPath);
  const jobPath = `${privateCustomerBiteSaverJobCollection}/${initial.currentJobId}`;

  clock += 5 * 60_000;
  const status = await getCustomerBiteSaverSearchStatusHandler(
    boundRequest(started),
    context,
  );
  const touched = database.documents.get(sessionPath);
  assert.equal(touched.lastAccessAt.getTime(), clock);
  assert.equal(
    touched.logicalExpiresAt.getTime(),
    clock + customerBiteSaverIdleExpiryMilliseconds,
  );
  assert.equal(status.logicalExpiresAtMillis, touched.logicalExpiresAt.getTime());
  assert.equal(
    database.documents.get(jobPath).logicalExpiresAt.getTime(),
    touched.logicalExpiresAt.getTime(),
  );

  clock = touched.logicalExpiresAt.getTime();
  const expired = await getCustomerBiteSaverSearchStatusHandler(
    boundRequest(started),
    context,
  );
  assert.equal(expired.state, "expired");
  assert.equal(database.documents.get(sessionPath).state, "expired");
  assert.equal(database.documents.get(jobPath).state, "expired");
});

test("idle touches cap at absolute expiry and cannot resurrect a session", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  let clock = nowMs;
  const context = createContext(database, {now: () => clock});
  const started = await startCustomerBiteSaverSearchHandler(startRequest(), context);
  const sessionPath =
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  const initial = database.documents.get(sessionPath);

  for (const elapsedMinutes of [10, 20, 30, 40, 50, 59]) {
    clock = nowMs + elapsedMinutes * 60_000;
    const status = await getCustomerBiteSaverSearchStatusHandler(
      boundRequest(started, {
        clientRequestId: `status-absolute-${String(elapsedMinutes).padStart(2, "0")}`,
      }),
      context,
    );
    assert.equal(
      status.logicalExpiresAtMillis,
      Math.min(
        initial.absoluteExpiresAt.getTime(),
        clock + customerBiteSaverIdleExpiryMilliseconds,
      ),
    );
  }
  const beforeExpiryAttempt = database.documents.get(sessionPath);
  assert.equal(
    beforeExpiryAttempt.logicalExpiresAt.getTime(),
    initial.absoluteExpiresAt.getTime(),
  );
  clock = initial.absoluteExpiresAt.getTime();
  const expired = await getCustomerBiteSaverSearchStatusHandler(
    boundRequest(started, {
      clientRequestId: "status-after-absolute-expiry",
    }),
    context,
  );
  assert.equal(expired.state, "expired");
  assert.equal(database.documents.get(sessionPath).state, "expired");
  assert.equal(
    database.documents.get(sessionPath).logicalExpiresAt.getTime(),
    beforeExpiryAttempt.logicalExpiresAt.getTime(),
  );
});

test("status handler is closed, authorized, sanitized, and recreates only missing work", async () => {
  const {database, context, response: started} = await startSession();
  const request = boundRequest(started);
  for (const invalid of [
    {...request, unexpected: true},
    {...request, capability: Buffer.alloc(32, 9).toString("base64url")},
    {...request, clientInstanceId: "another-client-0001"},
    {...request, criteriaFingerprint: "0".repeat(64)},
  ]) {
    await assert.rejects(
      getCustomerBiteSaverSearchStatusHandler(invalid, context),
      (error) => assertContractError(
        error,
        Object.hasOwn(invalid, "unexpected") ? "invalid-argument" : "permission-denied",
      ),
    );
  }

  const sessionPath = `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  const session = database.documents.get(sessionPath);
  const jobPath = `${privateCustomerBiteSaverJobCollection}/${session.currentJobId}`;
  database.documents.delete(jobPath);
  const preparing = await getCustomerBiteSaverSearchStatusHandler(request, context);
  assertExactKeys(preparing, [
    "schemaVersion",
    "state",
    "progress",
    "failureCode",
    "retriable",
    "attemptGeneration",
    "queryFingerprint",
    "logicalExpiresAtMillis",
  ]);
  assertExactKeys(preparing.progress, ["phase", "completedRanges", "totalRanges"]);
  assert.equal(preparing.state, "preparing");
  assert.equal(database.documents.has(jobPath), true);
  assert.equal(database.calls.commits.at(-1).length, 1);
  assertNoPrivateCanaries(preparing);

  database.documents.set(sessionPath, {
    ...session,
    state: "ready",
    phase: "ready",
  });
  const ready = await getCustomerBiteSaverSearchStatusHandler(request, context);
  assert.equal(ready.state, "ready");
  assert.equal(ready.progress.phase, "ready");
  assert.equal(database.calls.commits.length, 1);
});

test("signed session status rejects guest, anonymous, and wrong-UID replay", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const signedContext = createContext(database, {
    identity: {authUid: "owner-uid-canary", authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest(),
    signedContext,
  );
  const request = boundRequest(started);
  assert.equal(
    (await getCustomerBiteSaverSearchStatusHandler(request, signedContext)).state,
    "preparing",
  );
  for (const identity of [
    {authUid: null, authIsAnonymous: true},
    {authUid: "owner-uid-canary", authIsAnonymous: true},
    {authUid: "wrong-owner-uid", authIsAnonymous: false},
  ]) {
    await assert.rejects(
      getCustomerBiteSaverSearchStatusHandler(
        request,
        createContext(database, {identity}),
      ),
      (error) => assertContractError(error, "permission-denied"),
    );
  }
});

test("one live gate serializes status and page continuations per session", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0);
  const gateId = customerBiteSaverSessionInternals.requestGateDocumentId(
    secretKey,
    session,
  );
  const absoluteExpiresAt = new Date(session.absoluteExpiresAt.getTime());
  const gatePath = `${privateCustomerBiteSaverActiveSessionCollection}/${gateId}`;
  database.documents.set(gatePath, {
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: "sessionContinuationGate",
    state: "processing",
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    callerCapabilityBinding: customerBiteSaverCallerCapabilityBinding(
      secretKey,
      session.callerBindingHash,
      session.capabilityHash,
    ),
    requestBinding: `bsgrq_${Buffer.alloc(32, 2).toString("base64url")}`,
    leaseBinding: `bsgls_${Buffer.alloc(32, 3).toString("base64url")}`,
    leaseExpiresAt: new Date(
      nowMs + customerBiteSaverRequestGateLeaseMilliseconds,
    ),
    createdAt: new Date(nowMs),
    logicalExpiresAt: absoluteExpiresAt,
    absoluteExpiresAt,
    expiresAt: absoluteExpiresAt,
  });
  const blockedContext = createContext(database, {
    now: () => nowMs + 60_000,
  });
  const sessionPath =
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  const sessionBeforeBlockedRequests = database.documents.get(sessionPath);
  const transactionWritesBeforeBlockedRequests =
    database.calls.transactionWrites.length;
  const commitsBeforeBlockedRequests = database.calls.commits.length;
  const replayCountBeforeBlockedRequests = [...database.documents.values()]
    .filter((document) => document.role === "requestReplay").length;
  const assertNoPreGateWrites = () => {
    assert.deepEqual(
      database.documents.get(sessionPath),
      sessionBeforeBlockedRequests,
    );
    assert.equal(
      database.calls.transactionWrites.length,
      transactionWritesBeforeBlockedRequests,
    );
    assert.equal(database.calls.commits.length, commitsBeforeBlockedRequests);
    assert.equal(
      [...database.documents.values()]
        .filter((document) => document.role === "requestReplay").length,
      replayCountBeforeBlockedRequests,
    );
  };

  await assert.rejects(
    getCustomerBiteSaverSearchStatusHandler(
      boundRequest(started, {
        clientRequestId: "blocked-status-request-0001",
      }),
      blockedContext,
    ),
    (error) => assertContractError(error, "resource-exhausted"),
  );
  assertNoPreGateWrites();
  await assert.rejects(
    getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "blocked-restaurant-page-0001",
      }),
      blockedContext,
    ),
    (error) => assertContractError(error, "resource-exhausted"),
  );
  assertNoPreGateWrites();
  await assert.rejects(
    getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "blocked-offer-page-request-0001",
      }),
      blockedContext,
    ),
    (error) => assertContractError(error, "resource-exhausted"),
  );
  assertNoPreGateWrites();
  assert.deepEqual(database.calls.queryDocuments, []);

  const afterCallableDeadline = createContext(database, {
    now: () => nowMs + 121_000,
  });
  await assert.rejects(
    getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {clientRequestId: "page-before-gate-takeover-0001"}),
      afterCallableDeadline,
    ),
    (error) => assertContractError(error, "resource-exhausted"),
  );

  database.documents.set(gatePath, {
    ...database.documents.get(gatePath),
    createdAt: new Date(nowMs - 31_000),
    leaseExpiresAt: new Date(nowMs - 1_000),
  });
  const successfulWriteStart = database.calls.transactionWrites.length;
  const page = await getCustomerBiteSaverSearchPageHandler(pageRequest(
    started,
    {clientRequestId: "page-after-stale-gate-0001"},
  ), createContext(database, {now: () => nowMs + 122_000}));
  assert.equal(page.restaurants.length, 1);
  assert.equal(database.documents.has(gatePath), false);
  const successfulWrites = database.calls.transactionWrites
    .slice(successfulWriteStart)
    .flat();
  const gateWriteIndex = successfulWrites.findIndex((write) =>
    write.data?.role === "sessionContinuationGate");
  const sessionTouchIndex = successfulWrites.findIndex((write) =>
    write.path === sessionPath);
  const replayWriteIndex = successfulWrites.findIndex((write) =>
    write.data?.role === "requestReplay");
  assert.equal(gateWriteIndex, 0);
  assert.ok(sessionTouchIndex > gateWriteIndex);
  assert.ok(replayWriteIndex > sessionTouchIndex);
});

test("restaurant membership query uses the exact ordered 26-row contract", async () => {
  const {database, response: started} = await startSession();
  const session = database.documents.get(
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`,
  );
  const query = customerBiteSaverOrderedResultQuery({session});
  assert.deepEqual(query, {
    collectionPath: "private_bitesaver_search_results",
    filters: [
      {field: "sessionId", operation: "==", value: started.sessionId},
      {field: "attemptGeneration", operation: "==", value: 0},
      {field: "eligibleAtPreparation", operation: "==", value: true},
    ],
    orders: [
      {field: "exactPreferenceRank", direction: "asc"},
      {field: "distanceSortMiles", direction: "asc"},
      {field: "lowercaseDisplayNameOrderKey", direction: "asc"},
      {field: "authoritativeAccountIdOrderKey", direction: "asc"},
    ],
    limit: 26,
  });
  const accountOrderKey = dartUtf16FirestoreBytesOrderKey("account-boundary");
  const startAfter = [
    1,
    12.5,
    "006100",
    dartUtf16FirestoreBytesCursorValue(accountOrderKey, 1_500),
  ];
  assert.deepEqual(
    customerBiteSaverOrderedResultQuery({session, startAfter}).startAfter,
    [1, 12.5, "006100", accountOrderKey],
  );
});

test("restaurant page requires readiness and a strict authorized request", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const request = pageRequest(started);
  await assert.rejects(
    getCustomerBiteSaverSearchPageHandler(request, context),
    (error) => assertContractError(error, "failed-precondition"),
  );
  assert.equal(database.calls.queryDocuments.length, 0);

  markSessionReady(database, started);
  for (const invalid of [
    {...request, unexpected: true},
    {...request, cursor: 1},
    {...request, guestStateRevision: -1},
    {...request, guestStateRevision: 1.5},
    {...request, guestStateRevision: "1"},
  ]) {
    const queriesBefore = database.calls.queryDocuments.length;
    await assert.rejects(
      getCustomerBiteSaverSearchPageHandler(invalid, context),
      (error) => assertContractError(error, "invalid-argument"),
    );
    assert.equal(database.calls.queryDocuments.length, queriesBefore);
  }
  await assert.rejects(
    getCustomerBiteSaverSearchPageHandler(
      {...request, capability: Buffer.alloc(32, 4).toString("base64url")},
      context,
    ),
    (error) => assertContractError(error, "permission-denied"),
  );
});

test("malformed private results fail sanitized while withdrawn results stay unavailable", async (t) => {
  for (const fixture of [
    {
      name: "safe snapshot has a nested undeclared field",
      mutate: (result) => ({
        ...result,
        safeRestaurantSnapshot: {
          ...result.safeRestaurantSnapshot,
          nestedPrivateCanary: "must-not-leak",
        },
      }),
    },
    {
      name: "preview identity has a nested undeclared field",
      mutate: (result) => ({
        ...result,
        previewDailyCandidates: [{
          ...result.previewDailyCandidates[0],
          nestedPrivateCanary: "must-not-leak",
        }],
      }),
    },
  ]) {
    await t.test(fixture.name, async () => {
      const {database, context, response: started} = await startSession(
        undefined,
        {request: {searchText: ""}},
      );
      const session = markSessionReady(database, started);
      const seeded = addReadyRestaurant(database, session, 0);
      database.documents.set(seeded.resultPath, fixture.mutate(seeded.result));

      await assert.rejects(
        getCustomerBiteSaverSearchPageHandler(pageRequest(started), context),
        (error) => {
          assert.equal(assertContractError(error, "failed-precondition"), true);
          assert.equal(error.message.includes("nestedPrivateCanary"), false);
          assert.equal(error.message.includes("must-not-leak"), false);
          return true;
        },
      );
    });
  }

  await t.test("withdrawn result is not misreported as corruption", async () => {
    const {database, context, response: started} = await startSession(
      undefined,
      {request: {searchText: ""}},
    );
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0);
    database.documents.delete(seeded.resultPath);

    await assert.rejects(
      getCustomerBiteSaverOfferPageHandler(
        offerPageRequest(started, seeded.publicRestaurantId),
        context,
      ),
      (error) => assertContractError(error, "not-found"),
    );
  });
});

test("restaurant page returns exactly 25 safe DTOs from a 26-row lookahead", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  for (let index = 0; index < 26; index += 1) {
    addReadyRestaurant(database, session, index);
  }

  const response = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assertExactKeys(response, [
    "schemaVersion",
    "state",
    "attemptGeneration",
    "queryFingerprint",
    "restaurants",
    "nextCursor",
    "hasMore",
    "partial",
  ]);
  assert.equal(response.restaurants.length, 25);
  assert.equal(response.hasMore, true);
  assert.equal(response.partial, false);
  assert.match(response.nextCursor, /^bsc1\.[A-Za-z0-9_-]+$/u);
  assert.equal(database.calls.queryDocuments.at(-1).limit, 26);
  assertNoPrivateCanaries(response);
  for (const restaurant of response.restaurants) {
    assertExactKeys(restaurant, [
      "restaurantId",
      "displayName",
      "streetAddress",
      "city",
      "state",
      "zipCode",
      "formattedAddress",
      "imageUrl",
      "phone",
      "website",
      "businessHours",
      "bio",
      "distanceMiles",
      "isLocal",
      "catalogBindingAvailable",
      "offers",
      "hasMoreOffers",
      "usableOfferCount",
      "offerCountState",
      "favoriteState",
    ]);
    assert.equal(restaurant.offers.length, 2);
    assert.deepEqual(restaurant.offers.map((offer) => offer.offerType), [
      "dailySpecial",
      "coupon",
    ]);
    for (const offer of restaurant.offers) {
      assertExactKeys(offer, publicOfferKeys);
      assert.match(offer.offerId, /^bso_[A-Za-z0-9_-]{43}$/u);
      assert.match(offer.offerOccurrence, /^bsoc1\.[A-Za-z0-9_-]+$/u);
      assert.equal(Object.hasOwn(offer, "sourceDocumentId"), false);
      assert.equal(Object.hasOwn(offer, "sourceFingerprint"), false);
    }
  }

  const rawOfferReads = database.calls.getDocuments
    .flat()
    .filter((path) => /\/\b(?:coupons|daily_specials)\//u.test(path));
  assert.ok(
    rawOfferReads.length <= 75,
    `normal 25-card page read ${rawOfferReads.length} current offers`,
  );

  const last = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {
      clientRequestId: "page-request-00002",
      cursor: response.nextCursor,
    }),
    context,
  );
  assert.equal(last.restaurants.length, 1);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextCursor, null);
  assert.equal(last.partial, false);
  assert.equal(
    new Set([...response.restaurants, ...last.restaurants].map((entry) =>
      entry.restaurantId)).size,
    26,
  );
});

test("page retries freeze evaluation time and return byte-stable opaque tokens", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  let clock = nowMs;
  const context = createContext(database, {now: () => clock});
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const firstRestaurant = addReadyRestaurant(database, session, 0, {
    offerCount: 30,
  });
  for (let index = 1; index < 26; index += 1) {
    addReadyRestaurant(database, session, index);
  }
  const restaurantRequest = pageRequest(started, {
    clientRequestId: "stable-restaurant-page-0001",
  });
  const firstRestaurantPage = await getCustomerBiteSaverSearchPageHandler(
    restaurantRequest,
    context,
  );
  clock += 30_000;
  assert.deepEqual(
    await getCustomerBiteSaverSearchPageHandler(restaurantRequest, context),
    firstRestaurantPage,
  );

  const offerRequest = offerPageRequest(
    started,
    firstRestaurant.publicRestaurantId,
    {clientRequestId: "stable-offer-page-000001"},
  );
  const firstOfferPage = await getCustomerBiteSaverOfferPageHandler(
    offerRequest,
    context,
  );
  clock += 30_000;
  assert.deepEqual(
    await getCustomerBiteSaverOfferPageHandler(offerRequest, context),
    firstOfferPage,
  );

});

test("signed identical page replay expires with returned timed offers", async (t) => {
  const evaluationAtMs = Date.parse("2026-09-09T12:00:00.000Z");
  const eligibilityDeadlineMs = Date.parse("2026-09-09T12:03:00.000Z");
  assert.equal(evaluationAtMs, nowMs);

  for (const pageType of ["restaurantPage", "offerPage"]) {
    await t.test(pageType, async () => {
      const database = new InMemoryCustomerBiteSaverSearchDatabase();
      let clock = evaluationAtMs;
      const context = createContext(database, {now: () => clock});
      const started = await startCustomerBiteSaverSearchHandler(
        startRequest({
          clientRequestId: `signed-deadline-${pageType}-start-0001`,
          searchText: "",
        }),
        context,
      );
      const session = markSessionReady(database, started);
      const seeded = addReadyRestaurant(database, session, 0, {
        offerCount: 1,
        offerTypeForIndex: () => "dailySpecial",
        offerOverrides: {
          availabilityMode: "specificDays",
          daysOfWeek: [3],
          allDay: false,
          startTime: "08:00",
          endTime: "08:02",
          hideWhenUnavailable: true,
        },
      });
      const clientRequestId =
        `signed-deadline-${pageType}-page-0001`;
      const request = pageType === "restaurantPage"
        ? pageRequest(started, {clientRequestId})
        : offerPageRequest(started, seeded.publicRestaurantId, {
            clientRequestId,
          });
      const invoke = () => pageType === "restaurantPage"
        ? getCustomerBiteSaverSearchPageHandler(request, context)
        : getCustomerBiteSaverOfferPageHandler(request, context);
      const returnedOffers = (response) => pageType === "restaurantPage"
        ? response.restaurants.flatMap((restaurant) => restaurant.offers)
        : response.offers;
      const sourcePaths = [
        `restaurant_accounts/${seeded.accountId}`,
        `restaurant_accounts/${seeded.accountId}/daily_specials/${
          seeded.daily[0].sourceDocumentId}`,
        `${restaurantSearchIndexCollection}/${
          seeded.restaurantProjection.indexDocumentId}`,
        `${biteSaverOfferIndexCollection}/${seeded.daily[0].indexDocumentId}`,
        seeded.resultPath,
      ];
      const sourceBefore = sourcePaths.map((path) =>
        [path, structuredClone(database.documents.get(path))]);

      const original = await invoke();
      const originalOffers = returnedOffers(original);
      assert.equal(originalOffers.length, 1);
      assert.equal(originalOffers[0].available, true);
      assert.equal(originalOffers[0].availabilityReason, "available");
      assert.equal(originalOffers[0].offerType, "dailySpecial");
      if (pageType === "restaurantPage") {
        assert.deepEqual({
          restaurantId: original.restaurants[0].restaurantId,
          hasMoreOffers: original.restaurants[0].hasMoreOffers,
          usableOfferCount: original.restaurants[0].usableOfferCount,
          offerCountState: original.restaurants[0].offerCountState,
          pageHasMore: original.hasMore,
        }, {
          restaurantId: seeded.publicRestaurantId,
          hasMoreOffers: false,
          usableOfferCount: 1,
          offerCountState: "current",
          pageHasMore: false,
        });
      } else {
        assert.equal(original.hasMore, false);
      }
      const occurrence = new CustomerBiteSaverOfferOccurrenceCodec({
        key: secretKey,
        now: () => evaluationAtMs,
      }).open(originalOffers[0].offerOccurrence);
      assert.equal(occurrence.availabilityAtMs, evaluationAtMs);
      assert.equal(occurrence.offerPublicId, originalOffers[0].offerId);

      clock = eligibilityDeadlineMs - 1;
      assert.deepEqual(await invoke(), original);

      clock = eligibilityDeadlineMs;
      const expiredReplay = await invoke().then(
        (response) => ({response, error: null}),
        (error) => ({response: null, error}),
      );
      const freshRequest = pageType === "restaurantPage"
        ? pageRequest(started, {
            clientRequestId:
              `signed-deadline-${pageType}-fresh-0002`,
          })
        : offerPageRequest(started, seeded.publicRestaurantId, {
            clientRequestId:
              `signed-deadline-${pageType}-fresh-0002`,
          });
      const fresh = pageType === "restaurantPage"
        ? await getCustomerBiteSaverSearchPageHandler(freshRequest, context)
        : await getCustomerBiteSaverOfferPageHandler(freshRequest, context);
      assert.deepEqual(returnedOffers(fresh), []);
      if (pageType === "restaurantPage") {
        assert.deepEqual(fresh.restaurants, []);
        assert.equal(fresh.hasMore, false);
      } else {
        assert.equal(fresh.hasMore, false);
      }
      assert.deepEqual(
        sourcePaths.map((path) =>
          [path, structuredClone(database.documents.get(path))]),
        sourceBefore,
      );

      const originalReplay = [...database.documents.values()].find(
        (document) => document.role === "requestReplay" &&
          document.purpose === pageType &&
          document.evaluationAt?.getTime() === evaluationAtMs,
      );
      assert.notEqual(originalReplay, undefined);
      if (expiredReplay.error === null) {
        const staleOffers = returnedOffers(expiredReplay.response);
        assert.fail(JSON.stringify({
          pageType,
          originalEvaluationAtMs: evaluationAtMs,
          replayRequestAtMs: clock,
          eligibilityDeadlineMs,
          replayLogicalExpiresAtMs:
            originalReplay.logicalExpiresAt.getTime(),
          restaurantIds: pageType === "restaurantPage"
            ? expiredReplay.response.restaurants.map((entry) =>
                entry.restaurantId)
            : [seeded.publicRestaurantId],
          offerIds: staleOffers.map((offer) => offer.offerId),
          occurrencesReissued: staleOffers.map((offer) =>
            offer.offerOccurrence === originalOffers[0].offerOccurrence),
          freshOfferIds: returnedOffers(fresh).map((offer) => offer.offerId),
        }));
      }
      assert.equal(
        assertContractError(expiredReplay.error, "failed-precondition"),
        true,
      );
      assert.equal(
        expiredReplay.error.message,
        "The BiteSaver page request replay has expired.",
      );
      assert.equal(
        originalReplay.logicalExpiresAt.getTime(),
        eligibilityDeadlineMs,
      );
    });
  }
});

test("signed page replay deadline matrix retains its anchor and rejects stale issuance", async (t) => {
  const scenarios = [
    {
      slug: "window",
      evaluationAtMs: Date.parse("2026-09-09T12:00:00.000Z"),
      deadlineMs: Date.parse("2026-09-09T12:03:00.000Z"),
      utcOffsetMinutes: -240,
      offerOverrides: {
        availabilityMode: "specificDays",
        daysOfWeek: [3],
        allDay: false,
        startTime: "08:00",
        endTime: "08:02",
        hideWhenUnavailable: true,
      },
    },
    {
      slug: "window-visible-when-unavailable",
      evaluationAtMs: Date.parse("2026-09-09T12:00:00.000Z"),
      deadlineMs: Date.parse("2026-09-09T12:03:00.000Z"),
      utcOffsetMinutes: -240,
      freshVisible: true,
      offerOverrides: {
        availabilityMode: "specificDays",
        daysOfWeek: [3],
        allDay: false,
        startTime: "08:00",
        endTime: "08:02",
        hideWhenUnavailable: false,
      },
    },
    {
      slug: "specific-day",
      evaluationAtMs: Date.parse("2026-09-10T03:58:00.000Z"),
      deadlineMs: Date.parse("2026-09-10T04:00:00.000Z"),
      utcOffsetMinutes: -240,
      offerOverrides: {
        availabilityMode: "specificDays",
        daysOfWeek: [3],
        allDay: true,
        hideWhenUnavailable: true,
      },
    },
    {
      slug: "today-only",
      evaluationAtMs: Date.parse("2026-09-10T03:58:00.000Z"),
      deadlineMs: Date.parse("2026-09-10T04:00:00.000Z"),
      utcOffsetMinutes: -240,
      offerOverrides: {
        availabilityMode: "todayOnly",
        allDay: true,
        expiresAt: null,
        createdAt: new Date("2026-09-10T03:00:00.000Z"),
        updatedAt: new Date("2026-09-10T03:00:00.000Z"),
        hideWhenUnavailable: true,
      },
    },
    {
      slug: "fall-back",
      evaluationAtMs: Date.parse("2026-11-01T05:45:00.000Z"),
      deadlineMs: Date.parse("2026-11-01T06:00:00.000Z"),
      utcOffsetMinutes: -240,
      offerOverrides: {
        availabilityMode: "specificDays",
        daysOfWeek: [7],
        allDay: false,
        startTime: "01:30",
        endTime: "02:30",
        hideWhenUnavailable: true,
      },
    },
  ];

  async function fixture(pageType, scenario, options = {}) {
    const database = new InMemoryCustomerBiteSaverSearchDatabase();
    let clock = scenario.evaluationAtMs;
    const context = createContext(database, {now: () => clock});
    const started = await startCustomerBiteSaverSearchHandler(
      startRequest({
        clientRequestId:
          `signed-matrix-${pageType}-${scenario.slug}-start-0001`,
        searchText: "",
        utcOffsetMinutes: scenario.utcOffsetMinutes,
      }),
      context,
    );
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0, {
      offerCount: options.offerCount ?? 1,
      onlyCoupons: options.onlyCoupons,
      offerTypeForIndex: options.offerTypeForIndex ??
        (() => "dailySpecial"),
      offerOverrides: scenario.offerOverrides,
      offerOverridesForIndex: options.offerOverridesForIndex,
      offerProjectionNowMs: scenario.evaluationAtMs,
      resultCreatedAtMs: scenario.evaluationAtMs,
    });
    const clientRequestId =
      `signed-matrix-${pageType}-${scenario.slug}-page-0001`;
    const request = pageType === "restaurantPage"
      ? pageRequest(started, {clientRequestId})
      : offerPageRequest(started, seeded.publicRestaurantId, {
          clientRequestId,
        });
    const invoke = (pageRequestValue = request) =>
      pageType === "restaurantPage"
        ? getCustomerBiteSaverSearchPageHandler(pageRequestValue, context)
        : getCustomerBiteSaverOfferPageHandler(pageRequestValue, context);
    const offers = (response) => pageType === "restaurantPage"
      ? response.restaurants.flatMap((restaurant) => restaurant.offers)
      : response.offers;
    const sourcePaths = [
      `restaurant_accounts/${seeded.accountId}`,
      `${restaurantSearchIndexCollection}/${
        seeded.restaurantProjection.indexDocumentId}`,
      seeded.resultPath,
      ...[...seeded.daily, ...seeded.coupons].flatMap((candidate) => [
        `restaurant_accounts/${seeded.accountId}/${
          candidate.offerType === "coupon" ? "coupons" : "daily_specials"}/${
          candidate.sourceDocumentId}`,
        `${biteSaverOfferIndexCollection}/${candidate.indexDocumentId}`,
      ]),
    ];
    const sourceState = () => sourcePaths.map((path) =>
      [path, structuredClone(database.documents.get(path))]);
    const issuanceState = () => JSON.stringify(
      [...database.documents.entries()]
        .filter(([, document]) =>
          document.role === "deliveredRestaurantIdentity" ||
          document.role === "deliveredOfferIdentity")
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    return {
      database,
      context,
      started,
      session,
      seeded,
      request,
      invoke,
      offers,
      sourceState,
      issuanceState,
      setClock(value) {
        clock = value;
      },
    };
  }

  for (const pageType of ["restaurantPage", "offerPage"]) {
    for (const scenario of scenarios) {
      await t.test(`${pageType}: ${scenario.slug}`, async () => {
        const value = await fixture(pageType, scenario);
        const sourceBefore = value.sourceState();
        // Treat the first successful result as a response lost after the final
        // issuance transaction. The identical retry must reconstruct it only
        // while its original positive authorization is still live.
        const lostTransportError = new Error("signed page response lost");
        let lostResponse;
        await assert.rejects(
          async () => {
            lostResponse = await value.invoke();
            throw lostTransportError;
          },
          (error) => error === lostTransportError,
        );
        assert.notEqual(lostResponse, undefined);
        const originalOffers = value.offers(lostResponse);
        assert.equal(originalOffers.length, 1);
        assert.equal(originalOffers[0].available, true);
        assert.equal(originalOffers[0].availabilityReason, "available");
        const occurrence = new CustomerBiteSaverOfferOccurrenceCodec({
          key: secretKey,
          now: () => scenario.evaluationAtMs,
        }).open(originalOffers[0].offerOccurrence);
        assert.equal(occurrence.availabilityAtMs, scenario.evaluationAtMs);
        assert.equal(occurrence.offerPublicId, originalOffers[0].offerId);

        value.setClock(scenario.deadlineMs - 1);
        assert.deepEqual(await value.invoke(), lostResponse);
        const issuanceBeforeExpiry = value.issuanceState();

        for (const replayAtMs of [
          scenario.deadlineMs,
          scenario.deadlineMs + 1,
          scenario.deadlineMs + 2,
        ]) {
          value.setClock(replayAtMs);
          await assert.rejects(
            value.invoke(),
            (error) => assertContractError(error, "failed-precondition") &&
              error.message ===
                "The BiteSaver page request replay has expired.",
          );
          assert.equal(value.issuanceState(), issuanceBeforeExpiry);
        }

        const originalReplay = [...value.database.documents.values()].find(
          (document) => document.role === "requestReplay" &&
            document.purpose === pageType &&
            document.evaluationAt?.getTime() === scenario.evaluationAtMs,
        );
        assert.notEqual(originalReplay, undefined);
        assert.equal(
          originalReplay.evaluationAt.getTime(),
          scenario.evaluationAtMs,
        );
        assert.equal(
          originalReplay.logicalExpiresAt.getTime(),
          scenario.deadlineMs,
        );
        assert.equal(
          originalReplay.expiresAt.getTime(),
          value.session.absoluteExpiresAt.getTime(),
        );

        value.setClock(scenario.deadlineMs + 1);
        const freshRequest = pageType === "restaurantPage"
          ? pageRequest(value.started, {
              clientRequestId:
                `signed-matrix-${pageType}-${scenario.slug}-fresh-0002`,
            })
          : offerPageRequest(
              value.started,
              value.seeded.publicRestaurantId,
              {
                clientRequestId:
                  `signed-matrix-${pageType}-${scenario.slug}-fresh-0002`,
              },
            );
        const fresh = await value.invoke(freshRequest);
        const freshOffers = value.offers(fresh);
        if (scenario.freshVisible === true) {
          assert.deepEqual(
            freshOffers.map((offer) => ({
              offerId: offer.offerId,
              available: offer.available,
              availabilityReason: offer.availabilityReason,
            })),
            [{
              offerId: originalOffers[0].offerId,
              available: false,
              availabilityReason: "outsideTimeWindow",
            }],
          );
          if (pageType === "restaurantPage") {
            assert.equal(fresh.restaurants.length, 1);
          }
        } else {
          assert.deepEqual(freshOffers, []);
          if (pageType === "restaurantPage") {
            assert.deepEqual(fresh.restaurants, []);
          }
        }
        assert.equal(fresh.hasMore, false);
        assert.deepEqual(value.sourceState(), sourceBefore);
      });
    }
  }

  for (const pageType of ["restaurantPage", "offerPage"]) {
    await t.test(`${pageType}: cutoff crossed during final replay read`, async () => {
      const scenario = scenarios[0];
      const value = await fixture(pageType, scenario);
      const sourceBefore = value.sourceState();
      let replayReads = 0;
      value.database.onTransactionGetDocument = (path) => {
        if (path.startsWith(
          `${privateCustomerBiteSaverActiveSessionCollection}/bsrqr_`,
        )) {
          replayReads += 1;
          if (replayReads === 2) {
            value.setClock(scenario.deadlineMs);
          }
        }
      };
      await assert.rejects(
        value.invoke(),
        (error) => assertContractError(error, "failed-precondition") &&
          error.message === "The BiteSaver page request replay has expired.",
      );
      assert.equal(replayReads, 2);
      assert.equal(value.issuanceState(), "[]");
      const replay = [...value.database.documents.values()].find(
        (document) => document.role === "requestReplay" &&
          document.purpose === pageType,
      );
      assert.notEqual(replay, undefined);
      assert.equal(replay.evaluationAt.getTime(), scenario.evaluationAtMs);
      assert.equal(replay.logicalExpiresAt.getTime(), scenario.deadlineMs);
      assert.deepEqual(value.sourceState(), sourceBefore);
    });
  }

  for (const pageType of ["restaurantPage", "offerPage"]) {
    await t.test(`${pageType}: earlier metadata witness deadline`, async () => {
      const evaluationAtMs = Date.parse("2026-09-09T12:00:00.000Z");
      const deadlineMs = Date.parse("2026-09-09T12:03:00.000Z");
      const scenario = {
        slug: "witness",
        evaluationAtMs,
        deadlineMs,
        utcOffsetMinutes: -240,
        offerOverrides: {},
      };
      const offerCount = pageType === "restaurantPage" ? 3 : 26;
      const value = await fixture(pageType, scenario, {
        offerCount,
        onlyCoupons: true,
        offerTypeForIndex: () => "coupon",
        offerOverridesForIndex: (index) => index === offerCount - 1
          ? {endTime: new Date(deadlineMs - 1)}
          : {},
      });
      const sourceBefore = value.sourceState();
      const first = await value.invoke();
      const displayedIds = value.offers(first).map((offer) => offer.offerId);
      assert.equal(
        displayedIds.length,
        pageType === "restaurantPage" ? 2 : customerBiteSaverPageSize,
      );
      assert.equal(first.hasMore, pageType === "offerPage");
      if (pageType === "restaurantPage") {
        assert.equal(first.restaurants[0].hasMoreOffers, true);
        assert.equal(first.restaurants[0].usableOfferCount, null);
        assert.equal(first.restaurants[0].offerCountState, "unknown");
      }
      const expiringWitnessId = opaqueOfferId(
        value.seeded,
        value.seeded.coupons[offerCount - 1],
      );
      assert.equal(displayedIds.includes(expiringWitnessId), false);
      const replay = [...value.database.documents.values()].find(
        (document) => document.role === "requestReplay" &&
          document.purpose === pageType,
      );
      assert.notEqual(replay, undefined);
      assert.equal(replay.logicalExpiresAt.getTime(), deadlineMs);

      const issuanceBeforeExpiry = value.issuanceState();
      value.setClock(deadlineMs);
      await assert.rejects(
        value.invoke(),
        (error) => assertContractError(error, "failed-precondition") &&
          error.message === "The BiteSaver page request replay has expired.",
      );
      assert.equal(value.issuanceState(), issuanceBeforeExpiry);

      const freshRequest = pageType === "restaurantPage"
        ? pageRequest(value.started, {
            clientRequestId:
              `signed-matrix-${pageType}-witness-fresh-0002`,
          })
        : offerPageRequest(value.started, value.seeded.publicRestaurantId, {
            clientRequestId:
              `signed-matrix-${pageType}-witness-fresh-0002`,
          });
      const fresh = await value.invoke(freshRequest);
      assert.deepEqual(
        value.offers(fresh).map((offer) => offer.offerId),
        displayedIds,
      );
      assert.equal(fresh.hasMore, false);
      if (pageType === "restaurantPage") {
        assert.equal(fresh.restaurants[0].hasMoreOffers, false);
        assert.equal(fresh.restaurants[0].usableOfferCount, 2);
      }
      assert.deepEqual(value.sourceState(), sourceBefore);
    });
  }
});

test("cursor request bindings fail before any database access", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const first = addReadyRestaurant(database, session, 0, {offerCount: 30});
  for (let index = 1; index < 26; index += 1) {
    addReadyRestaurant(database, session, index);
  }
  const restaurantPage = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  const offerPage = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, first.publicRestaurantId),
    context,
  );
  assert.match(restaurantPage.nextCursor, /^bsc1\./u);
  assert.match(offerPage.nextCursor, /^bsc1\./u);
  const tampered = restaurantPage.nextCursor.slice(0, -1) +
    (restaurantPage.nextCursor.endsWith("A") ? "B" : "A");
  const wrongSessionId = `bss_${Buffer.alloc(32, 41).toString("base64url")}`;
  const wrongRestaurantId = customerBiteSaverOpaqueRestaurantId(
    secretKey,
    "cursor-wrong-restaurant",
  );
  const cases = [
    () => getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "cursor-preflight-tamper-0001",
        cursor: tampered,
      }),
      context,
    ),
    () => getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "cursor-preflight-purpose-0001",
        cursor: offerPage.nextCursor,
      }),
      context,
    ),
    () => getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "cursor-preflight-session-0001",
        sessionId: wrongSessionId,
        cursor: restaurantPage.nextCursor,
      }),
      context,
    ),
    () => getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "cursor-preflight-caller-00001",
        clientInstanceId: "different-client-instance-0001",
        cursor: restaurantPage.nextCursor,
      }),
      context,
    ),
    () => getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, wrongRestaurantId, {
        clientRequestId: "cursor-preflight-restaurant-01",
        cursor: offerPage.nextCursor,
      }),
      context,
    ),
  ];
  for (const invoke of cases) {
    const before = databaseCallCounts(database);
    await assert.rejects(
      invoke(),
      (error) => assertContractError(error, "invalid-argument"),
    );
    assert.deepEqual(databaseCallCounts(database), before);
  }
});

test("restaurant page does not advertise a continuation after consuming its exact final lookahead", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  addUnavailableResult(database, session, 0);
  for (let index = 1; index < 26; index += 1) {
    addReadyRestaurant(database, session, index);
  }

  const response = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.equal(response.restaurants.length, 25);
  assert.equal(response.hasMore, false);
  assert.equal(response.nextCursor, null);
  assert.equal(response.partial, false);
  const membershipQueries = database.calls.queryDocuments.filter((query) =>
    query.collectionPath === privateCustomerBiteSaverResultCollection);
  assert.equal(membershipQueries.length, 2);
  assert.deepEqual(membershipQueries.map((query) => query.limit), [26, 1]);
});

test("signed restaurant continuation requires a usable witness after item 25", async (t) => {
  async function fixture(total, withdrawnIndexes) {
    const startedState = await startSession(undefined, {
      request: {searchText: ""},
    });
    const session = markSessionReady(
      startedState.database,
      startedState.response,
    );
    const seeded = Array.from({length: total}, (_, index) =>
      addReadyRestaurant(startedState.database, session, index, {
        offerCount: 1,
        onlyCoupons: true,
      }));
    for (const index of withdrawnIndexes) {
      startedState.database.documents.delete(
        `restaurant_accounts/${seeded[index].accountId}`,
      );
    }
    return {...startedState, seeded};
  }

  await t.test("exactly 25 usable rows exhaust", async () => {
    const {database, context, response: started} = await fixture(25, []);
    const page = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {clientRequestId: "restaurant-exact-25-0001"}),
      context,
    );
    assert.equal(page.restaurants.length, 25);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
    assert.equal(page.partial, false);
    assert.ok(database.calls.queryDocuments.every((query) => query.limit <= 26));
  });

  await t.test("an unavailable final 26th row is exhaustion", async () => {
    const {context, response: started} = await fixture(26, [25]);
    const page = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {clientRequestId: "restaurant-invalid-26-0001"}),
      context,
    );
    assert.equal(page.restaurants.length, 25);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
    assert.equal(page.partial, false);
  });

  await t.test("the usable 27th row is preserved for the next page", async () => {
    const {database, context, response: started, seeded} =
      await fixture(27, [25]);
    const request = pageRequest(started, {
      clientRequestId: "restaurant-witness-27-0001",
    });
    const first = await getCustomerBiteSaverSearchPageHandler(request, context);
    assert.equal(first.restaurants.length, 25);
    assert.equal(first.hasMore, true);
    assert.equal(first.partial, false);
    assert.match(first.nextCursor, /^bsc1\./u);
    const retry = await getCustomerBiteSaverSearchPageHandler(request, context);
    assert.deepEqual(retry, first);

    const second = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "restaurant-witness-27-0002",
        cursor: first.nextCursor,
      }),
      context,
    );
    assert.deepEqual(
      second.restaurants.map((entry) => entry.restaurantId),
      [seeded[26].publicRestaurantId],
    );
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
    const allIds = [...first.restaurants, ...second.restaurants]
      .map((entry) => entry.restaurantId);
    assert.equal(new Set(allIds).size, 26);
    assert.equal(allIds.includes(seeded[25].publicRestaurantId), false);
    assert.ok(database.calls.queryDocuments.every((query) => query.limit <= 26));
  });

  await t.test("several rejected lookahead rows precede the witness", async () => {
    const {context, response: started, seeded} = await fixture(
      31,
      [25, 26, 27, 28, 29],
    );
    const first = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {clientRequestId: "restaurant-rejects-0001"}),
      context,
    );
    assert.equal(first.restaurants.length, 25);
    assert.equal(first.hasMore, true);
    assert.equal(first.partial, false);
    const second = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "restaurant-rejects-0002",
        cursor: first.nextCursor,
      }),
      context,
    );
    assert.deepEqual(
      second.restaurants.map((entry) => entry.restaurantId),
      [seeded[30].publicRestaurantId],
    );
  });

  await t.test("100 consumed rows retain unresolved progress", async () => {
    const rejected = Array.from({length: 75}, (_, index) => index + 25);
    const {database, context, response: started, seeded} =
      await fixture(101, rejected);
    const firstRequest = pageRequest(started, {
      clientRequestId: "restaurant-budget-witness-0001",
    });
    const partial = await getCustomerBiteSaverSearchPageHandler(
      firstRequest,
      context,
    );
    assert.equal(partial.restaurants.length, 25);
    assert.equal(partial.hasMore, true);
    assert.equal(partial.partial, true);
    assert.match(partial.nextCursor, /^bsc1\./u);
    assert.deepEqual(
      await getCustomerBiteSaverSearchPageHandler(firstRequest, context),
      partial,
    );
    const continued = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "restaurant-budget-witness-0002",
        cursor: partial.nextCursor,
      }),
      context,
    );
    assert.deepEqual(
      continued.restaurants.map((entry) => entry.restaurantId),
      [seeded[100].publicRestaurantId],
    );
    assert.equal(continued.hasMore, false);
    assert.equal(continued.partial, false);
    assert.ok(database.calls.queryDocuments.every((query) => query.limit <= 26));
  });
});

test("restaurant preview backfills past signed usage", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 3,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  for (const candidate of seeded.coupons.slice(0, 2)) {
    database.documents.set(
      `customer_redemptions/${defaultSignedUid}/coupon_redemptions/${candidate.sourceDocumentId}`,
      {
        restaurantAccountId: seeded.accountId,
        couponId: candidate.sourceDocumentId,
        lastRedeemedAt: new Date(nowMs - 1_000),
      },
    );
  }
  const expectedOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[2].sourceDocumentId,
  );

  const response = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.equal(response.restaurants.length, 1);
  assert.deepEqual(
    response.restaurants[0].offers.map((offer) => offer.offerId),
    [expectedOfferId],
  );
  assert.equal(response.restaurants[0].hasMoreOffers, false);
  assert.equal(response.restaurants[0].usableOfferCount, 1);
  assert.equal(response.restaurants[0].offerCountState, "current");
  const rawOfferReads = database.calls.getDocuments
    .flat()
    .filter((path) => /\/\b(?:coupons|daily_specials)\//u.test(path));
  assert.equal(rawOfferReads.length, 3);
  assert.ok(rawOfferReads.length <= 100);
});

test("restaurant preview proves hasMore from the current third offer", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const available = addReadyRestaurant(database, session, 0, {
    offerCount: 3,
    onlyCoupons: true,
  });
  const withdrawn = addReadyRestaurant(database, session, 1, {
    offerCount: 3,
    onlyCoupons: true,
  });
  database.documents.delete(
    `restaurant_accounts/${withdrawn.accountId}/coupons/${withdrawn.coupons[2].sourceDocumentId}`,
  );

  const page = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  const byId = new Map(page.restaurants.map((entry) => [
    entry.restaurantId,
    entry,
  ]));
  assert.equal(byId.get(available.publicRestaurantId).offers.length, 2);
  assert.equal(byId.get(available.publicRestaurantId).hasMoreOffers, true);
  assert.equal(byId.get(withdrawn.publicRestaurantId).offers.length, 2);
  assert.equal(byId.get(withdrawn.publicRestaurantId).hasMoreOffers, false);
});

test("restaurant preview discovers a third offer that became available after preparation", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 3,
    onlyCoupons: true,
  });
  const third = seeded.coupons[2];
  const thirdPath =
    `restaurant_accounts/${seeded.accountId}/coupons/${third.sourceDocumentId}`;
  const scheduledRaw = {
    ...database.documents.get(thirdPath),
    startTime: new Date(nowMs),
  };
  const scheduledProjection = buildBiteSaverCouponOfferIndex({
    restaurantAccountId: seeded.accountId,
    sourceDocumentId: third.sourceDocumentId,
    offer: scheduledRaw,
    restaurant: seeded.restaurant,
    now: new Date(nowMs - 1),
  });
  assert.notEqual(scheduledProjection, null);
  database.documents.set(thirdPath, scheduledRaw);
  database.documents.set(
    `${biteSaverOfferIndexCollection}/${scheduledProjection.indexDocumentId}`,
    scheduledProjection,
  );
  database.documents.set(seeded.resultPath, {
    ...seeded.result,
    previewCouponCandidates: seeded.coupons.slice(0, 2),
    usableOfferCountAtPreparation: 2,
  });

  const page = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.equal(page.restaurants.length, 1);
  assert.equal(page.restaurants[0].offers.length, 2);
  assert.equal(page.restaurants[0].hasMoreOffers, true);
  assert.equal(page.restaurants[0].usableOfferCount, 3);
  assert.equal(page.restaurants[0].offerCountState, "current");
  const rawOfferReads = database.calls.getDocuments
    .flat()
    .filter((path) => /\/\b(?:coupons|daily_specials)\//u.test(path));
  // Two prepared candidates, the newly-current third candidate, and one final
  // fence covering both delivered offers plus the hasMore witness.
  assert.equal(rawOfferReads.length, 6);

  let thirdReads = 0;
  database.failGetDocumentsWhen = (paths) => {
    if (paths.includes(thirdPath)) {
      thirdReads += 1;
      if (thirdReads === 2) {
        database.documents.delete(thirdPath);
      }
    }
    return false;
  };
  await assert.rejects(
    getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "preview-third-witness-fence-0002",
      }),
      context,
    ),
    (error) => assertContractError(error, "failed-precondition"),
  );
  assert.equal(thirdReads, 2);
});

test("restaurant preview live fallback reaches beyond retained candidates", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 51,
    onlyCoupons: true,
  });
  for (const candidate of seeded.coupons.slice(0, 50)) {
    database.documents.delete(
      `restaurant_accounts/${seeded.accountId}/coupons/${candidate.sourceDocumentId}`,
    );
  }
  const expectedOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[50].sourceDocumentId,
  );

  const response = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.equal(response.restaurants.length, 1);
  assert.deepEqual(
    response.restaurants[0].offers.map((offer) => offer.offerId),
    [expectedOfferId],
  );
  assert.equal(response.restaurants[0].hasMoreOffers, false);
  assert.equal(response.restaurants[0].usableOfferCount, 1);
  assert.equal(response.restaurants[0].offerCountState, "current");
  const rawOfferReads = database.calls.getDocuments
    .flat()
    .filter((path) => /\/\b(?:coupons|daily_specials)\//u.test(path));
  // Fifty-one candidates are scanned, then the delivered offer receives one
  // final coherent source/usage fence because fallback crossed snapshots.
  assert.equal(rawOfferReads.length, 52);
  assert.ok(rawOfferReads.length <= 101);
});

test("preview fallback proves exact 100-candidate exhaustion", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 100,
    onlyCoupons: true,
  });
  for (const candidate of seeded.coupons) {
    database.documents.delete(
      `restaurant_accounts/${seeded.accountId}/coupons/${candidate.sourceDocumentId}`,
    );
  }

  const page = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.deepEqual(page.restaurants, []);
  assert.equal(page.partial, false);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
  const liveQueries = database.calls.queryDocuments.filter((query) =>
    query.collectionPath === biteSaverOfferIndexCollection);
  assert.deepEqual(liveQueries.map((query) => query.limit), [
    26, 26, 26, 22, 1,
  ]);
});

test("restaurant preview work shares one 100-candidate page budget", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const first = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
  });
  const second = addReadyRestaurant(database, session, 1, {
    offerCount: 101,
    onlyCoupons: true,
  });
  const third = addReadyRestaurant(database, session, 2, {
    offerCount: 1,
    onlyCoupons: true,
  });
  database.documents.set(
    `restaurant_accounts/${second.accountId}`,
    {
      ...second.restaurant,
      offerCatalogUpdatedAt: new Date(nowMs + 1),
    },
  );

  const partial = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.deepEqual(
    partial.restaurants.map((restaurant) => restaurant.restaurantId),
    [first.publicRestaurantId, second.publicRestaurantId],
  );
  assert.equal(partial.partial, true);
  assert.equal(partial.hasMore, true);
  assert.match(partial.nextCursor, /^bsc1\./u);
  const openedContinuation = new CustomerBiteSaverCursorCodec({
    key: secretKey,
    now: () => nowMs,
  }).open(partial.nextCursor);
  assert.equal(openedContinuation.sortTuple.length, 5);
  assert.match(openedContinuation.sortTuple[4], /^bspc_[A-Za-z0-9_-]{43}$/u);
  const continuation = [...database.documents.values()].find((document) =>
    document.role === "previewContinuation");
  assert.notEqual(continuation, undefined);
  assert.equal(continuation.pendingRestaurantId, third.publicRestaurantId);
  assert.ok(continuation.retainedCandidates.length <= 4);
  const rawOfferReads = database.calls.getDocuments
    .flat()
    .filter((path) => /\/\b(?:coupons|daily_specials)\//u.test(path));
  // The 100 unique-candidate work cap is followed by one bounded final read of
  // the exposed previews plus their hasMore witness.
  assert.equal(rawOfferReads.length, 104);
  const liveQueries = database.calls.queryDocuments.filter((query) =>
    query.collectionPath === biteSaverOfferIndexCollection);
  assert.ok(liveQueries.every((query) => query.limit <= 26));
  assert.equal(liveQueries.at(-2).limit, 20);
  assert.equal(liveQueries.at(-1).limit, 1);

  const liveQueryCountBeforeResume = liveQueries.length;
  const finalPage = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {
      clientRequestId: "preview-continuation-page-0002",
      cursor: partial.nextCursor,
    }),
    context,
  );
  assert.deepEqual(
    finalPage.restaurants.map((restaurant) => restaurant.restaurantId),
    [third.publicRestaurantId],
  );
  assert.equal(finalPage.restaurants[0].hasMoreOffers, false);
  assert.equal(finalPage.restaurants[0].usableOfferCount, null);
  assert.equal(finalPage.restaurants[0].offerCountState, "unknown");
  assert.equal(finalPage.hasMore, false);
  assert.equal(finalPage.nextCursor, null);
  const resumedLiveQueries = database.calls.queryDocuments.filter((query) =>
    query.collectionPath === biteSaverOfferIndexCollection).slice(
    liveQueryCountBeforeResume,
  );
  assert.equal(resumedLiveQueries[0].startAfter, undefined);
});

test("restaurant preview continuation resumes an unresolved first row", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 101,
    onlyCoupons: true,
  });
  for (const candidate of seeded.coupons.slice(0, 100)) {
    database.documents.delete(
      `restaurant_accounts/${seeded.accountId}/coupons/${candidate.sourceDocumentId}`,
    );
  }
  const expectedOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[100].sourceDocumentId,
  );

  const partial = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {clientRequestId: "first-row-preview-page-0001"}),
    context,
  );
  assert.deepEqual(partial.restaurants, []);
  assert.equal(partial.partial, true);
  assert.equal(partial.hasMore, true);
  const opened = new CustomerBiteSaverCursorCodec({
    key: secretKey,
    now: () => nowMs,
  }).open(partial.nextCursor);
  assert.equal(opened.sortTuple.length, 5);

  const continued = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {
      clientRequestId: "first-row-preview-page-0002",
      cursor: partial.nextCursor,
    }),
    context,
  );
  assert.equal(continued.restaurants.length, 1);
  assert.deepEqual(
    continued.restaurants[0].offers.map((offer) => offer.offerId),
    [expectedOfferId],
  );
  assert.equal(continued.hasMore, false);
});

test("restaurant page fences parent catalog changes before delivery", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0);
  const parentPath = `restaurant_accounts/${seeded.accountId}`;
  let parentBatchReads = 0;
  database.failGetDocumentsWhen = (paths) => {
    if (paths.length === 1 && paths[0] === parentPath) {
      parentBatchReads += 1;
      if (parentBatchReads === 2) {
        database.documents.set(parentPath, {
          ...seeded.restaurant,
          offerCatalogUpdatedAt: new Date(nowMs + 1),
        });
      }
    }
    return false;
  };

  await assert.rejects(
    getCustomerBiteSaverSearchPageHandler(pageRequest(started), context),
    (error) => assertContractError(error, "failed-precondition"),
  );
  assert.equal(parentBatchReads, 2);
});

test("multi-snapshot restaurant backfill fences every delivered raw offer", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const first = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
  });
  const fallback = addReadyRestaurant(database, session, 1, {
    offerCount: 51,
    onlyCoupons: true,
  });
  for (const candidate of fallback.coupons.slice(0, 50)) {
    database.documents.delete(
      `restaurant_accounts/${fallback.accountId}/coupons/${candidate.sourceDocumentId}`,
    );
  }
  const firstOfferPath =
    `restaurant_accounts/${first.accountId}/coupons/${first.coupons[0].sourceDocumentId}`;
  let firstOfferReads = 0;
  database.failGetDocumentsWhen = (paths) => {
    if (paths.includes(firstOfferPath)) {
      firstOfferReads += 1;
      if (firstOfferReads === 2) {
        database.documents.delete(firstOfferPath);
      }
    }
    return false;
  };

  await assert.rejects(
    getCustomerBiteSaverSearchPageHandler(pageRequest(started), context),
    (error) => assertContractError(error, "failed-precondition"),
  );
  assert.equal(firstOfferReads, 2);
});

test("restaurant page backfills in immutable order and stops at 100 consumed rows", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const first = addReadyRestaurant(database, session, 0);
  for (let index = 1; index < 100; index += 1) {
    addUnavailableResult(database, session, index);
  }
  const afterBoundary = addReadyRestaurant(database, session, 100);

  const partial = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.deepEqual(
    partial.restaurants.map((entry) => entry.restaurantId),
    [first.publicRestaurantId],
  );
  assert.equal(partial.partial, true);
  assert.equal(partial.hasMore, true);
  assert.match(partial.nextCursor, /^bsc1\./u);
  const membershipQueries = database.calls.queryDocuments.filter((query) =>
    query.collectionPath === privateCustomerBiteSaverResultCollection);
  assert.equal(membershipQueries.length, 5);
  assert.deepEqual(membershipQueries.map((query) => query.limit), [
    26, 26, 26, 22, 1,
  ]);
  const parentReadBatches = database.calls.getDocuments
    .map((paths) => paths.filter((path) =>
      /^restaurant_accounts\/[^/]+$/u.test(path)))
    .filter((paths) => paths.length > 0);
  assert.deepEqual(parentReadBatches.map((paths) => paths.length), [
    26,
    1,
    26,
    26,
    22,
    1,
  ]);

  const continued = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {
      clientRequestId: "page-request-00002",
      cursor: partial.nextCursor,
    }),
    context,
  );
  assert.deepEqual(
    continued.restaurants.map((entry) => entry.restaurantId),
    [afterBoundary.publicRestaurantId],
  );
  assert.equal(continued.hasMore, false);
});

test("restaurant page proves exact 100-row exhaustion without a false cursor", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const first = addReadyRestaurant(database, session, 0);
  for (let index = 1; index < 100; index += 1) {
    addUnavailableResult(database, session, index);
  }

  const page = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.deepEqual(
    page.restaurants.map((entry) => entry.restaurantId),
    [first.publicRestaurantId],
  );
  assert.equal(page.partial, false);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
  const membershipQueries = database.calls.queryDocuments.filter((query) =>
    query.collectionPath === privateCustomerBiteSaverResultCollection);
  assert.deepEqual(membershipQueries.map((query) => query.limit), [
    26, 26, 26, 22, 1,
  ]);
});

test("per-parent offer query uses exact ordered 26-row pagination", () => {
  const createdAtOrderKey = customerBiteSaverTimestampOrderKey(
    new Date(nowMs),
  );
  const query = customerBiteSaverPerParentOfferQuery({
    authoritativeAccountId: "internal-account-canary",
  });
  assert.deepEqual(query, {
    collectionPath: biteSaverOfferIndexCollection,
    filters: [
      {field: "source", operation: "==", value: "biteSaver"},
      {
        field: "customerOfferProjectionVersion",
        operation: "==",
        value: "bitestar.bitesaver-customer-offer.v2",
      },
      {field: "customerDiscoverable", operation: "==", value: true},
      {
        field: "restaurantAccountId",
        operation: "==",
        value: dartUtf16FirestoreBytesOrderKey("internal-account-canary"),
      },
    ],
    orders: [
      {field: "presentationTypeRank", direction: "asc"},
      {field: "sourceCreatedAtOrderKey", direction: "desc"},
      {field: "sourceDocumentId", direction: "desc"},
    ],
    limit: 26,
  });
  const queryWithCursor = customerBiteSaverPerParentOfferQuery({
    authoritativeAccountId: "internal-account-canary",
    startAfter: [1, createdAtOrderKey, "source-offer-canary"],
  });
  assert.deepEqual(queryWithCursor.startAfter, [
    1,
    createdAtOrderKey,
    "source-offer-canary",
  ]);
  const maximumAccountId = "a".repeat(1_500);
  const maximumQuery = customerBiteSaverPerParentOfferQuery({
    authoritativeAccountId: maximumAccountId,
  });
  const maximumParentFilter = maximumQuery.filters.find(
    (filter) => filter.field === "restaurantAccountId",
  );
  assert.notEqual(maximumParentFilter, undefined);
  assert.equal(maximumParentFilter.value instanceof Uint8Array, true);
  assert.equal(maximumParentFilter.value.byteLength, 1_500);
  assert.equal(
    Buffer.from(maximumParentFilter.value).equals(
      dartUtf16FirestoreBytesOrderKey(maximumAccountId),
    ),
    true,
  );
  assert.throws(
    () => customerBiteSaverPerParentOfferQuery({
      authoritativeAccountId: "a".repeat(1_501),
    }),
    CustomerBiteSaverContractError,
  );
});

test("offer page is strict, parent-bound, ordered, safe, and exactly 25", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {offerCount: 30});
  const request = offerPageRequest(started, seeded.publicRestaurantId);
  for (const invalid of [
    {...request, unexpected: true},
    {...request, restaurantId: "internal-account-canary"},
    {...request, guestStateRevision: -1},
  ]) {
    await assert.rejects(
      getCustomerBiteSaverOfferPageHandler(invalid, context),
      (error) => assertContractError(error, "invalid-argument"),
    );
  }

  const response = await getCustomerBiteSaverOfferPageHandler(request, context);
  assertExactKeys(response, [
    "schemaVersion",
    "restaurantId",
    "offers",
    "nextCursor",
    "hasMore",
    "partial",
  ]);
  assert.equal(response.restaurantId, seeded.publicRestaurantId);
  assert.equal(response.offers.length, 25);
  assert.deepEqual(
    response.offers.slice(0, 15).map((offer) => offer.offerType),
    Array(15).fill("dailySpecial"),
  );
  assert.deepEqual(
    response.offers.slice(15).map((offer) => offer.offerType),
    Array(10).fill("coupon"),
  );
  assert.equal(response.hasMore, true);
  assert.equal(response.partial, false);
  assert.match(response.nextCursor, /^bsc1\./u);
  assert.equal(database.calls.queryDocuments.at(-1).limit, 26);
  assertNoPrivateCanaries(response);
  for (const offer of response.offers) {
    assertExactKeys(offer, publicOfferKeys);
    assert.match(offer.offerId, /^bso_[A-Za-z0-9_-]{43}$/u);
    assert.match(offer.offerOccurrence, /^bsoc1\.[A-Za-z0-9_-]+$/u);
    assert.equal(Object.hasOwn(offer, "sourceDocumentId"), false);
    assert.equal(Object.hasOwn(offer, "restaurantAccountId"), false);
  }

  const finalPage = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "offer-page-request-0002",
      cursor: response.nextCursor,
    }),
    context,
  );
  assert.equal(finalPage.offers.length, 5);
  assert.equal(finalPage.nextCursor, null);
  assert.equal(finalPage.hasMore, false);
  assert.equal(
    new Set([...response.offers, ...finalPage.offers].map((offer) =>
      offer.offerId)).size,
    30,
  );

  database.documents.set(`restaurant_accounts/${seeded.accountId}`, {
    ...seeded.restaurant,
    offerCatalogUpdatedAt: new Date("2026-09-09T11:00:00.001Z"),
  });
  const beforeCatalogMismatch = databaseCallCounts(database);
  const sessionPath =
    `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`;
  const lastAccessBeforeCatalogMismatch =
    database.documents.get(sessionPath).lastAccessAt.getTime();
  await assert.rejects(
    getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "offer-page-request-0003",
        cursor: response.nextCursor,
      }),
      context,
    ),
    (error) => assertContractError(error, "invalid-argument"),
  );
  const afterCatalogMismatch = databaseCallCounts(database);
  assert.equal(
    afterCatalogMismatch.transactions,
    beforeCatalogMismatch.transactions,
  );
  assert.equal(
    afterCatalogMismatch.transactionWrites,
    beforeCatalogMismatch.transactionWrites,
  );
  assert.equal(afterCatalogMismatch.commits, beforeCatalogMismatch.commits);
  assert.equal(
    database.documents.get(sessionPath).lastAccessAt.getTime(),
    lastAccessBeforeCatalogMismatch,
  );

  database.documents.delete(`restaurant_accounts/${seeded.accountId}`);
  await assert.rejects(
    getCustomerBiteSaverOfferPageHandler(request, context),
    (error) => assertContractError(error, "failed-precondition"),
  );
});

test("signed offer continuation requires a usable witness after item 25", async (t) => {
  async function fixture(total, withdrawnIndexes) {
    const startedState = await startSession(undefined, {
      request: {searchText: ""},
    });
    const session = markSessionReady(
      startedState.database,
      startedState.response,
    );
    const seeded = addReadyRestaurant(
      startedState.database,
      session,
      0,
      {offerCount: total, onlyCoupons: true},
    );
    for (const index of withdrawnIndexes) {
      startedState.database.documents.delete(
        `restaurant_accounts/${seeded.accountId}/coupons/` +
          seeded.coupons[index].sourceDocumentId,
      );
    }
    return {...startedState, seeded};
  }

  await t.test("exactly 25 usable rows exhaust", async () => {
    const {database, context, response: started, seeded} =
      await fixture(25, []);
    const page = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "offer-exact-25-0001",
      }),
      context,
    );
    assert.equal(page.offers.length, 25);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
    assert.equal(page.partial, false);
    assert.ok(database.calls.queryDocuments.every((query) => query.limit <= 26));
  });

  await t.test("an unavailable final 26th row is exhaustion", async () => {
    const {context, response: started, seeded} = await fixture(26, [25]);
    const page = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "offer-invalid-26-0001",
      }),
      context,
    );
    assert.equal(page.offers.length, 25);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
    assert.equal(page.partial, false);
  });

  await t.test("the usable 27th row is preserved for the next page", async () => {
    const {database, context, response: started, seeded} =
      await fixture(27, [25]);
    const request = offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "offer-witness-27-0001",
    });
    const first = await getCustomerBiteSaverOfferPageHandler(request, context);
    assert.equal(first.offers.length, 25);
    assert.equal(first.hasMore, true);
    assert.equal(first.partial, false);
    assert.match(first.nextCursor, /^bsc1\./u);
    assert.deepEqual(
      await getCustomerBiteSaverOfferPageHandler(request, context),
      first,
    );

    const second = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "offer-witness-27-0002",
        cursor: first.nextCursor,
      }),
      context,
    );
    const witnessId = opaqueOfferId(seeded, seeded.coupons[26]);
    assert.deepEqual(second.offers.map((entry) => entry.offerId), [witnessId]);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
    const allIds = [...first.offers, ...second.offers]
      .map((entry) => entry.offerId);
    assert.equal(new Set(allIds).size, 26);
    assert.equal(allIds.includes(opaqueOfferId(seeded, seeded.coupons[25])), false);
    assert.ok(database.calls.queryDocuments.every((query) => query.limit <= 26));
  });

  await t.test("several rejected lookahead rows precede the witness", async () => {
    const {context, response: started, seeded} = await fixture(
      31,
      [25, 26, 27, 28, 29],
    );
    const first = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "offer-rejects-0001",
      }),
      context,
    );
    assert.equal(first.offers.length, 25);
    assert.equal(first.hasMore, true);
    assert.equal(first.partial, false);
    const second = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "offer-rejects-0002",
        cursor: first.nextCursor,
      }),
      context,
    );
    assert.deepEqual(
      second.offers.map((entry) => entry.offerId),
      [opaqueOfferId(seeded, seeded.coupons[30])],
    );
  });

  await t.test("100 consumed rows retain unresolved progress", async () => {
    const rejected = Array.from({length: 75}, (_, index) => index + 25);
    const {database, context, response: started, seeded} =
      await fixture(101, rejected);
    const request = offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "offer-budget-witness-0001",
    });
    const partial = await getCustomerBiteSaverOfferPageHandler(request, context);
    assert.equal(partial.offers.length, 25);
    assert.equal(partial.hasMore, true);
    assert.equal(partial.partial, true);
    assert.match(partial.nextCursor, /^bsc1\./u);
    assert.deepEqual(
      await getCustomerBiteSaverOfferPageHandler(request, context),
      partial,
    );
    const continued = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "offer-budget-witness-0002",
        cursor: partial.nextCursor,
      }),
      context,
    );
    assert.deepEqual(
      continued.offers.map((entry) => entry.offerId),
      [opaqueOfferId(seeded, seeded.coupons[100])],
    );
    assert.equal(continued.hasMore, false);
    assert.equal(continued.partial, false);
    assert.ok(database.calls.queryDocuments.every((query) => query.limit <= 26));
  });
});

test("offer pages preserve nanosecond timestamps and Firestore UTF-8 ID ties", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 0,
    onlyCoupons: true,
  });
  const seconds = Math.floor(nowMs / 1_000);
  const identities = [
    {id: "nanos-later", nanoseconds: 123_456_999},
    {id: "nanos-earlier", nanoseconds: 123_456_001},
    {id: "tie-\u{10000}", nanoseconds: 123_456_000},
    {id: "tie-\uE000", nanoseconds: 123_456_000},
    ...Array.from({length: 23}, (_, index) => ({
      id: `tie-fill-${String(index).padStart(2, "0")}`,
      nanoseconds: 123_456_000,
    })),
  ];
  const candidates = identities.map(({id, nanoseconds}, index) => {
    const raw = rawCoupon(index, {
      createdAt: new Timestamp(seconds, nanoseconds),
    });
    const projection = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: seeded.accountId,
      sourceDocumentId: id,
      offer: raw,
      restaurant: seeded.restaurant,
      now: new Date(nowMs),
    });
    assert.notEqual(projection, null);
    database.documents.set(
      `restaurant_accounts/${seeded.accountId}/coupons/${id}`,
      raw,
    );
    database.documents.set(
      `${biteSaverOfferIndexCollection}/${projection.indexDocumentId}`,
      projection,
    );
    return previewCandidate(projection);
  });
  const expected = [...candidates].sort((left, right) =>
    Buffer.compare(
      Buffer.from(right.sourceCreatedAtOrderKey, "utf8"),
      Buffer.from(left.sourceCreatedAtOrderKey, "utf8"),
    ) || Buffer.compare(
      Buffer.from(right.sourceDocumentId, "utf8"),
      Buffer.from(left.sourceDocumentId, "utf8"),
    ));
  database.documents.set(seeded.resultPath, {
    ...seeded.result,
    previewCouponCandidates: expected.slice(0, 4),
    usableOfferCountAtPreparation: expected.length,
  });

  const first = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "offer-exact-order-page-0001",
    }),
    context,
  );
  const second = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "offer-exact-order-page-0002",
      cursor: first.nextCursor,
    }),
    context,
  );
  const expectedPublicIds = expected.map((candidate) =>
    customerBiteSaverOpaqueOfferId(
      secretKey,
      seeded.accountId,
      "coupon",
      candidate.sourceDocumentId,
    ));
  assert.equal(first.offers.length, 25);
  assert.equal(first.hasMore, true);
  assert.equal(second.offers.length, 2);
  assert.equal(second.hasMore, false);
  assert.deepEqual(
    [...first.offers, ...second.offers].map((offer) => offer.offerId),
    expectedPublicIds,
  );
  assert.ok(
    expected.findIndex((candidate) => candidate.sourceDocumentId ===
      "tie-\u{10000}") <
    expected.findIndex((candidate) => candidate.sourceDocumentId ===
      "tie-\uE000"),
  );
  assert.equal(
    first.offers[0].sourceCreatedAtMillis,
    first.offers[1].sourceCreatedAtMillis,
  );
});

test("delivery admits offers whose time-only availability changed since indexing", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const scheduledCoupon = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerProjectionNowMs: nowMs - 1,
    offerOverrides: {startTime: new Date(nowMs)},
  });
  const recurringDaily = addReadyRestaurant(database, session, 1, {
    offerCount: 1,
    offerProjectionNowMs: nowMs - 60_000,
    offerOverrides: {
      allDay: false,
      startTime: "08:00",
      endTime: "09:00",
    },
  });

  const response = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  const byId = new Map(response.restaurants.map((restaurant) => [
    restaurant.restaurantId,
    restaurant,
  ]));
  assert.equal(byId.get(scheduledCoupon.publicRestaurantId).offers.length, 1);
  assert.equal(byId.get(recurringDaily.publicRestaurantId).offers.length, 1);
  assert.equal(
    byId.get(scheduledCoupon.publicRestaurantId).offers[0].available,
    true,
  );
  assert.equal(
    byId.get(recurringDaily.publicRestaurantId).offers[0].available,
    true,
  );
});

test("offer page honors signed usage suppression with backfill", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 26,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const suppressed = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[0].sourceDocumentId,
  );
  database.documents.set(
    `customer_redemptions/${defaultSignedUid}/coupon_redemptions/${seeded.coupons[0].sourceDocumentId}`,
    {
      restaurantAccountId: seeded.accountId,
      couponId: seeded.coupons[0].sourceDocumentId,
      lastRedeemedAt: new Date(nowMs - 1_000),
    },
  );
  const response = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId),
    context,
  );
  assert.equal(response.offers.length, 25);
  assert.equal(response.offers.some((offer) => offer.offerId === suppressed), false);
  assert.equal(response.hasMore, false);
});

test("multi-snapshot offer backfill fences signed usage before delivery", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "final-offer-fence-owner";
  const context = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 52,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  for (const candidate of seeded.coupons.slice(1, 25)) {
    database.documents.delete(
      `restaurant_accounts/${seeded.accountId}/coupons/${candidate.sourceDocumentId}`,
    );
  }
  const firstCandidate = seeded.coupons[0];
  const usagePath =
    `customer_redemptions/${uid}/coupon_redemptions/${firstCandidate.sourceDocumentId}`;
  let targetUsageReads = 0;
  database.failGetDocumentsWhen = (paths) => {
    if (paths.includes(usagePath)) {
      targetUsageReads += 1;
      if (targetUsageReads === 2) {
        database.documents.set(usagePath, {
          restaurantAccountId: seeded.accountId,
          couponId: firstCandidate.sourceDocumentId,
          lastRedeemedAt: new Date(nowMs),
        });
      }
    }
    return false;
  };

  await assert.rejects(
    getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId),
      context,
    ),
    (error) => assertContractError(error, "failed-precondition"),
  );
  assert.equal(targetUsageReads, 2);
});

test("offer page stops after 100 consumed candidates and resumes", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 101,
    onlyCoupons: true,
  });
  for (const candidate of seeded.coupons.slice(0, 100)) {
    database.documents.delete(
      `restaurant_accounts/${seeded.accountId}/coupons/${candidate.sourceDocumentId}`,
    );
  }

  const first = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId),
    context,
  );
  assert.deepEqual(first.offers, []);
  assert.equal(first.partial, true);
  assert.equal(first.hasMore, true);
  assert.equal(database.calls.queryDocuments.length, 5);
  assert.deepEqual(
    database.calls.queryDocuments.map((query) => query.limit),
    [26, 26, 26, 22, 1],
  );
  const firstPageRawOfferReads = database.calls.getDocuments
    .flat()
    .filter((path) => /\/\b(?:coupons|daily_specials)\//u.test(path));
  assert.equal(firstPageRawOfferReads.length, 100);

  const finalPage = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "offer-page-request-0002",
      cursor: first.nextCursor,
    }),
    context,
  );
  assert.equal(finalPage.offers.length, 1);
  assert.equal(finalPage.hasMore, false);
  database.calls.queryDocuments.length = 0;
  const delivered = finalPage.offers[0];
  const redemption = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    redemptionRequest(
      started,
      seeded.publicRestaurantId,
      delivered.offerId,
      {offerOccurrence: delivered.offerOccurrence},
    ),
    context,
  );
  assert.equal(redemption.allowed, true);
  assert.equal(redemption.reason, "available");
  assert.deepEqual(database.calls.queryDocuments, []);
});

test("offer page proves exact 100-candidate exhaustion without a false cursor", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 100,
    onlyCoupons: true,
  });
  for (const candidate of seeded.coupons) {
    database.documents.delete(
      `restaurant_accounts/${seeded.accountId}/coupons/${candidate.sourceDocumentId}`,
    );
  }

  const page = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId),
    context,
  );
  assert.deepEqual(page.offers, []);
  assert.equal(page.partial, false);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(
    database.calls.queryDocuments.map((query) => query.limit),
    [26, 26, 26, 22, 1],
  );
});

test("signed usage transport failures stay explicit and retriable on pages", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database, {
    identity: {authUid: "usage-owner", authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  database.failGetDocumentsWhen = (paths) =>
    paths.some((path) => path.startsWith("customer_redemptions/"));

  const restaurantPage = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started),
    context,
  );
  assert.equal(restaurantPage.restaurants.length, 1);
  assert.deepEqual(
    restaurantPage.restaurants[0].offers.map((offer) => ({
      available: offer.available,
      reason: offer.availabilityReason,
      usageState: offer.usageState,
    })),
    [{available: false, reason: "usageUnknown", usageState: "unknown"}],
  );

  const offerPage = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId),
    context,
  );
  assert.equal(offerPage.offers.length, 1);
  assert.equal(offerPage.offers[0].available, false);
  assert.equal(offerPage.offers[0].availabilityReason, "usageUnknown");
  assert.equal(offerPage.offers[0].usageState, "unknown");
  assertNoPrivateCanaries({restaurantPage, offerPage});
});

test("favorite handler enforces signed strict 0/25/50/75 request bounds", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database, {
    identity: {authUid: "favorite-owner", authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = Array.from({length: 25}, (_, index) =>
    addReadyRestaurant(database, session, index));
  const restaurantIds = seeded.map((entry) => entry.publicRestaurantId);
  const offerIds = seeded.flatMap((entry) => [
    customerBiteSaverOpaqueOfferId(
      secretKey,
      entry.accountId,
      "dailySpecial",
      entry.daily[0].sourceDocumentId,
    ),
    customerBiteSaverOpaqueOfferId(
      secretKey,
      entry.accountId,
      "coupon",
      entry.coupons[0].sourceDocumentId,
    ),
  ]);
  const issued = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {clientRequestId: "favorite-bounds-page-0001"}),
    context,
  );
  assert.deepEqual(
    issued.restaurants.map((entry) => entry.restaurantId),
    restaurantIds,
  );
  assert.deepEqual(
    issued.restaurants.flatMap((restaurant) =>
      restaurant.offers.map((offer) => offer.offerId)),
    offerIds,
  );

  for (const [restaurants, offers, expected, expectedState] of [
    [[], [], 0, null],
    [restaurantIds.slice(0, 1), [], 1, "notFavorite"],
    [restaurantIds, [], 25, "notFavorite"],
    [[], offerIds, 50, "notFavorite"],
    [restaurantIds, offerIds, 75, "notFavorite"],
  ]) {
    const readsBefore = database.calls.getDocuments.length;
    const response = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(started, {restaurantIds: restaurants, offerIds: offers}),
      context,
    );
    assertExactKeys(response, ["schemaVersion", "states"]);
    assert.equal(response.states.length, expected);
    assert.deepEqual(
      response.states.map((entry) => entry.id),
      [...restaurants, ...offers],
    );
    assert.ok(response.states.every((entry) => entry.state === expectedState));
    assertNoPrivateCanaries(response);
    const requestReads = database.calls.getDocuments.slice(readsBefore);
    assert.ok(requestReads.length <= 4);
    assert.ok(requestReads.every((paths) => paths.length <= 75));
  }

  const extraRestaurant = customerBiteSaverOpaqueRestaurantId(
    secretKey,
    "extra-account",
  );
  const extraOffer = customerBiteSaverOpaqueOfferId(
    secretKey,
    "extra-account",
    "coupon",
    "extra-offer",
  );
  for (const invalid of [
    favoriteRequest(started, {
      restaurantIds: [...restaurantIds, extraRestaurant],
      offerIds,
    }),
    favoriteRequest(started, {
      restaurantIds,
      offerIds: [...offerIds, extraOffer],
    }),
    favoriteRequest(started, {
      restaurantIds: [restaurantIds[0], restaurantIds[0]],
    }),
    {...favoriteRequest(started), unexpected: true},
  ]) {
    await assert.rejects(
      getCustomerBiteSaverFavoriteStatesHandler(invalid, context),
      (error) => assertContractError(error, "invalid-argument"),
    );
  }

  const guestDatabase = new InMemoryCustomerBiteSaverSearchDatabase();
  await assert.rejects(
    getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(started),
      createContext(guestDatabase, {
        identity: {authUid: null, authIsAnonymous: true},
      }),
    ),
    (error) => assertContractError(error, "permission-denied"),
  );
  assert.deepEqual(guestDatabase.calls.getDocument, []);
  assert.deepEqual(guestDatabase.calls.getDocuments, []);
});

test("restaurant-page delivery evidence is exact, bounded, and replay-safe", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database, {
    identity: {authUid: "favorite-evidence-owner", authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "favorite-evidence-start-0001",
      searchText: "",
    }),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = Array.from({length: 27}, (_, index) =>
    addReadyRestaurant(database, session, index));
  const request = pageRequest(started, {
    clientRequestId: "favorite-evidence-page-0001",
  });
  const page = await getCustomerBiteSaverSearchPageHandler(request, context);
  assert.equal(page.restaurants.length, 25);
  assert.equal(page.hasMore, true);
  const returnedRestaurantIds = page.restaurants.map(
    (restaurant) => restaurant.restaurantId,
  );
  const returnedOfferIds = page.restaurants.flatMap((restaurant) =>
    restaurant.offers.map((offer) => offer.offerId));
  assert.equal(returnedOfferIds.length, 50);

  const deliveryDocuments = () => [...database.documents.entries()]
    .filter(([, document]) =>
      document.sessionId === started.sessionId &&
      (document.role === "deliveredRestaurantIdentity" ||
        document.role === "deliveredOfferIdentity"));
  const restaurantEvidence = deliveryDocuments()
    .filter(([, document]) =>
      document.role === "deliveredRestaurantIdentity")
    .map(([, document]) => document.publicRestaurantId)
    .sort();
  const offerEvidence = deliveryDocuments()
    .filter(([, document]) => document.role === "deliveredOfferIdentity")
    .map(([, document]) => document.publicOfferId)
    .sort();
  assert.deepEqual(restaurantEvidence, [...returnedRestaurantIds].sort());
  assert.deepEqual(offerEvidence, [...returnedOfferIds].sort());
  assert.ok(deliveryDocuments().every(([, document]) =>
    document.attemptGeneration === session.attemptGeneration &&
    document.queryFingerprint === session.queryFingerprint &&
    typeof document.callerCapabilityBinding === "string" &&
    typeof document.pageGenerationFingerprint === "string"));

  const lookahead = seeded[25];
  const preparedOnly = seeded[26];
  const lookaheadOfferId = opaqueOfferId(lookahead, lookahead.daily[0]);
  const preparedOfferId = opaqueOfferId(preparedOnly, preparedOnly.daily[0]);
  assert.equal(restaurantEvidence.includes(lookahead.publicRestaurantId), false);
  assert.equal(offerEvidence.includes(lookaheadOfferId), false);
  assert.equal(restaurantEvidence.includes(preparedOnly.publicRestaurantId), false);
  assert.equal(offerEvidence.includes(preparedOfferId), false);

  const authorized = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-evidence-authorized-0001",
      restaurantIds: [returnedRestaurantIds[0]],
      offerIds: [returnedOfferIds[0]],
    }),
    context,
  );
  assert.deepEqual(authorized.states, [
    {id: returnedRestaurantIds[0], state: "notFavorite"},
    {id: returnedOfferIds[0], state: "notFavorite"},
  ]);

  let readsBefore = database.calls.getDocuments.length;
  const unauthorized = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-evidence-unissued-0001",
      restaurantIds: [
        lookahead.publicRestaurantId,
        preparedOnly.publicRestaurantId,
      ],
      offerIds: [lookaheadOfferId, preparedOfferId],
    }),
    context,
  );
  assert.deepEqual(unauthorized.states, [
    {id: lookahead.publicRestaurantId, state: "unknown"},
    {id: preparedOnly.publicRestaurantId, state: "unknown"},
    {id: lookaheadOfferId, state: "unknown"},
    {id: preparedOfferId, state: "unknown"},
  ]);
  let reads = database.calls.getDocuments.slice(readsBefore);
  assert.equal(reads.length, 1);
  assert.equal(
    reads.flat().some((path) => path.startsWith("user_profiles/")),
    false,
  );

  readsBefore = database.calls.getDocuments.length;
  const mixed = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-evidence-mixed-0001",
      restaurantIds: [
        returnedRestaurantIds[0],
        lookahead.publicRestaurantId,
      ],
      offerIds: [returnedOfferIds[0]],
    }),
    context,
  );
  assert.deepEqual(mixed.states, [
    {id: returnedRestaurantIds[0], state: "unknown"},
    {id: lookahead.publicRestaurantId, state: "unknown"},
    {id: returnedOfferIds[0], state: "unknown"},
  ]);
  reads = database.calls.getDocuments.slice(readsBefore);
  assert.equal(reads.length, 1);
  assert.equal(
    reads.flat().some((path) => path.startsWith("user_profiles/")),
    false,
  );

  const evidenceBeforeRetry = JSON.stringify(deliveryDocuments().sort(
    ([left], [right]) => left.localeCompare(right),
  ));
  const retry = await getCustomerBiteSaverSearchPageHandler(request, context);
  assert.deepEqual(retry, page);
  assert.equal(
    JSON.stringify(deliveryDocuments().sort(
      ([left], [right]) => left.localeCompare(right),
    )),
    evidenceBeforeRetry,
  );
  assert.equal(deliveryDocuments().length, 75);
});

test("a challenge-only offer cannot authorize a signed favorite read", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const guestContext = createContext(database, {identity: guestIdentity()});
  const guestStarted = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "favorite-challenge-guest-start-0001",
      searchText: "",
    }),
    guestContext,
  );
  const guestSession = markSessionReady(database, guestStarted);
  const sharedAccountId = "favorite-challenge-account";
  const sharedOfferId = "favorite-challenge-offer";
  const guestSeeded = addReadyRestaurant(database, guestSession, 0, {
    accountId: sharedAccountId,
    offerCount: 1,
    onlyCoupons: true,
    sharedOfferId,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const challenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(guestStarted, guestSeeded.publicRestaurantId, {
      clientRequestId: "favorite-challenge-guest-page-0001",
      guestStateRevision: 8,
    }),
    guestContext,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  assert.equal(challenge.candidates.length, 1);
  const challengedOfferId = challenge.candidates[0].offerId;
  assert.equal(
    [...database.documents.values()].some((document) =>
      document.role === "deliveredOfferIdentity" &&
      document.publicOfferId === challengedOfferId),
    false,
  );

  const uid = "favorite-challenge-signed-owner";
  const signedContext = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
    randomSource: (size) => Buffer.alloc(size, 91),
  });
  const signedStarted = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "favorite-challenge-signed-start-0001",
      searchText: "",
    }),
    signedContext,
  );
  const signedSession = markSessionReady(database, signedStarted);
  const signedSeeded = addReadyRestaurant(database, signedSession, 0, {
    accountId: sharedAccountId,
    offerCount: 1,
    onlyCoupons: true,
    sharedOfferId,
    offerOverrides: {usageRule: "Once per customer"},
  });
  assert.equal(
    opaqueOfferId(signedSeeded, signedSeeded.coupons[0]),
    challengedOfferId,
  );
  database.documents.set(
    `user_profiles/${uid}/favorite_coupons/${sharedOfferId}`,
    {restaurantAccountId: sharedAccountId, couponId: sharedOfferId},
  );

  const readsBefore = database.calls.getDocuments.length;
  const response = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(signedStarted, {
      clientRequestId: "favorite-challenge-state-0001",
      offerIds: [challengedOfferId],
    }),
    signedContext,
  );
  assert.deepEqual(response.states, [
    {id: challengedOfferId, state: "unknown"},
  ]);
  const reads = database.calls.getDocuments.slice(readsBefore);
  assert.equal(reads.length, 1);
  assert.equal(
    reads.flat().some((path) => path.startsWith("user_profiles/")),
    false,
  );
});

test("delivery evidence from another session does not authorize favorites", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "favorite-cross-session-owner";
  const context = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
  });
  const firstStarted = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "favorite-cross-session-start-0001",
      searchText: "",
    }),
    context,
  );
  const firstSession = markSessionReady(database, firstStarted);
  const options = {
    accountId: "favorite-cross-session-account",
    offerCount: 1,
    onlyCoupons: true,
    sharedOfferId: "favorite-cross-session-offer",
  };
  const firstSeeded = addReadyRestaurant(database, firstSession, 0, options);
  const firstPage = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(firstStarted, {
      clientRequestId: "favorite-cross-session-page-0001",
    }),
    context,
  );
  const publicOfferId = firstPage.restaurants[0].offers[0].offerId;
  database.documents.set(
    `user_profiles/${uid}/favorite_coupons/${options.sharedOfferId}`,
    {
      restaurantAccountId: options.accountId,
      couponId: options.sharedOfferId,
    },
  );

  const secondStarted = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "favorite-cross-session-start-0002",
      searchText: "",
      freshSearch: true,
    }),
    context,
  );
  assert.notEqual(secondStarted.sessionId, firstStarted.sessionId);
  const secondSession = markSessionReady(database, secondStarted);
  const secondSeeded = addReadyRestaurant(database, secondSession, 0, options);
  assert.equal(secondSeeded.publicRestaurantId, firstSeeded.publicRestaurantId);
  assert.equal(opaqueOfferId(secondSeeded, secondSeeded.coupons[0]), publicOfferId);

  const readsBefore = database.calls.getDocuments.length;
  const response = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(secondStarted, {
      clientRequestId: "favorite-cross-session-state-0001",
      restaurantIds: [secondSeeded.publicRestaurantId],
      offerIds: [publicOfferId],
    }),
    context,
  );
  assert.deepEqual(response.states, [
    {id: secondSeeded.publicRestaurantId, state: "unknown"},
    {id: publicOfferId, state: "unknown"},
  ]);
  const reads = database.calls.getDocuments.slice(readsBefore);
  assert.equal(reads.length, 1);
  assert.equal(
    reads.flat().some((path) => path.startsWith("user_profiles/")),
    false,
  );
});

test("a failed delivery-evidence commit does not authorize favorites", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database, {
    identity: {authUid: "favorite-failed-commit-owner", authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "favorite-failed-commit-start-0001",
      searchText: "",
    }),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0);
  const offerId = opaqueOfferId(seeded, seeded.daily[0]);
  const request = pageRequest(started, {
    clientRequestId: "favorite-failed-commit-page-0001",
  });
  const commitFailure = new Error("delivery evidence commit canary");
  let failEvidenceCommit = true;
  database.transactionWriteFailure = commitFailure;
  database.failTransactionWritesWhen = (writes) => {
    if (
      failEvidenceCommit &&
      writes.some((write) =>
        write.data?.role === "deliveredRestaurantIdentity" ||
        write.data?.role === "deliveredOfferIdentity")
    ) {
      failEvidenceCommit = false;
      return true;
    }
    return false;
  };

  await assert.rejects(
    getCustomerBiteSaverSearchPageHandler(request, context),
    (error) => error === commitFailure,
  );
  assert.equal(
    [...database.documents.values()].some((document) =>
      document.role === "deliveredRestaurantIdentity" ||
      document.role === "deliveredOfferIdentity"),
    false,
  );
  const readsBefore = database.calls.getDocuments.length;
  const unauthorized = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-failed-commit-state-0001",
      restaurantIds: [seeded.publicRestaurantId],
      offerIds: [offerId],
    }),
    context,
  );
  assert.deepEqual(unauthorized.states, [
    {id: seeded.publicRestaurantId, state: "unknown"},
    {id: offerId, state: "unknown"},
  ]);
  const reads = database.calls.getDocuments.slice(readsBefore);
  assert.equal(reads.length, 1);
  assert.equal(
    reads.flat().some((path) => path.startsWith("user_profiles/")),
    false,
  );

  const retry = await getCustomerBiteSaverSearchPageHandler(request, context);
  assert.equal(retry.restaurants.length, 1);
  const authorized = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-failed-commit-state-0002",
      restaurantIds: [seeded.publicRestaurantId],
      offerIds: [offerId],
    }),
    context,
  );
  assert.deepEqual(authorized.states, [
    {id: seeded.publicRestaurantId, state: "notFavorite"},
    {id: offerId, state: "notFavorite"},
  ]);
});

test("additional-offer pages authorize exactly the offers they return", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database, {
    identity: {authUid: "favorite-offer-page-owner", authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "favorite-offer-page-start-0001",
      searchText: "",
    }),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 30,
    onlyCoupons: true,
  });
  const firstRequest = offerPageRequest(started, seeded.publicRestaurantId, {
    clientRequestId: "favorite-offer-page-first-0001",
  });
  const first = await getCustomerBiteSaverOfferPageHandler(
    firstRequest,
    context,
  );
  assert.equal(first.offers.length, 25);
  assert.equal(first.hasMore, true);
  const firstIds = first.offers.map((offer) => offer.offerId);
  const evidenceIds = () => [...database.documents.values()]
    .filter((document) =>
      document.role === "deliveredOfferIdentity" &&
      document.sessionId === started.sessionId)
    .map((document) => document.publicOfferId)
    .sort();
  assert.deepEqual(evidenceIds(), [...firstIds].sort());
  assert.equal(
    [...database.documents.values()].some((document) =>
      document.role === "deliveredRestaurantIdentity" &&
      document.sessionId === started.sessionId),
    false,
  );
  const allOfferIds = seeded.coupons.map((candidate) =>
    opaqueOfferId(seeded, candidate));
  const unissuedOfferId = allOfferIds.find((id) => !firstIds.includes(id));
  assert.notEqual(unissuedOfferId, undefined);

  let readsBefore = database.calls.getDocuments.length;
  const mixed = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-offer-page-mixed-0001",
      offerIds: [firstIds[0], unissuedOfferId],
    }),
    context,
  );
  assert.deepEqual(mixed.states, [
    {id: firstIds[0], state: "unknown"},
    {id: unissuedOfferId, state: "unknown"},
  ]);
  let reads = database.calls.getDocuments.slice(readsBefore);
  assert.equal(reads.length, 1);
  assert.equal(
    reads.flat().some((path) => path.startsWith("user_profiles/")),
    false,
  );

  const retry = await getCustomerBiteSaverOfferPageHandler(
    firstRequest,
    context,
  );
  assert.deepEqual(retry, first);
  assert.deepEqual(evidenceIds(), [...firstIds].sort());
  const second = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "favorite-offer-page-second-0001",
      cursor: first.nextCursor,
    }),
    context,
  );
  assert.equal(second.offers.length, 5);
  assert.equal(second.hasMore, false);
  const secondIds = second.offers.map((offer) => offer.offerId);
  assert.equal(secondIds.includes(unissuedOfferId), true);
  assert.deepEqual(
    evidenceIds(),
    [...firstIds, ...secondIds].sort(),
  );

  const authorized = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-offer-page-authorized-0001",
      offerIds: [firstIds[0], secondIds[0]],
    }),
    context,
  );
  assert.deepEqual(authorized.states, [
    {id: firstIds[0], state: "notFavorite"},
    {id: secondIds[0], state: "notFavorite"},
  ]);

  readsBefore = database.calls.getDocuments.length;
  const unissuedRestaurant = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-offer-page-parent-0001",
      restaurantIds: [seeded.publicRestaurantId],
    }),
    context,
  );
  assert.deepEqual(unissuedRestaurant.states, [
    {id: seeded.publicRestaurantId, state: "unknown"},
  ]);
  reads = database.calls.getDocuments.slice(readsBefore);
  assert.equal(reads.length, 1);
  assert.equal(
    reads.flat().some((path) => path.startsWith("user_profiles/")),
    false,
  );
});

test("favorite states are batched, distinguish outcomes, and fail unknown", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "favorite-owner";
  const context = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const first = addReadyRestaurant(database, session, 0);
  const second = addReadyRestaurant(database, session, 1);
  const firstOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    first.accountId,
    "coupon",
    first.coupons[0].sourceDocumentId,
  );
  const secondOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    second.accountId,
    "coupon",
    second.coupons[0].sourceDocumentId,
  );
  const unknownId = customerBiteSaverOpaqueRestaurantId(secretKey, "unknown-account");
  const issued = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {clientRequestId: "favorite-states-page-0001"}),
    context,
  );
  assert.deepEqual(
    issued.restaurants.map((entry) => entry.restaurantId),
    [first.publicRestaurantId, second.publicRestaurantId],
  );
  database.documents.set(
    `user_profiles/${uid}/favorite_restaurants/bitesaver_account_${first.accountId}`,
    {restaurantAccountId: first.accountId},
  );
  database.documents.set(
    `user_profiles/${uid}/favorite_coupons/${first.coupons[0].sourceDocumentId}`,
    {
      restaurantAccountId: first.accountId,
      couponId: first.coupons[0].sourceDocumentId,
      privateNote: "admin-private-canary",
    },
  );
  database.documents.set(
    `user_profiles/${uid}/favorite_coupons/${second.coupons[0].sourceDocumentId}`,
    {couponId: second.coupons[0].sourceDocumentId},
  );
  database.calls.getDocuments = [];
  const response = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      restaurantIds: [first.publicRestaurantId, second.publicRestaurantId],
      offerIds: [firstOfferId, secondOfferId],
    }),
    context,
  );
  assert.deepEqual(response.states, [
    {id: first.publicRestaurantId, state: "favorite"},
    {id: second.publicRestaurantId, state: "notFavorite"},
    {id: firstOfferId, state: "favorite"},
    {id: secondOfferId, state: "unknown"},
  ]);
  assert.equal(database.calls.getDocuments.length, 4);
  assert.deepEqual(
    database.calls.getDocuments.map((paths) => paths.length),
    [4, 2, 4, 1],
  );
  assertNoPrivateCanaries(response);

  const mixedReadsBefore = database.calls.getDocuments.length;
  const mixed = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-mixed-unauthorized-0001",
      restaurantIds: [first.publicRestaurantId, unknownId],
      offerIds: [firstOfferId],
    }),
    context,
  );
  assert.deepEqual(mixed.states, [
    {id: first.publicRestaurantId, state: "unknown"},
    {id: unknownId, state: "unknown"},
    {id: firstOfferId, state: "unknown"},
  ]);
  const mixedReads = database.calls.getDocuments.slice(mixedReadsBefore);
  assert.equal(mixedReads.length, 1);
  assert.equal(
    mixedReads.flat().some((path) => path.startsWith("user_profiles/")),
    false,
  );

  database.failGetDocumentsWhen = (paths) =>
    paths.some((path) => path.includes("/favorite_"));
  const failure = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-request-0002",
      restaurantIds: [first.publicRestaurantId],
      offerIds: [firstOfferId],
    }),
    context,
  );
  assert.deepEqual(failure.states, [
    {id: first.publicRestaurantId, state: "unknown"},
    {id: firstOfferId, state: "unknown"},
  ]);
  assertNoPrivateCanaries(failure);

  database.failGetDocumentsWhen = (paths) =>
    paths.some((path) => path.startsWith(
      `${privateCustomerBiteSaverResultCollection}/`,
    ));
  const resolutionFailure = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-request-0003",
      restaurantIds: [first.publicRestaurantId],
      offerIds: [firstOfferId],
    }),
    context,
  );
  assert.deepEqual(resolutionFailure.states, [
    {id: first.publicRestaurantId, state: "unknown"},
    {id: firstOfferId, state: "unknown"},
  ]);
  assertNoPrivateCanaries(resolutionFailure);
  database.failGetDocumentsWhen = null;

  for (const contextOverride of [
    createContext(database, {
      identity: {authUid: "wrong-favorite-owner", authIsAnonymous: false},
    }),
  ]) {
    await assert.rejects(
      getCustomerBiteSaverFavoriteStatesHandler(
        favoriteRequest(started, {restaurantIds: [first.publicRestaurantId]}),
        contextOverride,
      ),
      (error) => assertContractError(error, "permission-denied"),
    );
  }
});

test("favorite state resolves a delivered live-fallback offer mapping", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "live-fallback-favorite-owner";
  const context = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 51,
    onlyCoupons: true,
  });
  for (const candidate of seeded.coupons.slice(0, 50)) {
    database.documents.delete(
      `restaurant_accounts/${seeded.accountId}/coupons/${candidate.sourceDocumentId}`,
    );
  }
  const page = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {clientRequestId: "live-favorite-page-0001"}),
    context,
  );
  assert.equal(page.restaurants.length, 1);
  assert.equal(page.restaurants[0].offers.length, 1);
  const delivered = page.restaurants[0].offers[0];
  const liveCandidate = seeded.coupons[50];
  database.documents.set(
    `user_profiles/${uid}/favorite_coupons/${liveCandidate.sourceDocumentId}`,
    {
      restaurantAccountId: seeded.accountId,
      couponId: liveCandidate.sourceDocumentId,
    },
  );

  const response = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "live-favorite-state-0001",
      restaurantIds: [],
      offerIds: [delivered.offerId],
    }),
    context,
  );
  assert.deepEqual(response.states, [
    {id: delivered.offerId, state: "favorite"},
  ]);
  const identityMappings = [...database.documents.values()].filter((document) =>
    document.role === "deliveredOfferIdentity");
  assert.equal(identityMappings.length, 1);
  assert.equal(identityMappings[0].sourceDocumentId,
    liveCandidate.sourceDocumentId);
});

test("same child offer ID under two restaurants cannot collide in favorites", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "favorite-owner";
  const context = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const first = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    sharedOfferId: "shared-child-id",
  });
  const second = addReadyRestaurant(database, session, 1, {
    offerCount: 1,
    onlyCoupons: true,
    sharedOfferId: "shared-child-id",
  });
  const firstOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    first.accountId,
    "coupon",
    "shared-child-id",
  );
  const secondOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    second.accountId,
    "coupon",
    "shared-child-id",
  );
  const issued = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {clientRequestId: "shared-favorite-page-0001"}),
    context,
  );
  assert.deepEqual(
    issued.restaurants.map((entry) => entry.restaurantId),
    [first.publicRestaurantId, second.publicRestaurantId],
  );
  assert.deepEqual(
    issued.restaurants.map((entry) => entry.offers[0].offerId),
    [firstOfferId, secondOfferId],
  );
  database.documents.set(
    `user_profiles/${uid}/favorite_coupons/shared-child-id`,
    {restaurantAccountId: first.accountId, couponId: "shared-child-id"},
  );
  const response = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      restaurantIds: [first.publicRestaurantId, second.publicRestaurantId],
      offerIds: [firstOfferId, secondOfferId],
    }),
    context,
  );
  assert.deepEqual(response.states.slice(2), [
    {id: firstOfferId, state: "favorite"},
    {id: secondOfferId, state: "unknown"},
  ]);

  database.documents.set(
    `user_profiles/${uid}/favorite_coupons/shared-child-id`,
    {couponId: "shared-child-id"},
  );
  const ambiguousLegacy = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-request-0002",
      restaurantIds: [first.publicRestaurantId, second.publicRestaurantId],
      offerIds: [firstOfferId, secondOfferId],
    }),
    context,
  );
  assert.deepEqual(ambiguousLegacy.states.slice(2), [
    {id: firstOfferId, state: "unknown"},
    {id: secondOfferId, state: "unknown"},
  ]);

  for (const [publicRestaurantId, publicOfferId] of [
    [first.publicRestaurantId, firstOfferId],
    [second.publicRestaurantId, secondOfferId],
  ]) {
    const singleton = await getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(started, {
        clientRequestId: `favorite-single-${publicOfferId.slice(-16)}`,
        restaurantIds: [publicRestaurantId],
        offerIds: [publicOfferId],
      }),
      context,
    );
    assert.equal(singleton.states[1].state, "unknown");
  }
});

test("restaurant favorites use only bounded parent-verified legacy fallback", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "favorite-legacy-owner";
  const context = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0);
  const legacyPath = `user_profiles/${uid}/favorite_restaurants/` +
    customerBiteSaverSessionInternals
      .legacyFavoriteSaverRestaurantDocumentId(seeded.result);
  const issued = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {clientRequestId: "favorite-legacy-page-0001"}),
    context,
  );
  assert.deepEqual(
    issued.restaurants.map((entry) => entry.restaurantId),
    [seeded.publicRestaurantId],
  );
  database.documents.set(legacyPath, {
    restaurantAccountId: seeded.accountId,
  });

  const favorite = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      restaurantIds: [seeded.publicRestaurantId],
    }),
    context,
  );
  assert.deepEqual(favorite.states, [
    {id: seeded.publicRestaurantId, state: "favorite"},
  ]);
  assert.ok(database.calls.getDocuments.at(-1).length <= 25);

  database.documents.set(legacyPath, {});
  const unbound = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "favorite-legacy-req-0002",
      restaurantIds: [seeded.publicRestaurantId],
    }),
    context,
  );
  assert.deepEqual(unbound.states, [
    {id: seeded.publicRestaurantId, state: "unknown"},
  ]);
});

test("signed usage never crosses same child IDs between restaurants", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "usage-collision-owner";
  const context = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const first = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    sharedOfferId: "shared-usage-child",
    offerOverrides: {usageRule: "Once per customer"},
  });
  const second = addReadyRestaurant(database, session, 1, {
    offerCount: 1,
    onlyCoupons: true,
    sharedOfferId: "shared-usage-child",
    offerOverrides: {usageRule: "Once per customer"},
  });
  const firstOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    first.accountId,
    "coupon",
    "shared-usage-child",
  );
  const secondOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    second.accountId,
    "coupon",
    "shared-usage-child",
  );
  const firstRequest = await deliveredRedemptionRequest(
    started,
    first.publicRestaurantId,
    firstOfferId,
    context,
  );
  const secondRequest = await deliveredRedemptionRequest(
    started,
    second.publicRestaurantId,
    secondOfferId,
    context,
    {
      clientRequestId: "redeem-collision-request-0002",
      redemptionRequestId: "redemption-collision-0002",
    },
  );
  database.documents.set(
    `customer_redemptions/${uid}/coupon_redemptions/shared-usage-child`,
    {
      restaurantAccountId: first.accountId,
      couponId: "shared-usage-child",
      lastRedeemedAt: new Date(nowMs - 1_000),
    },
  );

  const firstState = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    firstRequest,
    context,
  );
  const secondState = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    secondRequest,
    context,
  );
  assert.equal(firstState.reason, "used");
  assert.equal(secondState.reason, "usageUnknown");
});

test("redemption validation is strict, bounded, idempotent, and DTO-safe", async () => {
  let clock = nowMs;
  const {database, context, response: started} = await startSession(undefined, {
    context: {now: () => clock},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
  });
  const offerId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[0].sourceDocumentId,
  );
  const request = await deliveredRedemptionRequest(
    started,
    seeded.publicRestaurantId,
    offerId,
    context,
  );
  const tamperedOccurrence = request.offerOccurrence.slice(0, -1) +
    (request.offerOccurrence.endsWith("A") ? "B" : "A");
  database.calls.queryDocuments.length = 0;
  for (const invalid of [
    {...request, unexpected: true},
    {...request, offerId: "source-offer-canary"},
    {...request, offerOccurrence: "bsoc1.invalid"},
    {...request, offerOccurrence: tamperedOccurrence},
    {...request, redemptionRequestId: "short"},
    {...request, currentCoordinates: {latitude: 28, longitude: -81}},
    {...request, currentCoordinates: {
      latitude: 28,
      longitude: -81,
      capturedAtMillis: nowMs,
      unexpected: true,
    }},
  ]) {
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(invalid, context),
      (error) => assertContractError(error, "invalid-argument"),
    );
  }

  const response = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    request,
    context,
  );
  assertExactKeys(response, [
    "schemaVersion",
    "restaurantId",
    "offerId",
    "allowed",
    "reason",
    "evaluatedAtMillis",
    "activeTimerExpiresAtMillis",
    "nextAvailableAtMillis",
    "validationId",
    "validationExpiresAtMillis",
  ]);
  assert.equal(response.allowed, true);
  assert.equal(response.reason, "available");
  assert.match(response.validationId, /^bsv_[A-Za-z0-9_-]{43}$/u);
  assert.equal(response.validationExpiresAtMillis, nowMs + 60_000);
  assertNoPrivateCanaries(response);
  const changedTransport =
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: "redeem-request-transport-0002"},
      context,
    );
  assert.deepEqual(changedTransport, response);
  const logicalReservations = [...database.documents.values()].filter(
    (document) => document.role === "logicalRedemptionReplay",
  );
  assert.equal(logicalReservations.length, 1);
  assert.equal(logicalReservations[0].evaluationAt.getTime(), nowMs);
  assert.equal(logicalReservations[0].logicalExpiresAt.getTime(), nowMs + 60_000);
  clock += 30_000;
  const retry = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    {...request, clientRequestId: "redeem-request-transport-0003"},
    context,
  );
  assert.equal(retry.allowed, true);
  assert.equal(retry.evaluatedAtMillis, nowMs);
  assert.equal(retry.validationExpiresAtMillis, response.validationExpiresAtMillis);
  assert.equal(retry.validationId, response.validationId);
  assert.equal(logicalReservations[0].evaluationAt.getTime(), nowMs);
  assert.equal(logicalReservations[0].logicalExpiresAt.getTime(), nowMs + 60_000);
  clock = response.validationExpiresAtMillis;
  await assert.rejects(
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: "redeem-request-transport-0004"},
      context,
    ),
    (error) => assertContractError(error, "failed-precondition"),
  );
  clock += 1;
  await assert.rejects(
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: "redeem-request-transport-0005"},
      context,
    ),
    (error) => assertContractError(error, "failed-precondition"),
  );
  assert.deepEqual(database.calls.queryDocuments, []);

  database.documents.delete(
    `restaurant_accounts/${seeded.accountId}/coupons/${seeded.coupons[0].sourceDocumentId}`,
  );
  const deleted = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    {
      ...request,
      clientRequestId: "redeem-request-deleted-0002",
      redemptionRequestId: "redemption-occurrence-0002",
    },
    context,
  );
  assert.equal(deleted.allowed, false);
  assert.equal(deleted.reason, "offerUnavailable");
  assert.equal(deleted.validationId, null);
});

test("signed logical redemption IDs cannot be rebound to another target", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database);
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "signed-rebind-start-0001",
      searchText: "",
    }),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 2,
    onlyCoupons: true,
  });
  const page = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "signed-rebind-offer-page-0001",
    }),
    context,
  );
  assert.equal(page.offers.length, 2);
  const logicalId = "signed-rebind-logical-redemption-0001";
  const request = redemptionRequest(
    started,
    seeded.publicRestaurantId,
    page.offers[0].offerId,
    {
      clientRequestId: "signed-rebind-redeem-0001",
      redemptionRequestId: logicalId,
      offerOccurrence: page.offers[0].offerOccurrence,
    },
  );
  const first = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    request,
    context,
  );
  assert.equal(first.allowed, true);

  for (const invalid of [
    {
      ...request,
      clientRequestId: "signed-rebind-target-0002",
      offerId: page.offers[1].offerId,
      offerOccurrence: page.offers[1].offerOccurrence,
    },
    {
      ...request,
      clientRequestId: "signed-rebind-coordinates-0003",
      currentCoordinates: {
        latitude: 28.5383,
        longitude: -81.3792,
        capturedAtMillis: nowMs,
      },
    },
  ]) {
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(invalid, context),
      (error) => assertContractError(error, "invalid-argument"),
    );
  }

  const newLogicalRequest = {
    ...request,
    clientRequestId: "signed-rebind-new-logical-0004",
    redemptionRequestId: "signed-rebind-logical-redemption-0002",
    offerId: page.offers[1].offerId,
    offerOccurrence: page.offers[1].offerOccurrence,
  };
  const newLogical =
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      newLogicalRequest,
      context,
    );
  assert.equal(newLogical.allowed, true);
  assert.notEqual(newLogical.validationId, first.validationId);
});

test("a denied signed logical redemption cannot be revived with fresh coordinates", async () => {
  let clock = nowMs;
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database, {now: () => clock});
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "signed-denied-fence-start-0001",
      searchText: "",
    }),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {
      usageRule: "Unlimited",
      isProximityOnly: true,
      proximityRadiusMiles: 10,
    },
  });
  const page = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "signed-denied-fence-page-0001",
    }),
    context,
  );
  const offer = page.offers[0];
  const request = redemptionRequest(
    started,
    seeded.publicRestaurantId,
    offer.offerId,
    {
      clientRequestId: "signed-denied-fence-redeem-0001",
      redemptionRequestId: "signed-denied-fence-logical-0001",
      offerOccurrence: offer.offerOccurrence,
      currentCoordinates: null,
    },
  );
  const first = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    request,
    context,
  );
  assert.equal(first.allowed, false);
  assert.equal(first.reason, "missingFreshLocation");
  assert.deepEqual(
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: "signed-denied-fence-redeem-0002"},
      context,
    ),
    first,
  );

  clock += 30_000;
  const beforeExpiry =
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: "signed-denied-fence-redeem-0003"},
      context,
    );
  assert.equal(beforeExpiry.allowed, false);
  assert.equal(beforeExpiry.reason, "missingFreshLocation");
  assert.equal(beforeExpiry.evaluatedAtMillis, nowMs);
  const freshCoordinates = {
    latitude: 28.5383,
    longitude: -81.3792,
    capturedAtMillis: clock,
  };
  await assert.rejects(
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...request,
        clientRequestId: "signed-denied-fence-rebind-0004",
        currentCoordinates: freshCoordinates,
      },
      context,
    ),
    (error) => assertContractError(error, "invalid-argument"),
  );

  clock = nowMs + 60_000;
  await assert.rejects(
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: "signed-denied-fence-expired-0005"},
      context,
    ),
    (error) => assertContractError(error, "failed-precondition"),
  );
  clock += 1;
  await assert.rejects(
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...request,
        clientRequestId: "signed-denied-fence-revive-0006",
        currentCoordinates: {...freshCoordinates, capturedAtMillis: clock},
      },
      context,
    ),
    (error) => assertContractError(error, "invalid-argument"),
  );

  const newLogical =
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...request,
        clientRequestId: "signed-denied-fence-new-logical-0007",
        redemptionRequestId: "signed-denied-fence-logical-0002",
        currentCoordinates: {...freshCoordinates, capturedAtMillis: clock},
      },
      context,
    );
  assert.equal(newLogical.allowed, true);
  assert.equal(newLogical.reason, "available");
});

test("concurrent signed transports share one logical redemption reservation", async () => {
  const database = new SerializedTransactionCustomerBiteSaverSearchDatabase();
  const context = createContext(database);
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({
      clientRequestId: "signed-concurrent-fence-start-0001",
      searchText: "",
    }),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
  });
  const request = await deliveredRedemptionRequest(
    started,
    seeded.publicRestaurantId,
    opaqueOfferId(seeded, seeded.coupons[0]),
    context,
    {
      clientRequestId: "signed-concurrent-fence-redeem-a",
      redemptionRequestId: "signed-concurrent-fence-logical-0001",
    },
  );
  const [first, second] = await Promise.all([
    validateCustomerBiteSaverOfferRedemptionStartHandler(request, context),
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {...request, clientRequestId: "signed-concurrent-fence-redeem-b"},
      context,
    ),
  ]);
  assert.deepEqual(second, first);
  assert.equal(first.allowed, true);
  assert.equal(
    [...database.documents.values()].filter((document) =>
      document.role === "logicalRedemptionReplay").length,
    1,
  );
});

test("offer occurrence request bindings fail before any database access", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
  });
  const offerId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[0].sourceDocumentId,
  );
  const request = await deliveredRedemptionRequest(
    started,
    seeded.publicRestaurantId,
    offerId,
    context,
  );
  const tampered = request.offerOccurrence.slice(0, -1) +
    (request.offerOccurrence.endsWith("A") ? "B" : "A");
  const cases = [
    {...request, offerOccurrence: tampered},
    {
      ...request,
      clientRequestId: "occurrence-preflight-session-01",
      sessionId: `bss_${Buffer.alloc(32, 42).toString("base64url")}`,
    },
    {
      ...request,
      clientRequestId: "occurrence-preflight-parent-001",
      restaurantId: customerBiteSaverOpaqueRestaurantId(
        secretKey,
        "wrong-occurrence-parent",
      ),
    },
    {
      ...request,
      clientRequestId: "occurrence-preflight-offer-0001",
      offerId: customerBiteSaverOpaqueOfferId(
        secretKey,
        seeded.accountId,
        "coupon",
        "wrong-occurrence-offer",
      ),
    },
    {
      ...request,
      clientRequestId: "occurrence-preflight-caller-001",
      clientInstanceId: "wrong-occurrence-client-0001",
    },
  ];
  for (const invalid of cases) {
    const before = databaseCallCounts(database);
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(invalid, context),
      (error) => assertContractError(error, "invalid-argument"),
    );
    assert.deepEqual(databaseCallCounts(database), before);
  }
});

test("daily preview uses Dart-compatible normalized boolean fields", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    offerOverrides: {
      isActive: " TrUe ",
      availabilityMode: " specificDays ",
      daysOfWeek: [3],
      allDay: " FaLsE ",
      startTime: "00:00",
      endTime: "00:01",
      hideWhenUnavailable: 0,
    },
  });

  const page = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {
      clientRequestId: "dart-bool-preview-request-0001",
    }),
    context,
  );
  assert.equal(page.restaurants.length, 1);
  assert.equal(page.restaurants[0].offers.length, 1);
  const delivered = page.restaurants[0].offers[0];
  assert.equal(delivered.offerType, "dailySpecial");
  assert.equal(delivered.availabilityMode, "specificDays");
  assert.equal(delivered.allDay, false);
  assert.equal(delivered.available, false);
  assert.equal(delivered.availabilityReason, "outsideTimeWindow");
});

test("legacy string proximity radii stay canonical through page and redemption", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {
      usageRule: "Unlimited",
      isProximityOnly: " TrUe ",
      proximityRadiusMiles: "1e1",
    },
  });
  assert.equal(
    database.documents.get(
      `restaurant_accounts/${seeded.accountId}/coupons/${seeded.coupons[0].sourceDocumentId}`,
    ).proximityRadiusMiles,
    "1e1",
  );

  const page = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {
      clientRequestId: "string-radius-page-request-0001",
    }),
    context,
  );
  assert.equal(page.restaurants.length, 1);
  assert.equal(page.restaurants[0].offers.length, 1);
  const preview = page.restaurants[0].offers[0];
  assert.equal(preview.isProximityOnly, true);
  assert.equal(preview.proximityRadiusMiles, 10);
  assert.equal(preview.available, true);

  const offerPage = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "string-radius-offer-page-request-0001",
    }),
    context,
  );
  assert.equal(offerPage.offers.length, 1);
  const delivered = offerPage.offers[0];
  assert.equal(delivered.isProximityOnly, true);
  assert.equal(delivered.proximityRadiusMiles, 10);
  assert.equal(delivered.available, true);

  const redemption = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    redemptionRequest(started, seeded.publicRestaurantId, delivered.offerId, {
      clientRequestId: "string-radius-redemption-0001",
      redemptionRequestId: "string-radius-redemption-occurrence-0001",
      offerOccurrence: delivered.offerOccurrence,
      currentCoordinates: {
        latitude: 28.5383,
        longitude: -81.3792,
        capturedAtMillis: nowMs,
      },
    }),
    context,
  );
  assert.equal(redemption.allowed, true);
  assert.equal(redemption.reason, "available");
});

test("proximity redemption requires exact fresh current coordinates", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const restaurant = {latitude: 28.5383, longitude: -81.3792};
  const boundaryCoordinates = {
    latitude: restaurant.latitude + (1_609.344 / 6_378_137) * (180 / Math.PI),
    longitude: restaurant.longitude,
  };
  const radius = exactCustomerBiteSaverDistanceMiles(
    restaurant,
    boundaryCoordinates,
  );
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {
      usageRule: "Once per customer",
      isProximityOnly: true,
      proximityRadiusMiles: radius,
    },
  });
  const offerId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[0].sourceDocumentId,
  );
  const base = await deliveredRedemptionRequest(
    started,
    seeded.publicRestaurantId,
    offerId,
    context,
  );

  for (const [index, [coordinates, reason]] of [
    [null, "missingFreshLocation"],
    [{...boundaryCoordinates, capturedAtMillis: nowMs - 120_001}, "missingFreshLocation"],
    [{
      latitude: boundaryCoordinates.latitude + 0.000001,
      longitude: boundaryCoordinates.longitude,
      capturedAtMillis: nowMs,
    }, "outsideProximity"],
  ].entries()) {
    const response = await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...base,
        clientRequestId: `redeem-proximity-${index.toString().padStart(4, "0")}`,
        redemptionRequestId:
          `redeem-proximity-occurrence-${index.toString().padStart(4, "0")}`,
        currentCoordinates: coordinates,
      },
      context,
    );
    assert.equal(response.allowed, false);
    assert.equal(response.reason, reason);
  }
  const boundary = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    {
      ...base,
      clientRequestId: "redeem-proximity-boundary",
      redemptionRequestId: "redeem-proximity-occurrence-boundary",
      currentCoordinates: {...boundaryCoordinates, capturedAtMillis: nowMs},
    },
    context,
  );
  assert.equal(boundary.allowed, true);
  assert.equal(boundary.reason, "available");
});

test("typed-location sessions cannot redeem proximity-only offers", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    request: {
      searchText: "",
      locationMode: "typed",
      typedLocation: {kind: "city", city: "Orlando", state: "Florida"},
    },
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    exactPreferenceRank: 0,
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {
      usageRule: "Once per customer",
      isProximityOnly: true,
      proximityRadiusMiles: 10,
    },
  });
  const offerId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[0].sourceDocumentId,
  );
  const response = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    redemptionRequest(started, seeded.publicRestaurantId, offerId, {
      offerOccurrence: fixtureOfferOccurrence(
        database,
        started,
        seeded,
        seeded.coupons[0],
      ),
      currentCoordinates: {
        latitude: 28.5383,
        longitude: -81.3792,
        capturedAtMillis: nowMs,
      },
    }),
    context,
  );
  assert.equal(response.allowed, false);
  assert.equal(response.reason, "typedLocation");
});

test("redemption honors signed usage failures without leakage", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "redemption-owner";
  const signedContext = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
  });
  const signedStart = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    signedContext,
  );
  const signedSession = markSessionReady(database, signedStart);
  const signedSeed = addReadyRestaurant(database, signedSession, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const signedOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    signedSeed.accountId,
    "coupon",
    signedSeed.coupons[0].sourceDocumentId,
  );
  const signedRequest = await deliveredRedemptionRequest(
    signedStart,
    signedSeed.publicRestaurantId,
    signedOfferId,
    signedContext,
  );
  database.documents.set(
    `customer_redemptions/${uid}/coupon_redemptions/${signedSeed.coupons[0].sourceDocumentId}`,
    {
      restaurantAccountId: signedSeed.accountId,
      couponId: signedSeed.coupons[0].sourceDocumentId,
      lastRedeemedAt: new Date(nowMs - 1_000),
      otherCustomerCanary: "admin-private-canary",
    },
  );
  const used = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    signedRequest,
    signedContext,
  );
  assert.equal(used.allowed, false);
  assert.equal(used.reason, "used");
  assertNoPrivateCanaries(used);

  database.failGetDocumentsWhen = (paths) =>
    paths.some((path) => path.startsWith("customer_redemptions/"));
  const usageReadFailure = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    {
      ...signedRequest,
      clientRequestId: "redeem-usage-failure-0002",
      redemptionRequestId: "redemption-occurrence-0002",
    },
    signedContext,
  );
  assert.equal(usageReadFailure.allowed, false);
  assert.equal(usageReadFailure.reason, "usageUnknown");
  assertNoPrivateCanaries(usageReadFailure);
  database.failGetDocumentsWhen = null;

  database.documents.set(
    `customer_redemptions/${uid}/coupon_redemptions/${signedSeed.coupons[0].sourceDocumentId}`,
    {
      restaurantAccountId: "another-customer-restaurant",
      couponId: signedSeed.coupons[0].sourceDocumentId,
      lastRedeemedAt: new Date(nowMs - 1_000),
    },
  );
  const identityMismatch = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    {
      ...signedRequest,
      clientRequestId: "redeem-usage-mismatch-0003",
      redemptionRequestId: "redemption-occurrence-0003",
    },
    signedContext,
  );
  assert.equal(identityMismatch.allowed, false);
  assert.equal(identityMismatch.reason, "usageUnknown");
  assertNoPrivateCanaries(identityMismatch);
});

test("distinct page continuations re-evaluate current schedule time", async (t) => {
  await t.test("restaurant page", async () => {
    let clock = nowMs;
    const database = new InMemoryCustomerBiteSaverSearchDatabase();
    const context = createContext(database, {now: () => clock});
    const started = await startCustomerBiteSaverSearchHandler(
      startRequest({searchText: ""}),
      context,
    );
    const session = markSessionReady(database, started);
    for (let index = 0; index < 25; index += 1) {
      addReadyRestaurant(database, session, index, {
        offerCount: 1,
        onlyCoupons: true,
      });
    }
    addReadyRestaurant(database, session, 25, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {endTime: new Date(nowMs + 10_000)},
    });
    const first = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {clientRequestId: "time-page-restaurants-0001"}),
      context,
    );
    assert.equal(first.restaurants.length, 25);
    assert.notEqual(first.nextCursor, null);
    clock += 20_000;
    const continued = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId: "time-page-restaurants-0002",
        cursor: first.nextCursor,
      }),
      context,
    );
    assert.deepEqual(continued.restaurants, []);
    assert.equal(continued.nextCursor, null);
  });

  await t.test("offer page", async () => {
    let clock = nowMs;
    const database = new InMemoryCustomerBiteSaverSearchDatabase();
    const context = createContext(database, {now: () => clock});
    const started = await startCustomerBiteSaverSearchHandler(
      startRequest({searchText: ""}),
      context,
    );
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0, {
      offerCount: 26,
      onlyCoupons: true,
      offerOverrides: {endTime: new Date(nowMs + 10_000)},
    });
    const first = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "time-page-offers-0001",
      }),
      context,
    );
    assert.equal(first.offers.length, 25);
    assert.notEqual(first.nextCursor, null);
    clock += 20_000;
    const continued = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "time-page-offers-0002",
        cursor: first.nextCursor,
      }),
      context,
    );
    assert.deepEqual(continued.offers, []);
    assert.equal(continued.nextCursor, null);
  });
});

test("delivered offer identity and occurrence remain usable after sixteen minutes", async () => {
  let clock = nowMs;
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const uid = "long-lived-delivery-owner";
  const context = createContext(database, {
    identity: {authUid: uid, authIsAnonymous: false},
    now: () => clock,
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Unlimited"},
  });
  const page = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "long-lived-offer-page-0001",
    }),
    context,
  );
  const delivered = page.offers[0];
  const mapping = [...database.documents.values()].find((document) =>
    document.role === "deliveredOfferIdentity");
  assert.notEqual(mapping, undefined);
  assert.equal(mapping.logicalExpiresAt.getTime(), session.absoluteExpiresAt.getTime());
  assert.equal(mapping.expiresAt.getTime(), session.absoluteExpiresAt.getTime());

  database.documents.set(
    `user_profiles/${uid}/favorite_coupons/${seeded.coupons[0].sourceDocumentId}`,
    {
      restaurantAccountId: seeded.accountId,
      couponId: seeded.coupons[0].sourceDocumentId,
    },
  );
  clock = nowMs + 10 * 60_000;
  await getCustomerBiteSaverSearchStatusHandler(boundRequest(started, {
    clientRequestId: "long-lived-status-touch-0001",
  }), context);
  clock = nowMs + 16 * 60_000;
  const favorite = await getCustomerBiteSaverFavoriteStatesHandler(
    favoriteRequest(started, {
      clientRequestId: "long-lived-favorite-0001",
      offerIds: [delivered.offerId],
    }),
    context,
  );
  assert.deepEqual(favorite.states, [
    {id: delivered.offerId, state: "favorite"},
  ]);
  const redemption = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    redemptionRequest(started, seeded.publicRestaurantId, delivered.offerId, {
      clientRequestId: "long-lived-redemption-0001",
      offerOccurrence: delivered.offerOccurrence,
      redemptionRequestId: "long-lived-redemption-occurrence-0001",
    }),
    context,
  );
  assert.equal(redemption.allowed, true);
  assert.equal(redemption.evaluatedAtMillis, clock);
});

test("redemption replay preserves its anchor while rechecking current time", async () => {
  let clock = nowMs;
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database, {now: () => clock});
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const endTime = new Date(nowMs + 10_000);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Unlimited", endTime},
  });
  const offerId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    seeded.coupons[0].sourceDocumentId,
  );
  const request = await deliveredRedemptionRequest(
    started,
    seeded.publicRestaurantId,
    offerId,
    context,
    {
      clientRequestId: "boundary-redemption-replay-0001",
      redemptionRequestId: "boundary-redemption-occurrence-0001",
    },
  );
  const first = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    request,
    context,
  );
  assert.equal(first.allowed, true);
  assert.equal(first.validationExpiresAtMillis, endTime.getTime() + 1);

  clock = endTime.getTime() + 1;
  const retry = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    request,
    context,
  );
  assert.equal(retry.allowed, false);
  assert.equal(retry.reason, "expired");
  assert.equal(retry.evaluatedAtMillis, nowMs);
  assert.equal(retry.validationId, null);
});

test("favorite resolution rejects a corrupt result identity binding", async () => {
  const database = new InMemoryCustomerBiteSaverSearchDatabase();
  const context = createContext(database, {
    identity: {authUid: "corrupt-result-owner", authIsAnonymous: false},
  });
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest({searchText: ""}),
    context,
  );
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0);
  const issued = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {clientRequestId: "corrupt-favorite-page-0001"}),
    context,
  );
  assert.deepEqual(
    issued.restaurants.map((entry) => entry.restaurantId),
    [seeded.publicRestaurantId],
  );
  database.documents.set(seeded.resultPath, {
    ...database.documents.get(seeded.resultPath),
    publicRestaurantId: customerBiteSaverOpaqueRestaurantId(
      secretKey,
      "forged-result-account",
    ),
  });
  await assert.rejects(
    getCustomerBiteSaverFavoriteStatesHandler(
      favoriteRequest(started, {
        restaurantIds: [seeded.publicRestaurantId],
      }),
      context,
    ),
    (error) => assertContractError(error, "failed-precondition"),
  );
});

test("guest restaurant and offer pages complete only after explicit checks", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 2,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });

  const restaurantRequest = pageRequest(started, {
    clientRequestId: "guest-restaurant-page-0001",
    guestStateRevision: 3,
  });
  const restaurantChallenge = await getCustomerBiteSaverSearchPageHandler(
    restaurantRequest,
    context,
  );
  assert.equal(restaurantChallenge.outcome, "guestCheckRequired");
  assert.equal(restaurantChallenge.operation, "restaurantPage");
  assert.equal("result" in restaurantChallenge, false);
  assert.ok(restaurantChallenge.candidates.length > 0);
  assert.ok(restaurantChallenge.candidates.every((candidate) =>
    !Object.hasOwn(candidate, "offerOccurrence")));
  assertNoPrivateCanaries(restaurantChallenge);

  const emptyRestaurantAnswer = guestAnswerRequest(
    started,
    restaurantChallenge,
    [],
  );
  const restaurantComplete =
    await continueCustomerBiteSaverGuestOfferCheckHandler(
      emptyRestaurantAnswer,
      context,
    );
  assert.equal(restaurantComplete.outcome, "complete");
  assert.equal(restaurantComplete.operation, "restaurantPage");
  assert.equal(restaurantComplete.result.restaurants.length, 1);
  assert.equal(
    restaurantComplete.result.restaurants[0].restaurantId,
    seeded.publicRestaurantId,
  );

  const offerRequest = offerPageRequest(started, seeded.publicRestaurantId, {
    clientRequestId: "guest-offer-page-start-0001",
    guestStateRevision: 3,
  });
  const offerChallenge = await getCustomerBiteSaverOfferPageHandler(
    offerRequest,
    context,
  );
  assert.equal(offerChallenge.outcome, "guestCheckRequired");
  assert.equal(offerChallenge.operation, "offerPage");
  assert.equal("result" in offerChallenge, false);
  assertNoPrivateCanaries(offerChallenge);
  assert.deepEqual(
    await getCustomerBiteSaverOfferPageHandler(offerRequest, context),
    offerChallenge,
  );

  const emptyOfferAnswer = guestAnswerRequest(started, offerChallenge, []);
  const offerComplete = await continueCustomerBiteSaverGuestOfferCheckHandler(
    emptyOfferAnswer,
    context,
  );
  assert.equal(offerComplete.outcome, "complete");
  assert.equal(offerComplete.operation, "offerPage");
  assert.equal(offerComplete.result.offers.length, 2);
  assert.deepEqual(
    await continueCustomerBiteSaverGuestOfferCheckHandler(
      emptyOfferAnswer,
      context,
    ),
    offerComplete,
  );
});

test("guest restaurant previews retain mixed offer selection after daily prefix", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  addReadyRestaurant(database, session, 0, {
    offerCount: 7,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const history = new SimulatedLocalGuestHistory([], 8);
  const originalRequest = pageRequest(started, {
    clientRequestId: "guest-mixed-preview-page-0001",
    guestStateRevision: history.revision,
  });
  let response = await getCustomerBiteSaverSearchPageHandler(
    originalRequest,
    context,
  );
  let rounds = 0;
  while (response.outcome === "guestCheckRequired") {
    rounds += 1;
    assert.ok(rounds <= 10);
    response = await continueCustomerBiteSaverGuestOfferCheckHandler(
      history.answer(started, response),
      context,
    );
  }
  assert.equal(response.outcome, "complete");
  assert.equal(response.result.restaurants.length, 1);
  assert.deepEqual(
    response.result.restaurants[0].offers.map(({offerType}) => offerType),
    ["dailySpecial", "coupon"],
  );
});

test("guest offer paging intersects large local history and reaches offer 101", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 101,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const firstHundred = seeded.coupons.slice(0, 100).map((candidate) =>
    opaqueOfferId(seeded, candidate));
  const irrelevant = Array.from({length: 9_900}, (_, index) =>
    customerBiteSaverOpaqueOfferId(
      secretKey,
      `irrelevant-history-account-${index}`,
      "coupon",
      `irrelevant-history-offer-${index}`,
    ));
  const history = new SimulatedLocalGuestHistory([
    ...irrelevant.slice(0, 150),
    ...firstHundred,
    ...irrelevant.slice(150),
  ], 41);
  assert.equal(history.unavailableOfferIds.size, 10_000);
  assert.ok(
    [...history.unavailableOfferIds].indexOf(firstHundred[0]) > 75,
  );

  let response = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-large-history-page-0001",
      guestStateRevision: history.revision,
    }),
    context,
  );
  let firstAnswer = null;
  let firstResume = null;
  let rounds = 0;
  while (response.outcome === "guestCheckRequired") {
    rounds += 1;
    assert.ok(rounds <= 10);
    const answer = history.answer(started, response);
    const resumed = await continueCustomerBiteSaverGuestOfferCheckHandler(
      answer,
      context,
    );
    if (firstAnswer === null) {
      firstAnswer = answer;
      firstResume = resumed;
      assert.equal(firstResume.outcome, "guestCheckRequired");
      assert.deepEqual(
        await continueCustomerBiteSaverGuestOfferCheckHandler(answer, context),
        resumed,
      );
      const staleAnswer = {
        ...answer,
        clientRequestId: "guest-stale-prior-batch-answer-0001",
      };
      const beforeState = databaseDocumentState(database);
      await assert.rejects(
        continueCustomerBiteSaverGuestOfferCheckHandler(staleAnswer, context),
        (error) => assertContractError(error, "failed-precondition"),
      );
      assert.equal(databaseDocumentState(database), beforeState);
    }
    response = resumed;
  }

  assert.notEqual(firstAnswer, null);
  assert.notEqual(firstResume, null);
  assert.equal(response.outcome, "complete");
  assert.equal(response.result.offers.length, 1);
  assert.equal(
    response.result.offers[0].offerId,
    opaqueOfferId(seeded, seeded.coupons[100]),
  );
  assert.equal(response.result.hasMore, false);
  assert.ok(history.checkedBatches.length > 1);
  assert.ok(history.checkedBatches.every((batch) =>
    batch.length <= customerBiteSaverGuestCheckMaximumCandidateIds));
  assert.ok(history.answers.every((answer) =>
    answer.length <= customerBiteSaverGuestCheckMaximumCandidateIds));
  assert.ok(history.answers.slice(0, -1).every((answer, index) =>
    answer.length === history.checkedBatches[index].length));
  assert.equal(history.checkedBatches.flat().length, 101);
  assert.equal(new Set(history.checkedBatches.flat()).size, 101);
  assert.equal(history.answers.flat().length, 100);
  assert.equal(databaseDocumentState(database).includes(irrelevant[0]), false);
  assertNoPrivateCanaries(response);
});

test("guest offer-page refresh preserves its original scheduled-start anchor", async () => {
  const originalEvaluationAt = 1_788_955_200_000;
  const scheduledStartAt = 1_788_955_260_000;
  const refreshAt = 1_788_955_500_000;
  assert.equal(nowMs, originalEvaluationAt);
  let clock = originalEvaluationAt;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {
      clientRequestId: "guest-time-anchor-offer-start-0001",
      searchText: "",
    },
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 27,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  replaceReadyCoupon(database, seeded, 0, {
    startTime: new Date(scheduledStartAt),
  }, originalEvaluationAt);
  replaceReadyCoupon(database, seeded, 26, {
    usageRule: "Unlimited",
  }, originalEvaluationAt);
  const orderedOfferIds = seeded.coupons.map((candidate) =>
    opaqueOfferId(seeded, candidate));
  const scheduledOfferId = orderedOfferIds[0];
  const finalUnlimitedOfferId = orderedOfferIds[26];
  const originalRequest = offerPageRequest(
    started,
    seeded.publicRestaurantId,
    {
      clientRequestId: "guest-time-anchor-offer-page-0001",
      guestStateRevision: 404,
    },
  );

  const initial = await getCustomerBiteSaverOfferPageHandler(
    originalRequest,
    context,
  );
  assert.equal(initial.outcome, "guestCheckRequired");
  assert.equal(initial.evaluationContext.evaluationAtMillis, originalEvaluationAt);
  assert.equal(initial.logicalExpiresAtMillis, refreshAt);
  assert.deepEqual(
    initial.candidates.map(({offerId}) => offerId),
    orderedOfferIds.slice(1, 26),
  );
  assert.equal(initial.candidates.some(({offerId}) =>
    offerId === scheduledOfferId), false);
  assert.equal("nextCursor" in initial, false);
  const documentPath =
    `${privateCustomerBiteSaverGuestOfferCheckCollection}/${initial.operationRef}`;
  const initialDocument = structuredClone(database.documents.get(documentPath));
  assert.equal(initialDocument.evaluationAt.getTime(), originalEvaluationAt);
  assert.equal(initialDocument.progress.scanBoundary, null);
  assert.deepEqual(initialDocument.activeBatch.nextOfferBoundary, [
    1,
    seeded.coupons[25].sourceCreatedAtOrderKey,
    seeded.coupons[25].sourceDocumentId,
  ]);
  const staleAnswer = guestAnswerRequest(
    started,
    initial,
    initial.candidates.map(({offerId}) => offerId),
    {clientRequestId: "guest-time-anchor-offer-stale-answer-0001"},
  );

  clock = refreshAt;
  const refreshed = await getCustomerBiteSaverOfferPageHandler(
    {
      ...originalRequest,
      clientRequestId: "guest-time-anchor-offer-refresh-0002",
    },
    context,
  );
  assert.equal(refreshed.outcome, "guestCheckRequired");
  assert.equal(refreshed.operationRef, initial.operationRef);
  assert.equal(refreshed.batchSequence, initial.batchSequence + 1);
  assert.notEqual(refreshed.checkToken, initial.checkToken);
  assert.deepEqual(refreshed.candidates, initial.candidates);
  assert.equal(
    refreshed.evaluationContext.evaluationAtMillis,
    originalEvaluationAt,
  );
  assert.equal(
    refreshed.evaluationContext.availabilityGeneration,
    initial.evaluationContext.availabilityGeneration,
  );
  assert.equal(
    refreshed.logicalExpiresAtMillis,
    refreshAt + customerBiteSaverGuestCheckLifetimeMilliseconds,
  );
  const refreshedDocument = database.documents.get(documentPath);
  assert.equal(refreshedDocument.evaluationAt.getTime(), originalEvaluationAt);
  assert.deepEqual(refreshedDocument.progress, initialDocument.progress);
  assert.equal(refreshedDocument.activeBatch.issuedAtMillis, refreshAt);
  assert.equal(
    refreshedDocument.activeBatch.expiresAtMillis,
    refreshAt + customerBiteSaverGuestCheckLifetimeMilliseconds,
  );
  assert.deepEqual(
    refreshedDocument.activeBatch.nextOfferBoundary,
    initialDocument.activeBatch.nextOfferBoundary,
  );
  await assert.rejects(
    continueCustomerBiteSaverGuestOfferCheckHandler(staleAnswer, context),
    (error) => assertContractError(error, "failed-precondition"),
  );

  const completed = await continueCustomerBiteSaverGuestOfferCheckHandler(
    guestAnswerRequest(
      started,
      refreshed,
      refreshed.candidates.map(({offerId}) => offerId),
      {clientRequestId: "guest-time-anchor-offer-answer-0002"},
    ),
    context,
  );
  assert.equal(completed.outcome, "complete");
  assert.equal(completed.evaluationContext.evaluationAtMillis, originalEvaluationAt);
  assert.deepEqual(
    completed.result.offers.map(({offerId}) => offerId),
    [finalUnlimitedOfferId],
  );
  assert.equal(completed.result.hasMore, false);
  assert.equal(completed.result.nextCursor, null);
  assert.equal(completed.result.partial, false);
  assert.deepEqual(
    [
      ...refreshed.candidates.map(({offerId}) => offerId),
      ...completed.result.offers.map(({offerId}) => offerId),
    ],
    orderedOfferIds.slice(1),
  );
  assert.equal(
    new Set([
      ...refreshed.candidates.map(({offerId}) => offerId),
      ...completed.result.offers.map(({offerId}) => offerId),
    ]).size,
    26,
  );
  const completedDocument = database.documents.get(documentPath);
  assert.equal(completedDocument.progress.sourceExhausted, true);
  assert.deepEqual(completedDocument.progress.scanBoundary, [
    1,
    seeded.coupons[26].sourceCreatedAtOrderKey,
    seeded.coupons[26].sourceDocumentId,
  ]);

  const fresh = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-time-anchor-offer-fresh-0003",
      guestStateRevision: 405,
    }),
    context,
  );
  assert.equal(fresh.outcome, "guestCheckRequired");
  assert.notEqual(fresh.operationRef, initial.operationRef);
  assert.equal(fresh.batchSequence, 0);
  assert.equal(fresh.evaluationContext.evaluationAtMillis, refreshAt);
  assert.deepEqual(
    fresh.candidates.map(({offerId}) => offerId),
    orderedOfferIds.slice(0, 26),
  );
  const freshCompleted = await continueCustomerBiteSaverGuestOfferCheckHandler(
    guestAnswerRequest(
      started,
      fresh,
      orderedOfferIds.slice(1, 26),
      {clientRequestId: "guest-time-anchor-offer-fresh-answer-0003"},
    ),
    context,
  );
  assert.equal(freshCompleted.outcome, "complete");
  assert.equal(freshCompleted.evaluationContext.evaluationAtMillis, refreshAt);
  assert.deepEqual(
    freshCompleted.result.offers.map(({offerId}) => offerId),
    [scheduledOfferId, finalUnlimitedOfferId],
  );
  assert.equal(freshCompleted.result.hasMore, false);
  assert.equal(freshCompleted.result.nextCursor, null);
  assert.equal(freshCompleted.result.partial, false);
});

test("guest restaurant-page refresh preserves scheduled-offer membership", async () => {
  const originalEvaluationAt = 1_788_955_200_000;
  const scheduledStartAt = 1_788_955_260_000;
  const refreshAt = 1_788_955_500_000;
  let clock = originalEvaluationAt;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {
      clientRequestId: "guest-time-anchor-restaurant-start-0001",
      searchText: "",
    },
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 3,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  replaceReadyCoupon(database, seeded, 0, {
    usageRule: "Unlimited",
    startTime: new Date(scheduledStartAt),
  }, originalEvaluationAt);
  const orderedOfferIds = seeded.coupons.map((candidate) =>
    opaqueOfferId(seeded, candidate));
  const originalRequest = pageRequest(started, {
    clientRequestId: "guest-time-anchor-restaurant-page-0001",
    guestStateRevision: 406,
  });

  const initial = await getCustomerBiteSaverSearchPageHandler(
    originalRequest,
    context,
  );
  assert.equal(initial.outcome, "guestCheckRequired");
  assert.equal(initial.operation, "restaurantPage");
  assert.equal(initial.evaluationContext.evaluationAtMillis, originalEvaluationAt);
  assert.equal(initial.logicalExpiresAtMillis, refreshAt);
  assert.deepEqual(
    initial.candidates.map(({offerId}) => offerId),
    orderedOfferIds.slice(1),
  );
  const documentPath =
    `${privateCustomerBiteSaverGuestOfferCheckCollection}/${initial.operationRef}`;
  const initialDocument = structuredClone(database.documents.get(documentPath));
  assert.equal(initialDocument.evaluationAt.getTime(), originalEvaluationAt);
  assert.equal(initialDocument.progress.currentRestaurant.liveBoundary, null);
  assert.deepEqual(initialDocument.progress.currentRestaurant.retainedOffers, []);
  assert.equal(initialDocument.progress.currentRestaurant.visibleOfferCount, 0);
  assert.equal(initialDocument.progress.currentRestaurant.countKnown, true);
  assert.deepEqual(initialDocument.activeBatch.nextOfferBoundary, [
    1,
    seeded.coupons[2].sourceCreatedAtOrderKey,
    seeded.coupons[2].sourceDocumentId,
  ]);

  clock = refreshAt;
  const refreshed = await getCustomerBiteSaverSearchPageHandler(
    {
      ...originalRequest,
      clientRequestId: "guest-time-anchor-restaurant-refresh-0002",
    },
    context,
  );
  assert.equal(refreshed.outcome, "guestCheckRequired");
  assert.equal(refreshed.operationRef, initial.operationRef);
  assert.equal(refreshed.batchSequence, initial.batchSequence + 1);
  assert.notEqual(refreshed.checkToken, initial.checkToken);
  assert.deepEqual(refreshed.candidates, initial.candidates);
  assert.equal(
    refreshed.evaluationContext.evaluationAtMillis,
    originalEvaluationAt,
  );
  assert.equal(
    refreshed.logicalExpiresAtMillis,
    refreshAt + customerBiteSaverGuestCheckLifetimeMilliseconds,
  );
  const refreshedDocument = database.documents.get(documentPath);
  assert.equal(refreshedDocument.evaluationAt.getTime(), originalEvaluationAt);
  assert.deepEqual(refreshedDocument.progress, initialDocument.progress);
  assert.equal(refreshedDocument.activeBatch.issuedAtMillis, refreshAt);
  assert.deepEqual(
    refreshedDocument.activeBatch.nextOfferBoundary,
    initialDocument.activeBatch.nextOfferBoundary,
  );

  const completed = await continueCustomerBiteSaverGuestOfferCheckHandler(
    guestAnswerRequest(
      started,
      refreshed,
      refreshed.candidates.map(({offerId}) => offerId),
      {clientRequestId: "guest-time-anchor-restaurant-answer-0002"},
    ),
    context,
  );
  assert.equal(completed.outcome, "complete");
  assert.equal(completed.evaluationContext.evaluationAtMillis, originalEvaluationAt);
  assert.deepEqual(completed.result.restaurants, []);
  assert.equal(completed.result.hasMore, false);
  assert.equal(completed.result.nextCursor, null);
  assert.equal(completed.result.partial, false);
  const completedDocument = database.documents.get(documentPath);
  assert.equal(completedDocument.progress.currentRestaurant, null);
  assert.equal(completedDocument.progress.resultSourceExhausted, true);

  const fresh = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {
      clientRequestId: "guest-time-anchor-restaurant-fresh-0003",
      guestStateRevision: 407,
    }),
    context,
  );
  assert.equal(fresh.outcome, "guestCheckRequired");
  assert.notEqual(fresh.operationRef, initial.operationRef);
  assert.equal(fresh.evaluationContext.evaluationAtMillis, refreshAt);
  assert.deepEqual(
    fresh.candidates.map(({offerId}) => offerId),
    orderedOfferIds.slice(1),
  );
  const freshDocumentPath =
    `${privateCustomerBiteSaverGuestOfferCheckCollection}/${fresh.operationRef}`;
  const freshDocument = database.documents.get(freshDocumentPath);
  assert.deepEqual(
    freshDocument.progress.currentRestaurant.retainedOffers.map(({offerId}) =>
      offerId),
    [orderedOfferIds[0]],
  );
  assert.equal(freshDocument.progress.currentRestaurant.visibleOfferCount, 1);
  assert.equal(freshDocument.progress.currentRestaurant.countKnown, true);

  const freshCompleted = await continueCustomerBiteSaverGuestOfferCheckHandler(
    guestAnswerRequest(
      started,
      fresh,
      fresh.candidates.map(({offerId}) => offerId),
      {clientRequestId: "guest-time-anchor-restaurant-fresh-answer-0003"},
    ),
    context,
  );
  assert.equal(freshCompleted.outcome, "complete");
  assert.equal(freshCompleted.evaluationContext.evaluationAtMillis, refreshAt);
  assert.deepEqual(
    freshCompleted.result.restaurants.map(({restaurantId}) => restaurantId),
    [seeded.publicRestaurantId],
  );
  const [restaurant] = freshCompleted.result.restaurants;
  assert.deepEqual(
    restaurant.offers.map(({offerId}) => offerId),
    [orderedOfferIds[0]],
  );
  assert.equal(restaurant.hasMoreOffers, false);
  assert.equal(restaurant.usableOfferCount, 1);
  assert.equal(restaurant.offerCountState, "current");
  assert.equal(freshCompleted.result.hasMore, false);
  assert.equal(freshCompleted.result.nextCursor, null);
  assert.equal(freshCompleted.result.partial, false);
});

test("guest pending offer expiry cannot become a stale-positive delivery", async () => {
  const originalEvaluationAt = 1_788_955_200_000;
  const scheduledEndAt = originalEvaluationAt + 60_000;
  let clock = originalEvaluationAt;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {
      clientRequestId: "guest-pending-expiry-start-0001",
      searchText: "",
    },
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {
      usageRule: "Once per customer",
      endTime: new Date(scheduledEndAt),
    },
  });
  const request = offerPageRequest(started, seeded.publicRestaurantId, {
    clientRequestId: "guest-pending-expiry-page-0001",
    guestStateRevision: 408,
  });
  const challenge = await getCustomerBiteSaverOfferPageHandler(
    request,
    context,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  assert.equal(challenge.evaluationContext.evaluationAtMillis, originalEvaluationAt);
  assert.equal(challenge.logicalExpiresAtMillis, scheduledEndAt + 1);
  assert.deepEqual(
    challenge.candidates.map(({offerId}) => offerId),
    [opaqueOfferId(seeded, seeded.coupons[0])],
  );

  clock = challenge.logicalExpiresAtMillis;
  const invalidated = await getCustomerBiteSaverOfferPageHandler(
    {...request, clientRequestId: "guest-pending-expiry-refresh-0002"},
    context,
  );
  assert.equal(invalidated.outcome, "retryRequired");
  assert.equal(invalidated.reason, "sourceChanged");
  assert.equal(invalidated.restartFrom, "originalOperation");
  assert.equal("result" in invalidated, false);
  const operationPath =
    `${privateCustomerBiteSaverGuestOfferCheckCollection}/${challenge.operationRef}`;
  const invalidatedDocument = database.documents.get(operationPath);
  assert.equal(invalidatedDocument.evaluationAt.getTime(), originalEvaluationAt);
  assert.equal(invalidatedDocument.state, "retryRequired");
  assert.equal(invalidatedDocument.activeBatch, null);
});

test("guest page checkpoints enforce daily-special eligibility deadlines", async (t) => {
  const scenarios = [
    {
      name: "inclusive 08:00-08:02 window",
      slug: "window",
      initialAtMs: 1_788_955_200_000,
      deadlineMs: 1_788_955_380_000,
      dailyOverrides: {
        availabilityMode: "specificDays",
        daysOfWeek: [3],
        allDay: false,
        startTime: "08:00",
        endTime: "08:02",
        hideWhenUnavailable: true,
      },
      retainStableOffer: true,
      exerciseLostAnswer: true,
    },
    {
      name: "specificDays local-day boundary",
      slug: "specific-days",
      initialAtMs: 1_789_012_680_000,
      deadlineMs: 1_789_012_800_000,
      dailyOverrides: {
        availabilityMode: "specificDays",
        daysOfWeek: [3],
        allDay: true,
      },
      retainStableOffer: false,
      exerciseLostAnswer: false,
    },
    {
      name: "expiry-less todayOnly local-day boundary",
      slug: "today-only",
      initialAtMs: 1_789_012_680_000,
      deadlineMs: 1_789_012_800_000,
      dailyOverrides: {
        availabilityMode: "todayOnly",
        allDay: true,
      },
      retainStableOffer: false,
      exerciseLostAnswer: false,
    },
    {
      name: "fall-back transition below the window start",
      slug: "fall-back",
      initialAtMs: Date.parse("2026-11-01T05:55:00.000Z"),
      deadlineMs: Date.parse("2026-11-01T06:00:00.000Z"),
      dailyOverrides: {
        availabilityMode: "specificDays",
        daysOfWeek: [7],
        allDay: false,
        startTime: "01:30",
        endTime: "02:30",
        hideWhenUnavailable: true,
      },
      retainStableOffer: true,
      exerciseLostAnswer: true,
    },
  ];
  const operations = [
    {
      name: "offer page",
      slug: "offer",
      expectedRestart: "originalOperation",
      request: (started, seeded, clientRequestId, guestStateRevision) =>
        offerPageRequest(started, seeded.publicRestaurantId, {
          clientRequestId,
          guestStateRevision,
        }),
      invoke: getCustomerBiteSaverOfferPageHandler,
    },
    {
      name: "restaurant page",
      slug: "restaurant",
      expectedRestart: "search",
      request: (started, _seeded, clientRequestId, guestStateRevision) =>
        pageRequest(started, {clientRequestId, guestStateRevision}),
      invoke: getCustomerBiteSaverSearchPageHandler,
    },
  ];

  const retryKeys = [
    "protocolVersion",
    "schemaVersion",
    "outcome",
    "operation",
    "guestStateRevision",
    "reason",
    "restartFrom",
    "logicalExpiresAtMillis",
  ];
  const assertRetry = (response, value) => {
    assertExactKeys(response, retryKeys);
    assert.equal(response.outcome, "retryRequired");
    assert.equal(response.reason, value.reason);
    assert.equal(response.restartFrom, value.restartFrom);
    assert.equal(response.logicalExpiresAtMillis, value.deadlineMs);
    assert.equal("result" in response, false);
    assertNoPrivateCanaries(response);
  };
  const storedOffersFor = (operation, document) => operation.slug === "offer"
    ? document.progress.readyOffers
    : document.progress.currentRestaurant?.retainedOffers ?? [];
  const publicOffersFor = (operation, response) => operation.slug === "offer"
    ? response.result.offers
    : response.result.restaurants.flatMap((restaurant) => restaurant.offers);

  for (const [operationIndex, operation] of operations.entries()) {
    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      await t.test(`${operation.name}: ${scenario.name}`, async () => {
        let clock = scenario.initialAtMs;
        const revision = 420 + operationIndex * 10 + scenarioIndex * 2;
        const requestPrefix =
          `guest-deadline-${operation.slug}-${scenario.slug}`;
        const {database, context, response: started} = await startSession(
          undefined,
          {
            context: {identity: guestIdentity(), now: () => clock},
            request: {
              clientRequestId: `${requestPrefix}-start-0001`,
              searchText: "",
            },
          },
        );
        const session = markSessionReady(database, started);
        const offerCount = scenario.retainStableOffer ? 3 : 2;
        const dailyCreatedAt = new Date(scenario.initialAtMs - 60_000);
        const seeded = addReadyRestaurant(database, session, revision, {
          offerCount,
          offerTypeForIndex: (index) => index === 0
            ? "dailySpecial"
            : "coupon",
          offerOverridesForIndex: (index, offerType) =>
            offerType === "dailySpecial"
              ? {
                  ...scenario.dailyOverrides,
                  createdAt: dailyCreatedAt,
                  updatedAt: dailyCreatedAt,
                }
              : {
                  usageRule: scenario.retainStableOffer && index === 2
                    ? "Unlimited"
                    : "Once per customer",
                },
          offerProjectionNowMs: scenario.initialAtMs,
          resultCreatedAtMs: scenario.initialAtMs,
        });
        const dailyOfferId = opaqueOfferId(seeded, seeded.daily[0]);
        const pendingOfferId = opaqueOfferId(seeded, seeded.coupons[0]);
        const stableOfferId = scenario.retainStableOffer
          ? opaqueOfferId(seeded, seeded.coupons[1])
          : null;
        const expectedRetainedIds = stableOfferId === null
          ? [dailyOfferId]
          : [dailyOfferId, stableOfferId];
        const expectedFreshIds = stableOfferId === null
          ? []
          : [stableOfferId];
        const lastScannedCandidate = seeded.coupons.at(-1);
        const expectedPendingBoundary = [
          1,
          lastScannedCandidate.sourceCreatedAtOrderKey,
          lastScannedCandidate.sourceDocumentId,
        ];
        const originalRequest = operation.request(
          started,
          seeded,
          `${requestPrefix}-page-0001`,
          revision,
        );

        const initial = await operation.invoke(originalRequest, context);
        assert.equal(initial.outcome, "guestCheckRequired");
        assert.equal(initial.operation, operation.slug === "offer"
          ? "offerPage"
          : "restaurantPage");
        assert.equal(
          initial.evaluationContext.evaluationAtMillis,
          scenario.initialAtMs,
        );
        assert.equal(initial.logicalExpiresAtMillis, scenario.deadlineMs);
        assert.deepEqual(initial.candidates, [{
          offerId: pendingOfferId,
          usagePolicy: "oncePerCustomer",
        }]);
        assert.equal("nextCursor" in initial, false);
        const documentPath =
          `${privateCustomerBiteSaverGuestOfferCheckCollection}/${initial.operationRef}`;
        const initialDocument = structuredClone(
          database.documents.get(documentPath),
        );
        assert.equal(initialDocument.state, "awaitingAnswer");
        assert.equal(
          initialDocument.evaluationAt.getTime(),
          scenario.initialAtMs,
        );
        assert.equal(
          initialDocument.logicalExpiresAt.getTime(),
          scenario.deadlineMs,
        );
        assert.equal(
          initialDocument.absoluteExpiresAt.getTime(),
          session.absoluteExpiresAt.getTime(),
        );
        assert.equal(initialDocument.batchSequence, 0);
        assert.equal(
          initialDocument.activeBatch.issuedAtMillis,
          scenario.initialAtMs,
        );
        assert.equal(
          initialDocument.activeBatch.expiresAtMillis,
          scenario.deadlineMs,
        );
        assert.deepEqual(
          initialDocument.activeBatch.nextOfferBoundary,
          expectedPendingBoundary,
        );
        assert.equal(initialDocument.activeBatch.sourceExhausted, true);
        assert.deepEqual(
          initialDocument.activeBatch.candidates.map(({offerId}) => offerId),
          [pendingOfferId],
        );
        const initialStoredOffers = storedOffersFor(
          operation,
          initialDocument,
        );
        assert.deepEqual(
          initialStoredOffers.map(({offerId}) => offerId),
          expectedRetainedIds,
        );
        const storedDaily = initialStoredOffers.find(
          ({offerId}) => offerId === dailyOfferId,
        );
        assert.notEqual(storedDaily, undefined);
        assert.equal(
          storedDaily.eligibilityExpiresAtMs,
          scenario.deadlineMs,
        );
        assert.equal(storedDaily.usagePolicy, null);
        assert.equal(storedDaily.sourceDocumentId, seeded.daily[0].sourceDocumentId);
        assert.equal(storedDaily.indexDocumentId, seeded.daily[0].indexDocumentId);
        assert.equal(
          storedDaily.sourceCreatedAtOrderKey,
          seeded.daily[0].sourceCreatedAtOrderKey,
        );
        if (operation.slug === "offer") {
          assert.equal(initialDocument.progress.scanBoundary, null);
          assert.equal(initialDocument.progress.sourceExhausted, true);
        } else {
          assert.equal(initialDocument.progress.outerBoundary, null);
          assert.equal(initialDocument.progress.readyRestaurants.length, 0);
          assert.notEqual(initialDocument.progress.currentRestaurant, null);
          assert.equal(
            initialDocument.progress.currentRestaurant.restaurantId,
            seeded.publicRestaurantId,
          );
          assert.equal(initialDocument.progress.currentRestaurant.liveBoundary, null);
          assert.equal(
            initialDocument.progress.currentRestaurant.visibleOfferCount,
            expectedRetainedIds.length,
          );
          assert.equal(initialDocument.progress.currentRestaurant.countKnown, true);
        }

        const rawDailyPath =
          `restaurant_accounts/${seeded.accountId}/daily_specials/${seeded.daily[0].sourceDocumentId}`;
        const sourcePaths = [
          `restaurant_accounts/${seeded.accountId}`,
          `${restaurantSearchIndexCollection}/${seeded.restaurantProjection.indexDocumentId}`,
          rawDailyPath,
          `${biteSaverOfferIndexCollection}/${seeded.daily[0].indexDocumentId}`,
          ...seeded.coupons.flatMap((candidate) => [
            `restaurant_accounts/${seeded.accountId}/coupons/${candidate.sourceDocumentId}`,
            `${biteSaverOfferIndexCollection}/${candidate.indexDocumentId}`,
          ]),
        ];
        const sourceBaseline = sourcePaths.map((path) => [
          path,
          structuredClone(database.documents.get(path)),
        ]);
        const baselineEntries = clonedDatabaseEntries(database);
        const branchAt = (atMs) => {
          const branch = {clock: atMs};
          branch.database = new InMemoryCustomerBiteSaverSearchDatabase(
            baselineEntries.map(([path, data]) => [path, structuredClone(data)]),
          );
          branch.context = {
            ...context,
            database: branch.database,
            now: () => branch.clock,
          };
          return branch;
        };
        const assertSourcesUnchanged = (branchDatabase) => {
          for (const [path, source] of sourceBaseline) {
            assert.deepEqual(branchDatabase.documents.get(path), source, path);
          }
        };
        const answerFor = (challenge, suffix) => guestAnswerRequest(
          started,
          challenge,
          challenge.candidates.map(({offerId}) => offerId),
          {clientRequestId: `${requestPrefix}-${suffix}`},
        );
        const assertCompletePage = (response, expectedOfferIds) => {
          assert.equal(response.outcome, "complete");
          assert.equal(
            response.evaluationContext.evaluationAtMillis,
            scenario.initialAtMs,
          );
          assert.equal(response.result.hasMore, false);
          assert.equal(response.result.nextCursor, null);
          assert.equal(response.result.partial, false);
          const offers = publicOffersFor(operation, response);
          assert.deepEqual(
            offers.map(({offerId}) => offerId),
            expectedOfferIds,
          );
          for (const offer of offers) {
            assertExactKeys(offer, publicOfferKeys);
            assert.equal(offer.available, true);
            assert.equal(offer.availabilityReason, "available");
            assert.match(offer.offerOccurrence, /^bsoc1\.[A-Za-z0-9_-]+$/u);
          }
          if (operation.slug === "restaurant") {
            assert.equal(response.result.restaurants.length, 1);
            const [restaurant] = response.result.restaurants;
            assert.equal(restaurant.restaurantId, seeded.publicRestaurantId);
            assert.equal(restaurant.hasMoreOffers, false);
            assert.equal(restaurant.usableOfferCount, expectedOfferIds.length);
            assert.equal(restaurant.offerCountState, "current");
          }
          assertNoPrivateCanaries(response);
        };

        // Immediately before the finite boundary, the original anchored page
        // can still complete and issue occurrences for the still-valid offer.
        const before = branchAt(scenario.deadlineMs - 1);
        const beforeResponse =
          await continueCustomerBiteSaverGuestOfferCheckHandler(
            answerFor(initial, "before-answer-0002"),
            before.context,
          );
        assertCompletePage(beforeResponse, expectedRetainedIds);
        assert.notEqual(
          publicOffersFor(operation, beforeResponse).find(
            ({offerId}) => offerId === dailyOfferId,
          ),
          undefined,
        );
        const beforeDocument = before.database.documents.get(documentPath);
        assert.equal(beforeDocument.state, "completed");
        assert.equal(
          beforeDocument.logicalExpiresAt.getTime(),
          scenario.deadlineMs,
        );
        assertSourcesUnchanged(before.database);

        // Exactly at, and immediately after, the deadline an ordinary answer
        // cannot complete or issue an occurrence from the old positive state.
        for (const [label, atMs] of [
          ["at", scenario.deadlineMs],
          ["after", scenario.deadlineMs + 1],
        ]) {
          const expired = branchAt(atMs);
          const response =
            await continueCustomerBiteSaverGuestOfferCheckHandler(
              answerFor(initial, `${label}-answer-0003`),
              expired.context,
            );
          assertRetry(response, {
            reason: "checkExpired",
            restartFrom: "originalOperation",
            deadlineMs: scenario.deadlineMs,
          });
          const stored = expired.database.documents.get(documentPath);
          assert.equal(stored.state, "awaitingAnswer");
          assert.equal(stored.evaluationAt.getTime(), scenario.initialAtMs);
          assert.equal(stored.logicalExpiresAt.getTime(), scenario.deadlineMs);
          assert.notEqual(stored.activeBatch, null);
          assertSourcesUnchanged(expired.database);
        }

        // A request just before the deadline reuses the bounded batch rather
        // than extending it. At the boundary it transitions once to the
        // operation's existing controlled source-change restart.
        const refresh = branchAt(scenario.deadlineMs - 1);
        const beforeRefresh = await operation.invoke(
          {
            ...originalRequest,
            clientRequestId: `${requestPrefix}-before-refresh-0004`,
          },
          refresh.context,
        );
        assert.equal(beforeRefresh.outcome, "guestCheckRequired");
        assert.equal(beforeRefresh.operationRef, initial.operationRef);
        assert.equal(beforeRefresh.checkToken, initial.checkToken);
        assert.equal(beforeRefresh.batchSequence, initial.batchSequence);
        assert.equal(
          beforeRefresh.evaluationContext.evaluationAtMillis,
          scenario.initialAtMs,
        );
        assert.equal(beforeRefresh.logicalExpiresAtMillis, scenario.deadlineMs);
        refresh.clock = scenario.deadlineMs;
        const invalidated = await operation.invoke(
          {
            ...originalRequest,
            clientRequestId: `${requestPrefix}-deadline-refresh-0005`,
          },
          refresh.context,
        );
        assertRetry(invalidated, {
          reason: "sourceChanged",
          restartFrom: operation.expectedRestart,
          deadlineMs: scenario.deadlineMs,
        });
        const invalidatedDocument = refresh.database.documents.get(documentPath);
        assert.equal(invalidatedDocument.state, "retryRequired");
        assert.equal(invalidatedDocument.activeBatch, null);
        assert.equal(
          invalidatedDocument.evaluationAt.getTime(),
          scenario.initialAtMs,
        );
        assert.equal(
          invalidatedDocument.logicalExpiresAt.getTime(),
          scenario.deadlineMs,
        );
        assert.deepEqual(
          storedOffersFor(operation, invalidatedDocument).map(
            ({offerId}) => offerId,
          ),
          expectedRetainedIds,
        );
        refresh.clock = scenario.deadlineMs + 1;
        const repeatedInvalidation = await operation.invoke(
          {
            ...originalRequest,
            clientRequestId: `${requestPrefix}-repeat-refresh-0006`,
          },
          refresh.context,
        );
        assert.deepEqual(repeatedInvalidation, invalidated);
        assert.equal(
          refresh.database.documents.get(documentPath).batchSequence,
          invalidatedDocument.batchSequence,
        );
        assertSourcesUnchanged(refresh.database);

        // If the clock crosses the boundary after the answer transaction, the
        // ordinary completion path invalidates instead of building a page.
        const crossing = branchAt(scenario.deadlineMs - 1);
        const originalRunTransaction =
          crossing.database.runTransaction.bind(crossing.database);
        let crossedAfterAcceptance = false;
        crossing.database.runTransaction = async (transactionOperation) => {
          const result = await originalRunTransaction(transactionOperation);
          if (
            !crossedAfterAcceptance &&
            result?.document?.state === "answerAccepted"
          ) {
            crossedAfterAcceptance = true;
            crossing.clock = scenario.deadlineMs;
          }
          return result;
        };
        const crossingResponse =
          await continueCustomerBiteSaverGuestOfferCheckHandler(
            answerFor(initial, "crossing-answer-0007"),
            crossing.context,
          );
        assert.equal(crossedAfterAcceptance, true);
        assertRetry(crossingResponse, {
          reason: "sourceChanged",
          restartFrom: operation.expectedRestart,
          deadlineMs: scenario.deadlineMs,
        });
        const crossingDocument = crossing.database.documents.get(documentPath);
        assert.equal(crossingDocument.state, "retryRequired");
        assert.equal(crossingDocument.activeBatch, null);
        assert.equal(crossingDocument.batchSequence, initial.batchSequence + 1);
        assert.notEqual(crossingDocument.lastAcceptedAnswer, null);
        assertSourcesUnchanged(crossing.database);

        if (scenario.exerciseLostAnswer) {
          // Simulate an answer committed while the response is lost. Retrying
          // it at the deadline is rejected, and page refresh performs the same
          // single controlled invalidation without reviving the daily special.
          const lost = branchAt(scenario.deadlineMs - 1);
          const lostRunTransaction = lost.database.runTransaction.bind(
            lost.database,
          );
          const lostResponse = new Error("capture accepted deadline answer");
          let acceptedStateObserved = false;
          lost.database.runTransaction = async (transactionOperation) => {
            const result = await lostRunTransaction(transactionOperation);
            if (
              !acceptedStateObserved &&
              result?.document?.state === "answerAccepted"
            ) {
              acceptedStateObserved = true;
              throw lostResponse;
            }
            return result;
          };
          const answer = answerFor(initial, "lost-answer-0008");
          await assert.rejects(
            continueCustomerBiteSaverGuestOfferCheckHandler(
              answer,
              lost.context,
            ),
            (error) => error === lostResponse,
          );
          lost.database.runTransaction = lostRunTransaction;
          assert.equal(acceptedStateObserved, true);
          const acceptedDocument = lost.database.documents.get(documentPath);
          assert.equal(acceptedDocument.state, "answerAccepted");
          assert.equal(
            acceptedDocument.logicalExpiresAt.getTime(),
            scenario.deadlineMs,
          );
          assert.deepEqual(acceptedDocument.acceptedAnswer, {
            batchSequence: answer.batchSequence,
            clientRequestId: answer.clientRequestId,
            requestFingerprint: persistedGuestAnswerFingerprint(answer),
            unavailableOfferIds: [...answer.unavailableOfferIds],
          });
          lost.clock = scenario.deadlineMs;
          const recovered =
            await continueCustomerBiteSaverGuestOfferCheckHandler(
              answer,
              lost.context,
            );
          assertRetry(recovered, {
            reason: "checkExpired",
            restartFrom: "originalOperation",
            deadlineMs: scenario.deadlineMs,
          });
          const recoveredRefresh = await operation.invoke(
            {
              ...originalRequest,
              clientRequestId: `${requestPrefix}-lost-refresh-0009`,
            },
            lost.context,
          );
          assertRetry(recoveredRefresh, {
            reason: "sourceChanged",
            restartFrom: operation.expectedRestart,
            deadlineMs: scenario.deadlineMs,
          });
          const recoveredDocument = lost.database.documents.get(documentPath);
          assert.equal(recoveredDocument.state, "retryRequired");
          assert.equal(recoveredDocument.activeBatch, null);
          assert.equal(
            recoveredDocument.batchSequence,
            initial.batchSequence + 1,
          );
          assert.notEqual(recoveredDocument.lastAcceptedAnswer, null);
          assertSourcesUnchanged(lost.database);
        }

        // A genuinely fresh operation evaluates at the boundary. It excludes
        // the expired daily special and counts/issues occurrences only for the
        // independently valid stable offer, when this scenario has one.
        const fresh = branchAt(scenario.deadlineMs);
        const freshRequest = operation.request(
          started,
          seeded,
          `${requestPrefix}-fresh-page-0010`,
          revision + 1,
        );
        const freshChallenge = await operation.invoke(
          freshRequest,
          fresh.context,
        );
        assert.equal(freshChallenge.outcome, "guestCheckRequired");
        assert.notEqual(freshChallenge.operationRef, initial.operationRef);
        assert.equal(freshChallenge.batchSequence, 0);
        assert.equal(
          freshChallenge.evaluationContext.evaluationAtMillis,
          scenario.deadlineMs,
        );
        assert.equal(
          freshChallenge.logicalExpiresAtMillis,
          scenario.deadlineMs +
            customerBiteSaverGuestCheckLifetimeMilliseconds,
        );
        assert.deepEqual(freshChallenge.candidates, [{
          offerId: pendingOfferId,
          usagePolicy: "oncePerCustomer",
        }]);
        const freshDocumentPath =
          `${privateCustomerBiteSaverGuestOfferCheckCollection}/${freshChallenge.operationRef}`;
        const freshDocument = fresh.database.documents.get(freshDocumentPath);
        assert.equal(freshDocument.evaluationAt.getTime(), scenario.deadlineMs);
        assert.equal(
          freshDocument.logicalExpiresAt.getTime(),
          session.absoluteExpiresAt.getTime(),
        );
        assert.deepEqual(
          freshDocument.activeBatch.nextOfferBoundary,
          expectedPendingBoundary,
        );
        const freshStoredOffers = storedOffersFor(operation, freshDocument);
        assert.deepEqual(
          freshStoredOffers.map(({offerId}) => offerId),
          expectedFreshIds,
        );
        assert.equal(
          freshStoredOffers.some(({offerId}) => offerId === dailyOfferId),
          false,
        );
        if (operation.slug === "restaurant") {
          assert.equal(
            freshDocument.progress.currentRestaurant.visibleOfferCount,
            expectedFreshIds.length,
          );
          assert.equal(
            freshDocument.progress.currentRestaurant.countKnown,
            true,
          );
        }
        const freshComplete =
          await continueCustomerBiteSaverGuestOfferCheckHandler(
            answerFor(freshChallenge, "fresh-answer-0011"),
            fresh.context,
          );
        assert.equal(freshComplete.outcome, "complete");
        assert.equal(
          freshComplete.evaluationContext.evaluationAtMillis,
          scenario.deadlineMs,
        );
        assert.equal(freshComplete.result.hasMore, false);
        assert.equal(freshComplete.result.nextCursor, null);
        assert.equal(freshComplete.result.partial, false);
        const freshOffers = publicOffersFor(operation, freshComplete);
        assert.deepEqual(
          freshOffers.map(({offerId}) => offerId),
          expectedFreshIds,
        );
        assert.equal(
          freshOffers.some(({offerId}) => offerId === dailyOfferId),
          false,
        );
        for (const offer of freshOffers) {
          assertExactKeys(offer, publicOfferKeys);
          assert.match(offer.offerOccurrence, /^bsoc1\.[A-Za-z0-9_-]+$/u);
        }
        if (operation.slug === "restaurant") {
          assert.equal(
            freshComplete.result.restaurants.length,
            stableOfferId === null ? 0 : 1,
          );
          if (stableOfferId !== null) {
            const [restaurant] = freshComplete.result.restaurants;
            assert.equal(restaurant.restaurantId, seeded.publicRestaurantId);
            assert.equal(restaurant.hasMoreOffers, false);
            assert.equal(restaurant.usableOfferCount, 1);
            assert.equal(restaurant.offerCountState, "current");
          }
        }
        assertNoPrivateCanaries(freshComplete);
        assertSourcesUnchanged(fresh.database);
      });
    }
  }
});

test("guest work-budget recovery keeps its original scheduled-start anchor", async () => {
  const originalEvaluationAt = 1_788_955_200_000;
  const scheduledStartAt = 1_788_955_260_000;
  const recoveryAt = 1_788_955_500_000;
  let clock = originalEvaluationAt;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {
      clientRequestId: "guest-work-budget-anchor-start-0001",
      searchText: "",
    },
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 101,
    onlyCoupons: true,
    offerOverrides: {
      usageRule: "Unlimited",
      startTime: new Date(scheduledStartAt),
    },
  });
  replaceReadyCoupon(database, seeded, 100, {
    startTime: null,
  }, originalEvaluationAt);
  const orderedOfferIds = seeded.coupons.map((candidate) =>
    opaqueOfferId(seeded, candidate));
  const originalRequest = offerPageRequest(
    started,
    seeded.publicRestaurantId,
    {
      clientRequestId: "guest-work-budget-anchor-page-0001",
      guestStateRevision: 409,
    },
  );

  const budgetRetry = await getCustomerBiteSaverOfferPageHandler(
    originalRequest,
    context,
  );
  assert.equal(budgetRetry.outcome, "retryRequired");
  assert.equal(budgetRetry.operation, "offerPage");
  assert.equal(budgetRetry.reason, "workBudget");
  assert.equal(budgetRetry.restartFrom, "originalOperation");
  const documentPaths = [...database.documents.keys()].filter((path) =>
    path.startsWith(`${privateCustomerBiteSaverGuestOfferCheckCollection}/`));
  assert.equal(documentPaths.length, 1);
  const documentPath = documentPaths[0];
  const budgetDocument = database.documents.get(documentPath);
  assert.notEqual(budgetDocument, undefined);
  assert.equal(budgetDocument.evaluationAt.getTime(), originalEvaluationAt);
  assert.equal(budgetDocument.state, "retryRequired");
  assert.equal(budgetDocument.retryReason, "workBudget");
  assert.deepEqual(budgetDocument.progress.scanBoundary, [
    1,
    seeded.coupons[99].sourceCreatedAtOrderKey,
    seeded.coupons[99].sourceDocumentId,
  ]);
  assert.deepEqual(budgetDocument.progress.readyOffers, []);
  assert.equal(budgetDocument.progress.sourceExhausted, false);

  clock = recoveryAt;
  const recovered = await getCustomerBiteSaverOfferPageHandler(
    {
      ...originalRequest,
      clientRequestId: "guest-work-budget-anchor-recovery-0002",
    },
    context,
  );
  assert.equal(recovered.outcome, "complete");
  assert.equal(
    recovered.evaluationContext.evaluationAtMillis,
    originalEvaluationAt,
  );
  assert.deepEqual(
    recovered.result.offers.map(({offerId}) => offerId),
    [orderedOfferIds[100]],
  );
  assert.equal(recovered.result.hasMore, false);
  assert.equal(recovered.result.nextCursor, null);
  assert.equal(recovered.result.partial, false);
  const recoveredDocument = database.documents.get(documentPath);
  assert.equal(recoveredDocument.state, "completed");
  assert.equal(recoveredDocument.evaluationAt.getTime(), originalEvaluationAt);
  assert.deepEqual(recoveredDocument.progress.scanBoundary, [
    1,
    seeded.coupons[100].sourceCreatedAtOrderKey,
    seeded.coupons[100].sourceDocumentId,
  ]);
  assert.equal(recoveredDocument.progress.sourceExhausted, true);

  const fresh = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-work-budget-anchor-fresh-0003",
      guestStateRevision: 410,
    }),
    context,
  );
  assert.equal(fresh.outcome, "complete");
  assert.equal(fresh.evaluationContext.evaluationAtMillis, recoveryAt);
  assert.deepEqual(
    fresh.result.offers.map(({offerId}) => offerId),
    orderedOfferIds.slice(0, 25),
  );
  assert.equal(fresh.result.hasMore, true);
  assert.match(fresh.result.nextCursor, /^bsc1\./u);
  assert.equal(fresh.result.partial, false);
});

test("guest offer checkpoints cross five minutes and refresh in place", async () => {
  let clock = nowMs;
  const originalEvaluationAt = clock;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {
      clientRequestId: "guest-long-checkpoint-start-0001",
      searchText: "",
    },
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1_001,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const unavailableOfferIds = seeded.coupons.slice(0, 1_000).map(
    (candidate) => opaqueOfferId(seeded, candidate),
  );
  const history = new SimulatedLocalGuestHistory(unavailableOfferIds, 73);
  const originalRequest = offerPageRequest(
    started,
    seeded.publicRestaurantId,
    {
      clientRequestId: "guest-long-checkpoint-page-0001",
      guestStateRevision: history.revision,
    },
  );
  let response = await getCustomerBiteSaverOfferPageHandler(
    originalRequest,
    context,
  );
  assert.equal(response.outcome, "guestCheckRequired");
  assert.equal(
    response.evaluationContext.evaluationAtMillis,
    originalEvaluationAt,
  );
  const operationRef = response.operationRef;
  const documentPath =
    `${privateCustomerBiteSaverGuestOfferCheckCollection}/${operationRef}`;
  let answeredBatches = 0;
  let refreshes = 0;
  let maximumDocumentBytes = 0;
  while (response.outcome === "guestCheckRequired") {
    const document = database.documents.get(documentPath);
    assert.notEqual(document, undefined);
    assert.equal(
      response.evaluationContext.evaluationAtMillis,
      originalEvaluationAt,
    );
    assert.equal(document.evaluationAt.getTime(), originalEvaluationAt);
    assert.equal(document.createdAt.getTime(), originalEvaluationAt);
    assert.ok(document.activeBatch.candidates.length <= 75);
    assert.ok(document.progress.readyOffers.length <= 26);
    assert.equal(document.activeBatch.issuedAtMillis, clock);
    assert.equal(
      response.logicalExpiresAtMillis,
      document.activeBatch.expiresAtMillis,
    );
    assert.ok(document.activeBatch.expiresAtMillis > clock);
    assert.ok(
      document.activeBatch.expiresAtMillis <=
        clock + customerBiteSaverGuestCheckLifetimeMilliseconds,
    );
    const liveSession = database.documents.get(
      `${privateCustomerBiteSaverSearchSessionCollection}/${started.sessionId}`,
    );
    assert.ok(
      document.activeBatch.expiresAtMillis <=
        liveSession.logicalExpiresAt.getTime(),
    );
    assert.ok(
      document.activeBatch.expiresAtMillis <=
        document.absoluteExpiresAt.getTime(),
    );
    maximumDocumentBytes = Math.max(
      maximumDocumentBytes,
      Buffer.byteLength(JSON.stringify(document), "utf8"),
    );
    assert.ok(maximumDocumentBytes <= 768 * 1_024);

    const shouldRefresh =
      (refreshes === 0 && answeredBatches === 5) ||
      (refreshes === 1 && answeredBatches === 20);
    if (shouldRefresh) {
      const expiredChallenge = response;
      const checkpointBefore = structuredClone(document.progress);
      const expiredAuthorizationAt = expiredChallenge.logicalExpiresAtMillis;
      clock = expiredChallenge.logicalExpiresAtMillis;
      const refreshed = await getCustomerBiteSaverOfferPageHandler(
        {
          ...originalRequest,
          clientRequestId:
            `guest-long-checkpoint-refresh-${String(refreshes).padStart(4, "0")}`,
        },
        context,
      );
      assert.equal(refreshed.outcome, "guestCheckRequired");
      assert.equal(refreshed.operationRef, expiredChallenge.operationRef);
      assert.equal(
        refreshed.batchSequence,
        expiredChallenge.batchSequence + 1,
      );
      assert.notEqual(refreshed.checkToken, expiredChallenge.checkToken);
      assert.deepEqual(refreshed.candidates, expiredChallenge.candidates);
      assert.equal(
        refreshed.evaluationContext.evaluationAtMillis,
        originalEvaluationAt,
      );
      assert.equal(
        refreshed.evaluationContext.availabilityGeneration,
        expiredChallenge.evaluationContext.availabilityGeneration,
      );
      assert.ok(refreshed.logicalExpiresAtMillis > expiredAuthorizationAt);
      assert.equal(
        refreshed.logicalExpiresAtMillis,
        clock + customerBiteSaverGuestCheckLifetimeMilliseconds,
      );
      const refreshedDocument = database.documents.get(documentPath);
      assert.equal(
        refreshedDocument.evaluationAt.getTime(),
        originalEvaluationAt,
      );
      assert.equal(refreshedDocument.activeBatch.issuedAtMillis, clock);
      assert.equal(
        refreshedDocument.activeBatch.expiresAtMillis,
        refreshed.logicalExpiresAtMillis,
      );
      assert.deepEqual(
        refreshedDocument.progress,
        checkpointBefore,
      );

      const staleAnswer = guestAnswerRequest(
        started,
        expiredChallenge,
        expiredChallenge.candidates.map(({offerId}) => offerId),
        {
          clientRequestId:
            `guest-long-checkpoint-stale-${String(refreshes).padStart(4, "0")}`,
        },
      );
      const stateBeforeStale = databaseDocumentState(database);
      await assert.rejects(
        continueCustomerBiteSaverGuestOfferCheckHandler(
          staleAnswer,
          context,
        ),
        (error) => assertContractError(error, "failed-precondition"),
      );
      assert.equal(databaseDocumentState(database), stateBeforeStale);
      response = refreshed;
      refreshes += 1;
      continue;
    }

    const answer = history.answer(started, response, {
      clientRequestId:
        `guest-long-checkpoint-answer-${String(response.batchSequence)
          .padStart(4, "0")}`,
    });
    clock += 10_000;
    response = await continueCustomerBiteSaverGuestOfferCheckHandler(
      answer,
      context,
    );
    answeredBatches += 1;
    assert.ok(answeredBatches <= 50);
  }

  assert.equal(response.outcome, "complete");
  assert.equal(
    response.evaluationContext.evaluationAtMillis,
    originalEvaluationAt,
  );
  assert.equal(response.result.offers.length, 1);
  assert.equal(
    response.result.offers[0].offerId,
    opaqueOfferId(seeded, seeded.coupons[1_000]),
  );
  assert.equal(response.result.hasMore, false);
  assert.equal(refreshes, 2);
  assert.ok(clock - nowMs > 10 * 60_000);
  assert.equal(history.checkedBatches.flat().length, 1_001);
  assert.equal(new Set(history.checkedBatches.flat()).size, 1_001);
  assert.equal(history.answers.flat().length, 1_000);
  assert.ok(history.checkedBatches.every((batch) => batch.length <= 75));
  assert.ok(maximumDocumentBytes < 768 * 1_024);
});

test("an accepted guest page answer survives response loss and token expiry", async () => {
  let clock = nowMs;
  const originalEvaluationAt = clock;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {
      clientRequestId: "guest-accepted-loss-start-0001",
      searchText: "",
    },
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 30,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const challenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-accepted-loss-page-0001",
      guestStateRevision: 74,
    }),
    context,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  assert.equal(
    challenge.evaluationContext.evaluationAtMillis,
    originalEvaluationAt,
  );
  assert.equal(challenge.candidates.length, 26);
  const answer = guestAnswerRequest(
    started,
    challenge,
    challenge.candidates.map(({offerId}) => offerId),
    {clientRequestId: "guest-accepted-loss-answer-0001"},
  );
  const documentPath =
    `${privateCustomerBiteSaverGuestOfferCheckCollection}/${challenge.operationRef}`;
  const originalRunTransaction = database.runTransaction.bind(database);
  const lostResponse = new Error("accepted guest response lost");
  let captured = false;
  database.runTransaction = async (operation) => {
    const result = await originalRunTransaction(operation);
    if (!captured && result?.document?.state === "answerAccepted") {
      captured = true;
      throw lostResponse;
    }
    return result;
  };
  await assert.rejects(
    continueCustomerBiteSaverGuestOfferCheckHandler(answer, context),
    (error) => error === lostResponse,
  );
  database.runTransaction = originalRunTransaction;
  assert.equal(captured, true);
  const acceptedDocument = database.documents.get(documentPath);
  assert.equal(acceptedDocument.state, "answerAccepted");
  assert.equal(acceptedDocument.evaluationAt.getTime(), originalEvaluationAt);

  clock = challenge.logicalExpiresAtMillis + 1;
  const recovered = await continueCustomerBiteSaverGuestOfferCheckHandler(
    answer,
    context,
  );
  assert.equal(recovered.outcome, "guestCheckRequired");
  assert.equal(
    recovered.evaluationContext.evaluationAtMillis,
    originalEvaluationAt,
  );
  assert.equal(recovered.candidates.length, 4);
  const recoveredDocument = database.documents.get(documentPath);
  assert.equal(recoveredDocument.evaluationAt.getTime(), originalEvaluationAt);
  assert.equal(recoveredDocument.activeBatch.issuedAtMillis, clock);
  assert.ok(recoveredDocument.activeBatch.expiresAtMillis > clock);
  assert.equal(
    recovered.candidates.some(({offerId}) =>
      challenge.candidates.some((candidate) => candidate.offerId === offerId)),
    false,
  );
  const checkpointAfterRecovery = JSON.stringify(
    database.documents.get(documentPath),
  );
  const duplicateRecovery =
    await continueCustomerBiteSaverGuestOfferCheckHandler(answer, context);
  assert.deepEqual(duplicateRecovery, recovered);
  assert.equal(
    JSON.stringify(database.documents.get(documentPath)),
    checkpointAfterRecovery,
  );

  const completed = await continueCustomerBiteSaverGuestOfferCheckHandler(
    guestAnswerRequest(
      started,
      recovered,
      recovered.candidates.map(({offerId}) => offerId),
      {clientRequestId: "guest-accepted-loss-answer-0002"},
    ),
    context,
  );
  assert.equal(completed.outcome, "complete");
  assert.equal(
    completed.evaluationContext.evaluationAtMillis,
    originalEvaluationAt,
  );
  assert.deepEqual(completed.result.offers, []);
  assert.equal(
    new Set([
      ...challenge.candidates.map(({offerId}) => offerId),
      ...recovered.candidates.map(({offerId}) => offerId),
    ]).size,
    30,
  );
});

test("a server checkpoint resumes after its non-null page cursor expires", async () => {
  let clock = nowMs;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {
      clientRequestId: "guest-expired-cursor-start-0001",
      searchText: "",
    },
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 30,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const firstChallenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-expired-cursor-first-0001",
      guestStateRevision: 75,
    }),
    context,
  );
  assert.equal(firstChallenge.outcome, "guestCheckRequired");
  const firstComplete = await continueCustomerBiteSaverGuestOfferCheckHandler(
    guestAnswerRequest(started, firstChallenge, [], {
      clientRequestId: "guest-expired-cursor-first-answer-0001",
    }),
    context,
  );
  assert.equal(firstComplete.outcome, "complete");
  assert.equal(firstComplete.result.offers.length, 25);
  assert.match(firstComplete.result.nextCursor, /^bsc1\./u);

  const continuationRequest = offerPageRequest(
    started,
    seeded.publicRestaurantId,
    {
      clientRequestId: "guest-expired-cursor-second-0001",
      cursor: firstComplete.result.nextCursor,
      guestStateRevision: 75,
    },
  );
  const secondChallenge = await getCustomerBiteSaverOfferPageHandler(
    continuationRequest,
    context,
  );
  assert.equal(secondChallenge.outcome, "guestCheckRequired");
  assert.equal(secondChallenge.candidates.length, 5);
  const staleAnswer = guestAnswerRequest(
    started,
    secondChallenge,
    [],
    {clientRequestId: "guest-expired-cursor-stale-answer-0001"},
  );

  clock = nowMs + customerBiteSaverCursorLifetimeMilliseconds - 60_000;
  const touched = await getCustomerBiteSaverSearchStatusHandler(
    boundRequest(started, {
      clientRequestId: "guest-expired-cursor-status-touch-0001",
    }),
    context,
  );
  assert.equal(touched.state, "ready");
  clock = nowMs + customerBiteSaverCursorLifetimeMilliseconds + 1;
  const refreshed = await getCustomerBiteSaverOfferPageHandler(
    {
      ...continuationRequest,
      clientRequestId: "guest-expired-cursor-second-0002",
    },
    context,
  );
  assert.equal(refreshed.outcome, "guestCheckRequired");
  assert.equal(refreshed.operationRef, secondChallenge.operationRef);
  assert.equal(refreshed.batchSequence, secondChallenge.batchSequence + 1);
  assert.deepEqual(refreshed.candidates, secondChallenge.candidates);
  assert.notEqual(refreshed.checkToken, secondChallenge.checkToken);
  await assert.rejects(
    continueCustomerBiteSaverGuestOfferCheckHandler(staleAnswer, context),
    (error) => assertContractError(error, "failed-precondition"),
  );

  const secondComplete =
    await continueCustomerBiteSaverGuestOfferCheckHandler(
      guestAnswerRequest(started, refreshed, [], {
        clientRequestId: "guest-expired-cursor-second-answer-0002",
      }),
      context,
    );
  assert.equal(secondComplete.outcome, "complete");
  assert.equal(secondComplete.result.offers.length, 5);
  const delivered = [
    ...firstComplete.result.offers,
    ...secondComplete.result.offers,
  ].map(({offerId}) => offerId);
  assert.equal(delivered.length, 30);
  assert.equal(new Set(delivered).size, 30);
});

test("guest checkpoint refresh invalidates revision, source, day, and session changes", async (t) => {
  await t.test("guest revision creates a separately bound operation", async () => {
    const {database, context, response: started} = await startSession(
      undefined,
      {
        context: {identity: guestIdentity()},
        request: {
          clientRequestId: "guest-invalidate-revision-start-0001",
          searchText: "",
        },
      },
    );
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0, {
      offerCount: 2,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    const original = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "guest-invalidate-revision-page-0001",
        guestStateRevision: 80,
      }),
      context,
    );
    const changed = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "guest-invalidate-revision-page-0002",
        guestStateRevision: 81,
      }),
      context,
    );
    assert.equal(original.outcome, "guestCheckRequired");
    assert.equal(changed.outcome, "guestCheckRequired");
    assert.notEqual(changed.operationRef, original.operationRef);
    assert.deepEqual(changed.candidates, original.candidates);
    assert.equal(changed.batchSequence, 0);
    const stateBefore = databaseDocumentState(database);
    await assert.rejects(
      continueCustomerBiteSaverGuestOfferCheckHandler(
        guestAnswerRequest(started, original, [], {
          clientRequestId: "guest-invalidate-revision-answer-0001",
          guestStateRevision: 81,
        }),
        context,
      ),
      (error) => assertContractError(error, "invalid-argument"),
    );
    assert.equal(databaseDocumentState(database), stateBefore);
  });

  await t.test("a withdrawn source invalidates an expired batch", async () => {
    let clock = nowMs;
    const {database, context, response: started} = await startSession(
      undefined,
      {
        context: {identity: guestIdentity(), now: () => clock},
        request: {
          clientRequestId: "guest-invalidate-source-start-0001",
          searchText: "",
        },
      },
    );
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    const originalRequest = offerPageRequest(
      started,
      seeded.publicRestaurantId,
      {
        clientRequestId: "guest-invalidate-source-page-0001",
        guestStateRevision: 82,
      },
    );
    const challenge = await getCustomerBiteSaverOfferPageHandler(
      originalRequest,
      context,
    );
    assert.equal(challenge.outcome, "guestCheckRequired");
    database.documents.delete(
      `restaurant_accounts/${seeded.accountId}/coupons/` +
        seeded.coupons[0].sourceDocumentId,
    );
    clock = challenge.logicalExpiresAtMillis;
    const invalidated = await getCustomerBiteSaverOfferPageHandler(
      {
        ...originalRequest,
        clientRequestId: "guest-invalidate-source-page-0002",
      },
      context,
    );
    assert.equal(invalidated.outcome, "retryRequired");
    assert.equal(invalidated.reason, "sourceChanged");
    assert.equal(invalidated.restartFrom, "originalOperation");
  });

  await t.test("a local-day reset invalidates retained usage decisions", async () => {
    let clock = Date.parse("2026-09-10T03:59:00.000Z");
    const {database, context, response: started} = await startSession(
      undefined,
      {
        context: {identity: guestIdentity(), now: () => clock},
        request: {
          clientRequestId: "guest-invalidate-day-start-0001",
          searchText: "",
        },
      },
    );
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per day"},
    });
    database.documents.set(seeded.resultPath, {
      ...database.documents.get(seeded.resultPath),
      createdAt: new Date(clock),
    });
    const originalRequest = offerPageRequest(
      started,
      seeded.publicRestaurantId,
      {
        clientRequestId: "guest-invalidate-day-page-0001",
        guestStateRevision: 83,
      },
    );
    const challenge = await getCustomerBiteSaverOfferPageHandler(
      originalRequest,
      context,
    );
    assert.equal(challenge.outcome, "guestCheckRequired");
    assert.ok(
      challenge.logicalExpiresAtMillis - clock <
        customerBiteSaverGuestCheckLifetimeMilliseconds,
    );
    clock = challenge.logicalExpiresAtMillis;
    const invalidated = await getCustomerBiteSaverOfferPageHandler(
      {
        ...originalRequest,
        clientRequestId: "guest-invalidate-day-page-0002",
      },
      context,
    );
    assert.equal(invalidated.outcome, "retryRequired");
    assert.equal(invalidated.reason, "sourceChanged");
    assert.equal(invalidated.restartFrom, "originalOperation");
  });

  await t.test("an expired session is reported as sessionChanged", async () => {
    let clock = nowMs;
    const {database, context, response: started} = await startSession(
      undefined,
      {
        context: {identity: guestIdentity(), now: () => clock},
        request: {
          clientRequestId: "guest-invalidate-session-start-0001",
          searchText: "",
        },
      },
    );
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    const challenge = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "guest-invalidate-session-page-0001",
        guestStateRevision: 84,
      }),
      context,
    );
    assert.equal(challenge.outcome, "guestCheckRequired");
    const answer = guestAnswerRequest(started, challenge, []);
    clock = session.logicalExpiresAt.getTime();
    const invalidated = await continueCustomerBiteSaverGuestOfferCheckHandler(
      answer,
      context,
    );
    assert.equal(invalidated.outcome, "retryRequired");
    assert.equal(invalidated.reason, "sessionChanged");
    assert.equal(invalidated.restartFrom, "originalOperation");
    assert.equal("result" in invalidated, false);
  });
});

test("guest local-history size matrix intersects only bounded candidates", async (t) => {
  const historySizes = [0, 1, 74, 75, 76, 150, 1_000, 10_000];
  for (const historySize of historySizes) {
    await t.test(`${historySize} local unavailable IDs`, async () => {
      const {database, context, response: started} = await startSession(
        undefined,
        {
          context: {identity: guestIdentity()},
          request: {searchText: ""},
        },
      );
      const session = markSessionReady(database, started);
      const seeded = addReadyRestaurant(database, session, 0, {
        offerCount: 2,
        onlyCoupons: true,
        offerOverrides: {usageRule: "Once per customer"},
      });
      const relevantOfferId = opaqueOfferId(seeded, seeded.coupons[0]);
      const irrelevant = Array.from(
        {length: Math.max(0, historySize - 1)},
        (_, index) => `bso_${index.toString(36).padStart(43, "0")}`,
      );
      const localUnavailable = historySize === 0
        ? []
        : [...irrelevant, relevantOfferId];
      const history = new SimulatedLocalGuestHistory(
        localUnavailable,
        historySize + 1,
      );
      assert.equal(history.unavailableOfferIds.size, historySize);
      if (historySize > 75) {
        assert.ok(
          [...history.unavailableOfferIds].indexOf(relevantOfferId) >= 75,
        );
      }

      const challenge = await getCustomerBiteSaverOfferPageHandler(
        offerPageRequest(started, seeded.publicRestaurantId, {
          clientRequestId:
            `guest-history-matrix-page-${String(historySize).padStart(5, "0")}`,
          guestStateRevision: history.revision,
        }),
        context,
      );
      assert.equal(challenge.outcome, "guestCheckRequired");
      const answer = history.answer(started, challenge, {
        clientRequestId:
          `guest-history-matrix-answer-${String(historySize).padStart(5, "0")}`,
      });
      assert.ok(
        challenge.candidates.length <=
          customerBiteSaverGuestCheckMaximumCandidateIds,
      );
      assert.ok(
        answer.unavailableOfferIds.length <=
          customerBiteSaverGuestCheckMaximumCandidateIds,
      );
      assert.deepEqual(
        answer.unavailableOfferIds,
        historySize === 0 ? [] : [relevantOfferId],
      );
      if (irrelevant.length > 0) {
        assert.equal(JSON.stringify(answer).includes(irrelevant[0]), false);
        assert.equal(databaseDocumentState(database).includes(irrelevant[0]), false);
      }

      const completed = await continueCustomerBiteSaverGuestOfferCheckHandler(
        answer,
        context,
      );
      assert.equal(completed.outcome, "complete");
      assert.equal(completed.result.offers.length, historySize === 0 ? 2 : 1);
      assert.equal(
        completed.result.offers.some(({offerId}) => offerId === relevantOfferId),
        historySize === 0,
      );
      assert.equal(history.checkedBatches.length, 1);
      assert.equal(history.answers.length, 1);
    });
  }
});

test("guest pagination reaches all 175 eligible restaurants in 25-result pages", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = Array.from({length: 175}, (_, index) =>
    addReadyRestaurant(database, session, index, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    }));
  const history = new SimulatedLocalGuestHistory([], 175);
  const deliveredRestaurantIds = [];
  let cursor = null;
  let pageIndex = 0;
  do {
    let response = await getCustomerBiteSaverSearchPageHandler(
      pageRequest(started, {
        clientRequestId:
          `guest-175-restaurants-page-${String(pageIndex).padStart(4, "0")}`,
        cursor,
        guestStateRevision: history.revision,
      }),
      context,
    );
    let challengeRound = 0;
    while (response.outcome === "guestCheckRequired") {
      challengeRound += 1;
      assert.ok(challengeRound <= customerBiteSaverPageSize + 1);
      assert.equal("result" in response, false);
      const answer = history.answer(started, response, {
        clientRequestId:
          `guest-175-answer-${String(pageIndex).padStart(4, "0")}-${String(
            response.batchSequence,
          ).padStart(4, "0")}`,
      });
      assert.deepEqual(answer.unavailableOfferIds, []);
      response = await continueCustomerBiteSaverGuestOfferCheckHandler(
        answer,
        context,
      );
    }
    assert.equal(response.outcome, "complete");
    assert.equal(response.operation, "restaurantPage");
    assert.equal(response.result.restaurants.length, customerBiteSaverPageSize);
    deliveredRestaurantIds.push(
      ...response.result.restaurants.map(({restaurantId}) => restaurantId),
    );
    cursor = response.result.nextCursor;
    pageIndex += 1;
  } while (cursor !== null);

  assert.equal(pageIndex, 7);
  assert.equal(deliveredRestaurantIds.length, 175);
  assert.equal(new Set(deliveredRestaurantIds).size, 175);
  assert.deepEqual(
    new Set(deliveredRestaurantIds),
    new Set(seeded.map(({publicRestaurantId}) => publicRestaurantId)),
  );
  assert.ok(history.checkedBatches.length > customerBiteSaverPageSize * 7);
  assert.ok(history.checkedBatches.every((batch) =>
    batch.length <= customerBiteSaverGuestCheckMaximumCandidateIds));
  assert.ok(history.answers.every((answer) => answer.length === 0));
});

test("concurrent conflicting guest answers have one committing winner", async () => {
  const database = new SerializedTransactionCustomerBiteSaverSearchDatabase();
  const {context, response: started} = await startSession(database, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 2,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const challenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-concurrent-page-request-0001",
      guestStateRevision: 9,
    }),
    context,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  const answers = [
    guestAnswerRequest(started, challenge, [], {
      clientRequestId: "guest-concurrent-answer-request-a",
    }),
    guestAnswerRequest(started, challenge, [challenge.candidates[0].offerId], {
      clientRequestId: "guest-concurrent-answer-request-b",
    }),
  ];
  const settled = await Promise.allSettled(answers.map((answer) =>
    continueCustomerBiteSaverGuestOfferCheckHandler(answer, context)));
  const fulfilled = settled
    .map((result, index) => ({result, index}))
    .filter(({result}) => result.status === "fulfilled");
  const rejected = settled.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(fulfilled[0].result.value.outcome, "complete");
  assert.ok(
    rejected[0].reason instanceof CustomerBiteSaverContractError &&
      ["resource-exhausted", "failed-precondition"].includes(
        rejected[0].reason.code,
      ),
  );

  const checkPath =
    `${privateCustomerBiteSaverGuestOfferCheckCollection}/${challenge.operationRef}`;
  const acceptedWrites = database.calls.transactionWrites.flat().filter(
    (write) => write.path === checkPath && write.data.state === "answerAccepted",
  );
  assert.equal(acceptedWrites.length, 1);
  const winnerIndex = fulfilled[0].index;
  const completedDocument = database.documents.get(checkPath);
  assert.equal(completedDocument.state, "completed");
  assert.equal(
    completedDocument.lastAcceptedAnswer.clientRequestId,
    answers[winnerIndex].clientRequestId,
  );

  const losingAnswer = answers[winnerIndex === 0 ? 1 : 0];
  const beforeRetry = databaseDocumentState(database);
  await assert.rejects(
    continueCustomerBiteSaverGuestOfferCheckHandler(losingAnswer, context),
    (error) => assertContractError(error, "failed-precondition"),
  );
  assert.equal(databaseDocumentState(database), beforeRetry);
});

test("guest checks retain 75 maximum-domain source IDs within state and token bounds", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const maximumAccountId = "\u0800".repeat(500);
  const maximumOfferId = (index) =>
    "\"".repeat(1_496) + index.toString(36).padStart(4, "0");
  const seeded = addReadyRestaurant(database, session, 0, {
    accountId: maximumAccountId,
    offerCount: customerBiteSaverGuestCheckMaximumCandidateIds,
    onlyCoupons: true,
    offerIdForIndex: maximumOfferId,
    offerOverrides: {usageRule: "Once per customer"},
  });
  assert.equal(Buffer.byteLength(maximumAccountId, "utf8"), 1_500);
  assert.equal(
    dartUtf16FirestoreBytesOrderKey(maximumAccountId).byteLength,
    1_500,
  );
  assert.equal(seeded.coupons.length, 75);
  assert.ok(seeded.coupons.every(({sourceDocumentId}) =>
    Buffer.byteLength(sourceDocumentId, "utf8") === 1_500));

  let response = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-max-domain-page-request-0001",
      guestStateRevision: Number.MAX_SAFE_INTEGER,
    }),
    context,
  );
  const checkedOfferIds = [];
  let maximumPersistedBytes = 0;
  let firstPendingDocument = null;
  while (response.outcome === "guestCheckRequired") {
    assert.ok(response.candidates.length > 0);
    assert.ok(
      response.candidates.length <=
        customerBiteSaverGuestCheckMaximumCandidateIds,
    );
    assert.ok(
      Buffer.byteLength(response.checkToken, "utf8") <=
        customerBiteSaverGuestOfferCheckTokenMaximumBytes,
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(response), "utf8") <
        customerBiteSaverGuestOfferCheckTokenMaximumBytes,
    );
    checkedOfferIds.push(...response.candidates.map(({offerId}) => offerId));

    const pendingDocuments = [...database.documents.entries()].filter(
      ([path]) => path.startsWith(
        `${privateCustomerBiteSaverGuestOfferCheckCollection}/`,
      ),
    );
    assert.equal(pendingDocuments.length, 1);
    const pendingDocument = pendingDocuments[0][1];
    firstPendingDocument ??= pendingDocument;
    const serializedBytes = Buffer.byteLength(
      JSON.stringify(pendingDocument),
      "utf8",
    );
    maximumPersistedBytes = Math.max(maximumPersistedBytes, serializedBytes);
    assert.ok(serializedBytes <= 768 * 1_024);
    assert.ok(pendingDocument.activeBatch.candidates.every((candidate) =>
      Buffer.byteLength(candidate.sourceDocumentId, "utf8") === 1_500 &&
      !Object.hasOwn(candidate, "sortTuple")));

    const answer = guestAnswerRequest(
      started,
      response,
      response.candidates.map(({offerId}) => offerId),
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(answer), "utf8") <
        customerBiteSaverGuestOfferCheckTokenMaximumBytes,
    );
    response = await continueCustomerBiteSaverGuestOfferCheckHandler(
      answer,
      context,
    );
  }

  assert.equal(response.outcome, "complete");
  assert.equal(response.result.offers.length, 0);
  assert.equal(checkedOfferIds.length, 75);
  assert.equal(new Set(checkedOfferIds).size, 75);
  assert.ok(maximumPersistedBytes > 96 * 1_024);

  const maximumCandidateToken = new CustomerBiteSaverGuestOfferCheckCodec({
    key: secretKey,
    now: () => nowMs,
    nonceSource: (size) => Buffer.alloc(size, 23),
  }).encode({
    operationPurpose: "redemptionStart",
    operationRef: firstPendingDocument.operationRef,
    sessionId: firstPendingDocument.sessionId,
    attemptGeneration: Number.MAX_SAFE_INTEGER,
    criteriaFingerprint: firstPendingDocument.criteriaFingerprint,
    queryFingerprint: firstPendingDocument.queryFingerprint,
    callerCapabilityBinding: firstPendingDocument.callerCapabilityBinding,
    operationFingerprint: firstPendingDocument.operationFingerprint,
    restaurantPublicId: seeded.publicRestaurantId,
    consumedBoundaryFingerprint:
      firstPendingDocument.activeBatch.consumedBoundaryFingerprint,
    batchSequence: Number.MAX_SAFE_INTEGER,
    candidateOfferIds: checkedOfferIds,
    availabilityGeneration:
      firstPendingDocument.activeBatch.availabilityGeneration,
    timeZone: session.criteria.timeZone,
    utcOffsetMinutes: session.criteria.utcOffsetMinutes,
    guestStateRevision: Number.MAX_SAFE_INTEGER,
    evaluationAtMillis: nowMs,
    expiresAtMillis: nowMs + 300_000,
  });
  assert.ok(
    Buffer.byteLength(maximumCandidateToken, "utf8") <=
      customerBiteSaverGuestOfferCheckTokenMaximumBytes,
  );
  assert.equal(
    new CustomerBiteSaverGuestOfferCheckCodec({
      key: secretKey,
      now: () => nowMs,
    }).open(maximumCandidateToken).candidateOfferIds.length,
    customerBiteSaverGuestCheckMaximumCandidateIds,
  );
});

test("guest offer answer cannot expose an offer withdrawn after acceptance", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const challenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-source-change-page-0001",
      guestStateRevision: 15,
    }),
    context,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  const rawOfferPath = `restaurant_accounts/${seeded.accountId}/coupons/${
    seeded.coupons[0].sourceDocumentId}`;
  const runTransaction = database.runTransaction.bind(database);
  let withdrawAfterAcceptance = true;
  database.runTransaction = async (operation) => {
    const result = await runTransaction(operation);
    const document = result?.document ?? result;
    if (
      withdrawAfterAcceptance &&
      document?.role === "guestOfferCheck" &&
      document.state === "answerAccepted"
    ) {
      database.documents.delete(rawOfferPath);
      withdrawAfterAcceptance = false;
    }
    return result;
  };

  const response = await continueCustomerBiteSaverGuestOfferCheckHandler(
    guestAnswerRequest(started, challenge, []),
    context,
  );
  assert.equal(withdrawAfterAcceptance, false);
  assert.equal(response.outcome, "retryRequired");
  assert.equal(response.reason, "sourceChanged");
  assert.equal("result" in response, false);
});

test("guest answers reject incomplete or nonmember input before mutation", async () => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 2,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const challenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-invalid-answer-page-0001",
      guestStateRevision: 12,
    }),
    context,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  const base = guestAnswerRequest(started, challenge, [], {
    clientRequestId: "guest-invalid-answer-request-0001",
  });
  const missingCompletion = {...base};
  delete missingCompletion.entireBatchEvaluated;
  const unchallenged = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    "not-in-this-challenge",
  );
  const oversized = Array.from({length: 76}, (_, index) =>
    customerBiteSaverOpaqueOfferId(
      secretKey,
      "oversized-answer-account",
      "coupon",
      `oversized-answer-offer-${index}`,
    ));
  const challengedId = challenge.candidates[0].offerId;
  for (const invalid of [
    missingCompletion,
    {...base, entireBatchEvaluated: false},
    {...base, unavailableOfferIds: [challengedId, challengedId]},
    {...base, unavailableOfferIds: [unchallenged]},
    {...base, unavailableOfferIds: ["source-offer-canary"]},
    {...base, unavailableOfferIds: oversized},
    {...base, batchSequence: base.batchSequence + 1},
    {...base, guestStateRevision: base.guestStateRevision + 1},
    {...base, unexpected: true},
  ]) {
    const beforeCalls = databaseCallCounts(database);
    const beforeState = databaseDocumentState(database);
    await assert.rejects(
      continueCustomerBiteSaverGuestOfferCheckHandler(invalid, context),
      (error) => assertContractError(error, "invalid-argument"),
    );
    assert.deepEqual(databaseCallCounts(database), beforeCalls);
    assert.equal(databaseDocumentState(database), beforeState);
  }
  const completed = await continueCustomerBiteSaverGuestOfferCheckHandler(
    base,
    context,
  );
  assert.equal(completed.outcome, "complete");
  assert.equal(completed.result.offers.length, 2);
});

test("guest logical redemption fences bind concurrent challenges and results", async (t) => {
  await t.test("allowed redemption", async () => {
    let clock = nowMs;
    const database =
      new SerializedTransactionCustomerBiteSaverSearchDatabase();
    const {context, response: started} = await startSession(database, {
      context: {identity: guestIdentity(), now: () => clock},
      request: {
        clientRequestId: "guest-logical-allowed-start-0001",
        searchText: "",
      },
    });
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0, {
      offerCount: 2,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    const offerChallenge = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "guest-logical-allowed-page-0001",
        guestStateRevision: 91,
      }),
      context,
    );
    const offerComplete =
      await continueCustomerBiteSaverGuestOfferCheckHandler(
        guestAnswerRequest(started, offerChallenge, [], {
          clientRequestId: "guest-logical-allowed-page-answer-0001",
        }),
        context,
      );
    assert.equal(offerComplete.outcome, "complete");
    assert.equal(offerComplete.result.offers.length, 2);
    const [firstOffer, secondOffer] = offerComplete.result.offers;
    const request = redemptionRequest(
      started,
      seeded.publicRestaurantId,
      firstOffer.offerId,
      {
        clientRequestId: "guest-logical-allowed-redeem-a",
        redemptionRequestId: "guest-logical-allowed-request-0001",
        offerOccurrence: firstOffer.offerOccurrence,
        guestStateRevision: 91,
      },
    );
    const concurrentRequest = {
      ...request,
      clientRequestId: "guest-logical-allowed-redeem-b",
    };
    const settled = await Promise.allSettled([
      validateCustomerBiteSaverOfferRedemptionStartHandler(request, context),
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        concurrentRequest,
        context,
      ),
    ]);
    const fulfilled = settled.filter((result) => result.status === "fulfilled");
    const rejected = settled.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(assertContractError(rejected[0].reason, "resource-exhausted"), true);
    const firstChallenge = fulfilled[0].value;
    assert.equal(firstChallenge.outcome, "guestCheckRequired");
    assert.deepEqual(
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        concurrentRequest,
        context,
      ),
      firstChallenge,
    );
    assert.deepEqual(
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        request,
        context,
      ),
      firstChallenge,
    );
    assert.equal(firstChallenge.evaluationContext.evaluationAtMillis, nowMs);
    assert.equal(firstChallenge.logicalExpiresAtMillis, nowMs + 60_000);
    assert.equal(
      [...database.documents.values()].filter((document) =>
        document.role === "logicalRedemptionReplay").length,
      1,
    );

    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...request,
          clientRequestId: "guest-logical-allowed-rebind-0001",
          offerId: secondOffer.offerId,
          offerOccurrence: secondOffer.offerOccurrence,
        },
        context,
      ),
      (error) => assertContractError(error, "invalid-argument"),
    );

    clock += 30_000;
    const changedTransport =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...request,
          clientRequestId: "guest-logical-allowed-redeem-c",
        },
        context,
      );
    assert.deepEqual(changedTransport, firstChallenge);
    const answer = guestAnswerRequest(started, firstChallenge, [], {
      clientRequestId: "guest-logical-allowed-answer-0001",
    });
    const completed = await continueCustomerBiteSaverGuestOfferCheckHandler(
      answer,
      context,
    );
    assert.equal(completed.outcome, "complete");
    assert.equal(completed.result.allowed, true);
    assert.equal(completed.result.evaluatedAtMillis, nowMs);
    assert.equal(completed.result.validationExpiresAtMillis, nowMs + 60_000);
    assert.match(completed.result.validationId, /^bsv_[A-Za-z0-9_-]{43}$/u);
    assert.deepEqual(
      await continueCustomerBiteSaverGuestOfferCheckHandler(answer, context),
      completed,
    );

    clock = nowMs + 40_000;
    const completedReplay =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...request,
          clientRequestId: "guest-logical-allowed-redeem-d",
        },
        context,
      );
    assert.deepEqual(completedReplay, completed);
    clock = nowMs + 60_000;
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...request,
          clientRequestId: "guest-logical-allowed-expired-0001",
        },
        context,
      ),
      (error) => assertContractError(error, "failed-precondition"),
    );
    clock += 1;
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...request,
          clientRequestId: "guest-logical-allowed-expired-0002",
        },
        context,
      ),
      (error) => assertContractError(error, "failed-precondition"),
    );
  });

  await t.test("locally denied redemption", async () => {
    let clock = nowMs;
    const {database, context, response: started} = await startSession(
      undefined,
      {
        context: {identity: guestIdentity(), now: () => clock},
        request: {
          clientRequestId: "guest-logical-denied-start-0001",
          searchText: "",
        },
      },
    );
    const session = markSessionReady(database, started);
    const seeded = addReadyRestaurant(database, session, 0, {
      offerCount: 1,
      onlyCoupons: true,
      offerOverrides: {usageRule: "Once per customer"},
    });
    const offerChallenge = await getCustomerBiteSaverOfferPageHandler(
      offerPageRequest(started, seeded.publicRestaurantId, {
        clientRequestId: "guest-logical-denied-page-0001",
        guestStateRevision: 92,
      }),
      context,
    );
    const offerComplete =
      await continueCustomerBiteSaverGuestOfferCheckHandler(
        guestAnswerRequest(started, offerChallenge, [], {
          clientRequestId: "guest-logical-denied-page-answer-0001",
        }),
        context,
      );
    const offer = offerComplete.result.offers[0];
    const request = redemptionRequest(
      started,
      seeded.publicRestaurantId,
      offer.offerId,
      {
        clientRequestId: "guest-logical-denied-redeem-0001",
        redemptionRequestId: "guest-logical-denied-request-0001",
        offerOccurrence: offer.offerOccurrence,
        guestStateRevision: 92,
      },
    );
    const challenge =
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        request,
        context,
      );
    assert.equal(challenge.outcome, "guestCheckRequired");
    const completed = await continueCustomerBiteSaverGuestOfferCheckHandler(
      guestAnswerRequest(started, challenge, [offer.offerId], {
        clientRequestId: "guest-logical-denied-answer-0001",
      }),
      context,
    );
    assert.equal(completed.outcome, "complete");
    assert.equal(completed.result.allowed, false);
    assert.equal(completed.result.reason, "used");
    assert.equal(completed.result.evaluatedAtMillis, nowMs);

    clock += 30_000;
    assert.deepEqual(
      await validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...request,
          clientRequestId: "guest-logical-denied-redeem-0002",
        },
        context,
      ),
      completed,
    );
    clock = nowMs + 60_000;
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...request,
          clientRequestId: "guest-logical-denied-expired-0001",
        },
        context,
      ),
      (error) => assertContractError(error, "failed-precondition"),
    );
    clock += 1;
    await assert.rejects(
      validateCustomerBiteSaverOfferRedemptionStartHandler(
        {
          ...request,
          clientRequestId: "guest-logical-denied-expired-0002",
        },
        context,
      ),
      (error) => assertContractError(error, "failed-precondition"),
    );
  });
});

test("guest proximity redemption cannot outlive its fresh-position check", async () => {
  let clock = nowMs;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {
      usageRule: "Once per customer",
      isProximityOnly: true,
      proximityRadiusMiles: 10,
    },
  });
  const history = new SimulatedLocalGuestHistory([], 27);
  const offerChallenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-redemption-offer-page-0001",
      guestStateRevision: history.revision,
    }),
    context,
  );
  const offerComplete = await continueCustomerBiteSaverGuestOfferCheckHandler(
    history.answer(started, offerChallenge),
    context,
  );
  assert.equal(offerComplete.outcome, "complete");
  const offer = offerComplete.result.offers[0];
  const coordinates = {
    latitude: 28.5383,
    longitude: -81.3792,
    capturedAtMillis: clock,
  };
  const redeem = redemptionRequest(
    started,
    seeded.publicRestaurantId,
    offer.offerId,
    {
      clientRequestId: "guest-redemption-wait-start-0001",
      redemptionRequestId: "guest-redemption-wait-occurrence-0001",
      offerOccurrence: offer.offerOccurrence,
      currentCoordinates: coordinates,
      guestStateRevision: history.revision,
    },
  );
  const redemptionChallenge =
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      redeem,
      context,
    );
  assert.equal(redemptionChallenge.outcome, "guestCheckRequired");
  assert.equal(redemptionChallenge.operation, "redemptionStart");
  assert.deepEqual(
    redemptionChallenge.candidates.map(({offerId}) => offerId),
    [offer.offerId],
  );
  const answer = history.answer(started, redemptionChallenge);

  clock += customerBiteSaverFreshLocationMaximumAgeMilliseconds + 1;
  const expired = await continueCustomerBiteSaverGuestOfferCheckHandler(
    answer,
    context,
  );
  assert.equal(expired.outcome, "retryRequired");
  assert.equal(expired.reason, "checkExpired");
  assert.equal("result" in expired, false);

  const reevaluated =
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...redeem,
        clientRequestId: "guest-redemption-wait-retry-0001",
        redemptionRequestId: "guest-redemption-wait-occurrence-0002",
      },
      context,
    );
  assert.equal(reevaluated.outcome, "complete");
  assert.equal(reevaluated.result.allowed, false);
  assert.equal(reevaluated.result.reason, "missingFreshLocation");
});

test("guest direct redemption replay expires at its original minute fence", async () => {
  let clock = nowMs;
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity(), now: () => clock},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {
      usageRule: "Once per customer",
      isProximityOnly: true,
      proximityRadiusMiles: 10,
    },
  });
  const history = new SimulatedLocalGuestHistory([], 28);
  const offerChallenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-direct-expiry-offer-page-0001",
      guestStateRevision: history.revision,
    }),
    context,
  );
  const offerComplete = await continueCustomerBiteSaverGuestOfferCheckHandler(
    history.answer(started, offerChallenge),
    context,
  );
  assert.equal(offerComplete.outcome, "complete");
  const offer = offerComplete.result.offers[0];
  const request = redemptionRequest(
    started,
    seeded.publicRestaurantId,
    offer.offerId,
    {
      clientRequestId: "guest-direct-expiry-redemption-0001",
      redemptionRequestId: "guest-direct-expiry-occurrence-0001",
      offerOccurrence: offer.offerOccurrence,
      currentCoordinates: null,
      guestStateRevision: history.revision,
    },
  );
  const first = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    request,
    context,
  );
  assert.equal(first.outcome, "complete");
  assert.equal(first.result.allowed, false);
  assert.equal(first.result.reason, "missingFreshLocation");
  assert.deepEqual(
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...request,
        clientRequestId: "guest-direct-expiry-redemption-0002",
      },
      context,
    ),
    first,
  );

  clock += 30_000;
  assert.deepEqual(
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...request,
        clientRequestId: "guest-direct-expiry-redemption-0003",
      },
      context,
    ),
    first,
  );
  const freshCoordinates = {
    latitude: 28.5383,
    longitude: -81.3792,
    capturedAtMillis: clock,
  };
  await assert.rejects(
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...request,
        clientRequestId: "guest-direct-expiry-rebind-0004",
        currentCoordinates: freshCoordinates,
      },
      context,
    ),
    (error) => assertContractError(error, "invalid-argument"),
  );

  clock = nowMs + 60_000;
  await assert.rejects(
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...request,
        clientRequestId: "guest-direct-expiry-redemption-0005",
      },
      context,
    ),
    (error) => assertContractError(error, "failed-precondition"),
  );
  clock += 1;
  await assert.rejects(
    validateCustomerBiteSaverOfferRedemptionStartHandler(
      {
        ...request,
        clientRequestId: "guest-direct-expiry-revive-0006",
        currentCoordinates: {...freshCoordinates, capturedAtMillis: clock},
      },
      context,
    ),
    (error) => assertContractError(error, "invalid-argument"),
  );

  const newLogical = await validateCustomerBiteSaverOfferRedemptionStartHandler(
    {
      ...request,
      clientRequestId: "guest-direct-expiry-new-logical-0007",
      redemptionRequestId: "guest-direct-expiry-occurrence-0002",
      currentCoordinates: {...freshCoordinates, capturedAtMillis: clock},
    },
    context,
  );
  assert.equal(newLogical.outcome, "guestCheckRequired");
  const allowed = await continueCustomerBiteSaverGuestOfferCheckHandler(
    history.answer(started, newLogical, {
      clientRequestId: "guest-direct-expiry-new-answer-0001",
    }),
    context,
  );
  assert.equal(allowed.outcome, "complete");
  assert.equal(allowed.result.allowed, true);
});

test("malformed persisted guest checks fail closed without completing", async (t) => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 2,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const challenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-corrupt-state-page-0001",
      guestStateRevision: 33,
    }),
    context,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  const documentPath = `${privateCustomerBiteSaverGuestOfferCheckCollection}/${
    challenge.operationRef}`;
  const pristine = structuredClone(database.documents.get(documentPath));
  assert.notEqual(pristine, undefined);
  assert.equal(pristine.state, "awaitingAnswer");
  assert.notEqual(pristine.activeBatch, null);
  assert.ok(pristine.activeBatch.candidates.length > 0);
  const answer = guestAnswerRequest(started, challenge, []);
  const baselineEntries = [...database.documents.entries()].map(
    ([path, data]) => [path, structuredClone(data)],
  );

  const corruptions = [
    ["extra top-level key", (document) => {
      document.privateStateCanary = "source-offer-canary";
    }],
    ["extra original-request key", (document) => {
      document.originalRequest.privateStateCanary = "source-offer-canary";
    }],
    ["original-request operation mismatch", (document) => {
      document.originalRequest = {
        kind: "restaurantPage",
        cursor: document.originalRequest.cursor,
      };
    }],
    ["extra progress key", (document) => {
      document.progress.privateStateCanary = "source-offer-canary";
    }],
    ["progress operation mismatch", (document) => {
      document.progress.kind = "restaurantPage";
    }],
    ["extra stored-offer key", (document) => {
      document.activeBatch.candidates[0].privateStateCanary =
        "source-offer-canary";
    }],
    ["stored-offer order key malformed", (document) => {
      document.activeBatch.candidates[0].sourceCreatedAtOrderKey =
        "source-offer-canary";
    }],
    ["extra active-batch key", (document) => {
      document.activeBatch.privateStateCanary = "source-offer-canary";
    }],
    ["active-batch operation mismatch", (document) => {
      document.activeBatch.kind = "restaurantLive";
    }],
    ["candidate digest mismatch", (document) => {
      document.activeBatch.candidateDigest = "0".repeat(64);
    }],
    ["availability generation mismatch", (document) => {
      document.activeBatch.availabilityGeneration = "0".repeat(64);
    }],
    ["consumed boundary mismatch", (document) => {
      document.activeBatch.consumedBoundaryFingerprint = "0".repeat(64);
    }],
    ["malformed active token", (document) => {
      document.activeBatch.token = "source-offer-canary";
    }],
    ["active time ordering mismatch", (document) => {
      document.activeBatch.issuedAtMillis =
        document.activeBatch.expiresAtMillis + 1;
    }],
    ["active expiry outside document fence", (document) => {
      document.activeBatch.expiresAtMillis =
        document.logicalExpiresAt.getTime() + 1;
    }],
    ["active sequence mismatch", (document) => {
      document.activeBatch.sequence = document.batchSequence + 1;
    }],
    ["completed state retains an active batch", (document) => {
      document.state = "completed";
    }],
    ["accepted state omits its accepted answer", (document) => {
      document.state = "answerAccepted";
    }],
    ["awaiting state carries retry metadata", (document) => {
      document.retryReason = "sourceChanged";
      document.restartFrom = "originalOperation";
    }],
    ["operation fingerprint mismatch", (document) => {
      document.operationFingerprint = "0".repeat(64);
    }],
  ];

  for (const [name, corrupt] of corruptions) {
    await t.test(name, async () => {
      const caseDatabase = new InMemoryCustomerBiteSaverSearchDatabase(
        baselineEntries.map(([path, data]) => [path, structuredClone(data)]),
      );
      const caseContext = {...context, database: caseDatabase};
      const malformed = structuredClone(pristine);
      corrupt(malformed);
      caseDatabase.documents.set(documentPath, malformed);
      const beforeState = databaseDocumentState(caseDatabase);
      await assert.rejects(
        continueCustomerBiteSaverGuestOfferCheckHandler(answer, caseContext),
        (error) => {
          assert.equal(assertContractError(error, "failed-precondition"), true);
          assert.equal(
            error.message,
            "The BiteSaver guest offer-check state is invalid.",
          );
          assertNoPrivateCanaries({error: error.message});
          return true;
        },
      );
      assert.equal(databaseDocumentState(caseDatabase), beforeState);
      assert.equal(caseDatabase.calls.transactionWrites.length, 0);
      assert.equal(caseDatabase.calls.commits.length, 0);
    });
  }
});

test("persisted accepted-answer metadata is exact and batch-bound", async (t) => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 2,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const challenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-accepted-state-page-0001",
      guestStateRevision: 34,
    }),
    context,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  assert.equal(challenge.candidates.length, 2);
  const answer = guestAnswerRequest(
    started,
    challenge,
    [challenge.candidates[0].offerId],
    {clientRequestId: "guest-accepted-answer-0001"},
  );
  const documentPath = `${privateCustomerBiteSaverGuestOfferCheckCollection}/${
    challenge.operationRef}`;
  const pristine = structuredClone(database.documents.get(documentPath));
  const originalRunTransaction = database.runTransaction.bind(database);
  const captureAcceptedState = new Error("capture accepted guest state");
  let acceptedStateObserved = false;
  database.runTransaction = async (operation) => {
    const result = await originalRunTransaction(operation);
    if (
      !acceptedStateObserved &&
      result?.document?.state === "answerAccepted"
    ) {
      acceptedStateObserved = true;
      throw captureAcceptedState;
    }
    return result;
  };
  await assert.rejects(
    continueCustomerBiteSaverGuestOfferCheckHandler(answer, context),
    (error) => error === captureAcceptedState,
  );
  database.runTransaction = originalRunTransaction;
  assert.equal(acceptedStateObserved, true);
  const accepted = structuredClone(database.documents.get(documentPath));
  assert.equal(accepted.state, "answerAccepted");
  assert.deepEqual(accepted.acceptedAnswer, {
    batchSequence: answer.batchSequence,
    clientRequestId: answer.clientRequestId,
    requestFingerprint: persistedGuestAnswerFingerprint(answer),
    unavailableOfferIds: [...answer.unavailableOfferIds],
  });
  const baselineEntries = clonedDatabaseEntries(database);

  const validDatabase = new InMemoryCustomerBiteSaverSearchDatabase(
    baselineEntries.map(([path, data]) => [path, structuredClone(data)]),
  );
  validDatabase.documents.set(documentPath, structuredClone(accepted));
  const validResponse = await continueCustomerBiteSaverGuestOfferCheckHandler(
    answer,
    {...context, database: validDatabase},
  );
  assert.equal(validResponse.outcome, "complete");
  assert.equal(validResponse.operation, "offerPage");
  assert.equal(validResponse.result.offers.length, 1);
  assertNoPrivateCanaries(validResponse);
  const completed = structuredClone(validDatabase.documents.get(documentPath));
  assert.equal(completed.state, "completed");
  assert.equal(completed.batchSequence, answer.batchSequence + 1);
  assert.deepEqual(completed.lastAcceptedAnswer, {
    batchSequence: answer.batchSequence,
    clientRequestId: answer.clientRequestId,
    requestFingerprint: persistedGuestAnswerFingerprint(answer),
  });

  const candidateIds = pristine.activeBatch.candidates.map(
    ({offerId}) => offerId,
  );
  const orderedCandidateIds = [...candidateIds].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  const nonmemberId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    "not-a-challenged-source-offer",
  );
  const corruptions = [
    ["extra accepted-answer key", (document) => {
      document.acceptedAnswer.privateStateCanary = "source-offer-canary";
    }],
    ["malformed accepted-answer client request", (document) => {
      document.acceptedAnswer.clientRequestId = "short";
    }],
    ["accepted-answer sequence differs from batch", (document) => {
      document.acceptedAnswer.batchSequence += 1;
    }],
    ["accepted-answer fingerprint is malformed", (document) => {
      document.acceptedAnswer.requestFingerprint = "source-offer-canary";
    }],
    ["accepted-answer fingerprint is valid but incorrect", (document) => {
      document.acceptedAnswer.requestFingerprint = "0".repeat(64);
    }],
    ["accepted-answer contains a nonmember", (document) => {
      const unavailableOfferIds = [nonmemberId];
      document.acceptedAnswer.unavailableOfferIds = unavailableOfferIds;
      document.acceptedAnswer.requestFingerprint =
        persistedGuestAnswerFingerprint({...answer, unavailableOfferIds});
    }],
    ["accepted-answer contains a duplicate", (document) => {
      const unavailableOfferIds = [candidateIds[0], candidateIds[0]];
      document.acceptedAnswer.unavailableOfferIds = unavailableOfferIds;
      document.acceptedAnswer.requestFingerprint =
        persistedGuestAnswerFingerprint({...answer, unavailableOfferIds});
    }],
    ["accepted-answer subset is not canonically ordered", (document) => {
      const unavailableOfferIds = [...orderedCandidateIds].reverse();
      document.acceptedAnswer.unavailableOfferIds = unavailableOfferIds;
      document.acceptedAnswer.requestFingerprint =
        persistedGuestAnswerFingerprint({...answer, unavailableOfferIds});
    }],
    ["awaiting state retains an accepted answer", (document) => {
      document.state = "awaitingAnswer";
    }],
    ["accepted state omits its active batch", (document) => {
      document.activeBatch = null;
    }],
  ];

  for (const [name, corrupt] of corruptions) {
    await t.test(name, async () => {
      const malformed = structuredClone(accepted);
      corrupt(malformed);
      await assertMalformedGuestCheckRejected({
        baselineEntries,
        context,
        documentPath,
        malformed,
        answer,
      });
    });
  }

  const completedEntries = clonedDatabaseEntries(validDatabase);
  const lastAcceptedCorruptions = [
    ["extra last-accepted key", (document) => {
      document.lastAcceptedAnswer.privateStateCanary = "source-offer-canary";
    }],
    ["malformed last-accepted client request", (document) => {
      document.lastAcceptedAnswer.clientRequestId = "short";
    }],
    ["malformed last-accepted fingerprint", (document) => {
      document.lastAcceptedAnswer.requestFingerprint = "source-offer-canary";
    }],
    ["last-accepted sequence does not precede current", (document) => {
      document.lastAcceptedAnswer.batchSequence = document.batchSequence;
    }],
    ["advanced sequence omits last-accepted metadata", (document) => {
      document.lastAcceptedAnswer = null;
    }],
    ["current sequence skips after last acceptance", (document) => {
      document.batchSequence += 1;
    }],
  ];
  for (const [name, corrupt] of lastAcceptedCorruptions) {
    await t.test(name, async () => {
      const malformed = structuredClone(completed);
      corrupt(malformed);
      await assertMalformedGuestCheckRejected({
        baselineEntries: completedEntries,
        context,
        documentPath,
        malformed,
        answer,
      });
    });
  }
});

test("persisted guest restaurant progress rejects malformed nested state", async (t) => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  addReadyRestaurant(database, session, 0, {
    offerCount: 2,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const challenge = await getCustomerBiteSaverSearchPageHandler(
    pageRequest(started, {
      clientRequestId: "guest-corrupt-restaurant-progress-0001",
      guestStateRevision: 35,
    }),
    context,
  );
  assert.equal(challenge.outcome, "guestCheckRequired");
  assert.equal(challenge.operation, "restaurantPage");
  const answer = guestAnswerRequest(
    started,
    challenge,
    [],
    {clientRequestId: "guest-corrupt-restaurant-answer-0001"},
  );
  const documentPath = `${privateCustomerBiteSaverGuestOfferCheckCollection}/${
    challenge.operationRef}`;
  const current = structuredClone(database.documents.get(documentPath));
  assert.equal(current.progress.kind, "restaurantPage");
  assert.notEqual(current.progress.currentRestaurant, null);
  assert.equal(current.progress.readyRestaurants.length, 0);
  const currentEntries = clonedDatabaseEntries(database);
  const currentCorruptions = [
    ["extra current-restaurant key", (document) => {
      document.progress.currentRestaurant.privateStateCanary =
        "source-offer-canary";
    }],
    ["current-restaurant result identity mismatch", (document) => {
      document.progress.currentRestaurant.resultId = "source-offer-canary";
    }],
    ["current-restaurant visible count is negative", (document) => {
      document.progress.currentRestaurant.visibleOfferCount = -1;
    }],
    ["current-restaurant retained count exceeds visible count", (document) => {
      document.progress.currentRestaurant.retainedOffers = [
        structuredClone(document.activeBatch.candidates[0]),
      ];
      document.progress.currentRestaurant.visibleOfferCount = 0;
    }],
    ["current restaurant duplicates a ready restaurant", (document) => {
      const raw = document.progress.currentRestaurant;
      document.progress.readyRestaurants = [{
        resultId: raw.resultId,
        restaurantId: raw.restaurantId,
        sortTuple: raw.sortTuple,
        authoritativeAccountId: raw.authoritativeAccountId,
        parentCatalogFingerprint: raw.parentCatalogFingerprint,
        parentProjectionFingerprint: raw.parentProjectionFingerprint,
        selectedOffers: [structuredClone(document.activeBatch.candidates[0])],
        metadataWitnesses: [],
        hasMoreOffers: false,
        usableOfferCount: 1,
        offerCountState: "current",
      }];
    }],
  ];
  for (const [name, corrupt] of currentCorruptions) {
    await t.test(name, async () => {
      const malformed = structuredClone(current);
      corrupt(malformed);
      await assertMalformedGuestCheckRejected({
        baselineEntries: currentEntries,
        context,
        documentPath,
        malformed,
        answer,
      });
    });
  }

  const completedResponse =
    await continueCustomerBiteSaverGuestOfferCheckHandler(answer, context);
  assert.equal(completedResponse.outcome, "complete");
  assert.equal(completedResponse.operation, "restaurantPage");
  assert.equal(completedResponse.result.restaurants.length, 1);
  assertNoPrivateCanaries(completedResponse);
  const completed = structuredClone(database.documents.get(documentPath));
  assert.equal(completed.state, "completed");
  assert.equal(completed.progress.currentRestaurant, null);
  assert.equal(completed.progress.readyRestaurants.length, 1);
  const completedEntries = clonedDatabaseEntries(database);
  const readyCorruptions = [
    ["extra ready-restaurant key", (document) => {
      document.progress.readyRestaurants[0].privateStateCanary =
        "source-offer-canary";
    }],
    ["ready restaurant has no selected offers", (document) => {
      document.progress.readyRestaurants[0].selectedOffers = [];
    }],
    ["ready restaurant duplicates a metadata witness", (document) => {
      const restaurant = document.progress.readyRestaurants[0];
      restaurant.metadataWitnesses = [
        structuredClone(restaurant.selectedOffers[0]),
      ];
    }],
    ["ready restaurant has an inconsistent unknown count", (document) => {
      document.progress.readyRestaurants[0].offerCountState = "unknown";
    }],
    ["ready restaurant count is below its selected offers", (document) => {
      const restaurant = document.progress.readyRestaurants[0];
      restaurant.usableOfferCount = restaurant.selectedOffers.length - 1;
    }],
    ["ready restaurant has-more flag disagrees with count", (document) => {
      const restaurant = document.progress.readyRestaurants[0];
      restaurant.hasMoreOffers = !restaurant.hasMoreOffers;
    }],
  ];
  for (const [name, corrupt] of readyCorruptions) {
    await t.test(name, async () => {
      const malformed = structuredClone(completed);
      corrupt(malformed);
      await assertMalformedGuestCheckRejected({
        baselineEntries: completedEntries,
        context,
        documentPath,
        malformed,
        answer,
      });
    });
  }
});

test("persisted guest redemption progress is identity-bound and exact", async (t) => {
  const {database, context, response: started} = await startSession(undefined, {
    context: {identity: guestIdentity()},
    request: {searchText: ""},
  });
  const session = markSessionReady(database, started);
  const seeded = addReadyRestaurant(database, session, 0, {
    offerCount: 1,
    onlyCoupons: true,
    offerOverrides: {usageRule: "Once per customer"},
  });
  const offerChallenge = await getCustomerBiteSaverOfferPageHandler(
    offerPageRequest(started, seeded.publicRestaurantId, {
      clientRequestId: "guest-redemption-progress-offers-0001",
      guestStateRevision: 36,
    }),
    context,
  );
  assert.equal(offerChallenge.outcome, "guestCheckRequired");
  const offerResponse = await continueCustomerBiteSaverGuestOfferCheckHandler(
    guestAnswerRequest(started, offerChallenge, []),
    context,
  );
  assert.equal(offerResponse.outcome, "complete");
  const offer = offerResponse.result.offers[0];
  const redemptionChallenge =
    await validateCustomerBiteSaverOfferRedemptionStartHandler(
      redemptionRequest(
        started,
        seeded.publicRestaurantId,
        offer.offerId,
        {
          clientRequestId: "guest-redemption-progress-start-0001",
          redemptionRequestId: "guest-redemption-progress-use-0001",
          offerOccurrence: offer.offerOccurrence,
          guestStateRevision: 36,
        },
      ),
      context,
    );
  assert.equal(redemptionChallenge.outcome, "guestCheckRequired");
  assert.equal(redemptionChallenge.operation, "redemptionStart");
  const answer = guestAnswerRequest(
    started,
    redemptionChallenge,
    [],
    {clientRequestId: "guest-redemption-progress-answer-0001"},
  );
  const documentPath = `${privateCustomerBiteSaverGuestOfferCheckCollection}/${
    redemptionChallenge.operationRef}`;
  const pristine = structuredClone(database.documents.get(documentPath));
  assert.equal(pristine.progress.kind, "redemptionStart");
  assert.equal(pristine.progress.locallyUnavailable, null);
  assert.equal(pristine.progress.offer.offerId, offer.offerId);
  const baselineEntries = clonedDatabaseEntries(database);

  const validDatabase = new InMemoryCustomerBiteSaverSearchDatabase(
    baselineEntries.map(([path, data]) => [path, structuredClone(data)]),
  );
  const validResponse = await continueCustomerBiteSaverGuestOfferCheckHandler(
    answer,
    {...context, database: validDatabase},
  );
  assert.equal(validResponse.outcome, "complete");
  assert.equal(validResponse.operation, "redemptionStart");
  assert.equal(validResponse.result.allowed, true);
  assertNoPrivateCanaries(validResponse);

  const otherOfferId = customerBiteSaverOpaqueOfferId(
    secretKey,
    seeded.accountId,
    "coupon",
    "not-the-redemption-target",
  );
  const corruptions = [
    ["extra redemption-progress key", (document) => {
      document.progress.privateStateCanary = "source-offer-canary";
    }],
    ["extra redemption stored-offer key", (document) => {
      document.progress.offer.privateStateCanary = "source-offer-canary";
    }],
    ["redemption progress targets another offer", (document) => {
      document.progress.offerId = otherOfferId;
    }],
    ["redemption stored offer diverges from target", (document) => {
      document.progress.offer.offerId = otherOfferId;
    }],
    ["redemption local answer appears before acceptance", (document) => {
      document.progress.locallyUnavailable = false;
    }],
    ["redemption offer source fingerprint diverges from batch", (document) => {
      document.progress.offer.sourceFingerprint = "0".repeat(64);
    }],
    ["redemption original coordinates contain an extra key", (document) => {
      document.originalRequest.currentCoordinates = {
        latitude: 28.5383,
        longitude: -81.3792,
        capturedAtMillis: nowMs,
        privateStateCanary: "source-offer-canary",
      };
    }],
  ];
  for (const [name, corrupt] of corruptions) {
    await t.test(name, async () => {
      const malformed = structuredClone(pristine);
      corrupt(malformed);
      await assertMalformedGuestCheckRejected({
        baselineEntries,
        context,
        documentPath,
        malformed,
        answer,
      });
    });
  }
});

module.exports = {
  InMemoryCustomerBiteSaverSearchDatabase,
  assertContractError,
  assertExactKeys,
  assertNoPrivateCanaries,
  boundRequest,
  createContext,
  nowMs,
  secretKey,
  startRequest,
  startSession,
};
