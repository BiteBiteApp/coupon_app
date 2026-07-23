const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  adminRestaurantPerBoundCandidateLimit,
  adminRestaurantSources,
  buildAdminRestaurantQueryPlans,
  defaultAdminRestaurantResultLimit,
  executeAdminRestaurantSearch,
  geocodeAdminLocationQuery,
  maximumAdminRestaurantRadiusMiles,
  maximumAdminRestaurantResultLimit,
  normalizeAdminLocationQuery,
  processAdminRestaurantSearchCandidates,
  resolveAdminRestaurantSearchCenter,
  validateAdminRestaurantSearchRequest,
} = require("../lib/admin_restaurant_search_helpers.js");
const {
  exactRestaurantDistanceKilometers,
  KILOMETERS_PER_MILE,
} = require("../lib/restaurant_geo_helpers.js");
const {
  requireAdminInviteAccess,
} = require("../lib/admin_authorization.js");

const center = {
  latitude: 28.8517,
  longitude: -82.487,
  displayName: "Crystal River, FL",
};

function coordinateRequest(overrides = {}) {
  return {
    latitude: center.latitude,
    longitude: center.longitude,
    radiusMiles: 50,
    ...overrides,
  };
}

function expectHttpsError(code, messagePattern) {
  return (error) => {
    assert.equal(error?.code, code);
    if (messagePattern) {
      assert.match(error.message, messagePattern);
    }
    return true;
  };
}

function geocodingResponse(payload, ok = true) {
  return {
    ok,
    json: async () => payload,
  };
}

function geocodingResult({
  latitude = center.latitude,
  longitude = center.longitude,
  formattedAddress = "Crystal River, FL 34428, USA",
  countryCode = "US",
} = {}) {
  return {
    formatted_address: formattedAddress,
    address_components: [
      {
        short_name: countryCode,
        long_name: countryCode === "US" ? "United States" : "Canada",
        types: ["country", "political"],
      },
    ],
    geometry: {
      location: { lat: latitude, lng: longitude },
    },
  };
}

function biteScoreDocument(documentId, overrides = {}) {
  return {
    source: "biteScore",
    documentId,
    data: {
      id: `stored-${documentId}`,
      name: `BiteScore ${documentId}`,
      address: "1 Catalog Way",
      city: "Crystal River",
      state: "FL",
      zip: "34428",
      phone: "555-0100",
      website: "https://bitescore.example",
      latitude: center.latitude,
      longitude: center.longitude,
      isActive: true,
      isClaimed: false,
      ...overrides,
    },
  };
}

function biteSaverDocument(documentId, overrides = {}) {
  return {
    source: "biteSaver",
    documentId,
    data: {
      uid: `uid-${documentId}`,
      restaurantName: `BiteSaver ${documentId}`,
      streetAddress: "2 Coupon Way",
      city: "Crystal River",
      state: "FL",
      zipCode: "34428",
      phone: "555-0200",
      website: "https://bitesaver.example",
      latitude: center.latitude,
      longitude: center.longitude,
      approvalStatus: "approved",
      couponApplicationSubmitted: true,
      ...overrides,
    },
  };
}

function processingRequest(overrides = {}) {
  return validateAdminRestaurantSearchRequest(coordinateRequest(overrides));
}

test("request validation accepts and normalizes a five-digit ZIP", () => {
  const request = validateAdminRestaurantSearchRequest({
    locationQuery: " 34461 ",
    radiusMiles: 10,
  });

  assert.deepEqual(request.center, {
    mode: "typed",
    locationQuery: "34461",
  });
  assert.deepEqual(request.sources, adminRestaurantSources);
  assert.equal(request.biteScoreStatus, "active");
  assert.equal(request.resultLimit, defaultAdminRestaurantResultLimit);
});

test("request validation accepts normalized City, ST", () => {
  assert.equal(
    normalizeAdminLocationQuery("  crystal   river , fl  "),
    "Crystal River, FL",
  );
  const request = validateAdminRestaurantSearchRequest({
    locationQuery: "st. augustine, FL",
    radiusMiles: 3,
  });
  assert.deepEqual(request.center, {
    mode: "typed",
    locationQuery: "St. Augustine, FL",
  });
});

test("request validation rejects bare cities, malformed ZIPs, and empty text", () => {
  for (const locationQuery of ["Crystal River", "3446", "34461-1234", ""]) {
    assert.throws(
      () =>
        validateAdminRestaurantSearchRequest({
          locationQuery,
          radiusMiles: 10,
        }),
      expectHttpsError("invalid-argument", /Location/),
    );
  }
});

