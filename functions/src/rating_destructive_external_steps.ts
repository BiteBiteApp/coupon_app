import type {Firestore} from "firebase-admin/firestore";
import {
  createFirestoreReviewMilestoneWinnerAccumulator,
  maximumContributionPointStepLimit,
  maximumReviewMilestoneScanStepLimit,
  reconcileReviewMilestonesForUserStep,
  reverseContributionPointsForDishStep,
  scanValidReviewMilestoneIdentitiesForUserStep,
  type ContributionPointDishReverseCursor,
  type ContributionPointDishReverseStepResult,
  type ReviewMilestoneAccumulatorResetCursor,
  type ReviewMilestoneAccumulatorResetStepResult,
  type ReviewMilestoneIdentityScanStepResult,
  type ReviewMilestoneReconcileCursor,
  type ReviewMilestoneReconcileStepResult,
  type ReviewMilestoneReviewCursor,
} from "./contribution_points_helpers.js";
import {
  claimReviewMilestoneReconciliationLock,
  releaseReviewMilestoneReconciliationLock,
  type ReviewMilestoneReconciliationLockClaimResult,
  type ReviewMilestoneReconciliationLockReleaseResult,
} from "./review_milestone_reconciliation_lock.js";
import {
  parseRatingDestructiveJobDocument,
  parseRatingDestructiveJobItemDocument,
  ratingDestructiveJobItemPath,
  ratingDestructiveJobPath,
  type RatingDestructiveJobPhase,
  type RatingDestructiveOperation,
} from "./rating_destructive_job_contract.js";

type MilestoneIdentity = Readonly<{
  userId: string;
  operationId: string;
  lockToken: string;
  namespaceId: string;
  scanId: string;
}>;

export type RatingDestructiveExternalJobGuard = Readonly<{
  jobId: string;
  operation: RatingDestructiveOperation;
  phase: RatingDestructiveJobPhase;
  fingerprint: string;
  itemId: string;
  itemFingerprint: string;
}>;

export interface RatingDestructiveExternalSteps {
  reverseDishContributionPointsStep(value: Readonly<{
    operationId: string;
    dishId: string;
    cursor: ContributionPointDishReverseCursor | null;
    jobGuard: RatingDestructiveExternalJobGuard;
  }>): Promise<ContributionPointDishReverseStepResult>;
  claimMilestoneUser(
    identity: MilestoneIdentity,
    now: Date,
  ): Promise<ReviewMilestoneReconciliationLockClaimResult>;
  resetMilestoneAccumulatorStep(
    identity: MilestoneIdentity,
    cursor: ReviewMilestoneAccumulatorResetCursor | null,
  ): Promise<ReviewMilestoneAccumulatorResetStepResult>;
  scanMilestoneReviewsStep(
    identity: MilestoneIdentity,
    cursor: ReviewMilestoneReviewCursor | null,
  ): Promise<ReviewMilestoneIdentityScanStepResult>;
  reconcileMilestoneStep(
    identity: MilestoneIdentity,
    currentReviewCount: number,
    cursor: ReviewMilestoneReconcileCursor | null,
  ): Promise<ReviewMilestoneReconcileStepResult>;
  releaseMilestoneUser(
    identity: MilestoneIdentity,
    now: Date,
  ): Promise<ReviewMilestoneReconciliationLockReleaseResult>;
}

export function createFirestoreRatingDestructiveExternalSteps(
  firestore: Firestore,
): RatingDestructiveExternalSteps {
  const database = firestore as never;
  const accumulator = (identity: MilestoneIdentity) =>
    createFirestoreReviewMilestoneWinnerAccumulator(database, {
      namespaceId: identity.namespaceId,
      userId: identity.userId,
      operationId: identity.operationId,
      lockToken: identity.lockToken,
      scanId: identity.scanId,
    });
  return {
    async reverseDishContributionPointsStep(value) {
      return await reverseContributionPointsForDishStep(database, {
        operationId: value.operationId,
        dishId: value.dishId,
        cursor: value.cursor,
        limit: maximumContributionPointStepLimit,
      }, {
        transactionGuard: async (transaction) => {
          const [jobSnapshot, itemSnapshot] = await Promise.all([
            transaction.get(
              firestore.doc(ratingDestructiveJobPath(value.jobGuard.jobId)),
            ),
            transaction.get(
              firestore.doc(ratingDestructiveJobItemPath(
                value.jobGuard.itemId,
              )),
            ),
          ]);
          const job = parseRatingDestructiveJobDocument(jobSnapshot.exists
            ? {id: jobSnapshot.id, data: jobSnapshot.data() ?? {}}
            : null);
          const item = parseRatingDestructiveJobItemDocument(itemSnapshot.exists
            ? {id: itemSnapshot.id, data: itemSnapshot.data() ?? {}}
            : null);
          if (
            job === null ||
            item === null ||
            job.status !== "active" ||
            job.jobId !== value.jobGuard.jobId ||
            job.operation !== value.jobGuard.operation ||
            job.phase !== value.jobGuard.phase ||
            job.fingerprint !== value.jobGuard.fingerprint ||
            item.status !== "active" ||
            item.itemId !== value.jobGuard.itemId ||
            item.jobId !== job.jobId ||
            item.operation !== job.operation ||
            item.kind !== "dishDeletion" ||
            item.subphase !== "reverse_contribution_points" ||
            item.fingerprint !== value.jobGuard.itemFingerprint
          ) {
            throw new Error(
              "Rating destructive-operation point guard is no longer active.",
            );
          }
        },
      });
    },
    async claimMilestoneUser(identity, now) {
      return await claimReviewMilestoneReconciliationLock(
        database,
        identity,
        {now: () => now},
      );
    },
    async resetMilestoneAccumulatorStep(identity, cursor) {
      return await accumulator(identity).initializeFreshScanStep({
        cursor,
        limit: maximumContributionPointStepLimit,
      });
    },
    async scanMilestoneReviewsStep(identity, cursor) {
      return await scanValidReviewMilestoneIdentitiesForUserStep(
        database,
        {
          userId: identity.userId,
          operationId: identity.operationId,
          lockToken: identity.lockToken,
          cursor,
          limit: maximumReviewMilestoneScanStepLimit,
        },
        accumulator(identity),
      );
    },
    async reconcileMilestoneStep(identity, currentReviewCount, cursor) {
      return await reconcileReviewMilestonesForUserStep(
        database,
        {
          userId: identity.userId,
          operationId: identity.operationId,
          lockToken: identity.lockToken,
          currentReviewCount,
          cursor,
          limit: maximumContributionPointStepLimit,
        },
        accumulator(identity),
      );
    },
    async releaseMilestoneUser(identity, now) {
      return await releaseReviewMilestoneReconciliationLock(
        database,
        identity,
        {now: () => now},
      );
    },
  };
}
