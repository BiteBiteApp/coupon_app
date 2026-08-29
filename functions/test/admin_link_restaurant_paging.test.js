"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  adminLinkRestaurantAbsoluteLifetimeMs,
  adminLinkRestaurantIdleLifetimeMs,
  adminLinkRestaurantLeaseLifetimeMs,
  adminLinkRestaurantFilterHydrationChunkSize,
  adminLinkRestaurantFilterMaximumConsumedIdentities,
  adminLinkRestaurantFilterMaximumHydrationIterations,
  adminLinkRestaurantMaximumAdvanceWrites,
  adminLinkRestaurantRangeChunkSize,
  adminLinkRestaurantReadBudget,
  searchAdminLinkRestaurantsPageHandler,
} = require("../lib/admin_link_restaurant_radius_sessions.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");
const {
  buildAdminRestaurantQueryPlans,
  verifiedAdminBiteSaverCatalogIdsFromDocuments,
} = require("../lib/admin_restaurant_search_helpers.js");

const secret = "A".repeat(43);
const center = Object.freeze({
  latitude: 28.8517,
  longitude: -82.487,
  displayName: "28.851700, -82.487000",
});
const geohash = canonicalRestaurantGeohash(center);
const baseNow = Date.UTC(2026, 7, 17, 12);

function criteria(overrides = {}) {
  return {
    schemaVersion: 1,
    orderingVersion: 1,
    purpose: "adminLinkRestaurantWorkspace",
    center: {
      mode: "coordinates",
      latitudeMicros: Math.round(center.latitude * 1_000_000),
      longitudeMicros: Math.round(center.longitude * 1_000_000),
    },
    radiusMicromiles: 10_000_000,
    restaurantName: null,
    sources: ["biteScore"],
    biteScoreStatus: "active",
    futureFilters: {},
    searchInstanceId: "search-1",
    ...overrides,
  };
}

function request(pageCriteria, overrides = {}) {
  return {
    protocolVersion: "bitestar.page.v1",
    pageSize: 50,
    criteria: pageCriteria,
    direction: "first",
    requestExactCount: false,
    clientRequestId: "request-1",
    ...overrides,
  };
}

function continuationCriteria(pageCriteria, response) {
  return {
    ...pageCriteria,
    resolvedCenter: {
      latitudeMicros: Math.round(response.searchCenter.latitude * 1_000_000),
      longitudeMicros: Math.round(response.searchCenter.longitude * 1_000_000),
      displayName: response.searchCenter.displayName,
    },
  };
}

function biteScoreDocument(id, overrides = {}) {
  return {
    documentId: id,
    data: {
      geohash,
      isActive: true,
      name: "Restaurant " + id,
      address: "1 Main Street",
      city: "Crystal River",
      state: "FL",
      zipCode: "34428",
      latitude: center.latitude,
      longitude: center.longitude,
      ...overrides,
    },
  };
}

function biteSaverDocument(id, overrides = {}) {
  return {
    documentId: id,
    data: {
      geohash,
      restaurantName: "Restaurant " + id,
      streetAddress: "1 Main Street",
      city: "Crystal River",
      state: "FL",
      zipCode: "34428",
      latitude: center.latitude,
      longitude: center.longitude,
      approvalStatus: "pending",
      couponApplicationSubmitted: true,
      ...overrides,
    },
  };
}

