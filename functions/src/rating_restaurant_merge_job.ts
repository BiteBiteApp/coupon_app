import {
  buildRatingDestructiveJobItemDocument,
  buildRatingDishOperationLockDocument,
  buildRatingRestaurantOperationLockDocument,
  createRatingDestructiveJobItemId,
  parseRatingDestructiveJobItemDocument,
  ratingDestructiveJobItemPath,
  ratingDishOperationLockPath,
  ratingRestaurantOperationLockPath,
  type RatingDestructiveJobDocument,
  type RatingDestructiveJobItemDocument,
  type RatingDestructiveJobPhase,
  type RatingDishOperationLockDocument,
} from "./rating_destructive_job_contract.js";
import {
  dishMergeReviewLockPath,
} from "./dish_proposal_private_contract.js";
import {
  parseDishMergeReviewLockDocument,
} from "./dish_proposal_resolution_jobs.js";
import {
  foldRatingDestructiveAggregateWinnerPage,
  scanRatingDestructiveAggregateWinnerPage,
} from "./rating_destructive_aggregate.js";
import type {
  RatingDestructivePrivateTransaction,
  RatingDestructiveStoredDocument,
} from "./rating_destructive_job_store.js";
import {
  assertReviewAuthorUnlocked,
  hasBlockingDishProposalJobForDish,
  isFreshActiveRatingDestructiveJob,
  loadDishOperationLock,
  loadRatingDestructiveJob,
  manualFailure,
  nextActiveItem,
  parseRatingDish,
  parseRatingRestaurant,
  ratingDestructiveDirectBatchSize,
  readExactProductIdentity,
  requireOwnedRestaurantLock,
  retryableFailure,
  type RatingDestructiveDependencies,
  updateRatingDestructiveItem,
  updateRatingDestructiveJob,
} from "./rating_destructive_job_runtime.js";
import {
  buildRestaurantMergeMovedDishMutation,
  buildRestaurantMergeSourceRetirementMutation,
} from "./rating_destructive_semantics.js";

export type RatingRestaurantMergeStepResult = Readonly<{
  job: RatingDestructiveJobDocument;
  processedDocuments: number;
}>;

type MergeDependentPhase =
  | "move_claim_requests"
  | "move_dish_proposals"
  | "move_restaurant_reports"
  | "move_dish_reports"
  | "move_review_reports"
  | "move_review_feedback_votes"
  | "resolve_duplicate_reports";

type MergeDependentDefinition = Readonly<{
  collectionPath: string;
  nextPhase: RatingDestructiveJobPhase;
  includeRestaurantName: boolean;
  resolve: boolean;
}>;

const dependentDefinitions: Readonly<Record<
  MergeDependentPhase,
  MergeDependentDefinition
>> = Object.freeze({
  move_claim_requests: Object.freeze({
    collectionPath: "restaurant_claim_requests",
    nextPhase: "move_dish_proposals",
    includeRestaurantName: true,
    resolve: false,
  }),
  move_dish_proposals: Object.freeze({
    collectionPath: "dish_edit_proposals",
    nextPhase: "move_restaurant_reports",
    includeRestaurantName: false,
    resolve: false,
  }),
  move_restaurant_reports: Object.freeze({
    collectionPath: "restaurant_reports",
    nextPhase: "move_dish_reports",
    includeRestaurantName: true,
    resolve: false,
  }),
  move_dish_reports: Object.freeze({
    collectionPath: "dish_reports",
    nextPhase: "move_review_reports",
    includeRestaurantName: false,
    resolve: false,
  }),
  move_review_reports: Object.freeze({
    collectionPath: "review_reports",
    nextPhase: "move_review_feedback_votes",
    includeRestaurantName: false,
    resolve: false,
  }),
  move_review_feedback_votes: Object.freeze({
    collectionPath: "review_feedback_votes",
    nextPhase: "resolve_duplicate_reports",
    includeRestaurantName: false,
    resolve: false,
  }),
  resolve_duplicate_reports: Object.freeze({
    collectionPath: "duplicate_restaurant_reports",
    nextPhase: "finalize_restaurants",
    includeRestaurantName: true,
    resolve: true,
  }),
});

