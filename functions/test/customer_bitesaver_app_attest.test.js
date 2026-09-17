"use strict";

const assert = require("node:assert/strict");
const {
  createHash,
  generateKeyPairSync,
  sign,
  webcrypto,
} = require("node:crypto");
const test = require("node:test");
const {encode} = require("cbor-x");
const {
  BasicConstraintsExtension,
  Extension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509CertificateGenerator,
} = require("@peculiar/x509");

const {
  CustomerBiteSaverAppAttestVerifier,
  customerBiteSaverAppAttestInternals,
  customerBiteSaverIosAppId,
} = require("../lib/customer_bitesaver_app_attest.js");
const {
  CustomerBiteSaverContractError,
} = require("../lib/customer_bitesaver_search_contract.js");

const syntheticRoot = Buffer.alloc(256, 0x51);
const policy = Object.freeze({
  appId: customerBiteSaverIosAppId,
  environment: "development",
  trustedRootCertificatesDer: Object.freeze([syntheticRoot]),
  allowedValidationCategories: new Set([3]),
  allowedBundleVersions: new Set(["1.0"]),
});

function validationCategoryBytes(value = 3) {
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32LE(value);
  return encoded;
}

function extensions(overrides = {}) {
  return new Map([
    ["apple_validation_category_01", validationCategoryBytes()],
    ["apple_bundle_version_01", "1.0"],
    ...Object.entries(overrides),
  ]);
}

// Encode entries directly so hostile duplicate keys reach the real decoder.
function rawCborMap(entries) {
  assert.ok(entries.length < 24);
  return Buffer.concat([
    Buffer.from([0xa0 + entries.length]),
    ...entries.flatMap(([key, value]) => [key, value]),
  ]);
}

function encodedMapEntries(entries, duplicateKey) {
  const encoded = [...entries].map(([key, value]) => [encode(key), encode(value)]);
  if (duplicateKey !== undefined) {
    const duplicate = [...entries].find(([key]) => key === duplicateKey);
    assert.ok(duplicate);
    encoded.unshift([encode(duplicate[0]), encode(duplicate[1])]);
  }
  return encoded;
}

function assertionFixture({
  counter = 1,
  extensionMap = extensions(),
  flags = 0x40,
  includeExtensions = true,
  trailingBytes,
} = {}) {
  const {privateKey, publicKey} = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const clientDataHash = createHash("sha256").update("synthetic-client-data")
    .digest();
  const counterBytes = Buffer.alloc(4);
  counterBytes.writeUInt32BE(counter);
  const authenticatorTail = trailingBytes ??
    (includeExtensions ? encode(extensionMap) : Buffer.alloc(0));
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(customerBiteSaverIosAppId, "utf8").digest(),
    Buffer.from([flags]),
    counterBytes,
    authenticatorTail,
  ]);
  const nonce = createHash("sha256").update(Buffer.concat([
    authenticatorData,
    clientDataHash,
  ])).digest();
  const signature = sign("sha256", nonce, privateKey);
  const assertionObject = encode(new Map([
    ["signature", signature],
    ["authenticatorData", authenticatorData],
  ]));
  return {
    assertionObject,
    authenticatorData,
    signature,
    clientDataHash,
    publicKeySpki: publicKey.export({format: "der", type: "spki"}),
  };
}

function contractError(code) {
  return (error) => error instanceof CustomerBiteSaverContractError &&
    error.code === code;
}

test("App Attest assertion validates signature, RP/App-ID, counter, and current extensions", () => {
  const fixture = assertionFixture({counter: 7});
  const result = new CustomerBiteSaverAppAttestVerifier(policy).verifyAssertion({
    assertionObject: fixture.assertionObject,
    clientDataHash: fixture.clientDataHash,
    appAttestPublicKeySpki: fixture.publicKeySpki,
  });
  assert.deepEqual(result, {
    assertionCounter: 7,
    validationCategory: 3,
    bundleVersion: "1.0",
  });
});

test("App Attest assertion strictly accepts the legacy no-extension layout", () => {
  const fixture = assertionFixture({counter: 7, includeExtensions: false});
  const result = new CustomerBiteSaverAppAttestVerifier(policy).verifyAssertion({
    assertionObject: fixture.assertionObject,
    clientDataHash: fixture.clientDataHash,
    appAttestPublicKeySpki: fixture.publicKeySpki,
  });
  assert.deepEqual(result, {
    assertionCounter: 7,
    validationCategory: null,
    bundleVersion: null,
  });
});

