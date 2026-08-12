"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildOwnerRecordStateDocument,
} = require("../lib/owner_record_state_contract.js");
const {
  createCheckoutPendingOwnerBillingState,
  createInitialOwnerBillingState,
} = require("../lib/owner_billing_state_contract.js");
const {
  applyOwnerBillingWebhookEvent,
  createOwnerBillingStripeMetadata,
  createOwnerBillingWebhookEvent,
} = require("../lib/owner_billing_webhook.js");

const canonicalReturnUrl =
  "https://app.bitestar.app/subscription/portal-return";
const ownerGeneration = 7;
const baselineEventCreated = 1_700_000_000;
const checkoutAttemptId = "attempt_RuntimeOwner7";
const checkoutRequestFingerprint = "a".repeat(64);
const contractCreatedAt = new Date("2026-01-01T00:00:00.000Z");
const checkoutCreatedAt = new Date("2026-01-01T00:00:01.000Z");
const baselineUpdatedAt = new Date("2026-01-01T00:00:02.000Z");

const sensitiveCanaries = Object.freeze({
  apiSecret: "sk_test_runtime_wiring_fake_secret",
  body: "{\"customer\":\"cus_RuntimeRawBody\"}",
  checkoutAttempt: checkoutAttemptId,
  checkoutSession: "cs_test_RuntimeCheckout1",
  customer: "cus_RuntimeCustomer1",
  document: "restaurant_accounts/runtime-owner",
  email: "runtime-owner@example.test",
  event: "evt_RuntimeSensitive1",
  paymentIntent: "pi_RuntimePayment1",
  portalSession: "bps_RuntimePortal1",
  portalUrl: "https://billing.stripe.test/session/runtime-secret",
  requestUrl: "https://functions.test/webhook?token=runtime-secret",
  signature: "runtime-signature-secret",
  stack: "Error: runtime provider stack",
  subscription: "sub_RuntimeSubscription1",
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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function makeOwnerState(overrides = {}) {
  const state = overrides.state ?? "open";
  return buildOwnerRecordStateDocument({
    ownerUid: sensitiveCanaries.uid,
    generation: ownerGeneration,
    state,
    activeJobId:
      state === "removing" ? "job_RuntimeOwnerRemoval1" : null,
    createdAt: contractCreatedAt,
    updatedAt: contractCreatedAt,
    ...overrides,
  });
}

function makePendingBillingState(overrides = {}) {
  const generation = overrides.ownerRecordGeneration ?? ownerGeneration;
  const initial = createInitialOwnerBillingState(
    sensitiveCanaries.uid,
    generation,
    contractCreatedAt,
  );
  return createCheckoutPendingOwnerBillingState(initial, {
    checkoutAttemptId:
      overrides.checkoutAttemptId ?? checkoutAttemptId,
    checkoutRequestFingerprint:
      overrides.checkoutRequestFingerprint ?? checkoutRequestFingerprint,
    checkoutAttemptCreatedAt:
      overrides.checkoutAttemptCreatedAt ?? checkoutCreatedAt,
    now: overrides.updatedAt ?? checkoutCreatedAt,
  });
}

function makeMetadata(overrides = {}) {
  return createOwnerBillingStripeMetadata({
    ownerUid: overrides.ownerUid ?? sensitiveCanaries.uid,
    ownerRecordGeneration:
      overrides.ownerRecordGeneration ?? ownerGeneration,
    checkoutAttemptId:
      overrides.checkoutAttemptId ?? checkoutAttemptId,
  });
}

function makeKnownBillingState(overrides = {}) {
  const generation = overrides.ownerRecordGeneration ?? ownerGeneration;
  const owner = makeOwnerState({generation});
  const current = makePendingBillingState({
    ownerRecordGeneration: generation,
    checkoutAttemptId:
      overrides.checkoutAttemptId ?? checkoutAttemptId,
  });
  const incoming = createOwnerBillingWebhookEvent({
    metadata: makeMetadata({
      ownerRecordGeneration: generation,
      checkoutAttemptId:
        overrides.checkoutAttemptId ?? checkoutAttemptId,
    }),
    stripeCustomerId:
      overrides.stripeCustomerId ?? sensitiveCanaries.customer,
    stripeSubscriptionId:
      overrides.stripeSubscriptionId ?? sensitiveCanaries.subscription,
    rawStripeStatus: overrides.rawStripeStatus ?? "active",
    eventType:
      overrides.eventType ?? "customer.subscription.updated",
    eventCreated:
      overrides.eventCreated ?? baselineEventCreated,
    eventId: overrides.eventId ?? "evt_RuntimeBaseline1",
  });
  return applyOwnerBillingWebhookEvent({
    owner,
    current,
    incoming,
    now: baselineUpdatedAt,
  }).state;
}

function makeSubscription(overrides = {}) {
  return {
    id: sensitiveCanaries.subscription,
    customer: sensitiveCanaries.customer,
    status: "active",
    cancel_at_period_end: false,
    metadata: makeMetadata(),
    trial_end: null,
    current_period_end: 1_900_000_000,
    ended_at: null,
    canceled_at: null,
    ...overrides,
  };
}

function makeWebhookEvent(subscription = makeSubscription(), overrides = {}) {
  return {
    id: "evt_RuntimeIncoming1",
    type: "customer.subscription.updated",
    created: baselineEventCreated + 100,
    data: {object: subscription},
    ...overrides,
  };
}

function makeCheckoutCompletedEvent(overrides = {}) {
  const metadata = overrides.metadata ?? makeMetadata();
  return {
    id: "evt_RuntimeCheckoutCompleted1",
    type: "checkout.session.completed",
    created: baselineEventCreated + 50,
    data: {
      object: {
        id: sensitiveCanaries.checkoutSession,
        mode: "subscription",
        customer: sensitiveCanaries.customer,
        subscription: sensitiveCanaries.subscription,
        metadata,
        ...overrides.session,
      },
    },
  };
}

function createHarness() {
  const state = {
    accountDocument: undefined,
    accountExists: true,
    accountLookupFailure: null,
    ownerRecordDocument: undefined,
    ownerRecordExists: true,
    ownerBillingDocument: undefined,
    ownerBillingExists: true,
    ledgerDocument: undefined,
    billingPortalCalls: [],
    billingPortalFailure: null,
    billingPortalResponse: {url: sensitiveCanaries.portalUrl},
    constructEventFailure: null,
    constructEventCalls: 0,
    constructedEvent: null,
    dbCalls: [],
    sets: [],
    creates: [],
    updates: [],
    logs: [],
    parameterValue: canonicalReturnUrl,
    stripeConstructorCalls: 0,
    stripeConstructorFailure: null,
    stripeSecretResolutionFailure: null,
    subscriptionRetrieveCalls: [],
    subscriptionRetrieveFailure: null,
    subscriptionRetrieveResponse: null,
    transactionFailure: null,
  };

  function reset() {
    state.accountDocument = {
      uid: sensitiveCanaries.uid,
      ownerRecordGeneration: ownerGeneration,
      email: sensitiveCanaries.email,
      profileField: "preserve-profile",
      stripeCustomerId: sensitiveCanaries.customer,
      stripeSubscriptionId: sensitiveCanaries.subscription,
    };
    state.accountExists = true;
    state.accountLookupFailure = null;
    state.ownerRecordDocument = clone(makeOwnerState());
    state.ownerRecordExists = true;
    state.ownerBillingDocument = clone(makeKnownBillingState());
    state.ownerBillingExists = true;
    state.ledgerDocument = undefined;
    state.billingPortalCalls = [];
    state.billingPortalFailure = null;
    state.billingPortalResponse = {url: sensitiveCanaries.portalUrl};
    state.constructEventFailure = null;
    state.constructEventCalls = 0;
    state.constructedEvent = null;
    state.dbCalls = [];
    state.sets = [];
    state.creates = [];
    state.updates = [];
    state.logs = [];
    state.parameterValue = canonicalReturnUrl;
    state.stripeConstructorCalls = 0;
    state.stripeConstructorFailure = null;
    state.stripeSecretResolutionFailure = null;
    state.subscriptionRetrieveCalls = [];
    state.subscriptionRetrieveFailure = null;
    state.subscriptionRetrieveResponse = null;
    state.transactionFailure = null;
  }

  function documentState(reference) {
    if (reference.path.startsWith("restaurant_accounts/")) {
      if (state.accountLookupFailure !== null) {
        throw state.accountLookupFailure;
      }
      return {
        exists: state.accountExists,
        data: state.accountDocument,
      };
    }
    if (reference.path.startsWith("private_owner_record_states/")) {
      return {
        exists: state.ownerRecordExists,
        data: state.ownerRecordDocument,
      };
    }
    if (reference.path.startsWith("private_owner_billing_states/")) {
      return {
        exists: state.ownerBillingExists,
        data: state.ownerBillingDocument,
      };
    }
    if (reference.path.startsWith("private_subscription_return_state/")) {
      return {
        exists: state.ledgerDocument !== undefined,
        data: state.ledgerDocument,
      };
    }
    throw new Error(`Unexpected document path: ${reference.path}`);
  }

  function snapshot(reference) {
    const document = documentState(reference);
    return {
      exists: document.exists,
      data: () => document.exists ? clone(document.data) : undefined,
    };
  }

  function persistSet(reference, data) {
    if (reference.path.startsWith("private_owner_record_states/")) {
      state.ownerRecordExists = true;
      state.ownerRecordDocument = clone(data);
      return;
    }
    if (reference.path.startsWith("private_owner_billing_states/")) {
      state.ownerBillingExists = true;
      state.ownerBillingDocument = clone(data);
      return;
    }
    if (reference.path.startsWith("private_subscription_return_state/")) {
      state.ledgerDocument = clone(data);
      return;
    }
    throw new Error(`Unexpected transaction set: ${reference.path}`);
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
              return snapshot(reference);
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
                  return {empty: true, docs: []};
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
          return snapshot(reference);
        },
        update(reference, data) {
          state.updates.push({
            path: reference.path,
            data: clone(data),
          });
          state.accountDocument = {
            ...state.accountDocument,
            ...clone(data),
          };
        },
        create(reference, data) {
          state.creates.push({
            path: reference.path,
            data: clone(data),
          });
        },
        set(reference, data) {
          state.sets.push({
            path: reference.path,
            data: clone(data),
          });
          persistSet(reference, data);
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
            state.billingPortalCalls.push(clone(parameters));
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
          return state.subscriptionRetrieveResponse ?? makeSubscription();
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

function privateBillingWrites() {
  return harness.state.sets.filter((entry) =>
    entry.path.startsWith("private_owner_billing_states/"));
}

function privateOwnerWrites() {
  return harness.state.sets.filter((entry) =>
    entry.path.startsWith("private_owner_record_states/"));
}

function returnLedgerWrites() {
  return harness.state.sets.filter((entry) =>
    entry.path.startsWith("private_subscription_return_state/"));
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
        /"(?:error|message|stack|signature|rawBody|headers|event|customerId|subscriptionId|email|uid|documentId|requestUrl|returnUrl|portalUrl|generation|metadata)"\s*:/i,
      );
    }
  }
}

async function dispatchWebhook(event) {
  harness.state.constructedEvent = event;
  const response = makeResponse();
  await harness.stripeWebhook(makeWebhookRequest(), response);
  return response;
}

function assertAcknowledged(response) {
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.jsonBody, {received: true});
}

