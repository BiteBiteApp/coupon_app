"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  SubscriptionReturnLedgerError,
  claimSubscriptionReturnEvent,
  hashSubscriptionReturnToken,
  isValidRestaurantAccountDocumentId,
  isValidSubscriptionReturnEventId,
  listSubscriptionReturnEvents,
  markSubscriptionReturnContextReady,
  parseSubscriptionReturnClaimRequest,
  parseSubscriptionReturnListRequest,
  parseSubscriptionReturnRedeemRequest,
  parseSubscriptionReturnSessionRequest,
  redeemSubscriptionReturnContext,
  removeUnreadySubscriptionReturnContext,
  requireRestaurantAccountOwnership,
  reserveSubscriptionReturnContext,
  subscriptionReturnLedgerClockSkewMilliseconds,
  subscriptionReturnLedgerLifetimeMilliseconds,
  subscriptionReturnLedgerMaximumContexts,
  subscriptionReturnLedgerMaximumEventId,
  subscriptionReturnLedgerMaximumEvents,
  subscriptionReturnLedgerSchemaVersion,
} = require("../lib/subscription_return_ledger.js");

const ownerUid = "ledger-owner";
const nowEpochMs = 1_900_000_000_000;

function tokenFor(seed) {
  return Buffer.alloc(32, seed).toString("base64url");
}

function hashFor(seed) {
  return hashSubscriptionReturnToken(tokenFor(seed));
}

function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function refingerprintLedger(state) {
  for (const context of Object.values(state.contexts)) {
    context.fingerprint = fingerprint([
      context.schemaVersion,
      context.family,
      context.createdAtEpochMs,
      context.expiresAtEpochMs,
      context.ready,
      context.consumedEventId,
    ]);
  }
  for (const event of Object.values(state.events)) {
    event.fingerprint = fingerprint([
      event.schemaVersion,
      event.eventId,
      event.returnKind,
      event.ownerUid,
      event.restaurantAccountDocumentId,
      event.createdAtEpochMs,
      event.expiresAtEpochMs,
      event.navigationClaimed,
      event.refreshClaimed,
    ]);
  }
  state.fingerprint = fingerprint([
    state.schemaVersion,
    state.ownerUid,
    state.restaurantAccountDocumentId,
    state.nextEventId,
    Object.entries(state.contexts)
      .sort(([left], [right]) => left.localeCompare(right)),
    Object.entries(state.events)
      .sort(([left], [right]) => Number(left) - Number(right)),
    state.createdAtEpochMs,
    state.updatedAtEpochMs,
  ]);
  return state;
}

function expectLedgerError(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof SubscriptionReturnLedgerError);
    assert.equal(error.code, code);
    assert.equal(error.message, "Subscription return state is unavailable.");
    return true;
  });
}

function reserve(rawState, seed, overrides = {}) {
  return reserveSubscriptionReturnContext({
    rawState,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    tokenHash: hashFor(seed),
    family: "checkout",
    nowEpochMs,
    ...overrides,
  });
}

function ready(rawState, seed, overrides = {}) {
  return markSubscriptionReturnContextReady({
    rawState,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    tokenHash: hashFor(seed),
    nowEpochMs,
    ...overrides,
  });
}

function redeem(rawState, seed, returnKind = "checkoutSuccess", overrides = {}) {
  return redeemSubscriptionReturnContext({
    rawState,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    tokenHash: hashFor(seed),
    returnKind,
    nowEpochMs,
    ...overrides,
  });
}

function oneReadyContext(seed = 1) {
  return ready(reserve(undefined, seed), seed);
}

