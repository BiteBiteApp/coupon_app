"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  decideRestaurantInviteRevisionWrite,
  decideRevisionGuardedRestaurantGeohashWrite,
  maximumRestaurantWriteRevision,
  nextRestaurantWriteRevision,
  readRestaurantWriteRevision,
  restaurantWriteRevisionField,
} = require("../lib/restaurant_write_revision.js");

test("restaurant source revision accepts only nonnegative safe integers", () => {
  assert.equal(restaurantWriteRevisionField, "restaurantWriteRevision");
  assert.equal(maximumRestaurantWriteRevision, Number.MAX_SAFE_INTEGER);
  assert.equal(readRestaurantWriteRevision({restaurantWriteRevision: 4}), 4);
  assert.equal(readRestaurantWriteRevision({restaurantWriteRevision: 0}), 0);
  for (const data of [
    {},
    {restaurantWriteRevision: null},
    {restaurantWriteRevision: "4"},
    {restaurantWriteRevision: -1},
    {restaurantWriteRevision: 1.5},
    {restaurantWriteRevision: Number.MAX_SAFE_INTEGER + 1},
  ]) {
    assert.equal(readRestaurantWriteRevision(data), null);
  }
});

test("restaurant source revision advances exactly once and cannot overflow", () => {
  assert.equal(nextRestaurantWriteRevision(0), 1);
  assert.equal(nextRestaurantWriteRevision(4), 5);
  assert.equal(nextRestaurantWriteRevision(Number.MAX_SAFE_INTEGER - 1),
    Number.MAX_SAFE_INTEGER);
  for (const value of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(nextRestaurantWriteRevision(value), null);
  }
});

test("claim invite decision increments once and a terminal retry is inert", () => {
  let restaurantData = {restaurantWriteRevision: 4, isClaimed: false};
  let unavailableReason = null;
  let committedRestaurantWrites = 0;

  function attemptRedemption() {
    const gate = decideRestaurantInviteRevisionWrite(unavailableReason);
    if (gate.type === "terminal") {
      return gate;
    }
    assert.equal(gate.type, "ready");
    const decision = decideRestaurantInviteRevisionWrite(
      null,
      restaurantData,
    );
    assert.equal(decision.type, "write");
    restaurantData = {...restaurantData, ...decision.patch, isClaimed: true};
    unavailableReason = "used";
    committedRestaurantWrites += 1;
    return decision;
  }

  const first = attemptRedemption();
  assert.equal(first.type, "write");
  assert.equal(restaurantData.restaurantWriteRevision, 5);
  assert.equal(committedRestaurantWrites, 1);

  const terminalRetry = attemptRedemption();
  assert.deepEqual(terminalRetry, {type: "terminal", reason: "used"});
  assert.equal(restaurantData.restaurantWriteRevision, 5);
  assert.equal(committedRestaurantWrites, 1);

  const originalSnapshot = {restaurantWriteRevision: 8};
  const retryAttemptOne = decideRestaurantInviteRevisionWrite(
    null,
    originalSnapshot,
  );
  const retryAttemptTwo = decideRestaurantInviteRevisionWrite(
    null,
    originalSnapshot,
  );
  assert.equal(retryAttemptOne.type, "write");
  assert.equal(retryAttemptTwo.type, "write");
  assert.equal(retryAttemptOne.patch.restaurantWriteRevision, 9);
  assert.equal(retryAttemptTwo.patch.restaurantWriteRevision, 9);

  for (const data of [
    {},
    {restaurantWriteRevision: "4"},
    {restaurantWriteRevision: -1},
    {restaurantWriteRevision: 1.5},
    {restaurantWriteRevision: Number.MAX_SAFE_INTEGER},
  ]) {
    assert.equal(
      decideRestaurantInviteRevisionWrite(null, data).type,
      "invalid",
    );
  }
});

test("terminal invite decision never evaluates restaurant revision state", () => {
  const unreadableRestaurantData = {};
  Object.defineProperty(unreadableRestaurantData, restaurantWriteRevisionField, {
    get() {
      throw new Error("terminal state must not read the restaurant revision");
    },
  });
  assert.deepEqual(
    decideRestaurantInviteRevisionWrite("used", unreadableRestaurantData),
    {type: "terminal", reason: "used"},
  );
});

