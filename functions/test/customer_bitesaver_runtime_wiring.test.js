"use strict";

const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const Module = require("node:module");
const protectedMetadata = require(
  "./fixtures/customer_bitesaver_pre_device_runtime_metadata.json",
);
const biteScoreMetadata = require("./fixtures/customer_bitescore_runtime_metadata.json");
const path = require("node:path");
const test = require("node:test");

const actualFirestore = require("firebase-admin/firestore");
const {
  CustomerBiteSaverContractError,
} = require("../lib/customer_bitesaver_search_contract.js");
const {CustomerBiteSaverDeviceChallengeLimitError} = require(
  "../lib/customer_bitesaver_device_challenge_admission.js",
);

const callableHandlers = Object.freeze({
  startCustomerBiteSaverSearch: "startCustomerBiteSaverSearchHandler",
  getCustomerBiteSaverSearchStatus:
    "getCustomerBiteSaverSearchStatusHandler",
  getCustomerBiteSaverSearchPage: "getCustomerBiteSaverSearchPageHandler",
  getCustomerBiteSaverOfferPage: "getCustomerBiteSaverOfferPageHandler",
  getCustomerBiteSaverMenuPage: "getCustomerBiteSaverMenuPageHandler",
  continueCustomerBiteSaverGuestOfferCheck:
    "continueCustomerBiteSaverGuestOfferCheckHandler",
  getCustomerBiteSaverFavoriteStates:
    "getCustomerBiteSaverFavoriteStatesHandler",
  getCustomerBiteSaverSavedPage: "getCustomerBiteSaverSavedPageHandler",
  getCustomerBiteSaverSavedMenuPage:
    "getCustomerBiteSaverSavedMenuPageHandler",
  validateCustomerBiteSaverSavedOfferRedemptionStart:
    "validateCustomerBiteSaverSavedOfferRedemptionStartHandler",
  validateCustomerBiteSaverOfferRedemptionStart:
    "validateCustomerBiteSaverOfferRedemptionStartHandler",
});
const retiredCallableExports = new Set([
  "startCustomerBiteSaverOfferRedemption",
  "startCustomerBiteSaverSavedOfferRedemption",
]);
const deviceCallableFactories = Object.freeze({
  issueCustomerBiteSaverDeviceUseChallenge:
    "createIssueCustomerBiteSaverDeviceUseChallengeHandler",
  useCustomerBiteSaverCoupon:
    "createProductionCustomerBiteSaverCouponUseHandler",
});
const allCallableExports = [
  ...Object.keys(callableHandlers),
  ...Object.keys(deviceCallableFactories),
];
const discoveryOnlyCallableExports = new Set([
  "startCustomerBiteSaverSearch",
  "getCustomerBiteSaverSearchStatus",
]);
const workerExport = "processPrivateCustomerBiteSaverSearchJob";
const workerHandler = "processCustomerBiteSaverSearchJob";
const discoverySecretName = "BITESAVER_CUSTOMER_DISCOVERY_KEY";
const identitySecretNameV1 = "BITESAVER_CUSTOMER_IDENTITY_KEY_V1";
const deviceRootSecretNameV1 = "BITESAVER_DEVICE_ROOT_KEY_V1";
const browseRuntimeServiceAccount =
  "bitesaver-browse-runtime@coupon-app-29446.iam.gserviceaccount.com";
const browseRuntimeExports = new Set([
  "startCustomerBiteSaverSearch",
  "getCustomerBiteSaverSearchStatus",
  "getCustomerBiteSaverSearchPage",
  "getCustomerBiteSaverOfferPage",
  "getCustomerBiteSaverMenuPage",
  "continueCustomerBiteSaverGuestOfferCheck",
  "getCustomerBiteSaverFavoriteStates",
  "getCustomerBiteSaverSavedPage",
  "getCustomerBiteSaverSavedMenuPage",
  "processPrivateCustomerBiteSaverSearchJob",
  "maintainBiteSaverRestaurantSearchIndex",
  "maintainBiteSaverCouponOfferSearchIndex",
  "processPrivateSearchIndexJob",
]);
const adminSupportRuntimeServiceAccount =
  "bitestar-admin-support-runtime@coupon-app-29446.iam.gserviceaccount.com";
