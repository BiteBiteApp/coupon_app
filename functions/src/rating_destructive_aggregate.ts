import {
  accumulateDishReviewAggregateWinnerPage,
  buildDishReviewAggregateWinnerDocument,
  chooseDishReviewAggregateWinnerDocument,
  createDishReviewAggregateAccumulator,
  finalizeDishReviewAggregate,
  parseDishReviewAggregateCandidate,
  parseDishReviewAggregateWinnerDocument,
  restoreDishReviewAggregateAccumulator,
  type DishReviewAggregate,
  type DishReviewAggregateAccumulator,
  type DishReviewAggregateRole,
  type DishReviewAggregateWinnerDocument,
} from "./dish_review_aggregate_accumulator.js";
import {
  ratingDestructiveAggregateBatchLimit,
  ratingDestructiveJobItemPath,
  ratingDishOperationLockPath,
} from "./rating_destructive_job_contract.js";
import type {
  RatingDestructivePrivateTransaction,
} from "./rating_destructive_job_store.js";
import {manualFailure} from "./rating_destructive_job_runtime.js";

export function ratingDestructiveAggregateWinnerCollectionPath(
  namespaceId: string,
): string {
  return `${ratingDestructiveJobItemPath(namespaceId)}/aggregate_winners`;
}

export type RatingDestructiveAggregateScanResult = Readonly<{
  processedDocuments: number;
  nextCursorDocumentId: string | null;
  complete: boolean;
}>;

function aggregateOperationalDishId(dishId: string): string {
  ratingDishOperationLockPath(dishId);
  if (
    dishId === dishId.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(dishId)
  ) {
    return dishId;
  }
  return `opaque-${createHash("sha256").update(JSON.stringify([
    "bitestar.rating-destructive-aggregate-dish.v1",
    dishId,
  ]), "utf8").digest("hex")}`;
}

export async function scanRatingDestructiveAggregateWinnerPage(
  transaction: RatingDestructivePrivateTransaction,
  value: Readonly<{
    namespaceId: string;
    role: DishReviewAggregateRole;
    dishId: string;
    cursorDocumentId: string | null;
    now: Date;
  }>,
): Promise<RatingDestructiveAggregateScanResult> {
  const operationalDishId = aggregateOperationalDishId(value.dishId);
  const documents = await transaction.queryDocuments({
    collectionPath: "dish_reviews",
    where: Object.freeze([
      {field: "dishId", operator: "==", value: value.dishId},
    ]),
    orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
    startAfter: value.cursorDocumentId === null
      ? null
      : Object.freeze([value.cursorDocumentId]),
    limit: ratingDestructiveAggregateBatchLimit,
  });
  const pageWinners = new Map<string, DishReviewAggregateWinnerDocument>();
  for (const document of documents) {
    const candidate = parseDishReviewAggregateCandidate({
      id: document.id,
      data: {...document.data, dishId: operationalDishId},
    });
    if (candidate === null || candidate.dishId !== operationalDishId) {
      continue;
    }
    const candidateWinner = buildDishReviewAggregateWinnerDocument({
      jobId: value.namespaceId,
      aggregateRole: value.role,
      candidate,
      indexedAt: value.now,
    });
    const current = pageWinners.get(candidateWinner.winnerId);
    pageWinners.set(
      candidateWinner.winnerId,
      current === undefined
        ? candidateWinner
        : chooseDishReviewAggregateWinnerDocument(current, candidateWinner),
    );
  }
  const winnerCollection = ratingDestructiveAggregateWinnerCollectionPath(
    value.namespaceId,
  );
  const candidateWinners = [...pageWinners.values()];
  const existingWinnerDocuments = await Promise.all(
    candidateWinners.map((candidateWinner) => transaction.getDocument(
      `${winnerCollection}/${candidateWinner.winnerId}`,
    )),
  );
  for (let index = 0; index < candidateWinners.length; index += 1) {
    const candidateWinner = candidateWinners[index];
    const existing = parseDishReviewAggregateWinnerDocument(
      existingWinnerDocuments[index],
    );
    if (
      existing !== null &&
      (existing.jobId !== value.namespaceId ||
        existing.aggregateRole !== value.role ||
        existing.dishId !== operationalDishId)
    ) {
      manualFailure("malformed_private_state");
    }
    const winner = existing === null
      ? candidateWinner
      : chooseDishReviewAggregateWinnerDocument(existing, candidateWinner);
    if (existing === null || winner.fingerprint !== existing.fingerprint) {
      transaction.setDocument(
        `${winnerCollection}/${winner.winnerId}`,
        winner,
      );
    }
  }
  const complete = documents.length < ratingDestructiveAggregateBatchLimit;
  const last = documents[documents.length - 1];
  return {
    processedDocuments: documents.length,
    nextCursorDocumentId: complete ? null : last?.id ?? null,
    complete,
  };
}

export type RatingDestructiveAggregateFoldResult = Readonly<{
  processedDocuments: number;
  nextCursorDocumentId: string | null;
  accumulator: DishReviewAggregateAccumulator;
  aggregate: DishReviewAggregate | null;
  complete: boolean;
}>;

export async function foldRatingDestructiveAggregateWinnerPage(
  transaction: RatingDestructivePrivateTransaction,
  value: Readonly<{
    namespaceId: string;
    role: DishReviewAggregateRole;
    dishId: string;
    restaurantId: string;
    cursorDocumentId: string | null;
    aggregateState: Readonly<Record<string, unknown>> | null;
  }>,
): Promise<RatingDestructiveAggregateFoldResult> {
  const operationalDishId = aggregateOperationalDishId(value.dishId);
  const accumulator = value.aggregateState === null
    ? createDishReviewAggregateAccumulator(operationalDishId)
    : restoreDishReviewAggregateAccumulator({
        ...value.aggregateState,
        dishId: operationalDishId,
      });
  const winnerCollection = ratingDestructiveAggregateWinnerCollectionPath(
    value.namespaceId,
  );
  const documents = await transaction.queryDocuments({
    collectionPath: winnerCollection,
    orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
    startAfter: value.cursorDocumentId === null
      ? null
      : Object.freeze([value.cursorDocumentId]),
    limit: ratingDestructiveAggregateBatchLimit,
  });
  const winners = documents.map((document) => {
    const winner = parseDishReviewAggregateWinnerDocument(document);
    if (
      winner === null ||
      winner.jobId !== value.namespaceId ||
      winner.aggregateRole !== value.role ||
      winner.dishId !== operationalDishId
    ) {
      manualFailure("malformed_private_state");
    }
    return winner;
  });
  const nextAccumulator = accumulateDishReviewAggregateWinnerPage(
    accumulator,
    winners,
  );
  for (const winner of winners) {
    transaction.deleteDocument(`${winnerCollection}/${winner.winnerId}`);
  }
  const complete = documents.length < ratingDestructiveAggregateBatchLimit;
  const last = documents[documents.length - 1];
  return {
    processedDocuments: documents.length,
    nextCursorDocumentId: complete ? null : last?.id ?? null,
    accumulator: {...nextAccumulator, dishId: value.dishId},
    aggregate: complete
      ? {
          ...finalizeDishReviewAggregate(nextAccumulator, value.restaurantId),
          dishId: value.dishId,
        }
      : null,
    complete,
  };
}
import {createHash} from "node:crypto";
