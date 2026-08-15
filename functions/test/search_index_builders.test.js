"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {GeoPoint} = require("firebase-admin/firestore");

const {
  biteSaverOfferParentFingerprint,
  biteScoreDishParentFingerprint,
  biteScoreRestaurantClaimProjection,
  biteScoreRestaurantIsActive,
  boundedDescriptionSummary,
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverDailySpecialOfferIndex,
  buildBiteSaverRestaurantIndex,
  buildBiteScoreDishIndex,
  buildBiteScoreRestaurantIndex,
  maximumDishCategorySourceCount,
  maximumOfferDescriptionLength,
  maximumSearchLocationTextLength,
} = require("../lib/search_index_builders.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");
const {
  maximumSearchIndexDocumentBytes,
  serializedSearchIndexDocumentBytes,
} = require("../lib/search_index_contract.js");

const now = new Date("2026-08-08T16:00:00.000Z");
const coordinates = Object.freeze({latitude: 28.8517, longitude: -82.487});
const geohash = canonicalRestaurantGeohash(coordinates);
const canaries = Object.freeze([
  "private-email-canary@example.test",
  "private-phone-canary",
  "cus_private_stripe_canary",
  "sub_private_subscription_canary",
  "private-owner-auth-token-canary",
  "private-invite-token-canary",
  "private-invite-hash-canary",
  "private-payment-metadata-canary",
  "private-moderation-notes-canary",
  "private-redemption-history-canary",
  "private-nested-data-canary",
  "private-client-normalized-token-canary",
]);

function privateCanaryFields() {
  return {
    email: canaries[0],
    phone: canaries[1],
    stripeCustomerId: canaries[2],
    subscriptionId: canaries[3],
    ownerUid: canaries[4],
    authToken: canaries[4],
    inviteToken: canaries[5],
    inviteTokenHash: canaries[6],
    paymentMetadata: {value: canaries[7]},
    moderationNotes: canaries[8],
    redemptionHistory: [canaries[9]],
    arbitraryPrivateData: {nested: canaries[10]},
    normalizedName: canaries[11],
    namePrefixTokens: [canaries[11]],
    publicVisible: false,
  };
}

function assertCanariesAbsent(value) {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) {
    assert.equal(serialized.includes(canary), false, canary);
  }
}

function biteSaverRestaurant(overrides = {}) {
  return {
    restaurantName: "BiteStar Café",
    city: " Crystal River ",
    state: "fl",
    zipCode: "34428-1234",
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    geohash,
    approvalStatus: "approved",
    couponApplicationSubmitted: true,
    subscriptionStatus: "active",
    couponPostingEnabled: true,
    mainImageUrl: "https://images.example.test/restaurant.jpg",
    website: "https://restaurant.example.test",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-08T15:00:00.000Z"),
    ...overrides,
  };
}

function biteScoreRestaurant(overrides = {}) {
  return {
    name: "The Copper Spoon",
    city: "Ocala",
    state: "FL",
    zipCode: "34470",
    location: new GeoPoint(coordinates.latitude, coordinates.longitude),
    geohash,
    isActive: true,
    isClaimed: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-08T15:00:00.000Z"),
    ...overrides,
  };
}

function biteScoreRestaurantWithActivity(activity, overrides = {}) {
  const source = biteScoreRestaurant(overrides);
  delete source.isActive;
  return Object.assign(source, activity);
}

function dish(overrides = {}) {
  return {
    id: "dish-1",
    restaurantId: "restaurant-1",
    restaurantName: "stale source name",
    name: "Wood-Fired Pizza",
    category: "Dinner",
    subcategory: "Pizza",
    categoryTags: ["Italian", "Family Friendly"],
    isActive: true,
    primaryImageId: "image-1",
    primaryImageUrl: "https://images.example.test/dish.jpg",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-08T15:00:00.000Z"),
    ...overrides,
  };
}

