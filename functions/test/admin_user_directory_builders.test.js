"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAdminUserClaimedRestaurantDocument,
  buildAdminUserDirectoryDocument,
  buildAdminUserSourceSummary,
  normalizeAdminUserEmail,
  normalizeAdminUserPhone,
} = require("../lib/admin_user_directory_builders.js");
const {
  adminUserClaimedRestaurantVersion,
  adminUserDirectoryVersion,
  adminUserSourceKinds,
  adminUserSourceSummaryVersion,
  createAdminUserClaimedRestaurantId,
  createAdminUserSourceSummaryId,
  maximumAdminUserDirectoryDocumentBytes,
  serializedAdminUserDocumentBytes,
} = require("../lib/admin_user_directory_contract.js");

const now = new Date("2026-08-09T16:00:00.000Z");
const earlier = new Date("2026-08-08T16:00:00.000Z");

function restaurant(overrides = {}) {
  return {
    name: "Current Restaurant",
    address: "1 Main Street",
    city: "Crystal River",
    state: "FL",
    zipCode: "34428",
    location: {latitude: 28.9, longitude: -82.6},
    ownerUserId: "user-1",
    isClaimed: true,
    isActive: true,
    createdAt: earlier,
    updatedAt: now,
    ...overrides,
  };
}

function sourceData(kind, uid = "user-1", overrides = {}) {
  const base = {createdAt: earlier, updatedAt: now};
  const sources = {
    restaurantAccount: {
      ...base,
      uid,
      restaurantName: "Coupon Account Name",
      email: "Owner@Example.Test",
      phoneNumber: "(352) 555-0100",
      approvalStatus: "approved",
      emailVerified: true,
    },
    userProfile: {
      ...base,
      userId: uid,
      displayName: "Private Profile Name",
      email: "Profile@Example.Test",
      phoneNumber: "352-555-0101",
      contributionPoints: 17,
      lastContributionAt: now,
    },
    publicReviewerProfile: {
      ...base,
      userId: uid,
      publicDisplayName: "Public Name",
      chosenUsername: "Chosen Name",
      fallbackUsername: "fallback_name",
      phoneNumber: "+1 352 555 0102",
    },
    biteScoreRestaurant: restaurant({ownerUserId: uid}),
    restaurantClaimRequest: {
      ...base,
      requesterUserId: uid,
      restaurantId: "restaurant-1",
      restaurantName: "Claimed Place",
      claimantName: "Claim Identity Name",
      email: "Claim@Example.Test",
      phone: "3525550103",
      status: "pending",
    },
    dishReview: {
      ...base,
      userId: uid,
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      overallImpression: 8,
    },
    reviewReport: {
      ...base,
      reportingUserId: uid,
      reviewId: "review-1",
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      status: "pending",
    },
    restaurantReport: {
      ...base,
      reportingUserId: uid,
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant",
      status: "pending",
    },
    dishReport: {
      ...base,
      reportingUserId: uid,
      dishId: "dish-1",
      dishName: "Dish",
      restaurantId: "restaurant-1",
      status: "pending",
    },
    duplicateRestaurantReport: {
      ...base,
      reportingUserId: uid,
      restaurantId: "restaurant-1",
      restaurantName: "Restaurant",
      status: "pending",
    },
    dishEditProposal: {
      ...base,
      userId: uid,
      type: "rename",
      restaurantId: "restaurant-1",
      targetDishId: "dish-1",
      status: "pending",
    },
    reviewFeedbackVote: {
      ...base,
      userId: uid,
      reviewId: "review-1",
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      voteType: "helpful",
    },
  };
  return {...sources[kind], ...overrides};
}

function sourceId(kind, uid = "user-1") {
  if (["restaurantAccount", "userProfile", "publicReviewerProfile"].includes(kind)) {
    return uid;
  }
  return `${kind}-document`;
}

function summary(kind, overrides = {}, uid = "user-1") {
  return buildAdminUserSourceSummary({
    uid,
    sourceKind: kind,
    representative: {
      id: sourceId(kind, uid),
      data: sourceData(kind, uid, overrides),
    },
    latestActivityAt: now,
    now,
  });
}

test("version contracts and deterministic IDs are exact and tuple-safe", () => {
  assert.equal(adminUserDirectoryVersion, "bitestar.admin-user-directory.v1");
  assert.equal(adminUserSourceSummaryVersion, "bitestar.admin-user-source-summary.v1");
  assert.equal(
    adminUserClaimedRestaurantVersion,
    "bitestar.admin-user-claimed-restaurant.v1",
  );
  const first = createAdminUserSourceSummaryId({
    uid: "a:b",
    sourceKind: "userProfile",
  });
  const second = createAdminUserSourceSummaryId({
    uid: "a",
    sourceKind: "publicReviewerProfile",
  });
  assert.match(first, /^auss_[0-9a-f]{64}$/u);
  assert.notEqual(first, second);
  assert.equal(
    first,
    createAdminUserSourceSummaryId({uid: "a:b", sourceKind: "userProfile"}),
  );
  assert.match(createAdminUserClaimedRestaurantId("restaurant-1"), /^aucr_[0-9a-f]{64}$/u);
  assert.throws(() => createAdminUserClaimedRestaurantId("bad/id"));
});

