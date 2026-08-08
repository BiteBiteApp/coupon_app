"use strict";

const assert = require("node:assert/strict");
const {
  createCipheriv,
} = require("node:crypto");
const test = require("node:test");

const {
  OpaqueCursorCodec,
  OpaqueCursorError,
  opaqueCursorAuthenticationTagByteLength,
  opaqueCursorDefaultLifetimeMs,
  opaqueCursorNonceByteLength,
  opaqueCursorPrefix,
} = require("../lib/opaque_cursor.js");
const {pageProtocolVersion} = require("../lib/pagination_protocol.js");

const issuedAtMs = 1_786_185_600_000;
const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 8);
const fingerprint = "a".repeat(64);
const callerBinding = "b".repeat(64);

function nonce(seed) {
  return Uint8Array.from(
    {length: opaqueCursorNonceByteLength},
    (_, index) => (seed + index) % 256,
  );
}

function codec({clock = () => issuedAtMs, keyValue = key, seed = 1} = {}) {
  return new OpaqueCursorCodec({
    key: keyValue,
    clock,
    nonceSource: () => nonce(seed),
  });
}

function input(overrides = {}) {
  return {
    queryFingerprint: fingerprint,
    source: "bitesaver",
    searchMode: "zip",
    pageSize: 50,
    purpose: "forward",
    sortTuple: ["paiges root beer", "document-private-id"],
    callerBinding,
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    queryFingerprint: fingerprint,
    source: "bitesaver",
    searchMode: "zip",
    pageSize: 50,
    callerBinding,
    purposes: ["forward"],
    ...overrides,
  };
}

function encryptedToken(payload, keyValue = key, nonceValue = nonce(77)) {
  const cipher = createCipheriv("aes-256-gcm", keyValue, nonceValue);
  cipher.setAAD(Buffer.from(opaqueCursorPrefix, "ascii"));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  assert.equal(tag.length, opaqueCursorAuthenticationTagByteLength);
  return `${opaqueCursorPrefix}${Buffer.concat([
    Buffer.from(nonceValue),
    tag,
    encrypted,
  ]).toString("base64url")}`;
}

function rawPayload(overrides = {}) {
  return {
    protocolVersion: pageProtocolVersion,
    queryFingerprint: fingerprint,
    source: "bitesaver",
    searchMode: "zip",
    pageSize: 50,
    purpose: "forward",
    sortTuple: ["name", "document-id"],
    callerBinding,
    issuedAtMs,
    expiresAtMs: issuedAtMs + opaqueCursorDefaultLifetimeMs,
    ...overrides,
  };
}

test("AES-256-GCM codec round trips the fully bound payload", () => {
  const token = codec().encode(input({sessionId: "opaque-session"}));
  const decoded = codec().decode(token, binding());
  assert.equal(decoded.protocolVersion, pageProtocolVersion);
  assert.equal(decoded.queryFingerprint, fingerprint);
  assert.equal(decoded.source, "bitesaver");
  assert.equal(decoded.searchMode, "zip");
  assert.equal(decoded.pageSize, 50);
  assert.equal(decoded.purpose, "forward");
  assert.deepEqual(decoded.sortTuple, ["paiges root beer", "document-private-id"]);
  assert.equal(decoded.callerBinding, callerBinding);
  assert.equal(decoded.issuedAtMs, issuedAtMs);
  assert.equal(decoded.expiresAtMs, issuedAtMs + opaqueCursorDefaultLifetimeMs);
  assert.equal(decoded.sessionId, "opaque-session");
});

test("per-encoding nonce produces distinct authenticated ciphertext", () => {
  const first = codec({seed: 1}).encode(input());
  const second = codec({seed: 2}).encode(input());
  assert.notEqual(first, second);
  assert.deepEqual(codec({seed: 1}).decode(first, binding()).sortTuple, input().sortTuple);
  assert.deepEqual(codec({seed: 2}).decode(second, binding()).sortTuple, input().sortTuple);
});

