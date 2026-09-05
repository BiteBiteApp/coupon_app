"use strict";

const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const realCrypto = require("node:crypto");
const {readFileSync} = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const protocolVersion = 2;
const updateRequiredMessage =
  "This version of BiteStar must be updated before managing a subscription.";
const checkoutSuccessBaseUrl =
  "https://coupon-app-29446.web.app/stripe-success.html";
const checkoutCancelBaseUrl =
  "https://coupon-app-29446.web.app/stripe-cancel.html";
const portalBaseUrl =
  "https://app.bitestar.app/subscription/portal-return";
const stripePriceId = "price_1TJKGjBwoT6e93tVkesJPfxD";
const ownerBillingMetadataVersion = "bitestar.owner-billing-metadata.v2";

const canaries = Object.freeze({
  apiSecret: "sk_test_session_protocol_fake_secret",
  checkoutUrl: "https://checkout.stripe.test/session/synthetic-secret",
  checkoutSession: "cs_test_sessionprotocolcheckout",
  customer: "cus_sessionprotocolcustomer",
  document: "restaurant_accounts/session-protocol-owner",
  email: "session-protocol-owner@example.test",
  paymentIntent: "pi_session_protocol_payment",
  portalUrl: "https://billing.stripe.test/session/synthetic-secret",
  rawError: "raw-provider-session-protocol-error",
  stack: "Error: synthetic provider stack",
  subscription: "sub_sessionprotocolsubscription",
  uid: "session-protocol-owner",
});

class MockHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
    this.details = details;
  }
}

