"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CustomerBiteSaverPlayIntegrityVerifier,
  createGoogleCustomerBiteSaverPlayIntegrityDecoder,
  customerBiteSaverAndroidPackageName,
} = require("../lib/customer_bitesaver_play_integrity.js");
const {
  CustomerBiteSaverContractError,
} = require("../lib/customer_bitesaver_search_contract.js");

const now = Date.parse("2026-09-17T12:00:00.000Z");
const requestHash = Buffer.alloc(32, 0x31).toString("base64url");
const certificate = Buffer.alloc(32, 0x32).toString("base64url");

test("production decoder attaches scoped ADC to the real API client without credential lookup", async (t) => {
  const api = require("@googleapis/playintegrity");
  const createClient = api.playintegrity;
  let client;
  let calls = 0;
  t.mock.method(api, "playintegrity", (options) => {
    client = createClient(options);
    t.mock.method(client.v1, "decodeIntegrityToken", async (request) => {
      calls++;
      assert.deepEqual(request, {
        packageName: customerBiteSaverAndroidPackageName,
        requestBody: {integrityToken: "offline.synthetic.token"},
      });
      return {data: payload()};
    });
    return client;
  });
  const decoder = createGoogleCustomerBiteSaverPlayIntegrityDecoder();
  assert.deepEqual(await decoder.decode(
    customerBiteSaverAndroidPackageName, "offline.synthetic.token",
  ), payload());
  assert.equal(calls, 1);
  assert.ok(client.context._options.auth instanceof api.auth.GoogleAuth);
  assert.deepEqual(client.context._options.auth.scopes, [
    "https://www.googleapis.com/auth/playintegrity",
  ]);
});

function payload(overrides = {}) {
  return {
    tokenPayloadExternal: {
      requestDetails: {
        requestHash,
        requestPackageName: customerBiteSaverAndroidPackageName,
        timestampMillis: String(now - 1_000),
      },
      appIntegrity: {
        appRecognitionVerdict: "PLAY_RECOGNIZED",
        packageName: customerBiteSaverAndroidPackageName,
        versionCode: "42",
        certificateSha256Digest: [certificate],
      },
      deviceIntegrity: {
        deviceRecognitionVerdict: [
          "MEETS_BASIC_INTEGRITY",
          "MEETS_DEVICE_INTEGRITY",
        ],
      },
      accountDetails: {appLicensingVerdict: "UNEVALUATED"},
      ...overrides,
    },
  };
}

function verifier(result, policyOverrides = {}) {
  return new CustomerBiteSaverPlayIntegrityVerifier({
    decoder: {
      async decode(packageName, token) {
        assert.equal(packageName, customerBiteSaverAndroidPackageName);
        assert.equal(token, "synthetic.integrity.token");
        if (result instanceof Error) throw result;
        return result;
      },
    },
    policy: {
      packageName: customerBiteSaverAndroidPackageName,
      allowedVersionCodes: new Set(["42"]),
      allowedCertificateSha256Digests: new Set([certificate]),
      requiredDeviceRecognitionVerdicts: new Set(["MEETS_DEVICE_INTEGRITY"]),
      ...policyOverrides,
    },
  });
}

function contractError(code) {
  return (error) => error instanceof CustomerBiteSaverContractError &&
    error.code === code;
}

test("standard Play Integrity policy validates request, app, signer, version, freshness, and device", async () => {
  const qualification = await verifier(payload()).verify({
    integrityToken: "synthetic.integrity.token",
    expectedRequestHash: requestHash,
    nowMillis: now,
  });
  assert.deepEqual(qualification, {
    qualification: {
      packageName: customerBiteSaverAndroidPackageName,
      versionCode: "42",
      certificateSha256Digests: [certificate],
      appRecognitionVerdict: "PLAY_RECOGNIZED",
      deviceRecognitionVerdicts: [
        "MEETS_BASIC_INTEGRITY",
        "MEETS_DEVICE_INTEGRITY",
      ],
      licensingVerdict: "UNEVALUATED",
    },
    requestTimeMillis: now - 1_000,
    validUntilMillis: now - 1_000 + 120_000,
  });
});

test("licensing is deliberately optional until production policy enables it", async () => {
  await assert.doesNotReject(verifier(payload()).verify({
    integrityToken: "synthetic.integrity.token",
    expectedRequestHash: requestHash,
    nowMillis: now,
  }));
  await assert.rejects(verifier(payload(), {
    requiredLicensingVerdict: "LICENSED",
  }).verify({
    integrityToken: "synthetic.integrity.token",
    expectedRequestHash: requestHash,
    nowMillis: now,
  }), contractError("permission-denied"));
});

test("every signer digest must be explicitly allowlisted", async () => {
  const unexpectedCertificate = Buffer.alloc(32, 0x7f).toString("base64url");
  await assert.rejects(verifier(payload({appIntegrity: {
    appRecognitionVerdict: "PLAY_RECOGNIZED",
    packageName: customerBiteSaverAndroidPackageName,
    versionCode: "42",
    certificateSha256Digest: [certificate, unexpectedCertificate],
  }})).verify({
    integrityToken: "synthetic.integrity.token",
    expectedRequestHash: requestHash,
    nowMillis: now,
  }), contractError("permission-denied"));

  await assert.doesNotReject(verifier(payload({appIntegrity: {
    appRecognitionVerdict: "PLAY_RECOGNIZED",
    packageName: customerBiteSaverAndroidPackageName,
    versionCode: "42",
    certificateSha256Digest: [certificate, unexpectedCertificate],
  }}), {
    allowedCertificateSha256Digests: new Set([
      certificate,
      unexpectedCertificate,
    ]),
  }).verify({
    integrityToken: "synthetic.integrity.token",
    expectedRequestHash: requestHash,
    nowMillis: now,
  }));
});

test("mismatched bindings, stale tokens, unknown fields, and testing overrides fail closed", async () => {
  const invalidPayloads = [
    payload({requestDetails: {
      requestHash: Buffer.alloc(32, 7).toString("base64url"),
      requestPackageName: customerBiteSaverAndroidPackageName,
      timestampMillis: String(now - 1_000),
    }}),
    payload({requestDetails: {
      requestHash,
      requestPackageName: customerBiteSaverAndroidPackageName,
      timestampMillis: String(now - 120_001),
    }}),
    payload({appIntegrity: {
      appRecognitionVerdict: "PLAY_RECOGNIZED",
      packageName: customerBiteSaverAndroidPackageName,
      versionCode: "43",
      certificateSha256Digest: [certificate],
    }}),
    payload({unknownFutureField: {accepted: false}}),
    payload({testingDetails: {isTestingResponse: true}}),
  ];
  for (const invalid of invalidPayloads) {
    await assert.rejects(verifier(invalid).verify({
      integrityToken: "synthetic.integrity.token",
      expectedRequestHash: requestHash,
      nowMillis: now,
    }), contractError("permission-denied"));
  }
});

test("provider transport failures are sanitized as unavailable", async () => {
  await assert.rejects(verifier(new Error(
    "provider credential and full token must never escape",
  )).verify({
    integrityToken: "synthetic.integrity.token",
    expectedRequestHash: requestHash,
    nowMillis: now,
  }), (error) => {
    assert.equal(error.code, "unavailable");
    assert.equal(error.message.includes("credential"), false);
    assert.equal(error.message.includes("token"), false);
    return true;
  });
});
