const assert = require("node:assert/strict");
const test = require("node:test");

const billing = require("../lib/owner_billing_state_contract.js");
const contract = require("../lib/owner_record_removal_contract.js");
const owner = require("../lib/owner_record_state_contract.js");
const store = require("../lib/owner_record_removal_store.js");

const targetUid = "owner-removal-target";
const callerUid = "owner-removal-admin";
const sourceGeneration = 7;
const createdAt = new Date("2026-08-12T12:00:00.000Z");
const claimAt = new Date("2026-08-12T12:01:00.000Z");
const resumeAt = new Date("2026-08-12T12:02:00.000Z");

function clone(value) {
  return structuredClone(value);
}

function ownerPath(uid = targetUid) {
  return `${owner.ownerRecordStateCollection}/${uid}`;
}

function billingPath(uid = targetUid) {
  return `${billing.ownerBillingStateCollection}/${uid}`;
}

function jobId(generation = sourceGeneration, uid = targetUid) {
  return contract.createOwnerRecordRemovalJobId({
    targetUid: uid,
    sourceGeneration: generation,
  });
}

function jobPath(generation = sourceGeneration, uid = targetUid) {
  return contract.ownerRecordRemovalJobPath(jobId(generation, uid));
}

function openOwner(generation = sourceGeneration) {
  return owner.buildOwnerRecordStateDocument({
    ownerUid: targetUid,
    generation,
    state: "open",
    activeJobId: null,
    createdAt,
    updatedAt: createdAt,
  });
}

function nonOpenOwner(state, documentJobId = jobId()) {
  return owner.buildOwnerRecordStateDocument({
    ownerUid: targetUid,
    generation: sourceGeneration + 1,
    state,
    activeJobId: state === "removing" ? documentJobId : null,
    createdAt,
    updatedAt: claimAt,
  });
}

function inactiveBilling(generation = sourceGeneration) {
  return billing.createInitialOwnerBillingState(
    targetUid,
    generation,
    createdAt,
  );
}

function blockingBilling(generation = sourceGeneration) {
  return billing.createCheckoutPendingOwnerBillingState(
    inactiveBilling(generation),
    {
      checkoutAttemptId: "attempt_owner_removal",
      checkoutRequestFingerprint: "a".repeat(64),
      checkoutAttemptCreatedAt: createdAt,
      now: createdAt,
    },
  );
}

function unknownBilling(generation = sourceGeneration) {
  const pending = blockingBilling(generation);
  return billing.markCheckoutUncertain(pending, createdAt);
}

const knownBillingPostures = Object.freeze({
  active: "blocking",
  canceled: "inactive",
  incomplete: "blocking",
  incomplete_expired: "inactive",
  past_due: "blocking",
  paused: "blocking",
  trialing: "blocking",
  unpaid: "blocking",
});

function knownBilling(status, generation = sourceGeneration) {
  return billing.buildOwnerBillingStateDocument({
    ownerUid: targetUid,
    ownerRecordGeneration: generation,
    lifecycleState: "subscription_known",
    rawStripeStatus: status,
    billingPosture: knownBillingPostures[status],
    stripeCustomerId: "cus_ownerremoval",
    stripeSubscriptionId: "sub_ownerremoval",
    checkoutAttemptId: "attempt_owner_removal",
    checkoutRequestFingerprint: "a".repeat(64),
    checkoutAttemptCreatedAt: createdAt,
    checkoutSessionId: "cs_test_ownerremoval",
    lastStripeEventCreated: 1_786_534_800,
    lastStripeEventId: "evt_ownerremoval",
    lastStripeEventPayloadFingerprint: "b".repeat(64),
    stripeEventConflictKind: null,
    createdAt,
    updatedAt: createdAt,
  });
}

function conflictedBilling(
  conflictKind,
  generation = sourceGeneration,
) {
  const {
    version: _version,
    fingerprint: _fingerprint,
    ...knownCore
  } = knownBilling("active", generation);
  return billing.buildOwnerBillingStateDocument({
    ...knownCore,
    lifecycleState: "unknown",
    billingPosture: "unknown",
    stripeEventConflictKind: conflictKind,
  });
}

function stored(id, data) {
  return {id, data: clone(data)};
}

class FakeDatabase {
  constructor(documents = {}) {
    this.documents = new Map(
      Object.entries(documents).map(([path, data]) => [path, clone(data)]),
    );
    this.timeline = [];
    this.writes = [];
    this.queries = [];
    this.deletes = [];
    this.transactionCount = 0;
    this.queue = Promise.resolve();
  }

