const assert = require("node:assert/strict");
const test = require("node:test");

const billing = require("../lib/owner_billing_state_contract.js");
const owner = require("../lib/owner_record_state_contract.js");

const ownerUid = "owner-billing-contract-uid";
const createdAt = new Date("2026-08-11T12:00:00.000Z");
const attemptAt = new Date("2026-08-11T12:01:00.000Z");
const updatedAt = new Date("2026-08-11T12:02:00.000Z");
const fingerprintA = "a".repeat(64);
const fingerprintB = "b".repeat(64);

const expectedPostures = Object.freeze({
  active: "blocking",
  canceled: "inactive",
  incomplete: "blocking",
  incomplete_expired: "inactive",
  past_due: "blocking",
  paused: "blocking",
  trialing: "blocking",
  unpaid: "blocking",
});

function openOwner(generation = 0) {
  return owner.buildOwnerRecordStateDocument({
    ownerUid,
    generation,
    state: "open",
    activeJobId: null,
    createdAt,
    updatedAt,
  });
}

function ownerWithState(state, generation = 0) {
  return owner.buildOwnerRecordStateDocument({
    ownerUid,
    generation,
    state,
    activeJobId: state === "removing" ? "removal-job" : null,
    createdAt,
    updatedAt,
  });
}

function initial(generation = 0) {
  return billing.createInitialOwnerBillingState(
    ownerUid,
    generation,
    createdAt,
  );
}

function pending(generation = 0) {
  return billing.createCheckoutPendingOwnerBillingState(initial(generation), {
    checkoutAttemptId: "attempt_contract_1",
    checkoutRequestFingerprint: fingerprintA,
    checkoutAttemptCreatedAt: attemptAt,
    now: attemptAt,
  });
}

function known(status, changes = {}) {
  return billing.buildOwnerBillingStateDocument({
    ownerUid,
    ownerRecordGeneration: 0,
    lifecycleState: "subscription_known",
    rawStripeStatus: status,
    billingPosture: expectedPostures[status],
    stripeCustomerId: "cus_contract",
    stripeSubscriptionId: "sub_contract",
    checkoutAttemptId: "attempt_contract_1",
    checkoutRequestFingerprint: fingerprintA,
    checkoutAttemptCreatedAt: attemptAt,
    checkoutSessionId: "cs_test_contract",
    lastStripeEventCreated: 1_786_446_120,
    lastStripeEventId: "evt_contract",
    lastStripeEventPayloadFingerprint: fingerprintB,
    stripeEventConflictKind: null,
    createdAt,
    updatedAt,
    ...changes,
  });
}

function unknown(changes = {}) {
  return billing.buildOwnerBillingStateDocument({
    ownerUid,
    ownerRecordGeneration: 0,
    lifecycleState: "unknown",
    rawStripeStatus: null,
    billingPosture: "unknown",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    checkoutAttemptId: null,
    checkoutRequestFingerprint: null,
    checkoutAttemptCreatedAt: null,
    checkoutSessionId: null,
    lastStripeEventCreated: null,
    lastStripeEventId: null,
    lastStripeEventPayloadFingerprint: null,
    stripeEventConflictKind: null,
    createdAt,
    updatedAt,
    ...changes,
  });
}

function stored(document, changes = {}, id = ownerUid) {
  return {id, data: {...document, ...changes}};
}

function timestampLike(value) {
  return {toDate: () => new Date(value.getTime())};
}

function assertInvalidState(action) {
  assert.throws(action, (error) => {
    assert.equal(error.name, "OwnerBillingStateContractError");
    assert.equal(error.code, "invalid-state");
    assert.equal(error.message, "Stored owner billing state is invalid.");
    return true;
  });
}

