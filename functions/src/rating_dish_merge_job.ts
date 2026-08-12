import {
  buildRatingDishOperationLockDocument,
  ratingDishOperationLockPath,
  type RatingDestructiveJobDocument,
  type RatingDishOperationLockDocument,
} from "./rating_destructive_job_contract.js";
import {
  dishMergeReviewLockPath,
  dishMergeReviewLockVersion,
  type DishMergeReviewLockDocument,
} from "./dish_proposal_private_contract.js";
import {
  buildDishMergeReviewLockDocument,
  dishMergeAggregateIsReady,
  dishMergeReviewLocksBelongToJob,
  parseDishMergeReviewLockDocument,
} from "./dish_proposal_resolution_jobs.js";
import {
  foldRatingDestructiveAggregateWinnerPage,
  ratingDestructiveAggregateWinnerCollectionPath,
  scanRatingDestructiveAggregateWinnerPage,
} from "./rating_destructive_aggregate.js";
import type {
  RatingDestructivePrivateTransaction,
} from "./rating_destructive_job_store.js";
import {
  assertReviewAuthorUnlocked,
  isFreshActiveRatingDestructiveJob,
  loadRatingDestructiveJob,
  loadRestaurantOperationLock,
  manualFailure,
  parseRatingDish,
  ratingDestructiveDirectBatchSize,
  requireOwnedDishLock,
  type RatingDestructiveDependencies,
  updateRatingDestructiveJob,
} from "./rating_destructive_job_runtime.js";
import {
  buildCanonicalDirectDishMergeReviewMutation,
  buildCanonicalDirectDishMergeReviewQuery,
} from "./rating_destructive_semantics.js";

export type RatingDishMergeStepResult = Readonly<{
  job: RatingDestructiveJobDocument;
  processedDocuments: number;
}>;

type DirectDishMergeIdentity = Readonly<{
  sourceDishId: string;
  targetDishId: string;
  restaurantId: string;
  sourceActiveGeneration: number;
  sourceCompletionGeneration: number;
  targetActiveGeneration: number;
  targetCompletionGeneration: number;
}>;

function directDishMergeIdentity(
  job: RatingDestructiveJobDocument,
): DirectDishMergeIdentity {
  if (
    job.operation !== "dishMerge" ||
    job.sourceDishId === null ||
    job.targetDishId === null ||
    job.sourceDishId === job.targetDishId ||
    job.restaurantId === null ||
    job.sourceActiveAggregateGeneration === null ||
    job.sourceCompletionAggregateGeneration === null ||
    job.targetActiveAggregateGeneration === null ||
    job.targetCompletionAggregateGeneration === null
  ) {
    manualFailure("entity_state_incompatible");
  }
  return {
    sourceDishId: job.sourceDishId,
    targetDishId: job.targetDishId,
    restaurantId: job.restaurantId,
    sourceActiveGeneration: job.sourceActiveAggregateGeneration,
    sourceCompletionGeneration: job.sourceCompletionAggregateGeneration,
    targetActiveGeneration: job.targetActiveAggregateGeneration,
    targetCompletionGeneration: job.targetCompletionAggregateGeneration,
  };
}

function reviewLocksBelongToDirectJob(
  job: RatingDestructiveJobDocument,
  identity: DirectDishMergeIdentity,
  sourceLock: DishMergeReviewLockDocument | null,
  targetLock: DishMergeReviewLockDocument | null,
): boolean {
  return dishMergeReviewLocksBelongToJob({
    jobId: job.jobId,
    // Direct merges deliberately use the deterministic destructive job ID as
    // the committed lock namespace; no proposal/group document is created.
    groupId: job.jobId,
    sourceDishId: identity.sourceDishId,
    mergeTargetDishId: identity.targetDishId,
    sourceActiveAggregateWriteGeneration:
      identity.sourceActiveGeneration,
    sourceCompletionAggregateWriteGeneration:
      identity.sourceCompletionGeneration,
    targetActiveAggregateWriteGeneration:
      identity.targetActiveGeneration,
    targetCompletionAggregateWriteGeneration:
      identity.targetCompletionGeneration,
  }, sourceLock, targetLock);
}

