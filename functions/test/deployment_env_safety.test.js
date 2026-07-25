"use strict";

const assert = require("node:assert/strict");
const {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const validatorPath = path.resolve(
  __dirname,
  "../scripts/validate_deployment_env.js",
);
const {
  ALLOWED_PARAMETER_NAMES,
  CANONICAL_PORTAL_RETURN_URL,
  PORTAL_RETURN_PARAMETER,
  classifyPortalReturnValue,
  discoverParameterDefinitionsFromSources,
  discoverTrackedParameterDefinitions,
  main,
  printSafeResult,
  trackedRuntimeTypeScriptSources,
  updateDeploymentEnvToCanonical,
  validateDeploymentEnv,
} = require(validatorPath);

const expectedSourceAnalysis = Object.freeze({
  nonsecretNames: Object.freeze([
    "STRIPE_CUSTOMER_PORTAL_RETURN_URL",
  ]),
  secretNames: Object.freeze([
    "GOOGLE_MAPS_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]),
  issues: Object.freeze([]),
});

function withFixture(callback) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "bitestar-deployment-env-test-"),
  );
  try {
    return callback(directory);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

function withFunctionsFixture(callback) {
  const functionsDirectory = path.resolve(__dirname, "..");
  const directory = mkdtempSync(
    path.join(functionsDirectory, ".env.validator-cli-test-"),
  );
  try {
    return callback(directory);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

function writeFixture(directory, source, mode = 0o600) {
  const filePath = path.join(directory, ".env.test-project");
  writeFileSync(filePath, source, {encoding: "utf8", mode});
  chmodSync(filePath, mode);
  return filePath;
}

function canonicalSource() {
  return `${PORTAL_RETURN_PARAMETER}=${CANONICAL_PORTAL_RETURN_URL}\n`;
}

function legacySource() {
  return `${PORTAL_RETURN_PARAMETER}=https://legacy.invalid/return\n`;
}

function sameSizeChangedSource(source) {
  const finalNewline = source.endsWith("\n") ? "\n" : "";
  const body = finalNewline === "" ? source : source.slice(0, -1);
  const finalCharacter = body.endsWith("x") ? "y" : "x";
  return `${body.slice(0, -1)}${finalCharacter}${finalNewline}`;
}

function categories(result) {
  return result.issues.map((issue) => issue.category);
}

function fixtureOptions(directory, overrides = {}) {
  return {
    allowedRoot: directory,
    sourceParameterAnalysis: expectedSourceAnalysis,
    ...overrides,
  };
}

function assertNoUpdateArtifacts(directory) {
  const artifactNames = readdirSync(directory).filter(
    (name) =>
      name.startsWith(".env.deployment-update-") ||
      name.endsWith(".bak") ||
      name.endsWith(".tmp"),
  );
  assert.deepEqual(artifactNames, []);
}

function runValidatorCli(filePath) {
  return spawnSync(
    process.execPath,
    [validatorPath, "validate", filePath],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    },
  );
}

function fileSafetySnapshot(filePath) {
  const bytes = readFileSync(filePath);
  const metadata = lstatSync(filePath, {bigint: true});
  return {
    bytes,
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    nlink: metadata.nlink,
    mode: metadata.mode,
    size: metadata.size,
    mtimeNs: metadata.mtimeNs,
    ctimeNs: metadata.ctimeNs,
  };
}

function captureSafeResultOutput(result) {
  let stdout = "";
  printSafeResult(result, {
    write(chunk) {
      stdout += String(chunk);
    },
  });
  return {stdout, stderr: ""};
}

function assertTextSafetyCase({
  label,
  bytes,
  canary,
  expectedCategory,
  sourceLine,
}) {
  withFunctionsFixture((directory) => {
    const safeLabel = label.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
    const filePath = path.join(directory, `.env.${safeLabel}`);
    writeFileSync(filePath, bytes, {mode: 0o600});
    chmodSync(filePath, 0o600);
    const before = fileSafetySnapshot(filePath);

    let direct;
    assert.doesNotThrow(() => {
      direct = validateDeploymentEnv(
        filePath,
        fixtureOptions(directory),
      );
    }, label);
    assert.equal(direct.ok, false, label);
    assert.deepEqual(categories(direct), [expectedCategory], label);

    const cli = runValidatorCli(filePath);
    assert.equal(cli.error, undefined, label);
    assert.equal(cli.signal, null, label);
    assert.equal(cli.status, 1, label);
    assert.equal(cli.stderr, "", label);
    assert.match(
      cli.stdout,
      new RegExp(`dotenv: ${expectedCategory}`),
      label,
    );

    const rendered = captureSafeResultOutput(direct);
    assert.equal(rendered.stderr, "", label);
    assert.match(
      rendered.stdout,
      new RegExp(`dotenv: ${expectedCategory}`),
      label,
    );

    const resultText = JSON.stringify(direct);
    for (const [surfaceName, surface] of [
      ["CLI stdout", cli.stdout],
      ["CLI stderr", cli.stderr],
      ["result", resultText],
      ["rendered stdout", rendered.stdout],
      ["rendered stderr", rendered.stderr],
    ]) {
      assert.equal(
        surface.includes(canary),
        false,
        `${label}: canary leaked through ${surfaceName}`,
      );
      assert.equal(
        surface.includes(sourceLine),
        false,
        `${label}: source line leaked through ${surfaceName}`,
      );
      assert.equal(
        surface.includes(CANONICAL_PORTAL_RETURN_URL),
        false,
        `${label}: canonical value leaked through ${surfaceName}`,
      );
    }

    const after = fileSafetySnapshot(filePath);
    assert.deepEqual(after, before, `${label}: source file changed`);
    assertNoUpdateArtifacts(directory);
  });
}

function syntheticSource(sourceText, fileName = "fixture.ts") {
  return discoverParameterDefinitionsFromSources([
    {
      filePath: path.join(os.tmpdir(), fileName),
      sourceText,
    },
  ]);
}

test("the source-derived deployment allowlist contains only the nonsecret portal parameter", () => {
  assert.deepEqual(ALLOWED_PARAMETER_NAMES, [
    "STRIPE_CUSTOMER_PORTAL_RETURN_URL",
  ]);
  const discovered = discoverTrackedParameterDefinitions();
  assert.deepEqual(discovered, expectedSourceAnalysis);

  const trackedSources = trackedRuntimeTypeScriptSources();
  assert.ok(trackedSources.length > 0);
  for (const {filePath} of trackedSources) {
    assert.match(filePath, /\/functions\/src\/.*\.ts$/);
    assert.doesNotMatch(filePath, /\/(?:lib|scripts|test)\//);
  }
});

test("syntax-aware discovery ignores comments, strings, templates, tags, locals, and unrelated imports", () => {
  const ignored = syntheticSource(`
    // defineString("COMMENT_PARAMETER")
    /* defineString("BLOCK_COMMENT_PARAMETER") */
    const normal = 'defineString("STRING_PARAMETER")';
    const template = \`defineString("TEMPLATE_PARAMETER")\`;
    const tag = (parts) => parts;
    const tagged = tag\`defineString("TAGGED_PARAMETER")\`;
    function defineString() {}
    defineString("LOCAL_PARAMETER");
    import {defineString as unrelated} from "another-package";
    unrelated("UNRELATED_PARAMETER");
    void normal;
    void template;
    void tagged;
  `);

  assert.deepEqual(ignored, {
    nonsecretNames: [],
    secretNames: [],
    issues: [],
  });
});

test("syntax-aware discovery recognizes legitimate named, aliased, and namespace bindings only", () => {
  const discovered = syntheticSource(`
    import {
      defineString,
      defineString as defineText,
      defineSecret,
      defineJsonSecret,
    } from "firebase-functions/params";
    import * as params from "firebase-functions/params";
    defineString("DIRECT_PARAMETER");
    defineText("ALIASED_PARAMETER");
    params.defineString("NAMESPACE_PARAMETER");
    defineSecret("STRIPE_SECRET_KEY");
    defineJsonSecret("JSON_SECRET");
  `);

  assert.deepEqual(discovered, {
    nonsecretNames: [
      "ALIASED_PARAMETER",
      "DIRECT_PARAMETER",
      "NAMESPACE_PARAMETER",
    ],
    secretNames: ["JSON_SECRET", "STRIPE_SECRET_KEY"],
    issues: [],
  });
  assert.equal(discovered.nonsecretNames.includes("STRIPE_SECRET_KEY"), false);
  assert.equal(discovered.nonsecretNames.includes("JSON_SECRET"), false);
});

test("lexical shadowing cannot turn a local call into a Firebase parameter", () => {
  const discovered = syntheticSource(`
    import {defineString as defineText} from "firebase-functions/params";
    defineText("REAL_PARAMETER");
    function localScope() {
      const defineText = () => undefined;
      defineText("SHADOWED_PARAMETER");
    }
    localScope();
  `);

  assert.deepEqual(discovered, {
    nonsecretNames: ["REAL_PARAMETER"],
    secretNames: [],
    issues: [],
  });

  const conflictingDeclaration = syntheticSource(`
    import {defineString} from "firebase-functions/params";
    function defineString() {}
    defineString("CONFLICTING_LOCAL_PARAMETER");
  `);
  assert.deepEqual(conflictingDeclaration, {
    nonsecretNames: [],
    secretNames: [],
    issues: [],
  });
});

test("dynamic parameter names fail closed and cannot authorize dotenv usage", () => {
  const discovered = syntheticSource(`
    import {defineString} from "firebase-functions/params";
    const dynamicName = "DYNAMIC_PARAMETER";
    defineString(dynamicName);
    defineString("PREFIX_" + "SUFFIX");
    defineString(\`INTERPOLATED_\${dynamicName}\`);
    defineString(\`NO_SUBSTITUTION_TEMPLATE\`);
  `);

  assert.deepEqual(discovered.nonsecretNames, []);
  assert.deepEqual(discovered.secretNames, []);
  assert.equal(
    discovered.issues.filter(
      (issue) => issue.category === "dynamic_parameter_name_rejected",
    ).length,
    4,
  );
});

test("an unexpected source-discovered parameter makes deployment validation fail safely", () => {
  withFixture((directory) => {
    const filePath = writeFixture(directory, canonicalSource());
    const result = validateDeploymentEnv(
      filePath,
      fixtureOptions(directory, {
        sourceParameterAnalysis: {
          nonsecretNames: [
            PORTAL_RETURN_PARAMETER,
            "UNEXPECTED_SOURCE_PARAMETER",
          ],
          secretNames: [],
          issues: [],
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.deepEqual(categories(result), ["source_allowlist_mismatch"]);
    assert.doesNotMatch(
      JSON.stringify(result),
      /UNEXPECTED_SOURCE_PARAMETER|https?:\/\//,
    );
  });
});

test("a canonical single-key file passes without exposing its value", () => {
  withFixture((directory) => {
    const filePath = writeFixture(
      directory,
      `# Deployment parameter\n${canonicalSource()}`,
    );

    const result = validateDeploymentEnv(
      filePath,
      fixtureOptions(directory),
    );

    assert.equal(result.ok, true);
    assert.equal(result.mode, "0600");
    assert.deepEqual(result.parameters, [
      {
        name: PORTAL_RETURN_PARAMETER,
        validationCategory: "exact_canonical_match",
      },
    ]);
    assert.deepEqual(result.issues, []);
    assert.doesNotMatch(
      JSON.stringify(result),
      /https:\/\/app\.bitestar\.app/,
    );
  });
});

test("the complete canonical URL rejection matrix fails without value leakage", () => {
  const rejected = [
    ["HTTP", "http://app.bitestar.app/subscription/portal-return"],
    ["wrong host", "https://example.test/subscription/portal-return"],
    [
      "historical host",
      "https://coupon-app-29446.web.app/subscription/portal-return",
    ],
    ["QR host", "https://go.bitestar.app/subscription/portal-return"],
    ["www host", "https://www.app.bitestar.app/subscription/portal-return"],
    ["wrong path", "https://app.bitestar.app/subscription/other"],
    ["trailing slash", `${CANONICAL_PORTAL_RETURN_URL}/`],
    ["populated query", `${CANONICAL_PORTAL_RETURN_URL}?next=1`],
    ["empty query", `${CANONICAL_PORTAL_RETURN_URL}?`],
    ["populated fragment", `${CANONICAL_PORTAL_RETURN_URL}#fragment`],
    ["empty fragment", `${CANONICAL_PORTAL_RETURN_URL}#`],
    [
      "userinfo",
      "https://user@app.bitestar.app/subscription/portal-return",
    ],
    [
      "explicit port",
      "https://app.bitestar.app:443/subscription/portal-return",
    ],
    ["leading whitespace", ` ${CANONICAL_PORTAL_RETURN_URL}`],
    ["trailing whitespace", `${CANONICAL_PORTAL_RETURN_URL} `],
    [
      "uppercase scheme",
      "HTTPS://app.bitestar.app/subscription/portal-return",
    ],
    [
      "mixed-case host",
      "https://APP.bitestar.app/subscription/portal-return",
    ],
    [
      "mixed-case path",
      "https://app.bitestar.app/subscription/Portal-return",
    ],
    [
      "percent encoded",
      "https://app.bitestar.app/subscription/%70ortal-return",
    ],
    [
      "Unicode lookalike",
      "https://аpp.bitestar.app/subscription/portal-return",
    ],
    [
      "embedded control",
      `https://app.bitestar.app/subscription/portal-\treturn`,
    ],
    [
      "multiple values",
      `${CANONICAL_PORTAL_RETURN_URL},${CANONICAL_PORTAL_RETURN_URL}`,
    ],
    [
      "trailing source content",
      `${CANONICAL_PORTAL_RETURN_URL} trailing`,
    ],
    ["blank", ""],
    ["invalid", "not a URL"],
  ];
  assert.equal(
    classifyPortalReturnValue(CANONICAL_PORTAL_RETURN_URL),
    "exact_canonical_match",
  );

  for (const [label, value] of rejected) {
    assert.notEqual(
      classifyPortalReturnValue(value),
      "exact_canonical_match",
      label,
    );
    withFunctionsFixture((directory) => {
      const filePath = writeFixture(
        directory,
        `${PORTAL_RETURN_PARAMETER}=${value}\n`,
      );
      const direct = validateDeploymentEnv(
        filePath,
        fixtureOptions(directory),
      );
      assert.equal(direct.ok, false, label);
      assert.doesNotMatch(
        JSON.stringify(direct),
        /https?:\/\/|portal-return|example\.test|coupon-app|next=/,
        label,
      );

      const cli = runValidatorCli(filePath);
      assert.equal(cli.status, 1, label);
      assert.equal(cli.stderr, "", label);
      assert.doesNotMatch(
        cli.stdout,
        /https?:\/\/|portal-return|example\.test|coupon-app|next=/,
        label,
      );
    });
  }
});

test("duplicate, missing, unexpected, reserved, and secret-like names fail safely", () => {
  const fixtures = [
    {
      source: `${canonicalSource()}${canonicalSource()}`,
      expected: "duplicate_parameter",
    },
    {
      source: "# no parameter\n",
      expected: "missing_required_parameter",
    },
    {
      source: `${canonicalSource()}UNEXPECTED_NAME=value\n`,
      expected: "unexpected_parameter_name",
    },
    {
      source: `${canonicalSource()}FIREBASE_CONFIG=value\n`,
      expected: "reserved_parameter_name",
    },
    {
      source: `${canonicalSource()}STRIPE_WEBHOOK_SECRET=value\n`,
      expected: "secret_like_parameter_name",
    },
    {
      source: `${canonicalSource()}PRIVATE_KEY=value\n`,
      expected: "secret_like_parameter_name",
    },
  ];

  for (const fixture of fixtures) {
    withFixture((directory) => {
      const filePath = writeFixture(directory, fixture.source);
      const result = validateDeploymentEnv(
        filePath,
        fixtureOptions(directory),
      );

      assert.equal(result.ok, false);
      assert.ok(categories(result).includes(fixture.expected));
      assert.doesNotMatch(JSON.stringify(result), /=value|portal-return/);
    });
  }
});

test("invalid syntax, ambiguous values, and assignment-shaped comments are rejected", () => {
  const fixtures = [
    "export STRIPE_CUSTOMER_PORTAL_RETURN_URL=value\n",
    "lowercase=value\n",
    "STRIPE_CUSTOMER_PORTAL_RETURN_URL =value\n",
    "# STRIPE_CUSTOMER_PORTAL_RETURN_URL=value\n",
    "STRIPE_CUSTOMER_PORTAL_RETURN_URL='quoted'\n",
    `${PORTAL_RETURN_PARAMETER}=${CANONICAL_PORTAL_RETURN_URL} # comment\n`,
    `${PORTAL_RETURN_PARAMETER}=\"${CANONICAL_PORTAL_RETURN_URL}\"\n`,
    `${PORTAL_RETURN_PARAMETER}= ${CANONICAL_PORTAL_RETURN_URL}\n`,
  ];

  for (const source of fixtures) {
    withFixture((directory) => {
      const filePath = writeFixture(directory, source);
      const result = validateDeploymentEnv(
        filePath,
        fixtureOptions(directory),
      );
      assert.equal(result.ok, false);
      assert.ok(
        categories(result).some((category) =>
          [
            "ambiguous_assignment_comment",
            "ambiguous_value_syntax",
            "invalid_dotenv_syntax",
            "missing_required_parameter",
            "parameter_value_rejected",
          ].includes(category),
        ),
      );
    });
  }
});

test("oversized files and long lines fail opaquely", () => {
  const fixtures = [
    {
      bytes: Buffer.alloc(16 * 1024 + 1, 0x41),
      expected: "file_too_large",
    },
    {
      bytes: Buffer.from(
        `${PORTAL_RETURN_PARAMETER}=${"a".repeat(2049)}\n`,
      ),
      expected: "line_too_long",
    },
  ];

  for (const fixture of fixtures) {
    withFixture((directory) => {
      const filePath = path.join(directory, ".env.test-project");
      writeFileSync(filePath, fixture.bytes, {mode: 0o600});
      const result = validateDeploymentEnv(
        filePath,
        fixtureOptions(directory),
      );

      assert.equal(result.ok, false);
      assert.ok(categories(result).includes(fixture.expected));
      assert.doesNotMatch(
        JSON.stringify(result),
        /bad|AAAA|STRIPE_CUSTOMER_PORTAL_RETURN_URL=/,
      );
    });
  }
});

test("every decoded Unicode C1 control has complete CLI, result, and no-write safety proof", () => {
  for (let codePoint = 0x80; codePoint <= 0x9f; codePoint += 1) {
    const hexadecimal = codePoint.toString(16).toUpperCase().padStart(4, "0");
    const canary = `CANARY_C1_${hexadecimal}_MUST_NOT_LEAK`;
    const sourceLine = `# ${canary}${String.fromCodePoint(codePoint)}`;
    assertTextSafetyCase({
      label: `C1 U+${hexadecimal}`,
      bytes: Buffer.from(`${sourceLine}\n${canonicalSource()}`),
      canary,
      expectedCategory: "prohibited_control_character",
      sourceLine,
    });
  }
});

test("malformed UTF-8, NUL, representative C0, DEL, and C1 locations have complete safety proof", () => {
  const fixtures = [
    {
      label: "malformed UTF-8",
      expectedCategory: "malformed_utf8",
      build(canary) {
        return Buffer.concat([
          Buffer.from(`${PORTAL_RETURN_PARAMETER}=${canary}`),
          Buffer.from([0xc3, 0x28]),
          Buffer.from("\n"),
        ]);
      },
    },
    {
      label: "NUL U+0000",
      expectedCategory: "control_character_rejected",
      build(canary) {
        return Buffer.from(`${PORTAL_RETURN_PARAMETER}=${canary}\u0000\n`);
      },
    },
    ...[
      [0x01, "SOH"],
      [0x0b, "vertical tab"],
      [0x1f, "unit separator"],
    ].map(([codePoint, name]) => ({
      label: `representative C0 ${name}`,
      expectedCategory: "control_character_rejected",
      build(canary) {
        return Buffer.from(
          `${PORTAL_RETURN_PARAMETER}=${canary}` +
            `${String.fromCodePoint(codePoint)}\n`,
        );
      },
    })),
    {
      label: "DEL U+007F",
      expectedCategory: "control_character_rejected",
      build(canary) {
        return Buffer.from(`${PORTAL_RETURN_PARAMETER}=${canary}\u007F\n`);
      },
    },
    {
      label: "U+0085 next line",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(`# ${canary}\u0085\n${canonicalSource()}`);
      },
    },
    {
      label: "U+009B control sequence introducer",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(`# ${canary}\u009B\n${canonicalSource()}`);
      },
    },
    {
      label: "C1 in comment",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(`# ${canary}\u0081 comment\n${canonicalSource()}`);
      },
    },
    {
      label: "C1 in key",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(`${canary}\u0082_KEY=value\n`);
      },
    },
    {
      label: "C1 in quoted value",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(
          `${PORTAL_RETURN_PARAMETER}="${canary}\u0083"\n`,
        );
      },
    },
    {
      label: "C1 in unquoted value",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(`${PORTAL_RETURN_PARAMETER}=${canary}\u0084\n`);
      },
    },
    {
      label: "C1 in trailing text",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(
          `${PORTAL_RETURN_PARAMETER}=${canary} trailing\u0086text\n`,
        );
      },
    },
    {
      label: "U+0085 in key",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(`${canary}\u0085_KEY=value\n`);
      },
    },
    {
      label: "U+0085 in quoted value",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(
          `${PORTAL_RETURN_PARAMETER}="${canary}\u0085"\n`,
        );
      },
    },
    {
      label: "U+0085 in unquoted value",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(
          `${PORTAL_RETURN_PARAMETER}=${canary}\u0085\n`,
        );
      },
    },
    {
      label: "U+009B in trailing text",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(
          `${PORTAL_RETURN_PARAMETER}=${canary} trailing\u009Btext\n`,
        );
      },
    },
    {
      label: "C1 adjacent to canonical URL",
      expectedCategory: "prohibited_control_character",
      build(canary) {
        return Buffer.from(
          `${PORTAL_RETURN_PARAMETER}=${CANONICAL_PORTAL_RETURN_URL}` +
            `\u0087${canary}\n`,
        );
      },
    },
  ];

  for (const [index, fixture] of fixtures.entries()) {
    const safeName = fixture.label
      .replace(/[^A-Za-z0-9]+/g, "_")
      .toUpperCase();
    const canary = `CANARY_TEXT_${index}_${safeName}_MUST_NOT_LEAK`;
    const bytes = fixture.build(canary);
    const newlineIndex = bytes.indexOf(0x0a);
    const sourceLine = bytes
      .subarray(0, newlineIndex === -1 ? bytes.length : newlineIndex)
      .toString("utf8");
    assert.ok(sourceLine.includes(canary), fixture.label);
    assertTextSafetyCase({
      label: fixture.label,
      bytes,
      canary,
      expectedCategory: fixture.expectedCategory,
      sourceLine,
    });
  }
});