test("owner billing publishes the exact private schema and versions", () => {
  assert.equal(
    billing.ownerBillingStateCollection,
    "private_owner_billing_states",
  );
  assert.equal(
    billing.ownerBillingStateVersion,
    "bitestar.owner-billing-state.v1",
  );
  const document = initial();
  assert.deepEqual(Object.keys(document).sort(), [
    "billingPosture",
    "checkoutAttemptCreatedAt",
    "checkoutAttemptId",
    "checkoutRequestFingerprint",
    "checkoutSessionId",
    "createdAt",
    "fingerprint",
    "lastStripeEventCreated",
    "lastStripeEventId",
    "lastStripeEventPayloadFingerprint",
    "lifecycleState",
    "ownerRecordGeneration",
    "ownerUid",
    "rawStripeStatus",
    "stripeCustomerId",
    "stripeEventConflictKind",
    "stripeSubscriptionId",
    "updatedAt",
    "version",
  ]);
  assert.match(document.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(document.lifecycleState, "none");
  assert.equal(document.billingPosture, "inactive");
  assert.equal(JSON.stringify(document).includes("email"), false);
  assert.equal(JSON.stringify(document).includes("paymentMethod"), false);
});

test("raw Stripe status classifier is exhaustive and conservative", () => {
  assert.deepEqual(
    [...billing.ownerBillingRawStripeStatuses].sort(),
    Object.keys(expectedPostures).sort(),
  );
  for (const [status, posture] of Object.entries(expectedPostures)) {
    assert.equal(
      billing.classifyOwnerBillingRawStripeStatus(status),
      posture,
      status,
    );
  }
  for (const unsupported of [null, undefined, "", "future_status", 1, {}]) {
    assert.equal(
      billing.classifyOwnerBillingRawStripeStatus(unsupported),
      "unknown",
    );
  }
  assert.equal(
    billing.classifyOwnerBillingRawStripeStatus("unpaid"),
    "blocking",
  );
});

test("billing parser distinguishes absence and accepts Timestamp-like values", () => {
  assert.equal(billing.parseOwnerBillingStateDocument(null), null);
  const document = pending();
  const parsed = billing.parseOwnerBillingStateDocument(stored(document, {
    checkoutAttemptCreatedAt: timestampLike(document.checkoutAttemptCreatedAt),
    createdAt: timestampLike(document.createdAt),
    updatedAt: timestampLike(document.updatedAt),
  }));
  assert.deepEqual(parsed, document);
  assert.notEqual(parsed.createdAt, document.createdAt);
});

test("every installed Stripe status builds, parses, and resolves exactly", () => {
  const ownerState = openOwner();
  for (const [status, posture] of Object.entries(expectedPostures)) {
    const document = known(status);
    const parsed = billing.parseOwnerBillingStateDocument(stored(document));
    assert.deepEqual(parsed, document, status);
    assert.equal(parsed.billingPosture, posture, status);
    assert.equal(parsed.checkoutAttemptId, "attempt_contract_1", status);
    assert.equal(
      billing.resolveAuthoritativeOwnerBillingPosture(ownerState, parsed),
      posture,
      status,
    );
  }
});

test("billing lifecycle transitions never infer inactive after Checkout starts", () => {
  const ownerState = openOwner();
  const initialState = initial();
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(ownerState, initialState),
    "inactive",
  );

  const pendingState = pending();
  assert.equal(pendingState.lifecycleState, "checkout_pending");
  assert.equal(pendingState.billingPosture, "blocking");
  assert.equal(pendingState.checkoutAttemptId, "attempt_contract_1");
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(ownerState, pendingState),
    "blocking",
  );

  const withSession = billing.recordCheckoutSession(pendingState, {
    checkoutSessionId: "cs_test_contractresult",
    stripeCustomerId: "cus_contractresult",
    now: updatedAt,
  });
  assert.equal(withSession.lifecycleState, "checkout_pending");
  assert.equal(withSession.billingPosture, "blocking");
  assert.equal(withSession.checkoutSessionId, "cs_test_contractresult");
  assert.equal(withSession.stripeCustomerId, "cus_contractresult");

  const uncertain = billing.markCheckoutUncertain(withSession, updatedAt);
  assert.equal(uncertain.lifecycleState, "unknown");
  assert.equal(uncertain.billingPosture, "unknown");
  assert.equal(uncertain.checkoutAttemptId, pendingState.checkoutAttemptId);
  assert.equal(
    uncertain.checkoutRequestFingerprint,
    pendingState.checkoutRequestFingerprint,
  );
  assert.deepEqual(
    uncertain.checkoutAttemptCreatedAt,
    pendingState.checkoutAttemptCreatedAt,
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(ownerState, uncertain),
    "unknown",
  );

  const exactRetryResult = billing.recordCheckoutSession(uncertain, {
    checkoutSessionId: "cs_test_contractresult",
    stripeCustomerId: "cus_contractresult",
    now: updatedAt,
  });
  assert.equal(exactRetryResult.lifecycleState, "checkout_pending");
  assert.equal(exactRetryResult.checkoutAttemptId, pendingState.checkoutAttemptId);
});

