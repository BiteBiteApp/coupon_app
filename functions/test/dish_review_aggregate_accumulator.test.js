"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  accumulateDishReviewAggregateWinnerPage,
  buildDishReviewAggregateWinnerDocument,
  chooseDishReviewAggregateWinner,
  createDishReviewAggregateAccumulator,
  createDishReviewAggregateWinnerId,
  dishReviewAggregateAccumulatorVersion,
  dishReviewAggregateWinnerCollectionPath,
  dishReviewAggregateWinnerVersion,
  finalizeDishReviewAggregate,
  parseDishReviewAggregateCandidate,
  parseDishReviewAggregateWinnerDocument,
  restoreDishReviewAggregateAccumulator,
} = require("../lib/dish_review_aggregate_accumulator.js");

const indexedAt = new Date("2026-08-10T12:00:00.000Z");

class FakeTimestamp {
  constructor(value) {
    this.value = new Date(value);
  }

  toDate() {
    return new Date(this.value.getTime());
  }
}

class ExactFakeTimestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toDate() {
    return new Date(this.seconds * 1_000 + Math.floor(this.nanoseconds / 1e6));
  }
}

function sourceDocument(id, overrides = {}) {
  return {
    id,
    data: {
      id,
      dishId: "dish-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      overallImpression: 8,
      tastinessScore: 9,
      qualityScore: 7,
      valueScore: 6,
      overallBiteScore: 80,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      ...overrides,
    },
  };
}

function candidate(id, overrides = {}) {
  const parsed = parseDishReviewAggregateCandidate(sourceDocument(id, overrides));
  assert.ok(parsed);
  return parsed;
}

function winner(id, overrides = {}, options = {}) {
  return buildDishReviewAggregateWinnerDocument({
    jobId: options.jobId ?? "job-1",
    aggregateRole: options.aggregateRole ?? "target",
    candidate: candidate(id, overrides),
    indexedAt,
  });
}

function storedWinner(value) {
  return {
    id: value.winnerId,
    data: structuredClone(value),
  };
}

function fingerprintWinner(value) {
  return createHash("sha256").update(JSON.stringify([
    dishReviewAggregateWinnerVersion,
    [
      value.winnerId,
      value.jobId,
      value.aggregateRole,
      value.dishId,
      value.reviewerFingerprint,
      value.sourceDocumentId,
      value.overallImpression,
      value.tastinessScore,
      value.qualityScore,
      value.valueScore,
      value.overallBiteScore,
      value.freshnessSeconds,
      value.freshnessNanoseconds,
    ],
  ])).digest("hex");
}

