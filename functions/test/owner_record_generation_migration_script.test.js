"use strict";

const assert = require("node:assert/strict");
const {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const scriptPath = path.resolve(
  __dirname,
  "../scripts/plan_owner_record_generation_migration.js",
);
const script = require(scriptPath);

const projectId = "synthetic-project-123";
const ownerUid = "synthetic-owner-uid";

async function withDirectory(callback) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "bitestar-owner-generation-script-test-"),
  );
  chmodSync(directory, 0o700);
  try {
    return await callback(directory);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

function cliArguments(directory, additions = []) {
  return [
    process.execPath,
    scriptPath,
    "--dry-run",
    "--project",
    projectId,
    "--expected-project",
    projectId,
    "--owner-uid",
    ownerUid,
    "--output",
    path.join(directory, "machine-plan.json"),
    "--summary",
    path.join(directory, "summary.json"),
    ...additions,
  ];
}

function syntheticPlan(overrides = {}) {
  return {
    schemaVersion: "bitestar.owner-record-generation-migration-plan.v1",
    projectId,
    generatedAt: "2026-08-12T18:00:00.000Z",
    plannerVersion: "bitestar.owner-record-generation-migration-planner.v1",
    sourceCheckpointCommit: "e84efab59abd04a26aae5447fe7a57eb06b27e81",
    planId: "1".repeat(64),
    planHash: "2".repeat(64),
    ownerUid,
    canonicalAccountPath: `restaurant_accounts/${ownerUid}`,
    classification: "legacy_safe_candidate",
    proposedGeneration: 0,
    operations: [
      {
        operation: "create_owner_state",
        documentPath: `private_owner_record_states/${ownerUid}`,
        ownerRecordGeneration: 0,
        existingGeneration: null,
        precondition: {kind: "must_not_exist"},
      },
    ],
    manualReviewReasons: [],
    pagination: [],
    ...overrides,
  };
}

function syntheticSummary(overrides = {}) {
  return {
    schemaVersion: "bitestar.owner-record-generation-migration-summary.v1",
    planCount: 1,
    classificationCounts: {
      already_initialized: 0,
      blocked_active_removal: 0,
      legacy_safe_candidate: 1,
      manual_review_required: 0,
      no_owner_data: 0,
    },
    operationCounts: {
      createOwnerStates: 1,
      firestoreDocuments: 0,
      storageObjects: 0,
    },
    manualReviewReasonCounts: [],
    incompletePaginationScopeCount: 0,
    ...overrides,
  };
}

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    stderr: {write(chunk) { stderr += String(chunk); }},
    stdout: {write(chunk) { stdout += String(chunk); }},
    text() { return {stderr, stdout}; },
  };
}

function quietOptions() {
  const captured = capture();
  return {
    captured,
    stderr: captured.stderr,
    stdout: captured.stdout,
  };
}

function runtimeFixture(options = {}) {
  const calls = {
    cleanup: 0,
    collect: [],
    plan: 0,
    summarize: 0,
  };
  return {
    calls,
    runtime: {
      async cleanup() {
        calls.cleanup += 1;
      },
      async collectInventory(input) {
        calls.collect.push({...input});
        return options.inventory ?? {ownerUid, records: []};
      },
      async planMigration() {
        calls.plan += 1;
        return options.plan ?? syntheticPlan();
      },
      async summarizePlan() {
        calls.summarize += 1;
        return options.summary ?? syntheticSummary();
      },
    },
  };
}

function outputArtifacts(directory) {
  return readdirSync(directory).filter((name) =>
    name.startsWith(".owner-generation-migration-"));
}

test("requiring the script does not initialize or load Firebase Admin", () => {
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `const before = new Set(Object.keys(require.cache));` +
        `require(${JSON.stringify(scriptPath)});` +
        `const added = Object.keys(require.cache).filter((value) => ` +
        `!before.has(value) && value.includes('firebase-admin'));` +
        `process.stdout.write(JSON.stringify(added));`,
    ],
    {encoding: "utf8"},
  );
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout), []);
});