function compare(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function completedAdvanceRequestMarkerId(clientRequestId) {
  return `request_${createHash("sha256")
    .update(JSON.stringify([
      "adminLinkRestaurantCompletedAdvanceRequest",
      1,
      clientRequestId,
    ]), "utf8")
    .digest("hex")}`;
}

function hasMaterializedOrderFields(value) {
  return [
    "distanceMillimeters",
    "normalizedName",
    "sourceDocumentId",
    "source",
  ].every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function materializedResultValues(results) {
  return [...results.values()].filter(hasMaterializedOrderFields);
}

class FakeStore {
  constructor(candidates = []) {
    this.sessions = new Map();
    this.results = new Map();
    this.activeSessions = new Map();
    this.activeKeysBySession = new Map();
    this.candidates = candidates;
    this.current = new Map(candidates.map((candidate) => [
      candidate.source + ":" + candidate.documentId,
      candidate,
    ]));
    this.queryLimits = [];
    this.advanceReads = [];
    this.createdSessionCount = 0;
    this.acquireInitialSessionAttempts = 0;
    this.parentSessionCreateAttempts = 0;
    this.getSessionAttempts = 0;
    this.claimSessionAttempts = 0;
    this.touchReadySessionAttempts = 0;
    this.queryCandidatesAttempts = 0;
    this.finishAdvanceAttempts = 0;
    this.sessionAdvanceAttempts = 0;
    this.failAdvanceAttempts = 0;
    this.queryResultsAttempts = 0;
    this.materializedIdentityReadAttempts = 0;
    this.getSourceDocumentsAttempts = 0;
    this.sourceDocumentReadAttempts = 0;
    this.sourceDocumentIdentityBatches = [];
    this.sessionWriteAttempts = 0;
    this.resultContainerCreateAttempts = 0;
    this.materializedResultWriteAttempts = 0;
    this.completedRequestMarkerWriteAttempts = 0;
    this.activePointerWriteAttempts = 0;
    this.activeKeyBindingWriteAttempts = 0;
    this.nowMs = baseNow;
    this.queryCandidatesHook = null;
  }

  activePointer(session, expiresAtMs) {
    return {
      sessionId: session.id,
      callerBinding: session.callerBinding,
      queryFingerprint: session.queryFingerprint,
      searchInstanceHash: session.searchInstanceHash,
      expiresAtMs,
    };
  }

  activeKeyForRefresh(session, nowMs) {
    const activeKey = this.activeKeysBySession.get(session.id);
    if (activeKey === undefined) return null;
    const pointer = this.activeSessions.get(activeKey);
    if (pointer === undefined) return activeKey;
    if (
      pointer.sessionId === session.id &&
      pointer.callerBinding === session.callerBinding &&
      pointer.queryFingerprint === session.queryFingerprint &&
      pointer.searchInstanceHash === session.searchInstanceHash
    ) {
      return activeKey;
    }
    return pointer.expiresAtMs <= nowMs ? activeKey : null;
  }

  refreshActivePointer(session, expiresAtMs, nowMs) {
    const activeKey = this.activeKeyForRefresh(session, nowMs);
    if (activeKey === null) return false;
    this.writeActivePointer(activeKey, session, expiresAtMs);
    return true;
  }

  writeActivePointer(activeKey, session, expiresAtMs) {
    this.activePointerWriteAttempts += 1;
    this.activeSessions.set(
      activeKey,
      this.activePointer(session, expiresAtMs),
    );
  }

  activePointerForSession(sessionId) {
    const activeKey = this.activeKeysBySession.get(sessionId);
    return activeKey === undefined
      ? undefined
      : this.activeSessions.get(activeKey);
  }

  sweepExpiredActivePointers(nowMs = this.nowMs) {
    for (const [activeKey, pointer] of this.activeSessions) {
      if (pointer.expiresAtMs <= nowMs) this.activeSessions.delete(activeKey);
    }
  }

  async acquireInitialSession({activeKey, session, nowMs}) {
    this.acquireInitialSessionAttempts += 1;
    const pointer = this.activeSessions.get(activeKey);
    const existing = this.sessions.get(pointer?.sessionId);
    if (existing &&
        pointer.callerBinding === session.callerBinding &&
        pointer.queryFingerprint === session.queryFingerprint &&
        pointer.searchInstanceHash === session.searchInstanceHash &&
        existing.callerBinding === session.callerBinding &&
        existing.queryFingerprint === session.queryFingerprint &&
        existing.searchInstanceHash === session.searchInstanceHash &&
        nowMs < existing.idleExpiresAtMs &&
        nowMs < existing.absoluteExpiresAtMs) {
      return existing;
    }
    this.parentSessionCreateAttempts += 1;
    this.sessionWriteAttempts += 1;
    this.sessions.set(session.id, session);
    this.resultContainerCreateAttempts += 1;
    this.results.set(session.id, new Map());
    this.activeKeyBindingWriteAttempts += 1;
    this.activeKeysBySession.set(session.id, activeKey);
    this.writeActivePointer(activeKey, session, session.idleExpiresAtMs);
    this.createdSessionCount += 1;
    return session;
  }

  async getSession(id) {
    this.getSessionAttempts += 1;
    return this.sessions.get(id) ?? null;
  }

  async claimSession(input) {
    this.claimSessionAttempts += 1;
    const session = this.sessions.get(input.sessionId);
    if (input.nowMs >= session.idleExpiresAtMs ||
        input.nowMs >= session.absoluteExpiresAtMs) {
      throw new Error("expired session");
    }
    const requestMarkerId = completedAdvanceRequestMarkerId(
      input.clientRequestId,
    );
    if (
      this.results.get(session.id).has(requestMarkerId) ||
      session.lastCompletedRequestId === input.clientRequestId
    ) {
      return {status: "duplicate", session};
    }
    if (session.leaseToken && session.leaseUntilMs > input.nowMs) {
      return {status: "busy", session};
    }
    const idleExpiresAtMs = Math.min(
      input.nowMs + adminLinkRestaurantIdleLifetimeMs,
      session.absoluteExpiresAtMs,
    );
    const claimed = {
      ...session,
      leaseToken: input.leaseToken,
      leaseUntilMs: input.nowMs + adminLinkRestaurantLeaseLifetimeMs,
      leaseGeneration: session.leaseGeneration + 1,
      lastUsedAtMs: input.nowMs,
      idleExpiresAtMs,
    };
    if (!this.refreshActivePointer(
      claimed,
      idleExpiresAtMs,
      input.nowMs,
    )) {
      throw new Error("active session conflict");
    }
    this.sessionWriteAttempts += 1;
    this.sessions.set(session.id, claimed);
    return {status: "claimed", session: claimed};
  }

  async touchReadySession(input) {
    this.touchReadySessionAttempts += 1;
    const session = this.sessions.get(input.sessionId);
    if (input.nowMs >= session.idleExpiresAtMs ||
        input.nowMs >= session.absoluteExpiresAtMs) {
      throw new Error("expired session");
    }
    if (this.activeKeysBySession.get(session.id) !== input.activeKey) {
      throw new Error("active session conflict");
    }
    const next = {
      ...session,
      lastUsedAtMs: input.nowMs,
      idleExpiresAtMs: Math.min(
        input.nowMs + adminLinkRestaurantIdleLifetimeMs,
        session.absoluteExpiresAtMs,
      ),
    };
    if (!this.refreshActivePointer(
      next,
      next.idleExpiresAtMs,
      input.nowMs,
    )) {
      throw new Error("active session conflict");
    }
    this.sessionWriteAttempts += 1;
    this.sessions.set(session.id, next);
    return next;
  }

  async queryCandidates({range, limit}) {
    this.queryCandidatesAttempts += 1;
    this.queryLimits.push(limit);
    const query = () => {
      let matches = this.candidates.filter((candidate) =>
        candidate.source === range.source &&
        candidate.data.geohash >= range.start &&
        candidate.data.geohash <= range.end &&
        (range.biteScoreIsActive === null ||
          candidate.data.isActive === range.biteScoreIsActive));
      matches.sort((first, second) =>
        compare(first.data.geohash, second.data.geohash) ||
        compare(first.documentId, second.documentId));
      if (range.afterGeohash !== null) {
        matches = matches.filter((candidate) => {
          const byGeohash = compare(candidate.data.geohash, range.afterGeohash);
          return byGeohash > 0 ||
            (byGeohash === 0 &&
              compare(candidate.documentId, range.afterDocumentId) > 0);
        });
      }
      return matches.slice(0, limit).map(({documentId, data}) => ({
        documentId,
        data,
      }));
    };
    return this.queryCandidatesHook === null
      ? query()
      : this.queryCandidatesHook({range, limit, query});
  }

  async finishAdvance(input) {
    this.finishAdvanceAttempts += 1;
    this.sessionAdvanceAttempts += 1;
    const session = this.sessions.get(input.sessionId);
    if (session.leaseToken !== input.leaseToken ||
        session.leaseGeneration !== input.leaseGeneration ||
        session.leaseUntilMs <= this.nowMs ||
        session.idleExpiresAtMs <= this.nowMs ||
        session.absoluteExpiresAtMs <= this.nowMs) {
      throw new Error("expired or stale lease");
    }
    const idleExpiresAtMs = Math.min(
      this.nowMs + adminLinkRestaurantIdleLifetimeMs,
      session.absoluteExpiresAtMs,
    );
    const activeKey = this.activeKeyForRefresh(session, this.nowMs);
    if (activeKey === null) {
      throw new Error("active session conflict");
    }
    const results = this.results.get(input.sessionId);
    const requestMarkerId = completedAdvanceRequestMarkerId(
      input.clientRequestId,
    );
    if (results.has(requestMarkerId)) {
      throw new Error("completed request marker already exists");
    }
    for (const value of input.results) {
      this.materializedResultWriteAttempts += 1;
      results.set(value.id, value);
    }
    this.completedRequestMarkerWriteAttempts += 1;
    results.set(requestMarkerId, {
      id: requestMarkerId,
      markerType: "completedAdvanceRequest",
      schemaVersion: 1,
      completedAtMs: this.nowMs,
      expiresAtMs: session.absoluteExpiresAtMs,
    });
    this.advanceReads.push(input.documentsRead);
    const next = {
      ...session,
      state: input.state,
      ranges: input.ranges,
      leaseToken: null,
      leaseUntilMs: null,
      lastCompletedRequestId: input.clientRequestId,
      scannedDocumentCount: session.scannedDocumentCount + input.documentsRead,
      lastUsedAtMs: this.nowMs,
      idleExpiresAtMs,
    };
    this.writeActivePointer(activeKey, next, idleExpiresAtMs);
    this.sessionWriteAttempts += 1;
    this.sessions.set(session.id, next);
    return next;
  }

  async failAdvance(input) {
    this.failAdvanceAttempts += 1;
    const session = this.sessions.get(input.sessionId);
    if (session.leaseToken !== input.leaseToken ||
        session.leaseGeneration !== input.leaseGeneration ||
        session.leaseUntilMs <= this.nowMs ||
        session.idleExpiresAtMs <= this.nowMs ||
        session.absoluteExpiresAtMs <= this.nowMs) {
      return;
    }
    const activeKey = this.activeKeyForRefresh(session, this.nowMs);
    if (activeKey === null) return;
    const failed = {
      ...session,
      state: "failed",
      failureMessage: "Restaurant search preparation failed.",
      leaseToken: null,
      leaseUntilMs: null,
      lastCompletedRequestId: input.clientRequestId,
      lastUsedAtMs: this.nowMs,
      idleExpiresAtMs: Math.min(
        this.nowMs + adminLinkRestaurantIdleLifetimeMs,
        session.absoluteExpiresAtMs,
      ),
    };
    this.sessionWriteAttempts += 1;
    this.sessions.set(session.id, failed);
    this.writeActivePointer(activeKey, failed, failed.idleExpiresAtMs);
  }

  async queryResults({sessionId, after, limit}) {
    this.queryResultsAttempts += 1;
    let values = [...this.results.get(sessionId).values()]
      .filter(hasMaterializedOrderFields);
    const tuple = (value) => [
      value.distanceMillimeters,
      value.normalizedName,
      value.sourceDocumentId,
      value.source,
    ];
    const compareTuple = (left, right) => {
      for (let index = 0; index < 4; index += 1) {
        const result = compare(left[index], right[index]);
        if (result !== 0) return result;
      }
      return 0;
    };
    values.sort((first, second) => compareTuple(tuple(first), tuple(second)));
    if (after) values = values.filter((value) => compareTuple(tuple(value), after) > 0);
    const selected = values.slice(0, limit);
    this.materializedIdentityReadAttempts += selected.length;
    return selected.map((value) => ({id: value.id, data: value}));
  }

  async getSourceDocuments(identities) {
    this.getSourceDocumentsAttempts += 1;
    this.sourceDocumentReadAttempts += identities.length;
    this.sourceDocumentIdentityBatches.push(identities.map((identity) => ({
      ...identity,
    })));
    return identities.flatMap((identity) => {
      const value = this.current.get(identity.source + ":" + identity.documentId);
      return value === undefined ? [] : [value];
    });
  }
}

function handler(store, overrides = {}) {
  return {
    adminUid: "admin-1",
    cursorSecret: secret,
    store,
    getGeocodingApiKey: () => {
      throw new Error("coordinate search must not read the geocoding secret");
    },
    fetchGeocoding: async () => {
      throw new Error("coordinate search must not geocode");
    },
    now: () => store.nowMs,
    nonceSource: () => new Uint8Array(12).fill(7),
    sessionIdSource: () => "admin-link-session",
    leaseTokenSource: () => "admin-link-lease",
    ...overrides,
  };
}

const bindingId = "B".repeat(43);

function filterableBiteScoreDocument(id, overrides = {}) {
  return biteScoreDocument(id, {
    id,
    isClaimed: true,
    ownerUserId: "owner-" + id,
    restaurantWriteRevision: 1,
    biteSaverCatalogBindingId: bindingId,
    linkedBiteSaverUid: "account-" + id,
    ...overrides,
  });
}

function completePreparation() {
  return {schemaVersion: 1, saPrepared: true, srPrepared: true};
}

function filterableUnboundBiteScoreDocument(id, overrides = {}) {
  return biteScoreDocument(id, {
    id,
    isClaimed: false,
    ownerUserId: null,
    restaurantWriteRevision: 1,
    linkedBiteSaverUid: null,
    ...overrides,
  });
}

function strictBindingVerifier(accountDocuments, counters = undefined) {
  return async (requests) => {
    const documents = accountDocuments.map((account) => account.data ?? account);
    const catalogRestaurantIds = [
      ...new Set(requests.map((request) => request.catalogRestaurantId)),
    ];
    const returnedDocuments = [];
    const saturatedCatalogRestaurantIds = new Set();
    if (counters !== undefined) {
      counters.calls += 1;
      counters.requests += requests.length;
      counters.largestRequestBatch = Math.max(
        counters.largestRequestBatch ?? 0,
        requests.length,
      );
    }
    for (let offset = 0; offset < catalogRestaurantIds.length; offset += 10) {
      const chunk = catalogRestaurantIds.slice(offset, offset + 10);
      const chunkIds = new Set(chunk);
      const snapshotDocuments = documents
        .filter((data) => chunkIds.has(data.biteScoreCatalogRestaurantId))
        .slice(0, chunk.length * 2);
      if (counters !== undefined) {
        counters.queryCalls = (counters.queryCalls ?? 0) + 1;
        counters.documentReads += snapshotDocuments.length;
        counters.largestQueryIdBatch = Math.max(
          counters.largestQueryIdBatch ?? 0,
          chunk.length,
        );
        counters.largestDocumentBatch = Math.max(
          counters.largestDocumentBatch ?? 0,
          snapshotDocuments.length,
        );
        const documentsPerCanonical = new Map();
        for (const data of snapshotDocuments) {
          const id = data.biteScoreCatalogRestaurantId;
          documentsPerCanonical.set(
            id,
            (documentsPerCanonical.get(id) ?? 0) + 1,
          );
        }
        counters.maximumDocumentsPerCanonical = Math.max(
          counters.maximumDocumentsPerCanonical ?? 0,
          ...documentsPerCanonical.values(),
        );
      }
      if (snapshotDocuments.length >= chunk.length * 2) {
        for (const id of chunk) {
          saturatedCatalogRestaurantIds.add(id);
        }
      } else {
        returnedDocuments.push(...snapshotDocuments);
      }
    }
    return verifiedAdminBiteSaverCatalogIdsFromDocuments({
      requests,
      accountDocuments: returnedDocuments,
      saturatedCatalogRestaurantIds,
    });
  };
}

function boundBiteSaverDocument(canonicalId, accountId, overrides = {}) {
  return biteSaverDocument(accountId, {
    uid: accountId,
    linkedBiteScoreRestaurantId: canonicalId,
    biteScoreCatalogRestaurantId: canonicalId,
    biteSaverCatalogBindingId: bindingId,
    ...overrides,
  });
}

function preparationInvitation(type, id, canonicalId, overrides = {}) {
  const owner = type === "I";
  return {
    type: owner ? "coupon_invite" : "bitescore_claim_invite",
    side: owner ? "coupon" : "bitescore",
    status: "active",
    restaurantId: owner ? null : canonicalId,
    ...(owner ? {
      pendingRestaurantKey: `pending_${id}`,
      biteScoreCatalogRestaurantId: canonicalId,
    } : {}),
    maxUses: 1,
    useCount: 0,
    usedAt: null,
    usedByUid: null,
    usedByEmail: null,
    revokedAt: null,
    revokedByUid: null,
    createdAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    ...overrides,
  };
}

function filteredHandler(store, preparationDocuments = new Map(), overrides = {}) {
  return handler(store, {
    verifyBiteSaverCatalogBindings: async (requests) =>
      new Set(requests.map((entry) => entry.catalogRestaurantId)),
    loadQrPreparationDocuments: async (ids) => new Map(
      ids.flatMap((id) => preparationDocuments.has(id)
        ? [[id, preparationDocuments.get(id)]]
        : []),
    ),
    loadQrPreparationInvitationDocuments: async () => new Map(),
    ...overrides,
  });
}

function qrFilterCriteria(value, overrides = {}) {
  return criteria({
    futureFilters: {needsQrPreparation: value},
    searchInstanceId: value ? "filter-on" : "filter-off",
    ...overrides,
  });
}

function forwardRequest(pageCriteria, response, clientRequestId) {
  return request(continuationCriteria(pageCriteria, response), {
    direction: "forward",
    cursor: response.nextCursor,
    clientRequestId,
  });
}

test("Admin Link session constants retain exact bounded budgets and expiry", () => {
  assert.equal(adminLinkRestaurantRangeChunkSize, 25);
  assert.equal(adminLinkRestaurantReadBudget, 450);
  assert.equal(adminLinkRestaurantMaximumAdvanceWrites, 453);
  assert.ok(adminLinkRestaurantMaximumAdvanceWrites < 500);
  assert.equal(adminLinkRestaurantIdleLifetimeMs, 15 * 60 * 1000);
  assert.equal(adminLinkRestaurantAbsoluteLifetimeMs, 60 * 60 * 1000);
  assert.equal(adminLinkRestaurantLeaseLifetimeMs, 30 * 1000);
  assert.equal(adminLinkRestaurantFilterHydrationChunkSize, 50);
  assert.equal(adminLinkRestaurantFilterMaximumConsumedIdentities, 100);
  assert.equal(adminLinkRestaurantFilterMaximumHydrationIterations, 2);
});

test("Admin Link QR filter contract preserves legacy and validates v1 exactly", async () => {
  const legacyStore = new FakeStore([]);
  const legacy = await searchAdminLinkRestaurantsPageHandler(
    request(criteria()),
    handler(legacyStore),
  );
  assert.equal(Object.hasOwn(legacy, "filterMetadata"), false);
  assert.equal([...legacyStore.sessions.values()][0].filterContractVersion, 1);
  assert.equal([...legacyStore.sessions.values()][0].needsQrPreparation, false);

  const filterOffStore = new FakeStore([]);
  const filterOff = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(false)),
    handler(filterOffStore),
  );
  assert.deepEqual(filterOff.filterMetadata, {
    schemaVersion: 1,
    needsQrPreparation: false,
    preparationUnavailableEncountered: false,
  });

  for (const futureFilters of [
    {needsQrPreparation: "true"},
    {needsQrPreparation: true, unexpected: false},
    {unexpected: true},
  ]) {
    const store = new FakeStore([]);
    await assert.rejects(
      searchAdminLinkRestaurantsPageHandler(
        request(criteria({futureFilters})),
        handler(store),
      ),
      /invalid/u,
    );
    assert.equal(store.createdSessionCount, 0);
  }

  const biteSaverOnlyStore = new FakeStore([]);
  await assert.rejects(
    searchAdminLinkRestaurantsPageHandler(
      request(qrFilterCriteria(true, {
        sources: ["biteSaver"],
        searchInstanceId: "bite-saver-only",
      })),
      handler(biteSaverOnlyStore),
    ),
    /BiteScore/u,
  );
  assert.equal(biteSaverOnlyStore.createdSessionCount, 0);
});

test("QR filter value is cursor-bound in both directions", async () => {
  const candidates = Array.from({length: 101}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `cursor-${String(index + 1).padStart(3, "0")}`,
    ),
  }));
  const preparations = new Map(candidates.map((candidate) => [
    candidate.documentId,
    completePreparation(),
  ]));
  const filteredStore = new FakeStore(candidates);
  const filteredCriteria = qrFilterCriteria(true, {
    searchInstanceId: "same-filter-instance",
  });
  const filtered = await searchAdminLinkRestaurantsPageHandler(
    request(filteredCriteria),
    filteredHandler(filteredStore, preparations),
  );
  assert.equal(filtered.hasNext, true);
  await assert.rejects(
    searchAdminLinkRestaurantsPageHandler(
      forwardRequest(
        qrFilterCriteria(false, {searchInstanceId: "same-filter-instance"}),
        filtered,
        "filtered-cursor-under-off",
      ),
      filteredHandler(filteredStore, preparations),
    ),
  );

  const unfilteredStore = new FakeStore(candidates.slice(0, 60));
  const unfilteredCriteria = qrFilterCriteria(false, {
    searchInstanceId: "same-unfiltered-instance",
  });
  const unfiltered = await searchAdminLinkRestaurantsPageHandler(
    request(unfilteredCriteria),
    handler(unfilteredStore),
  );
  assert.equal(unfiltered.hasNext, true);
  await assert.rejects(
    searchAdminLinkRestaurantsPageHandler(
      forwardRequest(
        qrFilterCriteria(true, {
          searchInstanceId: "same-unfiltered-instance",
        }),
        unfiltered,
        "off-cursor-under-filtered",
      ),
      filteredHandler(unfilteredStore),
    ),
  );
});