test("opaque token visibly exposes none of its representative plaintext", () => {
  const token = codec().encode(input({
    source: "bitesaver-34461-inverness-paiges",
    sortTuple: ["Paige's Root Beer", "private-document-id-123"],
  }));
  for (const plaintext of [
    "34461",
    "inverness",
    "paiges",
    "Paige",
    "private-document-id-123",
    callerBinding,
    fingerprint,
  ]) {
    assert.equal(token.includes(plaintext), false, plaintext);
  }
  assert.match(token, /^bsp1\.[A-Za-z0-9_-]+$/);
});

test("wrong key, authentication tampering, and truncation fail closed", () => {
  const token = codec().encode(input());
  assert.throws(
    () => codec({keyValue: otherKey}).decode(token, binding()),
    OpaqueCursorError,
  );
  const replacement = token.endsWith("A") ? "B" : "A";
  assert.throws(
    () => codec().decode(`${token.slice(0, -1)}${replacement}`, binding()),
    OpaqueCursorError,
  );
  assert.throws(() => codec().decode(token.slice(0, -8), binding()), OpaqueCursorError);
});

test("query, source, mode, caller, page size, and purpose bindings fail closed", () => {
  const token = codec().encode(input());
  for (const changed of [
    {queryFingerprint: "c".repeat(64)},
    {source: "bitescore"},
    {searchMode: "city"},
    {callerBinding: "d".repeat(64)},
    {pageSize: 25},
    {purposes: ["backward"]},
  ]) {
    assert.throws(() => codec().decode(token, binding(changed)), OpaqueCursorError);
  }
});

test("expired and unreasonably future-issued cursors fail closed", () => {
  let now = issuedAtMs;
  const timeCodec = codec({clock: () => now});
  const token = timeCodec.encode(input({lifetimeMs: 1_000}));
  now = issuedAtMs + 999;
  assert.equal(timeCodec.decode(token, binding()).purpose, "forward");
  now = issuedAtMs + 1_000;
  assert.throws(() => timeCodec.decode(token, binding()), OpaqueCursorError);

  const future = encryptedToken(rawPayload({
    issuedAtMs: now + 60_001,
    expiresAtMs: now + 60_001 + 10_000,
  }));
  assert.throws(() => timeCodec.decode(future, binding()), OpaqueCursorError);
});

test("malformed base64url and token framing fail closed", () => {
  for (const token of [
    "",
    "bsp2.abc",
    "bsp1.",
    "bsp1.%%%%",
    "bsp1.ab=c",
    `bsp1.${Buffer.alloc(10).toString("base64url")}`,
  ]) {
    assert.throws(() => codec().decode(token, binding()), OpaqueCursorError);
  }
});

test("wrong protocol and unsupported payload field or type fail closed", () => {
  const wrongProtocol = encryptedToken(rawPayload({protocolVersion: "bitestar.page.v2"}));
  const extraField = encryptedToken(rawPayload({privateField: "must-not-pass"}));
  const unsupportedSortValue = encryptedToken(rawPayload({sortTuple: [{id: "x"}]}));
  for (const token of [wrongProtocol, extraField, unsupportedSortValue]) {
    assert.throws(() => codec().decode(token, binding()), OpaqueCursorError);
  }
});

test("key, nonce, page size, and lifetime inputs are strictly bounded", () => {
  for (const invalidKey of [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => new OpaqueCursorCodec({key: invalidKey}), OpaqueCursorError);
  }
  assert.throws(
    () => new OpaqueCursorCodec({key, nonceSource: () => Buffer.alloc(11)}).encode(input()),
    OpaqueCursorError,
  );
  assert.throws(() => codec().encode(input({pageSize: 1.5})), OpaqueCursorError);
  assert.throws(
    () => codec().encode(input({lifetimeMs: opaqueCursorDefaultLifetimeMs + 1})),
    OpaqueCursorError,
  );
});
