"use strict";

const assert = require("node:assert/strict");
const {
  createHash,
  generateKeyPairSync,
  KeyObject,
  sign,
  webcrypto,
} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
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
  buildCustomerBiteSaverDeviceProofTranscript,
  customerBiteSaverCredentialId,
  customerBiteSaverDeviceProofTranscriptSha256,
  customerBiteSaverIosAssertionClientDataHash,
  encodeCustomerBiteSaverDeviceProofTranscript,
  parseCustomerBiteSaverDeviceProof,
} = require("../lib/customer_bitesaver_device_proof_contract.js");
const {
  createCustomerBiteSaverRequestDeviceEvidenceVerifier,
} = require("../lib/customer_bitesaver_device_evidence_verifier.js");
const {
  issueCustomerBiteSaverDeviceUseChallenge,
  loadCustomerBiteSaverDeviceInstallation,
  privateCustomerBiteSaverDeviceChallengeCollection,
} = require("../lib/customer_bitesaver_device_proof_store.js");
const {
  CustomerBiteSaverAppAttestVerifier,
  customerBiteSaverIosAppId,
} = require("../lib/customer_bitesaver_app_attest.js");
const {
  customerBiteSaverCombinedUseRequestFingerprint,
  executeCustomerBiteSaverDeviceBoundUse,
  parseCustomerBiteSaverCombinedUseRequest,
} = require("../lib/customer_bitesaver_device_usage_core.js");
const {
  customerBiteSaverSearchSchemaVersion,
  CustomerBiteSaverContractError,
} = require("../lib/customer_bitesaver_search_contract.js");

const now = Date.parse("2026-09-17T12:00:00.000Z");
const rootKey = Buffer.alloc(32, 0x42);
const discoveryKey = Buffer.alloc(32, 0x43);
const restaurantId = `bsr_${Buffer.alloc(32, 11).toString("base64url")}`;
const offerId = `bso_${Buffer.alloc(32, 12).toString("base64url")}`;

class MemoryDatabase {
  constructor() {
    this.documents = new Map();
    this.queue = Promise.resolve();
  }

  stored(path) {
    const data = this.documents.get(path);
    return data === undefined ? null : {
      id: path.slice(path.lastIndexOf("/") + 1),
      path,
      data,
    };
  }

  async getDocument(path) {
    return this.stored(path);
  }

  async getDocuments(paths) {
    return paths.map((entry) => this.stored(entry));
  }

  async queryDocuments() {
    throw new Error("not used");
  }

  async commitWrites() {
    throw new Error("not used");
  }

  async runTransaction(operation) {
    const prior = this.queue;
    let release;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const staged = [];
      const result = await operation({
        getDocument: async (entry) => this.stored(entry),
        getDocuments: async (entries) => entries.map((entry) => this.stored(entry)),
        createDocument: (entry, data) => staged.push({type: "create", entry, data}),
        setDocument: (entry, data) => staged.push({type: "set", entry, data}),
        deleteDocument: (entry) => staged.push({type: "delete", entry}),
      });
      for (const write of staged) {
        if (write.type === "create" && this.documents.has(write.entry)) {
          throw new Error("create collision");
        }
        if (write.type === "delete") this.documents.delete(write.entry);
        else this.documents.set(write.entry, write.data);
      }
      return result;
    } finally {
      release();
    }
  }
}

function combinedRequest() {
  return parseCustomerBiteSaverCombinedUseRequest({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    logicalRequestId: "device-evidence-request-0001",
    restaurantId,
    offerId,
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    currentCoordinates: null,
    origin: {
      kind: "discovery",
      clientInstanceId: "device-evidence-client-0001",
      sessionId: `bss_${Buffer.alloc(32, 13).toString("base64url")}`,
      capability: "synthetic-capability",
      criteriaFingerprint: "c".repeat(64),
      offerOccurrence: "synthetic-occurrence",
      guestStateRevision: 1,
    },
  });
}

function authority() {
  return async (request) => Object.freeze({
    origin: request.origin.kind,
    signedUserId: null,
    async readInTransaction() {
      return Object.freeze({
        kind: "authorized",
        origin: request.origin.kind,
        signedUserId: null,
        restaurantId: request.restaurantId,
        offerId: request.offerId,
        freshUseExpiresAtMillis: now + 60_000,
        recoveryExpiresAtMillis: now + 60_000,
        source: Object.freeze({
          offer: Object.freeze({
            isActive: true,
            active: true,
            usageRule: "Unlimited",
            isProximityOnly: false,
          }),
          usagePolicy: "unlimited",
          timeZone: request.timeZone,
          utcOffsetMinutes: request.utcOffsetMinutes,
          locationMode: "current",
          restaurantCoordinates: {latitude: 28.5383, longitude: -81.3792},
          currentCoordinates: request.currentCoordinates,
        }),
      });
    },
  });
}

