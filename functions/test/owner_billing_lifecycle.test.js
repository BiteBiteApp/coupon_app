const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");
const test = require("node:test");

const billing = require("../lib/owner_billing_state_contract.js");
const lifecycle = require("../lib/owner_billing_lifecycle.js");
const owner = require("../lib/owner_record_state_contract.js");

const ownerUid = "owner-lifecycle-uid";
const generation = 7;
const createdAt = new Date("2026-08-12T00:00:00.000Z");
const attemptAt = new Date("2026-08-12T00:01:00.000Z");
const eventAt = new Date("2026-08-12T00:02:00.000Z");
const eventCreated = 1_786_492_920;
const eventPayloadFingerprint = "e".repeat(64);

const descriptor = Object.freeze({
  variant: "primary",
  priceId: "price_coupon_monthly",
  successBaseUrl:
    "https://coupon-app-29446.web.app/stripe-success.html",
  cancelBaseUrl:
    "https://coupon-app-29446.web.app/stripe-cancel.html",
  trialPeriodDays: 30,
  metadataContractVersion: "bitestar.owner-billing-metadata.v1",
  stripeCustomerId: null,
});

function sha256Array(parts, encoding) {
  return createHash("sha256")
    .update(JSON.stringify(parts), "utf8")
    .digest(encoding);
}

function openOwner(options = {}) {
  const uid = options.ownerUid ?? ownerUid;
  const selectedGeneration = options.generation ?? generation;
  const state = options.state ?? "open";
  return owner.buildOwnerRecordStateDocument({
    ownerUid: uid,
    generation: selectedGeneration,
    state,
    activeJobId: state === "removing" ? "removal-job" : null,
    createdAt,
    updatedAt: eventAt,
  });
}

function initialBilling(options = {}) {
  return billing.createInitialOwnerBillingState(
    options.ownerUid ?? ownerUid,
    options.generation ?? generation,
    createdAt,
  );
}

function checkoutFingerprint(changes = {}) {
  return lifecycle.ownerBillingCheckoutRequestFingerprint({
    ...descriptor,
    ...changes,
  });
}

function pendingBilling(options = {}) {
  return billing.createCheckoutPendingOwnerBillingState(
    initialBilling(options),
    {
      checkoutAttemptId: options.checkoutAttemptId ?? "attempt_lifecycle_1",
      checkoutRequestFingerprint:
        options.checkoutRequestFingerprint ?? checkoutFingerprint(),
      checkoutAttemptCreatedAt:
        options.checkoutAttemptCreatedAt ?? attemptAt,
      now: options.checkoutAttemptCreatedAt ?? attemptAt,
    },
  );
}

function knownBilling(status = "active", options = {}) {
  const posture = billing.classifyOwnerBillingRawStripeStatus(status);
  assert.notEqual(posture, "unknown");
  return billing.buildOwnerBillingStateDocument({
    ownerUid: options.ownerUid ?? ownerUid,
    ownerRecordGeneration: options.generation ?? generation,
    lifecycleState: "subscription_known",
    rawStripeStatus: status,
    billingPosture: posture,
    stripeCustomerId: options.stripeCustomerId ?? "cus_lifecycle",
    stripeSubscriptionId:
      options.stripeSubscriptionId ?? "sub_lifecycle",
    checkoutAttemptId:
      options.checkoutAttemptId ?? "attempt_lifecycle_1",
    checkoutRequestFingerprint:
      options.checkoutRequestFingerprint ?? checkoutFingerprint(),
    checkoutAttemptCreatedAt:
      options.checkoutAttemptCreatedAt ?? attemptAt,
    checkoutSessionId: options.checkoutSessionId ?? "cs_test_lifecycle",
    lastStripeEventCreated: eventCreated,
    lastStripeEventId: "evt_lifecycle",
    lastStripeEventPayloadFingerprint: eventPayloadFingerprint,
    stripeEventConflictKind: null,
    createdAt,
    updatedAt: eventAt,
  });
}

function assertLifecycleCode(action, expectedCode) {
  assert.throws(action, (error) => {
    assert.equal(error.name, "OwnerBillingLifecycleError");
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, "Owner billing lifecycle state is unavailable.");
    return true;
  });
}

