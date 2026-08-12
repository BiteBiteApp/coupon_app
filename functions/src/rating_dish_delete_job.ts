import {createHash} from "node:crypto";

import {
  buildRatingDestructiveJobItemDocument,
  buildRatingDishOperationLockDocument,
  createRatingDestructiveJobItemId,
  parseRatingDestructiveJobItemDocument,
  ratingDestructiveJobItemPath,
  ratingDishOperationLockPath,
  type RatingDestructiveJobDocument,
  type RatingDestructiveJobItemDocument,
} from "./rating_destructive_job_contract.js";
import type {
  RatingDestructivePrivateTransaction,
  RatingDestructiveStoredDocument,
} from "./rating_destructive_job_store.js";
import {
  assertReviewAuthorUnlocked,
  isFreshActiveRatingDestructiveJob,
  isFreshRatingDestructiveItem,
  loadRatingDestructiveItem,
  loadRatingDestructiveJob,
  manualFailure,
  nextActiveItem,
  ratingDestructiveDirectBatchSize,
  ratingDestructiveTrustBatchSize,
  requireOwnedDishLock,
  retryableFailure,
  type RatingDestructiveDependencies,
  updateRatingDestructiveItem,
  updateRatingDestructiveJob,
} from "./rating_destructive_job_runtime.js";

export type RatingDishDeleteStepResult = Readonly<{
  job: RatingDestructiveJobDocument;
  processedDocuments: number;
}>;

async function requireDeletionDishLock(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  item: RatingDestructiveJobItemDocument,
) {
  if (
    item.dishId === null ||
    (job.operation !== "dishDelete" && job.operation !== "restaurantDelete")
  ) {
    manualFailure("malformed_private_state");
  }
  const lock = await requireOwnedDishLock(transaction, job, item.dishId);
  const expectedRole = job.operation === "restaurantDelete"
    ? "child"
    : "source";
  if (
    lock.role !== expectedRole ||
    lock.state !== "active_source" ||
    lock.restaurantId !== item.restaurantId ||
    lock.targetDishId !== null
  ) {
    manualFailure("lock_missing");
  }
  return lock;
}

function milestoneLockToken(
  jobId: string,
  itemId: string,
  userId: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([
      "bitestar.rating-destructive-milestone-lock-token.v1",
      ["jobId", jobId],
      ["itemId", itemId],
      ["userId", userId],
    ]), "utf8")
    .digest("hex");
}

function emptyItemFields(): Pick<
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
    validReviewCount: null,
    failureCode: null,
    completedAt: null,
  };
}

export function buildInitialDishDeletionItem(
  job: RatingDestructiveJobDocument,
  value: Readonly<{
    dishId: string;
    restaurantId: string | null;
    now: Date;
  }>,
): RatingDestructiveJobItemDocument {
  const itemId = createRatingDestructiveJobItemId({
    jobId: job.jobId,
    operation: job.operation,
    kind: "dishDeletion",
    restaurantId: value.restaurantId,
    dishId: value.dishId,
    userId: null,
  });
  return buildRatingDestructiveJobItemDocument({
    ...emptyItemFields(),
    itemId,
    jobId: job.jobId,
    operation: job.operation,
    kind: "dishDeletion",
    status: "active",
    subphase: "claimed_or_attached",
    restaurantId: value.restaurantId,
    dishId: value.dishId,
    userId: null,
    milestoneLockToken: null,
    milestoneScanId: null,
    processedCount: 0,
    createdAt: value.now,
    updatedAt: value.now,
  });
}