function contractError(code) {
  return (error) => error instanceof CustomerBiteSaverContractError &&
    error.code === code;
}

test("request-scoped Android enrollment evidence integrates with the committed core and exact replay", async () => {
  const database = new MemoryDatabase();
  const request = combinedRequest();
  const challenge = await issueCustomerBiteSaverDeviceUseChallenge({
    database,
    platform: "android",
    request,
    authenticatedUserId: null,
    nowMillis: now,
    randomSource: (size) => Buffer.alloc(size, 0x19),
  });
  const {privateKey, publicKey} = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKeySpki = publicKey.export({format: "der", type: "spki"});
  const publicKeyHash = createHash("sha256").update(publicKeySpki).digest();
  const credentialId = customerBiteSaverCredentialId("android", publicKeyHash);
  const transcript = buildCustomerBiteSaverDeviceProofTranscript({
    challenge,
    proofKind: "androidEnrollment",
    credentialId,
    androidInstallationPublicKeySha256: publicKeyHash,
    androidSsaid: "0123456789abcdef",
  });
  const signature = sign(
    "sha256",
    encodeCustomerBiteSaverDeviceProofTranscript(transcript),
    privateKey,
  );
  const proof = parseCustomerBiteSaverDeviceProof({
    schemaVersion: 1,
    kind: "androidEnrollment",
    credentialId,
    installationPublicKeySpki: publicKeySpki.toString("base64url"),
    androidSsaid: "0123456789abcdef",
    possessionSignature: signature.toString("base64url"),
    integrityToken: "synthetic.integrity.token",
  });
  let providerCalls = 0;
  const clock = {value: now + 1};
  const dependencies = {
    database,
    rootKey,
    now: () => clock.value,
    playIntegrityVerifier: {
      async verify(input) {
        providerCalls += 1;
        assert.equal(
          input.expectedRequestHash,
          customerBiteSaverDeviceProofTranscriptSha256(transcript)
            .toString("base64url"),
        );
        return Object.freeze({
          qualification: Object.freeze({
            packageName: "com.colesmart.bitestar",
            versionCode: "42",
            certificateSha256Digests: Object.freeze([
              Buffer.alloc(32, 0x61).toString("base64url"),
            ]),
            appRecognitionVerdict: "PLAY_RECOGNIZED",
            deviceRecognitionVerdicts: Object.freeze([
              "MEETS_DEVICE_INTEGRITY",
            ]),
            licensingVerdict: "UNEVALUATED",
          }),
          requestTimeMillis: now,
          validUntilMillis: now + 120_000,
        });
      },
    },
    appAttestVerifier: {
      verifyAttestation() {
        throw new Error("iOS verifier must not run");
      },
      verifyAssertion() {
        throw new Error("iOS verifier must not run");
      },
    },
  };
  const coreContext = () => ({
    database,
    discoveryKey,
    identity: {authUid: null, authIsAnonymous: false},
    now: dependencies.now,
    randomSource: (size) => Buffer.alloc(size, 0x71),
    deviceEvidenceVerifier:
      createCustomerBiteSaverRequestDeviceEvidenceVerifier({
        dependencies,
        challengeId: challenge.challengeId,
        proof,
      }),
  });
  const first = await executeCustomerBiteSaverDeviceBoundUse(
    request,
    coreContext(),
    authority(),
  );
  assert.equal(first.status, "unlimited");
  assert.equal(providerCalls, 1);

  clock.value = now + 2;
  const retry = await executeCustomerBiteSaverDeviceBoundUse(
    request,
    coreContext(),
    authority(),
  );
  assert.deepEqual(retry, first);
  assert.equal(providerCalls, 1, "exact retry never calls Play Integrity again");

  const persisted = JSON.stringify([...database.documents.values()]);
  assert.equal(persisted.includes("0123456789abcdef"), false);
  assert.equal(persisted.includes("synthetic.integrity.token"), false);

  const changedSignature = Buffer.from(signature);
  changedSignature[changedSignature.length - 1] ^= 1;
  const changedProof = parseCustomerBiteSaverDeviceProof({
    ...proof,
    possessionSignature: changedSignature.toString("base64url"),
  });
  clock.value = now + 3;
  const changedVerifier = createCustomerBiteSaverRequestDeviceEvidenceVerifier({
    dependencies,
    challengeId: challenge.challengeId,
    proof: changedProof,
  });
  await assert.rejects(changedVerifier.verify({
    purpose: "combinedCouponUse",
    requestFingerprint: customerBiteSaverCombinedUseRequestFingerprint(request),
    authenticatedUserId: null,
    origin: "discovery",
    nowMillis: now + 3,
  }), contractError("permission-denied"));
  assert.equal(providerCalls, 1);
});

