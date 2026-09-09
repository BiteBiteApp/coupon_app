"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {GeoPoint} = require("firebase-admin/firestore");

const {
  biteSaverOfferCatalogUpdatedAtField,
  biteSaverRestaurantPublicProjectionVersion,
  biteSaverOfferParentFingerprint,
  biteSaverCatalogBindingAdminState,
  biteScoreBiteSaverCatalogProfile,
  biteScoreDishParentFingerprint,
  biteScoreRestaurantClaimProjection,
  biteScoreRestaurantIsActive,
  boundedDescriptionSummary,
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverDailySpecialOfferIndex,
  buildBiteSaverRestaurantIndex,
  buildBiteScoreDishIndex,
  buildBiteScoreRestaurantIndex,
  maximumDishCategoryCombinedSourceBytes,
  maximumDishCategoryInputCount,
  maximumDishCategoryManualKeywordBytes,
  maximumDishCategorySourceCount,
  maximumOfferDescriptionLength,
  maximumSearchLocationTextLength,
} = require("../lib/search_index_builders.js");
const {
  canonicalRestaurantGeohash,
} = require("../lib/restaurant_geo_helpers.js");
const {
  biteScoreDishCustomerPublicProjectionVersion,
  biteScoreRestaurantCustomerPublicProjectionVersion,
  maximumSearchIndexDocumentBytes,
  requireSearchIndexDocumentSize,
  serializedSearchIndexDocumentBytes,
} = require("../lib/search_index_contract.js");

const now = new Date("2026-08-08T16:00:00.000Z");
const coordinates = Object.freeze({latitude: 28.8517, longitude: -82.487});
const geohash = canonicalRestaurantGeohash(coordinates);
const canaries = Object.freeze([
  "private-email-canary@example.test",
  "private-auth-phone-canary",
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
  "private-auth-display-name-canary",
  "private-auth-uid-canary",
  "private-application-canary",
  "private-admin-canary",
  "private-billing-canary",
  "private-checkout-canary",
  "private-profile-request-canary",
]);

function privateCanaryFields() {
  return {
    email: canaries[0],
    phoneNumber: canaries[1],
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
    displayName: canaries[12],
    uid: canaries[13],
    couponApplicationSubmitted: canaries[14],
    approvedByUid: canaries[15],
    billingPlanName: canaries[16],
    stripeCheckoutSessionId: canaries[17],
    profileRequestId: canaries[18],
    profileRequestFingerprint: canaries[18],
    publicVisible: false,
  };
}

function publicBusinessHoursFixture() {
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ].map((day) => ({
    day,
    opensAt: "9:00 AM",
    closesAt: "5:00 PM",
    closed: day === "Sunday",
  }));
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
    streetAddress: " 123 Citrus Avenue ",
    phone: "+1 352-555-0100",
    mainImageUrl: "https://images.example.test/restaurant.jpg",
    website: "https://restaurant.example.test",
    bio: "Family owned.\nFresh every day.",
    businessHours: publicBusinessHoursFixture(),
    formattedAddress: "123 Citrus Avenue, Crystal River, FL 34428",
    menuSourceSide: "biteScore",
    linkedBiteScoreRestaurantId: "bitescore-restaurant-1",
    offerCatalogUpdatedAt: new Date("2026-08-08T15:30:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-08T15:00:00.000Z"),
    ...overrides,
  };
}

function biteScoreRestaurant(overrides = {}) {
  return {
    name: "The Copper Spoon",
    streetAddress: "1 Main St",
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

function commaSeparatedAsciiEntries(totalBytes, character = "x") {
  assert.ok(Number.isSafeInteger(totalBytes) && totalBytes > 0);
  const entryCount = Math.ceil((totalBytes + 1) / 101);
  assert.ok(entryCount <= maximumDishCategoryInputCount);
  let remainingEntryBytes = totalBytes - (entryCount - 1);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    const remainingEntries = entryCount - index;
    const entryBytes = Math.min(
      100,
      remainingEntryBytes - (remainingEntries - 1),
    );
    entries.push(character.repeat(entryBytes));
    remainingEntryBytes -= entryBytes;
  }
  assert.equal(
    Buffer.byteLength(entries.join(","), "utf8"),
    totalBytes,
  );
  return entries;
}

function commaSeparatedEntriesWithSupplementaryCharacter(
  totalBytes,
  character = "x",
) {
  const entries = commaSeparatedAsciiEntries(totalBytes - 5, character);
  entries.push("😀");
  assert.equal(
    entries.reduce(
      (bytes, entry, index) =>
        bytes + Buffer.byteLength(entry, "utf8") + (index === 0 ? 0 : 1),
      0,
    ),
    totalBytes,
  );
  return entries;
}

function mixedCategorySourceAtRawBytes(totalBytes, supplementary = false) {
  const category = "c".repeat(100);
  const subcategory = "s".repeat(100);
  const categoryManualKeywords = commaSeparatedAsciiEntries(
    maximumDishCategoryManualKeywordBytes,
    "m",
  ).join(",");
  const fixedBytes =
    Buffer.byteLength(category, "utf8") +
    1 +
    Buffer.byteLength(subcategory, "utf8") +
    1 +
    Buffer.byteLength(categoryManualKeywords, "utf8") +
    1;
  const tagBytes = totalBytes - fixedBytes;
  const categoryTags = supplementary
    ? commaSeparatedEntriesWithSupplementaryCharacter(tagBytes, "t")
    : commaSeparatedAsciiEntries(tagBytes, "t");
  const actualBytes = [
    category,
    subcategory,
    categoryManualKeywords,
    categoryTags.join(","),
  ].reduce(
    (bytes, value, index) =>
      bytes + Buffer.byteLength(value, "utf8") + (index === 0 ? 0 : 1),
    0,
  );
  assert.equal(actualBytes, totalBytes);
  return {category, subcategory, categoryManualKeywords, categoryTags};
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

const offerParentProjectionKeys = Object.freeze([
  "publicVisible",
  "restaurantDisplayName",
  "restaurantNormalizedName",
  "restaurantNamePrefixTokens",
  "zip5",
  "normalizedCity",
  "normalizedState",
  "cityStateKey",
  "latitude",
  "longitude",
  "geohash",
  "restaurantPrimaryImageUrl",
]);

function biteSaverOffersForParent(restaurant) {
  return [
    buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-parent-parity",
      sourceDocumentId: "coupon-parent-parity",
      offer: coupon(),
      restaurant,
      now,
    }),
    buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId: "account-parent-parity",
      sourceDocumentId: "special-parent-parity",
      offer: dailySpecial({
        restaurantId: "account-parent-parity",
        ownerUid: "account-parent-parity",
      }),
      restaurant,
      now,
    }),
  ];
}

function effectiveOfferParentProjection(document) {
  if (document === null) {
    return null;
  }
  return Object.fromEntries(offerParentProjectionKeys.flatMap((field) =>
    Object.hasOwn(document, field) ? [[field, document[field]]] : []));
}

function biteSaverRestaurantForParent(restaurant) {
  return buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-parent-parity",
    source: restaurant,
    now,
  });
}

function assertBiteSaverParentNameSelection(restaurant, expectedName, label) {
  const restaurantIndex = biteSaverRestaurantForParent(restaurant);
  const offers = biteSaverOffersForParent(restaurant);
  const canonicalEquivalent = biteSaverRestaurant({restaurantName: expectedName});

  assert.equal(
    biteSaverOfferParentFingerprint(restaurant),
    biteSaverOfferParentFingerprint(canonicalEquivalent),
    `${label}: effective-name fingerprint`,
  );
  if (expectedName === null) {
    assert.equal(restaurantIndex, null, `${label}: restaurant`);
    assert.deepEqual(offers, [null, null], `${label}: offers`);
    return;
  }

  assert.notEqual(restaurantIndex, null, `${label}: restaurant`);
  assert.equal(restaurantIndex.displayName, expectedName, `${label}: restaurant name`);
  for (const [offerIndex, offer] of offers.entries()) {
    assert.notEqual(offer, null, `${label}: offer ${offerIndex}`);
    assert.equal(
      offer.restaurantDisplayName,
      restaurantIndex.displayName,
      `${label}: offer ${offerIndex} display name`,
    );
    assert.equal(
      offer.restaurantNormalizedName,
      restaurantIndex.normalizedName,
      `${label}: offer ${offerIndex} normalized name`,
    );
    assert.deepEqual(
      offer.restaurantNamePrefixTokens,
      restaurantIndex.namePrefixTokens,
      `${label}: offer ${offerIndex} name prefixes`,
    );
  }
}

function assertBiteSaverParentImageSelection(restaurant, expectedUrl, label) {
  const restaurantIndex = biteSaverRestaurantForParent(restaurant);
  const offers = biteSaverOffersForParent(restaurant);
  const canonicalEquivalent = biteSaverRestaurant({mainImageUrl: expectedUrl});

  assert.notEqual(restaurantIndex, null, `${label}: restaurant`);
  assert.equal(
    biteSaverOfferParentFingerprint(restaurant),
    biteSaverOfferParentFingerprint(canonicalEquivalent),
    `${label}: effective-image fingerprint`,
  );
  assert.equal(
    Object.hasOwn(restaurantIndex, "primaryImageUrl"),
    expectedUrl !== null,
    `${label}: restaurant image presence`,
  );
  if (expectedUrl !== null) {
    assert.equal(
      restaurantIndex.primaryImageUrl,
      expectedUrl,
      `${label}: restaurant image`,
    );
  }
  for (const [offerIndex, offer] of offers.entries()) {
    assert.notEqual(offer, null, `${label}: offer ${offerIndex}`);
    assert.equal(
      Object.hasOwn(offer, "restaurantPrimaryImageUrl"),
      expectedUrl !== null,
      `${label}: offer ${offerIndex} image presence`,
    );
    if (expectedUrl !== null) {
      assert.equal(
        offer.restaurantPrimaryImageUrl,
        expectedUrl,
        `${label}: offer ${offerIndex} image`,
      );
    }
  }
}

function assertOfferParentTransitionChanges(before, after, label) {
  assert.notEqual(
    biteSaverOfferParentFingerprint(before),
    biteSaverOfferParentFingerprint(after),
    `${label}: fingerprint`,
  );
  const beforeOffers = biteSaverOffersForParent(before);
  const afterOffers = biteSaverOffersForParent(after);
  assert.equal(beforeOffers.length, afterOffers.length);
  for (let index = 0; index < beforeOffers.length; index += 1) {
    assert.notDeepEqual(
      effectiveOfferParentProjection(beforeOffers[index]),
      effectiveOfferParentProjection(afterOffers[index]),
      `${label}: offer ${index}`,
    );
  }
}

function assertOfferParentTransitionEquivalent(before, after, label) {
  assert.equal(
    biteSaverOfferParentFingerprint(before),
    biteSaverOfferParentFingerprint(after),
    `${label}: fingerprint`,
  );
  const beforeOffers = biteSaverOffersForParent(before);
  const afterOffers = biteSaverOffersForParent(after);
  assert.equal(beforeOffers.length, afterOffers.length);
  for (let index = 0; index < beforeOffers.length; index += 1) {
    assert.deepEqual(
      effectiveOfferParentProjection(beforeOffers[index]),
      effectiveOfferParentProjection(afterOffers[index]),
      `${label}: offer ${index}`,
    );
  }
}

