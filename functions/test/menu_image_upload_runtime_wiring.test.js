"use strict";

const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("menu image upload authorization is exported as a regional callable", () => {
  const indexPath = path.resolve(__dirname, "../lib/index.js");
  const script = `
    const exported = require(${JSON.stringify(indexPath)})
      .issueMenuImageUploadAuthorization;
    process.stdout.write(JSON.stringify(exported?.__endpoint ?? null));
  `;
  const endpoint = JSON.parse(execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
  }));

  assert.ok(endpoint);
  assert.deepEqual(endpoint.region, ["us-central1"]);
  assert.deepEqual(endpoint.callableTrigger, {});
});
