const assert = require("node:assert/strict");
const test = require("node:test");

const {
  biteSaverAccountCatalogBindingState,
  biteScoreCatalogBindingState,
  couponInviteRestaurantIdentity,
  filterAndSortInviteSummaries,
  generateBiteSaverCatalogBindingId,
  generateInviteToken,
  hashInviteToken,
  isValidBiteSaverCatalogBindingId,
  invitePreviewUnavailableReason,
  inviteLink,
  readBiteScoreCatalogRestaurantId,
  restaurantCustomerLink,
} = require("../lib/restaurant_invite_helpers.js");

test("coupon invite can omit existing restaurant ID", () => {
  for (const omitted of [null, undefined, ""]) {
    const identity = couponInviteRestaurantIdentity(omitted, "invite_123");
    assert.equal(identity.restaurantId, null);
    assert.equal(identity.pendingRestaurantKey, "pending_invite_123");
  }
});

test("coupon invite preserves existing restaurant ID when provided", () => {
  const identity = couponInviteRestaurantIdentity(
    "restaurant_account_123",
    "invite_123",
  );

  assert.equal(identity.restaurantId, "restaurant_account_123");
  assert.equal(identity.pendingRestaurantKey, null);
});

test("coupon invite identities reject malformed path segments without trimming", () => {
  for (const malformedRestaurantId of [
    " restaurant_account_123",
    "restaurant_account_123 ",
    "   ",
    "restaurant/account",
  ]) {
    assert.throws(
      () => couponInviteRestaurantIdentity(
        malformedRestaurantId,
        "invite_123",
      ),
      TypeError,
      malformedRestaurantId,
    );
  }
  for (const malformedInviteId of [
    " invite_123",
    "invite_123 ",
    "",
    "invite/123",
  ]) {
    assert.throws(
      () => couponInviteRestaurantIdentity(null, malformedInviteId),
      TypeError,
      malformedInviteId,
    );
  }
});

test("invite links use BiteStar HTTPS URLs", () => {
  assert.equal(
    inviteLink("coupon", "token_123"),
    "https://go.bitestar.app/invite/coupon/token_123",
  );
  assert.equal(
    inviteLink("bitescore", "token_456"),
    "https://go.bitestar.app/invite/bitescore/token_456",
  );
});

test("token hash is stable and does not contain plaintext token", () => {
  const token = "plain-token";
  const hash = hashInviteToken(token);

  assert.equal(hash, hashInviteToken(token));
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
});

test("generated token is high entropy url-safe text", () => {
  const token = generateInviteToken();

  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length >= 40);
});