const harness = createHarness();

test.beforeEach(() => {
  harness.reset();
});

test("webhook rejects non-POST and unsigned requests before Stripe or Firestore", async () => {
  const nonPostRequest = makeWebhookRequest();
  nonPostRequest.method = "GET";
  const nonPostResponse = makeResponse();
  await harness.stripeWebhook(nonPostRequest, nonPostResponse);
  assert.equal(nonPostResponse.statusCode, 405);
  assert.equal(nonPostResponse.sent, "Method Not Allowed");
  assert.equal(harness.state.stripeConstructorCalls, 0);
  assert.deepEqual(harness.state.dbCalls, []);

  harness.reset();
  const unsignedRequest = makeWebhookRequest();
  unsignedRequest.header = () => undefined;
  const unsignedResponse = makeResponse();
  await harness.stripeWebhook(unsignedRequest, unsignedResponse);
  assert.equal(unsignedResponse.statusCode, 400);
  assert.equal(unsignedResponse.sent, "Missing Stripe signature.");
  assert.equal(harness.state.stripeConstructorCalls, 0);
  assert.deepEqual(harness.state.dbCalls, []);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("webhook signature failures are sanitized and cannot reach Firestore", async () => {
  harness.state.constructEventFailure = {
    name: "StripeSignatureVerificationError",
    message: sensitiveCanaries.signature,
    stack: sensitiveCanaries.stack,
    rawBody: sensitiveCanaries.body,
  };
  const response = makeResponse();

  await harness.stripeWebhook(makeWebhookRequest(), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.sent, "Invalid Stripe signature.");
  assert.deepEqual(harness.state.dbCalls, []);
  assert.deepEqual(harness.state.sets, []);
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.logs, [{
    level: "error",
    message: "Stripe webhook signature verification failed",
    metadata: {
      stage: "webhook_signature_verification",
      errorCategory: "invalid_signature",
    },
  }]);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("unsupported webhook events remain acknowledged no-ops", async () => {
  const response = await dispatchWebhook({
    id: "evt_RuntimeUnsupported1",
    type: "invoice.payment_succeeded",
    created: baselineEventCreated + 1,
    data: {
      object: {
        id: "in_RuntimeUnsupported1",
        customer: sensitiveCanaries.customer,
        metadata: {ownerUid: sensitiveCanaries.uid},
      },
    },
  });

  assertAcknowledged(response);
  assert.deepEqual(harness.state.dbCalls, []);
  assert.deepEqual(harness.state.sets, []);
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.logs, [{
    level: "info",
    message: "Stripe webhook event ignored",
    metadata: {reason: "unsupported_event_type"},
  }]);
  assertLogsContainNoSensitiveValues(harness.state.logs, [
    "evt_RuntimeUnsupported1",
    "in_RuntimeUnsupported1",
  ]);
});

test("matching-generation webhooks preserve every raw Stripe status privately and map public state conservatively", async () => {
  const fixtures = [
    {raw: "active", posture: "blocking", public: "active", enabled: true},
    {raw: "trialing", posture: "blocking", public: "trialing", enabled: true},
    {raw: "past_due", posture: "blocking", public: "active", enabled: false},
    {raw: "unpaid", posture: "blocking", public: "active", enabled: false},
    {raw: "incomplete", posture: "blocking", public: "active", enabled: false},
    {raw: "paused", posture: "blocking", public: "active", enabled: false},
    {raw: "canceled", posture: "inactive", public: "inactive", enabled: false},
    {
      raw: "incomplete_expired",
      posture: "inactive",
      public: "inactive",
      enabled: false,
    },
  ];

  for (const [index, fixture] of fixtures.entries()) {
    harness.reset();
    const response = await dispatchWebhook(makeWebhookEvent(
      makeSubscription({status: fixture.raw}),
      {
        id: `evt_RuntimeStatus${index + 1}`,
        created: baselineEventCreated + index + 1,
      },
    ));

    assertAcknowledged(response);
    assert.equal(privateBillingWrites().length, 1, fixture.raw);
    const privateState = privateBillingWrites()[0].data;
    assert.equal(privateState.ownerUid, sensitiveCanaries.uid, fixture.raw);
    assert.equal(
      privateState.ownerRecordGeneration,
      ownerGeneration,
      fixture.raw,
    );
    assert.equal(privateState.lifecycleState, "subscription_known", fixture.raw);
    assert.equal(privateState.rawStripeStatus, fixture.raw, fixture.raw);
    assert.equal(privateState.billingPosture, fixture.posture, fixture.raw);
    assert.equal(
      privateState.lastStripeEventCreated,
      baselineEventCreated + index + 1,
      fixture.raw,
    );
    assert.equal(
      privateState.lastStripeEventId,
      `evt_RuntimeStatus${index + 1}`,
      fixture.raw,
    );
    assert.equal(privateState.stripeEventConflictKind, null, fixture.raw);
    assert.equal(harness.state.updates.length, 1, fixture.raw);
    const publicPatch = harness.state.updates[0].data;
    assert.equal(publicPatch.subscriptionStatus, fixture.public, fixture.raw);
    assert.equal(publicPatch.couponPostingEnabled, fixture.enabled, fixture.raw);
    assert.equal(
      Object.hasOwn(publicPatch, "hasUsedTrial"),
      fixture.enabled,
      fixture.raw,
    );
    assert.deepEqual(harness.state.creates, [], fixture.raw);
    assert.deepEqual(harness.state.logs, [], fixture.raw);
  }
});

test("a newer attributable unsupported Stripe status durably overrides terminal inactivity with unknown", async () => {
  harness.state.ownerBillingDocument = clone(makeKnownBillingState({
    rawStripeStatus: "canceled",
  }));
  harness.state.accountDocument.subscriptionStatus = "inactive";

  const unknownResponse = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({status: "future_status"}),
    {
      id: "evt_RuntimeFutureStatus1",
      created: baselineEventCreated + 1,
    },
  ));

  assertAcknowledged(unknownResponse);
  assert.equal(privateBillingWrites().length, 1);
  assert.equal(harness.state.ownerBillingDocument.lifecycleState, "unknown");
  assert.equal(harness.state.ownerBillingDocument.rawStripeStatus, null);
  assert.equal(harness.state.ownerBillingDocument.billingPosture, "unknown");
  assert.equal(
    harness.state.ownerBillingDocument.stripeEventConflictKind,
    "unsupported_status",
  );
  assert.equal(
    harness.state.ownerBillingDocument.lastStripeEventCreated,
    baselineEventCreated + 1,
  );
  assert.equal(
    harness.state.ownerBillingDocument.lastStripeEventId,
    "evt_RuntimeFutureStatus1",
  );
  assert.equal(
    JSON.stringify(harness.state.ownerBillingDocument)
      .includes("future_status"),
    false,
  );
  assert.deepEqual(harness.state.updates, []);
  assert.equal(harness.state.accountDocument.subscriptionStatus, "inactive");
  assertLogsContainNoSensitiveValues(harness.state.logs, [
    "future_status",
    "evt_RuntimeFutureStatus1",
  ]);

  const duplicateResponse = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({status: "another_future_status"}),
    {
      id: "evt_RuntimeFutureStatus1",
      created: baselineEventCreated + 1,
    },
  ));
  assertAcknowledged(duplicateResponse);
  assert.equal(privateBillingWrites().length, 1);
  assert.equal(harness.state.ownerBillingDocument.lifecycleState, "unknown");

  const olderKnownResponse = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({status: "canceled"}),
    {
      id: "evt_RuntimeOlderThanFutureStatus1",
      created: baselineEventCreated,
    },
  ));
  assertAcknowledged(olderKnownResponse);
  assert.equal(privateBillingWrites().length, 1);
  assert.equal(harness.state.ownerBillingDocument.lifecycleState, "unknown");

  const resolvedResponse = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({status: "past_due"}),
    {
      id: "evt_RuntimeFutureStatusResolved1",
      created: baselineEventCreated + 2,
    },
  ));
  assertAcknowledged(resolvedResponse);
  assert.equal(harness.state.ownerBillingDocument.lifecycleState, "subscription_known");
  assert.equal(harness.state.ownerBillingDocument.rawStripeStatus, "past_due");
  assert.equal(harness.state.ownerBillingDocument.billingPosture, "blocking");
  assert.equal(harness.state.ownerBillingDocument.stripeEventConflictKind, null);
  assert.equal(harness.state.updates.length, 1);
  assert.equal(harness.state.accountDocument.subscriptionStatus, "active");
});