test("QR filter returns 50 unfinished identities only when a real lookahead remains", async () => {
  const candidates = Array.from({length: 60}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `unfinished-${String(index + 1).padStart(3, "0")}`,
    ),
  }));
  const store = new FakeStore(candidates);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(true)),
    filteredHandler(store),
  );
  assert.equal(response.items.length, 50);
  assert.equal(response.hasNext, true);
  assert.equal(response.consumedBoundary.sourceDocumentId, "unfinished-050");
  assert.equal(typeof response.nextCursor, "string");
  assert.equal(store.queryResultsAttempts, 1);
  assert.equal(store.materializedIdentityReadAttempts, 51);
  assert.equal(store.sourceDocumentReadAttempts, 50);
  assert.deepEqual(response.filterMetadata, {
    schemaVersion: 1,
    needsQrPreparation: true,
    preparationUnavailableEncountered: false,
  });
  assert.ok(response.items.every((item) =>
    item.source === "biteScore" &&
    item.documentId === item.actionId &&
    !JSON.stringify(item).includes("private_admin_restaurant_qr_preparation")));

  const terminal = await searchAdminLinkRestaurantsPageHandler(
    forwardRequest(qrFilterCriteria(true), response, "unfinished-next"),
    filteredHandler(store),
  );
  assert.equal(terminal.items.length, 10);
  assert.equal(terminal.items[0].documentId, "unfinished-051");
  assert.equal(terminal.items.at(-1).documentId, "unfinished-060");
  assert.equal(terminal.hasNext, false);
  assert.equal(Object.hasOwn(terminal, "nextCursor"), false);
});

test("an exact terminal page of 50 filtered matches has no false continuation", async () => {
  const candidates = Array.from({length: 50}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `terminal-${String(index + 1).padStart(3, "0")}`,
    ),
  }));
  const store = new FakeStore(candidates);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(true, {
      searchInstanceId: "exact-terminal-50",
    })),
    filteredHandler(store),
  );

  assert.equal(response.items.length, 50);
  assert.equal(response.items.at(-1).documentId, "terminal-050");
  assert.equal(response.consumedBoundary.sourceDocumentId, "terminal-050");
  assert.equal(response.hasNext, false);
  assert.equal(response.capabilities.next, false);
  assert.equal(Object.hasOwn(response, "nextCursor"), false);
  assert.equal(store.queryResultsAttempts, 1);
  assert.equal(store.materializedIdentityReadAttempts, 50);
  assert.equal(store.sourceDocumentReadAttempts, 50);
});

test("the 50th second-iteration match continues only with proven remainder", async () => {
  for (const [total, expectedHasNext, expectedMaterializedReads] of [
    [100, false, 101],
    [101, true, 102],
  ]) {
    const candidates = Array.from({length: total}, (_, index) => ({
      source: "biteScore",
      ...filterableBiteScoreDocument(
        `second-${total}-${String(index + 1).padStart(3, "0")}`,
      ),
    }));
    const preparations = new Map(candidates.slice(0, 50).map((candidate) => [
      candidate.documentId,
      completePreparation(),
    ]));
    const store = new FakeStore(candidates);
    const response = await searchAdminLinkRestaurantsPageHandler(
      request(qrFilterCriteria(true, {
        searchInstanceId: `second-iteration-${total}`,
      })),
      filteredHandler(store, preparations),
    );

    assert.equal(response.items.length, 50, String(total));
    assert.equal(
      response.items.at(-1).documentId,
      `second-${total}-100`,
      String(total),
    );
    assert.equal(
      response.consumedBoundary.sourceDocumentId,
      `second-${total}-100`,
      String(total),
    );
    assert.equal(response.hasNext, expectedHasNext, String(total));
    assert.equal(
      Object.hasOwn(response, "nextCursor"),
      expectedHasNext,
      String(total),
    );
    assert.equal(store.queryResultsAttempts, 2, String(total));
    assert.equal(
      store.materializedIdentityReadAttempts,
      expectedMaterializedReads,
      String(total),
    );
  }
});

test("QR filter consumes at most 100 complete identities before continuing", async () => {
  const candidates = Array.from({length: 101}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `bounded-${String(index + 1).padStart(3, "0")}`,
    ),
  }));
  const preparations = new Map(candidates.slice(0, 100).map((candidate) => [
    candidate.documentId,
    completePreparation(),
  ]));
  const store = new FakeStore(candidates);
  const pageCriteria = qrFilterCriteria(true);
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    filteredHandler(store, preparations),
  );
  assert.equal(first.items.length, 0);
  assert.equal(first.hasNext, true);
  assert.equal(first.consumedBoundary.sourceDocumentId, "bounded-100");
  assert.equal(store.queryResultsAttempts, 2);
  assert.equal(store.sourceDocumentReadAttempts, 100);

  const second = await searchAdminLinkRestaurantsPageHandler(
    forwardRequest(pageCriteria, first, "bounded-continue"),
    filteredHandler(store, preparations),
  );
  assert.deepEqual(second.items.map((item) => item.documentId), [
    "bounded-101",
  ]);
  assert.equal(second.hasNext, false);
});

// Ready-page hydration and geographic materialization are separate bounded
// categories. This fixture reaches both maxima in one fresh callable.
test("a 449-read advance plus BiteScore hydration reaches exactly 1151 reads", async () => {
  const candidates = Array.from({length: 449}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `instrumented-${String(index + 1).padStart(3, "0")}`,
    ),
  }));
  const accounts = candidates.flatMap((candidate) => [
    {
      biteScoreCatalogRestaurantId: candidate.documentId,
      biteSaverCatalogBindingId: bindingId,
    },
    {
      biteScoreCatalogRestaurantId: candidate.documentId,
      biteSaverCatalogBindingId: bindingId,
    },
  ]);
  const future = new Date(Date.now() + 60 * 60 * 1_000);
  const preparationDocuments = new Map(candidates.map((candidate, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    return [candidate.documentId, {
      schemaVersion: 1,
      saPrepared: true,
      srPrepared: true,
      iPreparedInviteId: `i-${suffix}`,
      iPreparedInviteExpiresAt: future,
      cPreparedInviteId: `c-${suffix}`,
      cPreparedInviteExpiresAt: future,
    }];
  }));
  const invitationDocuments = new Map(candidates.flatMap((candidate, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    return [
      [`i-${suffix}`, preparationInvitation(
        "I",
        `i-${suffix}`,
        candidate.documentId,
        {expiresAt: future},
      )],
      [`c-${suffix}`, preparationInvitation(
        "C",
        `c-${suffix}`,
        candidate.documentId,
        {expiresAt: future},
      )],
    ];
  }));
  const reciprocal = {calls: 0, requests: 0, documentReads: 0};
  const preparation = {calls: 0, documentReads: 0, largestBatch: 0};
  const invitations = {
    calls: 0,
    iDocumentReads: 0,
    cDocumentReads: 0,
    largestBatch: 0,
  };
  const store = new FakeStore(candidates);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(true, {
      searchInstanceId: "instrumented-filter-bound",
    })),
    filteredHandler(store, preparationDocuments, {
      verifyBiteSaverCatalogBindings: strictBindingVerifier(
        accounts,
        reciprocal,
      ),
      loadQrPreparationDocuments: async (ids) => {
        preparation.calls += 1;
        preparation.documentReads += ids.length;
        preparation.largestBatch = Math.max(
          preparation.largestBatch,
          ids.length,
        );
        return new Map(ids.map((id) => [id, preparationDocuments.get(id)]));
      },
      loadQrPreparationInvitationDocuments: async (ids) => {
        invitations.calls += 1;
        invitations.largestBatch = Math.max(
          invitations.largestBatch,
          ids.length,
        );
        invitations.iDocumentReads += ids.filter((id) => id.startsWith("i-"))
          .length;
        invitations.cDocumentReads += ids.filter((id) => id.startsWith("c-"))
          .length;
        return new Map(ids.map((id) => [id, invitationDocuments.get(id)]));
      },
    }),
  );

  assert.deepEqual(response.items, []);
  assert.equal(response.hasNext, true);
  assert.equal(response.filterMetadata.preparationUnavailableEncountered, true);
  assert.equal(response.consumedBoundary.sourceDocumentId, "instrumented-100");
  assert.equal(store.queryResultsAttempts, 2);
  assert.equal(store.materializedIdentityReadAttempts, 102);
  assert.equal(store.sourceDocumentReadAttempts, 100);
  assert.equal(store.getSourceDocumentsAttempts, 2);
  assert.equal(reciprocal.calls, 2);
  assert.equal(reciprocal.queryCalls, 10);
  assert.equal(reciprocal.requests, 100);
  assert.equal(reciprocal.documentReads, 200);
  assert.equal(reciprocal.largestRequestBatch, 50);
  assert.equal(reciprocal.largestQueryIdBatch, 10);
  assert.equal(reciprocal.largestDocumentBatch, 20);
  assert.equal(reciprocal.maximumDocumentsPerCanonical, 2);
  assert.equal(preparation.calls, 2);
  assert.equal(preparation.documentReads, 100);
  assert.equal(preparation.largestBatch, 50);
  assert.equal(invitations.calls, 2);
  assert.equal(invitations.iDocumentReads, 100);
  assert.equal(invitations.cDocumentReads, 100);
  assert.equal(invitations.largestBatch, 100);
  assert.equal(store.sourceDocumentIdentityBatches.length, 2);
  assert.ok(store.sourceDocumentIdentityBatches.every((batch) =>
    batch.length === 50));
  assert.ok(store.queryResultsAttempts <= 2);
  assert.ok(store.materializedIdentityReadAttempts <= 102);
  assert.ok(store.sourceDocumentReadAttempts <= 100);
  assert.ok(reciprocal.documentReads <= 200);
  assert.ok(preparation.documentReads <= 100);
  assert.ok(invitations.iDocumentReads <= 100);
  assert.ok(invitations.cDocumentReads <= 100);
  const readyPageHydrationReads =
    store.materializedIdentityReadAttempts +
      store.sourceDocumentReadAttempts +
      reciprocal.documentReads +
      preparation.documentReads +
      invitations.iDocumentReads +
      invitations.cDocumentReads;
  assert.equal(readyPageHydrationReads, 702);
  assert.deepEqual(store.advanceReads, [449]);
  assert.equal(store.advanceReads[0] + readyPageHydrationReads, 1_151);
});

test("100 malformed BiteSaver identities use exactly 502 ready-page hydration reads and preserve a later canonical", async () => {
  const accounts = Array.from({length: 101}, (_, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    return {
      source: "biteSaver",
      ...boundBiteSaverDocument(
        `reciprocal-canonical-${suffix}`,
        `reciprocal-account-${suffix}`,
      ),
    };
  });
  const competingAccounts = accounts.flatMap((account, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    return [
      account,
      boundBiteSaverDocument(
        `reciprocal-canonical-${suffix}`,
        `reciprocal-competitor-${suffix}`,
      ),
    ];
  });
  const canonicals = accounts.map((account, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    return {
      source: "biteScore",
      ...filterableBiteScoreDocument(`reciprocal-canonical-${suffix}`, {
        linkedBiteSaverUid: account.documentId,
      }),
    };
  });
  const independentCanonicalId = "reciprocal-independent-valid";
  const independentAccount = boundBiteSaverDocument(
    independentCanonicalId,
    "reciprocal-independent-account",
  );
  const independentCanonical = {
    source: "biteScore",
    ...filterableBiteScoreDocument(independentCanonicalId, {
      name: "ZZZ Independent valid canonical",
      linkedBiteSaverUid: independentAccount.documentId,
    }),
  };
  const reciprocal = {calls: 0, requests: 0, documentReads: 0};
  const preparation = {calls: 0, documentReads: 0, largestBatch: 0};
  let invitationCalls = 0;
  let invitationDocumentReads = 0;
  const store = new FakeStore([...accounts, independentCanonical]);
  for (const canonical of canonicals) {
    store.current.set(
      `biteScore:${canonical.documentId}`,
      canonical,
    );
  }
  const dependencyOverrides = {
    verifyBiteSaverCatalogBindings: strictBindingVerifier(
      [...competingAccounts, independentAccount],
      reciprocal,
    ),
    loadQrPreparationDocuments: async (ids) => {
      preparation.calls += 1;
      preparation.documentReads += ids.length;
      preparation.largestBatch = Math.max(
        preparation.largestBatch,
        ids.length,
      );
      return new Map();
    },
    loadQrPreparationInvitationDocuments: async (ids) => {
      invitationCalls += 1;
      invitationDocumentReads += ids.length;
      return new Map();
    },
  };
  const pageCriteria = qrFilterCriteria(true, {
    sources: ["biteScore", "biteSaver"],
    searchInstanceId: "instrumented-reciprocal-bound",
  });
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    filteredHandler(store, new Map(), dependencyOverrides),
  );

  const firstRequestIdentities = store.sourceDocumentIdentityBatches.flat();
  const primarySourceReads = firstRequestIdentities.filter((identity) =>
    identity.source === "biteSaver").length;
  const linkedCanonicalReads = firstRequestIdentities.filter((identity) =>
    identity.source === "biteScore" &&
      identity.documentId.startsWith("reciprocal-canonical-")).length;
  assert.deepEqual(response.items, []);
  assert.equal(response.hasNext, true);
  assert.equal(
    response.consumedBoundary.sourceDocumentId,
    "reciprocal-account-100",
  );
  assert.equal(response.filterMetadata.preparationUnavailableEncountered, true);
  assert.equal(store.queryResultsAttempts, 2);
  assert.equal(store.materializedIdentityReadAttempts, 102);
  assert.equal(store.getSourceDocumentsAttempts, 4);
  assert.equal(store.sourceDocumentReadAttempts, 200);
  assert.equal(store.sourceDocumentIdentityBatches.length, 4);
  assert.ok(store.sourceDocumentIdentityBatches.every((batch) =>
    batch.length === 50));
  assert.equal(primarySourceReads, 100);
  assert.equal(linkedCanonicalReads, 100);
  assert.equal(reciprocal.calls, 2);
  assert.equal(reciprocal.queryCalls, 10);
  assert.equal(reciprocal.requests, 100);
  assert.equal(reciprocal.documentReads, 200);
  assert.equal(reciprocal.largestRequestBatch, 50);
  assert.equal(reciprocal.largestQueryIdBatch, 10);
  assert.equal(reciprocal.largestDocumentBatch, 20);
  assert.equal(reciprocal.maximumDocumentsPerCanonical, 2);
  assert.equal(preparation.calls, 2);
  assert.equal(preparation.documentReads, 0);
  assert.equal(preparation.largestBatch, 0);
  assert.equal(invitationCalls, 0);
  assert.equal(invitationDocumentReads, 0);
  assert.equal(linkedCanonicalReads + reciprocal.documentReads, 300);
  assert.ok(linkedCanonicalReads <= 100);
  assert.ok(reciprocal.documentReads <= 200);
  assert.ok(linkedCanonicalReads + reciprocal.documentReads <= 300);
  assert.equal(
    store.materializedIdentityReadAttempts +
      primarySourceReads +
      linkedCanonicalReads +
      reciprocal.documentReads,
    502,
  );

  const later = await searchAdminLinkRestaurantsPageHandler(
    forwardRequest(pageCriteria, response, "reciprocal-independent-next"),
    filteredHandler(store, new Map(), dependencyOverrides),
  );
  assert.deepEqual(later.items.map((item) => [
    item.source,
    item.documentId,
    item.actionId,
  ]), [["biteScore", independentCanonicalId, independentCanonicalId]]);
  assert.equal(
    later.items.filter((item) => item.documentId === independentCanonicalId)
      .length,
    1,
  );
  assert.equal(later.filterMetadata.preparationUnavailableEncountered, true);
  assert.equal(later.hasNext, false);
  assert.equal(Object.hasOwn(later, "nextCursor"), false);
});

