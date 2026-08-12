#!/usr/bin/env node
"use strict";

const {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn, spawnSync} = require("node:child_process");
const {
  ALLOWED_PARAMETER_NAMES,
  CANONICAL_PORTAL_RETURN_URL,
  PORTAL_RETURN_PARAMETER,
  validateDeploymentEnv,
} = require("./validate_deployment_env.js");

const SUPPORTED_FIREBASE_CLI_VERSION = "15.19.1";
const PROJECT_ID = "coupon-app-29446";
const SELECTED_FUNCTION_IDS = Object.freeze([
  "createCustomerPortalSession",
  "getRatingDestructiveOperationStatus",
  "listRatingAdminDestructiveOperationsPage",
  "processRatingDestructiveOperationWork",
  "startRatingDishDelete",
  "startRatingDishMerge",
  "startRatingRestaurantDelete",
  "startRatingRestaurantMerge",
  "stripeWebhook",
]);
const VERIFICATION_ALREADY_IN_PROGRESS =
  "verification_already_in_progress";
const ISOLATED_WORKER_ARGUMENT = "--isolated-verification-worker";
const WORKER_FAILURE_ARGUMENT_PREFIX =
  "--test-worker-failure=";
const TEST_WORKER_FAILURE_SPECS = new Set([
  "module_load",
  "after_logger_mutation",
  "after_tmp_tracker_patch",
  "discovery",
  "parameter_loading",
  "preparation",
  "packager",
  "archive_inspection",
  "canary_creation",
  "worker_restoration",
  "worker_cleanup",
  "archive_inspection+worker_cleanup",
]);
const MAX_WORKER_OUTPUT_BYTES = 16 * 1024;
const SAFE_WORKER_FAILURE_CATEGORIES = new Set([
  "firebase_cli_loading_failed",
  "firebase_cli_discovery_failed",
  "firebase_cli_parameter_loading_failed",
  "firebase_cli_archive_failed",
  "firebase_cli_archive_configuration_failed",
  "firebase_cli_archive_packaging_failed",
  "firebase_cli_archive_listing_failed",
  "firebase_cli_archive_required_paths_failed",
  "firebase_cli_archive_forbidden_paths_failed",
  "firebase_cli_archive_archive_metadata_failed",
  "firebase_cli_synthetic_archive_failed",
  "firebase_cli_synthetic_archive_fixture_creation_failed",
  "firebase_cli_synthetic_archive_packaging_failed",
  "firebase_cli_synthetic_archive_listing_failed",
  "firebase_cli_synthetic_archive_required_paths_failed",
  "firebase_cli_synthetic_archive_forbidden_paths_failed",
  "firebase_cli_worker_cleanup_failed",
  "firebase_cli_worker_unexpected_failed",
]);

let verificationInProgress = false;

class SafeVerificationError extends Error {
  constructor(category) {
    super("Firebase CLI verification failed.");
    this.name = "SafeVerificationError";
    this.category = category;
  }
}

function injectedWorkerPhases(failureSpec) {
  if (failureSpec === undefined) {
    return new Set();
  }
  if (!TEST_WORKER_FAILURE_SPECS.has(failureSpec)) {
    throw new SafeVerificationError(
      "firebase_cli_worker_unexpected_failed",
    );
  }
  return new Set(failureSpec.split("+"));
}

function throwForInjectedPhase(
  failurePhases,
  phase,
  category,
) {
  if (failurePhases.has(phase)) {
    throw new SafeVerificationError(category);
  }
}

function findFirebaseExecutable() {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory === "") {
      continue;
    }
    const candidate = path.join(directory, "firebase");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue without reporting any environment path.
    }
  }
  throw new Error("firebase_cli_not_found");
}

