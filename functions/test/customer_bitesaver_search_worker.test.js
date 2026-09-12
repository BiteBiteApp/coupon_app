"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {Timestamp} = require("firebase-admin/firestore");

const {
  customerBiteSaverCatalogGenerationShardCount,
  customerBiteSaverExactLocationPreference,
  customerBiteSaverGenerationShardId,
  customerBiteSaverMaximumCatalogRestarts,
  customerBiteSaverMaximumWritesPerCommit,
  customerBiteSaverOfferProjectionVersion,
  customerBiteSaverRangeFetchLimit,
  customerBiteSaverRangesPerWorker,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  customerBiteSaverWorkerSourceLimit,
  privateCustomerBiteSaverCandidateCollection,
  privateCustomerBiteSaverCatalogGenerationCollection,
  privateCustomerBiteSaverJobCollection,
  privateCustomerBiteSaverResultCollection,
  privateCustomerBiteSaverSearchSessionCollection,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  customerBiteSaverCandidatePrefix,
  customerBiteSaverJobId,
  customerBiteSaverOrderedResultQuery,
  customerBiteSaverPerParentOfferQuery,
  customerBiteSaverSessionInternals,
  buildCustomerBiteSaverJobDocument,
  startCustomerBiteSaverSearchHandler,
} = require("../lib/customer_bitesaver_search_session.js");
const {
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverDailySpecialOfferIndex,
  buildBiteSaverRestaurantIndex,
  customerBiteSaverOfferSourceCreatedAtOrderKeyField,
} = require("../lib/search_index_builders.js");
const {
  dartUtf16FirestoreBytesCursorValue,
  dartUtf16FirestoreBytesOrderKey,
  lowercaseDisplayNameOrderKey,
} = require("../lib/customer_bitesaver_search_matcher.js");
const {
  canonicalRestaurantGeohash,
  exactCustomerBiteSaverDistanceMiles,
} = require("../lib/restaurant_geo_helpers.js");
const {
  customerBiteSaverOpaqueRestaurantId,
  decodeCustomerBiteSaverIdentityKeyV1,
} = require("../lib/customer_bitesaver_public_identity.js");
const {
  createCustomerBiteSaverWorkerCounters,
  customerBiteSaverMaximumCandidateDocumentBytes,
  customerBiteSaverMaximumIndexedOrderKeyBytes,
  customerBiteSaverMaximumRawFallbackDocumentsPerWorker,
  customerBiteSaverMaximumRawFallbackBytesPerWorker,
  customerBiteSaverMaximumResultDocumentBytes,
  customerBiteSaverWorkerPreviewSummaryLimit,
  processCustomerBiteSaverSearchJob,
} = require("../lib/customer_bitesaver_search_worker.js");

const nowMs = Date.parse("2026-09-09T12:00:00.000Z");
const discoveryKey = Buffer.alloc(32, 29);
const identityKeyV1 = decodeCustomerBiteSaverIdentityKeyV1(
  Buffer.alloc(32, 31).toString("base64url"),
);

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

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

class InMemoryWorkerDatabase {
  constructor(entries = []) {
    this.documents = new Map(entries.map(([path, data]) => [path, data]));
    this.calls = {
      getDocument: [],
      getDocuments: [],
      queryDocuments: [],
      transactionWrites: [],
      transactions: 0,
    };
    this.activeOperations = 0;
    this.maximumOperationsInFlight = 0;
    this.maximumQueryResultSize = 0;
    this.maximumTransactionWrites = 0;
    this.beforeTransaction = null;
    this.virtualQuery = null;
    this.virtualDocumentsGenerated = 0;
    this.maximumVirtualPage = 0;
    this.discardResultWrites = false;
    this.compactCompletedJobs = false;
    this.recordTransactionWriteDetails = true;
    this.resultWrites = 0;
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

  async tracked(operation) {
    this.activeOperations += 1;
    this.maximumOperationsInFlight = Math.max(
      this.maximumOperationsInFlight,
      this.activeOperations,
    );
    await Promise.resolve();
    try {
      return operation();
    } finally {
      this.activeOperations -= 1;
    }
  }

  async getDocument(path) {
    this.calls.getDocument.push(path);
    return this.tracked(() => this.stored(path));
  }

  async getDocuments(paths) {
    this.calls.getDocuments.push([...paths]);
    return this.tracked(() => paths.map((path) => this.stored(path)));
  }

  mappedQuery(query) {
    const prefix = `${query.collectionPath}/`;
    let documents = [...this.documents.keys()]
      .filter((documentPath) =>
        documentPath.startsWith(prefix) &&
        !documentPath.slice(prefix.length).includes("/"))
      .map((documentPath) => this.stored(documentPath));
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

  async queryDocuments(query) {
    this.calls.queryDocuments.push(query);
    return this.tracked(() => {
      const virtual = this.virtualQuery?.(query);
      const documents = virtual ?? this.mappedQuery(query);
      this.maximumQueryResultSize = Math.max(
        this.maximumQueryResultSize,
        documents.length,
      );
      return documents;
    });
  }

  applyWrites(writes) {
    for (const write of writes) {
      if (write.type === "create" && this.documents.has(write.path)) {
        throw new Error(`already exists: ${write.path}`);
      }
      if (write.type === "delete") {
        this.documents.delete(write.path);
        continue;
      }
      if (write.path.startsWith(`${privateCustomerBiteSaverResultCollection}/`)) {
        this.resultWrites += 1;
        if (this.discardResultWrites) continue;
      }
      if (
        this.compactCompletedJobs &&
        write.path.startsWith(`${privateCustomerBiteSaverJobCollection}/`) &&
        write.data.state === "completed"
      ) {
        this.documents.delete(write.path);
        continue;
      }
      this.documents.set(write.path, write.data);
    }
  }

  async runTransaction(operation) {
    this.calls.transactions += 1;
    this.beforeTransaction?.(this.calls.transactions, this);
    const writes = [];
    const transaction = {
      getDocument: async (path) => {
        this.calls.getDocument.push(path);
        return this.tracked(() => this.stored(path));
      },
      getDocuments: async (paths) => {
        this.calls.getDocuments.push([...paths]);
        return this.tracked(() => paths.map((path) => this.stored(path)));
      },
      createDocument: (path, data) => writes.push({type: "create", path, data}),
      setDocument: (path, data) => writes.push({type: "set", path, data}),
      deleteDocument: (path) => writes.push({type: "delete", path}),
    };
    const result = await operation(transaction);
    this.maximumTransactionWrites = Math.max(
      this.maximumTransactionWrites,
      writes.length,
    );
    this.applyWrites(writes);
    this.calls.transactionWrites.push(
      this.recordTransactionWriteDetails ? [...writes] : writes.length,
    );
    return result;
  }

  async commitWrites(writes) {
    this.applyWrites(writes);
  }

  resetInstrumentation() {
    this.calls.getDocument.length = 0;
    this.calls.getDocuments.length = 0;
    this.calls.queryDocuments.length = 0;
    this.calls.transactionWrites.length = 0;
    this.calls.transactions = 0;
    this.activeOperations = 0;
    this.maximumOperationsInFlight = 0;
    this.maximumQueryResultSize = 0;
    this.maximumTransactionWrites = 0;
  }
}

function startRequest(overrides = {}) {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: "worker-start-request-0001",
    clientInstanceId: "worker-client-instance-0001",
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

function sessionPath(sessionId) {
  return `${privateCustomerBiteSaverSearchSessionCollection}/${sessionId}`;
}

function jobPath(jobId) {
  return `${privateCustomerBiteSaverJobCollection}/${jobId}`;
}

function currentSession(database, sessionId) {
  return database.documents.get(sessionPath(sessionId));
}

async function seedSearch(database, requestOverrides = {}) {
  let entropy = 1;
  const started = await startCustomerBiteSaverSearchHandler(
    startRequest(requestOverrides),
    {
      database,
      discoveryKey,
      identityKeyV1,
      identity: {authUid: null, authIsAnonymous: true},
      now: () => nowMs,
      randomSource: (size) => Buffer.alloc(size, entropy++),
    },
  );
  return started;
}

let phaseOccurrence = 0;
function forcePhase(database, sessionId, phase, overrides = {}) {
  const current = currentSession(database, sessionId);
  phaseOccurrence += 1;
  const jobId = customerBiteSaverJobId(
    discoveryKey,
    sessionId,
    overrides.attemptGeneration ?? current.attemptGeneration,
    phase,
    `worker-test-${phaseOccurrence}`,
  );
  const session = Object.freeze({
    ...current,
    ...overrides,
    state: "preparing",
    failureCode: null,
    phase,
    currentJobId: jobId,
    workerLeaseId: null,
    workerLeaseExpiresAt: null,
  });
  database.documents.set(sessionPath(sessionId), session);
  database.documents.set(jobPath(jobId), buildCustomerBiteSaverJobDocument({
    jobId,
    session,
    now: new Date(nowMs),
  }));
  return session;
}

function workerContext(database, counters = createCustomerBiteSaverWorkerCounters()) {
  return {
    database,
    discoveryKey,
    identityKeyV1,
    now: () => nowMs,
    randomSource: (size) => {
      database.workerEntropy = (database.workerEntropy ?? 40) + 1;
      return Buffer.alloc(size, database.workerEntropy % 251);
    },
    counters,
  };
}

async function runCurrentJob(database, sessionId) {
  const before = currentSession(database, sessionId);
  const getDocumentStart = database.calls.getDocument.length;
  const getDocumentsStart = database.calls.getDocuments.length;
  const counters = createCustomerBiteSaverWorkerCounters();
  const result = await processCustomerBiteSaverSearchJob(
    before.currentJobId,
    workerContext(database, counters),
  );
  return {
    before,
    after: currentSession(database, sessionId),
    counters,
    result,
    getDocumentCalls: database.calls.getDocument.slice(getDocumentStart),
    getDocumentsCalls: database.calls.getDocuments.slice(getDocumentsStart),
  };
}

async function driveUntil(database, sessionId, predicate, maximum = 100) {
  const iterations = [];
  while (!predicate(currentSession(database, sessionId))) {
    assert.ok(iterations.length < maximum, "worker continuation did not converge");
    iterations.push(await runCurrentJob(database, sessionId));
  }
  return iterations;
}

function rawRestaurant(index, overrides = {}) {
  const latitude = overrides.latitude ?? 28.5383;
  const longitude = overrides.longitude ?? -81.3792;
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
    bio: "Safe public bio",
    mainImageUrl: "https://images.example.test/restaurant.jpg",
    businessHours: [],
    formattedAddress: `${index} Public Avenue, Orlando, FL 32801`,
    offerCatalogUpdatedAt: new Date(nowMs - 1_000),
    ownerUid: "raw-owner-uid-canary",
    adminNotes: "raw-admin-notes-canary",
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
    rawOfferSecret: "raw-offer-secret-canary",
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
    rawOfferSecret: "raw-offer-secret-canary",
    ...overrides,
  };
}

function addRestaurantProjection(database, accountId, restaurant) {
  const projection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: accountId,
    source: restaurant,
    now: new Date(nowMs),
  });
  assert.notEqual(projection, null);
  database.documents.set(
    `restaurant_search_index/${projection.indexDocumentId}`,
    projection,
  );
  return projection;
}

