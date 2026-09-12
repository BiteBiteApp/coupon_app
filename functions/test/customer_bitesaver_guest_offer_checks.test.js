"use strict";

const assert = require("node:assert/strict");
const {createCipheriv, createHmac} = require("node:crypto");
const test = require("node:test");

const {
  customerBiteSaverGuestCheckLifetimeMilliseconds,
  customerBiteSaverGuestCheckMaximumCandidateIds,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  CustomerBiteSaverContractError,
  privateCustomerBiteSaverGuestOfferCheckCollection,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  assertCustomerBiteSaverGuestOfferCheckContinuationMatchesToken,
  createCustomerBiteSaverGuestOfferCheckCandidateDigest,
  createCustomerBiteSaverGuestOfferCheckOperationRef,
  customerBiteSaverGuestOfferCheckDocumentId,
  CustomerBiteSaverGuestOfferCheckCodec,
  customerBiteSaverGuestOfferCheckOperationRefPrefix,
  customerBiteSaverGuestOfferCheckTokenMaximumBytes,
  customerBiteSaverGuestOfferCheckTokenPrefix,
  parseCustomerBiteSaverGuestOfferCheckContinuationRequest,
} = require("../lib/customer_bitesaver_guest_offer_checks.js");

const issuedAtMillis = Date.parse("2026-09-10T12:00:00.000Z");
const evaluationAtMillis = issuedAtMillis - 1_000;
const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 8);
const sessionId = `bss_${Buffer.alloc(32, 1).toString("base64url")}`;
const otherSessionId = `bss_${Buffer.alloc(32, 2).toString("base64url")}`;
const restaurantPublicId =
  `bsr_${Buffer.alloc(32, 3).toString("base64url")}`;
const capability = Buffer.alloc(32, 4).toString("base64url");
const criteriaFingerprint = "a".repeat(64);
const queryFingerprint = "b".repeat(64);
const callerCapabilityBinding = "c".repeat(64);
const operationFingerprint = "d".repeat(64);
const consumedBoundaryFingerprint = "e".repeat(64);
const availabilityGeneration = "f".repeat(64);

function opaqueId(prefix, index) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(index, 28);
  return `${prefix}_${bytes.toString("base64url")}`;
}

const offerIds = Object.freeze([
  opaqueId("bso", 1),
  opaqueId("bso", 2),
  opaqueId("bso", 3),
]);

function operationIdentity(overrides = {}) {
  return {
    operationPurpose: "restaurantPage",
    sessionId,
    attemptGeneration: 3,
    criteriaFingerprint,
    queryFingerprint,
    callerCapabilityBinding,
    operationFingerprint,
    restaurantPublicId: null,
    ...overrides,
  };
}

const operationRef = createCustomerBiteSaverGuestOfferCheckOperationRef(
  key,
  operationIdentity(),
);

function tokenInput(overrides = {}) {
  return {
    operationPurpose: "restaurantPage",
    operationRef,
    sessionId,
    attemptGeneration: 3,
    criteriaFingerprint,
    queryFingerprint,
    callerCapabilityBinding,
    operationFingerprint,
    restaurantPublicId: null,
    consumedBoundaryFingerprint,
    batchSequence: 0,
    candidateOfferIds: offerIds,
    availabilityGeneration,
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    guestStateRevision: 9,
    evaluationAtMillis,
    expiresAtMillis:
      issuedAtMillis + customerBiteSaverGuestCheckLifetimeMilliseconds,
    ...overrides,
  };
}

function tokenBinding(overrides = {}) {
  const input = tokenInput();
  return {
    ...input,
    candidateDigest:
      createCustomerBiteSaverGuestOfferCheckCandidateDigest(
        input.candidateOfferIds,
      ),
    issuedAtMillis,
    ...overrides,
  };
}

function nonce(seed) {
  return Uint8Array.from(
    {length: 12},
    (_, index) => (seed + index) % 256,
  );
}

function codec({
  keyValue = key,
  now = () => issuedAtMillis,
  nonceSeed = 11,
  nonceSource = () => nonce(nonceSeed),
} = {}) {
  return new CustomerBiteSaverGuestOfferCheckCodec({
    key: keyValue,
    now,
    nonceSource,
  });
}