function requireMergeIdentity(job: RatingDestructiveJobDocument): Readonly<{
  sourceRestaurantId: string;
  targetRestaurantId: string;
}> {
  if (
    job.operation !== "restaurantMerge" ||
    job.sourceRestaurantId === null ||
    job.targetRestaurantId === null
  ) {
    manualFailure("malformed_private_state");
  }
  return {
    sourceRestaurantId: job.sourceRestaurantId,
    targetRestaurantId: job.targetRestaurantId,
  };
}

async function requireMergeRestaurantLocks(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
): Promise<void> {
  const identity = requireMergeIdentity(job);
  await requireOwnedRestaurantLock(
    transaction,
    job,
    identity.sourceRestaurantId,
    "source",
  );
  await requireOwnedRestaurantLock(
    transaction,
    job,
    identity.targetRestaurantId,
    "target",
  );
}

function emptyMovedDishItemFields(): Pick<
  RatingDestructiveJobItemDocument,
  | "currentReviewId"
  | "cursorDocumentId"
  | "secondaryCursorDocumentId"
  | "aggregateCursorDocumentId"
  | "aggregateWinnerCursorId"
  | "aggregateState"
  | "pointReversalCursor"
  | "milestoneResetCursor"
  | "milestoneReviewCursor"
  | "milestoneReconcileCursor"
  | "milestoneLockToken"
  | "milestoneScanId"
  | "validReviewCount"
  | "failureCode"
  | "completedAt"
> {
  return {
    currentReviewId: null,
    cursorDocumentId: null,
    secondaryCursorDocumentId: null,
    aggregateCursorDocumentId: null,
    aggregateWinnerCursorId: null,
    aggregateState: null,
    pointReversalCursor: null,
    milestoneResetCursor: null,
    milestoneReviewCursor: null,
    milestoneReconcileCursor: null,
    milestoneLockToken: null,
    milestoneScanId: null,
    validReviewCount: null,
    failureCode: null,
    completedAt: null,
  };
}