test("mixed 50/50 scan uses exactly 602 ready-page hydration reads and preserves a valid canonical", async () => {
  const future = new Date(Date.now() + 60 * 60 * 1_000);
  const scoreCandidates = [];
  const saverCandidates = [];
  const linkedCanonicals = [];
  const reciprocalDocuments = [];
  const preparationDocuments = new Map();
  const invitationDocuments = new Map();
  for (let index = 1; index <= 50; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const scoreId = `mixed-score-${suffix}`;
    const saverId = `mixed-account-${suffix}`;
    const linkedId = `mixed-linked-${suffix}`;
    const score = {
      source: "biteScore",
      ...filterableBiteScoreDocument(scoreId, {
        name: `Mixed ${suffix} B`,
      }),
    };
    const saver = {
      source: "biteSaver",
      ...boundBiteSaverDocument(linkedId, saverId, {
        restaurantName: `Mixed ${suffix} A`,
      }),
    };
    const linkedCanonical = {
      source: "biteScore",
      ...filterableBiteScoreDocument(linkedId, {
        linkedBiteSaverUid: saverId,
      }),
    };
    scoreCandidates.push(score);
    saverCandidates.push(saver);
    linkedCanonicals.push(linkedCanonical);
    reciprocalDocuments.push(
      boundBiteSaverDocument(scoreId, `mixed-score-account-a-${suffix}`),
      boundBiteSaverDocument(scoreId, `mixed-score-account-b-${suffix}`),
      saver,
      boundBiteSaverDocument(
        linkedId,
        `mixed-linked-competitor-${suffix}`,
      ),
    );
    preparationDocuments.set(scoreId, {
      schemaVersion: 1,
      saPrepared: true,
      srPrepared: true,
      iPreparedInviteId: `i-mixed-${suffix}`,
      iPreparedInviteExpiresAt: future,
      cPreparedInviteId: `c-mixed-${suffix}`,
      cPreparedInviteExpiresAt: future,
    });
    invitationDocuments.set(
      `i-mixed-${suffix}`,
      preparationInvitation(
        "I",
        `i-mixed-${suffix}`,
        scoreId,
        {expiresAt: future},
      ),
    );
    invitationDocuments.set(
      `c-mixed-${suffix}`,
      preparationInvitation(
        "C",
        `c-mixed-${suffix}`,
        scoreId,
        {expiresAt: future},
      ),
    );
  }
  const independentCanonicalId = "mixed-independent-valid";
  const independentAccount = boundBiteSaverDocument(
    independentCanonicalId,
    "mixed-independent-account",
  );
  const independentCanonical = {
    source: "biteScore",
    ...filterableBiteScoreDocument(independentCanonicalId, {
      name: "ZZZ Mixed independent canonical",
      linkedBiteSaverUid: independentAccount.documentId,
    }),
  };
  const reciprocal = {calls: 0, requests: 0, documentReads: 0};
  const preparation = {calls: 0, documentReads: 0, largestBatch: 0};
  const invitations = {
    calls: 0,
    iDocumentReads: 0,
    cDocumentReads: 0,
    largestBatch: 0,
  };
  const store = new FakeStore([
    ...saverCandidates,
    ...scoreCandidates,
    independentCanonical,
  ]);
  for (const canonical of linkedCanonicals) {
    store.current.set(`biteScore:${canonical.documentId}`, canonical);
  }
  const dependencyOverrides = {
    verifyBiteSaverCatalogBindings: strictBindingVerifier(
      [...reciprocalDocuments, independentAccount],
      reciprocal,
    ),
    loadQrPreparationDocuments: async (ids) => {
      preparation.calls += 1;
      preparation.documentReads += ids.length;
      preparation.largestBatch = Math.max(
        preparation.largestBatch,
        ids.length,
      );
      return new Map(ids.flatMap((id) => preparationDocuments.has(id)
        ? [[id, preparationDocuments.get(id)]]
        : []));
    },
    loadQrPreparationInvitationDocuments: async (ids) => {
      invitations.calls += 1;
      invitations.largestBatch = Math.max(
        invitations.largestBatch,
        ids.length,
      );
      invitations.iDocumentReads += ids.filter((id) => id.startsWith("i-"))
        .length;
      invitations.cDocumentReads += ids.filter((id) => id.startsWith("c-"))
        .length;
      return new Map(ids.map((id) => [id, invitationDocuments.get(id)]));
    },
  };
  const pageCriteria = qrFilterCriteria(true, {
    sources: ["biteScore", "biteSaver"],
    searchInstanceId: "instrumented-mixed-bound",
  });
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    filteredHandler(store, preparationDocuments, dependencyOverrides),
  );

  const firstRequestIdentities = store.sourceDocumentIdentityBatches.flat();
  const primaryBiteSaverReads = firstRequestIdentities.filter((identity) =>
    identity.documentId.startsWith("mixed-account-")).length;
  const primaryBiteScoreReads = firstRequestIdentities.filter((identity) =>
    identity.documentId.startsWith("mixed-score-")).length;
  const linkedCanonicalReads = firstRequestIdentities.filter((identity) =>
    identity.documentId.startsWith("mixed-linked-")).length;
  assert.deepEqual(response.items, []);
  assert.equal(response.hasNext, true);
  assert.equal(response.consumedBoundary.sourceDocumentId, "mixed-score-050");
  assert.equal(response.filterMetadata.preparationUnavailableEncountered, true);
  assert.equal(store.queryResultsAttempts, 2);
  assert.equal(store.materializedIdentityReadAttempts, 102);
  assert.equal(store.getSourceDocumentsAttempts, 4);
  assert.equal(store.sourceDocumentReadAttempts, 150);
  assert.deepEqual(
    store.sourceDocumentIdentityBatches.map((batch) => batch.length),
    [50, 25, 50, 25],
  );
  assert.equal(primaryBiteSaverReads, 50);
  assert.equal(primaryBiteScoreReads, 50);
  assert.equal(linkedCanonicalReads, 50);
  assert.equal(reciprocal.calls, 4);
  assert.equal(reciprocal.queryCalls, 12);
  assert.equal(reciprocal.requests, 100);
  assert.equal(reciprocal.documentReads, 200);
  assert.equal(reciprocal.largestRequestBatch, 25);
  assert.equal(reciprocal.largestQueryIdBatch, 10);
  assert.equal(reciprocal.largestDocumentBatch, 20);
  assert.equal(reciprocal.maximumDocumentsPerCanonical, 2);
  assert.equal(preparation.calls, 2);
  assert.equal(preparation.documentReads, 50);
  assert.equal(preparation.largestBatch, 25);
  assert.equal(invitations.calls, 2);
  assert.equal(invitations.iDocumentReads, 50);
  assert.equal(invitations.cDocumentReads, 50);
  assert.equal(invitations.largestBatch, 50);
  assert.ok(linkedCanonicalReads <= 100);
  assert.ok(reciprocal.documentReads <= 200);
  assert.ok(linkedCanonicalReads + reciprocal.documentReads <= 300);
  assert.equal(
    store.materializedIdentityReadAttempts +
      primaryBiteSaverReads +
      primaryBiteScoreReads +
      linkedCanonicalReads +
      reciprocal.documentReads +
      preparation.documentReads +
      invitations.iDocumentReads +
      invitations.cDocumentReads,
    602,
  );

  const later = await searchAdminLinkRestaurantsPageHandler(
    forwardRequest(pageCriteria, response, "mixed-independent-next"),
    filteredHandler(store, preparationDocuments, dependencyOverrides),
  );
  assert.deepEqual(later.items.map((item) => [
    item.source,
    item.documentId,
    item.actionId,
  ]), [["biteScore", independentCanonicalId, independentCanonicalId]]);
  assert.equal(
    later.items.filter((item) => item.documentId === independentCanonicalId)
      .length,
    1,
  );
  assert.equal(later.filterMetadata.preparationUnavailableEncountered, false);
  assert.equal(later.hasNext, false);
  assert.equal(Object.hasOwn(later, "nextCursor"), false);
});

test("filtered handler applies authoritative invitation lifecycle preparation states", async () => {
  const future = new Date(Date.now() + 60 * 60 * 1_000);
  const past = new Date(Date.now() - 60 * 60 * 1_000);
  const epoch = new Date(Date.now() - 30_000);
  const cases = [
    {
      label: "missing preparation",
      expectedStatus: ["i", "unprepared"],
    },
    {
      label: "expired prepared I",
      preparation: {
        schemaVersion: 1,
        iPreparedInviteId: "owner-expired",
        iPreparedInviteExpiresAt: past,
      },
      invitations: new Map([["owner-expired", preparationInvitation(
        "I",
        "owner-expired",
        "lifecycle-expired-prepared-I",
        {expiresAt: past},
      )]]),
      expectedStatus: ["i", "unprepared"],
    },
    {
      label: "revoked prepared I",
      preparation: {
        schemaVersion: 1,
        iPreparedInviteId: "owner-revoked",
        iPreparedInviteExpiresAt: future,
      },
      invitations: new Map([["owner-revoked", preparationInvitation(
        "I",
        "owner-revoked",
        "lifecycle-revoked-prepared-I",
        {status: "revoked", revokedAt: new Date()},
      )]]),
      expectedStatus: ["i", "unprepared"],
    },
    {
      label: "used prepared I",
      preparation: {
        schemaVersion: 1,
        iPreparedInviteId: "owner-used",
        iPreparedInviteExpiresAt: future,
      },
      invitations: new Map([["owner-used", preparationInvitation(
        "I",
        "owner-used",
        "lifecycle-used-prepared-I",
        {status: "used", useCount: 1, usedAt: new Date()},
      )]]),
      expectedStatus: ["i", "unprepared"],
    },
    {
      label: "pre-epoch prepared C",
      restaurantOverrides: {claimInvitationEpochAt: epoch},
      preparation: {
        schemaVersion: 1,
        cPreparedInviteId: "claim-old",
        cPreparedInviteExpiresAt: future,
      },
      invitations: new Map([["claim-old", preparationInvitation(
        "C",
        "claim-old",
        "lifecycle-pre-epoch-prepared-C",
        {createdAt: new Date(epoch.getTime() - 1)},
      )]]),
      expectedStatus: ["c", "unprepared"],
    },
    {
      label: "prepared I A remains valid after newer B",
      preparation: {
        schemaVersion: 1,
        iLatestInviteId: "owner-b",
        iLatestInviteExpiresAt: future,
        iPreparedInviteId: "owner-a",
        iPreparedInviteExpiresAt: future,
      },
      invitations: new Map([["owner-a", preparationInvitation(
        "I",
        "owner-a",
        "lifecycle-prepared-I-A-remains-valid-after-newer-B",
        {expiresAt: future},
      )]]),
      expectedStatus: ["i", "prepared"],
    },
    {
      label: "malformed preparation",
      preparation: {schemaVersion: 1, privateInviteToken: "must-fail-closed"},
      expectedWarning: true,
      expectedVisible: false,
    },
  ];

  for (const entry of cases) {
    const id = `lifecycle-${entry.label.replaceAll(" ", "-")}`;
    const candidate = {
      source: "biteScore",
      ...filterableUnboundBiteScoreDocument(id, {
        name: entry.label,
        ...entry.restaurantOverrides,
      }),
    };
    const preparations = entry.preparation === undefined
      ? new Map()
      : new Map([[id, entry.preparation]]);
    const invitations = entry.invitations ?? new Map();
    const store = new FakeStore([candidate]);
    const response = await searchAdminLinkRestaurantsPageHandler(
      request(qrFilterCriteria(true, {
        searchInstanceId: id,
      })),
      filteredHandler(store, preparations, {
        verifyBiteSaverCatalogBindings: strictBindingVerifier([]),
        loadQrPreparationInvitationDocuments: async (ids) => new Map(
          ids.flatMap((invitationId) => invitations.has(invitationId)
            ? [[invitationId, invitations.get(invitationId)]]
            : []),
        ),
      }),
    );

    const expectedVisible = entry.expectedVisible ?? true;
    assert.equal(response.items.length, expectedVisible ? 1 : 0, entry.label);
    assert.equal(
      response.filterMetadata.preparationUnavailableEncountered,
      entry.expectedWarning ?? false,
      entry.label,
    );
    if (entry.expectedStatus !== undefined) {
      assert.equal(
        response.items[0].preparation[entry.expectedStatus[0]],
        entry.expectedStatus[1],
        entry.label,
      );
    }
    assert.equal(response.hasNext, false, entry.label);
  }

  const completeId = "lifecycle-all-prepared-not-required";
  const completeAccount = {
    source: "biteSaver",
    ...boundBiteSaverDocument(completeId, `account-${completeId}`),
  };
  const completeCandidate = {
    source: "biteScore",
    ...filterableBiteScoreDocument(completeId, {
      linkedBiteSaverUid: completeAccount.documentId,
    }),
  };
  const completeStore = new FakeStore([completeCandidate]);
  const complete = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(true, {
      searchInstanceId: completeId,
    })),
    filteredHandler(
      completeStore,
      new Map([[completeId, completePreparation()]]),
      {
        verifyBiteSaverCatalogBindings: strictBindingVerifier([
          completeAccount,
        ]),
      },
    ),
  );
  assert.deepEqual(complete.items, []);
  assert.equal(complete.filterMetadata.preparationUnavailableEncountered, false);
  assert.equal(complete.hasNext, false);
});