  async runTransaction(operation) {
    const execute = async () => {
      this.transactionCount += 1;
      this.timeline.push("db:transaction");
      const staged = new Map();
      const deleted = new Set();
      const transaction = {
        getDocument: async (path) => {
          this.timeline.push(`db:get:${path}`);
          if (deleted.has(path)) return null;
          const value = staged.has(path)
            ? staged.get(path)
            : this.documents.get(path);
          return value === undefined
            ? null
            : stored(path.slice(path.lastIndexOf("/") + 1), value);
        },
        queryDocuments: async (query) => {
          this.timeline.push(`db:query:${query.collectionPath}`);
          this.queries.push(clone(query));
          return [];
        },
        setDocument: (path, data, options) => {
          this.timeline.push(`db:set:${path}`);
          const next = options?.merge
            ? {...(staged.get(path) ?? this.documents.get(path) ?? {}), ...data}
            : data;
          staged.set(path, clone(next));
          deleted.delete(path);
          this.writes.push({path, data: clone(next), options});
        },
        deleteDocument: (path) => {
          this.timeline.push(`db:delete:${path}`);
          deleted.add(path);
          staged.delete(path);
          this.deletes.push(path);
        },
      };
      const result = await operation(transaction);
      for (const path of deleted) this.documents.delete(path);
      for (const [path, data] of staged) this.documents.set(path, data);
      return clone(result);
    };
    const result = this.queue.then(execute, execute);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  document(path) {
    const value = this.documents.get(path);
    return value === undefined ? null : clone(value);
  }
}

function fakeAuthority(options = {}) {
  const timeline = options.timeline ?? [];
  const authority = {
    async resolveCallerAdmin(uid) {
      timeline.push(`auth:caller:${uid}`);
      if (options.callerError) throw new Error("caller unavailable");
      if (Object.prototype.hasOwnProperty.call(options, "callerResult")) {
        return options.callerResult;
      }
      return {uid, isAdmin: true};
    },
    async lookupTargetAuth(uid) {
      timeline.push(`auth:target:${uid}`);
      if (options.targetError) throw new Error("target unavailable");
      if (Object.prototype.hasOwnProperty.call(options, "targetResult")) {
        return options.targetResult;
      }
      return {uid, email: "owner@example.com", customClaims: {}};
    },
  };
  if (options.authMutationBoundary !== undefined) {
    const boundary = options.authMutationBoundary;
    Object.assign(authority, {
      async deleteUser(uid) {
        boundary.calls.push(`deleteUser:${uid}`);
        boundary.state.exists = false;
      },
      async updateUser(uid, update) {
        boundary.calls.push(`updateUser:${uid}`);
        if (Object.prototype.hasOwnProperty.call(update, "disabled")) {
          boundary.state.disabled = update.disabled;
        }
      },
      async setCustomUserClaims(uid, claims) {
        boundary.calls.push(`setCustomUserClaims:${uid}`);
        boundary.state.claims = clone(claims);
      },
      async revokeRefreshTokens(uid) {
        boundary.calls.push(`revokeRefreshTokens:${uid}`);
        boundary.state.sessions = [];
        boundary.state.tokens = [];
      },
    });
  }
  return {
    authority,
    timeline,
  };
}

function context(options = {}) {
  const database = options.database ?? new FakeDatabase({
    [ownerPath()]: openOwner(),
    [billingPath()]: inactiveBilling(),
  });
  const authorityResult = fakeAuthority({
    ...(options.authorityOptions ?? {}),
    timeline: database.timeline,
  });
  const claimContext = {
    database,
    authority: authorityResult.authority,
    clock: () => options.now ?? claimAt,
    ...(options.externalBoundaries ?? {}),
  };
  return {
    context: claimContext,
    database,
    authority: authorityResult.authority,
  };
}

function claimRequest(overrides = {}) {
  return {
    contractVersion: contract.ownerRecordRemovalJobVersion,
    operation: contract.ownerRecordRemovalOperation,
    requestId: "request_owner_removal_1",
    callerUid,
    targetUid,
    ...overrides,
  };
}

function resumeRequest(overrides = {}) {
  return {...claimRequest(), jobId: jobId(), ...overrides};
}

function completeJob() {
  return contract.buildOwnerRecordRemovalJobDocument({
    operation: contract.ownerRecordRemovalOperation,
    jobId: jobId(),
    requestId: claimRequest().requestId,
    callerFingerprint:
      contract.createOwnerRecordRemovalCallerFingerprint(callerUid),
    targetUid,
    status: "complete",
    phase: "complete",
    sourceGeneration,
    completionGeneration: sourceGeneration + 1,
    cutoverApplied: true,
    billingGateCategory: "inactive",
    failureCategory: null,
    ...contract.createEmptyOwnerRecordRemovalCounters(),
    createdAt,
    updatedAt: claimAt,
    completedAt: claimAt,
  });
}

async function expectClaimError(action, expectedCode) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof store.OwnerRecordRemovalClaimError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, "Owner-record removal is unavailable.");
    return true;
  });
}

