"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require(
  "../lib/owner_record_generation_migration_contract.js",
);
const planner = require(
  "../lib/owner_record_generation_migration_planner.js",
);
const firestore = require(
  "../lib/owner_record_generation_migration_store.js",
);
const storage = require(
  "../lib/owner_record_generation_migration_storage.js",
);
const ownerState = require("../lib/owner_record_state_contract.js");
const billing = require("../lib/owner_billing_state_contract.js");
const removal = require("../lib/owner_record_removal_contract.js");
const returns = require("../lib/subscription_return_ledger.js");

const uid = "migration-planner-owner";
const projectId = "coupon-app-29446";
const now = new Date("2026-08-12T20:00:00.000Z");
const readTime = {seconds: "1786564800", nanoseconds: 123_000_000};
const updateTime = {seconds: "1786564700", nanoseconds: 456_000_000};

function fixture(path, data, time = updateTime) {
  return {path, data, updateTime: time};
}

function rootData(overrides = {}) {
  return {
    uid,
    restaurantName: "Synthetic Restaurant",
    city: "Test City",
    state: "NY",
    zipCode: "10001",
    ...overrides,
  };
}

function childData(collection, id, generation = undefined) {
  const common = generation === undefined
    ? {}
    : {ownerRecordGeneration: generation};
  switch (collection) {
  case "coupons":
    return {
      id,
      restaurant: "Synthetic Restaurant",
      title: "Synthetic Coupon",
      distance: "1 mile",
      expires: "Soon",
      ...common,
    };
  case "daily_specials":
    return {id, restaurantId: uid, ownerUid: uid, title: "Special", ...common};
  case "coupon_number_reservations":
    return {couponId: "coupon-1", couponNumber: id, ...common};
  case "coupon_code_reservations":
    return {
      couponId: "coupon-1",
      couponCode: "SAVE 10",
      normalizedCouponCode: "SAVE 10",
      ...common,
    };
  case "menu_images":
    return {id, imageUrl: "https://invalid.example/image.png", ...common};
  case "menu_items":
    return {id, name: "Item", category: "Entrees", ...common};
  case "menu_sections":
    return {id, title: "About", body: "Synthetic body", ...common};
  default:
    throw new Error("unknown collection");
  }
}

function childId(collection) {
  if (collection === "coupon_number_reservations") return "1234";
  if (collection === "coupon_code_reservations") return "SAVE%2010";
  return `${collection}-1`;
}

function ratingData(generation = undefined, overrides = {}) {
  return {
    id: "rating-1",
    ownerUserId: uid,
    isClaimed: true,
    isActive: true,
    restaurantWriteRevision: 0,
    name: "Synthetic Rating Restaurant",
    ...(generation === undefined ? {} : {ownerRecordGeneration: generation}),
    ...overrides,
  };
}

function object(kind, generation = null, overrides = {}) {
  return {
    name: `bitesaver_restaurants/${uid}/${kind}/object-1.png`,
    providerGeneration: "11",
    metageneration: "3",
    size: "1024",
    contentType: "image/png",
    ownerRecordGeneration: generation,
    ...overrides,
  };
}

function ownerAtGeneration(generation) {
  return ownerState.buildOwnerRecordStateDocument({
    ownerUid: uid,
    generation,
    state: "open",
    activeJobId: null,
    createdAt: now,
    updatedAt: now,
  });
}

function returnState(generation = 0) {
  return returns.reserveSubscriptionReturnContext({
    rawState: undefined,
    ownerUid: uid,
    restaurantAccountDocumentId: uid,
    ownerRecordGeneration: generation,
    tokenHash: "a".repeat(64),
    family: "checkout",
    nowEpochMs: now.getTime(),
  });
}

function createStores(documents = [], objects = []) {
  return {
    firestoreStore:
      firestore.createInMemoryOwnerRecordGenerationMigrationStore({
        documents,
        readTime,
      }),
    storageStore:
      storage.createInMemoryOwnerRecordGenerationMigrationStorageInventory(
        objects,
      ),
  };
}

async function collect(documents = [], objects = [], overrides = {}) {
  return planner.collectOwnerRecordGenerationMigrationInventory({
    projectId,
    ownerUid: uid,
    now,
    ...createStores(documents, objects),
    ...overrides,
  });
}

function codes(plan) {
  return new Set(plan.manualReviewReasons.map((reason) => reason.code));
}

function assertManual(plan, ...expectedCodes) {
  assert.equal(plan.classification, "manual_review_required");
  assert.equal(plan.proposedGeneration, null);
  assert.deepEqual(plan.operations, []);
  for (const code of expectedCodes) {
    assert.equal(codes(plan).has(code), true, `missing ${code}`);
  }
  contract.parseOwnerRecordGenerationMigrationPlan(plan);
}

test("collector exhausts all twelve bounded scopes and empty inventory is no_owner_data", async () => {
  const inventory = await collect();
  assert.deepEqual(
    inventory.pagination.map((entry) => entry.scope),
    [...contract.ownerRecordGenerationMigrationPaginationScopes],
  );
  assert.equal(inventory.pagination.every((entry) => entry.complete), true);
  assert.equal(inventory.pagination.every((entry) => entry.pagesRead === 1), true);
  const plan = planner.planOwnerRecordGenerationMigration(inventory);
  assert.equal(plan.classification, "no_owner_data");
  assert.deepEqual(plan.operations, []);
});

test("canonical legacy root produces exact generation-zero state and root stamps", async () => {
  const inventory = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]);
  const plan = planner.planOwnerRecordGenerationMigration(inventory);
  assert.equal(plan.classification, "legacy_safe_candidate");
  assert.equal(plan.proposedGeneration, 0);
  assert.deepEqual(plan.operations.map((entry) => entry.operation).sort(), [
    "create_owner_state",
    "stamp_firestore_document",
  ]);
  const stamp = plan.operations.find(
    (entry) => entry.operation === "stamp_firestore_document",
  );
  assert.deepEqual(stamp.precondition, {kind: "update_time", updateTime});
  assert.equal(stamp.existingGeneration, null);
  contract.parseOwnerRecordGenerationMigrationPlan(plan);
});

