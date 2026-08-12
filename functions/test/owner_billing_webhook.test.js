"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  OwnerBillingWebhookContractError,
  applyOwnerBillingUnknownStatusWebhookEvent,
  applyOwnerBillingWebhookEvent,
  createOwnerBillingUnknownStatusWebhookEvent,
  createOwnerBillingStripeMetadata,
  createOwnerBillingWebhookEvent,
  decideOwnerBillingWebhookEvent: decideRawOwnerBillingWebhookEvent,
  ownerBillingStripeMetadataContractVersion,
  parseOwnerBillingStripeMetadata,
  requireMatchingOwnerBillingStripeMetadata,
} = require("../lib/owner_billing_webhook.js");
const {
  classifyOwnerBillingRawStripeStatus,
  createCheckoutPendingOwnerBillingState,
  createInitialOwnerBillingState,
} = require("../lib/owner_billing_state_contract.js");
const {
  buildOwnerRecordStateDocument,
} = require("../lib/owner_record_state_contract.js");

const allStripeStatuses = Object.freeze([
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
]);

function metadata(changes = {}) {
  return {
    contractVersion: ownerBillingStripeMetadataContractVersion,
    ownerUid: "owner-1",
    restaurantAccountId: "owner-1",
    ownerRecordGeneration: "3",
    checkoutAttemptId: "attempt-safe-1",
    billingPlanName: "coupon_monthly",
    source: "bitesaver_subscription",
    ...changes,
  };
}

function event(changes = {}) {
  const {
    metadataChanges = {},
    ...eventChanges
  } = changes;
  return createOwnerBillingWebhookEvent({
    metadata: metadata(metadataChanges),
    stripeCustomerId: "cus_customer1",
    stripeSubscriptionId: "sub_subscription1",
    rawStripeStatus: "active",
    eventType: "customer.subscription.updated",
    eventCreated: 1_800_000_000,
    eventId: "evt_event1",
    ...eventChanges,
  });
}

function unsupportedEvent(changes = {}) {
  const {
    metadataChanges = {},
    ...eventChanges
  } = changes;
  return createOwnerBillingUnknownStatusWebhookEvent({
    metadata: metadata(metadataChanges),
    stripeCustomerId: "cus_customer1",
    stripeSubscriptionId: "sub_subscription1",
    rawStripeStatus: "future_status",
    eventType: "customer.subscription.updated",
    eventCreated: 1_800_000_000,
    eventId: "evt_unknownstatus1",
    ...eventChanges,
  });
}

function owner(changes = {}) {
  return {
    ownerUid: "owner-1",
    generation: 3,
    state: "open",
    ...changes,
  };
}

function ownerDocument(state = "open") {
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  return buildOwnerRecordStateDocument({
    ownerUid: "owner-1",
    generation: 3,
    state,
    activeJobId: state === "removing" ? "job-owner-removal-1" : null,
    createdAt,
    updatedAt: createdAt,
  });
}

function pendingBillingState() {
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const pendingAt = new Date("2026-08-12T00:00:01.000Z");
  return createCheckoutPendingOwnerBillingState(
    createInitialOwnerBillingState("owner-1", 3, createdAt),
    {
      checkoutAttemptId: "attempt-safe-1",
      checkoutRequestFingerprint: "a".repeat(64),
      checkoutAttemptCreatedAt: pendingAt,
      now: pendingAt,
    },
  );
}

function currentFromEvent(value, changes = {}) {
  return {
    ownerUid: value.ownerUid,
    restaurantAccountId: value.restaurantAccountId,
    ownerRecordGeneration: value.ownerRecordGeneration,
    checkoutAttemptId: value.checkoutAttemptId,
    stripeCustomerId: value.stripeCustomerId,
    stripeSubscriptionId: value.stripeSubscriptionId,
    lastStripeEventCreated: value.eventCreated,
    lastStripeEventId: value.eventId,
    lastStripeEventPayloadFingerprint: value.payloadFingerprint,
    stripeEventConflictKind: null,
    ...changes,
  };
}

function decideOwnerBillingWebhookEvent(params) {
  return decideRawOwnerBillingWebhookEvent({
    ...params,
    expectedCheckoutAttemptId:
      Object.hasOwn(params, "expectedCheckoutAttemptId")
        ? params.expectedCheckoutAttemptId
        : "attempt-safe-1",
  });
}

