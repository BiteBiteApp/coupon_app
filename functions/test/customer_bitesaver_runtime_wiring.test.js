"use strict";

const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const Module = require("node:module");
const protectedMetadata = require(
  "./fixtures/customer_bitesaver_pre_device_runtime_metadata.json",
);
const path = require("node:path");
const test = require("node:test");

const actualFirestore = require("firebase-admin/firestore");
const {
  CustomerBiteSaverContractError,
} = require("../lib/customer_bitesaver_search_contract.js");

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
  startCustomerBiteSaverSavedOfferRedemption:
    "startCustomerBiteSaverSavedOfferRedemptionHandler",
  validateCustomerBiteSaverSavedOfferRedemptionStart:
    "validateCustomerBiteSaverSavedOfferRedemptionStartHandler",
  startCustomerBiteSaverOfferRedemption:
    "startCustomerBiteSaverOfferRedemptionHandler",
  validateCustomerBiteSaverOfferRedemptionStart:
    "validateCustomerBiteSaverOfferRedemptionStartHandler",
});
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

test("only two device callables extend the complete protected export inventory", () => {
  const metadata = loadActualCompiledMetadata();
  // Captured from real Firebase metadata at the reviewed starting HEAD:
  // 6c3175298649da1aeba825ea0cdd41297b8fd638. This includes Stripe, payment,
  // Admin, search, background, and scheduled runtime configuration.
  assert.deepEqual(
    Object.keys(metadata).sort(),
    [...Object.keys(protectedMetadata), ...Object.keys(deviceCallableFactories)]
      .sort(),
  );
  for (const [name, endpoint] of Object.entries(protectedMetadata)) {
    assert.deepEqual(metadata[name], endpoint, name);
  }
  assert.deepEqual(
    Object.entries(metadata).filter(([, endpoint]) =>
      endpoint?.secretEnvironmentVariables?.some((secret) =>
        secret.key === deviceRootSecretNameV1))
      .map(([name]) => name),
    ["useCustomerBiteSaverCoupon"],
  );
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

test("device callable wrappers sanitize construction and invocation failures", async () => {
  const runtime = loadCompiledIndexWithCustomerBiteSaverHarness();
  const canary = "private-provider-proof-and-secret-canary";
  for (const name of Object.keys(deviceCallableFactories)) {
    const callable = runtime.exports[name];
    for (const errorSource of ["deviceFactoryError", "callableError"]) {
      runtime.state[errorSource] = new Error(canary);
      await assert.rejects(callable({data: {}}), (error) => {
        assert.equal(error.code, "internal");
        assert.equal(error.message,
          "BiteSaver device verification is temporarily unavailable.");
        assert.equal(JSON.stringify(error).includes(canary), false);
        assert.equal(error.details, undefined);
        return true;
      });
      runtime.state[errorSource] = new CustomerBiteSaverContractError(
        "permission-denied", "BiteSaver device proof was rejected.",
      );
      await assert.rejects(callable({data: {}}), (error) => {
        assert.equal(error.code, "permission-denied");
        assert.equal(error.message, "BiteSaver device proof was rejected.");
        assert.equal(error.details, undefined);
        return true;
      });
      runtime.state[errorSource] = null;
    }
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