const adminSupportRuntimeSecrets = Object.freeze({
  searchCouponAdminRestaurantsPage: [
    "SEARCH_PAGINATION_CURSOR_KEY", "GOOGLE_MAPS_API_KEY",
  ],
  listCouponAdminCouponsPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listCouponAdminInviteHistoryPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  searchRatingAdminRestaurantsPage: [
    "SEARCH_PAGINATION_CURSOR_KEY", "GOOGLE_MAPS_API_KEY",
  ],
  listRatingAdminDirectoryPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listRatingAdminInviteHistoryPage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listCouponAdminQueuePage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  listRatingAdminQueuePage: ["SEARCH_PAGINATION_CURSOR_KEY"],
  searchAdminLinkRestaurantsPage: [
    "SEARCH_PAGINATION_CURSOR_KEY", "GOOGLE_MAPS_API_KEY",
  ],
});

function expectedSecrets(exportName) {
  if (exportName === "issueCustomerBiteSaverDeviceUseChallenge") return [];
  if (exportName === "useCustomerBiteSaverCoupon") {
    return [discoverySecretName, identitySecretNameV1, deviceRootSecretNameV1];
  }
  return discoveryOnlyCallableExports.has(exportName)
    ? [discoverySecretName]
    : [discoverySecretName, identitySecretNameV1];
}

function loadActualCompiledMetadata() {
  const indexPath = path.resolve(__dirname, "../lib/index.js");
  const script = `
    const index = require(${JSON.stringify(indexPath)});
    const metadata = Object.fromEntries(
      Object.entries(index)
        .map(([name, exported]) => [name, exported.__endpoint ?? null]),
    );
    process.stdout.write(JSON.stringify(metadata));
  `;
  return JSON.parse(execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
  }));
}

function loadCompiledIndexWithCustomerBiteSaverHarness() {
  const customerDatabase = Object.freeze({kind: "customer-bitesaver-database"});
  const state = {
    adapterInputs: [],
    callableCalls: [],
    callableError: null,
    deviceCalls: [],
    deviceFactoryInputs: [],
    deviceFactoryError: null,
    deviceRootSecretValueV1: Buffer.alloc(32, 0x7c).toString("base64url"),
    discoverySecretValue: Buffer.alloc(32, 0x5a).toString("base64url"),
    globalOptions: null,
    identitySecretValueV1: Buffer.alloc(32, 0x6b).toString("base64url"),
    logs: [],
    secretResolutions: [],
    workerCalls: [],
    workerError: null,
  };
  const fakeDatabase = {
    async recursiveDelete() {},
    collection(collectionPath) {
      const query = {
        collectionPath,
        where() {
          return this;
        },
        orderBy() {
          return this;
        },
        limit() {
          return this;
        },
        async get() {
          return {docs: []};
        },
      };
      return query;
    },
  };
  class MockHttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  function endpointSecrets(options) {
    return Array.isArray(options.secrets) ? {
      secretEnvironmentVariables: options.secrets.map((secret) => secret.name),
    } : {};
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
        ...endpointSecrets(options),
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
        ...(options.timeoutSeconds === undefined ? {} : {
          timeoutSeconds: options.timeoutSeconds,
        }),
        ...endpointSecrets(options),
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
      ...endpointSecrets(options),
    };
    return handler;
  }
  const mockedSession = Object.fromEntries(
    Object.values(callableHandlers).map((name) => [name, async (data, context) => {
      state.callableCalls.push({name, data, context});
      if (state.callableError !== null) {
        throw state.callableError;
      }
      return Object.freeze({handler: name});
    }]),
  );
  mockedSession.customerBiteSaverCallableTimeoutSeconds = 120;
  const mockedSaved = Object.fromEntries(
    [
      "getCustomerBiteSaverSavedPageHandler",
      "getCustomerBiteSaverSavedMenuPageHandler",
      "startCustomerBiteSaverSavedOfferRedemptionHandler",
      "validateCustomerBiteSaverSavedOfferRedemptionStartHandler",
    ].map((name) => [name, mockedSession[name]]),
  );
  const deviceFactory = (name) => (dependencies) => {
    state.deviceFactoryInputs.push({name, dependencies});
    if (state.deviceFactoryError !== null) throw state.deviceFactoryError;
    return async (data, actor) => {
      state.deviceCalls.push({name, data, actor});
      if (state.callableError !== null) throw state.callableError;
      return Object.freeze({handler: name});
    };
  };
  const mockedWorker = async (jobId, context) => {
    state.workerCalls.push({name: workerHandler, jobId, context});
    if (state.workerError !== null) {
      throw state.workerError;
    }
    return true;
  };
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
          defineSecret: (name) => ({
            name,
            value: () => {
              state.secretResolutions.push(name);
              if (name === discoverySecretName) {
                return state.discoverySecretValue;
              }
              if (name === identitySecretNameV1) {
                return state.identitySecretValueV1;
              }
              if (name === deviceRootSecretNameV1) {
                return state.deviceRootSecretValueV1;
              }
              return "unused";
            },
          }),
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
      case "./customer_bitesaver_device_usage_callable.js":
        return {
          createIssueCustomerBiteSaverDeviceUseChallengeHandler: deviceFactory(
            deviceCallableFactories.issueCustomerBiteSaverDeviceUseChallenge,
          ),
        };
      case "./customer_bitesaver_device_runtime.js":
        return {
          createProductionCustomerBiteSaverCouponUseHandler: deviceFactory(
            deviceCallableFactories.useCustomerBiteSaverCoupon,
          ),
        };
      case "./customer_bitesaver_search_session.js":
        return mockedSession;
      case "./customer_bitesaver_saved.js":
        return mockedSaved;
      case "./customer_bitesaver_search_store.js":
        return {
          createFirestoreCustomerBiteSaverSearchDatabase: (database) => {
            state.adapterInputs.push(database);
            return customerDatabase;
          },
        };
      case "./customer_bitesaver_search_worker.js":
        return {[workerHandler]: mockedWorker};
      case "stripe":
        return class FakeStripe {};
      default:
        return originalLoad.call(this, request, parent, isMain);
    }
  };

  const indexPath = path.resolve(__dirname, "../lib/index.js");
  delete require.cache[indexPath];
  try {
    return {
      customerDatabase,
      exports: require(indexPath),
      state,
    };
  } finally {
    delete require.cache[indexPath];
    Module._load = originalLoad;
  }
}

