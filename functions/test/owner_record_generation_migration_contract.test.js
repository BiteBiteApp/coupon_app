"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require(
  "../lib/owner_record_generation_migration_contract.js",
);

const ownerUid = "migration-owner";
const generatedAt = "2026-08-12T12:00:00.000Z";

function completePagination(scope = "coupons", overrides = {}) {
  return {
    scope,
    complete: true,
    nextCursor: null,
    pagesRead: 1,
    recordsRead: 0,
    ...overrides,
  };
}

function completeInventoryPagination() {
  return contract.ownerRecordGenerationMigrationPaginationScopes.map(
    (scope) => completePagination(scope),
  );
}

function incompleteInventoryPagination(scope, nextCursor, recordsRead) {
  return completeInventoryPagination().map((entry) =>
    entry.scope === scope
      ? completePagination(scope, {
        complete: false,
        nextCursor,
        recordsRead,
      })
      : entry);
}

function createOwnerOperation(overrides = {}) {
  return {
    operation: "create_owner_state",
    documentPath: "private_owner_record_states/" + ownerUid,
    ownerRecordGeneration: 0,
    existingGeneration: null,
    precondition: {kind: "must_not_exist"},
    ...overrides,
  };
}

function firestoreOperation(overrides = {}) {
  return {
    operation: "stamp_firestore_document",
    scope: "account_root",
    documentPath: "restaurant_accounts/" + ownerUid,
    ownerRecordGeneration: 0,
    existingGeneration: null,
    precondition: {
      kind: "update_time",
      updateTime: {seconds: "1786536000", nanoseconds: 123456789},
    },
    ...overrides,
  };
}

function storageOperation(overrides = {}) {
  return {
    operation: "stamp_storage_object_metadata",
    storageKind: "restaurant_images",
    objectName:
      "bitesaver_restaurants/" + ownerUid + "/restaurant_images/photo.jpg",
    ownerRecordGeneration: "0",
    existingGeneration: null,
    providerGeneration: "1786536000123456",
    metageneration: "7",
    ...overrides,
  };
}

function reason(code = "owner_state_malformed", overrides = {}) {
  return {
    code,
    documentPath: null,
    storageObjectName: null,
    existingGeneration: null,
    ...overrides,
  };
}

function legacyInput(overrides = {}) {
  return {
    schemaVersion: contract.ownerRecordGenerationMigrationPlanVersion,
    projectId: "coupon-app-29446",
    generatedAt,
    plannerVersion: contract.ownerRecordGenerationMigrationPlannerVersion,
    sourceCheckpointCommit:
      contract.ownerRecordGenerationMigrationSourceCheckpointCommit,
    ownerUid,
    canonicalAccountPath: "restaurant_accounts/" + ownerUid,
    classification: "legacy_safe_candidate",
    proposedGeneration: 0,
    operations: [
      storageOperation(),
      firestoreOperation(),
      createOwnerOperation(),
    ],
    manualReviewReasons: [],
    pagination: completeInventoryPagination(),
    ...overrides,
  };
}

function build(overrides = {}) {
  return contract.buildOwnerRecordGenerationMigrationPlan(
    legacyInput(overrides),
  );
}

function plain(value) {
  return structuredClone(value);
}

function assertContractError(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(
      error instanceof contract.OwnerRecordGenerationMigrationContractError,
    );
    assert.equal(error.code, code);
    return true;
  });
}

