"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  issueMenuImageUploadAuthorizationHandler,
  menuImageUploadAuthorizationSchemaVersion,
  privateMenuImageUploadAuthorizationCollection,
} = require("../lib/menu_image_upload_authorization.js");

class MemoryAuthorizationDatabase {
  constructor(entries = []) {
    this.documents = new Map(entries);
    this.creates = [];
    this.failures = [];
  }

  async getDocument(path) {
    const data = this.documents.get(path);
    return data === undefined ? null : {id: path.split("/").at(-1), data};
  }

  async createAuthorization(authorizationId, grant) {
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    this.creates.push({authorizationId, grant});
  }
}

function callableRequest(data, {
  uid = "owner-private-canary",
  email = "owner@example.test",
  token = {},
} = {}) {
  return {
    data,
    auth: {
      uid,
      token: {
        email,
        email_verified: true,
        firebase: {sign_in_provider: "password"},
        ...token,
      },
    },
  };
}

function requestData(overrides = {}) {
  return {
    schemaVersion: menuImageUploadAuthorizationSchemaVersion,
    sourceType: "biteSaver",
    sourceId: "owner-private-canary",
    fileExtension: "jpg",
    ...overrides,
  };
}

function approvedAccount() {
  return {approvalStatus: "approved", couponPostingEnabled: true};
}

function assertHttpsCode(code) {
  return (error) => error?.code === code;
}

test("own authorization keeps source identity only in the private grant", async () => {
  const sourceId = "owner-private-canary";
  const database = new MemoryAuthorizationDatabase([
    [`restaurant_accounts/${sourceId}`, approvedAccount()],
  ]);
  const response = await issueMenuImageUploadAuthorizationHandler(
    callableRequest(requestData()),
    {database, randomSource: (size) => Buffer.alloc(size, 0x41)},
  );

  assert.deepEqual(response, {
    schemaVersion: 1,
    objectPath:
      `public_menu_images/bsmia_${Buffer.alloc(32, 0x41).toString("base64url")}` +
      "/image.jpg",
  });
  assert.equal(JSON.stringify(response).includes(sourceId), false);
  assert.equal(database.creates.length, 1);
  assert.deepEqual(database.creates[0].grant, {
    schemaVersion: 1,
    state: "active",
    ownerUserId: sourceId,
    sourceType: "biteSaver",
    sourceId,
    fileName: "image.jpg",
  });
});

test("shared authorization resolves and preserves the authoritative owner", async () => {
  const sourceId = "shared-private-canary";
  const ownerUserId = "shared-owner-private-canary";
  const database = new MemoryAuthorizationDatabase([
    [`restaurant_menus/${sourceId}`, {createdByUserId: ownerUserId}],
  ]);
  const response = await issueMenuImageUploadAuthorizationHandler(
    callableRequest(requestData({
      sourceType: "sharedMenu",
      sourceId,
      fileExtension: "webp",
    }), {uid: ownerUserId}),
    {database, randomSource: (size) => Buffer.alloc(size, 0x42)},
  );

  assert.match(
    response.objectPath,
    /^public_menu_images\/bsmia_[A-Za-z0-9_-]{43}\/image\.webp$/u,
  );
  assert.equal(JSON.stringify(response).includes(sourceId), false);
  assert.deepEqual(database.creates[0].grant, {
    schemaVersion: 1,
    state: "active",
    ownerUserId,
    sourceType: "sharedMenu",
    sourceId,
    fileName: "image.webp",
  });
});

test("claim and allowlisted-email admins retain menu upload authority", async () => {
  for (const auth of [
    {uid: "claim-admin", token: {admin: true}},
    {uid: "email-admin", email: "schuyler.cole@gmail.com"},
  ]) {
    const database = new MemoryAuthorizationDatabase([
      ["restaurant_menus/admin-managed-menu", {createdByUserId: "owner-a"}],
    ]);
    await issueMenuImageUploadAuthorizationHandler(
      callableRequest(requestData({
        sourceType: "sharedMenu",
        sourceId: "admin-managed-menu",
        fileExtension: "png",
      }), auth),
      {database, randomSource: (size) => Buffer.alloc(size, 0x43)},
    );
    assert.equal(database.creates.length, 1);
    assert.equal(database.creates[0].grant.ownerUserId, "owner-a");
  }
});

test("authorization rejects missing, stale, or unrelated source authority", async () => {
  const cases = [
    {
      database: new MemoryAuthorizationDatabase(),
      request: callableRequest(requestData()),
    },
    {
      database: new MemoryAuthorizationDatabase([
        ["restaurant_accounts/owner-private-canary", {
          approvalStatus: "approved",
          couponPostingEnabled: false,
        }],
      ]),
      request: callableRequest(requestData()),
    },
    {
      database: new MemoryAuthorizationDatabase([
        ["restaurant_accounts/other-owner", approvedAccount()],
      ]),
      request: callableRequest(requestData({sourceId: "other-owner"})),
    },
    {
      database: new MemoryAuthorizationDatabase([
        ["restaurant_menus/shared-menu", {createdByUserId: "other-owner"}],
      ]),
      request: callableRequest(requestData({
        sourceType: "sharedMenu",
        sourceId: "shared-menu",
      })),
    },
  ];
  for (const fixture of cases) {
    await assert.rejects(
      issueMenuImageUploadAuthorizationHandler(
        fixture.request,
        {database: fixture.database},
      ),
      assertHttpsCode("permission-denied"),
    );
    assert.equal(fixture.database.creates.length, 0);
  }
});

test("authorization requires a nonanonymous exact closed request", async () => {
  const database = new MemoryAuthorizationDatabase([
    ["restaurant_accounts/owner-private-canary", approvedAccount()],
  ]);
  await assert.rejects(
    issueMenuImageUploadAuthorizationHandler(
      callableRequest(requestData(), {
        token: {firebase: {sign_in_provider: "anonymous"}},
      }),
      {database},
    ),
    assertHttpsCode("unauthenticated"),
  );

  for (const invalid of [
    {...requestData(), extra: true},
    requestData({schemaVersion: 2}),
    requestData({sourceType: "legacy"}),
    requestData({sourceId: "owner/private"}),
    requestData({sourceId: " owner-private-canary"}),
    requestData({fileExtension: "jpeg"}),
  ]) {
    await assert.rejects(
      issueMenuImageUploadAuthorizationHandler(
        callableRequest(invalid),
        {database},
      ),
      assertHttpsCode("invalid-argument"),
    );
  }
});

test("authorization retries bounded random-ID collisions", async () => {
  const database = new MemoryAuthorizationDatabase([
    ["restaurant_accounts/owner-private-canary", approvedAccount()],
  ]);
  database.failures.push({code: "already-exists"});
  let entropy = 0x51;
  const response = await issueMenuImageUploadAuthorizationHandler(
    callableRequest(requestData()),
    {database, randomSource: (size) => Buffer.alloc(size, entropy++)},
  );
  assert.equal(database.creates.length, 1);
  assert.equal(
    response.objectPath.includes(Buffer.alloc(32, 0x52).toString("base64url")),
    true,
  );
});

test("private authorization collection is not encoded in the public path", () => {
  assert.equal(
    "public_menu_images".includes(privateMenuImageUploadAuthorizationCollection),
    false,
  );
});
