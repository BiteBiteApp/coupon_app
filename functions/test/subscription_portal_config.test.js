"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const {
  SubscriptionPortalConfigurationError,
  canonicalSubscriptionPortalReturnUrl,
  requireCanonicalSubscriptionPortalReturnUrl,
} = require("../lib/subscription_portal_config.js");
const {
  CANONICAL_PORTAL_RETURN_URL: deploymentValidatorCanonicalUrl,
} = require("../scripts/validate_deployment_env.js");

const expectedCanonicalUrl =
  "https://app.bitestar.app/subscription/portal-return";

test("the exact canonical portal return URL is accepted unchanged", () => {
  assert.equal(
    requireCanonicalSubscriptionPortalReturnUrl(expectedCanonicalUrl),
    expectedCanonicalUrl,
  );
  assert.equal(canonicalSubscriptionPortalReturnUrl, expectedCanonicalUrl);
});

test("every noncanonical portal configuration fails with one controlled error", () => {
  const rejected = [
    undefined,
    null,
    42,
    {},
    "",
    "not a URL",
    "http://app.bitestar.app/subscription/portal-return",
    "HTTPS://app.bitestar.app/subscription/portal-return",
    "https://APP.bitestar.app/subscription/portal-return",
    "https://www.app.bitestar.app/subscription/portal-return",
    "https://go.bitestar.app/subscription/portal-return",
    "https://coupon-app-29446.web.app/subscription/portal-return",
    "https://app.bitestar.app:443/subscription/portal-return",
    "https://user@app.bitestar.app/subscription/portal-return",
    "https://user:password@app.bitestar.app/subscription/portal-return",
    "https://app.bitestar.app/subscription/portal-return/",
    "https://app.bitestar.app/subscription/portal-return?next=1",
    "https://app.bitestar.app/subscription/portal-return#fragment",
    "https://app.bitestar.app/subscription/%70ortal-return",
    ` ${expectedCanonicalUrl}`,
    `${expectedCanonicalUrl} `,
  ];

  for (const value of rejected) {
    assert.throws(
      () => requireCanonicalSubscriptionPortalReturnUrl(value),
      (error) => {
        assert.ok(error instanceof SubscriptionPortalConfigurationError);
        assert.equal(
          error.message,
          "Stripe Customer Portal return URL configuration is invalid.",
        );
        assert.equal(
          error.code,
          "subscription_portal_configuration_error",
        );
        assert.doesNotMatch(
          `${error.name} ${error.message} ${error.code}`,
          /https?:\/\/|coupon-app|go\.bitestar|next=|password/,
        );
        return true;
      },
    );
  }
});

test("Functions, Flutter, Hosting, and the helper asset share one exact portal contract", () => {
  const repositoryRoot = path.resolve(__dirname, "../..");
  const firebaseConfig = JSON.parse(
    readFileSync(path.join(repositoryRoot, "firebase.json"), "utf8"),
  );
  const dartSource = readFileSync(
    path.join(
      repositoryRoot,
      "lib/services/subscription_return_service.dart",
    ),
    "utf8",
  );
  const helperSource = readFileSync(
    path.join(repositoryRoot, "web/subscription-portal-return.html"),
    "utf8",
  );

  const dartMatch =
    /stripeCustomerPortalReturnUrl\s*=\s*\n?\s*'([^']+)'/.exec(
      dartSource,
    );
  const canonicalLinkMatch =
    /<link\s+rel="canonical"\s+href="([^"]+)"/s.exec(helperSource);
  assert.ok(dartMatch);
  assert.ok(canonicalLinkMatch);
  assert.equal(dartMatch[1], expectedCanonicalUrl);
  assert.equal(canonicalLinkMatch[1], expectedCanonicalUrl);
  assert.equal(canonicalSubscriptionPortalReturnUrl, expectedCanonicalUrl);
  assert.equal(deploymentValidatorCanonicalUrl, expectedCanonicalUrl);

  const parsed = new URL(canonicalSubscriptionPortalReturnUrl);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "app.bitestar.app");
  assert.equal(parsed.port, "");
  assert.equal(parsed.pathname, "/subscription/portal-return");
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");

  const portalRewrite = firebaseConfig.hosting.rewrites.find(
    (rewrite) => rewrite.source === parsed.pathname,
  );
  assert.deepEqual(portalRewrite, {
    source: "/subscription/portal-return",
    destination: "/subscription-portal-return.html",
  });
});

test("the portal configuration module imports without Firebase, Stripe, parameters, environment, network, or logging effects", () => {
  const helperModulePath = path.resolve(
    __dirname,
    "../lib/subscription_portal_config.js",
  );
  const functionsEntryPointPath = path.resolve(__dirname, "../lib/index.js");
  const childScript = `
    const Module = require("node:module");
    const helperModulePath = process.argv[1];
    const functionsEntryPointPath = process.argv[2];
    const fail = (message) => () => { throw new Error(message); };
    global.fetch = fail("portal config performed global fetch");
    for (const method of ["log", "info", "warn", "error", "debug", "trace"]) {
      console[method] = fail("portal config logged through console." + method);
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
        throw new Error("portal config loaded " + request);
      }
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolved === functionsEntryPointPath) {
        throw new Error("portal config imported the Functions entry point");
      }
      return originalLoad.apply(this, arguments);
    };
    const beforeKeys = Object.keys(process.env).sort();
    require(helperModulePath);
    const afterKeys = Object.keys(process.env).sort();
    if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
      throw new Error("portal config changed environment variables");
    }
    if (require.cache[functionsEntryPointPath]) {
      throw new Error("portal config cached the Functions entry point");
    }
    process.stdout.write("subscription-portal-config-loaded");
  `;
  const environment = {...process.env};
  for (const variable of [
    "FIREBASE_CONFIG",
    "GCLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "STRIPE_CUSTOMER_PORTAL_RETURN_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    delete environment[variable];
  }

  const result = spawnSync(
    process.execPath,
    ["-e", childScript, helperModulePath, functionsEntryPointPath],
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
  assert.equal(result.stdout, "subscription-portal-config-loaded");
});
