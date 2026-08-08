"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RadiusSessionContractError,
  canNavigateToRadiusPage,
  parseRadiusSessionContract,
  radiusSessionAbsoluteTimeoutMs,
  radiusSessionExpiryState,
  radiusSessionIdleTimeoutMs,
} = require("../lib/radius_session_contract.js");
const {pageProtocolVersion} = require("../lib/pagination_protocol.js");

const createdAtMs = 1_000_000;

function session(overrides = {}) {
  return {
    protocolVersion: pageProtocolVersion,
    sessionId: "opaque-session-id",
    queryFingerprint: "a".repeat(64),
    callerBinding: "b".repeat(64),
    source: "bitesaver",
    searchMode: "radius",
    rangeCursors: [
      {rangeId: "range-1", cursor: "opaque-range-cursor", exhausted: false},
      {rangeId: "range-2", exhausted: true},
    ],
    createdAtMs,
    lastUsedAtMs: createdAtMs,
    idleExpiresAtMs: createdAtMs + radiusSessionIdleTimeoutMs,
    absoluteExpiresAtMs: createdAtMs + radiusSessionAbsoluteTimeoutMs,
    state: "preparing",
    progress: {
      completedRanges: 1,
      totalRanges: 2,
      candidatesExamined: 125,
      resultsMaterialized: 30,
    },
    pageAnchors: [{pageNumber: 1, cursor: "opaque-page-1"}],
    ...overrides,
  };
}

test("valid preparing lifecycle carries progress but no fabricated total", () => {
  const parsed = parseRadiusSessionContract(session());
  assert.equal(parsed.state, "preparing");
  assert.equal(parsed.progress.completedRanges, 1);
  assert.equal(parsed.exactTotal, undefined);
});

test("ready lifecycle requires completion and exposes exact total", () => {
  const parsed = parseRadiusSessionContract(session({
    state: "ready",
    exactTotal: 75,
    progress: {
      completedRanges: 2,
      totalRanges: 2,
      candidatesExamined: 300,
      resultsMaterialized: 75,
    },
  }));
  assert.equal(parsed.exactTotal, 75);
  assert.throws(
    () => parseRadiusSessionContract(session({exactTotal: 10})),
    RadiusSessionContractError,
  );
  assert.throws(
    () => parseRadiusSessionContract(session({state: "ready", exactTotal: 10})),
    RadiusSessionContractError,
  );
});

test("idle and absolute expiry are deterministic with absolute precedence", () => {
  const parsed = parseRadiusSessionContract(session());
  assert.equal(radiusSessionExpiryState(parsed, createdAtMs), "active");
  assert.equal(
    radiusSessionExpiryState(parsed, createdAtMs + radiusSessionIdleTimeoutMs),
    "idle-expired",
  );
  assert.equal(
    radiusSessionExpiryState(parsed, createdAtMs + radiusSessionAbsoluteTimeoutMs),
    "absolute-expired",
  );
});

test("only materialized visited page anchors are navigable", () => {
  const parsed = parseRadiusSessionContract(session({
    pageAnchors: [
      {pageNumber: 1, cursor: "page-1"},
      {pageNumber: 2, cursor: "page-2"},
    ],
  }));
  assert.equal(canNavigateToRadiusPage(parsed, 1), true);
  assert.equal(canNavigateToRadiusPage(parsed, 2), true);
  assert.equal(canNavigateToRadiusPage(parsed, 3), false);
});

test("session timing, ranges, progress, and anchor invariants fail closed", () => {
  for (const invalid of [
    session({idleExpiresAtMs: createdAtMs + 1}),
    session({absoluteExpiresAtMs: createdAtMs + 2}),
    session({rangeCursors: [{rangeId: "range-1", cursor: "x", exhausted: true}]}),
    session({pageAnchors: [{pageNumber: 2, cursor: "x"}, {pageNumber: 1, cursor: "y"}]}),
    session({progress: {completedRanges: 3, totalRanges: 2, candidatesExamined: 0, resultsMaterialized: 0}}),
  ]) {
    assert.throws(() => parseRadiusSessionContract(invalid), RadiusSessionContractError);
  }
});
