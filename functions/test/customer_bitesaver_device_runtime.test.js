"use strict";

const assert = require("node:assert/strict");
const {
  createHash,
  generateKeyPairSync,
  sign,
  webcrypto,
  X509Certificate,
} = require("node:crypto");
const test = require("node:test");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {encode} = require("cbor-x");
const {
  BasicConstraintsExtension,
  Extension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509CertificateGenerator,
} = require("@peculiar/x509");
const appAttest = require("../lib/customer_bitesaver_app_attest.js");
const {
  createProductionCustomerBiteSaverDeviceProviders,
  createProductionCustomerBiteSaverCouponUseHandler,
} = require("../lib/customer_bitesaver_device_runtime.js");
const {
  CustomerBiteSaverContractError,
} = require("../lib/customer_bitesaver_search_contract.js");

const now = Date.parse("2026-09-18T12:00:00.000Z");
const packageName = "com.colesmart.bitestar";
const appId = "WXLXQ5D769.com.colesmart.bitestar";
const playSigner = Buffer.from(
  "51F92025C34EA8F5DBCDA501A1B2C853C6D6B0CBD0B26C4C13A5CDBF95E40849",
  "hex",
).toString("base64url");
const requestHash = Buffer.alloc(32, 0x31).toString("base64url");
const integrityInput = Object.freeze({
  integrityToken: "offline.synthetic.integrity.token",
  expectedRequestHash: requestHash,
  nowMillis: now,
});

test("production version policy matches the current Flutter and platform version resolution", () => {
  const source = (file) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
  assert.match(source("pubspec.yaml"), /^version: 1\.0\.0\+2$/mu);
  const android = source("android/app/build.gradle.kts");
  assert.match(android, /versionCode = flutter\.versionCode/u);
  assert.match(android, /versionName = flutter\.versionName/u);
  const ios = source("ios/Runner/Info.plist");
  assert.match(ios, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(FLUTTER_BUILD_NAME\)<\/string>/u);
  assert.match(ios, /<key>CFBundleVersion<\/key>\s*<string>\$\(FLUTTER_BUILD_NUMBER\)<\/string>/u);
  for (const file of [
    "lib/services/customer_bitesaver_search_coordinator.dart",
    "lib/services/customer_bitesaver_saved_coordinator.dart",
  ]) {
    assert.doesNotMatch(source(file),
      /issueCustomerBiteSaverDeviceUseChallenge|useCustomerBiteSaverCoupon|CustomerBiteSaverDeviceProofService/u);
  }
});

function contractError(code) {
  return (error) => error instanceof CustomerBiteSaverContractError &&
    error.code === code;
}

function payload() {
  return {
    tokenPayloadExternal: {
      requestDetails: {
        requestHash,
        requestPackageName: packageName,
        timestampMillis: String(now - 1_000),
      },
      appIntegrity: {
        appRecognitionVerdict: "PLAY_RECOGNIZED",
        packageName,
        versionCode: "2",
        certificateSha256Digest: [playSigner],
      },
      deviceIntegrity: {
        deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"],
      },
      accountDetails: {appLicensingVerdict: "UNEVALUATED"},
    },
  };
}

function providersFor(response) {
  return createProductionCustomerBiteSaverDeviceProviders({
    async decode(decodedPackage, integrityToken) {
      assert.equal(decodedPackage, packageName);
      assert.equal(integrityToken, integrityInput.integrityToken);
      return response;
    },
  });
}

test("production Android accepts only the current Play package/signer/build without requiring LICENSED or optional signals", async () => {
  assert.equal(playSigner, "UfkgJcNOqPXbzaUBobLIU8bWsMvQsmxME6XNv5XkCEk");
  for (const licensingVerdict of ["LICENSED", "UNLICENSED", "UNEVALUATED"]) {
    const response = payload();
    response.tokenPayloadExternal.accountDetails.appLicensingVerdict =
      licensingVerdict;
    const result = await providersFor(response).playIntegrityVerifier
      .verify(integrityInput);
    assert.deepEqual(result, {
      qualification: {
        packageName,
        versionCode: "2",
        certificateSha256Digests: [playSigner],
        appRecognitionVerdict: "PLAY_RECOGNIZED",
        deviceRecognitionVerdicts: ["MEETS_DEVICE_INTEGRITY"],
        licensingVerdict,
      },
      requestTimeMillis: now - 1_000,
      validUntilMillis: now - 1_000 + 120_000,
    });
  }
});