test("Users identity precedence remains account, private, public, then claim", () => {
  const directory = buildAdminUserDirectoryDocument({
    uid: "user-1",
    summaries: [
      summary("restaurantAccount"),
      summary("userProfile"),
      summary("publicReviewerProfile"),
      summary("restaurantClaimRequest"),
    ],
    now,
  });
  assert.equal(directory.displayName, "Claim Identity Name");
  assert.equal(directory.displayEmail, "Claim@Example.Test");
  assert.equal(directory.normalizedEmail, "claim@example.test");
  assert.equal(directory.displayPhone, "3525550103");
  assert.equal(directory.normalizedPhone, "+13525550103");
});

test("User Points display identity remains public, chosen, fallback, private, UID", () => {
  const profile = summary("userProfile");
  const publicDisplay = summary("publicReviewerProfile");
  let directory = buildAdminUserDirectoryDocument({
    uid: "user-1",
    summaries: [profile, publicDisplay],
    now,
  });
  assert.equal(directory.userPointsDisplayName, "Public Name");

  const chosen = summary("publicReviewerProfile", {publicDisplayName: null});
  directory = buildAdminUserDirectoryDocument({uid: "user-1", summaries: [profile, chosen], now});
  assert.equal(directory.userPointsDisplayName, "Chosen Name");

  const fallback = summary("publicReviewerProfile", {
    publicDisplayName: null,
    chosenUsername: null,
  });
  directory = buildAdminUserDirectoryDocument({uid: "user-1", summaries: [profile, fallback], now});
  assert.equal(directory.userPointsDisplayName, "fallback_name");
  directory = buildAdminUserDirectoryDocument({uid: "user-1", summaries: [profile], now});
  assert.equal(directory.userPointsDisplayName, "Private Profile Name");
  directory = buildAdminUserDirectoryDocument({
    uid: "user-1",
    summaries: [summary("dishReview")],
    now,
  });
  assert.equal(directory.userPointsDisplayName, "user-1");
});

test("Unicode punctuation normalization and word-prefix tokens reuse the shared contract", () => {
  const publicProfile = summary("publicReviewerProfile", {
    publicDisplayName: "José's BBQ",
  });
  const directory = buildAdminUserDirectoryDocument({
    uid: "user-1",
    summaries: [publicProfile],
    now,
  });
  assert.equal(directory.normalizedDisplayName, "joses bbq");
  assert.deepEqual(
    ["jo", "jos", "jose", "joses", "bb", "bbq"].every((token) =>
      directory.displayNamePrefixTokens.includes(token)),
    true,
  );
});

test("email and phone normalization preserve current exact-search equivalence", () => {
  assert.equal(normalizeAdminUserEmail(" User@Example.Test "), "user@example.test");
  assert.equal(normalizeAdminUserEmail("not-an-email"), null);
  assert.equal(normalizeAdminUserPhone("(352) 555-0100"), "+13525550100");
  assert.equal(normalizeAdminUserPhone("1-352-555-0100"), "+13525550100");
  assert.equal(normalizeAdminUserPhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizeAdminUserPhone("123"), null);
});

test("positive, zero, negative, and absent point populations are explicit", () => {
  for (const points of [9, 0, -3]) {
    const profile = summary("userProfile", {contributionPoints: points});
    const directory = buildAdminUserDirectoryDocument({uid: "user-1", summaries: [profile], now});
    assert.equal(directory.contributionPoints, points);
    assert.equal(directory.includedInUserPointsDirectory, true);
  }
  const noActivity = summary("userProfile", {
    contributionPoints: null,
    lastContributionAt: null,
  });
  const directory = buildAdminUserDirectoryDocument({
    uid: "user-1",
    summaries: [noActivity],
    now,
  });
  assert.equal(directory.contributionPoints, 0);
  assert.equal(directory.lastContributionAt, null);
  assert.equal(directory.includedInUserPointsDirectory, false);
});

