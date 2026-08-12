"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const inventory = require(
  "../lib/owner_record_generation_migration_store.js",
);

const uid = "migration-owner-uid";
const readTime = {seconds: "1786560000", nanoseconds: 123_456_789};

function fixture(path, data = {}, offset = 0) {
  return {
    path,
    data,
    updateTime: {
      seconds: String(Number(readTime.seconds) + offset),
      nanoseconds: readTime.nanoseconds,
    },
  };
}

function createStore(documents) {
  return inventory.createInMemoryOwnerRecordGenerationMigrationStore({
    documents,
    readTime,
  });
}

function assertInventoryError(action, code) {
  assert.throws(action, (error) => {
    assert.equal(
      error.name,
      "OwnerRecordGenerationMigrationInventoryError",
    );
    assert.equal(error.code, code);
    assert.equal(error.message.includes(uid), false);
    return true;
  });
}

async function assertInventoryRejection(action, code) {
  await assert.rejects(action, (error) => {
    assert.equal(
      error.name,
      "OwnerRecordGenerationMigrationInventoryError",
    );
    assert.equal(error.code, code);
    assert.equal(error.message.includes(uid), false);
    return true;
  });
}

test("Firestore inventory surface is closed and read-only", async () => {
  assert.equal(inventory.ownerRecordGenerationMigrationFirestorePageLimit, 100);
  assert.deepEqual(
    [...inventory.ownerRecordGenerationMigrationChildCollections],
    [
      "coupons",
      "daily_specials",
      "coupon_number_reservations",
      "coupon_code_reservations",
      "menu_images",
      "menu_items",
      "menu_sections",
    ],
  );

  const store = createStore([]);
  assert.deepEqual(Object.keys(store), ["runReadOnlyInventory"]);
  await store.runReadOnlyInventory(async (reader) => {
    assert.deepEqual(Object.keys(reader).sort(), [
      "getBillingState",
      "getCanonicalAccountRoot",
      "getOwnerState",
      "getSubscriptionReturnState",
      "listChildDocuments",
      "listClaimedRatingRestaurants",
      "listRemovalJobs",
    ]);
    for (const forbidden of [
      "create",
      "delete",
      "set",
      "update",
      "batch",
      "bulkWriter",
      "runTransaction",
      "collection",
      "collectionGroup",
    ]) {
      assert.equal(reader[forbidden], undefined);
    }
  });
});

test("direct reads use only four exact UID-derived paths with update times", async () => {
  const documents = [
    fixture(`restaurant_accounts/${uid}`, {ownerRecordGeneration: 0}, 1),
    fixture(`private_owner_record_states/${uid}`, {state: "open"}, 2),
    fixture(`private_owner_billing_states/${uid}`, {lifecycleState: "none"}, 3),
    fixture(`private_subscription_return_state/${uid}`, {schemaVersion: 2}, 4),
  ];
  const store = createStore(documents);
  await store.runReadOnlyInventory(async (reader) => {
    const results = await Promise.all([
      reader.getCanonicalAccountRoot(uid),
      reader.getOwnerState(uid),
      reader.getBillingState(uid),
      reader.getSubscriptionReturnState(uid),
    ]);
    assert.deepEqual(results.map((result) => result.path),
      documents.map((document) => document.path));
    assert.deepEqual(results.map((result) => result.updateTime),
      documents.map((document) => document.updateTime));
    assert.deepEqual(results.map((result) => result.readTime),
      [readTime, readTime, readTime, readTime]);
    assert.equal(await reader.getCanonicalAccountRoot("empty-owner"), null);
  });
});

