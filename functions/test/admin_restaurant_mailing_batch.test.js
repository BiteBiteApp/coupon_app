"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  prepareAdminRestaurantMailingLabelBatchCallableHandler,
} = require("../lib/admin_restaurant_mailing_batch.js");
const {requireAdminInviteAccess} = require("../lib/admin_authorization.js");

const adminRequest = (data) => ({
  data,
  auth: {
    uid: "admin-user",
    token: {email: "schuyler.cole@gmail.com"},
  },
});

function request(catalogRestaurantIds, overrides = {}) {
  return {schemaVersion: 1, catalogRestaurantIds, ...overrides};
}

function restaurant(overrides = {}) {
  return {
    name: "River Grill",
    streetAddress: "1 Main Street",
    city: "Crystal River",
    state: "FL",
    zipCode: "34428",
    isActive: true,
    ownerName: "Private Owner",
    invitationId: "private-invitation",
    ...overrides,
  };
}

function restaurantWithout(fields, overrides = {}) {
  const value = restaurant(overrides);
  for (const field of fields) delete value[field];
  return value;
}

class FakeMailingDatabase {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial));
    this.getAllCalls = [];
    this.queryCount = 0;
    this.writeCount = 0;
    this.reverseSnapshots = false;
    this.snapshotTransform = null;
    this.throwRead = null;
    this.throwDataFor = new Set();
  }

  async getRestaurantDocuments(catalogRestaurantIds) {
    this.getAllCalls.push([...catalogRestaurantIds]);
    if (this.throwRead !== null) throw this.throwRead;
    const snapshots = catalogRestaurantIds.map((id) => ({
      id,
      exists: this.records.has(id),
      data: () => {
        if (this.throwDataFor.has(id)) throw new Error("raw private failure");
        return this.records.get(id);
      },
    }));
    const ordered = this.reverseSnapshots ? snapshots.reverse() : snapshots;
    return this.snapshotTransform === null
      ? ordered
      : this.snapshotTransform(ordered);
  }
}

function dependencies(database) {
  return {database, requireAdmin: requireAdminInviteAccess};
}

async function prepare(database, ids) {
  return prepareAdminRestaurantMailingLabelBatchCallableHandler(
    adminRequest(request(ids)),
    dependencies(database),
  );
}

test("authorization precedes parsing and every restaurant document read", async () => {
  for (const auth of [
    null,
    {uid: "customer", token: {email: "customer@example.test"}},
    {uid: "owner", token: {email: "owner@example.test", admin: true}},
  ]) {
    const database = new FakeMailingDatabase({"restaurant-1": restaurant()});
    await assert.rejects(
      prepareAdminRestaurantMailingLabelBatchCallableHandler(
        {data: {unknown: true}, auth},
        dependencies(database),
      ),
      (error) => error.code === "permission-denied",
    );
    assert.deepEqual(database.getAllCalls, []);
  }

  const database = new FakeMailingDatabase({"restaurant-1": restaurant()});
  const response = await prepare(database, ["restaurant-1"]);
  assert.equal(response.outcome, "complete");
  assert.equal(database.getAllCalls.length, 1);
});

test("closed request validation rejects every invalid request before reads", async () => {
  const overMaximum = Array.from({length: 26}, (_, index) => `restaurant-${index}`);
  const malformedUnicode = String.fromCharCode(0xd800);
  const invalidRequests = [
    undefined,
    null,
    [],
    {},
    {schemaVersion: "1", catalogRestaurantIds: ["restaurant-1"]},
    {schemaVersion: 1.5, catalogRestaurantIds: ["restaurant-1"]},
    {schemaVersion: 2, catalogRestaurantIds: ["restaurant-1"]},
    {schemaVersion: 1},
    {catalogRestaurantIds: ["restaurant-1"]},
    request([], {}),
    request(overMaximum),
    request(["restaurant-1", "restaurant-1"]),
    request([" restaurant-1"]),
    request(["restaurant-1 "]),
    request([""]),
    request(["restaurant/1"]),
    request(["."]),
    request([".."]),
    request(["restaurant\n1"]),
    request(["restaurant\u200b1"]),
    request(["\u17b4"]),
    request(["\u17b5"]),
    request(["restaurant-\u17b4-id"]),
    request(["restaurant-\u17b5-id"]),
    request([malformedUnicode]),
    request(["x".repeat(1501)]),
    request(["restaurant-1"], {extra: true}),
  ];

  const database = new FakeMailingDatabase({"restaurant-1": restaurant()});
  for (const [index, data] of invalidRequests.entries()) {
    await assert.rejects(
      prepareAdminRestaurantMailingLabelBatchCallableHandler(
        adminRequest(data),
        dependencies(database),
      ),
      (error) => error.code === "invalid-argument",
      `invalid request ${index}`,
    );
  }
  assert.deepEqual(database.getAllCalls, []);
});