test("QR filter eventually reaches the only unfinished identity at 301", async () => {
  const candidates = Array.from({length: 301}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `orlando-${String(index + 1).padStart(3, "0")}`,
    ),
  }));
  const preparations = new Map(candidates.slice(0, 300).map((candidate) => [
    candidate.documentId,
    completePreparation(),
  ]));
  const store = new FakeStore(candidates);
  const pageCriteria = qrFilterCriteria(true);
  let response = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    filteredHandler(store, preparations),
  );
  let continuation = 0;
  while (response.hasNext) {
    continuation += 1;
    response = await searchAdminLinkRestaurantsPageHandler(
      forwardRequest(pageCriteria, response, `orlando-${continuation}`),
      filteredHandler(store, preparations),
    );
  }
  assert.equal(continuation, 3);
  assert.deepEqual(response.items.map((item) => item.documentId), [
    "orlando-301",
  ]);
  assert.equal(store.queryResultsAttempts, 7);
});

test("all-complete filtered results terminate with truthful advancing boundaries", async () => {
  const candidates = Array.from({length: 175}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `complete-${String(index + 1).padStart(3, "0")}`,
    ),
  }));
  const preparations = new Map(candidates.map((candidate) => [
    candidate.documentId,
    completePreparation(),
  ]));
  const store = new FakeStore(candidates);
  const pageCriteria = qrFilterCriteria(true, {
    searchInstanceId: "all-complete",
  });
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    filteredHandler(store, preparations),
  );
  assert.deepEqual(first.items, []);
  assert.equal(first.hasNext, true);
  assert.equal(first.consumedBoundary.sourceDocumentId, "complete-100");
  assert.equal(typeof first.nextCursor, "string");

  const terminal = await searchAdminLinkRestaurantsPageHandler(
    forwardRequest(pageCriteria, first, "all-complete-final"),
    filteredHandler(store, preparations),
  );
  assert.deepEqual(terminal.items, []);
  assert.equal(terminal.consumedBoundary.sourceDocumentId, "complete-175");
  assert.equal(terminal.hasNext, false);
  assert.equal(terminal.capabilities.next, false);
  assert.equal(Object.hasOwn(terminal, "nextCursor"), false);
  assert.deepEqual(terminal.total, {state: "unknown"});
  assert.deepEqual(terminal.filterMetadata, {
    schemaVersion: 1,
    needsQrPreparation: true,
    preparationUnavailableEncountered: false,
  });
  assert.equal(store.queryResultsAttempts, 4);
});

test("the 50th filtered match sets the exact consumed boundary", async () => {
  const candidates = Array.from({length: 60}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `partial-${String(index + 1).padStart(3, "0")}`,
    ),
  }));
  const preparations = new Map([
    ["partial-050", completePreparation()],
    ["partial-052", {schemaVersion: 1, saPrepared: "bad"}],
  ]);
  const store = new FakeStore(candidates);
  const pageCriteria = qrFilterCriteria(true);
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    filteredHandler(store, preparations),
  );
  assert.equal(first.items.length, 50);
  assert.equal(first.items.at(-1).documentId, "partial-051");
  assert.equal(first.consumedBoundary.sourceDocumentId, "partial-051");
  assert.equal(first.hasNext, true);
  assert.equal(
    first.filterMetadata.preparationUnavailableEncountered,
    false,
  );

  const second = await searchAdminLinkRestaurantsPageHandler(
    forwardRequest(pageCriteria, first, "partial-next"),
    filteredHandler(store, preparations),
  );
  assert.equal(second.items[0].documentId, "partial-053");
  assert.equal(
    second.filterMetadata.preparationUnavailableEncountered,
    true,
  );
});

test("filtered canonical identity suppresses bound duplicates and warns on standalone BiteSaver", async () => {
  const canonicalId = "canonical-filtered";
  const canonical = {
    source: "biteScore",
    ...filterableBiteScoreDocument(canonicalId),
  };
  const boundAccount = {
    source: "biteSaver",
    ...biteSaverDocument("account-bound", {
      restaurantName: "ZZ Bound duplicate",
      uid: "account-bound",
      linkedBiteScoreRestaurantId: canonicalId,
      biteScoreCatalogRestaurantId: canonicalId,
      biteSaverCatalogBindingId: bindingId,
    }),
  };
  const standalone = {
    source: "biteSaver",
    ...biteSaverDocument("account-standalone", {
      restaurantName: "ZZZ Standalone",
      uid: "account-standalone",
      linkedBiteScoreRestaurantId: null,
    }),
  };
  const store = new FakeStore([canonical, boundAccount, standalone]);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(true, {
      sources: ["biteScore", "biteSaver"],
    })),
    filteredHandler(store),
  );
  assert.deepEqual(response.items.map((item) => item.documentId), [canonicalId]);
  assert.equal(response.items[0].source, "biteScore");
  assert.equal(response.filterMetadata.preparationUnavailableEncountered, true);
  assert.equal(store.getSourceDocumentsAttempts, 2);
});

test("strict reciprocal verification suppresses one earlier bound account without warning", async () => {
  const canonicalId = "strict-valid-canonical";
  const accountId = "strict-valid-account";
  const canonical = {
    source: "biteScore",
    ...filterableBiteScoreDocument(canonicalId, {
      name: "Zulu canonical",
      linkedBiteSaverUid: accountId,
    }),
  };
  const account = {
    source: "biteSaver",
    ...boundBiteSaverDocument(canonicalId, accountId, {
      restaurantName: "Alpha bound account",
    }),
  };
  const counters = {calls: 0, requests: 0, documentReads: 0};
  const store = new FakeStore([account, canonical]);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(true, {
      sources: ["biteScore", "biteSaver"],
      searchInstanceId: "strict-valid-binding",
    })),
    filteredHandler(store, new Map(), {
      verifyBiteSaverCatalogBindings: strictBindingVerifier(
        [account],
        counters,
      ),
    }),
  );

  assert.deepEqual(response.items.map((item) => item.documentId), [
    canonicalId,
  ]);
  assert.equal(response.items[0].source, "biteScore");
  assert.equal(response.filterMetadata.preparationUnavailableEncountered, false);
  assert.ok(counters.calls >= 1);
  assert.ok(counters.documentReads >= 1);
});

test("an earlier malformed BiteSaver row cannot suppress a valid canonical result", async () => {
  const canonicalId = "malformed-before-valid-canonical";
  const validAccountId = "authoritative-reciprocal-account";
  const canonical = {
    source: "biteScore",
    ...filterableBiteScoreDocument(canonicalId, {
      name: "Zulu canonical result",
      linkedBiteSaverUid: validAccountId,
    }),
  };
  const validAccount = boundBiteSaverDocument(
    canonicalId,
    validAccountId,
  );
  const staleAccount = {
    source: "biteSaver",
    ...biteSaverDocument("stale-legacy-account", {
      restaurantName: "Alpha stale legacy account",
      uid: "stale-legacy-account",
      linkedBiteScoreRestaurantId: canonicalId,
    }),
  };
  const store = new FakeStore([staleAccount, canonical]);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(true, {
      sources: ["biteScore", "biteSaver"],
      searchInstanceId: "malformed-before-valid-canonical",
    })),
    filteredHandler(store, new Map(), {
      verifyBiteSaverCatalogBindings: strictBindingVerifier([
        staleAccount,
        validAccount,
      ]),
    }),
  );

  assert.deepEqual(response.items.map((item) => [
    item.source,
    item.documentId,
    item.actionId,
  ]), [["biteScore", canonicalId, canonicalId]]);
  assert.equal(
    response.items.filter((item) => item.documentId === canonicalId).length,
    1,
  );
  assert.equal(response.filterMetadata.preparationUnavailableEncountered, true);
  assert.equal(response.consumedBoundary.sourceDocumentId, canonicalId);
  assert.equal(response.hasNext, false);
});

test("duplicate and malformed reciprocal accounts warn without deduplicating the canonical identity", async () => {
  for (const [label, accounts] of [
    ["duplicate", [
      boundBiteSaverDocument("strict-bad-canonical", "duplicate-a", {
        restaurantName: "Alpha duplicate A",
      }),
      boundBiteSaverDocument("strict-bad-canonical", "duplicate-b", {
        restaurantName: "Bravo duplicate B",
      }),
    ]],
    ["mismatched binding", [
      boundBiteSaverDocument("strict-bad-canonical", "mismatch", {
        restaurantName: "Alpha mismatched account",
        biteSaverCatalogBindingId: "C".repeat(43),
      }),
    ]],
  ]) {
    const canonicalId = "strict-bad-canonical";
    const canonical = {
      source: "biteScore",
      ...filterableBiteScoreDocument(canonicalId, {
        name: "Zulu canonical remains independently evaluated",
        linkedBiteSaverUid: accounts[0].data.uid,
      }),
    };
    const sourcedAccounts = accounts.map((account) => ({
      source: "biteSaver",
      ...account,
    }));
    const preparationLoads = [];
    const store = new FakeStore([...sourcedAccounts, canonical]);
    const response = await searchAdminLinkRestaurantsPageHandler(
      request(qrFilterCriteria(true, {
        sources: ["biteScore", "biteSaver"],
        searchInstanceId: `strict-${label.replaceAll(" ", "-")}`,
      })),
      filteredHandler(store, new Map(), {
        verifyBiteSaverCatalogBindings: strictBindingVerifier(sourcedAccounts),
        loadQrPreparationDocuments: async (ids) => {
          preparationLoads.push([...ids]);
          return new Map();
        },
      }),
    );

    assert.deepEqual(response.items, [], label);
    assert.equal(
      response.filterMetadata.preparationUnavailableEncountered,
      true,
      label,
    );
    assert.ok(
      preparationLoads.some((ids) => ids.includes(canonicalId)),
      `${label}: canonical was not independently evaluated`,
    );
    assert.equal(response.consumedBoundary.sourceDocumentId, canonicalId, label);
  }
});

test("an earlier-page bound account cannot prevent later canonical output", async () => {
  const canonicalId = "paged-canonical";
  const accountId = "paged-account";
  const account = {
    source: "biteSaver",
    ...boundBiteSaverDocument(canonicalId, accountId, {
      restaurantName: "000 Bound account",
    }),
  };
  const fillers = Array.from({length: 99}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `paged-filler-${String(index + 1).padStart(3, "0")}`,
      {name: `100 Filler ${String(index + 1).padStart(3, "0")}`},
    ),
  }));
  const fillerAccounts = fillers.map((candidate) => ({
    biteScoreCatalogRestaurantId: candidate.documentId,
    biteSaverCatalogBindingId: bindingId,
  }));
  const canonical = {
    source: "biteScore",
    ...filterableBiteScoreDocument(canonicalId, {
      name: "999 Canonical",
      linkedBiteSaverUid: accountId,
    }),
  };
  const preparations = new Map(fillers.map((candidate) => [
    candidate.documentId,
    completePreparation(),
  ]));
  const store = new FakeStore([account, ...fillers, canonical]);
  const pageCriteria = qrFilterCriteria(true, {
    sources: ["biteScore", "biteSaver"],
    searchInstanceId: "bound-account-before-page",
  });
  const overrides = {
    verifyBiteSaverCatalogBindings: strictBindingVerifier([
      account,
      ...fillerAccounts,
    ]),
  };
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    filteredHandler(store, preparations, overrides),
  );
  assert.deepEqual(first.items, []);
  assert.equal(first.hasNext, true);
  assert.equal(first.consumedBoundary.sourceDocumentId, "paged-filler-099");
  assert.equal(first.filterMetadata.preparationUnavailableEncountered, false);

  const second = await searchAdminLinkRestaurantsPageHandler(
    forwardRequest(pageCriteria, first, "bound-account-later-canonical"),
    filteredHandler(store, preparations, overrides),
  );
  assert.deepEqual(second.items.map((item) => item.documentId), [canonicalId]);
  assert.equal(second.hasNext, false);
  assert.equal(second.filterMetadata.preparationUnavailableEncountered, false);
  assert.equal(
    [...first.items, ...second.items]
      .filter((item) => item.documentId === canonicalId).length,
    1,
  );
});