test("request parsers accept only the exact v2 client contracts", () => {
  assert.deepEqual(
    parseSubscriptionReturnSessionRequest({
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: ownerUid,
    }),
    {
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: ownerUid,
    },
  );
  assert.deepEqual(
    parseSubscriptionReturnRedeemRequest({
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: ownerUid,
      returnToken: tokenFor(1),
      returnKind: "checkoutCancel",
    }),
    {
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: ownerUid,
      returnToken: tokenFor(1),
      returnKind: "checkoutCancel",
    },
  );
  assert.deepEqual(
    parseSubscriptionReturnClaimRequest({
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: ownerUid,
      eventId: "1",
      claimType: "navigation",
    }),
    {
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: ownerUid,
      eventId: "1",
      claimType: "navigation",
    },
  );
  assert.deepEqual(
    parseSubscriptionReturnListRequest({
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: ownerUid,
    }),
    {
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: ownerUid,
    },
  );

  for (const value of [
    undefined,
    null,
    [],
    {},
    {returnProtocolVersion: "2", restaurantAccountDocumentId: ownerUid},
    {returnProtocolVersion: 2.5, restaurantAccountDocumentId: ownerUid},
    {returnProtocolVersion: 2, restaurantAccountDocumentId: ownerUid, extra: 1},
    {returnProtocolVersion: 2, restaurantAccountDocumentId: " owner"},
    {returnProtocolVersion: 2, restaurantAccountDocumentId: "owner/child"},
  ]) {
    expectLedgerError(
      () => parseSubscriptionReturnSessionRequest(value),
      "invalid_request",
    );
  }

  const inherited = Object.assign(Object.create({extra: true}), {
    returnProtocolVersion: 2,
    restaurantAccountDocumentId: ownerUid,
  });
  expectLedgerError(
    () => parseSubscriptionReturnSessionRequest(inherited),
    "invalid_request",
  );
  const throwing = {};
  Object.defineProperty(throwing, "returnProtocolVersion", {
    enumerable: true,
    get() {
      throw new Error("request canary");
    },
  });
  throwing.restaurantAccountDocumentId = ownerUid;
  expectLedgerError(
    () => parseSubscriptionReturnSessionRequest(throwing),
    "invalid_request",
  );
});

test("request parsers snapshot discriminator accessors exactly once", () => {
  let returnKindReads = 0;
  const redeemRequest = {
    returnProtocolVersion: 2,
    restaurantAccountDocumentId: ownerUid,
    returnToken: tokenFor(1),
    get returnKind() {
      returnKindReads += 1;
      return returnKindReads === 1 ? "checkoutSuccess" : "invalid";
    },
  };
  assert.equal(
    parseSubscriptionReturnRedeemRequest(redeemRequest).returnKind,
    "checkoutSuccess",
  );
  assert.equal(returnKindReads, 1);

  let claimTypeReads = 0;
  const claimRequest = {
    returnProtocolVersion: 2,
    restaurantAccountDocumentId: ownerUid,
    eventId: "1",
    get claimType() {
      claimTypeReads += 1;
      return claimTypeReads === 1 ? "navigation" : "invalid";
    },
  };
  assert.equal(
    parseSubscriptionReturnClaimRequest(claimRequest).claimType,
    "navigation",
  );
  assert.equal(claimTypeReads, 1);
});

test("document and event identifiers enforce the exact bounded syntax", () => {
  assert.equal(isValidRestaurantAccountDocumentId(ownerUid), true);
  assert.equal(isValidRestaurantAccountDocumentId("x".repeat(128)), true);
  for (const value of [
    "",
    "x".repeat(129),
    ".",
    "..",
    " owner",
    "owner ",
    "owner/child",
    "owner\nchild",
    42,
    null,
  ]) {
    assert.equal(isValidRestaurantAccountDocumentId(value), false);
  }
  assert.equal(isValidSubscriptionReturnEventId("1"), true);
  assert.equal(
    isValidSubscriptionReturnEventId(
      String(subscriptionReturnLedgerMaximumEventId),
    ),
    true,
  );
  for (const value of [
    "",
    "0",
    "01",
    "-1",
    "1.0",
    String(Number.MAX_SAFE_INTEGER),
    "99999999999999999",
    1,
  ]) {
    assert.equal(isValidSubscriptionReturnEventId(value), false);
  }
});

test("SHA-256 hashes the exact 43-character ASCII token with a fixed digest", () => {
  const token = "A".repeat(43);
  assert.equal(
    hashSubscriptionReturnToken(token),
    "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a",
  );
  assert.match(hashSubscriptionReturnToken(token), /^[a-f0-9]{64}$/);
  expectLedgerError(
    () => hashSubscriptionReturnToken("caller-selected-token"),
    "invalid_request",
  );
});