function buildMovedDishItem(
  job: RatingDestructiveJobDocument,
  dishId: string,
  targetRestaurantId: string,
  now: Date,
): RatingDestructiveJobItemDocument {
  const itemId = createRatingDestructiveJobItemId({
    jobId: job.jobId,
    operation: job.operation,
    kind: "movedDish",
    restaurantId: targetRestaurantId,
    dishId,
    userId: null,
  });
  return buildRatingDestructiveJobItemDocument({
    ...emptyMovedDishItemFields(),
    itemId,
    jobId: job.jobId,
    operation: job.operation,
    kind: "movedDish",
    status: "active",
    subphase: "pending",
    restaurantId: targetRestaurantId,
    dishId,
    userId: null,
    processedCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

function parseProposalLock(document: RatingDestructiveStoredDocument | null) {
  try {
    return parseDishMergeReviewLockDocument(document);
  } catch {
    manualFailure("malformed_private_state");
  }
}

async function advanceClaimedStep(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantMerge",
      "claimed",
    )) {
      return {job: current, processedDocuments: 0};
    }
    await requireMergeRestaurantLocks(transaction, current);
    const next = updateRatingDestructiveJob(transaction, current, {
      phase: "move_dishes",
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

async function moveDishPage(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantMerge",
      "move_dishes",
    )) {
      return {job: current, processedDocuments: 0};
    }
    const identity = requireMergeIdentity(current);
    await requireMergeRestaurantLocks(transaction, current);
    const target = parseRatingRestaurant(await transaction.getDocument(
      `bitescore_restaurants/${identity.targetRestaurantId}`,
    ));
    if (
      target === null ||
      target.revision !== current.targetActiveRestaurantRevision
    ) {
      manualFailure("entity_state_incompatible");
    }
    const dishes = await transaction.queryDocuments({
      collectionPath: "bitescore_dishes",
      where: Object.freeze([{
        field: "restaurantId",
        operator: "==",
        value: identity.sourceRestaurantId,
      }]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: ratingDestructiveDirectBatchSize,
    });
    const prepared: Array<Readonly<{
      document: RatingDestructiveStoredDocument;
      item: RatingDestructiveJobItemDocument;
      createChildLock: boolean;
      permanentLock: RatingDishOperationLockDocument | null;
    }>> = [];
    for (const document of dishes) {
      const dish = parseRatingDish(document);
      if (dish === null || dish.restaurantId !== identity.sourceRestaurantId) {
        manualFailure("entity_state_incompatible");
      }
      const destructiveLock = await loadDishOperationLock(
        transaction,
        dish.documentId,
      );
      if (destructiveLock?.active === true) {
        retryableFailure("preexisting_job_active");
      }
      const proposalLock = parseProposalLock(await transaction.getDocument(
        dishMergeReviewLockPath(dish.documentId),
      ));
      if (proposalLock?.state === "active") {
        retryableFailure("preexisting_job_active");
      }
      if (await hasBlockingDishProposalJobForDish(
        transaction,
        dish.documentId,
      )) {
        retryableFailure("preexisting_job_active");
      }
      const item = buildMovedDishItem(
        current,
        dish.documentId,
        identity.targetRestaurantId,
        now,
      );
      const existingItemDocument = await transaction.getDocument(
        ratingDestructiveJobItemPath(item.itemId),
      );
      if (existingItemDocument !== null) {
        const existingItem = parseRatingDestructiveJobItemDocument({
          id: existingItemDocument.id,
          data: existingItemDocument.data,
        });
        if (existingItem?.fingerprint !== item.fingerprint) {
          manualFailure("malformed_private_state");
        }
      }
      prepared.push({
        document,
        item,
        createChildLock: destructiveLock === null,
        permanentLock: destructiveLock?.permanent === true
          ? destructiveLock
          : null,
      });
    }
    for (const {
      document,
      item,
      createChildLock,
      permanentLock,
    } of prepared) {
      let movedDishMutation;
      try {
        movedDishMutation = buildRestaurantMergeMovedDishMutation({
          dishDocumentId: document.id,
          targetRestaurantId: identity.targetRestaurantId,
          targetRestaurantName: target.name,
          updatedAt: now,
        });
      } catch {
        movedDishMutation = {
          documentPath: `bitescore_dishes/${document.id}`,
          data: {
            restaurantId: identity.targetRestaurantId,
            restaurantName: target.name,
            updatedAt: now,
          },
          options: {merge: true as const},
        };
      }
      transaction.setDocument(
        movedDishMutation.documentPath,
        movedDishMutation.data,
        movedDishMutation.options,
      );
      transaction.setDocument(ratingDestructiveJobItemPath(item.itemId), item);
      if (createChildLock) {
        transaction.setDocument(
          ratingDishOperationLockPath(document.id),
          buildRatingDishOperationLockDocument({
            dishId: document.id,
            jobId: current.jobId,
            operation: current.operation,
            role: "child",
            state: "active_source",
            active: true,
            permanent: false,
            restaurantId: identity.targetRestaurantId,
            targetDishId: null,
            createdAt: now,
            updatedAt: now,
          }),
        );
      } else if (permanentLock !== null) {
        const {
          version: _version,
          fingerprint: _fingerprint,
          ...lockCore
        } = permanentLock;
        transaction.setDocument(
          ratingDishOperationLockPath(document.id),
          buildRatingDishOperationLockDocument({
            ...lockCore,
            restaurantId: identity.targetRestaurantId,
            updatedAt: now,
          }),
        );
      }
    }
    const nextPhase = dishes.length < ratingDestructiveDirectBatchSize
      ? "move_reviews"
      : current.phase;
    const next = updateRatingDestructiveJob(transaction, current, {
      phase: nextPhase,
      cursorDocumentId: null,
      itemCursorId: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      aggregateState: null,
      processedCount: current.processedCount + dishes.length,
      phaseProcessedCount: nextPhase === current.phase
        ? current.phaseProcessedCount + dishes.length
        : 0,
    }, now);
    return {job: next, processedDocuments: dishes.length};
  });
}

async function assertReviewOperationLocks(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  review: RatingDestructiveStoredDocument,
): Promise<void> {
  await assertReviewAuthorUnlocked(transaction, review);
  const dishId = readExactProductIdentity(review.data.dishId);
  if (dishId === null) {
    manualFailure("entity_state_incompatible");
  }
  const destructiveLock = await loadDishOperationLock(transaction, dishId);
  if (
    destructiveLock?.active === true &&
    destructiveLock.jobId !== job.jobId
  ) {
    retryableFailure("preexisting_job_active");
  }
  const proposalLock = parseProposalLock(await transaction.getDocument(
    dishMergeReviewLockPath(dishId),
  ));
  if (proposalLock?.state === "active") {
    retryableFailure("preexisting_job_active");
  }
}

async function moveReviewPage(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantMerge",
      "move_reviews",
    )) {
      return {job: current, processedDocuments: 0};
    }
    const identity = requireMergeIdentity(current);
    await requireMergeRestaurantLocks(transaction, current);
    const reviews = await transaction.queryDocuments({
      collectionPath: "dish_reviews",
      where: Object.freeze([{
        field: "restaurantId",
        operator: "==",
        value: identity.sourceRestaurantId,
      }]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: ratingDestructiveDirectBatchSize,
    });
    for (const review of reviews) {
      await assertReviewOperationLocks(transaction, current, review);
    }
    for (const review of reviews) {
      transaction.setDocument(`dish_reviews/${review.id}`, {
        restaurantId: identity.targetRestaurantId,
        updatedAt: now,
      }, {merge: true});
    }
    const nextPhase = reviews.length < ratingDestructiveDirectBatchSize
      ? "rebuild_moved_dish_aggregates"
      : current.phase;
    const next = updateRatingDestructiveJob(transaction, current, {
      phase: nextPhase,
      cursorDocumentId: null,
      itemCursorId: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      aggregateState: null,
      processedCount: current.processedCount + reviews.length,
      phaseProcessedCount: nextPhase === current.phase
        ? current.phaseProcessedCount + reviews.length
        : 0,
    }, now);
    return {job: next, processedDocuments: reviews.length};
  });
}

