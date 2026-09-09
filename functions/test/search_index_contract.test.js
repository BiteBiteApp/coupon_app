"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  biteScoreDishCustomerPublicProjectionVersion,
  biteScoreRestaurantCustomerPublicProjectionVersion,
  buildSearchIndexJobDocument,
  createSearchIndexDocumentId,
  createSearchIndexJobId,
  createSearchIndexSourceOccurrenceId,
  maximumSearchIndexDocumentBytes,
  maximumSearchIndexWorkerBatchSize,
  maximumPrivateSearchIndexCursorDocumentIdBytes,
  parsePrivateSearchIndexJobCursor,
  privateSearchIndexJobCollection,
  readCanonicalFirestoreImportedNumericDocumentId,
  readPrivateSearchIndexCursorDocumentId,
  searchIndexJobVersion,
  searchIndexVersion,
  serializedSearchIndexDocumentBytes,
} = require("../lib/search_index_contract.js");

test("search-index and private-job protocol constants are exact", () => {
  assert.equal(searchIndexVersion, "bitestar.search-index.v1");
  assert.equal(searchIndexJobVersion, "bitestar.search-index-job.v1");
  assert.equal(
    biteScoreRestaurantCustomerPublicProjectionVersion,
    "bitestar.bitescore-customer-public-restaurant.v1",
  );
  assert.equal(
    biteScoreDishCustomerPublicProjectionVersion,
    "bitestar.bitescore-customer-public-dish.v1",
  );
  assert.equal(privateSearchIndexJobCollection, "private_search_index_jobs");
  assert.equal(maximumSearchIndexWorkerBatchSize, 100);
  assert.equal(maximumPrivateSearchIndexCursorDocumentIdBytes, 1_500);
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
  assert.throws(
    () => createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: " X ",
    }),
    /document-ID segment/,
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

  for (const invalidId of [
    "",
    " padded",
    "padded ",
    ".",
    "..",
    "control\u0001",
    "format\u200b",
    "khmer\u17b4",
    "khmer\u17b5",
    "malformed\ud800",
    "x".repeat(1_501),
  ]) {
    assert.throws(
      () => createSearchIndexDocumentId({
        entityKind: "dish",
        sourceKind: "biteScoreDish",
        sourceDocumentId: invalidId,
      }),
      /document-ID segment/,
    );
  }
});

test("source occurrence hashes are stable per event and distinct across recurrences", () => {
  const first = createSearchIndexSourceOccurrenceId("event-delivery-1");
  assert.equal(first, createSearchIndexSourceOccurrenceId("event-delivery-1"));
  assert.notEqual(first, createSearchIndexSourceOccurrenceId("event-delivery-2"));
  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.throws(() => createSearchIndexSourceOccurrenceId(""), /occurrence/);
  assert.throws(
    () => createSearchIndexSourceOccurrenceId("x".repeat(4_097)),
    /occurrence/,
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
    sourceOccurrenceId: "b".repeat(64),
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
    "sourceOccurrenceId",
    "status",
  ]);
  const first = createSearchIndexJobId(job);
  const second = createSearchIndexJobId(job);
  assert.equal(first, second);
  assert.notEqual(
    first,
    createSearchIndexJobId({
      ...job,
      requestedSourceFingerprint: "d".repeat(64),
    }),
  );
  assert.notEqual(
    first,
    createSearchIndexJobId({
      ...job,
      sourceOccurrenceId: "c".repeat(64),
    }),
  );
  assert.notEqual(
    first,
    createSearchIndexJobId({
      ...job,
      continuationCursor: {
        phase: "coupons",
        afterDocumentId: "coupon-101",
      },
    }),
  );
  assert.notEqual(
    first,
    createSearchIndexJobId({
      ...job,
      continuationCursor: undefined,
    }),
  );
  assert.match(first, /^sij_[0-9a-f]{64}$/);
  for (const canary of ["email-canary", "stripe-canary", "token-canary"]) {
    assert.equal(JSON.stringify(job).includes(canary), false);
    assert.equal(first.includes(canary), false);
  }
});

test("private maintenance cursors preserve exact Firestore query identity", () => {
  const firestoreValidPrivateCursorIds = [
    "__",
    "___",
    "__id-9223372036854775808__",
    "__id-1__",
    "__id0__",
    "__id123__",
    "__id9223372036854775807__",
    " padded",
    "padded ",
    "\tcontrol\u0000",
    "format\u200b",
    "khmer\u17b4\u17b5",
    "__id123456789__",
    "x".repeat(1_500),
    "é".repeat(750),
    "😀".repeat(375),
  ];
  for (const documentId of firestoreValidPrivateCursorIds) {
    assert.equal(
      readPrivateSearchIndexCursorDocumentId(documentId),
      documentId,
    );
    const cursor = parsePrivateSearchIndexJobCursor({
      phase: "dishes",
      afterDocumentId: documentId,
    });
    assert.equal(cursor.afterDocumentId, documentId);
  }

  const rawCursor = " boundary-id ";
  const job = buildSearchIndexJobDocument({
    jobKind: "biteScoreDishes",
    parentSource: "biteScore",
    parentSourceDocumentId: "restaurant-1",
    requestedSourceFingerprint: "a".repeat(64),
    sourceOccurrenceId: "b".repeat(64),
    continuationCursor: {phase: "dishes", afterDocumentId: rawCursor},
    now: new Date("2026-08-08T12:00:00.000Z"),
  });
  assert.equal(job.continuationCursor.afterDocumentId, rawCursor);
  const jobId = createSearchIndexJobId(job);
  assert.match(jobId, /^sij_[0-9a-f]{64}$/u);
  assert.equal(jobId.includes(rawCursor), false);
});