function addCouponProjection(database, accountId, sourceDocumentId, restaurant, raw, {
  storeRaw = true,
  projectionOverrides = {},
} = {}) {
  const built = buildBiteSaverCouponOfferIndex({
    restaurantAccountId: accountId,
    sourceDocumentId,
    offer: raw,
    restaurant,
    now: new Date(nowMs),
  });
  assert.notEqual(built, null);
  const projection = Object.freeze({...built, ...projectionOverrides});
  database.documents.set(
    `bitesaver_offer_index/${projection.indexDocumentId}`,
    projection,
  );
  if (storeRaw) {
    database.documents.set(
      `restaurant_accounts/${accountId}/coupons/${sourceDocumentId}`,
      raw,
    );
  }
  return projection;
}

function addDailyProjection(database, accountId, sourceDocumentId, restaurant, raw, {
  storeRaw = true,
  projectionOverrides = {},
} = {}) {
  const built = buildBiteSaverDailySpecialOfferIndex({
    restaurantAccountId: accountId,
    sourceDocumentId,
    offer: raw,
    restaurant,
    now: new Date(nowMs),
  });
  assert.notEqual(built, null);
  const projection = Object.freeze({...built, ...projectionOverrides});
  database.documents.set(
    `bitesaver_offer_index/${projection.indexDocumentId}`,
    projection,
  );
  if (storeRaw) {
    database.documents.set(
      `restaurant_accounts/${accountId}/daily_specials/${sourceDocumentId}`,
      raw,
    );
  }
  return projection;
}

function documentsInCollection(database, collection) {
  const prefix = `${collection}/`;
  return [...database.documents.entries()]
    .filter(([documentPath]) =>
      documentPath.startsWith(prefix) &&
      !documentPath.slice(prefix.length).includes("/"))
    .map(([documentPath, data]) => ({
      id: documentPath.slice(prefix.length),
      path: documentPath,
      data,
    }));
}

function assertIterationBounds(database, iterations) {
  for (const iteration of iterations) {
    assert.ok(
      iteration.counters.sourceDocumentsProcessed <=
        customerBiteSaverWorkerSourceLimit,
    );
    assert.ok(
      iteration.counters.rangesAdvanced <= customerBiteSaverRangesPerWorker,
    );
    assert.ok(iteration.counters.firestoreOperationsInFlightMaximum <= 10);
    assert.ok(
      iteration.counters.candidateIdentitiesRetained <=
        customerBiteSaverWorkerSourceLimit,
    );
    assert.ok(
      iteration.counters.writesCommittedMaximum <
        customerBiteSaverMaximumWritesPerCommit + 1,
    );
  }
  for (const query of database.calls.queryDocuments) {
    assert.equal(query.limit, customerBiteSaverRangeFetchLimit);
  }
  assert.ok(database.maximumOperationsInFlight <= 10);
  assert.ok(database.maximumQueryResultSize <= customerBiteSaverWorkerSourceLimit);
  assert.ok(database.maximumTransactionWrites < 200);
}

