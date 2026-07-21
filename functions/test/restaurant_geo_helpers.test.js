const assert = require("node:assert/strict");
const test = require("node:test");
const { GeoPoint } = require("firebase-admin/firestore");

const {
  canonicalRestaurantGeohash,
  decideRestaurantGeohashWrite,
  exactRestaurantDistanceKilometers,
  extractBiteSaverRestaurantCoordinates,
  extractBiteScoreRestaurantCoordinates,
  KILOMETERS_PER_MILE,
  MAX_RESTAURANT_SEARCH_RADIUS_KM,
  restaurantGeographicQueryBounds,
  restaurantGeohashPrecision,
  restaurantSourceDocumentKey,
  validRestaurantCoordinates,
} = require("../lib/restaurant_geo_helpers.js");

const canonicalFixtures = [
  {
    name: "Googleplex",
    latitude: 37.4219999,
    longitude: -122.0840575,
    geohash: "9q9hvumngq",
  },
  {
    name: "London",
    latitude: 51.5074,
    longitude: -0.1278,
    geohash: "gcpvj0duq5",
  },
  {
    name: "Sydney",
    latitude: -33.8688,
    longitude: 151.2093,
    geohash: "r3gx2f77bn",
  },
  {
    name: "Near zero northeast",
    latitude: 0.0001,
    longitude: -0.0001,
    geohash: "ebpbpbpbtd",
  },
  {
    name: "Near zero southwest",
    latitude: -0.0001,
    longitude: 0.0001,
    geohash: "kpbpbpbp6m",
  },
  {
    name: "Positive inclusive boundary",
    latitude: 90,
    longitude: 180,
    geohash: "zzzzzzzzzz",
  },
  {
    name: "Negative inclusive boundary",
    latitude: -90,
    longitude: -180,
    geohash: "0000000000",
  },
];

test("known coordinates use the canonical 10-character geohash contract", () => {
  assert.equal(restaurantGeohashPrecision, 10);
  for (const fixture of canonicalFixtures) {
    assert.equal(
      canonicalRestaurantGeohash(fixture),
      fixture.geohash,
      fixture.name,
    );
    assert.match(fixture.geohash, /^[0-9bcdefghjkmnpqrstuvwxyz]{10}$/);
  }
});

test("coordinate validation rejects missing, malformed, and nonfinite values", () => {
  assert.equal(validRestaurantCoordinates(undefined, -82), null);
  assert.equal(validRestaurantCoordinates(28, undefined), null);
  assert.equal(validRestaurantCoordinates("28", -82), null);
  assert.equal(validRestaurantCoordinates(28, "-82"), null);
  assert.equal(validRestaurantCoordinates(Number.NaN, -82), null);
  assert.equal(validRestaurantCoordinates(28, Number.POSITIVE_INFINITY), null);
});

test("coordinate validation rejects out-of-range values and restaurant zero", () => {
  assert.equal(validRestaurantCoordinates(-90.01, -82), null);
  assert.equal(validRestaurantCoordinates(90.01, -82), null);
  assert.equal(validRestaurantCoordinates(28, -180.01), null);
  assert.equal(validRestaurantCoordinates(28, 180.01), null);
  assert.equal(validRestaurantCoordinates(0, 0), null);
  assert.deepEqual(validRestaurantCoordinates(0.0001, -0.0001), {
    latitude: 0.0001,
    longitude: -0.0001,
  });
  assert.deepEqual(validRestaurantCoordinates(90, 180), {
    latitude: 90,
    longitude: 180,
  });
  assert.deepEqual(validRestaurantCoordinates(-90, -180), {
    latitude: -90,
    longitude: -180,
  });
});

