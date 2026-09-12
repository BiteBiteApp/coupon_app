"use strict";

const assert = require("node:assert/strict");
const {createCipheriv} = require("node:crypto");
const test = require("node:test");

const {
  CustomerBiteSaverContractError,
  customerBiteSaverAbsoluteExpiryMilliseconds,
  customerBiteSaverCursorLifetimeMilliseconds,
  customerBiteSaverMaximumIndexedOrderKeyBytes,
  customerBiteSaverPageSize,
  customerBiteSaverSearchProtocolVersion,
  requireCustomerBiteSaverCapability,
  requireCustomerBiteSaverPublicId,
  requireCustomerBiteSaverSessionId,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  CustomerBiteSaverCursorCodec,
  CustomerBiteSaverOfferOccurrenceCodec,
  customerBiteSaverCallerBinding,
  customerBiteSaverCallerCapabilityBinding,
  customerBiteSaverCapabilityForSession,
  customerBiteSaverCapabilityHash,
  customerBiteSaverConstantTimeHexEqual,
  customerBiteSaverCursorPrefix,
  customerBiteSaverDeterministicId,
  customerBiteSaverOfferOccurrencePrefix,
  customerBiteSaverRandomSessionId,
  decodeCustomerBiteSaverSecret,
} = require("../lib/customer_bitesaver_search_cursor.js");
const {
  dartUtf16FirestoreBytesCursorValue,
  dartUtf16FirestoreBytesOrderKey,
} = require("../lib/customer_bitesaver_search_matcher.js");
const {customerBiteSaverTimestampOrderKey} = require(
  "../lib/search_index_builders.js",
);

const issuedAtMs = Date.parse("2026-09-09T12:00:00.000Z");
const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 8);
const sessionId = `bss_${Buffer.alloc(32, 1).toString("base64url")}`;
const restaurantPublicId = `bsr_${Buffer.alloc(32, 2).toString("base64url")}`;
const queryFingerprint = "a".repeat(64);
const pageGenerationFingerprint = "b".repeat(64);
const callerCapabilityBinding = "c".repeat(64);
const guestStateFingerprint = "d".repeat(64);
const usageGeneration = "e".repeat(64);
const offerCatalogFingerprint = "0".repeat(64);
const offerPublicId = `bso_${Buffer.alloc(32, 4).toString("base64url")}`;

function nonce(seed) {
  return Uint8Array.from({length: 12}, (_, index) => (seed + index) % 256);
}

function codec({
  keyValue = key,
  now = () => issuedAtMs,
  nonceSeed = 1,
  nonceSource = () => nonce(nonceSeed),
} = {}) {
  return new CustomerBiteSaverCursorCodec({key: keyValue, now, nonceSource});
}

function cursorInput(overrides = {}) {
  return {
    purpose: "restaurantPage",
    sessionId,
    attemptGeneration: 3,
    queryFingerprint,
    pageGenerationFingerprint,
    callerCapabilityBinding,
    sortTuple: [false, 1.25, "0061006c007000680061", null],
    restaurantPublicId: null,
    matchingMode: null,
    availabilityAtMs: issuedAtMs,
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    guestStateFingerprint,
    usageGeneration,
    offerCatalogFingerprint: null,
    ...overrides,
  };
}

function cursorBinding(overrides = {}) {
  return {
    purpose: "restaurantPage",
    sessionId,
    attemptGeneration: 3,
    queryFingerprint,
    pageGenerationFingerprint,
    callerCapabilityBinding,
    restaurantPublicId: null,
    matchingMode: null,
    availabilityAtMs: issuedAtMs,
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    guestStateFingerprint,
    usageGeneration,
    offerCatalogFingerprint: null,
    ...overrides,
  };
}

function offerOccurrenceInput(overrides = {}) {
  return {
    pagePurpose: "offerPage",
    sessionId,
    attemptGeneration: 3,
    queryFingerprint,
    pageGenerationFingerprint,
    callerCapabilityBinding,
    restaurantPublicId,
    offerPublicId,
    authoritativeAccountId: "private-account-id-canary",
    offerType: "coupon",
    sourceDocumentId: "private-offer-id-canary",
    indexDocumentId: "private-index-id-canary",
    sourceCreatedAtMs: issuedAtMs - 1_000,
    sourceCreatedAtOrderKey: customerBiteSaverTimestampOrderKey(
      new Date(issuedAtMs - 1_000),
    ),
    sourceFingerprint: "f".repeat(64),
    matchingMode: "offer",
    availabilityAtMs: issuedAtMs,
    guestStateFingerprint,
    usageGeneration,
    offerCatalogFingerprint,
    expiresAtMs: issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
    ...overrides,
  };
}