test("contract publishes the fixed private migration vocabulary", () => {
  assert.equal(
    contract.ownerRecordGenerationMigrationPlanVersion,
    "bitestar.owner-record-generation-migration-plan.v1",
  );
  assert.equal(
    contract.ownerRecordGenerationMigrationSummaryVersion,
    "bitestar.owner-record-generation-migration-summary.v1",
  );
  assert.equal(
    contract.ownerRecordGenerationMigrationPlannerVersion,
    "bitestar.owner-record-generation-migration-planner.v1",
  );
  assert.equal(
    contract.ownerRecordGenerationMigrationSourceCheckpointCommit,
    "e84efab59abd04a26aae5447fe7a57eb06b27e81",
  );
  assert.equal(contract.canonicalInitialOwnerRecordGeneration, 0);
  assert.equal(
    contract.ownerRecordGenerationStorageMetadataKey,
    "ownerRecordGeneration",
  );
  assert.deepEqual(contract.ownerRecordGenerationMigrationClassifications, [
    "already_initialized",
    "legacy_safe_candidate",
    "manual_review_required",
    "blocked_active_removal",
    "no_owner_data",
  ]);
  assert.deepEqual(
    contract.ownerRecordGenerationMigrationAccountChildCollections,
    [
      "coupons",
      "daily_specials",
      "coupon_number_reservations",
      "coupon_code_reservations",
      "menu_images",
      "menu_items",
      "menu_sections",
    ],
  );
  assert.deepEqual(contract.ownerRecordGenerationMigrationStorageKinds, [
    "restaurant_images",
    "coupon_images",
    "menu_images",
  ]);
  for (const value of [
    contract.ownerRecordGenerationMigrationClassifications,
    contract.ownerRecordGenerationMigrationReasonCodes,
    contract.ownerRecordGenerationMigrationAccountChildCollections,
    contract.ownerRecordGenerationMigrationFirestoreScopes,
    contract.ownerRecordGenerationMigrationStorageKinds,
    contract.ownerRecordGenerationMigrationPaginationScopes,
  ]) {
    assert.equal(Object.isFrozen(value), true);
    assert.equal(new Set(value).size, value.length);
  }
});