async function requireDirectMergeLocks(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  identity: DirectDishMergeIdentity,
): Promise<Readonly<{
  sourceDestructiveLock: RatingDishOperationLockDocument;
  targetDestructiveLock: RatingDishOperationLockDocument;
  sourceReviewLock: DishMergeReviewLockDocument;
  targetReviewLock: DishMergeReviewLockDocument;
}>> {
  const [
    sourceDestructiveLock,
    targetDestructiveLock,
    restaurantLock,
    sourceReviewLockDocument,
    targetReviewLockDocument,
  ] = await Promise.all([
    requireOwnedDishLock(transaction, job, identity.sourceDishId),
    requireOwnedDishLock(transaction, job, identity.targetDishId),
    loadRestaurantOperationLock(transaction, identity.restaurantId),
    transaction.getDocument(dishMergeReviewLockPath(identity.sourceDishId)),
    transaction.getDocument(dishMergeReviewLockPath(identity.targetDishId)),
  ]);
  if (restaurantLock !== null) {
    manualFailure("operation_conflict");
  }
  if (
    sourceDestructiveLock.role !== "source" ||
    sourceDestructiveLock.state !== "active_source" ||
    sourceDestructiveLock.restaurantId !== identity.restaurantId ||
    sourceDestructiveLock.targetDishId !== identity.targetDishId ||
    targetDestructiveLock.role !== "target" ||
    targetDestructiveLock.state !== "active_target" ||
    targetDestructiveLock.restaurantId !== identity.restaurantId ||
    targetDestructiveLock.targetDishId !== null
  ) {
    manualFailure("lock_missing");
  }
  let sourceReviewLock: DishMergeReviewLockDocument | null;
  let targetReviewLock: DishMergeReviewLockDocument | null;
  try {
    sourceReviewLock = parseDishMergeReviewLockDocument(
      sourceReviewLockDocument,
    );
    targetReviewLock = parseDishMergeReviewLockDocument(
      targetReviewLockDocument,
    );
  } catch {
    manualFailure("malformed_private_state");
  }
  if (
    sourceReviewLock === null ||
    targetReviewLock === null ||
    !reviewLocksBelongToDirectJob(
      job,
      identity,
      sourceReviewLock,
      targetReviewLock,
    )
  ) {
    manualFailure("lock_missing");
  }
  return {
    sourceDestructiveLock,
    targetDestructiveLock,
    sourceReviewLock,
    targetReviewLock,
  };
}

async function requireActiveMergeEntities(
  transaction: RatingDestructivePrivateTransaction,
  identity: DirectDishMergeIdentity,
): Promise<void> {
  const [sourceDocument, targetDocument] = await Promise.all([
    transaction.getDocument(`bitescore_dishes/${identity.sourceDishId}`),
    transaction.getDocument(`bitescore_dishes/${identity.targetDishId}`),
  ]);
  const source = parseRatingDish(sourceDocument);
  const target = parseRatingDish(targetDocument);
  if (
    source === null ||
    target === null ||
    source.documentId !== identity.sourceDishId ||
    target.documentId !== identity.targetDishId ||
    source.restaurantId !== identity.restaurantId ||
    target.restaurantId !== identity.restaurantId ||
    !source.isActive ||
    !target.isActive ||
    source.mergedIntoDishId !== null ||
    target.mergedIntoDishId !== null ||
    source.aggregateWriteGeneration !== identity.sourceActiveGeneration ||
    target.aggregateWriteGeneration !== identity.targetActiveGeneration
  ) {
    manualFailure("entity_state_incompatible");
  }
}