test("worker continues through every phase and persists exact safe order inputs", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database, {
    locationMode: "typed",
    typedLocation: {kind: "city", city: "Orlando", state: "Florida"},
  });
  const fixtures = [
    {
      accountId: "account-exact",
      name: "Zebra Exact",
      city: "Orlando",
      latitude: 28.5483,
      catalogNanoseconds: 123_000_001,
    },
    {
      accountId: "account-alpha-a",
      name: "Alpha Nonexact",
      city: "Winter Park",
      latitude: 28.5383,
      catalogNanoseconds: 123_000_002,
    },
    {
      accountId: "account-alpha-b",
      name: "Alpha Nonexact",
      city: "Winter Park",
      latitude: 28.5383,
    },
    {
      accountId: "account-zulu",
      name: "Zulu Nonexact",
      city: "Winter Park",
      latitude: 28.5383,
      withoutCatalogMarker: true,
    },
    ...Array.from({length: 8}, (_, index) => ({
      accountId: `account-extra-${String(index).padStart(2, "0")}`,
      name: `ZZ Extra ${String(index).padStart(2, "0")}`,
      city: "Winter Park",
      latitude: 28.5383,
    })),
  ];
  const projections = new Map();
  const restaurantSources = new Map();
  const catalogSeconds = Math.floor(
    Date.parse("2026-09-09T11:00:00.123Z") / 1_000,
  );
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const restaurant = rawRestaurant(index + 1, {
      restaurantName: fixture.name,
      city: fixture.city,
      latitude: fixture.latitude,
      ...(fixture.catalogNanoseconds === undefined
        ? {}
        : {
            offerCatalogUpdatedAt: new Timestamp(
              catalogSeconds,
              fixture.catalogNanoseconds,
            ),
          }),
    });
    if (fixture.withoutCatalogMarker === true) {
      delete restaurant.offerCatalogUpdatedAt;
    }
    const projection = addRestaurantProjection(
      database,
      fixture.accountId,
      restaurant,
    );
    projections.set(fixture.accountId, projection);
    restaurantSources.set(fixture.accountId, restaurant);
    if (index % 2 === 0) {
      addDailyProjection(
        database,
        fixture.accountId,
        `daily-${index}`,
        restaurant,
        rawDailySpecial(fixture.accountId, index + 1),
      );
    } else {
      addCouponProjection(
        database,
        fixture.accountId,
        `coupon-${index}`,
        restaurant,
        rawCoupon(index + 1),
      );
    }
  }
  database.resetInstrumentation();

  const iterations = await driveUntil(
    database,
    started.sessionId,
    (session) => session.state !== "preparing",
  );
  const phases = new Set(iterations.map((iteration) => iteration.before.phase));
  assert.deepEqual(
    [...phases].sort(),
    [
      "finalizeCandidates",
      "offerRanges",
      "restaurantRanges",
      "verifyCatalogGeneration",
    ],
  );
  assert.equal(currentSession(database, started.sessionId).state, "ready");
  assert.ok(iterations.every((iteration) => iteration.result === true));
  assert.ok(iterations.some((iteration) =>
    iteration.counters.rangesAdvanced === customerBiteSaverRangesPerWorker));
  assert.ok(iterations.some((iteration) =>
    iteration.counters.firestoreOperationsInFlightMaximum === 10));
  assertIterationBounds(database, iterations);

  const candidates = documentsInCollection(
    database,
    privateCustomerBiteSaverCandidateCollection,
  );
  const results = documentsInCollection(
    database,
    privateCustomerBiteSaverResultCollection,
  );
  assert.equal(candidates.length, fixtures.length);
  assert.equal(results.length, fixtures.length);
  for (const candidate of candidates) {
    assert.ok(
      serializedBytes(candidate.data) <=
        customerBiteSaverMaximumCandidateDocumentBytes,
    );
  }
  for (const result of results) {
    assert.ok(
      serializedBytes(result.data) <= customerBiteSaverMaximumResultDocumentBytes,
    );
    const fixture = fixtures.find((entry) =>
      entry.accountId === result.data.authoritativeAccountId);
    const projection = projections.get(fixture.accountId);
    const expectedPreference = customerBiteSaverExactLocationPreference({
      typedLocation: {kind: "city", city: "orlando", state: "FL"},
      restaurantCity: fixture.city,
      restaurantState: "FL",
      restaurantZipCode: "32801",
    });
    const expectedDistance = exactCustomerBiteSaverDistanceMiles(
      {latitude: 28.5383, longitude: -81.3792},
      {latitude: fixture.latitude, longitude: -81.3792},
    );
    assert.equal(result.data.exactPreferenceRank, expectedPreference ? 0 : 1);
    assert.equal(
      result.data.distanceSortMiles,
      expectedPreference ? 0 : expectedDistance,
    );
    assert.equal(result.data.distanceMiles, expectedDistance);
    assert.equal(
      result.data.lowercaseDisplayNameOrderKey,
      lowercaseDisplayNameOrderKey(fixture.name),
    );
    assert.equal(
      Buffer.from(result.data.authoritativeAccountIdOrderKey).equals(
        dartUtf16FirestoreBytesOrderKey(fixture.accountId),
      ),
      true,
    );
    assert.equal(
      result.data.parentProjectionFingerprint,
      projection.sourceFingerprint,
    );
    const candidate = candidates.find((entry) =>
      entry.data.authoritativeAccountId === fixture.accountId);
    assert.equal(
      candidate.data.customerParentEligibilityFingerprint,
      projection.customerParentEligibilityFingerprint,
    );
    assert.equal(
      result.data.parentOfferCatalogFingerprint,
      customerBiteSaverSessionInternals.parentCatalogGenerationFingerprint(
        restaurantSources.get(fixture.accountId),
      ),
    );
    assert.equal(
      result.data.parentOfferCatalogFingerprint,
      customerBiteSaverSessionInternals
        .projectedParentCatalogGenerationFingerprint(projection),
    );
    assert.match(result.data.parentOfferCatalogFingerprint, /^[0-9a-f]{64}$/u);
    assert.match(result.data.offerCatalogFingerprint, /^[0-9a-f]{64}$/u);
    assert.equal(
      result.data.publicRestaurantId,
      customerBiteSaverOpaqueRestaurantId(identityKeyV1, fixture.accountId),
    );
    assert.notEqual(
      result.data.publicRestaurantId,
      customerBiteSaverOpaqueRestaurantId(
        decodeCustomerBiteSaverIdentityKeyV1(
          discoveryKey.toString("base64url"),
        ),
        fixture.accountId,
      ),
    );
  }
  const exactResult = results.find((entry) =>
    entry.data.authoritativeAccountId === "account-exact");
  const alphaResult = results.find((entry) =>
    entry.data.authoritativeAccountId === "account-alpha-a");
  assert.equal(
    projections.get("account-exact").offerCatalogUpdatedAt.getTime(),
    projections.get("account-alpha-a").offerCatalogUpdatedAt.getTime(),
  );
  assert.notEqual(
    exactResult.data.parentOfferCatalogFingerprint,
    alphaResult.data.parentOfferCatalogFingerprint,
  );
  const globallyOrdered = [...results].sort((left, right) =>
    left.data.exactPreferenceRank - right.data.exactPreferenceRank ||
    left.data.distanceSortMiles - right.data.distanceSortMiles ||
    compareValues(
      left.data.lowercaseDisplayNameOrderKey,
      right.data.lowercaseDisplayNameOrderKey,
    ) ||
    compareValues(
      left.data.authoritativeAccountIdOrderKey,
      right.data.authoritativeAccountIdOrderKey,
    ));
  assert.deepEqual(
    globallyOrdered.map((result) => result.data.authoritativeAccountId),
    [
      "account-exact",
      "account-alpha-a",
      "account-alpha-b",
      "account-zulu",
      ...Array.from(
        {length: 8},
        (_, index) => `account-extra-${String(index).padStart(2, "0")}`,
      ),
    ],
  );
  const serializedResults = JSON.stringify(results);
  assert.equal(serializedResults.includes("raw-owner-uid-canary"), false);
  assert.equal(serializedResults.includes("raw-admin-notes-canary"), false);
  assert.equal(serializedResults.includes("raw-offer-secret-canary"), false);
});

test("worker geographic range cursors use the phase query's second order", async (t) => {
  await t.test("restaurant ranges resume by sourceDocumentId", async () => {
    const database = new InMemoryWorkerDatabase();
    const started = await seedSearch(database);
    const sourceDocumentIds = [];
    const indexDocumentIds = [];
    for (let index = 0; index < 26; index += 1) {
      const sourceDocumentId =
        `restaurant-source-${String(index).padStart(3, "0")}`;
      const projection = addRestaurantProjection(
        database,
        sourceDocumentId,
        rawRestaurant(index),
      );
      sourceDocumentIds.push(sourceDocumentId);
      indexDocumentIds.push(projection.indexDocumentId);
      assert.notEqual(projection.indexDocumentId, sourceDocumentId);
    }
    database.resetInstrumentation();

    await driveUntil(
      database,
      started.sessionId,
      (session) => session.phase !== "restaurantRanges",
    );
    assert.equal(
      currentSession(database, started.sessionId).phase,
      "offerRanges",
    );
    assert.equal(
      documentsInCollection(
        database,
        privateCustomerBiteSaverCandidateCollection,
      ).length,
      26,
    );
    const continuationQueries = database.calls.queryDocuments.filter((query) =>
      query.collectionPath === "restaurant_search_index" &&
      query.startAfter !== undefined);
    assert.ok(continuationQueries.length > 0);
    assert.ok(continuationQueries.every((query) =>
      query.orders[0].field === "geohash" &&
      query.orders[1].field === "sourceDocumentId"));
    const expectedBoundary = [...sourceDocumentIds].sort(
      compareValues,
    )[customerBiteSaverRangeFetchLimit - 1];
    assert.ok(continuationQueries.some((query) =>
      query.startAfter[1] === expectedBoundary));
    assert.equal(indexDocumentIds.includes(expectedBoundary), false);
  });

  await t.test("offer ranges resume by indexDocumentId", async () => {
    const database = new InMemoryWorkerDatabase();
    const started = await seedSearch(database);
    const accountId = "range-cursor-offer-account";
    const restaurant = rawRestaurant(100);
    addRestaurantProjection(database, accountId, restaurant);
    const sourceDocumentIds = [];
    const indexDocumentIds = [];
    for (let index = 0; index < 26; index += 1) {
      const sourceDocumentId =
        `zzzz-offer-source-${String(index).padStart(3, "0")}`;
      const projection = addCouponProjection(
        database,
        accountId,
        sourceDocumentId,
        restaurant,
        rawCoupon(index),
      );
      sourceDocumentIds.push(sourceDocumentId);
      indexDocumentIds.push(projection.indexDocumentId);
      assert.notEqual(projection.indexDocumentId, sourceDocumentId);
    }
    await driveUntil(
      database,
      started.sessionId,
      (session) => session.phase === "offerRanges",
    );
    database.calls.queryDocuments.length = 0;

    await driveUntil(
      database,
      started.sessionId,
      (session) => session.phase !== "offerRanges",
    );
    assert.equal(
      currentSession(database, started.sessionId).phase,
      "finalizeCandidates",
    );
    const candidates = documentsInCollection(
      database,
      privateCustomerBiteSaverCandidateCollection,
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].data.usableOfferCount, 26);
    const continuationQueries = database.calls.queryDocuments.filter((query) =>
      query.collectionPath === "bitesaver_offer_index" &&
      query.startAfter !== undefined);
    assert.ok(continuationQueries.length > 0);
    assert.ok(continuationQueries.every((query) =>
      query.orders[0].field === "geohash" &&
      query.orders[1].field === "indexDocumentId"));
    const expectedBoundary = [...indexDocumentIds].sort(
      compareValues,
    )[customerBiteSaverRangeFetchLimit - 1];
    assert.ok(continuationQueries.some((query) =>
      query.startAfter[1] === expectedBoundary));
    assert.equal(sourceDocumentIds.includes(expectedBoundary), false);
  });
});

