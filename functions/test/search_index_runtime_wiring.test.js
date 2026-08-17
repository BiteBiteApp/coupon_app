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
  "updateAdminRestaurantQrPreparation",
]);

const expectedTriggers = Object.freeze({
  maintainBiteSaverRestaurantSearchIndex:
    "restaurant_accounts/{restaurantAccountId}",
  maintainBiteScoreRestaurantSearchIndex:
    "bitescore_restaurants/{restaurantId}",
  maintainAdminRestaurantQrPreparationFromBiteScoreUnclaim:
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

const expectedDishProposalPrivateTriggers = Object.freeze({
  maintainDishEditProposalPrivateState:
    "dish_edit_proposals/{proposalId}",
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
  searchRatingAdminUsersPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listRatingAdminUserPointsPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listRatingAdminContributionLedgerPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listRatingAdminDishSuggestionsPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listRatingAdminDestructiveOperationsPage: [
    "SEARCH_PAGINATION_CURSOR_KEY",
  ],
});

const dishSuggestionActionCallables = Object.freeze([
  "applyRatingAdminDishSuggestionGroup",
  "rejectRatingAdminDishSuggestionGroup",
]);

const dishSuggestionScheduler = "processDishProposalResolutionWork";

const ratingDestructiveCallables = Object.freeze({
  startRatingRestaurantMerge: [],
  startRatingRestaurantDelete: [],
  startRatingDishMerge: [],
  startRatingDishDelete: [],
  getRatingDestructiveOperationStatus: [],
  listRatingAdminDestructiveOperationsPage: [
    "SEARCH_PAGINATION_CURSOR_KEY",
  ],
});

const ratingDestructiveScheduler = "processRatingDestructiveOperationWork";

function loadCompiledIndexWithRuntimeHarness() {
  const state = {
    globalOptions: null,
    firestoreDocuments: new Map(),
    firestoreQueries: [],
    firestoreReads: [],
    firestoreWrites: [],
    recursiveDeletes: [],
    logs: [],
  };
  const fakeDatabase = {
    async recursiveDelete(reference) {
      state.recursiveDeletes.push(reference);
    },
    collection(collectionPath) {
      const queryState = {
        collectionPath,
        where: [],
        orderBy: [],
        limit: null,
      };
      return {
        where(field, operator, value) {
          queryState.where.push({field, operator, value});
          return this;
        },
        orderBy(field, direction) {
          queryState.orderBy.push({field, direction});
          return this;
        },
        limit(value) {
          queryState.limit = value;
          return this;
        },
        async get() {
          state.firestoreQueries.push(queryState);
          const documents = state.firestoreDocuments.get(collectionPath) ?? [];
          return {
            docs: documents.slice(0, queryState.limit ?? documents.length)
              .map((document) => ({
                id: document.id,
                data: () => document.data,
                createTime: {
                  toDate: () => document.createTime ?? new Date(0),
                },
              })),
          };
        },
      };
    },
  };
  class MockHttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  function backgroundTrigger(eventType) {
    return (...arguments_) => {
      const options = typeof arguments_[0] === "string" ?
        {document: arguments_[0]} :
        arguments_[0];
      const handler = arguments_[arguments_.length - 1];
      handler.__endpoint = {
        platform: "gcfv2",
        region: [state.globalOptions?.region],
        eventTrigger: {
          eventType,
          eventFilterPathPatterns: {document: options.document},
          retry: options.retry ?? false,
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
  function scheduledTrigger(...arguments_) {
    const options = typeof arguments_[0] === "string" ?
      {schedule: arguments_[0]} :
      arguments_[0];
    const handler = arguments_[arguments_.length - 1];
    handler.__endpoint = {
      platform: "gcfv2",
      region: [state.globalOptions?.region],
      scheduleTrigger: {schedule: options.schedule},
      ...(Array.isArray(options.secrets)
        ? {secretEnvironmentVariables: options.secrets.map((secret) => secret.name)}
        : {}),
    };
    return handler;
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
        return {
          logger: Object.fromEntries(
            ["debug", "error", "info", "log", "warn"].map((level) => [
              level,
              (...args) => state.logs.push({level, args}),
            ]),
          ),
        };
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
      case "firebase-functions/v2/scheduler":
        return {onSchedule: scheduledTrigger};
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
  for (const name of Object.keys(expectedDishProposalPrivateTriggers)) {
    assert.equal(typeof runtime.exports[name], "function", name);
  }
  assert.equal(
    Object.keys(runtime.exports).filter((name) => Object.hasOwn(expectedTriggers, name)).length,
    Object.keys(expectedTriggers).length,
  );
});

test("restaurant-account cleanup retains exact wiring and is a repeatable no-op", async () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  const cleanup = runtime.exports.cleanupDeletedRestaurantCoupons;
  const endpoint = cleanup.__endpoint;

  assert.equal(endpoint.platform, "gcfv2");
  assert.deepEqual(endpoint.region, ["us-central1"]);
  assert.equal(endpoint.eventTrigger.eventType, "document.deleted");
  assert.equal(
    endpoint.eventTrigger.eventFilterPathPatterns.document,
    "restaurant_accounts/{uid}",
  );
  assert.equal(Object.hasOwn(endpoint, "callableTrigger"), false);
  assert.equal(Object.hasOwn(endpoint, "httpsTrigger"), false);
  assert.equal(Object.hasOwn(endpoint, "scheduleTrigger"), false);
  assert.equal(Object.hasOwn(endpoint, "secretEnvironmentVariables"), false);

  const eventReads = [];
  const referenceCollections = [];
  const sensitiveUid = "owner-uid-must-not-be-read-or-logged";
  const accountReference = {
    async get() {
      runtime.state.firestoreReads.push("event.data.ref.get");
    },
    async create() {
      runtime.state.firestoreWrites.push("event.data.ref.create");
    },
    async delete() {
      runtime.state.firestoreWrites.push("event.data.ref.delete");
    },
    async set() {
      runtime.state.firestoreWrites.push("event.data.ref.set");
    },
    async update() {
      runtime.state.firestoreWrites.push("event.data.ref.update");
    },
    collection(collectionPath) {
      referenceCollections.push(collectionPath);
      return {collectionPath};
    },
  };
  const event = new Proxy(
    {
      params: {uid: sensitiveUid},
      data: {ref: accountReference},
    },
    {
      get(target, property, receiver) {
        eventReads.push(String(property));
        return Reflect.get(target, property, receiver);
      },
    },
  );

  assert.equal(await cleanup(event), undefined);
  assert.equal(await cleanup(event), undefined);
  assert.deepEqual(eventReads, []);
  assert.deepEqual(referenceCollections, []);
  assert.deepEqual(runtime.state.firestoreQueries, []);
  assert.deepEqual(runtime.state.firestoreReads, []);
  assert.deepEqual(runtime.state.firestoreWrites, []);
  assert.deepEqual(runtime.state.recursiveDeletes, []);
  assert.deepEqual(runtime.state.logs, []);
  assert.equal(JSON.stringify(runtime.state.logs).includes(sensitiveUid), false);
});

test("dish proposal private-state trigger uses exact background-only metadata", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const [name, documentPath] of Object.entries(
    expectedDishProposalPrivateTriggers,
  )) {
    const endpoint = runtime.exports[name].__endpoint;
    assert.equal(endpoint.platform, "gcfv2", name);
    assert.deepEqual(endpoint.region, ["us-central1"], name);
    assert.equal(endpoint.eventTrigger.eventType, "document.written", name);
    assert.equal(
      endpoint.eventTrigger.eventFilterPathPatterns.document,
      documentPath,
      name,
    );
    assert.equal(Object.hasOwn(endpoint, "callableTrigger"), false, name);
    assert.equal(Object.hasOwn(endpoint, "httpsTrigger"), false, name);
    assert.equal(Object.hasOwn(endpoint, "scheduleTrigger"), false, name);
    assert.equal(
      Object.hasOwn(endpoint, "secretEnvironmentVariables"),
      false,
      name,
    );
  }
  assert.equal(
    Object.keys(runtime.exports).filter((name) =>
      Object.hasOwn(expectedDishProposalPrivateTriggers, name)).length,
    1,
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
  assert.equal(
    runtime.exports
      .maintainAdminRestaurantQrPreparationFromBiteScoreUnclaim
      .__endpoint.eventTrigger.retry,
    true,
  );
  for (const name of Object.keys(expectedTriggers).filter((value) =>
    value !== "maintainAdminRestaurantQrPreparationFromBiteScoreUnclaim")) {
    assert.equal(runtime.exports[name].__endpoint.eventTrigger.retry, false, name);
  }
});

test("offer triggers delegate catalog signaling after existing child reconciliation", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const couponStart = source.indexOf(
    "export const maintainBiteSaverCouponOfferSearchIndex",
  );
  const specialStart = source.indexOf(
    "export const maintainBiteSaverDailySpecialSearchIndex",
  );
  const nextTriggerStart = source.indexOf(
    "export const maintainAdminUserDirectoryFromRestaurantAccount",
  );
  assert.ok(couponStart >= 0);
  assert.ok(specialStart > couponStart);
  assert.ok(nextTriggerStart > specialStart);

  const couponTrigger = source.slice(couponStart, specialStart);
  const specialTrigger = source.slice(specialStart, nextTriggerStart);
  assert.match(couponTrigger, /await handleBiteSaverCouponOfferWrite/u);
  assert.match(specialTrigger, /await handleBiteSaverDailySpecialOfferWrite/u);
  for (const trigger of [couponTrigger, specialTrigger]) {
    assert.doesNotMatch(trigger, /FieldValue\.serverTimestamp/u);
    assert.doesNotMatch(trigger, /\bupdatedAt\b/u);
    assert.doesNotMatch(trigger, /\.collection\(/u);
  }
});

test("Admin search loads prepared claim invitations through one exact batch", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const loaderStart = source.indexOf(
    "async function loadAdminRestaurantQrPreparationInvitationDocuments",
  );
  const loaderEnd = source.indexOf(
    "function requireTokenizedSubscriptionReturnProtocol",
    loaderStart,
  );
  assert.ok(loaderStart >= 0);
  assert.ok(loaderEnd > loaderStart);
  const loader = source.slice(loaderStart, loaderEnd);
  assert.match(loader, /readBiteScoreCatalogRestaurantId\(invitationId\)/u);
  assert.match(loader, /new Set<string>\(\)/u);
  assert.equal([...loader.matchAll(/\.getAll\(/ug)].length, 1);
  assert.match(
    loader,
    /db\.collection\(restaurantInviteCollection\)\.doc\(invitationId\)/u,
  );

  const searchStart = source.indexOf(
    "export const searchAdminRestaurants",
  );
  const searchEnd = source.indexOf(
    "export const updateAdminRestaurantQrPreparation",
    searchStart,
  );
  assert.ok(searchStart >= 0);
  assert.ok(searchEnd > searchStart);
  const search = source.slice(searchStart, searchEnd);
  assert.match(
    search,
    /loadQrPreparationInvitationDocuments:\s*\n\s*loadAdminRestaurantQrPreparationInvitationDocuments/u,
  );
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

test("preparation updates reject non-Admin callers before data access", async () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  const updatePreparation =
    runtime.exports.updateAdminRestaurantQrPreparation;

  assert.equal(updatePreparation.__endpoint.platform, "gcfv2");
  assert.deepEqual(updatePreparation.__endpoint.region, ["us-central1"]);
  assert.equal(
    Object.hasOwn(updatePreparation.__endpoint, "secretEnvironmentVariables"),
    false,
  );
  for (const request of [
    {data: {}, auth: null},
    {
      data: {},
      auth: {
        uid: "not-admin",
        token: {email: "not-admin@example.test"},
      },
    },
  ]) {
    await assert.rejects(
      updatePreparation(request),
      (error) => error.code === "permission-denied",
    );
  }
  assert.deepEqual(runtime.state.firestoreQueries, []);
  assert.deepEqual(runtime.state.firestoreReads, []);
  assert.deepEqual(runtime.state.firestoreWrites, []);
});

test("exactly nine Rating Admin paged v2 callables use least-privilege secrets", () => {
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
    9,
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

test("dish-suggestion actions and scheduler expose only the exact bounded endpoints", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  const queue = runtime.exports.listRatingAdminDishSuggestionsPage;
  assert.equal(typeof queue, "function", "listRatingAdminDishSuggestionsPage");
  assert.ok(queue.__endpoint.callableTrigger);
  assert.equal(Object.hasOwn(queue.__endpoint, "httpsTrigger"), false);
  assert.equal(Object.hasOwn(queue.__endpoint, "eventTrigger"), false);
  assert.equal(Object.hasOwn(queue.__endpoint, "scheduleTrigger"), false);
  for (const name of dishSuggestionActionCallables) {
    const exported = runtime.exports[name];
    assert.equal(typeof exported, "function", name);
    assert.equal(exported.__endpoint.platform, "gcfv2", name);
    assert.deepEqual(exported.__endpoint.region, ["us-central1"], name);
    assert.ok(exported.__endpoint.callableTrigger, name);
    assert.equal(Object.hasOwn(exported.__endpoint, "httpsTrigger"), false, name);
    assert.equal(Object.hasOwn(exported.__endpoint, "eventTrigger"), false, name);
    assert.equal(Object.hasOwn(exported.__endpoint, "scheduleTrigger"), false, name);
    assert.equal(
      Object.hasOwn(exported.__endpoint, "secretEnvironmentVariables"),
      false,
      name,
    );
  }

  const scheduled = runtime.exports[dishSuggestionScheduler];
  assert.equal(typeof scheduled, "function", dishSuggestionScheduler);
  assert.equal(scheduled.__endpoint.platform, "gcfv2");
  assert.deepEqual(scheduled.__endpoint.region, ["us-central1"]);
  assert.deepEqual(scheduled.__endpoint.scheduleTrigger, {
    schedule: "every 1 minute",
  });
  assert.equal(Object.hasOwn(scheduled.__endpoint, "callableTrigger"), false);
  assert.equal(Object.hasOwn(scheduled.__endpoint, "httpsTrigger"), false);
  assert.equal(Object.hasOwn(scheduled.__endpoint, "eventTrigger"), false);
  assert.equal(
    Object.hasOwn(scheduled.__endpoint, "secretEnvironmentVariables"),
    false,
  );

  assert.deepEqual(
    [
      "listRatingAdminDishSuggestionsPage",
      ...dishSuggestionActionCallables,
      dishSuggestionScheduler,
    ].filter((name) => typeof runtime.exports[name] === "function").sort(),
    [
      "listRatingAdminDishSuggestionsPage",
      ...dishSuggestionActionCallables,
      dishSuggestionScheduler,
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(runtime.exports).filter((name) =>
      /DishProposal(?:JobStep|JobStatus)/u.test(name)),
    [],
  );
});

test("Rating destructive operations expose exactly six callables and one bounded scheduler", () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const [name, expectedSecrets] of Object.entries(
    ratingDestructiveCallables,
  )) {
    const exported = runtime.exports[name];
    assert.equal(typeof exported, "function", name);
    assert.equal(exported.__endpoint.platform, "gcfv2", name);
    assert.deepEqual(exported.__endpoint.region, ["us-central1"], name);
    assert.ok(exported.__endpoint.callableTrigger, name);
    assert.equal(Object.hasOwn(exported.__endpoint, "httpsTrigger"), false, name);
    assert.equal(Object.hasOwn(exported.__endpoint, "eventTrigger"), false, name);
    assert.equal(Object.hasOwn(exported.__endpoint, "scheduleTrigger"), false, name);
    assert.deepEqual(
      exported.__endpoint.secretEnvironmentVariables ?? [],
      expectedSecrets,
      name,
    );
  }

  const scheduled = runtime.exports[ratingDestructiveScheduler];
  assert.equal(typeof scheduled, "function", ratingDestructiveScheduler);
  assert.equal(scheduled.__endpoint.platform, "gcfv2");
  assert.deepEqual(scheduled.__endpoint.region, ["us-central1"]);
  assert.deepEqual(scheduled.__endpoint.scheduleTrigger, {
    schedule: "every 1 minute",
  });
  assert.equal(Object.hasOwn(scheduled.__endpoint, "callableTrigger"), false);
  assert.equal(Object.hasOwn(scheduled.__endpoint, "httpsTrigger"), false);
  assert.equal(Object.hasOwn(scheduled.__endpoint, "eventTrigger"), false);
  assert.equal(
    Object.hasOwn(scheduled.__endpoint, "secretEnvironmentVariables"),
    false,
  );

  const expectedNames = [
    ...Object.keys(ratingDestructiveCallables),
    ratingDestructiveScheduler,
  ].sort();
  assert.deepEqual(
    Object.keys(runtime.exports).filter((name) =>
      /^(?:startRating|getRatingDestructive|listRatingAdminDestructive|processRatingDestructive)/u
        .test(name)).sort(),
    expectedNames,
  );
  assert.deepEqual(
    Object.keys(runtime.exports).filter((name) =>
      /RatingDestructive(?:JobStep|JobDocument|JobStatus|OperationLock)/u
        .test(name)),
    [],
  );
});

test("Rating destructive action and status callables reject missing authentication", async () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  for (const name of Object.keys(ratingDestructiveCallables).filter(
    (candidate) => candidate !== "listRatingAdminDestructiveOperationsPage",
  )) {
    await assert.rejects(
      runtime.exports[name]({data: {}, auth: null}),
      (error) => error.code === "unauthenticated",
      name,
    );
  }
  assert.equal(runtime.state.firestoreQueries.length, 0);
});

test("Rating destructive scheduler logs only its fixed aggregate summary", async () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  await runtime.exports[ratingDestructiveScheduler]();
  assert.deepEqual(runtime.state.logs, [{
    level: "info",
    args: [
      "Rating destructive operation work completed.",
      {selectedJobs: 0, processedJobs: 0, failures: 0},
    ],
  }]);
});

test("dish-suggestion callables authorize before request or data access", async () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  const invalidAuthStates = [
    null,
    undefined,
    {},
    {uid: "", token: {email: "schuyler.cole@gmail.com"}},
    {uid: "admin-1", token: {}},
    {uid: "admin-1", token: {email: 42}},
    {
      uid: "admin-1",
      token: {
        email: "schuyler.cole@gmail.com",
        firebase: "malformed",
      },
    },
    {
      uid: "admin-1",
      token: {
        email: "schuyler.cole@gmail.com",
        firebase: {sign_in_provider: ""},
      },
    },
    {
      uid: "admin-1",
      token: {
        email: "schuyler.cole@gmail.com",
        firebase: {sign_in_provider: "anonymous"},
      },
    },
    {uid: "not-admin", token: {email: "not-admin@example.test"}},
  ];
  for (const name of [
    "listRatingAdminDishSuggestionsPage",
    ...dishSuggestionActionCallables,
  ]) {
    for (const auth of invalidAuthStates) {
      await assert.rejects(
        runtime.exports[name]({data: {}, auth}),
        (error) => error.code === "permission-denied",
        `${name} invalid auth`,
      );
    }
    await assert.rejects(
      runtime.exports[name]({
        data: undefined,
        auth: {
          uid: "admin-1",
          token: {
            email: "schuyler.cole@gmail.com",
            firebase: {sign_in_provider: "password"},
          },
        },
      }),
      (error) => error.code === "invalid-argument",
      `${name} valid Admin reaches strict request validation`,
    );
  }
  assert.equal(runtime.state.firestoreQueries.length, 0);
});

test("dish-suggestion scheduler logs only its fixed bounded summary", async () => {
  const runtime = loadCompiledIndexWithRuntimeHarness();
  const privateCanaries = [
    "private-group-id-canary",
    "private-email-canary@example.test",
    "proposal-reason-canary",
    "auth-token-canary",
  ];
  runtime.state.firestoreDocuments.set(
    "private_dish_edit_proposal_groups",
    [{
      id: privateCanaries[0],
      data: {
        resolutionIdentitiesValid: true,
        autoEligible: true,
        dueAt: new Date(0),
        privateEmail: privateCanaries[1],
        proposalReason: privateCanaries[2],
        token: privateCanaries[3],
      },
    }],
  );

  await runtime.exports.processDishProposalResolutionWork();

  assert.deepEqual(runtime.state.logs, [{
    level: "info",
    args: [
      "Dish proposal resolution work completed.",
      {
        selectedExistingJobs: 0,
        selectedDueGroups: 1,
        processedExistingJobs: 0,
        claimedDueGroups: 0,
        processedDueGroups: 0,
        failures: 1,
      },
    ],
  }]);
  const serializedLogs = JSON.stringify(runtime.state.logs);
  for (const canary of privateCanaries) {
    assert.equal(serializedLogs.includes(canary), false, canary);
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

test("Firestore rules expose only current BiteSaver restaurant projections", () => {
  const rules = readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
  for (const collection of [
    "restaurant_search_index",
    "dish_search_index",
    "bitesaver_offer_index",
    "private_search_index_jobs",
  ]) {
    assert.equal(rules.includes(`match /${collection}/`), true, collection);
  }
  for (const collection of [
    "private_admin_restaurant_search_sessions",
    "private_admin_restaurant_search_active_sessions",
    "private_rating_admin_restaurant_search_sessions",
    "private_rating_admin_restaurant_search_active_sessions",
  ]) {
    assert.equal(rules.includes(collection), false, collection);
  }
  assert.match(
    rules,
    /publicProjectionVersion == 'bitestar\.bitesaver-public-restaurant\.v1'/u,
  );
  assert.match(
    rules,
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}\s*\}\s*\}\s*$/u,
  );
});
