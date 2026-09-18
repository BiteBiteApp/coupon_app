"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {challengeAuthorityFixture} = require("./helpers/customer_bitesaver_challenge_authority_fixture.js");
const {
  reserveCustomerBiteSaverDeviceChallengeAdmission,
  CustomerBiteSaverDeviceChallengeLimitError,
  customerBiteSaverDeviceChallengeAllowanceSize,
} = require("../lib/customer_bitesaver_device_challenge_admission.js");
const {issueCustomerBiteSaverDeviceUseChallenge} = require("../lib/customer_bitesaver_device_proof_store.js");
const {CustomerBiteSaverContractError} = require("../lib/customer_bitesaver_search_contract.js");
const {
  customerBiteSaverDeviceChallengeCleanupDelayMilliseconds: cleanupDelay,
} = require("../lib/customer_bitesaver_device_proof_contract.js");

const baseNow = Date.parse("2026-09-18T16:00:00.000Z");
const windowMillis = 120_000;
const allowanceSize = 30;
const allowancePath = (admission) => `private_bitesaver_device_challenges/${admission.admissionHandle}`;
const rejected = (error) => error instanceof CustomerBiteSaverContractError;
const limited = (retryAfterMillis) => (error) =>
  error instanceof CustomerBiteSaverDeviceChallengeLimitError &&
  error.retryAfterMillis === retryAfterMillis;

// Serialized local transaction simulation. Retry hooks discard an attempted
// commit and rerun the callback; this is not a Firestore/emulator concurrency test.
class SimulatedDatabase {
  constructor() {
    this.documents = new Map();
    this.committedWrites = [];
    this.reads = [];
    this.queue = Promise.resolve();
    this.retryHook = null;
  }
  stored(path) {
    const data = this.documents.get(path);
    return data === undefined ? null : {id: path.split("/").at(-1), path, data: structuredClone(data)};
  }
  async getDocument(path) { return this.stored(path); }
  async getDocuments(paths) { return paths.map((path) => this.stored(path)); }
  async queryDocuments() { assert.fail("Admission must not query"); }
  async runTransaction(operation) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const attempt = async () => {
        const writes = [];
        let writing = false;
        const read = async (path) => {
          assert.equal(writing, false, "All reads must precede writes");
          this.reads.push(path);
          return this.stored(path);
        };
        const write = (type, path, data) => { writing = true; writes.push({type, path, data}); };
        const result = await operation({
          getDocument: read,
          getDocuments: (paths) => Promise.all(paths.map(read)),
          queryDocuments: () => assert.fail("No transaction queries"),
          createDocument: (path, data) => write("create", path, data),
          setDocument: (path, data) => write("set", path, data),
          deleteDocument: () => assert.fail("Admission must not delete"),
        });
        return {result, writes};
      };
      let completed = await attempt();
      if (this.retryHook !== null) {
        const hook = this.retryHook;
        this.retryHook = null;
        hook();
        completed = await attempt();
      }
      for (const write of completed.writes) {
        if (write.type === "create") assert.equal(this.documents.has(write.path), false);
      }
      for (const write of completed.writes) {
        this.documents.set(write.path, structuredClone(write.data));
        this.committedWrites.push(structuredClone(write));
      }
      return completed.result;
    } finally { release(); }
  }
}

function harness() {
  const database = new SimulatedDatabase();
  const clock = {value: baseNow};
  let entropy = 1;
  const randomSource = (size) => {
    const result = Buffer.alloc(size);
    result.writeUInt32BE(entropy++, size - 4);
    return result;
  };
  const fixture = (options = {}) => {
    const value = challengeAuthorityFixture({database, nowMillis: clock.value, ...options});
    value.context = {...value.context, now: () => clock.value, randomSource};
    return value;
  };
  const reserve = (value, request = value.request, platform = "android") =>
    reserveCustomerBiteSaverDeviceChallengeAdmission({request, platform, context: value.context});
  const issue = (value, admission, overrides = {}) => issueCustomerBiteSaverDeviceUseChallenge({
    database, request: value.request, platform: "android",
    authenticatedUserId: value.actor.uid !== null && !value.actor.isAnonymous ? value.actor.uid : null,
    admissionHandle: admission.admissionHandle, permit: admission.permit,
    now: () => clock.value, randomSource, ...overrides,
  });
  return {database, clock, fixture, reserve, issue};
}

function snapshot(h) {
  return {documents: structuredClone(h.database.documents), writes: h.database.committedWrites.length};
}
function assertUnchanged(h, before) {
  assert.deepEqual(h.database.documents, before.documents);
  assert.equal(h.database.committedWrites.length, before.writes);
}
async function fill(h, value, count = allowanceSize) {
  return Promise.all(Array.from({length: count}, (_, index) => h.reserve(value, {
    ...value.request, logicalRequestId: `quota-operation-${String(index).padStart(8, "0")}`,
  })));
}