test("BiteScore extraction accepts real GeoPoints in field priority order", () => {
  const location = new GeoPoint(28.8517, -82.487);
  const geoPoint = new GeoPoint(29.1872, -82.1401);
  assert.deepEqual(
    extractBiteScoreRestaurantCoordinates({
      location,
      geoPoint,
      latitude: 30,
      longitude: -83,
      lat: 31,
      lng: -84,
    }),
    { latitude: location.latitude, longitude: location.longitude },
  );

  assert.deepEqual(
    extractBiteScoreRestaurantCoordinates({
      location: { latitude: 1, longitude: 2 },
      geoPoint,
    }),
    { latitude: geoPoint.latitude, longitude: geoPoint.longitude },
  );
});

test("BiteScore extraction accepts compatible GeoPoints across identities", () => {
  const compatibleGeoPoint = {
    latitude: 28.8517,
    longitude: -82.487,
    isEqual: () => false,
  };
  assert.equal(compatibleGeoPoint instanceof GeoPoint, false);
  assert.deepEqual(
    extractBiteScoreRestaurantCoordinates({ location: compatibleGeoPoint }),
    { latitude: 28.8517, longitude: -82.487 },
  );
});

test("plain coordinate maps are not treated as GeoPoints", () => {
  assert.equal(
    extractBiteScoreRestaurantCoordinates({
      location: { latitude: 1, longitude: 2 },
    }),
    null,
  );
  assert.equal(
    extractBiteScoreRestaurantCoordinates({
      location: { lat: 1, lng: 2, isEqual: () => false },
    }),
    null,
  );
  assert.deepEqual(
    extractBiteScoreRestaurantCoordinates({
      location: { latitude: 1, longitude: 2 },
      latitude: 28.8517,
      longitude: -82.487,
    }),
    { latitude: 28.8517, longitude: -82.487 },
  );
});

test("BiteScore extraction falls back through numeric compatibility fields", () => {
  assert.deepEqual(
    extractBiteScoreRestaurantCoordinates({
      latitude: 28.8517,
      longitude: -82.487,
      lat: 29.1872,
      lng: -82.1401,
    }),
    { latitude: 28.8517, longitude: -82.487 },
  );
  assert.deepEqual(
    extractBiteScoreRestaurantCoordinates({ lat: 29.1872, lng: -82.1401 }),
    { latitude: 29.1872, longitude: -82.1401 },
  );
});

test("BiteSaver extraction accepts only actual numeric coordinate fields", () => {
  assert.deepEqual(
    extractBiteSaverRestaurantCoordinates({
      latitude: 28.8517,
      longitude: -82.487,
    }),
    { latitude: 28.8517, longitude: -82.487 },
  );
  assert.equal(
    extractBiteSaverRestaurantCoordinates({
      location: new GeoPoint(28.8517, -82.487),
    }),
    null,
  );
  assert.equal(
    extractBiteSaverRestaurantCoordinates({
      latitude: "28.8517",
      longitude: "-82.487",
    }),
    null,
  );
});

test("matching geohashes result in no trusted write", () => {
  const data = {
    latitude: 37.4219999,
    longitude: -122.0840575,
    geohash: "9q9hvumngq",
  };
  assert.deepEqual(
    decideRestaurantGeohashWrite(
      data,
      extractBiteSaverRestaurantCoordinates,
    ),
    { type: "none" },
  );
});

test("valid coordinate changes set the canonical geohash without looping", () => {
  const data = {
    latitude: 51.5074,
    longitude: -0.1278,
    geohash: "old-hash",
  };
  const decision = decideRestaurantGeohashWrite(
    data,
    extractBiteSaverRestaurantCoordinates,
  );
  assert.deepEqual(decision, { type: "set", geohash: "gcpvj0duq5" });
  assert.deepEqual(
    decideRestaurantGeohashWrite(
      { ...data, geohash: decision.geohash },
      extractBiteSaverRestaurantCoordinates,
    ),
    { type: "none" },
  );
});