test("account ownership is exact-document authoritative without mutating account data", () => {
  const accountData = {uid: ownerUid, profileField: "preserve"};
  assert.doesNotThrow(() => {
    requireRestaurantAccountOwnership({
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      accountExists: true,
      accountData,
    });
  });
  assert.deepEqual(accountData, {uid: ownerUid, profileField: "preserve"});
  assert.doesNotThrow(() => {
    requireRestaurantAccountOwnership({
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      accountExists: true,
      accountData: {profileField: "legacy-without-uid"},
    });
  });
  for (const fixture of [
    {restaurantAccountDocumentId: "sibling", accountExists: true, accountData},
    {restaurantAccountDocumentId: ownerUid, accountExists: false, accountData: undefined},
    {restaurantAccountDocumentId: ownerUid, accountExists: true, accountData: {uid: "other"}},
  ]) {
    expectLedgerError(
      () => requireRestaurantAccountOwnership({ownerUid, ...fixture}),
      "invalid_owner",
    );
  }
});

test("reservation creates one private unready context with exact 24-hour lifetime and no raw token", () => {
  const token = tokenFor(3);
  const tokenHash = hashSubscriptionReturnToken(token);
  const state = reserveSubscriptionReturnContext({
    rawState: undefined,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    tokenHash,
    family: "checkout",
    nowEpochMs,
  });

  assert.equal(state.schemaVersion, subscriptionReturnLedgerSchemaVersion);
  assert.equal(state.ownerUid, ownerUid);
  assert.equal(state.restaurantAccountDocumentId, ownerUid);
  assert.equal(state.nextEventId, 1);
  assert.deepEqual(state.events, {});
  assert.equal(
    state.contexts[tokenHash].schemaVersion,
    subscriptionReturnLedgerSchemaVersion,
  );
  assert.equal(state.contexts[tokenHash].family, "checkout");
  assert.equal(state.contexts[tokenHash].createdAtEpochMs, nowEpochMs);
  assert.equal(
    state.contexts[tokenHash].expiresAtEpochMs,
    nowEpochMs + subscriptionReturnLedgerLifetimeMilliseconds,
  );
  assert.equal(state.contexts[tokenHash].ready, false);
  assert.equal(state.contexts[tokenHash].consumedEventId, null);
  assert.match(state.contexts[tokenHash].fingerprint, /^[a-f0-9]{64}$/);
  assert.match(state.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(state).includes(token), false);
});

test("unready contexts cannot redeem, ready contexts redeem once, and replay consumes no event ID", () => {
  const unready = reserve(undefined, 4);
  expectLedgerError(
    () => redeem(unready, 4),
    "context_unavailable",
  );

  const markedReady = ready(unready, 4);
  const first = redeem(markedReady, 4);
  assert.equal(first.created, true);
  assert.equal(first.eventId, "1");
  assert.equal(first.state.nextEventId, 2);
  assert.equal(first.state.contexts[hashFor(4)].consumedEventId, "1");
  assert.equal(
    first.state.events["1"].schemaVersion,
    subscriptionReturnLedgerSchemaVersion,
  );
  assert.equal(first.state.events["1"].eventId, "1");
  assert.equal(first.state.events["1"].returnKind, "checkoutSuccess");
  assert.equal(first.state.events["1"].ownerUid, ownerUid);
  assert.equal(
    first.state.events["1"].restaurantAccountDocumentId,
    ownerUid,
  );
  assert.equal(first.state.events["1"].createdAtEpochMs, nowEpochMs);
  assert.equal(
    first.state.events["1"].expiresAtEpochMs,
    nowEpochMs + subscriptionReturnLedgerLifetimeMilliseconds,
  );
  assert.equal(first.state.events["1"].navigationClaimed, false);
  assert.equal(first.state.events["1"].refreshClaimed, false);
  assert.match(first.state.events["1"].fingerprint, /^[a-f0-9]{64}$/);
  const replay = redeem(first.state, 4);
  assert.equal(replay.created, false);
  assert.equal(replay.eventId, "1");
  assert.equal(replay.state.nextEventId, 2);
  assert.equal(Object.keys(replay.state.events).length, 1);
  assert.equal(JSON.stringify(replay.state).includes(tokenFor(4)), false);
});

test("wrong family, wrong owner, unknown token, and expired token fail without consuming context", () => {
  const state = oneReadyContext(5);
  expectLedgerError(
    () => redeem(state, 5, "customerPortal"),
    "context_unavailable",
  );
  assert.equal(state.contexts[hashFor(5)].consumedEventId, null);
  expectLedgerError(
    () => redeem(state, 6),
    "context_unavailable",
  );
  expectLedgerError(
    () => redeem(state, 5, "checkoutSuccess", {ownerUid: "other"}),
    "invalid_owner",
  );
  expectLedgerError(
    () => redeem(state, 5, "checkoutSuccess", {
      nowEpochMs:
        nowEpochMs + subscriptionReturnLedgerLifetimeMilliseconds + 1,
    }),
    "context_unavailable",
  );
});