test("Checkout result arriving after webhook preserves authoritative subscription state", () => {
  const webhookState = known("active", {checkoutSessionId: null});
  const sessionRecordedAt = new Date("2026-08-11T12:03:00.000Z");

  const afterCheckoutResult = billing.recordCheckoutSession(webhookState, {
    checkoutSessionId: "cs_test_webhookfirst",
    stripeCustomerId: "cus_contract",
    now: sessionRecordedAt,
  });

  assert.equal(afterCheckoutResult.lifecycleState, "subscription_known");
  assert.equal(afterCheckoutResult.rawStripeStatus, "active");
  assert.equal(afterCheckoutResult.billingPosture, "blocking");
  assert.equal(afterCheckoutResult.stripeCustomerId, "cus_contract");
  assert.equal(afterCheckoutResult.stripeSubscriptionId, "sub_contract");
  assert.equal(afterCheckoutResult.checkoutAttemptId, "attempt_contract_1");
  assert.equal(afterCheckoutResult.checkoutRequestFingerprint, fingerprintA);
  assert.deepEqual(afterCheckoutResult.checkoutAttemptCreatedAt, attemptAt);
  assert.equal(afterCheckoutResult.checkoutSessionId, "cs_test_webhookfirst");
  assert.equal(afterCheckoutResult.lastStripeEventCreated, 1_786_446_120);
  assert.equal(afterCheckoutResult.lastStripeEventId, "evt_contract");
  assert.equal(
    afterCheckoutResult.lastStripeEventPayloadFingerprint,
    fingerprintB,
  );
  assert.equal(afterCheckoutResult.stripeEventConflictKind, null);
  assert.deepEqual(afterCheckoutResult.createdAt, webhookState.createdAt);
  assert.deepEqual(afterCheckoutResult.updatedAt, sessionRecordedAt);
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      openOwner(),
      afterCheckoutResult,
    ),
    "blocking",
  );

  const exactReplay = billing.recordCheckoutSession(afterCheckoutResult, {
    checkoutSessionId: "cs_test_webhookfirst",
    stripeCustomerId: "cus_contract",
    now: sessionRecordedAt,
  });
  assert.deepEqual(exactReplay, afterCheckoutResult);
  assert.throws(
    () => billing.recordCheckoutSession(afterCheckoutResult, {
      checkoutSessionId: "cs_test_differentsession",
      stripeCustomerId: "cus_contract",
      now: sessionRecordedAt,
    }),
    (error) => error.code === "invalid-state",
  );
  assert.throws(
    () => billing.recordCheckoutSession(afterCheckoutResult, {
      checkoutSessionId: "cs_test_webhookfirst",
      stripeCustomerId: "cus_different",
      now: sessionRecordedAt,
    }),
    (error) => error.code === "invalid-state",
  );
});

