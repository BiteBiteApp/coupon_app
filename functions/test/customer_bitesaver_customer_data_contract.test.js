"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildCustomerBiteSaverCouponRedemption,
  customerBiteSaverCouponRedemptionContractVersion,
  customerBiteSaverCouponRedemptionV1TimerMilliseconds,
  customerBiteSaverCustomerDataSchemaVersion,
  customerBiteSaverFavoriteContractVersion,
  customerBiteSaverCouponFavoritePath,
  customerBiteSaverCouponRedemptionPath,
  customerBiteSaverRestaurantFavoritePath,
  parseCustomerBiteSaverCouponFavorite,
  parseCustomerBiteSaverCouponRedemption,
  parseCustomerBiteSaverRestaurantFavorite,
} = require("../lib/customer_bitesaver_customer_data_contract.js");

const fixturePath = path.resolve(
  __dirname,
  "../../test/fixtures/customer_bitesaver_favorite_contract_v1.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const createdAt = new Date("2026-09-11T12:00:00.000Z");
const updatedAt = new Date("2026-09-11T12:05:00.000Z");
const redemptionId = `bsrd_${"C".repeat(43)}`;

function storedDocument(pathValue, data, id = undefined) {
  return {
    id: id ?? pathValue.slice(pathValue.lastIndexOf("/") + 1),
    path: pathValue,
    data,
  };
}

function firestoreTimestamp(value) {
  return {toDate: () => new Date(value.getTime())};
}

function materializeFavorite(value, timestamps = {}) {
  assert.equal(value.createdAt, fixture.serverTimestampMarker);
  assert.equal(value.updatedAt, fixture.serverTimestampMarker);
  return {
    ...value,
    createdAt: timestamps.createdAt ?? new Date(createdAt.getTime()),
    updatedAt: timestamps.updatedAt ?? new Date(updatedAt.getTime()),
  };
}

function restaurantFavoriteDocument() {
  return storedDocument(
    customerBiteSaverRestaurantFavoritePath(
      fixture.userId,
      fixture.restaurantId,
    ),
    materializeFavorite(fixture.restaurantCreate),
  );
}

function couponFavoriteDocument() {
  return storedDocument(
    customerBiteSaverCouponFavoritePath(fixture.userId, fixture.offerId),
    materializeFavorite(fixture.couponCreate),
  );
}

function cloneDocument(document) {
  return {
    id: document.id,
    path: document.path,
    data: {...document.data},
  };
}

function assertMutationRejected(parser, original, mutations) {
  for (const [name, mutate] of mutations) {
    const document = cloneDocument(original);
    mutate(document);
    assert.equal(parser(document), null, name);
  }
}

test("Dart favorite fixture is the exact closed backend parser contract", () => {
  assert.equal(
    fixture.contractVersion,
    customerBiteSaverFavoriteContractVersion,
  );
  assert.equal(fixture.schemaVersion, customerBiteSaverCustomerDataSchemaVersion);
  assert.deepEqual(Object.keys(fixture.restaurantCreate).sort(), [
    "createdAt",
    "favoriteKind",
    "restaurantId",
    "schemaVersion",
    "updatedAt",
    "userId",
  ]);
  assert.deepEqual(Object.keys(fixture.couponCreate).sort(), [
    "createdAt",
    "favoriteKind",
    "offerId",
    "offerType",
    "restaurantId",
    "schemaVersion",
    "updatedAt",
    "userId",
  ]);

  const restaurantDocument = restaurantFavoriteDocument();
  const restaurant = parseCustomerBiteSaverRestaurantFavorite(
    restaurantDocument,
    {userId: fixture.userId, restaurantId: fixture.restaurantId},
  );
  assert.deepEqual(restaurant, {
    schemaVersion: 1,
    favoriteKind: "bitesaverRestaurant",
    userId: fixture.userId,
    restaurantId: fixture.restaurantId,
    createdAt,
    updatedAt,
  });
  assert.equal(Object.isFrozen(restaurant), true);

  const couponDocument = couponFavoriteDocument();
  couponDocument.data.createdAt = firestoreTimestamp(createdAt);
  couponDocument.data.updatedAt = firestoreTimestamp(updatedAt);
  const coupon = parseCustomerBiteSaverCouponFavorite(couponDocument, {
    userId: fixture.userId,
    restaurantId: fixture.restaurantId,
    offerId: fixture.offerId,
  });
  assert.deepEqual(coupon, {
    schemaVersion: 1,
    favoriteKind: "bitesaverCoupon",
    userId: fixture.userId,
    restaurantId: fixture.restaurantId,
    offerId: fixture.offerId,
    offerType: "coupon",
    createdAt,
    updatedAt,
  });
  assert.equal(Object.isFrozen(coupon), true);
});

test("favorite parsers reject non-closed, mismatched, and malformed state", () => {
  const restaurantDocument = restaurantFavoriteDocument();
  const parseRestaurant = (document) =>
    parseCustomerBiteSaverRestaurantFavorite(document, {
      userId: fixture.userId,
      restaurantId: fixture.restaurantId,
    });
  assertMutationRejected(parseRestaurant, restaurantDocument, [
    ["wrong document ID", (value) => {
      value.id = fixture.offerId;
    }],
    ["wrong path", (value) => {
      value.path = `user_profiles/${fixture.userId}/favorites/${fixture.restaurantId}`;
    }],
    ["extra field", (value) => {
      value.data.restaurantName = "Private snapshot";
    }],
    ["missing field", (value) => {
      delete value.data.updatedAt;
    }],
    ["wrong schema type", (value) => {
      value.data.schemaVersion = "1";
    }],
    ["wrong kind", (value) => {
      value.data.favoriteKind = "restaurant";
    }],
    ["wrong owner", (value) => {
      value.data.userId = "another-user";
    }],
    ["wrong restaurant", (value) => {
      value.data.restaurantId = `bsr_${"D".repeat(43)}`;
    }],
    ["non-timestamp creation", (value) => {
      value.data.createdAt = createdAt.toISOString();
    }],
    ["throwing timestamp", (value) => {
      value.data.updatedAt = {toDate: () => {
        throw new Error("bad timestamp");
      }};
    }],
    ["update before creation", (value) => {
      value.data.updatedAt = new Date(createdAt.getTime() - 1);
    }],
  ]);

  assert.equal(parseCustomerBiteSaverRestaurantFavorite(
    restaurantDocument,
    {userId: fixture.userId, restaurantId: ` ${fixture.restaurantId}`},
  ), null);

  const couponDocument = couponFavoriteDocument();
  const parseCoupon = (document) =>
    parseCustomerBiteSaverCouponFavorite(document, {
      userId: fixture.userId,
      restaurantId: fixture.restaurantId,
      offerId: fixture.offerId,
    });
  assertMutationRejected(parseCoupon, couponDocument, [
    ["wrong document ID", (value) => {
      value.id = fixture.restaurantId;
    }],
    ["wrong collection", (value) => {
      value.path = `user_profiles/${fixture.userId}/favorite_restaurants/${fixture.offerId}`;
    }],
    ["extra field", (value) => {
      value.data.rawOfferId = "must-not-be-stored";
    }],
    ["missing field", (value) => {
      delete value.data.offerType;
    }],
    ["wrong kind", (value) => {
      value.data.favoriteKind = "bitesaverRestaurant";
    }],
    ["wrong parent", (value) => {
      value.data.restaurantId = `bsr_${"D".repeat(43)}`;
    }],
    ["wrong offer", (value) => {
      value.data.offerId = `bso_${"E".repeat(43)}`;
    }],
    ["wrong offer type", (value) => {
      value.data.offerType = "dailySpecial";
    }],
    ["invalid creation date", (value) => {
      value.data.createdAt = new Date(NaN);
    }],
    ["negative update date", (value) => {
      value.data.updatedAt = new Date(-1);
    }],
    ["update before creation", (value) => {
      value.data.updatedAt = new Date(createdAt.getTime() - 1);
    }],
  ]);
});

test("canonical paths accept exact public IDs and reject trimming or overflow", () => {
  assert.equal(fixture.restaurantId.length, 47);
  assert.equal(fixture.offerId.length, 47);
  assert.match(fixture.restaurantId, /^bsr_[A-Za-z0-9_-]{43}$/u);
  assert.match(fixture.offerId, /^bso_[A-Za-z0-9_-]{43}$/u);
  assert.equal(
    customerBiteSaverRestaurantFavoritePath(
      fixture.userId,
      fixture.restaurantId,
    ),
    `user_profiles/${fixture.userId}/favorite_restaurants/${fixture.restaurantId}`,
  );
  assert.equal(
    customerBiteSaverCouponFavoritePath(fixture.userId, fixture.offerId),
    `user_profiles/${fixture.userId}/favorite_coupons/${fixture.offerId}`,
  );
  assert.equal(
    customerBiteSaverCouponRedemptionPath(fixture.userId, fixture.offerId),
    `customer_redemptions/${fixture.userId}/coupon_redemptions/${fixture.offerId}`,
  );

  const maximumPathComponent = "u".repeat(1_500);
  assert.equal(
    customerBiteSaverRestaurantFavoritePath(
      maximumPathComponent,
      fixture.restaurantId,
    ).endsWith(`/favorite_restaurants/${fixture.restaurantId}`),
    true,
  );
  for (const invalidUserId of [
    "",
    ".",
    "..",
    "__reserved__",
    "user/child",
    "u".repeat(1_501),
    "\u00e9".repeat(751),
    "\ud800",
  ]) {
    assert.throws(() => customerBiteSaverRestaurantFavoritePath(
      invalidUserId,
      fixture.restaurantId,
    ));
  }
  for (const invalidRestaurantId of [
    `bsr_${"A".repeat(42)}`,
    `bsr_${"A".repeat(44)}`,
    ` ${fixture.restaurantId}`,
    fixture.restaurantId.replace("bsr_", "bso_"),
    `bsr_${"A".repeat(42)}/`,
  ]) {
    assert.throws(() => customerBiteSaverRestaurantFavoritePath(
      fixture.userId,
      invalidRestaurantId,
    ));
  }
  for (const invalidOfferId of [
    `bso_${"B".repeat(42)}`,
    `bso_${"B".repeat(44)}`,
    `${fixture.offerId} `,
    fixture.offerId.replace("bso_", "bsr_"),
    `bso_${"B".repeat(42)}/`,
  ]) {
    assert.throws(() => customerBiteSaverCouponFavoritePath(
      fixture.userId,
      invalidOfferId,
    ));
    assert.throws(() => customerBiteSaverCouponRedemptionPath(
      fixture.userId,
      invalidOfferId,
    ));
  }
});

function validRedemptionInput(overrides = {}) {
  return {
    userId: fixture.userId,
    restaurantId: fixture.restaurantId,
    offerId: fixture.offerId,
    redemptionId,
    timerStartedAt: new Date(updatedAt.getTime()),
    createdAt: new Date(createdAt.getTime()),
    ...overrides,
  };
}

function redemptionDocument(redemption = undefined) {
  const value = redemption ?? buildCustomerBiteSaverCouponRedemption(
    validRedemptionInput(),
  );
  return storedDocument(
    customerBiteSaverCouponRedemptionPath(fixture.userId, fixture.offerId),
    value,
  );
}

test("usage builder and parser enforce the exact ten-field contract", () => {
  assert.equal(
    customerBiteSaverCouponRedemptionContractVersion,
    "bitestar.customer-bitesaver-coupon-redemption.v1",
  );
  assert.equal(customerBiteSaverCouponRedemptionV1TimerMilliseconds, 300_000);
  const built = buildCustomerBiteSaverCouponRedemption(validRedemptionInput());
  assert.equal(Object.isFrozen(built), true);
  assert.deepEqual(Object.keys(built).sort(), [
    "createdAt",
    "offerId",
    "offerType",
    "redemptionId",
    "restaurantId",
    "schemaVersion",
    "timerExpiresAt",
    "timerStartedAt",
    "updatedAt",
    "userId",
  ]);
  assert.deepEqual(built, {
    schemaVersion: 1,
    userId: fixture.userId,
    restaurantId: fixture.restaurantId,
    offerId: fixture.offerId,
    offerType: "coupon",
    redemptionId,
    timerStartedAt: updatedAt,
    timerExpiresAt: new Date(
      updatedAt.getTime() +
        customerBiteSaverCouponRedemptionV1TimerMilliseconds,
    ),
    createdAt,
    updatedAt,
  });

  const timestampData = Object.fromEntries(
    Object.entries(built).map(([key, value]) => [
      key,
      value instanceof Date ? firestoreTimestamp(value) : value,
    ]),
  );
  const parsed = parseCustomerBiteSaverCouponRedemption(
    redemptionDocument(timestampData),
    {
      userId: fixture.userId,
      restaurantId: fixture.restaurantId,
      offerId: fixture.offerId,
    },
  );
  assert.deepEqual(parsed, built);
  assert.equal(Object.isFrozen(parsed), true);
});

test("usage parser rejects path, field, type, and time contradictions", () => {
  const original = redemptionDocument();
  const parseUsage = (document) => parseCustomerBiteSaverCouponRedemption(
    document,
    {
      userId: fixture.userId,
      restaurantId: fixture.restaurantId,
      offerId: fixture.offerId,
    },
  );
  assertMutationRejected(parseUsage, original, [
    ["wrong document ID", (value) => {
      value.id = fixture.restaurantId;
    }],
    ["wrong path", (value) => {
      value.path = `customer_redemptions/${fixture.userId}/redemptions/${fixture.offerId}`;
    }],
    ["extra field", (value) => {
      value.data.completedAt = updatedAt;
    }],
    ["missing field", (value) => {
      delete value.data.createdAt;
    }],
    ["wrong schema type", (value) => {
      value.data.schemaVersion = "1";
    }],
    ["wrong owner", (value) => {
      value.data.userId = "another-user";
    }],
    ["wrong parent", (value) => {
      value.data.restaurantId = `bsr_${"D".repeat(43)}`;
    }],
    ["wrong offer", (value) => {
      value.data.offerId = `bso_${"E".repeat(43)}`;
    }],
    ["wrong offer type", (value) => {
      value.data.offerType = "dailySpecial";
    }],
    ["trimmed redemption ID", (value) => {
      value.data.redemptionId = `${redemptionId} `;
    }],
    ["non-date timer start", (value) => {
      value.data.timerStartedAt = updatedAt.toISOString();
    }],
    ["invalid timer expiry", (value) => {
      value.data.timerExpiresAt = new Date(NaN);
    }],
    ["wrong timer duration", (value) => {
      value.data.timerExpiresAt = new Date(
        updatedAt.getTime() + 5 * 60_000 + 1,
      );
    }],
    ["creation after timer start", (value) => {
      value.data.createdAt = new Date(updatedAt.getTime() + 1);
    }],
    ["update not equal to timer start", (value) => {
      value.data.updatedAt = new Date(updatedAt.getTime() - 1);
    }],
    ["negative creation time", (value) => {
      value.data.createdAt = new Date(-1);
    }],
  ]);

  assert.equal(parseCustomerBiteSaverCouponRedemption(original, {
    userId: fixture.userId,
    restaurantId: fixture.restaurantId,
    offerId: ` ${fixture.offerId}`,
  }), null);
});

test("usage builder rejects malformed identity and incoherent time inputs", () => {
  const invalidInputs = [
    {userId: "user/child"},
    {userId: "u".repeat(1_501)},
    {restaurantId: ` ${fixture.restaurantId}`},
    {restaurantId: `bsr_${"A".repeat(44)}`},
    {offerId: `${fixture.offerId} `},
    {offerId: `bso_${"B".repeat(42)}`},
    {redemptionId: `bsrd_${"C".repeat(42)}`},
    {redemptionId: `${redemptionId} `},
    {timerStartedAt: new Date(NaN)},
    {timerStartedAt: new Date(-1)},
    {createdAt: new Date(NaN)},
    {createdAt: new Date(-1)},
    {createdAt: new Date(updatedAt.getTime() + 1)},
  ];
  for (const overrides of invalidInputs) {
    assert.throws(
      () => buildCustomerBiteSaverCouponRedemption(
        validRedemptionInput(overrides),
      ),
      /Invalid canonical BiteSaver coupon redemption/u,
      JSON.stringify(overrides),
    );
  }
});
