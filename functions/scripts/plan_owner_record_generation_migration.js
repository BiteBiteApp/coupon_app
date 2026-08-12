#!/usr/bin/env node
"use strict";

const {createHash, randomBytes} = require("node:crypto");
const {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");

const VALUE_FLAGS = new Set([
  "--expected-project",
  "--output",
  "--owner-uid",
  "--project",
  "--summary",
]);
const BOOLEAN_FLAGS = new Set([
  "--dry-run",
  "--fail-on-manual-review",
  "--overwrite-existing",
]);
const REQUIRED_FLAGS = new Set([
  "--dry-run",
  "--expected-project",
  "--output",
  "--owner-uid",
  "--project",
  "--summary",
]);
const SAFE_CLASSIFICATIONS = new Set([
  "already_initialized",
  "blocked_active_removal",
  "legacy_safe_candidate",
  "manual_review_required",
  "no_owner_data",
]);
const SAFE_REASON_CODES = new Set([
  "owner_state_malformed",
  "owner_state_not_open",
  "owner_state_generation_conflict",
  "active_removal_job",
  "retryable_removal_job",
  "manual_review_removal_job",
  "historical_removal_job",
  "removal_job_malformed",
  "prior_generation_lifecycle_evidence",
  "account_root_missing_with_owner_state",
  "account_root_missing_with_child",
  "account_root_missing_with_rating_claim",
  "account_root_missing_with_storage",
  "account_root_owner_conflict",
  "orphan_owner_local_record",
  "record_owner_conflict",
  "record_generation_missing_after_initialization",
  "record_generation_malformed",
  "record_generation_older",
  "record_generation_newer",
  "mixed_record_generations",
  "record_shape_unrecognized",
  "rating_claim_owner_conflict",
  "rating_claim_status_conflict",
  "multiple_rating_claims",
  "rating_claim_generation_malformed",
  "rating_claim_generation_older",
  "rating_claim_generation_newer",
  "storage_prefix_conflict",
  "storage_generation_malformed",
  "storage_generation_older",
  "storage_generation_newer",
  "storage_provider_generation_missing",
  "storage_metageneration_missing",
  "billing_state_malformed",
  "billing_generation_conflict",
  "subscription_return_state_malformed",
  "subscription_return_generation_conflict",
  "unsafe_timestamp",
  "duplicate_document_path",
  "duplicate_storage_object_name",
  "inventory_incomplete",
  "inventory_bounds_exceeded",
  "pagination_cursor_invalid",
]);
const MAX_MACHINE_PLAN_BYTES = 64 * 1024 * 1024;
const MAX_REDACTED_SUMMARY_BYTES = 1024 * 1024;
const OUTPUT_ARTIFACT_PREFIX = ".owner-generation-migration-";

class OwnerRecordGenerationMigrationScriptError extends Error {
  constructor(code) {
    super("Owner-generation migration planning is unavailable.");
    this.name = "OwnerRecordGenerationMigrationScriptError";
    this.code = code;
  }
}

function fail(code) {
  throw new OwnerRecordGenerationMigrationScriptError(code);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireCanonicalProjectId(value) {
  if (
    typeof value !== "string" ||
    value.length < 6 ||
    value.length > 30 ||
    !/^[a-z][a-z0-9-]*[a-z0-9]$/u.test(value)
  ) {
    return fail("invalid_project");
  }
  return value;
}

function requireOwnerUid(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    return fail("invalid_owner");
  }
  return value;
}

function parseCliArguments(argv) {
  if (!Array.isArray(argv)) {
    return fail("usage");
  }
  const values = new Map();
  const booleans = new Set();

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (typeof argument !== "string" || !argument.startsWith("--")) {
      return fail("usage");
    }
    if (argument.includes("=")) {
      return fail("usage");
    }
    if (BOOLEAN_FLAGS.has(argument)) {
      if (booleans.has(argument) || values.has(argument)) {
        return fail("usage");
      }
      booleans.add(argument);
      continue;
    }
    if (!VALUE_FLAGS.has(argument) || values.has(argument)) {
      return fail("usage");
    }
    const value = argv[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      return fail("usage");
    }
    values.set(argument, value);
    index += 1;
  }

  for (const required of REQUIRED_FLAGS) {
    if (!booleans.has(required) && !values.has(required)) {
      return fail("usage");
    }
  }

  const projectId = requireCanonicalProjectId(values.get("--project"));
  const expectedProjectId = requireCanonicalProjectId(
    values.get("--expected-project"),
  );
  if (projectId !== expectedProjectId) {
    return fail("project_mismatch");
  }

  const outputPath = values.get("--output");
  const summaryPath = values.get("--summary");
  if (!path.isAbsolute(outputPath) || !path.isAbsolute(summaryPath)) {
    return fail("unsafe_output_path");
  }

  return Object.freeze({
    dryRun: true,
    expectedProjectId,
    failOnManualReview: booleans.has("--fail-on-manual-review"),
    outputPath,
    overwriteExisting: booleans.has("--overwrite-existing"),
    ownerUid: requireOwnerUid(values.get("--owner-uid")),
    projectId,
    summaryPath,
  });
}