test("argument parsing requires every exact dry-run safety flag", async () => {
  await withDirectory(async (directory) => {
    const valid = cliArguments(directory);
    const parsed = script.parseCliArguments(valid);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.projectId, projectId);
    assert.equal(parsed.expectedProjectId, projectId);
    assert.equal(parsed.ownerUid, ownerUid);
    assert.equal(parsed.overwriteExisting, false);

    for (const required of [
      "--dry-run",
      "--project",
      "--expected-project",
      "--owner-uid",
      "--output",
      "--summary",
    ]) {
      const index = valid.indexOf(required);
      const width = required === "--dry-run" ? 1 : 2;
      const invalid = [...valid];
      invalid.splice(index, width);
      assert.throws(
        () => script.parseCliArguments(invalid),
        (error) => error.code === "usage",
        required,
      );
    }

    for (const invalid of [
      [...valid, "unexpected"],
      [...valid, "--unknown"],
      [...valid, "--dry-run"],
      [...valid, "--project", projectId],
      valid.map((value) => value === "--dry-run" ? "--dry-run=true" : value),
    ]) {
      assert.throws(
        () => script.parseCliArguments(invalid),
        (error) => error.code === "usage",
      );
    }
  });
});

test("project, owner, and output identities fail closed without normalization", async () => {
  await withDirectory(async (directory) => {
    const base = cliArguments(directory);
    const replace = (flag, value) => {
      const result = [...base];
      result[result.indexOf(flag) + 1] = value;
      return result;
    };
    assert.throws(
      () => script.parseCliArguments(replace("--expected-project", "other-project-123")),
      (error) => error.code === "project_mismatch",
    );
    for (const invalid of ["Owner_Project", " leading-project", "short"]) {
      assert.throws(
        () => script.parseCliArguments(replace("--project", invalid)),
        (error) => error.code === "invalid_project",
      );
    }
    for (const invalid of ["", ".", "..", "bad/uid", "bad\nuid"]) {
      const arguments_ = replace("--owner-uid", invalid);
      assert.throws(
        () => script.parseCliArguments(arguments_),
        (error) => error.code === (invalid === "" ? "usage" : "invalid_owner"),
      );
    }
    assert.throws(
      () => script.parseCliArguments(replace("--output", "relative.json")),
      (error) => error.code === "unsafe_output_path",
    );
  });
});

test(
  "a synthetic dry run writes a mode-0600 pair and prints only its redacted summary",
  async () => {
    await withDirectory(async (directory) => {
      const captured = capture();
      const fixture = runtimeFixture();
      const status = await script.main(cliArguments(directory), {
        createRuntime: async () => fixture.runtime,
        stderr: captured.stderr,
        stdout: captured.stdout,
      });
      assert.equal(status, 0);
      assert.deepEqual(fixture.calls.collect, [{ownerUid, projectId}]);
      assert.equal(fixture.calls.plan, 1);
      assert.equal(fixture.calls.summarize, 1);
      assert.equal(fixture.calls.cleanup, 1);

      const planPath = path.join(directory, "machine-plan.json");
      const summaryPath = path.join(directory, "summary.json");
      assert.deepEqual(
        JSON.parse(readFileSync(planPath, "utf8")),
        syntheticPlan(),
      );
      assert.deepEqual(
        JSON.parse(readFileSync(summaryPath, "utf8")),
        syntheticSummary(),
      );
      assert.equal(lstatSync(planPath).mode & 0o7777, 0o600);
      assert.equal(lstatSync(summaryPath).mode & 0o7777, 0o600);
      assert.deepEqual(outputArtifacts(directory), []);

      const output = captured.text();
      assert.equal(output.stderr, "");
      assert.deepEqual(JSON.parse(output.stdout), syntheticSummary());
      assert.equal(output.stdout.includes(ownerUid), false);
      assert.equal(output.stdout.includes("restaurant_accounts/"), false);
      assert.equal(output.stdout.includes("bitesaver_restaurants/"), false);
    });
  },
);