test("unauthorized admission creates no allowance and valid paths have bounded point reads", async () => {
  const h = harness();
  const guest = h.fixture();
  const before = snapshot(h);
  await assert.rejects(h.reserve(guest, {...guest.request, origin: {
    ...guest.request.origin, capability: "a".repeat(43),
  }}), rejected);
  const anonymousSaved = h.fixture({origin: "saved"});
  await assert.rejects(h.reserve(anonymousSaved), rejected);
  await assert.rejects(h.reserve(guest, guest.request, "untrusted-platform"), rejected);
  assertUnchanged(h, before);
  h.database.reads = [];
  const admitted = await h.reserve(guest);
  assert.equal(h.database.reads.length, 2);
  h.database.reads = [];
  await h.issue(guest, admitted);
  assert.equal(h.database.reads.length, 2);
  const saved = h.fixture({origin: "saved", actor: {uid: "read-budget-owner", isAnonymous: false}});
  h.database.reads = [];
  await h.reserve(saved);
  assert.equal(h.database.reads.length, 1);
});

test("thirty slots cap simulated concurrent reservations; denied calls do not write or extend retention", async () => {
  assert.equal(customerBiteSaverDeviceChallengeAllowanceSize, allowanceSize);
  const h = harness();
  const value = h.fixture();
  const attempts = await Promise.allSettled(Array.from({length: allowanceSize + 20}, (_, index) =>
    h.reserve(value, {...value.request, logicalRequestId: `concurrent-reserve-${String(index).padStart(4, "0")}`})));
  const allowed = attempts.filter((result) => result.status === "fulfilled").map((result) => result.value);
  assert.equal(allowed.length, allowanceSize);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 20);
  assert.equal(attempts.filter((result) => result.status === "rejected").every(
    (result) => limited(windowMillis)(result.reason)), true);
  assert.equal(new Set(allowed.map((result) => result.admissionHandle)).size, 1);
  const stored = h.database.documents.get(allowancePath(allowed[0]));
  assert.equal(stored.reservations.length, allowanceSize);
  assert.equal(stored.deleteAfter.getTime(), baseNow + windowMillis + cleanupDelay);
  assert.equal(JSON.stringify(stored).includes(allowed[0].permit), false);
  const before = snapshot(h);
  h.clock.value += 10_000;
  await assert.rejects(h.reserve(value), limited(110_000));
  await assert.rejects(h.reserve(value, {...value.request, logicalRequestId: "another-operation-0001"}, "ios"), limited(110_000));
  assertUnchanged(h, before);
  assert.equal(h.database.committedWrites.length, allowanceSize);
});

test("late consumption retains all thirty slots for a full rolling window after consumption", async () => {
  const h = harness();
  const value = h.fixture();
  const admissions = await fill(h, value);
  h.clock.value = baseNow + 119_999;
  await Promise.all(admissions.map((admission, index) => h.issue(value, admission, {
    request: {...value.request, logicalRequestId: `quota-operation-${String(index).padStart(8, "0")}`},
  })));
  const path = allowancePath(admissions[0]);
  const stored = h.database.documents.get(path);
  assert.equal(stored.reservations.every((entry) => entry.consumedAt.getTime() === baseNow + 119_999), true);
  assert.equal(stored.deleteAfter.getTime(), baseNow + 239_999 + cleanupDelay);
  const before = snapshot(h);
  h.clock.value = baseNow + 120_000;
  await assert.rejects(h.reserve(value), limited(119_999));
  h.clock.value = baseNow + 239_998;
  await assert.rejects(h.reserve(value), limited(1));
  assertUnchanged(h, before);
  h.clock.value += 1;
  const next = await h.reserve(value);
  assert.equal(next.admissionHandle, admissions[0].admissionHandle);
  assert.equal(h.database.documents.get(path).reservations.length, 1);
  assert.equal([...h.database.documents.values()].filter((entry) => entry.role === "deviceUseChallenge").length, allowanceSize);
});

test("expired permit remains invalid when documents remain and after simulated cleanup", async () => {
  for (const cleanup of [false, true]) {
    const h = harness();
    const actor = {uid: "cleanup-owner", isAnonymous: false};
    const value = h.fixture({origin: "saved", actor});
    const admission = await h.reserve(value);
    const path = allowancePath(admission);
    h.clock.value = admission.expiresAtMillis;
    const before = snapshot(h);
    await assert.rejects(h.issue(value, admission), rejected);
    assertUnchanged(h, before);
    h.clock.value = h.database.documents.get(path).deleteAfter.getTime();
    if (cleanup) h.database.documents.delete(path); // Local cleanup simulation only.
    const beforeCleanupRetry = snapshot(h);
    await assert.rejects(h.issue(value, admission), rejected);
    assertUnchanged(h, beforeCleanupRetry);
    const refreshed = h.fixture({origin: "saved", actor});
    const replacement = await h.reserve(refreshed);
    assert.equal(replacement.admissionHandle, admission.admissionHandle);
    assert.equal(h.database.documents.get(path).reservations.length, 1);
  }
});

