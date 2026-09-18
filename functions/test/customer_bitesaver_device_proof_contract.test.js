"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  buildCustomerBiteSaverDeviceProofTranscript,
  customerBiteSaverCredentialId,
  customerBiteSaverDeviceProofContractInternals,
  customerBiteSaverDeviceProofTranscriptSha256,
  customerBiteSaverDeviceTranscriptGoldenVector,
  customerBiteSaverIosAssertionClientDataHash,
  encodeCustomerBiteSaverDeviceProofTranscript,
  encodeCustomerBiteSaverIosAssertionClientData,
  parseCustomerBiteSaverDeviceProof,
  parseCustomerBiteSaverDeviceUseChallenge,
  parseCustomerBiteSaverIssueDeviceChallengeRequest,
  parseCustomerBiteSaverAdmitDeviceChallengeRequest,
  parseCustomerBiteSaverUseCouponWithDeviceProofRequest,
} = require("../lib/customer_bitesaver_device_proof_contract.js");
const {
  CustomerBiteSaverContractError,
} = require("../lib/customer_bitesaver_search_contract.js");

const transcriptHex =
  "42697465537461722f4269746553617665722f44657669636550726f6f665472" +
  "616e7363726970742f763100000000010000002262697465737461722e626974" +
  "6573617665722d6465766963652d70726f6f662e763100000011616e64726f69" +
  "64456e726f6c6c6d656e7400000007616e64726f696400000011636f6d62696e" +
  "6564436f75706f6e55736500000030627364635f414145434177514642676349" +
  "43516f4c4441304f4478415245684d554652595847426b614778776448683800" +
  "000020000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c" +
  "1d1e1f00000020000102030405060708090a0b0c0d0e0f101112131415161718" +
  "191a1b1c1d1e1f0000000009646973636f76657279000000176465766963652d" +
  "7573652d726571756573742d30303031000001a0ad857600000001a0ad857600" +
  "000001a0ad874ac00100000030627369635f5963786970486264387430644637" +
  "724741785f6e39515f584562443057566f564475684b5f777564745049010000" +
  "0020202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d" +
  "3e3f0100000010303132333435363738396162636465660000";

const challengeBytes = Buffer.from([...Array(32).keys()]);
const keyHash = Buffer.from([...Array(32).keys()].map((value) => value + 32));
const fingerprint = challengeBytes.toString("hex");
const challenge = Object.freeze({
  schemaVersion: 1,
  protocolVersion: "bitestar.bitesaver-device-proof.v1",
  challengeId: `bsdc_${challengeBytes.toString("base64url")}`,
  platform: "android",
  purpose: "combinedCouponUse",
  requestFingerprint: fingerprint,
  authenticatedUserId: null,
  origin: "discovery",
  logicalRequestId: "device-use-request-0001",
  issuedAtMillis: 1789617600000,
  validFromMillis: 1789617600000,
  expiresAtMillis: 1789617720000,
  challengeBytes: challengeBytes.toString("base64url"),
});

const derSignature = Buffer.from(
  "304402200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c" +
  "1d1e1f2002202122232425262728292a2b2c2d2e2f303132333435363738393a" +
  "3b3c3d3e3f40",
  "hex",
);

function contractError(code) {
  return (error) => error instanceof CustomerBiteSaverContractError &&
    error.code === code;
}

test("canonical transcript and assertion envelope match immutable cross-language vectors", () => {
  const credentialId = customerBiteSaverCredentialId("android", keyHash);
  assert.equal(credentialId, customerBiteSaverDeviceTranscriptGoldenVector.credentialId);
  const transcript = buildCustomerBiteSaverDeviceProofTranscript({
    challenge,
    proofKind: "androidEnrollment",
    credentialId,
    androidInstallationPublicKeySha256: keyHash,
    androidSsaid: "0123456789abcdef",
  });
  const encoded = encodeCustomerBiteSaverDeviceProofTranscript(transcript);
  assert.equal(encoded.length, 441);
  assert.equal(encoded.toString("hex"), transcriptHex);
  assert.equal(
    createHash("sha256").update(encoded).digest("hex"),
    customerBiteSaverDeviceTranscriptGoldenVector.sha256,
  );
  assert.equal(
    customerBiteSaverDeviceProofTranscriptSha256(transcript)
      .toString("base64url"),
    customerBiteSaverDeviceTranscriptGoldenVector.requestHash,
  );

  const envelope = encodeCustomerBiteSaverIosAssertionClientData(
    Buffer.from(customerBiteSaverDeviceTranscriptGoldenVector.sha256, "hex"),
    derSignature,
  );
  assert.equal(envelope.length, 153);
  assert.equal(
    customerBiteSaverIosAssertionClientDataHash(
      Buffer.from(customerBiteSaverDeviceTranscriptGoldenVector.sha256, "hex"),
      derSignature,
    ).toString("hex"),
    "956ea8ac7ede8f18c83f9c8e81105d9d3a72b870ba5210cad2e28942b0041329",
  );
});

test("raw transcript encoder independently rejects an overlong lifetime", () => {
  const transcript = buildCustomerBiteSaverDeviceProofTranscript({
    challenge,
    proofKind: "androidEnrollment",
    credentialId: customerBiteSaverCredentialId("android", keyHash),
    androidInstallationPublicKeySha256: keyHash,
    androidSsaid: "0123456789abcdef",
  });
  assert.throws(
    () => encodeCustomerBiteSaverDeviceProofTranscript({
      ...transcript,
      expiresAtMillis: transcript.issuedAtMillis + 120_001,
    }),
    contractError("failed-precondition"),
  );
});