async function processMovedDishAggregateStep(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantMerge",
      "rebuild_moved_dish_aggregates",
    )) {
      return {job: current, processedDocuments: 0};
    }
    await requireMergeRestaurantLocks(transaction, current);
    const item = await nextActiveItem(transaction, current, "movedDish");
    if (item === null) {
      const next = updateRatingDestructiveJob(transaction, current, {
        phase: "move_claim_requests",
        phaseProcessedCount: 0,
        cursorDocumentId: null,
        itemCursorId: null,
        aggregateCursorDocumentId: null,
        aggregateWinnerCursorId: null,
        aggregateState: null,
      }, now);
      return {job: next, processedDocuments: 0};
    }
    if (item.dishId === null || item.restaurantId === null) {
      manualFailure("malformed_private_state");
    }
    const dishLock = await loadDishOperationLock(transaction, item.dishId);
    const ownsActiveChildLock = dishLock?.jobId === current.jobId &&
      dishLock.operation === "restaurantMerge" &&
      dishLock.role === "child" &&
      dishLock.active &&
      !dishLock.permanent;
    if (!ownsActiveChildLock && dishLock?.permanent !== true) {
      manualFailure("lock_missing");
    }
    const proposalLock = parseProposalLock(await transaction.getDocument(
      dishMergeReviewLockPath(item.dishId),
    ));
    if (proposalLock?.state === "active") {
      retryableFailure("preexisting_job_active");
    }
    if (item.subphase === "pending") {
      const nextItem = updateRatingDestructiveItem(transaction, item, {
        subphase: "rebuild_aggregate",
        aggregateCursorDocumentId: null,
        aggregateWinnerCursorId: null,
        aggregateState: null,
      }, now);
      return {job: current, processedDocuments: nextItem.processedCount};
    }
    if (item.subphase === "rebuild_aggregate") {
      const result = await scanRatingDestructiveAggregateWinnerPage(
        transaction,
        {
          namespaceId: item.itemId,
          role: "source",
          dishId: item.dishId,
          cursorDocumentId: item.aggregateCursorDocumentId,
          now,
        },
      );
      updateRatingDestructiveItem(transaction, item, {
        subphase: result.complete ? "fold_aggregate" : "rebuild_aggregate",
        aggregateCursorDocumentId: result.complete
          ? null
          : result.nextCursorDocumentId,
        aggregateWinnerCursorId: null,
        aggregateState: null,
        processedCount: item.processedCount + result.processedDocuments,
      }, now);
      const nextJob = updateRatingDestructiveJob(transaction, current, {
        processedCount: current.processedCount + result.processedDocuments,
        phaseProcessedCount:
          current.phaseProcessedCount + result.processedDocuments,
      }, now);
      return {job: nextJob, processedDocuments: result.processedDocuments};
    }
    if (item.subphase === "fold_aggregate") {
      const dish = parseRatingDish(await transaction.getDocument(
        `bitescore_dishes/${item.dishId}`,
      ));
      if (dish === null || dish.restaurantId !== item.restaurantId) {
        manualFailure("entity_state_incompatible");
      }
      const result = await foldRatingDestructiveAggregateWinnerPage(
        transaction,
        {
          namespaceId: item.itemId,
          role: "source",
          dishId: item.dishId,
          restaurantId: item.restaurantId,
          cursorDocumentId: item.aggregateWinnerCursorId,
          aggregateState: item.aggregateState,
        },
      );
      if (result.complete) {
        if (result.aggregate === null) {
          manualFailure("malformed_private_state");
        }
        transaction.setDocument(`dish_rating_aggregates/${item.dishId}`, {
          ...result.aggregate,
          aggregateWriteGeneration: dish.aggregateWriteGeneration,
          updatedAt: now,
        });
        if (ownsActiveChildLock) {
          transaction.deleteDocument(ratingDishOperationLockPath(item.dishId));
        }
        updateRatingDestructiveItem(transaction, item, {
          status: "complete",
          subphase: "complete",
          currentReviewId: null,
          cursorDocumentId: null,
          secondaryCursorDocumentId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          pointReversalCursor: null,
          milestoneResetCursor: null,
          milestoneReviewCursor: null,
          milestoneReconcileCursor: null,
          milestoneLockToken: null,
          milestoneScanId: null,
          validReviewCount: null,
          processedCount: item.processedCount + result.processedDocuments,
          completedAt: now,
        }, now);
      } else {
        updateRatingDestructiveItem(transaction, item, {
          aggregateWinnerCursorId: result.nextCursorDocumentId,
          aggregateState: result.accumulator,
          processedCount: item.processedCount + result.processedDocuments,
        }, now);
      }
      const nextJob = updateRatingDestructiveJob(transaction, current, {
        processedCount: current.processedCount + result.processedDocuments,
        phaseProcessedCount:
          current.phaseProcessedCount + result.processedDocuments,
      }, now);
      return {job: nextJob, processedDocuments: result.processedDocuments};
    }
    manualFailure("unsupported_partial_state");
  });
}