test("legacy root with every child, claimed Rating, Storage kind, and compatible private state is safe", async () => {
  const documents = [
    fixture(`restaurant_accounts/${uid}`, rootData()),
    ...contract.ownerRecordGenerationMigrationAccountChildCollections.map(
      (collection) => {
        const id = childId(collection);
        return fixture(
          `restaurant_accounts/${uid}/${collection}/${id}`,
          childData(collection, id),
        );
      },
    ),
    fixture("bitescore_restaurants/rating-1", ratingData()),
    fixture(
      `private_owner_billing_states/${uid}`,
      billing.createInitialOwnerBillingState(uid, 0, now),
    ),
    fixture(`private_subscription_return_state/${uid}`, returnState()),
  ];
  const objects = contract.ownerRecordGenerationMigrationStorageKinds.map(
    (kind) => object(kind),
  );
  const plan = planner.planOwnerRecordGenerationMigration(
    await collect(documents, objects),
  );
  assert.equal(plan.classification, "legacy_safe_candidate");
  assert.equal(plan.operations.filter((op) =>
    op.operation === "stamp_firestore_document").length, 9);
  assert.equal(plan.operations.filter((op) =>
    op.operation === "stamp_storage_object_metadata").length, 3);
  assert.equal(plan.operations.filter((op) =>
    op.operation === "create_owner_state").length, 1);
});

test("exact initialized owner and all generation-bound data is a deterministic no-op", async () => {
  const generation = 4;
  const documents = [
    fixture(`private_owner_record_states/${uid}`, ownerAtGeneration(generation)),
    fixture(
      `private_owner_billing_states/${uid}`,
      billing.createInitialOwnerBillingState(uid, generation, now),
    ),
    fixture(`private_subscription_return_state/${uid}`, returnState(generation)),
    fixture(
      `restaurant_accounts/${uid}`,
      rootData({ownerRecordGeneration: generation}),
    ),
    ...contract.ownerRecordGenerationMigrationAccountChildCollections.map(
      (collection) => {
        const id = childId(collection);
        return fixture(
          `restaurant_accounts/${uid}/${collection}/${id}`,
          childData(collection, id, generation),
        );
      },
    ),
    fixture("bitescore_restaurants/rating-1", ratingData(generation)),
  ];
  const objects = contract.ownerRecordGenerationMigrationStorageKinds.map(
    (kind) => object(kind, String(generation)),
  );
  const first = planner.planOwnerRecordGenerationMigration(
    await collect(documents, objects),
  );
  const second = planner.planOwnerRecordGenerationMigration(
    await collect([...documents].reverse(), [...objects].reverse()),
  );
  assert.equal(first.classification, "already_initialized");
  assert.deepEqual(first.operations, []);
  assert.equal(first.planId, second.planId);
  assert.equal(first.planHash, second.planHash);
});

test("owner-state malformed and missing root with each data family fail closed", async () => {
  const malformed = await collect([
    fixture(`private_owner_record_states/${uid}`, {generation: 0}),
    fixture(
      `restaurant_accounts/${uid}/daily_specials/special-1`,
      childData("daily_specials", "special-1"),
    ),
    fixture("bitescore_restaurants/rating-1", ratingData()),
  ], [object("restaurant_images")]);
  const plan = planner.planOwnerRecordGenerationMigration(malformed);
  assertManual(
    plan,
    "owner_state_malformed",
    "account_root_missing_with_owner_state",
    "account_root_missing_with_child",
    "account_root_missing_with_rating_claim",
    "account_root_missing_with_storage",
  );
});

test("initialized missing stamps and legacy older/newer/malformed/mixed generations are manual", async () => {
  const initialized = await collect([
    fixture(`private_owner_record_states/${uid}`, ownerAtGeneration(2)),
    fixture(`restaurant_accounts/${uid}`, rootData({ownerRecordGeneration: 2})),
    fixture(
      `restaurant_accounts/${uid}/menu_items/item-1`,
      childData("menu_items", "item-1"),
    ),
  ]);
  assertManual(
    planner.planOwnerRecordGenerationMigration(initialized),
    "record_generation_missing_after_initialization",
  );

  const conflict = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData({ownerRecordGeneration: 1})),
    fixture(
      `restaurant_accounts/${uid}/menu_items/item-1`,
      childData("menu_items", "item-1", 0),
    ),
    fixture(
      `restaurant_accounts/${uid}/menu_sections/section-1`,
      childData("menu_sections", "section-1", "0"),
    ),
  ]);
  assertManual(
    planner.planOwnerRecordGenerationMigration(conflict),
    "record_generation_newer",
    "record_generation_malformed",
    "mixed_record_generations",
  );
});

test("unrecognized root/child and wrong owner associations are never stamped safely", async () => {
  const unknownRoot = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, {foo: "bar"}),
  ]));
  assertManual(unknownRoot, "record_shape_unrecognized");

  const wrongOwner = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
    fixture(
      `restaurant_accounts/${uid}/daily_specials/special-1`,
      {...childData("daily_specials", "special-1"), ownerUid: "other-owner"},
    ),
  ]));
  assertManual(wrongOwner, "record_owner_conflict");

  for (const storagePath of [
    null,
    `bitesaver_restaurants/${uid}/menu_images/image-1.png`,
  ]) {
    const safeStoragePath = planner.planOwnerRecordGenerationMigration(
      await collect([
        fixture(`restaurant_accounts/${uid}`, rootData()),
        fixture(`restaurant_accounts/${uid}/menu_images/image-1`, {
          ...childData("menu_images", "image-1"),
          storagePath,
        }),
      ]),
    );
    assert.equal(safeStoragePath.classification, "legacy_safe_candidate");
    assert.equal(codes(safeStoragePath).size, 0);
  }

  const wrongStoragePath = planner.planOwnerRecordGenerationMigration(
    await collect([
      fixture(`restaurant_accounts/${uid}`, rootData()),
      fixture(`restaurant_accounts/${uid}/menu_images/image-1`, {
        ...childData("menu_images", "image-1"),
        storagePath:
          "bitesaver_restaurants/other-owner/menu_images/image-1.png",
      }),
    ]),
  );
  assertManual(wrongStoragePath, "record_owner_conflict");

  const malformedStoragePath = planner.planOwnerRecordGenerationMigration(
    await collect([
      fixture(`restaurant_accounts/${uid}`, rootData()),
      fixture(`restaurant_accounts/${uid}/menu_images/image-1`, {
        ...childData("menu_images", "image-1"),
        storagePath: `bitesaver_restaurants/${uid}/menu_images/bad\nname.png`,
      }),
    ]),
  );
  assertManual(malformedStoragePath, "record_shape_unrecognized");

  const wrongKindStoragePath = planner.planOwnerRecordGenerationMigration(
    await collect([
      fixture(`restaurant_accounts/${uid}`, rootData()),
      fixture(`restaurant_accounts/${uid}/menu_images/image-1`, {
        ...childData("menu_images", "image-1"),
        storagePath:
          `bitesaver_restaurants/${uid}/coupon_images/image-1.png`,
      }),
    ]),
  );
  assertManual(wrongKindStoragePath, "record_owner_conflict");
});