test("production Android rejects substituted identity, unrecognized apps, absent device integrity, and unknown responses", async () => {
  const cases = [
    ["request package", (p) => p.requestDetails.requestPackageName = "other.app"],
    ["app package", (p) => p.appIntegrity.packageName = "other.app"],
    ["wrong signer", (p) => p.appIntegrity.certificateSha256Digest =
      [Buffer.alloc(32, 0x55).toString("base64url")]],
    ["debug/upload signer cannot accompany Play signer", (p) =>
      p.appIntegrity.certificateSha256Digest.push(
        Buffer.alloc(32, 0x77).toString("base64url"),
      )],
    ["missing signer", (p) => delete p.appIntegrity.certificateSha256Digest],
    ["prior build", (p) => p.appIntegrity.versionCode = "1"],
    ["future build", (p) => p.appIntegrity.versionCode = "3"],
    ["numeric version", (p) => p.appIntegrity.versionCode = 2],
    ["unrecognized version", (p) =>
      p.appIntegrity.appRecognitionVerdict = "UNRECOGNIZED_VERSION"],
    ["missing recognition", (p) => delete p.appIntegrity.appRecognitionVerdict],
    ["missing required device integrity", (p) =>
      p.deviceIntegrity.deviceRecognitionVerdict = ["MEETS_BASIC_INTEGRITY"]],
    ["strong alone is not required device verdict", (p) =>
      p.deviceIntegrity.deviceRecognitionVerdict = ["MEETS_STRONG_INTEGRITY"]],
    ["missing device response", (p) => delete p.deviceIntegrity],
    ["unknown device verdict", (p) =>
      p.deviceIntegrity.deviceRecognitionVerdict.push("FUTURE_VERDICT")],
    ["unknown licensing verdict", (p) =>
      p.accountDetails.appLicensingVerdict = "FUTURE_LICENSE"],
    ["request hash", (p) => p.requestDetails.requestHash =
      Buffer.alloc(32, 0x7f).toString("base64url")],
    ["classic nonce", (p) => p.requestDetails.nonce = "unexpected"],
    ["unknown payload field", (p) => p.unknownField = true],
    ["unknown app field", (p) => p.appIntegrity.unknownField = true],
    ["unknown request field", (p) => p.requestDetails.unknownField = true],
    ["test response", (p) => p.testingDetails = {isTestingResponse: true}],
  ];
  for (const [label, mutate] of cases) {
    const response = payload();
    mutate(response.tokenPayloadExternal);
    await assert.rejects(
      providersFor(response).playIntegrityVerifier.verify(integrityInput),
      contractError("permission-denied"),
      label,
    );
  }
  for (const response of [
    null, [], {}, "provider response", {tokenPayloadExternal: null},
    {...payload(), unknownField: true},
  ]) {
    await assert.rejects(
      providersFor(response).playIntegrityVerifier.verify(integrityInput),
      contractError("permission-denied"),
    );
  }
});

test("production Android enforces the exact two-minute age and ten-second future-skew bounds", async () => {
  for (const offset of [-120_000, 10_000]) {
    const response = payload();
    response.tokenPayloadExternal.requestDetails.timestampMillis =
      String(now + offset);
    await assert.doesNotReject(
      providersFor(response).playIntegrityVerifier.verify(integrityInput),
    );
  }
  for (const timestamp of [String(now - 120_001), String(now + 10_001), "NaN"]) {
    const response = payload();
    response.tokenPayloadExternal.requestDetails.timestampMillis = timestamp;
    await assert.rejects(
      providersFor(response).playIntegrityVerifier.verify(integrityInput),
      contractError("permission-denied"),
    );
  }
});