test("customer BiteSaver exports have exact v2 runtime metadata", () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  const exactExports = [...allCallableExports, workerExport].sort();
  assert.deepEqual(
    Object.keys(runtime.exports)
      .filter((name) => name.includes("CustomerBiteSaver"))
      .sort(),
    exactExports,
  );
  for (const name of allCallableExports) {
    const endpoint = runtime.exports[name].__endpoint;
    assert.equal(endpoint.platform, "gcfv2", name);
    assert.deepEqual(endpoint.region, ["us-central1"], name);
    assert.ok(endpoint.callableTrigger, name);
    assert.deepEqual(
      endpoint.secretEnvironmentVariables ?? [],
      expectedSecrets(name),
      name,
    );
    assert.equal(endpoint.timeoutSeconds, 120, name);
    assert.equal(Object.hasOwn(endpoint, "eventTrigger"), false, name);
    assert.equal(Object.hasOwn(endpoint, "httpsTrigger"), false, name);
    assert.equal(Object.hasOwn(endpoint, "scheduleTrigger"), false, name);
  }
  const worker = runtime.exports[workerExport].__endpoint;
  assert.equal(worker.platform, "gcfv2");
  assert.deepEqual(worker.region, ["us-central1"]);
  assert.equal(worker.eventTrigger.eventType, "document.created");
  assert.equal(
    worker.eventTrigger.eventFilterPathPatterns.document,
    "private_bitesaver_search_jobs/{jobId}",
  );
  assert.equal(worker.eventTrigger.retry, true);
  assert.deepEqual(
    worker.secretEnvironmentVariables,
    [discoverySecretName, identitySecretNameV1],
  );
  assert.equal(Object.hasOwn(worker, "callableTrigger"), false);
  assert.equal(Object.hasOwn(worker, "httpsTrigger"), false);
  assert.equal(Object.hasOwn(worker, "scheduleTrigger"), false);
  assert.equal(runtime.state.adapterInputs.length, 1);
});

test("actual Firebase metadata retains exact secrets and retry policy", () => {
  const metadata = loadActualCompiledMetadata();
  assert.deepEqual(
    Object.keys(metadata).filter((name) => name.includes("CustomerBiteSaver")).sort(),
    [...allCallableExports, workerExport].sort(),
  );
  for (const name of allCallableExports) {
    const endpoint = metadata[name];
    assert.equal(endpoint.platform, "gcfv2", name);
    assert.deepEqual(endpoint.region, ["us-central1"], name);
    assert.ok(endpoint.callableTrigger, name);
    assert.deepEqual(
      (endpoint.secretEnvironmentVariables ?? []).map((secret) => secret.key),
      expectedSecrets(name),
      name,
    );
    assert.equal(endpoint.timeoutSeconds, 120, name);
    assert.equal(Object.hasOwn(endpoint, "eventTrigger"), false, name);
  }
  const worker = metadata[workerExport];
  assert.equal(worker.eventTrigger.eventType,
    "google.cloud.firestore.document.v1.created");
  assert.equal(
    worker.eventTrigger.eventFilterPathPatterns.document,
    "private_bitesaver_search_jobs/{jobId}",
  );
  assert.equal(worker.eventTrigger.retry, true);
  assert.deepEqual(
    worker.secretEnvironmentVariables.map((secret) => secret.key),
    [discoverySecretName, identitySecretNameV1],
  );
});