test("candidate parsing mirrors legacy normalization without retaining review content", () => {
  const parsed = parseDishReviewAggregateCandidate(sourceDocument("source-1", {
    id: "embedded-review-is-not-authority",
    dishId: "  dish-1  ",
    restaurantId: "  restaurant-1  ",
    userId: "  user-1  ",
    overallImpression: null,
    qualityScore: null,
    tastinessScore: null,
    tasteScore: 7.5,
    overallBiteScore: 91,
    createdAt: new FakeTimestamp("2026-01-03T00:00:00.000Z"),
    updatedAt: new FakeTimestamp("2026-01-04T00:00:00.000Z"),
    headline: "private-headline-canary",
    notes: "private-notes-canary",
    arbitraryPrivateMap: {value: "private-map-canary"},
  }));

  assert.deepEqual(parsed, {
    sourceDocumentId: "source-1",
    dishId: "dish-1",
    restaurantId: "restaurant-1",
    userId: "user-1",
    overallImpression: 7.5,
    tastinessScore: 7.5,
    qualityScore: null,
    valueScore: 6,
    overallBiteScore: 91,
    freshnessSeconds: Date.parse("2026-01-04T00:00:00.000Z") / 1_000,
    freshnessNanoseconds: 0,
  });
  const serialized = JSON.stringify(parsed);
  for (const canary of [
    "private-headline-canary",
    "private-notes-canary",
    "private-map-canary",
    "embedded-review-is-not-authority",
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
});

test("candidate parser preserves fallback precedence and rejects invalid or nonfinite scores", () => {
  assert.equal(parseDishReviewAggregateCandidate({id: "missing", data: null}), null);
  assert.equal(
    parseDishReviewAggregateCandidate(sourceDocument("missing-user", {userId: " "})),
    null,
  );
  assert.equal(
    parseDishReviewAggregateCandidate(sourceDocument("missing-score", {
      overallImpression: null,
      tastinessScore: null,
      tasteScore: null,
      qualityScore: null,
      overallBiteScore: 0,
    })),
    null,
  );
  assert.equal(
    parseDishReviewAggregateCandidate(sourceDocument("nonfinite", {
      overallImpression: Number.NaN,
      tastinessScore: null,
      tasteScore: null,
      qualityScore: null,
      overallBiteScore: Number.POSITIVE_INFINITY,
    })),
    null,
  );

  const qualityFallback = candidate("quality", {
    overallImpression: null,
    qualityScore: 6,
    tastinessScore: 9,
    updatedAt: "not-a-timestamp",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
  });
  assert.equal(qualityFallback.overallImpression, 6);
  assert.equal(
    qualityFallback.freshnessSeconds,
    Date.parse("2026-02-01T00:00:00.000Z") / 1_000,
  );
  assert.equal(qualityFallback.freshnessNanoseconds, 0);
});

test("normalized-equivalent reviewer UIDs map to one deterministic winner identity", () => {
  const inputs = ["u1", " u1", "u1 "];
  const ids = inputs.map((userId) => createDishReviewAggregateWinnerId({
    jobId: "job-1",
    aggregateRole: "target",
    dishId: "dish-1",
    normalizedReviewerUid: userId,
  }));
  assert.equal(new Set(ids).size, 1);
  assert.equal(ids[0].length, 64);
  assert.equal(
    dishReviewAggregateWinnerCollectionPath("job with whitespace"),
    "private_dish_edit_application_jobs/job with whitespace/aggregate_winners",
  );
});

test("winner selection uses freshness then exact Firestore source document ID", () => {
  const older = winner("doc-a", {
    id: "embedded-z",
    userId: "u1",
    overallBiteScore: 10,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const fresher = candidate("doc-b", {
    id: "embedded-a",
    userId: " u1 ",
    overallBiteScore: 20,
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  const firstWinner = chooseDishReviewAggregateWinner(older, {
    jobId: "job-1",
    aggregateRole: "target",
    candidate: fresher,
    indexedAt,
  });
  assert.equal(firstWinner.sourceDocumentId, "doc-b");
  assert.equal(firstWinner.overallBiteScore, 20);

  const exactTieWinner = chooseDishReviewAggregateWinner(firstWinner, {
    jobId: "job-1",
    aggregateRole: "target",
    candidate: candidate("doc-z", {
      id: "embedded-0",
      userId: "u1 ",
      overallBiteScore: 90,
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
    indexedAt,
  });
  assert.equal(exactTieWinner.sourceDocumentId, "doc-z");
  assert.equal(exactTieWinner.overallBiteScore, 90);
});

test("winner selection preserves Firestore nanosecond ordering with Date fallback", () => {
  const older = winner("doc-z", {
    userId: "u1",
    overallBiteScore: 10,
    updatedAt: new ExactFakeTimestamp(1_800_000_000, 100_000),
  });
  assert.equal(older.freshnessSeconds, 1_800_000_000);
  assert.equal(older.freshnessNanoseconds, 100_000);

  const selected = chooseDishReviewAggregateWinner(older, {
    jobId: "job-1",
    aggregateRole: "target",
    candidate: candidate("doc-a", {
      userId: "u1",
      overallBiteScore: 90,
      updatedAt: new ExactFakeTimestamp(1_800_000_000, 400_000),
    }),
    indexedAt,
  });
  assert.equal(selected.sourceDocumentId, "doc-a");
  assert.equal(selected.overallBiteScore, 90);

  const dateFallback = candidate("date-fallback", {
    updatedAt: new FakeTimestamp("2026-05-06T07:08:09.123Z"),
  });
  assert.equal(
    dateFallback.freshnessSeconds,
    Math.floor(Date.parse("2026-05-06T07:08:09.123Z") / 1_000),
  );
  assert.equal(dateFallback.freshnessNanoseconds, 123_000_000);
});

test("strict winner parsing rejects every malformed nullable and operational shape", () => {
  const valid = winner("doc-1", {userId: "u1"});
  assert.deepEqual(parseDishReviewAggregateWinnerDocument(storedWinner(valid)), valid);

  const mutations = [
    {version: "unknown-version"},
    {tastinessScore: {wrong: "type"}},
    {qualityScore: Number.NaN},
    {valueScore: Number.POSITIVE_INFINITY},
    {freshnessSeconds: 1.5},
    {freshnessNanoseconds: Number.NaN},
    {freshnessNanoseconds: 1_000_000_000},
    {aggregateRole: "other"},
    {sourceDocumentId: "bad/path"},
    {indexedAt: "bad-date"},
    {unexpected: true},
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => parseDishReviewAggregateWinnerDocument({
        id: valid.winnerId,
        data: {...structuredClone(valid), ...mutation},
      }),
      /invalid/u,
      JSON.stringify(mutation),
    );
  }
});

test("winner parser reconstructs the deterministic identity from stored fields", () => {
  const valid = winner("doc-identity", {userId: "u1"});
  const forged = {
    ...structuredClone(valid),
    winnerId: "f".repeat(64),
    reviewerFingerprint: "e".repeat(64),
  };
  forged.fingerprint = fingerprintWinner(forged);
  assert.notEqual(forged.winnerId, valid.winnerId);
  assert.throws(
    () => parseDishReviewAggregateWinnerDocument({
      id: forged.winnerId,
      data: forged,
    }),
    /invalid identity/u,
  );
});

test("winner builder rejects invalid roles, numbers, timestamps, and UTF-8 IDs", () => {
  const validCandidate = candidate("doc-valid", {userId: "u1"});
  const invalidInputs = [
    {aggregateRole: "not-a-role", candidate: validCandidate},
    {
      aggregateRole: "target",
      candidate: {...validCandidate, overallImpression: Number.NaN},
    },
    {
      aggregateRole: "target",
      candidate: {...validCandidate, tastinessScore: {wrong: "shape"}},
    },
    {
      aggregateRole: "target",
      candidate: {...validCandidate, overallBiteScore: Number.POSITIVE_INFINITY},
    },
    {
      aggregateRole: "target",
      candidate: {...validCandidate, freshnessSeconds: 1.5},
    },
    {
      aggregateRole: "target",
      candidate: {...validCandidate, freshnessNanoseconds: -1},
    },
    {
      aggregateRole: "target",
      candidate: {...validCandidate, freshnessNanoseconds: 1_000_000_000},
    },
  ];
  for (const input of invalidInputs) {
    assert.throws(
      () => buildDishReviewAggregateWinnerDocument({
        jobId: "job-1",
        aggregateRole: input.aggregateRole,
        candidate: input.candidate,
        indexedAt,
      }),
      /invalid/u,
    );
  }

  const exactlyMaximumUtf8Id = "é".repeat(750);
  assert.doesNotThrow(() => dishReviewAggregateWinnerCollectionPath(
    exactlyMaximumUtf8Id,
  ));
  const oversizedUtf8Id = "é".repeat(751);
  assert.throws(
    () => dishReviewAggregateWinnerCollectionPath(oversizedUtf8Id),
    /document-ID segment/u,
  );
  assert.throws(
    () => createDishReviewAggregateAccumulator(oversizedUtf8Id),
    /not canonical/u,
  );
  assert.throws(
    () => createDishReviewAggregateWinnerId({
      jobId: "job-1",
      aggregateRole: "other",
      dishId: "dish-1",
      normalizedReviewerUid: "u1",
    }),
    /invalid/u,
  );
});

test("bounded winner pages fold exactly and survive JSON restoration", () => {
  const winners = [
    winner("review-a", {
      userId: "user-a",
      overallBiteScore: 80,
      overallImpression: 8,
      tastinessScore: 9,
      qualityScore: null,
      valueScore: 7,
    }),
    winner("review-b", {
      userId: "user-b",
      overallBiteScore: 60,
      overallImpression: 6,
      tastinessScore: null,
      qualityScore: 5,
      valueScore: null,
    }),
    winner("review-c", {
      userId: "user-c",
      overallBiteScore: 100,
      overallImpression: 10,
      tastinessScore: 8,
      qualityScore: 9,
      valueScore: 6,
    }),
  ];
  let state = accumulateDishReviewAggregateWinnerPage(
    createDishReviewAggregateAccumulator("dish-1"),
    winners.slice(0, 2),
  );
  state = restoreDishReviewAggregateAccumulator(
    JSON.parse(JSON.stringify(state)),
  );
  state = accumulateDishReviewAggregateWinnerPage(state, winners.slice(2));

  assert.deepEqual(finalizeDishReviewAggregate(state, " restaurant-1 "), {
    dishId: "dish-1",
    restaurantId: "restaurant-1",
    overallBiteScore: 80,
    ratingCount: 3,
    overallImpressionAverage: 8,
    tastinessScoreAverage: 8.5,
    qualityScoreAverage: 7,
    valueScoreAverage: 6.5,
  });
  assert.equal(state.accumulatorVersion, dishReviewAggregateAccumulatorVersion);
});

test("empty aggregate has exact zero and null fields", () => {
  assert.deepEqual(
    finalizeDishReviewAggregate(
      createDishReviewAggregateAccumulator("dish-empty"),
      "restaurant-1",
    ),
    {
      dishId: "dish-empty",
      restaurantId: "restaurant-1",
      overallBiteScore: 0,
      ratingCount: 0,
      overallImpressionAverage: null,
      tastinessScoreAverage: null,
      qualityScoreAverage: null,
      valueScoreAverage: null,
    },
  );
});

test("accumulator creation rejects rather than trimming dish aliases", () => {
  assert.throws(
    () => createDishReviewAggregateAccumulator(" dish-1 "),
    /not canonical/,
  );
});

test("winner and accumulator records remain bounded and privacy-safe", () => {
  const value = winner("source-doc", {
    id: "embedded-review",
    userId: "private-user-id",
    headline: "private-headline-canary",
    notes: "private-notes-canary",
    arbitraryPrivateMap: {nested: "private-map-canary"},
  });
  const serializedWinner = JSON.stringify(value);
  assert.equal(value.version, dishReviewAggregateWinnerVersion);
  for (const canary of [
    "private-user-id",
    "embedded-review",
    "private-headline-canary",
    "private-notes-canary",
    "private-map-canary",
  ]) {
    assert.equal(serializedWinner.includes(canary), false, canary);
  }
  assert.ok(Buffer.byteLength(serializedWinner, "utf8") < 2_000);

  assert.throws(
    () => restoreDishReviewAggregateAccumulator({
      ...createDishReviewAggregateAccumulator("dish-1"),
      privateReviewMap: {headline: "must-not-survive"},
    }),
    /accumulator is invalid/u,
  );
  assert.throws(
    () => restoreDishReviewAggregateAccumulator({
      ...createDishReviewAggregateAccumulator("dish-1"),
      overallBiteScoreSum: Number.NaN,
    }),
    /invalid/u,
  );
});
