"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDishReviewAggregateWinnerDocument,
  chooseDishReviewAggregateWinner,
  dishReviewAggregateAccumulatorVersion,
  dishReviewAggregateWinnerVersion,
  parseDishReviewAggregateCandidate,
} = require("../lib/dish_review_aggregate_accumulator.js");
const {
  dishMergeReviewLockVersion,
  dishProposalAggregateScanBatchSize,
  dishProposalReviewMigrationBatchSize,
} = require("../lib/dish_proposal_private_contract.js");
const {
  buildCanonicalDirectDishMergeReviewMutation,
  buildCanonicalDirectDishMergeReviewQuery,
  buildRestaurantMergeMovedDishMutation,
  buildRestaurantMergeSourceRetirementMutation,
  canonicalDirectDishMergeAggregateAccumulatorVersion,
  canonicalDirectDishMergeAggregateScanBatchSize,
  canonicalDirectDishMergeAggregateWinnerVersion,
  canonicalDirectDishMergePolicy,
  canonicalDirectDishMergeReviewLockVersion,
  canonicalDirectDishMergeReviewMigrationBatchSize,
  requireCanonicalDirectDishMergeIdentity,
} = require("../lib/rating_destructive_semantics.js");

const now = new Date("2026-08-11T12:00:00.000Z");

test("canonical direct merge preserves exact direction and compatibility", () => {
  const identity = requireCanonicalDirectDishMergeIdentity({
    source: {
      documentId: "source-dish",
      restaurantId: "restaurant-1",
      isActive: true,
      mergedIntoDishId: null,
      id: "embedded-id-is-not-part-of-the-contract",
    },
    target: {
      documentId: "target-dish",
      restaurantId: "restaurant-1",
      isActive: true,
      mergedIntoDishId: null,
      id: "another-embedded-id",
    },
  });

  assert.deepEqual(identity, {
    sourceDishId: "source-dish",
    targetDishId: "target-dish",
    restaurantId: "restaurant-1",
  });
  assert.throws(
    () => requireCanonicalDirectDishMergeIdentity({
      source: {
        documentId: "same-dish",
        restaurantId: "restaurant-1",
        isActive: true,
        mergedIntoDishId: null,
      },
      target: {
        documentId: "same-dish",
        restaurantId: "restaurant-1",
        isActive: true,
        mergedIntoDishId: null,
      },
    }),
    /incompatible/u,
  );
  for (const override of [
    {source: {isActive: false}},
    {source: {mergedIntoDishId: "older-target"}},
    {target: {isActive: false}},
    {target: {mergedIntoDishId: "older-target"}},
    {target: {restaurantId: "restaurant-2"}},
  ]) {
    const source = {
      documentId: "source-dish",
      restaurantId: "restaurant-1",
      isActive: true,
      mergedIntoDishId: null,
      ...override.source,
    };
    const target = {
      documentId: "target-dish",
      restaurantId: "restaurant-1",
      isActive: true,
      mergedIntoDishId: null,
      ...override.target,
    };
    assert.throws(
      () => requireCanonicalDirectDishMergeIdentity({source, target}),
      /incompatible/u,
    );
  }
});

test("canonical review query reuses committed bounded review migration", () => {
  assert.equal(
    canonicalDirectDishMergeReviewMigrationBatchSize,
    dishProposalReviewMigrationBatchSize,
  );
  assert.equal(
    canonicalDirectDishMergeAggregateScanBatchSize,
    dishProposalAggregateScanBatchSize,
  );
  assert.equal(
    canonicalDirectDishMergeReviewLockVersion,
    dishMergeReviewLockVersion,
  );
  assert.equal(
    canonicalDirectDishMergeAggregateAccumulatorVersion,
    dishReviewAggregateAccumulatorVersion,
  );
  assert.equal(
    canonicalDirectDishMergeAggregateWinnerVersion,
    dishReviewAggregateWinnerVersion,
  );
  assert.deepEqual(
    buildCanonicalDirectDishMergeReviewQuery({
      sourceDishId: "source-dish",
      cursorDocumentId: " review cursor ",
    }),
    {
      collectionPath: "dish_reviews",
      where: [{field: "dishId", operator: "==", value: "source-dish"}],
      orderBy: [{field: "__name__", direction: "asc"}],
      startAfter: [" review cursor "],
      limit: dishProposalReviewMigrationBatchSize,
    },
  );
  assert.equal(
    buildCanonicalDirectDishMergeReviewQuery({
      sourceDishId: "source-dish",
      cursorDocumentId: null,
    }).startAfter,
    null,
  );
});