function createTemporaryResourceTracker(cliTemporaryFiles) {
  const originalTemporaryFileSync = cliTemporaryFiles.fileSync;
  const resources = [];
  let released = false;
  let restored = false;

  function trackedTemporaryFile(...arguments_) {
    const resource = originalTemporaryFileSync.apply(
      cliTemporaryFiles,
      arguments_,
    );
    if (
      resource === null ||
      typeof resource !== "object" ||
      typeof resource.removeCallback !== "function"
    ) {
      throw new Error("temporary_file_resource_invalid");
    }
    resources.push({
      resource,
      released: false,
    });
    return resource;
  }

  cliTemporaryFiles.fileSync = trackedTemporaryFile;

  return Object.freeze({
    releaseAll() {
      if (released) {
        return;
      }
      released = true;
      let releaseFailed = false;
      for (const tracked of [...resources].reverse()) {
        if (tracked.released) {
          continue;
        }
        tracked.released = true;
        try {
          tracked.resource.removeCallback();
        } catch {
          releaseFailed = true;
        }
      }
      if (releaseFailed) {
        throw new Error("temporary_file_release_failed");
      }
    },
    restore() {
      if (restored) {
        return;
      }
      restored = true;
      cliTemporaryFiles.fileSync = originalTemporaryFileSync;
    },
  });
}

function loadFirebaseCli(failurePhases) {
  const firebaseExecutable = realpathSync(findFirebaseExecutable());
  const cliRoot = path.resolve(
    path.dirname(firebaseExecutable),
    "../..",
  );
  const packageJson = JSON.parse(
    readFileSync(path.join(cliRoot, "package.json"), "utf8"),
  );
  if (packageJson.version !== SUPPORTED_FIREBASE_CLI_VERSION) {
    throw new Error("unsupported_firebase_cli_version");
  }

  throwForInjectedPhase(
    failurePhases,
    "module_load",
    "firebase_cli_loading_failed",
  );
  const cliLogger = require(path.join(cliRoot, "lib/logger")).logger;
  const cliTemporaryFiles = require(
    require.resolve("tmp", {paths: [cliRoot]}),
  );
  const modules = {
    buildApi: require(
      path.join(cliRoot, "lib/deploy/functions/build"),
    ),
    functionsEnv: require(path.join(cliRoot, "lib/functions/env")),
    packager: require(
      path.join(
        cliRoot,
        "lib/deploy/functions/prepareFunctionsUpload",
      ),
    ),
    runtimes: require(
      path.join(cliRoot, "lib/deploy/functions/runtimes"),
    ),
  };

  const previousLoggerSilent = cliLogger.silent;
  let temporaryResourceTracker;
  try {
    cliLogger.silent = true;
    throwForInjectedPhase(
      failurePhases,
      "after_logger_mutation",
      "firebase_cli_loading_failed",
    );
    temporaryResourceTracker =
      createTemporaryResourceTracker(cliTemporaryFiles);
    throwForInjectedPhase(
      failurePhases,
      "after_tmp_tracker_patch",
      "firebase_cli_loading_failed",
    );
  } catch (error) {
    cliLogger.silent = previousLoggerSilent;
    if (temporaryResourceTracker !== undefined) {
      temporaryResourceTracker.restore();
    }
    throw error;
  }

  let cleaned = false;
  return {
    ...modules,
    cleanup() {
      if (cleaned) {
        return;
      }
      cleaned = true;
      let cleanupFailed = false;
      try {
        temporaryResourceTracker.restore();
      } catch {
        cleanupFailed = true;
      }
      try {
        cliLogger.silent = previousLoggerSilent;
      } catch {
        cleanupFailed = true;
      }
      if (failurePhases.has("worker_restoration")) {
        cleanupFailed = true;
      }
      try {
        temporaryResourceTracker.releaseAll();
      } catch {
        cleanupFailed = true;
      }
      if (failurePhases.has("worker_cleanup")) {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        throw new Error("firebase_cli_worker_cleanup_failed");
      }
    },
  };
}

function assertSafeLocalEnvironment(functionsDirectory) {
  const projectEnvPath = path.join(
    functionsDirectory,
    `.env.${PROJECT_ID}`,
  );
  if (existsSync(path.join(functionsDirectory, ".env"))) {
    throw new Error("additional_environment_file");
  }

  const result = validateDeploymentEnv(projectEnvPath, {
    allowedRoot: functionsDirectory,
  });
  if (
    !result.ok ||
    result.mode !== "0600" ||
    result.parameters.length !== 1 ||
    result.parameters[0].name !== PORTAL_RETURN_PARAMETER ||
    result.parameters[0].validationCategory !== "exact_canonical_match"
  ) {
    throw new Error("local_environment_rejected");
  }
}