test("one and twenty-five IDs each use one exact bounded read", async () => {
  for (const count of [1, 25]) {
    const ids = Array.from({length: count}, (_, index) => `restaurant-${index}`);
    const database = new FakeMailingDatabase(Object.fromEntries(
      ids.map((id) => [id, restaurant({name: `Restaurant ${id}`})]),
    ));

    const response = await prepare(database, ids);

    assert.equal(response.results.length, count);
    assert.deepEqual(database.getAllCalls, [ids]);
    assert.equal(database.queryCount, 0);
    assert.equal(database.writeCount, 0);
  }
});

test("snapshot order cannot change exact requested result order", async () => {
  const ids = ["restaurant-b", "restaurant-a", "restaurant-c"];
  const database = new FakeMailingDatabase(Object.fromEntries(
    ids.map((id) => [id, restaurant({name: id})]),
  ));
  database.reverseSnapshots = true;

  const response = await prepare(database, ids);

  assert.deepEqual(
    response.results.map((result) => result.catalogRestaurantId),
    ids,
  );
  assert.deepEqual(response.results.map((result) => result.restaurantName), ids);
});

test("malformed bounded snapshot sets fail closed while missing documents remain results", async () => {
  const ids = ["restaurant-a", "restaurant-b"];
  const malformedTransforms = [
    (snapshots) => [snapshots[0], snapshots[0]],
    (snapshots) => [snapshots[0], {...snapshots[1], id: "restaurant-x"}],
    (snapshots) => snapshots.slice(0, 1),
    (snapshots) => [
      ...snapshots,
      {id: "restaurant-x", exists: false, data: () => undefined},
    ],
  ];

  for (const [index, snapshotTransform] of malformedTransforms.entries()) {
    const database = new FakeMailingDatabase(Object.fromEntries(
      ids.map((id) => [id, restaurant({name: id})]),
    ));
    database.snapshotTransform = snapshotTransform;
    await assert.rejects(
      prepare(database, ids),
      (error) =>
        error.code === "unavailable" &&
        error.message === "Restaurant mailing data could not be loaded. Try again.",
      `malformed snapshot transform ${index}`,
    );
  }

  const missingDatabase = new FakeMailingDatabase({
    "restaurant-a": restaurant({name: "restaurant-a"}),
  });
  const response = await prepare(missingDatabase, ids);
  assert.equal(response.results[0].outcome, "ready");
  assert.deepEqual(response.results[1], {
    catalogRestaurantId: "restaurant-b",
    outcome: "unavailable",
    restaurantName: null,
    code: "restaurant_not_found",
    message: "Restaurant was not found.",
  });
});