test("symlinks, hard links, paths outside the root, unsafe modes, and nonfiles fail closed", () => {
  withFixture((directory) => {
    const sourcePath = writeFixture(directory, canonicalSource());
    const symlinkPath = path.join(directory, ".env.symlink");
    symlinkSync(sourcePath, symlinkPath);
    const symlinkResult = validateDeploymentEnv(
      symlinkPath,
      fixtureOptions(directory),
    );
    assert.deepEqual(categories(symlinkResult), ["symlink_rejected"]);

    const hardLinkPath = path.join(directory, ".env.hard-link");
    linkSync(sourcePath, hardLinkPath);
    const hardLinkResult = validateDeploymentEnv(
      sourcePath,
      fixtureOptions(directory),
    );
    assert.deepEqual(categories(hardLinkResult), ["unexpected_hard_links"]);
  });

  withFixture((directory) => {
    const outsideDirectory = mkdtempSync(
      path.join(os.tmpdir(), "bitestar-deployment-env-outside-"),
    );
    try {
      const outsidePath = writeFixture(
        outsideDirectory,
        canonicalSource(),
      );
      const outsideResult = validateDeploymentEnv(
        outsidePath,
        fixtureOptions(directory),
      );
      assert.deepEqual(categories(outsideResult), [
        "path_outside_allowed_root",
      ]);
    } finally {
      rmSync(outsideDirectory, {recursive: true, force: true});
    }

    const nonfileResult = validateDeploymentEnv(
      directory,
      fixtureOptions(directory),
    );
    assert.deepEqual(categories(nonfileResult), ["not_regular_file"]);
  });

  withFixture((directory) => {
    const filePath = writeFixture(directory, canonicalSource(), 0o644);
    const result = validateDeploymentEnv(
      filePath,
      fixtureOptions(directory),
    );
    assert.equal(result.ok, false);
    assert.ok(categories(result).includes("unsafe_file_mode"));
  });

  withFixture((directory) => {
    const filePath = writeFixture(directory, canonicalSource(), 0o600);
    chmodSync(filePath, 0o1600);
    assert.notEqual(lstatSync(filePath).mode & 0o7000, 0);
    const result = validateDeploymentEnv(
      filePath,
      fixtureOptions(directory),
    );
    assert.equal(result.ok, false);
    assert.ok(categories(result).includes("unsafe_file_mode"));
    assert.equal(result.mode, "1600");
  });
});