test("simulated concurrent consume is single-use and races with reserves within the same bounded bucket", async () => {
  const h = harness();
  const value = h.fixture();
  const admission = await h.reserve(value);
  const attempts = await Promise.allSettled([
    ...Array.from({length: 8}, () => h.issue(value, admission)),
    ...Array.from({length: allowanceSize + 4}, (_, index) => h.reserve(value, {
      ...value.request, logicalRequestId: `mixed-concurrent-${String(index).padStart(6, "0")}`,
    })),
  ]);
  assert.equal(attempts.slice(0, 8).filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.slice(8).filter((item) => item.status === "fulfilled").length, allowanceSize - 1);
  assert.equal(h.database.documents.get(allowancePath(admission)).reservations.length, allowanceSize);
  assert.equal([...h.database.documents.values()].filter((entry) => entry.role === "deviceUseChallenge").length, 1);
  const before = snapshot(h);
  await assert.rejects(h.issue(value, admission), rejected);
  assertUnchanged(h, before);
});

test("simulated transaction retries resample time and commit only the final reservation/consumption", async () => {
  const h = harness();
  const value = h.fixture();
  h.database.retryHook = () => { h.clock.value += 5_000; };
  const admission = await h.reserve(value);
  assert.equal(admission.expiresAtMillis, baseNow + 125_000);
  assert.equal(h.database.committedWrites.length, 1);
  h.database.retryHook = () => { h.clock.value += 5_000; };
  const challenge = await h.issue(value, admission);
  assert.equal(challenge.issuedAtMillis, baseNow + 10_000);
  const stored = h.database.documents.get(allowancePath(admission));
  assert.equal(stored.reservations[0].createdAt.getTime(), baseNow + 5_000);
  assert.equal(stored.reservations[0].expiresAt.getTime(), baseNow + 125_000);
  assert.equal(stored.reservations[0].consumedAt.getTime(), baseNow + 10_000);
  assert.equal(stored.deleteAfter.getTime(), baseNow + 130_000 + cleanupDelay);
  assert.equal(h.database.committedWrites.length, 3);
});

test("simulated retry crossing permit or authority expiry rolls back every attempted write", async () => {
  const h = harness();
  const value = h.fixture();
  const admission = await h.reserve(value);
  const before = snapshot(h);
  h.database.retryHook = () => { h.clock.value = admission.expiresAtMillis; };
  await assert.rejects(h.issue(value, admission), rejected);
  assertUnchanged(h, before);
  h.database.retryHook = () => { h.clock.value = value.session.absoluteExpiresAt.getTime(); };
  await assert.rejects(h.reserve(value), rejected);
  assertUnchanged(h, before);
});

test("signed scope is shared across Browse/Saved sessions, offers, ciphertexts and variable request fields", async () => {
  const h = harness();
  const actor = {uid: "one-signed-owner", isAnonymous: false};
  const browseA = h.fixture({actor});
  const browseB = h.fixture({actor, sourceId: "another-coupon",
    sessionId: `bss_${Buffer.alloc(32, 94).toString("base64url")}`,
    clientInstanceId: "another-client-instance-0001"});
  const savedA = h.fixture({origin: "saved", actor});
  const savedB = h.fixture({origin: "saved", actor, sourceId: "third-coupon", accountId: "another-restaurant"});
  const admissions = [];
  for (let index = 0; index < allowanceSize; index += 1) {
    const value = [browseA, browseB, savedA, savedB][index % 4];
    const origin = value.request.origin.kind === "saved"
      ? {kind: "saved", accessToken: value.mintSavedToken({}, 100 + index)}
      : value.request.origin;
    admissions.push(await h.reserve(value, {...value.request, origin,
      logicalRequestId: `variable-logical-id-${String(index).padStart(4, "0")}`,
      currentCoordinates: {latitude: 28 + index / 100, longitude: -81, capturedAtMillis: baseNow + index},
    }, index % 2 === 0 ? "android" : "ios"));
  }
  assert.equal(new Set(admissions.map((item) => item.admissionHandle)).size, 1);
  const before = snapshot(h);
  await assert.rejects(h.reserve(savedB, {...savedB.request, origin: {
    kind: "saved", accessToken: savedB.mintSavedToken({}, 120),
  }}), limited(windowMillis));
  assertUnchanged(h, before);
  const anotherOwner = h.fixture({origin: "saved", actor: {uid: "another-owner", isAnonymous: false}});
  assert.notEqual((await h.reserve(anotherOwner)).admissionHandle, admissions[0].admissionHandle);
});

