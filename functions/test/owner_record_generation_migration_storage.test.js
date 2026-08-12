"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const inventory = require(
  "../lib/owner_record_generation_migration_storage.js",
);

const uid = "migration-storage-owner";

function name(kind, suffix) {
  return `${inventory.buildOwnerRecordGenerationMigrationStoragePrefix(
    uid,
    kind,
  )}${suffix}`;
}

function object(kind, suffix, changes = {}) {
  return {
    name: name(kind, suffix),
    providerGeneration: "10000000000000000001",
    metageneration: "7",
    size: "2048",
    contentType: "image/webp",
    ownerRecordGeneration: null,
    ...changes,
  };
}

function assertStorageError(action, code) {
  assert.throws(action, (error) => {
    assert.equal(error.name, "OwnerRecordGenerationMigrationStorageError");
    assert.equal(error.code, code);
    assert.equal(error.message.includes(uid), false);
    return true;
  });
}

async function assertStorageRejection(action, code) {
  await assert.rejects(action, (error) => {
    assert.equal(error.name, "OwnerRecordGenerationMigrationStorageError");
    assert.equal(error.code, code);
    assert.equal(error.message.includes(uid), false);
    return true;
  });
}

test("Storage inventory exposes only exact prefixes and one read method", async () => {
  assert.equal(inventory.ownerRecordGenerationMigrationStoragePageLimit, 25);
  assert.equal(
    inventory.ownerRecordGenerationMigrationStorageMetadataKey,
    "ownerRecordGeneration",
  );
  assert.deepEqual([...inventory.ownerRecordGenerationMigrationStorageKinds], [
    "restaurant_images",
    "coupon_images",
    "menu_images",
  ]);
  for (const kind of inventory.ownerRecordGenerationMigrationStorageKinds) {
    assert.equal(
      inventory.buildOwnerRecordGenerationMigrationStoragePrefix(uid, kind),
      `bitesaver_restaurants/${uid}/${kind}/`,
    );
  }
  for (const invalid of ["unknown", "restaurant_images/other", "", null]) {
    assertStorageError(
      () => inventory.buildOwnerRecordGenerationMigrationStoragePrefix(
        uid,
        invalid,
      ),
      "invalid_request",
    );
  }

  const store = inventory
    .createInMemoryOwnerRecordGenerationMigrationStorageInventory([]);
  assert.deepEqual(Object.keys(store), ["listObjects"]);
  for (const forbidden of [
    "delete",
    "download",
    "file",
    "getDownloadURL",
    "getMetadata",
    "setMetadata",
    "save",
    "upload",
  ]) {
    assert.equal(store[forbidden], undefined);
  }
});

test("in-memory Storage inventory normalizes order and paginates stably", async () => {
  const store = inventory
    .createInMemoryOwnerRecordGenerationMigrationStorageInventory([
      object("coupon_images", "zeta.webp"),
      object("coupon_images", "alpha.webp"),
      object("coupon_images", "beta.webp", {
        ownerRecordGeneration: "0",
      }),
      object("menu_images", "ignored.webp"),
      {
        ...object("coupon_images", "other-owner.webp"),
        name: "bitesaver_restaurants/other-owner/coupon_images/object.webp",
      },
    ]);
  const first = await store.listObjects({
    targetUid: uid,
    kind: "coupon_images",
    pageSize: 2,
  });
  assert.deepEqual(first.objects.map((entry) => entry.name), [
    name("coupon_images", "alpha.webp"),
    name("coupon_images", "beta.webp"),
  ]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.objects), true);
  assert.deepEqual(first.nextCursor, {
    version: inventory.ownerRecordGenerationMigrationStorageCursorVersion,
    targetUid: uid,
    kind: "coupon_images",
    pageToken: "2",
    afterObjectName: name("coupon_images", "beta.webp"),
  });

  const second = await store.listObjects({
    targetUid: uid,
    kind: "coupon_images",
    pageSize: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(second.objects.map((entry) => entry.name), [
    name("coupon_images", "zeta.webp"),
  ]);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(Object.keys(second.objects[0]).sort(), [
    "contentType",
    "metageneration",
    "name",
    "ownerRecordGeneration",
    "providerGeneration",
    "size",
  ]);
});

test("Storage cursor is bound to exact owner, kind, token, and last object", async () => {
  const store = inventory
    .createInMemoryOwnerRecordGenerationMigrationStorageInventory([
      object("restaurant_images", "a.webp"),
      object("restaurant_images", "b.webp"),
    ]);
  const first = await store.listObjects({
    targetUid: uid,
    kind: "restaurant_images",
    pageSize: 1,
  });
  assert.notEqual(first.nextCursor, null);

  for (const cursor of [
    {...first.nextCursor, targetUid: "other-owner"},
    {...first.nextCursor, kind: "menu_images"},
    {...first.nextCursor, pageToken: "0"},
    {...first.nextCursor, afterObjectName: name("restaurant_images", "b.webp")},
    {...first.nextCursor, version: "unknown"},
    {...first.nextCursor, extra: true},
  ]) {
    await assertStorageRejection(
      () => store.listObjects({
        targetUid: uid,
        kind: "restaurant_images",
        pageSize: 1,
        cursor,
      }),
      "invalid_cursor",
    );
  }
});

test("Storage request and fixture boundary rejects arbitrary scope and bounds", async () => {
  for (const candidate of [
    {...object("menu_images", "x.webp"), name: "unrelated/x.webp"},
    {...object("menu_images", "x.webp"), name: name("menu_images", "")},
    {...object("menu_images", "x.webp"), extra: true},
  ]) {
    assertStorageError(
      () => inventory
        .createInMemoryOwnerRecordGenerationMigrationStorageInventory([
          candidate,
        ]),
      "invalid_request",
    );
  }
  assertStorageError(
    () => inventory
      .createInMemoryOwnerRecordGenerationMigrationStorageInventory([
        object("menu_images", "duplicate.webp"),
        object("menu_images", "duplicate.webp"),
      ]),
    "invalid_request",
  );

  const store = inventory
    .createInMemoryOwnerRecordGenerationMigrationStorageInventory([]);
  for (const pageSize of [0, -1, 26, 1.5, "25", undefined]) {
    await assertStorageRejection(
      () => store.listObjects({
        targetUid: uid,
        kind: "menu_images",
        pageSize,
      }),
      "invalid_request",
    );
  }
  await assertStorageRejection(
    () => store.listObjects({
      targetUid: uid,
      kind: "arbitrary",
      pageSize: 1,
    }),
    "invalid_request",
  );
  await assertStorageRejection(
    () => store.listObjects({
      targetUid: uid,
      kind: "menu_images",
      pageSize: 1,
      prefix: "users/",
    }),
    "invalid_request",
  );
});

test("production Storage boundary lists only safe fields and never downloads", async () => {
  const calls = [];
  let forbiddenCallCount = 0;
  const providerFiles = [
    {
      name: name("restaurant_images", "a.webp"),
      generation: "99",
      metageneration: "3",
      size: "2048",
      contentType: "image/webp",
      metadata: {
        ownerRecordGeneration: "0",
        firebaseStorageDownloadTokens: "must-not-leak",
        unrelated: "must-not-leak",
      },
    },
  ];
  const bucket = {
    async getFiles(options) {
      calls.push({...options});
      return [providerFiles, {pageToken: "provider-token-2"}, {}];
    },
    file() {
      forbiddenCallCount += 1;
    },
    deleteFiles() {
      forbiddenCallCount += 1;
    },
  };
  const store = inventory
    .createStorageOwnerRecordGenerationMigrationStore(bucket);
  const page = await store.listObjects({
    targetUid: uid,
    kind: "restaurant_images",
    pageSize: 1,
  });

  assert.equal(forbiddenCallCount, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    autoPaginate: false,
    fields: inventory.ownerRecordGenerationMigrationStorageListFields,
    maxResults: 1,
    prefix: `bitesaver_restaurants/${uid}/restaurant_images/`,
    versions: false,
  });
  assert.deepEqual(page.objects, [{
    name: name("restaurant_images", "a.webp"),
    providerGeneration: "99",
    metageneration: "3",
    size: "2048",
    contentType: "image/webp",
    ownerRecordGeneration: "0",
  }]);
  assert.equal(JSON.stringify(page).includes("must-not-leak"), false);
  assert.deepEqual(page.nextCursor, {
    version: inventory.ownerRecordGenerationMigrationStorageCursorVersion,
    targetUid: uid,
    kind: "restaurant_images",
    pageToken: "provider-token-2",
    afterObjectName: name("restaurant_images", "a.webp"),
  });
});