test("Rating ownership, status, shape, generation, and root-link conflicts fail closed", async () => {
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(
      `restaurant_accounts/${uid}`,
      rootData({
        menuSourceSide: "biteScore",
        linkedBiteScoreRestaurantId: "not-returned-for-owner",
      }),
    ),
    fixture("bitescore_restaurants/rating-1", ratingData("bad", {
      isClaimed: false,
      isActive: "yes",
    })),
  ]));
  assertManual(
    plan,
    "rating_claim_owner_conflict",
    "rating_claim_status_conflict",
    "rating_claim_generation_malformed",
    "record_shape_unrecognized",
  );
});

test("a claimed Rating record returned with a different owner fails closed", async () => {
  const inventory = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
    fixture("bitescore_restaurants/rating-1", ratingData()),
  ]);
  const wrongOwnerInventory = {
    ...inventory,
    ratingClaims: inventory.ratingClaims.map((document) => ({
      ...document,
      data: {...document.data, ownerUserId: "other-owner"},
    })),
  };
  assertManual(
    planner.planOwnerRecordGenerationMigration(wrongOwnerInventory),
    "rating_claim_owner_conflict",
  );
});

test("stale opposite-side and cyclic menu routing fields require manual review", async () => {
  const staleRoot = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, rootData({
      menuSourceSide: "biteSaver",
      linkedBiteScoreRestaurantId: "rating-1",
    })),
  ]));
  assertManual(staleRoot, "rating_claim_owner_conflict");

  const staleRating = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
    fixture("bitescore_restaurants/rating-1", ratingData(undefined, {
      menuSourceSide: "biteScore",
      linkedBiteSaverUid: "other-owner",
    })),
  ]));
  assertManual(staleRating, "rating_claim_owner_conflict");

  const cycle = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, rootData({
      menuSourceSide: "biteScore",
      linkedBiteScoreRestaurantId: "rating-1",
    })),
    fixture("bitescore_restaurants/rating-1", ratingData(undefined, {
      menuSourceSide: "biteSaver",
      linkedBiteSaverUid: uid,
    })),
  ]));
  assertManual(cycle, "rating_claim_owner_conflict");
});

test("a stale Rating link without its routing side is never treated as ownership proof", async () => {
  const missingRootSide = planner.planOwnerRecordGenerationMigration(
    await collect([
      fixture(`restaurant_accounts/${uid}`, rootData({
        linkedBiteScoreRestaurantId: "rating-1",
      })),
      fixture("bitescore_restaurants/rating-1", ratingData()),
    ]),
  );
  assertManual(missingRootSide, "rating_claim_owner_conflict");

  const missingRatingSide = planner.planOwnerRecordGenerationMigration(
    await collect([
      fixture(`restaurant_accounts/${uid}`, rootData()),
      fixture("bitescore_restaurants/rating-1", ratingData(undefined, {
        linkedBiteSaverUid: uid,
      })),
    ]),
  );
  assertManual(missingRatingSide, "rating_claim_owner_conflict");
});

test("Storage malformed metadata, generation direction, provider fences, type, and size fail closed", async () => {
  const objects = [
    object("restaurant_images", "bad"),
    object("coupon_images", "1", {providerGeneration: null}),
    object("menu_images", "0", {
      metageneration: null,
      contentType: "image/gif",
      size: "5242881",
    }),
  ];
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ], objects));
  assertManual(
    plan,
    "storage_generation_malformed",
    "storage_generation_newer",
    "storage_provider_generation_missing",
    "storage_metageneration_missing",
    "record_shape_unrecognized",
  );
});

test("billing and subscription-return generation/schema conflicts fail closed", async () => {
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
    fixture(
      `private_owner_billing_states/${uid}`,
      billing.createInitialOwnerBillingState(uid, 1, now),
    ),
    fixture(`private_subscription_return_state/${uid}`, {
      ownerRecordGeneration: 0,
      schemaVersion: "unknown",
    }),
  ]));
  assertManual(
    plan,
    "billing_generation_conflict",
    "subscription_return_state_malformed",
  );
});

test("non-open owner state is manual and exact active lifecycle is blocked", async () => {
  const sourceGeneration = 0;
  const completionGeneration = 1;
  const jobId = removal.createOwnerRecordRemovalJobId({
    targetUid: uid,
    sourceGeneration,
  });
  const job = removal.buildOwnerRecordRemovalJobDocument({
    operation: removal.ownerRecordRemovalOperation,
    jobId,
    requestId: "planner-removal-request",
    callerFingerprint: removal.createOwnerRecordRemovalCallerFingerprint(
      "planner-admin",
    ),
    targetUid: uid,
    status: "active",
    phase: "unclaim_rating_restaurants",
    sourceGeneration,
    completionGeneration,
    cutoverApplied: true,
    billingGateCategory: "inactive",
    failureCategory: null,
    ...removal.createEmptyOwnerRecordRemovalCounters(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
  const removingOwner = ownerState.buildOwnerRecordStateDocument({
    ownerUid: uid,
    generation: completionGeneration,
    state: "removing",
    activeJobId: jobId,
    createdAt: now,
    updatedAt: now,
  });
  const blocked = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`private_owner_record_states/${uid}`, removingOwner),
    fixture(`private_owner_record_removal_jobs/${jobId}`, job),
  ]));
  assert.equal(blocked.classification, "blocked_active_removal");
  assert.deepEqual(blocked.manualReviewReasons.map((entry) => entry.code), [
    "active_removal_job",
  ]);
});