function assertContractError(fn, expectedCode) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof OwnerBillingWebhookContractError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test("Checkout and Subscription metadata use one exact generation-bound schema", () => {
  const result = createOwnerBillingStripeMetadata({
    ownerUid: "owner-1",
    ownerRecordGeneration: 3,
    checkoutAttemptId: "attempt-safe-1",
  });

  assert.deepEqual(result, metadata());
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result).sort(), [
    "billingPlanName",
    "checkoutAttemptId",
    "contractVersion",
    "ownerRecordGeneration",
    "ownerUid",
    "restaurantAccountId",
    "source",
  ]);
});

test("metadata parser rejects legacy, extra, malformed, cross-owner, and unsafe-generation data", () => {
  const fixtures = [
    null,
    {},
    {...metadata(), unexpected: true},
    {...metadata(), contractVersion: "legacy"},
    {...metadata(), ownerUid: "other-owner"},
    {...metadata(), restaurantAccountId: "other-owner"},
    {...metadata(), ownerRecordGeneration: "03"},
    {...metadata(), ownerRecordGeneration: "-1"},
    {...metadata(), ownerRecordGeneration: "9007199254740992"},
    {...metadata(), checkoutAttemptId: "bad/attempt"},
    {...metadata(), source: "other"},
    {...metadata(), billingPlanName: "other"},
  ];

  for (const fixture of fixtures) {
    assertContractError(
      () => parseOwnerBillingStripeMetadata(fixture),
      "invalid_metadata",
    );
  }
});

test("Checkout Session and Subscription metadata must match exactly", () => {
  const expected = metadata();
  assert.deepEqual(
    requireMatchingOwnerBillingStripeMetadata({
      checkoutSessionMetadata: expected,
      subscriptionMetadata: {...expected},
    }),
    expected,
  );

  for (const changes of [
    {ownerRecordGeneration: "4"},
    {checkoutAttemptId: "attempt-safe-2"},
    {ownerUid: "owner-2", restaurantAccountId: "owner-2"},
  ]) {
    assertContractError(
      () => requireMatchingOwnerBillingStripeMetadata({
        checkoutSessionMetadata: expected,
        subscriptionMetadata: metadata(changes),
      }),
      "invalid_metadata",
    );
  }
});

test("all installed Stripe statuses are strict and only terminal statuses classify inactive", () => {
  for (const rawStripeStatus of allStripeStatuses) {
    const result = classifyOwnerBillingRawStripeStatus(
      rawStripeStatus,
    );
    assert.equal(
      result,
      rawStripeStatus === "canceled" ||
        rawStripeStatus === "incomplete_expired"
        ? "inactive"
        : "blocking",
      rawStripeStatus,
    );
  }
  for (const value of [undefined, null, "", "unknown", "cancelled"]) {
    assert.equal(classifyOwnerBillingRawStripeStatus(value), "unknown");
    assertContractError(() => event({rawStripeStatus: value}), "invalid_event");
  }
});

test("effective payload fingerprint excludes delivery identity but binds all billing identity and status", () => {
  const first = event();
  const redelivery = event({
    eventCreated: first.eventCreated + 10,
    eventId: "evt_event2",
  });
  const statusChanged = event({rawStripeStatus: "canceled"});
  const subscriptionChanged = event({
    stripeSubscriptionId: "sub_subscription2",
  });

  assert.match(first.payloadFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(redelivery.payloadFingerprint, first.payloadFingerprint);
  assert.notEqual(statusChanged.payloadFingerprint, first.payloadFingerprint);
  assert.notEqual(
    subscriptionChanged.payloadFingerprint,
    first.payloadFingerprint,
  );
});

test("unsupported runtime status is reduced to one attributable private unknown category", () => {
  const unknown = createOwnerBillingUnknownStatusWebhookEvent({
    metadata: metadata(),
    stripeCustomerId: "cus_customer1",
    stripeSubscriptionId: "sub_subscription1",
    rawStripeStatus: "future_status",
    eventType: "customer.subscription.updated",
    eventCreated: 1_800_000_001,
    eventId: "evt_unknownstatus1",
  });
  assert.equal(unknown.statusKind, "unsupported");
  assert.equal(unknown.ownerRecordGeneration, 3);
  assert.equal(unknown.eventCreated, 1_800_000_001);
  assert.match(unknown.payloadFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(unknown, "rawStripeStatus"), false);
  assert.equal(JSON.stringify(unknown).includes("future_status"), false);
  assertContractError(
    () => createOwnerBillingUnknownStatusWebhookEvent({
      metadata: metadata(),
      stripeCustomerId: "cus_customer1",
      stripeSubscriptionId: "sub_subscription1",
      rawStripeStatus: "active",
      eventType: "customer.subscription.updated",
      eventCreated: 1_800_000_001,
      eventId: "evt_knownstatus1",
    }),
    "invalid_event",
  );
});

test("only authoritative Subscription snapshot event types can enter ordering", () => {
  const eventTypes = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
  ];
  for (const eventType of eventTypes) {
    assert.equal(event({eventType}).eventType, eventType);
  }
  assertContractError(
    () => event({eventType: "checkout.session.completed"}),
    "invalid_event",
  );
});

