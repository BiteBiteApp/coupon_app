"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CustomerBiteSaverContractError,
  requireCustomerBiteSaverPublicId,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  customerBiteSaverIdentitySecretNameV1,
  customerBiteSaverOpaqueOfferId,
  customerBiteSaverOpaqueRestaurantId,
  customerBiteSaverPublicIdentityVersion,
  decodeCustomerBiteSaverIdentityKeyV1,
} = require("../lib/customer_bitesaver_public_identity.js");
const {
  customerBiteSaverCallerBinding,
} = require("../lib/customer_bitesaver_search_cursor.js");

const encodedIdentityKey = Buffer.alloc(32, 0x2b).toString("base64url");
const identityKeyV1 = decodeCustomerBiteSaverIdentityKeyV1(encodedIdentityKey);

function assertConfigurationFailure(operation) {
  assert.throws(operation, (error) =>
    error instanceof CustomerBiteSaverContractError &&
    error.code === "failed-precondition" &&
    error.message === "BiteSaver customer identity is not configured.");
}

function assertSourceFailure(operation) {
  assert.throws(operation, (error) =>
    error instanceof CustomerBiteSaverContractError &&
    error.code === "failed-precondition" &&
    error.message === "The BiteSaver customer identity source is invalid.");
}

test("public identity v1 exposes the exact long-lived secret contract", () => {
  assert.equal(
    customerBiteSaverPublicIdentityVersion,
    "bitestar.customer-bitesaver-public-identity.v1",
  );
  assert.equal(
    customerBiteSaverIdentitySecretNameV1,
    "BITESAVER_CUSTOMER_IDENTITY_KEY_V1",
  );
  assert.deepEqual(Buffer.from(identityKeyV1), Buffer.alloc(32, 0x2b));

  for (const malformed of [
    undefined,
    null,
    "",
    "a".repeat(42),
    "a".repeat(44),
    `${encodedIdentityKey}=`,
    `${encodedIdentityKey.slice(0, -1)}t`,
    Buffer.alloc(31).toString("base64url"),
    Buffer.alloc(33).toString("base64url"),
    1,
  ]) {
    assertConfigurationFailure(() =>
      decodeCustomerBiteSaverIdentityKeyV1(malformed));
  }
});

test("restaurant and offer IDs are stable, fixed-shape, bound, and non-leaking", () => {
  const accountId = "private-account-id-canary";
  const sourceOfferId = "private-offer-id-canary";
  const restaurant = customerBiteSaverOpaqueRestaurantId(
    identityKeyV1,
    accountId,
  );
  const restaurantRetry = customerBiteSaverOpaqueRestaurantId(
    identityKeyV1,
    accountId,
  );
  const coupon = customerBiteSaverOpaqueOfferId(
    identityKeyV1,
    accountId,
    "coupon",
    sourceOfferId,
  );
  const special = customerBiteSaverOpaqueOfferId(
    identityKeyV1,
    accountId,
    "dailySpecial",
    sourceOfferId,
  );

  assert.equal(
    restaurant,
    "bsr_aXCm8WtMJ_epL0cuia0pwh8g4Q9dDQwMIhxSGnLQACA",
  );
  assert.equal(
    coupon,
    "bso_06SwlWRamiVNa-ziFRnsAV8zKz3YOCqKcKuidTJAIdE",
  );
  assert.equal(
    special,
    "bso_hNg-zVn3JljfBLx2xxJ4Q52CyLqAh0Yf-6PSj7wxczU",
  );
  assert.equal(restaurant, restaurantRetry);
  assert.equal(requireCustomerBiteSaverPublicId(restaurant, "bsr"), restaurant);
  assert.equal(requireCustomerBiteSaverPublicId(coupon, "bso"), coupon);
  assert.match(restaurant, /^bsr_[A-Za-z0-9_-]{43}$/u);
  assert.match(coupon, /^bso_[A-Za-z0-9_-]{43}$/u);
  assert.match(special, /^bso_[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(coupon, special);
  assert.notEqual(
    coupon,
    customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      `${accountId}-other`,
      "coupon",
      sourceOfferId,
    ),
  );
  assert.notEqual(
    coupon,
    customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      accountId,
      "coupon",
      `${sourceOfferId}-other`,
    ),
  );
  assert.notEqual(
    restaurant,
    customerBiteSaverOpaqueRestaurantId(
      decodeCustomerBiteSaverIdentityKeyV1(
        Buffer.alloc(32, 0x2c).toString("base64url"),
      ),
      accountId,
    ),
  );
  for (const publicId of [restaurant, coupon, special]) {
    assert.equal(publicId.includes(accountId), false);
    assert.equal(publicId.includes(sourceOfferId), false);
  }
});

