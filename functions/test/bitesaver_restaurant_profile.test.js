const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  biteSaverLocationSource,
  canApproveBiteSaverApplication,
  createBiteSaverLocationValidationFingerprint,
  createBiteSaverProfileRequestFingerprint,
  hasCompleteTrustedBiteSaverLocation,
  reviewBiteSaverApplicationHandler,
  saveBiteSaverRestaurantProfileHandler,
  validateBiteSaverProfileRequest,
  validateBiteSaverReviewRequest,
} = require("../lib/bitesaver_restaurant_profile.js");
const {
  createRestaurantAddressFingerprint,
  RestaurantGeocodingError,
} = require("../lib/restaurant_geocoding.js");

const ownerId = "owner-1";
const otherOwnerId = "owner-2";
const accountId = "restaurant-account-1";
const defaultCoordinates = {
  latitude: 28.8517,
  longitude: -82.487,
};
const businessDays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function ownerAuth(uid = ownerId, tokenOverrides = {}) {
  return {
    uid,
    token: {
      email: `${uid}@example.com`,
      email_verified: true,
      firebase: { sign_in_provider: "password" },
      ...tokenOverrides,
    },
  };
}

function claimAdminAuth() {
  return ownerAuth("claim-admin", {
    admin: true,
    email: "claim-admin@example.com",
  });
}

function emailAdminAuth() {
  return ownerAuth("email-admin", {
    email: "schuyler.cole@gmail.com",
  });
}

function anonymousAuth() {
  return ownerAuth("anonymous-owner", {
    email: undefined,
    email_verified: undefined,
    firebase: { sign_in_provider: "anonymous" },
  });
}

function callableRequest(auth, data) {
  return { auth, data };
}

function profile(overrides = {}) {
  return {
    restaurantName: "BiteStar Cafe",
    streetAddress: "123 Main St",
    city: "Crystal River",
    state: "FL",
    zipCode: "34428",
    phone: "(352) 555-0100",
    website: "https://example.com",
    ...overrides,
  };
}

function fullBusinessHours(overrides = {}) {
  return businessDays.map((day) => ({
    day,
    opensAt: "9:00 AM",
    closesAt: "5:00 PM",
    closed: day === "Sunday",
    ...(overrides[day] ?? {}),
  }));
}

function saveRequestData(intent, overrides = {}) {
  const data = {
    intent,
    requestId: `request-${intent}`,
    profile: profile(),
  };
  if (intent === "ownerUpdate") {
    data.expectedProfileVersion = 1;
  } else if (intent === "adminUpdate") {
    data.documentId = accountId;
    data.expectedProfileVersion = 1;
  }
  return { ...data, ...overrides };
}

function requestFingerprint(auth, data, targetDocumentId = null) {
  const parsed = validateBiteSaverProfileRequest(data);
  const actorUid = auth.uid.trim();
  const documentId = targetDocumentId ??
    (parsed.intent === "adminUpdate" ? parsed.documentId : actorUid);
  return createBiteSaverProfileRequestFingerprint({
    actorUid,
    documentId,
    request: parsed,
  });
}

function reviewRequestData(overrides = {}) {
  return {
    documentId: accountId,
    decision: "approve",
    expectedProfileVersion: 1,
    ...overrides,
  };
}

function addressFromProfile(value) {
  return {
    streetAddress: value.streetAddress,
    city: value.city,
    state: value.state,
    zipCode: value.zipCode,
  };
}

function geocodingResult(address, overrides = {}) {
  return {
    ...address,
    formattedAddress:
      `${address.streetAddress}, ${address.city}, ` +
      `${address.state} ${address.zipCode}, USA`,
    ...defaultCoordinates,
    addressFingerprint: createRestaurantAddressFingerprint(address),
    ...overrides,
  };
}

function trustedAccount(overrides = {}) {
  const data = {
    uid: ownerId,
    email: "owner-1@example.com",
    emailVerified: true,
    restaurantName: "BiteStar Cafe",
    streetAddress: "123 Main St",
    city: "Crystal River",
    state: "FL",
    zipCode: "34428",
    phone: "(352) 555-0100",
    website: "https://example.com",
    bio: "Neighborhood restaurant",
    mainImageUrl: "https://example.com/main.jpg",
    businessHours: fullBusinessHours(),
    couponApplicationSubmitted: true,
    approvalStatus: "pending",
    profileVersion: 1,
    formattedAddress:
      "123 Main St, Crystal River, FL 34428, USA",
    ...defaultCoordinates,
    locationValidatedAt: { seconds: 1_750_000_000, nanoseconds: 0 },
    locationSource: biteSaverLocationSource,
    locationVersion: 1,
    subscriptionStatus: "trialing",
    stripeCustomerId: "cus_preserve",
    inviteId: "invite-preserve",
    geohash: "djjn7zzzzz",
    unrelated: { preserve: true },
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "addressFingerprint")) {
    data.addressFingerprint = createRestaurantAddressFingerprint({
      streetAddress: data.streetAddress,
      city: data.city,
      state: data.state,
      zipCode: data.zipCode,
    });
  }
  if (!Object.hasOwn(overrides, "locationValidationFingerprint")) {
    data.locationValidationFingerprint =
      createBiteSaverLocationValidationFingerprint({
        addressFingerprint: data.addressFingerprint,
        latitude: data.latitude,
        longitude: data.longitude,
        locationSource: data.locationSource,
      });
  }
  return data;
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

function profileHarness(
  store,
  {
    geocodeError = null,
    geocodeOverrides = {},
    onGeocode = null,
  } = {},
) {
  const geocodeCalls = [];
  let timestampCounter = 0;
  return {
    geocodeCalls,
    dependencies: {
      getAccount: (documentId) => store.getAccount(documentId),
      runAccountTransaction: (documentId, evaluate) =>
        store.runAccountTransaction(documentId, evaluate),
      geocodeAddress: async (address) => {
        geocodeCalls.push(structuredClone(address));
        await onGeocode?.(address);
        if (geocodeError) {
          throw geocodeError;
        }
        return geocodingResult(address, geocodeOverrides);
      },
      serverTimestamp: () => ({
        __serverTimestamp: ++timestampCounter,
      }),
    },
  };
}

function reviewDependencies(store) {
  let timestampCounter = 0;
  return {
    runAccountTransaction: (documentId, evaluate) =>
      store.runAccountTransaction(documentId, evaluate),
    serverTimestamp: () => ({
      __serverTimestamp: ++timestampCounter,
    }),
  };
}

function arrivalBarrier(expectedArrivals) {
  let arrivals = 0;
  let release;
  const allArrived = new Promise((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === expectedArrivals) {
      release();
    }
    await allArrived;
  };
}

class AtomicAccountStore {
  constructor() {
    this.documents = new Map();
    this.getCount = 0;
    this.transactionCount = 0;
    this.decisions = [];
    this.beforeTransaction = null;
  }

  seed(documentId, data) {
    this.documents.set(documentId, structuredClone(data));
  }

  directPatch(documentId, patch) {
    const current = this.documents.get(documentId);
    if (!current) {
      throw new Error(`Cannot patch missing account ${documentId}`);
    }
    this.documents.set(documentId, {
      ...current,
      ...structuredClone(patch),
    });
  }

  get(documentId) {
    const data = this.documents.get(documentId);
    return data === undefined ? undefined : structuredClone(data);
  }

  snapshot(documentId) {
    const data = this.documents.get(documentId);
    return {
      exists: data !== undefined,
      data: data === undefined ? {} : structuredClone(data),
    };
  }

  async getAccount(documentId) {
    this.getCount += 1;
    return this.snapshot(documentId);
  }

  async runAccountTransaction(documentId, evaluate) {
    this.transactionCount += 1;
    if (this.beforeTransaction) {
      const hook = this.beforeTransaction;
      this.beforeTransaction = null;
      await hook(this, documentId);
    }

    const latest = this.snapshot(documentId);
    const decision = evaluate(latest);
    this.decisions.push(structuredClone(decision));
    if (decision.operation === "none") {
      return decision.response;
    }
    if (decision.operation === "create") {
      if (latest.exists) {
        throw new Error(`Account already exists: ${documentId}`);
      }
      this.documents.set(documentId, structuredClone(decision.data));
      return decision.response;
    }
    if (!latest.exists) {
      throw new Error(`Account does not exist: ${documentId}`);
    }
    this.documents.set(documentId, {
      ...latest.data,
      ...structuredClone(decision.data),
    });
    return decision.response;
  }

  get writeDecisions() {
    return this.decisions.filter((decision) => decision.operation !== "none");
  }
}

test("profile request validation normalizes the exact supported contract", () => {
  const hours = fullBusinessHours({
    Monday: { opensAt: "  8:00   AM  " },
  });
  const parsed = validateBiteSaverProfileRequest(
    saveRequestData("submitApplication", {
      requestId: " request:123 ",
      profile: profile({
        restaurantName: "  BiteStar   Café  ",
        streetAddress: "  123   Main St ",
        city: " Crystal   River ",
        state: " fl ",
        zipCode: " 34428 ",
        phone: " (352)   555-0100 ",
        website: " https://example.com/about ",
        bio: "  Local   food \r\n Family\towned  ",
        mainImageUrl: " https://example.com/main.jpg ",
        businessHours: hours,
      }),
    }),
  );

  assert.equal(parsed.intent, "submitApplication");
  assert.equal(parsed.requestId, "request:123");
  assert.equal(parsed.documentId, null);
  assert.equal(parsed.expectedProfileVersion, null);
  assert.deepEqual(parsed.profile, {
    restaurantName: "BiteStar Café",
    streetAddress: "123 Main St",
    city: "Crystal River",
    state: "FL",
    zipCode: "34428",
    phone: "(352) 555-0100",
    website: "https://example.com/about",
    bio: "Local food\nFamily owned",
    mainImageUrl: "https://example.com/main.jpg",
    businessHours: hours.map((entry) => ({
      ...entry,
      opensAt: entry.day === "Monday" ? "8:00 AM" : entry.opensAt,
    })),
  });
});