test("App Attest assertion rejects duplicate security fields before map collapse", () => {
  const verifier = new CustomerBiteSaverAppAttestVerifier(policy);
  const fixture = assertionFixture();
  const check = (assertionObject, proof = fixture) => verifier.verifyAssertion({
    assertionObject,
    clientDataHash: proof.clientDataHash,
    appAttestPublicKeySpki: proof.publicKeySpki,
  });
  const entries = [
    ["signature", fixture.signature],
    ["authenticatorData", fixture.authenticatorData],
  ];
  assert.equal(check(rawCborMap(encodedMapEntries(entries))).assertionCounter, 1);
  for (const duplicateKey of ["signature", "authenticatorData"]) {
    const duplicate = rawCborMap(encodedMapEntries(entries, duplicateKey));
    assert.throws(() => check(duplicate), contractError("permission-denied"));
    assert.throws(() => check(Buffer.concat([
      Buffer.from([0xd9, 0x01, 0x03]), // cbor-x's Map tag must not hide duplicates.
      duplicate,
    ])), contractError("permission-denied"));
  }

  // Different CBOR length encodings denote the same text key.
  const alternateSignatureKey = Buffer.concat([
    Buffer.from([0x78, 9]),
    Buffer.from("signature"),
  ]);
  assert.throws(() => check(rawCborMap([
    [alternateSignatureKey, encode(fixture.signature)],
    ...encodedMapEntries(entries),
  ])), contractError("permission-denied"));

  for (const duplicateKey of [
    "apple_validation_category_01",
    "apple_bundle_version_01",
  ]) {
    // Sign the exact malformed authenticator data: rejection cannot be credited
    // to a bad signature or to the server's category/version policy.
    const duplicate = assertionFixture({
      trailingBytes: rawCborMap(encodedMapEntries(extensions(), duplicateKey)),
    });
    assert.throws(() => check(duplicate.assertionObject, duplicate),
      contractError("permission-denied"));
  }
});