test("BiteSaver restaurant projection derives exact visibility and canonical search fields", () => {
  const approved = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-1",
    source: biteSaverRestaurant(),
    now,
  });
  assert.equal(
    biteSaverRestaurantPublicProjectionVersion,
    "bitestar.bitesaver-public-restaurant.v1",
  );
  assert.equal(
    approved.publicProjectionVersion,
    biteSaverRestaurantPublicProjectionVersion,
  );
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
  assert.equal(approved.streetAddress, "123 Citrus Avenue");
  assert.equal(approved.city, "Crystal River");
  assert.equal(approved.state, "fl");
  assert.equal(approved.zipCode, "34428-1234");
  assert.equal(approved.phone, "+1 352-555-0100");
  assert.equal(approved.website, "https://restaurant.example.test");
  assert.equal(approved.bio, "Family owned.\nFresh every day.");
  assert.equal(
    approved.primaryImageUrl,
    "https://images.example.test/restaurant.jpg",
  );
  assert.deepEqual(approved.businessHours, publicBusinessHoursFixture());
  assert.equal(
    approved.formattedAddress,
    "123 Citrus Avenue, Crystal River, FL 34428",
  );
  assert.equal(approved.menuSourceSide, "biteScore");
  assert.equal(
    approved.linkedBiteScoreRestaurantId,
    "bitescore-restaurant-1",
  );
  assert.equal(
    approved[biteSaverOfferCatalogUpdatedAtField].toISOString(),
    "2026-08-08T15:30:00.000Z",
  );
  assert.deepEqual(
    Object.keys(approved).sort(),
    [
      "adminDirectoryVisible",
      "bio",
      "businessHours",
      "city",
      "cityStateKey",
      "displayName",
      "entityType",
      "formattedAddress",
      "geohash",
      "indexDocumentId",
      "indexedAt",
      "latitude",
      "linkedBiteScoreRestaurantId",
      "location",
      "longitude",
      "menuSourceSide",
      "namePrefixTokens",
      "normalizedCity",
      "normalizedName",
      "normalizedState",
      "offerCatalogUpdatedAt",
      "phone",
      "primaryImageUrl",
      "publicProjectionVersion",
      "publicVisible",
      "searchIndexVersion",
      "source",
      "sourceDocumentId",
      "sourceFingerprint",
      "state",
      "streetAddress",
      "website",
      "zip5",
      "zipCode",
    ].sort(),
  );
  for (const entry of approved.businessHours) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["closesAt", "closed", "day", "opensAt"].sort(),
    );
  }

  for (const [statusIndex, approvalStatus] of [
    "pending",
    "rejected",
    "private",
    "Approved",
    " approved ",
    "APPROVED",
    null,
    true,
  ].entries()) {
    const hidden = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `account-status-${statusIndex}`,
      source: biteSaverRestaurant({approvalStatus}),
      now,
    });
    assert.equal(hidden.publicVisible, false, approvalStatus);
    assert.equal(hidden.adminDirectoryVisible, false, approvalStatus);
  }
});

test("BiteSaver projection emits only a strict reciprocal catalog binding", () => {
  const firstBindingId = "A".repeat(43);
  const secondBindingId = "B".repeat(43);
  const bound = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "owner-auth-uid",
    source: biteSaverRestaurant({
      biteScoreCatalogRestaurantId: "catalog-restaurant-1",
      biteSaverCatalogBindingId: firstBindingId,
      uid: "owner-auth-uid",
      ownerUid: "private-owner-auth-token-canary",
    }),
    now,
  });
  const changed = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "owner-auth-uid",
    source: biteSaverRestaurant({
      biteScoreCatalogRestaurantId: "catalog-restaurant-1",
      biteSaverCatalogBindingId: secondBindingId,
    }),
    now: new Date(now.getTime() + 1_000),
  });

  assert.equal(
    bound.biteScoreCatalogRestaurantId,
    "catalog-restaurant-1",
  );
  assert.equal(bound.biteSaverCatalogBindingId, firstBindingId);
  assert.equal(bound.publicVisible, true);
  assert.equal(Object.hasOwn(bound, "uid"), false);
  assert.equal(Object.hasOwn(bound, "ownerUid"), false);
  assertCanariesAbsent(bound);
  assert.notEqual(bound.sourceFingerprint, changed.sourceFingerprint);
  assert.equal(
    changed.publicProjectionVersion,
    "bitestar.bitesaver-public-restaurant.v1",
  );

  const ineligible = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "owner-auth-uid",
    source: biteSaverRestaurant({
      approvalStatus: "pending",
      biteScoreCatalogRestaurantId: "catalog-restaurant-1",
      biteSaverCatalogBindingId: firstBindingId,
    }),
    now,
  });
  assert.equal(ineligible.publicVisible, false);
  assert.equal(
    ineligible.biteScoreCatalogRestaurantId,
    "catalog-restaurant-1",
  );

  for (const malformed of [
    {biteScoreCatalogRestaurantId: "catalog-restaurant-1"},
    {biteSaverCatalogBindingId: firstBindingId},
    {
      biteScoreCatalogRestaurantId: "catalog/restaurant",
      biteSaverCatalogBindingId: firstBindingId,
    },
    {
      biteScoreCatalogRestaurantId: "catalog-restaurant-1",
      biteSaverCatalogBindingId: "short",
    },
    {
      biteScoreCatalogRestaurantId: null,
      biteSaverCatalogBindingId: null,
    },
  ]) {
    const projection = buildBiteSaverRestaurantIndex({
      sourceDocumentId: "malformed-binding",
      source: biteSaverRestaurant(malformed),
      now,
    });
    assert.equal(
      Object.hasOwn(projection, "biteScoreCatalogRestaurantId"),
      false,
    );
    assert.equal(
      Object.hasOwn(projection, "biteSaverCatalogBindingId"),
      false,
    );
    assert.equal(projection.publicVisible, false);
  }
});

test("BiteSaver restaurant public profile fields are individually validated and closed", () => {
  for (const unsafeName of ["Cafe\u0000Secret", "Cafe\u200bSecret"]) {
    assert.equal(buildBiteSaverRestaurantIndex({
      sourceDocumentId: "account-unsafe-name",
      source: biteSaverRestaurant({
        restaurantName: unsafeName,
        name: unsafeName,
      }),
      now,
    }), null);
  }

  const malformedHours = publicBusinessHoursFixture();
  malformedHours[0] = {
    ...malformedHours[0],
    internalOwnerNote: "must-not-project",
  };
  const projection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-malformed-public-profile",
    source: biteSaverRestaurant({
      streetAddress: "x".repeat(201),
      phone: {private: true},
      website: "x".repeat(501),
      bio: "unsafe\u0000bio",
      mainImageUrl: "data:image/png;base64,private",
      imageUrl: "https://images.example.test/legacy-safe.jpg",
      businessHours: malformedHours,
      formattedAddress: "x".repeat(501),
      menuSourceSide: "biteScore",
      linkedBiteScoreRestaurantId: "invalid/document/id",
      linkedBiteSaverUid: "private-linked-owner",
      arbitraryPublicLookingField: "must-not-project",
    }),
    now,
  });

  assert.equal(Object.hasOwn(projection, "streetAddress"), false);
  assert.equal(Object.hasOwn(projection, "phone"), false);
  assert.equal(Object.hasOwn(projection, "website"), false);
  assert.equal(Object.hasOwn(projection, "bio"), false);
  assert.equal(Object.hasOwn(projection, "primaryImageUrl"), false);
  assert.equal(Object.hasOwn(projection, "businessHours"), false);
  assert.equal(Object.hasOwn(projection, "formattedAddress"), false);
  assert.equal(projection.menuSourceSide, "biteScore");
  assert.equal(
    Object.hasOwn(projection, "linkedBiteScoreRestaurantId"),
    false,
  );
  assert.equal(Object.hasOwn(projection, "linkedBiteSaverUid"), false);
  assert.equal(Object.hasOwn(projection, "arbitraryPublicLookingField"), false);
  assert.equal(JSON.stringify(projection).includes("must-not-project"), false);

  const emptyHours = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-empty-hours",
    source: biteSaverRestaurant({
      businessHours: [],
      website: "restaurant.example.test/menu",
    }),
    now,
  });
  assert.deepEqual(emptyHours.businessHours, []);
  assert.equal(Object.hasOwn(emptyHours, "website"), false);

  const legacyImageSource = biteSaverRestaurant({
    imageUrl: "https://images.example.test/legacy-safe.jpg",
  });
  delete legacyImageSource.mainImageUrl;
  const legacyImage = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-legacy-image",
    source: legacyImageSource,
    now,
  });
  assert.equal(
    legacyImage.primaryImageUrl,
    "https://images.example.test/legacy-safe.jpg",
  );

  const legacyMenu = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-legacy-menu",
    source: biteSaverRestaurant({
      menuSourceSide: "biteSaver",
      linkedBiteScoreRestaurantId: "must-be-ignored",
    }),
    now,
  });
  assert.equal(legacyMenu.menuSourceSide, "biteSaver");
  assert.equal(
    Object.hasOwn(legacyMenu, "linkedBiteScoreRestaurantId"),
    false,
  );
});

test("public website and image URLs require strict absolute HTTP(S) syntax", () => {
  const rejectedUrls = [
    "https://",
    "http://",
    "https:// bad.example",
    "https://[invalid",
    "javascript:alert(1)",
    "data:image/png;base64,private",
    "example.test/path",
    "https://example.test/with space",
    "https://example.test/format\u200b",
    "https://example.test/control\u0001",
    "https://username:password@example.test/private",
    "https://@example.test/private",
    "https://:@example.test/private",
    "https://.",
    "https://-bad.example",
    "https://bad_.example",
    "https://example..test",
    "https://%65xample.test",
    "https://example.test\\repaired-path",
    "https://example.test＼repaired-path",
    "https://example.test／repaired-path",
    "https://example.test？repaired-query",
    "https://example.test＃repaired-fragment",
    "https:///example.test/path",
    "https:////example.test/path",
    "http://///example.test/path",
    "https://example.test:",
    "https://example.test:/path",
    "https://127.1/private",
    "https://0177.0.0.1/private",
    "https://0x7f000001/private",
    "https://example.test/．．/private",
    "https://example.test/?ｎｅｘｔ＝admin",
    "https://example.test/ＰＲＩＶＡＴＥ",
    "https://example．test/path",
    "https://ｅxample.test/path",
    "https://℡.example/path",
    "https://example。test/path",
    "https://example｡test/path",
    "https://example１２３.test/path",
    "https://exam℡ple.test/path",
    "https://oﬃce.example/path",
    "https://exa\u034fmple.test/path",
    "https://exa\u180bmple.test/path",
    "https://exa\u180cmple.test/path",
    "https://exa\u180dmple.test/path",
    "https://exa\ufe00mple.test/path",
    "https://exa\ufe0fmple.test/path",
  ];

  for (const [index, rejectedUrl] of rejectedUrls.entries()) {
    const biteSaver = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `bitesaver-url-${index}`,
      source: biteSaverRestaurant({
        website: rejectedUrl,
        mainImageUrl: rejectedUrl,
        imageUrl: "https://images.example.test/lower-alias.jpg",
      }),
      now,
    });
    assert.equal(Object.hasOwn(biteSaver, "website"), false, rejectedUrl);
    assert.equal(
      Object.hasOwn(biteSaver, "primaryImageUrl"),
      false,
      rejectedUrl,
    );

    const biteScore = buildBiteScoreRestaurantIndex({
      sourceDocumentId: `bitescore-url-${index}`,
      source: biteScoreRestaurant({
        website: rejectedUrl,
        primaryImageUrl: rejectedUrl,
        mainImageUrl: "https://images.example.test/lower-alias.jpg",
      }),
      now,
    });
    assert.notEqual(biteScore.customerPublicProjection, null);
    assert.equal(
      Object.hasOwn(biteScore.customerPublicProjection, "website"),
      false,
      rejectedUrl,
    );
    assert.equal(
      Object.hasOwn(biteScore.customerPublicProjection, "primaryImageUrl"),
      false,
      rejectedUrl,
    );

    const dishIndex = buildBiteScoreDishIndex({
      sourceDocumentId: `dish-url-${index}`,
      dish: dish({
        id: `dish-url-${index}`,
        primaryImageUrl: rejectedUrl,
      }),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate({dishId: `dish-url-${index}`}),
      now,
    });
    assert.notEqual(dishIndex.customerPublicProjection, null);
    assert.equal(
      Object.hasOwn(dishIndex.customerPublicProjection, "primaryImageUrl"),
      false,
      rejectedUrl,
    );

    const offerIndex = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `coupon-url-${index}`,
      offer: coupon({id: `coupon-url-${index}`, imageUrl: rejectedUrl}),
      restaurant: biteSaverRestaurant({mainImageUrl: rejectedUrl}),
      now,
    });
    assert.equal(Object.hasOwn(offerIndex, "primaryImageUrl"), false);
    assert.equal(
      Object.hasOwn(offerIndex, "restaurantPrimaryImageUrl"),
      false,
    );
  }

  const acceptedUrls = [
    "https://example.test/menu",
    "http://images.example.test/dish.png",
    "https://example.test:8443/path/to/menu?q=khmer#section",
    "https://192.0.2.1:8443/path",
    "https://[2001:db8::1]:8443/path",
    "https://example.test./path",
    "https://例え.テスト/画像?q=ខ្មែរ#料理",
    "https://ខ្មែរ.example/path",
    "https://xn--r8jz45g.xn--zckzah/path",
    "https://xn--r8jz45g.テスト/path",
    "HTTPS://EXAMPLE.TEST/Path?Q=X#F",
  ];
  for (const [index, acceptedUrl] of acceptedUrls.entries()) {
    const restaurant = buildBiteScoreRestaurantIndex({
      sourceDocumentId: `restaurant-valid-url-${index}`,
      source: biteScoreRestaurant({
        website: acceptedUrl,
        primaryImageUrl: acceptedUrl,
      }),
      now,
    });
    assert.equal(
      restaurant.customerPublicProjection.website,
      acceptedUrl,
    );
    assert.equal(
      restaurant.customerPublicProjection.primaryImageUrl,
      acceptedUrl,
    );

    const dishId = `dish-valid-url-${index}`;
    const dishIndex = buildBiteScoreDishIndex({
      sourceDocumentId: dishId,
      dish: dish({id: dishId, primaryImageUrl: acceptedUrl}),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate({dishId}),
      now,
    });
    assert.equal(
      dishIndex.customerPublicProjection.primaryImageUrl,
      acceptedUrl,
    );
  }

  for (const invalidCanonicalWebsite of [
    "https://ｅxample.test/private",
    "https://exa\u034fmple.test/private",
  ]) {
    const catalogSource = biteScoreRestaurant({
      website: invalidCanonicalWebsite,
      websiteUrl: "https://legacy.example.test",
    });
    assert.equal(biteScoreBiteSaverCatalogProfile(catalogSource).website, null);
    delete catalogSource.website;
    assert.equal(
      biteScoreBiteSaverCatalogProfile(catalogSource).website,
      "https://legacy.example.test",
    );
  }
});

