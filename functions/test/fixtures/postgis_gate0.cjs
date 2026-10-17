"use strict";

// Deterministic synthetic inputs passed through the real projection builders.
// This module does no I/O and never writes a Firestore or PostgreSQL database.
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {GeoPoint} = require("firebase-admin/firestore");
const B = require("../../lib/search_index_builders.js");
const C = require("../../lib/search_index_contract.js");
const G = require("../../lib/restaurant_geo_helpers.js");

const now = new Date("2026-10-17T16:00:00.000Z");
const center = Object.freeze({latitude: 25.77, longitude: -80.19});
const identityKeyV1 = Buffer.alloc(32, 41); // Synthetic fixture key; never a production credential.
const privateCanary = "SYNTHETIC_PRIVATE_DATA_MUST_NOT_ENTER_SEARCH";
const nearTie = Object.freeze([
  {latitude: 25.782027835589467, longitude: -80.18109279801128},
  {latitude: 25.78119662525058, longitude: -80.17984403494802},
]);

function id(prefix, i) { return `${prefix}-${String(i).padStart(7, "0")}`; }
function location(i) {
  return {latitude: center.latitude + (i % 70) * 0.0001,
    longitude: center.longitude + (i % 3) * 0.0001};
}
function saverSource(i, overrides = {}) {
  const source = {
    restaurantName: `Synthetic Gate0 Diner ${String(i).padStart(7, "0")}`,
    streetAddress: `${i + 1} Synthetic Avenue`, city: "Miami", state: "FL", zipCode: "33101",
    ...location(i), approvalStatus: "approved", couponPostingEnabled: true,
    subscriptionStatus: "active", couponApplicationSubmitted: true,
    bio: "Synthetic local test restaurant", createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: now, offerCatalogUpdatedAt: now,
    email: privateCanary, stripeCustomerId: privateCanary, authToken: privateCanary,
    ...overrides,
  };
  source.geohash = G.canonicalRestaurantGeohash(source);
  return source;
}
function scoreSource(i, overrides = {}) {
  const point = location(i);
  const source = {name: `Synthetic Gate0 Catalog ${String(i).padStart(7, "0")}`,
    streetAddress: `${i + 1} Synthetic Street`, city: "Miami", state: "FL", zipCode: "33101",
    location: new GeoPoint(point.latitude, point.longitude), isActive: true, isClaimed: false,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: now,
    privateNotes: privateCanary, ...overrides};
  source.geohash = G.canonicalRestaurantGeohash(source.location);
  return source;
}
function couponSource(sourceDocumentId, i, overrides = {}) {
  return {id: sourceDocumentId, title: i % 2 ? "Synthetic save today" : "Synthetic noodle offer",
    restaurant: "Synthetic Gate0 Diner", details: "Disposable fixture; no redemption value.",
    isActive: true, usageRule: i % 2 ? "Once per customer" : "Unlimited",
    startTime: new Date(now.getTime() - 86_400_000),
    endTime: new Date(now.getTime() + 86_400_000), isProximityOnly: false,
    createdAt: new Date(now.getTime() - 100_000 + i), updatedAt: now, ...overrides};
}
function projection(collection, data) {
  assert(data, `real builder rejected synthetic ${collection} fixture`);
  assert(!JSON.stringify(data).includes(privateCanary), "private raw field leaked into projection");
  return {collection, id: data.indexDocumentId, data};
}
function saver(idValue, source) {
  return projection(C.restaurantSearchIndexCollection,
    B.buildBiteSaverRestaurantIndex({sourceDocumentId: idValue, source, now, identityKeyV1}));
}
function score(idValue, source) {
  return projection(C.restaurantSearchIndexCollection,
    B.buildBiteScoreRestaurantIndex({sourceDocumentId: idValue, source, now}));
}
function coupon(accountId, sourceDocumentId, restaurant, offer) {
  return projection(C.biteSaverOfferIndexCollection,
    B.buildBiteSaverCouponOfferIndex({restaurantAccountId: accountId, sourceDocumentId,
      restaurant, offer, now, identityKeyV1}));
}