async function materializeMilestoneUser(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  userId: string,
  now: Date,
): Promise<RatingDestructiveJobItemDocument> {
  const itemId = createRatingDestructiveJobItemId({
    jobId: job.jobId,
    operation: job.operation,
    kind: "milestoneUser",
    restaurantId: null,
    dishId: null,
    userId,
  });
  const path = ratingDestructiveJobItemPath(itemId);
  const existingDocument = await transaction.getDocument(path);
  if (existingDocument !== null) {
    const existing = parseRatingDestructiveJobItemDocument({
      id: existingDocument.id,
      data: existingDocument.data,
    });
    if (
      existing === null ||
      existing.jobId !== job.jobId ||
      existing.kind !== "milestoneUser" ||
      existing.userId !== userId
    ) {
      manualFailure("malformed_private_state");
    }
    return existing;
  }
  const item = buildRatingDestructiveJobItemDocument({
    ...emptyItemFields(),
    itemId,
    jobId: job.jobId,
    operation: job.operation,
    kind: "milestoneUser",
    status: "active",
    subphase: "claim_lock",
    restaurantId: null,
    dishId: null,
    userId,
    milestoneLockToken: milestoneLockToken(job.jobId, itemId, userId),
    milestoneScanId: itemId,
    processedCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  transaction.setDocument(path, item);
  return item;
}

async function queryTrustDocuments(
  transaction: RatingDestructivePrivateTransaction,
  collectionPath: "review_feedback_votes" | "review_reports",
  reviewId: string,
): Promise<readonly RatingDestructiveStoredDocument[]> {
  return await transaction.queryDocuments({
    collectionPath,
    where: Object.freeze([
      {field: "reviewId", operator: "==", value: reviewId},
    ]),
    orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
    limit: ratingDestructiveTrustBatchSize,
  });
}

/**
 * Drains at most one 50-document trust page or deletes one fully-drained
 * review. A deterministic milestone-user item is committed before the review
 * identity is removed.
 */
export async function processFirstReviewDeletionUnit(
  transaction: RatingDestructivePrivateTransaction,
  job: RatingDestructiveJobDocument,
  queryField: "dishId" | "restaurantId",
  queryValue: string,
  now: Date,
): Promise<Readonly<{found: boolean; processedDocuments: number}>> {
  const reviews = await transaction.queryDocuments({
    collectionPath: "dish_reviews",
    where: Object.freeze([
      {field: queryField, operator: "==", value: queryValue},
    ]),
    orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
    limit: 1,
  });
  const review = reviews[0];
  if (review === undefined) {
    return {found: false, processedDocuments: 0};
  }
  await assertReviewAuthorUnlocked(transaction, review);
  const votes = await queryTrustDocuments(
    transaction,
    "review_feedback_votes",
    review.id,
  );
  if (votes.length > 0) {
    for (const vote of votes) {
      transaction.deleteDocument(`review_feedback_votes/${vote.id}`);
    }
    return {found: true, processedDocuments: votes.length};
  }
  const reports = await queryTrustDocuments(
    transaction,
    "review_reports",
    review.id,
  );
  if (reports.length > 0) {
    for (const report of reports) {
      transaction.deleteDocument(`review_reports/${report.id}`);
    }
    return {found: true, processedDocuments: reports.length};
  }
  const userId = typeof review.data.userId === "string" &&
      review.data.userId.length > 0
    ? review.data.userId
    : null;
  if (userId !== null) {
    await materializeMilestoneUser(transaction, job, userId, now);
  }
  transaction.deleteDocument(`dish_reviews/${review.id}`);
  return {found: true, processedDocuments: 1};
}

async function processTransactionalDishDeletionStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  expectedItem: RatingDestructiveJobItemDocument,
  now: Date,
): Promise<Readonly<{
  job: RatingDestructiveJobDocument;
  item: RatingDestructiveJobItemDocument;
  processedDocuments: number;
}>> {
  return dependencies.database.runTransaction(async (transaction) => {
    const job = await loadRatingDestructiveJob(transaction, expectedJob.jobId);
    const item = await loadRatingDestructiveItem(
      transaction,
      expectedItem.itemId,
    );
    if (
      (expectedJob.operation !== "dishDelete" &&
        expectedJob.operation !== "restaurantDelete") ||
      !isFreshActiveRatingDestructiveJob(
        job,
        expectedJob,
        expectedJob.operation,
        expectedJob.phase,
      ) ||
      !isFreshRatingDestructiveItem(
        item,
        expectedItem,
        job,
        "dishDeletion",
      )
    ) {
      return {job, item, processedDocuments: 0};
    }
    if (
      item.jobId !== job.jobId ||
      item.kind !== "dishDeletion" ||
      item.dishId === null ||
      (job.operation === "restaurantDelete" && item.restaurantId === null)
    ) {
      manualFailure("malformed_private_state");
    }
    if (item.status === "complete") {
      return {job, item, processedDocuments: 0};
    }
    await requireDeletionDishLock(transaction, job, item);
    if (item.subphase === "claimed_or_attached") {
      return {
        job,
        item: updateRatingDestructiveItem(transaction, item, {
          subphase: "process_reviews",
          currentReviewId: null,
          cursorDocumentId: null,
          secondaryCursorDocumentId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          pointReversalCursor: null,
        }, now),
        processedDocuments: 0,
      };
    }
    if (item.subphase === "process_reviews") {
      const result = await processFirstReviewDeletionUnit(
        transaction,
        job,
        "dishId",
        item.dishId,
        now,
      );
      if (result.found) {
        return {
          job,
          item: updateRatingDestructiveItem(transaction, item, {
            processedCount: item.processedCount + result.processedDocuments,
          }, now),
          processedDocuments: result.processedDocuments,
        };
      }
      return {
        job,
        item: updateRatingDestructiveItem(transaction, item, {
          subphase: "reverse_contribution_points",
          currentReviewId: null,
          cursorDocumentId: null,
          secondaryCursorDocumentId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          pointReversalCursor: null,
        }, now),
        processedDocuments: 0,
      };
    }
    if (item.subphase === "delete_dish_reports") {
      const reports = await transaction.queryDocuments({
        collectionPath: "dish_reports",
        where: Object.freeze([
          {field: "dishId", operator: "==", value: item.dishId},
        ]),
        orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
        limit: ratingDestructiveDirectBatchSize,
      });
      for (const report of reports) {
        transaction.deleteDocument(`dish_reports/${report.id}`);
      }
      return {
        job,
        item: updateRatingDestructiveItem(transaction, item, {
          subphase: reports.length < ratingDestructiveDirectBatchSize
            ? "delete_aggregate"
            : "delete_dish_reports",
          currentReviewId: null,
          cursorDocumentId: null,
          secondaryCursorDocumentId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          pointReversalCursor: null,
          processedCount: item.processedCount + reports.length,
        }, now),
        processedDocuments: reports.length,
      };
    }
    if (item.subphase === "delete_aggregate") {
      transaction.deleteDocument(`dish_rating_aggregates/${item.dishId}`);
      return {
        job,
        item: updateRatingDestructiveItem(transaction, item, {
          subphase: "delete_dish",
          currentReviewId: null,
          cursorDocumentId: null,
          secondaryCursorDocumentId: null,
          aggregateCursorDocumentId: null,
          aggregateWinnerCursorId: null,
          aggregateState: null,
          pointReversalCursor: null,
        }, now),
        processedDocuments: 1,
      };
    }
    if (item.subphase === "delete_dish") {
      const lock = await requireDeletionDishLock(transaction, job, item);
      const [remainingReviews, remainingReports] = await Promise.all([
        transaction.queryDocuments({
          collectionPath: "dish_reviews",
          where: Object.freeze([{
            field: "dishId",
            operator: "==",
            value: item.dishId,
          }]),
          orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
          limit: 1,
        }),
        transaction.queryDocuments({
          collectionPath: "dish_reports",
          where: Object.freeze([{
            field: "dishId",
            operator: "==",
            value: item.dishId,
          }]),
          orderBy: Object.freeze([{field: "__name__", direction: "asc"}]),
          limit: 1,
        }),
      ]);
      if (remainingReviews.length > 0 || remainingReports.length > 0) {
        retryableFailure("preexisting_job_active");
      }
      transaction.deleteDocument(`bitescore_dishes/${item.dishId}`);
      if (job.operation === "restaurantDelete") {
        transaction.setDocument(
          ratingDishOperationLockPath(item.dishId),
          buildRatingDishOperationLockDocument({
            dishId: item.dishId,
            jobId: job.jobId,
            operation: job.operation,
            role: lock.role,
            state: "deleted_source",
            active: false,
            permanent: true,
            restaurantId: item.restaurantId,
            targetDishId: null,
            createdAt: lock.createdAt,
            updatedAt: now,
          }),
        );
      }
      return {
        job,
        item: updateRatingDestructiveItem(transaction, item, {
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
          completedAt: now,
        }, now),
        processedDocuments: 1,
      };
    }
    manualFailure("unsupported_partial_state");
  });
}

async function processPointReversalStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  expectedItem: RatingDestructiveJobItemDocument,
  now: Date,
): Promise<Readonly<{
  job: RatingDestructiveJobDocument;
  item: RatingDestructiveJobItemDocument;
  processedDocuments: number;
}>> {
  const snapshot = await dependencies.database.runTransaction(
    async (transaction) => {
      const job = await loadRatingDestructiveJob(
        transaction,
        expectedJob.jobId,
      );
      const item = await loadRatingDestructiveItem(
        transaction,
        expectedItem.itemId,
      );
      if (
        (expectedJob.operation !== "dishDelete" &&
          expectedJob.operation !== "restaurantDelete") ||
        !isFreshActiveRatingDestructiveJob(
          job,
          expectedJob,
          expectedJob.operation,
          expectedJob.phase,
        ) ||
        !isFreshRatingDestructiveItem(
          item,
          expectedItem,
          job,
          "dishDeletion",
        )
      ) {
        return {job, item, canAdvance: false};
      }
      if (
        item.jobId !== job.jobId ||
        item.kind !== "dishDeletion" ||
        item.subphase !== "reverse_contribution_points" ||
        item.dishId === null
      ) {
        manualFailure("malformed_private_state");
      }
      await requireDeletionDishLock(transaction, job, item);
      return {job, item, canAdvance: true};
    },
  );
  if (!snapshot.canAdvance) {
    return {job: snapshot.job, item: snapshot.item, processedDocuments: 0};
  }
  const result = await dependencies.external.reverseDishContributionPointsStep({
    operationId: snapshot.job.jobId,
    dishId: snapshot.item.dishId as string,
    cursor: snapshot.item.pointReversalCursor,
    jobGuard: {
      jobId: snapshot.job.jobId,
      operation: snapshot.job.operation,
      phase: snapshot.job.phase,
      fingerprint: snapshot.job.fingerprint,
      itemId: snapshot.item.itemId,
      itemFingerprint: snapshot.item.fingerprint,
    },
  });
  return dependencies.database.runTransaction(async (transaction) => {
    const job = await loadRatingDestructiveJob(
      transaction,
      snapshot.job.jobId,
    );
    const item = await loadRatingDestructiveItem(
      transaction,
      snapshot.item.itemId,
    );
    if (
      !isFreshActiveRatingDestructiveJob(
        job,
        snapshot.job,
        snapshot.job.operation,
        snapshot.job.phase,
      ) ||
      !isFreshRatingDestructiveItem(
        item,
        snapshot.item,
        job,
        "dishDeletion",
      )
    ) {
      return {job, item, processedDocuments: 0};
    }
    if (item.dishId === null) {
      manualFailure("malformed_private_state");
    }
    await requireDeletionDishLock(transaction, job, item);
    const next = updateRatingDestructiveItem(transaction, item, {
      subphase: result.complete
        ? "delete_dish_reports"
        : "reverse_contribution_points",
      pointReversalCursor: result.complete ? null : result.nextCursor,
      currentReviewId: null,
      cursorDocumentId: null,
      secondaryCursorDocumentId: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      aggregateState: null,
      processedCount: item.processedCount + result.processedCount,
    }, now);
    return {job, item: next, processedDocuments: result.processedCount};
  });
}