test("challenge codec rejects unknown fields, padding, bad versions, identifiers, UIDs, and times", () => {
  assert.deepEqual(parseCustomerBiteSaverDeviceUseChallenge(challenge), challenge);
  const invalid = [
    {...challenge, unexpected: true},
    {...challenge, schemaVersion: 2},
    {...challenge, challengeBytes: `${challenge.challengeBytes}=`},
    {...challenge, challengeId: ` ${challenge.challengeId}`},
    {...challenge, authenticatedUserId: " padded "},
    {...challenge, authenticatedUserId: "a/b"},
    {...challenge, authenticatedUserId: "x".repeat(129)},
    {...challenge, expiresAtMillis: challenge.issuedAtMillis},
    {...challenge, expiresAtMillis: challenge.issuedAtMillis + 120_001},
  ];
  for (const value of invalid) {
    assert.throws(
      () => parseCustomerBiteSaverDeviceUseChallenge(value),
      contractError("invalid-argument"),
    );
  }
});

test("proof union is exact, bounded, canonical, and platform-specific", () => {
  const androidEnrollment = {
    schemaVersion: 1,
    kind: "androidEnrollment",
    credentialId: customerBiteSaverCredentialId("android", keyHash),
    installationPublicKeySpki: Buffer.alloc(91, 7).toString("base64url"),
    androidSsaid: "0123456789abcdef",
    possessionSignature: derSignature.toString("base64url"),
    integrityToken: "synthetic.integrity.token",
  };
  assert.deepEqual(
    parseCustomerBiteSaverDeviceProof(androidEnrollment),
    androidEnrollment,
  );
  for (const invalid of [
    {...androidEnrollment, extra: true},
    {...androidEnrollment, androidSsaid: "0123456789ABCDEf"},
    {...androidEnrollment, installationPublicKeySpki:
      `${androidEnrollment.installationPublicKeySpki}=`},
    {...androidEnrollment, integrityToken: "x".repeat(32_769)},
  ]) {
    assert.throws(
      () => parseCustomerBiteSaverDeviceProof(invalid),
      contractError("invalid-argument"),
    );
  }
});

test("outer codecs never accept a client request fingerprint", () => {
  const parsedRequest = Object.freeze({kind: "parsed-request"});
  const parser = (raw) => {
    assert.deepEqual(raw, {opaque: "combined"});
    return parsedRequest;
  };
  assert.deepEqual(parseCustomerBiteSaverIssueDeviceChallengeRequest({
    schemaVersion: 1,
    platform: "android",
    request: {opaque: "combined"},
    admissionHandle: `bsda_${Buffer.alloc(32, 6).toString("base64url")}`,
    permit: Buffer.alloc(32, 7).toString("base64url"),
  }, parser), {
    schemaVersion: 1,
    platform: "android",
    request: parsedRequest,
    admissionHandle: `bsda_${Buffer.alloc(32, 6).toString("base64url")}`,
    permit: Buffer.alloc(32, 7).toString("base64url"),
  });
  assert.throws(() => parseCustomerBiteSaverIssueDeviceChallengeRequest({
    schemaVersion: 1,
    platform: "android",
    request: {opaque: "combined"},
    requestFingerprint: fingerprint,
  }, parser), contractError("invalid-argument"));

  const useProof = {
    schemaVersion: 1,
    kind: "androidUse",
    credentialId: customerBiteSaverCredentialId("android", keyHash),
    possessionSignature: derSignature.toString("base64url"),
  };
  const use = parseCustomerBiteSaverUseCouponWithDeviceProofRequest({
    schemaVersion: 1,
    challengeId: challenge.challengeId,
    request: {opaque: "combined"},
    proof: useProof,
  }, parser);
  assert.equal(use.challengeId, challenge.challengeId);
  assert.deepEqual(use.proof, useProof);
  assert.throws(() => parseCustomerBiteSaverUseCouponWithDeviceProofRequest({
    schemaVersion: 1,
    challengeId: challenge.challengeId,
    request: {opaque: "combined"},
    proof: useProof,
    requestFingerprint: fingerprint,
  }, parser), contractError("invalid-argument"));
});

test("admission operation is exact and challenge issuance requires a canonical permit", () => {
  const parser = (raw) => raw;
  const admission = {schemaVersion: 1, operation: "admitChallenge", platform: "ios", request: {}};
  assert.deepEqual(parseCustomerBiteSaverAdmitDeviceChallengeRequest(admission, parser), admission);
  for (const invalid of [
    {...admission, operation: "use"}, {...admission, operation: undefined},
    {...admission, proof: {}}, {...admission, permit: "x"},
    {...admission, challengeId: challenge.challengeId}, {...admission, platform: "web"},
  ]) {
    assert.throws(() => parseCustomerBiteSaverAdmitDeviceChallengeRequest(invalid, parser),
      contractError("invalid-argument"));
  }
  const issuance = {schemaVersion: 1, platform: "ios", request: {},
    admissionHandle: `bsda_${Buffer.alloc(32, 6).toString("base64url")}`,
    permit: Buffer.alloc(32, 7).toString("base64url")};
  for (const invalid of [
    {...issuance, permit: undefined}, {...issuance, permit: `${issuance.permit}=`},
    {...issuance, admissionHandle: undefined}, {...issuance, operation: "admitChallenge"},
  ]) {
    assert.throws(() => parseCustomerBiteSaverIssueDeviceChallengeRequest(invalid, parser),
      contractError("invalid-argument"));
  }
});

test("golden identifiers are bounded and do not expose source material", () => {
  assert.match(
    customerBiteSaverDeviceTranscriptGoldenVector.credentialId,
    customerBiteSaverDeviceProofContractInternals.credentialIdPattern,
  );
  assert.equal(
    customerBiteSaverDeviceTranscriptGoldenVector.credentialId.includes(
      "0123456789abcdef",
    ),
    false,
  );
});