test("context capacity is exactly 32 and neither active nor consumed context is evicted", () => {
  let state;
  for (let seed = 0; seed < subscriptionReturnLedgerMaximumContexts; seed += 1) {
    state = reserve(state, seed);
  }
  assert.equal(Object.keys(state.contexts).length, 32);
  const firstHash = hashFor(0);
  expectLedgerError(
    () => reserve(state, 99),
    "capacity_exhausted",
  );
  assert.ok(state.contexts[firstHash]);

  let consumed = ready(state, 0);
  consumed = redeem(consumed, 0).state;
  expectLedgerError(
    () => reserve(consumed, 99),
    "capacity_exhausted",
  );
  assert.equal(consumed.contexts[firstHash].consumedEventId, "1");
});

test("expired contexts clean before capacity while future or overlong timestamps fail closed", () => {
  let state;
  for (let seed = 0; seed < subscriptionReturnLedgerMaximumContexts; seed += 1) {
    state = reserve(state, seed);
  }
  const later = nowEpochMs + subscriptionReturnLedgerLifetimeMilliseconds + 1;
  const cleaned = reserve(state, 101, {nowEpochMs: later});
  assert.deepEqual(Object.keys(cleaned.contexts), [hashFor(101)]);

  const future = structuredClone(oneReadyContext(7));
  future.contexts[hashFor(7)].createdAtEpochMs =
    nowEpochMs + subscriptionReturnLedgerClockSkewMilliseconds + 1;
  future.contexts[hashFor(7)].expiresAtEpochMs =
    future.contexts[hashFor(7)].createdAtEpochMs + 1;
  expectLedgerError(
    () => listSubscriptionReturnEvents({
      rawState: future,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      nowEpochMs,
    }),
    "invalid_state",
  );

  const overlong = structuredClone(oneReadyContext(8));
  overlong.contexts[hashFor(8)].expiresAtEpochMs =
    overlong.contexts[hashFor(8)].createdAtEpochMs +
    subscriptionReturnLedgerLifetimeMilliseconds +
    1;
  expectLedgerError(
    () => listSubscriptionReturnEvents({
      rawState: overlong,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      nowEpochMs,
    }),
    "invalid_state",
  );
});

test("malformed state, unknown schema, and future consumed-event references fail closed", () => {
  const fixtures = [
    null,
    {},
    {...oneReadyContext(9), schemaVersion: 99},
    {...oneReadyContext(9), unknown: true},
    {...oneReadyContext(9), contexts: []},
  ];
  for (const rawState of fixtures) {
    expectLedgerError(
      () => listSubscriptionReturnEvents({
        rawState,
        ownerUid,
        restaurantAccountDocumentId: ownerUid,
        nowEpochMs,
      }),
      "invalid_state",
    );
  }
  const futureReference = structuredClone(oneReadyContext(10));
  futureReference.contexts[hashFor(10)].consumedEventId = "1";
  expectLedgerError(
    () => listSubscriptionReturnEvents({
      rawState: futureReference,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      nowEpochMs,
    }),
    "invalid_state",
  );

  const redeemed = redeem(oneReadyContext(10), 10).state;
  const duplicateReference = structuredClone(redeemed);
  duplicateReference.contexts[hashFor(110)] = {
    ...duplicateReference.contexts[hashFor(10)],
  };
  expectLedgerError(
    () => listSubscriptionReturnEvents({
      rawState: duplicateReference,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      nowEpochMs,
    }),
    "invalid_state",
  );
});