export async function processDishDeletionItemStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  expectedItem: RatingDestructiveJobItemDocument,
  now: Date,
): Promise<Readonly<{
  job: RatingDestructiveJobDocument;
  item: RatingDestructiveJobItemDocument;
  processedDocuments: number;
}>> {
  if (expectedItem.subphase === "reverse_contribution_points") {
    return await processPointReversalStep(
      dependencies,
      expectedJob,
      expectedItem,
      now,
    );
  }
  return await processTransactionalDishDeletionStep(
    dependencies,
    expectedJob,
    expectedItem,
    now,
  );
}

function milestoneIdentity(item: RatingDestructiveJobItemDocument) {
  if (
    item.kind !== "milestoneUser" ||
    item.userId === null ||
    item.milestoneLockToken === null ||
    item.milestoneScanId === null
  ) {
    manualFailure("malformed_private_state");
  }
  return {
    userId: item.userId,
    operationId: item.jobId,
    lockToken: item.milestoneLockToken,
    namespaceId: item.itemId,
    scanId: item.milestoneScanId,
  };
}

export async function processMilestoneUserItemStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  expectedItem: RatingDestructiveJobItemDocument,
  now: Date,
): Promise<Readonly<{
  job: RatingDestructiveJobDocument;
  item: RatingDestructiveJobItemDocument;
  processedDocuments: number;
}>> {
  const snapshot = await dependencies.database.runTransaction(async (
    transaction,
  ) => {
    const job = await loadRatingDestructiveJob(
      transaction,
      expectedJob.jobId,
    );
    const item = await loadRatingDestructiveItem(
      transaction,
      expectedItem.itemId,
    );
    if (
      (expectedJob.operation !== "dishDelete" &&
        expectedJob.operation !== "restaurantDelete") ||
      !isFreshActiveRatingDestructiveJob(
        job,
        expectedJob,
        expectedJob.operation,
        expectedJob.phase,
      ) ||
      !isFreshRatingDestructiveItem(
        item,
        expectedItem,
        job,
        "milestoneUser",
      )
    ) {
      return {job, item, canAdvance: false};
    }
    if (item.jobId !== job.jobId || item.kind !== "milestoneUser") {
      manualFailure("malformed_private_state");
    }
    return {job, item, canAdvance: true};
  });
  if (!snapshot.canAdvance) {
    return {job: snapshot.job, item: snapshot.item, processedDocuments: 0};
  }
  if (snapshot.item.subphase === "complete") {
    return {
      job: snapshot.job,
      item: snapshot.item,
      processedDocuments: 0,
    };
  }
  const identity = milestoneIdentity(snapshot.item);
  let changes: Partial<Omit<
    RatingDestructiveJobItemDocument,
    "version" | "itemId" | "fingerprint"
  >>;
  let processedDocuments = 0;
  switch (snapshot.item.subphase) {
    case "claim_lock": {
      const result = await dependencies.external.claimMilestoneUser(
        identity,
        now,
      );
      changes = result.status === "already-released"
        ? {
            status: "complete",
            subphase: "complete",
            milestoneResetCursor: null,
            milestoneReviewCursor: null,
            milestoneReconcileCursor: null,
            milestoneLockToken: null,
            milestoneScanId: null,
            validReviewCount: null,
            completedAt: now,
          }
        : {
            subphase: "reset_count_accumulator",
            milestoneResetCursor: null,
            milestoneReviewCursor: null,
            milestoneReconcileCursor: null,
            validReviewCount: null,
          };
      break;
    }
    case "reset_count_accumulator": {
      const result = await dependencies.external.resetMilestoneAccumulatorStep(
        identity,
        snapshot.item.milestoneResetCursor,
      );
      processedDocuments = result.processedCount;
      changes = {
        milestoneResetCursor: result.complete ? null : result.nextCursor,
        milestoneReviewCursor: null,
        milestoneReconcileCursor: null,
        validReviewCount: null,
        subphase: result.complete
          ? "count_reviews"
          : "reset_count_accumulator",
      };
      break;
    }
    case "count_reviews": {
      const result = await dependencies.external.scanMilestoneReviewsStep(
        identity,
        snapshot.item.milestoneReviewCursor,
      );
      processedDocuments = result.processedCount;
      changes = {
        milestoneResetCursor: null,
        milestoneReviewCursor: result.complete ? null : result.nextCursor,
        milestoneReconcileCursor: null,
        validReviewCount: result.complete ? result.validReviewCount : null,
        subphase: result.complete ? "reconcile_milestones" : "count_reviews",
      };
      break;
    }
    case "reconcile_milestones": {
      if (snapshot.item.validReviewCount === null) {
        manualFailure("unsupported_partial_state");
      }
      const result = await dependencies.external.reconcileMilestoneStep(
        identity,
        snapshot.item.validReviewCount,
        snapshot.item.milestoneReconcileCursor,
      );
      processedDocuments = result.processedCount;
      changes = {
        milestoneResetCursor: null,
        milestoneReviewCursor: null,
        milestoneReconcileCursor: result.complete ? null : result.nextCursor,
        subphase: result.complete
          ? "record_terminal"
          : "reconcile_milestones",
      };
      break;
    }
    case "record_terminal":
      changes = {
        subphase: "release_lock",
        milestoneResetCursor: null,
        milestoneReviewCursor: null,
        milestoneReconcileCursor: null,
      };
      break;
    case "release_lock":
      await dependencies.external.releaseMilestoneUser(identity, now);
      changes = {
        status: "complete",
        subphase: "complete",
        milestoneResetCursor: null,
        milestoneReviewCursor: null,
        milestoneReconcileCursor: null,
        milestoneLockToken: null,
        milestoneScanId: null,
        validReviewCount: null,
        completedAt: now,
      };
      break;
    default:
      manualFailure("unsupported_partial_state");
  }
  return dependencies.database.runTransaction(async (transaction) => {
    const job = await loadRatingDestructiveJob(
      transaction,
      snapshot.job.jobId,
    );
    const item = await loadRatingDestructiveItem(
      transaction,
      snapshot.item.itemId,
    );
    if (
      !isFreshActiveRatingDestructiveJob(
        job,
        snapshot.job,
        snapshot.job.operation,
        snapshot.job.phase,
      ) ||
      !isFreshRatingDestructiveItem(
        item,
        snapshot.item,
        job,
        "milestoneUser",
      )
    ) {
      return {job, item, processedDocuments: 0};
    }
    const next = updateRatingDestructiveItem(transaction, item, {
      ...changes,
      processedCount: item.processedCount + processedDocuments,
    }, now);
    return {job, item: next, processedDocuments};
  });
}