function assertNoSourceMutation(database) {
  assert.deepEqual(database.queries, []);
  assert.deepEqual(database.deletes, []);
  assert.ok(database.writes.every(({path}) =>
    path === ownerPath() || path === jobPath()));
}

test("strict request and authoritative security checks precede every product read", async () => {
  {
    const fixture = context();
    await expectClaimError(
      store.claimOwnerRecordRemoval(fixture.context, {
        ...claimRequest(),
        isAdmin: true,
      }),
      "invalid_request",
    );
    assert.deepEqual(fixture.database.timeline, []);
  }
  {
    const fixture = context({
      authorityOptions: {
        callerResult: {uid: callerUid, isAdmin: false},
      },
    });
    await expectClaimError(
      store.claimOwnerRecordRemoval(fixture.context, claimRequest()),
      "permission_denied",
    );
    assert.deepEqual(fixture.database.timeline, [`auth:caller:${callerUid}`]);
  }
  {
    const fixture = context();
    await expectClaimError(
      store.claimOwnerRecordRemoval(
        fixture.context,
        claimRequest({callerUid: targetUid}),
      ),
      "self_target_forbidden",
    );
    assert.deepEqual(fixture.database.timeline, [`auth:caller:${targetUid}`]);
  }
  for (const targetResult of [
    {uid: targetUid, email: "owner@example.com", customClaims: {admin: true}},
    {
      uid: targetUid,
      email: "  SCHUYLER.COLE@GMAIL.COM ",
      customClaims: {},
    },
  ]) {
    const fixture = context({authorityOptions: {targetResult}});
    await expectClaimError(
      store.claimOwnerRecordRemoval(fixture.context, claimRequest()),
      "target_admin_forbidden",
    );
    assert.deepEqual(fixture.database.timeline, [
      `auth:caller:${callerUid}`,
      `auth:target:${targetUid}`,
    ]);
  }
});

test("malformed and failed authority responses fail closed before database access", async () => {
  for (const authorityOptions of [
    {callerResult: null},
    {callerError: true},
    {callerResult: {uid: callerUid, isAdmin: true, extra: false}},
    {callerResult: {uid: "different-admin", isAdmin: true}},
    {targetError: true},
    {targetResult: {uid: targetUid, email: "x@example.com"}},
    {
      targetResult: {
        uid: targetUid,
        email: "x@example.com",
        customClaims: [],
      },
    },
  ]) {
    const fixture = context({authorityOptions});
    await expectClaimError(
      store.claimOwnerRecordRemoval(fixture.context, claimRequest()),
      "authority_unavailable",
    );
    assert.equal(
      fixture.database.timeline.some((entry) => entry.startsWith("db:")),
      false,
    );
  }
});

test("missing target Auth is allowed and inactive billing applies one atomic cutover", async () => {
  const fixture = context({authorityOptions: {targetResult: null}});
  const result = await store.claimOwnerRecordRemoval(
    fixture.context,
    claimRequest(),
  );

  assert.equal(result.jobId, jobId());
  assert.equal(result.status, "active");
  assert.equal(result.phase, "unclaim_rating_restaurants");
  assert.equal(result.sourceGeneration, sourceGeneration);
  assert.equal(result.completionGeneration, sourceGeneration + 1);
  assert.equal(result.cutoverApplied, true);
  assert.equal(result.billingGateCategory, "inactive");
  assert.equal(result.failureCategory, null);
  assert.equal(
    result.callerFingerprint,
    contract.createOwnerRecordRemovalCallerFingerprint(callerUid),
  );
  assert.equal(JSON.stringify(result).includes(callerUid), false);

  const nextOwner = owner.parseOwnerRecordStateDocument(stored(
    targetUid,
    fixture.database.document(ownerPath()),
  ));
  assert.equal(nextOwner.state, "removing");
  assert.equal(nextOwner.generation, sourceGeneration + 1);
  assert.equal(nextOwner.activeJobId, result.jobId);
  assert.deepEqual(
    fixture.database.document(billingPath()),
    inactiveBilling(),
  );
  assert.deepEqual(fixture.database.writes.map(({path}) => path), [
    ownerPath(),
    jobPath(),
  ]);
  assertNoSourceMutation(fixture.database);
  assert.deepEqual(Object.keys(fixture.authority).sort(), [
    "lookupTargetAuth",
    "resolveCallerAdmin",
  ]);
});