test("worker supports maximum parent IDs with exact indexed UTF-16 order", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const accountIds = [
    "a".repeat(1_500),
    "\u{1f4be}".repeat(374) + "\u00e9\u00e9",
    "\"\\".repeat(750),
    "\u{10000}" + "s".repeat(1_496),
    "\ue000" + "b".repeat(1_497),
  ];
  for (const [index, accountId] of [...accountIds].reverse().entries()) {
    assert.equal(Buffer.byteLength(accountId, "utf8"), 1_500);
    const restaurant = rawRestaurant(index + 1, {
      restaurantName: "Shared maximum identity restaurant",
    });
    addRestaurantProjection(database, accountId, restaurant);
    addCouponProjection(
      database,
      accountId,
      `maximum-parent-offer-${index}`,
      restaurant,
      rawCoupon(index + 1),
    );
  }

  await driveUntil(
    database,
    started.sessionId,
    (session) => session.state !== "preparing",
  );
  assert.equal(currentSession(database, started.sessionId).state, "ready");
  const candidates = documentsInCollection(
    database,
    privateCustomerBiteSaverCandidateCollection,
  );
  const results = documentsInCollection(
    database,
    privateCustomerBiteSaverResultCollection,
  );
  assert.equal(candidates.length, accountIds.length);
  assert.equal(results.length, accountIds.length);
  for (const document of [...candidates, ...results]) {
    const orderKey = document.data.authoritativeAccountIdOrderKey;
    assert.ok(orderKey instanceof Uint8Array);
    assert.equal(orderKey.byteLength, 1_500);
    assert.equal(
      Buffer.from(orderKey).equals(
        dartUtf16FirestoreBytesOrderKey(
          document.data.authoritativeAccountId,
        ),
      ),
      true,
    );
  }

  const orderedAccountIds = [];
  let startAfter;
  while (true) {
    const page = await database.queryDocuments(
      customerBiteSaverOrderedResultQuery({
        session: currentSession(database, started.sessionId),
        ...(startAfter === undefined ? {} : {startAfter}),
        limit: 2,
      }),
    );
    orderedAccountIds.push(...page.map((entry) =>
      entry.data.authoritativeAccountId));
    if (page.length < 2) break;
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
  assert.deepEqual(
    orderedAccountIds,
    [...accountIds].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
  );
});

test("offer-only membership counts and previews only exact matching offers", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database, {searchText: "needle deal"});
  const accountId = "account-offer-only-match";
  const restaurant = rawRestaurant(90, {
    restaurantName: "Ordinary Restaurant",
    bio: "ordinary public description",
  });
  addRestaurantProjection(database, accountId, restaurant);
  addCouponProjection(
    database,
    accountId,
    "newest-nonmatching",
    restaurant,
    rawCoupon(1, {title: "Newest ordinary coupon"}),
  );
  addCouponProjection(
    database,
    accountId,
    "second-nonmatching",
    restaurant,
    rawCoupon(2, {title: "Second ordinary coupon"}),
  );
  addCouponProjection(
    database,
    accountId,
    "older-matching",
    restaurant,
    rawCoupon(100, {title: "Needle Deal"}),
  );

  await driveUntil(
    database,
    started.sessionId,
    (session) => session.state !== "preparing",
  );
  const results = documentsInCollection(
    database,
    privateCustomerBiteSaverResultCollection,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].data.parentMatches, false);
  assert.equal(results[0].data.offerMatches, true);
  assert.equal(results[0].data.usableOfferCountAtPreparation, 1);
  assert.deepEqual(
    results[0].data.previewCouponCandidates.map((entry) =>
      entry.sourceDocumentId),
    ["older-matching"],
  );
});

test("fixed preparation membership evaluates Dart-local legacy timestamps", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database, {searchText: "needle deal"});
  const futureAccountId = "account-local-future-offer";
  const futureRestaurant = rawRestaurant(901, {
    restaurantName: "Ordinary Future Restaurant",
  });
  addRestaurantProjection(database, futureAccountId, futureRestaurant);
  const futureProjection = addCouponProjection(
    database,
    futureAccountId,
    "future-local-offer",
    futureRestaurant,
    rawCoupon(1, {
      title: "Needle Deal",
      startTime: "20260909T080100",
    }),
  );
  assert.equal(futureProjection.customerDiscoverable, true);
  assert.equal(futureProjection.publicVisible, false);
  assert.equal(futureProjection.startTime, "20260909T080100");

  const currentAccountId = "account-local-current-offer";
  const currentRestaurant = rawRestaurant(902, {
    restaurantName: "Ordinary Current Restaurant",
  });
  addRestaurantProjection(database, currentAccountId, currentRestaurant);
  const currentProjection = addCouponProjection(
    database,
    currentAccountId,
    "current-local-offer",
    currentRestaurant,
    rawCoupon(2, {
      title: "Needle Deal",
      startTime: "20260909T080000",
    }),
  );
  assert.equal(currentProjection.customerDiscoverable, true);
  assert.equal(currentProjection.publicVisible, false);
  assert.equal(currentProjection.startTime, "20260909T080000");

  await driveUntil(
    database,
    started.sessionId,
    (session) => session.state !== "preparing",
  );
  const resultAccounts = documentsInCollection(
    database,
    privateCustomerBiteSaverResultCollection,
  ).map((result) => result.data.authoritativeAccountId);
  assert.deepEqual(resultAccounts, [currentAccountId]);
});

test("preview ordering retains Timestamp nanos within one millisecond", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database, {searchText: ""});
  const accountId = "account-offer-nanos";
  const restaurant = rawRestaurant(910);
  addRestaurantProjection(database, accountId, restaurant);
  const seconds = Math.floor((nowMs - 10_000) / 1_000);
  addCouponProjection(
    database,
    accountId,
    "z-earlier-nanos",
    restaurant,
    rawCoupon(1, {createdAt: new Timestamp(seconds, 123_456_001)}),
  );
  addCouponProjection(
    database,
    accountId,
    "a-later-nanos",
    restaurant,
    rawCoupon(2, {createdAt: new Timestamp(seconds, 123_456_999)}),
  );

  await driveUntil(
    database,
    started.sessionId,
    (session) => session.state !== "preparing",
  );
  const [result] = documentsInCollection(
    database,
    privateCustomerBiteSaverResultCollection,
  );
  assert.equal(
    result.data.previewCouponCandidates[0].sourceCreatedAtMs,
    result.data.previewCouponCandidates[1].sourceCreatedAtMs,
  );
  assert.deepEqual(
    result.data.previewCouponCandidates.map((entry) =>
      entry.sourceDocumentId),
    ["a-later-nanos", "z-earlier-nanos"],
  );
});

test("preview ties use exact Firestore UTF-8 sourceDocumentId order", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database, {searchText: ""});
  const accountId = "account-offer-id-tie";
  const restaurant = rawRestaurant(91);
  addRestaurantProjection(database, accountId, restaurant);
  const createdAt = new Date(nowMs - 10_000);
  for (const sourceDocumentId of ["\u{10000}-offer", "\uE000-offer"]) {
    addCouponProjection(
      database,
      accountId,
      sourceDocumentId,
      restaurant,
      rawCoupon(1, {createdAt}),
    );
  }

  await driveUntil(
    database,
    started.sessionId,
    (session) => session.state !== "preparing",
  );
  const [result] = documentsInCollection(
    database,
    privateCustomerBiteSaverResultCollection,
  );
  assert.deepEqual(
    result.data.previewCouponCandidates.map((entry) =>
      entry.sourceDocumentId),
    ["\u{10000}-offer", "\uE000-offer"],
  );
});