async function validateDishMergeStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingDishMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const job = await loadRatingDestructiveJob(transaction, expectedJob.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      job,
      expectedJob,
      "dishMerge",
      "validate",
    )) {
      return {job, processedDocuments: 0};
    }
    const identity = directDishMergeIdentity(job);
    await requireDirectMergeLocks(transaction, job, identity);
    await requireActiveMergeEntities(transaction, identity);
    const next = updateRatingDestructiveJob(transaction, job, {
      phase: "move_reviews",
      cursorDocumentId: null,
      itemCursorId: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      aggregateState: null,
      phaseProcessedCount: 0,
    }, now);
    return {job: next, processedDocuments: 0};
  });
}

async function moveDishMergeReviewsStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingDishMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const job = await loadRatingDestructiveJob(transaction, expectedJob.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      job,
      expectedJob,
      "dishMerge",
      "move_reviews",
    )) {
      return {job, processedDocuments: 0};
    }
    const identity = directDishMergeIdentity(job);
    await requireDirectMergeLocks(transaction, job, identity);
    await requireActiveMergeEntities(transaction, identity);
    let reviewQuery;
    try {
      reviewQuery = buildCanonicalDirectDishMergeReviewQuery({
        sourceDishId: identity.sourceDishId,
        cursorDocumentId: job.cursorDocumentId,
      });
    } catch {
      reviewQuery = {
        collectionPath: "dish_reviews",
        where: Object.freeze([
          {
            field: "dishId",
            operator: "==" as const,
            value: identity.sourceDishId,
          },
        ]),
        orderBy: Object.freeze([
          {field: "__name__", direction: "asc" as const},
        ]),
        startAfter: job.cursorDocumentId === null
          ? null
          : Object.freeze([job.cursorDocumentId]),
        limit: ratingDestructiveDirectBatchSize,
      };
    }
    const documents = await transaction.queryDocuments(reviewQuery);
    for (const document of documents) {
      await assertReviewAuthorUnlocked(transaction, document);
    }
    const exhausted = documents.length < ratingDestructiveDirectBatchSize;
    const firstSourceDocument = exhausted
      ? (await transaction.queryDocuments({
          collectionPath: "dish_reviews",
          where: Object.freeze([
            {field: "dishId", operator: "==", value: identity.sourceDishId},
          ]),
          orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
          limit: 1,
        }))[0] ?? null
      : null;
    for (const document of documents) {
      let mutation;
      try {
        mutation = buildCanonicalDirectDishMergeReviewMutation({
          reviewDocumentId: document.id,
          targetDishId: identity.targetDishId,
          targetRestaurantId: identity.restaurantId,
          updatedAt: now,
        });
      } catch {
        mutation = {
          documentPath: `dish_reviews/${document.id}`,
          data: {
            dishId: identity.targetDishId,
            restaurantId: identity.restaurantId,
            updatedAt: now,
          },
          options: {merge: true as const},
        };
      }
      transaction.setDocument(
        mutation.documentPath,
        mutation.data,
        mutation.options,
      );
    }
    if (exhausted) {
      // This fixed one-document verification prevents a stale/corrupt cursor
      // from producing a false phase transition. A legitimate operation lock
      // prevents any new source review from appearing behind the cursor.
      const selectedIds = new Set(documents.map((document) => document.id));
      if (
        firstSourceDocument !== null &&
        !selectedIds.has(firstSourceDocument.id)
      ) {
        const restarted = updateRatingDestructiveJob(transaction, job, {
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          processedCount: job.processedCount + documents.length,
          phaseProcessedCount:
            job.phaseProcessedCount + documents.length,
        }, now);
        return {job: restarted, processedDocuments: documents.length};
      }
    }
    const last = documents[documents.length - 1];
    const next = updateRatingDestructiveJob(transaction, job, exhausted
      ? {
          phase: "rebuild_target_aggregate",
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          processedCount: job.processedCount + documents.length,
          phaseProcessedCount: 0,
        }
      : {
          cursorDocumentId: last?.id ?? null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          processedCount: job.processedCount + documents.length,
          phaseProcessedCount: job.phaseProcessedCount + documents.length,
        }, now);
    return {job: next, processedDocuments: documents.length};
  });
}