function isPathWithin(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function permissionMode(metadata) {
  return Number(BigInt(metadata.mode) & 0o7777n);
}

function snapshotFile(filePath) {
  const metadata = lstatSync(filePath, {bigint: true});
  return Object.freeze({
    ctimeNs: metadata.ctimeNs,
    dev: metadata.dev,
    gid: metadata.gid,
    ino: metadata.ino,
    mode: metadata.mode,
    nlink: metadata.nlink,
    size: metadata.size,
    uid: metadata.uid,
    mtimeNs: metadata.mtimeNs,
    isFile: metadata.isFile(),
    isSymbolicLink: metadata.isSymbolicLink(),
  });
}

function sameFileIdentity(left, right, expectedLinks = left.nlink) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    right.nlink === expectedLinks &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.isFile === right.isFile &&
    left.isSymbolicLink === right.isSymbolicLink
  );
}

function pathExists(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    return fail("output_preflight_failed");
  }
}

function requireSafeExistingTarget(filePath) {
  let snapshot;
  try {
    snapshot = snapshotFile(filePath);
  } catch {
    return fail("output_preflight_failed");
  }
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : snapshot.uid;
  if (
    !snapshot.isFile ||
    snapshot.isSymbolicLink ||
    snapshot.nlink !== 1n ||
    snapshot.uid !== currentUid ||
    permissionMode(snapshot) !== 0o600
  ) {
    return fail("unsafe_existing_output");
  }
  return snapshot;
}

function canonicalOutputTarget(filePath) {
  const resolvedInput = path.resolve(filePath);
  const parentInput = path.dirname(resolvedInput);
  let resolvedParent;
  let parentMetadata;
  try {
    resolvedParent = realpathSync(parentInput);
    parentMetadata = statSync(resolvedParent, {bigint: true});
  } catch {
    return fail("unsafe_output_directory");
  }
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : parentMetadata.uid;
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.uid !== currentUid ||
    (permissionMode(parentMetadata) & 0o022) !== 0
  ) {
    return fail("unsafe_output_directory");
  }
  const basename = path.basename(resolvedInput);
  if (
    basename.length === 0 ||
    basename === "." ||
    basename === ".." ||
    /[\u0000-\u001f\u007f]/u.test(basename)
  ) {
    return fail("unsafe_output_path");
  }
  return Object.freeze({
    parent: resolvedParent,
    target: path.join(resolvedParent, basename),
  });
}

