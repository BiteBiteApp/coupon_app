"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PaginationProtocolError,
  adminDirectoryDefaultPageSize,
  customerDiscoveryDefaultPageSize,
  exactTotalPageCount,
  maximumPageSize,
  operationalQueueDefaultPageSize,
  pageProtocolVersion,
  parsePagedRequest,
  parsePagedResponse,
  parsePagedTotal,
  requirePageSize,
} = require("../lib/pagination_protocol.js");
const {createQueryFingerprint} = require("../lib/query_fingerprint.js");

const fingerprint = "a".repeat(64);

function request(overrides = {}) {
  return {
    protocolVersion: pageProtocolVersion,
    criteria: {source: "bitesaver", pageSize: 50},
    direction: "first",
    requestExactCount: true,
    clientRequestId: "request-1",
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    protocolVersion: pageProtocolVersion,
    items: [{id: "one"}],
    pageSize: 50,
    hasNext: true,
    hasPrevious: false,
    nextCursor: "opaque-next",
    currentPageNumber: 1,
    total: {state: "exact", value: 51},
    queryFingerprint: fingerprint,
    snapshotTimestampMs: 1_786_185_600_000,
    capabilities: {
      first: false,
      previous: false,
      numberedVisitedPages: true,
      next: true,
      last: true,
    },
    ...overrides,
  };
}

test("protocol and default page-size policies are exact", () => {
  assert.equal(pageProtocolVersion, "bitestar.page.v1");
  assert.equal(operationalQueueDefaultPageSize, 25);
  assert.equal(adminDirectoryDefaultPageSize, 50);
  assert.equal(customerDiscoveryDefaultPageSize >= 20, true);
  assert.equal(customerDiscoveryDefaultPageSize <= 30, true);
  assert.equal(maximumPageSize, 100);
  assert.equal(requirePageSize(undefined, 50), 50);
  assert.equal(requirePageSize(100, 50), 100);
  for (const invalid of [0, 101, 1.5, NaN, "50"] ) {
    assert.throws(() => requirePageSize(invalid, 50), PaginationProtocolError);
  }
});

test("request parsing supports first, forward, backward, and last cursor rules", () => {
  assert.equal(parsePagedRequest(request()).direction, "first");
  assert.equal(
    parsePagedRequest(request({direction: "forward", cursor: "bsp1.next"})).cursor,
    "bsp1.next",
  );
  assert.equal(
    parsePagedRequest(request({direction: "backward", cursor: "bsp1.previous"})).direction,
    "backward",
  );
  assert.equal(parsePagedRequest(request({direction: "last"})).direction, "last");
  for (const invalid of [
    request({direction: "sideways"}),
    request({direction: "forward"}),
    request({direction: "backward"}),
    request({cursor: "unexpected"}),
    request({direction: "last", cursor: "unexpected"}),
  ]) {
    assert.throws(() => parsePagedRequest(invalid), PaginationProtocolError);
  }
});

test("request parsing rejects wrong protocol and unsupported criteria", () => {
  assert.throws(
    () => parsePagedRequest(request({protocolVersion: "bitestar.page.v2"})),
    PaginationProtocolError,
  );
  assert.throws(
    () => parsePagedRequest(request({criteria: {radius: Infinity}})),
    PaginationProtocolError,
  );
});