test("request validation rejects unknown states and arbitrary long locations", () => {
  for (const locationQuery of ["Somewhere, ZZ", `${"A".repeat(101)}, FL`]) {
    assert.throws(
      () =>
        validateAdminRestaurantSearchRequest({
          locationQuery,
          radiusMiles: 10,
        }),
      expectHttpsError("invalid-argument", /Location/),
    );
  }
});

test("request validation accepts explicit coordinates", () => {
  const request = validateAdminRestaurantSearchRequest(
    coordinateRequest({ radiusMiles: 1.5 }),
  );
  assert.deepEqual(request.center, {
    mode: "coordinates",
    coordinates: {
      latitude: center.latitude,
      longitude: center.longitude,
    },
  });
  assert.equal(request.radiusMiles, 1.5);
});

test("request validation rejects both or neither search center mode", () => {
  assert.throws(
    () =>
      validateAdminRestaurantSearchRequest({
        locationQuery: "34461",
        latitude: center.latitude,
        longitude: center.longitude,
        radiusMiles: 10,
      }),
    expectHttpsError("invalid-argument", /exactly one/),
  );
  assert.throws(
    () => validateAdminRestaurantSearchRequest({ radiusMiles: 10 }),
    expectHttpsError("invalid-argument", /exactly one/),
  );
});

test("request validation rejects partial and invalid coordinates", () => {
  for (const request of [
    { latitude: center.latitude, radiusMiles: 10 },
    { longitude: center.longitude, radiusMiles: 10 },
    coordinateRequest({ latitude: "28.8" }),
    coordinateRequest({ latitude: 91 }),
    coordinateRequest({ latitude: 0, longitude: 0 }),
  ]) {
    assert.throws(
      () => validateAdminRestaurantSearchRequest(request),
      expectHttpsError("invalid-argument"),
    );
  }
});

test("request validation enforces the centralized 50-mile radius cap", () => {
  assert.equal(maximumAdminRestaurantRadiusMiles, 50);
  assert.equal(
    validateAdminRestaurantSearchRequest(coordinateRequest()).radiusMiles,
    50,
  );

  for (const radiusMiles of [
    undefined,
    "10",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1,
    50.0001,
  ]) {
    const request = coordinateRequest();
    request.radiusMiles = radiusMiles;
    assert.throws(
      () => validateAdminRestaurantSearchRequest(request),
      expectHttpsError("invalid-argument", /Radius/),
    );
  }
});

test("request validation normalizes source duplicates and rejects bad lists", () => {
  assert.deepEqual(
    validateAdminRestaurantSearchRequest(
      coordinateRequest({
        sources: ["biteSaver", "biteScore", "biteSaver"],
      }),
    ).sources,
    ["biteScore", "biteSaver"],
  );
  assert.deepEqual(
    validateAdminRestaurantSearchRequest(
      coordinateRequest({ sources: ["biteSaver"] }),
    ).sources,
    ["biteSaver"],
  );

  for (const sources of [[], ["unknown"], "biteScore", null]) {
    assert.throws(
      () =>
        validateAdminRestaurantSearchRequest(
          coordinateRequest({ sources }),
        ),
      expectHttpsError("invalid-argument", /Sources/),
    );
  }
});

test("BiteScore status validation is backward compatible and source scoped", () => {
  assert.equal(processingRequest().biteScoreStatus, "active");
  for (const biteScoreStatus of ["active", "inactive", "all"]) {
    assert.equal(
      processingRequest({
        sources: ["biteScore"],
        biteScoreStatus,
      }).biteScoreStatus,
      biteScoreStatus,
    );
  }

  for (const biteScoreStatus of ["hidden", "enabled", "", null, 1]) {
    assert.throws(
      () => processingRequest({ biteScoreStatus }),
      expectHttpsError("invalid-argument", /BiteScore status/),
    );
  }
  assert.throws(
    () =>
      processingRequest({
        sources: ["biteSaver"],
        biteScoreStatus: "all",
      }),
    expectHttpsError("invalid-argument", /only when BiteScore/),
  );
});

test("request validation enforces result-limit defaults and bounds", () => {
  assert.equal(defaultAdminRestaurantResultLimit, 50);
  assert.equal(maximumAdminRestaurantResultLimit, 100);
  assert.equal(processingRequest().resultLimit, 50);
  assert.equal(processingRequest({ resultLimit: 1 }).resultLimit, 1);
  assert.equal(processingRequest({ resultLimit: 100 }).resultLimit, 100);

  for (const resultLimit of [0, 101, 1.5, Number.NaN, "50"]) {
    assert.throws(
      () => processingRequest({ resultLimit }),
      expectHttpsError("invalid-argument", /Result limit/),
    );
  }
});