function offerOccurrenceBinding(overrides = {}) {
  const input = offerOccurrenceInput();
  return {
    pagePurpose: input.pagePurpose,
    sessionId: input.sessionId,
    attemptGeneration: input.attemptGeneration,
    queryFingerprint: input.queryFingerprint,
    pageGenerationFingerprint: input.pageGenerationFingerprint,
    callerCapabilityBinding: input.callerCapabilityBinding,
    restaurantPublicId: input.restaurantPublicId,
    offerPublicId: input.offerPublicId,
    matchingMode: input.matchingMode,
    availabilityAtMs: input.availabilityAtMs,
    guestStateFingerprint: input.guestStateFingerprint,
    usageGeneration: input.usageGeneration,
    offerCatalogFingerprint: input.offerCatalogFingerprint,
    ...overrides,
  };
}

function occurrenceCodec({keyValue = key, now = () => issuedAtMs} = {}) {
  return new CustomerBiteSaverOfferOccurrenceCodec({key: keyValue, now});
}

function assertInvalidOccurrence(callback) {
  assert.throws(
    callback,
    (error) =>
      error instanceof CustomerBiteSaverContractError &&
      error.code === "invalid-argument" &&
      error.message ===
        "The BiteSaver offer occurrence is invalid or expired.",
  );
}

function assertInvalidCursor(callback) {
  assert.throws(
    callback,
    (error) =>
      error instanceof CustomerBiteSaverContractError &&
      error.code === "invalid-argument" &&
      error.message === "The BiteSaver page cursor is invalid or expired.",
  );
}

function encryptedToken(payload, keyValue = key, nonceValue = nonce(77)) {
  const cipher = createCipheriv("aes-256-gcm", keyValue, nonceValue);
  cipher.setAAD(Buffer.from(customerBiteSaverCursorPrefix, "ascii"));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return customerBiteSaverCursorPrefix + Buffer.concat([
    Buffer.from(nonceValue),
    cipher.getAuthTag(),
    encrypted,
  ]).toString("base64url");
}

function rawPayload(overrides = {}) {
  return {
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "restaurantPage",
    sessionId,
    attemptGeneration: 3,
    queryFingerprint,
    pageGenerationFingerprint,
    callerCapabilityBinding,
    pageSize: customerBiteSaverPageSize,
    sortTuple: ["order-key", 1],
    restaurantPublicId: null,
    matchingMode: null,
    availabilityAtMs: issuedAtMs,
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    guestStateFingerprint,
    usageGeneration,
    offerCatalogFingerprint: null,
    issuedAtMs,
    expiresAtMs: issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
    ...overrides,
  };
}

function cursorNonce(token) {
  const packed = Buffer.from(
    token.slice(customerBiteSaverCursorPrefix.length),
    "base64url",
  );
  return packed.subarray(0, 12);
}

test("caller, capability, and deterministic IDs use distinct bound domains", () => {
  const guest = customerBiteSaverCallerBinding(key, {
    scope: "guest",
    clientInstanceId: "client-instance-0001",
  });
  const signed = customerBiteSaverCallerBinding(key, {
    scope: "authenticated",
    uid: "user-private-id",
    clientInstanceId: "client-instance-0001",
  });
  assert.match(guest, /^[0-9a-f]{64}$/u);
  assert.notEqual(guest, signed);
  assert.notEqual(
    signed,
    customerBiteSaverCallerBinding(key, {
      scope: "authenticated",
      uid: "other-user",
      clientInstanceId: "client-instance-0001",
    }),
  );

  const capability = customerBiteSaverCapabilityForSession(key, sessionId, guest);
  assert.equal(requireCustomerBiteSaverCapability(capability), capability);
  assert.notEqual(
    capability,
    customerBiteSaverCapabilityForSession(key, `${sessionId}x`, guest),
  );
  const capabilityHash = customerBiteSaverCapabilityHash(key, capability);
  const combined = customerBiteSaverCallerCapabilityBinding(
    key,
    guest,
    capabilityHash,
  );
  assert.match(capabilityHash, /^[0-9a-f]{64}$/u);
  assert.match(combined, /^[0-9a-f]{64}$/u);
  assert.notEqual(capabilityHash, combined);

  const deterministic = customerBiteSaverDeterministicId(
    key,
    "job",
    "workOccurrence",
    [sessionId, "3", "restaurantRanges"],
  );
  assert.equal(
    deterministic,
    customerBiteSaverDeterministicId(
      key,
      "job",
      "workOccurrence",
      [sessionId, "3", "restaurantRanges"],
    ),
  );
  assert.notEqual(
    deterministic,
    customerBiteSaverDeterministicId(
      key,
      "job",
      "differentDomain",
      [sessionId, "3", "restaurantRanges"],
    ),
  );
});