test("expiry during store reads or provider verification cannot mutate state", async () => {
  for (const expiry of ["read", "challenge", "provider"]) {
    const database = new MemoryDatabase();
    const request = combinedRequest();
    const challenge = await issueCustomerBiteSaverDeviceUseChallenge({
      database,
      platform: "android",
      request,
      authenticatedUserId: null,
      nowMillis: now,
      randomSource: (size) => Buffer.alloc(size, expiry === "challenge" ? 0x31 : 0x32),
    });
    const {privateKey, publicKey} = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicKeySpki = publicKey.export({format: "der", type: "spki"});
    const publicKeyHash = createHash("sha256").update(publicKeySpki).digest();
    const credentialId = customerBiteSaverCredentialId("android", publicKeyHash);
    const transcript = buildCustomerBiteSaverDeviceProofTranscript({
      challenge,
      proofKind: "androidEnrollment",
      credentialId,
      androidInstallationPublicKeySha256: publicKeyHash,
      androidSsaid: "0123456789abcdef",
    });
    const proof = parseCustomerBiteSaverDeviceProof({
      schemaVersion: 1,
      kind: "androidEnrollment",
      credentialId,
      installationPublicKeySpki: publicKeySpki.toString("base64url"),
      androidSsaid: "0123456789abcdef",
      possessionSignature: sign(
        "sha256",
        encodeCustomerBiteSaverDeviceProofTranscript(transcript),
        privateKey,
      ).toString("base64url"),
      integrityToken: "synthetic.delayed.integrity.token",
    });
    const clock = {value: now + 1};
    const providerValidUntilMillis = expiry === "provider"
      ? now + 10
      : challenge.expiresAtMillis + 60_000;
    const before = JSON.stringify([...database.documents.entries()]);
    let providerCalls = 0;
    if (expiry === "read") {
      clock.value = challenge.expiresAtMillis - 1;
      database.getDocument = async (path) => {
        const result = database.stored(path);
        await Promise.resolve();
        clock.value = challenge.expiresAtMillis;
        return result;
      };
    }
    const dependencies = {
      database,
      rootKey,
      now: () => clock.value,
      playIntegrityVerifier: {
        async verify() {
          providerCalls++;
          clock.value = expiry === "provider"
            ? providerValidUntilMillis
            : challenge.expiresAtMillis;
          return Object.freeze({
            qualification: Object.freeze({
              packageName: "com.colesmart.bitestar",
              versionCode: "42",
              certificateSha256Digests: Object.freeze([
                Buffer.alloc(32, 0x61).toString("base64url"),
              ]),
              appRecognitionVerdict: "PLAY_RECOGNIZED",
              deviceRecognitionVerdicts: Object.freeze([
                "MEETS_DEVICE_INTEGRITY",
              ]),
              licensingVerdict: "UNEVALUATED",
            }),
            requestTimeMillis: now,
            validUntilMillis: providerValidUntilMillis,
          });
        },
      },
      appAttestVerifier: {
        verifyAttestation() {
          throw new Error("iOS verifier must not run");
        },
        verifyAssertion() {
          throw new Error("iOS verifier must not run");
        },
      },
    };
    const verifier = createCustomerBiteSaverRequestDeviceEvidenceVerifier({
      dependencies,
      challengeId: challenge.challengeId,
      proof,
    });
    await assert.rejects(verifier.verify({
      purpose: "combinedCouponUse",
      requestFingerprint: customerBiteSaverCombinedUseRequestFingerprint(request),
      authenticatedUserId: null,
      origin: "discovery",
      nowMillis: now + 1,
    }), contractError("permission-denied"), expiry);
    assert.equal(database.documents.size, 1, expiry);
    assert.equal([...database.documents.values()][0].state, "issued", expiry);
    assert.equal(JSON.stringify([...database.documents.entries()]), before, expiry);
    assert.equal(providerCalls, expiry === "read" ? 0 : 1, expiry);
  }
});