test("all supported subscription event types enter the generation-bound handler", async () => {
  const eventTypes = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
  ];
  for (const [index, eventType] of eventTypes.entries()) {
    harness.reset();
    const response = await dispatchWebhook(makeWebhookEvent(
      makeSubscription(),
      {
        id: `evt_RuntimeType${index + 1}`,
        type: eventType,
        created: baselineEventCreated + index + 1,
      },
    ));
    assertAcknowledged(response);
    assert.equal(privateBillingWrites().length, 1, eventType);
    assert.equal(
      privateBillingWrites()[0].data.lastStripeEventId,
      `evt_RuntimeType${index + 1}`,
      eventType,
    );
    assert.equal(harness.state.updates.length, 1, eventType);
  }
});

test("strict final webhook metadata rejects missing, malformed, mismatched, and extra fields", async () => {
  const base = makeMetadata();
  const fixtures = [
    () => {
      const value = {...base};
      delete value.ownerRecordGeneration;
      return value;
    },
    () => ({...base, ownerRecordGeneration: ownerGeneration}),
    () => ({...base, ownerRecordGeneration: "07"}),
    () => ({...base, restaurantAccountId: "another-owner"}),
    () => ({...base, source: "legacy"}),
    () => ({...base, unexpected: "field"}),
  ];

  for (const [index, metadata] of fixtures.entries()) {
    harness.reset();
    const response = await dispatchWebhook(makeWebhookEvent(
      makeSubscription({metadata: metadata()}),
      {id: `evt_RuntimeBadMetadata${index + 1}`},
    ));
    assert.equal(response.statusCode, 500, String(index));
    assert.equal(response.sent, "Webhook processing failed.", String(index));
    assert.deepEqual(harness.state.dbCalls, [], String(index));
    assert.deepEqual(harness.state.sets, [], String(index));
    assert.deepEqual(harness.state.updates, [], String(index));
    assertLogsContainNoSensitiveValues(harness.state.logs);
  }
});