test("claim preserves fake Auth state and makes zero fake Stripe calls", async () => {
  const authState = {
    exists: true,
    disabled: false,
    claims: {restaurantOwner: true, reviewer: true},
    sessions: ["session_canary_1", "session_canary_2"],
    tokens: ["token_canary_1"],
  };
  const authBefore = clone(authState);
  const authMutationCalls = [];
  const stripeState = {
    customer: {id: "cus_retained_canary", deleted: false},
    subscription: {id: "sub_retained_canary", status: "active"},
  };
  const stripeBefore = clone(stripeState);
  const stripeCalls = [];
  const stripe = {
    customers: {
      async del(id) {
        stripeCalls.push(`customers.del:${id}`);
        stripeState.customer.deleted = true;
      },
      async update(id) {
        stripeCalls.push(`customers.update:${id}`);
      },
    },
    subscriptions: {
      async cancel(id) {
        stripeCalls.push(`subscriptions.cancel:${id}`);
        stripeState.subscription.status = "canceled";
      },
      async update(id) {
        stripeCalls.push(`subscriptions.update:${id}`);
      },
    },
  };
  const fixture = context({
    authorityOptions: {
      targetResult: {
        uid: targetUid,
        email: "owner@example.com",
        customClaims: authState.claims,
      },
      authMutationBoundary: {
        state: authState,
        calls: authMutationCalls,
      },
    },
    externalBoundaries: {stripe},
  });

  const result = await store.claimOwnerRecordRemoval(
    fixture.context,
    claimRequest(),
  );

  assert.equal(result.status, "active");
  assert.equal(result.cutoverApplied, true);
  assert.deepEqual(authMutationCalls, []);
  assert.deepEqual(authState, authBefore);
  assert.equal(authState.exists, true);
  assert.equal(authState.disabled, false);
  assert.deepEqual(authState.claims, authBefore.claims);
  assert.deepEqual(authState.sessions, authBefore.sessions);
  assert.deepEqual(authState.tokens, authBefore.tokens);
  assert.deepEqual(stripeCalls, []);
  assert.deepEqual(stripeState, stripeBefore);
  assertNoSourceMutation(fixture.database);
});

test("blocking and unknown billing create only deterministic pre-cutover manual jobs", async () => {
  for (const [billingDocument, expectedCategory, expectedFailure] of [
    [blockingBilling(), "blocking", "billing_resolution_required"],
    [unknownBilling(), "unknown", "billing_state_unknown"],
    [null, "unknown", "billing_state_unknown"],
    [
      {...inactiveBilling(), billingPosture: "blocking"},
      "unknown",
      "billing_state_unknown",
    ],
    [inactiveBilling(sourceGeneration + 1), "unknown", "billing_state_unknown"],
  ]) {
    const documents = {[ownerPath()]: openOwner()};
    if (billingDocument !== null) documents[billingPath()] = billingDocument;
    const database = new FakeDatabase(documents);
    const fixture = context({database});
    const result = await store.claimOwnerRecordRemoval(
      fixture.context,
      claimRequest(),
    );

    assert.equal(result.jobId, jobId());
    assert.equal(result.status, "manual_review_required");
    assert.equal(result.phase, "billing_gate");
    assert.equal(result.cutoverApplied, false);
    assert.equal(result.completionGeneration, null);
    assert.equal(result.billingGateCategory, expectedCategory);
    assert.equal(result.failureCategory, expectedFailure);
    assert.deepEqual(database.document(ownerPath()), openOwner());
    assert.deepEqual(
      database.document(billingPath()),
      billingDocument,
    );
    assert.deepEqual(database.writes.map(({path}) => path), [jobPath()]);
    assertNoSourceMutation(database);
  }
});