test("deterministic injected entropy creates one exact bounded attempt ID", () => {
  const bytes = Uint8Array.from({length: 32}, (_, index) => index);
  const requestedSizes = [];
  const attemptId = lifecycle.generateOwnerBillingCheckoutAttemptId((size) => {
    requestedSizes.push(size);
    return bytes;
  });

  assert.equal(lifecycle.ownerBillingCheckoutAttemptByteLength, 32);
  assert.deepEqual(requestedSizes, [32]);
  assert.equal(
    attemptId,
    "attempt_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  );
  assert.equal(
    lifecycle.generateOwnerBillingCheckoutAttemptId(() => bytes),
    attemptId,
  );
  assert.notEqual(
    lifecycle.generateOwnerBillingCheckoutAttemptId(
      () => new Uint8Array(32).fill(255),
    ),
    attemptId,
  );

  assertLifecycleCode(
    () => lifecycle.generateOwnerBillingCheckoutAttemptId(
      () => new Uint8Array(31),
    ),
    "invalid_input",
  );
  assertLifecycleCode(
    () => lifecycle.generateOwnerBillingCheckoutAttemptId(() => []),
    "invalid_input",
  );
  assertLifecycleCode(
    () => lifecycle.generateOwnerBillingCheckoutAttemptId(() => {
      throw new Error("entropy unavailable");
    }),
    "invalid_input",
  );
});

test("return token and Stripe idempotency key are deterministic and domain-separated", () => {
  const attemptId =
    "attempt_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
  const material = {
    ownerUid,
    ownerRecordGeneration: generation,
    checkoutAttemptId: attemptId,
  };
  const expectedReturnToken = sha256Array([
    "bitestar.owner-billing.return-token.v1",
    ownerUid,
    generation,
    attemptId,
  ], "base64url");
  const expectedIdempotencyKey = `bsco_${sha256Array([
    "bitestar.owner-billing.stripe-idempotency.v1",
    ownerUid,
    generation,
    attemptId,
  ], "hex")}`;

  const returnToken = lifecycle.deriveOwnerBillingReturnToken(material);
  const idempotencyKey = lifecycle.ownerBillingStripeIdempotencyKey(material);
  assert.equal(returnToken, expectedReturnToken);
  assert.match(returnToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(idempotencyKey, expectedIdempotencyKey);
  assert.match(idempotencyKey, /^bsco_[a-f0-9]{64}$/u);
  assert.equal(lifecycle.deriveOwnerBillingReturnToken(material), returnToken);
  assert.equal(
    lifecycle.ownerBillingStripeIdempotencyKey(material),
    idempotencyKey,
  );
  assert.notEqual(returnToken, idempotencyKey);
  assert.equal(returnToken.includes(ownerUid), false);
  assert.equal(idempotencyKey.includes(ownerUid), false);

  for (const changed of [
    {...material, ownerUid: "another-owner-lifecycle-uid"},
    {...material, ownerRecordGeneration: generation + 1},
    {...material, checkoutAttemptId: "attempt_lifecycle_2"},
  ]) {
    assert.notEqual(
      lifecycle.deriveOwnerBillingReturnToken(changed),
      returnToken,
    );
    assert.notEqual(
      lifecycle.ownerBillingStripeIdempotencyKey(changed),
      idempotencyKey,
    );
  }
});

test("Checkout request fingerprint binds every external-request variant field", () => {
  const expected = sha256Array([
    "bitestar.owner-billing.checkout-request.v1",
    descriptor.variant,
    descriptor.priceId,
    descriptor.successBaseUrl,
    descriptor.cancelBaseUrl,
    descriptor.trialPeriodDays,
    descriptor.metadataContractVersion,
    descriptor.stripeCustomerId,
  ], "hex");
  const fingerprint = checkoutFingerprint();
  assert.equal(fingerprint, expected);
  assert.match(fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(checkoutFingerprint(), fingerprint);

  const materialChanges = [
    {variant: "compatibility"},
    {priceId: "price_coupon_monthly_v2"},
    {successBaseUrl: "https://coupon-app-29446.web.app/success-v2.html"},
    {cancelBaseUrl: "https://coupon-app-29446.web.app/cancel-v2.html"},
    {trialPeriodDays: null},
    {trialPeriodDays: 14},
    {metadataContractVersion: "bitestar.owner-billing-metadata.v2"},
    {stripeCustomerId: "cus_LifecycleRequest1"},
  ];
  const changedFingerprints = materialChanges.map((changes) =>
    checkoutFingerprint(changes));
  assert.equal(new Set(changedFingerprints).size, changedFingerprints.length);
  for (const changed of changedFingerprints) {
    assert.notEqual(changed, fingerprint);
  }

  const invalidDescriptors = [
    {variant: "future"},
    {trialPeriodDays: 0},
    {trialPeriodDays: 1.5},
    {successBaseUrl: "http://coupon-app-29446.web.app/success"},
    {successBaseUrl: `${descriptor.successBaseUrl}?token=unsafe`},
    {cancelBaseUrl: `${descriptor.cancelBaseUrl}#fragment`},
    {cancelBaseUrl: "https://user@example.com/cancel"},
    {priceId: "price/child"},
    {stripeCustomerId: "not_a_customer"},
  ];
  for (const changes of invalidDescriptors) {
    assertLifecycleCode(
      () => checkoutFingerprint(changes),
      "invalid_input",
    );
  }
});

test("exact pending and uncertain attempts reuse only within the 23-hour boundary", () => {
  const fingerprint = checkoutFingerprint();
  const pending = pendingBilling({checkoutRequestFingerprint: fingerprint});
  const atBoundary = new Date(
    attemptAt.getTime() +
      lifecycle.ownerBillingCheckoutIdempotencyMaximumAgeMilliseconds,
  );
  assert.equal(
    lifecycle.ownerBillingCheckoutIdempotencyMaximumAgeMilliseconds,
    23 * 60 * 60 * 1000,
  );

  const reusablePending = lifecycle.requireReusableOwnerBillingCheckoutAttempt({
    billingState: pending,
    checkoutRequestFingerprint: fingerprint,
    now: atBoundary,
  });
  assert.deepEqual(reusablePending, pending);
  assert.equal(reusablePending.checkoutAttemptId, "attempt_lifecycle_1");
  assert.equal(reusablePending.checkoutSessionId, null);

  const pendingWithSession = billing.recordCheckoutSession(pending, {
    checkoutSessionId: "cs_test_retryboundary",
    stripeCustomerId: "cus_retryboundary",
    now: attemptAt,
  });
  const uncertain = billing.markCheckoutUncertain(
    pendingWithSession,
    attemptAt,
  );
  const reusableUncertain =
    lifecycle.requireReusableOwnerBillingCheckoutAttempt({
      billingState: uncertain,
      checkoutRequestFingerprint: fingerprint,
      now: atBoundary,
    });
  assert.deepEqual(reusableUncertain, uncertain);
  assert.equal(reusableUncertain.lifecycleState, "unknown");
  assert.equal(reusableUncertain.checkoutAttemptId, pending.checkoutAttemptId);
  assert.equal(
    reusableUncertain.checkoutSessionId,
    "cs_test_retryboundary",
  );
  assert.equal(reusableUncertain.stripeCustomerId, "cus_retryboundary");

  assertLifecycleCode(
    () => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
      billingState: pending,
      checkoutRequestFingerprint: fingerprint,
      now: new Date(atBoundary.getTime() + 1),
    }),
    "checkout_retry_expired",
  );
  assertLifecycleCode(
    () => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
      billingState: pending,
      checkoutRequestFingerprint: fingerprint,
      now: new Date(attemptAt.getTime() - 1),
    }),
    "checkout_retry_expired",
  );
  assertLifecycleCode(
    () => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
      billingState: pending,
      checkoutRequestFingerprint: "f".repeat(64),
      now: attemptAt,
    }),
    "checkout_conflict",
  );
  assertLifecycleCode(
    () => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
      billingState: initialBilling(),
      checkoutRequestFingerprint: fingerprint,
      now: attemptAt,
    }),
    "checkout_conflict",
  );
  assertLifecycleCode(
    () => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
      billingState: knownBilling(),
      checkoutRequestFingerprint: fingerprint,
      now: eventAt,
    }),
    "checkout_conflict",
  );
  assertLifecycleCode(
    () => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
      billingState: {...pending, fingerprint: "0".repeat(64)},
      checkoutRequestFingerprint: fingerprint,
      now: attemptAt,
    }),
    "invalid_input",
  );
});