test("uncertain Checkout response preserves one exact attempt and later session", () => {
  const pendingState = pending();
  const uncertainAt = new Date("2026-08-11T12:02:00.000Z");
  const sessionAt = new Date("2026-08-11T12:03:00.000Z");
  const retryUncertainAt = new Date("2026-08-11T12:04:00.000Z");

  const uncertain = billing.markCheckoutUncertain(pendingState, uncertainAt);
  assert.equal(uncertain.lifecycleState, "unknown");
  assert.equal(uncertain.billingPosture, "unknown");
  assert.equal(uncertain.checkoutAttemptId, pendingState.checkoutAttemptId);
  assert.equal(
    uncertain.checkoutRequestFingerprint,
    pendingState.checkoutRequestFingerprint,
  );
  assert.deepEqual(
    uncertain.checkoutAttemptCreatedAt,
    pendingState.checkoutAttemptCreatedAt,
  );
  assert.equal(uncertain.checkoutSessionId, null);
  assert.equal(uncertain.stripeCustomerId, null);
  assert.equal(uncertain.stripeSubscriptionId, null);
  assert.equal(uncertain.lastStripeEventId, null);

  const recoveredPending = billing.recordCheckoutSession(uncertain, {
    checkoutSessionId: "cs_test_uncertainresult",
    stripeCustomerId: "cus_uncertainresult",
    now: sessionAt,
  });
  assert.equal(recoveredPending.lifecycleState, "checkout_pending");
  assert.equal(recoveredPending.billingPosture, "blocking");
  assert.equal(
    recoveredPending.checkoutAttemptId,
    pendingState.checkoutAttemptId,
  );
  assert.equal(
    recoveredPending.checkoutRequestFingerprint,
    pendingState.checkoutRequestFingerprint,
  );
  assert.deepEqual(
    recoveredPending.checkoutAttemptCreatedAt,
    pendingState.checkoutAttemptCreatedAt,
  );
  assert.equal(recoveredPending.checkoutSessionId, "cs_test_uncertainresult");
  assert.equal(recoveredPending.stripeCustomerId, "cus_uncertainresult");
  assert.equal(recoveredPending.stripeSubscriptionId, null);
  assert.equal(recoveredPending.lastStripeEventCreated, null);
  assert.equal(recoveredPending.stripeEventConflictKind, null);

  const uncertainAgain = billing.markCheckoutUncertain(
    recoveredPending,
    retryUncertainAt,
  );
  assert.equal(uncertainAgain.lifecycleState, "unknown");
  assert.equal(uncertainAgain.checkoutSessionId, "cs_test_uncertainresult");
  assert.equal(uncertainAgain.stripeCustomerId, "cus_uncertainresult");
  assert.equal(
    uncertainAgain.checkoutAttemptId,
    pendingState.checkoutAttemptId,
  );

  const exactSessionReplay = billing.recordCheckoutSession(uncertainAgain, {
    checkoutSessionId: "cs_test_uncertainresult",
    stripeCustomerId: "cus_uncertainresult",
    now: retryUncertainAt,
  });
  assert.equal(exactSessionReplay.lifecycleState, "checkout_pending");
  assert.equal(exactSessionReplay.checkoutSessionId, "cs_test_uncertainresult");
  assert.throws(
    () => billing.recordCheckoutSession(uncertainAgain, {
      checkoutSessionId: "cs_test_secondresult",
      stripeCustomerId: "cus_uncertainresult",
      now: retryUncertainAt,
    }),
    (error) => error.code === "invalid-state",
  );
});

test("late Checkout persistence cannot weaken conservative resolver posture", () => {
  const ownerState = openOwner();
  const canceledBeforeSession = known("canceled", {checkoutSessionId: null});
  const canceledAfterSession = billing.recordCheckoutSession(
    canceledBeforeSession,
    {
      checkoutSessionId: "cs_test_terminalresult",
      now: new Date("2026-08-11T12:03:00.000Z"),
    },
  );
  assert.equal(canceledAfterSession.lifecycleState, "subscription_known");
  assert.equal(canceledAfterSession.rawStripeStatus, "canceled");
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      ownerState,
      canceledAfterSession,
    ),
    "inactive",
  );

  const uncertainState = billing.markCheckoutUncertain(pending(), updatedAt);
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      ownerState,
      uncertainState,
    ),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(ownerState, pending()),
    "blocking",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      openOwner(1),
      canceledAfterSession,
    ),
    "unknown",
  );
});

test("billing initialization creates once for an exact open generation", () => {
  const ownerState = openOwner(8);
  const initialized = billing.initializeOwnerBillingState(
    null,
    ownerState,
    createdAt,
  );
  assert.equal(initialized.created, true);
  assert.equal(initialized.state.ownerRecordGeneration, 8);
  assert.equal(initialized.state.lifecycleState, "none");

  const existing = billing.initializeOwnerBillingState(
    stored(initialized.state),
    ownerState,
    updatedAt,
  );
  assert.equal(existing.created, false);
  assert.deepEqual(existing.state, initialized.state);

  assert.throws(
    () => billing.initializeOwnerBillingState(
      stored(initialized.state),
      openOwner(9),
      updatedAt,
    ),
    (error) => error.code === "invalid-state",
  );
  for (const state of ["removing", "removed"]) {
    assert.throws(
      () => billing.initializeOwnerBillingState(
        null,
        ownerWithState(state, 8),
        updatedAt,
      ),
      (error) => error.code === "invalid-state",
    );
  }
});

