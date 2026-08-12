import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";

import {
  OwnerRecordRemovalContractError,
  buildOwnerRecordRemovalJobDocument,
  createEmptyOwnerRecordRemovalCounters,
  createOwnerRecordRemovalCallerFingerprint,
  createOwnerRecordRemovalJobId,
  nextOwnerRecordRemovalPhase,
  ownerRecordRemovalCounterFields,
  ownerRecordRemovalCounterForPhase,
  ownerRecordRemovalFailureCategories,
  ownerRecordRemovalJobCollection,
  ownerRecordRemovalJobPath,
  ownerRecordRemovalJobVersion,
  ownerRecordRemovalOperation,
  ownerRecordRemovalPhases,
  ownerRecordRemovalStatuses,
  parseOwnerRecordRemovalClaimRequest,
  parseOwnerRecordRemovalJobDocument,
  parseOwnerRecordRemovalResumeRequest,
  rebuildOwnerRecordRemovalJobDocument,
  requireOwnerRecordRemovalJobId,
  requireOwnerRecordRemovalRequestId,
} from "../lib/owner_record_removal_contract.js";

const targetUid = "owner_contract_target_1";
const callerUid = "admin_contract_caller_1";
const requestId = "request_contract_1";
const sourceGeneration = 7;
const completionGeneration = 8;
const createdAt = new Date("2026-08-12T14:00:00.000Z");

function expectContractError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof OwnerRecordRemovalContractError);
    assert.equal(error.code, code);
    return true;
  });
}