test("profile request validation rejects unknown and trusted-field injection", () => {
  const forbiddenKeys = [
    "uid",
    "email",
    "approvalStatus",
    "couponApplicationSubmitted",
    "latitude",
    "longitude",
    "location",
    "geoPoint",
    "geohash",
    "formattedAddress",
    "addressFingerprint",
    "locationValidationFingerprint",
    "locationVersion",
    "profileVersion",
    "lastProfileRequestId",
    "lastProfileRequestFingerprint",
    "subscriptionStatus",
  ];

  for (const key of forbiddenKeys) {
    assert.throws(
      () =>
        validateBiteSaverProfileRequest(
          saveRequestData("submitApplication", {
            profile: profile({ [key]: "client-value" }),
          }),
        ),
      expectHttpsError("invalid-argument", /unsupported fields/),
      `profile key ${key}`,
    );
    assert.throws(
      () =>
        validateBiteSaverProfileRequest({
          ...saveRequestData("submitApplication"),
          [key]: "client-value",
        }),
      expectHttpsError("invalid-argument", /unsupported fields/),
      `top-level key ${key}`,
    );
  }
});

test("profile request validation rejects missing fields, invalid types, limits, and controls", () => {
  for (const field of [
    "restaurantName",
    "streetAddress",
    "city",
    "state",
    "zipCode",
    "phone",
  ]) {
    const invalidProfile = profile();
    delete invalidProfile[field];
    assert.throws(
      () =>
        validateBiteSaverProfileRequest(
          saveRequestData("submitApplication", { profile: invalidProfile }),
        ),
      expectHttpsError("invalid-argument"),
      `missing ${field}`,
    );
  }

  const invalidProfiles = [
    profile({ restaurantName: 123 }),
    profile({ restaurantName: "R".repeat(121) }),
    profile({ restaurantName: "Bad\u0000Name" }),
    profile({ phone: "1".repeat(51) }),
    profile({ phone: "Bad\u202ePhone" }),
    profile({ website: 123 }),
    profile({ website: "w".repeat(501) }),
    profile({ bio: "b".repeat(2001) }),
    profile({ bio: "Bad\u0000Bio" }),
    profile({ bio: "Bad\u202eBio" }),
    profile({ mainImageUrl: "i".repeat(2001) }),
    profile({ state: "Florida" }),
    profile({ state: "XX" }),
    profile({ zipCode: "34428-1234" }),
  ];
  for (const invalidProfile of invalidProfiles) {
    assert.throws(
      () =>
        validateBiteSaverProfileRequest(
          saveRequestData("submitApplication", { profile: invalidProfile }),
        ),
      expectHttpsError("invalid-argument"),
    );
  }

  for (const invalidRequestId of [
    "",
    "contains space",
    "bad/segment",
    "bad\u0000id",
    "x".repeat(129),
  ]) {
    assert.throws(
      () =>
        validateBiteSaverProfileRequest(
          saveRequestData("submitApplication", {
            requestId: invalidRequestId,
          }),
        ),
      expectHttpsError("invalid-argument"),
    );
  }
});

test("intent-specific request keys and versions are strict", () => {
  for (const invalid of [
    null,
    [],
    {},
    saveRequestData("unknownIntent"),
    saveRequestData("submitApplication", { documentId: ownerId }),
    saveRequestData("submitApplication", { expectedProfileVersion: 0 }),
    (() => {
      const data = saveRequestData("ownerUpdate");
      delete data.expectedProfileVersion;
      return data;
    })(),
    saveRequestData("ownerUpdate", { documentId: ownerId }),
    (() => {
      const data = saveRequestData("adminUpdate");
      delete data.documentId;
      return data;
    })(),
    saveRequestData("adminUpdate", { documentId: "nested/id" }),
    saveRequestData("adminUpdate", { documentId: "x".repeat(257) }),
    saveRequestData("ownerUpdate", { expectedProfileVersion: -1 }),
    saveRequestData("ownerUpdate", { expectedProfileVersion: 1.5 }),
    saveRequestData("ownerUpdate", { expectedProfileVersion: "1" }),
  ]) {
    assert.throws(
      () => validateBiteSaverProfileRequest(invalid),
      expectHttpsError("invalid-argument"),
    );
  }

  const owner = validateBiteSaverProfileRequest(
    saveRequestData("ownerUpdate", { expectedProfileVersion: 0 }),
  );
  assert.equal(owner.documentId, null);
  assert.equal(owner.expectedProfileVersion, 0);

  const admin = validateBiteSaverProfileRequest(
    saveRequestData("adminUpdate", {
      documentId: " restaurant-2 ",
      expectedProfileVersion: 3,
    }),
  );
  assert.equal(admin.documentId, "restaurant-2");
  assert.equal(admin.expectedProfileVersion, 3);
});

test("business-hours validation accepts empty or a complete exact week", () => {
  const empty = validateBiteSaverProfileRequest(
    saveRequestData("submitApplication", {
      profile: profile({ businessHours: [] }),
    }),
  );
  assert.deepEqual(empty.profile.businessHours, []);

  const week = validateBiteSaverProfileRequest(
    saveRequestData("submitApplication", {
      profile: profile({ businessHours: fullBusinessHours() }),
    }),
  );
  assert.equal(week.profile.businessHours.length, 7);

  const invalidHours = [
    "not-a-list",
    [fullBusinessHours()[0]],
    fullBusinessHours().map((entry, index) =>
      index === 1 ? { ...entry, day: "Sunday" } : entry
    ),
    fullBusinessHours().map((entry, index) =>
      index === 1 ? { ...entry, day: "Funday" } : entry
    ),
    fullBusinessHours().map((entry, index) =>
      index === 1 ? { ...entry, closed: "false" } : entry
    ),
    fullBusinessHours().map((entry, index) =>
      index === 1 ? { ...entry, opensAt: "x".repeat(41) } : entry
    ),
    fullBusinessHours().map((entry, index) =>
      index === 1 ? { ...entry, injected: true } : entry
    ),
    fullBusinessHours().map((entry, index) => {
      if (index !== 1) return entry;
      const copy = { ...entry };
      delete copy.closesAt;
      return copy;
    }),
  ];
  for (const businessHours of invalidHours) {
    assert.throws(
      () =>
        validateBiteSaverProfileRequest(
          saveRequestData("submitApplication", {
            profile: profile({ businessHours }),
          }),
        ),
      expectHttpsError("invalid-argument"),
    );
  }
});

test("profile request fingerprint has a fixed versioned SHA-256 fixture", () => {
  const auth = ownerAuth();
  const data = saveRequestData("ownerUpdate", {
    requestId: "fixture-request-id",
    expectedProfileVersion: 7,
    profile: profile({
      bio: "Local food\nFamily owned",
      mainImageUrl: "https://example.com/main.jpg",
      businessHours: fullBusinessHours({
        Monday: { opensAt: "8:00 AM" },
      }),
    }),
  });

  const fingerprint = requestFingerprint(auth, data);
  assert.equal(
    fingerprint,
    "c4c88e8a99608e8d67f81d6f17a26e29e83a3e4656acc9eaddd58e448af89ff3",
  );
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(requestFingerprint(auth, structuredClone(data)), fingerprint);
});

test("profile request fingerprint follows normalization and fixed key order", () => {
  const auth = ownerAuth();
  const normalizedData = saveRequestData("submitApplication", {
    requestId: "normalized-request-a",
    profile: profile({
      restaurantName: "BiteStar Café",
      bio: "Local food\nFamily owned",
      businessHours: fullBusinessHours(),
    }),
  });
  const reorderedHours = fullBusinessHours().map((entry) => ({
    closed: entry.closed,
    closesAt: entry.closesAt,
    opensAt: entry.opensAt,
    day: entry.day,
  }));
  const differentlyOrderedProfile = {
    businessHours: reorderedHours,
    bio: "  Local   food \r\n Family\towned ",
    website: " https://example.com ",
    phone: " (352)   555-0100 ",
    zipCode: " 34428 ",
    state: " fl ",
    city: " Crystal   River ",
    streetAddress: " 123   Main St ",
    restaurantName: " BiteStar   Cafe\u0301 ",
  };
  const equivalentData = {
    profile: differentlyOrderedProfile,
    requestId: "normalized-request-b",
    intent: "submitApplication",
  };

  assert.equal(
    requestFingerprint(auth, equivalentData),
    requestFingerprint(auth, normalizedData),
  );
});

test("profile request fingerprint covers every logical request dimension", () => {
  const auth = claimAdminAuth();
  const baseData = saveRequestData("adminUpdate", {
    documentId: accountId,
    requestId: "coverage-base",
    expectedProfileVersion: 3,
    profile: profile({
      bio: "Neighborhood restaurant",
      mainImageUrl: "https://example.com/main.jpg",
      businessHours: fullBusinessHours(),
    }),
  });
  const base = requestFingerprint(auth, baseData);
  const changedRequests = [
    saveRequestData("adminUpdate", {
      ...baseData,
      expectedProfileVersion: 4,
    }),
    { ...baseData, profile: { ...baseData.profile, restaurantName: "Other Cafe" } },
    { ...baseData, profile: { ...baseData.profile, streetAddress: "124 Main St" } },
    { ...baseData, profile: { ...baseData.profile, city: "Inverness" } },
    { ...baseData, profile: { ...baseData.profile, state: "GA" } },
    { ...baseData, profile: { ...baseData.profile, zipCode: "34429" } },
    { ...baseData, profile: { ...baseData.profile, phone: "(352) 555-0101" } },
    { ...baseData, profile: { ...baseData.profile, website: "https://other.example" } },
    { ...baseData, profile: { ...baseData.profile, bio: "Different bio" } },
    {
      ...baseData,
      profile: {
        ...baseData.profile,
        mainImageUrl: "https://example.com/other.jpg",
      },
    },
    {
      ...baseData,
      profile: {
        ...baseData.profile,
        businessHours: fullBusinessHours({
          Monday: { opensAt: "8:00 AM" },
        }),
      },
    },
    { ...baseData, documentId: "restaurant-account-2" },
  ];

  for (const changed of changedRequests) {
    assert.notEqual(
      requestFingerprint(auth, changed),
      base,
      JSON.stringify(changed),
    );
  }
  assert.notEqual(requestFingerprint(emailAdminAuth(), baseData), base);
  assert.notEqual(
    requestFingerprint(
      auth,
      saveRequestData("submitApplication", {
        requestId: baseData.requestId,
        profile: baseData.profile,
      }),
    ),
    base,
  );
});