test("generation zero is the sole canonical initial generation representation", () => {
  assert.equal(
    contract.requireOwnerRecordGenerationMigrationStorageGeneration("0"),
    "0",
  );
  assert.equal(
    contract.requireOwnerRecordGenerationMigrationStorageGeneration(
      String(Number.MAX_SAFE_INTEGER),
    ),
    String(Number.MAX_SAFE_INTEGER),
  );
  for (const value of [
    0,
    "",
    "-1",
    "+0",
    "00",
    "01",
    "0.0",
    " 0",
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assertContractError(
      () => contract.requireOwnerRecordGenerationMigrationStorageGeneration(
        value,
      ),
      "invalid-request",
    );
  }
});

test("provider generation and metageneration remain separate exact decimals", () => {
  for (const value of ["1", "9", "1786536000123456", "9".repeat(40)]) {
    assert.equal(
      contract.requireOwnerRecordGenerationMigrationProviderDecimal(value),
      value,
    );
  }
  for (const value of [
    1,
    "0",
    "01",
    "-1",
    "1.0",
    "9".repeat(41),
    " 1",
  ]) {
    assertContractError(
      () => contract.requireOwnerRecordGenerationMigrationProviderDecimal(
        value,
      ),
      "invalid-request",
    );
  }
});

test("project IDs and timestamps are exact and never normalized", () => {
  assert.equal(
    contract.requireOwnerRecordGenerationMigrationProjectId(
      "coupon-app-29446",
    ),
    "coupon-app-29446",
  );
  assert.equal(
    contract.requireOwnerRecordGenerationMigrationTimestamp(generatedAt),
    generatedAt,
  );
  for (const value of [
    "",
    "Coupon-App",
    "a",
    "project-",
    "-project",
    "project/name",
  ]) {
    assertContractError(
      () => contract.requireOwnerRecordGenerationMigrationProjectId(value),
      "invalid-request",
    );
  }
  for (const value of [
    new Date(generatedAt),
    "2026-08-12T12:00:00Z",
    "2026-08-12T08:00:00.000-04:00",
    "invalid",
  ]) {
    assertContractError(
      () => contract.requireOwnerRecordGenerationMigrationTimestamp(value),
      "invalid-request",
    );
  }
});

test("path builders expose only the removal foundation's exact scope", () => {
  assert.equal(
    contract.canonicalOwnerRecordGenerationMigrationAccountPath(ownerUid),
    "restaurant_accounts/" + ownerUid,
  );
  assert.equal(
    contract.canonicalOwnerRecordGenerationMigrationOwnerStatePath(ownerUid),
    "private_owner_record_states/" + ownerUid,
  );
  assert.equal(
    contract.buildOwnerRecordGenerationMigrationAccountChildPath({
      ownerUid,
      collection: "daily_specials",
      documentId: "special-1",
    }),
    "restaurant_accounts/" + ownerUid + "/daily_specials/special-1",
  );
  assert.equal(
    contract.buildOwnerRecordGenerationMigrationRatingPath("rating-1"),
    "bitescore_restaurants/rating-1",
  );
  assert.equal(
    contract.buildOwnerRecordGenerationMigrationStoragePrefix({
      ownerUid,
      storageKind: "coupon_images",
    }),
    "bitesaver_restaurants/" + ownerUid + "/coupon_images/",
  );

  for (const collection of [
    "customers",
    "restaurant_menus",
    "reports",
    "../coupons",
  ]) {
    assertContractError(
      () => contract.buildOwnerRecordGenerationMigrationAccountChildPath({
        ownerUid,
        collection,
        documentId: "record",
      }),
      "invalid-request",
    );
  }
});

test("Firestore evidence paths reject siblings and every excluded collection", () => {
  for (const documentPath of [
    "restaurant_accounts/" + ownerUid,
    "private_owner_record_states/" + ownerUid,
    "private_owner_billing_states/" + ownerUid,
    "private_subscription_return_state/" + ownerUid,
    "private_owner_record_removal_jobs/job-1",
    "bitescore_restaurants/restaurant-1",
    "restaurant_accounts/" + ownerUid + "/coupons/coupon-1",
  ]) {
    assert.equal(
      contract.requireOwnerRecordGenerationMigrationFirestorePath({
        ownerUid,
        documentPath,
      }),
      documentPath,
    );
  }
  for (const documentPath of [
    "restaurant_accounts/other-owner",
    "restaurant_accounts/" + ownerUid + "/favorites/favorite-1",
    "restaurant_menus/menu-1",
    "user_profiles/" + ownerUid,
    "restaurant_accounts/" + ownerUid + "/coupons",
    "restaurant_accounts/" + ownerUid + "/coupons/a/b",
  ]) {
    assertContractError(
      () => contract.requireOwnerRecordGenerationMigrationFirestorePath({
        ownerUid,
        documentPath,
      }),
      "invalid-request",
    );
  }
});

test("Storage names bind to one exact UID-derived prefix", () => {
  const objectName =
    "bitesaver_restaurants/" + ownerUid + "/menu_images/path/photo.webp";
  assert.equal(
    contract.requireOwnerRecordGenerationMigrationStorageObjectName({
      ownerUid,
      storageKind: "menu_images",
      objectName,
    }),
    objectName,
  );
  for (const fixture of [
    {
      storageKind: "menu_images",
      objectName: "bitesaver_restaurants/other/menu_images/photo.webp",
    },
    {
      storageKind: "restaurant_images",
      objectName,
    },
    {
      storageKind: "restaurant_menus",
      objectName,
    },
    {
      storageKind: "menu_images",
      objectName: "bitesaver_restaurants/" + ownerUid + "/menu_images/",
    },
  ]) {
    assertContractError(
      () => contract.requireOwnerRecordGenerationMigrationStorageObjectName({
        ownerUid,
        ...fixture,
      }),
      "invalid-request",
    );
  }
});

test("legacy plan is canonical, sorted, deeply bounded, and hash-valid", () => {
  const plan = build();
  assert.deepEqual(Object.keys(plan).sort(), [
    "canonicalAccountPath",
    "classification",
    "generatedAt",
    "manualReviewReasons",
    "operations",
    "ownerUid",
    "pagination",
    "planHash",
    "planId",
    "plannerVersion",
    "projectId",
    "proposedGeneration",
    "schemaVersion",
    "sourceCheckpointCommit",
  ]);
  assert.equal(plan.classification, "legacy_safe_candidate");
  assert.equal(plan.proposedGeneration, 0);
  assert.match(plan.planId, /^[a-f0-9]{64}$/u);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    plan.operations.map((entry) => entry.operation),
    [
      "create_owner_state",
      "stamp_firestore_document",
      "stamp_storage_object_metadata",
    ],
  );
  assert.deepEqual(
    new Set(plan.pagination.map((entry) => entry.scope)),
    new Set(contract.ownerRecordGenerationMigrationPaginationScopes),
  );
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.operations), true);
  assert.equal(Object.isFrozen(plan.operations[0]), true);
  assert.equal(Object.isFrozen(plan.pagination), true);
  assert.deepEqual(
    contract.parseOwnerRecordGenerationMigrationPlan(plain(plan)),
    plan,
  );
});

