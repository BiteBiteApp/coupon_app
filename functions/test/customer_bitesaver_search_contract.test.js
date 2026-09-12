"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CustomerBiteSaverContractError,
  canonicalCustomerBiteSaverCriteria,
  canonicalCustomerBiteSaverState,
  createCustomerBiteSaverCriteriaFingerprint,
  createCustomerBiteSaverMembershipFingerprint,
  customerBiteSaverBinary64,
  customerBiteSaverCatalogGenerationShardCount,
  customerBiteSaverExactLocationPreference,
  customerBiteSaverGenerationShardForIdentity,
  customerBiteSaverGenerationShardId,
  customerBiteSaverOfferProjectionVersion,
  customerBiteSaverPageSize,
  customerBiteSaverRestaurantProjectionVersion,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  customerBiteSaverStateCodes,
  normalizeCustomerBiteSaverCity,
  parseCustomerBiteSaverStartRequest,
  supportedCustomerBiteSaverRadii,
} = require("../lib/customer_bitesaver_search_contract.js");
const {
  CustomerBiteSaverSearchTextError,
  customerBiteSaverCouponMatches,
  customerBiteSaverDailySpecialMatches,
  customerBiteSaverMatcherVersion,
  customerBiteSaverMatchValuesContain,
  customerBiteSaverRestaurantMatches,
  customerBiteSaverSearchMatchValues,
  dartUtf16FirestoreBytesCursorValue,
  dartUtf16FirestoreBytesOrderKey,
  dartUtf16OrderKey,
  decodeDartUtf16FirestoreBytesOrderKey,
  hasWellFormedCustomerBiteSaverUtf16,
  lowercaseDisplayNameOrderKey,
  maximumCustomerBiteSaverSearchScalars,
  maximumCustomerBiteSaverSearchUtf8Bytes,
  normalizeCustomerBiteSaverSearchText,
  requireCustomerBiteSaverSearchText,
} = require("../lib/customer_bitesaver_search_matcher.js");
const {
  parseCustomerBiteSaverLegacyDateTimeString,
} = require("../lib/customer_bitesaver_offer_availability.js");

const fixturePath = path.resolve(
  __dirname,
  "../../test/fixtures/customer_bitesaver_search_compatibility_v1.json",
);
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function startRequest(overrides = {}) {
  return {
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: "client-request-0001",
    clientInstanceId: "client-instance-0001",
    latitude: 28.5383,
    longitude: -81.3792,
    radiusMiles: 10,
    locationMode: "current",
    typedLocation: null,
    searchText: "",
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    freshSearch: true,
    ...overrides,
  };
}

function assertContractError(callback, code = "invalid-argument") {
  assert.throws(
    callback,
    (error) =>
      error instanceof CustomerBiteSaverContractError && error.code === code,
  );
}

function fixtureTypedLocation(query) {
  const trimmed = query.trim();
  if (/^\d{5}(?:-\d{4})?$/u.test(trimmed)) {
    return {kind: "zip", zip: trimmed};
  }
  const [city, state] = trimmed.split(",", 2);
  const trimmedState = state?.trim() ?? "";
  return {
    kind: "city",
    city: city.trim(),
    state: trimmedState.length === 0
      ? null
      : canonicalCustomerBiteSaverState(trimmedState) ?? trimmedState,
  };
}

test("shared compatibility fixture versions, radii, and states match Functions", () => {
  assert.equal(
    fixtures.contractVersion,
    "bitestar.customer-bitesaver-search-compatibility.v1",
  );
  assert.equal(customerBiteSaverMatcherVersion, fixtures.matcherVersion);
  assert.deepEqual(supportedCustomerBiteSaverRadii, fixtures.supportedRadiiMiles);
  assert.deepEqual(
    customerBiteSaverStateCodes,
    fixtures.supportedStates.map(({code}) => code),
  );
  assert.equal(new Set(customerBiteSaverStateCodes).size, 51);
});

test("all state names and abbreviations canonicalize without guessing territories", () => {
  for (const {name, code} of fixtures.supportedStates) {
    for (const input of [
      name,
      name.toLowerCase(),
      `  ${name.toUpperCase().replaceAll(" ", "   ")}  `,
      code,
      ` ${code.toLowerCase()} `,
    ]) {
      assert.equal(canonicalCustomerBiteSaverState(input), code, input);
    }
  }
  for (const input of fixtures.unknownStates) {
    assert.equal(canonicalCustomerBiteSaverState(input), null, input);
  }
  for (const input of [null, undefined, 12, {}, []]) {
    assert.equal(canonicalCustomerBiteSaverState(input), null);
  }
  assert.equal(normalizeCustomerBiteSaverCity("  New   York  "), "new york");
});