test("unfiltered paging keeps reciprocal BiteScore and BiteSaver rows separate", async () => {
  const canonicalId = "unfiltered-canonical";
  const accountId = "unfiltered-account";
  const canonical = {
    source: "biteScore",
    ...filterableBiteScoreDocument(canonicalId, {
      linkedBiteSaverUid: accountId,
    }),
  };
  const account = {
    source: "biteSaver",
    ...boundBiteSaverDocument(canonicalId, accountId),
  };
  const store = new FakeStore([canonical, account]);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(qrFilterCriteria(false, {
      sources: ["biteScore", "biteSaver"],
      searchInstanceId: "unfiltered-reciprocal-pair",
    })),
    handler(store, {
      verifyBiteSaverCatalogBindings: strictBindingVerifier([account]),
    }),
  );

  assert.deepEqual(
    response.items
      .map((item) => `${item.source}:${item.documentId}`)
      .sort(),
    [
      `biteSaver:${accountId}`,
      `biteScore:${canonicalId}`,
    ],
  );
  assert.equal(response.filterMetadata.preparationUnavailableEncountered, false);
});

test("expanded normalized filters fail before geocoding or private writes", async () => {
  for (const [label, restaurantName, messagePattern] of [
    ["normalized 101 ASCII units", "A".repeat(101), /100 characters/u],
    ["51 compatibility ligatures", "\uFB00".repeat(51), /100 characters/u],
    [
      "former 100-ligature reproduction",
      "\uFB00".repeat(100),
      /100 characters/u,
    ],
    ["51 lowercase-expanding letters", "\u0130".repeat(51), /100 characters/u],
    ["fixed-point whitespace introduction", "\u00A8", /unsupported text/u],
  ]) {
    const store = new FakeStore([{
      source: "biteScore",
      ...biteScoreDocument("must-not-scan"),
    }]);
    let geocodingKeyReads = 0;
    let geocodingFetches = 0;
    let sessionIdReads = 0;
    let leaseTokenReads = 0;
    await assert.rejects(
      searchAdminLinkRestaurantsPageHandler(
        request(criteria({
          center: {mode: "typed", locationQuery: "Orlando, FL"},
          restaurantName,
        })),
        handler(store, {
          getGeocodingApiKey: () => {
            geocodingKeyReads += 1;
            return "must-not-read";
          },
          fetchGeocoding: async () => {
            geocodingFetches += 1;
            throw new Error("must not geocode");
          },
          sessionIdSource: () => {
            sessionIdReads += 1;
            return "must-not-create";
          },
          leaseTokenSource: () => {
            leaseTokenReads += 1;
            return "must-not-claim";
          },
        }),
      ),
      (error) => {
        assert.equal(error?.code, "invalid-argument", label);
        assert.match(error.message, messagePattern, label);
        return true;
      },
    );
    assert.equal(geocodingKeyReads, 0, label);
    assert.equal(geocodingFetches, 0, label);
    assert.equal(sessionIdReads, 0, label);
    assert.equal(leaseTokenReads, 0, label);
    assert.equal(store.acquireInitialSessionAttempts, 0, label);
    assert.equal(store.parentSessionCreateAttempts, 0, label);
    assert.equal(store.createdSessionCount, 0, label);
    assert.equal(store.getSessionAttempts, 0, label);
    assert.equal(store.claimSessionAttempts, 0, label);
    assert.equal(store.touchReadySessionAttempts, 0, label);
    assert.equal(store.finishAdvanceAttempts, 0, label);
    assert.equal(store.sessionAdvanceAttempts, 0, label);
    assert.equal(store.failAdvanceAttempts, 0, label);
    assert.equal(store.getSourceDocumentsAttempts, 0, label);
    assert.equal(store.sourceDocumentReadAttempts, 0, label);
    assert.equal(store.queryCandidatesAttempts, 0, label);
    assert.equal(store.queryResultsAttempts, 0, label);
    assert.equal(store.sessionWriteAttempts, 0, label);
    assert.equal(store.resultContainerCreateAttempts, 0, label);
    assert.equal(store.materializedResultWriteAttempts, 0, label);
    assert.equal(store.completedRequestMarkerWriteAttempts, 0, label);
    assert.equal(store.activePointerWriteAttempts, 0, label);
    assert.equal(store.activeKeyBindingWriteAttempts, 0, label);
    assert.equal(store.sessions.size, 0, label);
    assert.equal(store.activeSessions.size, 0, label);
    assert.equal(store.results.size, 0, label);
    assert.equal(store.queryLimits.length, 0, label);
    assert.equal(store.advanceReads.length, 0, label);
  }
});

test("100-unit expanded filter persists and continues with one contract", async () => {
  const candidates = Array.from({length: 451}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument(
      `restaurant-${index.toString().padStart(3, "0")}`,
      {name: "F".repeat(100)},
    ),
  }));
  const store = new FakeStore(candidates);
  const compatibilityFilter = "\uFB00".repeat(50);
  const pageCriteria = criteria({restaurantName: compatibilityFilter});
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria, {clientRequestId: "normalized-first"}),
    handler(store),
  );
  assert.equal(first.preparation.state, "preparing");
  assert.deepEqual(store.advanceReads, [450]);
  assert.equal(store.createdSessionCount, 1);
  assert.equal(store.sessions.size, 1);
  assert.equal(store.activeSessions.size, 1);
  assert.equal(
    store.sessions.get("admin-link-session").normalizedRestaurantName,
    "ff".repeat(50),
  );

  const ready = await searchAdminLinkRestaurantsPageHandler(
    request(continuationCriteria(pageCriteria, first), {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "normalized-finish",
    }),
    handler(store),
  );
  assert.equal(ready.preparation.state, "ready");
  assert.equal(ready.items.length, 50);
  assert.equal(ready.hasNext, true);
  assert.deepEqual(store.advanceReads, [450, 1]);
  assert.equal(
    ready.items.every((item) =>
      item.materializedOrder.normalizedName === "f".repeat(100)),
    true,
  );

  const equivalentFirst = await searchAdminLinkRestaurantsPageHandler(
    request(criteria({restaurantName: "F".repeat(100)}), {
      clientRequestId: "normalized-equivalent-first",
    }),
    handler(store, {
      sessionIdSource: () => "must-not-persist-equivalent-session",
    }),
  );
  assert.equal(equivalentFirst.queryFingerprint, ready.queryFingerprint);
  assert.equal(store.sessions.size, 1);
  assert.equal(
    store.sessions.has("must-not-persist-equivalent-session"),
    false,
  );
  assert.deepEqual(store.advanceReads, [450, 1]);

  const equivalentNormalizedCriteria = continuationCriteria(
    criteria({restaurantName: "F".repeat(100)}),
    ready,
  );
  const continued = await searchAdminLinkRestaurantsPageHandler(
    request(equivalentNormalizedCriteria, {
      direction: "forward",
      cursor: ready.nextCursor,
      clientRequestId: "normalized-page-two",
    }),
    handler(store),
  );
  assert.equal(continued.items.length, 50);
  assert.equal(continued.queryFingerprint, ready.queryFingerprint);
  assert.deepEqual(store.advanceReads, [450, 1]);
  assert.equal(store.createdSessionCount, 1);
});

test("concurrent identical first requests acquire one session and advance once", async () => {
  const candidates = Array.from({length: 60}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument(`restaurant-${index.toString().padStart(3, "0")}`),
  }));
  const store = new FakeStore(candidates);
  let sessionSequence = 0;
  let leaseSequence = 0;
  const context = () => handler(store, {
    sessionIdSource: () => `session-${++sessionSequence}`,
    leaseTokenSource: () => `lease-${++leaseSequence}`,
  });
  const firstRequest = request(criteria(), {clientRequestId: "same-request"});
  const [first, second] = await Promise.all([
    searchAdminLinkRestaurantsPageHandler(firstRequest, context()),
    searchAdminLinkRestaurantsPageHandler(firstRequest, context()),
  ]);
  assert.equal(store.createdSessionCount, 1);
  assert.equal(store.advanceReads.length, 1);
  assert.equal(store.sessions.size, 1);
  assert.equal(first.queryFingerprint, second.queryFingerprint);
  const ready = [first, second].find((value) =>
    value.preparation.state === "ready");
  const preparing = [first, second].find((value) =>
    value.preparation.state === "preparing");
  assert.ok(ready);
  if (preparing) {
    assert.equal(typeof preparing.nextCursor, "string");
    const recovered = await searchAdminLinkRestaurantsPageHandler(
      request(continuationCriteria(criteria(), preparing), {
        direction: "forward",
        cursor: preparing.nextCursor,
        clientRequestId: "same-request",
      }),
      context(),
    );
    assert.deepEqual(recovered.items, ready.items);
  } else {
    assert.deepEqual(first.items, second.items);
  }
});

test("delayed retry of an older completed advance never scans again", async () => {
  const candidates = Array.from({length: 1_000}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument(`restaurant-${index.toString().padStart(4, "0")}`),
  }));
  const store = new FakeStore(candidates);
  const pageCriteria = criteria();
  const requestA = request(pageCriteria, {clientRequestId: "advance-a"});
  const responseA = await searchAdminLinkRestaurantsPageHandler(
    requestA,
    handler(store),
  );
  assert.equal(responseA.preparation.state, "preparing");
  const requestB = request(continuationCriteria(pageCriteria, responseA), {
    direction: "forward",
    cursor: responseA.nextCursor,
    clientRequestId: "advance-b",
  });
  const responseB = await searchAdminLinkRestaurantsPageHandler(
    requestB,
    handler(store),
  );
  assert.equal(responseB.preparation.state, "preparing");
  assert.deepEqual(store.advanceReads, [450, 450]);

  const delayedRetryA = await searchAdminLinkRestaurantsPageHandler(
    requestA,
    handler(store),
  );
  assert.equal(delayedRetryA.preparation.state, "preparing");
  assert.deepEqual(store.advanceReads, [450, 450]);
  assert.equal(store.createdSessionCount, 1);
  const storedDocuments = store.results.get("admin-link-session");
  assert.equal(
    storedDocuments.has(completedAdvanceRequestMarkerId("advance-a")),
    true,
  );
  assert.equal(
    storedDocuments.has(completedAdvanceRequestMarkerId("advance-b")),
    true,
  );
  assert.equal(storedDocuments.size, 902);
  assert.equal(
    hasMaterializedOrderFields(
      storedDocuments.get(completedAdvanceRequestMarkerId("advance-a")),
    ),
    false,
  );
  const orderedResults = await store.queryResults({
    sessionId: "admin-link-session",
    limit: 1_000,
  });
  assert.equal(orderedResults.length, 900);
  assert.equal(orderedResults.every((document) =>
    document.data.markerType === undefined), true);
});

test("filtered handler retry reuses completed advance marker before any hydration", async () => {
  const candidates = Array.from({length: 1_000}, (_, index) => ({
    source: "biteScore",
    ...filterableBiteScoreDocument(
      `filtered-retry-${String(index + 1).padStart(4, "0")}`,
    ),
  }));
  const store = new FakeStore(candidates);
  const dependencyCalls = {
    reciprocal: 0,
    preparation: 0,
    invitation: 0,
  };
  const context = () => filteredHandler(store, new Map(), {
    verifyBiteSaverCatalogBindings: async () => {
      dependencyCalls.reciprocal += 1;
      return new Set();
    },
    loadQrPreparationDocuments: async () => {
      dependencyCalls.preparation += 1;
      return new Map();
    },
    loadQrPreparationInvitationDocuments: async () => {
      dependencyCalls.invitation += 1;
      return new Map();
    },
  });
  const filteredRequest = request(qrFilterCriteria(true, {
    searchInstanceId: "filtered-handler-idempotency",
  }), {
    clientRequestId: "filtered-advance-idempotent",
  });
  const first = await searchAdminLinkRestaurantsPageHandler(
    filteredRequest,
    context(),
  );
  assert.equal(first.preparation.state, "preparing");
  assert.deepEqual(store.advanceReads, [450]);
  assert.equal(store.finishAdvanceAttempts, 1);
  assert.equal(store.queryResultsAttempts, 0);
  assert.equal(store.getSourceDocumentsAttempts, 0);
  assert.deepEqual(dependencyCalls, {
    reciprocal: 0,
    preparation: 0,
    invitation: 0,
  });
  const markerId = completedAdvanceRequestMarkerId(
    "filtered-advance-idempotent",
  );
  const storedDocuments = store.results.get("admin-link-session");
  assert.equal(storedDocuments.has(markerId), true);
  const resultCountBeforeRetry = storedDocuments.size;
  const candidateQueriesBeforeRetry = store.queryCandidatesAttempts;
  const materializedWritesBeforeRetry = store.materializedResultWriteAttempts;
  const sessionBeforeRetry = structuredClone(
    store.sessions.get("admin-link-session"),
  );

  const retry = await searchAdminLinkRestaurantsPageHandler(
    filteredRequest,
    context(),
  );

  assert.deepEqual(retry, first);
  assert.deepEqual(store.advanceReads, [450]);
  assert.equal(store.finishAdvanceAttempts, 1);
  assert.equal(store.queryCandidatesAttempts, candidateQueriesBeforeRetry);
  assert.equal(
    store.materializedResultWriteAttempts,
    materializedWritesBeforeRetry,
  );
  assert.equal(store.results.get("admin-link-session").size, resultCountBeforeRetry);
  assert.deepEqual(store.sessions.get("admin-link-session"), sessionBeforeRetry);
  assert.equal(store.queryResultsAttempts, 0);
  assert.equal(store.getSourceDocumentsAttempts, 0);
  assert.deepEqual(dependencyCalls, {
    reciprocal: 0,
    preparation: 0,
    invitation: 0,
  });
});