test("catalog binding IDs are exact 32-byte base64url values", () => {
  const bindingId = generateBiteSaverCatalogBindingId();

  assert.equal(bindingId.length, 43);
  assert.match(bindingId, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(isValidBiteSaverCatalogBindingId(bindingId), true);
  for (const malformed of [
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}+`,
    ` ${"A".repeat(43)}`,
    null,
    7,
  ]) {
    assert.equal(isValidBiteSaverCatalogBindingId(malformed), false);
  }
});

test("catalog document IDs require one exact bounded Firestore path segment", () => {
  assert.equal(
    readBiteScoreCatalogRestaurantId("catalog_restaurant-1"),
    "catalog_restaurant-1",
  );
  assert.equal(readBiteScoreCatalogRestaurantId("Café 🍽️"), "Café 🍽️");
  for (const malformed of [
    "",
    " padded",
    "padded ",
    ".",
    "..",
    "two/segments",
    "hidden\u0000value",
    "x".repeat(1_501),
    null,
  ]) {
    assert.equal(readBiteScoreCatalogRestaurantId(malformed), null);
  }
});

test("catalog document IDs reject unpaired surrogates without changing valid Unicode", () => {
  const malformed = [
    "\uD800",
    "\uDC00",
    "\uD800x",
    "restaurant-\uD800-west",
    "restaurant-\uDC00-west",
  ];
  for (const value of malformed) {
    assert.equal(readBiteScoreCatalogRestaurantId(value), null);
  }

  const accepted = [
    "restaurant-1",
    "restaurant-\uD83D\uDE00",
    "餐厅-東京-Café",
    "Café 🍽️",
  ];
  for (const value of accepted) {
    const result = readBiteScoreCatalogRestaurantId(value);
    assert.equal(result, value);
    assert.deepEqual(
      Array.from({length: result.length}, (_, index) => result.charCodeAt(index)),
      Array.from({length: value.length}, (_, index) => value.charCodeAt(index)),
    );
  }

  const exactlyMaximumBytes = `${"x".repeat(1_496)}\uD83D\uDE00`;
  const overMaximumBytes = `${"x".repeat(1_497)}\uD83D\uDE00`;
  assert.equal(Buffer.byteLength(exactlyMaximumBytes, "utf8"), 1_500);
  assert.equal(
    readBiteScoreCatalogRestaurantId(exactlyMaximumBytes),
    exactlyMaximumBytes,
  );
  assert.equal(Buffer.byteLength(overMaximumBytes, "utf8"), 1_501);
  assert.equal(readBiteScoreCatalogRestaurantId(overMaximumBytes), null);
});

test("catalog document IDs explicitly reject U+17B4 and U+17B5 only", () => {
  for (const rejected of [
    "\u17b4",
    "\u17b5",
    "restaurant-\u17b4-id",
    "restaurant-\u17b5-id",
  ]) {
    assert.equal(readBiteScoreCatalogRestaurantId(rejected), null);
  }

  for (const accepted of [
    "restaurant-ascii",
    "restaurant-\uD83D\uDE00",
    "restaurant-\u1780-id",
  ]) {
    assert.equal(readBiteScoreCatalogRestaurantId(accepted), accepted);
  }
});

test("canonical customer routes encode valid Unicode and reject malformed IDs safely", () => {
  assert.equal(
    restaurantCustomerLink("coupons", "restaurant-1"),
    "https://go.bitestar.app/r/coupons/restaurant-1",
  );
  assert.equal(
    restaurantCustomerLink("bitescore", "restaurant-1"),
    "https://go.bitestar.app/r/bitescore/restaurant-1",
  );
  assert.equal(
    restaurantCustomerLink("coupons", "restaurant-\uD83D\uDE00"),
    "https://go.bitestar.app/r/coupons/restaurant-%F0%9F%98%80",
  );
  assert.equal(
    restaurantCustomerLink("bitescore", "餐厅-Café"),
    "https://go.bitestar.app/r/bitescore/%E9%A4%90%E5%8E%85-Caf%C3%A9",
  );

  for (const malformed of ["\uD800", "\uDC00", "ordinary-\uD800-id"]) {
    assert.throws(
      () => restaurantCustomerLink("coupons", malformed),
      (error) => error instanceof TypeError && !(error instanceof URIError),
    );
    assert.throws(
      () => restaurantCustomerLink("bitescore", malformed),
      (error) => error instanceof TypeError && !(error instanceof URIError),
    );
  }
});

test("account catalog binding state fails closed for partial or malformed pairs", () => {
  const bindingId = "A".repeat(43);
  assert.deepEqual(biteSaverAccountCatalogBindingState({}), {type: "unbound"});
  assert.deepEqual(biteSaverAccountCatalogBindingState({
    biteScoreCatalogRestaurantId: "catalog-1",
    biteSaverCatalogBindingId: bindingId,
  }), {
    type: "bound",
    biteScoreCatalogRestaurantId: "catalog-1",
    biteSaverCatalogBindingId: bindingId,
  });
  for (const malformed of [
    {biteScoreCatalogRestaurantId: "catalog-1"},
    {biteSaverCatalogBindingId: bindingId},
    {
      biteScoreCatalogRestaurantId: "catalog/1",
      biteSaverCatalogBindingId: bindingId,
    },
    {
      biteScoreCatalogRestaurantId: "catalog-1",
      biteSaverCatalogBindingId: "short",
    },
    {
      biteScoreCatalogRestaurantId: null,
      biteSaverCatalogBindingId: null,
    },
  ]) {
    assert.deepEqual(
      biteSaverAccountCatalogBindingState(malformed),
      {type: "invalid"},
    );
  }
});

test("catalog binding state treats only absence as unbound", () => {
  const bindingId = "_".repeat(43);
  assert.deepEqual(biteScoreCatalogBindingState({}), {type: "unbound"});
  assert.deepEqual(
    biteScoreCatalogBindingState({biteSaverCatalogBindingId: bindingId}),
    {type: "bound", biteSaverCatalogBindingId: bindingId},
  );
  for (const malformed of [null, "", "_".repeat(42), "_".repeat(44), 7]) {
    assert.deepEqual(
      biteScoreCatalogBindingState({biteSaverCatalogBindingId: malformed}),
      {type: "invalid"},
    );
  }
});

test("invite listing filters coupon and bitescore sides", () => {
  const invites = [
    { id: "coupon_old", side: "coupon", createdAtMillis: 100 },
    { id: "bitescore_new", side: "bitescore", createdAtMillis: 300 },
    { id: "coupon_new", side: "coupon", createdAtMillis: 200 },
  ];

  assert.deepEqual(
    filterAndSortInviteSummaries(invites, "coupon").map((invite) => invite.id),
    ["coupon_new", "coupon_old"],
  );
  assert.deepEqual(
    filterAndSortInviteSummaries(invites, "bitescore").map(
      (invite) => invite.id,
    ),
    ["bitescore_new"],
  );
});

test("invite listing keeps revoked invites visible", () => {
  const invites = [
    { id: "active", side: "coupon", status: "active", createdAtMillis: 100 },
    {
      id: "revoked",
      side: "coupon",
      status: "revoked",
      createdAtMillis: 200,
    },
  ];

  assert.deepEqual(
    filterAndSortInviteSummaries(invites, "coupon").map((invite) => ({
      id: invite.id,
      status: invite.status,
    })),
    [
      { id: "revoked", status: "revoked" },
      { id: "active", status: "active" },
    ],
  );
});

test("invite listing does not require plaintext tokens", () => {
  const invites = [
    {
      id: "invite_123",
      side: "coupon",
      tokenHash: "hash-only",
      createdAtMillis: 100,
    },
  ];
  const listed = filterAndSortInviteSummaries(invites, "coupon");

  assert.equal(listed[0].id, "invite_123");
  assert.equal(Object.hasOwn(listed[0], "token"), false);
  assert.equal(listed[0].tokenHash, "hash-only");
});

test("valid coupon invite preview is available", () => {
  const reason = invitePreviewUnavailableReason(
    {
      side: "coupon",
      status: "active",
      expiresAtMillis: 2000,
      maxUses: 1,
      useCount: 0,
    },
    "coupon",
    1000,
  );

  assert.equal(reason, null);
});

test("preview rejects revoked invites", () => {
  assert.equal(
    invitePreviewUnavailableReason(
      {
        side: "coupon",
        status: "revoked",
        expiresAtMillis: 2000,
        maxUses: 1,
        useCount: 0,
      },
      "coupon",
      1000,
    ),
    "inactive",
  );
});

test("preview rejects expired invites", () => {
  assert.equal(
    invitePreviewUnavailableReason(
      {
        side: "coupon",
        status: "active",
        expiresAtMillis: 1000,
        maxUses: 1,
        useCount: 0,
      },
      "coupon",
      1000,
    ),
    "expired",
  );
});

test("preview rejects used invites", () => {
  assert.equal(
    invitePreviewUnavailableReason(
      {
        side: "bitescore",
        status: "active",
        expiresAtMillis: 2000,
        maxUses: 1,
        useCount: 1,
      },
      "bitescore",
      1000,
    ),
    "used",
  );
});

test("preview rejects wrong side", () => {
  assert.equal(
    invitePreviewUnavailableReason(
      {
        side: "bitescore",
        status: "active",
        expiresAtMillis: 2000,
        maxUses: 1,
        useCount: 0,
      },
      "coupon",
      1000,
    ),
    "wrong-side",
  );
});
