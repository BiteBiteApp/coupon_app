"use strict";
const assert = require("node:assert/strict");
const {GeoPoint} = require("firebase-admin/firestore");
const {OpaqueCursorCodec} = require("../../lib/opaque_cursor.js");
const {buildBiteScoreRestaurantIndex, buildBiteScoreDishIndex} = require("../../lib/search_index_builders.js");
const {canonicalRestaurantGeohash} = require("../../lib/restaurant_geo_helpers.js");
class MemoryFirestore {
  values = new Map(); limits = []; queue = Promise.resolve();
  doc(path) { return {path, id: path.split('/').pop(), get: async () => this.snap(path), set: async (data) => this.values.set(path, data)}; }
  snap(path) { const value = this.values.get(path); return {id: path.split('/').pop(), ref: this.doc(path), exists: value !== undefined, data: () => value}; }
  async getAll(...refs) { return refs.map((ref) => this.snap(ref.path)); }
  collection(path) {
    const db = this; const filters = []; const orders = []; let after; let inclusive=false; let limit;
    const compare = (a, b) => {for (const [key, dir] of orders) {const av = key === '__name__' ? a.id : a.data()[key], bv = key === '__name__' ? b.id : b.data()[key]; const result = Buffer.isBuffer(av) ? Buffer.compare(av,bv) : av === bv ? 0 : av < bv ? -1 : 1; if(result) return result * (dir === 'desc' ? -1 : 1);} return 0;};
    const query = {where(k, op, v) {assert.equal(op, '=='); filters.push([k,v]); return query;}, orderBy(k, dir='asc') {orders.push([typeof k === 'string' ? k : '__name__',dir]); return query;}, startAfter(v) {after=v; return query;}, startAt(v) {after=v;inclusive=true;return query;}, limit(v) {limit=v; db.limits.push(v); return query;}, async get() {
      assert.ok(limit > 0 && limit <= 26, 'query must be bounded');
      let docs = [...db.values.keys()].filter((p) => p.startsWith(path + '/') && p.slice(path.length+1).indexOf('/') < 0).map((p) => db.snap(p));
      docs = docs.filter((d) => filters.every(([k,v]) => d.data()[k] === v)).sort(compare);
      if (after) docs = docs.filter((d) => typeof after === 'string' ? d.id > after : compare(d, after) >= (inclusive ? 0 : 1));
      docs = docs.slice(0, limit); return {docs, empty: docs.length === 0};
    }}; return query;
  }
  runTransaction(fn) {
    const op = this.queue.then(async () => { const writes=[]; const result = await fn({getAll: (...refs) => this.getAll(...refs), get: (ref) => ref.get(), set: (ref,data) => writes.push(() => this.values.set(ref.path,data)), update:(ref,data) => writes.push(() => this.values.set(ref.path,{...this.values.get(ref.path),...data})), delete: (ref) => writes.push(() => this.values.delete(ref.path))}); writes.forEach((w) => w()); return result;});
    this.queue = op.catch(() => {}); return op;
  }
}
function fixture() {
  const db = new MemoryFirestore();
  const coordinates={latitude:29.187,longitude:-82.14};
  const restaurant={name:"Restaurant", streetAddress:"1 Main St", city:"Ocala",state:"FL",zipCode:"34470",location:new GeoPoint(coordinates.latitude,coordinates.longitude),geohash:canonicalRestaurantGeohash(coordinates),isActive:true,isClaimed:false,ownerUserId:'owner'};
  const dish={name:'Dish',restaurantId:'restaurant',isActive:true};
  const ri=buildBiteScoreRestaurantIndex({sourceDocumentId:'restaurant',source:restaurant,now:new Date()});
  const di=buildBiteScoreDishIndex({sourceDocumentId:'dish',dish,restaurantDocumentId:'restaurant',restaurant,aggregate:{overallBiteScore:80,ratingCount:1},now:new Date()});
  db.values.set('restaurant_search_index/'+ri.indexDocumentId,ri);
  db.values.set('dish_search_index/'+di.indexDocumentId,di);
  db.values.set('bitescore_restaurants/restaurant',restaurant);
  db.values.set('bitescore_dishes/dish',dish);
  const context={actorId:'guest:one',cursorCodec:new OpaqueCursorCodec({key:Buffer.alloc(32,1)})};
  return {db,context};
}

module.exports = {MemoryFirestore, fixture};
