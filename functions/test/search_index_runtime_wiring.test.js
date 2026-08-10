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

const expectedAdminUserDirectoryTriggers = Object.freeze({
  maintainAdminUserDirectoryFromRestaurantAccount:
    "restaurant_accounts/{restaurantAccountId}",
  maintainAdminUserDirectoryFromUserProfile:
    "user_profiles/{userId}",
  maintainAdminUserDirectoryFromPublicReviewerProfile:
    "public_reviewer_profiles/{userId}",
  maintainAdminUserDirectoryFromBiteScoreRestaurant:
    "bitescore_restaurants/{restaurantId}",
  maintainAdminUserDirectoryFromRestaurantClaimRequest:
    "restaurant_claim_requests/{claimRequestId}",
  maintainAdminUserDirectoryFromDishReview:
    "dish_reviews/{reviewId}",
  maintainAdminUserDirectoryFromReviewReport:
    "review_reports/{reportId}",
  maintainAdminUserDirectoryFromRestaurantReport:
    "restaurant_reports/{reportId}",
  maintainAdminUserDirectoryFromDishReport:
    "dish_reports/{reportId}",
  maintainAdminUserDirectoryFromDuplicateRestaurantReport:
    "duplicate_restaurant_reports/{reportId}",
  maintainAdminUserDirectoryFromDishEditProposal:
    "dish_edit_proposals/{proposalId}",
  maintainAdminUserDirectoryFromReviewFeedbackVote:
    "review_feedback_votes/{voteId}",
});

const couponAdminPagedCallables = Object.freeze({
  searchCouponAdminRestaurantsPage: [
    "SEARCH_PAGINATION_CURSOR_KEY",
    "GOOGLE_MAPS_API_KEY",
  ],
  listCouponAdminQueuePage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listCouponAdminCouponsPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listCouponAdminInviteHistoryPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
});

const ratingAdminPagedCallables = Object.freeze({
  searchRatingAdminRestaurantsPage: [
    "SEARCH_PAGINATION_CURSOR_KEY",
    "GOOGLE_MAPS_API_KEY",
  ],
  listRatingAdminDirectoryPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listRatingAdminQueuePage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listRatingAdminInviteHistoryPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
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
      const options = arguments_.length > 1 ? arguments_[0] : {};
      const handler = arguments_[arguments_.length - 1];
      handler.__endpoint = {
        platform: "gcfv2",
        region: [state.globalOptions?.region],
        [kind]: {},
        ...(Array.isArray(options.secrets)
          ? {secretEnvironmentVariables: options.secrets.map((secret) => secret.name)}
          : {}),
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
  for (const name of Object.keys(expectedAdminUserDirectoryTriggers)) {
    assert.equal(typeof runtime.exports[name], "function", name);
  }
  assert.equal(
    Object.keys(runtime.exports).filter((name) => Object.hasOwn(expectedTriggers, name)).length,
    Object.keys(expectedTriggers).length,
  );
});

test("Admin user directory triggers use exact private paths and background-only metadata", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const [name, documentPath] of Object.entries(expectedAdminUserDirectoryTriggers)) {
    const endpoint = runtime.exports[name].__endpoint;
    assert.equal(endpoint.platform, "gcfv2", name);
    assert.deepEqual(endpoint.region, ["us-central1"], name);
    assert.equal(endpoint.eventTrigger.eventType, "document.written", name);
    assert.equal(endpoint.eventTrigger.eventFilterPathPatterns.document, documentPath, name);
    assert.equal(Object.hasOwn(endpoint, "callableTrigger"), false, name);
    assert.equal(Object.hasOwn(endpoint, "httpsTrigger"), false, name);
    assert.equal(Object.hasOwn(endpoint, "secretEnvironmentVariables"), false, name);
  }
  assert.equal(
    Object.keys(runtime.exports).filter((name) =>
      Object.hasOwn(expectedAdminUserDirectoryTriggers, name)).length,
    12,
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

test("exactly four Coupon Admin paged v2 callables use least-privilege secrets", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const [name, expectedSecrets] of Object.entries(couponAdminPagedCallables)) {
    const exported = runtime.exports[name];
    assert.equal(typeof exported, "function", name);
    assert.equal(exported.__endpoint.platform, "gcfv2", name);
    assert.deepEqual(exported.__endpoint.region, ["us-central1"], name);
    assert.deepEqual(
      [...exported.__endpoint.secretEnvironmentVariables].sort(),
      [...expectedSecrets].sort(),
      name,
    );
    assert.equal(Object.hasOwn(exported.__endpoint, "httpsTrigger"), false, name);
  }
  assert.equal(
    Object.keys(runtime.exports).filter((name) => name.startsWith("searchCouponAdmin") || name.startsWith("listCouponAdmin")).length,
    4,
  );
  assert.deepEqual(
    runtime.exports.searchAdminRestaurants.__endpoint.secretEnvironmentVariables,
    ["GOOGLE_MAPS_API_KEY"],
  );
});

test("all Coupon Admin paged callables reject unauthenticated and non-Admin callers before data access", async () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const name of Object.keys(couponAdminPagedCallables)) {
    await assert.rejects(
      runtime.exports[name]({data: {}, auth: null}),
      (error) => error.code === "permission-denied",
      `${name} unauthenticated`,
    );
    await assert.rejects(
      runtime.exports[name]({
        data: {},
        auth: {
          uid: "not-admin",
          token: {email: "not-admin@example.test"},
        },
      }),
      (error) => error.code === "permission-denied",
      `${name} non-Admin`,
    );
  }
});

test("exactly four Rating Admin paged v2 callables use least-privilege secrets", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const [name, expectedSecrets] of Object.entries(
    ratingAdminPagedCallables,
  )) {
    const exported = runtime.exports[name];
    assert.equal(typeof exported, "function", name);
    assert.equal(exported.__endpoint.platform, "gcfv2", name);
    assert.deepEqual(exported.__endpoint.region, ["us-central1"], name);
    assert.deepEqual(
      [...exported.__endpoint.secretEnvironmentVariables].sort(),
      [...expectedSecrets].sort(),
      name,
    );
    assert.equal(Object.hasOwn(exported.__endpoint, "httpsTrigger"), false, name);
  }
  assert.equal(
    Object.keys(runtime.exports).filter((name) =>
      name.startsWith("searchRatingAdmin") ||
      name.startsWith("listRatingAdmin")).length,
    4,
  );
});

test("all Rating Admin paged callables authorize before request or data access", async () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const name of Object.keys(ratingAdminPagedCallables)) {
    await assert.rejects(
      runtime.exports[name]({data: {}, auth: null}),
      (error) => error.code === "permission-denied",
      name + " unauthenticated",
    );
    await assert.rejects(
      runtime.exports[name]({
        data: {},
        auth: {
          uid: "not-admin",
          token: {email: "not-admin@example.test"},
        },
      }),
      (error) => error.code === "permission-denied",
      name + " non-Admin",
    );
  }
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
    "private_admin_restaurant_search_sessions",
    "private_admin_restaurant_search_active_sessions",
    "private_rating_admin_restaurant_search_sessions",
    "private_rating_admin_restaurant_search_active_sessions",
  ]) {
    assert.equal(rules.includes(collection), false, collection);
  }
  assert.match(
    rules,
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}\s*\}\s*\}\s*$/u,
  );
});