function createHarness() {
  const state = {
    accountDocument: {
      email: canaries.email,
      hasUsedTrial: false,
      profileField: "preserve-profile",
      stripeCustomerId: canaries.customer,
    },
    accountExists: true,
    accountLookupFailure: null,
    billingPortalCalls: [],
    billingPortalFailure: null,
    billingPortalStateSnapshots: [],
    billingPortalResponse: {url: canaries.portalUrl},
    checkoutBillingStateSnapshots: [],
    checkoutBeforeResponse: null,
    checkoutCalls: [],
    checkoutOptions: [],
    checkoutFailure: null,
    checkoutResponse: {
      id: canaries.checkoutSession,
      customer: canaries.customer,
      url: canaries.checkoutUrl,
    },
    dbCalls: [],
    globalOptions: [],
    hashCalls: 0,
    ledgerDocument: undefined,
    ledgerReads: [],
    ledgerVersion: 0,
    ledgerWrites: [],
    logs: [],
    operationTimeline: [],
    ownerBillingDocument: undefined,
    ownerBillingReads: [],
    ownerBillingVersion: 0,
    ownerBillingWrites: [],
    parameterValue: portalBaseUrl,
    randomBytesCalls: 0,
    randomBytesQueue: [],
    stripeConstructorCalls: [],
    stripeConstructorFailure: null,
    stripeSecretResolutionFailure: null,
    transactionBehaviors: [],
    transactionCallbackAttempts: 0,
    transactionCommits: 0,
    writes: [],
  };

  function reset() {
    state.accountDocument = {
      email: canaries.email,
      hasUsedTrial: false,
      profileField: "preserve-profile",
      stripeCustomerId: canaries.customer,
    };
    state.accountExists = true;
    state.accountLookupFailure = null;
    state.billingPortalCalls = [];
    state.billingPortalFailure = null;
    state.billingPortalStateSnapshots = [];
    state.billingPortalResponse = {url: canaries.portalUrl};
    state.checkoutBillingStateSnapshots = [];
    state.checkoutBeforeResponse = null;
    state.checkoutCalls = [];
    state.checkoutOptions = [];
    state.checkoutFailure = null;
    state.checkoutResponse = {
      id: canaries.checkoutSession,
      customer: canaries.customer,
      url: canaries.checkoutUrl,
    };
    state.dbCalls = [];
    state.hashCalls = 0;
    state.ledgerDocument = undefined;
    state.ledgerReads = [];
    state.ledgerVersion = 0;
    state.ledgerWrites = [];
    state.logs = [];
    state.operationTimeline = [];
    state.ownerBillingDocument = undefined;
    state.ownerBillingReads = [];
    state.ownerBillingVersion = 0;
    state.ownerBillingWrites = [];
    state.parameterValue = portalBaseUrl;
    state.randomBytesCalls = 0;
    state.randomBytesQueue = [];
    state.stripeConstructorCalls = [];
    state.stripeConstructorFailure = null;
    state.stripeSecretResolutionFailure = null;
    state.transactionBehaviors = [];
    state.transactionCallbackAttempts = 0;
    state.transactionCommits = 0;
    state.writes = [];
  }

  function seedKnownBillingState(rawStripeStatus = "active") {
    const now = new Date();
    const checkoutAttemptId = "attempt_session_protocol_checkout";
    state.ownerBillingDocument = buildOwnerBillingStateDocument({
      ownerUid: canaries.uid,
      lifecycleState: "subscription_known",
      rawStripeStatus,
      billingPosture: classifyOwnerBillingRawStripeStatus(rawStripeStatus),
      stripeCustomerId: canaries.customer,
      stripeSubscriptionId: canaries.subscription,
      checkoutAttemptId,
      checkoutRequestFingerprint: "a".repeat(64),
      checkoutAttemptCreatedAt: now,
      checkoutSessionId: canaries.checkoutSession,
      lastStripeEventCreated: 1_900_000_000,
      lastStripeEventId: "evt_sessionprotocolactive",
      lastStripeEventPayloadFingerprint: "b".repeat(64),
      stripeEventConflictKind: null,
      createdAt: now,
      updatedAt: now,
    });
    state.ownerBillingVersion += 1;
    return structuredClone(state.ownerBillingDocument);
  }

  function seedCheckoutBillingState(lifecycleState) {
    assert.ok(
      lifecycleState === "checkout_pending" || lifecycleState === "unknown",
    );
    const now = new Date();
    state.ownerBillingDocument = buildOwnerBillingStateDocument({
      ownerUid: canaries.uid,
      lifecycleState,
      rawStripeStatus: null,
      billingPosture: lifecycleState === "unknown"
        ? "unknown"
        : "blocking",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      checkoutAttemptId: "attempt_session_protocol_checkout",
      checkoutRequestFingerprint: "a".repeat(64),
      checkoutAttemptCreatedAt: now,
      checkoutSessionId: null,
      lastStripeEventCreated: null,
      lastStripeEventId: null,
      lastStripeEventPayloadFingerprint: null,
      stripeEventConflictKind: null,
      createdAt: now,
      updatedAt: now,
    });
    state.ownerBillingVersion += 1;
    return structuredClone(state.ownerBillingDocument);
  }

  function seedActiveBillingState() {
    return seedKnownBillingState("active");
  }

  const db = {
    collection(collectionPath) {
      return {
        doc(documentId) {
          const documentPath = `${collectionPath}/${documentId}`;
          return {
            id: documentId,
            path: documentPath,
            async get() {
              state.dbCalls.push({
                operation: "get",
                path: documentPath,
              });
              if (state.accountLookupFailure !== null) {
                throw state.accountLookupFailure;
              }
              return {
                exists: state.accountExists,
                data: () =>
                  state.accountExists
                    ? {...state.accountDocument}
                    : undefined,
              };
            },
          };
        },
        where(field, operator, value) {
          state.dbCalls.push({
            operation: "query",
            collectionPath,
            field,
            operator,
            value,
          });
          return {
            limit() {
              return {
                async get() {
                  return {
                    empty: !state.accountExists,
                    docs: state.accountExists
                      ? [{id: canaries.uid}]
                      : [],
                  };
                },
              };
            },
          };
        },
      };
    },
    async runTransaction(callback) {
      const behavior = state.transactionBehaviors.shift() ?? {
        type: "commit",
      };
      const runAttempt = async (commit) => {
        const pendingLedgerWrites = [];
        const pendingOwnerBillingWrites = [];
        const pendingWrites = [];
        let ledgerReadVersion = null;
        let ownerBillingReadVersion = null;
        state.transactionCallbackAttempts += 1;
        const result = await callback({
          async get(reference) {
            if (
              reference.path.startsWith(
                "private_subscription_return_state/",
              )
            ) {
              state.operationTimeline.push({operation: "ledgerRead"});
              state.ledgerReads.push(reference.path);
              ledgerReadVersion = state.ledgerVersion;
              const ledgerSnapshot = state.ledgerDocument === undefined
                ? undefined
                : structuredClone(state.ledgerDocument);
              return {
                exists: ledgerSnapshot !== undefined,
                data: () => ledgerSnapshot === undefined
                  ? undefined
                  : structuredClone(ledgerSnapshot),
                ref: reference,
              };
            }
            if (reference.path.startsWith("private_owner_billing_states/")) {
              state.operationTimeline.push({operation: "ownerBillingRead"});
              state.ownerBillingReads.push(reference.path);
              ownerBillingReadVersion = state.ownerBillingVersion;
              const snapshot = state.ownerBillingDocument === undefined
                ? undefined
                : structuredClone(state.ownerBillingDocument);
              return {
                exists: snapshot !== undefined,
                data: () => snapshot === undefined
                  ? undefined
                  : structuredClone(snapshot),
                ref: reference,
              };
            }
            state.dbCalls.push({
              operation: "get",
              path: reference.path,
            });
            state.operationTimeline.push({operation: "accountRead"});
            if (state.accountLookupFailure !== null) {
              throw state.accountLookupFailure;
            }
            return {
              exists: state.accountExists,
              data: () => state.accountExists
                ? structuredClone(state.accountDocument)
                : undefined,
              ref: reference,
            };
          },
          create(reference, data) {
            pendingWrites.push({
              operation: "create",
              path: reference.path,
              data,
            });
          },
          update(reference, data) {
            pendingWrites.push({
              operation: "update",
              path: reference.path,
              data,
            });
          },
          set(reference, data) {
            if (
              reference.path.startsWith(
                "private_subscription_return_state/",
              )
            ) {
              pendingLedgerWrites.push({
                operation: "set",
                path: reference.path,
                data: structuredClone(data),
              });
              return;
            }
            if (reference.path.startsWith("private_owner_billing_states/")) {
              pendingOwnerBillingWrites.push({
                operation: "set",
                path: reference.path,
                data: structuredClone(data),
              });
              return;
            }
            pendingWrites.push({
              operation: "set",
              path: reference.path,
              data,
            });
          },
        });
        if (commit) {
          if (
            pendingLedgerWrites.length > 0 &&
            ledgerReadVersion !== state.ledgerVersion
          ) {
            return {conflict: true, result};
          }
          if (
            pendingOwnerBillingWrites.length > 0 &&
            ownerBillingReadVersion !== state.ownerBillingVersion
          ) {
            return {conflict: true, result};
          }
          for (const write of pendingLedgerWrites) {
            state.ledgerDocument = structuredClone(write.data);
            state.ledgerVersion += 1;
            state.ledgerWrites.push(write);
            state.operationTimeline.push({
              operation: "ledgerCommit",
              data: structuredClone(write.data),
            });
          }
          for (const write of pendingOwnerBillingWrites) {
            state.ownerBillingDocument = structuredClone(write.data);
            state.ownerBillingVersion += 1;
            state.ownerBillingWrites.push(write);
            state.operationTimeline.push({
              operation: "ownerBillingCommit",
              data: structuredClone(write.data),
            });
          }
          state.writes.push(...pendingWrites);
          state.transactionCommits += 1;
        }
        return {conflict: false, result};
      };
      const execute = async () => {
        if (behavior.type === "fail_before_callback") {
          throw behavior.error;
        }
        if (behavior.type === "retry") {
          await runAttempt(false);
          const retried = await runAttempt(true);
          return retried.result;
        }
        if (behavior.type === "fail_after_callback") {
          await runAttempt(false);
          throw behavior.error;
        }
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const outcome = await runAttempt(true);
          if (!outcome.conflict) {
            return outcome.result;
          }
        }
        throw new Error("Synthetic transaction retry limit exceeded");
      };
      return execute();
    },
  };

  class FakeStripe {
    constructor(secret, options) {
      state.stripeConstructorCalls.push({secret, options});
      if (state.stripeConstructorFailure !== null) {
        throw state.stripeConstructorFailure;
      }
      this.billingPortal = {
        sessions: {
          create: async (parameters) => {
            state.operationTimeline.push({operation: "portalCreate"});
            state.billingPortalCalls.push(
              structuredClone(parameters),
            );
            state.billingPortalStateSnapshots.push(
              structuredClone(state.ownerBillingDocument),
            );
            if (state.billingPortalFailure !== null) {
              throw state.billingPortalFailure;
            }
            return state.billingPortalResponse;
          },
        },
      };
      this.checkout = {
        sessions: {
          create: async (parameters, options) => {
            state.operationTimeline.push({operation: "checkoutCreate"});
            state.checkoutCalls.push(structuredClone(parameters));
            state.checkoutOptions.push(structuredClone(options));
            state.checkoutBillingStateSnapshots.push(
              structuredClone(state.ownerBillingDocument),
            );
            if (state.checkoutFailure !== null) {
              throw state.checkoutFailure;
            }
            if (state.checkoutBeforeResponse !== null) {
              await state.checkoutBeforeResponse();
            }
            return state.checkoutResponse;
          },
        },
      };
      this.subscriptions = {
        retrieve: async () => ({
          id: canaries.subscription,
          customer: canaries.customer,
          status: "active",
          metadata: {},
        }),
      };
      this.webhooks = {
        constructEvent: () => {
          throw new Error("webhook is outside this harness");
        },
      };
    }
  }

  const logger = {};
  for (const level of ["debug", "error", "info", "log", "warn"]) {
    logger[level] = (message, metadata) => {
      const entry = {level, message};
      if (metadata !== undefined) {
        entry.metadata = metadata;
      }
      state.logs.push(entry);
    };
  }

  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    switch (request) {
      case "node:crypto":
        return {
          ...realCrypto,
          createHash: (...arguments_) => {
            state.hashCalls += 1;
            state.operationTimeline.push({operation: "tokenHashed"});
            return realCrypto.createHash(...arguments_);
          },
          randomBytes: (size) => {
            state.randomBytesCalls += 1;
            state.operationTimeline.push({operation: "tokenGenerated"});
            const queued = state.randomBytesQueue.shift();
            if (queued !== undefined) {
              assert.equal(queued.length, size);
              return Buffer.from(queued);
            }
            return realCrypto.randomBytes(size);
          },
        };
      case "firebase-admin/app":
        return {initializeApp() {}};
      case "firebase-admin/firestore":
        return {
          FieldValue: {
            delete: () => ({operation: "delete"}),
            serverTimestamp: () => ({operation: "serverTimestamp"}),
          },
          Timestamp: {
            fromMillis: (milliseconds) => ({milliseconds}),
          },
          getFirestore: () => db,
        };
      case "firebase-admin/messaging":
        return {
          getMessaging: () => ({
            send: async () => "unused-message-id",
          }),
        };
      case "firebase-functions":
        return {logger};
      case "firebase-functions/params":
        return {
          defineSecret: (name) => ({
            value: () => {
              if (
                name === "STRIPE_SECRET_KEY" &&
                state.stripeSecretResolutionFailure !== null
              ) {
                throw state.stripeSecretResolutionFailure;
              }
              return canaries.apiSecret;
            },
          }),
          defineString: () => ({
            value: () => state.parameterValue,
          }),
        };
      case "firebase-functions/v2/firestore":
        return {
          onDocumentCreated: (...arguments_) =>
            arguments_[arguments_.length - 1],
          onDocumentDeleted: (...arguments_) =>
            arguments_[arguments_.length - 1],
          onDocumentWritten: (...arguments_) =>
            arguments_[arguments_.length - 1],
        };
      case "firebase-functions/v2/https":
        return {
          HttpsError: MockHttpsError,
          onCall: (...arguments_) =>
            arguments_[arguments_.length - 1],
          onRequest: (...arguments_) =>
            arguments_[arguments_.length - 1],
        };
      case "firebase-functions/v2/options":
        return {
          setGlobalOptions: (options) => {
            state.globalOptions.push({...options});
          },
        };
      case "stripe":
        return FakeStripe;
      default:
        return originalLoad.call(this, request, parent, isMain);
    }
  };

  let entryPoint;
  try {
    const entryPath = path.resolve(__dirname, "../lib/index.js");
    delete require.cache[entryPath];
    entryPoint = require(entryPath);
  } finally {
    Module._load = originalLoad;
  }

  return {
    claimBiteSaverSubscriptionReturnEvent:
      entryPoint.claimBiteSaverSubscriptionReturnEvent,
    createCheckoutSession: entryPoint.createCheckoutSession,
    createCustomerPortalSession:
      entryPoint.createCustomerPortalSession,
    createSubscriptionCheckoutSession:
      entryPoint.createSubscriptionCheckoutSession,
    entryPoint,
    listBiteSaverSubscriptionReturnEvents:
      entryPoint.listBiteSaverSubscriptionReturnEvents,
    redeemBiteSaverSubscriptionReturn:
      entryPoint.redeemBiteSaverSubscriptionReturn,
    reset,
    seedActiveBillingState,
    seedCheckoutBillingState,
    seedKnownBillingState,
    state,
  };
}