test("exact city, state, and ZIP preference matches the shared fixture", () => {
  for (const fixture of fixtures.locationPreferenceCases) {
    assert.equal(
      customerBiteSaverExactLocationPreference({
        typedLocation: fixtureTypedLocation(fixture.typedQuery),
        restaurantCity: fixture.restaurantCity,
        restaurantState: fixture.restaurantState,
        restaurantZipCode: fixture.restaurantZipCode,
      }),
      fixture.expectedPreference,
      fixture.id,
    );
  }
  assert.equal(
    customerBiteSaverExactLocationPreference({
      typedLocation: null,
      restaurantCity: "Orlando",
      restaurantState: "FL",
      restaurantZipCode: "32801",
    }),
    false,
  );
});

test("compatibility normalizer and contiguous-substring matcher consume shared goldens", () => {
  for (const fixture of fixtures.normalizationCases) {
    assert.equal(
      normalizeCustomerBiteSaverSearchText(fixture.input),
      fixture.expected,
      fixture.id,
    );
  }
  for (const fixture of fixtures.matchingCases) {
    const normalizedQuery = normalizeCustomerBiteSaverSearchText(fixture.query);
    const matchValues = customerBiteSaverSearchMatchValues(
      fixture.searchableFields,
    );
    assert.equal(
      customerBiteSaverMatchValuesContain(normalizedQuery, matchValues),
      fixture.expectedMatch,
      fixture.id,
    );
  }
});

test("restaurant, coupon, and daily-special matchers preserve the exact field corpus", () => {
  const restaurant = {
    displayName: "Current Name",
    city: "Lecanto",
    zipCode: "34461",
    bio: "Family pizza",
    cuisine: "Mediterranean",
  };
  for (const query of ["current", "lecan", "34461", "family pizza"]) {
    assert.equal(customerBiteSaverRestaurantMatches(query, restaurant), true);
  }
  assert.equal(
    customerBiteSaverRestaurantMatches("mediterranean", restaurant),
    false,
  );

  const coupon = {
    title: "Free Garlic Knots",
    restaurant: "Legacy Name",
    usageRule: "Once per customer",
    couponCode: "SAVE-20",
    details: "coupon details canary",
  };
  for (const query of ["garlic", "legacy", "once per customer", "save 20"]) {
    assert.equal(customerBiteSaverCouponMatches(query, restaurant, coupon), true);
  }
  assert.equal(
    customerBiteSaverCouponMatches("coupon details canary", restaurant, coupon),
    false,
  );

  const special = {
    title: "Friday Fish Fry",
    details: "Served with slaw",
    category: "Seafood",
  };
  assert.equal(
    customerBiteSaverDailySpecialMatches("fish fry", restaurant, special),
    true,
  );
  assert.equal(
    customerBiteSaverDailySpecialMatches("served with slaw", restaurant, special),
    true,
  );
  assert.equal(
    customerBiteSaverDailySpecialMatches("seafood", restaurant, special),
    false,
  );

  const values = customerBiteSaverSearchMatchValues([" Alpha ", 1, null]);
  assert.deepEqual(values, ["alpha", "", ""]);
  assert.equal(Object.isFrozen(values), true);
  assert.equal(customerBiteSaverMatchValuesContain("", []), true);
});

test("legacy timestamp grammar matches Dart DateTime.tryParse fixtures", () => {
  for (const fixture of fixtures.legacyDateTimeStringCases) {
    const parsed = parseCustomerBiteSaverLegacyDateTimeString(fixture.input);
    assert.equal(parsed.kind !== "invalid", fixture.expectedValid, fixture.id);
    assert.equal(
      parsed.kind === "parsed"
        ? "explicit"
        : parsed.kind === "timeZoneRequired"
          ? "local"
          : "invalid",
      fixture.expectedZoneKind,
      fixture.id,
    );
  }
});

