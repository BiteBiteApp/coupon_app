"use strict";

const assert = require("node:assert/strict");
const {readdirSync, readFileSync, statSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const privateCollections = Object.freeze([
  "admin_user_directory",
  "admin_user_directory_source_summaries",
  "admin_user_claimed_restaurant_index",
]);

function filesBelow(directory, suffix) {
  const results = [];
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) results.push(...filesBelow(target, suffix));
    else if (target.endsWith(suffix)) results.push(target);
  }
  return results;
}

test("new private collections remain covered by the current default-deny catch-all", () => {
  const rules = readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
  for (const collection of privateCollections) {
    assert.equal(rules.includes(collection), false, collection);
  }
  assert.match(
    rules,
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/u,
  );
});

test("Flutter production source has no import or read of a private directory collection", () => {
  const flutterRoot = path.resolve(__dirname, "../../lib");
  const productionSource = filesBelow(flutterRoot, ".dart")
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  for (const collection of privateCollections) {
    assert.equal(productionSource.includes(collection), false, collection);
  }
});

test("directory maintenance source contains no logging boundary", () => {
  const sourceFiles = [
    "admin_user_directory_contract.ts",
    "admin_user_directory_builders.ts",
    "admin_user_directory_maintenance.ts",
  ];
  for (const sourceFile of sourceFiles) {
    const source = readFileSync(path.resolve(__dirname, `../src/${sourceFile}`), "utf8");
    assert.doesNotMatch(source, /\b(?:console|logger)\s*\./u, sourceFile);
  }
});

test("directory trigger wrappers contain no logging boundary", () => {
  const source = readFileSync(path.resolve(__dirname, "../src/index.ts"), "utf8");
  const start = source.indexOf(
    "export const maintainAdminUserDirectoryFromRestaurantAccount",
  );
  const end = source.indexOf(
    "export const processPrivateSearchIndexJob",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const triggerBlock = source.slice(start, end);
  assert.doesNotMatch(triggerBlock, /\b(?:console|logger)\s*\./u);
});
