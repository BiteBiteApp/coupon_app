const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  updateExistingRestaurantSubscription,
} = require("../lib/restaurant_subscription_helpers.js");

const accountPath = (uid) => `restaurant_accounts/${uid}`;

test("existing restaurant account receives only the supplied subscription patch", async () => {
  const db = new FakeFirestore();
  const initialAccount = completeRestaurantAccount();
  const subscriptionPatch = activeSubscriptionPatch();
  db.seed(accountPath("owner-1"), initialAccount);

  const result = await updateExistingRestaurantSubscription(
    db,
    "owner-1",
    subscriptionPatch,
  );

  assert.equal(result, "updated");
  assert.deepEqual(db.get(accountPath("owner-1")), {
    ...initialAccount,
    ...subscriptionPatch,
  });
  assert.deepEqual(
    pickProfileAndLocation(db.get(accountPath("owner-1"))),
    pickProfileAndLocation(initialAccount),
  );
  assert.deepEqual(db.operations, [
    { operation: "get", path: accountPath("owner-1") },
    {
      operation: "update",
      path: accountPath("owner-1"),
      keys: Object.keys(subscriptionPatch),
    },
  ]);
});

test("missing restaurant account remains absent and is never updated or created", async () => {
  const db = new FakeFirestore();

  const result = await updateExistingRestaurantSubscription(
    db,
    "missing-owner",
    activeSubscriptionPatch(),
  );

  assert.equal(result, "missing-account");
  assert.equal(db.get(accountPath("missing-owner")), undefined);
  assert.equal(db.documentCount, 0);
  assert.deepEqual(db.operations, [
    { operation: "get", path: accountPath("missing-owner") },
  ]);
});

test("profile, address, location, geohash, lifecycle, and unknown field injection is rejected before a transaction", async () => {
  const forbiddenFields = [
    "uid",
    "email",
    "restaurantName",
    "streetAddress",
    "city",
    "state",
    "zipCode",
    "phone",
    "website",
    "formattedAddress",
    "latitude",
    "longitude",
    "location",
    "geoPoint",
    "addressFingerprint",
    "locationSource",
    "locationValidatedAt",
    "locationVersion",
    "geohash",
    "approvalStatus",
    "couponApplicationSubmitted",
    "profileVersion",
    "inviteId",
    "unexpectedField",
  ];

  for (const field of forbiddenFields) {
    const db = new FakeFirestore();
    const initialAccount = completeRestaurantAccount();
    db.seed(accountPath("owner-1"), initialAccount);

    await assert.rejects(
      () =>
        updateExistingRestaurantSubscription(db, "owner-1", {
          ...activeSubscriptionPatch(),
          [field]: "injected",
        }),
      /Unsupported restaurant subscription update field/,
      field,
    );

    assert.equal(db.transactionCount, 0, field);
    assert.deepEqual(db.operations, [], field);
    assert.deepEqual(db.get(accountPath("owner-1")), initialAccount, field);
  }
});

test("the exact current subscription allowlist accepts an omitted hasUsedTrial field", async () => {
  const db = new FakeFirestore();
  db.seed(accountPath("owner-1"), {
    ...completeRestaurantAccount(),
    hasUsedTrial: true,
  });
  const subscriptionPatch = activeSubscriptionPatch();
  delete subscriptionPatch.hasUsedTrial;

  const result = await updateExistingRestaurantSubscription(
    db,
    "owner-1",
    subscriptionPatch,
  );

  assert.equal(result, "updated");
  assert.equal(db.get(accountPath("owner-1")).hasUsedTrial, true);
  assert.equal(db.transactionCount, 1);
});