test("manual review strict mode writes the complete artifacts and exits nonzero", async () => {
  await withDirectory(async (directory) => {
    const fixture = runtimeFixture({
      plan: syntheticPlan({
        classification: "manual_review_required",
        proposedGeneration: null,
        operations: [],
        manualReviewReasons: [{
          code: "record_generation_malformed",
          documentPath: `restaurant_accounts/${ownerUid}`,
          storageObjectName: null,
          existingGeneration: null,
        }],
      }),
      summary: {
        schemaVersion: "bitestar.owner-record-generation-migration-summary.v1",
        planCount: 1,
        classificationCounts: {
          already_initialized: 0,
          blocked_active_removal: 0,
          legacy_safe_candidate: 0,
          manual_review_required: 1,
          no_owner_data: 0,
        },
        operationCounts: {
          createOwnerStates: 0,
          firestoreDocuments: 0,
          storageObjects: 0,
        },
        manualReviewReasonCounts: [{
          code: "record_generation_malformed",
          count: 1,
        }],
        incompletePaginationScopeCount: 0,
      },
    });
    const status = await script.main(
      cliArguments(directory, ["--fail-on-manual-review"]),
      {createRuntime: async () => fixture.runtime, ...quietOptions()},
    );
    assert.equal(status, 3);
    assert.equal(existsSync(path.join(directory, "machine-plan.json")), true);
    assert.equal(existsSync(path.join(directory, "summary.json")), true);
  });
});

test("unsafe output preflight happens before runtime construction", async () => {
  await withDirectory(async (directory) => {
    const planPath = path.join(directory, "machine-plan.json");
    writeFileSync(planPath, "existing\n", {mode: 0o600});
    let runtimeCalls = 0;
    const captured = capture();
    const status = await script.main(cliArguments(directory), {
      createRuntime() {
        runtimeCalls += 1;
        throw new Error("must not run");
      },
      stderr: captured.stderr,
      stdout: captured.stdout,
    });
    assert.equal(status, 1);
    assert.equal(runtimeCalls, 0);
    assert.equal(readFileSync(planPath, "utf8"), "existing\n");
    assert.equal(captured.text().stderr, "owner-generation-migration: output_exists\n");
    assert.equal(captured.text().stdout, "");
  });
});

test("outputs inside the repository and aliases of one target are rejected", async () => {
  await withDirectory(async (directory) => {
    const parsed = script.parseCliArguments(cliArguments(directory));
    assert.throws(
      () => script.prepareOutputPair({
        ...parsed,
        outputPath: path.resolve(__dirname, "forbidden-plan.json"),
        summaryPath: path.resolve(__dirname, "forbidden-summary.json"),
      }),
      (error) => error.code === "output_inside_repository",
    );
    assert.throws(
      () => script.prepareOutputPair({
        ...parsed,
        summaryPath: parsed.outputPath,
      }),
      (error) => error.code === "unsafe_output_path",
    );
  });
});

test("existing outputs require the explicit flag and safe regular-file state", async () => {
  await withDirectory(async (directory) => {
    const planPath = path.join(directory, "machine-plan.json");
    const summaryPath = path.join(directory, "summary.json");
    writeFileSync(planPath, "old-plan\n", {mode: 0o600});
    writeFileSync(summaryPath, "old-summary\n", {mode: 0o600});

    const fixture = runtimeFixture();
    const status = await script.main(
      cliArguments(directory, ["--overwrite-existing"]),
      {createRuntime: async () => fixture.runtime, ...quietOptions()},
    );
    assert.equal(status, 0);
    assert.deepEqual(JSON.parse(readFileSync(planPath, "utf8")), syntheticPlan());
    assert.deepEqual(
      JSON.parse(readFileSync(summaryPath, "utf8")),
      syntheticSummary(),
    );
    assert.equal(lstatSync(planPath).mode & 0o7777, 0o600);
    assert.equal(lstatSync(summaryPath).mode & 0o7777, 0o600);
    assert.deepEqual(outputArtifacts(directory), []);
  });

  await withDirectory(async (directory) => {
    const planPath = path.join(directory, "machine-plan.json");
    const linkedTarget = path.join(directory, "linked-target.json");
    writeFileSync(linkedTarget, "unsafe\n", {mode: 0o600});
    symlinkSync(linkedTarget, planPath);
    let created = false;
    const status = await script.main(
      cliArguments(directory, ["--overwrite-existing"]),
      {createRuntime() { created = true; }, ...quietOptions()},
    );
    assert.equal(status, 1);
    assert.equal(created, false);
    assert.equal(readFileSync(linkedTarget, "utf8"), "unsafe\n");
  });
});

