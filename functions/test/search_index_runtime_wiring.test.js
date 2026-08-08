"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const actualFirestore = require("firebase-admin/firestore");
const packageJson = require("../package.json");

const baselineExports = Object.freeze([
  "awardApprovedDishProposalContributionPoints",
  "awardContributionPoints",
  "awardCreatedDishContributionPoints",
  "awardDishImageContributionPoints",
  "awardReviewMilestoneContributionPoints",
  "claimBiteSaverSubscriptionReturnEvent",
  "cleanupDeletedRestaurantCoupons",
  "createBiteScoreRestaurantClaimInvite",
  "createCheckoutSession",
  "createCouponRestaurantInvite",
  "createCustomerPortalSession",
  "createSubscriptionCheckoutSession",
  "listBiteSaverSubscriptionReturnEvents",
  "listRestaurantInvites",
  "maintainBiteSaverRestaurantGeohash",
  "maintainBiteScoreRestaurantGeohash",
  "markContributionPointLedgerEntriesCelebrated",
  "previewRestaurantInvite",
  "processProximityPushRequest",
  "recalculateLocalExpertBadgesOnReviewWrite",
  "recalculateMyLocalExpertBadges",
  "reconcileReviewMilestoneContributionPointsAfterModeration",
  "redeemBiteSaverSubscriptionReturn",
  "redeemBiteScoreRestaurantClaimInvite",
  "redeemCouponRestaurantInvite",
  "reverseContributionPointLedgerEntry",
  "reverseContributionPointsForDish",
  "reviewBiteSaverApplication",
  "revokeRestaurantInvite",
  "saveBiteSaverRestaurantProfile",
  "searchAdminRestaurants",
  "stripeWebhook",
  "subscriptionCheckoutCancel",
  "subscriptionCheckoutSuccess",
]);

const expectedTriggers = Object.freeze({
  maintainBiteSaverRestaurantSearchIndex:
    "restaurant_accounts/{restaurantAccountId}",
  maintainBiteScoreRestaurantSearchIndex:
    "bitescore_restaurants/{restaurantId}",
  maintainBiteScoreDishSearchIndex:
    "bitescore_dishes/{dishId}",
  maintainBiteScoreDishSearchIndexFromAggregate:
    "dish_rating_aggregates/{dishId}",
  maintainBiteSaverCouponOfferSearchIndex:
    "restaurant_accounts/{restaurantAccountId}/coupons/{couponId}",
  maintainBiteSaverDailySpecialSearchIndex:
    "restaurant_accounts/{restaurantAccountId}/daily_specials/{dailySpecialId}",
  processPrivateSearchIndexJob:
    "private_search_index_jobs/{jobId}",
});

function loadCompiledIndexWithRuntimeHarness() {
  const state = {globalOptions: null};
  const fakeDatabase = {};
  class MockHttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  function backgroundTrigger(eventType) {
    return (...arguments_) => {
      const document = arguments_[0];
      const handler = arguments_[arguments_.length - 1];
      handler.__endpoint = {
        platform: "gcfv2",
        region: [state.globalOptions?.region],
        eventTrigger: {
          eventType,
          eventFilterPathPatterns: {document},
        },
      };
      return handler;
    };
  }
  function httpsTrigger(kind) {
    return (...arguments_) => {
      const handler = arguments_[arguments_.length - 1];
      handler.__endpoint = {
        platform: "gcfv2",
        region: [state.globalOptions?.region],
        [kind]: {},
      };
      return handler;
    };
  }
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    switch (request) {
      case "firebase-admin/app":
        return {initializeApp() {}};
      case "firebase-admin/firestore":
        return {...actualFirestore, getFirestore: () => fakeDatabase};
      case "firebase-admin/messaging":
        return {getMessaging: () => ({send: async () => "unused"})};
      case "firebase-functions":
        return {logger: {debug() {}, error() {}, info() {}, log() {}, warn() {}}};
      case "firebase-functions/params":
        return {
          defineSecret: (name) => ({name, value: () => "unused"}),
          defineString: (name) => ({name, value: () => "unused"}),
        };
      case "firebase-functions/v2/firestore":
        return {
          onDocumentCreated: backgroundTrigger("document.created"),
          onDocumentDeleted: backgroundTrigger("document.deleted"),
          onDocumentWritten: backgroundTrigger("document.written"),
        };
      case "firebase-functions/v2/https":
        return {
          HttpsError: MockHttpsError,
          onCall: httpsTrigger("callableTrigger"),
          onRequest: httpsTrigger("httpsTrigger"),
        };
      case "firebase-functions/v2/options":
        return {setGlobalOptions: (options) => { state.globalOptions = options; }};
      case "stripe":
        return class FakeStripe {};
      default:
        return originalLoad.call(this, request, parent, isMain);
    }
  };

  const indexPath = path.resolve(__dirname, "../lib/index.js");
  delete require.cache[indexPath];
  try {
    return {exports: require(indexPath), state};
  } finally {
    delete require.cache[indexPath];
    Module._load = originalLoad;
  }
}