function aggregate(overrides = {}) {
  return {
    dishId: "dish-1",
    restaurantId: "restaurant-1",
    overallBiteScore: 8.5,
    ratingCount: 12,
    overallImpressionAverage: 8.7,
    tastinessScoreAverage: 9.1,
    qualityScoreAverage: 8.2,
    valueScoreAverage: 7.9,
    updatedAt: new Date("2026-08-08T15:30:00.000Z"),
    ...overrides,
  };
}

function coupon(overrides = {}) {
  return {
    id: "coupon-1",
    restaurant: "stale source restaurant name",
    title: "Half-Price Entrée",
    details: "One entrée per table.",
    imageUrl: "https://images.example.test/coupon.jpg",
    startTime: new Date(now.getTime() - 60_000),
    endTime: new Date(now.getTime() + 60_000),
    isProximityOnly: false,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-08T15:00:00.000Z"),
    ...overrides,
  };
}

function dailySpecial(overrides = {}) {
  const weekday = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  return {
    id: "special-1",
    restaurantId: "account-1",
    ownerUid: "account-1",
    title: "Chef's Daily Plate",
    details: "Available while supplies last.",
    isActive: true,
    availabilityMode: "specificDays",
    daysOfWeek: [weekday],
    allDay: true,
    hideWhenUnavailable: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-08T15:00:00.000Z"),
    ...overrides,
  };
}

test("BiteSaver restaurant projection derives exact visibility and canonical search fields", () => {
  const approved = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-1",
    source: biteSaverRestaurant(),
    now,
  });
  assert.equal(approved.searchIndexVersion, "bitestar.search-index.v1");
  assert.equal(approved.entityType, "restaurant");
  assert.equal(approved.source, "biteSaver");
  assert.equal(approved.displayName, "BiteStar Café");
  assert.equal(approved.normalizedName, "bitestar cafe");
  assert.ok(approved.namePrefixTokens.includes("bite"));
  assert.equal(approved.zip5, "34428");
  assert.equal(approved.normalizedCity, "crystal river");
  assert.equal(approved.normalizedState, "FL");
  assert.equal(approved.cityStateKey, "FL|crystal river");
  assert.equal(approved.geohash, geohash);
  assert.equal(approved.publicVisible, true);
  assert.equal(approved.adminDirectoryVisible, true);

  for (const approvalStatus of ["pending", "rejected", "private"]) {
    const hidden = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `account-${approvalStatus}`,
      source: biteSaverRestaurant({approvalStatus}),
      now,
    });
    assert.equal(hidden.publicVisible, false, approvalStatus);
    assert.equal(hidden.adminDirectoryVisible, false, approvalStatus);
  }
});

test("BiteSaver public projections require the exact trusted posting flag", () => {
  const missingFlag = biteSaverRestaurant();
  delete missingFlag.couponPostingEnabled;
  const deniedRestaurants = [
    {
      label: "active status with a false flag",
      source: biteSaverRestaurant({
        subscriptionStatus: "active",
        couponPostingEnabled: false,
      }),
    },
    {
      label: "trialing status with a false flag",
      source: biteSaverRestaurant({
        subscriptionStatus: "trialing",
        couponPostingEnabled: false,
      }),
    },
    ...["past_due", "unpaid", "incomplete", "paused", "inactive"].map(
      (subscriptionStatus) => ({
        label: `${subscriptionStatus} with a false flag`,
        source: biteSaverRestaurant({
          subscriptionStatus,
          couponPostingEnabled: false,
        }),
      }),
    ),
    {label: "missing flag", source: missingFlag},
    {
      label: "malformed flag",
      source: biteSaverRestaurant({couponPostingEnabled: "true"}),
    },
  ];

  for (const fixture of deniedRestaurants) {
    const restaurantIndex = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `restaurant-${fixture.label}`,
      source: fixture.source,
      now,
    });
    const couponIndex = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `coupon-${fixture.label}`,
      offer: coupon(),
      restaurant: fixture.source,
      now,
    });
    const dailySpecialIndex = buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `special-${fixture.label}`,
      offer: dailySpecial(),
      restaurant: fixture.source,
      now,
    });

    assert.notEqual(restaurantIndex, null, fixture.label);
    assert.equal(restaurantIndex.publicVisible, false, fixture.label);
    assert.equal(restaurantIndex.adminDirectoryVisible, true, fixture.label);
    assert.notEqual(couponIndex, null, fixture.label);
    assert.equal(couponIndex.publicVisible, false, fixture.label);
    assert.equal(couponIndex.adminVisible, true, fixture.label);
    assert.notEqual(dailySpecialIndex, null, fixture.label);
    assert.equal(dailySpecialIndex.publicVisible, false, fixture.label);
    assert.equal(dailySpecialIndex.adminVisible, true, fixture.label);
  }
});