test("multiline public bios reject unsafe raw whitespace and preserve CR/LF policy", () => {
  const unsafeBioCharacters = [
    "\t",
    "\u2028",
    "\u2029",
    "\u202e",
    "\u200b",
    "\u0001",
    "\ud800",
  ];
  for (const [index, character] of unsafeBioCharacters.entries()) {
    const rawBio = `visible${character}hidden`;
    const biteSaver = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `bitesaver-bio-${index}`,
      source: biteSaverRestaurant({bio: rawBio}),
      now,
    });
    assert.equal(Object.hasOwn(biteSaver, "bio"), false, JSON.stringify(rawBio));

    const biteScore = buildBiteScoreRestaurantIndex({
      sourceDocumentId: `bitescore-bio-${index}`,
      source: biteScoreRestaurant({bio: rawBio}),
      now,
    });
    assert.notEqual(biteScore.customerPublicProjection, null);
    assert.equal(
      Object.hasOwn(biteScore.customerPublicProjection, "bio"),
      false,
      JSON.stringify(rawBio),
    );
  }

  const rawAllowedBio = "Crème brûlée\rខ្មែរ\n𐐀\r\nFinal line";
  const normalizedAllowedBio = "Crème brûlée\nខ្មែរ\n𐐀\nFinal line";
  const biteSaver = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "bitesaver-bio-allowed",
    source: biteSaverRestaurant({bio: rawAllowedBio}),
    now,
  });
  assert.equal(biteSaver.bio, normalizedAllowedBio);
  const biteScore = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "bitescore-bio-allowed",
    source: biteScoreRestaurant({bio: rawAllowedBio}),
    now,
  });
  assert.equal(
    biteScore.customerPublicProjection.bio,
    normalizedAllowedBio,
  );
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

test("BiteSaver public projections require the exact approved status", () => {
  const fixtures = [
    {label: "exact approved", approvalStatus: "approved", expected: true},
    {label: "capitalized", approvalStatus: "Approved", expected: false},
    {label: "padded", approvalStatus: " approved ", expected: false},
    {label: "uppercase", approvalStatus: "APPROVED", expected: false},
    {label: "missing", approvalStatus: undefined, expected: false},
    {label: "null", approvalStatus: null, expected: false},
    {label: "boolean", approvalStatus: true, expected: false},
  ];

  for (const fixture of fixtures) {
    const restaurant = biteSaverRestaurant({
      approvalStatus: fixture.approvalStatus,
    });
    const restaurantIndex = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `restaurant-${fixture.label}`,
      source: restaurant,
      now,
    });
    const couponIndex = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `coupon-${fixture.label}`,
      offer: coupon(),
      restaurant,
      now,
    });
    const dailySpecialIndex = buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `special-${fixture.label}`,
      offer: dailySpecial(),
      restaurant,
      now,
    });

    assert.equal(restaurantIndex.publicVisible, fixture.expected, fixture.label);
    assert.equal(
      restaurantIndex.adminDirectoryVisible,
      fixture.expected,
      fixture.label,
    );
    assert.equal(couponIndex.publicVisible, fixture.expected, fixture.label);
    assert.equal(dailySpecialIndex.publicVisible, fixture.expected, fixture.label);
  }
});

test("BiteSaver Admin hidden veto fails closed across all public projections", () => {
  const fixtures = [
    {label: "missing", overrides: {}, expected: true},
    {label: "boolean false", overrides: {adminHidden: false}, expected: true},
    {label: "boolean true", overrides: {adminHidden: true}, expected: false},
    {label: "own undefined", overrides: {adminHidden: undefined}, expected: false},
    {label: "null", overrides: {adminHidden: null}, expected: false},
    {label: "false string", overrides: {adminHidden: "false"}, expected: false},
    {label: "zero", overrides: {adminHidden: 0}, expected: false},
    {label: "object", overrides: {adminHidden: {}}, expected: false},
  ];
  for (const fixture of fixtures) {
    const restaurant = biteSaverRestaurant(fixture.overrides);
    const restaurantIndex = buildBiteSaverRestaurantIndex({
      sourceDocumentId: `restaurant-${fixture.label}`,
      source: restaurant,
      now,
    });
    const couponIndex = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `coupon-${fixture.label}`,
      offer: coupon(),
      restaurant,
      now,
    });
    const dailySpecialIndex = buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId: "account-1",
      sourceDocumentId: `special-${fixture.label}`,
      offer: dailySpecial(),
      restaurant,
      now,
    });

    assert.equal(restaurantIndex.publicVisible, fixture.expected, fixture.label);
    assert.equal(restaurantIndex.adminDirectoryVisible, true);
    assert.equal(couponIndex.publicVisible, fixture.expected, fixture.label);
    assert.equal(couponIndex.adminVisible, true);
    assert.equal(dailySpecialIndex.publicVisible, fixture.expected, fixture.label);
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

test("BiteSaver offer catalog signal is a sanitized public-only projection input", () => {
  const original = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-offers",
    source: biteSaverRestaurant({
      offerCatalogUpdatedAt: new Date("2026-08-08T15:30:00.000Z"),
    }),
    now,
  });
  const advanced = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-offers",
    source: biteSaverRestaurant({
      offerCatalogUpdatedAt: new Date("2026-08-08T15:31:00.000Z"),
    }),
    now: new Date(now.getTime() + 60_000),
  });
  const rebuilt = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-offers",
    source: biteSaverRestaurant({
      offerCatalogUpdatedAt: new Date("2026-08-08T15:31:00.000Z"),
    }),
    now: new Date(now.getTime() + 120_000),
  });

  assert.equal(
    advanced[biteSaverOfferCatalogUpdatedAtField].toISOString(),
    "2026-08-08T15:31:00.000Z",
  );
  assert.notEqual(advanced.sourceFingerprint, original.sourceFingerprint);
  assert.equal(rebuilt.sourceFingerprint, advanced.sourceFingerprint);
  assert.equal(
    rebuilt[biteSaverOfferCatalogUpdatedAtField].toISOString(),
    advanced[biteSaverOfferCatalogUpdatedAtField].toISOString(),
  );

  for (const malformedSignal of [
    null,
    "2026-08-08T15:31:00.000Z",
    123,
    true,
    {couponTitle: canaries[0]},
    [new Date("2026-08-08T15:31:00.000Z")],
    new Date("invalid"),
  ]) {
    const malformed = buildBiteSaverRestaurantIndex({
      sourceDocumentId: "account-malformed-offers",
      source: biteSaverRestaurant({offerCatalogUpdatedAt: malformedSignal}),
      now,
    });
    assert.equal(
      Object.hasOwn(malformed, biteSaverOfferCatalogUpdatedAtField),
      false,
    );
    assertCanariesAbsent(malformed);
  }
});

test("BiteSaver restaurant fingerprints ignore private and lifecycle-only source fields", () => {
  const source = biteSaverRestaurant();
  const original = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-fingerprint",
    source,
    now,
  });
  const privateOnlyChange = buildBiteSaverRestaurantIndex({
    sourceDocumentId: "account-fingerprint",
    source: {
      ...source,
      email: "changed-private@example.test",
      phoneNumber: "+1 352-555-9999",
      approvalStatus: "approved",
      couponApplicationSubmitted: false,
      subscriptionStatus: "past_due",
      stripeCustomerId: "cus_changed_private",
      updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    },
    now: new Date("2026-08-10T00:00:00.000Z"),
  });

  assert.equal(
    privateOnlyChange.sourceFingerprint,
    original.sourceFingerprint,
  );
  assert.equal(
    privateOnlyChange[biteSaverOfferCatalogUpdatedAtField].toISOString(),
    original[biteSaverOfferCatalogUpdatedAtField].toISOString(),
  );
  for (const forbiddenKey of [
    "approvalStatus",
    "couponApplicationSubmitted",
    "sourceCreatedAt",
    "sourceUpdatedAt",
  ]) {
    assert.equal(Object.hasOwn(original, forbiddenKey), false, forbiddenKey);
    assert.equal(
      Object.hasOwn(privateOnlyChange, forbiddenKey),
      false,
      forbiddenKey,
    );
  }
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

test("BiteScore customer restaurant projection is versioned, exact, and source-ID authoritative", () => {
  const source = biteScoreRestaurant({
    id: "embedded-conflict",
    name: "Café 東京",
    phone: "+1 352-555-0100",
    website: "https://restaurant.example.test",
    bio: "Public profile",
    mainImageUrl: "https://images.example.test/restaurant.jpg",
    businessHours: publicBusinessHoursFixture(),
    cuisineTags: ["Café", "Italian"],
    ownerUserId: "private-owner",
    createdByUserId: "private-creator",
    claimToken: "private-claim-token",
  });
  const index = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "actual-restaurant-document",
    source,
    now,
  });
  const projection = index.customerPublicProjection;

  assert.equal(
    biteScoreRestaurantCustomerPublicProjectionVersion,
    "bitestar.bitescore-customer-public-restaurant.v1",
  );
  assert.equal(
    index.customerPublicProjectionVersion,
    biteScoreRestaurantCustomerPublicProjectionVersion,
  );
  assert.equal(
    projection.customerPublicProjectionVersion,
    biteScoreRestaurantCustomerPublicProjectionVersion,
  );
  assert.equal(projection.sourceDocumentId, "actual-restaurant-document");
  assert.equal(projection.displayName, "Café 東京");
  assert.deepEqual(projection.cuisineTags, ["Café", "Italian"]);
  assert.equal(JSON.stringify(projection).includes("embedded-conflict"), false);
  assert.deepEqual(
    Object.keys(projection).sort(),
    [
      "bio",
      "businessHours",
      "categoryTokens",
      "city",
      "cityStateKey",
      "cuisineTags",
      "customerPublicProjectionVersion",
      "displayName",
      "entityType",
      "geohash",
      "isClaimed",
      "latitude",
      "longitude",
      "namePrefixTokens",
      "normalizedCity",
      "normalizedName",
      "normalizedState",
      "phone",
      "primaryImageUrl",
      "publicVisible",
      "source",
      "sourceDocumentId",
      "state",
      "streetAddress",
      "website",
      "zip5",
      "zipCode",
    ].sort(),
  );
  for (const privateKey of [
    "ownerUserId",
    "createdByUserId",
    "claimToken",
    "sourceFingerprint",
    "indexedAt",
    "adminDirectoryVisible",
  ]) {
    assert.equal(Object.hasOwn(projection, privateKey), false, privateKey);
  }
});