test("child pages are ordered, bounded, immutable, and cursor-bound", async () => {
  const store = createStore([
    fixture(`restaurant_accounts/${uid}/coupons/zeta`, {ordinal: 3}),
    fixture(`restaurant_accounts/${uid}/coupons/alpha`, {ordinal: 1}),
    fixture(`restaurant_accounts/${uid}/coupons/beta`, {ordinal: 2}),
    fixture(`restaurant_accounts/${uid}/menu_items/ignored`, {}),
    fixture("restaurant_accounts/other-owner/coupons/ignored", {}),
  ]);

  await store.runReadOnlyInventory(async (reader) => {
    const first = await reader.listChildDocuments({
      targetUid: uid,
      collection: "coupons",
      pageSize: 2,
    });
    assert.deepEqual(first.documents.map((document) => document.id), [
      "alpha",
      "beta",
    ]);
    assert.deepEqual(first.readTime, readTime);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.documents), true);
    assert.deepEqual(first.nextCursor, {
      version: inventory.ownerRecordGenerationMigrationFirestoreCursorVersion,
      scope: "child:coupons",
      targetUid: uid,
      afterDocumentId: "beta",
    });

    const second = await reader.listChildDocuments({
      targetUid: uid,
      collection: "coupons",
      pageSize: 2,
      cursor: first.nextCursor,
    });
    assert.deepEqual(second.documents.map((document) => document.id), ["zeta"]);
    assert.equal(second.nextCursor, null);

    await assertInventoryRejection(
      () => reader.listChildDocuments({
        targetUid: uid,
        collection: "menu_items",
        pageSize: 2,
        cursor: first.nextCursor,
      }),
      "invalid_cursor",
    );
    await assertInventoryRejection(
      () => reader.listChildDocuments({
        targetUid: "other-owner",
        collection: "coupons",
        pageSize: 2,
        cursor: first.nextCursor,
      }),
      "invalid_cursor",
    );
  });
});

test("claimed restaurants and removal jobs use exact owner predicates", async () => {
  const store = createStore([
    fixture("bitescore_restaurants/rating-b", {ownerUserId: uid}),
    fixture("bitescore_restaurants/rating-a", {ownerUserId: uid}),
    fixture("bitescore_restaurants/not-owned", {ownerUserId: "other-owner"}),
    fixture("bitescore_restaurants/unclaimed", {ownerUserId: null}),
    fixture("private_owner_record_removal_jobs/job-b", {targetUid: uid}),
    fixture("private_owner_record_removal_jobs/job-a", {targetUid: uid}),
    fixture("private_owner_record_removal_jobs/not-related", {
      targetUid: "other-owner",
    }),
  ]);

  await store.runReadOnlyInventory(async (reader) => {
    const claims = await reader.listClaimedRatingRestaurants({
      targetUid: uid,
      pageSize: 100,
    });
    assert.deepEqual(claims.documents.map((document) => document.id), [
      "rating-a",
      "rating-b",
    ]);
    const jobs = await reader.listRemovalJobs({
      targetUid: uid,
      pageSize: 100,
    });
    assert.deepEqual(jobs.documents.map((document) => document.id), [
      "job-a",
      "job-b",
    ]);
  });
});

test("Firestore request and fixture boundaries reject arbitrary scope and bounds", async () => {
  for (const path of [
    "users/customer",
    `restaurant_accounts/${uid}/unknown_children/item`,
    `restaurant_accounts/${uid}/coupons/nested/item`,
    "private_owner_record_states/bad/uid",
  ]) {
    assertInventoryError(
      () => createStore([fixture(path)]),
      "invalid_request",
    );
  }
  assertInventoryError(
    () => createStore([
      fixture(`restaurant_accounts/${uid}`, {}),
      fixture(`restaurant_accounts/${uid}`, {}),
    ]),
    "invalid_request",
  );
  assertInventoryError(
    () => createStore([fixture(`restaurant_accounts/${uid}`, {}, 0), {
      path: `private_owner_record_states/${uid}`,
      data: {},
      updateTime: {seconds: 1, nanoseconds: 1_000_000_000},
    }]),
    "invalid_provider_response",
  );

  const store = createStore([]);
  await store.runReadOnlyInventory(async (reader) => {
    for (const pageSize of [0, -1, 101, 1.5, "25", undefined]) {
      await assertInventoryRejection(
        () => reader.listRemovalJobs({targetUid: uid, pageSize}),
        "invalid_request",
      );
    }
    await assertInventoryRejection(
      () => reader.listChildDocuments({
        targetUid: uid,
        collection: "arbitrary",
        pageSize: 1,
      }),
      "invalid_request",
    );
    await assertInventoryRejection(
      () => reader.listClaimedRatingRestaurants({
        targetUid: uid,
        pageSize: 1,
        arbitraryCollection: "users",
      }),
      "invalid_request",
    );
  });
});