function prepareOutputPair(options) {
  const machine = canonicalOutputTarget(options.outputPath);
  const summary = canonicalOutputTarget(options.summaryPath);
  if (machine.target === summary.target || machine.parent !== summary.parent) {
    return fail("unsafe_output_path");
  }

  let repositoryRoot;
  try {
    repositoryRoot = realpathSync(path.resolve(__dirname, "../.."));
  } catch {
    return fail("output_preflight_failed");
  }
  if (
    isPathWithin(machine.target, repositoryRoot) ||
    isPathWithin(summary.target, repositoryRoot)
  ) {
    return fail("output_inside_repository");
  }

  const targets = [machine, summary].map((entry) => {
    const exists = pathExists(entry.target);
    if (exists && !options.overwriteExisting) {
      return fail("output_exists");
    }
    return Object.freeze({
      ...entry,
      original: exists ? requireSafeExistingTarget(entry.target) : null,
    });
  });
  return Object.freeze({
    machine: targets[0],
    parent: machine.parent,
    summary: targets[1],
  });
}

function safeJson(value, maximumBytes, code) {
  let source;
  try {
    source = JSON.stringify(value, null, 2);
  } catch {
    return fail(code);
  }
  if (typeof source !== "string") {
    return fail(code);
  }
  source = `${source}\n`;
  if (Buffer.byteLength(source, "utf8") > maximumBytes) {
    return fail(code);
  }
  return source;
}

