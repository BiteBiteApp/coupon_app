"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  customerBiteSaverMenuPageSize,
  parseCustomerBiteSaverMenuPageRequest,
} = require("../lib/customer_bitesaver_search_session.js");

const fixture = JSON.parse(fs.readFileSync(path.resolve(
  __dirname,
  "../../test/fixtures/customer_bitesaver_menu_page_v1.json",
), "utf8"));

function exactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

test("menu request fixture is accepted by the production server parser", () => {
  assert.deepEqual(
    parseCustomerBiteSaverMenuPageRequest(fixture.request),
    fixture.request,
  );
});

test("menu response fixture matches the closed allowlisted wire shape", () => {
  const response = fixture.response;
  exactKeys(response, [
    "schemaVersion",
    "state",
    "attemptGeneration",
    "queryFingerprint",
    "restaurantId",
    "menuStyle",
    "entries",
    "nextCursor",
    "hasMore",
  ]);
  assert.equal(response.schemaVersion, 1);
  assert.match(response.restaurantId, /^bsr_[A-Za-z0-9_-]{43}$/u);
  assert.match(response.queryFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(response.entries.length <= customerBiteSaverMenuPageSize, true);
  assert.equal(response.hasMore, response.nextCursor !== null);
  for (const entry of response.entries) {
    assert.match(entry.key, /^bsme_[A-Za-z0-9_-]{43}$/u);
    if (entry.kind === "image") {
      exactKeys(entry, ["kind", "key", "imageUrl", "sortOrder"]);
    } else if (entry.kind === "item") {
      exactKeys(entry, [
        "kind",
        "key",
        "name",
        "description",
        "price",
        "category",
        "sortOrder",
      ]);
    } else if (entry.kind === "section") {
      exactKeys(entry, ["kind", "key", "title", "body", "sortOrder"]);
    } else {
      assert.fail(`Unexpected menu entry kind: ${entry.kind}`);
    }
  }
  assert.equal(JSON.stringify(response).includes("private-canary"), false);
  assert.equal(JSON.stringify(response).includes("ownerUserId"), false);
  assert.equal(JSON.stringify(response).includes("sharedMenuId"), false);
});
