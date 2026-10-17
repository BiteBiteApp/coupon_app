"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {Timestamp} = require("firebase-admin/firestore");
const S = require("../lib/postgis_source.js");
const F = require("../lib/postgis_source_firestore.js");
const R = require("../lib/postgis_source_recovery.js");
const B = require("../lib/search_index_builders.js");
const {createSearchIndexDocumentId} = require("../lib/search_index_contract.js");
const {dartUtf16FirestoreBytesOrderKey} = require("../lib/customer_bitesaver_search_matcher.js");
const {canonicalRestaurantGeohash} = require("../lib/restaurant_geo_helpers.js");

test("canonical source digests ignore key insertion order and reject non-JSON values", () => {
  assert.equal(S.postgisSourceDigest({b: [2, 3], a: 1}), S.postgisSourceDigest({a: 1, b: [2, 3]}));
  assert.throws(() => S.postgisSourceDigest({a: NaN}), /Invalid/);
  assert.throws(() => S.postgisSourceDigest({a: undefined}), /Invalid/);
  const digest = S.postgisSourceDigest({id: "a"});
  assert.equal(S.postgisXorDigest(S.postgisXorDigest(S.postgisZeroDigest, digest), digest), S.postgisZeroDigest);
});

test("BiteSaver export keeps timestamp precision and internal/public identities while excluding private fields", () => {
  const id = "si_test";
  const value = {source: "biteSaver", entityType: "offer", indexDocumentId: id,
    sourceDocumentId: "offer", sourceFingerprint: "f".repeat(64), offerType: "coupon",
    publicRestaurantId: "bsr_public", publicOfferId: "bso_public",
    restaurantAccountId: dartUtf16FirestoreBytesOrderKey("owner-😀"),
    sourceCreatedAt: new Timestamp(123, 456789123), startAt: new Date(1000),
    sourceCreatedAtOrderKey: "v1:062135596923:456789123", ownerEmail: "NEVER_EXPORT",
    stripeAccount: "NEVER_EXPORT", usageHistory: ["NEVER_EXPORT"]};
  const encoded = S.encodePostgisProjection("bitesaver_offer_index", id, value);
  assert(!JSON.stringify(encoded).includes("NEVER_EXPORT"));
  const decoded = S.decodePostgisProjection(encoded);
  assert(decoded.sourceCreatedAt.isEqual(value.sourceCreatedAt));
  assert(decoded.startAt.isEqual(Timestamp.fromDate(value.startAt)));
  assert.deepEqual(decoded.restaurantAccountId, value.restaurantAccountId);
  assert.equal(decoded.publicOfferId, value.publicOfferId);
  assert.equal(decoded.sourceCreatedAtOrderKey, value.sourceCreatedAtOrderKey);
});

test("BiteScore export preserves native public wrapper and strips admin/unknown nested fields", () => {
  const row = B.buildBiteScoreRestaurantIndex({sourceDocumentId: "score-one", now: new Date(),
    source: {name: "Public", streetAddress: "1 Synthetic Street", city: "Miami", state: "FL",
      zipCode: "33101", latitude: 25.77, longitude: -80.19,
      geohash: canonicalRestaurantGeohash({latitude: 25.77, longitude: -80.19}), isActive: true}});
  const changed = {...row, ownerEmail: "NEVER_EXPORT",
    customerPublicProjection: {...row.customerPublicProjection, privateCanary: "NEVER_EXPORT"}};
  const exported = S.decodePostgisProjection(S.encodePostgisProjection("restaurant_search_index", row.indexDocumentId, changed));
  assert(!JSON.stringify(exported).includes("NEVER_EXPORT"));
  assert.equal(exported.searchIndexVersion, row.searchIndexVersion);
  assert.equal(exported.customerPublicProjection.displayName, "Public");
  assert.equal(exported.customerPublicProjection.sourceDocumentId, "score-one");
  assert.equal(exported.adminDirectoryVisible, undefined);
  assert.equal(S.encodePostgisProjection("restaurant_search_index", row.indexDocumentId,
    {...row, customerPublicProjection: null}), null);
  assert.equal(S.encodePostgisProjection("dish_search_index", row.indexDocumentId, row), null);
});

