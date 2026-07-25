"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const canonicalReturnUrl =
  "https://app.bitestar.app/subscription/portal-return";

const sensitiveCanaries = Object.freeze({
  apiSecret: "sk_test_runtime_wiring_fake_secret",
  body: "{\"customer\":\"cus_runtime_raw_body\"}",
  checkoutSession: "cs_runtime_checkout",
  customer: "cus_runtime_customer",
  document: "restaurant_accounts/runtime-owner",
  email: "runtime-owner@example.test",
  paymentIntent: "pi_runtime_payment",
  portalSession: "bps_runtime_portal",
  portalUrl: "https://billing.stripe.test/session/runtime-secret",
  requestUrl: "https://functions.test/webhook?token=runtime-secret",
  signature: "runtime-signature-secret",
  stack: "Error: runtime provider stack",
  subscription: "sub_runtime_subscription",
  uid: "runtime-owner",
  webhookSecret: "whsec_runtime_fake_secret",
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
      email: sensitiveCanaries.email,
      profileField: "preserve-profile",
      stripeCustomerId: sensitiveCanaries.customer,
    },
    accountExists: true,
    accountLookupFailure: null,
    billingPortalCalls: [],
    billingPortalFailure: null,
    billingPortalResponse: {url: sensitiveCanaries.portalUrl},
    constructEventFailure: null,
    constructEventCalls: 0,
    constructedEvent: null,
    dbCalls: [],
    logs: [],
    parameterValue: canonicalReturnUrl,
    stripeConstructorCalls: 0,
    stripeConstructorFailure: null,
    stripeSecretResolutionFailure: null,
    subscriptionRetrieveCalls: [],
    subscriptionRetrieveFailure: null,
    transactionFailure: null,
    updates: [],
    creates: [],
  };

  function reset() {
    state.accountDocument = {
      email: sensitiveCanaries.email,
      profileField: "preserve-profile",
      stripeCustomerId: sensitiveCanaries.customer,
    };
    state.accountExists = true;
    state.accountLookupFailure = null;
    state.billingPortalCalls = [];
    state.billingPortalFailure = null;
    state.billingPortalResponse = {url: sensitiveCanaries.portalUrl};
    state.constructEventFailure = null;
    state.constructEventCalls = 0;
    state.constructedEvent = null;
    state.dbCalls = [];
    state.logs = [];
    state.parameterValue = canonicalReturnUrl;
    state.stripeConstructorCalls = 0;
    state.stripeConstructorFailure = null;
    state.stripeSecretResolutionFailure = null;
    state.subscriptionRetrieveCalls = [];
    state.subscriptionRetrieveFailure = null;
    state.transactionFailure = null;
    state.updates = [];
    state.creates = [];
  }

  const db = {
    collection(collectionPath) {
      return {
        doc(documentId) {
          const reference = {
            id: documentId,
            path: `${collectionPath}/${documentId}`,
            async get() {
              state.dbCalls.push({
                operation: "get",
                path: reference.path,
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
          return reference;
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
                      ? [{id: sensitiveCanaries.uid}]
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
      state.dbCalls.push({operation: "transaction"});
      if (state.transactionFailure !== null) {
        throw state.transactionFailure;
      }
      return callback({
        async get(reference) {
          state.dbCalls.push({
            operation: "transaction_get",
            path: reference.path,
          });
          return {exists: state.accountExists};
        },
        update(reference, data) {
          state.updates.push({
            path: reference.path,
            data: {...data},
          });
          state.accountDocument = {
            ...state.accountDocument,
            ...data,
          };
        },
        create(reference, data) {
          state.creates.push({
            path: reference.path,
            data: {...data},
          });
        },
      });
    },
  };

  class FakeStripe {
    constructor() {
      state.stripeConstructorCalls += 1;
      if (state.stripeConstructorFailure !== null) {
        throw state.stripeConstructorFailure;
      }
      this.billingPortal = {
        sessions: {
          create: async (parameters) => {
            state.billingPortalCalls.push({...parameters});
            if (state.billingPortalFailure !== null) {
              throw state.billingPortalFailure;
            }
            return state.billingPortalResponse;
          },
        },
      };
      this.checkout = {
        sessions: {
          create: async () => ({url: "unused"}),
        },
      };
      this.subscriptions = {
        retrieve: async (subscriptionId) => {
          state.subscriptionRetrieveCalls.push(subscriptionId);
          if (state.subscriptionRetrieveFailure !== null) {
            throw state.subscriptionRetrieveFailure;
          }
          return makeSubscription();
        },
      };
      this.webhooks = {
        constructEvent: () => {
          state.constructEventCalls += 1;
          if (state.constructEventFailure !== null) {
            throw state.constructEventFailure;
          }
          return state.constructedEvent;
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
              return name === "STRIPE_WEBHOOK_SECRET"
                ? sensitiveCanaries.webhookSecret
                : sensitiveCanaries.apiSecret;
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
        return {setGlobalOptions() {}};
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
    createCustomerPortalSession: entryPoint.createCustomerPortalSession,
    reset,
    state,
    stripeWebhook: entryPoint.stripeWebhook,
  };
}

function makeSubscription(overrides = {}) {
  return {
    id: sensitiveCanaries.subscription,
    customer: sensitiveCanaries.customer,
    status: "active",
    metadata: {
      ownerUid: sensitiveCanaries.uid,
      restaurantAccountId: sensitiveCanaries.uid,
      billingPlanName: "coupon_monthly",
    },
    trial_end: null,
    current_period_end: 1_900_000_000,
    ended_at: null,
    canceled_at: null,
    ...overrides,
  };
}

function makeWebhookEvent(subscription = makeSubscription()) {
  return {
    id: "evt_runtime_sensitive",
    type: "customer.subscription.updated",
    data: {object: subscription},
  };
}

function makeResponse() {
  return {
    statusCode: null,
    sent: null,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.sent = body;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
  };
}

function makeWebhookRequest() {
  return {
    method: "POST",
    rawBody: Buffer.from(sensitiveCanaries.body),
    headers: {
      authorization: sensitiveCanaries.apiSecret,
      "stripe-signature": sensitiveCanaries.signature,
    },
    originalUrl: sensitiveCanaries.requestUrl,
    header(name) {
      return name === "stripe-signature"
        ? sensitiveCanaries.signature
        : undefined;
    },
  };
}

function assertLogsContainNoSensitiveValues(logs, extraCanaries = []) {
  const serialized = JSON.stringify(logs);
  for (const canary of [
    ...Object.values(sensitiveCanaries),
    ...extraCanaries,
  ]) {
    if (typeof canary !== "string" || canary.length === 0) {
      continue;
    }
    assert.equal(serialized.includes(canary), false, canary);
  }
  for (const log of logs) {
    assert.deepEqual(
      Object.keys(log).sort(),
      log.metadata === undefined
        ? ["level", "message"]
        : ["level", "message", "metadata"],
    );
    if (log.metadata !== undefined) {
      assert.doesNotMatch(
        JSON.stringify(log.metadata),
        /"(?:error|message|stack|signature|rawBody|headers|event|customerId|subscriptionId|email|uid|documentId|requestUrl|returnUrl|portalUrl)"\s*:/i,
      );
    }
  }
}

const harness = createHarness();

test.beforeEach(() => {
  harness.reset();
});

test("webhook non-POST requests remain HTTP 405 without Stripe or Firestore access", async () => {
  const request = makeWebhookRequest();
  request.method = "GET";
  const response = makeResponse();

  await harness.stripeWebhook(request, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.sent, "Method Not Allowed");
  assert.equal(harness.state.stripeConstructorCalls, 0);
  assert.equal(harness.state.constructEventCalls, 0);
  assert.deepEqual(harness.state.subscriptionRetrieveCalls, []);
  assert.deepEqual(harness.state.dbCalls, []);
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.creates, []);
  assert.deepEqual(harness.state.logs, []);
});

test("webhook POST without a signature remains HTTP 400 before Stripe or Firestore access", async () => {
  const request = makeWebhookRequest();
  request.header = () => undefined;
  const response = makeResponse();

  await harness.stripeWebhook(request, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.sent, "Missing Stripe signature.");
  assert.equal(harness.state.stripeConstructorCalls, 0);
  assert.equal(harness.state.constructEventCalls, 0);
  assert.deepEqual(harness.state.subscriptionRetrieveCalls, []);
  assert.deepEqual(harness.state.dbCalls, []);
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.creates, []);
  assert.deepEqual(harness.state.logs, [
    {
      level: "warn",
      message: "Missing Stripe signature header.",
    },
  ]);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("webhook signature failure remains HTTP 400 and cannot reach Stripe processing or Firestore", async () => {
  const rawError = {
    name: "StripeSignatureVerificationError",
    message: sensitiveCanaries.signature,
    stack: sensitiveCanaries.stack,
    rawBody: sensitiveCanaries.body,
  };
  harness.state.constructEventFailure = rawError;
  const response = makeResponse();

  await harness.stripeWebhook(makeWebhookRequest(), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.sent, "Invalid Stripe signature.");
  assert.deepEqual(harness.state.subscriptionRetrieveCalls, []);
  assert.deepEqual(harness.state.dbCalls, []);
  assert.equal(harness.state.logs.length, 1);
  assert.deepEqual(harness.state.logs[0], {
    level: "error",
    message: "Stripe webhook signature verification failed",
    metadata: {
      stage: "webhook_signature_verification",
      errorCategory: "invalid_signature",
    },
  });
  assert.notEqual(harness.state.logs[0].metadata, rawError);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("webhook processing failure remains HTTP 500 with retry-safe sanitized logging", async () => {
  harness.state.constructedEvent = makeWebhookEvent();
  harness.state.transactionFailure = {
    name: "FirestoreError",
    code: "aborted",
    message: sensitiveCanaries.document,
    stack: sensitiveCanaries.stack,
    event: harness.state.constructedEvent,
  };
  const response = makeResponse();

  await harness.stripeWebhook(makeWebhookRequest(), response);

  assert.equal(response.statusCode, 500);
  assert.equal(response.sent, "Webhook processing failed.");
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.creates, []);
  assert.deepEqual(harness.state.logs, [
    {
      level: "error",
      message: "Stripe webhook event processing failed",
      metadata: {
        stage: "webhook_event_processing",
        errorCategory: "firestore_error",
      },
    },
  ]);
  assertLogsContainNoSensitiveValues(harness.state.logs, [
    "evt_runtime_sensitive",
  ]);
});

test("webhook Stripe initialization failures remain sanitized HTTP 500 responses", async () => {
  const fixtures = [
    {
      configure() {
        harness.state.stripeSecretResolutionFailure = {
          name: "Error",
          message: sensitiveCanaries.apiSecret,
          stack: sensitiveCanaries.stack,
        };
      },
      expectedCategory: "unknown_error",
    },
    {
      configure() {
        harness.state.stripeConstructorFailure = {
          name: "StripeAuthenticationError",
          type: "StripeAuthenticationError",
          message: sensitiveCanaries.apiSecret,
          stack: sensitiveCanaries.stack,
        };
      },
      expectedCategory: "stripe_api_error",
    },
  ];

  for (const fixture of fixtures) {
    harness.reset();
    fixture.configure();
    const response = makeResponse();

    await harness.stripeWebhook(makeWebhookRequest(), response);

    assert.equal(response.statusCode, 500);
    assert.equal(response.sent, "Webhook processing failed.");
    assert.equal(harness.state.constructEventCalls, 0);
    assert.deepEqual(harness.state.dbCalls, []);
    assert.deepEqual(harness.state.logs, [
      {
        level: "error",
        message: "Stripe webhook initialization failed",
        metadata: {
          stage: "webhook_event_processing",
          errorCategory: fixture.expectedCategory,
        },
      },
    ]);
    assertLogsContainNoSensitiveValues(harness.state.logs);
  }
});

test("unsupported webhook events remain acknowledged no-ops with safe fixed logging", async () => {
  const unsupportedEventCanary = "evt_runtime_unsupported_sensitive";
  const unsupportedObjectCanary = "in_runtime_unsupported_sensitive";
  harness.state.constructedEvent = {
    id: unsupportedEventCanary,
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: unsupportedObjectCanary,
        customer: sensitiveCanaries.customer,
        metadata: {
          email: sensitiveCanaries.email,
          ownerUid: sensitiveCanaries.uid,
        },
      },
    },
  };
  const response = makeResponse();

  await harness.stripeWebhook(makeWebhookRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.jsonBody, {received: true});
  assert.equal(harness.state.stripeConstructorCalls, 1);
  assert.equal(harness.state.constructEventCalls, 1);
  assert.deepEqual(harness.state.subscriptionRetrieveCalls, []);
  assert.deepEqual(harness.state.dbCalls, []);
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.creates, []);
  assert.deepEqual(harness.state.logs, [
    {
      level: "info",
      message: "Stripe webhook event ignored",
      metadata: {reason: "unsupported_event_type"},
    },
  ]);
  assertLogsContainNoSensitiveValues(harness.state.logs, [
    unsupportedEventCanary,
    unsupportedObjectCanary,
    "invoice.payment_succeeded",
  ]);
});

test("missing-account webhook handling remains an acknowledged no-op with identifier-free logs", async () => {
  harness.state.constructedEvent = makeWebhookEvent();
  harness.state.accountExists = false;
  const response = makeResponse();

  await harness.stripeWebhook(makeWebhookRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.jsonBody, {received: true});
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.creates, []);
  assert.deepEqual(harness.state.logs, [
    {
      level: "warn",
      message: "Stripe subscription synchronization skipped",
      metadata: {reason: "missing_account"},
    },
  ]);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("unresolved-account webhook handling remains an acknowledged no-op without identifiers", async () => {
  harness.state.constructedEvent = makeWebhookEvent(
    makeSubscription({
      metadata: {},
    }),
  );
  harness.state.accountExists = false;
  const response = makeResponse();

  await harness.stripeWebhook(makeWebhookRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.jsonBody, {received: true});
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.creates, []);
  assert.deepEqual(harness.state.logs, [
    {
      level: "warn",
      message: "Stripe subscription synchronization skipped",
      metadata: {reason: "account_not_resolved"},
    },
  ]);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("existing-account webhook synchronization preserves its exact narrow update behavior", async () => {
  harness.state.constructedEvent = makeWebhookEvent();
  const originalProfile = harness.state.accountDocument.profileField;
  const originalEmail = harness.state.accountDocument.email;
  const response = makeResponse();

  await harness.stripeWebhook(makeWebhookRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.jsonBody, {received: true});
  assert.equal(harness.state.creates.length, 0);
  assert.equal(harness.state.updates.length, 1);
  assert.deepEqual(
    Object.keys(harness.state.updates[0].data).sort(),
    [
      "billingPlanName",
      "couponPostingEnabled",
      "hasUsedTrial",
      "stripeCustomerId",
      "stripeSubscriptionId",
      "subscriptionEndsAt",
      "subscriptionStatus",
      "trialEndsAt",
      "updatedAt",
    ],
  );
  assert.equal(harness.state.accountDocument.profileField, originalProfile);
  assert.equal(harness.state.accountDocument.email, originalEmail);
  assert.deepEqual(harness.state.logs, []);
});

test("repeated supported webhook execution reapplies only the established subscription patch", async () => {
  const preservedAccountFields = {
    restaurantName: "Preserved Restaurant",
    profileVersion: 7,
    formattedAddress: "123 Preserved Street",
    latitude: 42.3314,
    longitude: -83.0458,
    geohash: "dpscjy",
    approvalStatus: "approved",
    couponApplicationSubmitted: true,
    inviteId: "invite-preserved",
    unrelatedField: {preserve: true},
  };
  harness.state.accountDocument = {
    ...harness.state.accountDocument,
    ...preservedAccountFields,
  };
  harness.state.constructedEvent = makeWebhookEvent();
  const firstResponse = makeResponse();
  const repeatedResponse = makeResponse();

  await harness.stripeWebhook(makeWebhookRequest(), firstResponse);
  await harness.stripeWebhook(makeWebhookRequest(), repeatedResponse);

  assert.equal(firstResponse.statusCode, 200);
  assert.deepEqual(firstResponse.jsonBody, {received: true});
  assert.equal(repeatedResponse.statusCode, 200);
  assert.deepEqual(repeatedResponse.jsonBody, {received: true});
  assert.equal(harness.state.stripeConstructorCalls, 2);
  assert.equal(harness.state.constructEventCalls, 2);
  assert.deepEqual(harness.state.subscriptionRetrieveCalls, []);
  assert.deepEqual(harness.state.creates, []);
  assert.equal(harness.state.updates.length, 2);
  assert.deepEqual(
    harness.state.updates[1].data,
    harness.state.updates[0].data,
  );
  assert.deepEqual(
    Object.keys(harness.state.updates[0].data).sort(),
    [
      "billingPlanName",
      "couponPostingEnabled",
      "hasUsedTrial",
      "stripeCustomerId",
      "stripeSubscriptionId",
      "subscriptionEndsAt",
      "subscriptionStatus",
      "trialEndsAt",
      "updatedAt",
    ],
  );
  for (const [field, value] of Object.entries(
    preservedAccountFields,
  )) {
    assert.deepEqual(harness.state.accountDocument[field], value, field);
  }
  assert.deepEqual(harness.state.logs, []);
});

test("portal configuration rejects every missing or noncanonical value before account or Stripe access", async () => {
  const rejectedValues = [
    undefined,
    "",
    "http://app.bitestar.app/subscription/portal-return",
    "https://www.app.bitestar.app/subscription/portal-return",
    "https://app.bitestar.app/other",
    `${canonicalReturnUrl}/`,
    `${canonicalReturnUrl}?next=1`,
    `${canonicalReturnUrl}#fragment`,
    "https://user@app.bitestar.app/subscription/portal-return",
    "https://app.bitestar.app:443/subscription/portal-return",
  ];

  for (const rejectedValue of rejectedValues) {
    harness.reset();
    harness.state.parameterValue = rejectedValue;

    await assert.rejects(
      () =>
        harness.createCustomerPortalSession({
          auth: {uid: sensitiveCanaries.uid},
          data: {},
        }),
      (error) => {
        assert.ok(error instanceof MockHttpsError);
        assert.equal(error.code, "failed-precondition");
        assert.equal(
          error.message,
          "Stripe Customer Portal is not configured.",
        );
        if (
          typeof rejectedValue === "string" &&
          rejectedValue.length > 0
        ) {
          assert.equal(error.message.includes(rejectedValue), false);
        }
        return true;
      },
    );

    assert.deepEqual(harness.state.dbCalls, []);
    assert.deepEqual(harness.state.billingPortalCalls, []);
    assert.deepEqual(harness.state.logs, [
      {
        level: "error",
        message: "Stripe Customer Portal configuration is invalid",
        metadata: {
          stage: "customer_portal_session_creation",
          errorCategory: "configuration_error",
        },
      },
    ]);
    assertLogsContainNoSensitiveValues(harness.state.logs, [
      String(rejectedValue),
    ]);
  }
});

test("portal authentication and linked-customer requirements remain unchanged", async () => {
  await assert.rejects(
    () => harness.createCustomerPortalSession({auth: null, data: {}}),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "unauthenticated");
      assert.equal(error.message, "Authentication is required.");
      return true;
    },
  );
  assert.deepEqual(harness.state.dbCalls, []);
  assert.deepEqual(harness.state.billingPortalCalls, []);

  harness.reset();
  harness.state.accountDocument = {profileField: "preserve-profile"};
  await assert.rejects(
    () =>
      harness.createCustomerPortalSession({
        auth: {uid: sensitiveCanaries.uid},
        data: {},
      }),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "failed-precondition");
      assert.equal(
        error.message,
        "No Stripe customer is linked to this restaurant account.",
      );
      return true;
    },
  );
  assert.equal(harness.state.dbCalls.length, 1);
  assert.deepEqual(harness.state.billingPortalCalls, []);
  assert.deepEqual(harness.state.logs, []);
});

test("portal account lookup failure is sanitized before the framework wrapper can observe it", async () => {
  const rawError = {
    name: "FirestoreError",
    code: "unavailable",
    message: sensitiveCanaries.document,
    stack: sensitiveCanaries.stack,
    uid: sensitiveCanaries.uid,
  };
  harness.state.accountLookupFailure = rawError;

  await assert.rejects(
    () =>
      harness.createCustomerPortalSession({
        auth: {uid: sensitiveCanaries.uid},
        data: {},
      }),
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
  assert.deepEqual(harness.state.logs, [
    {
      level: "error",
      message: "Stripe Customer Portal account lookup failed",
      metadata: {
        stage: "customer_portal_session_creation",
        errorCategory: "firestore_error",
      },
    },
  ]);
  assert.notEqual(harness.state.logs[0].metadata, rawError);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("successful portal creation passes the exact return URL and preserves response shape without logging", async () => {
  const result = await harness.createCustomerPortalSession({
    auth: {uid: sensitiveCanaries.uid},
    data: {},
  });

  assert.deepEqual(harness.state.billingPortalCalls, [
    {
      customer: sensitiveCanaries.customer,
      return_url: canonicalReturnUrl,
    },
  ]);
  assert.deepEqual(result, {url: sensitiveCanaries.portalUrl});
  assert.deepEqual(harness.state.logs, []);
});

test("portal Stripe failure becomes a stable callable error with safe metadata only", async () => {
  const rawError = {
    name: "StripeAPIError",
    type: "StripeAPIError",
    message: sensitiveCanaries.customer,
    stack: sensitiveCanaries.stack,
    portalUrl: sensitiveCanaries.portalUrl,
    uid: sensitiveCanaries.uid,
    secret: sensitiveCanaries.apiSecret,
  };
  harness.state.billingPortalFailure = rawError;

  await assert.rejects(
    () =>
      harness.createCustomerPortalSession({
        auth: {uid: sensitiveCanaries.uid},
        data: {},
      }),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      assert.equal(
        error.message,
        "Unable to open subscription management right now.",
      );
      for (const canary of Object.values(sensitiveCanaries)) {
        assert.equal(error.message.includes(canary), false, canary);
      }
      return true;
    },
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
  assert.notEqual(harness.state.logs[0].metadata, rawError);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("reviewed source regions retain verification and response behavior while banning raw logger arguments", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const portalStart = source.indexOf(
    "export const createCustomerPortalSession",
  );
  const portalEnd = source.indexOf(
    "function renderSubscriptionReturnPage",
    portalStart,
  );
  const webhookStart = source.indexOf("export const stripeWebhook");
  const webhookEnd = source.indexOf(
    "export const processProximityPushRequest",
    webhookStart,
  );
  assert.ok(portalStart >= 0 && portalEnd > portalStart);
  assert.ok(webhookStart >= 0 && webhookEnd > webhookStart);
  const portalSource = source.slice(portalStart, portalEnd);
  const webhookSource = source.slice(webhookStart, webhookEnd);

  assert.match(
    portalSource,
    /requireCanonicalSubscriptionPortalReturnUrl\([\s\S]*?stripeCustomerPortalReturnUrl\.value\(\)/,
  );
  assert.match(
    portalSource,
    /return_url: returnUrl[\s\S]*?return \{\s*url: session\.url,\s*\}/,
  );
  assert.match(
    portalSource,
    /new HttpsError\(\s*"internal",\s*"Unable to open subscription management right now\."/,
  );
  assert.doesNotMatch(portalSource, /\{\s*error\s*\}/);
  assert.doesNotMatch(portalSource, /error\.(?:message|stack)/);
  const portalLoggerCalls = [
    ...portalSource.matchAll(
      /logger\.(?:debug|error|info|log|warn)\([\s\S]*?\);/g,
    ),
  ].map((match) => match[0]);
  for (const loggerCall of portalLoggerCalls) {
    assert.doesNotMatch(
      loggerCall,
      /\b(?:ownerUid|stripeCustomerId|returnUrl)\s*[,}]|session\.url/,
    );
    assert.doesNotMatch(
      loggerCall,
      /\{\s*(?:\.\.\.)?(?:error|rawError)\b|,\s*(?:error|rawError)\s*\);/,
    );
    const loggerArguments = loggerCall.slice(
      loggerCall.indexOf("(") + 1,
    );
    if (/\berror\b/.test(loggerArguments)) {
      assert.match(
        loggerArguments,
        /stripeLogMetadata\([\s\S]*?\berror\)/,
      );
    }
  }

  assert.match(
    webhookSource,
    /stripe\.webhooks\.constructEvent\(\s*request\.rawBody,\s*signature,\s*stripeWebhookSecret\.value\(\)/,
  );
  assert.match(
    webhookSource,
    /response\.status\(400\)\.send\("Invalid Stripe signature\."\)/,
  );
  assert.match(
    webhookSource,
    /response\.status\(500\)\.send\("Webhook processing failed\."\)/,
  );
  assert.match(
    webhookSource,
    /stripeLogMetadata\("webhook_signature_verification", error\)/,
  );
  assert.match(
    webhookSource,
    /stripeLogMetadata\("webhook_event_processing", error\)/,
  );
  assert.doesNotMatch(webhookSource, /\{\s*error\s*\}/);
  assert.doesNotMatch(webhookSource, /error\.(?:message|stack)/);
  assert.doesNotMatch(webhookSource, /type:\s*event\.type/);
  const webhookLoggerCalls = [
    ...webhookSource.matchAll(
      /logger\.(?:debug|error|info|log|warn)\([\s\S]*?\);/g,
    ),
  ].map((match) => match[0]);
  for (const loggerCall of webhookLoggerCalls) {
    assert.doesNotMatch(
      loggerCall,
      /request\.(?:rawBody|headers)|\bsignature\s*[,}]|subscription\.id|stripeCustomerId|restaurantUid|event\.type/,
    );
    assert.doesNotMatch(
      loggerCall,
      /\{\s*(?:\.\.\.)?(?:error|rawError)\b|,\s*(?:error|rawError)\s*\);/,
    );
    const loggerArguments = loggerCall.slice(
      loggerCall.indexOf("(") + 1,
    );
    if (/\berror\b/.test(loggerArguments)) {
      assert.match(
        loggerArguments,
        /stripeLogMetadata\([\s\S]*?\berror\)/,
      );
    }
  }
});
