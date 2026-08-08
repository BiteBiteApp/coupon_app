"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSearchIndexJobDocument,
  createSearchIndexDocumentId,
  createSearchIndexJobId,
  maximumSearchIndexDocumentBytes,
  maximumSearchIndexWorkerBatchSize,
  privateSearchIndexJobCollection,
  searchIndexJobVersion,
  searchIndexVersion,
  serializedSearchIndexDocumentBytes,
} = require("../lib/search_index_contract.js");

test("search-index and private-job protocol constants are exact", () => {
  assert.equal(searchIndexVersion, "bitestar.search-index.v1");
  assert.equal(searchIndexJobVersion, "bitestar.search-index-job.v1");
  assert.equal(privateSearchIndexJobCollection, "private_search_index_jobs");
  assert.equal(maximumSearchIndexWorkerBatchSize, 100);
  assert.equal(maximumSearchIndexDocumentBytes, 65_536);
});

test("hardcoded deterministic index-ID fixtures distinguish every source tuple", () => {
  const fixtures = [
    [
      {entityKind: "restaurant", sourceKind: "biteSaverRestaurant", sourceDocumentId: "X"},
      "si_2e1958960d9b5bc8beaf5e5290a16380d4895912d26a696cf06f82dc8ed549a2",
    ],
    [
      {entityKind: "restaurant", sourceKind: "biteScoreRestaurant", sourceDocumentId: "X"},
      "si_7b41bd7e4d8e6c715444b2577ab4e467048feb75018bf0235a218c46ca265f29",
    ],
    [
      {entityKind: "dish", sourceKind: "biteScoreDish", sourceDocumentId: "X"},
      "si_8230f471c4b4c1822c72a924de6bbbb5ff635ad014d5bc61d82c3731ab4e0664",
    ],
    [
      {entityKind: "offer", sourceKind: "biteSaverCoupon", parentSourceDocumentId: "A", sourceDocumentId: "X"},
      "si_f51ea46911aaf718abe05a3a2c84b177df623a2f82d2f449a5f44bafa7cb98ad",
    ],
    [
      {entityKind: "offer", sourceKind: "biteSaverCoupon", parentSourceDocumentId: "B", sourceDocumentId: "X"},
      "si_167a58c5f559cb97ca0c3b4b897ce08b83eabc75baa22f189d1104ba18c9b3e0",
    ],
    [
      {entityKind: "offer", sourceKind: "biteSaverDailySpecial", parentSourceDocumentId: "A", sourceDocumentId: "X"},
      "si_2d1443bc9d3b738d30afea1ab2456e9d4c18c55cf370c92ca18ebf3715d02d3f",
    ],
  ];
  const ids = fixtures.map(([input, expected]) => {
    const first = createSearchIndexDocumentId(input);
    assert.equal(first, expected);
    assert.equal(createSearchIndexDocumentId({...input}), expected);
    assert.match(first, /^si_[0-9a-f]{64}$/);
    return first;
  });
  assert.equal(new Set(ids).size, fixtures.length);
});

test("document IDs reject slash ambiguity and reveal no source canary", () => {
  assert.throws(
    () => createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: "parent/child",
    }),
    /document-ID segment/,
  );
  const canary = "private-token-canary";
  const id = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: "restaurant-safe-id",
    sourceDocumentId: canary,
  });
  assert.equal(id.includes(canary), false);
  assert.notEqual(
    createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: "X",
    }),
    createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: " X ",
    }),
  );
  assert.notEqual(
    createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: "X",
    }),
    createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: "x",
    }),
  );
});

test("job IDs and documents are deterministic, bounded, and payload-free", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const fingerprint = "a".repeat(64);
  const job = buildSearchIndexJobDocument({
    jobKind: "biteSaverOffers",
    parentSource: "biteSaver",
    parentSourceDocumentId: "restaurant-1",
    requestedSourceFingerprint: fingerprint,
    continuationCursor: {phase: "coupons", afterDocumentId: "coupon-100"},
    now,
  });
  assert.deepEqual(Object.keys(job).sort(), [
    "continuationCursor",
    "createdAt",
    "expiresAt",
    "jobKind",
    "parentSource",
    "parentSourceDocumentId",
    "requestedSourceFingerprint",
    "searchIndexJobVersion",
    "status",
  ]);
  const first = createSearchIndexJobId(job);
  const second = createSearchIndexJobId(job);
  assert.equal(first, second);
  assert.match(first, /^sij_[0-9a-f]{64}$/);
  for (const canary of ["email-canary", "stripe-canary", "token-canary"]) {
    assert.equal(JSON.stringify(job).includes(canary), false);
    assert.equal(first.includes(canary), false);
  }
});

test("maximum supported strict projections remain far below Firestore size", () => {
  const document = {
    searchIndexVersion,
    namePrefixTokens: Array.from({length: 128}, (_, index) =>
      `token-${String(index).padStart(3, "0")}-${"x".repeat(32)}`),
    descriptionSummary: "d".repeat(500),
    primaryImageUrl: `https://example.test/${"i".repeat(2_000)}`,
  };
  assert.ok(serializedSearchIndexDocumentBytes(document) < 16 * 1024);
  assert.ok(serializedSearchIndexDocumentBytes(document) < maximumSearchIndexDocumentBytes);
});
