const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const {
  createRestaurantAddressFingerprint,
  defaultRestaurantGeocodingTimeoutMilliseconds,
  geocodeStructuredUsRestaurantAddress,
  maximumRestaurantGeocodingTimeoutMilliseconds,
  normalizeStructuredUsRestaurantAddress,
} = require("../lib/restaurant_geocoding.js");
const {
  canonicalRestaurantGeohash,
  validRestaurantCoordinates,
} = require("../lib/restaurant_geo_helpers.js");

const defaultAddress = {
  streetAddress: "123 Main St",
  city: "Crystal River",
  state: "FL",
  zipCode: "34428",
};

const defaultCoordinates = {
  latitude: 28.8517,
  longitude: -82.487,
};

function address(overrides = {}) {
  return { ...defaultAddress, ...overrides };
}

function component(longName, shortName, types) {
  return {
    long_name: longName,
    short_name: shortName,
    types,
  };
}

function providerResult(overrides = {}) {
  const {
    latitude = defaultCoordinates.latitude,
    longitude = defaultCoordinates.longitude,
    formattedAddress = "123 Main St, Crystal River, FL 34428, USA",
    countryCode = "US",
    countryName = countryCode === "US" ? "United States" : "Canada",
    state = "FL",
    zipCode = "34428",
    city = "Crystal River",
    streetNumber = "123",
    route = "Main Street",
    routeShortName = route,
    subpremise = null,
    floor = null,
    room = null,
    types = ["street_address"],
    locationType = "ROOFTOP",
    partialMatch = false,
    includeCountry = true,
    includeState = true,
    includeZip = true,
    includeCity = true,
    includeStreetNumber = true,
    includeRoute = true,
    includeGeometry = true,
    additionalComponents = [],
  } = overrides;

  const addressComponents = [];
  if (includeStreetNumber) {
    addressComponents.push(
      component(streetNumber, streetNumber, ["street_number"]),
    );
  }
  if (includeRoute) {
    addressComponents.push(component(route, routeShortName, ["route"]));
  }
  if (subpremise !== null) {
    addressComponents.push(component(subpremise, subpremise, ["subpremise"]));
  }
  if (floor !== null) {
    addressComponents.push(component(floor, floor, ["floor"]));
  }
  if (room !== null) {
    addressComponents.push(component(room, room, ["room"]));
  }
  if (includeCity) {
    addressComponents.push(component(city, city, ["locality", "political"]));
  }
  if (includeState) {
    addressComponents.push(
      component(state, state, ["administrative_area_level_1", "political"]),
    );
  }
  if (includeZip) {
    addressComponents.push(component(zipCode, zipCode, ["postal_code"]));
  }
  if (includeCountry) {
    addressComponents.push(
      component(countryName, countryCode, ["country", "political"]),
    );
  }
  addressComponents.push(...additionalComponents);

  return {
    formatted_address: formattedAddress,
    address_components: addressComponents,
    types,
    ...(partialMatch ? { partial_match: true } : {}),
    ...(includeGeometry
      ? {
          geometry: {
            location: { lat: latitude, lng: longitude },
            location_type: locationType,
          },
        }
      : {}),
    place_id: "provider-place-id-must-not-be-returned",
    raw_private_field: "raw-provider-payload-must-not-be-returned",
  };
}

function geocodingResponse(payload, ok = true) {
  return {
    ok,
    json: async () => payload,
  };
}

function successPayload(results = [providerResult()]) {
  return { status: "OK", results };
}

function permutations(values) {
  if (values.length <= 1) {
    return [values];
  }
  return values.flatMap((value, index) =>
    permutations(values.filter((_entry, entryIndex) => entryIndex !== index))
      .map((remaining) => [value, ...remaining]),
  );
}

function expectGeocodingError(code, messagePattern) {
  return (error) => {
    assert.equal(error?.code, code);
    if (messagePattern) {
      assert.match(error.message, messagePattern);
    }
    return true;
  };
}

async function geocodeWithPayload(
  payload,
  {
    input = defaultAddress,
    apiKey = "test-api-key",
    timeoutMilliseconds,
    ok = true,
    inspectRequest,
  } = {},
) {
  return geocodeStructuredUsRestaurantAddress(input, {
    getGeocodingApiKey: () => apiKey,
    fetchGeocoding: async (url, init) => {
      inspectRequest?.(url, init);
      return geocodingResponse(payload, ok);
    },
    ...(timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }),
  });
}

test("structured address normalization trims, collapses spaces, and uppercases state", () => {
  assert.deepEqual(
    normalizeStructuredUsRestaurantAddress({
      streetAddress: "  123   Main St  ",
      city: "  Crystal   River ",
      state: " fl ",
      zipCode: " 34428 ",
    }),
    defaultAddress,
  );
});

test("structured address normalization preserves exact limits and leading-zero ZIPs", () => {
  const normalized = normalizeStructuredUsRestaurantAddress({
    streetAddress: "S".repeat(200),
    city: "C".repeat(100),
    state: "nj",
    zipCode: "07001",
  });
  assert.equal(normalized.streetAddress.length, 200);
  assert.equal(normalized.city.length, 100);
  assert.equal(normalized.state, "NJ");
  assert.equal(normalized.zipCode, "07001");
});

test("structured address normalization requires exactly the controlled four fields", () => {
  for (const input of [
    null,
    "123 Main St",
    [],
    { streetAddress: "123 Main St" },
    { ...defaultAddress, latitude: 28.8 },
    { ...defaultAddress, longitude: -82.4 },
    { ...defaultAddress, location: {} },
    { ...defaultAddress, geoPoint: {} },
    { ...defaultAddress, geohash: "abc" },
    { ...defaultAddress, formattedAddress: "provider text" },
    { ...defaultAddress, provider: "google" },
  ]) {
    assert.throws(
      () => normalizeStructuredUsRestaurantAddress(input),
      expectGeocodingError("invalid-argument"),
    );
  }
});