test("reducer boundaries reject malformed token hashes and return kinds before mutation", () => {
  const state = oneReadyContext(17);
  const before = structuredClone(state);
  for (const operation of [
    () => markSubscriptionReturnContextReady({
      rawState: state,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      tokenHash: "not-a-hash",
      nowEpochMs,
    }),
    () => removeUnreadySubscriptionReturnContext({
      rawState: state,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      tokenHash: "not-a-hash",
      nowEpochMs,
    }),
    () => redeemSubscriptionReturnContext({
      rawState: state,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      tokenHash: "not-a-hash",
      returnKind: "checkoutSuccess",
      nowEpochMs,
    }),
    () => redeemSubscriptionReturnContext({
      rawState: state,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      tokenHash: hashFor(17),
      returnKind: "invalid",
      nowEpochMs,
    }),
  ]) {
    expectLedgerError(operation, "invalid_state");
  }
  assert.deepEqual(state, before);
  assert.equal(state.nextEventId, 1);
});

test("unsafe near-maximum clocks and child timestamps after state updates fail closed", () => {
  const unsafeNow =
    Number.MAX_SAFE_INTEGER -
    subscriptionReturnLedgerLifetimeMilliseconds -
    subscriptionReturnLedgerClockSkewMilliseconds +
    1;
  expectLedgerError(
    () => reserve(undefined, 18, {nowEpochMs: unsafeNow}),
    "invalid_state",
  );
  const state = oneReadyContext(18);
  expectLedgerError(
    () => redeem(state, 18, "checkoutSuccess", {nowEpochMs: unsafeNow}),
    "invalid_state",
  );
  expectLedgerError(
    () => listSubscriptionReturnEvents({
      rawState: state,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      nowEpochMs: unsafeNow,
    }),
    "invalid_state",
  );

  const staleUpdate = structuredClone(state);
  staleUpdate.contexts[hashFor(18)].createdAtEpochMs = nowEpochMs + 1;
  staleUpdate.contexts[hashFor(18)].expiresAtEpochMs =
    nowEpochMs + subscriptionReturnLedgerLifetimeMilliseconds;
  expectLedgerError(
    () => listSubscriptionReturnEvents({
      rawState: staleUpdate,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      nowEpochMs: nowEpochMs + 1,
    }),
    "invalid_state",
  );
});

test("backward clock movement within skew keeps state and child timestamps monotonic", () => {
  const backwardEpochMs = nowEpochMs - 1_000;
  let state = reserve(undefined, 19);
  state = reserve(state, 20, {nowEpochMs: backwardEpochMs});
  assert.equal(state.createdAtEpochMs, nowEpochMs);
  assert.equal(state.updatedAtEpochMs, nowEpochMs);
  assert.equal(state.contexts[hashFor(20)].createdAtEpochMs, nowEpochMs);

  state = ready(state, 19, {nowEpochMs: backwardEpochMs});
  const redeemed = redeem(
    state,
    19,
    "checkoutSuccess",
    {nowEpochMs: backwardEpochMs},
  );
  assert.equal(redeemed.state.updatedAtEpochMs, nowEpochMs);
  assert.equal(redeemed.state.events["1"].createdAtEpochMs, nowEpochMs);

  const claimed = claimSubscriptionReturnEvent({
    rawState: redeemed.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    eventId: "1",
    claimType: "navigation",
    nowEpochMs: backwardEpochMs,
  });
  assert.equal(claimed.state.updatedAtEpochMs, nowEpochMs);
  const listed = listSubscriptionReturnEvents({
    rawState: claimed.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    nowEpochMs: backwardEpochMs,
  });
  assert.equal(listed.events.length, 1);
  assert.equal(listed.state.updatedAtEpochMs, nowEpochMs);
});

test("navigation and refresh claims are independent, atomic state transitions", () => {
  const redeemed = redeem(oneReadyContext(11), 11);
  const navigation = claimSubscriptionReturnEvent({
    rawState: redeemed.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    eventId: redeemed.eventId,
    claimType: "navigation",
    nowEpochMs,
  });
  assert.equal(navigation.claimed, true);
  assert.equal(navigation.state.events["1"].navigationClaimed, true);
  assert.equal(navigation.state.events["1"].refreshClaimed, false);

  const duplicate = claimSubscriptionReturnEvent({
    rawState: navigation.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    eventId: "1",
    claimType: "navigation",
    nowEpochMs,
  });
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.returnKind, "checkoutSuccess");

  const refresh = claimSubscriptionReturnEvent({
    rawState: duplicate.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    eventId: "1",
    claimType: "refresh",
    nowEpochMs,
  });
  assert.equal(refresh.claimed, true);
  assert.equal(refresh.state.events["1"].navigationClaimed, true);
  assert.equal(refresh.state.events["1"].refreshClaimed, true);

  expectLedgerError(
    () => claimSubscriptionReturnEvent({
      rawState: refresh.state,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      eventId: "1",
      claimType: "unknown",
      nowEpochMs,
    }),
    "invalid_state",
  );
});