test("approved runtime isolation and proposal schedule preserve the complete export inventory", () => {
  const metadata = loadActualCompiledMetadata();
  // Captured from real Firebase metadata at the reviewed starting HEAD:
  // 6c3175298649da1aeba825ea0cdd41297b8fd638. This includes Stripe, payment,
  // Admin, search, background, and scheduled runtime configuration.
  assert.deepEqual(
    Object.keys(metadata).sort(),
    [...Object.keys(protectedMetadata), ...Object.keys(deviceCallableFactories), ...Object.keys(biteScoreMetadata), "requestAccountDeletion", "getAccountDeletionStatus", "processAccountDeletionRequests", "cleanupAccountDeletionFinalizedImage"]
      .filter((name) => !retiredCallableExports.has(name))
      .sort(),
  );
  for (const name of retiredCallableExports) {
    assert.equal(Object.hasOwn(metadata, name), false, name);
  }
  for (const [name, endpoint] of Object.entries(protectedMetadata)) {
    if (retiredCallableExports.has(name)) continue;
    // Retain the original snapshot: only explicitly approved Browse and
    // Admin-support identities and the accepted proposal schedule spelling differ.
    // Every other metadata field, including
    // payment, invocation policy and secret bindings, must still match exactly.
    const serviceAccountEmail = browseRuntimeExports.has(name)
      ? browseRuntimeServiceAccount
      : Object.hasOwn(adminSupportRuntimeSecrets, name)
        ? adminSupportRuntimeServiceAccount
        : undefined;
    assert.deepEqual(metadata[name], {
      ...endpoint,
      ...(name === "processProximityPushRequest" ? {timeoutSeconds: 60} : {}),
      ...(serviceAccountEmail !== undefined ? {serviceAccountEmail} : {}),
      ...(["processDishProposalResolutionWork", "processRatingDestructiveOperationWork"].includes(name) ? {
        scheduleTrigger: {
          ...endpoint.scheduleTrigger,
          schedule: "every 1 minutes",
        },
      } : {}),
    }, name);
  }
  assert.deepEqual(
    Object.entries(metadata).filter(([, endpoint]) =>
      endpoint?.secretEnvironmentVariables?.some((secret) =>
        secret.key === deviceRootSecretNameV1))
      .map(([name]) => name),
    ["useCustomerBiteSaverCoupon"],
  );
});

test("approved BiteScore additions retain exact isolated runtime metadata", () => {
  const metadata = loadActualCompiledMetadata();
  // Explicitly authored RUN002/RUN003 inventory: nineteen callables, thirteen written
  // triggers and one scheduler. SDK-default region is absent in this module's
  // real metadata; this fixture preserves that exact source contract.
  assert.equal(Object.keys(biteScoreMetadata).length, 33);
  assert.equal(Object.values(biteScoreMetadata).filter(value => value.callableTrigger).length, 19);
  assert.equal(Object.values(biteScoreMetadata).filter(value => value.eventTrigger).length, 13);
  assert.equal(Object.values(biteScoreMetadata).filter(value => value.scheduleTrigger).length, 1);
  for (const [name, expected] of Object.entries(biteScoreMetadata)) {
    assert.deepEqual(metadata[name], expected, name);
  }
  assert.deepEqual(Object.entries(metadata)
    .filter(([, value]) => value?.serviceAccountEmail === "bitescore-customer-runtime@coupon-app-29446.iam.gserviceaccount.com")
    .map(([name]) => name).sort(), Object.keys(biteScoreMetadata).sort());
});

test("exactly thirteen Browse, Saved, Menu and guest exports share the dedicated Node 24 runtime identity", () => {
  const metadata = loadActualCompiledMetadata();
  assert.deepEqual(
    Object.entries(metadata)
      .filter(([, endpoint]) =>
        endpoint?.serviceAccountEmail === browseRuntimeServiceAccount)
      .map(([name]) => name)
      .sort(),
    [...browseRuntimeExports].sort(),
  );
  assert.deepEqual(
    [...new Set([...browseRuntimeExports].flatMap((name) =>
      metadata[name].secretEnvironmentVariables.map((secret) => secret.key)))]
      .sort(),
    [discoverySecretName, identitySecretNameV1].sort(),
  );
  // Firebase takes the deployment runtime from the codebase override or the
  // package engine; __endpoint does not contain the Node runtime selection.
  const functionsPackage = require("../package.json");
  const codebases = require("../../firebase.json").functions
    .filter((codebase) => codebase.source === "functions");
  assert.equal(codebases.length, 1);
  assert.equal(functionsPackage.engines.node, "24");
  assert.equal(functionsPackage.main, "lib/index.js");
  assert.equal(
    codebases[0].runtime ?? `nodejs${functionsPackage.engines.node}`,
    "nodejs24",
  );
});