test("BiteSaver Admin hidden veto covers restaurant, coupon, and daily-special projections", () => {
  for (const adminHidden of [undefined, false, true]) {
    const restaurant = biteSaverRestaurant({
      ...(adminHidden === undefined ? {} : {adminHidden}),
    });
    const restaurantIndex = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `restaurant-${String(adminHidden)}`,
      source: restaurant,
      now,
    });
    const couponIndex = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `coupon-${String(adminHidden)}`,
      offer: coupon(),
      restaurant,
      now,
    });
    const dailySpecialIndex = buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `special-${String(adminHidden)}`,
      offer: dailySpecial(),
      restaurant,
      now,
    });
    const expectedPublicVisibility = adminHidden !== true;

    assert.equal(restaurantIndex.publicVisible, expectedPublicVisibility);
    assert.equal(restaurantIndex.adminDirectoryVisible, true);
    assert.equal(couponIndex.publicVisible, expectedPublicVisibility);
    assert.equal(couponIndex.adminVisible, true);
    assert.equal(dailySpecialIndex.publicVisible, expectedPublicVisibility);
    assert.equal(dailySpecialIndex.adminVisible, true);
  }
});

test("scheduled cancellation retains public visibility while the trusted flag is true", () => {
  for (const subscriptionStatus of ["active", "trialing"]) {
    const restaurant = biteSaverRestaurant({
      subscriptionStatus,
      couponPostingEnabled: true,
      cancelAtPeriodEnd: true,
      subscriptionEndsAt: new Date(now.getTime() + 86_400_000),
      trialEndsAt: new Date(now.getTime() - 1),
    });
    const restaurantIndex = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `restaurant-${subscriptionStatus}`,
      source: restaurant,
      now,
    });
    const couponIndex = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `coupon-${subscriptionStatus}`,
      offer: coupon(),
      restaurant,
      now,
    });
    const dailySpecialIndex = buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `special-${subscriptionStatus}`,
      offer: dailySpecial(),
      restaurant,
      now,
    });

    assert.equal(restaurantIndex.publicVisible, true, subscriptionStatus);
    assert.equal(couponIndex.publicVisible, true, subscriptionStatus);
    assert.equal(dailySpecialIndex.publicVisible, true, subscriptionStatus);
  }
});

test("BiteSaver restaurant tolerates invalid optional modes but never indexes an invalid name", () => {
  const invalidZip = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-invalid-zip",
    source: biteSaverRestaurant({zipCode: "34BAD"}),
    now,
  });
  assert.equal(Object.hasOwn(invalidZip, "zip5"), false);
  assert.equal(invalidZip.cityStateKey, "FL|crystal river");

  const invalidCityState = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-invalid-city",
    source: biteSaverRestaurant({city: "", state: "XX"}),
    now,
  });
  assert.equal(Object.hasOwn(invalidCityState, "cityStateKey"), false);
  assert.equal(invalidCityState.zip5, "34428");

  const oversizedCity = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-oversized-city",
    source: biteSaverRestaurant({city: "c".repeat(maximumSearchLocationTextLength + 1)}),
    now,
  });
  assert.equal(Object.hasOwn(oversizedCity, "normalizedCity"), false);

  for (const source of [
    biteSaverRestaurant({latitude: undefined, longitude: undefined, geohash: undefined}),
    biteSaverRestaurant({latitude: 999, longitude: -82}),
    biteSaverRestaurant({geohash: "wrong-geohash"}),
  ]) {
    const withoutRadius = buildBiteSaverRestaurantIndex({
      sourceDocumentId: "account-no-radius",
      source,
      now,
    });
    assert.equal(Object.hasOwn(withoutRadius, "location"), false);
    assert.equal(Object.hasOwn(withoutRadius, "geohash"), false);
  }
  assert.equal(buildBiteSaverRestaurantIndex({sourceDocumentId: "deleted", source: null, now}), null);
  assert.equal(buildBiteSaverRestaurantIndex({
    sourceDocumentId: "nameless",
    source: biteSaverRestaurant({restaurantName: " "}),
    now,
  }), null);
  assert.equal(buildBiteSaverRestaurantIndex({
    sourceDocumentId: "long-name",
    source: biteSaverRestaurant({restaurantName: "x".repeat(101)}),
    now,
  }), null);
});