test("authoritative resolver fails closed for missing or mismatched state", () => {
  const ownerState = openOwner();
  const initialState = initial();
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(null, initialState),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(ownerState, null),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      openOwner(1),
      initialState,
    ),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      ownerWithState("removing"),
      initialState,
    ),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      ownerWithState("removed"),
      initialState,
    ),
    "unknown",
  );

  const forgedBilling = {...initialState, fingerprint: "0".repeat(64)};
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      ownerState,
      forgedBilling,
    ),
    "unknown",
  );
  const forgedOwner = {...ownerState, fingerprint: "0".repeat(64)};
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      forgedOwner,
      initialState,
    ),
    "unknown",
  );
});

test("event-order, identity, and unsupported-status conflicts are persisted only as unknown", () => {
  for (const conflictKind of [
    "event_order",
    "identity",
    "unsupported_status",
  ]) {
    const conflict = unknown({
      rawStripeStatus: "active",
      stripeCustomerId: "cus_contract",
      stripeSubscriptionId: "sub_contract",
      checkoutAttemptId: "attempt_contract_1",
      checkoutRequestFingerprint: fingerprintA,
      checkoutAttemptCreatedAt: attemptAt,
      checkoutSessionId: "cs_test_contract",
      lastStripeEventCreated: 1_786_446_120,
      lastStripeEventId: "evt_contract",
      lastStripeEventPayloadFingerprint: fingerprintB,
      stripeEventConflictKind: conflictKind,
    });
    assert.equal(conflict.lifecycleState, "unknown");
    assert.equal(conflict.billingPosture, "unknown");
    assert.equal(conflict.stripeEventConflictKind, conflictKind);
    assert.equal(
      billing.resolveAuthoritativeOwnerBillingPosture(openOwner(), conflict),
      "unknown",
    );
    assert.deepEqual(
      billing.parseOwnerBillingStateDocument(stored(conflict)),
      conflict,
    );
  }
});

test("stored-document resolver contains malformed-present state as unknown", () => {
  const ownerState = openOwner();
  const billingState = initial();
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPostureFromStoredDocuments(
      stored(ownerState),
      stored(billingState),
    ),
    "inactive",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPostureFromStoredDocuments(
      stored(ownerState, {fingerprint: "0".repeat(64)}),
      stored(billingState),
    ),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPostureFromStoredDocuments(
      stored(ownerState),
      stored(billingState, {unexpected: true}),
    ),
    "unknown",
  );
});

test("billing parser rejects wrong keys, versions, IDs, and fingerprints", () => {
  const document = initial();
  const {updatedAt: omitted, ...missingKey} = document;
  void omitted;
  const candidates = [
    stored(document, {version: "bitestar.owner-billing-state.v2"}),
    {id: ownerUid, data: missingKey},
    stored(document, {unexpected: true}),
    stored(document, {fingerprint: "0".repeat(64)}),
    stored(document, {}, "another-owner"),
    stored(document, {}, `${ownerUid}/child`),
  ];
  for (const candidate of candidates) {
    assertInvalidState(() => billing.parseOwnerBillingStateDocument(candidate));
  }
});

test("billing builder rejects malformed generation, status, and identifiers", () => {
  const base = known("active");
  const core = {...base};
  delete core.version;
  delete core.fingerprint;
  const invalidChanges = [
    {ownerRecordGeneration: -1},
    {ownerRecordGeneration: 0.5},
    {ownerRecordGeneration: Number.MAX_SAFE_INTEGER + 1},
    {rawStripeStatus: "future_status"},
    {stripeCustomerId: "customer_contract"},
    {stripeCustomerId: " cus_contract"},
    {stripeCustomerId: "cus_contract/child"},
    {stripeSubscriptionId: "subscription_contract"},
    {checkoutSessionId: "session_contract"},
    {lastStripeEventId: "event_contract"},
    {lastStripeEventCreated: -1},
    {lastStripeEventCreated: 1.5},
  ];
  for (const changes of invalidChanges) {
    assert.throws(
      () => billing.buildOwnerBillingStateDocument({...core, ...changes}),
      (error) => error.code === "invalid-request",
    );
  }
});