test("exactly nine Admin-support callables pin their identity with exact per-function secret bindings", () => {
  const metadata = loadActualCompiledMetadata();
  assert.deepEqual(
    Object.entries(metadata)
      .filter(([, endpoint]) =>
        endpoint?.serviceAccountEmail === adminSupportRuntimeServiceAccount)
      .map(([name]) => name)
      .sort(),
    Object.keys(adminSupportRuntimeSecrets).sort(),
  );
  for (const [name, secrets] of Object.entries(adminSupportRuntimeSecrets)) {
    assert.deepEqual(metadata[name], {
      ...protectedMetadata[name],
      serviceAccountEmail: adminSupportRuntimeServiceAccount,
    }, name);
    assert.deepEqual(metadata[name].callableTrigger, {}, name);
    assert.deepEqual(
      metadata[name].secretEnvironmentVariables.map((secret) => secret.key),
      secrets,
      name,
    );
  }
});

test("device callables pin separate runtime identities with otherwise unchanged metadata", () => {
  const metadata = loadActualCompiledMetadata();
  const serviceAccounts = {
    issueCustomerBiteSaverDeviceUseChallenge:
      "bitesaver-device-challenge@coupon-app-29446.iam.gserviceaccount.com",
    useCustomerBiteSaverCoupon:
      "bitesaver-device-use@coupon-app-29446.iam.gserviceaccount.com",
  };
  for (const [name, serviceAccountEmail] of Object.entries(serviceAccounts)) {
    // Complete real Firebase metadata from 644a2cb818fb1d237dbda5a954df5cd619d5215e,
    // changing only the runtime service account. Exact literals also reject an
    // omitted/default identity or accidentally sharing either new identity.
    assert.deepEqual(metadata[name], {
      availableMemoryMb: null,
      timeoutSeconds: 120,
      minInstances: null,
      maxInstances: 10,
      ingressSettings: null,
      concurrency: null,
      serviceAccountEmail,
      vpc: null,
      platform: "gcfv2",
      region: ["us-central1"],
      ...(name === "useCustomerBiteSaverCoupon" ? {
        secretEnvironmentVariables: [
          {key: discoverySecretName},
          {key: identitySecretNameV1},
          {key: deviceRootSecretNameV1},
        ],
      } : {}),
      labels: {},
      callableTrigger: {},
    }, name);
  }
});

test("device callable factories use trusted Firebase actors and isolated secrets", async () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  assert.deepEqual(runtime.state.secretResolutions, []);
  assert.deepEqual(runtime.state.deviceFactoryInputs, []);
  const authStates = [
    {auth: undefined, actor: {uid: null, isAnonymous: false}},
    {auth: null, actor: {uid: null, isAnonymous: false}},
    {
      auth: {
        uid: "anonymous-firebase-user",
        token: {firebase: {sign_in_provider: "anonymous"}},
      },
      actor: {uid: "anonymous-firebase-user", isAnonymous: true},
    },
    {
      auth: {
        uid: "trusted-firebase-user",
        token: {firebase: {sign_in_provider: "password"}},
      },
      actor: {uid: "trusted-firebase-user", isAnonymous: false},
    },
  ];
  for (const [name, factoryName] of Object.entries(deviceCallableFactories)) {
    for (const {auth, actor} of authStates) {
      const data = {
        uid: "untrusted-client-uid",
        identity: {authUid: "untrusted-client-uid", authIsAnonymous: false},
        deviceRef: "untrusted-device-ref",
        requestFingerprint: "untrusted-fingerprint",
      };
      const secretResolutionOffset = runtime.state.secretResolutions.length;
      assert.deepEqual(await runtime.exports[name]({data, auth}), {
        handler: factoryName,
      });
      const call = runtime.state.deviceCalls.at(-1);
      assert.equal(call.data, data);
      assert.equal(call.name, factoryName);
      assert.deepEqual(call.actor, actor);
      const {dependencies} = runtime.state.deviceFactoryInputs.at(-1);
      assert.equal(dependencies.database, runtime.customerDatabase);
      if (name === "issueCustomerBiteSaverDeviceUseChallenge") {
        assert.deepEqual(Object.keys(dependencies), ["database"]);
      } else {
        assert.deepEqual(Object.keys(dependencies).sort(), [
          "database", "discoveryKey", "encodedRootKey", "identityKeyV1",
        ]);
        assert.equal(
          Buffer.from(dependencies.discoveryKey).toString("base64url"),
          runtime.state.discoverySecretValue,
        );
        assert.equal(
          Buffer.from(dependencies.identityKeyV1).toString("base64url"),
          runtime.state.identitySecretValueV1,
        );
        assert.equal(
          dependencies.encodedRootKey,
          runtime.state.deviceRootSecretValueV1,
        );
      }
      assert.deepEqual(
        runtime.state.secretResolutions.slice(secretResolutionOffset),
        expectedSecrets(name),
      );
    }
  }
});