test("every exact source review receives only the canonical merge fields", () => {
  const malformedAggregateReview = {
    id: "embedded-id-must-not-control-the-path",
    dishId: "source-dish",
    restaurantId: "old-restaurant",
    userId: null,
    overallImpression: null,
    headline: "preserve this private field",
    nested: {preserved: true},
  };
  assert.equal(
    parseDishReviewAggregateCandidate({
      id: "authoritative-review-document",
      data: malformedAggregateReview,
    }),
    null,
  );

  const mutation = buildCanonicalDirectDishMergeReviewMutation({
    reviewDocumentId: "authoritative-review-document",
    targetDishId: "target-dish",
    targetRestaurantId: "target-restaurant",
    updatedAt: now,
  });
  assert.equal(
    mutation.documentPath,
    "dish_reviews/authoritative-review-document",
  );
  assert.deepEqual(Object.keys(mutation.data).sort(), [
    "dishId",
    "restaurantId",
    "updatedAt",
  ]);
  assert.deepEqual(mutation.options, {merge: true});

  const afterMerge = {...malformedAggregateReview, ...mutation.data};
  assert.equal(afterMerge.id, "embedded-id-must-not-control-the-path");
  assert.equal(afterMerge.headline, "preserve this private field");
  assert.deepEqual(afterMerge.nested, {preserved: true});
  assert.equal(afterMerge.dishId, "target-dish");
  assert.equal(afterMerge.restaurantId, "target-restaurant");
});

test("aggregate policy normalizes reviewers and breaks exact-time ties by document ID", () => {
  function candidate(documentId, embeddedId, userId, score) {
    const parsed = parseDishReviewAggregateCandidate({
      id: documentId,
      data: {
        id: embeddedId,
        dishId: "target-dish",
        restaurantId: "restaurant-1",
        userId,
        overallImpression: score,
        overallBiteScore: score * 10,
        updatedAt: now,
      },
    });
    assert.ok(parsed);
    return parsed;
  }

  const first = buildDishReviewAggregateWinnerDocument({
    jobId: "future-direct-merge-job",
    aggregateRole: "target",
    candidate: candidate("review-a", "embedded-z", " user-1 ", 4),
    indexedAt: now,
  });
  const selected = chooseDishReviewAggregateWinner(first, {
    jobId: "future-direct-merge-job",
    aggregateRole: "target",
    candidate: candidate("review-z", "embedded-a", "user-1", 9),
    indexedAt: now,
  });

  assert.equal(selected.sourceDocumentId, "review-z");
  assert.equal(selected.overallImpression, 9);
  assert.equal(selected.winnerId, first.winnerId);
});

test("canonical direct merge policy forbids proposal and points side effects", () => {
  assert.equal(canonicalDirectDishMergePolicy.createsProposalState, false);
  assert.equal(canonicalDirectDishMergePolicy.createsMemberOrSupporterState, false);
  assert.equal(canonicalDirectDishMergePolicy.createsContributionPoints, false);
  assert.equal(canonicalDirectDishMergePolicy.createsLedgerEntries, false);
  assert.equal(canonicalDirectDishMergePolicy.createsSyntheticProposal, false);
  assert.equal(
    canonicalDirectDishMergePolicy.aggregateCandidateParsingAffectsMigration,
    false,
  );
  assert.equal(
    canonicalDirectDishMergePolicy.aggregateCandidateParsingAffectsAggregationOnly,
    true,
  );
  assert.equal(
    canonicalDirectDishMergePolicy.equalTimeTieBreaker,
    "firestore_document_id",
  );
});