test("production default decoder attaches scoped ADC and stays offline until verification", async (t) => {
  const api = require("@googleapis/playintegrity");
  const createClient = api.playintegrity;
  let client;
  let calls = 0;
  t.mock.method(api, "playintegrity", (options) => {
    client = createClient(options);
    t.mock.method(client.v1, "decodeIntegrityToken", async (request) => {
      calls++;
      assert.deepEqual(request, {
        packageName,
        requestBody: {integrityToken: integrityInput.integrityToken},
      });
      return {data: payload()};
    });
    return client;
  });
  const providers = createProductionCustomerBiteSaverDeviceProviders();
  assert.equal(calls, 0);
  assert.ok(client.context._options.auth instanceof api.auth.GoogleAuth);
  assert.deepEqual(client.context._options.auth.scopes, [
    "https://www.googleapis.com/auth/playintegrity",
  ]);
  await providers.playIntegrityVerifier.verify(integrityInput);
  assert.equal(calls, 1);
});

test("production provider failures remain closed and sanitized", async () => {
  const providers = createProductionCustomerBiteSaverDeviceProviders({
    async decode() {
      throw new Error("synthetic credential and attestation-token diagnostics");
    },
  });
  await assert.rejects(providers.playIntegrityVerifier.verify(integrityInput),
    (error) => {
      assert.ok(contractError("unavailable")(error));
      assert.equal(error.message,
        "Android device verification is temporarily unavailable.");
      return true;
    });
});

function captureIosPolicy(t) {
  const RealVerifier = appAttest.CustomerBiteSaverAppAttestVerifier;
  let policy;
  t.mock.method(appAttest, "CustomerBiteSaverAppAttestVerifier",
    class extends RealVerifier {
      constructor(value) {
        super(value);
        policy = value;
      }
    });
  const providers = providersFor(payload());
  assert.ok(providers.appAttestVerifier instanceof RealVerifier);
  return {policy, providers, RealVerifier};
}

test("production iOS pins the exact Apple App Attestation root, App ID, environment, distribution categories, and build", (t) => {
  const {policy} = captureIosPolicy(t);
  assert.equal(policy.appId, appId);
  assert.equal(policy.environment, "production");
  assert.deepEqual([...policy.allowedValidationCategories], [2, 4]);
  assert.deepEqual([...policy.allowedBundleVersions], ["2"]);
  assert.equal(policy.trustedRootCertificatesDer.length, 1);
  const certificate = new X509Certificate(policy.trustedRootCertificatesDer[0]);
  assert.equal(certificate.fingerprint256.replace(/:/gu, ""),
    "1CB9823BA28BA6AD2D33A006941DE2AE4F513EF1D4E831B9F7E0FA7B6242C932");
  assert.equal(certificate.subject,
    "CN=Apple App Attestation Root CA\nO=Apple Inc.\nST=California");
  assert.equal(certificate.issuer, certificate.subject);
  assert.equal(certificate.ca, true);
  assert.equal(certificate.verify(certificate.publicKey), true);
});

function extensionMap(category = 4, version = "2") {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(category);
  return new Map([
    ["apple_validation_category_01", bytes],
    ["apple_bundle_version_01", version],
  ]);
}

function assertionFixture({
  rpId = appId,
  counter = 1,
  category = 4,
  version = "2",
  legacy = false,
} = {}) {
  const {privateKey, publicKey} = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const clientDataHash = createHash("sha256").update("offline assertion").digest();
  const counterBytes = Buffer.alloc(4);
  counterBytes.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(rpId).digest(),
    Buffer.from([0x40]),
    counterBytes,
    ...(legacy ? [] : [encode(extensionMap(category, version))]),
  ]);
  const nonce = createHash("sha256").update(Buffer.concat([
    authenticatorData, clientDataHash,
  ])).digest();
  return {
    assertionObject: encode(new Map([
      ["signature", sign("sha256", nonce, privateKey)],
      ["authenticatorData", authenticatorData],
    ])),
    clientDataHash,
    appAttestPublicKeySpki: publicKey.export({format: "der", type: "spki"}),
  };
}