test("supported webhook events require a positive safe integer event.created", async () => {
  for (const [index, created] of [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ].entries()) {
    harness.reset();
    const event = makeWebhookEvent(
      makeSubscription(),
      {id: `evt_RuntimeBadCreated${index + 1}`},
    );
    event.created = created;
    const response = await dispatchWebhook(event);
    assert.equal(response.statusCode, 500, String(created));
    assert.equal(response.sent, "Webhook processing failed.", String(created));
    assert.deepEqual(harness.state.dbCalls, [], String(created));
    assert.deepEqual(harness.state.sets, [], String(created));
    assert.deepEqual(harness.state.updates, [], String(created));
    assertLogsContainNoSensitiveValues(harness.state.logs);
  }
});

test("missing private authority is an acknowledged fail-closed no-op", async () => {
  for (const missing of ["owner", "billing"]) {
    harness.reset();
    if (missing === "owner") {
      harness.state.ownerRecordExists = false;
      harness.state.ownerRecordDocument = undefined;
    } else {
      harness.state.ownerBillingExists = false;
      harness.state.ownerBillingDocument = undefined;
    }
    const response = await dispatchWebhook(makeWebhookEvent());
    assertAcknowledged(response);
    assert.deepEqual(harness.state.sets, [], missing);
    assert.deepEqual(harness.state.updates, [], missing);
    assert.deepEqual(harness.state.creates, [], missing);
  }
});

