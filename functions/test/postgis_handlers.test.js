"use strict";
// Native handler/authority integration with an injected membership provider.
// These tests deliberately do not claim PostgreSQL execution.
const test = require("node:test");
const assert = require("node:assert/strict");
const {createPostgisSearchHandlers} = require("../lib/postgis_handlers.js");
const {postgisSearchBindingPath} = require("../lib/postgis_search_binding.js");
const {buildResults, getCustomerBiteScoreSearchPageHandler: legacyPage,
  startCustomerBiteScoreSearchHandler: legacyStart,
  advanceCustomerBiteScoreSearchHandler: nativeAdvance} = require("../lib/customer_bitescore_search.js");
const C = require("../lib/customer_bitescore_search_contract.js");
const F = require("./support/customer_bitescore_fixtures.js");

function setup(options = {}) {
  const database = new F.MemoryDatabase();
  const pins = [], queries = [];
  const provider = {
    async pinRevision(input) {
      pins.push({...input});
      if (options.pin) return options.pin(input);
      return {revision: "31"};
    },
    async queryResults(input) {
      queries.push(input);
      if (options.query) return options.query(input);
      const collection = input.session.criteria.kind === "dish" ? "dish_search_index/" : "restaurant_search_index/";
      const source = [...database.documents.keys()].filter(path => path.startsWith(collection)).map(path => database.stored(path));
      const results = await buildResults(database, input.session, source);
      const projected = new F.MemoryDatabase(results.map(result => {
        const id = C.customerBiteScoreDigest("result", input.session.sessionId, input.session.attempt, result.sourceId);
        return [`${C.customerBiteScoreResultCollection}/${id}`, result];
      }));
      return projected.queryDocuments(input.query);
    },
  };
  return {database, pins, queries, provider, api: createPostgisSearchHandlers({database, provider})};
}

test("candidate Score returns native pages, stable cursors, and isolated source identities", async () => {
  const {database, api, pins, queries} = setup();
  const parent = F.addRestaurant(database);
  for (let index = 0; index < 30; index++) F.addDish(database, `dish-${index.toString().padStart(2, "0")}`, parent);
  const state = await api.startCustomerBiteScoreSearchV2(F.request(), F.context());
  assert.equal(state.state, "ready");
  assert.equal(pins.length, 1);
  const first = await api.getCustomerBiteScoreSearchPageV2(F.continued(state), F.context());
  assert.equal(first.items.length, 25);
  assert.equal(first.hasMore, true);
  const second = await api.getCustomerBiteScoreSearchPageV2(F.continued(state, first.nextCursor), F.context());
  assert.equal(second.items.length, 5);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.sourceDocumentId)).size, 30);
  assert.ok(queries.every(query => query.query.limit <= 26 && query.revision === "31"));
  assert.equal([...database.documents.values()].filter(row => row.sessionId === state.sessionId && row.sourceId).length, 30);
  await assert.rejects(legacyPage(database, F.continued(state), F.context()), /unavailable/);
  await assert.rejects(legacyStart(database, F.request(), F.context()), /unavailable/);
  const before = queries.length;
  await assert.rejects(api.getCustomerBiteScoreSearchPageV2(F.continued(state), F.context("different-user")), /unavailable/);
  assert.equal(queries.length, before);
});

test("candidate Finder uses the existing eight-result contract and exact-first ranking", async () => {
  const {database, api} = setup();
  for (let index = 0; index < 20; index++) F.addRestaurant(database, `cafe-${index}`, {name: `Alpha ${index}`});
  F.addRestaurant(database, "exact", {name: "Alpha"});
  const state = await api.startCustomerBiteScoreSearchV2(F.request({kind: "restaurant", text: "Alpha",
    finder: {state: "FL", location: "Miami", mode: "suggestions"}}), F.context());
  const page = await api.getCustomerBiteScoreSearchPageV2(F.continued(state), F.context());
  assert.equal(page.items.length, 8);
  assert.equal(page.items[0].sourceDocumentId, "exact");
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
});

test("candidate Score admission is durable and failed pins keep the original deadline", async () => {
  let failure = true;
  const {database, api, pins} = setup({pin: async () => {
    if (failure) throw new Error("interrupted SQL pin");
    return {revision: "41"};
  }});
  await assert.rejects(api.startCustomerBiteScoreSearchV2(F.request(), F.context()), /interrupted SQL pin/);
  const session = [...database.documents.values()].find(value => value.clientRequestId === "request-a");
  assert.equal(session.state, "preparing");
  assert.equal(database.documents.get(postgisSearchBindingPath(session.sessionId)).state, "preparing");
  const waiting = await nativeAdvance(database, F.continued(session), {...F.context(), searchBackend: "postgis"});
  assert.equal(waiting.state, "preparing");
  assert.equal(database.queries.length, 0, "pending candidate admission never starts legacy scanning");
  failure = false;
  const advanced = await api.advanceCustomerBiteScoreSearchV2(F.continued(session), F.context());
  assert.equal(advanced.state, "ready");
  const resumed = await api.startCustomerBiteScoreSearchV2(F.request(), F.context("customer-a", F.nowMs + 1000));
  assert.equal(resumed.state, "ready");
  assert.equal(resumed.sessionId, session.sessionId);
  assert.deepEqual(pins[0], pins[1]);
  assert.equal(pins[0].expiresAtMs, session.absoluteExpiresAtMs);
  await api.startCustomerBiteScoreSearchV2(F.request(), F.context("customer-a", F.nowMs + 2000));
  assert.equal(pins.length, 2);
});

test("candidate query failure is an error, never a successful empty page", async () => {
  const {api} = setup({query: async () => { throw new Error("candidate query timed out"); }});
  const state = await api.startCustomerBiteScoreSearchV2(F.request(), F.context());
  await assert.rejects(api.getCustomerBiteScoreSearchPageV2(F.continued(state), F.context()), /candidate query timed out/);
});

test("candidate session expiry and account replacement precede SQL membership work", async () => {
  const {api, queries} = setup();
  const state = await api.startCustomerBiteScoreSearchV2(F.request(), F.context());
  await assert.rejects(api.getCustomerBiteScoreSearchPageV2(F.continued(state),
    F.context("customer-a", F.nowMs + C.customerBiteScoreSessionLifetimeMs)), /unavailable/);
  await api.startCustomerBiteScoreSearchV2(F.request({}, {queryGeneration: 2, clientRequestId: "replacement"}), F.context());
  await assert.rejects(api.getCustomerBiteScoreSearchPageV2(F.continued(state), F.context()), /unavailable/);
  assert.equal(queries.length, 0);
});
