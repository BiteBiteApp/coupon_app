"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  customerBiteSaverCredentialId,
} = require("../lib/customer_bitesaver_device_proof_contract.js");
const {
  deriveCustomerBiteSaverAndroidDeviceRef,
  deriveCustomerBiteSaverIosDeviceRef,
  customerBiteSaverInstallationRecordId,
} = require("../lib/customer_bitesaver_device_identity.js");
const {
  commitCustomerBiteSaverVerifiedDeviceProof,
  issueCustomerBiteSaverDeviceUseChallenge,
  loadCustomerBiteSaverDeviceChallenge,
  loadCustomerBiteSaverDeviceInstallation,
  privateCustomerBiteSaverDeviceChallengeCollection,
  privateCustomerBiteSaverDeviceInstallationCollection,
} = require("../lib/customer_bitesaver_device_proof_store.js");
const {reserveCustomerBiteSaverDeviceChallengeAdmission} = require(
  "../lib/customer_bitesaver_device_challenge_admission.js",
);
const {challengeAuthorityFixture} = require(
  "./helpers/customer_bitesaver_challenge_authority_fixture.js",
);
const {
  CustomerBiteSaverContractError,
} = require("../lib/customer_bitesaver_search_contract.js");

const now = Date.parse("2026-09-17T12:00:00.000Z");
const rootKey = Buffer.alloc(32, 0x42);

class MemoryDatabase {
  constructor() {
    this.documents = new Map();
    this.queue = Promise.resolve();
    this.retryHook = null;
  }

  stored(path) {
    const data = this.documents.get(path);
    return data === undefined ? null : Object.freeze({
      id: path.slice(path.lastIndexOf("/") + 1),
      path,
      data,
    });
  }

  async getDocument(path) {
    return this.stored(path);
  }

  async getDocuments(paths) {
    return paths.map((path) => this.stored(path));
  }

  async queryDocuments() {
    throw new Error("not used");
  }

  async commitWrites() {
    throw new Error("not used");
  }

  retryNextTransaction(hook) {
    this.retryHook = hook;
  }

  async runTransaction(operation) {
    const prior = this.queue;
    let release;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const attempt = async () => {
        const staged = [];
        const result = await operation({
          getDocument: async (path) => this.stored(path),
          getDocuments: async (paths) => paths.map((path) => this.stored(path)),
          createDocument: (path, data) => staged.push({type: "create", path, data}),
          setDocument: (path, data) => staged.push({type: "set", path, data}),
          deleteDocument: (path) => staged.push({type: "delete", path}),
        });
        return {result, staged};
      };
      let committed = await attempt();
      if (this.retryHook !== null) {
        const hook = this.retryHook;
        this.retryHook = null;
        hook();
        committed = await attempt();
      }
      for (const write of committed.staged) {
        if (write.type === "create" && this.documents.has(write.path)) {
          throw new Error("create collision");
        }
        if (write.type === "delete") this.documents.delete(write.path);
        else this.documents.set(write.path, write.data);
      }
      return committed.result;
    } finally {
      release();
    }
  }
}

let entropySequence = 1;
async function issue(database, platform, issuedAt = now) {
  const byte = entropySequence++;
  const fixture = challengeAuthorityFixture({database, nowMillis: issuedAt});
  const admission = await reserveCustomerBiteSaverDeviceChallengeAdmission({
    request: fixture.request, platform,
    context: {...fixture.context, randomSource: (size) => Buffer.alloc(size, byte)},
  });
  return issueCustomerBiteSaverDeviceUseChallenge({
    database,
    platform,
    request: fixture.request,
    admissionHandle: admission.admissionHandle,
    permit: admission.permit,
    authenticatedUserId: null,
    now: () => issuedAt,
    randomSource: (size) => Buffer.alloc(size, byte),
  });
}

function contractError(code) {
  return (error) => error instanceof CustomerBiteSaverContractError &&
    error.code === code;
}