test("BiteScore cuisine tags fail closed before raw byte or token processing", () => {
  const cases = [
    ["lone high first", ["\ud800"]],
    ["lone low first", ["\udc00"]],
    ["embedded malformed", ["broken\ud800tag"]],
    ["malformed after valid", ["safe-before", "broken\ud800"]],
    ["malformed before valid", ["broken\udc00", "safe-after"]],
    [
      "malformed surrounded by valid",
      ["Café", "broken\ud800tag", "ភោជនីយដ្ឋាន"],
    ],
  ];

  for (const [name, cuisineTags] of cases) {
    const watchedTags = new Set(cuisineTags);
    const byteAccountedTags = [];
    const normalizedTags = [];
    const originalByteLength = Buffer.byteLength;
    const originalNormalize = String.prototype.normalize;
    Buffer.byteLength = function byteLengthWithCuisineTagProbe(value, encoding) {
      if (typeof value === "string" && watchedTags.has(value)) {
        byteAccountedTags.push(value);
      }
      return originalByteLength(value, encoding);
    };
    String.prototype.normalize = function normalizeWithCuisineTagProbe(form) {
      const value = String(this);
      if (watchedTags.has(value)) {
        normalizedTags.push(value);
      }
      return originalNormalize.call(this, form);
    };
    let index;
    try {
      index = buildBiteScoreRestaurantIndex({
        sourceDocumentId: `restaurant-malformed-cuisine-${name.replaceAll(" ", "-")}`,
        source: biteScoreRestaurant({cuisineTags}),
        now,
      });
    } finally {
      Buffer.byteLength = originalByteLength;
      String.prototype.normalize = originalNormalize;
    }

    assert.notEqual(index, null, name);
    assert.equal(index.adminDirectoryVisible, true, name);
    assert.equal(index.customerPublicProjection, null, name);
    assert.deepEqual(byteAccountedTags, [], `${name}: byte accounting`);
    assert.deepEqual(normalizedTags, [], `${name}: normalization/token work`);
    for (const tag of cuisineTags) {
      assert.equal(JSON.stringify(index).includes(tag), false, `${name}: ${tag}`);
    }
  }
});

test("BiteScore cuisine tags preserve valid Unicode and existing bounds", () => {
  const cuisineTags = ["Café", "ភោជនីយដ្ឋាន", "Sushi 🍣", "東京"];
  const valid = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-valid-unicode-cuisine",
    source: biteScoreRestaurant({cuisineTags}),
    now,
  });
  assert.deepEqual(valid.customerPublicProjection.cuisineTags, cuisineTags);
  assert.ok(valid.customerPublicProjection.categoryTokens.length > 0);

  const overCount = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-over-count-cuisine",
    source: biteScoreRestaurant({
      cuisineTags: Array.from({length: 33}, (_, index) => `tag-${index}`),
    }),
    now,
  });
  assert.notEqual(overCount, null);
  assert.equal(overCount.adminDirectoryVisible, true);
  assert.equal(overCount.customerPublicProjection, null);

  const overLength = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-over-length-cuisine",
    source: biteScoreRestaurant({cuisineTags: ["x".repeat(101)]}),
    now,
  });
  assert.notEqual(overLength, null);
  assert.equal(overLength.adminDirectoryVisible, true);
  assert.equal(overLength.customerPublicProjection, null);
});

test("same-name and same-location restaurant sources retain distinct exact identities", () => {
  const first = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-a",
    source: biteScoreRestaurant({id: "shared-embedded-id"}),
    now,
  });
  const second = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-b",
    source: biteScoreRestaurant({id: "shared-embedded-id"}),
    now,
  });

  assert.equal(first.customerPublicProjection.sourceDocumentId, "restaurant-a");
  assert.equal(second.customerPublicProjection.sourceDocumentId, "restaurant-b");
  assert.notEqual(first.indexDocumentId, second.indexDocumentId);
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
    assert.equal(
      restaurantIndex.customerPublicProjection === null,
      !fixture.expected,
      fixture.label,
    );

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
    assert.equal(
      dishIndex.customerPublicProjection === null,
      !fixture.expected,
      fixture.label,
    );
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

test("Admin BiteSaver eligibility requires exact optional owner identities", () => {
  const base = {
    id: "restaurant-1",
    name: "The Copper Spoon",
    address: "1 Main St",
    streetAddress: "1 Main St",
    city: "Ocala",
    state: "FL",
    zipCode: "34470",
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    isActive: true,
    isClaimed: false,
    restaurantWriteRevision: 1,
  };
  for (const optionalIdentities of [
    {},
    {ownerUserId: null, linkedBiteSaverUid: null},
    {ownerUserId: "", linkedBiteSaverUid: ""},
    {linkedBiteSaverUid: "account-1"},
  ]) {
    assert.equal(
      biteSaverCatalogBindingAdminState(
        "restaurant-1",
        {...base, ...optionalIdentities},
        true,
      ),
      "unbound",
    );
  }
  assert.equal(
    biteSaverCatalogBindingAdminState(
      "restaurant-1",
      {...base, isClaimed: true, ownerUserId: "owner-1"},
      true,
    ),
    "unbound",
  );
  for (const malformedIdentities of [
    {linkedBiteSaverUid: " account-1"},
    {linkedBiteSaverUid: "account-1 "},
    {linkedBiteSaverUid: "account/1"},
    {linkedBiteSaverUid: "   "},
    {linkedBiteSaverUid: 7},
    {isClaimed: true, ownerUserId: " owner-1"},
    {isClaimed: true, ownerUserId: "owner/1"},
  ]) {
    assert.equal(
      biteSaverCatalogBindingAdminState(
        "restaurant-1",
        {...base, ...malformedIdentities},
        true,
      ),
      "unavailable",
    );
  }
});

test("BiteScore BiteSaver catalog profile requires canonical streetAddress", () => {
  const source = biteScoreRestaurant({
    name: "Canonical Cafe",
    restaurantName: "Legacy Cafe",
    streetAddress: " 10 Canonical Street ",
    address: "99 Legacy Avenue",
    formattedAddress: "88 Formatted Boulevard, Ocala, FL 34470",
    fullAddress: "77 Full Road, Ocala, FL 34470",
    phone: "555-0100",
    phoneNumber: "555-9999",
    website: "https://canonical.example.test",
    websiteUrl: "https://legacy.example.test",
  });
  const profile = biteScoreBiteSaverCatalogProfile(source);
  assert.deepEqual(profile, {
    restaurantName: "Canonical Cafe",
    streetAddress: "10 Canonical Street",
    city: "Ocala",
    state: "FL",
    zipCode: "34470",
    phone: "555-0100",
    website: "https://canonical.example.test",
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });

  assert.equal(
    biteScoreBiteSaverCatalogProfile({
      ...source,
      address: "10 Canonical Street",
    }).streetAddress,
    "10 Canonical Street",
  );
  for (const invalidStreetAddress of [
    undefined,
    null,
    "",
    "   ",
    7,
    {line: "10 Canonical Street"},
    "unsafe\nline",
    "x".repeat(201),
  ]) {
    assert.equal(
      biteScoreBiteSaverCatalogProfile({
        ...source,
        streetAddress: invalidStreetAddress,
      }),
      null,
      String(invalidStreetAddress),
    );
  }
});

test("BiteScore BiteSaver catalog profile accepts dedicated-only streetAddress", () => {
  const catalogRestaurantId = "dedicated-only-catalog-restaurant";
  const source = biteScoreRestaurant({
    id: catalogRestaurantId,
    name: "Dedicated Street Cafe",
    streetAddress: "742 Dedicated-Only Terrace, Suite 9",
    phone: "555-0742",
    website: "https://dedicated-street.example.test",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(source, "address"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(source, "formattedAddress"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(source, "fullAddress"),
    false,
  );

  const profile = biteScoreBiteSaverCatalogProfile(source);
  assert.notEqual(profile, null);
  assert.equal(profile.streetAddress, "742 Dedicated-Only Terrace, Suite 9");
  assert.equal(profile.restaurantName, "Dedicated Street Cafe");
  assert.equal(profile.phone, "555-0742");
  assert.equal(profile.website, "https://dedicated-street.example.test");
  assert.equal(source.id, catalogRestaurantId);
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
  assert.equal(missingLocation.customerPublicProjection, null);

  const invalidGeohash = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "invalid-geohash",
    source: biteScoreRestaurant({geohash: "invalid"}),
    now,
  });
  assert.equal(Object.hasOwn(invalidGeohash, "location"), false);
  assert.equal(invalidGeohash.customerPublicProjection, null);
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
  assert.equal(
    index.customerPublicProjectionVersion,
    biteScoreDishCustomerPublicProjectionVersion,
  );
  assert.equal(
    index.customerPublicProjection.customerPublicProjectionVersion,
    biteScoreDishCustomerPublicProjectionVersion,
  );
});

test("BiteScore customer dish projection has an exact public allowlist and canonical identities", () => {
  const index = buildBiteScoreDishIndex({
    sourceDocumentId: "actual-dish-document",
    dish: dish({
      id: "embedded-dish-conflict",
      restaurantId: "actual-restaurant-document",
      categoryManualKeywords: "wood fired, family",
      priceLabel: "$$",
      createdByUserId: "private-creator",
    }),
    restaurantDocumentId: "actual-restaurant-document",
    restaurant: biteScoreRestaurant({
      id: "embedded-restaurant-conflict",
      ownerUserId: "private-owner",
    }),
    aggregate: aggregate({
      dishId: "actual-dish-document",
      restaurantId: "actual-restaurant-document",
      overallBiteScore: 95,
    }),
    now,
  });
  const projection = index.customerPublicProjection;

  assert.equal(
    biteScoreDishCustomerPublicProjectionVersion,
    "bitestar.bitescore-customer-public-dish.v1",
  );
  assert.equal(projection.sourceDocumentId, "actual-dish-document");
  assert.equal(
    projection.restaurantSourceDocumentId,
    "actual-restaurant-document",
  );
  assert.equal(projection.overallBiteScore, 95);
  assert.ok(projection.categoryTokens.includes("wood fired"));
  assert.ok(projection.categoryTokens.includes("family"));
  assert.deepEqual(
    Object.keys(projection).sort(),
    [
      "category",
      "categoryManualKeywords",
      "categoryPrefixTokens",
      "categoryTags",
      "categoryTokens",
      "cityStateKey",
      "customerPublicProjectionVersion",
      "displayName",
      "entityType",
      "geohash",
      "latitude",
      "longitude",
      "namePrefixTokens",
      "normalizedCategory",
      "normalizedCity",
      "normalizedName",
      "normalizedState",
      "overallBiteScore",
      "overallImpressionAverage",
      "priceLabel",
      "primaryImageUrl",
      "publicVisible",
      "qualityScoreAverage",
      "ratingCount",
      "restaurantCity",
      "restaurantDisplayName",
      "restaurantNamePrefixTokens",
      "restaurantNormalizedName",
      "restaurantSourceDocumentId",
      "restaurantState",
      "restaurantZipCode",
      "source",
      "sourceDocumentId",
      "subcategory",
      "tastinessScoreAverage",
      "valueScoreAverage",
      "zip5",
    ].sort(),
  );
  for (const privateKey of [
    "createdByUserId",
    "ownerUserId",
    "primaryImageId",
    "sourceFingerprint",
    "indexedAt",
    "adminVisible",
  ]) {
    assert.equal(Object.hasOwn(projection, privateKey), false, privateKey);
  }
  assert.equal(JSON.stringify(projection).includes("embedded-dish-conflict"), false);
  assert.equal(
    JSON.stringify(projection).includes("embedded-restaurant-conflict"),
    false,
  );
});

test("same-name score and rating-count dishes retain document-ID tie fields", () => {
  const build = (sourceDocumentId) => buildBiteScoreDishIndex({
    sourceDocumentId,
    dish: dish({id: "shared-embedded-id"}),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate({
      dishId: sourceDocumentId,
      overallBiteScore: 95,
      ratingCount: 42,
    }),
    now,
  });
  const first = build("dish-a");
  const second = build("dish-b");

  assert.equal(first.customerPublicProjection.sourceDocumentId, "dish-a");
  assert.equal(second.customerPublicProjection.sourceDocumentId, "dish-b");
  assert.equal(first.customerPublicProjection.overallBiteScore, 95);
  assert.equal(second.customerPublicProjection.overallBiteScore, 95);
  assert.equal(first.customerPublicProjection.ratingCount, 42);
  assert.equal(second.customerPublicProjection.ratingCount, 42);
  assert.notEqual(first.indexDocumentId, second.indexDocumentId);
});

test("BiteScore customer strings reject unsafe Unicode while visible Unicode survives", () => {
  const unsafeStrings = [
    "Unsafe\u202ename",
    "Unsafe\u200bname",
    "Unsafe\u0001name",
    "Unsafe\u2028name",
    "Unsafe\u2029name",
    "Unsafe\ud800name",
  ];
  for (const unsafe of unsafeStrings) {
    const restaurantIndex = buildBiteScoreRestaurantIndex({
      sourceDocumentId: "restaurant-1",
      source: biteScoreRestaurant({name: unsafe}),
      now,
    });
    assert.notEqual(restaurantIndex, null);
    assert.equal(restaurantIndex.customerPublicProjection, null, unsafe);

    const dishNameIndex = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish({name: unsafe}),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate(),
      now,
    });
    assert.notEqual(dishNameIndex, null);
    assert.equal(dishNameIndex.customerPublicProjection, null, unsafe);

    const parentNameIndex = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish(),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant({name: unsafe}),
      aggregate: aggregate(),
      now,
    });
    assert.notEqual(parentNameIndex, null);
    assert.equal(parentNameIndex.customerPublicProjection, null, unsafe);
  }

  const visibleName = "Café ខ្មែរ 😀";
  const visible = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-visible",
    dish: dish({
      name: visibleName,
      category: "Entrée ខ្មែរ",
      priceLabel: "€€",
      primaryImageUrl: "https://images.example.test/😀.jpg",
    }),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant({name: "ភោជនីយដ្ឋាន Café 😀"}),
    aggregate: aggregate({dishId: "dish-visible"}),
    now,
  });
  assert.equal(visible.customerPublicProjection.displayName, visibleName);
  assert.equal(
    visible.customerPublicProjection.restaurantDisplayName,
    "ភោជនីយដ្ឋាន Café 😀",
  );
  assert.equal(visible.customerPublicProjection.category, "Entrée ខ្មែរ");
  assert.equal(visible.customerPublicProjection.priceLabel, "€€");
  assert.equal(
    visible.customerPublicProjection.primaryImageUrl,
    "https://images.example.test/😀.jpg",
  );

  const unsafeOptional = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish({
      category: "Dinner\u202ehidden",
      subcategory: "Pizza\u200bhidden",
      priceLabel: "$\u0001$",
      primaryImageUrl: "https://images.example.test/\u202ebad.jpg",
    }),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate(),
    now,
  });
  const projection = unsafeOptional.customerPublicProjection;
  assert.notEqual(projection, null);
  for (const field of ["category", "subcategory", "priceLabel", "primaryImageUrl"]) {
    assert.equal(Object.hasOwn(projection, field), false, field);
  }
  assert.equal(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(JSON.stringify(projection)), false);

  for (const unsafeUrl of [
    "https://images.example.test/\u202ebad.jpg",
    "https://images.example.test/\u200bbad.jpg",
    "https://images.example.test/\u0001bad.jpg",
    "https://images.example.test/\u2028bad.jpg",
    "https://images.example.test/\u2029bad.jpg",
    "https://images.example.test/\ud800bad.jpg",
  ]) {
    const restaurantIndex = buildBiteScoreRestaurantIndex({
      sourceDocumentId: "restaurant-1",
      source: biteScoreRestaurant({
        primaryImageUrl: unsafeUrl,
        mainImageUrl: "https://images.example.test/lower-priority-safe.jpg",
      }),
      now,
    });
    assert.notEqual(restaurantIndex.customerPublicProjection, null);
    assert.equal(
      Object.hasOwn(restaurantIndex.customerPublicProjection, "primaryImageUrl"),
      false,
      unsafeUrl,
    );
  }
  const unsafeMainImage = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-1",
    source: biteScoreRestaurant({
      mainImageUrl: "https://images.example.test/\u200bbad.jpg",
    }),
    now,
  });
  assert.equal(
    Object.hasOwn(unsafeMainImage.customerPublicProjection, "primaryImageUrl"),
    false,
  );
  const presentInvalidPrimary = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-1",
    source: biteScoreRestaurant({
      primaryImageUrl: undefined,
      mainImageUrl: "https://images.example.test/lower-priority-safe.jpg",
    }),
    now,
  });
  assert.equal(
    Object.hasOwn(
      presentInvalidPrimary.customerPublicProjection,
      "primaryImageUrl",
    ),
    false,
  );
  const safeRestaurantImage = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-1",
    source: biteScoreRestaurant({
      primaryImageUrl: "https://images.example.test/ខ្មែរ-😀.jpg",
    }),
    now,
  });
  assert.equal(
    safeRestaurantImage.customerPublicProjection.primaryImageUrl,
    "https://images.example.test/ខ្មែរ-😀.jpg",
  );
});