test("production Storage adapter preserves missing/malformed safe metadata", async () => {
  const prefix = inventory.buildOwnerRecordGenerationMigrationStoragePrefix(
    uid,
    "menu_images",
  );
  const bucket = {
    async getFiles() {
      return [[
        {name: `${prefix}a.webp`},
        {name: `${prefix}b.webp`, metadata: "malformed"},
        {name: `${prefix}c.webp`, metadata: {ownerRecordGeneration: null}},
      ], {}, {}];
    },
  };
  const store = inventory
    .createStorageOwnerRecordGenerationMigrationStore(bucket);
  const page = await store.listObjects({
    targetUid: uid,
    kind: "menu_images",
    pageSize: 3,
  });
  assert.equal(page.objects[0].ownerRecordGeneration, null);
  assert.equal(page.objects[0].providerGeneration, null);
  assert.equal(page.objects[1].ownerRecordGeneration.malformed, true);
  assert.equal(page.objects[1].providerGeneration, null);
  assert.equal(page.objects[2].ownerRecordGeneration.malformed, true);
});

test("Firebase Storage factory selects only the configured default bucket", async () => {
  const bucketArguments = [];
  const listCalls = [];
  const storage = {
    bucket(...args) {
      bucketArguments.push(args);
      return {
        async getFiles(options) {
          listCalls.push(options);
          return [[], null, {}];
        },
      };
    },
  };
  const store = inventory
    .createFirebaseOwnerRecordGenerationMigrationStorageInventory(storage);
  const page = await store.listObjects({
    targetUid: uid,
    kind: "coupon_images",
    pageSize: 25,
  });
  assert.deepEqual(page, {objects: [], nextCursor: null});
  assert.deepEqual(bucketArguments, [[]]);
  assert.equal(listCalls.length, 1);
  assert.equal(listCalls[0].prefix,
    `bitesaver_restaurants/${uid}/coupon_images/`);
});

test("production Storage boundary rejects wrong-prefix and unstable pages", async () => {
  const responses = [
    [[{name: "unrelated/object.webp", metadata: {}}], {}, {}],
    [[
      {name: name("restaurant_images", "b.webp"), metadata: {}},
      {name: name("restaurant_images", "a.webp"), metadata: {}},
    ], {}, {}],
    [[], {pageToken: "nonempty-token"}, {}],
  ];
  const store = inventory.createStorageOwnerRecordGenerationMigrationStore({
    async getFiles() {
      return responses.shift();
    },
  });
  for (const pageSize of [1, 2, 1]) {
    await assertStorageRejection(
      () => store.listObjects({
        targetUid: uid,
        kind: "restaurant_images",
        pageSize,
      }),
      "invalid_provider_response",
    );
  }
});