test("future callable factories exist but deployed index has no export or secret binding", () => {
  const sourceIndex = fs.readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const compiledIndex = fs.readFileSync(
    path.resolve(__dirname, "../lib/index.js"),
    "utf8",
  );
  for (const publicName of [
    "issueCustomerBiteSaverDeviceUseChallenge",
    "useCustomerBiteSaverCoupon",
    "BITESAVER_DEVICE_ROOT_KEY_V1",
  ]) {
    assert.equal(sourceIndex.includes(publicName), false, publicName);
    assert.equal(compiledIndex.includes(publicName), false, publicName);
  }
  const futureModule = require("../lib/customer_bitesaver_device_usage_callable.js");
  assert.equal(
    futureModule.issueCustomerBiteSaverDeviceUseChallengeCallableName,
    "issueCustomerBiteSaverDeviceUseChallenge",
  );
  assert.equal(
    futureModule.useCustomerBiteSaverCouponCallableName,
    "useCustomerBiteSaverCoupon",
  );
  assert.equal(typeof futureModule.createUseCustomerBiteSaverCouponHandler, "function");
});

async function syntheticIosRecoveryProofs() {
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
  const algorithm = {name: "ECDSA", namedCurve: "P-256"};
  const keyPair = () => webcrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const rootKeys = await keyPair();
  const intermediateKeys = await keyPair();
  const validity = {
    notBefore: new Date("2026-01-01T00:00:00Z"),
    notAfter: new Date("2027-01-01T00:00:00Z"),
  };
  const root = await X509CertificateGenerator.createSelfSigned({
    name: "CN=Synthetic Recovery Root",
    keys: rootKeys,
    serialNumber: "01",
    ...validity,
    extensions: [
      new BasicConstraintsExtension(true, 1, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  }, webcrypto);
  const intermediate = await X509CertificateGenerator.create({
    subject: "CN=Synthetic Recovery Intermediate",
    issuer: "CN=Synthetic Recovery Root",
    publicKey: intermediateKeys.publicKey,
    signingKey: rootKeys.privateKey,
    serialNumber: "02",
    ...validity,
    extensions: [
      new BasicConstraintsExtension(true, 0, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  }, webcrypto);
  const recovery = generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const recoveryJwk = recovery.publicKey.export({format: "jwk"});
  const recoveryX963 = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(recoveryJwk.x, "base64url"),
    Buffer.from(recoveryJwk.y, "base64url"),
  ]);
  const credentialId = customerBiteSaverCredentialId("ios", sha256(recoveryX963));
  const transcript = (challenge, proofKind, keyId) =>
    buildCustomerBiteSaverDeviceProofTranscript({
      challenge,
      proofKind,
      credentialId,
      iosRecoveryPublicKeyX963: recoveryX963,
      iosAppAttestKeyId: keyId,
    });
  const extensionMap = () => new Map([
    ["apple_validation_category_01", Buffer.from([3, 0, 0, 0])],
    ["apple_bundle_version_01", "1.0"],
  ]);
  const appAttestVerifier = new CustomerBiteSaverAppAttestVerifier({
    appId: customerBiteSaverIosAppId,
    environment: "development",
    trustedRootCertificatesDer: [Buffer.from(root.rawData)],
    allowedValidationCategories: new Set([3]),
    allowedBundleVersions: new Set(["1.0"]),
  });
  return {
    credentialId,
    recoveryX963,
    appAttestVerifier,
    async enrollment(challenge) {
      const keys = await keyPair();
      const jwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
      const x = Buffer.from(jwk.x, "base64url");
      const y = Buffer.from(jwk.y, "base64url");
      const keyIdBytes = sha256(Buffer.concat([Buffer.from([4]), x, y]));
      const keyId = keyIdBytes.toString("base64url");
      const boundTranscript = transcript(challenge, "iosEnrollment", keyId);
      const authenticatorData = Buffer.concat([
        sha256(customerBiteSaverIosAppId),
        Buffer.from([0x40]),
        Buffer.alloc(4),
        Buffer.from("appattestdevelop"),
        Buffer.from([0, 32]),
        keyIdBytes,
        encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]])),
        encode(extensionMap()),
      ]);
      const nonce = sha256(Buffer.concat([
        authenticatorData,
        customerBiteSaverDeviceProofTranscriptSha256(boundTranscript),
      ]));
      const leaf = await X509CertificateGenerator.create({
        subject: "CN=Synthetic Recovery Credential",
        issuer: "CN=Synthetic Recovery Intermediate",
        publicKey: keys.publicKey,
        signingKey: intermediateKeys.privateKey,
        serialNumber: "03",
        ...validity,
        extensions: [
          new BasicConstraintsExtension(false, undefined, true),
          new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
          new Extension("1.2.840.113635.100.8.2", false, Buffer.concat([
            Buffer.from([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]),
            nonce,
          ])),
        ],
      }, webcrypto);
      const attestationObject = encode(new Map([
        ["fmt", "apple-appattest"],
        ["attStmt", new Map([
          ["x5c", [Buffer.from(leaf.rawData), Buffer.from(intermediate.rawData)]],
          ["receipt", Buffer.alloc(64, 0x71)],
        ])],
        ["authData", authenticatorData],
      ]));
      return {
        keyId,
        privateKey: KeyObject.from(keys.privateKey),
        proof: parseCustomerBiteSaverDeviceProof({
          schemaVersion: 1,
          kind: "iosEnrollment",
          credentialId,
          recoveryPublicKeyX963: recoveryX963.toString("base64url"),
          appAttestKeyId: keyId,
          possessionSignature: sign("sha256",
            encodeCustomerBiteSaverDeviceProofTranscript(boundTranscript),
            recovery.privateKey).toString("base64url"),
          attestationObject: attestationObject.toString("base64url"),
        }),
      };
    },
    assertion(challenge, enrolled, counter) {
      const boundTranscript = transcript(challenge, "iosUse", enrolled.keyId);
      const possessionSignature = sign("sha256",
        encodeCustomerBiteSaverDeviceProofTranscript(boundTranscript), recovery.privateKey);
      const clientDataHash = customerBiteSaverIosAssertionClientDataHash(
        customerBiteSaverDeviceProofTranscriptSha256(boundTranscript), possessionSignature);
      const encodedCounter = Buffer.alloc(4);
      encodedCounter.writeUInt32BE(counter);
      const authenticatorData = Buffer.concat([
        sha256(customerBiteSaverIosAppId), Buffer.from([0x40]), encodedCounter,
        encode(extensionMap()),
      ]);
      const signature = sign("sha256", sha256(Buffer.concat([
        authenticatorData, clientDataHash,
      ])), enrolled.privateKey);
      return parseCustomerBiteSaverDeviceProof({
        schemaVersion: 1,
        kind: "iosUse",
        credentialId,
        appAttestKeyId: enrolled.keyId,
        possessionSignature: possessionSignature.toString("base64url"),
        assertionObject: encode(new Map([
          ["signature", signature], ["authenticatorData", authenticatorData],
        ])).toString("base64url"),
      });
    },
  };
}

