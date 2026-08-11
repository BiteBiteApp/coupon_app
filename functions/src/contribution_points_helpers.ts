import { createHash } from "node:crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import type { WhereFilterOp } from "firebase-admin/firestore";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import {
  buildDishProposalMemberDocument,
  buildDishProposalMembership,
  buildDishProposalSupporterDocument,
  createDishProposalGroupId,
  createDishProposalMemberId,
  createDishProposalSupporterId,
  dishProposalDocumentFingerprint,
  dishProposalGroupCollection,
  dishProposalGroupVersion,
  dishProposalMemberCollection,
  dishProposalMemberVersion,
  dishProposalSupporterCollection,
  dishProposalSupporterVersion,
  normalizeDishNameForSave,
  readDishProposalDate,
  type DishProposalMembership,
} from "./dish_proposal_private_contract.js";
import {
  assertActiveReviewMilestoneReconciliationLockInTransaction,
  recordReviewMilestoneReconciliationTerminalState,
  type ReviewMilestoneReconciliationLockDatabase,
  type ReviewMilestoneReconciliationLockIdentity,
  type ReviewMilestoneReconciliationLockTransaction,
} from "./review_milestone_reconciliation_lock.js";

export const contributionPointLedgerCollection =
  "bitescore_contribution_point_ledger";
export const contributionUserProfilesCollection = "user_profiles";

export const contributionPointStatus = {
  active: "active",
  reversed: "reversed",
  reversal: "reversal",
} as const;

export const contributionPointCelebrationStatus = {
  pending: "pending",
  celebrated: "celebrated",
} as const;

export const contributionPointAction = {
  reviewMilestone: "review_milestone",
  dishCreated: "dish_created",
  dishImageAdded: "dish_image_added",
  restaurantFirstDish: "restaurant_first_dish",
  newRestaurantFirstDish: "new_restaurant_first_dish",
  dishEditApproved: "dish_edit_approved",
  dishRenameApproved: "dish_rename_approved",
  dishMergeApproved: "dish_merge_approved",
  contributionReversed: "contribution_reversed",
} as const;

export type ContributionPointAwardDraft = {
  userId: string;
  points: number;
  actionType: string;
  sourceKey: string;
  description: string;
  dishId?: string | null;
  dishName?: string | null;
  restaurantId?: string | null;
  restaurantName?: string | null;
  restaurantCity?: string | null;
  restaurantState?: string | null;
  restaurantAddress?: string | null;
  restaurantPhone?: string | null;
  reviewId?: string | null;
  requestId?: string | null;
  imageId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  mergeSourceDishId?: string | null;
  mergeSourceDishName?: string | null;
  mergeTargetDishId?: string | null;
  mergeTargetDishName?: string | null;
};

export type ContributionPointAwardEntryResult = {
  ledgerEntryId: string;
  points: number;
  wasCreated: boolean;
};

export type ContributionPointAwardResult = {
  entries: ContributionPointAwardEntryResult[];
  actionGroupId?: string;
};

export type DishProposalResolutionPointAwardOutcome =
  | "awarded"
  | "alreadyAwarded"
  | "notEligible"
  | "noAwardForNoOp";

export type DishProposalResolutionPointAwardResult = Readonly<{
  outcome: DishProposalResolutionPointAwardOutcome;
  result: ContributionPointAwardResult;
}>;

export type DishProposalResolutionPointAwardRequest = Readonly<{
  proposalDocumentId: string;
  activeJobId: string;
  groupId: string;
  supporterUid: string;
  trustedServerCreateTimeMillis: number;
  membershipGeneration: number;
  cycleCutoffGeneration: number;
  oldValue?: string | null;
  newValue?: string | null;
}>;

export type ContributionPointReverseResult = {
  ledgerEntryId: string;
  reversalLedgerEntryId?: string;
  pointsDelta: number;
  status: "missing" | "invalid" | "not-active" | "already-reversed" | "reversed";
};

export type ContributionPointCelebrationMarkResult = {
  attemptedEntryIds: string[];
  markedEntryIds: string[];
  alreadyCelebratedEntryIds: string[];
  missingEntryIds: string[];
  ignoredEntryIds: string[];
};

export type ContributionPointModerationReverseError = {
  ledgerEntryId: string;
  message: string;
};

export type ContributionPointDishReverseResult = {
  dishId: string;
  attemptedCount: number;
  reversedEntryIds: string[];
  alreadyReversedEntryIds: string[];
  missingEntryIds: string[];
  ignoredEntryIds: string[];
  errors: ContributionPointModerationReverseError[];
};

export type ContributionPointMilestoneReconcileResult = {
  userId: string;
  validReviewCount: number;
  awardResult: ContributionPointAwardResult;
  reversedEntryIds: string[];
  alreadyReversedEntryIds: string[];
  missingEntryIds: string[];
  ignoredEntryIds: string[];
  errors: ContributionPointModerationReverseError[];
};

export const maximumContributionPointStepLimit = 50;
export const maximumReviewMilestoneScanStepLimit = 100;
export const privateReviewMilestoneCountAccumulatorCollection =
  "private_review_milestone_count_accumulators";
export const reviewMilestoneAccumulatorVersion =
  "bitestar.review-milestone-accumulator.v2" as const;
export const reviewMilestoneWinnerVersion =
  "bitestar.review-milestone-seen-valid.v1" as const;

export type ContributionPointDishReverseCursor = Readonly<{
  version: "bitestar.contribution-dish-reverse-cursor.v2";
  phase: "dish-ledger";
  operationFingerprint: string;
  dishFingerprint: string;
  afterLedgerDocumentId: string;
  fingerprint: string;
}>;

export type ContributionPointDishReverseStepResult = Readonly<{
  processedCount: number;
  nextCursor: ContributionPointDishReverseCursor | null;
  complete: boolean;
}>;

export type ReviewMilestoneSeenValidIdentity = Readonly<{
  version: typeof reviewMilestoneWinnerVersion;
  scanFingerprint: string;
  identityFingerprint: string;
  validPublicReview: true;
  fingerprint: string;
}>;

export interface ReviewMilestoneWinnerAccumulator {
  readonly userFingerprint: string;
  readonly operationFingerprint: string;
  readonly lockFingerprint: string;
  readonly scanFingerprint: string;
  initializeFreshScanStep(params: Readonly<{
    cursor?: ReviewMilestoneAccumulatorResetCursor | null;
    limit: number;
  }>): Promise<ReviewMilestoneAccumulatorResetStepResult>;
  prepareReviewPage(
    cursor: ReviewMilestoneReviewCursor | null,
  ): Promise<ReviewMilestonePreparedReviewPage>;
  commitReviewPage(params: Readonly<{
    cursor: ReviewMilestoneReviewCursor | null;
    processedCount: number;
    lastReviewDocumentId: string | null;
    complete: boolean;
    identityFingerprints: readonly string[];
  }>): Promise<ReviewMilestoneCommittedReviewPage>;
  readCompletedReviewCount(): Promise<ReviewMilestoneCompletedReviewCount>;
  prepareReconciliationPage(params: Readonly<{
    cursor: ReviewMilestoneReconcileCursor | null;
    currentReviewCount: number;
  }>): Promise<ReviewMilestonePreparedReconciliationPage>;
  commitReconciliationPage(params: Readonly<{
    cursor: ReviewMilestoneReconcileCursor | null;
    currentReviewCount: number;
    processedCount: number;
    nextPhase: "awards" | "ledger" | "complete";
    afterMilestone: number;
    afterLedgerDocumentId: string | null;
  }>): Promise<ReviewMilestoneCommittedReconciliationPage>;
  ensureTerminalState(): Promise<void>;
}

export type ReviewMilestoneAccumulatorResetCursor = Readonly<{
  version: "bitestar.review-milestone-accumulator-reset-cursor.v2";
  phase: "accumulator-reset";
  userFingerprint: string;
  operationFingerprint: string;
  lockFingerprint: string;
  scanFingerprint: string;
  afterWinnerDocumentId: string;
  fingerprint: string;
}>;

export type ReviewMilestoneReviewCursor = Readonly<{
  version: "bitestar.review-milestone-review-cursor.v3";
  phase: "review-scan";
  userFingerprint: string;
  operationFingerprint: string;
  lockFingerprint: string;
  scanFingerprint: string;
  sequence: number;
  afterReviewDocumentId: string;
  fingerprint: string;
}>;

export type ReviewMilestonePreparedReviewPage = Readonly<{
  status: "advance" | "already-committed";
  result: ReviewMilestoneIdentityScanStepResult | null;
}>;

export type ReviewMilestoneCommittedReviewPage = Readonly<{
  result: ReviewMilestoneIdentityScanStepResult;
  countStateFingerprint: string | null;
}>;

export type ReviewMilestoneCompletedReviewCount = Readonly<{
  validReviewCount: number;
  countStateFingerprint: string;
}>;

export type ReviewMilestonePreparedReconciliationPage = Readonly<{
  status: "advance" | "already-committed";
  result: ReviewMilestoneReconcileStepResult | null;
  countStateFingerprint: string;
}>;

export type ReviewMilestoneCommittedReconciliationPage = Readonly<{
  result: ReviewMilestoneReconcileStepResult;
  countStateFingerprint: string;
  reconciliationStateFingerprint: string | null;
}>;

export type ReviewMilestoneAccumulatorResetStepResult = Readonly<{
  processedCount: number;
  nextCursor: ReviewMilestoneAccumulatorResetCursor | null;
  complete: boolean;
}>;

export type ReviewMilestoneIdentityScanStepResult = Readonly<{
  processedCount: number;
  nextCursor: ReviewMilestoneReviewCursor | null;
  complete: boolean;
  validReviewCount: number | null;
}>;

export type ReviewMilestoneReconcileCursor =
  | Readonly<{
    version: "bitestar.review-milestone-reconcile-cursor.v2";
    phase: "awards";
    userFingerprint: string;
    operationFingerprint: string;
    lockFingerprint: string;
    countStateFingerprint: string;
    afterMilestone: number;
    fingerprint: string;
  }>
  | Readonly<{
    version: "bitestar.review-milestone-reconcile-cursor.v2";
    phase: "ledger";
    userFingerprint: string;
    operationFingerprint: string;
    lockFingerprint: string;
    countStateFingerprint: string;
    afterLedgerDocumentId: string | null;
    fingerprint: string;
  }>;

export type ReviewMilestoneReconcileStepResult = Readonly<{
  processedCount: number;
  nextCursor: ReviewMilestoneReconcileCursor | null;
  complete: boolean;
}>;

type DocumentReferenceLike = {
  id: string;
  get(): Promise<DocumentSnapshotLike>;
};

type DocumentSnapshotLike = {
  id: string;
  exists: boolean;
  createTime?: { toMillis(): number };
  data(): Record<string, unknown> | undefined;
};

type CollectionReferenceLike = {
  doc(id: string): DocumentReferenceLike;
  where(fieldPath: string, opStr: WhereFilterOp, value: unknown): QueryLike;
  orderBy(
    fieldPath: string | FieldPath,
    directionStr?: "asc" | "desc",
  ): QueryLike;
};

type QueryLike = {
  where(fieldPath: string, opStr: WhereFilterOp, value: unknown): QueryLike;
  orderBy(
    fieldPath: string | FieldPath,
    directionStr?: "asc" | "desc",
  ): QueryLike;
  startAfter(...fieldValues: unknown[]): QueryLike;
  limit(limit: number): QueryLike;
  get(): Promise<QuerySnapshotLike>;
};

type QuerySnapshotLike = {
  docs: DocumentSnapshotLike[];
};

type TransactionLike = {
  get(ref: DocumentReferenceLike): Promise<DocumentSnapshotLike>;
  set(
    ref: DocumentReferenceLike,
    data: Record<string, unknown>,
    options?: { merge: boolean },
  ): unknown;
  delete(ref: DocumentReferenceLike): unknown;
};

type FirestoreLike = {
  collection(path: string): CollectionReferenceLike;
  runTransaction<T>(
    updateFunction: (transaction: TransactionLike) => Promise<T>,
  ): Promise<T>;
};

type ServerFieldValues = {
  serverTimestamp(): unknown;
  increment(delta: number): unknown;
};

type HelperOptions = {
  fieldValues?: ServerFieldValues;
  transactionGuard?: (transaction: TransactionLike) => Promise<void>;
};

type CallableAuthLike = {
  uid?: string;
  token?: Record<string, unknown>;
};

const betaAdminEmails = new Set(["schuyler.cole@gmail.com"]);
const maxCelebrationLedgerEntryIds = 30;
const dishProposalMemberKeys = Object.freeze([
  "version",
  "proposalDocumentId",
  "groupId",
  "proposalType",
  "restaurantId",
  "sourceDishId",
  "mergeTargetDishId",
  "normalizedProposedName",
  "supporterUid",
  "trustedServerCreateTime",
  "membershipEnteredAt",
  "membershipGeneration",
  "currentPending",
  "fingerprint",
  "indexedAt",
] as const);
const dishProposalGroupKeys = Object.freeze([
  "version",
  "groupId",
  "proposalType",
  "restaurantId",
  "sourceDishId",
  "mergeTargetDishId",
  "normalizedProposedName",
  "hasPendingMembers",
  "oldestTrustedServerCreateTime",
  "dueAt",
  "enoughSupporters",
  "autoEligible",
  "lastMembershipGeneration",
  "resolutionSequence",
  "activeJobId",
  "activeResolutionType",
  "cycleCutoffGeneration",
  "cycleCutoffAt",
  "fingerprint",
  "indexedAt",
] as const);
const dishProposalSupporterKeys = Object.freeze([
  "version",
  "groupId",
  "supporterUid",
  "present",
  "fingerprint",
  "indexedAt",
] as const);

const adminServerFieldValues: ServerFieldValues = {
  serverTimestamp: () => FieldValue.serverTimestamp(),
  increment: (delta: number) => FieldValue.increment(delta),
};
const reviewMilestoneSourceCursorVersion =
  "bitestar.review-milestone-review-cursor.v3" as const;
const contributionPointDishReverseCursorVersion =
  "bitestar.contribution-dish-reverse-cursor.v2" as const;
const reviewMilestoneReconcileCursorVersion =
  "bitestar.review-milestone-reconcile-cursor.v2" as const;
const reviewMilestoneAccumulatorResetCursorVersion =
  "bitestar.review-milestone-accumulator-reset-cursor.v2" as const;
const reviewMilestoneAccumulatorManifestKeys = Object.freeze([
  "version",
  "userFingerprint",
  "operationFingerprint",
  "lockFingerprint",
  "scanFingerprint",
  "state",
  "resetAfterDocumentId",
  "reviewPageSequence",
  "reviewAfterDocumentId",
  "previousReviewAfterDocumentId",
  "lastReviewProcessedCount",
  "validReviewCount",
  "countStateFingerprint",
  "reconciliationPhase",
  "reconciliationCount",
  "reconciliationAfterMilestone",
  "reconciliationAfterLedgerDocumentId",
  "previousReconciliationCursorFingerprint",
  "lastReconciliationProcessedCount",
  "fingerprint",
] as const);
const reviewMilestoneWinnerKeys = Object.freeze([
  "version",
  "scanFingerprint",
  "identityFingerprint",
  "validPublicReview",
  "fingerprint",
] as const);

type ReviewMilestoneAccumulatorManifest = Readonly<{
  version: typeof reviewMilestoneAccumulatorVersion;
  userFingerprint: string;
  operationFingerprint: string;
  lockFingerprint: string;
  scanFingerprint: string;
  state: "resetting" | "ready" | "counting" | "count-complete";
  resetAfterDocumentId: string | null;
  reviewPageSequence: number;
  reviewAfterDocumentId: string | null;
  previousReviewAfterDocumentId: string | null;
  lastReviewProcessedCount: number;
  validReviewCount: number;
  countStateFingerprint: string | null;
  reconciliationPhase: "not-started" | "awards" | "ledger" | "complete";
  reconciliationCount: number | null;
  reconciliationAfterMilestone: number;
  reconciliationAfterLedgerDocumentId: string | null;
  previousReconciliationCursorFingerprint: string | null;
  lastReconciliationProcessedCount: number;
  fingerprint: string;
}>;

export function buildContributionLedgerDocumentIdFromSourceKey(
  sourceKey: string,
): string {
  return encodeURIComponent(sourceKey.trim());
}

export function buildContributionLedgerDocumentIdFromExactSourceKey(
  sourceKey: string,
): string {
  return encodeURIComponent(sourceKey);
}

export function buildContributionReversalDocumentId(
  ledgerEntryId: string,
): string {
  return `reversal:${encodeURIComponent(ledgerEntryId.trim())}`;
}

export function buildReviewMilestoneReviewIdentityKey(
  userId: string,
  dishId: string,
): string {
  const normalizedUserId = readRequiredString(userId, "userId");
  const normalizedDishId = readRequiredString(dishId, "dishId");
  return createHash("sha256")
    .update(JSON.stringify([
      reviewMilestoneWinnerVersion,
      ["userId", normalizedUserId],
      ["dishId", normalizedDishId],
    ]), "utf8")
    .digest("hex");
}

export async function awardContributionPointsTransaction(
  db: FirestoreLike,
  draft: ContributionPointAwardDraft,
  options: HelperOptions = {},
): Promise<ContributionPointAwardResult> {
  const normalizedDraft = normalizeAwardDraft(draft);
  if (
    !normalizedDraft ||
    normalizedDraft.userId.length === 0 ||
    normalizedDraft.points <= 0 ||
    normalizedDraft.sourceKey.length === 0
  ) {
    return { entries: [] };
  }

  return runContributionPointAwardTransaction(
    db,
    normalizedDraft,
    false,
    options,
  );
}