test("App Attest CBOR preflight bounds depth, lengths, and unsupported key forms", () => {
  const fixture = assertionFixture();
  const verifier = new CustomerBiteSaverAppAttestVerifier(policy);
  const check = (assertionObject) => verifier.verifyAssertion({
    assertionObject,
    clientDataHash: fixture.clientDataHash,
    appAttestPublicKeySpki: fixture.publicKeySpki,
  });
  for (const malformed of [
    Buffer.concat([Buffer.alloc(10, 0x81), encode(0)]),
    Buffer.from([0xa1, 0x7b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.from([0xa1, 0x78, 0x09, 0x61]),
    Buffer.from([0xa1, 0x61, 0xff, 0x01]),
    Buffer.from([0xa1, 0x81, 0x01, 0x01]),
    Buffer.concat([
      Buffer.from([0xa1, 0xd9, 0x01, 0x00]),
      encode("signature"),
      encode(0),
    ]),
    Buffer.from([0xbf, 0xff]),
    Buffer.alloc(16_385, 0),
  ]) {
    assert.throws(() => check(malformed), contractError("permission-denied"));
  }
});

test("App Attest assertion rejects rollback, wrong RP, bad signature, and extension drift", () => {
  const verifier = new CustomerBiteSaverAppAttestVerifier(policy);
  const rollback = assertionFixture({counter: 0});
  assert.throws(() => verifier.verifyAssertion({
    assertionObject: rollback.assertionObject,
    clientDataHash: rollback.clientDataHash,
    appAttestPublicKeySpki: rollback.publicKeySpki,
  }), contractError("permission-denied"));

  const unknown = assertionFixture({
    extensionMap: new Map([
      ["apple_validation_category_01", validationCategoryBytes()],
      ["apple_bundle_version_01", "1.0"],
      ["unknown_extension", true],
    ]),
  });
  assert.throws(() => verifier.verifyAssertion({
    assertionObject: unknown.assertionObject,
    clientDataHash: unknown.clientDataHash,
    appAttestPublicKeySpki: unknown.publicKeySpki,
  }), contractError("permission-denied"));

  const wrongVersion = assertionFixture({
    extensionMap: extensions({apple_bundle_version_01: "2.0"}),
  });
  assert.throws(() => verifier.verifyAssertion({
    assertionObject: wrongVersion.assertionObject,
    clientDataHash: wrongVersion.clientDataHash,
    appAttestPublicKeySpki: wrongVersion.publicKeySpki,
  }), contractError("permission-denied"));

  for (const invalidCategory of [
    3,
    Buffer.alloc(3, 3),
    Buffer.alloc(5, 3),
  ]) {
    const wrongCategoryShape = assertionFixture({
      extensionMap: extensions({
        apple_validation_category_01: invalidCategory,
      }),
    });
    assert.throws(() => verifier.verifyAssertion({
      assertionObject: wrongCategoryShape.assertionObject,
      clientDataHash: wrongCategoryShape.clientDataHash,
      appAttestPublicKeySpki: wrongCategoryShape.publicKeySpki,
    }), contractError("permission-denied"));
  }

  const good = assertionFixture();
  assert.throws(() => verifier.verifyAssertion({
    assertionObject: good.assertionObject,
    clientDataHash: Buffer.alloc(32, 0x99),
    appAttestPublicKeySpki: good.publicKeySpki,
  }), contractError("permission-denied"));

  for (const mixed of [
    assertionFixture({flags: 0}),
    assertionFixture({flags: 0x80}),
    assertionFixture({flags: 0xc0}),
    assertionFixture({flags: 0x41}),
    assertionFixture({trailingBytes: Buffer.concat([
      encode(extensions()),
      encode(null),
    ])}),
  ]) {
    assert.throws(() => verifier.verifyAssertion({
      assertionObject: mixed.assertionObject,
      clientDataHash: mixed.clientDataHash,
      appAttestPublicKeySpki: mixed.publicKeySpki,
    }), contractError("permission-denied"));
  }
});

test("attested authenticator data strictly accepts exact modern and legacy layouts", () => {
  const {publicKey} = generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const jwk = publicKey.export({format: "jwk"});
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  const x963 = Buffer.concat([Buffer.from([4]), x, y]);
  const credentialId = createHash("sha256").update(x963).digest();
  const counter = Buffer.alloc(4);
  const credentialLength = Buffer.alloc(2);
  credentialLength.writeUInt16BE(32);
  const cose = encode(new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, x],
    [-3, y],
  ]));
  const prefix = Buffer.concat([
    createHash("sha256").update(customerBiteSaverIosAppId, "utf8").digest(),
    Buffer.from([0x40]),
    counter,
    Buffer.from("appattestdevelop", "ascii"),
    credentialLength,
    credentialId,
  ]);
  const authenticatorData = Buffer.concat([
    prefix,
    cose,
    encode(extensions()),
  ]);
  const parsed = customerBiteSaverAppAttestInternals
    .parseAttestedAuthenticatorData(authenticatorData);
  assert.equal(parsed.counter, 0);
  assert.deepEqual(parsed.aaguid, Buffer.from("appattestdevelop", "ascii"));
  assert.deepEqual(parsed.credentialId, credentialId);
  assert.deepEqual(parsed.publicKeyX963, x963);
  assert.equal(parsed.validationCategory, 3);
  assert.equal(parsed.bundleVersion, "1.0");

  const legacy = Buffer.concat([prefix, cose]);
  const parsedLegacy = customerBiteSaverAppAttestInternals
    .parseAttestedAuthenticatorData(legacy);
  assert.deepEqual(parsedLegacy.publicKeyX963, x963);
  assert.equal(parsedLegacy.validationCategory, null);
  assert.equal(parsedLegacy.bundleVersion, null);

  const wrongFlags = [0, 0x80, 0xc0, 0x41].map((flags) => {
    const invalid = Buffer.from(authenticatorData);
    invalid[32] = flags;
    return invalid;
  });
  for (const invalid of [
    ...wrongFlags,
    Buffer.concat([authenticatorData, encode(null)]),
    Buffer.concat([legacy, encode(null)]),
  ]) {
    assert.throws(
      () => customerBiteSaverAppAttestInternals
        .parseAttestedAuthenticatorData(invalid),
      contractError("permission-denied"),
    );
  }
});

test("Apple's official 2026 authenticator fixture uses flag 0x40 and LE category bytes", () => {
  const authenticatorDataAndChallenge = Buffer.from(
    "9EZtaPketsEGIMt+Y8coMkRoXuHWRntUFg51MXIFfwNAAAAAAGFwcGF0dGVzdAAAAAAAAAAA" +
    "IM4EmPWEg/u02g17LGOlpTj1UtSty5pPqRYZXElhPmVdpQECAyYgASFYIEMyVErPMj23dEQ8" +
    "qvM59W5+lcck+sLBQlnzZeJEVlCyIlggtfsoW89Um8tgWUQS52gqJCfuran7Ut/tCxqxftCf" +
    "qb2id2FwcGxlX2J1bmRsZV92ZXJzaW9uXzAxYTF4HGFwcGxlX3ZhbGlkYXRpb25fY2F0ZWdv" +
    "cnlfMDFEAQAAAGV4YW1wbGVfc2VydmVyX2NoYWxsZW5nZQ==",
    "base64",
  );
  assert.equal(authenticatorDataAndChallenge.length, 250);
  const authenticatorData = authenticatorDataAndChallenge.subarray(0, 226);
  assert.equal(authenticatorData[32], 0x40);
  const parsed = customerBiteSaverAppAttestInternals
    .parseAttestedAuthenticatorData(authenticatorData);
  assert.equal(parsed.validationCategory, 1);
  assert.equal(parsed.bundleVersion, "1");
});