test("restaurant-name validation trims, normalizes, and caps safe text", () => {
  const request = processingRequest({ restaurantName: "  Blue   CAFÉ  " });
  assert.equal(request.restaurantName, "Blue CAFÉ");
  assert.equal(request.normalizedRestaurantName, "blue café");
  assert.equal(
    processingRequest({ restaurantName: " ".repeat(10) }).restaurantName,
    null,
  );
  assert.equal(
    processingRequest({ restaurantName: "A".repeat(100) }).restaurantName
      .length,
    100,
  );
  assert.throws(
    () => processingRequest({ restaurantName: "A".repeat(101) }),
    expectHttpsError("invalid-argument", /100 characters/),
  );
});

test("mocked ZIP geocoding uses the official endpoint and US restriction", async () => {
  let requestedUrl;
  const result = await geocodeAdminLocationQuery(
    "34461",
    "test-key",
    async (url, init) => {
      requestedUrl = new URL(url);
      assert.equal(init.method, "GET");
      assert.equal(init.signal.aborted, false);
      return geocodingResponse({
        status: "OK",
        results: [geocodingResult()],
      });
    },
  );

  assert.equal(requestedUrl.origin, "https://maps.googleapis.com");
  assert.equal(requestedUrl.pathname, "/maps/api/geocode/json");
  assert.equal(requestedUrl.searchParams.get("address"), "34461");
  assert.equal(requestedUrl.searchParams.get("components"), "country:US");
  assert.equal(requestedUrl.searchParams.get("region"), "us");
  assert.equal(result.displayName, "Crystal River, FL 34428, USA");
  assert.equal(result.latitude, center.latitude);
});

test("mocked City, ST geocoding accepts the first valid US result", async () => {
  const result = await geocodeAdminLocationQuery(
    "Crystal River, FL",
    "test-key",
    async () =>
      geocodingResponse({
        status: "OK",
        results: [
          geocodingResult({ countryCode: "CA" }),
          geocodingResult({ formattedAddress: "Crystal River, FL, USA" }),
        ],
      }),
  );
  assert.equal(result.displayName, "Crystal River, FL, USA");
});

test("admin search-center display names retain legacy Unicode compatibility characters", async () => {
  const result = await geocodeAdminLocationQuery(
    "Crystal River, FL",
    "test-key",
    async () =>
      geocodingResponse({
        status: "OK",
        results: [
          geocodingResult({ formattedAddress: "  １２３   Main Plaza  " }),
        ],
      }),
  );

  assert.equal(result.displayName, "１２３ Main Plaza");
});

test("admin search-center geocoding remains permissive for broad partial approximate results", async () => {
  const broadSearchCenter = geocodingResult({
    formattedAddress: "34428, USA",
  });
  broadSearchCenter.partial_match = true;
  broadSearchCenter.types = ["postal_code"];
  broadSearchCenter.geometry.location_type = "APPROXIMATE";

  const result = await geocodeAdminLocationQuery(
    "34428",
    "test-key",
    async () =>
      geocodingResponse({ status: "OK", results: [broadSearchCenter] }),
  );

  assert.equal(result.displayName, "34428, USA");
  assert.equal(result.latitude, center.latitude);
  assert.equal(result.longitude, center.longitude);
});

test("admin search-center geocoding still selects the first valid US result", async () => {
  const result = await geocodeAdminLocationQuery(
    "Crystal River, FL",
    "test-key",
    async () =>
      geocodingResponse({
        status: "OK",
        results: [
          geocodingResult({ formattedAddress: "First valid center" }),
          geocodingResult({
            formattedAddress: "Second valid center",
            latitude: center.latitude + 0.1,
          }),
        ],
      }),
  );

  assert.equal(result.displayName, "First valid center");
  assert.equal(result.latitude, center.latitude);
});

test("admin search-center geocoding skips malformed and invalid candidates before a valid one", async () => {
  const result = await geocodeAdminLocationQuery(
    "Crystal River, FL",
    "test-key",
    async () =>
      geocodingResponse({
        status: "OK",
        results: [
          null,
          geocodingResult({ latitude: 0, longitude: 0 }),
          geocodingResult({ formattedAddress: "Later valid center" }),
        ],
      }),
  );

  assert.equal(result.displayName, "Later valid center");
});