test("profile request fingerprint mirrors optional preserve and clear semantics", () => {
  const auth = ownerAuth();
  const dataFor = (profileValue) =>
    saveRequestData("ownerUpdate", {
      requestId: "optional-semantics",
      expectedProfileVersion: 2,
      profile: profileValue,
    });
  const websiteOmitted = profile();
  delete websiteOmitted.website;
  const websiteBlank = profile({ website: "  " });
  assert.equal(
    requestFingerprint(auth, dataFor(websiteOmitted)),
    requestFingerprint(auth, dataFor(websiteBlank)),
  );

  for (const [field, clearValue] of [
    ["bio", ""],
    ["mainImageUrl", ""],
    ["businessHours", []],
  ]) {
    const omitted = profile();
    delete omitted[field];
    const cleared = profile({ [field]: clearValue });
    assert.notEqual(
      requestFingerprint(auth, dataFor(omitted)),
      requestFingerprint(auth, dataFor(cleared)),
      field,
    );
  }

  const hours = fullBusinessHours();
  const reorderedKeys = hours.map((entry) => ({
    closesAt: entry.closesAt,
    day: entry.day,
    closed: entry.closed,
    opensAt: entry.opensAt,
  }));
  assert.equal(
    requestFingerprint(auth, dataFor(profile({ businessHours: hours }))),
    requestFingerprint(
      auth,
      dataFor(profile({ businessHours: reorderedKeys })),
    ),
  );
  assert.notEqual(
    requestFingerprint(auth, dataFor(profile({ businessHours: hours }))),
    requestFingerprint(
      auth,
      dataFor(profile({ businessHours: [...hours].reverse() })),
    ),
  );
});

test("profile request fingerprint resists field boundaries and rejects unsupported shapes", () => {
  const auth = ownerAuth();
  const left = saveRequestData("ownerUpdate", {
    requestId: "boundary-left",
    profile: profile({ restaurantName: "AB", phone: "C" }),
  });
  const right = saveRequestData("ownerUpdate", {
    requestId: "boundary-right",
    profile: profile({ restaurantName: "A", phone: "BC" }),
  });
  assert.notEqual(requestFingerprint(auth, left), requestFingerprint(auth, right));
  assert.equal(
    requestFingerprint(auth, left),
    requestFingerprint(auth, { ...left, requestId: "another-id" }),
  );

  const parsed = validateBiteSaverProfileRequest(left);
  const input = {
    actorUid: auth.uid,
    documentId: auth.uid,
    request: parsed,
  };
  for (const mutate of [
    (value) => {
      value.request.profile.restaurantName = " AB ";
    },
    (value) => {
      value.request.profile.injected = true;
    },
    (value) => {
      value.request.extra = true;
    },
    (value) => {
      value.request.profile.businessHours = [{ day: "Sunday" }];
    },
    (value) => {
      value.extra = true;
    },
  ]) {
    const unsupported = structuredClone(input);
    mutate(unsupported);
    assert.throws(
      () => createBiteSaverProfileRequestFingerprint(unsupported),
      /normalized BiteSaver profile request/,
    );
  }
});

test("review request validation rejects unknown keys, injections, and invalid values", () => {
  assert.deepEqual(validateBiteSaverReviewRequest(reviewRequestData()), {
    documentId: accountId,
    decision: "approve",
    expectedProfileVersion: 1,
  });
  assert.equal(
    validateBiteSaverReviewRequest(
      reviewRequestData({ documentId: " account-2 ", decision: "reject" }),
    ).documentId,
    "account-2",
  );

  const invalidRequests = [
    null,
    [],
    {},
    reviewRequestData({ unknown: true }),
    reviewRequestData({ latitude: 1 }),
    reviewRequestData({ geohash: "client" }),
    reviewRequestData({ documentId: "" }),
    reviewRequestData({ documentId: "nested/id" }),
    reviewRequestData({ documentId: "x".repeat(257) }),
    reviewRequestData({ decision: "pending" }),
    reviewRequestData({ decision: 1 }),
    reviewRequestData({ expectedProfileVersion: -1 }),
    reviewRequestData({ expectedProfileVersion: 1.5 }),
    reviewRequestData({ expectedProfileVersion: "1" }),
  ];
  for (const invalid of invalidRequests) {
    assert.throws(
      () => validateBiteSaverReviewRequest(invalid),
      expectHttpsError("invalid-argument"),
    );
  }
});

test("signed-out and anonymous profile callers fail before reads or effects", async () => {
  for (const auth of [undefined, anonymousAuth()]) {
    const store = new AtomicAccountStore();
    const harness = profileHarness(store);
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(auth, { malformed: true }),
        harness.dependencies,
      ),
      expectHttpsError("unauthenticated"),
    );
    assert.equal(store.getCount, 0);
    assert.equal(store.transactionCount, 0);
    assert.equal(harness.geocodeCalls.length, 0);
  }
});

test("invalid authenticated requests fail before account reads or geocoding", async () => {
  const store = new AtomicAccountStore();
  const harness = profileHarness(store);
  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(ownerAuth(), {
        ...saveRequestData("submitApplication"),
        latitude: 28,
      }),
      harness.dependencies,
    ),
    expectHttpsError("invalid-argument"),
  );
  assert.equal(store.getCount, 0);
  assert.equal(store.transactionCount, 0);
  assert.equal(harness.geocodeCalls.length, 0);
});

test("missing-account submission creates one complete pending trusted account", async () => {
  const store = new AtomicAccountStore();
  const harness = profileHarness(store);
  const data = saveRequestData("submitApplication", {
    requestId: "submit-create-1",
    profile: profile({
      bio: "Local food",
      mainImageUrl: "https://example.com/main.jpg",
      businessHours: fullBusinessHours(),
    }),
  });

  const response = await saveBiteSaverRestaurantProfileHandler(
    callableRequest(ownerAuth(), data),
    harness.dependencies,
  );
  const saved = store.get(ownerId);

  assert.deepEqual(response, {
    documentId: ownerId,
    approvalStatus: "pending",
    profileVersion: 1,
  });
  assert.equal(store.getCount, 1);
  assert.equal(store.transactionCount, 1);
  assert.equal(store.writeDecisions[0].operation, "create");
  assert.equal(harness.geocodeCalls.length, 1);
  assert.equal(saved.uid, ownerId);
  assert.equal(saved.email, "owner-1@example.com");
  assert.equal(saved.emailVerified, true);
  assert.equal(saved.couponApplicationSubmitted, true);
  assert.equal(saved.approvalStatus, "pending");
  assert.equal(saved.profileVersion, 1);
  assert.equal(saved.locationVersion, 1);
  assert.equal(saved.lastProfileRequestId, "submit-create-1");
  assert.equal(
    saved.lastProfileRequestFingerprint,
    requestFingerprint(ownerAuth(), data),
  );
  assert.match(saved.lastProfileRequestFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(
    Object.hasOwn(response, "lastProfileRequestFingerprint"),
    false,
  );
  assert.equal(saved.locationSource, biteSaverLocationSource);
  assert.equal(saved.addressFingerprint, createRestaurantAddressFingerprint(
    addressFromProfile(data.profile),
  ));
  assert.equal(
    saved.locationValidationFingerprint,
    createBiteSaverLocationValidationFingerprint({
      addressFingerprint: saved.addressFingerprint,
      latitude: saved.latitude,
      longitude: saved.longitude,
      locationSource: saved.locationSource,
    }),
  );
  assert.equal(hasCompleteTrustedBiteSaverLocation(saved), true);
  assert.equal(canApproveBiteSaverApplication(saved), true);
  assert.equal(Object.hasOwn(saved, "geohash"), false);
  assert.equal(Object.hasOwn(saved, "location"), false);
  assert.equal(Object.hasOwn(saved, "geoPoint"), false);
  assert.deepEqual(saved.businessHours, fullBusinessHours());
});

test("a retried successful submission is idempotent", async () => {
  const store = new AtomicAccountStore();
  const harness = profileHarness(store);
  const request = callableRequest(
    ownerAuth(),
    saveRequestData("submitApplication", {
      requestId: "submit-idempotent-1",
    }),
  );

  const firstResponse = await saveBiteSaverRestaurantProfileHandler(
    request,
    harness.dependencies,
  );
  const firstSaved = store.get(ownerId);
  const secondResponse = await saveBiteSaverRestaurantProfileHandler(
    request,
    harness.dependencies,
  );

  assert.deepEqual(secondResponse, firstResponse);
  assert.deepEqual(store.get(ownerId), firstSaved);
  assert.equal(firstSaved.profileVersion, 1);
  assert.equal(firstSaved.locationVersion, 1);
  assert.equal(harness.geocodeCalls.length, 1);
  assert.deepEqual(
    store.decisions.map((decision) => decision.operation),
    ["create", "none"],
  );
  assert.equal(store.writeDecisions.length, 1);
});

test("owner and admin exact retries preserve the first successful write", async () => {
  for (const intent of ["ownerUpdate", "adminUpdate"]) {
    const auth = intent === "ownerUpdate" ? ownerAuth() : claimAdminAuth();
    const documentId = intent === "ownerUpdate" ? ownerId : accountId;
    const store = new AtomicAccountStore();
    store.seed(documentId, trustedAccount({
      uid: intent === "ownerUpdate" ? ownerId : otherOwnerId,
      approvalStatus: "approved",
      profileVersion: 1,
    }));
    const harness = profileHarness(store);
    const data = saveRequestData(intent, {
      requestId: `exact-retry-${intent}`,
      expectedProfileVersion: 1,
      profile: profile({ phone: "(352) 555-0111" }),
    });
    const request = callableRequest(auth, data);

    const firstResponse = await saveBiteSaverRestaurantProfileHandler(
      request,
      harness.dependencies,
    );
    const afterFirst = store.get(documentId);
    const secondResponse = await saveBiteSaverRestaurantProfileHandler(
      request,
      harness.dependencies,
    );

    assert.deepEqual(secondResponse, firstResponse, intent);
    assert.deepEqual(store.get(documentId), afterFirst, intent);
    assert.equal(afterFirst.profileVersion, 2, intent);
    assert.equal(afterFirst.locationVersion, 1, intent);
    assert.equal(
      afterFirst.lastProfileRequestFingerprint,
      requestFingerprint(auth, data),
      intent,
    );
    assert.equal(harness.geocodeCalls.length, 0, intent);
    assert.deepEqual(
      store.decisions.map((decision) => decision.operation),
      ["update", "none"],
      intent,
    );
    assert.equal(store.writeDecisions.length, 1, intent);
  }
});

test("submission upgrades an authentication skeleton in place and preserves unrelated fields", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, {
    uid: ownerId,
    email: "old-owner@example.com",
    emailVerified: false,
    phoneNumber: "+13525550100",
    displayName: "Owner",
    createdAt: { seconds: 1 },
    subscriptionStatus: "trialing",
    stripeCustomerId: "cus_existing",
    inviteId: "invite-existing",
    unrelated: { preserve: true },
  });
  const harness = profileHarness(store);

  const response = await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      saveRequestData("submitApplication", {
        requestId: "submit-skeleton-1",
      }),
    ),
    harness.dependencies,
  );
  const saved = store.get(ownerId);

  assert.equal(response.profileVersion, 1);
  assert.equal(store.documents.size, 1);
  assert.equal(store.writeDecisions[0].operation, "update");
  assert.equal(saved.email, "owner-1@example.com");
  assert.equal(saved.createdAt.seconds, 1);
  assert.equal(saved.phoneNumber, "+13525550100");
  assert.equal(saved.displayName, "Owner");
  assert.equal(saved.subscriptionStatus, "trialing");
  assert.equal(saved.stripeCustomerId, "cus_existing");
  assert.equal(saved.inviteId, "invite-existing");
  assert.deepEqual(saved.unrelated, { preserve: true });
  assert.equal(saved.couponApplicationSubmitted, true);
  assert.equal(saved.approvalStatus, "pending");
  assert.equal(saved.lastProfileRequestId, "submit-skeleton-1");
  assert.match(saved.lastProfileRequestFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(hasCompleteTrustedBiteSaverLocation(saved), true);
});