test("BiteSaver restaurant name/address changes produce safe changed fingerprints", () => {
  const original = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-1",
    source: biteSaverRestaurant(),
    now,
  });
  const changed = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-1",
    source: biteSaverRestaurant({restaurantName: "Renamed Café", city: "Ocala", zipCode: "34470"}),
    now,
  });
  assert.equal(changed.displayName, "Renamed Café");
  assert.equal(changed.normalizedCity, "ocala");
  assert.equal(changed.zip5, "34470");
  assert.notEqual(changed.sourceFingerprint, original.sourceFingerprint);
});

test("BiteScore restaurant supports canonical and imported aliases with active Admin posture", () => {
  const active = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-1",
    source: biteScoreRestaurant({isClaimed: true, ownerUserId: "owner-1"}),
    now,
  });
  assert.equal(active.publicVisible, true);
  assert.equal(active.adminDirectoryVisible, true);
  assert.equal(active.isClaimed, true);
  assert.equal(active.zip5, "34470");

  const inactive = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-2",
    source: biteScoreRestaurant({isActive: false, isClaimed: false}),
    now,
  });
  assert.equal(inactive.publicVisible, false);
  assert.equal(inactive.adminDirectoryVisible, true);

  const aliases = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-imported",
    source: {
      restaurant_name: " Imported Diner ",
      locality: "Ocala",
      stateCode: "fl",
      postalCode: "03440-1234",
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      geohash,
      active: true,
    },
    now,
  });
  assert.equal(aliases.displayName, "Imported Diner");
  assert.equal(aliases.zip5, "03440");
  assert.equal(aliases.cityStateKey, "FL|ocala");
});

test("BiteScore activity is strict across public restaurant and parent-dish projections", () => {
  const cases = [
    {label: "both absent", activity: {}, expected: true},
    {label: "canonical true", activity: {isActive: true}, expected: true},
    {label: "canonical false", activity: {isActive: false}, expected: false},
    {label: "legacy true", activity: {active: true}, expected: true},
    {label: "legacy false", activity: {active: false}, expected: false},
    {label: "both true", activity: {isActive: true, active: true}, expected: true},
    {label: "both false", activity: {isActive: false, active: false}, expected: false},
    {label: "canonical conflict", activity: {isActive: true, active: false}, expected: false},
    {label: "legacy conflict", activity: {isActive: false, active: true}, expected: false},
    {label: "malformed canonical", activity: {isActive: "true"}, expected: false},
    {label: "malformed legacy", activity: {active: null}, expected: false},
    {label: "valid plus malformed", activity: {isActive: true, active: 1}, expected: false},
  ];

  for (const fixture of cases) {
    const source = biteScoreRestaurantWithActivity(fixture.activity, {
      isClaimed: true,
      ownerUserId: "owner-1",
    });
    assert.equal(
      biteScoreRestaurantIsActive(source),
      fixture.expected,
      fixture.label,
    );

    const restaurantIndex = buildBiteScoreRestaurantIndex({
      sourceDocumentId: "restaurant-activity",
      source,
      now,
    });
    assert.equal(restaurantIndex.isActive, fixture.expected, fixture.label);
    assert.equal(restaurantIndex.publicVisible, fixture.expected, fixture.label);
    assert.equal(restaurantIndex.adminDirectoryVisible, true, fixture.label);
    assert.equal(restaurantIndex.isClaimed, true, fixture.label);
    assert.equal(
      restaurantIndex.claimStateValid,
      fixture.expected,
      fixture.label,
    );
    assert.equal(restaurantIndex.claimAvailable, false, fixture.label);

    const dishIndex = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish(),
      restaurantDocumentId: "restaurant-1",
      restaurant: source,
      aggregate: aggregate(),
      now,
    });
    assert.equal(dishIndex.restaurantActive, fixture.expected, fixture.label);
    assert.equal(dishIndex.publicVisible, fixture.expected, fixture.label);
    assert.equal(dishIndex.adminVisible, true, fixture.label);
    assert.equal(dishIndex.restaurantClaimed, true, fixture.label);
  }
});

