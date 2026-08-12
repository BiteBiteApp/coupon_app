"use strict";

const assert = require("node:assert/strict");
const {
  existsSync,
  readFileSync,
  readdirSync,
} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const functionsRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(functionsRoot, "src");
const compiledRoot = path.join(functionsRoot, "lib");

const expectedChildCollections = Object.freeze([
  "coupons",
  "daily_specials",
  "coupon_number_reservations",
  "coupon_code_reservations",
  "menu_images",
  "menu_items",
  "menu_sections",
]);

const expectedStorageKinds = Object.freeze([
  "restaurant_images",
  "coupon_images",
  "menu_images",
]);

/** Exact retained-data canaries from the owner-record-removal policy. */
const retainedCollectionCanaries = Object.freeze([
  "user_profiles",
  "user_profiles/{targetUid}/favorite_restaurants",
  "user_profiles/{targetUid}/favorite_dishes",
  "user_profiles/{targetUid}/favorite_coupons",
  "user_profiles/{targetUid}/local_expert_badges",
  "user_profiles/{targetUid}/local_expert_badge_celebrations",
  "public_reviewer_profiles",
  "public_usernames",
  "dish_reviews",
  "review_feedback_votes",
  "bitescore_dish_image_votes",
  "bitescore_dish_images",
  "restaurant_reports",
  "dish_reports",
  "review_reports",
  "duplicate_restaurant_reports",
  "dish_edit_proposals",
  "restaurant_claim_requests",
  "bitescore_contribution_point_ledger",
  "customer_redemptions/{targetUid}/coupon_redemptions",
  "customer_device_installations",
  "proximity_push_requests",
  "restaurant_invites",
  "restaurant_name_change_requests",
  "bitesaver_reports",
  "restaurant_menus",
  "private_owner_billing_states",
  "private_rating_destructive_jobs",
  "private_rating_destructive_job_items",
  "private_rating_restaurant_operation_locks",
  "private_rating_dish_operation_locks",
  "private_dish_edit_proposal_group_members",
  "private_dish_edit_proposal_group_supporters",
  "private_dish_edit_proposal_groups",
  "private_dish_edit_application_jobs",
  "private_dish_merge_review_locks",
  "private_review_milestone_count_accumulators",
  "private_review_milestone_reconciliation_locks",
  "private_review_milestone_reconciliation_terminal_states",
]);

function ownerRemovalSourceNames() {
  return readdirSync(sourceRoot)
    .filter((name) =>
      name.startsWith("owner_record_removal_") && name.endsWith(".ts"))
    .sort();
}

function ownerRemovalSources() {
  return ownerRemovalSourceNames().map((name) => ({
    name,
    source: readFileSync(path.join(sourceRoot, name), "utf8"),
  }));
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

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("all private owner-removal modules compile and remain package-selected", () => {
  const sourceNames = ownerRemovalSourceNames();
  assert.ok(sourceNames.length >= 4, sourceNames.join(","));

  const tsconfig = JSON.parse(
    readFileSync(path.join(functionsRoot, "tsconfig.json"), "utf8"),
  );
  assert.deepEqual(tsconfig.include, ["src"]);
  assert.equal(tsconfig.compilerOptions.outDir, "lib");

  const firebaseConfig = JSON.parse(
    readFileSync(path.join(repositoryRoot, "firebase.json"), "utf8"),
  );
  const functionsConfig = firebaseConfig.functions.find(
    (candidate) =>
      candidate.source === "functions" && candidate.codebase === "default",
  );
  assert.ok(functionsConfig);

  for (const sourceName of sourceNames) {
    const moduleName = sourceName.slice(0, -3);
    const compiledName = `${moduleName}.js`;
    const sourcePath = `src/${sourceName}`;
    const compiledPath = `lib/${compiledName}`;
    assert.equal(
      functionsConfig.ignore.some((pattern) =>
        simpleMatchBase(pattern, sourcePath)),
      false,
      sourcePath,
    );
    assert.equal(
      functionsConfig.ignore.some((pattern) =>
        simpleMatchBase(pattern, compiledPath)),
      false,
      compiledPath,
    );
    assert.equal(existsSync(path.join(compiledRoot, compiledName)), true);
    assert.equal(existsSync(path.join(compiledRoot, `${compiledName}.map`)), true);
    const loaded = require(path.join(compiledRoot, compiledName));
    assert.equal(typeof loaded, "object", compiledName);
  }

  const packagingValidator = readFileSync(
    path.join(functionsRoot, "scripts/verify_firebase_cli_packaging.js"),
    "utf8",
  );
  assert.match(packagingValidator, /prepareFunctionsUpload\(/u);
  assert.match(packagingValidator, /listArchiveEntries\(archivePath\)/u);
  assert.match(packagingValidator, /isForbiddenArchivePath/u);
});

test("private owner-removal modules have no public Function wiring", () => {
  const sourceIndex = readFileSync(path.join(sourceRoot, "index.ts"), "utf8");
  const compiledIndex = readFileSync(path.join(compiledRoot, "index.js"), "utf8");
  const forbiddenIdentity =
    /owner_record_removal|ownerRecordRemoval|private_owner_record_removal_jobs/u;
  assert.doesNotMatch(sourceIndex, forbiddenIdentity);
  assert.doesNotMatch(compiledIndex, forbiddenIdentity);
});

test("the private job collection is denied by the final recursive rule", () => {
  const contract = require("../lib/owner_record_removal_contract.js");
  assert.equal(
    contract.ownerRecordRemovalJobCollection,
    "private_owner_record_removal_jobs",
  );

  const rules = readFileSync(
    path.join(repositoryRoot, "firestore.rules"),
    "utf8",
  );
  assert.doesNotMatch(rules, /private_owner_record_removal_jobs/u);
  assert.match(
    rules,
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}\s*\}\s*\}\s*$/u,
  );
});