test("dense multi-range search reaches every result through three bounded advances", async () => {
  const rangePlans = buildAdminRestaurantQueryPlans(
    center,
    10,
    ["biteScore"],
    "active",
  );
  assert.ok(rangePlans.length >= 2);
  assert.ok(rangePlans[0].geohashEnd < rangePlans[1].geohashStart ||
    rangePlans[1].geohashEnd < rangePlans[0].geohashStart);
  const candidates = Array.from({length: 920}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument(
      "restaurant-" + index.toString().padStart(4, "0"),
      {
        geohash: index < 460
          ? rangePlans[0].geohashStart
          : rangePlans[1].geohashStart,
      },
    ),
  }));
  const store = new FakeStore(candidates);
  const pageCriteria = criteria();
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    handler(store),
  );
  assert.equal(first.preparation.state, "preparing");
  assert.equal(first.items.length, 0);
  assert.equal(first.consumedBoundary, undefined);
  assert.deepEqual(first.total, {state: "unknown"});
  assert.equal(store.advanceReads[0], 450);
  assert.equal(store.queryLimits.every((limit) => limit <= 25), true);
  const storedSession = store.sessions.get("admin-link-session");
  assert.equal(JSON.stringify(storedSession).includes("admin-1"), false);
  assert.equal(JSON.stringify(storedSession).includes("search-1"), false);
  assert.match(storedSession.callerBinding, /^[a-f0-9]{64}$/u);
  assert.match(storedSession.searchInstanceHash, /^[a-f0-9]{64}$/u);
  for (const value of materializedResultValues(
    store.results.get("admin-link-session"),
  )) {
    assert.deepEqual(Object.keys(value).sort(), [
      "distanceMillimeters",
      "expiresAtMs",
      "id",
      "normalizedName",
      "source",
      "sourceDocumentId",
    ]);
  }

  let prepared = first;
  let preparationAdvanceCount = 1;
  let finalPreparationRequest;
  while (prepared.preparation.state === "preparing") {
    finalPreparationRequest = request(
      continuationCriteria(pageCriteria, prepared),
      {
        direction: "forward",
        cursor: prepared.nextCursor,
        clientRequestId: `prepare-${preparationAdvanceCount + 1}`,
      },
    );
    prepared = await searchAdminLinkRestaurantsPageHandler(
      finalPreparationRequest,
      handler(store),
    );
    preparationAdvanceCount += 1;
  }
  assert.equal(preparationAdvanceCount, 3);
  assert.deepEqual(store.advanceReads, [450, 450, 20]);
  assert.equal(prepared.preparation.state, "ready");
  assert.equal(prepared.items.length, 50);
  assert.equal(prepared.hasNext, true);
  assert.deepEqual(
    prepared.consumedBoundary,
    prepared.items[49].materializedOrder,
  );
  assert.deepEqual(
    Object.keys(prepared.items[0].materializedOrder).sort(),
    ["distanceMillimeters", "normalizedName", "source", "sourceDocumentId"],
  );
  assert.deepEqual(
    Object.keys(prepared.consumedBoundary).sort(),
    ["distanceMillimeters", "normalizedName", "source", "sourceDocumentId"],
  );
  assert.equal(prepared.items.every((item) =>
    item.materializedOrder.source === item.source &&
    item.materializedOrder.sourceDocumentId === item.documentId), true);
  assert.equal(store.advanceReads.every((reads) => reads <= 450), true);

  const retry = await searchAdminLinkRestaurantsPageHandler(
    finalPreparationRequest,
    handler(store),
  );
  assert.deepEqual(
    retry.items.map((item) => item.documentId),
    prepared.items.map((item) => item.documentId),
  );

  const allItems = [...prepared.items];
  let page = prepared;
  let pageCount = 1;
  while (page.hasNext) {
    assert.equal(typeof page.nextCursor, "string");
    page = await searchAdminLinkRestaurantsPageHandler(
      request(continuationCriteria(pageCriteria, first), {
        direction: "forward",
        cursor: page.nextCursor,
        clientRequestId: `page-${pageCount + 1}`,
      }),
      handler(store),
    );
    allItems.push(...page.items);
    pageCount += 1;
  }
  assert.equal(pageCount, 19);
  assert.equal(page.items.length, 20);
  assert.equal(page.nextCursor, undefined);
  assert.equal(page.consumedBoundary.sourceDocumentId, "restaurant-0919");
  const actualIdentities = allItems.map((item) =>
    `${item.source}:${item.documentId}`);
  const expectedIdentities = candidates.map((candidate) =>
    `${candidate.source}:${candidate.documentId}`);
  assert.deepEqual(new Set(actualIdentities), new Set(expectedIdentities));
  assert.equal(actualIdentities.length, expectedIdentities.length);
  for (let index = 1; index < allItems.length; index += 1) {
    const previous = allItems[index - 1].materializedOrder;
    const current = allItems[index].materializedOrder;
    const previousTuple = [
      previous.distanceMillimeters,
      previous.normalizedName,
      previous.sourceDocumentId,
      previous.source,
    ];
    const currentTuple = [
      current.distanceMillimeters,
      current.normalizedName,
      current.sourceDocumentId,
      current.source,
    ];
    let tupleComparison = 0;
    for (let field = 0; field < previousTuple.length; field += 1) {
      tupleComparison = compare(previousTuple[field], currentTuple[field]);
      if (tupleComparison !== 0) break;
    }
    assert.ok(tupleComparison < 0);
  }
});

test("four-field order spans sources and same business rows remain separate", async () => {
  const store = new FakeStore([
    {source: "biteScore", ...biteScoreDocument("same", {name: "Same"})},
    {source: "biteSaver", ...biteSaverDocument("same", {restaurantName: "Same"})},
  ]);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(criteria({sources: ["biteScore", "biteSaver"]})),
    handler(store),
  );
  assert.equal(response.preparation.state, "ready");
  assert.deepEqual(response.items.map((item) => item.source), [
    "biteSaver",
    "biteScore",
  ]);
  assert.equal(new Set(response.items.map((item) =>
    item.source + ":" + item.documentId)).size, 2);
  assert.equal(response.items.find((item) => item.source === "biteSaver")
    .approvalStatus, "pending");
});

test("cross-page ties preserve document and source tie-breakers", async () => {
  const candidates = [
    {source: "biteScore", ...biteScoreDocument("lead", {name: "A"})},
  ];
  for (let index = 0; index < 30; index += 1) {
    const id = `same-${index.toString().padStart(3, "0")}`;
    candidates.push(
      {source: "biteScore", ...biteScoreDocument(id, {name: "Same"})},
      {source: "biteSaver", ...biteSaverDocument(id, {restaurantName: "Same"})},
    );
  }
  const store = new FakeStore(candidates);
  const pageCriteria = criteria({sources: ["biteScore", "biteSaver"]});
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    handler(store),
  );
  assert.equal(first.items.length, 50);
  assert.equal(first.items[49].documentId, "same-024");
  assert.equal(first.items[49].source, "biteSaver");
  assert.deepEqual(first.consumedBoundary, first.items[49].materializedOrder);
  const second = await searchAdminLinkRestaurantsPageHandler(
    request(continuationCriteria(pageCriteria, first), {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "tie-page-2",
    }),
    handler(store),
  );
  assert.equal(second.items[0].documentId, "same-024");
  assert.equal(second.items[0].source, "biteScore");
  const identities = [...first.items, ...second.items].map((item) =>
    `${item.documentId}:${item.source}`);
  assert.equal(new Set(identities).size, 61);
  assert.equal(second.hasNext, false);
});

test("cursor tampering, caller changes, and criteria changes fail closed", async () => {
  const candidates = Array.from({length: 51}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument("restaurant-" + index.toString().padStart(3, "0")),
  }));
  const store = new FakeStore(candidates);
  const pageCriteria = criteria();
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    handler(store),
  );
  assert.equal(first.preparation.state, "ready");
  const continued = (criteriaValue, cursor = first.nextCursor) =>
    request(continuationCriteria(criteriaValue, first), {
      direction: "forward",
      cursor,
      clientRequestId: "request-next",
    });
  await assert.rejects(
    searchAdminLinkRestaurantsPageHandler(
      continued(pageCriteria, first.nextCursor.slice(0, -1) + "x"),
      handler(store),
    ),
    /expired|invalid/i,
  );
  await assert.rejects(
    searchAdminLinkRestaurantsPageHandler(
      continued(pageCriteria),
      handler(store, {adminUid: "another-admin"}),
    ),
    /expired|invalid/i,
  );
  for (const changed of [
    criteria({radiusMicromiles: 20_000_000}),
    criteria({restaurantName: "restaurant"}),
    criteria({sources: ["biteScore", "biteSaver"]}),
    criteria({searchInstanceId: "another-search"}),
  ]) {
    await assert.rejects(
      searchAdminLinkRestaurantsPageHandler(continued(changed), handler(store)),
      /expired|invalid/i,
    );
  }
});

test("rehydration can omit a full page while preserving hasNext", async () => {
  const candidates = Array.from({length: 51}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument("restaurant-" + index.toString().padStart(3, "0")),
  }));
  const store = new FakeStore(candidates);
  for (const candidate of candidates.slice(0, 50)) {
    store.current.delete(`${candidate.source}:${candidate.documentId}`);
  }
  const pageCriteria = criteria();
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    handler(store),
  );
  assert.equal(response.preparation.state, "ready");
  assert.equal(response.items.length, 0);
  assert.equal(response.hasNext, true);
  assert.equal(typeof response.nextCursor, "string");
  assert.equal(response.consumedBoundary.sourceDocumentId, "restaurant-049");
  const final = await searchAdminLinkRestaurantsPageHandler(
    request(continuationCriteria(pageCriteria, response), {
      direction: "forward",
      cursor: response.nextCursor,
      clientRequestId: "request-sparse-final",
    }),
    handler(store),
  );
  assert.equal(final.hasNext, false);
  assert.deepEqual(final.items.map((item) => item.documentId), [
    "restaurant-050",
  ]);
  assert.deepEqual(final.consumedBoundary, final.items[0].materializedOrder);
});

test("rehydration omits newly dirty names and advances to later valid rows", async () => {
  const candidates = Array.from({length: 501}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument(`restaurant-${index.toString().padStart(4, "0")}`),
  }));
  const store = new FakeStore(candidates);
  const pageCriteria = criteria();
  const preparing = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria, {clientRequestId: "dirty-name-first"}),
    handler(store),
  );
  assert.equal(preparing.preparation.state, "preparing");
  for (let index = 0; index < 50; index += 1) {
    const original = candidates[index];
    const data = {...original.data};
    switch (index % 4) {
      case 0:
        delete data.name;
        break;
      case 1:
        data.name = "   ";
        break;
      case 2:
        data.name = "N".repeat(201);
        break;
      default:
        data.name = "H".repeat(100_000);
        break;
    }
    store.current.set(`${original.source}:${original.documentId}`, {
      ...original,
      data,
    });
  }
  const changedButValid = candidates[60];
  store.current.set(
    `${changedButValid.source}:${changedButValid.documentId}`,
    {
      ...changedButValid,
      data: {...changedButValid.data, name: "Aardvark Current Name"},
    },
  );
  const sparse = await searchAdminLinkRestaurantsPageHandler(
    request(continuationCriteria(pageCriteria, preparing), {
      direction: "forward",
      cursor: preparing.nextCursor,
      clientRequestId: "dirty-name-finalize",
    }),
    handler(store),
  );
  assert.equal(sparse.preparation.state, "ready");
  assert.equal(sparse.items.length, 0);
  assert.equal(sparse.hasNext, true);
  assert.equal(sparse.consumedBoundary.sourceDocumentId, "restaurant-0049");
  const later = await searchAdminLinkRestaurantsPageHandler(
    request(continuationCriteria(pageCriteria, preparing), {
      direction: "forward",
      cursor: sparse.nextCursor,
      clientRequestId: "dirty-name-next-page",
    }),
    handler(store),
  );
  assert.equal(later.items.length, 50);
  assert.equal(later.items[0].documentId, "restaurant-0050");
  assert.equal(
    later.items[0].restaurantName,
    "Restaurant restaurant-0050",
  );
  assert.equal(
    later.items.find((item) => item.documentId === "restaurant-0060")
      .restaurantName,
    "Aardvark Current Name",
  );
  assert.deepEqual(later.consumedBoundary, later.items[49].materializedOrder);
});