function childPermissionOptions(discoveryDirectory) {
  return [
    "--no-warnings",
    "--permission",
    "--allow-fs-read=*",
    `--allow-fs-write=${discoveryDirectory}`,
  ].join(" ");
}

async function discoverBuild(
  runtimes,
  repositoryRoot,
  functionsDirectory,
  discoveryDirectory,
) {
  const fakeFirebaseConfig = {projectId: "local-audit"};
  const previousDiscoveryPath =
    process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH;
  process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH =
    discoveryDirectory;

  try {
    const delegate = await runtimes.getRuntimeDelegate({
      projectId: "local-audit",
      projectDir: repositoryRoot,
      sourceDir: functionsDirectory,
      runtime: "nodejs24",
    });
    await delegate.validate();
    await delegate.build();
    return await delegate.discoverBuild(
      {firebase: fakeFirebaseConfig},
      {
        FIREBASE_CONFIG: JSON.stringify(fakeFirebaseConfig),
        GCLOUD_PROJECT: "local-audit",
        GOOGLE_CLOUD_QUOTA_PROJECT: "local-audit",
        NODE_OPTIONS: childPermissionOptions(discoveryDirectory),
      },
    );
  } finally {
    if (previousDiscoveryPath === undefined) {
      delete process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH;
    } else {
      process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH =
        previousDiscoveryPath;
    }
  }
}

function assertDiscoveredContract(build) {
  const discoveredParameter = build.params.filter(
    (parameter) =>
      parameter.name === PORTAL_RETURN_PARAMETER &&
      parameter.type === "string",
  );
  if (discoveredParameter.length !== 1) {
    throw new Error("required_parameter_not_discovered");
  }

  const nonsecretParameterNames = build.params
    .filter((parameter) => parameter.type !== "secret")
    .map((parameter) => parameter.name)
    .sort();
  if (
    JSON.stringify(nonsecretParameterNames) !==
    JSON.stringify([...ALLOWED_PARAMETER_NAMES].sort())
  ) {
    throw new Error("unexpected_nonsecret_parameter");
  }

  for (const functionId of SELECTED_FUNCTION_IDS) {
    if (!Object.hasOwn(build.endpoints, functionId)) {
      throw new Error("selected_function_not_discovered");
    }
  }
}

async function resolveSelectedFunctions(
  buildApi,
  functionsEnv,
  build,
  functionsDirectory,
  failurePhases,
) {
  const userEnvs = functionsEnv.loadUserEnvs({
    functionsSource: functionsDirectory,
    projectId: PROJECT_ID,
  });
  throwForInjectedPhase(
    failurePhases,
    "parameter_loading",
    "firebase_cli_parameter_loading_failed",
  );
  if (
    Object.keys(userEnvs).length !== 1 ||
    !Object.hasOwn(userEnvs, PORTAL_RETURN_PARAMETER) ||
    userEnvs[PORTAL_RETURN_PARAMETER] !== CANONICAL_PORTAL_RETURN_URL
  ) {
    throw new Error("cli_environment_loading_failed");
  }

  throwForInjectedPhase(
    failurePhases,
    "preparation",
    "firebase_cli_parameter_loading_failed",
  );
  const selectedEndpoints = Object.fromEntries(
    SELECTED_FUNCTION_IDS.map((functionId) => [
      functionId,
      build.endpoints[functionId],
    ]),
  );
  const resolved = await buildApi.resolveBackend({
    build: {
      ...build,
      endpoints: selectedEndpoints,
    },
    firebaseConfig: {projectId: "local-audit"},
    userEnvs,
    nonInteractive: true,
    isEmulator: true,
  });

  const resolvedPortalValue =
    resolved.envs[PORTAL_RETURN_PARAMETER]?.toString();
  if (resolvedPortalValue !== CANONICAL_PORTAL_RETURN_URL) {
    throw new Error("cli_parameter_resolution_failed");
  }
}