const androidKeyHash = Buffer.alloc(32, 0x31);
const androidCredentialId = customerBiteSaverCredentialId(
  "android",
  androidKeyHash,
);
const androidDeviceRef = deriveCustomerBiteSaverAndroidDeviceRef({
  rootKey,
  androidSsaid: "0123456789abcdef",
});
const androidEnrollment = Object.freeze({
  platform: "android",
  credentialId: androidCredentialId,
  deviceRef: androidDeviceRef,
  credentialPublicKey: Buffer.alloc(91, 0x44).toString("base64url"),
  credentialPublicKeySha256: androidKeyHash.toString("hex"),
  qualification: Object.freeze({
    packageName: "com.colesmart.bitestar",
    versionCode: "42",
    certificateSha256Digests: Object.freeze([
      Buffer.alloc(32, 0x51).toString("base64url"),
    ]),
    appRecognitionVerdict: "PLAY_RECOGNIZED",
    deviceRecognitionVerdicts: Object.freeze(["MEETS_DEVICE_INTEGRITY"]),
    licensingVerdict: "UNEVALUATED",
  }),
});

test("dedicated root derivations are stable, separated, and private", () => {
  assert.equal(
    androidDeviceRef,
    "bsd_pYC7NSlDt56LQZQIrVjdN3c1fU4woSGJxSUdiXIDUTI",
  );
  const recoveryKey = Buffer.concat([Buffer.from([4]), Buffer.from([...Array(64).keys()])]);
  assert.equal(
    deriveCustomerBiteSaverIosDeviceRef({
      rootKey,
      recoveryPublicKeyX963: recoveryKey,
    }),
    "bsd_HW_NPfLRYSqg8dHqUYCARbcxvo0xd6JLHho7m-IP4R0",
  );
  assert.equal(
    customerBiteSaverInstallationRecordId({
      rootKey,
      platform: "android",
      credentialId: "bsic_YcxipHbd8t0dF7rGAx_n9Q_XEbD0WVoVDuhK_wudtPI",
    }),
    "bsdi_d7PZQvULFO8Qzx53DAlB38B3ljlXkPJQ4Q7ZV3xCBqE",
  );
  assert.notEqual(androidDeviceRef.slice(4), androidCredentialId.slice(5));
});

test("challenge issue, first verification, and exact ambiguous retry are atomic", async () => {
  const database = new MemoryDatabase();
  const challenge = await issue(database, "android");
  const initial = await loadCustomerBiteSaverDeviceChallenge({
    database,
    challengeId: challenge.challengeId,
    nowMillis: now,
  });
  assert.equal(initial.state, "issued");
  const proofDigest = "a".repeat(64);
  const first = await commitCustomerBiteSaverVerifiedDeviceProof({
    database,
    rootKey,
    challenge,
    proofDigest,
    credentialId: androidCredentialId,
    deviceRef: androidDeviceRef,
    now: () => now + 1,
    enrollment: androidEnrollment,
  });
  assert.equal(first.replayed, false);
  const retry = await commitCustomerBiteSaverVerifiedDeviceProof({
    database,
    rootKey,
    challenge,
    proofDigest,
    credentialId: androidCredentialId,
    deviceRef: androidDeviceRef,
    now: () => now + 2,
  });
  assert.equal(retry.replayed, true);
  assert.equal(retry.validFromMillis, now);
  await assert.rejects(
    commitCustomerBiteSaverVerifiedDeviceProof({
      database,
      rootKey,
      challenge,
      proofDigest: "b".repeat(64),
      credentialId: androidCredentialId,
      deviceRef: androidDeviceRef,
      now: () => now + 3,
    }),
    contractError("permission-denied"),
  );
  const install = await loadCustomerBiteSaverDeviceInstallation({
    database,
    rootKey,
    platform: "android",
    credentialId: androidCredentialId,
  });
  assert.equal(install.deviceRef, androidDeviceRef);

  const persisted = JSON.stringify([...database.documents.values()]);
  const {restaurantId, offerId} = challengeAuthorityFixture({
    database: {documents: new Map()}, nowMillis: now,
  }).request;
  for (const privacyCanary of [
    "0123456789abcdef",
    "androidSsaid",
    "integrityToken",
    "ownerId",
    "accountIds",
    restaurantId,
    offerId,
  ]) {
    assert.equal(persisted.includes(privacyCanary), false, privacyCanary);
  }
  assert.ok([...database.documents.keys()].some((path) =>
    path.startsWith(`${privateCustomerBiteSaverDeviceChallengeCollection}/bsdc_`)));
  assert.ok([...database.documents.keys()].some((path) =>
    path.startsWith(`${privateCustomerBiteSaverDeviceInstallationCollection}/bsdi_`)));
});