test("live lease is controlled and does not start a second advance", async () => {
  const candidates = Array.from({length: 520}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument("restaurant-" + index.toString().padStart(3, "0")),
  }));
  const store = new FakeStore(candidates);
  const pageCriteria = criteria();
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    handler(store),
  );
  const session = store.sessions.get("admin-link-session");
  store.sessions.set(session.id, {
    ...session,
    leaseToken: "another-live-lease",
    leaseUntilMs: baseNow + 20_000,
  });
  const busy = await searchAdminLinkRestaurantsPageHandler(
    request(continuationCriteria(pageCriteria, first), {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "request-busy",
    }),
    handler(store),
  );
  assert.equal(busy.preparation.state, "preparing");
  assert.match(busy.preparation.message, /already checking/u);
  assert.deepEqual(store.advanceReads, [450]);
});

test("claim refresh survives the old active TTL during a live advance", async () => {
  const candidates = Array.from({length: 520}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument(`restaurant-${index.toString().padStart(4, "0")}`),
  }));
  const store = new FakeStore(candidates);
  const pageCriteria = criteria();
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria, {clientRequestId: "ttl-initial"}),
    handler(store),
  );
  assert.equal(first.preparation.state, "preparing");
  const oldPointerExpiry = store
    .activePointerForSession("admin-link-session").expiresAtMs;
  store.nowMs = oldPointerExpiry - 1;
  let releaseClaimedQuery;
  let signalClaimedQuery;
  const claimedQueryStarted = new Promise((resolve) => {
    signalClaimedQuery = resolve;
  });
  const claimedQueryRelease = new Promise((resolve) => {
    releaseClaimedQuery = resolve;
  });
  let paused = false;
  store.queryCandidatesHook = async ({query}) => {
    if (paused) return query();
    paused = true;
    signalClaimedQuery();
    await claimedQueryRelease;
    return query();
  };
  const completing = searchAdminLinkRestaurantsPageHandler(
    request(continuationCriteria(pageCriteria, first), {
      direction: "forward",
      cursor: first.nextCursor,
      clientRequestId: "ttl-completing",
    }),
    handler(store, {leaseTokenSource: () => "ttl-live-lease"}),
  );
  await claimedQueryStarted;
  const refreshedPointer = store.activePointerForSession(
    "admin-link-session",
  );
  assert.ok(refreshedPointer.expiresAtMs > oldPointerExpiry);

  store.nowMs = oldPointerExpiry;
  store.sweepExpiredActivePointers();
  assert.equal(
    store.activePointerForSession("admin-link-session").sessionId,
    "admin-link-session",
  );
  const concurrentFirst = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria, {clientRequestId: "ttl-concurrent-first"}),
    handler(store, {
      sessionIdSource: () => "must-not-create-second-session",
      leaseTokenSource: () => "must-not-scan-second-session",
    }),
  );
  assert.equal(concurrentFirst.preparation.state, "preparing");
  assert.match(concurrentFirst.preparation.message, /already checking/u);
  assert.equal(store.createdSessionCount, 1);
  assert.equal(store.sessions.size, 1);
  assert.deepEqual(store.advanceReads, [450]);

  releaseClaimedQuery();
  const completed = await completing;
  assert.equal(completed.preparation.state, "ready");
  assert.deepEqual(store.advanceReads, [450, 70]);
});

test("failure refresh survives the prior active TTL deadline", async () => {
  const store = new FakeStore([{
    source: "biteScore",
    ...biteScoreDocument("restaurant-failure"),
  }]);
  let releaseFailingQuery;
  let signalFailingQuery;
  const failingQueryStarted = new Promise((resolve) => {
    signalFailingQuery = resolve;
  });
  const failingQueryRelease = new Promise((resolve) => {
    releaseFailingQuery = resolve;
  });
  store.queryCandidatesHook = async () => {
    signalFailingQuery();
    await failingQueryRelease;
    throw new Error("forced candidate failure");
  };
  const failing = searchAdminLinkRestaurantsPageHandler(
    request(criteria(), {clientRequestId: "failure-refresh"}),
    handler(store),
  );
  await failingQueryStarted;
  const priorPointerExpiry = store
    .activePointerForSession("admin-link-session").expiresAtMs;
  store.nowMs = baseNow + 20_000;
  releaseFailingQuery();
  await assert.rejects(failing, /forced candidate failure/u);

  const failedSession = store.sessions.get("admin-link-session");
  const failedPointer = store.activePointerForSession("admin-link-session");
  assert.equal(failedSession.state, "failed");
  assert.equal(failedPointer.expiresAtMs, failedSession.idleExpiresAtMs);
  assert.ok(failedPointer.expiresAtMs > priorPointerExpiry);
  store.nowMs = priorPointerExpiry;
  store.sweepExpiredActivePointers();
  const retry = await searchAdminLinkRestaurantsPageHandler(
    request(criteria(), {clientRequestId: "failure-retry"}),
    handler(store, {sessionIdSource: () => "must-not-replace-failed"}),
  );
  assert.equal(retry.preparation.state, "failed");
  assert.equal(store.createdSessionCount, 1);
  assert.equal(store.queryLimits.length, 1);
});

test("a different live active pointer prevents a stale session claim", async () => {
  const store = new FakeStore(Array.from({length: 520}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument(`restaurant-${index.toString().padStart(4, "0")}`),
  })));
  const pageCriteria = criteria();
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria),
    handler(store),
  );
  const activeKey = store.activeKeysBySession.get("admin-link-session");
  store.activeSessions.set(activeKey, {
    ...store.activeSessions.get(activeKey),
    sessionId: "different-live-session",
    expiresAtMs: baseNow + adminLinkRestaurantIdleLifetimeMs,
  });
  await assert.rejects(
    searchAdminLinkRestaurantsPageHandler(
      request(continuationCriteria(pageCriteria, first), {
        direction: "forward",
        cursor: first.nextCursor,
        clientRequestId: "conflicting-active-pointer",
      }),
      handler(store),
    ),
    /active session conflict/u,
  );
  assert.deepEqual(store.advanceReads, [450]);
  assert.equal(
    store.activeSessions.get(activeKey).sessionId,
    "different-live-session",
  );
});

test("expired lease takeover prevents the stale worker from writing results", async () => {
  const stale = {
    source: "biteScore",
    ...biteScoreDocument("restaurant-1", {name: "Stale Name"}),
  };
  const fresh = {
    source: "biteScore",
    ...biteScoreDocument("restaurant-1", {name: "Fresh Name"}),
  };
  const unrelated = {
    source: "biteScore",
    ...biteScoreDocument("restaurant-2", {name: "Unrelated Name"}),
  };
  const store = new FakeStore([stale]);
  let releaseFirstQuery;
  let signalFirstQuery;
  const firstQueryStarted = new Promise((resolve) => {
    signalFirstQuery = resolve;
  });
  const release = new Promise((resolve) => {
    releaseFirstQuery = resolve;
  });
  let paused = false;
  store.queryCandidatesHook = async ({query}) => {
    if (paused) return query();
    paused = true;
    const staleValues = query();
    signalFirstQuery();
    await release;
    return staleValues;
  };
  const pageCriteria = criteria();
  const staleCall = searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria, {clientRequestId: "stale-request"}),
    handler(store, {leaseTokenSource: () => "reused-lease-token"}),
  );
  await firstQueryStarted;
  store.nowMs = baseNow + adminLinkRestaurantLeaseLifetimeMs + 1;
  store.candidates = [fresh, unrelated];
  store.current = new Map([
    ["biteScore:restaurant-1", fresh],
    ["biteScore:restaurant-2", unrelated],
  ]);
  const takeover = await searchAdminLinkRestaurantsPageHandler(
    request(pageCriteria, {clientRequestId: "takeover-request"}),
    handler(store, {leaseTokenSource: () => "reused-lease-token"}),
  );
  assert.deepEqual(takeover.items.map((item) => item.restaurantName), [
    "Fresh Name",
    "Unrelated Name",
  ]);
  const committed = store.results.get("admin-link-session");
  const committedBeforeStaleRelease = [...committed.values()]
    .map((value) => ({...value}))
    .sort((first, second) => compare(first.id, second.id));
  assert.equal(materializedResultValues(committed).length, 2);
  releaseFirstQuery();
  await assert.rejects(staleCall, /expired or stale lease/u);
  const committedAfterStaleRejection = [...committed.values()]
    .map((value) => ({...value}))
    .sort((first, second) => compare(first.id, second.id));
  assert.deepEqual(
    committedAfterStaleRejection,
    committedBeforeStaleRelease,
  );
  assert.deepEqual(
    new Set(materializedResultValues(committed)
      .map((value) => value.normalizedName)),
    new Set(["fresh name", "unrelated name"]),
  );
  assert.equal([...store.sessions.values()][0].state, "ready");
});

test("a physically expired lease cannot commit without a takeover", async () => {
  const candidate = {
    source: "biteScore",
    ...biteScoreDocument("restaurant-expired"),
  };
  const store = new FakeStore([candidate]);
  let releaseQuery;
  let signalQueryStarted;
  const queryStarted = new Promise((resolve) => {
    signalQueryStarted = resolve;
  });
  const queryRelease = new Promise((resolve) => {
    releaseQuery = resolve;
  });
  store.queryCandidatesHook = async ({query}) => {
    const values = query();
    signalQueryStarted();
    await queryRelease;
    return values;
  };
  const expiredCall = searchAdminLinkRestaurantsPageHandler(
    request(criteria(), {clientRequestId: "expires-during-scan"}),
    handler(store),
  );
  await queryStarted;
  store.nowMs = baseNow + adminLinkRestaurantLeaseLifetimeMs;
  releaseQuery();
  await assert.rejects(expiredCall, /expired or stale lease/u);
  assert.equal(store.results.get("admin-link-session").size, 0);
  assert.equal(store.sessions.get("admin-link-session").state, "preparing");
});

test("invalid page size and expired continuation fail before new scanning", async () => {
  const store = new FakeStore(Array.from({length: 51}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument("restaurant-" + index.toString().padStart(3, "0")),
  })));
  await assert.rejects(
    searchAdminLinkRestaurantsPageHandler(
      request(criteria(), {pageSize: 49}),
      handler(store),
    ),
    /page size|request is invalid/i,
  );
  assert.equal(store.advanceReads.length, 0);
  const first = await searchAdminLinkRestaurantsPageHandler(
    request(criteria()),
    handler(store),
  );
  await assert.rejects(
    searchAdminLinkRestaurantsPageHandler(
      request(continuationCriteria(criteria(), first), {
        direction: "forward",
        cursor: first.nextCursor,
        clientRequestId: "request-expired",
      }),
      handler(store, {now: () => baseNow + adminLinkRestaurantIdleLifetimeMs}),
    ),
    /expired|invalid/i,
  );
  assert.deepEqual(store.advanceReads, [51]);
});

test("absolute expiry replaces an active pointer even when idle expiry is later", async () => {
  const store = new FakeStore([{
    source: "biteScore",
    ...biteScoreDocument("restaurant-1"),
  }]);
  let sessionSequence = 0;
  const context = () => handler(store, {
    sessionIdSource: () => `absolute-session-${++sessionSequence}`,
  });
  await searchAdminLinkRestaurantsPageHandler(
    request(criteria(), {clientRequestId: "absolute-first"}),
    context(),
  );
  const original = store.sessions.get("absolute-session-1");
  store.sessions.set(original.id, {
    ...original,
    idleExpiresAtMs: baseNow + adminLinkRestaurantAbsoluteLifetimeMs + 60_000,
  });
  store.nowMs = baseNow + adminLinkRestaurantAbsoluteLifetimeMs;
  const replacement = await searchAdminLinkRestaurantsPageHandler(
    request(criteria(), {clientRequestId: "absolute-replacement"}),
    context(),
  );
  assert.equal(store.createdSessionCount, 2);
  assert.equal(replacement.preparation.state, "ready");
  assert.ok(store.sessions.has("absolute-session-2"));
});

test("normalized substring matching retains pending BiteSaver records", async () => {
  const store = new FakeStore([
    {
      source: "biteSaver",
      ...biteSaverDocument("pending-account", {
        restaurantName: "Alpha FFlow Place",
        approvalStatus: "pending",
      }),
    },
    {
      source: "biteSaver",
      ...biteSaverDocument("other-account", {
        restaurantName: "Flowless",
      }),
    },
  ]);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(criteria({
      restaurantName: "\uFB00LOW place",
      sources: ["biteSaver"],
    })),
    handler(store),
  );
  assert.deepEqual(response.items.map((item) => item.documentId), [
    "pending-account",
  ]);
  assert.equal(response.items[0].approvalStatus, "pending");
});

test("ordering names accept exactly 200 and omit overlong values while advancing", async () => {
  const candidates = Array.from({length: 26}, (_, index) => ({
    source: "biteScore",
    ...biteScoreDocument(`restaurant-${index.toString().padStart(3, "0")}`, {
      name: index === 0
        ? "M".repeat(200)
        : index === 25
        ? "Later Valid"
        : index === 2
        ? "H".repeat(100_000)
        : "X".repeat(201),
    }),
  }));
  const store = new FakeStore(candidates);
  const response = await searchAdminLinkRestaurantsPageHandler(
    request(criteria()),
    handler(store),
  );
  assert.equal(response.preparation.state, "ready");
  assert.deepEqual(new Set(response.items.map((item) => item.documentId)), new Set([
    "restaurant-000",
    "restaurant-025",
  ]));
  assert.equal(response.items.find((item) =>
    item.documentId === "restaurant-000").materializedOrder.normalizedName.length,
  200);
  assert.equal([...store.sessions.values()][0].scannedDocumentCount, 26);
  assert.equal(store.queryLimits.every((limit) => limit <= 25), true);
});