test("claim exercises the complete authoritative billing posture matrix", async () => {
  const inactiveFixtures = [
    ["none", inactiveBilling()],
    ["canceled", knownBilling("canceled")],
    ["incomplete_expired", knownBilling("incomplete_expired")],
  ];
  for (const [name, billingDocument] of inactiveFixtures) {
    const database = new FakeDatabase({
      [ownerPath()]: openOwner(),
      [billingPath()]: billingDocument,
    });
    const result = await store.claimOwnerRecordRemoval(
      context({database}).context,
      claimRequest({requestId: `request_inactive_${name}`}),
    );
    assert.equal(result.status, "active", name);
    assert.equal(result.phase, "unclaim_rating_restaurants", name);
    assert.equal(result.billingGateCategory, "inactive", name);
    assert.equal(result.failureCategory, null, name);
    assert.equal(database.document(ownerPath()).state, "removing", name);
    assert.equal(database.document(ownerPath()).generation, 8, name);
    assert.deepEqual(database.document(billingPath()), billingDocument, name);
    assert.deepEqual(database.writes.map(({path}) => path), [
      ownerPath(),
      jobPath(),
    ], name);
    assertNoSourceMutation(database);
  }

  const blockingFixtures = [
    ["active", knownBilling("active")],
    ["trialing", knownBilling("trialing")],
    ["past_due", knownBilling("past_due")],
    ["unpaid", knownBilling("unpaid")],
    ["incomplete", knownBilling("incomplete")],
    ["paused", knownBilling("paused")],
    ["checkout_pending", blockingBilling()],
  ];
  for (const [name, billingDocument] of blockingFixtures) {
    const database = new FakeDatabase({
      [ownerPath()]: openOwner(),
      [billingPath()]: billingDocument,
    });
    const result = await store.claimOwnerRecordRemoval(
      context({database}).context,
      claimRequest({requestId: `request_blocking_${name}`}),
    );
    assert.equal(result.status, "manual_review_required", name);
    assert.equal(result.phase, "billing_gate", name);
    assert.equal(result.billingGateCategory, "blocking", name);
    assert.equal(result.failureCategory, "billing_resolution_required", name);
    assert.deepEqual(database.document(ownerPath()), openOwner(), name);
    assert.deepEqual(database.document(billingPath()), billingDocument, name);
    assert.deepEqual(database.writes.map(({path}) => path), [jobPath()], name);
    assertNoSourceMutation(database);
  }

  const unknownFixtures = [
    ["event_conflict", conflictedBilling("event_order")],
    ["identity_conflict", conflictedBilling("identity")],
    ["unsupported_status", conflictedBilling("unsupported_status")],
  ];
  for (const [name, billingDocument] of unknownFixtures) {
    const database = new FakeDatabase({
      [ownerPath()]: openOwner(),
      [billingPath()]: billingDocument,
    });
    const result = await store.claimOwnerRecordRemoval(
      context({database}).context,
      claimRequest({requestId: `request_unknown_${name}`}),
    );
    assert.equal(result.status, "manual_review_required", name);
    assert.equal(result.phase, "billing_gate", name);
    assert.equal(result.billingGateCategory, "unknown", name);
    assert.equal(result.failureCategory, "billing_state_unknown", name);
    assert.deepEqual(database.document(ownerPath()), openOwner(), name);
    assert.deepEqual(database.document(billingPath()), billingDocument, name);
    assert.deepEqual(database.writes.map(({path}) => path), [jobPath()], name);
    assertNoSourceMutation(database);
  }
});

test("exact retry is stable while a different request conflicts without mutation", async () => {
  const fixture = context();
  const first = await store.claimOwnerRecordRemoval(
    fixture.context,
    claimRequest(),
  );
  const writeCount = fixture.database.writes.length;
  const second = await store.claimOwnerRecordRemoval(
    fixture.context,
    claimRequest(),
  );
  assert.deepEqual(second, first);
  assert.equal(fixture.database.writes.length, writeCount);
  assert.equal(fixture.database.document(ownerPath()).generation, 8);

  await expectClaimError(
    store.claimOwnerRecordRemoval(
      fixture.context,
      claimRequest({requestId: "request_owner_removal_2"}),
    ),
    "operation_conflict",
  );
  assert.equal(fixture.database.writes.length, writeCount);
});