test("authoritative name aliases use presence before raw validation", async () => {
  const malformedUnicode = String.fromCharCode(0xd800);
  const cases = [
    {
      id: "absent-fallback",
      data: restaurantWithout(["name"], {restaurantName: "Alias Name"}),
      outcome: "ready",
      restaurantName: "Alias Name",
    },
    {
      id: "null-fallback",
      data: restaurant({name: null, restaurantName: "Alias Name"}),
      outcome: "ready",
      restaurantName: "Alias Name",
    },
    {
      id: "name-wins",
      data: restaurant({
        name: "Authoritative Name",
        restaurantName: "Lower Alias",
        restaurant_name: "Lowest Alias",
      }),
      outcome: "ready",
      restaurantName: "Authoritative Name",
    },
    {
      id: "empty",
      data: restaurant({name: "", restaurantName: "Hidden Valid Alias"}),
      code: "missing_mailing_component",
    },
    {
      id: "whitespace",
      data: restaurant({name: "   ", restaurantName: "Hidden Valid Alias"}),
      code: "missing_mailing_component",
    },
    {
      id: "newline",
      data: restaurant({name: "\n", restaurantName: "Hidden Valid Alias"}),
      code: "invalid_one_line_text",
    },
    {
      id: "line-separator",
      data: restaurant({name: "\u2028", restaurantName: "Hidden Valid Alias"}),
      code: "invalid_one_line_text",
    },
    {
      id: "paragraph-separator",
      data: restaurant({name: "\u2029", restaurantName: "Hidden Valid Alias"}),
      code: "invalid_one_line_text",
    },
    {
      id: "control",
      data: restaurant({name: "Bad\u0000Name", restaurantName: "Hidden Valid Alias"}),
      code: "invalid_one_line_text",
    },
    {
      id: "format",
      data: restaurant({name: "Bad\u200bName", restaurantName: "Hidden Valid Alias"}),
      code: "invalid_one_line_text",
    },
    {
      id: "malformed",
      data: restaurant({name: `Bad${malformedUnicode}`, restaurantName: "Hidden Valid Alias"}),
      code: "invalid_one_line_text",
    },
    {
      id: "wrong-type",
      data: restaurant({name: 7, restaurantName: "Hidden Valid Alias"}),
      code: "invalid_one_line_text",
    },
    {
      id: "second-alias-invalid",
      data: restaurantWithout(["name"], {
        restaurantName: "\n",
        restaurant_name: "Hidden Valid Alias",
      }),
      code: "invalid_one_line_text",
    },
    {
      id: "all-absent-null",
      data: restaurantWithout(["name"], {
        restaurantName: null,
        restaurant_name: null,
      }),
      code: "missing_mailing_component",
    },
  ];
  const database = new FakeMailingDatabase(Object.fromEntries(
    cases.map(({id, data}) => [id, data]),
  ));

  const response = await prepare(database, cases.map(({id}) => id));

  for (const [index, expected] of cases.entries()) {
    const result = response.results[index];
    assert.equal(result.catalogRestaurantId, expected.id);
    if (expected.outcome === "ready") {
      assert.equal(result.outcome, "ready");
      assert.equal(result.restaurantName, expected.restaurantName);
    } else {
      assert.equal(result.code, expected.code);
      assert.equal(result.restaurantName, null);
    }
  }
});

test("dedicated streetAddress is required and broad legacy shapes are never parsed", async () => {
  const malformedUnicode = String.fromCharCode(0xd800);
  const cases = [
    {
      id: "absent-with-address",
      data: restaurantWithout(["streetAddress"], {address: "99 Legacy Street"}),
      code: "missing_mailing_component",
    },
    {
      id: "null-with-address",
      data: restaurant({streetAddress: null, address: "99 Legacy Street"}),
      code: "missing_mailing_component",
    },
    {
      id: "empty-with-address",
      data: restaurant({streetAddress: "", address: "99 Legacy Street"}),
      code: "missing_mailing_component",
    },
    {
      id: "whitespace-with-address",
      data: restaurant({streetAddress: "   ", address: "99 Legacy Street"}),
      code: "missing_mailing_component",
    },
    {
      id: "wrong-type-with-address",
      data: restaurant({streetAddress: 7, address: "99 Legacy Street"}),
      code: "invalid_one_line_text",
    },
    ...[
      "Line\nBreak",
      "Line\u0000Break",
      "Line\u200bBreak",
      `Line${malformedUnicode}Break`,
    ].map((streetAddress, index) => ({
      id: `invalid-with-address-${index}`,
      data: restaurant({streetAddress, address: "99 Legacy Street"}),
      code: "invalid_one_line_text",
    })),
    {
      id: "dedicated-wins",
      data: restaurant({
        streetAddress: "10 Dedicated Street, Suite 2",
        address: "99 Legacy Street",
      }),
      outcome: "ready",
      streetAddress: "10 Dedicated Street, Suite 2",
    },
    {
      id: "formatted-only",
      data: restaurantWithout(["streetAddress"], {
        formattedAddress: "1 Main Street, Parsed City, GA 30002",
        city: undefined,
        state: undefined,
        zipCode: undefined,
      }),
      code: "unsupported_address_shape",
    },
    {
      id: "full-only",
      data: restaurantWithout(["streetAddress"], {
        fullAddress: "1 Main Street, Parsed City, GA 30002",
        city: undefined,
        state: undefined,
        zipCode: undefined,
      }),
      code: "unsupported_address_shape",
    },
  ];
  const database = new FakeMailingDatabase(Object.fromEntries(
    cases.map(({id, data}) => [id, data]),
  ));

  const response = await prepare(database, cases.map(({id}) => id));

  for (const [index, expected] of cases.entries()) {
    const result = response.results[index];
    if (expected.outcome === "ready") {
      assert.equal(result.outcome, "ready");
      assert.equal(result.streetAddress, expected.streetAddress);
    } else {
      assert.equal(result.code, expected.code, expected.id);
    }
  }
});