test("search text enforces scalar, UTF-8, and well-formed UTF-16 limits", () => {
  assert.equal(maximumCustomerBiteSaverSearchScalars, 200);
  assert.equal(maximumCustomerBiteSaverSearchUtf8Bytes, 800);
  for (const fixture of fixtures.requestLengthCases) {
    const value = fixture.character.repeat(fixture.length);
    if (fixture.expectedValid) {
      assert.equal(requireCustomerBiteSaverSearchText(value), value, fixture.id);
    } else {
      assert.throws(
        () => requireCustomerBiteSaverSearchText(value),
        CustomerBiteSaverSearchTextError,
        fixture.id,
      );
    }
  }
  assert.equal(requireCustomerBiteSaverSearchText("😀".repeat(200)).length, 400);
  assert.throws(
    () => requireCustomerBiteSaverSearchText("😀".repeat(201)),
    CustomerBiteSaverSearchTextError,
  );
  assert.equal(requireCustomerBiteSaverSearchText(""), "");
  assert.throws(
    () => requireCustomerBiteSaverSearchText(12),
    CustomerBiteSaverSearchTextError,
  );

  for (const fixture of fixtures.requestValidationCases) {
    assert.equal(
      hasWellFormedCustomerBiteSaverUtf16(fixture.input),
      fixture.expectedValid,
      fixture.id,
    );
    if (fixture.expectedValid) {
      assert.equal(requireCustomerBiteSaverSearchText(fixture.input), fixture.input);
    } else {
      assert.throws(
        () => requireCustomerBiteSaverSearchText(fixture.input),
        CustomerBiteSaverSearchTextError,
        fixture.id,
      );
      assert.throws(
        () => normalizeCustomerBiteSaverSearchText(fixture.input),
        CustomerBiteSaverSearchTextError,
        fixture.id,
      );
    }
  }
});

test("UTF-16 order keys reproduce Dart ordering and the shared ranking fixture", () => {
  const values = ["a", "Z", "\u00c5", "\ue000", "\ud800\udc00", "😀"];
  const nativeOrder = [...values].sort();
  const keyOrder = [...values].sort((left, right) =>
    dartUtf16OrderKey(left).localeCompare(dartUtf16OrderKey(right)));
  assert.deepEqual(keyOrder, nativeOrder);
  assert.equal(
    lowercaseDisplayNameOrderKey("BeTA"),
    dartUtf16OrderKey("beta"),
  );
  assert.throws(() => dartUtf16OrderKey("\ud800"), CustomerBiteSaverSearchTextError);

  for (const fixture of fixtures.orderingCases) {
    const actual = [...fixture.candidates]
      .sort((left, right) =>
        Number(!left.exactLocationPreference) -
          Number(!right.exactLocationPreference) ||
        (left.exactLocationPreference ? 0 : left.distanceMiles) -
          (right.exactLocationPreference ? 0 : right.distanceMiles) ||
        lowercaseDisplayNameOrderKey(left.name).localeCompare(
          lowercaseDisplayNameOrderKey(right.name),
        ) ||
        dartUtf16OrderKey(left.id).localeCompare(
          dartUtf16OrderKey(right.id),
        ))
      .map(({id}) => id);
    assert.deepEqual(actual, fixture.expectedOrder, fixture.id);
  }
});

test("binary UTF-16 order keys retain exact ordering within the 1,500-byte index bound", () => {
  const maximumValues = [
    "a".repeat(1_500),
    "\"\\".repeat(750),
    "\u{1f4be}".repeat(374) + "\u00e9\u00e9",
  ];
  for (const value of maximumValues) {
    const key = dartUtf16FirestoreBytesOrderKey(value);
    assert.equal(key.byteLength, Buffer.byteLength(value, "utf8"));
    assert.equal(key.byteLength, 1_500);
    assert.equal(
      Buffer.from(
        dartUtf16FirestoreBytesCursorValue(key, 1_500),
        "base64url",
      ).equals(key),
      true,
    );
    assert.equal(
      decodeDartUtf16FirestoreBytesOrderKey(key, 1_500),
      value,
    );
  }

  const values = [
    "",
    "a",
    "a\u0000",
    "a\u007f",
    "a\u0080",
    "a\u07ff",
    "a\u0800",
    "a\ud7ff",
    "a\u{10000}",
    "a\u{10ffff}",
    "a\ue000",
    "a\uffff",
    "b",
  ];
  assert.deepEqual(
    [...values].sort((left, right) =>
      Buffer.compare(
        dartUtf16FirestoreBytesOrderKey(left),
        dartUtf16FirestoreBytesOrderKey(right),
      )),
    [...values].sort(),
  );
  assert.throws(
    () => dartUtf16FirestoreBytesOrderKey("\ud800"),
    CustomerBiteSaverSearchTextError,
  );
  assert.equal(
    decodeDartUtf16FirestoreBytesOrderKey("not-bytes", 1_500),
    null,
  );
  assert.equal(
    decodeDartUtf16FirestoreBytesOrderKey(Buffer.from([0xf5]), 1_500),
    null,
  );
  assert.equal(
    decodeDartUtf16FirestoreBytesOrderKey(
      dartUtf16FirestoreBytesOrderKey("a".repeat(1_501)),
      1_500,
    ),
    null,
  );
});

