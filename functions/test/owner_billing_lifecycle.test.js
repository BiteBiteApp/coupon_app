"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");
const test = require("node:test");

const billing = require("../lib/owner_billing_state_contract.js");
const lifecycle = require("../lib/owner_billing_lifecycle.js");

const ownerUid = "owner-lifecycle-uid";
const createdAt = new Date("2026-08-12T00:00:00.000Z");
const attemptAt = new Date("2026-08-12T00:01:00.000Z");
const eventAt = new Date("2026-08-12T00:02:00.000Z");

const descriptor = Object.freeze({
  variant: "primary",
  priceId: "price_coupon_monthly",
  successBaseUrl: "https://coupon-app-29446.web.app/stripe-success.html",
  cancelBaseUrl: "https://coupon-app-29446.web.app/stripe-cancel.html",
  trialPeriodDays: 60,
  metadataContractVersion: "bitestar.owner-billing-metadata.v2",
  stripeCustomerId: null,
});

function sha256Array(parts, encoding) {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest(encoding);
}

function checkoutFingerprint(changes = {}) {
  return lifecycle.ownerBillingCheckoutRequestFingerprint({...descriptor, ...changes});
}

function pendingBilling() {
  return billing.createCheckoutPendingOwnerBillingState(
    billing.createInitialOwnerBillingState(ownerUid, createdAt),
    {
      checkoutAttemptId: "attempt_lifecycle_1",
      checkoutRequestFingerprint: checkoutFingerprint(),
      checkoutAttemptCreatedAt: attemptAt,
      now: attemptAt,
    },
  );
}

function knownBilling(changes = {}) {
  return billing.buildOwnerBillingStateDocument({
    ownerUid,
    lifecycleState: "subscription_known",
    rawStripeStatus: "active",
    billingPosture: "blocking",
    stripeCustomerId: "cus_lifecycle",
    stripeSubscriptionId: "sub_lifecycle",
    checkoutAttemptId: "attempt_lifecycle_1",
    checkoutRequestFingerprint: checkoutFingerprint(),
    checkoutAttemptCreatedAt: attemptAt,
    checkoutSessionId: "cs_test_lifecycle",
    lastStripeEventCreated: 1_786_492_920,
    lastStripeEventId: "evt_lifecycle",
    lastStripeEventPayloadFingerprint: "e".repeat(64),
    stripeEventConflictKind: null,
    createdAt,
    updatedAt: eventAt,
    ...changes,
  });
}

function assertLifecycleCode(action, code) {
  assert.throws(action, (error) => {
    assert.equal(error.name, "OwnerBillingLifecycleError");
    assert.equal(error.code, code);
    return true;
  });
}