function aggregateRoleForPhase(
  phase: RatingDestructiveJobDocument["phase"],
): "source" | "target" {
  if (
    phase === "rebuild_target_aggregate" ||
    phase === "fold_target_aggregate"
  ) {
    return "target";
  }
  if (
    phase === "rebuild_source_aggregate" ||
    phase === "fold_source_aggregate"
  ) {
    return "source";
  }
  manualFailure("unsupported_partial_state");
}

function aggregateIdentityForRole(
  identity: DirectDishMergeIdentity,
  role: "source" | "target",
): Readonly<{dishId: string; activeGeneration: number}> {
  return role === "source"
    ? {
        dishId: identity.sourceDishId,
        activeGeneration: identity.sourceActiveGeneration,
      }
    : {
        dishId: identity.targetDishId,
        activeGeneration: identity.targetActiveGeneration,
      };
}

async function rebuildDishMergeAggregateStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingDishMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const job = await loadRatingDestructiveJob(transaction, expectedJob.jobId);
    if (
      !isFreshActiveRatingDestructiveJob(
        job,
        expectedJob,
        "dishMerge",
        expectedJob.phase,
      ) ||
      job.phase !== "rebuild_target_aggregate" &&
      job.phase !== "rebuild_source_aggregate"
    ) {
      return {job, processedDocuments: 0};
    }
    const identity = directDishMergeIdentity(job);
    await requireDirectMergeLocks(transaction, job, identity);
    await requireActiveMergeEntities(transaction, identity);
    if (
      job.aggregateWinnerCursorId !== null ||
      job.aggregateState !== null
    ) {
      manualFailure("unsupported_partial_state");
    }
    const role = aggregateRoleForPhase(job.phase);
    const aggregateIdentity = aggregateIdentityForRole(identity, role);
    const result = await scanRatingDestructiveAggregateWinnerPage(
      transaction,
      {
        namespaceId: job.jobId,
        role,
        dishId: aggregateIdentity.dishId,
        cursorDocumentId: job.aggregateCursorDocumentId,
        now,
      },
    );
    const next = updateRatingDestructiveJob(transaction, job, result.complete
      ? {
          phase: role === "target"
            ? "fold_target_aggregate"
            : "fold_source_aggregate",
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          processedCount: job.processedCount + result.processedDocuments,
          phaseProcessedCount: 0,
        }
      : {
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: result.nextCursorDocumentId,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          processedCount: job.processedCount + result.processedDocuments,
          phaseProcessedCount:
            job.phaseProcessedCount + result.processedDocuments,
        }, now);
    return {job: next, processedDocuments: result.processedDocuments};
  });
}