test("same textual source IDs remain separate across source sides and offers are parent scoped", () => {
  const saver = createSearchIndexDocumentId({entityKind: "restaurant", sourceKind: "biteSaverRestaurant", sourceDocumentId: "same"});
  const score = createSearchIndexDocumentId({entityKind: "restaurant", sourceKind: "biteScoreRestaurant", sourceDocumentId: "same"});
  const offerA = createSearchIndexDocumentId({entityKind: "offer", sourceKind: "biteSaverCoupon", sourceDocumentId: "same", parentSourceDocumentId: "a"});
  const offerB = createSearchIndexDocumentId({entityKind: "offer", sourceKind: "biteSaverCoupon", sourceDocumentId: "same", parentSourceDocumentId: "b"});
  assert.equal(new Set([saver, score, offerA, offerB]).size, 4);
  assert.notEqual(S.postgisSourceIdentity("restaurant_search_index", saver), S.postgisSourceIdentity("restaurant_search_index", score));
});

test("finite source event validation detects poisoned payloads, invalid order and manifest tombstones", () => {
  const payload = {collection: "restaurant_search_index", indexDocumentId: "row", projection: {displayName: "One"}};
  const shard = S.postgisSourceShardFor(payload.collection, payload.indexDocumentId);
  const first = {shard, seq: 1, payload, digest: S.postgisSourceDigest(payload)};
  S.validatePostgisSourceEvent(first);
  assert.throws(() => S.validatePostgisSourceEvent({...first, payload: {...payload, projection: {displayName: "poison"}}}), /poison/);
  assert.throws(() => S.validatePostgisSourceEvent({...first, seq: 0}), /Invalid/);
  const deleted = {...payload, projection: null};
  const manifest = S.postgisSourceManifest([first, {shard, seq: 2, payload: deleted, digest: S.postgisSourceDigest(deleted)}]);
  assert.deepEqual(manifest.restaurant_search_index, {count: 0, xor: S.postgisZeroDigest});
});

test("nonproduction source guard rejects production and a mismatched actual Firestore project", () => {
  for (const config of [
    {epoch: "one", projectId: "coupon-app-29446", allowedProjectIds: ["coupon-app-29446"]},
    {epoch: "one", projectId: "demo-one", allowedProjectIds: []},
    {epoch: "one", projectId: "demo-one", allowedProjectIds: ["demo-one", "coupon-app-29446"]},
  ]) assert.throws(() => F.createFirestorePostgisSource({projectId: config.projectId}, config), /nonproduction/);
  assert.throws(() => F.createFirestorePostgisSource({projectId: "coupon-app-29446"}, {
    epoch: "one", projectId: "demo-one", allowedProjectIds: ["demo-one"],
  }), /nonproduction/);
});

test("recovery snapshot validation streams strict identity order and verifies the complete fenced manifest", async () => {
  const rows = Array.from({length: 503}, (_, index) => {
    const payload = {collection: "restaurant_search_index", indexDocumentId: `id${String(index).padStart(4, "0")}`,
      projection: {source: "biteScore", displayName: "Synthetic"}};
    return {payload, digest: S.postgisSourceDigest(payload)};
  });
  const shards = Array.from({length: 16}, S.emptyPostgisSourceShard);
  for (const row of rows) {
    const shard = S.postgisSourceShardFor(row.payload.collection, row.payload.indexDocumentId);
    const previous = shards[shard].partitions.restaurant_search_index;
    shards[shard] = {seq: shards[shard].seq + 1, partitions: {...shards[shard].partitions,
      restaurant_search_index: {count: previous.count + 1, xor: S.postgisXorDigest(previous.xor, row.digest)}}};
  }
  const fence = {protocolVersion: S.postgisSourceVersion, epoch: "test", enrolled: true, shards};
  const manifest = R.createPostgisRecoveryManifest("snapshot", fence, rows);
  const calls = [];
  const reader = {
    async readRecoveryManifest() {return manifest;},
    async readRecoveryRows(_id, after, limit) {calls.push(limit); return rows.filter((row) => after === null || R.postgisRecoveryIdentity(row) > after).slice(0, limit);},
  };
  await R.validatePostgisRecoverySnapshot(reader, manifest);
  assert.deepEqual(calls, [500, 500]);
  await assert.rejects(R.validatePostgisRecoverySnapshot({...reader, async readRecoveryRows() {return [];}}, manifest), /incomplete/);
  await assert.rejects(R.validatePostgisRecoverySnapshot({...reader, async readRecoveryManifest() {return null;}}, manifest), /unavailable/);
  await assert.rejects(R.validatePostgisRecoverySnapshot({...reader, async readRecoveryRows() {return [rows[0], rows[0]];}}, manifest), /duplicate/);
  const wrong = R.createPostgisRecoveryManifest("snapshot", {...fence, shards: Array.from({length: 16}, S.emptyPostgisSourceShard)}, rows);
  await assert.rejects(R.validatePostgisRecoverySnapshot({...reader, async readRecoveryManifest() {return wrong;}}, wrong), /published source manifest/);
});