function validateFunctionsConfig(repositoryRoot) {
  const firebaseConfig = JSON.parse(
    readFileSync(path.join(repositoryRoot, "firebase.json"), "utf8"),
  );
  if (!Array.isArray(firebaseConfig.functions)) {
    throw new Error("functions_configuration_invalid");
  }
  const functionsConfig = firebaseConfig.functions.find(
    (candidate) =>
      candidate &&
      candidate.codebase === "default" &&
      candidate.source === "functions",
  );
  if (!functionsConfig || !Array.isArray(functionsConfig.ignore)) {
    throw new Error("functions_configuration_invalid");
  }

  for (const requiredIgnore of [
    ".env",
    ".env.*",
    ".secret.local",
    ".runtimeconfig.json",
  ]) {
    if (!functionsConfig.ignore.includes(requiredIgnore)) {
      throw new Error("required_ignore_missing");
    }
  }
  return structuredClone(functionsConfig);
}

function archiveRequiredPaths(functionsDirectory) {
  const required = new Set([
    "package.json",
    "package-lock.json",
    "lib/index.js",
    "lib/subscription_portal_config.js",
    "lib/stripe_log_safety.js",
  ]);
  const compiledEntryPoint = readFileSync(
    path.join(functionsDirectory, "lib/index.js"),
    "utf8",
  );
  for (const match of compiledEntryPoint.matchAll(
    /require\(["']\.\/([^"']+\.js)["']\)/g,
  )) {
    required.add(`lib/${match[1]}`);
  }
  return required;
}

function isForbiddenArchivePath(entry) {
  const basename = path.posix.basename(entry);
  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename.endsWith(".local")
  );
}