test("imported numeric cursor IDs use one canonical signed-int64 spelling", () => {
  const accepted = [
    ["__id-9223372036854775808__", -9223372036854775808n],
    ["__id-9223372036854775807__", -9223372036854775807n],
    ["__id-1000000000000000000__", -1000000000000000000n],
    ["__id-123__", -123n],
    ["__id-2__", -2n],
    ["__id-1__", -1n],
    ["__id0__", 0n],
    ["__id1__", 1n],
    ["__id2__", 2n],
    ["__id10__", 10n],
    ["__id123__", 123n],
    ["__id1000000000000000000__", 1000000000000000000n],
    ["__id9223372036854775806__", 9223372036854775806n],
    ["__id9223372036854775807__", 9223372036854775807n],
  ];
  for (const [documentId, numericId] of accepted) {
    assert.equal(
      readCanonicalFirestoreImportedNumericDocumentId(documentId),
      numericId,
    );
    assert.equal(readPrivateSearchIndexCursorDocumentId(documentId), documentId);
  }

  const rejected = [
    undefined,
    null,
    0,
    1n,
    {},
    "",
    "__id__",
    "__id+0__",
    "__id+1__",
    "__id-0__",
    "__id00__",
    "__id01__",
    "__id02__",
    "__id-00__",
    "__id-01__",
    "__id9223372036854775808__",
    "__id-9223372036854775809__",
    `__id${"9".repeat(1_000)}__`,
    `__id-${"9".repeat(1_000)}__`,
    "__id1.0__",
    "__id1e0__",
    "__id0x1__",
    "__id 1__",
    "__id1 __",
    "__id\n1__",
    "__id١__",
    "__ID1__",
    "prefix__id1__",
    "__id1__suffix",
  ];
  for (const documentId of rejected) {
    assert.equal(
      readCanonicalFirestoreImportedNumericDocumentId(documentId),
      null,
    );
    if (typeof documentId === "string" && /^__[\s\S]*__$/u.test(documentId)) {
      assert.equal(readPrivateSearchIndexCursorDocumentId(documentId), null);
    }
  }

  for (const ordinaryPrivateDocumentId of [
    "__",
    "___",
    "ordinary",
    " whitespace ",
    " __id1__ ",
    "prefix__id1__",
    "__id1__suffix",
  ]) {
    assert.equal(
      readCanonicalFirestoreImportedNumericDocumentId(
        ordinaryPrivateDocumentId,
      ),
      null,
    );
    assert.equal(
      readPrivateSearchIndexCursorDocumentId(ordinaryPrivateDocumentId),
      ordinaryPrivateDocumentId,
    );
  }

  assert.throws(
    () => createSearchIndexDocumentId({
      entityKind: "dish",
      sourceKind: "biteScoreDish",
      sourceDocumentId: " private-cursor-only ",
    }),
    /document-ID segment/,
  );
});

test("private maintenance cursors reject only non-queryable or malformed IDs", () => {
  for (const documentId of [
    "",
    ".",
    "..",
    "slash/id",
    "____",
    "__x__",
    "__reserved__",
    "__reserved\n__",
    "__id__",
    "__id+1__",
    "__id-0__",
    "__id00__",
    "__id01__",
    "__id-01__",
    "__id9223372036854775808__",
    "__id-9223372036854775809__",
    `__id${"9".repeat(1_000)}__`,
    "__id1.0__",
    "__id1e0__",
    "malformed\ud800",
    "x".repeat(1_501),
    "é".repeat(751),
  ]) {
    assert.equal(readPrivateSearchIndexCursorDocumentId(documentId), null);
    assert.throws(
      () => parsePrivateSearchIndexJobCursor({
        phase: "dishes",
        afterDocumentId: documentId,
      }),
      /continuation cursor is invalid/,
    );
    assert.throws(
      () => createSearchIndexJobId({
        jobKind: "biteScoreDishes",
        parentSource: "biteScore",
        parentSourceDocumentId: "restaurant-1",
        requestedSourceFingerprint: "a".repeat(64),
        sourceOccurrenceId: "b".repeat(64),
        continuationCursor: {phase: "dishes", afterDocumentId: documentId},
      }),
      /continuation cursor is invalid/,
    );
  }
  assert.equal(readPrivateSearchIndexCursorDocumentId(null), null);
  assert.equal(parsePrivateSearchIndexJobCursor(undefined), null);
  for (const cursor of [
    null,
    {phase: "tampered", afterDocumentId: null},
    {phase: "dishes", afterDocumentId: null, injected: true},
    {phase: "dishes"},
    {phase: "dishes", afterDocumentId: undefined},
  ]) {
    assert.throws(
      () => parsePrivateSearchIndexJobCursor(cursor),
      /continuation cursor is invalid/,
    );
  }
  assert.throws(
    () => createSearchIndexJobId({
      jobKind: "biteSaverOffers",
      parentSource: "biteSaver",
      parentSourceDocumentId: "restaurant-1",
      requestedSourceFingerprint: "a".repeat(64),
      sourceOccurrenceId: "b".repeat(64),
      continuationCursor: {phase: "dishes", afterDocumentId: "dish-100"},
    }),
    /continuation cursor is invalid/,
  );
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