test("secret and identifier validators reject malformed encodings", () => {
  const encodedKey = key.toString("base64url");
  assert.deepEqual(Buffer.from(decodeCustomerBiteSaverSecret(encodedKey)), key);
  assert.equal(requireCustomerBiteSaverSessionId(sessionId), sessionId);
  for (const value of [undefined, null, "", "a".repeat(43), `${encodedKey}=`, 1]) {
    assert.throws(
      () => decodeCustomerBiteSaverSecret(value),
      (error) =>
        error instanceof CustomerBiteSaverContractError &&
        error.code === "failed-precondition",
    );
  }
  assert.throws(
    () => requireCustomerBiteSaverSessionId("bss_short"),
    (error) => error.code === "not-found",
  );
  assert.throws(
    () => requireCustomerBiteSaverPublicId(restaurantPublicId, "bso"),
    (error) => error.code === "invalid-argument",
  );
});

test("random session IDs consume exactly 32 bytes of validated entropy", () => {
  let requestedSize = null;
  const generated = customerBiteSaverRandomSessionId((size) => {
    requestedSize = size;
    return Buffer.alloc(size, 9);
  });
  assert.equal(requestedSize, 32);
  assert.equal(generated, `bss_${Buffer.alloc(32, 9).toString("base64url")}`);
  assert.equal(requireCustomerBiteSaverSessionId(generated), generated);
  for (const entropy of [Buffer.alloc(31), Buffer.alloc(33), "not-bytes"]) {
    assert.throws(() => customerBiteSaverRandomSessionId(() => entropy));
  }
});

test("constant-time hex comparison validates shape before comparing", () => {
  assert.equal(customerBiteSaverConstantTimeHexEqual("a".repeat(64), "a".repeat(64)), true);
  assert.equal(customerBiteSaverConstantTimeHexEqual("a".repeat(64), "b".repeat(64)), false);
  assert.equal(customerBiteSaverConstantTimeHexEqual("A".repeat(64), "a".repeat(64)), false);
  assert.equal(customerBiteSaverConstantTimeHexEqual("a".repeat(63), "a".repeat(63)), false);
});

test("AES-GCM cursor round trips the full bound payload without plaintext leakage", () => {
  const encoded = codec().encode(cursorInput());
  const decoded = codec().decode(encoded, cursorBinding());
  assert.equal(encoded.startsWith(customerBiteSaverCursorPrefix), true);
  assert.equal(encoded.includes(sessionId), false);
  assert.equal(encoded.includes(queryFingerprint), false);
  assert.deepEqual(decoded, {
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    ...cursorInput(),
    pageSize: customerBiteSaverPageSize,
    issuedAtMs,
    expiresAtMs: issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
  });
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.sortTuple), true);
  assert.deepEqual(codec().decode(encoded, cursorBinding()), decoded);
});

test("restaurant cursors round trip a maximum binary account-order boundary", () => {
  const accountId = "a".repeat(customerBiteSaverMaximumIndexedOrderKeyBytes);
  const orderKey = dartUtf16FirestoreBytesOrderKey(accountId);
  const cursorValue = dartUtf16FirestoreBytesCursorValue(
    orderKey,
    customerBiteSaverMaximumIndexedOrderKeyBytes,
  );
  assert.equal(orderKey.byteLength, customerBiteSaverMaximumIndexedOrderKeyBytes);
  assert.equal(cursorValue.length, 2_000);
  const input = cursorInput({
    sortTuple: [1, 12.5, "006100", cursorValue],
  });
  const encoded = codec().encode(input);
  assert.deepEqual(codec().decode(encoded, cursorBinding()).sortTuple, input.sortTuple);

  const tamperIndex = customerBiteSaverCursorPrefix.length + 40;
  const tampered = encoded.slice(0, tamperIndex) +
    (encoded[tamperIndex] === "A" ? "B" : "A") +
    encoded.slice(tamperIndex + 1);
  assertInvalidCursor(() => codec().decode(tampered, cursorBinding()));
  assertInvalidCursor(() => codec().encode(cursorInput({
    sortTuple: [1, 12.5, "006100", `${cursorValue}A`],
  })));
  assertInvalidCursor(() => codec().encode(cursorInput({
    sortTuple: [1, 12.5, "006100", Buffer.from([0xff]).toString("base64url")],
  })));
});