test("bounded preview summaries support maximum IDs without capping matches or paging", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database, {searchText: "needle match"});
  const accountId = "account-maximum-offer-identities";
  const restaurant = rawRestaurant(92, {
    restaurantName: "Ordinary Maximum Identity Restaurant",
    bio: "ordinary public description",
  });
  addRestaurantProjection(database, accountId, restaurant);

  const asciiId = "a".repeat(1_500);
  const multiByteId = "\u{1f4be}".repeat(374) + "\u00e9\u00e9";
  const escapedId = "\"\\".repeat(750);
  for (const sourceDocumentId of [asciiId, multiByteId, escapedId]) {
    assert.equal(Buffer.byteLength(sourceDocumentId, "utf8"), 1_500);
    assert.equal(sourceDocumentId.includes("/"), false);
  }
  const offers = [
    {
      offerType: "dailySpecial",
      sourceDocumentId: asciiId,
      createdAt: new Date(nowMs - 100),
    },
    {
      offerType: "dailySpecial",
      sourceDocumentId: multiByteId,
      createdAt: new Date(nowMs - 200),
    },
    {
      offerType: "coupon",
      sourceDocumentId: escapedId,
      createdAt: new Date(nowMs - 50),
    },
    ...Array.from({length: 57}, (_, index) => ({
      offerType: index % 2 === 0 ? "coupon" : "dailySpecial",
      sourceDocumentId: `ordinary-needle-offer-${String(index).padStart(3, "0")}`,
      createdAt: new Date(nowMs - 10_000 - index * 1_000),
    })),
  ];
  for (const [index, offer] of [...offers].reverse().entries()) {
    if (offer.offerType === "coupon") {
      addCouponProjection(
        database,
        accountId,
        offer.sourceDocumentId,
        restaurant,
        rawCoupon(1_000 + index, {
          title: `Needle Match Coupon ${index}`,
          createdAt: offer.createdAt,
        }),
      );
    } else {
      addDailyProjection(
        database,
        accountId,
        offer.sourceDocumentId,
        restaurant,
        rawDailySpecial(accountId, 1_000 + index, {
          title: `Needle Match Daily ${index}`,
          createdAt: offer.createdAt,
        }),
      );
    }
  }

  const iterations = await driveUntil(
    database,
    started.sessionId,
    (session) => session.state !== "preparing",
  );
  assert.equal(currentSession(database, started.sessionId).state, "ready");
  assertIterationBounds(database, iterations);
  const [candidate] = documentsInCollection(
    database,
    privateCustomerBiteSaverCandidateCollection,
  );
  const [result] = documentsInCollection(
    database,
    privateCustomerBiteSaverResultCollection,
  );
  assert.notEqual(candidate, undefined);
  assert.notEqual(result, undefined);
  assert.equal(candidate.data.parentMatches, false);
  assert.equal(candidate.data.offerMatches, true);
  assert.equal(candidate.data.usableOfferCount, offers.length);
  assert.equal(result.data.usableOfferCountAtPreparation, offers.length);
  assert.deepEqual(
    candidate.data.previewDailyCandidates.map((entry) => entry.sourceDocumentId),
    [asciiId, multiByteId],
  );
  assert.deepEqual(
    candidate.data.previewCouponCandidates.map((entry) => entry.sourceDocumentId),
    [escapedId],
  );
  assert.equal(
    candidate.data.previewDailyCandidates.length +
      candidate.data.previewCouponCandidates.length,
    customerBiteSaverWorkerPreviewSummaryLimit,
  );
  assert.ok(
    serializedBytes(candidate.data) <=
      customerBiteSaverMaximumCandidateDocumentBytes,
  );
  assert.ok(
    serializedBytes(result.data) <= customerBiteSaverMaximumResultDocumentBytes,
  );
  const retainedCandidateWrites = database.calls.transactionWrites
    .flatMap((writes) => writes)
    .filter((write) => write.path.startsWith(
      `${privateCustomerBiteSaverCandidateCollection}/`,
    ));
  assert.ok(retainedCandidateWrites.length > 1);
  assert.ok(retainedCandidateWrites.every((write) =>
    write.data.previewDailyCandidates.length +
      write.data.previewCouponCandidates.length <=
        customerBiteSaverWorkerPreviewSummaryLimit &&
    serializedBytes(write.data) <= customerBiteSaverMaximumCandidateDocumentBytes));

  const pagedSourceIds = [];
  let startAfter;
  while (true) {
    const documents = await database.queryDocuments(
      customerBiteSaverPerParentOfferQuery({
        authoritativeAccountId: accountId,
        ...(startAfter === undefined ? {} : {startAfter}),
        limit: customerBiteSaverRangeFetchLimit,
      }),
    );
    pagedSourceIds.push(...documents.map((document) =>
      document.data.sourceDocumentId));
    if (documents.length < customerBiteSaverRangeFetchLimit) break;
    const last = documents.at(-1);
    startAfter = [
      last.data.presentationTypeRank,
      last.data[customerBiteSaverOfferSourceCreatedAtOrderKeyField],
      last.data.sourceDocumentId,
    ];
  }
  assert.equal(pagedSourceIds.length, offers.length);
  assert.deepEqual(
    [...pagedSourceIds].sort(compareValues),
    offers.map((offer) => offer.sourceDocumentId).sort(compareValues),
  );
});

test("duplicate delivery, active leases, and stale lease holders are fenced", async () => {
  const duplicateDatabase = new InMemoryWorkerDatabase();
  const duplicateStarted = await seedSearch(duplicateDatabase);
  const firstJobId = currentSession(
    duplicateDatabase,
    duplicateStarted.sessionId,
  ).currentJobId;
  duplicateDatabase.resetInstrumentation();
  assert.equal(
    await processCustomerBiteSaverSearchJob(
      firstJobId,
      workerContext(duplicateDatabase),
    ),
    true,
  );
  const writesAfterFirst = duplicateDatabase.calls.transactionWrites.length;
  const nextJobId = currentSession(
    duplicateDatabase,
    duplicateStarted.sessionId,
  ).currentJobId;
  assert.notEqual(nextJobId, firstJobId);
  assert.equal(
    await processCustomerBiteSaverSearchJob(
      firstJobId,
      workerContext(duplicateDatabase),
    ),
    false,
  );
  assert.equal(
    duplicateDatabase.calls.transactionWrites.length,
    writesAfterFirst + 1,
  );
  assert.deepEqual(
    duplicateDatabase.calls.transactionWrites.at(-1),
    [],
  );

  const activeLeaseDatabase = new InMemoryWorkerDatabase();
  const activeStarted = await seedSearch(activeLeaseDatabase);
  const activeSession = currentSession(activeLeaseDatabase, activeStarted.sessionId);
  const activeJobPath = jobPath(activeSession.currentJobId);
  activeLeaseDatabase.documents.set(activeJobPath, {
    ...activeLeaseDatabase.documents.get(activeJobPath),
    state: "processing",
    leaseId: `lease_${Buffer.alloc(16, 4).toString("base64url")}`,
    leaseExpiresAt: new Date(nowMs + 10_000),
    attemptCount: 1,
  });
  activeLeaseDatabase.resetInstrumentation();
  await assert.rejects(
    processCustomerBiteSaverSearchJob(
      activeSession.currentJobId,
      workerContext(activeLeaseDatabase),
    ),
    /preparation lease is still active/u,
  );
  assert.deepEqual(activeLeaseDatabase.calls.transactionWrites, [[]]);

  const staleDatabase = new InMemoryWorkerDatabase();
  const staleStarted = await seedSearch(staleDatabase);
  const staleJobId = currentSession(staleDatabase, staleStarted.sessionId)
    .currentJobId;
  staleDatabase.resetInstrumentation();
  staleDatabase.beforeTransaction = (transactionNumber, database) => {
    if (transactionNumber !== 2) return;
    const job = database.documents.get(jobPath(staleJobId));
    const session = currentSession(database, staleStarted.sessionId);
    database.documents.set(jobPath(staleJobId), {
      ...job,
      leaseId: "lease_replaced",
    });
    database.documents.set(sessionPath(staleStarted.sessionId), {
      ...session,
      workerLeaseId: "lease_replaced",
    });
  };
  assert.equal(
    await processCustomerBiteSaverSearchJob(
      staleJobId,
      workerContext(staleDatabase),
    ),
    false,
  );
  assert.deepEqual(staleDatabase.calls.transactionWrites.at(-1), []);
  assert.equal(
    currentSession(staleDatabase, staleStarted.sessionId).currentJobId,
    staleJobId,
  );
});

test("transient worker failures release their lease and remain retryable", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const firstJobId = currentSession(database, started.sessionId).currentJobId;
  const originalQueryDocuments = database.queryDocuments.bind(database);
  let failOnce = true;
  database.queryDocuments = async (query) => {
    if (failOnce) {
      failOnce = false;
      // Infrastructure clients are allowed to surface TypeError/RangeError;
      // only explicit worker safety classifications are terminal.
      throw new TypeError("transient datastore failure canary");
    }
    return originalQueryDocuments(query);
  };

  await assert.rejects(
    processCustomerBiteSaverSearchJob(firstJobId, workerContext(database)),
    /transient datastore failure canary/u,
  );
  const releasedJob = database.documents.get(jobPath(firstJobId));
  const releasedSession = currentSession(database, started.sessionId);
  assert.equal(releasedJob.state, "pending");
  assert.equal(releasedJob.leaseId, null);
  assert.equal(releasedJob.leaseExpiresAt, null);
  assert.equal(releasedSession.workerLeaseId, null);
  assert.equal(releasedSession.workerLeaseExpiresAt, null);

  assert.equal(
    await processCustomerBiteSaverSearchJob(firstJobId, workerContext(database)),
    true,
  );
  assert.notEqual(currentSession(database, started.sessionId).currentJobId, firstJobId);
});

test("transient commit failures release their lease and remain retryable", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const firstJobId = currentSession(database, started.sessionId).currentJobId;
  const originalRunTransaction = database.runTransaction.bind(database);
  let wrapperCalls = 0;
  database.runTransaction = async (operation) => {
    wrapperCalls += 1;
    if (wrapperCalls === 2) {
      throw new Error("transient commit failure canary");
    }
    return originalRunTransaction(operation);
  };

  await assert.rejects(
    processCustomerBiteSaverSearchJob(firstJobId, workerContext(database)),
    /transient commit failure canary/u,
  );
  const releasedJob = database.documents.get(jobPath(firstJobId));
  const releasedSession = currentSession(database, started.sessionId);
  assert.equal(releasedJob.state, "pending");
  assert.equal(releasedJob.leaseId, null);
  assert.equal(releasedSession.state, "preparing");
  assert.equal(releasedSession.workerLeaseId, null);

  assert.equal(
    await processCustomerBiteSaverSearchJob(firstJobId, workerContext(database)),
    true,
  );
  assert.notEqual(currentSession(database, started.sessionId).currentJobId, firstJobId);
});