test("inventory order does not affect deterministic plan identity", () => {
  const first = build();
  const second = build({
    operations: [...legacyInput().operations].reverse(),
    pagination: [...legacyInput().pagination].reverse(),
  });
  assert.deepEqual(first, second);
  assert.equal(
    contract.createOwnerRecordGenerationMigrationPlanId(legacyInput()),
    first.planId,
  );
});

test("generatedAt changes integrity hash but not semantic plan ID", () => {
  const first = build();
  const second = build({generatedAt: "2026-08-12T12:00:01.000Z"});
  assert.equal(first.planId, second.planId);
  assert.notEqual(first.planHash, second.planHash);
});

test("every semantic operation or precondition change changes both hashes", () => {
  const first = build();
  const changedUpdateTime = firestoreOperation({
    precondition: {
      kind: "update_time",
      updateTime: {seconds: "1786536000", nanoseconds: 123456790},
    },
  });
  const second = build({
    operations: [
      createOwnerOperation(),
      changedUpdateTime,
      storageOperation(),
    ],
  });
  assert.notEqual(first.planId, second.planId);
  assert.notEqual(first.planHash, second.planHash);
});

test("plan parser rejects top-level and nested extension fields", () => {
  const plan = plain(build());
  assertContractError(
    () => contract.parseOwnerRecordGenerationMigrationPlan({
      ...plan,
      authorization: true,
    }),
    "invalid-state",
  );
  const nested = plain(plan);
  nested.operations[0].payload = "forbidden";
  assertContractError(
    () => contract.parseOwnerRecordGenerationMigrationPlan(nested),
    "invalid-state",
  );
  const nestedPrecondition = plain(plan);
  nestedPrecondition.operations[1].precondition.authorization = true;
  assertContractError(
    () => contract.parseOwnerRecordGenerationMigrationPlan(
      nestedPrecondition,
    ),
    "invalid-state",
  );
  const nestedPagination = plain(plan);
  nestedPagination.pagination[0].providerToken = "forbidden";
  assertContractError(
    () => contract.parseOwnerRecordGenerationMigrationPlan(nestedPagination),
    "invalid-state",
  );
  const manual = plain(build({
    classification: "manual_review_required",
    proposedGeneration: null,
    operations: [],
    manualReviewReasons: [reason()],
  }));
  manual.manualReviewReasons[0].detail = "forbidden";
  assertContractError(
    () => contract.parseOwnerRecordGenerationMigrationPlan(manual),
    "invalid-state",
  );
  const symbolic = plain(plan);
  symbolic.operations[0][Symbol("hidden")] = true;
  assertContractError(
    () => contract.parseOwnerRecordGenerationMigrationPlan(symbolic),
    "invalid-state",
  );
});

test("plan parser rejects all hash and identity tampering", () => {
  const mutations = [
    (plan) => {
      plan.planId = "f".repeat(64);
    },
    (plan) => {
      plan.planHash = "f".repeat(64);
    },
    (plan) => {
      plan.projectId = "coupon-app-other";
    },
    (plan) => {
      plan.generatedAt = "2026-08-12T12:00:01.000Z";
    },
    (plan) => {
      plan.operations[1].precondition.updateTime.nanoseconds += 1;
    },
    (plan) => {
      plan.pagination[0].recordsRead += 1;
    },
  ];
  for (const mutate of mutations) {
    const plan = plain(build());
    mutate(plan);
    assertContractError(
      () => contract.parseOwnerRecordGenerationMigrationPlan(plan),
      "invalid-state",
    );
  }
});

test("create-owner operation is exact, generation zero, and create-only", () => {
  const invalidOperations = [
    createOwnerOperation({documentPath: "private_owner_record_states/other"}),
    createOwnerOperation({ownerRecordGeneration: 1}),
    createOwnerOperation({existingGeneration: 0}),
    createOwnerOperation({precondition: {kind: "update_time"}}),
  ];
  for (const operation of invalidOperations) {
    assertContractError(
      () => build({operations: [operation]}),
      "invalid-request",
    );
  }
});