test("claim invite handler uses the behaviorally tested revision decision", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const start = source.indexOf(
    "export const redeemBiteScoreRestaurantClaimInvite",
  );
  const end = source.indexOf("function writtenReviewWordCount", start);
  const handler = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /db\.runTransaction/u);
  assert.match(handler, /invitePreviewUnavailableReason/u);
  assert.match(handler, /decideRestaurantInviteRevisionWrite/u);
  assert.match(handler, /\.\.\.restaurantRevisionDecision\.patch/u);
  assert.match(
    source,
    /const ratingDestructiveRestaurantOperationLockCollection =\s*\n\s*"private_rating_restaurant_operation_locks";/u,
  );
  assert.match(handler, /transaction\.get\(restaurantOperationLockRef\)/u);
  assert.match(handler, /if \(restaurantOperationLockSnapshot\.exists\)/u);
  assert.match(
    handler,
    /"This BiteScore restaurant is temporarily unavailable\."/u,
  );
  const resolvedRestaurantId = handler.indexOf(
    "const restaurantId = readString(inviteData.restaurantId)",
  );
  const lockRead = handler.indexOf(
    "transaction.get(restaurantOperationLockRef)",
  );
  const firstClaimWrite = handler.indexOf("transaction.set(claimRef");
  assert.ok(
    resolvedRestaurantId >= 0 &&
      lockRead > resolvedRestaurantId &&
      firstClaimWrite > lockRead,
  );
  assert.equal(handler.indexOf("transaction.set("), firstClaimWrite);
  assert.ok(
    handler.indexOf("invitePreviewUnavailableReason") <
      handler.indexOf("...restaurantRevisionDecision.patch"),
  );
});

test("derived geohash decision fails closed and preserves the exact revision", () => {
  for (const restaurantData of [
    {},
    {restaurantWriteRevision: null},
    {restaurantWriteRevision: "4"},
    {restaurantWriteRevision: -1},
    {restaurantWriteRevision: 1.5},
    {restaurantWriteRevision: Number.MAX_SAFE_INTEGER + 1},
  ]) {
    let patchFactoryCalls = 0;
    const decision = decideRevisionGuardedRestaurantGeohashWrite(
      restaurantData,
      () => {
        patchFactoryCalls += 1;
        return {geohash: "djn4m"};
      },
    );
    assert.deepEqual(decision, {type: "skip"});
    assert.equal(patchFactoryCalls, 0);
  }

  const restaurantData = {
    restaurantWriteRevision: 4,
    city: "Orlando",
  };
  const decision = decideRevisionGuardedRestaurantGeohashWrite(
    restaurantData,
    () => ({geohash: "djn4m"}),
  );
  assert.equal(decision.type, "write");
  assert.equal(decision.preservedRevision, 4);
  assert.deepEqual(decision.patch, {geohash: "djn4m"});
  assert.deepEqual(
    {...restaurantData, ...decision.patch},
    {
      restaurantWriteRevision: 4,
      city: "Orlando",
      geohash: "djn4m",
    },
  );

  assert.deepEqual(
    decideRevisionGuardedRestaurantGeohashWrite(
      restaurantData,
      () => null,
    ),
    {type: "skip"},
  );
  assert.deepEqual(
    decideRevisionGuardedRestaurantGeohashWrite(
      restaurantData,
      () => ({geohash: "djn4m", restaurantWriteRevision: 5}),
    ),
    {type: "skip"},
  );
});

test("derived geohash handler uses the revision-guarded patch decision", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const start = source.indexOf(
    "export const maintainBiteScoreRestaurantGeohash",
  );
  const end = source.indexOf(
    "export const maintainBiteSaverRestaurantGeohash",
    start,
  );
  const handler = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /decideRevisionGuardedRestaurantGeohashWrite/u);
  assert.match(
    handler,
    /transaction\.update\(current\.ref, revisionGuardedDecision\.patch\)/u,
  );
  assert.doesNotMatch(handler, /restaurantWriteRevisionField/u);
  assert.doesNotMatch(handler, /nextRestaurantWriteRevision/u);
});