test("future restaurant merge source retirement clears owner explicitly", () => {
  const source = {
    id: "source-restaurant",
    isActive: true,
    isClaimed: true,
    ownerUserId: "owner-1",
    name: "Source Restaurant",
  };
  const mutation = buildRestaurantMergeSourceRetirementMutation({
    sourceRestaurantDocumentId: "source-restaurant",
    restaurantWriteRevision: 8,
    updatedAt: now,
  });

  assert.equal(mutation.documentPath, "bitescore_restaurants/source-restaurant");
  assert.deepEqual(Object.keys(mutation.data).sort(), [
    "isActive",
    "isClaimed",
    "ownerUserId",
    "restaurantWriteRevision",
    "updatedAt",
  ]);
  assert.equal(mutation.data.ownerUserId, null);
  assert.equal(mutation.data.isClaimed, false);
  assert.equal(mutation.data.isActive, false);
  assert.equal(mutation.data.restaurantWriteRevision, 8);
  assert.deepEqual({...source, ...mutation.data}, {
    ...source,
    isActive: false,
    isClaimed: false,
    ownerUserId: null,
    restaurantWriteRevision: 8,
    updatedAt: now,
  });
});

test("future restaurant source retirement rejects malformed revisions", () => {
  for (const restaurantWriteRevision of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    "8",
    undefined,
  ]) {
    assert.throws(
      () => buildRestaurantMergeSourceRetirementMutation({
        sourceRestaurantDocumentId: "source-restaurant",
        restaurantWriteRevision,
        updatedAt: now,
      }),
      /write revision is invalid/u,
    );
  }
  assert.equal(
    buildRestaurantMergeSourceRetirementMutation({
      sourceRestaurantDocumentId: "source-restaurant",
      restaurantWriteRevision: Number.MAX_SAFE_INTEGER,
      updatedAt: now,
    }).data.restaurantWriteRevision,
    Number.MAX_SAFE_INTEGER,
  );
});

test("future restaurant merge moves a dish without erasing lineage", () => {
  const sourceDish = {
    id: "dish-1",
    restaurantId: "source-restaurant",
    restaurantName: "Source Restaurant",
    name: "Dish Name",
    isActive: false,
    mergedIntoDishId: "preexisting-merge-target",
    categoryTags: ["preserved"],
  };
  const mutation = buildRestaurantMergeMovedDishMutation({
    dishDocumentId: "dish-1",
    targetRestaurantId: "target-restaurant",
    targetRestaurantName: "Target Restaurant",
    updatedAt: now,
  });

  assert.equal(mutation.documentPath, "bitescore_dishes/dish-1");
  assert.deepEqual(Object.keys(mutation.data).sort(), [
    "restaurantId",
    "restaurantName",
    "updatedAt",
  ]);
  assert.deepEqual(mutation.options, {merge: true});

  const moved = {...sourceDish, ...mutation.data};
  assert.equal(moved.restaurantId, "target-restaurant");
  assert.equal(moved.restaurantName, "Target Restaurant");
  assert.equal(moved.mergedIntoDishId, "preexisting-merge-target");
  assert.equal(moved.isActive, false);
  assert.equal(moved.name, "Dish Name");
  assert.deepEqual(moved.categoryTags, ["preserved"]);
});

test("semantic helpers reject malformed exact identities and timestamps", () => {
  assert.throws(
    () => buildCanonicalDirectDishMergeReviewQuery({
      sourceDishId: "bad/id",
      cursorDocumentId: null,
    }),
    /exact Firestore document ID/u,
  );
  assert.throws(
    () => buildCanonicalDirectDishMergeReviewQuery({
      sourceDishId: " source-dish ",
      cursorDocumentId: null,
    }),
    /not canonical/u,
  );
  assert.throws(
    () => buildCanonicalDirectDishMergeReviewMutation({
      reviewDocumentId: "review-1",
      targetDishId: "target-dish",
      targetRestaurantId: "restaurant-1",
      updatedAt: new Date(Number.NaN),
    }),
    /updatedAt is invalid/u,
  );
  assert.throws(
    () => buildRestaurantMergeMovedDishMutation({
      dishDocumentId: "dish-1",
      targetRestaurantId: "restaurant-1",
      targetRestaurantName: "   ",
      updatedAt: now,
    }),
    /restaurant name is required/u,
  );
});
