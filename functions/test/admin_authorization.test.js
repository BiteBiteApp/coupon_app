const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  requireAdminInviteAccess,
  requireAuthenticatedRestaurantAccountActor,
  requireRestaurantAccountAdminAccess,
} = require("../lib/admin_authorization.js");

function expectHttpsError(code, messagePattern) {
  return (error) => {
    assert.equal(error?.code, code);
    assert.match(error?.message ?? "", messagePattern);
    return true;
  };
}

test("restaurant account actor requires signed-in record auth and token data", () => {
  for (const request of [
    {},
    { auth: null },
    { auth: "malformed" },
    { auth: [] },
    { auth: {} },
    { auth: { uid: "   ", token: {} } },
    { auth: { uid: 123, token: {} } },
    { auth: { uid: "owner-1" } },
    { auth: { uid: "owner-1", token: null } },
    { auth: { uid: "owner-1", token: [] } },
  ]) {
    assert.throws(
      () => requireAuthenticatedRestaurantAccountActor(request),
      expectHttpsError("unauthenticated", /valid nonanonymous signed-in/i),
    );
  }
});

test("restaurant account actor rejects anonymous callers before authorization", () => {
  for (const token of [
    {
      admin: true,
      firebase: { sign_in_provider: "anonymous" },
    },
    {
      email: "schuyler.cole@gmail.com",
      firebase: { sign_in_provider: " ANONYMOUS " },
    },
  ]) {
    const request = { auth: { uid: "anonymous-user", token } };
    assert.throws(
      () => requireAuthenticatedRestaurantAccountActor(request),
      expectHttpsError("unauthenticated", /valid nonanonymous signed-in/i),
    );
    assert.throws(
      () => requireRestaurantAccountAdminAccess(request),
      expectHttpsError("unauthenticated", /valid nonanonymous signed-in/i),
    );
  }
});

test("restaurant account actor fails closed for malformed token metadata", () => {
  for (const token of [
    { email: 123 },
    { email_verified: "true" },
    { firebase: null },
    { firebase: "malformed" },
    { firebase: [] },
    { firebase: { sign_in_provider: 123 } },
    { firebase: { sign_in_provider: "   " } },
  ]) {
    assert.throws(
      () =>
        requireAuthenticatedRestaurantAccountActor({
          auth: { uid: "owner-1", token },
        }),
      expectHttpsError("unauthenticated", /valid nonanonymous signed-in/i),
    );
  }
});

test("restaurant account actor returns trimmed identity metadata", () => {
  assert.deepEqual(
    requireAuthenticatedRestaurantAccountActor({
      auth: {
        uid: " owner-1 ",
        token: {
          email: " Owner@Example.COM ",
          email_verified: true,
          firebase: { sign_in_provider: "password" },
        },
      },
    }),
    {
      uid: "owner-1",
      email: "Owner@Example.COM",
      emailVerified: true,
    },
  );

  assert.deepEqual(
    requireAuthenticatedRestaurantAccountActor({
      auth: {
        uid: "phone-owner",
        token: {
          firebase: { sign_in_provider: "phone" },
        },
      },
    }),
    {
      uid: "phone-owner",
      email: null,
      emailVerified: false,
    },
  );
});

test("restaurant account admin accepts a boolean custom claim without email", () => {
  assert.deepEqual(
    requireRestaurantAccountAdminAccess({
      auth: {
        uid: "claim-admin",
        token: {
          admin: true,
          firebase: { sign_in_provider: "custom" },
        },
      },
    }),
    {
      uid: "claim-admin",
      email: null,
      emailVerified: false,
    },
  );
});

test("restaurant account admin accepts the exact current allowlist email", () => {
  assert.deepEqual(
    requireRestaurantAccountAdminAccess({
      auth: {
        uid: "email-admin",
        token: {
          email: "schuyler.cole@gmail.com",
          email_verified: true,
        },
      },
    }),
    {
      uid: "email-admin",
      email: "schuyler.cole@gmail.com",
      emailVerified: true,
    },
  );
});

test("restaurant account admin does not broaden the exact email allowlist", () => {
  for (const email of [
    "SCHUYLER.COLE@GMAIL.COM",
    " schuyler.cole@gmail.com ",
  ]) {
    assert.throws(
      () =>
        requireRestaurantAccountAdminAccess({
          auth: {
            uid: "nonexact-email",
            token: { email },
          },
        }),
      expectHttpsError("permission-denied", /administrator access/i),
    );
  }
});

test("restaurant account admin rejects authenticated non-admins", () => {
  assert.throws(
    () =>
      requireRestaurantAccountAdminAccess({
        auth: {
          uid: "ordinary-user",
          token: { email: "ordinary@example.com" },
        },
      }),
    expectHttpsError("permission-denied", /administrator access/i),
  );
});

test("restaurant account admin rejects string-ish admin claims", () => {
  for (const admin of ["true", 1, "1"]) {
    assert.throws(
      () =>
        requireRestaurantAccountAdminAccess({
          auth: {
            uid: "ordinary-user",
            token: { admin, email: "ordinary@example.com" },
          },
        }),
      expectHttpsError("permission-denied", /administrator access/i),
    );
  }
});

test("invite authorization remains email-only", () => {
  assert.deepEqual(
    requireAdminInviteAccess({
      auth: {
        uid: "email-admin",
        token: { email: " SCHUYLER.COLE@GMAIL.COM " },
      },
    }),
    {
      uid: "email-admin",
      email: "schuyler.cole@gmail.com",
    },
  );

  assert.throws(
    () =>
      requireAdminInviteAccess({
        auth: {
          uid: "claim-admin",
          token: { admin: true },
        },
      }),
    expectHttpsError("permission-denied", /Admin access/i),
  );
  assert.throws(
    () => requireAdminInviteAccess({}),
    expectHttpsError("permission-denied", /Admin access/i),
  );
});

test("authorization source keeps the invite gate separate from account claims", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/admin_authorization.ts"),
    "utf8",
  );
  const accountBoundary = source.indexOf(
    "export type RestaurantAccountActorContext",
  );
  assert.notEqual(accountBoundary, -1);
  const inviteSource = source.slice(0, accountBoundary);

  assert.match(inviteSource, /export function requireAdminInviteAccess\(/);
  assert.match(inviteSource, /!adminInviteEmails\.has\(email\)/);
  assert.doesNotMatch(inviteSource, /token\.admin/);
  assert.doesNotMatch(source, /firebase-admin/);
  assert.doesNotMatch(source, /\.\/index\.js/);
});

test("authorization module imports without Firebase Admin or entry-point effects", () => {
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

  assert.equal(
    result.status,
    0,
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  assert.equal(result.stdout, "authorization-module-loaded");
});