test("stale generation is ignored and future generation becomes private unknown without a root update", async () => {
  const staleResponse = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({
      id: "sub_RuntimeStaleGenerationOther1",
      customer: "cus_RuntimeStaleGenerationOther1",
      status: "canceled",
      metadata: makeMetadata({
        ownerRecordGeneration: ownerGeneration - 1,
        checkoutAttemptId: "attempt_RuntimeStaleGenerationOther1",
      }),
    }),
    {id: "evt_RuntimeStaleGeneration1"},
  ));
  assertAcknowledged(staleResponse);
  assert.deepEqual(privateBillingWrites(), []);
  assert.deepEqual(harness.state.updates, []);

  harness.reset();
  const futureResponse = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({
      metadata: makeMetadata({ownerRecordGeneration: ownerGeneration + 1}),
    }),
    {id: "evt_RuntimeFutureGeneration1"},
  ));
  assertAcknowledged(futureResponse);
  assert.equal(privateBillingWrites().length, 1);
  assert.equal(privateBillingWrites()[0].data.lifecycleState, "unknown");
  assert.equal(privateBillingWrites()[0].data.billingPosture, "unknown");
  assert.equal(
    privateBillingWrites()[0].data.stripeEventConflictKind,
    "identity",
  );
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.creates, []);
});

test("older, exact-duplicate, and equal-time equivalent events are idempotent no-ops", async () => {
  const fixtures = [
    {
      id: "evt_RuntimeOlder1",
      created: baselineEventCreated - 1,
    },
    {
      id: "evt_RuntimeBaseline1",
      created: baselineEventCreated,
    },
    {
      id: "evt_RuntimeEquivalent1",
      created: baselineEventCreated,
    },
  ];
  for (const fixture of fixtures) {
    harness.reset();
    const before = clone(harness.state.ownerBillingDocument);
    const response = await dispatchWebhook(makeWebhookEvent(
      makeSubscription(),
      fixture,
    ));
    assertAcknowledged(response);
    assert.deepEqual(privateBillingWrites(), [], fixture.id);
    assert.deepEqual(harness.state.ownerBillingDocument, before, fixture.id);
    assert.deepEqual(harness.state.updates, [], fixture.id);
  }
});

test("a strictly older same-generation event cannot regress private or root state despite wholly different billing identity", async () => {
  const billingBefore = clone(harness.state.ownerBillingDocument);
  const accountBefore = clone(harness.state.accountDocument);
  const response = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({
      id: "sub_RuntimeOlderOther1",
      customer: "cus_RuntimeOlderOther1",
      status: "canceled",
      metadata: makeMetadata({
        checkoutAttemptId: "attempt_RuntimeOlderOther1",
      }),
    }),
    {
      id: "evt_RuntimeOlderOtherIdentity1",
      created: baselineEventCreated - 1,
    },
  ));

  assertAcknowledged(response);
  assert.deepEqual(privateBillingWrites(), []);
  assert.deepEqual(harness.state.ownerBillingDocument, billingBefore);
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.accountDocument, accountBefore);
  assert.deepEqual(harness.state.creates, []);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("equal-time conflicts become unknown and a strictly newer valid event resolves them", async () => {
  const conflictResponse = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({status: "canceled"}),
    {
      id: "evt_RuntimeEqualConflict1",
      created: baselineEventCreated,
    },
  ));
  assertAcknowledged(conflictResponse);
  assert.equal(privateBillingWrites().length, 1);
  assert.equal(harness.state.ownerBillingDocument.lifecycleState, "unknown");
  assert.equal(harness.state.ownerBillingDocument.billingPosture, "unknown");
  assert.equal(
    harness.state.ownerBillingDocument.stripeEventConflictKind,
    "event_order",
  );
  assert.deepEqual(harness.state.updates, []);

  const resolvedResponse = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({status: "past_due"}),
    {
      id: "evt_RuntimeConflictResolved1",
      created: baselineEventCreated + 1,
    },
  ));
  assertAcknowledged(resolvedResponse);
  assert.equal(privateBillingWrites().length, 2);
  assert.equal(harness.state.ownerBillingDocument.lifecycleState, "subscription_known");
  assert.equal(harness.state.ownerBillingDocument.rawStripeStatus, "past_due");
  assert.equal(harness.state.ownerBillingDocument.billingPosture, "blocking");
  assert.equal(harness.state.ownerBillingDocument.stripeEventConflictKind, null);
  assert.equal(harness.state.updates.length, 1);
  assert.equal(harness.state.updates[0].data.subscriptionStatus, "active");
});

test("same event identity with contradictory payload becomes an event-order conflict", async () => {
  const response = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({status: "canceled"}),
    {
      id: "evt_RuntimeBaseline1",
      created: baselineEventCreated,
    },
  ));
  assertAcknowledged(response);
  assert.equal(privateBillingWrites().length, 1);
  assert.equal(harness.state.ownerBillingDocument.lifecycleState, "unknown");
  assert.equal(
    harness.state.ownerBillingDocument.stripeEventConflictKind,
    "event_order",
  );
  assert.deepEqual(harness.state.updates, []);
});

test("equal-time and newer checkout-attempt, customer, or subscription identity mismatch fails closed", async () => {
  const fixtures = [
    {
      created: baselineEventCreated,
      subscription: makeSubscription({
        metadata: makeMetadata({checkoutAttemptId: "attempt_RuntimeOther1"}),
      }),
    },
    {
      created: baselineEventCreated,
      subscription: makeSubscription({customer: "cus_RuntimeOther1"}),
    },
    {
      created: baselineEventCreated,
      subscription: makeSubscription({id: "sub_RuntimeOther1"}),
    },
    {
      created: baselineEventCreated + 1,
      subscription: makeSubscription({
        metadata: makeMetadata({checkoutAttemptId: "attempt_RuntimeOther1"}),
      }),
    },
    {
      created: baselineEventCreated + 1,
      subscription: makeSubscription({customer: "cus_RuntimeOther1"}),
    },
    {
      created: baselineEventCreated + 1,
      subscription: makeSubscription({id: "sub_RuntimeOther1"}),
    },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    harness.reset();
    const response = await dispatchWebhook(makeWebhookEvent(
      fixture.subscription,
      {
        id: `evt_RuntimeIdentityMismatch${index + 1}`,
        created: fixture.created,
      },
    ));
    assertAcknowledged(response);
    assert.equal(privateBillingWrites().length, 1, String(index));
    assert.equal(
      harness.state.ownerBillingDocument.lifecycleState,
      "unknown",
      String(index),
    );
    assert.equal(
      harness.state.ownerBillingDocument.stripeEventConflictKind,
      "identity",
      String(index),
    );
    assert.deepEqual(harness.state.updates, [], String(index));
    assertLogsContainNoSensitiveValues(harness.state.logs);
  }
});