test("checkout attempt IDs contain exactly 32 injected random bytes", () => {
  const bytes = Uint8Array.from({length: 32}, (_, index) => index);
  const sizes = [];
  const attemptId = lifecycle.generateOwnerBillingCheckoutAttemptId((size) => {
    sizes.push(size);
    return bytes;
  });
  assert.deepEqual(sizes, [32]);
  assert.equal(attemptId, "attempt_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
  assertLifecycleCode(
    () => lifecycle.generateOwnerBillingCheckoutAttemptId(() => new Uint8Array(31)),
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
  const material = {ownerUid, checkoutAttemptId: "attempt_lifecycle_1"};
  const token = lifecycle.deriveOwnerBillingReturnToken(material);
  const key = lifecycle.ownerBillingStripeIdempotencyKey(material);
  assert.equal(token, sha256Array([
    "bitestar.owner-billing.return-token.v2",
    ownerUid,
    material.checkoutAttemptId,
  ], "base64url"));
  assert.equal(key, `bsco_${sha256Array([
    "bitestar.owner-billing.stripe-idempotency.v2",
    ownerUid,
    material.checkoutAttemptId,
  ], "hex")}`);
  assert.notEqual(token, key.slice("bsco_".length));
  assert.equal(lifecycle.deriveOwnerBillingReturnToken(material), token);
  assert.notEqual(
    lifecycle.deriveOwnerBillingReturnToken({...material, checkoutAttemptId: "attempt_lifecycle_2"}),
    token,
  );
  assert.notEqual(
    lifecycle.deriveOwnerBillingReturnToken({...material, ownerUid: "other-owner"}),
    token,
  );
  assert.notEqual(
    lifecycle.ownerBillingStripeIdempotencyKey({...material, ownerUid: "other-owner"}),
    key,
  );
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(key, /^bsco_[a-f0-9]{64}$/u);
  assert.equal(token.includes(ownerUid), false);
  assert.equal(key.includes(ownerUid), false);
});

test("Checkout request fingerprint binds every external request field", () => {
  const baseline = checkoutFingerprint();
  assert.equal(baseline, sha256Array([
    "bitestar.owner-billing.checkout-request.v1",
    descriptor.variant,
    descriptor.priceId,
    descriptor.successBaseUrl,
    descriptor.cancelBaseUrl,
    descriptor.trialPeriodDays,
    descriptor.metadataContractVersion,
    descriptor.stripeCustomerId,
  ], "hex"));
  for (const changes of [
    {variant: "compatibility"},
    {priceId: "price_other"},
    {successBaseUrl: "https://coupon-app-29446.web.app/other-success.html"},
    {cancelBaseUrl: "https://coupon-app-29446.web.app/other-cancel.html"},
    {trialPeriodDays: null},
    {metadataContractVersion: "other-contract"},
    {stripeCustomerId: "cus_other"},
  ]) {
    assert.notEqual(checkoutFingerprint(changes), baseline);
  }
  for (const changes of [
    {variant: "future"},
    {trialPeriodDays: 0},
    {trialPeriodDays: 1.5},
    {successBaseUrl: "http://coupon-app-29446.web.app/success"},
    {successBaseUrl: `${descriptor.successBaseUrl}?token=unsafe`},
    {cancelBaseUrl: `${descriptor.cancelBaseUrl}#fragment`},
    {cancelBaseUrl: "https://user@example.com/cancel"},
    {priceId: "price/child"},
    {stripeCustomerId: "not_a_customer"},
  ]) {
    assertLifecycleCode(
      () => checkoutFingerprint(changes),
      "invalid_input",
    );
  }
});

test("exact pending and uncertain attempts reuse only inside the 23-hour window", () => {
  const pending = pendingBilling();
  assert.equal(
    lifecycle.ownerBillingCheckoutIdempotencyMaximumAgeMilliseconds,
    23 * 60 * 60 * 1000,
  );
  assert.equal(lifecycle.requireReusableOwnerBillingCheckoutAttempt({
    billingState: pending,
    checkoutRequestFingerprint: checkoutFingerprint(),
    now: new Date(attemptAt.getTime() + 22 * 60 * 60 * 1000),
  }).checkoutAttemptId, "attempt_lifecycle_1");
  const uncertain = billing.markCheckoutUncertain(pending, eventAt);
  assert.equal(lifecycle.requireReusableOwnerBillingCheckoutAttempt({
    billingState: uncertain,
    checkoutRequestFingerprint: checkoutFingerprint(),
    now: new Date(attemptAt.getTime() + 23 * 60 * 60 * 1000),
  }).checkoutAttemptId, "attempt_lifecycle_1");
  assertLifecycleCode(() => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
    billingState: pending,
    checkoutRequestFingerprint: "f".repeat(64),
    now: eventAt,
  }), "checkout_conflict");
  assertLifecycleCode(() => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
    billingState: pending,
    checkoutRequestFingerprint: checkoutFingerprint(),
    now: new Date(attemptAt.getTime() + 23 * 60 * 60 * 1000 + 1),
  }), "checkout_retry_expired");
  assertLifecycleCode(() => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
    billingState: pending,
    checkoutRequestFingerprint: checkoutFingerprint(),
    now: new Date(attemptAt.getTime() - 1),
  }), "checkout_retry_expired");
  for (const billingState of [
    billing.createInitialOwnerBillingState(ownerUid, createdAt),
    knownBilling(),
  ]) {
    assertLifecycleCode(
      () => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
        billingState,
        checkoutRequestFingerprint: checkoutFingerprint(),
        now: eventAt,
      }),
      "checkout_conflict",
    );
  }
  assertLifecycleCode(() => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
    billingState: {...pending, fingerprint: "0".repeat(64)},
    checkoutRequestFingerprint: checkoutFingerprint(),
    now: eventAt,
  }), "invalid_input");
  assertLifecycleCode(() => lifecycle.requireReusableOwnerBillingCheckoutAttempt({
    billingState: pending,
    checkoutRequestFingerprint: checkoutFingerprint(),
    now: new Date("invalid"),
  }), "invalid_input");
});