test("submission rejects an authentication skeleton owned by another UID", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, {
    uid: otherOwnerId,
    email: "other-owner@example.com",
    emailVerified: true,
    createdAt: { seconds: 1 },
  });
  const before = store.get(ownerId);
  const harness = profileHarness(store);

  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(
        ownerAuth(),
        saveRequestData("submitApplication", {
          requestId: "submit-wrong-owner",
        }),
      ),
      harness.dependencies,
    ),
    expectHttpsError("permission-denied", /does not belong/),
  );

  assert.equal(harness.geocodeCalls.length, 0);
  assert.equal(store.transactionCount, 0);
  assert.equal(store.writeDecisions.length, 0);
  assert.deepEqual(store.get(ownerId), before);
});

test("different requests cannot resubmit legacy-complete, pending, approved, or rejected accounts", async () => {
  const cases = [
    {
      label: "legacy-complete",
      account: {
        uid: ownerId,
        ...profile({ website: undefined }),
      },
    },
    {
      label: "pending",
      account: {
        uid: ownerId,
        couponApplicationSubmitted: true,
        approvalStatus: "pending",
      },
    },
    {
      label: "approved",
      account: {
        uid: ownerId,
        couponApplicationSubmitted: true,
        approvalStatus: "approved",
      },
    },
    {
      label: "rejected",
      account: {
        uid: ownerId,
        couponApplicationSubmitted: true,
        approvalStatus: "rejected",
      },
    },
  ];

  for (const entry of cases) {
    const store = new AtomicAccountStore();
    store.seed(ownerId, entry.account);
    const harness = profileHarness(store);
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(
          ownerAuth(),
          saveRequestData("submitApplication", {
            requestId: `different-${entry.label}`,
          }),
        ),
        harness.dependencies,
      ),
      expectHttpsError("failed-precondition", /already been submitted/),
      entry.label,
    );
    assert.equal(harness.geocodeCalls.length, 0);
    assert.equal(store.transactionCount, 0);
    assert.equal(store.writeDecisions.length, 0);
  }
});

test("same request ID is rechecked transactionally and performs no write", async () => {
  const data = saveRequestData("ownerUpdate", {
    requestId: "successful-request",
    expectedProfileVersion: 4,
  });
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 4,
    lastProfileRequestId: "successful-request",
    lastProfileRequestFingerprint: requestFingerprint(ownerAuth(), data),
  }));
  const harness = profileHarness(store);
  const before = store.get(ownerId);

  const response = await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      data,
    ),
    harness.dependencies,
  );

  assert.deepEqual(response, {
    documentId: ownerId,
    approvalStatus: "approved",
    profileVersion: 4,
  });
  assert.equal(store.transactionCount, 1);
  assert.equal(harness.geocodeCalls.length, 0);
  assert.equal(store.decisions.length, 1);
  assert.equal(store.decisions[0].operation, "none");
  assert.equal(store.writeDecisions.length, 0);
  assert.deepEqual(store.get(ownerId), before);
});

test("the transaction snapshot, not the initial retry observation, is authoritative", async () => {
  const data = saveRequestData("ownerUpdate", {
    requestId: "successful-request",
    expectedProfileVersion: 4,
  });
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 4,
    lastProfileRequestId: "successful-request",
    lastProfileRequestFingerprint: requestFingerprint(ownerAuth(), data),
  }));
  store.beforeTransaction = async (database) => {
    database.directPatch(ownerId, {
      lastProfileRequestId: "different-request",
      phone: "(352) 555-0199",
    });
  };
  const harness = profileHarness(store);

  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      data,
      ),
      harness.dependencies,
    ),
    expectHttpsError("aborted", /changed/),
  );
  assert.equal(store.writeDecisions.length, 0);
  assert.equal(store.get(ownerId).phone, "(352) 555-0199");
});

test("same-ID profile collisions fail before geocoding across every field", async () => {
  const successfulData = saveRequestData("ownerUpdate", {
    requestId: "collision-matrix",
    expectedProfileVersion: 1,
    profile: profile({
      bio: "Neighborhood restaurant",
      mainImageUrl: "https://example.com/main.jpg",
      businessHours: fullBusinessHours(),
    }),
  });
  const winnerStore = new AtomicAccountStore();
  winnerStore.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 1,
  }));
  const winnerHarness = profileHarness(winnerStore);
  await saveBiteSaverRestaurantProfileHandler(
    callableRequest(ownerAuth(), successfulData),
    winnerHarness.dependencies,
  );
  const winner = winnerStore.get(ownerId);

  const websiteOmitted = { ...successfulData.profile };
  delete websiteOmitted.website;
  const bioOmitted = { ...successfulData.profile };
  delete bioOmitted.bio;
  const mainImageOmitted = { ...successfulData.profile };
  delete mainImageOmitted.mainImageUrl;
  const hoursOmitted = { ...successfulData.profile };
  delete hoursOmitted.businessHours;
  const variants = [
    {
      label: "intent",
      data: saveRequestData("submitApplication", {
        requestId: successfulData.requestId,
        profile: successfulData.profile,
      }),
    },
    {
      label: "expectedProfileVersion",
      data: { ...successfulData, expectedProfileVersion: 2 },
    },
    {
      label: "restaurantName",
      data: {
        ...successfulData,
        profile: { ...successfulData.profile, restaurantName: "Other Cafe" },
      },
    },
    {
      label: "streetAddress",
      data: {
        ...successfulData,
        profile: { ...successfulData.profile, streetAddress: "456 Oak Ave" },
      },
    },
    {
      label: "city",
      data: {
        ...successfulData,
        profile: { ...successfulData.profile, city: "Inverness" },
      },
    },
    {
      label: "state",
      data: {
        ...successfulData,
        profile: { ...successfulData.profile, state: "GA" },
      },
    },
    {
      label: "zipCode",
      data: {
        ...successfulData,
        profile: { ...successfulData.profile, zipCode: "34429" },
      },
    },
    {
      label: "phone",
      data: {
        ...successfulData,
        profile: { ...successfulData.profile, phone: "(352) 555-0199" },
      },
    },
    {
      label: "website",
      data: {
        ...successfulData,
        profile: {
          ...successfulData.profile,
          website: "https://other.example",
        },
      },
    },
    {
      label: "website omitted",
      data: { ...successfulData, profile: websiteOmitted },
    },
    {
      label: "website explicit clear",
      data: {
        ...successfulData,
        profile: { ...successfulData.profile, website: "" },
      },
    },
    {
      label: "bio",
      data: {
        ...successfulData,
        profile: { ...successfulData.profile, bio: "Changed bio" },
      },
    },
    {
      label: "bio omitted",
      data: { ...successfulData, profile: bioOmitted },
    },
    {
      label: "mainImageUrl",
      data: {
        ...successfulData,
        profile: {
          ...successfulData.profile,
          mainImageUrl: "https://example.com/other.jpg",
        },
      },
    },
    {
      label: "main image omitted",
      data: { ...successfulData, profile: mainImageOmitted },
    },
    {
      label: "businessHours",
      data: {
        ...successfulData,
        profile: {
          ...successfulData.profile,
          businessHours: fullBusinessHours({
            Monday: { opensAt: "8:00 AM" },
          }),
        },
      },
    },
    {
      label: "business hours omitted",
      data: { ...successfulData, profile: hoursOmitted },
    },
    {
      label: "multiple fields",
      data: {
        ...successfulData,
        expectedProfileVersion: 2,
        profile: {
          ...successfulData.profile,
          streetAddress: "789 Pine Rd",
          phone: "(352) 555-0188",
          website: "",
        },
      },
    },
  ];

  for (const { label, data } of variants) {
    const store = new AtomicAccountStore();
    store.seed(ownerId, winner);
    const before = store.get(ownerId);
    const harness = profileHarness(store);
    let collision;
    try {
      await saveBiteSaverRestaurantProfileHandler(
        callableRequest(ownerAuth(), data),
        harness.dependencies,
      );
    } catch (error) {
      collision = error;
    }

    assert.equal(collision?.code, "failed-precondition", label);
    assert.equal(
      collision?.message,
      "This request ID was already used for a different profile request.",
      label,
    );
    for (const sensitive of [
      winner.lastProfileRequestFingerprint,
      requestFingerprint(ownerAuth(), data),
      ownerId,
      data.profile.streetAddress,
      data.profile.phone,
      data.profile.website,
    ]) {
      if (sensitive) {
        assert.equal(collision.message.includes(sensitive), false, label);
      }
    }
    assert.equal(harness.geocodeCalls.length, 0, label);
    assert.equal(store.transactionCount, 0, label);
    assert.equal(store.writeDecisions.length, 0, label);
    assert.deepEqual(store.get(ownerId), before, label);
  }
});