test("root generation and current Stripe identity mismatches block only the root patch", async () => {
  const accountVariants = [
    {ownerRecordGeneration: ownerGeneration + 1},
    {stripeCustomerId: "cus_RuntimeRootOther1"},
    {stripeSubscriptionId: "sub_RuntimeRootOther1"},
  ];
  for (const [index, accountPatch] of accountVariants.entries()) {
    harness.reset();
    Object.assign(harness.state.accountDocument, accountPatch);
    const response = await dispatchWebhook(makeWebhookEvent(
      makeSubscription({status: "past_due"}),
      {id: `evt_RuntimeRootMismatch${index + 1}`},
    ));
    assertAcknowledged(response);
    assert.equal(privateBillingWrites().length, 1, String(index));
    assert.equal(
      harness.state.ownerBillingDocument.rawStripeStatus,
      "past_due",
      String(index),
    );
    assert.deepEqual(harness.state.updates, [], String(index));
    assert.deepEqual(harness.state.creates, [], String(index));
  }
});

test("a missing account root is never recreated while private billing still advances", async () => {
  harness.state.accountExists = false;
  harness.state.accountDocument = undefined;

  const response = await dispatchWebhook(makeWebhookEvent(
    makeSubscription({status: "canceled"}),
    {id: "evt_RuntimeMissingRoot1"},
  ));

  assertAcknowledged(response);
  assert.equal(privateBillingWrites().length, 1);
  assert.equal(harness.state.ownerBillingDocument.rawStripeStatus, "canceled");
  assert.equal(harness.state.ownerBillingDocument.billingPosture, "inactive");
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.creates, []);
});

test("removing and removed owner states block private regression and every account-root update", async () => {
  for (const ownerState of ["removing", "removed"]) {
    harness.reset();
    harness.state.ownerRecordDocument = clone(makeOwnerState({state: ownerState}));
    const before = clone(harness.state.ownerBillingDocument);
    const response = await dispatchWebhook(makeWebhookEvent(
      makeSubscription({
        id: `sub_RuntimeOwner${ownerState === "removing" ? "Removing" : "Removed"}Other1`,
        customer: `cus_RuntimeOwner${ownerState === "removing" ? "Removing" : "Removed"}Other1`,
        status: "canceled",
        metadata: makeMetadata({
          checkoutAttemptId:
            `attempt_RuntimeOwner${ownerState === "removing" ? "Removing" : "Removed"}Other1`,
        }),
      }),
      {id: `evt_RuntimeOwner${ownerState === "removing" ? "Removing" : "Removed"}1`},
    ));
    assertAcknowledged(response);
    assert.deepEqual(harness.state.ownerBillingDocument, before, ownerState);
    assert.deepEqual(privateBillingWrites(), [], ownerState);
    assert.deepEqual(harness.state.updates, [], ownerState);
    assert.deepEqual(harness.state.creates, [], ownerState);
  }
});

test("non-open owners ignore known and unsupported future-generation events", async () => {
  const statusCases = [
    {label: "Known", status: "canceled"},
    {label: "Unsupported", status: "future_runtime_billing_status"},
  ];

  for (const ownerState of ["removing", "removed"]) {
    for (const statusCase of statusCases) {
      harness.reset();
      harness.state.ownerRecordDocument = clone(
        makeOwnerState({state: ownerState}),
      );
      harness.state.ownerBillingDocument = clone(makePendingBillingState());
      const label = `${ownerState}/${statusCase.label}`;
      const suffix =
        `${ownerState === "removing" ? "Removing" : "Removed"}` +
        statusCase.label;
      const eventId = `evt_RuntimeNonOpenFuture${suffix}1`;
      const ownerBefore = clone(harness.state.ownerRecordDocument);
      const billingBefore = clone(harness.state.ownerBillingDocument);
      const accountBefore = clone(harness.state.accountDocument);

      const response = await dispatchWebhook(makeWebhookEvent(
        makeSubscription({
          status: statusCase.status,
          metadata: makeMetadata({
            ownerRecordGeneration: ownerGeneration + 1,
          }),
        }),
        {
          id: eventId,
          created: baselineEventCreated + 100,
        },
      ));

      assertAcknowledged(response);
      assert.deepEqual(privateOwnerWrites(), [], label);
      assert.deepEqual(privateBillingWrites(), [], label);
      assert.deepEqual(returnLedgerWrites(), [], label);
      assert.deepEqual(harness.state.sets, [], label);
      assert.deepEqual(harness.state.updates, [], label);
      assert.deepEqual(harness.state.creates, [], label);
      assert.deepEqual(
        harness.state.ownerRecordDocument,
        ownerBefore,
        label,
      );
      assert.deepEqual(
        harness.state.ownerBillingDocument,
        billingBefore,
        label,
      );
      assert.deepEqual(harness.state.accountDocument, accountBefore, label);
      assert.equal(
        harness.state.ownerBillingDocument.lifecycleState,
        "checkout_pending",
        label,
      );
      assert.equal(
        harness.state.ownerBillingDocument.billingPosture,
        "blocking",
        label,
      );
      assert.equal(
        harness.state.ownerBillingDocument.ownerRecordGeneration,
        ownerGeneration,
        label,
      );
      assert.equal(
        harness.state.ownerRecordDocument.state,
        ownerState,
        label,
      );
      assert.equal(
        harness.state.ownerRecordDocument.updatedAt.getTime(),
        ownerBefore.updatedAt.getTime(),
        label,
      );
      assert.equal(
        harness.state.ownerBillingDocument.updatedAt.getTime(),
        billingBefore.updatedAt.getTime(),
        label,
      );
      for (const field of [
        "lastStripeEventCreated",
        "lastStripeEventId",
        "lastStripeEventPayloadFingerprint",
        "stripeEventConflictKind",
      ]) {
        assert.deepEqual(
          harness.state.ownerBillingDocument[field],
          billingBefore[field],
          `${label}/${field}`,
        );
      }
      assert.deepEqual(harness.state.subscriptionRetrieveCalls, [], label);
      assert.deepEqual(harness.state.billingPortalCalls, [], label);
      assert.equal(harness.state.stripeConstructorCalls, 1, label);
      assert.equal(harness.state.constructEventCalls, 1, label);
      assert.deepEqual(harness.state.logs, [], label);
      assertLogsContainNoSensitiveValues(harness.state.logs, [
        eventId,
        ...(statusCase.label === "Unsupported"
          ? [statusCase.status]
          : []),
      ]);
      if (statusCase.label === "Unsupported") {
        assert.equal(
          JSON.stringify(harness.state.ownerBillingDocument)
            .includes(statusCase.status),
          false,
          label,
        );
      }
    }
  }
});

