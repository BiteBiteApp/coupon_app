#!/usr/bin/env node
"use strict";

const {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const {createHash} = require("node:crypto");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const ts = require("typescript");

const PORTAL_RETURN_PARAMETER = "STRIPE_CUSTOMER_PORTAL_RETURN_URL";
const CANONICAL_PORTAL_RETURN_URL =
  "https://app.bitestar.app/subscription/portal-return";
const ALLOWED_PARAMETER_NAMES = Object.freeze([PORTAL_RETURN_PARAMETER]);
const FIREBASE_PARAMETER_MODULE = "firebase-functions/params";
const SUPPORTED_NONSECRET_FACTORIES = new Set([
  "defineBoolean",
  "defineInt",
  "defineList",
  "defineString",
]);
const SUPPORTED_SECRET_FACTORIES = new Set([
  "defineJsonSecret",
  "defineSecret",
]);
const MAX_FILE_BYTES = 16 * 1024;
const MAX_LINE_LENGTH = 2048;
const MAX_PARAMETER_NAME_LENGTH = 128;
const SAFE_PRE_UPDATE_MODES = new Set([0o600, 0o644]);
const STRICT_MODE = new Set([0o600]);
const RESERVED_PARAMETER_NAMES = new Set([
  "CLOUD_RUNTIME_CONFIG",
  "ENTRY_POINT",
  "EVENTARC_CLOUD_EVENT_SOURCE",
  "FIREBASE_CONFIG",
  "FUNCTION_IDENTITY",
  "FUNCTION_MEMORY_MB",
  "FUNCTION_NAME",
  "FUNCTION_REGION",
  "FUNCTION_SIGNATURE_TYPE",
  "FUNCTION_TARGET",
  "FUNCTION_TIMEOUT_SEC",
  "FUNCTION_TRIGGER_TYPE",
  "GCP_PROJECT",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "K_CONFIGURATION",
  "K_SERVICE",
  "K_REVISION",
  "PORT",
]);
const RESERVED_PARAMETER_PREFIXES = [
  "EXT_",
  "FIREBASE_",
  "GCLOUD_",
  "GOOGLE_",
  "X_GOOGLE_",
];
const SECRET_LIKE_NAME =
  /(?:API_?KEY|CONNECTION_?STRING|CREDENTIAL|PASSWORD|PRIVATE_?KEY|SECRET|SESSION_?SECRET|SIGNING_?KEY|TOKEN|WEBHOOK_?SECRET)/;

class SafeValidationError extends Error {
  constructor(category, parameterName) {
    super("Deployment environment validation failed.");
    this.name = "SafeValidationError";
    this.category = category;
    this.parameterName = parameterName;
  }
}

class SafeAtomicUpdateError extends SafeValidationError {
  constructor(category, outcome) {
    super(category);
    this.name = "SafeAtomicUpdateError";
    this.status = outcome.status;
    this.replacementOccurred = outcome.replacementOccurred;
    this.canonicalContentPresent = outcome.canonicalContentPresent;
    this.durabilityConfirmation = outcome.durabilityConfirmation;
    this.mode = outcome.mode ?? "unknown";
    this.parameters = Object.freeze([...(outcome.parameters ?? [])]);
  }
}

function safeIssue(category, parameterName) {
  return Object.freeze(
    parameterName === undefined
      ? {category}
      : {category, parameterName},
  );
}

function isPathWithin(candidatePath, allowedRoot) {
  const relative = path.relative(allowedRoot, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function fileTypeFromStat(stat) {
  if (stat.isFile()) {
    return "regular_file";
  }
  if (stat.isSymbolicLink()) {
    return "symbolic_link";
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  return "other";
}

function nanosecondStatValue(stat, nanosecondKey, millisecondKey) {
  if (typeof stat[nanosecondKey] === "bigint") {
    return stat[nanosecondKey];
  }
  return BigInt(Math.trunc(Number(stat[millisecondKey]) * 1_000_000));
}

function snapshotFromStat(stat) {
  const mode = BigInt(stat.mode);
  return Object.freeze({
    dev: BigInt(stat.dev),
    ino: BigInt(stat.ino),
    uid: BigInt(stat.uid),
    gid: BigInt(stat.gid),
    fileType: fileTypeFromStat(stat),
    nlink: BigInt(stat.nlink),
    mode,
    permissionMode: Number(mode & 0o7777n),
    size: BigInt(stat.size),
    mtimeNs: nanosecondStatValue(stat, "mtimeNs", "mtimeMs"),
    ctimeNs: nanosecondStatValue(stat, "ctimeNs", "ctimeMs"),
  });
}

const SOURCE_STATE_KEYS = Object.freeze([
  "dev",
  "ino",
  "uid",
  "gid",
  "fileType",
  "nlink",
  "mode",
  "permissionMode",
  "size",
  "mtimeNs",
  "ctimeNs",
]);

function sourceSnapshotsEqual(left, right) {
  return SOURCE_STATE_KEYS.every((key) => left[key] === right[key]);
}

function transformedSnapshot(snapshot, options, position) {
  const transform = options.testHooks?.transformSnapshot;
  if (typeof transform !== "function") {
    return snapshot;
  }
  const transformed = transform({
    phase: options.phase,
    position,
    snapshot: {...snapshot},
  });
  return Object.freeze({
    ...snapshot,
    ...(transformed ?? {}),
  });
}

function runTestHook(options, name, details = {}) {
  const hook = options.testHooks?.[name];
  if (typeof hook === "function") {
    hook(details);
  }
}

function readStableSourceState(filePath, options) {
  const resolvedInputPath = path.resolve(filePath);
  const allowedRoot = realpathSync(path.resolve(options.allowedRoot));
  let descriptor;

  try {
    const pathBeforeStat = lstatSync(resolvedInputPath, {bigint: true});
    const pathBefore = transformedSnapshot(
      snapshotFromStat(pathBeforeStat),
      options,
      "path_before",
    );
    if (pathBefore.fileType === "symbolic_link") {
      throw new SafeValidationError("symlink_rejected");
    }
    if (pathBefore.fileType !== "regular_file") {
      throw new SafeValidationError("not_regular_file");
    }
    if (pathBefore.nlink !== 1n) {
      throw new SafeValidationError("unexpected_hard_links");
    }
    if (
      typeof process.getuid === "function" &&
      pathBefore.uid !== BigInt(process.getuid())
    ) {
      throw new SafeValidationError("not_current_user_owned");
    }
    if (!isPathWithin(realpathSync(resolvedInputPath), allowedRoot)) {
      throw new SafeValidationError("path_outside_allowed_root");
    }
    if (pathBefore.size > BigInt(MAX_FILE_BYTES)) {
      throw new SafeValidationError("file_too_large");
    }
    if (
      options.expectedSnapshot !== undefined &&
      !sourceSnapshotsEqual(pathBefore, options.expectedSnapshot)
    ) {
      throw new SafeValidationError("source_state_changed");
    }

    const noFollow = constants.O_NOFOLLOW ?? 0;
    descriptor = openSync(resolvedInputPath, constants.O_RDONLY | noFollow);
    const openedBefore = transformedSnapshot(
      snapshotFromStat(fstatSync(descriptor, {bigint: true})),
      options,
      "opened_before",
    );
    if (!sourceSnapshotsEqual(pathBefore, openedBefore)) {
      throw new SafeValidationError("file_identity_changed");
    }

    runTestHook(options, `${options.phase}BeforeRead`, {
      filePath: resolvedInputPath,
    });
    const bytes = readFileSync(descriptor);
    runTestHook(options, `${options.phase}AfterRead`, {
      filePath: resolvedInputPath,
    });
    if (bytes.length > MAX_FILE_BYTES) {
      throw new SafeValidationError("file_too_large");
    }

    const openedAfter = transformedSnapshot(
      snapshotFromStat(fstatSync(descriptor, {bigint: true})),
      options,
      "opened_after",
    );
    const pathAfter = transformedSnapshot(
      snapshotFromStat(lstatSync(resolvedInputPath, {bigint: true})),
      options,
      "path_after",
    );
    if (
      !sourceSnapshotsEqual(openedBefore, openedAfter) ||
      !sourceSnapshotsEqual(openedAfter, pathAfter)
    ) {
      throw new SafeValidationError("source_changed_during_read");
    }
    if (
      options.expectedSnapshot !== undefined &&
      !sourceSnapshotsEqual(openedAfter, options.expectedSnapshot)
    ) {
      throw new SafeValidationError("source_state_changed");
    }

    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      options.expectedDigest !== undefined &&
      digest !== options.expectedDigest
    ) {
      throw new SafeValidationError("source_content_changed");
    }

    return {
      bytes,
      digest,
      mode: openedAfter.permissionMode,
      resolvedInputPath,
      snapshot: openedAfter,
    };
  } catch (error) {
    if (error instanceof SafeValidationError) {
      throw error;
    }
    throw new SafeValidationError("file_unavailable");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The descriptor contains no source data and cleanup errors stay opaque.
      }
    }
  }
}

function decodeUtf8(bytes) {
  for (const byte of bytes) {
    if ((byte < 0x20 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f) {
      throw new SafeValidationError("control_character_rejected");
    }
  }

  let source;
  try {
    source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new SafeValidationError("malformed_utf8");
  }

  for (const character of source) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 0x80 && codePoint <= 0x9f) {
      throw new SafeValidationError("prohibited_control_character");
    }
  }
  return source;
}