test("real iOS verifier rejects delayed older recovery and preserves current Ka counters and stable Kd", async () => {
  const database = new MemoryDatabase();
  const request = combinedRequest();
  const clock = {value: now};
  let entropy = 0;
  const issue = () => issueCustomerBiteSaverDeviceUseChallenge({
    database,
    platform: "ios",
    request,
    authenticatedUserId: null,
    nowMillis: clock.value,
    randomSource: (size) => Buffer.alloc(size, ++entropy),
  });
  const fixture = await syntheticIosRecoveryProofs();
  const dependencies = {
    database,
    rootKey,
    now: () => clock.value,
    appAttestVerifier: fixture.appAttestVerifier,
    playIntegrityVerifier: {verify() { throw new Error("Android provider must not run"); }},
  };
  const verify = (challenge, proof, scoped = dependencies) =>
    createCustomerBiteSaverRequestDeviceEvidenceVerifier({
      dependencies: scoped, challengeId: challenge.challengeId, proof,
    }).verify({
      purpose: "combinedCouponUse",
      requestFingerprint: challenge.requestFingerprint,
      authenticatedUserId: null,
      origin: "discovery",
      nowMillis: clock.value,
    });
  const installed = () => loadCustomerBiteSaverDeviceInstallation({
    database, rootKey, platform: "ios", credentialId: fixture.credentialId,
  });

  const aChallenge = await issue();
  const a = await fixture.enrollment(aChallenge);
  clock.value = now + 10;
  const bChallenge = await issue();
  const b = await fixture.enrollment(bChallenge);
  assert.notEqual(a.keyId, b.keyId);

  let enterTransaction;
  let releaseTransaction;
  const entered = new Promise((resolve) => { enterTransaction = resolve; });
  const held = new Promise((resolve) => { releaseTransaction = resolve; });
  clock.value = now + 20;
  const pendingA = verify(aChallenge, a.proof, {
    ...dependencies,
    database: {
      getDocument: (entry) => database.getDocument(entry),
      async runTransaction(operation) {
        // Entry here proves A passed actual Kd possession and App Attest crypto.
        enterTransaction();
        await held;
        return database.runTransaction(operation);
      },
    },
  });
  await entered;
  const rejectedA = assert.rejects(pendingA, contractError("permission-denied"));
  clock.value = now + 30;
  const bEvidence = await verify(bChallenge, b.proof);
  const firstInstallation = await installed();
  assert.equal(firstInstallation.appAttestKeyId, b.keyId);
  assert.equal(firstInstallation.assertionCounter, 0);

  clock.value = now + 40;
  const bUse1Challenge = await issue();
  await verify(bUse1Challenge, fixture.assertion(bUse1Challenge, b, 1));
  assert.equal((await installed()).assertionCounter, 1);
  const beforeDelayedA = [...database.documents.entries()];
  clock.value = now + 50;
  releaseTransaction();
  await rejectedA;
  assert.deepEqual([...database.documents.entries()], beforeDelayedA,
    "stale recovery must mutate neither challenge nor installation");
  assert.equal(database.documents.get(
    `${privateCustomerBiteSaverDeviceChallengeCollection}/${aChallenge.challengeId}`,
  ).state, "issued");
  assert.equal((await installed()).appAttestKeyId, b.keyId);

  clock.value = now + 60;
  const bUse2Challenge = await issue();
  await verify(bUse2Challenge, fixture.assertion(bUse2Challenge, b, 2));
  assert.equal((await installed()).assertionCounter, 2);

  clock.value = now + 70;
  const cChallenge = await issue();
  const c = await fixture.enrollment(cChallenge);
  assert.notEqual(c.keyId, b.keyId);
  clock.value = now + 80;
  const cEvidence = await verify(cChallenge, c.proof);
  const recovered = await installed();
  assert.equal(recovered.appAttestKeyId, c.keyId);
  assert.equal(recovered.assertionCounter, 0,
    "fresh authorized Ka begins at its legitimate initial counter");
  assert.equal(recovered.credentialId, firstInstallation.credentialId);
  assert.equal(recovered.deviceRef, firstInstallation.deviceRef);
  assert.equal(recovered.credentialPublicKey, fixture.recoveryX963.toString("base64url"));
  assert.equal(recovered.createdAtMillis, firstInstallation.createdAtMillis);
  assert.equal(recovered.enrollmentIssuedAtMillis, cChallenge.issuedAtMillis);
  assert.equal(recovered.enrollmentChallengeId, cChallenge.challengeId);
  assert.equal(bEvidence.deviceSubject, firstInstallation.deviceRef);
  assert.equal(cEvidence.deviceSubject, bEvidence.deviceSubject);

  const beforeReplay = [...database.documents.entries()];
  clock.value = now + 90;
  assert.deepEqual(await verify(bChallenge, b.proof), bEvidence);
  assert.deepEqual([...database.documents.entries()], beforeReplay,
    "already-accepted B replay cannot roll C back");

  clock.value = now + 100;
  const cUse1Challenge = await issue();
  const cUse1 = fixture.assertion(cUse1Challenge, c, 1);
  await verify(cUse1Challenge, cUse1);
  assert.equal((await installed()).assertionCounter, 1);
  await verify(cUse1Challenge, cUse1);
  assert.equal((await installed()).assertionCounter, 1);

  clock.value = now + 110;
  const staleCounterChallenge = await issue();
  const beforeStaleCounter = [...database.documents.entries()];
  await assert.rejects(verify(staleCounterChallenge,
    fixture.assertion(staleCounterChallenge, c, 1)), contractError("permission-denied"));
  assert.deepEqual([...database.documents.entries()], beforeStaleCounter);
  clock.value = now + 120;
  const cUse2Challenge = await issue();
  await verify(cUse2Challenge, fixture.assertion(cUse2Challenge, c, 2));
  assert.equal((await installed()).assertionCounter, 2);
  assert.ok(clock.value < aChallenge.expiresAtMillis,
    "all delayed/replayed proofs were still within authoritative expiry");
});