export async function processNextMilestoneUserStep(
  dependencies: RatingDestructiveDependencies,
  expectedJob: RatingDestructiveJobDocument,
  now: Date,
): Promise<Readonly<{
  job: RatingDestructiveJobDocument;
  processedDocuments: number;
  complete: boolean;
}>> {
  const selection = await dependencies.database.runTransaction(async (
    transaction,
  ) => {
    const job = await loadRatingDestructiveJob(
      transaction,
      expectedJob.jobId,
    );
    if (
      (expectedJob.operation !== "dishDelete" &&
        expectedJob.operation !== "restaurantDelete") ||
      !isFreshActiveRatingDestructiveJob(
        job,
        expectedJob,
        expectedJob.operation,
        expectedJob.phase,
      )
    ) {
      return {job, item: null, canAdvance: false};
    }
    const item = await nextActiveItem(transaction, job, "milestoneUser");
    return {job, item, canAdvance: true};
  });
  if (!selection.canAdvance) {
    return {job: selection.job, processedDocuments: 0, complete: false};
  }
  if (selection.item === null) {
    return {job: selection.job, processedDocuments: 0, complete: true};
  }
  const result = await processMilestoneUserItemStep(
    dependencies,
    selection.job,
    selection.item,
    now,
  );
  return {job: result.job, processedDocuments: result.processedDocuments, complete: false};
}