function dataset({saverParents = 35, scoreParents = 35, offersPerRestaurant = 2,
  dishesPerRestaurant = 2, noOfferEvery = 7, includeCases = true} = {}) {
  for (const value of [saverParents, scoreParents, offersPerRestaurant, dishesPerRestaurant, noOfferEvery]) {
    assert(Number.isSafeInteger(value) && value >= 0, "bounded integer dimensions required");
  }
  assert(saverParents + scoreParents <= 10_000, "local fixture parent cap exceeded");
  assert(offersPerRestaurant <= 100 && dishesPerRestaurant <= 100, "local fixture child cap exceeded");
  const documents = [], sources = [], noOffers = [], eligibleSaver = [], scoreIds = [];
  for (let i = 0; i < saverParents; i++) {
    const parentId = id("gate0-saver", i), parent = saverSource(i);
    sources.push({path: `restaurant_accounts/${parentId}`, data: parent});
    documents.push(saver(parentId, parent));
    if (noOfferEvery && i % noOfferEvery === 0) { noOffers.push(parentId); continue; }
    if (offersPerRestaurant > 0) eligibleSaver.push(parentId);
    for (let j = 0; j < offersPerRestaurant; j++) {
      const offerId = id(`${parentId}-coupon`, j), offer = couponSource(offerId, j);
      sources.push({path: `restaurant_accounts/${parentId}/coupons/${offerId}`, data: offer});
      documents.push(coupon(parentId, offerId, parent, offer));
    }
  }
  for (let i = 0; i < scoreParents; i++) {
    const parentId = id("gate0-score", i), parent = scoreSource(i);
    scoreIds.push(parentId);
    sources.push({path: `bitescore_restaurants/${parentId}`, data: parent});
    documents.push(score(parentId, parent));
    for (let j = 0; j < dishesPerRestaurant; j++) {
      const dishId = id(`${parentId}-dish`, j);
      const dish = {id: dishId, restaurantId: parentId,
        name: j % 2 ? "Synthetic Hamburger" : "Synthetic Hoagie",
        category: "Sandwiches", subcategory: j % 2 ? "Hamburger" : "Submarine sandwich",
        categoryTags: ["Sandwiches"], isActive: true, createdAt: now, updatedAt: now};
      const aggregate = {dishId, restaurantId: parentId, overallBiteScore: 60 + i % 40,
        ratingCount: 2 + i, tastinessScoreAverage: 8, qualityScoreAverage: 8,
        valueScoreAverage: 7, overallImpressionAverage: 8, updatedAt: now};
      sources.push({path: `bitescore_dishes/${dishId}`, data: dish});
      documents.push(projection(C.dishSearchIndexCollection,
        B.buildBiteScoreDishIndex({sourceDocumentId: dishId, dish,
          restaurantDocumentId: parentId, restaurant: parent, aggregate, now})));
    }
  }
  const cases = {};
  if (includeCases) {
    const changingParentId = "gate0-changing-parent", changingParent = saverSource(1000);
    const changingOfferId = "gate0-same-offer", original = couponSource(changingOfferId, 0);
    const before = coupon(changingParentId, changingOfferId, changingParent, original);
    const after = coupon(changingParentId, changingOfferId, changingParent,
      {...original, title: "Synthetic edited same ID", updatedAt: new Date(now.getTime() + 1000)});
    documents.push(saver(changingParentId, changingParent), before);
    cases.changing = {parentId: changingParentId, offerId: changingOfferId, before, after};

    const hiddenId = "gate0-hidden-parent", hidden = saverSource(1001, {adminHidden: true});
    documents.push(saver(hiddenId, hidden), coupon(hiddenId, "gate0-hidden-offer", hidden,
      couponSource("gate0-hidden-offer", 0)));
    cases.hiddenParentId = hiddenId;

    const farId = "gate0-outside-radius", far = scoreSource(1002,
      {location: new GeoPoint(47.61, -122.33), city: "Seattle", state: "WA", zipCode: "98101"});
    documents.push(score(farId, far));
    cases.outsideRadiusId = farId;

    const sharedId = "gate0-same-raw-id";
    const sharedSaver = saver(sharedId, saverSource(1003));
    const sharedScore = score(sharedId, scoreSource(1003));
    documents.push(sharedSaver, sharedScore);
    cases.identityIsolation = {sourceId: sharedId, saver: sharedSaver.id, score: sharedScore.id};

    cases.nearTie = nearTie.map((point, i) => {
      const sourceId = `gate0-near-tie-${i}`;
      const document = score(sourceId, scoreSource(1004 + i,
        {name: i ? "Synthetic A exact tie" : "Synthetic Z exact tie",
          location: new GeoPoint(point.latitude, point.longitude)}));
      documents.push(document);
      return {sourceId, point, exactDistanceMiles: G.exactCustomerBiteSaverDistanceMiles(center, point)};
    });

    const specialId = "gate0-special", specialParentId = "gate0-special-parent";
    const specialParent = saverSource(1006);
    const special = {id: specialId, restaurantId: specialParentId, ownerUid: specialParentId,
      title: "Synthetic Saturday Plate", details: "Synthetic daily special", isActive: true,
      availabilityMode: "specificDays", daysOfWeek: [6], allDay: true, hideWhenUnavailable: true,
      createdAt: now, updatedAt: now};
    documents.push(saver(specialParentId, specialParent), projection(C.biteSaverOfferIndexCollection,
      B.buildBiteSaverDailySpecialOfferIndex({restaurantAccountId: specialParentId,
        sourceDocumentId: specialId, restaurant: specialParent, offer: special, now})));
    cases.dailySpecial = {parentId: specialParentId, offerId: specialId};
  }
  const counts = {};
  for (const document of documents) {
    const key = `${document.data.source}:${document.data.entityType}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(documents)).digest("hex");
  return {now, center, identityKeyV1, documents, sources, cases,
    expected: {noOfferParentIds: noOffers, eligibleSaverParentIds: eligibleSaver,
      scoreRestaurantIds: scoreIds, aliasQuery: "submarine", spellingQuery: "hambuger",
      radiusMiles: 15, laterPageSize: 25},
    manifest: {syntheticOnly: true, generator: "postgis_gate0.v1", counts,
      documentCount: documents.length, sourceCount: sources.length, fingerprint,
      dimensions: {saverParents, scoreParents, offersPerRestaurant, dishesPerRestaurant, noOfferEvery}}};
}

module.exports = {now, center, nearTie, identityKeyV1, privateCanary, dataset,
  saverSource, scoreSource, couponSource, saver, score, coupon};
