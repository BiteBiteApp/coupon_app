"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {MemoryDatabase, context, nowMs} = require("./support/customer_bitescore_fixtures.js");
const {customerBiteScoreDigest: digest} = require("../lib/customer_bitescore_search_contract.js");
const {pageCustomerBiteScoreMenuWithDatabase: page, customerBiteScoreMenuCategoryOrder: categoryOrder,
  reconcileCustomerBiteScoreMenuGeneration: reconcile} = require("../lib/customer_bitescore_menu_search.js");
const root = "restaurant_menus/menu-a";
function source(style = "biteScore") { return {root, style, fingerprint: "menu-source-a", privateIds: ["private-owner", "menu-a"]}; }
function initial(overrides = {}) { return {schemaVersion: 1, restaurantId: "restaurant-a", clientInstanceId: "menu-instance",
  clientRequestId: "menu-request-a", queryGeneration: 1, ...overrides}; }
function request(state, cursor = null) {
  return {...initial(), sessionId: state.sessionId, queryFingerprint: state.queryFingerprint, cursor};
}
async function ready(db, input = initial(), resolved = source(), ctx = context()) {
  let state = await page(db, input, ctx, async () => resolved);
  let requests = 1;
  while (state.state === "preparing") {
    assert(++requests < 500);
    state = await page(db, request(state), ctx, async () => resolved);
  }
  assert(["available", "absent"].includes(state.state));
  return state;
}
async function all(db, state, resolved = source(), ctx = context()) {
  const entries = [...state.entries];
  let cursor = state.nextCursor;
  while (cursor) {
    const next = await page(db, request(state, cursor), ctx, async () => resolved);
    entries.push(...next.entries);
    cursor = next.nextCursor;
  }
  return entries;
}
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function expectedKey(id, kind, resolved = source(), ctx = context()) {
  const actor = digest("bitestar.customer-bitescore-menu-search.v1", "actor", ctx.actorId);
  return `bscm_${digest("bitestar.customer-bitescore-menu-search.v1", actor, resolved.fingerprint, kind, id)}`;
}

for (const style of ["biteScore", "biteSaver"]) {
  test(`${style} menu globally ranks 113 mixed entries by established category/display order before paging`, async () => {
    const db = new MemoryDatabase();
    const resolved = source(style);
    const rows = [];
    const categories = [...categoryOrder[style], "Zebra", "Apple", "\ue000", "\u{10000}"];
    for (let i = 0; i < 113; i++) {
      const kind = i % 5 === 0 ? "menu_images" : i % 5 === 1 ? "menu_sections" : "menu_items";
      const id = `row-${113 - i}`;
      const data = kind === "menu_images" ? {imageUrl: `https://cdn.example.test/public-menu/${i}.jpg`, sortOrder: i % 4} :
        kind === "menu_items" ? {name: `Name ${i % 3}`, category: categories[i % categories.length], sortOrder: i % 4, description: "Description", price: "$10"} :
        {title: `Title ${i % 3}`, body: "A section", sortOrder: i % 4};
      db.documents.set(`${root}/${kind}/${id}`, data);
      rows.push({id, kind, data});
    }
    const kindIndex = {menu_images: 0, menu_items: 1, menu_sections: 2};
    const categoryIndex = (row) => {
      const index = categoryOrder[style].indexOf(row.data.category);
      return index < 0 ? categoryOrder[style].length : index;
    };
    rows.sort((a, b) => kindIndex[a.kind] - kindIndex[b.kind] ||
      (a.kind === "menu_items" ? categoryIndex(a) - categoryIndex(b) ||
        (categoryIndex(a) === categoryOrder[style].length ? cmp(a.data.category, b.data.category) : 0) : 0) ||
      a.data.sortOrder - b.data.sortOrder || cmp(a.data.name ?? a.data.title ?? "", b.data.name ?? b.data.title ?? "") || cmp(a.id, b.id));
    const state = await ready(db, initial(), resolved);
    const items = await all(db, state, resolved);
    assert.equal(state.entries.length, 25);
    assert.equal(items.length, rows.length);
    assert.deepEqual(items.map((v) => v.key), rows.map((v) => expectedKey(v.id, v.kind, resolved)));
    assert.deepEqual((await page(db, request(state), context(), async () => resolved)).entries, state.entries);
    assert(db.queries.every((q) => q.limit <= 26));
    assert(db.readBatches.every((p) => p.length <= 25));
    assert(db.maxWrites <= 27);
  });
}