test("missing files and simulated wrong ownership fail with safe metadata-only categories", () => {
  withFixture((directory) => {
    const missing = validateDeploymentEnv(
      path.join(directory, ".env.missing"),
      fixtureOptions(directory),
    );
    assert.equal(missing.ok, false);
    assert.deepEqual(categories(missing), ["file_unavailable"]);

    const filePath = writeFixture(directory, canonicalSource());
    const wrongOwner = validateDeploymentEnv(
      filePath,
      fixtureOptions(directory, {
        testHooks: {
          transformSnapshot({phase, snapshot}) {
            if (phase === "initial") {
              return {uid: snapshot.uid + 1n};
            }
            return snapshot;
          },
        },
      }),
    );
    assert.equal(wrongOwner.ok, false);
    assert.deepEqual(categories(wrongOwner), [
      "not_current_user_owned",
    ]);
    assert.doesNotMatch(
      JSON.stringify(wrongOwner),
      /https?:\/\/|portal-return/,
    );
  });
});

test("accepted newline and BOM forms remain narrow while quotes, escapes, comments, and export syntax fail closed", () => {
  const accepted = [
    `${PORTAL_RETURN_PARAMETER}=${CANONICAL_PORTAL_RETURN_URL}\r\n`,
    `${PORTAL_RETURN_PARAMETER}=${CANONICAL_PORTAL_RETURN_URL}`,
    `\n# comment\n\n${canonicalSource()}`,
    `\uFEFF${canonicalSource()}`,
  ];
  for (const source of accepted) {
    withFixture((directory) => {
      const result = validateDeploymentEnv(
        writeFixture(directory, source),
        fixtureOptions(directory),
      );
      assert.equal(result.ok, true);
    });
  }

  const rejected = [
    `${PORTAL_RETURN_PARAMETER}="${CANONICAL_PORTAL_RETURN_URL}"\n`,
    `${PORTAL_RETURN_PARAMETER}='${CANONICAL_PORTAL_RETURN_URL}'\n`,
    `${PORTAL_RETURN_PARAMETER}=https:\\\\/\\\\/app.bitestar.app\\\\/subscription\\\\/portal-return\n`,
    `${PORTAL_RETURN_PARAMETER}=${CANONICAL_PORTAL_RETURN_URL} # inline\n`,
    `export ${canonicalSource()}`,
    `${PORTAL_RETURN_PARAMETER}=\n`,
  ];
  for (const source of rejected) {
    withFixture((directory) => {
      const result = validateDeploymentEnv(
        writeFixture(directory, source),
        fixtureOptions(directory),
      );
      assert.equal(result.ok, false);
      assert.doesNotMatch(
        JSON.stringify(result),
        /https?:\/\/|portal-return|inline/,
      );
    });
  }
});