test("Firestore stamps require exact scope, generation, and nanosecond time", () => {
  const invalidOperations = [
    firestoreOperation({scope: "customers"}),
    firestoreOperation({
      scope: "coupons",
      documentPath: "restaurant_accounts/" + ownerUid,
    }),
    firestoreOperation({documentPath: "restaurant_accounts/other"}),
    firestoreOperation({ownerRecordGeneration: 1}),
    firestoreOperation({existingGeneration: 0}),
    firestoreOperation({existingGeneration: 1}),
    firestoreOperation({precondition: {kind: "must_not_exist"}}),
    firestoreOperation({
      precondition: {
        kind: "update_time",
        updateTime: {seconds: "01786536000", nanoseconds: 0},
      },
    }),
    firestoreOperation({
      precondition: {
        kind: "update_time",
        updateTime: {seconds: "1786536000", nanoseconds: 1_000_000_000},
      },
    }),
  ];
  for (const operation of invalidOperations) {
    assertContractError(
      () => build({operations: [createOwnerOperation(), operation]}),
      "invalid-request",
    );
  }
});

test("Storage stamps never conflate owner, provider, or metageneration", () => {
  const invalidOperations = [
    storageOperation({storageKind: "shared_menu_images"}),
    storageOperation({
      objectName:
        "bitesaver_restaurants/other/restaurant_images/photo.jpg",
    }),
    storageOperation({ownerRecordGeneration: "1"}),
    storageOperation({existingGeneration: "0"}),
    storageOperation({existingGeneration: "1"}),
    storageOperation({providerGeneration: "0"}),
    storageOperation({metageneration: "01"}),
    storageOperation({content: "forbidden"}),
  ];
  for (const operation of invalidOperations) {
    assertContractError(
      () => build({operations: [createOwnerOperation(), operation]}),
      "invalid-request",
    );
  }
});

test("operation and pagination duplicates fail instead of being hidden", () => {
  assertContractError(
    () => build({
      operations: [createOwnerOperation(), createOwnerOperation()],
    }),
    "invalid-request",
  );
  assertContractError(
    () => build({
      operations: [
        createOwnerOperation(),
        firestoreOperation(),
        firestoreOperation({
          precondition: {
            kind: "update_time",
            updateTime: {seconds: "1786536001", nanoseconds: 0},
          },
        }),
      ],
    }),
    "invalid-request",
  );
  assertContractError(
    () => build({
      operations: [
        createOwnerOperation(),
        storageOperation(),
        storageOperation({metageneration: "8"}),
      ],
    }),
    "invalid-request",
  );
  assertContractError(
    () => build({
      pagination: [
        completePagination("coupons"),
        completePagination("coupons", {recordsRead: 1}),
      ],
    }),
    "invalid-request",
  );
});

test("pagination is closed, bounded, and complete before a safe result", () => {
  const invalid = [
    completePagination("unknown"),
    completePagination("coupons", {pagesRead: 0}),
    completePagination("coupons", {pagesRead: -1}),
    completePagination("coupons", {recordsRead: 0.5}),
    completePagination("coupons", {nextCursor: "unexpected"}),
    completePagination("coupons", {complete: false, nextCursor: null}),
    completePagination("coupons", {complete: false, nextCursor: "a\nb"}),
    completePagination("coupons", {pagesRead: 2, recordsRead: 99}),
    completePagination("coupons", {pagesRead: 2, recordsRead: 200}),
    completePagination("coupons", {pagesRead: 2, recordsRead: 201}),
    completePagination("coupons", {pagesRead: 101, recordsRead: 10_000}),
    completePagination("storage_menu_images", {
      pagesRead: 2,
      recordsRead: 0,
    }),
    completePagination("storage_menu_images", {
      pagesRead: 2,
      recordsRead: 51,
    }),
  ];
  for (const pagination of invalid) {
    assertContractError(
      () => build({pagination: [pagination]}),
      "invalid-request",
    );
  }
  assertContractError(
    () => build({
      pagination: [
        completePagination("coupons", {
          complete: false,
          nextCursor: "next-safe-cursor",
        }),
      ],
    }),
    "invalid-request",
  );
  assertContractError(
    () => build({pagination: [completePagination("coupons")]}),
    "invalid-request",
  );

  const exactBounds = build({
    pagination: completeInventoryPagination().map((entry) => {
      if (entry.scope === "coupons") {
        return completePagination(entry.scope, {
          pagesRead: 100,
          recordsRead: 9_999,
        });
      }
      if (entry.scope === "storage_menu_images") {
        return completePagination(entry.scope, {
          pagesRead: 100,
          recordsRead: 2_500,
        });
      }
      return entry;
    }),
  });
  assert.equal(exactBounds.classification, "legacy_safe_candidate");
});