test("same-ID scope collisions bind the authenticated actor and target document", async () => {
  const successfulData = saveRequestData("adminUpdate", {
    requestId: "scope-collision",
    expectedProfileVersion: 1,
    profile: profile({ phone: "(352) 555-0177" }),
  });
  const winnerStore = new AtomicAccountStore();
  winnerStore.seed(accountId, trustedAccount({
    uid: otherOwnerId,
    approvalStatus: "approved",
    profileVersion: 1,
  }));
  await saveBiteSaverRestaurantProfileHandler(
    callableRequest(claimAdminAuth(), successfulData),
    profileHarness(winnerStore).dependencies,
  );
  const winner = winnerStore.get(accountId);

  const cases = [
    {
      label: "actor",
      auth: emailAdminAuth(),
      documentId: accountId,
      data: successfulData,
    },
    {
      label: "target",
      auth: claimAdminAuth(),
      documentId: "restaurant-account-2",
      data: {
        ...successfulData,
        documentId: "restaurant-account-2",
      },
    },
  ];
  for (const entry of cases) {
    const store = new AtomicAccountStore();
    store.seed(entry.documentId, winner);
    const before = store.get(entry.documentId);
    const harness = profileHarness(store);
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(entry.auth, entry.data),
        harness.dependencies,
      ),
      expectHttpsError("failed-precondition", /different profile request/),
      entry.label,
    );
    assert.equal(harness.geocodeCalls.length, 0, entry.label);
    assert.equal(store.transactionCount, 0, entry.label);
    assert.deepEqual(store.get(entry.documentId), before, entry.label);
  }
});

test("website clear equivalence is idempotent while preserve-versus-clear collides", async () => {
  const firstProfile = profile();
  delete firstProfile.website;
  const data = saveRequestData("ownerUpdate", {
    requestId: "optional-write-semantics",
    expectedProfileVersion: 1,
    profile: firstProfile,
  });
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 1,
  }));
  const harness = profileHarness(store);
  await saveBiteSaverRestaurantProfileHandler(
    callableRequest(ownerAuth(), data),
    harness.dependencies,
  );
  const afterFirst = store.get(ownerId);

  const blankWebsiteData = {
    ...data,
    profile: { ...data.profile, website: "  " },
  };
  const exactResponse = await saveBiteSaverRestaurantProfileHandler(
    callableRequest(ownerAuth(), blankWebsiteData),
    harness.dependencies,
  );
  assert.equal(exactResponse.profileVersion, 2);
  assert.deepEqual(store.get(ownerId), afterFirst);
  assert.equal(store.decisions.at(-1).operation, "none");

  for (const profilePatch of [
    { bio: "" },
    { mainImageUrl: "" },
    { businessHours: [] },
  ]) {
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(ownerAuth(), {
          ...data,
          profile: { ...data.profile, ...profilePatch },
        }),
        harness.dependencies,
      ),
      expectHttpsError("failed-precondition", /different profile request/),
    );
  }
  assert.equal(harness.geocodeCalls.length, 0);
  assert.equal(store.writeDecisions.length, 1);
  assert.deepEqual(store.get(ownerId), afterFirst);
});

test("matching IDs with missing or malformed stored fingerprints fail closed", async () => {
  const data = saveRequestData("ownerUpdate", {
    requestId: "malformed-idempotency",
    expectedProfileVersion: 1,
  });
  const malformedValues = [
    undefined,
    null,
    42,
    "",
    "A".repeat(64),
    "g".repeat(64),
    "0".repeat(63),
    "0".repeat(64),
  ];

  for (const malformedFingerprint of malformedValues) {
    const account = trustedAccount({
      approvalStatus: "approved",
      profileVersion: 1,
      lastProfileRequestId: data.requestId,
    });
    if (malformedFingerprint !== undefined) {
      account.lastProfileRequestFingerprint = malformedFingerprint;
    }
    const store = new AtomicAccountStore();
    store.seed(ownerId, account);
    const before = store.get(ownerId);
    const harness = profileHarness(store);

    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(ownerAuth(), data),
        harness.dependencies,
      ),
      expectHttpsError("failed-precondition", /different profile request/),
    );
    assert.equal(harness.geocodeCalls.length, 0);
    assert.equal(store.transactionCount, 0);
    assert.equal(store.writeDecisions.length, 0);
    assert.deepEqual(store.get(ownerId), before);
  }
});

test("different IDs and legacy records are not falsely deduplicated", async () => {
  for (const metadata of [
    { lastProfileRequestId: "legacy-other-id" },
    {},
  ]) {
    const store = new AtomicAccountStore();
    store.seed(ownerId, trustedAccount({
      approvalStatus: "approved",
      profileVersion: 1,
      ...metadata,
    }));
    const harness = profileHarness(store);
    const data = saveRequestData("ownerUpdate", {
      requestId: "new-logical-request",
      expectedProfileVersion: 1,
      profile: profile({ phone: "(352) 555-0166" }),
    });

    const response = await saveBiteSaverRestaurantProfileHandler(
      callableRequest(ownerAuth(), data),
      harness.dependencies,
    );
    const saved = store.get(ownerId);
    assert.equal(response.profileVersion, 2);
    assert.equal(saved.lastProfileRequestId, data.requestId);
    assert.equal(
      saved.lastProfileRequestFingerprint,
      requestFingerprint(ownerAuth(), data),
    );
    assert.equal(store.writeDecisions.length, 1);
  }
});

test("racing same-ID same-request calls produce one write and one logical result", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 1,
  }));
  const harness = profileHarness(store, {
    onGeocode: arrivalBarrier(2),
  });
  const data = saveRequestData("ownerUpdate", {
    requestId: "same-request-race",
    expectedProfileVersion: 1,
    profile: profile({ streetAddress: "456 Oak Ave" }),
  });
  const request = callableRequest(ownerAuth(), data);

  const responses = await Promise.all([
    saveBiteSaverRestaurantProfileHandler(request, harness.dependencies),
    saveBiteSaverRestaurantProfileHandler(request, harness.dependencies),
  ]);
  const saved = store.get(ownerId);

  assert.deepEqual(responses[0], responses[1]);
  assert.equal(store.getCount, 2);
  assert.equal(harness.geocodeCalls.length, 2);
  assert.equal(store.transactionCount, 2);
  assert.deepEqual(
    store.decisions.map((decision) => decision.operation),
    ["update", "none"],
  );
  assert.equal(store.writeDecisions.length, 1);
  assert.equal(saved.profileVersion, 2);
  assert.equal(saved.locationVersion, 2);
  assert.equal(saved.streetAddress, "456 Oak Ave");
  assert.equal(
    saved.lastProfileRequestFingerprint,
    requestFingerprint(ownerAuth(), data),
  );
});

test("racing same-ID different requests reject the collision loser", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 1,
  }));
  const harness = profileHarness(store, {
    onGeocode: arrivalBarrier(2),
  });
  const dataA = saveRequestData("ownerUpdate", {
    requestId: "different-request-race",
    expectedProfileVersion: 1,
    profile: profile({ streetAddress: "456 Oak Ave" }),
  });
  const dataB = saveRequestData("ownerUpdate", {
    requestId: "different-request-race",
    expectedProfileVersion: 1,
    profile: profile({ streetAddress: "789 Pine Rd" }),
  });

  const results = await Promise.allSettled([
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(ownerAuth(), dataA),
      harness.dependencies,
    ),
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(ownerAuth(), dataB),
      harness.dependencies,
    ),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  const saved = store.get(ownerId);

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "failed-precondition");
  assert.equal(
    rejected[0].reason.message,
    "This request ID was already used for a different profile request.",
  );
  assert.equal(store.getCount, 2);
  assert.equal(harness.geocodeCalls.length, 2);
  assert.equal(store.transactionCount, 2);
  assert.equal(store.writeDecisions.length, 1);
  assert.equal(saved.profileVersion, 2);
  assert.equal(saved.locationVersion, 2);
  assert.ok(["456 Oak Ave", "789 Pine Rd"].includes(saved.streetAddress));
  const winningData = saved.streetAddress === "456 Oak Ave" ? dataA : dataB;
  assert.equal(
    saved.lastProfileRequestFingerprint,
    requestFingerprint(ownerAuth(), winningData),
  );
});