function splitPreservingLineEndings(source) {
  const lines = [];
  let offset = 0;

  while (offset < source.length) {
    let end = offset;
    while (
      end < source.length &&
      source[end] !== "\n" &&
      source[end] !== "\r"
    ) {
      end += 1;
    }

    let lineEnding = "";
    if (end < source.length) {
      if (source[end] === "\r" && source[end + 1] === "\n") {
        lineEnding = "\r\n";
      } else {
        lineEnding = source[end];
      }
    }

    lines.push({
      body: source.slice(offset, end),
      lineEnding,
    });
    offset = end + lineEnding.length;
  }

  if (source.length === 0) {
    return [];
  }
  return lines;
}

function containingImportDeclaration(node) {
  let current = node;
  while (current !== undefined && !ts.isImportDeclaration(current)) {
    current = current.parent;
  }
  return current;
}

function firebaseFactoryBinding(checker, expression) {
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    const declarations = symbol?.declarations ?? [];
    if (declarations.length !== 1) {
      return null;
    }
    const [declaration] = declarations;
    if (!ts.isImportSpecifier(declaration) || declaration.isTypeOnly) {
      return null;
    }
    const importDeclaration = containingImportDeclaration(declaration);
    if (
      importDeclaration === undefined ||
      importDeclaration.importClause?.isTypeOnly ||
      !ts.isStringLiteral(importDeclaration.moduleSpecifier) ||
      importDeclaration.moduleSpecifier.text !== FIREBASE_PARAMETER_MODULE
    ) {
      return null;
    }
    return declaration.propertyName?.text ?? declaration.name.text;
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const symbol = checker.getSymbolAtLocation(expression.expression);
    const declarations = symbol?.declarations ?? [];
    if (declarations.length !== 1) {
      return null;
    }
    const [declaration] = declarations;
    if (!ts.isNamespaceImport(declaration)) {
      return null;
    }
    const importDeclaration = containingImportDeclaration(declaration);
    if (
      importDeclaration === undefined ||
      importDeclaration.importClause?.isTypeOnly ||
      !ts.isStringLiteral(importDeclaration.moduleSpecifier) ||
      importDeclaration.moduleSpecifier.text !== FIREBASE_PARAMETER_MODULE
    ) {
      return null;
    }
    return expression.name.text;
  }
  return null;
}

