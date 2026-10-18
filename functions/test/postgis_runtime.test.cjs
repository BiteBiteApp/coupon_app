"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {readFileSync} = require("node:fs"), {resolve} = require("node:path"), vm = require("node:vm");
const compiled = readFileSync(resolve(__dirname, "../lib/postgis_runtime.js"), "utf8");
const linuxHash = "7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c";
const darwinHash = "e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b";
function fixture(overrides = {}) {
  const process = {version: "v24.21.0", versions: {v8: "13.6.233.17-node.53"},
    platform: "linux", arch: "x64", execPath: "/qualified/node", execArgv: [], env: {}};
  const state = {hash: linuxHash, kernel: "7.0.14-linuxkit", models: ["VirtualApple @ 2.50GHz"], reads: 0, ...overrides};
  Object.assign(process, overrides.process);
  const exports = {};
  vm.runInNewContext(compiled, {exports, process, require(name) {
    if (name === "node:crypto") return {createHash: () => ({update: () => ({digest: () => state.hash})})};
    if (name === "node:fs") return {readFileSync(path) {assert.equal(path, process.execPath); state.reads++; return Buffer.from("fixture");}};
    if (name === "node:os") return {release: () => state.kernel, cpus: () => state.models.map(model => ({model}))};
    throw Error(`Unexpected dependency ${name}`);
  }});
  return {check: exports.requireQualifiedPostgisRuntime, process, state};
}
test("exact local Linux tuple is accepted and cached without granting hosted scope", () => {
  const f = fixture(); f.check("local"); f.check(); assert.equal(f.state.reads, 1);
  assert.throws(() => f.check("hosted"), /hosted Linux runtime is unqualified/);
  assert.throws(() => fixture().check("hosted"), /hosted Linux runtime is unqualified/);
});
test("Linux qualification refuses other binary, V8, Node, architecture, kernel and CPU tuples", () => {
  for (const mismatch of [{hash: "0".repeat(64)}, {kernel: "7.0.15-linuxkit"}, {models: ["native x86 CPU"]},
    {models: []}, {models: ["VirtualApple @ 2.50GHz", "other"]}, {process: {arch: "arm64"}},
    {process: {platform: "win32"}}, {process: {version: "v24.22.0"}}, {process: {versions: {v8: "different"}}}]) {
    assert.throws(() => fixture(mismatch).check(), /runtime is unqualified/);
  }
});
test("scope and flags are checked again after cached local qualification", () => {
  const f = fixture(); f.check();
  for (const scope of ["", "LOCAL", null, {}, true]) assert.throws(() => f.check(scope), /qualification scope/);
  f.process.env.NODE_OPTIONS = "--jitless";
  assert.throws(() => f.check(), /flags are unqualified/);
  delete f.process.env.NODE_OPTIONS; f.process.execArgv.push("--jitless");
  assert.throws(() => f.check(), /flags are unqualified/);
  f.process.execArgv = ["--test", "--test-isolation=none", "--max-old-space-size=512"]; f.check();
});
test("previous exact Darwin qualification remains unchanged", () => {
  const f = fixture({hash: darwinHash, process: {platform: "darwin", arch: "arm64"}});
  f.check(); f.check("hosted"); assert.equal(f.state.reads, 1);
  assert.throws(() => fixture({hash: linuxHash, process: {platform: "darwin", arch: "arm64"}}).check(), /runtime is unqualified/);
});
test("both hosted entry paths explicitly require hosted numerical qualification", () => {
  for (const name of ["postgis_hosted_entrypoint.ts", "postgis_hosted_runtime.ts"]) {
    const source = readFileSync(resolve(__dirname, "../src", name), "utf8");
    assert.match(source, /requireQualifiedPostgisRuntime\("hosted"\)/);
    assert.doesNotMatch(source, /requireQualifiedPostgisRuntime\(\)/);
  }
});
test("actual qualified local process cannot unlock Linux hosted scope", {skip: process.env.BS_POSTGIS_RUNTIME_TEST !== "1"}, () => {
  const {requireQualifiedPostgisRuntime} = require("../lib/postgis_runtime.js");
  requireQualifiedPostgisRuntime("local");
  if (process.platform === "linux") assert.throws(() => requireQualifiedPostgisRuntime("hosted"), /hosted Linux runtime is unqualified/);
});