test("challenge races accept one proof binding and reject a different contender", async () => {
  const database = new MemoryDatabase();
  const challenge = await issue(database, "android");
  const common = {
    database,
    rootKey,
    challenge,
    credentialId: androidCredentialId,
    deviceRef: androidDeviceRef,
    now: () => now + 1,
    enrollment: androidEnrollment,
  };
  const settled = await Promise.allSettled([
    commitCustomerBiteSaverVerifiedDeviceProof({
      ...common,
      proofDigest: "c".repeat(64),
    }),
    commitCustomerBiteSaverVerifiedDeviceProof({
      ...common,
      proofDigest: "d".repeat(64),
    }),
  ]);
  assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(settled.filter((entry) => entry.status === "rejected").length, 1);
});

test("absolute expiry is synchronous and independent from TTL cleanup", async () => {
  const database = new MemoryDatabase();
  const challenge = await issue(database, "android");
  await assert.rejects(loadCustomerBiteSaverDeviceChallenge({
    database,
    challengeId: challenge.challengeId,
    nowMillis: challenge.expiresAtMillis,
  }), contractError("permission-denied"));
  assert.equal(database.documents.size, 3, "Session, allowance and expired challenge remain; TTL is not trusted");
});

test("transaction retries re-sample challenge and provider expiry before writes", async () => {
  for (const expiry of ["challenge", "provider"]) {
    const database = new MemoryDatabase();
    const challenge = await issue(database, "android");
    const clock = {value: now + 1};
    const providerValidUntilMillis = expiry === "provider"
      ? now + 10
      : challenge.expiresAtMillis + 60_000;
    const before = JSON.stringify([...database.documents.entries()]);
    database.retryNextTransaction(() => {
      clock.value = expiry === "provider"
        ? providerValidUntilMillis
        : challenge.expiresAtMillis;
    });
    await assert.rejects(commitCustomerBiteSaverVerifiedDeviceProof({
      database,
      rootKey,
      challenge,
      proofDigest: "9".repeat(64),
      credentialId: androidCredentialId,
      deviceRef: androidDeviceRef,
      now: () => clock.value,
      providerValidUntilMillis,
      enrollment: androidEnrollment,
    }), contractError("permission-denied"), expiry);
    assert.equal(database.documents.size, 3, expiry);
    assert.equal(database.documents.get(
      `${privateCustomerBiteSaverDeviceChallengeCollection}/${challenge.challengeId}`,
    ).state, "issued", expiry);
    assert.equal(JSON.stringify([...database.documents.entries()]), before, expiry);
  }
});