test("checkout completion binds only matching final metadata and never establishes subscription status", async () => {
  harness.state.ownerBillingDocument = clone(makePendingBillingState());
  harness.state.subscriptionRetrieveResponse = makeSubscription();

  const response = await dispatchWebhook(makeCheckoutCompletedEvent());

  assertAcknowledged(response);
  assert.deepEqual(harness.state.subscriptionRetrieveCalls, [
    sensitiveCanaries.subscription,
  ]);
  assert.equal(privateBillingWrites().length, 1);
  const billing = harness.state.ownerBillingDocument;
  assert.equal(billing.lifecycleState, "checkout_pending");
  assert.equal(billing.billingPosture, "blocking");
  assert.equal(billing.checkoutSessionId, sensitiveCanaries.checkoutSession);
  assert.equal(billing.stripeCustomerId, sensitiveCanaries.customer);
  assert.equal(billing.stripeSubscriptionId, null);
  assert.equal(billing.lastStripeEventCreated, null);
  assert.deepEqual(harness.state.updates, []);
});

test("checkout completion rejects mismatched metadata and ignores a stale generation", async () => {
  harness.state.ownerBillingDocument = clone(makePendingBillingState());
  harness.state.subscriptionRetrieveResponse = makeSubscription({
    metadata: makeMetadata({checkoutAttemptId: "attempt_RuntimeOther1"}),
  });
  const mismatchResponse = await dispatchWebhook(makeCheckoutCompletedEvent());
  assert.equal(mismatchResponse.statusCode, 500);
  assert.deepEqual(privateBillingWrites(), []);
  assert.deepEqual(harness.state.updates, []);
  assertLogsContainNoSensitiveValues(harness.state.logs);

  harness.reset();
  harness.state.ownerBillingDocument = clone(makePendingBillingState());
  const staleMetadata = makeMetadata({
    ownerRecordGeneration: ownerGeneration - 1,
  });
  harness.state.subscriptionRetrieveResponse = makeSubscription({
    metadata: staleMetadata,
  });
  const staleResponse = await dispatchWebhook(makeCheckoutCompletedEvent({
    metadata: staleMetadata,
  }));
  assertAcknowledged(staleResponse);
  assert.deepEqual(privateBillingWrites(), []);
  assert.deepEqual(harness.state.updates, []);
});

test("webhook transaction failures return retry-safe sanitized HTTP 500", async () => {
  harness.state.transactionFailure = {
    name: "FirestoreError",
    code: "aborted",
    message: sensitiveCanaries.document,
    stack: sensitiveCanaries.stack,
    event: makeWebhookEvent(),
  };
  const response = await dispatchWebhook(makeWebhookEvent());

  assert.equal(response.statusCode, 500);
  assert.equal(response.sent, "Webhook processing failed.");
  assert.deepEqual(harness.state.sets, []);
  assert.deepEqual(harness.state.updates, []);
  assert.deepEqual(harness.state.logs, [{
    level: "error",
    message: "Stripe webhook event processing failed",
    metadata: {
      stage: "webhook_event_processing",
      errorCategory: "firestore_error",
    },
  }]);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("portal configuration and authentication fail before private-state or Stripe access", async () => {
  harness.state.parameterValue = "https://app.bitestar.app/wrong";
  await assert.rejects(
    () => harness.createCustomerPortalSession({
      auth: {uid: sensitiveCanaries.uid},
      data: {
        returnProtocolVersion: 2,
        restaurantAccountDocumentId: sensitiveCanaries.uid,
      },
    }),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "failed-precondition");
      return true;
    },
  );
  assert.deepEqual(harness.state.dbCalls, []);
  assert.deepEqual(harness.state.billingPortalCalls, []);
  assertLogsContainNoSensitiveValues(harness.state.logs);

  harness.reset();
  await assert.rejects(
    () => harness.createCustomerPortalSession({
      auth: null,
      data: {
        returnProtocolVersion: 2,
        restaurantAccountDocumentId: sensitiveCanaries.uid,
      },
    }),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "unauthenticated");
      return true;
    },
  );
  assert.deepEqual(harness.state.dbCalls, []);
  assert.deepEqual(harness.state.billingPortalCalls, []);
});

async function assertPortalGateRejectsWithoutStripe() {
  await assert.rejects(
    () => harness.createCustomerPortalSession({
      auth: {uid: sensitiveCanaries.uid},
      data: {
        returnProtocolVersion: 2,
        restaurantAccountDocumentId: sensitiveCanaries.uid,
      },
    }),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      for (const canary of Object.values(sensitiveCanaries)) {
        assert.equal(error.message.includes(canary), false, canary);
      }
      return true;
    },
  );
  assert.equal(harness.state.stripeConstructorCalls, 0);
  assert.deepEqual(harness.state.billingPortalCalls, []);
  assert.deepEqual(privateOwnerWrites(), []);
  assert.deepEqual(privateBillingWrites(), []);
  assert.deepEqual(returnLedgerWrites(), []);
  assertLogsContainNoSensitiveValues(harness.state.logs);
}

