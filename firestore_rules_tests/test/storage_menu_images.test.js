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


test("real deletion acceptance revokes both owner menu grants atomically and preserves B", async () => {
  const functionsRequire=require('node:module').createRequire(path.resolve(__dirname,'../../functions/package.json'));
  const {initializeApp,deleteApp}=functionsRequire('firebase-admin/app');
  const {getFirestore}=functionsRequire('firebase-admin/firestore');
  const {requestAccountDeletionHandler}=require('../../functions/lib/account_deletion_service');
  const {createFirestoreMenuImageUploadAuthorizationDatabase}=require('../../functions/lib/menu_image_upload_authorization');
  const app=initializeApp({projectId},'storage-deletion-fixture');
  try {
    const db=getFirestore(app), now=Date.now();
    const shared=await seedSharedGrant();
    await seedOwnGrant({id:'bsmia_'+ 'c'.repeat(43),ownerUserId:'owner-b',sourceId:'owner-b'});
    await assertSucceeds(upload('owner',objectPath));
    await assertSucceeds(upload('owner',shared,{contentType:'image/png'}));
    const accept=()=>requestAccountDeletionHandler(db,{schemaVersion:1,expectedUid:'owner-a',confirmation:'DELETE',receipt:'r'.repeat(43)},
      {uid:'owner-a',authTime:Math.floor(now/1000),issuedAt:Math.floor(now/1000),signInProvider:'password'},
      {uid:'owner-a',creationTime:new Date(now-100000).toUTCString(),providerIds:['password'],disabled:false},now);
    const issuer=createFirestoreMenuImageUploadAuthorizationDatabase(db);
    await Promise.allSettled([accept(),issuer.createAuthorization('bsmia_'+ 'd'.repeat(43),{schemaVersion:1,state:'active',ownerUserId:'owner-a',sourceType:'biteSaver',sourceId:'owner-a',fileName:'image.jpg'},'owner-a')]);
    await accept();
    const active=await db.collection('private_menu_image_upload_authorizations').where('ownerUserId','==','owner-a').where('state','==','active').get();
    require('node:assert/strict').equal(active.size,0);
    await assertFails(upload('owner',objectPath));
    await assertFails(upload('claimAdmin',objectPath));
    await assertFails(upload('claimAdmin',shared,{contentType:'image/png'}));
    const bPath='public_menu_images/bsmia_'+ 'c'.repeat(43)+'/image.jpg';
    await assertSucceeds(upload('otherOwner',bPath));
    await db.doc('private_account_deletions/claim-admin').set({state:'requested'});
    await assertFails(upload('claimAdmin',bPath));
    await assertSucceeds(upload('otherOwner',bPath));
  } finally { await deleteApp(app); }
});

test("retired deletion grant remains private and can never authorize owner or Admin uploads", async () => {
  const id = `bsmia_${require('node:crypto').randomBytes(32).toString('base64url')}`;
  await seedOwnGrant({id, grantOverrides: {state: 'retired', deletionOperationId: 'a'.repeat(64)}});
  for (const actor of ['owner', 'claimAdmin', 'emailAdmin']) {
    await assertFails(upload(actor, `public_menu_images/${id}/image.jpg`));
    await assertFails(actors[actor].firestore().doc(`private_menu_image_upload_authorizations/${id}`).get());
    await assertFails(actors[actor].firestore().doc(`private_menu_image_upload_authorizations/${id}`).update({state: 'active'}));
  }
});