test("iOS assertion counter advances atomically and exact proof retry bypasses replay rejection", async () => {
  const database = new MemoryDatabase();
  const recoveryKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 0x21)]);
  const recoveryHash = require("node:crypto").createHash("sha256")
    .update(recoveryKey).digest();
  const credentialId = customerBiteSaverCredentialId("ios", recoveryHash);
  const deviceRef = deriveCustomerBiteSaverIosDeviceRef({
    rootKey,
    recoveryPublicKeyX963: recoveryKey,
  });
  const appAttestKeyId = Buffer.alloc(32, 0x61).toString("base64url");
  const enrollment = Object.freeze({
    platform: "ios",
    credentialId,
    deviceRef,
    credentialPublicKey: recoveryKey.toString("base64url"),
    credentialPublicKeySha256: recoveryHash.toString("hex"),
    appAttestKeyId,
    appAttestPublicKeySpki: Buffer.alloc(91, 0x62).toString("base64url"),
    appId: "WXLXQ5D769.com.colesmart.bitestar",
    environment: "development",
    initialAssertionCounter: 0,
  });
  const enrolledChallenge = await issue(database, "ios");
  await commitCustomerBiteSaverVerifiedDeviceProof({
    database,
    rootKey,
    challenge: enrolledChallenge,
    proofDigest: "e".repeat(64),
    credentialId,
    deviceRef,
    now: () => now + 1,
    enrollment,
  });

  const useChallenge = await issue(database, "ios", now + 10);
  const firstUse = {
    database,
    rootKey,
    challenge: useChallenge,
    proofDigest: "f".repeat(64),
    credentialId,
    deviceRef,
    now: () => now + 11,
    iosAssertionCounter: 1,
    iosAppAttestKeyId: appAttestKeyId,
  };
  assert.equal(
    (await commitCustomerBiteSaverVerifiedDeviceProof(firstUse)).replayed,
    false,
  );
  assert.equal(
    (await commitCustomerBiteSaverVerifiedDeviceProof({
      ...firstUse,
      now: () => now + 12,
    })).replayed,
    true,
  );

  const staleCounterChallenge = await issue(database, "ios", now + 20);
  await assert.rejects(commitCustomerBiteSaverVerifiedDeviceProof({
    ...firstUse,
    challenge: staleCounterChallenge,
    proofDigest: "1".repeat(64),
    now: () => now + 21,
  }), contractError("permission-denied"));

  const nextChallenge = await issue(database, "ios", now + 30);
  await commitCustomerBiteSaverVerifiedDeviceProof({
    ...firstUse,
    challenge: nextChallenge,
    proofDigest: "2".repeat(64),
    now: () => now + 31,
    iosAssertionCounter: 2,
  });
  const stored = await loadCustomerBiteSaverDeviceInstallation({
    database,
    rootKey,
    platform: "ios",
    credentialId,
  });
  assert.equal(stored.assertionCounter, 2);

  const sameKeyRecovery = await issue(database, "ios", now + 40);
  await commitCustomerBiteSaverVerifiedDeviceProof({
    ...firstUse,
    challenge: sameKeyRecovery,
    proofDigest: "3".repeat(64),
    now: () => now + 41,
    enrollment,
  });
  const requalified = await loadCustomerBiteSaverDeviceInstallation({
    database,
    rootKey,
    platform: "ios",
    credentialId,
  });
  assert.equal(requalified.assertionCounter, 2,
    "requalifying the current Ka must not reset its accepted counter");
  assert.equal(requalified.enrollmentIssuedAtMillis, sameKeyRecovery.issuedAtMillis);
  assert.equal(requalified.enrollmentChallengeId, sameKeyRecovery.challengeId);
});

function iosEnrollment(keyByte) {
  const recoveryKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 0x21)]);
  const recoveryHash = require("node:crypto").createHash("sha256")
    .update(recoveryKey).digest();
  return Object.freeze({
    platform: "ios",
    credentialId: customerBiteSaverCredentialId("ios", recoveryHash),
    deviceRef: deriveCustomerBiteSaverIosDeviceRef({
      rootKey,
      recoveryPublicKeyX963: recoveryKey,
    }),
    credentialPublicKey: recoveryKey.toString("base64url"),
    credentialPublicKeySha256: recoveryHash.toString("hex"),
    appAttestKeyId: Buffer.alloc(32, keyByte).toString("base64url"),
    appAttestPublicKeySpki: Buffer.alloc(91, keyByte).toString("base64url"),
    appId: "WXLXQ5D769.com.colesmart.bitestar",
    environment: "development",
    initialAssertionCounter: 0,
  });
}

function enroll(database, challenge, enrollment, committedAt = now + 100) {
  return commitCustomerBiteSaverVerifiedDeviceProof({
    database,
    rootKey,
    challenge,
    proofDigest: require("node:crypto").createHash("sha256")
      .update(enrollment.appAttestKeyId).digest("hex"),
    credentialId: enrollment.credentialId,
    deviceRef: enrollment.deviceRef,
    now: () => committedAt,
    enrollment,
  });
}