async function syntheticAttestationFixture({
  modern = true,
  duplicateTopKey,
  duplicateStatementKey,
  duplicateCoseKey,
  duplicateExtensionKey,
  alternateCoseKey = false,
} = {}) {
  const algorithm = {name: "ECDSA", namedCurve: "P-256"};
  const rootKeys = await webcrypto.subtle.generateKey(
    algorithm,
    true,
    ["sign", "verify"],
  );
  const intermediateKeys = await webcrypto.subtle.generateKey(
    algorithm,
    true,
    ["sign", "verify"],
  );
  const leafKeys = await webcrypto.subtle.generateKey(
    algorithm,
    true,
    ["sign", "verify"],
  );
  const dates = {
    notBefore: new Date("2026-01-01T00:00:00.000Z"),
    notAfter: new Date("2027-01-01T00:00:00.000Z"),
  };
  const root = await X509CertificateGenerator.createSelfSigned({
    name: "CN=Synthetic App Attest Root",
    keys: rootKeys,
    serialNumber: "01",
    ...dates,
    extensions: [
      new BasicConstraintsExtension(true, 1, true),
      new KeyUsagesExtension(
        KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  }, webcrypto);
  const intermediate = await X509CertificateGenerator.create({
    subject: "CN=Synthetic App Attest Intermediate",
    issuer: "CN=Synthetic App Attest Root",
    publicKey: intermediateKeys.publicKey,
    signingKey: rootKeys.privateKey,
    serialNumber: "02",
    ...dates,
    extensions: [
      new BasicConstraintsExtension(true, 0, true),
      new KeyUsagesExtension(
        KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  }, webcrypto);
  const leafJwk = await webcrypto.subtle.exportKey("jwk", leafKeys.publicKey);
  const x = Buffer.from(leafJwk.x, "base64url");
  const y = Buffer.from(leafJwk.y, "base64url");
  const x963 = Buffer.concat([Buffer.from([4]), x, y]);
  const keyId = createHash("sha256").update(x963).digest();
  const credentialLength = Buffer.alloc(2);
  credentialLength.writeUInt16BE(keyId.length);
  const coseEntries = encodedMapEntries([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, x],
    [-3, y],
  ], duplicateCoseKey);
  if (alternateCoseKey) {
    // An alternate-width encoding of -2 must still collide with its short form.
    coseEntries.unshift([Buffer.from([0x38, 0x01]), encode(x)]);
  }
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(customerBiteSaverIosAppId, "utf8").digest(),
    Buffer.from([0x40]),
    Buffer.alloc(4),
    Buffer.from("appattestdevelop", "ascii"),
    credentialLength,
    keyId,
    rawCborMap(coseEntries),
    ...(modern ? [rawCborMap(encodedMapEntries(
      extensions(), duplicateExtensionKey,
    ))] : []),
  ]);
  const clientDataHash = createHash("sha256")
    .update("synthetic-attestation-client-data")
    .digest();
  const nonce = createHash("sha256").update(Buffer.concat([
    authenticatorData,
    clientDataHash,
  ])).digest();
  const nonceValue = Buffer.concat([
    Buffer.from([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]),
    nonce,
  ]);
  const leaf = await X509CertificateGenerator.create({
    subject: "CN=Synthetic App Attest Credential",
    issuer: "CN=Synthetic App Attest Intermediate",
    publicKey: leafKeys.publicKey,
    signingKey: intermediateKeys.privateKey,
    serialNumber: "03",
    ...dates,
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      new Extension(
        "1.2.840.113635.100.8.2",
        false,
        nonceValue,
      ),
    ],
  }, webcrypto);
  const statement = rawCborMap(encodedMapEntries([
    ["x5c", [
      Buffer.from(leaf.rawData),
      Buffer.from(intermediate.rawData),
    ]],
    ["receipt", Buffer.alloc(64, 0x71)],
  ], duplicateStatementKey));
  const topEntries = [
    [encode("fmt"), encode("apple-appattest")],
    [encode("attStmt"), statement],
    [encode("authData"), encode(authenticatorData)],
  ];
  if (duplicateTopKey !== undefined) {
    const index = ["fmt", "attStmt", "authData"].indexOf(duplicateTopKey);
    assert.ok(index >= 0);
    topEntries.unshift(topEntries[index]);
  }
  const attestationObject = rawCborMap(topEntries);
  return {
    appAttestKeyId: keyId.toString("base64url"),
    attestationObject,
    clientDataHash,
    leafPublicKeySpki: Buffer.from(
      await webcrypto.subtle.exportKey("spki", leafKeys.publicKey),
    ),
    rootDer: Buffer.from(root.rawData),
  };
}