test("deterministic range overflow terminalizes once without repeated work", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const accountId = "account-over-returned-range";
  const restaurant = rawRestaurant(93);
  const projection = addRestaurantProjection(database, accountId, restaurant);
  const storedProjection = database.stored(
    `restaurant_search_index/${projection.indexDocumentId}`,
  );
  database.virtualQuery = (query) => {
    if (query.collectionPath !== "restaurant_search_index") return null;
    const lowerBound = query.filters.find((filter) =>
      filter.field === "geohash" && filter.operation === ">=").value;
    const boundedProjection = Object.freeze({
      ...storedProjection,
      data: Object.freeze({...storedProjection.data, geohash: lowerBound}),
    });
    return Array.from(
      {length: customerBiteSaverWorkerSourceLimit + 1},
      () => boundedProjection,
    );
  };
  database.resetInstrumentation();
  const jobId = currentSession(database, started.sessionId).currentJobId;

  assert.equal(
    await processCustomerBiteSaverSearchJob(jobId, workerContext(database)),
    true,
  );
  const failed = currentSession(database, started.sessionId);
  assert.equal(failed.state, "failed");
  assert.equal(failed.failureCode, "preparation_failed");
  assert.equal(failed.workerLeaseId, null);
  assert.equal(database.documents.get(jobPath(jobId)).state, "completed");
  assert.equal(
    documentsInCollection(database, privateCustomerBiteSaverCandidateCollection)
      .length,
    0,
  );
  const sourceQueries = database.calls.queryDocuments.length;

  assert.equal(
    await processCustomerBiteSaverSearchJob(jobId, workerContext(database)),
    false,
  );
  assert.equal(database.calls.queryDocuments.length, sourceQueries);
  assert.equal(currentSession(database, started.sessionId).state, "failed");
});

test("an impossible finalization cursor terminalizes before source work", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const forced = forcePhase(database, started.sessionId, "finalizeCandidates", {
    finalizeAfterCandidateDocumentId: "candidate-from-another-session",
  });
  database.resetInstrumentation();

  assert.equal(
    await processCustomerBiteSaverSearchJob(
      forced.currentJobId,
      workerContext(database),
    ),
    true,
  );
  const failed = currentSession(database, started.sessionId);
  assert.equal(failed.state, "failed");
  assert.equal(failed.failureCode, "invalid_private_state");
  assert.equal(failed.workerLeaseId, null);
  assert.equal(database.calls.queryDocuments.length, 0);
  assert.equal(database.documents.get(jobPath(forced.currentJobId)).state, "completed");
  const transactionCount = database.calls.transactions;

  assert.equal(
    await processCustomerBiteSaverSearchJob(
      forced.currentJobId,
      workerContext(database),
    ),
    false,
  );
  assert.equal(database.calls.queryDocuments.length, 0);
  assert.equal(database.calls.transactions, transactionCount + 1);
});

test("worker commit preserves a newer session access and idle-expiry touch", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const before = currentSession(database, started.sessionId);
  const touchedLastAccessAt = new Date(nowMs + 5 * 60_000);
  const touchedLogicalExpiresAt = new Date(
    before.logicalExpiresAt.getTime() + 5 * 60_000,
  );
  assert.ok(touchedLogicalExpiresAt < before.absoluteExpiresAt);
  database.resetInstrumentation();
  database.beforeTransaction = (transactionNumber, currentDatabase) => {
    if (transactionNumber !== 2) return;
    const leased = currentSession(currentDatabase, started.sessionId);
    currentDatabase.documents.set(sessionPath(started.sessionId), {
      ...leased,
      lastAccessAt: touchedLastAccessAt,
      logicalExpiresAt: touchedLogicalExpiresAt,
    });
  };

  assert.equal(
    await processCustomerBiteSaverSearchJob(
      before.currentJobId,
      workerContext(database),
    ),
    true,
  );
  const after = currentSession(database, started.sessionId);
  assert.equal(after.lastAccessAt.getTime(), touchedLastAccessAt.getTime());
  assert.equal(
    after.logicalExpiresAt.getTime(),
    touchedLogicalExpiresAt.getTime(),
  );
  assert.equal(after.workerLeaseId, null);
  assert.notEqual(after.currentJobId, before.currentJobId);
  const continuation = database.documents.get(jobPath(after.currentJobId));
  assert.equal(
    continuation.logicalExpiresAt.getTime(),
    touchedLogicalExpiresAt.getTime(),
  );
  assert.equal(
    continuation.absoluteExpiresAt.getTime(),
    before.absoluteExpiresAt.getTime(),
  );
});

test("claim expires authoritative session even when the job deadline is later", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const before = currentSession(database, started.sessionId);
  const authoritativeDeadline = new Date(nowMs - 1);
  const copiedJob = database.documents.get(jobPath(before.currentJobId));
  assert.ok(copiedJob.logicalExpiresAt.getTime() > nowMs);
  database.documents.set(sessionPath(started.sessionId), {
    ...before,
    logicalExpiresAt: authoritativeDeadline,
  });
  database.resetInstrumentation();

  assert.equal(
    await processCustomerBiteSaverSearchJob(
      before.currentJobId,
      workerContext(database),
    ),
    false,
  );
  const expiredJob = database.documents.get(jobPath(before.currentJobId));
  const expiredSession = currentSession(database, started.sessionId);
  assert.equal(expiredJob.state, "expired");
  assert.equal(expiredJob.leaseId, null);
  assert.equal(expiredJob.leaseExpiresAt, null);
  assert.equal(expiredSession.state, "expired");
  assert.equal(expiredSession.logicalExpiresAt.getTime(), authoritativeDeadline.getTime());
  assert.equal(expiredSession.workerLeaseId, null);
  assert.equal(expiredSession.workerLeaseExpiresAt, null);
  assert.equal(database.calls.queryDocuments.length, 0);
  assert.equal(database.calls.transactions, 1);
});

test("malformed and missing jobs fail closed without starting work", async () => {
  const database = new InMemoryWorkerDatabase();
  assert.equal(
    await processCustomerBiteSaverSearchJob("not/a/job", workerContext(database)),
    false,
  );
  assert.equal(database.calls.transactions, 0);

  const validMissingId = `bsj_${"m".repeat(43)}`;
  assert.equal(
    await processCustomerBiteSaverSearchJob(validMissingId, workerContext(database)),
    false,
  );
  assert.equal(database.calls.transactions, 1);

  const malformedId = `bsj_${"x".repeat(43)}`;
  database.documents.set(jobPath(malformedId), {
    protocolVersion: "private-canary-version",
  });
  assert.equal(
    await processCustomerBiteSaverSearchJob(malformedId, workerContext(database)),
    false,
  );
  assert.equal(database.documents.get(jobPath(malformedId)).state, "invalid");
  assert.equal(
    JSON.stringify(database.documents.get(jobPath(malformedId)))
      .includes("private-canary-version"),
    true,
  );
  assert.equal(
    database.calls.queryDocuments.length,
    0,
  );

  const linkedDatabase = new InMemoryWorkerDatabase();
  const linkedStarted = await seedSearch(linkedDatabase);
  const linkedBefore = currentSession(linkedDatabase, linkedStarted.sessionId);
  const linkedJobPath = jobPath(linkedBefore.currentJobId);
  linkedDatabase.documents.set(linkedJobPath, {
    ...linkedDatabase.documents.get(linkedJobPath),
    protocolVersion: "malformed-linked-canary",
  });
  assert.equal(
    await processCustomerBiteSaverSearchJob(
      linkedBefore.currentJobId,
      workerContext(linkedDatabase),
    ),
    false,
  );
  assert.equal(linkedDatabase.documents.get(linkedJobPath).state, "invalid");
  const linkedAfter = currentSession(linkedDatabase, linkedStarted.sessionId);
  assert.equal(linkedAfter.state, "failed");
  assert.equal(linkedAfter.failureCode, "invalid_private_state");
  assert.equal(linkedAfter.workerLeaseId, null);
});