test("the atomic update changes only the authorized value, sets 0600, and leaves no temporary copy", () => {
  withFixture((directory) => {
    const before =
      "# Keep this comment exactly\n" +
      `${PORTAL_RETURN_PARAMETER}=https://legacy.invalid/return\r\n` +
      "# Keep the final comment\r\n";
    const filePath = writeFixture(directory, before, 0o644);

    const result = updateDeploymentEnvToCanonical(filePath, {
      ...fixtureOptions(directory),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "updated");
    assert.equal(result.replacementOccurred, true);
    assert.equal(result.canonicalContentPresent, true);
    assert.equal(result.durabilityConfirmation, "confirmed");
    assert.equal(result.mode, "0600");
    assert.equal(lstatSync(filePath).mode & 0o777, 0o600);
    assert.equal(
      readFileSync(filePath, "utf8"),
      "# Keep this comment exactly\n" +
        `${PORTAL_RETURN_PARAMETER}=${CANONICAL_PORTAL_RETURN_URL}\r\n` +
        "# Keep the final comment\r\n",
    );
    assertNoUpdateArtifacts(directory);
  });
});

test("the atomic update preserves an accepted UTF-8 BOM while changing only the authorized value", () => {
  withFixture((directory) => {
    const before =
      "\uFEFF# Keep the BOM and comment exactly\n" +
      legacySource();
    const filePath = writeFixture(directory, before);

    const result = updateDeploymentEnvToCanonical(
      filePath,
      fixtureOptions(directory),
    );

    assert.equal(result.ok, true);
    assert.equal(
      readFileSync(filePath, "utf8"),
      "\uFEFF# Keep the BOM and comment exactly\n" +
        canonicalSource(),
    );
    assertNoUpdateArtifacts(directory);
  });
});

test("an already canonical strict-mode update is a true inode and timestamp no-op", () => {
  withFixture((directory) => {
    const filePath = writeFixture(
      directory,
      `# preserved\n${canonicalSource()}`,
      0o600,
    );
    const before = lstatSync(filePath, {bigint: true});
    const beforeSource = readFileSync(filePath, "utf8");

    const first = updateDeploymentEnvToCanonical(
      filePath,
      fixtureOptions(directory),
    );
    const second = updateDeploymentEnvToCanonical(
      filePath,
      fixtureOptions(directory),
    );
    const after = lstatSync(filePath, {bigint: true});

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.status, "no_change");
    assert.equal(first.replacementOccurred, false);
    assert.equal(first.canonicalContentPresent, true);
    assert.equal(first.durabilityConfirmation, "not_required");
    assert.equal(second.status, "no_change");
    assert.equal(second.replacementOccurred, false);
    assert.equal(second.canonicalContentPresent, true);
    assert.equal(second.durabilityConfirmation, "not_required");
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
    assert.equal(after.mode, before.mode);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeNs, before.mtimeNs);
    assert.equal(after.ctimeNs, before.ctimeNs);
    assert.equal(readFileSync(filePath, "utf8"), beforeSource);
    assertNoUpdateArtifacts(directory);
  });
});