async function foldDishMergeAggregateStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingDishMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const job = await loadRatingDestructiveJob(transaction, expectedJob.jobId);
    if (
      !isFreshActiveRatingDestructiveJob(
        job,
        expectedJob,
        "dishMerge",
        expectedJob.phase,
      ) ||
      job.phase !== "fold_target_aggregate" &&
      job.phase !== "fold_source_aggregate"
    ) {
      return {job, processedDocuments: 0};
    }
    const identity = directDishMergeIdentity(job);
    await requireDirectMergeLocks(transaction, job, identity);
    await requireActiveMergeEntities(transaction, identity);
    const role = aggregateRoleForPhase(job.phase);
    const aggregateIdentity = aggregateIdentityForRole(identity, role);
    if (
      job.aggregateCursorDocumentId !== null ||
      (job.aggregateWinnerCursorId === null) !==
        (job.aggregateState === null) ||
      (job.aggregateState !== null &&
        job.aggregateState.dishId !== aggregateIdentity.dishId)
    ) {
      manualFailure("unsupported_partial_state");
    }
    const result = await foldRatingDestructiveAggregateWinnerPage(
      transaction,
      {
        namespaceId: job.jobId,
        role,
        dishId: aggregateIdentity.dishId,
        restaurantId: identity.restaurantId,
        cursorDocumentId: job.aggregateWinnerCursorId,
        aggregateState: job.aggregateState as
          Readonly<Record<string, unknown>> | null,
      },
    );
    if (result.complete && result.aggregate === null) {
      manualFailure("malformed_private_state");
    }
    if (result.aggregate !== null) {
      transaction.setDocument(
        `dish_rating_aggregates/${aggregateIdentity.dishId}`,
        {
          ...result.aggregate,
          aggregateWriteGeneration: aggregateIdentity.activeGeneration,
          updatedAt: now,
        },
      );
    }
    const next = updateRatingDestructiveJob(transaction, job, result.complete
      ? {
          phase: role === "target"
            ? "rebuild_source_aggregate"
            : "finalize_dishes",
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          processedCount: job.processedCount + result.processedDocuments,
          phaseProcessedCount: 0,
        }
      : {
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: result.nextCursorDocumentId,
          aggregateState: result.accumulator,
          processedCount: job.processedCount + result.processedDocuments,
          phaseProcessedCount:
            job.phaseProcessedCount + result.processedDocuments,
        }, now);
    return {job: next, processedDocuments: result.processedDocuments};
  });
}

