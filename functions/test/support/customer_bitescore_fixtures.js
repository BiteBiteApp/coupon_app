"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {createHash} = require("node:crypto");
const {GeoPoint} = require("firebase-admin/firestore");
const {OpaqueCursorCodec} = require("../../lib/opaque_cursor.js");
const contract = require("../../lib/customer_bitescore_search_contract.js");
const matcher = require("../../lib/customer_bitescore_search_matcher.js");
const {
  startCustomerBiteScoreSearchHandler: start,
  advanceCustomerBiteScoreSearchHandler: advance,
  getCustomerBiteScoreSearchPageHandler: page,
} = require("../../lib/customer_bitescore_search.js");
const {buildBiteScoreRestaurantIndex, buildBiteScoreDishIndex} = require("../../lib/search_index_builders.js");
const {canonicalRestaurantGeohash} = require("../../lib/restaurant_geo_helpers.js");

const nowMs = Date.parse("2026-09-19T12:00:00Z");
const date = new Date(nowMs);
function context(actorId = "customer-a", time = nowMs) {
  return {actorId, nowMs: time, cursorCodec: new OpaqueCursorCodec({key: Buffer.alloc(32, 37), clock: () => time})};
}
function compare(a, b) {
  if (a instanceof Uint8Array && b instanceof Uint8Array) return Buffer.compare(a, b);
  if (typeof a === "string" && typeof b === "string") return Buffer.compare(Buffer.from(a), Buffer.from(b));
  return a === b ? 0 : a < b ? -1 : 1;
}

class MemoryDatabase {
  constructor(entries = []) {
    this.documents = new Map(entries);
    this.queries = [];
    this.readBatches = [];
    this.maxWrites = 0;
    this.lock = Promise.resolve();
    this.beforeQuery = null;
  }
  stored(p) {
    const data = this.documents.get(p);
    return data === undefined ? null : {id: p.slice(p.lastIndexOf("/") + 1), path: p, data};
  }
  async getDocument(p) { return this.stored(p); }
  async getDocuments(paths) {
    this.readBatches.push([...paths]);
    return paths.map((p) => this.stored(p));
  }
  async queryDocuments(query) {
    this.queries.push(query);
    if (this.beforeQuery) await this.beforeQuery(query);
    const fields = (doc, field) => field === "__name__" ? doc.id : doc.data[field];
    let documents = [...this.documents.keys()].filter((p) =>
      p.startsWith(`${query.collectionPath}/`) && !p.slice(query.collectionPath.length + 1).includes("/"))
      .map((p) => this.stored(p));
    documents = documents.filter((d) => query.filters.every((filter) => {
      const value = fields(d, filter.field);
      const difference = compare(value, filter.value);
      return filter.operation === "==" ? difference === 0 : filter.operation === ">=" ? difference >= 0 :
        filter.operation === "<=" ? difference <= 0 : filter.operation === ">" ? difference > 0 : difference < 0;
    }));
    const tupleCompare = (a, b) => {
      for (let i = 0; i < query.orders.length; i++) {
        const c = compare(a[i], b[i]) * (query.orders[i].direction === "desc" ? -1 : 1);
        if (c) return c;
      }
      return 0;
    };
    const tuple = (d) => query.orders.map((o) => fields(d, o.field));
    documents.sort((a, b) => tupleCompare(tuple(a), tuple(b)));
    if (query.startAfter) documents = documents.filter((d) => tupleCompare(tuple(d), query.startAfter) > 0);
    return documents.slice(0, query.limit);
  }
  async runTransaction(operation) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolve) => { release = resolve; });
    await previous;
    const writes = [];
    const read = (p) => {
      assert.equal(writes.length, 0, "Firestore transaction reads must precede writes");
      return this.stored(p);
    };
    try {
      const result = await operation({
        getDocument: async (p) => read(p), getDocuments: async (p) => p.map(read),
        setDocument: (p, data) => writes.push({p, data}),
        createDocument: (p, data) => {assert.equal(this.documents.has(p), false); writes.push({p, data});},
        deleteDocument: (p) => writes.push({p, remove: true}),
      });
      this.maxWrites = Math.max(this.maxWrites, writes.length);
      for (const write of writes) if (write.remove) this.documents.delete(write.p); else this.documents.set(write.p, write.data);
      return result;
    } finally { release(); }
  }
  async commitWrites(writes) {
    for (const w of writes) w.type === "delete" ? this.documents.delete(w.path) : this.documents.set(w.path, w.data);
  }
}

function restaurant(id = "restaurant-a", overrides = {}) {
  const source = {id, name: "Cafe Alpha", normalizedName: "cafe alpha", streetAddress: "1 Main St", city: "Miami",
    state: "FL", zipCode: "33101", location: new GeoPoint(25.77, -80.19), isActive: true,
    active: true, isClaimed: false, restaurantWriteRevision: 0, ...overrides};
  source.geohash = canonicalRestaurantGeohash(source.location);
  return source;
}
function addRestaurant(db, id = "restaurant-a", overrides = {}) {
  const source = restaurant(id, overrides);
  const index = buildBiteScoreRestaurantIndex({sourceDocumentId: id, source, now: date});
  assert(index?.customerPublicProjection);
  db.documents.set(`bitescore_restaurants/${id}`, source);
  db.documents.set(contract.customerBiteScoreIndexPath("restaurant", id), index);
  return source;
}
function addDish(db, id, parent, overrides = {}, aggregateOverrides = {}) {
  const source = {id, restaurantId: parent.id, restaurantName: parent.name, name: "Burger", normalizedName: "burger",
    category: "Burgers", categoryTags: ["burger"], isActive: true, ...overrides};
  const aggregate = {dishId: id, restaurantId: parent.id, ratingCount: 10, overallBiteScore: 80,
    valueScoreAverage: 8, tastinessScoreAverage: 8, qualityScoreAverage: 8, overallImpressionAverage: 8,
    ...aggregateOverrides};
  const index = buildBiteScoreDishIndex({sourceDocumentId: id, dish: source,
    restaurantDocumentId: parent.id, restaurant: parent, aggregate, now: date});
  assert(index?.customerPublicProjection);
  db.documents.set(`bitescore_dishes/${id}`, source);
  db.documents.set(contract.customerBiteScoreIndexPath("dish", id), index);
  return {id, source, aggregate};
}
function request(criteria = {}, overrides = {}) {
  return {schemaVersion: 1, clientInstanceId: "home-instance", clientRequestId: "request-a", queryGeneration: 1,
    criteria: {kind: "dish", ...criteria}, ...overrides};
}
function continued(result, cursor = null) {
  return {schemaVersion: 1, sessionId: result.sessionId, queryFingerprint: result.queryFingerprint, cursor};
}
async function ready(db, req = request(), ctx = context()) {
  let state = await start(db, req, ctx);
  for (let i = 0; state.state === "preparing"; i++) {
    assert(i < 1000, "preparation must finish");
    state = await advance(db, continued(state), ctx);
  }
  assert.equal(state.state, "ready");
  return state;
}
async function allPages(db, state, ctx = context()) {
  const items = [];
  let cursor = null;
  do {
    const p = await page(db, continued(state, cursor), ctx);
    assert(p.items.length <= 25);
    items.push(...p.items);
    cursor = p.nextCursor;
  } while (cursor);
  return items;
}


module.exports = {MemoryDatabase, nowMs, date, context, restaurant, addRestaurant, addDish, request, continued, ready, allPages};