function jobPhaseForDishItem(
  item: RatingDestructiveJobItemDocument,
): RatingDestructiveJobDocument["phase"] {
  switch (item.subphase) {
    case "claimed_or_attached":
    case "process_reviews":
      return "process_reviews";
    case "reverse_contribution_points":
      return "reverse_contribution_points";
    case "delete_dish_reports":
      return "delete_dish_reports";
    case "delete_aggregate":
      return "delete_aggregate";
    case "delete_dish":
      return "delete_dish";
    case "complete":
      return "reconcile_milestone_users";
    default:
      manualFailure("unsupported_partial_state");
  }
}

export async function processStandaloneDishDeleteStep(
  dependencies: RatingDestructiveDependencies,
  job: RatingDestructiveJobDocument,
  now: Date,
): Promise<RatingDishDeleteStepResult> {
  const snapshot = await dependencies.database.runTransaction(async (
    transaction,
  ) => {
    const current = await loadRatingDestructiveJob(transaction, job.jobId);
    if (!isFreshActiveRatingDestructiveJob(
      current,
      job,
      "dishDelete",
      job.phase,
    )) {
      return {job: current, item: null, canAdvance: false};
    }
    if (current.itemCursorId === null) {
      manualFailure("malformed_private_state");
    }
    const item = await loadRatingDestructiveItem(
      transaction,
      current.itemCursorId,
    );
    if (
      item.jobId !== current.jobId ||
      item.operation !== "dishDelete" ||
      item.kind !== "dishDeletion"
    ) {
      manualFailure("malformed_private_state");
    }
    return {job: current, item, canAdvance: true};
  });
  if (!snapshot.canAdvance || snapshot.item === null) {
    return {job: snapshot.job, processedDocuments: 0};
  }
  const dishItemId = snapshot.item.itemId;
  if (snapshot.job.phase === "reconcile_milestone_users") {
    const milestone = await processNextMilestoneUserStep(
      dependencies,
      snapshot.job,
      now,
    );
    if (!milestone.complete) {
      return {job: milestone.job, processedDocuments: milestone.processedDocuments};
    }
    return dependencies.database.runTransaction(async (transaction) => {
      const current = await loadRatingDestructiveJob(
        transaction,
        snapshot.job.jobId,
      );
      if (!isFreshActiveRatingDestructiveJob(
        current,
        milestone.job,
        "dishDelete",
        "reconcile_milestone_users",
      )) {
        return {job: current, processedDocuments: 0};
      }
      if (
        current.phase !== "reconcile_milestone_users" ||
        current.itemCursorId !== dishItemId
      ) {
        return {job: current, processedDocuments: 0};
      }
      const dishItem = await loadRatingDestructiveItem(
        transaction,
        dishItemId,
      );
      if (
        !isFreshRatingDestructiveItem(
          dishItem,
          snapshot.item,
          current,
          "dishDeletion",
        ) ||
        dishItem.status !== "complete" ||
        dishItem.dishId === null ||
        current.operation !== "dishDelete"
      ) {
        manualFailure("malformed_private_state");
      }
      const lock = await requireDeletionDishLock(
        transaction,
        current,
        dishItem,
      );
      transaction.setDocument(
        ratingDishOperationLockPath(dishItem.dishId),
        buildRatingDishOperationLockDocument({
          dishId: dishItem.dishId,
          jobId: current.jobId,
          operation: "dishDelete",
          role: "source",
          state: "deleted_source",
          active: false,
          permanent: true,
          restaurantId: dishItem.restaurantId,
          targetDishId: null,
          createdAt: lock.createdAt,
          updatedAt: now,
        }),
      );
      const completed = updateRatingDestructiveJob(transaction, current, {
        status: "complete",
        phase: "complete",
        failureCode: null,
        itemCursorId: null,
        cursorDocumentId: null,
        aggregateCursorDocumentId: null,
        aggregateWinnerCursorId: null,
        aggregateState: null,
        phaseProcessedCount: 0,
        completedAt: now,
      }, now);
      return {job: completed, processedDocuments: 0};
    });
  }
  const result = await processDishDeletionItemStep(
    dependencies,
    snapshot.job,
    snapshot.item,
    now,
  );
  return dependencies.database.runTransaction(async (transaction) => {
    const current = await loadRatingDestructiveJob(
      transaction,
      snapshot.job.jobId,
    );
    if (!isFreshActiveRatingDestructiveJob(
      current,
      result.job,
      "dishDelete",
      snapshot.job.phase,
    )) {
      return {job: current, processedDocuments: 0};
    }
    if (current.itemCursorId !== dishItemId) {
      return {job: current, processedDocuments: 0};
    }
    const item = await loadRatingDestructiveItem(
      transaction,
      dishItemId,
    );
    if (!isFreshRatingDestructiveItem(
      item,
      result.item,
      current,
      "dishDeletion",
    )) {
      return {job: current, processedDocuments: 0};
    }
    const phase = jobPhaseForDishItem(item);
    const next = updateRatingDestructiveJob(transaction, current, {
      phase,
      cursorDocumentId: null,
      aggregateCursorDocumentId: null,
      aggregateWinnerCursorId: null,
      aggregateState: null,
      processedCount: current.processedCount + result.processedDocuments,
      phaseProcessedCount: phase === current.phase
        ? current.phaseProcessedCount + result.processedDocuments
        : result.processedDocuments,
    }, now);
    return {job: next, processedDocuments: result.processedDocuments};
  });
}