async function moveDependentPage(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  phase: MergeDependentPhase,
  now: Date,
): Promise<RatingRestaurantMergeStepResult> {
  const definition = dependentDefinitions[phase];
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantMerge",
      phase,
    )) {
      return {job: current, processedDocuments: 0};
    }
    const identity = requireMergeIdentity(current);
    await requireMergeRestaurantLocks(transaction, current);
    const target = parseRatingRestaurant(await transaction.getDocument(
      `bitescore_restaurants/${identity.targetRestaurantId}`,
    ));
    if (
      target === null ||
      target.revision !== current.targetActiveRestaurantRevision
    ) {
      manualFailure("entity_state_incompatible");
    }
    const documents = await transaction.queryDocuments({
      collectionPath: definition.collectionPath,
      where: Object.freeze([{
        field: "restaurantId",
        operator: "==",
        value: identity.sourceRestaurantId,
      }]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: ratingDestructiveDirectBatchSize,
    });
    for (const document of documents) {
      const patch: Record<string, unknown> = {
        restaurantId: identity.targetRestaurantId,
        updatedAt: now,
      };
      if (definition.includeRestaurantName) {
        patch.restaurantName = target.name;
      }
      if (definition.resolve) {
        patch.status = "resolved";
      }
      transaction.setDocument(
        `${definition.collectionPath}/${document.id}`,
        patch,
        {merge: true},
      );
    }
    const nextPhase = documents.length < ratingDestructiveDirectBatchSize
      ? definition.nextPhase
      : current.phase;
    const next = updateRatingDestructiveJob(transaction, current, {
      phase: nextPhase,
      cursorDocumentId: null,
      itemCursorId: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      aggregateState: null,
      processedCount: current.processedCount + documents.length,
      phaseProcessedCount: nextPhase === current.phase
        ? current.phaseProcessedCount + documents.length
        : 0,
    }, now);
    return {job: next, processedDocuments: documents.length};
  });
}

