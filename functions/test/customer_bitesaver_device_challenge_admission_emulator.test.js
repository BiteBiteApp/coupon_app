"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {randomUUID} = require("node:crypto");

if (process.env.BITESAVER_ADMISSION_EMULATOR_TEST !== "1") {
  test("challenge allowance real Firestore contention requires the local emulator gate", {
    skip: "set BITESAVER_ADMISSION_EMULATOR_TEST=1 with loopback/demo configuration",
  }, () => {});
} else {
  const loopback = (value) => {
    const match = /^(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/u.exec(value ?? "") ??
      /^\[::1\]:([1-9][0-9]{0,4})$/u.exec(value ?? "");
    return match !== null && Number(match[1]) <= 65_535;
  };
  // Fail before SDK initialization, including inherited emulator-hub overrides.
  assert.ok(loopback(process.env.FIRESTORE_EMULATOR_HOST), "explicit loopback Firestore required");
  for (const name of ["FIREBASE_EMULATOR_HUB", "FIREBASE_EMULATOR_HUB_HOST"]) {
    if (process.env[name]) assert.ok(loopback(process.env[name]), "loopback hub required");
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  assert.match(projectId ?? "", /^demo-bs-adapter-[a-z0-9-]+$/u);
  if (process.env.GCLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT) {
    assert.equal(process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT);
  }
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS, "credential files forbidden");
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore} = require("firebase-admin/firestore");
  const {createFirestoreCustomerBiteSaverSearchDatabase} = require(
    "../lib/customer_bitesaver_search_store.js",
  );
  const {reserveCustomerBiteSaverDeviceChallengeAdmission} = require(
    "../lib/customer_bitesaver_device_challenge_admission.js",
  );
  const {issueCustomerBiteSaverDeviceUseChallenge} = require(
    "../lib/customer_bitesaver_device_proof_store.js",
  );
  const {challengeAuthorityFixture} = require(
    "./helpers/customer_bitesaver_challenge_authority_fixture.js",
  );

  test("independent Firestore clients enforce thirty rolling slots and atomic single-use consumption", async () => {
    const apps = [0, 1].map(() => initializeApp({projectId}, `admission-${randomUUID()}`));
    const stores = apps.map((app) => getFirestore(app));
    const databases = stores.map(createFirestoreCustomerBiteSaverSearchDatabase);
    const base = Date.parse("2026-09-18T18:00:00Z");
    const allowanceSize = 30;
    let clock = base;
    const fixture = challengeAuthorityFixture({
      database: {documents: new Map()}, nowMillis: base,
      origin: "saved", actor: {uid: `emulator-${randomUUID()}`, isAnonymous: false},
    });
    const reserve = (client = 0) => reserveCustomerBiteSaverDeviceChallengeAdmission({
      request: fixture.request, platform: "android",
      context: {...fixture.context, database: databases[client], now: () => clock},
    });
    const issue = (grant, client = 0) => issueCustomerBiteSaverDeviceUseChallenge({
      database: databases[client], request: fixture.request, platform: "android",
      authenticatedUserId: fixture.actor.uid,
      admissionHandle: grant.admissionHandle, permit: grant.permit, now: () => clock,
    });
    const paths = new Set();
    try {
      const grants = [];
      for (let i = 0; i < allowanceSize - 2; i += 1) grants.push(await reserve(i % 2));
      const race = await Promise.allSettled([reserve(0), reserve(1), reserve(0), reserve(1)]);
      const accepted = race.filter((result) => result.status === "fulfilled");
      const denied = race.filter((result) => result.status === "rejected");
      assert.equal(accepted.length, 2);
      assert.equal(denied.length, 2);
      for (const result of denied) {
        assert.equal(result.reason.code, "resource-exhausted");
        assert.equal(result.reason.retryAfterMillis, 120_000);
      }
      grants.push(...accepted.map((result) => result.value));
      assert.equal(new Set(grants.map((grant) => grant.admissionHandle)).size, 1);
      assert.equal(new Set(grants.map((grant) => grant.permit)).size, allowanceSize);
      const allowancePath = `private_bitesaver_device_challenges/${grants[0].admissionHandle}`;
      paths.add(allowancePath);
      const original = (await stores[0].doc(allowancePath).get()).data();
      assert.equal(original.reservations.length, allowanceSize);
      assert.equal(original.deleteAfter.toMillis(), base + 120_000 + 86_400_000);
      assert.ok(Buffer.byteLength(JSON.stringify(original)) < 32_768);
      for (const grant of grants) assert.ok(!JSON.stringify(original).includes(grant.permit));
      await assert.rejects(reserve(1), {code: "resource-exhausted"});
      assert.deepEqual((await stores[0].doc(allowancePath).get()).data(), original);

      // A permit consumed just before its deadline holds a complete new window.
      clock = base + 119_999;
      const double = await Promise.allSettled([issue(grants[0], 0), issue(grants[0], 1)]);
      assert.equal(double.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(double.find((result) => result.status === "rejected").reason.code,
        "permission-denied");
      const challenges = [double.find((result) => result.status === "fulfilled").value];
      for (const grant of grants.slice(1)) challenges.push(await issue(grant));
      assert.equal(new Set(challenges.map((challenge) => challenge.challengeId)).size, allowanceSize);
      for (const challenge of challenges) {
        const path = `private_bitesaver_device_challenges/${challenge.challengeId}`;
        paths.add(path);
        assert.equal(challenge.issuedAtMillis, clock);
        assert.equal(challenge.expiresAtMillis, clock + 120_000);
        assert.equal((await stores[0].doc(path).get()).data().deleteAfter.toMillis(),
          challenge.expiresAtMillis + 86_400_000);
      }
      const consumed = (await stores[0].doc(allowancePath).get()).data();
      assert.equal(consumed.reservations.length, allowanceSize);
      assert.ok(consumed.reservations.every((entry) => entry.consumedAt.toMillis() === clock));
      assert.ok(consumed.reservations.every((entry) => entry.expiresAt.toMillis() === base + 120_000));
      assert.equal(consumed.deleteAfter.toMillis(), base + 239_999 + 86_400_000);
      clock = base + 120_000;
      await assert.rejects(reserve(1), (error) => error.code === "resource-exhausted" &&
        error.retryAfterMillis === 119_999);
      clock = base + 239_998;
      await assert.rejects(reserve(0), (error) => error.code === "resource-exhausted" &&
        error.retryAfterMillis === 1);
      assert.deepEqual((await stores[0].doc(allowancePath).get()).data(), consumed);
      clock += 1;
      const fresh = await reserve(1);
      assert.equal(fresh.admissionHandle, grants[0].admissionHandle);
      const retained = (await stores[0].doc(allowancePath).get()).data();
      assert.equal(retained.reservations.length, 1, "logical expiry works without TTL deletion");
      assert.equal((await stores[0].doc([...paths][1]).get()).exists, true);
    } finally {
      // Deletes only synthetic paths created by this test, through the checked emulator.
      await Promise.all([...paths].map((path) => stores[0].doc(path).delete()));
      await Promise.all(stores.map((store) => store.terminate()));
      await Promise.all(apps.map(deleteApp));
    }
  });
}