test("overwrite rejects unsafe modes and hard-linked targets before inventory", async () => {
  await withDirectory(async (directory) => {
    const planPath = path.join(directory, "machine-plan.json");
    writeFileSync(planPath, "unsafe mode\n", {mode: 0o644});
    chmodSync(planPath, 0o644);
    let runtimeCalls = 0;
    const status = await script.main(
      cliArguments(directory, ["--overwrite-existing"]),
      {
        createRuntime() {
          runtimeCalls += 1;
        },
        ...quietOptions(),
      },
    );
    assert.equal(status, 1);
    assert.equal(runtimeCalls, 0);
    assert.equal(readFileSync(planPath, "utf8"), "unsafe mode\n");
  });

  await withDirectory(async (directory) => {
    const planPath = path.join(directory, "machine-plan.json");
    const secondLink = path.join(directory, "second-link.json");
    writeFileSync(planPath, "hard linked\n", {mode: 0o600});
    linkSync(planPath, secondLink);
    let runtimeCalls = 0;
    const status = await script.main(
      cliArguments(directory, ["--overwrite-existing"]),
      {
        createRuntime() {
          runtimeCalls += 1;
        },
        ...quietOptions(),
      },
    );
    assert.equal(status, 1);
    assert.equal(runtimeCalls, 0);
    assert.equal(readFileSync(planPath, "utf8"), "hard linked\n");
    assert.equal(readFileSync(secondLink, "utf8"), "hard linked\n");
  });
});

test("a staging failure cleans both private temporary files", async () => {
  await withDirectory(async (directory) => {
    const fixture = runtimeFixture();
    const status = await script.main(cliArguments(directory), {
      createRuntime: async () => fixture.runtime,
      ...quietOptions(),
      outputOptions: {
        testHooks: {
          beforeSummaryWrite() {
            throw new Error("synthetic staging failure");
          },
        },
      },
    });
    assert.equal(status, 1);
    assert.equal(existsSync(path.join(directory, "machine-plan.json")), false);
    assert.equal(existsSync(path.join(directory, "summary.json")), false);
    assert.deepEqual(outputArtifacts(directory), []);
  });
});

test("a concurrent destination appearance is retained and fails no-clobber", async () => {
  await withDirectory(async (directory) => {
    const machinePath = path.join(directory, "machine-plan.json");
    const fixture = runtimeFixture();
    const status = await script.main(cliArguments(directory), {
      createRuntime: async () => fixture.runtime,
      ...quietOptions(),
      outputOptions: {
        testHooks: {
          beforeMachineCommit() {
            writeFileSync(machinePath, "concurrent file\n", {mode: 0o600});
          },
        },
      },
    });
    assert.equal(status, 1);
    assert.equal(readFileSync(machinePath, "utf8"), "concurrent file\n");
    assert.equal(existsSync(path.join(directory, "summary.json")), false);
    assert.deepEqual(outputArtifacts(directory), []);
  });
});

test("a second-commit failure removes a newly created partial pair", async () => {
  await withDirectory(async (directory) => {
    const captured = capture();
    const fixture = runtimeFixture();
    const status = await script.main(cliArguments(directory), {
      createRuntime: async () => fixture.runtime,
      outputOptions: {
        testHooks: {
          beforeSummaryCommit() {
            throw new Error("synthetic failure with sensitive-owner-canary");
          },
        },
      },
      stderr: captured.stderr,
      stdout: captured.stdout,
    });
    assert.equal(status, 1);
    assert.equal(existsSync(path.join(directory, "machine-plan.json")), false);
    assert.equal(existsSync(path.join(directory, "summary.json")), false);
    assert.deepEqual(outputArtifacts(directory), []);
    assert.equal(captured.text().stdout, "");
    assert.equal(
      captured.text().stderr,
      "owner-generation-migration: output_write_failed\n",
    );
    assert.equal(captured.text().stderr.includes("sensitive-owner-canary"), false);
  });
});