test("malformed event identity, time, and raw status fail closed", () => {
  const fixtures = [
    {stripeCustomerId: "not-a-customer"},
    {stripeSubscriptionId: "not-a-subscription"},
    {eventId: "not-an-event"},
    {eventCreated: 0},
    {eventCreated: 1.5},
    {eventType: "checkout.session.completed"},
    {rawStripeStatus: "future_status"},
  ];
  for (const fixture of fixtures) {
    assertContractError(() => event(fixture), "invalid_event");
  }
});

test("matching open generation applies while stale and future generations fail closed", () => {
  const incoming = event();
  assert.deepEqual(
    decideOwnerBillingWebhookEvent({owner: owner(), current: null, incoming}),
    {
      action: "apply",
      billingEffect: "apply_incoming",
      conflictKind: null,
      allowAccountRootUpdate: true,
      resolvesEventOrderConflict: false,
    },
  );
  assert.equal(
    decideOwnerBillingWebhookEvent({
      owner: owner({generation: 4}),
      current: null,
      incoming,
    }).action,
    "ignore_stale_generation",
  );
  const future = decideOwnerBillingWebhookEvent({
    owner: owner({generation: 2}),
    current: null,
    incoming,
  });
  assert.equal(future.action, "reject_future_generation");
  assert.equal(future.billingEffect, "set_unknown");
  assert.equal(future.allowAccountRootUpdate, false);
});

test("an incoming event must match the exact reserved Checkout attempt", () => {
  for (const expectedCheckoutAttemptId of [null, "bad/attempt"]) {
    const result = decideOwnerBillingWebhookEvent({
      owner: owner(),
      expectedCheckoutAttemptId,
      current: null,
      incoming: event(),
    });
    assert.equal(result.action, "reject_invalid_state");
    assert.equal(result.billingEffect, "set_unknown");
  }

  const mismatch = decideOwnerBillingWebhookEvent({
    owner: owner(),
    expectedCheckoutAttemptId: "attempt-safe-2",
    current: null,
    incoming: event(),
  });
  assert.equal(mismatch.action, "mark_unknown_conflict");
  assert.equal(mismatch.billingEffect, "set_unknown");
  assert.equal(mismatch.allowAccountRootUpdate, false);
});

test("removing and removed owner states never permit an account-root update", () => {
  for (const state of ["removing", "removed"]) {
    const result = decideOwnerBillingWebhookEvent({
      owner: owner({state}),
      current: null,
      incoming: event(),
    });
    assert.equal(result.action, "reject_owner_not_open", state);
    assert.equal(result.billingEffect, "retain_current", state);
    assert.equal(result.allowAccountRootUpdate, false, state);
  }
});

test("non-open owner fence precedes known and unsupported future-generation events", () => {
  const current = pendingBillingState();
  const updatedAt = current.updatedAt.getTime();
  const cases = [
    {
      label: "known",
      incoming: event({
        metadataChanges: {ownerRecordGeneration: "4"},
        eventId: "evt_knownfuture1",
      }),
      apply: applyOwnerBillingWebhookEvent,
      unsupportedRawStatus: null,
    },
    {
      label: "unsupported",
      incoming: unsupportedEvent({
        metadataChanges: {ownerRecordGeneration: "4"},
        rawStripeStatus: "future_non_open_status",
        eventId: "evt_unknownfuture1",
      }),
      apply: applyOwnerBillingUnknownStatusWebhookEvent,
      unsupportedRawStatus: "future_non_open_status",
    },
  ];

  for (const state of ["removing", "removed"]) {
    for (const fixture of cases) {
      const label = `${state}/${fixture.label}`;
      const result = fixture.apply({
        owner: ownerDocument(state),
        current,
        incoming: fixture.incoming,
        now: new Date("2026-08-12T00:00:02.000Z"),
      });

      assert.deepEqual(result.decision, {
        action: "reject_owner_not_open",
        billingEffect: "retain_current",
        conflictKind: null,
        allowAccountRootUpdate: false,
        resolvesEventOrderConflict: false,
      }, label);
      assert.equal(result.changed, false, label);
      assert.deepEqual(result.state, current, label);
      assert.equal(result.state.lifecycleState, "checkout_pending", label);
      assert.equal(result.state.billingPosture, "blocking", label);
      assert.equal(result.state.ownerRecordGeneration, 3, label);
      assert.equal(result.state.updatedAt.getTime(), updatedAt, label);
      assert.equal(result.state.lastStripeEventCreated, null, label);
      assert.equal(result.state.lastStripeEventId, null, label);
      assert.equal(result.state.lastStripeEventPayloadFingerprint, null, label);
      assert.equal(result.state.stripeEventConflictKind, null, label);
      if (fixture.unsupportedRawStatus !== null) {
        assert.equal(
          JSON.stringify(result.state).includes(fixture.unsupportedRawStatus),
          false,
          label,
        );
      }
    }
  }
});