test("all current role, account, and activity semantics derive from source kinds", () => {
  const summaries = adminUserSourceKinds.map((kind) => summary(kind));
  const directory = buildAdminUserDirectoryDocument({uid: "user-1", summaries, now});
  assert.equal(directory.roleCouponOwner, true);
  assert.equal(directory.roleBiteScoreOwner, true);
  assert.equal(directory.roleClaimant, true);
  assert.equal(directory.roleCustomer, true);
  assert.equal(directory.activityProfile, true);
  assert.equal(directory.activityReviews, true);
  assert.equal(directory.activityReports, true);
  assert.equal(directory.activityDishSuggestions, true);
  assert.equal(directory.activityReviewVotes, true);
  assert.equal(directory.claimedRestaurantOwner, true);
  assert.deepEqual(directory.sourceKinds, adminUserSourceKinds);
});

test("removing one category removes only its contribution and no summaries means no directory", () => {
  const profile = summary("userProfile");
  const claim = summary("restaurantClaimRequest");
  const withClaim = buildAdminUserDirectoryDocument({uid: "user-1", summaries: [profile, claim], now});
  const withoutClaim = buildAdminUserDirectoryDocument({uid: "user-1", summaries: [profile], now});
  assert.equal(withClaim.roleClaimant, true);
  assert.equal(withoutClaim.roleClaimant, false);
  assert.equal(withoutClaim.displayName, "Private Profile Name");
  assert.equal(buildAdminUserDirectoryDocument({uid: "user-1", summaries: [], now}), null);
});

test("claimed-restaurant index handles owner, rename, owner removal, inactive state, and delete", () => {
  const first = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant(),
    now,
  });
  assert.equal(first.ownerUid, "user-1");
  assert.equal(first.sourceRestaurantId, "restaurant-1");
  assert.equal(first.isClaimed, true);
  assert.equal(first.displayRestaurantName, "Current Restaurant");
  assert.equal(first.normalizedRestaurantName, "current restaurant");
  assert.equal(first.restaurantNamePrefixTokens.includes("rest"), true);
  assert.equal(
    createAdminUserClaimedRestaurantId(first.sourceRestaurantId),
    createAdminUserClaimedRestaurantId("restaurant-1"),
  );

  const renamed = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant({name: "Renamed Grill"}),
    now,
  });
  assert.notEqual(renamed.sourceFingerprint, first.sourceFingerprint);
  assert.equal(renamed.normalizedRestaurantName, "renamed grill");
  assert.equal(
    buildAdminUserClaimedRestaurantDocument({
      sourceRestaurantId: "restaurant-1",
      source: restaurant({ownerUserId: null, isClaimed: false}),
      now,
    }),
    null,
  );
  const inactive = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant({isActive: false}),
    now,
  });
  assert.equal(inactive.isActive, false);
  assert.equal(
    buildAdminUserClaimedRestaurantDocument({sourceRestaurantId: "restaurant-1", source: null, now}),
    null,
  );
});

test("strict restaurant active state ignores legacy alias and fingerprints canonical state", () => {
  const strictLegacyFalse = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant({isActive: undefined, active: false}),
    now,
  });
  const strictLegacyTrue = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant({isActive: undefined, active: true}),
    now,
  });
  const canonicalTrue = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant({isActive: true, active: false}),
    now,
  });
  const canonicalFalse = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant({isActive: false, active: true}),
    now,
  });
  const missingBoth = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant({isActive: undefined, active: undefined}),
    now,
  });

  assert.equal(strictLegacyFalse.isActive, true);
  assert.equal(strictLegacyTrue.isActive, true);
  assert.equal(canonicalTrue.isActive, true);
  assert.equal(canonicalFalse.isActive, false);
  assert.equal(missingBoth.isActive, true);
  assert.equal(
    strictLegacyFalse.sourceFingerprint,
    strictLegacyTrue.sourceFingerprint,
  );
  assert.notEqual(
    canonicalFalse.sourceFingerprint,
    canonicalTrue.sourceFingerprint,
  );
});

test("finder restaurant active state uses canonical then legacy precedence", () => {
  function finderSource(overrides = {}) {
    return restaurant({
      name: undefined,
      restaurantName: "Finder-Compatible Restaurant",
      address: "1 Main Street, Crystal River, FL 34428, USA",
      city: undefined,
      zipCode: undefined,
      location: undefined,
      isActive: undefined,
      active: undefined,
      ...overrides,
    });
  }

  const legacyFalse = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: finderSource({active: false}),
    now,
  });
  const legacyTrue = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: finderSource({active: true}),
    now,
  });
  const canonicalTrue = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: finderSource({isActive: true, active: false}),
    now,
  });
  const canonicalFalse = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: finderSource({isActive: false, active: true}),
    now,
  });
  const missingBoth = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: finderSource(),
    now,
  });

  assert.equal(legacyFalse.isActive, false);
  assert.equal(legacyTrue.isActive, true);
  assert.equal(canonicalTrue.isActive, true);
  assert.equal(canonicalFalse.isActive, false);
  assert.equal(missingBoth.isActive, true);
  assert.notEqual(legacyFalse.sourceFingerprint, legacyTrue.sourceFingerprint);
});