test("structured address normalization rejects empty and non-string fields", () => {
  for (const field of Object.keys(defaultAddress)) {
    for (const invalidValue of ["", "   ", null, 123, true]) {
      assert.throws(
        () =>
          normalizeStructuredUsRestaurantAddress(
            address({ [field]: invalidValue }),
          ),
        expectGeocodingError("invalid-argument"),
      );
    }
  }
});

test("structured address normalization rejects invalid states and ZIPs", () => {
  for (const state of ["ZZ", "Florida", "F", "F1"]) {
    assert.throws(
      () => normalizeStructuredUsRestaurantAddress(address({ state })),
      expectGeocodingError("invalid-argument", /State/),
    );
  }
  for (const zipCode of ["3442", "344289", "34428-1234", "ABCDE"]) {
    assert.throws(
      () => normalizeStructuredUsRestaurantAddress(address({ zipCode })),
      expectGeocodingError("invalid-argument", /ZIP/),
    );
  }
});

test("structured address normalization rejects excessive lengths without truncation", () => {
  assert.throws(
    () =>
      normalizeStructuredUsRestaurantAddress(
        address({ streetAddress: "S".repeat(201) }),
      ),
    expectGeocodingError("invalid-argument", /200/),
  );
  assert.throws(
    () =>
      normalizeStructuredUsRestaurantAddress(
        address({ city: "C".repeat(101) }),
      ),
    expectGeocodingError("invalid-argument", /100/),
  );
  assert.throws(
    () =>
      normalizeStructuredUsRestaurantAddress(
        address({ streetAddress: `123${" ".repeat(900)}Main St` }),
      ),
    expectGeocodingError("invalid-argument", /200/),
  );
});

test("structured address normalization rejects control and formatting characters before whitespace collapse", () => {
  for (const field of Object.keys(defaultAddress)) {
    for (const control of [
      "\n",
      "\t",
      "\u0000",
      "\u007f",
      "\u0085",
      "\u200b",
      "\u202e",
      "\u2066",
    ]) {
      assert.throws(
        () =>
          normalizeStructuredUsRestaurantAddress(
            address({ [field]: `${defaultAddress[field]}${control}` }),
          ),
        expectGeocodingError("invalid-argument", /control characters/),
      );
    }
  }
});

test("address fingerprint has a fixed SHA-256 fixture", () => {
  assert.equal(
    createRestaurantAddressFingerprint({
      streetAddress: "123 Main St",
      city: "Springfield",
      state: "IL",
      zipCode: "62704",
    }),
    "62728f71c9ba9406e2fb7783ad4844f10fba3435d24fdfde431c021f49d9bd1e",
  );
});

test("address fingerprint is stable across harmless case, whitespace, and NFKC differences", () => {
  const expected = createRestaurantAddressFingerprint(defaultAddress);
  assert.equal(
    createRestaurantAddressFingerprint({
      streetAddress: "  １２３   MAIN st ",
      city: " crystal   RIVER ",
      state: "fl",
      zipCode: "34428",
    }),
    expected,
  );
});

test("address fingerprint changes for every meaningful address-field change", () => {
  const expected = createRestaurantAddressFingerprint(defaultAddress);
  for (const changed of [
    address({ streetAddress: "124 Main St" }),
    address({ city: "Inverness" }),
    address({ state: "GA" }),
    address({ zipCode: "34429" }),
  ]) {
    assert.notEqual(createRestaurantAddressFingerprint(changed), expected);
  }
});

test("address fingerprint is lowercase hexadecimal and field-boundary safe", () => {
  const first = createRestaurantAddressFingerprint({
    streetAddress: "12 Main",
    city: "A|B",
    state: "FL",
    zipCode: "34428",
  });
  const second = createRestaurantAddressFingerprint({
    streetAddress: "12 Main|A",
    city: "B",
    state: "FL",
    zipCode: "34428",
  });
  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.match(second, /^[0-9a-f]{64}$/u);
  assert.notEqual(first, second);
});

test("strict geocoding returns only canonical safe fields for a valid US street address", async () => {
  const result = await geocodeWithPayload(successPayload());
  assert.deepEqual(result, {
    ...defaultAddress,
    formattedAddress: "123 Main St, Crystal River, FL 34428, USA",
    ...defaultCoordinates,
    addressFingerprint: createRestaurantAddressFingerprint(defaultAddress),
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "addressFingerprint",
    "city",
    "formattedAddress",
    "latitude",
    "longitude",
    "state",
    "streetAddress",
    "zipCode",
  ]);
  assert.equal(JSON.stringify(result).includes("provider-place-id"), false);
  assert.equal(JSON.stringify(result).includes("raw-provider"), false);
});

test("strict geocoding accepts ROOFTOP and RANGE_INTERPOLATED street results", async () => {
  for (const locationType of ["ROOFTOP", "RANGE_INTERPOLATED"]) {
    const result = await geocodeWithPayload(
      successPayload([providerResult({ locationType })]),
    );
    assert.deepEqual(
      validRestaurantCoordinates(result.latitude, result.longitude),
      defaultCoordinates,
    );
  }
});

test("strict geocoding accepts precise premise and matching subpremise results", async () => {
  const premise = await geocodeWithPayload(
    successPayload([providerResult({ types: ["premise"] })]),
  );
  assert.equal(premise.zipCode, "34428");

  const subpremise = await geocodeWithPayload(
    successPayload([
      providerResult({
        formattedAddress:
          "123 Main St #200, Crystal River, FL 34428, USA",
        subpremise: "Suite 200",
        types: ["subpremise"],
      }),
    ]),
    { input: address({ streetAddress: "123 Main St #200" }) },
  );
  assert.equal(subpremise.streetAddress, "123 Main St #200");
});