test("production iOS assertions enforce exact Team/bundle/RP, distribution category, build, and positive counters", () => {
  const verifier = providersFor(payload()).appAttestVerifier;
  for (const category of [2, 4]) {
    assert.deepEqual(verifier.verifyAssertion(assertionFixture({category, counter: 9})), {
      assertionCounter: 9,
      validationCategory: category,
      bundleVersion: "2",
    });
  }
  for (const options of [
    {rpId: "OTHERTEAM1.com.colesmart.bitestar"},
    {rpId: "WXLXQ5D769.com.colesmart.other"},
    {rpId: packageName},
    {counter: 0},
    {version: "1"},
    {version: "3"},
    {category: 1},
    {category: 3},
    {category: 5},
    {category: 6},
    {category: 10},
  ]) {
    assert.throws(() => verifier.verifyAssertion(assertionFixture(options)),
      contractError("permission-denied"), JSON.stringify(options));
  }
  // Existing reviewed legacy assertions have no version/category extensions.
  assert.deepEqual(verifier.verifyAssertion(assertionFixture({legacy: true})), {
    assertionCounter: 1,
    validationCategory: null,
    bundleVersion: null,
  });
});

async function syntheticAttestation({environment = "production", category = 4} = {}) {
  const algorithm = {name: "ECDSA", namedCurve: "P-256"};
  const makeKey = () => webcrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const [rootKeys, intermediateKeys, leafKeys] = await Promise.all([
    makeKey(), makeKey(), makeKey(),
  ]);
  const dates = {
    notBefore: new Date("2026-01-01T00:00:00.000Z"),
    notAfter: new Date("2027-01-01T00:00:00.000Z"),
  };
  const caExtensions = (pathLength) => [
    new BasicConstraintsExtension(true, pathLength, true),
    new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
  ];
  const root = await X509CertificateGenerator.createSelfSigned({
    name: "CN=Offline Runtime Test Root",
    keys: rootKeys,
    serialNumber: "01",
    ...dates,
    extensions: caExtensions(1),
  }, webcrypto);
  const intermediate = await X509CertificateGenerator.create({
    subject: "CN=Offline Runtime Test Intermediate",
    issuer: "CN=Offline Runtime Test Root",
    publicKey: intermediateKeys.publicKey,
    signingKey: rootKeys.privateKey,
    serialNumber: "02",
    ...dates,
    extensions: caExtensions(0),
  }, webcrypto);
  const jwk = await webcrypto.subtle.exportKey("jwk", leafKeys.publicKey);
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  const keyId = createHash("sha256").update(Buffer.concat([
    Buffer.from([4]), x, y,
  ])).digest();
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(appId).digest(),
    Buffer.from([0x40]),
    Buffer.alloc(4),
    environment === "production"
      ? Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)])
      : Buffer.from("appattestdevelop"),
    Buffer.from([0, 32]),
    keyId,
    encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]])),
    encode(extensionMap(category)),
  ]);
  const clientDataHash = createHash("sha256").update("offline attestation").digest();
  const nonce = createHash("sha256").update(Buffer.concat([
    authenticatorData, clientDataHash,
  ])).digest();
  const leaf = await X509CertificateGenerator.create({
    subject: "CN=Offline Runtime Test Credential",
    issuer: "CN=Offline Runtime Test Intermediate",
    publicKey: leafKeys.publicKey,
    signingKey: intermediateKeys.privateKey,
    serialNumber: "03",
    ...dates,
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      new Extension("1.2.840.113635.100.8.2", false, Buffer.concat([
        Buffer.from([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]), nonce,
      ])),
    ],
  }, webcrypto);
  return {
    rootDer: Buffer.from(root.rawData),
    input: {
      appAttestKeyId: keyId.toString("base64url"),
      clientDataHash,
      nowMillis: now,
      attestationObject: encode(new Map([
        ["fmt", "apple-appattest"],
        ["attStmt", new Map([
          ["x5c", [Buffer.from(leaf.rawData), Buffer.from(intermediate.rawData)]],
          ["receipt", Buffer.alloc(64, 0x71)],
        ])],
        ["authData", authenticatorData],
      ])),
    },
  };
}

