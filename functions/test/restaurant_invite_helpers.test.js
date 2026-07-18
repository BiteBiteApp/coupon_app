const assert = require("node:assert/strict");
const test = require("node:test");

const {
  couponInviteRestaurantIdentity,
  filterAndSortInviteSummaries,
  generateInviteToken,
  hashInviteToken,
  invitePreviewUnavailableReason,
  inviteLink,
} = require("../lib/restaurant_invite_helpers.js");

test("coupon invite can omit existing restaurant ID", () => {
  const identity = couponInviteRestaurantIdentity("", "invite_123");

  assert.equal(identity.restaurantId, null);
  assert.equal(identity.pendingRestaurantKey, "pending_invite_123");
});

test("coupon invite preserves existing restaurant ID when provided", () => {
  const identity = couponInviteRestaurantIdentity(
    " restaurant_account_123 ",
    "invite_123",
  );

  assert.equal(identity.restaurantId, "restaurant_account_123");
  assert.equal(identity.pendingRestaurantKey, null);
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
