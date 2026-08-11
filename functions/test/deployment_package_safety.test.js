"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn, spawnSync} = require("node:child_process");
const test = require("node:test");
const {
  runVerification,
  verificationConcurrencyTestOnly,
  verificationIsolationTestOnly,
} = require("../scripts/verify_firebase_cli_packaging.js");

const repositoryRoot = path.resolve(__dirname, "../..");
const firebaseConfig = JSON.parse(
  readFileSync(path.join(repositoryRoot, "firebase.json"), "utf8"),
);
const functionsConfig = firebaseConfig.functions[0];

const expectedIgnoreEntries = [
  "node_modules",
  ".git",
  "firebase-debug.log",
  "firebase-debug.*.log",
  "*.local",
  ".runtimeconfig.json",
  ".env",
  ".env.*",
  ".secret.local",
];
const obviousProviderSecretPatterns = Object.freeze([
  Object.freeze({
    category: "stripe_secret_key",
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{12,}\b/,
  }),
  Object.freeze({
    category: "stripe_webhook_secret",
    pattern: /\bwhsec_[A-Za-z0-9]{12,}\b/,
  }),
  Object.freeze({
    category: "google_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  }),
  Object.freeze({
    category: "pem_private_key",
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  }),
  Object.freeze({
    category: "service_account_private_key_field",
    pattern: /(?:["']private_key["']|\bprivate_key)\s*:/,
  }),
]);

function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function simpleMatchBase(pattern, candidatePath) {
  const basenames = candidatePath.split("/");
  if (pattern === "*.local") {
    return basenames.some((name) => name.endsWith(".local"));
  }
  if (pattern === ".env.*") {
    return basenames.some((name) => name.startsWith(".env."));
  }
  if (pattern === "firebase-debug.*.log") {
    return basenames.some(
      (name) =>
        name.startsWith("firebase-debug.") && name.endsWith(".log"),
    );
  }
  return basenames.includes(pattern);
}

function selectRuntimeTypeScriptPaths(trackedPaths) {
  return trackedPaths
    .filter((trackedPath) =>
      trackedPath.startsWith("functions/src/"),
    )
    .filter((trackedPath) => trackedPath.endsWith(".ts"))
    .filter(
      (trackedPath) =>
        !/(?:^|\/)(?:__tests__|tests?|fixtures?)(?:\/|$)/i.test(
          trackedPath,
        ),
    )
    .filter(
      (trackedPath) =>
        !/\.(?:test|spec|fixture)\.ts$/i.test(trackedPath),
    )
    .sort();
}

function trackedRuntimeTypeScriptPaths() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--", "functions/src"],
    {
      cwd: repositoryRoot,
      encoding: "buffer",
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr.length, 0);

  const trackedPaths = result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const runtimePaths = selectRuntimeTypeScriptPaths(trackedPaths);
  assert.notEqual(runtimePaths.length, 0);
  return runtimePaths;
}

function loadParentFirebaseCliStateTargets() {
  const executableResult = spawnSync(
    "/usr/bin/which",
    ["firebase"],
    {encoding: "utf8"},
  );
  assert.equal(executableResult.status, 0);
  assert.equal(executableResult.signal, null);
  assert.equal(executableResult.stderr, "");
  const executable = realpathSync(executableResult.stdout.trim());
  const cliRoot = path.resolve(path.dirname(executable), "../..");
  const logger = require(
    path.join(cliRoot, "lib/logger"),
  ).logger;
  const temporaryFiles = require(
    require.resolve("tmp", {paths: [cliRoot]}),
  );
  return {cliRoot, logger, temporaryFiles};
}

function snapshotParentState(targets) {
  const discoveryVariable =
    "FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH";
  return {
    cwd: process.cwd(),
    discoveryVariablePresent: Object.hasOwn(
      process.env,
      discoveryVariable,
    ),
    discoveryVariableValue: process.env[discoveryVariable],
    loggerExitOnError: targets.logger.exitOnError,
    loggerLevel: targets.logger.level,
    loggerSilent: targets.logger.silent,
    loggerTransports: [...targets.logger.transports],
    temporaryFile: targets.temporaryFiles.file,
    temporaryFileSync: targets.temporaryFiles.fileSync,
    temporaryDirectory: targets.temporaryFiles.dir,
    temporaryDirectorySync: targets.temporaryFiles.dirSync,
    temporaryGracefulCleanup:
      targets.temporaryFiles.setGracefulCleanup,
    exitListeners: process.listeners("exit"),
    beforeExitListeners: process.listeners("beforeExit"),
    interruptListeners: process.listeners("SIGINT"),
    terminateListeners: process.listeners("SIGTERM"),
    cliModuleCache: Object.keys(require.cache)
      .filter((modulePath) =>
        modulePath.startsWith(targets.cliRoot),
      )
      .sort(),
  };
}

function successfulWorkerTransport() {
  return Promise.resolve({
    code: 0,
    signal: null,
    stdout: `${JSON.stringify({
      ok: true,
      cliVersion: "15.19.1",
      parameterNames: [
        "STRIPE_CUSTOMER_PORTAL_RETURN_URL",
      ],
      fileCount: 53,
      sizeBytes: 371745,
    })}\n`,
    stderr: "",
  });
}

async function runWithTransport(workerTransport) {
  const output = [];
  const status =
    await verificationIsolationTestOnly.runWithOptions({
      workerTransport,
      writeOutput(text) {
        output.push(text);
      },
    });
  return {output: output.join(""), status};
}

async function captureStdout(operation) {
  const originalWrite = process.stdout.write;
  const output = [];
  process.stdout.write = function capture(
    chunk,
    encoding,
    callback,
  ) {
    output.push(
      Buffer.isBuffer(chunk) ? chunk.toString("utf8") : `${chunk}`,
    );
    return originalWrite.call(
      process.stdout,
      chunk,
      encoding,
      callback,
    );
  };

  try {
    const result = await operation();
    return {output: output.join(""), result};
  } finally {
    process.stdout.write = originalWrite;
  }
}

function verifierTemporaryArtifacts() {
  return readdirSync(os.tmpdir())
    .filter(
      (name) =>
        name.startsWith("bitestar-verifier-worker-") ||
        name.startsWith("bitestar-functions-verify-") ||
        name.startsWith("firebase-functions-"),
    )
    .sort();
}

async function runAuthenticWorkerFailure(failureSpec) {
  const output = [];
  let temporaryRoot;
  const artifactsBefore = verifierTemporaryArtifacts();
  const status =
    await verificationIsolationTestOnly.runWithWorkerFailure(
      failureSpec,
      (text) => {
        output.push(text);
      },
      (createdRoot) => {
        temporaryRoot = createdRoot;
      },
    );
  assert.equal(typeof temporaryRoot, "string");
  assert.equal(existsSync(temporaryRoot), false);
  assert.deepEqual(
    verifierTemporaryArtifacts(),
    artifactsBefore,
  );
  return {output: output.join(""), status};
}

test("Functions ignore configuration explicitly excludes local environments while retaining every baseline entry", () => {
  assert.equal(firebaseConfig.functions.length, 1);
  assert.deepEqual(functionsConfig.ignore, expectedIgnoreEntries);
  assert.equal(
    functionsConfig.ignore.some((entry) => entry.startsWith("!")),
    false,
  );
});

test("required source, package, compiled, validator, and test artifacts are not excluded", () => {
  const requiredPaths = [
    "package.json",
    "package-lock.json",
    "lib/index.js",
    "lib/dish_proposal_private_contract.js",
    "lib/dish_proposal_private_maintenance.js",
    "lib/dish_proposal_private_store.js",
    "lib/dish_proposal_resolution_jobs.js",
    "lib/dish_proposal_runtime_integration.js",
    "lib/dish_review_aggregate_accumulator.js",
    "lib/rating_admin_dish_suggestions_paging.js",
    "lib/subscription_portal_config.js",
    "lib/stripe_log_safety.js",
    "src/dish_proposal_private_contract.ts",
    "src/dish_proposal_private_maintenance.ts",
    "src/dish_proposal_private_store.ts",
    "src/dish_proposal_resolution_jobs.ts",
    "src/dish_proposal_runtime_integration.ts",
    "src/dish_review_aggregate_accumulator.ts",
    "src/index.ts",
    "src/rating_admin_dish_suggestions_paging.ts",
    "src/subscription_portal_config.ts",
    "src/stripe_log_safety.ts",
    "scripts/validate_deployment_env.js",
    "scripts/verify_firebase_cli_packaging.js",
    "test/deployment_env_safety.test.js",
    "test/deployment_package_safety.test.js",
    "test/rating_admin_dish_suggestions.test.js",
    "test/stripe_log_safety.test.js",
    "test/subscription_portal_config.test.js",
  ];

  for (const requiredPath of requiredPaths) {
    assert.equal(
      functionsConfig.ignore.some((pattern) =>
        simpleMatchBase(pattern, requiredPath),
      ),
      false,
      requiredPath,
    );
  }
});

test("Hosting and non-ignore Functions configuration are unchanged", () => {
  assert.equal(
    sha256Json(firebaseConfig.hosting),
    "cb4b7d7a46f049c2cdf504d2082ceadbc7c13a7cac5e4f7b0d2b608966a6a212",
  );

  const functionsWithoutIgnore = {...functionsConfig};
  delete functionsWithoutIgnore.ignore;
  assert.equal(
    sha256Json(functionsWithoutIgnore),
    "088b5dcfe6dcd024bce848010dc7894547812f95c84853b11a758a13a146d2a5",
  );

  assert.deepEqual(
    firebaseConfig.hosting.rewrites.find(
      (rewrite) => rewrite.source === "/subscription/portal-return",
    ),
    {
      source: "/subscription/portal-return",
      destination: "/subscription-portal-return.html",
    },
  );
});

test("Git tracks no dotenv, local secret, private key, or credential file", () => {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr.length, 0);
  const trackedPaths = result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

  const forbiddenPath = /(?:^|\/)(?:\.env(?:\..*)?|\.secret\.local)$/;
  const credentialLikePath =
    /(?:^|\/)(?:firebase-key\.json|credentials?\.json|service[-_]account(?:[-_.].*)?|private[-_]key(?:[-_.].*)?|[^/]+\.(?:pem|p12|pfx))$/i;
  for (const trackedPath of trackedPaths) {
    assert.doesNotMatch(trackedPath, forbiddenPath);
    assert.doesNotMatch(trackedPath, credentialLikePath);
  }
});

test("provider-secret scan recursively covers deterministic tracked runtime TypeScript source only", () => {
  const firstSelection = trackedRuntimeTypeScriptPaths();
  const secondSelection = trackedRuntimeTypeScriptPaths();
  assert.deepEqual(firstSelection, secondSelection);
  assert.deepEqual(firstSelection, [...firstSelection].sort());
  assert.ok(firstSelection.includes("functions/src/index.ts"));

  for (const trackedPath of firstSelection) {
    assert.match(trackedPath, /^functions\/src\/.+\.ts$/);
    assert.doesNotMatch(
      trackedPath,
      /(?:^|\/)(?:__tests__|tests?|fixtures?)(?:\/|$)/i,
    );
    assert.doesNotMatch(
      trackedPath,
      /\.(?:test|spec|fixture)\.ts$/i,
    );
  }

  assert.deepEqual(
    selectRuntimeTypeScriptPaths([
      "functions/src/z.ts",
      "functions/src/nested/runtime.ts",
      "functions/src/nested/deeper/a.ts",
      "functions/src/__tests__/secret_canary.ts",
      "functions/src/fixtures/secret_canary.ts",
      "functions/src/nested/runtime.test.ts",
      "functions/test/secret_canary.test.js",
      "functions/scripts/secret_canary.js",
      "functions/lib/secret_canary.js",
      "functions/.env.secret_canary",
    ]),
    [
      "functions/src/nested/deeper/a.ts",
      "functions/src/nested/runtime.ts",
      "functions/src/z.ts",
    ],
  );
});

test("tracked runtime TypeScript source contains no obvious hardcoded provider secret", () => {
  const sourcePaths = trackedRuntimeTypeScriptPaths();

  for (const trackedPath of sourcePaths) {
    const source = readFileSync(
      path.join(repositoryRoot, trackedPath),
      "utf8",
    );
    for (
      const {category, pattern} of obviousProviderSecretPatterns
    ) {
      assert.doesNotMatch(
        source,
        pattern,
        `${category}: ${trackedPath}`,
      );
    }
  }
});

test("provider-secret patterns detect constructed canaries without matching public Stripe and portal values", () => {
  const canariesByCategory = new Map([
    [
      "stripe_secret_key",
      ["sk", "test", "A".repeat(24)].join("_"),
    ],
    [
      "stripe_webhook_secret",
      `whsec_${"B".repeat(24)}`,
    ],
    [
      "google_api_key",
      `AIza${"C".repeat(35)}`,
    ],
    [
      "pem_private_key",
      ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
    ],
    [
      "service_account_private_key_field",
      `${["private", "key"].join("_")}:`,
    ],
  ]);
  for (
    const {category, pattern} of obviousProviderSecretPatterns
  ) {
    assert.match(canariesByCategory.get(category), pattern);
  }

  const publicValues = [
    ["price", "public", "regression"].join("_"),
    "https://app.bitestar.app/subscription/portal-return",
  ];
  for (const publicValue of publicValues) {
    for (const {pattern} of obviousProviderSecretPatterns) {
      assert.doesNotMatch(publicValue, pattern);
    }
  }
});

test("public runVerification succeeds twice sequentially and exactly preserves actual parent Firebase CLI and tmp state", async () => {
  const targets = loadParentFirebaseCliStateTargets();
  const initialState = snapshotParentState(targets);
  const originalStdoutWrite = process.stdout.write;
  const initialArtifacts = verifierTemporaryArtifacts();

  for (let invocation = 0; invocation < 2; invocation += 1) {
    const captured = await captureStdout(
      () => runVerification(),
    );
    assert.equal(captured.result, 0);
    assert.equal(process.stdout.write, originalStdoutWrite);
    assert.match(
      captured.output,
      /Firebase CLI 15\.19\.1: pass/,
    );
    assert.match(
      captured.output,
      /STRIPE_CUSTOMER_PORTAL_RETURN_URL discovery: pass/,
    );
    assert.match(captured.output, /archive file count: [1-9]\d*/);
    assert.doesNotMatch(captured.output, /https?:\/\//);
    assert.deepEqual(snapshotParentState(targets), initialState);
    assert.deepEqual(
      verifierTemporaryArtifacts(),
      initialArtifacts,
    );
  }
});

test("authentic isolated worker failure phases preserve parent state and remove every owned artifact", async () => {
  const targets = loadParentFirebaseCliStateTargets();
  const failurePhases = [
    ["module_load", "firebase_cli_loading_failed"],
    [
      "after_logger_mutation",
      "firebase_cli_loading_failed",
    ],
    [
      "after_tmp_tracker_patch",
      "firebase_cli_loading_failed",
    ],
    ["discovery", "firebase_cli_discovery_failed"],
    [
      "parameter_loading",
      "firebase_cli_parameter_loading_failed",
    ],
    [
      "preparation",
      "firebase_cli_parameter_loading_failed",
    ],
    [
      "packager",
      "firebase_cli_archive_packaging_failed",
    ],
    [
      "archive_inspection",
      "firebase_cli_archive_listing_failed",
    ],
    [
      "canary_creation",
      "firebase_cli_synthetic_archive_fixture_creation_failed",
    ],
    [
      "worker_restoration",
      "firebase_cli_worker_cleanup_failed",
    ],
    [
      "worker_cleanup",
      "firebase_cli_worker_cleanup_failed",
    ],
  ];

  for (const [phase, category] of failurePhases) {
    const before = snapshotParentState(targets);
    const result = await runAuthenticWorkerFailure(phase);
    assert.equal(result.status, 1, phase);
    assert.equal(
      result.output,
      `Firebase CLI verification: fail\n` +
        `failure category: ${category}\n`,
      phase,
    );
    assert.deepEqual(snapshotParentState(targets), before, phase);
  }
});

test("malformed output, stderr, transport failure, and child crash produce only fixed safe parent errors", async () => {
  const sensitiveCanary =
    "SENSITIVE_CHILD_OUTPUT_CANARY_DO_NOT_REPORT";
  const sourceLine =
    `STRIPE_CUSTOMER_PORTAL_RETURN_URL=${sensitiveCanary}`;
  const cases = [
    {
      category: "firebase_cli_worker_protocol_failed",
      transport: async () => ({
        code: 0,
        signal: null,
        stdout: `{malformed:${sourceLine}}`,
        stderr: "",
      }),
    },
    {
      category: "firebase_cli_worker_protocol_failed",
      transport: async () => ({
        code: 0,
        signal: null,
        stdout: `${JSON.stringify({
          ok: true,
          cliVersion: "15.19.1",
          parameterNames: [
            "STRIPE_CUSTOMER_PORTAL_RETURN_URL",
          ],
          fileCount: 53,
          sizeBytes: 371745,
          unexpectedField: sourceLine,
        })}\n`,
        stderr: "",
      }),
    },
    {
      category: "firebase_cli_worker_protocol_failed",
      transport: async () => ({
        code: 0,
        signal: null,
        stdout: "{}\n",
        stderr: sourceLine,
      }),
    },
    {
      category: "firebase_cli_worker_crashed",
      transport: async () => ({
        code: null,
        signal: "SIGKILL",
        stdout: sourceLine,
        stderr: "",
      }),
    },
    {
      category: "firebase_cli_worker_spawn_failed",
      transport: async () => {
        throw new Error(sourceLine);
      },
    },
    {
      category: "firebase_cli_worker_protocol_failed",
      transport: async () => ({
        code: 0,
        signal: null,
        outputOverflow: true,
        stdout: sourceLine,
        stderr: "",
      }),
    },
  ];

  for (const testCase of cases) {
    const result = await runWithTransport(testCase.transport);
    assert.equal(result.status, 1);
    assert.equal(
      result.output,
      `Firebase CLI verification: fail\n` +
        `failure category: ${testCase.category}\n`,
    );
    assert.doesNotMatch(result.output, new RegExp(sensitiveCanary));
    assert.doesNotMatch(result.output, /STRIPE_CUSTOMER_PORTAL/);
    assert.doesNotMatch(result.output, /https?:\/\//);
  }

  const later = await runWithTransport(successfulWorkerTransport);
  assert.equal(later.status, 0);
});

test("parent-owned worker roots are unique and removed after malformed output and a real child crash", async () => {
  const targets = loadParentFirebaseCliStateTargets();
  const initialState = snapshotParentState(targets);
  const workerRoots = [];
  const cases = [
    {
      category: "firebase_cli_worker_protocol_failed",
      source:
        "require('node:fs').writeFileSync(" +
        "require('node:path').join(process.env.TMPDIR," +
        "'malformed-canary'),'canary');" +
        "process.stdout.write('MALFORMED_SECRET_OUTPUT');",
    },
    {
      category: "firebase_cli_worker_crashed",
      source:
        "require('node:fs').writeFileSync(" +
        "require('node:path').join(process.env.TMPDIR," +
        "'crash-canary'),'canary');" +
        "process.kill(process.pid,'SIGKILL');",
    },
  ];

  for (const testCase of cases) {
    const output = [];
    const status =
      await verificationIsolationTestOnly.runWithSpawnProcess(
        (command, arguments_, options) => {
          workerRoots.push(options.env.TMPDIR);
          assert.equal(options.env.TMP, options.env.TMPDIR);
          assert.equal(options.env.TEMP, options.env.TMPDIR);
          return spawn(
            command,
            ["-e", testCase.source],
            options,
          );
        },
        (text) => {
          output.push(text);
        },
      );
    assert.equal(status, 1);
    assert.equal(
      output.join(""),
      "Firebase CLI verification: fail\n" +
        `failure category: ${testCase.category}\n`,
    );
    assert.doesNotMatch(output.join(""), /SECRET|canary/i);
    assert.equal(existsSync(workerRoots.at(-1)), false);
    assert.deepEqual(snapshotParentState(targets), initialState);
  }

  assert.equal(new Set(workerRoots).size, workerRoots.length);
});

test("an authentic worker failure after tmp resource creation is followed by a real public success", async () => {
  const targets = loadParentFirebaseCliStateTargets();
  const initialState = snapshotParentState(targets);
  const failed = await runAuthenticWorkerFailure(
    "archive_inspection",
  );
  assert.equal(failed.status, 1);
  assert.equal(
    failed.output,
    "Firebase CLI verification: fail\n" +
      "failure category: firebase_cli_archive_listing_failed\n",
  );
  assert.deepEqual(snapshotParentState(targets), initialState);

  const succeeded = await captureStdout(
    () => runVerification(),
  );
  assert.equal(succeeded.result, 0);
  assert.match(
    succeeded.output,
    /Firebase CLI 15\.19\.1: pass/,
  );
  assert.deepEqual(snapshotParentState(targets), initialState);
});

test("authentic primary and cleanup worker failures preserve both safe categories", async () => {
  const targets = loadParentFirebaseCliStateTargets();
  const initialState = snapshotParentState(targets);
  const failed = await runAuthenticWorkerFailure(
    "archive_inspection+worker_cleanup",
  );
  assert.equal(failed.status, 1);
  assert.equal(
    failed.output,
    "Firebase CLI verification: fail\n" +
      "failure category: firebase_cli_archive_listing_failed\n" +
      "cleanup category: firebase_cli_worker_cleanup_failed\n",
  );
  assert.deepEqual(snapshotParentState(targets), initialState);
});

test("installed Firebase CLI tmp resource is released through its official callback exactly once", async () => {
  const targets = loadParentFirebaseCliStateTargets();
  const initialState = snapshotParentState(targets);
  const temporaryFiles = targets.temporaryFiles;
  const installedFileSync = temporaryFiles.fileSync;
  let callbackCalls = 0;
  let resource;

  temporaryFiles.fileSync = function countedInstalledFileSync(
    ...arguments_
  ) {
    const created = installedFileSync.apply(
      temporaryFiles,
      arguments_,
    );
    const officialRemoveCallback = created.removeCallback;
    created.removeCallback = function countedOfficialCallback() {
      callbackCalls += 1;
      return officialRemoveCallback();
    };
    resource = created;
    return created;
  };
  const countedFileSync = temporaryFiles.fileSync;

  try {
    await verificationIsolationTestOnly.exerciseTemporaryResources(
      temporaryFiles,
      async () => {
        temporaryFiles.fileSync({
          prefix: "bitestar-installed-tmp-resource-",
          postfix: ".zip",
        });
        assert.equal(existsSync(resource.name), true);
        fstatSync(resource.fd);
      },
    );
    assert.equal(temporaryFiles.fileSync, countedFileSync);
  } finally {
    temporaryFiles.fileSync = installedFileSync;
  }

  assert.equal(callbackCalls, 1);
  assert.equal(existsSync(resource.name), false);
  assert.throws(
    () => fstatSync(resource.fd),
    (error) => error.code === "EBADF",
  );
  assert.deepEqual(snapshotParentState(targets), initialState);
});

test("worker tmp tracking releases every full resource through its official callback exactly once", async (t) => {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), "bitestar-tmp-resource-test-"),
  );
  t.after(() => {
    rmSync(temporaryRoot, {recursive: true, force: true});
  });

  let sequence = 0;
  const callbackCalls = new Map();
  const registrations = new Set();
  const resources = [];
  const temporaryFiles = {
    fileSync() {
      sequence += 1;
      const name = path.join(
        temporaryRoot,
        `firebase-functions-resource-${sequence}.zip`,
      );
      const fd = openSync(name, "wx", 0o600);
      function removeCallback() {
        callbackCalls.set(
          name,
          (callbackCalls.get(name) ?? 0) + 1,
        );
        registrations.delete(removeCallback);
        closeSync(fd);
        unlinkSync(name);
      }
      registrations.add(removeCallback);
      const resource = {name, fd, removeCallback};
      resources.push(resource);
      return resource;
    },
  };
  const originalTemporaryFileSync = temporaryFiles.fileSync;

  await verificationIsolationTestOnly.exerciseTemporaryResources(
    temporaryFiles,
    async () => {
      temporaryFiles.fileSync();
      temporaryFiles.fileSync();
    },
  );

  assert.equal(
    temporaryFiles.fileSync,
    originalTemporaryFileSync,
  );
  assert.equal(registrations.size, 0);
  for (const resource of resources) {
    assert.equal(callbackCalls.get(resource.name), 1);
    assert.equal(existsSync(resource.name), false);
    assert.throws(
      () => fstatSync(resource.fd),
      (error) => error.code === "EBADF",
    );
  }

  const firstInvocationResources = [...resources];
  await verificationIsolationTestOnly.exerciseTemporaryResources(
    temporaryFiles,
    async () => {
      temporaryFiles.fileSync();
    },
  );
  assert.equal(registrations.size, 0);
  for (const resource of firstInvocationResources) {
    assert.equal(callbackCalls.get(resource.name), 1);
  }
  assert.equal(callbackCalls.get(resources.at(-1).name), 1);
});

test("worker tmp tracking restores and releases resources after an operation failure", async (t) => {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), "bitestar-tmp-failure-test-"),
  );
  t.after(() => {
    rmSync(temporaryRoot, {recursive: true, force: true});
  });

  const resourcePath = path.join(
    temporaryRoot,
    "firebase-functions-failure.zip",
  );
  let callbackCalls = 0;
  let descriptor;
  const temporaryFiles = {
    fileSync() {
      descriptor = openSync(resourcePath, "wx", 0o600);
      return {
        name: resourcePath,
        fd: descriptor,
        removeCallback() {
          callbackCalls += 1;
          closeSync(descriptor);
          unlinkSync(resourcePath);
        },
      };
    },
  };
  const originalTemporaryFileSync = temporaryFiles.fileSync;

  await assert.rejects(
    verificationIsolationTestOnly.exerciseTemporaryResources(
      temporaryFiles,
      async () => {
        temporaryFiles.fileSync();
        throw new Error("injected_worker_operation_failure");
      },
    ),
    /injected_worker_operation_failure/,
  );
  assert.equal(
    temporaryFiles.fileSync,
    originalTemporaryFileSync,
  );
  assert.equal(callbackCalls, 1);
  assert.equal(existsSync(resourcePath), false);
  assert.throws(
    () => fstatSync(descriptor),
    (error) => error.code === "EBADF",
  );
});