test("same-inode content, size, mode, timestamp, link, path, and symlink races abort without replacement", () => {
  const cases = [
    {
      label: "same-inode content at the final before-rename seam",
      hookName: "beforeRename",
      mutate(filePath) {
        const beforeInode = lstatSync(filePath).ino;
        const changed = sameSizeChangedSource(legacySource());
        writeFileSync(filePath, changed, "utf8");
        assert.equal(lstatSync(filePath).ino, beforeInode);
        return () => assert.equal(readFileSync(filePath, "utf8"), changed);
      },
    },
    {
      label: "same-inode same-size content",
      mutate(filePath) {
        const beforeInode = lstatSync(filePath).ino;
        const changed = sameSizeChangedSource(legacySource());
        writeFileSync(filePath, changed, "utf8");
        assert.equal(lstatSync(filePath).ino, beforeInode);
        return () => assert.equal(readFileSync(filePath, "utf8"), changed);
      },
    },
    {
      label: "size change",
      mutate(filePath) {
        const changed = `${legacySource()}# changed size\n`;
        writeFileSync(filePath, changed, "utf8");
        return () => assert.equal(readFileSync(filePath, "utf8"), changed);
      },
    },
    {
      label: "mode change",
      mutate(filePath) {
        chmodSync(filePath, 0o640);
        return () => assert.equal(lstatSync(filePath).mode & 0o7777, 0o640);
      },
    },
    {
      label: "special-bit change",
      mutate(filePath) {
        chmodSync(filePath, 0o1600);
        return () => assert.equal(lstatSync(filePath).mode & 0o7777, 0o1600);
      },
    },
    {
      label: "modification-time change",
      mutate(filePath) {
        const changedTime = new Date(Date.now() + 10_000);
        utimesSync(filePath, changedTime, changedTime);
        return () =>
          assert.ok(lstatSync(filePath).mtimeMs > Date.now());
      },
    },
    {
      label: "same-size content with restored modification time",
      mutate(filePath) {
        const before = lstatSync(filePath);
        const changed = sameSizeChangedSource(legacySource());
        writeFileSync(filePath, changed, "utf8");
        utimesSync(filePath, before.atime, before.mtime);
        return () => assert.equal(readFileSync(filePath, "utf8"), changed);
      },
    },
    {
      label: "link-count change",
      mutate(filePath, directory) {
        const linkedPath = path.join(directory, ".env.hard-link-race");
        linkSync(filePath, linkedPath);
        return () => {
          assert.equal(lstatSync(filePath).nlink, 2);
          assert.equal(readFileSync(filePath, "utf8"), legacySource());
        };
      },
    },
    {
      label: "path replacement",
      mutate(filePath, directory) {
        const changed = sameSizeChangedSource(legacySource());
        const replacement = path.join(directory, ".env.path-replacement");
        writeFileSync(replacement, changed, {encoding: "utf8", mode: 0o600});
        renameSync(replacement, filePath);
        return () => assert.equal(readFileSync(filePath, "utf8"), changed);
      },
    },
    {
      label: "symlink substitution",
      mutate(filePath, directory) {
        const replacement = path.join(directory, ".env.replacement");
        writeFileSync(replacement, "replacement\n", {mode: 0o600});
        unlinkSync(filePath);
        symlinkSync(replacement, filePath);
        return () => assert.equal(lstatSync(filePath).isSymbolicLink(), true);
      },
    },
  ];

  for (const fixture of cases) {
    withFixture((directory) => {
      const filePath = writeFixture(directory, legacySource());
      let verifyMutation;
      const result = updateDeploymentEnvToCanonical(
        filePath,
        fixtureOptions(directory, {
          testHooks: {
            [fixture.hookName ?? "beforePreRenameCheck"]() {
              verifyMutation = fixture.mutate(filePath, directory);
            },
          },
        }),
      );

      assert.equal(result.ok, false, fixture.label);
      assert.deepEqual(categories(result), ["source_state_changed"]);
      assert.doesNotMatch(
        JSON.stringify(result),
        /legacy|portal-return|https?:\/\//,
      );
      verifyMutation();
      assertNoUpdateArtifacts(directory);
    });
  }
});