test("portal gate requires an open matching generation and exact customer", () => {
  const ownerState = openOwner();
  for (const status of ["active", "trialing", "canceled"]) {
    const billingState = knownBilling(status);
    const ownerBefore = JSON.stringify(ownerState);
    const billingBefore = JSON.stringify(billingState);
    assert.equal(
      lifecycle.requireOwnerBillingPortalGate({
        ownerState,
        billingState,
        stripeCustomerId: "cus_lifecycle",
      }),
      "cus_lifecycle",
      status,
    );
    assert.equal(JSON.stringify(ownerState), ownerBefore);
    assert.equal(JSON.stringify(billingState), billingBefore);
  }

  for (const state of ["removing", "removed"]) {
    assertLifecycleCode(
      () => lifecycle.requireOwnerBillingPortalGate({
        ownerState: openOwner({state}),
        billingState: knownBilling(),
        stripeCustomerId: "cus_lifecycle",
      }),
      "owner_not_open",
    );
  }
  for (const billingState of [
    initialBilling(),
    pendingBilling(),
    billing.markCheckoutUncertain(pendingBilling(), eventAt),
    knownBilling("active", {generation: generation + 1}),
    knownBilling("active", {ownerUid: "another-owner-lifecycle-uid"}),
  ]) {
    assertLifecycleCode(
      () => lifecycle.requireOwnerBillingPortalGate({
        ownerState,
        billingState,
        stripeCustomerId: "cus_lifecycle",
      }),
      "billing_unavailable",
    );
  }
  assertLifecycleCode(
    () => lifecycle.requireOwnerBillingPortalGate({
      ownerState,
      billingState: knownBilling(),
      stripeCustomerId: "cus_another",
    }),
    "customer_mismatch",
  );
  assertLifecycleCode(
    () => lifecycle.requireOwnerBillingPortalGate({
      ownerState,
      billingState: knownBilling(),
      stripeCustomerId: "cus_lifecycle/child",
    }),
    "invalid_input",
  );
  assertLifecycleCode(
    () => lifecycle.requireOwnerBillingPortalGate({
      ownerState: {...ownerState, fingerprint: "0".repeat(64)},
      billingState: knownBilling(),
      stripeCustomerId: "cus_lifecycle",
    }),
    "invalid_input",
  );
  assertLifecycleCode(
    () => lifecycle.requireOwnerBillingPortalGate({
      ownerState,
      billingState: {
        ...knownBilling(),
        fingerprint: "0".repeat(64),
      },
      stripeCustomerId: "cus_lifecycle",
    }),
    "invalid_input",
  );
});