function listArchiveEntries(archivePath) {
  const listing = spawnSync(
    "/usr/bin/zipinfo",
    ["-1", archivePath],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (
    listing.status !== 0 ||
    listing.signal !== null ||
    listing.stderr !== ""
  ) {
    throw new Error("archive_listing_failed");
  }
  return listing.stdout.split("\n").filter(Boolean);
}

async function inspectRealArchive(
  packager,
  repositoryRoot,
  functionsDirectory,
  failurePhases,
) {
  let phase = "configuration";
  try {
    const functionsConfig = validateFunctionsConfig(repositoryRoot);
    phase = "packaging";
    throwForInjectedPhase(
      failurePhases,
      "packager",
      "firebase_cli_archive_packaging_failed",
    );
    const packaged = await packager.prepareFunctionsUpload(
      repositoryRoot,
      functionsDirectory,
      functionsConfig,
      [],
      undefined,
      {exportType: "zip", executablePaths: []},
    );
    const archivePath = packaged.pathToSource;

    phase = "listing";
    throwForInjectedPhase(
      failurePhases,
      "archive_inspection",
      "firebase_cli_archive_listing_failed",
    );
    const entries = listArchiveEntries(archivePath);
    const entrySet = new Set(entries);
    phase = "required_paths";
    const requiredPaths = archiveRequiredPaths(functionsDirectory);
    if (
      [...requiredPaths].some(
        (requiredPath) => !entrySet.has(requiredPath),
      )
    ) {
      throw new Error("required_archive_path_missing");
    }
    phase = "forbidden_paths";
    if (entries.some(isForbiddenArchivePath)) {
      throw new Error("forbidden_archive_path_present");
    }

    phase = "archive_metadata";
    return {
      fileCount: entries.length,
      sizeBytes: statSync(archivePath).size,
    };
  } catch {
    throw new SafeVerificationError(
      `firebase_cli_archive_${phase}_failed`,
    );
  }
}

async function verifySyntheticArchiveExclusions(
  packager,
  repositoryRoot,
  temporaryRoot,
  failurePhases,
) {
  const syntheticSource = path.join(
    temporaryRoot,
    "synthetic-functions-source",
  );
  const nestedSource = path.join(syntheticSource, "nested");
  let phase = "fixture_creation";

  try {
    mkdirSync(nestedSource, {recursive: true, mode: 0o700});
    const includedFiles = [
      path.join(syntheticSource, "package.json"),
      path.join(nestedSource, "required.js"),
    ];
    const forbiddenCanaries = [
      path.join(syntheticSource, ".env"),
      path.join(syntheticSource, ".env.canary"),
      path.join(
        syntheticSource,
        ".env.deployment-update-canary",
      ),
      path.join(syntheticSource, ".secret.local"),
      path.join(syntheticSource, "configuration.local"),
      path.join(nestedSource, ".env"),
      path.join(nestedSource, ".env.canary"),
      path.join(
        nestedSource,
        ".env.deployment-update-canary",
      ),
      path.join(nestedSource, ".secret.local"),
      path.join(nestedSource, "configuration.local"),
    ];
    for (const includedFile of includedFiles) {
      writeFileSync(includedFile, "", {mode: 0o600});
    }
    for (const forbiddenCanary of forbiddenCanaries) {
      writeFileSync(forbiddenCanary, "", {mode: 0o600});
    }
    throwForInjectedPhase(
      failurePhases,
      "canary_creation",
      "firebase_cli_synthetic_archive_fixture_creation_failed",
    );

    phase = "packaging";
    const packaged = await packager.prepareFunctionsUpload(
      syntheticSource,
      syntheticSource,
      validateFunctionsConfig(repositoryRoot),
      [],
      undefined,
      {exportType: "zip", executablePaths: []},
    );
    const archivePath = packaged.pathToSource;

    phase = "listing";
    const entries = listArchiveEntries(archivePath);
    const entrySet = new Set(entries);
    phase = "required_paths";
    if (
      !entrySet.has("package.json") ||
      !entrySet.has("nested/required.js")
    ) {
      throw new Error("synthetic_required_path_missing");
    }
    phase = "forbidden_paths";
    if (entries.some(isForbiddenArchivePath)) {
      throw new Error("synthetic_forbidden_path_present");
    }
  } catch {
    throw new SafeVerificationError(
      `firebase_cli_synthetic_archive_${phase}_failed`,
    );
  }
}

async function performWorkerVerification(failureSpec) {
  const functionsDirectory = path.resolve(__dirname, "..");
  const repositoryRoot = path.resolve(functionsDirectory, "..");
  const failurePhases = injectedWorkerPhases(failureSpec);
  let temporaryRoot;
  let stage = "firebase_cli_loading";
  let cli;
  let outcome;
  try {
    temporaryRoot = mkdtempSync(
      path.join(os.tmpdir(), "bitestar-functions-verify-"),
    );
    const discoveryDirectory = path.join(
      temporaryRoot,
      "discovery-output",
    );
    mkdirSync(discoveryDirectory, {mode: 0o700});
    assertSafeLocalEnvironment(functionsDirectory);
    stage = "firebase_cli_loading";
    cli = loadFirebaseCli(failurePhases);

    stage = "firebase_cli_discovery";
    throwForInjectedPhase(
      failurePhases,
      "discovery",
      "firebase_cli_discovery_failed",
    );
    const build = await discoverBuild(
      cli.runtimes,
      repositoryRoot,
      functionsDirectory,
      discoveryDirectory,
    );
    assertDiscoveredContract(build);

    stage = "firebase_cli_parameter_loading";
    await resolveSelectedFunctions(
      cli.buildApi,
      cli.functionsEnv,
      build,
      functionsDirectory,
      failurePhases,
    );

    stage = "firebase_cli_archive";
    const archive = await inspectRealArchive(
      cli.packager,
      repositoryRoot,
      functionsDirectory,
      failurePhases,
    );
    stage = "firebase_cli_synthetic_archive";
    await verifySyntheticArchiveExclusions(
      cli.packager,
      repositoryRoot,
      temporaryRoot,
      failurePhases,
    );

    outcome = {
      ok: true,
      cliVersion: SUPPORTED_FIREBASE_CLI_VERSION,
      parameterNames: [...ALLOWED_PARAMETER_NAMES].sort(),
      fileCount: archive.fileCount,
      sizeBytes: archive.sizeBytes,
    };
  } catch (error) {
    const failureCategory =
      error instanceof SafeVerificationError
        ? error.category
        : `${stage}_failed`;
    outcome = {
      ok: false,
      category: SAFE_WORKER_FAILURE_CATEGORIES.has(failureCategory)
        ? failureCategory
        : "firebase_cli_worker_unexpected_failed",
    };
  } finally {
    let cleanupFailed = false;
    if (cli !== undefined) {
      try {
        cli.cleanup();
      } catch {
        cleanupFailed = true;
      }
    }
    if (temporaryRoot !== undefined) {
      try {
        rmSync(temporaryRoot, {recursive: true, force: true});
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      if (outcome?.ok === false) {
        outcome.cleanupCategory =
          "firebase_cli_worker_cleanup_failed";
      } else {
        outcome = {
          ok: false,
          category: "firebase_cli_worker_cleanup_failed",
        };
      }
    }
  }

  return outcome ?? {
    ok: false,
    category: "firebase_cli_worker_unexpected_failed",
  };
}

function spawnIsolatedWorker(
  spawnProcess = spawn,
  testFailureSpec,
  observeTemporaryRoot,
) {
  return new Promise((resolve) => {
    if (
      testFailureSpec !== undefined &&
      !TEST_WORKER_FAILURE_SPECS.has(testFailureSpec)
    ) {
      resolve({spawnFailed: true});
      return;
    }
    let workerTemporaryRoot;
    try {
      workerTemporaryRoot = mkdtempSync(
        path.join(os.tmpdir(), "bitestar-verifier-worker-"),
      );
    } catch {
      resolve({spawnFailed: true});
      return;
    }

    function removeWorkerTemporaryRoot() {
      try {
        rmSync(workerTemporaryRoot, {
          recursive: true,
          force: true,
        });
        return false;
      } catch {
        return true;
      }
    }

    if (observeTemporaryRoot !== undefined) {
      try {
        observeTemporaryRoot(workerTemporaryRoot);
      } catch {
        resolve({
          spawnFailed: true,
          parentCleanupFailed: removeWorkerTemporaryRoot(),
        });
        return;
      }
    }

    let child;
    try {
      const workerEnvironment = {
        ...process.env,
        TEMP: workerTemporaryRoot,
        TMP: workerTemporaryRoot,
        TMPDIR: workerTemporaryRoot,
      };
      child = spawnProcess(
        process.execPath,
        [
          __filename,
          ISOLATED_WORKER_ARGUMENT,
          ...(
            testFailureSpec === undefined
              ? []
              : [
                `${WORKER_FAILURE_ARGUMENT_PREFIX}` +
                  testFailureSpec,
              ]
          ),
        ],
        {
          cwd: path.resolve(__dirname, "../.."),
          env: workerEnvironment,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch {
      resolve({
        spawnFailed: true,
        parentCleanupFailed: removeWorkerTemporaryRoot(),
      });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;
    let outputOverflow = false;
    let spawnFailed = false;

    function collectOutput(chunks, chunk) {
      outputBytes += chunk.length;
      if (outputBytes > MAX_WORKER_OUTPUT_BYTES) {
        outputOverflow = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    }

    child.stdout.on("data", (chunk) => {
      collectOutput(stdoutChunks, chunk);
    });
    child.stderr.on("data", (chunk) => {
      collectOutput(stderrChunks, chunk);
    });
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal,
        spawnFailed,
        outputOverflow,
        parentCleanupFailed: removeWorkerTemporaryRoot(),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function hasExactKeys(value, expectedKeys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expectedKeys].sort())
  );
}

function parseWorkerTransportResult(transportResult) {
  const parentCleanupFailed =
    transportResult?.parentCleanupFailed === true;
  function includeParentCleanup(outcome) {
    if (!parentCleanupFailed) {
      return outcome;
    }
    if (outcome.ok === true) {
      return {
        ok: false,
        category: "firebase_cli_parent_temp_cleanup_failed",
      };
    }
    if (outcome.cleanupCategory === undefined) {
      return {
        ...outcome,
        cleanupCategory:
          "firebase_cli_parent_temp_cleanup_failed",
      };
    }
    return {
      ...outcome,
      parentCleanupCategory:
        "firebase_cli_parent_temp_cleanup_failed",
    };
  }

  if (
    transportResult === null ||
    typeof transportResult !== "object" ||
    transportResult.spawnFailed === true
  ) {
    return includeParentCleanup({
      ok: false,
      category: "firebase_cli_worker_spawn_failed",
    });
  }
  if (
    transportResult.outputOverflow === true ||
    typeof transportResult.stdout !== "string" ||
    typeof transportResult.stderr !== "string"
  ) {
    return includeParentCleanup({
      ok: false,
      category: "firebase_cli_worker_protocol_failed",
    });
  }
  if (
    transportResult.signal !== null ||
    !Number.isInteger(transportResult.code)
  ) {
    return includeParentCleanup({
      ok: false,
      category: "firebase_cli_worker_crashed",
    });
  }
  if (transportResult.stderr !== "") {
    return includeParentCleanup({
      ok: false,
      category: "firebase_cli_worker_protocol_failed",
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(transportResult.stdout);
  } catch {
    return includeParentCleanup({
      ok: false,
      category: "firebase_cli_worker_protocol_failed",
    });
  }

  if (parsed?.ok === true) {
    if (
      transportResult.code !== 0 ||
      !hasExactKeys(parsed, [
        "ok",
        "cliVersion",
        "parameterNames",
        "fileCount",
        "sizeBytes",
      ]) ||
      parsed.cliVersion !== SUPPORTED_FIREBASE_CLI_VERSION ||
      JSON.stringify(parsed.parameterNames) !==
        JSON.stringify([...ALLOWED_PARAMETER_NAMES].sort()) ||
      !Number.isSafeInteger(parsed.fileCount) ||
      parsed.fileCount < 1 ||
      !Number.isSafeInteger(parsed.sizeBytes) ||
      parsed.sizeBytes < 1
    ) {
      return includeParentCleanup({
        ok: false,
        category: "firebase_cli_worker_protocol_failed",
      });
    }
    return includeParentCleanup(parsed);
  }

  const failureKeys = parsed?.cleanupCategory === undefined
    ? ["ok", "category"]
    : ["ok", "category", "cleanupCategory"];
  if (
    transportResult.code !== 1 ||
    parsed?.ok !== false ||
    !hasExactKeys(parsed, failureKeys) ||
    !SAFE_WORKER_FAILURE_CATEGORIES.has(parsed.category) ||
    (
      parsed.cleanupCategory !== undefined &&
      parsed.cleanupCategory !==
        "firebase_cli_worker_cleanup_failed"
    )
  ) {
    return includeParentCleanup({
      ok: false,
      category: "firebase_cli_worker_protocol_failed",
    });
  }
  return includeParentCleanup(parsed);
}

function writeVerificationOutcome(outcome, writeOutput) {
  if (outcome.ok) {
    writeOutput(
      `Firebase CLI ${SUPPORTED_FIREBASE_CLI_VERSION}: pass\n`,
    );
    writeOutput(`${PORTAL_RETURN_PARAMETER} discovery: pass\n`);
    writeOutput(`${PORTAL_RETURN_PARAMETER} loading: pass\n`);
    writeOutput("selected Functions preparation: pass\n");
    writeOutput("required archive paths included: pass\n");
    writeOutput("forbidden environment paths excluded: pass\n");
    writeOutput("synthetic exclusion canaries: pass\n");
    writeOutput(`archive file count: ${outcome.fileCount}\n`);
    writeOutput(`archive size bytes: ${outcome.sizeBytes}\n`);
    return 0;
  }

  writeOutput("Firebase CLI verification: fail\n");
  writeOutput(`failure category: ${outcome.category}\n`);
  if (outcome.cleanupCategory !== undefined) {
    writeOutput(
      `cleanup category: ${outcome.cleanupCategory}\n`,
    );
  }
  if (outcome.parentCleanupCategory !== undefined) {
    writeOutput(
      `parent cleanup category: ` +
        `${outcome.parentCleanupCategory}\n`,
    );
  }
  return 1;
}

async function performParentVerification(
  workerTransport,
  writeOutput,
) {
  let transportResult;
  try {
    transportResult = await workerTransport();
  } catch {
    transportResult = {spawnFailed: true};
  }
  const outcome = parseWorkerTransportResult(transportResult);
  return writeVerificationOutcome(outcome, writeOutput);
}

async function runGuardedVerification(testOptions) {
  if (verificationInProgress) {
    throw new SafeVerificationError(
      VERIFICATION_ALREADY_IN_PROGRESS,
    );
  }
  verificationInProgress = true;

  try {
    if (testOptions === undefined) {
      return await performParentVerification(
        spawnIsolatedWorker,
        (text) => process.stdout.write(text),
      );
    }
    if (
      testOptions === null ||
      typeof testOptions !== "object"
    ) {
      throw new Error("invalid_verification_test_options");
    }

    const operation = testOptions.operation;
    const afterGuardAcquired =
      testOptions.afterGuardAcquired;
    const workerTransport = testOptions.workerTransport;
    const writeOutput = testOptions.writeOutput;
    if (
      (
        operation !== undefined &&
        typeof operation !== "function"
      ) ||
      (
        afterGuardAcquired !== undefined &&
        typeof afterGuardAcquired !== "function"
      ) ||
      (
        workerTransport !== undefined &&
        typeof workerTransport !== "function"
      ) ||
      (
        writeOutput !== undefined &&
        typeof writeOutput !== "function"
      ) ||
      (
        operation === undefined &&
        workerTransport === undefined
      )
    ) {
      throw new Error("invalid_verification_test_options");
    }

    if (afterGuardAcquired !== undefined) {
      await afterGuardAcquired();
    }
    if (operation !== undefined) {
      return await operation();
    }
    return await performParentVerification(
      workerTransport,
      writeOutput ?? (() => {}),
    );
  } finally {
    verificationInProgress = false;
  }
}

function runVerification() {
  return runGuardedVerification();
}

const verificationConcurrencyTestOnly = Object.freeze({
  runWithHooks(testHooks) {
    return runGuardedVerification(testHooks);
  },
});

const verificationIsolationTestOnly = Object.freeze({
  async exerciseTemporaryResources(
    cliTemporaryFiles,
    operation,
  ) {
    const tracker =
      createTemporaryResourceTracker(cliTemporaryFiles);
    let operationError;
    let result;
    try {
      result = await operation();
    } catch (error) {
      operationError = error;
    }

    let cleanupError;
    try {
      tracker.restore();
    } catch (error) {
      cleanupError = error;
    }
    try {
      tracker.releaseAll();
    } catch (error) {
      cleanupError ??= error;
    }

    if (operationError !== undefined) {
      throw operationError;
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
    return result;
  },
  runWithOptions(testOptions) {
    return runGuardedVerification(testOptions);
  },
  runWithSpawnProcess(spawnProcess, writeOutput) {
    return runGuardedVerification({
      workerTransport() {
        return spawnIsolatedWorker(spawnProcess);
      },
      writeOutput,
    });
  },
  runWithWorkerFailure(
    testFailureSpec,
    writeOutput,
    observeTemporaryRoot,
  ) {
    return runGuardedVerification({
      workerTransport() {
        return spawnIsolatedWorker(
          spawn,
          testFailureSpec,
          observeTemporaryRoot,
        );
      },
      writeOutput,
    });
  },
});

module.exports = {
  runVerification,
  verificationConcurrencyTestOnly,
  verificationIsolationTestOnly,
};

if (require.main === module) {
  if (process.argv[2] === ISOLATED_WORKER_ARGUMENT) {
    const failureArgument = process.argv[3];
    const failureSpec =
      process.argv.length === 4 &&
      failureArgument?.startsWith(
        WORKER_FAILURE_ARGUMENT_PREFIX,
      )
        ? failureArgument.slice(
          WORKER_FAILURE_ARGUMENT_PREFIX.length,
        )
        : failureArgument === undefined &&
            process.argv.length === 3
          ? undefined
          : "invalid";
    performWorkerVerification(failureSpec)
      .catch(() => ({
        ok: false,
        category: "firebase_cli_worker_unexpected_failed",
      }))
      .then((outcome) => {
        process.stdout.write(`${JSON.stringify(outcome)}\n`);
        process.exitCode = outcome.ok ? 0 : 1;
      });
  } else {
    runVerification().then((status) => {
      process.exitCode = status;
    });
  }
}