test("removing and removed owner states accept only their exact existing job", async () => {
  const activeFixture = context();
  const active = await store.claimOwnerRecordRemoval(
    activeFixture.context,
    claimRequest(),
  );
  activeFixture.database.writes.length = 0;
  assert.deepEqual(
    await store.claimOwnerRecordRemoval(activeFixture.context, claimRequest()),
    active,
  );
  assert.deepEqual(activeFixture.database.writes, []);

  const complete = completeJob();
  const completeDatabase = new FakeDatabase({
    [ownerPath()]: nonOpenOwner("removed"),
    [jobPath()]: complete,
  });
  assert.deepEqual(
    await store.claimOwnerRecordRemoval(
      context({database: completeDatabase}).context,
      claimRequest(),
    ),
    complete,
  );
  assert.deepEqual(completeDatabase.writes, []);

  for (const state of ["removing", "removed"]) {
    const database = new FakeDatabase({
      [ownerPath()]: nonOpenOwner(state),
    });
    await expectClaimError(
      store.claimOwnerRecordRemoval(
        context({database}).context,
        claimRequest(),
      ),
      "generation_mismatch",
    );
    assert.deepEqual(database.writes, []);
  }
});

test("an open completion generation rejects stale active work but permits exact complete audit retry", async () => {
  const activeFixture = context();
  await store.claimOwnerRecordRemoval(
    activeFixture.context,
    claimRequest(),
  );
  activeFixture.database.documents.set(
    ownerPath(),
    clone(owner.buildOwnerRecordStateDocument({
      ownerUid: targetUid,
      generation: sourceGeneration + 1,
      state: "open",
      activeJobId: null,
      createdAt,
      updatedAt: resumeAt,
    })),
  );
  activeFixture.database.documents.set(
    billingPath(),
    clone(inactiveBilling(sourceGeneration + 1)),
  );
  activeFixture.database.writes.length = 0;

  await expectClaimError(
    store.claimOwnerRecordRemoval(activeFixture.context, claimRequest()),
    "generation_mismatch",
  );
  await expectClaimError(
    store.resumeOwnerRecordRemovalAfterBilling(
      activeFixture.context,
      resumeRequest(),
    ),
    "generation_mismatch",
  );
  assert.deepEqual(activeFixture.database.writes, []);
  assert.equal(activeFixture.database.documents.has(jobPath(8)), false);
  assert.equal(activeFixture.database.document(ownerPath()).state, "open");
  assert.equal(activeFixture.database.document(ownerPath()).generation, 8);

  const completed = completeJob();
  const completeDatabase = new FakeDatabase({
    [ownerPath()]: owner.buildOwnerRecordStateDocument({
      ownerUid: targetUid,
      generation: sourceGeneration + 1,
      state: "open",
      activeJobId: null,
      createdAt,
      updatedAt: resumeAt,
    }),
    [billingPath()]: inactiveBilling(sourceGeneration + 1),
    [jobPath()]: completed,
  });
  const auditRetry = await store.resumeOwnerRecordRemovalAfterBilling(
    context({database: completeDatabase, now: resumeAt}).context,
    resumeRequest(),
  );
  assert.deepEqual(auditRetry, completed);
  assert.deepEqual(completeDatabase.writes, []);
  assert.equal(completeDatabase.document(ownerPath()).state, "open");
  assert.equal(completeDatabase.document(ownerPath()).generation, 8);
});

test("resume reauthorizes and applies an inactive billing cutover exactly once", async () => {
  const database = new FakeDatabase({
    [ownerPath()]: openOwner(),
    [billingPath()]: blockingBilling(),
  });
  const initial = context({database});
  const blocked = await store.claimOwnerRecordRemoval(
    initial.context,
    claimRequest(),
  );
  assert.equal(blocked.phase, "billing_gate");
  database.documents.set(billingPath(), clone(inactiveBilling()));
  const writesBeforeResume = database.writes.length;

  const resumedFixture = context({database, now: resumeAt});
  const resumed = await store.resumeOwnerRecordRemovalAfterBilling(
    resumedFixture.context,
    resumeRequest(),
  );
  assert.equal(resumed.status, "active");
  assert.equal(resumed.phase, "unclaim_rating_restaurants");
  assert.equal(resumed.cutoverApplied, true);
  assert.equal(database.document(ownerPath()).generation, 8);
  assert.deepEqual(
    database.writes.slice(writesBeforeResume).map(({path}) => path),
    [ownerPath(), jobPath()],
  );

  const writeCount = database.writes.length;
  const exactRetry = await store.resumeOwnerRecordRemovalAfterBilling(
    resumedFixture.context,
    resumeRequest(),
  );
  assert.deepEqual(exactRetry, resumed);
  assert.equal(database.writes.length, writeCount);
  assert.equal(database.document(ownerPath()).generation, 8);
  assert.equal(
    database.timeline.filter((entry) => entry === `auth:caller:${callerUid}`).length,
    3,
  );
  assertNoSourceMutation(database);
});

