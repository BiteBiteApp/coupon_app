"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const {
  stripeLogMetadata,
  stripeLogStages,
} = require("../lib/stripe_log_safety.js");
const stripeLogSafetyModulePath = require.resolve(
  "../lib/stripe_log_safety.js",
);

const canaries = Object.freeze([
  "fake-signature-secret",
  "{\"customer\":\"cus_fake_raw_body\"}",
  "sk_test_fake_api_secret",
  "whsec_fake_webhook_secret",
  "cus_fake_customer",
  "sub_fake_subscription",
  "cs_fake_checkout",
  "pi_fake_payment",
  "bps_fake_portal",
  "owner@example.test",
  "uid_fake_owner",
  "restaurant_accounts/fake-owner",
  "https://example.test/request?secret=fake",
  "Error: fake stack trace",
]);

function maliciousError(overrides = {}) {
  const circular = {
    message: canaries.join(" "),
    stack: canaries[12],
    signature: canaries[0],
    rawBody: canaries[1],
    headers: {authorization: canaries[2]},
    customerId: canaries[4],
    subscriptionId: canaries[5],
    checkoutSessionId: canaries[6],
    paymentIntentId: canaries[7],
    portalSessionId: canaries[8],
    email: canaries[9],
    uid: canaries[10],
    documentId: canaries[11],
    requestUrl: canaries[12],
    nested: {secret: canaries[3]},
    ...overrides,
  };
  circular.circular = circular;
  return circular;
}

function assertSafeMetadata(metadata, expectedCategory) {
  assert.deepEqual(Object.keys(metadata).sort(), [
    "errorCategory",
    "stage",
  ]);
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(metadata.errorCategory, expectedCategory);
  let serialized;
  assert.doesNotThrow(() => {
    serialized = JSON.stringify(metadata);
  });
  for (const canary of canaries) {
    assert.equal(serialized.includes(canary), false, canary);
  }
  assert.doesNotMatch(
    serialized,
    /"(?:message|stack|signature|rawBody|headers|customerId|subscriptionId|checkoutSessionId|paymentIntentId|portalSessionId|email|uid|documentId|requestUrl|secret)"\s*:/i,
  );
}

test("the helper exposes only the strict supported-stage allowlist", () => {
  const intendedStages = [
    "webhook_signature_verification",
    "webhook_event_processing",
    "webhook_subscription_sync",
    "customer_portal_session_creation",
  ];

  assert.deepEqual(stripeLogStages, intendedStages);
  assert.equal(Object.isFrozen(stripeLogStages), true);
  for (const stage of intendedStages) {
    assert.doesNotThrow(() => {
      const metadata = stripeLogMetadata(stage, maliciousError());
      assert.equal(metadata.stage, stage);
      assertSafeMetadata(
        metadata,
        stage === "webhook_signature_verification" ?
          "invalid_signature" :
          "unknown_error",
      );
    });
  }
  assert.throws(
    () => stripeLogMetadata("arbitrary_stage", new Error("hidden")),
    /Unsupported Stripe log stage/,
  );
});

test("consumers cannot mutate or replace the supported-stage boundary", () => {
  const arbitraryStage = "stage_with_" + canaries[2];
  const moduleExports = require(stripeLogSafetyModulePath);

  assert.equal(
    Object.values(moduleExports).some((value) => value instanceof Set),
    false,
  );
  assert.throws(() => stripeLogStages.push(arbitraryStage), TypeError);
  assert.throws(
    () => Object.defineProperty(stripeLogStages, "0", {
      value: arbitraryStage,
    }),
    TypeError,
  );
  assert.deepEqual(stripeLogStages, [
    "webhook_signature_verification",
    "webhook_event_processing",
    "webhook_subscription_sync",
    "customer_portal_session_creation",
  ]);
  assert.throws(
    () => stripeLogMetadata(arbitraryStage, maliciousError()),
    /Unsupported Stripe log stage/,
  );

  delete require.cache[stripeLogSafetyModulePath];
  const reimportedModule = require(stripeLogSafetyModulePath);
  assert.notEqual(reimportedModule.stripeLogStages, stripeLogStages);
  assert.equal(Object.isFrozen(reimportedModule.stripeLogStages), true);
  assert.deepEqual(reimportedModule.stripeLogStages, stripeLogStages);
  assert.throws(
    () => reimportedModule.stripeLogStages.push(arbitraryStage),
    TypeError,
  );
  assert.throws(
    () => reimportedModule.stripeLogMetadata(
      arbitraryStage,
      maliciousError(),
    ),
    /Unsupported Stripe log stage/,
  );
});