test("actual BiteScore source and parent IDs must be exact safe Firestore segments", () => {
  const invalidIds = [
    "",
    " padded",
    "padded ",
    "slash/id",
    ".",
    "..",
    "control\u0001",
    "format\u200b",
    "khmer\u17b4",
    "khmer\u17b5",
    "malformed\ud800",
    "x".repeat(1_501),
  ];
  for (const invalidId of invalidIds) {
    assert.equal(buildBiteScoreRestaurantIndex({
      sourceDocumentId: invalidId,
      source: biteScoreRestaurant(),
      now,
    }), null, `restaurant ${JSON.stringify(invalidId)}`);
    assert.equal(buildBiteScoreDishIndex({
      sourceDocumentId: invalidId,
      dish: dish(),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate(),
      now,
    }), null, `dish ${JSON.stringify(invalidId)}`);
    assert.equal(buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish({restaurantId: invalidId}),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate(),
      now,
    }), null, `parent ${JSON.stringify(invalidId)}`);
  }

  for (const validId of ["AbCdEf1234567890", "ChIJN1t_tDeuEmsRUsoyG83frY4"]) {
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: validId,
      dish: dish({restaurantId: "restaurant-1"}),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate({dishId: validId}),
      now,
    });
    assert.equal(index.sourceDocumentId, validId);
    assert.equal(index.customerPublicProjection.sourceDocumentId, validId);
  }
});

test("overall BiteScore uses 0-100 while component averages remain 0-10", () => {
  for (const score of [0, 1, 8.5, 10, 80, 95, 100]) {
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish(),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate({overallBiteScore: score}),
      now,
    });
    assert.equal(index.overallBiteScore, score, `overall ${score}`);
    assert.equal(
      index.customerPublicProjection.overallBiteScore,
      score,
      `customer overall ${score}`,
    );
  }

  for (const invalid of [-1, 100.01, Number.NaN, Number.POSITIVE_INFINITY, "95"]) {
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish(),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate({overallBiteScore: invalid}),
      now,
    });
    assert.equal(index.overallBiteScore, 0, `invalid overall ${invalid}`);
    assert.equal(index.customerPublicProjection.overallBiteScore, 0);
  }

  for (const componentField of [
    "overallImpressionAverage",
    "tastinessScoreAverage",
    "qualityScoreAverage",
    "valueScoreAverage",
  ]) {
    for (const score of [0, 8.5, 10]) {
      const index = buildBiteScoreDishIndex({
        sourceDocumentId: "dish-1",
        dish: dish(),
        restaurantDocumentId: "restaurant-1",
        restaurant: biteScoreRestaurant(),
        aggregate: aggregate({[componentField]: score}),
        now,
      });
      assert.equal(index[componentField], score, `${componentField} ${score}`);
      assert.equal(index.customerPublicProjection[componentField], score);
    }
    for (const invalid of [-1, 10.01, Number.NaN, Number.POSITIVE_INFINITY, "8.5"]) {
      const index = buildBiteScoreDishIndex({
        sourceDocumentId: "dish-1",
        dish: dish(),
        restaurantDocumentId: "restaurant-1",
        restaurant: biteScoreRestaurant(),
        aggregate: aggregate({[componentField]: invalid}),
        now,
      });
      assert.equal(Object.hasOwn(index, componentField), false);
      assert.equal(
        Object.hasOwn(index.customerPublicProjection, componentField),
        false,
      );
    }
  }

  for (const [ratingCount, expected] of [
    [0, 0],
    [12, 12],
    [-1, 0],
    [1.5, 0],
    ["12", 0],
  ]) {
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish(),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate({ratingCount}),
      now,
    });
    assert.equal(index.ratingCount, expected, `rating count ${ratingCount}`);
    assert.equal(index.customerPublicProjection.ratingCount, expected);
  }
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
    assert.equal(index.customerPublicProjection, null);
  }
});

test("dish customer projection fails closed without canonical parent geography", () => {
  for (const restaurant of [
    biteScoreRestaurant({latitude: undefined, longitude: undefined, location: undefined}),
    biteScoreRestaurant({geohash: "wrong"}),
    biteScoreRestaurant({latitude: 0, longitude: 0, location: undefined}),
    biteScoreRestaurant({city: ""}),
    biteScoreRestaurant({state: ""}),
    biteScoreRestaurant({zipCode: "bad"}),
  ]) {
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish(),
      restaurantDocumentId: "restaurant-1",
      restaurant,
      aggregate: aggregate(),
      now,
    });
    assert.equal(index.customerPublicProjection, null);
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
  const tags = Array.from({length: 30}, (_, index) => `Tag ${index}`);
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

  const overLimit = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-1",
    dish: dish({categoryTags: Array.from({length: 129}, (_, i) => `Tag ${i}`)}),
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate(),
    now,
  });
  assert.deepEqual(overLimit.categoryTokens, []);
  assert.equal(overLimit.customerPublicProjection, null);
});

test("dish category inputs reject every malformed UTF-16 source", () => {
  const malformedCases = [
    {label: "category-high", source: {category: "bad\ud800"}},
    {label: "category-low", source: {category: "bad\udc00"}},
    {label: "subcategory-high", source: {subcategory: "\ud800bad"}},
    {label: "subcategory-low", source: {subcategory: "\udc00bad"}},
    {
      label: "manual-string-high",
      source: {categoryManualKeywords: "safe,embedded\ud800bad"},
    },
    {
      label: "manual-string-low",
      source: {categoryManualKeywords: "safe,embedded\udc00bad"},
    },
    {
      label: "manual-array-high",
      source: {categoryManualKeywords: ["safe", "embedded\ud800bad"]},
    },
    {
      label: "manual-array-low",
      source: {categoryManualKeywords: ["safe", "embedded\udc00bad"]},
    },
    {
      label: "tag-high",
      source: {categoryTags: ["safe", "embedded\ud800bad"]},
    },
    {
      label: "tag-low",
      source: {categoryTags: ["safe", "embedded\udc00bad"]},
    },
  ];

  for (const {label, source} of malformedCases) {
    const dishId = `dish-malformed-${label}`;
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: dishId,
      dish: dish({id: dishId, ...source}),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate({dishId}),
      now,
    });
    assert.notEqual(index, null, label);
    assert.equal(index.customerPublicProjection, null, label);
    assert.deepEqual(index.categoryTokens, [], label);
  }
});

test("well-formed supplementary and Khmer category sources remain eligible", () => {
  const dishId = "dish-valid-unicode-category";
  const correctedDish = dish({
    id: dishId,
    category: "𐐀 Khmer Entrée",
    subcategory: "ម្ហូបខ្មែរ",
    categoryManualKeywords: "𐐀 special, ខ្មែរ",
    categoryTags: ["រសជាតិខ្មែរ", "𐐀𐐁 special"],
  });
  const corrected = buildBiteScoreDishIndex({
    sourceDocumentId: dishId,
    dish: correctedDish,
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate({dishId}),
    now,
  });
  assert.notEqual(corrected.customerPublicProjection, null);
  assert.equal(
    corrected.customerPublicProjection.category,
    correctedDish.category,
  );
  assert.equal(
    corrected.customerPublicProjection.subcategory,
    correctedDish.subcategory,
  );
  assert.equal(
    corrected.customerPublicProjection.categoryManualKeywords,
    correctedDish.categoryManualKeywords,
  );
  assert.deepEqual(
    corrected.customerPublicProjection.categoryTags,
    correctedDish.categoryTags,
  );
  assert.ok(corrected.categoryTokens.length > 0);

  const malformed = buildBiteScoreDishIndex({
    sourceDocumentId: dishId,
    dish: {...correctedDish, categoryTags: ["រសជាតិខ្មែរ", "bad\ud800"]},
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate({dishId}),
    now,
  });
  assert.equal(malformed.customerPublicProjection, null);
  const recovered = buildBiteScoreDishIndex({
    sourceDocumentId: dishId,
    dish: correctedDish,
    restaurantDocumentId: "restaurant-1",
    restaurant: biteScoreRestaurant(),
    aggregate: aggregate({dishId}),
    now,
  });
  assert.notEqual(recovered.customerPublicProjection, null);
  assert.deepEqual(
    recovered.customerPublicProjection.categoryTags,
    correctedDish.categoryTags,
  );
});