async function finalizeDishMergeStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingDishMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const job = await loadRatingDestructiveJob(transaction, expectedJob.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      job,
      expectedJob,
      "dishMerge",
      "finalize_dishes",
    )) {
      return {job, processedDocuments: 0};
    }
    const identity = directDishMergeIdentity(job);
    const locks = await requireDirectMergeLocks(transaction, job, identity);
    const [
      sourceDocument,
      targetDocument,
      sourceAggregateDocument,
      targetAggregateDocument,
      sourceReviews,
      remainingWinners,
    ] = await Promise.all([
      transaction.getDocument(`bitescore_dishes/${identity.sourceDishId}`),
      transaction.getDocument(`bitescore_dishes/${identity.targetDishId}`),
      transaction.getDocument(
        `dish_rating_aggregates/${identity.sourceDishId}`,
      ),
      transaction.getDocument(
        `dish_rating_aggregates/${identity.targetDishId}`,
      ),
      transaction.queryDocuments({
        collectionPath: "dish_reviews",
        where: Object.freeze([
          {field: "dishId", operator: "==", value: identity.sourceDishId},
        ]),
        orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
        limit: 1,
      }),
      transaction.queryDocuments({
        collectionPath: ratingDestructiveAggregateWinnerCollectionPath(
          job.jobId,
        ),
        orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
        limit: 1,
      }),
    ]);
    const source = parseRatingDish(sourceDocument);
    const target = parseRatingDish(targetDocument);
    if (
      source === null ||
      target === null ||
      source.restaurantId !== identity.restaurantId ||
      target.restaurantId !== identity.restaurantId ||
      !source.isActive ||
      !target.isActive ||
      source.mergedIntoDishId !== null ||
      target.mergedIntoDishId !== null ||
      source.aggregateWriteGeneration !== identity.sourceActiveGeneration ||
      target.aggregateWriteGeneration !== identity.targetActiveGeneration ||
      !dishMergeAggregateIsReady(
        sourceAggregateDocument,
        identity.sourceDishId,
        identity.restaurantId,
        identity.sourceActiveGeneration,
      ) ||
      !dishMergeAggregateIsReady(
        targetAggregateDocument,
        identity.targetDishId,
        identity.restaurantId,
        identity.targetActiveGeneration,
      ) ||
      sourceReviews.length !== 0 ||
      remainingWinners.length !== 0
    ) {
      manualFailure("entity_state_incompatible");
    }

    transaction.setDocument(`bitescore_dishes/${identity.sourceDishId}`, {
      isActive: false,
      mergedIntoDishId: identity.targetDishId,
      aggregateWriteGeneration: identity.sourceCompletionGeneration,
      updatedAt: now,
    }, {merge: true});
    // The target's product/profile metadata is deliberately untouched. Only
    // the committed aggregate-generation cutover and its timestamp advance.
    transaction.setDocument(`bitescore_dishes/${identity.targetDishId}`, {
      aggregateWriteGeneration: identity.targetCompletionGeneration,
      updatedAt: now,
    }, {merge: true});
    transaction.setDocument(
      `dish_rating_aggregates/${identity.sourceDishId}`,
      {
        aggregateWriteGeneration: identity.sourceCompletionGeneration,
        updatedAt: now,
      },
      {merge: true},
    );
    transaction.setDocument(
      `dish_rating_aggregates/${identity.targetDishId}`,
      {
        aggregateWriteGeneration: identity.targetCompletionGeneration,
        updatedAt: now,
      },
      {merge: true},
    );
    transaction.setDocument(
      dishMergeReviewLockPath(identity.sourceDishId),
      buildDishMergeReviewLockDocument({
        version: dishMergeReviewLockVersion,
        dishId: identity.sourceDishId,
        jobId: job.jobId,
        groupId: job.jobId,
        role: "source",
        state: "merged_source",
        blocksClientReviews: true,
        blocksClientAggregates: true,
        activeAggregateWriteGeneration: identity.sourceCompletionGeneration,
        completionAggregateWriteGeneration:
          identity.sourceCompletionGeneration,
        targetDishId: identity.targetDishId,
        createdAt: locks.sourceReviewLock.createdAt,
        indexedAt: now,
      }),
    );
    transaction.deleteDocument(
      dishMergeReviewLockPath(identity.targetDishId),
    );
    transaction.setDocument(
      ratingDishOperationLockPath(identity.sourceDishId),
      buildRatingDishOperationLockDocument({
        dishId: identity.sourceDishId,
        jobId: job.jobId,
        operation: "dishMerge",
        role: "source",
        state: "merged_source",
        active: false,
        permanent: true,
        restaurantId: identity.restaurantId,
        targetDishId: identity.targetDishId,
        createdAt: locks.sourceDestructiveLock.createdAt,
        updatedAt: now,
      }),
    );
    transaction.deleteDocument(
      ratingDishOperationLockPath(identity.targetDishId),
    );
    const completed = updateRatingDestructiveJob(transaction, job, {
      phase: "complete",
      status: "complete",
      failureCode: null,
      cursorDocumentId: null,
      itemCursorId: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      aggregateState: null,
      phaseProcessedCount: 0,
      completedAt: now,
    }, now);
    return {job: completed, processedDocuments: 1};
  });
}

/** Advances at most one bounded direct/Admin dish-merge phase step. */
export async function processDishMergeStep(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingDishMergeStepResult> {
  if (job.operation !== "dishMerge") {
    manualFailure("unsupported_partial_state");
  }
  if (
    job.status === "complete" ||
    job.status === "manual_review_required"
  ) {
    return {job, processedDocuments: 0};
  }
  switch (job.phase) {
    case "validate":
      return await validateDishMergeStep(dependencies, job, now);
    case "move_reviews":
      return await moveDishMergeReviewsStep(dependencies, job, now);
    case "rebuild_target_aggregate":
    case "rebuild_source_aggregate":
      return await rebuildDishMergeAggregateStep(
        dependencies,
        job,
        now,
      );
    case "fold_target_aggregate":
    case "fold_source_aggregate":
      return await foldDishMergeAggregateStep(dependencies, job, now);
    case "finalize_dishes":
      return await finalizeDishMergeStep(dependencies, job, now);
    case "complete":
      return {job, processedDocuments: 0};
    default:
      manualFailure("unsupported_partial_state");
  }
}