test("authoritative resolver is inactive only for strict terminal local state", () => {
  const ownerState = openOwner();
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      ownerState,
      initialBilling(),
    ),
    "inactive",
  );
  for (const status of ["canceled", "incomplete_expired"]) {
    assert.equal(
      billing.resolveAuthoritativeOwnerBillingPosture(
        ownerState,
        knownBilling(status),
      ),
      "inactive",
      status,
    );
  }
  for (const status of [
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "incomplete",
    "paused",
  ]) {
    assert.equal(
      billing.resolveAuthoritativeOwnerBillingPosture(
        ownerState,
        knownBilling(status),
      ),
      "blocking",
      status,
    );
  }
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      ownerState,
      pendingBilling(),
    ),
    "blocking",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      ownerState,
      billing.markCheckoutUncertain(pendingBilling(), eventAt),
    ),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(null, initialBilling()),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(ownerState, null),
    "unknown",
  );
  assert.equal(
    billing.resolveAuthoritativeOwnerBillingPosture(
      openOwner({generation: generation + 1}),
      initialBilling(),
    ),
    "unknown",
  );
});

test("root-delete cleanup remains an explicit same-UID reactivation hazard", () => {
  const indexSource = readFileSync(
    resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const startMarker =
    "export const cleanupDeletedRestaurantCoupons = onDocumentDeleted(";
  const nextMarker =
    "export const maintainBiteScoreRestaurantGeohash = onDocumentWritten(";
  const start = indexSource.indexOf(startMarker);
  const end = indexSource.indexOf(nextMarker, start);
  assert.notEqual(start, -1, "cleanup trigger must remain source-identifiable");
  assert.notEqual(end, -1, "cleanup trigger must have a bounded source block");
  const cleanupSource = indexSource.slice(start, end);

  assert.match(
    cleanupSource,
    /export const cleanupDeletedRestaurantCoupons = onDocumentDeleted\(\s*"restaurant_accounts\/\{uid\}"/u,
  );
  assert.match(
    cleanupSource,
    /const uid = event\.params\.uid as string;/u,
  );
  assert.match(
    cleanupSource,
    /event\.data\?\.ref \?\? db\.collection\("restaurant_accounts"\)\.doc\(uid\)/u,
  );

  const recursivelyDeletedChildren = [...cleanupSource.matchAll(
    /await db\.recursiveDelete\(\s*accountRef\.collection\("([^"]+)"\)\s*,?\s*\)\s*;/gu,
  )].map((match) => match[1]);
  assert.deepEqual(recursivelyDeletedChildren, [
    "coupons",
    "coupon_number_reservations",
    "coupon_code_reservations",
  ]);
  assert.equal(
    cleanupSource.match(/\brecursiveDelete\s*\(/gu)?.length,
    3,
  );

  assert.doesNotMatch(
    cleanupSource,
    /ownerRecordGeneration|owner_record_generation|private_owner_record_states|ownerRecordState|generation/u,
  );
  assert.doesNotMatch(cleanupSource, /\.get\s*\(|runTransaction\s*\(/u);
  assert.doesNotMatch(cleanupSource, /event\.data\?\.before|\.data\s*\(\)/u);

  // This delayed root-delete trigger has no generation fence or source read.
  // It cannot safely coexist with same-UID reactivation until it is retired or
  // made generation-aware; an old invocation must never delete newer-generation
  // children belonging to a deliberately reactivated owner.
});