test("concurrent billing-gate resumes apply one generation cutover", async () => {
  const database = new FakeDatabase({
    [ownerPath()]: openOwner(),
    [billingPath()]: blockingBilling(),
  });
  const fixture = context({database, now: resumeAt});
  const blocked = await store.claimOwnerRecordRemoval(
    fixture.context,
    claimRequest(),
  );
  assert.equal(blocked.status, "manual_review_required");
  assert.equal(blocked.phase, "billing_gate");
  assert.equal(blocked.cutoverApplied, false);

  database.documents.set(billingPath(), clone(inactiveBilling()));
  const writesBeforeRace = database.writes.length;
  const [workerA, workerB] = await Promise.all([
    store.resumeOwnerRecordRemovalAfterBilling(
      fixture.context,
      resumeRequest(),
    ),
    store.resumeOwnerRecordRemovalAfterBilling(
      fixture.context,
      resumeRequest(),
    ),
  ]);

  assert.deepEqual(workerA, workerB);
  assert.equal(workerA.status, "active");
  assert.equal(workerA.phase, "unclaim_rating_restaurants");
  assert.equal(workerA.sourceGeneration, sourceGeneration);
  assert.equal(workerA.completionGeneration, sourceGeneration + 1);
  assert.equal(workerA.cutoverApplied, true);
  assert.deepEqual(
    database.writes.slice(writesBeforeRace).map(({path}) => path),
    [ownerPath(), jobPath()],
  );
  assert.equal(database.document(ownerPath()).state, "removing");
  assert.equal(database.document(ownerPath()).generation, sourceGeneration + 1);
  assert.equal(database.document(ownerPath()).activeJobId, jobId());
  assert.deepEqual(database.document(jobPath()), workerA);
  assert.equal(database.documents.size, 3);
  assertNoSourceMutation(database);
});

test("resume retains a still-blocked gate and rejects mismatched identity", async () => {
  const database = new FakeDatabase({
    [ownerPath()]: openOwner(),
    [billingPath()]: blockingBilling(),
  });
  const fixture = context({database});
  const blocked = await store.claimOwnerRecordRemoval(
    fixture.context,
    claimRequest(),
  );
  const writeCount = database.writes.length;
  assert.deepEqual(
    await store.resumeOwnerRecordRemovalAfterBilling(
      fixture.context,
      resumeRequest(),
    ),
    blocked,
  );
  assert.equal(database.writes.length, writeCount);

  await expectClaimError(
    store.resumeOwnerRecordRemovalAfterBilling(
      fixture.context,
      resumeRequest({requestId: "request_owner_removal_other"}),
    ),
    "operation_conflict",
  );
  assert.equal(database.writes.length, writeCount);
});

test("generation overflow and malformed private state fail closed", async () => {
  {
    const database = new FakeDatabase({
      [ownerPath()]: openOwner(Number.MAX_SAFE_INTEGER),
      [billingPath()]: inactiveBilling(Number.MAX_SAFE_INTEGER),
    });
    await expectClaimError(
      store.claimOwnerRecordRemoval(
        context({database}).context,
        claimRequest(),
      ),
      "generation_exhausted",
    );
    assert.deepEqual(database.writes, []);
  }
  {
    const database = new FakeDatabase({[billingPath()]: inactiveBilling()});
    await expectClaimError(
      store.claimOwnerRecordRemoval(
        context({database}).context,
        claimRequest(),
      ),
      "owner_state_unavailable",
    );
    assert.deepEqual(database.writes, []);
  }
  for (const documents of [
    {[ownerPath()]: {...openOwner(), state: "corrupt"}},
    {
      [ownerPath()]: openOwner(),
      [billingPath()]: inactiveBilling(),
      [jobPath()]: {version: contract.ownerRecordRemovalJobVersion},
    },
  ]) {
    const database = new FakeDatabase(documents);
    await expectClaimError(
      store.claimOwnerRecordRemoval(
        context({database}).context,
        claimRequest(),
      ),
      "malformed_private_state",
    );
    assert.deepEqual(database.writes, []);
  }
});

