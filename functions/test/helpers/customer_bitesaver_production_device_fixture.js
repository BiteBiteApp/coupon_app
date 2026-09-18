"use strict";

const assert = require("node:assert/strict");
const {createHash, generateKeyPairSync, sign} = require("node:crypto");
const {
  buildCustomerBiteSaverDeviceProofTranscript,
  customerBiteSaverCredentialId,
  customerBiteSaverDeviceProofTranscriptSha256,
  encodeCustomerBiteSaverDeviceProofTranscript,
} = require("../../lib/customer_bitesaver_device_proof_contract.js");
const {
  createIssueCustomerBiteSaverDeviceUseChallengeHandler,
} = require("../../lib/customer_bitesaver_device_usage_callable.js");
const {
  createProductionCustomerBiteSaverCouponUseHandler,
} = require("../../lib/customer_bitesaver_device_runtime.js");

// Only Google's network decode is replaced. The production policies, verifier,
// proof stores, request evidence, Browse/Saved authority and allowance core run.
async function productionDeviceUseFixture(request, context) {
  const actor = {
    uid: context.identity.authUid,
    isAnonymous: context.identity.authIsAnonymous,
  };
  let transcript;
  let proof;
  let decoderCalls = 0;
  const use = createProductionCustomerBiteSaverCouponUseHandler({
    database: context.database,
    discoveryKey: context.discoveryKey,
    identityKeyV1: context.identityKeyV1,
    encodedRootKey: Buffer.alloc(32, 0x62).toString("base64url"),
    now: context.now,
    randomSource: context.randomSource,
    playIntegrityDecoder: {
      async decode(packageName, token) {
        decoderCalls += 1;
        assert.equal(packageName, "com.colesmart.bitestar");
        assert.equal(token, proof.integrityToken);
        return {tokenPayloadExternal: {
          requestDetails: {
            requestPackageName: packageName,
            requestHash: customerBiteSaverDeviceProofTranscriptSha256(transcript)
              .toString("base64url"),
            timestampMillis: String(context.now()),
          },
          appIntegrity: {
            appRecognitionVerdict: "PLAY_RECOGNIZED",
            packageName, versionCode: "2",
            certificateSha256Digest: [Buffer.from(
              "51f92025c34ea8f5dbcda501a1b2c853c6d6b0cbd0b26c4c13a5cdbf95e40849",
              "hex",
            ).toString("base64url")],
          },
          deviceIntegrity: {deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"]},
          accountDetails: {appLicensingVerdict: "UNLICENSED"},
        }};
      },
    },
  });
  const before = new Map(context.database.documents);
  const admission = await use({
    schemaVersion: 1, operation: "admitChallenge", platform: "android", request,
  }, actor);
  assert.deepEqual(Object.keys(admission).sort(), [
    "admissionHandle", "expiresAtMillis", "permit", "schemaVersion",
  ]);
  assert.match(admission.admissionHandle, /^bsda_[A-Za-z0-9_-]{43}$/u);
  assert.match(admission.permit, /^[A-Za-z0-9_-]{43}$/u);
  const challenge = await createIssueCustomerBiteSaverDeviceUseChallengeHandler({
    database: context.database,
    now: context.now,
    randomSource: context.randomSource,
  })({
    schemaVersion: 1, platform: "android", request,
    admissionHandle: admission.admissionHandle, permit: admission.permit,
  }, actor);
  assert.equal(decoderCalls, 0, "admission and challenge issuance must stay offline");
  for (const [path, data] of before) {
    if (path === `private_bitesaver_device_challenges/${admission.admissionHandle}`) continue;
    assert.deepEqual(context.database.documents.get(path), data);
  }
  const {privateKey, publicKey} = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKeySpki = publicKey.export({format: "der", type: "spki"});
  const publicKeyHash = createHash("sha256").update(publicKeySpki).digest();
  const credentialId = customerBiteSaverCredentialId("android", publicKeyHash);
  transcript = buildCustomerBiteSaverDeviceProofTranscript({
    challenge,
    proofKind: "androidEnrollment",
    credentialId,
    androidInstallationPublicKeySha256: publicKeyHash,
    androidSsaid: "0123456789abcdef",
  });
  proof = {
    schemaVersion: 1,
    kind: "androidEnrollment",
    credentialId,
    installationPublicKeySpki: publicKeySpki.toString("base64url"),
    androidSsaid: "0123456789abcdef",
    possessionSignature: sign(
      "sha256", encodeCustomerBiteSaverDeviceProofTranscript(transcript),
      privateKey,
    ).toString("base64url"),
    integrityToken: "synthetic.production-fixture.token",
  };
  const envelope = {
    schemaVersion: 1, challengeId: challenge.challengeId, request, proof,
  };
  for (const extra of [
    {uid: "attacker"}, {deviceRef: "attacker"}, {requestFingerprint: "attacker"},
    {verified: true}, {privatePath: "attacker/path"},
  ]) {
    await assert.rejects(use({...envelope, ...extra}, actor), {
      code: "invalid-argument",
    });
  }
  assert.equal(decoderCalls, 0);
  return {
    use: () => use(envelope, actor),
    requestAdmission: () => use({
      schemaVersion: 1, operation: "admitChallenge", platform: "android", request,
    }, actor),
    issueWithAdmission: (nextAdmission) => createIssueCustomerBiteSaverDeviceUseChallengeHandler({
      database: context.database,
      now: context.now,
      randomSource: context.randomSource,
    })({
      schemaVersion: 1, platform: "android", request,
      admissionHandle: nextAdmission.admissionHandle, permit: nextAdmission.permit,
    }, actor),
    assertPrivateAndReplayed() {
      assert.equal(decoderCalls, 1, "exact replay must not decode again");
      const stored = JSON.stringify([...context.database.documents]);
      assert.equal(stored.includes(proof.androidSsaid), false);
      assert.equal(stored.includes(proof.integrityToken), false);
    },
  };
}

module.exports = {productionDeviceUseFixture};