test("start request parser is closed and preserves valid current/typed forms", () => {
  const current = parseCustomerBiteSaverStartRequest(startRequest());
  assert.deepEqual(current, startRequest());
  assert.equal(Object.isFrozen(current), true);

  const zip = parseCustomerBiteSaverStartRequest(startRequest({
    locationMode: "typed",
    typedLocation: {kind: "zip", zip: "01234-5678"},
  }));
  assert.deepEqual(zip.typedLocation, {kind: "zip", zip: "01234-5678"});

  const city = parseCustomerBiteSaverStartRequest(startRequest({
    locationMode: "typed",
    typedLocation: {
      kind: "city",
      city: "  New   York ",
      state: " new york ",
    },
  }));
  assert.deepEqual(city.typedLocation, {
    kind: "city",
    city: "new york",
    state: "NY",
  });

  for (const key of Object.keys(startRequest())) {
    const candidate = startRequest();
    delete candidate[key];
    assertContractError(() => parseCustomerBiteSaverStartRequest(candidate));
  }
  assertContractError(() => parseCustomerBiteSaverStartRequest({
    ...startRequest(),
    unexpected: true,
  }));
  for (const value of [null, [], "request", 1]) {
    assertContractError(() => parseCustomerBiteSaverStartRequest(value));
  }
});

test("start request rejects unsupported radii and malformed field combinations", () => {
  for (const radiusMiles of supportedCustomerBiteSaverRadii) {
    assert.equal(
      parseCustomerBiteSaverStartRequest(startRequest({radiusMiles})).radiusMiles,
      radiusMiles,
    );
  }
  for (const radiusMiles of [0, 2, 31, 1.5, "1", NaN, Infinity]) {
    assertContractError(() =>
      parseCustomerBiteSaverStartRequest(startRequest({radiusMiles})));
  }
  for (const overrides of [
    {schemaVersion: 2},
    {clientRequestId: "short"},
    {clientInstanceId: " contains spaces "},
    {latitude: 0, longitude: 0},
    {latitude: 91},
    {longitude: -181},
    {locationMode: "current", typedLocation: {kind: "zip", zip: "32801"}},
    {locationMode: "typed", typedLocation: null},
    {locationMode: "typed", typedLocation: {kind: "zip", zip: "3280"}},
    {
      locationMode: "typed",
      typedLocation: {kind: "city", city: "Orlando", state: "ZZ"},
    },
    {
      locationMode: "typed",
      typedLocation: {kind: "city", city: "\ud800", state: "FL"},
    },
    {searchText: "a".repeat(201)},
    {searchText: "\ud800"},
    {timeZone: "Not/A_Time_Zone"},
    {utcOffsetMinutes: -841},
    {utcOffsetMinutes: 841},
    {utcOffsetMinutes: 840},
    {utcOffsetMinutes: 1.5},
    {freshSearch: "true"},
  ]) {
    assertContractError(() =>
      parseCustomerBiteSaverStartRequest(startRequest(overrides)));
  }
});