function continuationRequest(overrides = {}) {
  const checkToken = codec().encode(tokenInput());
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: "guest-answer-request-0001",
    clientInstanceId: "guest-client-instance-0001",
    sessionId,
    capability,
    criteriaFingerprint,
    operationRef,
    checkToken,
    batchSequence: 0,
    guestStateRevision: 9,
    entireBatchEvaluated: true,
    unavailableOfferIds: [offerIds[1]],
    ...overrides,
  };
}

function assertInvalidRequest(callback) {
  assert.throws(
    callback,
    (error) =>
      error instanceof CustomerBiteSaverContractError &&
      error.code === "invalid-argument",
  );
}

function assertInvalidToken(callback) {
  assert.throws(
    callback,
    (error) =>
      error instanceof CustomerBiteSaverContractError &&
      error.code === "invalid-argument" &&
      error.message ===
        "The BiteSaver guest offer check token is invalid or expired.",
  );
}

function guestOfferCheckHmac(keyValue, domain, values = []) {
  const hmac = createHmac("sha256", keyValue);
  hmac.update(customerBiteSaverSearchProtocolVersion, "utf8");
  hmac.update("\0guestOfferCheck\0", "utf8");
  hmac.update(domain, "utf8");
  for (const value of values) {
    hmac.update("\0", "utf8");
    hmac.update(String(value.length), "ascii");
    hmac.update(":", "ascii");
    hmac.update(value, "utf16le");
  }
  return hmac.digest();
}

function rawPayload(overrides = {}) {
  return {
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "guestOfferCheck",
    ...tokenBinding(),
    ...overrides,
  };
}

function encryptRawPayload(payload, {
  keyValue = key,
  nonceValue = nonce(81),
} = {}) {
  const encryptionKey = guestOfferCheckHmac(
    keyValue,
    "tokenEncryptionKey",
  );
  const aad = Buffer.from(
    `${customerBiteSaverSearchProtocolVersion}\0guestOfferCheckToken\0` +
      customerBiteSaverGuestOfferCheckTokenPrefix,
    "utf8",
  );
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonceValue);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return customerBiteSaverGuestOfferCheckTokenPrefix + Buffer.concat([
    Buffer.from(nonceValue),
    cipher.getAuthTag(),
    encrypted,
  ]).toString("base64url");
}

test("guest check contract exports the exact bounded collection constants", () => {
  assert.equal(
    privateCustomerBiteSaverGuestOfferCheckCollection,
    "private_bitesaver_guest_offer_checks",
  );
  assert.equal(customerBiteSaverGuestCheckMaximumCandidateIds, 75);
  assert.equal(customerBiteSaverGuestCheckLifetimeMilliseconds, 300_000);
  assert.equal(customerBiteSaverGuestOfferCheckTokenMaximumBytes, 32_768);
});

test("continuation parser accepts and freezes only the exact complete shape", () => {
  const parsed = parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
    continuationRequest(),
  );
  assert.deepEqual(parsed, continuationRequest());
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.unavailableOfferIds), true);

  const {checkToken: _omitted, ...missing} = continuationRequest();
  void _omitted;
  for (const invalid of [
    null,
    [],
    missing,
    {...continuationRequest(), extra: true},
    {...continuationRequest(), schemaVersion: 2},
    {...continuationRequest(), entireBatchEvaluated: false},
    {...continuationRequest(), clientRequestId: "short"},
    {...continuationRequest(), clientInstanceId: " contains-spaces "},
    {...continuationRequest(), criteriaFingerprint: "A".repeat(64)},
    {...continuationRequest(), operationRef: "private-record-id"},
    {...continuationRequest(), checkToken: "bsc1.AAAA"},
    {...continuationRequest(), batchSequence: -1},
    {...continuationRequest(), batchSequence: 1.5},
    {...continuationRequest(), guestStateRevision: -1},
    {...continuationRequest(), guestStateRevision: 1.5},
    {
      ...continuationRequest(),
      guestStateRevision: Number.MAX_SAFE_INTEGER + 1,
    },
  ]) {
    assertInvalidRequest(() =>
      parseCustomerBiteSaverGuestOfferCheckContinuationRequest(invalid));
  }
});

