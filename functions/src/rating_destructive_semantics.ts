import {
  dishMergeReviewLockVersion,
  dishProposalAggregateScanBatchSize,
  dishProposalReviewMigrationBatchSize,
} from "./dish_proposal_private_contract.js";
import type {
  DishProposalPrivateQuery,
} from "./dish_proposal_private_store.js";
import {
  dishReviewAggregateAccumulatorVersion,
  dishReviewAggregateWinnerVersion,
} from "./dish_review_aggregate_accumulator.js";
import {
  readRestaurantWriteRevision,
  restaurantWriteRevisionField,
} from "./restaurant_write_revision.js";

export const canonicalDirectDishMergePolicyVersion =
  "bitestar.rating-direct-dish-merge-policy.v1" as const;

export const canonicalDirectDishMergeReviewMigrationBatchSize =
  dishProposalReviewMigrationBatchSize;
export const canonicalDirectDishMergeAggregateScanBatchSize =
  dishProposalAggregateScanBatchSize;
export const canonicalDirectDishMergeReviewLockVersion =
  dishMergeReviewLockVersion;
export const canonicalDirectDishMergeAggregateAccumulatorVersion =
  dishReviewAggregateAccumulatorVersion;
export const canonicalDirectDishMergeAggregateWinnerVersion =
  dishReviewAggregateWinnerVersion;

export const canonicalDirectDishMergePolicy = Object.freeze({
  version: canonicalDirectDishMergePolicyVersion,
  sourceReviewCollection: "dish_reviews",
  sourceReviewQueryField: "dishId",
  sourceReviewQueryOperator: "==",
  sourceReviewOrderField: "__name__",
  reviewIdentity: "firestore_document_id",
  reviewMigrationFields: Object.freeze([
    "dishId",
    "restaurantId",
    "updatedAt",
  ] as const),
  migratesEveryExactSourceQueryDocument: true,
  aggregateCandidateParsingAffectsMigration: false,
  aggregateCandidateParsingAffectsAggregationOnly: true,
  deduplicatesAggregateByNormalizedReviewerIdentity: true,
  equalTimeTieBreaker: "firestore_document_id",
  preservesUnrelatedReviewFields: true,
  usesCommittedReviewLocks: true,
  usesCommittedAggregateGenerations: true,
  createsProposalState: false,
  createsMemberOrSupporterState: false,
  createsContributionPoints: false,
  createsLedgerEntries: false,
  createsSyntheticProposal: false,
} as const);

export type CanonicalDirectDishMergeEndpoint = Readonly<{
  documentId: string;
  restaurantId: string;
  isActive: boolean;
  mergedIntoDishId: string | null;
}>;

export type CanonicalDirectDishMergeIdentity = Readonly<{
  sourceDishId: string;
  targetDishId: string;
  restaurantId: string;
}>;

export type CanonicalMergeMutation = Readonly<{
  documentPath: string;
  data: Readonly<Record<string, unknown>>;
  options: Readonly<{merge: true}>;
}>;

const maximumFirestoreDocumentIdBytes = 1_500;

function requireExactDocumentId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    Buffer.byteLength(value, "utf8") > maximumFirestoreDocumentIdBytes
  ) {
    throw new Error(`${label} must be an exact Firestore document ID.`);
  }
  return value;
}

function requireCanonicalOperationalId(value: unknown, label: string): string {
  const documentId = requireExactDocumentId(value, label);
  if (
    documentId !== documentId.trim() ||
    /[\u0000-\u001f\u007f]/u.test(documentId)
  ) {
    throw new Error(`${label} is not canonical.`);
  }
  return documentId;
}

function requireNonblankExactString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function requireDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return new Date(value.getTime());
}

/**
 * Validates only the canonical source/target compatibility shared with the
 * committed Dish Suggestions merge. Document IDs are authoritative and are
 * never inferred from, or compared with, an embedded data.id field.
 */
export function requireCanonicalDirectDishMergeIdentity(value: Readonly<{
  source: CanonicalDirectDishMergeEndpoint;
  target: CanonicalDirectDishMergeEndpoint;
}>): CanonicalDirectDishMergeIdentity {
  const sourceDishId = requireCanonicalOperationalId(
    value.source.documentId,
    "Source dish ID",
  );
  const targetDishId = requireCanonicalOperationalId(
    value.target.documentId,
    "Target dish ID",
  );
  const sourceRestaurantId = requireCanonicalOperationalId(
    value.source.restaurantId,
    "Source restaurant ID",
  );
  const targetRestaurantId = requireCanonicalOperationalId(
    value.target.restaurantId,
    "Target restaurant ID",
  );
  if (
    sourceDishId === targetDishId ||
    sourceRestaurantId !== targetRestaurantId ||
    value.source.isActive !== true ||
    value.target.isActive !== true ||
    value.source.mergedIntoDishId !== null ||
    value.target.mergedIntoDishId !== null
  ) {
    throw new Error("Direct dish merge endpoints are incompatible.");
  }
  return Object.freeze({
    sourceDishId,
    targetDishId,
    restaurantId: sourceRestaurantId,
  });
}