test("claimed-restaurant index rejects source records the current parser would omit", () => {
  const finderCompatible = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant({
      name: undefined,
      restaurantName: "Finder-Compatible Restaurant",
      address: "1 Main Street, Crystal River, FL 34428, USA",
      city: undefined,
      zipCode: undefined,
      location: undefined,
      isActive: undefined,
      active: false,
    }),
    now,
  });
  assert.equal(finderCompatible.displayRestaurantName, "Finder-Compatible Restaurant");
  assert.equal(finderCompatible.isActive, false);
  assert.equal(
    buildAdminUserClaimedRestaurantDocument({
      sourceRestaurantId: "restaurant-1",
      source: restaurant({
        name: undefined,
        restaurantName: undefined,
        city: undefined,
        address: "unparseable",
        location: null,
        latitude: null,
        longitude: null,
      }),
      now,
    }),
    null,
  );
});

test("review population accepts current-parser zero scores and rejects missing scores", () => {
  assert.notEqual(summary("dishReview", {overallImpression: 0}), null);
  assert.equal(
    summary("dishReview", {
      overallImpression: null,
      qualityScore: null,
      tastinessScore: null,
      tasteScore: null,
      overallBiteScore: 0,
    }),
    null,
  );
});

test("record-only identities require no Auth fixture", () => {
  const directory = buildAdminUserDirectoryDocument({
    uid: "record-only-user",
    summaries: [summary("restaurantReport", {}, "record-only-user")],
    now,
  });
  assert.equal(directory.uid, "record-only-user");
  assert.equal(directory.displayName, "record-only-user");
  assert.equal(directory.sourceKinds.includes("restaurantReport"), true);
});

test("privacy canaries never enter summaries, directory, claimed index, IDs, or serialized JSON", () => {
  const canaries = [
    "PASSWORD_HASH_CANARY",
    "OAUTH_ACCESS_CANARY",
    "OAUTH_REFRESH_CANARY",
    "FIREBASE_AUTH_TOKEN_CANARY",
    "CUSTOM_CLAIMS_CANARY",
    "STRIPE_CUSTOMER_CANARY",
    "STRIPE_SUBSCRIPTION_CANARY",
    "PAYMENT_METADATA_CANARY",
    "INVITE_TOKEN_CANARY",
    "INVITE_HASH_CANARY",
    "REVIEW_BODY_CANARY",
    "REPORT_BODY_CANARY",
    "MODERATION_NOTES_CANARY",
    "ARBITRARY_PRIVATE_CANARY",
  ];
  const privatePayload = {
    passwordHash: canaries[0],
    oauthAccessToken: canaries[1],
    oauthRefreshToken: canaries[2],
    firebaseAuthToken: canaries[3],
    customClaims: {payload: canaries[4]},
    stripeCustomerId: canaries[5],
    stripeSubscriptionId: canaries[6],
    paymentMetadata: {value: canaries[7]},
    inviteToken: canaries[8],
    inviteTokenHash: canaries[9],
    notes: canaries[10],
    reportBody: canaries[11],
    moderationNotes: canaries[12],
    arbitraryPrivateData: {nested: canaries[13]},
  };
  const summaries = adminUserSourceKinds.map((kind) =>
    summary(kind, privatePayload));
  const directory = buildAdminUserDirectoryDocument({uid: "user-1", summaries, now});
  const claimed = buildAdminUserClaimedRestaurantDocument({
    sourceRestaurantId: "restaurant-1",
    source: restaurant(privatePayload),
    now,
  });
  const serialized = JSON.stringify({summaries, directory, claimed});
  const ids = [
    ...adminUserSourceKinds.map((sourceKind) =>
      createAdminUserSourceSummaryId({uid: "user-1", sourceKind})),
    createAdminUserClaimedRestaurantId("restaurant-1"),
  ].join("|");
  for (const canary of canaries) {
    assert.equal(serialized.includes(canary), false, canary);
    assert.equal(ids.includes(canary), false, canary);
  }
});

test("maximum normal fixture remains far below 64 KiB with bounded arrays only", () => {
  const summaries = adminUserSourceKinds.map((kind) => summary(kind));
  const directory = buildAdminUserDirectoryDocument({uid: "user-1", summaries, now});
  const bytes = serializedAdminUserDocumentBytes(directory);
  assert.ok(bytes < maximumAdminUserDirectoryDocumentBytes / 4, bytes);
  assert.ok(directory.sourceKinds.length <= adminUserSourceKinds.length);
  assert.ok(directory.displayNamePrefixTokens.length <= 128);
});