function authenticatedRequest(data = {
  returnProtocolVersion: 2,
  restaurantAccountDocumentId: canaries.uid,
}) {
  return {
    auth: {uid: canaries.uid},
    data,
  };
}

function deterministicReturnToken(seed) {
  return Buffer.alloc(32, seed).toString("base64url");
}

function hashReturnToken(token) {
  return realCrypto
    .createHash("sha256")
    .update(token, "ascii")
    .digest("hex");
}

function redeemRequest(returnToken, returnKind = "checkoutSuccess") {
  return authenticatedRequest({
    returnProtocolVersion: protocolVersion,
    restaurantAccountDocumentId: canaries.uid,
    returnToken,
    returnKind,
  });
}

function claimRequest(eventId, claimType) {
  return authenticatedRequest({
    returnProtocolVersion: protocolVersion,
    restaurantAccountDocumentId: canaries.uid,
    eventId,
    claimType,
  });
}

function assertToken(value) {
  assert.equal(typeof value, "string");
  assert.equal(value.length, 43);
  assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(value, /=/);
}

function tokenFromReturnUrl(value, expectedBaseUrl) {
  const parsed = new URL(value);
  const expected = new URL(expectedBaseUrl);
  assert.equal(parsed.protocol, expected.protocol);
  assert.equal(parsed.host, expected.host);
  assert.equal(parsed.pathname, expected.pathname);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(parsed.port, "");
  assert.equal(parsed.hash, "");
  assert.deepEqual([...parsed.searchParams.keys()], ["return_token"]);
  const values = parsed.searchParams.getAll("return_token");
  assert.equal(values.length, 1);
  assertToken(values[0]);
  return values[0];
}

function normalizeCheckoutPayload(payload, returnToken) {
  const normalized = structuredClone(payload);
  assert.equal(
    tokenFromReturnUrl(
      normalized.success_url,
      checkoutSuccessBaseUrl,
    ),
    returnToken,
  );
  assert.equal(
    tokenFromReturnUrl(
      normalized.cancel_url,
      checkoutCancelBaseUrl,
    ),
    returnToken,
  );
  normalized.success_url = checkoutSuccessBaseUrl;
  normalized.cancel_url = checkoutCancelBaseUrl;
  return normalized;
}

function assertCheckoutMetadata(payload) {
  const metadata = payload.metadata;
  assert.deepEqual(payload.subscription_data.metadata, metadata);
  assert.deepEqual(Object.keys(metadata).sort(), [
    "billingPlanName",
    "checkoutAttemptId",
    "contractVersion",
    "ownerUid",
    "restaurantAccountId",
    "source",
  ]);
  assert.equal(metadata.contractVersion, ownerBillingMetadataVersion);
  assert.equal(metadata.ownerUid, canaries.uid);
  assert.equal(metadata.restaurantAccountId, canaries.uid);
  assert.match(
    metadata.checkoutAttemptId,
    /^attempt_[A-Za-z0-9_-]{43}$/,
  );
  assert.equal(metadata.billingPlanName, "coupon_monthly");
  assert.equal(metadata.source, "bitesaver_subscription");
  return metadata;
}

function assertCheckoutIdempotency(state, callIndex, metadata) {
  assert.deepEqual(state.checkoutOptions[callIndex], {
    idempotencyKey: ownerBillingStripeIdempotencyKey({
      ownerUid: canaries.uid,
      checkoutAttemptId: metadata.checkoutAttemptId,
    }),
  });
  assert.match(
    state.checkoutOptions[callIndex].idempotencyKey,
    /^bsco_[a-f0-9]{64}$/,
  );
}

function historicalCreateCheckoutPayload({includeTrial, metadata}) {
  const subscriptionData = {
    metadata,
  };
  if (includeTrial) {
    subscriptionData.trial_period_days = 60;
  }
  return {
    mode: "subscription",
    line_items: [
      {
        price: stripePriceId,
        quantity: 1,
      },
    ],
    subscription_data: subscriptionData,
    metadata,
    client_reference_id: canaries.uid,
    success_url: checkoutSuccessBaseUrl,
    cancel_url: checkoutCancelBaseUrl,
  };
}

function historicalSubscriptionCheckoutPayload(metadata) {
  return {
    mode: "subscription",
    line_items: [
      {
        price: stripePriceId,
        quantity: 1,
      },
    ],
    success_url: checkoutSuccessBaseUrl,
    cancel_url: checkoutCancelBaseUrl,
    client_reference_id: canaries.uid,
    metadata,
    subscription_data: {
      metadata,
    },
  };
}

function assertNoWritesOrSensitiveLogs(state, extraCanaries = []) {
  assert.deepEqual(state.writes, []);
  const serializedLogs = JSON.stringify(state.logs);
  for (const value of [
    ...Object.values(canaries),
    ...extraCanaries,
  ]) {
    assert.equal(serializedLogs.includes(value), false, value);
  }
  for (const entry of state.logs) {
    if (entry.metadata !== undefined) {
      assert.deepEqual(
        Object.keys(entry.metadata).sort(),
        ["errorCategory", "stage"],
      );
    }
  }
}

function exportedConstants(source) {
  return [
    ...source.matchAll(/\bexport const ([A-Za-z0-9_]+)\b/g),
  ].map((match) => match[1]).sort();
}

const harness = createHarness();
const {
  buildOwnerBillingStateDocument,
  classifyOwnerBillingRawStripeStatus,
} = require("../lib/owner_billing_state_contract.js");
const {
  deriveOwnerBillingReturnToken,
  ownerBillingStripeIdempotencyKey,
} = require("../lib/owner_billing_lifecycle.js");
const {
  reserveSubscriptionReturnContext,
} = require("../lib/subscription_return_ledger.js");

test.beforeEach(() => {
  harness.reset();
});