test("per-encoding nonces produce distinct authenticated cursors", () => {
  const first = codec({nonceSeed: 1}).encode(cursorInput());
  const second = codec({nonceSeed: 2}).encode(cursorInput());
  assert.notEqual(first, second);
  assert.deepEqual(codec({nonceSeed: 1}).decode(first, cursorBinding()).sortTuple, cursorInput().sortTuple);
  assert.deepEqual(codec({nonceSeed: 2}).decode(second, cursorBinding()).sortTuple, cursorInput().sortTuple);
});

test("deterministic authenticated cursor nonces are stable and payload-bound", () => {
  const deterministic = new CustomerBiteSaverCursorCodec({
    key,
    now: () => issuedAtMs,
    nonceMode: "deterministicAuthenticated",
  });
  const first = deterministic.encode(cursorInput());
  const retry = deterministic.encode(cursorInput());
  const changedPayload = deterministic.encode(cursorInput({
    sortTuple: [false, 1.25, "0062006500740061", null],
  }));
  const changedKey = new CustomerBiteSaverCursorCodec({
    key: otherKey,
    now: () => issuedAtMs,
    nonceMode: "deterministicAuthenticated",
  }).encode(cursorInput());

  assert.equal(first, retry);
  assert.deepEqual(cursorNonce(first), cursorNonce(retry));
  assert.notDeepEqual(cursorNonce(first), cursorNonce(changedPayload));
  assert.notDeepEqual(cursorNonce(first), cursorNonce(changedKey));
  assert.deepEqual(
    deterministic.decode(first, cursorBinding()).sortTuple,
    cursorInput().sortTuple,
  );
  assert.deepEqual(
    codec().decode(first, cursorBinding()).sortTuple,
    cursorInput().sortTuple,
  );
  assertInvalidCursor(() => deterministic.decode(
    codec({nonceSeed: 11}).encode(cursorInput()),
    cursorBinding(),
  ));
});

test("cursor tampering, wrong keys, and malformed envelopes fail closed", () => {
  const encoded = codec().encode(cursorInput());
  const tamperIndex = customerBiteSaverCursorPrefix.length + 20;
  const tampered = encoded.slice(0, tamperIndex) +
    (encoded[tamperIndex] === "A" ? "B" : "A") +
    encoded.slice(tamperIndex + 1);
  assertInvalidCursor(() => codec().decode(tampered, cursorBinding()));
  assertInvalidCursor(() => codec({keyValue: otherKey}).decode(encoded, cursorBinding()));
  for (const token of [
    null,
    "",
    "wrong-prefix",
    `${customerBiteSaverCursorPrefix}!`,
    `${customerBiteSaverCursorPrefix}AA`,
    `${customerBiteSaverCursorPrefix}${"A".repeat(32_769)}`,
  ]) {
    assertInvalidCursor(() => codec().decode(token, cursorBinding()));
  }
});

test("cursor binding prevents replay across purpose, session, attempt, and caller", () => {
  const encoded = codec().encode(cursorInput());
  for (const binding of [
    cursorBinding({purpose: "offerPage"}),
    cursorBinding({sessionId: `bss_${Buffer.alloc(32, 3).toString("base64url")}`}),
    cursorBinding({attemptGeneration: 4}),
    cursorBinding({queryFingerprint: "f".repeat(64)}),
    cursorBinding({callerCapabilityBinding: "0".repeat(64)}),
    cursorBinding({guestStateFingerprint: "1".repeat(64)}),
    cursorBinding({offerCatalogFingerprint: "1".repeat(64)}),
    cursorBinding({restaurantPublicId}),
    cursorBinding({matchingMode: "offer"}),
  ]) {
    assertInvalidCursor(() => codec().decode(encoded, binding));
  }
});