test("explicit coordinates bypass API-key access and geocoding", async () => {
  let keyCalls = 0;
  let fetchCalls = 0;
  const result = await resolveAdminRestaurantSearchCenter(
    {
      mode: "coordinates",
      coordinates: {
        latitude: center.latitude,
        longitude: center.longitude,
      },
    },
    {
      getGeocodingApiKey: () => {
        keyCalls += 1;
        throw new Error("should not be called");
      },
      fetchGeocoding: async () => {
        fetchCalls += 1;
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(keyCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(result.displayName, "28.851700, -82.487000");
});

test("geocoding returns a controlled no-results error", async () => {
  await assert.rejects(
    geocodeAdminLocationQuery("34461", "test-key", async () =>
      geocodingResponse({ status: "ZERO_RESULTS", results: [] }),
    ),
    expectHttpsError("not-found", /No matching/),
  );
});

test("typed geocoding fails safely when its deployed secret is unavailable", async () => {
  await assert.rejects(
    geocodeAdminLocationQuery("34461", "", async () => {
      throw new Error("must not fetch without a key");
    }),
    expectHttpsError("failed-precondition", /not configured/),
  );
});

test("geocoding rejects non-US results", async () => {
  await assert.rejects(
    geocodeAdminLocationQuery("London, FL", "test-key", async () =>
      geocodingResponse({
        status: "OK",
        results: [geocodingResult({ countryCode: "CA" })],
      }),
    ),
    expectHttpsError("not-found", /United States/),
  );
});

test("geocoding controls provider rejection without returning raw details", async () => {
  const rawProviderText = "RAW_PROVIDER_RESPONSE_SHOULD_NOT_ESCAPE";
  let thrown;
  try {
    await geocodeAdminLocationQuery("34461", "test-key", async () =>
      geocodingResponse({
        status: "REQUEST_DENIED",
        error_message: rawProviderText,
      }),
    );
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.code, "unavailable");
  assert.doesNotMatch(JSON.stringify(thrown), new RegExp(rawProviderText));
});

test("geocoding rejects malformed response shapes", async () => {
  for (const payload of [null, {}, { status: "OK" }, { status: "OK", results: [null] }]) {
    await assert.rejects(
      geocodeAdminLocationQuery("34461", "test-key", async () =>
        geocodingResponse(payload),
      ),
      expectHttpsError("internal", /invalid response/),
    );
  }
});

test("geocoding rejects invalid returned coordinates", async () => {
  for (const coordinates of [
    { latitude: 91, longitude: -82 },
    { latitude: 0, longitude: 0 },
  ]) {
    await assert.rejects(
      geocodeAdminLocationQuery("34461", "test-key", async () =>
        geocodingResponse({
          status: "OK",
          results: [geocodingResult(coordinates)],
        }),
      ),
      expectHttpsError("internal", /invalid response/),
    );
  }
});

test("geocoding has a controlled timeout", async () => {
  await assert.rejects(
    geocodeAdminLocationQuery(
      "34461",
      "test-key",
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
      5,
    ),
    expectHttpsError("deadline-exceeded", /timed out/),
  );
});

test("geocoding timeout also covers a stalled response body", async () => {
  await assert.rejects(
    geocodeAdminLocationQuery(
      "34461",
      "test-key",
      async () => ({
        ok: true,
        json: async () => new Promise(() => {}),
      }),
      5,
    ),
    expectHttpsError("deadline-exceeded", /timed out/),
  );
});

test("geocoding handles HTTP rejection without parsing provider content", async () => {
  let jsonCalls = 0;
  await assert.rejects(
    geocodeAdminLocationQuery("34461", "test-key", async () => ({
      ok: false,
      json: async () => {
        jsonCalls += 1;
        return { raw: "not returned" };
      },
    })),
    expectHttpsError("unavailable"),
  );
  assert.equal(jsonCalls, 0);
});

test("geocoding errors never expose the API key", async () => {
  const apiKey = "secret-api-key-must-not-escape";
  let thrown;
  try {
    await geocodeAdminLocationQuery("34461", apiKey, async () => {
      throw new Error(`provider failed for ${apiKey}`);
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.code, "unavailable");
  assert.doesNotMatch(JSON.stringify(thrown), new RegExp(apiKey));
});

test("geocoding does not return an API key echoed in a display address", async () => {
  const apiKey = "secret-api-key-must-not-escape";
  const result = await geocodeAdminLocationQuery(
    "34461",
    apiKey,
    async () =>
      geocodingResponse({
        status: "OK",
        results: [geocodingResult({ formattedAddress: `Echo ${apiKey}` })],
      }),
  );
  assert.equal(result.displayName, "34461");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
});

test("query plans use geohash bounds and a hard per-bound cap", () => {
  const plans = buildAdminRestaurantQueryPlans(center, 10, [
    "biteScore",
    "biteSaver",
  ]);
  assert.ok(plans.length >= 2);
  assert.equal(plans.length % 2, 0);
  assert.equal(adminRestaurantPerBoundCandidateLimit, 15);
  for (const plan of plans) {
    assert.ok(plan.geohashStart);
    assert.ok(plan.geohashEnd);
    assert.ok(plan.geohashStart <= plan.geohashEnd);
    assert.equal(plan.candidateLimit, 15);
  }
});

test("BiteScore plans require active records and the composite range query", () => {
  const plans = buildAdminRestaurantQueryPlans(center, 10, ["biteScore"]);
  assert.ok(plans.length > 0);
  for (const plan of plans) {
    assert.equal(plan.collectionName, "bitescore_restaurants");
    assert.equal(plan.biteScoreIsActive, true);
    assert.equal(plan.source, "biteScore");
  }
});

test("BiteScore inactive and all plans retain bounded geohash queries", () => {
  const inactivePlans = buildAdminRestaurantQueryPlans(
    center,
    10,
    ["biteScore"],
    "inactive",
  );
  const allPlans = buildAdminRestaurantQueryPlans(
    center,
    10,
    ["biteScore"],
    "all",
  );
  assert.ok(inactivePlans.length > 0);
  assert.equal(inactivePlans.length, allPlans.length);
  assert.ok(inactivePlans.every((plan) => plan.biteScoreIsActive === false));
  assert.ok(allPlans.every((plan) => plan.biteScoreIsActive === null));
  assert.ok(
    [...inactivePlans, ...allPlans].every(
      (plan) =>
        plan.collectionName === "bitescore_restaurants" &&
        plan.candidateLimit === 15 &&
        plan.geohashStart &&
        plan.geohashEnd,
    ),
  );
});

test("BiteSaver plans are bounded without an account-status filter", () => {
  const plans = buildAdminRestaurantQueryPlans(center, 10, ["biteSaver"]);
  assert.ok(plans.length > 0);
  for (const plan of plans) {
    assert.equal(plan.collectionName, "restaurant_accounts");
    assert.equal(plan.biteScoreIsActive, null);
    assert.ok(plan.geohashStart);
    assert.ok(plan.geohashEnd);
    assert.equal(plan.candidateLimit, 15);
  }
});

test("source selection executes only selected bounded query plans", async () => {
  const seenPlans = [];
  let geocodingCalls = 0;
  const response = await executeAdminRestaurantSearch(
    coordinateRequest({
      sources: ["biteSaver"],
      candidateLimit: 10_000,
      perBoundLimit: 10_000,
    }),
    {
      getGeocodingApiKey: () => {
        throw new Error("coordinate searches do not need a key");
      },
      fetchGeocoding: async () => {
        geocodingCalls += 1;
        throw new Error("coordinate searches do not geocode");
      },
      executeQueryPlan: async (plan) => {
        seenPlans.push(plan);
        return [];
      },
    },
  );

  assert.equal(geocodingCalls, 0);
  assert.ok(seenPlans.length > 0);
  assert.ok(seenPlans.every((plan) => plan.source === "biteSaver"));
  assert.ok(seenPlans.every((plan) => plan.candidateLimit === 15));
  assert.deepEqual(response.queriedSources, ["biteSaver"]);
});

test("overlapping bounds deduplicate while equal IDs across sources stay separate", () => {
  const score = biteScoreDocument("shared-id", {
    name: "Catalog Cafe",
    linkedBiteSaverUid: "coupon-uid",
  });
  const saver = biteSaverDocument("shared-id", {
    uid: "coupon-uid",
    restaurantName: "Coupon Cafe",
    linkedBiteScoreRestaurantId: "shared-id",
  });
  const response = processAdminRestaurantSearchCandidates({
    request: processingRequest(),
    searchCenter: center,
    candidates: [score, score, saver, saver],
    anyQueryReachedCandidateLimit: false,
  });

  assert.equal(response.returnedCount, 2);
  assert.deepEqual(
    response.results.map((result) => `${result.source}:${result.documentId}`),
    ["biteScore:shared-id", "biteSaver:shared-id"],
  );
});

test("actual Firestore document IDs and canonical action IDs are preserved", () => {
  const response = processAdminRestaurantSearchCandidates({
    request: processingRequest(),
    searchCenter: center,
    candidates: [
      biteScoreDocument("actual-score-doc", {
        id: "stored-score-id-must-not-route",
        ownerUserId: "owner-1",
        linkedBiteSaverUid: "account-1",
      }),
      biteSaverDocument("actual-saver-doc", {
        uid: "canonical-account-uid",
        linkedBiteScoreRestaurantId: "actual-score-doc",
      }),
    ],
    anyQueryReachedCandidateLimit: false,
  });
  const biteScore = response.results.find(
    (result) => result.source === "biteScore",
  );
  const biteSaver = response.results.find(
    (result) => result.source === "biteSaver",
  );

  assert.equal(biteScore.documentId, "actual-score-doc");
  assert.equal(biteScore.actionId, "actual-score-doc");
  assert.notEqual(biteScore.actionId, "stored-score-id-must-not-route");
  assert.equal(biteScore.ownerUserId, "owner-1");
  assert.equal(biteScore.linkedBiteSaverUid, "account-1");
  assert.equal(biteSaver.documentId, "actual-saver-doc");
  assert.equal(biteSaver.actionId, "canonical-account-uid");
  assert.equal(biteSaver.uid, "canonical-account-uid");
  assert.equal(
    biteSaver.linkedBiteScoreRestaurantId,
    "actual-score-doc",
  );
});

test("result mapping exposes only controlled compatibility and status fields", () => {
  const response = processAdminRestaurantSearchCandidates({
    request: processingRequest(),
    searchCenter: center,
    candidates: [
      biteScoreDocument("score", {
        name: undefined,
        restaurantName: "Legacy Score Name",
        streetAddress: "3 Legacy Ave",
        zipCode: "34429",
        phone: undefined,
        phoneNumber: "555-0300",
        website: undefined,
        websiteUrl: "https://legacy-score.example",
        isClaimed: true,
        email: "private@example.com",
        privateNote: "not returned",
      }),
      biteSaverDocument("saver", {
        approvalStatus: "pending",
        couponApplicationSubmitted: false,
        email: "owner@example.com",
        stripeCustomerId: "secret-billing-id",
      }),
    ],
    anyQueryReachedCandidateLimit: false,
  });

  const score = response.results.find((result) => result.source === "biteScore");
  const saver = response.results.find((result) => result.source === "biteSaver");
  assert.equal(score.restaurantName, "Legacy Score Name");
  assert.equal(score.streetAddress, "3 Legacy Ave");
  assert.equal(score.zipCode, "34429");
  assert.equal(score.phone, "555-0300");
  assert.equal(score.website, "https://legacy-score.example");
  assert.equal(score.isActive, true);
  assert.equal(score.isClaimed, true);
  assert.equal(Object.hasOwn(score, "email"), false);
  assert.equal(Object.hasOwn(score, "privateNote"), false);
  assert.equal(saver.approvalStatus, "pending");
  assert.equal(saver.couponApplicationSubmitted, false);
  assert.equal(Object.hasOwn(saver, "email"), false);
  assert.equal(Object.hasOwn(saver, "stripeCustomerId"), false);
});

test("inactive and all modes retain actual stored BiteScore status", () => {
  const active = biteScoreDocument("active", { isActive: true });
  const inactive = biteScoreDocument("inactive", { isActive: false });

  const inactiveResponse = processAdminRestaurantSearchCandidates({
    request: processingRequest({
      sources: ["biteScore"],
      biteScoreStatus: "inactive",
    }),
    searchCenter: center,
    candidates: [active, inactive],
    anyQueryReachedCandidateLimit: false,
  });
  assert.deepEqual(
    inactiveResponse.results.map((result) => [
      result.documentId,
      result.isActive,
    ]),
    [["inactive", false]],
  );

  const allResponse = processAdminRestaurantSearchCandidates({
    request: processingRequest({
      sources: ["biteScore"],
      biteScoreStatus: "all",
    }),
    searchCenter: center,
    candidates: [active, inactive],
    anyQueryReachedCandidateLimit: false,
  });
  assert.deepEqual(
    allResponse.results.map((result) => [result.documentId, result.isActive]),
    [
      ["active", true],
      ["inactive", false],
    ],
  );
});

test("invalid, missing, zero, inactive, and outside-radius records are excluded", () => {
  const response = processAdminRestaurantSearchCandidates({
    request: processingRequest({ radiusMiles: 10 }),
    searchCenter: center,
    candidates: [
      biteScoreDocument("missing", { latitude: undefined }),
      biteScoreDocument("zero", { latitude: 0, longitude: 0 }),
      biteScoreDocument("inactive", { isActive: false }),
      biteSaverDocument("malformed", { latitude: "28.8" }),
      biteSaverDocument("outside", { latitude: center.latitude + 1 }),
      biteSaverDocument("inside"),
    ],
    anyQueryReachedCandidateLimit: false,
  });

  assert.deepEqual(
    response.results.map((result) => result.documentId),
    ["inside"],
  );
});

test("exact distance is returned in miles after geographic deduplication", () => {
  const candidate = biteScoreDocument("distance", {
    longitude: center.longitude + 0.01,
  });
  const response = processAdminRestaurantSearchCandidates({
    request: processingRequest(),
    searchCenter: center,
    candidates: [candidate, candidate],
    anyQueryReachedCandidateLimit: false,
  });
  const expectedMiles =
    exactRestaurantDistanceKilometers(center, {
      latitude: center.latitude,
      longitude: center.longitude + 0.01,
    }) / KILOMETERS_PER_MILE;

  assert.equal(response.returnedCount, 1);
  assert.ok(response.results[0].distanceMiles > 0);
  assert.equal(response.results[0].distanceMiles, expectedMiles);
});

test("name filtering is post-bound, case-insensitive, and non-regex", () => {
  const matchingResponse = processAdminRestaurantSearchCandidates({
    request: processingRequest({ restaurantName: "  BLUE   cafe " }),
    searchCenter: center,
    candidates: [
      biteScoreDocument("blue", { name: "The Blue Cafe" }),
      biteScoreDocument("red", { name: "The Red Cafe" }),
    ],
    anyQueryReachedCandidateLimit: false,
  });
  assert.deepEqual(
    matchingResponse.results.map((result) => result.documentId),
    ["blue"],
  );

  const regexTextResponse = processAdminRestaurantSearchCandidates({
    request: processingRequest({ restaurantName: "[.*" }),
    searchCenter: center,
    candidates: [biteScoreDocument("literal", { name: "Cafe [.* Special" })],
    anyQueryReachedCandidateLimit: false,
  });
  assert.equal(regexTextResponse.returnedCount, 1);

  const plans = buildAdminRestaurantQueryPlans(center, 10, ["biteScore"]);
  assert.doesNotMatch(JSON.stringify(plans), /restaurantName|Blue Cafe/);
});

test("results sort by exact distance, normalized name, then document ID", () => {
  const response = processAdminRestaurantSearchCandidates({
    request: processingRequest(),
    searchCenter: center,
    candidates: [
      biteScoreDocument("z-id", { name: "Alpha" }),
      biteScoreDocument("a-id", { name: "alpha" }),
      biteScoreDocument("middle", {
        name: "Aardvark",
        longitude: center.longitude + 0.01,
      }),
      biteScoreDocument("beta", { name: "Beta" }),
    ],
    anyQueryReachedCandidateLimit: false,
  });

  assert.deepEqual(
    response.results.map((result) => result.documentId),
    ["a-id", "z-id", "beta", "middle"],
  );
});

test("the server result hard limit sets truncation", () => {
  const response = processAdminRestaurantSearchCandidates({
    request: processingRequest({ resultLimit: 2 }),
    searchCenter: center,
    candidates: [
      biteScoreDocument("one"),
      biteScoreDocument("two"),
      biteScoreDocument("three"),
    ],
    anyQueryReachedCandidateLimit: false,
  });

  assert.equal(response.returnedCount, 2);
  assert.equal(response.results.length, 2);
  assert.equal(response.resultsMayBeTruncated, true);
});

test("per-bound saturation sets truncation even after deduplication", async () => {
  let suppliedSaturatedBatch = false;
  const response = await executeAdminRestaurantSearch(coordinateRequest(), {
    getGeocodingApiKey: () => "unused",
    fetchGeocoding: async () => {
      throw new Error("unused");
    },
    executeQueryPlan: async (plan) => {
      if (suppliedSaturatedBatch) {
        return [];
      }
      suppliedSaturatedBatch = true;
      return Array.from(
        { length: plan.candidateLimit },
        (_value, index) => ({
          documentId: `doc-${index}`,
          data: biteScoreDocument(`doc-${index}`).data,
        }),
      );
    },
  });

  assert.equal(response.returnedCount, 15);
  assert.equal(response.resultsMayBeTruncated, true);
});

test("an empty result is controlled and safe", async () => {
  const response = await executeAdminRestaurantSearch(
    coordinateRequest({ sources: ["biteScore"] }),
    {
      getGeocodingApiKey: () => "unused",
      fetchGeocoding: async () => {
        throw new Error("unused");
      },
      executeQueryPlan: async () => [],
    },
  );

  assert.deepEqual(response.results, []);
  assert.equal(response.returnedCount, 0);
  assert.equal(response.resultsMayBeTruncated, false);
  assert.deepEqual(response.queriedSources, ["biteScore"]);
});

test("signed-out, anonymous, and non-admin callers are rejected", () => {
  for (const request of [
    {},
    {
      auth: {
        uid: "anonymous-user",
        token: {
          email: "schuyler.cole@gmail.com",
          firebase: { sign_in_provider: "anonymous" },
        },
      },
    },
    {
      auth: {
        uid: "ordinary-user",
        token: { email: "ordinary@example.com" },
      },
    },
  ]) {
    assert.throws(
      () => requireAdminInviteAccess(request),
      expectHttpsError("permission-denied", /Admin access/),
    );
  }
});

test("the existing admin authorization accepts the configured administrator", () => {
  assert.deepEqual(
    requireAdminInviteAccess({
      auth: {
        uid: "admin-user",
        token: { email: "SCHUYLER.COLE@GMAIL.COM" },
      },
    }),
    {
      uid: "admin-user",
      email: "schuyler.cole@gmail.com",
    },
  );
});

test("admin authorization fails closed for malformed authentication data", () => {
  for (const request of [
    { auth: "malformed" },
    {
      auth: {
        uid: 123,
        token: { email: "schuyler.cole@gmail.com" },
      },
    },
    {
      auth: {
        uid: "admin-user",
        token: {
          email: "schuyler.cole@gmail.com",
          firebase: "malformed",
        },
      },
    },
    {
      auth: {
        uid: "admin-user",
        token: {
          email: "schuyler.cole@gmail.com",
          firebase: { sign_in_provider: 123 },
        },
      },
    },
  ]) {
    assert.throws(
      () => requireAdminInviteAccess(request),
      expectHttpsError("permission-denied", /Admin access/),
    );
  }
});

test("Functions entry point uses only the extracted authorization gate", () => {
  const indexSource = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );

  assert.match(
    indexSource,
    /import \{ requireAdminInviteAccess \} from "\.\/admin_authorization\.js";/,
  );
  assert.doesNotMatch(
    indexSource,
    /function\s+requireAdminInviteAccess\s*\(/,
  );
  assert.equal(
    indexSource.match(/\brequireAdminInviteAccess\s*\(/g)?.length,
    5,
  );
});

test("admin authorization module loads without Firebase Admin or Firestore", () => {
  const authorizationModulePath = path.resolve(
    __dirname,
    "../lib/admin_authorization.js",
  );
  const functionsEntryPointPath = path.resolve(__dirname, "../lib/index.js");
  const childScript = `
    const Module = require("node:module");
    const authorizationModulePath = process.argv[1];
    const functionsEntryPointPath = process.argv[2];
    const adminApp = require("firebase-admin/app");
    adminApp.initializeApp = () => {
      throw new Error("authorization module initialized Firebase Admin");
    };
    adminApp.applicationDefault = () => {
      throw new Error("authorization module accessed Firebase credentials");
    };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (
        request === "firebase-admin/firestore" ||
        request.startsWith("firebase-admin/firestore/")
      ) {
        throw new Error("authorization module loaded Firestore");
      }
      if (
        (request === "firebase-admin" || request === "firebase-admin/app") &&
        parent?.filename === authorizationModulePath
      ) {
        throw new Error("authorization module directly imported Firebase Admin");
      }
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolved === functionsEntryPointPath) {
        throw new Error("authorization module imported the Functions entry point");
      }
      return originalLoad.apply(this, arguments);
    };
    require(authorizationModulePath);
    if (adminApp.getApps().length !== 0) {
      throw new Error("authorization module created a Firebase app");
    }
    process.stdout.write("authorization-module-loaded");
  `;
  const environment = { ...process.env };
  for (const variable of [
    "FIREBASE_CONFIG",
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "GCLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
  ]) {
    delete environment[variable];
  }

  const result = spawnSync(
    process.execPath,
    ["-e", childScript, authorizationModulePath, functionsEntryPointPath],
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
  assert.equal(result.stdout, "authorization-module-loaded");
});

test("search execution exposes only a query seam and performs no writes", async () => {
  const operations = [];
  const response = await executeAdminRestaurantSearch(
    coordinateRequest({ sources: ["biteSaver"] }),
    {
      getGeocodingApiKey: () => "unused",
      fetchGeocoding: async () => {
        throw new Error("unused");
      },
      executeQueryPlan: async (plan) => {
        operations.push({
          operation: "query",
          collection: plan.collectionName,
          limit: plan.candidateLimit,
        });
        return [];
      },
    },
  );

  assert.ok(operations.length > 0);
  assert.ok(operations.every((operation) => operation.operation === "query"));
  assert.ok(operations.every((operation) => operation.limit === 15));
  assert.equal(JSON.stringify(response).includes("secret"), false);
});

test("Functions query executor applies only the requested status filter", () => {
  const indexSource = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  assert.match(
    indexSource,
    /plan\.biteScoreIsActive !== null[\s\S]*collection\.where\("isActive", "==", plan\.biteScoreIsActive\)[\s\S]*\.orderBy\("geohash"\)[\s\S]*\.limit\(plan\.candidateLimit\)/,
  );
  assert.doesNotMatch(
    indexSource,
    /executeAdminRestaurantQueryPlan[\s\S]{0,1200}\.get\(\)[\s\S]{0,1200}\.set\(/,
  );
});
