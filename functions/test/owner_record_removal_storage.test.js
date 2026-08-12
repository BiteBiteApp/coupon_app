"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const storage = require("../lib/owner_record_removal_storage.js");

const targetUid = "owner-record-removal-storage-uid";
const sourceGeneration = 7;

function objectName(kind, suffix) {
  return `${storage.buildOwnerRecordRemovalStoragePrefix(
    targetUid,
    kind,
  )}${suffix}`;
}

function listedObject(kind, suffix, changes = {}) {
  return {
    name: objectName(kind, suffix),
    providerGeneration: "10000000000000000001",
    ownerRecordGeneration: String(sourceGeneration),
    ...changes,
  };
}

function validatePage(kind, objects, changes = {}) {
  return storage.validateOwnerRecordRemovalStorageFirstPage({
    targetUid,
    kind,
    limit: storage.ownerRecordRemovalStoragePageLimit,
    sourceGeneration,
    objects,
    ...changes,
  });
}

function assertStorageError(action, code) {
  assert.throws(action, (error) => isStorageError(error, code));
}

function isStorageError(error, code) {
  assert.equal(error.name, "OwnerRecordRemovalStorageError");
  assert.equal(error.code, code);
  assert.equal(
    error.message,
    "Owner-record removal Storage state is invalid.",
  );
  assert.equal(error.message.includes(targetUid), false);
  return true;
}

async function assertStorageRejection(action, code) {
  await assert.rejects(action, (error) => isStorageError(error, code));
}

class StrictFakeStorageBoundary {
  constructor(objects) {
    this.objects = new Map(objects.map((object) => [object.name, {...object}]));
    this.listRequests = [];
    this.deleteRequests = [];
  }

  async listFirstObjects(request) {
    this.listRequests.push({...request});
    const prefix = storage.buildOwnerRecordRemovalStoragePrefix(
      request.targetUid,
      request.kind,
    );
    assert.ok(
      request.limit === storage.ownerRecordRemovalStoragePageLimit ||
        request.limit === storage.ownerRecordRemovalStorageRemnantLimit,
    );
    return [...this.objects.values()]
      .filter((object) => object.name.startsWith(prefix))
      .sort((left, right) => left.name.localeCompare(right.name, "en-US"))
      .slice(0, request.limit)
      .map((object) => ({...object}));
  }

  async deleteExactObject(request) {
    this.deleteRequests.push({...request});
    storage.validateOwnerRecordRemovalStorageObjectName({
      targetUid: request.targetUid,
      kind: request.kind,
      name: request.name,
    });
    storage.validateOwnerRecordRemovalStorageProviderGeneration(
      request.providerGeneration,
    );
    const current = this.objects.get(request.name);
    if (current === undefined) {
      return "not_found";
    }
    if (current.providerGeneration !== request.providerGeneration) {
      return "precondition_failed";
    }
    this.objects.delete(request.name);
    return "deleted";
  }
}

test("Storage contract exposes only three exact UID-derived namespaces", () => {
  assert.deepEqual([...storage.ownerRecordRemovalStorageKinds], [
    "restaurant_images",
    "coupon_images",
    "menu_images",
  ]);
  assert.equal(storage.ownerRecordRemovalStoragePageLimit, 25);
  assert.equal(storage.ownerRecordRemovalStorageRemnantLimit, 1);

  for (const kind of storage.ownerRecordRemovalStorageKinds) {
    assert.equal(
      storage.buildOwnerRecordRemovalStoragePrefix(targetUid, kind),
      `bitesaver_restaurants/${targetUid}/${kind}/`,
    );
  }

  for (const kind of [
    "restaurant_menus",
    "bitescore_dishes",
    "restaurant_images/other",
    `bitesaver_restaurants/${targetUid}/restaurant_images/`,
    "",
    null,
  ]) {
    assertStorageError(
      () => storage.buildOwnerRecordRemovalStoragePrefix(targetUid, kind),
      "unsupported_partial_state",
    );
  }
  for (const uid of ["", ".", "..", "other/uid", "bad\u0000uid", null]) {
    assertStorageError(
      () => storage.buildOwnerRecordRemovalStoragePrefix(
        uid,
        "restaurant_images",
      ),
      "unsupported_partial_state",
    );
  }
});

test("first-page validator returns an exact frozen canonical page", () => {
  const objects = [
    listedObject("coupon_images", "coupon_001.webp", {
      providerGeneration: "1",
    }),
    listedObject("coupon_images", "coupon_002.webp", {
      providerGeneration: "999999999999999999999999999999999999",
    }),
  ];
  const validated = validatePage("coupon_images", objects);

  assert.deepEqual(validated, objects);
  assert.notEqual(validated, objects);
  assert.notEqual(validated[0], objects[0]);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated[0]), true);
  assert.deepEqual(Object.keys(validated[0]).sort(), [
    "name",
    "ownerRecordGeneration",
    "providerGeneration",
  ]);
  objects[0].name = objectName("coupon_images", "changed.webp");
  assert.match(validated[0].name, /coupon_001\.webp$/u);

  assert.deepEqual(validatePage("menu_images", []), []);
  assert.equal(Object.isFrozen(validatePage("menu_images", [])), true);
});