export async function reverseContributionPointLedgerEntryTransaction(
  db: FirestoreLike,
  params: { ledgerEntryId: string; reason: string },
  options: HelperOptions = {},
): Promise<ContributionPointReverseResult> {
  const ledgerEntryId = params.ledgerEntryId.trim();
  const reason = params.reason.trim();
  if (!ledgerEntryId) {
    return {
      ledgerEntryId,
      pointsDelta: 0,
      status: "missing",
    };
  }

  const fieldValues = options.fieldValues ?? adminServerFieldValues;
  const entryRef = ledgerDocument(db, ledgerEntryId);
  const reversalLedgerEntryId = buildContributionReversalDocumentId(
    ledgerEntryId,
  );
  const reversalRef = ledgerDocument(db, reversalLedgerEntryId);

  return db.runTransaction<ContributionPointReverseResult>(
    async (transaction) => {
      await options.transactionGuard?.(transaction);
      const freshEntrySnapshot = await transaction.get(entryRef);
      if (!freshEntrySnapshot.exists) {
        return {
          ledgerEntryId,
          pointsDelta: 0,
          status: "missing",
        };
      }

      const freshEntry = parseLedgerEntry(freshEntrySnapshot);
      if (!freshEntry) {
        return {
          ledgerEntryId,
          pointsDelta: 0,
          status: "invalid",
        };
      }

      const reversalSnapshot = await transaction.get(reversalRef);
      if (freshEntry.pointsDelta <= 0) {
        return {
          ledgerEntryId: freshEntry.id,
          reversalLedgerEntryId: reversalRef.id,
          pointsDelta: 0,
          status: "not-active",
        };
      }

      if (
        freshEntry.status !== contributionPointStatus.active ||
        reversalSnapshot.exists
      ) {
        return {
          ledgerEntryId: freshEntry.id,
          reversalLedgerEntryId: reversalRef.id,
          pointsDelta: 0,
          status: "already-reversed",
        };
      }

      transaction.set(
        entryRef,
        {
          status: contributionPointStatus.reversed,
          reversalLedgerEntryId: reversalRef.id,
          updatedAt: fieldValues.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(reversalRef, {
        id: reversalRef.id,
        userId: freshEntry.userId,
        pointsDelta: -freshEntry.pointsDelta,
        actionType: contributionPointAction.contributionReversed,
        sourceKey: `reversal:${freshEntry.sourceKey}`,
        description: `Points removed: ${freshEntry.description}`,
        status: contributionPointStatus.reversal,
        originalLedgerEntryId: freshEntry.id,
        dishId: freshEntry.dishId,
        dishName: freshEntry.dishName,
        restaurantId: freshEntry.restaurantId,
        restaurantName: freshEntry.restaurantName,
        restaurantCity: freshEntry.restaurantCity,
        restaurantState: freshEntry.restaurantState,
        restaurantAddress: freshEntry.restaurantAddress,
        restaurantPhone: freshEntry.restaurantPhone,
        reviewId: freshEntry.reviewId,
        requestId: freshEntry.requestId,
        imageId: freshEntry.imageId,
        oldValue: freshEntry.oldValue,
        newValue: freshEntry.newValue,
        mergeSourceDishId: freshEntry.mergeSourceDishId,
        mergeSourceDishName: freshEntry.mergeSourceDishName,
        mergeTargetDishId: freshEntry.mergeTargetDishId,
        mergeTargetDishName: freshEntry.mergeTargetDishName,
        reason,
        createdAt: fieldValues.serverTimestamp(),
        updatedAt: fieldValues.serverTimestamp(),
      });
      incrementCachedTotal(
        transaction,
        userProfileDocument(db, freshEntry.userId),
        -freshEntry.pointsDelta,
        fieldValues,
      );

      return {
        ledgerEntryId: freshEntry.id,
        reversalLedgerEntryId: reversalRef.id,
        pointsDelta: -freshEntry.pointsDelta,
        status: "reversed",
      };
    },
  );
}

export async function reverseContributionPointSourceKeyTransaction(
  db: FirestoreLike,
  params: { sourceKey: string; reason: string },
  options: HelperOptions = {},
): Promise<ContributionPointReverseResult> {
  return reverseContributionPointLedgerEntryTransaction(
    db,
    {
      ledgerEntryId: buildContributionLedgerDocumentIdFromSourceKey(
        params.sourceKey,
      ),
      reason: params.reason,
    },
    options,
  );
}

export async function reverseContributionPointsForDishStep(
  db: FirestoreLike,
  params: Readonly<{
    operationId: string;
    dishId: string;
    cursor?: ContributionPointDishReverseCursor | null;
    limit: number;
    now?: unknown;
    reason?: string;
  }>,
  options: HelperOptions = {},
): Promise<ContributionPointDishReverseStepResult> {
  const dishId = readRequiredDocumentId(params.dishId, "dishId");
  const operationId = readPrivateOperationId(params.operationId);
  const operationFingerprint = reviewMilestoneOperationFingerprint(operationId);
  const dishFingerprint = contributionPointDishReverseContextFingerprint(dishId);
  const cursor = readContributionPointDishReverseCursor(
    params.cursor,
    {operationFingerprint, dishFingerprint},
  );
  const limit = readContributionPointStepLimit(params.limit);
  const reason = readOptionalString(params.reason) ??
    "Dish was deleted by moderation";
  const stepOptions = contributionPointStepOptions(params.now, options);
  let query = db
    .collection(contributionPointLedgerCollection)
    .where("dishId", "==", dishId)
    .orderBy(FieldPath.documentId(), "asc");
  if (cursor !== null) {
    query = query.startAfter(cursor.afterLedgerDocumentId);
  }
  const snapshot = await query.limit(limit).get();
  let processedCount = 0;
  let lastProcessedDocumentId = cursor?.afterLedgerDocumentId ?? null;

  for (const doc of snapshot.docs) {
    const entryData = doc.data() ?? {};
    const pointsDelta = readNumber(entryData.pointsDelta);
    if (pointsDelta === null || pointsDelta <= 0) {
      processedCount += 1;
      lastProcessedDocumentId = doc.id;
      continue;
    }

    try {
      await reverseContributionPointLedgerEntryTransaction(
        db,
        { ledgerEntryId: doc.id, reason },
        stepOptions,
      );
    } catch {
      throw new Error("Contribution point reversal step failed.");
    }
    processedCount += 1;
    lastProcessedDocumentId = doc.id;
  }

  const complete = snapshot.docs.length < limit;
  return {
    processedCount,
    nextCursor: complete || lastProcessedDocumentId === null
      ? null
      : buildContributionPointDishReverseCursor({
        operationFingerprint,
        dishFingerprint,
        afterLedgerDocumentId: lastProcessedDocumentId,
      }),
    complete,
  };
}

export async function scanValidReviewMilestoneIdentitiesForUserStep(
  db: FirestoreLike,
  params: Readonly<{
    userId: string;
    operationId: string;
    lockToken: string;
    cursor?: ReviewMilestoneReviewCursor | null;
    limit: number;
  }>,
  winnerAccumulator: ReviewMilestoneWinnerAccumulator,
): Promise<ReviewMilestoneIdentityScanStepResult> {
  const lockIdentity = readReviewMilestoneLockIdentity(params);
  const userId = lockIdentity.userId;
  const limit = readReviewMilestoneScanStepLimit(params.limit);
  requireReviewMilestoneAccumulatorIdentity(
    winnerAccumulator,
    lockIdentity,
  );
  const cursor = readReviewMilestoneReviewCursor(
    params.cursor,
    winnerAccumulator,
  );
  const prepared = await winnerAccumulator.prepareReviewPage(cursor);
  if (prepared.status === "already-committed") {
    if (prepared.result === null) {
      throw new Error("Private review milestone scan state is invalid.");
    }
    return prepared.result;
  }
  let query = db
    .collection("dish_reviews")
    .where("userId", "==", userId)
    .orderBy(FieldPath.documentId(), "asc");
  if (cursor !== null) {
    query = query.startAfter(cursor.afterReviewDocumentId);
  }
  const snapshot = await query.limit(limit).get();
  const identityFingerprints = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    if (!isPublicReviewData(data)) {
      continue;
    }
    const dishId = readOptionalString(data.dishId);
    const reviewUserId = readOptionalString(data.userId);
    if (dishId !== null && reviewUserId === userId) {
      identityFingerprints.add(
        buildReviewMilestoneReviewIdentityKey(reviewUserId, dishId),
      );
    }
  }
  const complete = snapshot.docs.length < limit;
  const lastDocument = snapshot.docs[snapshot.docs.length - 1];
  return (await winnerAccumulator.commitReviewPage({
    cursor,
    processedCount: snapshot.docs.length,
    lastReviewDocumentId: lastDocument?.id ?? null,
    complete,
    identityFingerprints: [...identityFingerprints],
  })).result;
}

export function createFirestoreReviewMilestoneWinnerAccumulator(
  db: FirestoreLike,
  params: Readonly<{
    namespaceId: string;
    userId: string;
    operationId: string;
    lockToken: string;
    scanId: string;
  }>,
): ReviewMilestoneWinnerAccumulator {
  const lockIdentity = readReviewMilestoneLockIdentity(params);
  const exactNamespaceId = readRequiredDocumentId(
    params.namespaceId,
    "namespaceId",
  );
  const exactUserId = lockIdentity.userId;
  const exactScanId = readRequiredDocumentId(params.scanId, "scanId");
  const userFingerprint = reviewMilestoneAccumulatorUserFingerprint(
    exactUserId,
  );
  const operationFingerprint = reviewMilestoneOperationFingerprint(
    lockIdentity.operationId,
  );
  const lockFingerprint = reviewMilestoneLockIdentityFingerprint(lockIdentity);
  const scanFingerprint = reviewMilestoneAccumulatorScanFingerprint(
    exactNamespaceId,
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    exactScanId,
  );
  const manifestRef = db
    .collection(privateReviewMilestoneCountAccumulatorCollection)
    .doc(exactNamespaceId);
  const winnerCollection = db.collection(
    `${privateReviewMilestoneCountAccumulatorCollection}/${
      exactNamespaceId
    }/seen_valid_identities`,
  );
  const requireExpectedManifest = (
    snapshot: DocumentSnapshotLike,
    requiredStates?: readonly ReviewMilestoneAccumulatorManifest["state"][],
  ): ReviewMilestoneAccumulatorManifest => {
    const manifest = parseReviewMilestoneAccumulatorManifest(snapshot);
    if (
      manifest.userFingerprint !== userFingerprint ||
      manifest.operationFingerprint !== operationFingerprint ||
      manifest.lockFingerprint !== lockFingerprint ||
      manifest.scanFingerprint !== scanFingerprint ||
      (requiredStates !== undefined && !requiredStates.includes(manifest.state))
    ) {
      throw new Error("Private review milestone accumulator binding is invalid.");
    }
    return manifest;
  };
  const assertLock = (transaction: TransactionLike) =>
    assertActiveReviewMilestoneReconciliationLockInTransaction(
      reviewMilestoneLockDatabase(db),
      reviewMilestoneLockTransaction(transaction),
      lockIdentity,
    );
  const initialManifest = (): ReviewMilestoneAccumulatorManifest =>
    buildReviewMilestoneAccumulatorManifest({
      userFingerprint,
      operationFingerprint,
      lockFingerprint,
      scanFingerprint,
      state: "resetting",
      resetAfterDocumentId: null,
      reviewPageSequence: 0,
      reviewAfterDocumentId: null,
      previousReviewAfterDocumentId: null,
      lastReviewProcessedCount: 0,
      validReviewCount: 0,
      countStateFingerprint: null,
      reconciliationPhase: "not-started",
      reconciliationCount: null,
      reconciliationAfterMilestone: 0,
      reconciliationAfterLedgerDocumentId: null,
      previousReconciliationCursorFingerprint: null,
      lastReconciliationProcessedCount: 0,
    });

  return {
    userFingerprint,
    operationFingerprint,
    lockFingerprint,
    scanFingerprint,
    async initializeFreshScanStep(resetParams) {
      const limit = readContributionPointStepLimit(resetParams.limit);
      const cursor = readReviewMilestoneAccumulatorResetCursor(
        resetParams.cursor,
        {userFingerprint, operationFingerprint, lockFingerprint, scanFingerprint},
      );
      const resetState = await db.runTransaction(async (transaction) => {
        await assertLock(transaction);
        const snapshot = await transaction.get(manifestRef);
        if (!snapshot.exists) {
          if (cursor !== null) {
            throw new Error("Private review milestone reset state is invalid.");
          }
          transaction.set(manifestRef, initialManifest());
          return initialManifest();
        }
        const manifest = requireExpectedManifest(snapshot);
        if (manifest.state !== "resetting") {
          return manifest;
        }
        if (cursorDocumentId(cursor) !== manifest.resetAfterDocumentId) {
          throw new Error("Private review milestone reset cursor is invalid.");
        }
        return manifest;
      });
      if (resetState.state !== "resetting") {
        return { processedCount: 0, nextCursor: null, complete: true };
      }

      let query = winnerCollection.orderBy(FieldPath.documentId(), "asc");
      if (cursor !== null) {
        query = query.startAfter(cursor.afterWinnerDocumentId);
      }
      const snapshot = await query.limit(limit).get();
      const complete = snapshot.docs.length < limit;
      const lastDocument = snapshot.docs[snapshot.docs.length - 1];
      await db.runTransaction(async (transaction) => {
        await assertLock(transaction);
        const manifestSnapshot = await transaction.get(manifestRef);
        const manifest = requireExpectedManifest(
          manifestSnapshot,
          ["resetting"],
        );
        if (cursorDocumentId(cursor) !== manifest.resetAfterDocumentId) {
          throw new Error("Private review milestone reset cursor is invalid.");
        }
        for (const doc of snapshot.docs) {
          transaction.delete(winnerCollection.doc(doc.id));
        }
        transaction.set(
          manifestRef,
          buildReviewMilestoneAccumulatorManifest({
            ...manifest,
            state: complete ? "ready" : "resetting",
            resetAfterDocumentId: complete ? null : lastDocument?.id ?? null,
          }),
        );
      });
      return {
        processedCount: snapshot.docs.length,
        nextCursor: complete || lastDocument === undefined
          ? null
          : buildReviewMilestoneAccumulatorResetCursor({
            userFingerprint,
            operationFingerprint,
            lockFingerprint,
            scanFingerprint,
            afterWinnerDocumentId: lastDocument.id,
          }),
        complete,
      };
    },
    async prepareReviewPage(cursor) {
      return db.runTransaction(async (transaction) => {
        await assertLock(transaction);
        const manifest = requireExpectedManifest(
          await transaction.get(manifestRef),
          ["ready", "counting", "count-complete"],
        );
        return prepareReviewPageFromManifest(manifest, cursor, {
          userFingerprint,
          operationFingerprint,
          lockFingerprint,
          scanFingerprint,
        });
      });
    },
    async commitReviewPage(page) {
      const processedCount = requireBoundedProcessedCount(
        page.processedCount,
        maximumReviewMilestoneScanStepLimit,
      );
      const lastReviewDocumentId = page.lastReviewDocumentId === null
        ? null
        : readRequiredDocumentId(
          page.lastReviewDocumentId,
          "lastReviewDocumentId",
        );
      if (
        page.complete !== true && page.complete !== false ||
        (processedCount === 0) !== (lastReviewDocumentId === null) ||
        (!page.complete && lastReviewDocumentId === null)
      ) {
        throw new Error("Private review milestone page state is invalid.");
      }
      const identities = [...new Set(page.identityFingerprints.map((value) =>
        requireSha256Fingerprint(value, "identityFingerprint")))];
      if (identities.length > processedCount) {
        throw new Error("Private review milestone page state is invalid.");
      }
      return db.runTransaction(async (transaction) => {
        await assertLock(transaction);
        const manifest = requireExpectedManifest(
          await transaction.get(manifestRef),
          ["ready", "counting", "count-complete"],
        );
        const prepared = prepareReviewPageFromManifest(manifest, page.cursor, {
          userFingerprint,
          operationFingerprint,
          lockFingerprint,
          scanFingerprint,
        });
        if (prepared.status === "already-committed") {
          if (prepared.result === null) {
            throw new Error("Private review milestone page state is invalid.");
          }
          return {
            result: prepared.result,
            countStateFingerprint: manifest.countStateFingerprint,
          };
        }
        const identitySnapshots = await Promise.all(identities.map(async (
          identityFingerprint,
        ) => ({
          identityFingerprint,
          snapshot: await transaction.get(
            winnerCollection.doc(identityFingerprint),
          ),
        })));
        let validReviewCount = manifest.validReviewCount;
        for (const {identityFingerprint, snapshot} of identitySnapshots) {
          if (snapshot.exists) {
            const existing = parseStoredReviewMilestoneSeenValidIdentity(snapshot);
            if (existing.scanFingerprint !== scanFingerprint) {
              throw new Error("Private review milestone identity is invalid.");
            }
            continue;
          }
          validReviewCount += 1;
          if (!Number.isSafeInteger(validReviewCount)) {
            throw new Error("Private review milestone count is invalid.");
          }
          transaction.set(
            winnerCollection.doc(identityFingerprint),
            buildReviewMilestoneSeenValidIdentity(
              scanFingerprint,
              identityFingerprint,
            ),
          );
        }
        const countStateFingerprint = page.complete
          ? reviewMilestoneCountStateFingerprint({
            userFingerprint,
            operationFingerprint,
            lockFingerprint,
            scanFingerprint,
            validReviewCount,
          })
          : null;
        const nextManifest = buildReviewMilestoneAccumulatorManifest({
          ...manifest,
          state: page.complete ? "count-complete" : "counting",
          resetAfterDocumentId: null,
          reviewPageSequence: manifest.reviewPageSequence + 1,
          reviewAfterDocumentId: page.complete ? null : lastReviewDocumentId,
          previousReviewAfterDocumentId: manifest.reviewAfterDocumentId,
          lastReviewProcessedCount: processedCount,
          validReviewCount,
          countStateFingerprint,
        });
        transaction.set(manifestRef, nextManifest);
        return {
          result: reviewScanResultFromManifest(nextManifest),
          countStateFingerprint,
        };
      });
    },
    async readCompletedReviewCount() {
      return db.runTransaction(async (transaction) => {
        await assertLock(transaction);
        const manifest = requireExpectedManifest(
          await transaction.get(manifestRef),
          ["count-complete"],
        );
        if (manifest.countStateFingerprint === null) {
          throw new Error("Private review milestone count state is invalid.");
        }
        return {
          validReviewCount: manifest.validReviewCount,
          countStateFingerprint: manifest.countStateFingerprint,
        };
      });
    },
    async prepareReconciliationPage(reconcileParams) {
      const currentReviewCount = requireNonnegativeSafeInteger(
        reconcileParams.currentReviewCount,
        "currentReviewCount",
      );
      return db.runTransaction(async (transaction) => {
        await assertLock(transaction);
        const manifest = requireExpectedManifest(
          await transaction.get(manifestRef),
          ["count-complete"],
        );
        return prepareReconciliationPageFromManifest(
          manifest,
          reconcileParams.cursor,
          currentReviewCount,
          {userFingerprint, operationFingerprint, lockFingerprint},
        );
      });
    },
    async commitReconciliationPage(reconcileParams) {
      const currentReviewCount = requireNonnegativeSafeInteger(
        reconcileParams.currentReviewCount,
        "currentReviewCount",
      );
      const processedCount = requireBoundedProcessedCount(
        reconcileParams.processedCount,
        maximumContributionPointStepLimit,
      );
      const afterMilestone = requireReviewMilestoneAfterMilestone(
        reconcileParams.afterMilestone,
      );
      const afterLedgerDocumentId = reconcileParams.afterLedgerDocumentId === null
        ? null
        : readRequiredDocumentId(
          reconcileParams.afterLedgerDocumentId,
          "afterLedgerDocumentId",
        );
      if (
        !["awards", "ledger", "complete"].includes(reconcileParams.nextPhase) ||
        (reconcileParams.nextPhase === "awards" &&
          afterLedgerDocumentId !== null) ||
        (reconcileParams.nextPhase === "complete" &&
          afterLedgerDocumentId !== null)
      ) {
        throw new Error("Private milestone reconciliation state is invalid.");
      }
      return db.runTransaction(async (transaction) => {
        await assertLock(transaction);
        const manifest = requireExpectedManifest(
          await transaction.get(manifestRef),
          ["count-complete"],
        );
        const prepared = prepareReconciliationPageFromManifest(
          manifest,
          reconcileParams.cursor,
          currentReviewCount,
          {userFingerprint, operationFingerprint, lockFingerprint},
        );
        if (prepared.status === "already-committed") {
          if (prepared.result === null) {
            throw new Error("Private milestone reconciliation state is invalid.");
          }
          return {
            result: prepared.result,
            countStateFingerprint: prepared.countStateFingerprint,
            reconciliationStateFingerprint:
              manifest.reconciliationPhase === "complete"
                ? reviewMilestoneReconciliationStateFingerprint(manifest)
                : null,
          };
        }
        const nextManifest = buildReviewMilestoneAccumulatorManifest({
          ...manifest,
          reconciliationPhase: reconcileParams.nextPhase,
          reconciliationCount: currentReviewCount,
          reconciliationAfterMilestone: afterMilestone,
          reconciliationAfterLedgerDocumentId:
            reconcileParams.nextPhase === "ledger"
              ? afterLedgerDocumentId
              : null,
          previousReconciliationCursorFingerprint:
            reconcileParams.cursor?.fingerprint ?? null,
          lastReconciliationProcessedCount: processedCount,
        });
        transaction.set(manifestRef, nextManifest);
        return {
          result: reconciliationResultFromManifest(nextManifest),
          countStateFingerprint: nextManifest.countStateFingerprint as string,
          reconciliationStateFingerprint:
            reconcileParams.nextPhase === "complete"
              ? reviewMilestoneReconciliationStateFingerprint(nextManifest)
              : null,
        };
      });
    },
    async ensureTerminalState() {
      const terminal = await db.runTransaction(async (transaction) => {
        await assertLock(transaction);
        const manifest = requireExpectedManifest(
          await transaction.get(manifestRef),
          ["count-complete"],
        );
        if (
          manifest.reconciliationPhase !== "complete" ||
          manifest.countStateFingerprint === null
        ) {
          throw new Error("Private milestone reconciliation is incomplete.");
        }
        return {
          countStateFingerprint: manifest.countStateFingerprint,
          reconciliationStateFingerprint:
            reviewMilestoneReconciliationStateFingerprint(manifest),
        };
      });
      await recordReviewMilestoneReconciliationTerminalState(
        reviewMilestoneLockDatabase(db),
        lockIdentity,
        terminal,
      );
    },
  };
}

export async function reconcileReviewMilestonesForUserStep(
  db: FirestoreLike,
  params: Readonly<{
    userId: string;
    operationId: string;
    lockToken: string;
    currentReviewCount: number;
    cursor?: ReviewMilestoneReconcileCursor | null;
    limit: number;
    now?: unknown;
  }>,
  winnerAccumulator: ReviewMilestoneWinnerAccumulator,
  options: HelperOptions = {},
): Promise<ReviewMilestoneReconcileStepResult> {
  const lockIdentity = readReviewMilestoneLockIdentity(params);
  const userId = lockIdentity.userId;
  requireReviewMilestoneAccumulatorIdentity(
    winnerAccumulator,
    lockIdentity,
  );
  const currentReviewCount = requireNonnegativeSafeInteger(
    params.currentReviewCount,
    "currentReviewCount",
  );
  const limit = readContributionPointStepLimit(params.limit);
  const completedCount = await winnerAccumulator.readCompletedReviewCount();
  if (completedCount.validReviewCount !== currentReviewCount) {
    throw new Error("Private review milestone count binding is invalid.");
  }
  const cursor = readReviewMilestoneReconcileCursor(
    params.cursor,
    {
      userFingerprint: winnerAccumulator.userFingerprint,
      operationFingerprint: winnerAccumulator.operationFingerprint,
      lockFingerprint: winnerAccumulator.lockFingerprint,
      countStateFingerprint: completedCount.countStateFingerprint,
    },
  );
  const prepared = await winnerAccumulator.prepareReconciliationPage({
    cursor,
    currentReviewCount,
  });
  if (prepared.status === "already-committed") {
    if (prepared.result === null) {
      throw new Error("Private milestone reconciliation state is invalid.");
    }
    if (prepared.result.complete) {
      await winnerAccumulator.ensureTerminalState();
    }
    return prepared.result;
  }
  const stepOptions = withReviewMilestoneLockTransactionGuard(
    contributionPointStepOptions(params.now, options),
    db,
    lockIdentity,
  );
  const maximumEarnedMilestone = Math.floor(currentReviewCount / 5) * 5;
  let processedCount = 0;
  let phase: "awards" | "ledger" = cursor?.phase ?? "awards";
  let afterMilestone = cursor?.phase === "awards" ? cursor.afterMilestone : 0;
  let afterLedgerDocumentId = cursor?.phase === "ledger"
    ? cursor.afterLedgerDocumentId
    : null;

  if (phase === "awards") {
    let nextMilestone = afterMilestone + 5;
    while (
      nextMilestone <= maximumEarnedMilestone &&
      processedCount < limit
    ) {
      try {
        await awardContributionPointsTransaction(
          db,
          {
            userId,
            points: 1,
            actionType: contributionPointAction.reviewMilestone,
            sourceKey: reviewMilestoneSourceKey(userId, nextMilestone),
            description: `Reached ${nextMilestone} valid public reviews`,
          },
          stepOptions,
        );
      } catch {
        throw new Error("Review milestone reconciliation step failed.");
      }
      processedCount += 1;
      afterMilestone = nextMilestone;
      nextMilestone += 5;
    }

    if (nextMilestone <= maximumEarnedMilestone) {
      return (await winnerAccumulator.commitReconciliationPage({
        cursor,
        currentReviewCount,
        processedCount,
        nextPhase: "awards",
        afterMilestone,
        afterLedgerDocumentId: null,
      })).result;
    }
    phase = "ledger";
    afterLedgerDocumentId = null;
    if (processedCount === limit) {
      return (await winnerAccumulator.commitReconciliationPage({
        cursor,
        currentReviewCount,
        processedCount,
        nextPhase: "ledger",
        afterMilestone,
        afterLedgerDocumentId,
      })).result;
    }
  }

  const remainingLimit = limit - processedCount;
  let query = db
    .collection(contributionPointLedgerCollection)
    .where("userId", "==", userId)
    .where("actionType", "==", contributionPointAction.reviewMilestone)
    .orderBy(FieldPath.documentId(), "asc");
  if (afterLedgerDocumentId !== null) {
    query = query.startAfter(afterLedgerDocumentId);
  }
  const snapshot = await query.limit(remainingLimit).get();

  for (const doc of snapshot.docs) {
    const entry = parseLedgerEntry(doc);
    if (entry && entry.pointsDelta > 0) {
      const milestone = reviewMilestoneFromSourceKey(entry.sourceKey);
      if (
        milestone !== null &&
        !isEarnedReviewMilestone(milestone, currentReviewCount)
      ) {
        try {
          await reverseContributionPointLedgerEntryTransaction(
            db,
            {
              ledgerEntryId: doc.id,
              reason: `Valid public review count dropped below ${milestone}`,
            },
            stepOptions,
          );
        } catch {
          throw new Error("Review milestone reconciliation step failed.");
        }
      }
    }
    processedCount += 1;
    afterLedgerDocumentId = doc.id;
  }

  const complete = snapshot.docs.length < remainingLimit;
  const committed = await winnerAccumulator.commitReconciliationPage({
    cursor,
    currentReviewCount,
    processedCount,
    nextPhase: complete ? "complete" : "ledger",
    afterMilestone,
    afterLedgerDocumentId: complete ? null : afterLedgerDocumentId,
  });
  if (committed.result.complete) {
    await winnerAccumulator.ensureTerminalState();
  }
  return committed.result;
}

export async function awardReviewMilestoneContributionPointsCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointAwardResult }> {
  const targetUserId = requireCallableTargetUserId(request);
  const validReviewCount = await loadValidPublicReviewCountForUser(
    db,
    targetUserId,
  );
  const earnedMilestones = reviewMilestonesForCount(validReviewCount);
  const awardResults: ContributionPointAwardResult[] = [];

  for (const milestone of earnedMilestones) {
    awardResults.push(
      await awardContributionPointsTransaction(
        db,
        {
          userId: targetUserId,
          points: 1,
          actionType: contributionPointAction.reviewMilestone,
          sourceKey: reviewMilestoneSourceKey(targetUserId, milestone),
          description: `Reached ${milestone} valid public reviews`,
        },
        options,
      ),
    );
  }

  return {
    ok: true,
    result: combineContributionPointAwardResults(awardResults, {
      actionGroupId: `review_milestones:${targetUserId}:${validReviewCount}`,
    }),
  };
}

export async function awardDishImageContributionPointsCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointAwardResult }> {
  const uid = requireCallableUid(request.auth);
  const data = readRecord(request.data);
  const imageId = readRequiredString(data.imageId, "imageId");
  const expectedDishId = readOptionalString(data.dishId);
  const imageSnapshot = await db
    .collection("bitescore_dish_images")
    .doc(imageId)
    .get();
  if (!imageSnapshot.exists) {
    throw new HttpsError("not-found", "Dish image not found.");
  }

  const imageData = imageSnapshot.data() ?? {};
  const uploadedByUserId = readOptionalString(imageData.uploadedByUserId);
  const dishId = readOptionalString(imageData.dishId);
  const restaurantId = readOptionalString(imageData.restaurantId);
  if (!uploadedByUserId || !dishId || !restaurantId) {
    throw new HttpsError("failed-precondition", "Dish image is incomplete.");
  }
  if (uploadedByUserId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "You can only claim points for your own dish images.",
    );
  }
  if (expectedDishId !== null && expectedDishId !== dishId) {
    throw new HttpsError(
      "invalid-argument",
      "Dish ID does not match the image.",
    );
  }

  const dishSnapshot = await db.collection("bitescore_dishes").doc(dishId).get();
  if (!dishSnapshot.exists) {
    throw new HttpsError("not-found", "Dish not found.");
  }
  const restaurantSnapshot = await db
    .collection("bitescore_restaurants")
    .doc(restaurantId)
    .get();
  if (!restaurantSnapshot.exists) {
    throw new HttpsError("not-found", "Restaurant not found.");
  }

  const dishData = dishSnapshot.data() ?? {};
  const restaurantData = restaurantSnapshot.data() ?? {};
  const restaurantName =
    readOptionalString(restaurantData.name) ??
    readOptionalString(restaurantData.restaurantName);

  return {
    ok: true,
    result: await awardContributionPointsTransaction(
      db,
      {
        userId: uid,
        points: 1,
        actionType: contributionPointAction.dishImageAdded,
        sourceKey: dishImageAddedSourceKey(dishId, imageId),
        description: "Added a dish image",
        dishId,
        dishName: readOptionalString(dishData.name),
        restaurantId,
        restaurantName,
        restaurantCity: readOptionalString(restaurantData.city),
        restaurantState: readOptionalString(restaurantData.state),
        restaurantAddress:
          readOptionalString(restaurantData.address) ??
          readOptionalString(restaurantData.streetAddress),
        restaurantPhone: readOptionalString(restaurantData.phone),
        reviewId: readOptionalString(imageData.reviewId),
        imageId,
      },
      options,
    ),
  };
}

export async function awardCreatedDishContributionPointsCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointAwardResult }> {
  const uid = requireCallableUid(request.auth);
  const data = readRecord(request.data);
  const restaurantId = readRequiredString(data.restaurantId, "restaurantId");
  const dishId = readRequiredString(data.dishId, "dishId");
  const reviewId = readRequiredString(data.reviewId, "reviewId");

  const reviewSnapshot = await db.collection("dish_reviews").doc(reviewId).get();
  if (!reviewSnapshot.exists) {
    throw new HttpsError("not-found", "Review not found.");
  }
  const reviewData = reviewSnapshot.data() ?? {};
  if (readOptionalString(reviewData.userId) !== uid) {
    throw new HttpsError(
      "permission-denied",
      "You can only claim points for your own review-created dishes.",
    );
  }
  if (
    readOptionalString(reviewData.dishId) !== dishId ||
    readOptionalString(reviewData.restaurantId) !== restaurantId
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Review does not match the requested dish and restaurant.",
    );
  }

  const dishSnapshot = await db.collection("bitescore_dishes").doc(dishId).get();
  if (!dishSnapshot.exists) {
    throw new HttpsError("not-found", "Dish not found.");
  }
  const dishData = dishSnapshot.data() ?? {};
  if (!isActiveDishData(dishData)) {
    return noAwardResponse();
  }
  if (!dishCreationProvenanceMatches(dishData, {
    uid,
    restaurantId,
    reviewId,
  })) {
    return noAwardResponse();
  }

  const restaurantSnapshot = await db
    .collection("bitescore_restaurants")
    .doc(restaurantId)
    .get();
  if (!restaurantSnapshot.exists) {
    throw new HttpsError("not-found", "Restaurant not found.");
  }
  const restaurantData = restaurantSnapshot.data() ?? {};
  const restaurantProvenance = restaurantCreationProvenanceState(
    restaurantData,
    {
      uid,
      dishId,
      reviewId,
    },
  );
  const isFirstDish = await isFirstActiveDishForRestaurant(db, {
    restaurantId,
    dishId,
    dishSnapshot,
    dishData,
  });

  if (restaurantProvenance === "matching" && isFirstDish) {
    return {
      ok: true,
      result: await awardContributionPointsTransaction(
        db,
        createdDishAwardDraft({
          uid,
          points: 3,
          actionType: contributionPointAction.newRestaurantFirstDish,
          sourceKey: newRestaurantFirstDishSourceKey(restaurantId, dishId),
          description: "Added a new restaurant and its first dish",
          dishId,
          reviewId,
          dishData,
          restaurantId,
          restaurantData,
        }),
        options,
      ),
    };
  }

  if (isFirstDish) {
    return {
      ok: true,
      result: await awardContributionPointsTransaction(
        db,
        createdDishAwardDraft({
          uid,
          points: 3,
          actionType: contributionPointAction.restaurantFirstDish,
          sourceKey: restaurantFirstDishSourceKey(restaurantId, dishId),
          description: "Added the first dish to an existing restaurant",
          dishId,
          reviewId,
          dishData,
          restaurantId,
          restaurantData,
        }),
        options,
      ),
    };
  }

  return {
    ok: true,
    result: await awardContributionPointsTransaction(
      db,
      createdDishAwardDraft({
        uid,
        points: 1,
        actionType: contributionPointAction.dishCreated,
        sourceKey: dishCreatedSourceKey(dishId),
        description: "Added a dish to an existing restaurant",
        dishId,
        reviewId,
        dishData,
        restaurantId,
        restaurantData,
      }),
      options,
    ),
  };
}

export async function awardApprovedDishProposalContributionPointsCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointAwardResult }> {
  requireContributionPointAdmin(request.auth);
  const data = readRecord(request.data);
  const proposalId = readRequiredDocumentId(data.proposalId, "proposalId");
  const oldValue = readOptionalString(data.oldValue);
  const newValue = readOptionalString(data.newValue);

  return {
    ok: true,
    result: await awardApprovedDishProposalContributionPointsFromCallable(
      db,
      {
        proposalDocumentId: proposalId,
        oldValue,
        newValue,
      },
      options,
    ),
  };
}

async function awardApprovedDishProposalContributionPointsFromCallable(
  db: FirestoreLike,
  params: Readonly<{
    proposalDocumentId: string;
    oldValue?: string | null;
    newValue?: string | null;
  }>,
  options: HelperOptions = {},
): Promise<ContributionPointAwardResult> {
  const proposalId = readRequiredDocumentId(
    params.proposalDocumentId,
    "proposalId",
  );
  const proposalSnapshot = await db
    .collection("dish_edit_proposals")
    .doc(proposalId)
    .get();
  if (!proposalSnapshot.exists) {
    throw new HttpsError("not-found", "Dish edit proposal not found.");
  }

  const proposal = parseDishEditProposal(proposalSnapshot);
  if (!proposal) {
    throw new HttpsError(
      "failed-precondition",
      "Dish edit proposal is incomplete.",
    );
  }
  if (!isAwardableDishEditProposalStatus(proposal.status)) {
    return { entries: [] };
  }

  const targetDishSnapshot = await db
    .collection("bitescore_dishes")
    .doc(proposal.targetDishId)
    .get();
  const targetDishData = targetDishSnapshot.data() ?? {};
  const restaurantSnapshot = await db
    .collection("bitescore_restaurants")
    .doc(proposal.restaurantId)
    .get();
  const restaurantData = restaurantSnapshot.data() ?? {};
  const mergeTargetDishSnapshot = proposal.mergeTargetDishId
    ? await db
      .collection("bitescore_dishes")
      .doc(proposal.mergeTargetDishId)
      .get()
    : null;
  const mergeTargetDishData = mergeTargetDishSnapshot?.data() ?? {};
  const oldValueFromClient = readOptionalString(params.oldValue);
  const newValueFromClient = readOptionalString(params.newValue);

  const draft = approvedDishProposalAwardDraft({
    proposal,
    targetDishData,
    mergeTargetDishData,
    restaurantData,
    oldValueFromClient,
    newValueFromClient,
  });
  if (!draft) {
    return { entries: [] };
  }

  return awardContributionPointsWithExactSourceKey(db, draft, options);
}

export async function
awardApprovedDishProposalContributionPointsForResolutionCycle(
  db: FirestoreLike,
  params: DishProposalResolutionPointAwardRequest,
  options: HelperOptions = {},
): Promise<DishProposalResolutionPointAwardResult> {
  const expected = parseDishProposalResolutionPointAwardRequest(params);
  const fieldValues = options.fieldValues ?? adminServerFieldValues;
  const proposalRef = db.collection("dish_edit_proposals")
    .doc(expected.proposalDocumentId);
  const memberRef = db.collection(dishProposalMemberCollection)
    .doc(createDishProposalMemberId(expected.proposalDocumentId));
  const groupRef = db.collection(dishProposalGroupCollection)
    .doc(expected.groupId);
  const supporterRef = db.collection(dishProposalSupporterCollection)
    .doc(createDishProposalSupporterId(
      expected.groupId,
      expected.supporterUid,
    ));

  return db.runTransaction(async (transaction) => {
    const [proposalSnapshot, memberSnapshot, groupSnapshot, supporterSnapshot] =
      await Promise.all([
        transaction.get(proposalRef),
        transaction.get(memberRef),
        transaction.get(groupRef),
        transaction.get(supporterRef),
      ]);
    const eligibility = validateResolutionCyclePointEligibility({
      proposalSnapshot,
      memberSnapshot,
      groupSnapshot,
      supporterSnapshot,
      expected,
    });
    if (eligibility === null) {
      return noDishProposalResolutionPointAward("notEligible");
    }

    const { proposal, currentMembership } = eligibility;
    const targetDishRef = db.collection("bitescore_dishes")
      .doc(proposal.targetDishId);
    const restaurantRef = db.collection("bitescore_restaurants")
      .doc(proposal.restaurantId);
    const mergeTargetDishRef = proposal.mergeTargetDishId === null
      ? null
      : db.collection("bitescore_dishes").doc(proposal.mergeTargetDishId);
    const [targetDishSnapshot, restaurantSnapshot, mergeTargetDishSnapshot] =
      await Promise.all([
        transaction.get(targetDishRef),
        transaction.get(restaurantRef),
        mergeTargetDishRef === null
          ? Promise.resolve(null)
          : transaction.get(mergeTargetDishRef),
      ]);
    const trustedDraft = approvedDishProposalResolutionAwardDraft({
      proposal,
      currentMembership,
      targetDishData: targetDishSnapshot.data() ?? {},
      mergeTargetDishData: mergeTargetDishSnapshot?.data() ?? {},
      restaurantData: restaurantSnapshot.data() ?? {},
      oldValue: expected.oldValue,
      newValue: expected.newValue,
    });
    if (trustedDraft === "noAwardForNoOp") {
      return noDishProposalResolutionPointAward("noAwardForNoOp");
    }
    if (trustedDraft === null) {
      return noDishProposalResolutionPointAward("notEligible");
    }

    const transactionAward = await awardContributionPointsWithinTransaction(
      transaction,
      db,
      trustedDraft,
      true,
      fieldValues,
    );
    return {
      outcome: transactionAward.wasCreated ? "awarded" : "alreadyAwarded",
      result: transactionAward.result,
    };
  });
}

export async function reverseContributionPointsForDishCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointDishReverseResult }> {
  requireContributionPointAdmin(request.auth);
  const data = readRecord(request.data);
  const dishId = readRequiredString(data.dishId, "dishId");
  const reason =
    readOptionalString(data.reason) ?? "Dish was deleted by moderation";
  const snapshot = await db
    .collection(contributionPointLedgerCollection)
    .where("dishId", "==", dishId)
    .get();
  const result = emptyDishReverseResult(dishId);

  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    const pointsDelta = readNumber(data.pointsDelta);
    if (pointsDelta === null || pointsDelta <= 0) {
      result.ignoredEntryIds.push(doc.id);
      continue;
    }

    result.attemptedCount += 1;
    await reverseEntryForModerationResult(db, {
      ledgerEntryId: doc.id,
      reason,
      result,
      options,
    });
  }

  return { ok: true, result };
}

export async function reconcileReviewMilestoneContributionPointsAfterModerationCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointMilestoneReconcileResult }> {
  requireContributionPointAdmin(request.auth);
  const data = readRecord(request.data);
  const userId = readRequiredString(data.userId, "userId");
  const validReviewCount = await loadValidPublicReviewCountForUser(db, userId);
  const earnedMilestones = new Set(reviewMilestonesForCount(validReviewCount));
  const awardResults: ContributionPointAwardResult[] = [];

  for (const milestone of earnedMilestones) {
    awardResults.push(
      await awardContributionPointsTransaction(
        db,
        {
          userId,
          points: 1,
          actionType: contributionPointAction.reviewMilestone,
          sourceKey: reviewMilestoneSourceKey(userId, milestone),
          description: `Reached ${milestone} valid public reviews`,
        },
        options,
      ),
    );
  }

  const result: ContributionPointMilestoneReconcileResult = {
    userId,
    validReviewCount,
    awardResult: combineContributionPointAwardResults(awardResults, {
      actionGroupId: `review_milestones:${userId}:${validReviewCount}`,
    }),
    reversedEntryIds: [],
    alreadyReversedEntryIds: [],
    missingEntryIds: [],
    ignoredEntryIds: [],
    errors: [],
  };
  const snapshot = await db
    .collection(contributionPointLedgerCollection)
    .where("userId", "==", userId)
    .where("actionType", "==", contributionPointAction.reviewMilestone)
    .get();

  for (const doc of snapshot.docs) {
    const entry = parseLedgerEntry(doc);
    if (!entry || entry.pointsDelta <= 0) {
      result.ignoredEntryIds.push(doc.id);
      continue;
    }

    const milestone = reviewMilestoneFromSourceKey(entry.sourceKey);
    if (milestone === null) {
      result.ignoredEntryIds.push(entry.id);
      continue;
    }
    if (earnedMilestones.has(milestone)) {
      continue;
    }

    await reverseEntryForModerationResult(db, {
      ledgerEntryId: entry.id,
      reason: `Valid public review count dropped below ${milestone}`,
      result,
      options,
    });
  }

  return { ok: true, result };
}

export async function markContributionPointLedgerEntriesCelebratedTransaction(
  db: FirestoreLike,
  params: { userId: string; ledgerEntryIds: string[] },
  options: HelperOptions = {},
): Promise<ContributionPointCelebrationMarkResult> {
  const userId = params.userId.trim();
  const attemptedEntryIds = normalizeLedgerEntryIds(params.ledgerEntryIds);
  const markedEntryIds = new Set<string>();
  const alreadyCelebratedEntryIds = new Set<string>();
  const missingEntryIds = new Set<string>();
  const ignoredEntryIds = new Set<string>();
  const fieldValues = options.fieldValues ?? adminServerFieldValues;

  await db.runTransaction(async (transaction) => {
    for (const ledgerEntryId of attemptedEntryIds) {
      const entryRef = ledgerDocument(db, ledgerEntryId);
      const snapshot = await transaction.get(entryRef);
      if (!snapshot.exists) {
        missingEntryIds.add(ledgerEntryId);
        continue;
      }

      const data = snapshot.data() ?? {};
      const ownerUserId = readOptionalString(data.userId);
      if (ownerUserId !== null && ownerUserId !== userId) {
        throw new HttpsError(
          "permission-denied",
          "You can only mark your own contribution points celebrated.",
        );
      }
      if (ownerUserId === null) {
        ignoredEntryIds.add(ledgerEntryId);
        continue;
      }

      const currentCelebrationStatus = readOptionalString(
        data.celebrationStatus,
      );
      if (
        currentCelebrationStatus ===
        contributionPointCelebrationStatus.celebrated
      ) {
        alreadyCelebratedEntryIds.add(ledgerEntryId);
        continue;
      }

      const entry = parseLedgerEntry(snapshot);
      if (
        !entry ||
        entry.pointsDelta <= 0 ||
        entry.status !== contributionPointStatus.active ||
        entry.celebrationStatus !== contributionPointCelebrationStatus.pending
      ) {
        ignoredEntryIds.add(ledgerEntryId);
        continue;
      }

      transaction.set(
        entryRef,
        {
          celebrationStatus: contributionPointCelebrationStatus.celebrated,
          celebratedAt: fieldValues.serverTimestamp(),
          updatedAt: fieldValues.serverTimestamp(),
        },
        { merge: true },
      );
      markedEntryIds.add(ledgerEntryId);
    }
  });

  return {
    attemptedEntryIds,
    markedEntryIds: Array.from(markedEntryIds),
    alreadyCelebratedEntryIds: Array.from(alreadyCelebratedEntryIds),
    missingEntryIds: Array.from(missingEntryIds),
    ignoredEntryIds: Array.from(ignoredEntryIds),
  };
}

export async function markContributionPointLedgerEntriesCelebratedCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointCelebrationMarkResult }> {
  const userId = requireCallableUid(request.auth);
  const data = readRecord(request.data);
  const ledgerEntryIds = readLedgerEntryIdsFromCallable(data.ledgerEntryIds);

  return {
    ok: true,
    result: await markContributionPointLedgerEntriesCelebratedTransaction(
      db,
      { userId, ledgerEntryIds },
      options,
    ),
  };
}

export async function awardContributionPointsCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointAwardResult }> {
  requireContributionPointAdmin(request.auth);
  const draft = readAwardDraftFromCallable(request.data);
  return {
    ok: true,
    result: await awardContributionPointsTransaction(db, draft, options),
  };
}

export async function reverseContributionPointLedgerEntryCallableHandler(
  db: FirestoreLike,
  request: CallableRequest<unknown>,
  options: HelperOptions = {},
): Promise<{ ok: true; result: ContributionPointReverseResult }> {
  requireContributionPointAdmin(request.auth);
  const data = readRecord(request.data);
  const ledgerEntryId = readRequiredString(data.ledgerEntryId, "ledgerEntryId");
  const reason = readRequiredString(data.reason, "reason");

  return {
    ok: true,
    result: await reverseContributionPointLedgerEntryTransaction(db, {
      ledgerEntryId,
      reason,
    }, options),
  };
}

export function isContributionPointAdmin(
  auth: CallableAuthLike | null | undefined,
): boolean {
  const token = auth?.token;
  const email = readOptionalString(token?.email);
  return (
    token?.admin === true ||
    (email !== null && betaAdminEmails.has(email.toLowerCase()))
  );
}

function requireContributionPointAdmin(
  auth: CallableAuthLike | null | undefined,
): void {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in to manage points.");
  }
  if (!isContributionPointAdmin(auth)) {
    throw new HttpsError(
      "permission-denied",
      "Admin access is required to mutate contribution points.",
    );
  }
}

function requireCallableUid(auth: CallableAuthLike | null | undefined): string {
  const uid = readOptionalString(auth?.uid);
  if (uid === null) {
    throw new HttpsError("unauthenticated", "Sign in to earn points.");
  }
  return uid;
}

function requireCallableTargetUserId(request: CallableRequest<unknown>): string {
  const uid = requireCallableUid(request.auth);
  const data = readRecord(request.data);
  const targetUserId = readOptionalString(data.userId) ?? uid;
  if (targetUserId !== uid && !isContributionPointAdmin(request.auth)) {
    throw new HttpsError(
      "permission-denied",
      "You can only reconcile your own contribution points.",
    );
  }
  return targetUserId;
}

function reviewMilestonePointsForCount(validReviewCount: number): number {
  if (validReviewCount <= 0) {
    return 0;
  }
  return Math.floor(validReviewCount / 5);
}

function reviewMilestonesForCount(validReviewCount: number): number[] {
  return Array.from(
    { length: reviewMilestonePointsForCount(validReviewCount) },
    (_, index) => (index + 1) * 5,
  );
}

function reviewMilestoneSourceKey(userId: string, milestone: number): string {
  return `review_milestone:${userId.trim()}:${milestone}`;
}

function reviewMilestoneFromSourceKey(sourceKey: string): number | null {
  const parts = sourceKey.trim().split(":");
  if (
    parts.length < 3 ||
    parts[0] !== contributionPointAction.reviewMilestone
  ) {
    return null;
  }
  const milestone = Number.parseInt(parts[parts.length - 1], 10);
  return Number.isInteger(milestone) ? milestone : null;
}

function dishImageAddedSourceKey(dishId: string, imageId: string): string {
  return `dish_image_added:${dishId.trim()}:${imageId.trim()}`;
}

function dishCreatedSourceKey(dishId: string): string {
  return `dish_created:${dishId.trim()}`;
}

function restaurantFirstDishSourceKey(
  restaurantId: string,
  dishId: string,
): string {
  return `restaurant_first_dish:${restaurantId.trim()}:${dishId.trim()}`;
}

function newRestaurantFirstDishSourceKey(
  restaurantId: string,
  dishId: string,
): string {
  return `new_restaurant_first_dish:${restaurantId.trim()}:${dishId.trim()}`;
}

export async function loadValidPublicReviewCountForUser(
  db: FirestoreLike,
  userId: string,
): Promise<number> {
  const trimmedUserId = userId.trim();
  const snapshot = await db
    .collection("dish_reviews")
    .where("userId", "==", trimmedUserId)
    .get();
  const uniqueReviewKeys = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    if (!isPublicReviewData(data)) {
      continue;
    }
    const dishId = readOptionalString(data.dishId);
    const reviewUserId = readOptionalString(data.userId);
    if (dishId === null || reviewUserId !== trimmedUserId) {
      continue;
    }
    uniqueReviewKeys.add(`${dishId}::${reviewUserId}`);
  }
  return uniqueReviewKeys.size;
}

function isPublicReviewData(data: Record<string, unknown>): boolean {
  if (
    data.isPublic === false ||
    data.isHidden === true ||
    data.hidden === true ||
    data.deleted === true ||
    data.isDeleted === true ||
    data.rejected === true
  ) {
    return false;
  }
  const status = readOptionalString(data.status)?.toLowerCase();
  if (
    status === "deleted" ||
    status === "hidden" ||
    status === "rejected"
  ) {
    return false;
  }
  return true;
}

function noAwardResponse(): { ok: true; result: ContributionPointAwardResult } {
  return { ok: true, result: { entries: [] } };
}

function emptyDishReverseResult(
  dishId: string,
): ContributionPointDishReverseResult {
  return {
    dishId,
    attemptedCount: 0,
    reversedEntryIds: [],
    alreadyReversedEntryIds: [],
    missingEntryIds: [],
    ignoredEntryIds: [],
    errors: [],
  };
}

function reviewMilestoneAccumulatorUserFingerprint(userId: string): string {
  return contractSha256([
    reviewMilestoneAccumulatorVersion,
    ["userId", readRequiredDocumentId(userId, "userId")],
  ]);
}

function reviewMilestoneAccumulatorScanFingerprint(
  namespaceId: string,
  userFingerprint: string,
  operationFingerprint: string,
  lockFingerprint: string,
  scanId: string,
): string {
  return contractSha256([
    reviewMilestoneAccumulatorVersion,
    ["namespaceId", readRequiredDocumentId(namespaceId, "namespaceId")],
    ["userFingerprint", requireSha256Fingerprint(
      userFingerprint,
      "userFingerprint",
    )],
    ["operationFingerprint", requireSha256Fingerprint(
      operationFingerprint,
      "operationFingerprint",
    )],
    ["lockFingerprint", requireSha256Fingerprint(
      lockFingerprint,
      "lockFingerprint",
    )],
    ["scanId", readRequiredDocumentId(scanId, "scanId")],
  ]);
}

function buildReviewMilestoneAccumulatorManifest(
  value: Omit<ReviewMilestoneAccumulatorManifest, "version" | "fingerprint">,
): ReviewMilestoneAccumulatorManifest {
  const core = {
    version: reviewMilestoneAccumulatorVersion,
    userFingerprint: requireSha256Fingerprint(
      value.userFingerprint,
      "userFingerprint",
    ),
    operationFingerprint: requireSha256Fingerprint(
      value.operationFingerprint,
      "operationFingerprint",
    ),
    lockFingerprint: requireSha256Fingerprint(
      value.lockFingerprint,
      "lockFingerprint",
    ),
    scanFingerprint: requireSha256Fingerprint(
      value.scanFingerprint,
      "scanFingerprint",
    ),
    state: value.state,
    resetAfterDocumentId: readNullableExactDocumentId(
      value.resetAfterDocumentId,
      "resetAfterDocumentId",
    ),
    reviewPageSequence: requireNonnegativeSafeInteger(
      value.reviewPageSequence,
      "reviewPageSequence",
    ),
    reviewAfterDocumentId: readNullableExactDocumentId(
      value.reviewAfterDocumentId,
      "reviewAfterDocumentId",
    ),
    previousReviewAfterDocumentId: readNullableExactDocumentId(
      value.previousReviewAfterDocumentId,
      "previousReviewAfterDocumentId",
    ),
    lastReviewProcessedCount: requireBoundedProcessedCount(
      value.lastReviewProcessedCount,
      maximumReviewMilestoneScanStepLimit,
    ),
    validReviewCount: requireNonnegativeSafeInteger(
      value.validReviewCount,
      "validReviewCount",
    ),
    countStateFingerprint: readNullableSha256Fingerprint(
      value.countStateFingerprint,
      "countStateFingerprint",
    ),
    reconciliationPhase: value.reconciliationPhase,
    reconciliationCount: value.reconciliationCount === null
      ? null
      : requireNonnegativeSafeInteger(
        value.reconciliationCount,
        "reconciliationCount",
      ),
    reconciliationAfterMilestone: requireReviewMilestoneAfterMilestone(
      value.reconciliationAfterMilestone,
    ),
    reconciliationAfterLedgerDocumentId: readNullableExactDocumentId(
      value.reconciliationAfterLedgerDocumentId,
      "reconciliationAfterLedgerDocumentId",
    ),
    previousReconciliationCursorFingerprint: readNullableSha256Fingerprint(
      value.previousReconciliationCursorFingerprint,
      "previousReconciliationCursorFingerprint",
    ),
    lastReconciliationProcessedCount: requireBoundedProcessedCount(
      value.lastReconciliationProcessedCount,
      maximumContributionPointStepLimit,
    ),
  } as const;
  if (
    !["resetting", "ready", "counting", "count-complete"].includes(
      core.state,
    ) ||
    !["not-started", "awards", "ledger", "complete"].includes(
      core.reconciliationPhase,
    ) ||
    !reviewMilestoneManifestStateIsConsistent(core)
  ) {
    throw new Error("Private review milestone accumulator state is invalid.");
  }
  return Object.freeze({
    ...core,
    fingerprint: reviewMilestoneAccumulatorManifestFingerprint(core),
  });
}

function reviewMilestoneAccumulatorManifestFingerprint(
  value: Omit<ReviewMilestoneAccumulatorManifest, "fingerprint">,
): string {
  return contractSha256([
    reviewMilestoneAccumulatorVersion,
    ["userFingerprint", value.userFingerprint],
    ["operationFingerprint", value.operationFingerprint],
    ["lockFingerprint", value.lockFingerprint],
    ["scanFingerprint", value.scanFingerprint],
    ["state", value.state],
    ["resetAfterDocumentId", value.resetAfterDocumentId],
    ["reviewPageSequence", value.reviewPageSequence],
    ["reviewAfterDocumentId", value.reviewAfterDocumentId],
    ["previousReviewAfterDocumentId", value.previousReviewAfterDocumentId],
    ["lastReviewProcessedCount", value.lastReviewProcessedCount],
    ["validReviewCount", value.validReviewCount],
    ["countStateFingerprint", value.countStateFingerprint],
    ["reconciliationPhase", value.reconciliationPhase],
    ["reconciliationCount", value.reconciliationCount],
    ["reconciliationAfterMilestone", value.reconciliationAfterMilestone],
    [
      "reconciliationAfterLedgerDocumentId",
      value.reconciliationAfterLedgerDocumentId,
    ],
    [
      "previousReconciliationCursorFingerprint",
      value.previousReconciliationCursorFingerprint,
    ],
    [
      "lastReconciliationProcessedCount",
      value.lastReconciliationProcessedCount,
    ],
  ]);
}