test("same-name restaurants remain separate canonical results", async () => {
  const database = new FakeMailingDatabase({
    first: restaurant({name: "Same Name", streetAddress: "1 First Street"}),
    second: restaurant({name: "Same Name", streetAddress: "2 Second Street"}),
  });

  const response = await prepare(database, ["first", "second"]);

  assert.deepEqual(response.results.map((result) => result.catalogRestaurantId), [
    "first",
    "second",
  ]);
  assert.deepEqual(response.results.map((result) => result.restaurantName), [
    "Same Name",
    "Same Name",
  ]);
});

test("missing, inactive, and each missing required component are explicit", async () => {
  const records = {
    inactive: restaurant({isActive: false}),
    hidden: restaurant({isActive: undefined}),
    missingName: restaurant({name: undefined}),
    missingStreet: restaurant({streetAddress: undefined}),
    missingCity: restaurant({city: undefined}),
    missingState: restaurant({state: undefined}),
    missingZip: restaurant({zipCode: undefined}),
  };
  const ids = ["missing", ...Object.keys(records)];
  const database = new FakeMailingDatabase(records);

  const response = await prepare(database, ids);

  assert.equal(response.results.length, ids.length);
  assert.equal(response.results[0].code, "restaurant_not_found");
  assert.equal(response.results[0].restaurantName, null);
  assert.equal(response.results[1].code, "restaurant_ineligible");
  assert.equal(response.results[2].code, "restaurant_ineligible");
  for (const result of response.results.slice(3)) {
    assert.equal(result.code, "missing_mailing_component");
  }
});

test("raw controls, format characters, separators, and malformed Unicode fail", async () => {
  const malformedUnicode = String.fromCharCode(0xd800);
  const invalidValues = [
    "Line\nBreak",
    "Line\rBreak",
    "Line\u2028Break",
    "Line\u2029Break",
    "Line\u200bBreak",
    "Line\u17b4Break",
    "Line\u17b5Break",
    `Line${malformedUnicode}Break`,
  ];
  const records = {};
  const ids = [];
  for (const [index, value] of invalidValues.entries()) {
    for (const field of ["name", "streetAddress", "city", "state", "zipCode"]) {
      const id = `${field}-${index}`;
      ids.push(id);
      records[id] = restaurant({[field]: value});
    }
  }

  const database = new FakeMailingDatabase(records);
  const responses = [];
  for (let offset = 0; offset < ids.length; offset += 25) {
    responses.push(await prepare(database, ids.slice(offset, offset + 25)));
  }
  const results = responses.flatMap((response) => response.results);

  assert.equal(results.length, ids.length);
  for (const result of results) {
    assert.equal(result.code, "invalid_one_line_text", result.catalogRestaurantId);
  }
});