test("exact active lifecycle accepts only matching source-generation remnants", async () => {
  const sourceGeneration = 0;
  const completionGeneration = 1;
  const jobId = removal.createOwnerRecordRemovalJobId({
    targetUid: uid,
    sourceGeneration,
  });
  const job = removal.buildOwnerRecordRemovalJobDocument({
    operation: removal.ownerRecordRemovalOperation,
    jobId,
    requestId: "planner-active-source-request",
    callerFingerprint: removal.createOwnerRecordRemovalCallerFingerprint(
      "planner-admin",
    ),
    targetUid: uid,
    status: "active",
    phase: "delete_account_menu_items",
    sourceGeneration,
    completionGeneration,
    cutoverApplied: true,
    billingGateCategory: "inactive",
    failureCategory: null,
    ...removal.createEmptyOwnerRecordRemovalCounters(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
  const removingOwner = ownerState.buildOwnerRecordStateDocument({
    ownerUid: uid,
    generation: completionGeneration,
    state: "removing",
    activeJobId: jobId,
    createdAt: now,
    updatedAt: now,
  });
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`private_owner_record_states/${uid}`, removingOwner),
    fixture(`private_owner_record_removal_jobs/${jobId}`, job),
    fixture(
      `private_owner_billing_states/${uid}`,
      billing.createInitialOwnerBillingState(uid, sourceGeneration, now),
    ),
    fixture(
      `private_subscription_return_state/${uid}`,
      returnState(sourceGeneration),
    ),
    fixture(
      `restaurant_accounts/${uid}`,
      rootData({ownerRecordGeneration: sourceGeneration}),
    ),
    fixture(
      `restaurant_accounts/${uid}/menu_items/item-1`,
      childData("menu_items", "item-1", sourceGeneration),
    ),
    fixture(
      "bitescore_restaurants/rating-1",
      ratingData(sourceGeneration),
    ),
  ], [object("menu_images", String(sourceGeneration))]));
  assert.equal(plan.classification, "blocked_active_removal");
  assert.deepEqual(plan.manualReviewReasons.map((reason) => reason.code), [
    "active_removal_job",
  ]);
});

test("active lifecycle blocks completion/newer-generation remnants as ambiguous", async () => {
  const sourceGeneration = 0;
  const completionGeneration = 1;
  const jobId = removal.createOwnerRecordRemovalJobId({
    targetUid: uid,
    sourceGeneration,
  });
  const job = removal.buildOwnerRecordRemovalJobDocument({
    operation: removal.ownerRecordRemovalOperation,
    jobId,
    requestId: "planner-active-newer-request",
    callerFingerprint: removal.createOwnerRecordRemovalCallerFingerprint(
      "planner-admin",
    ),
    targetUid: uid,
    status: "active",
    phase: "delete_account_menu_items",
    sourceGeneration,
    completionGeneration,
    cutoverApplied: true,
    billingGateCategory: "inactive",
    failureCategory: null,
    ...removal.createEmptyOwnerRecordRemovalCounters(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
  const removingOwner = ownerState.buildOwnerRecordStateDocument({
    ownerUid: uid,
    generation: completionGeneration,
    state: "removing",
    activeJobId: jobId,
    createdAt: now,
    updatedAt: now,
  });
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`private_owner_record_states/${uid}`, removingOwner),
    fixture(`private_owner_record_removal_jobs/${jobId}`, job),
    fixture(
      `restaurant_accounts/${uid}`,
      rootData({ownerRecordGeneration: completionGeneration}),
    ),
  ]));
  assertManual(plan, "active_removal_job", "record_generation_newer");
});

test("complete historical removal evidence is always manual review", async () => {
  const sourceGeneration = 0;
  const completionGeneration = 1;
  const jobId = removal.createOwnerRecordRemovalJobId({
    targetUid: uid,
    sourceGeneration,
  });
  const completedAt = new Date(now.getTime() + 1_000);
  const job = removal.buildOwnerRecordRemovalJobDocument({
    operation: removal.ownerRecordRemovalOperation,
    jobId,
    requestId: "planner-complete-request",
    callerFingerprint: removal.createOwnerRecordRemovalCallerFingerprint(
      "planner-admin",
    ),
    targetUid: uid,
    status: "complete",
    phase: "complete",
    sourceGeneration,
    completionGeneration,
    cutoverApplied: true,
    billingGateCategory: "inactive",
    failureCategory: null,
    ...removal.createEmptyOwnerRecordRemovalCounters(),
    createdAt: now,
    updatedAt: completedAt,
    completedAt,
  });
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`private_owner_record_states/${uid}`, ownerAtGeneration(1)),
    fixture(
      `restaurant_accounts/${uid}`,
      rootData({ownerRecordGeneration: 1}),
    ),
    fixture(`private_owner_record_removal_jobs/${jobId}`, job),
  ]));
  assertManual(
    plan,
    "historical_removal_job",
    "prior_generation_lifecycle_evidence",
  );
});