test("list returns only safe bounded events and later cleanup retains consumed tombstones", () => {
  const token = tokenFor(12);
  const tokenHash = hashFor(12);
  const redeemed = redeem(oneReadyContext(12), 12);
  const listed = listSubscriptionReturnEvents({
    rawState: redeemed.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    nowEpochMs,
  });
  assert.equal(listed.events.length, 1);
  assert.deepEqual(listed.events[0], {
    eventId: "1",
    returnKind: "checkoutSuccess",
    navigationClaimed: false,
    refreshClaimed: false,
    expiresAtEpochMs:
      nowEpochMs + subscriptionReturnLedgerLifetimeMilliseconds,
  });
  const serialized = JSON.stringify(listed.events);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(tokenHash), false);
  assert.equal(serialized.includes(ownerUid), false);

  const navigation = claimSubscriptionReturnEvent({
    rawState: redeemed.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    eventId: "1",
    claimType: "navigation",
    nowEpochMs,
  });
  const completed = claimSubscriptionReturnEvent({
    rawState: navigation.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    eventId: "1",
    claimType: "refresh",
    nowEpochMs,
  });
  const cleaned = listSubscriptionReturnEvents({
    rawState: completed.state,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    nowEpochMs,
  });
  assert.deepEqual(cleaned.events, []);
  assert.equal(cleaned.state.events["1"], undefined);
  assert.equal(cleaned.state.contexts[tokenHash].consumedEventId, "1");
  expectLedgerError(
    () => reserveSubscriptionReturnContext({
      rawState: cleaned.state,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      tokenHash,
      family: "checkout",
      nowEpochMs,
    }),
    "token_hash_collision",
  );
  const replay = redeem(cleaned.state, 12);
  assert.deepEqual(
    {
      created: replay.created,
      eventId: replay.eventId,
      returnKind: replay.returnKind,
    },
    {
      created: false,
      eventId: "1",
      returnKind: "checkoutSuccess",
    },
  );
  assert.equal(replay.state.events["1"], undefined);
  assert.equal(replay.state.nextEventId, 2);
});

test("event capacity is exactly 32 and full state does not consume a context or event ID", () => {
  const contextState = oneReadyContext(13);
  const state = structuredClone(contextState);
  state.events = {};
  for (let id = 1; id <= subscriptionReturnLedgerMaximumEvents; id += 1) {
    const eventId = String(id);
    state.events[eventId] = {
      schemaVersion: subscriptionReturnLedgerSchemaVersion,
      eventId,
      returnKind: "checkoutSuccess",
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      createdAtEpochMs: nowEpochMs,
      expiresAtEpochMs:
        nowEpochMs + subscriptionReturnLedgerLifetimeMilliseconds,
      navigationClaimed: false,
      refreshClaimed: false,
      fingerprint: "",
    };
  }
  state.nextEventId = subscriptionReturnLedgerMaximumEvents + 1;
  refingerprintLedger(state);
  expectLedgerError(
    () => redeem(state, 13),
    "capacity_exhausted",
  );
  assert.equal(state.contexts[hashFor(13)].consumedEventId, null);
  assert.equal(state.nextEventId, 33);
});

test("unready cleanup removes only the exact unready context and never a ready context", () => {
  const unready = reserve(undefined, 14);
  const removed = removeUnreadySubscriptionReturnContext({
    rawState: unready,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    tokenHash: hashFor(14),
    nowEpochMs,
  });
  assert.deepEqual(removed.contexts, {});

  const markedReady = oneReadyContext(15);
  const retained = removeUnreadySubscriptionReturnContext({
    rawState: markedReady,
    ownerUid,
    restaurantAccountDocumentId: ownerUid,
    tokenHash: hashFor(15),
    nowEpochMs,
  });
  assert.equal(retained.contexts[hashFor(15)].ready, true);
});

test("missing ledger lists empty without creating server state", () => {
  assert.deepEqual(
    listSubscriptionReturnEvents({
      rawState: undefined,
      ownerUid,
      restaurantAccountDocumentId: ownerUid,
      nowEpochMs,
    }),
    {state: null, changed: false, events: []},
  );
});