function reviewMilestoneManifestStateIsConsistent(
  value: Omit<ReviewMilestoneAccumulatorManifest, "fingerprint">,
): boolean {
  const reconciliationNotStarted =
    value.reconciliationPhase === "not-started" &&
    value.reconciliationCount === null &&
    value.reconciliationAfterMilestone === 0 &&
    value.reconciliationAfterLedgerDocumentId === null &&
    value.previousReconciliationCursorFingerprint === null &&
    value.lastReconciliationProcessedCount === 0;
  if (value.state === "resetting") {
    return value.reviewPageSequence === 0 &&
      value.reviewAfterDocumentId === null &&
      value.previousReviewAfterDocumentId === null &&
      value.lastReviewProcessedCount === 0 &&
      value.validReviewCount === 0 &&
      value.countStateFingerprint === null &&
      reconciliationNotStarted;
  }
  if (value.state === "ready") {
    return value.resetAfterDocumentId === null &&
      value.reviewPageSequence === 0 &&
      value.reviewAfterDocumentId === null &&
      value.previousReviewAfterDocumentId === null &&
      value.lastReviewProcessedCount === 0 &&
      value.validReviewCount === 0 &&
      value.countStateFingerprint === null &&
      reconciliationNotStarted;
  }
  if (value.state === "counting") {
    return value.resetAfterDocumentId === null &&
      value.reviewPageSequence >= 1 &&
      value.reviewAfterDocumentId !== null &&
      value.lastReviewProcessedCount >= 1 &&
      value.countStateFingerprint === null &&
      reconciliationNotStarted;
  }
  if (
    value.state !== "count-complete" ||
    value.resetAfterDocumentId !== null ||
    value.reviewPageSequence < 1 ||
    value.reviewAfterDocumentId !== null ||
    value.countStateFingerprint !== reviewMilestoneCountStateFingerprint({
      userFingerprint: value.userFingerprint,
      operationFingerprint: value.operationFingerprint,
      lockFingerprint: value.lockFingerprint,
      scanFingerprint: value.scanFingerprint,
      validReviewCount: value.validReviewCount,
    })
  ) {
    return false;
  }
  if (value.reconciliationPhase === "not-started") {
    return reconciliationNotStarted;
  }
  if (value.reconciliationCount !== value.validReviewCount) {
    return false;
  }
  if (value.reconciliationPhase === "awards") {
    return value.reconciliationAfterLedgerDocumentId === null;
  }
  if (value.reconciliationPhase === "ledger") {
    return true;
  }
  return value.reconciliationPhase === "complete" &&
    value.reconciliationAfterLedgerDocumentId === null;
}

function parseReviewMilestoneAccumulatorManifest(
  snapshot: DocumentSnapshotLike,
): ReviewMilestoneAccumulatorManifest {
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    data === undefined ||
    !hasExactKeys(data, reviewMilestoneAccumulatorManifestKeys) ||
    data.version !== reviewMilestoneAccumulatorVersion ||
    !["resetting", "ready", "counting", "count-complete"].includes(
      String(data.state),
    ) ||
    !["not-started", "awards", "ledger", "complete"].includes(
      String(data.reconciliationPhase),
    )
  ) {
    throw new Error("Review milestone accumulator manifest is invalid.");
  }
  const manifest = buildReviewMilestoneAccumulatorManifest({
    userFingerprint: requireSha256Fingerprint(
      data.userFingerprint,
      "userFingerprint",
    ),
    operationFingerprint: requireSha256Fingerprint(
      data.operationFingerprint,
      "operationFingerprint",
    ),
    lockFingerprint: requireSha256Fingerprint(
      data.lockFingerprint,
      "lockFingerprint",
    ),
    scanFingerprint: requireSha256Fingerprint(
      data.scanFingerprint,
      "scanFingerprint",
    ),
    state: data.state as ReviewMilestoneAccumulatorManifest["state"],
    resetAfterDocumentId: readNullableExactDocumentId(
      data.resetAfterDocumentId,
      "resetAfterDocumentId",
    ),
    reviewPageSequence: requireNonnegativeSafeInteger(
      data.reviewPageSequence,
      "reviewPageSequence",
    ),
    reviewAfterDocumentId: readNullableExactDocumentId(
      data.reviewAfterDocumentId,
      "reviewAfterDocumentId",
    ),
    previousReviewAfterDocumentId: readNullableExactDocumentId(
      data.previousReviewAfterDocumentId,
      "previousReviewAfterDocumentId",
    ),
    lastReviewProcessedCount: requireBoundedProcessedCount(
      data.lastReviewProcessedCount,
      maximumReviewMilestoneScanStepLimit,
    ),
    validReviewCount: requireNonnegativeSafeInteger(
      data.validReviewCount,
      "validReviewCount",
    ),
    countStateFingerprint: readNullableSha256Fingerprint(
      data.countStateFingerprint,
      "countStateFingerprint",
    ),
    reconciliationPhase:
      data.reconciliationPhase as ReviewMilestoneAccumulatorManifest[
        "reconciliationPhase"
      ],
    reconciliationCount: data.reconciliationCount === null
      ? null
      : requireNonnegativeSafeInteger(
        data.reconciliationCount,
        "reconciliationCount",
      ),
    reconciliationAfterMilestone: requireReviewMilestoneAfterMilestone(
      data.reconciliationAfterMilestone,
    ),
    reconciliationAfterLedgerDocumentId: readNullableExactDocumentId(
      data.reconciliationAfterLedgerDocumentId,
      "reconciliationAfterLedgerDocumentId",
    ),
    previousReconciliationCursorFingerprint: readNullableSha256Fingerprint(
      data.previousReconciliationCursorFingerprint,
      "previousReconciliationCursorFingerprint",
    ),
    lastReconciliationProcessedCount: requireBoundedProcessedCount(
      data.lastReconciliationProcessedCount,
      maximumContributionPointStepLimit,
    ),
  });
  if (manifest.fingerprint !== data.fingerprint) {
    throw new Error("Review milestone accumulator fingerprint is invalid.");
  }
  return manifest;
}

function buildReviewMilestoneSeenValidIdentity(
  scanFingerprint: string,
  identityFingerprint: string,
): ReviewMilestoneSeenValidIdentity {
  const core = {
    version: reviewMilestoneWinnerVersion,
    scanFingerprint: requireSha256Fingerprint(
      scanFingerprint,
      "scanFingerprint",
    ),
    identityFingerprint: requireSha256Fingerprint(
      identityFingerprint,
      "identityFingerprint",
    ),
    validPublicReview: true,
  } as const;
  return Object.freeze({
    ...core,
    fingerprint: reviewMilestoneSeenValidIdentityFingerprint(core),
  });
}

function reviewMilestoneSeenValidIdentityFingerprint(
  value: Omit<ReviewMilestoneSeenValidIdentity, "fingerprint">,
): string {
  return contractSha256([
    reviewMilestoneWinnerVersion,
    ["scanFingerprint", value.scanFingerprint],
    ["identityFingerprint", value.identityFingerprint],
    ["validPublicReview", value.validPublicReview],
  ]);
}

function parseStoredReviewMilestoneSeenValidIdentity(
  snapshot: DocumentSnapshotLike,
): ReviewMilestoneSeenValidIdentity {
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    data === undefined ||
    !hasExactKeys(data, reviewMilestoneWinnerKeys) ||
    data.version !== reviewMilestoneWinnerVersion ||
    data.validPublicReview !== true
  ) {
    throw new Error("Stored review milestone identity is invalid.");
  }
  const identity = buildReviewMilestoneSeenValidIdentity(
    requireSha256Fingerprint(data.scanFingerprint, "scanFingerprint"),
    requireSha256Fingerprint(data.identityFingerprint, "identityFingerprint"),
  );
  if (
    snapshot.id !== identity.identityFingerprint ||
    data.fingerprint !== identity.fingerprint
  ) {
    throw new Error("Stored review milestone identity fingerprint is invalid.");
  }
  return identity;
}

function contractSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function requireSha256Fingerprint(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${fieldName} fingerprint is invalid.`);
  }
  return value;
}

function readNullableSha256Fingerprint(
  value: unknown,
  fieldName: string,
): string | null {
  return value === null ? null : requireSha256Fingerprint(value, fieldName);
}

function readNullableExactDocumentId(
  value: unknown,
  fieldName: string,
): string | null {
  return value === null ? null : readRequiredDocumentId(value, fieldName);
}

function requireBoundedProcessedCount(value: unknown, maximum: number): number {
  const count = requireNonnegativeSafeInteger(value, "processedCount");
  if (count > maximum) {
    throw new Error("Private bounded step count is invalid.");
  }
  return count;
}

function readPrivateOperationId(value: unknown): string {
  const operationId = readRequiredDocumentId(value, "operationId");
  if (
    operationId !== operationId.trim() ||
    /^__.*__$/u.test(operationId) ||
    /\p{Cc}/u.test(operationId)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Private reconciliation identity is invalid.",
    );
  }
  return operationId;
}

function readPrivateUserId(value: unknown): string {
  const userId = readRequiredDocumentId(value, "userId");
  if (
    userId !== userId.trim() ||
    /^__.*__$/u.test(userId) ||
    /\p{Cc}/u.test(userId)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Private reconciliation identity is invalid.",
    );
  }
  return userId;
}

function readReviewMilestoneLockIdentity(
  value: Readonly<{
    userId: string;
    operationId: string;
    lockToken: string;
  }>,
): ReviewMilestoneReconciliationLockIdentity {
  if (typeof value.lockToken !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.lockToken)) {
    throw new HttpsError(
      "invalid-argument",
      "Private reconciliation identity is invalid.",
    );
  }
  return Object.freeze({
    userId: readPrivateUserId(value.userId),
    operationId: readPrivateOperationId(value.operationId),
    lockToken: value.lockToken,
  });
}

function reviewMilestoneOperationFingerprint(operationId: string): string {
  return contractSha256([
    "bitestar.review-milestone-operation.v1",
    ["operationId", readPrivateOperationId(operationId)],
  ]);
}

function reviewMilestoneLockIdentityFingerprint(
  identity: ReviewMilestoneReconciliationLockIdentity,
): string {
  return contractSha256([
    "bitestar.review-milestone-lock-binding.v1",
    ["userId", identity.userId],
    ["operationId", identity.operationId],
    ["lockToken", identity.lockToken],
  ]);
}

function reviewMilestoneLockDatabase(
  db: FirestoreLike,
): ReviewMilestoneReconciliationLockDatabase {
  return db as unknown as ReviewMilestoneReconciliationLockDatabase;
}

function reviewMilestoneLockTransaction(
  transaction: TransactionLike,
): ReviewMilestoneReconciliationLockTransaction {
  return transaction as unknown as ReviewMilestoneReconciliationLockTransaction;
}

function requireReviewMilestoneAccumulatorIdentity(
  accumulator: ReviewMilestoneWinnerAccumulator,
  identity: ReviewMilestoneReconciliationLockIdentity,
): void {
  if (
    accumulator.userFingerprint !==
      reviewMilestoneAccumulatorUserFingerprint(identity.userId) ||
    accumulator.operationFingerprint !==
      reviewMilestoneOperationFingerprint(identity.operationId) ||
    accumulator.lockFingerprint !==
      reviewMilestoneLockIdentityFingerprint(identity)
  ) {
    throw new Error("Private review milestone workflow binding is invalid.");
  }
}

function withReviewMilestoneLockTransactionGuard(
  options: HelperOptions,
  db: FirestoreLike,
  identity: ReviewMilestoneReconciliationLockIdentity,
): HelperOptions {
  return {
    ...options,
    transactionGuard: async (transaction) => {
      await assertActiveReviewMilestoneReconciliationLockInTransaction(
        reviewMilestoneLockDatabase(db),
        reviewMilestoneLockTransaction(transaction),
        identity,
      );
      await options.transactionGuard?.(transaction);
    },
  };
}

function requireCursorRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failCursor();
  }
  return value as Record<string, unknown>;
}

function requireCursorKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (!hasExactKeys(value, keys)) {
    failCursor();
  }
}

function failCursor(): never {
  throw new Error("Private cursor is invalid.");
}

function cursorFingerprint(value: {fingerprint: string} | null): string | null {
  return value?.fingerprint ?? null;
}

function cursorDocumentId(
  value: ReviewMilestoneAccumulatorResetCursor | null,
): string | null {
  return value?.afterWinnerDocumentId ?? null;
}

function reviewMilestoneCursorBindingFingerprintFields(
  value: ReviewMilestoneCursorBindings,
): readonly (readonly [string, string])[] {
  return [
    ["userFingerprint", value.userFingerprint],
    ["operationFingerprint", value.operationFingerprint],
    ["lockFingerprint", value.lockFingerprint],
    ["countStateFingerprint", value.countStateFingerprint],
  ];
}

function reviewMilestoneCursorBindingsMatch(
  value: ReviewMilestoneCursorBindings,
  expected: ReviewMilestoneCursorBindings,
): boolean {
  return value.userFingerprint === expected.userFingerprint &&
    value.operationFingerprint === expected.operationFingerprint &&
    value.lockFingerprint === expected.lockFingerprint &&
    value.countStateFingerprint === expected.countStateFingerprint;
}

function contributionPointDishReverseContextFingerprint(dishId: string): string {
  return contractSha256([
    contributionPointDishReverseCursorVersion,
    ["dishId", readRequiredDocumentId(dishId, "dishId")],
  ]);
}

function buildContributionPointDishReverseCursor(value: Readonly<{
  operationFingerprint: string;
  dishFingerprint: string;
  afterLedgerDocumentId: string;
}>): ContributionPointDishReverseCursor {
  const core = {
    version: contributionPointDishReverseCursorVersion,
    phase: "dish-ledger" as const,
    operationFingerprint: requireSha256Fingerprint(
      value.operationFingerprint,
      "operationFingerprint",
    ),
    dishFingerprint: requireSha256Fingerprint(
      value.dishFingerprint,
      "dishFingerprint",
    ),
    afterLedgerDocumentId: readRequiredDocumentId(
      value.afterLedgerDocumentId,
      "afterLedgerDocumentId",
    ),
  };
  return Object.freeze({
    ...core,
    fingerprint: contractSha256([
      contributionPointDishReverseCursorVersion,
      ["phase", core.phase],
      ["operationFingerprint", core.operationFingerprint],
      ["dishFingerprint", core.dishFingerprint],
      ["afterLedgerDocumentId", core.afterLedgerDocumentId],
    ]),
  });
}

function buildReviewMilestoneAccumulatorResetCursor(value: Readonly<{
  userFingerprint: string;
  operationFingerprint: string;
  lockFingerprint: string;
  scanFingerprint: string;
  afterWinnerDocumentId: string;
}>): ReviewMilestoneAccumulatorResetCursor {
  const core = {
    version: reviewMilestoneAccumulatorResetCursorVersion,
    phase: "accumulator-reset" as const,
    userFingerprint: requireSha256Fingerprint(
      value.userFingerprint,
      "userFingerprint",
    ),
    operationFingerprint: requireSha256Fingerprint(
      value.operationFingerprint,
      "operationFingerprint",
    ),
    lockFingerprint: requireSha256Fingerprint(
      value.lockFingerprint,
      "lockFingerprint",
    ),
    scanFingerprint: requireSha256Fingerprint(
      value.scanFingerprint,
      "scanFingerprint",
    ),
    afterWinnerDocumentId: readRequiredDocumentId(
      value.afterWinnerDocumentId,
      "afterWinnerDocumentId",
    ),
  };
  return Object.freeze({
    ...core,
    fingerprint: contractSha256([
      reviewMilestoneAccumulatorResetCursorVersion,
      ["phase", core.phase],
      ["userFingerprint", core.userFingerprint],
      ["operationFingerprint", core.operationFingerprint],
      ["lockFingerprint", core.lockFingerprint],
      ["scanFingerprint", core.scanFingerprint],
      ["afterWinnerDocumentId", core.afterWinnerDocumentId],
    ]),
  });
}

function buildReviewMilestoneReviewCursor(value: Readonly<{
  userFingerprint: string;
  operationFingerprint: string;
  lockFingerprint: string;
  scanFingerprint: string;
  sequence: number;
  afterReviewDocumentId: string;
}>): ReviewMilestoneReviewCursor {
  const sequence = requireNonnegativeSafeInteger(value.sequence, "sequence");
  if (sequence < 1) {
    throw new Error("Private review milestone cursor is invalid.");
  }
  const core = {
    version: reviewMilestoneSourceCursorVersion,
    phase: "review-scan" as const,
    userFingerprint: requireSha256Fingerprint(
      value.userFingerprint,
      "userFingerprint",
    ),
    operationFingerprint: requireSha256Fingerprint(
      value.operationFingerprint,
      "operationFingerprint",
    ),
    lockFingerprint: requireSha256Fingerprint(
      value.lockFingerprint,
      "lockFingerprint",
    ),
    scanFingerprint: requireSha256Fingerprint(
      value.scanFingerprint,
      "scanFingerprint",
    ),
    sequence,
    afterReviewDocumentId: readRequiredDocumentId(
      value.afterReviewDocumentId,
      "afterReviewDocumentId",
    ),
  };
  return Object.freeze({
    ...core,
    fingerprint: contractSha256([
      reviewMilestoneSourceCursorVersion,
      ["phase", core.phase],
      ["userFingerprint", core.userFingerprint],
      ["operationFingerprint", core.operationFingerprint],
      ["lockFingerprint", core.lockFingerprint],
      ["scanFingerprint", core.scanFingerprint],
      ["sequence", core.sequence],
      ["afterReviewDocumentId", core.afterReviewDocumentId],
    ]),
  });
}

type ReviewMilestoneCursorBindings = Readonly<{
  userFingerprint: string;
  operationFingerprint: string;
  lockFingerprint: string;
  countStateFingerprint: string;
}>;

function buildReviewMilestoneReconcileCursor(
  value:
    | Readonly<ReviewMilestoneCursorBindings & {
      phase: "awards";
      afterMilestone: number;
    }>
    | Readonly<ReviewMilestoneCursorBindings & {
      phase: "ledger";
      afterLedgerDocumentId: string | null;
    }>,
): ReviewMilestoneReconcileCursor {
  const bindings = {
    userFingerprint: requireSha256Fingerprint(
      value.userFingerprint,
      "userFingerprint",
    ),
    operationFingerprint: requireSha256Fingerprint(
      value.operationFingerprint,
      "operationFingerprint",
    ),
    lockFingerprint: requireSha256Fingerprint(
      value.lockFingerprint,
      "lockFingerprint",
    ),
    countStateFingerprint: requireSha256Fingerprint(
      value.countStateFingerprint,
      "countStateFingerprint",
    ),
  };
  if (value.phase === "awards") {
    const core = {
      version: reviewMilestoneReconcileCursorVersion,
      phase: "awards" as const,
      ...bindings,
      afterMilestone: requireReviewMilestoneAfterMilestone(
        value.afterMilestone,
      ),
    };
    return Object.freeze({
      ...core,
      fingerprint: contractSha256([
        reviewMilestoneReconcileCursorVersion,
        ["phase", core.phase],
        ...reviewMilestoneCursorBindingFingerprintFields(core),
        ["afterMilestone", core.afterMilestone],
      ]),
    });
  }
  const core = {
    version: reviewMilestoneReconcileCursorVersion,
    phase: "ledger" as const,
    ...bindings,
    afterLedgerDocumentId: readNullableExactDocumentId(
      value.afterLedgerDocumentId,
      "afterLedgerDocumentId",
    ),
  };
  return Object.freeze({
    ...core,
    fingerprint: contractSha256([
      reviewMilestoneReconcileCursorVersion,
      ["phase", core.phase],
      ...reviewMilestoneCursorBindingFingerprintFields(core),
      ["afterLedgerDocumentId", core.afterLedgerDocumentId],
    ]),
  });
}

function readReviewMilestoneAccumulatorResetCursor(
  value: unknown,
  expected: Readonly<{
    userFingerprint: string;
    operationFingerprint: string;
    lockFingerprint: string;
    scanFingerprint: string;
  }>,
): ReviewMilestoneAccumulatorResetCursor | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    const data = requireCursorRecord(value);
    requireCursorKeys(data, [
      "version", "phase", "userFingerprint", "operationFingerprint",
      "lockFingerprint", "scanFingerprint", "afterWinnerDocumentId",
      "fingerprint",
    ]);
    if (
      data.version !== reviewMilestoneAccumulatorResetCursorVersion ||
      data.phase !== "accumulator-reset"
    ) {
      return failCursor();
    }
    const cursor = buildReviewMilestoneAccumulatorResetCursor({
      userFingerprint: requireSha256Fingerprint(
        data.userFingerprint,
        "userFingerprint",
      ),
      operationFingerprint: requireSha256Fingerprint(
        data.operationFingerprint,
        "operationFingerprint",
      ),
      lockFingerprint: requireSha256Fingerprint(
        data.lockFingerprint,
        "lockFingerprint",
      ),
      scanFingerprint: requireSha256Fingerprint(
        data.scanFingerprint,
        "scanFingerprint",
      ),
      afterWinnerDocumentId: readRequiredDocumentId(
        data.afterWinnerDocumentId,
        "afterWinnerDocumentId",
      ),
    });
    if (
      data.fingerprint !== cursor.fingerprint ||
      cursor.userFingerprint !== expected.userFingerprint ||
      cursor.operationFingerprint !== expected.operationFingerprint ||
      cursor.lockFingerprint !== expected.lockFingerprint ||
      cursor.scanFingerprint !== expected.scanFingerprint
    ) {
      return failCursor();
    }
    return cursor;
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "Private review milestone reset cursor is invalid.",
    );
  }
}

function readReviewMilestoneReviewCursor(
  value: unknown,
  expected: Pick<
    ReviewMilestoneWinnerAccumulator,
    "userFingerprint" | "operationFingerprint" | "lockFingerprint" |
      "scanFingerprint"
  >,
): ReviewMilestoneReviewCursor | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    const data = requireCursorRecord(value);
    requireCursorKeys(data, [
      "version", "phase", "userFingerprint", "operationFingerprint",
      "lockFingerprint", "scanFingerprint", "sequence",
      "afterReviewDocumentId", "fingerprint",
    ]);
    if (
      data.version !== reviewMilestoneSourceCursorVersion ||
      data.phase !== "review-scan"
    ) {
      return failCursor();
    }
    const cursor = buildReviewMilestoneReviewCursor({
      userFingerprint: requireSha256Fingerprint(
        data.userFingerprint,
        "userFingerprint",
      ),
      operationFingerprint: requireSha256Fingerprint(
        data.operationFingerprint,
        "operationFingerprint",
      ),
      lockFingerprint: requireSha256Fingerprint(
        data.lockFingerprint,
        "lockFingerprint",
      ),
      scanFingerprint: requireSha256Fingerprint(
        data.scanFingerprint,
        "scanFingerprint",
      ),
      sequence: requireNonnegativeSafeInteger(data.sequence, "sequence"),
      afterReviewDocumentId: readRequiredDocumentId(
        data.afterReviewDocumentId,
        "afterReviewDocumentId",
      ),
    });
    if (
      data.fingerprint !== cursor.fingerprint ||
      cursor.userFingerprint !== expected.userFingerprint ||
      cursor.operationFingerprint !== expected.operationFingerprint ||
      cursor.lockFingerprint !== expected.lockFingerprint ||
      cursor.scanFingerprint !== expected.scanFingerprint
    ) {
      return failCursor();
    }
    return cursor;
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "Private review milestone scan cursor is invalid.",
    );
  }
}

function prepareReviewPageFromManifest(
  manifest: ReviewMilestoneAccumulatorManifest,
  cursor: ReviewMilestoneReviewCursor | null,
  bindings: Readonly<{
    userFingerprint: string;
    operationFingerprint: string;
    lockFingerprint: string;
    scanFingerprint: string;
  }>,
): ReviewMilestonePreparedReviewPage {
  if (manifest.state === "ready") {
    if (cursor !== null) {
      throw new Error("Private review milestone scan cursor is invalid.");
    }
    return {status: "advance", result: null};
  }
  if (manifest.state === "count-complete") {
    if (cursor === null || cursorFingerprint(cursor) ===
        previousReviewCursorFingerprint(manifest, bindings)) {
      return {
        status: "already-committed",
        result: reviewScanResultFromManifest(manifest),
      };
    }
    throw new Error("Private review milestone scan cursor is invalid.");
  }
  if (manifest.state !== "counting" ||
      manifest.reviewAfterDocumentId === null) {
    throw new Error("Private review milestone scan state is invalid.");
  }
  const current = buildReviewMilestoneReviewCursor({
    ...bindings,
    sequence: manifest.reviewPageSequence,
    afterReviewDocumentId: manifest.reviewAfterDocumentId,
  });
  if (cursorFingerprint(cursor) === current.fingerprint) {
    return {status: "advance", result: null};
  }
  if (cursorFingerprint(cursor) ===
      previousReviewCursorFingerprint(manifest, bindings)) {
    return {
      status: "already-committed",
      result: reviewScanResultFromManifest(manifest),
    };
  }
  throw new Error("Private review milestone scan cursor is invalid.");
}

function previousReviewCursorFingerprint(
  manifest: ReviewMilestoneAccumulatorManifest,
  bindings: Readonly<{
    userFingerprint: string;
    operationFingerprint: string;
    lockFingerprint: string;
    scanFingerprint: string;
  }>,
): string | null {
  if (manifest.previousReviewAfterDocumentId === null) {
    return null;
  }
  return buildReviewMilestoneReviewCursor({
    ...bindings,
    sequence: manifest.reviewPageSequence - 1,
    afterReviewDocumentId: manifest.previousReviewAfterDocumentId,
  }).fingerprint;
}

function reviewScanResultFromManifest(
  manifest: ReviewMilestoneAccumulatorManifest,
): ReviewMilestoneIdentityScanStepResult {
  const complete = manifest.state === "count-complete";
  const nextCursor = manifest.state === "counting" &&
      manifest.reviewAfterDocumentId !== null
    ? buildReviewMilestoneReviewCursor({
      userFingerprint: manifest.userFingerprint,
      operationFingerprint: manifest.operationFingerprint,
      lockFingerprint: manifest.lockFingerprint,
      scanFingerprint: manifest.scanFingerprint,
      sequence: manifest.reviewPageSequence,
      afterReviewDocumentId: manifest.reviewAfterDocumentId,
    })
    : null;
  return Object.freeze({
    processedCount: manifest.lastReviewProcessedCount,
    nextCursor,
    complete,
    validReviewCount: complete ? manifest.validReviewCount : null,
  });
}

function reviewMilestoneCountStateFingerprint(value: Readonly<{
  userFingerprint: string;
  operationFingerprint: string;
  lockFingerprint: string;
  scanFingerprint: string;
  validReviewCount: number;
}>): string {
  return contractSha256([
    "bitestar.review-milestone-count-complete.v1",
    ["userFingerprint", value.userFingerprint],
    ["operationFingerprint", value.operationFingerprint],
    ["lockFingerprint", value.lockFingerprint],
    ["scanFingerprint", value.scanFingerprint],
    ["validReviewCount", value.validReviewCount],
  ]);
}

function prepareReconciliationPageFromManifest(
  manifest: ReviewMilestoneAccumulatorManifest,
  cursor: ReviewMilestoneReconcileCursor | null,
  currentReviewCount: number,
  bindings: Omit<ReviewMilestoneCursorBindings, "countStateFingerprint">,
): ReviewMilestonePreparedReconciliationPage {
  if (
    manifest.state !== "count-complete" ||
    manifest.countStateFingerprint === null ||
    manifest.validReviewCount !== currentReviewCount ||
    (manifest.reconciliationCount !== null &&
      manifest.reconciliationCount !== currentReviewCount)
  ) {
    throw new Error("Private milestone reconciliation binding is invalid.");
  }
  const countStateFingerprint = manifest.countStateFingerprint;
  if (manifest.reconciliationPhase === "not-started") {
    if (cursor !== null) {
      throw new Error("Private milestone reconciliation cursor is invalid.");
    }
    return {status: "advance", result: null, countStateFingerprint};
  }
  if (manifest.reconciliationPhase === "complete") {
    if (
      cursor === null ||
      cursor.fingerprint === manifest.previousReconciliationCursorFingerprint
    ) {
      return {
        status: "already-committed",
        result: reconciliationResultFromManifest(manifest),
        countStateFingerprint,
      };
    }
    throw new Error("Private milestone reconciliation cursor is invalid.");
  }
  const current = reconciliationCursorFromManifest(manifest, {
    ...bindings,
    countStateFingerprint,
  });
  if (cursor?.fingerprint === current.fingerprint) {
    return {status: "advance", result: null, countStateFingerprint};
  }
  if (cursorFingerprint(cursor) ===
      manifest.previousReconciliationCursorFingerprint) {
    return {
      status: "already-committed",
      result: reconciliationResultFromManifest(manifest),
      countStateFingerprint,
    };
  }
  throw new Error("Private milestone reconciliation cursor is invalid.");
}

function reconciliationCursorFromManifest(
  manifest: ReviewMilestoneAccumulatorManifest,
  bindings: ReviewMilestoneCursorBindings,
): ReviewMilestoneReconcileCursor {
  if (manifest.reconciliationPhase === "awards") {
    return buildReviewMilestoneReconcileCursor({
      ...bindings,
      phase: "awards",
      afterMilestone: manifest.reconciliationAfterMilestone,
    });
  }
  if (manifest.reconciliationPhase === "ledger") {
    return buildReviewMilestoneReconcileCursor({
      ...bindings,
      phase: "ledger",
      afterLedgerDocumentId: manifest.reconciliationAfterLedgerDocumentId,
    });
  }
  return failCursor();
}

function reconciliationResultFromManifest(
  manifest: ReviewMilestoneAccumulatorManifest,
): ReviewMilestoneReconcileStepResult {
  if (manifest.countStateFingerprint === null ||
      manifest.reconciliationPhase === "not-started") {
    throw new Error("Private milestone reconciliation state is invalid.");
  }
  const complete = manifest.reconciliationPhase === "complete";
  return Object.freeze({
    processedCount: manifest.lastReconciliationProcessedCount,
    nextCursor: complete
      ? null
      : reconciliationCursorFromManifest(manifest, {
        userFingerprint: manifest.userFingerprint,
        operationFingerprint: manifest.operationFingerprint,
        lockFingerprint: manifest.lockFingerprint,
        countStateFingerprint: manifest.countStateFingerprint,
      }),
    complete,
  });
}

function reviewMilestoneReconciliationStateFingerprint(
  manifest: ReviewMilestoneAccumulatorManifest,
): string {
  if (
    manifest.state !== "count-complete" ||
    manifest.reconciliationPhase !== "complete" ||
    manifest.countStateFingerprint === null ||
    manifest.reconciliationCount !== manifest.validReviewCount ||
    manifest.reconciliationAfterLedgerDocumentId !== null
  ) {
    throw new Error("Private milestone reconciliation state is invalid.");
  }
  return contractSha256([
    "bitestar.review-milestone-reconciliation-complete.v1",
    ["userFingerprint", manifest.userFingerprint],
    ["operationFingerprint", manifest.operationFingerprint],
    ["lockFingerprint", manifest.lockFingerprint],
    ["countStateFingerprint", manifest.countStateFingerprint],
    ["validReviewCount", manifest.validReviewCount],
    ["afterMilestone", manifest.reconciliationAfterMilestone],
  ]);
}

function readContributionPointStepLimit(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumContributionPointStepLimit
  ) {
    throw new HttpsError(
      "invalid-argument",
      `limit must be an integer from 1 to ${maximumContributionPointStepLimit}.`,
    );
  }
  return value;
}

function readReviewMilestoneScanStepLimit(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumReviewMilestoneScanStepLimit
  ) {
    throw new HttpsError(
      "invalid-argument",
      `limit must be an integer from 1 to ${maximumReviewMilestoneScanStepLimit}.`,
    );
  }
  return value;
}

function requireNonnegativeSafeInteger(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a nonnegative safe integer.`,
    );
  }
  return value;
}