test("BiteScore claim projection follows the strict availability truth table", () => {
  const availableCases = [
    {},
    {isClaimed: false},
    {isClaimed: false, ownerUserId: null},
    {isClaimed: false, ownerUserId: ""},
  ];
  for (const ownership of availableCases) {
    const projection = biteScoreRestaurantClaimProjection({
      isActive: true,
      ...ownership,
    });
    assert.deepEqual(projection, {
      isClaimed: false,
      claimAvailable: true,
      claimStateValid: true,
    });
  }

  assert.deepEqual(
    biteScoreRestaurantClaimProjection({
      isActive: true,
      isClaimed: true,
      ownerUserId: "owner-1",
    }),
    {isClaimed: true, claimAvailable: false, claimStateValid: true},
  );

  const malformedIsClaimedValues = [
    null,
    "false",
    0,
    [],
    {},
    new Date("2026-08-08T00:00:00.000Z"),
    new GeoPoint(1, 1),
  ];
  for (const isClaimed of malformedIsClaimedValues) {
    assert.deepEqual(
      biteScoreRestaurantClaimProjection({isActive: true, isClaimed}),
      {isClaimed: false, claimAvailable: false, claimStateValid: false},
    );
  }

  const malformedOwners = [" ", 1, false, [], {}, new Date(), new GeoPoint(1, 1)];
  for (const ownerUserId of malformedOwners) {
    for (const isClaimed of [false, true]) {
      assert.deepEqual(
        biteScoreRestaurantClaimProjection({
          isActive: true,
          isClaimed,
          ownerUserId,
        }),
        {isClaimed: false, claimAvailable: false, claimStateValid: false},
      );
    }
  }

  for (const ownership of [
    {isClaimed: true},
    {isClaimed: true, ownerUserId: null},
    {isClaimed: true, ownerUserId: ""},
    {isClaimed: true, ownerUserId: " "},
    {isClaimed: false, ownerUserId: "owner-1"},
  ]) {
    assert.deepEqual(
      biteScoreRestaurantClaimProjection({isActive: true, ...ownership}),
      {isClaimed: false, claimAvailable: false, claimStateValid: false},
    );
  }
});

test("BiteScore claim projection fails closed for hidden or malformed activity", () => {
  const activityCases = [
    {isActive: false},
    {active: false},
    {isActive: true, active: false},
    {isActive: "true"},
    {active: null},
  ];
  for (const activity of activityCases) {
    assert.deepEqual(
      biteScoreRestaurantClaimProjection({...activity, isClaimed: false}),
      {isClaimed: false, claimAvailable: false, claimStateValid: false},
    );
  }
});

test("BiteScore public visibility is independent of strict claim state", () => {
  const claimed = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "claimed",
    source: biteScoreRestaurant({isClaimed: true, ownerUserId: "owner-1"}),
    now,
  });
  const malformed = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "malformed",
    source: biteScoreRestaurant({isClaimed: false, ownerUserId: "owner-1"}),
    now,
  });
  const available = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "available",
    source: biteScoreRestaurant(),
    now,
  });

  assert.equal(claimed.publicVisible, true);
  assert.equal(claimed.isClaimed, true);
  assert.equal(claimed.claimAvailable, false);
  assert.equal(malformed.publicVisible, true);
  assert.equal(malformed.isClaimed, false);
  assert.equal(malformed.claimAvailable, false);
  assert.equal(malformed.claimStateValid, false);
  assert.equal(available.publicVisible, true);
  assert.equal(available.claimAvailable, true);
  assert.notEqual(available.sourceFingerprint, malformed.sourceFingerprint);
});