test("request cloning safely preserves prototype-sensitive own criteria keys", () => {
  const input = JSON.parse(`{
    "protocolVersion":"bitestar.page.v1",
    "pageSize":25,
    "criteria":{
      "__proto__":{"polluted":"yes"},
      "constructor":{"kind":"ordinary-own-value"},
      "prototype":"ordinary-own-value",
      "nested":{
        "__proto__":{"nestedPolluted":"yes"},
        "constructor":"nested-constructor",
        "prototype":"nested-prototype"
      },
      "ordinary":{"active":true},
      "ordered":["first",{"__proto__":{"listPolluted":"yes"}},"last"]
    },
    "direction":"first",
    "requestExactCount":false,
    "clientRequestId":"prototype-safe-request"
  }`);
  const originalCriteria = input.criteria;
  assert.equal(
    Object.prototype.hasOwnProperty.call(originalCriteria, "__proto__"),
    true,
  );

  const parsed = parsePagedRequest(input);
  const clonedCriteria = parsed.criteria;
  const ownPrototypeDescriptor = Object.getOwnPropertyDescriptor(
    clonedCriteria,
    "__proto__",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(clonedCriteria, "__proto__"),
    true,
  );
  assert.equal(Object.keys(clonedCriteria).includes("__proto__"), true);
  assert.equal(ownPrototypeDescriptor.enumerable, true);
  assert.equal(ownPrototypeDescriptor.get, undefined);
  assert.deepEqual(ownPrototypeDescriptor.value, {polluted: "yes"});
  assert.equal(Object.getPrototypeOf(clonedCriteria), Object.prototype);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);

  const nested = clonedCriteria.nested;
  assert.equal(Object.prototype.hasOwnProperty.call(nested, "__proto__"), true);
  assert.equal(Object.keys(nested).includes("__proto__"), true);
  assert.deepEqual(nested.__proto__, {nestedPolluted: "yes"});
  assert.equal(Object.getPrototypeOf(nested), Object.prototype);
  const listEntry = clonedCriteria.ordered[1];
  assert.equal(Object.prototype.hasOwnProperty.call(listEntry, "__proto__"), true);
  assert.deepEqual(listEntry.__proto__, {listPolluted: "yes"});
  assert.equal(Object.getPrototypeOf(listEntry), Object.prototype);

  assert.equal(
    Object.prototype.hasOwnProperty.call(clonedCriteria, "constructor"),
    true,
  );
  assert.deepEqual(clonedCriteria.constructor, {kind: "ordinary-own-value"});
  assert.equal(
    Object.prototype.hasOwnProperty.call(clonedCriteria, "prototype"),
    true,
  );
  assert.equal(clonedCriteria.prototype, "ordinary-own-value");
  assert.equal(
    Object.prototype.hasOwnProperty.call(nested, "constructor"),
    true,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(nested, "prototype"), true);

  assert.deepEqual(clonedCriteria, originalCriteria);
  assert.equal(
    createQueryFingerprint(clonedCriteria),
    createQueryFingerprint(originalCriteria),
  );
  const roundTripped = JSON.parse(JSON.stringify(clonedCriteria));
  assert.deepEqual(roundTripped, originalCriteria);
  assert.equal(
    Object.prototype.hasOwnProperty.call(roundTripped, "__proto__"),
    true,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(roundTripped.nested, "__proto__"),
    true,
  );
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.prototype.nestedPolluted, undefined);
  assert.equal(Object.prototype.listPolluted, undefined);
});

test("exact and unknown total shapes are strict", () => {
  assert.deepEqual(parsePagedTotal({state: "exact", value: 0}), {
    state: "exact",
    value: 0,
  });
  assert.deepEqual(parsePagedTotal({state: "unknown"}), {state: "unknown"});
  for (const invalid of [
    {state: "exact"},
    {state: "exact", value: -1},
    {state: "exact", value: 1.5},
    {state: "unknown", value: 4},
    {state: "other"},
  ]) {
    assert.throws(() => parsePagedTotal(invalid), PaginationProtocolError);
  }
  assert.equal(exactTotalPageCount({state: "exact", value: 101}, 50), 3);
  assert.equal(exactTotalPageCount({state: "exact", value: 0}, 50), 1);
  assert.equal(exactTotalPageCount({state: "unknown"}, 50), undefined);
});

test("response parses projected items without retaining raw maps", () => {
  const raw = response();
  const parsed = parsePagedResponse(raw, (value) => ({key: value.id}));
  assert.deepEqual(parsed.items, [{key: "one"}]);
  assert.equal(parsed.nextCursor, "opaque-next");
  assert.equal(parsed.total.value, 51);
  assert.notEqual(parsed, raw);
  assert.notEqual(parsed.items[0], raw.items[0]);
  assert.equal(Object.hasOwn(parsed, "offset"), false);
});

test("response cursor, capability, count, and preparation contradictions fail", () => {
  for (const invalid of [
    response({nextCursor: undefined}),
    response({hasNext: false}),
    response({capabilities: {...response().capabilities, next: false}}),
    response({total: {state: "unknown", value: 2}}),
    response({preparation: {state: "preparing", completedUnits: 1, totalUnits: 2}}),
    response({currentPageNumber: 3}),
  ]) {
    assert.throws(() => parsePagedResponse(invalid, (item) => item), PaginationProtocolError);
  }
});

test("unknown or omitted totals and valid preparation are accepted", () => {
  const unknown = parsePagedResponse(
    response({total: {state: "unknown"}}),
    (item) => item,
  );
  assert.equal(unknown.total.state, "unknown");
  const omitted = response();
  delete omitted.total;
  assert.equal(parsePagedResponse(omitted, (item) => item).total, undefined);

  const preparing = response({
    total: {state: "unknown"},
    items: [],
    preparation: {state: "preparing", completedUnits: 2, totalUnits: 9},
  });
  assert.equal(
    parsePagedResponse(preparing, (item) => item).preparation.state,
    "preparing",
  );
});