test("generation overflow preserves deterministic request-conflict precedence", async () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const maximumJobPath = jobPath(maximum);
  const database = new FakeDatabase({
    [ownerPath()]: openOwner(maximum),
    [billingPath()]: blockingBilling(maximum),
  });
  const fixture = context({database});
  const gate = await store.claimOwnerRecordRemoval(
    fixture.context,
    claimRequest({requestId: "request_maximum_a"}),
  );
  assert.equal(gate.jobId, jobId(maximum));
  assert.equal(gate.status, "manual_review_required");
  database.documents.set(billingPath(), clone(inactiveBilling(maximum)));
  const writeCount = database.writes.length;

  await expectClaimError(
    store.claimOwnerRecordRemoval(
      fixture.context,
      claimRequest({requestId: "request_maximum_b"}),
    ),
    "operation_conflict",
  );
  await expectClaimError(
    store.claimOwnerRecordRemoval(
      fixture.context,
      claimRequest({requestId: "request_maximum_a"}),
    ),
    "generation_exhausted",
  );
  assert.equal(database.writes.length, writeCount);
  assert.deepEqual(database.document(maximumJobPath), gate);
  assert.equal(database.document(ownerPath()).generation, maximum);
  assert.equal(database.document(ownerPath()).state, "open");
  assert.deepEqual(database.queries, []);
  assert.deepEqual(database.deletes, []);
});

test("a transaction failure after a staged owner write commits nothing", async () => {
  const base = new FakeDatabase({
    [ownerPath()]: openOwner(),
    [billingPath()]: inactiveBilling(),
  });
  const originalRunTransaction = base.runTransaction.bind(base);
  base.runTransaction = (operation) => originalRunTransaction(async (tx) => {
    const wrapped = {
      ...tx,
      setDocument(path, data, options) {
        if (path === jobPath()) throw new Error("injected transaction failure");
        tx.setDocument(path, data, options);
      },
    };
    return operation(wrapped);
  });
  const beforeOwner = base.document(ownerPath());
  await assert.rejects(
    store.claimOwnerRecordRemoval(
      context({database: base}).context,
      claimRequest(),
    ),
    /injected transaction failure/u,
  );
  assert.deepEqual(base.document(ownerPath()), beforeOwner);
  assert.equal(base.document(jobPath()), null);
  assertNoSourceMutation(base);
});

test("concurrent exact claims serialize to one cutover and one job", async () => {
  const fixture = context();
  const [first, second] = await Promise.all([
    store.claimOwnerRecordRemoval(fixture.context, claimRequest()),
    store.claimOwnerRecordRemoval(fixture.context, claimRequest()),
  ]);
  assert.deepEqual(first, second);
  assert.equal(fixture.database.transactionCount, 2);
  assert.deepEqual(fixture.database.writes.map(({path}) => path), [
    ownerPath(),
    jobPath(),
  ]);
  assert.equal(fixture.database.document(ownerPath()).generation, 8);
  assert.equal(fixture.database.documents.has(jobPath()), true);
  assert.equal(fixture.database.documents.size, 3);
  assertNoSourceMutation(fixture.database);
});

test("concurrent different requests admit one winner and no alternate job", async () => {
  const fixture = context();
  const outcomes = await Promise.allSettled([
    store.claimOwnerRecordRemoval(
      fixture.context,
      claimRequest({requestId: "request_race_a"}),
    ),
    store.claimOwnerRecordRemoval(
      fixture.context,
      claimRequest({requestId: "request_race_b"}),
    ),
  ]);
  assert.deepEqual(outcomes.map(({status}) => status).sort(), [
    "fulfilled",
    "rejected",
  ]);
  const rejected = outcomes.find(({status}) => status === "rejected");
  assert.ok(rejected.reason instanceof store.OwnerRecordRemovalClaimError);
  assert.equal(rejected.reason.code, "operation_conflict");
  assert.deepEqual(fixture.database.writes.map(({path}) => path), [
    ownerPath(),
    jobPath(),
  ]);
  assert.equal(fixture.database.document(ownerPath()).generation, 8);
  assert.equal(fixture.database.documents.has(jobPath()), true);
  assert.equal(fixture.database.documents.size, 3);
  assertNoSourceMutation(fixture.database);
});
