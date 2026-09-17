"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");

const projectId = "demo-coupon-app-device-proof-rules";
const rulesPath = path.resolve(__dirname, "../../firestore.rules");
const privateCollections = Object.freeze([
  "private_bitesaver_device_challenges",
  "private_bitesaver_device_installations",
]);

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {rules: fs.readFileSync(rulesPath, "utf8")},
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    for (const collection of privateCollections) {
      await context.firestore().doc(`${collection}/synthetic-private-record`)
        .set({schemaVersion: 1, state: "synthetic"});
    }
  });
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test("device-proof challenge and installation records deny every client and admin operation", async () => {
  const actors = [
    testEnv.unauthenticatedContext(),
    testEnv.authenticatedContext("customer-a", {
      email: "customer-a@example.com",
      email_verified: true,
    }),
    testEnv.authenticatedContext("admin-a", {
      admin: true,
      email: "admin-a@example.com",
      email_verified: true,
    }),
  ];
  for (const actor of actors) {
    const database = actor.firestore();
    for (const collection of privateCollections) {
      const existing = database.doc(`${collection}/synthetic-private-record`);
      const newDocument = database.doc(`${collection}/client-created-record`);
      await assertFails(existing.get());
      await assertFails(database.collection(collection).get());
      await assertFails(newDocument.set({schemaVersion: 1}));
      await assertFails(existing.update({state: "forged"}));
      await assertFails(existing.delete());
    }
  }
});