test("catalog restarts preserve exact start-request replay before fixed failure", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const generationPaths = Array.from(
    {length: customerBiteSaverCatalogGenerationShardCount},
    (_, index) => `${privateCustomerBiteSaverCatalogGenerationCollection}/` +
      customerBiteSaverGenerationShardId(index),
  );
  let priorFingerprint = currentSession(database, started.sessionId)
    .queryFingerprint;
  for (let restart = 1; restart <= customerBiteSaverMaximumCatalogRestarts; restart += 1) {
    for (const [index, generationPath] of generationPaths.entries()) {
      database.documents.set(generationPath, {
        ...database.documents.get(generationPath),
        shardIndex: index,
        generation: restart,
      });
    }
    forcePhase(database, started.sessionId, "verifyCatalogGeneration");
    const iteration = await runCurrentJob(database, started.sessionId);
    assert.equal(iteration.result, true);
    assert.equal(iteration.after.state, "preparing");
    assert.equal(iteration.after.phase, "restaurantRanges");
    assert.equal(iteration.after.catalogRestartCount, restart);
    assert.equal(iteration.after.attemptGeneration, restart);
    assert.notEqual(iteration.after.queryFingerprint, priorFingerprint);
    assert.ok(iteration.after.restaurantRanges.every((range) =>
      range.afterGeohash === null &&
      range.afterDocumentId === null &&
      range.exhausted === false));
    const replayedStart = await startCustomerBiteSaverSearchHandler(
      startRequest(),
      {
        database,
        discoveryKey,
        identityKeyV1,
        identity: {authUid: null, authIsAnonymous: true},
        now: () => nowMs,
        randomSource: (size) => Buffer.alloc(size, 97),
      },
    );
    assert.equal(replayedStart.sessionId, started.sessionId);
    assert.equal(replayedStart.attemptGeneration, restart);
    assert.equal(replayedStart.queryFingerprint, iteration.after.queryFingerprint);
    priorFingerprint = iteration.after.queryFingerprint;
  }

  for (const [index, generationPath] of generationPaths.entries()) {
    database.documents.set(generationPath, {
      ...database.documents.get(generationPath),
      shardIndex: index,
      generation: customerBiteSaverMaximumCatalogRestarts + 1,
    });
  }
  forcePhase(database, started.sessionId, "verifyCatalogGeneration");
  const terminal = await runCurrentJob(database, started.sessionId);
  assert.equal(terminal.result, true);
  assert.equal(terminal.after.state, "failed");
  assert.equal(terminal.after.phase, "verifyCatalogGeneration");
  assert.equal(terminal.after.failureCode, "catalog_changed_repeatedly");
  assert.equal(terminal.after.catalogRestartCount, 2);
  assert.deepEqual(
    Object.keys(terminal.after).filter((key) => key.toLowerCase().includes("error")),
    [],
  );
});

test("catalog mutation at the final commit boundary cannot publish stale results", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const verifying = forcePhase(
    database,
    started.sessionId,
    "verifyCatalogGeneration",
  );
  const shardPath = `${privateCustomerBiteSaverCatalogGenerationCollection}/` +
    customerBiteSaverGenerationShardId(0);
  database.resetInstrumentation();
  database.beforeTransaction = (transactionNumber, currentDatabase) => {
    if (transactionNumber !== 2) return;
    const shard = currentDatabase.documents.get(shardPath);
    currentDatabase.documents.set(shardPath, {
      ...shard,
      generation: shard.generation + 1,
      updatedAt: new Date(nowMs + 1),
    });
  };

  const iteration = await runCurrentJob(database, started.sessionId);

  assert.equal(iteration.result, true);
  assert.equal(iteration.before.currentJobId, verifying.currentJobId);
  assert.equal(iteration.after.state, "preparing");
  assert.equal(iteration.after.phase, "restaurantRanges");
  assert.equal(iteration.after.attemptGeneration, 1);
  assert.equal(iteration.after.catalogRestartCount, 1);
  assert.equal(iteration.after.catalogGenerationVector[0], 1);
  assert.notEqual(
    iteration.after.queryFingerprint,
    iteration.before.queryFingerprint,
  );
  assert.equal(database.calls.transactions, 2);
  assert.ok(iteration.getDocumentsCalls.some((paths) =>
    paths.length === customerBiteSaverCatalogGenerationShardCount &&
    paths.includes(shardPath)));
});

test("malformed catalog generation becomes one terminal private-state failure", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  forcePhase(database, started.sessionId, "verifyCatalogGeneration");
  const shardPath = `${privateCustomerBiteSaverCatalogGenerationCollection}/` +
    customerBiteSaverGenerationShardId(0);
  database.documents.set(shardPath, {
    ...database.documents.get(shardPath),
    generation: "malformed-generation",
  });

  const iteration = await runCurrentJob(database, started.sessionId);
  assert.equal(iteration.result, true);
  assert.equal(iteration.after.state, "failed");
  assert.equal(iteration.after.failureCode, "invalid_private_state");
  assert.equal(iteration.after.workerLeaseId, null);
  assert.equal(iteration.after.workerLeaseExpiresAt, null);
  const job = database.documents.get(jobPath(iteration.before.currentJobId));
  assert.equal(job.state, "completed");
  assert.match(job.leaseId, /^lease_[A-Za-z0-9_-]{22}$/u);
});

test("complete projections avoid raw reads while incomplete projections fail closed", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database, {searchText: "fallback needle"});
  const cases = [
    {accountId: "account-complete", rawState: "complete"},
    {accountId: "account-fallback-one", rawState: "fallback-one"},
    {accountId: "account-fallback-two", rawState: "fallback-two"},
    {accountId: "account-missing", rawState: "missing"},
    {accountId: "account-parent-mismatch", rawState: "parent-mismatch"},
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const entry = cases[index];
    const restaurant = rawRestaurant(index + 20, {
      restaurantName: `No Parent Match ${index}`,
      bio: "ordinary public description",
    });
    addRestaurantProjection(database, entry.accountId, restaurant);
    const raw = rawCoupon(index + 20, {
      title: `Fallback Needle ${entry.rawState}`,
      rawOfferSecret: `raw-${entry.rawState}-canary`,
    });
    addCouponProjection(
      database,
      entry.accountId,
      `offer-${entry.rawState}`,
      restaurant,
      raw,
      entry.rawState === "complete"
        ? {storeRaw: false}
        : entry.rawState === "parent-mismatch"
          ? {
              storeRaw: false,
              projectionOverrides: {
                customerParentEligibilityFingerprint: "f".repeat(64),
              },
            }
        : {
            storeRaw: entry.rawState.startsWith("fallback-"),
            projectionOverrides: {
              searchMatchComplete: false,
              searchMatchValues: Object.freeze([]),
            },
          },
    );
  }
  await driveUntil(
    database,
    started.sessionId,
    (session) => session.phase === "offerRanges",
  );
  database.calls.getDocument.length = 0;
  const offerIterations = await driveUntil(
    database,
    started.sessionId,
    (session) => session.phase === "finalizeCandidates",
  );
  const rawReadPaths = database.calls.getDocument.filter((documentPath) =>
    documentPath.startsWith("restaurant_accounts/"));
  assert.deepEqual(
    [...rawReadPaths].sort(),
    [
      "restaurant_accounts/account-fallback-one/coupons/offer-fallback-one",
      "restaurant_accounts/account-fallback-two/coupons/offer-fallback-two",
      "restaurant_accounts/account-missing/coupons/offer-missing",
    ],
  );
  const rawReadsByIteration = offerIterations.map((iteration) =>
    iteration.getDocumentCalls.filter((documentPath) =>
      documentPath.startsWith("restaurant_accounts/")));
  assert.ok(rawReadsByIteration.every((paths) =>
    paths.length <= customerBiteSaverMaximumRawFallbackDocumentsPerWorker));
  const matchingFallbackIterations = offerIterations.filter((iteration) =>
    iteration.counters.rawFallbackBytes > 0);
  assert.equal(matchingFallbackIterations.length, 2);
  assert.notEqual(
    matchingFallbackIterations[0].before.currentJobId,
    matchingFallbackIterations[1].before.currentJobId,
  );
  assert.ok(offerIterations.every((iteration) =>
    iteration.counters.rawFallbackBytes <=
      customerBiteSaverMaximumRawFallbackBytesPerWorker));

  await driveUntil(
    database,
    started.sessionId,
    (session) => session.state !== "preparing",
  );
  const results = documentsInCollection(
    database,
    privateCustomerBiteSaverResultCollection,
  );
  assert.deepEqual(
    results.map((result) => result.data.authoritativeAccountId).sort(),
    ["account-complete", "account-fallback-one", "account-fallback-two"],
  );
  const serialized = JSON.stringify(results);
  assert.equal(serialized.includes("raw-fallback-one-canary"), false);
  assert.equal(serialized.includes("raw-fallback-two-canary"), false);
  assert.equal(serialized.includes("raw-missing-canary"), false);
  assert.equal(serialized.includes("raw-parent-mismatch-canary"), false);
});