test("BiteScore restaurant omits incomplete geography and invalid geohash safely", () => {
  const missingState = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "missing-state",
    source: biteScoreRestaurant({state: ""}),
    now,
  });
  assert.equal(Object.hasOwn(missingState, "cityStateKey"), false);

  const missingLocation = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "missing-location",
    source: biteScoreRestaurant({location: undefined, latitude: undefined, longitude: undefined}),
    now,
  });
  assert.equal(Object.hasOwn(missingLocation, "geohash"), false);

  const invalidGeohash = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "invalid-geohash",
    source: biteScoreRestaurant({geohash: "invalid"}),
    now,
  });
  assert.equal(Object.hasOwn(invalidGeohash, "location"), false);
});

test("dish projection joins only current parent and aggregate state", () => {
  const index = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish(),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate(),
    now,
  });
  assert.equal(index.displayName, "Wood-Fired Pizza");
  assert.equal(index.restaurantDisplayName, "The Copper Spoon");
  assert.equal(index.publicVisible, true);
  assert.equal(index.dishActive, true);
  assert.equal(index.restaurantActive, true);
  assert.equal(index.overallBiteScore, 8.5);
  assert.equal(index.ratingCount, 12);
  assert.equal(index.tastinessScoreAverage, 9.1);
  assert.equal(index.primaryImageUrl, "https://images.example.test/dish.jpg");
  assert.ok(index.categoryTokens.includes("dinner"));
  assert.ok(index.categoryTokens.includes("pizza"));
  assert.equal(index.geohash, geohash);
});

test("dish visibility follows dish merge/status and current restaurant activity", () => {
  const cases = [
    {dish: dish({isActive: false}), restaurant: biteScoreRestaurant(), expectedDish: false},
    {dish: dish({mergedIntoDishId: "dish-2"}), restaurant: biteScoreRestaurant(), expectedDish: false},
    {dish: dish(), restaurant: biteScoreRestaurant({isActive: false}), expectedDish: true},
  ];
  for (const fixture of cases) {
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: fixture.dish,
      restaurantDocumentId: "restaurant-1",
      restaurant: fixture.restaurant,
      aggregate: aggregate(),
      now,
    });
    assert.equal(index.dishActive, fixture.expectedDish);
    assert.equal(index.publicVisible, false);
  }
});

test("dish aggregate deletion becomes the current neutral card state", () => {
  const neutral = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish(),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: null,
    now,
  });
  assert.equal(neutral.overallBiteScore, 0);
  assert.equal(neutral.ratingCount, 0);
  assert.equal(Object.hasOwn(neutral, "tastinessScoreAverage"), false);

  const changed = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish(),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate({overallBiteScore: 9.2, ratingCount: 14}),
    now,
  });
  assert.notEqual(changed.sourceFingerprint, neutral.sourceFingerprint);

  const mismatched = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish(),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate({dishId: "other-dish", overallBiteScore: 10}),
    now,
  });
  assert.equal(mismatched.overallBiteScore, 0);
  assert.equal(mismatched.ratingCount, 0);
});

test("dish parent rename/move propagates and invalid relationships delete", () => {
  const changed = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish(),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant({name: "Moved Bistro", city: "Tampa", zipCode: "33602"}),
    aggregate: aggregate(),
    now,
  });
  assert.equal(changed.restaurantDisplayName, "Moved Bistro");
  assert.equal(changed.normalizedCity, "tampa");
  assert.equal(changed.zip5, "33602");
  assert.equal(buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: null,
    restaurantDocumentId: null,
    restaurant: null,
    aggregate: null,
    now,
  }), null);
  assert.equal(buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish(),
    restaurantDocumentId: "restaurant-1",
    restaurant: null,
    aggregate: aggregate(),
    now,
  }), null);
});