test("iOS same-millisecond enrollment tie order is deterministic in both completion orders", async () => {
  for (const newerFirst of [false, true]) {
    const database = new MemoryDatabase();
    const challenges = [await issue(database, "ios"), await issue(database, "ios")]
      .sort((left, right) => left.challengeId < right.challengeId ? -1 : 1);
    const older = iosEnrollment(0x71);
    const newer = iosEnrollment(0x72);
    const attempts = [[challenges[0], older], [challenges[1], newer]];
    if (newerFirst) attempts.reverse();
    const outcomes = await Promise.allSettled(attempts.map(([challenge, enrollment]) =>
      enroll(database, challenge, enrollment)));
    assert.equal(outcomes[0].status, "fulfilled");
    assert.equal(outcomes[1].status, newerFirst ? "rejected" : "fulfilled");
    if (newerFirst) assert.ok(contractError("permission-denied")(outcomes[1].reason));
    const installation = await loadCustomerBiteSaverDeviceInstallation({
      database,
      rootKey,
      platform: "ios",
      credentialId: newer.credentialId,
    });
    assert.equal(installation.appAttestKeyId, newer.appAttestKeyId);
    assert.equal(installation.deviceRef, older.deviceRef);
    assert.equal(installation.assertionCounter, 0);
    assert.equal(installation.enrollmentIssuedAtMillis, now);
    assert.equal(installation.enrollmentChallengeId, challenges[1].challengeId);
    if (!newerFirst) {
      const beforeReplay = [...database.documents.entries()];
      assert.equal((await enroll(database, challenges[0], older)).replayed, true);
      assert.deepEqual([...database.documents.entries()], beforeReplay,
        "exact accepted older replay is idempotent after supersession");
    }
  }
});

test("iOS enrollment transaction retry rechecks a concurrently accepted newer recovery", async () => {
  const database = new MemoryDatabase();
  const initial = iosEnrollment(0x73);
  await enroll(database, await issue(database, "ios"), initial, now + 1);
  const olderChallenge = await issue(database, "ios", now + 10);
  const newerChallenge = await issue(database, "ios", now + 20);
  const older = iosEnrollment(0x74);
  const newer = iosEnrollment(0x75);

  // Prepare the writes of a genuine successful newer transaction. Inject its
  // committed snapshot between retry attempts, as a Firestore conflict does.
  const concurrent = new MemoryDatabase();
  concurrent.documents = new Map(database.documents);
  await enroll(concurrent, newerChallenge, newer, now + 30);
  let afterConcurrentCommit;
  database.retryNextTransaction(() => {
    database.documents = new Map(concurrent.documents);
    afterConcurrentCommit = [...database.documents.entries()];
  });
  await assert.rejects(enroll(database, olderChallenge, older, now + 40),
    contractError("permission-denied"));
  assert.deepEqual([...database.documents.entries()], afterConcurrentCommit);
  assert.equal(database.documents.get(
    `${privateCustomerBiteSaverDeviceChallengeCollection}/${olderChallenge.challengeId}`,
  ).state, "issued");
  const installation = await loadCustomerBiteSaverDeviceInstallation({
    database,
    rootKey,
    platform: "ios",
    credentialId: newer.credentialId,
  });
  assert.equal(installation.appAttestKeyId, newer.appAttestKeyId);
  assert.equal(installation.enrollmentChallengeId, newerChallenge.challengeId);
});

test("iOS installation parser fails closed on absent or malformed trusted enrollment order", async () => {
  const database = new MemoryDatabase();
  const enrollment = iosEnrollment(0x76);
  await enroll(database, await issue(database, "ios"), enrollment);
  const installationPath = [...database.documents.keys()].find((entry) =>
    entry.startsWith(`${privateCustomerBiteSaverDeviceInstallationCollection}/`));
  const valid = database.documents.get(installationPath);
  for (const change of [
    {enrollmentIssuedAt: undefined},
    {enrollmentIssuedAt: new Date(now + 101)},
    {enrollmentIssuedAt: new Date(-1)},
    {enrollmentChallengeId: undefined},
    {enrollmentChallengeId: "untrusted-client-order"},
  ]) {
    database.documents.set(installationPath, {...valid, ...change});
    await assert.rejects(loadCustomerBiteSaverDeviceInstallation({
      database,
      rootKey,
      platform: "ios",
      credentialId: enrollment.credentialId,
    }), contractError("failed-precondition"));
  }
});