test("racing identical payloads with different IDs do not deduplicate by fingerprint", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 1,
  }));
  const harness = profileHarness(store, {
    onGeocode: arrivalBarrier(2),
  });
  const common = {
    expectedProfileVersion: 1,
    profile: profile({ streetAddress: "456 Oak Ave" }),
  };
  const dataA = saveRequestData("ownerUpdate", {
    ...common,
    requestId: "distinct-id-a",
  });
  const dataB = saveRequestData("ownerUpdate", {
    ...common,
    requestId: "distinct-id-b",
  });

  const results = await Promise.allSettled([
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(ownerAuth(), dataA),
      harness.dependencies,
    ),
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(ownerAuth(), dataB),
      harness.dependencies,
    ),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "aborted");
  assert.equal(store.writeDecisions.length, 1);
  assert.equal(store.get(ownerId).profileVersion, 2);
  assert.ok(
    ["distinct-id-a", "distinct-id-b"].includes(
      store.get(ownerId).lastProfileRequestId,
    ),
  );
});

test("owner update requires an existing account owned by the caller and an unchanged name", async () => {
  {
    const store = new AtomicAccountStore();
    const harness = profileHarness(store);
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(ownerAuth(), saveRequestData("ownerUpdate")),
        harness.dependencies,
      ),
      expectHttpsError("not-found"),
    );
    assert.equal(harness.geocodeCalls.length, 0);
    assert.equal(store.transactionCount, 0);
  }

  for (const account of [
    trustedAccount({ uid: otherOwnerId }),
    (() => {
      const data = trustedAccount();
      delete data.uid;
      return data;
    })(),
  ]) {
    const store = new AtomicAccountStore();
    store.seed(ownerId, account);
    const harness = profileHarness(store);
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(ownerAuth(), saveRequestData("ownerUpdate")),
        harness.dependencies,
      ),
      expectHttpsError("permission-denied"),
    );
    assert.equal(harness.geocodeCalls.length, 0);
    assert.equal(store.transactionCount, 0);
  }

  {
    const store = new AtomicAccountStore();
    store.seed(ownerId, trustedAccount());
    const harness = profileHarness(store);
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(
          ownerAuth(),
          saveRequestData("ownerUpdate", {
            profile: profile({ restaurantName: "Renamed Cafe" }),
          }),
        ),
        harness.dependencies,
      ),
      expectHttpsError("failed-precondition", /name-change/),
    );
    assert.equal(harness.geocodeCalls.length, 0);
    assert.equal(store.transactionCount, 0);
  }
});

test("owner cannot select another document or invoke admin update", async () => {
  const store = new AtomicAccountStore();
  const harness = profileHarness(store);
  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(
        ownerAuth(),
        saveRequestData("ownerUpdate", { documentId: otherOwnerId }),
      ),
      harness.dependencies,
    ),
    expectHttpsError("invalid-argument"),
  );
  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(ownerAuth(), saveRequestData("adminUpdate")),
      harness.dependencies,
    ),
    expectHttpsError("permission-denied"),
  );
  assert.equal(store.getCount, 0);
  assert.equal(store.transactionCount, 0);
});

test("admin update requires an existing account and cannot create one", async () => {
  const store = new AtomicAccountStore();
  const harness = profileHarness(store);

  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(
        claimAdminAuth(),
        saveRequestData("adminUpdate", {
          requestId: "admin-missing-account",
        }),
      ),
      harness.dependencies,
    ),
    expectHttpsError("not-found"),
  );

  assert.equal(store.documents.size, 0);
  assert.equal(harness.geocodeCalls.length, 0);
  assert.equal(store.transactionCount, 0);
  assert.equal(store.writeDecisions.length, 0);
});

test("claim and allowlisted-email admins can update, while non-admins cannot", async () => {
  for (const auth of [claimAdminAuth(), emailAdminAuth()]) {
    const store = new AtomicAccountStore();
    store.seed(accountId, trustedAccount({
      uid: otherOwnerId,
      profileVersion: 2,
      approvalStatus: "approved",
    }));
    const harness = profileHarness(store);
    const response = await saveBiteSaverRestaurantProfileHandler(
      callableRequest(
        auth,
        saveRequestData("adminUpdate", {
          expectedProfileVersion: 2,
          requestId: `admin-${auth.uid}`,
          profile: profile({ restaurantName: "Admin Renamed Cafe" }),
        }),
      ),
      harness.dependencies,
    );
    assert.equal(response.profileVersion, 3);
    assert.equal(store.get(accountId).restaurantName, "Admin Renamed Cafe");
    assert.equal(store.get(accountId).uid, otherOwnerId);
    assert.equal(store.get(accountId).email, "owner-1@example.com");
    assert.equal(harness.geocodeCalls.length, 0);
  }

  for (const auth of [ownerAuth("ordinary-user"), anonymousAuth(), undefined]) {
    const store = new AtomicAccountStore();
    store.seed(accountId, trustedAccount());
    const harness = profileHarness(store);
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(auth, saveRequestData("adminUpdate")),
        harness.dependencies,
      ),
      expectHttpsError(
        auth?.token?.firebase?.sign_in_provider === "password"
          ? "permission-denied"
          : "unauthenticated",
      ),
    );
    assert.equal(store.getCount, 0);
    assert.equal(store.transactionCount, 0);
  }
});

test("admin changed-address update geocodes and preserves nonprofile fields", async () => {
  const store = new AtomicAccountStore();
  const initial = trustedAccount({
    uid: otherOwnerId,
    approvalStatus: "approved",
    profileVersion: 3,
    locationVersion: 4,
    couponPostingEnabled: true,
    billingPlanName: "coupon_monthly",
    customFlag: "preserve-me",
  });
  store.seed(accountId, initial);
  const harness = profileHarness(store, {
    geocodeOverrides: {
      latitude: 29.2,
      longitude: -82.2,
      formattedAddress: "456 Oak Ave, Crystal River, FL 34428, USA",
    },
  });
  const updatedProfile = profile({
    restaurantName: "Admin Renamed Cafe",
    streetAddress: "456 Oak Ave",
    phone: "(352) 555-0999",
  });

  const response = await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      claimAdminAuth(),
      saveRequestData("adminUpdate", {
        expectedProfileVersion: 3,
        requestId: "admin-changed-address",
        profile: updatedProfile,
      }),
    ),
    harness.dependencies,
  );
  const saved = store.get(accountId);

  assert.deepEqual(response, {
    documentId: accountId,
    approvalStatus: "approved",
    profileVersion: 4,
  });
  assert.equal(store.writeDecisions[0].operation, "update");
  assert.deepEqual(harness.geocodeCalls, [addressFromProfile(updatedProfile)]);
  assert.equal(saved.restaurantName, "Admin Renamed Cafe");
  assert.equal(saved.streetAddress, "456 Oak Ave");
  assert.equal(saved.latitude, 29.2);
  assert.equal(saved.longitude, -82.2);
  assert.equal(saved.locationVersion, 5);
  for (const field of [
    "uid",
    "email",
    "couponApplicationSubmitted",
    "approvalStatus",
    "subscriptionStatus",
    "stripeCustomerId",
    "couponPostingEnabled",
    "billingPlanName",
    "inviteId",
    "geohash",
    "customFlag",
  ]) {
    assert.deepEqual(saved[field], initial[field], field);
  }
});

test("unchanged trusted address avoids geocoding and preserves location metadata", async () => {
  const store = new AtomicAccountStore();
  const initial = trustedAccount({
    approvalStatus: "approved",
    profileVersion: 7,
    locationVersion: 3,
  });
  store.seed(ownerId, initial);
  const harness = profileHarness(store);

  const response = await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      saveRequestData("ownerUpdate", {
        expectedProfileVersion: 7,
        requestId: "phone-only-update",
        profile: profile({
          phone: "(352) 555-0199",
          website: "https://example.com/new",
        }),
      }),
    ),
    harness.dependencies,
  );
  const saved = store.get(ownerId);

  assert.equal(response.profileVersion, 8);
  assert.equal(harness.geocodeCalls.length, 0);
  assert.equal(saved.phone, "(352) 555-0199");
  assert.equal(saved.website, "https://example.com/new");
  for (const field of [
    "formattedAddress",
    "latitude",
    "longitude",
    "addressFingerprint",
    "locationValidatedAt",
    "locationSource",
    "locationVersion",
    "locationValidationFingerprint",
    "geohash",
  ]) {
    assert.deepEqual(saved[field], initial[field], field);
  }
});

test("coordinate-binding tamper forces fresh geocoding and location-version increment", async () => {
  const store = new AtomicAccountStore();
  const initial = trustedAccount({
    approvalStatus: "approved",
    profileVersion: 2,
    locationVersion: 4,
  });
  initial.latitude += 0.5;
  store.seed(ownerId, initial);
  const harness = profileHarness(store);

  await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      saveRequestData("ownerUpdate", {
        expectedProfileVersion: 2,
        requestId: "repair-coordinate-tamper",
      }),
    ),
    harness.dependencies,
  );
  const saved = store.get(ownerId);

  assert.equal(harness.geocodeCalls.length, 1);
  assert.equal(saved.latitude, defaultCoordinates.latitude);
  assert.equal(saved.longitude, defaultCoordinates.longitude);
  assert.equal(saved.locationVersion, 5);
  assert.notDeepEqual(saved.locationValidatedAt, initial.locationValidatedAt);
  assert.equal(hasCompleteTrustedBiteSaverLocation(saved), true);
});