/**
 * Produces the exact bounded query used by canonical review migration. Every
 * returned document is migrated; review-data parsing is deliberately absent.
 */
export function buildCanonicalDirectDishMergeReviewQuery(value: Readonly<{
  sourceDishId: string;
  cursorDocumentId: string | null;
}>): DishProposalPrivateQuery {
  const sourceDishId = requireCanonicalOperationalId(
    value.sourceDishId,
    "Source dish ID",
  );
  const cursorDocumentId = value.cursorDocumentId === null
    ? null
    : requireExactDocumentId(
        value.cursorDocumentId,
        "Review cursor document ID",
      );
  return Object.freeze({
    collectionPath: canonicalDirectDishMergePolicy.sourceReviewCollection,
    where: Object.freeze([Object.freeze({
      field: canonicalDirectDishMergePolicy.sourceReviewQueryField,
      operator: canonicalDirectDishMergePolicy.sourceReviewQueryOperator,
      value: sourceDishId,
    })]),
    orderBy: Object.freeze([Object.freeze({
      field: canonicalDirectDishMergePolicy.sourceReviewOrderField,
      direction: "asc" as const,
    })]),
    startAfter: cursorDocumentId === null
      ? null
      : Object.freeze([cursorDocumentId]),
    limit: canonicalDirectDishMergeReviewMigrationBatchSize,
  });
}

/**
 * Returns a merge-only mutation for the exact review snapshot document ID.
 * Its three-field payload preserves every unrelated review field and never
 * consults an embedded review data.id value.
 */
export function buildCanonicalDirectDishMergeReviewMutation(value: Readonly<{
  reviewDocumentId: string;
  targetDishId: string;
  targetRestaurantId: string;
  updatedAt: Date;
}>): CanonicalMergeMutation {
  const reviewDocumentId = requireExactDocumentId(
    value.reviewDocumentId,
    "Review document ID",
  );
  const targetDishId = requireCanonicalOperationalId(
    value.targetDishId,
    "Target dish ID",
  );
  const targetRestaurantId = requireCanonicalOperationalId(
    value.targetRestaurantId,
    "Target restaurant ID",
  );
  return Object.freeze({
    documentPath: `dish_reviews/${reviewDocumentId}`,
    data: Object.freeze({
      dishId: targetDishId,
      restaurantId: targetRestaurantId,
      updatedAt: requireDate(value.updatedAt, "Review migration updatedAt"),
    }),
    options: Object.freeze({merge: true as const}),
  });
}

/**
 * Captures the future restaurant-merge source retirement correction. A merge
 * write with this patch clears ownership explicitly instead of using nullable
 * model-copy fallback behavior.
 */
export function buildRestaurantMergeSourceRetirementMutation(value: Readonly<{
  sourceRestaurantDocumentId: string;
  restaurantWriteRevision: number;
  updatedAt: Date;
}>): CanonicalMergeMutation {
  const sourceRestaurantDocumentId = requireCanonicalOperationalId(
    value.sourceRestaurantDocumentId,
    "Source restaurant document ID",
  );
  const restaurantWriteRevision = readRestaurantWriteRevision({
    [restaurantWriteRevisionField]: value.restaurantWriteRevision,
  });
  if (restaurantWriteRevision === null) {
    throw new Error("Restaurant retirement write revision is invalid.");
  }
  return Object.freeze({
    documentPath: `bitescore_restaurants/${sourceRestaurantDocumentId}`,
    data: Object.freeze({
      isActive: false,
      isClaimed: false,
      ownerUserId: null,
      [restaurantWriteRevisionField]: restaurantWriteRevision,
      updatedAt: requireDate(value.updatedAt, "Restaurant retirement updatedAt"),
    }),
    options: Object.freeze({merge: true as const}),
  });
}

/**
 * Captures the future restaurant-merge moved-dish correction. The merge-only
 * patch cannot erase mergedIntoDishId or reconstruct any unrelated dish data.
 */
export function buildRestaurantMergeMovedDishMutation(value: Readonly<{
  dishDocumentId: string;
  targetRestaurantId: string;
  targetRestaurantName: string;
  updatedAt: Date;
}>): CanonicalMergeMutation {
  const dishDocumentId = requireCanonicalOperationalId(
    value.dishDocumentId,
    "Dish document ID",
  );
  const targetRestaurantId = requireCanonicalOperationalId(
    value.targetRestaurantId,
    "Target restaurant ID",
  );
  return Object.freeze({
    documentPath: `bitescore_dishes/${dishDocumentId}`,
    data: Object.freeze({
      restaurantId: targetRestaurantId,
      restaurantName: requireNonblankExactString(
        value.targetRestaurantName,
        "Target restaurant name",
      ),
      updatedAt: requireDate(value.updatedAt, "Moved dish updatedAt"),
    }),
    options: Object.freeze({merge: true as const}),
  });
}