test("App Attest attestation validates synthetic CBOR, chain, nonce, RP, environment, key relationship, and extensions", async () => {
  const fixture = await syntheticAttestationFixture();
  const verifier = new CustomerBiteSaverAppAttestVerifier({
    ...policy,
    trustedRootCertificatesDer: [fixture.rootDer],
  });
  const verified = verifier.verifyAttestation({
    attestationObject: fixture.attestationObject,
    appAttestKeyId: fixture.appAttestKeyId,
    clientDataHash: fixture.clientDataHash,
    nowMillis: Date.parse("2026-09-17T12:00:00.000Z"),
  });
  assert.equal(
    verified.appAttestPublicKeySpki,
    fixture.leafPublicKeySpki.toString("base64url"),
  );
  assert.equal(verified.environment, "development");
  assert.equal(verified.initialAssertionCounter, 0);
  assert.equal(verified.validationCategory, 3);
  assert.equal(verified.bundleVersion, "1.0");

  assert.throws(() => verifier.verifyAttestation({
    attestationObject: fixture.attestationObject,
    appAttestKeyId: fixture.appAttestKeyId,
    clientDataHash: Buffer.alloc(32, 0x7f),
    nowMillis: Date.parse("2026-09-17T12:00:00.000Z"),
  }), contractError("permission-denied"));
  assert.throws(() => new CustomerBiteSaverAppAttestVerifier({
    ...policy,
    environment: "production",
    trustedRootCertificatesDer: [fixture.rootDer],
  }).verifyAttestation({
    attestationObject: fixture.attestationObject,
    appAttestKeyId: fixture.appAttestKeyId,
    clientDataHash: fixture.clientDataHash,
    nowMillis: Date.parse("2026-09-17T12:00:00.000Z"),
  }), contractError("permission-denied"));
});

test("App Attest attestation validates a legacy no-extension authenticator", async () => {
  const fixture = await syntheticAttestationFixture({modern: false});
  const verifier = new CustomerBiteSaverAppAttestVerifier({
    ...policy,
    trustedRootCertificatesDer: [fixture.rootDer],
  });
  const verified = verifier.verifyAttestation({
    attestationObject: fixture.attestationObject,
    appAttestKeyId: fixture.appAttestKeyId,
    clientDataHash: fixture.clientDataHash,
    nowMillis: Date.parse("2026-09-17T12:00:00.000Z"),
  });
  assert.equal(verified.validationCategory, null);
  assert.equal(verified.bundleVersion, null);
});

test("App Attest attestation rejects duplicates in every accepted security map", async () => {
  for (const options of [
    {duplicateTopKey: "fmt"},
    {duplicateTopKey: "attStmt"},
    {duplicateTopKey: "authData"},
    {duplicateStatementKey: "x5c"},
    {duplicateStatementKey: "receipt"},
    {duplicateCoseKey: 1},
    {duplicateCoseKey: 3},
    {duplicateCoseKey: -1},
    {duplicateCoseKey: -2},
    {duplicateCoseKey: -3},
    {alternateCoseKey: true},
    {duplicateExtensionKey: "apple_validation_category_01"},
    {duplicateExtensionKey: "apple_bundle_version_01"},
  ]) {
    // The synthetic trusted chain's nonce covers the exact malformed COSE and
    // extension bytes, so this reaches the production parsing boundary.
    const fixture = await syntheticAttestationFixture(options);
    const verifier = new CustomerBiteSaverAppAttestVerifier({
      ...policy,
      trustedRootCertificatesDer: [fixture.rootDer],
    });
    assert.throws(() => verifier.verifyAttestation({
      attestationObject: fixture.attestationObject,
      appAttestKeyId: fixture.appAttestKeyId,
      clientDataHash: fixture.clientDataHash,
      nowMillis: Date.parse("2026-09-17T12:00:00.000Z"),
    }), contractError("permission-denied"), JSON.stringify(options));
  }
});