test("portal gate requires exact owner, known subscription, and exact customer", () => {
  assert.equal(lifecycle.requireOwnerBillingPortalGate({
    ownerUid,
    billingState: knownBilling(),
    stripeCustomerId: "cus_lifecycle",
  }), "cus_lifecycle");
  assertLifecycleCode(() => lifecycle.requireOwnerBillingPortalGate({
    ownerUid: "other-owner",
    billingState: knownBilling(),
    stripeCustomerId: "cus_lifecycle",
  }), "billing_unavailable");
  assertLifecycleCode(() => lifecycle.requireOwnerBillingPortalGate({
    ownerUid,
    billingState: pendingBilling(),
    stripeCustomerId: "cus_lifecycle",
  }), "billing_unavailable");
  assertLifecycleCode(() => lifecycle.requireOwnerBillingPortalGate({
    ownerUid,
    billingState: knownBilling(),
    stripeCustomerId: "cus_other",
  }), "customer_mismatch");
  assert.equal(lifecycle.requireOwnerBillingPortalGate({
    ownerUid,
    billingState: knownBilling({
      rawStripeStatus: "canceled",
      billingPosture: "inactive",
    }),
    stripeCustomerId: "cus_lifecycle",
  }), "cus_lifecycle");
  assertLifecycleCode(() => lifecycle.requireOwnerBillingPortalGate({
    ownerUid,
    billingState: knownBilling(),
    stripeCustomerId: "cus_lifecycle/child",
  }), "invalid_input");
  assertLifecycleCode(() => lifecycle.requireOwnerBillingPortalGate({
    ownerUid,
    billingState: {...knownBilling(), fingerprint: "0".repeat(64)},
    stripeCustomerId: "cus_lifecycle",
  }), "invalid_input");
  assertLifecycleCode(() => lifecycle.requireOwnerBillingPortalGate({
    ownerUid,
    billingState: {...knownBilling(), stripeSubscriptionId: null},
    stripeCustomerId: "cus_lifecycle",
  }), "invalid_input");
});

test("root-delete cleanup remains exported as an explicit no-op", () => {
  const source = readFileSync(resolve(__dirname, "../src/index.ts"), "utf8");
  const start = source.indexOf("export const cleanupDeletedRestaurantCoupons");
  const end = source.indexOf("export const maintainBiteScoreRestaurantGeohash", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const cleanup = source.slice(start, end);
  assert.match(cleanup, /onDocumentDeleted\(\s*"restaurant_accounts\/\{uid\}",\s*async \(\) => \{\s*\},\s*\);/u);
  assert.doesNotMatch(
    cleanup,
    /\brecursiveDelete\s*\(|\bdb\s*\.|\bevent\s*\.|\blogger\s*\./u,
  );
  assert.doesNotMatch(
    cleanup,
    /\.collection\s*\(|\.doc\s*\(|\.get\s*\(|\.set\s*\(|\.update\s*\(|\.delete\s*\(|\.create\s*\(|\.add\s*\(|runTransaction\s*\(|\.batch\s*\(/u,
  );
  assert.doesNotMatch(
    cleanup,
    /getFirestore\s*\(|getStorage\s*\(|getAuth\s*\(|\bstripe\s*\./u,
  );
});