async function verifyNoMergeDependentsRemain(
  transaction: RatingDestructivePrivateTransaction,
  sourceRestaurantId: string,
): Promise<void> {
  const collections = [
    "bitescore_dishes",
    "dish_reviews",
    "restaurant_claim_requests",
    "dish_edit_proposals",
    "restaurant_reports",
    "dish_reports",
    "review_reports",
    "review_feedback_votes",
    "duplicate_restaurant_reports",
  ] as const;
  for (const collectionPath of collections) {
    const remaining = await transaction.queryDocuments({
      collectionPath,
      where: Object.freeze([{
        field: "restaurantId",
        operator: "==",
        value: sourceRestaurantId,
      }]),
      orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
      limit: 1,
    });
    if (remaining.length > 0) {
      retryableFailure("preexisting_job_active");
    }
  }
}

async function finalizeRestaurantMerge(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantMergeStepResult> {
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "restaurantMerge",
      "finalize_restaurants",
    )) {
      return {job: current, processedDocuments: 0};
    }
    const identity = requireMergeIdentity(current);
    if (
      current.sourceActiveRestaurantRevision === null ||
      current.sourceCompletionRestaurantRevision === null ||
      current.targetActiveRestaurantRevision === null ||
      current.targetCompletionRestaurantRevision === null
    ) {
      manualFailure("unsupported_partial_state");
    }
    const sourceLock = await requireOwnedRestaurantLock(
      transaction,
      current,
      identity.sourceRestaurantId,
      "source",
    );
    await requireOwnedRestaurantLock(
      transaction,
      current,
      identity.targetRestaurantId,
      "target",
    );
    const source = parseRatingRestaurant(await transaction.getDocument(
      `bitescore_restaurants/${identity.sourceRestaurantId}`,
    ));
    const target = parseRatingRestaurant(await transaction.getDocument(
      `bitescore_restaurants/${identity.targetRestaurantId}`,
    ));
    if (
      source === null ||
      target === null ||
      source.revision !== current.sourceActiveRestaurantRevision ||
      target.revision !== current.targetActiveRestaurantRevision
    ) {
      manualFailure("entity_state_incompatible");
    }
    const activeItem = await nextActiveItem(transaction, current, "movedDish");
    if (activeItem !== null) {
      retryableFailure("preexisting_job_active");
    }
    await verifyNoMergeDependentsRemain(
      transaction,
      identity.sourceRestaurantId,
    );
    const mergedOwnerUserId = target.ownerUserId ?? source.ownerUserId;
    const mergedCuisineTags = [...new Set([
      ...target.cuisineTags,
      ...source.cuisineTags,
    ])].sort();
    transaction.setDocument(
      `bitescore_restaurants/${identity.targetRestaurantId}`,
      {
        phone: target.phone ?? source.phone,
        bio: target.bio ?? source.bio,
        cuisineTags: mergedCuisineTags,
        ownerUserId: mergedOwnerUserId,
        isClaimed:
          target.isClaimed || source.isClaimed || mergedOwnerUserId !== null,
        isActive: true,
        restaurantWriteRevision: current.targetCompletionRestaurantRevision,
        updatedAt: now,
      },
      {merge: true},
    );
    let sourceRetirementMutation;
    try {
      sourceRetirementMutation = buildRestaurantMergeSourceRetirementMutation({
        sourceRestaurantDocumentId: identity.sourceRestaurantId,
        restaurantWriteRevision: current.sourceCompletionRestaurantRevision,
        updatedAt: now,
      });
    } catch {
      sourceRetirementMutation = {
        documentPath: `bitescore_restaurants/${identity.sourceRestaurantId}`,
        data: {
          isActive: false,
          isClaimed: false,
          ownerUserId: null,
          restaurantWriteRevision: current.sourceCompletionRestaurantRevision,
          updatedAt: now,
        },
        options: {merge: true as const},
      };
    }
    transaction.setDocument(
      sourceRetirementMutation.documentPath,
      sourceRetirementMutation.data,
      sourceRetirementMutation.options,
    );
    transaction.setDocument(
      ratingRestaurantOperationLockPath(identity.sourceRestaurantId),
      buildRatingRestaurantOperationLockDocument({
        restaurantId: identity.sourceRestaurantId,
        jobId: current.jobId,
        operation: "restaurantMerge",
        role: "source",
        state: "merged_source",
        active: false,
        permanent: true,
        targetRestaurantId: identity.targetRestaurantId,
        createdAt: sourceLock.createdAt,
        updatedAt: now,
      }),
    );
    transaction.deleteDocument(
      ratingRestaurantOperationLockPath(identity.targetRestaurantId),
    );
    const complete = updateRatingDestructiveJob(transaction, current, {
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
    return {job: complete, processedDocuments: 2};
  });
}

export async function processRestaurantMergeStep(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingRestaurantMergeStepResult> {
  switch (job.phase) {
    case "claimed":
      return await advanceClaimedStep(dependencies, job, now);
    case "move_dishes":
      return await moveDishPage(dependencies, job, now);
    case "move_reviews":
      return await moveReviewPage(dependencies, job, now);
    case "rebuild_moved_dish_aggregates":
      return await processMovedDishAggregateStep(dependencies, job, now);
    case "move_claim_requests":
    case "move_dish_proposals":
    case "move_restaurant_reports":
    case "move_dish_reports":
    case "move_review_reports":
    case "move_review_feedback_votes":
    case "resolve_duplicate_reports":
      return await moveDependentPage(dependencies, job, job.phase, now);
    case "finalize_restaurants":
      return await finalizeRestaurantMerge(dependencies, job, now);
    case "complete":
      return {job, processedDocuments: 0};
    default:
      manualFailure("unsupported_partial_state");
  }
}