test("removed state and retryable/manual-review jobs never authorize initialization", async () => {
  const removedOwner = ownerState.buildOwnerRecordStateDocument({
    ownerUid: uid,
    generation: 1,
    state: "removed",
    activeJobId: null,
    createdAt: now,
    updatedAt: now,
  });
  assertManual(
    planner.planOwnerRecordGenerationMigration(await collect([
      fixture(`private_owner_record_states/${uid}`, removedOwner),
    ])),
    "owner_state_not_open",
    "account_root_missing_with_owner_state",
  );

  for (const [status, failureCategory, expectedReason] of [
    ["retryable", "temporary_dependency", "retryable_removal_job"],
    [
      "manual_review_required",
      "unsupported_partial_state",
      "manual_review_removal_job",
    ],
  ]) {
    const sourceGeneration = 0;
    const jobId = removal.createOwnerRecordRemovalJobId({
      targetUid: uid,
      sourceGeneration,
    });
    const job = removal.buildOwnerRecordRemovalJobDocument({
      operation: removal.ownerRecordRemovalOperation,
      jobId,
      requestId: `planner-${status}-request`,
      callerFingerprint: removal.createOwnerRecordRemovalCallerFingerprint(
        "planner-admin",
      ),
      targetUid: uid,
      status,
      phase: "delete_coupons",
      sourceGeneration,
      completionGeneration: 1,
      cutoverApplied: true,
      billingGateCategory: "inactive",
      failureCategory,
      ...removal.createEmptyOwnerRecordRemovalCounters(),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    assertManual(
      planner.planOwnerRecordGenerationMigration(await collect([
        fixture(`restaurant_accounts/${uid}`, rootData()),
        fixture(`private_owner_record_removal_jobs/${jobId}`, job),
      ])),
      expectedReason,
    );
  }
});

test("unmatched removing and removed owner states remain manual with a valid root", async () => {
  for (const state of ["removing", "removed"]) {
    const generation = 1;
    const activeJobId = state === "removing"
      ? removal.createOwnerRecordRemovalJobId({
        targetUid: uid,
        sourceGeneration: 0,
      })
      : null;
    const owner = ownerState.buildOwnerRecordStateDocument({
      ownerUid: uid,
      generation,
      state,
      activeJobId,
      createdAt: now,
      updatedAt: now,
    });
    const plan = planner.planOwnerRecordGenerationMigration(await collect([
      fixture(`private_owner_record_states/${uid}`, owner),
      fixture(
        `restaurant_accounts/${uid}`,
        rootData({ownerRecordGeneration: generation}),
      ),
    ]));
    assertManual(plan, "owner_state_not_open");
  }
});

test("collector rejects oversized Firestore and Storage pages as incomplete", async () => {
  const fakeDocument = {
    id: "item",
    path: `restaurant_accounts/${uid}/menu_items/item`,
    data: childData("menu_items", "item"),
    updateTime,
    readTime,
  };
  const emptyPage = {documents: [], nextCursor: null, readTime};
  const maliciousFirestore = {
    runReadOnlyInventory: async (run) => run({
      getCanonicalAccountRoot: async () => null,
      getOwnerState: async () => null,
      getBillingState: async () => null,
      getSubscriptionReturnState: async () => null,
      listRemovalJobs: async () => emptyPage,
      listClaimedRatingRestaurants: async () => emptyPage,
      listChildDocuments: async ({collection}) => collection === "menu_items"
        ? {documents: Array(101).fill(fakeDocument), nextCursor: null, readTime}
        : emptyPage,
    }),
  };
  const maliciousStorage = {
    listObjects: async ({kind}) => ({
      objects: kind === "restaurant_images"
        ? Array(26).fill(object(kind))
        : [],
      nextCursor: null,
    }),
  };
  const inventory = await planner.collectOwnerRecordGenerationMigrationInventory({
    projectId,
    ownerUid: uid,
    now,
    firestoreStore: maliciousFirestore,
    storageStore: maliciousStorage,
  });
  const plan = planner.planOwnerRecordGenerationMigration(inventory);
  assertManual(plan, "inventory_incomplete");
  assert.equal(plan.pagination.some((entry) => !entry.complete), true);
});

test("collector rejects a full Firestore page falsely marked complete", async () => {
  const documents = Array.from({length: 100}, (_, index) => {
    const id = `item-${String(index).padStart(3, "0")}`;
    return {
      id,
      path: `restaurant_accounts/${uid}/menu_items/${id}`,
      data: childData("menu_items", id),
      updateTime,
      readTime,
    };
  });
  const emptyPage = {documents: [], nextCursor: null, readTime};
  const maliciousFirestore = {
    runReadOnlyInventory: async (run) => run({
      getCanonicalAccountRoot: async () => null,
      getOwnerState: async () => null,
      getBillingState: async () => null,
      getSubscriptionReturnState: async () => null,
      listRemovalJobs: async () => emptyPage,
      listClaimedRatingRestaurants: async () => emptyPage,
      listChildDocuments: async ({collection}) => collection === "menu_items"
        ? {documents, nextCursor: null, readTime}
        : emptyPage,
    }),
  };
  const inventory = await planner.collectOwnerRecordGenerationMigrationInventory({
    projectId,
    ownerUid: uid,
    now,
    firestoreStore: maliciousFirestore,
    storageStore:
      storage.createInMemoryOwnerRecordGenerationMigrationStorageInventory([]),
  });
  const menuPage = inventory.pagination.find(
    (entry) => entry.scope === "menu_items",
  );
  assert.equal(menuPage.complete, false);
  assert.equal(menuPage.nextCursor, "inventory-boundary-error");
  assertManual(
    planner.planOwnerRecordGenerationMigration(inventory),
    "inventory_incomplete",
  );
});

test("collector follows more than one Firestore page without truncating", async () => {
  const documents = [fixture(`restaurant_accounts/${uid}`, rootData())];
  for (let index = 0; index < 101; index += 1) {
    const id = `item-${String(index).padStart(3, "0")}`;
    documents.push(fixture(
      `restaurant_accounts/${uid}/menu_items/${id}`,
      childData("menu_items", id),
    ));
  }
  const inventory = await collect(documents);
  const menuPage = inventory.pagination.find(
    (entry) => entry.scope === "menu_items",
  );
  assert.deepEqual(menuPage, {
    scope: "menu_items",
    complete: true,
    nextCursor: null,
    pagesRead: 2,
    recordsRead: 101,
  });
  const plan = planner.planOwnerRecordGenerationMigration(inventory);
  assert.equal(plan.classification, "legacy_safe_candidate");
  assert.equal(plan.operations.filter((operation) =>
    operation.operation === "stamp_firestore_document" &&
      operation.scope === "menu_items").length, 101);
});

test("collector follows more than one Storage page without truncating", async () => {
  const objects = Array.from({length: 26}, (_, index) => object(
    "restaurant_images",
    null,
    {
      name: `bitesaver_restaurants/${uid}/restaurant_images/` +
        `object-${String(index).padStart(3, "0")}.png`,
      providerGeneration: String(index + 1),
    },
  ));
  const inventory = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ], objects);
  const page = inventory.pagination.find(
    (entry) => entry.scope === "storage_restaurant_images",
  );
  assert.deepEqual(page, {
    scope: "storage_restaurant_images",
    complete: true,
    nextCursor: null,
    pagesRead: 2,
    recordsRead: 26,
  });
  const plan = planner.planOwnerRecordGenerationMigration(inventory);
  assert.equal(plan.classification, "legacy_safe_candidate");
  assert.equal(plan.operations.filter((operation) =>
    operation.operation === "stamp_storage_object_metadata" &&
      operation.storageKind === "restaurant_images").length, 26);
});