test("portal generation, owner lifecycle, and exact customer gates reject before Stripe", async () => {
  harness.state.ownerRecordDocument = clone(makeOwnerState({
    generation: ownerGeneration + 1,
  }));
  harness.state.accountDocument.ownerRecordGeneration = ownerGeneration + 1;
  await assertPortalGateRejectsWithoutStripe();

  for (const ownerState of ["removing", "removed"]) {
    harness.reset();
    harness.state.ownerRecordDocument = clone(makeOwnerState({state: ownerState}));
    await assertPortalGateRejectsWithoutStripe();
  }

  harness.reset();
  harness.state.accountDocument.stripeCustomerId = "cus_RuntimeOther1";
  await assertPortalGateRejectsWithoutStripe();

  harness.reset();
  harness.state.ownerRecordExists = false;
  harness.state.ownerRecordDocument = undefined;
  await assertPortalGateRejectsWithoutStripe();
});

test("portal requires an existing linked customer before reading private state", async () => {
  delete harness.state.accountDocument.stripeCustomerId;

  await assert.rejects(
    () => harness.createCustomerPortalSession({
      auth: {uid: sensitiveCanaries.uid},
      data: {
        returnProtocolVersion: 2,
        restaurantAccountDocumentId: sensitiveCanaries.uid,
      },
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
  assert.deepEqual(harness.state.billingPortalCalls, []);
  assert.deepEqual(privateOwnerWrites(), []);
  assert.deepEqual(privateBillingWrites(), []);
  assert.deepEqual(returnLedgerWrites(), []);
});

test("successful portal creation preserves billing state and keeps generation and Stripe IDs private", async () => {
  const billingBefore = clone(harness.state.ownerBillingDocument);

  const result = await harness.createCustomerPortalSession({
    auth: {uid: sensitiveCanaries.uid},
    data: {
      returnProtocolVersion: 2,
      restaurantAccountDocumentId: sensitiveCanaries.uid,
    },
  });

  assert.equal(result.returnProtocolVersion, 2);
  assert.match(result.returnToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(result).sort(), [
    "returnProtocolVersion",
    "returnToken",
    "url",
  ]);
  assert.deepEqual(harness.state.billingPortalCalls, [{
    customer: sensitiveCanaries.customer,
    return_url: `${canonicalReturnUrl}?return_token=${result.returnToken}`,
  }]);
  assert.deepEqual(harness.state.ownerBillingDocument, billingBefore);
  for (const write of privateBillingWrites()) {
    assert.deepEqual(write.data, billingBefore);
  }
  assert.deepEqual(privateOwnerWrites(), []);
  assert.equal(returnLedgerWrites().length, 2);
  assert.equal(
    harness.state.ledgerDocument.ownerRecordGeneration,
    ownerGeneration,
  );
  assert.deepEqual(harness.state.logs, []);
});

test("portal Stripe failure is sanitized and does not alter authoritative billing state", async () => {
  const billingBefore = clone(harness.state.ownerBillingDocument);
  harness.state.billingPortalFailure = {
    name: "StripeAPIError",
    type: "StripeAPIError",
    message: sensitiveCanaries.customer,
    stack: sensitiveCanaries.stack,
    portalUrl: sensitiveCanaries.portalUrl,
    uid: sensitiveCanaries.uid,
  };

  await assert.rejects(
    () => harness.createCustomerPortalSession({
      auth: {uid: sensitiveCanaries.uid},
      data: {
        returnProtocolVersion: 2,
        restaurantAccountDocumentId: sensitiveCanaries.uid,
      },
    }),
    (error) => {
      assert.ok(error instanceof MockHttpsError);
      assert.equal(error.code, "internal");
      return true;
    },
  );

  assert.deepEqual(harness.state.ownerBillingDocument, billingBefore);
  assert.deepEqual(harness.state.logs, [{
    level: "error",
    message: "Stripe Customer Portal session creation failed",
    metadata: {
      stage: "customer_portal_session_creation",
      errorCategory: "stripe_api_error",
    },
  }]);
  assertLogsContainNoSensitiveValues(harness.state.logs);
});

test("source wiring retains strict event-created input, generation-bound private refs, and sanitized logging", () => {
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

  assert.match(source, /private_owner_record_states|ownerRecordStateCollection/);
  assert.match(source, /private_owner_billing_states|ownerBillingStateCollection/);
  assert.match(
    source,
    /createOwnerBillingWebhookEvent\(\{[\s\S]*?eventCreated:\s*event\.created/,
  );
  assert.match(
    source,
    /transaction\.get\(ownerRef\)[\s\S]*?transaction\.get\(billingRef\)[\s\S]*?transaction\.get\(accountRef\)/,
  );
  assert.match(
    source,
    /requireOwnerBillingPortalGate\([\s\S]*?stripeCustomerId/,
  );
  assert.match(
    webhookSource,
    /stripe\.webhooks\.constructEvent\(\s*request\.rawBody,\s*signature,\s*stripeWebhookSecret\.value\(\)/,
  );
  assert.doesNotMatch(portalSource, /error\.(?:message|stack)/);
  assert.doesNotMatch(webhookSource, /error\.(?:message|stack)/);
  assert.doesNotMatch(webhookSource, /type:\s*event\.type/);
  for (const region of [portalSource, webhookSource]) {
    const loggerCalls = [
      ...region.matchAll(
        /logger\.(?:debug|error|info|log|warn)\([\s\S]*?\);/g,
      ),
    ].map((match) => match[0]);
    for (const loggerCall of loggerCalls) {
      assert.doesNotMatch(
        loggerCall,
        /\b(?:ownerUid|stripeCustomerId|returnUrl|ownerRecordGeneration)\s*[,}]|session\.url|subscription\.id|event\.id/,
      );
      assert.doesNotMatch(
        loggerCall,
        /\{\s*(?:\.\.\.)?(?:error|rawError)\b|,\s*(?:error|rawError)\s*\);/,
      );
    }
  }
});