function readReviewMilestoneReconcileCursor(
  value: unknown,
  expected: ReviewMilestoneCursorBindings,
): ReviewMilestoneReconcileCursor | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    const data = requireCursorRecord(value);
    const cursor = data.phase === "awards"
      ? (() => {
        requireCursorKeys(data, [
          "version", "phase", "userFingerprint", "operationFingerprint",
          "lockFingerprint", "countStateFingerprint", "afterMilestone",
          "fingerprint",
        ]);
        return buildReviewMilestoneReconcileCursor({
          userFingerprint: requireSha256Fingerprint(
            data.userFingerprint,
            "userFingerprint",
          ),
          operationFingerprint: requireSha256Fingerprint(
            data.operationFingerprint,
            "operationFingerprint",
          ),
          lockFingerprint: requireSha256Fingerprint(
            data.lockFingerprint,
            "lockFingerprint",
          ),
          countStateFingerprint: requireSha256Fingerprint(
            data.countStateFingerprint,
            "countStateFingerprint",
          ),
          phase: "awards",
          afterMilestone: requireReviewMilestoneAfterMilestone(
            data.afterMilestone,
          ),
        });
      })()
      : data.phase === "ledger"
        ? (() => {
          requireCursorKeys(data, [
            "version", "phase", "userFingerprint", "operationFingerprint",
            "lockFingerprint", "countStateFingerprint",
            "afterLedgerDocumentId", "fingerprint",
          ]);
          return buildReviewMilestoneReconcileCursor({
            userFingerprint: requireSha256Fingerprint(
              data.userFingerprint,
              "userFingerprint",
            ),
            operationFingerprint: requireSha256Fingerprint(
              data.operationFingerprint,
              "operationFingerprint",
            ),
            lockFingerprint: requireSha256Fingerprint(
              data.lockFingerprint,
              "lockFingerprint",
            ),
            countStateFingerprint: requireSha256Fingerprint(
              data.countStateFingerprint,
              "countStateFingerprint",
            ),
            phase: "ledger",
            afterLedgerDocumentId: readNullableExactDocumentId(
              data.afterLedgerDocumentId,
              "afterLedgerDocumentId",
            ),
          });
        })()
        : failCursor();
    if (
      data.version !== reviewMilestoneReconcileCursorVersion ||
      data.fingerprint !== cursor.fingerprint ||
      !reviewMilestoneCursorBindingsMatch(cursor, expected)
    ) {
      return failCursor();
    }
    return cursor;
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "Review milestone reconciliation cursor is invalid.",
    );
  }
}

function requireReviewMilestoneAfterMilestone(value: unknown): number {
  const afterMilestone = requireNonnegativeSafeInteger(
    value,
    "cursor afterMilestone",
  );
  if (afterMilestone % 5 !== 0) {
    throw new HttpsError(
      "invalid-argument",
      "Review milestone reconciliation cursor is invalid.",
    );
  }
  return afterMilestone;
}

function readContributionPointDishReverseCursor(
  value: unknown,
  expected: Readonly<{
    operationFingerprint: string;
    dishFingerprint: string;
  }>,
): ContributionPointDishReverseCursor | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    const data = requireCursorRecord(value);
    requireCursorKeys(data, [
      "version", "phase", "operationFingerprint", "dishFingerprint",
      "afterLedgerDocumentId", "fingerprint",
    ]);
    if (
      data.version !== contributionPointDishReverseCursorVersion ||
      data.phase !== "dish-ledger"
    ) {
      return failCursor();
    }
    const cursor = buildContributionPointDishReverseCursor({
      operationFingerprint: requireSha256Fingerprint(
        data.operationFingerprint,
        "operationFingerprint",
      ),
      dishFingerprint: requireSha256Fingerprint(
        data.dishFingerprint,
        "dishFingerprint",
      ),
      afterLedgerDocumentId: readRequiredDocumentId(
        data.afterLedgerDocumentId,
        "afterLedgerDocumentId",
      ),
    });
    if (
      data.fingerprint !== cursor.fingerprint ||
      cursor.operationFingerprint !== expected.operationFingerprint ||
      cursor.dishFingerprint !== expected.dishFingerprint
    ) {
      return failCursor();
    }
    return cursor;
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "Contribution point reversal cursor is invalid.",
    );
  }
}

function contributionPointStepOptions(
  now: unknown,
  options: HelperOptions,
): HelperOptions {
  if (now === undefined) {
    return options;
  }
  const fieldValues = options.fieldValues ?? adminServerFieldValues;
  return {
    fieldValues: {
      serverTimestamp: () => now,
      increment: (delta: number) => fieldValues.increment(delta),
    },
    transactionGuard: options.transactionGuard,
  };
}

function isEarnedReviewMilestone(
  milestone: number,
  validReviewCount: number,
): boolean {
  return milestone >= 5 && milestone % 5 === 0 && milestone <= validReviewCount;
}

function appendModerationReverseResult(
  result:
    | ContributionPointDishReverseResult
    | ContributionPointMilestoneReconcileResult,
  reverseResult: ContributionPointReverseResult,
): void {
  switch (reverseResult.status) {
    case "reversed":
      result.reversedEntryIds.push(reverseResult.ledgerEntryId);
      break;
    case "already-reversed":
      result.alreadyReversedEntryIds.push(reverseResult.ledgerEntryId);
      break;
    case "missing":
      result.missingEntryIds.push(reverseResult.ledgerEntryId);
      break;
    case "invalid":
    case "not-active":
      result.ignoredEntryIds.push(reverseResult.ledgerEntryId);
      break;
  }
}

async function reverseEntryForModerationResult(
  db: FirestoreLike,
  params: {
    ledgerEntryId: string;
    reason: string;
    result:
      | ContributionPointDishReverseResult
      | ContributionPointMilestoneReconcileResult;
    options: HelperOptions;
  },
): Promise<ContributionPointReverseResult> {
  try {
    const reverseResult = await reverseContributionPointLedgerEntryTransaction(
      db,
      {
        ledgerEntryId: params.ledgerEntryId,
        reason: params.reason,
      },
      params.options,
    );
    appendModerationReverseResult(params.result, reverseResult);
    return reverseResult;
  } catch (error) {
    params.result.errors.push({
      ledgerEntryId: params.ledgerEntryId,
      message: moderationErrorMessage(error),
    });
    return {
      ledgerEntryId: params.ledgerEntryId,
      pointsDelta: 0,
      status: "invalid",
    };
  }
}

function moderationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return "Unknown contribution point reversal error.";
}

function dishCreationProvenanceMatches(
  dishData: Record<string, unknown>,
  params: { uid: string; restaurantId: string; reviewId: string },
): boolean {
  const createdByUserId = readOptionalString(dishData.createdByUserId);
  const createdFromReviewId = readOptionalString(dishData.createdFromReviewId);
  const createdWithRestaurantId = readOptionalString(
    dishData.createdWithRestaurantId,
  );

  if (
    createdByUserId === null &&
    createdFromReviewId === null &&
    createdWithRestaurantId === null &&
    dishData.createdFromCreateFlow !== true
  ) {
    return false;
  }
  if (createdByUserId !== params.uid) {
    throw new HttpsError(
      "permission-denied",
      "Dish creator provenance belongs to another user.",
    );
  }
  return (
    createdFromReviewId === params.reviewId &&
    createdWithRestaurantId === params.restaurantId &&
    dishData.createdFromCreateFlow === true
  );
}

