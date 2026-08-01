"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const {
  SubscriptionReturnProtocolRequestError,
  SubscriptionReturnTokenError,
  buildSubscriptionCheckoutReturnUrls,
  buildSubscriptionReturnUrl,
  generateSubscriptionReturnToken,
  isValidSubscriptionReturnToken,
  requireSubscriptionReturnProtocolVersion,
  requireSubscriptionReturnToken,
  subscriptionReturnProtocolVersion,
  subscriptionReturnTokenByteLength,
  subscriptionReturnTokenLength,
  subscriptionReturnTokenParameter,
  subscriptionReturnUpdateRequiredMessage,
} = require("../lib/subscription_return_token.js");

const checkoutSuccessBaseUrl =
  "https://coupon-app-29446.web.app/stripe-success.html";
const checkoutCancelBaseUrl =
  "https://coupon-app-29446.web.app/stripe-cancel.html";
const portalBaseUrl =
  "https://app.bitestar.app/subscription/portal-return";

function bytesFromSeed(seed) {
  return Uint8Array.from(
    {length: subscriptionReturnTokenByteLength},
    (_, index) => (seed + index) % 256,
  );
}

function expectProtocolRequestError(operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof SubscriptionReturnProtocolRequestError);
    assert.equal(error.code, "subscription_return_protocol_request_error");
    assert.equal(error.message, subscriptionReturnUpdateRequiredMessage);
    return true;
  });
}

function expectTokenError(operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof SubscriptionReturnTokenError);
    assert.equal(error.code, "subscription_return_token_error");
    assert.equal(
      error.message,
      "Subscription return correlation could not be created.",
    );
    return true;
  });
}

test("deterministic random seam produces the exact 32-byte unpadded base64url token", () => {
  const bytes = bytesFromSeed(0);
  const expected = Buffer.from(bytes).toString("base64url");
  const requestedSizes = [];

  const token = generateSubscriptionReturnToken((size) => {
    requestedSizes.push(size);
    return bytes;
  });

  assert.deepEqual(requestedSizes, [32]);
  assert.equal(subscriptionReturnProtocolVersion, 2);
  assert.equal(subscriptionReturnTokenByteLength, 32);
  assert.equal(subscriptionReturnTokenLength, 43);
  assert.equal(subscriptionReturnTokenParameter, "return_token");
  assert.equal(token, expected);
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(token, /=/);
  assert.equal(isValidSubscriptionReturnToken(token), true);
  assert.equal(requireSubscriptionReturnToken(token), token);
});

test("secure default generation yields distinct opaque tokens without mutable random state", () => {
  const generated = new Set();
  for (let index = 0; index < 256; index += 1) {
    const token = generateSubscriptionReturnToken();
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(generated.has(token), false);
    generated.add(token);
  }

  const firstSeamToken = generateSubscriptionReturnToken(
    () => bytesFromSeed(17),
  );
  const secondSeamToken = generateSubscriptionReturnToken(
    () => bytesFromSeed(91),
  );
  assert.notEqual(firstSeamToken, secondSeamToken);
  assert.equal(
    generateSubscriptionReturnToken(() => bytesFromSeed(17)),
    firstSeamToken,
  );

  const exportedNames = Object.keys(
    require("../lib/subscription_return_token.js"),
  );
  assert.equal(
    exportedNames.some((name) => /set|override|reset/i.test(name)),
    false,
  );
});

test("invalid random seams fail with one fixed token-free error", () => {
  const rawCanary = "owner-a@example.test/restaurant-a/sk_fake";
  const invalidSeams = [
    () => new Uint8Array(0),
    () => new Uint8Array(31),
    () => new Uint8Array(33),
    () => Buffer.alloc(31),
    () => rawCanary,
    () => {
      throw new Error(rawCanary);
    },
  ];

  for (const seam of invalidSeams) {
    assert.throws(
      () => generateSubscriptionReturnToken(seam),
      (error) => {
        assert.ok(error instanceof SubscriptionReturnTokenError);
        assert.equal(error.message.includes(rawCanary), false);
        return true;
      },
    );
  }
});