test("collector detects mismatched per-document readTime and planner stays manual", async () => {
  const badTime = {seconds: "1786564801", nanoseconds: 0};
  const maliciousFirestore = {
    runReadOnlyInventory: async (run) => run({
      getCanonicalAccountRoot: async () => ({
        id: uid,
        path: `restaurant_accounts/${uid}`,
        data: rootData(),
        updateTime,
        readTime: badTime,
      }),
      getOwnerState: async () => null,
      getBillingState: async () => null,
      getSubscriptionReturnState: async () => null,
      listRemovalJobs: async () => ({documents: [], nextCursor: null, readTime}),
      listClaimedRatingRestaurants: async () => ({
        documents: [], nextCursor: null, readTime,
      }),
      listChildDocuments: async () => ({documents: [], nextCursor: null, readTime}),
    }),
  };
  const inventory = await planner.collectOwnerRecordGenerationMigrationInventory({
    projectId,
    ownerUid: uid,
    now,
    firestoreStore: maliciousFirestore,
    storageStore:
      storage.createInMemoryOwnerRecordGenerationMigrationStorageInventory([]),
  });
  assertManual(
    planner.planOwnerRecordGenerationMigration(inventory),
    "unsafe_timestamp",
  );
});

test("a Firestore updateTime after the stable readTime is unsafe", async () => {
  const futureUpdateTime = {
    seconds: String(Number(readTime.seconds) + 1),
    nanoseconds: 0,
  };
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(
      `restaurant_accounts/${uid}`,
      rootData(),
      futureUpdateTime,
    ),
  ]));
  assertManual(plan, "unsafe_timestamp");
});

test("collector rejects a cursor that is not bound to the requested owner and scope", async () => {
  let injected = false;
  const maliciousFirestore = {
    runReadOnlyInventory: async (run) => run({
      getCanonicalAccountRoot: async () => null,
      getOwnerState: async () => null,
      getBillingState: async () => null,
      getSubscriptionReturnState: async () => null,
      listRemovalJobs: async () => ({documents: [], nextCursor: null, readTime}),
      listClaimedRatingRestaurants: async () => ({
        documents: [], nextCursor: null, readTime,
      }),
      listChildDocuments: async ({collection, cursor}) => {
        if (collection !== "menu_items" || cursor !== null || injected) {
          return {documents: [], nextCursor: null, readTime};
        }
        injected = true;
        const id = "item-1";
        return {
          documents: [{
            id,
            path: `restaurant_accounts/${uid}/menu_items/${id}`,
            data: childData("menu_items", id),
            updateTime,
            readTime,
          }],
          nextCursor: {
            version: firestore.ownerRecordGenerationMigrationFirestoreCursorVersion,
            scope: "child:coupons",
            targetUid: "another-owner",
            afterDocumentId: "not-the-returned-document",
          },
          readTime,
        };
      },
    }),
  };
  const inventory = await planner.collectOwnerRecordGenerationMigrationInventory({
    projectId,
    ownerUid: uid,
    now,
    firestoreStore: maliciousFirestore,
    storageStore:
      storage.createInMemoryOwnerRecordGenerationMigrationStorageInventory([]),
  });
  const pagination = inventory.pagination.find(
    (entry) => entry.scope === "menu_items",
  );
  assert.equal(
    pagination.nextCursor,
    "inventory-boundary-error",
  );
  assert.equal(JSON.stringify(inventory).includes("another-owner"), false);
  const plan = planner.planOwnerRecordGenerationMigration(inventory);
  assertManual(
    plan,
    "pagination_cursor_invalid",
    "inventory_incomplete",
  );
  const summary = planner.summarizeOwnerRecordGenerationMigrationPlan(plan);
  assert.equal(JSON.stringify(summary).includes(uid), false);
  assert.equal(JSON.stringify(summary).includes("another-owner"), false);
});

test("an invalid-cursor error is reduced to a fixed redacted sentinel", async () => {
  const unsafeDetail = `token-for-${uid}`;
  const invalidCursorError = new Error(unsafeDetail);
  invalidCursorError.code = "invalid_cursor";
  const maliciousFirestore = {
    runReadOnlyInventory: async (run) => run({
      getCanonicalAccountRoot: async () => null,
      getOwnerState: async () => null,
      getBillingState: async () => null,
      getSubscriptionReturnState: async () => null,
      listRemovalJobs: async () => {
        throw invalidCursorError;
      },
      listClaimedRatingRestaurants: async () => ({
        documents: [], nextCursor: null, readTime,
      }),
      listChildDocuments: async () => ({
        documents: [], nextCursor: null, readTime,
      }),
    }),
  };
  const inventory = await planner.collectOwnerRecordGenerationMigrationInventory({
    projectId,
    ownerUid: uid,
    now,
    firestoreStore: maliciousFirestore,
    storageStore:
      storage.createInMemoryOwnerRecordGenerationMigrationStorageInventory([]),
  });
  const pagination = inventory.pagination.find(
    (entry) => entry.scope === "removal_jobs",
  );
  assert.equal(
    pagination.nextCursor,
    "inventory-boundary-error",
  );
  assert.equal(JSON.stringify(inventory).includes(unsafeDetail), false);
  const plan = planner.planOwnerRecordGenerationMigration(inventory);
  assertManual(
    plan,
    "pagination_cursor_invalid",
    "inventory_incomplete",
  );
  const summary = planner.summarizeOwnerRecordGenerationMigrationPlan(plan);
  assert.equal(JSON.stringify(summary).includes(uid), false);
  assert.equal(JSON.stringify(summary).includes(unsafeDetail), false);
});