test("runtime, region, secret bindings, exports, production caller, and webhook wiring remain stable", () => {
  const repositoryRoot = path.resolve(__dirname, "../..");
  const source = readFileSync(
    path.join(repositoryRoot, "functions/src/index.ts"),
    "utf8",
  );
  const baseSource = execFileSync(
    "git",
    ["show", "09d2046:functions/src/index.ts"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
  const packageJson = JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "functions/package.json"),
      "utf8",
    ),
  );
  const flutterCheckoutSource = readFileSync(
    path.join(
      repositoryRoot,
      "lib/services/subscription_checkout_service.dart",
    ),
    "utf8",
  );

  assert.deepEqual(harness.state.globalOptions, [
    {region: "us-central1", maxInstances: 10},
  ]);
  assert.equal(packageJson.engines.node, "24");
  assert.deepEqual(
    exportedConstants(source),
    [
      ...exportedConstants(baseSource),
      "claimBiteSaverSubscriptionReturnEvent",
      "updateAdminRestaurantQrPreparation",
      "maintainAdminRestaurantQrPreparationFromBiteScoreUnclaim",
      "applyRatingAdminDishSuggestionGroup",
      "getRatingDestructiveOperationStatus",
      "listCouponAdminCouponsPage",
      "listCouponAdminInviteHistoryPage",
      "listCouponAdminQueuePage",
      "listRatingAdminDirectoryPage",
      "listRatingAdminDishSuggestionsPage",
      "listRatingAdminContributionLedgerPage",
      "listRatingAdminDestructiveOperationsPage",
      "listRatingAdminInviteHistoryPage",
      "listRatingAdminQueuePage",
      "listRatingAdminUserPointsPage",
      "listBiteSaverSubscriptionReturnEvents",
      "markAdminRestaurantQrBatchPrepared",
      "maintainBiteSaverCouponOfferSearchIndex",
      "maintainBiteSaverDailySpecialSearchIndex",
      "maintainBiteSaverRestaurantSearchIndex",
      "maintainAdminUserDirectoryFromBiteScoreRestaurant",
      "maintainAdminUserDirectoryFromDishEditProposal",
      "maintainAdminUserDirectoryFromDishReport",
      "maintainAdminUserDirectoryFromDishReview",
      "maintainAdminUserDirectoryFromDuplicateRestaurantReport",
      "maintainAdminUserDirectoryFromPublicReviewerProfile",
      "maintainAdminUserDirectoryFromRestaurantAccount",
      "maintainAdminUserDirectoryFromRestaurantClaimRequest",
      "maintainAdminUserDirectoryFromRestaurantReport",
      "maintainAdminUserDirectoryFromReviewFeedbackVote",
      "maintainAdminUserDirectoryFromReviewReport",
      "maintainAdminUserDirectoryFromUserProfile",
      "maintainBiteScoreDishSearchIndex",
      "maintainBiteScoreDishSearchIndexFromAggregate",
      "maintainBiteScoreRestaurantSearchIndex",
      "maintainDishEditProposalPrivateState",
      "processPrivateSearchIndexJob",
      "processDishProposalResolutionWork",
      "processRatingDestructiveOperationWork",
      "prepareAdminRestaurantQrBatch",
      "prepareAdminRestaurantMailingLabelBatch",
      "redeemBiteSaverSubscriptionReturn",
      "rejectRatingAdminDishSuggestionGroup",
      "searchCouponAdminRestaurantsPage",
      "searchAdminLinkRestaurantsPage",
      "searchRatingAdminRestaurantsPage",
      "searchRatingAdminUsersPage",
      "startRatingDishDelete",
      "startRatingDishMerge",
      "startRatingRestaurantDelete",
      "startRatingRestaurantMerge",
    ].sort(),
  );
  for (const exportName of [
    "createCheckoutSession",
    "createSubscriptionCheckoutSession",
    "createCustomerPortalSession",
    "claimBiteSaverSubscriptionReturnEvent",
    "listBiteSaverSubscriptionReturnEvents",
    "redeemBiteSaverSubscriptionReturn",
    "stripeWebhook",
  ]) {
    assert.equal(typeof harness.entryPoint[exportName], "function");
  }
  assert.match(
    source,
    /export const createCheckoutSession = onCall\(\s*\{\s*secrets: \[stripeSecret\]/,
  );
  assert.match(
    source,
    /export const createSubscriptionCheckoutSession = onCall\(\s*\{\s*secrets: \[stripeSecretKey\]/,
  );
  assert.match(
    source,
    /export const createCustomerPortalSession = onCall\(\s*\{\s*secrets: \[stripeSecret\]/,
  );
  assert.match(
    flutterCheckoutSource,
    /callableName: 'createCheckoutSession'/,
  );
  assert.doesNotMatch(
    flutterCheckoutSource,
    /callableName: 'createSubscriptionCheckoutSession'/,
  );

  const webhookStart = source.indexOf("export const stripeWebhook");
  const webhookEnd = source.indexOf(
    "export const processProximityPushRequest",
    webhookStart,
  );
  assert.ok(webhookStart >= 0 && webhookEnd > webhookStart);
  const webhookSource = source.slice(webhookStart, webhookEnd);
  assert.match(
    webhookSource,
    /await bindCompletedCheckoutSession\(\{session, subscription\}\)/,
  );
  assert.match(
    webhookSource,
    /case "customer\.subscription\.paused":/,
  );
  assert.match(
    webhookSource,
    /case "customer\.subscription\.resumed":/,
  );
  assert.match(
    webhookSource,
    /await syncRestaurantSubscriptionFromStripe\(subscription, event\)/,
  );
});

test("all three callables preserve authentication before protocol validation", async () => {
  for (const callable of [
    harness.createCheckoutSession,
    harness.createSubscriptionCheckoutSession,
    harness.createCustomerPortalSession,
  ]) {
    harness.reset();
    await assert.rejects(
      () => callable({auth: null, data: {returnProtocolVersion: 2}}),
      (error) => {
        assert.ok(error instanceof MockHttpsError);
        assert.equal(error.code, "unauthenticated");
        assert.equal(error.message, "Authentication is required.");
        return true;
      },
    );
    assert.deepEqual(harness.state.dbCalls, []);
    assert.deepEqual(harness.state.checkoutCalls, []);
    assert.deepEqual(harness.state.billingPortalCalls, []);
    assert.deepEqual(harness.state.stripeConstructorCalls, []);
    assertNoWritesOrSensitiveLogs(harness.state);
  }
});

test("all three callables reject legacy, unknown, fractional, string, and unknown-field requests before access", async () => {
  const invalidData = [
    undefined,
    null,
    {},
    {returnProtocolVersion: "2"},
    {returnProtocolVersion: 2.5},
    {returnProtocolVersion: -2},
    {returnProtocolVersion: 1},
    {returnProtocolVersion: 3},
    {returnProtocolVersion: 2, unknown: true},
  ];

  for (const callable of [
    harness.createCheckoutSession,
    harness.createSubscriptionCheckoutSession,
    harness.createCustomerPortalSession,
  ]) {
    for (const data of invalidData) {
      harness.reset();
      await assert.rejects(
        () =>
          callable({
            auth: {uid: canaries.uid},
            data,
          }),
        (error) => {
          assert.ok(error instanceof MockHttpsError);
          assert.equal(error.code, "failed-precondition");
          assert.equal(error.message, updateRequiredMessage);
          return true;
        },
      );
      assert.deepEqual(harness.state.dbCalls, []);
      assert.deepEqual(harness.state.checkoutCalls, []);
      assert.deepEqual(harness.state.billingPortalCalls, []);
      assert.deepEqual(harness.state.stripeConstructorCalls, []);
      assertNoWritesOrSensitiveLogs(harness.state);
    }
  }
});

test("production createCheckoutSession preserves its complete trial-eligible Stripe payload except tokenized URLs", async () => {
  const result = await harness.createCheckoutSession(
    authenticatedRequest(),
  );

  assert.equal(harness.state.checkoutCalls.length, 1);
  assertToken(result.returnToken);
  assert.deepEqual(Object.keys(result).sort(), [
    "returnProtocolVersion",
    "returnToken",
    "url",
  ]);
  assert.equal(result.url, canaries.checkoutUrl);
  assert.equal(result.returnProtocolVersion, 2);
  const metadata = assertCheckoutMetadata(
    harness.state.checkoutCalls[0],
  );
  assertCheckoutIdempotency(harness.state, 0, metadata);
  assert.deepEqual(
    normalizeCheckoutPayload(
      harness.state.checkoutCalls[0],
      result.returnToken,
    ),
    historicalCreateCheckoutPayload({
      includeTrial: true,
      metadata,
    }),
  );
  assert.equal(
    harness.state.checkoutCalls[0]
      .subscription_data.trial_period_days,
    60,
  );
  assert.equal(
    Object.hasOwn(harness.state.checkoutCalls[0], "customer"),
    false,
  );
  assert.equal(
    JSON.stringify(
      harness.state.checkoutCalls[0].subscription_data.metadata,
    ).includes(result.returnToken),
    false,
  );
  assert.equal(
    JSON.stringify(harness.state.checkoutCalls[0].metadata)
      .includes(result.returnToken),
    false,
  );
  assert.equal(
    harness.state.checkoutCalls[0].client_reference_id
      .includes(result.returnToken),
    false,
  );
  assert.deepEqual(harness.state.dbCalls, [
    {
      operation: "get",
      path: `restaurant_accounts/${canaries.uid}`,
    },
  ]);
  assert.deepEqual(harness.state.logs, []);
  assert.equal(
    harness.state.ownerBillingDocument.lifecycleState,
    "checkout_pending",
  );
  assert.equal(
    harness.state.ownerBillingDocument.billingPosture,
    "blocking",
  );
  assert.equal(
    harness.state.ownerBillingDocument.checkoutAttemptId,
    metadata.checkoutAttemptId,
  );
  assert.equal(
    harness.state.ownerBillingDocument.checkoutSessionId,
    canaries.checkoutSession,
  );
  assert.equal(
    harness.state.ownerBillingDocument.stripeCustomerId,
    canaries.customer,
  );
  assertNoWritesOrSensitiveLogs(harness.state, [result.returnToken]);
});

test("production createCheckoutSession preserves used-trial recurring billing without reintroducing a trial", async () => {
  harness.state.accountDocument.hasUsedTrial = true;

  const result = await harness.createCheckoutSession(
    authenticatedRequest(),
  );

  assert.equal(harness.state.checkoutCalls.length, 1);
  const metadata = assertCheckoutMetadata(
    harness.state.checkoutCalls[0],
  );
  assertCheckoutIdempotency(harness.state, 0, metadata);
  assert.deepEqual(
    normalizeCheckoutPayload(
      harness.state.checkoutCalls[0],
      result.returnToken,
    ),
    historicalCreateCheckoutPayload({
      includeTrial: false,
      metadata,
    }),
  );
  assert.equal(
    Object.hasOwn(
      harness.state.checkoutCalls[0].subscription_data,
      "trial_period_days",
    ),
    false,
  );
  assert.equal(harness.state.checkoutCalls[0].mode, "subscription");
  assert.equal(
    harness.state.checkoutCalls[0].line_items[0].price,
    stripePriceId,
  );
  assert.deepEqual(harness.state.logs, []);
  assertNoWritesOrSensitiveLogs(harness.state, [result.returnToken]);
});

test("compatibility createSubscriptionCheckoutSession tokenizes while preserving its exact historical non-return payload", async () => {
  const result =
    await harness.createSubscriptionCheckoutSession(
      authenticatedRequest(),
    );

  assert.equal(harness.state.checkoutCalls.length, 1);
  assertToken(result.returnToken);
  assert.deepEqual(Object.keys(result).sort(), [
    "checkoutUrl",
    "returnProtocolVersion",
    "returnToken",
  ]);
  assert.equal(result.checkoutUrl, canaries.checkoutUrl);
  assert.equal(result.returnProtocolVersion, 2);
  const metadata = assertCheckoutMetadata(
    harness.state.checkoutCalls[0],
  );
  assertCheckoutIdempotency(harness.state, 0, metadata);
  assert.deepEqual(
    normalizeCheckoutPayload(
      harness.state.checkoutCalls[0],
      result.returnToken,
    ),
    historicalSubscriptionCheckoutPayload(metadata),
  );
  assert.equal(
    Object.hasOwn(
      harness.state.checkoutCalls[0].subscription_data,
      "trial_period_days",
    ),
    false,
  );
  assert.deepEqual(harness.state.dbCalls, [
    {
      operation: "get",
      path: `restaurant_accounts/${canaries.uid}`,
    },
  ]);
  assert.deepEqual(harness.state.logs, []);
  assertNoWritesOrSensitiveLogs(harness.state, [result.returnToken]);
});

test("createCustomerPortalSession preserves customer and configuration with only a tokenized canonical return URL", async () => {
  const originalBilling = harness.seedActiveBillingState();
  const result = await harness.createCustomerPortalSession(
    authenticatedRequest(),
  );

  assertToken(result.returnToken);
  assert.deepEqual(Object.keys(result).sort(), [
    "returnProtocolVersion",
    "returnToken",
    "url",
  ]);
  assert.equal(result.url, canaries.portalUrl);
  assert.equal(result.returnProtocolVersion, 2);
  assert.equal(harness.state.billingPortalCalls.length, 1);
  const portalPayload =
    structuredClone(harness.state.billingPortalCalls[0]);
  assert.equal(
    tokenFromReturnUrl(
      portalPayload.return_url,
      portalBaseUrl,
    ),
    result.returnToken,
  );
  portalPayload.return_url = portalBaseUrl;
  assert.deepEqual(portalPayload, {
    customer: canaries.customer,
    return_url: portalBaseUrl,
  });
  assert.equal(
    JSON.stringify(portalPayload).includes(result.returnToken),
    false,
  );
  assert.deepEqual(harness.state.dbCalls, [
    {
      operation: "get",
      path: `restaurant_accounts/${canaries.uid}`,
    },
  ]);
  assert.deepEqual(harness.state.logs, []);
  assert.deepEqual(
    harness.state.billingPortalStateSnapshots,
    [originalBilling],
  );
  assert.deepEqual(harness.state.ownerBillingDocument, originalBilling);
  assertNoWritesOrSensitiveLogs(harness.state, [result.returnToken]);
});

test("an exact Checkout retry reuses one attempt, token, payload, and Stripe idempotency identity", async () => {
  const first = await harness.createCheckoutSession(
    authenticatedRequest(),
  );
  const second = await harness.createCheckoutSession(
    authenticatedRequest(),
  );

  assert.equal(first.returnToken, second.returnToken);
  assert.deepEqual(harness.state.checkoutCalls[1], {
    ...harness.state.checkoutCalls[0],
  });
  assert.deepEqual(
    harness.state.checkoutOptions[1],
    harness.state.checkoutOptions[0],
  );
  assert.equal(
    harness.state.checkoutCalls[0].metadata.checkoutAttemptId,
    harness.state.checkoutCalls[1].metadata.checkoutAttemptId,
  );
  assert.equal(harness.state.randomBytesCalls, 1);
  assert.equal(
    tokenFromReturnUrl(
      harness.state.checkoutCalls[1].success_url,
      checkoutSuccessBaseUrl,
    ),
    first.returnToken,
  );
  assert.equal(
    Object.keys(harness.state.ledgerDocument.contexts).length,
    1,
  );
  assertNoWritesOrSensitiveLogs(harness.state, [first.returnToken]);
});

test("an exact retry after an uncertain Stripe failure reuses the same attempt and resolves it without a second independent identity", async () => {
  harness.state.checkoutFailure = {
    name: "StripeAPIError",
    type: "StripeAPIError",
    message: canaries.rawError,
  };
  await assert.rejects(
    () => harness.createCheckoutSession(authenticatedRequest()),
    (error) => error instanceof MockHttpsError && error.code === "internal",
  );
  const firstPayload = structuredClone(harness.state.checkoutCalls[0]);
  const firstOptions = structuredClone(harness.state.checkoutOptions[0]);
  const firstToken = tokenFromReturnUrl(
    firstPayload.success_url,
    checkoutSuccessBaseUrl,
  );
  assert.equal(
    harness.state.ownerBillingDocument.lifecycleState,
    "unknown",
  );

  harness.state.checkoutFailure = null;
  const recovered = await harness.createCheckoutSession(
    authenticatedRequest(),
  );

  assert.equal(recovered.returnToken, firstToken);
  assert.deepEqual(harness.state.checkoutCalls, [
    firstPayload,
    firstPayload,
  ]);
  assert.deepEqual(harness.state.checkoutOptions, [
    firstOptions,
    firstOptions,
  ]);
  assert.equal(harness.state.randomBytesCalls, 1);
  assert.equal(
    harness.state.ownerBillingDocument.lifecycleState,
    "checkout_pending",
  );
  assert.equal(
    harness.state.ownerBillingDocument.checkoutSessionId,
    canaries.checkoutSession,
  );
  assert.equal(
    harness.state.ownerBillingDocument.stripeCustomerId,
    canaries.customer,
  );
  assert.equal(
    harness.state.ledgerDocument.contexts[hashReturnToken(firstToken)].ready,
    true,
  );
});

test("a different Checkout request conflicts with a pending attempt before a second Stripe call", async () => {
  const first = await harness.createCheckoutSession(
    authenticatedRequest(),
  );
  const firstAttemptId =
    harness.state.ownerBillingDocument.checkoutAttemptId;

  await assert.rejects(
    () => harness.createSubscriptionCheckoutSession(
      authenticatedRequest(),
    ),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      assert.equal(error.message, "Could not start Stripe Checkout.");
      return true;
    },
  );

  assert.equal(harness.state.checkoutCalls.length, 1);
  assert.equal(harness.state.randomBytesCalls, 1);
  assert.equal(
    harness.state.ownerBillingDocument.checkoutAttemptId,
    firstAttemptId,
  );
  assert.equal(
    tokenFromReturnUrl(
      harness.state.checkoutCalls[0].success_url,
      checkoutSuccessBaseUrl,
    ),
    first.returnToken,
  );
});

test("every potentially billable known Stripe status blocks both Checkout writers before Stripe", async () => {
  for (const rawStripeStatus of [
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "incomplete",
    "paused",
  ]) {
    for (const callable of [
      harness.createCheckoutSession,
      harness.createSubscriptionCheckoutSession,
    ]) {
      harness.reset();
      harness.seedKnownBillingState(rawStripeStatus);

      await assert.rejects(
        () => callable(authenticatedRequest()),
        (error) => error instanceof MockHttpsError,
      );

      assert.deepEqual(harness.state.checkoutCalls, []);
      assert.deepEqual(harness.state.checkoutOptions, []);
      assert.equal(harness.state.randomBytesCalls, 0);
      assert.deepEqual(harness.state.ownerBillingWrites, []);
      assert.deepEqual(harness.state.ledgerWrites, []);
    }
  }
});

test("exact terminal known Stripe statuses start one fresh pending attempt through both Checkout writers", async () => {
  const checkoutWriters = [
    {
      callable: harness.createCheckoutSession,
      responseUrlField: "url",
    },
    {
      callable: harness.createSubscriptionCheckoutSession,
      responseUrlField: "checkoutUrl",
    },
  ];
  for (const rawStripeStatus of [
    "canceled",
    "incomplete_expired",
  ]) {
    for (const writer of checkoutWriters) {
      harness.reset();
      const terminalState =
        harness.seedKnownBillingState(rawStripeStatus);

      const result = await writer.callable(authenticatedRequest());

      assert.equal(result[writer.responseUrlField], canaries.checkoutUrl);
      assert.equal(harness.state.checkoutCalls.length, 1);
      assert.equal(harness.state.checkoutOptions.length, 1);
      assert.equal(harness.state.randomBytesCalls, 1);
      assert.equal(
        harness.state.checkoutCalls[0].customer,
        terminalState.stripeCustomerId,
      );
      const metadata = assertCheckoutMetadata(
        harness.state.checkoutCalls[0],
      );
      assertCheckoutIdempotency(harness.state, 0, metadata);
      assert.notEqual(
        metadata.checkoutAttemptId,
        terminalState.checkoutAttemptId,
      );
      assert.equal(
        harness.state.checkoutBillingStateSnapshots[0].lifecycleState,
        "checkout_pending",
      );
      assert.equal(
        harness.state.checkoutBillingStateSnapshots[0].rawStripeStatus,
        null,
      );
      assert.equal(
        harness.state.checkoutBillingStateSnapshots[0]
          .stripeSubscriptionId,
        null,
      );
      assert.equal(
        harness.state.ownerBillingDocument.lifecycleState,
        "checkout_pending",
      );
      assert.equal(
        harness.state.ownerBillingDocument.checkoutAttemptId,
        metadata.checkoutAttemptId,
      );
      assert.equal(
        harness.state.ownerBillingDocument.checkoutSessionId,
        canaries.checkoutSession,
      );
      assert.equal(
        harness.state.ownerBillingDocument.stripeCustomerId,
        canaries.customer,
      );
    }
  }
});

test("the Customer Portal requires a known subscription and an exact current customer", async () => {
  const unavailableFixtures = [
    () => {},
    () => harness.seedCheckoutBillingState("checkout_pending"),
    () => harness.seedCheckoutBillingState("unknown"),
    () => {
      harness.seedActiveBillingState();
      harness.state.accountDocument.stripeCustomerId = "cus_mismatch";
    },
  ];

  for (const configure of unavailableFixtures) {
    harness.reset();
    configure();
    await assert.rejects(
      () => harness.createCustomerPortalSession(authenticatedRequest()),
      (error) => {
        assert.ok(error instanceof MockHttpsError);
        assert.equal(error.code, "internal");
        assert.equal(
          error.message,
          "Unable to open subscription management right now.",
        );
        return true;
      },
    );
    assert.deepEqual(harness.state.billingPortalCalls, []);
    assert.equal(harness.state.randomBytesCalls, 0);
    assert.deepEqual(harness.state.ledgerWrites, []);
  }
});

test("Checkout failures expose only fixed callable errors and sanitized token-free log metadata", async () => {
  for (const fixture of [
    {
      callable: harness.createCheckoutSession,
      expectedMessage: "Failed to create checkout session",
      expectedLog: "Stripe Checkout session creation failed",
    },
    {
      callable: harness.createSubscriptionCheckoutSession,
      expectedMessage: "Could not start Stripe Checkout.",
      expectedLog:
        "Stripe subscription Checkout session creation failed",
    },
  ]) {
    harness.reset();
    const rawError = {
      name: "StripeAPIError",
      type: "StripeAPIError",
      message: canaries.rawError,
      stack: canaries.stack,
      customer: canaries.customer,
      subscription: canaries.subscription,
      paymentIntent: canaries.paymentIntent,
      uid: canaries.uid,
    };
    harness.state.checkoutFailure = rawError;

    await assert.rejects(
      () => fixture.callable(authenticatedRequest()),
      (error) => {
        assert.ok(error instanceof MockHttpsError);
        assert.equal(error.code, "internal");
        assert.equal(error.message, fixture.expectedMessage);
        for (const value of Object.values(canaries)) {
          assert.equal(error.message.includes(value), false, value);
        }
        return true;
      },
    );

    assert.equal(harness.state.checkoutCalls.length, 1);
    const returnToken = tokenFromReturnUrl(
      harness.state.checkoutCalls[0].success_url,
      checkoutSuccessBaseUrl,
    );
    assert.deepEqual(harness.state.logs, [
      {
        level: "error",
        message: fixture.expectedLog,
        metadata: {
          stage: "checkout_session_creation",
          errorCategory: "stripe_api_error",
        },
      },
    ]);
    assertNoWritesOrSensitiveLogs(harness.state, [returnToken]);
  }
});

test("Portal failures expose no return token, customer, URL, or raw provider detail", async () => {
  harness.seedActiveBillingState();
  harness.state.billingPortalFailure = {
    name: "StripeAPIError",
    type: "StripeAPIError",
    message: canaries.rawError,
    stack: canaries.stack,
    customer: canaries.customer,
    portalUrl: canaries.portalUrl,
    uid: canaries.uid,
  };

  await assert.rejects(
    () => harness.createCustomerPortalSession(authenticatedRequest()),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      assert.equal(
        error.message,
        "Unable to open subscription management right now.",
      );
      for (const value of Object.values(canaries)) {
        assert.equal(error.message.includes(value), false, value);
      }
      return true;
    },
  );

  assert.equal(harness.state.billingPortalCalls.length, 1);
  const returnToken = tokenFromReturnUrl(
    harness.state.billingPortalCalls[0].return_url,
    portalBaseUrl,
  );
  assert.deepEqual(harness.state.logs, [
    {
      level: "error",
      message: "Stripe Customer Portal session creation failed",
      metadata: {
        stage: "customer_portal_session_creation",
        errorCategory: "stripe_api_error",
      },
    },
  ]);
  assertNoWritesOrSensitiveLogs(harness.state, [returnToken]);
});

test("missing Stripe Checkout URL fails safely without exposing the generated token", async () => {
  harness.state.checkoutResponse = {url: null};

  await assert.rejects(
    () => harness.createCheckoutSession(authenticatedRequest()),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      assert.equal(error.message, "Failed to create checkout session");
      return true;
    },
  );

  assert.equal(harness.state.checkoutCalls.length, 1);
  const returnToken = tokenFromReturnUrl(
    harness.state.checkoutCalls[0].success_url,
    checkoutSuccessBaseUrl,
  );
  assert.deepEqual(harness.state.logs, [
    {
      level: "error",
      message: "Stripe Checkout session creation failed",
      metadata: {
        stage: "checkout_session_creation",
        errorCategory: "unknown_error",
      },
    },
  ]);
  assertNoWritesOrSensitiveLogs(harness.state, [returnToken]);
});

test("production Checkout account lookup failures are sanitized and create no Stripe session or write", async () => {
  harness.state.accountLookupFailure = {
    name: "FirestoreError",
    code: "unavailable",
    message: canaries.document,
    stack: canaries.stack,
    uid: canaries.uid,
  };

  await assert.rejects(
    () => harness.createCheckoutSession(authenticatedRequest()),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      assert.equal(error.message, "Failed to create checkout session");
      assert.equal(error.message.includes(canaries.document), false);
      return true;
    },
  );

  assert.deepEqual(harness.state.checkoutCalls, []);
  assert.deepEqual(harness.state.logs, [
    {
      level: "error",
      message: "Stripe Checkout session creation failed",
      metadata: {
        stage: "checkout_session_creation",
        errorCategory: "firestore_error",
      },
    },
  ]);
  assertNoWritesOrSensitiveLogs(harness.state);
});

test("production session commits pending billing and return state before Stripe", async () => {
  const response = await harness.createCheckoutSession(
    authenticatedRequest(),
  );
  const tokenHash = hashReturnToken(response.returnToken);
  const operations = harness.state.operationTimeline.map(
    (entry) => entry.operation,
  );
  const checkoutIndex = operations.indexOf("checkoutCreate");
  for (const requiredCommit of [
    "ownerBillingCommit",
    "ledgerCommit",
  ]) {
    assert.ok(operations.indexOf(requiredCommit) < checkoutIndex);
  }
  assert.ok(operations.indexOf("accountRead") < checkoutIndex);
  assert.ok(operations.indexOf("ownerBillingRead") < checkoutIndex);
  assert.ok(operations.indexOf("ledgerRead") < checkoutIndex);
  assert.equal(
    harness.state.checkoutBillingStateSnapshots[0].lifecycleState,
    "checkout_pending",
  );
  assert.equal(
    harness.state.checkoutBillingStateSnapshots[0].checkoutSessionId,
    null,
  );
  const commits = harness.state.operationTimeline.filter(
    (entry) => entry.operation === "ledgerCommit",
  );
  assert.equal(commits.length, 2);
  assert.equal(commits[0].data.contexts[tokenHash].ready, false);
  assert.equal(commits[1].data.contexts[tokenHash].ready, true);
  assert.equal(
    harness.state.ownerBillingDocument.lifecycleState,
    "checkout_pending",
  );
  assert.equal(
    harness.state.ownerBillingDocument.checkoutSessionId,
    canaries.checkoutSession,
  );
  assert.equal(
    harness.state.ownerBillingDocument.stripeCustomerId,
    canaries.customer,
  );
  assert.equal(
    JSON.stringify(harness.state.ledgerDocument).includes(
      response.returnToken,
    ),
    false,
  );
  assert.deepEqual(harness.state.writes, []);
});

test("missing, mismatched, or cross-document accounts generate no token and read no private state", async () => {
  const fixtures = [
    () => {
      harness.state.accountExists = false;
    },
    () => {
      harness.state.accountDocument.uid = "different-owner";
    },
  ];
  for (const configure of fixtures) {
    harness.reset();
    configure();
    await assert.rejects(
      () => harness.createCheckoutSession(authenticatedRequest()),
      (error) => {
        assert.ok(error instanceof MockHttpsError);
        assert.equal(error.code, "permission-denied");
        return true;
      },
    );
    assert.equal(harness.state.randomBytesCalls, 0);
    assert.equal(harness.state.hashCalls, 0);
    assert.deepEqual(harness.state.ledgerReads, []);
    assert.deepEqual(harness.state.ledgerWrites, []);
    assert.deepEqual(harness.state.checkoutCalls, []);
    assert.deepEqual(
      harness.state.operationTimeline.map((entry) => entry.operation),
      ["accountRead"],
    );
  }

  harness.reset();
  await assert.rejects(
    () => harness.createCheckoutSession({
      auth: {uid: canaries.uid},
      data: {
        returnProtocolVersion: protocolVersion,
        restaurantAccountDocumentId: "sibling-document",
      },
    }),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "permission-denied");
      return true;
    },
  );
  assert.equal(harness.state.randomBytesCalls, 0);
  assert.equal(harness.state.hashCalls, 0);
  assert.deepEqual(harness.state.operationTimeline, []);
});