test("token validation accepts only the exact 43-character base64url alphabet", () => {
  const valid = generateSubscriptionReturnToken(
    () => bytesFromSeed(31),
  );
  const invalid = [
    undefined,
    null,
    2,
    {},
    "",
    valid.slice(0, 42),
    `${valid}A`,
    `${valid}=`,
    ` ${valid}`,
    `${valid} `,
    `${valid.slice(0, 42)}+`,
    `${valid.slice(0, 42)}/`,
    `${valid.slice(0, 42)}.`,
    `${valid.slice(0, 42)}%`,
    valid.toLowerCase().slice(0, 42),
  ];

  for (const value of invalid) {
    assert.equal(isValidSubscriptionReturnToken(value), false);
    expectTokenError(() => requireSubscriptionReturnToken(value));
  }
});

test("protocol request accepts exactly one integer version-2 field", () => {
  assert.equal(
    requireSubscriptionReturnProtocolVersion({
      returnProtocolVersion: 2,
    }),
    2,
  );
  const nullPrototype = Object.create(null);
  nullPrototype.returnProtocolVersion = 2;
  assert.equal(
    requireSubscriptionReturnProtocolVersion(nullPrototype),
    2,
  );

  const throwingVersion = {};
  Object.defineProperty(throwingVersion, "returnProtocolVersion", {
    enumerable: true,
    get() {
      throw new Error("raw request getter canary");
    },
  });
  const rejected = [
    undefined,
    null,
    [],
    {},
    {returnProtocolVersion: undefined},
    {returnProtocolVersion: null},
    {returnProtocolVersion: "2"},
    {returnProtocolVersion: 2.0, unexpected: true},
    {returnProtocolVersion: 2.5},
    {returnProtocolVersion: -2},
    {returnProtocolVersion: 0},
    {returnProtocolVersion: 1},
    {returnProtocolVersion: 3},
    {unexpected: 2},
    Object.assign(Object.create({inherited: true}), {
      returnProtocolVersion: 2,
    }),
    throwingVersion,
  ];

  for (const value of rejected) {
    expectProtocolRequestError(
      () => requireSubscriptionReturnProtocolVersion(value),
    );
  }

  const symbolField = {
    returnProtocolVersion: 2,
    [Symbol("unknown")]: true,
  };
  expectProtocolRequestError(
    () => requireSubscriptionReturnProtocolVersion(symbolField),
  );
});

test("Checkout URL construction preserves both routes and places one shared token only in query state", () => {
  const token = generateSubscriptionReturnToken(
    () => bytesFromSeed(63),
  );
  const urls = buildSubscriptionCheckoutReturnUrls({
    successBaseUrl: checkoutSuccessBaseUrl,
    cancelBaseUrl: checkoutCancelBaseUrl,
    returnToken: token,
  });

  assert.equal(Object.isFrozen(urls), true);
  for (const [value, expectedBase] of [
    [urls.successUrl, checkoutSuccessBaseUrl],
    [urls.cancelUrl, checkoutCancelBaseUrl],
  ]) {
    const parsed = new URL(value);
    const expected = new URL(expectedBase);
    assert.equal(parsed.protocol, expected.protocol);
    assert.equal(parsed.host, expected.host);
    assert.equal(parsed.pathname, expected.pathname);
    assert.equal(parsed.username, "");
    assert.equal(parsed.password, "");
    assert.equal(parsed.port, "");
    assert.equal(parsed.hash, "");
    assert.deepEqual([...parsed.searchParams.keys()], ["return_token"]);
    assert.deepEqual(parsed.searchParams.getAll("return_token"), [token]);
    assert.equal(
      value,
      `${expectedBase}?return_token=${token}`,
    );
  }
  assert.equal(
    urls.successUrl.replace(token, "").includes(token),
    false,
  );
  assert.equal(
    urls.cancelUrl.replace(token, "").includes(token),
    false,
  );
});