test("collector rejects non-monotonic Firestore and Storage boundaries", async () => {
  let firestoreCalls = 0;
  const emptyPage = {documents: [], nextCursor: null, readTime};
  const maliciousFirestore = {
    runReadOnlyInventory: async (run) => run({
      getCanonicalAccountRoot: async () => null,
      getOwnerState: async () => null,
      getBillingState: async () => null,
      getSubscriptionReturnState: async () => null,
      listRemovalJobs: async () => emptyPage,
      listClaimedRatingRestaurants: async () => emptyPage,
      listChildDocuments: async ({collection}) => {
        if (collection !== "menu_items") return emptyPage;
        firestoreCalls += 1;
        const id = firestoreCalls === 1 ? "z-item" : "a-item";
        return {
          documents: [{
            id,
            path: `restaurant_accounts/${uid}/menu_items/${id}`,
            data: childData("menu_items", id),
            updateTime,
            readTime,
          }],
          nextCursor: {
            version: firestore.ownerRecordGenerationMigrationFirestoreCursorVersion,
            scope: "child:menu_items",
            targetUid: uid,
            afterDocumentId: id,
          },
          readTime,
        };
      },
    }),
  };
  const firestoreInventory =
    await planner.collectOwnerRecordGenerationMigrationInventory({
      projectId,
      ownerUid: uid,
      now,
      firestoreStore: maliciousFirestore,
      storageStore:
        storage.createInMemoryOwnerRecordGenerationMigrationStorageInventory([]),
    });
  assert.equal(firestoreCalls, 2);
  assert.equal(
    firestoreInventory.pagination.find(
      (entry) => entry.scope === "menu_items",
    ).nextCursor,
    "inventory-boundary-error",
  );
  assertManual(
    planner.planOwnerRecordGenerationMigration(firestoreInventory),
    "pagination_cursor_invalid",
    "inventory_incomplete",
  );

  let storageCalls = 0;
  const storageName =
    `bitesaver_restaurants/${uid}/restaurant_images/repeated.png`;
  const maliciousStorage = {
    listObjects: async ({kind}) => {
      if (kind !== "restaurant_images") {
        return {objects: [], nextCursor: null};
      }
      storageCalls += 1;
      const token = `rotating-token-${storageCalls}`;
      return {
        objects: [object(kind, null, {name: storageName})],
        nextCursor: {
          version: storage.ownerRecordGenerationMigrationStorageCursorVersion,
          targetUid: uid,
          kind,
          pageToken: token,
          afterObjectName: storageName,
        },
      };
    },
  };
  const storageInventory =
    await planner.collectOwnerRecordGenerationMigrationInventory({
      projectId,
      ownerUid: uid,
      now,
      ...createStores(),
      storageStore: maliciousStorage,
    });
  assert.equal(storageCalls, 2);
  assert.equal(
    storageInventory.pagination.find(
      (entry) => entry.scope === "storage_restaurant_images",
    ).nextCursor,
    "inventory-boundary-error",
  );
  assert.equal(JSON.stringify(storageInventory).includes("rotating-token"), false);
  assertManual(
    planner.planOwnerRecordGenerationMigration(storageInventory),
    "pagination_cursor_invalid",
    "inventory_incomplete",
  );
});

test("unknown structural fields and pagination count mismatch cannot be ignored", async () => {
  const inventory = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]);
  const extraTop = {...inventory, unknownInScopeField: true};
  assert.throws(
    () => planner.planOwnerRecordGenerationMigration(extraTop),
    /inventory is invalid/iu,
  );
  const changed = {
    ...inventory,
    pagination: inventory.pagination.map((entry) => entry.scope === "coupons"
      ? {...entry, recordsRead: 1}
      : entry),
  };
  assertManual(
    planner.planOwnerRecordGenerationMigration(changed),
    "inventory_incomplete",
  );
});

test("nested inventory envelope extension fields fail closed", async () => {
  const base = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]);
  const cases = [
    {
      ...base,
      accountRoot: {...base.accountRoot, unexpectedEnvelopeField: true},
    },
    {
      ...base,
      children: base.children.map((group, index) => index === 0
        ? {...group, unexpectedEnvelopeField: true}
        : group),
    },
    {
      ...base,
      storage: base.storage.map((group, index) => index === 0
        ? {...group, unexpectedEnvelopeField: true}
        : group),
    },
    {
      ...base,
      pagination: base.pagination.map((entry, index) => index === 0
        ? {...entry, unexpectedEnvelopeField: true}
        : entry),
    },
    {
      ...base,
      inventoryIssues: [{
        code: "inventory_incomplete",
        documentPath: null,
        storageObjectName: null,
        existingGeneration: null,
        unexpectedEnvelopeField: true,
      }],
    },
  ];
  for (const inventory of cases) {
    const plan = planner.planOwnerRecordGenerationMigration(inventory);
    assert.equal(plan.classification, "manual_review_required");
    assert.deepEqual(plan.operations, []);
    contract.parseOwnerRecordGenerationMigrationPlan(plan);
  }
});

test("impossible pagination page bounds are manual, never safe", async () => {
  const inventory = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]);
  const impossible = {
    ...inventory,
    pagination: inventory.pagination.map((entry) => entry.scope === "coupons"
      ? {...entry, pagesRead: 101}
      : entry),
  };
  assertManual(
    planner.planOwnerRecordGenerationMigration(impossible),
    "inventory_bounds_exceeded",
  );
});

test("pagination lower and upper record bounds fail closed for both providers", async () => {
  const base = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]);
  for (const [scope, pagesRead, recordsRead] of [
    ["coupons", 2, 99],
    ["coupons", 2, 200],
    ["coupons", 2, 201],
    ["storage_menu_images", 2, 0],
    ["storage_menu_images", 2, 51],
  ]) {
    const inventory = {
      ...base,
      pagination: base.pagination.map((entry) => entry.scope === scope
        ? {...entry, pagesRead, recordsRead}
        : entry),
    };
    assertManual(
      planner.planOwnerRecordGenerationMigration(inventory),
      "inventory_bounds_exceeded",
      "inventory_incomplete",
    );
  }
});

test("normalized incomplete pagination preserves legal long cursor text", async () => {
  const base = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]);
  const longCursor = "x".repeat(2_000);
  const inventory = {
    ...base,
    pagination: base.pagination.map((entry) => entry.scope === "coupons"
      ? {...entry, complete: false, nextCursor: longCursor}
      : entry),
  };
  const plan = planner.planOwnerRecordGenerationMigration(inventory);
  assertManual(plan, "inventory_incomplete");
  assert.equal(
    plan.pagination.find((entry) => entry.scope === "coupons").nextCursor,
    longCursor,
  );
});

