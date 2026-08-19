"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  adminLinkRestaurantAbsoluteLifetimeMs,
  adminLinkRestaurantIdleLifetimeMs,
  adminLinkRestaurantLeaseLifetimeMs,
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
    this.getSourceDocumentsAttempts = 0;
    this.sourceDocumentReadAttempts = 0;
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
    return values.slice(0, limit).map((value) => ({id: value.id, data: value}));
  }

  async getSourceDocuments(identities) {
    this.getSourceDocumentsAttempts += 1;
    this.sourceDocumentReadAttempts += identities.length;
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

test("Admin Link session constants retain exact bounded budgets and expiry", () => {
  assert.equal(adminLinkRestaurantRangeChunkSize, 25);
  assert.equal(adminLinkRestaurantReadBudget, 450);
  assert.equal(adminLinkRestaurantMaximumAdvanceWrites, 453);
  assert.ok(adminLinkRestaurantMaximumAdvanceWrites < 500);
  assert.equal(adminLinkRestaurantIdleLifetimeMs, 15 * 60 * 1000);
  assert.equal(adminLinkRestaurantAbsoluteLifetimeMs, 60 * 60 * 1000);
  assert.equal(adminLinkRestaurantLeaseLifetimeMs, 30 * 1000);
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