test("open owner future-generation behavior remains fail-closed for known and unsupported statuses", () => {
  const current = pendingBillingState();
  const cases = [
    {
      label: "known",
      incoming: event({
        metadataChanges: {ownerRecordGeneration: "4"},
        eventId: "evt_openknownfuture1",
      }),
      apply: applyOwnerBillingWebhookEvent,
      unsupportedRawStatus: null,
    },
    {
      label: "unsupported",
      incoming: unsupportedEvent({
        metadataChanges: {ownerRecordGeneration: "4"},
        rawStripeStatus: "future_open_status",
        eventId: "evt_openunknownfuture1",
      }),
      apply: applyOwnerBillingUnknownStatusWebhookEvent,
      unsupportedRawStatus: "future_open_status",
    },
  ];

  for (const fixture of cases) {
    const result = fixture.apply({
      owner: ownerDocument(),
      current,
      incoming: fixture.incoming,
      now: new Date("2026-08-12T00:00:02.000Z"),
    });

    assert.deepEqual(result.decision, {
      action: "reject_future_generation",
      billingEffect: "set_unknown",
      conflictKind: "identity",
      allowAccountRootUpdate: false,
      resolvesEventOrderConflict: false,
    }, fixture.label);
    assert.equal(result.changed, true, fixture.label);
    assert.equal(result.state.lifecycleState, "unknown", fixture.label);
    assert.equal(result.state.billingPosture, "unknown", fixture.label);
    assert.equal(result.state.ownerRecordGeneration, 3, fixture.label);
    assert.equal(current.lifecycleState, "checkout_pending", fixture.label);
    assert.equal(current.billingPosture, "blocking", fixture.label);
    if (fixture.unsupportedRawStatus !== null) {
      assert.equal(
        JSON.stringify(result.state).includes(fixture.unsupportedRawStatus),
        false,
        fixture.label,
      );
    }
  }
});

test("older delivery is ignored and exact duplicate is an idempotent no-op", () => {
  const applied = event();
  const current = currentFromEvent(applied);
  const duplicate = decideOwnerBillingWebhookEvent({
    owner: owner(),
    current,
    incoming: applied,
  });
  assert.equal(duplicate.action, "ignore_exact_duplicate");
  assert.equal(duplicate.billingEffect, "retain_current");
  assert.equal(duplicate.allowAccountRootUpdate, false);

  const older = event({
    eventCreated: applied.eventCreated - 1,
    eventId: "evt_older",
    rawStripeStatus: "canceled",
  });
  const stale = decideOwnerBillingWebhookEvent({
    owner: owner(),
    current,
    incoming: older,
  });
  assert.equal(stale.action, "ignore_older_event");
  assert.equal(stale.billingEffect, "retain_current");
  assert.equal(stale.allowAccountRootUpdate, false);

  const olderIdentityVariants = [
    event({
      eventCreated: applied.eventCreated - 1,
      eventId: "evt_oldercustomer",
      stripeCustomerId: "cus_customer2",
    }),
    event({
      eventCreated: applied.eventCreated - 1,
      eventId: "evt_oldersubscription",
      stripeSubscriptionId: "sub_subscription2",
    }),
    event({
      eventCreated: applied.eventCreated - 1,
      eventId: "evt_olderattempt",
      metadataChanges: {checkoutAttemptId: "attempt-safe-2"},
    }),
    event({
      eventCreated: applied.eventCreated - 1,
      eventId: "evt_olderallidentity",
      stripeCustomerId: "cus_customer2",
      stripeSubscriptionId: "sub_subscription2",
      metadataChanges: {checkoutAttemptId: "attempt-safe-2"},
    }),
  ];
  for (const incoming of olderIdentityVariants) {
    const result = decideOwnerBillingWebhookEvent({
      owner: owner(),
      current,
      incoming,
    });
    assert.equal(result.action, "ignore_older_event");
    assert.equal(result.billingEffect, "retain_current");
    assert.equal(result.allowAccountRootUpdate, false);
  }
});