test("rotating only the transient discovery key leaves public IDs unchanged", () => {
  const accountId = "stable-account";
  const sourceOfferId = "stable-offer";
  const restaurantBefore = customerBiteSaverOpaqueRestaurantId(
    identityKeyV1,
    accountId,
  );
  const offerBefore = customerBiteSaverOpaqueOfferId(
    identityKeyV1,
    accountId,
    "coupon",
    sourceOfferId,
  );
  const firstTransientBinding = customerBiteSaverCallerBinding(
    Buffer.alloc(32, 0x11),
    {scope: "guest", clientInstanceId: "client-instance-0001"},
  );
  const rotatedTransientBinding = customerBiteSaverCallerBinding(
    Buffer.alloc(32, 0x12),
    {scope: "guest", clientInstanceId: "client-instance-0001"},
  );

  assert.notEqual(firstTransientBinding, rotatedTransientBinding);
  assert.equal(
    customerBiteSaverOpaqueRestaurantId(identityKeyV1, accountId),
    restaurantBefore,
  );
  assert.equal(
    customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      accountId,
      "coupon",
      sourceOfferId,
    ),
    offerBefore,
  );
});

test("identity derives from exact source text without normalization", () => {
  const plain = customerBiteSaverOpaqueRestaurantId(identityKeyV1, "Cafe");
  assert.notEqual(
    plain,
    customerBiteSaverOpaqueRestaurantId(identityKeyV1, " Cafe "),
  );
  assert.notEqual(
    customerBiteSaverOpaqueRestaurantId(identityKeyV1, "\u00e9"),
    customerBiteSaverOpaqueRestaurantId(identityKeyV1, "e\u0301"),
  );
});

test("maximum valid source identities remain fixed length", () => {
  for (const maximumIdentity of [
    "a".repeat(1_500),
    "\u00e9".repeat(750),
    "\ud83d\ude00".repeat(375),
  ]) {
    assert.match(
      customerBiteSaverOpaqueRestaurantId(identityKeyV1, maximumIdentity),
      /^bsr_[A-Za-z0-9_-]{43}$/u,
    );
    assert.match(
      customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        maximumIdentity,
        "coupon",
        maximumIdentity,
      ),
      /^bso_[A-Za-z0-9_-]{43}$/u,
    );
  }
});

test("malformed key material and source identities fail closed", () => {
  for (const malformedKey of [
    undefined,
    null,
    Buffer.alloc(0),
    Buffer.alloc(31),
    Buffer.alloc(33),
  ]) {
    assertConfigurationFailure(() =>
      customerBiteSaverOpaqueRestaurantId(malformedKey, "account"));
  }

  for (const invalidIdentity of [
    undefined,
    null,
    "",
    ".",
    "..",
    "__reserved__",
    "contains/slash",
    "a".repeat(1_501),
    "\u00e9".repeat(751),
    "\ud800",
    "\udc00",
  ]) {
    assertSourceFailure(() =>
      customerBiteSaverOpaqueRestaurantId(identityKeyV1, invalidIdentity));
    assertSourceFailure(() =>
      customerBiteSaverOpaqueOfferId(
        identityKeyV1,
        "account",
        "coupon",
        invalidIdentity,
      ));
  }
  assertSourceFailure(() =>
    customerBiteSaverOpaqueOfferId(
      identityKeyV1,
      "account",
      "unsupported",
      "offer",
    ));
});
