const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const firebase = require("firebase/compat/app");
require("firebase/compat/firestore");
require("firebase/compat/storage");

const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");

const projectId = "demo-coupon-app-rules";
const firestoreRulesPath = path.resolve(__dirname, "../../firestore.rules");
const storageRulesPath = path.resolve(__dirname, "../../storage.rules");
const authorizationId = `bsmia_${"a".repeat(43)}`;
const secondAuthorizationId = `bsmia_${"b".repeat(43)}`;
const objectPath = `public_menu_images/${authorizationId}/image.jpg`;

let testEnv;
let actors;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {rules: fs.readFileSync(firestoreRulesPath, "utf8")},
    storage: {rules: fs.readFileSync(storageRulesPath, "utf8")},
  });
  actors = {
    unauthenticated: testEnv.unauthenticatedContext(),
    owner: testEnv.authenticatedContext("owner-a", {
      email: "owner-a@example.test",
      email_verified: true,
      firebase: {sign_in_provider: "password"},
    }),
    otherOwner: testEnv.authenticatedContext("owner-b", {
      email: "owner-b@example.test",
      email_verified: true,
      firebase: {sign_in_provider: "password"},
    }),
    anonymousOwner: testEnv.authenticatedContext("owner-a", {
      firebase: {sign_in_provider: "anonymous"},
    }),
    claimAdmin: testEnv.authenticatedContext("claim-admin", {
      admin: true,
      email: "claim-admin@example.test",
      firebase: {sign_in_provider: "password"},
    }),
    emailAdmin: testEnv.authenticatedContext("email-admin", {
      email: "schuyler.cole@gmail.com",
      firebase: {sign_in_provider: "password"},
    }),
  };
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seedOwnGrant();
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

function storageFor(actorName) {
  return actors[actorName].storage();
}

function upload(actorName, targetPath = objectPath, {
  bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
  contentType = "image/jpeg",
  customMetadata,
} = {}) {
  return storageFor(actorName).ref(targetPath).put(bytes, {
    contentType,
    ...(customMetadata === undefined ? {} : {customMetadata}),
  });
}

async function seedOwnGrant({
  id = authorizationId,
  ownerUserId = "owner-a",
  sourceId = "owner-a",
  fileName = "image.jpg",
  grantOverrides = {},
} = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`restaurant_accounts/${sourceId}`).set({
      approvalStatus: "approved",
      couponPostingEnabled: true,
    });
    await db.doc(`private_menu_image_upload_authorizations/${id}`).set({
      schemaVersion: 1,
      state: "active",
      ownerUserId,
      sourceType: "biteSaver",
      sourceId,
      fileName,
      createdAt: new Date("2026-09-15T12:00:00.000Z"),
      ...grantOverrides,
    });
  });
}

async function seedSharedGrant({
  id = secondAuthorizationId,
  menuId = "shared-menu-private",
  ownerUserId = "owner-a",
} = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`restaurant_menus/${menuId}`).set({createdByUserId: ownerUserId});
    await db.doc(`private_menu_image_upload_authorizations/${id}`).set({
      schemaVersion: 1,
      state: "active",
      ownerUserId,
      sourceType: "sharedMenu",
      sourceId: menuId,
      fileName: "image.png",
      createdAt: new Date("2026-09-15T12:00:00.000Z"),
    });
  });
  return `public_menu_images/${id}/image.png`;
}

test("current own-menu owner can create, update, delete, and serve publicly", async () => {
  await assertSucceeds(upload("owner"));
  await assertSucceeds(
    storageFor("unauthenticated").ref(objectPath).getMetadata(),
  );
  await assertSucceeds(upload("owner", objectPath, {
    bytes: Uint8Array.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
  }));
  await assertSucceeds(storageFor("owner").ref(objectPath).delete());
});

test("path possession does not authorize unrelated, anonymous, or signed-out writes", async () => {
  await assertFails(upload("otherOwner"));
  await assertFails(upload("anonymousOwner"));
  await assertFails(upload("unauthenticated"));
  await assertFails(upload("owner", objectPath.replace(authorizationId, `bsmia_${"z".repeat(43)}`)));
  await assertFails(upload("owner", `public_menu_images/${authorizationId}/image.png`, {
    contentType: "image/png",
  }));
});

test("claim and allowlisted-email admins retain create and delete authority", async () => {
  for (const actorName of ["claimAdmin", "emailAdmin"]) {
    await assertSucceeds(upload(actorName));
    await assertSucceeds(storageFor(actorName).ref(objectPath).delete());
  }
});

test("own and shared ownership are revalidated for every mutation", async () => {
  await assertSucceeds(upload("owner"));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("restaurant_accounts/owner-a").update({
      couponPostingEnabled: false,
    });
  });
  await assertFails(upload("owner"));
  await assertFails(storageFor("owner").ref(objectPath).delete());
  await assertSucceeds(storageFor("claimAdmin").ref(objectPath).delete());

  const sharedPath = await seedSharedGrant();
  await assertSucceeds(upload("owner", sharedPath, {contentType: "image/png"}));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("restaurant_menus/shared-menu-private").update({
      createdByUserId: "owner-b",
    });
  });
  await assertFails(upload("owner", sharedPath, {contentType: "image/png"}));
  await assertFails(upload("otherOwner", sharedPath, {contentType: "image/png"}));
  await assertSucceeds(storageFor("emailAdmin").ref(sharedPath).delete());
});

test("new path enforces exact grant schema, type, size, and empty custom metadata", async () => {
  await assertFails(upload("owner", objectPath, {contentType: "application/pdf"}));
  await assertFails(upload("owner", objectPath, {
    bytes: new Uint8Array(5 * 1024 * 1024 + 1),
  }));
  await assertFails(upload("owner", objectPath, {
    customMetadata: {sourceId: "owner-a"},
  }));

  await seedOwnGrant({
    id: secondAuthorizationId,
    grantOverrides: {unexpected: true},
  });
  await assertFails(upload(
    "owner",
    `public_menu_images/${secondAuthorizationId}/image.jpg`,
  ));
});

test("private upload grants remain unreadable through client Firestore rules", async () => {
  for (const actorName of ["unauthenticated", "owner", "claimAdmin"]) {
    await assertFails(
      actors[actorName].firestore()
        .doc(`private_menu_image_upload_authorizations/${authorizationId}`)
        .get(),
    );
  }
});