test("all prior exports remain and each search-index trigger is exported once", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const name of baselineExports) {
    assert.equal(typeof runtime.exports[name], "function", name);
  }
  for (const name of Object.keys(expectedTriggers)) {
    assert.equal(typeof runtime.exports[name], "function", name);
  }
  assert.equal(
    Object.keys(runtime.exports).filter((name) => Object.hasOwn(expectedTriggers, name)).length,
    Object.keys(expectedTriggers).length,
  );
});

test("compiled trigger metadata uses exact private paths and background event types", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const [name, documentPath] of Object.entries(expectedTriggers)) {
    const endpoint = runtime.exports[name].__endpoint;
    assert.equal(endpoint.platform, "gcfv2", name);
    assert.equal(endpoint.eventTrigger.eventFilterPathPatterns.document, documentPath, name);
    assert.deepEqual(endpoint.region, ["us-central1"], name);
    assert.equal(Object.hasOwn(endpoint, "callableTrigger"), false, name);
    assert.equal(Object.hasOwn(endpoint, "httpsTrigger"), false, name);
    assert.equal(Object.hasOwn(endpoint, "secretEnvironmentVariables"), false, name);
  }
  assert.equal(
    runtime.exports.processPrivateSearchIndexJob.__endpoint.eventTrigger.eventType,
    "document.created",
  );
  for (const name of Object.keys(expectedTriggers).filter((value) =>
    value !== "processPrivateSearchIndexJob")) {
    assert.equal(runtime.exports[name].__endpoint.eventTrigger.eventType, "document.written");
  }
});

test("global runtime remains us-central1 Node 24 with no new parameter binding", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  assert.deepEqual(runtime.state.globalOptions, {region: "us-central1", maxInstances: 10});
  assert.equal(packageJson.engines.node, "24");
});

test("existing geohash triggers retain their original exact paths", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  assert.equal(
    runtime.exports.maintainBiteScoreRestaurantGeohash.__endpoint
      .eventTrigger.eventFilterPathPatterns.document,
    "bitescore_restaurants/{restaurantId}",
  );
  assert.equal(
    runtime.exports.maintainBiteSaverRestaurantGeohash.__endpoint
      .eventTrigger.eventFilterPathPatterns.document,
    "restaurant_accounts/{accountId}",
  );
});

test("current Firestore rules leave all new private collections unmatched and denied", () => {
  const rules = readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
  for (const collection of [
    "restaurant_search_index",
    "dish_search_index",
    "bitesaver_offer_index",
    "private_search_index_jobs",
  ]) {
    assert.equal(rules.includes(collection), false, collection);
  }
  assert.match(
    rules,
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}\s*\}\s*\}\s*$/u,
  );
});