test("page and remnant limits are exact hard maximums", () => {
  const page = Array.from({length: 25}, (_, index) =>
    listedObject(
      "restaurant_images",
      `image_${String(index).padStart(3, "0")}.webp`,
    ));
  assert.equal(validatePage("restaurant_images", page).length, 25);

  assertStorageError(
    () => validatePage("restaurant_images", [
      ...page,
      listedObject("restaurant_images", "image_999.webp"),
    ]),
    "unsupported_partial_state",
  );
  assertStorageError(
    () => validatePage("restaurant_images", page.slice(0, 2), {
      limit: storage.ownerRecordRemovalStorageRemnantLimit,
    }),
    "unsupported_partial_state",
  );
  for (const limit of [0, 2, 24, 26, "25", undefined]) {
    assertStorageError(
      () => validatePage("restaurant_images", [], {limit}),
      "unsupported_partial_state",
    );
  }
  assert.equal(
    validatePage("restaurant_images", page.slice(0, 1), {
      limit: storage.ownerRecordRemovalStorageRemnantLimit,
    }).length,
    1,
  );
});

test("first-page names must be unique and strictly ascending", () => {
  const first = listedObject("menu_images", "menu_001.webp");
  const second = listedObject("menu_images", "menu_002.webp");
  assertStorageError(
    () => validatePage("menu_images", [second, first]),
    "unsupported_partial_state",
  );
  assertStorageError(
    () => validatePage("menu_images", [first, {...first}]),
    "unsupported_partial_state",
  );

  const sparse = [];
  sparse.length = 1;
  assertStorageError(
    () => validatePage("menu_images", sparse),
    "unsupported_partial_state",
  );
});

test("object names cannot escape the exact target UID and kind prefix", () => {
  const prefix = storage.buildOwnerRecordRemovalStoragePrefix(
    targetUid,
    "restaurant_images",
  );
  const invalidNames = [
    prefix,
    `bitesaver_restaurants/other-uid/restaurant_images/image.webp`,
    `bitesaver_restaurants/${targetUid}/coupon_images/image.webp`,
    `restaurant_menus/${targetUid}/menu_images/image.webp`,
    `bitescore_dishes/${targetUid}/images/image.webp`,
    `${prefix}bad\nname.webp`,
    `${prefix}${"x".repeat(1_025)}`,
    "",
    null,
  ];
  for (const name of invalidNames) {
    assertStorageError(
      () => storage.validateOwnerRecordRemovalStorageObjectName({
        targetUid,
        kind: "restaurant_images",
        name,
      }),
      "unsupported_partial_state",
    );
  }

  for (const name of invalidNames.slice(0, 5)) {
    assertStorageError(
      () => validatePage("restaurant_images", [{
        ...listedObject("restaurant_images", "valid.webp"),
        name,
      }]),
      "unsupported_partial_state",
    );
  }
  assertStorageError(
    () => validatePage("restaurant_images", [{
      ...listedObject("restaurant_images", "valid.webp"),
      extraProviderState: true,
    }]),
    "unsupported_partial_state",
  );
});

test("provider generations are canonical positive decimal strings", () => {
  for (const value of [
    undefined,
    null,
    1,
    "",
    "0",
    "01",
    "-1",
    "+1",
    "1.0",
    " 1",
    "1 ",
    "1e3",
  ]) {
    assertStorageError(
      () => storage.validateOwnerRecordRemovalStorageProviderGeneration(value),
      "storage_generation_mismatch",
    );
  }
  assert.equal(
    storage.validateOwnerRecordRemovalStorageProviderGeneration(
      "999999999999999999999999999999999999",
    ),
    "999999999999999999999999999999999999",
  );

  const missing = listedObject("restaurant_images", "image.webp");
  delete missing.providerGeneration;
  assertStorageError(
    () => validatePage("restaurant_images", [missing]),
    "storage_generation_mismatch",
  );
});

test("owner-generation metadata is canonical, exact, and safely ordered", () => {
  assert.equal(
    storage.validateOwnerRecordRemovalStorageOwnerGeneration({
      ownerRecordGeneration: "0",
      sourceGeneration: 0,
    }),
    "0",
  );
  assert.equal(
    storage.validateOwnerRecordRemovalStorageOwnerGeneration({
      ownerRecordGeneration: String(Number.MAX_SAFE_INTEGER),
      sourceGeneration: Number.MAX_SAFE_INTEGER,
    }),
    String(Number.MAX_SAFE_INTEGER),
  );

  for (const value of [
    undefined,
    null,
    7,
    "",
    "07",
    "-1",
    "+7",
    "7.0",
    " 7",
    "7 ",
  ]) {
    assertStorageError(
      () => storage.validateOwnerRecordRemovalStorageOwnerGeneration({
        ownerRecordGeneration: value,
        sourceGeneration,
      }),
      "record_generation_missing",
    );
  }
  assertStorageError(
    () => storage.validateOwnerRecordRemovalStorageOwnerGeneration({
      ownerRecordGeneration: "6",
      sourceGeneration,
    }),
    "generation_mismatch",
  );
  for (const value of ["8", "9007199254740992", "9".repeat(80)]) {
    assertStorageError(
      () => storage.validateOwnerRecordRemovalStorageOwnerGeneration({
        ownerRecordGeneration: value,
        sourceGeneration,
      }),
      "newer_generation_record_found",
    );
  }
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7"]) {
    assertStorageError(
      () => storage.validateOwnerRecordRemovalStorageOwnerGeneration({
        ownerRecordGeneration: "7",
        sourceGeneration: value,
      }),
      "generation_mismatch",
    );
  }

  const missing = listedObject("coupon_images", "coupon.webp");
  delete missing.ownerRecordGeneration;
  assertStorageError(
    () => validatePage("coupon_images", [missing]),
    "record_generation_missing",
  );
});