function sourceAnalysisProgram(sourceEntries) {
  const compilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.ES2022,
  };
  const sources = new Map(
    sourceEntries.map(({filePath, sourceText}) => [
      path.resolve(filePath),
      sourceText,
    ]),
  );
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const host = {
    ...defaultHost,
    fileExists(fileName) {
      return sources.has(path.resolve(fileName));
    },
    getSourceFile(fileName, languageVersion) {
      const resolved = path.resolve(fileName);
      const sourceText = sources.get(resolved);
      if (sourceText === undefined) {
        return undefined;
      }
      return ts.createSourceFile(
        resolved,
        sourceText,
        languageVersion,
        true,
        ts.ScriptKind.TS,
      );
    },
    readFile(fileName) {
      return sources.get(path.resolve(fileName));
    },
    writeFile() {},
  };
  return ts.createProgram({
    rootNames: [...sources.keys()],
    options: compilerOptions,
    host,
  });
}

function discoverParameterDefinitionsFromSources(sourceEntries) {
  const orderedEntries = [...sourceEntries]
    .map(({filePath, sourceText}) => ({
      filePath: path.resolve(filePath),
      sourceText,
    }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  const program = sourceAnalysisProgram(orderedEntries);
  const checker = program.getTypeChecker();
  const nonsecretNames = new Set();
  const secretNames = new Set();
  const issues = [];

  for (const {filePath} of orderedEntries) {
    const sourceFile = program.getSourceFile(filePath);
    if (
      sourceFile === undefined ||
      program.getSyntacticDiagnostics(sourceFile).length !== 0
    ) {
      issues.push(safeIssue("parameter_source_parse_failed"));
      continue;
    }

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const factoryName = firebaseFactoryBinding(checker, node.expression);
        const isNonsecretFactory =
          factoryName !== null &&
          SUPPORTED_NONSECRET_FACTORIES.has(factoryName);
        const isSecretFactory =
          factoryName !== null &&
          SUPPORTED_SECRET_FACTORIES.has(factoryName);

        if (isNonsecretFactory || isSecretFactory) {
          const nameExpression = node.arguments[0];
          if (
            nameExpression === undefined ||
            !ts.isStringLiteral(nameExpression)
          ) {
            if (isNonsecretFactory) {
              issues.push(safeIssue("dynamic_parameter_name_rejected"));
            }
          } else if (isNonsecretFactory) {
            nonsecretNames.add(nameExpression.text);
          } else {
            secretNames.add(nameExpression.text);
          }
        } else if (
          factoryName !== null &&
          factoryName.startsWith("define")
        ) {
          issues.push(safeIssue("unsupported_parameter_factory"));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  return Object.freeze({
    nonsecretNames: Object.freeze([...nonsecretNames].sort()),
    secretNames: Object.freeze([...secretNames].sort()),
    issues: Object.freeze(issues),
  });
}

function trackedRuntimeTypeScriptSources(options = {}) {
  const repositoryRoot = path.resolve(
    options.repositoryRoot ?? path.resolve(__dirname, "../.."),
  );
  const sourceRoot = realpathSync(
    path.join(repositoryRoot, "functions/src"),
  );
  const listing = spawnSync(
    "git",
    ["ls-files", "-z", "--", "functions/src"],
    {
      cwd: repositoryRoot,
      encoding: "buffer",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (
    listing.status !== 0 ||
    listing.signal !== null ||
    listing.stderr.length !== 0
  ) {
    throw new SafeValidationError("source_file_listing_failed");
  }

  let decodedListing;
  try {
    decodedListing = new TextDecoder("utf-8", {fatal: true}).decode(
      listing.stdout,
    );
  } catch {
    throw new SafeValidationError("source_file_listing_failed");
  }

  return decodedListing
    .split("\0")
    .filter((relativePath) => relativePath.endsWith(".ts"))
    .sort()
    .map((relativePath) => {
      const filePath = path.resolve(repositoryRoot, relativePath);
      const metadata = lstatSync(filePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new SafeValidationError("source_file_rejected");
      }
      const resolved = realpathSync(filePath);
      if (!isPathWithin(resolved, sourceRoot)) {
        throw new SafeValidationError("source_file_rejected");
      }
      return {
        filePath: resolved,
        sourceText: readFileSync(resolved, "utf8"),
      };
    });
}

function discoverTrackedParameterDefinitions(options = {}) {
  return discoverParameterDefinitionsFromSources(
    trackedRuntimeTypeScriptSources(options),
  );
}

function sourceAllowlistIssues(options = {}) {
  let analysis;
  try {
    analysis =
      options.sourceParameterAnalysis ??
      discoverTrackedParameterDefinitions({
        repositoryRoot: options.repositoryRoot,
      });
  } catch {
    return [safeIssue("source_parameter_analysis_failed")];
  }

  if (
    analysis === null ||
    typeof analysis !== "object" ||
    !Array.isArray(analysis.issues) ||
    !Array.isArray(analysis.nonsecretNames) ||
    !Array.isArray(analysis.secretNames) ||
    analysis.issues.length !== 0 ||
    JSON.stringify([...analysis.nonsecretNames].sort()) !==
      JSON.stringify([...ALLOWED_PARAMETER_NAMES].sort()) ||
    analysis.secretNames.some((name) =>
      ALLOWED_PARAMETER_NAMES.includes(name))
  ) {
    return [safeIssue("source_allowlist_mismatch")];
  }
  return [];
}

function classifyPortalReturnValue(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return "invalid_url";
  }

  if (
    value !== CANONICAL_PORTAL_RETURN_URL ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "app.bitestar.app" ||
    parsed.port !== "" ||
    parsed.pathname !== "/subscription/portal-return" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return "not_canonical";
  }
  return "exact_canonical_match";
}

function validateParameterName(name) {
  if (name.length > MAX_PARAMETER_NAME_LENGTH) {
    return "parameter_name_too_long";
  }
  if (
    RESERVED_PARAMETER_NAMES.has(name) ||
    RESERVED_PARAMETER_PREFIXES.some((prefix) => name.startsWith(prefix))
  ) {
    return "reserved_parameter_name";
  }
  if (SECRET_LIKE_NAME.test(name)) {
    return "secret_like_parameter_name";
  }
  if (!ALLOWED_PARAMETER_NAMES.includes(name)) {
    return "unexpected_parameter_name";
  }
  return null;
}

function parseDeploymentEnv(source) {
  const issues = [];
  const parameterLines = new Map();
  const seenParameterNames = new Set();
  const lines = splitPreservingLineEndings(source);

  for (let index = 0; index < lines.length; index += 1) {
    const {body} = lines[index];
    const parsedBody =
      index === 0 && body.startsWith("\uFEFF")
        ? body.slice(1)
        : body;
    if (parsedBody.length > MAX_LINE_LENGTH) {
      issues.push(safeIssue("line_too_long"));
      continue;
    }
    if (parsedBody === "") {
      continue;
    }
    if (/^\s*#/.test(parsedBody)) {
      if (
        /^\s*#\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(
          parsedBody,
        )
      ) {
        issues.push(safeIssue("ambiguous_assignment_comment"));
      }
      continue;
    }

    const match =
      /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(parsedBody);
    if (!match) {
      issues.push(safeIssue("invalid_dotenv_syntax"));
      continue;
    }

    const name = match[1];
    const value = match[2];
    if (seenParameterNames.has(name)) {
      issues.push(safeIssue("duplicate_parameter", name));
      continue;
    }
    seenParameterNames.add(name);

    const nameIssue = validateParameterName(name);
    if (nameIssue !== null) {
      issues.push(safeIssue(nameIssue, name));
      continue;
    }
    if (
      value !== value.trim() ||
      value.includes("#") ||
      value.startsWith("'") ||
      value.startsWith('"') ||
      value.endsWith("'") ||
      value.endsWith('"')
    ) {
      issues.push(safeIssue("ambiguous_value_syntax", name));
      continue;
    }
    parameterLines.set(name, {
      index,
      value,
    });
  }

  for (const allowedName of ALLOWED_PARAMETER_NAMES) {
    if (!parameterLines.has(allowedName)) {
      issues.push(safeIssue("missing_required_parameter", allowedName));
    }
  }

  return {
    issues,
    lines,
    parameterLines,
  };
}

function analyzeDeploymentEnv(filePath, options = {}) {
  const allowedRoot =
    options.allowedRoot ?? path.resolve(__dirname, "..");
  const acceptedModes = options.acceptedModes ?? STRICT_MODE;
  const file = readStableSourceState(filePath, {
    allowedRoot,
    expectedDigest: options.expectedDigest,
    phase: "initial",
    testHooks: options.testHooks,
  });
  const source = decodeUtf8(file.bytes);
  const parsed = parseDeploymentEnv(source);
  const issues = [
    ...sourceAllowlistIssues(options),
    ...parsed.issues,
  ];

  if (!acceptedModes.has(file.mode)) {
    issues.push(safeIssue("unsafe_file_mode"));
  }

  const parameters = [];
  for (const name of ALLOWED_PARAMETER_NAMES) {
    const record = parsed.parameterLines.get(name);
    if (record !== undefined) {
      parameters.push(
        Object.freeze({
          name,
          validationCategory: classifyPortalReturnValue(record.value),
        }),
      );
    }
  }

  return {
    file,
    issues,
    parameters,
    parsed,
    source,
  };
}

function safeResultFromAnalysis(analysis) {
  const canonicalMismatch = analysis.parameters.some(
    ({validationCategory}) =>
      validationCategory !== "exact_canonical_match",
  );
  const issues = [...analysis.issues];
  if (canonicalMismatch) {
    issues.push(safeIssue("parameter_value_rejected"));
  }

  return Object.freeze({
    ok: issues.length === 0,
    mode: analysis.file.mode.toString(8).padStart(4, "0"),
    parameters: Object.freeze([...analysis.parameters]),
    issues: Object.freeze(issues),
  });
}

function safeUpdateResult(result, outcome) {
  return Object.freeze({
    ...result,
    status: outcome.status,
    replacementOccurred: outcome.replacementOccurred,
    canonicalContentPresent: outcome.canonicalContentPresent,
    durabilityConfirmation: outcome.durabilityConfirmation,
  });
}

function validateDeploymentEnv(filePath, options = {}) {
  try {
    return safeResultFromAnalysis(analyzeDeploymentEnv(filePath, options));
  } catch (error) {
    const category =
      error instanceof SafeValidationError
        ? error.category
        : "validation_unavailable";
    const issue =
      error instanceof SafeValidationError &&
      error.parameterName !== undefined
        ? safeIssue(category, error.parameterName)
        : safeIssue(category);
    return Object.freeze({
      ok: false,
      mode: "unknown",
      parameters: Object.freeze([]),
      issues: Object.freeze([issue]),
    });
  }
}

function renderUpdatedSource(analysis) {
  const target = analysis.parsed.parameterLines.get(PORTAL_RETURN_PARAMETER);
  if (target === undefined) {
    throw new SafeValidationError(
      "missing_required_parameter",
      PORTAL_RETURN_PARAMETER,
    );
  }

  return analysis.parsed.lines
    .map(({body, lineEnding}, index) => {
      if (index !== target.index) {
        return `${body}${lineEnding}`;
      }
      const byteOrderMark =
        index === 0 && body.startsWith("\uFEFF") ? "\uFEFF" : "";
      return `${byteOrderMark}${PORTAL_RETURN_PARAMETER}=${CANONICAL_PORTAL_RETURN_URL}${lineEnding}`;
    })
    .join("");
}

function atomicReplace(filePath, source, expectedFile, options) {
  const targetPath = path.resolve(filePath);
  const targetDirectory = path.dirname(targetPath);
  const temporaryName =
    `.env.deployment-update-${process.pid}-` +
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const temporaryPath = path.join(targetDirectory, temporaryName);
  const renameFile = options.renameFile ?? renameSync;
  const syncDirectory = options.syncDirectory ?? fsyncSync;
  let descriptor;
  let replacementOccurred = false;

  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    runTestHook(options, "beforeTempWrite", {
      filePath: targetPath,
      temporaryPath,
    });
    writeFileSync(descriptor, source, {encoding: "utf8"});
    runTestHook(options, "beforeTempFsync", {
      filePath: targetPath,
      temporaryPath,
    });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    runTestHook(options, "beforeRename", {
      filePath: targetPath,
      temporaryPath,
    });
    runTestHook(options, "beforePreRenameCheck", {
      filePath: targetPath,
      temporaryPath,
    });
    try {
      readStableSourceState(targetPath, {
        allowedRoot: options.allowedRoot,
        expectedDigest: expectedFile.digest,
        expectedSnapshot: expectedFile.snapshot,
        phase: "preRename",
        testHooks: options.testHooks,
      });
    } catch {
      throw new SafeValidationError("source_state_changed");
    }

    try {
      renameFile(temporaryPath, targetPath);
    } catch {
      throw new SafeAtomicUpdateError(
        "rename_failed_before_replacement",
        {
          status: "failed_before_replacement",
          replacementOccurred: false,
          canonicalContentPresent: false,
          durabilityConfirmation: "not_attempted",
        },
      );
    }
    replacementOccurred = true;
    const directoryDescriptor = openSync(targetDirectory, constants.O_RDONLY);
    try {
      runTestHook(options, "beforeDirectoryFsync", {
        directoryPath: targetDirectory,
      });
      syncDirectory(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (replacementOccurred) {
      const finalResult = validateDeploymentEnv(targetPath, {
        allowedRoot: options.allowedRoot,
        acceptedModes: STRICT_MODE,
        expectedDigest: createHash("sha256")
          .update(source, "utf8")
          .digest("hex"),
        repositoryRoot: options.repositoryRoot,
        sourceParameterAnalysis: options.sourceParameterAnalysis,
      });
      const canonicalContentPresent =
        finalResult.ok && finalResult.mode === "0600";
      throw new SafeAtomicUpdateError(
        canonicalContentPresent
          ? "directory_sync_failed_after_replacement"
          : "replacement_state_unconfirmed_after_directory_sync_failure",
        {
          status: "replacement_completed_directory_sync_failed",
          replacementOccurred: true,
          canonicalContentPresent,
          durabilityConfirmation: "failed_or_unknown",
          mode: finalResult.mode,
          parameters: canonicalContentPresent
            ? finalResult.parameters
            : [],
        },
      );
    }
    if (error instanceof SafeValidationError) {
      throw error;
    }
    throw new SafeValidationError("atomic_update_failed");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Cleanup remains deliberately silent.
      }
    }
    try {
      unlinkSync(temporaryPath);
    } catch {
      // A successful rename removes the temporary name.
    }
  }
}

function updateDeploymentEnvToCanonical(filePath, options = {}) {
  try {
    const allowedRoot =
      options.allowedRoot ?? path.resolve(__dirname, "..");
    const analysis = analyzeDeploymentEnv(filePath, {
      allowedRoot,
      acceptedModes: SAFE_PRE_UPDATE_MODES,
      repositoryRoot: options.repositoryRoot,
      sourceParameterAnalysis: options.sourceParameterAnalysis,
      testHooks: options.testHooks,
    });
    if (analysis.issues.length !== 0) {
      return safeUpdateResult(
        safeResultFromAnalysis(analysis),
        {
          status: "failed_before_replacement",
          replacementOccurred: false,
          canonicalContentPresent: false,
          durabilityConfirmation: "not_attempted",
        },
      );
    }

    const updatedSource = renderUpdatedSource(analysis);
    const currentResult = safeResultFromAnalysis(analysis);
    if (
      currentResult.ok &&
      analysis.file.mode === 0o600 &&
      updatedSource === analysis.source
    ) {
      return safeUpdateResult(currentResult, {
        status: "no_change",
        replacementOccurred: false,
        canonicalContentPresent: true,
        durabilityConfirmation: "not_required",
      });
    }

    runTestHook(options, "beforeAtomicReplace", {
      filePath: path.resolve(filePath),
    });
    atomicReplace(
      filePath,
      updatedSource,
      analysis.file,
      {
        allowedRoot,
        renameFile: options.renameFile,
        repositoryRoot: options.repositoryRoot,
        sourceParameterAnalysis: options.sourceParameterAnalysis,
        syncDirectory: options.syncDirectory,
        testHooks: options.testHooks,
      },
    );

    const finalResult = validateDeploymentEnv(filePath, {
      allowedRoot,
      acceptedModes: STRICT_MODE,
      expectedDigest: createHash("sha256")
        .update(updatedSource, "utf8")
        .digest("hex"),
      repositoryRoot: options.repositoryRoot,
      sourceParameterAnalysis: options.sourceParameterAnalysis,
      testHooks: options.testHooks,
    });
    return safeUpdateResult(finalResult, {
      status: finalResult.ok
        ? "updated"
        : "replacement_completed_validation_failed",
      replacementOccurred: true,
      canonicalContentPresent: finalResult.ok,
      durabilityConfirmation: "confirmed",
    });
  } catch (error) {
    const category =
      error instanceof SafeValidationError
        ? error.category
        : "atomic_update_failed";
    const result = {
      ok: false,
      mode:
        error instanceof SafeAtomicUpdateError
          ? error.mode
          : "unknown",
      parameters:
        error instanceof SafeAtomicUpdateError
          ? error.parameters
          : Object.freeze([]),
      issues: Object.freeze([safeIssue(category)]),
    };
    return safeUpdateResult(result, {
      status:
        error instanceof SafeAtomicUpdateError
          ? error.status
          : "failed_before_replacement",
      replacementOccurred:
        error instanceof SafeAtomicUpdateError
          ? error.replacementOccurred
          : false,
      canonicalContentPresent:
        error instanceof SafeAtomicUpdateError
          ? error.canonicalContentPresent
          : false,
      durabilityConfirmation:
        error instanceof SafeAtomicUpdateError
          ? error.durabilityConfirmation
          : "not_attempted",
    });
  }
}

function printSafeResult(result, output = process.stdout) {
  output.write(
    `deployment environment: ${result.ok ? "pass" : "fail"}\n`,
  );
  for (const parameter of result.parameters) {
    output.write(
      `${parameter.name}: ${parameter.validationCategory}\n`,
    );
  }
  output.write(`dotenv mode: ${result.mode}\n`);
  for (const issue of result.issues) {
    const label =
      issue.parameterName === undefined
        ? "dotenv"
        : issue.parameterName;
    output.write(`${label}: ${issue.category}\n`);
  }
  if (typeof result.status === "string") {
    output.write(`update status: ${result.status}\n`);
    output.write(
      `replacement occurred: ${String(result.replacementOccurred)}\n`,
    );
    output.write(
      `canonical content present: ${String(result.canonicalContentPresent)}\n`,
    );
    output.write(
      `durability confirmation: ${result.durabilityConfirmation}\n`,
    );
  }
}

function main(argv, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const mode = argv[2];
  const filePath = argv[3];
  if (
    (mode !== "validate" &&
      mode !== "classify" &&
      mode !== "update-canonical") ||
    typeof filePath !== "string"
  ) {
    stderr.write("usage: validate_deployment_env.js <mode> <file>\n");
    return 2;
  }

  let result;
  if (mode === "update-canonical") {
    result = updateDeploymentEnvToCanonical(
      filePath,
      options.updateOptions,
    );
  } else {
    result = validateDeploymentEnv(filePath, {
      acceptedModes: mode === "classify"
        ? SAFE_PRE_UPDATE_MODES
        : STRICT_MODE,
    });
  }
  printSafeResult(result, stdout);
  return result.ok ? 0 : 1;
}

module.exports = {
  ALLOWED_PARAMETER_NAMES,
  CANONICAL_PORTAL_RETURN_URL,
  PORTAL_RETURN_PARAMETER,
  classifyPortalReturnValue,
  discoverParameterDefinitionsFromSources,
  discoverTrackedParameterDefinitions,
  main,
  printSafeResult,
  trackedRuntimeTypeScriptSources,
  updateDeploymentEnvToCanonical,
  validateDeploymentEnv,
};

if (require.main === module) {
  process.exitCode = main(process.argv);
}