test("dish category projection is deterministically bounded", () => {
  const tags = Array.from({length: 80}, (_, index) => `Tag ${index}`);
  const index = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish({categoryTags: tags}),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate(),
    now,
  });
  assert.equal(index.categoryTokens.length, maximumDishCategorySourceCount);
  assert.deepEqual(index.categoryTokens, [...index.categoryTokens].sort());
});

test("coupon projection derives account and inclusive schedule visibility", () => {
  const active = buildBiteSaverCouponOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "coupon-1",
    offer: coupon({startTime: new Date(now), endTime: new Date(now)}),
    restaurant: biteSaverRestaurant(),
    now,
  });
  assert.equal(active.publicVisible, true);
  assert.equal(active.offerActive, true);
  assert.equal(active.restaurantDisplayName, "BiteStar Café");

  for (const fixture of [
    {restaurant: biteSaverRestaurant({approvalStatus: "pending"}), offer: coupon()},
    {
      restaurant: biteSaverRestaurant({
        subscriptionStatus: "inactive",
        couponPostingEnabled: false,
      }),
      offer: coupon(),
    },
    {restaurant: biteSaverRestaurant(), offer: coupon({isActive: false})},
    {restaurant: biteSaverRestaurant(), offer: coupon({startTime: new Date(now.getTime() + 1)})},
    {restaurant: biteSaverRestaurant(), offer: coupon({endTime: new Date(now.getTime() - 1)})},
  ]) {
    const hidden = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: "coupon-hidden",
      offer: fixture.offer,
      restaurant: fixture.restaurant,
      now,
    });
    assert.equal(hidden.publicVisible, false);
  }
});

test("coupon projection propagates parent rename/location and deletes with either source", () => {
  const moved = buildBiteSaverCouponOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "coupon-1",
    offer: coupon(),
    restaurant: biteSaverRestaurant({restaurantName: "Moved Café", city: "Tampa", zipCode: "33602"}),
    now,
  });
  assert.equal(moved.restaurantDisplayName, "Moved Café");
  assert.equal(moved.normalizedCity, "tampa");
  assert.equal(moved.zip5, "33602");
  assert.equal(buildBiteSaverCouponOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "coupon-1",
    offer: null,
    restaurant: biteSaverRestaurant(),
    now,
  }), null);
  assert.equal(buildBiteSaverCouponOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "coupon-1",
    offer: coupon(),
    restaurant: null,
    now,
  }), null);
});

test("daily-special projection follows active, day, time, and parent visibility", () => {
  const valid = buildBiteSaverDailySpecialOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "special-1",
    offer: dailySpecial(),
    restaurant: biteSaverRestaurant(),
    now,
  });
  assert.equal(valid.publicVisible, true);
  assert.equal(valid.offerActive, true);

  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  const hiddenFixtures = [
    dailySpecial({isActive: false}),
    dailySpecial({daysOfWeek: [weekday === 7 ? 6 : weekday + 1]}),
    dailySpecial({allDay: false, startTime: "23:00", endTime: "23:30"}),
    dailySpecial({availabilityMode: "todayOnly", expiresAt: new Date(now)}),
  ];
  for (const offer of hiddenFixtures) {
    const hidden = buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: "special-hidden",
      offer,
      restaurant: biteSaverRestaurant(),
      now,
    });
    assert.equal(hidden.publicVisible, false);
  }

  const showOutsideHours = buildBiteSaverDailySpecialOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "special-show-always",
    offer: dailySpecial({
      allDay: false,
      startTime: "23:00",
      endTime: "23:30",
      hideWhenUnavailable: false,
    }),
    restaurant: biteSaverRestaurant(),
    now,
  });
  assert.equal(showOutsideHours.publicVisible, true);
});

test("daily-special parent propagation and identity validation are exact", () => {
  const moved = buildBiteSaverDailySpecialOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "special-1",
    offer: dailySpecial(),
    restaurant: biteSaverRestaurant({restaurantName: "Renamed Daily", city: "Ocala"}),
    now,
  });
  assert.equal(moved.restaurantDisplayName, "Renamed Daily");
  assert.equal(moved.normalizedCity, "ocala");
  assert.equal(buildBiteSaverDailySpecialOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "special-1",
    offer: dailySpecial({restaurantId: "other-account"}),
    restaurant: biteSaverRestaurant(),
    now,
  }), null);
  assert.equal(buildBiteSaverDailySpecialOfferIndex({
    restaurantAccountId: "account-1",
    sourceDocumentId: "special-1",
    offer: null,
    restaurant: biteSaverRestaurant(),
    now,
  }), null);
});