test("delete results have one exact provider-precondition classification", () => {
  for (const result of ["deleted", "not_found", "precondition_failed"]) {
    assert.equal(
      storage.validateOwnerRecordRemovalStorageDeleteResult(result),
      result,
    );
  }
  assert.equal(
    storage.ownerRecordRemovalStorageDeleteFailureCode("deleted"),
    null,
  );
  assert.equal(
    storage.ownerRecordRemovalStorageDeleteFailureCode("not_found"),
    null,
  );
  assert.equal(
    storage.ownerRecordRemovalStorageDeleteFailureCode("precondition_failed"),
    "storage_generation_mismatch",
  );
  for (const value of ["missing", "generation_changed", null, undefined]) {
    assertStorageError(
      () => storage.validateOwnerRecordRemovalStorageDeleteResult(value),
      "unsupported_partial_state",
    );
  }
});

test("fake boundary enforces generation preconditions and idempotent absence", async () => {
  const object = listedObject("restaurant_images", "main.webp", {
    providerGeneration: "42",
  });
  const boundary = new StrictFakeStorageBoundary([object]);
  const request = {
    targetUid,
    kind: "restaurant_images",
    name: object.name,
  };

  assert.equal(
    await boundary.deleteExactObject({
      ...request,
      providerGeneration: "41",
    }),
    "precondition_failed",
  );
  assert.equal(boundary.objects.has(object.name), true);
  assert.equal(
    await boundary.deleteExactObject({
      ...request,
      providerGeneration: "42",
    }),
    "deleted",
  );
  assert.equal(
    await boundary.deleteExactObject({
      ...request,
      providerGeneration: "42",
    }),
    "not_found",
  );

  await assertStorageRejection(
    () => boundary.deleteExactObject({
      targetUid,
      kind: "restaurant_images",
      name: `restaurant_menus/${targetUid}/menu_images/shared.webp`,
      providerGeneration: "42",
    }),
    "unsupported_partial_state",
  );
  assert.deepEqual(
    Object.keys(boundary.deleteRequests[0]).sort(),
    ["kind", "name", "providerGeneration", "targetUid"],
  );
});

test("more than 75 objects drain through stable bounded first pages", async () => {
  const objects = [];
  for (const kind of storage.ownerRecordRemovalStorageKinds) {
    for (let index = 0; index < 28; index += 1) {
      objects.push(listedObject(
        kind,
        `object_${String(index).padStart(3, "0")}.webp`,
        {providerGeneration: String(10_000 + objects.length)},
      ));
    }
  }
  assert.equal(objects.length, 84);
  const boundary = new StrictFakeStorageBoundary(objects.reverse());
  let deleted = 0;

  for (const kind of storage.ownerRecordRemovalStorageKinds) {
    while (true) {
      const rawPage = await boundary.listFirstObjects({
        targetUid,
        kind,
        limit: storage.ownerRecordRemovalStoragePageLimit,
      });
      const page = validatePage(kind, rawPage);
      assert.ok(page.length <= 25);
      if (page.length === 0) {
        break;
      }
      for (const object of page) {
        assert.equal(
          await boundary.deleteExactObject({
            targetUid,
            kind,
            name: object.name,
            providerGeneration: object.providerGeneration,
          }),
          "deleted",
        );
        deleted += 1;
      }
    }
  }

  assert.equal(deleted, 84);
  assert.equal(boundary.objects.size, 0);
  assert.equal(boundary.deleteRequests.length, 84);
  assert.equal(boundary.listRequests.length, 9);
  for (const kind of storage.ownerRecordRemovalStorageKinds) {
    const remnants = await boundary.listFirstObjects({
      targetUid,
      kind,
      limit: storage.ownerRecordRemovalStorageRemnantLimit,
    });
    assert.deepEqual(
      validatePage(kind, remnants, {
        limit: storage.ownerRecordRemovalStorageRemnantLimit,
      }),
      [],
    );
  }
  assert.equal(
    boundary.listRequests.every(
      (request) => !Object.hasOwn(request, "prefix"),
    ),
    true,
  );
});