test("removed or invalid coordinates remove only a stale geohash", () => {
  assert.deepEqual(
    decideRestaurantGeohashWrite(
      { latitude: null, longitude: null, geohash: "stale" },
      extractBiteSaverRestaurantCoordinates,
    ),
    { type: "delete" },
  );
  assert.deepEqual(
    decideRestaurantGeohashWrite(
      { latitude: null, longitude: null },
      extractBiteSaverRestaurantCoordinates,
    ),
    { type: "none" },
  );
  assert.deepEqual(
    decideRestaurantGeohashWrite(
      null,
      extractBiteSaverRestaurantCoordinates,
    ),
    { type: "none" },
  );
});

test("invalid compatible GeoPoints do not preserve stale geohashes", () => {
  for (const location of [
    { latitude: Number.POSITIVE_INFINITY, longitude: -82, isEqual: () => false },
    { latitude: 91, longitude: -82, isEqual: () => false },
    { latitude: 0, longitude: 0, isEqual: () => false },
  ]) {
    assert.deepEqual(
      decideRestaurantGeohashWrite(
        { location, geohash: "stale" },
        extractBiteScoreRestaurantCoordinates,
      ),
      { type: "delete" },
    );
  }
});

test("compatible GeoPoints with matching geohashes produce no write", () => {
  assert.deepEqual(
    decideRestaurantGeohashWrite(
      {
        location: {
          latitude: 37.4219999,
          longitude: -122.0840575,
          isEqual: () => false,
        },
        geohash: "9q9hvumngq",
      },
      extractBiteScoreRestaurantCoordinates,
    ),
    { type: "none" },
  );
});

test("exact distance returns a reasonable known Haversine distance", () => {
  const kilometers = exactRestaurantDistanceKilometers(
    { latitude: 1, longitude: 0 },
    { latitude: 1, longitude: 1 },
  );
  assert.ok(kilometers > 110 && kilometers < 112);
});

test("geographic query bounds are deterministic and bounded", () => {
  const center = { latitude: 28.8517, longitude: -82.487 };
  const first = restaurantGeographicQueryBounds(center, 25);
  const second = restaurantGeographicQueryBounds(center, 25);

  assert.deepEqual(first, second);
  assert.ok(first.length > 0 && first.length <= 9);
  for (const bound of first) {
    assert.equal(bound.length, 2);
    assert.ok(bound[0] <= bound[1]);
  }
  assert.throws(
    () => restaurantGeographicQueryBounds(center, Number.POSITIVE_INFINITY),
    /no greater than/,
  );
  assert.throws(
    () => restaurantGeographicQueryBounds(center, 0),
    /no greater than/,
  );
});

test("restaurant search radius is capped at exactly 50 miles", () => {
  const center = { latitude: 28.8517, longitude: -82.487 };
  assert.equal(KILOMETERS_PER_MILE, 1.609344);
  assert.equal(MAX_RESTAURANT_SEARCH_RADIUS_KM, 80.4672);

  for (const miles of [1, 3, 5, 10, 15, 20, 30, 50]) {
    assert.doesNotThrow(() =>
      restaurantGeographicQueryBounds(
        center,
        miles * KILOMETERS_PER_MILE,
      ),
    );
  }
  assert.doesNotThrow(() => restaurantGeographicQueryBounds(center, 0.001));

  for (const radius of [
    undefined,
    "10",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1,
    MAX_RESTAURANT_SEARCH_RADIUS_KM + 0.0001,
    1_000_000,
  ]) {
    assert.throws(
      () => restaurantGeographicQueryBounds(center, radius),
      /no greater than/,
    );
  }
});

test("restaurant deduplication keys include source and document ID", () => {
  const biteScore = restaurantSourceDocumentKey(" biteScore ", " abc ");
  const biteSaver = restaurantSourceDocumentKey(" biteSaver ", " abc ");
  assert.equal(biteScore, "biteScore:abc");
  assert.equal(biteSaver, "biteSaver:abc");
  assert.notEqual(biteScore, biteSaver);
});