test("manual category keyword budgets count exact raw string and array bytes", () => {
  const forms = [
    {
      label: "string",
      valueAtBytes: (bytes, supplementary) => {
        const entries = supplementary
          ? commaSeparatedEntriesWithSupplementaryCharacter(bytes, "m")
          : commaSeparatedAsciiEntries(bytes, "m");
        return entries.join(",");
      },
      measuredBytes: (value) => Buffer.byteLength(value, "utf8"),
    },
    {
      label: "array",
      valueAtBytes: (bytes, supplementary) => supplementary
        ? commaSeparatedEntriesWithSupplementaryCharacter(bytes, "m")
        : commaSeparatedAsciiEntries(bytes, "m"),
      measuredBytes: (value) => value.reduce(
        (bytes, entry, index) =>
          bytes + Buffer.byteLength(entry, "utf8") + (index === 0 ? 0 : 1),
        0,
      ),
    },
  ];

  for (const form of forms) {
    for (const supplementary of [false, true]) {
      for (const bytes of [4_095, 4_096, 4_097]) {
        const categoryManualKeywords = form.valueAtBytes(bytes, supplementary);
        assert.equal(
          form.measuredBytes(categoryManualKeywords),
          bytes,
          `${form.label} ${supplementary} ${bytes}`,
        );
        const index = buildBiteScoreDishIndex({
          sourceDocumentId: `dish-manual-${form.label}-${supplementary}-${bytes}`,
          dish: dish({
            id: `dish-manual-${form.label}-${supplementary}-${bytes}`,
            categoryManualKeywords,
          }),
          restaurantDocumentId: "restaurant-1",
          restaurant: biteScoreRestaurant(),
          aggregate: aggregate({
            dishId: `dish-manual-${form.label}-${supplementary}-${bytes}`,
          }),
          now,
        });
        assert.equal(
          index.customerPublicProjection !== null,
          bytes <= maximumDishCategoryManualKeywordBytes,
          `${form.label} ${supplementary} ${bytes}`,
        );
        assert.equal(
          index.categoryTokens.length > 0,
          bytes <= maximumDishCategoryManualKeywordBytes,
          `${form.label} ${supplementary} ${bytes}`,
        );
      }
    }
  }

  for (const extraBytes of [0, 1, 2]) {
    const commaHeavyArray = Array.from(
      {length: maximumDishCategoryInputCount},
      () => ",".repeat(31),
    );
    commaHeavyArray[0] += "x".repeat(extraBytes);
    const rawBytes = commaHeavyArray.reduce(
      (bytes, entry, index) =>
        bytes + Buffer.byteLength(entry, "utf8") + (index === 0 ? 0 : 1),
      0,
    );
    assert.equal(rawBytes, 4_095 + extraBytes);
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: `dish-comma-heavy-${rawBytes}`,
      dish: dish({
        id: `dish-comma-heavy-${rawBytes}`,
        categoryManualKeywords: commaHeavyArray,
      }),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate({dishId: `dish-comma-heavy-${rawBytes}`}),
      now,
    });
    assert.equal(
      index.customerPublicProjection !== null,
      rawBytes <= maximumDishCategoryManualKeywordBytes,
    );
  }
});

test("combined category budget counts commas and separators across mixed sources", () => {
  for (const supplementary of [false, true]) {
    for (const bytes of [8_191, 8_192, 8_193]) {
      const categorySource = mixedCategorySourceAtRawBytes(
        bytes,
        supplementary,
      );
      const dishId = `dish-combined-${supplementary}-${bytes}`;
      const index = buildBiteScoreDishIndex({
        sourceDocumentId: dishId,
        dish: dish({id: dishId, ...categorySource}),
        restaurantDocumentId: "restaurant-1",
        restaurant: biteScoreRestaurant(),
        aggregate: aggregate({dishId}),
        now,
      });
      assert.equal(
        index.customerPublicProjection !== null,
        bytes <= maximumDishCategoryCombinedSourceBytes,
        `${supplementary} ${bytes}`,
      );
      assert.equal(
        index.categoryTokens.length > 0,
        bytes <= maximumDishCategoryCombinedSourceBytes,
        `${supplementary} ${bytes}`,
      );
    }
  }
});

test("real customer projections enforce total UTF-8 and source-processing budgets", () => {
  assert.equal(maximumDishCategoryInputCount, 128);
  assert.equal(maximumDishCategoryManualKeywordBytes, 4_096);
  assert.equal(maximumDishCategoryCombinedSourceBytes, 8_192);

  const restaurant = buildBiteScoreRestaurantIndex({
    sourceDocumentId: "restaurant-maximum",
    source: biteScoreRestaurant({
      name: "N".repeat(100),
      streetAddress: "A".repeat(200),
      city: "C".repeat(100),
      state: "FL",
      zipCode: "34470",
      website: `https://example.test/${"w".repeat(478)}`,
      bio: "B".repeat(2_000),
      primaryImageUrl: `https://example.test/${"i".repeat(1_978)}`,
      cuisineTags: Array.from({length: 32}, (_, index) =>
        `${String(index).padStart(2, "0")}${"t".repeat(98)}`),
    }),
    now,
  });
  assert.notEqual(restaurant.customerPublicProjection, null);
  assert.ok(
    serializedSearchIndexDocumentBytes(restaurant.customerPublicProjection) <=
      maximumSearchIndexDocumentBytes,
  );
  assert.ok(serializedSearchIndexDocumentBytes(restaurant) <= maximumSearchIndexDocumentBytes);

  const maximumDish = buildBiteScoreDishIndex({
    sourceDocumentId: "dish-maximum",
    dish: dish({
      restaurantId: "restaurant-maximum",
      name: "D".repeat(100),
      category: `00${"c".repeat(98)}`,
      subcategory: `01${"s".repeat(98)}`,
      categoryTags: Array.from({length: 30}, (_, index) =>
        `${String(index + 2).padStart(2, "0")}${"t".repeat(98)}`),
      primaryImageUrl: `https://example.test/${"i".repeat(1_978)}`,
    }),
    restaurantDocumentId: "restaurant-maximum",
    restaurant: biteScoreRestaurant({name: "R".repeat(100)}),
    aggregate: aggregate({dishId: "dish-maximum", restaurantId: "restaurant-maximum"}),
    now,
  });
  assert.notEqual(maximumDish.customerPublicProjection, null);
  assert.equal(maximumDish.categoryTokens.length, maximumDishCategorySourceCount);
  assert.ok(
    serializedSearchIndexDocumentBytes(maximumDish.customerPublicProjection) <=
      maximumSearchIndexDocumentBytes,
  );
  assert.ok(serializedSearchIndexDocumentBytes(maximumDish) <= maximumSearchIndexDocumentBytes);

  const oversizedCases = [
    {categoryManualKeywords: "x".repeat(maximumDishCategoryManualKeywordBytes + 1)},
    {categoryManualKeywords: Object.assign([], {length: 1_000_000})},
    {categoryTags: Object.assign([], {length: 1_000_000})},
    {
      categoryTags: Array.from({length: maximumDishCategoryInputCount}, (_, index) =>
        `${String(index).padStart(3, "0")}${"x".repeat(97)}`),
    },
  ];
  for (const oversized of oversizedCases) {
    const index = buildBiteScoreDishIndex({
      sourceDocumentId: "dish-1",
      dish: dish(oversized),
      restaurantDocumentId: "restaurant-1",
      restaurant: biteScoreRestaurant(),
      aggregate: aggregate(),
      now,
    });
    assert.equal(index.customerPublicProjection, null);
    assert.deepEqual(index.categoryTokens, []);
    assert.equal(index.adminVisible, true);
    assert.equal(index.displayName, "Wood-Fired Pizza");
  }

  const emptyDocumentBytes = serializedSearchIndexDocumentBytes({value: ""});
  const exactBoundary = {value: "x".repeat(maximumSearchIndexDocumentBytes - emptyDocumentBytes)};
  assert.equal(serializedSearchIndexDocumentBytes(exactBoundary), maximumSearchIndexDocumentBytes);
  assert.equal(requireSearchIndexDocumentSize(exactBoundary), exactBoundary);
  assert.throws(
    () => requireSearchIndexDocumentSize({value: `${exactBoundary.value}x`}),
    /exceeds the private size limit/,
  );
  const unicodeBoundary = {
    value: `${"x".repeat(maximumSearchIndexDocumentBytes - emptyDocumentBytes - 4)}😀`,
  };
  assert.equal(serializedSearchIndexDocumentBytes(unicodeBoundary), maximumSearchIndexDocumentBytes);
  assert.equal(requireSearchIndexDocumentSize(unicodeBoundary), unicodeBoundary);
});