test("description truncation is explicit, deterministic, and Unicode-safe", () => {
  const source = `${"a".repeat(maximumOfferDescriptionLength - 1)}😀tail`;
  const summary = boundedDescriptionSummary(source);
  assert.equal(Array.from(summary).length, maximumOfferDescriptionLength);
  assert.equal(summary.endsWith("😀"), true);
});

test("strict builders exclude every sensitive canary from fields and serialized JSON", () => {
  const privateFields = privateCanaryFields();
  const documents = [
    buildBiteSaverRestaurantIndex({sourceDocumentId: "account-safe", source: biteSaverRestaurant(privateFields), now}),
    buildBiteScoreRestaurantIndex({sourceDocumentId: "restaurant-safe", source: biteScoreRestaurant(privateFields), now}),
    buildBiteScoreDishIndex({
      sourceDocumentId: "dish-safe",
      dish: dish(privateFields),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(privateFields),
      aggregate: aggregate(privateFields),
      now,
    }),
    buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: "coupon-safe",
      offer: coupon({...privateFields, couponCode: "PRIVATE-COUPON-CODE"}),
      restaurant: biteSaverRestaurant(privateFields),
      now,
    }),
    buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: "special-safe",
      offer: dailySpecial({...privateFields, ownerUid: "account-1"}),
      restaurant: biteSaverRestaurant(privateFields),
      now,
    }),
  ];
  for (const document of documents) {
    assert.notEqual(document, null);
    assertCanariesAbsent(document);
    assert.equal(JSON.stringify(document).includes("PRIVATE-COUPON-CODE"), false);
    assert.ok(serializedSearchIndexDocumentBytes(document) < maximumSearchIndexDocumentBytes);
  }
});

test("parent fingerprints change only for dependent-index inputs", () => {
  const biteSaver = biteSaverRestaurant();
  assert.equal(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({...biteSaver, email: "ignored@example.test"}),
  );
  assert.equal(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({
      ...biteSaver,
      subscriptionStatus: "inactive",
      trialEndsAt: new Date(now.getTime() - 1),
      cancelAtPeriodEnd: true,
    }),
  );
  assert.notEqual(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({
      ...biteSaver,
      couponPostingEnabled: false,
    }),
  );
  assert.notEqual(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({...biteSaver, adminHidden: true}),
  );
  assert.notEqual(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({...biteSaver, restaurantName: "Renamed"}),
  );
  const biteScore = biteScoreRestaurant();
  const biteScoreLegacyDefault = biteScoreRestaurantWithActivity({});
  assert.equal(
    biteScoreDishParentFingerprint(biteScore),
    biteScoreDishParentFingerprint({...biteScore, phone: "ignored"}),
  );
  assert.equal(
    biteScoreDishParentFingerprint(biteScore),
    biteScoreDishParentFingerprint(biteScoreLegacyDefault),
  );
  assert.notEqual(
    biteScoreDishParentFingerprint(biteScore),
    biteScoreDishParentFingerprint({...biteScore, isActive: false}),
  );
  assert.notEqual(
    biteScoreDishParentFingerprint(biteScore),
    biteScoreDishParentFingerprint(
      biteScoreRestaurantWithActivity({isActive: "true"}),
    ),
  );
  assert.notEqual(
    biteScoreDishParentFingerprint(biteScore),
    biteScoreDishParentFingerprint(
      biteScoreRestaurantWithActivity({isActive: true, active: false}),
    ),
  );
  assert.notEqual(biteSaverOfferParentFingerprint(null), biteSaverOfferParentFingerprint(biteSaver));
  assert.notEqual(biteScoreDishParentFingerprint(null), biteScoreDishParentFingerprint(biteScore));
});