function validateRedactedSummary(summary, plan) {
  const hasExactKeys = (value, expected) => {
    if (!isPlainRecord(value)) {
      return false;
    }
    const actual = Reflect.ownKeys(value).sort();
    const sortedExpected = [...expected].sort();
    return actual.length === sortedExpected.length &&
      actual.every((key, index) => key === sortedExpected[index]);
  };
  const isCount = (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (
    !hasExactKeys(summary, [
      "schemaVersion",
      "planCount",
      "classificationCounts",
      "operationCounts",
      "manualReviewReasonCounts",
      "incompletePaginationScopeCount",
    ]) ||
    summary.schemaVersion !==
      "bitestar.owner-record-generation-migration-summary.v1" ||
    summary.planCount !== 1 ||
    !isPlainRecord(plan) ||
    !SAFE_CLASSIFICATIONS.has(plan.classification) ||
    !Array.isArray(plan.operations) ||
    !Array.isArray(plan.manualReviewReasons) ||
    !Array.isArray(plan.pagination) ||
    !hasExactKeys(summary.classificationCounts, [...SAFE_CLASSIFICATIONS]) ||
    !hasExactKeys(summary.operationCounts, [
      "createOwnerStates",
      "firestoreDocuments",
      "storageObjects",
    ]) ||
    !Array.isArray(summary.manualReviewReasonCounts) ||
    !isCount(summary.incompletePaginationScopeCount)
  ) {
    return fail("unsafe_summary");
  }
  for (const classification of SAFE_CLASSIFICATIONS) {
    const expected = classification === plan.classification ? 1 : 0;
    if (summary.classificationCounts[classification] !== expected) {
      return fail("unsafe_summary");
    }
  }
  const expectedOperationCounts = {
    createOwnerStates: 0,
    firestoreDocuments: 0,
    storageObjects: 0,
  };
  for (const operation of plan.operations) {
    if (!isPlainRecord(operation)) {
      return fail("unsafe_summary");
    }
    if (operation.operation === "create_owner_state") {
      expectedOperationCounts.createOwnerStates += 1;
    } else if (operation.operation === "stamp_firestore_document") {
      expectedOperationCounts.firestoreDocuments += 1;
    } else if (operation.operation === "stamp_storage_object_metadata") {
      expectedOperationCounts.storageObjects += 1;
    } else {
      return fail("unsafe_summary");
    }
  }
  for (const [key, expected] of Object.entries(expectedOperationCounts)) {
    if (summary.operationCounts[key] !== expected) {
      return fail("unsafe_summary");
    }
  }
  const expectedReasons = new Map();
  for (const reason of plan.manualReviewReasons) {
    if (!isPlainRecord(reason) || !SAFE_REASON_CODES.has(reason.code)) {
      return fail("unsafe_summary");
    }
    expectedReasons.set(
      reason.code,
      (expectedReasons.get(reason.code) ?? 0) + 1,
    );
  }
  const actualReasons = new Map();
  for (const entry of summary.manualReviewReasonCounts) {
    if (
      !hasExactKeys(entry, ["code", "count"]) ||
      !SAFE_REASON_CODES.has(entry.code) ||
      !isCount(entry.count) ||
      actualReasons.has(entry.code)
    ) {
      return fail("unsafe_summary");
    }
    actualReasons.set(entry.code, entry.count);
  }
  if (
    actualReasons.size !== expectedReasons.size ||
    [...expectedReasons].some(([code, expected]) =>
      actualReasons.get(code) !== expected)
  ) {
    return fail("unsafe_summary");
  }
  const expectedIncomplete = plan.pagination.filter((entry) =>
    isPlainRecord(entry) && entry.complete === false).length;
  if (summary.incompletePaginationScopeCount !== expectedIncomplete) {
    return fail("unsafe_summary");
  }
  return safeJson(summary, MAX_REDACTED_SUMMARY_BYTES, "unsafe_summary");
}

function artifactPath(parent, label, extension) {
  const suffix = randomBytes(18).toString("hex");
  return path.join(
    parent,
    `${OUTPUT_ARTIFACT_PREFIX}${process.pid}-${suffix}-${label}.${extension}`,
  );
}

function runHook(options, hook, details = {}) {
  const callback = options.testHooks?.[hook];
  if (typeof callback === "function") {
    callback(details);
  }
}

function stageOutput(entry, source, label, options) {
  const temporaryPath = artifactPath(entry.parent, label, "tmp");
  const bytes = Buffer.from(source, "utf8");
  const hookLabel = `${label[0].toUpperCase()}${label.slice(1)}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    runHook(options, `before${hookLabel}Write`);
    writeFileSync(descriptor, bytes);
    runHook(options, `before${hookLabel}Fsync`);
    fsyncSync(descriptor);
    const metadata = fstatSync(descriptor, {bigint: true});
    const currentUid = typeof process.getuid === "function"
      ? BigInt(process.getuid())
      : metadata.uid;
    if (
      !metadata.isFile() ||
      metadata.uid !== currentUid ||
      metadata.nlink !== 1n ||
      permissionMode(metadata) !== 0o600 ||
      metadata.size !== BigInt(bytes.length)
    ) {
      return fail("output_stage_failed");
    }
    closeSync(descriptor);
    descriptor = undefined;
    return {
      ...entry,
      backupPath: null,
      committed: false,
      digest: createHash("sha256").update(bytes).digest("hex"),
      source,
      staged: snapshotFile(temporaryPath),
      temporaryPath,
    };
  } catch (error) {
    try {
      safeUnlink(temporaryPath);
    } catch {
      return fail("output_recovery_unconfirmed");
    }
    if (error instanceof OwnerRecordGenerationMigrationScriptError) {
      throw error;
    }
    return fail("output_stage_failed");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The outer cleanup owns the only safe diagnostic.
      }
    }
  }
}

function safeUnlink(filePath) {
  if (filePath === null) {
    return;
  }
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function revalidateOriginal(entry) {
  if (entry.original === null) {
    if (pathExists(entry.target)) {
      return fail("output_changed");
    }
    return;
  }
  let current;
  try {
    current = snapshotFile(entry.target);
  } catch {
    return fail("output_changed");
  }
  if (!sameFileIdentity(entry.original, current)) {
    return fail("output_changed");
  }
}

function createBackup(entry, label) {
  if (entry.original === null) {
    return;
  }
  revalidateOriginal(entry);
  const backupPath = artifactPath(entry.parent, label, "backup");
  entry.backupPath = backupPath;
  let descriptor;
  try {
    const bytes = readFileSync(entry.target);
    revalidateOriginal(entry);
    descriptor = openSync(
      backupPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const backup = fstatSync(descriptor, {bigint: true});
    const currentUid = typeof process.getuid === "function"
      ? BigInt(process.getuid())
      : backup.uid;
    if (
      !backup.isFile() ||
      backup.uid !== currentUid ||
      backup.nlink !== 1n ||
      permissionMode(backup) !== 0o600 ||
      backup.size !== BigInt(bytes.length)
    ) {
      return fail("output_backup_failed");
    }
    closeSync(descriptor);
    descriptor = undefined;
    entry.backupDigest = createHash("sha256").update(bytes).digest("hex");
    entry.backupSnapshot = snapshotFile(backupPath);
    revalidateOriginal(entry);
  } catch (error) {
    try {
      safeUnlink(backupPath);
      entry.backupPath = null;
    } catch {
      return fail("output_recovery_unconfirmed");
    }
    if (error instanceof OwnerRecordGenerationMigrationScriptError) {
      throw error;
    }
    return fail("output_backup_failed");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Outer recovery removes the incomplete backup.
      }
    }
  }
}

function commitStagedOutput(entry) {
  if (entry.original === null) {
    try {
      linkSync(entry.temporaryPath, entry.target);
    } catch {
      return fail("output_changed");
    }
  } else {
    if (
      entry.backupPath === null ||
      typeof entry.backupDigest !== "string" ||
      entry.backupSnapshot === undefined
    ) {
      return fail("output_backup_failed");
    }
    revalidateOriginal(entry);
    const targetBefore = snapshotFile(entry.target);
    const backupBefore = snapshotFile(entry.backupPath);
    const targetDigest = createHash("sha256")
      .update(readFileSync(entry.target))
      .digest("hex");
    const backupDigest = createHash("sha256")
      .update(readFileSync(entry.backupPath))
      .digest("hex");
    const targetAfter = snapshotFile(entry.target);
    const backupAfter = snapshotFile(entry.backupPath);
    if (
      !sameFileIdentity(targetBefore, targetAfter) ||
      !sameFileIdentity(backupBefore, backupAfter) ||
      !sameFileIdentity(entry.original, targetAfter) ||
      !sameFileIdentity(entry.backupSnapshot, backupAfter) ||
      targetDigest !== entry.backupDigest ||
      backupDigest !== entry.backupDigest
    ) {
      return fail("output_changed");
    }
    try {
      renameSync(entry.temporaryPath, entry.target);
    } catch {
      return fail("output_commit_failed");
    }
    entry.temporaryPath = null;
  }
  entry.committed = true;
}

function currentTargetIsStaged(entry) {
  try {
    const current = snapshotFile(entry.target);
    return (
      current.dev === entry.staged.dev &&
      current.ino === entry.staged.ino &&
      current.isFile &&
      !current.isSymbolicLink
    );
  } catch {
    return false;
  }
}

function rollbackEntry(entry) {
  if (entry.committed) {
    if (!currentTargetIsStaged(entry)) {
      return false;
    }
    try {
      unlinkSync(entry.target);
      if (entry.original !== null) {
        if (entry.backupPath === null) {
          return false;
        }
        renameSync(entry.backupPath, entry.target);
        entry.backupPath = null;
      }
      entry.committed = false;
    } catch {
      return false;
    }
  }
  try {
    safeUnlink(entry.temporaryPath);
    entry.temporaryPath = null;
    safeUnlink(entry.backupPath);
    entry.backupPath = null;
    return true;
  } catch {
    return false;
  }
}

function verifyCommittedOutput(entry) {
  let metadata;
  let bytes;
  try {
    metadata = snapshotFile(entry.target);
    bytes = readFileSync(entry.target);
  } catch {
    return fail("output_verification_failed");
  }
  if (
    !metadata.isFile ||
    metadata.isSymbolicLink ||
    metadata.nlink !== 1n ||
    permissionMode(metadata) !== 0o600 ||
    createHash("sha256").update(bytes).digest("hex") !== entry.digest
  ) {
    return fail("output_verification_failed");
  }
}

function syncDirectory(parent) {
  let descriptor;
  try {
    descriptor = openSync(parent, constants.O_RDONLY);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function writeOutputPair(prepared, machineSource, summarySource, options = {}) {
  const staged = [];
  let completed = false;
  let recoveryConfirmed = true;
  try {
    staged.push(stageOutput(
      prepared.machine,
      machineSource,
      "machine",
      options,
    ));
    staged.push(stageOutput(
      prepared.summary,
      summarySource,
      "summary",
      options,
    ));

    runHook(options, "beforeBackups");
    createBackup(staged[0], "machine");
    createBackup(staged[1], "summary");

    runHook(options, "beforeMachineCommit");
    commitStagedOutput(staged[0]);
    runHook(options, "beforeSummaryCommit");
    commitStagedOutput(staged[1]);

    for (const entry of staged) {
      safeUnlink(entry.temporaryPath);
      entry.temporaryPath = null;
    }
    runHook(options, "beforeDirectoryFsync");
    syncDirectory(prepared.parent);
    for (const entry of staged) {
      verifyCommittedOutput(entry);
    }
    completed = true;
    for (let index = 0; index < staged.length; index += 1) {
      const entry = staged[index];
      runHook(options, "beforeBackupCleanup", {index});
      safeUnlink(entry.backupPath);
      entry.backupPath = null;
    }
    syncDirectory(prepared.parent);
  } catch (error) {
    if (!completed) {
      for (const entry of [...staged].reverse()) {
        if (!rollbackEntry(entry)) {
          recoveryConfirmed = false;
        }
      }
      try {
        syncDirectory(prepared.parent);
      } catch {
        recoveryConfirmed = false;
      }
      if (!recoveryConfirmed) {
        return fail("output_recovery_unconfirmed");
      }
      if (error instanceof OwnerRecordGenerationMigrationScriptError) {
        throw error;
      }
      return fail("output_write_failed");
    }
    // Both verified outputs are already committed. Backup cleanup is outside
    // the rollback boundary so losing one backup can never delete a committed
    // replacement or its original counterpart.
    try {
      for (const entry of staged) {
        safeUnlink(entry.temporaryPath);
        entry.temporaryPath = null;
        safeUnlink(entry.backupPath);
        entry.backupPath = null;
      }
      syncDirectory(prepared.parent);
    } catch {
      return fail("output_cleanup_failed");
    }
    return fail("output_cleanup_failed");
  } finally {
    if (completed || recoveryConfirmed) {
      for (const entry of staged) {
        try {
          safeUnlink(entry.temporaryPath);
          safeUnlink(entry.backupPath);
        } catch {
          // The operation result remains fail-closed and path-free.
        }
      }
    }
  }
}

function productionRuntime(options) {
  for (const variable of [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_STORAGE_EMULATOR_HOST",
    "STORAGE_EMULATOR_HOST",
  ]) {
    if (process.env[variable] !== undefined) {
      return fail("emulator_routing_forbidden");
    }
  }
  const {deleteApp, initializeApp} = require("firebase-admin/app");
  const {getFirestore} = require("firebase-admin/firestore");
  const {getStorage} = require("firebase-admin/storage");
  const planner = require(
    "../lib/owner_record_generation_migration_planner.js"
  );
  const contract = require(
    "../lib/owner_record_generation_migration_contract.js"
  );
  const firestoreAdapter = require(
    "../lib/owner_record_generation_migration_store.js"
  );
  const storageAdapter = require(
    "../lib/owner_record_generation_migration_storage.js"
  );
  const collectInventory =
    firestoreAdapter.collectOwnerRecordGenerationMigrationInventory ??
    storageAdapter.collectOwnerRecordGenerationMigrationInventory ??
    planner.collectOwnerRecordGenerationMigrationInventory;
  const createStorageStore =
    storageAdapter.createFirebaseOwnerRecordGenerationMigrationStorageInventory;
  const summarizePlan = (plan) =>
    contract.buildOwnerRecordGenerationMigrationRedactedSummary([plan]);
  if (
    typeof planner.planOwnerRecordGenerationMigration !== "function" ||
    typeof contract.parseOwnerRecordGenerationMigrationPlan !== "function" ||
    typeof summarizePlan !== "function" ||
    typeof firestoreAdapter.createFirestoreOwnerRecordGenerationMigrationStore !==
      "function" ||
    typeof createStorageStore !== "function" ||
    typeof collectInventory !== "function"
  ) {
    return fail("runtime_contract_unavailable");
  }

  const app = initializeApp(
    {
      projectId: options.projectId,
      storageBucket: `${options.projectId}.firebasestorage.app`,
    },
    `owner-generation-migration-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  const firestoreStore =
    firestoreAdapter.createFirestoreOwnerRecordGenerationMigrationStore(
      getFirestore(app),
    );
  const storageStore =
    createStorageStore(getStorage(app));
  return Object.freeze({
    async cleanup() {
      await deleteApp(app);
    },
    collectInventory(input) {
      return collectInventory({
        ...input,
        firestoreStore,
        storageStore,
      });
    },
    async planMigration(inventory) {
      const plan = await planner.planOwnerRecordGenerationMigration(inventory);
      return contract.parseOwnerRecordGenerationMigrationPlan(plan);
    },
    summarizePlan,
  });
}

function safeErrorCode(error) {
  if (
    error instanceof OwnerRecordGenerationMigrationScriptError &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "planning_failed";
}

async function main(argv, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let runtime;
  try {
    const parsed = parseCliArguments(argv);
    const prepared = prepareOutputPair(parsed);
    const createRuntime = options.createRuntime ?? productionRuntime;
    runtime = await createRuntime(parsed);
    if (
      runtime === null ||
      typeof runtime !== "object" ||
      typeof runtime.collectInventory !== "function" ||
      typeof runtime.planMigration !== "function" ||
      typeof runtime.summarizePlan !== "function"
    ) {
      return fail("runtime_contract_unavailable");
    }

    const inventory = await runtime.collectInventory({
      ownerUid: parsed.ownerUid,
      projectId: parsed.projectId,
    });
    const plan = await runtime.planMigration(inventory);
    if (
      !isPlainRecord(plan) ||
      plan.projectId !== parsed.projectId ||
      plan.ownerUid !== parsed.ownerUid ||
      !SAFE_CLASSIFICATIONS.has(plan.classification)
    ) {
      return fail("invalid_plan");
    }
    const summary = await runtime.summarizePlan(plan);
    const machineSource = safeJson(
      plan,
      MAX_MACHINE_PLAN_BYTES,
      "invalid_plan",
    );
    const summarySource = validateRedactedSummary(summary, plan);
    writeOutputPair(
      prepared,
      machineSource,
      summarySource,
      options.outputOptions,
    );

    stdout.write(summarySource);
    if (
      parsed.failOnManualReview &&
      (plan.classification === "manual_review_required" ||
        plan.classification === "blocked_active_removal")
    ) {
      return 3;
    }
    return 0;
  } catch (error) {
    const code = safeErrorCode(error);
    stderr.write(`owner-generation-migration: ${code}\n`);
    return code === "usage" ? 2 : 1;
  } finally {
    if (runtime && typeof runtime.cleanup === "function") {
      try {
        await runtime.cleanup();
      } catch {
        // Cleanup details may contain project identifiers and remain opaque.
      }
    }
  }
}

module.exports = {
  OwnerRecordGenerationMigrationScriptError,
  main,
  parseCliArguments,
  prepareOutputPair,
  productionRuntime,
  validateRedactedSummary,
  writeOutputPair,
};

if (require.main === module) {
  main(process.argv).then((status) => {
    process.exitCode = status;
  });
}