test("changed address geocodes outside the transaction and atomically replaces trusted location", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 3,
    locationVersion: 2,
  }));
  const harness = profileHarness(store, {
    geocodeOverrides: {
      latitude: 29.1,
      longitude: -82.1,
      formattedAddress: "456 Oak Ave, Crystal River, FL 34428, USA",
    },
  });
  const updatedProfile = profile({ streetAddress: "456 Oak Ave" });

  const response = await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      saveRequestData("ownerUpdate", {
        expectedProfileVersion: 3,
        requestId: "changed-address",
        profile: updatedProfile,
      }),
    ),
    harness.dependencies,
  );
  const saved = store.get(ownerId);

  assert.equal(response.profileVersion, 4);
  assert.equal(harness.geocodeCalls.length, 1);
  assert.deepEqual(harness.geocodeCalls[0], addressFromProfile(updatedProfile));
  assert.equal(saved.streetAddress, "456 Oak Ave");
  assert.equal(saved.latitude, 29.1);
  assert.equal(saved.longitude, -82.1);
  assert.equal(saved.locationVersion, 3);
  assert.equal(saved.addressFingerprint, createRestaurantAddressFingerprint(
    addressFromProfile(updatedProfile),
  ));
  assert.equal(hasCompleteTrustedBiteSaverLocation(saved), true);
});

test("geocoding failures and invalid geocoder results perform no transaction or write", async () => {
  for (const options of [
    { geocodeError: new RestaurantGeocodingError("timeout") },
    { geocodeError: new Error("raw provider secret") },
    {
      geocodeOverrides: {
        addressFingerprint: "wrong-fingerprint",
      },
    },
  ]) {
    const store = new AtomicAccountStore();
    store.seed(ownerId, trustedAccount({
      approvalStatus: "approved",
      profileVersion: 1,
    }));
    const before = store.get(ownerId);
    const harness = profileHarness(store, options);
    let thrown;
    try {
      await saveBiteSaverRestaurantProfileHandler(
        callableRequest(
          ownerAuth(),
          saveRequestData("ownerUpdate", {
            expectedProfileVersion: 1,
            requestId: "failed-geocode",
            profile: profile({ streetAddress: "456 Oak Ave" }),
          }),
        ),
        harness.dependencies,
      );
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown);
    assert.ok(
      ["deadline-exceeded", "unavailable", "internal"].includes(thrown.code),
    );
    assert.doesNotMatch(thrown.message, /raw provider secret/);
    assert.equal(store.transactionCount, 0);
    assert.equal(store.writeDecisions.length, 0);
    assert.deepEqual(store.get(ownerId), before);
  }
});

test("stale and duplicate-version updates abort without last-write-wins overwrite", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 5,
  }));
  const harness = profileHarness(store);

  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(
        ownerAuth(),
        saveRequestData("ownerUpdate", {
          expectedProfileVersion: 4,
          requestId: "stale-before-geocode",
        }),
      ),
      harness.dependencies,
    ),
    expectHttpsError("aborted"),
  );
  assert.equal(harness.geocodeCalls.length, 0);
  assert.equal(store.transactionCount, 0);

  await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      saveRequestData("ownerUpdate", {
        expectedProfileVersion: 5,
        requestId: "first-update",
        profile: profile({ phone: "(352) 555-0111" }),
      }),
    ),
    harness.dependencies,
  );
  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(
        ownerAuth(),
        saveRequestData("ownerUpdate", {
          expectedProfileVersion: 5,
          requestId: "second-update",
          profile: profile({ phone: "(352) 555-0222" }),
        }),
      ),
      harness.dependencies,
    ),
    expectHttpsError("aborted"),
  );
  assert.equal(store.get(ownerId).phone, "(352) 555-0111");
  assert.equal(store.get(ownerId).profileVersion, 6);
});

test("transaction reread aborts a concurrent address change during geocoding", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 2,
  }));
  const concurrentAddress = addressFromProfile(
    profile({ streetAddress: "789 Pine Rd" }),
  );
  const concurrentAddressFingerprint =
    createRestaurantAddressFingerprint(concurrentAddress);
  const harness = profileHarness(store, {
    onGeocode: async () => {
      store.directPatch(ownerId, {
        streetAddress: concurrentAddress.streetAddress,
        formattedAddress:
          "789 Pine Rd, Crystal River, FL 34428, USA",
        addressFingerprint: concurrentAddressFingerprint,
        locationValidationFingerprint:
          createBiteSaverLocationValidationFingerprint({
            addressFingerprint: concurrentAddressFingerprint,
            ...defaultCoordinates,
            locationSource: biteSaverLocationSource,
          }),
      });
    },
  });

  await assert.rejects(
    saveBiteSaverRestaurantProfileHandler(
      callableRequest(
        ownerAuth(),
        saveRequestData("ownerUpdate", {
          expectedProfileVersion: 2,
          requestId: "raced-address",
          profile: profile({ streetAddress: "456 Oak Ave" }),
        }),
      ),
      harness.dependencies,
    ),
    expectHttpsError("aborted", /while.*validated|changed/),
  );
  assert.equal(store.transactionCount, 1);
  assert.equal(store.writeDecisions.length, 0);
  assert.equal(store.get(ownerId).streetAddress, "789 Pine Rd");
  assert.equal(
    store.get(ownerId).addressFingerprint,
    concurrentAddressFingerprint,
  );
  assert.equal(store.get(ownerId).profileVersion, 2);
});

test("malformed stored profile versions fail closed", async () => {
  for (const malformedVersion of ["1", -1, 1.5, Number.NaN]) {
    const store = new AtomicAccountStore();
    store.seed(ownerId, trustedAccount({
      approvalStatus: "approved",
      profileVersion: malformedVersion,
    }));
    const harness = profileHarness(store);
    await assert.rejects(
      saveBiteSaverRestaurantProfileHandler(
        callableRequest(
          ownerAuth(),
          saveRequestData("ownerUpdate", {
            expectedProfileVersion: 0,
          }),
        ),
        harness.dependencies,
      ),
      expectHttpsError("failed-precondition", /version metadata/),
    );
    assert.equal(harness.geocodeCalls.length, 0);
    assert.equal(store.transactionCount, 0);
    assert.equal(store.writeDecisions.length, 0);
  }
});

test("profile updates preserve lifecycle, subscription, invite, geohash, and unrelated fields", async () => {
  const store = new AtomicAccountStore();
  const initial = trustedAccount({
    approvalStatus: "approved",
    profileVersion: 9,
    couponPostingEnabled: true,
    billingPlanName: "coupon_monthly",
    customFlag: "preserve-me",
  });
  store.seed(ownerId, initial);
  const harness = profileHarness(store);

  await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      saveRequestData("ownerUpdate", {
        expectedProfileVersion: 9,
        requestId: "preserve-fields",
        profile: profile({
          phone: "(352) 555-0888",
        }),
      }),
    ),
    harness.dependencies,
  );
  const saved = store.get(ownerId);
  for (const field of [
    "uid",
    "email",
    "couponApplicationSubmitted",
    "approvalStatus",
    "subscriptionStatus",
    "stripeCustomerId",
    "couponPostingEnabled",
    "billingPlanName",
    "inviteId",
    "geohash",
    "customFlag",
    "bio",
    "mainImageUrl",
    "businessHours",
  ]) {
    assert.deepEqual(saved[field], initial[field], field);
  }
  const write = store.writeDecisions[0].data;
  for (const forbidden of ["geohash", "location", "geoPoint"]) {
    assert.equal(Object.hasOwn(write, forbidden), false);
  }
});

test("optional bio, main image, and business hours update only when provided", async () => {
  const store = new AtomicAccountStore();
  store.seed(ownerId, trustedAccount({
    approvalStatus: "approved",
    profileVersion: 1,
  }));
  const harness = profileHarness(store);

  await saveBiteSaverRestaurantProfileHandler(
    callableRequest(
      ownerAuth(),
      saveRequestData("ownerUpdate", {
        expectedProfileVersion: 1,
        requestId: "clear-optional-fields",
        profile: profile({
          bio: "",
          mainImageUrl: "",
          businessHours: [],
        }),
      }),
    ),
    harness.dependencies,
  );
  const saved = store.get(ownerId);
  assert.equal(saved.bio, null);
  assert.equal(saved.mainImageUrl, null);
  assert.deepEqual(saved.businessHours, []);
  assert.equal(harness.geocodeCalls.length, 0);
});

test("review requires admin before request validation or transactions", async () => {
  for (const auth of [undefined, anonymousAuth(), ownerAuth("ordinary-user")]) {
    const store = new AtomicAccountStore();
    await assert.rejects(
      reviewBiteSaverApplicationHandler(
        callableRequest(auth, { malformed: true }),
        reviewDependencies(store),
      ),
      expectHttpsError(auth && auth.uid === "ordinary-user"
        ? "permission-denied"
        : "unauthenticated"),
    );
    assert.equal(store.transactionCount, 0);
  }
});

test("review cannot create a missing account", async () => {
  const store = new AtomicAccountStore();
  await assert.rejects(
    reviewBiteSaverApplicationHandler(
      callableRequest(claimAdminAuth(), reviewRequestData()),
      reviewDependencies(store),
    ),
    expectHttpsError("not-found"),
  );
  assert.equal(store.documents.size, 0);
  assert.equal(store.writeDecisions.length, 0);
});