test("strict geocoding matches provider floor and room identity without collapsing secondary locations", async () => {
  for (const [label, providerOverride] of [
    ["Floor 2", { floor: "2" }],
    ["Room 2", { room: "2" }],
  ]) {
    const input = address({ streetAddress: `123 Main St ${label}` });
    const result = await geocodeWithPayload(
      successPayload([providerResult({ ...providerOverride, types: ["premise"] })]),
      { input },
    );
    assert.equal(result.streetAddress, input.streetAddress);

    await assert.rejects(
      geocodeWithPayload(
        successPayload([
          providerResult({ ...providerOverride, types: ["premise"] }),
        ]),
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("strict geocoding preserves explicit provider secondary-unit semantics", async () => {
  const rejectedPairs = [
    {
      streetAddress: "123 Main St Suite 2",
      providerOverride: { subpremise: "Floor 2" },
    },
    {
      streetAddress: "123 Main St Suite 2",
      providerOverride: { subpremise: "Room 2" },
    },
    {
      streetAddress: "123 Main St Floor 2",
      providerOverride: { subpremise: "Suite 2" },
    },
    {
      streetAddress: "123 Main St Room 2",
      providerOverride: { floor: "2" },
    },
    {
      streetAddress: "123 Main St Floor 2",
      providerOverride: { floor: "Room 2" },
    },
    {
      streetAddress: "123 Main St Room 2",
      providerOverride: { room: "Floor 2" },
    },
    {
      streetAddress: "123 Main St Suite 2",
      providerOverride: { subpremise: "Unit 2" },
    },
    {
      streetAddress: "123 Main St Apartment 2",
      providerOverride: { subpremise: "Suite 2" },
    },
  ];
  for (const { streetAddress, providerOverride } of rejectedPairs) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([providerResult(providerOverride)]),
        { input: address({ streetAddress }) },
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }

  const acceptedPairs = [
    {
      streetAddress: "123 Main St Suite 2",
      providerOverride: { subpremise: "Suite 2" },
    },
    {
      streetAddress: "123 Main St Floor 2",
      providerOverride: { floor: "2" },
    },
    {
      streetAddress: "123 Main St Room 2",
      providerOverride: { room: "2" },
    },
    {
      streetAddress: "123 Main St Floor 2",
      providerOverride: { subpremise: "Floor 2" },
    },
    {
      streetAddress: "123 Main St Room 2",
      providerOverride: { subpremise: "Room 2" },
    },
  ];
  for (const { streetAddress, providerOverride } of acceptedPairs) {
    const result = await geocodeWithPayload(
      successPayload([providerResult(providerOverride)]),
      { input: address({ streetAddress }) },
    );
    assert.equal(result.streetAddress, streetAddress);
  }
});

test("bare generic subpremise evidence has narrow compatibility", async () => {
  for (const streetAddress of [
    "123 Main St Suite 2",
    "123 Main St Unit 2",
    "123 Main St Apartment 2",
    "123 Main St #2",
  ]) {
    const result = await geocodeWithPayload(
      successPayload([providerResult({ subpremise: "2" })]),
      { input: address({ streetAddress }) },
    );
    assert.equal(result.streetAddress, streetAddress);
  }

  for (const streetAddress of [
    "123 Main St Floor 2",
    "123 Main St Room 2",
  ]) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([providerResult({ subpremise: "2" })]),
        { input: address({ streetAddress }) },
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("provider secondary aliases refine bare evidence but reject conflicts", async () => {
  const result = await geocodeWithPayload(
    successPayload([
      providerResult({
        additionalComponents: [
          component("Suite 2", "2", ["subpremise"]),
        ],
      }),
    ]),
    { input: address({ streetAddress: "123 Main St Suite 2" }) },
  );
  assert.equal(result.streetAddress, "123 Main St Suite 2");

  for (const additionalComponent of [
    component("Suite 2", "Unit 2", ["subpremise"]),
    component("Floor 2", "Room 2", ["subpremise"]),
    component("2", "3", ["subpremise"]),
    component("Room 2", "Room 2", ["floor"]),
  ]) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([
          providerResult({ additionalComponents: [additionalComponent] }),
        ]),
        { input: address({ streetAddress: "123 Main St Suite 2" }) },
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("subpremise result types require subpremise-family unit evidence", async () => {
  for (const { streetAddress, providerOverride } of [
    {
      streetAddress: "123 Main St Floor 2",
      providerOverride: { floor: "2", types: ["subpremise"] },
    },
    {
      streetAddress: "123 Main St Floor 2",
      providerOverride: { subpremise: "Floor 2", types: ["subpremise"] },
    },
    {
      streetAddress: "123 Main St Room 2",
      providerOverride: { room: "2", types: ["subpremise"] },
    },
    {
      streetAddress: "123 Main St Room 2",
      providerOverride: { subpremise: "Room 2", types: ["subpremise"] },
    },
  ]) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([providerResult(providerOverride)]),
        {
          input: address({ streetAddress }),
        },
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("different and compound secondary identities fail closed", async () => {
  await assert.rejects(
    geocodeWithPayload(
      successPayload([providerResult({ subpremise: "Suite 3" })]),
      { input: address({ streetAddress: "123 Main St Suite 2" }) },
    ),
    expectGeocodingError("failed-precondition", /precise/),
  );

  await assert.rejects(
    geocodeWithPayload(
      successPayload([providerResult({ subpremise: "Suite 2" })]),
      {
        input: address({
          streetAddress: "123 Main St Suite 2 Floor 3",
        }),
      },
    ),
    expectGeocodingError("failed-precondition", /precise/),
  );

  await assert.rejects(
    geocodeWithPayload(
      successPayload([
        providerResult({ subpremise: "Suite 2", floor: "3" }),
      ]),
      { input: address({ streetAddress: "123 Main St Suite 2" }) },
    ),
    expectGeocodingError("failed-precondition", /precise/),
  );
});

test("strict geocoding never substitutes or deduplicates a different unit", async () => {
  const input = address({ streetAddress: "123 Main St Suite 200" });
  await assert.rejects(
    geocodeWithPayload(
      successPayload([
        providerResult({
          formattedAddress:
            "123 Main St Suite 100, Crystal River, FL 34428, USA",
          subpremise: "100",
          types: ["subpremise"],
        }),
      ]),
      { input },
    ),
    expectGeocodingError("failed-precondition", /precise/),
  );

  const result = await geocodeWithPayload(
    successPayload([
      providerResult({ subpremise: "Suite 100", types: ["subpremise"] }),
      providerResult({
        formattedAddress:
          "123 Main St Suite 200, Crystal River, FL 34428, USA",
        subpremise: "Ste 200",
        types: ["subpremise"],
      }),
    ]),
    { input },
  );
  assert.equal(
    result.formattedAddress,
    "123 Main St Suite 200, Crystal River, FL 34428, USA",
  );
});

test("strict geocoding rejects an unrequested or unevidenced subpremise", async () => {
  for (const result of [
    providerResult({ subpremise: "200", types: ["subpremise"] }),
    providerResult({ types: ["subpremise"] }),
  ]) {
    await assert.rejects(
      geocodeWithPayload(successPayload([result])),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("strict geocoding permits GEOMETRIC_CENTER only for a complete precise establishment", async () => {
  const result = await geocodeWithPayload(
    successPayload([
      providerResult({
        types: ["restaurant", "food", "establishment"],
        locationType: "GEOMETRIC_CENTER",
      }),
    ]),
  );
  assert.equal(result.formattedAddress, providerResult().formatted_address);
});

test("strict geocoding normalizes a safe provider formatted address", async () => {
  const result = await geocodeWithPayload(
    successPayload([
      providerResult({
        formattedAddress: "  123 Main St,   Crystal River, FL 34428, USA  ",
      }),
    ]),
  );
  assert.equal(
    result.formattedAddress,
    "123 Main St, Crystal River, FL 34428, USA",
  );
});

test("strict geocoding rejects unsafe provider formatted addresses", async () => {
  for (const formattedAddress of [
    "123 Main St\u202e, Crystal River, FL 34428, USA",
    "A".repeat(501),
  ]) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([providerResult({ formattedAddress })]),
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("city matching accepts provider-evidenced mailing aliases and conservative abbreviations", async () => {
  const aliasResult = await geocodeWithPayload(
    successPayload([
      providerResult({
        city: "Queens",
        additionalComponents: [
          component("Long Island City", "Long Island City", [
            "sublocality_level_1",
            "political",
          ]),
        ],
      }),
    ]),
    { input: address({ city: "Long Island City" }) },
  );
  assert.equal(aliasResult.city, "Long Island City");

  const abbreviationResult = await geocodeWithPayload(
    successPayload([
      providerResult({ city: "Saint Augustine" }),
    ]),
    { input: address({ city: "St. Augustine" }) },
  );
  assert.equal(abbreviationResult.city, "St. Augustine");
});

test("strict geocoding ignores rejected candidates when exactly one trustworthy result remains", async () => {
  const result = await geocodeWithPayload(
    successPayload([
      null,
      providerResult({ countryCode: "CA" }),
      providerResult({ partialMatch: true }),
      providerResult({ formattedAddress: "Trusted result" }),
    ]),
  );
  assert.equal(result.formattedAddress, "Trusted result");
});

test("equivalent provider duplicates are deduplicated and deterministically prefer better quality", async () => {
  const result = await geocodeWithPayload(
    successPayload([
      providerResult({
        formattedAddress: "Interpolated result",
        locationType: "RANGE_INTERPOLATED",
      }),
      providerResult({
        formattedAddress: "Rooftop result",
        locationType: "ROOFTOP",
        latitude: defaultCoordinates.latitude + 0.00001,
      }),
    ]),
  );
  assert.equal(result.formattedAddress, "Rooftop result");
});

test("three-candidate distance-chain ambiguity is provider-order independent", async () => {
  const candidates = [
    providerResult({
      formattedAddress: "Chain A",
      latitude: defaultCoordinates.latitude,
    }),
    providerResult({
      formattedAddress: "Chain B",
      latitude: defaultCoordinates.latitude + 0.00035,
    }),
    providerResult({
      formattedAddress: "Chain C",
      latitude: defaultCoordinates.latitude + 0.0007,
    }),
  ];

  for (const orderedCandidates of permutations(candidates)) {
    await assert.rejects(
      geocodeWithPayload(successPayload(orderedCandidates)),
      expectGeocodingError("failed-precondition", /Multiple matching/),
    );
  }
});

test("three pairwise-equivalent candidates are accepted in every provider order", async () => {
  const candidates = [
    providerResult({
      formattedAddress: "Zulu equivalent",
      latitude: defaultCoordinates.latitude,
    }),
    providerResult({
      formattedAddress: "Alpha equivalent",
      latitude: defaultCoordinates.latitude + 0.0001,
    }),
    providerResult({
      formattedAddress: "Middle equivalent",
      latitude: defaultCoordinates.latitude + 0.0002,
    }),
  ];

  for (const orderedCandidates of permutations(candidates)) {
    const result = await geocodeWithPayload(
      successPayload(orderedCandidates),
    );
    assert.equal(result.formattedAddress, "Alpha equivalent");
    assert.equal(
      result.latitude,
      defaultCoordinates.latitude + 0.0001,
    );
  }
});

test("materially distinct normalized secondary identities remain ambiguous", async () => {
  await assert.rejects(
    geocodeWithPayload(
      successPayload([
        providerResult({
          formattedAddress: "Suite identity",
          subpremise: "Suite 2",
        }),
        providerResult({
          formattedAddress: "Unit identity",
          subpremise: "Unit 2",
          latitude: defaultCoordinates.latitude + 0.00001,
        }),
      ]),
      { input: address({ streetAddress: "123 Main St #2" }) },
    ),
    expectGeocodingError("failed-precondition", /Multiple matching/),
  );
});

test("exact duplicate provider copies do not create false ambiguity", async () => {
  const duplicate = providerResult({ formattedAddress: "Exact duplicate" });
  const result = await geocodeWithPayload(
    successPayload([duplicate, duplicate, duplicate]),
  );
  assert.equal(result.formattedAddress, "Exact duplicate");
});

test("strict geocoding coordinates use the same contract as geohash helpers", async () => {
  const result = await geocodeWithPayload(successPayload());
  const coordinates = validRestaurantCoordinates(
    result.latitude,
    result.longitude,
  );
  assert.deepEqual(coordinates, defaultCoordinates);
  assert.match(canonicalRestaurantGeohash(coordinates), /^[0-9bcdefghjkmnpqrstuvwxyz]{10}$/u);
});

test("successful transport cleanup prevents a late abort", async () => {
  let abortEvents = 0;
  const result = await geocodeStructuredUsRestaurantAddress(defaultAddress, {
    getGeocodingApiKey: () => "test-api-key",
    fetchGeocoding: async (_url, init) => {
      init.signal.addEventListener("abort", () => {
        abortEvents += 1;
      });
      return geocodingResponse(successPayload());
    },
    timeoutMilliseconds: 5,
  });
  assert.equal(result.state, "FL");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(abortEvents, 0);
});

test("malformed response accessors are controlled and cannot leave a late abort", async () => {
  for (const throwingProperty of ["ok", "json"]) {
    let abortEvents = 0;
    await assert.rejects(
      geocodeStructuredUsRestaurantAddress(defaultAddress, {
        getGeocodingApiKey: () => "test-api-key",
        fetchGeocoding: async (_url, init) => {
          init.signal.addEventListener("abort", () => {
            abortEvents += 1;
          });
          const response = {};
          Object.defineProperty(response, "ok", {
            get() {
              if (throwingProperty === "ok") {
                throw new Error("raw response getter detail");
              }
              return true;
            },
          });
          Object.defineProperty(response, "json", {
            get() {
              if (throwingProperty === "json") {
                throw new Error("raw response getter detail");
              }
              return async () => successPayload();
            },
          });
          return response;
        },
        timeoutMilliseconds: 5,
      }),
      expectGeocodingError("internal", /invalid response/),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(abortEvents, 0);
  }
});

test("strict geocoding reports no result for ZERO_RESULTS and empty result sets", async () => {
  for (const payload of [
    { status: "ZERO_RESULTS", results: [] },
    { status: "OK", results: [] },
  ]) {
    await assert.rejects(
      geocodeWithPayload(payload),
      expectGeocodingError("not-found", /No matching/),
    );
  }
});

test("strict geocoding rejects exclusively non-US results", async () => {
  await assert.rejects(
    geocodeWithPayload(
      successPayload([providerResult({ countryCode: "CA" })]),
    ),
    expectGeocodingError("not-found", /United States/),
  );
});

test("strict geocoding rejects partial matches", async () => {
  await assert.rejects(
    geocodeWithPayload(successPayload([providerResult({ partialMatch: true })])),
    expectGeocodingError("failed-precondition", /precise/),
  );
});

test("strict geocoding fails closed for malformed partial-match metadata", async () => {
  for (const partialMatch of ["true", 1, null, {}]) {
    const result = providerResult();
    result.partial_match = partialMatch;
    await assert.rejects(
      geocodeWithPayload(successPayload([result])),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("strict geocoding rejects state and ZIP mismatches", async () => {
  for (const result of [
    providerResult({ state: "GA" }),
    providerResult({ zipCode: "34429" }),
  ]) {
    await assert.rejects(
      geocodeWithPayload(successPayload([result])),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("strict geocoding accepts provider ZIP+4 evidence for the requested five-digit ZIP", async () => {
  const result = await geocodeWithPayload(
    successPayload([providerResult({ zipCode: "34428-1234" })]),
  );
  assert.equal(result.zipCode, "34428");
});

test("strict geocoding rejects unrelated or missing provider city evidence", async () => {
  for (const result of [
    providerResult({ city: "Inverness" }),
    providerResult({ includeCity: false }),
  ]) {
    await assert.rejects(
      geocodeWithPayload(successPayload([result])),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("strict geocoding rejects missing street-level components and street mismatch", async () => {
  for (const result of [
    providerResult({ includeStreetNumber: false }),
    providerResult({ includeRoute: false }),
    providerResult({ streetNumber: "124" }),
    providerResult({ route: "Other Road" }),
  ]) {
    await assert.rejects(
      geocodeWithPayload(successPayload([result])),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("strict street matching accepts an exact provider route short-name alias", async () => {
  const result = await geocodeWithPayload(
    successPayload([
      providerResult({
        route: "U.S. Highway 19",
        routeShortName: "US-19",
      }),
    ]),
    { input: address({ streetAddress: "123 US-19" }) },
  );
  assert.equal(result.streetAddress, "123 US-19");
});

test("strict street matching keeps FL and RM tokens inside provider-evidenced routes", async () => {
  const cases = [
    {
      streetAddress: "123 FL-44",
      route: "Florida State Road 44",
      routeShortName: "FL-44",
    },
    {
      streetAddress: "123 FL 44",
      route: "Florida State Road 44",
      routeShortName: "FL-44",
    },
    {
      streetAddress: "123 RM-620",
      route: "Ranch to Market Road 620",
      routeShortName: "RM-620",
    },
    {
      streetAddress: "123 RM 620",
      route: "Ranch to Market Road 620",
      routeShortName: "RM-620",
    },
  ];

  for (const { streetAddress, route, routeShortName } of cases) {
    const result = await geocodeWithPayload(
      successPayload([providerResult({ route, routeShortName })]),
      { input: address({ streetAddress }) },
    );
    assert.equal(result.streetAddress, streetAddress);
  }
});

test("route-aware parsing still recognizes genuine trailing floor and room units", async () => {
  for (const { streetAddress, providerOverride } of [
    {
      streetAddress: "123 Main St Fl 2",
      providerOverride: { floor: "2" },
    },
    {
      streetAddress: "123 Main St Rm 2",
      providerOverride: { room: "2" },
    },
  ]) {
    const result = await geocodeWithPayload(
      successPayload([providerResult(providerOverride)]),
      { input: address({ streetAddress }) },
    );
    assert.equal(result.streetAddress, streetAddress);
  }
});

test("provider route evidence cannot be consumed again as a secondary unit", async () => {
  const routeResult = await geocodeWithPayload(
    successPayload([
      providerResult({
        route: "Main Street Floor 2",
        routeShortName: "Main St",
      }),
    ]),
    {
      input: address({
        streetAddress: "123 Main Street Floor 2",
      }),
    },
  );
  assert.equal(routeResult.streetAddress, "123 Main Street Floor 2");

  for (const providerOverride of [
    {
      route: "Florida State Road 44",
      routeShortName: "FL-44",
      floor: "44",
    },
    {
      route: "Ranch to Market Road 620",
      routeShortName: "RM-620",
      room: "620",
    },
  ]) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([providerResult(providerOverride)]),
        {
          input: address({
            streetAddress: providerOverride.routeShortName === "FL-44"
              ? "123 FL-44"
              : "123 RM-620",
          }),
        },
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("route-aware parsing rejects malformed and unmatched requested routes", async () => {
  const cases = [
    {
      streetAddress: "123 FL",
      route: "Florida State Road 44",
      routeShortName: "FL-44",
    },
    {
      streetAddress: "123 XX-44",
      route: "Florida State Road 44",
      routeShortName: "FL-44",
    },
    {
      streetAddress: "123 Main St Fl",
      route: "Main Street",
      routeShortName: "Main St",
    },
    {
      streetAddress: "123 Main St Fl 2 Room 3",
      route: "Main Street",
      routeShortName: "Main St",
    },
  ];
  for (const { streetAddress, route, routeShortName } of cases) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([
          providerResult({ route, routeShortName }),
        ]),
        { input: address({ streetAddress }) },
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("route-aware parsing preserves directional and ordinary route aliases", async () => {
  const result = await geocodeWithPayload(
    successPayload([
      providerResult({
        route: "North Main Street",
        routeShortName: "N Main St",
      }),
    ]),
    { input: address({ streetAddress: "123 N Main Street" }) },
  );
  assert.equal(result.streetAddress, "123 N Main Street");
});

test("strict geocoding rejects city, ZIP-centroid, route-only, county, state, and country result types", async () => {
  for (const type of [
    "locality",
    "postal_code",
    "route",
    "administrative_area_level_2",
    "administrative_area_level_1",
    "country",
  ]) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([providerResult({ types: [type] })]),
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("strict geocoding rejects approximate and unsupported location quality", async () => {
  for (const locationType of ["APPROXIMATE", "UNKNOWN", ""]) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([providerResult({ locationType })]),
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
  await assert.rejects(
    geocodeWithPayload(
      successPayload([
        providerResult({
          types: ["street_address"],
          locationType: "GEOMETRIC_CENTER",
        }),
      ]),
    ),
    expectGeocodingError("failed-precondition", /precise/),
  );
});

test("strict geocoding rejects coordinates rejected by the canonical validator", async () => {
  const invalidCoordinates = [
    { latitude: 91, longitude: -82 },
    { latitude: -91, longitude: -82 },
    { latitude: 28, longitude: 181 },
    { latitude: 28, longitude: -181 },
    { latitude: 0, longitude: 0 },
    { latitude: Number.NaN, longitude: -82 },
    { latitude: Number.POSITIVE_INFINITY, longitude: -82 },
    { latitude: "28", longitude: -82 },
  ];
  for (const coordinates of invalidCoordinates) {
    assert.equal(
      validRestaurantCoordinates(
        coordinates.latitude,
        coordinates.longitude,
      ),
      null,
    );
    await assert.rejects(
      geocodeWithPayload(
        successPayload([providerResult(coordinates)]),
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("strict geocoding rejects missing geometry and malformed candidates safely", async () => {
  await assert.rejects(
    geocodeWithPayload(
      successPayload([providerResult({ includeGeometry: false })]),
    ),
    expectGeocodingError("failed-precondition", /precise/),
  );
  for (const payload of [
    null,
    {},
    { status: "OK" },
    { status: "OK", results: [null] },
  ]) {
    await assert.rejects(
      geocodeWithPayload(payload),
      expectGeocodingError("internal", /invalid response/),
    );
  }
});

test("strict geocoding rejects conflicting provider address components", async () => {
  for (const extraComponent of [
    component("Georgia", "GA", ["administrative_area_level_1"]),
    component("34429", "34429", ["postal_code"]),
    component("Canada", "CA", ["country"]),
  ]) {
    await assert.rejects(
      geocodeWithPayload(
        successPayload([
          providerResult({ additionalComponents: [extraComponent] }),
        ]),
      ),
      expectGeocodingError("failed-precondition", /precise/),
    );
  }
});

test("multiple materially distinct trustworthy results are ambiguous", async () => {
  await assert.rejects(
    geocodeWithPayload(
      successPayload([
        providerResult({ formattedAddress: "First precise result" }),
        providerResult({
          formattedAddress: "Second precise result",
          latitude: defaultCoordinates.latitude + 0.01,
        }),
      ]),
    ),
    expectGeocodingError("failed-precondition", /Multiple matching/),
  );
});

test("provider error statuses are mapped to a controlled unavailable error", async () => {
  for (const status of ["REQUEST_DENIED", "OVER_QUERY_LIMIT", "UNKNOWN_ERROR"]) {
    await assert.rejects(
      geocodeWithPayload({
        status,
        error_message: "RAW_PROVIDER_DETAIL",
      }),
      expectGeocodingError("unavailable", /temporarily unavailable/),
    );
  }
});

test("HTTP failures are controlled and their response body is never parsed", async () => {
  let jsonCalls = 0;
  await assert.rejects(
    geocodeStructuredUsRestaurantAddress(defaultAddress, {
      getGeocodingApiKey: () => "test-api-key",
      fetchGeocoding: async () => ({
        ok: false,
        json: async () => {
          jsonCalls += 1;
          return { raw: "must not be parsed" };
        },
      }),
    }),
    expectGeocodingError("unavailable"),
  );
  assert.equal(jsonCalls, 0);
});

test("JSON parse failure and malformed response objects are controlled", async () => {
  await assert.rejects(
    geocodeStructuredUsRestaurantAddress(defaultAddress, {
      getGeocodingApiKey: () => "test-api-key",
      fetchGeocoding: async () => ({
        ok: true,
        json: async () => {
          throw new Error("raw parse detail");
        },
      }),
    }),
    expectGeocodingError("internal", /invalid response/),
  );
  await assert.rejects(
    geocodeStructuredUsRestaurantAddress(defaultAddress, {
      getGeocodingApiKey: () => "test-api-key",
      fetchGeocoding: async () => null,
    }),
    expectGeocodingError("internal", /invalid response/),
  );
});

test("unknown fetch failures become generic safe provider errors", async () => {
  const rawDetail = "raw fetch failure with sensitive context";
  let thrown;
  try {
    await geocodeStructuredUsRestaurantAddress(defaultAddress, {
      getGeocodingApiKey: () => "test-api-key",
      fetchGeocoding: async () => {
        throw new Error(rawDetail);
      },
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.code, "unavailable");
  assert.doesNotMatch(thrown.message, new RegExp(rawDetail));
});

test("request timeout aborts the injected fetch with a controlled error", async () => {
  await assert.rejects(
    geocodeStructuredUsRestaurantAddress(defaultAddress, {
      getGeocodingApiKey: () => "test-api-key",
      fetchGeocoding: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new Error("raw aborted detail"));
          });
        }),
      timeoutMilliseconds: 5,
    }),
    expectGeocodingError("deadline-exceeded", /timed out/),
  );
});

test("the same timeout also protects a stalled response body", async () => {
  await assert.rejects(
    geocodeStructuredUsRestaurantAddress(defaultAddress, {
      getGeocodingApiKey: () => "test-api-key",
      fetchGeocoding: async () => ({
        ok: true,
        json: async () => new Promise(() => {}),
      }),
      timeoutMilliseconds: 5,
    }),
    expectGeocodingError("deadline-exceeded", /timed out/),
  );
});

test("missing or inaccessible API-key configuration fails before fetch", async () => {
  for (const getGeocodingApiKey of [
    () => "",
    () => "   ",
    () => {
      throw new Error("raw secret failure");
    },
  ]) {
    let fetchCalls = 0;
    await assert.rejects(
      geocodeStructuredUsRestaurantAddress(defaultAddress, {
        getGeocodingApiKey,
        fetchGeocoding: async () => {
          fetchCalls += 1;
          throw new Error("must not fetch");
        },
      }),
      expectGeocodingError("failed-precondition", /not configured/),
    );
    assert.equal(fetchCalls, 0);
  }
});

test("invalid structured input performs no key access or network request", async () => {
  let keyCalls = 0;
  let fetchCalls = 0;
  await assert.rejects(
    geocodeStructuredUsRestaurantAddress(
      address({ zipCode: "bad" }),
      {
        getGeocodingApiKey: () => {
          keyCalls += 1;
          return "test-api-key";
        },
        fetchGeocoding: async () => {
          fetchCalls += 1;
          return geocodingResponse(successPayload());
        },
      },
    ),
    expectGeocodingError("invalid-argument"),
  );
  assert.equal(keyCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("transport safely encodes the official endpoint and structured address parameters", async () => {
  const apiKey = "key+with&reserved#characters";
  let requestedUrl;
  const input = {
    streetAddress: "123 O'Brien & Sons Ave",
    city: "St. John's",
    state: "FL",
    zipCode: "34428",
  };
  await geocodeWithPayload(
    successPayload([
      providerResult({
        streetNumber: "123",
        route: "O'Brien & Sons Avenue",
        city: "Saint John's",
      }),
    ]),
    {
      input,
      apiKey,
      inspectRequest: (url, init) => {
        requestedUrl = new URL(url);
        assert.equal(init.method, "GET");
        assert.equal(init.signal.aborted, false);
      },
    },
  );
  assert.equal(requestedUrl.origin, "https://maps.googleapis.com");
  assert.equal(requestedUrl.pathname, "/maps/api/geocode/json");
  assert.equal(
    requestedUrl.searchParams.get("address"),
    "123 O'Brien & Sons Ave, St. John's, FL 34428",
  );
  assert.equal(requestedUrl.searchParams.get("components"), "country:US");
  assert.equal(requestedUrl.searchParams.get("region"), "us");
  assert.equal(requestedUrl.searchParams.get("key"), apiKey);
  assert.equal([...requestedUrl.searchParams.keys()].length, 4);
});

test("safe errors never expose API keys, full URLs, or provider payloads", async () => {
  const apiKey = "secret-api-key-must-not-escape";
  const rawProviderText = "RAW_PROVIDER_RESPONSE_SHOULD_NOT_ESCAPE";
  let thrown;
  try {
    await geocodeWithPayload(
      {
        status: "REQUEST_DENIED",
        error_message: `${rawProviderText} ${apiKey}`,
      },
      { apiKey },
    );
  } catch (error) {
    thrown = error;
  }
  const serialized = `${thrown?.message} ${JSON.stringify(thrown)}`;
  assert.equal(thrown.code, "unavailable");
  assert.doesNotMatch(serialized, new RegExp(apiKey));
  assert.doesNotMatch(serialized, new RegExp(rawProviderText));
  assert.doesNotMatch(serialized, /maps\.googleapis\.com/u);
});

test("an API key echoed by the provider cannot enter a returned formatted address", async () => {
  const apiKey = "secret-api-key-must-not-escape";
  let thrown;
  try {
    await geocodeWithPayload(
      successPayload([
        providerResult({ formattedAddress: `Echo ${apiKey}` }),
      ]),
      { apiKey },
    );
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.code, "failed-precondition");
  assert.doesNotMatch(`${thrown.message} ${JSON.stringify(thrown)}`, new RegExp(apiKey));
});

test("geocoding timeout defaults and maximum are explicit and bounded", () => {
  assert.equal(defaultRestaurantGeocodingTimeoutMilliseconds, 5000);
  assert.equal(maximumRestaurantGeocodingTimeoutMilliseconds, 15000);
});

test("an oversized configured timeout is actually capped", async () => {
  const originalSetTimeout = global.setTimeout;
  const scheduledDelays = [];
  global.setTimeout = (callback, delay, ...args) => {
    scheduledDelays.push(delay);
    return originalSetTimeout(callback, delay, ...args);
  };
  try {
    await geocodeWithPayload(successPayload(), {
      timeoutMilliseconds: 60_000,
    });
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.deepEqual(scheduledDelays, [
    maximumRestaurantGeocodingTimeoutMilliseconds,
  ]);
});

test("shared geocoding module import has no Firebase, secret, network, logging, or entry-point effects", () => {
  const geocodingModulePath = path.resolve(
    __dirname,
    "../lib/restaurant_geocoding.js",
  );
  const functionsEntryPointPath = path.resolve(__dirname, "../lib/index.js");
  const childScript = `
    const Module = require("node:module");
    const http = require("node:http");
    const https = require("node:https");
    const geocodingModulePath = process.argv[1];
    const functionsEntryPointPath = process.argv[2];
    const fail = (message) => () => { throw new Error(message); };
    global.fetch = fail("shared module performed global fetch");
    http.get = fail("shared module used http.get");
    http.request = fail("shared module used http.request");
    https.get = fail("shared module used https.get");
    https.request = fail("shared module used https.request");
    for (const method of ["log", "info", "warn", "error", "debug", "trace"]) {
      console[method] = fail("shared module logged through console." + method);
    }
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolved === functionsEntryPointPath) {
        throw new Error("shared module imported the Functions entry point");
      }
      const loaded = originalLoad.apply(this, arguments);
      if (request === "firebase-admin/app") {
        return new Proxy(loaded, {
          get(target, property, receiver) {
            if (property === "initializeApp" || property === "applicationDefault") {
              return fail("shared module initialized Firebase or accessed credentials");
            }
            return Reflect.get(target, property, receiver);
          },
        });
      }
      if (request === "firebase-admin/firestore") {
        return new Proxy(loaded, {
          get(target, property, receiver) {
            if (property === "getFirestore" || property === "initializeFirestore") {
              return fail("shared module created Firestore");
            }
            return Reflect.get(target, property, receiver);
          },
        });
      }
      if (request === "firebase-functions/params") {
        return new Proxy(loaded, {
          get(target, property, receiver) {
            if (property === "defineSecret") {
              return fail("shared module resolved a secret");
            }
            return Reflect.get(target, property, receiver);
          },
        });
      }
      return loaded;
    };
    const adminApp = require("firebase-admin/app");
    require(geocodingModulePath);
    if (adminApp.getApps().length !== 0) {
      throw new Error("shared module created a Firebase app");
    }
    if (require.cache[functionsEntryPointPath]) {
      throw new Error("shared module cached the Functions entry point");
    }
    process.stdout.write("restaurant-geocoding-module-loaded");
  `;
  const environment = { ...process.env };
  for (const variable of [
    "FIREBASE_CONFIG",
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "GCLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_MAPS_API_KEY",
  ]) {
    delete environment[variable];
  }

  const result = spawnSync(
    process.execPath,
    ["-e", childScript, geocodingModulePath, functionsEntryPointPath],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      env: environment,
      timeout: 5000,
    },
  );

  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "restaurant-geocoding-module-loaded");
});