test("cursor binding prevents replay across visible-page generation state", () => {
  const encoded = codec().encode(cursorInput());
  for (const binding of [
    cursorBinding({pageGenerationFingerprint: "0".repeat(64)}),
    cursorBinding({availabilityAtMs: issuedAtMs + 1}),
    cursorBinding({timeZone: "America/Chicago"}),
    cursorBinding({utcOffsetMinutes: -300}),
    cursorBinding({usageGeneration: "1".repeat(64)}),
  ]) {
    assertInvalidCursor(() => codec().decode(encoded, binding));
  }
});

test("offer cursor accepts only the exact restaurant and matching-purpose binding", () => {
  const offerInput = cursorInput({
    purpose: "offerPage",
    restaurantPublicId,
    matchingMode: "offer",
    offerCatalogFingerprint,
  });
  const offerBinding = cursorBinding({
    purpose: "offerPage",
    restaurantPublicId,
    matchingMode: "offer",
    offerCatalogFingerprint,
  });
  const encoded = codec().encode(offerInput);
  assert.equal(codec().decode(encoded, offerBinding).purpose, "offerPage");
  assertInvalidCursor(() =>
    codec().decode(encoded, {...offerBinding, matchingMode: "parent"}));
  assertInvalidCursor(() =>
    codec().decode(encoded, {...offerBinding, restaurantPublicId: null}));
});

test("cursor expiry is enforced at the exact boundary", () => {
  const encoded = codec().encode(cursorInput());
  assert.equal(
    codec({
      now: () => issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds - 1,
    }).decode(encoded, cursorBinding()).expiresAtMs,
    issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
  );
  assertInvalidCursor(() =>
    codec({
      now: () => issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
    }).decode(encoded, cursorBinding()));

  const short = codec().encode(cursorInput({lifetimeMilliseconds: 1_000}));
  assertInvalidCursor(() =>
    codec({now: () => issuedAtMs + 1_000}).decode(short, cursorBinding()));
});

test("authenticated cursor inspection may locate an expired server checkpoint", () => {
  const encoded = codec().encode(cursorInput());
  const expiredCodec = codec({
    now: () => issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
  });
  assertInvalidCursor(() => expiredCodec.open(encoded));
  const inspected = expiredCodec.open(encoded, {allowExpired: true});
  assert.equal(inspected.sessionId, sessionId);
  assert.equal(
    inspected.expiresAtMs,
    issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
  );
  assertInvalidCursor(() => expiredCodec.decode(encoded, cursorBinding()));

  const tamperIndex = customerBiteSaverCursorPrefix.length + 20;
  const tampered = encoded.slice(0, tamperIndex) +
    (encoded[tamperIndex] === "A" ? "B" : "A") +
    encoded.slice(tamperIndex + 1);
  assertInvalidCursor(() =>
    expiredCodec.open(tampered, {allowExpired: true}));
  assertInvalidCursor(() =>
    codec({
      keyValue: otherKey,
      now: () => issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
    }).open(encoded, {allowExpired: true}));
});

test("cursor payload is closed, bounded, and structurally validated", () => {
  for (const payload of [
    {...rawPayload(), unexpected: true},
    rawPayload({protocolVersion: "wrong"}),
    rawPayload({pageSize: 24}),
    rawPayload({sortTuple: []}),
    rawPayload({sortTuple: Array(9).fill("x")}),
    rawPayload({sortTuple: ["x".repeat(1_501)]}),
    rawPayload({sortTuple: ["\ud800"]}),
    rawPayload({issuedAtMs: -1}),
    rawPayload({expiresAtMs: issuedAtMs}),
    rawPayload({
      expiresAtMs: issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds + 1,
    }),
  ]) {
    assertInvalidCursor(() =>
      codec().decode(encryptedToken(payload), cursorBinding()));
  }
  assertInvalidCursor(() => codec().encode(cursorInput({sortTuple: [NaN]})));
  for (const lifetimeMilliseconds of [0, -1, 1.5, customerBiteSaverCursorLifetimeMilliseconds + 1]) {
    assertInvalidCursor(() => codec().encode(cursorInput({lifetimeMilliseconds})));
  }
  assertInvalidCursor(() =>
    codec({nonceSource: () => Buffer.alloc(11)}).encode(cursorInput()));
  assert.throws(
    () => new CustomerBiteSaverCursorCodec({
      key,
      nonceMode: "deterministicAuthenticated",
      nonceSource: () => Buffer.alloc(12),
    }),
    (error) => error.code === "failed-precondition",
  );
  assert.throws(
    () => new CustomerBiteSaverCursorCodec({key, nonceMode: "unsupported"}),
    (error) => error.code === "failed-precondition",
  );
  assert.throws(
    () => new CustomerBiteSaverCursorCodec({key: Buffer.alloc(31)}),
    (error) => error.code === "failed-precondition",
  );
});