test("Portal URL construction preserves the exact canonical base and one token parameter", () => {
  const token = generateSubscriptionReturnToken(
    () => bytesFromSeed(127),
  );
  const value = buildSubscriptionReturnUrl(portalBaseUrl, token);
  const parsed = new URL(value);

  assert.equal(
    value,
    `${portalBaseUrl}?return_token=${token}`,
  );
  assert.equal(parsed.origin, "https://app.bitestar.app");
  assert.equal(parsed.pathname, "/subscription/portal-return");
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(parsed.port, "");
  assert.equal(parsed.hash, "");
  assert.deepEqual([...parsed.searchParams.entries()], [
    ["return_token", token],
  ]);
});

test("URL construction rejects noncanonical bases, existing state, and caller destinations", () => {
  const token = generateSubscriptionReturnToken(
    () => bytesFromSeed(191),
  );
  const unsafeBases = [
    undefined,
    null,
    "",
    "not a URL",
    "http://app.bitestar.app/subscription/portal-return",
    "HTTPS://app.bitestar.app/subscription/portal-return",
    "https://APP.bitestar.app/subscription/portal-return",
    "https://user@app.bitestar.app/subscription/portal-return",
    "https://app.bitestar.app:443/subscription/portal-return",
    `${portalBaseUrl}?return_token=${token}`,
    `${portalBaseUrl}?next=https://evil.example`,
    `${portalBaseUrl}#fragment`,
    ` ${portalBaseUrl}`,
    `${portalBaseUrl} `,
  ];

  for (const base of unsafeBases) {
    expectTokenError(() => buildSubscriptionReturnUrl(base, token));
  }
  expectTokenError(
    () => buildSubscriptionReturnUrl(portalBaseUrl, "caller-token"),
  );
});

test("token helper imports without Firebase, Stripe, environment, network, or logging effects", () => {
  const helperModulePath = path.resolve(
    __dirname,
    "../lib/subscription_return_token.js",
  );
  const entryPointPath = path.resolve(__dirname, "../lib/index.js");
  const childScript = `
    const Module = require("node:module");
    const helperModulePath = process.argv[1];
    const entryPointPath = process.argv[2];
    const fail = (message) => () => { throw new Error(message); };
    global.fetch = fail("token helper performed network access");
    for (const method of ["log", "info", "warn", "error", "debug", "trace"]) {
      console[method] = fail("token helper logged through console." + method);
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
        throw new Error("token helper loaded " + request);
      }
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolved === entryPointPath) {
        throw new Error("token helper imported the Functions entry point");
      }
      return originalLoad.apply(this, arguments);
    };
    const before = JSON.stringify(Object.keys(process.env).sort());
    require(helperModulePath);
    const after = JSON.stringify(Object.keys(process.env).sort());
    if (before !== after) {
      throw new Error("token helper changed environment variables");
    }
    if (require.cache[entryPointPath]) {
      throw new Error("token helper cached the Functions entry point");
    }
    process.stdout.write("subscription-return-token-loaded");
  `;

  const result = spawnSync(
    process.execPath,
    ["-e", childScript, helperModulePath, entryPointPath],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      env: {...process.env},
      timeout: 5000,
    },
  );

  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "subscription-return-token-loaded");
});

test("token helper source contains no identity, payment, persistence, or logging path", () => {
  const source = readFileSync(
    path.resolve(
      __dirname,
      "../src/subscription_return_token.ts",
    ),
    "utf8",
  );

  assert.match(source, /randomBytes/);
  assert.match(source, /toString\("base64url"\)/);
  assert.doesNotMatch(
    source,
    /\b(?:uid|email|customerId|subscriptionId|checkoutSessionId|paymentIntentId|documentId)\b/,
  );
  assert.doesNotMatch(
    source,
    /(?:console|logger|localStorage|sessionStorage|cookie|firestore|stripe)/i,
  );
  assert.doesNotMatch(source, /\b(?:set|update|write|save)Random/i);
});