test("device callable failures are sanitized and never fall back to account-only writers", async () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  const canary = "private-provider-proof-and-secret-canary";
  const authStates = [undefined, {
    uid: "signed-in-customer",
    token: {firebase: {sign_in_provider: "password"}},
  }];
  for (const name of Object.keys(deviceCallableFactories)) {
    const callable = runtime.exports[name];
    for (const errorSource of ["deviceFactoryError", "callableError"]) {
      runtime.state[errorSource] = new Error(canary);
      for (const auth of authStates) {
        await assert.rejects(callable({data: {}, auth}), (error) => {
          assert.equal(error.code, "internal");
          assert.equal(error.message,
            "BiteSaver device verification is temporarily unavailable.");
          assert.equal(JSON.stringify(error).includes(canary), false);
          assert.equal(error.details, undefined);
          return true;
        });
      }
      assert.deepEqual(runtime.state.callableCalls, [],
        "Device failures must not invoke retained account-only handlers.");
      runtime.state[errorSource] = new CustomerBiteSaverContractError(
        "permission-denied", "BiteSaver device proof was rejected.",
      );
      for (const auth of authStates) {
        await assert.rejects(callable({data: {}, auth}), (error) => {
          assert.equal(error.code, "permission-denied");
          assert.equal(error.message, "BiteSaver device proof was rejected.");
          assert.equal(error.details, undefined);
          return true;
        });
      }
      assert.deepEqual(runtime.state.callableCalls, [],
        "Rejected device proofs must not invoke retained account-only handlers.");
      runtime.state[errorSource] = null;
    }
  }
  assert.equal(JSON.stringify(runtime.state.logs).includes(canary), false);
});

test("device callable quota failures expose only bounded retry guidance", async () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  const canary = "private-allowance-permit-and-account-canary";
  for (const name of Object.keys(deviceCallableFactories)) {
    for (const [retryAfterMillis, expected] of [[17_000, 17_000], [-1, 1], [999_999, 120_000]]) {
      const error = new CustomerBiteSaverDeviceChallengeLimitError(retryAfterMillis);
      error.privateAllowance = {permit: canary};
      runtime.state.callableError = error;
      await assert.rejects(runtime.exports[name]({data: {}}), (failure) => {
        assert.equal(failure.code, "resource-exhausted");
        assert.equal(failure.message,
          "Device verification is temporarily limited. Try again shortly.");
        assert.deepEqual(failure.details, {retryAfterMillis: expected});
        assert.equal(JSON.stringify(failure).includes(canary), false);
        return true;
      });
    }
    const untrusted = new CustomerBiteSaverContractError("resource-exhausted", "Try again.");
    untrusted.retryAfterMillis = 50_000;
    untrusted.privateAllowance = canary;
    runtime.state.callableError = untrusted;
    await assert.rejects(runtime.exports[name]({data: {}}), (failure) => {
      assert.equal(failure.details, undefined,
        "an arbitrary contract error must not gain the quota details allowlist");
      assert.equal(JSON.stringify(failure).includes(canary), false);
      return true;
    });
  }
  assert.equal(JSON.stringify(runtime.state.logs).includes(canary), false);
});

test("challenge remains available without device, discovery, or identity secrets", async () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  runtime.state.discoverySecretValue = "";
  runtime.state.identitySecretValueV1 = "";
  runtime.state.deviceRootSecretValueV1 = "";
  assert.deepEqual(
    await runtime.exports.issueCustomerBiteSaverDeviceUseChallenge({data: {}}),
    {handler: deviceCallableFactories.issueCustomerBiteSaverDeviceUseChallenge},
  );
  assert.deepEqual(runtime.state.secretResolutions, []);
  assert.equal(runtime.state.deviceFactoryInputs.length, 1);
  await assert.rejects(
    runtime.exports.useCustomerBiteSaverCoupon({data: {}}),
    (error) => error.code === "failed-precondition" &&
      error.message === "BiteSaver discovery is not configured.",
  );
  assert.equal(runtime.state.deviceFactoryInputs.length, 1);
});

