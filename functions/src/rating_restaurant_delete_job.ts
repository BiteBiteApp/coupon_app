import {
  buildRatingDishOperationLockDocument,
  buildRatingRestaurantOperationLockDocument,
  ratingDestructiveJobItemPath,
  ratingDishOperationLockPath,
  ratingRestaurantOperationLockPath,
  type RatingDestructiveJobDocument,
} from "./rating_destructive_job_contract.js";
import {
  dishMergeReviewLockPath,
} from "./dish_proposal_private_contract.js";
import {
  parseDishMergeReviewLockDocument,
} from "./dish_proposal_resolution_jobs.js";
import {
  buildInitialDishDeletionItem,
  processDishDeletionItemStep,
  processFirstReviewDeletionUnit,
  processNextMilestoneUserStep,
} from "./rating_dish_delete_job.js";
import {
  findActiveDishLockForRestaurant,
  hasBlockingDishProposalJobForDish,
  isFreshActiveRatingDestructiveJob,
  isFreshRatingDestructiveItem,
  loadDishOperationLock,
  loadRatingDestructiveItem,
  loadRatingDestructiveJob,
  manualFailure,
  parseRatingRestaurant,
  ratingDestructiveDirectBatchSize,
  readExactProductIdentity,
  requireOwnedRestaurantLock,
  retryableFailure,
  type RatingDestructiveDependencies,
  updateRatingDestructiveJob,
} from "./rating_destructive_job_runtime.js";

export type RatingRestaurantDeleteStepResult = Readonly<{
  job: RatingDestructiveJobDocument;
  processedDocuments: number;
}>;