test("repeated subscription handling is safe and preserves unrelated account data", async () => {
  const db = new FakeFirestore();
  const initialAccount = completeRestaurantAccount();
  db.seed(accountPath("owner-1"), initialAccount);

  const firstResult = await updateExistingRestaurantSubscription(
    db,
    "owner-1",
    activeSubscriptionPatch({
      updatedAt: { __op: "serverTimestamp-1" },
    }),
  );
  const secondResult = await updateExistingRestaurantSubscription(
    db,
    "owner-1",
    activeSubscriptionPatch({
      updatedAt: { __op: "serverTimestamp-2" },
    }),
  );

  assert.equal(firstResult, "updated");
  assert.equal(secondResult, "updated");
  assert.equal(db.documentCount, 1);
  const updatedAccount = db.get(accountPath("owner-1"));
  assert.equal(updatedAccount.subscriptionStatus, "active");
  assert.equal(updatedAccount.stripeSubscriptionId, "sub_123");
  assert.deepEqual(updatedAccount.updatedAt, {
    __op: "serverTimestamp-2",
  });
  assert.deepEqual(
    pickProfileAndLocation(updatedAccount),
    pickProfileAndLocation(initialAccount),
  );
  assert.equal(
    db.operations.filter((operation) => operation.operation === "update").length,
    2,
  );
});

test("transaction failures propagate without partially changing the account", async () => {
  const db = new FakeFirestore();
  const initialAccount = completeRestaurantAccount();
  db.seed(accountPath("owner-1"), initialAccount);
  db.transactionFailure = new Error("Injected transaction failure");

  await assert.rejects(
    () =>
      updateExistingRestaurantSubscription(
        db,
        "owner-1",
        activeSubscriptionPatch(),
      ),
    /Injected transaction failure/,
  );

  assert.deepEqual(db.get(accountPath("owner-1")), initialAccount);
});