test("already initialized and no-owner plans are strict no-ops", () => {
  for (const fixture of [
    {
      classification: "already_initialized",
      proposedGeneration: 47,
    },
    {
      classification: "no_owner_data",
      proposedGeneration: null,
    },
  ]) {
    const plan = build({
      ...fixture,
      operations: [],
      pagination: completeInventoryPagination(),
    });
    assert.deepEqual(plan.operations, []);
    assert.deepEqual(plan.manualReviewReasons, []);
  }
  assertContractError(
    () => build({
      classification: "already_initialized",
      proposedGeneration: null,
      operations: [],
    }),
    "invalid-request",
  );
  assertContractError(
    () => build({
      classification: "no_owner_data",
      proposedGeneration: 0,
      operations: [],
    }),
    "invalid-request",
  );
});

test("manual review can never carry a proposed generation or operation", () => {
  const manual = build({
    classification: "manual_review_required",
    proposedGeneration: null,
    operations: [],
    manualReviewReasons: [
      reason("record_generation_newer", {
        documentPath:
          "restaurant_accounts/" + ownerUid + "/coupons/coupon-1",
        existingGeneration: 2,
      }),
    ],
  });
  assert.equal(manual.classification, "manual_review_required");
  assert.deepEqual(manual.operations, []);
  assert.equal(manual.manualReviewReasons[0].existingGeneration, 2);

  for (const overrides of [
    {manualReviewReasons: []},
    {proposedGeneration: 0},
    {operations: [createOwnerOperation()]},
  ]) {
    assertContractError(
      () => build({
        classification: "manual_review_required",
        proposedGeneration: null,
        operations: [],
        manualReviewReasons: [reason()],
        ...overrides,
      }),
      "invalid-request",
    );
  }
});

test("incomplete inventory is manual review with an explicit reason", () => {
  const incomplete = completePagination("rating_claims", {
    complete: false,
    nextCursor: "rating-100",
    recordsRead: 100,
  });
  const plan = build({
    classification: "manual_review_required",
    proposedGeneration: null,
    operations: [],
    manualReviewReasons: [reason("inventory_incomplete")],
    pagination: incompleteInventoryPagination(
      incomplete.scope,
      incomplete.nextCursor,
      incomplete.recordsRead,
    ),
  });
  assert.equal(plan.pagination[0].complete, false);

  assertContractError(
    () => build({
      classification: "manual_review_required",
      proposedGeneration: null,
      operations: [],
      manualReviewReasons: [reason("record_shape_unrecognized")],
      pagination: incompleteInventoryPagination(
        incomplete.scope,
        incomplete.nextCursor,
        incomplete.recordsRead,
      ),
    }),
    "invalid-request",
  );
});

test("only an exact active-removal reason yields blocked classification", () => {
  const exactActiveReason = () => reason("active_removal_job", {
    documentPath: "private_owner_record_removal_jobs/job-1",
    existingGeneration: 1,
  });
  const blocked = build({
    classification: "blocked_active_removal",
    proposedGeneration: null,
    operations: [],
    manualReviewReasons: [
      exactActiveReason(),
    ],
  });
  assert.equal(blocked.classification, "blocked_active_removal");
  for (const reasons of [
    [reason("retryable_removal_job")],
    [reason("active_removal_job"), reason("owner_state_not_open")],
    [],
  ]) {
    assertContractError(
      () => build({
        classification: "blocked_active_removal",
        proposedGeneration: null,
        operations: [],
        manualReviewReasons: reasons,
      }),
      "invalid-request",
    );
  }
  assertContractError(
    () => build({
      classification: "blocked_active_removal",
      proposedGeneration: null,
      operations: [],
      manualReviewReasons: [exactActiveReason()],
      pagination: incompleteInventoryPagination(
        "rating_claims",
        "rating-100",
        100,
      ),
    }),
    "invalid-request",
  );
});