test("private modules install no endpoint, provider, mutation, or log binding", () => {
  const forbiddenPatterns = Object.freeze([
    /from ["']firebase-functions(?:\/v2\/(?:https|scheduler))?["']/u,
    /\b(?:onCall|onRequest|onSchedule)\s*\(/u,
    /\bdefineSecret\s*\(/u,
    /from ["']stripe["']|require\(["']stripe["']\)/iu,
    /\bstripe\.(?:customers|subscriptions|checkout)\b/iu,
    /from ["']firebase-admin\/auth["']/u,
    /\b(?:getAuth|deleteUser|updateUser|setCustomUserClaims|revokeRefreshTokens)\s*\(/u,
    /from ["']firebase-admin\/storage["']/u,
    /from ["']@google-cloud\/storage["']/u,
    /\bgetStorage\s*\(|\.bucket\s*\(|\.getFiles\s*\(/u,
    /\b(?:logger|console)\.(?:debug|error|info|log|warn)\s*\(/u,
  ]);

  for (const {name, source} of ownerRemovalSources()) {
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${name}: ${pattern}`);
    }
  }
});

test("destructive namespaces are fixed and disjoint from retained canaries", () => {
  const storageContract = require("../lib/owner_record_removal_storage.js");
  const processor = require("../lib/owner_record_removal_processor.js");
  assert.deepEqual(
    [...storageContract.ownerRecordRemovalStorageKinds],
    expectedStorageKinds,
  );
  assert.equal(Object.isFrozen(storageContract.ownerRecordRemovalStorageKinds), true);

  assert.ok(Array.isArray(processor.ownerRecordRemovalChildPhases));
  assert.equal(Object.isFrozen(processor.ownerRecordRemovalChildPhases), true);
  const childCollections = processor.ownerRecordRemovalChildPhases.map(
    (value) => value.collection,
  );
  assert.deepEqual(childCollections, expectedChildCollections);
  assert.equal(new Set(childCollections).size, expectedChildCollections.length);
  assert.equal(
    processor.ownerRecordRemovalChildPhases.every(Object.isFrozen),
    true,
  );
  assert.deepEqual(
    processor.ownerRecordRemovalStoragePhases.map((value) => value.kind),
    expectedStorageKinds,
  );
  assert.equal(Object.isFrozen(processor.ownerRecordRemovalStoragePhases), true);
  assert.equal(
    processor.ownerRecordRemovalStoragePhases.every(Object.isFrozen),
    true,
  );

  assert.equal(
    new Set(retainedCollectionCanaries).size,
    retainedCollectionCanaries.length,
  );
  const retainedTopLevels = new Set(
    retainedCollectionCanaries.map((value) => value.split("/")[0]),
  );
  for (const collection of expectedChildCollections) {
    assert.equal(retainedTopLevels.has(collection), false, collection);
  }

  for (const kind of expectedStorageKinds) {
    assert.equal(
      storageContract.buildOwnerRecordRemovalStoragePrefix("scope-uid", kind),
      `bitesaver_restaurants/scope-uid/${kind}/`,
    );
  }
  for (const retainedPath of [
    "restaurant_menus/scope-uid/menu_images/object.webp",
    "bitescore_dishes/dish-id/images/object.webp",
    "bitesaver_restaurants/other-uid/menu_images/object.webp",
  ]) {
    assert.throws(() =>
      storageContract.validateOwnerRecordRemovalStorageObjectName({
        targetUid: "scope-uid",
        kind: "menu_images",
        name: retainedPath,
      }));
  }

  const destructiveExpressions = ownerRemovalSources()
    .flatMap(({source}) =>
      [...source.matchAll(/deleteDocument\(([\s\S]{0,240}?)\)/gu)])
    .map((match) => match[1]);
  for (const canary of retainedTopLevels) {
    const pattern = new RegExp(escapeRegularExpression(canary), "u");
    for (const expression of destructiveExpressions) {
      assert.doesNotMatch(expression, pattern, canary);
    }
  }
});

test("legacy recursive account cleanup remains a deferred unfenced hazard", () => {
  const sourceIndex = readFileSync(path.join(sourceRoot, "index.ts"), "utf8");
  const start = sourceIndex.indexOf(
    "export const cleanupDeletedRestaurantCoupons",
  );
  const end = sourceIndex.indexOf(
    "export const maintainBiteScoreRestaurantGeohash",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const cleanupSource = sourceIndex.slice(start, end);

  assert.match(
    cleanupSource,
    /onDocumentDeleted\(\s*["']restaurant_accounts\/\{uid\}["']/u,
  );
  for (const child of [
    "coupons",
    "coupon_number_reservations",
    "coupon_code_reservations",
  ]) {
    assert.match(
      cleanupSource,
      new RegExp(
        `recursiveDelete\\(\\s*(?:accountRef\\.)?collection\\(["']${
          escapeRegularExpression(child)}["']\\)`,
        "u",
      ),
    );
  }
  assert.doesNotMatch(cleanupSource, /ownerRecordGeneration/u);
  assert.doesNotMatch(cleanupSource, /private_owner_record_states/u);
  assert.doesNotMatch(cleanupSource, /private_owner_record_removal_jobs/u);
  assert.doesNotMatch(cleanupSource, /generation/u);
});