test("captured production iOS policy rejects development in an isolated signed-chain test; the runtime never trusts the synthetic root", async (t) => {
  const {policy, providers, RealVerifier} = captureIosPolicy(t);
  for (const environment of ["production", "development"]) {
    const fixture = await syntheticAttestation({environment});
    // Only this independent verifier receives test trust material. The runtime
    // factory exposes no root override and retains its pinned Apple certificate.
    const isolatedVerifier = new RealVerifier({
      ...policy,
      trustedRootCertificatesDer: [fixture.rootDer],
    });
    if (environment === "production") {
      const accepted = isolatedVerifier.verifyAttestation(fixture.input);
      assert.equal(accepted.environment, "production");
      assert.equal(accepted.appId, appId);
      assert.equal(accepted.initialAssertionCounter, 0);
      assert.equal(accepted.bundleVersion, "2");
      assert.equal(accepted.validationCategory, 4);
    } else {
      assert.throws(() => isolatedVerifier.verifyAttestation(fixture.input),
        contractError("permission-denied"));
    }
    assert.throws(() => providers.appAttestVerifier.verifyAttestation(fixture.input),
      contractError("permission-denied"));
  }
});

function handlerOptions() {
  return {
    database: {},
    discoveryKey: Buffer.alloc(32, 0x43),
    identityKeyV1: Buffer.alloc(32, 0x44),
    encodedRootKey: Buffer.alloc(32, 0x42).toString("base64url"),
    now: () => now,
    randomSource: (size) => Buffer.alloc(size, 0x45),
    playIntegrityDecoder: {
      async decode() {
        assert.fail("handler construction must not contact any provider");
      },
    },
  };
}

test("production handler requires a canonical 32-byte root with no missing-secret or test fallback", () => {
  const valid = handlerOptions().encodedRootKey;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(valid.at(-1));
  const nonCanonical = valid.slice(0, -1) + alphabet[last + 1];
  assert.deepEqual(Buffer.from(nonCanonical, "base64url"), Buffer.from(valid, "base64url"));
  for (const encodedRootKey of [
    undefined, null, "", Buffer.alloc(32, 0x42),
    "a".repeat(42), "a".repeat(44), `${valid}=`, `${valid}\n`,
    "!".repeat(43), nonCanonical,
  ]) {
    assert.throws(() => createProductionCustomerBiteSaverCouponUseHandler({
      ...handlerOptions(), encodedRootKey,
    }), (error) => {
      assert.ok(contractError("failed-precondition")(error));
      assert.equal(error.message, "BiteSaver device verification is not configured.");
      return true;
    });
  }
  assert.equal(typeof createProductionCustomerBiteSaverCouponUseHandler(
    handlerOptions(),
  ), "function");
});

test("production admission dispatch rejects ambiguous envelopes before database or provider access", async () => {
  const options = handlerOptions();
  const handler = createProductionCustomerBiteSaverCouponUseHandler(options);
  const actor = {uid: null, isAnonymous: false};
  for (const envelope of [
    {schemaVersion: 1, operation: "admitChallenge", platform: "android"},
    {schemaVersion: 1, operation: "unknownOperation", platform: "android", request: {}},
    {schemaVersion: 1, operation: "admitChallenge", platform: "web", request: {}},
    {schemaVersion: 1, operation: "admitChallenge", platform: "android", request: {}, proof: {}},
    {schemaVersion: 1, operation: "admitChallenge", platform: "android", request: {}, challengeId: "caller-selected"},
  ]) {
    await assert.rejects(handler(envelope, actor), contractError("invalid-argument"));
  }
});