test("well-formed Unicode and accepted internal whitespace are preserved", async () => {
  const longStreet = `${"A".repeat(800)} Suite 20`;
  const database = new FakeMailingDatabase({
    unicode: restaurant({
      name: "  Café ក 🍽️  ",
      streetAddress: "  10 Rue de l’Étoile  ផ្ទះ  4  ",
      city: "  São  ក José  ",
      zipCode: "34461-1234",
    }),
    long: restaurant({streetAddress: longStreet}),
  });

  const response = await prepare(database, ["unicode", "long"]);

  assert.deepEqual(response.results[0], {
    catalogRestaurantId: "unicode",
    outcome: "ready",
    restaurantName: "Café ក 🍽️",
    streetAddress: "10 Rue de l’Étoile  ផ្ទះ  4",
    city: "São  ក José",
    state: "FL",
    zipCode: "34461-1234",
  });
  assert.equal(response.results[1].streetAddress, longStreet);
  assert.equal(response.outcome, "complete");
});

test("state and ZIP accept only the exact authoritative representations", async () => {
  const values = {
    zip5: restaurant({zipCode: "34461"}),
    zip4: restaurant({zipCode: "34461-1234"}),
    lowerState: restaurant({state: "fl"}),
    territory: restaurant({state: "PR"}),
    stateLong: restaurant({state: "Florida"}),
    zipSpace: restaurant({zipCode: "34461 1234"}),
    zipShort: restaurant({zipCode: "3446"}),
    zipLetters: restaurant({zipCode: "ABCDE"}),
  };

  const response = await prepare(new FakeMailingDatabase(values), Object.keys(values));

  assert.equal(response.results[0].outcome, "ready");
  assert.equal(response.results[1].outcome, "ready");
  assert.equal(response.results[2].code, "invalid_state");
  assert.equal(response.results[3].code, "invalid_state");
  assert.equal(response.results[4].code, "invalid_state");
  for (const result of response.results.slice(5)) {
    assert.equal(result.code, "invalid_zip");
  }
});

test("complete and partial response shapes are closed, coherent, and public-only", async () => {
  const database = new FakeMailingDatabase({ready: restaurant()});
  const response = await prepare(database, ["ready", "missing"]);

  assert.deepEqual(Object.keys(response), ["schemaVersion", "outcome", "results"]);
  assert.equal(response.schemaVersion, 1);
  assert.equal(response.outcome, "partialFailure");
  assert.deepEqual(Object.keys(response.results[0]), [
    "catalogRestaurantId",
    "outcome",
    "restaurantName",
    "streetAddress",
    "city",
    "state",
    "zipCode",
  ]);
  assert.deepEqual(Object.keys(response.results[1]), [
    "catalogRestaurantId",
    "outcome",
    "restaurantName",
    "code",
    "message",
  ]);
  const serialized = JSON.stringify(response);
  for (const forbidden of [
    "Private Owner",
    "private-invitation",
    "ownerName",
    "invitationId",
    "token",
    "preparation",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("whole bounded-read failures are sanitized and never claim partial results", async () => {
  const database = new FakeMailingDatabase({ready: restaurant()});
  database.throwRead = new Error("raw secret backend failure");

  await assert.rejects(
    prepare(database, ["ready"]),
    (error) =>
      error.code === "unavailable" &&
      error.message === "Restaurant mailing data could not be loaded. Try again." &&
      !error.message.includes("raw secret"),
  );
});

test("isolated snapshot data failure uses one sanitized failed result", async () => {
  const database = new FakeMailingDatabase({
    ready: restaurant(),
    failed: restaurant(),
  });
  database.throwDataFor.add("failed");

  const response = await prepare(database, ["ready", "failed"]);

  assert.equal(response.results[0].outcome, "ready");
  assert.deepEqual(response.results[1], {
    catalogRestaurantId: "failed",
    outcome: "failed",
    restaurantName: null,
    code: "bounded_read_failed",
    message: "Restaurant mailing data could not be read.",
  });
  assert.equal(JSON.stringify(response).includes("raw private failure"), false);
});