test("token-hash collision retries with a fresh authorized candidate and one Stripe session", async () => {
  const firstAttemptId =
    `attempt_${Buffer.alloc(32, 21).toString("base64url")}`;
  const secondAttemptId =
    `attempt_${Buffer.alloc(32, 22).toString("base64url")}`;
  const firstToken = deriveOwnerBillingReturnToken({
    ownerUid: canaries.uid,
    checkoutAttemptId: firstAttemptId,
  });
  const secondToken = deriveOwnerBillingReturnToken({
    ownerUid: canaries.uid,
    checkoutAttemptId: secondAttemptId,
  });
  const firstHash = hashReturnToken(firstToken);
  const now = Date.now();
  harness.state.ledgerDocument = reserveSubscriptionReturnContext({
    rawState: undefined,
    ownerUid: canaries.uid,
    restaurantAccountDocumentId: canaries.uid,
    tokenHash: firstHash,
    family: "checkout",
    nowEpochMs: now,
  });
  harness.state.ledgerVersion += 1;
  harness.state.randomBytesQueue = [
    Buffer.alloc(32, 21),
    Buffer.alloc(32, 22),
  ];

  const response = await harness.createCheckoutSession(
    authenticatedRequest(),
  );
  assert.equal(response.returnToken, secondToken);
  assert.equal(harness.state.randomBytesCalls, 2);
  assert.equal(harness.state.checkoutCalls.length, 1);
  assert.ok(harness.state.ledgerDocument.contexts[firstHash]);
  assert.equal(
    harness.state.ledgerDocument.contexts[
      hashReturnToken(secondToken)
    ].ready,
    true,
  );
  assert.equal(
    tokenFromReturnUrl(
      harness.state.checkoutCalls[0].success_url,
      checkoutSuccessBaseUrl,
    ),
    secondToken,
  );
});