test("continuation parser bounds unique opaque unavailable offer IDs", () => {
  const seventyFive = Array.from(
    {length: customerBiteSaverGuestCheckMaximumCandidateIds},
    (_, index) => opaqueId("bso", index + 100),
  );
  assert.equal(
    parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
      continuationRequest({unavailableOfferIds: []}),
    ).unavailableOfferIds.length,
    0,
  );
  assert.equal(
    parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
      continuationRequest({unavailableOfferIds: seventyFive}),
    ).unavailableOfferIds.length,
    75,
  );
  for (const unavailableOfferIds of [
    [...seventyFive, opaqueId("bso", 999)],
    [offerIds[0], offerIds[0]],
    ["private-coupon-document-id"],
    [opaqueId("bsr", 1)],
    ["bso_" + "!".repeat(43)],
  ]) {
    assertInvalidRequest(() =>
      parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
        continuationRequest({unavailableOfferIds}),
      ));
  }
});

test("ordered candidate digest is stable, order-sensitive, and closed", () => {
  const digest = createCustomerBiteSaverGuestOfferCheckCandidateDigest(offerIds);
  assert.match(digest, /^[0-9a-f]{64}$/u);
  assert.equal(
    digest,
    createCustomerBiteSaverGuestOfferCheckCandidateDigest([...offerIds]),
  );
  assert.notEqual(
    digest,
    createCustomerBiteSaverGuestOfferCheckCandidateDigest([
      offerIds[1],
      offerIds[0],
      offerIds[2],
    ]),
  );
  assert.notEqual(
    digest,
    createCustomerBiteSaverGuestOfferCheckCandidateDigest([
      offerIds[0],
      offerIds[1],
      opaqueId("bso", 44),
    ]),
  );
  for (const invalid of [
    [],
    [offerIds[0], offerIds[0]],
    ["internal-offer-id"],
    Array.from({length: 76}, (_, index) => opaqueId("bso", index + 500)),
  ]) {
    assertInvalidRequest(() =>
      createCustomerBiteSaverGuestOfferCheckCandidateDigest(invalid));
  }
});

test("operation reference is deterministic, opaque, request-bound, and the document ID", () => {
  const repeat = createCustomerBiteSaverGuestOfferCheckOperationRef(
    key,
    operationIdentity(),
  );
  assert.equal(operationRef, repeat);
  assert.match(operationRef, /^bsgc_[A-Za-z0-9_-]{43}$/u);
  assert.equal(
    operationRef.startsWith(customerBiteSaverGuestOfferCheckOperationRefPrefix),
    true,
  );
  assert.equal(customerBiteSaverGuestOfferCheckDocumentId(operationRef), operationRef);
  assert.equal(operationRef.includes(sessionId), false);
  assert.equal(operationRef.includes(operationFingerprint), false);

  const offerPageRef = createCustomerBiteSaverGuestOfferCheckOperationRef(
    key,
    operationIdentity({
      operationPurpose: "offerPage",
      restaurantPublicId,
    }),
  );
  for (const changed of [
    createCustomerBiteSaverGuestOfferCheckOperationRef(
      otherKey,
      operationIdentity(),
    ),
    createCustomerBiteSaverGuestOfferCheckOperationRef(
      key,
      operationIdentity({attemptGeneration: 4}),
    ),
    createCustomerBiteSaverGuestOfferCheckOperationRef(
      key,
      operationIdentity({operationFingerprint: "0".repeat(64)}),
    ),
    offerPageRef,
  ]) {
    assert.notEqual(changed, operationRef);
  }
  assertInvalidRequest(() =>
    createCustomerBiteSaverGuestOfferCheckOperationRef(
      key,
      operationIdentity({operationPurpose: "offerPage"}),
    ));
  assert.throws(
    () => createCustomerBiteSaverGuestOfferCheckOperationRef(
      Buffer.alloc(31),
      operationIdentity(),
    ),
    (error) => error.code === "failed-precondition",
  );
});

test("guest check token round trips all bindings without plaintext leakage", () => {
  const token = codec().encode(tokenInput());
  const decoded = codec().decode(token, tokenBinding());
  assert.match(token, /^bsgc1\.[A-Za-z0-9_-]+$/u);
  assert.equal(Buffer.byteLength(token, "utf8") <= 32_768, true);
  assert.equal(token.includes(sessionId), false);
  assert.equal(token.includes(offerIds[0]), false);
  assert.deepEqual(decoded, {
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "guestOfferCheck",
    ...tokenBinding(),
  });
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.candidateOfferIds), true);
});