test("duplicate conflicting records normalize independently of source order", async () => {
  const base = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]);
  const doc = {
    id: "item-1",
    path: `restaurant_accounts/${uid}/menu_items/item-1`,
    data: childData("menu_items", "item-1", 0),
    updateTime,
    readTime,
  };
  const conflicting = {
    ...doc,
    data: childData("menu_items", "item-1", 1),
  };
  const withOrder = (documents) => ({
    ...base,
    children: base.children.map((group) => group.collection === "menu_items"
      ? {...group, documents}
      : group),
    pagination: base.pagination.map((entry) => entry.scope === "menu_items"
      ? {...entry, recordsRead: 2}
      : entry),
  });
  const left = planner.planOwnerRecordGenerationMigration(
    withOrder([doc, conflicting]),
  );
  const right = planner.planOwnerRecordGenerationMigration(
    withOrder([conflicting, doc]),
  );
  assertManual(left, "duplicate_document_path", "record_generation_newer");
  assert.equal(left.planId, right.planId);
  assert.equal(left.planHash, right.planHash);
});

test("duplicate Rating routing conflicts normalize independently of source order", async () => {
  const base = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData({
      menuSourceSide: "biteScore",
      linkedBiteScoreRestaurantId: "rating-1",
    })),
  ]);
  const first = {
    id: "rating-1",
    path: "bitescore_restaurants/rating-1",
    data: ratingData(undefined, {menuSourceSide: "biteScore"}),
    updateTime,
    readTime,
  };
  const cyclic = {
    ...first,
    data: ratingData(undefined, {
      menuSourceSide: "biteSaver",
      linkedBiteSaverUid: uid,
    }),
  };
  const withOrder = (ratingClaims) => ({
    ...base,
    ratingClaims,
    pagination: base.pagination.map((entry) => entry.scope === "rating_claims"
      ? {...entry, recordsRead: 2}
      : entry),
  });
  const left = planner.planOwnerRecordGenerationMigration(
    withOrder([first, cyclic]),
  );
  const right = planner.planOwnerRecordGenerationMigration(
    withOrder([cyclic, first]),
  );
  assertManual(left, "duplicate_document_path", "rating_claim_owner_conflict");
  assert.equal(left.planId, right.planId);
  assert.equal(left.planHash, right.planHash);
});

test("duplicate conflicting Storage objects normalize independently of source order", async () => {
  const base = await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]);
  const firstObject = object("restaurant_images", "0");
  const conflictingObject = object("restaurant_images", "1");
  const withOrder = (objects) => ({
    ...base,
    storage: base.storage.map((group) => group.kind === "restaurant_images"
      ? {...group, objects}
      : group),
    pagination: base.pagination.map((entry) =>
      entry.scope === "storage_restaurant_images"
        ? {...entry, recordsRead: 2}
        : entry),
  });
  const left = planner.planOwnerRecordGenerationMigration(
    withOrder([firstObject, conflictingObject]),
  );
  const right = planner.planOwnerRecordGenerationMigration(
    withOrder([conflictingObject, firstObject]),
  );
  assertManual(
    left,
    "duplicate_storage_object_name",
    "storage_generation_newer",
  );
  assert.equal(left.planId, right.planId);
  assert.equal(left.planHash, right.planHash);
});

test("active removal does not bypass validation of malformed in-scope data", async () => {
  const sourceGeneration = 0;
  const completionGeneration = 1;
  const jobId = removal.createOwnerRecordRemovalJobId({
    targetUid: uid,
    sourceGeneration,
  });
  const job = removal.buildOwnerRecordRemovalJobDocument({
    operation: removal.ownerRecordRemovalOperation,
    jobId,
    requestId: "planner-active-malformed-request",
    callerFingerprint: removal.createOwnerRecordRemovalCallerFingerprint(
      "planner-admin",
    ),
    targetUid: uid,
    status: "active",
    phase: "unclaim_rating_restaurants",
    sourceGeneration,
    completionGeneration,
    cutoverApplied: true,
    billingGateCategory: "inactive",
    failureCategory: null,
    ...removal.createEmptyOwnerRecordRemovalCounters(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
  const removingOwner = ownerState.buildOwnerRecordStateDocument({
    ownerUid: uid,
    generation: completionGeneration,
    state: "removing",
    activeJobId: jobId,
    createdAt: now,
    updatedAt: now,
  });
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`private_owner_record_states/${uid}`, removingOwner),
    fixture(`private_owner_record_removal_jobs/${jobId}`, job),
    fixture(
      `restaurant_accounts/${uid}`,
      rootData({ownerRecordGeneration: completionGeneration}),
    ),
    fixture(`restaurant_accounts/${uid}/menu_items/item-1`, {
      ownerRecordGeneration: completionGeneration,
      unexpected: true,
    }),
  ]));
  assertManual(plan, "active_removal_job", "record_shape_unrecognized");
});

test("operation precondition changes alter deterministic plan identity", async () => {
  const first = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]));
  const second = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(
      `restaurant_accounts/${uid}`,
      rootData(),
      {seconds: String(Number(updateTime.seconds) + 1), nanoseconds: 0},
    ),
  ]));
  assert.equal(first.classification, "legacy_safe_candidate");
  assert.equal(second.classification, "legacy_safe_candidate");
  assert.notEqual(first.planId, second.planId);
  assert.notEqual(first.planHash, second.planHash);
});

test("summary wrapper is aggregate-only and contains no owner identifier", async () => {
  const plan = planner.planOwnerRecordGenerationMigration(await collect([
    fixture(`restaurant_accounts/${uid}`, rootData()),
  ]));
  const summary = planner.summarizeOwnerRecordGenerationMigrationPlan(plan);
  assert.equal(summary.planCount, 1);
  assert.equal(summary.classificationCounts.legacy_safe_candidate, 1);
  assert.equal(JSON.stringify(summary).includes(uid), false);
  assert.deepEqual(Object.keys(summary).sort(), [
    "classificationCounts",
    "incompletePaginationScopeCount",
    "manualReviewReasonCounts",
    "operationCounts",
    "planCount",
    "schemaVersion",
  ]);
});