test("simultaneous duplicate redemption creates exactly one durable event", async () => {
  const session = await harness.createCheckoutSession(
    authenticatedRequest(),
  );
  const beforeWrites = harness.state.ledgerWrites.length;
  const beforeAttempts = harness.state.transactionCallbackAttempts;
  const [first, second] = await Promise.all([
    harness.redeemBiteSaverSubscriptionReturn(
      redeemRequest(session.returnToken),
    ),
    harness.redeemBiteSaverSubscriptionReturn(
      redeemRequest(session.returnToken),
    ),
  ]);

  assert.deepEqual(
    [first.created, second.created].sort(),
    [false, true],
  );
  assert.equal(first.eventId, "1");
  assert.equal(second.eventId, "1");
  assert.equal(harness.state.ledgerDocument.nextEventId, 2);
  assert.deepEqual(Object.keys(harness.state.ledgerDocument.events), ["1"]);
  assert.equal(
    harness.state.ledgerDocument.contexts[
      hashReturnToken(session.returnToken)
    ].consumedEventId,
    "1",
  );
  assert.equal(harness.state.ledgerWrites.length, beforeWrites + 1);
  assert.equal(
    harness.state.transactionCallbackAttempts,
    beforeAttempts + 3,
  );
  assert.deepEqual(harness.state.writes, []);
});