test("a failed overwrite restores both exact prior outputs and removes artifacts", async () => {
  await withDirectory(async (directory) => {
    const planPath = path.join(directory, "machine-plan.json");
    const summaryPath = path.join(directory, "summary.json");
    const oldPlan = Buffer.from("old machine bytes\n");
    const oldSummary = Buffer.from("old summary bytes\n");
    writeFileSync(planPath, oldPlan, {mode: 0o600});
    writeFileSync(summaryPath, oldSummary, {mode: 0o600});
    const fixture = runtimeFixture();

    const status = await script.main(
      cliArguments(directory, ["--overwrite-existing"]),
      {
        createRuntime: async () => fixture.runtime,
        ...quietOptions(),
        outputOptions: {
          testHooks: {
            beforeSummaryCommit() {
              throw new Error("fail after machine replacement");
            },
          },
        },
      },
    );
    assert.equal(status, 1);
    assert.deepEqual(readFileSync(planPath), oldPlan);
    assert.deepEqual(readFileSync(summaryPath), oldSummary);
    assert.equal(lstatSync(planPath).mode & 0o7777, 0o600);
    assert.equal(lstatSync(summaryPath).mode & 0o7777, 0o600);
    assert.deepEqual(outputArtifacts(directory), []);
  });
});

test("overwrite detects in-place target mutation after private backup", async () => {
  await withDirectory(async (directory) => {
    const planPath = path.join(directory, "machine-plan.json");
    const summaryPath = path.join(directory, "summary.json");
    writeFileSync(planPath, "old plan\n", {mode: 0o600});
    writeFileSync(summaryPath, "old summary\n", {mode: 0o600});
    const captured = capture();
    const fixture = runtimeFixture();
    const status = await script.main(
      cliArguments(directory, ["--overwrite-existing"]),
      {
        createRuntime: async () => fixture.runtime,
        stderr: captured.stderr,
        stdout: captured.stdout,
        outputOptions: {
          testHooks: {
            beforeMachineCommit() {
              writeFileSync(planPath, "concurrent change\n", {mode: 0o600});
            },
          },
        },
      },
    );
    assert.equal(status, 1);
    assert.equal(readFileSync(planPath, "utf8"), "concurrent change\n");
    assert.equal(readFileSync(summaryPath, "utf8"), "old summary\n");
    assert.deepEqual(outputArtifacts(directory), []);
    assert.equal(
      captured.text().stderr,
      "owner-generation-migration: output_changed\n",
    );
  });
});

test("a post-commit durability failure also rolls back the complete pair", async () => {
  await withDirectory(async (directory) => {
    const fixture = runtimeFixture();
    const status = await script.main(cliArguments(directory), {
      createRuntime: async () => fixture.runtime,
      ...quietOptions(),
      outputOptions: {
        testHooks: {
          beforeDirectoryFsync() {
            throw new Error("synthetic durability failure");
          },
        },
      },
    });
    assert.equal(status, 1);
    assert.equal(existsSync(path.join(directory, "machine-plan.json")), false);
    assert.equal(existsSync(path.join(directory, "summary.json")), false);
    assert.deepEqual(outputArtifacts(directory), []);
  });
});

test("backup cleanup failure retains both verified replacement outputs", async () => {
  await withDirectory(async (directory) => {
    const planPath = path.join(directory, "machine-plan.json");
    const summaryPath = path.join(directory, "summary.json");
    writeFileSync(planPath, "old plan\n", {mode: 0o600});
    writeFileSync(summaryPath, "old summary\n", {mode: 0o600});
    const fixture = runtimeFixture();
    const captured = capture();
    const status = await script.main(
      cliArguments(directory, ["--overwrite-existing"]),
      {
        createRuntime: async () => fixture.runtime,
        stderr: captured.stderr,
        stdout: captured.stdout,
        outputOptions: {
          testHooks: {
            beforeBackupCleanup({index}) {
              if (index === 1) {
                throw new Error("synthetic cleanup failure");
              }
            },
          },
        },
      },
    );
    assert.equal(status, 1);
    assert.deepEqual(JSON.parse(readFileSync(planPath, "utf8")), syntheticPlan());
    assert.deepEqual(
      JSON.parse(readFileSync(summaryPath, "utf8")),
      syntheticSummary(),
    );
    assert.deepEqual(outputArtifacts(directory), []);
    assert.equal(
      captured.text().stderr,
      "owner-generation-migration: output_cleanup_failed\n",
    );
  });
});