test("manual evidence is exact, allowlisted, and never stores raw malformed data", () => {
  const invalidReasons = [
    reason("unknown_reason"),
    reason("owner_state_malformed", {
      documentPath: "user_profiles/" + ownerUid,
    }),
    reason("owner_state_malformed", {
      documentPath: "private_owner_record_states/" + ownerUid,
      storageObjectName:
        "bitesaver_restaurants/" + ownerUid + "/menu_images/photo.jpg",
    }),
    reason("storage_prefix_conflict", {
      storageObjectName:
        "bitesaver_restaurants/other/menu_images/photo.jpg",
    }),
    reason("record_generation_malformed", {existingGeneration: -1}),
    reason("storage_generation_malformed", {existingGeneration: "01"}),
    {...reason(), rawValue: "must-not-be-recorded"},
  ];
  for (const invalidReason of invalidReasons) {
    assertContractError(
      () => build({
        classification: "manual_review_required",
        proposedGeneration: null,
        operations: [],
        manualReviewReasons: [invalidReason],
      }),
      "invalid-request",
    );
  }
});

test("manual reasons normalize order and reject exact duplicates", () => {
  const first = build({
    classification: "manual_review_required",
    proposedGeneration: null,
    operations: [],
    manualReviewReasons: [
      reason("storage_generation_newer", {
        storageObjectName:
          "bitesaver_restaurants/" + ownerUid +
          "/restaurant_images/photo.jpg",
        existingGeneration: "2",
      }),
      reason("owner_state_malformed", {
        documentPath: "private_owner_record_states/" + ownerUid,
      }),
    ],
  });
  const second = build({
    classification: "manual_review_required",
    proposedGeneration: null,
    operations: [],
    manualReviewReasons: [...first.manualReviewReasons].reverse(),
  });
  assert.deepEqual(first, second);
  assertContractError(
    () => build({
      classification: "manual_review_required",
      proposedGeneration: null,
      operations: [],
      manualReviewReasons: [reason(), reason()],
    }),
    "invalid-request",
  );
});

test("redacted summary exposes counts and categories only", () => {
  const legacy = build();
  const manual = build({
    classification: "manual_review_required",
    proposedGeneration: null,
    operations: [],
    manualReviewReasons: [
      reason("billing_generation_conflict", {
        documentPath: "private_owner_billing_states/" + ownerUid,
        existingGeneration: 3,
      }),
    ],
  });
  const summary =
    contract.buildOwnerRecordGenerationMigrationRedactedSummary([
      manual,
      legacy,
    ]);
  assert.deepEqual(Object.keys(summary).sort(), [
    "classificationCounts",
    "incompletePaginationScopeCount",
    "manualReviewReasonCounts",
    "operationCounts",
    "planCount",
    "schemaVersion",
  ]);
  assert.equal(summary.planCount, 2);
  assert.equal(summary.classificationCounts.legacy_safe_candidate, 1);
  assert.equal(summary.classificationCounts.manual_review_required, 1);
  assert.deepEqual(summary.operationCounts, {
    createOwnerStates: 1,
    firestoreDocuments: 1,
    storageObjects: 1,
  });
  assert.deepEqual(summary.manualReviewReasonCounts, [{
    code: "billing_generation_conflict",
    count: 1,
  }]);
  const serialized = JSON.stringify(summary);
  for (const canary of [
    ownerUid,
    "restaurant_accounts/",
    "private_owner_billing_states/",
    "bitesaver_restaurants/",
    "coupon-app-29446",
    "1786536000123456",
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
});

test("summary rejects invalid or duplicate machine plans", () => {
  const plan = build();
  assertContractError(
    () => contract.buildOwnerRecordGenerationMigrationRedactedSummary(
      "not-an-array",
    ),
    "invalid-request",
  );
  assertContractError(
    () => contract.buildOwnerRecordGenerationMigrationRedactedSummary([
      plan,
      plan,
    ]),
    "invalid-request",
  );
  const corrupt = plain(plan);
  corrupt.planHash = "f".repeat(64);
  assertContractError(
    () => contract.buildOwnerRecordGenerationMigrationRedactedSummary([
      corrupt,
    ]),
    "invalid-request",
  );
});

test("machine plan contains no payload, token, URL, or payment field", () => {
  const serialized = JSON.stringify(build());
  for (const forbidden of [
    "restaurantName",
    "address",
    "phone",
    "website",
    "bio",
    "email",
    "downloadToken",
    "signedUrl",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "authToken",
    "secret",
    "contentType",
    "objectContents",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