test("offer occurrences are deterministic, authenticated, and non-leaking", () => {
  const token = occurrenceCodec().encode(offerOccurrenceInput());
  const retry = occurrenceCodec().encode(offerOccurrenceInput());
  const decoded = occurrenceCodec().decode(
    token,
    offerOccurrenceBinding(),
  );
  assert.equal(token, retry);
  assert.match(token, /^bsoc1\.[A-Za-z0-9_-]+$/u);
  assert.equal(token.includes("private-account-id-canary"), false);
  assert.equal(token.includes("private-offer-id-canary"), false);
  assert.equal(token.includes(sessionId), false);
  assert.deepEqual(decoded, {
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "redemptionOfferOccurrence",
    ...offerOccurrenceInput(),
    issuedAtMs,
  });
});

test("offer occurrence tampering and cross-context replay fail closed", () => {
  const token = occurrenceCodec().encode(offerOccurrenceInput());
  const tamperIndex = customerBiteSaverOfferOccurrencePrefix.length + 20;
  const tampered = token.slice(0, tamperIndex) +
    (token[tamperIndex] === "A" ? "B" : "A") +
    token.slice(tamperIndex + 1);
  assertInvalidOccurrence(() => occurrenceCodec().open(tampered));
  assertInvalidOccurrence(() => occurrenceCodec({keyValue: otherKey}).open(token));
  for (const binding of [
    offerOccurrenceBinding({sessionId:
      `bss_${Buffer.alloc(32, 5).toString("base64url")}`}),
    offerOccurrenceBinding({attemptGeneration: 4}),
    offerOccurrenceBinding({queryFingerprint: "0".repeat(64)}),
    offerOccurrenceBinding({pageGenerationFingerprint: "1".repeat(64)}),
    offerOccurrenceBinding({callerCapabilityBinding: "2".repeat(64)}),
    offerOccurrenceBinding({restaurantPublicId:
      `bsr_${Buffer.alloc(32, 6).toString("base64url")}`}),
    offerOccurrenceBinding({offerPublicId:
      `bso_${Buffer.alloc(32, 7).toString("base64url")}`}),
    offerOccurrenceBinding({matchingMode: "parent"}),
    offerOccurrenceBinding({usageGeneration: "3".repeat(64)}),
    offerOccurrenceBinding({offerCatalogFingerprint: "4".repeat(64)}),
  ]) {
    assertInvalidOccurrence(() => occurrenceCodec().decode(token, binding));
  }
});

test("offer occurrences enforce expiry and closed structural inputs", () => {
  const token = occurrenceCodec().encode(offerOccurrenceInput());
  assertInvalidOccurrence(() => occurrenceCodec({
    now: () => issuedAtMs + customerBiteSaverCursorLifetimeMilliseconds,
  }).open(token));
  for (const invalid of [
    offerOccurrenceInput({sourceDocumentId: "contains/slash"}),
    offerOccurrenceInput({sourceDocumentId: "\ud800"}),
    offerOccurrenceInput({sourceFingerprint: "x".repeat(64)}),
    offerOccurrenceInput({matchingMode: null}),
    offerOccurrenceInput({pagePurpose: "restaurantPage"}),
    offerOccurrenceInput({expiresAtMs: issuedAtMs}),
    offerOccurrenceInput({
      expiresAtMs:
        issuedAtMs + customerBiteSaverAbsoluteExpiryMilliseconds + 1,
    }),
  ]) {
    assertInvalidOccurrence(() => occurrenceCodec().encode(invalid));
  }
  assert.throws(
    () => new CustomerBiteSaverOfferOccurrenceCodec({key: Buffer.alloc(31)}),
    (error) => error.code === "failed-precondition",
  );
});