test("equal-time equivalent delivery is a no-op but equal-time conflict becomes unknown", () => {
  const applied = event();
  const current = currentFromEvent(applied);
  const equivalent = event({eventId: "evt_equivalent"});
  const equivalentResult = decideOwnerBillingWebhookEvent({
    owner: owner(),
    current,
    incoming: equivalent,
  });
  assert.equal(equivalentResult.action, "ignore_equal_equivalent");
  assert.equal(equivalentResult.billingEffect, "retain_current");

  const conflicting = event({
    eventId: "evt_conflict",
    rawStripeStatus: "canceled",
  });
  const conflictResult = decideOwnerBillingWebhookEvent({
    owner: owner(),
    current,
    incoming: conflicting,
  });
  assert.equal(conflictResult.action, "mark_unknown_conflict");
  assert.equal(conflictResult.billingEffect, "set_unknown");
  assert.equal(conflictResult.allowAccountRootUpdate, false);
});

test("same event ID with changed timestamp or payload is always a conflict", () => {
  const applied = event();
  const current = currentFromEvent(applied);
  for (const incoming of [
    event({eventCreated: applied.eventCreated + 1}),
    event({rawStripeStatus: "canceled"}),
  ]) {
    const result = decideOwnerBillingWebhookEvent({
      owner: owner(),
      current,
      incoming,
    });
    assert.equal(result.action, "mark_unknown_conflict");
    assert.equal(result.billingEffect, "set_unknown");
  }
});

test("strictly newer same-identity event applies and can resolve event-order conflict", () => {
  const applied = event();
  const current = currentFromEvent(applied, {
    stripeEventConflictKind: "event_order",
  });
  const newer = event({
    eventCreated: applied.eventCreated + 1,
    eventId: "evt_newer",
    rawStripeStatus: "canceled",
  });
  const result = decideOwnerBillingWebhookEvent({
    owner: owner(),
    current,
    incoming: newer,
  });
  assert.equal(result.action, "apply");
  assert.equal(result.billingEffect, "apply_incoming");
  assert.equal(result.allowAccountRootUpdate, true);
  assert.equal(result.resolvesEventOrderConflict, true);
});

test("customer, subscription, attempt, or persisted identity conflict remains unknown", () => {
  const applied = event();
  const baseCurrent = currentFromEvent(applied);
  for (const eventCreated of [
    applied.eventCreated,
    applied.eventCreated + 1,
  ]) {
    const identityVariants = [
      event({
        eventCreated,
        stripeCustomerId: "cus_customer2",
        eventId: "evt_identitycustomer",
      }),
      event({
        eventCreated,
        stripeSubscriptionId: "sub_subscription2",
        eventId: "evt_identitysubscription",
      }),
      event({
        eventCreated,
        metadataChanges: {checkoutAttemptId: "attempt-safe-2"},
        eventId: "evt_identityattempt",
      }),
    ];
    for (const incoming of identityVariants) {
      const result = decideOwnerBillingWebhookEvent({
        owner: owner(),
        current: baseCurrent,
        incoming,
      });
      assert.equal(result.action, "mark_unknown_conflict");
      assert.equal(result.billingEffect, "set_unknown");
      assert.equal(result.allowAccountRootUpdate, false);
    }
  }

  const result = decideOwnerBillingWebhookEvent({
    owner: owner(),
    current: {...baseCurrent, stripeEventConflictKind: "identity"},
    incoming: event({eventCreated: applied.eventCreated + 1}),
  });
  assert.equal(result.action, "mark_unknown_conflict");
  assert.equal(result.resolvesEventOrderConflict, false);
});

test("invalid persisted ordering state cannot authorize a root update", () => {
  const incoming = event();
  const baseCurrent = currentFromEvent(incoming);
  for (const current of [
    {...baseCurrent, ownerRecordGeneration: 2},
    {...baseCurrent, lastStripeEventCreated: -1},
    {...baseCurrent, lastStripeEventId: "invalid"},
    {...baseCurrent, lastStripeEventPayloadFingerprint: "invalid"},
  ]) {
    const result = decideOwnerBillingWebhookEvent({
      owner: owner(),
      current,
      incoming,
    });
    assert.equal(result.action, "reject_invalid_state");
    assert.equal(result.billingEffect, "set_unknown");
    assert.equal(result.allowAccountRootUpdate, false);
  }
});

test("pure webhook contract has no logging, Stripe, Firebase, secret, or network boundary", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/owner_billing_webhook.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /from ["']stripe["']/);
  assert.doesNotMatch(source, /firebase|logger|console\.|fetch\s*\(|defineSecret/i);
  assert.doesNotMatch(source, /restaurant_accounts|private_owner_billing_states/);
});