test("subscription helper source requires an atomic update and has no create path", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/restaurant_subscription_helpers.ts"),
    "utf8",
  );

  assert.match(source, /runTransaction/);
  assert.match(source, /transaction\.get\(accountRef\)/);
  assert.match(source, /transaction\.update\(accountRef, updateData\)/);
  assert.doesNotMatch(source, /\.set\s*\(/);
  assert.doesNotMatch(source, /\bmerge\b/);
  assert.doesNotMatch(source, /from\s+["']\.\/index\.js["']/);
});

test("Stripe webhook wiring uses the existing-only helper without logging merged metadata", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/index.ts"),
    "utf8",
  );
  const syncStart = source.indexOf(
    "async function syncRestaurantSubscriptionFromStripe",
  );
  const syncEnd = source.indexOf(
    "export const createSubscriptionCheckoutSession",
    syncStart,
  );
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  const syncSource = source.slice(syncStart, syncEnd);

  assert.match(syncSource, /updateExistingRestaurantSubscription\(/);
  assert.match(syncSource, /updateResult === "missing-account"/);
  assert.doesNotMatch(syncSource, /\.set\(updateData/);
  assert.doesNotMatch(syncSource, /\{\s*subscriptionId:[\s\S]*?\bmetadata\s*,/);
});

test("subscription helper import has no Firebase, Stripe, secret, network, logging, or entry-point effects", () => {
  const helperModulePath = path.resolve(
    __dirname,
    "../lib/restaurant_subscription_helpers.js",
  );
  const functionsEntryPointPath = path.resolve(__dirname, "../lib/index.js");
  const childScript = `
    const Module = require("node:module");
    const helperModulePath = process.argv[1];
    const functionsEntryPointPath = process.argv[2];
    const fail = (message) => () => { throw new Error(message); };
    global.fetch = fail("subscription helper performed global fetch");
    for (const method of ["log", "info", "warn", "error", "debug", "trace"]) {
      console[method] = fail("subscription helper logged through console." + method);
    }
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (
        request === "stripe" ||
        request === "firebase-admin" ||
        request.startsWith("firebase-admin/") ||
        request === "firebase-functions" ||
        request.startsWith("firebase-functions/")
      ) {
        throw new Error("subscription helper loaded " + request);
      }
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolved === functionsEntryPointPath) {
        throw new Error("subscription helper imported the Functions entry point");
      }
      return originalLoad.apply(this, arguments);
    };
    require(helperModulePath);
    if (require.cache[functionsEntryPointPath]) {
      throw new Error("subscription helper cached the Functions entry point");
    }
    process.stdout.write("restaurant-subscription-helper-loaded");
  `;
  const environment = { ...process.env };
  for (const variable of [
    "FIREBASE_CONFIG",
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "GCLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    delete environment[variable];
  }

  const result = spawnSync(
    process.execPath,
    [
      "-e",
      childScript,
      helperModulePath,
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
  assert.equal(result.stdout, "restaurant-subscription-helper-loaded");
});

function completeRestaurantAccount() {
  return {
    uid: "owner-1",
    email: "owner@example.com",
    restaurantName: "BiteStar Cafe",
    streetAddress: "123 Main St",
    city: "Detroit",
    state: "MI",
    zipCode: "48201",
    phone: "313-555-0100",
    website: "https://example.com",
    approvalStatus: "approved",
    couponApplicationSubmitted: true,
    profileVersion: 7,
    locationVersion: 3,
    addressFingerprint: "trusted-address-fingerprint",
    formattedAddress: "123 Main St, Detroit, MI 48201, USA",
    latitude: 42.3314,
    longitude: -83.0458,
    locationSource: "google_geocoding",
    locationValidatedAt: { __op: "existing-location-timestamp" },
    geohash: "dpscjy",
    inviteId: "invite-1",
    unrelatedField: { preserve: true },
    subscriptionStatus: "inactive",
  };
}

function activeSubscriptionPatch(overrides = {}) {
  return {
    subscriptionStatus: "active",
    trialEndsAt: null,
    subscriptionEndsAt: { seconds: 1_800_000_000 },
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    billingPlanName: "coupon_monthly",
    couponPostingEnabled: true,
    hasUsedTrial: true,
    updatedAt: { __op: "serverTimestamp" },
    ...overrides,
  };
}

function pickProfileAndLocation(account) {
  return {
    uid: account.uid,
    email: account.email,
    restaurantName: account.restaurantName,
    streetAddress: account.streetAddress,
    city: account.city,
    state: account.state,
    zipCode: account.zipCode,
    phone: account.phone,
    website: account.website,
    approvalStatus: account.approvalStatus,
    couponApplicationSubmitted: account.couponApplicationSubmitted,
    profileVersion: account.profileVersion,
    locationVersion: account.locationVersion,
    addressFingerprint: account.addressFingerprint,
    formattedAddress: account.formattedAddress,
    latitude: account.latitude,
    longitude: account.longitude,
    locationSource: account.locationSource,
    locationValidatedAt: account.locationValidatedAt,
    geohash: account.geohash,
    inviteId: account.inviteId,
    unrelatedField: account.unrelatedField,
  };
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this.operations = [];
    this.transactionFailure = null;
    this.transactionCount = 0;
  }

  collection(collectionPath) {
    return {
      doc: (documentId) => ({
        id: documentId,
        path: `${collectionPath}/${documentId}`,
        get: async () => this.snapshot(`${collectionPath}/${documentId}`),
      }),
    };
  }

  async runTransaction(updateFunction) {
    this.transactionCount += 1;
    const stagedUpdates = [];
    const transaction = {
      get: async (reference) => {
        this.operations.push({ operation: "get", path: reference.path });
        return this.snapshot(reference.path);
      },
      update: (reference, data) => {
        stagedUpdates.push({
          reference,
          data: structuredClone(data),
        });
      },
    };

    const result = await updateFunction(transaction);
    if (this.transactionFailure) {
      throw this.transactionFailure;
    }

    for (const { reference, data } of stagedUpdates) {
      const existing = this.documents.get(reference.path);
      if (!existing) {
        throw new Error(`No document to update: ${reference.path}`);
      }
      this.documents.set(reference.path, {
        ...existing,
        ...data,
      });
      this.operations.push({
        operation: "update",
        path: reference.path,
        keys: Object.keys(data),
      });
    }

    return result;
  }

  snapshot(documentPath) {
    const data = this.documents.get(documentPath);
    return {
      id: documentPath.split("/").at(-1),
      exists: data !== undefined,
      data: () => data === undefined ? undefined : structuredClone(data),
    };
  }

  seed(documentPath, data) {
    this.documents.set(documentPath, structuredClone(data));
  }

  get(documentPath) {
    const data = this.documents.get(documentPath);
    return data === undefined ? undefined : structuredClone(data);
  }

  get documentCount() {
    return this.documents.size;
  }
}