test("menu pages preserve full UTF16 identity ties and expose only presentation fields", async () => {
  const db = new MemoryDatabase();
  const ids = ["same-A", "same-a", "\ue000", "\u{10000}", "x".repeat(1500)];
  for (const id of ids) db.documents.set(`${root}/menu_items/${id}`, {name: "Same", category: "Lunch", sortOrder: 1,
    price: "$3", description: "Safe", ownerUserId: "private-owner", storagePath: "private-storage", secret: "private-secret"});
  const state = await ready(db);
  assert.deepEqual(state.entries.map((v) => v.key), [...ids].sort().map((id) => expectedKey(id, "menu_items")));
  for (const item of state.entries) assert.deepEqual(Object.keys(item).sort(), ["category", "description", "key", "kind", "name", "price", "sortOrder"]);
  assert(!JSON.stringify(state.entries).includes("private-"));
});

test("empty or absent menus finish without unbounded scans, and unsafe private image URLs never appear", async () => {
  const db = new MemoryDatabase();
  const absent = await ready(db, initial(), {...source(), root: null});
  assert.equal(absent.state, "absent");
  assert.equal(db.queries.length, 0);
  db.documents.set(`${root}/menu_images/secret`, {sortOrder: 0, imageUrl: "https://cdn.example.test/private-owner/photo.jpg"});
  const empty = await ready(db);
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.nextCursor, null);
  assert.equal(db.queries.filter((v) => v.collectionPath.startsWith(root)).length, 3);
});

test("source mutation during menu preparation restarts, new first items appear globally, duplicate triggers are no-ops", async () => {
  const db = new MemoryDatabase();
  for (let i = 0; i < 40; i++) db.documents.set(`${root}/menu_items/item-${i}`, {name: "Dish", category: "Lunch", sortOrder: 5});
  let state = await page(db, initial(), context(), async () => source()); // image phase
  state = await page(db, request(state), context(), async () => source()); // first25items
  db.documents.set(`${root}/menu_items/a-new-best`, {name: "First", category: "Breakfast", sortOrder: 0});
  await Promise.all([reconcile(db, root, "menu_items", "a-new-best"), reconcile(db, root, "menu_items", "a-new-best")]);
  const generations = [...db.documents].filter(([path, v]) => path.startsWith("private_bitescore_menu_generations/") && Number.isInteger(v.generation)).map(([, value]) => value);
  assert.equal(generations.length, 1);
  assert.equal(generations[0].generation, 1);
  state = await ready(db, request(state));
  const items = await all(db, state);
  assert.equal(items.length, 41);
  assert.equal(items[0].name, "First");
  const last = await page(db, request(state, state.nextCursor), context(), async () => source());
  assert(last.entries.length > 0);
  db.documents.delete(`${root}/menu_items/a-new-best`);
  await Promise.all([reconcile(db, root, "menu_items", "a-new-best"), reconcile(db, root, "menu_items", "a-new-best")]);
  assert.equal([...db.documents].find(([path, v]) => path.startsWith("private_bitescore_menu_generations/") && Number.isInteger(v.generation))[1].generation, 2);
  assert.equal((await page(db, request(state), context(), async () => source())).entries.some((v) => v.name === "First"), false);
});

test("menu actor, criteria generation, parent binding, session cursor and expiry all fence stale access", async () => {
  const db = new MemoryDatabase();
  for (let i = 0; i < 30; i++) db.documents.set(`${root}/menu_items/item-${i}`, {name: "Dish", category: "Lunch", sortOrder: i});
  const first = await ready(db);
  await assert.rejects(page(db, request(first), context("other"), async () => source()));
  await assert.rejects(page(db, {...request(first), restaurantId: "other-restaurant"}, context(), async () => source()));
  await assert.rejects(page(db, request(first), context(), async () => ({...source(), fingerprint: "changed-binding"})));
  await assert.rejects(page(db, request(first), context("customer-a", nowMs + 15 * 60000), async () => source()));
  const next = await ready(db, initial({clientInstanceId: "another-menu-instance", clientRequestId: "second-menu"}));
  await assert.rejects(page(db, request(next, first.nextCursor), context(), async () => source()));
  await ready(db, initial({queryGeneration: 2, clientRequestId: "new-menu"}));
  await assert.rejects(page(db, request(first), context(), async () => source()));
});