test("simulated UID, GID, and change-time races abort through the same safe source-state check", () => {
  for (const field of ["uid", "gid", "ctimeNs"]) {
    withFixture((directory) => {
      const filePath = writeFixture(directory, legacySource());
      const result = updateDeploymentEnvToCanonical(
        filePath,
        fixtureOptions(directory, {
          testHooks: {
            transformSnapshot({phase, snapshot}) {
              if (phase === "preRename") {
                return {[field]: snapshot[field] + 1n};
              }
              return snapshot;
            },
          },
        }),
      );

      assert.equal(result.ok, false, field);
      assert.deepEqual(categories(result), ["source_state_changed"]);
      assert.equal(readFileSync(filePath, "utf8"), legacySource());
      assertNoUpdateArtifacts(directory);
    });
  }
});

test("the pre-rename digest detects changed bytes even when metadata is simulated as restored", () => {
  withFixture((directory) => {
    const filePath = writeFixture(directory, legacySource());
    let baselineSnapshot;
    const changed = sameSizeChangedSource(legacySource());
    const result = updateDeploymentEnvToCanonical(
      filePath,
      fixtureOptions(directory, {
        testHooks: {
          beforePreRenameCheck() {
            writeFileSync(filePath, changed, "utf8");
          },
          transformSnapshot({phase, snapshot}) {
            if (phase === "initial") {
              baselineSnapshot = {...snapshot};
              return snapshot;
            }
            if (phase === "preRename") {
              return baselineSnapshot;
            }
            return snapshot;
          },
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.deepEqual(categories(result), ["source_state_changed"]);
    assert.equal(readFileSync(filePath, "utf8"), changed);
    assertNoUpdateArtifacts(directory);
  });
});

test("mutation during the pre-rename descriptor read aborts and preserves the mutation", () => {
  withFixture((directory) => {
    const filePath = writeFixture(directory, legacySource());
    const changed = sameSizeChangedSource(legacySource());
    const result = updateDeploymentEnvToCanonical(
      filePath,
      fixtureOptions(directory, {
        testHooks: {
          preRenameAfterRead() {
            writeFileSync(filePath, changed, "utf8");
          },
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.deepEqual(categories(result), ["source_state_changed"]);
    assert.equal(readFileSync(filePath, "utf8"), changed);
    assertNoUpdateArtifacts(directory);
  });
});

test("pre-replacement temp write and fsync failures are explicit and leave no temp or backup", () => {
  const failures = [
    "beforeTempWrite",
    "beforeTempFsync",
  ];

  for (const hookName of failures) {
    withFixture((directory) => {
      const filePath = writeFixture(directory, legacySource());
      const canary = `provider-${hookName}-must-not-leak`;
      const result = updateDeploymentEnvToCanonical(
        filePath,
        fixtureOptions(directory, {
          testHooks: {
            [hookName]() {
              throw new Error(canary);
            },
          },
        }),
      );

      assert.equal(result.ok, false, hookName);
      assert.deepEqual(categories(result), ["atomic_update_failed"]);
      assert.equal(result.status, "failed_before_replacement");
      assert.equal(result.replacementOccurred, false);
      assert.equal(result.canonicalContentPresent, false);
      assert.equal(result.durabilityConfirmation, "not_attempted");
      assert.doesNotMatch(JSON.stringify(result), new RegExp(canary));
      assert.equal(readFileSync(filePath, "utf8"), legacySource(), hookName);
      assertNoUpdateArtifacts(directory);
    });
  }
});

test("an injected rename operation fails only after the final source check and preserves the source exactly", () => {
  withFixture((directory) => {
    const filePath = writeFixture(directory, legacySource());
    const before = fileSafetySnapshot(filePath);
    const canary = "rename-provider-message-must-not-leak";
    let renameReached = false;
    let result;

    assert.doesNotThrow(() => {
      result = updateDeploymentEnvToCanonical(
        filePath,
        fixtureOptions(directory, {
          renameFile(temporaryPath, targetPath) {
            renameReached = true;
            assert.notEqual(temporaryPath, targetPath);
            assert.equal(targetPath, filePath);
            assert.equal(readFileSync(targetPath, "utf8"), legacySource());
            throw new Error(canary);
          },
        }),
      );
    });

    assert.equal(renameReached, true);
    assert.equal(result.ok, false);
    assert.deepEqual(categories(result), [
      "rename_failed_before_replacement",
    ]);
    assert.equal(result.status, "failed_before_replacement");
    assert.equal(result.replacementOccurred, false);
    assert.equal(result.canonicalContentPresent, false);
    assert.equal(result.durabilityConfirmation, "not_attempted");

    const rendered = captureSafeResultOutput(result);
    for (const output of [
      JSON.stringify(result),
      rendered.stdout,
      rendered.stderr,
    ]) {
      assert.equal(output.includes(canary), false);
      assert.equal(output.includes(legacySource().trimEnd()), false);
      assert.equal(output.includes(CANONICAL_PORTAL_RETURN_URL), false);
    }

    assert.deepEqual(fileSafetySnapshot(filePath), before);
    assertNoUpdateArtifacts(directory);
  });
});

test("a directory fsync failure reports completed canonical replacement and the next run is a true no-op", () => {
  withFixture((directory) => {
    const filePath = writeFixture(directory, legacySource());
    const canary = "directory-fsync-provider-message-must-not-leak";
    let directorySyncReached = false;
    const result = updateDeploymentEnvToCanonical(
      filePath,
      fixtureOptions(directory, {
        syncDirectory() {
          directorySyncReached = true;
          throw new Error(canary);
        },
      }),
    );

    assert.equal(directorySyncReached, true);
    assert.equal(result.ok, false);
    assert.deepEqual(categories(result), [
      "directory_sync_failed_after_replacement",
    ]);
    assert.equal(
      result.status,
      "replacement_completed_directory_sync_failed",
    );
    assert.equal(result.replacementOccurred, true);
    assert.equal(result.canonicalContentPresent, true);
    assert.equal(result.durabilityConfirmation, "failed_or_unknown");
    assert.equal(result.mode, "0600");
    assert.equal(readFileSync(filePath, "utf8"), canonicalSource());
    assert.equal(lstatSync(filePath).mode & 0o7777, 0o600);

    const rendered = captureSafeResultOutput(result);
    assert.match(
      rendered.stdout,
      /directory_sync_failed_after_replacement/,
    );
    assert.match(
      rendered.stdout,
      /replacement occurred: true/,
    );
    assert.match(
      rendered.stdout,
      /canonical content present: true/,
    );
    assert.match(
      rendered.stdout,
      /durability confirmation: failed_or_unknown/,
    );
    for (const output of [
      JSON.stringify(result),
      rendered.stdout,
      rendered.stderr,
    ]) {
      assert.equal(output.includes(canary), false);
      assert.equal(output.includes(legacySource().trimEnd()), false);
      assert.equal(output.includes(CANONICAL_PORTAL_RETURN_URL), false);
    }
    assertNoUpdateArtifacts(directory);

    const beforeSecondRun = fileSafetySnapshot(filePath);
    const second = updateDeploymentEnvToCanonical(
      filePath,
      fixtureOptions(directory),
    );
    const afterSecondRun = fileSafetySnapshot(filePath);

    assert.equal(second.ok, true);
    assert.equal(second.status, "no_change");
    assert.equal(second.replacementOccurred, false);
    assert.equal(second.canonicalContentPresent, true);
    assert.equal(second.durabilityConfirmation, "not_required");
    assert.deepEqual(afterSecondRun, beforeSecondRun);
    assertNoUpdateArtifacts(directory);
  });
});

test("the CLI main path reports post-rename state and exits deliberately after directory fsync failure", () => {
  withFixture((directory) => {
    const filePath = writeFixture(directory, legacySource());
    const canary = "cli-directory-fsync-provider-message-must-not-leak";
    let stdout = "";
    let stderr = "";
    const status = main(
      [process.execPath, validatorPath, "update-canonical", filePath],
      {
        stdout: {
          write(chunk) {
            stdout += String(chunk);
          },
        },
        stderr: {
          write(chunk) {
            stderr += String(chunk);
          },
        },
        updateOptions: fixtureOptions(directory, {
          syncDirectory() {
            throw new Error(canary);
          },
        }),
      },
    );

    assert.equal(status, 1);
    assert.equal(stderr, "");
    assert.match(
      stdout,
      /dotenv: directory_sync_failed_after_replacement/,
    );
    assert.match(
      stdout,
      /update status: replacement_completed_directory_sync_failed/,
    );
    assert.match(stdout, /replacement occurred: true/);
    assert.match(stdout, /canonical content present: true/);
    assert.match(
      stdout,
      /durability confirmation: failed_or_unknown/,
    );
    assert.equal(stdout.includes(canary), false);
    assert.equal(stdout.includes(legacySource().trimEnd()), false);
    assert.equal(stdout.includes(CANONICAL_PORTAL_RETURN_URL), false);
    assert.equal(readFileSync(filePath, "utf8"), canonicalSource());
    assert.equal(lstatSync(filePath).mode & 0o7777, 0o600);
    assertNoUpdateArtifacts(directory);
  });
});

test("an unexpected unrelated key prevents atomic rewriting and content loss", () => {
  withFixture((directory) => {
    const source = `${legacySource()}UNRELATED_KEY=preserve\n`;
    const filePath = writeFixture(directory, source);
    const before = lstatSync(filePath, {bigint: true});
    const result = updateDeploymentEnvToCanonical(
      filePath,
      fixtureOptions(directory),
    );
    const after = lstatSync(filePath, {bigint: true});

    assert.equal(result.ok, false);
    assert.ok(categories(result).includes("unexpected_parameter_name"));
    assert.equal(readFileSync(filePath, "utf8"), source);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeNs, before.mtimeNs);
    assertNoUpdateArtifacts(directory);
  });
});

test("CLI reporting contains only safe names and categories", () => {
  const functionsDirectory = path.resolve(__dirname, "..");
  const directory = mkdtempSync(
    path.join(functionsDirectory, ".env-validator-cli-test-"),
  );
  try {
    const canary = "canary-provider-value-never-print";
    const filePath = writeFixture(
      directory,
      `${PORTAL_RETURN_PARAMETER}=${canary}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [validatorPath, "validate", filePath],
      {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /deployment environment: fail/);
    assert.match(result.stdout, new RegExp(PORTAL_RETURN_PARAMETER));
    assert.match(result.stdout, /invalid_url/);
    assert.doesNotMatch(result.stdout, new RegExp(canary));
    assert.doesNotMatch(result.stdout, /https?:\/\//);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