test("actual dish builder enforces the complete 64 KiB boundary and recovers", () => {
  const supplementaryLetter = (offset) =>
    String.fromCodePoint(0x10400 + offset);
  const highByteName = (offset) => [
    supplementaryLetter(offset).repeat(32),
    supplementaryLetter(offset + 1).repeat(32),
    supplementaryLetter(offset + 2).repeat(32),
  ].join(" ");
  const restaurantId = "restaurant-size";
  const dishId = "dish-size";
  const restaurant = {
    name: highByteName(0),
    streetAddress: "A".repeat(200),
    city: "Ocala",
    state: "FL",
    zipCode: "34470",
    location: new GeoPoint(coordinates.latitude, coordinates.longitude),
    geohash,
    isActive: true,
    isClaimed: false,
  };
  const aggregateDocument = {
    dishId,
    restaurantId,
    overallBiteScore: 100,
    ratingCount: 1,
  };
  const buildAtPrimaryImageId = (primaryImageId) =>
    buildBiteScoreDishIndex({
      sourceDocumentId: dishId,
      dish: {
        id: dishId,
        restaurantId,
        name: highByteName(4),
        categoryTags: Array.from({length: 14}, (_, index) =>
          supplementaryLetter(10 + index).repeat(100)),
        isActive: true,
        primaryImageId,
        primaryImageUrl:
          `https://e.test/${supplementaryLetter(50).repeat(1_979)}`,
      },
      restaurantDocumentId: restaurantId,
      restaurant,
      aggregate: aggregateDocument,
      now,
    });

  const immediatelyBelow = buildAtPrimaryImageId("i".repeat(1_458));
  const exactBoundary = buildAtPrimaryImageId("i".repeat(1_459));
  assert.equal(
    serializedSearchIndexDocumentBytes(immediatelyBelow),
    maximumSearchIndexDocumentBytes - 1,
  );
  assert.notEqual(immediatelyBelow.customerPublicProjection, null);
  assert.equal(
    serializedSearchIndexDocumentBytes(exactBoundary),
    maximumSearchIndexDocumentBytes,
  );
  assert.notEqual(exactBoundary.customerPublicProjection, null);

  const oneByteOver = buildAtPrimaryImageId("i".repeat(1_460));
  assert.equal(oneByteOver.customerPublicProjection, null);
  assert.equal(
    serializedSearchIndexDocumentBytes({
      ...oneByteOver,
      customerPublicProjection: exactBoundary.customerPublicProjection,
    }),
    maximumSearchIndexDocumentBytes + 1,
  );

  const supplementaryOver = buildAtPrimaryImageId(
    `${"i".repeat(1_459)}😀`,
  );
  assert.equal(supplementaryOver.customerPublicProjection, null);
  assert.equal(
    serializedSearchIndexDocumentBytes({
      ...supplementaryOver,
      customerPublicProjection: exactBoundary.customerPublicProjection,
    }),
    maximumSearchIndexDocumentBytes + 4,
  );

  const corrected = buildAtPrimaryImageId("i".repeat(1_458));
  assert.notEqual(corrected.customerPublicProjection, null);
  assert.equal(
    serializedSearchIndexDocumentBytes(corrected),
    maximumSearchIndexDocumentBytes - 1,
  );
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

test("BiteSaver restaurant and offer parents share strict display-name selection", () => {
  const safeAlias = "Safe Alias Café";
  const withoutCanonical = biteSaverRestaurant({name: safeAlias});
  delete withoutCanonical.restaurantName;
  const unsupportedLowerAlias = biteSaverRestaurant({
    restaurantName: "unsafe\u200bname",
    restaurant_name: safeAlias,
  });

  const cases = [
    {
      label: "safe canonical without lower alias",
      restaurant: biteSaverRestaurant({restaurantName: "  Safe Bistro  "}),
      expectedName: "Safe Bistro",
    },
    {
      label: "unsafe canonical falls back to supported name alias",
      restaurant: biteSaverRestaurant({
        restaurantName: "unsafe\u200bname",
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "unsupported restaurant_name does not rescue unsafe canonical",
      restaurant: unsupportedLowerAlias,
      expectedName: null,
    },
    {
      label: "absent canonical falls back to name",
      restaurant: withoutCanonical,
      expectedName: safeAlias,
    },
    {
      label: "null canonical falls back to name",
      restaurant: biteSaverRestaurant({restaurantName: null, name: safeAlias}),
      expectedName: safeAlias,
    },
    {
      label: "empty canonical falls back to name",
      restaurant: biteSaverRestaurant({restaurantName: "", name: safeAlias}),
      expectedName: safeAlias,
    },
    {
      label: "whitespace canonical falls back to name",
      restaurant: biteSaverRestaurant({restaurantName: "   ", name: safeAlias}),
      expectedName: safeAlias,
    },
    {
      label: "lone high surrogate falls back before normalization",
      restaurant: biteSaverRestaurant({restaurantName: "\ud800", name: safeAlias}),
      expectedName: safeAlias,
    },
    {
      label: "lone low surrogate falls back before normalization",
      restaurant: biteSaverRestaurant({restaurantName: "\udc00", name: safeAlias}),
      expectedName: safeAlias,
    },
    {
      label: "embedded malformed surrogate falls back before normalization",
      restaurant: biteSaverRestaurant({
        restaurantName: "unsafe\ud800name",
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "NUL control falls back",
      restaurant: biteSaverRestaurant({
        restaurantName: "unsafe\u0000name",
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "C0 control falls back",
      restaurant: biteSaverRestaurant({
        restaurantName: "unsafe\u001fname",
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "zero-width format character falls back",
      restaurant: biteSaverRestaurant({
        restaurantName: "unsafe\u200bname",
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "bidi override falls back",
      restaurant: biteSaverRestaurant({
        restaurantName: "unsafe\u202ename",
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "line separator falls back",
      restaurant: biteSaverRestaurant({
        restaurantName: "unsafe\u2028name",
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "paragraph separator falls back",
      restaurant: biteSaverRestaurant({
        restaurantName: "unsafe\u2029name",
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "ordinary accented text remains accepted",
      restaurant: biteSaverRestaurant({restaurantName: "Crème Brûlée Café"}),
      expectedName: "Crème Brûlée Café",
    },
    {
      label: "visible Khmer text remains accepted",
      restaurant: biteSaverRestaurant({restaurantName: "ភោជនីយដ្ឋាន ខ្មែរ"}),
      expectedName: "ភោជនីយដ្ឋាន ខ្មែរ",
    },
    {
      label: "supplementary Unicode remains accepted",
      restaurant: biteSaverRestaurant({restaurantName: "Smile 😀 Grill"}),
      expectedName: "Smile 😀 Grill",
    },
    {
      label: "NFKC-compatible visible name is normalized",
      restaurant: biteSaverRestaurant({restaurantName: "  Ｃａｆé  "}),
      expectedName: "Café",
    },
    {
      label: "overlength code-point value falls back",
      restaurant: biteSaverRestaurant({
        restaurantName: "x".repeat(101),
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "overlength raw-byte value falls back",
      restaurant: biteSaverRestaurant({
        restaurantName: "😀".repeat(101),
        name: safeAlias,
      }),
      expectedName: safeAlias,
    },
    {
      label: "overlength value without supported fallback fails closed",
      restaurant: biteSaverRestaurant({restaurantName: "x".repeat(101)}),
      expectedName: null,
    },
  ];

  for (const {label, restaurant, expectedName} of cases) {
    assertBiteSaverParentNameSelection(restaurant, expectedName, label);
  }

  assertOfferParentTransitionEquivalent(
    biteSaverRestaurant({restaurantName: "unsafe\ud800", name: safeAlias}),
    biteSaverRestaurant({restaurantName: "unsafe\u202e", name: safeAlias}),
    "different rejected canonical names share one effective fallback",
  );
  assertOfferParentTransitionChanges(
    biteSaverRestaurant({restaurantName: "unsafe\ud800", name: "Alias One"}),
    biteSaverRestaurant({restaurantName: "unsafe\ud800", name: "Alias Two"}),
    "effective fallback name changes",
  );
});

test("BiteSaver restaurant and offer parents share authoritative image selection", () => {
  const canonicalUrl = "https://images.example.test/canonical.jpg";
  const fallbackUrl = "https://images.example.test/fallback.jpg";
  const changedFallbackUrl = "https://images.example.test/fallback-2.jpg";
  const unicodeUrl = "https://images.example.test/ខ្មែរ/😀.jpg";
  const imageUrlPrefix = "https://images.example.test/";
  const maximumLengthUrl = imageUrlPrefix +
    "a".repeat(2_000 - imageUrlPrefix.length);
  const overlengthUrl = `${maximumLengthUrl}a`;
  const fallbackOnly = (imageUrl) => {
    const restaurant = biteSaverRestaurant({imageUrl});
    delete restaurant.mainImageUrl;
    return restaurant;
  };
  const withoutImages = biteSaverRestaurant();
  delete withoutImages.mainImageUrl;

  const cases = [
    {
      label: "valid canonical without fallback",
      restaurant: biteSaverRestaurant({mainImageUrl: canonicalUrl}),
      expectedUrl: canonicalUrl,
    },
    {
      label: "absent canonical uses valid fallback",
      restaurant: fallbackOnly(fallbackUrl),
      expectedUrl: fallbackUrl,
    },
    {
      label: "null canonical remains authoritative over valid fallback",
      restaurant: biteSaverRestaurant({
        mainImageUrl: null,
        imageUrl: fallbackUrl,
      }),
      expectedUrl: null,
    },
    {
      label: "valid canonical wins over different valid fallback",
      restaurant: biteSaverRestaurant({
        mainImageUrl: canonicalUrl,
        imageUrl: fallbackUrl,
      }),
      expectedUrl: canonicalUrl,
    },
    {
      label: "present-invalid canonical blocks safe fallback",
      restaurant: biteSaverRestaurant({
        mainImageUrl: "not-a-url",
        imageUrl: fallbackUrl,
      }),
      expectedUrl: null,
    },
    {
      label: "valid visible Unicode fallback URL remains accepted",
      restaurant: fallbackOnly(unicodeUrl),
      expectedUrl: unicodeUrl,
    },
    {
      label: "maximum-length fallback URL remains accepted",
      restaurant: fallbackOnly(maximumLengthUrl),
      expectedUrl: maximumLengthUrl,
    },
    {
      label: "overlength fallback URL is rejected",
      restaurant: fallbackOnly(overlengthUrl),
      expectedUrl: null,
    },
    ...[
      ["lone high surrogate", "https://images.example.test/\ud800.jpg"],
      ["lone low surrogate", "https://images.example.test/\udc00.jpg"],
      ["embedded malformed surrogate", "https://images.example.test/a\ud800b.jpg"],
      ["NUL control", "https://images.example.test/a\u0000b.jpg"],
      ["zero-width format character", "https://images.example.test/a\u200bb.jpg"],
      ["bidi override", "https://images.example.test/a\u202eb.jpg"],
      ["line separator", "https://images.example.test/a\u2028b.jpg"],
      ["paragraph separator", "https://images.example.test/a\u2029b.jpg"],
      ["fullwidth hostname", "https://ｅxample.test/image.jpg"],
      ["IDNA-mapped hostname separator", "https://example．test/image.jpg"],
      ["NFKC-repaired path separator", "https://example.test／image.jpg"],
    ].map(([label, imageUrl]) => ({
      label: `${label} fallback URL is rejected`,
      restaurant: fallbackOnly(imageUrl),
      expectedUrl: null,
    })),
    {
      label: "both image fields absent omit the effective image",
      restaurant: withoutImages,
      expectedUrl: null,
    },
  ];

  for (const {label, restaurant, expectedUrl} of cases) {
    assertBiteSaverParentImageSelection(restaurant, expectedUrl, label);
  }

  assertOfferParentTransitionEquivalent(
    biteSaverRestaurant({
      mainImageUrl: canonicalUrl,
      imageUrl: fallbackUrl,
    }),
    biteSaverRestaurant({
      mainImageUrl: canonicalUrl,
      imageUrl: changedFallbackUrl,
    }),
    "ignored fallback changes under valid canonical image",
  );
  assertOfferParentTransitionChanges(
    fallbackOnly(fallbackUrl),
    fallbackOnly(changedFallbackUrl),
    "effective fallback image changes",
  );

  const canonicalAndFallback = biteSaverRestaurant({
    mainImageUrl: canonicalUrl,
    imageUrl: fallbackUrl,
  });
  const canonicalRemoved = {...canonicalAndFallback};
  delete canonicalRemoved.mainImageUrl;
  assertOfferParentTransitionChanges(
    canonicalAndFallback,
    canonicalRemoved,
    "canonical image removal makes fallback effective",
  );
  assertBiteSaverParentImageSelection(
    canonicalRemoved,
    fallbackUrl,
    "canonical image removed",
  );
  assertOfferParentTransitionChanges(
    canonicalRemoved,
    withoutImages,
    "removing both images removes the effective image",
  );
});

test("BiteSaver offer-parent ZIP fingerprint follows validated alias fallback and canonical ZIP output", () => {
  const validZip = biteSaverRestaurant({zipCode: "34428"});
  const changedValidZip = biteSaverRestaurant({zipCode: "34429"});
  assertOfferParentTransitionChanges(
    validZip,
    changedValidZip,
    "valid canonical ZIP change",
  );

  const absentZipFirst = biteSaverRestaurant({postalCode: "34470"});
  delete absentZipFirst.zipCode;
  const absentZipSecond = {...absentZipFirst, postalCode: "33602"};
  assertOfferParentTransitionChanges(
    absentZipFirst,
    absentZipSecond,
    "absent canonical ZIP uses postalCode",
  );

  assertOfferParentTransitionChanges(
    biteSaverRestaurant({zipCode: null, postalCode: "34470"}),
    biteSaverRestaurant({zipCode: null, postalCode: "33602"}),
    "null canonical ZIP uses postalCode",
  );

  const malformedPrimaryFirst = biteSaverRestaurant({
    zipCode: "34\tBAD",
    postalCode: "34470",
  });
  const malformedPrimarySecond = {
    ...malformedPrimaryFirst,
    postalCode: "33602",
  };
  assert.equal(
    effectiveOfferParentProjection(
      biteSaverOffersForParent(malformedPrimaryFirst)[0],
    ).zip5,
    "34470",
  );
  assertOfferParentTransitionChanges(
    malformedPrimaryFirst,
    malformedPrimarySecond,
    "raw-invalid canonical ZIP falls back",
  );

  const postalMalformedFirst = biteSaverRestaurant({
    zipCode: undefined,
    postalCode: "34\tBAD",
    zip: "34470",
  });
  const postalMalformedSecond = {...postalMalformedFirst, zip: "33602"};
  assertOfferParentTransitionChanges(
    postalMalformedFirst,
    postalMalformedSecond,
    "raw-invalid postalCode falls back to zip",
  );

  const selectedButInvalidZipFirst = biteSaverRestaurant({
    zipCode: "34BAD",
    postalCode: "34470",
  });
  const selectedButInvalidZipSecond = {
    ...selectedButInvalidZipFirst,
    postalCode: "33602",
  };
  assert.equal(
    Object.hasOwn(
      effectiveOfferParentProjection(
        biteSaverOffersForParent(selectedButInvalidZipFirst)[0],
      ),
      "zip5",
    ),
    false,
  );
  assertOfferParentTransitionEquivalent(
    selectedButInvalidZipFirst,
    selectedButInvalidZipSecond,
    "public-string-valid but non-ZIP canonical value blocks fallback",
  );

  assertOfferParentTransitionEquivalent(
    biteSaverRestaurant({
      zipCode: "34428",
      postalCode: "34470",
      zip: "33602",
    }),
    biteSaverRestaurant({
      zipCode: "34428",
      postalCode: "99999",
      zip: "00501",
    }),
    "lower ZIP aliases do not override a valid canonical ZIP",
  );

  const canonicalRepresentation = biteSaverRestaurant({zipCode: "34470"});
  const postalRepresentation = biteSaverRestaurant({postalCode: "34470"});
  delete postalRepresentation.zipCode;
  const zipRepresentation = biteSaverRestaurant({zip: "34470"});
  delete zipRepresentation.zipCode;
  assertOfferParentTransitionEquivalent(
    canonicalRepresentation,
    postalRepresentation,
    "canonical ZIP and postalCode can produce one effective projection",
  );
  assertOfferParentTransitionEquivalent(
    canonicalRepresentation,
    zipRepresentation,
    "canonical ZIP and zip can produce one effective projection",
  );

  const leadingZeroZip = biteSaverRestaurant({zipCode: "03440"});
  const leadingZeroZipPlus4 = biteSaverRestaurant({zipCode: "03440-1234"});
  assert.equal(
    effectiveOfferParentProjection(
      biteSaverOffersForParent(leadingZeroZip)[0],
    ).zip5,
    "03440",
  );
  assertOfferParentTransitionEquivalent(
    leadingZeroZip,
    leadingZeroZipPlus4,
    "ZIP+4 extension does not change effective zip5",
  );
  assertOfferParentTransitionEquivalent(
    leadingZeroZipPlus4,
    biteSaverRestaurant({zipCode: "03440-9876"}),
    "ZIP+4-only change does not change effective zip5",
  );
});

test("BiteSaver offer-parent city and state fingerprint uses only effective canonical fields", () => {
  const base = biteSaverRestaurant();
  const changedCity = biteSaverRestaurant({city: "Ocala"});
  const changedState = biteSaverRestaurant({state: "GA"});
  assertOfferParentTransitionChanges(base, changedCity, "canonical city change");
  assertOfferParentTransitionChanges(base, changedState, "canonical state change");

  const withoutCity = {...base};
  delete withoutCity.city;
  assertOfferParentTransitionChanges(base, withoutCity, "canonical city removal");
  withoutCity.city = base.city;
  assertOfferParentTransitionEquivalent(base, withoutCity, "canonical city re-addition");

  const withoutState = {...base};
  delete withoutState.state;
  assertOfferParentTransitionChanges(base, withoutState, "canonical state removal");
  withoutState.state = base.state;
  assertOfferParentTransitionEquivalent(base, withoutState, "canonical state re-addition");

  assertOfferParentTransitionEquivalent(
    biteSaverRestaurant({city: " Crystal River ", state: "fl"}),
    biteSaverRestaurant({city: "Crystal   River", state: "FL"}),
    "equivalent canonical city/state normalization",
  );

  const malformedCanonical = biteSaverRestaurant({
    city: "Crystal\tRiver",
    state: "F\tL",
    locality: "Ocala",
    stateCode: "GA",
  });
  const changedUnsupportedAliases = {
    ...malformedCanonical,
    locality: "Tampa",
    stateCode: "NY",
  };
  assertOfferParentTransitionEquivalent(
    malformedCanonical,
    changedUnsupportedAliases,
    "unsupported lower city/state aliases do not bypass malformed canonical fields",
  );
  assertOfferParentTransitionEquivalent(
    base,
    {...base, locality: "Tampa", municipality: "Miami", stateCode: "GA"},
    "unsupported lower city/state aliases do not override valid canonical fields",
  );
});

test("BiteSaver offer-parent geography fingerprint follows exact validated projection", () => {
  const controlWhitespaceGeohash = biteSaverRestaurant({
    geohash: `\t${geohash}`,
  });
  const validGeohash = biteSaverRestaurant({geohash});
  assert.equal(
    Object.hasOwn(
      effectiveOfferParentProjection(
        biteSaverOffersForParent(controlWhitespaceGeohash)[0],
      ),
      "geohash",
    ),
    false,
  );
  assertOfferParentTransitionChanges(
    controlWhitespaceGeohash,
    validGeohash,
    "control-whitespace-prefixed geohash becomes canonical",
  );
  assertOfferParentTransitionChanges(
    validGeohash,
    biteSaverRestaurant({geohash: "not-a-geohash"}),
    "canonical geohash becomes malformed",
  );
  assertOfferParentTransitionChanges(
    validGeohash,
    biteSaverRestaurant({latitude: 999}),
    "valid coordinates become invalid",
  );

  const movedCoordinates = Object.freeze({latitude: 27.9506, longitude: -82.4572});
  const movedParent = biteSaverRestaurant({
    ...movedCoordinates,
    geohash: canonicalRestaurantGeohash(movedCoordinates),
  });
  assertOfferParentTransitionChanges(
    validGeohash,
    movedParent,
    "canonical coordinate pair changes",
  );

  assertOfferParentTransitionEquivalent(
    validGeohash,
    biteSaverRestaurant({geohash: geohash.toUpperCase()}),
    "geohash case produces the same canonical geography",
  );
  assertOfferParentTransitionEquivalent(
    validGeohash,
    biteSaverRestaurant({
      location: new GeoPoint(27.9506, -82.4572),
      geoPoint: new GeoPoint(27.9506, -82.4572),
      lat: 27.9506,
      lng: -82.4572,
    }),
    "unsupported coordinate aliases do not override canonical BiteSaver coordinates",
  );

  const withoutCanonicalCoordinates = biteSaverRestaurant({
    latitude: undefined,
    longitude: undefined,
  });
  assertOfferParentTransitionEquivalent(
    {...withoutCanonicalCoordinates, lat: 27.9506, lng: -82.4572},
    {...withoutCanonicalCoordinates, lat: 25.7617, lng: -80.1918},
    "unsupported coordinate aliases cannot create geography",
  );
});

test("BiteSaver offer-parent descriptor captures eligibility, name, image, deletion, and recreation", () => {
  const active = biteSaverRestaurant();
  const inactive = biteSaverRestaurant({couponPostingEnabled: false});
  assertOfferParentTransitionChanges(active, inactive, "active to inactive");
  assert.equal(biteSaverOffersForParent(active)[0].publicVisible, true);
  assert.equal(biteSaverOffersForParent(inactive)[0].publicVisible, false);
  assertOfferParentTransitionChanges(inactive, active, "inactive to active");

  for (const [label, inactiveParent] of [
    ["unapproved parent", biteSaverRestaurant({approvalStatus: "pending"})],
    ["Admin-hidden parent", biteSaverRestaurant({adminHidden: true})],
    ["malformed Admin-hidden parent", biteSaverRestaurant({adminHidden: null})],
  ]) {
    assertOfferParentTransitionChanges(active, inactiveParent, label);
    for (const offerIndex of biteSaverOffersForParent(inactiveParent)) {
      assert.equal(offerIndex.publicVisible, false, label);
    }
  }
  assertOfferParentTransitionEquivalent(
    inactive,
    biteSaverRestaurant({approvalStatus: "pending"}),
    "distinct inactive source states share one effective eligibility",
  );

  assertOfferParentTransitionChanges(active, null, "parent deletion");
  assertOfferParentTransitionChanges(null, active, "parent recreation");
  assert.deepEqual(biteSaverOffersForParent(null), [null, null]);

  assertOfferParentTransitionChanges(
    active,
    biteSaverRestaurant({restaurantName: "Renamed Café"}),
    "customer-visible restaurant name",
  );
  assertOfferParentTransitionChanges(
    active,
    biteSaverRestaurant({
      mainImageUrl: "https://images.example.test/restaurant-2.jpg",
    }),
    "customer-visible restaurant image",
  );

});

test("BiteSaver offer-parent fingerprint excludes unrelated and ineffective raw changes", () => {
  const base = biteSaverRestaurant();
  assertOfferParentTransitionEquivalent(
    base,
    {
      ...base,
      email: "private@example.test",
      subscriptionStatus: "inactive",
      trialEndsAt: new Date(now.getTime() - 1),
      updatedAt: new Date(now.getTime() + 60_000),
      arbitraryPrivateData: {changed: true},
    },
    "unrelated parent fields",
  );
  assertOfferParentTransitionEquivalent(
    biteSaverRestaurant({mainImageUrl: "not-a-url"}),
    biteSaverRestaurant({mainImageUrl: "still-not-a-url"}),
    "distinct invalid image inputs have no effective output",
  );
  assertOfferParentTransitionEquivalent(
    biteSaverRestaurant({latitude: 999, longitude: -82, geohash}),
    biteSaverRestaurant({latitude: 998, longitude: -81, geohash}),
    "distinct invalid coordinate inputs have no effective output",
  );
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
  assert.equal(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({...biteSaver, adminHidden: false}),
  );
  assert.notEqual(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({...biteSaver, adminHidden: null}),
  );
  assert.notEqual(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({...biteSaver, approvalStatus: "Approved"}),
  );
  assert.equal(
    biteSaverOfferParentFingerprint({...biteSaver, adminHidden: true}),
    biteSaverOfferParentFingerprint({...biteSaver, adminHidden: null}),
  );
  assert.notEqual(
    biteSaverOfferParentFingerprint(biteSaver),
    biteSaverOfferParentFingerprint({...biteSaver, restaurantName: "Renamed"}),
  );
  const biteScore = biteScoreRestaurant();
  const biteScoreLegacyDefault = biteScoreRestaurantWithActivity({});
  for (const [field, value] of Object.entries({
    ownerUserId: "unrelated-owner",
    streetAddress: "999 Unrelated Avenue",
    state_name: "Florida",
    zip_code: "99999",
    phone: "ignored",
  })) {
    assert.equal(
      biteScoreDishParentFingerprint(biteScore),
      biteScoreDishParentFingerprint({...biteScore, [field]: value}),
      field,
    );
  }
  for (const [field, value] of Object.entries({
    name: "Consumed Renamed Restaurant",
    isActive: false,
    isClaimed: true,
    city: "Tampa",
    state: "GA",
    zipCode: "30301",
    location: new GeoPoint(27.9506, -82.4572),
    geohash: canonicalRestaurantGeohash({
      latitude: 27.9506,
      longitude: -82.4572,
    }),
  })) {
    assert.notEqual(
      biteScoreDishParentFingerprint(biteScore),
      biteScoreDishParentFingerprint({...biteScore, [field]: value}),
      field,
    );
  }
  assert.notEqual(
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

test("BiteScore parent fingerprints preserve canonical field presence and exact parent identity", () => {
  const source = biteScoreRestaurant({
    locality: "Ocala",
    region: "FL",
    postalCode: "34470",
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });
  const original = biteScoreDishParentFingerprint(source, "restaurant-a");
  assert.notEqual(original, biteScoreDishParentFingerprint(source, "restaurant-b"));

  for (const field of ["city", "state", "zipCode", "location", "geohash"]) {
    const removed = {...source};
    delete removed[field];
    const removedFingerprint = biteScoreDishParentFingerprint(
      removed,
      "restaurant-a",
    );
    assert.notEqual(removedFingerprint, original, field);
    removed[field] = source[field];
    assert.equal(
      biteScoreDishParentFingerprint(removed, "restaurant-a"),
      original,
      field,
    );
  }

  for (const field of ["city", "state", "zipCode", "latitude", "longitude", "geohash"]) {
    assert.notEqual(
      biteScoreDishParentFingerprint({...source, [field]: null}, "restaurant-a"),
      biteScoreDishParentFingerprint(
        Object.fromEntries(Object.entries(source).filter(([key]) => key !== field)),
        "restaurant-a",
      ),
      field,
    );
    assert.notEqual(
      biteScoreDishParentFingerprint({...source, [field]: {wrong: true}}, "restaurant-a"),
      original,
      field,
    );
  }
});

test("BiteScore parent fingerprints preserve coordinate eligibility and exact UTF-16 identity", () => {
  const geoPointParent = biteScoreRestaurant({
    location: new GeoPoint(coordinates.latitude, coordinates.longitude),
  });
  delete geoPointParent.latitude;
  delete geoPointParent.longitude;
  const plainMapParent = {
    ...geoPointParent,
    location: {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    },
  };
  assert.notEqual(
    biteScoreDishParentFingerprint(geoPointParent, "restaurant-a"),
    biteScoreDishParentFingerprint(plainMapParent, "restaurant-a"),
  );

  const wellFormedParent = biteScoreRestaurant({city: "A\ufffdB"});
  const malformedParent = biteScoreRestaurant({city: "A\ud800B"});
  assert.notEqual(
    biteScoreDishParentFingerprint(wellFormedParent, "restaurant-a"),
    biteScoreDishParentFingerprint(malformedParent, "restaurant-a"),
  );
});
