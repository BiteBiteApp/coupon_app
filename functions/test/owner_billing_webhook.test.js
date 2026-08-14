"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const webhook = require("../lib/owner_billing_webhook.js");
const billing = require("../lib/owner_billing_state_contract.js");

const allStripeStatuses = Object.freeze([
  "active", "canceled", "incomplete", "incomplete_expired",
  "past_due", "paused", "trialing", "unpaid",
]);

function metadata(changes = {}) {
  return {
    contractVersion: webhook.ownerBillingStripeMetadataContractVersion,
    ownerUid: "owner-1",
    restaurantAccountId: "owner-1",
    checkoutAttemptId: "attempt-safe-1",
    billingPlanName: "coupon_monthly",
    source: "bitesaver_subscription",
    ...changes,
  };
}

function event(changes = {}) {
  const {metadataChanges = {}, ...eventChanges} = changes;
  return webhook.createOwnerBillingWebhookEvent({
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

function pendingBillingState() {
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const pendingAt = new Date("2026-08-12T00:00:01.000Z");
  return billing.createCheckoutPendingOwnerBillingState(
    billing.createInitialOwnerBillingState("owner-1", createdAt),
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

function decide(params) {
  return webhook.decideOwnerBillingWebhookEvent({
    ownerUid: "owner-1",
    expectedCheckoutAttemptId: "attempt-safe-1",
    ...params,
  });
}

function assertContractError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof webhook.OwnerBillingWebhookContractError);
    assert.equal(error.code, code);
    return true;
  });
}

test("Checkout and Subscription metadata use one exact generation-free schema", () => {
  const result = webhook.createOwnerBillingStripeMetadata({
    ownerUid: "owner-1",
    checkoutAttemptId: "attempt-safe-1",
  });
  assert.deepEqual(result, metadata());
  assert.equal(webhook.ownerBillingStripeMetadataContractVersion, "bitestar.owner-billing-metadata.v2");
  assert.deepEqual(Object.keys(result).sort(), [
    "billingPlanName", "checkoutAttemptId", "contractVersion",
    "ownerUid", "restaurantAccountId", "source",
  ]);
});

test("metadata parsing is strict and Checkout/Subscription copies must match", () => {
  assert.deepEqual(webhook.parseOwnerBillingStripeMetadata(metadata()), metadata());
  const missingSource = metadata();
  delete missingSource.source;
  for (const invalid of [
    null,
    {},
    missingSource,
    {...metadata(), extra: true},
    metadata({ownerUid: "other-owner"}),
    metadata({restaurantAccountId: "other-owner"}),
    metadata({checkoutAttemptId: "bad/id"}),
    metadata({contractVersion: "legacy"}),
    metadata({billingPlanName: "other-plan"}),
    metadata({source: "other-source"}),
  ]) {
    assertContractError(() => webhook.parseOwnerBillingStripeMetadata(invalid), "invalid_metadata");
  }
  assert.deepEqual(webhook.requireMatchingOwnerBillingStripeMetadata({
    checkoutSessionMetadata: metadata(),
    subscriptionMetadata: metadata(),
  }), metadata());
  assertContractError(() => webhook.requireMatchingOwnerBillingStripeMetadata({
    checkoutSessionMetadata: metadata(),
    subscriptionMetadata: metadata({checkoutAttemptId: "attempt-other"}),
  }), "invalid_metadata");
  assertContractError(() => webhook.requireMatchingOwnerBillingStripeMetadata({
    checkoutSessionMetadata: metadata(),
    subscriptionMetadata: metadata({
      ownerUid: "owner-2",
      restaurantAccountId: "owner-2",
    }),
  }), "invalid_metadata");
});

test("installed Stripe statuses are strict and only terminal statuses are inactive", () => {
  for (const status of allStripeStatuses) {
    const value = event({rawStripeStatus: status});
    assert.equal(value.rawStripeStatus, status);
    assert.equal(value.billingPosture,
      status === "canceled" || status === "incomplete_expired" ? "inactive" : "blocking");
  }
  assertContractError(() => event({rawStripeStatus: "future_status"}), "invalid_event");
  const unknown = webhook.createOwnerBillingUnknownStatusWebhookEvent({
    metadata: metadata(),
    stripeCustomerId: "cus_customer1",
    stripeSubscriptionId: "sub_subscription1",
    rawStripeStatus: "future_status",
    eventType: "customer.subscription.updated",
    eventCreated: 1_800_000_000,
    eventId: "evt_unknown1",
  });
  assert.equal(unknown.statusKind, "unsupported");
  assert.equal(Object.hasOwn(unknown, "rawStripeStatus"), false);
  assert.equal(JSON.stringify(unknown).includes("future_status"), false);
  assertContractError(
    () => webhook.createOwnerBillingUnknownStatusWebhookEvent({
      metadata: metadata(),
      stripeCustomerId: "cus_customer1",
      stripeSubscriptionId: "sub_subscription1",
      rawStripeStatus: "active",
      eventType: "customer.subscription.updated",
      eventCreated: 1_800_000_000,
      eventId: "evt_known1",
    }),
    "invalid_event",
  );
});

test("webhook events reject malformed Stripe identity, type, time, and status", () => {
  for (const changes of [
    {stripeCustomerId: "not-a-customer"},
    {stripeSubscriptionId: "not-a-subscription"},
    {eventId: "not-an-event"},
    {eventCreated: 0},
    {eventCreated: 1.5},
    {eventCreated: Number.MAX_SAFE_INTEGER + 1},
    {eventType: "checkout.session.completed"},
    {rawStripeStatus: "future_status"},
  ]) {
    assertContractError(() => event(changes), "invalid_event");
  }
  for (const eventType of [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
  ]) {
    assert.equal(event({eventType}).eventType, eventType);
  }
});

test("payload identity excludes delivery identity but binds effective subscription data", () => {
  const baseline = event();
  assert.equal(event({eventId: "evt_event2"}).payloadFingerprint, baseline.payloadFingerprint);
  assert.equal(event({eventCreated: baseline.eventCreated + 1}).payloadFingerprint, baseline.payloadFingerprint);
  assert.notEqual(event({stripeCustomerId: "cus_customer2"}).payloadFingerprint, baseline.payloadFingerprint);
  assert.notEqual(event({rawStripeStatus: "trialing"}).payloadFingerprint, baseline.payloadFingerprint);
  assert.notEqual(event({metadataChanges: {checkoutAttemptId: "attempt-safe-2"}}).payloadFingerprint, baseline.payloadFingerprint);
});

test("event decision preserves older, duplicate, equivalent, and conflict handling", () => {
  const baseline = event();
  const current = currentFromEvent(baseline);
  assert.deepEqual(decide({current: null, incoming: baseline}), {
    action: "apply",
    billingEffect: "apply_incoming",
    conflictKind: null,
    allowAccountRootUpdate: true,
    resolvesEventOrderConflict: false,
  });
  assert.deepEqual(decide({current, incoming: baseline}), {
    action: "ignore_exact_duplicate",
    billingEffect: "retain_current",
    conflictKind: null,
    allowAccountRootUpdate: false,
    resolvesEventOrderConflict: false,
  });
  assert.equal(
    decide({current, incoming: event({eventId: "evt_event2"})}).action,
    "ignore_equal_equivalent",
  );
  for (const incoming of [
    event({
      eventCreated: baseline.eventCreated - 1,
      rawStripeStatus: "canceled",
    }),
    event({
      eventCreated: baseline.eventCreated - 1,
      stripeCustomerId: "cus_olderother",
    }),
    event({
      eventCreated: baseline.eventCreated - 1,
      metadataChanges: {checkoutAttemptId: "attempt-older-other"},
    }),
  ]) {
    assert.equal(
      decide({current, incoming}).action,
      "ignore_older_event",
    );
  }
  assert.equal(decide({current, incoming: event({
    eventId: "evt_event2",
    rawStripeStatus: "trialing",
  })}).action, "mark_unknown_conflict");
  assert.equal(decide({current, incoming: event({
    eventCreated: baseline.eventCreated + 1,
    stripeCustomerId: "cus_other",
  })}).conflictKind, "identity");
});

test("same event contradictions conflict and newer valid events resolve order conflicts", () => {
  const baseline = event();
  const current = currentFromEvent(baseline);
  for (const incoming of [
    event({eventCreated: baseline.eventCreated + 1}),
    event({rawStripeStatus: "canceled"}),
  ]) {
    const result = decide({current, incoming});
    assert.equal(result.action, "mark_unknown_conflict");
    assert.equal(result.billingEffect, "set_unknown");
    assert.equal(result.conflictKind, "event_order");
    assert.equal(result.allowAccountRootUpdate, false);
  }

  const newer = event({
    eventCreated: baseline.eventCreated + 1,
    eventId: "evt_newer",
    rawStripeStatus: "canceled",
  });
  const result = decide({
    current: currentFromEvent(baseline, {
      stripeEventConflictKind: "event_order",
    }),
    incoming: newer,
  });
  assert.equal(result.action, "apply");
  assert.equal(result.billingEffect, "apply_incoming");
  assert.equal(result.allowAccountRootUpdate, true);
  assert.equal(result.resolvesEventOrderConflict, true);
});

test("newer customer, subscription, and attempt conflicts remain private unknown", () => {
  const baseline = event();
  const current = currentFromEvent(baseline);
  for (const incoming of [
    event({
      eventCreated: baseline.eventCreated + 1,
      eventId: "evt_newercustomer",
      stripeCustomerId: "cus_customer2",
    }),
    event({
      eventCreated: baseline.eventCreated + 1,
      eventId: "evt_newersubscription",
      stripeSubscriptionId: "sub_subscription2",
    }),
    event({
      eventCreated: baseline.eventCreated + 1,
      eventId: "evt_newerattempt",
      metadataChanges: {checkoutAttemptId: "attempt-safe-2"},
    }),
  ]) {
    const result = decide({current, incoming});
    assert.equal(result.action, "mark_unknown_conflict");
    assert.equal(result.billingEffect, "set_unknown");
    assert.equal(result.conflictKind, "identity");
    assert.equal(result.allowAccountRootUpdate, false);
  }
});

test("checkout-attempt and owner/account mismatches fail closed", () => {
  assert.equal(decide({
    expectedCheckoutAttemptId: "attempt-other",
    current: null,
    incoming: event(),
  }).conflictKind, "identity");
  assert.equal(decide({
    ownerUid: "other-owner",
    current: null,
    incoming: event(),
  }).action, "reject_invalid_state");
  assert.equal(decide({
    current: null,
    incoming: {...event(), restaurantAccountId: "other-owner"},
  }).action, "reject_invalid_state");
  for (const expectedCheckoutAttemptId of [null, "bad/attempt"]) {
    assert.equal(decide({
      expectedCheckoutAttemptId,
      current: null,
      incoming: event(),
    }).action, "reject_invalid_state");
  }
});

test("invalid persisted webhook ordering state cannot authorize a root update", () => {
  const incoming = event();
  const current = currentFromEvent(incoming);
  for (const invalidCurrent of [
    {...current, ownerUid: "other-owner"},
    {...current, restaurantAccountId: "other-owner"},
    {...current, lastStripeEventCreated: -1},
    {...current, lastStripeEventId: "invalid"},
    {...current, lastStripeEventPayloadFingerprint: "invalid"},
    {...current, stripeEventConflictKind: "future_conflict"},
  ]) {
    const result = decide({current: invalidCurrent, incoming});
    assert.equal(result.action, "reject_invalid_state");
    assert.equal(result.billingEffect, "set_unknown");
    assert.equal(result.allowAccountRootUpdate, false);
  }
});

test("apply persists ordered subscription state and duplicate delivery is a no-op", () => {
  const first = webhook.applyOwnerBillingWebhookEvent({
    current: pendingBillingState(),
    incoming: event(),
    now: new Date("2026-08-12T00:00:02.000Z"),
  });
  assert.equal(first.changed, true);
  assert.equal(first.state.lifecycleState, "subscription_known");
  assert.equal(first.state.rawStripeStatus, "active");
  const replay = webhook.applyOwnerBillingWebhookEvent({
    current: first.state,
    incoming: event(),
    now: new Date("2026-08-12T00:00:03.000Z"),
  });
  assert.equal(replay.changed, false);
  assert.equal(replay.decision.action, "ignore_exact_duplicate");
});

test("apply rejects forged billing and cross-owner or cross-account incoming state", () => {
  const current = pendingBillingState();
  assert.throws(
    () => webhook.applyOwnerBillingWebhookEvent({
      current: {...current, fingerprint: "0".repeat(64)},
      incoming: event(),
      now: new Date("2026-08-12T00:00:02.000Z"),
    }),
    (error) => error?.name === "OwnerBillingStateContractError" &&
      error.code === "invalid-state",
  );
  for (const input of [
    {
      current,
      incoming: {...event(), ownerUid: "other-owner"},
    },
    {
      current,
      incoming: {...event(), restaurantAccountId: "other-owner"},
    },
  ]) {
    assertContractError(
      () => webhook.applyOwnerBillingWebhookEvent({
        ...input,
        now: new Date("2026-08-12T00:00:02.000Z"),
      }),
      "invalid_event",
    );
  }
});

test("unsupported attributable status becomes private unknown and cannot update account root", () => {
  const incoming = webhook.createOwnerBillingUnknownStatusWebhookEvent({
    metadata: metadata(),
    stripeCustomerId: "cus_customer1",
    stripeSubscriptionId: "sub_subscription1",
    rawStripeStatus: "future_status",
    eventType: "customer.subscription.updated",
    eventCreated: 1_800_000_000,
    eventId: "evt_unknown1",
  });
  const result = webhook.applyOwnerBillingUnknownStatusWebhookEvent({
    current: pendingBillingState(),
    incoming,
    now: new Date("2026-08-12T00:00:02.000Z"),
  });
  assert.equal(result.state.lifecycleState, "unknown");
  assert.equal(result.state.billingPosture, "unknown");
  assert.equal(result.state.stripeEventConflictKind, "unsupported_status");
  assert.equal(result.decision.allowAccountRootUpdate, false);
});

test("pure webhook contract has no logging, Stripe, Firebase, secret, or network boundary", () => {
  const source = readFileSync(path.resolve(__dirname, "../src/owner_billing_webhook.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /from\s+["']firebase|firebase-admin|getFirestore\s*\(|logger\.|console\.|defineSecret\s*\(|new Stripe\s*\(|fetch\s*\(/u,
  );
});