test("guest check token uses fresh injectable nonces while operation identity stays stable", () => {
  const first = codec({nonceSeed: 21}).encode(tokenInput());
  const second = codec({nonceSeed: 22}).encode(tokenInput());
  assert.notEqual(first, second);
  assert.deepEqual(codec().decode(first, tokenBinding()), tokenBinding({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "guestOfferCheck",
  }));
  assert.deepEqual(codec().decode(second, tokenBinding()), codec().open(first));
  assertInvalidToken(() => codec({nonceSource: () => Buffer.alloc(11)}).encode(
    tokenInput(),
  ));
});

test("token rejects tampering, key changes, cursor substitution, and oversized envelopes", () => {
  const token = codec().encode(tokenInput());
  const tamperIndex = customerBiteSaverGuestOfferCheckTokenPrefix.length + 20;
  const tampered = token.slice(0, tamperIndex) +
    (token[tamperIndex] === "A" ? "B" : "A") +
    token.slice(tamperIndex + 1);
  for (const invalid of [
    tampered,
    "",
    null,
    "bsc1." + token.slice(customerBiteSaverGuestOfferCheckTokenPrefix.length),
    "bsoc1." + token.slice(customerBiteSaverGuestOfferCheckTokenPrefix.length),
    `${customerBiteSaverGuestOfferCheckTokenPrefix}!`,
    customerBiteSaverGuestOfferCheckTokenPrefix +
      "A".repeat(customerBiteSaverGuestOfferCheckTokenMaximumBytes),
  ]) {
    assertInvalidToken(() => codec().open(invalid));
  }
  assertInvalidToken(() => codec({keyValue: otherKey}).open(token));
  assertInvalidToken(() => codec().open(tampered, {allowExpired: true}));
  assertInvalidToken(() => codec({keyValue: otherKey}).open(
    token,
    {allowExpired: true},
  ));
  assert.throws(
    () => new CustomerBiteSaverGuestOfferCheckCodec({key: Buffer.alloc(31)}),
    (error) => error.code === "failed-precondition",
  );
});

test("decode rejects every independently substituted operation binding", () => {
  const token = codec().encode(tokenInput());
  const swappedCandidates = [offerIds[1], offerIds[0], offerIds[2]];
  const otherOperationRef = createCustomerBiteSaverGuestOfferCheckOperationRef(
    key,
    operationIdentity({operationFingerprint: "0".repeat(64)}),
  );
  const changedBindings = [
    tokenBinding({operationPurpose: "offerPage", restaurantPublicId}),
    tokenBinding({operationRef: otherOperationRef}),
    tokenBinding({sessionId: otherSessionId}),
    tokenBinding({attemptGeneration: 4}),
    tokenBinding({criteriaFingerprint: "0".repeat(64)}),
    tokenBinding({queryFingerprint: "1".repeat(64)}),
    tokenBinding({callerCapabilityBinding: "2".repeat(64)}),
    tokenBinding({operationFingerprint: "3".repeat(64)}),
    tokenBinding({consumedBoundaryFingerprint: "4".repeat(64)}),
    tokenBinding({batchSequence: 1}),
    tokenBinding({
      candidateOfferIds: swappedCandidates,
      candidateDigest:
        createCustomerBiteSaverGuestOfferCheckCandidateDigest(swappedCandidates),
    }),
    tokenBinding({candidateDigest: "5".repeat(64)}),
    tokenBinding({availabilityGeneration: "6".repeat(64)}),
    tokenBinding({timeZone: "America/Chicago"}),
    tokenBinding({utcOffsetMinutes: -300}),
    tokenBinding({guestStateRevision: 10}),
    tokenBinding({evaluationAtMillis: evaluationAtMillis - 1}),
    tokenBinding({issuedAtMillis: issuedAtMillis - 1}),
    tokenBinding({expiresAtMillis: issuedAtMillis + 1_000}),
  ];
  for (const binding of changedBindings) {
    assertInvalidToken(() => codec().decode(token, binding));
  }
});