test("overlapping verifier calls fail before worker option access and the guard permits a later call", async () => {
  let announceGuardAcquired;
  const guardAcquired = new Promise((resolve) => {
    announceGuardAcquired = resolve;
  });
  let releaseFirstCall;
  const firstCallBarrier = new Promise((resolve) => {
    releaseFirstCall = resolve;
  });
  let firstTransportCalls = 0;
  const firstOutput = [];

  const firstCall =
    verificationIsolationTestOnly.runWithOptions({
      async afterGuardAcquired() {
        announceGuardAcquired();
        await firstCallBarrier;
      },
      async workerTransport() {
        firstTransportCalls += 1;
        return successfulWorkerTransport();
      },
      writeOutput(text) {
        firstOutput.push(text);
      },
    });

  await guardAcquired;
  let overlappingOptionReads = 0;
  const overlappingOptions = {};
  for (const property of [
    "afterGuardAcquired",
    "operation",
    "workerTransport",
    "writeOutput",
  ]) {
    Object.defineProperty(overlappingOptions, property, {
      get() {
        overlappingOptionReads += 1;
        return async () => {};
      },
    });
  }

  try {
    await assert.rejects(
      verificationIsolationTestOnly.runWithOptions(
        overlappingOptions,
      ),
      (error) => {
        assert.equal(error.name, "SafeVerificationError");
        assert.equal(
          error.category,
          "verification_already_in_progress",
        );
        assert.equal(
          error.message,
          "Firebase CLI verification failed.",
        );
        return true;
      },
    );
    assert.equal(overlappingOptionReads, 0);
    assert.equal(firstTransportCalls, 0);
  } finally {
    releaseFirstCall();
  }

  assert.equal(await firstCall, 0);
  assert.equal(firstTransportCalls, 1);
  assert.match(firstOutput.join(""), /Firebase CLI 15\.19\.1/);

  const later = await runWithTransport(successfulWorkerTransport);
  assert.equal(later.status, 0);
});

test("legacy guard test boundary still clears after an acquired operation throws", async () => {
  await assert.rejects(
    verificationConcurrencyTestOnly.runWithHooks({
      async operation() {
        throw new Error("injected_guarded_operation_failure");
      },
    }),
    /injected_guarded_operation_failure/,
  );
  assert.equal(
    await verificationConcurrencyTestOnly.runWithHooks({
      async operation() {
        return 0;
      },
    }),
    0,
  );
});