async function processRestaurantDishStep(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantDeleteStepResult> {
  const selected = await dependencies.database.runTransaction(async (
    transaction,
  ) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantDelete",
      "process_dishes",
    )) {
      return {current, item: null, canAdvance: false};
    }
    const item = current.itemCursorId === null
      ? null
      : await loadRatingDestructiveItem(transaction, current.itemCursorId);
    if (
      item !== null &&
      (item.jobId !== current.jobId ||
        item.operation !== "restaurantDelete" ||
        item.kind !== "dishDeletion")
    ) {
      manualFailure("malformed_private_state");
    }
    return {current, item, canAdvance: true};
  });
  if (!selected.canAdvance) {
    return {job: selected.current, processedDocuments: 0};
  }
  if (selected.item !== null) {
    const selectedItem = selected.item;
    if (selectedItem.status === "complete") {
      return dependencies.database.runTransaction(async (transaction) => {
        const current = await loadRatingDestructiveJob(transaction, job.jobId);
        if (!isFreshActiveRatingDestructiveJob(
          current,
          selected.current,
          "restaurantDelete",
          "process_dishes",
        )) {
          return {job: current, processedDocuments: 0};
        }
        const item = await loadRatingDestructiveItem(
          transaction,
          selectedItem.itemId,
        );
        if (!isFreshRatingDestructiveItem(
          item,
          selectedItem,
          current,
          "dishDeletion",
        )) {
          return {job: current, processedDocuments: 0};
        }
        const next = updateRatingDestructiveJob(transaction, current, {
          itemCursorId: null,
        }, now);
        return {job: next, processedDocuments: 0};
      });
    }
    const result = await processDishDeletionItemStep(
      dependencies,
      selected.current,
      selectedItem,
      now,
    );
    return dependencies.database.runTransaction(async (transaction) => {
      const current = await loadRatingDestructiveJob(transaction, job.jobId);
      if (!isFreshActiveRatingDestructiveJob(
        current,
        result.job,
        "restaurantDelete",
        "process_dishes",
      )) {
        return {job: current, processedDocuments: 0};
      }
      const item = await loadRatingDestructiveItem(
        transaction,
        result.item.itemId,
      );
      if (!isFreshRatingDestructiveItem(
        item,
        result.item,
        current,
        "dishDeletion",
      )) {
        return {job: current, processedDocuments: 0};
      }
      const next = updateRatingDestructiveJob(transaction, current, {
        processedCount: current.processedCount + result.processedDocuments,
        phaseProcessedCount:
          current.phaseProcessedCount + result.processedDocuments,
      }, now);
      return {job: next, processedDocuments: result.processedDocuments};
    });
  }

  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      selected.current,
      "restaurantDelete",
      "process_dishes",
    )) {
      return {job: current, processedDocuments: 0};
    }
    const restaurantId = current.sourceRestaurantId;
    if (
      current.operation !== "restaurantDelete" ||
      current.phase !== "process_dishes" ||
      restaurantId === null
    ) {
      manualFailure("unsupported_partial_state");
    }
    if (current.itemCursorId !== null) {
      return {job: current, processedDocuments: 0};
    }
    await requireOwnedRestaurantLock(transaction, current, restaurantId, "source");
    const dishes = await transaction.queryDocuments({
      collectionPath: "bitescore_dishes",
      where: Object.freeze([
        {field: "restaurantId", operator: "==", value: restaurantId},
      ]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: 1,
    });
    const dishDocument = dishes[0];
    if (dishDocument === undefined) {
      const next = updateRatingDestructiveJob(transaction, current, {
        phase: "process_orphan_reviews",
        phaseProcessedCount: 0,
        cursorDocumentId: null,
        itemCursorId: null,
        aggregateCursorDocumentId: null,
        aggregateWinnerCursorId: null,
        aggregateState: null,
      }, now);
      return {job: next, processedDocuments: 0};
    }
    const dishId = readExactProductIdentity(dishDocument.id);
    if (dishId === null) {
      manualFailure("entity_state_incompatible");
    }
    const existingDestructiveLock = await loadDishOperationLock(
      transaction,
      dishId,
    );
    if (existingDestructiveLock?.active === true) {
      retryableFailure("preexisting_job_active");
    }
    let proposalLock;
    try {
      proposalLock = parseDishMergeReviewLockDocument(
        await transaction.getDocument(dishMergeReviewLockPath(dishId)),
      );
    } catch {
      manualFailure("malformed_private_state");
    }
    if (proposalLock?.state === "active") {
      retryableFailure("preexisting_job_active");
    }
    if (await hasBlockingDishProposalJobForDish(
      transaction,
      dishId,
    )) {
      retryableFailure("preexisting_job_active");
    }
    const item = buildInitialDishDeletionItem(current, {
      dishId,
      restaurantId,
      now,
    });
    transaction.setDocument(ratingDestructiveJobItemPath(item.itemId), item);
    transaction.setDocument(
      ratingDishOperationLockPath(dishId),
      buildRatingDishOperationLockDocument({
        dishId,
        jobId: current.jobId,
        operation: current.operation,
        role: "child",
        state: "active_source",
        active: true,
        permanent: false,
        restaurantId,
        targetDishId: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const next = updateRatingDestructiveJob(transaction, current, {
      itemCursorId: item.itemId,
    }, now);
    return {job: next, processedDocuments: 1};
  });
}

async function deleteRestaurantScopedDocuments(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  collectionPath: "restaurant_reports" | "duplicate_restaurant_reports",
  nextPhase: RatingDestructiveJobDocument["phase"],
  now: Date,
): Promise<RatingRestaurantDeleteStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantDelete",
      job.phase,
    )) {
      return {job: current, processedDocuments: 0};
    }
    const restaurantId = current.sourceRestaurantId;
    if (restaurantId === null) {
      manualFailure("malformed_private_state");
    }
    await requireOwnedRestaurantLock(transaction, current, restaurantId, "source");
    const documents = await transaction.queryDocuments({
      collectionPath,
      where: Object.freeze([
        {field: "restaurantId", operator: "==", value: restaurantId},
      ]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: ratingDestructiveDirectBatchSize,
    });
    for (const document of documents) {
      transaction.deleteDocument(`${collectionPath}/${document.id}`);
    }
    const phase = documents.length < ratingDestructiveDirectBatchSize
      ? nextPhase
      : current.phase;
    const next = updateRatingDestructiveJob(transaction, current, {
      phase,
      cursorDocumentId: null,
      itemCursorId: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      aggregateState: null,
      processedCount: current.processedCount + documents.length,
      phaseProcessedCount: phase === current.phase
        ? current.phaseProcessedCount + documents.length
        : 0,
    }, now);
    return {job: next, processedDocuments: documents.length};
  });
}