test("callables route exact identity and only their required decoded keys", async () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  const requests = [
    {data: {request: 0}},
    {
      data: {request: 1},
      auth: {
        uid: "anonymous-uid",
        token: {firebase: {sign_in_provider: "anonymous"}},
      },
    },
    {
      data: {request: 2},
      auth: {
        uid: " exact-signed-uid ",
        token: {firebase: {sign_in_provider: "password"}},
      },
    },
  ];
  let index = 0;
  for (const [exportName, handlerName] of Object.entries(callableHandlers)) {
    const request = requests[index % requests.length];
    assert.deepEqual(
      await runtime.exports[exportName](request),
      {handler: handlerName},
    );
    const call = runtime.state.callableCalls[index];
    assert.equal(call.name, handlerName);
    assert.equal(call.data, request.data);
    assert.equal(call.context.database, runtime.customerDatabase);
    assert.equal(
      Buffer.from(call.context.discoveryKey).toString("base64url"),
      runtime.state.discoverySecretValue,
    );
    if (discoveryOnlyCallableExports.has(exportName)) {
      assert.equal(Object.hasOwn(call.context, "identityKeyV1"), false);
    } else {
      assert.equal(
        Buffer.from(call.context.identityKeyV1).toString("base64url"),
        runtime.state.identitySecretValueV1,
      );
    }
    assert.deepEqual(call.context.identity, index % requests.length === 0 ? {
      authUid: null,
      authIsAnonymous: false,
    } : index % requests.length === 1 ? {
      authUid: "anonymous-uid",
      authIsAnonymous: true,
    } : {
      authUid: " exact-signed-uid ",
      authIsAnonymous: false,
    });
    index += 1;
  }
  assert.deepEqual(
    runtime.state.secretResolutions,
    Object.keys(callableHandlers).flatMap(expectedSecrets),
  );
  assert.equal(runtime.state.adapterInputs.length, 1);
});

test("callables expose only contract failures and fix unexpected failures", async () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  const callable = runtime.exports.startCustomerBiteSaverSearch;
  runtime.state.callableError = new CustomerBiteSaverContractError(
    "resource-exhausted",
    "Please wait before starting another BiteSaver search.",
  );
  await assert.rejects(callable({data: {}}), (error) => {
    assert.equal(error.code, "resource-exhausted");
    assert.equal(
      error.message,
      "Please wait before starting another BiteSaver search.",
    );
    return true;
  });

  const canary = "raw-private-customer-bitesaver-failure";
  runtime.state.callableError = new Error(canary);
  await assert.rejects(callable({data: {}}), (error) => {
    assert.equal(error.code, "internal");
    assert.equal(error.message, "BiteSaver search is temporarily unavailable.");
    assert.equal(JSON.stringify(error).includes(canary), false);
    return true;
  });
  assert.equal(JSON.stringify(runtime.state.logs).includes(canary), false);

  runtime.state.callableError = null;
  runtime.state.discoverySecretValue = "not-a-secret";
  await assert.rejects(callable({data: {}}), (error) => {
    assert.equal(error.code, "failed-precondition");
    assert.equal(error.message, "BiteSaver discovery is not configured.");
    return true;
  });

  runtime.state.discoverySecretValue =
    Buffer.alloc(32, 0x5a).toString("base64url");
  runtime.state.identitySecretValueV1 = "not-an-identity-secret";
  assert.deepEqual(
    await callable({data: {discoveryOnly: true}}),
    {handler: "startCustomerBiteSaverSearchHandler"},
  );
  await assert.rejects(
    runtime.exports.getCustomerBiteSaverSearchPage({data: {}}),
    (error) => {
      assert.equal(error.code, "failed-precondition");
      assert.equal(
        error.message,
        "BiteSaver customer identity is not configured.",
      );
      return true;
    },
  );
});

test("private worker routes the job and propagates failures for retry", async () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  const trigger = runtime.exports[workerExport];
  assert.equal(await trigger({params: {jobId: "bsj_job-id"}}), undefined);
  assert.equal(runtime.state.workerCalls.length, 1);
  assert.equal(runtime.state.workerCalls[0].name, workerHandler);
  assert.equal(runtime.state.workerCalls[0].jobId, "bsj_job-id");
  assert.equal(
    runtime.state.workerCalls[0].context.database,
    runtime.customerDatabase,
  );
  assert.equal(
    Buffer.from(runtime.state.workerCalls[0].context.discoveryKey)
      .toString("base64url"),
    runtime.state.discoverySecretValue,
  );
  assert.equal(
    Buffer.from(runtime.state.workerCalls[0].context.identityKeyV1)
      .toString("base64url"),
    runtime.state.identitySecretValueV1,
  );

  const retriable = new Error("transient worker failure");
  runtime.state.workerError = retriable;
  await assert.rejects(
    trigger({params: {jobId: "bsj_job-id"}}),
    (error) => error === retriable,
  );
});