function restaurantCreationProvenanceState(
  restaurantData: Record<string, unknown>,
  params: { uid: string; dishId: string; reviewId: string },
): "matching" | "absent-or-mismatch" {
  const createdByUserId = readOptionalString(restaurantData.createdByUserId);
  const createdFromDishId = readOptionalString(restaurantData.createdFromDishId);
  const createdFromReviewId = readOptionalString(
    restaurantData.createdFromReviewId,
  );
  const hasProvenance =
    createdByUserId !== null ||
    createdFromDishId !== null ||
    createdFromReviewId !== null ||
    restaurantData.createdFromCreateFlow === true;

  if (
    restaurantData.createdFromCreateFlow === true &&
    createdFromDishId === params.dishId &&
    createdFromReviewId === params.reviewId
  ) {
    if (createdByUserId !== params.uid) {
      throw new HttpsError(
        "permission-denied",
        "Restaurant creator provenance belongs to another user.",
      );
    }
    return "matching";
  }
  if (!hasProvenance) {
    return "absent-or-mismatch";
  }
  return "absent-or-mismatch";
}

async function isFirstActiveDishForRestaurant(
  db: FirestoreLike,
  params: {
    restaurantId: string;
    dishId: string;
    dishSnapshot: DocumentSnapshotLike;
    dishData: Record<string, unknown>;
  },
): Promise<boolean> {
  const targetCreatedAt = snapshotCreateMillis(
    params.dishSnapshot,
    params.dishData,
  );
  if (targetCreatedAt === null) {
    return false;
  }

  const snapshot = await db
    .collection("bitescore_dishes")
    .where("restaurantId", "==", params.restaurantId)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    if (!isActiveDishData(data)) {
      continue;
    }
    const docId = readOptionalString(data.id) ?? doc.id;
    if (doc.id === params.dishId || docId === params.dishId) {
      continue;
    }
    const otherCreatedAt = snapshotCreateMillis(doc, data);
    if (otherCreatedAt === null || otherCreatedAt <= targetCreatedAt) {
      return false;
    }
  }

  return true;
}

function isActiveDishData(data: Record<string, unknown>): boolean {
  return (
    data.isActive !== false &&
    readOptionalString(data.mergedIntoDishId) === null
  );
}

function snapshotCreateMillis(
  snapshot: DocumentSnapshotLike,
  data: Record<string, unknown>,
): number | null {
  return coerceTimestampMillis(snapshot.createTime) ??
    coerceTimestampMillis(data.createdAt);
}

function coerceTimestampMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value !== null && typeof value === "object") {
    const timestamp = value as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof timestamp.toMillis === "function") {
      const millis = timestamp.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
    if (
      typeof timestamp.seconds === "number" &&
      Number.isFinite(timestamp.seconds)
    ) {
      const nanoseconds =
        typeof timestamp.nanoseconds === "number" &&
        Number.isFinite(timestamp.nanoseconds)
          ? timestamp.nanoseconds
          : 0;
      return timestamp.seconds * 1000 + Math.floor(nanoseconds / 1000000);
    }
  }
  return null;
}

function createdDishAwardDraft(params: {
  uid: string;
  points: number;
  actionType: string;
  sourceKey: string;
  description: string;
  dishId: string;
  reviewId: string;
  dishData: Record<string, unknown>;
  restaurantId: string;
  restaurantData: Record<string, unknown>;
}): ContributionPointAwardDraft {
  const restaurantName =
    readOptionalString(params.restaurantData.name) ??
    readOptionalString(params.restaurantData.restaurantName);

  return {
    userId: params.uid,
    points: params.points,
    actionType: params.actionType,
    sourceKey: params.sourceKey,
    description: params.description,
    dishId: params.dishId,
    dishName: readOptionalString(params.dishData.name),
    restaurantId: params.restaurantId,
    restaurantName,
    restaurantCity: readOptionalString(params.restaurantData.city),
    restaurantState: readOptionalString(params.restaurantData.state),
    restaurantAddress:
      readOptionalString(params.restaurantData.address) ??
      readOptionalString(params.restaurantData.streetAddress),
    restaurantPhone: readOptionalString(params.restaurantData.phone),
    reviewId: params.reviewId,
  };
}

type ParsedDishEditProposal = {
  id: string;
  type: string;
  restaurantId: string;
  targetDishId: string;
  mergeTargetDishId: string | null;
  proposedName: string | null;
  userId: string;
  status: string;
};

function parseDishEditProposal(
  snapshot: DocumentSnapshotLike,
): ParsedDishEditProposal | null {
  const data = snapshot.data();
  if (!data) {
    return null;
  }

  const type = readOptionalString(data.type) ??
    readOptionalString(data.targetType);
  const restaurantId = readOptionalString(data.restaurantId);
  const sourceDishId = readOptionalString(data.sourceDishId);
  const storedTargetDishId = readOptionalString(data.targetDishId) ??
    readOptionalString(data.targetId);
  const targetDishId = sourceDishId ?? storedTargetDishId;
  const mergeTargetDishId = readOptionalString(data.mergeTargetDishId) ??
    (type === "merge" && sourceDishId !== null ? storedTargetDishId : null);
  const userId = readOptionalString(data.userId) ??
    readOptionalString(data.createdByUserId);

  if (
    type === null ||
    restaurantId === null ||
    targetDishId === null ||
    userId === null
  ) {
    return null;
  }

  return {
    id: snapshot.id,
    type,
    restaurantId,
    targetDishId,
    mergeTargetDishId,
    proposedName: readOptionalString(data.proposedName),
    userId,
    status: readOptionalString(data.status) ?? "pending",
  };
}

function isAwardableDishEditProposalStatus(status: string): boolean {
  const normalizedStatus = status.trim().toLowerCase();
  return normalizedStatus === "pending" || normalizedStatus === "approved";
}

type ParsedDishProposalResolutionPointAwardRequest = Readonly<{
  proposalDocumentId: string;
  activeJobId: string;
  groupId: string;
  supporterUid: string;
  trustedServerCreateTimeMillis: number;
  membershipGeneration: number;
  cycleCutoffGeneration: number;
  oldValue: string | null;
  newValue: string | null;
}>;

function parseDishProposalResolutionPointAwardRequest(
  value: DishProposalResolutionPointAwardRequest,
): ParsedDishProposalResolutionPointAwardRequest {
  const membershipGeneration = readRequiredNonnegativeSafeInteger(
    value.membershipGeneration,
    "membershipGeneration",
  );
  const cycleCutoffGeneration = readRequiredNonnegativeSafeInteger(
    value.cycleCutoffGeneration,
    "cycleCutoffGeneration",
  );
  const trustedServerCreateTimeMillis = readRequiredSafeInteger(
    value.trustedServerCreateTimeMillis,
    "trustedServerCreateTimeMillis",
  );
  if (!Number.isFinite(new Date(trustedServerCreateTimeMillis).getTime())) {
    throw new HttpsError(
      "invalid-argument",
      "trustedServerCreateTimeMillis must identify a valid date.",
    );
  }
  if (membershipGeneration > cycleCutoffGeneration) {
    throw new HttpsError(
      "invalid-argument",
      "membershipGeneration must belong to the requested cycle.",
    );
  }
  return {
    proposalDocumentId: readRequiredDocumentId(
      value.proposalDocumentId,
      "proposalDocumentId",
    ),
    activeJobId: readRequiredString(value.activeJobId, "activeJobId"),
    groupId: readRequiredString(value.groupId, "groupId"),
    supporterUid: readRequiredString(value.supporterUid, "supporterUid"),
    trustedServerCreateTimeMillis,
    membershipGeneration,
    cycleCutoffGeneration,
    oldValue: readOptionalString(value.oldValue),
    newValue: readOptionalString(value.newValue),
  };
}

type ResolutionCyclePointEligibility = Readonly<{
  proposal: ParsedDishEditProposal;
  currentMembership: DishProposalMembership;
}>;

function validateResolutionCyclePointEligibility(params: {
  proposalSnapshot: DocumentSnapshotLike;
  memberSnapshot: DocumentSnapshotLike;
  groupSnapshot: DocumentSnapshotLike;
  supporterSnapshot: DocumentSnapshotLike;
  expected: ParsedDishProposalResolutionPointAwardRequest;
}): ResolutionCyclePointEligibility | null {
  const {expected, proposalSnapshot} = params;
  if (
    !proposalSnapshot.exists ||
    proposalSnapshot.id !== expected.proposalDocumentId ||
    proposalSnapshot.createTime?.toMillis() !==
      expected.trustedServerCreateTimeMillis
  ) {
    return null;
  }
  const proposal = parseDishEditProposal(proposalSnapshot);
  const currentMembership = buildDishProposalMembership({
    proposalDocumentId: expected.proposalDocumentId,
    source: proposalSnapshot.data() ?? null,
    trustedServerCreateTime: new Date(
      expected.trustedServerCreateTimeMillis,
    ),
  });
  if (
    proposal === null ||
    currentMembership === null ||
    currentMembership.proposalDocumentId !== expected.proposalDocumentId ||
    currentMembership.groupId !== expected.groupId ||
    currentMembership.supporterUid !== expected.supporterUid ||
    currentMembership.trustedServerCreateTime.getTime() !==
      expected.trustedServerCreateTimeMillis ||
    !isAwardableDishEditProposalStatus(proposal.status)
  ) {
    return null;
  }
  const membershipEnteredAt = validateExpectedPrivateDishProposalMember(
    params.memberSnapshot,
    currentMembership,
    expected,
  );
  if (
    membershipEnteredAt === null ||
    !validateExpectedPrivateDishProposalGroup(
      params.groupSnapshot,
      currentMembership,
      expected,
      membershipEnteredAt,
    ) ||
    !validateExpectedPrivateDishProposalSupporter(
      params.supporterSnapshot,
      expected,
    )
  ) {
    return null;
  }
  return {proposal, currentMembership};
}

function validateExpectedPrivateDishProposalMember(
  snapshot: DocumentSnapshotLike,
  currentMembership: DishProposalMembership,
  expected: ParsedDishProposalResolutionPointAwardRequest,
): Date | null {
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    data === undefined ||
    !hasExactKeys(data, dishProposalMemberKeys) ||
    snapshot.id !== createDishProposalMemberId(expected.proposalDocumentId)
  ) {
    return null;
  }
  const trustedServerCreateTime = readDishProposalDate(
    data.trustedServerCreateTime,
  );
  const membershipEnteredAt = readDishProposalDate(data.membershipEnteredAt);
  const indexedAt = readDishProposalDate(data.indexedAt);
  if (
    trustedServerCreateTime === null ||
    membershipEnteredAt === null ||
    indexedAt === null ||
    data.version !== dishProposalMemberVersion ||
    data.proposalDocumentId !== expected.proposalDocumentId ||
    data.groupId !== expected.groupId ||
    data.proposalType !== currentMembership.proposalType ||
    data.restaurantId !== currentMembership.restaurantId ||
    data.sourceDishId !== currentMembership.sourceDishId ||
    data.mergeTargetDishId !== currentMembership.mergeTargetDishId ||
    data.normalizedProposedName !== currentMembership.normalizedProposedName ||
    data.supporterUid !== expected.supporterUid ||
    trustedServerCreateTime.getTime() !==
      expected.trustedServerCreateTimeMillis ||
    data.membershipGeneration !== expected.membershipGeneration ||
    data.currentPending !== true
  ) {
    return null;
  }
  const rebuilt = buildDishProposalMemberDocument({
    membership: currentMembership,
    membershipEnteredAt,
    membershipGeneration: expected.membershipGeneration,
    indexedAt,
  });
  return data.fingerprint === rebuilt.fingerprint ? membershipEnteredAt : null;
}

function validateExpectedPrivateDishProposalGroup(
  snapshot: DocumentSnapshotLike,
  currentMembership: DishProposalMembership,
  expected: ParsedDishProposalResolutionPointAwardRequest,
  membershipEnteredAt: Date,
): boolean {
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    data === undefined ||
    !hasExactKeys(data, dishProposalGroupKeys) ||
    snapshot.id !== expected.groupId
  ) {
    return false;
  }
  const oldestTrustedServerCreateTime = readNullableDishProposalDate(
    data.oldestTrustedServerCreateTime,
  );
  const dueAt = readNullableDishProposalDate(data.dueAt);
  const cycleCutoffAt = readDishProposalDate(data.cycleCutoffAt);
  const indexedAt = readDishProposalDate(data.indexedAt);
  const lastMembershipGeneration = readNonnegativeSafeInteger(
    data.lastMembershipGeneration,
  );
  const resolutionSequence = readNonnegativeSafeInteger(data.resolutionSequence);
  if (
    oldestTrustedServerCreateTime === undefined ||
    oldestTrustedServerCreateTime === null ||
    dueAt === undefined ||
    dueAt === null ||
    cycleCutoffAt === null ||
    indexedAt === null ||
    lastMembershipGeneration === null ||
    resolutionSequence === null ||
    data.version !== dishProposalGroupVersion ||
    data.groupId !== expected.groupId ||
    data.proposalType !== currentMembership.proposalType ||
    data.restaurantId !== currentMembership.restaurantId ||
    data.sourceDishId !== currentMembership.sourceDishId ||
    data.mergeTargetDishId !== currentMembership.mergeTargetDishId ||
    data.normalizedProposedName !== currentMembership.normalizedProposedName ||
    data.hasPendingMembers !== true ||
    typeof data.enoughSupporters !== "boolean" ||
    data.autoEligible !== false ||
    lastMembershipGeneration < expected.membershipGeneration ||
    data.activeJobId !== expected.activeJobId ||
    data.activeResolutionType !== "apply" ||
    data.cycleCutoffGeneration !== expected.cycleCutoffGeneration ||
    membershipEnteredAt.getTime() > cycleCutoffAt.getTime() ||
    createDishProposalGroupId(currentMembership) !== expected.groupId
  ) {
    return false;
  }
  const fingerprint = dishProposalDocumentFingerprint(
    dishProposalGroupVersion,
    [
      expected.groupId,
      currentMembership.proposalType,
      currentMembership.restaurantId,
      currentMembership.sourceDishId,
      currentMembership.mergeTargetDishId,
      currentMembership.normalizedProposedName,
      true,
      oldestTrustedServerCreateTime?.toISOString() ?? null,
      dueAt?.toISOString() ?? null,
      data.enoughSupporters,
      false,
      lastMembershipGeneration,
      resolutionSequence,
      expected.activeJobId,
      "apply",
      expected.cycleCutoffGeneration,
      cycleCutoffAt.toISOString(),
    ],
  );
  return data.fingerprint === fingerprint;
}

function validateExpectedPrivateDishProposalSupporter(
  snapshot: DocumentSnapshotLike,
  expected: ParsedDishProposalResolutionPointAwardRequest,
): boolean {
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    data === undefined ||
    !hasExactKeys(data, dishProposalSupporterKeys) ||
    snapshot.id !== createDishProposalSupporterId(
      expected.groupId,
      expected.supporterUid,
    ) ||
    data.version !== dishProposalSupporterVersion ||
    data.groupId !== expected.groupId ||
    data.supporterUid !== expected.supporterUid ||
    data.present !== true
  ) {
    return false;
  }
  const indexedAt = readDishProposalDate(data.indexedAt);
  if (indexedAt === null) {
    return false;
  }
  return data.fingerprint === buildDishProposalSupporterDocument({
    groupId: expected.groupId,
    supporterUid: expected.supporterUid,
    indexedAt,
  }).fingerprint;
}

function approvedDishProposalResolutionAwardDraft(params: {
  proposal: ParsedDishEditProposal;
  currentMembership: DishProposalMembership;
  targetDishData: Record<string, unknown>;
  mergeTargetDishData: Record<string, unknown>;
  restaurantData: Record<string, unknown>;
  oldValue: string | null;
  newValue: string | null;
}): ContributionPointAwardDraft | "noAwardForNoOp" | null {
  let trustedProposal = params.proposal;
  if (params.currentMembership.proposalType === "rename") {
    const normalizedProposedName =
      params.currentMembership.normalizedProposedName;
    if (normalizedProposedName === null || params.newValue === null) {
      return null;
    }
    const appliedName = normalizeDishNameForSave(normalizedProposedName);
    const currentDishName = readOptionalString(params.targetDishData.name);
    const currentNormalizedName = readOptionalString(
      params.targetDishData.normalizedName,
    );
    if (
      appliedName.length === 0 ||
      params.newValue !== appliedName ||
      currentDishName !== appliedName ||
      currentNormalizedName !== normalizedProposedName
    ) {
      return null;
    }
    if (params.oldValue === null) {
      return null;
    }
    if (params.oldValue === params.newValue) {
      return "noAwardForNoOp";
    }
    trustedProposal = {
      ...params.proposal,
      proposedName: appliedName,
      userId: params.currentMembership.supporterUid,
    };
  } else if (
    params.currentMembership.proposalType !== "merge" ||
    params.proposal.mergeTargetDishId !==
      params.currentMembership.mergeTargetDishId
  ) {
    return null;
  }
  const draft = approvedDishProposalAwardDraft({
    proposal: trustedProposal,
    targetDishData: params.targetDishData,
    mergeTargetDishData: params.mergeTargetDishData,
    restaurantData: params.restaurantData,
    oldValueFromClient: params.oldValue,
    newValueFromClient: null,
  });
  if (draft === null) {
    return null;
  }
  const sourceKey = approvedProposalExactSourceKey({
    actionType: draft.actionType,
    proposalDocumentId: params.proposal.id,
  });
  return {
    ...draft,
    userId: params.currentMembership.supporterUid,
    sourceKey,
    requestId: params.proposal.id,
  };
}

function noDishProposalResolutionPointAward(
  outcome: Extract<
    DishProposalResolutionPointAwardOutcome,
    "notEligible" | "noAwardForNoOp"
  >,
): DishProposalResolutionPointAwardResult {
  return {outcome, result: {entries: []}};
}

function approvedProposalExactSourceKey(params: {
  actionType: string;
  proposalDocumentId: string;
}): string {
  return `${params.actionType}:${params.proposalDocumentId}`;
}