test("transaction retry discards the first redemption attempt without partial state", async () => {
  const session = await harness.createCheckoutSession(
    authenticatedRequest(),
  );
  const beforeAttempts = harness.state.transactionCallbackAttempts;
  const beforeCommits = harness.state.transactionCommits;
  const beforeWrites = harness.state.ledgerWrites.length;
  harness.state.transactionBehaviors.push({type: "retry"});

  const response = await harness.redeemBiteSaverSubscriptionReturn(
    redeemRequest(session.returnToken),
  );
  assert.deepEqual(response, {
    returnProtocolVersion: protocolVersion,
    created: true,
    eventId: "1",
    returnKind: "checkoutSuccess",
  });
  assert.equal(
    harness.state.transactionCallbackAttempts,
    beforeAttempts + 2,
  );
  assert.equal(harness.state.transactionCommits, beforeCommits + 1);
  assert.equal(harness.state.ledgerWrites.length, beforeWrites + 1);
  assert.equal(harness.state.ledgerDocument.nextEventId, 2);
  assert.deepEqual(Object.keys(harness.state.ledgerDocument.events), ["1"]);
  assert.deepEqual(harness.state.writes, []);
});

test("claim transaction failure discards staged claim state without a partial write", async () => {
  const session = await harness.createCheckoutSession(
    authenticatedRequest(),
  );
  await harness.redeemBiteSaverSubscriptionReturn(
    redeemRequest(session.returnToken),
  );
  const beforeState = structuredClone(harness.state.ledgerDocument);
  const beforeWrites = harness.state.ledgerWrites.length;
  harness.state.transactionBehaviors.push({
    type: "fail_after_callback",
    error: new Error("synthetic claim commit failure"),
  });

  await assert.rejects(
    () => harness.claimBiteSaverSubscriptionReturnEvent(
      claimRequest("1", "navigation"),
    ),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      assert.equal(error.message, "Subscription return state is unavailable.");
      return true;
    },
  );
  assert.deepEqual(harness.state.ledgerDocument, beforeState);
  assert.equal(harness.state.ledgerWrites.length, beforeWrites);
  assert.equal(
    harness.state.ledgerDocument.events["1"].navigationClaimed,
    false,
  );
  assert.deepEqual(harness.state.writes, []);

  const recovered = await harness.claimBiteSaverSubscriptionReturnEvent(
    claimRequest("1", "navigation"),
  );
  assert.equal(recovered.claimed, true);
});

test("Stripe failure preserves one unready return context and one unknown retryable billing attempt", async () => {
  harness.state.checkoutFailure = {
    name: "StripeAPIError",
    type: "StripeAPIError",
    message: canaries.rawError,
    stack: canaries.stack,
  };
  await assert.rejects(
    () => harness.createCheckoutSession(authenticatedRequest()),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      assert.equal(error.message, "Failed to create checkout session");
      return true;
    },
  );
  assert.equal(harness.state.checkoutCalls.length, 1);
  const token = tokenFromReturnUrl(
    harness.state.checkoutCalls[0].success_url,
    checkoutSuccessBaseUrl,
  );
  const context =
    harness.state.ledgerDocument.contexts[hashReturnToken(token)];
  assert.equal(context.ready, false);
  assert.equal(context.consumedEventId, null);
  assert.deepEqual(harness.state.ledgerDocument.events, {});
  assert.equal(
    harness.state.ownerBillingDocument.lifecycleState,
    "unknown",
  );
  assert.equal(
    harness.state.ownerBillingDocument.billingPosture,
    "unknown",
  );
  assert.equal(
    harness.state.ownerBillingDocument.checkoutAttemptId,
    harness.state.checkoutCalls[0].metadata.checkoutAttemptId,
  );
  assert.equal(
    harness.state.ownerBillingDocument.checkoutRequestFingerprint,
    harness.state.checkoutBillingStateSnapshots[0]
      .checkoutRequestFingerprint,
  );
  assert.equal(
    harness.state.ownerBillingDocument.checkoutAttemptCreatedAt
      .getTime(),
    harness.state.checkoutBillingStateSnapshots[0]
      .checkoutAttemptCreatedAt.getTime(),
  );
  assert.equal(JSON.stringify(harness.state.logs).includes(token), false);
  assertNoWritesOrSensitiveLogs(harness.state, [token]);
});

