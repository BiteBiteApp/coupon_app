const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require("../lib/owner_record_state_contract.js");

const ownerUid = "owner-record-contract-uid";
const createdAt = new Date("2026-08-11T12:00:00.000Z");
const updatedAt = new Date("2026-08-11T12:01:00.000Z");

function stored(document, changes = {}, id = ownerUid) {
  return {
    id,
    data: {...document, ...changes},
  };
}

function buildState(state, changes = {}) {
  return contract.buildOwnerRecordStateDocument({
    ownerUid,
    generation: state === "open" ? 0 : 3,
    state,
    activeJobId: state === "removing" ? "owner-removal-job" : null,
    createdAt,
    updatedAt,
    ...changes,
  });
}

function timestampLike(value) {
  return {toDate: () => new Date(value.getTime())};
}

function assertInvalidState(action) {
  assert.throws(action, (error) => {
    assert.equal(error.name, "OwnerRecordStateContractError");
    assert.equal(error.code, "invalid-state");
    assert.equal(error.message, "Stored owner-record state is invalid.");
    return true;
  });
}

test("owner-record state publishes only its fixed private contract", () => {
  assert.equal(
    contract.ownerRecordStateCollection,
    "private_owner_record_states",
  );
  assert.equal(
    contract.ownerRecordStateVersion,
    "bitestar.owner-record-state.v1",
  );
  const document = contract.createInitialOwnerRecordState(ownerUid, createdAt);
  assert.deepEqual(Object.keys(document).sort(), [
    "activeJobId",
    "createdAt",
    "fingerprint",
    "generation",
    "ownerUid",
    "state",
    "updatedAt",
    "version",
  ]);
  assert.equal(document.state, "open");
  assert.equal(document.generation, 0);
  assert.equal(document.activeJobId, null);
  assert.match(document.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(document).includes("email"), false);
  assert.equal(JSON.stringify(document).includes("stripe"), false);
});

test("owner-record parser distinguishes absent from every valid state", () => {
  assert.equal(contract.parseOwnerRecordStateDocument(null), null);
  for (const state of ["open", "removing", "removed"]) {
    const document = buildState(state);
    const parsed = contract.parseOwnerRecordStateDocument(stored(document));
    assert.deepEqual(parsed, document);
    assert.equal(parsed.state, state);
  }
});

test("owner-record parser accepts Firestore Timestamp-like values", () => {
  const document = buildState("open");
  const parsed = contract.parseOwnerRecordStateDocument(stored(document, {
    createdAt: timestampLike(document.createdAt),
    updatedAt: timestampLike(document.updatedAt),
  }));
  assert.deepEqual(parsed, document);
  assert.notEqual(parsed.createdAt, document.createdAt);
});

test("owner-record parser rejects wrong versions, keys, IDs, and fingerprints", () => {
  const document = buildState("open");
  const {updatedAt: omitted, ...missingKey} = document;
  void omitted;
  const candidates = [
    stored(document, {version: "bitestar.owner-record-state.v2"}),
    {id: ownerUid, data: missingKey},
    stored(document, {unexpected: true}),
    stored(document, {fingerprint: "0".repeat(64)}),
    stored(document, {}, "another-owner"),
    stored(document, {}, `${ownerUid}/child`),
  ];
  for (const candidate of candidates) {
    assertInvalidState(() => contract.parseOwnerRecordStateDocument(candidate));
  }
});

test("owner-record UID validation preserves opaque identity and rejects aliases", () => {
  assert.equal(contract.requireOwnerRecordUid(" owner "), " owner ");
  assert.equal(contract.requireOwnerRecordUid("é-owner"), "é-owner");
  for (const value of [
    "",
    ".",
    "..",
    "owner/child",
    "\u0000owner",
    "owner\u001f",
    "a".repeat(129),
    null,
  ]) {
    assert.throws(
      () => contract.requireOwnerRecordUid(value),
      (error) => error.code === "invalid-request",
    );
  }
});

test("owner-record generation rejects negative, fractional, and unsafe values", () => {
  assert.equal(contract.requireOwnerRecordGeneration(0), 0);
  assert.equal(
    contract.requireOwnerRecordGeneration(Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER,
  );
  for (const value of [
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    "0",
  ]) {
    assert.throws(
      () => contract.requireOwnerRecordGeneration(value),
      (error) => error.code === "invalid-request",
    );
  }
});

test("owner-record state enforces active-job and timestamp relationships", () => {
  const invalidCores = [
    {state: "open", activeJobId: "job"},
    {state: "removed", activeJobId: "job"},
    {state: "removing", activeJobId: null},
    {state: "removing", activeJobId: "job/child"},
    {updatedAt: new Date(createdAt.getTime() - 1)},
    {createdAt: new Date("invalid")},
    {state: "future"},
  ];
  for (const changes of invalidCores) {
    assert.throws(
      () => contract.buildOwnerRecordStateDocument({
        ownerUid,
        generation: 1,
        state: "open",
        activeJobId: null,
        createdAt,
        updatedAt,
        ...changes,
      }),
      (error) => error.code === "invalid-request",
    );
  }
});

test("owner-record malformed-present documents never become absent", () => {
  const document = buildState("open");
  const mutations = [
    {generation: -1},
    {generation: 1.5},
    {generation: Number.MAX_SAFE_INTEGER + 1},
    {ownerUid: "owner/child"},
    {state: "unknown"},
    {activeJobId: "job"},
    {updatedAt: new Date(createdAt.getTime() - 1)},
    {createdAt: {toDate: () => new Date("invalid")}},
  ];
  for (const mutation of mutations) {
    assertInvalidState(() =>
      contract.parseOwnerRecordStateDocument(stored(document, mutation)));
  }
});

test("owner-record initialization creates once and never reopens state", () => {
  const initialized = contract.initializeOwnerRecordState(
    null,
    ownerUid,
    createdAt,
  );
  assert.equal(initialized.created, true);
  assert.equal(initialized.state.state, "open");
  assert.equal(initialized.state.generation, 0);

  const existing = contract.initializeOwnerRecordState(
    stored(initialized.state),
    ownerUid,
    updatedAt,
  );
  assert.equal(existing.created, false);
  assert.deepEqual(existing.state, initialized.state);

  for (const state of ["removing", "removed"]) {
    assert.throws(
      () => contract.initializeOwnerRecordState(
        stored(buildState(state)),
        ownerUid,
        updatedAt,
      ),
      (error) => error.code === "invalid-state",
    );
  }
  assertInvalidState(() => contract.initializeOwnerRecordState(
    stored(initialized.state, {fingerprint: "f".repeat(64)}),
    ownerUid,
    updatedAt,
  ));
});

test("future reactivation preserves generation and does not auto-run", () => {
  const removed = buildState("removed", {generation: 47});
  const reactivated = contract.reactivateRemovedOwnerRecordState(
    removed,
    new Date("2026-08-11T12:02:00.000Z"),
  );
  assert.equal(reactivated.state, "open");
  assert.equal(reactivated.generation, 47);
  assert.equal(reactivated.activeJobId, null);
  assert.deepEqual(reactivated.createdAt, removed.createdAt);
  assert.notEqual(reactivated.fingerprint, removed.fingerprint);

  assert.throws(
    () => contract.reactivateRemovedOwnerRecordState(
      buildState("open"),
      updatedAt,
    ),
    (error) => error.code === "invalid-state",
  );
  assert.throws(
    () => contract.reactivateRemovedOwnerRecordState(
      removed,
      new Date(createdAt.getTime() - 1),
    ),
    (error) => error.code === "invalid-state",
  );
});