function approvedDishProposalAwardDraft(params: {
  proposal: ParsedDishEditProposal;
  targetDishData: Record<string, unknown>;
  mergeTargetDishData: Record<string, unknown>;
  restaurantData: Record<string, unknown>;
  oldValueFromClient: string | null;
  newValueFromClient: string | null;
}): ContributionPointAwardDraft | null {
  const { proposal, targetDishData, mergeTargetDishData, restaurantData } =
    params;
  const actionType = approvedDishProposalActionType(proposal);
  const targetDishName = readOptionalString(targetDishData.name) ??
    proposal.proposedName;
  const mergeTargetDishName = readOptionalString(mergeTargetDishData.name);
  const oldValue = proposal.type === "rename"
    ? params.oldValueFromClient
    : targetDishName;
  const newValue = proposal.type === "rename"
    ? proposal.proposedName ?? params.newValueFromClient ?? targetDishName
    : mergeTargetDishName;

  if (
    proposal.type === "rename" &&
    proposal.proposedName !== null &&
    params.newValueFromClient !== null &&
    proposal.proposedName !== params.newValueFromClient
  ) {
    throw new HttpsError(
      "invalid-argument",
      "New value does not match the proposal.",
    );
  }

  if (
    proposal.type === "rename" &&
    !isMeaningfulApprovedDishRename({
      currentName: oldValue,
      proposedName: newValue,
    })
  ) {
    return null;
  }
  if (proposal.type === "merge" && proposal.mergeTargetDishId === null) {
    return null;
  }
  if (
    proposal.type === "merge" &&
    (targetDishName === null || mergeTargetDishName === null)
  ) {
    return null;
  }

  const restaurantName =
    readOptionalString(restaurantData.name) ??
    readOptionalString(restaurantData.restaurantName);

  return {
    userId: proposal.userId,
    points: 1,
    actionType,
    sourceKey: approvedProposalSourceKey({
      actionType,
      requestId: proposal.id,
    }),
    description: approvedDishProposalDescription({
      actionType,
      dishName: targetDishName,
      oldValue,
      newValue,
      mergeSourceDishName: proposal.type === "merge" ? targetDishName : null,
      mergeTargetDishName: proposal.type === "merge" ? mergeTargetDishName : null,
    }),
    dishId: proposal.targetDishId,
    dishName: targetDishName,
    restaurantId: proposal.restaurantId,
    restaurantName,
    restaurantCity: readOptionalString(restaurantData.city),
    restaurantState: readOptionalString(restaurantData.state),
    restaurantAddress:
      readOptionalString(restaurantData.address) ??
      readOptionalString(restaurantData.streetAddress),
    restaurantPhone: readOptionalString(restaurantData.phone),
    requestId: proposal.id,
    oldValue,
    newValue,
    mergeSourceDishId: proposal.type === "merge" ? proposal.targetDishId : null,
    mergeSourceDishName: proposal.type === "merge" ? targetDishName : null,
    mergeTargetDishId: proposal.type === "merge"
      ? proposal.mergeTargetDishId
      : null,
    mergeTargetDishName: proposal.type === "merge" ? mergeTargetDishName : null,
  };
}

function approvedDishProposalActionType(
  proposal: ParsedDishEditProposal,
): string {
  if (proposal.type === "merge") {
    return contributionPointAction.dishMergeApproved;
  }
  if (proposal.type === "rename") {
    return contributionPointAction.dishRenameApproved;
  }
  return contributionPointAction.dishEditApproved;
}

function approvedProposalSourceKey(params: {
  actionType: string;
  requestId: string;
}): string {
  return `${params.actionType.trim()}:${params.requestId}`;
}

function approvedDishProposalDescription(params: {
  actionType: string;
  dishName: string | null;
  oldValue: string | null;
  newValue: string | null;
  mergeSourceDishName: string | null;
  mergeTargetDishName: string | null;
}): string {
  const dishName = nullableTrim(params.dishName);
  const oldValue = nullableTrim(params.oldValue);
  const newValue = nullableTrim(params.newValue);
  const mergeSourceDishName = nullableTrim(params.mergeSourceDishName);
  const mergeTargetDishName = nullableTrim(params.mergeTargetDishName);

  if (params.actionType === contributionPointAction.dishMergeApproved) {
    if (mergeSourceDishName !== null && mergeTargetDishName !== null) {
      return `Approved merge of ${mergeSourceDishName} into ${mergeTargetDishName}`;
    }
    return "Approved dish merge contribution";
  }

  if (params.actionType === contributionPointAction.dishRenameApproved) {
    if (oldValue !== null && newValue !== null) {
      return `Approved dish rename: ${oldValue} -> ${newValue}`;
    }
    return "Approved dish rename contribution";
  }

  if (dishName !== null) {
    return `Approved dish information edit for ${dishName}`;
  }
  return "Approved dish edit contribution";
}

function isMeaningfulApprovedDishRename(params: {
  currentName: string | null;
  proposedName: string | null;
}): boolean {
  const currentName = nullableTrim(params.currentName);
  const proposedName = nullableTrim(params.proposedName);
  if (currentName === null || proposedName === null) {
    return false;
  }
  return currentName !== proposedName;
}

function combineContributionPointAwardResults(
  results: Iterable<ContributionPointAwardResult>,
  params: { actionGroupId: string },
): ContributionPointAwardResult {
  return {
    entries: Array.from(results).flatMap((result) => result.entries),
    actionGroupId: params.actionGroupId,
  };
}

function readLedgerEntryIdsFromCallable(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpsError(
      "invalid-argument",
      "ledgerEntryIds must be a non-empty list.",
    );
  }
  if (value.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "ledgerEntryIds must include at least one entry.",
    );
  }
  if (value.length > maxCelebrationLedgerEntryIds) {
    throw new HttpsError(
      "invalid-argument",
      `ledgerEntryIds may include at most ${maxCelebrationLedgerEntryIds} entries.`,
    );
  }

  const ledgerEntryIds: string[] = [];
  for (const item of value) {
    const ledgerEntryId = readOptionalString(item);
    if (ledgerEntryId === null) {
      throw new HttpsError(
        "invalid-argument",
        "ledgerEntryIds must only contain non-empty strings.",
      );
    }
    ledgerEntryIds.push(ledgerEntryId);
  }
  return normalizeLedgerEntryIds(ledgerEntryIds);
}

function normalizeLedgerEntryIds(ledgerEntryIds: string[]): string[] {
  return Array.from(
    new Set(
      ledgerEntryIds
        .map((ledgerEntryId) => ledgerEntryId.trim())
        .filter((ledgerEntryId) => ledgerEntryId.length > 0),
    ),
  );
}

function readAwardDraftFromCallable(data: unknown): ContributionPointAwardDraft {
  const record = readRecord(data);
  const draft = readRecord(record.draft ?? record);
  const points = readRequiredPositiveInteger(draft.points, "points");

  return {
    userId: readRequiredString(draft.userId, "userId"),
    points,
    actionType: readRequiredString(draft.actionType, "actionType"),
    sourceKey: readRequiredString(draft.sourceKey, "sourceKey"),
    description: readRequiredString(draft.description, "description"),
    dishId: readOptionalString(draft.dishId),
    dishName: readOptionalString(draft.dishName),
    restaurantId: readOptionalString(draft.restaurantId),
    restaurantName: readOptionalString(draft.restaurantName),
    restaurantCity: readOptionalString(draft.restaurantCity),
    restaurantState: readOptionalString(draft.restaurantState),
    restaurantAddress: readOptionalString(draft.restaurantAddress),
    restaurantPhone: readOptionalString(draft.restaurantPhone),
    reviewId: readOptionalString(draft.reviewId),
    requestId: readOptionalString(draft.requestId),
    imageId: readOptionalString(draft.imageId),
    oldValue: readOptionalString(draft.oldValue),
    newValue: readOptionalString(draft.newValue),
    mergeSourceDishId: readOptionalString(draft.mergeSourceDishId),
    mergeSourceDishName: readOptionalString(draft.mergeSourceDishName),
    mergeTargetDishId: readOptionalString(draft.mergeTargetDishId),
    mergeTargetDishName: readOptionalString(draft.mergeTargetDishName),
  };
}

function ledgerDocument(
  db: FirestoreLike,
  ledgerEntryId: string,
): DocumentReferenceLike {
  return db.collection(contributionPointLedgerCollection).doc(ledgerEntryId);
}

function userProfileDocument(
  db: FirestoreLike,
  userId: string,
): DocumentReferenceLike {
  return db.collection(contributionUserProfilesCollection).doc(userId.trim());
}

function incrementCachedTotal(
  transaction: TransactionLike,
  userRef: DocumentReferenceLike,
  delta: number,
  fieldValues: ServerFieldValues,
): void {
  transaction.set(
    userRef,
    {
      userId: userRef.id,
      contributionPoints: fieldValues.increment(delta),
      lastContributionAt: fieldValues.serverTimestamp(),
      updatedAt: fieldValues.serverTimestamp(),
    },
    { merge: true },
  );
}

type ContributionPointTransactionAward = Readonly<{
  result: ContributionPointAwardResult;
  wasCreated: boolean;
}>;

async function awardContributionPointsWithExactSourceKey(
  db: FirestoreLike,
  draft: ContributionPointAwardDraft,
  options: HelperOptions,
): Promise<ContributionPointAwardResult> {
  const normalizedDraft = normalizeAwardDraft(draft);
  if (
    normalizedDraft === null ||
    normalizedDraft.userId.length === 0 ||
    normalizedDraft.points <= 0 ||
    draft.sourceKey.length === 0
  ) {
    return { entries: [] };
  }
  return runContributionPointAwardTransaction(
    db,
    {
      ...normalizedDraft,
      sourceKey: draft.sourceKey,
      requestId: draft.requestId,
    },
    true,
    options,
  );
}

async function runContributionPointAwardTransaction(
  db: FirestoreLike,
  draft: ContributionPointAwardDraft,
  exactSourceKey: boolean,
  options: HelperOptions,
): Promise<ContributionPointAwardResult> {
  const fieldValues = options.fieldValues ?? adminServerFieldValues;
  const award = await db.runTransaction(async (transaction) => {
    await options.transactionGuard?.(transaction);
    return awardContributionPointsWithinTransaction(
      transaction,
      db,
      draft,
      exactSourceKey,
      fieldValues,
    );
  });
  return award.result;
}

async function awardContributionPointsWithinTransaction(
  transaction: TransactionLike,
  db: FirestoreLike,
  draft: ContributionPointAwardDraft,
  exactSourceKey: boolean,
  fieldValues: ServerFieldValues,
): Promise<ContributionPointTransactionAward> {
  const documentId = exactSourceKey
    ? buildContributionLedgerDocumentIdFromExactSourceKey(draft.sourceKey)
    : buildContributionLedgerDocumentIdFromSourceKey(draft.sourceKey);
  const entryRef = ledgerDocument(db, documentId);
  const userRef = userProfileDocument(db, draft.userId);
  const existingSnapshot = await transaction.get(entryRef);
  if (existingSnapshot.exists) {
    const existing = parseLedgerEntry(existingSnapshot);
    if (existing === null) {
      if (exactSourceKey) {
        throw new Error("Existing proposal contribution ledger entry is invalid.");
      }
      return existingContributionPointAward(draft, documentId);
    }
    if (exactSourceKey && !ledgerEntryMatchesDraft(existing, draft)) {
      throw new Error("Existing proposal contribution ledger identity is invalid.");
    }
    if (existing.status === contributionPointStatus.active) {
      return existingContributionPointAward(draft, documentId);
    }
    if (
      exactSourceKey &&
      existing.status !== contributionPointStatus.reversed
    ) {
      throw new Error("Existing proposal contribution ledger status is invalid.");
    }

    const restoreRef = ledgerDocument(db, `restore:${documentId}`);
    const restoreSnapshot = await transaction.get(restoreRef);
    if (restoreSnapshot.exists) {
      if (exactSourceKey) {
        const restored = parseLedgerEntry(restoreSnapshot);
        if (
          restored === null ||
          restored.status !== contributionPointStatus.active ||
          !ledgerEntryMatchesDraft(restored, draft)
        ) {
          throw new Error("Existing proposal contribution restore entry is invalid.");
        }
      }
      return existingContributionPointAward(draft, documentId);
    }

    transaction.set(restoreRef, {
      ...awardEntryMap({
        id: restoreRef.id,
        draft,
        description: `${draft.description} restored`,
        fieldValues,
        exactSourceKey,
      }),
      originalLedgerEntryId: existing.id,
    });
    incrementCachedTotal(
      transaction,
      userRef,
      draft.points,
      fieldValues,
    );
    return createdContributionPointAward(draft, restoreRef.id);
  }

  transaction.set(
    entryRef,
    awardEntryMap({
      id: entryRef.id,
      draft,
      fieldValues,
      exactSourceKey,
    }),
  );
  incrementCachedTotal(
    transaction,
    userRef,
    draft.points,
    fieldValues,
  );
  return createdContributionPointAward(draft, entryRef.id);
}

function createdContributionPointAward(
  draft: ContributionPointAwardDraft,
  ledgerEntryId: string,
): ContributionPointTransactionAward {
  return {
    wasCreated: true,
    result: {
      entries: [{ledgerEntryId, points: draft.points, wasCreated: true}],
      actionGroupId: draft.sourceKey,
    },
  };
}

function existingContributionPointAward(
  draft: ContributionPointAwardDraft,
  ledgerEntryId: string,
): ContributionPointTransactionAward {
  return {
    wasCreated: false,
    result: {
      entries: [{ledgerEntryId, points: draft.points, wasCreated: false}],
      actionGroupId: draft.sourceKey,
    },
  };
}

function ledgerEntryMatchesDraft(
  entry: ParsedLedgerEntry,
  draft: ContributionPointAwardDraft,
): boolean {
  return entry.userId === draft.userId &&
    entry.pointsDelta === draft.points &&
    entry.actionType === draft.actionType &&
    entry.sourceKey === draft.sourceKey &&
    entry.requestId === draft.requestId;
}

function awardEntryMap(params: {
  id: string;
  draft: ContributionPointAwardDraft;
  fieldValues: ServerFieldValues;
  exactSourceKey: boolean;
  description?: string;
}): Record<string, unknown> {
  const result = entryMap(params);
  if (params.exactSourceKey) {
    result.sourceKey = params.draft.sourceKey;
    result.requestId = params.draft.requestId ?? null;
  }
  return result;
}

function entryMap(params: {
  id: string;
  draft: ContributionPointAwardDraft;
  fieldValues: ServerFieldValues;
  description?: string;
}): Record<string, unknown> {
  const { id, draft, fieldValues } = params;
  return {
    id: id.trim(),
    userId: draft.userId.trim(),
    pointsDelta: draft.points,
    actionType: draft.actionType.trim(),
    sourceKey: draft.sourceKey.trim(),
    description: (params.description ?? draft.description).trim(),
    status: contributionPointStatus.active,
    ...(draft.points > 0
      ? { celebrationStatus: contributionPointCelebrationStatus.pending }
      : {}),
    dishId: nullableTrim(draft.dishId),
    dishName: nullableTrim(draft.dishName),
    restaurantId: nullableTrim(draft.restaurantId),
    restaurantName: nullableTrim(draft.restaurantName),
    restaurantCity: nullableTrim(draft.restaurantCity),
    restaurantState: nullableTrim(draft.restaurantState),
    restaurantAddress: nullableTrim(draft.restaurantAddress),
    restaurantPhone: nullableTrim(draft.restaurantPhone),
    reviewId: nullableTrim(draft.reviewId),
    requestId: nullableTrim(draft.requestId),
    imageId: nullableTrim(draft.imageId),
    oldValue: nullableTrim(draft.oldValue),
    newValue: nullableTrim(draft.newValue),
    mergeSourceDishId: nullableTrim(draft.mergeSourceDishId),
    mergeSourceDishName: nullableTrim(draft.mergeSourceDishName),
    mergeTargetDishId: nullableTrim(draft.mergeTargetDishId),
    mergeTargetDishName: nullableTrim(draft.mergeTargetDishName),
    createdAt: fieldValues.serverTimestamp(),
    updatedAt: fieldValues.serverTimestamp(),
  };
}

function normalizeAwardDraft(
  draft: ContributionPointAwardDraft,
): ContributionPointAwardDraft | null {
  const userId = draft.userId.trim();
  const actionType = draft.actionType.trim();
  const sourceKey = draft.sourceKey.trim();
  const description = draft.description.trim();
  if (!Number.isInteger(draft.points)) {
    return null;
  }

  return {
    ...draft,
    userId,
    points: draft.points,
    actionType,
    sourceKey,
    description,
  };
}

type ParsedLedgerEntry = {
  id: string;
  userId: string;
  pointsDelta: number;
  actionType: string;
  sourceKey: string;
  description: string;
  status: string;
  celebrationStatus: string | null;
  dishId: string | null;
  dishName: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  restaurantCity: string | null;
  restaurantState: string | null;
  restaurantAddress: string | null;
  restaurantPhone: string | null;
  reviewId: string | null;
  requestId: string | null;
  imageId: string | null;
  oldValue: string | null;
  newValue: string | null;
  mergeSourceDishId: string | null;
  mergeSourceDishName: string | null;
  mergeTargetDishId: string | null;
  mergeTargetDishName: string | null;
};

function parseLedgerEntry(
  snapshot: DocumentSnapshotLike,
): ParsedLedgerEntry | null {
  const data = snapshot.data();
  if (!data) {
    return null;
  }

  const userId = readOptionalString(data.userId);
  const actionType = readOptionalString(data.actionType);
  const sourceKey = readExactNonEmptyString(data.sourceKey);
  const description = readOptionalString(data.description);
  const pointsDelta = readNumber(data.pointsDelta);
  if (
    userId === null ||
    actionType === null ||
    sourceKey === null ||
    description === null ||
    pointsDelta === null
  ) {
    return null;
  }

  return {
    id: readOptionalString(data.id) ?? snapshot.id,
    userId,
    pointsDelta,
    actionType,
    sourceKey,
    description,
    status: readOptionalString(data.status) ?? contributionPointStatus.active,
    celebrationStatus: readOptionalString(data.celebrationStatus),
    dishId: readOptionalString(data.dishId),
    dishName: readOptionalString(data.dishName),
    restaurantId: readOptionalString(data.restaurantId),
    restaurantName: readOptionalString(data.restaurantName),
    restaurantCity: readOptionalString(data.restaurantCity),
    restaurantState: readOptionalString(data.restaurantState),
    restaurantAddress: readOptionalString(data.restaurantAddress),
    restaurantPhone: readOptionalString(data.restaurantPhone),
    reviewId: readOptionalString(data.reviewId),
    requestId: readNullableExactString(data.requestId),
    imageId: readOptionalString(data.imageId),
    oldValue: readOptionalString(data.oldValue),
    newValue: readOptionalString(data.newValue),
    mergeSourceDishId: readOptionalString(data.mergeSourceDishId),
    mergeSourceDishName: readOptionalString(data.mergeSourceDishName),
    mergeTargetDishId: readOptionalString(data.mergeTargetDishId),
    mergeTargetDishName: readOptionalString(data.mergeTargetDishName),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readRequiredString(value: unknown, fieldName: string): string {
  const stringValue = readOptionalString(value);
  if (stringValue === null) {
    throw new HttpsError("invalid-argument", `${fieldName} is required.`);
  }
  return stringValue;
}

function readRequiredDocumentId(value: unknown, fieldName: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be one exact Firestore document-ID segment.`,
    );
  }
  return value;
}

function readExactNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableExactString(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : readExactNonEmptyString(value);
}

function readRequiredPositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a positive integer.`,
    );
  }
  return value;
}

function readRequiredSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a safe integer.`,
    );
  }
  return value;
}

function readRequiredNonnegativeSafeInteger(
  value: unknown,
  fieldName: string,
): number {
  const parsed = readRequiredSafeInteger(value, fieldName);
  if (parsed < 0) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be nonnegative.`,
    );
  }
  return parsed;
}

function readNonnegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : null;
}

function readNullableDishProposalDate(value: unknown): Date | null | undefined {
  if (value === null) {
    return null;
  }
  return readDishProposalDate(value) ?? undefined;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