test("guest allowance follows authentic session authority and rejects borrowed or invented session credentials", async () => {
  const h = harness();
  const first = h.fixture();
  const second = h.fixture({sessionId: `bss_${Buffer.alloc(32, 95).toString("base64url")}`,
    clientInstanceId: "another-guest-instance-0001"});
  const a = await h.reserve(first);
  const b = await h.reserve(second);
  assert.notEqual(a.admissionHandle, b.admissionHandle);
  const before = snapshot(h);
  await assert.rejects(h.reserve(first, {...first.request, origin: {
    ...first.request.origin, sessionId: second.request.origin.sessionId,
  }}), rejected);
  await assert.rejects(h.reserve(first, {...first.request, origin: {
    ...first.request.origin, sessionId: `bss_${Buffer.alloc(32, 99).toString("base64url")}`,
  }}), rejected);
  await assert.rejects(h.issue(second, a), rejected);
  assertUnchanged(h, before);
});

test("permit consumption binds actual actor, platform, full request and immutable expiry", async () => {
  const h = harness();
  const value = h.fixture({origin: "saved", actor: {uid: "bound-owner", isAnonymous: false}});
  const admission = await h.reserve(value);
  const before = snapshot(h);
  for (const overrides of [
    {authenticatedUserId: "different-owner"},
    {authenticatedUserId: null},
    {platform: "ios"},
    {permit: Buffer.alloc(32, 85).toString("base64url")},
    {request: {...value.request, logicalRequestId: "modified-logical-0001"}},
    {request: {...value.request, currentCoordinates: {latitude: 28, longitude: -81, capturedAtMillis: baseNow}}},
    {request: {...value.request, origin: {kind: "saved", accessToken: value.mintSavedToken({}, 99)}}},
  ]) await assert.rejects(h.issue(value, admission, overrides), rejected);
  assertUnchanged(h, before);
  h.clock.value += 119_999;
  await h.issue(value, admission);
  const original = before.documents.get(allowancePath(admission)).reservations[0];
  const consumed = h.database.documents.get(allowancePath(admission)).reservations[0];
  assert.deepEqual(consumed.createdAt, original.createdAt);
  assert.deepEqual(consumed.expiresAt, original.expiresAt);
  assert.deepEqual(consumed.authorityExpiresAt, original.authorityExpiresAt);
});

test("malformed stored roles, purpose, origin, bounds and deadlines fail without mutations", async () => {
  for (const mutate of [
    (document) => { document.role = "deviceUseChallenge"; },
    (document) => { document.reservations[0].purpose = "other-purpose"; },
    (document) => { document.reservations[0].origin = "saved"; },
    (document) => { document.reservations[0].expiresAt = new Date(baseNow + windowMillis + 1); },
    (document) => { document.reservations[0].authorityExpiresAt = new Date(baseNow + 1); },
    (document) => { document.deleteAfter = new Date(document.deleteAfter.getTime() + 1); },
    (document) => { document.reservations = Array(allowanceSize + 1).fill(document.reservations[0]); },
  ]) {
    const h = harness();
    const value = h.fixture();
    const admission = await h.reserve(value);
    mutate(h.database.documents.get(allowancePath(admission)));
    const before = snapshot(h);
    await assert.rejects(h.issue(value, admission), rejected);
    await assert.rejects(h.reserve(value), rejected);
    assertUnchanged(h, before);
  }
});

test("quota wait near original authority deadline can end recovery; no coupon/usage writes occur", async () => {
  const h = harness();
  const value = h.fixture({origin: "saved", actor: {uid: "near-expiry-owner", isAnonymous: false}});
  value.request.origin.accessToken = value.mintSavedToken({expiresAtMillis: baseNow + 121_000});
  const admissions = await fill(h, value);
  h.clock.value += 119_999;
  await Promise.all(admissions.map((admission, index) => h.issue(value, admission, {
    request: {...value.request, logicalRequestId: `quota-operation-${String(index).padStart(8, "0")}`},
  })));
  h.clock.value = baseNow + 120_000;
  const before = snapshot(h);
  await assert.rejects(h.reserve(value), limited(119_999));
  h.clock.value = baseNow + 121_000;
  await assert.rejects(h.reserve(value), rejected);
  h.clock.value = baseNow + 240_000;
  await assert.rejects(h.reserve(value), rejected);
  assertUnchanged(h, before);
  assert.equal(h.database.committedWrites.every((write) =>
    write.path.startsWith("private_bitesaver_device_challenges/")), true);
});