test("claim and email admins can approve a trusted pending application without geohash", async () => {
  for (const auth of [claimAdminAuth(), emailAdminAuth()]) {
    const store = new AtomicAccountStore();
    const pending = trustedAccount({
      uid: otherOwnerId,
      profileVersion: 3,
      approvalStatus: "pending",
      lastProfileRequestId: "prior-profile-request",
      lastProfileRequestFingerprint: "a".repeat(64),
    });
    delete pending.geohash;
    store.seed(accountId, pending);

    const response = await reviewBiteSaverApplicationHandler(
      callableRequest(
        auth,
        reviewRequestData({ expectedProfileVersion: 3 }),
      ),
      reviewDependencies(store),
    );
    const saved = store.get(accountId);

    assert.deepEqual(response, {
      documentId: accountId,
      approvalStatus: "approved",
      profileVersion: 3,
    });
    assert.equal(saved.approvalStatus, "approved");
    assert.equal(saved.profileVersion, 3);
    assert.equal(saved.lastProfileRequestId, "prior-profile-request");
    assert.equal(saved.lastProfileRequestFingerprint, "a".repeat(64));
    assert.equal(Object.hasOwn(saved, "geohash"), false);
    assert.equal(hasCompleteTrustedBiteSaverLocation(saved), true);
    assert.deepEqual(Object.keys(store.writeDecisions[0].data).sort(), [
      "approvalStatus",
      "updatedAt",
    ]);
  }
});

test("approval rejects unsubmitted, nonpending, incomplete, or untrusted accounts", async () => {
  const cases = [
    trustedAccount({ couponApplicationSubmitted: false }),
    trustedAccount({ approvalStatus: "approved" }),
    trustedAccount({ restaurantName: "" }),
    trustedAccount({ phone: "" }),
    (() => {
      const data = trustedAccount();
      delete data.addressFingerprint;
      return data;
    })(),
    trustedAccount({
      latitude: 0,
      longitude: 0,
      locationValidationFingerprint: "invalid-coordinates",
    }),
    trustedAccount({ locationSource: "client" }),
    trustedAccount({ locationVersion: 0 }),
    trustedAccount({ locationValidatedAt: null }),
    trustedAccount({ locationValidationFingerprint: "tampered" }),
  ];

  for (const account of cases) {
    const store = new AtomicAccountStore();
    store.seed(accountId, account);
    await assert.rejects(
      reviewBiteSaverApplicationHandler(
        callableRequest(claimAdminAuth(), reviewRequestData()),
        reviewDependencies(store),
      ),
      expectHttpsError("failed-precondition"),
    );
    assert.equal(store.writeDecisions.length, 0);
  }
});

test("rejection preserves valid and invalid location, profile, subscription, invite, and geohash data", async () => {
  const store = new AtomicAccountStore();
  const pending = trustedAccount({
    profileVersion: 4,
    latitude: 0,
    longitude: 0,
    locationValidationFingerprint: "stale",
  });
  store.seed(accountId, pending);
  const before = store.get(accountId);

  const response = await reviewBiteSaverApplicationHandler(
    callableRequest(
      claimAdminAuth(),
      reviewRequestData({
        decision: "reject",
        expectedProfileVersion: 4,
      }),
    ),
    reviewDependencies(store),
  );
  const saved = store.get(accountId);

  assert.deepEqual(response, {
    documentId: accountId,
    approvalStatus: "rejected",
    profileVersion: 4,
  });
  assert.equal(saved.approvalStatus, "rejected");
  for (const [key, value] of Object.entries(before)) {
    if (key === "approvalStatus" || key === "updatedAt") continue;
    assert.deepEqual(saved[key], value, key);
  }
  assert.equal(Object.hasOwn(store.writeDecisions[0].data, "geohash"), false);
});

test("review rejects stale versions and applications that are not pending", async () => {
  {
    const store = new AtomicAccountStore();
    store.seed(accountId, trustedAccount({ profileVersion: 2 }));
    await assert.rejects(
      reviewBiteSaverApplicationHandler(
        callableRequest(
          claimAdminAuth(),
          reviewRequestData({ expectedProfileVersion: 1 }),
        ),
        reviewDependencies(store),
      ),
      expectHttpsError("aborted"),
    );
    assert.equal(store.writeDecisions.length, 0);
  }

  for (const status of ["approved", "rejected"]) {
    const store = new AtomicAccountStore();
    store.seed(accountId, trustedAccount({ approvalStatus: status }));
    await assert.rejects(
      reviewBiteSaverApplicationHandler(
        callableRequest(claimAdminAuth(), reviewRequestData()),
        reviewDependencies(store),
      ),
      expectHttpsError("failed-precondition", /pending/),
    );
    assert.equal(store.writeDecisions.length, 0);
  }
});

test("trusted-location helpers bind address, coordinates, and source", () => {
  const account = trustedAccount();
  assert.equal(hasCompleteTrustedBiteSaverLocation(account), true);
  assert.equal(canApproveBiteSaverApplication(account), true);
  assert.match(account.locationValidationFingerprint, /^[0-9a-f]{64}$/);

  for (const patch of [
    { streetAddress: "124 Main St" },
    { latitude: account.latitude + 0.1 },
    { longitude: account.longitude - 0.1 },
    { locationSource: "client" },
  ]) {
    assert.equal(
      hasCompleteTrustedBiteSaverLocation({ ...account, ...patch }),
      false,
    );
  }
  assert.throws(
    () =>
      createBiteSaverLocationValidationFingerprint({
        addressFingerprint: account.addressFingerprint,
        latitude: 0,
        longitude: 0,
        locationSource: biteSaverLocationSource,
      }),
    RangeError,
  );
});

test("lifecycle module import has no Firebase initialization, Firestore, secret, network, logging, or entry-point effects", () => {
  const lifecycleModulePath = path.resolve(
    __dirname,
    "../lib/bitesaver_restaurant_profile.js",
  );
  const functionsEntryPointPath = path.resolve(__dirname, "../lib/index.js");
  const childScript = `
    const Module = require("node:module");
    const http = require("node:http");
    const https = require("node:https");
    const lifecycleModulePath = process.argv[1];
    const functionsEntryPointPath = process.argv[2];
    const fail = (message) => () => { throw new Error(message); };
    global.fetch = fail("lifecycle module performed global fetch");
    http.get = fail("lifecycle module used http.get");
    http.request = fail("lifecycle module used http.request");
    https.get = fail("lifecycle module used https.get");
    https.request = fail("lifecycle module used https.request");
    for (const method of ["log", "info", "warn", "error", "debug", "trace"]) {
      console[method] = fail("lifecycle module logged through console." + method);
    }
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolved === functionsEntryPointPath) {
        throw new Error("lifecycle module imported the Functions entry point");
      }
      const loaded = originalLoad.apply(this, arguments);
      if (request === "firebase-admin/app") {
        return new Proxy(loaded, {
          get(target, property, receiver) {
            if (property === "initializeApp" || property === "applicationDefault") {
              return fail("lifecycle module initialized Firebase or accessed credentials");
            }
            return Reflect.get(target, property, receiver);
          },
        });
      }
      if (request === "firebase-admin/firestore") {
        return new Proxy(loaded, {
          get(target, property, receiver) {
            if (property === "getFirestore" || property === "initializeFirestore") {
              return fail("lifecycle module created Firestore");
            }
            return Reflect.get(target, property, receiver);
          },
        });
      }
      if (request === "firebase-functions/params") {
        return new Proxy(loaded, {
          get(target, property, receiver) {
            if (property === "defineSecret") {
              return fail("lifecycle module declared or resolved a secret");
            }
            return Reflect.get(target, property, receiver);
          },
        });
      }
      return loaded;
    };
    const adminApp = require("firebase-admin/app");
    require(lifecycleModulePath);
    if (adminApp.getApps().length !== 0) {
      throw new Error("lifecycle module created a Firebase app");
    }
    if (require.cache[functionsEntryPointPath]) {
      throw new Error("lifecycle module cached the Functions entry point");
    }
    process.stdout.write("bitesaver-lifecycle-module-loaded");
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
    [
      "-e",
      childScript,
      lifecycleModulePath,
      functionsEntryPointPath,
    ],
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
  assert.equal(result.stdout, "bitesaver-lifecycle-module-loaded");
});

test("lifecycle source remains dependency-injected and does not own Firestore, secrets, entry-point registration, or geohash writes", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/bitesaver_restaurant_profile.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /\bgetFirestore\s*\(/);
  assert.doesNotMatch(source, /\binitializeApp\s*\(/);
  assert.doesNotMatch(source, /\bdefineSecret\s*\(/);
  assert.doesNotMatch(source, /\bonCall\s*\(/);
  assert.doesNotMatch(source, /from\s+["']\.\/index\.js["']/);
  assert.doesNotMatch(source, /\.collection\s*\(\s*["']restaurant_accounts/);
  assert.doesNotMatch(source, /\bwrite\.geohash\b/);
  assert.match(source, /\bgeocodeAddress\b/);
  assert.match(source, /\brunAccountTransaction\b/);
});

test("Functions entry point registers the exact lifecycle callables with narrow adapters", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );

  assert.equal(
    source.match(/export const saveBiteSaverRestaurantProfile\s*=/g)?.length,
    1,
  );
  assert.equal(
    source.match(/export const reviewBiteSaverApplication\s*=/g)?.length,
    1,
  );
  assert.match(
    source,
    /export const saveBiteSaverRestaurantProfile = onCall\([\s\S]*?secrets: \[googleMapsApiKey\][\s\S]*?saveBiteSaverRestaurantProfileHandler/,
  );
  assert.match(
    source,
    /export const reviewBiteSaverApplication = onCall\([\s\S]*?reviewBiteSaverApplicationHandler/,
  );
  assert.match(
    source,
    /function runBiteSaverAccountTransaction<[^>]+>[\s\S]*?transaction\.create\(accountRef, decision\.data\)[\s\S]*?transaction\.update\(accountRef, decision\.data\)/,
  );
  assert.match(
    source,
    /function geocodeBiteSaverRestaurantAddress[\s\S]*?getGeocodingApiKey: \(\) => googleMapsApiKey\.value\(\)/,
  );
});