test("signature errors always become safe invalid-signature metadata", () => {
  const raw = maliciousError({
    name: "StripeSignatureVerificationError",
    type: "StripeSignatureVerificationError",
  });
  const metadata = stripeLogMetadata(
    "webhook_signature_verification",
    raw,
  );

  assertSafeMetadata(metadata, "invalid_signature");
  assert.notEqual(metadata, raw);
});

test("Stripe, Firestore, configuration, and unknown failures classify coarsely", () => {
  const fixtures = [
    {
      stage: "webhook_event_processing",
      error: maliciousError({type: "StripeAPIError"}),
      expected: "stripe_api_error",
    },
    {
      stage: "webhook_subscription_sync",
      error: maliciousError({name: "FirestoreError", code: "aborted"}),
      expected: "firestore_error",
    },
    {
      stage: "webhook_subscription_sync",
      error: maliciousError({
        name: "FirebaseError",
        code: "firestore/unavailable",
      }),
      expected: "firestore_error",
    },
    {
      stage: "customer_portal_session_creation",
      error: maliciousError({
        name: "SubscriptionPortalConfigurationError",
        code: "subscription_portal_configuration_error",
      }),
      expected: "configuration_error",
    },
    {
      stage: "webhook_event_processing",
      error: maliciousError(),
      expected: "unknown_error",
    },
  ];

  for (const fixture of fixtures) {
    const metadata = stripeLogMetadata(
      fixture.stage,
      fixture.error,
    );
    assertSafeMetadata(metadata, fixture.expected);
    assert.notEqual(metadata, fixture.error);
  }
});

test("primitives, circular data, throwing getters, and hostile proxies never escape", () => {
  const throwingGetter = {};
  Object.defineProperty(throwingGetter, "name", {
    get() {
      throw new Error(canaries[2]);
    },
  });
  Object.defineProperty(throwingGetter, "code", {
    get() {
      throw new Error(canaries[3]);
    },
  });
  Object.defineProperty(throwingGetter, "type", {
    get() {
      throw new Error(canaries[0]);
    },
  });
  const hostileProxy = new Proxy(
    {},
    {
      get() {
        throw new Error(canaries[1]);
      },
    },
  );

  const inputs = [
    null,
    undefined,
    "raw string error",
    42,
    true,
    maliciousError(),
    throwingGetter,
    hostileProxy,
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => {
      const metadata = stripeLogMetadata(
        "webhook_event_processing",
        input,
      );
      assertSafeMetadata(metadata, "unknown_error");
    });
  }
});

test("malicious conversion hooks and deeply nested secrets are never traversed", () => {
  let toJSONCalls = 0;
  let toStringCalls = 0;
  const hostileConversions = maliciousError({
    toJSON() {
      toJSONCalls += 1;
      throw new Error(canaries[2]);
    },
    toString() {
      toStringCalls += 1;
      throw new Error(canaries[3]);
    },
  });

  let deeplyNested = {secret: canaries[0]};
  for (let depth = 0; depth < 10000; depth += 1) {
    deeplyNested = {nested: deeplyNested};
  }

  for (const input of [hostileConversions, deeplyNested]) {
    let metadata;
    assert.doesNotThrow(() => {
      metadata = stripeLogMetadata(
        "webhook_event_processing",
        input,
      );
    });
    assertSafeMetadata(metadata, "unknown_error");
    assert.notEqual(metadata, input);
  }
  assert.equal(toJSONCalls, 0);
  assert.equal(toStringCalls, 0);
});