function baseCore(overrides = {}) {
  return {
    operation: ownerRecordRemovalOperation,
    jobId: createOwnerRecordRemovalJobId({targetUid, sourceGeneration}),
    requestId,
    callerFingerprint: createOwnerRecordRemovalCallerFingerprint(callerUid),
    targetUid,
    status: "active",
    phase: "unclaim_rating_restaurants",
    sourceGeneration,
    completionGeneration,
    cutoverApplied: true,
    billingGateCategory: "inactive",
    failureCategory: null,
    ...createEmptyOwnerRecordRemovalCounters(),
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildOwnerRecordRemovalJobDocument(baseCore(overrides));
}

function stored(document, overrides = {}) {
  return {
    id: document.jobId,
    data: {...document, ...overrides},
  };
}

test("contract exposes the exact fixed namespace, version, operation, statuses, phases, failures, and counters", () => {
  assert.equal(
    ownerRecordRemovalJobCollection,
    "private_owner_record_removal_jobs",
  );
  assert.equal(
    ownerRecordRemovalJobVersion,
    "bitestar.owner-record-removal-job.v1",
  );
  assert.equal(ownerRecordRemovalOperation, "ownerRecordRemoval");
  assert.deepEqual(ownerRecordRemovalStatuses, [
    "active",
    "retryable",
    "manual_review_required",
    "complete",
  ]);
  assert.deepEqual(ownerRecordRemovalPhases, [
    "billing_gate",
    "unclaim_rating_restaurants",
    "delete_coupons",
    "delete_daily_specials",
    "delete_coupon_number_reservations",
    "delete_coupon_code_reservations",
    "delete_account_menu_images",
    "delete_account_menu_items",
    "delete_account_menu_sections",
    "delete_storage_restaurant_images",
    "delete_storage_coupon_images",
    "delete_storage_menu_images",
    "delete_subscription_return_state",
    "delete_account_root",
    "verify_remnants",
    "finalize_owner_state",
    "complete",
  ]);
  assert.deepEqual(ownerRecordRemovalFailureCategories, [
    "billing_resolution_required",
    "billing_state_unknown",
    "temporary_dependency",
    "operation_conflict",
    "malformed_private_state",
    "self_target_forbidden",
    "target_admin_forbidden",
    "generation_mismatch",
    "generation_exhausted",
    "restaurant_lock_conflict",
    "newer_generation_record_found",
    "record_generation_missing",
    "storage_generation_mismatch",
    "unsupported_partial_state",
  ]);
  assert.deepEqual(ownerRecordRemovalCounterFields, [
    "ratingRestaurantsUnclaimed",
    "couponsDeleted",
    "dailySpecialsDeleted",
    "couponNumberReservationsDeleted",
    "couponCodeReservationsDeleted",
    "accountMenuImagesDeleted",
    "accountMenuItemsDeleted",
    "accountMenuSectionsDeleted",
    "storageRestaurantImagesDeleted",
    "storageCouponImagesDeleted",
    "storageMenuImagesDeleted",
    "subscriptionReturnDocumentsDeleted",
    "accountRootsDeleted",
  ]);
});

test("job identity is deterministic over version, operation, target, and source generation but excludes request and caller", () => {
  const expected = createHash("sha256").update(JSON.stringify([
    "bitestar.owner-record-removal-job-id.v1",
    ownerRecordRemovalJobVersion,
    ownerRecordRemovalOperation,
    targetUid,
    sourceGeneration,
  ]), "utf8").digest("hex");
  const first = createOwnerRecordRemovalJobId({targetUid, sourceGeneration});
  const second = createOwnerRecordRemovalJobId({targetUid, sourceGeneration});
  assert.equal(first, expected);
  assert.equal(second, first);
  assert.notEqual(
    createOwnerRecordRemovalJobId({targetUid: `${targetUid}_other`, sourceGeneration}),
    first,
  );
  assert.notEqual(
    createOwnerRecordRemovalJobId({targetUid, sourceGeneration: sourceGeneration + 1}),
    first,
  );
  assert.equal(ownerRecordRemovalJobPath(first), `${ownerRecordRemovalJobCollection}/${first}`);
  assert.equal(requireOwnerRecordRemovalJobId(first), first);
});

test("caller fingerprint is domain-separated and never stores the raw UID", () => {
  const fingerprint = createOwnerRecordRemovalCallerFingerprint(callerUid);
  assert.match(fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(fingerprint.includes(callerUid), false);
  assert.equal(
    fingerprint,
    createHash("sha256").update(JSON.stringify([
      "bitestar.owner-record-removal-caller-fingerprint.v1",
      callerUid,
    ]), "utf8").digest("hex"),
  );
  assert.notEqual(
    fingerprint,
    createOwnerRecordRemovalCallerFingerprint(`${callerUid}_other`),
  );
});

test("claim and resume request parsers require exact keys, exact operation, exact UIDs, and no client isAdmin", () => {
  const claim = {
    contractVersion: ownerRecordRemovalJobVersion,
    operation: ownerRecordRemovalOperation,
    requestId,
    callerUid,
    targetUid,
  };
  assert.deepEqual(parseOwnerRecordRemovalClaimRequest(claim), claim);
  const jobId = createOwnerRecordRemovalJobId({targetUid, sourceGeneration});
  assert.deepEqual(parseOwnerRecordRemovalResumeRequest({...claim, jobId}), {
    ...claim,
    jobId,
  });

  for (const invalid of [
    {...claim, operation: "deleteUser"},
    {...claim, contractVersion: "legacy"},
    {...claim, isAdmin: true},
    {...claim, targetUid: "bad/uid"},
    {...claim, callerUid: "."},
    {...claim, requestId: " bad"},
    {...claim, requestId: "bad/request"},
  ]) {
    expectContractError(
      () => parseOwnerRecordRemovalClaimRequest(invalid),
      "invalid-request",
    );
  }
  expectContractError(
    () => parseOwnerRecordRemovalResumeRequest(claim),
    "invalid-request",
  );
  expectContractError(
    () => parseOwnerRecordRemovalResumeRequest({...claim, jobId: "not-a-job"}),
    "invalid-request",
  );
});

test("request and UID identities are exact and never trim into another identity", () => {
  assert.equal(requireOwnerRecordRemovalRequestId(requestId), requestId);
  for (const invalid of ["", ".", "..", "bad/id", " leading", "trailing ", "a\u0000b"]) {
    expectContractError(
      () => requireOwnerRecordRemovalRequestId(invalid),
      "invalid-request",
    );
  }
  for (const invalid of ["", ".", "..", "bad/uid", "a\u0000b"]) {
    expectContractError(
      () => createOwnerRecordRemovalJobId({
        targetUid: invalid,
        sourceGeneration,
      }),
      "invalid-request",
    );
  }
});

test("every legal billing-gate, processing, retry, manual, and terminal matrix parses", () => {
  for (const [billingGateCategory, failureCategory] of [
    ["blocking", "billing_resolution_required"],
    ["unknown", "billing_state_unknown"],
  ]) {
    const document = build({
      status: "manual_review_required",
      phase: "billing_gate",
      completionGeneration: null,
      cutoverApplied: false,
      billingGateCategory,
      failureCategory,
    });
    assert.deepEqual(parseOwnerRecordRemovalJobDocument(stored(document)), document);
  }

  for (const phase of ownerRecordRemovalPhases.slice(1, -1)) {
    for (const [status, failureCategory] of [
      ["active", null],
      ["retryable", "temporary_dependency"],
      ["manual_review_required", "unsupported_partial_state"],
    ]) {
      const document = build({phase, status, failureCategory});
      assert.deepEqual(
        parseOwnerRecordRemovalJobDocument(stored(document)),
        document,
        `${phase}/${status}`,
      );
    }
  }

  const completedAt = new Date(createdAt.getTime() + 1_000);
  const complete = build({
    status: "complete",
    phase: "complete",
    updatedAt: completedAt,
    completedAt,
  });
  assert.deepEqual(parseOwnerRecordRemovalJobDocument(stored(complete)), complete);
});

test("strict parser distinguishes absent from malformed-present and validates exact identity and fingerprint", () => {
  assert.equal(parseOwnerRecordRemovalJobDocument(null), null);
  const document = build();
  assert.deepEqual(parseOwnerRecordRemovalJobDocument(stored(document)), document);

  for (const fixture of [
    stored(document, {version: "legacy"}),
    stored(document, {operation: "deleteUser"}),
    stored(document, {status: "paused"}),
    stored(document, {phase: "delete_profiles"}),
    stored(document, {targetUid: "bad/uid"}),
    stored(document, {sourceGeneration: -1}),
    stored(document, {completionGeneration: 9}),
    stored(document, {ratingRestaurantsUnclaimed: 1.5}),
    stored(document, {ratingRestaurantsUnclaimed: Number.MAX_SAFE_INTEGER + 1}),
    stored(document, {createdAt: "yesterday"}),
    stored(document, {fingerprint: "0".repeat(64)}),
    {...stored(document), id: "0".repeat(64)},
    {id: document.jobId, data: {...document, extra: true}},
    {id: document.jobId, data: Object.assign([], document)},
  ]) {
    expectContractError(
      () => parseOwnerRecordRemovalJobDocument(fixture),
      "invalid-state",
    );
  }
});

test("Firestore Timestamp-like values parse to defensive Date copies", () => {
  const document = build();
  const timestamp = {
    toDate() {
      return new Date(createdAt.getTime());
    },
  };
  const core = {...document, createdAt: timestamp, updatedAt: timestamp};
  delete core.version;
  delete core.fingerprint;
  const rebuilt = buildOwnerRecordRemovalJobDocument(core);
  assert.ok(rebuilt.createdAt instanceof Date);
  assert.ok(rebuilt.updatedAt instanceof Date);
  assert.notEqual(rebuilt.createdAt, createdAt);
});

test("phase, cutover, billing, failure, completion, and direct-counter contradictions fail closed", () => {
  const invalidCores = [
    baseCore({phase: "billing_gate"}),
    baseCore({
      phase: "billing_gate",
      status: "manual_review_required",
      completionGeneration: null,
      cutoverApplied: false,
      billingGateCategory: "inactive",
      failureCategory: "billing_state_unknown",
    }),
    baseCore({
      phase: "billing_gate",
      status: "manual_review_required",
      completionGeneration: null,
      cutoverApplied: false,
      billingGateCategory: "blocking",
      failureCategory: "billing_state_unknown",
    }),
    baseCore({
      phase: "billing_gate",
      status: "manual_review_required",
      completionGeneration: null,
      cutoverApplied: false,
      billingGateCategory: "blocking",
      failureCategory: "billing_resolution_required",
      couponsDeleted: 1,
    }),
    baseCore({cutoverApplied: false}),
    baseCore({billingGateCategory: "blocking"}),
    baseCore({status: "retryable", failureCategory: null}),
    baseCore({status: "active", failureCategory: "temporary_dependency"}),
    baseCore({
      status: "manual_review_required",
      failureCategory: "billing_resolution_required",
    }),
    baseCore({
      status: "manual_review_required",
      failureCategory: "billing_state_unknown",
    }),
    baseCore({status: "complete", phase: "finalize_owner_state"}),
    baseCore({phase: "complete", completedAt: createdAt}),
    baseCore({completedAt: createdAt}),
  ];
  for (const core of invalidCores) {
    expectContractError(
      () => buildOwnerRecordRemovalJobDocument(core),
      "invalid-request",
    );
  }
  for (const counters of [
    {subscriptionReturnDocumentsDeleted: 2},
    {accountRootsDeleted: 2},
  ]) {
    assert.doesNotThrow(() => buildOwnerRecordRemovalJobDocument(
      baseCore(counters),
    ));
  }
  expectContractError(
    () => buildOwnerRecordRemovalJobDocument(baseCore({
      sourceGeneration: Number.MAX_SAFE_INTEGER,
      completionGeneration: Number.MAX_SAFE_INTEGER,
      jobId: createOwnerRecordRemovalJobId({
        targetUid,
        sourceGeneration: Number.MAX_SAFE_INTEGER,
      }),
    })),
    "invalid-request",
  );
});

test("next-phase and exact phase-counter helpers exhaustively map the finite state machine", () => {
  const expectedCounters = [
    null,
    "ratingRestaurantsUnclaimed",
    "couponsDeleted",
    "dailySpecialsDeleted",
    "couponNumberReservationsDeleted",
    "couponCodeReservationsDeleted",
    "accountMenuImagesDeleted",
    "accountMenuItemsDeleted",
    "accountMenuSectionsDeleted",
    "storageRestaurantImagesDeleted",
    "storageCouponImagesDeleted",
    "storageMenuImagesDeleted",
    "subscriptionReturnDocumentsDeleted",
    "accountRootsDeleted",
    null,
    null,
    null,
  ];
  for (const [index, phase] of ownerRecordRemovalPhases.entries()) {
    assert.equal(
      nextOwnerRecordRemovalPhase(phase),
      ownerRecordRemovalPhases[index + 1] ?? null,
      phase,
    );
    assert.equal(
      ownerRecordRemovalCounterForPhase(phase),
      expectedCounters[index],
      phase,
    );
  }
  expectContractError(
    () => nextOwnerRecordRemovalPhase("future_phase"),
    "invalid-request",
  );
});

test("validated rebuild preserves immutable identity, monotonic counters, fingerprints, and legal transitions", () => {
  const current = build();
  const later = new Date(createdAt.getTime() + 1_000);
  const progressed = rebuildOwnerRecordRemovalJobDocument(current, {
    now: later,
    phase: "delete_coupons",
    ratingRestaurantsUnclaimed: 3,
  });
  assert.equal(progressed.jobId, current.jobId);
  assert.equal(progressed.requestId, current.requestId);
  assert.equal(progressed.callerFingerprint, current.callerFingerprint);
  assert.equal(progressed.targetUid, current.targetUid);
  assert.equal(progressed.ratingRestaurantsUnclaimed, 3);
  assert.equal(progressed.phase, "delete_coupons");
  assert.notEqual(progressed.fingerprint, current.fingerprint);

  for (const updates of [
    {now: createdAt, ratingRestaurantsUnclaimed: -1},
    {now: createdAt, cutoverApplied: false},
    {now: new Date(createdAt.getTime() - 1)},
    {now: later, requestId: "replacement"},
  ]) {
    expectContractError(
      () => rebuildOwnerRecordRemovalJobDocument(current, updates),
      "invalid-request",
    );
  }

  const completedAt = new Date(createdAt.getTime() + 2_000);
  const finalizing = rebuildOwnerRecordRemovalJobDocument(progressed, {
    now: new Date(createdAt.getTime() + 1_500),
    phase: "finalize_owner_state",
  });
  const complete = rebuildOwnerRecordRemovalJobDocument(finalizing, {
    now: completedAt,
    status: "complete",
    phase: "complete",
    completedAt,
  });
  for (const invalidCurrent of [current, progressed]) {
    expectContractError(
      () => rebuildOwnerRecordRemovalJobDocument(invalidCurrent, {
        now: completedAt,
        status: "complete",
        phase: "complete",
        failureCategory: null,
        completedAt,
      }),
      "invalid-request",
    );
  }
  expectContractError(
    () => rebuildOwnerRecordRemovalJobDocument(complete, {
      now: new Date(completedAt.getTime() + 1),
    }),
    "invalid-request",
  );
});

test("job schema is flat, fixed, bounded, and contains no sensitive or arbitrary payload field", () => {
  const document = build({
    ratingRestaurantsUnclaimed: 120,
    couponsDeleted: 200,
  });
  const expectedKeys = [
    "version",
    "operation",
    "jobId",
    "requestId",
    "callerFingerprint",
    "targetUid",
    "status",
    "phase",
    "sourceGeneration",
    "completionGeneration",
    "cutoverApplied",
    "billingGateCategory",
    "failureCategory",
    ...ownerRecordRemovalCounterFields,
    "createdAt",
    "updatedAt",
    "completedAt",
    "fingerprint",
  ].sort();
  assert.deepEqual(Object.keys(document).sort(), expectedKeys);
  for (const forbidden of [
    "email",
    "phone",
    "profile",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "cursor",
    "continuation",
    "metadata",
    "errors",
    "items",
  ]) {
    assert.equal(Object.hasOwn(document, forbidden), false, forbidden);
  }
  assert.equal(
    Object.values(document).some((value) => Array.isArray(value)),
    false,
  );
  assert.equal(
    Object.values(document).some(
      (value) => value !== null && typeof value === "object" &&
        !(value instanceof Date),
    ),
    false,
  );
});