test("production Firestore factory explicitly requests a read-only transaction", async () => {
  let options = null;
  let operationCount = 0;
  const database = {
    doc() {},
    collection() {},
    runTransaction: async (operation, suppliedOptions) => {
      options = suppliedOptions;
      operationCount += 1;
      return operation({});
    },
  };
  const store = inventory.createFirestoreOwnerRecordGenerationMigrationStore(
    database,
  );
  const result = await store.runReadOnlyInventory(async (reader) => {
    assert.equal(typeof reader.getCanonicalAccountRoot, "function");
    return "read-only-result";
  });
  assert.equal(result, "read-only-result");
  assert.equal(operationCount, 1);
  assert.deepEqual(options, {readOnly: true});
});

test("production Firestore queries derive exact allowlisted paths and predicates", async () => {
  const queries = [];
  const directPaths = [];
  let forbiddenCallCount = 0;

  class Query {
    constructor(path) {
      this.path = path;
      this.whereClauses = [];
      this.orderClauses = [];
      this.startAfterValues = [];
      this.maximum = null;
    }

    where(field, operator, value) {
      this.whereClauses.push({field, operator, value});
      return this;
    }

    orderBy(field, direction) {
      this.orderClauses.push({field, direction});
      return this;
    }

    startAfter(...values) {
      this.startAfterValues.push(...values);
      return this;
    }

    limit(value) {
      this.maximum = value;
      return this;
    }
  }

  const transaction = {
    async get(value) {
      if (value instanceof Query) {
        queries.push(value);
        return {
          docs: [],
          readTime: {seconds: 1_786_560_000, nanoseconds: 99},
        };
      }
      directPaths.push(value.path);
      return {
        id: value.path.split("/").pop(),
        exists: false,
        ref: {path: value.path},
        readTime: {seconds: 1_786_560_000, nanoseconds: 99},
        data: () => undefined,
      };
    },
  };
  const database = {
    doc(path) {
      return {path};
    },
    collection(path) {
      return new Query(path);
    },
    async runTransaction(operation, options) {
      assert.deepEqual(options, {readOnly: true});
      return operation(transaction);
    },
    batch() {
      forbiddenCallCount += 1;
    },
    bulkWriter() {
      forbiddenCallCount += 1;
    },
  };
  const store = inventory.createFirestoreOwnerRecordGenerationMigrationStore(
    database,
  );
  await store.runReadOnlyInventory(async (reader) => {
    await reader.getCanonicalAccountRoot(uid);
    await reader.getOwnerState(uid);
    await reader.getBillingState(uid);
    await reader.getSubscriptionReturnState(uid);
    await reader.listChildDocuments({
      targetUid: uid,
      collection: "menu_sections",
      pageSize: 3,
      cursor: {
        version:
          inventory.ownerRecordGenerationMigrationFirestoreCursorVersion,
        scope: "child:menu_sections",
        targetUid: uid,
        afterDocumentId: "prior-item",
      },
    });
    await reader.listClaimedRatingRestaurants({targetUid: uid, pageSize: 4});
    await reader.listRemovalJobs({targetUid: uid, pageSize: 5});
  });

  assert.deepEqual(directPaths, [
    `restaurant_accounts/${uid}`,
    `private_owner_record_states/${uid}`,
    `private_owner_billing_states/${uid}`,
    `private_subscription_return_state/${uid}`,
  ]);
  assert.equal(queries.length, 3);
  assert.equal(queries[0].path,
    `restaurant_accounts/${uid}/menu_sections`);
  assert.deepEqual(queries[0].whereClauses, []);
  assert.deepEqual(queries[0].startAfterValues, ["prior-item"]);
  assert.equal(queries[0].maximum, 3);
  assert.equal(queries[0].orderClauses.length, 1);
  assert.equal(queries[0].orderClauses[0].direction, "asc");
  assert.equal(queries[1].path, "bitescore_restaurants");
  assert.deepEqual(queries[1].whereClauses, [{
    field: "ownerUserId",
    operator: "==",
    value: uid,
  }]);
  assert.equal(queries[1].maximum, 4);
  assert.equal(queries[2].path, "private_owner_record_removal_jobs");
  assert.deepEqual(queries[2].whereClauses, [{
    field: "targetUid",
    operator: "==",
    value: uid,
  }]);
  assert.equal(queries[2].maximum, 5);
  assert.equal(forbiddenCallCount, 0);
});