test("canonical criteria and membership fingerprints are stable and sensitive", () => {
  const firstRequest = parseCustomerBiteSaverStartRequest(startRequest({
    clientRequestId: "client-request-0001",
    searchText: " Root---Beer ",
  }));
  const retryRequest = parseCustomerBiteSaverStartRequest(startRequest({
    clientRequestId: "client-request-0002",
    searchText: "root beer",
  }));
  const first = canonicalCustomerBiteSaverCriteria(firstRequest);
  const retry = canonicalCustomerBiteSaverCriteria(retryRequest);
  assert.equal(first.searchProtocolVersion, customerBiteSaverSearchProtocolVersion);
  assert.equal(
    first.restaurantProjectionVersion,
    customerBiteSaverRestaurantProjectionVersion,
  );
  assert.equal(first.offerProjectionVersion, customerBiteSaverOfferProjectionVersion);
  assert.equal(first.normalizedSearchQuery, "root beer");
  assert.deepEqual(first.staticFilters, {
    source: "biteSaver",
    publicVisible: true,
    customerDiscoverable: true,
  });
  assert.equal(Object.isFrozen(first), true);

  const fingerprint = createCustomerBiteSaverCriteriaFingerprint(first);
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(fingerprint, createCustomerBiteSaverCriteriaFingerprint(retry));
  for (const overrides of [
    {radiusMiles: 15},
    {searchText: "different"},
    {latitude: 28.5384},
    {longitude: -81.3793},
  ]) {
    const changed = canonicalCustomerBiteSaverCriteria(
      parseCustomerBiteSaverStartRequest(startRequest(overrides)),
    );
    assert.notEqual(
      createCustomerBiteSaverCriteriaFingerprint(changed),
      fingerprint,
      JSON.stringify(overrides),
    );
  }
  const differentAvailabilityClock = canonicalCustomerBiteSaverCriteria(
    parseCustomerBiteSaverStartRequest(startRequest({
      searchText: "root beer",
      timeZone: "America/Chicago",
      utcOffsetMinutes: -300,
    })),
  );
  assert.notEqual(
    createCustomerBiteSaverCriteriaFingerprint(differentAvailabilityClock),
    fingerprint,
    "offer eligibility depends on the session's canonical availability clock",
  );

  const vector = Array(customerBiteSaverCatalogGenerationShardCount).fill(0);
  const membership = createCustomerBiteSaverMembershipFingerprint({
    criteria: first,
    attemptGeneration: 1,
    catalogGenerationVector: vector,
  });
  assert.match(membership, /^[0-9a-f]{64}$/u);
  assert.notEqual(
    membership,
    createCustomerBiteSaverMembershipFingerprint({
      criteria: first,
      attemptGeneration: 2,
      catalogGenerationVector: vector,
    }),
  );
  const changedVector = [...vector];
  changedVector[15] = 1;
  assert.notEqual(
    membership,
    createCustomerBiteSaverMembershipFingerprint({
      criteria: first,
      attemptGeneration: 1,
      catalogGenerationVector: changedVector,
    }),
  );
  for (const invalid of [
    {attemptGeneration: -1, catalogGenerationVector: vector},
    {attemptGeneration: 1.5, catalogGenerationVector: vector},
    {attemptGeneration: 1, catalogGenerationVector: vector.slice(1)},
    {attemptGeneration: 1, catalogGenerationVector: [...vector.slice(1), -1]},
  ]) {
    assertContractError(
      () => createCustomerBiteSaverMembershipFingerprint({
        criteria: first,
        ...invalid,
      }),
      "failed-precondition",
    );
  }
});

test("criteria fingerprints use canonical typed cities rather than display text", () => {
  const displayVariant = canonicalCustomerBiteSaverCriteria(
    parseCustomerBiteSaverStartRequest(startRequest({
      locationMode: "typed",
      typedLocation: {
        kind: "city",
        city: "  OrLaNdO  ",
        state: " Florida ",
      },
    })),
  );
  const canonicalVariant = canonicalCustomerBiteSaverCriteria(
    parseCustomerBiteSaverStartRequest(startRequest({
      locationMode: "typed",
      typedLocation: {kind: "city", city: "orlando", state: "FL"},
    })),
  );

  assert.deepEqual(displayVariant.typedLocation, {
    kind: "city",
    city: "orlando",
    state: "FL",
  });
  assert.equal(
    createCustomerBiteSaverCriteriaFingerprint(displayVariant),
    createCustomerBiteSaverCriteriaFingerprint(canonicalVariant),
  );
});

test("binary64 spelling and catalog sharding are lossless and deterministic", () => {
  assert.equal(customerBiteSaverBinary64(0), "0000000000000000");
  assert.equal(customerBiteSaverBinary64(-0), "8000000000000000");
  assert.equal(customerBiteSaverBinary64(1), "3ff0000000000000");
  assert.equal(customerBiteSaverBinary64(-1), "bff0000000000000");
  assert.equal(customerBiteSaverBinary64(Number.MIN_VALUE), "0000000000000001");
  for (const value of [NaN, Infinity, -Infinity]) {
    assertContractError(() => customerBiteSaverBinary64(value));
  }

  const shardIds = Array.from(
    {length: customerBiteSaverCatalogGenerationShardCount},
    (_, index) => customerBiteSaverGenerationShardId(index),
  );
  assert.deepEqual(shardIds, [
    "shard_00", "shard_01", "shard_02", "shard_03",
    "shard_04", "shard_05", "shard_06", "shard_07",
    "shard_08", "shard_09", "shard_0a", "shard_0b",
    "shard_0c", "shard_0d", "shard_0e", "shard_0f",
  ]);
  assert.equal(
    customerBiteSaverGenerationShardForIdentity("restaurant:internal-id"),
    customerBiteSaverGenerationShardForIdentity("restaurant:internal-id"),
  );
  assert.ok(
    customerBiteSaverGenerationShardForIdentity("restaurant:internal-id") >= 0 &&
      customerBiteSaverGenerationShardForIdentity("restaurant:internal-id") < 16,
  );
  for (const value of [-1, 16, 1.5, NaN]) {
    assert.throws(() => customerBiteSaverGenerationShardId(value), RangeError);
  }
  assert.throws(() => customerBiteSaverGenerationShardForIdentity(""));
});