test("an impossible raw fallback becomes one sanitized terminal failure", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database, {searchText: "oversized needle"});
  const accountId = "account-oversized-fallback";
  const restaurant = rawRestaurant(40, {
    restaurantName: "Ordinary Parent",
    bio: "ordinary public description",
  });
  addRestaurantProjection(database, accountId, restaurant);
  addCouponProjection(
    database,
    accountId,
    "oversized-offer",
    restaurant,
    rawCoupon(40, {
      title: "Oversized Needle",
      rawOfferSecret: "x".repeat(
        customerBiteSaverMaximumRawFallbackBytesPerWorker + 1_024,
      ),
    }),
    {
      projectionOverrides: {
        searchMatchComplete: false,
        searchMatchValues: Object.freeze([]),
      },
    },
  );
  await driveUntil(
    database,
    started.sessionId,
    (session) => session.phase === "offerRanges",
  );

  let terminal = null;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const session = currentSession(database, started.sessionId);
    assert.equal(session.phase, "offerRanges");
    const counters = createCustomerBiteSaverWorkerCounters();
    const result = await processCustomerBiteSaverSearchJob(
      session.currentJobId,
      workerContext(database, counters),
    );
    const after = currentSession(database, started.sessionId);
    if (after.state === "failed") {
      terminal = {before: session, after, counters, result};
      break;
    }
  }
  assert.notEqual(terminal, null);
  assert.equal(terminal.result, true);
  assert.equal(terminal.after.state, "failed");
  assert.equal(terminal.after.failureCode, "preparation_failed");
  assert.equal(terminal.after.currentJobId, terminal.before.currentJobId);
  assert.equal(terminal.after.workerLeaseId, null);
  assert.ok(
    terminal.counters.rawFallbackBytes <=
      customerBiteSaverMaximumRawFallbackBytesPerWorker,
  );
  assert.deepEqual(
    Object.keys(terminal.after).filter((key) => key.toLowerCase().includes("error")),
    [],
  );
  assert.equal(
    database.documents.get(jobPath(terminal.before.currentJobId)).state,
    "completed",
  );
});

test("malformed retained candidates become one sanitized terminal failure", async () => {
  const database = new InMemoryWorkerDatabase();
  const started = await seedSearch(database);
  const accountId = "candidate-corruption-account";
  const restaurant = rawRestaurant(50);
  addRestaurantProjection(database, accountId, restaurant);
  addCouponProjection(
    database,
    accountId,
    "candidate-corruption-offer",
    restaurant,
    rawCoupon(50),
  );
  await driveUntil(
    database,
    started.sessionId,
    (session) => session.phase === "finalizeCandidates",
  );
  const candidates = documentsInCollection(
    database,
    privateCustomerBiteSaverCandidateCollection,
  );
  assert.equal(candidates.length, 1);
  database.documents.set(candidates[0].path, {
    ...candidates[0].data,
    privateCandidateCanary: "must-not-leak",
  });

  const iteration = await runCurrentJob(database, started.sessionId);
  assert.equal(iteration.result, true);
  assert.equal(iteration.after.state, "failed");
  assert.equal(iteration.after.failureCode, "invalid_private_state");
  assert.equal(iteration.after.workerLeaseId, null);
  assert.equal(
    documentsInCollection(database, privateCustomerBiteSaverResultCollection)
      .length,
    0,
  );
  assert.equal(
    JSON.stringify(iteration.after).includes("privateCandidateCanary"),
    false,
  );
  assert.equal(
    JSON.stringify(database.documents.get(jobPath(iteration.before.currentJobId)))
      .includes("must-not-leak"),
    false,
  );
});

function virtualCandidateDocument(session, index) {
  const suffix = String(index).padStart(12, "0");
  const id = customerBiteSaverCandidatePrefix(
    session.sessionId,
    session.attemptGeneration,
  ) + suffix.padEnd(43, "a");
  return Object.freeze({
    id,
    path: `${privateCustomerBiteSaverCandidateCollection}/${id}`,
    data: Object.freeze({
      protocolVersion: customerBiteSaverSearchProtocolVersion,
      sessionId: session.sessionId,
      attemptGeneration: session.attemptGeneration,
      criteriaFingerprint: session.criteriaFingerprint,
      queryFingerprint: session.queryFingerprint,
      callerBindingHash: session.callerBindingHash,
      state: "candidate",
      candidateDocumentId: id,
      authoritativeAccountId: `virtual-account-${suffix}`,
      parentProjectionDocumentId: `si_${"e".repeat(64)}`,
      parentProjectionFingerprint: "a".repeat(64),
      customerParentEligibilityFingerprint: "d".repeat(64),
      parentOfferCatalogFingerprint: "b".repeat(64),
      latitude: session.criteria.latitude,
      longitude: session.criteria.longitude,
      exactPreferenceRank: 1,
      distanceMiles: 0,
      distanceSortMiles: 0,
      lowercaseDisplayNameOrderKey: lowercaseDisplayNameOrderKey(
        `Virtual Restaurant ${suffix}`,
      ),
      authoritativeAccountIdOrderKey: dartUtf16FirestoreBytesOrderKey(
        `virtual-account-${suffix}`,
      ),
      parentMatches: true,
      offerMatches: false,
      usableOfferCount: 1,
      previewDailyCandidates: Object.freeze([]),
      previewCouponCandidates: Object.freeze([]),
      offerCatalogFingerprint: "c".repeat(64),
      safeRestaurantSnapshot: Object.freeze({
        displayName: `Virtual Restaurant ${suffix}`,
        streetAddress: null,
        city: "Orlando",
        state: "FL",
        zipCode: "32801",
        formattedAddress: null,
        primaryImageUrl: null,
        phone: null,
        website: null,
        businessHours: Object.freeze([]),
        bio: null,
        biteScoreCatalogRestaurantId: null,
        biteSaverCatalogBindingId: null,
      }),
      createdAt: new Date(nowMs),
      logicalExpiresAt: session.logicalExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      expiresAt: session.absoluteExpiresAt,
    }),
  });
}

function installVirtualCandidateCatalog(database, sessionId, total) {
  database.virtualQuery = (query) => {
    if (query.collectionPath !== privateCustomerBiteSaverCandidateCollection) {
      return null;
    }
    const session = currentSession(database, sessionId);
    const prefix = customerBiteSaverCandidatePrefix(
      session.sessionId,
      session.attemptGeneration,
    );
    const after = query.startAfter?.[0];
    const start = typeof after === "string" && after.startsWith(prefix)
      ? Number(after.slice(prefix.length, prefix.length + 12)) + 1
      : 0;
    const count = Math.max(0, Math.min(query.limit, total - start));
    const page = Array.from(
      {length: count},
      (_, offset) => virtualCandidateDocument(session, start + offset),
    );
    database.virtualDocumentsGenerated += page.length;
    database.maximumVirtualPage = Math.max(
      database.maximumVirtualPage,
      page.length,
    );
    return page;
  };
}

test("counting catalogs complete at 1k through 100k with no total cap", async (t) => {
  assert.deepEqual(createCustomerBiteSaverWorkerCounters(), {
    sourceDocumentsProcessed: 0,
    rangesAdvanced: 0,
    candidateIdentitiesRetained: 0,
    firestoreOperationsInFlightMaximum: 0,
    writesCommittedMaximum: 0,
    rawFallbackBytes: 0,
  });
  for (const total of [1_000, 10_000, 50_000, 100_000]) {
    await t.test(`${total.toLocaleString("en-US")} virtual candidates`, async () => {
      const database = new InMemoryWorkerDatabase();
      const started = await seedSearch(database);
      forcePhase(database, started.sessionId, "finalizeCandidates", {
        finalizeAfterCandidateDocumentId: null,
        progress: Object.freeze({
          processedSourceDocuments: 0,
          completedRestaurantRanges: 0,
          completedOfferRanges: 0,
          finalizedCandidates: 0,
        }),
      });
      database.discardResultWrites = true;
      database.compactCompletedJobs = true;
      database.recordTransactionWriteDetails = false;
      database.resetInstrumentation();
      installVirtualCandidateCatalog(database, started.sessionId, total);

      let iterations = 0;
      while (currentSession(database, started.sessionId).state === "preparing") {
        assert.ok(iterations <= total / customerBiteSaverRangeFetchLimit + 2);
        const iteration = await runCurrentJob(database, started.sessionId);
        assert.equal(iteration.result, true);
        assert.ok(
          iteration.counters.candidateIdentitiesRetained <=
            customerBiteSaverRangeFetchLimit,
        );
        assert.ok(iteration.counters.firestoreOperationsInFlightMaximum <= 10);
        assert.ok(iteration.counters.writesCommittedMaximum < 200);
        iterations += 1;
      }

      const completed = currentSession(database, started.sessionId);
      assert.equal(completed.state, "ready");
      assert.equal(completed.progress.finalizedCandidates, total);
      assert.equal(database.resultWrites, total);
      assert.equal(database.virtualDocumentsGenerated, total);
      assert.equal(database.maximumVirtualPage, customerBiteSaverRangeFetchLimit);
      assert.equal(
        iterations,
        total / customerBiteSaverRangeFetchLimit + 2,
      );
      assert.ok(database.maximumQueryResultSize <= customerBiteSaverRangeFetchLimit);
      assert.ok(database.maximumOperationsInFlight <= 10);
      assert.equal(
        database.maximumTransactionWrites,
        customerBiteSaverRangeFetchLimit + 3,
      );
      assert.ok(database.maximumTransactionWrites < 200);
      assert.ok(database.documents.size < 32);
      assert.equal(
        documentsInCollection(database, privateCustomerBiteSaverResultCollection)
          .length,
        0,
      );
    });
  }
});