test("authenticated payload parsing is exact and verifies purpose and candidate digest", () => {
  const malformedPayloads = [
    {...rawPayload(), extra: true},
    rawPayload({protocolVersion: "wrong-protocol"}),
    rawPayload({purpose: "restaurantPage"}),
    rawPayload({candidateDigest: "0".repeat(64)}),
    rawPayload({candidateOfferIds: [offerIds[0], offerIds[0]]}),
    rawPayload({restaurantPublicId}),
    rawPayload({timeZone: ""}),
    rawPayload({timeZone: "\ud800"}),
    rawPayload({utcOffsetMinutes: -841}),
    rawPayload({utcOffsetMinutes: 841}),
    rawPayload({utcOffsetMinutes: -240.5}),
  ];
  for (const payload of malformedPayloads) {
    assertInvalidToken(() => codec().open(encryptRawPayload(payload)));
  }
});

test("token enforces logical expiry and the five-minute maximum lifetime", () => {
  const token = codec().encode(tokenInput());
  assert.equal(
    codec({
      now: () => issuedAtMillis +
        customerBiteSaverGuestCheckLifetimeMilliseconds - 1,
    }).open(token).expiresAtMillis,
    issuedAtMillis + customerBiteSaverGuestCheckLifetimeMilliseconds,
  );
  assertInvalidToken(() => codec({
    now: () => issuedAtMillis + customerBiteSaverGuestCheckLifetimeMilliseconds,
  }).open(token));
  const authenticatedExpired = codec({
    now: () => issuedAtMillis + customerBiteSaverGuestCheckLifetimeMilliseconds,
  }).open(token, {allowExpired: true});
  assert.equal(authenticatedExpired.expiresAtMillis,
    issuedAtMillis + customerBiteSaverGuestCheckLifetimeMilliseconds);
  assertInvalidToken(() => codec({
    now: () => issuedAtMillis + customerBiteSaverGuestCheckLifetimeMilliseconds,
  }).decode(token, tokenBinding()));
  for (const invalid of [
    tokenInput({expiresAtMillis: issuedAtMillis}),
    tokenInput({
      expiresAtMillis:
        issuedAtMillis + customerBiteSaverGuestCheckLifetimeMilliseconds + 1,
    }),
    tokenInput({evaluationAtMillis: issuedAtMillis + 1}),
  ]) {
    assertInvalidToken(() => codec().encode(invalid));
  }
});

test("continuation/token preflight rejects unchallenged and stale answers without state", () => {
  const payload = codec().open(codec().encode(tokenInput()));
  const valid = parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
    continuationRequest({unavailableOfferIds: [offerIds[0], offerIds[2]]}),
  );
  assert.doesNotThrow(() =>
    assertCustomerBiteSaverGuestOfferCheckContinuationMatchesToken(
      valid,
      payload,
      {callerCapabilityBinding},
    ));
  const empty = parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
    continuationRequest({unavailableOfferIds: []}),
  );
  assert.doesNotThrow(() =>
    assertCustomerBiteSaverGuestOfferCheckContinuationMatchesToken(
      empty,
      payload,
      {callerCapabilityBinding},
    ));

  const otherOperationRef = createCustomerBiteSaverGuestOfferCheckOperationRef(
    key,
    operationIdentity({operationFingerprint: "0".repeat(64)}),
  );
  for (const request of [
    continuationRequest({unavailableOfferIds: [opaqueId("bso", 999)]}),
    continuationRequest({batchSequence: 1}),
    continuationRequest({guestStateRevision: 10}),
    continuationRequest({sessionId: otherSessionId}),
    continuationRequest({criteriaFingerprint: "0".repeat(64)}),
    continuationRequest({operationRef: otherOperationRef}),
  ]) {
    const parsed = parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
      request,
    );
    assertInvalidRequest(() =>
      assertCustomerBiteSaverGuestOfferCheckContinuationMatchesToken(
        parsed,
        payload,
        {callerCapabilityBinding},
      ));
  }
  assertInvalidRequest(() =>
    assertCustomerBiteSaverGuestOfferCheckContinuationMatchesToken(
      valid,
      payload,
      {callerCapabilityBinding: "1".repeat(64)},
    ));
});