test("only narrow string-property reads occur on hostile proxies", () => {
  const traps = {
    get: 0,
    has: 0,
    ownKeys: 0,
    getOwnPropertyDescriptor: 0,
  };
  const readProperties = [];
  const hostileProxy = new Proxy(
    {},
    {
      get(_target, property) {
        traps.get += 1;
        readProperties.push(property);
        throw new Error(canaries[0]);
      },
      has() {
        traps.has += 1;
        throw new Error(canaries[1]);
      },
      ownKeys() {
        traps.ownKeys += 1;
        throw new Error(canaries[2]);
      },
      getOwnPropertyDescriptor() {
        traps.getOwnPropertyDescriptor += 1;
        throw new Error(canaries[3]);
      },
    },
  );

  let metadata;
  assert.doesNotThrow(() => {
    metadata = stripeLogMetadata(
      "webhook_event_processing",
      hostileProxy,
    );
  });
  assertSafeMetadata(metadata, "unknown_error");
  assert.notEqual(metadata, hostileProxy);
  assert.equal(traps.get, 3);
  assert.deepEqual(readProperties, ["name", "code", "type"]);
  assert.equal(traps.has, 0);
  assert.equal(traps.ownKeys, 0);
  assert.equal(traps.getOwnPropertyDescriptor, 0);
});

test("enumerable secrets and throwing constructor or name access never escape", () => {
  let constructorReads = 0;
  let nameReads = 0;
  const hostileAccessors = {
    signature: canaries[0],
    rawBody: canaries[1],
    secret: canaries[2],
  };
  Object.defineProperty(hostileAccessors, "constructor", {
    enumerable: true,
    get() {
      constructorReads += 1;
      throw new Error(canaries[3]);
    },
  });
  Object.defineProperty(hostileAccessors, "name", {
    enumerable: true,
    get() {
      nameReads += 1;
      throw new Error(canaries[4]);
    },
  });

  let metadata;
  assert.doesNotThrow(() => {
    metadata = stripeLogMetadata(
      "customer_portal_session_creation",
      hostileAccessors,
    );
  });
  assertSafeMetadata(metadata, "unknown_error");
  assert.notEqual(metadata, hostileAccessors);
  assert.equal(nameReads, 1);
  assert.equal(constructorReads, 0);
});

test("the log-safety module imports without Firebase, Stripe, environment, network, or logging effects", () => {
  const helperModulePath = path.resolve(
    __dirname,
    "../lib/stripe_log_safety.js",
  );
  const functionsEntryPointPath = path.resolve(__dirname, "../lib/index.js");
  const childScript = `
    const Module = require("node:module");
    const helperModulePath = process.argv[1];
    const functionsEntryPointPath = process.argv[2];
    const fail = (message) => () => { throw new Error(message); };
    global.fetch = fail("stripe log helper performed global fetch");
    for (const method of ["log", "info", "warn", "error", "debug", "trace"]) {
      console[method] = fail("stripe log helper logged through console." + method);
    }
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (
        request === "stripe" ||
        request === "firebase-admin" ||
        request.startsWith("firebase-admin/") ||
        request === "firebase-functions" ||
        request.startsWith("firebase-functions/")
      ) {
        throw new Error("stripe log helper loaded " + request);
      }
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolved === functionsEntryPointPath) {
        throw new Error("stripe log helper imported the Functions entry point");
      }
      return originalLoad.apply(this, arguments);
    };
    const beforeKeys = Object.keys(process.env).sort();
    require(helperModulePath);
    const afterKeys = Object.keys(process.env).sort();
    if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
      throw new Error("stripe log helper changed environment variables");
    }
    if (require.cache[functionsEntryPointPath]) {
      throw new Error("stripe log helper cached the Functions entry point");
    }
    process.stdout.write("stripe-log-safety-loaded");
  `;
  const environment = {...process.env};
  for (const variable of [
    "FIREBASE_CONFIG",
    "GCLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    delete environment[variable];
  }

  const result = spawnSync(
    process.execPath,
    ["-e", childScript, helperModulePath, functionsEntryPointPath],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      env: environment,
      timeout: 5000,
    },
  );

  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "stripe-log-safety-loaded");
});
