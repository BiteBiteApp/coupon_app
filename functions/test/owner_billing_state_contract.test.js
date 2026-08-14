"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const billing = require("../lib/owner_billing_state_contract.js");

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

function initial(uid = ownerUid) {
  return billing.createInitialOwnerBillingState(uid, createdAt);
}

function pending() {
  return billing.createCheckoutPendingOwnerBillingState(initial(), {
    checkoutAttemptId: "attempt_contract_1",
    checkoutRequestFingerprint: fingerprintA,
    checkoutAttemptCreatedAt: attemptAt,
    now: attemptAt,
  });
}

function known(status = "active", changes = {}) {
  return billing.buildOwnerBillingStateDocument({
    ownerUid,
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

function coreOf(document) {
  const core = {...document};
  delete core.version;
  delete core.fingerprint;
  return core;
}

function stored(document, changes = {}, id = ownerUid) {
  return {id, data: {...document, ...changes}};
}

function assertContractError(action, expectedCode) {
  assert.throws(action, (error) => {
    assert.equal(error.name, "OwnerBillingStateContractError");
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test("owner billing publishes one exact generation-free private schema", () => {
  assert.equal(billing.ownerBillingStateCollection, "private_owner_billing_states");
  assert.equal(billing.ownerBillingStateVersion, "bitestar.owner-billing-state.v2");
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
});

test("raw Stripe status classification is exhaustive and conservative", () => {
  assert.deepEqual(
    [...billing.ownerBillingRawStripeStatuses].sort(),
    Object.keys(expectedPostures).sort(),
  );
  for (const [status, posture] of Object.entries(expectedPostures)) {
    assert.equal(billing.classifyOwnerBillingRawStripeStatus(status), posture);
  }
  for (const unsupported of [null, undefined, "", "future_status", 1, {}]) {
    assert.equal(billing.classifyOwnerBillingRawStripeStatus(unsupported), "unknown");
  }
});

test("billing initialization creates once and binds the exact authenticated owner", () => {
  const created = billing.initializeOwnerBillingState(null, ownerUid, createdAt);
  assert.equal(created.created, true);
  assert.deepEqual(created.state, initial());
  const existing = billing.initializeOwnerBillingState(
    stored(created.state),
    ownerUid,
    updatedAt,
  );
  assert.equal(existing.created, false);
  assert.deepEqual(existing.state, created.state);
  assertContractError(
    () => billing.initializeOwnerBillingState(stored(created.state), "other-owner", updatedAt),
    "invalid-state",
  );
});

test("strict parser accepts timestamp-like values and rejects extra or forged fields", () => {
  assert.equal(billing.parseOwnerBillingStateDocument(null), null);
  const document = pending();
  const parsed = billing.parseOwnerBillingStateDocument({
    id: ownerUid,
    data: {
      ...document,
      createdAt: {toDate: () => new Date(document.createdAt)},
      updatedAt: {toDate: () => new Date(document.updatedAt)},
      checkoutAttemptCreatedAt: {
        toDate: () => new Date(document.checkoutAttemptCreatedAt),
      },
    },
  });
  assert.deepEqual(parsed, document);
  assertContractError(
    () => billing.parseOwnerBillingStateDocument(stored(document, {extra: true})),
    "invalid-state",
  );
  assertContractError(
    () => billing.parseOwnerBillingStateDocument(stored(document, {fingerprint: "0".repeat(64)})),
    "invalid-state",
  );
  assertContractError(
    () => billing.parseOwnerBillingStateDocument(stored(document, {}, "other-owner")),
    "invalid-state",
  );
});

test("strict parser rejects wrong schema, missing keys, IDs, and fingerprints", () => {
  const document = initial();
  const {updatedAt: omitted, ...missingKey} = document;
  void omitted;
  const candidates = [
    stored(document, {version: "bitestar.owner-billing-state.v1"}),
    {id: ownerUid, data: missingKey},
    stored(document, {unexpected: true}),
    stored(document, {fingerprint: "0".repeat(64)}),
    stored(document, {}, "another-owner"),
    stored(document, {}, `${ownerUid}/child`),
  ];
  for (const candidate of candidates) {
    assertContractError(
      () => billing.parseOwnerBillingStateDocument(candidate),
      "invalid-state",
    );
  }
});

test("every installed Stripe status builds and parses with its exact posture", () => {
  for (const [status, posture] of Object.entries(expectedPostures)) {
    const document = known(status);
    assert.deepEqual(
      billing.parseOwnerBillingStateDocument(stored(document)),
      document,
      status,
    );
    assert.equal(document.billingPosture, posture, status);
  }
});

test("checkout reservation, uncertainty, and late session recording stay conservative", () => {
  const reserved = pending();
  assert.equal(reserved.lifecycleState, "checkout_pending");
  assert.equal(reserved.billingPosture, "blocking");
  const uncertain = billing.markCheckoutUncertain(reserved, updatedAt);
  assert.equal(uncertain.lifecycleState, "unknown");
  assert.equal(uncertain.billingPosture, "unknown");
  const recorded = billing.recordCheckoutSession(uncertain, {
    checkoutSessionId: "cs_test_contract",
    stripeCustomerId: "cus_contract",
    now: new Date("2026-08-11T12:03:00.000Z"),
  });
  assert.equal(recorded.lifecycleState, "checkout_pending");
  assert.equal(recorded.billingPosture, "blocking");
  assert.equal(recorded.checkoutSessionId, "cs_test_contract");
  assert.equal(recorded.stripeCustomerId, "cus_contract");
});

test("late Checkout results preserve webhook authority and reject conflicts", () => {
  const webhookState = known("active", {checkoutSessionId: null});
  const sessionRecordedAt = new Date("2026-08-11T12:03:00.000Z");
  const recorded = billing.recordCheckoutSession(webhookState, {
    checkoutSessionId: "cs_test_webhookfirst",
    stripeCustomerId: "cus_contract",
    now: sessionRecordedAt,
  });

  assert.equal(recorded.lifecycleState, "subscription_known");
  assert.equal(recorded.rawStripeStatus, "active");
  assert.equal(recorded.billingPosture, "blocking");
  assert.equal(recorded.stripeCustomerId, "cus_contract");
  assert.equal(recorded.stripeSubscriptionId, "sub_contract");
  assert.equal(recorded.checkoutAttemptId, "attempt_contract_1");
  assert.equal(recorded.checkoutRequestFingerprint, fingerprintA);
  assert.deepEqual(recorded.checkoutAttemptCreatedAt, attemptAt);
  assert.equal(recorded.checkoutSessionId, "cs_test_webhookfirst");
  assert.equal(recorded.lastStripeEventCreated, 1_786_446_120);
  assert.equal(recorded.lastStripeEventId, "evt_contract");
  assert.equal(recorded.lastStripeEventPayloadFingerprint, fingerprintB);
  assert.equal(recorded.stripeEventConflictKind, null);
  assert.deepEqual(recorded.createdAt, webhookState.createdAt);
  assert.deepEqual(recorded.updatedAt, sessionRecordedAt);

  assert.deepEqual(
    billing.recordCheckoutSession(recorded, {
      checkoutSessionId: "cs_test_webhookfirst",
      stripeCustomerId: "cus_contract",
      now: sessionRecordedAt,
    }),
    recorded,
  );
  for (const input of [
    {
      checkoutSessionId: "cs_test_differentsession",
      stripeCustomerId: "cus_contract",
    },
    {
      checkoutSessionId: "cs_test_webhookfirst",
      stripeCustomerId: "cus_different",
    },
  ]) {
    assertContractError(
      () => billing.recordCheckoutSession(recorded, {
        ...input,
        now: sessionRecordedAt,
      }),
      "invalid-state",
    );
  }
});

test("uncertain Checkout retains one attempt and rejects a second session", () => {
  const uncertain = billing.markCheckoutUncertain(pending(), updatedAt);
  const sessionAt = new Date("2026-08-11T12:03:00.000Z");
  const uncertainAgainAt = new Date("2026-08-11T12:04:00.000Z");
  const recovered = billing.recordCheckoutSession(uncertain, {
    checkoutSessionId: "cs_test_uncertainresult",
    stripeCustomerId: "cus_uncertainresult",
    now: sessionAt,
  });
  const uncertainAgain = billing.markCheckoutUncertain(
    recovered,
    uncertainAgainAt,
  );

  assert.equal(uncertainAgain.lifecycleState, "unknown");
  assert.equal(uncertainAgain.checkoutAttemptId, "attempt_contract_1");
  assert.equal(uncertainAgain.checkoutRequestFingerprint, fingerprintA);
  assert.deepEqual(uncertainAgain.checkoutAttemptCreatedAt, attemptAt);
  assert.equal(uncertainAgain.checkoutSessionId, "cs_test_uncertainresult");
  assert.equal(uncertainAgain.stripeCustomerId, "cus_uncertainresult");
  assertContractError(
    () => billing.recordCheckoutSession(uncertainAgain, {
      checkoutSessionId: "cs_test_secondresult",
      stripeCustomerId: "cus_uncertainresult",
      now: uncertainAgainAt,
    }),
    "invalid-state",
  );
});

test("terminal Stripe status can begin a new attempt while billable status cannot", () => {
  for (const status of ["canceled", "incomplete_expired"]) {
    const result = billing.createCheckoutPendingOwnerBillingState(known(status), {
      checkoutAttemptId: "attempt_contract_2",
      checkoutRequestFingerprint: "c".repeat(64),
      checkoutAttemptCreatedAt: new Date("2026-08-11T12:03:00.000Z"),
      now: new Date("2026-08-11T12:03:00.000Z"),
    });
    assert.equal(result.lifecycleState, "checkout_pending");
  }
  for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
    assertContractError(
      () => billing.createCheckoutPendingOwnerBillingState(known(status), {
        checkoutAttemptId: "attempt_contract_2",
        checkoutRequestFingerprint: "c".repeat(64),
        checkoutAttemptCreatedAt: new Date("2026-08-11T12:03:00.000Z"),
        now: new Date("2026-08-11T12:03:00.000Z"),
      }),
      "invalid-state",
    );
  }
});

test("billing schema rejects malformed identities, relationships, and timestamps", () => {
  assertContractError(() => initial("owner/child"), "invalid-request");
  assertContractError(
    () => billing.buildOwnerBillingStateDocument({
      ...known(),
      lifecycleState: "subscription_known",
      stripeCustomerId: null,
    }),
    "invalid-request",
  );
  assertContractError(
    () => billing.recordCheckoutSession(pending(), {
      checkoutSessionId: "cs_test_contract",
      now: new Date(createdAt.getTime() - 1),
    }),
    "invalid-request",
  );
});

test("billing builder rejects malformed status, Stripe identity, and event fields", () => {
  const core = coreOf(known());
  for (const changes of [
    {rawStripeStatus: "future_status"},
    {stripeCustomerId: "customer_contract"},
    {stripeCustomerId: " cus_contract"},
    {stripeCustomerId: "cus_contract/child"},
    {stripeSubscriptionId: "subscription_contract"},
    {checkoutSessionId: "session_contract"},
    {lastStripeEventId: "event_contract"},
    {lastStripeEventCreated: -1},
    {lastStripeEventCreated: 1.5},
    {stripeEventConflictKind: "future_conflict"},
  ]) {
    assertContractError(
      () => billing.buildOwnerBillingStateDocument({...core, ...changes}),
      "invalid-request",
    );
  }
});

test("billing schema enforces every lifecycle field relationship", () => {
  const noneCore = coreOf(initial());
  const pendingCore = coreOf(pending());
  const knownCore = coreOf(known());
  const unknownCore = coreOf(unknown());
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
    assertContractError(
      () => billing.buildOwnerBillingStateDocument(core),
      "invalid-request",
    );
  }
});

test("billing timestamps and fingerprints fail closed", () => {
  assertContractError(
    () => initial("owner/child"),
    "invalid-request",
  );
  assertContractError(
    () => billing.createInitialOwnerBillingState(ownerUid, new Date("invalid")),
    "invalid-request",
  );
  for (const checkoutAttemptCreatedAt of [
    new Date(createdAt.getTime() - 1),
    updatedAt,
  ]) {
    assertContractError(
      () => billing.createCheckoutPendingOwnerBillingState(initial(), {
        checkoutAttemptId: "attempt_contract_2",
        checkoutRequestFingerprint: fingerprintA,
        checkoutAttemptCreatedAt,
        now: attemptAt,
      }),
      "invalid-request",
    );
  }
  assertContractError(
    () => billing.createCheckoutPendingOwnerBillingState(initial(), {
      checkoutAttemptId: "attempt_contract_2",
      checkoutRequestFingerprint: "not-a-fingerprint",
      checkoutAttemptCreatedAt: attemptAt,
      now: attemptAt,
    }),
    "invalid-request",
  );
});

test("malformed-present billing records never become absent", () => {
  const document = known();
  for (const mutation of [
    {ownerUid: "owner/child"},
    {lifecycleState: "future"},
    {rawStripeStatus: "future_status"},
    {billingPosture: "inactive"},
    {stripeCustomerId: null},
    {lastStripeEventId: null},
    {lastStripeEventCreated: Number.MAX_SAFE_INTEGER + 1},
    {stripeEventConflictKind: "future_conflict"},
    {updatedAt: new Date(createdAt.getTime() - 1)},
    {createdAt: {toDate: () => new Date("invalid")}},
  ]) {
    assertContractError(
      () => billing.parseOwnerBillingStateDocument(
        stored(document, mutation),
      ),
      "invalid-state",
    );
  }
});
