"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {customerBiteScoreActorBinding} = require("../lib/customer_bitescore_runtime.js");

test("authenticated admission stays bound to one user across client instances; guest and user scopes remain separate", () => {
  const key = Buffer.alloc(32, 41);
  const first = customerBiteScoreActorBinding(key, "user-a", "instance-a");
  assert.equal(first, customerBiteScoreActorBinding(key, "user-a", "instance-b"));
  assert.notEqual(first, customerBiteScoreActorBinding(key, "user-b", "instance-a"));
  assert.notEqual(first, customerBiteScoreActorBinding(key, null, "user-a"));
  assert.notEqual(customerBiteScoreActorBinding(key, null, "instance-a"), customerBiteScoreActorBinding(key, null, "instance-b"));
});