test("profile-use context uses the existing two-key public page callable and actual auth", async () => {
  for (const auth of [undefined, {uid: "profile-owner", token: {firebase: {sign_in_provider: "password"}}}]) {
    const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
    const data = {schemaVersion: 1, kind: "publicProfileUse", catalogRestaurantId: "catalog-a"};
    await runtime.exports.getCustomerBiteSaverSearchPage({data, ...(auth === undefined ? {} : {auth})});
    const call = runtime.state.callableCalls[0];
    assert.equal(call.name, callableHandlers.getCustomerBiteSaverSearchPage);
    assert.equal(call.data, data);
    assert.deepEqual(call.context.identity, {authUid: auth?.uid ?? null, authIsAnonymous: false});
    assert.equal(Buffer.from(call.context.discoveryKey).toString("base64url"), runtime.state.discoverySecretValue);
    assert.equal(Buffer.from(call.context.identityKeyV1).toString("base64url"), runtime.state.identitySecretValueV1);
    assert.deepEqual(runtime.state.secretResolutions, expectedSecrets("getCustomerBiteSaverSearchPage"));
  }
});

test("deletion uses dedicated identities, worker-only Stripe access, and a private schedule", () => {
 const metadata=loadActualCompiledMetadata();
 for(const name of ["requestAccountDeletion", "getAccountDeletionStatus"]) {
  const endpoint=metadata[name];assert.equal(endpoint.platform,"gcfv2");assert.deepEqual(endpoint.region,["us-central1"]);
  assert.equal(endpoint.serviceAccountEmail,"account-deletion-request@coupon-app-29446.iam.gserviceaccount.com");
  assert.equal(endpoint.timeoutSeconds,30);assert.equal(endpoint.availableMemoryMb,256);assert.equal(endpoint.maxInstances,2);assert.equal(endpoint.concurrency,10);
  assert.deepEqual(endpoint.secretEnvironmentVariables,[]);assert.deepEqual(endpoint.callableTrigger, {});
  // This SDK emits public callable transport implicitly, not as an invoker
  // member of callableTrigger. Keep the explicit source declaration checked.
  assert.match(require("node:fs").readFileSync(path.resolve(__dirname, "../src/account_deletion_runtime.ts"), "utf8"), /invoker: "public" as const/);
 }
 const worker=metadata.processAccountDeletionRequests;
 assert.equal(worker.serviceAccountEmail,"account-deletion-worker@coupon-app-29446.iam.gserviceaccount.com");
 assert.equal(worker.scheduleTrigger.schedule,"every 1 minutes");assert.equal(worker.scheduleTrigger.retryConfig.retryCount,0);
 assert.equal(worker.timeoutSeconds,60);assert.equal(worker.availableMemoryMb,256);assert.equal(worker.maxInstances,1);assert.equal(worker.concurrency,1);
 assert.deepEqual(worker.secretEnvironmentVariables,[{key: "STRIPE_SECRET_KEY"}]);assert.equal(worker.callableTrigger,undefined);
});

test("late-image cleanup is a single private fixed-bucket finalize event with no Stripe secret", () => {
 const endpoint=loadActualCompiledMetadata().cleanupAccountDeletionFinalizedImage;
 assert.equal(endpoint.platform,"gcfv2");assert.deepEqual(endpoint.region,["us-central1"]);
 assert.equal(endpoint.serviceAccountEmail,"account-deletion-media@coupon-app-29446.iam.gserviceaccount.com");
 assert.equal(endpoint.timeoutSeconds,60);assert.equal(endpoint.availableMemoryMb,256);assert.equal(endpoint.maxInstances,2);assert.equal(endpoint.concurrency,10);
 assert.deepEqual(endpoint.secretEnvironmentVariables,[]);assert.equal(endpoint.callableTrigger,undefined);
 assert.equal(endpoint.eventTrigger.eventType,"google.cloud.storage.object.v1.finalized");
 assert.deepEqual(endpoint.eventTrigger.eventFilters,{bucket:"coupon-app-29446.firebasestorage.app"});assert.equal(endpoint.eventTrigger.retry,true);
});
