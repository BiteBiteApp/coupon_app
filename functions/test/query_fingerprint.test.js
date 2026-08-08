"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  QueryFingerprintError,
  canonicalSerializeQueryCriteria,
  createQueryFingerprint,
} = require("../lib/query_fingerprint.js");

test("fingerprint is independent of map insertion order including nested maps", () => {
  const left = {
    source: "bitesaver",
    location: {state: "FL", zip: "34461"},
    active: true,
    nullable: null,
    pageSize: 50,
  };
  const right = {
    pageSize: 50,
    nullable: null,
    active: true,
    location: {zip: "34461", state: "FL"},
    source: "bitesaver",
  };
  assert.equal(createQueryFingerprint(left), createQueryFingerprint(right));
  assert.equal(createQueryFingerprint(left).length, 64);
});

test("criteria changes produce distinct fingerprints", () => {
  const base = {
    source: "bitesaver",
    mode: "zip",
    zip: "34461",
    radiusMiles: 25,
    nameToken: "sub",
    status: "approved",
    sort: "name",
    pageSize: 50,
    callerPolicy: "admin-v1",
  };
  for (const [key, value] of [
    ["source", "bitescore"],
    ["mode", "city"],
    ["zip", "01234"],
    ["radiusMiles", 30],
    ["nameToken", "paig"],
    ["status", "pending"],
    ["sort", "distance"],
    ["pageSize", 25],
    ["callerPolicy", "customer-v1"],
  ]) {
    assert.notEqual(
      createQueryFingerprint(base),
      createQueryFingerprint({...base, [key]: value}),
      key,
    );
  }
});

test("ordered list order is preserved by default", () => {
  assert.notEqual(
    createQueryFingerprint({sort: ["name", "id"]}),
    createQueryFingerprint({sort: ["id", "name"]}),
  );
});

test("only explicitly unordered list paths are canonicalized as sets", () => {
  const options = {unorderedListPaths: ["sources", "nested.statuses"]};
  assert.equal(
    createQueryFingerprint(
      {sources: ["bitesaver", "bitescore"], nested: {statuses: ["a", "b"]}},
      options,
    ),
    createQueryFingerprint(
      {nested: {statuses: ["b", "a"]}, sources: ["bitescore", "bitesaver"]},
      options,
    ),
  );
});

test("canonical serialization has explicit type distinctions", () => {
  assert.notEqual(
    canonicalSerializeQueryCriteria({value: "1"}),
    canonicalSerializeQueryCriteria({value: 1}),
  );
  assert.notEqual(
    canonicalSerializeQueryCriteria({value: null}),
    canonicalSerializeQueryCriteria({value: false}),
  );
});

test("unsupported, nonfinite, unsafe, cyclic, and malformed options fail", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  for (const value of [
    {value: undefined},
    {value: NaN},
    {value: Infinity},
    {value: 1.5},
    {value: Number.MAX_SAFE_INTEGER + 1},
    {value: 1n},
    {value: new Date()},
    cyclic,
  ]) {
    assert.throws(() => createQueryFingerprint(value), QueryFingerprintError);
  }
  assert.throws(
    () => createQueryFingerprint({values: []}, {unorderedListPaths: [""]}),
    QueryFingerprintError,
  );
});