test("mark-ready failure withholds the Stripe URL and leaves an unusable unready context", async () => {
  harness.state.transactionBehaviors.push(
    {type: "commit"},
    {
      type: "fail_after_callback",
      error: {
        name: "FirestoreError",
        code: "unavailable",
        message: canaries.rawError,
        stack: canaries.stack,
      },
    },
  );
  await assert.rejects(
    () => harness.createCheckoutSession(authenticatedRequest()),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      assert.equal(error.message, "Failed to create checkout session");
      assert.equal(error.message.includes(canaries.checkoutUrl), false);
      return true;
    },
  );
  assert.equal(harness.state.checkoutCalls.length, 1);
  const token = tokenFromReturnUrl(
    harness.state.checkoutCalls[0].success_url,
    checkoutSuccessBaseUrl,
  );
  const context =
    harness.state.ledgerDocument.contexts[hashReturnToken(token)];
  assert.equal(context.ready, false);
  assert.equal(context.consumedEventId, null);
  assert.deepEqual(harness.state.ledgerDocument.events, {});
  await assert.rejects(
    () => harness.redeemBiteSaverSubscriptionReturn(
      redeemRequest(token),
    ),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "failed-precondition");
      return true;
    },
  );
  assert.equal(context.consumedEventId, null);
  assert.equal(JSON.stringify(harness.state.logs).includes(token), false);
  assertNoWritesOrSensitiveLogs(harness.state, [token]);
});

test("redeem, claim, and list enforce ownership and replay cleaned tombstones safely", async () => {
  const session = await harness.createCheckoutSession(
    authenticatedRequest(),
  );
  const beforeUnauthorizedReads = harness.state.ledgerReads.length;
  const returnData = redeemRequest(session.returnToken).data;
  for (const request of [
    {auth: {uid: "other-owner"}, data: returnData},
    {
      auth: {uid: canaries.uid},
      data: {...returnData, restaurantAccountDocumentId: "sibling"},
    },
  ]) {
    await assert.rejects(
      () => harness.redeemBiteSaverSubscriptionReturn(request),
      (error) => {
        assert.ok(error instanceof MockHttpsError);
        assert.equal(error.code, "permission-denied");
        return true;
      },
    );
  }
  assert.equal(harness.state.ledgerReads.length, beforeUnauthorizedReads);

  const redeemed = await harness.redeemBiteSaverSubscriptionReturn(
    redeemRequest(session.returnToken),
  );
  assert.deepEqual(redeemed, {
    returnProtocolVersion: protocolVersion,
    created: true,
    eventId: "1",
    returnKind: "checkoutSuccess",
  });
  const beforeUnauthorizedClaimReads = harness.state.ledgerReads.length;
  const claimData = claimRequest("1", "navigation").data;
  for (const request of [
    {auth: {uid: "other-owner"}, data: claimData},
    {
      auth: {uid: canaries.uid},
      data: {...claimData, restaurantAccountDocumentId: "sibling"},
    },
  ]) {
    await assert.rejects(
      () => harness.claimBiteSaverSubscriptionReturnEvent(request),
      (error) => {
        assert.ok(error instanceof MockHttpsError);
        assert.equal(error.code, "permission-denied");
        return true;
      },
    );
  }
  assert.equal(
    harness.state.ledgerReads.length,
    beforeUnauthorizedClaimReads,
  );
  const navigation = await harness.claimBiteSaverSubscriptionReturnEvent(
    claimRequest("1", "navigation"),
  );
  assert.deepEqual(navigation, {
    returnProtocolVersion: protocolVersion,
    claimed: true,
    eventId: "1",
    returnKind: "checkoutSuccess",
  });
  const beforeDuplicateClaimWrites = harness.state.ledgerWrites.length;
  const duplicateNavigation =
    await harness.claimBiteSaverSubscriptionReturnEvent(
      claimRequest("1", "navigation"),
    );
  assert.equal(duplicateNavigation.claimed, false);
  assert.equal(
    harness.state.ledgerWrites.length,
    beforeDuplicateClaimWrites,
  );

  const listed = await harness.listBiteSaverSubscriptionReturnEvents(
    authenticatedRequest(),
  );
  assert.deepEqual(listed, {
    returnProtocolVersion: protocolVersion,
    events: [
      {
        eventId: "1",
        returnKind: "checkoutSuccess",
        navigationClaimed: true,
        refreshClaimed: false,
        expiresAtEpochMs:
          harness.state.ledgerDocument.events["1"].expiresAtEpochMs,
      },
    ],
  });
  assert.equal(JSON.stringify(listed).includes(session.returnToken), false);

  await harness.claimBiteSaverSubscriptionReturnEvent(
    claimRequest("1", "refresh"),
  );
  const cleaned = await harness.listBiteSaverSubscriptionReturnEvents(
    authenticatedRequest(),
  );
  assert.deepEqual(cleaned, {
    returnProtocolVersion: protocolVersion,
    events: [],
  });
  assert.equal(harness.state.ledgerDocument.events["1"], undefined);
  const beforeReplayWrites = harness.state.ledgerWrites.length;
  const replay = await harness.redeemBiteSaverSubscriptionReturn(
    redeemRequest(session.returnToken),
  );
  assert.deepEqual(replay, {
    returnProtocolVersion: protocolVersion,
    created: false,
    eventId: "1",
    returnKind: "checkoutSuccess",
  });
  assert.equal(harness.state.ledgerWrites.length, beforeReplayWrites);
  assert.equal(harness.state.ledgerDocument.events["1"], undefined);
  assert.deepEqual(harness.state.writes, []);
});

test("new return handlers reject missing account ownership before parsing or mutating private state", async () => {
  const token = deterministicReturnToken(23);
  for (const invoke of [
    () => harness.redeemBiteSaverSubscriptionReturn(
      redeemRequest(token),
    ),
    () => harness.claimBiteSaverSubscriptionReturnEvent(
      claimRequest("1", "navigation"),
    ),
    () => harness.listBiteSaverSubscriptionReturnEvents(
      authenticatedRequest(),
    ),
  ]) {
    harness.reset();
    harness.state.accountExists = false;
    await assert.rejects(invoke, (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "permission-denied");
      return true;
    });
    assert.deepEqual(harness.state.ledgerReads, [
      `private_subscription_return_state/${canaries.uid}`,
    ]);
    assert.equal(harness.state.hashCalls, 0);
    assert.deepEqual(harness.state.ledgerWrites, []);
    assert.deepEqual(
      harness.state.operationTimeline.map((entry) => entry.operation),
      ["accountRead", "ledgerRead"],
    );
  }
});

test("session source places return tokens only in return URLs and safe response fields", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const start = source.indexOf(
    "export const createSubscriptionCheckoutSession",
  );
  const end = source.indexOf(
    "function renderSubscriptionReturnPage",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const sessionSource = source.slice(start, end);

  assert.doesNotMatch(sessionSource, /\{\s*error\s*\}/);
  assert.doesNotMatch(sessionSource, /error\.(?:message|stack)/);
  assert.doesNotMatch(
    sessionSource,
    /metadata\s*:\s*\{[^}]*\breturnToken\b/,
  );
  assert.doesNotMatch(
    sessionSource,
    /subscription_data\s*:\s*\{[^}]*\breturnToken\b/,
  );
  assert.doesNotMatch(
    sessionSource,
    /client_reference_id\s*:\s*returnToken\b/,
  );
  const loggerCalls = [
    ...sessionSource.matchAll(
      /logger\.(?:debug|error|info|log|warn)\([\s\S]*?\);/g,
    ),
  ].map((match) => match[0]);
  for (const loggerCall of loggerCalls) {
    assert.doesNotMatch(
      loggerCall,
      /\b(?:returnToken|successUrl|cancelUrl|returnUrl|session\.url|ownerUid|stripeCustomerId)\b/,
    );
    assert.match(loggerCall, /stripeLogMetadata\(/);
  }
});