test("billing schema enforces nullable-field relationships for every lifecycle", () => {
  const noneCore = {...initial()};
  delete noneCore.version;
  delete noneCore.fingerprint;
  const pendingCore = {...pending()};
  delete pendingCore.version;
  delete pendingCore.fingerprint;
  const knownCore = {...known("active")};
  delete knownCore.version;
  delete knownCore.fingerprint;
  const unknownCore = {...unknown()};
  delete unknownCore.version;
  delete unknownCore.fingerprint;

  const invalidCores = [
    {...noneCore, billingPosture: "blocking"},
    {...noneCore, stripeCustomerId: "cus_contract"},
    {...pendingCore, billingPosture: "inactive"},
    {...pendingCore, rawStripeStatus: "active"},
    {...pendingCore, stripeSubscriptionId: "sub_contract"},
    {...pendingCore, checkoutAttemptId: null},
    {...pendingCore, checkoutRequestFingerprint: null},
    {...pendingCore, checkoutAttemptCreatedAt: null},
    {...pendingCore, lastStripeEventCreated: 10},
    {...knownCore, rawStripeStatus: null},
    {...knownCore, billingPosture: "inactive"},
    {...knownCore, stripeCustomerId: null},
    {...knownCore, stripeSubscriptionId: null},
    {...knownCore, checkoutAttemptId: null},
    {...knownCore, checkoutRequestFingerprint: null},
    {...knownCore, checkoutAttemptCreatedAt: null},
    {...knownCore, stripeEventConflictKind: "event_order"},
    {...knownCore, lastStripeEventId: null},
    {...unknownCore, billingPosture: "inactive"},
    {...unknownCore, rawStripeStatus: "active"},
    {...unknownCore, stripeSubscriptionId: "sub_contract"},
    {...unknownCore, checkoutSessionId: "cs_test_contract"},
    {...unknownCore, stripeEventConflictKind: "event_order"},
  ];
  for (const core of invalidCores) {
    assert.throws(
      () => billing.buildOwnerBillingStateDocument(core),
      (error) => error.code === "invalid-request",
    );
  }
});

test("billing schema enforces timestamp ordering and exact fingerprints", () => {
  assert.throws(
    () => billing.createInitialOwnerBillingState(
      ownerUid,
      0,
      new Date("invalid"),
    ),
    (error) => error.code === "invalid-request",
  );
  assert.throws(
    () => billing.createCheckoutPendingOwnerBillingState(initial(), {
      checkoutAttemptId: "attempt",
      checkoutRequestFingerprint: fingerprintA,
      checkoutAttemptCreatedAt: new Date(createdAt.getTime() - 1),
      now: attemptAt,
    }),
    (error) => error.code === "invalid-request",
  );
  assert.throws(
    () => billing.createCheckoutPendingOwnerBillingState(initial(), {
      checkoutAttemptId: "attempt",
      checkoutRequestFingerprint: fingerprintA,
      checkoutAttemptCreatedAt: updatedAt,
      now: attemptAt,
    }),
    (error) => error.code === "invalid-request",
  );
  assert.throws(
    () => billing.createCheckoutPendingOwnerBillingState(initial(), {
      checkoutAttemptId: "attempt",
      checkoutRequestFingerprint: "not-a-fingerprint",
      checkoutAttemptCreatedAt: attemptAt,
      now: attemptAt,
    }),
    (error) => error.code === "invalid-request",
  );
});

test("malformed-present billing state fails closed instead of becoming absent", () => {
  const document = known("active");
  const mutations = [
    {ownerUid: "owner/child"},
    {ownerRecordGeneration: -1},
    {lifecycleState: "future"},
    {rawStripeStatus: "future_status"},
    {billingPosture: "inactive"},
    {stripeCustomerId: null},
    {lastStripeEventId: null},
    {lastStripeEventCreated: Number.MAX_SAFE_INTEGER + 1},
    {stripeEventConflictKind: "future_conflict"},
    {updatedAt: new Date(createdAt.getTime() - 1)},
    {createdAt: {toDate: () => new Date("invalid")}},
  ];
  for (const mutation of mutations) {
    assertInvalidState(() =>
      billing.parseOwnerBillingStateDocument(stored(document, mutation)));
  }
});

test("future reactivation billing reset retains the open generation", () => {
  const ownerState = openOwner(91);
  const reset = billing.resetOwnerBillingStateForReactivation(
    ownerState,
    updatedAt,
  );
  assert.equal(reset.ownerRecordGeneration, 91);
  assert.equal(reset.lifecycleState, "none");
  assert.equal(reset.billingPosture, "inactive");
  assert.equal(reset.stripeCustomerId, null);

  for (const state of ["removing", "removed"]) {
    assert.throws(
      () => billing.resetOwnerBillingStateForReactivation(
        ownerWithState(state, 91),
        updatedAt,
      ),
      (error) => error.code === "invalid-state",
    );
  }
});