async function finalizeRestaurantDelete(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantDeleteStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantDelete",
      "finalize_restaurant",
    )) {
      return {job: current, processedDocuments: 0};
    }
    const restaurantId = current.sourceRestaurantId;
    if (
      current.operation !== "restaurantDelete" ||
      current.phase !== "finalize_restaurant" ||
      restaurantId === null ||
      current.sourceActiveRestaurantRevision === null
    ) {
      manualFailure("unsupported_partial_state");
    }
    const lock = await requireOwnedRestaurantLock(
      transaction,
      current,
      restaurantId,
      "source",
    );
    const restaurantDocument = await transaction.getDocument(
      `bitescore_restaurants/${restaurantId}`,
    );
    const restaurant = parseRatingRestaurant(restaurantDocument);
    if (
      restaurant === null ||
      restaurant.revision !== current.sourceActiveRestaurantRevision
    ) {
      manualFailure("entity_state_incompatible");
    }
    const requiredQueries = [
      ["bitescore_dishes", "restaurantId"],
      ["dish_reviews", "restaurantId"],
      ["restaurant_reports", "restaurantId"],
      ["duplicate_restaurant_reports", "restaurantId"],
    ] as const;
    for (const [collectionPath, field] of requiredQueries) {
      const remaining = await transaction.queryDocuments({
        collectionPath,
        where: Object.freeze([{field, operator: "==", value: restaurantId}]),
        orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
        limit: 1,
      });
      if (remaining.length > 0) {
        retryableFailure("preexisting_job_active");
      }
    }
    const activeDishLock = await findActiveDishLockForRestaurant(
      transaction,
      restaurantId,
    );
    if (activeDishLock !== null) {
      retryableFailure("preexisting_job_active");
    }
    transaction.deleteDocument(`bitescore_restaurants/${restaurantId}`);
    transaction.setDocument(
      ratingRestaurantOperationLockPath(restaurantId),
      buildRatingRestaurantOperationLockDocument({
        restaurantId,
        jobId: current.jobId,
        operation: current.operation,
        role: "source",
        state: "deleted_source",
        active: false,
        permanent: true,
        targetRestaurantId: null,
        createdAt: lock.createdAt,
        updatedAt: now,
      }),
    );
    const completed = updateRatingDestructiveJob(transaction, current, {
      status: "complete",
      phase: "complete",
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

export async function processRestaurantDeleteStep(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantDeleteStepResult> {
  switch (job.phase) {
    case "claimed":
      return dependencies.database.runTransaction(async (transaction) => {
        const current = await loadRatingDestructiveJob(transaction, job.jobId);
        if (!isFreshActiveRatingDestructiveJob(
          current,
          job,
          "restaurantDelete",
          "claimed",
        )) {
          return {job: current, processedDocuments: 0};
        }
        const restaurantId = current.sourceRestaurantId;
        if (restaurantId === null) {
          manualFailure("malformed_private_state");
        }
        await requireOwnedRestaurantLock(
          transaction,
          current,
          restaurantId,
          "source",
        );
        const next = updateRatingDestructiveJob(transaction, current, {
          phase: "process_dishes",
          phaseProcessedCount: 0,
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
        }, now);
        return {job: next, processedDocuments: 0};
      });
    case "process_dishes":
      return await processRestaurantDishStep(dependencies, job, now);
    case "process_orphan_reviews":
      return dependencies.database.runTransaction(async (transaction) => {
        const current = await loadRatingDestructiveJob(transaction, job.jobId);
        if (!isFreshActiveRatingDestructiveJob(
          current,
          job,
          "restaurantDelete",
          "process_orphan_reviews",
        )) {
          return {job: current, processedDocuments: 0};
        }
        const restaurantId = current.sourceRestaurantId;
        if (restaurantId === null) {
          manualFailure("malformed_private_state");
        }
        await requireOwnedRestaurantLock(
          transaction,
          current,
          restaurantId,
          "source",
        );
        const result = await processFirstReviewDeletionUnit(
          transaction,
          current,
          "restaurantId",
          restaurantId,
          now,
        );
        const phase = result.found
          ? current.phase
          : "delete_restaurant_reports";
        const next = updateRatingDestructiveJob(transaction, current, {
          phase,
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          processedCount: current.processedCount + result.processedDocuments,
          phaseProcessedCount: result.found
            ? current.phaseProcessedCount + result.processedDocuments
            : 0,
        }, now);
        return {job: next, processedDocuments: result.processedDocuments};
      });
    case "delete_restaurant_reports":
      return await deleteRestaurantScopedDocuments(
        dependencies,
        job,
        "restaurant_reports",
        "delete_duplicate_reports",
        now,
      );
    case "delete_duplicate_reports":
      return await deleteRestaurantScopedDocuments(
        dependencies,
        job,
        "duplicate_restaurant_reports",
        "reconcile_milestone_users",
        now,
      );
    case "reconcile_milestone_users": {
      const result = await processNextMilestoneUserStep(
        dependencies,
        job,
        now,
      );
      if (!result.complete) {
        return {job: result.job, processedDocuments: result.processedDocuments};
      }
      return dependencies.database.runTransaction(async (transaction) => {
        const current = await loadRatingDestructiveJob(transaction, job.jobId);
        if (!isFreshActiveRatingDestructiveJob(
          current,
          result.job,
          "restaurantDelete",
          "reconcile_milestone_users",
        )) {
          return {job: current, processedDocuments: 0};
        }
        const next = updateRatingDestructiveJob(transaction, current, {
          phase: "finalize_restaurant",
          phaseProcessedCount: 0,
          cursorDocumentId: null,
          itemCursorId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
        }, now);
        return {job: next, processedDocuments: 0};
      });
    }
    case "finalize_restaurant":
      return await finalizeRestaurantDelete(dependencies, job, now);
    case "complete":
      return {job, processedDocuments: 0};
    default:
      manualFailure("unsupported_partial_state");
  }
}