test("production runtime rejects ambient emulator routing before SDK use", () => {
  const names = [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_STORAGE_EMULATOR_HOST",
    "STORAGE_EMULATOR_HOST",
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) {
      for (const candidate of names) {
        delete process.env[candidate];
      }
      process.env[name] = "127.0.0.1:9999";
      assert.throws(
        () => script.productionRuntime({projectId}),
        (error) => error.code === "emulator_routing_forbidden",
        name,
      );
    }
  } finally {
    for (const name of names) {
      if (original[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original[name];
      }
    }
  }
});

test("summary leakage is rejected before either output becomes visible", async () => {
  await withDirectory(async (directory) => {
    const canaryEmail = "private-owner@example.invalid";
    const fixture = runtimeFixture({
      summary: {
        classificationCounts: {legacy_safe_candidate: 1},
        ownerUid,
        email: canaryEmail,
      },
    });
    const captured = capture();
    const status = await script.main(cliArguments(directory), {
      createRuntime: async () => fixture.runtime,
      stderr: captured.stderr,
      stdout: captured.stdout,
    });
    assert.equal(status, 1);
    assert.equal(existsSync(path.join(directory, "machine-plan.json")), false);
    assert.equal(existsSync(path.join(directory, "summary.json")), false);
    assert.equal(captured.text().stdout, "");
    assert.equal(captured.text().stderr, "owner-generation-migration: unsafe_summary\n");
    assert.equal(captured.text().stderr.includes(ownerUid), false);
    assert.equal(captured.text().stderr.includes(canaryEmail), false);
    assert.equal(fixture.calls.cleanup, 1);
  });
});

test("closed summary schema accepts short valid owners and rejects fragments", () => {
  assert.doesNotThrow(() => script.validateRedactedSummary(
    syntheticSummary(),
    syntheticPlan({ownerUid: "a"}),
  ));
  assert.throws(
    () => script.validateRedactedSummary(
      {...syntheticSummary(), label: "coupon_123"},
      syntheticPlan(),
    ),
    (error) => error.code === "unsafe_summary",
  );
});

test("a cross-owner, cross-project, or unknown-classification plan is rejected", async () => {
  await withDirectory(async (directory) => {
    for (const plan of [
      syntheticPlan({ownerUid: "different-owner"}),
      syntheticPlan({projectId: "different-project-123"}),
      syntheticPlan({classification: "unknown"}),
    ]) {
      const fixture = runtimeFixture({plan});
      const captured = capture();
      const status = await script.main(cliArguments(directory), {
        createRuntime: async () => fixture.runtime,
        stderr: captured.stderr,
        stdout: captured.stdout,
      });
      assert.equal(status, 1);
      assert.equal(captured.text().stdout, "");
      assert.equal(
        captured.text().stderr,
        "owner-generation-migration: invalid_plan\n",
      );
      assert.equal(existsSync(path.join(directory, "machine-plan.json")), false);
      assert.equal(existsSync(path.join(directory, "summary.json")), false);
    }
  });
});

test("runtime errors are redacted and cleanup still runs", async () => {
  await withDirectory(async (directory) => {
    const captured = capture();
    const fixture = runtimeFixture();
    fixture.runtime.collectInventory = async () => {
      throw new Error(
        `provider failed for ${ownerUid} at restaurant_accounts/${ownerUid}`,
      );
    };
    const status = await script.main(cliArguments(directory), {
      createRuntime: async () => fixture.runtime,
      stderr: captured.stderr,
      stdout: captured.stdout,
    });
    assert.equal(status, 1);
    assert.equal(captured.text().stdout, "");
    assert.equal(captured.text().stderr, "owner-generation-migration: planning_failed\n");
    assert.equal(captured.text().stderr.includes(ownerUid), false);
    assert.equal(fixture.calls.cleanup, 1);
    assert.equal(existsSync(path.join(directory, "machine-plan.json")), false);
    assert.equal(existsSync(path.join(directory, "summary.json")), false);
  });
});
